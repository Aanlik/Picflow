const { isGalleryAvailable } = require('../utils/galleryLifecycle');
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');

const { db } = require('../database/db');
const { formatBoolean } = require('../utils/dbCompat');
const {
  trackFailedAttempt,
  trackSuccessfulLogin,
  checkAccountLockout,
  checkSuspiciousActivity,
  getGenericAuthError
} = require('../utils/authSecurity');
const { endSession } = require('../middleware/sessionTimeout');
const { revokeToken } = require('../utils/tokenRevocation');
const { timingSafeEqualStr } = require('../utils/timingSafe');
// Well-formed bcrypt hash that matches nothing; compared against when there is
// no account so the unknown-user path costs the same as a wrong password.
const DUMMY_BCRYPT_HASH = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234';
const logger = require('../utils/logger');
const { errorResponse, safeValidationErrors } = require('../utils/routeHelpers');
const {
  setAdminAuthCookie,
  clearAdminAuthCookie,
  setGalleryAuthCookies,
  clearGalleryAuthCookies,
  getAdminTokenFromRequest,
  getGalleryTokenFromRequest,
} = require('../utils/tokenUtils');
const { getEventShareToken, resolveShareIdentifier } = require('../services/shareLinkService');
const { getClientIp } = require('../utils/requestIp');
const { sanitizePasswordInput } = require('../utils/passwordInput');
const {
  validatePasswordInContext,
  MAX_PASSWORD_LENGTH,
  getBcryptRounds,
  logPasswordValidationFailure
} = require('../utils/passwordValidation');
const router = express.Router();

/**
 * Finish a successful admin login: reset the lockout counter, stamp
 * last_login, mint the 24h admin JWT, set the HttpOnly cookie, and return the
 * user payload. `lockoutKey` is the username used for lockout tracking.
 */
async function establishAdminSession(res, admin, ipAddress, userAgent, lockoutKey, { rememberMe = false } = {}) {
  await trackSuccessfulLogin(lockoutKey, ipAddress, userAgent);

  await db('admin_users').where('id', admin.id).update({
    last_login: new Date(),
    last_login_ip: ipAddress
  });

  const token = jwt.sign({
    id: admin.id,
    username: admin.username,
    type: 'admin',
    role: admin.role_name,
    ip: ipAddress,
    loginTime: Date.now(),
    // In the payload, not just in the expiry, because the idle-timeout
    // middleware has to see it: a 30-day token is worth nothing if
    // sessionTimeoutMiddleware still logs the session out after an hour.
    rememberMe
  }, process.env.JWT_SECRET, {
    // "Remember me" (#1186). Opt-in: unchecked behaviour is unchanged at 24h,
    // so the longer window only exists where somebody asked for it. The cookie
    // below is given the matching max-age — if the two disagree the session
    // either dies early or outlives its token.
    expiresIn: rememberMe ? '30d' : '24h',
    issuer: 'picpeak-auth'
  });

  setAdminAuthCookie(res, token, { rememberMe });

  return {
    id: admin.id,
    username: admin.username,
    mustChangePassword: admin.must_change_password || false,
    role: admin.role_name ? {
      name: admin.role_name,
      displayName: admin.role_display_name
    } : null
  };
}

async function completeAdminLogin(req, res, admin, ipAddress, userAgent, lockoutKey, { rememberMe = false } = {}) {
  const user = await establishAdminSession(res, admin, ipAddress, userAgent, lockoutKey, { rememberMe });
  return res.json({ user });
}

