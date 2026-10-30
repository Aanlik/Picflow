const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { db } = require('../database/db');
const { getStorage } = require('./storage');
const { resolvePhotoFilePath, resolvePhotoStorageKey } = require('./photoResolver');
const { parseBooleanInput } = require('../utils/parsers');
const logger = require('../utils/logger');
const pLimit = require('p-limit');

const ASSET_KINDS = Object.freeze({
  THUMBNAIL: 'thumbnail',
  PREVIEW: 'preview',
  HERO: 'hero',
});
const RETRY_LIMIT = 8;
const RETRY_BASE_MS = 30_000;
const URL_TTL_SECONDS = 15 * 60;
const SCAN_BATCH_SIZE = 25;
const generationLimit = pLimit(2);

function isVideo(photo) {
  return photo?.media_type === 'video' || String(photo?.mime_type || '').startsWith('video/');
}

function enabledFor(event, kind) {
  if (!event || event.is_archived || event.is_archiving) return false;
  if (kind === ASSET_KINDS.THUMBNAIL) return parseBooleanInput(event.cloud_thumbnail_sync_enabled, false);
  if (kind === ASSET_KINDS.PREVIEW || kind === ASSET_KINDS.HERO) return parseBooleanInput(event.cloud_preview_sync_enabled, false);
  return false;
}

function getObjectDelivery() {
  return require('./objectDeliveryService');
}

async function getWidths(kind, photo) {
  const imageProcessor = require('./imageProcessor');
  if (kind === ASSET_KINDS.THUMBNAIL) {
    const settings = await imageProcessor.getThumbnailSettings();
    const widths = isVideo(photo)
      ? [settings.width]
      : [...new Set([settings.width, ...imageProcessor.THUMBNAIL_WIDTHS])];
    return widths.filter((width) => Number.isInteger(width) && width > 0).sort((a, b) => a - b);
  }
  if (kind === ASSET_KINDS.PREVIEW) return [...imageProcessor.PREVIEW_WIDTHS];
  if (kind === ASSET_KINDS.HERO && eventHasHero(photo)) return [1920];
  return [];
}

function eventHasHero(photo) {
  return !isVideo(photo);
}

function regenerationRevision(photo, kind) {
  if (kind === ASSET_KINDS.THUMBNAIL) return Number(photo.cloud_thumbnail_revision) || 0;
  if (kind === ASSET_KINDS.PREVIEW) return Number(photo.cloud_preview_revision) || 0;
  return 0;
}

