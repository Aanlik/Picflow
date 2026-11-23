/**
 * Web Storage access that never throws in browsers where site data is blocked
 * or the storage quota is exhausted. Writes that cannot be persisted stay in
 * page memory so the current gallery session can still complete auth flows;
 * they naturally disappear on reload.
 */
export type StorageKind = 'local' | 'session';

const memoryValues: Record<StorageKind, Map<string, string>> = {
  local: new Map(),
  session: new Map(),
};
const memoryRemovals: Record<StorageKind, Set<string>> = {
  local: new Set(),
  session: new Set(),
};

function getStorage(kind: StorageKind): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function safeGetItem(kind: StorageKind, key: string): string | null {
  if (typeof window === 'undefined') return null;
  if (memoryRemovals[kind].has(key)) return null;
  if (memoryValues[kind].has(key)) return memoryValues[kind].get(key) ?? null;
  try {
    return getStorage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeSetItem(kind: StorageKind, key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    const storage = getStorage(kind);
    if (!storage) throw new Error('Web Storage unavailable');
    storage.setItem(key, value);
    memoryValues[kind].delete(key);
    memoryRemovals[kind].delete(key);
  } catch {
    memoryValues[kind].set(key, value);
    memoryRemovals[kind].delete(key);
  }
}

export function safeRemoveItem(kind: StorageKind, key: string): void {
  if (typeof window === 'undefined') return;
  try {
    const storage = getStorage(kind);
    if (!storage) throw new Error('Web Storage unavailable');
    storage.removeItem(key);
    memoryValues[kind].delete(key);
    memoryRemovals[kind].delete(key);
  } catch {
    memoryValues[kind].delete(key);
    memoryRemovals[kind].add(key);
  }
}

/** List visible keys, including page-memory values and excluding failed removals. */
export function safeKeys(kind: StorageKind): string[] {
  if (typeof window === 'undefined') return [];
  const keys = new Set<string>();
  try {
    const storage = getStorage(kind);
    if (storage) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key) keys.add(key);
      }
    }
  } catch {
    // Continue with the values that remain available in this page.
  }
  for (const key of memoryValues[kind].keys()) keys.add(key);
  for (const key of memoryRemovals[kind]) keys.delete(key);
  return [...keys];
}
