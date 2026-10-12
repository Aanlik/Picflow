import { useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import { notificationsService, type Notification } from '../services/notifications.service';

const CUSTOMER_ACTIVITY_TYPES = new Set([
  'photo_comment',
  'photo_color_label',
  'photo_favorite',
  'photo_like',
  'photo_rating',
  'photo_reaction',
  'gallery_downloaded',
  'gallery_opened',
]);

function isCustomerActivity(notification: Notification) {
  return notification.actorType === 'guest'
    || notification.actorType === 'customer'
    || CUSTOMER_ACTIVITY_TYPES.has(notification.type)
    || notification.type.startsWith('guest_feedback_')
    || notification.type.startsWith('guest_retouch_');
}

/** Show new internal activity as a popup; customer actions stay in the notification feed. */
export function useAdminNotificationToasts(notifications?: Notification[]) {
  const seenNotificationIdsRef = useRef<Set<number> | null>(null);

  useEffect(() => {
    if (!notifications) return;

    const previousIds = seenNotificationIdsRef.current;
    if (previousIds) {
      notifications
        .filter((notification) =>
          !notification.isRead
          && !previousIds.has(notification.id)
          && !isCustomerActivity(notification),
        )
        .slice()
        .reverse()
        .forEach((notification) => {
          toast.info(notificationsService.formatNotificationMessage(notification), {
            toastId: `admin-notification-${notification.id}`,
          });
        });
    }

    // Seed on first load so existing unread activity is not replayed as a
    // burst when a photographer opens or refreshes the workbench.
    seenNotificationIdsRef.current = new Set(notifications.map((notification) => notification.id));
  }, [notifications]);
}
