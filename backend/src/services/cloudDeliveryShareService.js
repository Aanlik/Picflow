const crypto = require('crypto');
const path = require('path');
const bcrypt = require('bcrypt');
const { db } = require('../database/db');
const objectDelivery = require('./objectDeliveryService');
const photographyWorkflow = require('./photographyWorkflowBridge');
const { resolvePhotoStorageKey } = require('./photoResolver');
const { buildContentDisposition } = require('../utils/filenameSanitizer');
const { getFrontendBaseUrl } = require('../utils/frontendUrl');

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_BYTES = 72;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const MAX_DOWNLOAD_URL_TTL_SECONDS = 15 * 60;
const SHARE_DAYS = new Set([1, 7, 30]);

function shareError(code, status = 404, message = '分享链接无效或已过期') {
  return Object.assign(new Error(message), { code, status });
}

function tokenDigest(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function validateSharePassword(password) {
  return typeof password === 'string'
    && Array.from(password).length >= PASSWORD_MIN_LENGTH
    && Buffer.byteLength(password, 'utf8') <= PASSWORD_MAX_BYTES;
}

function filenameForPhoto(photo) {
  return path.basename(String(photo?.filename || photo?.original_filename || `photo-${photo?.id || 'final'}.jpg`));
}

function getBridgeDeliveredPhoto(photos, photoId) {
  return photos.find((photo) => Number(photo.photo_id) === Number(photoId)
    && photo.delivered
    && Number(photo.current_version) > 0
    && !photo.selection_cancelled
    && !photo.withdraw_pending);
}

async function getProject(eventId) {
  const event = await db('events').where({ id: Number(eventId) }).first();
  if (!event) throw shareError('SHARE_UNAVAILABLE');
  if (event.is_archived || event.is_archiving) {
    throw shareError('SHARE_UNAVAILABLE', 410);
  }
  return event;
}

async function getCurrentDeliveredFile(event, photoId, expected = {}) {
  const workflow = await photographyWorkflow.getProjectDetail(event.id);
  if (workflow.status !== 200 || !Array.isArray(workflow.data?.photos)) {
    throw shareError('SHARE_UNAVAILABLE', 503);
  }
  const bridgePhoto = getBridgeDeliveredPhoto(workflow.data.photos, photoId);
  if (!bridgePhoto || (expected.retouchVersion != null
    && Number(bridgePhoto.current_version) !== Number(expected.retouchVersion))) {
    throw shareError('SHARE_UNAVAILABLE', 410);
  }

  const photo = await db('photos').where({ id: Number(photoId), event_id: event.id }).first();
  if (!photo || photo.source_origin !== 'managed' || photo.download_source_kind === 'original') {
    throw shareError('SHARE_UNAVAILABLE', 410);
  }
  let sourceKey;
  try { sourceKey = resolvePhotoStorageKey(event, photo); } catch { sourceKey = null; }
  if (!sourceKey) throw shareError('SHARE_UNAVAILABLE', 410);

  const config = await objectDelivery.getObjectStorageConfig();
  if (!config.enabled || !objectDelivery.isConfigured(config)) {
    throw shareError('SHARE_UNAVAILABLE', 503);
  }
  const file = await objectDelivery.getCurrentReadyObject(event.id, photo.id, config);
  if (!file || file.source_key !== sourceKey || (expected.deliveryFileId != null
    && Number(file.id) !== Number(expected.deliveryFileId))) {
    throw shareError('SHARE_UNAVAILABLE', 410);
  }
  return { photo, bridgePhoto, file, config };
}

async function listProjectShares(eventId) {
  const event = await db('events').where({ id: Number(eventId) }).first();
  if (!event) throw shareError('PROJECT_NOT_FOUND', 404, '项目不存在');
  const now = new Date();
  const [activeRows, config] = await Promise.all([
    db('object_delivery_shares as shares')
      .join('photos', 'photos.id', 'shares.photo_id')
      .where('shares.event_id', Number(eventId))
      .whereNull('shares.revoked_at')
      .where('shares.expires_at', '>', now)
      .select('shares.id', 'shares.photo_id', 'shares.delivery_file_id', 'shares.retouch_version', 'shares.expires_at', 'photos.filename'),
    objectDelivery.getObjectStorageConfig(),
  ]);

  let delivered = [];
  let workflowAvailable = true;
  if (!event.is_archived && !event.is_archiving) {
    const result = await photographyWorkflow.getProjectDetail(event.id);
    if (result.status !== 200 || !Array.isArray(result.data?.photos)) {
      workflowAvailable = false;
    } else {
      delivered = result.data.photos.filter((photo) => photo.delivered
        && Number(photo.current_version) > 0
        && !photo.selection_cancelled
        && !photo.withdraw_pending);
    }
  }

  const photoIds = delivered.map((photo) => Number(photo.photo_id));
  const photoRows = photoIds.length
    ? await db('photos').where({ event_id: Number(eventId) }).whereIn('id', photoIds).select('id', 'filename', 'original_filename', 'source_origin', 'download_source_kind', 'path')
    : [];
  const photoById = new Map(photoRows.map((photo) => [Number(photo.id), photo]));
  const currentFiles = photoIds.length && config.enabled && objectDelivery.isConfigured(config)
    ? await db('object_delivery_files')
      .where({ event_id: Number(eventId), is_current: true, target_id: objectDelivery.getTargetId(config) })
      .whereIn('photo_id', photoIds)
      .select('id', 'photo_id', 'source_key', 'state')
    : [];
  const fileByPhotoId = new Map(currentFiles.map((file) => [Number(file.photo_id), file]));
  const eligiblePhotos = delivered.flatMap((state) => {
    const photo = photoById.get(Number(state.photo_id));
    if (!photo || photo.source_origin !== 'managed' || photo.download_source_kind === 'original') return [];
    const currentFile = fileByPhotoId.get(Number(state.photo_id));
    let currentSource = null;
    try { currentSource = resolvePhotoStorageKey(event, photo); } catch { /* show as not ready */ }
    const matchingFile = currentFile && currentFile.source_key === currentSource ? currentFile : null;
    return [{
      photoId: Number(state.photo_id),
      filename: filenameForPhoto(photo),
      retouchVersion: Number(state.current_version),
      ready: Boolean(matchingFile?.state === 'ready'),
      status: matchingFile?.state || 'not_synced',
    }];
  });

  return {
    workflowAvailable,
    eligiblePhotos,
    activeShares: activeRows.map((share) => {
      const activePhoto = delivered.find((photo) => Number(photo.photo_id) === Number(share.photo_id));
      const currentFile = fileByPhotoId.get(Number(share.photo_id));
      const photo = photoById.get(Number(share.photo_id));
      let currentSource = null;
      try { if (photo) currentSource = resolvePhotoStorageKey(event, photo); } catch { /* unavailable */ }
      return {
        id: Number(share.id),
        photoId: Number(share.photo_id),
        filename: filenameForPhoto({ ...share, id: share.photo_id }),
        expiresAt: new Date(share.expires_at).toISOString(),
        available: workflowAvailable ? Boolean(activePhoto
          && Number(activePhoto.current_version) === Number(share.retouch_version)
          && currentFile?.state === 'ready'
          && Number(currentFile.id) === Number(share.delivery_file_id)
          && currentFile.source_key === currentSource) : null,
      };
    }),
  };
}

async function createProjectShare(eventId, photoId, password, expiresInDays, adminId) {
  if (!validateSharePassword(password)) {
    throw shareError('INVALID_SHARE_PASSWORD', 400, '密码至少 8 个字符，且不能超过 72 个 UTF-8 字节');
  }
  if (!SHARE_DAYS.has(Number(expiresInDays))) {
    throw shareError('INVALID_SHARE_EXPIRY', 400, '分享有效期仅支持 1、7 或 30 天');
  }
  const event = await getProject(eventId);
  const { photo, bridgePhoto, file } = await getCurrentDeliveredFile(event, photoId);
  const token = crypto.randomBytes(32).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 12);
  const expiresAt = new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000);
  const [inserted] = await db('object_delivery_shares').insert({
    event_id: event.id,
    photo_id: photo.id,
    delivery_file_id: file.id,
    token_hash: tokenDigest(token),
    password_hash: passwordHash,
    retouch_version: Number(bridgePhoto.current_version),
    expires_at: expiresAt,
    created_by: Number(adminId) || null,
  }).returning('id');
  const id = Number(inserted?.id ?? inserted);
  const sharePath = `/cloud-delivery/${token}`;
  const publicBase = await getFrontendBaseUrl();
  return {
    id,
    token,
    shareUrl: publicBase ? `${publicBase}${sharePath}` : sharePath,
    filename: filenameForPhoto(photo),
    expiresAt: expiresAt.toISOString(),
  };
}

