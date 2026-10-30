import { useQuery } from '@tanstack/react-query';
import { notificationsService } from '../services/notifications.service';

/** One shared inbox payload keeps the bell and dashboard read state identical. */
export const ADMIN_NOTIFICATIONS_QUERY_KEY = ['notifications', 'feed', 20] as const;

export function useAdminNotifications() {
  return useQuery({
    queryKey: ADMIN_NOTIFICATIONS_QUERY_KEY,
    queryFn: () => notificationsService.getNotifications(true, 20),
    staleTime: 0,
    // Keep the unread bell and dashboard feed close to real time after a
    // customer action; customer activity itself is intentionally not toasted.
    refetchInterval: 2_000,
    refetchOnWindowFocus: true,
  });
}
