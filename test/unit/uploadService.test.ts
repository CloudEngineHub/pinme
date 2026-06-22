import { beforeEach, describe, expect, test, vi } from 'vitest';

const uploadToIpfsSplit = vi.fn();
const getAuthConfig = vi.fn();
const getRootDomain = vi.fn(async () => 'pinme.test');
const getUid = vi.fn(() => 'device-uid');

vi.mock('../../bin/utils/uploadToIpfsSplit', () => ({
  default: uploadToIpfsSplit,
}));

vi.mock('../../bin/utils/webLogin', () => ({
  getAuthConfig,
}));

vi.mock('../../bin/utils/pinmeApi', () => ({
  getRootDomain,
}));

vi.mock('../../bin/utils/getDeviceId', () => ({
  getUid,
}));

async function loadService(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  process.env.IPFS_PREVIEW_URL =
    env.IPFS_PREVIEW_URL || 'https://preview.pinme.test/#/preview/';
  process.env.PROJECT_PREVIEW_URL =
    env.PROJECT_PREVIEW_URL || 'https://project.pinme.test/';
  if ('SECRET_KEY' in env) {
    if (env.SECRET_KEY === undefined) {
      delete process.env.SECRET_KEY;
    } else {
      process.env.SECRET_KEY = env.SECRET_KEY;
    }
  } else {
    delete process.env.SECRET_KEY;
  }
  return import('../../bin/services/uploadService');
}

