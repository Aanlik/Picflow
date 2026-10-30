const express = require('express');
const router = express.Router();
const { db } = require('../database/db');
const { adminAuth } = require('../middleware/auth');
const { requirePermission, userHasAnyPermission } = require('../middleware/permissions');
const { canAccessEvent } = require('../middleware/ownership');
const { ensureThumbnail, ensurePreviewImage } = require('../services/imageProcessor');
const { getStorage } = require('../services/storage');
const logger = require('../utils/logger');
const { imageProcessingError } = require('../utils/imageProcessingError');

/**
 * Do these two stored paths address the same object?
 *
 * Compared the way the storage backends do, not as raw strings.
 * LocalFsStorage._resolve and S3StorageBackend._key both fold `\` to `/` and
 * strip a leading `./`, so `thumbnails\thumb_x.jpg`, `./thumbnails/thumb_x.jpg`
 * and `thumbnails/thumb_x.jpg` are all one file. A legacy thumbnail_path in
 * any of those shapes would compare unequal to the freshly generated POSIX
 * key — and the "the key moved, delete the old one" branch below would then
 * delete the thumbnail that had just been written, leaving every regenerated
 * photo pointing at nothing.
 */
function sameStorageKey(a, b) {
  const canonical = (key) => String(key)
    .replace(/\\/g, '/')
    .replace(/^\.?\/+/, '')
    .replace(/\/+/g, '/');
  return canonical(a) === canonical(b);
}

// One regeneration of each kind at a time. Two overlapping library-wide runs
// double the load and delete each other's freshly written renditions. Held per
// process; another replica can still start its own.
const runningJobs = { thumbnails: false, previews: false };
const regenerationJobs = {
  thumbnails: { running: false, total: 0, processed: 0, success: 0, failed: 0, failures: [] },
  previews: { running: false, total: 0, processed: 0, success: 0, failed: 0, failures: [] },
};

function recordRegenerationFailure(kind, photo, reason) {
  const job = regenerationJobs[kind];
  job.failed += 1;
  if (job.failures.length < 20) {
    job.failures.push({ id: photo.id, filename: photo.filename || `#${photo.id}`, reason: imageProcessingError(reason) });
  }
}

/**
 * Who may start a regeneration. Scoped to an event it is that event's photo
 * work, for whoever can act on the event. Unscoped it rebuilds every gallery
 * after an instance-wide settings change, so it needs settings.edit like the
 * settings write itself. Answers the refusal itself and returns false when
 * the caller may not start the job.
 */
async function mayStartRegeneration(req, res, eventId) {
  if (eventId) {
    const event = await db('events').where('id', eventId).first();
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return false;
    }
    if (!canAccessEvent(req.admin, event)) {
      res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
      return false;
    }
    return true;
  }
  if (!(await userHasAnyPermission(req.admin.id, ['settings.edit']))) {
    res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    return false;
  }
  return true;
}

// Parse JSON-encoded setting values
function parseSettingValue(value) {
  if (value === null || value === undefined) return null;
  try { return JSON.parse(value); } catch (e) { return value; }
}

// Get thumbnail settings
router.get('/settings', adminAuth, requirePermission('photos.view'), async (req, res) => {
  try {
    const settings = await db('app_settings')
      .whereIn('setting_key', [
        'thumbnail_width',
        'thumbnail_height',
        'thumbnail_fit',
        'thumbnail_quality',
        'thumbnail_format',
        // Lightbox preview tier (#492). Boolean, default false.
        'lightbox_preview_enabled'
      ])
      .select('setting_key', 'setting_value');

    const settingsMap = {};
    settings.forEach(s => {
      const parsed = parseSettingValue(s.setting_value);
      settingsMap[s.setting_key] = {
        value: String(parsed ?? '')
      };
    });

    res.json({
      settings: settingsMap,
      fitOptions: ['cover', 'contain', 'fill', 'inside', 'outside'],
      formatOptions: ['jpeg', 'png', 'webp']
    });
  } catch (error) {
    logger.error('Error fetching thumbnail settings:', error);
    res.status(500).json({ error: 'Failed to fetch thumbnail settings' });
  }
});

