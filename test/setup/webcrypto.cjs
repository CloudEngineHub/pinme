const nodeCrypto = require('crypto');
const { webcrypto } = nodeCrypto;

if (typeof globalThis.crypto?.getRandomValues !== 'function') {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
}

if (typeof nodeCrypto.getRandomValues !== 'function') {
  nodeCrypto.getRandomValues = webcrypto.getRandomValues.bind(webcrypto);
}

if (typeof globalThis.ReadableStream !== 'function') {
  const webStreams = require('stream/web');

  for (const name of ['ReadableStream', 'WritableStream', 'TransformStream']) {
    if (
      typeof globalThis[name] !== 'function' &&
      typeof webStreams[name] === 'function'
    ) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        value: webStreams[name],
      });
    }
  }
}
