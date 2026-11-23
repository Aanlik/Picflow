const fs = require('fs');
const path = require('path');

const LOG_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const LOG_MAX_FILES = 3;
const LOG_RETENTION_DAYS = 14;
const LOG_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ROTATED_LOG_PATTERN = /^(?:combined|error|security)\d+\.log$/;

/** Remove only old, numbered files created by Winston's tailable rotation. */
async function cleanupRotatedLogs(logDir, { now = Date.now(), retentionDays = LOG_RETENTION_DAYS } = {}) {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const entries = await fs.promises.readdir(logDir, { withFileTypes: true });
  const removed = [];

  for (const entry of entries) {
    if (!entry.isFile() || !ROTATED_LOG_PATTERN.test(entry.name)) continue;

    const filePath = path.join(logDir, entry.name);
    let stats;
    try {
      stats = await fs.promises.stat(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (stats.mtimeMs >= cutoff) continue;

    try {
      await fs.promises.unlink(filePath);
      removed.push(entry.name);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  return removed;
}

function startLogRetentionCleanup({
  logDir,
  logger,
  retentionDays = LOG_RETENTION_DAYS,
  intervalMs = LOG_CLEANUP_INTERVAL_MS,
}) {
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const removed = await cleanupRotatedLogs(logDir, { retentionDays });
      if (removed.length) {
        logger.info('Expired rotated log files removed', { count: removed.length, retentionDays });
      }
    } catch (error) {
      logger.warn('Rotated log retention cleanup failed', { error: error.message });
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = {
  LOG_MAX_SIZE_BYTES,
  LOG_MAX_FILES,
  LOG_RETENTION_DAYS,
  cleanupRotatedLogs,
  startLogRetentionCleanup,
};
