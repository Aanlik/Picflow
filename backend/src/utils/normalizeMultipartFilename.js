'use strict';

/**
 * Multer/busboy may expose a UTF-8 multipart filename as a Latin-1 string.
 * Recover it only when re-encoding the candidate reproduces the exact bytes;
 * ordinary Unicode strings and malformed byte sequences are left untouched.
 *
 * @param {unknown} filename
 * @returns {string}
 */
function normalizeMultipartFilename(filename) {
  if (
    typeof filename !== 'string' ||
    !filename ||
    Array.from(filename).some((character) => character.codePointAt(0) > 0xff)
  ) {
    return filename;
  }

  const originalBytes = Buffer.from(filename, 'latin1');
  const decoded = originalBytes.toString('utf8');
  if (!decoded || decoded.includes('\uFFFD') || decoded === filename) return filename;
  if (!Buffer.from(decoded, 'utf8').equals(originalBytes)) return filename;

  // Avoid rewriting legitimate Latin-1 names which happen to be valid byte
  // sequences. The CJK check covers the common browser mojibake for Chinese;
  // the marker check covers UTF-8/Latin-1 corruption of Western names.
  const recoveredCjk = /[\u3400-\u9fff]/.test(decoded);
  const hasMojibakeMarker = /(?:Ã.|Â.|â€|â€™|â€œ|â€“|â€”|[\u00c0-\u00ff][\u0080-\u00bf])/.test(filename);
  return recoveredCjk || hasMojibakeMarker ? decoded : filename;
}

module.exports = { normalizeMultipartFilename };