// Update thumbnail settings. Instance-wide: they shape every gallery's
// renditions, so this is a settings edit like the other settings writes.
router.put('/settings', adminAuth, requirePermission('settings.edit'), async (req, res) => {
  try {
    const { width, height, fit, quality, format, lightbox_preview_enabled } = req.body;
    
    // Validate inputs
    if (width && (width < 50 || width > 1000)) {
      return res.status(400).json({ error: 'Width must be between 50 and 1000 pixels' });
    }
    if (height && (height < 50 || height > 1000)) {
      return res.status(400).json({ error: 'Height must be between 50 and 1000 pixels' });
    }
    if (quality && (quality < 1 || quality > 100)) {
      return res.status(400).json({ error: 'Quality must be between 1 and 100' });
    }
    if (fit && !['cover', 'contain', 'fill', 'inside', 'outside'].includes(fit)) {
      return res.status(400).json({ error: 'Invalid fit option' });
    }
    if (format && !['jpeg', 'png', 'webp'].includes(format)) {
      return res.status(400).json({ error: 'Invalid format option' });
    }
    
    // Update settings
    const updates = [];
    if (width) updates.push({ setting_key: 'thumbnail_width', setting_value: width });
    if (height) updates.push({ setting_key: 'thumbnail_height', setting_value: height });
    if (fit) updates.push({ setting_key: 'thumbnail_fit', setting_value: JSON.stringify(fit) });
    if (quality) updates.push({ setting_key: 'thumbnail_quality', setting_value: quality });
    if (format) updates.push({ setting_key: 'thumbnail_format', setting_value: JSON.stringify(format) });
    // Lightbox preview tier (#492). Boolean — store JSON-stringified
    // so the round-trip matches what migration 104 seeds.
    if (typeof lightbox_preview_enabled === 'boolean') {
      updates.push({
        setting_key: 'lightbox_preview_enabled',
        setting_value: JSON.stringify(lightbox_preview_enabled),
      });
    }

    for (const update of updates) {
      const updated = await db('app_settings')
        .where('setting_key', update.setting_key)
        .update({
          setting_value: update.setting_value,
          updated_at: db.fn.now()
        });
      // Defensive insert when the row is missing — covers the case
      // where lightbox_preview_enabled is being saved on an install
      // that pre-dates migration 104. Existing thumbnail_* keys are
      // seeded by migration 040 so the update path always wins for
      // them; this only fires on the new key.
      if (!updated) {
        await db('app_settings').insert({
          setting_key: update.setting_key,
          setting_value: update.setting_value,
          setting_type: update.setting_key === 'lightbox_preview_enabled' ? 'thumbnail' : 'thumbnail',
          updated_at: db.fn.now(),
        });
      }
    }
    
    res.json({ 
      message: 'Thumbnail settings updated successfully',
      regenerateRequired: true 
    });
  } catch (error) {
    logger.error('Error updating thumbnail settings:', error);
    res.status(500).json({ error: 'Failed to update thumbnail settings' });
  }
});

