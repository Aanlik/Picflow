import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { AlertCircle, Upload, X, FolderPlus, RefreshCw, Pause, Play, Unlink } from 'lucide-react';
import { Button, Card, Loading } from '../../../components/common';
import { AdminPhotoGrid } from '../../../components/admin/AdminPhotoGrid';
import { AdminPhotoViewer } from '../../../components/admin/AdminPhotoViewer';
import { PhotoFilters } from '../../../components/admin/PhotoFilters';
import { PhotoUploadModal } from '../../../components/admin/PhotoUploadModal';
import { PhotoFilterPanel } from '../../../components/admin/PhotoFilterPanel';
import { PhotoExportMenu } from '../../../components/admin/PhotoExportMenu';
import { PermissionGate } from '../../../components/admin/PermissionGate';
import { externalMediaService, type MaterialPurpose } from '../../../services/externalMedia.service';
import { AdminPhoto, type PhotoFilters as PhotoFilterParams, type FeedbackFilters, type FilterSummary } from '../../../services/photos.service';
import { NasFolderSelection } from '../../../components/admin/NasFolderSelection';
import { snapshotSourcePhotoCounts, sourcePhotoCountsChanged } from './sourcePhotoCounts';

interface PhotosTabProps {
  id: string | undefined;
  eventIsActive: boolean;
  photos: AdminPhoto[];
  photosLoading: boolean;
  photosError: boolean;
  refetchPhotos: () => void;
  categories: Array<{ id: number; name: string; slug: string; is_folder?: boolean }>;
  photoFilters: PhotoFilterParams;
  setPhotoFilters: React.Dispatch<React.SetStateAction<PhotoFilterParams>>;
  feedbackFilters: FeedbackFilters;
  setFeedbackFilters: React.Dispatch<React.SetStateAction<FeedbackFilters>>;
  filterSummary: FilterSummary | undefined;
  showMediaFilter: boolean;
}

