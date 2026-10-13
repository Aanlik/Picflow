const path = require('path');
const fs = require('fs');
const os = require('os');
const migration = require('../../migrations/core/261_css_template_cleanup');

describe('migration 261 — clean bundled CSS template content', () => {
  let knex;
  let tmpDir;

  beforeAll(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'picflow-mig261-'));
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

  it('removes bundled template comments and old names while preserving custom templates', async () => {
    await knex('css_templates').insert([
      { name: 'Apple Liquid Glass', css_content: '/* PicPeak Custom CSS Template */ /* upstream #1131 */ /* English starter comments */ .gallery { color: red; }' },
      { name: '优雅暗色', css_content: '/* Admin note */ .gallery { color: black; }' },
      { name: 'My Custom Theme', css_content: '/* Keep my note */ .gallery { color: blue; }' },
    ]);

    await migration.up(knex);

    const rows = await knex('css_templates').orderBy('id');
    expect(rows.map((row) => row.name)).toEqual(['苹果液态玻璃', '优雅暗色', 'My Custom Theme']);
    expect(rows[0].css_content).toBe('.gallery { color: red; }');
    expect(rows[1].css_content).toBe('/* Admin note */ .gallery { color: black; }');
    expect(rows[2].css_content).toBe('/* Keep my note */ .gallery { color: blue; }');
  });
});
