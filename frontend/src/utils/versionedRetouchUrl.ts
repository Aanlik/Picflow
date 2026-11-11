/** Add the current delivery version to same-origin image URLs so browser and
 * intermediary caches fetch the replaced preview after a retouch is delivered. */
export function versionedRetouchUrl(
  url: string | null | undefined,
  version: number,
  revision = 0,
): string | undefined {
  if (!url || version < 1 || !url.startsWith('/')) return url || undefined;
  try {
    const parsed = new URL(url, window.location.origin);
    parsed.searchParams.set('retouch_v', String(version));
    if (Number.isSafeInteger(revision) && revision > 0) {
      parsed.searchParams.set('retouch_r', String(revision));
    } else {
      parsed.searchParams.delete('retouch_r');
    }
    // URL normalizes braces in secure-image token templates. Keep the literal
    // placeholder so SecureTokenService can substitute the one-use token.
    const pathname = parsed.pathname.replace(/%7B%7Btoken%7D%7D/gi, '{{token}}');
    return `${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}
