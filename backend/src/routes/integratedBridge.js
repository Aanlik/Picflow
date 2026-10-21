const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { db, logActivity } = require('../database/db');
const { requirePermission } = require('../middleware/permissions');
const { integratedBridgeAuth } = require('../middleware/integratedBridgeAuth');
const { replacePhoto } = require('../services/photoReplacementService');
const { PhotoExportService } = require('../services/photoExportService');
const { mergeMarks } = require('../services/markMerge');
const { getMaxFileSizeBytes, DEFAULT_MAX_FILE_SIZE_MB } = require('../services/uploadSettings');
const { getStorage } = require('../services/storage');
const { resolvePhotoStorageKey } = require('../services/photoResolver');
const downloadZipService = require('../services/downloadZipService');
const logger = require('../utils/logger');

const { normalizeMultipartFilename } = require('../utils/normalizeMultipartFilename');

const router = express.Router();
const photoExportService = new PhotoExportService();
const getStoragePath = () => process.env.STORAGE_PATH || path.join(__dirname, '../../../storage');

const uploadStorage = multer.diskStorage({
  destination: async (_req, _file, callback) => {
    const tempDir = path.join(getStoragePath(), 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    callback(null, tempDir);
  },
  filename: (_req, file, callback) => {
    callback(null, `bridge_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname)}`);
  },
});

async function receiveReplacement(req, res, next) {
  let limit = DEFAULT_MAX_FILE_SIZE_MB * 1024 * 1024;
  try { limit = await getMaxFileSizeBytes(); } catch { /* use configured default */ }
  multer({
    storage: uploadStorage,
    limits: { fileSize: limit, files: 1, fields: 2 },
    fileFilter: (_req, file, callback) => {
      file.originalname = normalizeMultipartFilename(file.originalname);
      if (/^image\//.test(file.mimetype)) callback(null, true);
      else callback(new Error('仅支持上传图片'));
    },
  }).single('photo')(req, res, (error) => {
    if (error?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '精修文件超过大小限制' });
    next(error);
  });
}

router.get('/events/:id/photos', integratedBridgeAuth, requirePermission('photos.view'), async (req, res) => {
  try {
    const eventId = Number.parseInt(req.params.id, 10);
    const event = await db('events').where({ id: eventId }).first();
    if (!event) return res.status(404).json({ error: '项目不存在' });
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const [rows, totalRow] = await Promise.all([
      db('photos').where({ event_id: eventId }).select('id').orderBy('filename', 'asc').limit(limit).offset((page - 1) * limit),
      db('photos').where({ event_id: eventId }).count('id as count').first(),
    ]);
    const ids = rows.map((row) => row.id);
    const photos = ids.length ? await photoExportService.getPhotosWithFeedback(eventId, ids, req.admin.id) : [];
    const selection = await require('../services/retouchSelectionService').getBridgeSelectionState(eventId, ids);
    // Only local, guest-uploaded image originals can be materialized by the
    // integrated Bridge. Return a relative storage key, never an absolute host
    // path; Bridge constrains it beneath its configured Picflow storage root.
    let localStorage = false;
    try { localStorage = getStorage().kind() === 'local'; } catch { /* Storage may be remote or unavailable. */ }
    const total = Number.parseInt(totalRow?.count, 10) || 0;
    return res.json({
      photos: photos.map((photo) => {
        const clientMarks = mergeMarks(photo, 'client');
        const ext = path.extname(photo.source_filename || photo.original_filename || photo.filename || '').toLowerCase();
        const isManagedImage = localStorage
          && photo.source_origin === 'managed'
          && (photo.media_type === 'image' || String(photo.mime_type || '').startsWith('image/'))
          && !['.arw', '.cr3', '.cr2', '.nef', '.raf', '.dng', '.orf', '.rw2'].includes(ext);
        let uploadSourceKey = null;
        if (isManagedImage) {
          try { uploadSourceKey = resolvePhotoStorageKey(event, photo); } catch { /* A malformed row is reported as an unmapped source by Bridge. */ }
        }
        return {
          id: photo.id,
          filename: photo.filename,
          original_filename: photo.original_filename || null,
          source_filename: photo.source_filename || photo.original_filename || photo.filename || null,
          upload_source_key: photo.uploaded_by && photo.uploaded_by !== 'admin' ? uploadSourceKey : null,
          fallback_source_key: uploadSourceKey,
          average_rating: photo.average_rating ? Number.parseFloat(photo.average_rating) : 0,
          feedback_count: photo.feedback_count || 0,
          like_count: photo.like_count || 0,
          favorite_count: photo.favorite_count || 0,
          comment_count: photo.comment_count || 0,
          color_labels: photo.color_labels || {},
          dominant_color_label: photo.dominant_color_label || null,
          my_rating: photo.my_rating ?? null,
          my_color_label: photo.my_color_label || null,
          color_label: clientMarks.color_label,
          retouch_selected: selection.get(Number(photo.id)) ?? null,
          rating: clientMarks.rating,
          width: photo.width || null,
          height: photo.height || null,
          uploaded_at: photo.uploaded_at || null,
        };
      }),
      pagination: { page, limit, total, filtered: total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    logger.error('Integrated Bridge photo read failed', { error: error.message });
    return res.status(500).json({ error: '读取项目照片失败' });
  }
});

router.post('/events/:id/photos', integratedBridgeAuth, requirePermission('photos.upload'), receiveReplacement, async (req, res) => {
  const tempPath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ error: '缺少精修文件' });
    const eventId = Number.parseInt(req.params.id, 10);
    const photoId = Number.parseInt(req.body?.replaces_photo_id, 10);
    if (!Number.isSafeInteger(photoId) || photoId < 1) return res.status(400).json({ error: '替换照片编号无效' });
    const event = await db('events').where({ id: eventId }).first();
    if (!event) return res.status(404).json({ error: '项目不存在' });
    if (event.is_archived || event.is_archiving) return res.status(409).json({ error: '已归档项目不能同步成片' });
    const target = await db('photos').where({ id: photoId, event_id: eventId }).first();
    if (!target) return res.status(404).json({ error: '项目中不存在要替换的照片' });
    const result = await replacePhoto(target, tempPath, {
      originalFilename: req.file.originalname,
      mimeType: req.file.mimetype,
      event,
    });
    if (!result.success) return res.status(500).json({ error: '替换精修照片失败' });
    downloadZipService.invalidate(eventId);
    await logActivity('photo_replaced', {
      photoId: result.photo.id,
      originalFilename: req.file.originalname,
      previousFilename: result.previousFilename,
      eventName: event.event_name,
      via: 'integrated_bridge',
    }, eventId, { type: 'admin', id: req.admin.id, name: req.admin.username });
    return res.status(200).json({
      replaced: true,
      photo: {
        id: result.photo.id,
        filename: result.photo.filename,
        original_filename: result.photo.original_filename,
        source_filename: result.photo.source_filename,
        previous_filename: result.previousFilename,
        size_bytes: result.photo.size_bytes,
        width: result.photo.width,
        height: result.photo.height,
      },
    });
  } catch (error) {
    logger.error('Integrated Bridge photo replacement failed', { error: error.message });
    return res.status(500).json({ error: '同步精修照片失败' });
  } finally {
    if (tempPath) await fs.unlink(tempPath).catch(() => {});
  }
});

module.exports = router;
