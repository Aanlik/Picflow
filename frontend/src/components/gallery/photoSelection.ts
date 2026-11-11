export interface PhotoSelectionOverride {
  photoId: number;
  selected: boolean;
}

/** Keep an optimistic selection attached to its photo, not the viewer slot. */
export function selectedForPhoto(
  photoId: number,
  serverSelected: boolean,
  override: PhotoSelectionOverride | null,
): boolean {
  return override?.photoId === photoId ? override.selected : serverSelected;
}

export interface RetouchBatchPhotoState {
  photoId: number;
  selected: boolean;
  canChange: boolean;
}

export function partitionRetouchBatchPhotoIds(
  photoIds: readonly number[],
  states: readonly RetouchBatchPhotoState[],
): { toSelect: number[]; toCancel: number[] } {
  const stateByPhotoId = new Map(states.map((state) => [state.photoId, state]));
  const toSelect: number[] = [];
  const toCancel: number[] = [];

  for (const photoId of photoIds) {
    const state = stateByPhotoId.get(photoId);
    if (!state?.canChange) continue;
    (state.selected ? toCancel : toSelect).push(photoId);
  }

  return { toSelect, toCancel };
}
