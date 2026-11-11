import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CloudDownload, LockKeyhole } from 'lucide-react';
import { api } from '../../config/api';
import { Button, Card } from '../../components/common';

type UnlockResult = { url: string; filename: string; expiresInSeconds: number };

export function CloudDeliverySharePage() {
  const { token = '' } = useParams<{ token: string }>();
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [download, setDownload] = useState<UnlockResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const unlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError('');
    setDownload(null);
    try {
      const result = await api.post<UnlockResult>(`/public/cloud-delivery-shares/${token}/unlock`, { password });
      setDownload(result.data);
      setPassword('');
    } catch (cause: any) {
      const code = cause?.response?.data?.code;
      setError(code === 'SHARE_PASSWORD_INVALID'
        ? t('cloudDeliveryShare.wrongPassword')
        : code === 'SHARE_TRY_AGAIN_LATER'
          ? t('cloudDeliveryShare.tooManyAttempts')
          : t('cloudDeliveryShare.unavailable'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main id="main-content" className="min-h-screen bg-neutral-50 px-4 py-12 dark:bg-neutral-950 sm:py-20">
      <Card className="mx-auto max-w-md p-6 sm:p-8">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
          {download ? <CloudDownload className="h-6 w-6" aria-hidden="true" /> : <LockKeyhole className="h-6 w-6" aria-hidden="true" />}
        </div>
        <h1 className="text-xl font-semibold text-neutral-950 dark:text-white">{t('cloudDeliveryShare.title')}</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
          {download ? t('cloudDeliveryShare.readyHelp') : t('cloudDeliveryShare.passwordHelp')}
        </p>

        {!download ? (
          <form onSubmit={(event) => void unlock(event)} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-neutral-800 dark:text-neutral-100">{t('cloudDeliveryShare.password')}</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                maxLength={200}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="input w-full"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'cloud-share-error' : undefined}
              />
            </label>
            {error && <p id="cloud-share-error" role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
            <Button type="submit" size="md" disabled={busy || !password} isLoading={busy} className="w-full">
              {t('cloudDeliveryShare.unlock')}
            </Button>
          </form>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900">
              <p className="break-all text-sm font-medium text-neutral-900 dark:text-neutral-100">{download.filename}</p>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t('cloudDeliveryShare.directDownload')}</p>
            </div>
            <a
              href={download.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-md inline-flex w-full items-center justify-center"
            >
              <CloudDownload className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('cloudDeliveryShare.download')}
            </a>
            <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">{t('cloudDeliveryShare.temporaryUrlHelp', { minutes: Math.ceil(download.expiresInSeconds / 60) })}</p>
          </div>
        )}
      </Card>
    </main>
  );
}
