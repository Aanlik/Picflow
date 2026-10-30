const { parseBooleanInput } = require('../utils/parsers');

function sourcePermission(event, kind) {
  const legacy = parseBooleanInput(event.allow_downloads, true);
  const original = event.allow_original_downloads == null ? legacy : parseBooleanInput(event.allow_original_downloads, legacy);
  const delivery = event.allow_delivery_downloads == null ? legacy : parseBooleanInput(event.allow_delivery_downloads, legacy);
  if (kind === 'original') return original;
  if (kind === 'delivery') return delivery;
  // Unknown legacy rows must not bypass a stricter one of the two controls.
  return original && delivery;
}

function canDownloadPhoto(event, photo) {
  const kind = photo.download_source_kind ||
    (['external', 'reference'].includes(photo.source_origin) ? 'original' : null);
  return sourcePermission(event, kind);
}

function filterDownloadable(query, event) {
  const original = sourcePermission(event, 'original');
  const delivery = sourcePermission(event, 'delivery');
  if (original && delivery) return query;
  if (!original && !delivery) return query.whereRaw('1 = 0');
  return query.where(function () {
    if (original) {
      this.where('photos.download_source_kind', 'original')
        .orWhere(function () {
          this.whereNull('photos.download_source_kind').whereIn('photos.source_origin', ['external', 'reference']);
        });
    } else {
      this.where('photos.download_source_kind', 'delivery');
    }
  });
}

module.exports = { sourcePermission, canDownloadPhoto, filterDownloadable };
