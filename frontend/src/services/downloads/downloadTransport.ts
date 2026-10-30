import { api } from "../../config/api";
import {
  getGuestIdentity,
  getGuestToken,
} from "../../utils/guestIdentityStorage";
import type { DownloadAsset, DownloadTask, DownloadTransport } from "./types";
const directUrls = new Map<string, string>();

function rememberDownloadUrl(task: DownloadTask, asset: DownloadAsset) {
  if (asset.download_url) {
    directUrls.set(task.id, asset.download_url);
    while (directUrls.size > 500) directUrls.delete(directUrls.keys().next().value!);
  }
}

function directChunk(
  url: string,
  start: number,
  end: number,
  total: number,
  etag: string,
  signal: AbortSignal,
  onProgress: (bytes: number) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => {
      request.abort();
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    request.open("GET", url);
    request.responseType = "blob";
    request.setRequestHeader("Range", `bytes=${start}-${end}`);
    request.onprogress = (event) => onProgress(Math.min(event.loaded, end - start + 1));
    request.onerror = () => {
      cleanup();
      reject(new Error("DIRECT_CLOUD_DOWNLOAD_FAILED"));
    };
    request.onabort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    request.onload = () => {
      cleanup();
      if (request.status === 401 || request.status === 403) {
        reject(new Error("DIRECT_CLOUD_URL_EXPIRED"));
        return;
      }
      if (request.status === 416) {
        reject(new Error("DOWNLOAD_VERSION_CHANGED"));
        return;
      }
      const blob = request.response as Blob;
      if (
        request.status !== 206 ||
        request.getResponseHeader("Content-Range") !== `bytes ${start}-${end}/${total}` ||
        request.getResponseHeader("ETag") !== etag ||
        blob.size !== end - start + 1
      ) {
        reject(new Error("DOWNLOAD_VERSION_CHANGED"));
        return;
      }
      resolve(blob);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) return abort();
    request.send();
  });
}

export function identityFor(slug: string): string {
  const guest = getGuestIdentity(slug);
  return guest ? `guest:${guest.id}:${guest.identifier}` : "anonymous";
}
function headers(task: DownloadTask) {
  return task.guestId
    ? {
        "X-Download-Guest": String(task.guestId),
        "x-guest-token": getGuestToken(task.slug) || "",
      }
    : {};
}
function assertCurrent(task: DownloadTask) {
  if (identityFor(task.slug) !== task.identity)
    throw new Error("IDENTITY_CHANGED");
}
export const downloadTransport: DownloadTransport = {
  isCurrent: (task) => {
    const current = identityFor(task.slug) === task.identity;
    if (!current) directUrls.delete(task.id);
    return current;
  },
  async initialize(task, signal) {
    assertCurrent(task);
    if (!task.guestId) return this.metadata(task, signal);
    const response = await api.post(
      `/gallery/${task.slug}/download-history`,
      {
        photo_id: task.photoId,
        device_id: task.deviceId,
        client_id: task.id,
        resolution: task.resolution,
      },
      { signal, timeout: 120000, headers: headers(task) },
    );
    const asset = {
      ...response.data,
      size: Number(response.data.total_bytes),
    } as DownloadAsset;
    rememberDownloadUrl(task, asset);
    return asset;
  },
  async metadata(task, signal) {
    assertCurrent(task);
    const asset = (
      await api.get<DownloadAsset>(
        `/gallery/${task.slug}/download/${task.photoId}`,
        {
          signal,
          timeout: 120000,
          params: { managed: "metadata", resolution: task.resolution },
          headers: headers(task),
        },
      )
    ).data;
    rememberDownloadUrl(task, asset);
    return asset;
  },
  async chunk(task, start, end, signal, onProgress) {
    assertCurrent(task);
    const directUrl = directUrls.get(task.id);
    if (directUrl) {
      try {
        return await directChunk(directUrl, start, end, task.total, task.etag!, signal, onProgress);
      } catch (error) {
        if ((error as Error).message !== "DIRECT_CLOUD_URL_EXPIRED") throw error;
        const meta = await this.metadata(task, signal);
        if (meta.etag !== task.etag || meta.size !== task.total || !meta.download_url)
          throw new Error("DOWNLOAD_VERSION_CHANGED");
        return directChunk(meta.download_url, start, end, task.total, task.etag!, signal, onProgress);
      }
    }
    const response = await api.get<Blob>(
      `/gallery/${task.slug}/download/${task.photoId}`,
      {
        signal,
        timeout: 300000,
        responseType: "blob",
        params: {
          managed: "bytes",
          resolution: task.resolution,
          version: task.etag,
        },
        headers: {
          ...headers(task),
          Range: `bytes=${start}-${end}`,
          "If-Range": task.etag!,
        },
        onDownloadProgress: (event) =>
          onProgress(Math.min(event.loaded, end - start + 1)),
      },
    );
    const expected = `bytes ${start}-${end}/${task.total}`;
    if (
      response.status !== 206 ||
      response.headers["content-range"] !== expected ||
      response.headers.etag !== task.etag ||
      response.data.size !== end - start + 1
    ) {
      throw new Error("DOWNLOAD_VERSION_CHANGED");
    }
    assertCurrent(task);
    return response.data;
  },
  async sync(task) {
    if (!task.remoteId) return;
    assertCurrent(task);
    await api.patch(
      `/gallery/${task.slug}/download-history/${task.remoteId}`,
      { state: task.state, received_bytes: task.received },
      { timeout: 5000, headers: headers(task) },
    );
  },
};
