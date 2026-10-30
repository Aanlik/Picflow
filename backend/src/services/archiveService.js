const archiver = require('archiver');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { db } = require('../database/db');
const logger = require('../utils/logger');
const { getStorage } = require('./storage');
const { resolvePhotoStorageKey } = require('./photoResolver');
const { getUseOriginalFilenames, pickRawDownloadName } = require('./downloadFilenameService');
const { createArchiveStreamGuard } = require('../utils/archiveStreamGuard');
const { bridgeConfig, getProjectDetail, setWorkflowStage, restoreWorkflowStage } = require('./photographyWorkflowBridge');
const {
  sanitizeForZipEntry,
  uniquifyZipNames,
} = require('../utils/filenameSanitizer');

function filterPhotoEntries(event, photos, entries, deliveredPhotoIds = null) {
  const keys = new Set();
  for (const photo of photos) {
    if (deliveredPhotoIds && !deliveredPhotoIds.has(Number(photo.id))) continue;
    try {
      const key = resolvePhotoStorageKey(event, photo);
      if (key) keys.add(key);
    } catch { /* external references are not stored in Picflow */ }
  }
  return entries.filter((entry) => keys.has(entry.key));
}

function filterDeliveredPhotoEntries(event, photos, deliveredPhotoIds, entries) {
  // A null set means the event is not Bridge-managed: preserve the historical
  // archive behavior for this helper's direct callers. archiveEvent still
  // filters all managed photo entries before packaging, so generated download
  // caches are never nested in a customer archive.
  if (deliveredPhotoIds === null) return entries;
  return filterPhotoEntries(event, photos, entries, deliveredPhotoIds);
}

function getArchivableDeliveredPhotoIds(photos = []) {
  return new Set(photos
    .filter((photo) => photo.delivered && !photo.selection_cancelled && !photo.withdraw_pending)
    .map((photo) => Number(photo.photo_id)));
}

function archivePhotoDisplayName(photo, useOriginal) {
  return sanitizeForZipEntry(pickRawDownloadName(photo, useOriginal));
}

