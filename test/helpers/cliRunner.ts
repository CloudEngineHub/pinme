import path from 'path';
import { fileURLToPath } from 'url';
import { mkdir, rm, writeFile } from 'fs/promises';
import { execaNode } from 'execa';
import { dir } from 'tmp-promise';
import { build } from 'esbuild';
import packageJson from '../../package.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, '..', '..');
export const cliEntry = path.join(repoRoot, 'dist', 'index.js');

export interface TempHome {
  home: string;
  cleanup: () => Promise<void>;
}

export async function createTempHome(): Promise<TempHome> {
  const temp = await dir({
    prefix: 'pinme-cli-home-',
    unsafeCleanup: true,
  });

  return {
    home: temp.path,
    cleanup: temp.cleanup,
  };
}

export async function writeAuthConfig(home: string): Promise<void> {
  const configDir = path.join(home, '.pinme');
  await mkdir(configDir, { recursive: true });
  await writeFile(
    path.join(configDir, 'auth.json'),
    JSON.stringify(
      {
        address: '0x1234567890abcdef',
        token: 'test-token',
      },
      null,
      2,
    ),
  );
}

export function runCli(
  args: string[],
  options: {
    home: string;
    cwd?: string;
    timeout?: number;
    env?: Record<string, string>;
    cliPath?: string;
  },
): any {
  return execaNode(options.cliPath || cliEntry, args, {
    cwd: options.cwd || repoRoot,
    reject: false,
    timeout: options.timeout || 15000,
    env: {
      HOME: options.home,
      USERPROFILE: options.home,
      PINME_TRACKING_DISABLED: '1',
      PINME_API_BASE: 'http://127.0.0.1:9',
      IPFS_API_URL: 'http://127.0.0.1:9',
      CAR_API_BASE: 'http://127.0.0.1:9',
      IPFS_PREVIEW_URL: 'https://preview.pinme.test/#/preview/',
      PROJECT_PREVIEW_URL: 'https://project.pinme.test/',
      PINME_WEB_URL: 'https://app.pinme.test',
      ...options.env,
    },
  });
}

export async function buildCliWithEnv(
  env: Record<string, string>,
): Promise<{ cliPath: string; cleanup: () => Promise<void> }> {
  const outfile = path.join(
    repoRoot,
    'dist',
    `.test-cli-${process.pid}-${Date.now()}.js`,
  );
  const define: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    define[`process.env.${key}`] = JSON.stringify(value);
  }

  await build({
    entryPoints: [path.join(repoRoot, 'bin', 'index.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node14',
    format: 'cjs',
    external: Object.keys(packageJson.dependencies || {}).filter(
      (dependency) => dependency !== 'axios',
    ),
    banner: { js: '#!/usr/bin/env node' },
    logLevel: 'silent',
    define,
  });

  return {
    cliPath: outfile,
    cleanup: () => rm(outfile, { force: true }),
  };
}
