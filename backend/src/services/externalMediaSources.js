const path = require('path');
const { db } = require('../database/db');
const { getExternalMediaRoot } = require('./externalMediaService');
const { safePathJoin, assertRealpathUnder } = require('../utils/fileSecurityUtils');
const { isUniqueViolation } = require('../utils/dbErrors');

const DEFAULT_ROOT_ID = 'default';
const PURPOSES = new Set(['gallery', 'raw', 'both']);

function normalizeRelativePath(value) {
  if (typeof value !== 'string') {
    throw Object.assign(new Error('Invalid material folder path'), { code: 'INVALID_MATERIAL_PATH' });
  }
  const input = value.trim();
  if (input.includes('\\') || input.includes('\0')
      || path.posix.isAbsolute(input) || path.win32.isAbsolute(input) || /^[A-Za-z]:/.test(input)) {
    throw Object.assign(new Error('Invalid material folder path'), { code: 'INVALID_MATERIAL_PATH' });
  }
  const trimmed = input.replace(/\/+$/g, '');
  if (!trimmed || trimmed === '.') {
    throw Object.assign(new Error('Choose a folder below the mounted material root'), { code: 'INVALID_MATERIAL_PATH' });
  }
  if (trimmed.split('/').some((part) => part === '..' || part === '.')) {
    throw Object.assign(new Error('Material folder path contains an invalid segment'), { code: 'INVALID_MATERIAL_PATH' });
  }
  if (trimmed.split('/').some((part) => part.toLocaleLowerCase() === 'pixcakedelivery')) {
    throw Object.assign(new Error('Delivery folders cannot be used as source material'), { code: 'INVALID_MATERIAL_PATH' });
  }
  const normalized = path.posix.normalize(trimmed);
  if (normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw Object.assign(new Error('Material folder must be relative to the mounted root'), { code: 'INVALID_MATERIAL_PATH' });
  }
  return normalized;
}

function resolveRoot(rootId = DEFAULT_ROOT_ID) {
  if (rootId !== DEFAULT_ROOT_ID) {
    throw Object.assign(new Error('Unsupported material root'), { code: 'UNKNOWN_MATERIAL_ROOT' });
  }
  return getExternalMediaRoot();
}

async function validateFolder(rootId, relativePath) {
  const root = resolveRoot(rootId);
  const target = safePathJoin(root, relativePath || '.');
  await assertRealpathUnder(root, target);
  const stat = await require('fs').promises.stat(target);
  if (!stat.isDirectory()) {
    throw Object.assign(new Error('Material path is not a directory'), { code: 'MATERIAL_NOT_DIRECTORY' });
  }
  return target;
}

async function listSources(eventId, { includeInactive = true } = {}) {
  const query = db('external_media_sources').where({ event_id: eventId }).orderBy('id', 'asc');
  if (!includeInactive) query.andWhere({ is_active: true });
  return query;
}

async function addSource({ eventId, rootId = DEFAULT_ROOT_ID, relativePath, purpose = 'gallery', watchEnabled = false, preserveExisting = false }) {
  if (!PURPOSES.has(purpose)) throw Object.assign(new Error('Invalid material purpose'), { code: 'INVALID_MATERIAL_PURPOSE' });
  const normalized = normalizeRelativePath(relativePath);
  await validateFolder(rootId, normalized);
  const event = await db('events').where({ id: eventId }).first();
  if (!event) throw Object.assign(new Error('Event not found'), { code: 'EVENT_NOT_FOUND' });
  const now = new Date().toISOString();
  const existing = await db('external_media_sources')
    .where({ event_id: eventId, root_id: rootId, relative_path: normalized })
    .first();
  if (existing) {
    // Re-adding an active folder is idempotent. Purpose and monitoring are
    // edited through PATCH so a repeated legacy import/add request cannot
    // silently reset another configuration choice.
    if (preserveExisting || Boolean(existing.is_active)) {
      if (!existing.is_active) {
        await db('external_media_sources').where({ id: existing.id }).update({
          is_active: true,
          status: existing.watch_enabled ? 'watching' : (existing.last_scanned_at ? 'ready' : 'pending'),
          updated_at: now,
        });
      }
      return db('external_media_sources').where({ id: existing.id }).first();
    }
    const update = { purpose, watch_enabled: Boolean(watchEnabled), is_active: true, updated_at: now };
    update.status = watchEnabled ? (existing.status === 'error' ? 'error' : 'watching')
      : (existing.last_scanned_at ? 'paused' : 'pending');
    await db('external_media_sources').where({ id: existing.id }).update(update);
    return db('external_media_sources').where({ id: existing.id }).first();
  }
  try {
    const ids = await db('external_media_sources').insert({
      event_id: eventId,
      root_id: rootId,
      relative_path: normalized,
      purpose,
      watch_enabled: Boolean(watchEnabled),
      status: watchEnabled ? 'watching' : 'pending',
      is_active: true,
      created_at: now,
      updated_at: now,
    }).returning('id');
    const id = ids[0]?.id ?? ids[0];
    return db('external_media_sources').where({ id }).first();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return db('external_media_sources')
      .where({ event_id: eventId, root_id: rootId, relative_path: normalized }).first();
  }
}

