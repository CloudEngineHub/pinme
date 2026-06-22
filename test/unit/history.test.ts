import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, test, vi } from 'vitest';

let tempHome: string | undefined;
let originalHome: string | undefined;
const trackEvent = vi.fn();
const getRootDomain = vi.fn(async () => 'pinme.test');

async function loadHistory(fsMock?: Record<string, unknown>) {
  vi.resetModules();
  tempHome = mkdtempSync(path.join(tmpdir(), 'pinme-history-home-'));
  originalHome = process.env.HOME;
  process.env.HOME = tempHome;
  if (fsMock) {
    vi.doMock('fs-extra', () => ({
      ...fsMock,
      default: fsMock,
    }));
  }
  vi.doMock('os', () => ({
    homedir: () => tempHome,
    default: {
      homedir: () => tempHome,
    },
  }));
  vi.doMock('node:os', () => ({
    homedir: () => tempHome,
    default: {
      homedir: () => tempHome,
    },
  }));
  vi.doMock('../../bin/utils/tracker', () => ({
    default: { trackEvent },
    getTrackErrorReason: (error: unknown) =>
      error instanceof Error ? error.message : 'unknown_error',
  }));
  vi.doMock('../../bin/utils/pinmeApi', () => ({
    getRootDomain,
  }));
  return import('../../bin/utils/history');
}

