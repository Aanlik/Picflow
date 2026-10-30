import { parseISO, isValid } from 'date-fns';

// Helper to safely parse dates that might be strings, Date objects, or timestamps
export const safeParseDate = (dateValue: unknown): Date | null => {
  if (!dateValue) {
    return null;
  }
  if (dateValue instanceof Date) {
    return dateValue;
  }
  if (typeof dateValue === 'number') {
    return new Date(dateValue);
  }
  if (typeof dateValue === 'string') {
    const parsed = parseISO(dateValue);
    return isValid(parsed) ? parsed : new Date(dateValue);
  }
  return null;
};

export function photoMediaType(photo: { media_type?: string; mime_type?: string | null; type?: string }): 'photo' | 'video' {
  return photo.media_type === 'video' || photo.type === 'video' || photo.mime_type?.startsWith('video/') ? 'video' : 'photo';
}
