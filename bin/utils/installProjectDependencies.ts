import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import chalk from 'chalk';
import { spawn } from 'child_process';

type InstallScript = 'ci' | 'install';

interface InstallProjectDependenciesOptions {
  mode?: 'auto' | InstallScript;
}

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const SLOW_INSTALL_NOTICE_MS = 60 * 1000;
const CAPTURED_OUTPUT_LIMIT = 12000;
const STALE_LOG_ONLY_MARKER_MS = 90 * 1000;
const STOP_BACKGROUND_GRACE_MS = 3000;
const STOP_BACKGROUND_KILL_GRACE_MS = 2000;
const STOP_BACKGROUND_POLL_MS = 200;

// Marker files written by the background install so other commands (`pinme save`)
// can tell whether dependencies are still installing, finished, or failed.
export const INSTALL_LOG_FILE = '.pinme-install.log';
export const INSTALL_EXITCODE_FILE = '.pinme-install.exitcode';
export const INSTALL_PID_FILE = '.pinme-install.pid';

export type BackgroundInstallStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'failed'
  | 'interrupted';

export interface BackgroundInstallState {
  status: BackgroundInstallStatus;
  exitCode: number | null;
  logPath: string;
}

export class DependencyInstallError extends Error {
  command: string;

  constructor(command: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`${command} failed: ${reason}`);
    this.name = 'DependencyInstallError';
    this.command = command;
    this.cause = cause;
  }
}

function makeTempCacheDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pinme-npm-cache-'));
}

function getNpmCommand(): string {
  // On Windows, npm is often installed as npm.cmd
  if (process.platform === 'win32') {
    return 'npm.cmd';
  }
  return 'npm';
}

function hasPackageLock(cwd: string): boolean {
  return fs.existsSync(path.join(cwd, 'package-lock.json'));
}

function getInstallScript(cwd: string, mode: 'auto' | InstallScript): InstallScript {
  if (mode !== 'auto') {
    return mode;
  }

  return hasPackageLock(cwd) ? 'ci' : 'install';
}

function getInstallArgs(script: InstallScript, cacheDir?: string): string[] {
  const args = [
    script,
    '--no-audit',
    '--no-fund',
    '--fetch-retries=3',
    '--fetch-retry-factor=2',
    '--fetch-retry-mintimeout=10000',
    '--fetch-retry-maxtimeout=60000',
    '--fetch-timeout=60000',
  ];

  if (cacheDir) {
    args.splice(1, 0, '--cache', cacheDir);
  }

  return args;
}

function formatInstallCommand(
  script: InstallScript,
  cacheMode: 'default' | 'isolated' = 'default',
): string {
  const parts = [
    `npm ${script}`,
    '--no-audit',
    '--no-fund',
    '--fetch-retries=3',
    '--fetch-timeout=60000',
  ];

  if (cacheMode === 'isolated') {
    parts.splice(1, 0, '--cache <isolated npm cache>');
  }

  return parts.join(' ');
}

function appendCapturedOutput(output: string, chunk: Buffer): string {
  const next = output + chunk.toString();
  if (next.length <= CAPTURED_OUTPUT_LIMIT) {
    return next;
  }

  return next.slice(next.length - CAPTURED_OUTPUT_LIMIT);
}

