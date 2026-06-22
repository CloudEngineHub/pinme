import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  calculateDirectorySize,
  checkDirectorySizeLimit,
  checkFileSizeLimit,
  formatSize,
} from '../../bin/utils/uploadLimits';

let tempDir: string | undefined;

function makeTempDir(): string {
  tempDir = mkdtempSync(path.join(tmpdir(), 'pinme-upload-limits-'));
  return tempDir;
}

describe('uploadLimits', () => {
  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  test('checks file size against the default limit', () => {
    const root = makeTempDir();
    const filePath = path.join(root, 'index.html');
    writeFileSync(filePath, Buffer.alloc(128));

    expect(checkFileSizeLimit(filePath)).toMatchObject({
      size: 128,
      exceeds: false,
    });
  });

  test('detects file and directory sizes above configured limits', async () => {
    vi.resetModules();
    process.env.FILE_SIZE_LIMIT = '0';
    process.env.DIRECTORY_SIZE_LIMIT = '0';
    const limits = await import('../../bin/utils/uploadLimits');
    const root = makeTempDir();
    const filePath = path.join(root, 'index.html');
    writeFileSync(filePath, Buffer.alloc(1));

    expect(limits.checkFileSizeLimit(filePath)).toMatchObject({
      size: 1,
      limit: 0,
      exceeds: true,
    });
    expect(limits.checkDirectorySizeLimit(root)).toMatchObject({
      size: 1,
      limit: 0,
      exceeds: true,
    });
    delete process.env.FILE_SIZE_LIMIT;
    delete process.env.DIRECTORY_SIZE_LIMIT;
  });

  test('treats sizes equal to the configured limit as not exceeding', async () => {
    vi.resetModules();
    process.env.FILE_SIZE_LIMIT = '1';
    process.env.DIRECTORY_SIZE_LIMIT = '1';
    const limits = await import('../../bin/utils/uploadLimits');
    const root = makeTempDir();
    const filePath = path.join(root, 'one-mb.bin');
    writeFileSync(filePath, Buffer.alloc(1024 * 1024));

    expect(limits.checkFileSizeLimit(filePath).exceeds).toBe(false);
    expect(limits.checkDirectorySizeLimit(root).exceeds).toBe(false);
    delete process.env.FILE_SIZE_LIMIT;
    delete process.env.DIRECTORY_SIZE_LIMIT;
  });

  test('calculates nested directory size', () => {
    const root = makeTempDir();
    mkdirSync(path.join(root, 'assets'), { recursive: true });
    writeFileSync(path.join(root, 'index.html'), Buffer.alloc(10));
    writeFileSync(path.join(root, 'assets', 'app.js'), Buffer.alloc(15));

    expect(calculateDirectorySize(root)).toBe(25);
    expect(checkDirectorySizeLimit(root)).toMatchObject({
      size: 25,
      exceeds: false,
    });
  });

  test('formats human readable sizes', () => {
    expect(formatSize(12)).toBe('12 bytes');
    expect(formatSize(1024)).toBe('1.00 KB');
    expect(formatSize(2048)).toBe('2.00 KB');
    expect(formatSize(1024 * 1024)).toBe('1.00 MB');
    expect(formatSize(3 * 1024 * 1024)).toBe('3.00 MB');
    expect(formatSize(1024 * 1024 * 1024)).toBe('1.00 GB');
    expect(formatSize(2 * 1024 * 1024 * 1024)).toBe('2.00 GB');
  });
});
