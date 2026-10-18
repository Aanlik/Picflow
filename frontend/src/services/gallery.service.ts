import { DOWNLOAD_QUEUE_EVENT } from '../utils/downloadQueue';
import type { AxiosResponse } from 'axios';
import { api } from '../config/api';
import type {
  GalleryInfo, GalleryData, ResolvedGalleryIdentifier,
  DownloadJobStatus, DownloadJobState,
} from '../types';
import { normalizeRequirePassword } from '../utils/accessControl';
import { parseContentDispositionFilename } from '../utils/contentDisposition';

// Gallery pages beyond the first are fetched this many at a time (#1357).
const PAGE_FETCH_CONCURRENCY = 4;

// Admin preview (#868): the preview tab carries `?admin_preview=1`. Browser-native
// download navigations (a real `<a href>` / `api.getUri`) bypass the axios request
// interceptor that forwards the flag on API calls, so append it to those URLs
// directly. The httpOnly admin_token cookie authenticates server-side.
function withAdminPreview(url: string): string {
  if (typeof window === 'undefined') return url;
  if (new URLSearchParams(window.location.search).get('admin_preview') !== '1') return url;
  return `${url}${url.includes('?') ? '&' : '?'}admin_preview=1`;
}

// iOS is the only platform whose system share sheet exposes a
// first-party "Save Image" / "Save to Photos" action for files
// shared via navigator.share(). On Android the share sheet only
// lists installed apps that registered an image/* intent — there is no
// built-in save-to-gallery action,
// so the share path produces a useless app-picker for users who
// just wanted to save the photo (#554). UA-sniff is the only signal
// available because feature detection (canShare) is true on both.
//
// The MacIntel + maxTouchPoints clause covers iPadOS 13+ which
// identifies as Mac in navigator.userAgent but supports the same
// share-to-Photos flow as iOS Safari.
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
}

// Counts-only snapshot returned by GET /gallery/:slug/uploads/status.
export interface UploadProcessingStatus {
  total: number;
  pending: number;
  processing: number;
  complete: number;
  failed: number;
}

export interface RetouchRequestSummary {
  id: number;
  photo_id: number;
  request_type: 'revision' | 'additional';
  base_version: number | null;
  customer_message: string;
  status: 'open' | 'in_progress' | 'waiting_customer' | 'completed' | 'closed' | 'cancelled';
  photographer_reply: string | null;
  created_at: string;
  updated_at: string;
}

export interface RetouchWorkflowPhoto {
  photo_id: number;
  selected: boolean;
  selection_cancelled?: boolean;
  delivered_retained?: boolean;
  delivered: boolean;
  current_version: number;
  added_during_editing: boolean;
  ready_for_editing: boolean;
  withdraw_pending?: boolean;
  state: 'proof' | 'selected' | 'editing' | 'delivered' | 'cancelled';
}

export interface RetouchWorkflow {
  enabled: boolean;
  bridge_available: boolean;
  photos: RetouchWorkflowPhoto[];
  requests: RetouchRequestSummary[];
}

