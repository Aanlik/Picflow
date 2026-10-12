'use strict';

const fs = require('fs');
const path = require('path');

// Retire the one-time setup-token mechanism. Remove its database value and
// obsolete on-disk copy during upgrade; both are unused by the new bootstrap.
exports.up = async function up(knex) {
  if (await knex.schema.hasTable('app_settings')) {
    await knex('app_settings').where({ setting_key: 'setup_token' }).del();
  }

  const dataDir = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
  try {
    fs.unlinkSync(path.join(dataDir, 'SETUP_TOKEN'));
  } catch (_) {
    // Fresh installs have no legacy file, and a leftover token is no longer
    // accepted after this version is installed.
  }
};

// The retired token is intentionally not restored on rollback.
exports.down = async function down() {};
