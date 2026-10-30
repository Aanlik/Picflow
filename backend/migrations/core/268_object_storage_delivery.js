exports.up = async function up(knex) {
  if (await knex.schema.hasTable('events')) {
    if (!(await knex.schema.hasColumn('events', 'cloud_sync_enabled'))) {
      await knex.schema.alterTable('events', (t) => t.boolean('cloud_sync_enabled').notNullable().defaultTo(false));
    }
    if (!(await knex.schema.hasColumn('events', 'force_cloud_downloads'))) {
      await knex.schema.alterTable('events', (t) => t.boolean('force_cloud_downloads').notNullable().defaultTo(false));
    }
  }

  if (!(await knex.schema.hasTable('object_delivery_files'))) {
    await knex.schema.createTable('object_delivery_files', (t) => {
      t.increments('id').primary();
      t.integer('event_id').notNullable().references('id').inTable('events').onDelete('CASCADE');
      t.integer('photo_id').notNullable().references('id').inTable('photos').onDelete('CASCADE');
      t.text('source_key').notNullable();
      t.text('object_key').notNullable();
      t.text('target_id').notNullable();
      t.string('state', 24).notNullable().defaultTo('queued');
      t.boolean('is_current').notNullable().defaultTo(true);
      t.integer('attempts').notNullable().defaultTo(0);
      t.timestamp('next_attempt_at').nullable();
      t.bigInteger('size_bytes').nullable();
      t.text('error_message').nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['event_id', 'photo_id', 'source_key'], 'object_delivery_source_unique');
      t.index(['state', 'next_attempt_at', 'id'], 'object_delivery_queue_idx');
      t.index(['event_id', 'photo_id', 'is_current'], 'object_delivery_current_idx');
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('object_delivery_files');
  if (await knex.schema.hasColumn('events', 'force_cloud_downloads')) {
    await knex.schema.alterTable('events', (t) => t.dropColumn('force_cloud_downloads'));
  }
  if (await knex.schema.hasColumn('events', 'cloud_sync_enabled')) {
    await knex.schema.alterTable('events', (t) => t.dropColumn('cloud_sync_enabled'));
  }
};
