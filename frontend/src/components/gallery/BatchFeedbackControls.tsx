import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { Button } from '../common';
import { feedbackService } from '../../services/feedback.service';
import { galleryService } from '../../services/gallery.service';
import { useGuestIdentityOptional } from '../../contexts/GuestIdentityContext';
import { partitionRetouchBatchPhotoIds, type RetouchBatchPhotoState } from './photoSelection';

interface BatchFeedbackControlsProps {
  slug: string;
  photoIds: number[];
  retouchSelectionStates: RetouchBatchPhotoState[];
  retouchEnabled: boolean;
  commentsEnabled: boolean;
  requireGuestName: boolean;
}

/** Batch client proofing actions shown alongside the normal selection toolbar. */
export function BatchFeedbackControls({
  slug,
  photoIds,
  retouchSelectionStates,
  retouchEnabled,
  commentsEnabled,
  requireGuestName,
}: BatchFeedbackControlsProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const guestIdentity = useGuestIdentityOptional();
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [retouchProgress, setRetouchProgress] = useState<{ completed: number; total: number } | null>(null);
  const isGuestMode = guestIdentity?.identityMode === 'guest';
  const retouchChanges = partitionRetouchBatchPhotoIds(photoIds, retouchSelectionStates);

  if (!photoIds.length || (!commentsEnabled && (!retouchEnabled || (!retouchChanges.toSelect.length && !retouchChanges.toCancel.length)))) return null;

  const refreshFeedback = () => {
    queryClient.invalidateQueries({ queryKey: ['gallery-photos', slug] });
    queryClient.invalidateQueries({ queryKey: ['my-feedback', slug] });
    queryClient.invalidateQueries({ queryKey: ['photo-feedback', slug] });
    queryClient.invalidateQueries({ queryKey: ['gallery-retouch-workflow', slug] });
  };

  const submitComment = async () => {
    if (busy) return;
    if (photoIds.length > 20) {
      toast.error(t('gallery.batchCommentLimit'));
      return;
    }
    if (!comment.trim()) {
      toast.error(t('gallery.batchCommentRequired'));
      return;
    }
    if (requireGuestName && !isGuestMode && !name.trim()) {
      toast.error(t('gallery.batchGuestInfoRequired'));
      return;
    }
    setBusy(true);
    try {
      if (isGuestMode && guestIdentity) await guestIdentity.ensureIdentity();
      const result = await feedbackService.submitBatchFeedback(slug, {
        photo_ids: photoIds,
        feedback_type: 'comment',
        comment_text: comment.trim(),
        guest_name: name.trim() || undefined,
      });
      refreshFeedback();
      if (result.applied_count > 0) {
        toast.success(t('gallery.batchCommentAdded', { count: result.applied_count }));
      }
      if (result.failed_photo_ids.length) {
        toast.error(t('gallery.batchPartialFailure', { count: result.failed_photo_ids.length }));
      }
      if (result.failed_photo_ids.length === 0) {
        setComment('');
        setCommentOpen(false);
      }
    } catch (error: any) {
      if (error?.message === 'user_cancelled') return;
      const status = error?.response?.status;
      toast.error(status === 429
        ? t('feedback.rateLimited')
        : status === 401
          ? t('gallery.batchIdentityRequired')
          : t('gallery.batchActionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const submitRetouchSelections = async (targetPhotoIds: number[], selected: boolean) => {
    if (busy) return;
    setBusy(true);
    setRetouchProgress({ completed: 0, total: targetPhotoIds.length });
    try {
      if (isGuestMode && guestIdentity) await guestIdentity.ensureIdentity();
      const result = await galleryService.submitBatchRetouchSelections(slug, targetPhotoIds, selected, (completed, total) => {
        setRetouchProgress({ completed, total });
      });
      refreshFeedback();
      if (result.applied_count > 0) {
        toast.success(t(selected ? 'gallery.batchMarkedForEditing' : 'gallery.batchRetouchSelectionCancelled', { count: result.applied_count }));
      }
    } catch (error: any) {
      if (error?.message === 'user_cancelled') return;
      // The response to a batch may be lost after the server commits it. A
      // refresh reconciles that uncertain batch with the authoritative state.
      refreshFeedback();
      const code = error?.response?.data?.code;
      const confirmed = Number(error?.batchProgress?.completed) || 0;
      if (code === 'DELIVERED_SELECTION_WITHDRAWAL_REQUIRED') {
        toast[confirmed > 0 ? 'warning' : 'error'](confirmed > 0
          ? t('gallery.batchRetouchCancelPartialGuard', { completed: confirmed })
          : t('gallery.batchRetouchWithdrawalRequired'));
        return;
      }
      if (confirmed > 0) {
        toast.warning(t(selected ? 'gallery.batchRetouchPartial' : 'gallery.batchRetouchCancelPartial', {
          completed: confirmed,
          total: targetPhotoIds.length,
        }));
        return;
      }
      const status = error?.response?.status;
      toast.error(status === 429 ? t('feedback.rateLimited') : status === 401 ? t('gallery.batchIdentityRequired') : t('gallery.batchActionFailed'));
    } finally {
      setBusy(false);
      setRetouchProgress(null);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="gallery-numeric text-sm font-medium">{t('gallery.batchActionsTitle', { count: photoIds.length })}</span>
        {retouchEnabled && retouchChanges.toSelect.length > 0 && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void submitRetouchSelections(retouchChanges.toSelect, true)}>
            {t('gallery.batchMarkForEditing')} ({retouchChanges.toSelect.length})
          </Button>
        )}
        {retouchEnabled && retouchChanges.toCancel.length > 0 && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void submitRetouchSelections(retouchChanges.toCancel, false)}>
            {t('gallery.batchCancelRetouchSelection', { count: retouchChanges.toCancel.length })}
          </Button>
        )}
        {commentsEnabled && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setCommentOpen(value => !value)}>
            {t('gallery.batchComment')}
          </Button>
        )}
        {busy && <span className="text-xs text-neutral-500">{retouchProgress
          ? t('gallery.batchSubmittingProgress', retouchProgress)
          : t('gallery.batchSubmitting')}</span>}
      </div>
      {retouchEnabled && <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">{t('gallery.batchRetouchScopeHint')}</p>}
      {commentsEnabled && photoIds.length > 20 && <p className="text-xs text-amber-700">{t('gallery.batchCommentLimit')}</p>}
      {commentOpen && commentsEnabled && (
        <div className="space-y-2">
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={1000}
            rows={3}
            aria-label={t('gallery.batchCommentPlaceholder')}
            placeholder={t('gallery.batchCommentPlaceholder')}
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 bg-transparent p-2 text-sm"
          />
          {requireGuestName && !isGuestMode && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder={t('feedback.yourName')} className="rounded-md border border-neutral-300 dark:border-neutral-600 bg-transparent p-2 text-sm" />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setCommentOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" size="sm" disabled={busy || !comment.trim()} onClick={() => void submitComment()}>{t('gallery.batchCommentSubmit')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
