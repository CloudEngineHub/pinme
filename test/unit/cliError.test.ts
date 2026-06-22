import { describe, expect, test, vi } from 'vitest';
import {
  CliError,
  createApiError,
  createConfigError,
  createCommandError,
  normalizeCliError,
  printCliError,
  printRechargeUrl,
} from '../../bin/utils/cliError';

describe('cliError', () => {
  test('CliError constructor defaults details and suggestions', () => {
    const cause = new Error('root cause');
    const error = new CliError({
      summary: 'Plain failure.',
      cause,
    });

    expect(error.message).toBe('Plain failure.');
    expect(error.name).toBe('CliError');
    expect(error.stage).toBeUndefined();
    expect(error.details).toEqual([]);
    expect(error.suggestions).toEqual([]);
    expect(error.cause).toBe(cause);
  });

  test('normalizes API business errors with request context', () => {
    const error = createApiError(
      'API request',
      {
        response: {
          data: {
            code: 40001,
            msg: 'Insufficient wallet balance',
          },
        },
      },
      ['Request: POST /bind_dns'],
    );

    expect(error).toBeInstanceOf(CliError);
    expect(error.message).toBe('Insufficient wallet balance');
    expect(error.details).toContain('Request: POST /bind_dns');
    expect(error.details).toContain('Business code: 40001');
    expect(error.details.join('\n')).toMatch(/Recharge URL:/);
  });

  test('prefers nested API messages in documented order', () => {
    expect(
      createApiError('API request', {
        response: {
          data: {
            data: {
              message: 'Nested message',
              error: 'Nested error',
            },
            errors: [{ message: 'Array message' }],
            error: 'Top-level error',
          },
        },
      }).message,
    ).toBe('Nested message');

    expect(
      createApiError('API request', {
        response: {
          data: {
            errors: [{ message: 'Array message' }],
            error: 'Top-level error',
          },
        },
      }).message,
    ).toBe('Array message');
  });

  test('normalizes HTTP errors without business code', () => {
    const error = createApiError('API request', {
      response: {
        status: 503,
        data: { message: 'Service unavailable' },
      },
      message: 'Request failed with status code 503',
    });

    expect(error.message).toBe('Service unavailable');
    expect(error.details).toContain('HTTP status: 503');
    expect(error.details.join('\n')).not.toMatch(/Reason:/);
  });

  test('creates command errors with exit metadata', () => {
    const error = createCommandError(
      'frontend build',
      'npm run build:web',
      {
        status: 127,
        message: 'vite: command not found',
      },
      ['Run npm install'],
    );

    expect(error.details).toEqual([
      'Command: npm run build:web',
      'Exit code: 127',
      'Reason: vite: command not found',
    ]);
    expect(error.suggestions).toEqual(['Run npm install']);
  });

  test('creates command errors with code and signal metadata without suggestions', () => {
    const error = createCommandError('worker deploy', 'wrangler deploy', {
      code: 1,
      signal: 'SIGTERM',
    });

    expect(error.message).toBe('worker deploy failed.');
    expect(error.details).toEqual([
      'Command: wrangler deploy',
      'Exit code: 1',
      'Signal: SIGTERM',
    ]);
    expect(error.suggestions).toEqual([]);
  });

  test('normalizes unknown thrown values', () => {
    const error = normalizeCliError({ raw: true }, 'Fallback failed.');

    expect(error.message).toBe('Fallback failed.');
    expect(error.details).toEqual(['Raw error: {"raw":true}']);
  });

  test('normalizes null and primitive thrown values', () => {
    expect(normalizeCliError(undefined, 'Fallback failed.').details).toEqual([
      'Raw error: ',
    ]);
    expect(normalizeCliError(null, 'Fallback failed.').details).toEqual([
      'Raw error: ',
    ]);
    expect(normalizeCliError('plain failure', 'Fallback failed.').details).toEqual(
      ['Raw error: plain failure'],
    );
  });

  test('normalizes circular thrown values through string fallback', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const error = normalizeCliError(circular, 'Fallback failed.');

    expect(error.details).toEqual(['Raw error: [object Object]']);
  });

  test('returns existing CliError instances unchanged', () => {
    const original = createConfigError('Missing config.', ['Create pinme.toml']);

    expect(normalizeCliError(original, 'Fallback failed.')).toBe(original);
  });

  test('normalizes regular Error instances with deduped suggestions', () => {
    const error = normalizeCliError(new Error('Boom'), 'Fallback failed.', [
      'Retry',
      'Retry',
    ]);

    expect(error.message).toBe('Boom');
    expect(error.suggestions).toEqual(['Retry']);
  });

  test('normalizes Error instances with empty messages to the fallback summary', () => {
    const error = normalizeCliError(new Error(''), 'Fallback failed.');

    expect(error.message).toBe('Fallback failed.');
  });

  test('normalizes API-shaped thrown objects', () => {
    const error = normalizeCliError(
      {
        config: { method: 'get', url: '/wallet' },
        response: {
          data: {
            data: {
              error: 'Nested API failure',
            },
          },
        },
      },
      'Fallback failed.',
    );

    expect(error.message).toBe('Nested API failure');
    expect(error.stage).toBe('API request');
  });

  test('includes non-Axios error code when response data is absent', () => {
    const error = createApiError('API request', {
      code: 'ECONNRESET',
      message: 'socket hang up',
    });

    expect(error.details).toContain('Error code: ECONNRESET');
    expect(error.details).not.toContain('Reason: socket hang up');
  });

  test('uses string response data as summary', () => {
    const error = createApiError('API request', {
      response: {
        status: 502,
        data: 'Bad gateway',
      },
    });

    expect(error.message).toBe('Bad gateway');
    expect(error.details).toContain('HTTP status: 502');
  });

  test('includes nested API detail when it differs from the summary', () => {
    const error = createApiError('API request', {
      response: {
        status: 400,
        data: {
          message: 'Top-level summary',
          data: {
            error: 'Nested detail',
          },
        },
      },
      message: 'Request failed with status code 400',
    });

    expect(error.message).toBe('Top-level summary');
    expect(error.details).toContain('HTTP status: 400');
    expect(error.details).toContain('Error detail: Nested detail');
    expect(error.details).not.toContain(
      'Reason: Request failed with status code 400',
    );
  });

  test('falls back to the API stage when no response message exists', () => {
    const error = createApiError('wallet lookup', {});

    expect(error.message).toBe('wallet lookup failed.');
    expect(error.stage).toBe('wallet lookup');
    expect(error.details).toEqual([]);
  });

  test('includes raw reasons for non-generic API failures', () => {
    const error = createApiError('API request', {
      response: {
        status: 502,
        data: { error: 'Gateway wrapper failed' },
      },
      message: 'socket hang up',
    });

    expect(error.message).toBe('Gateway wrapper failed');
    expect(error.details).toContain('HTTP status: 502');
    expect(error.details).toContain('Reason: socket hang up');
  });

  test('includes stringified business messages when they differ from summary', () => {
    const error = createApiError('API request', {
      response: {
        data: {
          code: 409,
          msg: 123,
        },
      },
    });

    expect(error.message).toBe('123');
    expect(error.details).toContain('Business code: 409');
    expect(error.details).toContain('Business message: 123');
  });

  test('printRechargeUrl writes to stdout by default', () => {
    const messages: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((value = '') => {
      messages.push(String(value));
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      printRechargeUrl('https://wallet.pinme.test');
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }

    expect(messages.join('\n')).toContain('Recharge URL:');
    expect(messages.join('\n')).toContain('https://wallet.pinme.test');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('printCliError writes structured details and suggestions', () => {
    const originalError = createConfigError('Missing config.', [
      'Run pinme create app',
    ]);
    originalError.details = ['Project root: /tmp/app'];
    const messages: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((value = '') => {
      messages.push(String(value));
    });

    try {
      printCliError(originalError, 'Fallback failed.');
    } finally {
      spy.mockRestore();
    }

    expect(messages.join('\n')).toContain('Error: Missing config.');
    expect(messages.join('\n')).toContain('Stage: configuration');
    expect(messages.join('\n')).toContain('Project root: /tmp/app');
    expect(messages.join('\n')).toContain('Run pinme create app');
  });

  test('printCliError prints recharge URLs through the highlighted branch', () => {
    const error = createConfigError('Needs funds.');
    error.details = ['Recharge URL: https://wallet.pinme.test'];
    const messages: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((value = '') => {
      messages.push(String(value));
    });

    try {
      printCliError(error, 'Fallback failed.');
    } finally {
      spy.mockRestore();
    }

    expect(messages.join('\n')).toContain('Recharge URL:');
    expect(messages.join('\n')).toContain('https://wallet.pinme.test');
  });

  test('printCliError skips next steps when suggestions are empty', () => {
    const messages: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((value = '') => {
      messages.push(String(value));
    });

    try {
      printCliError(createConfigError('No suggestions.'), 'Fallback failed.');
    } finally {
      spy.mockRestore();
    }

    expect(messages.join('\n')).not.toContain('Next steps:');
  });
});
