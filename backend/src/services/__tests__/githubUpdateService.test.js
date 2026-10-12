const { checkLatestRelease, compareVersions, clearUpdateCheckCache } = require('../githubUpdateService');

describe('Picflow GitHub update check', () => {
  const originalFetch = global.fetch;
  const originalRepo = process.env.PICFLOW_GITHUB_REPOSITORY;
  const originalLegacyRepo = process.env.PHOFLOW_GITHUB_REPOSITORY;
  beforeEach(() => {
    clearUpdateCheckCache();
    process.env.PICFLOW_GITHUB_REPOSITORY = 'Aanlik/Picflow';
  });
  afterAll(() => {
    global.fetch = originalFetch;
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
    global.fetch = jest.fn().mockResolvedValue({ status: 404, ok: false });
    const result = await checkLatestRelease('1.0');
    expect(result).toMatchObject({ status: 'no_release', currentVersion: '1.0', latestVersion: null });
    expect(result.releaseUrl).toBe('https://github.com/Aanlik/Picflow/releases');
  });

  it('accepts the previous repository environment variable during migration', async () => {
    delete process.env.PICFLOW_GITHUB_REPOSITORY;
    process.env.PHOFLOW_GITHUB_REPOSITORY = 'Aanlik/Picflow';
    global.fetch = jest.fn().mockResolvedValue({ status: 404, ok: false });

    await checkLatestRelease('1.0');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/Aanlik/Picflow/releases/latest',
      expect.any(Object),
    );
  });

  it('reports anonymous GitHub API rate limiting without turning it into a connection failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 403,
      ok: false,
      headers: { get: (name) => name.toLowerCase() === 'x-ratelimit-remaining' ? '0' : '1791778476' },
      json: async () => ({ message: 'API rate limit exceeded' }),
    });

    const result = await checkLatestRelease('1.0');

    expect(result).toMatchObject({ status: 'rate_limited', currentVersion: '1.0', latestVersion: null });
    expect(result.retryAt).toBe(new Date(1791778476 * 1000).toISOString());
  });

  it('reports a newer release and its release notes', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ tag_name: 'v1.1.0', name: 'Picflow 1.1', body: 'Fixes', published_at: '2026-10-12T00:00:00Z' }),
    });
    const result = await checkLatestRelease('1.0');
    expect(result).toMatchObject({ status: 'update_available', latestVersion: 'v1.1.0', releaseName: 'Picflow 1.1', releaseNotes: 'Fixes' });
  });

  it('caches the manually requested public API result', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 404, ok: false });
    await checkLatestRelease('1.0');
    await checkLatestRelease('1.0');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces API/network failures to the caller', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 403, ok: false });
    await expect(checkLatestRelease('1.0')).rejects.toThrow('403');
  });
});
