const express = require('express');
const crypto = require('crypto');
const { Readable } = require('stream');
const { db } = require('../database/db');
const { adminAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const S3StorageAdapter = require('../services/storage/s3Storage');
const { encryptSecret, decryptSecret } = require('../utils/objectStorageVault');
const { conciseObjectStorageTestError } = require('../services/objectStorageTestError');
const logger = require('../utils/logger');
const {
  endpointOrigin,
  isPrivateEndpointApproved,
  assertS3EndpointAllowed,
} = require('../utils/s3EndpointPolicy');

const router = express.Router();
const MASK = '••••••••';
const SETTING_PREFIX = 'object_storage_';
const SECRET_KEY = `${SETTING_PREFIX}secret_key_encrypted`;
const DEFAULT_CLOUD_SYNC_KEY = `${SETTING_PREFIX}default_cloud_sync_enabled`;
const DEFAULT_CLOUD_THUMBNAIL_SYNC_KEY = `${SETTING_PREFIX}default_cloud_thumbnail_sync_enabled`;
const DEFAULT_CLOUD_PREVIEW_SYNC_KEY = `${SETTING_PREFIX}default_cloud_preview_sync_enabled`;
const DEFAULT_FORCE_CLOUD_DOWNLOADS_KEY = `${SETTING_PREFIX}default_force_cloud_downloads`;
const PRIVATE_APPROVAL_SETTING = 'backup_s3_private_endpoint_approval';

function settingBoolean(value) {
  return value === true || value === 'true';
}

function parseSetting(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return value; }
}

async function readConfig() {
  const rows = await db('app_settings').where('setting_type', 'object_storage').select('setting_key', 'setting_value');
  const config = {};
  for (const row of rows) config[row.setting_key] = parseSetting(row.setting_value);
  return config;
}

function publicConfig(config) {
  const bucket = config[`${SETTING_PREFIX}bucket`] || '';
  const accessKeyId = config[`${SETTING_PREFIX}access_key_id`] || '';
  const hasSecret = Boolean(config[SECRET_KEY]);
  return {
    enabled: config[`${SETTING_PREFIX}enabled`] === true || config[`${SETTING_PREFIX}enabled`] === 'true',
    endpoint: config[`${SETTING_PREFIX}endpoint`] || '',
    region: config[`${SETTING_PREFIX}region`] || 'us-east-1',
    bucket,
    prefix: config[`${SETTING_PREFIX}prefix`] || '',
    forcePathStyle: config[`${SETTING_PREFIX}force_path_style`] === true || config[`${SETTING_PREFIX}force_path_style`] === 'true',
    galleryUploadConcurrency: Number.isInteger(config[`${SETTING_PREFIX}gallery_upload_concurrency`]) && config[`${SETTING_PREFIX}gallery_upload_concurrency`] >= 1 && config[`${SETTING_PREFIX}gallery_upload_concurrency`] <= 8 ? config[`${SETTING_PREFIX}gallery_upload_concurrency`] : 4,
    backgroundUploadLimitKiB: Number.isInteger(config[`${SETTING_PREFIX}background_upload_limit_kib`]) ? config[`${SETTING_PREFIX}background_upload_limit_kib`] : 0,
    accessKeyMasked: accessKeyId ? MASK : '',
    hasSecret,
    configured: Boolean(bucket && accessKeyId && hasSecret),
    defaultCloudSyncEnabled: settingBoolean(config[DEFAULT_CLOUD_SYNC_KEY]),
    defaultCloudThumbnailSyncEnabled: settingBoolean(config[DEFAULT_CLOUD_THUMBNAIL_SYNC_KEY]),
    defaultCloudPreviewSyncEnabled: settingBoolean(config[DEFAULT_CLOUD_PREVIEW_SYNC_KEY]),
    defaultForceCloudDownloads: settingBoolean(config[DEFAULT_FORCE_CLOUD_DOWNLOADS_KEY]),
  };
}

async function approvedPrivateEndpoint(endpoint, sslEnabled = true) {
  if (!endpoint) return false;
  const approval = parseSetting((await db('app_settings').where({ setting_key: PRIVATE_APPROVAL_SETTING }).first())?.setting_value);
  return isPrivateEndpointApproved(endpoint, sslEnabled, approval);
}