async function getSource(eventId, sourceId, { activeOnly = true } = {}) {
  const query = db('external_media_sources').where({ event_id: eventId, id: sourceId });
  if (activeOnly) query.andWhere({ is_active: true });
  return query.first();
}

async function updateSource(eventId, sourceId, updates = {}) {
  const source = await getSource(eventId, sourceId);
  if (!source) return null;
  const next = { updated_at: new Date().toISOString() };
  if (Object.prototype.hasOwnProperty.call(updates, 'purpose')) {
    if (!PURPOSES.has(updates.purpose)) throw Object.assign(new Error('Invalid material purpose'), { code: 'INVALID_MATERIAL_PURPOSE' });
    next.purpose = updates.purpose;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'watchEnabled')) {
    next.watch_enabled = Boolean(updates.watchEnabled);
    if (!source.last_scanned_at) next.status = next.watch_enabled ? 'watching' : 'pending';
    else if (!next.watch_enabled && source.status !== 'error') next.status = 'paused';
    else if (next.watch_enabled && ['paused', 'ready'].includes(source.status)) next.status = 'watching';
  }
  await db('external_media_sources').where({ id: sourceId, event_id: eventId }).update(next);
  return getSource(eventId, sourceId);
}

async function deactivateSource(eventId, sourceId) {
  const source = await getSource(eventId, sourceId);
  if (!source) return null;
  const referenced = await db('photos').where({ event_id: eventId, external_source_id: sourceId }).first();
  await db('external_media_sources').where({ id: sourceId, event_id: eventId }).update({
    is_active: false,
    watch_enabled: false,
    status: referenced ? 'inactive_referenced' : 'inactive',
    updated_at: new Date().toISOString(),
  });
  return getSource(eventId, sourceId, { activeOnly: false });
}

async function setScanState(sourceId, { status, error = null, scannedAt = null } = {}) {
  const source = await db('external_media_sources').where({ id: sourceId }).first();
  if (!source) return;
  let effectiveStatus = status;
  if (!source.is_active) {
    const referenced = await db('photos').where({ event_id: source.event_id, external_source_id: sourceId }).first();
    effectiveStatus = referenced ? 'inactive_referenced' : 'inactive';
  } else if (status === 'watching' && !source.watch_enabled) {
    effectiveStatus = source.last_scanned_at ? 'paused' : 'pending';
  } else if (status === 'ready' && source.watch_enabled) {
    effectiveStatus = 'watching';
  }
  const update = { status: effectiveStatus, last_error: error, updated_at: new Date().toISOString() };
  if (scannedAt) update.last_scanned_at = scannedAt;
  await db('external_media_sources').where({ id: sourceId }).update(update);
}

module.exports = {
  DEFAULT_ROOT_ID,
  PURPOSES,
  normalizeRelativePath,
  resolveRoot,
  validateFolder,
  listSources,
  addSource,
  getSource,
  updateSource,
  deactivateSource,
  setScanState,
};
