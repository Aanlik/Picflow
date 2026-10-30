import { useQuery } from '@tanstack/react-query';
import { feedbackService } from '../services/feedback.service';

/**
 * Load feedback options only after the gallery photo response supplies the
 * real event id. Admin preview intentionally starts with a placeholder event
 * (id 0), so gating this query on the component prop leaves feedback controls
 * disabled forever in preview mode.
 */
export function useGalleryFeedbackSettings(slug: string, eventId?: number | null) {
  return useQuery({
    queryKey: ['gallery-feedback-settings', slug],
    queryFn: () => feedbackService.getGalleryFeedbackSettings(slug),
    enabled: Number.isSafeInteger(eventId) && Number(eventId) > 0,
    retry: false,
  });
}
