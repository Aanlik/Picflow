const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { db } = require('../database/db');
const { getStorage } = require('./storage');
const S3StorageAdapter = require('./storage/s3Storage');
const { decryptSecret } = require('../utils/objectStorageVault');
const { isPrivateEndpointApproved } = require('../utils/s3EndpointPolicy');
const { resolvePhotoStorageKey } = require('./photoResolver');
const { buildContentDisposition } = require('../utils/filenameSanitizer');
const logger = require('../utils/logger');
const { SharedUploadLimiter } = require('./uploadLimiter');

const SETTINGS_PREFIX = 'object_storage_';
const SECRET_KEY = `${SETTINGS_PREFIX}secret_key_encrypted`;
const PRIVATE_APPROVAL_SETTING = 'backup_s3_private_endpoint_approval';
const RETRY_LIMIT = 8;
const MAX_CONCURRENT_UPLOADS = 2;
const UPLOAD_TIMEOUT_RETRY_MS = 30_000;
const CUSTOMER_DOWNLOAD_URL_TTL_SECONDS = 15 * 60;
const CUSTOMER_DOWNLOAD_OBJECT_TTL_MS = 24 * 60 * 60 * 1000;
const CUSTOMER_DOWNLOAD_OBJECT_PREFIX = 'picpeak-delivery/customer-downloads';
let workerTimer = null;
let workerRunning = false;
let stopped = false;
let lastCustomerDownloadCleanupAt = 0;
let cachedAdapter = null;
let cachedAdapterConfig = null;
const backgroundUploadLimiter = new SharedUploadLimiter();

function parseSetting(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return value; }
}

async function getObjectStorageConfig() {
  const rows = await db('app_settings').where('setting_type', 'object_storage').select('setting_key', 'setting_value');
  const values = {};
  for (const row of rows) values[row.setting_key] = parseSetting(row.setting_value);
  const limit = values[`${SETTINGS_PREFIX}background_upload_limit_kib`];
  backgroundUploadLimiter.setBytesPerSecond(Number.isInteger(limit) && limit >= 64 && limit <= 1048576 ? limit * 1024 : 0);
  const secret = values[SECRET_KEY] ? decryptSecret(values[SECRET_KEY]) : '';
  return {
    enabled: values[`${SETTINGS_PREFIX}enabled`] === true || values[`${SETTINGS_PREFIX}enabled`] === 'true',
    endpoint: values[`${SETTINGS_PREFIX}endpoint`] || '',
    region: values[`${SETTINGS_PREFIX}region`] || 'us-east-1',
    bucket: values[`${SETTINGS_PREFIX}bucket`] || '',
    prefix: (values[`${SETTINGS_PREFIX}prefix`] || '').replace(/^\/+|\/+$/g, ''),
    forcePathStyle: values[`${SETTINGS_PREFIX}force_path_style`] === true || values[`${SETTINGS_PREFIX}force_path_style`] === 'true',
    galleryUploadConcurrency: Number.isInteger(values[`${SETTINGS_PREFIX}gallery_upload_concurrency`]) && values[`${SETTINGS_PREFIX}gallery_upload_concurrency`] >= 1 && values[`${SETTINGS_PREFIX}gallery_upload_concurrency`] <= 8 ? values[`${SETTINGS_PREFIX}gallery_upload_concurrency`] : 4,
    accessKeyId: values[`${SETTINGS_PREFIX}access_key_id`] || '',
    secretAccessKey: secret,
    privateApproval: parseSetting((await db('app_settings').where({ setting_key: PRIVATE_APPROVAL_SETTING }).first())?.setting_value),
  };
}

function getTargetId(config) {
  return JSON.stringify([config.endpoint || '', config.region || 'us-east-1', config.bucket || '', config.prefix || '']);
}

function isConfigured(config) {
  return Boolean(config?.bucket && config?.accessKeyId && config?.secretAccessKey);
}