// Regenerate all thumbnails with new settings
router.post('/regenerate', adminAuth, requirePermission('photos.edit'), async (req, res) => {
  let acquired = false;
  try {
    const { eventId } = req.body; // Optional: regenerate for specific event only
    if (!(await mayStartRegeneration(req, res, eventId))) return;
    if (runningJobs.thumbnails) {
      return res.status(409).json({ error: 'A thumbnail regeneration is already running.', code: 'REGENERATION_RUNNING' });
    }
    runningJobs.thumbnails = true;
    acquired = true;
    
    // source_origin/external_relpath/filename feed BOTH deleteThumbnailTiers
    // (which derives the tier keys from the same fields ensureThumbnailAtWidth
    // wrote them with) and ensureThumbnail, which branches on them to resolve
    // an external source off its mount instead of under events/active.
    // thumbnail_path is selected so it can be nulled — see below.
    let query = db('photos').join('events', 'events.id', 'photos.event_id')
      .where('events.is_archived', false)
      .select(
        'photos.id as id', 'photos.event_id as event_id', 'photos.path as path',
        'photos.media_type as media_type', 'photos.mime_type as mime_type',
        'photos.thumbnail_path as thumbnail_path', 'photos.source_origin as source_origin',
        'photos.external_relpath as external_relpath', 'photos.filename as filename'
      );
    if (eventId) {
      query = query.where('photos.event_id', eventId);
    }
    // Videos are included since ensureThumbnail learned to rebuild a poster
    // frame (issue 1414) — they used to be filtered out here because Sharp
    // threw on every one. They are handled differently in the loop below.

    const photos = await query;
    
    if (photos.length === 0) {
      runningJobs.thumbnails = false;
      regenerationJobs.thumbnails = { running: false, total: 0, processed: 0, success: 0, failed: 0, failures: [] };
      return res.json({ message: 'No photos to regenerate' });
    }

    regenerationJobs.thumbnails = { running: true, total: photos.length, processed: 0, success: 0, failed: 0, failures: [] };
    
    // Start regeneration in background
    res.json({ 
      message: `Started regenerating ${photos.length} thumbnails`,
      count: photos.length 
    });
    
    // Process thumbnails in background
    setImmediate(async () => {
      let successCount = 0;
      let errorCount = 0;
      
      for (const photo of photos) {
        try {
          // A video is REPAIRED, not rebuilt. Its poster frame is rendered at
          // a fixed size by videoProcessor and does not depend on the settings
          // this endpoint is pressed to apply, so forcing it would re-read
          // every video on every press — a full object download each on S3 —
          // to write back the same bytes. thumbnail_path stays on the row and
          // `force` stays off, so ensureThumbnail's own validity check skips a
          // healthy poster and only a missing or unreadable one is rebuilt.
          // boundVideoSource:false because the size bound guards the guest
          // request path; here an admin asked, in a background job, and
          // bounded a large S3 video could only ever get the placeholder.
          // No tier deletion either: videos never take the tier path.
          const isVideo = photo.media_type === 'video' || (photo.mime_type && photo.mime_type.startsWith('video/'));
          if (isVideo) {
            if (await ensureThumbnail(photo, { boundVideoSource: false })) {
              await require('../services/cloudGalleryAssetService').queueRegeneratedAsset(photo.event_id, photo.id, 'thumbnail');
              successCount++;
              regenerationJobs.thumbnails.success++;
            } else {
              errorCount++;
              recordRegenerationFailure('thumbnails', photo, '无法生成视频封面');
            }
            continue;
          }

          // Drop the responsive tiers first (#1095), same as the preview
          // endpoint below. They are cached by width outside thumbnail_path
          // and their key carries no settings version, so regenerating only
          // the canonical rendition leaves phones served the old fit, quality
          // or format indefinitely — which is exactly what this endpoint is
          // invoked to undo after a settings change.
          await require('../services/imageProcessor').deleteThumbnailTiers(photo);

          // Through ensureThumbnail, not a hand-rolled path (#1129). This
          // route used to resolve the source as `storage/events/active/<path>`
          // and fs.access it — a location that does not exist for external or
          // reference rows, whose root-relative originals live under the
          // mounted EXTERNAL_MEDIA_ROOT.
          // Every such photo failed the check and was counted as an error, so
          // on a reference install the endpoint dropped every tier and
          // rebuilt nothing, while the UI reported success (the response is
          // sent before this loop starts).
          //
          // ensureThumbnail already resolves both source kinds via
          // resolvePhotoFilePath/resolvePhotoStorageKey, uses the per-photo
          // ext<id>_ output name so two events referencing one NAS basename
          // cannot clobber each other, and writes thumbnail_path back itself.
          // Nulling thumbnail_path is what stops it short-circuiting on
          // isThumbnailValid — the same trick /regenerate-previews uses.
          // `force` is what stops it joining a lazy generation that is still
          // running under the OLD settings and adopting that result (#1020).
          const newThumbnailPath = await ensureThumbnail({ ...photo, thumbnail_path: null }, { force: true });

          if (newThumbnailPath) {
            await require('../services/cloudGalleryAssetService').queueRegeneratedAsset(photo.event_id, photo.id, 'thumbnail');
            // Drop the superseded canonical rendition when the key MOVED.
            //
            // For a managed photo on S3, ensureThumbnail downloads the source
            // to a randomly-named temp file, and for non-RAW input
            // withProcessableImage passes no outputBasename — so the key is
            // derived from that random name and differs on every run. Nulling
            // thumbnail_path above hides the old key from everything that
            // would otherwise clean it up, so without this each regeneration
            // strands a full thumbnail in the bucket, once per photo per run.
            //
            // Guarded on the key actually changing: on local storage it is
            // stable, and deleting the equal key would delete the file that
            // was just written.
            if (photo.thumbnail_path && !sameStorageKey(photo.thumbnail_path, newThumbnailPath)) {
              await getStorage().delete(photo.thumbnail_path).catch((err) => {
                // Losing the old object is untidy, not a failed regeneration.
                logger.warn(
                  `Could not remove superseded thumbnail ${photo.thumbnail_path} for photo ${photo.id}: ${err.message}`
                );
              });
            }
            successCount++;
            regenerationJobs.thumbnails.success++;
            logger.info(`Regenerated thumbnail for photo ${photo.id}`);
          } else {
            errorCount++;
            recordRegenerationFailure('thumbnails', photo, '无法生成缩略图；请检查源文件是否存在且可读取');
          }
        } catch (error) {
          logger.error(`Error regenerating thumbnail for photo ${photo.id}:`, error);
          errorCount++;
          recordRegenerationFailure('thumbnails', photo, error.message);
        } finally {
          regenerationJobs.thumbnails.processed++;
        }
      }
      
      runningJobs.thumbnails = false;
      regenerationJobs.thumbnails.running = false;
      logger.info(`Thumbnail regeneration complete: ${successCount} success, ${errorCount} errors`);
    });
    
  } catch (error) {
    if (acquired) runningJobs.thumbnails = false;
    logger.error('Error starting thumbnail regeneration:', error);
    res.status(500).json({ error: 'Failed to start thumbnail regeneration' });
  }
});

