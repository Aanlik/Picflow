import { api } from '../config/api';

export type FeatureKey =
  | 'galleries'
  | 'userManagement'
  // Live Slideshow ("Diashow") — per-event fullscreen kiosk link + presets +
  // global watermark settings tab. Strictly opt-in; gates all slideshow UI.
  | 'slideshow'
  // PicTransfer (migration 170) — cross-event file transfers:
  // a token-protected recipient download link plus an optional client-upload
  // channel. Strictly opt-in; gates the sidebar entry, the /admin/transfers
  // area and every transfer route (admin + public).
  | 'transfers'
  ;

export type FeatureFlags = Record<FeatureKey, boolean>;

export const featureFlagsService = {
  async get(): Promise<FeatureFlags> {
    const response = await api.get<FeatureFlags>('/admin/feature-flags');
    return response.data;
  },

  async update(flags: Partial<FeatureFlags>): Promise<FeatureFlags> {
    const response = await api.put<FeatureFlags>('/admin/feature-flags', flags);
    return response.data;
  },
};
