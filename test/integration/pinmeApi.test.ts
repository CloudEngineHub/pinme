import { beforeEach, describe, expect, test, vi } from 'vitest';
import nock from 'nock';

async function loadPinmeApi(env: Record<string, string>) {
  vi.resetModules();
  Object.assign(process.env, env);
  return import('../../bin/utils/pinmeApi');
}

describe('pinmeApi', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  test('returns DNS domains as available without an API call', async () => {
    const { checkDomainAvailable } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
    });

    await expect(checkDomainAvailable('example.com')).resolves.toEqual({
      is_valid: true,
    });
    expect(nock.isDone()).toBe(true);
  });

  test('checks PinMe subdomain availability through configured endpoint', async () => {
    const { checkDomainAvailable } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
      PINME_CHECK_DOMAIN_PATH: '/check_domain',
    });
    nock('https://api.pinme.test')
      .post('/check_domain', { domain_name: 'demo' })
      .reply(200, { data: { is_valid: false, error: 'taken' } });

    await expect(checkDomainAvailable('demo')).resolves.toEqual({
      is_valid: false,
      error: 'taken',
    });
  });

  test('defaults subdomain availability to true for unexpected successful shapes', async () => {
    const { checkDomainAvailable } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
      PINME_CHECK_DOMAIN_PATH: '/check_domain',
    });
    nock('https://api.pinme.test')
      .post('/check_domain', { domain_name: 'demo' })
      .reply(200, { code: 200, data: { unexpected: true } });

    await expect(checkDomainAvailable('demo')).resolves.toEqual({
      is_valid: true,
    });
  });

  test('checks top-level domain availability and surfaces recoverable HTTP failures', async () => {
    const { checkDomainAvailable } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
      PINME_CHECK_DOMAIN_PATH: '/check_domain',
    });
    nock('https://api.pinme.test')
      .post('/check_domain', { domain_name: 'direct' })
      .reply(200, { is_valid: false, error: 'reserved' })
      .post('/check_domain', { domain_name: 'missing' })
      .reply(404, { message: 'not found' });

    await expect(checkDomainAvailable('direct')).resolves.toEqual({
      is_valid: false,
      error: 'reserved',
    });
    await expect(checkDomainAvailable('missing')).rejects.toThrow('not found');
  });

  test('caches root domain until force refresh', async () => {
    const { getRootDomain } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
    });
    nock('https://api.pinme.test')
      .get('/root_domain')
      .reply(200, { code: 200, data: { domain: 'first.pinme.test' } })
      .get('/root_domain')
      .reply(200, { code: 200, data: { domain: 'second.pinme.test' } });

    await expect(getRootDomain()).resolves.toBe('first.pinme.test');
    await expect(getRootDomain()).resolves.toBe('first.pinme.test');
    await expect(getRootDomain(true)).resolves.toBe('second.pinme.test');
  });

  test('getRootDomain rejects successful responses without a domain', async () => {
    const { getRootDomain } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
    });
    nock('https://api.pinme.test')
      .get('/root_domain')
      .reply(200, { code: 200, msg: 'domain missing', data: {} });

    await expect(getRootDomain(true)).rejects.toThrow('domain missing');
  });

  test('binds anonymous devices and returns false on token expiration', async () => {
    const { bindAnonymousDevice } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
    });
    nock('https://api.pinme.test')
      .post('/bind_anonymous', { anonymous_uid: 'anon-1' })
      .reply(200, { code: 200 })
      .post('/bind_anonymous', { anonymous_uid: 'anon-2' })
      .reply(401, { message: 'token expired' });

    await expect(bindAnonymousDevice('anon-1')).resolves.toBe(true);
    await expect(bindAnonymousDevice('anon-2')).resolves.toBe(false);
  });

  test('bindAnonymousDevice returns false for non-token failures', async () => {
    const { bindAnonymousDevice } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
    });
    nock('https://api.pinme.test')
      .post('/bind_anonymous', { anonymous_uid: 'anon-fail' })
      .reply(500, { message: 'server exploded' });

    await expect(bindAnonymousDevice('anon-fail')).resolves.toBe(false);
  });

  test('throws token expired for auth failures', async () => {
    const { getMyDomains } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
    });
    nock('https://api.pinme.test')
      .get('/my_domains')
      .reply(401, { message: 'token expired' });

    await expect(getMyDomains()).rejects.toThrow('Token expired');
  });

  test('detects token expiration from business codes and localized messages', async () => {
    const { checkDomainAvailable, getMyDomains } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
      PINME_CHECK_DOMAIN_PATH: '/check_domain',
    });
    nock('https://api.pinme.test')
      .post('/check_domain', { domain_name: 'demo' })
      .reply(200, { code: 10001, msg: '登录已过期' })
      .get('/my_domains')
      .reply(200, { code: 'TOKEN_EXPIRED', msg: 'token expired' });

    await expect(checkDomainAvailable('demo')).rejects.toThrow(
      'Token expired',
    );
    await expect(getMyDomains()).rejects.toThrow('Token expired');
  });

  test('reads domain list variants and returns empty arrays for business failures', async () => {
    const { getMyDomains } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
    });
    nock('https://api.pinme.test')
      .get('/my_domains')
      .reply(200, {
        code: 200,
        data: {
          list: [
            {
              domain_name: 'demo',
              domain_type: 1,
              bind_time: 1,
              expire_time: 2,
            },
          ],
        },
      })
      .get('/my_domains')
      .reply(200, { msg: 'missing code' });

    await expect(getMyDomains()).resolves.toHaveLength(1);
    await expect(getMyDomains()).resolves.toEqual([]);
  });

  test('reads array domain lists and treats business auth codes as expired', async () => {
    const { getMyDomains } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
    });
    nock('https://api.pinme.test')
      .get('/my_domains')
      .reply(200, {
        code: 200,
        data: [
          {
            domain_name: 'array-demo',
            domain_type: 1,
            bind_time: 1,
            expire_time: 2,
          },
        ],
      })
      .get('/my_domains')
      .reply(200, { code: 403, msg: 'auth failed' });

    await expect(getMyDomains()).resolves.toEqual([
      expect.objectContaining({ domain_name: 'array-demo' }),
    ]);
    await expect(getMyDomains()).rejects.toThrow('Token expired');
  });

  test('getMyDomains handles unsupported payloads and both auth business codes', async () => {
    const { getMyDomains } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
    });
    nock('https://api.pinme.test')
      .get('/my_domains')
      .reply(200, { code: 200, data: { list: 'not an array' } })
      .get('/my_domains')
      .reply(200, { code: 401, msg: 'auth failed' });

    await expect(getMyDomains()).resolves.toEqual([]);
    await expect(getMyDomains()).rejects.toThrow('Token expired');
  });

  test('binds DNS domains with auth headers', async () => {
    const { bindDnsDomainV4 } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
    });
    nock('https://api.pinme.test', {
      reqheaders: {
        'x-auth-token': 'token',
        'x-token-address': '0xabc',
      },
    })
      .post('/bind_dns', { domain_name: 'example.com', hash: 'bafy' })
      .reply(200, {
        code: 200,
        msg: 'ok',
        data: { domain_name: 'example.com', hash: 'bafy' },
      });

    await expect(
      bindDnsDomainV4('example.com', 'bafy', '0xabc', 'token'),
    ).resolves.toMatchObject({
      code: 200,
      data: { domain_name: 'example.com' },
    });
  });

  test('binds PinMe subdomains and reports wallet balance and VIP status', async () => {
    const { bindPinmeDomain, getWalletBalance, isVip } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
    });
    nock('https://api.pinme.test')
      .post('/bind_pinme_domain', {
        domain_name: 'demo',
        hash: 'bafy',
        project_name: 'project',
      })
      .reply(200, { code: 200 })
      .get('/pay/wallet/balance')
      .reply(200, {
        code: 200,
        msg: 'ok',
        data: { wallet_balance_usd: 12.5 },
      })
      .get('/is_vip')
      .reply(200, {
        code: 200,
        msg: 'ok',
        data: { is_vip: true },
      });

    await expect(bindPinmeDomain('demo', 'bafy', 'project')).resolves.toBe(true);
    await expect(getWalletBalance('0xabc', 'token')).resolves.toMatchObject({
      data: { wallet_balance_usd: 12.5 },
    });
    await expect(isVip('0xabc', 'token')).resolves.toMatchObject({
      data: { is_vip: true },
    });
  });

  test('bindPinmeDomain returns false for successful responses without code 200', async () => {
    const { bindPinmeDomain } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
    });
    nock('https://api.pinme.test')
      .post('/bind_pinme_domain', {
        domain_name: 'demo',
        hash: 'bafy',
      })
      .reply(200, { msg: 'missing code' })
      .post('/bind_pinme_domain', {
        domain_name: 'project-demo',
        hash: 'bafy-project',
        project_name: 'project',
      })
      .reply(200, { code: 200, msg: 'ok' });

    await expect(bindPinmeDomain('demo', 'bafy')).resolves.toBe(false);
    await expect(
      bindPinmeDomain('project-demo', 'bafy-project', 'project'),
    ).resolves.toBe(true);
  });

  test('sends account auth headers for wallet and VIP requests', async () => {
    const { getWalletBalance, isVip } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
    });
    nock('https://api.pinme.test', {
      reqheaders: {
        'authentication-tokens': 'wallet-token',
        'token-address': '0xwallet',
      },
    })
      .get('/pay/wallet/balance')
      .reply(200, { code: 200, msg: 'ok', data: { wallet_balance_usd: 1 } });
    nock('https://api.pinme.test', {
      reqheaders: {
        'x-auth-token': 'vip-token',
        'x-token-address': '0xvip',
      },
    })
      .get('/is_vip')
      .reply(200, { code: 200, msg: 'ok', data: { is_vip: false } });

    await expect(getWalletBalance('0xwallet', 'wallet-token')).resolves.toEqual(
      {
        code: 200,
        msg: 'ok',
        data: { wallet_balance_usd: 1 },
      },
    );
    await expect(isVip('0xvip', 'vip-token')).resolves.toEqual({
      code: 200,
      msg: 'ok',
      data: { is_vip: false },
    });
  });

  test('surfaces token expiration from bind and account APIs', async () => {
    const { bindPinmeDomain, bindDnsDomainV4, getWalletBalance, isVip } =
      await loadPinmeApi({
        PINME_API_BASE: 'https://api.pinme.test',
      });
    nock('https://api.pinme.test')
      .post('/bind_pinme_domain')
      .reply(403, { message: 'invalid token' })
      .post('/bind_dns')
      .reply(401, { message: 'token expired' })
      .get('/pay/wallet/balance')
      .reply(401, { message: 'unauthorized' })
      .get('/is_vip')
      .reply(401, { message: 'auth failed' });

    await expect(bindPinmeDomain('demo', 'bafy')).rejects.toThrow(
      'Token expired',
    );
    await expect(
      bindDnsDomainV4('example.com', 'bafy', '0xabc', 'token'),
    ).rejects.toThrow('Token expired');
    await expect(getWalletBalance('0xabc', 'token')).rejects.toThrow(
      'Token expired',
    );
    await expect(isVip('0xabc', 'token')).rejects.toThrow('Token expired');
  });

  test('requests CAR export through the CAR API client', async () => {
    const { requestCarExport } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
      CAR_API_BASE: 'https://car.pinme.test',
    });
    nock('https://car.pinme.test')
      .post('/car/export')
      .query({ cid: 'bafy', uid: 'uid-1' })
      .reply(200, {
        code: 200,
        msg: 'ok',
        data: {
          cid: 'bafy',
          status: 'processing',
          task_id: 'task-1',
        },
      });

    await expect(requestCarExport('bafy', 'uid-1')).resolves.toEqual({
      cid: 'bafy',
      status: 'processing',
      task_id: 'task-1',
    });
  });

  test('checks CAR export status and normalizes API failures', async () => {
    const { checkCarExportStatus, requestCarExport } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
      CAR_API_BASE: 'https://car.pinme.test',
    });
    nock('https://car.pinme.test')
      .get('/car/export/status')
      .query({ task_id: 'task-1' })
      .reply(200, {
        code: 200,
        msg: 'ok',
        data: {
          task_id: 'task-1',
          cid: 'bafy',
          status: 'completed',
          download_url: 'https://download.pinme.test/file.car',
        },
      })
      .post('/car/export')
      .query({ cid: 'bad', uid: 'uid-1' })
      .reply(200, { code: 500, msg: 'Export failed' });

    await expect(checkCarExportStatus('task-1')).resolves.toMatchObject({
      status: 'completed',
      download_url: 'https://download.pinme.test/file.car',
    });
    await expect(requestCarExport('bad', 'uid-1')).rejects.toThrow(
      /Failed to request CAR export: Export failed|Export failed/,
    );
  });

  test('rejects CAR success codes that omit payload data', async () => {
    const { checkCarExportStatus, requestCarExport } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
      CAR_API_BASE: 'https://car.pinme.test',
    });
    nock('https://car.pinme.test')
      .post('/car/export')
      .query({ cid: 'empty', uid: 'uid-1' })
      .reply(200, { code: 200, msg: 'missing export data' })
      .get('/car/export/status')
      .query({ task_id: 'empty-task' })
      .reply(200, { code: 200, msg: 'missing status data' });

    await expect(requestCarExport('empty', 'uid-1')).rejects.toThrow(
      /missing export data/,
    );
    await expect(checkCarExportStatus('empty-task')).rejects.toThrow(
      /missing status data/,
    );
  });

  test('normalizes CAR status token expiration and response messages', async () => {
    const { checkCarExportStatus } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
      CAR_API_BASE: 'https://car.pinme.test',
    });
    nock('https://car.pinme.test')
      .get('/car/export/status')
      .query({ task_id: 'expired' })
      .reply(401, { message: 'token expired' })
      .get('/car/export/status')
      .query({ task_id: 'failed' })
      .reply(200, { code: 500, msg: 'Task failed' });

    await expect(checkCarExportStatus('expired')).rejects.toThrow(
      'Token expired',
    );
    await expect(checkCarExportStatus('failed')).rejects.toThrow(
      /Failed to check export status: Task failed|Task failed/,
    );
  });

  test('normalizes CAR HTTP response messages and generic failures', async () => {
    const { checkCarExportStatus, requestCarExport } = await loadPinmeApi({
      PINME_API_BASE: 'https://api.pinme.test',
      CAR_API_BASE: 'https://car.pinme.test',
    });
    nock('https://car.pinme.test')
      .post('/car/export')
      .query({ cid: 'http-fail', uid: 'uid-1' })
      .reply(503, { msg: 'CAR export unavailable' })
      .post('/car/export')
      .query({ cid: 'network-fail', uid: 'uid-1' })
      .replyWithError('socket closed')
      .get('/car/export/status')
      .query({ task_id: 'http-fail' })
      .reply(500, { msg: 'status unavailable' })
      .get('/car/export/status')
      .query({ task_id: 'network-fail' })
      .replyWithError('status socket closed');

    await expect(requestCarExport('http-fail', 'uid-1')).rejects.toThrow(
      'CAR export unavailable',
    );
    await expect(requestCarExport('network-fail', 'uid-1')).rejects.toThrow(
      /Failed to request CAR export: socket closed/,
    );
    await expect(checkCarExportStatus('http-fail')).rejects.toThrow(
      'status unavailable',
    );
    await expect(checkCarExportStatus('network-fail')).rejects.toThrow(
      /Failed to check export status: status socket closed/,
    );
  });
});
