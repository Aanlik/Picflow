import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DOWNLOAD_QUEUE_EVENT, type DownloadQueueItem } from '../../utils/downloadQueue';

/** One explicit click per file avoids browsers repeating or blocking batched downloads. */
export function DownloadQueue() {
  const { t } = useTranslation();
  const [items, setItems] = useState<DownloadQueueItem[]>([]);
  const [opened, setOpened] = useState<Set<number>>(new Set());
  useEffect(() => {
    const receive = (event: Event) => {
      setItems((event as CustomEvent<DownloadQueueItem[]>).detail);
      setOpened(new Set());
    };
    window.addEventListener(DOWNLOAD_QUEUE_EVENT, receive);
    return () => window.removeEventListener(DOWNLOAD_QUEUE_EVENT, receive);
  }, []);
  if (!items.length) return null;
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
    <section role="dialog" aria-modal="true" aria-label={t('downloadQueue.title')} className="max-h-[80vh] w-full max-w-md overflow-auto rounded-xl bg-white p-5 text-gray-900 shadow-xl">
      <h2 className="text-lg font-semibold">{t('downloadQueue.title')}</h2>
      <p className="my-3 text-sm">{t('downloadQueue.instructions')}</p>
      <ul className="space-y-2">{items.map((item, index) => <li key={item.photoId}>
        <a className="gallery-numeric block rounded-lg border p-3 text-blue-700" href={item.href} download
          onClick={() => setOpened(previous => new Set(previous).add(item.photoId))}>
          {t('downloadQueue.file', { number: index + 1 })}{opened.has(item.photoId) ? ` · ${t('downloadQueue.opened')}` : ''}
        </a>
      </li>)}</ul>
      <button className="mt-4 rounded-lg border px-4 py-2" onClick={() => setItems([])}>{t('common.close')}</button>
    </section>
  </div>;
}
