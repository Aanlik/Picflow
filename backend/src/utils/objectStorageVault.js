const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const SALT = 'picpeak-object-storage-credentials-v1';
let cache = null;

function key() {
  const material = process.env.OBJECT_STORAGE_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!material) throw new Error('OBJECT_STORAGE_ENCRYPTION_KEY or JWT_SECRET must be set');
  if (cache?.material === material) return cache.key;
  cache = { material, key: crypto.scryptSync(material, SALT, 32) };
  return cache.key;
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

function decryptSecret(value) {
  const [iv, tag, ciphertext] = String(value || '').split('.');
  if (!iv || !tag || !ciphertext) throw new Error('Malformed object storage credential');
  const decipher = crypto.createDecipheriv(ALGORITHM, key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