function buildAdapter(config) {
  if (!isConfigured(config)) throw Object.assign(new Error('对象存储尚未配置完整'), { code: 'OBJECT_STORAGE_NOT_CONFIGURED' });
  const adapterConfig = {
    endpoint: config.endpoint || '',
    region: config.region || 'us-east-1',
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    forcePathStyle: config.forcePathStyle === true,
    autoPathStyleForCustomEndpoint: false,
    privateApproval: config.privateApproval || '',
  };
  if (cachedAdapter && JSON.stringify(cachedAdapterConfig) === JSON.stringify(adapterConfig)) return cachedAdapter;
  cachedAdapter?.s3Client?.destroy?.();
  const sslEnabled = !/^http:\/\//i.test(config.endpoint || '');
  const allowPrivateEndpoint = isPrivateEndpointApproved(config.endpoint, sslEnabled, config.privateApproval);
  cachedAdapter = new S3StorageAdapter({
    bucket: config.bucket,
    region: config.region || 'us-east-1',
    endpoint: config.endpoint || undefined,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    forcePathStyle: config.forcePathStyle === true,
    autoPathStyleForCustomEndpoint: false,
    sslEnabled,
    allowPrivateEndpoint,
    multipartThreshold: 16 * 1024 * 1024,
    partSize: 8 * 1024 * 1024,
    queueSize: MAX_CONCURRENT_UPLOADS,
  });
  cachedAdapterConfig = adapterConfig;
  return cachedAdapter;
}

function objectKey(config, eventId, photoId) {
  return ['picpeak-delivery', `events/${eventId}/photos/${photoId}`, crypto.randomUUID()]
    .filter(Boolean).join('/');
}

async function queuePhoto(event, photo) {
  if (!event || !photo || !event.cloud_sync_enabled || event.is_archived || event.is_archiving) return null;
  if (photo.download_source_kind === 'original') return null;
  const config = await getObjectStorageConfig();
  if (!config.enabled || !isConfigured(config)) return null;
  if (photo.source_origin !== 'managed') return null;
  const sourceKey = resolvePhotoStorageKey(event, photo);
  if (!sourceKey) return null;
  const targetId = getTargetId(config);
  const fresh = {
    event_id: Number(event.id),
    photo_id: Number(photo.id),
    source_key: sourceKey,
    object_key: objectKey(config, event.id, photo.id),
    target_id: targetId,
    state: 'queued',
    is_current: true,
    attempts: 0,
    next_attempt_at: null,
    size_bytes: Number(photo.size_bytes) || null,
    error_message: null,
    updated_at: new Date(),
  };

  await db.transaction(async (trx) => {
    const existing = await trx('object_delivery_files')
      .where({ event_id: fresh.event_id, photo_id: fresh.photo_id, source_key: sourceKey })
      .first();
    if (existing?.state === 'ready' && existing.target_id === targetId) {
      await trx('object_delivery_files').where({ id: existing.id }).update({ is_current: true, updated_at: new Date() });
      await trx('object_delivery_files').where({ event_id: fresh.event_id, photo_id: fresh.photo_id }).whereNot({ id: existing.id }).update({ is_current: false });
      return;
    }
    if (existing && existing.target_id === targetId && ['queued', 'uploading', 'failed'].includes(existing.state)) {
      await trx('object_delivery_files').where({ event_id: fresh.event_id, photo_id: fresh.photo_id }).whereNot({ id: existing.id }).update({ is_current: false });
      await trx('object_delivery_files').where({ id: existing.id }).update({ is_current: true, updated_at: new Date() });
      return;
    }
    await trx('object_delivery_files').where({ event_id: fresh.event_id, photo_id: fresh.photo_id }).update({ is_current: false });
    if (existing) {
      await trx('object_delivery_files').where({ id: existing.id }).update({
        object_key: existing.object_key || fresh.object_key,
        target_id: targetId,
        state: 'queued',
        is_current: true,
        attempts: 0,
        next_attempt_at: null,
        size_bytes: fresh.size_bytes,
        error_message: null,
        updated_at: new Date(),
      });
    } else {
      await trx('object_delivery_files').insert(fresh);
    }
  });
  return { eventId: fresh.event_id, photoId: fresh.photo_id, sourceKey };
}

async function queueCurrentDeliveredFinals(eventId) {
  const event = await db('events').where({ id: Number(eventId) }).first();
  if (!event || !event.cloud_sync_enabled) return { queued: 0, skipped: true };
  const config = await getObjectStorageConfig();
  if (!config.enabled || !isConfigured(config)) return { queued: 0, skipped: true, error: 'OBJECT_STORAGE_NOT_READY' };
  const workflow = await require('./photographyWorkflowBridge').getProjectDetail(event.id);
  if (workflow.status !== 200 || !Array.isArray(workflow.data?.photos)) {
    return { queued: 0, skipped: false, error: workflow.data?.detail || workflow.errorCode || `BRIDGE_HTTP_${workflow.status}` };
  }
  const delivered = workflow.data.photos.filter((photo) => photo.delivered && Number(photo.current_version) > 0 && !photo.selection_cancelled && !photo.withdraw_pending);
  let queued = 0;
  for (const item of delivered) {
    const photo = await db('photos').where({ id: Number(item.photo_id), event_id: event.id }).first();
    if (!photo || photo.source_origin !== 'managed') continue;
    const result = await queuePhoto(event, photo);
    if (result) queued += 1;
  }
  return { queued, skipped: false };
}

