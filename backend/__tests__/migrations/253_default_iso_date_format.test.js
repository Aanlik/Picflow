const knexFactory = require('knex');
const migration = require('../../migrations/core/253_default_iso_date_format');

describe('ISO date format default migration', () => {
  let db;

  beforeEach(async () => {
    db = knexFactory({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await db.schema.createTable('app_settings', (table) => {
      table.increments('id').primary();
      table.string('setting_key').notNullable().unique();
      table.text('setting_value');
      table.string('setting_type');
      table.timestamp('updated_at');
    });
  });

  afterEach(async () => db.destroy());

  it('seeds ISO format when no date preference exists', async () => {
    await migration.up(db);
    const row = await db('app_settings').where({ setting_key: 'general_date_format' }).first();
    expect(JSON.parse(row.setting_value)).toEqual({ format: 'yyyy-MM-dd', locale: 'en-CA' });
  });

  it('replaces the historic seeded default with ISO format', async () => {
    await db('app_settings').insert({
      setting_key: 'general_date_format',
      setting_value: JSON.stringify({ format: 'DD/MM/YYYY', locale: 'en-GB' }),
      setting_type: 'general',
    });
    await migration.up(db);
    const row = await db('app_settings').where({ setting_key: 'general_date_format' }).first();
    expect(JSON.parse(row.setting_value)).toEqual({ format: 'yyyy-MM-dd', locale: 'en-CA' });
  });

  it('preserves a custom date preference', async () => {
    await db('app_settings').insert({
      setting_key: 'general_date_format',
      setting_value: JSON.stringify({ format: 'MM/dd/yyyy', locale: 'en-US' }),
      setting_type: 'general',
    });
    await migration.up(db);
    const row = await db('app_settings').where({ setting_key: 'general_date_format' }).first();
    expect(JSON.parse(row.setting_value)).toEqual({ format: 'MM/dd/yyyy', locale: 'en-US' });
  });
});
