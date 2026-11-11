const express = require('express');
const rateLimit = require('express-rate-limit');
const shareService = require('../services/cloudDeliveryShareService');

const router = express.Router();
const unlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ code: 'SHARE_TRY_AGAIN_LATER', error: '尝试次数过多，请稍后再试' }),
});

router.post('/:token/unlock', unlockLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  try {
    if (typeof req.body?.password !== 'string' || req.body.password.length > 200) {
      return res.status(400).json({ code: 'SHARE_PASSWORD_REQUIRED', error: '请输入分享密码' });
    }
    const result = await shareService.unlockShare(req.params.token, req.body.password);
    return res.json(result);
  } catch (error) {
    const status = error.status === 401 ? 401 : error.status === 429 ? 429 : error.status === 400 ? 400 : 410;
    return res.status(status).json({
      code: status === 401 ? 'SHARE_PASSWORD_INVALID' : status === 429 ? 'SHARE_TRY_AGAIN_LATER' : 'SHARE_UNAVAILABLE',
      error: status === 401 ? '密码错误' : status === 429 ? '尝试次数过多，请稍后再试' : '此分享链接无效、已过期或暂不可用',
    });
  }
});

module.exports = router;
