'use strict';

// Restore audit is operational history, not application snapshot content.
// Reconcile by the operation timestamp/source, never by snapshot-local row IDs.
async function replayRestoreAudit(db, rows, activeId) {
  return db.transaction(async trx => {
    const columns = new Set(Object.keys(await trx('restore_runs').columnInfo()));
    let restoredActiveId = activeId;
    for (const row of rows) {
      const matches = trx('restore_runs').where({
        started_at: row.started_at,
        manifest_path: row.manifest_path,
        restore_type: row.restore_type,
        source: row.source,
      });
      const existing = await matches.clone().where({ id: row.id }).first() || await matches.first();
      const values = Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id' && columns.has(key)));
      let id = existing?.id;
      if (existing) {
        const changed = Object.entries(values).some(([key, value]) => String(existing[key] ?? '') !== String(value ?? ''));
        if (changed) await trx('restore_runs').where({ id }).update(values);
      } else {
        const inserted = await trx('restore_runs').insert(values).returning('id');
        id = inserted[0]?.id ?? inserted[0];
      }
      if (row.id === activeId) restoredActiveId = id;
    }
    return restoredActiveId;
  });
}

module.exports = { replayRestoreAudit };

async function replayBackupHistory(db, rows) {
  if (!rows.length) return;
  await db.transaction(async trx => {
    const columns = new Set(Object.keys(await trx('backup_runs').columnInfo()));
    const ids = new Map();
    // First recreate operation identities, then resolve parent dependencies.
    // Snapshot-local numeric IDs can refer to entirely different operations.
    for (const row of rows) {
      const existing = await trx('backup_runs').where({ started_at: row.started_at }).first();
      const values = Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id' && key !== 'parent_backup_id' && columns.has(key)));
      let id = existing?.id;
      if (existing) await trx('backup_runs').where({ id }).update(values);
      else {
        const inserted = await trx('backup_runs').insert(values).returning('id');
        id = inserted[0]?.id ?? inserted[0];
      }
      ids.set(row.id, id);
    }
    if (columns.has('parent_backup_id')) {
      for (const row of rows) {
        if (row.parent_backup_id != null && !ids.has(row.parent_backup_id)) {
          throw new Error('Cannot reconcile backup history: parent operation is missing');
        }
        await trx('backup_runs').where({ id: ids.get(row.id) }).update({
          parent_backup_id: row.parent_backup_id == null ? null : ids.get(row.parent_backup_id),
        });
      }
    }
  });
}
module.exports.replayBackupHistory = replayBackupHistory;
