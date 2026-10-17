export type WorkflowPhotoFilter =
  | 'all'
  | 'proof'
  | 'selected'
  | 'editing'
  | 'delivered'
  | 'additional'
  | 'requests'
  | 'cancelled'
  | 'errors';

export interface WorkflowPhotoLike {
  photo_id: number;
  selected: boolean;
  ready_for_editing: boolean;
  delivered: boolean;
  cancelled: boolean;
  added_during_editing: boolean;
  error: boolean;
  remote_present?: boolean;
}

export function matchesWorkflowPhotoFilter(
  photo: WorkflowPhotoLike,
  filter: WorkflowPhotoFilter,
  stage: string,
  hasActiveRequest = false,
): boolean {
  const remoteMissing = photo.remote_present === false;
  const hasError = photo.error || remoteMissing;
  const isCancelled = photo.cancelled;
  const isDelivered = photo.delivered && !isCancelled;
  const isEditing = photo.selected
    && photo.ready_for_editing
    && ['EDITING', 'DELIVERED'].includes(stage)
    && !isDelivered
    && !isCancelled
    && !hasError;
  const isSelected = photo.selected
    && !isEditing
    && !isDelivered
    && !isCancelled
    && !hasError;

  switch (filter) {
    case 'all': return !remoteMissing;
    case 'proof': return !remoteMissing && !photo.selected && !isCancelled && !photo.delivered && !hasError;
    case 'selected': return isSelected;
    case 'editing': return isEditing;
    case 'delivered': return !remoteMissing && isDelivered;
    case 'additional': return !remoteMissing && photo.selected && photo.added_during_editing && !isCancelled && !hasError;
    case 'requests': return !remoteMissing && hasActiveRequest;
    case 'cancelled': return !remoteMissing && isCancelled;
    case 'errors': return hasError;
    default: return false;
  }
}

export function countWorkflowPhotos(
  photos: WorkflowPhotoLike[],
  stage: string,
  activeRequestPhotoIds: Set<number>,
): Record<WorkflowPhotoFilter, number> {
  const filters: WorkflowPhotoFilter[] = ['all', 'proof', 'selected', 'editing', 'delivered', 'additional', 'requests', 'cancelled', 'errors'];
  return Object.fromEntries(filters.map((filter) => [
    filter,
    photos.filter((photo) => matchesWorkflowPhotoFilter(
      photo,
      filter,
      stage,
      activeRequestPhotoIds.has(photo.photo_id),
    )).length,
  ])) as Record<WorkflowPhotoFilter, number>;
}
