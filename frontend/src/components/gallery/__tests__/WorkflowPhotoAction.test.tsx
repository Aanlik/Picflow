import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Photo } from '../../../types';
import { galleryService } from '../../../services/gallery.service';
import { toast } from 'react-toastify';
import { WorkflowPhotoAction } from '../WorkflowPhotoAction';
import { PhotoCard } from '../PhotoCard';

vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../../services/gallery.service', () => ({ galleryService: {
  setRetouchSelection: vi.fn(),
  withdrawRetouchSelection: vi.fn(),
} }));
vi.mock('../../../contexts/GuestIdentityContext', () => ({ useGuestIdentityOptional: () => null }));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../common', () => ({ AuthenticatedImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
vi.mock('react-intersection-observer', () => ({ useInView: () => ({ ref: () => {}, inView: true }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const photo = (overrides: Partial<Photo> = {}) => ({
  id: 42,
  filename: 'IMG_0042.jpg',
  url: '/photo/42',
  type: 'individual',
  size: 1,
  uploaded_at: '2026-01-01T00:00:00Z',
  retouch_workflow_enabled: true,
  retouch_state: 'proof',
  my_color_label: null,
  ...overrides,
} as Photo);

function renderAction(item: Photo, onRequestClick = vi.fn(), placement: 'overlay' | 'toolbar' = 'overlay') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onRequestClick,
    ...render(<QueryClientProvider client={queryClient}>
      <WorkflowPhotoAction photo={item} slug="gallery" onRequestClick={onRequestClick} placement={placement} />
    </QueryClientProvider>),
  };
}

describe('customer retouch workflow photo actions', () => {
  it('shows a clear action and writes to the dedicated retouch-selection endpoint', async () => {
    vi.mocked(galleryService.setRetouchSelection).mockResolvedValue({ success: true, selected: true });
    renderAction(photo());

    fireEvent.click(screen.getByRole('button', { name: 'photographyWorkflow.selectForRetouch' }));

    await waitFor(() => expect(galleryService.setRetouchSelection).toHaveBeenCalledWith('gallery', 42, true));
    expect(await screen.findByRole('button', { name: 'photographyWorkflow.cancelSelection' })).toHaveAttribute('aria-pressed', 'true');
    expect(toast.success).toHaveBeenCalledWith('photographyWorkflow.selectionAdded');
  });

  it('opens the retouch request panel for a delivered photo', () => {
    const onRequestClick = vi.fn();
    renderAction(photo({ retouch_state: 'delivered', retouch_version: 2 }), onRequestClick);

    fireEvent.click(screen.getByRole('button', { name: 'retouchRequest.open' }));

    expect(onRequestClick).toHaveBeenCalledTimes(1);
    expect(galleryService.setRetouchSelection).not.toHaveBeenCalled();
  });

  it('renders a separate toolbar action in the single-photo view', () => {
    renderAction(photo(), vi.fn(), 'toolbar');
    const action = screen.getByRole('button', { name: 'photographyWorkflow.selectForRetouch' });

    expect(action.className).toContain('relative');
    expect(action.className).not.toContain('absolute');
  });

  it('renders the workflow action directly on a customer photo card', async () => {
    const item = photo();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}>
      <PhotoCard
        photo={item}
        isSelected={false}
        isSelectionMode={false}
        onClick={vi.fn()}
        onDownload={vi.fn()}
        onToggleSelect={vi.fn()}
        className="photo-card relative"
        overlayBaseClassName="absolute inset-0"
        imageProps={{ src: item.url, alt: item.filename }}
        slug="gallery"
      />
    </QueryClientProvider>);

    expect(await screen.findByRole('button', { name: 'photographyWorkflow.selectForRetouch' })).toBeInTheDocument();
  });

  it('shows a visible per-photo comments entry without hovering', () => {
    const onQuickComment = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}>
      <PhotoCard
        photo={photo()}
        isSelected={false}
        isSelectionMode={false}
        onClick={vi.fn()}
        onDownload={vi.fn()}
        onToggleSelect={vi.fn()}
        className="photo-card relative"
        overlayBaseClassName="absolute inset-0"
        imageProps={{ src: '/photo/42', alt: 'IMG_0042.jpg' }}
        slug="gallery"
        feedbackEnabled
        feedbackOptions={{ allowComments: true }}
        onQuickComment={onQuickComment}
      />
    </QueryClientProvider>);

    const commentButton = screen.getByRole('button', { name: 'ui.commentOnPhoto' });
    expect(commentButton).toBeVisible();
    expect(commentButton).toHaveTextContent('ui.comment');
    fireEvent.click(commentButton);
    expect(onQuickComment).toHaveBeenCalledOnce();
  });

  it('explains when the backend requires a customer identity or the workflow is unavailable', async () => {
    vi.mocked(galleryService.setRetouchSelection).mockRejectedValueOnce({
      response: { status: 401, data: { code: 'GUEST_IDENTITY_REQUIRED' } },
    });
    renderAction(photo());
    fireEvent.click(screen.getByRole('button', { name: 'photographyWorkflow.selectForRetouch' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('photographyWorkflow.identityRequired'));

    vi.mocked(galleryService.setRetouchSelection).mockRejectedValueOnce({
      response: { status: 503, data: { error: 'Retouch workflow is not connected' } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'photographyWorkflow.selectForRetouch' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('photographyWorkflow.workflowUnavailable'));
  });

  it('shows the workflow stage and keeps the green color-label badge independent', async () => {
    const item = photo({ retouch_state: 'selected', retouch_selected: true, my_color_label: 'green' });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}>
      <PhotoCard
        photo={item}
        isSelected={false}
        isSelectionMode={false}
        onClick={vi.fn()}
        onDownload={vi.fn()}
        onToggleSelect={vi.fn()}
        className="photo-card relative"
        overlayBaseClassName="absolute inset-0"
        imageProps={{ src: item.url, alt: item.filename }}
        slug="gallery"
      />
    </QueryClientProvider>);

    expect(await screen.findByLabelText('photographyWorkflow.clientState.selected')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'feedback.markedAs' })).toBeInTheDocument();
  });
});
