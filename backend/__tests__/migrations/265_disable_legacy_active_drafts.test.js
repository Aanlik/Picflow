const fs = require('fs');
const os = require('os');
const path = require('path');
const migration = require('../../migrations/core/265_disable_legacy_active_drafts');

describe('migration 265 — disable legacy active drafts', () => {
  let knex;
  let tmpDir;

  beforeAll(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'picflow-mig265-'));
    knex = require('knex')({
      client: 'sqlite3',
      connection: { filename: path.join(tmpDir, 'db.sqlite') },
      useNullAsDefault: true,
    });
    await knex.schema.createTable('events', (table) => {
      table.increments('id').primary();
      table.boolean('is_draft');
      table.boolean('is_active');
    });
  });

  afterAll(async () => {
    await knex?.destroy();
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('deactivates legacy drafts without changing published or already inactive events', async () => {
    await knex('events').insert([
      { is_draft: true, is_active: true },
      { is_draft: false, is_active: true },
      { is_draft: true, is_active: false },
    ]);

    await migration.up(knex);

    const rows = await knex('events').orderBy('id');
    expect(rows.map((row) => [Boolean(row.is_draft), Boolean(row.is_active)])).toEqual([
      [true, false], [false, true], [true, false],
    ]);
  });
});
