const knex = require('knex');
const { replayRestoreAudit } = require('../../src/services/restoreAuditHistory');
let db;
beforeEach(async () => {
 db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
 await db.schema.createTable('restore_runs', t => {
  t.increments('id'); t.string('started_at'); t.string('manifest_path'); t.string('restore_type'); t.string('source'); t.string('status');
 });
});
afterEach(() => db.destroy());
it('preserves history and reassigns an active run whose ID belongs to an older snapshot row', async () => {
 const old = { started_at: '2026-10-20', manifest_path: '/old.json', restore_type: 'full', source: 'local', status: 'completed' };
 await db('restore_runs').insert({ id: 2, ...old });
 const current = { id: 2, started_at: '2026-10-23', manifest_path: '/new.json', restore_type: 'database', source: 'local', status: 'running' };
 const id = await replayRestoreAudit(db, [current], 2);
 expect(id).not.toBe(2);
 await db('restore_runs').where({ id }).update({ status: 'completed' });
 expect((await db('restore_runs').where({ id: 2 }).first()).started_at).toBe('2026-10-20');
 expect((await db('restore_runs').where({ id }).first()).status).toBe('completed');
 await replayRestoreAudit(db, [{ ...current, id, status: 'completed' }], id);
 expect(await db('restore_runs')).toHaveLength(2);
});
it('restores completed backup metadata and remaps incremental parents after database replacement', async () => {
 const { replayBackupHistory } = require('../../src/services/restoreAuditHistory');
 await db.schema.createTable('backup_runs', t => {
  t.increments('id'); t.string('started_at'); t.string('status'); t.integer('total_size_bytes'); t.integer('parent_backup_id').nullable();
 });
 await db('backup_runs').insert([
  { id: 1, started_at: 'older', status: 'completed', total_size_bytes: 10 },
  { id: 2, started_at: 'base', status: 'running', total_size_bytes: 0 },
 ]);
 const live = [
  { id: 1, started_at: 'base', status: 'completed', total_size_bytes: 400, parent_backup_id: null },
  { id: 2, started_at: 'child', status: 'completed', total_size_bytes: 40, parent_backup_id: 1 },
 ];
 await replayBackupHistory(db, live);
 const base = await db('backup_runs').where({ started_at: 'base' }).first();
 const child = await db('backup_runs').where({ started_at: 'child' }).first();
 expect(base.status).toBe('completed');
 expect(base.total_size_bytes).toBe(400);
 expect(child.parent_backup_id).toBe(base.id);
 expect((await db('backup_runs').where({ started_at: 'older' }).first()).total_size_bytes).toBe(10);
 await replayBackupHistory(db, live);
 expect(await db('backup_runs')).toHaveLength(3);
});
