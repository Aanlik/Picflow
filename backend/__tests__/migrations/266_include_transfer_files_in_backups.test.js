const knex = require('knex');
const migration = require('../../migrations/core/266_include_transfer_files_in_backups');
let db;
beforeEach(async () => {
  db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await db.schema.createTable('backup_paths', t => {
    t.string('path').unique(); t.boolean('include_in_default'); t.string('feature_flag');
    t.integer('display_order'); t.string('description');
  });
});
afterEach(() => db.destroy());
test('existing installations back up transfer files; reruns preserve operator choices', async () => {
  await migration.up(db);
  expect(await db('backup_paths').where({path:'transfers'}).first()).toMatchObject({include_in_default:1});
  await db('backup_paths').where({path:'transfers'}).update({include_in_default:false});
  await migration.up(db);
  expect(await db('backup_paths').where({path:'transfers'})).toHaveLength(1);
  expect((await db('backup_paths').first()).include_in_default).toBe(0);
});
