import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2, LockKeyhole, Share2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { api } from '../../config/api';
import { Button } from '../common';
import { buildShareLinkUrl } from '../../utils/url';

type SharePhoto = { photoId: number; filename: string; retouchVersion: number; ready: boolean; status: string };
type ActiveShare = { id: number; photoId: number; filename: string; expiresAt: string; available: boolean | null };
type ShareList = { workflowAvailable: boolean; eligiblePhotos: SharePhoto[]; activeShares: ActiveShare[] };
type CreatedShare = { id: number; shareUrl: string; filename: string; expiresAt: string; password: string };

export function CloudDeliveryShareManager({
  eventId,
  isArchived,
  canEdit,
  storageReady,
}: {
  eventId: number;
  isArchived: boolean;
  canEdit: boolean;
  storageReady: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [photoId, setPhotoId] = useState('');
  const [password, setPassword] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [created, setCreated] = useState<CreatedShare | null>(null);
  const [busy, setBusy] = useState(false);
  const queryKey = ['object-delivery-shares', eventId] as const;
  const { data, isLoading, isError, refetch } = useQuery<ShareList>({
    queryKey,
    queryFn: async () => (await api.get(`/admin/events/${eventId}/object-delivery/shares`)).data,
    staleTime: 10_000,
  });
  const readyPhotos = useMemo(() => (data?.eligiblePhotos || []).filter((photo) => photo.ready), [data?.eligiblePhotos]);

  useEffect(() => {
    if (readyPhotos.length && !readyPhotos.some((photo) => String(photo.photoId) === photoId)) {
      setPhotoId(String(readyPhotos[0].photoId));
    }
    if (!readyPhotos.length) setPhotoId('');
  }, [readyPhotos, photoId]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!photoId || busy || !password) return;
    setBusy(true);
    setCreated(null);
    try {
      const result = await api.post(`/admin/events/${eventId}/object-delivery/shares`, {
        photo_id: Number(photoId),
        password,
        expires_in_days: expiresInDays,
      });
      setCreated({ ...result.data, password });
      setPassword('');
      await queryClient.invalidateQueries({ queryKey });
    } catch (error: any) {
      toast.error(error?.response?.data?.error || t('cloudDeliveryShare.createFailed'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = value;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (!copied) throw new Error('Copy failed');
      }
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('common.copyFailed'));
    }
  };

  const revoke = async (share: ActiveShare) => {
    if (!window.confirm(t('cloudDeliveryShare.confirmRevoke', { filename: share.filename }))) return;
    setBusy(true);
    try {
      await api.delete(`/admin/events/${eventId}/object-delivery/shares/${share.id}`);
      if (created && created.id === share.id) setCreated(null);
      await queryClient.invalidateQueries({ queryKey });
      toast.success(t('cloudDeliveryShare.revoked'));
    } catch {
      toast.error(t('cloudDeliveryShare.revokeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const publicUrl = created ? buildShareLinkUrl(created.shareUrl) : '';
  const passwordBytes = new TextEncoder().encode(password).length;

  return (
    <section className="mt-6 border-t border-neutral-200 pt-5 dark:border-neutral-700" aria-labelledby={`cloud-share-title-${eventId}`}>
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-lg bg-violet-50 p-2 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"><Share2 className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <h4 id={`cloud-share-title-${eventId}`} className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t('cloudDeliveryShare.manageTitle')}</h4>
          <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-400">{t('cloudDeliveryShare.manageHelp')}</p>
        </div>
      </div>

      {!storageReady && <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{t('cloudDeliveryShare.storageUnavailable')}</p>}
      {data && !data.workflowAvailable && <p role="status" className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{t('cloudDeliveryShare.workflowUnavailable')}</p>}
      {isError && <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"><span>{t('cloudDeliveryShare.loadFailed')}</span><Button variant="outline" size="sm" onClick={() => void refetch()}>{t('common.retry')}</Button></div>}

      <form onSubmit={(event) => void handleCreate(event)} className="grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-700 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-1.5 block text-xs font-medium text-neutral-700 dark:text-neutral-300">{t('cloudDeliveryShare.choosePhoto')}</span>
          <select value={photoId} onChange={(event) => setPhotoId(event.target.value)} disabled={!canEdit || isArchived || !storageReady || busy || isLoading || readyPhotos.length === 0} className="input w-full">
            {readyPhotos.length === 0 && <option value="">{isLoading ? t('common.loading') : t('cloudDeliveryShare.noReadyPhotos')}</option>}
            {readyPhotos.map((photo) => <option key={photo.photoId} value={photo.photoId}>{photo.filename}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1.5 block text-xs font-medium text-neutral-700 dark:text-neutral-300">{t('cloudDeliveryShare.password')}</span>
          <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={72} required className="input w-full" disabled={!canEdit || isArchived || !storageReady || busy} />
        </label>
        <label>
          <span className="mb-1.5 block text-xs font-medium text-neutral-700 dark:text-neutral-300">{t('cloudDeliveryShare.expiry')}</span>
          <select value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))} disabled={!canEdit || isArchived || busy} className="input w-full">
            <option value={1}>{t('cloudDeliveryShare.oneDay')}</option>
            <option value={7}>{t('cloudDeliveryShare.sevenDays')}</option>
            <option value={30}>{t('cloudDeliveryShare.thirtyDays')}</option>
          </select>
        </label>
        <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">{t('cloudDeliveryShare.passwordRule')}{passwordBytes > 72 ? ` ${t('cloudDeliveryShare.passwordTooLong')}` : ''}</p>
          <Button type="submit" size="sm" disabled={!canEdit || isArchived || !storageReady || readyPhotos.length === 0 || password.length < 8 || passwordBytes > 72 || busy} isLoading={busy} leftIcon={<LockKeyhole className="h-3.5 w-3.5" />}>
            {t('cloudDeliveryShare.create')}
          </Button>
        </div>
      </form>

      {created && (
        <div className="mt-3 space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/25">
          <div>
            <p className="text-sm font-medium text-emerald-950 dark:text-emerald-100">{t('cloudDeliveryShare.createdTitle', { filename: created.filename })}</p>
            <p className="mt-1 text-xs text-emerald-900/80 dark:text-emerald-100/80">{t('cloudDeliveryShare.createdHelp')}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input readOnly value={publicUrl} aria-label={t('cloudDeliveryShare.shareLink')} className="input min-w-0 flex-1" onFocus={(event) => event.currentTarget.select()} />
            <Button variant="outline" size="sm" onClick={() => void copy(publicUrl)} leftIcon={<Copy className="h-3.5 w-3.5" />}>{t('cloudDeliveryShare.copyLink')}</Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-950 dark:text-emerald-100">
            <span>{t('cloudDeliveryShare.passwordToShare', { password: created.password })}</span>
            <Button variant="ghost" size="sm" onClick={() => void copy(created.password)}>{t('cloudDeliveryShare.copyPassword')}</Button>
          </div>
          <p className="text-xs text-emerald-900/80 dark:text-emerald-100/80">{t('cloudDeliveryShare.expiresAt', { date: new Date(created.expiresAt).toLocaleString() })}</p>
        </div>
      )}

      {(data?.activeShares.length || 0) > 0 && (
        <div className="mt-5">
          <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">{t('cloudDeliveryShare.activeTitle')}</h5>
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-700 dark:border-neutral-700">
            {data?.activeShares.map((share) => (
              <li key={share.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{share.filename}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400"><Link2 className="h-3.5 w-3.5" />{t(share.available === null ? 'cloudDeliveryShare.linkUnknown' : share.available ? 'cloudDeliveryShare.linkReady' : 'cloudDeliveryShare.linkUnavailable')} · {t('cloudDeliveryShare.expiresAt', { date: new Date(share.expiresAt).toLocaleString() })}</p>
                </div>
                <Button variant="ghost" size="sm" disabled={!canEdit || busy} onClick={() => void revoke(share)} leftIcon={<X className="h-3.5 w-3.5" />}>{t('cloudDeliveryShare.revoke')}</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