function runInstall(
  cwd: string,
  script: InstallScript,
  cacheDir?: string,
): Promise<void> {
  const npm = getNpmCommand();
  const args = getInstallArgs(script, cacheDir);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_fetch_retries: '3',
    npm_config_fetch_retry_factor: '2',
    npm_config_fetch_retry_mintimeout: '10000',
    npm_config_fetch_retry_maxtimeout: '60000',
    npm_config_fetch_timeout: '60000',
  };

  if (cacheDir) {
    env.npm_config_cache = cacheDir;
  }

  return new Promise((resolve, reject) => {
    let capturedOutput = '';
    let settled = false;
    let timedOut = false;
    const child = spawn(npm, args, {
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      env,
    });

    const slowNoticeTimer = setTimeout(() => {
      console.log(chalk.yellow('   Still installing dependencies. Slow npm registry or network can make this take a few minutes...'));
    }, SLOW_INSTALL_NOTICE_MS);

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, INSTALL_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(slowNoticeTimer);
      clearTimeout(timeoutTimer);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
      capturedOutput = appendCapturedOutput(capturedOutput, chunk);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      capturedOutput = appendCapturedOutput(capturedOutput, chunk);
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();

      if (timedOut) {
        reject(new Error(`npm ${script} timed out after 10 minutes.\n${capturedOutput}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`npm ${script} failed with exit code ${code}${signal ? ` and signal ${signal}` : ''}.\n${capturedOutput}`));
        return;
      }

      resolve();
    });
  });
}

type ShellPlatform = NodeJS.Platform | 'posix';

interface BackgroundInstallCommand {
  shellBin: string;
  shellArgs: string[];
  installCommand: string;
}

function quoteForShell(value: string, platform: ShellPlatform = process.platform): string {
  // tmp paths / project paths can contain spaces; wrap everything in quotes.
  if (platform === 'win32') {
    return `"${value}"`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildBackgroundInstallCommand(
  script: InstallScript,
  logPath: string,
  exitCodePath: string,
  platform: ShellPlatform = process.platform,
): BackgroundInstallCommand {
  const args = getInstallArgs(script);
  const npmCmd = platform === 'win32' ? 'npm' : getNpmCommand();
  const installCommand = `${npmCmd} ${args.map((arg) => quoteForShell(arg, platform)).join(' ')}`;
  const qLog = quoteForShell(logPath, platform);
  const qExit = quoteForShell(exitCodePath, platform);

  if (platform === 'win32') {
    // Enable delayed expansion so !errorlevel! is evaluated after npm exits.
    return {
      shellBin: process.env.ComSpec || 'cmd.exe',
      shellArgs: [
        '/d',
        '/s',
        '/v:on',
        '/c',
        `${installCommand} >> ${qLog} 2>&1 & echo !errorlevel! > ${qExit}`,
      ],
      installCommand,
    };
  }

  return {
    shellBin: '/bin/sh',
    shellArgs: [
      '-c',
      `${installCommand} >> ${qLog} 2>&1; printf '%s' "$?" > ${qExit}`,
    ],
    installCommand,
  };
}

/**
 * Start a dependency install in a detached background process and return
 * immediately. The child keeps running after the current CLI process exits,
 * so `pinme create` can finish (and `process.exit`) while dependencies keep
 * installing for later use (`pinme save`, local dev).
 *
 * The install is wrapped in a shell command that:
 *   1. Clears any previous exit-code marker.
 *   2. Streams all output to `<cwd>/.pinme-install.log`.
 *   3. Writes the install's exit code to `<cwd>/.pinme-install.exitcode` when done.
 *
 * Other commands read those markers (see {@link readBackgroundInstallStatus}) to
 * know whether the install is still running, succeeded, or failed.
 */
export function startBackgroundInstall(cwd: string): { logPath: string } {
  const script = getInstallScript(cwd, 'auto');
  const logPath = path.join(cwd, INSTALL_LOG_FILE);
  const exitCodePath = path.join(cwd, INSTALL_EXITCODE_FILE);
  const pidPath = path.join(cwd, INSTALL_PID_FILE);

  // Reset markers from any previous run.
  fs.removeSync(exitCodePath);
  fs.removeSync(pidPath);
  fs.writeFileSync(logPath, `[pinme] ${new Date().toISOString()} starting "npm ${script}"\n`);

  const { shellBin, shellArgs } = buildBackgroundInstallCommand(script, logPath, exitCodePath);

  const child = spawn(shellBin, shellArgs, {
    cwd,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_fetch_retries: '3',
      npm_config_fetch_retry_factor: '2',
      npm_config_fetch_retry_mintimeout: '10000',
      npm_config_fetch_retry_maxtimeout: '60000',
      npm_config_fetch_timeout: '60000',
    },
  });

  child.unref();
  if (child.pid) {
    fs.writeFileSync(pidPath, String(child.pid));
  }

  return { logPath };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === 'EPERM';
  }
}

function readPidFile(pidPath: string): number | null {
  if (!fs.existsSync(pidPath)) {
    return null;
  }

  const raw = fs.readFileSync(pidPath, 'utf-8').trim();
  const pid = Number.parseInt(raw, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    return null;
  }

  return pid;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signalInstallProcess(pid: number, signal: NodeJS.Signals): boolean {
  try {
    if (process.platform === 'win32') {
      process.kill(pid, signal);
    } else {
      process.kill(-pid, signal);
    }
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

async function waitForProcessExit(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await sleep(STOP_BACKGROUND_POLL_MS);
  }

  return !isProcessAlive(pid);
}

export async function stopBackgroundInstall(cwd: string): Promise<boolean> {
  const pidPath = path.join(cwd, INSTALL_PID_FILE);
  const pid = readPidFile(pidPath);
  let stopped = false;

  if (pid !== null && isProcessAlive(pid)) {
    if (signalInstallProcess(pid, 'SIGTERM')) {
      stopped = true;
      const stoppedGracefully = await waitForProcessExit(
        pid,
        STOP_BACKGROUND_GRACE_MS,
      );

      if (!stoppedGracefully) {
        signalInstallProcess(pid, 'SIGKILL');
        await waitForProcessExit(pid, STOP_BACKGROUND_KILL_GRACE_MS);
      }
    }
  }

  fs.removeSync(pidPath);
  return stopped;
}

function isStaleLogOnlyMarker(logPath: string): boolean {
  try {
    const ageMs = Date.now() - fs.statSync(logPath).mtimeMs;
    return ageMs > STALE_LOG_ONLY_MARKER_MS;
  } catch {
    return false;
  }
}

/**
 * Read the state of a background install started by {@link startBackgroundInstall}.
 * - `idle`: no install was ever started here (no log, no exit-code marker).
 * - `running`: a log exists but the exit code has not been written yet.
 * - `success` / `failed`: the install finished with the recorded exit code.
 * - `interrupted`: an install started, but the tracked background process is
 *   gone or a legacy log-only marker is too old to trust.
 */
export function readBackgroundInstallStatus(cwd: string): BackgroundInstallState {
  const logPath = path.join(cwd, INSTALL_LOG_FILE);
  const exitCodePath = path.join(cwd, INSTALL_EXITCODE_FILE);
  const pidPath = path.join(cwd, INSTALL_PID_FILE);

  if (fs.existsSync(exitCodePath)) {
    const raw = fs.readFileSync(exitCodePath, 'utf-8').trim();
    const code = Number.parseInt(raw, 10);
    if (Number.isNaN(code)) {
      // The marker is being written but the value is not flushed yet.
      return { status: 'running', exitCode: null, logPath };
    }
    return { status: code === 0 ? 'success' : 'failed', exitCode: code, logPath };
  }

  if (fs.existsSync(logPath)) {
    const pid = readPidFile(pidPath);
    if (pid !== null) {
      return {
        status: isProcessAlive(pid) ? 'running' : 'interrupted',
        exitCode: null,
        logPath,
      };
    }

    if (isStaleLogOnlyMarker(logPath)) {
      return { status: 'interrupted', exitCode: null, logPath };
    }

    return { status: 'running', exitCode: null, logPath };
  }

  return { status: 'idle', exitCode: null, logPath };
}

/** Return the tail of the background install log, for surfacing failure causes. */
export function readBackgroundInstallLogTail(cwd: string, maxChars = 1500): string {
  const logPath = path.join(cwd, INSTALL_LOG_FILE);
  if (!fs.existsSync(logPath)) {
    return '';
  }
  const content = fs.readFileSync(logPath, 'utf-8');
  return content.length > maxChars ? content.slice(content.length - maxChars) : content;
}

export async function installProjectDependencies(
  cwd: string,
  options: InstallProjectDependenciesOptions = {},
): Promise<void> {
  const mode = options.mode || 'auto';
  const script = getInstallScript(cwd, mode);
  const command = formatInstallCommand(script);
  let lastError: unknown;

  if (script === 'ci' && !hasPackageLock(cwd)) {
    throw new DependencyInstallError(
      command,
      new Error('package-lock.json is required for npm ci but was not found.'),
    );
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const useIsolatedCache = attempt > 1;
    const cacheDir = useIsolatedCache ? makeTempCacheDir() : undefined;

    try {
      if (attempt > 1) {
        console.log(chalk.yellow('   Retrying dependency install with a fresh npm cache...'));
      }

      if (attempt === 1 && script === 'ci' && mode === 'auto') {
        console.log(chalk.gray('   package-lock.json found; using npm ci for a reproducible install.'));
      } else if (attempt === 1 && script === 'ci') {
        console.log(chalk.gray('   Using npm ci for a clean, reproducible install.'));
      }

      await runInstall(cwd, script, cacheDir);
      return;
    } catch (error) {
      lastError = error;
    } finally {
      if (cacheDir) {
        fs.removeSync(cacheDir);
      }
    }
  }

  throw new DependencyInstallError(
    formatInstallCommand(script, 'isolated'),
    lastError,
  );
}
