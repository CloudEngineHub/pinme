import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { test } from 'vitest';

async function loadHelper() {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'pinme-prebuilt-helper-'));
  const outfile = path.join(tempDir, 'prebuiltDistConfig.cjs');

  await build({
    entryPoints: [path.resolve('bin/utils/prebuiltDistConfig.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
  });

  return import(pathToFileURL(outfile).href);
}

function makeDist(files) {
  const distDir = mkdtempSync(path.join(tmpdir(), 'pinme-dist-'));

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(distDir, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }

  return distDir;
}

test('patchPrebuiltFrontendDist replaces API and auth placeholders', async () => {
  const { patchPrebuiltFrontendDist } = await loadHelper();
  const distDir = makeDist({
    'index.html': '<script src="/assets/index.js"></script>',
    'assets/index.js': [
      'const api="__PINME_VITE_API_URL__";',
      'const key="__PINME_AUTH_API_KEY__";',
      'const domain="__PINME_AUTH_DOMAIN__";',
      'const project="__PINME_AUTH_PROJECT_ID__";',
      'const tenant="__PINME_TENANT_ID__";',
    ].join('\n'),
  });

  try {
    const result = patchPrebuiltFrontendDist(distDir, {
      api_domain: 'https://demo.pinme.pro',
      public_client_config: {
        auth_api_key: 'firebase-key',
        auth_domain: 'demo.firebaseapp.com',
        auth_project_id: 'firebase-project',
        tenant_id: 'tenant-123',
      },
    });

    const bundle = readFileSync(path.join(distDir, 'assets/index.js'), 'utf8');
    assert.equal(result.apiUrlReplacements, 1);
    assert.equal(result.authReplacements, 4);
    assert.match(bundle, /https:\/\/demo\.pinme\.pro/);
    assert.match(bundle, /firebase-key/);
    assert.match(bundle, /demo\.firebaseapp\.com/);
    assert.match(bundle, /firebase-project/);
    assert.match(bundle, /tenant-123/);
    assert.doesNotMatch(bundle, /__PINME_/);
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});

test('patchPrebuiltFrontendDist clears auth placeholders when auth config is absent', async () => {
  const { patchPrebuiltFrontendDist } = await loadHelper();
  const distDir = makeDist({
    'assets/index.js': [
      'const api="__PINME_VITE_API_URL__";',
      'const key="__PINME_AUTH_API_KEY__";',
      'const domain="__PINME_AUTH_DOMAIN__";',
    ].join('\n'),
  });

  try {
    const result = patchPrebuiltFrontendDist(distDir, {
      api_domain: 'https://demo.pinme.pro',
    });

    const bundle = readFileSync(path.join(distDir, 'assets/index.js'), 'utf8');
    assert.equal(result.apiUrlReplacements, 1);
    assert.equal(result.authReplacements, 2);
    assert.equal(
      bundle,
      [
        'const api="https://demo.pinme.pro";',
        'const key="";',
        'const domain="";',
      ].join('\n'),
    );
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});

test('patchPrebuiltFrontendDist fails when API placeholder is missing', async () => {
  const { patchPrebuiltFrontendDist } = await loadHelper();
  const distDir = makeDist({
    'assets/index.js': 'const key="__PINME_AUTH_API_KEY__";',
  });

  try {
    assert.throws(
      () => patchPrebuiltFrontendDist(distDir, {
        api_domain: 'https://demo.pinme.pro',
      }),
      /missing required Pinme config placeholder/,
    );
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});

test('patchPrebuiltFrontendDist skips unsupported files', async () => {
  const { patchPrebuiltFrontendDist } = await loadHelper();
  const distDir = makeDist({
    'assets/index.js': 'const api="__PINME_VITE_API_URL__";',
    'assets/logo.svg': '<svg>__PINME_VITE_API_URL__</svg>',
  });

  try {
    patchPrebuiltFrontendDist(distDir, {
      api_domain: 'https://demo.pinme.pro',
    });
    assert.equal(
      readFileSync(path.join(distDir, 'assets/logo.svg'), 'utf8'),
      '<svg>__PINME_VITE_API_URL__</svg>',
    );
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});
