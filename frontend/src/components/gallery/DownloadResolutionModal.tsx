import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadResolutionLabel } from '../../utils/downloadResolutionLabel';
import { toast } from 'react-toastify';
import { AlertCircle, Download, X } from 'lucide-react';

import { Button, Card } from '../common';
import { galleryService } from '../../services/gallery.service';
import type { DownloadResolutionChoice } from '../../types';

/** Choose a rendition; every photo is then queued as its own download. */
interface DownloadResolutionModalProps {
  slug: string;
  choices: DownloadResolutionChoice[];
  /** Omitted = the whole gallery. */
  photoIds?: number[];
  onClose: () => void;
}

export const DownloadResolutionModal: React.FC<DownloadResolutionModalProps> = ({
  slug,
  choices,
  photoIds,
  onClose,
}) => {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string>(choices[0]?.id ?? 'original');
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const start = useCallback(async () => {
    setIsStarting(true);
    setError(null);
    try {
      if (photoIds?.length) {
        await galleryService.downloadSelectedPhotos(slug, photoIds, selected);
        toast.info(t('gallery.downloadStarted', { photoCount: photoIds.length }));
      } else {
        await galleryService.downloadAllPhotos(slug, selected);
        toast.success(t('gallery.allDownloadsStarted'));
      }
      onClose();
    } catch {
      setError(t('gallery.downloadError'));
    } finally {
      setIsStarting(false);
    }
  }, [slug, selected, photoIds, t, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isStarting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isStarting, onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4"
      onClick={() => { if (!isStarting) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={t('gallery.chooseResolution', 'Choose a download size')}
    >
      <Card
        className="max-w-md w-full"
        onClick={(event: React.MouseEvent) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            {t('gallery.chooseResolution', 'Choose a download size')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isStarting}
            aria-label={t('common.close', 'Close')}
            className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2 mb-5">
          {choices.map((choice) => (
            <label
              key={choice.id}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                selected === choice.id
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800'
              } ${isStarting ? 'opacity-60' : ''}`}
            >
              <input
                type="radio"
                name="download-resolution"
                value={choice.id}
                checked={selected === choice.id}
                disabled={isStarting}
                onChange={() => setSelected(choice.id)}
                className="accent-primary-600"
              />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {downloadResolutionLabel(choice.label, t)}
                </span>
                {choice.width && choice.height && (
                  <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                    {t('gallery.resolutionUpTo', 'up to {{width}} × {{height}} px', {
                      width: choice.width,
                      height: choice.height,
                    })}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>

        {error && (
          <div role="alert" className="mb-4 flex items-start gap-2 text-sm text-red-700 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={isStarting} onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="primary" isLoading={isStarting} onClick={() => void start()} leftIcon={<Download className="w-4 h-4" />}>
            {photoIds?.length ? t('gallery.download', 'Download') : t('gallery.downloadAll', 'Download all')}
          </Button>
        </div>
      </Card>
    </div>
  );
};
