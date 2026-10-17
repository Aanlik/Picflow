/**
 * Keep guest collaboration responsive without polling a large gallery as
 * aggressively as a small one. At 342 visible photos this is 12 seconds;
 * background tabs pause polling and window focus still refreshes immediately.
 */
export function galleryRefreshInterval(photoCount: number): number {
  const count = Number.isFinite(photoCount) ? Math.max(0, photoCount) : 0;
  return Math.min(30_000, Math.max(5_000, Math.ceil(count / 50) * 1_000 + 5_000));
}