async function resolveSource(event, photo) {
  const external = ['external', 'reference'].includes(photo.source_origin || event.source_mode);
  if (external) {
    const absolutePath = resolvePhotoFilePath(event, photo);
    const stat = await fs.promises.stat(absolutePath);
    return {
      sourceKey: photo.external_relpath || path.basename(absolutePath),
      absolutePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  }
  const sourceKey = resolvePhotoStorageKey(event, photo);
  if (!sourceKey) return null;
  const stat = await getStorage().stat(sourceKey);
  if (!stat) return null;
  return {
    sourceKey,
    absolutePath: null,
    size: Number(stat.size) || 0,
    mtimeMs: stat.mtime instanceof Date ? stat.mtime.getTime() : new Date(stat.mtime || 0).getTime(),
  };
}

async function sourceVersion(event, photo, kind, width, config, anchor) {
  const source = await resolveSource(event, photo);
  if (!source) return null;
  const targetId = getObjectDelivery().getTargetId(config);
  const renditionProfile = await require('./imageProcessor').getRenditionProfile(kind, width, photo, anchor);
  const seed = JSON.stringify({
    eventId: Number(event.id),
    photoId: Number(photo.id),
    sourceKey: source.sourceKey,
    size: source.size,
    mtimeMs: source.mtimeMs,
    photoUpdatedAt: photo.updated_at || null,
    orientationCheckedAt: photo.orientation_checked_at || null,
    kind,
    width,
    anchor: kind === ASSET_KINDS.HERO ? (anchor || 'center') : null,
    renditionProfile,
    ...(regenerationRevision(photo, kind) > 0
      ? { regenerationRevision: regenerationRevision(photo, kind) }
      : {}),
    targetId,
  });
  return {
    ...source,
    targetId,
    version: crypto.createHash('sha256').update(seed).digest('hex'),
  };
}

function objectKey(eventId, photoId, kind, width, version) {
  return `picpeak-gallery/events/${eventId}/photos/${photoId}/${kind}/w${width}/${version}`;
}

async function queueAsset(event, photo, kind, width, config, { strictSource = false } = {}) {
  if (!enabledFor(event, kind) || !photo || isVideo(photo) && kind !== ASSET_KINDS.THUMBNAIL) return false;
  const objectStorage = getObjectDelivery();
  const storageConfig = config || await objectStorage.getObjectStorageConfig();
  if (!storageConfig.enabled || !objectStorage.isConfigured(storageConfig)) return false;
  let source;
  try {
    source = await sourceVersion(event, photo, kind, width, storageConfig, event.hero_image_anchor);
  } catch (error) {
    logger.warn('Could not inspect source while queueing a cloud gallery asset', { eventId: event.id, photoId: photo.id, kind, error: error.message });
    if (strictSource && error.code !== 'ENOENT') throw error;
    return false;
  }
  if (!source) return false;
  const now = new Date();
  const fresh = {
    event_id: Number(event.id),
    photo_id: Number(photo.id),
    asset_kind: kind,
    width,
    source_key: source.sourceKey,
    source_version: source.version,
    object_key: objectKey(event.id, photo.id, kind, width, source.version),
    target_id: source.targetId,
    state: 'queued',
    is_current: true,
    attempts: 0,
    next_attempt_at: null,
    size_bytes: null,
    content_type: null,
    error_message: null,
    updated_at: now,
  };

  let accepted = false;
  await db.transaction(async (trx) => {
    // A scan may have read this photo before regeneration committed. Lock the
    // row so that stale scan data cannot reinstate the superseded cloud copy.
    const currentPhoto = await trx('photos').where({ id: fresh.photo_id, event_id: fresh.event_id }).forUpdate().first();
    if (!currentPhoto || regenerationRevision(currentPhoto, kind) !== regenerationRevision(photo, kind)) return;
    accepted = true;
    await trx('object_gallery_derivatives')
      .where({ event_id: fresh.event_id, photo_id: fresh.photo_id, asset_kind: kind, width })
      .update({ is_current: false, updated_at: now });
    const existing = await trx('object_gallery_derivatives')
      .where({ event_id: fresh.event_id, photo_id: fresh.photo_id, asset_kind: kind, width, source_version: source.version })
      .first();
    if (existing?.state === 'ready' && existing.target_id === source.targetId) {
      await trx('object_gallery_derivatives').where({ id: existing.id }).update({ is_current: true, updated_at: now });
      return;
    }
    if (existing) {
      await trx('object_gallery_derivatives').where({ id: existing.id }).update({
        source_key: fresh.source_key,
        object_key: fresh.object_key,
        target_id: fresh.target_id,
        state: 'queued',
        is_current: true,
        attempts: 0,
        next_attempt_at: null,
        size_bytes: null,
        content_type: null,
        error_message: null,
        updated_at: now,
      });
      return;
    }
    await trx('object_gallery_derivatives').insert(fresh);
  });
  return accepted;
}

async function queuePhotoAssets(event, photo, kinds = [ASSET_KINDS.THUMBNAIL, ASSET_KINDS.PREVIEW]) {
  if (!event || !photo) return 0;
  const objectStorage = getObjectDelivery();
  const config = await objectStorage.getObjectStorageConfig();
  if (!config.enabled || !objectStorage.isConfigured(config)) return 0;
  let queued = 0;
  for (const kind of kinds) {
    if (!enabledFor(event, kind)) continue;
    const widths = await getWidths(kind, photo);
    for (const width of widths) {
      if (await queueAsset(event, photo, kind, width, config)) queued += 1;
    }
  }
  if (kinds.includes(ASSET_KINDS.PREVIEW) && event.hero_photo_id && Number(event.hero_photo_id) === Number(photo.id)) {
    if (await queueAsset(event, photo, ASSET_KINDS.HERO, 1920, config)) queued += 1;
  }
  return queued;
}

async function queuePhotoIfEnabled(eventId, photoId) {
  const [event, photo] = await Promise.all([
    db('events').where({ id: Number(eventId) }).first(),
    db('photos').where({ id: Number(photoId), event_id: Number(eventId) }).first(),
  ]);
  if (!event || !photo) return 0;
  return queuePhotoAssets(event, photo);
}

// A successful explicit rebuild creates a new immutable cloud generation even
// when the source and rendering settings themselves are unchanged.
async function queueRegeneratedAsset(eventId, photoId, kind) {
  if (![ASSET_KINDS.THUMBNAIL, ASSET_KINDS.PREVIEW].includes(kind)) throw new Error('Invalid regenerated asset kind');
  const column = kind === ASSET_KINDS.THUMBNAIL ? 'cloud_thumbnail_revision' : 'cloud_preview_revision';
  await db.transaction(async (trx) => {
    await trx('photos').where({ id: Number(photoId), event_id: Number(eventId) }).increment(column, 1);
    await trx('object_gallery_derivatives').where({ event_id: Number(eventId), photo_id: Number(photoId), asset_kind: kind, is_current: true })
      .update({ is_current: false, updated_at: new Date() });
  });
  const [event, photo] = await Promise.all([
    db('events').where({ id: Number(eventId) }).first(),
    db('photos').where({ id: Number(photoId), event_id: Number(eventId) }).first(),
  ]);
  if (!event || !photo || !enabledFor(event, kind)) return 0;
  try {
    const config = await getObjectDelivery().getObjectStorageConfig();
    if (config.enabled && getObjectDelivery().isConfigured(config)) {
      const queued = await queuePhotoAssets(event, photo, [kind]);
      if (queued > 0) return queued;
    }
  } catch (error) {
    logger.warn('Could not queue regenerated asset; scheduling a scan', { eventId, photoId, kind, error: error.message });
  }
  // A disabled/unavailable destination must not lose the regeneration. The
  // worker resumes this durable scan after the destination becomes usable.
  const now = new Date();
  await db('object_gallery_derivative_scans').insert({ event_id: Number(eventId), asset_kind: kind, cursor_photo_id: null, state: 'queued', created_at: now, updated_at: now })
    .onConflict(['event_id', 'asset_kind']).merge({ cursor_photo_id: null, state: 'queued', error_message: null, updated_at: now });
  return 0;
}

async function queueProjectAssets(eventId, kind) {
  const event = await db('events').where({ id: Number(eventId) }).first();
  if (!event || event.is_archived || event.is_archiving) return { queued: 0, skipped: true };
  if (!enabledFor(event, kind)) return { queued: 0, skipped: true };
  const config = await getObjectDelivery().getObjectStorageConfig();
  if (!config.enabled || !getObjectDelivery().isConfigured(config)) return { queued: 0, skipped: true, error: 'OBJECT_STORAGE_NOT_READY' };
  const now = new Date();
  await db('object_gallery_derivative_scans')
    .insert({ event_id: Number(eventId), asset_kind: kind, cursor_photo_id: null, state: 'queued', created_at: now, updated_at: now })
    .onConflict(['event_id', 'asset_kind'])
    .merge({ cursor_photo_id: null, state: 'queued', error_message: null, updated_at: now });
  const count = await db('photos').where({ event_id: Number(eventId) }).count('id as count').first();
  return { queued: 0, photos: Number(count?.count) || 0, scanning: true, skipped: false };
}

async function getReadyAssetUrl(event, photo, kind, width) {
  if (!enabledFor(event, kind)) return null;
  const objectStorage = getObjectDelivery();
  const config = await objectStorage.getObjectStorageConfig();
  if (!config.enabled || !objectStorage.isConfigured(config)) return null;
  // Do not stat the source NAS on a customer request. The durable job row is
  // fenced against source changes when a photo is replaced/updated; requiring
  // a live NAS metadata request here would make the cloud copy useless during
  // exactly the mount/network outages it is meant to absorb.
  const targetId = objectStorage.getTargetId(config);
  const row = await db('object_gallery_derivatives').where({
    event_id: Number(event.id),
    photo_id: Number(photo.id),
    asset_kind: kind,
    width,
    target_id: targetId,
    state: 'ready',
    is_current: true,
  }).first();
  if (!row) return null;
  const adapter = objectStorage.buildAdapter(config);
  const key = [config.prefix, row.object_key].filter(Boolean).join('/');
  return adapter.getSignedUrl('getObject', key, {
    expiresIn: URL_TTL_SECONDS,
    params: {
      ResponseContentType: row.content_type || 'application/octet-stream',
      ResponseCacheControl: `private, max-age=${URL_TTL_SECONDS}`,
    },
  });
}

async function pauseProjectAssets(eventId, kind) {
  let query = db('object_gallery_derivatives').where({ event_id: Number(eventId) });
  if (kind) query = query.where('asset_kind', kind);
  const now = new Date();
  const [paused] = await Promise.all([
    query.whereIn('state', ['queued', 'uploading']).update({ state: 'paused', next_attempt_at: null, updated_at: now }),
    db('object_gallery_derivative_scans').where({ event_id: Number(eventId), state: 'queued' })
      .modify((scanQuery) => { if (kind) scanQuery.where('asset_kind', kind); })
      .update({ state: 'paused', updated_at: now }),
  ]);
  return paused;
}

async function retryFailed(eventId, kind) {
  const event = await db('events').where({ id: Number(eventId) }).first('cloud_thumbnail_sync_enabled', 'cloud_preview_sync_enabled');
  const enabledKinds = [];
  if (parseBooleanInput(event?.cloud_thumbnail_sync_enabled, false)) enabledKinds.push(ASSET_KINDS.THUMBNAIL);
  if (parseBooleanInput(event?.cloud_preview_sync_enabled, false)) enabledKinds.push(ASSET_KINDS.PREVIEW, ASSET_KINDS.HERO);
  if (kind && !enabledKinds.includes(kind)) return 0;
  if (!kind && enabledKinds.length === 0) return 0;
  const changed = await db('object_gallery_derivatives')
    .where({ event_id: Number(eventId), state: 'failed', is_current: true })
    .whereIn('asset_kind', kind ? [kind] : enabledKinds)
    .update({ state: 'queued', attempts: 0, next_attempt_at: null, error_message: null, updated_at: new Date() });
  const scanKinds = kind ? [kind] : enabledKinds.filter((assetKind) => assetKind !== ASSET_KINDS.HERO);
  const scansChanged = scanKinds.length
    ? await db('object_gallery_derivative_scans')
      .where({ event_id: Number(eventId), state: 'failed' })
      .whereIn('asset_kind', scanKinds)
      .update({ cursor_photo_id: null, state: 'queued', error_message: null, updated_at: new Date() })
    : 0;
  return Number(changed || 0) + Number(scansChanged || 0);
}

async function getProjectStatus(eventId) {
  const event = await db('events').where({ id: Number(eventId) }).first('cloud_thumbnail_sync_enabled', 'cloud_preview_sync_enabled');
  const rows = await db('object_gallery_derivatives').where({ event_id: Number(eventId), is_current: true }).select('photo_id', 'asset_kind', 'width', 'state', 'size_bytes', 'error_message');
  const scans = await db('object_gallery_derivative_scans').where({ event_id: Number(eventId), state: 'queued' }).select('asset_kind');
  const scanErrors = await db('object_gallery_derivative_scans').where({ event_id: Number(eventId), state: 'failed' }).select('asset_kind', 'error_message');
  const createCounts = () => ({ queued: 0, uploading: 0, ready: 0, failed: 0, paused: 0 });
  const counts = { thumbnail: createCounts(), preview: createCounts() };
  rows.forEach((row) => {
    const bucket = row.asset_kind === ASSET_KINDS.THUMBNAIL ? counts.thumbnail : counts.preview;
    if (bucket && Object.prototype.hasOwnProperty.call(bucket, row.state)) bucket[row.state] += 1;
  });
  return {
    thumbnailSyncEnabled: parseBooleanInput(event?.cloud_thumbnail_sync_enabled, false),
    previewSyncEnabled: parseBooleanInput(event?.cloud_preview_sync_enabled, false),
    galleryAssets: counts,
    galleryReadyBytes: rows.filter((row) => row.state === 'ready').reduce((total, row) => total + (Number(row.size_bytes) || 0), 0),
    galleryFailureDetails: [
      ...scanErrors.map((row) => ({ kind: row.asset_kind, message: row.error_message })),
      ...rows.filter((row) => row.state === 'failed').map((row) => ({ photoId: row.photo_id, kind: row.asset_kind, width: row.width, message: row.error_message })),
    ].slice(0, 5),
    galleryScans: {
      thumbnail: scans.filter((scan) => scan.asset_kind === ASSET_KINDS.THUMBNAIL).length,
      preview: scans.filter((scan) => scan.asset_kind === ASSET_KINDS.PREVIEW).length,
    },
    galleryScanErrors: {
      thumbnail: scanErrors.filter((scan) => scan.asset_kind === ASSET_KINDS.THUMBNAIL).length,
      preview: scanErrors.filter((scan) => scan.asset_kind === ASSET_KINDS.PREVIEW).length,
    },
  };
}

function contentTypeFor(key) {
  const ext = path.extname(key).toLowerCase();
  if (ext === '.webp') return 'image/webp';
  if (ext === '.png') return 'image/png';
  return 'image/jpeg';
}

function assetPriority(kind) {
  if (kind === ASSET_KINDS.THUMBNAIL) return 0;
  if (kind === ASSET_KINDS.PREVIEW) return 1;
  return 2;
}

function assetPrioritySql() {
  return `CASE asset_kind WHEN '${ASSET_KINDS.THUMBNAIL}' THEN ${assetPriority(ASSET_KINDS.THUMBNAIL)} `
    + `WHEN '${ASSET_KINDS.PREVIEW}' THEN ${assetPriority(ASSET_KINDS.PREVIEW)} `
    + `WHEN '${ASSET_KINDS.HERO}' THEN ${assetPriority(ASSET_KINDS.HERO)} ELSE 3 END`;
}

// A scan only discovers one batch at a time. Keep wider work behind its
// project's unfinished scan, otherwise a known 600px row can overtake a
// 300px row that has not been discovered yet. Smallest rows may still start
// while scanning continues.
function applyScanPriorityFence(query, minThumbnailWidth, minPreviewWidth) {
  return query.whereNotExists(function () {
    this.select(1).from('object_gallery_derivative_scans as scan')
      .whereRaw('scan.event_id = object_gallery_derivatives.event_id')
      .where('scan.state', 'queued')
      .where(function () {
        this.where(function () {
          this.where('scan.asset_kind', ASSET_KINDS.THUMBNAIL)
            .where(function () {
              this.whereIn('object_gallery_derivatives.asset_kind', [ASSET_KINDS.PREVIEW, ASSET_KINDS.HERO])
                .orWhere(function () {
                  this.where('object_gallery_derivatives.asset_kind', ASSET_KINDS.THUMBNAIL)
                    .where('object_gallery_derivatives.width', '>', minThumbnailWidth);
                });
            });
        }).orWhere(function () {
          this.where('scan.asset_kind', ASSET_KINDS.PREVIEW)
            .where(function () {
              this.where('object_gallery_derivatives.asset_kind', ASSET_KINDS.HERO)
                .orWhere(function () {
                  this.where('object_gallery_derivatives.asset_kind', ASSET_KINDS.PREVIEW)
                    .where('object_gallery_derivatives.width', '>', minPreviewWidth);
                });
            });
        });
      });
  });
}

async function generatedAssetPath(event, photo, kind, width) {
  const imageProcessor = require('./imageProcessor');
  if (kind === ASSET_KINDS.THUMBNAIL) {
    if (isVideo(photo)) return imageProcessor.ensureThumbnail(photo);
    return imageProcessor.ensureThumbnailAtWidth(photo, width);
  }
  if (kind === ASSET_KINDS.PREVIEW) return imageProcessor.ensurePreviewImageAtWidth(photo, width);
  if (kind === ASSET_KINDS.HERO) return imageProcessor.ensureHeroImage(photo, { anchor: event.hero_image_anchor });
  return null;
}

async function markFailed(row, error) {
  const attempts = Number(row.attempts || 0) + 1;
  const delay = Math.min(60 * 60 * 1000, RETRY_BASE_MS * (2 ** Math.min(attempts - 1, 7)));
  await db('object_gallery_derivatives').where({ id: row.id, state: 'uploading' }).update({
    state: attempts >= RETRY_LIMIT ? 'failed' : 'queued',
    attempts,
    next_attempt_at: attempts >= RETRY_LIMIT ? null : new Date(Date.now() + delay),
    error_message: String(error?.message || error).slice(0, 2000),
    updated_at: new Date(),
  });
}

async function processJob(row) {
  const claimed = await db('object_gallery_derivatives').where({ id: row.id, state: 'queued', is_current: true }).update({ state: 'uploading', updated_at: new Date() });
  if (!claimed) return false;
  let tempDir;
  try {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'picpeak-gallery-cloud-'));
    const localPath = path.join(tempDir, `asset-${row.id}`);
    const objectStorage = getObjectDelivery();
    const [event, photo, config] = await Promise.all([
      db('events').where({ id: row.event_id }).first(),
      db('photos').where({ id: row.photo_id, event_id: row.event_id }).first(),
      objectStorage.getObjectStorageConfig(),
    ]);
    if (!event || !photo || !enabledFor(event, row.asset_kind) || !config.enabled || !objectStorage.isConfigured(config)) {
      await db('object_gallery_derivatives').where({ id: row.id, state: 'uploading' }).update({ state: 'paused', error_message: null, updated_at: new Date() });
      return true;
    }
    const currentSource = await sourceVersion(event, photo, row.asset_kind, row.width, config, event.hero_image_anchor);
    if (!currentSource || currentSource.version !== row.source_version || currentSource.targetId !== row.target_id) {
      await db('object_gallery_derivatives').where({ id: row.id, state: 'uploading' }).update({ state: 'stale', is_current: false, updated_at: new Date() });
      return true;
    }
    const renditionKey = await generationLimit(() => generatedAssetPath(event, photo, row.asset_kind, Number(row.width)));
    if (!renditionKey) throw new Error('NAS 未能生成此照片的缩略图或预览图');
    const storage = getStorage();
    const stat = await storage.stat(renditionKey);
    if (!stat || !stat.size) throw new Error('生成的照片预览文件为空');
    await storage.getToFile(renditionKey, localPath);
    const contentType = contentTypeFor(renditionKey);
    const adapter = objectStorage.buildAdapter(config);
    const remoteKey = [config.prefix, row.object_key].filter(Boolean).join('/');
    await adapter.upload(localPath, remoteKey, {
      contentType,
      streamLimiter: objectStorage.backgroundUploadLimiter,
      progressEventId: Number(event.id),
      cacheControl: `private, max-age=${URL_TTL_SECONDS}`,
      metadata: { eventId: String(event.id), photoId: String(photo.id), kind: row.asset_kind, width: String(row.width), version: row.source_version },
    });

    const [latest, latestEvent, latestPhoto] = await Promise.all([
      db('object_gallery_derivatives').where({ id: row.id }).first(),
      db('events').where({ id: row.event_id }).first(),
      db('photos').where({ id: row.photo_id, event_id: row.event_id }).first(),
    ]);
    const latestSource = latestEvent && latestPhoto
      ? await sourceVersion(latestEvent, latestPhoto, row.asset_kind, row.width, config, latestEvent.hero_image_anchor)
      : null;
    if (!latest || latest.state !== 'uploading' || !latest.is_current || !enabledFor(latestEvent, row.asset_kind)
        || !latestSource || latestSource.version !== row.source_version || latestSource.targetId !== row.target_id) {
      // A switch-off, archive, replacement, or explicit cloud-delete fence can
      // race an upload already in flight. The just-uploaded object was never a
      // ready copy and must be removed before the uploader releases its row;
      // deletion waits on that row before sweeping the project's cloud keys.
      await adapter.delete(remoteKey);
      await db('object_gallery_derivatives').where({ id: row.id, state: 'uploading' }).update({ state: 'paused', error_message: null, updated_at: new Date() });
      return true;
    }
    await db('object_gallery_derivatives').where({ id: row.id, state: 'uploading', is_current: true }).update({
      state: 'ready',
      size_bytes: stat.size,
      content_type: contentType,
      error_message: null,
      attempts: 0,
      next_attempt_at: null,
      updated_at: new Date(),
    });
  } catch (error) {
    logger.warn('Cloud gallery derivative sync failed', { eventId: row.event_id, photoId: row.photo_id, kind: row.asset_kind, width: row.width, error: error.message });
    await markFailed(row, error).catch((dbError) => logger.error('Could not persist gallery derivative failure', { error: dbError.message }));
  } finally {
    if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
  return true;
}

