const path = require('path');
const { db } = require('../database/db');
const { getExternalMediaRoot } = require('./externalMediaService');
const { bridgeRequest } = require('./photographyWorkflowBridge');

function toMaterialRawSubdir(source, externalRoot = getExternalMediaRoot()) {
  if (source.root_id !== 'default' || source.purpose === 'gallery') return null;
  const folder = path.resolve(externalRoot, source.relative_path || '.');
  const relative = path.relative(path.resolve(externalRoot), folder);
  if (!relative || relative === '.' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  const parts = relative.split(path.sep);
  if (parts.some((part) => part.toLocaleLowerCase() === 'pixcakedelivery')) return null;
  const leaf = parts[parts.length - 1]?.toLocaleLowerCase();
  if (leaf === '02_proof') parts[parts.length - 1] = '01_RAW';
  return parts.join('/');
}

function rawSubdirsFromSources(sources, externalRoot = getExternalMediaRoot()) {
  return [...new Set((Array.isArray(sources) ? sources : [])
    .map((source) => toMaterialRawSubdir(source, externalRoot))
    .filter(Boolean))];
}

function toCameraRawSubdir(source, externalRoot = getExternalMediaRoot()) {
  const relative = toMaterialRawSubdir(source, externalRoot);
  if (!relative) return null;
  const [rootName, ...parts] = relative.split(path.sep);
  return rootName?.toLocaleLowerCase() === 'camera' && parts.length > 0 ? parts.join(path.sep) : null;
}

async function listBridgeRawSubdirs(eventId) {
  const sources = await db('external_media_sources')
    .where({ event_id: eventId, is_active: true })
    .orderBy('id', 'asc');
  return rawSubdirsFromSources(sources);
}

async function syncBoundProjectRawSources(eventId) {
  const rawSubdirs = await listBridgeRawSubdirs(eventId);
  const result = await bridgeRequest(`/api/projects/${Number(eventId)}/raw-sources`, {
    method: 'POST',
    body: { raw_subdirs: rawSubdirs },
  });
  if (result.status === 404) return { configured: result.configured, skipped: true, reason: 'project-not-bound' };
  return { configured: result.configured, ok: result.status === 200, status: result.status, error: result.error };
}

module.exports = {
  toMaterialRawSubdir,
  toCameraRawSubdir,
  rawSubdirsFromSources,
  listBridgeRawSubdirs,
  syncBoundProjectRawSources,
};
