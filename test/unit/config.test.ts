import { afterEach, describe, expect, test, vi } from 'vitest';

const ENV_KEYS = [
  'PINME_API_BASE',
  'IPFS_API_URL',
  'CAR_API_BASE',
  'PINME_WEB_URL',
  'MAX_RETRIES',
  'RETRY_DELAY_MS',
  'TIMEOUT_MS',
  'MAX_POLL_TIME_MINUTES',
  'POLL_INTERVAL_SECONDS',
  'POLL_TIMEOUT_SECONDS',
];

async function loadConfig(env: Record<string, string | undefined> = {}) {
  vi.resetModules();

  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  Object.assign(process.env, env);

  return import('../../bin/utils/config');
}

describe('config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('trims trailing slashes from configured base URLs', async () => {
    const { APP_CONFIG, getPinmeApiUrl, getIpfsApiUrl, getCarApiUrl } =
      await loadConfig({
        PINME_API_BASE: 'https://api.pinme.test///',
        IPFS_API_URL: 'https://ipfs.pinme.test/',
        CAR_API_BASE: 'https://car.pinme.test/',
      });

    expect(APP_CONFIG.pinmeApiBase).toBe('https://api.pinme.test');
    expect(getPinmeApiUrl('root_domain')).toBe(
      'https://api.pinme.test/root_domain',
    );
    expect(getIpfsApiUrl('/upload')).toBe('https://ipfs.pinme.test/upload');
    expect(getCarApiUrl('car/export')).toBe(
      'https://car.pinme.test/car/export',
    );
  });

  test('falls back when numeric environment values are invalid', async () => {
    const { APP_CONFIG } = await loadConfig({
      MAX_RETRIES: 'not-a-number',
      RETRY_DELAY_MS: '25',
      MAX_POLL_TIME_MINUTES: '2',
      POLL_INTERVAL_SECONDS: '3',
      POLL_TIMEOUT_SECONDS: '4',
    });

    expect(APP_CONFIG.upload.maxRetries).toBe(2);
    expect(APP_CONFIG.upload.retryDelayMs).toBe(25);
    expect(APP_CONFIG.upload.maxPollTimeMs).toBe(120000);
    expect(APP_CONFIG.upload.pollIntervalMs).toBe(3000);
    expect(APP_CONFIG.upload.pollTimeoutMs).toBe(4000);
  });

  test('selects test wallet recharge URL for test-like API bases', async () => {
    const { getWalletRechargeUrl } = await loadConfig({
      IPFS_API_URL: 'https://test-pinme.example/api',
    });

    expect(getWalletRechargeUrl()).toContain('test-pinme');
  });

  test('selects production wallet recharge URL by default', async () => {
    const { getWalletRechargeUrl } = await loadConfig({
      IPFS_API_URL: 'https://prod.example/api',
    });

    expect(getWalletRechargeUrl()).toContain('pinme.eth.limo');
  });
});
