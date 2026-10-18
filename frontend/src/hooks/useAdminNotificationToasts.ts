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
  // The CMS editor already reports a successful save inline. Showing the same
  // event as a second toast stacked a duplicate confirmation over the form;
  // the durable item remains in the notification feed.
  'cms_page_updated',
]);

function isCustomerActivity(notification: Notification) {
  return notification.actorType === 'guest'
    || notification.actorType === 'customer'
    || CUSTOMER_ACTIVITY_TYPES.has(notification.type)
    || notification.type.startsWith('guest_feedback_')
    || notification.type.startsWith('guest_retouch_');
}

/** Show new internal activity as a popup; customer actions stay in the notification feed. */
export function useAdminNotificationToasts(notifications?: Notification[], currentAdminId?: number | string) {
  const seenNotificationIdsRef = useRef<Set<number> | null>(null);

  useEffect(() => {
    if (!notifications) return;

    const previousIds = seenNotificationIdsRef.current;
    if (previousIds) {
      notifications
        .filter((notification) =>
          !notification.isRead
          && !previousIds.has(notification.id)
          && !isCustomerActivity(notification)
          && !(currentAdminId != null
            && Number.isFinite(Number(currentAdminId))
            && Number(notification.actorId) === Number(currentAdminId)),
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