// Admin login with enhanced security
router.post('/admin/login', [
  // Length caps: an unbounded username reached the lockout lookup, bcrypt,
  // the failed-attempt log line and login_attempts.identifier as sent.
  body('username').isString().trim().notEmpty().isLength({ max: 255 }),
  body('password').isString().notEmpty().isLength({ max: MAX_PASSWORD_LENGTH }),
  // Optional and boolean-coerced: an absent or malformed value means "no",
  // so a client that never sends it keeps the 24h session it always had.
  body('remember_me').optional().isBoolean().toBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: safeValidationErrors(errors) });
    }

    const { username, password } = req.body;
    // Validator above coerces this to a real boolean and leaves it undefined
    // when absent, so the fallback keeps the historical 24h session (#1186).
    const rememberMe = req.body.remember_me === true;
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';

    // Check account lockout first. Scoped to identifier + source IP like the
    // gallery/client paths: anonymous failures from one address must not
    // deny a correct login from every other address.
    const lockoutStatus = await checkAccountLockout(username, ipAddress);
    if (lockoutStatus.isLocked) {
      logger.warn('Login attempt on locked account', { username, ipAddress });
      return res.status(423).json({
        error: 'Account temporarily locked due to too many failed attempts',
        retryAfter: lockoutStatus.remainingTime
      });
    }

    // Check for suspicious activity
    const isSuspicious = await checkSuspiciousActivity(username, ipAddress);
    if (isSuspicious) {
      // Still allow login but log it
      logger.warn('Suspicious login pattern detected', { username, ipAddress });
    }

    // Fetch admin with role information
    const admin = await db('admin_users')
      .leftJoin('roles', 'roles.id', 'admin_users.role_id')
      .where('admin_users.username', username)
      .select(
        'admin_users.*',
        'roles.name as role_name',
        'roles.display_name as role_display_name'
      )
      .first();

    // Use a generic error to prevent user enumeration.
    // Always run one bcrypt compare so an unknown username costs the same
    // ~100ms as a wrong password; short-circuiting here was a timing oracle
    // for username enumeration despite the generic message.
    const passwordMatches = admin
      ? await bcrypt.compare(password, admin.password_hash)
      : await bcrypt.compare(password, DUMMY_BCRYPT_HASH).then(() => false);
    if (!passwordMatches) {
      await trackFailedAttempt(username, ipAddress, userAgent);
      return res.status(401).json({ error: getGenericAuthError() });
    }

    if (!admin.is_active) {
      await trackFailedAttempt(username, ipAddress, userAgent);
      return res.status(401).json({ error: getGenericAuthError() });
    }

    return await completeAdminLogin(req, res, admin, ipAddress, userAgent, username, { rememberMe });
  } catch (error) {
    errorResponse(res, error, 500, 'Login failed');
  }
});

// Logout endpoint
router.post('/logout', async (req, res) => {
  try {
    // This endpoint belongs to photographer/admin sessions. Gallery sessions
    // have their own `/gallery/logout` endpoint and must remain active when an
    // admin cookie is missing, stale, or another client happens to send a
    // gallery bearer token here.
    const token = req.cookies?.admin_token || getAdminTokenFromRequest(req);
    if (token) {
      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET, {
          algorithms: ['HS256'],
          ignoreExpiration: true,
        });
      } catch {
        // Expired or invalid admin cookies still need to be cleared, but must
        // never cause a gallery cookie to be touched.
        clearAdminAuthCookie(res);
        return res.json({ message: 'Logged out successfully' });
      }

      if (decoded.type === 'admin') {
        // Revoke the token so it cannot be reused, then end its idle session.
        if (!await revokeToken(token, 'user_logout')) {
          throw new Error('Token revocation failed');
        }
        endSession(token);
        logger.info('User logged out', {
          userId: decoded.id,
          username: decoded.username,
          type: decoded.type,
        });
      }
    }

    clearAdminAuthCookie(res);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    clearAdminAuthCookie(res);
    errorResponse(res, error, 500, 'Logout failed');
  }
});

