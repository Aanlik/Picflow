import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../common/Button';

interface GalleryBatchSelectionToolbarProps {
  isSelectionMode: boolean;
  selectedCount: number;
  downloadableCount: number;
  allowDownloads: boolean;
  isDownloading: boolean;
  onToggleSelectionMode: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDownloadSelected: () => void;
}

/** Selection controls for full-bleed gallery layouts, whose own shell bypasses
 * GalleryLayout/PhotoGrid's ordinary toolbar. */
export function GalleryBatchSelectionToolbar({
  isSelectionMode,
  selectedCount,
  downloadableCount,
  allowDownloads,
  isDownloading,
  onToggleSelectionMode,
  onSelectAll,
  onDeselectAll,
  onDownloadSelected,
}: GalleryBatchSelectionToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-2" role="group" aria-label={t('gallery.batchActions', '批量操作')}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onToggleSelectionMode}
        aria-pressed={isSelectionMode}
      >
        {isSelectionMode ? t('gallery.cancelSelection') : t('gallery.selectPhotos')}
      </Button>
      {isSelectionMode && (
        <>
          <span className="gallery-numeric px-1 text-xs" aria-live="polite">
            {t('gallery.photosSelected', { count: selectedCount })}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={onSelectAll}>
            {t('gallery.selectAll')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onDeselectAll}>
            {t('gallery.deselectAll')}
          </Button>
          {allowDownloads && downloadableCount > 0 && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              leftIcon={<Download className="h-4 w-4" />}
              onClick={onDownloadSelected}
              disabled={isDownloading}
            >
              {t('gallery.downloadSelected', { count: downloadableCount })}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
