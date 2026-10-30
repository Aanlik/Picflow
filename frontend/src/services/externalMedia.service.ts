import { api } from '../config/api';

export type ExternalMediaErrorKey = 'readPermissionDenied' | 'folderUnavailable' | 'readError';

export function externalMediaErrorKey(error: unknown): ExternalMediaErrorKey {
  const response = (error as { response?: { status?: number; data?: { code?: string } } } | null)?.response;
  if (response?.data?.code === 'EXTERNAL_FOLDER_PERMISSION_DENIED') {
    return 'readPermissionDenied';
  }
  if (response?.data?.code === 'EXTERNAL_FOLDER_NOT_FOUND') {
    return 'folderUnavailable';
  }
  return 'readError';
}

export interface ExternalEntry {
  name: string;
  type: 'dir' | 'file';
  size?: number;
  mtime?: string;
}

export interface ExternalMediaListResponse {
  path: string;
  entries: ExternalEntry[];
  canNavigateUp: boolean;
}

export interface ExternalMediaImportOptions {
  recursive?: boolean;
  map?: { individual?: string; collages?: string };
}

export interface ExternalMediaImportResult {
  imported: number;
  skipped: number;
  thumbnailsQueued: number;
}

export type MaterialPurpose = 'gallery' | 'raw' | 'both';
export interface ExternalMediaSource {
  id: number;
  event_id: number;
  root_id: string;
  relative_path: string;
  purpose: MaterialPurpose;
  watch_enabled: boolean | number;
  status: string;
  is_active: boolean | number;
  last_scanned_at: string | null;
  last_error: string | null;
  photo_count?: number;
}

export interface ExternalMediaSourcesResponse {
  sources: ExternalMediaSource[];
  root_id: string;
  unlinked_photo_count?: number;
}

export const externalMediaService = {
  async list(pathRel: string = ''): Promise<ExternalMediaListResponse> {
    const params = new URLSearchParams();
    if (pathRel) params.set('path', pathRel);
    const res = await api.get<ExternalMediaListResponse>(`/admin/external-media/list?${params.toString()}`);
    return res.data;
  },

  async linkEvent(eventId: number, externalPath: string, watch: boolean): Promise<ExternalMediaImportResult> {
    const { source } = await this.addSource(eventId, {
      relative_path: externalPath,
      purpose: 'both',
      watch_enabled: watch,
    });
    return this.scanSource(eventId, source.id);
  },

  async listSources(eventId: number): Promise<ExternalMediaSourcesResponse> {
    const res = await api.get<ExternalMediaSourcesResponse>(`/admin/external-media/events/${eventId}/sources`);
    return res.data;
  },

  async addSource(eventId: number, input: {
    root_id?: string;
    relative_path: string;
    purpose: MaterialPurpose;
    watch_enabled: boolean;
  }): Promise<{ source: ExternalMediaSource; bridge_sync_warning?: boolean }> {
    const res = await api.post(`/admin/external-media/events/${eventId}/sources`, input);
    return res.data;
  },

  async updateSource(eventId: number, sourceId: number, input: {
    purpose?: MaterialPurpose;
    watch_enabled?: boolean;
  }): Promise<{ source: ExternalMediaSource; bridge_sync_warning?: boolean }> {
    const res = await api.patch(`/admin/external-media/events/${eventId}/sources/${sourceId}`, input);
    return res.data;
  },

  async scanSource(eventId: number, sourceId: number): Promise<ExternalMediaImportResult> {
    const res = await api.post<{ result: ExternalMediaImportResult }>(`/admin/external-media/events/${eventId}/sources/${sourceId}/scan`, {});
    return res.data.result;
  },

  async deactivateSource(eventId: number, sourceId: number): Promise<ExternalMediaSource> {
    const res = await api.post<{ source: ExternalMediaSource }>(`/admin/external-media/events/${eventId}/sources/${sourceId}/deactivate`, {});
    return res.data.source;
  },

  async importEvent(
    eventId: number,
    externalPath: string,
    options?: ExternalMediaImportOptions
  ): Promise<ExternalMediaImportResult> {
    const res = await api.post<ExternalMediaImportResult>(
      `/admin/external-media/events/${eventId}/import-external`,
      {
        external_path: externalPath,
        recursive: options?.recursive ?? true,
        map: options?.map
      }
    );
    return res.data;
  }
};
