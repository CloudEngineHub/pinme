import { beforeEach, describe, expect, test, vi } from 'vitest';
import nock from 'nock';

async function loadApiClient(env: Record<string, string> = {}) {
  vi.resetModules();
  vi.doUnmock('../../bin/utils/webLogin');
  process.env.PINME_API_BASE = env.PINME_API_BASE || 'https://api.pinme.test';
  return import('../../bin/utils/apiClient');
}

async function loadApiClientWithAuthMock() {
  vi.resetModules();
  process.env.PINME_API_BASE = 'https://api.pinme.test';
  vi.doMock('../../bin/utils/webLogin', () => ({
    getAuthHeaders: () => ({
      'token-address': '0xabc',
      'authentication-tokens': 'secret-token',
    }),
  }));
  return import('../../bin/utils/apiClient');
}

async function loadApiClientWithThrowingAuthMock() {
  vi.resetModules();
  process.env.PINME_API_BASE = 'https://api.pinme.test';
  vi.doMock('../../bin/utils/webLogin', () => ({
    getAuthHeaders: () => {
      throw new Error('auth config unreadable');
    },
  }));
  return import('../../bin/utils/apiClient');
}

describe('apiClient', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  test('returns successful business responses', async () => {
    const { createPinmeApiClient } = await loadApiClient();
    nock('https://api.pinme.test')
      .get('/root_domain')
      .reply(200, { code: 200, data: { domain: 'pinme.test' } });

    const response = await createPinmeApiClient().get('/root_domain');

    expect(response.data.data.domain).toBe('pinme.test');
    expect(nock.isDone()).toBe(true);
  });

  test('turns non-200 business codes into CliError', async () => {
    const { createPinmeApiClient } = await loadApiClient();
    nock('https://api.pinme.test')
      .post('/bind_pinme_domain')
      .reply(200, { code: 500, msg: 'Domain is taken' });

    await expect(
      createPinmeApiClient().post('/bind_pinme_domain', {
        domain_name: 'demo',
        hash: 'bafy',
      }),
    ).rejects.toMatchObject({
      name: 'CliError',
      stage: 'API request',
      message: 'Domain is taken',
      details: ['Request: POST /bind_pinme_domain', 'Business code: 500'],
    });
  });

  test('wraps HTTP failures with request context', async () => {
    const { createPinmeApiClient } = await loadApiClient();
    nock('https://api.pinme.test')
      .get('/my_domains')
      .reply(503, { message: 'Temporarily unavailable' });

    await expect(createPinmeApiClient().get('/my_domains')).rejects.toMatchObject(
      {
        name: 'CliError',
        stage: 'API request',
        message: 'Temporarily unavailable',
        details: ['Request: GET /my_domains', 'HTTP status: 503'],
      },
    );
  });

  test('injects auth headers from local auth config by default', async () => {
    const { createPinmeApiClient } = await loadApiClientWithAuthMock();
    let capturedHeaders: Record<string, string | string[] | undefined> = {};
    nock('https://api.pinme.test')
      .get('/my_domains')
      .reply(function () {
        capturedHeaders = this.req.headers;
        return [200, { code: 200, data: [] }];
      });

    await expect(createPinmeApiClient().get('/my_domains')).resolves.toMatchObject(
      {
        data: { code: 200, data: [] },
      },
    );
    expect(capturedHeaders['token-address']).toBe('0xabc');
    expect(capturedHeaders['authentication-tokens']).toBe('secret-token');
  });

  test('omits auth headers when includeAuth is false', async () => {
    const { createPinmeApiClient } = await loadApiClientWithAuthMock();
    nock('https://api.pinme.test', {
      badheaders: ['token-address', 'authentication-tokens'],
    })
      .get('/public')
      .reply(200, { ok: true });

    const response = await createPinmeApiClient({ includeAuth: false }).get(
      '/public',
    );

    expect(response.data).toEqual({ ok: true });
  });

  test('merges custom headers over defaults', async () => {
    const { createPinmeApiClient } = await loadApiClient();
    nock('https://api.pinme.test', {
      reqheaders: {
        'user-agent': 'Custom-Agent',
        'x-test-suite': 'api-client',
      },
    })
      .get('/headers')
      .reply(200, { ok: true });

    await createPinmeApiClient({
      includeAuth: false,
      headers: {
        'User-Agent': 'Custom-Agent',
        'X-Test-Suite': 'api-client',
      },
    }).get('/headers');

    expect(nock.isDone()).toBe(true);
  });

  test('sends default JSON CLI headers', async () => {
    const { createPinmeApiClient } = await loadApiClient();
    let capturedHeaders: Record<string, string | string[] | undefined> = {};
    nock('https://api.pinme.test')
      .get('/headers')
      .reply(function () {
        capturedHeaders = this.req.headers;
        return [200, { ok: true }];
      });

    await createPinmeApiClient({ includeAuth: false }).get('/headers');

    expect(capturedHeaders.accept).toBe('*/*');
    expect(capturedHeaders['content-type']).toBe('application/json');
    expect(capturedHeaders['user-agent']).toBe('Pinme-CLI');
    expect(capturedHeaders.connection).toBe('keep-alive');
  });

  test('continues without auth headers when local auth config is unreadable', async () => {
    const { createPinmeApiClient } = await loadApiClientWithThrowingAuthMock();
    nock('https://api.pinme.test', {
      badheaders: ['token-address', 'authentication-tokens'],
    })
      .get('/public')
      .reply(200, { ok: true });

    await expect(createPinmeApiClient().get('/public')).resolves.toMatchObject({
      data: { ok: true },
    });
  });

  test('does not treat non-object response bodies as business errors', async () => {
    const { createPinmeApiClient } = await loadApiClient();
    nock('https://api.pinme.test').get('/plain').reply(200, 'code 500');

    const response = await createPinmeApiClient({ includeAuth: false }).get(
      '/plain',
    );

    expect(response.data).toBe('code 500');
  });

  test('omits request context when axios config has no URL', async () => {
    const { createApiClient } = await loadApiClient();
    const client = createApiClient({
      includeAuth: false,
      baseURL: 'https://api.pinme.test',
    });

    await expect(
      client.request({
        adapter: async (config) => ({
          data: { code: 500, msg: 'Adapter business failure' },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }),
      }),
    ).rejects.toMatchObject({
      message: 'Adapter business failure',
      details: ['Business code: 500'],
    });
  });

  test('uses GET as the default request descriptor method', async () => {
    const { createApiClient } = await loadApiClient();
    const client = createApiClient({
      includeAuth: false,
      baseURL: 'https://api.pinme.test',
    });

    await expect(
      client.request({
        url: '/adapter-default-method',
        adapter: async (config) => ({
          data: { code: 500, msg: 'Adapter business failure' },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }),
      }),
    ).rejects.toMatchObject({
      message: 'Adapter business failure',
      details: [
        'Request: GET /adapter-default-method',
        'Business code: 500',
      ],
    });
  });
});
