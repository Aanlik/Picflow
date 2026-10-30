import { useQuery } from '@tanstack/react-query';
import { settingsService } from '../../../services/settings.service';

export const STORAGE_INFO_QUERY_KEY = ['storage-info'] as const;

/**
 * Storage usage is shown in both the admin sidebar and system settings. One
 * shared query keeps both displays in sync when project/archive actions or
 * storage-limit settings invalidate the cached value.
 */
export function useStorageInfo(enabled = true, refetchInterval?: number | false) {
  return useQuery({
    queryKey: STORAGE_INFO_QUERY_KEY,
    queryFn: () => settingsService.getStorageInfo(),
    enabled,
    ...(refetchInterval !== undefined ? { refetchInterval } : {}),
  });
}
