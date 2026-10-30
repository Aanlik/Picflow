import { AlertCircle, CheckCircle2, Cloud, ExternalLink, Loader2, RefreshCw, UploadCloud } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { usePermissions } from '../../contexts/PermissionsContext';
import { api } from '../../config/api';
import { Button, Card } from '../common';
import { useMutationWithToast } from '../../hooks';
import { toast } from 'react-toastify';
import { archiveService } from '../../services/archive.service';

type DeliveryStatus = {
  enabled: boolean;
  forceCloudDownloads: boolean;
  thumbnailSyncEnabled: boolean;
  previewSyncEnabled: boolean;
  galleryAssets: {
    thumbnail: { queued: number; uploading: number; ready: number; failed: number; paused: number };
    preview: { queued: number; uploading: number; ready: number; failed: number; paused: number };
  };
  galleryScans?: { thumbnail: number; preview: number };
  galleryScanErrors?: { thumbnail: number; preview: number };
  galleryReadyBytes?: number;
  backgroundReadBytesPerSecond?: number;
  galleryFailureDetails?: Array<{ photoId?: number; kind: string; width?: number; message?: string | null }>;
  storageConfigured: boolean;
  storageEnabled: boolean;
  counts: { queued: number; uploading: number; ready: number; failed: number; paused: number };
};