async function getCurrentReadyObject(eventId, photoId, configOverride) {
  const config = configOverride || await getObjectStorageConfig();
  if (!config.enabled || !isConfigured(config)) return null;
  const row = await db('object_delivery_files')
    .where({ event_id: Number(eventId), photo_id: Number(photoId), is_current: true, state: 'ready', target_id: getTargetId(config) })
    .first();
  return row || null;
}

async function hasCurrentDeliveryRecord(eventId, photoId, sourceKey) {
  if (!sourceKey) return false;
  return Boolean(await db('object_delivery_files')
    .where({ event_id: Number(eventId), photo_id: Number(photoId), source_key: sourceKey, is_current: true })
    .first('id'));
}

async function getObjectDownloadStream(objectKey) {
  const config = await getObjectStorageConfig();
  return buildAdapter(config).downloadStream([config.prefix, objectKey].filter(Boolean).join('/'));
}

async function reserveCustomerRenditionUpload(rowId) {
  return db.transaction(async (trx) => {
    const row = await trx('object_delivery_download_renditions').where({ id: rowId }).forUpdate().first();
    if (!row || row.delete_requested) return false;
    await trx('object_delivery_download_renditions').where({ id: rowId }).update({
      active_uploads: Number(row.active_uploads || 0) + 1,
      updated_at: new Date(),
    });
    return true;
  });
}

async function finishCustomerRenditionUpload(rowId, adapter, remoteKey) {
  const deleteAfterUpload = await db.transaction(async (trx) => {
    const row = await trx('object_delivery_download_renditions').where({ id: rowId }).forUpdate().first();
    if (!row) return true;
    if (row.delete_requested) return true;
    await trx('object_delivery_download_renditions').where({ id: rowId }).update({
      active_uploads: Math.max(0, Number(row.active_uploads || 0) - 1),
      updated_at: new Date(),
    });
    return false;
  });
  if (!deleteAfterUpload) return true;

  let cleanupError;
  try {
    await adapter.delete(remoteKey);
  } catch (error) {
    cleanupError = error;
  } finally {
    await db.transaction(async (trx) => {
      const row = await trx('object_delivery_download_renditions').where({ id: rowId }).forUpdate().first();
      if (!row) return;
      await trx('object_delivery_download_renditions').where({ id: rowId }).update({
        active_uploads: Math.max(0, Number(row.active_uploads || 0) - 1),
        updated_at: new Date(),
      });
    });
  }
  if (cleanupError) throw cleanupError;
  return false;
}

