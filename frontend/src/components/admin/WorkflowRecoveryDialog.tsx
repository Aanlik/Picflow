import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { api } from '../../config/api';
import { Button } from '../common';

type Candidate = {
  remote_present: boolean; source_filename: string; previous_source: string;
  raw_candidates: string[]; final_candidates: string[]; raw_override?: string;
  requires_raw?: boolean; final_override?: string | null;
  work_filename?: string; next_version: number;
};
export function WorkflowRecoveryDialog({ eventId, photoId, onClose, onSaved }: {
  eventId: number; photoId: number; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<Candidate | null>(null);
  const [raw, setRaw] = useState('');
  const [final, setFinal] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api.get<Candidate>(`/admin/photography-workflow/${eventId}/photos/${photoId}/recovery`)
      .then(response => { if (active) { setData(response.data); setRaw(response.data.raw_override || ''); setFinal(response.data.final_override || ''); } })
      .catch(cause => { if (active) setError(cause.response?.data?.error || t('photographyWorkflow.recovery.loadError')); });
    return () => { active = false; };
  }, [eventId, photoId, t]);
  const save = async () => {
    setBusy(true); setError('');
    try {
      await api.post(`/admin/photography-workflow/${eventId}/photos/${photoId}/recovery`, {
        action: data?.remote_present ? 'rebind' : 'forget_missing', confirm: confirmed,
        raw_relative: data?.requires_raw === false ? undefined : raw, final_relative: final || null,
      });
      await onSaved();
      toast.success(t('photographyWorkflow.recovery.saved'));
      onClose();
    } catch (cause: any) { setError(cause.response?.data?.error || t('photographyWorkflow.recovery.saveError')); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="workflow-recovery-title" className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-xl bg-white p-6 dark:bg-neutral-900">
      <h2 id="workflow-recovery-title" className="mb-4 text-lg font-semibold">{t('photographyWorkflow.recovery.title')} · #{photoId}</h2>
      {error && <p role="alert" className="mb-3 text-red-600">{error}</p>}
      {!data && !error && <p>{t('common.loading')}</p>}
      {data && <div className="space-y-4">
        <p className="break-all">{data.previous_source} → {data.source_filename}</p>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{t(!data.remote_present ? 'photographyWorkflow.recovery.missingHelp' : data.requires_raw === false ? 'photographyWorkflow.recovery.uploadHelp' : 'photographyWorkflow.recovery.rebindHelp')}</p>
        {data.remote_present && <>
          {data.requires_raw !== false && <><label className="block">{t('photographyWorkflow.recovery.raw')}
            <input value={raw} onChange={e => setRaw(e.target.value)} list="workflow-raw-candidates" className="mt-1 w-full rounded border p-2 dark:bg-neutral-800" placeholder={t('photographyWorkflow.recovery.rawPlaceholder')} />
            <datalist id="workflow-raw-candidates">{data.raw_candidates.map(p => <option key={p} value={p} />)}</datalist>
          </label>
          {data.raw_candidates.length > 0 && <ul className="max-h-32 overflow-auto text-sm">{data.raw_candidates.map(p => <li key={p}><button type="button" onClick={() => setRaw(p)} className="break-all text-left text-blue-600 underline">{p}</button></li>)}</ul>}
          </>}
          <label className="block">{t('photographyWorkflow.recovery.final', { version: data.next_version })}
            <select value={final} onChange={e => setFinal(e.target.value)} className="mt-1 w-full rounded border p-2 dark:bg-neutral-800">
              <option value="">{t('photographyWorkflow.recovery.automaticFinal')}</option>
              {data.final_candidates.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        </>}
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{t('photographyWorkflow.recovery.confirm')}</label>
      </div>}
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="outline" disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
        <Button disabled={!data || !confirmed || (data.remote_present && data.requires_raw !== false && !raw.trim())} isLoading={busy} onClick={() => void save()}>{t(data?.remote_present ? 'photographyWorkflow.recovery.save' : 'photographyWorkflow.recovery.cleanup')}</Button>
      </div>
    </section>
  </div>;
}
