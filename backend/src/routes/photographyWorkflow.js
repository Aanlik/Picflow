// Picflow admin proxy for the private Bridge workflow API. The browser only
// talks to Picflow; Bridge listens on container-local loopback.
const express = require('express');
const path = require('path');
const { requireEventOwnership, scopeEventsListQuery } = require('../middleware/ownership');
const { adminAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { db, logActivity } = require('../database/db');
const { bridgeRequest, getProjectDetail, setWorkflowStage } = require('../services/photographyWorkflowBridge');
const { getExternalMediaRoot, resolveExternalPath } = require('../services/externalMediaService');
const { parseBooleanInput } = require('../utils/parsers');

const router = express.Router();
router.use(adminAuth, requirePermission('events.view'));

function parseId(value) {
  return /^\d+$/.test(String(value)) && Number(value) > 0;
}

async function rejectArchivedEvent(req, res) {
  const event = await db('events').where({ id: Number(req.params.eventId) }).first();
  if (!event) {
    res.sendStatus(404);
    return true;
  }
  const archived = parseBooleanInput(event.is_archived, false);
  const archiving = parseBooleanInput(event.is_archiving, false);
  if (archived || archiving) {
    res.status(409).json({ error: '已归档的项目不能执行同步操作，请先恢复项目', code: 'EVENT_ARCHIVED' });
    return true;
  }
  return false;
}

function bridgeFailure(result) {
  if (!result.configured) {
    return { code: 'BRIDGE_NOT_CONFIGURED', error: '尚未连接精修同步服务' };
  }
  if (result.errorCode === 'BRIDGE_TIMEOUT') {
    return { code: 'BRIDGE_TIMEOUT', error: '精修同步服务响应超时，请稍后重试' };
  }
  if (result.errorCode === 'BRIDGE_UNREACHABLE') {
    return { code: 'BRIDGE_UNREACHABLE', error: '无法连接精修同步服务，请检查容器运行状态和内部地址' };
  }
  return { code: 'BRIDGE_ERROR', error: '精修同步服务暂时不可用' };
}

function cameraSubdirectory(event) {
  if (!event || event.source_mode !== 'reference' || !event.external_path) return null;
  try {
    const cameraRoot = path.resolve(getExternalMediaRoot(), 'Camera');
    const eventRoot = path.resolve(resolveExternalPath(event, ''));
    const relative = path.relative(cameraRoot, eventRoot);
    if (!relative || relative === '.' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    const parts = relative.split(path.sep);
    if (parts.some((part) => part.toLocaleLowerCase() === 'pixcakedelivery')) return null;
    // Picflow references the proof folder so clients see JPG previews, while
    // Bridge must index RAW files from its sibling directory. Keep the
    // standard Camera/<project>/01_RAW + 02_PROOF layout connected correctly.
    if (parts[parts.length - 1]?.toLocaleLowerCase() === '02_proof') {
      parts[parts.length - 1] = '01_RAW';
    }
    return parts.join('/');
  } catch {
    return null;
  }
}

router.get('/summary', async (req, res) => {
  const result = await bridgeRequest('/api/projects');
  if (!result.configured) return res.json({ configured: false, error: bridgeFailure(result), projects: [] });
  if (result.status !== 200) return res.status(503).json(bridgeFailure(result));
  // Use Picflow's event list as the source of truth for display names and
  // ordering. Bridge stores the name captured when a project was first bound,
  // so renames and event-id order can otherwise make the dashboard disagree
  // with the upstream project list.
  const accessibleEvents = await scopeEventsListQuery(
    db('events').select('id', 'event_name', 'created_at'),
    req.admin,
  ).orderBy('created_at', 'desc');
  const bridgeProjects = new Map(
    (Array.isArray(result.data) ? result.data : []).map((project) => [Number(project.event_id), project]),
  );
  const projects = accessibleEvents.flatMap((event) => {
    const project = bridgeProjects.get(Number(event.id));
    return project ? [{ ...project, name: event.event_name || project.name }] : [];
  });
  res.json({ configured: true, projects });
});

router.get('/:eventId', (req, res, next) => parseId(req.params.eventId) ? next() : res.sendStatus(400), requireEventOwnership, async (req, res) => {
  const event = await db('events').where({ id: Number(req.params.eventId) }).first();
  if (!event) return res.sendStatus(404);
  const projectArchived = parseBooleanInput(event.is_archived, false) || parseBooleanInput(event.is_archiving, false);
  const result = await getProjectDetail(req.params.eventId);
  if (!result.configured) return res.status(503).json({ ...bridgeFailure(result), project_archived: projectArchived });
  if (result.status === 404) {
    const suggestedRawSubdir = cameraSubdirectory(event);
    const mountStatus = suggestedRawSubdir
      ? await bridgeRequest(`/api/projects/${Number(req.params.eventId)}/mount-status?raw_subdir=${encodeURIComponent(suggestedRawSubdir)}`)
      : null;
    const autoBindAvailable = Boolean(mountStatus?.status === 200 && mountStatus.data?.writable_mount_ready);
    return res.json({
      configured: false,
      auto_bind_available: autoBindAvailable,
      auto_bind_mount_missing: Boolean(suggestedRawSubdir && !autoBindAvailable),
      suggested_raw_subdir: suggestedRawSubdir,
      project_name: event?.event_name || event?.slug || '',
      project_archived: projectArchived,
    });
  }
  if (result.status !== 200) return res.status(503).json(bridgeFailure(result));
  // Keep withdrawn deliveries in the cancellation bucket so the photographer
  // does not see a photo in both "delivered" and "cancelled". When the guest
  // keeps the retouched file it remains on NAS, but is back in the proof queue.
  const photos = Array.isArray(result.data?.photos)
    ? result.data.photos.map((photo) => ({
      ...photo,
      cancelled: Boolean(photo.cancelled || photo.selection_cancelled || photo.withdraw_pending),
    }))
    : result.data?.photos;
  res.json({ ...result.data, photos, configured: true, project_archived: projectArchived });
});

router.get('/:eventId/requests', (req, res, next) => parseId(req.params.eventId) ? next() : res.sendStatus(400), requireEventOwnership, async (req, res) => {
  try {
    const rows = await db('photo_retouch_requests as r')
      .join('photos as p', 'p.id', 'r.photo_id')
      .where('r.event_id', Number(req.params.eventId))
      .select('r.id', 'r.photo_id', 'p.filename', 'p.original_filename', 'p.source_filename', 'r.guest_name', 'r.request_type', 'r.base_version', 'r.target_version', 'r.delivery_folder', 'r.customer_message', 'r.status', 'r.photographer_reply', 'r.created_at', 'r.updated_at')
      .orderBy('r.created_at', 'desc');
    res.json({ requests: rows });
  } catch {
    res.status(500).json({ error: '无法读取客户精修需求' });
  }
});

router.post('/:eventId/auto-bind', requirePermission('events.edit'), (req, res, next) => parseId(req.params.eventId) ? next() : res.sendStatus(400), requireEventOwnership, async (req, res) => {
  if (await rejectArchivedEvent(req, res)) return;
  const eventId = Number(req.params.eventId);
  const event = await db('events').where({ id: eventId }).first();
  const rawSubdir = cameraSubdirectory(event);
  if (!rawSubdir) return res.status(400).json({ error: '此项目未引用 Camera 下的 NAS 文件夹，无法自动挂载精修目录' });
  const name = String(event.event_name || event.slug || '').trim();
  if (!name) return res.status(400).json({ error: '项目名称为空，无法自动绑定' });

  const result = await bridgeRequest('/projects', {
    method: 'POST', form: true,
    body: { name, event_id: eventId, raw_subdir: rawSubdir, auto_mount: 'true' },
  });
  if (!result.configured) return res.status(503).json({ error: '尚未连接精修同步服务' });
  if (result.status !== 303) return res.status(503).json({ error: 'Bridge 暂时无法创建项目目录' });
  const location = new URL(result.location || '/', 'http://bridge.local');
  const setupError = location.searchParams.get('setup_error');
  if (setupError) return res.status(400).json({ error: setupError });
  // Creating the binding alone leaves `connected=false` until an operator
  // presses Sync. Run the initial snapshot as part of auto-bind so the first
  // status shown in the workflow card reflects the actual NAS/Picflow link.
  const initialSync = await bridgeRequest(`/api/projects/${eventId}/sync`, { method: 'POST', body: {} });
  if (initialSync.status !== 200) {
    return res.status(503).json({ error: '项目已关联，但首次同步未完成；请检查 NAS 文件夹并重试同步' });
  }
  const detail = await getProjectDetail(eventId);
  if (detail.status !== 200) return res.status(503).json({ error: '项目已创建，但暂时无法读取同步状态' });
  res.status(201).json({ ...detail.data, configured: true });
});

router.post('/:eventId/stage', requirePermission('events.edit'), (req, res, next) => parseId(req.params.eventId) ? next() : res.sendStatus(400), requireEventOwnership, async (req, res) => {
  if (!['SELECTING', 'EDITING', 'DELIVERED', 'ARCHIVED'].includes(req.body?.stage)) return res.status(400).json({ error: '无效的项目阶段' });
  const event = await db('events').where({ id: Number(req.params.eventId) }).first();
  if (!event) return res.sendStatus(404);
  if (parseBooleanInput(event.is_archived, false) || parseBooleanInput(event.is_archiving, false)) {
    return res.status(409).json({ error: '已归档的项目不能直接更改阶段，请先恢复项目' });
  }
  const result = await setWorkflowStage(Number(req.params.eventId), req.body.stage);
  if (result.status !== 200) return res.status(result.status === 400 ? 400 : 503).json({ error: '无法更新项目阶段' });
  res.json(result.data);
});

router.post('/:eventId/sync', requirePermission('events.edit'), (req, res, next) => parseId(req.params.eventId) ? next() : res.sendStatus(400), requireEventOwnership, async (req, res) => {
  if (await rejectArchivedEvent(req, res)) return;
  const result = await bridgeRequest(`/api/projects/${Number(req.params.eventId)}/sync`, { method: 'POST', body: {} });
  if (result.status !== 200) return res.status(503).json({ error: '无法立即同步项目' });
  res.json(result.data);
});

// Recovery is owned by the same project editor as sync; Bridge validates
// current remote presence and confines all chosen files to this project.
for (const method of ['get', 'post']) {
  router[method]('/:eventId/photos/:photoId/recovery', requirePermission('events.edit'), (req, res, next) => {
    if (parseId(req.params.eventId) && parseId(req.params.photoId)) return next();
    return res.sendStatus(400);
  }, requireEventOwnership, async (req, res) => {
    if (await rejectArchivedEvent(req, res)) return;
    const result = await bridgeRequest(`/api/projects/${Number(req.params.eventId)}/photos/${Number(req.params.photoId)}/recovery`, {
      method: method.toUpperCase(), ...(method === 'post' ? { body: req.body } : {}),
    });
    if (result.status !== 200) {
      const detail = result.data?.detail;
      return res.status([400, 404, 409].includes(result.status) ? result.status : 503)
        .json({ error: typeof detail === 'string' ? detail : '无法处理照片映射，请检查精修服务连接' });
    }
    return res.json(result.data);
  });
}

router.post('/:eventId/rescan', requirePermission('events.edit'), (req, res, next) => parseId(req.params.eventId) ? next() : res.sendStatus(400), requireEventOwnership, async (req, res) => {
  if (await rejectArchivedEvent(req, res)) return;
  const result = await bridgeRequest(`/api/projects/${Number(req.params.eventId)}/rescan`, { method: 'POST', body: {} });
  if (result.status !== 200) return res.status(503).json({ error: '无法重新扫描项目目录' });
  res.json(result.data);
});

router.post('/:eventId/retry', requirePermission('events.edit'), (req, res, next) => parseId(req.params.eventId) ? next() : res.sendStatus(400), requireEventOwnership, async (req, res) => {
  if (await rejectArchivedEvent(req, res)) return;
  const result = await bridgeRequest(`/api/projects/${Number(req.params.eventId)}/retry`, {
    method: 'POST', body: { confirm_unknown: req.body?.confirm_unknown === true },
  });
  if (result.status === 409) return res.status(409).json(result.data?.detail || result.data || { code: 'UNKNOWN_CONFIRMATION_REQUIRED' });
  if (result.status !== 200) return res.status(503).json({ error: '无法重试失败任务' });
  res.json(result.data);
});

router.patch('/:eventId/requests/:requestId', requirePermission('events.edit'), (req, res, next) => {
  if (parseId(req.params.eventId) && parseId(req.params.requestId)) return next();
  return res.sendStatus(400);
}, requireEventOwnership, async (req, res) => {
  const allowed = ['open', 'in_progress', 'waiting_customer', 'completed', 'closed', 'cancelled'];
  const status = req.body?.status;
  const reply = typeof req.body?.photographer_reply === 'string' ? req.body.photographer_reply.trim().slice(0, 1000) : '';
  if (!allowed.includes(status)) return res.status(400).json({ error: '无效的需求状态' });
  const id = Number(req.params.requestId);
  const eventId = Number(req.params.eventId);
  const request = await db('photo_retouch_requests').where({ id, event_id: eventId }).first();
  if (!request) return res.sendStatus(404);
  const nextReply = reply || null;
  const currentReply = typeof request.photographer_reply === 'string'
    ? request.photographer_reply.trim().slice(0, 1000) || null
    : null;
  if (request.status === status && currentReply === nextReply) {
    return res.status(400).json({ error: '没有需要保存的变更', code: 'NO_CHANGE' });
  }
  await db('photo_retouch_requests').where({ id, event_id: eventId }).update({
    status,
    photographer_reply: nextReply,
    updated_at: new Date(),
  });
  await logActivity('photo_retouch_request_updated', { request_id: id, status }, eventId, { type: 'admin', id: req.admin.id, name: req.admin.username || 'admin' });
  const updated = await db('photo_retouch_requests').where({ id }).first();
  res.json({ request: updated });
});

module.exports = router;
