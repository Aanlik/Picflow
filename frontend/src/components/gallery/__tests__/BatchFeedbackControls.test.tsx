import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BatchFeedbackControls } from '../BatchFeedbackControls';
import { feedbackService } from '../../../services/feedback.service';
import { galleryService } from '../../../services/gallery.service';
import { toast } from 'react-toastify';

vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({ t: (key: string, options?: { count?: number }) => `${key}${options?.count === undefined ? '' : `:${options.count}`}` }),
}));
vi.mock('../../../services/feedback.service', () => ({ feedbackService: { submitBatchFeedback: vi.fn() } }));
vi.mock('../../../services/gallery.service', () => ({ galleryService: { submitBatchRetouchSelections: vi.fn() } }));
vi.mock('react-toastify', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('batch proofing actions', () => {
  it('submits retouch selections through the dedicated workflow endpoint', async () => {
    vi.mocked(galleryService.submitBatchRetouchSelections).mockResolvedValue({
      success: true, applied_count: 2, selected: true, photo_ids: [12, 15],
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}>
      <BatchFeedbackControls slug="gallery" photoIds={[12, 15]} retouchEnabled commentsEnabled requireGuestName={false} />
    </QueryClientProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'gallery.batchMarkForEditing' }));

    await waitFor(() => expect(galleryService.submitBatchRetouchSelections).toHaveBeenCalledWith('gallery', [12, 15], true));
    expect(feedbackService.submitBatchFeedback).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('gallery.batchMarkedForEditing:2');
  });
});
