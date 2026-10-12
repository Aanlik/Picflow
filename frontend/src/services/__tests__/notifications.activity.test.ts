/**
 * Client-activity notification types (#746): gallery_opened /
 * gallery_downloaded (new logActivity calls in gallery.js) and
 * photo_favorite (logged by feedbackService since #400-era) must resolve
 * through the smart camelCase fallback in formatNotificationMessage —
 * i.e. the locale keys must exist, otherwise the bell renders the generic
 * "system activity" line.
 */
import { describe, it, expect } from 'vitest';
import i18n from '../../i18n/config';
import { notificationsService, type Notification } from '../notifications.service';

const base: Omit<Notification, 'type'> = {
  id: 1,
  actorType: 'guest',
  actorName: null,
  eventName: 'Anna & Tom',
  eventId: 42,
  metadata: {},
  createdAt: '2026-07-19T12:00:00Z',
  readAt: null,
  isRead: false,
} as any;

describe('client-activity notifications (#746)', () => {
  it.each(['gallery_opened', 'gallery_downloaded', 'photo_favorite'])(
    'formats %s via a real locale key (no generic fallback)',
    async (type) => {
      await i18n.changeLanguage('en');
      const msg = notificationsService.formatNotificationMessage({ ...base, type } as Notification);
      expect(msg).toContain('Anna & Tom');
      expect(msg.toLowerCase()).not.toContain('system activity');
    }
  );

  it('has a distinct style for each new type', () => {
    const opened = notificationsService.getNotificationStyle('gallery_opened');
    const downloaded = notificationsService.getNotificationStyle('gallery_downloaded');
    const favorite = notificationsService.getNotificationStyle('photo_favorite');
    expect(opened.icon).toBe('Eye');
    expect(downloaded.icon).toBe('Download');
    expect(favorite.icon).toBe('Heart');
  });

  it('formats older system activities in Simplified Chinese instead of showing stored English text', async () => {
    await i18n.changeLanguage('zh-CN');
    const message = notificationsService.formatNotificationMessage({
      ...base,
      type: 'gallery_password_viewed',
      metadata: { message: 'The password was viewed by a photographer' },
    } as Notification);
    expect(message).toBe('管理员查看了项目访问密码');
    expect(message).not.toContain('The password');
  });

  it('uses concrete customer feedback and retouch details instead of the generic activity line', async () => {
    await i18n.changeLanguage('zh-CN');
    const messages = [
      notificationsService.formatNotificationMessage({ ...base, type: 'guest_feedback_color_label' } as Notification),
      notificationsService.formatNotificationMessage({ ...base, type: 'photo_color_label' } as Notification),
      notificationsService.formatNotificationMessage({
        ...base, type: 'guest_feedback_batch_comment', metadata: { photo_ids: [1, 2, 3] },
      } as Notification),
      notificationsService.formatNotificationMessage({
        ...base, type: 'guest_retouch_selection_changed', metadata: { selected: true, filename: 'IMG_001.jpg' },
      } as Notification),
      notificationsService.formatNotificationMessage({
        ...base, type: 'guest_retouch_selection_batch', metadata: { selected: true, photo_ids: [1, 2] },
      } as Notification),
    ];

    expect(messages[0]).toContain('标记了');
    expect(messages[1]).toContain('颜色标记已更新');
    expect(messages[2]).toContain('3 张照片');
    expect(messages[3]).toContain('IMG_001.jpg');
    expect(messages[4]).toContain('2 张照片');
    for (const message of messages) expect(message).not.toBe('系统记录了一项操作。');
  });

  it('includes the named customer in customer-action notifications', async () => {
    await i18n.changeLanguage('zh-CN');
    const namedActions = [
      { type: 'guest_retouch_selection_changed', metadata: { selected: true, filename: 'IMG_001.jpg' } },
      { type: 'guest_retouch_selection_batch', metadata: { selected: true, count: 2 } },
      { type: 'guest_feedback_batch_comment', metadata: { count: 3 } },
      { type: 'guest_feedback_color_label', metadata: {} },
      { type: 'gallery_opened', metadata: {} },
      { type: 'gallery_downloaded', actorType: 'customer', metadata: {} },
      { type: 'photo_favorite', metadata: {} },
    ];
    const messages = namedActions.map((action) => notificationsService.formatNotificationMessage({
      ...base, actorName: '小林', ...action,
    } as Notification));
    for (const message of messages) expect(message).toContain('小林');
    expect(messages[0]).toContain('IMG_001.jpg');
  });

  it('uses a localized generic message for an unknown legacy notification', async () => {
    await i18n.changeLanguage('zh-CN');
    const message = notificationsService.formatNotificationMessage({
      ...base,
      type: 'future_activity_type',
      metadata: { message: 'An English message from an older server' },
    } as Notification);
    expect(message).toBe('系统记录了一项操作。');
    expect(message).not.toContain('English');
  });
});