// Gallery password verification with enhanced security
router.post('/gallery/verify', [
  body('slug').isString().trim().notEmpty().isLength({ max: 255 }),
  body('password').optional().isString().isLength({ max: MAX_PASSWORD_LENGTH })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: safeValidationErrors(errors) });
    }

    const { slug, password } = req.body;
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    const event = await db('events')
      .where({ slug, is_active: formatBoolean(true), is_archived: formatBoolean(false) })
      .first();

    if (!isGalleryAvailable(event)) {
      // Perform a dummy bcrypt compare to prevent timing-based slug enumeration
      await bcrypt.compare(password || '', DUMMY_BCRYPT_HASH);
      await trackFailedAttempt(`gallery:${slug}`, ipAddress, userAgent);
      return res.status(401).json({ error: 'Invalid gallery or password' });
    }

    const requiresPassword = !(event.require_password === false || event.require_password === 0 || event.require_password === '0');

    if (requiresPassword) {
      const lockoutStatus = await checkAccountLockout(`gallery:${slug}`, ipAddress);
      if (lockoutStatus.isLocked) {
        logger.warn('Gallery access attempt on locked gallery', { slug, ipAddress });
        return res.status(423).json({
          error: 'Too many failed attempts. Please try again later.',
          retryAfter: lockoutStatus.remainingTime
        });
      }

      if (!password) {
        await trackFailedAttempt(`gallery:${slug}`, ipAddress, userAgent);
        return res.status(401).json({ error: 'Invalid gallery or password' });
      }

      let validPassword = await bcrypt.compare(password, event.password_hash);
      if (!validPassword) {
        // Passwords copy-pasted out of chat apps carry invisible Unicode
        // that fails the byte-exact compare (#654). Retry the compare with
        // those characters stripped — in the SAME request. Exact bytes
        // are tried first so stored passwords that legitimately contain
        // such characters keep working.
        const sanitized = sanitizePasswordInput(password);
        if (sanitized !== password) {
          validPassword = await bcrypt.compare(sanitized, event.password_hash);
        }
      }
      if (!validPassword) {
        await trackFailedAttempt(`gallery:${slug}`, ipAddress, userAgent);
        await db('access_logs').insert({
          event_id: event.id,
          ip_address: ipAddress,
          user_agent: userAgent,
          action: 'login_fail'
        });
        return res.status(401).json({ error: 'Invalid gallery or password' });
      }

      await trackSuccessfulLogin(`gallery:${slug}`, ipAddress, userAgent);
      await db('access_logs').insert({
        event_id: event.id,
        ip_address: ipAddress,
        user_agent: userAgent,
        action: 'login_success'
      });
    } else {
      logger.info('Public gallery access granted without password', { slug, ipAddress });
      await trackSuccessfulLogin(`gallery:${slug}`, ipAddress, userAgent);
      await db('access_logs').insert({
        event_id: event.id,
        ip_address: ipAddress,
        user_agent: userAgent,
        action: 'login_success'
      });
    }

    const token = jwt.sign({
      eventId: event.id,
      eventSlug: event.slug,
      type: 'gallery',
      // Unique per token: the revocation key falls back to eventId+iat otherwise,
      // so one guest's logout would revoke every same-second login (#1357).
      jti: crypto.randomUUID(),
      ip: ipAddress,
      loginTime: Date.now()
    }, process.env.JWT_SECRET, {
      expiresIn: '24h',
      issuer: 'picpeak-auth'
    });

    setGalleryAuthCookies(res, token, event.slug);

    res.json({
      token,
      event: {
        id: event.id,
        event_name: event.event_name,
        event_date: event.event_date,
        color_theme: event.color_theme,
        expires_at: event.expires_at,
        allow_user_uploads: event.allow_user_uploads,
        upload_category_id: event.upload_category_id,
        require_password: requiresPassword,
        photo_cap: event.photo_cap
      }
    });
  } catch (error) {
    errorResponse(res, error, 500, 'Verification failed');
  }
});

