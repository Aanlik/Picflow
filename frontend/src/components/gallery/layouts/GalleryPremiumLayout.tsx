import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { MasonryPhotoAlbum } from 'react-photo-album';
import 'react-photo-album/masonry.css';
import Lightbox from 'yet-another-react-lightbox';
import Thumbnails from 'yet-another-react-lightbox/plugins/thumbnails';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen';
import Download from 'yet-another-react-lightbox/plugins/download';
import Captions from 'yet-another-react-lightbox/plugins/captions';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/thumbnails.css';
import { ColorLabelBadge } from '../ColorLabelBadge';
import { WorkflowStatusBadge } from '../WorkflowStatusBadge';
import 'yet-another-react-lightbox/plugins/captions.css';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, Check, Star, MessageSquare, Package, LogOut, ListChecks, X, Download as DownloadIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useInView } from 'react-intersection-observer';

import type { BaseGalleryLayoutProps } from './BaseGalleryLayout';
import type { Photo } from '../../../types';
import { AuthenticatedImage } from '../../common';
import { thumbnailUrlForTile } from '../imageTiers';
import { feedbackService, type ColorLabel } from '../../../services/feedback.service';
import { PhotoFeedback } from '../PhotoFeedback';
import { PhotoColorLabels } from '../PhotoColorLabels';
import { useGuestIdentityOptional } from '../../../contexts/GuestIdentityContext';
import { useInputMode } from '../../../hooks/useInputMode';
import { FeedbackIdentityModal } from '../FeedbackIdentityModal';
import { galleryService } from '../../../services/gallery.service';
import { useDownloadPhoto } from '../../../hooks/useGallery';
import { toast } from 'react-toastify';

import './GalleryPremiumLayout.css';
import { lightboxImageUrl } from '../imageTiers';
import { renderPremiumLightboxImage } from './PremiumLightboxImage';
import { useViewerLikeIds } from '../../../hooks/useViewerLikeIds';
import { photoDisplayFilename } from '../../../utils/photoFilename';

interface PhotoCardProps {
  photo: Photo;
  width: number;
  height: number;
  onClick: () => void;
  onLike: (e: React.MouseEvent) => void;
  onSelect: (e: React.MouseEvent) => void;
  onDownload: (e: React.MouseEvent) => void;
  isSelected: boolean;
  isSelectionMode: boolean;
  isLiked: boolean;
  slug: string;
  allowDownloads?: boolean;
  useEnhancedProtection?: boolean;
  feedbackEnabled?: boolean;
  // #506: track the per-event "allow likes" toggle so the per-photo
  // Like button respects it. `feedbackEnabled` alone isn't enough —
  // an event can have feedback on but likes specifically disabled.
  allowLikes?: boolean;
  index: number;
}

