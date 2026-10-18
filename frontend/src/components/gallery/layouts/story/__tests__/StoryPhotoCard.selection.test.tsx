import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Photo } from '../../../../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div> },
  useInView: () => true,
}));
vi.mock('../../../../common', () => ({
  AuthenticatedImage: ({ alt }: { alt: string }) => <img alt={alt} />,
}));
vi.mock('../../../ColorLabelBadge', () => ({ ColorLabelBadge: () => null }));
vi.mock('../../../WorkflowStatusBadge', () => ({ WorkflowStatusBadge: () => null }));

import { StoryPhotoCard } from '../StoryPhotoCard';

const photo = { id: 31, filename: 'DSC0031.jpg', url: '/photo/31', width: 300, height: 200 } as Photo;

describe('Story layout selection mode', () => {
  it('selects a tile instead of opening the lightbox while batch selection is active', () => {
    const onToggleSelect = vi.fn();
    const onClick = vi.fn();
    render(
      <StoryPhotoCard
        photo={photo}
        index={0}
        isFavorite={false}
        onToggleFavorite={vi.fn()}
        onClick={onClick}
        slug="test"
        galleryId="scene"
        isSelectionMode
        onToggleSelect={onToggleSelect}
      />,
    );

    fireEvent.click(screen.getByRole('link'));
    expect(onToggleSelect).toHaveBeenCalledWith(photo.id);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('exposes selected state and toggles it from the accessible checkbox-style control', () => {
    const onToggleSelect = vi.fn();
    render(
      <StoryPhotoCard
        photo={photo}
        index={0}
        isFavorite={false}
        onToggleFavorite={vi.fn()}
        slug="test"
        galleryId="scene"
        isSelectionMode
        isSelected
        onToggleSelect={onToggleSelect}
      />,
    );

    const selection = screen.getByRole('button', { name: 'gallery.deselectPhotoForBatch' });
    expect(selection.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(selection);
    expect(onToggleSelect).toHaveBeenCalledWith(photo.id);
  });
});
