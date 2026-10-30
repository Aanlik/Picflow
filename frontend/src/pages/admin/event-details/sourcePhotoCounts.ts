export interface SourcePhotoCount {
  id: number;
  photo_count?: number | null;
}

export function snapshotSourcePhotoCounts(sources: readonly SourcePhotoCount[]): Map<number, number> {
  return new Map(sources.map((source) => [source.id, Number(source.photo_count) || 0]));
}

export function sourcePhotoCountsChanged(
  previous: ReadonlyMap<number, number> | null,
  next: ReadonlyMap<number, number>,
): boolean {
  if (!previous) return false;
  if (previous.size !== next.size) return true;

  for (const [sourceId, photoCount] of next) {
    if (previous.get(sourceId) !== photoCount) return true;
  }

  return false;
}
