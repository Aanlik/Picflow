import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhotographyWorkflowCard } from '../PhotographyWorkflowCard';
import { api } from '../../../config/api';
vi.mock('../../../config/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
describe('photography workflow summary', () => {
  it('shows actual later selections, revision and cancellation counts', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => url.endsWith('/requests')
      ? { data: { requests: [] } } as any
      : { data: { configured: true, stage: 'EDITING', connected: true, summary: { '追加选片': 5, '返修': 1, '取消待确认': 2 }, photos: [] } } as any);
    render(<PhotographyWorkflowCard eventId={7} />);
    await waitFor(() => expect(screen.getByText('Added selections')).toBeTruthy());
    expect(screen.getByText('5')).toBeTruthy(); expect(screen.getByText('Revisions')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/admin/photography-workflow/7');
    expect(screen.getByRole('combobox', { name: 'Project stage' })).toHaveClass('h-9', 'shrink-0');
  });

  it('filters project photos by retouching stage and later requests', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => url.endsWith('/requests')
      ? { data: { requests: [{ id: 12, photo_id: 15, source_filename: 'IMG_REQUEST.JPG', status: 'open', request_type: 'additional', customer_message: 'Add this one' }] } } as any
      : { data: { configured: true, stage: 'EDITING', connected: true, summary: {}, photos: [
        { photo_id: 11, source_filename: 'IMG_PROOF.JPG', selected: false, cancelled: false, delivered: false, ready_for_editing: false, added_during_editing: false, error: false },
        { photo_id: 12, source_filename: 'IMG_SELECTED.JPG', selected: true, cancelled: false, delivered: false, ready_for_editing: false, added_during_editing: false, error: false },
        { photo_id: 13, source_filename: 'IMG_EDITING.JPG', selected: true, cancelled: false, delivered: false, ready_for_editing: true, added_during_editing: false, error: false },
        { photo_id: 14, source_filename: 'IMG_DELIVERED.JPG', selected: true, cancelled: false, delivered: true, ready_for_editing: true, added_during_editing: false, error: false },
        { photo_id: 15, source_filename: 'IMG_REQUEST.JPG', selected: true, cancelled: false, delivered: false, ready_for_editing: false, added_during_editing: true, error: false },
      ] } } as any);
    render(<PhotographyWorkflowCard eventId={7} />);
    await waitFor(() => expect(screen.getByText('IMG_PROOF.JPG')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Retouching/ }));
    expect(screen.getByText('IMG_EDITING.JPG')).toBeTruthy();
    expect(screen.queryByText('IMG_PROOF.JPG')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Open requests/ }));
    expect(screen.getAllByText('IMG_REQUEST.JPG').length).toBeGreaterThan(0);
    expect(screen.queryByText('IMG_EDITING.JPG')).toBeNull();
  });
  it('explains an unlinked project without inventing zero progress', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => url.endsWith('/requests')
      ? { data: { requests: [] } } as any
      : { data: { configured: false, auto_bind_available: true, suggested_raw_subdir: 'Camera/26-10-04' } } as any);
    render(<PhotographyWorkflowCard eventId={8} />);
    await waitFor(() => expect(screen.getByText('This Picflow project is not connected to a RAW folder yet, so client retouch labels cannot prepare files for the editor.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Connect project folder automatically' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open photographer workspace' })).toBeNull();
    expect(screen.queryByText('Revisions')).toBeNull();
  });

  it('explains when the shared NAS delivery mount is unavailable', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => url.endsWith('/requests')
      ? { data: { requests: [] } } as any
      : { data: { configured: false, auto_bind_mount_missing: true, suggested_raw_subdir: 'Camera/26-10-04' } } as any);
    render(<PhotographyWorkflowCard eventId={9} />);
    await waitFor(() => expect(screen.getByText(/The shared PixCakeDelivery folder is not available/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Connect project folder automatically' })).toBeNull();
  });
});


it('preserves an unsaved photographer reply across automatic refresh', async () => {
  vi.useFakeTimers();
  vi.mocked(api.get).mockImplementation(async (url: string) => url.endsWith('/requests')
    ? { data: { requests: [{ id: 11, photo_id: 42, source_filename: 'DSC.JPG', status: 'open', request_type: 'revision', photographer_reply: 'Saved reply', customer_message: 'Please revise' }] } } as any
    : { data: { configured: true, stage: 'EDITING', connected: true, summary: {}, photos: [] } } as any);
  render(<PhotographyWorkflowCard eventId={7} />);
  await act(async () => { await Promise.resolve(); });
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'Unsaved detailed reply' } });
  await act(async () => { vi.advanceTimersByTime(30000); });
  expect(input).toHaveValue('Unsaved detailed reply');
});
