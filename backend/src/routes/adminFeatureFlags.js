/**
 * Feature flags admin endpoints (#feature-flags-settings-reorg).
 *
 * GET  /api/admin/feature-flags  → { [key]: boolean }
 * PUT  /api/admin/feature-flags  → body { [key]: boolean }, replaces in tx
 *
 * Galleries is always enabled because it is the core product surface.
 *
 * Audit log: every successful PUT writes one activity_logs row with the
 * before/after diff so changes are traceable.
 */

const express = require('express');
const router = express.Router();
const { db, logActivity } = require('../database/db');
const { adminAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { invalidateFeatureFlagCache } = require('../middleware/requireFeatureFlag');
const logger = require('../utils/logger');

// Canonical flag list. Keep in sync with the `FeatureKey` union in
// frontend/src/services/featureFlags.service.ts.
const KNOWN_FLAGS = [
  'galleries',
  'userManagement',
  // Live Slideshow ("Diashow") — the per-event fullscreen kiosk link and
  // global watermark defaults tab. Strictly opt-in;
  // gates all slideshow admin UI (per-event card, type preset, settings tab).
  'slideshow',
  // PicTransfer (migration 170) — cross-event file transfers
  // (recipient download link + optional client-upload channel). Strictly
  // opt-in; gates the sidebar entry, the /admin/transfers area AND every
  // transfer route (admin + public token routes).
  'transfers',
];

// Spec defaults for any flag missing from the DB (e.g. a row added by a
// new release that hasn't run its migration yet on this instance).
const DEFAULT_FLAGS = {
  galleries: true,
  userManagement: true,
  slideshow: false,
  transfers: false,
};

async function readAllFlags() {
  const rows = await db('feature_flags').select('key', 'value');
  const result = { ...DEFAULT_FLAGS };
  for (const row of rows) {
    if (KNOWN_FLAGS.includes(row.key)) {
      result[row.key] = Boolean(row.value);
    }
  }
  return result;
}

function applyDependencyRules(flags) {
  const out = { ...flags };
  // Galleries is the foundation — never off.
  out.galleries = true;
  return out;
}

router.get('/', adminAuth, requirePermission(['settings.view', 'settings.features']), async (req, res) => {
  try {
    const flags = await readAllFlags();
    // Always run the rules so galleries remain enabled even if a stored flag
    // is stale or missing.
    res.json(applyDependencyRules(flags));
  } catch (error) {
    logger.error('Failed to read feature flags', { error: error.message });
    res.status(500).json({ error: 'Failed to read feature flags' });
  }
});

router.put('/', adminAuth, requirePermission('settings.features'), async (req, res) => {
  try {
    const body = req.body || {};
    if (typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Body must be an object of { key: boolean } pairs' });
    }

    // Validate keys + types up front.
    const cleaned = {};
    for (const [key, value] of Object.entries(body)) {
      if (!KNOWN_FLAGS.includes(key)) {
        return res.status(400).json({ error: `Unknown feature flag: ${key}` });
      }
      if (typeof value !== 'boolean') {
        return res.status(400).json({ error: `Flag ${key} must be boolean, got ${typeof value}` });
      }
      cleaned[key] = value;
    }

    const before = await readAllFlags();
    const merged = applyDependencyRules({ ...before, ...cleaned });

    // Compute diff for audit log.
    const changed = {};
    for (const key of KNOWN_FLAGS) {
      if (merged[key] !== before[key]) {
        changed[key] = { from: before[key], to: merged[key] };
      }
    }

    if (Object.keys(changed).length === 0) {
      // No-op write — return current state, skip audit log.
      return res.json(merged);
    }

    const adminId = req.admin?.id || null;
    const adminUsername = req.admin?.username || 'unknown';

    await db.transaction(async (trx) => {
      for (const key of KNOWN_FLAGS) {
        const value = merged[key];
        const existing = await trx('feature_flags').where({ key }).first();
        if (existing) {
          await trx('feature_flags')
            .where({ key })
            .update({ value, updated_at: trx.fn.now(), updated_by: adminId });
        } else {
          await trx('feature_flags').insert({ key, value, updated_by: adminId });
        }
      }
    });

    // Drop the requireFeatureFlag middleware's short-TTL cache so a toggle takes
    // effect immediately instead of after ≤10s.
    invalidateFeatureFlagCache();

    await logActivity(
      'feature_flags_updated',
      { changed, actor: adminUsername },
      null,
      { type: 'admin' }
    );

    res.json(merged);
  } catch (error) {
    logger.error('Failed to update feature flags', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to update feature flags' });
  }
});

module.exports = router;
