'use strict';

exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('photo_retouch_selections'))) {
    await knex.schema.createTable('photo_retouch_selections', (table) => {
      table.increments('id').primary();
      table.integer('event_id').notNullable().references('id').inTable('events').onDelete('CASCADE');
      table.integer('photo_id').notNullable().references('id').inTable('photos').onDelete('CASCADE');
      table.integer('guest_id').nullable().references('id').inTable('gallery_guests').onDelete('SET NULL');
      table.string('guest_identifier', 128).notNullable();
      table.string('identity_key', 160).notNullable();
      table.string('guest_name', 100).nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.unique(['photo_id', 'identity_key'], { indexName: 'photo_retouch_selections_identity_uq' });
      table.index(['event_id', 'photo_id'], 'photo_retouch_selections_event_photo_idx');
    });
  }

  if (!(await knex.schema.hasTable('photo_retouch_selection_migrations'))) {
    await knex.schema.createTable('photo_retouch_selection_migrations', (table) => {
      table.integer('event_id').primary().references('id').inTable('events').onDelete('CASCADE');
      table.timestamp('migrated_at').notNullable().defaultTo(knex.fn.now());
    });
  }
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('photo_retouch_selection_migrations');
  await knex.schema.dropTableIfExists('photo_retouch_selections');
};
