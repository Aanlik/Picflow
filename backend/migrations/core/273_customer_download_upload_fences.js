exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('object_delivery_download_renditions'))) return;
  if (!(await knex.schema.hasColumn('object_delivery_download_renditions', 'active_uploads'))) {
    await knex.schema.alterTable('object_delivery_download_renditions', (table) => {
      table.integer('active_uploads').notNullable().defaultTo(0);
    });
  }
  if (!(await knex.schema.hasColumn('object_delivery_download_renditions', 'delete_requested'))) {
    await knex.schema.alterTable('object_delivery_download_renditions', (table) => {
      table.boolean('delete_requested').notNullable().defaultTo(false);
    });
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('object_delivery_download_renditions'))) return;
  if (await knex.schema.hasColumn('object_delivery_download_renditions', 'delete_requested')) {
    await knex.schema.alterTable('object_delivery_download_renditions', (table) => {
      table.dropColumn('delete_requested');
    });
  }
  if (await knex.schema.hasColumn('object_delivery_download_renditions', 'active_uploads')) {
    await knex.schema.alterTable('object_delivery_download_renditions', (table) => {
      table.dropColumn('active_uploads');
    });
  }
};
