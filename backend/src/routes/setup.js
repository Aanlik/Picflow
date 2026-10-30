'use strict';

// Public first-run setup endpoints. They let a fresh instance create its first
// admin from the browser and self-close as soon as that account exists. The
// create endpoint is rate-limited at the app level.
const express = require('express');
const { body, validationResult } = require('express-validator');
const { safeValidationErrors } = require('../utils/routeHelpers');
const { MAX_PASSWORD_LENGTH } = require('../utils/passwordValidation');
const setupService = require('../services/setupService');
const { getClientIp } = require('../utils/requestIp');
const { setAdminAuthCookie } = require('../utils/tokenUtils');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/status', async (req, res) => {
  try {
    res.json(await setupService.getSetupStatus());
  } catch (err) {
    logger.error('[setup] status failed', { error: err.message });
    res.status(500).json({ error: 'Failed to read setup status' });
  }
});

router.post('/admin', [
  body('username').isString().trim().matches(/^[\p{L}\p{N}_-]{3,50}$/u).withMessage('Valid username required'),
  body('password').isString().notEmpty().isLength({ max: MAX_PASSWORD_LENGTH }).withMessage('Password is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: safeValidationErrors(errors) });
  }
  try {
    const { username, password } = req.body;
    const result = await setupService.createInitialAdmin({
      username,
      password,
      ip: getClientIp(req),
    });
    setAdminAuthCookie(res, result.token);
    // Token delivered via HttpOnly cookie only (mirrors admin login).
    res.status(201).json({ user: result.user });
  } catch (err) {
    if (err.statusCode) {
      // `field` (username/password) lets the client show a translated
      // message instead of rendering the raw English error verbatim.
      return res.status(err.statusCode).json({ error: err.message, field: err.details || undefined });
    }
    logger.error('[setup] createInitialAdmin failed', { error: err.message });
    return res.status(500).json({ error: 'Setup failed' });
  }
});

module.exports = router;
