import { api } from '../config/api';
import i18n from '../i18n/config';

export interface Notification {
  id: number;
  type: string;
  actorType: string;
  actorName: string | null;
  eventName?: string;
  eventId?: number;
  metadata: Record<string, any>;
  createdAt: string;
  readAt?: string;
  isRead: boolean;
}

export interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
  totalCount: number;
}

function withCustomerName(message: string, notification: Notification): string {
  if (!['guest', 'customer'].includes(notification.actorType)) return message;
  const name = notification.actorName?.trim();
  if (!name || ['anonymous', 'guest', 'customer', 'visitor', '客户', '访客', '匿名访客'].includes(name.toLocaleLowerCase())) {
    return message;
  }
  return i18n.language.toLocaleLowerCase().startsWith('zh')
    ? `${message}（${name}）`
    : `${message} (${name})`;
}

function localizeSettingsCategory(value: unknown, t: (key: string, options?: any) => string): string {
  const normalized = String(value || 'system').trim().toLocaleLowerCase();
  switch (normalized) {
    case 'security': return t('admin.notificationMessages.settingsCategories.security');
    case 'general': return t('admin.notificationMessages.settingsCategories.general');
    case 'branding': return t('admin.notificationMessages.settingsCategories.branding');
    case 'features': return t('admin.notificationMessages.settingsCategories.features');
    case 'backup': return t('admin.notificationMessages.settingsCategories.backup');
    case 'seo': return t('admin.notificationMessages.settingsCategories.seo');
    case 'system':
    default: return t('admin.notificationMessages.settingsCategories.system');
  }
}

