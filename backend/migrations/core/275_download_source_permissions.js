exports.up = async function up(knex) {
  for (const column of ['allow_original_downloads', 'allow_delivery_downloads']) {
    if (!(await knex.schema.hasColumn('events', column))) {
      await knex.schema.alterTable('events', (table) => table.boolean(column).nullable());
      await knex('events').update({ [column]: knex.ref('allow_downloads') });
    }
  }
  if (!(await knex.schema.hasColumn('photos', 'download_source_kind'))) {
    await knex.schema.alterTable('photos', (table) => table.string('download_source_kind', 16).nullable());
    // Existing external references are known originals; managed rows may be
    // either uploads or replacements and must not be classified by path alone.
    await knex('photos').whereIn('source_origin', ['external', 'reference'])
      .update({ download_source_kind: 'original' });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('photos', 'download_source_kind')) {
    await knex.schema.alterTable('photos', (table) => table.dropColumn('download_source_kind'));
  }
  for (const column of ['allow_original_downloads', 'allow_delivery_downloads']) {
    if (await knex.schema.hasColumn('events', column)) {
      await knex.schema.alterTable('events', (table) => table.dropColumn(column));
    }
  }
};
