import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { test } from 'vitest';

async function loadHelper() {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'pinme-install-helper-'));
  const outfile = path.join(tempDir, 'installProjectDependencies.cjs');

  await build({
    entryPoints: [path.resolve('bin/utils/installProjectDependencies.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
  });

  return import(pathToFileURL(outfile).href);
}

function makeProject() {
  return mkdtempSync(path.join(tmpdir(), 'pinme-install-project-'));
}

test('readBackgroundInstallStatus treats fresh log-only markers as running', async () => {
  const {
    INSTALL_LOG_FILE,
    readBackgroundInstallStatus,
  } = await loadHelper();
  const projectDir = makeProject();

  try {
    writeFileSync(path.join(projectDir, INSTALL_LOG_FILE), 'starting npm ci\n');

    assert.deepEqual(readBackgroundInstallStatus(projectDir), {
      status: 'running',
      exitCode: null,
      logPath: path.join(projectDir, INSTALL_LOG_FILE),
    });
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('readBackgroundInstallStatus detects stale log-only markers as interrupted', async () => {
  const {
    INSTALL_LOG_FILE,
    readBackgroundInstallStatus,
  } = await loadHelper();
  const projectDir = makeProject();
  const logPath = path.join(projectDir, INSTALL_LOG_FILE);

  try {
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(logPath, 'starting npm ci\n');
    const staleTime = new Date(Date.now() - 2 * 60 * 1000);
    utimesSync(logPath, staleTime, staleTime);

    assert.deepEqual(readBackgroundInstallStatus(projectDir), {
      status: 'interrupted',
      exitCode: null,
      logPath,
    });
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('readBackgroundInstallStatus detects dead background install pid as interrupted', async () => {
  const {
    INSTALL_LOG_FILE,
    INSTALL_PID_FILE,
    readBackgroundInstallStatus,
  } = await loadHelper();
  const projectDir = makeProject();
  const logPath = path.join(projectDir, INSTALL_LOG_FILE);

  try {
    writeFileSync(logPath, 'starting npm ci\n');
    writeFileSync(path.join(projectDir, INSTALL_PID_FILE), '999999999');

    assert.deepEqual(readBackgroundInstallStatus(projectDir), {
      status: 'interrupted',
      exitCode: null,
      logPath,
    });
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('stopBackgroundInstall clears a dead background install pid marker', async () => {
  const {
    INSTALL_LOG_FILE,
    INSTALL_PID_FILE,
    stopBackgroundInstall,
  } = await loadHelper();
  const projectDir = makeProject();
  const logPath = path.join(projectDir, INSTALL_LOG_FILE);
  const pidPath = path.join(projectDir, INSTALL_PID_FILE);

  try {
    writeFileSync(logPath, 'starting npm ci\n');
    writeFileSync(pidPath, '999999999');

    assert.equal(await stopBackgroundInstall(projectDir), false);
    assert.equal(readFileExists(pidPath), false);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('buildBackgroundInstallCommand captures Windows npm exit code after command finishes', async () => {
  const {
    buildBackgroundInstallCommand,
  } = await loadHelper();

  const command = buildBackgroundInstallCommand(
    'ci',
    'C:\\Users\\Pin Me\\project\\.pinme-install.log',
    'C:\\Users\\Pin Me\\project\\.pinme-install.exitcode',
    'win32',
  );

  assert.deepEqual(command.shellArgs.slice(0, 4), ['/d', '/s', '/v:on', '/c']);
  assert.match(command.shellArgs[4], /echo !errorlevel! >/);
  assert.doesNotMatch(command.shellArgs[4], /%errorlevel%/);
  assert.match(command.shellArgs[4], /"C:\\Users\\Pin Me\\project\\.pinme-install.log"/);
});

function readFileExists(filePath) {
  return existsSync(filePath);
}