async function runQueueOnce() {
  const objectStorage = getObjectDelivery();
  const config = await objectStorage.getObjectStorageConfig();
  if (!config.enabled || !objectStorage.isConfigured(config)) return false;
  const thumbnailEvents = db('events').where({ cloud_thumbnail_sync_enabled: true, is_archived: false, is_archiving: false }).select('id');
  const previewEvents = db('events').where({ cloud_preview_sync_enabled: true, is_archived: false, is_archiving: false }).select('id');
  await db('object_gallery_derivatives').where({ asset_kind: ASSET_KINDS.THUMBNAIL, state: 'paused', is_current: true }).whereIn('event_id', thumbnailEvents).update({ state: 'queued', next_attempt_at: null, error_message: null, updated_at: new Date() });
  await db('object_gallery_derivatives').whereIn('asset_kind', [ASSET_KINDS.PREVIEW, ASSET_KINDS.HERO]).where({ state: 'paused', is_current: true }).whereIn('event_id', previewEvents).update({ state: 'queued', next_attempt_at: null, error_message: null, updated_at: new Date() });
  await db('object_gallery_derivative_scans').where({ asset_kind: ASSET_KINDS.THUMBNAIL, state: 'paused' }).whereIn('event_id', thumbnailEvents).update({ state: 'queued', updated_at: new Date() });
  await db('object_gallery_derivative_scans').where({ asset_kind: ASSET_KINDS.PREVIEW, state: 'paused' }).whereIn('event_id', previewEvents).update({ state: 'queued', updated_at: new Date() });
  const scanned = await queueNextScanBatch(config);
  const processor = require('./imageProcessor');
  const thumbnailSettings = await processor.getThumbnailSettings();
  const minThumbnailWidth = Math.min(thumbnailSettings.width || processor.DEFAULT_THUMBNAIL_WIDTH, ...processor.THUMBNAIL_WIDTHS);
  const minPreviewWidth = Math.min(...processor.PREVIEW_WIDTHS);
  const eligible = () => applyScanPriorityFence(db('object_gallery_derivatives'), minThumbnailWidth, minPreviewWidth)
    .where({ state: 'queued', is_current: true })
    .where((query) => query.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', new Date()))
    .orderByRaw(assetPrioritySql())
    .orderBy('width', 'asc')
    .orderBy('id', 'asc');
  const row = await eligible().first();
  if (!row) return scanned;
  // Do not start a larger tier while the last smaller tier is still running.
  const rows = await eligible().where({ asset_kind: row.asset_kind, width: row.width }).limit(config.galleryUploadConcurrency || 4);
  const results = await Promise.allSettled(rows.map(processJob));
  for (const result of results) if (result.status === 'rejected') logger.warn('Gallery queue job failed before processing', { error: result.reason?.message });
  return true;
}

async function queueNextScanBatch(config) {
  const scan = await db('object_gallery_derivative_scans')
    .where({ state: 'queued' })
    .orderByRaw(assetPrioritySql())
    .orderBy('id', 'asc')
    .first();
  if (!scan) return false;
  const event = await db('events').where({ id: scan.event_id }).first();
  if (!enabledFor(event, scan.asset_kind)) {
    await db('object_gallery_derivative_scans').where({ id: scan.id, state: 'queued' }).update({ state: 'paused', updated_at: new Date() });
    return true;
  }
  let query = db('photos').where({ event_id: scan.event_id });
  if (scan.cursor_photo_id !== null && scan.cursor_photo_id !== undefined) query = query.where('id', '<', Number(scan.cursor_photo_id));
  const photos = await query.orderBy('id', 'desc').limit(SCAN_BATCH_SIZE);
  if (!photos.length) {
    await db('object_gallery_derivative_scans').where({ id: scan.id }).update({ state: 'complete', error_message: null, updated_at: new Date() });
    return true;
  }
  try {
    for (const photo of photos) {
      const widths = await getWidths(scan.asset_kind, photo);
      for (const width of widths) await queueAsset(event, photo, scan.asset_kind, width, config, { strictSource: true });
      if (scan.asset_kind === ASSET_KINDS.PREVIEW && Number(event.hero_photo_id) === Number(photo.id)) {
        await queueAsset(event, photo, ASSET_KINDS.HERO, 1920, config, { strictSource: true });
      }
    }
  } catch (error) {
    await db('object_gallery_derivative_scans').where({ id: scan.id, state: 'queued' }).update({
      state: 'failed',
      error_message: String(error?.message || error).slice(0, 2000),
      updated_at: new Date(),
    });
    logger.warn('Gallery cloud scan paused after a source read failure', { eventId: scan.event_id, kind: scan.asset_kind, error: error.message });
    return true;
  }
  const now = new Date();
  await db('object_gallery_derivative_scans').where({ id: scan.id, state: 'queued' }).update({
    cursor_photo_id: Number(photos[photos.length - 1].id),
    ...(photos.length < SCAN_BATCH_SIZE ? { state: 'complete' } : {}),
    error_message: null,
    updated_at: now,
  });
  return true;
}

async function recoverInterruptedJobs() {
  return db('object_gallery_derivatives')
    .where({ state: 'uploading' })
    .where('updated_at', '<', new Date(Date.now() - 60 * 60 * 1000))
    .update({ state: 'queued', next_attempt_at: null, error_message: '进程中断后恢复上传', updated_at: new Date() });
}

async function fenceProjectAssets(eventId, photoId) {
  const now = new Date();
  const filter = { event_id: Number(eventId) };
  if (photoId !== undefined && photoId !== null) filter.photo_id = Number(photoId);
  const active = await db('object_gallery_derivatives').where({ ...filter, state: 'uploading' })
    .update({ is_current: false, next_attempt_at: null, updated_at: now });
  const paused = await db('object_gallery_derivatives').where(filter).whereNot({ state: 'uploading' })
    .update({ is_current: false, state: 'paused', next_attempt_at: null, updated_at: now });
  if ((photoId === undefined || photoId === null) && await db.schema.hasTable('object_gallery_derivative_scans')) {
    await db('object_gallery_derivative_scans').where({ event_id: Number(eventId), state: 'queued' })
      .update({ state: 'paused', updated_at: now });
  }
  return active + paused;
}

async function waitForProjectUploads(eventId, timeoutMs = 120_000, photoId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const query = db('object_gallery_derivatives').where({ event_id: Number(eventId), state: 'uploading' });
    if (photoId !== undefined && photoId !== null) query.where({ photo_id: Number(photoId) });
    const active = await query.first('id');
    if (!active) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw Object.assign(new Error('云端预览仍在上传，已停止删除；请稍后重试'), { code: 'CLOUD_UPLOAD_IN_PROGRESS', status: 409 });
}

async function deleteProjectAssets(eventId) {
  await fenceProjectAssets(eventId);
  await waitForProjectUploads(eventId);
  const rows = await db('object_gallery_derivatives').where({ event_id: Number(eventId) }).select('id', 'object_key', 'target_id');
  if (!rows.length) return 0;
  const objectStorage = getObjectDelivery();
  const config = await objectStorage.getObjectStorageConfig();
  if (!objectStorage.isConfigured(config)) throw Object.assign(new Error('对象存储未配置，无法删除云端预览图'), { code: 'OBJECT_STORAGE_NOT_CONFIGURED' });
  const targetId = objectStorage.getTargetId(config);
  if (rows.some((row) => row.target_id !== targetId)) throw Object.assign(new Error('当前对象存储目标与云端预览图所在目标不一致，请先恢复原存储配置'), { code: 'OBJECT_STORAGE_TARGET_CHANGED' });
  const adapter = objectStorage.buildAdapter(config);
  const keys = rows.map((row) => [config.prefix, row.object_key].filter(Boolean).join('/'));
  const result = await adapter.deleteMany(keys);
  if (result.Errors?.length) throw Object.assign(new Error(`对象存储拒绝删除 ${result.Errors.length} 个预览文件`), { code: 'CLOUD_DELETE_PARTIAL' });
  await db('object_gallery_derivatives').where({ event_id: Number(eventId) }).delete();
  await db('object_gallery_derivative_scans').where({ event_id: Number(eventId) }).delete();
  return rows.length;
}

async function deletePhotoAssets(eventId, photoId) {
  const rows = await db('object_gallery_derivatives').where({ event_id: Number(eventId), photo_id: Number(photoId) }).select('id', 'object_key', 'target_id');
  if (!rows.length) return 0;
  const objectStorage = getObjectDelivery();
  const config = await objectStorage.getObjectStorageConfig();
  if (!objectStorage.isConfigured(config)) throw Object.assign(new Error('对象存储未配置，无法删除云端预览图'), { code: 'OBJECT_STORAGE_NOT_CONFIGURED' });
  const targetId = objectStorage.getTargetId(config);
  if (rows.some((row) => row.target_id !== targetId)) throw Object.assign(new Error('当前对象存储目标与云端预览图所在目标不一致，请先恢复原存储配置'), { code: 'OBJECT_STORAGE_TARGET_CHANGED' });
  await db('object_gallery_derivatives').where({ event_id: Number(eventId), photo_id: Number(photoId) }).update({ is_current: false, state: 'paused', updated_at: new Date() });
  const adapter = objectStorage.buildAdapter(config);
  const result = await adapter.deleteMany(rows.map((row) => [config.prefix, row.object_key].filter(Boolean).join('/')));
  if (result.Errors?.length) throw Object.assign(new Error(`对象存储拒绝删除 ${result.Errors.length} 个预览文件`), { code: 'CLOUD_DELETE_PARTIAL' });
  await db('object_gallery_derivatives').where({ event_id: Number(eventId), photo_id: Number(photoId) }).delete();
  return rows.length;
}

module.exports = {
  ASSET_KINDS,
  assetPriority,
  assetPrioritySql,
  applyScanPriorityFence,
  URL_TTL_SECONDS,
  enabledFor,
  getWidths,
  queueAsset,
  queuePhotoAssets,
  queuePhotoIfEnabled,
  queueRegeneratedAsset,
  queueProjectAssets,
  getReadyAssetUrl,
  pauseProjectAssets,
  retryFailed,
  getProjectStatus,
  queueNextScanBatch,
  runQueueOnce,
  recoverInterruptedJobs,
  fenceProjectAssets,
  waitForProjectUploads,
  deleteProjectAssets,
  deletePhotoAssets,
};
