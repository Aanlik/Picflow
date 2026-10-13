import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhotoComments } from '../PhotoComments';
import { feedbackService } from '../../../services/feedback.service';
import { toast } from 'react-toastify';

const { useGuestIdentityOptional } = vi.hoisted(() => ({ useGuestIdentityOptional: vi.fn() }));

vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({ t: (key: string, fallback?: string) => key === 'feedback.commentSubmitted' ? '评论已提交' : fallback || key }),
}));
vi.mock('../../../services/feedback.service', () => ({ feedbackService: { submitFeedback: vi.fn() } }));
vi.mock('react-toastify', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../contexts/GuestIdentityContext', () => ({ useGuestIdentityOptional }));
vi.mock('../../../hooks/useLocalizedDate', () => ({ useLocalizedDate: () => ({ format: (date: string) => `本地日期：${date}` }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('comment submission toast', () => {
  it('confirms a comment was submitted without showing an extra notice', async () => {
    vi.mocked(feedbackService.submitFeedback).mockResolvedValue({
      success: true,
      message: 'Comment submitted',
    } as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}>
      <PhotoComments photoId="21" gallerySlug="gallery" comments={[]} isEnabled requireGuestName={false} showToGuests />
    </QueryClientProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Add Comment' }));
    fireEvent.change(screen.getByPlaceholderText('Write a comment...'), { target: { value: '请精修这张照片' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('评论已提交'));
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('opens identity registration and retries when preview comments are rejected before identity registration', async () => {
    const ensureIdentity = vi.fn().mockResolvedValue({ id: 5, name: '客户 A' });
    useGuestIdentityOptional.mockReturnValue({ identityMode: 'simple', ensureIdentity });
    vi.mocked(feedbackService.submitFeedback)
      .mockRejectedValueOnce({ response: { status: 401, data: { code: 'GUEST_IDENTITY_REQUIRED' } } } as never)
      .mockResolvedValueOnce({ success: true, message: 'Comment submitted' } as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}>
      <PhotoComments photoId="22" gallerySlug="gallery" comments={[]} isEnabled requireGuestName={false} showToGuests />
    </QueryClientProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Add Comment' }));
    fireEvent.change(screen.getByPlaceholderText('Write a comment...'), { target: { value: '请精修这张照片' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(feedbackService.submitFeedback).toHaveBeenCalledTimes(2));
    expect(ensureIdentity).toHaveBeenCalledWith(true);
    expect(toast.success).toHaveBeenCalledWith('评论已提交');
  });

  it('formats comment dates through the shared locale-aware formatter', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}>
      <PhotoComments photoId="23" gallerySlug="gallery" comments={[{
        id: 1, feedback_type: 'comment', comment_text: '很好', created_at: '2026-10-13',
        guest_name: '客户 A', is_hidden: false, is_mine: true,
      } as never]} isEnabled requireGuestName={false} showToGuests />
    </QueryClientProvider>);

    expect(screen.getByText('本地日期：2026-10-13')).toBeInTheDocument();
  });
});