// Client access login (PIN-based)
router.post('/gallery/:slug/client-login', [
  body('password').notEmpty().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: safeValidationErrors(errors) });
    }

    const { slug } = req.params;
    const { password } = req.body;
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';

    const event = await db('events')
      .where({ slug, is_active: formatBoolean(true), is_archived: formatBoolean(false) })
      .first();

    if (!isGalleryAvailable(event) || !event.client_access_enabled || !event.client_password_hash
      || !event.client_share_token || typeof req.body.token !== 'string'
      || !timingSafeEqualStr(req.body.token, event.client_share_token)) {
      await trackFailedAttempt(`client:${slug}`, ipAddress, userAgent);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const lockoutStatus = await checkAccountLockout(`client:${slug}`, ipAddress);
    if (lockoutStatus.isLocked) {
      return res.status(423).json({
        error: 'Too many failed attempts. Please try again later.',
        retryAfter: lockoutStatus.remainingTime
      });
    }

    const validPassword = await bcrypt.compare(password, event.client_password_hash);
    if (!validPassword) {
      await trackFailedAttempt(`client:${slug}`, ipAddress, userAgent);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await trackSuccessfulLogin(`client:${slug}`, ipAddress, userAgent);

    const token = jwt.sign({
      eventId: event.id,
      eventSlug: event.slug,
      type: 'gallery',
      // Unique per token: the revocation key falls back to eventId+iat otherwise,
      // so one guest's logout would revoke every same-second login (#1357).
      jti: crypto.randomUUID(),
      accessLevel: 'client',
      ip: ipAddress,
      loginTime: Date.now()
    }, process.env.JWT_SECRET, {
      expiresIn: '24h',
      issuer: 'picpeak-auth'
    });

    setGalleryAuthCookies(res, token, event.slug);

    res.json({
      token,
      event: {
        id: event.id,
        event_name: event.event_name,
        event_date: event.event_date,
        color_theme: event.color_theme,
        expires_at: event.expires_at,
        allow_user_uploads: event.allow_user_uploads,
        upload_category_id: event.upload_category_id,
        require_password: true
      },
      accessLevel: 'client'
    });
  } catch (error) {
    errorResponse(res, error, 500, 'Authentication failed');
  }
});

// Share link authentication (token-based)
router.post('/gallery/share-login', [
  body('slug').notEmpty().trim(),
  body('token').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: safeValidationErrors(errors) });
    }

    const { slug, token } = req.body;
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';

    // Rate limit share-link login attempts
    const shareIdentifier = `gallery:${slug}:share`;
    const lockoutStatus = await checkAccountLockout(shareIdentifier, ipAddress);
    if (lockoutStatus.isLocked) {
      logger.warn('Share link login attempt on locked gallery', { slug, ipAddress });
      return res.status(423).json({
        error: 'Too many failed attempts. Please try again later.',
        retryAfter: lockoutStatus.remainingTime
      });
    }

    let event = await db('events')
      .where({ slug, is_active: formatBoolean(true), is_archived: formatBoolean(false) })
      .first();

    if (!isGalleryAvailable(event)) {
      const resolved = await resolveShareIdentifier(slug);
      if (resolved?.event) {
        event = resolved.event;
      }
    }

    if (!isGalleryAvailable(event)) {
      await trackFailedAttempt(shareIdentifier, ipAddress, userAgent);
      return res.status(404).json({ error: 'Gallery not found' });
    }

    const expectedToken = getEventShareToken(event);

    if (!expectedToken || !timingSafeEqualStr(token, expectedToken)) {
      await trackFailedAttempt(shareIdentifier, ipAddress, userAgent);
      return res.status(401).json({ error: 'Invalid or expired share link' });
    }

    const requiresPassword = !(event.require_password === false || event.require_password === 0 || event.require_password === '0');

    // The share link only proves the holder was given the link — it is NOT the
    // gallery password. For a password-protected gallery, minting a full
    // `type:'gallery'` token here would let anyone with the share URL bypass
    // the password entirely (GHSA-9hmx-68vc-qpqw). Signal that a password is
    // still required and return WITHOUT a token/cookie; the client then goes
    // through POST /gallery/verify, which does check the password.
    if (requiresPassword) {
      return res.json({ requires_password: true });
    }

    const jwtToken = jwt.sign({
      eventId: event.id,
      eventSlug: event.slug,
      type: 'gallery',
      // Unique per token: the revocation key falls back to eventId+iat otherwise,
      // so one guest's logout would revoke every same-second login (#1357).
      jti: crypto.randomUUID(),
      ip: ipAddress,
      loginTime: Date.now()
    }, process.env.JWT_SECRET, {
      expiresIn: '24h',
      issuer: 'picpeak-auth'
    });

    await trackSuccessfulLogin(`gallery:${event.slug}:share`, ipAddress, userAgent);
    setGalleryAuthCookies(res, jwtToken, event.slug);

    res.json({
      token: jwtToken,
      event: {
        id: event.id,
        event_name: event.event_name,
        event_date: event.event_date,
        color_theme: event.color_theme,
        expires_at: event.expires_at,
        allow_user_uploads: event.allow_user_uploads,
        upload_category_id: event.upload_category_id,
        require_password: requiresPassword,
        photo_cap: event.photo_cap
      }
    });
  } catch (error) {
    errorResponse(res, error, 500, 'Share link login failed');
  }
});

