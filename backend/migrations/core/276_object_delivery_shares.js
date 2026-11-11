exports.up = async function up(knex) {
  if (await knex.schema.hasTable('object_delivery_shares')) return;
  await knex.schema.createTable('object_delivery_shares', (table) => {
    table.increments('id').primary();
    table.integer('event_id').notNullable().references('id').inTable('events').onDelete('CASCADE');
    table.integer('photo_id').notNullable().references('id').inTable('photos').onDelete('CASCADE');
    table.integer('delivery_file_id').notNullable().references('id').inTable('object_delivery_files').onDelete('CASCADE');
    table.string('token_hash', 64).notNullable();
    table.string('password_hash', 100).notNullable();
    table.integer('retouch_version').notNullable();
    table.timestamp('expires_at').notNullable();
    table.timestamp('revoked_at').nullable();
    table.integer('failed_attempts').notNullable().defaultTo(0);
    table.timestamp('locked_until').nullable();
    table.integer('created_by').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['token_hash'], 'object_delivery_shares_token_unique');
    table.index(['event_id', 'revoked_at', 'expires_at'], 'object_delivery_shares_event_idx');
    table.index(['photo_id', 'delivery_file_id'], 'object_delivery_shares_photo_idx');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('object_delivery_shares');
};
