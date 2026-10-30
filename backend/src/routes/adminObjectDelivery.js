const express = require('express');
const { body, validationResult } = require('express-validator');
const { db } = require('../database/db');
const { adminAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { requireEventOwnership } = require('../middleware/ownership');
const delivery = require('../services/objectDeliveryService');
const { parseBooleanInput } = require('../utils/parsers');

const router = express.Router();

router.get('/:id/object-delivery', adminAuth, requirePermission(['events.view', 'events.edit']), requireEventOwnership, async (req, res) => {
  try {
    const [status, config] = await Promise.all([
      delivery.getProjectStatus(req.params.id),
      delivery.getObjectStorageConfig(),
    ]);
    res.json({
      ...status,
      storageConfigured: delivery.isConfigured(config),
      storageEnabled: config.enabled,
    });
  } catch (error) {
    res.status(500).json({ error: '读取项目云端交付状态失败' });
  }
});

router.patch('/:id/object-delivery', adminAuth, requirePermission('events.edit'), requireEventOwnership, [
  body('cloud_sync_enabled').optional().isBoolean().toBoolean(),
  body('force_cloud_downloads').optional().isBoolean().toBoolean(),
  body('cloud_thumbnail_sync_enabled').optional().isBoolean().toBoolean(),
  body('cloud_preview_sync_enabled').optional().isBoolean().toBoolean(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: '设置值必须为 true 或 false' });
    const eventId = Number(req.params.id);
    const current = await db('events').where({ id: eventId }).first();
    if (!current) return res.status(404).json({ error: '项目不存在' });
    if (current.is_archived || current.is_archiving) return res.status(409).json({ code: 'PROJECT_ARCHIVED', error: '归档项目不能修改云端交付设置' });
    const nextSync = req.body.cloud_sync_enabled === undefined ? parseBooleanInput(current.cloud_sync_enabled, false) : req.body.cloud_sync_enabled;
    const disablingSync = req.body.cloud_sync_enabled === false && req.body.force_cloud_downloads === undefined;
    const nextForce = disablingSync
      ? false
      : (req.body.force_cloud_downloads === undefined ? parseBooleanInput(current.force_cloud_downloads, false) : req.body.force_cloud_downloads);
    if (nextForce && !nextSync) return res.status(409).json({ code: 'CLOUD_SYNC_REQUIRED', error: '强制云端下载需要先启用本项目的自动云端同步' });
    const enablingSync = req.body.cloud_sync_enabled === true && !parseBooleanInput(current.cloud_sync_enabled, false);
    const enablingForce = req.body.force_cloud_downloads === true && !parseBooleanInput(current.force_cloud_downloads, false);
    const derivativeKinds = require('../services/cloudGalleryAssetService').ASSET_KINDS;
    const enablingThumbnailSync = req.body.cloud_thumbnail_sync_enabled === true && !parseBooleanInput(current.cloud_thumbnail_sync_enabled, false);
    const enablingPreviewSync = req.body.cloud_preview_sync_enabled === true && !parseBooleanInput(current.cloud_preview_sync_enabled, false);
    if (enablingSync || enablingForce || enablingThumbnailSync || enablingPreviewSync) {
      const config = await delivery.getObjectStorageConfig();
      if (!config.enabled || !delivery.isConfigured(config)) {
        return res.status(409).json({ code: 'OBJECT_STORAGE_NOT_READY', error: '请先在设置中启用并完成对象存储配置' });
      }
    }
    const update = {};
    if (req.body.cloud_sync_enabled !== undefined) update.cloud_sync_enabled = req.body.cloud_sync_enabled;
    if (req.body.force_cloud_downloads !== undefined) update.force_cloud_downloads = req.body.force_cloud_downloads;
    else if (disablingSync) update.force_cloud_downloads = false;
    if (req.body.cloud_thumbnail_sync_enabled !== undefined) update.cloud_thumbnail_sync_enabled = req.body.cloud_thumbnail_sync_enabled;
    if (req.body.cloud_preview_sync_enabled !== undefined) update.cloud_preview_sync_enabled = req.body.cloud_preview_sync_enabled;
    let backfill = null;
    const needsDeliveredFinalScan = nextSync && (enablingSync || enablingForce);
    if (enablingSync) {
      // queueCurrentDeliveredFinals reads this persisted gate, so establish
      // auto-sync first. Forced download is saved only after the Bridge scan
      // succeeds and current delivered finals have durable queue rows.
      await db('events').where({ id: eventId }).update({ cloud_sync_enabled: true });
    }
    if (needsDeliveredFinalScan) {
      try { backfill = await delivery.queueCurrentDeliveredFinals(eventId); }
      catch (error) { backfill = { queued: 0, error: error.message }; }
    }
    const forceCloudBlocked = enablingForce && Boolean(backfill?.error);
    if (forceCloudBlocked) delete update.force_cloud_downloads;
    if (Object.keys(update).length) await db('events').where({ id: eventId }).update(update);
    const galleryBackfill = {};
    const galleryAssets = require('../services/cloudGalleryAssetService');
    if (enablingThumbnailSync) {
      try { galleryBackfill.thumbnail = await galleryAssets.queueProjectAssets(eventId, derivativeKinds.THUMBNAIL); }
      catch (error) { galleryBackfill.thumbnail = { queued: 0, error: error.message }; }
    }
    if (enablingPreviewSync) {
      try { galleryBackfill.preview = await galleryAssets.queueProjectAssets(eventId, derivativeKinds.PREVIEW); }
      catch (error) { galleryBackfill.preview = { queued: 0, error: error.message }; }
    }
    if (req.body.cloud_thumbnail_sync_enabled === false) await galleryAssets.pauseProjectAssets(eventId, derivativeKinds.THUMBNAIL);
    if (req.body.cloud_preview_sync_enabled === false) await galleryAssets.pauseProjectAssets(eventId, derivativeKinds.PREVIEW);
    res.json({ ...(await delivery.getProjectStatus(eventId)), backfill, galleryBackfill, forceCloudBlocked });
  } catch (error) {
    res.status(500).json({ error: '更新项目云端交付设置失败' });
  }
});

