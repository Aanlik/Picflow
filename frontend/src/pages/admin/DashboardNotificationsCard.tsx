import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, Loading } from '../../components/common';
import { notificationsService } from '../../services/notifications.service';
import { useLocalizedDate } from '../../hooks/useLocalizedDate';
import { useAdminNotifications } from '../../hooks/useAdminNotifications';

export function DashboardNotificationsCard() {
  const { t } = useTranslation();
  const { format } = useLocalizedDate();
  const { data, isLoading, isError } = useAdminNotifications();
  const notifications = data?.notifications.slice(0, 6) ?? [];
  // PostgreSQL drivers can return COUNT values as strings. i18next requires
  // a number for plural selection; passing "6" renders the raw translation key.
  const unreadCount = Number(data?.unreadCount ?? 0);
  const safeUnreadCount = Number.isFinite(unreadCount) && unreadCount > 0 ? unreadCount : 0;

  return (
    <Card padding="md">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          <Bell className="h-5 w-5 text-accent" />
          {t('admin.recentNotifications')}
        </h2>
        {safeUnreadCount > 0 && (
          <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-200">
            {t('admin.unreadNotifications', { count: safeUnreadCount })}
          </span>
        )}
      </div>
      {isLoading ? (
        <div className="py-6"><Loading size="sm" text={t('admin.loadingNotifications')} /></div>
      ) : isError ? (
        <p role="status" className="py-6 text-center text-sm text-neutral-500">{t('admin.notificationsUnavailable')}</p>
      ) : notifications.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">{t('admin.noRecentNotifications')}</p>
      ) : (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-700">
          {notifications.map((notification) => (
            <li key={notification.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${notification.isRead ? 'bg-neutral-300 dark:bg-neutral-600' : 'bg-accent-dark'}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-neutral-900 dark:text-neutral-100">
                  {notificationsService.formatNotificationMessage(notification)}
                </p>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  {format(new Date(notification.createdAt), 'PPp')}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
