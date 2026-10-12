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
}

export function matchesWorkflowPhotoFilter(
  photo: WorkflowPhotoLike,
  filter: WorkflowPhotoFilter,
  stage: string,
  hasActiveRequest = false,
): boolean {
  const isCancelled = photo.cancelled;
  const isDelivered = photo.delivered && !isCancelled;
  const isEditing = photo.selected
    && photo.ready_for_editing
    && ['EDITING', 'DELIVERED'].includes(stage)
    && !isDelivered
    && !isCancelled
    && !photo.error;
  const isSelected = photo.selected
    && !isEditing
    && !isDelivered
    && !isCancelled
    && !photo.error;

  switch (filter) {
    case 'all': return true;
    case 'proof': return !photo.selected && !isCancelled && !photo.delivered && !photo.error;
    case 'selected': return isSelected;
    case 'editing': return isEditing;
    case 'delivered': return isDelivered;
    case 'additional': return photo.selected && photo.added_during_editing && !isCancelled && !photo.error;
    case 'requests': return hasActiveRequest;
    case 'cancelled': return isCancelled;
    case 'errors': return photo.error;
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