// Gallery logout to clear cookies and revoke token
router.post('/gallery/logout', async (req, res) => {
  try {
    const { slug } = req.body || {};
    const token = getGalleryTokenFromRequest(req, slug);
    if (token) {
      if (!await revokeToken(token, 'gallery_logout')) {
        throw new Error('Token revocation failed');
      }
    }
    clearGalleryAuthCookies(res, slug);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    clearGalleryAuthCookies(res, req.body?.slug);
    errorResponse(res, error, 500, 'Logout failed');
  }
});

// Get current session info
router.get('/session', async (req, res) => {
  try {
    const { slug } = req.query;
    // When ?slug= is present the caller is asking specifically about gallery
    // auth (GalleryAuthContext), so prefer the gallery token. Otherwise an
    // admin session in the same browser could mask the active gallery token.
    const token = slug
      ? (getGalleryTokenFromRequest(req, slug) || getAdminTokenFromRequest(req))
      : (getAdminTokenFromRequest(req) || getGalleryTokenFromRequest(req, slug));

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    try {
      // Verify with the same `issuer` claim that adminAuth/galleryAuth
      // require (#350 — without this, /auth/session accepted pre-issuer
      // tokens and the frontend thought the user was authenticated, but
      // every protected endpoint rejected them with 401, producing a
      // /admin/login → /admin/dashboard → /admin/login redirect loop).
      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        issuer: 'picpeak-auth'
      });

      const sessions = require('../services/sessionAccessService');
      let adminUser = null;
      if (decoded.type === 'admin') {
        const admin = await sessions.admin(decoded, { includeProfile: true });
        const { isSessionExpired } = require('../middleware/sessionTimeout');
        if (await isSessionExpired(token, decoded)) {
          return res.json({ valid: false, error: 'Session expired' });
        }
        adminUser = {
          id: admin.id, username: admin.username,
          mustChangePassword: !!admin.must_change_password,
          role: admin.role_name ? { name: admin.role_name, displayName: admin.role_display_name } : null,
        };
      } else if (decoded.type === 'gallery') {
        const access = require('../services/galleryAccessService');
        const event = await db('events').where({ id: decoded.eventId }).first();
        if (!event) return res.json({ valid: false, error: 'Gallery no longer available' });
        await access.authorize(event, access.grant(event, 'gallery', decoded));
      } else {
        return res.status(403).json({ valid: false, error: 'Invalid token type' });
      }

      // Calculate remaining time
      const now = Date.now() / 1000;
      const remainingTime = Math.max(0, decoded.exp - now);

      res.json({
        valid: true,
        type: decoded.type,
        expiresIn: Math.floor(remainingTime),
        user: decoded.username || decoded.eventSlug,
        eventSlug: decoded.eventSlug,
        adminUsername: decoded.username,
        // What KIND of gallery session this cookie is (#1149). The frontend
        // kept this in sessionStorage, which is per-tab: reopening a gallery
        // in a second tab lost 'client' while the cookie — and therefore the
        // backend — still treated it as one. Reported from the token so a
        // restored session knows what it actually is.
        //
        accessLevel: decoded.type === 'gallery' ? (decoded.accessLevel || 'guest') : undefined,
        // Full admin payload (or null) — lets the SPA hydrate its user
        // state after a redirect-established session where no login JSON
        // response ever reached it.
        adminUser
      });
    } catch (err) {
      res.json({
        valid: false,
        error: 'Invalid or expired token'
      });
    }
  } catch (error) {
    res.status(500).json({ error: 'Session check failed' });
  }
});

