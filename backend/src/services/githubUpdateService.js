const DEFAULT_REPOSITORY = 'Aanlik/Picflow';
const CACHE_TTL_MS = 10 * 60 * 1000;
let cached = null;

function repository() {
  const value = process.env.PICFLOW_GITHUB_REPOSITORY || process.env.PHOFLOW_GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error('Invalid PICFLOW_GITHUB_REPOSITORY');
  }
  return value;
}

function parseVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return match.slice(1, 4).map((part) => Number(part || 0));
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error('GitHub release version is not a supported numeric version');
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

async function checkLatestRelease(currentVersion) {
  const repo = repository();
  const now = Date.now();
  if (cached && cached.repo === repo && cached.currentVersion === currentVersion && cached.expiresAt > now) {
    return cached.value;
  }

  const repositoryUrl = `https://github.com/${repo}`;
  const releasesUrl = `${repositoryUrl}/releases`;
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Picflow-update-check',
    },
    signal: AbortSignal.timeout(8000),
  });

  let value;
  if (response.status === 404) {
    value = {
      status: 'no_release', currentVersion, latestVersion: null,
      repositoryUrl, releaseUrl: releasesUrl, checkedAt: new Date().toISOString(),
    };
  } else if (response.status === 403) {
    let errorBody = null;
    try { errorBody = await response.json(); } catch { errorBody = null; }
    const remaining = response.headers?.get?.('x-ratelimit-remaining');
    const message = String(errorBody?.message || '').toLowerCase();
    if (remaining === '0' || message.includes('rate limit exceeded')) {
      const resetSeconds = Number(response.headers?.get?.('x-ratelimit-reset'));
      value = {
        status: 'rate_limited', currentVersion, latestVersion: null,
        repositoryUrl, releaseUrl: releasesUrl,
        retryAt: Number.isFinite(resetSeconds) && resetSeconds > 0
          ? new Date(resetSeconds * 1000).toISOString()
          : null,
        checkedAt: new Date().toISOString(),
      };
    } else {
      throw new Error(`GitHub API returned ${response.status}`);
    }
  } else if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}`);
  } else {
    const release = await response.json();
    const latestVersion = typeof release.tag_name === 'string' ? release.tag_name.trim() : '';
    const comparison = compareVersions(latestVersion, currentVersion);
    value = {
      status: comparison > 0 ? 'update_available' : 'up_to_date',
      currentVersion,
      latestVersion,
      repositoryUrl,
      releaseUrl: `${releasesUrl}/tag/${encodeURIComponent(latestVersion)}`,
      releaseName: typeof release.name === 'string' ? release.name : latestVersion,
      releaseNotes: typeof release.body === 'string' ? release.body.slice(0, 12000) : '',
      publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
      checkedAt: new Date().toISOString(),
    };
  }
  cached = { repo, currentVersion, expiresAt: now + CACHE_TTL_MS, value };
  return value;
}

function clearUpdateCheckCache() {
  cached = null;
}

module.exports = { checkLatestRelease, compareVersions, clearUpdateCheckCache };
