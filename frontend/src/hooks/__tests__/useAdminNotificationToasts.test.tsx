import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { info, formatNotificationMessage } = vi.hoisted(() => ({
  info: vi.fn(),
  formatNotificationMessage: vi.fn((notification: { type: string }) => `message:${notification.type}`),
}));

vi.mock('react-toastify', () => ({ toast: { info } }));
vi.mock('../../services/notifications.service', () => ({
  notificationsService: { formatNotificationMessage },
}));

import { useAdminNotificationToasts } from '../useAdminNotificationToasts';

describe('useAdminNotificationToasts', () => {
  beforeEach(() => {
    info.mockClear();
    formatNotificationMessage.mockClear();
  });

  it.each(['guest', 'customer'])('keeps a new %s action in the feed without a popup', (actorType) => {
    const initial = [{ id: 1, type: 'guest_feedback_comment', actorType, isRead: false }];
    const { rerender } = renderHook(
      ({ notifications }) => useAdminNotificationToasts(notifications as never),
      { initialProps: { notifications: initial } },
    );
    expect(info).not.toHaveBeenCalled();

    rerender({ notifications: [
      ...initial,
      { id: 2, type: 'guest_feedback_color_label', actorType, isRead: false },
    ] });

    expect(info).not.toHaveBeenCalled();
  });

  it.each([
    'photo_comment',
    'photo_color_label',
    'photo_rating',
    'photo_like',
    'photo_favorite',
    'photo_reaction',
    'guest_feedback_batch_comment',
    'guest_retouch_selection_changed',
    'guest_retouch_selection_batch',
    'gallery_downloaded',
    'gallery_opened',
  ])('does not popup for customer activity %s even when its actor is recorded as system', (type) => {
    const { rerender } = renderHook(
      ({ notifications }) => useAdminNotificationToasts(notifications as never),
      { initialProps: { notifications: [] as Array<{ id: number; type: string; actorType: string; isRead: boolean }> } },
    );

    rerender({ notifications: [{ id: 10, type, actorType: 'system', isRead: false }] });

    expect(info).not.toHaveBeenCalled();
  });

  it('continues to show a popup for new internal activity', () => {
    const initial = [{ id: 1, type: 'admin_project_updated', actorType: 'admin', isRead: false }];
    const { rerender } = renderHook(
      ({ notifications }) => useAdminNotificationToasts(notifications as never),
      { initialProps: { notifications: initial } },
    );

    rerender({ notifications: [
      ...initial,
      { id: 2, type: 'admin_project_updated', actorType: 'admin', isRead: false },
    ] });

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith('message:admin_project_updated', {
      toastId: 'admin-notification-2',
    });
  });

  it('keeps the current admin own saved action in the bell without duplicating the save toast', () => {
    const initial = [{ id: 1, type: 'branding_updated', actorType: 'admin', actorId: 7, isRead: false }];
    const { rerender } = renderHook(
      ({ notifications, currentAdminId }) => useAdminNotificationToasts(notifications as never, currentAdminId),
      { initialProps: { notifications: initial, currentAdminId: 7 } },
    );

    rerender({
      notifications: [...initial, { id: 2, type: 'branding_updated', actorType: 'admin', actorId: 7, isRead: false }],
      currentAdminId: 7,
    });
    expect(info).not.toHaveBeenCalled();

    rerender({
      notifications: [
        ...initial,
        { id: 2, type: 'branding_updated', actorType: 'admin', actorId: 7, isRead: false },
        { id: 3, type: 'admin_project_updated', actorType: 'admin', actorId: 8, isRead: false },
      ],
      currentAdminId: 7,
    });
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('does not show a popup for already-read notifications', () => {
    const initial = [{ id: 1, type: 'guest_feedback_comment', actorType: 'guest', isRead: false }];
    const { rerender } = renderHook(
      ({ notifications }) => useAdminNotificationToasts(notifications as never),
      { initialProps: { notifications: initial } },
    );

    rerender({ notifications: [...initial, { id: 2, type: 'admin_project_updated', actorType: 'admin', isRead: true }] });
    expect(info).not.toHaveBeenCalled();
  });
});
