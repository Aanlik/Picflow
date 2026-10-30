exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('backup_runs'))) return;
  if (!(await knex.schema.hasColumn('backup_runs', 'object_storage_target_id'))) {
    await knex.schema.alterTable('backup_runs', (table) => {
      table.text('object_storage_target_id').nullable();
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('backup_runs', 'object_storage_target_id')) {
    await knex.schema.alterTable('backup_runs', (table) => {
      table.dropColumn('object_storage_target_id');
    });
  }
};
