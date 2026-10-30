// Retire the removed OIDC SSO and external Public API modules. Historical
// migrations remain in place so existing installations can upgrade safely;
// this migration removes their live credentials and schema from the database.
exports.up = async function up(knex) {
  if (await knex.schema.hasTable('api_tokens')) {
    await knex.schema.dropTable('api_tokens');
  }

  if (await knex.schema.hasTable('app_settings')) {
    const oidcSettings = await knex('app_settings').select('setting_key');
    const keys = oidcSettings.map((row) => row.setting_key).filter((key) => String(key).startsWith('oidc_'));
    if (keys.length) await knex('app_settings').whereIn('setting_key', keys).del();
  }

  if (await knex.schema.hasTable('admin_users')) {
    for (const column of ['external_subject', 'external_issuer', 'auth_provider']) {
      // eslint-disable-next-line no-await-in-loop
      if (await knex.schema.hasColumn('admin_users', column)) {
        // eslint-disable-next-line no-await-in-loop
        await knex.schema.alterTable('admin_users', (table) => table.dropColumn(column));
      }
    }
  }
};

exports.down = async function down() {
  // Removed credentials cannot be restored. A rollback must not re-enable
  // dormant tokens or SSO settings with incomplete provider state.
};
