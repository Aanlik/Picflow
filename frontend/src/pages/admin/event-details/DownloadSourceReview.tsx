import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { api } from '../../../config/api';
import { Card } from '../../../components/common';
import { AdminAuthenticatedImage } from '../../../components/admin/AdminAuthenticatedImage';
import { PermissionGate } from '../../../components/admin/PermissionGate';

type Item = { id: number; filename: string; original_filename: string | null; source_filename: string | null; download_source_kind?: 'original' | 'delivery' };

export function DownloadSourceReview({ eventId }: { eventId: number }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [page, setPage] = useState(1);
  const [lastReview, setLastReview] = useState<{ id: number; filename: string; kind: 'original' | 'delivery' } | null>(null);
  const [pendingReview, setPendingReview] = useState<{ id: number; filename: string; kind: 'original' | 'delivery'; expected_kind?: 'original' | 'delivery' } | null>(null);
  const queryClient = useQueryClient();
  const key = ['download-source-review', eventId];
  const review = useQuery({
    queryKey: [...key, reviewed, page],
    queryFn: async () => (await api.get<{ photos: Item[]; total: number }>(`/admin/photos/${eventId}/download-source-review`, { params: reviewed ? { reviewed: 1, page } : {} })).data,
  });
  const classify = useMutation({
    mutationFn: async ({ id, kind, filename, expected_kind }: { id: number; filename: string; kind: 'original' | 'delivery'; expected_kind?: 'original' | 'delivery' }) =>
      api.patch(`/admin/photos/${eventId}/photos/${id}/download-source`, { kind, filename, expected_kind }),
    onSuccess: (_data, variables) => { setPendingReview(null); setLastReview(variables.expected_kind ? null : variables); void queryClient.invalidateQueries({ queryKey: key }); },
    onError: () => { toast.error(t('events.sourceReviewFailed', 'Could not update the photo source. Refresh and try again.')); },
  });
  const undo = useMutation({
    mutationFn: async (reviewed: NonNullable<typeof lastReview>) =>
      api.post(`/admin/photos/${eventId}/photos/${reviewed.id}/download-source/undo`, { filename: reviewed.filename, kind: reviewed.kind }),
    onSuccess: () => { setLastReview(null); void queryClient.invalidateQueries({ queryKey: key }); },
    onError: () => { toast.error(t('events.sourceReviewFailed', 'Could not update the photo source. Refresh and try again.')); },
  });
  if (review.isPending && !reviewed) return null;
  return <Card>
    <h3 className="text-base font-semibold">{t('events.sourceReviewTitle', 'Review older photo sources')}</h3>
    {review.isError ? <p className="mt-2 text-sm text-red-600">{t('events.sourceReviewLoadFailed', 'Could not load photos needing source review.')}</p> : <>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">{reviewed ? t('events.sourceReviewedDescription', { count: review.data?.total, defaultValue: '{{count}} classified photos; select a photo to correct its source.' }) : t('events.sourceReviewDescription', { count: review.data?.total, defaultValue: '{{count}} older photos need their source confirmed before split download permissions can apply.' })}</p>
      <button type="button" className="mt-2 block text-sm text-primary-600" onClick={() => { setReviewed(!reviewed); setPage(1); setExpanded(true); setPendingReview(null); }}>{reviewed ? t('events.sourceReviewUnknown', 'View unclassified') : t('events.sourceReviewClassified', 'Correct classified photos')}</button>
      {lastReview && !reviewed && <button type="button" disabled={undo.isPending} className="mt-2 block text-sm text-primary-600" onClick={() => undo.mutate(lastReview)}>{t('events.sourceReviewUndo', 'Undo last source decision')}</button>}
      <button type="button" className="mt-3 text-sm font-medium text-primary-600" onClick={() => setExpanded(!expanded)}>
        {expanded ? t('events.sourceReviewHide', 'Hide photos') : t('events.sourceReviewOpen', 'Review photos')}
      </button>
      {expanded && <div className="mt-3 space-y-3">{review.data?.photos.map(photo => <div key={photo.id} className="flex items-center gap-3 border-t border-neutral-200 pt-3 dark:border-neutral-700">
        <AdminAuthenticatedImage src={`/admin/photos/${eventId}/thumbnail/${photo.id}`} alt="" className="h-14 w-14 rounded object-cover" />
        <div className="min-w-0 flex-1 text-sm"><p className="break-all">{photo.source_filename || photo.original_filename || photo.filename}</p><p className="text-neutral-500">#{photo.id}{photo.download_source_kind ? ` · ${photo.download_source_kind === 'original' ? t('events.sourceReviewOriginal', 'Original') : t('events.sourceReviewDelivery', 'Delivered')}` : ''}</p></div>
        <PermissionGate permission="photos.edit"><div className="flex flex-wrap gap-2">
          {pendingReview?.id === photo.id ? <>
            <span className="text-sm">{pendingReview.kind === 'original' ? t('events.sourceReviewConfirmOriginal', 'Confirm original: {{name}}?', { name: photo.source_filename || photo.filename }) : t('events.sourceReviewConfirmDelivery', 'Confirm delivered photo: {{name}}?', { name: photo.source_filename || photo.filename })}</span>
            <button type="button" disabled={classify.isPending} className="rounded border px-2 py-1 text-sm" onClick={() => classify.mutate(pendingReview)}>{t('common.confirm', 'Confirm')}</button>
            <button type="button" disabled={classify.isPending} className="rounded border px-2 py-1 text-sm" onClick={() => setPendingReview(null)}>{t('common.cancel', 'Cancel')}</button>
          </> : <>
            <button type="button" disabled={classify.isPending} className="rounded border px-2 py-1 text-sm" onClick={() => setPendingReview({ id: photo.id, filename: photo.filename, kind: 'original', expected_kind: photo.download_source_kind })}>{t('events.sourceReviewOriginal', 'Original')}</button>
            <button type="button" disabled={classify.isPending} className="rounded border px-2 py-1 text-sm" onClick={() => setPendingReview({ id: photo.id, filename: photo.filename, kind: 'delivery', expected_kind: photo.download_source_kind })}>{t('events.sourceReviewDelivery', 'Delivered')}</button>
          </>}
        </div></PermissionGate>
      </div>)}{reviewed && <div className="flex gap-3 pt-3 text-sm"><button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>{t('common.previous', 'Previous')}</button><span>{page}</span><button type="button" disabled={page * 50 >= (review.data?.total || 0)} onClick={() => setPage(page + 1)}>{t('common.next', 'Next')}</button></div>}</div>}
    </>}
  </Card>;
}
