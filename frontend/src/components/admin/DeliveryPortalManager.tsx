import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Link2, LockKeyhole, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '../common';
import { deliveryPortalService } from '../../services/deliveryPortal.service';
import { usePermissions } from '../../contexts/PermissionsContext';

export function DeliveryPortalManager({ eventId, isArchived = false, isShareable = true }: { eventId: number; isArchived?: boolean; isShareable?: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canEdit = usePermissions().hasPermission('events.edit');
  const [recipientName, setRecipientName] = useState('');
  const [password, setPassword] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [creating, setCreating] = useState(false);
  const [newShareUrl, setNewShareUrl] = useState('');
  const { data: shares = [], isLoading } = useQuery({
    queryKey: ['delivery-portal-shares', eventId],
    queryFn: () => deliveryPortalService.list(eventId),
  });
  const liveCount = useMemo(() => shares.filter((share) => !share.revoked_at && !share.expired).length, [shares]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      const created = await deliveryPortalService.create(eventId, {
        recipient_name: recipientName.trim(),
        password,
        expires_in_days: expiresInDays,
      });
      setNewShareUrl(created.share_url);
      setPassword('');
      await queryClient.invalidateQueries({ queryKey: ['delivery-portal-shares', eventId] });
      toast.success(t('deliveryPortal.created'));
    } catch (error: any) {
      toast.error(error?.response?.data?.error || t('deliveryPortal.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('common.copyFailed'));
    }
  };

  return (
    <Card padding="md">
      <div className="mb-3 flex items-center gap-2">
        <Download className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t('deliveryPortal.adminTitle')}</h2>
        <span className="ml-auto rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          {t('deliveryPortal.activeCount', { count: liveCount })}
        </span>
      </div>
      <p className="mb-4 text-sm leading-6 text-neutral-600 dark:text-neutral-400">{t('deliveryPortal.adminHelp')}</p>

      {canEdit && !isArchived && !isShareable && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{t('deliveryPortal.publishBeforeShare')}</p>
      )}

      {canEdit && !isArchived && isShareable && (
        <form onSubmit={create} className="space-y-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-700">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              {t('deliveryPortal.recipient')}
              <input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} required maxLength={120} className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-normal dark:border-neutral-700 dark:bg-neutral-900" />
            </label>
            <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              {t('deliveryPortal.password')}
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} maxLength={72} autoComplete="new-password" className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-normal dark:border-neutral-700 dark:bg-neutral-900" />
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              {t('deliveryPortal.validFor')}
              <select value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))} className="mt-1 block rounded-lg border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
                {[1, 7, 14, 30, 60, 90].map((days) => <option key={days} value={days}>{t('deliveryPortal.days', { count: days })}</option>)}
              </select>
            </label>
            <Button type="submit" disabled={creating || !recipientName.trim() || password.length < 8} isLoading={creating} leftIcon={<Link2 className="h-4 w-4" />}>
              {t('deliveryPortal.createShare')}
            </Button>
          </div>
        </form>
      )}

      {newShareUrl && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-900 dark:text-emerald-100"><ShieldCheck className="h-4 w-4" />{t('deliveryPortal.linkReady')}</div>
          <div className="flex gap-2">
            <input value={newShareUrl} readOnly className="min-w-0 flex-1 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs text-neutral-700 dark:border-emerald-800 dark:bg-neutral-900 dark:text-neutral-200" />
            <Button type="button" variant="outline" onClick={() => void copy(newShareUrl)} leftIcon={<Copy className="h-4 w-4" />}>{t('common.copy')}</Button>
          </div>
          <p className="mt-2 text-xs leading-5 text-emerald-900/80 dark:text-emerald-100/80">{t('deliveryPortal.sendPasswordSeparately')}</p>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {isLoading && <p className="text-sm text-neutral-500">{t('common.loading')}</p>}
        {!isLoading && shares.length === 0 && <p className="text-sm text-neutral-500">{t('deliveryPortal.empty')}</p>}
        {shares.map((share) => {
          const revoked = Boolean(share.revoked_at);
          const expired = share.expired;
          return (
            <div key={share.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 px-3 py-2.5 dark:border-neutral-700">
              <LockKeyhole className="h-4 w-4 shrink-0 text-neutral-500" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-neutral-900 dark:text-neutral-100">{share.recipient_name}</div>
                <div className="text-xs text-neutral-500">{revoked ? t('deliveryPortal.revoked') : expired ? t('deliveryPortal.expired') : t('deliveryPortal.expiresAt', { date: new Date(share.expires_at).toLocaleString() })}</div>
              </div>
              {canEdit && !isArchived && !revoked && !expired && (
                <Button type="button" variant="ghost" size="sm" leftIcon={<XCircle className="h-4 w-4" />} onClick={async () => {
                  if (!window.confirm(t('deliveryPortal.revokeConfirm', { name: share.recipient_name }))) return;
                  try {
                    await deliveryPortalService.revoke(eventId, share.id);
                    await queryClient.invalidateQueries({ queryKey: ['delivery-portal-shares', eventId] });
                    toast.success(t('deliveryPortal.revoked'));
                  } catch { toast.error(t('deliveryPortal.revokeFailed')); }
                }}>{t('deliveryPortal.revoke')}</Button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