const PhotoCard: React.FC<PhotoCardProps> = ({
  photo,
  width,
  height,
  onClick,
  onLike,
  onSelect,
  onDownload,
  isSelected,
  isSelectionMode,
  isLiked,
  slug,
  allowDownloads = true,
  feedbackEnabled = false,
  allowLikes = false,
  index
}) => {
  const { t: tAudit } = useTranslation();
  // The height MasonryPhotoAlbum computed from photos.width/height is used,
  // not discarded (#1130). Letting the tile size itself from the image meant
  // the rendered shape came from whatever rendition happened to be served —
  // and with thumbnail_fit seeded to 'cover' (migration 040) every rendition
  // is square, so the masonry laid out 79 identical squares and was
  // indistinguishable from the fixed grid. The photo's real aspect ratio is
  // in the DB and is what the album already laid out against.
  const { ref, inView } = useInView({
    triggerOnce: true,
    threshold: 0.1,
  });

  // Responsive tier (#1095). This layout has its own card rather than the
  // shared PhotoCard, so it needs its own call — but MasonryPhotoAlbum hands
  // the laid-out tile width straight to the render prop, so the measurement
  // the shared card has to take is simply a parameter here.
  const isVideo = photo.media_type === 'video' || photo.type === 'video';
  const tieredSrc = (!isVideo && photo.thumbnail_url
    ? thumbnailUrlForTile(photo.thumbnail_url, photo, width)
    : null) || photo.thumbnail_url || photo.url;

  const likeCount = photo.like_count ?? 0;
  const averageRating = photo.average_rating ?? 0;
  const commentCount = photo.comment_count ?? 0;

  return (
    <motion.div
      ref={ref}
      className={`gallery-premium-photo-card group ${isSelected ? 'selected' : ''}`}
      style={{ width: '100%', height, display: 'block' }}
      initial={{ opacity: 0, y: 20 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.05, 0.3) }}
      onClick={onClick}
      data-testid={`photo-card-${photo.id}`}
    >
      <AuthenticatedImage
        src={tieredSrc}
        alt={photo.filename}
        // No inline height: the card now has a definite one, so the
        // stylesheet's `.gallery-premium-photo-card img { height: 100% }` can
        // finally apply and object-fit: cover crops a square rendition INTO
        // the correctly-shaped tile, rather than the rendition dictating the
        // tile's shape.
        className="w-full h-full object-cover"
        loading="lazy"
        isGallery={true}
        slug={slug}
      />

      <WorkflowStatusBadge photo={photo} position="top-2 right-2" />
      <ColorLabelBadge
        colorLabel={photo.my_color_label}
        otherColorLabels={photo.other_color_labels}
        position="top-2 left-2"
      />

      {/* Overlay Gradient */}
      <div className="gallery-premium-photo-overlay" />

      {/* Selection Checkbox */}
      <button
        type="button"
        onClick={onSelect}
        aria-label={isSelected ? tAudit('gallery.cancelSelection') : tAudit('gallery.selectPhotos')}
        className={`gallery-premium-checkbox ${isSelected || isSelectionMode ? 'visible' : ''} ${isSelected ? 'selected' : ''}`}
      >
        {isSelected && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
      </button>

      {/* Like Button — #506: only when feedback master is on AND the
          per-event "allow likes" sub-toggle is on. */}
      {feedbackEnabled && allowLikes && (
        <button
          onClick={onLike}
          className={`gallery-premium-like-btn ${isLiked ? 'liked' : ''}`}
          style={{
            top: 'auto',
            bottom: '0.75rem',
            right: allowDownloads && photo.category_allow_downloads !== false && !isSelectionMode ? '3.25rem' : '0.75rem',
          }}
        >
          <Heart
            className={`w-5 h-5 ${isLiked ? 'fill-current' : ''}`}
          />
        </button>
      )}

      {allowDownloads && photo.category_allow_downloads !== false && !isSelectionMode && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDownload(event);
          }}
          aria-label={tAudit('ui.downloadPhoto')}
          title={tAudit('ui.downloadPhoto')}
          className="gallery-premium-download-btn"
        >
          <DownloadIcon className="w-4 h-4" />
        </button>
      )}

      {/* Selection Border */}
      {isSelected && (
        <div className="gallery-premium-selection-border" />
      )}

      {/* Feedback Indicators */}
      {feedbackEnabled && (likeCount > 0 || averageRating > 0 || commentCount > 0 || isLiked) && (
        <div className="gallery-premium-feedback">
          {(likeCount > 0 || isLiked) && (
            <span className="gallery-premium-feedback-indicator" title={tAudit("ui.liked")}>
              <Heart className="w-3.5 h-3.5 text-red-500" fill="currentColor" />
            </span>
          )}
          {averageRating > 0 && (
            <span className="gallery-premium-feedback-indicator" title={tAudit("ui.rated")}>
              <Star className="w-3.5 h-3.5 text-yellow-500" fill="currentColor" />
            </span>
          )}
          {commentCount > 0 && (
            <span className="gallery-premium-feedback-indicator" title={tAudit("ui.commented")}>
              <MessageSquare className="w-3.5 h-3.5 text-blue-500" fill="currentColor" />
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
};

interface GalleryPremiumLayoutProps extends BaseGalleryLayoutProps {
  heroPhotoOverride?: Photo | null;
  suppressEmptyState?: boolean;
}

export const GalleryPremiumLayout: React.FC<GalleryPremiumLayoutProps> = ({
  // #1160: folder-only root — render the shell, skip the empty message.
  suppressEmptyState = false,
  photos,
  slug,
  onPhotoClick: _onPhotoClick,
  onOpenPhotoWithFeedback: _onOpenPhotoWithFeedback,
  onFeedbackChange,
  onDownload,
  selectedPhotos = new Set(),
  isSelectionMode = false,
  onPhotoSelect,
  onToggleSelectionMode,
  onSelectAll,
  onDeselectAll,
  eventName,
  eventDate,
  allowDownloads = true,
  downloadChoices,
  onPickResolution,
  protectionLevel = 'standard',
  useEnhancedProtection = false,
  useCanvasRendering = false,
  feedbackEnabled = false,
  feedbackOptions,
  heroPhotoOverride,
  onLogout,
  showOriginalFilename = false,
}) => {
  // These props are passed by parent but we use our own lightbox, so mark as intentionally unused
  void _onPhotoClick;
  void _onOpenPhotoWithFeedback;
  const { t } = useTranslation();
  const downloadPhotoMutation = useDownloadPhoto();
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  // The delivered preview can be smaller than the original. Keep Zoom's
  // pixel limit/aspect ratio tied to the loaded rendition, as its default
  // image renderer does internally.
  const [imageDimensions, setImageDimensions] = useState<Record<string, { width: number; height: number }>>({});
  const handleLightboxImageLoad = useCallback((src: string, dimensions: { width: number; height: number }) => {
    setImageDimensions((previous) => (
      previous[src]?.width === dimensions.width && previous[src]?.height === dimensions.height
        ? previous
        : { ...previous, [src]: dimensions }
    ));
  }, []);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [likedPhotoIds, setLikedPhotoIds] = useViewerLikeIds(photos);
  const [savedIdentity, setSavedIdentity] = useState<{ name: string } | null>(null);
  const [showFeedbackPanel, setShowFeedbackPanel] = useState(false);
  const [lightboxColorLabel, setLightboxColorLabel] = useState<ColorLabel | null>(null);
  const guestIdentity = useGuestIdentityOptional();
  const inputMode = useInputMode();
  const [showIdentityModal, setShowIdentityModal] = useState(false);
  const [pendingLikePhotoId, setPendingLikePhotoId] = useState<number | null>(null);
  const likeRequests = useRef(new Set<number>());

  const submitLike = useCallback(async (photoId: number, guestName?: string) => {
    if (likeRequests.current.has(photoId)) return;
    likeRequests.current.add(photoId);
    const wasLiked = likedPhotoIds.has(photoId);
    setLikedPhotoIds((previous) => {
      const next = new Set(previous);
      if (wasLiked) next.delete(photoId);
      else next.add(photoId);
      return next;
    });

    try {
      await feedbackService.submitFeedback(slug, String(photoId), {
        feedback_type: 'like',
        guest_name: guestName,
      });
      onFeedbackChange?.();
    } catch (error: any) {
      setLikedPhotoIds((previous) => {
        const next = new Set(previous);
        if (wasLiked) next.add(photoId);
        else next.delete(photoId);
        return next;
      });
      toast.error(error?.response?.status === 429
        ? t('feedback.rateLimited', '操作太频繁，请稍后重试')
        : t('feedback.likeError', '点赞失败，请稍后重试'));
    } finally {
      likeRequests.current.delete(photoId);
    }
  }, [likedPhotoIds, onFeedbackChange, setLikedPhotoIds, slug, t]);

  // Get unique categories from photos
  const categories = useMemo(() => {
    const cats = new Set<string>();
    photos.forEach(photo => {
      if (photo.category_name) {
        cats.add(photo.category_name);
      }
    });
    return Array.from(cats);
  }, [photos]);

  // Filter photos by active category
  const filteredPhotos = useMemo(() => {
    if (!activeCategory) return photos;
    return photos.filter(photo => photo.category_name === activeCategory);
  }, [photos, activeCategory]);

  const currentLightboxPhoto = lightboxIndex >= 0 ? filteredPhotos[lightboxIndex] : null;
  const currentLightboxPhotoId = currentLightboxPhoto?.id;
  const hasFeedbackControls = feedbackEnabled && Boolean(
    feedbackOptions?.allowLikes || feedbackOptions?.allowFavorites || feedbackOptions?.allowRatings
      || feedbackOptions?.allowComments || feedbackOptions?.allowReactions || feedbackOptions?.allowColorLabels
  );

  useEffect(() => {
    const label = currentLightboxPhoto?.my_color_label;
    setLightboxColorLabel(label && ['red', 'yellow', 'green', 'blue', 'purple'].includes(label)
      ? label as ColorLabel
      : null);
    setShowFeedbackPanel(false);
  }, [currentLightboxPhotoId, currentLightboxPhoto?.my_color_label]);

  // Get hero photo
  const heroPhoto = heroPhotoOverride || photos[0];

  // Convert photos to react-photo-album format
  const albumPhotos = useMemo(() => {
    return filteredPhotos.map(photo => ({
      src: photo.thumbnail_url || photo.url,
      width: photo.width || 1200,
      height: photo.height || 800,
      key: String(photo.id),
      // Keep original photo data
      _photo: photo
    }));
  }, [filteredPhotos]);

  // Lightbox slides. `title` powers the Captions plugin — only emitted
  // when the admin has flipped the original-filenames toggle (#508).
  const slides = useMemo(() => {
    return filteredPhotos.map(photo => ({
      // Display source, not the original (#1166). This layout returns early
      // from PhotoGridWithLayouts and never renders PhotoLightbox, so it needs
      // its own call — without it a premium gallery keeps pulling
      // multi-megabyte originals to show a photo on screen. `download` below
      // deliberately stays on photo.url: what a guest saves must be the full
      // original.
      src: lightboxImageUrl(photo),
      // The download handler used to recover the photo by matching slide.src
      // against photo.url. src is a derivative now, so that lookup would find
      // nothing and Download would silently do nothing (#1166 review).
      photoId: photo.id,
      alt: photo.filename,
      width: imageDimensions[lightboxImageUrl(photo)]?.width || photo.width || 1200,
      height: imageDimensions[lightboxImageUrl(photo)]?.height || photo.height || 800,
      thumbnail: photo.thumbnail_url || undefined,
      download: allowDownloads ? photo.url : undefined,
      title: showOriginalFilename
        ? photoDisplayFilename(photo)
        : undefined,
    }));
  }, [filteredPhotos, allowDownloads, showOriginalFilename, imageDimensions]);

  const handleLike = useCallback(async (photo: Photo, e: React.MouseEvent) => {
    e.stopPropagation();

    if (guestIdentity?.identityMode === 'guest') {
      try {
        await guestIdentity.ensureIdentity();
      } catch {
        return;
      }
      await submitLike(photo.id);
      return;
    }

    if (feedbackOptions?.requireGuestName && !savedIdentity) {
      setPendingLikePhotoId(photo.id);
      setShowIdentityModal(true);
      return;
    }

    await submitLike(photo.id, savedIdentity?.name);
  }, [savedIdentity, feedbackOptions, guestIdentity, submitLike]);

  const handleIdentitySubmit = useCallback(async (name: string) => {
    setSavedIdentity({ name });
    setShowIdentityModal(false);

    if (pendingLikePhotoId) {
      await submitLike(pendingLikePhotoId, name);
      setPendingLikePhotoId(null);
    }
  }, [pendingLikePhotoId, submitLike]);

  const handleSelectAll = useCallback(() => {
    if (selectedPhotos.size === filteredPhotos.length) {
      onDeselectAll?.();
    } else {
      onSelectAll?.();
    }
  }, [selectedPhotos, filteredPhotos, onSelectAll, onDeselectAll]);

  const handleDownloadSelected = useCallback(async () => {
    if (selectedPhotos.size === 0) return;
    const ids = Array.from(selectedPhotos);
    // #858: hand off to the resolution picker when the gallery offers a choice.
    if (downloadChoices && downloadChoices.length > 1 && onPickResolution) {
      onPickResolution(ids);
      return;
    }
    toast.info(t('gallery.downloadStarted', { photoCount: ids.length }));

    try {
      await galleryService.downloadSelectedPhotos(slug, ids);
    } catch {
      toast.error(t('gallery.downloadError'));
    }
  }, [selectedPhotos, slug, t, downloadChoices, onPickResolution]);

  const handleDownloadFromLightbox = useCallback((slide: { src?: string; photoId?: number }) => {
    if (!allowDownloads || !slide.src) return;

    // By id, carried on the slide. Matching on src broke the moment the slide
    // stopped being the original — and what Download hands over must stay the
    // original regardless of what is rendered.
    const photo = slide.photoId != null
      ? filteredPhotos.find(p => p.id === slide.photoId)
      : filteredPhotos.find(p => p.url === slide.src);
    if (photo) {
      downloadPhotoMutation.mutate({
        slug,
        photoId: photo.id,
        filename: photo.filename,
      });
    }
  }, [allowDownloads, filteredPhotos, slug, downloadPhotoMutation]);

  const formattedDate = eventDate ? new Date(eventDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: '2-digit'
  }) : null;

  // #1160: a folder-only root has no photos to show here, but the folder tiles
  // above prove the gallery isn't empty — render the shell (hero, logout,
  // controls) without the contradictory message.
  if (photos.length === 0 && !suppressEmptyState) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">{t('gallery.noPhotosFound')}</p>
      </div>
    );
  }

  return (
    // #1275 — the stylesheet keys its touch rules off this rather than a
    // primary-pointer media query, so the checkbox and like button follow the
    // input actually in use on a device that has both.
    <div className="gallery-premium-layout" data-input-mode={inputMode}>
      {/* Hero Section */}
      <div className="gallery-premium-hero">
        <div
          className="gallery-premium-hero-bg"
          style={{
            backgroundImage: heroPhoto ? `url(${heroPhoto.hero_url || heroPhoto.url})` : undefined
          }}
        />
        <div className="gallery-premium-hero-overlay" />
        <div className="gallery-premium-hero-content">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            {formattedDate && (
              <p className="gallery-premium-hero-date">
                {formattedDate}
              </p>
            )}
            <h1 className="gallery-premium-hero-title">
              {eventName || t('gallery.photoGallery')}
            </h1>
          </motion.div>
        </div>
      </div>

      {/* Sticky Navigation */}
      <div className="gallery-premium-nav">
        <div className="gallery-premium-nav-inner">
          <div className="gallery-premium-nav-categories">
            <button
              className={`gallery-premium-nav-category ${!activeCategory ? 'active' : ''}`}
              onClick={() => setActiveCategory(null)}
            >
              {t('gallery.allPhotos', 'All Photos')}
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                className={`gallery-premium-nav-category ${activeCategory === cat ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="gallery-premium-nav-title">
            {eventName ? eventName.split(' ').map(w => w[0]).join('').slice(0, 3) : 'Gallery'}
          </div>

          <div className="gallery-premium-nav-actions">
            <AnimatePresence>
              {isSelectionMode && selectedPhotos.size > 0 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="gallery-premium-selection-controls"
                >
                  <button
                    className="gallery-premium-selection-btn"
                    onClick={handleSelectAll}
                  >
                    {selectedPhotos.size === filteredPhotos.length ? t('gallery.deselectAll') : t('gallery.selectAll')}
                  </button>
                  <button
                    className="gallery-premium-download-btn"
                    onClick={handleDownloadSelected}
                  >
                    <Package className="w-3 h-3 mr-1 inline" />
                    {t('common.download')} ({selectedPhotos.size})
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {feedbackEnabled && feedbackOptions?.allowLikes && (
              <button className="gallery-premium-nav-btn" title={t('gallery.favorites', 'Favorites')}>
                <Heart className="w-4 h-4" />
              </button>
            )}
            {allowDownloads && photos.length > 0 && onToggleSelectionMode && (
              <button
                className="gallery-premium-nav-btn"
                title={isSelectionMode ? t('gallery.cancelSelection') : t('gallery.batchSelect')}
                aria-label={isSelectionMode ? t('gallery.cancelSelection') : t('gallery.batchSelect')}
                aria-pressed={isSelectionMode}
                onClick={onToggleSelectionMode}
              >
                {isSelectionMode ? <X className="w-4 h-4" /> : <ListChecks className="w-4 h-4" />}
              </button>
            )}
            {onLogout && (
              <button
                className="gallery-premium-nav-btn"
                title={t('common.logout', 'Logout')}
                onClick={onLogout}
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Gallery */}
      <main className="gallery-premium-main">
        <MasonryPhotoAlbum
          photos={albumPhotos}
          render={{
            photo: (_props, { photo, width, height }) => {
              const originalPhoto = (photo as any)._photo as Photo;
              const photoIndex = filteredPhotos.findIndex(p => p.id === originalPhoto.id);

              return (
                <PhotoCard
                  photo={originalPhoto}
                  width={width}
                  height={height}
                  onClick={() => setLightboxIndex(photoIndex)}
                  onLike={(e) => handleLike(originalPhoto, e)}
                  onDownload={(e) => onDownload(originalPhoto, e)}
                  onSelect={(e) => {
                    e.stopPropagation();
                    onPhotoSelect?.(originalPhoto.id);
                  }}
                  isSelected={selectedPhotos.has(originalPhoto.id)}
                  isSelectionMode={isSelectionMode}
                  // #590 follow-up: drop the `|| like_count > 0` fallback,
                  // which treated "anyone liked this" as "I liked it". The
                  // per-viewer is_liked seed above is the correct source.
                  isLiked={likedPhotoIds.has(originalPhoto.id)}
                  slug={slug}
                  allowDownloads={allowDownloads}
                  useEnhancedProtection={useEnhancedProtection}
                  feedbackEnabled={feedbackEnabled}
                  allowLikes={!!feedbackOptions?.allowLikes}
                  index={photoIndex}
                />
              );
            }
          }}
          columns={(containerWidth) => {
            if (containerWidth < 640) return 1;
            if (containerWidth < 1024) return 2;
            return 3;
          }}
          spacing={16}
        />
      </main>

      {/* Lightbox */}
      <Lightbox
        open={lightboxIndex >= 0}
        close={() => setLightboxIndex(-1)}
        index={lightboxIndex}
        slides={slides}
        on={{
          view: ({ index }) => {
            // Keep the controlled index in sync when loaded dimensions update
            // the slides array; otherwise YARL jumps back to the opening photo.
            setLightboxIndex(index);
          },
        }}
        plugins={[
          Thumbnails,
          Zoom,
          Fullscreen,
          ...(allowDownloads ? [Download] : []),
          ...(showOriginalFilename ? [Captions] : []),
        ]}
        animation={{ fade: 300, swipe: 250 }}
        styles={{
          container: { backgroundColor: 'rgba(0, 0, 0, 0.95)' },
          thumbnail: { border: 'none' }
        }}
        render={{
          slide: (props) => renderPremiumLightboxImage({
            ...props, slug, useCanvasRendering, protectionLevel, onImageLoad: handleLightboxImageLoad,
          }),
          controls: () => currentLightboxPhoto && hasFeedbackControls ? (
            <>
              <button
                type="button"
                onClick={() => setShowFeedbackPanel((open) => !open)}
                aria-label={t('ui.toggleFeedback', 'Photo feedback')}
                title={t('feedback.title', 'Photo feedback')}
                className="fixed bottom-[122px] left-4 z-[10001] rounded-full border border-white/25 bg-neutral-900/90 p-3 text-white shadow-xl backdrop-blur hover:bg-neutral-800"
              >
                <MessageSquare className="h-5 w-5" aria-hidden="true" />
                {(currentLightboxPhoto.comment_count || 0) > 0 && (
                  <span className="gallery-numeric absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-600 px-1 text-[10px] font-semibold">
                    {currentLightboxPhoto.comment_count}
                  </span>
                )}
              </button>
              {showFeedbackPanel && (
                <section
                  data-testid="premium-lightbox-feedback-panel"
                  aria-label={t('feedback.title', 'Photo feedback')}
                  className="fixed bottom-4 right-4 top-16 z-[10001] flex w-[min(25rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-white/15 bg-white text-neutral-900 shadow-2xl dark:bg-neutral-950 dark:text-neutral-100"
                >
                  <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold">{t('feedback.title', 'Photo feedback')}</h2>
                      <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{currentLightboxPhoto.filename}</p>
                      {currentLightboxPhoto.retouch_workflow_enabled && currentLightboxPhoto.retouch_state && (
                        <p className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                          {t(`photographyWorkflow.clientState.${currentLightboxPhoto.retouch_state}`)}
                          {currentLightboxPhoto.retouch_state === 'delivered' && currentLightboxPhoto.retouch_version
                            ? ` · V${currentLightboxPhoto.retouch_version}` : ''}
                          {currentLightboxPhoto.retouch_delivered_retained && currentLightboxPhoto.retouch_version
                            ? ` · ${t('photographyWorkflow.retainedDeliveredVersion', { version: currentLightboxPhoto.retouch_version })}` : ''}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowFeedbackPanel(false)}
                      aria-label={t('ui.closeFeedback', 'Close feedback')}
                      className="shrink-0 rounded-full p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </header>
                  <div className="flex-1 space-y-5 overflow-y-auto p-4">
                    {feedbackOptions?.allowColorLabels && (
                      <section className="space-y-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                          {t('feedback.colorLabelsTitle', 'Color labels')}
                        </h3>
                        <PhotoColorLabels
                          photoId={String(currentLightboxPhoto.id)}
                          gallerySlug={slug}
                          myColorLabel={lightboxColorLabel}
                          isEnabled
                          requireGuestName={!!feedbackOptions.requireGuestName}
                          onColorLabelChange={(label) => {
                            setLightboxColorLabel(label);
                            onFeedbackChange?.();
                          }}
                        />
                      </section>
                    )}
                    <PhotoFeedback
                      photoId={String(currentLightboxPhoto.id)}
                      gallerySlug={slug}
                      showComments={!!feedbackOptions?.allowComments}
                      className="space-y-4"
                      onFeedbackUpdate={onFeedbackChange}
                    />
                  </div>
                </section>
              )}
            </>
          ) : null,
          buttonPrev: slides.length <= 1 ? () => null : undefined,
          buttonNext: slides.length <= 1 ? () => null : undefined,
        }}
        controller={{ closeOnBackdropClick: true }}
        download={{
          download: ({ slide }) => {
            handleDownloadFromLightbox(slide);
          }
        }}
      />

      {/* Identity Modal */}
      <FeedbackIdentityModal
        isOpen={showIdentityModal}
        onClose={() => { setShowIdentityModal(false); setPendingLikePhotoId(null); }}
        onSubmit={handleIdentitySubmit}
        feedbackType="like"
      />
    </div>
  );
};
