const { getObjectStorageConfig, getTargetId, isConfigured } = require('./objectDeliveryService');
const { assertS3EndpointAllowed, isPrivateEndpointApproved } = require('../utils/s3EndpointPolicy');

const SHARED_TARGET_PROPERTY = '__objectStorageTargetId';

function normalizePrefix(value, label) {
  const prefix = String(value || '').trim().replace(/^\/+|\/+$/g, '');
  if (prefix && (prefix.includes('\\') || prefix.split('/').some((part) => !part || part === '.' || part === '..'))) {
    throw Object.assign(new Error(`${label} contains an unsafe path segment`), { code: 'BACKUP_S3_PREFIX_INVALID', status: 400 });
  }
  return prefix;
}

function joinPrefixes(...values) {
  return values.map((value) => normalizePrefix(value, 'S3 prefix')).filter(Boolean).join('/');
}

function mapObjectStorageTarget(backupConfig, objectStorageConfig) {
  if (!isConfigured(objectStorageConfig)) {
    throw Object.assign(new Error('请先在“设置 > 对象存储”中配置云端存储目标和访问密钥'), {
      code: 'OBJECT_STORAGE_NOT_CONFIGURED', status: 409,
    });
  }

  const endpoint = objectStorageConfig.endpoint || '';
  const sslEnabled = !/^http:\/\//i.test(endpoint);
  const resolved = {
    ...backupConfig,
    backup_s3_endpoint: endpoint,
    backup_s3_bucket: objectStorageConfig.bucket,
    backup_s3_region: objectStorageConfig.region || 'us-east-1',
    backup_s3_access_key: objectStorageConfig.accessKeyId,
    backup_s3_secret_key: objectStorageConfig.secretAccessKey,
    backup_s3_force_path_style: objectStorageConfig.forcePathStyle === true,
    backup_s3_ssl_enabled: sslEnabled,
    backup_s3_prefix: joinPrefixes(objectStorageConfig.prefix, backupConfig.backup_s3_prefix || 'backups'),
    backup_s3_private_endpoint_approval: objectStorageConfig.privateApproval || '',
    backup_s3_use_object_storage: true,
  };
  Object.defineProperty(resolved, SHARED_TARGET_PROPERTY, {
    value: getTargetId(objectStorageConfig),
    enumerable: false,
  });
  return resolved;
}

async function resolveBackupTarget(backupConfig) {
  if (!normalizeBoolean(backupConfig?.backup_s3_use_object_storage)) return backupConfig;
  const objectStorageConfig = await getObjectStorageConfig();
  const resolved = mapObjectStorageTarget(backupConfig || {}, objectStorageConfig);
  if (resolved.backup_s3_endpoint) {
    const allowPrivate = isPrivateEndpointApproved(
      resolved.backup_s3_endpoint,
      resolved.backup_s3_ssl_enabled,
      resolved.backup_s3_private_endpoint_approval,
    );
    await assertS3EndpointAllowed(resolved.backup_s3_endpoint, {
      sslEnabled: resolved.backup_s3_ssl_enabled,
      allowPrivate,
    });
  }
  return resolved;
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return Boolean(value);
}

module.exports = {
  SHARED_TARGET_PROPERTY,
  joinPrefixes,
  mapObjectStorageTarget,
  normalizeBoolean,
  resolveBackupTarget,
};
