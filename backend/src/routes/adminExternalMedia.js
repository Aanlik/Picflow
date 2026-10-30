const express = require('express');
const { adminAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { requireEventOwnership } = require('../middleware/ownership');
const { list } = require('../services/externalMediaService');
const logger = require('../utils/logger');
const sources = require('../services/externalMediaSources');
const { db } = require('../database/db');
const { syncBoundProjectRawSources } = require('../services/externalMediaBridgeSources');
const {
  importExternalFolder,
  ImportInProgressError,
  EventNotFoundError,
} = require('../services/externalImportService');

const router = express.Router();

// GET /api/admin/external-media/list?path=relative/dir
router.get('/list', adminAuth, requirePermission('photos.view'), async (req, res) => {
  try {
    const relPath = (req.query.path || '').replace(/^\/+/, '');
    const result = await list(relPath);
    res.json(result);
  } catch (error) {
    logger.warn('Invalid external media path requested', {
      path: req.query.path,
      error: error.message,
      code: error.code,
    });
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      return res.status(403).json({ code: 'EXTERNAL_FOLDER_PERMISSION_DENIED', error: 'NAS folder is not readable by the Picflow process' });
    }
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return res.status(404).json({ code: 'EXTERNAL_FOLDER_NOT_FOUND', error: 'NAS folder does not exist or is not mounted' });
    }
    if (error.code === 'PATH_OUTSIDE_BASE' || error.message === 'Path traversal attempt detected') {
      return res.status(400).json({ code: 'EXTERNAL_FOLDER_INVALID_PATH', error: 'Invalid external media path' });
    }
    return res.status(500).json({ code: 'EXTERNAL_FOLDER_READ_FAILED', error: 'Unable to read the NAS folder' });
  }
});

router.get('/events/:id/sources', adminAuth, requirePermission('photos.view'), requireEventOwnership, async (req, res) => {
  const eventId = Number(req.params.id);
  try {
    const rows = await sources.listSources(eventId);
    const result = await Promise.all(rows.map(async (row) => {
      const [{ count }] = await db('photos').where({ event_id: eventId, external_source_id: row.id }).count('* as count');
      return { ...row, photo_count: Number(count) || 0 };
    }));
    const [{ count: unlinkedCount }] = await db('photos').where({ event_id: eventId }).whereNotNull('external_relpath').whereNull('external_source_id').count('* as count');
    res.json({ sources: result, root_id: sources.DEFAULT_ROOT_ID, unlinked_photo_count: Number(unlinkedCount) || 0 });
  } catch (error) {
    logger.error('Could not list external media sources', { eventId, error: error.message });
    res.status(500).json({ error: 'Could not list material folders' });
  }
});

router.post('/events/:id/sources', adminAuth, requirePermission('photos.upload'), requireEventOwnership, async (req, res) => {
  const eventId = Number(req.params.id);
  try {
    const source = await sources.addSource({
      eventId,
      rootId: req.body?.root_id || sources.DEFAULT_ROOT_ID,
      relativePath: req.body?.relative_path,
      purpose: req.body?.purpose || 'gallery',
      watchEnabled: req.body?.watch_enabled === true,
    });
    const bridgeSync = await syncBoundProjectRawSources(eventId).catch(() => null);
    // The caller scans this association immediately after creation. Let the
    // periodic watcher reconciliation attach it afterward; starting a watcher
    // here would race the explicit scan for the same source.
    res.status(201).json({ source, bridge_sync_warning: bridgeSync?.configured && !bridgeSync.ok && !bridgeSync.skipped });
  } catch (error) {
    const status = error.code === 'EVENT_NOT_FOUND' ? 404
      : ['INVALID_MATERIAL_PATH', 'UNKNOWN_MATERIAL_ROOT', 'MATERIAL_NOT_DIRECTORY', 'PATH_OUTSIDE_BASE'].includes(error.code) || error.message === 'Path traversal attempt detected' ? 400
        : ['ENOENT', 'ENOTDIR'].includes(error.code) ? 404
          : ['EACCES', 'EPERM'].includes(error.code) ? 403 : 500;
    res.status(status).json({ code: error.code || 'MATERIAL_SOURCE_CREATE_FAILED', error: error.message });
  }
});

router.patch('/events/:id/sources/:sourceId', adminAuth, requirePermission('photos.upload'), requireEventOwnership, async (req, res) => {
  try {
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'purpose')) updates.purpose = req.body.purpose;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'watch_enabled')) updates.watchEnabled = req.body.watch_enabled === true;
    const source = await sources.updateSource(Number(req.params.id), Number(req.params.sourceId), updates);
    if (!source) return res.sendStatus(404);
    const bridgeSync = Object.prototype.hasOwnProperty.call(updates, 'purpose')
      ? await syncBoundProjectRawSources(Number(req.params.id)).catch(() => null)
      : null;
    if (Object.prototype.hasOwnProperty.call(updates, 'watchEnabled')) {
      require('../services/externalMediaWatcher').reconcile().catch(() => {});
    }
    res.json({ source, bridge_sync_warning: bridgeSync?.configured && !bridgeSync.ok && !bridgeSync.skipped });
  } catch (error) {
    res.status(error.code === 'INVALID_MATERIAL_PURPOSE' ? 400 : 500)
      .json({ code: error.code || 'MATERIAL_SOURCE_UPDATE_FAILED', error: error.message });
  }
});

