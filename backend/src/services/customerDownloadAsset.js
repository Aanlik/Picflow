// Immutable download representations: ranges must never join different renditions.
// Copies are a bounded disposable cache, not project data or another RAW workspace.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Transform, Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { getStoragePath } = require('../config/storage');
const { getStorage } = require('./storage');
const {
  resolvePhotoStorageKey,
  resolvePhotoFilePath,
} = require('./photoResolver');
const { renderPhotoForDownload, isVideo } = require('./downloadRendition');
const { resolvePhotoContentType } = require('../utils/photoContentType');
const {
  getUseOriginalFilenames,
  pickRawDownloadName,
} = require('./downloadFilenameService');
const { buildContentDisposition } = require('../utils/filenameSanitizer');
const { pipeStreamToResponse } = require('../utils/streamResponse');
const { parseBooleanInput } = require('../utils/parsers');
const logger = require('../utils/logger');
const MAX_BYTES = 2 * 1024 ** 3;
const TTL = 24 * 60 * 60 * 1000;
const entries = new Map();
const preparing = new Map();
const lastCleanupByRoot = new Map();

function failure(status, code) {
  return Object.assign(new Error(code), { status, code });
}

// Force-cloud applies only to a retouched final that the delivery queue has
// explicitly registered. A managed original without a current delivery row,
// like a reference photo on NAS, remains an ordinary NAS download.
async function requiresCloudDelivery(event, photo) {
  if (photo?.download_source_kind === 'original') return false;
  if (!parseBooleanInput(event?.force_cloud_downloads, false)) return false;
  try {
    const sourceKey = resolvePhotoStorageKey(event, photo);
    if (!sourceKey) return false;
    return await require('./objectDeliveryService').hasCurrentDeliveryRecord(event.id, photo.id, sourceKey);
  } catch {
    // A lookup failure must not let a known delivery final bypass the force
    // rule; sourceInfo will fail closed when it checks its ready cloud object.
    if (photo?.source_origin === 'external' || photo?.source_origin === 'reference') return false;
    return true;
  }
}

async function prune(root, force = false) {
  const now = Date.now();
  if (!force && now - (lastCleanupByRoot.get(root) || 0) < 60000) return;
  lastCleanupByRoot.set(root, now);
  const names = await fsp.readdir(root);
  for (const name of names.filter((n) => /^[a-f0-9-]+\.part$/.test(n))) {
    const file = path.join(root, name);
    const stat = await fsp.stat(file).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > TTL)
      await fsp.unlink(file).catch(() => {});
  }
  const files = (
    await Promise.all(
      names
        .filter((n) => /^[a-f0-9]{64}\.bin$/.test(n))
        .map(async (name) => {
          const file = path.join(root, name);
          const stat = await fsp.stat(file).catch(() => null);
          return stat ? { file, ...stat } : null;
        }),
    )
  )
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  let kept = 0;
  for (const item of files) {
    if (Date.now() - item.mtimeMs > TTL || kept + item.size > MAX_BYTES)
      await fsp.unlink(item.file).catch(() => {});
    else kept += item.size;
  }
}