async function createCustomerDownloadUrl(event, photo, asset, { sourceObjectKey, transformed }) {
  const config = await getObjectStorageConfig();
  if (!config.enabled || !isConfigured(config)) {
    throw Object.assign(new Error('对象存储交付已暂停'), { code: 'CLOUD_DOWNLOAD_NOT_READY' });
  }
  const row = await getCurrentReadyObject(event.id, photo.id, config);
  if (!row || row.object_key !== sourceObjectKey || row.source_key !== resolvePhotoStorageKey(event, photo)) {
    throw Object.assign(new Error('云端成片尚未就绪'), { code: 'CLOUD_DOWNLOAD_NOT_READY' });
  }

  const adapter = buildAdapter(config);
  let objectKey = [config.prefix, row.object_key].filter(Boolean).join('/');
  let renditionRowId = null;
  if (transformed) {
    const digest = String(asset.etag || '').replace(/[^a-f0-9]/gi, '').toLowerCase();
    if (digest.length !== 64 || !asset.file) {
      throw Object.assign(new Error('云端下载成片无效'), { code: 'CLOUD_DOWNLOAD_NOT_READY' });
    }
    const renditionKey = `${CUSTOMER_DOWNLOAD_OBJECT_PREFIX}/${event.id}/${photo.id}/${digest}.bin`;
    objectKey = [config.prefix, renditionKey].filter(Boolean).join('/');
    const now = new Date();
    await db('object_delivery_download_renditions')
      .insert({
        event_id: Number(event.id),
        photo_id: Number(photo.id),
        object_key: renditionKey,
        target_id: getTargetId(config),
        expires_at: new Date(now.getTime() + CUSTOMER_DOWNLOAD_OBJECT_TTL_MS),
        created_at: now,
        updated_at: now,
      })
      .onConflict(['target_id', 'object_key'])
      .merge({ expires_at: new Date(now.getTime() + CUSTOMER_DOWNLOAD_OBJECT_TTL_MS), updated_at: now });
    const rendition = await db('object_delivery_download_renditions')
      .where({ target_id: getTargetId(config), object_key: renditionKey })
      .first('id', 'delete_requested');
    if (!rendition || rendition.delete_requested) {
      throw Object.assign(new Error('项目云端数据正在删除，请稍后重新下载'), { code: 'CLOUD_DOWNLOAD_NOT_READY', status: 409 });
    }
    renditionRowId = rendition.id;
    let existing = null;
    try {
      existing = await adapter.getMetadata(objectKey);
    } catch (error) {
      if (error.name !== 'NotFound' && error.$metadata?.httpStatusCode !== 404) throw error;
    }
    if (Number(existing?.ContentLength) !== Number(asset.size)) {
      if (!await reserveCustomerRenditionUpload(rendition.id)) {
        throw Object.assign(new Error('项目云端数据正在删除，请稍后重新下载'), { code: 'CLOUD_DOWNLOAD_NOT_READY', status: 409 });
      }
      try {
        await adapter.upload(asset.file, objectKey, {
          contentType: asset.content_type || 'application/octet-stream',
          cacheControl: 'private, no-store',
        });
      } catch (error) {
        await finishCustomerRenditionUpload(rendition.id, adapter, objectKey).catch((cleanupError) => {
          logger.warn('Could not clean up a customer rendition upload during deletion', {
            eventId: event.id,
            photoId: photo.id,
            error: cleanupError.message,
          });
        });
        throw error;
      }
      if (!await finishCustomerRenditionUpload(rendition.id, adapter, objectKey)) {
        throw Object.assign(new Error('项目云端数据正在删除，请稍后重新下载'), { code: 'CLOUD_DOWNLOAD_NOT_READY', status: 409 });
      }
    }
  }

  if (renditionRowId) {
    const rendition = await db('object_delivery_download_renditions').where({ id: renditionRowId }).first('delete_requested');
    if (!rendition || rendition.delete_requested) {
      throw Object.assign(new Error('项目云端数据正在删除，请稍后重新下载'), { code: 'CLOUD_DOWNLOAD_NOT_READY', status: 409 });
    }
  }

  const metadata = await adapter.getMetadata(objectKey);
  if (!metadata?.ETag || !Number.isSafeInteger(Number(metadata.ContentLength))) {
    throw Object.assign(new Error('对象存储未返回有效的下载信息'), { code: 'CLOUD_DOWNLOAD_NOT_READY' });
  }
  const url = await adapter.getSignedUrl('getObject', objectKey, {
    expiresIn: CUSTOMER_DOWNLOAD_URL_TTL_SECONDS,
    params: {
      ResponseContentDisposition: buildContentDisposition(asset.filename),
      ResponseContentType: asset.content_type || 'application/octet-stream',
    },
  });
  return { url, etag: metadata.ETag, size: Number(metadata.ContentLength) };
}

async function cleanupExpiredCustomerDownloadObjects() {
  const rows = await db('object_delivery_download_renditions')
    .where('expires_at', '<=', new Date())
    .orderBy('expires_at', 'asc')
    .limit(100);
  if (!rows.length) return 0;
  const config = await getObjectStorageConfig();
  const adapter = isConfigured(config) ? buildAdapter(config) : null;
  let removed = 0;
  for (const row of rows) {
    // Configuration changes are blocked while these rows exist; retain this
    // guard so a manually edited database cannot delete from another bucket.
    if (!adapter || row.target_id !== getTargetId(config)) continue;
    try {
      await db.transaction(async (trx) => {
        const table = trx('object_delivery_download_renditions');
        // Take a write lock before the object-store delete. A concurrent
        // request may refresh this rendition's expiry after the cleanup
        // candidate list was read; serializing on the row prevents deleting
        // an object that has just received a new signed URL.
        await table.where({ id: row.id }).update({ updated_at: new Date() });
        const current = await trx('object_delivery_download_renditions')
          .where({ id: row.id })
          .forUpdate()
          .first();
        if (!current || new Date(current.expires_at).getTime() > Date.now()) return;
        if (current.target_id !== getTargetId(config)) return;
        await adapter.delete([config.prefix, current.object_key].filter(Boolean).join('/'));
        await trx('object_delivery_download_renditions').where({ id: current.id }).delete();
        removed += 1;
      });
    } catch (error) {
      logger.warn('Could not remove an expired customer download object', {
        renditionId: row.id,
        error: String(error.message || error).slice(0, 300),
      });
    }
  }
  return removed;
}

