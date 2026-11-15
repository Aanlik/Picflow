exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('delivery_portal_shares', 'token_encrypted'))) {
    await knex.schema.alterTable('delivery_portal_shares', (table) => {
      table.text('token_encrypted').nullable();
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('delivery_portal_shares', 'token_encrypted')) {
    await knex.schema.alterTable('delivery_portal_shares', (table) => {
      table.dropColumn('token_encrypted');
    });
  }
};
