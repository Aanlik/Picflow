import React, { useRef, useState } from 'react';
import { motion, useInView } from 'framer-motion';
import { Check, Heart, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AuthenticatedImage } from '../../../common';
import { ColorLabelBadge } from '../../ColorLabelBadge';
import { WorkflowStatusBadge } from '../../WorkflowStatusBadge';
import type { Photo } from '../../../../types';
import { lightboxImageUrl } from '../../imageTiers';

interface StoryPhotoCardProps {
  photo: Photo;
  index: number;
  isFavorite: boolean;
  onToggleFavorite: (id: number) => void;
  onClick?: () => void;
  slug: string;
  allowLikes?: boolean;
  featured?: boolean;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: number) => void;
}

export const StoryPhotoCard: React.FC<StoryPhotoCardProps> = ({
  allowLikes = true,
  photo,
  index,
  isFavorite,
  onToggleFavorite,
  onClick,
  slug,
  featured = false,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelect,
}) => {
  const { t } = useTranslation();
  const [isLoaded, setIsLoaded] = useState(false);
  const isVideo = photo.media_type === 'video' || photo.type === 'video'
    || Boolean(photo.mime_type?.startsWith('video/'));
  // A video has no image preview tier. Its thumbnail route lazily generates a
  // poster; never let the card's <img> fall through to the full video URL.
  const cardImageUrl = isVideo ? photo.thumbnail_url : lightboxImageUrl(photo);

  // Don't fetch until the card is near the viewport (#1166).
  //
  // Every card in a Story gallery mounts at page load — `whileInView` gates the
  // ANIMATION, not the render — and AuthenticatedImage fetches from an effect
  // on mount, so all of them requested at once. That was tolerable while they
  // pointed at `photo.url`, because nothing was generated; pointing them at
  // the preview tier means a gallery with cold previews would Sharp-decode
  // every original in one burst.
  //
  // `once` so a card that has loaded never unloads on scroll-away, and the
  // same 200px margin the entrance animation uses so the image is already in
  // flight by the time the card animates in.
  const cardRef = useRef<HTMLDivElement>(null);
  const isNearViewport = useInView(cardRef, { once: true, margin: '200px' });

  return (
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ delay: Math.min(index * 0.05, 0.3) }}
      className={`story-photo-card group ${featured ? 'story-gallery-grid-featured' : ''} ${isSelected ? 'ring-4 ring-accent ring-inset' : ''}`}
    >
      <a
        href={photo.url}
        onClick={(e) => {
          if (isSelectionMode) {
            e.preventDefault();
            e.stopPropagation();
            onToggleSelect?.(photo.id);
            return;
          }
          if (onClick) {
            e.preventDefault();
            onClick();
          }
        }}
        className="block w-full h-full"
      >
        {/* The placeholder keeps the card's box while the image is still
            out of range, so nothing reflows when it arrives. */}
        {!isNearViewport ? (
          <div className="w-full h-full bg-neutral-200 dark:bg-neutral-800" aria-hidden="true" />
        ) : !cardImageUrl ? (
          <div className="w-full h-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center" aria-label={t('common.video', '视频')}>
            <Video size={28} className="text-neutral-500" aria-hidden="true" />
          </div>
        ) : (
        <AuthenticatedImage
          // A card tile, and it used to render the full ORIGINAL at
          // object-cover — the one place where the reporter's "hundreds of
          // megabytes for a gallery" was literally true (#1166).
          //
          // The preview tier rather than the thumbnail, deliberately.
          // thumbnail_fit is seeded to 'cover' on every install, so thumbnails
          // are square centre-crops; these cards are not square (400x500 in
          // the carousel, fixed-height in the desktop grid), so a thumbnail
          // would be cropped a second time by object-cover and reframe every
          // photo. Previews use fit:'inside' and are the whole frame, so the
          // card looks exactly as it did while no longer pulling an original.
          src={cardImageUrl}
          alt={photo.filename}
          onLoad={() => setIsLoaded(true)}
          className={`w-full h-full object-cover transition-all duration-700 ease-out will-change-transform ${
            !isLoaded ? 'opacity-0 scale-110' : 'opacity-100 scale-100'
          }`}
          isGallery={true}
          queuePriority="prefetch"
          slug={slug}
        />
        )}
      </a>

      {isSelectionMode && (
        <button
          type="button"
          className={`absolute left-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full border-2 shadow ${isSelected ? 'border-accent bg-accent text-white' : 'border-white bg-black/30 text-white'}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleSelect?.(photo.id);
          }}
          aria-label={isSelected ? t('gallery.deselectPhotoForBatch', '取消选择这张照片') : t('gallery.selectPhotoForBatch', '选择这张照片')}
          aria-pressed={isSelected}
        >
          {isSelected && <Check size={18} aria-hidden="true" />}
        </button>
      )}

      <WorkflowStatusBadge photo={photo} position="top-2 right-2" />
      {isVideo && (
        <span className="absolute left-3 bottom-3 z-10 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-xs text-white">
          <Video size={13} aria-hidden="true" />{t('common.video', '视频')}
        </span>
      )}
      <ColorLabelBadge
        colorLabel={photo.my_color_label}
        otherColorLabels={photo.other_color_labels}
        position="top-2 left-2"
      />

      {/* Overlay */}
      <div className="story-photo-card-overlay" />

      {/* Actions */}
      {allowLikes && <div className="story-photo-card-actions" style={{ top: 'auto', bottom: '1rem' }}>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleFavorite(photo.id);
          }}
          className={`story-photo-card-btn ${isFavorite ? 'favorite' : ''}`}
          aria-label={isFavorite ? t('feedback.unlike', '取消点赞') : t('feedback.like', '点赞')}
          aria-pressed={isFavorite}
        >
          <Heart size={18} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      </div>}

      {/* Caption */}
      <div className="story-photo-card-caption">
        <p>{photo.filename}</p>
      </div>
    </motion.div>
  );
};
