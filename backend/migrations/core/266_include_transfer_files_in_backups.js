// Transfer downloads and customer return files are managed application data.
exports.up = async function(knex) {
  if (!(await knex.schema.hasTable('backup_paths'))) return;
  await knex('backup_paths').insert({
    path: 'transfers', include_in_default: true, feature_flag: null,
    display_order: 80, description: '交付链接及客户回传文件',
  }).onConflict('path').ignore();
};
exports.down = async function(knex) {
  if (await knex.schema.hasTable('backup_paths')) await knex('backup_paths').where({ path: 'transfers' }).del();
};