export const galleryService = {
  // Verify share token
  async verifyToken(slug: string, token: string): Promise<{ valid: boolean }> {
    const response = await api.get<{ valid: boolean }>(`/gallery/${slug}/verify-token/${token}`);
    return response.data;
  },

  // Get basic gallery info (no auth required)
  async getGalleryInfo(slug: string, token?: string): Promise<GalleryInfo> {
    const params = token ? { token } : {};
    const response = await api.get<GalleryInfo>(`/gallery/${slug}/info`, { params });
    const data = response.data;
    return {
      ...data,
      requires_password: normalizeRequirePassword((data as any)?.requires_password, true),
    };
  },

  async getRetouchWorkflow(slug: string): Promise<RetouchWorkflow> {
    const response = await api.get<RetouchWorkflow>(`/gallery/${slug}/retouch-workflow`);
    return response.data;
  },

  async setRetouchSelection(slug: string, photoId: number, selected: boolean): Promise<{ success: boolean; selected: boolean }> {
    const response = await api.post(`/gallery/${slug}/photos/${photoId}/retouch-selection`, { selected });
    return response.data;
  },

  async submitBatchRetouchSelections(slug: string, photoIds: number[], selected = true): Promise<{
    success: boolean;
    applied_count: number;
    selected: boolean;
    photo_ids: number[];
  }> {
    const response = await api.post(`/gallery/${slug}/retouch-selections/batch`, {
      photo_ids: photoIds,
      selected,
    });
    return response.data;
  },

  async submitRetouchRequest(slug: string, photoId: number, payload: {
    request_type: 'revision' | 'additional';
    base_version?: number;
    message: string;
    guest_name?: string;
  }): Promise<{ request: RetouchRequestSummary }> {
    const response = await api.post(`/gallery/${slug}/photos/${photoId}/retouch-requests`, payload);
    return response.data;
  },

  async cancelRetouchRequest(slug: string, requestId: number): Promise<void> {
    await api.delete(`/gallery/${slug}/retouch-requests/${requestId}`);
  },

  async withdrawRetouchSelection(slug: string, photoId: number, deleteDelivered: boolean): Promise<{
    success: boolean;
    processing?: boolean;
    deleted?: boolean;
    kept_for_other_participant?: boolean;
    current_version?: number;
  }> {
    const response = await api.post(`/gallery/${slug}/photos/${photoId}/withdraw-selection`, {
      delete_delivered: deleteDelivered,
    });
    return response.data;
  },

  // Get gallery photos (requires auth)
  async getGalleryPhotos(
    slug: string,
    filter?: 'liked' | 'favorited' | 'commented' | 'rated' | 'all',
    guestId?: string,
    signal?: AbortSignal
  ): Promise<GalleryData> {
    const params: Record<string, string | number> = { limit: 250, page: 1 };
    if (filter && filter !== 'all') {
      params.filter = filter;
      if (guestId) {
        params.guest_id = guestId;
      }
    }
    const response = await api.get<GalleryData>(`/gallery/${slug}/photos`, { params: { ...params }, signal });
    const data = response.data;
    // Existing filter/folder/lightbox consumers require the complete set.
    // Fetch bounded pages so the API only hydrates feedback for 250
    // photos at once. A cancelled gallery query also cancels later pages.
    const photos = new Map(data.photos.map(photo => [photo.id, photo]));
    let pagination = data.pagination;
    if (pagination?.has_more) {
      const fetchPage = async (page: number) =>
        (await api.get<GalleryData>(`/gallery/${slug}/photos`, { params: { ...params, page }, signal })).data;
      // Page 1 reports the total, so the remaining pages are known up front
      // and fetched a few at a time instead of one round-trip after another.
      const pageSize = pagination.limit || Number(params.limit);
      const lastKnownPage = pagination.total ? Math.ceil(pagination.total / pageSize) : pagination.page + 1;
      const firstPage = pagination.page;
      const pending = Array.from({ length: Math.max(0, lastKnownPage - firstPage) }, (_, i) => firstPage + 1 + i);
      const fetched = new Map<number, GalleryData>();
      await Promise.all(Array.from({ length: Math.min(PAGE_FETCH_CONCURRENCY, pending.length) }, async () => {
        for (let page = pending.shift(); page !== undefined; page = pending.shift()) {
          fetched.set(page, await fetchPage(page));
        }
      }));
      // Insert in page order: the Map keeps the server's sort.
      for (const page of [...fetched.keys()].sort((a, b) => a - b)) {
        const result = fetched.get(page) as GalleryData;
        result.photos.forEach(photo => photos.set(photo.id, photo));
        pagination = result.pagination;
      }
      // Photos added while paging push the total past what page 1 reported.
      while (pagination?.has_more) {
        const next = await fetchPage(pagination.page + 1);
        next.photos.forEach(photo => photos.set(photo.id, photo));
        pagination = next.pagination;
      }
    }
    const normalizedEvent = data?.event
      ? {
          ...data.event,
          require_password: normalizeRequirePassword((data.event as any)?.require_password, true),
        }
      : data.event;
    return {
      ...data,
      photos: [...photos.values()],
      event: normalizedEvent,
    };
  },

  // Processing status for the guest's own uploads (B7). A guest upload is
  // queued — the route answers 202 and getGalleryPhotos only returns rows that
  // finished processing — so this is what tells the gallery whether a photo
  // that has not appeared yet is still in the worker's queue or failed
  // outright. Scoped server-side to the gallery this token unlocked.
  async getUploadStatus(slug: string, uploadIds: string[]): Promise<UploadProcessingStatus> {
    const response = await api.get<UploadProcessingStatus>(`/gallery/${slug}/uploads/status`, {
      params: { ids: uploadIds.join(',') },
    });
    return response.data;
  },

  // Save a single photo through the authenticated API client before handing
  // it to the browser. Gallery passwords produce a bearer token kept in
  // sessionStorage and attached by the Axios interceptor; a native anchor
  // navigation cannot carry that Authorization header, so protected galleries
  // silently fail (or fall through to the tile's preview click). The small
  // buffering cost is preferable to a download control that does nothing.
  // iOS still gets the native Save-to-Photos share sheet when supported.
  async savePhotoToDevice(slug: string, photoId: number, filename: string, resolution?: string): Promise<void> {
    const fetched = await this.fetchPhotoBlob(slug, photoId, resolution);
    const resolvedFilename = fetched.serverFilename || filename;

    if (!isIOS()) {
      this.triggerBrowserDownload(fetched.blob, resolvedFilename);
      return;
    }

    // canShare() returns false on browsers without Web Share file
    // support. Probe with a representative File so the negotiation
    // is accurate — `canShare({ files: [] })` returns true on some
    // browsers that don't actually accept files at share() time.
    const file = new File([fetched.blob], resolvedFilename, {
      type: fetched.blob.type || 'image/jpeg',
    });
    const canShareFile =
      typeof navigator !== 'undefined' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] });

    if (canShareFile) {
      try {
        await navigator.share({ files: [file], title: resolvedFilename });
        return;
      } catch (err) {
        // AbortError = user dismissed the share sheet. Don't fall back —
        // they made a choice. Any other failure (NotAllowedError,
        // DataError, etc.) is unexpected; surface a download instead so
        // the user still gets the file.
        if ((err as DOMException)?.name === 'AbortError') return;
      }
    }

    this.triggerBrowserDownload(fetched.blob, resolvedFilename);
  },

  // Fetch the photo as a Blob + the server-suggested filename, falling
  // back to the view endpoint when the original isn't available. Shared
  // between the regular download flow and the Web Share path (#531).
  // The server's Content-Disposition is the source of truth for the
  // filename (#493 — "use original camera filename" toggle reaches disk
  // through this header).
  async fetchPhotoBlob(
    slug: string,
    photoId: number,
    resolution?: string,
  ): Promise<{ blob: Blob; serverFilename: string | null }> {
    const readResponse = (response: AxiosResponse<Blob>) => {
      const headerName =
        response.headers['content-disposition'] || response.headers['Content-Disposition'];
      return {
        blob: response.data,
        serverFilename: parseContentDispositionFilename(headerName),
      };
    };

    try {
      const response = await api.get<Blob>(`/gallery/${slug}/download/${photoId}`, {
        responseType: 'blob',
        ...(resolution ? { params: { resolution } } : {}),
      });
      return readResponse(response);
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      // Never turn an authorization/rate-limit/server failure into a preview download.
      if (status !== 404) throw error;
      // Fallback: view endpoint when /download isn't available (e.g.
      // the original is missing and only a derivative remains). The
      // view endpoint doesn't emit a download-oriented Content-Disposition,
      // so serverFilename will be null and the caller's name wins.
      const response = await api.get<Blob>(`/gallery/${slug}/photo/${photoId}`, {
        responseType: 'blob',
        ...(resolution ? { params: { resolution } } : {}),
      });
      return readResponse(response);
    }
  },

  // Trigger a regular browser download via a transient <a download>
  // anchor. Extracted from downloadPhoto so the share-fallback path
  // can reuse it without re-fetching the blob.
  triggerBrowserDownload(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
  },

  // Trigger a browser-native download by navigating a hidden anchor at
  // the URL directly. The browser fetches the response itself (showing
  // its own progress UI), so unlike triggerBrowserDownload the JS layer
  // never materialises the bytes. `filename` is a hint; the server's
  // Content-Disposition wins per spec, which is what carries the #493
  // original-camera-filename setting through to disk.
  triggerDirectDownload(href: string, filename: string): void {
    const link = document.createElement('a');
    link.href = href;
    // An empty download attribute falls back to the URL path instead of the
    // server's RFC 6266 filename. Omit it to honor Content-Disposition.
    if (filename) link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
  },

  // Retain one download contract for grid cards and the lightbox, including
  // bearer/guest headers, filename resolution, and mobile Save-to-Photos.
  async downloadPhoto(slug: string, photoId: number, _filename: string, resolution?: string): Promise<void> {
    await this.savePhotoToDevice(slug, photoId, _filename, resolution);
  },

  // Download all photos as ZIP
  // When a pre-generated zip is available, use native browser download (Content-Length → progress bar).
  // Otherwise fall back to blob download.
  async downloadAllPhotos(slug: string, zipReady?: boolean): Promise<void> {
    if (zipReady) {
      // Native browser download — the server sends Content-Length so
      // the browser shows a real progress bar and mobile doesn't crash.
      const link = document.createElement('a');
      link.href = withAdminPreview(`/api/gallery/${slug}/download-all`);
      link.setAttribute('download', `${slug}.zip`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }

    // Fallback: blob download (no Content-Length, buffered in memory)
    const response = await api.get(`/gallery/${slug}/download-all`, {
      responseType: 'blob',
    });

    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${slug}.zip`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
  },

  // A browser may block or race multiple programmatic downloads started in a
  // single click, sometimes saving the first response more than once. For a
  // multi-file selection, present one explicit link per photo so the user can
  // authorize each same-origin download reliably on desktop and mobile.
  async downloadSelectedPhotos(
    slug: string,
    photoIds: number[],
    resolution?: string,
    filenames?: Record<number, string>,
  ): Promise<void> {
    const uniqueIds = [...new Set(photoIds)];
    if (uniqueIds.length > 1) {
      window.dispatchEvent(new CustomEvent(DOWNLOAD_QUEUE_EVENT, { detail: uniqueIds.map(photoId => ({
        slug,
        photoId,
        ...(filenames?.[photoId] ? { filename: filenames[photoId] } : {}),
        ...(resolution ? { resolution } : {}),
      })) }));
      return;
    }
    if (uniqueIds.length === 1) {
      const photoId = uniqueIds[0];
      await this.savePhotoToDevice(slug, photoId, filenames?.[photoId] || `photo-${photoId}`, resolution);
    }
  },

  // ── Custom-resolution downloads (#858) ──────────────────────────────────
  // A non-standard resolution has nothing cached behind it and can take
  // minutes to build, so the server does it as a job we poll rather than
  // holding a request open past the proxy timeout.

  // Kick off a build. `photoIds` omitted = the whole gallery.
  async startDownloadJob(
    slug: string,
    resolution: string,
    photoIds?: number[]
  ): Promise<{ token: string; status: DownloadJobStatus }> {
    const body: Record<string, unknown> = { resolution };
    if (photoIds && photoIds.length) body.photo_ids = photoIds;
    const response = await api.post(`/gallery/${slug}/download-jobs`, body);
    return response.data;
  },

  async getDownloadJob(slug: string, token: string): Promise<DownloadJobState> {
    const response = await api.get(`/gallery/${slug}/download-jobs/${token}`);
    return response.data;
  },

  // Native browser download so the archive streams with Content-Length
  // (real progress bar, no in-memory blob for a multi-GB gallery).
  downloadJobFile(slug: string, token: string, filename: string): void {
    const link = document.createElement('a');
    link.href = withAdminPreview(`/api/gallery/${slug}/download-jobs/${token}/file`);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
  },

  // Toggle photo visibility (client-only)
  async togglePhotoVisibility(slug: string, photoId: number, visibility: 'visible' | 'hidden'): Promise<void> {
    await api.patch(`/gallery/${slug}/photos/${photoId}/visibility`, { visibility });
  },

  // Bulk toggle photo visibility (client-only)
  async bulkToggleVisibility(slug: string, photoIds: number[], visibility: 'visible' | 'hidden'): Promise<void> {
    await api.patch(`/gallery/${slug}/photos/visibility/bulk`, { photoIds, visibility });
  },

  async resolveIdentifier(identifier: string): Promise<ResolvedGalleryIdentifier> {
    const response = await api.get<ResolvedGalleryIdentifier>(`/gallery/resolve/${identifier}`);
    return response.data;
  },

};
