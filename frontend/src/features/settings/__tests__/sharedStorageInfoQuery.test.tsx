import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsService } from '../../../services/settings.service';
import { STORAGE_INFO_QUERY_KEY, useStorageInfo } from '../hooks/useStorageInfo';

function StorageReader({ name }: { name: string }) {
  const { data } = useStorageInfo();
  return <div>{name}: {data?.total_used ?? 'loading'}</div>;
}

describe('shared storage information query', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps sidebar and settings observers on the same cache entry', async () => {
    vi.spyOn(settingsService, 'getStorageInfo').mockResolvedValue({ total_used: 12 } as never);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <StorageReader name="sidebar" />
        <StorageReader name="settings" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('sidebar: 12')).toBeInTheDocument());
    expect(screen.getByText('settings: 12')).toBeInTheDocument();
    expect(queryClient.getQueryCache().findAll({ queryKey: STORAGE_INFO_QUERY_KEY })).toHaveLength(1);
    expect(settingsService.getStorageInfo).toHaveBeenCalledTimes(1);

    act(() => queryClient.setQueryData(STORAGE_INFO_QUERY_KEY, { total_used: 24 }));
    await waitFor(() => {
      expect(screen.getByText((_, element) => element?.textContent?.replace(/\s+/g, ' ').trim() === 'sidebar: 24')).toBeInTheDocument();
      expect(screen.getByText((_, element) => element?.textContent?.replace(/\s+/g, ' ').trim() === 'settings: 24')).toBeInTheDocument();
    });
  });
});
