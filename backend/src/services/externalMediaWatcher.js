/** Per-material-source watcher. The watcher key is the association ID, not
 * event ID, so one unavailable folder cannot disable its siblings. */
const path = require('path');
const fs = require('fs').promises;
const chokidar = require('chokidar');
const { db } = require('../database/db');
const { formatBoolean } = require('../utils/dbCompat');
const logger = require('../utils/logger');
const { setScanState, validateFolder } = require('./externalMediaSources');
const { importExternalFolder, ImportInProgressError, IMAGE_EXTENSIONS } = require('./externalImportService');

const envInt = (name, fallback) => {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};
const ENABLED = (process.env.EXTERNAL_MEDIA_WATCH || 'true').toLowerCase() !== 'false';
const USE_POLLING = (process.env.EXTERNAL_MEDIA_WATCH_POLLING || 'false').toLowerCase() === 'true';
const POLL_INTERVAL_MS = envInt('EXTERNAL_MEDIA_WATCH_POLL_INTERVAL_MS', 5000);
const STABILITY_MS = envInt('EXTERNAL_MEDIA_WATCH_STABILITY_MS', 5000);
const DEBOUNCE_MS = envInt('EXTERNAL_MEDIA_WATCH_DEBOUNCE_MS', 10000);
const SWEEP_INTERVAL_MS = envInt('EXTERNAL_MEDIA_WATCH_SWEEP_INTERVAL_MS', 15 * 60 * 1000);
const RECONCILE_INTERVAL_MS = envInt('EXTERNAL_MEDIA_WATCH_RECONCILE_INTERVAL_MS', 60 * 1000);
const ACTOR = { type: 'system', name: 'external-media-watcher' };
const watched = new Map(); // source id -> { path, watcher, timer, eventId }
const missingLogged = new Set();
let reconcileTimer = null;
let sweepTimer = null;
let started = false;

async function listWatchedSources() {
  return db('external_media_sources as s')
    .join('events as e', 'e.id', 's.event_id')
    .where({ 's.watch_enabled': formatBoolean(true), 's.is_active': formatBoolean(true), 'e.is_active': formatBoolean(true) })
    .where(function () { this.where('e.is_archived', formatBoolean(false)).orWhereNull('e.is_archived'); })
    .select('s.*', 'e.slug');
}

const isImage = (filePath) => IMAGE_EXTENSIONS.includes(path.extname(filePath).toLowerCase());

async function runImport(sourceId, reason) {
  const source = await db('external_media_sources').where({ id: sourceId, is_active: formatBoolean(true) }).first();
  const eventId = source?.event_id || watched.get(sourceId)?.eventId;
  if (!source || !eventId || !source.watch_enabled || !source.is_active) return null;
  const event = await db('events').where({ id: eventId }).first();
  if (!event?.is_active || event.is_archived) return null;
  try {
    const result = await importExternalFolder({
      eventId,
      sourceId,
      recursive: true,
      actor: ACTOR,
      automatic: true,
      settleMs: STABILITY_MS,
    });
    if (result.imported > 0 || result.deferred > 0) {
      logger.info(`[externalMediaWatcher] source ${sourceId} event ${eventId}: imported ${result.imported}, skipped ${result.skipped}, deferred ${result.deferred} (${reason})`);
    } else {
      logger.debug(`[externalMediaWatcher] source ${sourceId}: nothing new (${reason})`);
    }
    if (result.deferred > 0) scheduleImport(sourceId);
    return result;
  } catch (err) {
    if (err instanceof ImportInProgressError) {
      if (reason === 'change') scheduleImport(sourceId);
      return null;
    }
    await setScanState(sourceId, { status: 'error', error: String(err.message).slice(0, 2000) }).catch(() => {});
    logger.error(`[externalMediaWatcher] source ${sourceId} import failed: ${err.message}`);
    return null;
  }
}

async function queueChangedPhoto(sourceId, filePath) {
  const source = await db('external_media_sources').where({ id: sourceId, is_active: formatBoolean(true) }).first();
  if (!source) return;
  const baseAbs = await validateFolder(source.root_id, source.relative_path);
  const relative = path.relative(baseAbs, filePath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return;
  const relativePath = path.posix.join(
    String(source.relative_path || '').replace(/\\/g, '/'),
    relative.split(path.sep).join('/'),
  );
  const photo = await db('photos').where({
    event_id: Number(source.event_id),
    external_source_id: Number(source.id),
    external_relpath: relativePath,
  }).first();
  if (!photo) return;
  const stat = await fs.stat(filePath);
  await db('photos').where({ id: photo.id, event_id: source.event_id }).update({
    size_bytes: stat.size,
    updated_at: new Date(),
  });
  await require('./cloudGalleryAssetService').queuePhotoIfEnabled(source.event_id, photo.id);
}

function scheduleImport(sourceId) {
  const entry = watched.get(sourceId);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    runImport(sourceId, 'change').catch((err) => logger.error(`[externalMediaWatcher] scheduled scan failed for source ${sourceId}: ${err.message}`));
  }, DEBOUNCE_MS);
  entry.timer.unref?.();
}

