export interface DownloadQueueItem {
  slug: string;
  photoId: number;
  filename?: string;
  resolution?: string;
}
export const DOWNLOAD_QUEUE_EVENT = 'picflow:download-queue';
