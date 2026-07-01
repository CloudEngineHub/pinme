require('dotenv').config();
const esbuild = require('esbuild');

const define = {};
function stringifyEnvDefine(value) {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

for (const key in process.env) {
  // Skip env vars with invalid identifier characters (e.g., Windows vars like ProgramFiles(x86))
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) {
    define[`process.env.${key}`] = stringifyEnvDefine(process.env[key]);
  }
}

define['process.env.IPFS_PREVIEW_URL'] = stringifyEnvDefine(process.env.IPFS_PREVIEW_URL);
define['process.env.SECRET_KEY'] = stringifyEnvDefine(process.env.SECRET_KEY);

esbuild.build({
  entryPoints: ['bin/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node14',
  format: 'cjs',
  external: Object.keys(require('./package.json').dependencies || {}).filter(dep => dep !== 'axios'),
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
  define,
}).catch(() => process.exit(1)); 