describe('history', () => {
  afterEach(() => {
    vi.doUnmock('os');
    vi.doUnmock('node:os');
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    originalHome = undefined;
    vi.doUnmock('fs-extra');
    vi.doUnmock('../../bin/utils/tracker');
    vi.doUnmock('../../bin/utils/pinmeApi');
    vi.clearAllMocks();
    if (tempHome) {
      rmSync(tempHome, { recursive: true, force: true });
      tempHome = undefined;
    }
  });

  test('saves and reads upload history newest first', async () => {
    const { saveUploadHistory, getUploadHistory } = await loadHistory();

    expect(
      saveUploadHistory({
        path: '/tmp/one',
        contentHash: 'bafy-one',
        previewHash: null,
        size: 10,
        fileCount: 1,
        isDirectory: false,
      }),
    ).toBe(true);
    expect(
      saveUploadHistory({
        path: '/tmp/two',
        filename: 'two',
        contentHash: 'bafy-two',
        previewHash: null,
        size: 20,
        fileCount: 2,
        isDirectory: true,
        pinmeUrl: 'demo',
      }),
    ).toBe(true);

    expect(getUploadHistory(1)).toMatchObject([
      {
        filename: 'two',
        contentHash: 'bafy-two',
        fileCount: 2,
        type: 'directory',
      },
    ]);
  });

  test('displays preferred URLs and totals', async () => {
    const { saveUploadHistory, displayUploadHistory } = await loadHistory();
    const messages: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((value = '') => {
      messages.push(String(value));
    });

    try {
      saveUploadHistory({
        path: '/tmp/site',
        filename: 'site',
        contentHash: 'bafy-site',
        previewHash: null,
        size: 2048,
        fileCount: 3,
        isDirectory: true,
        pinmeUrl: 'demo',
      });
      await displayUploadHistory(10);
    } finally {
      spy.mockRestore();
    }

    const output = messages.join('\n');
    expect(output).toContain('Upload History:');
    expect(output).toContain('1. site');
    expect(output).toContain('Path: /tmp/site');
    expect(output).toContain('IPFS CID: bafy-site');
    expect(output).toContain('https://demo.pinme.test');
    expect(output).toContain('Total Uploads: 1');
    expect(output).toContain('Total Files: 3');
    expect(output).toContain('Total Size: 2.00 KB');
    expect(output).toContain('Type: Directory');
    expect(trackEvent).toHaveBeenCalled();
  });

  test('clearUploadHistory empties records', async () => {
    const { saveUploadHistory, getUploadHistory, clearUploadHistory } =
      await loadHistory();

    saveUploadHistory({
      path: '/tmp/site',
      contentHash: 'bafy-site',
      previewHash: null,
      size: 1,
    });

    expect(clearUploadHistory()).toBe(true);
    expect(getUploadHistory()).toEqual([]);
  });

  test('displayUploadHistory handles missing root domain for bare URLs', async () => {
    const { saveUploadHistory, displayUploadHistory } = await loadHistory();
    getRootDomain.mockRejectedValueOnce(new Error('root domain unavailable'));
    const messages: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((value = '') => {
      messages.push(String(value));
    });

    try {
      saveUploadHistory({
        path: '/tmp/site',
        filename: 'site',
        contentHash: 'bafy-site',
        previewHash: null,
        size: 1,
        shortUrl: 'short',
      });
      await displayUploadHistory(10);
    } finally {
      spy.mockRestore();
    }

    expect(messages.join('\n')).toContain('https://short');
  });

  test('displayUploadHistory reports an empty isolated history', async () => {
    const { displayUploadHistory } = await loadHistory();
    const messages: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((value = '') => {
      messages.push(String(value));
    });

    try {
      await displayUploadHistory(5);
    } finally {
      spy.mockRestore();
    }

    expect(messages.join('\n')).toContain('No upload history found.');
    expect(trackEvent).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        record_count: 0,
        limit: 5,
      }),
    );
  });

  test('displayUploadHistory prefers DNS URLs over PinMe and short URLs', async () => {
    const { saveUploadHistory, displayUploadHistory } = await loadHistory();
    const messages: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((value = '') => {
      messages.push(String(value));
    });

    try {
      saveUploadHistory({
        path: '/tmp/site',
        filename: 'site',
        contentHash: 'bafy-site',
        previewHash: null,
        size: 1024,
        pinmeUrl: 'demo',
        shortUrl: 'short',
        dnsUrl: 'https://docs.example.com/',
      });
      await displayUploadHistory(10);
    } finally {
      spy.mockRestore();
    }

    const output = messages.join('\n');
    expect(output).toContain('URL: https://docs.example.com');
    expect(output).not.toContain('https://demo.pinme.test');
    expect(output).not.toContain('https://short.pinme.test');
  });

  test('getUploadHistory returns an empty list for malformed history files', async () => {
    const { getUploadHistory } = await loadHistory();
    const messages: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((value = '') => {
      messages.push(String(value));
    });

    mkdirSync(path.join(tempHome!, '.pinme'), { recursive: true });
    writeFileSync(
      path.join(tempHome!, '.pinme', 'upload-history.json'),
      '{not json',
    );

    try {
      expect(getUploadHistory()).toEqual([]);
    } finally {
      spy.mockRestore();
    }

    expect(messages.join('\n')).toContain('Error reading upload history:');
  });

  test('save and clear report false when history storage cannot be written', async () => {
    const fsMock = {
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
      readJsonSync: vi.fn(() => ({ uploads: [] })),
      writeJsonSync: vi.fn(() => {
        throw new Error('disk denied');
      }),
    };
    const { saveUploadHistory, clearUploadHistory } = await loadHistory(fsMock);
    const messages: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((value = '') => {
      messages.push(String(value));
    });

    try {
      expect(
        saveUploadHistory({
          path: '/tmp/site',
          contentHash: 'bafy-site',
          previewHash: null,
          size: 1,
        }),
      ).toBe(false);
      expect(clearUploadHistory()).toBe(false);
    } finally {
      spy.mockRestore();
    }

    expect(fsMock.mkdirSync).toHaveBeenCalledWith(expect.any(String), {
      recursive: true,
    });
    expect(messages.join('\n')).toContain('Error saving upload history:');
    expect(messages.join('\n')).toContain('Error clearing upload history:');
    expect(trackEvent).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ action: 'clear', reason: 'disk denied' }),
    );
  });

  test('formatHistoryUrl normalizes blank, absolute, dotted, and bare values', async () => {
    const { formatHistoryUrl } = await loadHistory();

    await expect(formatHistoryUrl()).resolves.toBeNull();
    await expect(formatHistoryUrl('   ')).resolves.toBeNull();
    await expect(formatHistoryUrl('https://example.com/path/')).resolves.toBe(
      'https://example.com/path',
    );
    await expect(formatHistoryUrl('demo.example')).resolves.toBe(
      'https://demo.example',
    );
    await expect(
      formatHistoryUrl('demo', {
        appendRootDomain: true,
        rootDomain: 'pinme.test',
      }),
    ).resolves.toBe('https://demo.pinme.test');
    await expect(
      formatHistoryUrl('http://demo/', {
        appendRootDomain: true,
        rootDomain: 'pinme.test',
      }),
    ).resolves.toBe('http://demo.pinme.test');
    await expect(
      formatHistoryUrl('http://[bad', {
        appendRootDomain: true,
        rootDomain: 'pinme.test',
      }),
    ).resolves.toBe('http://[bad');
  });
});