async function markFailure(row, error) {
  const attempts = Number(row.attempts || 0) + 1;
  const delay = Math.min(60 * 60 * 1000, UPLOAD_TIMEOUT_RETRY_MS * (2 ** Math.min(attempts - 1, 7)));
  await db('object_delivery_files').where({ id: row.id, state: 'uploading' }).update({
    state: attempts >= RETRY_LIMIT ? 'failed' : 'queued',
    attempts,
    next_attempt_at: attempts >= RETRY_LIMIT ? null : new Date(Date.now() + delay),
    error_message: String(error?.message || error).slice(0, 2000),
    updated_at: new Date(),
  });
}

async function processJob(row) {
  const claimed = await db('object_delivery_files').where({ id: row.id, state: 'queued', is_current: true }).update({ state: 'uploading', updated_at: new Date() });
  if (!claimed) return false;
  const tempPath = path.join(os.tmpdir(), `picpeak-cloud-sync-${crypto.randomUUID()}`);
  const heartbeat = setInterval(() => {
    void db('object_delivery_files').where({ id: row.id, state: 'uploading' }).update({ updated_at: new Date() })
      .catch((error) => logger.warn('Could not refresh cloud upload lease', { eventId: row.event_id, photoId: row.photo_id, error: error.message }));
  }, 60_000);
  heartbeat.unref();
  try {
    const [event, photo, config] = await Promise.all([
      db('events').where({ id: row.event_id }).first(),
      db('photos').where({ id: row.photo_id, event_id: row.event_id }).first(),
      getObjectStorageConfig(),
    ]);
    if (!event || !photo || event.is_archived || event.is_archiving || !event.cloud_sync_enabled || !config.enabled) {
      await db('object_delivery_files').where({ id: row.id, state: 'uploading' }).update({ state: 'paused', error_message: null, updated_at: new Date() });
      return true;
    }
    const currentSource = photo.source_origin === 'managed' && photo.download_source_kind !== 'original' ? resolvePhotoStorageKey(event, photo) : null;
    if (currentSource !== row.source_key || getTargetId(config) !== row.target_id) {
      await db('object_delivery_files').where({ id: row.id, state: 'uploading' }).update({ state: 'stale', is_current: false, updated_at: new Date() });
      return true;
    }
    await getStorage().getToFile(row.source_key, tempPath);
    const adapter = buildAdapter(config);
    const key = [config.prefix, row.object_key].filter(Boolean).join('/');
    await adapter.upload(tempPath, key, {
      contentType: photo.mime_type || 'application/octet-stream',
      streamLimiter: backgroundUploadLimiter,
      progressEventId: Number(event.id),
      metadata: { eventId: String(event.id), photoId: String(photo.id) },
    });
    const latest = await db('object_delivery_files').where({ id: row.id }).first();
    const latestPhoto = await db('photos').where({ id: row.photo_id, event_id: row.event_id }).first();
    const latestSource = latestPhoto && latestPhoto.source_origin === 'managed' && latestPhoto.download_source_kind !== 'original' ? resolvePhotoStorageKey(event, latestPhoto) : null;
    const latestEvent = await db('events').where({ id: row.event_id }).first('is_archiving', 'is_archived', 'cloud_sync_enabled', 'slug');
    const latestCurrentSource = latestEvent && latestPhoto?.source_origin === 'managed' && latestPhoto.download_source_kind !== 'original' ? resolvePhotoStorageKey(latestEvent, latestPhoto) : null;
    if (!latest || latest.state !== 'uploading' || !latest.is_current || latest.source_key !== row.source_key || latest.target_id !== row.target_id || latestSource !== row.source_key || latestCurrentSource !== row.source_key || !latestEvent?.cloud_sync_enabled || latestEvent?.is_archiving || latestEvent?.is_archived) {
      await adapter.delete(key);
      await db('object_delivery_files').where({ id: row.id, state: 'uploading' }).update({ state: latestEvent?.is_archiving || latestEvent?.is_archived ? 'paused' : 'stale', is_current: false, updated_at: new Date() });
      return true;
    }
    const stat = await fs.promises.stat(tempPath);
    const becameReady = await db('object_delivery_files').where({ id: row.id, state: 'uploading', source_key: row.source_key })
      .whereExists(db('photos').select(db.raw('1')).where({ id: row.photo_id, event_id: row.event_id })
        .where(function () { this.whereNull('download_source_kind').orWhereNot('download_source_kind', 'original'); }))
      .update({
        state: 'ready',
        size_bytes: stat.size,
        error_message: null,
        attempts: 0,
        next_attempt_at: null,
        updated_at: new Date(),
      });
    if (becameReady) await deleteSupersededCopies(row.event_id, row.photo_id, row.id, config, adapter);
    else {
      await adapter.delete(key);
      await db('object_delivery_files').where({ id: row.id, state: 'uploading' }).update({ state: 'stale', is_current: false, updated_at: new Date() });
    }
  } catch (error) {
    logger.warn('Object storage photo sync failed', { eventId: row.event_id, photoId: row.photo_id, error: error.message });
    await markFailure(row, error).catch((dbError) => logger.error('Could not persist object sync failure', { error: dbError.message }));
  } finally {
    clearInterval(heartbeat);
    await fs.promises.unlink(tempPath).catch(() => {});
  }
  return true;
}

