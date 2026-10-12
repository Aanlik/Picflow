import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { feedbackService } from '../../services/feedback.service';
import { useGalleryFeedbackSettings } from '../useGalleryFeedbackSettings';

vi.mock('../../services/feedback.service', () => ({
  feedbackService: { getGalleryFeedbackSettings: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useGalleryFeedbackSettings', () => {
  it('waits for the real gallery event id instead of treating the preview placeholder as final', async () => {
    vi.mocked(feedbackService.getGalleryFeedbackSettings).mockResolvedValue({
      feedback_enabled: true,
      allow_comments: true,
      identity_mode: 'guest',
    } as any);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result, rerender } = renderHook(
      ({ eventId }: { eventId: number | undefined }) => useGalleryFeedbackSettings('gallery', eventId),
      { initialProps: { eventId: 0 }, wrapper },
    );

    expect(feedbackService.getGalleryFeedbackSettings).not.toHaveBeenCalled();
    rerender({ eventId: 42 });

    await waitFor(() => expect(feedbackService.getGalleryFeedbackSettings).toHaveBeenCalledWith('gallery'));
    await waitFor(() => expect(result.current.data?.identity_mode).toBe('guest'));
    expect(result.current.data?.feedback_enabled).toBe(true);
  });
});
