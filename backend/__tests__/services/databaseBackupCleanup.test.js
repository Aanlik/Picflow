const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'picflow-db-backup-cleanup-test-')),
  'db.sqlite',
);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'database-backup-cleanup-test-secret';

const { bootTestDb } = require('../integration/helpers/sqliteTestDb');

describe('database backup cleanup', () => {
  let db;
  let cleanupDb;
  let backupRoot;
  let outsideRoot;
  let service;

  beforeAll(async () => {
    ({ db, cleanup: cleanupDb } = await bootTestDb());
    const { DatabaseBackupService } = require('../../src/services/databaseBackup');
    service = new DatabaseBackupService();
    backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'picflow-db-backups-'));
    outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'picflow-outside-db-backups-'));
    await db('app_settings').where({ setting_key: 'database_backup_destination_path' }).del();
    await db('app_settings').insert({
      setting_key: 'database_backup_destination_path',
      setting_value: JSON.stringify(backupRoot),
      setting_type: 'database_backup',
    });
  }, 120000);

  afterAll(async () => {
    if (cleanupDb) await cleanupDb();
    fs.rmSync(backupRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await db('database_backup_runs').del();
  });

  async function insertRun({ filePath, daysOld, status = 'completed' }) {
    const timestamp = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
    const rows = await db('database_backup_runs').insert({
      started_at: timestamp,
      completed_at: timestamp,
      status,
      backup_type: 'sqlite',
      destination_path: filePath,
      file_path: filePath,
      file_size_bytes: 4,
    }).returning('id');
    return rows[0]?.id ?? rows[0];
  }

  it('retains recent backups and only removes expired files inside the configured destination', async () => {
    const expiredPath = path.join(backupRoot, 'expired.sql.gz');
    const recentPath = path.join(backupRoot, 'recent.sql.gz');
    const outsidePath = path.join(outsideRoot, 'keep.sql.gz');
    fs.writeFileSync(expiredPath, 'old');
    fs.writeFileSync(recentPath, 'new');
    fs.writeFileSync(outsidePath, 'do not delete');

    const expiredId = await insertRun({ filePath: expiredPath, daysOld: 40 });
    const recentId = await insertRun({ filePath: recentPath, daysOld: 2 });
    const outsideId = await insertRun({ filePath: outsidePath, daysOld: 40 });

    const removed = await service.cleanupOldBackups(30);

    expect(removed).toBe(1);
    expect(fs.existsSync(expiredPath)).toBe(false);
    expect(fs.readFileSync(recentPath, 'utf8')).toBe('new');
    expect(fs.readFileSync(outsidePath, 'utf8')).toBe('do not delete');
    const retainedIds = await db('database_backup_runs').whereIn('id', [expiredId, recentId, outsideId]).pluck('id');
    expect(retainedIds.sort()).toEqual([recentId, outsideId].sort());
  });

  it('refuses invalid retention periods instead of silently widening cleanup', async () => {
    await expect(service.cleanupOldBackups(0)).rejects.toThrow(/integer from 1 to 3650/);
    await expect(service.cleanupOldBackups(1.5)).rejects.toThrow(/integer from 1 to 3650/);
  });
});