// Regenerate all preview-tier images (#492). Eager backfill counterpart
// to ensurePreviewImage's lazy generation. Mirrors the regenerate
// (thumbnails) endpoint above — same auth, same fire-and-forget shape,
// same per-photo error handling.
router.post('/regenerate-previews', adminAuth, requirePermission('photos.edit'), async (req, res) => {
  let acquired = false;
  try {
    const { eventId } = req.body;
    if (!(await mayStartRegeneration(req, res, eventId))) return;
    if (runningJobs.previews) {
      return res.status(409).json({ error: 'A preview regeneration is already running.', code: 'REGENERATION_RUNNING' });
    }
    runningJobs.previews = true;
    acquired = true;

    // source_origin/external_relpath/filename are what ensurePreviewImage
    // branches on for external/reference rows (#1078) — without them every
    // external photo looks managed here and generation is skipped.
    let query = db('photos').join('events', 'events.id', 'photos.event_id')
      .where('events.is_archived', false).select(
        'photos.id as id', 'photos.event_id as event_id', 'photos.path as path',
        'photos.media_type as media_type', 'photos.mime_type as mime_type',
        'photos.preview_path as preview_path', 'photos.source_origin as source_origin',
        'photos.external_relpath as external_relpath', 'photos.filename as filename'
      );
    if (eventId) query = query.where('photos.event_id', eventId);
    // Skip videos — preview tier is image-only.
    query = query.where(function() {
      this.whereNull('photos.media_type').orWhere('photos.media_type', '!=', 'video');
    });

    const photos = await query;
    if (photos.length === 0) {
      runningJobs.previews = false;
      regenerationJobs.previews = { running: false, total: 0, processed: 0, success: 0, failed: 0, failures: [] };
      return res.json({ message: 'No image photos to regenerate previews for', count: 0 });
    }

    regenerationJobs.previews = { running: true, total: photos.length, processed: 0, success: 0, failed: 0, failures: [] };

    res.json({
      message: `Started regenerating ${photos.length} previews`,
      count: photos.length,
    });

    setImmediate(async () => {
      let successCount = 0;
      let errorCount = 0;
      for (const photo of photos) {
        try {
          // Force regeneration regardless of existing preview state by
          // nulling the cached path so ensurePreviewImage doesn't
          // short-circuit on a stale isPreviewValid check.
          // Drop the responsive tiers first (#1095). They are cached by width
          // outside preview_path, so regenerating only the canonical rendition
          // leaves phones served the stale 640/1280 copy indefinitely — which
          // is precisely the case this endpoint exists for (a replaced
          // reference source, or a corrupted rendition).
          await require('../services/imageProcessor').deletePreviewTiers(photo);
          // `force`: never adopt a lazy generation already in flight (#1020).
          const newPreviewPath = await ensurePreviewImage({ ...photo, preview_path: null }, { force: true });
          if (newPreviewPath) {
            await require('../services/cloudGalleryAssetService').queueRegeneratedAsset(photo.event_id, photo.id, 'preview');
            successCount++;
            regenerationJobs.previews.success++;
          } else {
            errorCount++;
            recordRegenerationFailure('previews', photo, '无法生成预览图；请检查源文件是否存在且可读取');
          }
        } catch (error) {
          logger.error(`Error regenerating preview for photo ${photo.id}:`, error);
          errorCount++;
          recordRegenerationFailure('previews', photo, error.message);
        } finally {
          regenerationJobs.previews.processed++;
        }
      }
      runningJobs.previews = false;
      regenerationJobs.previews.running = false;
      logger.info(`Preview regeneration complete: ${successCount} success, ${errorCount} errors`);
    });
  } catch (error) {
    if (acquired) runningJobs.previews = false;
    logger.error('Error starting preview regeneration:', error);
    res.status(500).json({ error: 'Failed to start preview regeneration' });
  }
});

