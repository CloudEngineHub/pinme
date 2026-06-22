import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { test } from 'vitest';

async function loadHelper() {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'pinme-worker-metadata-'));
  const outfile = path.join(tempDir, 'workerMetadata.cjs');

  await build({
    entryPoints: [path.resolve('bin/utils/workerMetadata.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
  });

  return import(pathToFileURL(outfile).href);
}

function validMetadata(projectName = 'demo-project') {
  return JSON.stringify({
    main_module: 'worker.js',
    project_name: projectName,
    bindings: [
      {
        type: 'secret_text',
        name: 'API_KEY',
        text: 'real-api-key',
      },
      {
        type: 'plain_text',
        name: 'PROJECT_NAME',
        text: projectName,
      },
    ],
    compatibility_date: '2024-01-01',
  });
}

test('validateWorkerMetadataForCreate accepts platform metadata', async () => {
  const { validateWorkerMetadataForCreate } = await loadHelper();

  assert.doesNotThrow(() => {
    validateWorkerMetadataForCreate(validMetadata(), 'demo-project');
  });
});

test('validateWorkerMetadataForCreate rejects template placeholder metadata', async () => {
  const { validateWorkerMetadataForCreate } = await loadHelper();
  const templateMetadata = JSON.stringify({
    api_key: 'xxx',
    main_module: 'worker.js',
    project_name: 'project_name',
    compatibility_date: '2024-01-01',
    bindings: [
      {
        type: 'secret_text',
        name: 'API_KEY',
        text: 'xxx',
      },
    ],
  });

  assert.throws(
    () => validateWorkerMetadataForCreate(templateMetadata, 'demo-project'),
    /real API_KEY binding/,
  );
});

test('validateWorkerMetadataForCreate rejects flagged API_KEY placeholder', async () => {
  const { validateWorkerMetadataForCreate } = await loadHelper();
  const metadata = JSON.stringify({
    main_module: 'worker.js',
    project_name: 'demo-project',
    bindings: [
      {
        type: 'secret_text',
        name: 'API_KEY',
        text: '__PINME_API_KEY__',
      },
      {
        type: 'plain_text',
        name: 'PROJECT_NAME',
        text: 'demo-project',
      },
    ],
  });

  assert.throws(
    () => validateWorkerMetadataForCreate(metadata, 'demo-project'),
    /real API_KEY binding/,
  );
});

test('validateWorkerMetadataForCreate requires matching PROJECT_NAME binding', async () => {
  const { validateWorkerMetadataForCreate } = await loadHelper();
  const metadata = JSON.stringify({
    main_module: 'worker.js',
    project_name: 'demo-project',
    bindings: [
      {
        type: 'secret_text',
        name: 'API_KEY',
        text: 'real-api-key',
      },
    ],
  });

  assert.throws(
    () => validateWorkerMetadataForCreate(metadata, 'demo-project'),
    /PROJECT_NAME binding/,
  );
});

test('validateWorkerMetadataForCreate rejects invalid JSON', async () => {
  const { validateWorkerMetadataForCreate } = await loadHelper();

  assert.throws(
    () => validateWorkerMetadataForCreate('{not json', 'demo-project'),
    /valid JSON/,
  );
});
