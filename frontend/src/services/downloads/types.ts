export type DownloadState =
  | "queued"
  | "receiving"
  | "paused"
  | "retrying"
  | "failed"
  | "received"
  | "handed_off"
  | "cancelled"
  | "version_changed";
export interface DownloadTask {
  id: string;
  remoteId?: string;
  slug: string;
  identity: string;
  guestId?: number;
  photoId: number;
  filename: string;
  resolution?: string;
  deviceId: string;
  etag?: string;
  total: number;
  received: number;
  contentType: string;
  state: DownloadState;
  createdAt: string;
  updatedAt: string;
  error?: string;
  /** Local IndexedDB failure phase and DOMException name; never sent to the server. */
  storageDiagnostic?: string;
  historyPending?: boolean;
  cacheCleared?: boolean;
  archived?: boolean;
  leaseOwner?: string;
  leaseUntil?: number;
}
export interface DownloadAsset {
  filename: string;
  size: number;
  etag: string;
  content_type: string;
  id?: string;
  /** Short-lived bearer URL; kept in memory by the transport, never persisted with the task. */
  download_url?: string;
}
export interface DownloadRepository {
  list(): Promise<DownloadTask[]>;
  put(task: DownloadTask): Promise<void>;
  claim(id: string, owner: string): Promise<boolean>;
  renew(id: string, owner: string): Promise<boolean>;
  append(
    task: DownloadTask,
    offset: number,
    blob: Blob,
    owner: string,
  ): Promise<void>;
  release(task: DownloadTask, owner: string): Promise<void>;
  blob(task: DownloadTask): Promise<Blob>;
  clearBlocks(id: string): Promise<void>;
  clear(id: string): Promise<void>;
}
export interface DownloadTransport {
  initialize(task: DownloadTask, signal: AbortSignal): Promise<DownloadAsset>;
  metadata(task: DownloadTask, signal: AbortSignal): Promise<DownloadAsset>;
  chunk(
    task: DownloadTask,
    start: number,
    end: number,
    signal: AbortSignal,
    onProgress: (bytes: number) => void,
  ): Promise<Blob>;
  sync(task: DownloadTask): Promise<void>;
  isCurrent(task: DownloadTask): boolean;
}
export const BLOCK_SIZE = 4 * 1024 * 1024;
