const router = require('express').Router();
const crypto = require('crypto');
const { db } = require('../../database/db');
const {
  verifyGalleryAccess,
  denySlideshowToken,
} = require('../../middleware/gallery');
const { resolveGuest } = require('../../middleware/guestAuth');
const { blockHiddenGallery } = require('../../utils/revealMode');
const { parseBooleanInput } = require('../../utils/parsers');
const { canDownloadPhoto } = require('../../services/downloadSourcePolicy');
const {
  resolveEventDownloadPolicy,
  pickRequestedResolution,
  parseResolution,
} = require('../../utils/downloadResolutions');
const {
  resolveWatermarkSettings,
} = require('../../services/downloadRendition');
const {
  customerMetadata,
} = require('../../services/customerDownloadAsset');
const { toUtcIso } = require('../../utils/dateNormalize');
const logger = require('../../utils/logger');
const states = new Set([
  'queued',
  'receiving',
  'paused',
  'retrying',
  'failed',
  'received',
  'handed_off',
  'cancelled',
  'version_changed',
]);
const sameIdentity = (req, res, next) =>
  req.headers['x-download-guest'] &&
  String(req.guest?.id) !== String(req.headers['x-download-guest'])
    ? res.status(409).json({ code: 'DOWNLOAD_IDENTITY_CHANGED' })
    : next();
const downloadGuest = (req, res, next) =>
  req.guest
    ? next()
    : res.status(401).json({ code: 'GUEST_IDENTITY_REQUIRED' });
const middleware = [
  verifyGalleryAccess,
  resolveGuest,
  downloadGuest,
  sameIdentity,
  denySlideshowToken,
  blockHiddenGallery,
];
function scoped(req) {
  return db('customer_download_attempts').where({
    event_id: req.event.id,
    guest_id: req.guest.id,
  });
}
function serialize(row) {
  return {
    ...row,
    total_bytes: Number(row.total_bytes),
    received_bytes: Number(row.received_bytes),
    created_at: toUtcIso(row.created_at),
    updated_at: toUtcIso(row.updated_at),
  };
}
function failure(res, error) {
  if (error.status && error.code)
    return res.status(error.status).json({ code: error.code });
  logger.error('Customer download history failed', { error: error.message });
  return res.status(503).json({ code: 'DOWNLOAD_HISTORY_UNAVAILABLE' });
}

router.get('/:slug/download-history', ...middleware, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    const page = Number(req.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1)
      return res.status(400).json({ code: 'INVALID_PAGE' });
    const [{ total }] = await scoped(req).count('* as total');
    const rows = await scoped(req)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(50)
      .offset((page - 1) * 50);
    const existing = new Set(
      await db('photos')
        .whereIn('id', rows.map((row) => row.photo_id).filter(Boolean))
        .pluck('id'),
    );
    return res.json({
      items: rows.map((row) =>
        serialize({
          ...row,
          photo_id: existing.has(row.photo_id) ? row.photo_id : null,
        }),
      ),
      page,
      total: Number(total),
      pages: Math.max(1, Math.ceil(Number(total) / 50)),
    });
  } catch (error) {
    return failure(res, error);
  }
});

router.post('/:slug/download-history', ...middleware, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    const { photo_id, device_id, resolution } = req.body;
    const client_id = req.body.client_id || crypto.randomUUID();
    if (
      typeof client_id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(client_id) ||
      !Number.isSafeInteger(photo_id) ||
      photo_id < 1 ||
      typeof device_id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(device_id) ||
      (resolution != null &&
        (typeof resolution !== 'string' || resolution.length > 40))
    )
      return res.status(400).json({ code: 'INVALID_DOWNLOAD_TASK' });
    if (!parseBooleanInput(req.event.allow_downloads, true))
      return res.status(403).json({ code: 'DOWNLOAD_DISABLED' });
    const photo = await db('photos')
      .where({ id: photo_id, event_id: req.event.id })
      .first();
    if (!photo)
      return res.status(404).json({ code: 'DOWNLOAD_SOURCE_MISSING' });
    if (!canDownloadPhoto(req.event, photo))
      return res.status(403).json({ code: 'DOWNLOAD_DISABLED' });
    if (photo.visibility === 'hidden' && req.accessLevel !== 'client')
      return res.status(403).json({ code: 'DOWNLOAD_DISABLED' });
    if (photo.category_id) {
      const category = await db('photo_categories')
        .where('id', photo.category_id)
        .first();
      if (category && !parseBooleanInput(category.allow_downloads, true))
        return res.status(403).json({ code: 'DOWNLOAD_DISABLED' });
    }
    const policy = await resolveEventDownloadPolicy(req.event);
    const selected = pickRequestedResolution(policy, resolution);
    if (selected === null)
      return res.status(400).json({ code: 'INVALID_RESOLUTION' });
    const video =
      photo.media_type === 'video' ||
      String(photo.mime_type || '').startsWith('video/');
    const watermark = await resolveWatermarkSettings(req.event);
    const metadata = await customerMetadata(
      req.event,
      photo,
      video ? null : parseResolution(selected),
      watermark,
    );
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(),
      event_id: req.event.id,
      guest_id: req.guest.id,
      photo_id,
      device_id,
      client_id,
      filename: metadata.filename,
      resolution: selected,
      etag: metadata.etag,
      total_bytes: metadata.size,
      received_bytes: 0,
      state: 'queued',
      created_at: now,
      updated_at: now,
    };
    await db('customer_download_attempts')
      .insert(row)
      .onConflict(['event_id', 'guest_id', 'device_id', 'client_id'])
      .ignore();
    const persisted = await scoped(req).where({ device_id, client_id }).first();
    if (persisted.etag !== metadata.etag)
      return res.status(409).json({ code: 'DOWNLOAD_VERSION_CHANGED' });
    return res
      .status(201)
      .json({ ...serialize(persisted), ...metadata });
  } catch (error) {
    return failure(res, error);
  }
});

router.patch('/:slug/download-history/:id', ...middleware, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    const row = await scoped(req).where('id', req.params.id).first();
    if (!row) return res.status(404).json({ code: 'DOWNLOAD_TASK_MISSING' });
    const { state, received_bytes } = req.body;
    if (
      !states.has(state) ||
      !Number.isSafeInteger(received_bytes) ||
      received_bytes < Number(row.received_bytes) ||
      received_bytes > Number(row.total_bytes) ||
      (['received', 'handed_off'].includes(state) &&
        received_bytes !== Number(row.total_bytes))
    )
      return res.status(400).json({ code: 'INVALID_DOWNLOAD_PROGRESS' });
    // A late retry/progress event cannot resurrect a task the customer cancelled.
    if (
      (['cancelled', 'handed_off'].includes(row.state) &&
        state !== row.state) ||
      (row.state === 'version_changed' &&
        !['cancelled', 'version_changed'].includes(state))
    )
      return res.status(409).json({ code: 'DOWNLOAD_TASK_TERMINAL' });
    const updated = await scoped(req)
      .where('id', row.id)
      .where('state', row.state)
      .where('received_bytes', '<=', received_bytes)
      .update({ state, received_bytes, updated_at: new Date().toISOString() });
    if (!updated)
      return res.status(409).json({ code: 'DOWNLOAD_PROGRESS_CONFLICT' });
    return res.json(serialize(await scoped(req).where('id', row.id).first()));
  } catch (error) {
    return failure(res, error);
  }
});
module.exports = router;