async function archiveEvent(event) {
  const storage = getStorage();
  const archiveName = `${event.slug}.zip`;
  const archiveRelKey = path.posix.join('events/archived', archiveName);
  const eventPrefix = path.posix.join('events/active', event.slug);

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'picpeak-archive-'));
  const tmpArchive = path.join(tmpDir, `${crypto.randomBytes(4).toString('hex')}-${archiveName}`);

  let frozen = false;
  let claimed = false;
  try {
    if (bridgeConfig()) {
      const detail = await getProjectDetail(event.id);
      if (detail.status === 200) {
        const paused = await setWorkflowStage(event.id, 'ARCHIVED');
        if (paused.status !== 200) throw new Error('无法暂停精修同步，已停止归档');
        frozen = true;
      } else if (detail.status !== 404) throw new Error('无法确认精修同步状态，已停止归档');
    }
    // DB serialization closes the gap between a pending replacement and the
    // snapshot. Photo writes are rejected by the database until cleanup ends.
    const changed = await db('events').where({ id: event.id, is_archiving: false, is_archived: false }).update({ is_archiving: true });
    if (changed !== 1) throw new Error('项目已归档或正在归档');
    claimed = true;
    // Archive pauses gallery derivative work as well as final-photo delivery.
    // Existing objects remain available for the explicit retain/delete choice.
    await require('./cloudGalleryAssetService').pauseProjectAssets(event.id);
    // A Bridge-managed project archives only its current delivered images.
    // Original RAW/Proof assets remain in the photographer's NAS project tree;
    // they must not inflate the customer download archive.
    let deliveredPhotoIds = null;
    if (bridgeConfig()) {
      const workflow = await getProjectDetail(event.id);
      if (workflow.status === 200 && Array.isArray(workflow.data?.photos)) {
        deliveredPhotoIds = getArchivableDeliveredPhotoIds(workflow.data.photos);
      } else if (workflow.status !== 404) {
        throw new Error(`无法读取精修交付状态，已停止归档以避免打包错误内容（${workflow.status}）`);
      }
    }
    // Photos manifest — the gallery filenames are renamed on upload, so
    // `original_filename` (and category linkage) can't be derived from the
    // extracted files alone. Persisting a manifest inside the archive lets a
    // future restore round-trip recover those fields. Falls back to bare
    // filename for archives produced before this lands (see restore path).
    let photosManifestEntry = null;
    let manifestRows = [];
    try {
      let manifestQuery = db('photos')
        .leftJoin('photo_categories', 'photos.category_id', 'photo_categories.id')
        .where('photos.event_id', event.id)
        .select(
          'photos.id',
          'photos.source_filename',
          'photos.filename',
          'photos.original_filename',
          'photos.type',
          // Not derivable from the extension for every format, and restore
          // has to know a video from a photo to write the row back. Both,
          // because neither is reliable alone: fileWatcher sets a video/*
          // mime_type but never media_type, so its videos carry the 'image'
          // default and every reader knows them as videos only through mime.
          'photos.media_type',
          'photos.mime_type',
          'photos.uploaded_at',
          'photo_categories.name as category_name',
        );
      if (deliveredPhotoIds) {
        manifestQuery = deliveredPhotoIds.size
          ? manifestQuery.whereIn('photos.id', [...deliveredPhotoIds])
          : manifestQuery.whereRaw('1 = 0');
      }
      manifestRows = await manifestQuery;
      if (manifestRows.length > 0) {
        photosManifestEntry = {
          name: 'photos_manifest.json',
          buffer: Buffer.from(JSON.stringify(manifestRows, null, 2), 'utf8'),
        };
        logger.info(`Photos manifest prepared: ${manifestRows.length} entries`);
      }
    } catch (error) {
      logger.error(`Error building photos manifest for event ${event.slug}:`, error);
      // Non-fatal — restore will fall back to filename as original_filename
      // for events archived without a manifest, same as the legacy behaviour.
    }

    // Stream every photo (and any other content under events/active/{slug}/) into
    // the zip directly from the storage backend.
    const allPhotos = await db('photos').where('event_id', event.id).select('*');
    // The event directory also contains generated download bundles, which are
    // a cache rather than source media. Archive only files represented by this
    // event's photo rows (and, for Bridge projects, only current deliveries).
    // This prevents stale `.download-cache/all.zip` files from being nested in
    // the archive and keeps the archive contents aligned with its manifest.
    const listedEntries = await storage.list(eventPrefix);
    const photoEntries = deliveredPhotoIds
      ? filterDeliveredPhotoEntries(event, allPhotos, deliveredPhotoIds, listedEntries)
      : filterPhotoEntries(event, allPhotos, listedEntries);

    // #493: optionally rename zip entries to use original camera filenames.
    // Build a Map<storage_key, original_filename> from the photos table so we
    // can swap the basename of each entry while keeping the folder structure
    // (e.g. `individual/DSC_1234.jpg` instead of `individual/slug_001.jpg`).
    const useOriginal = await getUseOriginalFilenames();
    const originalsByKey = new Map();
    if (useOriginal) {
      const photoRows = await db('photos').where('event_id', event.id).select('*');
      for (const photoRow of photoRows) {
        if (!photoRow.original_filename) continue;
        try {
          const key = resolvePhotoStorageKey(event, photoRow);
          if (key && (useOriginal || /\.__bridge_[a-f0-9]{64}(?=\.[^.]+$)/i.test(photoRow.original_filename))) {
            originalsByKey.set(key, archivePhotoDisplayName(photoRow, useOriginal));
          }
        } catch {
          // External-mode rows have no managed key; skip silently.
        }
      }
    }

    // Compute (subfolder, displayName) up front so collisions across the
    // whole zip can be resolved deterministically with `_N` suffixes.
    const photoNames = photoEntries.map((entry) => {
      const rel = entry.key.startsWith(`${eventPrefix}/`)
        ? entry.key.slice(eventPrefix.length + 1)
        : entry.key;
      if (!useOriginal) return rel;
      const originalBase = originalsByKey.get(entry.key);
      if (!originalBase) return rel;
      const sep = rel.lastIndexOf('/');
      const folder = sep >= 0 ? rel.slice(0, sep + 1) : '';
      return `${folder}${sanitizeForZipEntry(originalBase)}`;
    });
    const dedupedNames = uniquifyZipNames(photoNames);
    const namesById = new Map();
    const entryIndexes = new Map(photoEntries.map((entry, index) => [entry.key, index]));
    for (const photo of allPhotos) {
      let key;
      try { key = resolvePhotoStorageKey(event, photo); } catch { continue; }
      const index = entryIndexes.get(key);
      if (index !== undefined) namesById.set(Number(photo.id), dedupedNames[index]);
    }
    if (photosManifestEntry) {
      manifestRows = manifestRows.filter((row) => namesById.has(Number(row.id)));
      photosManifestEntry = manifestRows.length
        ? {
          name: 'photos_manifest.json',
          buffer: Buffer.from(JSON.stringify(
            manifestRows.map(row => ({ ...row, zip_entry: namesById.get(Number(row.id)) })), null, 2,
          )),
        }
        : null;
    }

    let totalBytes = 0;
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(tmpArchive);
      // Photos are already compressed (JPEG/HEIC/RAW). Level 9 adds a large
      // CPU cost on NAS hardware for almost no reduction in archive size.
      const archive = archiver('zip', { zlib: { level: 0 } });
      // Bound and reclaim the storage reads, as the download builders do:
      // archiver drains one source at a time, so opening a read per photo in
      // the loop parked every other body on an S3 socket until its turn,
      // and a large event held most of the shared agent pool. Two in flight;
      // every open read is destroyed on any failure.
      const guard = createArchiveStreamGuard({
        onFatalError: (err) => { guard.destroyAll(); archive.abort(); reject(err); },
      });

      output.on('close', () => {
        totalBytes = archive.pointer();
        resolve();
      });
      output.on('error', (err) => { guard.destroyAll(); archive.abort(); reject(err); });
      archive.on('error', (err) => { guard.destroyAll(); reject(err); });
      archive.pipe(output);

      const append = async () => {
        for (let i = 0; i < photoEntries.length; i += 1) {
          const entry = photoEntries[i];
          const nameInZip = dedupedNames[i];
          if (!await guard.acquire()) return;
          archive.append(guard.track(await storage.get(entry.key)), { name: nameInZip });
        }
        if (photosManifestEntry) {
          archive.append(photosManifestEntry.buffer, { name: photosManifestEntry.name });
        }
        archive.finalize();
      };

      append().catch((err) => { guard.destroyAll(); reject(err); });
    });

    // Upload the finalized zip to the storage backend.
    await storage.putFromFile(archiveRelKey, tmpArchive, { contentType: 'application/zip' });

    logger.info(`Archive created: ${archiveName} (${totalBytes} bytes)`);

    // Update DB BEFORE deleting originals so a crash mid-cleanup leaves the
    // archive accessible rather than orphaning the photos.
    await db('events').where('id', event.id).update({
      is_archived: true,
      archive_path: archiveRelKey,
      // The zip's own byte size. Persisted so the archives list can sort and display it
      // without statting every archive on every request.
      archive_size: totalBytes,
      archived_at: new Date(),
    });

    if (deliveredPhotoIds) {
      const stageResult = await setWorkflowStage(event.id, 'ARCHIVED').catch(() => null);
      if (stageResult?.status !== 200) {
        logger.warn(`Bridge project ${event.id} could not be marked ARCHIVED (status ${stageResult?.status || 'unavailable'})`);
      }
    }

    // The archive record is now committed. Everything below is cleanup and
    // must not turn a completed archive into a reported failure: otherwise
    // the client retries an operation that has already succeeded.
    try {
      // Stop queued/building custom-resolution jobs before deleting their
      // source files. Workers use guarded status transitions and discard any
      // zip that finishes uploading after this cancellation.
      await require('./downloadJobService').cancelForEvent(
        event.id,
        'The gallery was archived, please request the download again',
      );

      // Delete the originals from storage.
      for (const entry of photoEntries) {
        await storage.delete(entry.key).catch((err) =>
          logger.warn(`Failed to delete archived original ${entry.key}: ${err.message}`)
        );
      }

      // Delete derived images (thumbnails / heroes / previews / watermarks)
      // for this event's photos. The originals are inside the zip; the
      // derived tiers are throwaway and will be regenerated lazily on
      // restore (or not at all for archived events that nobody opens).
      const photos = await db('photos').where('event_id', event.id);
      for (const photo of photos) {
        if (photo.thumbnail_path) {
          await storage.delete(photo.thumbnail_path).catch(() => {});
          await storage.delete(`${photo.thumbnail_path}.picpeak-cache.json`).catch(() => {});
        }
        if (photo.hero_path) {
          await storage.delete(photo.hero_path).catch(() => {});
        }
        // Lightbox preview tier (#492). Same disposable-derived
        // semantics as thumbnails / heroes — wipe on archive.
        if (photo.preview_path) {
          await storage.delete(photo.preview_path).catch(() => {});
          await storage.delete(`${photo.preview_path}.picpeak-cache.json`).catch(() => {});
        }
        // Outside the guard: a tier can exist when the canonical rendition never
        // did, so keying cleanup off preview_path would strand phone-only photos.
        await require('./imageProcessor').deletePreviewTiers(photo);
        await require('./imageProcessor').deleteThumbnailTiers(photo);
        // Best effort: remove watermarked variants too if a refactor added them.
        if (photo.watermark_path) {
          await storage.delete(photo.watermark_path).catch(() => {});
        }
      }
    } catch (err) {
      logger.warn(`Archive ${event.slug} was saved, but post-archive file cleanup was incomplete: ${err.message}`);
    }
    // Face data is in the photo tables, whose write guard is held by
    // is_archiving. Release it before purging those derived rows.
    try {
      await db('events').where({ id: event.id }).update({ is_archiving: false });
    } catch (err) {
      logger.error(`Archive ${event.slug} completed, but the write guard could not be cleared`, { error: err.message });
    }
  } catch (error) {
    const current = await db('events').where({ id: event.id }).first();
    if (frozen && !current?.is_archived && (claimed || !current?.is_archiving)) await restoreWorkflowStage(event.id).catch(() => {});
    logger.error(`Error archiving event ${event.slug}:`, error);
    throw error;
  } finally {
    if (claimed) {
      try {
        await db('events').where({ id: event.id }).update({ is_archiving: false });
      } catch (err) {
        // Do not turn a committed archive into a failed response. Startup
        // recovery clears this flag if the database was temporarily unavailable.
        logger.error(`Archive ${event.slug} completed, but is_archiving could not be cleared`, { error: err.message });
      }
    }
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  archiveEvent,
  filterDeliveredPhotoEntries,
  filterPhotoEntries,
  getArchivableDeliveredPhotoIds,
  archivePhotoDisplayName,
};
