import path from 'path';
import { describe, expect, test } from 'vitest';
import {
  createTempHome,
  repoRoot,
  runCli,
  writeAuthConfig,
} from '../helpers/cliRunner';

describe('pinme CLI', () => {
  test('prints help for --help', async () => {
    const temp = await createTempHome();
    try {
      const result = await runCli(['--help'], { home: temp.home });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: pinme');
      expect(result.stdout).toContain('upload');
    } finally {
      await temp.cleanup();
    }
  });

  test('prints package version for --version', async () => {
    const temp = await createTempHome();
    try {
      const result = await runCli(['--version'], { home: temp.home });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    } finally {
      await temp.cleanup();
    }
  });

  test('shows banner and help with no arguments', async () => {
    const temp = await createTempHome();
    try {
      const result = await runCli([], { home: temp.home });
      const output = `${result.stdout}\n${result.stderr}`;

      expect(result.exitCode).toBe(1);
      expect(output).toContain('Usage: pinme');
      expect(output).toContain('Examples:');
    } finally {
      await temp.cleanup();
    }
  });

  test('list reports empty upload history in isolated HOME', async () => {
    const temp = await createTempHome();
    try {
      const result = await runCli(['list'], { home: temp.home });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No upload history found.');
    } finally {
      await temp.cleanup();
    }
  });

  test('upload exits before network work when auth is missing', async () => {
    const temp = await createTempHome();
    try {
      const result = await runCli(['upload', 'test/fixtures/site'], {
        home: temp.home,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Please login first. Run: pinme login');
    } finally {
      await temp.cleanup();
    }
  });

  test('bind exits before network work when auth is missing', async () => {
    const temp = await createTempHome();
    try {
      const result = await runCli(
        ['bind', 'test/fixtures/site', '--domain', 'demo'],
        { home: temp.home },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Please login first');
    } finally {
      await temp.cleanup();
    }
  });

  test('bind rejects malformed DNS domains before API calls', async () => {
    const temp = await createTempHome();
    try {
      await writeAuthConfig(temp.home);
      const result = await runCli(
        ['bind', 'test/fixtures/site', '--domain', '-bad.com', '--dns'],
        { home: temp.home },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Labels cannot start or end with hyphens');
    } finally {
      await temp.cleanup();
    }
  });

  test('save exits before project work when auth is missing', async () => {
    const temp = await createTempHome();
    try {
      const result = await runCli(['save'], {
        home: temp.home,
        cwd: path.join(repoRoot, 'test', 'fixtures', 'site'),
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Auth not set. Run: pinme login');
    } finally {
      await temp.cleanup();
    }
  });
});