router.post('/events/:id/sources/:sourceId/scan', adminAuth, requirePermission('photos.upload'), requireEventOwnership, async (req, res) => {
  const eventId = Number(req.params.id);
  const sourceId = Number(req.params.sourceId);
  try {
    const source = await sources.getSource(eventId, sourceId);
    if (!source) return res.sendStatus(404);
    const result = await importExternalFolder({
      eventId,
      sourceId,
      recursive: true,
      actor: { type: 'admin', id: req.admin?.id, name: req.admin?.username },
    });
    // Attach a newly enabled watcher immediately after the manual scan has
    // released its source-scoped import claim; do not launch a duplicate pass.
    await require('../services/externalMediaWatcher').reconcile({ scanFreshSources: false }).catch((error) => {
      logger.warn('Could not attach external media watcher after manual scan', { eventId, sourceId, error: error.message });
    });
    res.json({ source: await sources.getSource(eventId, sourceId), result });
  } catch (error) {
    if (error instanceof ImportInProgressError) return res.status(409).json({ code: 'MATERIAL_SCAN_IN_PROGRESS', error: error.message });
    if (error.code === 'PATH_OUTSIDE_BASE' || error.code === 'INVALID_MATERIAL_PATH') return res.status(400).json({ code: error.code, error: 'Invalid material folder path' });
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      await sources.setScanState(sourceId, { status: 'error', error: 'Folder is missing or unavailable' }).catch(() => {});
      return res.status(404).json({ code: 'MATERIAL_FOLDER_UNAVAILABLE', error: 'Material folder is missing or unavailable' });
    }
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      await sources.setScanState(sourceId, { status: 'error', error: 'Folder is not readable' }).catch(() => {});
      return res.status(403).json({ code: 'MATERIAL_FOLDER_PERMISSION_DENIED', error: 'Material folder is not readable' });
    }
    logger.error('External media source scan failed', { eventId, sourceId, error: error.message });
    res.status(500).json({ code: 'MATERIAL_SCAN_FAILED', error: 'Material folder scan failed' });
  }
});

router.post('/events/:id/sources/:sourceId/deactivate', adminAuth, requirePermission('photos.upload'), requireEventOwnership, async (req, res) => {
  const eventId = Number(req.params.id);
  const source = await sources.deactivateSource(eventId, Number(req.params.sourceId));
  if (!source) return res.sendStatus(404);
  const bridgeSync = await syncBoundProjectRawSources(eventId).catch(() => null);
  require('../services/externalMediaWatcher').reconcile().catch(() => {});
  res.json({ source, bridge_sync_warning: bridgeSync?.configured && !bridgeSync.ok && !bridgeSync.skipped });
});

// POST /api/admin/events/:id/import-external
// Body: { external_path: string, recursive?: boolean, map?: { individual?: string, collages?: string } }
//
// The import itself lives in services/externalImportService.js so the folder
// watcher (issue 1187) runs the identical pass without an HTTP request. This
// handler only validates, maps the service's errors to status codes, and
// records who asked.
router.post('/events/:id/import-external', adminAuth, requirePermission('photos.upload'), requireEventOwnership, async (req, res) => {
  const eventId = parseInt(req.params.id);
  const { external_path, recursive = true, map = { individual: 'individual', collages: 'collages' } } = req.body || {};
  if (!external_path) return res.status(400).json({ error: 'external_path is required' });

  try {
    const source = await sources.addSource({
      eventId,
      relativePath: external_path,
      purpose: 'gallery',
      watchEnabled: false,
      preserveExisting: true,
    });
    await syncBoundProjectRawSources(eventId).catch(() => null);
    const result = await importExternalFolder({
      eventId,
      sourceId: source.id,
      recursive,
      map,
      actor: { type: 'admin', id: req.admin?.id, name: req.admin?.username },
    });
    res.json(result);
  } catch (error) {
    if (error instanceof EventNotFoundError || error.code === 'EVENT_NOT_FOUND') {
      return res.status(404).json({ error: 'Event not found' });
    }
    if (error instanceof ImportInProgressError) {
      // Another run holds this event — a double-click, or the watcher on any
      // replica mid-pass. Say so rather than walking the tree a second time.
      return res.status(409).json({ error: error.message });
    }
    if (error.code === 'PATH_OUTSIDE_BASE' || error.code === 'INVALID_MATERIAL_PATH' || error.message === 'Path traversal attempt detected') {
      // A folder that is a symlink out of EXTERNAL_MEDIA_ROOT: the caller's
      // choice, not a server fault.
      return res.status(400).json({ error: 'Invalid external media path' });
    }
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return res.status(404).json({ error: 'NAS folder does not exist or is not mounted' });
    if (['EACCES', 'EPERM'].includes(error.code)) return res.status(403).json({ error: 'NAS folder is not readable by the Picflow process' });
    logger.error('External media import failed', {
      eventId: req.params.id,
      externalPath: req.body?.external_path,
      error: error.message
    });
    res.status(500).json({ error: 'Failed to import external media' });
  }
});

module.exports = router;
