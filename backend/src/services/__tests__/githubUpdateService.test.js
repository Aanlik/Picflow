const axios = require('axios');
const { checkLatestRelease, compareVersions, clearUpdateCheckCache } = require('../githubUpdateService');

describe('Picflow GitHub update check', () => {
  const originalGet = axios.get;
  const originalRepo = process.env.PICFLOW_GITHUB_REPOSITORY;
  const originalLegacyRepo = process.env.PHOFLOW_GITHUB_REPOSITORY;
  beforeEach(() => {
    clearUpdateCheckCache();
    process.env.PICFLOW_GITHUB_REPOSITORY = 'Aanlik/Picflow';
    axios.get = jest.fn();
  });
  afterAll(() => {
    axios.get = originalGet;
    if (originalRepo === undefined) delete process.env.PICFLOW_GITHUB_REPOSITORY;
    else process.env.PICFLOW_GITHUB_REPOSITORY = originalRepo;
    if (originalLegacyRepo === undefined) delete process.env.PHOFLOW_GITHUB_REPOSITORY;
    else process.env.PHOFLOW_GITHUB_REPOSITORY = originalLegacyRepo;
  });

  it('compares numeric versions correctly', () => {
    expect(compareVersions('v1.0.1', '1.0')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0', '1.1')).toBe(-1);
  });

  it('reports that the repository has no published release yet', async () => {
    axios.get.mockResolvedValue({ status: 404, data: null, headers: {} });
    const result = await checkLatestRelease('1.0');
    expect(result).toMatchObject({ status: 'no_release', currentVersion: '1.0', latestVersion: null });
    expect(result.releaseUrl).toBe('https://github.com/Aanlik/Picflow/releases');
  });

  it('accepts the previous repository environment variable during migration', async () => {
    delete process.env.PICFLOW_GITHUB_REPOSITORY;
    process.env.PHOFLOW_GITHUB_REPOSITORY = 'Aanlik/Picflow';
    axios.get.mockResolvedValue({ status: 404, data: null, headers: {} });

    await checkLatestRelease('1.0');

    expect(axios.get).toHaveBeenCalledWith(
      'https://api.github.com/repos/Aanlik/Picflow/releases/latest',
      expect.objectContaining({ timeout: 8000, validateStatus: expect.any(Function) }),
    );
  });

  it('reports anonymous GitHub API rate limiting without turning it into a connection failure', async () => {
    axios.get.mockResolvedValue({
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1791778476' },
      data: { message: 'API rate limit exceeded' },
    });

    const result = await checkLatestRelease('1.0');

    expect(result).toMatchObject({ status: 'rate_limited', currentVersion: '1.0', latestVersion: null });
    expect(result.retryAt).toBe(new Date(1791778476 * 1000).toISOString());
  });

  it('reports a newer release and its release notes', async () => {
    axios.get.mockResolvedValue({
      status: 200,
      headers: {},
      data: { tag_name: 'v1.1.0', name: 'Picflow 1.1', body: 'Fixes', published_at: '2026-10-12T00:00:00Z' },
    });
    const result = await checkLatestRelease('1.0');
    expect(result).toMatchObject({ status: 'update_available', latestVersion: 'v1.1.0', releaseName: 'Picflow 1.1', releaseNotes: 'Fixes' });
  });

  it('distinguishes a development build newer than the latest release', async () => {
    axios.get.mockResolvedValue({
      status: 200,
      headers: {},
      data: { tag_name: 'v1.0.0', name: 'Picflow 1.0', body: '' },
    });
    const result = await checkLatestRelease('1.0.1');
    expect(result).toMatchObject({ status: 'current_ahead', currentVersion: '1.0.1', latestVersion: 'v1.0.0' });
  });

  it('caches the manually requested public API result', async () => {
    axios.get.mockResolvedValue({ status: 404, data: null, headers: {} });
    await checkLatestRelease('1.0');
    await checkLatestRelease('1.0');
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('classifies an API error without exposing the upstream body', async () => {
    axios.get.mockResolvedValue({ status: 403, data: {}, headers: {} });
    await expect(checkLatestRelease('1.0')).rejects.toMatchObject({ code: 'GITHUB_HTTP_ERROR', status: 403 });
  });

  it.each([
    [{ name: 'TimeoutError', code: 'ETIMEDOUT' }, 'GITHUB_TIMEOUT_ERROR'],
    [{ name: 'Error', code: 'ENOTFOUND' }, 'GITHUB_DNS_ERROR'],
    [{ name: 'Error', code: 'CERT_HAS_EXPIRED' }, 'GITHUB_TLS_ERROR'],
    [{ name: 'TypeError', code: 'ECONNRESET' }, 'GITHUB_NETWORK_ERROR'],
    [{ name: 'TypeError', cause: { code: 'ENOTFOUND' } }, 'GITHUB_DNS_ERROR'],
  ])('classifies network errors for diagnosis', async (networkError, expectedCode) => {
    axios.get.mockRejectedValue(networkError);
    await expect(checkLatestRelease('1.0')).rejects.toMatchObject({ code: expectedCode });
  });
});
