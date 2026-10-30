import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardList, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import type { Photo } from '../../types';
import { galleryService } from '../../services/gallery.service';
import { useGuestIdentityOptional } from '../../contexts/GuestIdentityContext';

export function WorkflowPhotoAction({
  photo,
  slug,
  onFeedbackChange,
  onRequestClick,
  placement = 'overlay',
}: {
  photo: Photo;
  slug: string;
  onFeedbackChange?: () => void;
  onRequestClick: (event: MouseEvent<HTMLButtonElement>) => void;
  placement?: 'overlay' | 'toolbar';
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const guestIdentity = useGuestIdentityOptional();
  const [selected, setSelected] = useState(Boolean(photo.retouch_selected));
  const [busy, setBusy] = useState(false);
  const [showWithdrawOptions, setShowWithdrawOptions] = useState(false);
  const delivered = photo.retouch_state === 'delivered';

  const getSelectionErrorMessage = (error: any) => {
    if (error?.response?.data?.code === 'GUEST_IDENTITY_REQUIRED') {
      return t('photographyWorkflow.identityRequired');
    }
    if (error?.response?.status === 503) {
      return t('photographyWorkflow.workflowUnavailable');
    }
    if (error?.response?.status === 404) {
      return t('photographyWorkflow.photoUnavailable');
    }
    return t('photographyWorkflow.selectionFailed');
  };

  useEffect(() => setSelected(Boolean(photo.retouch_selected)), [photo.retouch_selected]);

  const updateSelection = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (busy) return;

    if (delivered && selected) {
      setShowWithdrawOptions(true);
      return;
    }

    setBusy(true);
    try {
      if (guestIdentity?.identityMode === 'guest') await guestIdentity.ensureIdentity();
      const result = await galleryService.setRetouchSelection(slug, photo.id, !selected);
      const nextSelected = result.selected;
      setSelected(nextSelected);
      toast.success(t(nextSelected
        ? 'photographyWorkflow.selectionAdded'
        : delivered ? 'photographyWorkflow.deliveredSelectionRemoved' : 'photographyWorkflow.selectionRemoved'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['gallery-photos', slug] }),
        queryClient.invalidateQueries({ queryKey: ['gallery-retouch-workflow', slug] }),
      ]);
      onFeedbackChange?.();
    } catch (error: any) {
      if (error?.message === 'user_cancelled') return;
      toast.error(error?.response?.status === 429
        ? t('feedback.rateLimited')
        : getSelectionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const withdrawSelection = async (deleteDelivered: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (guestIdentity?.identityMode === 'guest') await guestIdentity.ensureIdentity();
      const result = await galleryService.withdrawRetouchSelection(slug, photo.id, deleteDelivered);
      setShowWithdrawOptions(false);
      setSelected(false);
      toast.success(t(result.processing ? 'photographyWorkflow.withdrawProcessing' : result.kept_for_other_participant
        ? 'photographyWorkflow.keptForOtherParticipant'
        : deleteDelivered
          ? 'photographyWorkflow.deliveredDeleted'
          : 'photographyWorkflow.deliveredKept'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['gallery-photos', slug] }),
        queryClient.invalidateQueries({ queryKey: ['gallery-retouch-workflow', slug] }),
        queryClient.invalidateQueries({ queryKey: ['my-feedback', slug] }),
      ]);
      onFeedbackChange?.();
    } catch (error: any) {
      if (error?.message === 'user_cancelled') return;
      toast.error(error?.response?.data?.code === 'WITHDRAW_FAILED'
        ? t('photographyWorkflow.withdrawFailed')
        : getSelectionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const label = delivered
    ? selected ? t('photographyWorkflow.cancelSelection') : t('photographyWorkflow.selectForRetouch')
    : selected
      ? t('photographyWorkflow.selectedForRetouch')
      : t('photographyWorkflow.selectForRetouch');
  const description = selected && !delivered ? t('photographyWorkflow.cancelSelection') : label;

  return (
    <>
    <div className={`${placement === 'overlay' ? 'absolute bottom-2 right-2 z-[15]' : 'relative shrink-0'} flex max-w-full flex-wrap justify-end gap-2`}>
    {delivered && (
      <button type="button" onClick={(event) => { event.stopPropagation(); onRequestClick(event); }}
        disabled={busy || photo.retouch_withdraw_pending}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-amber-600 px-3 text-xs font-semibold text-white shadow-md hover:bg-amber-700 disabled:opacity-60">
        <ClipboardList className="h-4 w-4" aria-hidden="true" />{t('retouchRequest.open')}
      </button>
    )}
    <button
      type="button"
      onClick={updateSelection}
      disabled={busy || photo.retouch_withdraw_pending}
      aria-label={description}
      aria-pressed={selected}
      title={description}
      className={`relative shrink-0 inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-xs font-semibold shadow-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
        selected
            ? 'bg-emerald-700 text-white hover:bg-emerald-800'
            : 'bg-white text-neutral-900 hover:bg-emerald-50'
      } ${busy ? 'cursor-wait opacity-80' : ''}`}
    >
      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : selected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
      <span>{photo.retouch_withdraw_pending ? t('photographyWorkflow.withdrawProcessing') : busy ? t('photographyWorkflow.selectionSubmitting') : label}</span>
    </button>
    </div>
      {showWithdrawOptions && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={() => setShowWithdrawOptions(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`withdraw-title-${photo.id}`}
            className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 text-neutral-900 shadow-2xl dark:bg-neutral-900 dark:text-neutral-100"
            onClick={(event) => event.stopPropagation()}
          >
            <div>
              <h2 id={`withdraw-title-${photo.id}`} className="text-lg font-semibold">{t('photographyWorkflow.withdrawTitle')}</h2>
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">{t('photographyWorkflow.withdrawDescription')}</p>
            </div>
            <button type="button" disabled={busy || photo.retouch_withdraw_pending} onClick={() => void withdrawSelection(true)} className="w-full rounded-lg bg-red-600 px-4 py-3 text-left text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60">
              {t('photographyWorkflow.deleteDeliveredOption')}
            </button>
            <button type="button" disabled={busy || photo.retouch_withdraw_pending} onClick={() => void withdrawSelection(false)} className="w-full rounded-lg border border-neutral-300 px-4 py-3 text-left text-sm font-medium hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800">
              {t('photographyWorkflow.keepDeliveredOption')}
            </button>
            <div className="flex justify-end">
              <button type="button" disabled={busy || photo.retouch_withdraw_pending} onClick={() => setShowWithdrawOptions(false)} className="px-3 py-2 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
                {t('common.cancel')}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
