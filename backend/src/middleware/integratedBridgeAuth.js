const { db } = require('../database/db');
const { formatBoolean } = require('../utils/dbCompat');
const { adminAuth } = require('./auth');

const HEADER = 'x-picpeak-integrated-bridge';

function isLoopback(address) {
  const value = String(address || '').toLowerCase().replace(/^::ffff:/, '');
  return value === '127.0.0.1' || value === '::1';
}

async function integratedBridgeAuth(req, res, next) {
  const enabled = /^(1|true)$/i.test(process.env.PICPEAK_INTEGRATED_BRIDGE || '');
  const method = String(req.method || '').toUpperCase();
  const path = String(req.path || '');
  const permittedRoute = ['GET', 'POST'].includes(method)
    && /^\/events\/\d+\/photos\/?$/.test(path);
  const remoteAddress = req.socket?.remoteAddress || req.connection?.remoteAddress;

  if (enabled && permittedRoute && req.headers?.[HEADER] === '1' && isLoopback(remoteAddress)) {
    try {
      const admin = await db('admin_users')
        .join('roles', 'roles.id', 'admin_users.role_id')
        .where({ 'roles.name': 'super_admin', 'admin_users.is_active': formatBoolean(true) })
        .orderBy('admin_users.id', 'asc')
        .select('admin_users.id', 'admin_users.username', 'admin_users.must_change_password')
        .first();
      if (!admin) return res.status(503).json({ error: '请先完成 Picflow 管理员初始化', code: 'BRIDGE_NOT_READY' });
      if ([true, 1, '1', 'true'].includes(admin.must_change_password)) {
        return res.status(403).json({ error: '请先完成管理员密码设置', code: 'MUST_CHANGE_PASSWORD' });
      }
      req.admin = { id: admin.id, username: admin.username, roleName: 'super_admin' };
      return next();
    } catch (error) {
      return next(error);
    }
  }

  // Admin sessions are accepted for the first-party workflow UI and test
  // harness. The unattended Bridge process can use only the constrained
  // loopback path above.
  return adminAuth(req, res, next);
}

module.exports = { integratedBridgeAuth, isLoopback };
