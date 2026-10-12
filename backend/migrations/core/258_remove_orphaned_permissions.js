'use strict';

// Earlier module-removal migrations removed application tables and most RBAC
// entries, but left these orphaned permission rows in older installations.
// Since the role editor reads the live catalog from `permissions`, they still
// appeared as unavailable English modules even though no matching screens or
// routes exist.
const ORPHANED_PERMISSIONS = [
  'newsletters.view',
  'newsletters.send',
  'workflows.view',
  'workflows.manage',
  'settings.banking',
  'settings.integrations',
];

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('permissions'))) return;
  const rows = await knex('permissions').whereIn('name', ORPHANED_PERMISSIONS).select('id');
  if (!rows.length) return;

  const ids = rows.map(({ id }) => id);
  if (await knex.schema.hasTable('role_permissions')) {
    await knex('role_permissions').whereIn('permission_id', ids).del();
  }
  await knex('permissions').whereIn('id', ids).del();
};

exports.down = async function down() {
  // These permissions belong to removed modules and are intentionally retired.
};
