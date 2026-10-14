const express = require('express');
const os = require('os');
const { adminAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const logger = require('../utils/logger');
const { checkLatestRelease } = require('../services/githubUpdateService');
const appVersion = require('../../package.json').version || '1.0.2';
const buildVersion = process.env.PICFLOW_BUILD_VERSION || process.env.PHOFLOW_BUILD_VERSION || process.env.PICPEAK_BUILD_VERSION || '1.0.2';
const buildRevision = process.env.PICFLOW_BUILD_REVISION || process.env.GITHUB_SHA || null;

const router = express.Router();

router.get('/version', adminAuth, requirePermission(['settings.view', 'system.view']), async (_req, res) => {
  try {
    res.json({
      backend: appVersion,
      frontend: appVersion,
      build: buildVersion,
      revision: buildRevision,
      node: process.version,
      environment: process.env.NODE_ENV || 'production',
    });
  } catch (error) {
    logger.error('Error fetching version:', error);
    res.status(500).json({ error: 'Failed to fetch version information' });
  }
});

// GitHub checks are explicitly user-triggered in the settings UI. Never poll
// the public API in the background or install releases automatically.
router.get('/updates', adminAuth, requirePermission(['settings.view', 'system.view']), async (_req, res) => {
  try {
    const currentVersion = buildVersion;
    res.json(await checkLatestRelease(currentVersion));
  } catch (error) {
    logger.warn('Picflow GitHub update check failed:', { code: error.code || 'GITHUB_NETWORK_ERROR', status: error.status || null });
    res.status(502).json({
      error: '暂时无法连接 GitHub 检查更新，请稍后重试。',
      code: error.code || 'GITHUB_NETWORK_ERROR',
      ...(error.status ? { upstream_status: error.status } : {}),
    });
  }
});

// Runtime health only.
router.get('/status', adminAuth, requirePermission(['settings.view', 'system.view']), (_req, res) => {
  const cpus = os.cpus();
  res.json({
    system: {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptime: Math.floor(process.uptime()),
      nodeVersion: process.version,
      memory: { total: os.totalmem(), free: os.freemem(), used: os.totalmem() - os.freemem() },
      cpu: { model: cpus[0]?.model || 'Unknown', cores: cpus.length },
    },
    services: {
      fileWatcher: { status: 'active' },
      expirationChecker: { status: 'active' },
    },
    timestamp: new Date(),
  });
});

module.exports = router;
