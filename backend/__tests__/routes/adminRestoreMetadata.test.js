const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const { parseManifestMetadata, restoreErrorCode } = require('../../src/routes/adminRestore')._internal;

describe('restore manifest metadata shown in the backup picker', () => {
  let root;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'picflow-restore-metadata-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('extracts the restore date, exact file count, backup type, and logical payload size', async () => {
    const file = path.join(root, 'backup-manifest-test.json');
    await fs.writeFile(file, JSON.stringify({
      manifest: { version: '2.0', id: 'test', created: '2026-10-20T00:13:00.000Z' },
      backup: { id: 'test', type: 'full', timestamp: '2026-10-20T00:13:00.000Z', total_size_bytes: 4_659_023_626 },
      files: { count: 899, total_size: 4_659_023_626, manifest: [] },
      database: { backup_file: 'database/db.sql.gz' },
    }));

    await expect(parseManifestMetadata(file)).resolves.toMatchObject({
      manifestId: 'test',
      completed: '2026-10-20T00:13:00.000Z',
      filesCount: 899,
      size: 4_659_023_626,
      databaseIncluded: true,
      backupType: 'full',
    });
  });

  it('preserves an unknown file count when an older manifest has no count metadata', async () => {
    const file = path.join(root, 'manifest.json');
    await fs.writeFile(file, JSON.stringify({ backup_id: 'old', started_at: '2025-01-01T00:00:00.000Z' }));

    const parsed = await parseManifestMetadata(file);
    expect(parsed.filesCount).toBeNull();
    expect(parsed.completed).toBe('2025-01-01T00:00:00.000Z');
  });
});

describe('restore error classification', () => {
  it.each([
    ['BACKUP_MANIFEST_MISSING', 'BACKUP_MANIFEST_MISSING'],
    ['BACKUP_DATA_MISSING', 'BACKUP_DATA_MISSING'],
    ['BACKUP_DATA_UNAVAILABLE', 'BACKUP_DATA_UNAVAILABLE'],
    ['BACKUP_UNSAFE_PATH', 'BACKUP_UNSAFE_PATH'],
    ['BACKUP_PATH_OUTSIDE', 'BACKUP_PATH_OUTSIDE'],
  ])('preserves safe code %s for the UI', (code, expected) => {
    expect(restoreErrorCode(Object.assign(new Error('/nas/private/path'), { code }))).toBe(expected);
  });

  it('classifies legacy missing-file errors without returning their host path', () => {
    expect(restoreErrorCode(new Error('ENOENT: no such file or directory, open /vol1/private/backup.json')))
      .toBe('BACKUP_DATA_MISSING');
  });
});
