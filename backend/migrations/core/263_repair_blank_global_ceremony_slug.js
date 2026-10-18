'use strict';

/**
 * Repair the bundled global Ceremony category when a legacy or interrupted
 * install persisted its identifier as an empty string. The system uses the
 * slug as the category key in filters and project overrides; an empty value
 * makes the category visible but impossible to address consistently.
 *
 * Scope is intentionally narrow: only a global row named exactly "Ceremony"
 * or "仪式" with a blank slug is eligible. User-created categories and any
 * already populated identifiers are left untouched. If "ceremony" is already
 * occupied by another global row, leave the record alone rather than making
 * a uniqueness collision or silently renaming either category.
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('photo_categories'))) return;
  for (const column of ['name', 'slug', 'is_global']) {
    if (!(await knex.schema.hasColumn('photo_categories', column))) return;
  }

  const rows = await knex('photo_categories')
    .where('is_global', true)
    .whereIn('name', ['Ceremony', '仪式'])
    .where(function blankSlug() {
      this.whereNull('slug').orWhere('slug', '');
    })
    .select('id')
    .orderBy('id', 'asc');

  for (const row of rows) {
    const conflict = await knex('photo_categories')
      .where('is_global', true)
      .where('slug', 'ceremony')
      .whereNot('id', row.id)
      .first('id');
    if (conflict) {
      console.warn(`Migration 263: category ${row.id} has a blank slug, but global slug "ceremony" is already in use; leaving it unchanged.`);
      continue;
    }

    await knex('photo_categories').where({ id: row.id }).update({ slug: 'ceremony' });
  }
};

exports.down = async function down() {
  // This repairs a missing bundled identifier; reverting would reintroduce
  // the broken state and could erase a deliberate later edit.
};
