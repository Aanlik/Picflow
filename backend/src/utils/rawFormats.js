const path = require('path');
const RAW_EXTENSIONS = new Set([
  'dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'sr2', 'srf',
  'raf', 'rw2', 'orf', 'pef', 'srw', 'raw', '3fr', 'dcr', 'kdc',
]);
function isRawFilename(name) {
  if (!name || typeof name !== 'string') return false;
  return RAW_EXTENSIONS.has(path.extname(name).toLowerCase().replace(/^\./, ''));
}
module.exports = { RAW_EXTENSIONS, isRawFilename };
