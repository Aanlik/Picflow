import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DOWNLOAD_QUEUE_EVENT, type DownloadQueueItem } from '../../utils/downloadQueue';
import { galleryService } from '../../services/gallery.service';

/** One explicit click per file avoids browsers repeating or blocking batched downloads. */
export function DownloadQueue() {
  const { t } = useTranslation();
  const [items, setItems] = useState<DownloadQueueItem[]>([]);
  const [states, setStates] = useState<Record<number, 'downloading' | 'started' | 'failed'>>({});
  useEffect(() => {
    const receive = (event: Event) => {
      setItems((event as CustomEvent<DownloadQueueItem[]>).detail);
      setStates({});
    };
    window.addEventListener(DOWNLOAD_QUEUE_EVENT, receive);
    return () => window.removeEventListener(DOWNLOAD_QUEUE_EVENT, receive);
  }, []);
  if (!items.length) return null;

  const download = async (item: DownloadQueueItem) => {
    if (states[item.photoId] === 'downloading') return;
    setStates((current) => ({ ...current, [item.photoId]: 'downloading' }));
    try {
      // Use the shared authenticated fetch path. Browser-native links cannot
      // attach the gallery password bearer token or per-guest identity header.
      await galleryService.downloadPhoto(item.slug, item.photoId, item.filename || `photo-${item.photoId}`, item.resolution);
      setStates((current) => ({ ...current, [item.photoId]: 'started' }));
    } catch {
      setStates((current) => ({ ...current, [item.photoId]: 'failed' }));
    }
  };

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
    <section role="dialog" aria-modal="true" aria-label={t('downloadQueue.title')} className="max-h-[80vh] w-full max-w-md overflow-auto rounded-xl bg-white p-5 text-gray-900 shadow-xl">
      <h2 className="text-lg font-semibold">{t('downloadQueue.title')}</h2>
      <p className="my-3 text-sm">{t('downloadQueue.instructions')}</p>
      <ul className="space-y-2">{items.map((item, index) => {
        const state = states[item.photoId];
        const statusText = state === 'downloading'
          ? t('downloadQueue.downloading')
          : state === 'started'
            ? t('downloadQueue.opened')
            : state === 'failed'
              ? t('downloadQueue.failed')
              : '';
        return (
          <li key={item.photoId}>
            <button
              type="button"
              className="gallery-numeric block w-full rounded-lg border p-3 text-left text-blue-700 disabled:cursor-wait disabled:opacity-60"
              onClick={() => void download(item)}
              disabled={state === 'downloading'}
            >
              {t('downloadQueue.file', { number: index + 1 })}{statusText ? ` · ${statusText}` : ''}
            </button>
          </li>
        );
      })}</ul>
      <button className="mt-4 rounded-lg border px-4 py-2" onClick={() => setItems([])}>{t('common.close')}</button>
    </section>
  </div>;
}
