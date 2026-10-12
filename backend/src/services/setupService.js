'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { db } = require('../database/db');
const logger = require('../utils/logger');
const { ValidationError, ConflictError } = require('../utils/errors');
const { validatePassword, getBcryptRounds } = require('../utils/passwordValidation');
const { formatBoolean } = require('../utils/dbCompat');

const SETUP_LOCK_KEY = 'setup_wizard_completed';

async function noAdminExists(conn = db) {
  const row = await conn('admin_users').count({ c: '*' }).first();
  return Number(row?.c || 0) === 0;
}

// Public status reveals only whether the first administrator still needs to
// be created. The setup endpoint closes permanently as soon as one exists.
async function getSetupStatus() {
  const needsAdmin = await noAdminExists();
  return { needsAdmin, complete: !needsAdmin };
}

// Creates the first admin as super_admin and returns a ready-to-set admin JWT.
// There is no setup token: a stable app_settings row serialises concurrent
// first-admin submissions in the database transaction, then the admin count
// is checked again while holding that lock.
async function createInitialAdmin({ username, password, ip }) {
  const cleanUsername = String(username || '').trim();
  if (!/^[\p{L}\p{N}_-]{3,50}$/u.test(cleanUsername)) {
    throw new ValidationError('Invalid username', 'username');
  }

  const strength = validatePassword(password);
  if (!strength.valid) {
    throw new ValidationError(strength.errors[0] || 'Password does not meet requirements', 'password');
  }

  const role = await db('roles').where('name', 'super_admin').first();
  if (!role) {
    throw new ConflictError('super_admin role missing — database not initialised');
  }
  const passwordHash = await bcrypt.hash(password, getBcryptRounds());
  // Older schemas still require an email column; this non-routable address is
  // never used for login or communication.
  const email = `${crypto.randomUUID()}@accounts.invalid`;

  const id = await db.transaction(async (trx) => {
    // Migration 161 guarantees this row on every supported installation. A
    // Touching only updated_at obtains a write lock on SQLite/MySQL and a row
    // lock on PostgreSQL without changing the wizard's saved value.
    const lock = await trx('app_settings')
      .where({ setting_key: SETUP_LOCK_KEY })
      .update({ updated_at: new Date() });
    if (lock !== 1) {
      throw new ConflictError('Setup is unavailable — initialise the database first');
    }

    if (!(await noAdminExists(trx))) {
      throw new ConflictError('Setup already completed — an admin account exists');
    }

    const inserted = await trx('admin_users').insert({
      username: cleanUsername,
      email,
      password_hash: passwordHash,
      role_id: role.id,
      is_active: formatBoolean(true),
      must_change_password: formatBoolean(false),
      created_at: new Date(),
      updated_at: new Date(),
    }).returning('id');
    return inserted[0]?.id || inserted[0];
  });

  logger.info(`[setup] Initial super_admin created (id=${id}, username=${cleanUsername})`);

  const authToken = jwt.sign(
    { id, username: cleanUsername, type: 'admin', role: role.name, ip: ip || null, loginTime: Date.now() },
    process.env.JWT_SECRET,
    { expiresIn: '24h', issuer: 'picpeak-auth' }
  );

  return {
    token: authToken,
    user: {
      id,
      username: cleanUsername,
      role: { name: role.name, displayName: role.display_name },
    },
  };
}

module.exports = { getSetupStatus, createInitialAdmin };
