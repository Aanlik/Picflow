import { clearImageBlobCache } from './imageBlobCache';
import { safeGetItem, safeKeys, safeRemoveItem, safeSetItem } from './safeStorage';

const TOKEN_STORAGE_PREFIX = 'gallery_token_';
const ACTIVE_SLUG_KEY = 'gallery_active_slug';

const extractSlugFromPath = (path: string): string | null => {
  if (!path) return null;
  const match = path.match(/\/gallery\/([^\/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
};

export const inferGallerySlugFromLocation = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return extractSlugFromPath(window.location.pathname);
  } catch {
    return null;
  }
};

export const setActiveGallerySlug = (slug: string | null) => {
  if (slug) {
    safeSetItem('session', ACTIVE_SLUG_KEY, slug);
  } else {
    safeRemoveItem('session', ACTIVE_SLUG_KEY);
  }
};

export const getActiveGallerySlug = (): string | null => {
  return safeGetItem('session', ACTIVE_SLUG_KEY);
};

export const clearActiveGallerySlug = () => {
  const active = safeGetItem('session', ACTIVE_SLUG_KEY);
  if (active) clearImageBlobCache(active);
  safeRemoveItem('session', ACTIVE_SLUG_KEY);
};

export const storeGalleryToken = (slug: string, token: string) => {
  if (!slug) return;
  const key = `${TOKEN_STORAGE_PREFIX}${slug}`;
  if (safeGetItem('session', key) !== token) clearImageBlobCache(slug);
  safeSetItem('session', key, token);
};

export const getGalleryToken = (slug?: string | null): string | null => {
  const resolvedSlug = slug || getActiveGallerySlug() || inferGallerySlugFromLocation();
  if (!resolvedSlug) return null;
  return safeGetItem('session', `${TOKEN_STORAGE_PREFIX}${resolvedSlug}`);
};

export const clearGalleryToken = (slug?: string | null) => {
  if (slug) {
    clearImageBlobCache(slug);
    safeRemoveItem('session', `${TOKEN_STORAGE_PREFIX}${slug}`);
    return;
  }

  const active = safeGetItem('session', ACTIVE_SLUG_KEY);
  if (active) safeRemoveItem('session', `${TOKEN_STORAGE_PREFIX}${active}`);
  clearImageBlobCache(active || undefined);
};

export const clearAllGalleryTokens = () => {
  clearImageBlobCache();
  safeKeys('session')
    .filter((key) => key.startsWith(TOKEN_STORAGE_PREFIX))
    .forEach((key) => safeRemoveItem('session', key));
};

export const resolveSlugFromRequestUrl = (url?: string | null): string | null => {
  if (!url) return null;
  let pathname = url;

  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      pathname = new URL(url).pathname;
    }
  } catch {
    // Leave pathname as provided if URL parsing fails
  }

  if (!pathname.startsWith('/')) {
    pathname = `/${pathname}`;
  }

  return extractSlugFromPath(pathname);
};
