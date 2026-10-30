import type { Photo } from '../../types';

/** Keep only selected photos the current gallery view can actually download. */
export const getDownloadableSelectedPhotoIds = (
  photos: Photo[],
  selectedPhotoIds: Set<number>,
): number[] => photos
  .filter((photo) => selectedPhotoIds.has(photo.id) && photo.category_allow_downloads !== false && photo.download_allowed !== false)
  .map((photo) => photo.id);

/** Preserve the camera-facing filename as a fallback when a rendition route has no disposition header. */
export const getPhotoDownloadFilenames = (photos: Photo[], photoIds: number[]): Record<number, string> => {
  const selected = new Set(photoIds);
  return Object.fromEntries(photos
    .filter((photo) => selected.has(photo.id))
    .map((photo) => [photo.id, photo.original_filename || photo.source_filename || photo.filename]));
};