router.post('/:id/object-delivery/gallery-assets/rescan', adminAuth, requirePermission('events.edit'), requireEventOwnership, async (req, res) => {
  try {
    const event = await db('events').where({ id: Number(req.params.id) }).first();
    if (!event) return res.status(404).json({ error: '项目不存在' });
    if (event.is_archived || event.is_archiving) return res.status(409).json({ code: 'PROJECT_ARCHIVED', error: '归档项目不能扫描云端预览' });
    const assets = require('../services/cloudGalleryAssetService');
    const results = {};
    if (event.cloud_thumbnail_sync_enabled) results.thumbnail = await assets.queueProjectAssets(event.id, assets.ASSET_KINDS.THUMBNAIL);
    if (event.cloud_preview_sync_enabled) results.preview = await assets.queueProjectAssets(event.id, assets.ASSET_KINDS.PREVIEW);
    if (!Object.keys(results).length) return res.status(409).json({ code: 'GALLERY_CLOUD_SYNC_DISABLED', error: '请先启用缩略图或预览图云端同步' });
    if (Object.values(results).some((result) => result.error === 'OBJECT_STORAGE_NOT_READY')) {
      return res.status(409).json({ code: 'OBJECT_STORAGE_NOT_READY', error: '请先在系统设置中启用并配置对象存储。' });
    }
    res.json({ galleryBackfill: results, ...(await delivery.getProjectStatus(event.id)) });
  } catch (_error) {
    res.status(500).json({ error: '扫描云端缩略图和预览图失败' });
  }
});

router.post('/:id/object-delivery/gallery-assets/retry', adminAuth, requirePermission('events.edit'), requireEventOwnership, async (req, res) => {
  try {
    const event = await db('events').where({ id: Number(req.params.id) }).first();
    if (!event) return res.status(404).json({ error: '项目不存在' });
    if (event.is_archived || event.is_archiving) return res.status(409).json({ code: 'PROJECT_ARCHIVED', error: '归档项目不能重新同步' });
    const kind = ['thumbnail', 'preview', 'hero'].includes(req.body?.kind) ? req.body.kind : undefined;
    const retried = await require('../services/cloudGalleryAssetService').retryFailed(event.id, kind);
    res.json({ retried: Number(retried) || 0, ...(await delivery.getProjectStatus(event.id)) });
  } catch (_error) {
    res.status(500).json({ error: '重试云端缩略图和预览图失败' });
  }
});

router.post('/:id/object-delivery/rescan', adminAuth, requirePermission('events.edit'), requireEventOwnership, async (req, res) => {
  try {
    const event = await db('events').where({ id: Number(req.params.id) }).first();
    if (!event) return res.status(404).json({ error: '项目不存在' });
    if (event.is_archived || event.is_archiving) return res.status(409).json({ code: 'PROJECT_ARCHIVED', error: '归档项目不能扫描同步' });
    const result = await delivery.queueCurrentDeliveredFinals(req.params.id);
    if (result.error === 'OBJECT_STORAGE_NOT_READY') return res.status(409).json({ code: result.error, error: '请先在系统设置中启用并配置对象存储。' });
    if (result.error) return res.status(503).json({ code: 'CLOUD_SYNC_BACKFILL_FAILED', error: '读取精修成片状态失败，请确认 Bridge 在线后重试。' });
    res.json({ ...result, ...(await delivery.getProjectStatus(req.params.id)) });
  } catch (error) {
    res.status(500).json({ error: '扫描现有精修成片失败' });
  }
});

router.post('/:id/object-delivery/retry', adminAuth, requirePermission('events.edit'), requireEventOwnership, async (req, res) => {
  try {
    const event = await db('events').where({ id: Number(req.params.id) }).first();
    if (!event) return res.status(404).json({ error: '项目不存在' });
    if (event.is_archived || event.is_archiving) return res.status(409).json({ code: 'PROJECT_ARCHIVED', error: '归档项目不能重新同步' });
    if (!event.cloud_sync_enabled) return res.status(409).json({ code: 'CLOUD_SYNC_DISABLED', error: '请先启用本项目的自动云端同步' });
    const count = await delivery.retryFailed(req.params.id);
    res.json({ retried: Number(count) || 0, ...(await delivery.getProjectStatus(req.params.id)) });
  } catch (error) {
    res.status(500).json({ error: '重试云端同步失败' });
  }
});

router.delete('/:id/object-delivery/cloud-copies', adminAuth, requirePermission('events.archive'), requireEventOwnership, async (req, res) => {
  try {
    const event = await db('events').where({ id: Number(req.params.id) }).first();
    if (!event) return res.status(404).json({ error: '项目不存在' });
    if (!event.is_archived || event.is_archiving) return res.status(409).json({ code: 'PROJECT_NOT_ARCHIVED', error: '请先完成项目归档，再删除云端副本' });
    // The service fences both queues, waits for uploads that were already in
    // flight, removes remote objects, and only then drops the durable rows.
    const deleted = await delivery.deleteProjectCopies(event.id);
    res.json({ success: true, deleted });
  } catch (error) {
    res.status(error.status || 502).json({ code: error.code || 'CLOUD_DELETE_FAILED', error: error.message || '删除云端照片失败' });
  }
});

module.exports = router;
