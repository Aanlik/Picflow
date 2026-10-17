import { describe, expect, it } from 'vitest';
import { countWorkflowPhotos, matchesWorkflowPhotoFilter } from '../workflowPhotoFilter';

const photo = (overrides: Record<string, unknown> = {}) => ({
  photo_id: 1,
  selected: true,
  ready_for_editing: true,
  delivered: false,
  cancelled: false,
  added_during_editing: false,
  error: false,
  ...overrides,
});

describe('workflow photo filters', () => {
  it('keeps ready selections in the selected bucket until the project enters editing', () => {
    const selected = photo();
    expect(matchesWorkflowPhotoFilter(selected, 'selected', 'SELECTING')).toBe(true);
    expect(matchesWorkflowPhotoFilter(selected, 'editing', 'SELECTING')).toBe(false);
    expect(matchesWorkflowPhotoFilter(selected, 'editing', 'EDITING')).toBe(true);
  });

  it('does not count a withdrawn delivered photo as delivered', () => {
    const withdrawn = photo({ cancelled: true, delivered: true });
    expect(matchesWorkflowPhotoFilter(withdrawn, 'delivered', 'DELIVERED')).toBe(false);
    expect(matchesWorkflowPhotoFilter(withdrawn, 'cancelled', 'DELIVERED')).toBe(true);
  });

  it('counts using the same rules as the filters', () => {
    const photos = [photo({ photo_id: 1 }), photo({ photo_id: 2, delivered: true }), photo({ photo_id: 3, cancelled: true })];
    expect(countWorkflowPhotos(photos, 'SELECTING', new Set())[ 'selected' ]).toBe(1);
    expect(countWorkflowPhotos(photos, 'SELECTING', new Set())[ 'delivered' ]).toBe(1);
    expect(countWorkflowPhotos(photos, 'SELECTING', new Set())[ 'cancelled' ]).toBe(1);
  });

  it('excludes remotely deleted photos from normal counts and keeps them visible as errors', () => {
    const photos = [photo({ photo_id: 1 }), photo({ photo_id: 2, remote_present: false, delivered: true })];
    const counts = countWorkflowPhotos(photos, 'DELIVERED', new Set());
    expect(counts.all).toBe(1);
    expect(counts.delivered).toBe(0);
    expect(counts.errors).toBe(1);
  });
});
