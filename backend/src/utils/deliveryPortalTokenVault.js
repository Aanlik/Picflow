const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const SALT = 'picpeak-delivery-portal-token-v1';
let cachedKey = null;

function getKey() {
  const material = process.env.DELIVERY_PORTAL_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!material) throw new Error('DELIVERY_PORTAL_TOKEN_ENCRYPTION_KEY or JWT_SECRET must be set');
  if (cachedKey?.material === material) return cachedKey.key;
  cachedKey = { material, key: crypto.scryptSync(material, SALT, 32) };
  return cachedKey.key;
}

function encryptToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

function decryptToken(stored) {
  const [ivText, tagText, ciphertextText] = String(stored || '').split('.');
  if (!ivText || !tagText || !ciphertextText) throw new Error('Malformed delivery portal token');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = { encryptToken, decryptToken };
