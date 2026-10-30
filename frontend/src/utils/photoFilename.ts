import type { Photo } from '../types';

/** Use the camera stem with the delivered image extension for Bridge replacements. */
export function photoDisplayFilename(photo: Pick<Photo, 'filename' | 'original_filename' | 'source_filename'>): string {
  const original = photo.original_filename || photo.filename;
  const bridgeMarked = /\.__bridge_[a-f0-9]{64}(?=\.[^.]+$)/i.test(original);
  if (photo.source_filename && bridgeMarked) {
    const sourceName = photo.source_filename.split(/[\\/]/).pop() || photo.source_filename;
    const sourceDot = sourceName.lastIndexOf('.');
    const stem = sourceDot > 0 ? sourceName.slice(0, sourceDot) : sourceName;
    const deliveredExt = original.match(/\.[^.]+$/)?.[0] || '.jpg';
    return `${stem}${deliveredExt}`;
  }
  if (bridgeMarked) return original.replace(/\.__bridge_[a-f0-9]{64}(?=\.[^.]+$)/i, '');
  return original;
}

/**
 * Ascending name order by display filename. Numeric collation so camera names
 * without zero padding follow the shot sequence (IMG_9 < IMG_10 < IMG_100).
 */
export function photoNameCompare(
  a: Pick<Photo, 'filename' | 'original_filename' | 'source_filename'>,
  b: Pick<Photo, 'filename' | 'original_filename' | 'source_filename'>
): number {
  return photoDisplayFilename(a).localeCompare(photoDisplayFilename(b), undefined, { numeric: true });
}

export function photoMatchesFilenameSearch(
  photo: Pick<Photo, 'filename' | 'original_filename' | 'source_filename'>,
  term: string
): boolean {
  const needle = term.toLowerCase();
  return (
    photo.filename.toLowerCase().includes(needle) ||
    (photo.original_filename?.toLowerCase().includes(needle) ?? false) ||
    (photo.source_filename?.toLowerCase().includes(needle) ?? false)
  );
}
