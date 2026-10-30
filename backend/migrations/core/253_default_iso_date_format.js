'use strict';

const SETTING_KEY = 'general_date_format';
const ISO_DEFAULT = JSON.stringify({ format: 'yyyy-MM-dd', locale: 'en-CA' });

function isPreviousDefault(value) {
  if (value == null || value === '') return false;
  let setting = value;
  if (typeof value === 'string') {
    try { setting = JSON.parse(value); } catch { setting = value; }
  }
  if (typeof setting === 'string') {
    return ['DD/MM/YYYY', 'dd/MM/yyyy'].includes(setting.trim());
  }
  if (!setting || typeof setting !== 'object') return false;
  const format = String(setting.format || '').trim();
  const locale = String(setting.locale || '').trim();
  return ['DD/MM/YYYY', 'dd/MM/yyyy'].includes(format) && (!locale || locale === 'en-GB');
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('app_settings'))) return;
  const row = await knex('app_settings').where({ setting_key: SETTING_KEY }).first();
  if (!row) {
    await knex('app_settings').insert({
      setting_key: SETTING_KEY,
      setting_value: ISO_DEFAULT,
      setting_type: 'general',
      updated_at: knex.fn.now(),
    });
    return;
  }

  // Existing custom date preferences are user choices and must survive upgrades.
  if (isPreviousDefault(row.setting_value)) {
    await knex('app_settings').where({ setting_key: SETTING_KEY }).update({
      setting_value: ISO_DEFAULT,
      updated_at: knex.fn.now(),
    });
  }
};

exports.down = async function down() {
  // Keep the user's date preference during rollback.
};
