import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const { downloadPhoto } = vi.hoisted(() => ({ downloadPhoto: vi.fn() }));
vi.mock('../../../services/gallery.service', () => ({ galleryService: { downloadPhoto } }));
import { DownloadQueue } from '../DownloadQueue';
import { DOWNLOAD_QUEUE_EVENT } from '../../../utils/downloadQueue';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
beforeEach(() => downloadPhoto.mockReset());

it('fetches each selected photo through the authenticated service after an explicit click', async () => {
  downloadPhoto.mockResolvedValue(undefined);
  const { unmount } = render(<DownloadQueue />);
  act(() => window.dispatchEvent(new CustomEvent(DOWNLOAD_QUEUE_EVENT, { detail: [
    { slug: 'shoot', photoId: 1 },
    { slug: 'shoot', photoId: 2, resolution: 'web' },
  ] })));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  const fileButtons = screen.getAllByRole('button', { name: 'downloadQueue.file' });
  expect(fileButtons).toHaveLength(2);
  fireEvent.click(fileButtons[0]);
  await waitFor(() => expect(downloadPhoto).toHaveBeenCalledWith('shoot', 1, 'photo-1', undefined));
  fireEvent.click(fileButtons[1]);
  await waitFor(() => expect(downloadPhoto).toHaveBeenCalledWith('shoot', 2, 'photo-2', 'web'));
  expect((await screen.findAllByText('downloadQueue.opened', { exact: false })).length).toBe(2);
  fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  unmount();
});

it('shows a retryable error instead of silently opening a broken native link', async () => {
  downloadPhoto.mockRejectedValueOnce(new Error('401')).mockResolvedValueOnce(undefined);
  render(<DownloadQueue />);
  act(() => window.dispatchEvent(new CustomEvent(DOWNLOAD_QUEUE_EVENT, { detail: [
    { slug: 'shoot', photoId: 9 },
  ] })));
  const fileButton = screen.getByRole('button', { name: 'downloadQueue.file' });
  fireEvent.click(fileButton);
  expect(await screen.findByText('downloadQueue.failed', { exact: false })).toBeInTheDocument();
  fireEvent.click(fileButton);
  await waitFor(() => expect(downloadPhoto).toHaveBeenCalledTimes(2));
});
