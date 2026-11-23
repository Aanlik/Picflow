/**
 * downloadJobCleanupService — TTL sweep for custom-resolution download jobs
 * (#858).
 *
 * Job archives are one-off renditions of a gallery at a size nothing else
 * caches against, so they are pure disposable bytes: once the TTL passes the
 * row and its zip go away. Without this sweep, every guest who ever picked a
 * non-standard resolution would leave a full gallery-sized archive behind in
 * `.download-cache` forever.
 *
 * Runs every 20 minutes, offset from the hourly jobs so the three cleanup
 * schedulers don't all wake at once.
 */

const { scheduledTask } = require('./scheduledTask');
const logger = require('../utils/logger');
const downloadJobService = require('./downloadJobService');

// Clean once shortly after boot as well as on the 20-minute cadence. This
// reclaims expired customer renditions left by older flat-cache layouts.
const task = scheduledTask(runDownloadJobCleanup, {
  schedule: '7,27,47 * * * *',
  initialDelay: 10_000,
});
function startDownloadJobCleanup() { task.start(); }
const stopDownloadJobCleanup = () => task.stop();

async function runDownloadJobCleanup() {
  try {
    await downloadJobService.sweepExpired();
  } catch (err) {
    logger.error('Download job cleanup failed', { error: err.message });
  }
  try {
    await require('./customerDownloadAsset').sweepExpiredCache();
  } catch (err) {
    logger.error('Customer download cache cleanup failed', { error: err.message });
  }
}

module.exports = {
  stopDownloadJobCleanup,
  startDownloadJobCleanup,
  // exported for tests / manual invocation
  runDownloadJobCleanup,
};
