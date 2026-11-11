import { useState } from 'react';
import type { FormEvent } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, ImageOff, LockKeyhole, LogOut, RefreshCw } from 'lucide-react';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import { useGalleryAuth } from '../contexts';
import { galleryService } from '../services/gallery.service';
import { DownloadQueue } from '../components/gallery/DownloadQueue';
import { DownloadResolutionModal } from '../components/gallery/DownloadResolutionModal';
import { Loading } from '../components/common';
import { versionedRetouchUrl } from '../utils/versionedRetouchUrl';
import type { RetouchWorkflow } from '../services/gallery.service';

export function DeliveryPortalPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isAuthenticated, accessLevel, event, deliveryLogin, logout, isLoading: authLoading } = useGalleryAuth();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [showResolutionPicker, setShowResolutionPicker] = useState(false);
  const shareToken = searchParams.get('token')
    || new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token')
    || '';
  const hasDeliveryAccess = isAuthenticated && accessLevel === 'delivery';
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['delivery-zone-photos', slug],
    queryFn: () => galleryService.getGalleryPhotos(slug, 'all'),
    enabled: Boolean(slug) && hasDeliveryAccess,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const { data: workflow } = useQuery<RetouchWorkflow>({
    queryKey: ['delivery-zone-workflow', slug],
    queryFn: () => galleryService.getRetouchWorkflow(slug),
    enabled: Boolean(slug) && hasDeliveryAccess,
    refetchInterval: 15000,
    retry: 1,
  });

  const handleLogin = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    if (!shareToken) {
      setLoginError(t('deliveryPortal.invalidLink'));
      return;
    }
    if (!password.trim()) {
      setLoginError(t('clientAccess.enterPin'));
      return;
    }
    setSubmitting(true);
    setLoginError('');
    try {
      await deliveryLogin(slug, password, shareToken);
      setPassword('');
    } catch (error: any) {
      const status = error?.response?.status;
      setLoginError(status === 423 ? t('auth.tooManyAttempts') : t('deliveryPortal.loginFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) return <div className="grid min-h-screen place-items-center bg-neutral-50 dark:bg-neutral-950"><Loading size="lg" /></div>;

  if (!hasDeliveryAccess) {
    return (
      <main className="grid min-h-screen place-items-center bg-neutral-50 px-4 py-12 dark:bg-neutral-950">
        <section className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-7 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"><LockKeyhole className="h-6 w-6" /></div>
          <h1 className="text-center text-2xl font-semibold text-neutral-950 dark:text-white">{t('deliveryPortal.loginTitle')}</h1>
          <p className="mt-2 text-center text-sm leading-6 text-neutral-600 dark:text-neutral-400">{t('deliveryPortal.loginDescription')}</p>
          {!shareToken ? (
            <p role="alert" className="mt-6 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{t('deliveryPortal.invalidLink')}</p>
          ) : (
            <form onSubmit={handleLogin} className="mt-6 space-y-4">
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-200">
                {t('deliveryPortal.passwordLabel')}
                <input
                  type="password"
                  value={password}
                  onChange={(inputEvent) => { setPassword(inputEvent.target.value); setLoginError(''); }}
                  required
                  minLength={8}
                  maxLength={72}
                  autoComplete="current-password"
                  autoFocus
                  className="mt-1.5 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-base text-neutral-950 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 dark:border-neutral-700 dark:bg-neutral-950 dark:text-white"
                />
              </label>
              {loginError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{loginError}</p>}
              <button type="submit" disabled={submitting || password.length < 8} className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
                {submitting ? t('common.submitting') : t('deliveryPortal.loginButton')}
              </button>
            </form>
          )}
        </section>
      </main>
    );
  }

  const photos = data?.photos || [];
  const workflowByPhotoId = new Map((workflow?.photos || []).map((photo) => [photo.photo_id, photo]));
  const allowDownloads = data?.event?.allow_downloads !== false;
  const downloadChoices = data?.event?.download_resolution?.picker_enabled
    ? data.event.download_resolution.choices || []
    : [];
  const downloadable = photos.filter((photo) => photo.download_allowed !== false && photo.category_allow_downloads !== false);

  const downloadPhoto = async (photoId: number, filename: string) => {
    try {
      await galleryService.downloadPhoto(slug, photoId, filename);
    } catch (error: any) {
      const code = error?.response?.data?.code;
      toast.error(code === 'CLOUD_DOWNLOAD_NOT_READY'
        ? t('downloadManager.errors.CLOUD_DOWNLOAD_NOT_READY')
        : t('gallery.photoDownloadFailed'));
    }
  };

  const downloadAll = async () => {
    if (downloadChoices.length > 1) {
      setShowResolutionPicker(true);
      return;
    }
    try {
      await galleryService.downloadAllPhotos(slug);
      if (downloadable.length) toast.info(t('gallery.downloadStarted', { photoCount: downloadable.length }));
    } catch {
      toast.error(t('gallery.allDownloadsFailed'));
    }
  };

  return (
    <main className="min-h-screen bg-neutral-50 pb-24 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">Picflow</p>
            <h1 className="mt-1 text-xl font-semibold text-neutral-950 dark:text-white">{t('deliveryPortal.title')}</h1>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{data?.event?.event_name || event?.event_name}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { logout(); navigate(`/gallery/${slug}`, { replace: true }); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800">
              <LogOut className="h-4 w-4" />{t('common.logout')}
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-neutral-900 dark:text-white">{t('deliveryPortal.photoCount', { count: photos.length })}</h2>
            <p className="mt-1 text-sm text-neutral-500">{t('deliveryPortal.adminHelp')}</p>
          </div>
          <div className="flex gap-2">
            {isError && <button type="button" onClick={() => void refetch()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-neutral-300 px-3 text-sm font-medium dark:border-neutral-700"><RefreshCw className="h-4 w-4" />{t('common.tryAgain')}</button>}
            <button type="button" onClick={() => void downloadAll()} disabled={!allowDownloads || !downloadable.length} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
              <Download className="h-4 w-4" />{t('deliveryPortal.downloadAll')}{downloadable.length ? ` (${downloadable.length})` : ''}
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="grid min-h-56 place-items-center"><Loading size="lg" /></div>
        ) : isError ? (
          <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{t('deliveryPortal.loadFailed')}</div>
        ) : photos.length === 0 ? (
          <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-neutral-300 bg-white text-center dark:border-neutral-700 dark:bg-neutral-900">
            <div><ImageOff className="mx-auto h-8 w-8 text-neutral-400" /><p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">{t('deliveryPortal.noPhotos')}</p></div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {photos.map((photo) => {
              const canDownload = allowDownloads && photo.download_allowed !== false && photo.category_allow_downloads !== false;
              const filename = photo.original_filename || photo.source_filename || photo.filename;
              const deliveredState = workflowByPhotoId.get(photo.id);
              const thumbnailUrl = versionedRetouchUrl(photo.thumbnail_url, deliveredState?.current_version || 0, deliveredState?.current_revision || 0);
              const previewUrl = versionedRetouchUrl(photo.preview_url, deliveredState?.current_version || 0, deliveredState?.current_revision || 0);
              return (
                <article key={photo.id} className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="aspect-[4/3] bg-neutral-100 dark:bg-neutral-800">
                    <img src={thumbnailUrl || previewUrl} alt={filename} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  </div>
                  <div className="p-3">
                    <p className="truncate text-xs text-neutral-600 dark:text-neutral-300" title={filename}>{filename}</p>
                    <button type="button" disabled={!canDownload} onClick={() => void downloadPhoto(photo.id, filename)} className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950/40">
                      <Download className="h-4 w-4" />{t('deliveryPortal.downloadPhoto')}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      <DownloadQueue slug={slug} historyEnabled={false} />
      {showResolutionPicker && (
        <DownloadResolutionModal
          slug={slug}
          choices={downloadChoices}
          onClose={() => setShowResolutionPicker(false)}
        />
      )}
    </main>
  );
}
