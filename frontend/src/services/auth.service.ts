import { api } from '../config/api';
import type { LoginResponse, GalleryAuthResponse, AdminUser } from '../types';
import { normalizeRequirePassword } from '../utils/accessControl';

const normalizeGalleryResponse = (response: GalleryAuthResponse): GalleryAuthResponse => ({
  ...response,
  event: response.event
    ? {
        ...response.event,
        require_password: normalizeRequirePassword((response.event as any)?.require_password, true),
      }
    : response.event,
});

export const authService = {
  // Admin authentication
  async adminLogin(credentials: {
    username: string;
    password: string;
    rememberMe?: boolean;
  }): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>('/auth/admin/login', {
      username: credentials.username,
      password: credentials.password,
      remember_me: credentials.rememberMe === true
    });
    return response.data;
  },

  async adminLogout() {
    try {
      await api.post('/auth/logout');
      window.location.href = '/admin/login';
    } catch {
      // Ignore logout errors; fallback to redirect
      window.location.href = '/admin/login';
    }
  },

  // Gallery authentication
  async verifyGalleryPassword(slug: string, password?: string): Promise<GalleryAuthResponse> {
    const response = await api.post<GalleryAuthResponse>('/auth/gallery/verify', {
      slug,
      password
    });

    // Token is now handled by GalleryAuthContext with slug-specific storage
    return normalizeGalleryResponse(response.data);
  },

  async clientLogin(slug: string, password: string): Promise<GalleryAuthResponse> {
    const response = await api.post<GalleryAuthResponse>(`/auth/gallery/${slug}/client-login`, {
      password
    });
    return normalizeGalleryResponse(response.data);
  },

  async shareLinkLogin(slug: string, token: string): Promise<GalleryAuthResponse> {
    const response = await api.post<GalleryAuthResponse>('/auth/gallery/share-login', {
      slug,
      token,
    });
    return normalizeGalleryResponse(response.data);
  },

  async galleryLogout(slug?: string | null) {
    try {
      await api.post('/auth/gallery/logout', { slug });
    } catch {
      // Ignore; cookie will naturally expire if removal fails
    }
  },

  async updateAdminProfile(profile: { username: string }): Promise<AdminUser> {
    const response = await api.put<{ user: AdminUser }>('/auth/admin/profile', profile);
    return response.data.user;
  },
};
