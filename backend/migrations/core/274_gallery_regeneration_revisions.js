exports.up = async function up(knex) {
  for (const column of ['cloud_thumbnail_revision', 'cloud_preview_revision']) {
    if (!(await knex.schema.hasColumn('photos', column))) {
      await knex.schema.alterTable('photos', (table) => table.integer(column).notNullable().defaultTo(0));
    }
  }
};

exports.down = async function down(knex) {
  for (const column of ['cloud_thumbnail_revision', 'cloud_preview_revision']) {
    if (await knex.schema.hasColumn('photos', column)) {
      await knex.schema.alterTable('photos', (table) => table.dropColumn(column));
    }
  }
};
