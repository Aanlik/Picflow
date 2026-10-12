const path = require('path');
const fs = require('fs');
const os = require('os');
const migration = require('../../migrations/core/259_localize_css_templates');

describe('migration 259 — localized built-in CSS templates', () => {
  let knex;
  let tmpDir;

  beforeAll(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'picflow-mig259-'));
    knex = require('knex')({
      client: 'sqlite3',
      connection: { filename: path.join(tmpDir, 'db.sqlite') },
      useNullAsDefault: true,
    });
    await knex.schema.createTable('css_templates', (table) => {
      table.increments('id').primary();
      table.string('name');
      table.text('css_content');
      table.timestamp('updated_at');
    });
  });

  afterAll(async () => {
    if (knex) await knex.destroy();
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => { await knex('css_templates').del(); });

  it('localizes bundled names and removes comments without changing CSS rules', async () => {
    await knex('css_templates').insert([
      { name: 'Elegant Dark', css_content: '/* Old English header */ .gallery { color: red; }' },
      { name: 'Apple Liquid Glass', css_content: '/* upstream #1131 */ .gallery { backdrop-filter: blur(5px); }' },
      { name: 'Liquid Glass Dark', css_content: '/* PicPeak */ .gallery { color: white; }' },
      { name: 'My Custom Theme', css_content: '/* Keep my note */ .gallery { color: blue; }' },
    ]);

    await migration.up(knex);

    const rows = await knex('css_templates').orderBy('id');
    expect(rows.map((row) => row.name)).toEqual(['优雅暗色', '苹果液态玻璃', '液态玻璃深色', 'My Custom Theme']);
    expect(rows[0].css_content).toBe('.gallery { color: red; }');
    expect(rows[1].css_content).toBe('.gallery { backdrop-filter: blur(5px); }');
    expect(rows[2].css_content).toBe('.gallery { color: white; }');
    expect(rows[3].css_content).toBe('/* Keep my note */ .gallery { color: blue; }');
  });

  it('does nothing if the template table is not present', async () => {
    await knex.schema.dropTable('css_templates');
    await expect(migration.up(knex)).resolves.toBeUndefined();
    await knex.schema.createTable('css_templates', (table) => {
      table.increments('id').primary();
      table.string('name');
      table.text('css_content');
      table.timestamp('updated_at');
    });
  });
});
