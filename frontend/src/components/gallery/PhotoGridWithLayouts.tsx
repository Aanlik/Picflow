import React, { lazy, Suspense, useState, useEffect } from 'react';
import { Package } from 'lucide-react';
import { toast as toastify } from 'react-toastify';
import { useTranslation } from 'react-i18next';

import type { Photo, DownloadResolutionChoice } from '../../types';
import { useDownloadPhoto } from '../../hooks/useGallery';
import { DownloadResolutionModal } from './DownloadResolutionModal';
import { Button, SkeletonGalleryGrid } from '../common';
import { galleryService } from '../../services/gallery.service';
import { useTheme } from '../../contexts/ThemeContext';
import { getDownloadableSelectedPhotoIds, getPhotoDownloadFilenames } from './downloadSelection';

// Grid is the default and most common first view. Keep it in the gallery's
// entry chunk; fetch alternate layouts only when the project actually uses
// them, so their libraries do not delay the first customer thumbnails.
import { GridGalleryLayout } from './layouts/GridGalleryLayout';
const MasonryGalleryLayout = lazy(() => import('./layouts/MasonryGalleryLayout').then((module) => ({ default: module.MasonryGalleryLayout })));
const CarouselGalleryLayout = lazy(() => import('./layouts/CarouselGalleryLayout').then((module) => ({ default: module.CarouselGalleryLayout })));
const TimelineGalleryLayout = lazy(() => import('./layouts/TimelineGalleryLayout').then((module) => ({ default: module.TimelineGalleryLayout })));
const MosaicGalleryLayout = lazy(() => import('./layouts/MosaicGalleryLayout').then((module) => ({ default: module.MosaicGalleryLayout })));
const GalleryPremiumLayout = lazy(() => import('./layouts/GalleryPremiumLayout').then((module) => ({ default: module.GalleryPremiumLayout })));
const GalleryStoryLayout = lazy(() => import('./layouts/GalleryStoryLayout').then((module) => ({ default: module.GalleryStoryLayout })));
const PhotoLightbox = lazy(() => import('./PhotoLightbox').then((module) => ({ default: module.PhotoLightbox })));
import { HeroHeader } from './HeroHeader';
import type { HeaderStyleType, HeroDividerStyle } from '../../types/theme.types';

interface PhotoGridWithLayoutsProps {
  photos: Photo[];
  slug: string;
  categoryId?: number | string | null;
  // When provided, the hero layout will use this photo
  // instead of deriving from the filtered photo list.
  heroPhotoOverride?: Photo | null;
  isSelectionMode?: boolean;
  selectedPhotos?: Set<number>;
  onSelectionChange?: (photos: Set<number>) => void;
  onToggleSelectionMode?: () => void;
  showSelectionControls?: boolean;
  eventName?: string;
  eventLogo?: string | null;
  eventDate?: string | null;
  expiresAt?: string | null;
  feedbackEnabled?: boolean;
  allowDownloads?: boolean;
  // Resolution picker choices (#858). Empty/absent = no picker, download
  // straight at the gallery's standard size.
  downloadChoices?: DownloadResolutionChoice[];
  protectionLevel?: 'basic' | 'standard' | 'enhanced' | 'maximum';
  useEnhancedProtection?: boolean;
  useCanvasRendering?: boolean;
  disableRightClick?: boolean;
  enableDevtoolsProtection?: boolean;
  feedbackOptions?: {
    allowLikes?: boolean;
    allowFavorites?: boolean;
    allowRatings?: boolean;
    allowComments?: boolean;
    allowReactions?: boolean;
    allowColorLabels?: boolean;
    requireGuestName?: boolean;
  };
  onFeedbackChange?: () => void;
  // Hero logo customization options
  heroLogoVisible?: boolean;
  heroLogoSize?: 'small' | 'medium' | 'large' | 'xlarge';
  heroLogoPosition?: 'top' | 'center' | 'bottom';
  // Header style (decoupled from layout)
  headerStyle?: HeaderStyleType;
  heroDividerStyle?: HeroDividerStyle;
  // Hero image anchor position (#162) – keyword or "X% Y%" focal point
  heroImageAnchor?: string;
  // Logout callback for full-page layouts
  onLogout?: () => void;
  // Client visibility controls (#172)
  isClient?: boolean;
  onToggleVisibility?: (photoId: number, currentVisibility: string) => void;
  // Mirror of the admin original-filename toggle (#508). When true, the
  // lightbox bottom toolbar surfaces each photo's original camera name.
  showOriginalFilename?: boolean;
  /**
   * Suppress the "no photos found" message (#1160). A gallery whose photos all
   * live in folders has an empty root grid while its folder tiles sit directly
   * above — printing "no photos" there contradicts the tiles. Only the message
   * is suppressed: the full-page layouts render their hero, title, logout and
   * download controls from inside this component, so unmounting it would strip
   * the whole gallery shell.
   */
  suppressEmptyState?: boolean;
  /** #1160: event-wide count + whole-gallery download for layout chrome. */
  eventPhotoCount?: number;
  onDownloadEverything?: () => void;
}

