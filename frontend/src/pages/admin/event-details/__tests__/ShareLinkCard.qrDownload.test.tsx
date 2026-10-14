import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShareLinkCard } from '../ShareLinkCard';
import type { Event } from '../../../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../services/events.service', () => ({
  eventsService: {
    getQrBlob: vi.fn().mockResolvedValue(new Blob(['qr image'])),
    getQrPrintBlob: vi.fn().mockResolvedValue(new Blob(['qr print'])),
    getGalleryPassword: vi.fn(),
    getGalleryPasswordStatus: vi.fn().mockResolvedValue({ enabled: false }),
  },
}));

import { toast } from 'react-toastify';
import { eventsService } from '../../../../services/events.service';

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
const originalWindowSetTimeout = window.setTimeout;

const event = {
  id: 42,
  slug: 'qr-test',
  event_name: 'QR test',
  share_link: '/gallery/qr-test/token',
  require_password: true,
  client_access_enabled: false,
  is_archived: false,
} as unknown as Event;

afterEach(() => {
  vi.restoreAllMocks();
  window.setTimeout = originalWindowSetTimeout;
  if (originalCreateObjectUrl) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl);
  else delete (URL as any).createObjectURL;
  if (originalRevokeObjectUrl) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl);
  else delete (URL as any).revokeObjectURL;
});

describe('ShareLinkCard QR downloads', () => {
  it('keeps the blob URL alive until the browser has had time to start saving it', async () => {
    const revoke = vi.fn();
    const create = vi.fn(() => 'blob:qr-test');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <ShareLinkCard event={event} setShowPasswordReset={vi.fn()} />
      </QueryClientProvider>,
    );

    const downloadButton = await screen.findByRole('button', { name: 'SVG' });
    let scheduledDelay = 0;
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: any[]) => {
      if (delay === 60_000) {
        scheduledDelay = delay;
        return 1;
      }
      return originalWindowSetTimeout(handler, delay, ...args);
    }) as typeof window.setTimeout;
    fireEvent.click(downloadButton);
    await Promise.resolve();
    await Promise.resolve();

    expect(click).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledTimes(2); // QR preview and download.
    expect(revoke).not.toHaveBeenCalled();
    expect(scheduledDelay).toBe(60_000);
    expect(toast.success).toHaveBeenCalledWith('events.downloadStarted');
  });
});
