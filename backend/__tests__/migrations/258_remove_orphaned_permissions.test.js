const knexFactory = require('knex');
const migration = require('../../migrations/core/258_remove_orphaned_permissions');

describe('migration 258 — remove orphaned role permissions', () => {
  let db;

  beforeEach(async () => {
    db = knexFactory({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await db.schema.createTable('permissions', (table) => {
      table.increments('id').primary();
      table.string('name').unique();
    });
    await db.schema.createTable('role_permissions', (table) => {
      table.integer('role_id');
      table.integer('permission_id');
    });
    await db('permissions').insert([
      { id: 1, name: 'newsletters.view' },
      { id: 2, name: 'workflows.view' },
      { id: 3, name: 'settings.banking' },
      { id: 4, name: 'settings.integrations' },
      { id: 5, name: 'notifications.view' },
      { id: 6, name: 'events.view' },
    ]);
    await db('role_permissions').insert([
      { role_id: 10, permission_id: 1 },
      { role_id: 10, permission_id: 2 },
      { role_id: 10, permission_id: 3 },
      { role_id: 10, permission_id: 4 },
      { role_id: 10, permission_id: 5 },
      { role_id: 10, permission_id: 6 },
    ]);
  });

  afterEach(async () => db.destroy());

  it('removes only retired catalog rows and their grants, idempotently', async () => {
    await migration.up(db);
    await migration.up(db);

    expect(await db('permissions').orderBy('id').pluck('name'))
      .toEqual(['notifications.view', 'events.view']);
    expect(await db('role_permissions').orderBy('permission_id').pluck('permission_id'))
      .toEqual([5, 6]);
  });
});
