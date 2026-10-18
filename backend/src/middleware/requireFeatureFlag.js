/**
 * requireFeatureFlag(key, code?) — 403 when the named `feature_flags` row is off.
 *
 * Belt-and-braces gate for admin routes whose feature can be toggled in
 * Settings → Features. The frontend hides disabled surfaces, but a direct API
 * hit must still be refused so a disabled feature is never actable. Mirrors the
 * accepted enabled values are shared by the API gate and settings response
 * (true, 1, '1', 'true', 'yes', 'on'). In particular, strings such as '0'
 * and 'false' must never become enabled merely because they are non-empty.
 *
 * Cached: several gated endpoints and the dashboard
 * polls several, so a per-request DB read is wasteful. Flags change rarely and
 * only via `PUT /admin/feature-flags`, which calls invalidateFeatureFlagCache()
 * — so a short TTL is belt-and-braces against any other mutation path.
 *
 * Several route files (adminLedger, adminExpenses) predate this and define an
 * identical local `requireFlag`; new gates should import this instead.
 */
const { db } = require('../database/db');

const TTL_MS = 10_000;
const cache = new Map(); // key -> { enabled, expires }

function flagEnabledFromValue(value) {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function flagEnabledFromRow(row) {
  return !!row && flagEnabledFromValue(row.value);
}

async function isFeatureEnabled(key) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.enabled;
  const row = await db('feature_flags').where({ key }).first();
  const enabled = flagEnabledFromRow(row);
  cache.set(key, { enabled, expires: now + TTL_MS });
  return enabled;
}

/** Clear the flag cache — call after any write to feature_flags. */
function invalidateFeatureFlagCache() {
  cache.clear();
}

function requireFeatureFlag(key, code) {
  return async (req, res, next) => {
    try {
      if (await isFeatureEnabled(key)) return next();
      return res.status(403).json({
        error: `${key} feature is disabled`,
        code: code || `${key.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}_DISABLED`,
      });
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requireFeatureFlag, isFeatureEnabled, invalidateFeatureFlagCache, flagEnabledFromValue };