function adapterConfig(config, secret, allowPrivateEndpoint = false) {
  return {
    bucket: config.bucket,
    region: config.region || 'us-east-1',
    endpoint: config.endpoint || undefined,
    accessKeyId: config.accessKeyId,
    secretAccessKey: secret,
    prefix: config.prefix || undefined,
    forcePathStyle: config.forcePathStyle === true,
    autoPathStyleForCustomEndpoint: false,
    sslEnabled: !/^http:\/\//i.test(config.endpoint || ''),
    allowPrivateEndpoint,
    multipartThreshold: 16 * 1024 * 1024,
    partSize: 8 * 1024 * 1024,
  };
}

async function materialize(input, existing, { allowBlankSecret = true } = {}) {
  const galleryUploadConcurrency = input.galleryUploadConcurrency ?? existing[`${SETTING_PREFIX}gallery_upload_concurrency`] ?? 4;
  if (!Number.isInteger(galleryUploadConcurrency) || galleryUploadConcurrency < 1 || galleryUploadConcurrency > 8) {
    throw Object.assign(new Error('图库图片上传并发数必须是 1 到 8 的整数'), { status: 400 });
  }
  const backgroundUploadLimitKiB = input.backgroundUploadLimitKiB ?? existing[`${SETTING_PREFIX}background_upload_limit_kib`] ?? 0;
  if (!Number.isInteger(backgroundUploadLimitKiB) || (backgroundUploadLimitKiB !== 0 && (backgroundUploadLimitKiB < 64 || backgroundUploadLimitKiB > 1048576))) {
    throw Object.assign(new Error('后台上传速率上限须为 0 或 64–1048576 KiB/s 的整数'), { status: 400 });
  }
  const endpoint = typeof input.endpoint === 'string' ? input.endpoint.trim() : (existing[`${SETTING_PREFIX}endpoint`] || '');
  const bucket = typeof input.bucket === 'string' ? input.bucket.trim() : (existing[`${SETTING_PREFIX}bucket`] || '');
  const region = typeof input.region === 'string' ? input.region.trim() : (existing[`${SETTING_PREFIX}region`] || 'us-east-1');
  const prefix = typeof input.prefix === 'string' ? input.prefix.trim().replace(/^\/+|\/+$/g, '') : (existing[`${SETTING_PREFIX}prefix`] || '');
  const accessKeyInput = typeof input.accessKeyId === 'string' ? input.accessKeyId.trim() : '';
  const accessKeyId = accessKeyInput || existing[`${SETTING_PREFIX}access_key_id`] || '';
  const secretInput = typeof input.secretAccessKey === 'string' ? input.secretAccessKey : '';
  const secretAccessKey = secretInput ? secretInput : (existing[SECRET_KEY] ? decryptSecret(existing[SECRET_KEY]) : '');
  const forcePathStyle = typeof input.forcePathStyle === 'boolean'
    ? input.forcePathStyle
    : (existing[`${SETTING_PREFIX}force_path_style`] === true || existing[`${SETTING_PREFIX}force_path_style`] === 'true');
  const enabled = typeof input.enabled === 'boolean'
    ? input.enabled
    : (existing[`${SETTING_PREFIX}enabled`] === true || existing[`${SETTING_PREFIX}enabled`] === 'true');
  const defaultCloudSyncEnabled = typeof input.defaultCloudSyncEnabled === 'boolean'
    ? input.defaultCloudSyncEnabled
    : settingBoolean(existing[DEFAULT_CLOUD_SYNC_KEY]);
  const defaultCloudThumbnailSyncEnabled = typeof input.defaultCloudThumbnailSyncEnabled === 'boolean'
    ? input.defaultCloudThumbnailSyncEnabled
    : settingBoolean(existing[DEFAULT_CLOUD_THUMBNAIL_SYNC_KEY]);
  const defaultCloudPreviewSyncEnabled = typeof input.defaultCloudPreviewSyncEnabled === 'boolean'
    ? input.defaultCloudPreviewSyncEnabled
    : settingBoolean(existing[DEFAULT_CLOUD_PREVIEW_SYNC_KEY]);
  const defaultForceCloudDownloads = typeof input.defaultForceCloudDownloads === 'boolean'
    ? input.defaultForceCloudDownloads
    : settingBoolean(existing[DEFAULT_FORCE_CLOUD_DOWNLOADS_KEY]);

  if (endpoint) {
    const origin = endpointOrigin(endpoint, !/^http:\/\//i.test(endpoint));
    if (!origin || !/^https?:\/\//i.test(endpoint)) throw Object.assign(new Error('对象存储 Endpoint 必须是有效的 http(s) URL'), { status: 400 });
    const parsed = new URL(endpoint);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw Object.assign(new Error('Endpoint 不能包含账号、密码、查询参数或片段'), { status: 400 });
  }
  if (!bucket || bucket.length > 255 || bucket.includes('/') || bucket.includes('\\')
    || Array.from(bucket).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw Object.assign(new Error('请填写有效的 Bucket'), { status: 400 });
  }
  if (prefix && (prefix.includes('\\') || prefix.split('/').some((part) => !part || part === '.' || part === '..'))) {
    throw Object.assign(new Error('对象前缀不能包含空路径段或 .、.. 路径段'), { status: 400 });
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(region)) throw Object.assign(new Error('Region 格式无效'), { status: 400 });
  if (!accessKeyId || !secretAccessKey) throw Object.assign(new Error('请填写对象存储访问密钥'), { status: 400 });
  if (!allowBlankSecret && !secretInput) throw Object.assign(new Error('请填写 Secret Access Key'), { status: 400 });

  return {
    endpoint, bucket, region, prefix, accessKeyId, secretAccessKey, forcePathStyle, enabled,
    defaultCloudSyncEnabled, defaultCloudThumbnailSyncEnabled, defaultCloudPreviewSyncEnabled,
    defaultForceCloudDownloads, galleryUploadConcurrency, backgroundUploadLimitKiB,
  };
}

async function targetInUse() {
  if (await db.schema.hasTable('object_delivery_files')) {
    if (await db('object_delivery_files').first('id')) return true;
  }
  if (await db.schema.hasTable('object_delivery_download_renditions')) {
    if (await db('object_delivery_download_renditions').first('id')) return true;
  }
  if (await db.schema.hasTable('object_gallery_derivatives')) {
    if (await db('object_gallery_derivatives').first('id')) return true;
  }
  if (await db.schema.hasTable('backup_runs')
    && await db.schema.hasColumn('backup_runs', 'object_storage_target_id')) {
    return Boolean(await db('backup_runs')
      .whereNotNull('object_storage_target_id')
      .where((query) => query.where('status', 'running').orWhereNotNull('manifest_path'))
      .first('id'));
  }
  return false;
}

function targetId(config) {
  return JSON.stringify([config.endpoint || '', config.region || 'us-east-1', config.bucket || '', config.prefix || '']);
}

router.get('/', adminAuth, requirePermission(['settings.view', 'settings.edit', 'backup.view', 'backup.create']), async (_req, res) => {
  try {
    res.json(publicConfig(await readConfig()));
  } catch (error) {
    res.status(500).json({ error: '读取对象存储配置失败' });
  }
});

// Project creators need only the readiness state and default toggles while
// building a project. Keep credentials and provider details off that surface.
router.get('/defaults', adminAuth, requirePermission('events.create'), async (_req, res) => {
  try {
    const config = publicConfig(await readConfig());
    res.json({
      enabled: config.enabled,
      configured: config.configured,
      defaultCloudSyncEnabled: config.defaultCloudSyncEnabled,
      defaultCloudThumbnailSyncEnabled: config.defaultCloudThumbnailSyncEnabled,
      defaultCloudPreviewSyncEnabled: config.defaultCloudPreviewSyncEnabled,
      defaultForceCloudDownloads: config.defaultForceCloudDownloads,
    });
  } catch (_error) {
    res.status(500).json({ error: '读取云端同步默认设置失败' });
  }
});

router.put('/', adminAuth, requirePermission(['settings.edit', 'backup.create']), async (req, res) => {
  try {
    const defaultKeys = [
      'defaultCloudSyncEnabled', 'defaultCloudThumbnailSyncEnabled',
      'defaultCloudPreviewSyncEnabled', 'defaultForceCloudDownloads',
    ];
    if (defaultKeys.some((key) => req.body?.[key] !== undefined && typeof req.body[key] !== 'boolean')) {
      return res.status(400).json({ code: 'INVALID_OBJECT_STORAGE_DEFAULT', error: '新项目的对象存储默认值必须为 true 或 false' });
    }
    const existing = await readConfig();
    const config = await materialize(req.body || {}, existing);
    if (config.defaultForceCloudDownloads && !config.defaultCloudSyncEnabled) {
      return res.status(400).json({
        code: 'FORCE_CLOUD_DEFAULT_REQUIRES_SYNC',
        error: '新项目默认强制云端下载时，也必须默认启用精修成片自动同步。',
      });
    }
    if (config.endpoint) {
      const sslEnabled = !/^http:\/\//i.test(config.endpoint);
      await assertS3EndpointAllowed(config.endpoint, {
        sslEnabled,
        allowPrivate: await approvedPrivateEndpoint(config.endpoint, sslEnabled),
      });
    }
    const previous = {
      endpoint: existing[`${SETTING_PREFIX}endpoint`] || '',
      bucket: existing[`${SETTING_PREFIX}bucket`] || '',
      region: existing[`${SETTING_PREFIX}region`] || 'us-east-1',
      prefix: existing[`${SETTING_PREFIX}prefix`] || '',
    };
    if (await targetInUse() && targetId(previous) !== targetId(config)) {
      return res.status(409).json({
        code: 'OBJECT_STORAGE_TARGET_IN_USE',
        error: '已有云端照片、预览图或共享对象存储备份正在使用此目标，不能直接切换。请先完成迁移并清理使用该目标的云端副本和备份恢复点。',
      });
    }
    const values = {
      [`${SETTING_PREFIX}enabled`]: config.enabled,
      [`${SETTING_PREFIX}endpoint`]: config.endpoint,
      [`${SETTING_PREFIX}region`]: config.region,
      [`${SETTING_PREFIX}bucket`]: config.bucket,
      [`${SETTING_PREFIX}prefix`]: config.prefix,
      [`${SETTING_PREFIX}force_path_style`]: config.forcePathStyle,
      [`${SETTING_PREFIX}gallery_upload_concurrency`]: config.galleryUploadConcurrency,
      [`${SETTING_PREFIX}background_upload_limit_kib`]: config.backgroundUploadLimitKiB,
      [DEFAULT_CLOUD_SYNC_KEY]: config.defaultCloudSyncEnabled,
      [DEFAULT_CLOUD_THUMBNAIL_SYNC_KEY]: config.defaultCloudThumbnailSyncEnabled,
      [DEFAULT_CLOUD_PREVIEW_SYNC_KEY]: config.defaultCloudPreviewSyncEnabled,
      [DEFAULT_FORCE_CLOUD_DOWNLOADS_KEY]: config.defaultForceCloudDownloads,
      [`${SETTING_PREFIX}access_key_id`]: config.accessKeyId,
      [SECRET_KEY]: req.body?.secretAccessKey ? encryptSecret(config.secretAccessKey) : existing[SECRET_KEY],
    };
    await db.transaction(async (trx) => {
      for (const [setting_key, value] of Object.entries(values)) {
        if (value === undefined) continue;
        await trx('app_settings').insert({ setting_key, setting_value: JSON.stringify(value), setting_type: 'object_storage', updated_at: new Date() })
          .onConflict('setting_key').merge({ setting_value: JSON.stringify(value), setting_type: 'object_storage', updated_at: new Date() });
      }
    });
    res.json({ success: true, config: publicConfig(await readConfig()) });
  } catch (error) {
    const status = error.status || (String(error.code || '').startsWith('S3_') ? 400 : 500);
    const safe = conciseObjectStorageTestError(error);
    if (!error.status) {
      const detail = String(error.message || error).replace(/\s+/g, ' ').slice(0, 600);
      logger.warn('Object storage configuration save failed', { code: safe.code, detail });
    }
    res.status(status).json(safe);
  }
});

router.post('/test', adminAuth, requirePermission(['settings.edit', 'backup.create']), async (req, res) => {
  let adapter;
  let probeKey;
  try {
    const existing = await readConfig();
    const config = await materialize(req.body || {}, existing);
    const sslEnabled = !/^http:\/\//i.test(config.endpoint || '');
    adapter = new S3StorageAdapter(adapterConfig(config, config.secretAccessKey, await approvedPrivateEndpoint(config.endpoint, sslEnabled)));
    await adapter.testConnection();
    probeKey = [config.prefix, '.picpeak-connection-check', `${Date.now()}-${crypto.randomUUID()}.txt`].filter(Boolean).join('/');
    await adapter.uploadStream(Readable.from([Buffer.from('PicPeak object storage connection check', 'utf8')]), probeKey, { contentType: 'text/plain' });
    await adapter.delete(probeKey);
    res.json({ success: true, message: '连接、写入和清理测试均已通过' });
  } catch (error) {
    if (adapter && probeKey) await adapter.delete(probeKey).catch(() => {});
    const safe = conciseObjectStorageTestError(error);
    if (!error.status) {
      const detail = String(error.message || error).replace(/\s+/g, ' ').slice(0, 600);
      logger.warn('Object storage connection test failed', { code: safe.code, detail });
    }
    res.status(error.status || 502).json(safe);
  } finally {
    adapter?.s3Client?.destroy?.();
  }
});

module.exports = router;
