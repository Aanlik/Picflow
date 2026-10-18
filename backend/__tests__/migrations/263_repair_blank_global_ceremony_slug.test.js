const path = require('path');
const fs = require('fs');
const os = require('os');
const migration = require('../../migrations/core/263_repair_blank_global_ceremony_slug');

describe('migration 263 — repair blank global ceremony slug', () => {
  let knex;
  let tmpDir;

  beforeAll(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'picflow-mig263-'));
    knex = require('knex')({
      client: 'sqlite3',
      connection: { filename: path.join(tmpDir, 'db.sqlite') },
      useNullAsDefault: true,
    });
    await knex.schema.createTable('photo_categories', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.string('slug');
      table.boolean('is_global').notNullable().defaultTo(true);
      table.integer('event_id').nullable();
    });
  });

  afterAll(async () => {
    await knex?.destroy();
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => { await knex('photo_categories').del(); });

  it('fills only the blank bundled global Ceremony identifier', async () => {
    await knex('photo_categories').insert([
      { name: '仪式', slug: '', is_global: true, event_id: null },
      { name: 'Details', slug: 'details', is_global: true, event_id: null },
      { name: '仪式', slug: '', is_global: false, event_id: 11 },
      { name: 'Custom Ceremony', slug: '', is_global: true, event_id: null },
    ]);

    await migration.up(knex);

    const rows = await knex('photo_categories').orderBy('id');
    expect(rows.map((row) => row.slug)).toEqual(['ceremony', 'details', '', '']);
  });

  it('does not overwrite an occupied global slug', async () => {
    await knex('photo_categories').insert([
      { name: '仪式', slug: '', is_global: true, event_id: null },
      { name: 'Wedding Ceremony', slug: 'ceremony', is_global: true, event_id: null },
    ]);

    await migration.up(knex);

    const rows = await knex('photo_categories').orderBy('id');
    expect(rows.map((row) => row.slug)).toEqual(['', 'ceremony']);
  });

  it('does nothing when the category table is absent', async () => {
    await knex.schema.dropTable('photo_categories');
    await expect(migration.up(knex)).resolves.toBeUndefined();
    await knex.schema.createTable('photo_categories', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.string('slug');
      table.boolean('is_global').notNullable().defaultTo(true);
      table.integer('event_id').nullable();
    });
  });
});