export const PhotoGridWithLayouts: React.FC<PhotoGridWithLayoutsProps> = ({
  photos,
  suppressEmptyState = false,
  eventPhotoCount,
  onDownloadEverything,
  slug,
  categoryId,
  heroPhotoOverride,
  isSelectionMode: parentSelectionMode,
  selectedPhotos: parentSelectedPhotos,
  feedbackEnabled,
  feedbackOptions,
  onFeedbackChange,
  allowDownloads = true,
  downloadChoices,
  protectionLevel = 'standard',
  useEnhancedProtection = false,
  useCanvasRendering = false,
  disableRightClick = false,
  enableDevtoolsProtection = false,
  onSelectionChange,
  onToggleSelectionMode: parentToggleSelectionMode,
  showSelectionControls = true,
  eventName,
  eventLogo,
  eventDate,
  expiresAt,
  heroLogoVisible = true,
  heroLogoSize = 'medium',
  heroLogoPosition = 'top',
  headerStyle,
  heroDividerStyle = 'wave',
  heroImageAnchor = 'center',
  onLogout,
  isClient = false,
  onToggleVisibility,
  showOriginalFilename = false,
}) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [openFeedbackInitially, setOpenFeedbackInitially] = useState<boolean>(false);
  const [localSelectedPhotos, setLocalSelectedPhotos] = useState<Set<number>>(new Set());
  const [localSelectionMode, setLocalSelectionMode] = useState(false);
  // Non-null while the resolution picker is open (#858); holds the ids it applies to.
  const [resolutionPickerIds, setResolutionPickerIds] = useState<number[] | null>(null);
  // Single-photo downloads can open the same picker as batch downloads. Only
  // the latter owns selection mode, so closing a single-photo picker must not
  // unexpectedly toggle the customer's selection UI.
  const [resolutionPickerIsBatch, setResolutionPickerIsBatch] = useState(false);
  const downloadPhotoMutation = useDownloadPhoto();

  // Use parent state if provided, otherwise use local state
  const selectedPhotos = parentSelectedPhotos ?? localSelectedPhotos;
  const downloadableSelectedPhotoIds = getDownloadableSelectedPhotoIds(photos, selectedPhotos);
  const isSelectionMode = parentSelectionMode ?? localSelectionMode;
  const setSelectedPhotos = onSelectionChange ?? setLocalSelectedPhotos;
  const toggleSelectionMode = parentToggleSelectionMode ?? (() => setLocalSelectionMode(!localSelectionMode));

  // Clear selection when category changes
  useEffect(() => {
    setSelectedPhotos(new Set());
  }, [categoryId, setSelectedPhotos]);

  const handlePhotoClick = (index: number) => {
    setOpenFeedbackInitially(false);
    setSelectedPhotoIndex(index);
  };

  const handleOpenWithFeedback = (index: number) => {
    setOpenFeedbackInitially(true);
    setSelectedPhotoIndex(index);
  };

  const handlePhotoSelect = (photoId: number) => {
    // Auto-enable selection mode when selecting via checkbox
    if (!isSelectionMode) {
      if (parentToggleSelectionMode) {
        parentToggleSelectionMode();
      } else {
        setLocalSelectionMode(true);
      }
    }
    const newSelected = new Set(selectedPhotos);
    if (newSelected.has(photoId)) {
      newSelected.delete(photoId);
    } else {
      newSelected.add(photoId);
    }
    setSelectedPhotos(newSelected);
  };

  const handleDownload = (photo: Photo, e: React.MouseEvent) => {
    e.stopPropagation();

    if (downloadChoices && downloadChoices.length > 1) {
      setResolutionPickerIsBatch(false);
      setResolutionPickerIds([photo.id]);
      return;
    }

    // Track individual photo download

    downloadPhotoMutation.mutate({
      slug,
      photoId: photo.id,
      filename: photo.filename,
    });
  };


  const selectAll = () => {
    setSelectedPhotos(new Set(photos.map(p => p.id)));
  };

  const deselectAll = () => {
    setSelectedPhotos(new Set());
  };

  const handleDownloadSelected = async () => {
    const ids = downloadableSelectedPhotoIds;
    if (!allowDownloads || ids.length === 0) return;

    // Resolution picker: the modal chooses a rendition, then starts one
    // native download per selected photo.
    if (downloadChoices && downloadChoices.length > 1) {
      setResolutionPickerIsBatch(true);
      setResolutionPickerIds(ids);
      return;
    }

    toastify.info(t('gallery.downloadStarted', { photoCount: ids.length }));

    try {
      await galleryService.downloadSelectedPhotos(slug, ids, undefined, getPhotoDownloadFilenames(photos, ids));
    } catch {
      toastify.error(t('gallery.downloadError'));
    } finally {
      setSelectedPhotos(new Set());
      if (parentToggleSelectionMode) {
        parentToggleSelectionMode();
      } else {
        setLocalSelectionMode(false);
      }
    }
  };

  if (photos.length === 0) {
    // Suppressed (#1160): a folder-only root has folder tiles above proving the
    // gallery isn't empty, so the message would contradict them.
    if (!suppressEmptyState) {
      return (
        <div className="text-center py-12">
          <p className="text-muted-theme">{t('gallery.noPhotosFound')}</p>
        </div>
      );
    }
  }

  // Get the current layout from theme
  const galleryLayout = theme.galleryLayout || 'grid';

  // Select the appropriate layout component
  const layoutProps = {
    photos,
    // Forwarded so the full-bleed layouts, which render their OWN
    // noPhotosFound return, don't contradict the folder tiles above them on a
    // folder-only root (#1160).
    suppressEmptyState,
    eventPhotoCount,
    onDownloadEverything,
    slug,
    // Full-page layouts own their bulk-download control, so the resolution
    // picker has to reach them too (#858) — otherwise premium/story galleries
    // silently skip the choice the admin enabled.
    downloadChoices,
    onPickResolution: (ids: number[]) => setResolutionPickerIds(ids),
    onPhotoClick: handlePhotoClick,
    onOpenPhotoWithFeedback: handleOpenWithFeedback,
    onFeedbackChange: onFeedbackChange,
    onDownload: handleDownload,
    heroPhotoOverride,
    selectedPhotos,
    allowDownloads,
    protectionLevel,
    useEnhancedProtection,
    useCanvasRendering,
    isSelectionMode,
    onPhotoSelect: handlePhotoSelect,
    onToggleSelectionMode: toggleSelectionMode,
    onSelectAll: selectAll,
    onDeselectAll: deselectAll,
    eventName,
    eventLogo,
    eventDate,
    expiresAt,
    feedbackEnabled,
    feedbackOptions,
    heroLogoVisible,
    heroLogoSize,
    heroLogoPosition,
    onLogout,
    isClient,
    onToggleVisibility,
    showOriginalFilename,
  };

  // Determine if we should show hero header (decoupled from layout)
  const effectiveHeaderStyle = headerStyle || theme.headerStyle;
  const showHeroHeader = effectiveHeaderStyle === 'hero';

  let LayoutComponent;
  switch (galleryLayout) {
    case 'masonry':
      LayoutComponent = MasonryGalleryLayout;
      break;
    case 'carousel':
      LayoutComponent = CarouselGalleryLayout;
      break;
    case 'timeline':
      LayoutComponent = TimelineGalleryLayout;
      break;
    case 'mosaic':
      LayoutComponent = MosaicGalleryLayout;
      break;
    case 'gallery-premium':
      LayoutComponent = GalleryPremiumLayout;
      break;
    case 'gallery-story':
      LayoutComponent = GalleryStoryLayout;
      break;
    default:
      LayoutComponent = GridGalleryLayout;
  }

  // Gallery Premium and Gallery Story layouts have their own integrated hero/header
  const isFullPageLayout = galleryLayout === 'gallery-premium' || galleryLayout === 'gallery-story';

  return (
    <>
      {/* Hero Header - shown when headerStyle is 'hero' (skip for full-page layouts with integrated hero) */}
      {showHeroHeader && !isFullPageLayout && (
        <HeroHeader
          photos={photos}
          slug={slug}
          eventName={eventName}
          eventLogo={eventLogo}
          eventDate={eventDate}
          expiresAt={expiresAt}
          heroPhotoOverride={heroPhotoOverride}
          heroLogoVisible={heroLogoVisible}
          heroLogoSize={heroLogoSize}
          heroLogoPosition={heroLogoPosition}
          dividerStyle={heroDividerStyle}
          allowDownloads={allowDownloads}
          useEnhancedProtection={useEnhancedProtection}
          heroImageAnchor={heroImageAnchor}
        />
      )}

      {/* Selection Mode Controls - Not shown for carousel, full-page layouts, or when controls are hidden */}
      {showSelectionControls && photos.length > 1 && galleryLayout !== 'carousel' && !isFullPageLayout && (
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={toggleSelectionMode}
              title={t('gallery.selectPhotosHint')}
              className="text-xs sm:text-sm"
            >
              {isSelectionMode ? t('gallery.cancelSelection') : t('gallery.selectPhotos')}
            </Button>
            {!isSelectionMode && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  toggleSelectionMode();
                  selectAll();
                }}
                className="text-xs sm:text-sm"
              >
                {t('gallery.selectAll')}
              </Button>
            )}
          </div>

          {isSelectionMode && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
              <span className="gallery-numeric text-xs sm:text-sm text-muted-theme">
                {t('gallery.photosSelected', { count: selectedPhotos.size })}
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="ghost" size="sm" onClick={selectAll} className="text-xs sm:text-sm">
                  {t('gallery.selectAll')}
                </Button>
                <Button variant="ghost" size="sm" onClick={deselectAll} className="text-xs sm:text-sm">
                  {t('gallery.deselectAll')}
                </Button>
                {allowDownloads && downloadableSelectedPhotoIds.length > 0 && (
                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<Package className="w-4 h-4" />}
                    onClick={handleDownloadSelected}
                    className="text-xs sm:text-sm"
                  >
                    <span className="gallery-numeric hidden sm:inline">{t('gallery.downloadSelected', { count: downloadableSelectedPhotoIds.length })}</span>
                    <span className="sm:hidden">{t('common.download')} ({downloadableSelectedPhotoIds.length})</span>
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Render the selected layout */}
      <Suspense fallback={<SkeletonGalleryGrid count={Math.min(8, Math.max(4, photos.length))} className="mt-4" />}>
        <LayoutComponent {...layoutProps} />
      </Suspense>

      {/* Lightbox - skip for full-page layouts which have their own lightbox */}
      {selectedPhotoIndex !== null && !isFullPageLayout && (
        <Suspense fallback={<div className="fixed inset-0 z-50 bg-black" role="status" aria-label={t('common.loading', '加载中…')} />}>
          <PhotoLightbox
            photos={photos}
            initialIndex={selectedPhotoIndex}
            onClose={() => setSelectedPhotoIndex(null)}
            slug={slug}
            feedbackEnabled={feedbackEnabled || false}
            allowDownloads={allowDownloads}
            protectionLevel={protectionLevel}
            useEnhancedProtection={useEnhancedProtection}
            useCanvasRendering={useCanvasRendering}
            downloadChoices={downloadChoices}
            onPickResolution={(ids) => {
              setResolutionPickerIsBatch(false);
              setResolutionPickerIds(ids);
            }}
            disableRightClick={disableRightClick}
            enableDevtoolsProtection={enableDevtoolsProtection}
            initialShowFeedback={openFeedbackInitially}
            onFeedbackChange={onFeedbackChange}
            showOriginalFilename={showOriginalFilename}
          />
        </Suspense>
      )}

      {/* Download size picker (#858) — each selected photo uses the same queue. */}
      {resolutionPickerIds && downloadChoices && (
        <DownloadResolutionModal
          slug={slug}
          choices={downloadChoices}
          photoIds={resolutionPickerIds}
          onClose={() => {
            setResolutionPickerIds(null);
            if (resolutionPickerIsBatch) {
              setSelectedPhotos(new Set());
              if (parentToggleSelectionMode) {
                parentToggleSelectionMode();
              } else {
                setLocalSelectionMode(false);
              }
            }
            setResolutionPickerIsBatch(false);
          }}
        />
      )}
    </>
  );
};
