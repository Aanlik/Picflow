type Result = string | null | undefined;
type Pending = { id: string; signal: AbortSignal; resolve: (value: Result) => void };
type Group = { url: URL; headers: Record<string, string>; entries: Pending[]; fetcher: typeof fetch };
const groups = new Map<typeof fetch, Map<string, Group>>();

/** Coalesce simultaneous visible thumbnails, without retaining signed URLs. */
export function batchThumbnailUrl(source: URL, headers: Record<string, string>, fetcher: typeof fetch, signal: AbortSignal): Promise<Result> | null {
  if (source.searchParams.get('cloud_batch') !== '1') return null;
  const match = source.pathname.match(/^(.*\/api\/gallery\/[^/]+)\/thumbnail\/(\d+)$/);
  if (!match) return null;
  const batchUrl = new URL(`${match[1]}/thumbnail-urls`, source.origin);
  for (const key of ['w', 'admin_preview']) {
    const value = source.searchParams.get(key);
    if (value !== null) batchUrl.searchParams.set(key, value);
  }
  const prefix = `${batchUrl.toString()}\n${JSON.stringify(Object.entries(headers).sort())}`;
  let byKey = groups.get(fetcher);
  if (!byKey) { byKey = new Map(); groups.set(fetcher, byKey); }
  let n = 0;
  let key = prefix;
  while (byKey.get(key)?.entries.length === 40) key = `${prefix}\n${++n}`;
  let group = byKey.get(key);
  if (!group) {
    group = { url: batchUrl, headers, entries: [], fetcher };
    byKey.set(key, group);
    const current = group;
    setTimeout(async () => {
      byKey!.delete(key);
      if (byKey!.size === 0) groups.delete(fetcher);
      const active = current.entries.filter((entry) => !entry.signal.aborted);
      current.entries.filter((entry) => entry.signal.aborted).forEach((entry) => entry.resolve(undefined));
      if (!active.length) return;
      const ids = [...new Set(active.map((entry) => entry.id))];
      current.url.searchParams.set('ids', ids.join(','));
      try {
        const fetcher = current.fetcher;
        const response = await fetcher(current.url.toString(), { credentials: 'include', headers: Object.keys(current.headers).length ? current.headers : undefined });
        if (!response.ok) throw new Error('Thumbnail batch failed');
        const data = await response.json() as { urls?: Record<string, string> };
        if (!data.urls || typeof data.urls !== 'object') throw new Error('Invalid thumbnail batch');
        active.forEach((entry) => entry.resolve(data.urls![entry.id] || null));
      } catch {
        active.forEach((entry) => entry.resolve(undefined));
      }
    }, 8);
  }
  const current = group;
  return new Promise((resolve) => { current.entries.push({ id: match[2], signal, resolve }); });
}
