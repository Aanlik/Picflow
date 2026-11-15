const crypto = require('crypto');
const { db } = require('../database/db');
const { AppError } = require('../utils/errors');
const tokenVault = require('../utils/deliveryPortalTokenVault');
const { getPublicPhotoStates } = require('./photographyWorkflowBridge');
const { isCurrentDeliveredWorkflowPhoto } = require('./retouchWorkflowState');

const PHOTO_SCOPE_TTL_MS = 1000;
const photoScopeCache = new Map();

function tokenDigest(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function newPortalToken() {
  return crypto.randomBytes(32).toString('base64url');
}

async function loadDeliveredPhotoIds(eventId) {
  const workflow = await getPublicPhotoStates(Number(eventId));
  if (workflow.status !== 200 || !Array.isArray(workflow.data?.photos)) {
    throw new AppError('Retouch delivery status is temporarily unavailable', 503, 'DELIVERY_STATUS_UNAVAILABLE');
  }
  const stage = workflow.data.stage;
  const deliveredIds = getCurrentDeliveredIds(workflow.data.photos, stage);
  if (!deliveredIds.length) return new Set();

  // The portal intentionally excludes RAW/original rows even if an old Bridge
  // state still says delivered. Source classification is an independent gate.
  const rows = await db('photos')
    .where({ event_id: Number(eventId), download_source_kind: 'delivery' })
    .whereIn('id', deliveredIds)
    .where(function () {
      this.where('processing_status', 'complete').orWhereNull('processing_status');
    })
    .select('id');
  return selectDeliveredPortalPhotoIds(deliveredIds, rows);
}

function getCurrentDeliveredIds(workflowPhotos, stage) {
  return [...new Set(workflowPhotos
    .filter((photo) => isCurrentDeliveredWorkflowPhoto(photo, stage))
    .map((photo) => Number(photo.photo_id))
    .filter((id) => Number.isSafeInteger(id) && id > 0))];
}

function selectDeliveredPortalPhotoIds(deliveredIds, photoRows) {
  const eligible = new Set(deliveredIds.map(Number));
  return new Set(photoRows.map((row) => Number(row.id)).filter((id) => eligible.has(id)));
}

async function getDeliveredPhotoIds(eventId) {
  const id = Number(eventId);
  const now = Date.now();
  const cached = photoScopeCache.get(id);
  if (cached?.value && cached.expiresAt > now) return cached.value;
  if (cached?.pending) return cached.pending;

  const entry = { expiresAt: 0, value: null, pending: null };
  entry.pending = loadDeliveredPhotoIds(id).then((value) => {
    entry.value = value;
    entry.expiresAt = Date.now() + PHOTO_SCOPE_TTL_MS;
    entry.pending = null;
    return value;
  }).catch((error) => {
    photoScopeCache.delete(id);
    throw error;
  });
  photoScopeCache.set(id, entry);
  while (photoScopeCache.size > 1000) photoScopeCache.delete(photoScopeCache.keys().next().value);
  return entry.pending;
}

async function isDeliveredPhoto(eventId, photoId) {
  const photoIds = await getDeliveredPhotoIds(eventId);
  return photoIds.has(Number(photoId));
}

function invalidatePhotoScope(eventId) {
  photoScopeCache.delete(Number(eventId));
}

module.exports = {
  tokenDigest,
  newPortalToken,
  encryptToken: tokenVault.encryptToken,
  decryptToken: tokenVault.decryptToken,
  getCurrentDeliveredIds,
  selectDeliveredPortalPhotoIds,
  getDeliveredPhotoIds,
  isDeliveredPhoto,
  invalidatePhotoScope,
};
