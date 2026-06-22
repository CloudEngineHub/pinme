import path from 'path';
import { writeFile } from 'fs/promises';
import { describe, expect, test } from 'vitest';
import {
  createTempHome,
  repoRoot,
  runCli,
  writeAuthConfig,
} from '../helpers/cliRunner';

function outputOf(result: { stdout: string; stderr: string }): string {
  return `${result.stdout}\n${result.stderr}`;
}

describe('pinme command-level guards', () => {
  test('create requires a local login before project creation', async () => {
    const temp = await createTempHome();
    try {
      const result = await runCli(['create', 'demo-project'], {
        home: temp.home,
      });

      expect(result.exitCode).toBe(1);
      expect(outputOf(result)).toContain('Auth not set. Run: pinme login');
    } finally {
      await temp.cleanup();
    }
  });

  test('import requires a local login before reading CAR input', async () => {
    const temp = await createTempHome();
    try {
      const result = await runCli(['import', 'test/fixtures/site'], {
        home: temp.home,
      });

      expect(result.exitCode).toBe(0);
      expect(outputOf(result)).toContain('Please login first. Run: pinme login');
    } finally {
      await temp.cleanup();
    }
  });

  test('import rejects nonexistent paths before upload', async () => {
    const temp = await createTempHome();
    try {
      await writeAuthConfig(temp.home);
      const result = await runCli(['import', 'does-not-exist.car'], {
        home: temp.home,
      });

      expect(result.exitCode).toBe(0);
      expect(outputOf(result)).toContain('path does-not-exist.car does not exist');
    } finally {
      await temp.cleanup();
    }
  });

  test('export rejects invalid CID arguments before CAR API calls', async () => {
    const temp = await createTempHome();
    try {
      const result = await runCli(['export', 'not-a-cid', '--output', temp.home], {
        home: temp.home,
      });

      expect(result.exitCode).toBe(0);
      expect(outputOf(result)).toContain('Invalid CID format');
    } finally {
      await temp.cleanup();
    }
  });

  test('export rejects output paths that are files before CAR API calls', async () => {
    const temp = await createTempHome();
    try {
      const filePath = path.join(temp.home, 'not-a-directory');
      await writeFile(filePath, 'file');
      const result = await runCli(
        ['export', 'bafyvalidcid', '--output', filePath],
        { home: temp.home },
      );

      expect(result.exitCode).toBe(0);
      expect(outputOf(result)).toContain('exists but is not a directory');
    } finally {
      await temp.cleanup();
    }
  });

  test('delete requires a local login before resolving project deletion', async () => {
    const temp = await createTempHome();
    try {
      const result = await runCli(['delete', 'demo-project', '--force'], {
        home: temp.home,
      });

      expect(result.exitCode).toBe(1);
      expect(outputOf(result)).toContain('Auth not set. Run: pinme login');
    } finally {
      await temp.cleanup();
    }
  });

  test('delete requires a project name when no pinme.toml is present', async () => {
    const temp = await createTempHome();
    try {
      await writeAuthConfig(temp.home);
      const result = await runCli(['delete', '--force'], {
        home: temp.home,
        cwd: path.join(repoRoot, 'test', 'fixtures', 'site'),
      });

      expect(result.exitCode).toBe(1);
      expect(outputOf(result)).toContain('Cannot find project name');
    } finally {
      await temp.cleanup();
    }
  });

  test.each([
    ['save', ['save'], 'Auth not set. Run: pinme login'],
    ['update-web', ['update-web'], 'Auth not set. Run: pinme login'],
    ['update-worker', ['update-worker'], 'Auth not set. Run: pinme login'],
    ['update-db', ['update-db'], 'Auth not set. Run: pinme login'],
  ])('%s requires login before project work', async (_name, args, message) => {
    const temp = await createTempHome();
    try {
      const result = await runCli(args, {
        home: temp.home,
        cwd: path.join(repoRoot, 'test', 'fixtures', 'site'),
      });

      expect(result.exitCode).toBe(1);
      expect(outputOf(result)).toContain(message);
    } finally {
      await temp.cleanup();
    }
  });

  test.each([
    ['save', ['save'], 'pinme.toml` not found'],
    ['update-web', ['update-web'], 'pinme.toml` not found'],
    ['update-worker', ['update-worker'], 'pinme.toml` not found'],
    ['update-db', ['update-db'], 'pinme.toml` not found'],
  ])(
    '%s validates project config before build or deploy work',
    async (_name, args, message) => {
      const temp = await createTempHome();
      try {
        await writeAuthConfig(temp.home);
        const result = await runCli(args, {
          home: temp.home,
          cwd: path.join(repoRoot, 'test', 'fixtures', 'site'),
        });

        expect(result.exitCode).toBe(1);
        expect(outputOf(result)).toContain(message);
      } finally {
        await temp.cleanup();
      }
    },
  );
});
