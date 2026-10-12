const knexFactory = require('knex');
const migration = require('../../migrations/core/256_remove_sso_and_public_api');

describe('retire SSO and external Public API storage', () => {
  let db;

  beforeEach(async () => {
    db = knexFactory({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await db.schema.createTable('api_tokens', (table) => {
      table.increments('id').primary();
      table.string('name');
      table.string('token_hash');
    });
    await db('api_tokens').insert({ name: 'old integration token', token_hash: 'retired' });
    await db.schema.createTable('app_settings', (table) => {
      table.string('setting_key').primary();
      table.text('setting_value');
    });
    await db('app_settings').insert([
      { setting_key: 'oidc_issuer_url', setting_value: 'https://id.example' },
      { setting_key: 'oidc_client_secret', setting_value: 'retired-secret' },
      { setting_key: 'general_site_url', setting_value: 'https://photos.example' },
    ]);
    await db.schema.createTable('admin_users', (table) => {
      table.increments('id').primary();
      table.string('username');
      table.string('password_hash');
      table.string('external_subject');
      table.string('external_issuer');
      table.string('auth_provider');
    });
    await db('admin_users').insert({
      username: 'photographer', password_hash: 'local-password-hash',
      external_subject: 'subject', external_issuer: 'issuer', auth_provider: 'oidc',
    });
  });

  afterEach(async () => db.destroy());

  it('removes token and external identity state while preserving local accounts and ordinary settings', async () => {
    await migration.up(db);

    expect(await db.schema.hasTable('api_tokens')).toBe(false);
    for (const column of ['external_subject', 'external_issuer', 'auth_provider']) {
      // eslint-disable-next-line no-await-in-loop
      expect(await db.schema.hasColumn('admin_users', column)).toBe(false);
    }
    expect(await db('admin_users').select('username', 'password_hash')).toEqual([
      { username: 'photographer', password_hash: 'local-password-hash' },
    ]);
    expect((await db('app_settings').select('setting_key')).map((row) => row.setting_key))
      .toEqual(['general_site_url']);

    await expect(migration.up(db)).resolves.toBeUndefined();
  });
});
