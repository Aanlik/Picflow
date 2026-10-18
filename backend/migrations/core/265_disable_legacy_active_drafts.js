'use strict';

const { formatBoolean } = require('../../src/utils/dbCompat');

/** Draft galleries are never publicly active. Older event creation inherited
 * is_active=true from the database default even when is_draft=true. Normalize
 * that inconsistent pair so a restored draft cannot become publicly visible.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('events'))) return;
  for (const column of ['is_draft', 'is_active']) {
    if (!(await knex.schema.hasColumn('events', column))) return;
  }

  await knex('events')
    .where('is_draft', formatBoolean(true))
    .where('is_active', formatBoolean(true))
    .update({ is_active: formatBoolean(false) });
};

exports.down = async function down() {
  // A draft may have been deliberately deactivated after migration; it is not
  // safe to infer the former state or re-enable public access on rollback.
};
