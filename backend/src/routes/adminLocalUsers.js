'use strict';
const express = require('express');
const bcrypt = require('bcrypt');
const { db } = require('../database/db');
const { adminAuth } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/permissions');
const { validatePassword } = require('../utils/passwordValidation');
const { deleteWithHistory } = require('../services/changeHistory');
const router = express.Router();
router.use(adminAuth, requireSuperAdmin());
router.get('/', async (req, res, next) => {
  try {
    const users = await db('admin_users').leftJoin('roles', 'roles.id', 'admin_users.role_id')
      .select('admin_users.id', 'admin_users.username', 'admin_users.is_active', 'admin_users.role_id', 'roles.display_name as role');
    const roles = await db('roles').select('id', 'name', 'display_name');
    res.json({ users, roles });
  } catch (err) { next(err); }
});
router.post('/', async (req, res, next) => {
  try {
    const { username, password, role_id } = req.body;
    if (typeof username !== 'string' || !/^[\p{L}\p{N}_-]{3,50}$/u.test(username)) return res.status(400).json({ error: '用户名需为 3–50 位字母、数字、下划线或短横线' });
    if (typeof password !== 'string' || password.length > 128 || !validatePassword(password).valid) return res.status(400).json({ error: '密码不满足安全要求' });
    if (!Number.isSafeInteger(Number(role_id)) || !await db('roles').where('id', role_id).first()) return res.status(400).json({ error: '请选择有效角色' });
    // `admin_users.email` is a legacy non-null database column. Store an
    // internal invalid-domain placeholder; it is never used for login or shown.
    const user = { username, email: `${username}@local.invalid`, password_hash: await bcrypt.hash(password, 12), role_id: Number(role_id), is_active: true, must_change_password: true, created_at: new Date(), updated_at: new Date() };
    const result = await db('admin_users').insert(user).returning('id');
    res.status(201).json({ id: result[0]?.id || result[0], username });
  } catch (err) {
    if (/unique|duplicate/i.test(String(err.message))) return res.status(409).json({ error: '用户名已存在' });
    next(err);
  }
});

// Local accounts need an explicit lifecycle so temporary/testing accounts
// can be revoked without editing the database. The current operator and the
// last enabled super-admin are protected from lockout.
router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: '账号编号无效' });
    const target = await db('admin_users').where({ id }).first();
    if (!target) return res.status(404).json({ error: '账号不存在' });
    const updates = { updated_at: new Date() };
    if (Object.prototype.hasOwnProperty.call(req.body, 'role_id')) {
      const roleId = Number(req.body.role_id);
      const newRole = Number.isSafeInteger(roleId) ? await db('roles').where({ id: roleId }).first() : null;
      if (!newRole) {
        return res.status(400).json({ error: '请选择有效角色' });
      }
      const oldRole = await db('roles').where({ id: target.role_id }).first();
      if (oldRole?.name === 'super_admin' && newRole.name !== 'super_admin' && target.is_active) {
        const enabledAdmins = await db('admin_users').join('roles', 'roles.id', 'admin_users.role_id')
          .where('roles.name', 'super_admin').where('admin_users.is_active', true).count({ count: '*' }).first();
        if (Number(enabledAdmins?.count) <= 1) return res.status(409).json({ error: '至少保留一个启用的超级管理员' });
      }
      updates.role_id = roleId;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'is_active')) {
      if (typeof req.body.is_active !== 'boolean') return res.status(400).json({ error: '账号状态无效' });
      if (!req.body.is_active && Number(req.admin.id) === id) return res.status(409).json({ error: '不能停用当前登录账号' });
      if (!req.body.is_active) {
        const targetRole = await db('roles').where({ id: target.role_id }).first();
        if (targetRole?.name === 'super_admin') {
          const enabledAdmins = await db('admin_users').join('roles', 'roles.id', 'admin_users.role_id')
            .where('roles.name', 'super_admin').where('admin_users.is_active', true).count({ count: '*' }).first();
          if (Number(enabledAdmins?.count) <= 1) return res.status(409).json({ error: '至少保留一个启用的超级管理员' });
        }
      }
      updates.is_active = req.body.is_active;
    }
    if (Object.keys(updates).length === 1) return res.status(400).json({ error: '没有可更新的账号设置' });
    await db('admin_users').where({ id }).update(updates);
    const user = await db('admin_users').leftJoin('roles', 'roles.id', 'admin_users.role_id')
      .where('admin_users.id', id).select('admin_users.id', 'admin_users.username', 'admin_users.is_active', 'roles.display_name as role').first();
    res.json({ user });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: '账号编号无效' });
    if (Number(req.admin.id) === id) return res.status(409).json({ error: '不能删除当前登录账号' });
    const target = await db('admin_users').where({ id }).first();
    if (!target) return res.status(404).json({ error: '账号不存在' });
    const targetRole = await db('roles').where({ id: target.role_id }).first();
    if (targetRole?.name === 'super_admin') {
      const enabledAdmins = await db('admin_users').join('roles', 'roles.id', 'admin_users.role_id')
        .where('roles.name', 'super_admin').where('admin_users.is_active', true).count({ count: '*' }).first();
      if (Number(enabledAdmins?.count) <= 1) return res.status(409).json({ error: '至少保留一个超级管理员' });
    }
    await deleteWithHistory(db, 'admin_users', { id }, {
      actor: req.admin.id,
      source: 'admin-user.delete',
    });
    res.json({ success: true, id });
  } catch (err) {
    if (/foreign key|constraint/i.test(String(err.message))) return res.status(409).json({ error: '此账号仍有受保护的历史关联，建议停用而非删除' });
    next(err);
  }
});
module.exports = router;
