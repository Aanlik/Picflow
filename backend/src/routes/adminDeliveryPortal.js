const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const { db } = require('../database/db');
const { adminAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { requireEventOwnership } = require('../middleware/ownership');
const { parseBooleanInput } = require('../utils/parsers');
const { getBcryptRounds } = require('../utils/passwordValidation');
const portal = require('../services/deliveryPortalService');
const { getFrontendBaseUrl } = require('../utils/frontendUrl');

const router = express.Router();

function expiresAt(days) {
  return new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000);
}

router.get('/:id/delivery-portal/shares', adminAuth, requirePermission(['events.view', 'events.edit']), requireEventOwnership, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    const shares = await db('delivery_portal_shares')
      .where({ event_id: Number(req.params.id) })
      .select('id', 'recipient_name', 'expires_at', 'revoked_at', 'created_at')
      .orderBy('created_at', 'desc');
    res.json(shares.map((share) => ({
      ...share,
      expired: new Date(share.expires_at).getTime() <= Date.now(),
    })));
  } catch (_error) {
    res.status(503).json({ code: 'DELIVERY_PORTAL_LIST_FAILED', error: '读取已交付专区分享失败' });
  }
});

router.post('/:id/delivery-portal/shares', adminAuth, requirePermission('events.edit'), requireEventOwnership, [
  body('recipient_name').isString().trim().isLength({ min: 1, max: 120 }),
  body('password').isString().isLength({ min: 8, max: 72 }).custom((value) => Buffer.byteLength(value, 'utf8') <= 72),
  body('expires_in_days').isInt({ min: 1, max: 90 }).toInt(),
], async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ code: 'INVALID_DELIVERY_PORTAL_SHARE', errors: errors.array().map(({ value, ...rest }) => rest) });
    const event = await db('events').where({ id: Number(req.params.id) }).first();
    if (!event) return res.status(404).json({ code: 'PROJECT_NOT_FOUND', error: '项目不存在' });
    if (!parseBooleanInput(event.is_active, true) || parseBooleanInput(event.is_archived, false)
      || parseBooleanInput(event.is_archiving, false) || parseBooleanInput(event.is_draft, false)) {
      return res.status(409).json({ code: 'PROJECT_NOT_PUBLISHED', error: '仅已发布且未归档的项目可以分享已交付专区' });
    }

    const rawToken = portal.newPortalToken();
    const passwordHash = await bcrypt.hash(req.body.password, getBcryptRounds());
    const [insertedId] = await db('delivery_portal_shares').insert({
      event_id: event.id,
      recipient_name: req.body.recipient_name,
      token_hash: portal.tokenDigest(rawToken),
      token_encrypted: portal.encryptToken(rawToken),
      password_hash: passwordHash,
      expires_at: expiresAt(req.body.expires_in_days),
      created_by: req.admin.id,
    }).returning('id');
    const id = Number(insertedId?.id || insertedId);
    const base = (await getFrontendBaseUrl(req)).replace(/\/$/, '');
    const pathname = `/gallery/${encodeURIComponent(event.slug)}/delivery`;
    // Fragment credentials never travel in HTTP requests or referrer headers.
    const shareUrl = `${base}${pathname}#token=${encodeURIComponent(rawToken)}`;
    return res.status(201).json({
      id,
      recipient_name: req.body.recipient_name,
      share_url: shareUrl,
      expires_at: (await db('delivery_portal_shares').where({ id }).first('expires_at')).expires_at,
    });
  } catch (_error) {
    return res.status(503).json({ code: 'DELIVERY_PORTAL_CREATE_FAILED', error: '创建已交付专区分享失败' });
  }
});

router.get('/:id/delivery-portal/shares/:shareId/link', adminAuth, requirePermission('events.edit'), requireEventOwnership, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    const eventId = Number(req.params.id);
    const shareId = Number(req.params.shareId);
    if (!Number.isSafeInteger(shareId) || shareId < 1) {
      return res.status(400).json({ code: 'INVALID_SHARE_ID', error: '分享编号无效' });
    }
    const [event, share] = await Promise.all([
      db('events').where({ id: eventId }).first('slug'),
      db('delivery_portal_shares').where({ id: shareId, event_id: eventId }).first(),
    ]);
    if (!event || !share) return res.status(404).json({ code: 'DELIVERY_PORTAL_SHARE_NOT_FOUND', error: '分享链接不存在' });
    if (share.revoked_at || new Date(share.expires_at).getTime() <= Date.now()) {
      return res.status(410).json({ code: 'DELIVERY_PORTAL_SHARE_INACTIVE', error: '分享链接已撤销或过期' });
    }
    if (!share.token_encrypted) {
      return res.status(409).json({ code: 'DELIVERY_PORTAL_LINK_NOT_RECOVERABLE', error: '此链接由旧版本创建，无法重新读取；请新建链接后再分享' });
    }
    const token = portal.decryptToken(share.token_encrypted);
    if (portal.tokenDigest(token) !== share.token_hash) {
      return res.status(409).json({ code: 'DELIVERY_PORTAL_LINK_INVALID', error: '此分享链接无法验证，请新建链接' });
    }
    const base = (await getFrontendBaseUrl(req)).replace(/\/$/, '');
    const pathname = `/gallery/${encodeURIComponent(event.slug)}/delivery`;
    return res.json({ share_url: `${base}${pathname}#token=${encodeURIComponent(token)}` });
  } catch (_error) {
    return res.status(503).json({ code: 'DELIVERY_PORTAL_LINK_READ_FAILED', error: '读取分享链接失败' });
  }
});

router.delete('/:id/delivery-portal/shares/:shareId', adminAuth, requirePermission('events.edit'), requireEventOwnership, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    const eventId = Number(req.params.id);
    const shareId = Number(req.params.shareId);
    if (!Number.isSafeInteger(shareId) || shareId < 1) return res.status(400).json({ code: 'INVALID_SHARE_ID' });
    const changed = await db('delivery_portal_shares')
      .where({ id: shareId, event_id: eventId })
      .whereNull('revoked_at')
      .update({ revoked_at: new Date() });
    if (!changed) return res.status(404).json({ code: 'DELIVERY_PORTAL_SHARE_NOT_FOUND' });
    portal.invalidatePhotoScope(eventId);
    return res.json({ success: true });
  } catch (_error) {
    return res.status(503).json({ code: 'DELIVERY_PORTAL_REVOKE_FAILED', error: '撤销已交付专区分享失败' });
  }
});

module.exports = router;
