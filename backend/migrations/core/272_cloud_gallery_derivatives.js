exports.up = async function up(knex) {
  if (await knex.schema.hasTable('events')) {
    if (!(await knex.schema.hasColumn('events', 'cloud_thumbnail_sync_enabled'))) {
      await knex.schema.alterTable('events', (t) => t.boolean('cloud_thumbnail_sync_enabled').notNullable().defaultTo(false));
    }
    if (!(await knex.schema.hasColumn('events', 'cloud_preview_sync_enabled'))) {
      await knex.schema.alterTable('events', (t) => t.boolean('cloud_preview_sync_enabled').notNullable().defaultTo(false));
    }
  }

  if (!(await knex.schema.hasTable('object_gallery_derivatives'))) {
    await knex.schema.createTable('object_gallery_derivatives', (t) => {
      t.increments('id').primary();
      t.integer('event_id').notNullable().references('id').inTable('events').onDelete('CASCADE');
      t.integer('photo_id').notNullable().references('id').inTable('photos').onDelete('CASCADE');
      t.string('asset_kind', 16).notNullable();
      t.integer('width').notNullable();
      t.text('source_key').notNullable();
      t.string('source_version', 64).notNullable();
      t.text('object_key').notNullable();
      t.text('target_id').notNullable();
      t.string('state', 24).notNullable().defaultTo('queued');
      t.boolean('is_current').notNullable().defaultTo(true);
      t.integer('attempts').notNullable().defaultTo(0);
      t.timestamp('next_attempt_at').nullable();
      t.bigInteger('size_bytes').nullable();
      t.string('content_type', 128).nullable();
      t.text('error_message').nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['event_id', 'photo_id', 'asset_kind', 'width', 'source_version'], 'object_gallery_derivative_version_unique');
      t.index(['state', 'next_attempt_at', 'asset_kind', 'width', 'id'], 'object_gallery_derivative_queue_idx');
      t.index(['event_id', 'photo_id', 'asset_kind', 'width', 'is_current'], 'object_gallery_derivative_current_idx');
    });
  }

  if (!(await knex.schema.hasTable('object_gallery_derivative_scans'))) {
    await knex.schema.createTable('object_gallery_derivative_scans', (t) => {
      t.increments('id').primary();
      t.integer('event_id').notNullable().references('id').inTable('events').onDelete('CASCADE');
      t.string('asset_kind', 16).notNullable();
      // Rows are scanned newest first, matching the gallery's default order.
      // The cursor is the oldest id already queued in the latest batch.
      t.integer('cursor_photo_id').nullable();
      t.string('state', 16).notNullable().defaultTo('queued');
      t.text('error_message').nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['event_id', 'asset_kind'], 'object_gallery_derivative_scan_unique');
      t.index(['state', 'asset_kind', 'id'], 'object_gallery_derivative_scan_queue_idx');
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('object_gallery_derivative_scans');
  await knex.schema.dropTableIfExists('object_gallery_derivatives');
  if (await knex.schema.hasColumn('events', 'cloud_thumbnail_sync_enabled')) {
    await knex.schema.alterTable('events', (t) => t.dropColumn('cloud_thumbnail_sync_enabled'));
  }
  if (await knex.schema.hasColumn('events', 'cloud_preview_sync_enabled')) {
    await knex.schema.alterTable('events', (t) => t.dropColumn('cloud_preview_sync_enabled'));
  }
};
