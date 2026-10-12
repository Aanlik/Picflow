/**
 * The 50 MB JSON parser, for callers who have already proven who they are.
 *
 * Admin surfaces need large bodies (restore manifests, CMS and larger
 * operations). Mounted plainly on /api/admin the parser ran before any
 * authentication, so anyone could hand
 * JSON.parse a 50 MB nested body and block the event loop, bounded only by
 * the general rate limiter (security review 2026-09-29).
 *
 * This middleware parses at the large limit only when the request carries an
 * admin JWT adminAuth would accept right now (liveAdminSession: signature,
 * revocation, cutoff, active account, password change, idle timeout). Anything
 * else falls through untouched to the ordinary 2 MB parser registered after
 * it, so an unauthenticated oversized body is refused with 413 before it is
 * ever parsed. Presence of a header is not enough — a forged cookie or a
 * made-up Bearer token must cost the attacker the same as no token at all.
 *
 * The full authentication still happens in adminAuth afterwards; this only decides the body
 * limit — and it decides it only when the decision matters. A body that
 * cannot exceed the ordinary limit (an uncompressed JSON body whose
 * Content-Length is within it, or no JSON body at all) goes straight to the
 * ordinary parser without any authentication lookup. A request that merely
 * carries a made-up Bearer header costs the database nothing unless it also
 * claims a body the small parser would refuse.
 */
const express = require('express');
const { getAdminTokenFromRequest } = require('../utils/tokenUtils');
const { verifyLiveAdminJwt } = require('../utils/liveAdminSession');

async function hasVerifiedAdminJwt(req) {
  const token = getAdminTokenFromRequest(req);
  if (!token) return false;
  return !!(await verifyLiveAdminJwt(token));
}

/**
 * Could this body be more than the ordinary parser accepts? Only a JSON body
 * whose declared length is over the small limit, or a chunked JSON body with
 * no declared length, needs the large parser at all.
 */
function mightExceed(req, fallbackLimitBytes) {
  if (!req.is('application/json')) return false;
  // express.json inflates gzip/deflate bodies and applies its limit to the
  // inflated size, so a compressed Content-Length says nothing about it.
  const encoding = String(req.headers['content-encoding'] || 'identity').trim().toLowerCase();
  if (encoding !== 'identity') return true;
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared)) return declared > fallbackLimitBytes;
  return /chunked/i.test(req.headers['transfer-encoding'] || '');
}

function createLargeJsonBody({ limit = '50mb', fallbackLimitBytes = 2 * 1024 * 1024 } = {}) {
  const parser = express.json({ limit });
  return async function largeJsonBody(req, res, next) {
    try {
      if (!mightExceed(req, fallbackLimitBytes)) return next();
      if (await hasVerifiedAdminJwt(req)) {
        return parser(req, res, next);
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { createLargeJsonBody, hasVerifiedAdminJwt, mightExceed };