async function runQueueOnce() {
  const config = await getObjectStorageConfig();
  const galleryEnabled = config.enabled && isConfigured(config);
  if (galleryEnabled) {
    // Opt-in gallery derivatives are deliberately a separate queue and
    // separate project switches from finished-photo delivery. They share the
    // configured provider but cannot start just because delivery is enabled.
    const resumableEvents = db('events')
      .where({ cloud_sync_enabled: true, is_archived: false, is_archiving: false })
      .select('id');
    await db('object_delivery_files')
      .where({ state: 'paused', is_current: true })
      .whereIn('event_id', resumableEvents)
      .update({ state: 'queued', next_attempt_at: null, error_message: null, updated_at: new Date() });
  }
  const now = new Date();
  const rows = await db('object_delivery_files')
    .where({ state: 'queued', is_current: true })
    .where((query) => query.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', now))
    .orderBy('id', 'asc')
    .limit(MAX_CONCURRENT_UPLOADS);
  const galleryWork = galleryEnabled ? require('./cloudGalleryAssetService').runQueueOnce().catch((error) => {
    logger.warn('Gallery cloud queue failed', { error: error.message });
    return false;
  }) : Promise.resolve(false);
  const results = await Promise.allSettled(rows.map(processJob));
  for (const result of results) if (result.status === 'rejected') logger.warn('Delivery queue job failed before processing', { error: result.reason?.message });
  const galleryWorked = await galleryWork;
  if (Date.now() - lastCustomerDownloadCleanupAt >= 60_000) {
    lastCustomerDownloadCleanupAt = Date.now();
    await cleanupExpiredCustomerDownloadObjects();
  }
  return galleryWorked || rows.length > 0;
}

function startWorker() {
  if (workerTimer) return;
  stopped = false;
  void db('object_delivery_files')
    .where({ state: 'uploading' })
    .where('updated_at', '<', new Date(Date.now() - 60 * 60 * 1000))
    .update({ state: 'queued', next_attempt_at: null, error_message: '进程中断后恢复上传', updated_at: new Date() })
    .catch((error) => logger.warn('Could not recover interrupted cloud uploads', { error: error.message }));
  void require('./cloudGalleryAssetService').recoverInterruptedJobs()
    .catch((error) => logger.warn('Could not recover interrupted gallery derivative uploads', { error: error.message }));
  const tick = async () => {
    if (workerRunning || stopped) return;
    workerRunning = true;
    let worked = false;
    try { worked = await runQueueOnce(); }
    catch (error) { logger.warn('Object storage delivery worker tick failed', { error: error.message }); }
    finally {
      workerRunning = false;
      if (!stopped) {
        workerTimer = setTimeout(() => void tick(), worked ? 0 : 3000);
        workerTimer.unref();
      }
    }
  };
  workerTimer = setTimeout(() => void tick(), 0);
  workerTimer.unref();
}

async function stopWorker() {
  stopped = true;
  if (workerTimer) clearTimeout(workerTimer);
  workerTimer = null;
  while (workerRunning) await new Promise((resolve) => setTimeout(resolve, 50));
}

async function retryFailed(eventId, photoId) {
  const query = db('object_delivery_files').where({ event_id: Number(eventId), state: 'failed', is_current: true });
  if (photoId) query.where({ photo_id: Number(photoId) });
  const changed = await query.update({ state: 'queued', attempts: 0, next_attempt_at: null, error_message: null, updated_at: new Date() });
  return changed;
}

async function getProjectStatus(eventId) {
  const event = await db('events').where({ id: Number(eventId) }).first('cloud_sync_enabled', 'force_cloud_downloads');
  const rows = await db('object_delivery_files').where({ event_id: Number(eventId), is_current: true }).select('photo_id', 'state', 'size_bytes', 'updated_at');
  const counts = { queued: 0, uploading: 0, ready: 0, failed: 0, paused: 0 };
  rows.forEach((row) => { if (Object.prototype.hasOwnProperty.call(counts, row.state)) counts[row.state] += 1; });
  const galleryAssets = await require('./cloudGalleryAssetService').getProjectStatus(eventId);
  return {
    enabled: Boolean(event?.cloud_sync_enabled),
    forceCloudDownloads: Boolean(event?.force_cloud_downloads),
    counts,
    photos: rows,
    backgroundReadBytesPerSecond: backgroundUploadLimiter.recentBytesPerSecond(Number(eventId)),
    ...galleryAssets,
  };
}

async function fenceProjectCopies(eventId, photoId) {
  const now = new Date();
  const filter = { event_id: Number(eventId) };
  if (photoId !== undefined && photoId !== null) filter.photo_id = Number(photoId);
  if (await db.schema.hasTable('object_delivery_files')) {
    await db('object_delivery_files').where({ ...filter, state: 'uploading' })
      .update({ is_current: false, updated_at: now });
    await db('object_delivery_files').where(filter).whereNot({ state: 'uploading' })
      .update({ is_current: false, state: 'paused', next_attempt_at: null, updated_at: now });
  }
  if (await db.schema.hasTable('object_delivery_download_renditions')) {
    await db('object_delivery_download_renditions').where(filter)
      .update({ delete_requested: true, updated_at: now });
  }
  if (await db.schema.hasTable('object_gallery_derivatives')) {
    await require('./cloudGalleryAssetService').fenceProjectAssets(eventId, photoId);
  }
}

async function waitForProjectUploads(eventId, timeoutMs = 120_000, photoId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const active = [];
    const filter = { event_id: Number(eventId) };
    if (photoId !== undefined && photoId !== null) filter.photo_id = Number(photoId);
    if (await db.schema.hasTable('object_delivery_files')) {
      active.push(db('object_delivery_files').where({ ...filter, state: 'uploading' }).first('id'));
    }
    if (await db.schema.hasTable('object_gallery_derivatives')) {
      active.push(db('object_gallery_derivatives').where({ ...filter, state: 'uploading' }).first('id'));
    }
    if (await db.schema.hasTable('object_delivery_download_renditions')) {
      active.push(db('object_delivery_download_renditions').where(filter).where('active_uploads', '>', 0).first('id'));
    }
    const rows = await Promise.all(active);
    if (rows.every((row) => !row)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw Object.assign(new Error('云端照片仍在上传，已停止删除；请稍后重试'), { code: 'CLOUD_UPLOAD_IN_PROGRESS', status: 409 });
}

async function forgetProjectCopies(eventId, executor = db) {
  const tables = [
    'object_delivery_files',
    'object_delivery_download_renditions',
    'object_gallery_derivatives',
    'object_gallery_derivative_scans',
  ];
  for (const table of tables) {
    // In SQLite/NAS deployments, Knex's pool has a single connection. During
    // the caller's cascade-delete transaction, querying `db.schema` here asks
    // the global pool for a second connection and deadlocks until timeout.
    // Use the transaction's schema builder so both the existence check and
    // delete share the already-held connection.
    if (await executor.schema.hasTable(table)) await executor(table).where({ event_id: Number(eventId) }).delete();
  }
}

async function deleteProjectCopies(eventId) {
  await fenceProjectCopies(eventId);
  await waitForProjectUploads(eventId);
  const [deliveryRows, renditionRows, derivativeRows, scanRows] = await Promise.all([
    db.schema.hasTable('object_delivery_files').then((exists) => exists ? db('object_delivery_files').where({ event_id: Number(eventId) }).select('object_key', 'target_id') : []),
    db.schema.hasTable('object_delivery_download_renditions').then((exists) => exists ? db('object_delivery_download_renditions').where({ event_id: Number(eventId) }).select('object_key', 'target_id') : []),
    db.schema.hasTable('object_gallery_derivatives').then((exists) => exists ? db('object_gallery_derivatives').where({ event_id: Number(eventId) }).select('object_key', 'target_id') : []),
    db.schema.hasTable('object_gallery_derivative_scans').then((exists) => exists ? db('object_gallery_derivative_scans').where({ event_id: Number(eventId) }).select('id') : []),
  ]);
  const allRows = [...deliveryRows, ...renditionRows, ...derivativeRows];
  if (!allRows.length) {
    await forgetProjectCopies(eventId);
    return scanRows.length;
  }
  const config = await getObjectStorageConfig();
  if (!isConfigured(config)) throw Object.assign(new Error('对象存储未配置，无法删除云端照片'), { code: 'OBJECT_STORAGE_NOT_CONFIGURED', status: 409 });
  if (allRows.some((row) => row.target_id !== getTargetId(config))) {
    throw Object.assign(new Error('当前对象存储目标与云端照片所在目标不一致，请恢复原存储配置后重试'), { code: 'OBJECT_STORAGE_TARGET_CHANGED', status: 409 });
  }
  const adapter = buildAdapter(config);
  const keys = allRows.map((row) => [config.prefix, row.object_key].filter(Boolean).join('/'));
  const result = await adapter.deleteMany(keys);
  if (result.Errors?.length) {
    throw Object.assign(new Error(`对象存储拒绝删除 ${result.Errors.length} 个文件；云端记录已保留，请检查密钥权限后重试`), { code: 'CLOUD_DELETE_PARTIAL', status: 502 });
  }
  await forgetProjectCopies(eventId);
  return allRows.length + scanRows.length;
}

async function deletePhotoCopies(eventId, photoId) {
  const filter = { event_id: Number(eventId), photo_id: Number(photoId) };
  await fenceProjectCopies(eventId, photoId);
  await waitForProjectUploads(eventId, 120_000, photoId);
  const [rows, renditionRows, derivativeRows] = await Promise.all([
    db.schema.hasTable('object_delivery_files').then((exists) => exists ? db('object_delivery_files').where(filter).select('id', 'object_key', 'target_id') : []),
    db.schema.hasTable('object_delivery_download_renditions').then((exists) => exists ? db('object_delivery_download_renditions').where(filter).select('id', 'object_key', 'target_id') : []),
    db.schema.hasTable('object_gallery_derivatives').then((exists) => exists ? db('object_gallery_derivatives').where(filter).select('id', 'object_key', 'target_id') : []),
  ]);
  const allRows = [...rows, ...renditionRows, ...derivativeRows];
  if (!allRows.length) return 0;
  const config = await getObjectStorageConfig();
  if (!isConfigured(config)) {
    throw Object.assign(new Error('对象存储未配置，无法删除云端照片'), { code: 'OBJECT_STORAGE_NOT_CONFIGURED', status: 502 });
  }
  if (allRows.some((row) => row.target_id !== getTargetId(config))) {
    throw Object.assign(new Error('当前对象存储目标与云端照片所在目标不一致，请恢复原存储配置后重试'), { code: 'OBJECT_STORAGE_TARGET_CHANGED', status: 409 });
  }
  const adapter = buildAdapter(config);
  const keys = allRows.map((row) => [config.prefix, row.object_key].filter(Boolean).join('/'));
  const result = await adapter.deleteMany(keys);
  if (result.Errors?.length) {
    throw Object.assign(new Error(`对象存储拒绝删除 ${result.Errors.length} 个文件；云端记录已保留，请检查密钥权限后重试`), { code: 'CLOUD_DELETE_PARTIAL', status: 502 });
  }
  for (const table of ['object_delivery_files', 'object_delivery_download_renditions', 'object_gallery_derivatives']) {
    if (await db.schema.hasTable(table)) await db(table).where(filter).delete();
  }
  return allRows.length;
}

async function deleteSupersededCopies(eventId, photoId, currentId, config, adapter) {
  const rows = await db('object_delivery_files')
    .where({ event_id: Number(eventId), photo_id: Number(photoId) })
    .whereNot({ id: currentId })
    .select('id', 'object_key', 'target_id');
  const obsolete = rows.filter((row) => row.target_id === getTargetId(config));
  if (!obsolete.length) return;
  for (const row of obsolete) {
    const key = [config.prefix, row.object_key].filter(Boolean).join('/');
    try {
      await adapter.delete(key);
      await db('object_delivery_files').where({ id: row.id }).delete();
    } catch (error) {
      logger.warn('Could not remove superseded cloud photo copy', { eventId, photoId, error: error.message });
    }
  }
}

module.exports = {
  backgroundUploadLimiter,
  getObjectStorageConfig,
  getTargetId,
  isConfigured,
  buildAdapter,
  queuePhoto,
  queueCurrentDeliveredFinals,
  getCurrentReadyObject,
  hasCurrentDeliveryRecord,
  getObjectDownloadStream,
  createCustomerDownloadUrl,
  cleanupExpiredCustomerDownloadObjects,
  CUSTOMER_DOWNLOAD_URL_TTL_SECONDS,
  CUSTOMER_DOWNLOAD_OBJECT_TTL_MS,
  CUSTOMER_DOWNLOAD_OBJECT_PREFIX,
  getProjectStatus,
  fenceProjectCopies,
  waitForProjectUploads,
  forgetProjectCopies,
  retryFailed,
  deleteProjectCopies,
  deletePhotoCopies,
  deleteSupersededCopies,
  startWorker,
  stopWorker,
};