export const PhotosTab: React.FC<PhotosTabProps> = ({
  id,
  eventIsActive,
  photos,
  photosLoading,
  photosError,
  refetchPhotos,
  categories,
  photoFilters,
  setPhotoFilters,
  feedbackFilters,
  setFeedbackFilters,
  filterSummary,
  showMediaFilter
}) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [showPhotoUpload, setShowPhotoUpload] = useState(false);
  const [showExternalImport, setShowExternalImport] = useState(false);
  const [externalPath, setExternalPath] = useState<string>('');
  const [externalWatch, setExternalWatch] = useState(true);
  const [externalPurpose, setExternalPurpose] = useState<MaterialPurpose>('both');
  const [importing, setImporting] = useState<boolean>(false);
  const [selectedPhoto, setSelectedPhoto] = useState<{ photo: AdminPhoto; index: number } | null>(null);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<number[]>([]);
  const asEnabled = (value: boolean | number | undefined) => value === true || value === 1;
  const materialSourcesQuery = useQuery({
    queryKey: ['external-material-sources', id],
    queryFn: () => externalMediaService.listSources(parseInt(id!)),
    enabled: Boolean(id),
    retry: false,
    // Watcher imports run outside this page's manual scan mutation. Poll only
    // the small source summary while the published event has active watches.
    refetchInterval: (query) => {
      if (!eventIsActive) return false;
      const sources = query.state.data?.sources || [];
      return sources.some((source) => asEnabled(source.is_active) && asEnabled(source.watch_enabled))
        ? 15_000
        : false;
    },
  });
  const sourcePhotoCountRows = materialSourcesQuery.data?.sources;
  const materialSources = sourcePhotoCountRows || [];
  const previousSourcePhotoCounts = useRef<{ eventId: string; counts: Map<number, number> } | null>(null);
  useEffect(() => {
    if (!id || !sourcePhotoCountRows) return;

    const previous = previousSourcePhotoCounts.current;
    const counts = snapshotSourcePhotoCounts(sourcePhotoCountRows);
    previousSourcePhotoCounts.current = { eventId: id, counts };
    if (!previous || previous.eventId !== id || !sourcePhotoCountsChanged(previous.counts, counts)) return;

    // Refresh the gallery and its surrounding counts when the watcher imports
    // photos. Manual scans already invalidate these queries directly.
    void queryClient.invalidateQueries({ queryKey: ['admin-event-photos', id] });
    void queryClient.invalidateQueries({ queryKey: ['admin-event-filter-summary', id] });
    void queryClient.invalidateQueries({ queryKey: ['admin-event', id] });
  }, [id, sourcePhotoCountRows, queryClient]);
  const refreshMaterialSources = () => {
    void queryClient.invalidateQueries({ queryKey: ['external-material-sources', id] });
  };
  const sourceStatusKey = (status: string) => `nasFolder.status.${status}`;

  return (
    <div>
      {/* Photo Upload Modal */}
      <PhotoUploadModal
        isOpen={showPhotoUpload}
        onClose={() => setShowPhotoUpload(false)}
        eventId={parseInt(id!)}
        onUploadComplete={() => {
          // Refresh-only. PhotoUpload fires this as bytes land AND again when
          // processing finishes — including runs where every file was rejected
          // — so a success toast here claimed "Upload completed successfully"
          // over the top of the rejection warning (QA P4-B.05 / 7.05). The
          // outcome toast belongs to PhotoUpload, which knows the counts.
          queryClient.invalidateQueries({ queryKey: ['admin-event', id] });
          queryClient.invalidateQueries({ queryKey: ['admin-event-photos', id] });
          queryClient.invalidateQueries({ queryKey: ['admin-event-filter-summary', id] });
          refetchPhotos();
        }}
      />

      {/* Photo Filters */}
      <PhotoFilters
        categories={categories}
        selectedCategory={photoFilters.category_id}
        searchTerm={photoFilters.search ?? ''}
        sortBy={photoFilters.sort ?? 'date'}
        sortOrder={photoFilters.order ?? 'desc'}
        onCategoryChange={(categoryId) => setPhotoFilters(prev => ({ ...prev, category_id: categoryId }))}
        onSearchChange={(search) => setPhotoFilters(prev => ({ ...prev, search }))}
        onSortChange={(sort, order) => setPhotoFilters(prev => ({ ...prev, sort, order }))}
        mediaType={photoFilters.media_type || 'all'}
        onMediaTypeChange={(mediaType) => setPhotoFilters(prev => ({
          ...prev,
          media_type: mediaType === 'all' ? undefined : mediaType
        }))}
        showMediaFilter={showMediaFilter}
      />

      {/* Feedback Filter Panel for Export */}
      <PhotoFilterPanel
        filters={feedbackFilters}
        onChange={setFeedbackFilters}
        summary={filterSummary || null}
        isLoading={photosLoading}
      />

      {/* Actions Bar */}
      <div className="mb-4 flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <PermissionGate permission="photos.upload">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Upload className="w-4 h-4" />}
              onClick={() => setShowPhotoUpload(true)}
            >
              {t('events.uploadPhotos')}
            </Button>
          </PermissionGate>
              <PermissionGate permission="photos.upload">
              <Button
                variant="outline"
                size="sm"
                leftIcon={<FolderPlus className="w-4 h-4" />}
                onClick={() => { setExternalPath(''); setExternalWatch(true); setExternalPurpose('both'); setShowExternalImport(true); }}
              >
                {t('nasFolder.addFolder')}
              </Button>
              </PermissionGate>
        </div>
        <PermissionGate permission="photos.download">
          <PhotoExportMenu
            eventId={parseInt(id!)}
            selectedPhotoIds={selectedPhotoIds}
            filters={{ ...feedbackFilters, search: photoFilters.search, type: photoFilters.type, mediaType: photoFilters.media_type, categoryId: photoFilters.category_id as number | string | undefined }}
          />
        </PermissionGate>
      </div>

      <Card className="mb-5" padding="md">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{t('nasFolder.sourcesTitle')}</h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('nasFolder.sourcesHelp')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={refreshMaterialSources} leftIcon={<RefreshCw className="w-4 h-4" />}>{t('nasFolder.refresh')}</Button>
        </div>
        {materialSourcesQuery.isError && <div className="text-sm text-amber-700 dark:text-amber-300 mb-3">{t('nasFolder.sourcesLoadFailed')} <button className="underline" onClick={() => void materialSourcesQuery.refetch()}>{t('common.retry')}</button></div>}
        {materialSourcesQuery.isLoading ? <div className="text-sm text-neutral-500">{t('common.loading')}</div> : materialSources.length === 0 ? <div className="text-sm text-neutral-500">{t('nasFolder.noSources')}</div> : <div className="space-y-2">
          {materialSources.map(source => <div key={source.id} className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="break-all font-medium text-neutral-900 dark:text-neutral-100">{source.relative_path || '/'}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
                  <span>{t(`nasFolder.purpose${source.purpose[0].toUpperCase()}${source.purpose.slice(1)}`)}</span>
                  <span>{t(sourceStatusKey(source.status), { defaultValue: source.status })}</span>
                  <span>{t('nasFolder.importedCount', { count: source.photo_count || 0 })}</span>
                  <span>{asEnabled(source.watch_enabled) ? t('nasFolder.monitoringOn') : t('nasFolder.monitoringPaused')}</span>
                  {source.last_scanned_at && <span>{t('nasFolder.lastScan', { date: new Date(source.last_scanned_at).toLocaleString() })}</span>}
                </div>
                {source.last_error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{source.last_error}</p>}
              </div>
              <PermissionGate permission="photos.upload">
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={importing || !asEnabled(source.is_active)} leftIcon={<RefreshCw className="w-3.5 h-3.5" />} onClick={async () => {
                    try {
                      setImporting(true);
                      const result = await externalMediaService.scanSource(parseInt(id!), source.id);
                      toast.success(t('nasFolder.scanSuccess', { imported: result.imported, skipped: result.skipped }));
                      refreshMaterialSources();
                      queryClient.invalidateQueries({ queryKey: ['admin-event-photos', id] });
                      refetchPhotos();
                    } catch {
                      refreshMaterialSources();
                      toast.error(t('nasFolder.importFailed'));
                    }
                    finally { setImporting(false); }
                  }}>{t('nasFolder.scanNow')}</Button>
                  <Button variant="outline" size="sm" disabled={importing || !asEnabled(source.is_active)} leftIcon={asEnabled(source.watch_enabled) ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />} onClick={async () => {
                    try {
                      await externalMediaService.updateSource(parseInt(id!), source.id, { watch_enabled: !asEnabled(source.watch_enabled) });
                      refreshMaterialSources();
                    } catch { toast.error(t('nasFolder.updateSourceFailed')); }
                  }}>{asEnabled(source.watch_enabled) ? t('nasFolder.pauseWatch') : t('nasFolder.resumeWatch')}</Button>
                  <Button variant="outline" size="sm" disabled={importing || !asEnabled(source.is_active)} leftIcon={<Unlink className="w-3.5 h-3.5" />} onClick={async () => {
                    if (!window.confirm(t('nasFolder.deactivateConfirm', { path: source.relative_path }))) return;
                    try {
                      await externalMediaService.deactivateSource(parseInt(id!), source.id);
                      refreshMaterialSources();
                    } catch { toast.error(t('nasFolder.updateSourceFailed')); }
                  }}>{t('nasFolder.deactivate')}</Button>
                </div>
              </PermissionGate>
            </div>
          </div>)}
        </div>}
        {materialSourcesQuery.data?.unlinked_photo_count ? <div className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-200">{t('nasFolder.legacyUnlinked', { count: materialSourcesQuery.data.unlinked_photo_count })}</div> : null}
      </Card>

      {/* Photo Grid */}
      {photosLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loading size="lg" text={t('events.loadingPhotos')} />
        </div>
      ) : photosError ? (
        // Without this branch a failed fetch (offline, 5xx) fell through to the
        // grid's "no media uploaded yet" empty state, which reads as "your
        // photos are gone" rather than "we couldn't load them" (QA follow-up).
        <Card padding="lg">
          <div className="flex items-start gap-3 text-amber-700 dark:text-amber-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">{t('gallery.failedToLoad')}</p>
              <Button variant="outline" size="sm" onClick={() => refetchPhotos()} className="mt-3">
                {t('common.retry')}
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <AdminPhotoGrid
          photos={photos}
          eventId={parseInt(id!)}
          onPhotoClick={(photo, index) => setSelectedPhoto({ photo, index })}
          onPhotosDeleted={() => {
            refetchPhotos();
            queryClient.invalidateQueries({ queryKey: ['admin-event', id] });
            queryClient.invalidateQueries({ queryKey: ['admin-event-filter-summary', id] });
          }}
          onSelectionChange={setSelectedPhotoIds}
          categories={categories}
          hasActiveFilters={Boolean(photoFilters.search?.trim() || (photoFilters.category_id && photoFilters.category_id !== '0') || photoFilters.media_type || feedbackFilters.minRating != null || feedbackFilters.hasLikes || feedbackFilters.hasFavorites || feedbackFilters.hasComments || feedbackFilters.colorLabels?.length || feedbackFilters.myColorLabels?.length)}
        />
      )}

      {/* Photo Viewer */}
      {selectedPhoto && (
        <AdminPhotoViewer
          photos={photos}
          initialIndex={selectedPhoto.index}
          eventId={parseInt(id!)}
          onClose={() => setSelectedPhoto(null)}
          onPhotoDeleted={() => {
            refetchPhotos();
            queryClient.invalidateQueries({ queryKey: ['admin-event', id] });
            queryClient.invalidateQueries({ queryKey: ['admin-event-filter-summary', id] });
            setSelectedPhoto(null);
          }}
          categories={categories}
        />
      )}

      {/* External Import Modal */}
      {showExternalImport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="max-w-2xl w-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{t('nasFolder.addFolder')}</h2>
              <button onClick={() => setShowExternalImport(false)} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            <NasFolderSelection value={externalPath} onChange={setExternalPath} watch={externalWatch} onWatchChange={setExternalWatch} />
            <label className="block text-sm">
              <span className="block font-medium mb-1">{t('nasFolder.purpose')}</span>
              <select value={externalPurpose} onChange={e => setExternalPurpose(e.target.value as MaterialPurpose)} className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-2">
                <option value="gallery">{t('nasFolder.purposeGallery')}</option>
                <option value="raw">{t('nasFolder.purposeRaw')}</option>
                <option value="both">{t('nasFolder.purposeBoth')}</option>
              </select>
            </label>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{t('nasFolder.addDoesNotReplace')}</p>

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowExternalImport(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                isLoading={importing}
                onClick={async () => {
                  let addedSourceId: number | null = null;
                  try {
                    const selected = externalPath;
                    if (!selected) {
                      toast.error(t('nasFolder.noneSelected'));
                      return;
                    }
                    if (materialSources.some(source => source.root_id === 'default'
                      && source.relative_path === selected && asEnabled(source.is_active))) {
                      toast.info(t('nasFolder.alreadyAdded'));
                      return;
                    }
                    setImporting(true);
                    const { source, bridge_sync_warning } = await externalMediaService.addSource(parseInt(id!), {
                      relative_path: selected,
                      purpose: externalPurpose,
                      watch_enabled: externalWatch,
                    });
                    addedSourceId = source.id;
                    const result = await externalMediaService.scanSource(parseInt(id!), source.id);
                    toast.success(t('nasFolder.scanSuccess', { imported: result.imported, skipped: result.skipped }));
                    if (bridge_sync_warning) toast.warning(t('nasFolder.bridgeSyncWarning'));
                    refreshMaterialSources();
                    queryClient.invalidateQueries({ queryKey: ['admin-event', id] });
                    queryClient.invalidateQueries({ queryKey: ['admin-event-filter-summary', id] });
                    queryClient.invalidateQueries({ queryKey: ['admin-event-photos', id] });
                    setShowExternalImport(false);
                  } catch {
                    if (addedSourceId !== null) {
                      setShowExternalImport(false);
                      refreshMaterialSources();
                      queryClient.invalidateQueries({ queryKey: ['admin-event-photos', id] });
                      refetchPhotos();
                    }
                    toast.error(t('nasFolder.importFailed'));
                  } finally {
                    setImporting(false);
                  }
                }}
              >
                {t('nasFolder.addAndScan')}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
