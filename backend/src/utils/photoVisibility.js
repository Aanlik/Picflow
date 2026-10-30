/**
 * Shared hidden-photo access control.
 *
 * Picflow photos carry a `visibility` column: 'visible' (or NULL, for
 * pre-migration rows) is shown to everyone; 'hidden' is client-only. A
 * gallery viewer's `req.accessLevel` is 'client' for a PIN-client login and
 * something else ('guest'/'slideshow'/…) for an ordinary guest.
 *
 * The main photo-list query and the single-photo download/view routes each
 * enforced this inline, but several bulk/secure paths (download-all,
 * download-selected, protected-image view, signed-URL mint, secure-token
 * mint, secure-download) shipped without it — letting ordinary guests reach
 * hidden/client-only photos. These helpers centralise the rule so every
 * sink applies exactly the same predicate.
 */

// PIN-clients see hidden photos; everyone else does not.
function canSeeHiddenPhotos(accessLevel) {
  return accessLevel === 'client';
}

/**
 * Append the guest visibility filter to a knex `photos` query. No-op for
 * clients. NULL visibility is treated as visible (pre-migration default).
 * The query must reference the table as `photos` (all call sites do).
 */
function applyPhotoVisibilityFilter(query, accessLevel) {
  if (canSeeHiddenPhotos(accessLevel)) return query;
  return query.where(function () {
    this.where('photos.visibility', 'visible').orWhereNull('photos.visibility');
  });
}

/**
 * Videos have no slideshow frame sequence. Exclude them at the shared query
 * boundary rather than letting the kiosk receive a row whose preview URL is
 * intentionally null and then trying to render an MP4 in an <img>.
 * Keep legacy NULL media metadata: pre-video rows are images unless the MIME
 * type says otherwise.
 */
function applySlideshowMediaFilter(query) {
  return query
    .where(function () {
      this.whereNull('photos.media_type').orWhereNot('photos.media_type', 'video');
    })
    .where(function () {
      this.whereNull('photos.mime_type').orWhereNot('photos.mime_type', 'like', 'video/%');
    });
}

/**
 * Single-photo predicate: true when this photo must be blocked for a viewer
 * at the given access level. Mirrors the inline guards in gallery.js.
 */
function isPhotoHiddenFromViewer(photo, accessLevel) {
  return !!photo && photo.visibility === 'hidden' && !canSeeHiddenPhotos(accessLevel);
}

module.exports = {
  canSeeHiddenPhotos,
  applyPhotoVisibilityFilter,
  applySlideshowMediaFilter,
  isPhotoHiddenFromViewer,
};