describe('uploadService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.doUnmock('crypto-js');
    getRootDomain.mockResolvedValue('pinme.test');
    getUid.mockReturnValue('device-uid');
  });

  test('prefers DNS URL over PinMe, short, and management URLs', async () => {
    const { resolveUploadUrls } = await loadService();

    const result = await resolveUploadUrls(
      'bafybeicid',
      {
        dnsUrl: 'example.com/',
        pinmeUrl: 'my-site',
        shortUrl: 'short',
      },
      undefined,
      'uid-1',
    );

    expect(result).toEqual({
      publicUrl: 'https://example.com',
      managementUrl: 'https://preview.pinme.test/#/preview/bafybeicid',
    });
  });

  test('appends root domain for bare PinMe subdomains', async () => {
    const { resolveUploadUrls } = await loadService();

    await expect(
      resolveUploadUrls('bafybeicid', { pinmeUrl: 'demo' }, undefined, 'uid-1'),
    ).resolves.toMatchObject({
      publicUrl: 'https://demo.pinme.test',
    });
  });

  test('keeps absolute and dotted short URLs without root-domain lookup', async () => {
    const { resolveUploadUrls } = await loadService();

    await expect(
      resolveUploadUrls(
        'bafybeicid',
        { shortUrl: 'https://already.example/path/' },
        undefined,
        'uid-1',
      ),
    ).resolves.toMatchObject({
      publicUrl: 'https://already.example/path/',
    });

    await expect(
      resolveUploadUrls(
        'bafybeicid',
        { shortUrl: 'http://already.example/path/' },
        undefined,
        'uid-1',
      ),
    ).resolves.toMatchObject({
      publicUrl: 'http://already.example/path/',
    });

    await expect(
      resolveUploadUrls(
        'bafybeicid',
        { shortUrl: 'short.example' },
        undefined,
        'uid-1',
      ),
    ).resolves.toMatchObject({
      publicUrl: 'https://short.example',
    });

    await expect(
      resolveUploadUrls(
        'bafybeicid',
        { shortUrl: 'xhttp://short.example/' },
        undefined,
        'uid-1',
      ),
    ).resolves.toMatchObject({
      publicUrl: 'https://xhttp://short.example/',
    });
  });

  test('accepts http PinMe URLs and preserves explicit protocol', async () => {
    const { resolveUploadUrls } = await loadService();

    await expect(
      resolveUploadUrls(
        'bafybeicid',
        { pinmeUrl: 'http://demo.pinme.test/path/' },
        undefined,
        'uid-1',
      ),
    ).resolves.toMatchObject({
      publicUrl: 'http://demo.pinme.test/path',
    });
  });

  test('falls back to protocol-prefixed text for invalid preferred URLs', async () => {
    const { resolveUploadUrls } = await loadService();

    await expect(
      resolveUploadUrls(
        'bafybeicid',
        { dnsUrl: 'bad host/' },
        undefined,
        'uid-1',
      ),
    ).resolves.toMatchObject({
      publicUrl: 'https://bad host',
    });
  });

  test('does not treat embedded protocol text as an absolute preferred URL', async () => {
    const { resolveUploadUrls } = await loadService();

    await expect(
      resolveUploadUrls(
        'bafybeicid',
        { dnsUrl: 'xhttp://example.com/' },
        undefined,
        'uid-1',
      ),
    ).resolves.toMatchObject({
      publicUrl: 'https://xhttp//example.com',
    });
  });

  test('falls back to bare subdomain when root domain lookup fails', async () => {
    const { resolveUploadUrls } = await loadService();
    getRootDomain.mockRejectedValueOnce(new Error('root domain failed'));

    await expect(
      resolveUploadUrls('bafybeicid', { pinmeUrl: 'demo' }, undefined, 'uid-1'),
    ).resolves.toMatchObject({
      publicUrl: 'https://demo',
    });
  });

  test('ignores blank preferred URLs and falls back to management URL', async () => {
    const { resolveUploadUrls } = await loadService();

    await expect(
      resolveUploadUrls(
        'bafybeicid',
        { dnsUrl: '   ', pinmeUrl: '', shortUrl: ' ' },
        undefined,
        'uid-1',
      ),
    ).resolves.toEqual({
      publicUrl: 'https://preview.pinme.test/#/preview/bafybeicid',
      managementUrl: 'https://preview.pinme.test/#/preview/bafybeicid',
    });
  });

  test('falls back to project management URL when project name is present', async () => {
    const { resolveUploadUrls } = await loadService();

    await expect(
      resolveUploadUrls('bafybeicid', undefined, 'demo-project', 'uid-1'),
    ).resolves.toEqual({
      publicUrl: 'https://project.pinme.test/demo-project',
      managementUrl: 'https://project.pinme.test/demo-project',
    });
  });

  test('trims project names and falls back to device uid when uid is blank', async () => {
    const { resolveUploadUrls } = await loadService();

    await expect(
      resolveUploadUrls('bafybeicid', undefined, '  demo-project  ', '   '),
    ).resolves.toEqual({
      publicUrl: 'https://project.pinme.test/demo-project',
      managementUrl: 'https://project.pinme.test/demo-project',
    });
    expect(getUid).toHaveBeenCalled();
  });

  test('uses secretKey to hide raw CID in preview management URLs', async () => {
    const { resolveUploadUrls } = await loadService({ SECRET_KEY: 'secret' });

    const result = await resolveUploadUrls(
      'bafybeicid',
      undefined,
      undefined,
      'uid-1',
    );

    expect(result.managementUrl).toMatch(
      /^https:\/\/preview\.pinme\.test\/#\/preview\/.+/,
    );
    expect(result.managementUrl).not.toContain('bafybeicid');
    expect(result.publicUrl).toBe(result.managementUrl);
  });

  test('secretKey encryption produces URL-safe CID tokens that include uid input', async () => {
    const { resolveUploadUrls } = await loadService({ SECRET_KEY: 'secret' });

    const first = await resolveUploadUrls(
      'bafybeicid',
      undefined,
      undefined,
      'uid-1',
    );
    const second = await resolveUploadUrls(
      'bafybeicid',
      undefined,
      undefined,
      'uid-2',
    );
    const firstToken = first.managementUrl.split('/preview/').at(-1)!;
    const secondToken = second.managementUrl.split('/preview/').at(-1)!;

    expect(firstToken).not.toBe(secondToken);
    expect(firstToken).not.toContain('bafybeicid');
    expect(firstToken).not.toMatch(/[+/=]/);
    expect(secondToken).not.toMatch(/[+/=]/);
  });

  test('secretKey encryption sanitizes plus slash and padding deterministically', async () => {
    const encrypt = vi.fn((message: string) => ({
      toString: () => `+/${message}==`,
    }));
    vi.doMock('crypto-js', () => ({
      default: {
        RC4: { encrypt },
      },
    }));
    const { resolveUploadUrls } = await loadService({ SECRET_KEY: 'secret' });

    const result = await resolveUploadUrls(
      'bafybeicid',
      undefined,
      undefined,
      'uid-1',
    );

    expect(encrypt).toHaveBeenCalledWith('bafybeicid-uid-1', 'secret');
    expect(result.managementUrl).toBe(
      'https://preview.pinme.test/#/preview/-_bafybeicid-uid-1',
    );
    expect(result.managementUrl.split('/preview/').at(-1)).not.toMatch(
      /[+/=]/,
    );
  });


  test('uploadPath rejects when auth config is absent', async () => {
    const { uploadPath } = await loadService();
    getAuthConfig.mockReturnValue(null);

    await expect(uploadPath('/tmp/site')).rejects.toThrow(/Please login first/);
    expect(uploadToIpfsSplit).not.toHaveBeenCalled();
  });

  test('uploadPath returns normalized upload result URLs', async () => {
    const { uploadPath } = await loadService();
    getAuthConfig.mockReturnValue({
      address: '0xabc',
      token: 'token',
    });
    uploadToIpfsSplit.mockResolvedValue({
      contentHash: 'bafybeicid',
      shortUrl: 'short',
    });

    await expect(uploadPath('/tmp/site', { action: 'upload' })).resolves.toEqual({
      contentHash: 'bafybeicid',
      shortUrl: 'short',
      pinmeUrl: undefined,
      dnsUrl: undefined,
      publicUrl: 'https://short.pinme.test',
      managementUrl: 'https://preview.pinme.test/#/preview/bafybeicid',
    });
    expect(uploadToIpfsSplit).toHaveBeenCalledWith('/tmp/site', {
      action: 'upload',
      importAsCar: undefined,
      projectName: undefined,
      uid: '0xabc',
    });
  });

  test('uploadPath rejects upload responses without a content hash', async () => {
    const { uploadPath } = await loadService();
    getAuthConfig.mockReturnValue({
      address: '0xabc',
      token: 'token',
    });
    uploadToIpfsSplit.mockResolvedValue({});

    await expect(uploadPath('/tmp/site')).rejects.toThrow(/no content hash/);

    uploadToIpfsSplit.mockResolvedValueOnce(null);
    await expect(uploadPath('/tmp/site')).rejects.toThrow(/no content hash/);
  });
});
