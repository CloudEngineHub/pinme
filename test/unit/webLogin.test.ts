import fs from 'fs-extra';
import { mkdtempSync, rmSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, test, vi } from 'vitest';

let tempHome: string | undefined;
let originalHome: string | undefined;

async function loadWebLogin() {
  vi.resetModules();
  tempHome = mkdtempSync(path.join(tmpdir(), 'pinme-web-login-home-'));
  originalHome = process.env.HOME;
  process.env.HOME = tempHome;
  vi.doMock('os', () => ({
    homedir: () => tempHome,
    default: {
      homedir: () => tempHome,
    },
  }));
  vi.doMock('node:os', () => ({
    homedir: () => tempHome,
    default: {
      homedir: () => tempHome,
    },
  }));
  return import('../../bin/utils/webLogin');
}

describe('webLogin', () => {
  afterEach(() => {
    vi.doUnmock('os');
    vi.doUnmock('node:os');
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    originalHome = undefined;
    if (tempHome) {
      rmSync(tempHome, { recursive: true, force: true });
      tempHome = undefined;
    }
  });

  test('stores and reads auth tokens with auth headers', async () => {
    const { setAuthToken, getAuthConfig, getAuthHeaders } = await loadWebLogin();

    expect(setAuthToken('0xabc-jwt-token')).toEqual({
      address: '0xabc',
      token: 'jwt-token',
    });
    expect(getAuthConfig()).toEqual({
      address: '0xabc',
      token: 'jwt-token',
    });
    expect(getAuthHeaders()).toEqual({
      'token-address': '0xabc',
      'authentication-tokens': 'jwt-token',
    });

    expect(getAuthConfig()).toMatchObject({ address: '0xabc' });
  });

  test('trims address and token content before storing auth', async () => {
    const { setAuthToken, getAuthConfig, getAuthHeaders } = await loadWebLogin();

    expect(setAuthToken(' 0xabc - jwt-token ')).toEqual({
      address: '0xabc',
      token: 'jwt-token',
    });
    expect(getAuthConfig()).toEqual({
      address: '0xabc',
      token: 'jwt-token',
    });
    expect(getAuthHeaders()).toEqual({
      'token-address': '0xabc',
      'authentication-tokens': 'jwt-token',
    });
  });

  test('rejects malformed combined auth tokens', async () => {
    const { setAuthToken } = await loadWebLogin();

    expect(() => setAuthToken('-jwt-token')).toThrow(
      /Address or token is empty|Invalid token/,
    );
    expect(() => setAuthToken('0xabc-')).toThrow(/Invalid token format/);
    expect(() => setAuthToken('missingdash')).toThrow(/Invalid token format/);
    expect(() => setAuthToken('   -jwt-token')).toThrow(
      'Invalid token content. Address or token is empty.',
    );
    expect(() => setAuthToken('0xabc-   ')).toThrow(
      'Invalid token content. Address or token is empty.',
    );
  });

  test('clears auth tokens and makes headers unavailable', async () => {
    const { setAuthToken, clearAuthToken, getAuthConfig, getAuthHeaders } =
      await loadWebLogin();

    setAuthToken('0xabc-jwt-token');
    clearAuthToken();

    expect(getAuthConfig()).toBeNull();
    expect(() => getAuthHeaders()).toThrow('Auth not set. Run: pinme login');
  });

  test('getAuthConfig returns null for malformed or incomplete auth files', async () => {
    const { getAuthConfig } = await loadWebLogin();
    const authDir = path.join(tempHome!, '.pinme');
    const authFile = path.join(authDir, 'auth.json');
    fs.ensureDirSync(authDir);

    fs.writeJsonSync(authFile, { address: '0xabc' });
    expect(getAuthConfig()).toBeNull();

    fs.writeFileSync(authFile, '{bad');
    expect(getAuthConfig()).toBeNull();
  });

  test('login delegates to the singleton web login manager', async () => {
    const { login, webLoginManager } = await loadWebLogin();
    const authConfig = { address: '0xabc', token: 'jwt-token' };
    const spy = vi
      .spyOn(webLoginManager, 'login')
      .mockResolvedValue(authConfig);

    try {
      await expect(login()).resolves.toBe(authConfig);
    } finally {
      spy.mockRestore();
    }
  });

  test('logout clears auth and reports success', async () => {
    const { setAuthToken, logout, getAuthConfig } = await loadWebLogin();
    const messages: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((value = '') => {
      messages.push(String(value));
    });

    try {
      setAuthToken('0xabc-jwt-token');
      await logout();
    } finally {
      spy.mockRestore();
    }

    expect(getAuthConfig()).toBeNull();
    expect(messages.join('\n')).toContain('Logged out successfully');
  });
});