// Get regeneration status
router.get('/regenerate/status', adminAuth, requirePermission('photos.view'), async (req, res) => {
  try {
    // Count photos with and without thumbnails
    // These totals describe the same active-project population accepted by
    // the regeneration endpoints. Counting archived rows here made the UI
    // claim a batch had skipped or failed photos that it intentionally never
    // processed.
    const activePhotos = db('photos').join('events', 'events.id', 'photos.event_id')
      .where('events.is_archived', false);
    const totalPhotos = await activePhotos.clone().count('photos.id as count').first();
    const photosWithThumbnails = await activePhotos.clone()
      .whereNotNull('photos.thumbnail_path')
      .count('photos.id as count')
      .first();
    
    res.json({
      total: totalPhotos.count,
      withThumbnails: photosWithThumbnails.count,
      withoutThumbnails: totalPhotos.count - photosWithThumbnails.count,
      percentage: totalPhotos.count ? Math.round((photosWithThumbnails.count / totalPhotos.count) * 100) : 100,
      jobs: {
        thumbnails: { ...regenerationJobs.thumbnails, failures: [...regenerationJobs.thumbnails.failures] },
        previews: { ...regenerationJobs.previews, failures: [...regenerationJobs.previews.failures] },
      },
    });
  } catch (error) {
    logger.error('Error fetching regeneration status:', error);
    res.status(500).json({ error: 'Failed to fetch regeneration status' });
  }
});

module.exports = router;