// Admin password change with validation
router.post('/admin/change-password', [
  body('currentPassword').notEmpty(),
  body('newPassword').notEmpty(),
  body('confirmPassword').notEmpty()
    .custom((value, { req }) => value === req.body.newPassword)
    .withMessage('Passwords do not match')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: safeValidationErrors(errors) });
    }

    const { currentPassword, newPassword } = req.body;
    const ipAddress = getClientIp(req);

    // Get admin from request (should be set by auth middleware)
    if (!req.admin) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const adminId = req.admin.id;

    // Get admin user
    const admin = await db('admin_users').where({ id: adminId }).first();
    if (!admin) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, admin.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Validate new password
    const passwordValidation = validatePasswordInContext(newPassword, 'admin', {
      username: admin.username
    });

    if (!passwordValidation.valid) {
      logPasswordValidationFailure('admin_password_change', passwordValidation.errors, {
        userId: adminId,
        username: admin.username
      });

      return res.status(400).json({
        error: 'Password does not meet security requirements',
        details: passwordValidation.errors,
        score: passwordValidation.score,
        feedback: passwordValidation.feedback
      });
    }

    // Hash new password with configurable rounds
    const hashedPassword = await bcrypt.hash(newPassword, getBcryptRounds());

    // Update password and track change time
    await db('admin_users').where('id', adminId).update({
      password_hash: hashedPassword,
      password_changed_at: new Date(),
      must_change_password: false
    });

    // Log password change
    logger.info('Admin password changed', {
      userId: adminId,
      username: admin.username,
      ip: ipAddress
    });

    res.json({
      message: 'Password changed successfully',
      score: passwordValidation.score
    });
  } catch (error) {
    errorResponse(res, error, 500, 'Failed to change password');
  }
});

// Password strength check endpoint (for real-time validation)
//
// Unauthenticated, and it feeds the request body straight into zxcvbn, whose
// matching is superlinear and synchronous. Without the length bound a single
// request stops the event loop for the whole process -- ~5s at 1,000
// characters and unbounded past that. validatePassword() enforces the same cap
// for every caller; this one keeps the oversized body from being accepted at
// the edge at all.
router.post('/password-strength', [
  body('password').isString().isLength({ min: 1, max: MAX_PASSWORD_LENGTH })
    .withMessage(`Password must be 1-${MAX_PASSWORD_LENGTH} characters`),
  body('context').isIn(['admin', 'gallery']).optional()
], async (req, res) => {
  try {
    // The validators above only RECORD errors; without this the oversized body
    // reached zxcvbn anyway and the endpoint answered 200, so the edge cap was
    // decorative. The cap in validatePassword() is still the real control.
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: safeValidationErrors(errors) });
    }

    const { password, context = 'gallery' } = req.body;

    // Get user data if available (for context-aware validation)
    const userData = {};
    if (context === 'admin' && req.admin) {
      userData.username = req.admin.username;
    }

    // validatePasswordInContext is async; unawaited this resolved to a Promise
    // and every field below came back undefined.
    const validation = await validatePasswordInContext(password, context, userData);

    res.json({
      valid: validation.valid,
      score: validation.score,
      errors: validation.errors,
      feedback: validation.feedback
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check password strength' });
  }
});

module.exports = router;
