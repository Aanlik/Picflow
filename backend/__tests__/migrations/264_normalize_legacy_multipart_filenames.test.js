const fs = require('fs');
const os = require('os');
const path = require('path');
const migration = require('../../migrations/core/264_normalize_legacy_multipart_filenames');

describe('migration 264 — normalize legacy multipart filenames', () => {
  let knex;
  let tmpDir;

  beforeAll(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'picflow-mig264-'));
    knex = require('knex')({
      client: 'sqlite3',
      connection: { filename: path.join(tmpDir, 'db.sqlite') },
      useNullAsDefault: true,
    });
    await knex.schema.createTable('photos', (table) => {
      table.increments('id').primary();
      table.string('filename');
      table.string('path');
      table.string('original_filename');
      table.string('source_filename');
    });
  });

  afterAll(async () => {
    await knex?.destroy();
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('repairs only losslessly recoverable display names and never moves stored files', async () => {
    const mojibake = Buffer.from('验收中文.jpg', 'utf8').toString('latin1');
    await knex('photos').insert([
      { filename: 'generated-1.jpg', path: 'events/1/generated-1.jpg', original_filename: mojibake, source_filename: mojibake },
      { filename: 'latin-1.jpg', path: 'events/1/latin-1.jpg', original_filename: 'café.jpg', source_filename: null },
    ]);

    await migration.up(knex);

    const rows = await knex('photos').orderBy('id');
    expect(rows[0]).toMatchObject({
      filename: 'generated-1.jpg',
      path: 'events/1/generated-1.jpg',
      original_filename: '验收中文.jpg',
      source_filename: '验收中文.jpg',
    });
    expect(rows[1].original_filename).toBe('café.jpg');
  });
});
