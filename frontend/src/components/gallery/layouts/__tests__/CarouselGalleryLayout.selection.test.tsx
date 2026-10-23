import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CarouselGalleryLayout } from '../CarouselGalleryLayout';
import type { Photo } from '../../../../types';
vi.mock('react-i18next', async original => ({ ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: {} }) }));
vi.mock('../../../../contexts/GuestIdentityContext', () => ({ useGuestIdentityOptional: () => null }));
vi.mock('../../../common', () => ({ AuthenticatedImage: (props: any) => <img alt={props.alt} />, Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
afterEach(cleanup);
const photos = [1, 2].map(id => ({ id, filename: `sample-${id}.jpg`, url: `/photo/${id}`, category_allow_downloads: false })) as Photo[];
it('offers selection controls and toggles thumbnails without opening a preview', () => {
 const select = vi.fn(), open = vi.fn(), all = vi.fn();
 render(<CarouselGalleryLayout photos={photos} slug="test" onPhotoClick={open} onDownload={vi.fn()} isSelectionMode onPhotoSelect={select} onSelectAll={all} />);
 fireEvent.click(screen.getByRole('button', { name: 'sample-2.jpg' }));
 expect(select).toHaveBeenCalledWith(2);
 expect(open).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button', { name: 'gallery.selectAll' }));
 expect(all).toHaveBeenCalledOnce();
 expect(screen.getByRole('checkbox', { name: 'sample-1.jpg' })).toBeInTheDocument();
});
it('does not offer download for a restricted category', () => {
 render(<CarouselGalleryLayout photos={photos} slug="test" onPhotoClick={vi.fn()} onDownload={vi.fn()} allowDownloads />);
 expect(screen.queryByTitle('ui.downloadPhoto')).toBeNull();
});
