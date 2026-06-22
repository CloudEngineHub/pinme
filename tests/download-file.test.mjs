import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { test } from 'vitest';

async function loadHelper() {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'pinme-download-helper-'));
  const outfile = path.join(tempDir, 'downloadFile.cjs');

  await build({
    entryPoints: [path.resolve('bin/utils/downloadFile.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
  });

  const helper = await import(pathToFileURL(outfile).href);
  return {
    helper,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
}

test('downloadFileWithRetries downloads through Node HTTP without curl', async () => {
  const { helper, cleanup } = await loadHelper();
  const tempDir = mkdtempSync(path.join(tmpdir(), 'pinme-download-target-'));
  const destination = path.join(tempDir, 'template.zip');
  const body = Buffer.alloc(256, 'a');

  try {
    const result = await helper.downloadFileWithRetries('https://example.test/template.zip', destination, {
      attempts: 3,
      retryDelayMs: 1,
      minBytes: 100,
      request: async () => ({ data: Readable.from([body]) }),
    });

    assert.equal(result.attempts, 1);
    assert.equal(result.bytes, body.length);
    assert.deepEqual(readFileSync(destination), body);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    cleanup();
  }
});

test('downloadFileWithRetries retries HTTP failures', async () => {
  const { helper, cleanup } = await loadHelper();
  const tempDir = mkdtempSync(path.join(tmpdir(), 'pinme-download-retry-'));
  const destination = path.join(tempDir, 'template.zip');
  const body = Buffer.alloc(256, 'b');
  let requests = 0;

  try {
    const failures = [];
    const result = await helper.downloadFileWithRetries('https://example.test/template.zip', destination, {
      attempts: 3,
      retryDelayMs: 1,
      minBytes: 100,
      request: async () => {
        requests += 1;

        if (requests < 3) {
          const error = new Error('Request failed with status code 503');
          error.response = {
            status: 503,
            statusText: 'Service Unavailable',
          };
          throw error;
        }

        return { data: Readable.from([body]) };
      },
      onAttemptFailure: (attempt, error) => {
        failures.push({ attempt, message: helper.getDownloadErrorMessage(error) });
      },
    });

    assert.equal(result.attempts, 3);
    assert.equal(requests, 3);
    assert.deepEqual(failures, [
      { attempt: 1, message: 'HTTP 503 Service Unavailable' },
      { attempt: 2, message: 'HTTP 503 Service Unavailable' },
    ]);
    assert.deepEqual(readFileSync(destination), body);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    cleanup();
  }
});

test('downloadFileWithRetries rejects tiny downloads and removes partial files', async () => {
  const { helper, cleanup } = await loadHelper();
  const tempDir = mkdtempSync(path.join(tmpdir(), 'pinme-download-small-'));
  const destination = path.join(tempDir, 'template.zip');

  try {
    await assert.rejects(
      () => helper.downloadFileWithRetries('https://example.test/template.zip', destination, {
        attempts: 2,
        retryDelayMs: 1,
        minBytes: 100,
        request: async () => ({ data: Readable.from(['tiny']) }),
      }),
      /Downloaded file is too small/,
    );

    assert.throws(() => readFileSync(destination), /ENOENT/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    cleanup();
  }
});