async function revokeProjectShare(eventId, shareId) {
  const changed = await db('object_delivery_shares')
    .where({ id: Number(shareId), event_id: Number(eventId) })
    .whereNull('revoked_at')
    .update({ revoked_at: new Date() });
  return Number(changed) > 0;
}

async function unlockShare(token, password) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw shareError('SHARE_UNAVAILABLE');
  }
  const row = await db('object_delivery_shares').where({ token_hash: tokenDigest(token) }).first();
  const now = new Date();
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= now.getTime()) {
    throw shareError('SHARE_UNAVAILABLE');
  }
  if (row.locked_until && new Date(row.locked_until).getTime() > now.getTime()) {
    throw shareError('SHARE_TRY_AGAIN_LATER', 429, '尝试次数过多，请稍后再试');
  }
  const valid = typeof password === 'string' && await bcrypt.compare(password, row.password_hash);
  if (!valid) {
    await db.transaction(async (trx) => {
      const current = await trx('object_delivery_shares').where({ id: row.id }).forUpdate().first();
      if (!current || current.revoked_at || new Date(current.expires_at).getTime() <= Date.now()) return;
      const attempts = Number(current.failed_attempts || 0) + 1;
      await trx('object_delivery_shares').where({ id: row.id }).update({
        failed_attempts: attempts,
        locked_until: attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_DURATION_MS) : null,
      });
    });
    throw shareError('SHARE_PASSWORD_INVALID', 401, '密码错误');
  }

  const stillActive = await db('object_delivery_shares').where({ id: row.id }).first();
  if (!stillActive || stillActive.revoked_at || new Date(stillActive.expires_at).getTime() <= Date.now()) {
    throw shareError('SHARE_UNAVAILABLE');
  }
  await db('object_delivery_shares').where({ id: row.id }).update({ failed_attempts: 0, locked_until: null });
  const event = await getProject(row.event_id);
  const { photo, file, config } = await getCurrentDeliveredFile(event, row.photo_id, {
    retouchVersion: row.retouch_version,
    deliveryFileId: row.delivery_file_id,
  });
  const ttl = Math.min(MAX_DOWNLOAD_URL_TTL_SECONDS, Math.floor((new Date(row.expires_at).getTime() - Date.now()) / 1000));
  if (ttl < 1) throw shareError('SHARE_UNAVAILABLE');
  const adapter = objectDelivery.buildAdapter(config);
  const objectKey = [config.prefix, file.object_key].filter(Boolean).join('/');
  const url = await adapter.getSignedUrl('getObject', objectKey, {
    expiresIn: ttl,
    params: {
      ResponseContentDisposition: buildContentDisposition(filenameForPhoto(photo)),
      ResponseContentType: photo.mime_type || 'application/octet-stream',
    },
  });
  return { url, filename: filenameForPhoto(photo), expiresInSeconds: ttl };
}

module.exports = {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_BYTES,
  validateSharePassword,
  tokenDigest,
  filenameForPhoto,
  listProjectShares,
  createProjectShare,
  revokeProjectShare,
  unlockShare,
};
