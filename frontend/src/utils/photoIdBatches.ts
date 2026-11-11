/** Split a photo selection into API-sized batches while preserving order. */
export function chunkPhotoIds<T extends number>(photoIds: readonly T[], batchSize = 100): T[][] {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new RangeError('Photo batch size must be a positive safe integer');
  }

  const batches: T[][] = [];
  for (let offset = 0; offset < photoIds.length; offset += batchSize) {
    batches.push(photoIds.slice(offset, offset + batchSize));
  }
  return batches;
}
