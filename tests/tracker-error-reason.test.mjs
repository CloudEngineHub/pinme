import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { test } from 'vitest';

async function loadHelper() {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'pinme-tracker-helper-'));
  const outfile = path.join(tempDir, 'tracker.cjs');

  await build({
    entryPoints: [path.resolve('bin/utils/tracker.ts')],
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

test('getTrackErrorReason normalizes HTML API responses', async () => {
  const { helper, cleanup } = await loadHelper();

  try {
    assert.equal(
      helper.getTrackErrorReason({
        response: {
          status: 502,
          data: '<!DOCTYPE html><html><body>Bad Gateway</body></html>',
        },
        message: 'Request failed with status code 502',
      }),
      'api_returned_html',
    );
  } finally {
    cleanup();
  }
});

test('getTrackErrorReason normalizes gateway status failures', async () => {
  const { helper, cleanup } = await loadHelper();

  try {
    assert.equal(
      helper.getTrackErrorReason(new Error('Request failed with status code 520')),
      'gateway_520',
    );
  } finally {
    cleanup();
  }
});

test('getTrackErrorReason prefers nested cause over command wrapper messages', async () => {
  const { helper, cleanup } = await loadHelper();

  try {
    const htmlError = {
      response: {
        status: 520,
        data: '<html>edge error</html>',
      },
      message: 'Request failed with status code 520',
    };
    const wrappedError = new Error('frontend deploy failed.');
    wrappedError.cause = htmlError;

    assert.equal(
      helper.getTrackErrorReason(wrappedError),
      'api_returned_html',
    );
  } finally {
    cleanup();
  }
});

test('getTrackErrorReason normalizes authentication failures', async () => {
  const { helper, cleanup } = await loadHelper();

  try {
    assert.equal(
      helper.getTrackErrorReason(new Error('Token authentication failed')),
      'token_auth_failed',
    );
  } finally {
    cleanup();
  }
});
