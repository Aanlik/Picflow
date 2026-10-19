import { useQuery } from '@tanstack/react-query';
import { settingsService } from '../../../services/settings.service';
import { useStorageInfo } from './useStorageInfo';

export function useStatusTab(isActive: boolean) {
  // Fetch storage info
  const { data: storageInfo } = useStorageInfo(isActive);

  // Fetch system status
  const { data: systemStatus } = useQuery({
    queryKey: ['system-status'],
    queryFn: () => settingsService.getSystemStatus(),
    enabled: isActive,
    refetchInterval: 30000
  });

  return {
    storageInfo,
    systemStatus,
  };
}