export const notificationsService = {
  // Get notifications
  async getNotifications(includeRead: boolean = false, limit: number = 20): Promise<NotificationsResponse> {
    const response = await api.get('/admin/notifications', {
      params: { includeRead, limit }
    });
    return response.data;
  },

  // Mark single notification as read
  async markAsRead(notificationId: number): Promise<void> {
    await api.put(`/admin/notifications/${notificationId}/read`);
  },

  // Mark all notifications as read
  async markAllAsRead(): Promise<void> {
    await api.put('/admin/notifications/read-all');
  },

  // Clear all notifications
  async clearAllNotifications(): Promise<{ deletedCount: number }> {
    const response = await api.delete('/admin/notifications/clear-all');
    return response.data;
  },

  // Format notification message
  formatNotificationMessage(notification: Notification): string {
    const t = i18n.t;
    switch (notification.type) {
      case 'event_created':
        return t('admin.notificationMessages.eventCreated', { eventName: notification.eventName });
      case 'guest_retouch_selection_changed':
        return withCustomerName(t(notification.metadata.selected
          ? 'admin.activities.guest_retouch_selection_added'
          : 'admin.activities.guest_retouch_selection_removed', {
          eventName: notification.eventName,
          filename: notification.metadata.filename,
        }), notification);
      case 'guest_retouch_selection_batch':
        return withCustomerName(t(notification.metadata.selected
          ? 'admin.activities.guest_retouch_selection_batch_added'
          : 'admin.activities.guest_retouch_selection_batch_removed', {
          eventName: notification.eventName,
          count: notification.metadata.count ?? notification.metadata.photo_ids?.length ?? 0,
        }), notification);
      case 'event_archived':
        return t('admin.notificationMessages.eventArchived', { eventName: notification.eventName });
      case 'event_updated':
        return t('admin.notificationMessages.eventUpdated', {
          eventName: notification.eventName || notification.metadata.eventName
        });
      case 'event_deleted':
        return t('admin.notificationMessages.eventDeleted', {
          eventName: notification.metadata.event_name
        });
      case 'photos_uploaded':
        return t('admin.notificationMessages.photosUploaded', {
          count: notification.metadata.count || 0,
          eventName: notification.eventName
        });
      case 'photo_deleted':
        return t('admin.notificationMessages.photoDeleted', { eventName: notification.eventName });
      case 'photos_bulk_deleted':
        return t('admin.notificationMessages.photosBulkDeleted', {
          count: notification.metadata.count || 0,
          eventName: notification.eventName
        });
      case 'event_expiring':
        return t('admin.notificationMessages.eventExpiring', {
          eventName: notification.eventName,
          days: notification.metadata.days || 0
        });
      case 'event_expired':
        return t('admin.notificationMessages.eventExpired', { eventName: notification.eventName });
      case 'password_changed':
        return t('admin.notificationMessages.passwordChanged', { actorName: notification.actorName });
      case 'password_reset':
        return t('admin.notificationMessages.passwordReset', {
          eventName: notification.metadata.eventName
        });
      case 'settings_updated':
        return t('admin.notificationMessages.settingsUpdated', {
          type: localizeSettingsCategory(notification.metadata.type, t)
        });
      case 'bulk_download':
        return t('admin.notificationMessages.bulkDownload', {
          count: notification.metadata.count || 0,
          eventName: notification.eventName
        });
      case 'storage_warning':
        return t('admin.notificationMessages.storageWarning', {
          percentage: notification.metadata.percentage || 0
        });
      case 'admin_logout':
        return t('admin.notificationMessages.adminLogout', { actorName: notification.actorName });
      case 'category_created':
        return t('admin.notificationMessages.categoryCreated', {
          name: notification.metadata.name,
          eventName: notification.eventName
        });
      case 'category_updated':
        return t('admin.notificationMessages.categoryUpdated', {
          name: notification.metadata.name,
          eventName: notification.eventName
        });
      case 'category_deleted':
        return t('admin.notificationMessages.categoryDeleted', {
          name: notification.metadata.name,
          eventName: notification.eventName
        });
      case 'cms_page_updated':
        return t('admin.notificationMessages.cmsPageUpdated', {
          slug: notification.metadata.slug
        });
      case 'favicon_uploaded':
        return t('admin.notificationMessages.faviconUploaded');
      case 'branding_updated':
        return t('admin.notificationMessages.brandingUpdated');
      case 'general_settings_updated':
        return t('admin.notificationMessages.generalSettingsUpdated');
      case 'security_settings_updated':
        return t('admin.notificationMessages.securitySettingsUpdated');
      case 'admin_profile_updated':
        return t('admin.notificationMessages.adminProfileUpdated', {
          actorName: notification.actorName,
        });
      case 'theme_updated':
        return t('admin.notificationMessages.themeUpdated');
      case 'archive_downloaded':
        return t('admin.notificationMessages.archiveDownloaded', {
          eventName: notification.metadata.event_name
        });
      case 'archive_deleted':
        return t('admin.notificationMessages.archiveDeleted', {
          eventName: notification.metadata.event_name
        });
      case 'archive_restored':
        return t('admin.notificationMessages.archiveRestored', {
          eventName: notification.metadata.event_name
        });

      // ---- Feature flags --------------------------------------------------
      case 'feature_flags_updated':
        return t('admin.notificationMessages.settingsUpdated', { type: t('navigation.features', '功能设置') });

      // Client activity (#746): downloads carry the real actor — customer
      // sessions must not read as "A guest…" (codex review of #849).
      case 'gallery_downloaded':
        return withCustomerName(notification.actorType === 'customer'
          ? t('admin.notificationMessages.galleryDownloadedCustomer', { eventName: notification.eventName })
          : t('admin.notificationMessages.galleryDownloaded', { eventName: notification.eventName }), notification);

      case 'admin_user_updated':
        return t('admin.notificationMessages.adminUserUpdated', {
          username: notification.metadata.username || notification.actorName,
        });
      case 'admin_user_deactivated':
        return t('admin.notificationMessages.adminUserDeactivated', {
          username: notification.metadata.username || notification.actorName,
        });
      case 'admin_password_reset':
        return t('admin.notificationMessages.adminPasswordResetByAdmin', {
          username: notification.metadata.username || notification.actorName,
        });

      // ---- Other recent surfaces ------------------------------------------
      case 'event_published':
        return t('admin.notificationMessages.eventPublished', {
          eventName: notification.eventName || notification.metadata.event_name,
        });
      case 'event_logo_uploaded':
        return t('admin.notificationMessages.eventLogoUploaded', { eventName: notification.eventName });
      case 'event_logo_removed':
        return t('admin.notificationMessages.eventLogoRemoved', { eventName: notification.eventName });
      case 'bulk_delete_completed':
        return t('admin.notificationMessages.bulkDeleteCompleted', {
          count: notification.metadata.successfulCount ?? notification.metadata.deleted ?? notification.metadata.count ?? 0,
        });
      // The bulk routes log `successfulCount` (see adminEvents/archiveBulk.js),
      // never `count` — without the mapping the default branch below spread a
      // metadata object with no `count`, so i18next left the literal
      // "{{count}}" in the bell (QA B.06b).
      case 'bulk_archive_completed':
        return t('admin.notificationMessages.bulkArchiveCompleted', {
          count: notification.metadata.successfulCount ?? notification.metadata.count ?? 0,
        });
      case 'photo_replaced':
        return t('admin.notificationMessages.photoReplaced', { eventName: notification.eventName });
      case 'photo_uploaded':
        return t('admin.notificationMessages.photoUploaded', { eventName: notification.eventName });
      case 'category_hero_updated':
        return t('admin.notificationMessages.categoryHeroUpdated');
      case 'public_site_reset_to_default':
        return t('admin.notificationMessages.publicSiteResetToDefault');
      case 'cms_page_logo_uploaded':
        return t('admin.notificationMessages.cmsPageLogoUploaded', {
          slug: notification.metadata.slug,
        });

      default: {
        // Most gallery actions are already represented by their domain
        // activity key (the log's snake_case type). Prefer that specific
        // copy before the legacy notification-message aliases, so customer
        // feedback never collapses to the generic system line.
        const activityKey = `admin.activities.${notification.type}`;
        const activityCount = notification.metadata.count
          ?? notification.metadata.applied_count
          ?? (Array.isArray(notification.metadata.photo_ids) ? notification.metadata.photo_ids.length : undefined);
        if (i18n.exists(activityKey)) {
          const message = t(activityKey, {
            eventName: notification.eventName || notification.metadata.event_name || notification.metadata.eventName,
            actorName: notification.actorName,
            count: activityCount,
            filename: notification.metadata.filename,
            selected: notification.metadata.selected,
            ...notification.metadata,
          });
          return notification.type.startsWith('guest_') || notification.type.startsWith('photo_') || notification.type === 'gallery_opened'
            ? withCustomerName(message, notification)
            : message;
        }
        // Smart fallback: try to resolve admin.notificationMessages.<camelCase>
        // directly before giving up to the systemActivity template. Activity
        // metadata is passed through so each translation can use its values
        // without a per-type switch case.
        const camelCase = notification.type.replace(/_(\w)/g, (_match, c) => c.toUpperCase());
        const key = `admin.notificationMessages.${camelCase}`;
        const translated = t(key, {
          eventName: notification.eventName,
          actorName: notification.actorName,
          ...notification.metadata,
        });
        if (translated && translated !== key) return translated as string;
        // Never surface the server's raw message here: older rows can contain
        // English text even while the admin has selected Simplified Chinese.
        // Known activity types use locale keys above; unknown historical types
        // receive a neutral localized message instead of leaking that text.
        console.warn('Unknown notification type:', notification.type);
        return t('admin.notificationMessages.unknownActivity');
      }
    }
  },

  // Get notification icon and color
  getNotificationStyle(type: string): { icon: string; color: string } {
    switch (type) {
      case 'event_created':
        return { icon: 'Calendar', color: 'text-blue-600' };
      case 'event_archived':
        return { icon: 'Archive', color: 'text-green-600' };
      case 'event_updated':
      case 'event_deleted':
        return { icon: 'Calendar', color: 'text-gray-600' };
      case 'photos_uploaded':
        return { icon: 'Image', color: 'text-purple-600' };
      case 'photo_deleted':
      case 'photos_bulk_deleted':
        return { icon: 'Image', color: 'text-red-600' };
      case 'event_expiring':
        return { icon: 'AlertCircle', color: 'text-amber-600' };
      case 'event_expired':
        return { icon: 'Clock', color: 'text-red-600' };
      case 'password_changed':
      case 'password_reset':
        return { icon: 'Lock', color: 'text-indigo-600' };
      case 'settings_updated':
      case 'branding_updated':
      case 'general_settings_updated':
      case 'security_settings_updated':
      case 'theme_updated':
        return { icon: 'Settings', color: 'text-gray-600' };
      case 'admin_profile_updated':
        return { icon: 'User', color: 'text-primary-600' };
      case 'bulk_download':
        return { icon: 'Download', color: 'text-cyan-600' };
      case 'storage_warning':
        return { icon: 'Database', color: 'text-orange-600' };
      case 'admin_logout':
        return { icon: 'LogOut', color: 'text-gray-600' };
      case 'category_created':
      case 'category_updated':
      case 'category_deleted':
        return { icon: 'Folder', color: 'text-indigo-600' };
      case 'cms_page_updated':
        return { icon: 'FileText', color: 'text-green-600' };
      case 'favicon_uploaded':
        return { icon: 'Globe', color: 'text-purple-600' };
      case 'archive_downloaded':
      case 'archive_deleted':
      case 'archive_restored':
        return { icon: 'Archive', color: 'text-blue-600' };

      // Feature flag toggles use the settings icon.
      case 'feature_flags_updated':
        return { icon: 'ToggleRight', color: 'text-amber-600' };
      case 'admin_user_updated':
      case 'admin_user_deactivated':
        return { icon: 'UserCog', color: 'text-gray-600' };
      case 'admin_password_reset':
        return { icon: 'Lock', color: 'text-indigo-600' };
      case 'event_published':
        return { icon: 'CheckCircle', color: 'text-green-600' };
      case 'event_logo_uploaded':
      case 'event_logo_removed':
        return { icon: 'Image', color: 'text-pink-600' };
      case 'bulk_delete_completed':
        return { icon: 'Trash2', color: 'text-red-600' };
      case 'photo_replaced':
      case 'photo_uploaded':
        return { icon: 'Image', color: 'text-purple-600' };
      case 'category_hero_updated':
        return { icon: 'Folder', color: 'text-indigo-600' };
      case 'public_site_reset_to_default':
        return { icon: 'Globe', color: 'text-gray-600' };
      case 'cms_page_logo_uploaded':
        return { icon: 'FileText', color: 'text-green-600' };

      // Client activity (#746) — guest actions surfaced to the photographer.
      case 'gallery_opened':
        return { icon: 'Eye', color: 'text-blue-600' };
      case 'gallery_downloaded':
        return { icon: 'Download', color: 'text-green-600' };
      case 'photo_favorite':
        return { icon: 'Heart', color: 'text-pink-600' };
      default:
        return { icon: 'Bell', color: 'text-gray-600' };
    }
  }
};
