import path from 'path';
import { mkdir, readFile } from 'fs/promises';
import { describe, expect, test } from 'vitest';
import { execa } from 'execa';
import { dir } from 'tmp-promise';
import { cliEntry, repoRoot } from '../helpers/cliRunner';

describe('npm package', () => {
  test('build output has a shebang and package bin points to it', async () => {
    const [entry, packageJsonRaw] = await Promise.all([
      readFile(cliEntry, 'utf8'),
      readFile(path.join(repoRoot, 'package.json'), 'utf8'),
    ]);
    const packageJson = JSON.parse(packageJsonRaw);

    expect(entry.split('\n')[0]).toBe('#!/usr/bin/env node');
    expect(packageJson.bin.pinme).toBe('./dist/index.js');
  });

  test(
    'npm pack includes the CLI bundle and installable bin',
    async () => {
      const temp = await dir({
        prefix: 'pinme-pack-',
        unsafeCleanup: true,
      });

      try {
        const npmCache = path.join(temp.path, 'npm-cache');
        const pack = await execa(
          'npm',
          ['pack', '--json', '--pack-destination', temp.path],
          {
            cwd: repoRoot,
            env: {
              npm_config_cache: npmCache,
            },
          },
        );
        const [packed] = JSON.parse(pack.stdout);
        const files = packed.files.map((file: { path: string }) => file.path);
        const tarball = path.join(temp.path, packed.filename);

        expect(files.sort()).toEqual([
          'LICENSE',
          'README.md',
          'dist/index.js',
          'package.json',
        ]);

        const extractDir = path.join(temp.path, 'extract');
        await mkdir(extractDir);
        await execa('tar', ['-xzf', tarball, '-C', extractDir]);

        const extractedPackageJson = JSON.parse(
          await readFile(path.join(extractDir, 'package', 'package.json'), 'utf8'),
        );
        const extractedEntry = await readFile(
          path.join(extractDir, 'package', 'dist', 'index.js'),
          'utf8',
        );

        expect(extractedPackageJson.bin.pinme).toBe('./dist/index.js');
        expect(extractedEntry.split('\n')[0]).toBe('#!/usr/bin/env node');
        await execa('node', [
          '--check',
          path.join(extractDir, 'package', 'dist', 'index.js'),
        ]);
      } finally {
        await temp.cleanup();
      }
    },
    30000,
  );
});
