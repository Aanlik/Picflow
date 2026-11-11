exports.up = async function up(knex) {
  if (await knex.schema.hasTable('delivery_portal_shares')) return;
  await knex.schema.createTable('delivery_portal_shares', (table) => {
    table.increments('id').primary();
    table.integer('event_id').notNullable().references('id').inTable('events').onDelete('CASCADE');
    table.string('recipient_name', 120).notNullable();
    table.string('token_hash', 64).notNullable();
    table.string('password_hash', 100).notNullable();
    table.timestamp('expires_at').notNullable();
    table.timestamp('revoked_at').nullable();
    table.integer('created_by').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['token_hash'], 'delivery_portal_shares_token_unique');
    table.index(['event_id', 'revoked_at', 'expires_at'], 'delivery_portal_shares_event_idx');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('delivery_portal_shares');
};