async function sourceInfo(event, photo) {
  const cloudSyncEnabled = parseBooleanInput(event.cloud_sync_enabled, false);
  const forceCloud = await requiresCloudDelivery(event, photo);
  const key = resolvePhotoStorageKey(event, photo);
  let delivery = null;
  let cloudFile = null;
  if (key && photo.download_source_kind !== 'original' && (cloudSyncEnabled || forceCloud)) {
    delivery = require('./objectDeliveryService');
    try {
      cloudFile = await delivery.getCurrentReadyObject(event.id, photo.id);
    } catch (error) {
      logger.warn('Cloud photo lookup failed; customer download will use NAS when allowed', {
        eventId: event.id,
        photoId: photo.id,
        error: error.message,
      });
      if (forceCloud) throw failure(503, 'CLOUD_DOWNLOAD_NOT_READY');
    }
  }
  if (cloudFile && cloudFile.source_key === key) {
    return {
      cloud: true,
      cloudObjectKey: cloudFile.object_key,
      objectKey: cloudFile.object_key,
      stat: { size: Number(cloudFile.size_bytes) || Number(photo.size_bytes) || 0, mtime: cloudFile.updated_at },
      signature: JSON.stringify(['cloud', cloudFile.object_key, cloudFile.size_bytes, cloudFile.updated_at]),
      open: () => delivery.getObjectDownloadStream(cloudFile.object_key),
    };
  }
  if (forceCloud) {
    throw failure(503, 'CLOUD_DOWNLOAD_NOT_READY');
  }
  const storage = getStorage();
  if (key && storage.kind() !== 'local') {
    const stat = await storage.stat(key);
    if (!stat) throw failure(404, 'DOWNLOAD_SOURCE_MISSING');
    return {
      stat,
      signature: JSON.stringify([key, stat.size, stat.mtime, stat.etag]),
      open: () => storage.get(key),
    };
  }
  const file = resolvePhotoFilePath(event, photo);
  const stat = await fsp.stat(file);
  if (!stat.isFile()) throw failure(404, 'DOWNLOAD_SOURCE_MISSING');
  return {
    stat,
    signature: JSON.stringify([
      file,
      stat.size,
      stat.mtimeMs,
      stat.ctimeMs,
      stat.ino,
    ]),
    open: async () => fs.createReadStream(file),
  };
}

async function prepare(event, photo, box, watermark) {
  const source = await sourceInfo(event, photo);
  const root = source.cloud
    ? path.join(os.tmpdir(), 'picpeak-cloud-downloads')
    : path.join(getStoragePath(), 'cache', 'customer-downloads');
  await fsp.mkdir(root, { recursive: true });
  await prune(root);
  if (source.stat.size > MAX_BYTES) throw failure(413, 'DOWNLOAD_TOO_LARGE');
  const key = JSON.stringify([
    root,
    event.id,
    photo.id,
    photo.updated_at,
    photo.replacement_version,
    source.signature,
    box,
    watermark,
  ]);
  let data = entries.get(key);
  if (!data || !(await fsp.stat(data.file).catch(() => null))) {
    let pending = preparing.get(key);
    if (!pending) {
      pending = (async () => {
        const temporary = path.join(root, `${crypto.randomUUID()}.part`);
        const cloudSource = source.cloud ? path.join(root, `${crypto.randomUUID()}.part`) : null;
        try {
          if (cloudSource) {
            await pipeline(await source.open(), fs.createWriteStream(cloudSource, { flags: 'wx' }));
          }
          const rendered = await renderPhotoForDownload(
            event,
            photo,
            box,
            watermark,
            cloudSource ? { sourcePath: cloudSource } : undefined,
          );
          const hash = crypto.createHash('sha256');
          let size = 0;
          const digest = new Transform({
            transform(chunk, encoding, callback) {
              size += chunk.length;
              if (size > MAX_BYTES)
                return callback(failure(413, 'DOWNLOAD_TOO_LARGE'));
              hash.update(chunk);
              callback(null, chunk);
            },
          });
          await pipeline(
            rendered ? Readable.from([rendered]) : (cloudSource ? fs.createReadStream(cloudSource) : await source.open()),
            digest,
            fs.createWriteStream(temporary, { flags: 'wx' }),
          );
          if ((await sourceInfo(event, photo)).signature !== source.signature)
            throw failure(409, 'DOWNLOAD_VERSION_CHANGED');
          const sha = hash.digest('hex');
          const file = path.join(root, `${sha}.bin`);
          await fsp.rename(temporary, file);
          await prune(root, true);
          const asset = {
            file,
            size,
            etag: `"sha256-${sha}"`,
            content_type: resolvePhotoContentType(photo),
            cloudObjectKey: source.cloudObjectKey || null,
          };
          entries.set(key, asset);
          while (entries.size > 200)
            entries.delete(entries.keys().next().value);
          return asset;
        } finally {
          await fsp.unlink(temporary).catch(() => {});
          if (cloudSource) await fsp.unlink(cloudSource).catch(() => {});
        }
      })().finally(() => preparing.delete(key));
      preparing.set(key, pending);
    }
    data = await pending;
  }
  const filename = pickRawDownloadName(photo, await getUseOriginalFilenames());
  return { ...data, filename };
}

