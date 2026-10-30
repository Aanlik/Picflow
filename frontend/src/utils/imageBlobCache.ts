// Gallery tiles are deliberately unmounted outside the viewport to keep the
// DOM and canvases light. Keep enough verified thumbnail blobs to make a
// typical 400-photo project survive a full down-and-back scroll without
// fetching the same NAS-backed tiles again.
const MAX_CACHE_BYTES = 128 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 1024;
const MAX_CACHEABLE_BLOB_BYTES = 1_500_000;

interface Entry {
  url: string;
  bytes: number;
  references: number;
  lastUsed: number;
  cached: boolean;
}

export interface ImageBlobLease {
  url: string;
  release: () => void;
}

const entries = new Map<string, Entry>();
let cacheBytes = 0;

function dispose(entry: Entry) {
  if (entry.cached) cacheBytes -= entry.bytes;
  entry.cached = false;
  URL.revokeObjectURL(entry.url);
}

function evictToLimits(protectedEntry?: Entry) {
  while (cacheBytes > MAX_CACHE_BYTES || entries.size > MAX_CACHE_ENTRIES) {
    let oldestKey: string | undefined;
    let oldest: Entry | undefined;
    for (const [key, entry] of entries) {
      if (entry === protectedEntry || entry.references > 0) continue;
      if (!oldest || entry.lastUsed < oldest.lastUsed) {
        oldestKey = key;
        oldest = entry;
      }
    }
    if (!oldest || oldestKey === undefined) break;
    entries.delete(oldestKey);
    dispose(oldest);
  }
}

function lease(entry: Entry): ImageBlobLease {
  entry.references += 1;
  entry.lastUsed = Date.now();
  let released = false;
  return {
    url: entry.url,
    release: () => {
      if (released) return;
      released = true;
      entry.references = Math.max(0, entry.references - 1);
      entry.lastUsed = Date.now();
      if (!entry.cached && entry.references === 0) dispose(entry);
      else evictToLimits();
    },
  };
}

export function acquireImageBlob(key: string): ImageBlobLease | null {
  const entry = entries.get(key);
  if (!entry) return null;
  return lease(entry);
}

export function cacheImageBlob(key: string, blob: Blob): ImageBlobLease {
  const existing = acquireImageBlob(key);
  if (existing) return existing;

  const entry: Entry = {
    url: URL.createObjectURL(blob),
    bytes: blob.size,
    references: 0,
    lastUsed: Date.now(),
    cached: blob.size <= MAX_CACHEABLE_BLOB_BYTES,
  };
  if (!entry.cached) return lease(entry);

  entries.set(key, entry);
  cacheBytes += entry.bytes;
  const result = lease(entry);
  evictToLimits(entry);
  if (cacheBytes > MAX_CACHE_BYTES || entries.size > MAX_CACHE_ENTRIES) {
    entries.delete(key);
    cacheBytes -= entry.bytes;
    entry.cached = false;
  }
  return result;
}

export function clearImageBlobCache(slug?: string) {
  const scope = slug ? `${slug}\n` : null;
  for (const [key, entry] of entries) {
    if (scope && !key.startsWith(scope)) continue;
    entries.delete(key);
    if (entry.references === 0) dispose(entry);
    else {
      if (entry.cached) cacheBytes -= entry.bytes;
      entry.cached = false;
    }
  }
}
