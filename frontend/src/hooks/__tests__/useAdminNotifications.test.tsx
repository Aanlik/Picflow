import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

const getNotifications = vi.fn();
vi.mock('../../services/notifications.service', () => ({
  notificationsService: { getNotifications: (...args: unknown[]) => getNotifications(...args) },
}));

import { useAdminNotifications } from '../useAdminNotifications';

describe('shared admin notification feed', () => {
  it('gives the header and dashboard the same read state from one shared query', async () => {
    const unread = {
      notifications: [{ id: 7, isRead: false, createdAt: '2026-10-11T00:00:00Z' }],
      unreadCount: 1,
    };
    const read = {
      notifications: [{ id: 7, isRead: true, createdAt: '2026-10-11T00:00:00Z' }],
      unreadCount: 0,
    };
    getNotifications.mockResolvedValueOnce(unread).mockResolvedValueOnce(read);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const header = renderHook(() => useAdminNotifications(), { wrapper });
    const dashboard = renderHook(() => useAdminNotifications(), { wrapper });
    const feedQuery = client.getQueryCache().find({ queryKey: ['notifications', 'feed', 20] });
    expect(feedQuery?.options.refetchInterval).toBe(2_000);
    expect(feedQuery?.options.staleTime).toBe(0);

    await waitFor(() => expect(header.result.current.data).toEqual(unread));
    expect(dashboard.result.current.data).toEqual(unread);

    await act(async () => {
      await client.invalidateQueries({ queryKey: ['notifications'] });
    });
    await waitFor(() => expect(header.result.current.data).toEqual(read));
    expect(dashboard.result.current.data).toEqual(read);
    expect(getNotifications).toHaveBeenCalledTimes(2);
    expect(getNotifications).toHaveBeenCalledWith(true, 20);

    client.clear();
  });
});