export function ObjectDeliveryCard({ eventId, isArchived = false }: { eventId: number; isArchived?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canEdit = usePermissions().hasPermission('events.edit');
  const { data, isLoading, isError, refetch } = useQuery<DeliveryStatus>({
    queryKey: ['object-delivery', eventId],
    queryFn: async () => (await api.get(`/admin/events/${eventId}/object-delivery`)).data,
    refetchInterval: 5000,
  });

  const updateMutation = useMutationWithToast({
    mutationFn: async (patch: { cloud_sync_enabled?: boolean; force_cloud_downloads?: boolean; cloud_thumbnail_sync_enabled?: boolean; cloud_preview_sync_enabled?: boolean }) =>
      (await api.patch(`/admin/events/${eventId}/object-delivery`, patch)).data,
    successMessage: (data: { backfill?: { error?: string }; forceCloudBlocked?: boolean; galleryBackfill?: Record<string, { error?: string }> }) =>
      data?.backfill?.error || data?.forceCloudBlocked || Object.values(data?.galleryBackfill || {}).some((item) => item?.error) ? '' : t('objectDelivery.saved', '云端设置已更新'),
    errorMessage: (error: unknown) => (error as { response?: { data?: { error?: string } } })?.response?.data?.error
      || t('objectDelivery.saveFailed', '更新云端交付设置失败'),
    invalidateKeys: [['object-delivery', eventId], ['admin-event', String(eventId)]],
    onSuccess: (result: { backfill?: { error?: string }; forceCloudBlocked?: boolean; galleryBackfill?: Record<string, { error?: string }> }) => {
      if (result?.forceCloudBlocked) toast.warning(t('objectDelivery.forceCloudBackfillWarning', '未启用强制云端下载：当前精修成片状态无法确认。请检查 Bridge 后重试；未交付原片仍走 NAS。'));
      else if (result?.backfill?.error) toast.warning(t('objectDelivery.backfillWarning', '设置已保存，但无法扫描当前精修交付。确认 Bridge 在线后点击“扫描现有成片”。'));
      if (Object.values(result?.galleryBackfill || {}).some((item) => item?.error)) toast.warning(t('objectDelivery.galleryBackfillWarning', '设置已保存，但无法扫描图库图片；请检查 NAS 挂载和对象存储后点击“扫描图库图片”。'));
    },
  });

  const retryMutation = useMutationWithToast({
    mutationFn: async () => (await api.post(`/admin/events/${eventId}/object-delivery/retry`)).data,
    successMessage: t('objectDelivery.retryQueued', '失败项目已加入重试队列'),
    errorMessage: t('objectDelivery.retryFailed', '无法重试云端同步'),
    invalidateKeys: [['object-delivery', eventId]],
  });

  const scanMutation = useMutationWithToast({
    mutationFn: async () => (await api.post(`/admin/events/${eventId}/object-delivery/rescan`)).data,
    successMessage: t('objectDelivery.scanQueued', '已扫描当前交付成片'),
    errorMessage: (error: unknown) => (error as { response?: { data?: { error?: string } } })?.response?.data?.error
      || t('objectDelivery.scanFailed', '扫描现有精修成片失败'),
    invalidateKeys: [['object-delivery', eventId]],
  });

  const galleryScanMutation = useMutationWithToast({
    mutationFn: async () => (await api.post(`/admin/events/${eventId}/object-delivery/gallery-assets/rescan`)).data,
    successMessage: t('objectDelivery.galleryScanQueued', '已扫描现有缩略图和预览图'),
    errorMessage: (error: unknown) => (error as { response?: { data?: { error?: string } } })?.response?.data?.error
      || t('objectDelivery.galleryScanFailed', '扫描云端缩略图和预览图失败'),
    invalidateKeys: [['object-delivery', eventId]],
  });

  const galleryRetryMutation = useMutationWithToast({
    mutationFn: async () => (await api.post(`/admin/events/${eventId}/object-delivery/gallery-assets/retry`)).data,
    successMessage: t('objectDelivery.galleryRetryQueued', '失败的图片预览已加入重试队列'),
    errorMessage: t('objectDelivery.galleryRetryFailed', '无法重试云端图片预览'),
    invalidateKeys: [['object-delivery', eventId]],
  });

  const toggle = (key: 'cloud_sync_enabled' | 'force_cloud_downloads' | 'cloud_thumbnail_sync_enabled' | 'cloud_preview_sync_enabled', value: boolean) => updateMutation.mutate({ [key]: value });
  const storageReady = Boolean(data?.storageConfigured && data.storageEnabled);
  const galleryFailures = (data?.galleryAssets?.thumbnail.failed || 0) + (data?.galleryAssets?.preview.failed || 0);
  const gallerySyncEnabled = Boolean(data?.thumbnailSyncEnabled || data?.previewSyncEnabled);
  const galleryScanCount = (data?.galleryScans?.thumbnail || 0) + (data?.galleryScans?.preview || 0);
  const galleryScanFailures = (data?.galleryScanErrors?.thumbnail || 0) + (data?.galleryScanErrors?.preview || 0);

  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <div className="rounded-lg bg-sky-50 p-2.5 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300"><Cloud className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t('objectDelivery.title', '云端交付')}</h3>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{t('objectDelivery.description', '将精修成片后台同步到对象存储；客户下载优先从云端读取。')}</p>
        </div>
        {!isLoading && !isError && data?.storageConfigured && data.storageEnabled && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />}
      </div>

      {isLoading ? <div className="flex items-center gap-2 py-5 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" />{t('common.loading', '加载中…')}</div> : null}
      {isError ? <div role="alert" className="flex items-center justify-between gap-3 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"><span>{t('objectDelivery.loadFailed', '无法读取云端交付状态')}</span><Button variant="outline" size="sm" onClick={() => void refetch()}>{t('common.retry', '重试')}</Button></div> : null}

      {data && !isLoading && !isError && (
        <>
          {(!data.storageConfigured || !data.storageEnabled) && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              <span>{!data.storageConfigured ? t('objectDelivery.notConfigured', '先配置对象存储，才能启用项目同步。') : t('objectDelivery.globallyDisabled', '对象存储交付已在系统设置中暂停；强制云端下载的项目暂时无法下载，其他项目会回退到 NAS。')}</span>
              <Button variant="outline" size="sm" rightIcon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => navigate('/admin/settings?tab=objectStorage')}>
                {t('objectDelivery.manageStorage', '管理对象存储')}
              </Button>
            </div>
          )}

          <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-700 dark:border-neutral-700">
            <label className="flex cursor-pointer items-start justify-between gap-5 p-4">
              <span className="flex gap-3">
                <UploadCloud className="mt-0.5 h-5 w-5 shrink-0 text-neutral-500" />
                <span>
                  <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">{t('objectDelivery.autoSync', '精修成片自动同步')}</span>
                  <span className="mt-1 block text-xs leading-5 text-neutral-600 dark:text-neutral-400">{t('objectDelivery.autoSyncHelp', '启用后扫描当前已交付成片，并在之后每次交付时后台上传。上传采用自动分块和失败重试。')}</span>
                </span>
              </span>
              <input type="checkbox" checked={data.enabled} disabled={!canEdit || isArchived || (!data.enabled && !storageReady) || updateMutation.isPending} onChange={(event) => toggle('cloud_sync_enabled', event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary-600" />
            </label>
            <label className={`flex items-start justify-between gap-5 p-4 ${!data.enabled ? 'opacity-60' : 'cursor-pointer'}`}>
              <span className="flex gap-3">
                <Cloud className="mt-0.5 h-5 w-5 shrink-0 text-neutral-500" />
                <span>
                  <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">{t('objectDelivery.forceCloud', '精修成片下载强制走云端')}</span>
                  <span className="mt-1 block text-xs leading-5 text-neutral-600 dark:text-neutral-400">{t('objectDelivery.forceCloudHelp', '只约束已交付的精修成片：云端副本未就绪时暂停这类下载，不回退到 NAS。待选片和其他原片仍从 NAS 下载。')}</span>
                </span>
              </span>
              <input type="checkbox" checked={data.forceCloudDownloads} disabled={!canEdit || isArchived || (!data.forceCloudDownloads && (!data.enabled || !storageReady)) || updateMutation.isPending} onChange={(event) => toggle('force_cloud_downloads', event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary-600" />
            </label>
          </div>

          <div className="mt-4 grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_max-content]">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-neutral-400">
              <span>{t('objectDelivery.queued', '排队 {{count}}', { count: data.counts.queued })}</span>
              <span>{t('objectDelivery.uploading', '上传中 {{count}}', { count: data.counts.uploading })}</span>
              <span>{t('objectDelivery.ready', '已就绪 {{count}}', { count: data.counts.ready })}</span>
              {data.counts.failed > 0 && <span className="text-red-700 dark:text-red-400">{t('objectDelivery.failed', '失败 {{count}}', { count: data.counts.failed })}</span>}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" disabled={!canEdit || isArchived || !data.enabled || !storageReady || scanMutation.isPending} isLoading={scanMutation.isPending} onClick={() => scanMutation.mutate()} leftIcon={<RefreshCw className="h-3.5 w-3.5" />}>
                {t('objectDelivery.scanExisting', '扫描现有成片')}
              </Button>
              {data.counts.failed > 0 && <Button variant="outline" size="sm" disabled={!canEdit || retryMutation.isPending || isArchived || !data.enabled || !storageReady} isLoading={retryMutation.isPending} onClick={() => retryMutation.mutate()}>{t('objectDelivery.retry', '重试失败项')}</Button>}
            </div>
          </div>
          {data.counts.failed > 0 && <p className="mt-3 flex items-start gap-2 text-xs text-red-700 dark:text-red-400"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{t('objectDelivery.failedHelp', '已自动重试多次仍未成功；检查对象存储连接后可手动重试。')}</p>}

          <div className="mt-5">
            <div className="mb-3">
              <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t('objectDelivery.galleryAssetsTitle', '客户图库图片')}</h4>
              <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-400">{t('objectDelivery.galleryAssetsDescription', '默认仍由 NAS 提供缩略图和预览图。仅打开对应开关后，系统才会后台同步该类图片；就绪后客户浏览器直接从对象存储加载。')}</p>
            </div>
            <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-700 dark:border-neutral-700">
              <label className="flex cursor-pointer items-start justify-between gap-5 p-4">
                <span className="flex gap-3">
                  <UploadCloud className="mt-0.5 h-5 w-5 shrink-0 text-neutral-500" />
                  <span>
                    <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">{t('objectDelivery.syncThumbnails', '同步缩略图到云端')}</span>
                    <span className="mt-1 block text-xs leading-5 text-neutral-600 dark:text-neutral-400">{t('objectDelivery.syncThumbnailsHelp', '只同步图库缩略图与视频封面；关闭后停止新同步，已上传文件保留，浏览恢复走 NAS。')}</span>
                    {data?.galleryAssets?.thumbnail && <span className="mt-2 block text-xs text-neutral-500">{t('objectDelivery.ready', '已就绪 {{count}}', { count: data.galleryAssets.thumbnail.ready })} · {t('objectDelivery.queued', '排队 {{count}}', { count: data.galleryAssets.thumbnail.queued + data.galleryAssets.thumbnail.uploading })}</span>}
                  </span>
                </span>
                <input type="checkbox" checked={data.thumbnailSyncEnabled} disabled={!canEdit || isArchived || (!data.thumbnailSyncEnabled && !storageReady) || updateMutation.isPending} onChange={(event) => toggle('cloud_thumbnail_sync_enabled', event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary-600" />
              </label>
              <label className="flex cursor-pointer items-start justify-between gap-5 p-4">
                <span className="flex gap-3">
                  <Cloud className="mt-0.5 h-5 w-5 shrink-0 text-neutral-500" />
                  <span>
                    <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">{t('objectDelivery.syncPreviews', '同步预览图到云端')}</span>
                    <span className="mt-1 block text-xs leading-5 text-neutral-600 dark:text-neutral-400">{t('objectDelivery.syncPreviewsHelp', '只同步图库大图预览和当前项目封面；不会上传原片。关闭后已上传文件保留，浏览恢复走 NAS。')}</span>
                    {data?.galleryAssets?.preview && <span className="mt-2 block text-xs text-neutral-500">{t('objectDelivery.ready', '已就绪 {{count}}', { count: data.galleryAssets.preview.ready })} · {t('objectDelivery.queued', '排队 {{count}}', { count: data.galleryAssets.preview.queued + data.galleryAssets.preview.uploading })}</span>}
                  </span>
                </span>
                <input type="checkbox" checked={data.previewSyncEnabled} disabled={!canEdit || isArchived || (!data.previewSyncEnabled && !storageReady) || updateMutation.isPending} onChange={(event) => toggle('cloud_preview_sync_enabled', event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary-600" />
              </label>
            </div>
            <div className="mt-3 grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_max-content]">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-neutral-400">
                <span>{t('objectDelivery.processingImages', '生成或上传中 {{count}}', { count: (data?.galleryAssets?.thumbnail.uploading || 0) + (data?.galleryAssets?.preview.uploading || 0) })}</span>
                <span>{t('objectDelivery.galleryReadySize', '图库云端就绪体积 {{size}}', { size: archiveService.formatBytes(data?.galleryReadyBytes || 0) })}</span>
                <span>{t('objectDelivery.backgroundReadRate', '后台同步读取速率（近 10 秒估算）{{speed}}/s', { speed: archiveService.formatBytes(data?.backgroundReadBytesPerSecond || 0) })}</span>
                {galleryScanCount > 0 && <span>{t('objectDelivery.scanningGallery', '后台扫描中 {{count}} 项', { count: galleryScanCount })}</span>}
                {galleryFailures > 0 && <span className="text-red-700 dark:text-red-400">{t('objectDelivery.failed', '失败 {{count}}', { count: galleryFailures })}</span>}
                {galleryScanFailures > 0 && <span className="text-red-700 dark:text-red-400">{t('objectDelivery.galleryScanErrorCount', '扫描受阻 {{count}} 项', { count: galleryScanFailures })}</span>}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" size="sm" disabled={!canEdit || isArchived || !storageReady || !gallerySyncEnabled || galleryScanMutation.isPending} isLoading={galleryScanMutation.isPending} onClick={() => galleryScanMutation.mutate()} leftIcon={<RefreshCw className="h-3.5 w-3.5" />}>
                  {t('objectDelivery.scanGalleryAssets', '扫描图库图片')}
                </Button>
                {(galleryFailures > 0 || galleryScanFailures > 0) && <Button variant="outline" size="sm" disabled={!canEdit || isArchived || galleryRetryMutation.isPending} isLoading={galleryRetryMutation.isPending} onClick={() => galleryRetryMutation.mutate()}>{t('objectDelivery.retryGalleryAssets', '重试失败项')}</Button>}
              </div>
            </div>
            {!!data?.galleryFailureDetails?.length && <ul className="mt-2 space-y-1 text-xs text-red-700 dark:text-red-400">
              {data.galleryFailureDetails.map((failure, index) => <li key={`${failure.kind}-${failure.photoId || 'scan'}-${failure.width || 0}-${index}`}>
                {failure.photoId ? `#${failure.photoId} · ` : ''}{failure.kind === 'thumbnail' ? t('objectDelivery.thumbnailKind', '缩略图') : t('objectDelivery.previewKind', '预览图')}{failure.width ? ` ${failure.width}px` : ''}: {failure.message || t('objectDelivery.galleryUnknownFailure', '同步失败，请重试')}
              </li>)}
            </ul>}
          </div>

        </>
      )}
    </Card>
  );
}
