import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { count?: number }) =>
    key === 'gallery.photosSelected' ? `${options?.count ?? 0} selected` : key }),
}));

import { GalleryBatchSelectionToolbar } from '../GalleryBatchSelectionToolbar';

const props = (overrides: Partial<React.ComponentProps<typeof GalleryBatchSelectionToolbar>> = {}) => ({
  isSelectionMode: true,
  selectedCount: 2,
  downloadableCount: 1,
  allowDownloads: true,
  isDownloading: false,
  onToggleSelectionMode: vi.fn(),
  onSelectAll: vi.fn(),
  onDeselectAll: vi.fn(),
  onDownloadSelected: vi.fn(),
  ...overrides,
});

describe('full-bleed gallery batch actions', () => {
  it('provides selection, select-all, clear, and download actions when downloads are allowed', () => {
    const actions = props();
    render(<GalleryBatchSelectionToolbar {...actions} />);

    expect(screen.getByText('2 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'gallery.cancelSelection' }));
    fireEvent.click(screen.getByRole('button', { name: 'gallery.selectAll' }));
    fireEvent.click(screen.getByRole('button', { name: 'gallery.deselectAll' }));
    fireEvent.click(screen.getByRole('button', { name: 'gallery.downloadSelected' }));

    expect(actions.onToggleSelectionMode).toHaveBeenCalledOnce();
    expect(actions.onSelectAll).toHaveBeenCalledOnce();
    expect(actions.onDeselectAll).toHaveBeenCalledOnce();
    expect(actions.onDownloadSelected).toHaveBeenCalledOnce();
  });

  it('keeps selection available when downloads are disabled and omits the download action', () => {
    render(<GalleryBatchSelectionToolbar {...props({ allowDownloads: false })} />);

    expect(screen.getByRole('button', { name: 'gallery.cancelSelection' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'gallery.downloadSelected' })).toBeNull();
  });

  it('omits the download action when every selected photo belongs to a restricted category', () => {
    render(<GalleryBatchSelectionToolbar {...props({ downloadableCount: 0 })} />);

    expect(screen.getByRole('button', { name: 'gallery.cancelSelection' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'gallery.downloadSelected' })).toBeNull();
  });
});