function rangeOf(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(value));
  if (!match || (!match[1] && !match[2])) return null;
  let start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  let end = match[1] ? (match[2] ? Number(match[2]) : size - 1) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  )
    return null;
  return { start, end: Math.min(end, size - 1) };
}
function publicMetadata(asset) {
  return {
    filename: asset.filename,
    size: asset.size,
    etag: asset.etag,
    content_type: asset.content_type,
  };
}
async function customerMetadata(event, photo, box, watermark, preparedAsset) {
  const forceCloud = await requiresCloudDelivery(event, photo);
  const needsTransform = Boolean((box && !isVideo(photo)) || watermark?.enabled);
  const delivery = forceCloud ? require('./objectDeliveryService') : null;
  let asset = preparedAsset;
  let sourceObjectKey = asset?.cloudObjectKey || null;

  if (forceCloud && !needsTransform) {
    const source = await sourceInfo(event, photo);
    if (!source.cloud) throw failure(503, 'CLOUD_DOWNLOAD_NOT_READY');
    sourceObjectKey = source.cloudObjectKey;
    asset = {
      filename: pickRawDownloadName(photo, await getUseOriginalFilenames()),
      size: source.stat.size,
      etag: source.signature,
      content_type: resolvePhotoContentType(photo),
      cloudObjectKey: sourceObjectKey,
    };
  } else if (!asset) {
    asset = await prepare(event, photo, box, watermark);
    sourceObjectKey = asset.cloudObjectKey;
  }

  if (!forceCloud) return publicMetadata(asset);
  if (!sourceObjectKey) throw failure(503, 'CLOUD_DOWNLOAD_NOT_READY');

  const direct = await delivery.createCustomerDownloadUrl(event, photo, asset, {
    sourceObjectKey,
    transformed: needsTransform,
  });
  if (direct.size > MAX_BYTES) throw failure(413, 'DOWNLOAD_TOO_LARGE');
  return {
    ...publicMetadata(asset),
    size: direct.size,
    etag: direct.etag,
    download_url: direct.url,
  };
}
async function respond(req, res, event, photo, box, watermark) {
  res.set('Cache-Control', 'private, no-store');
  if (
    await requiresCloudDelivery(event, photo) &&
    req.query.managed !== 'metadata'
  ) {
    // In force-cloud mode, never stream photo bytes through Picflow/NAS.
    // The customer queue first obtains a short-lived signed object URL from
    // metadata and then fetches byte ranges directly from the object store.
    return res.status(409).json({ code: 'CLOUD_DOWNLOAD_QUEUE_REQUIRED' });
  }
  if (req.query.managed === 'metadata') {
    return res.json(await customerMetadata(event, photo, box, watermark));
  }
  const asset = await prepare(event, photo, box, watermark);
  if (req.query.version && req.query.version !== asset.etag)
    return res.status(409).json({ code: 'DOWNLOAD_VERSION_CHANGED' });
  res.set({
    ETag: asset.etag,
    'Accept-Ranges': 'bytes',
    'Content-Type': asset.content_type,
    'Content-Disposition': buildContentDisposition(asset.filename),
  });
  const wantsRange =
    req.headers.range &&
    (!req.headers['if-range'] || req.headers['if-range'] === asset.etag);
  const range = wantsRange ? rangeOf(req.headers.range, asset.size) : null;
  if (wantsRange && !range)
    return res.status(416).set('Content-Range', `bytes */${asset.size}`).end();
  if (range)
    res
      .status(206)
      .set({
        'Content-Range': `bytes ${range.start}-${range.end}/${asset.size}`,
        'Content-Length': String(range.end - range.start + 1),
      });
  else res.set('Content-Length', String(asset.size));
  if (req.method === 'HEAD') return res.end();
  pipeStreamToResponse(
    fs.createReadStream(asset.file, range || undefined),
    res,
    { context: 'managed customer download' },
  );
}
module.exports = { prepare, respond, publicMetadata, customerMetadata, rangeOf, requiresCloudDelivery };
