exports.up = async function up(knex) {
  if (await knex.schema.hasTable('object_delivery_download_renditions')) return;
  await knex.schema.createTable('object_delivery_download_renditions', (t) => {
    t.increments('id').primary();
    // Intentionally no foreign keys: an event/photo may be deleted while a
    // short-lived signed URL is still valid. Keeping this cleanup row lets the
    // worker remove the corresponding object after the download lease expires.
    t.integer('event_id').notNullable();
    t.integer('photo_id').notNullable();
    t.text('object_key').notNullable();
    t.text('target_id').notNullable();
    t.timestamp('expires_at').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['target_id', 'object_key'], 'object_download_rendition_target_key');
    t.index(['expires_at', 'id'], 'object_download_rendition_expiry_idx');
    t.index(['event_id', 'photo_id'], 'object_download_rendition_photo_idx');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('object_delivery_download_renditions');
};