async function startWatching(source) {
  let absPath;
  try {
    absPath = await validateFolder(source.root_id, source.relative_path);
  } catch (err) {
    await setScanState(source.id, { status: 'error', error: String(err.message).slice(0, 2000) }).catch(() => {});
    logger.warn(`[externalMediaWatcher] source ${source.id}: refusing path: ${err.message}`);
    return false;
  }
  try {
    const stat = await fs.stat(absPath);
    if (!stat.isDirectory()) throw new Error('not a directory');
  } catch (err) {
    await setScanState(source.id, { status: 'error', error: `Folder unavailable: ${err.message}`.slice(0, 2000) }).catch(() => {});
    if (!missingLogged.has(source.id)) {
      missingLogged.add(source.id);
      logger.warn(`[externalMediaWatcher] source ${source.id} event ${source.event_id}: '${source.relative_path}' unavailable; retrying on reconciliation`);
    }
    return false;
  }
  missingLogged.delete(source.id);
  const watcher = chokidar.watch(absPath, {
    ignoreInitial: true,
    persistent: true,
    ignored: (p) => path.basename(p).startsWith('.')
      || path.relative(absPath, p).split(path.sep).some((part) => part.toLocaleLowerCase() === 'pixcakedelivery'),
    usePolling: USE_POLLING,
    interval: POLL_INTERVAL_MS,
    binaryInterval: POLL_INTERVAL_MS,
    awaitWriteFinish: { stabilityThreshold: STABILITY_MS, pollInterval: Math.min(1000, STABILITY_MS) },
  });
  watched.set(source.id, { externalPath: source.relative_path, rootId: source.root_id, eventId: source.event_id, watcher, timer: null });
  watcher
    .on('add', (filePath) => { if (isImage(filePath)) scheduleImport(source.id); })
    .on('change', (filePath) => {
      if (!isImage(filePath)) return;
      queueChangedPhoto(source.id, filePath)
        .catch((err) => logger.warn(`[externalMediaWatcher] could not refresh cloud renditions for ${filePath}: ${err.message}`));
    })
    .on('unlink', (filePath) => {
      if (isImage(filePath)) logger.debug(`[externalMediaWatcher] source ${source.id}: NAS file removed; imported photo retained`);
    })
    .on('error', (err) => {
      logger.warn(`[externalMediaWatcher] source ${source.id}: watcher error: ${err.message}`);
      setScanState(source.id, { status: 'error', error: String(err.message).slice(0, 2000) }).catch(() => {});
      stopWatching(source.id).catch(() => {});
    });
  await setScanState(source.id, { status: 'watching', error: null });
  logger.info(`[externalMediaWatcher] watching source ${source.id} for event ${source.event_id} at '${source.relative_path}'${USE_POLLING ? ' (polling)' : ''}`);
  return true;
}

async function stopWatching(sourceId) {
  const entry = watched.get(sourceId);
  if (!entry) return;
  watched.delete(sourceId);
  if (entry.timer) clearTimeout(entry.timer);
  try { await entry.watcher.close(); } catch (err) { logger.debug(`[externalMediaWatcher] close failed for source ${sourceId}: ${err.message}`); }
}

async function reconcile({ scanFreshSources = true } = {}) {
  let sources;
  try { sources = await listWatchedSources(); }
  catch (err) { logger.warn(`[externalMediaWatcher] could not list watched sources: ${err.message}`); return; }
  const wanted = new Map(sources.map((source) => [source.id, source]));
  for (const [sourceId, existing] of watched) {
    const next = wanted.get(sourceId);
    if (!next || next.relative_path !== existing.externalPath || next.root_id !== existing.rootId) await stopWatching(sourceId);
  }
  const fresh = [];
  for (const source of wanted.values()) {
    if (watched.has(source.id)) continue;
    try {
      if (await startWatching(source)) fresh.push(source.id);
    } catch (error) {
      await stopWatching(source.id);
      await setScanState(source.id, { status: 'error', error: String(error.message).slice(0, 2000) }).catch(() => {});
      logger.warn(`[externalMediaWatcher] source ${source.id}: could not start watcher: ${error.message}`);
    }
  }
  if (scanFreshSources) {
    for (const sourceId of fresh) await runImport(sourceId, 'start');
  }
}

async function sweep() {
  for (const sourceId of [...watched.keys()]) await runImport(sourceId, 'sweep');
}

function startExternalMediaWatcher() {
  if (!ENABLED) { logger.info('[externalMediaWatcher] disabled via EXTERNAL_MEDIA_WATCH=false'); return null; }
  if (started) return null;
  started = true;
  reconcile().catch((err) => logger.warn(`[externalMediaWatcher] initial reconcile failed: ${err.message}`));
  reconcileTimer = setInterval(() => reconcile().catch((err) => logger.warn(`[externalMediaWatcher] reconcile failed: ${err.message}`)), RECONCILE_INTERVAL_MS);
  reconcileTimer.unref?.();
  if (SWEEP_INTERVAL_MS > 0) {
    sweepTimer = setInterval(() => sweep().catch((err) => logger.warn(`[externalMediaWatcher] sweep failed: ${err.message}`)), SWEEP_INTERVAL_MS);
    sweepTimer.unref?.();
  }
  logger.info(`[externalMediaWatcher] started (per-source, sweep ${SWEEP_INTERVAL_MS > 0 ? `${Math.round(SWEEP_INTERVAL_MS / 60000)} min` : 'disabled'})`);
  return { reconcile, sweep };
}

async function stopExternalMediaWatcher() {
  if (reconcileTimer) clearInterval(reconcileTimer);
  if (sweepTimer) clearInterval(sweepTimer);
  reconcileTimer = null;
  sweepTimer = null;
  for (const sourceId of [...watched.keys()]) await stopWatching(sourceId);
  missingLogged.clear();
  started = false;
}

module.exports = {
  startExternalMediaWatcher,
  stopExternalMediaWatcher,
  reconcile,
  sweep,
  runImport,
  queueChangedPhoto,
  listWatchedSources,
  watchedSourceIds: () => [...watched.keys()],
  // Compatibility with callers/tests written for the single-folder watcher.
  watchedEventIds: () => [...new Set([...watched.values()].map((entry) => entry.eventId))],
};
