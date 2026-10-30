const logger = require('../utils/logger');

// The authenticated route retains redirects for existing callers. New browser
// clients can request the signed URL separately so no gallery credentials are
// involved in the cross-origin object-storage request.
async function respondWithCloudAsset(req, res, photo, kind, width, getUrl) {
  if (req.query.cloud_source === 'nas') return false;
  let cloudUrl;
  try {
    const resolve = getUrl || require('./cloudGalleryAssetService').getReadyAssetUrl;
    cloudUrl = await resolve(req.event, photo, kind, width);
  } catch (error) {
    logger.warn('Cloud gallery image URL unavailable; serving NAS image', { photoId: photo.id, kind, error: error.message });
    return false;
  }
  if (!cloudUrl) return false;
  res.set('Cache-Control', 'no-store');
  if (req.query.cloud_transport === 'json') res.json({ cloudUrl });
  else res.redirect(302, cloudUrl);
  return true;
}
module.exports = { respondWithCloudAsset };
