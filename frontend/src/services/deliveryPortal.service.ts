import { api } from '../config/api';

export interface DeliveryPortalShare {
  id: number;
  recipient_name: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  expired: boolean;
}

export interface DeliveryPortalShareLink {
  share_url: string;
}

export interface CreatedDeliveryPortalShare {
  id: number;
  recipient_name: string;
  share_url: string;
  expires_at: string;
}

export const deliveryPortalService = {
  async list(eventId: number): Promise<DeliveryPortalShare[]> {
    return (await api.get<DeliveryPortalShare[]>(`/admin/events/${eventId}/delivery-portal/shares`)).data;
  },
  async create(eventId: number, input: { recipient_name: string; password: string; expires_in_days: number }): Promise<CreatedDeliveryPortalShare> {
    return (await api.post<CreatedDeliveryPortalShare>(`/admin/events/${eventId}/delivery-portal/shares`, input)).data;
  },
  async revoke(eventId: number, shareId: number): Promise<void> {
    await api.delete(`/admin/events/${eventId}/delivery-portal/shares/${shareId}`);
  },
  async getLink(eventId: number, shareId: number): Promise<DeliveryPortalShareLink> {
    return (await api.get<DeliveryPortalShareLink>(`/admin/events/${eventId}/delivery-portal/shares/${shareId}/link`)).data;
  },
};
