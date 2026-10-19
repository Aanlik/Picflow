const request = require('supertest');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { inflateRawSync } = require('zlib');
const { bootTestDb, seedMinimal, assignAdminRole, mintAdminToken, buildRouteApp } = require('./helpers/sqliteTestDb');

function unpackZip(buffer) {
  const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocdOffset = buffer.lastIndexOf(eocdSignature);
  if (eocdOffset < 0) throw new Error('ZIP end-of-central-directory record is missing');
  const count = buffer.readUInt16LE(eocdOffset + 10);
  let cursor = buffer.readUInt32LE(eocdOffset + 16);
  const files = new Map();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP central directory entry');
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const contentOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(contentOffset, contentOffset + compressedSize);
    const content = method === 8 ? inflateRawSync(compressed) : compressed;
    files.set(name, content);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

describe('backup restore-point download and cleanup', () => {
  let db; let cleanup; let app; let token; let rootId; let root;
  beforeAll(async () => {
    ({ db, cleanup } = await bootTestDb());
    ({ adminId: rootId } = await seedMinimal(db));
    await assignAdminRole(db, rootId, 'super_admin');
    token = mintAdminToken(rootId);
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'picflow-backup-run-'));
    await db('app_settings').insert([
      { setting_key: 'backup_destination_type', setting_value: JSON.stringify('local'), setting_type: 'backup' },
      { setting_key: 'backup_destination_path', setting_value: JSON.stringify(root), setting_type: 'backup' },
    ]).onConflict('setting_key').merge(['setting_value', 'setting_type']);
    app = buildRouteApp('/api/admin/backup', require('../../src/routes/adminBackup'));
  }, 180000);
  afterAll(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
    if (cleanup) await cleanup();
  });

  async function createRun({ parentId = null, includeDatabase = false } = {}) {
    const fileContent = `backup-payload-${Date.now()}`;
    const relative = 'events/active/sample.txt';
    const payloadPath = path.join(root, relative);
    await fs.mkdir(path.dirname(payloadPath), { recursive: true });
    await fs.writeFile(payloadPath, fileContent);
    const hash = crypto.createHash('sha256').update(fileContent).digest('hex');
    const databaseFile = includeDatabase ? path.join(root, 'database', 'picflow.sqlite') : null;
    if (databaseFile) {
      await fs.mkdir(path.dirname(databaseFile), { recursive: true });
      await fs.writeFile(databaseFile, 'acceptance-database-payload');
    }
    const databaseContent = databaseFile ? await fs.readFile(databaseFile) : null;
    const manifest = await require('../../src/services/backupManifest').generateManifest({
      backupType: parentId ? 'incremental' : 'full',
      backupPath: root,
      files: [{ relativePath: relative, path: relative, size: Buffer.byteLength(fileContent), checksum: hash }],
      databaseInfo: databaseFile ? {
        type: 'sqlite', backupFile: 'database/picflow.sqlite', size: databaseContent.length,
        checksum: crypto.createHash('sha256').update(databaseContent).digest('hex'),
      } : {},
      customMetadata: { backup_run_id: Date.now() },
      parentBackupId: parentId,
    });
    manifest.backup.parent_backup_id = parentId;
    manifest.verification.total_checksum = require('../../src/services/backupManifest').calculateManifestChecksum(manifest);
    const manifestPath = path.join(root, 'manifests', `${Date.now()}-${Math.random()}.json`);
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await require('../../src/services/backupManifest').saveManifest(manifest, manifestPath);
    const inserted = await db('backup_runs').insert({
      started_at: new Date().toISOString(), completed_at: new Date().toISOString(), status: 'completed',
      backup_type: parentId ? 'incremental' : 'manual', files_backed_up: 1, total_size_bytes: Buffer.byteLength(fileContent),
      manifest_path: manifestPath, manifest_id: manifest.backup.id, manifest_format: 'json',
      ...(parentId ? { parent_backup_id: parentId } : {}),
    }).returning('id');
    return { id: inserted[0]?.id || inserted[0], manifestPath, payloadPath, databaseFile, fileContent };
  }

  async function createImmutableSnapshotRun() {
    const inserted = await db('backup_runs').insert({
      started_at: new Date().toISOString(), status: 'running', backup_type: 'manual',
    }).returning('id');
    const id = inserted[0]?.id || inserted[0];
    const snapshotName = `backup-${id}`;
    const snapshotRoot = path.join(root, snapshotName);
    const relative = 'events/active/standalone.txt';
    const payloadPath = path.join(snapshotRoot, relative);
    const content = 'standalone immutable snapshot';
    await fs.mkdir(path.dirname(payloadPath), { recursive: true });
    await fs.writeFile(payloadPath, content);
    const manifest = await require('../../src/services/backupManifest').generateManifest({
      backupType: 'full',
      backupPath: snapshotName,
      files: [{
        relativePath: relative,
        path: relative,
        size: Buffer.byteLength(content),
        checksum: crypto.createHash('sha256').update(content).digest('hex'),
      }],
      customMetadata: { backup_run_id: id, destination_type: 'local', local_snapshot: true },
      parentBackupId: null,
    });
    const manifestPath = path.join(root, 'manifests', `snapshot-${id}.json`);
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await require('../../src/services/backupManifest').saveManifest(manifest, manifestPath);
    await db('backup_runs').where({ id }).update({
      completed_at: new Date().toISOString(), status: 'completed', files_backed_up: 1,
      total_size_bytes: Buffer.byteLength(content), manifest_path: manifestPath,
      manifest_id: manifest.backup.id,
    });
    return { id, snapshotRoot, manifestPath, relative, content };
  }

  async function createExpiredSnapshot({ ageDays = 40, parentId = null } = {}) {
    const startedAt = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString();
    const inserted = await db('backup_runs').insert({
      started_at: startedAt, completed_at: startedAt, status: 'completed', backup_type: 'manual',
      files_backed_up: 0, total_size_bytes: 0, parent_backup_id: parentId,
    }).returning('id');
    const id = inserted[0]?.id || inserted[0];
    const snapshotName = `backup-${id}`;
    const snapshotRoot = path.join(root, snapshotName);
    await fs.mkdir(snapshotRoot, { recursive: true });
    const manifest = await require('../../src/services/backupManifest').generateManifest({
      backupType: 'full', backupPath: snapshotName, files: [], parentBackupId: null,
      customMetadata: { backup_run_id: id, destination_type: 'local', local_snapshot: true },
    });
    const manifestPath = path.join(root, 'manifests', `expired-${id}.json`);
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await require('../../src/services/backupManifest').saveManifest(manifest, manifestPath);
    await db('backup_runs').where({ id }).update({ manifest_path: manifestPath, manifest_id: manifest.backup.id });
    return { id, snapshotRoot, manifestPath };
  }

  it('downloads the actual files listed by the manifest rather than a nonexistent per-run folder', async () => {
    const run = await createRun({ includeDatabase: true });
    const response = await request(app).get(`/api/admin/backup/download/${run.id}`)
      .set('Authorization', `Bearer ${token}`).buffer(true).parse((res, callback) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    if (response.status !== 200) throw new Error(`backup download failed: ${response.status} ${JSON.stringify(response.body)}`);
    expect(response.headers['content-type']).toMatch(/application\/zip/);
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(response.body.length).toBeGreaterThan(200);
    const contents = unpackZip(response.body);
    expect(contents.get('events/active/sample.txt').toString()).toBe(run.fileContent);
    expect(contents.get('database/picflow.sqlite').toString()).toBe('acceptance-database-payload');
    const bundledManifest = JSON.parse(contents.get('manifest.json').toString());
    expect(bundledManifest.database.backup_file).toBe('database/picflow.sqlite');
    expect(bundledManifest.files.manifest.map((file) => file.path)).toContain('events/active/sample.txt');
    expect(contents.has('download-info.json')).toBe(true);
    const status = await request(app).get('/api/admin/backup/status?search=2026-10-17')
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(status.body.lastSuccessfulBackup.contentSummary).toMatchObject({ databaseIncluded: true, activeProjectFiles: 1, filesInThisRun: 1 });
  });

  it('downloads a generated-format immutable full snapshot without a parent manifest', async () => {
    const run = await createImmutableSnapshotRun();
    const response = await request(app).get(`/api/admin/backup/download/${run.id}`)
      .set('Authorization', `Bearer ${token}`).buffer(true).parse((res, callback) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      }).expect(200);

    expect(response.headers['content-type']).toMatch(/application\/zip/);
    const contents = unpackZip(response.body);
    expect(contents.get(run.relative).toString()).toBe(run.content);
    const manifest = JSON.parse(contents.get('manifest.json').toString());
    expect(manifest.backup).toMatchObject({ type: 'full', parent_backup_id: null });
    expect(manifest.metadata.local_snapshot).toBe(true);
  });

  it('refuses Windows drive paths in a local backup manifest before creating a ZIP', async () => {
    const run = await createRun();
    const backupManifest = require('../../src/services/backupManifest');
    const manifest = await backupManifest.loadManifest(run.manifestPath);
    manifest.files.manifest[0].path = 'C:/outside/private.txt';
    manifest.verification.total_checksum = backupManifest.calculateManifestChecksum(manifest);
    await backupManifest.saveManifest(manifest, run.manifestPath);

    await request(app).get(`/api/admin/backup/download/${run.id}`)
      .set('Authorization', `Bearer ${token}`).expect(409)
      .then((response) => expect(response.body.error).toMatch(/unsafe file path/i));

    await db('backup_runs').where({ id: run.id }).delete();
    await fs.unlink(run.manifestPath).catch(() => {});
    await fs.unlink(run.payloadPath).catch(() => {});
  });

  it('blocks a legacy restore point whose incremental parent is missing', async () => {
    const run = await createRun({ parentId: 999999 });
    const response = await request(app).get(`/api/admin/backup/download/${run.id}`)
      .set('Authorization', `Bearer ${token}`).expect(409);

    expect(response.body.error).toMatch(/parent backup required .* is missing/i);
    expect(await db('backup_runs').where({ id: run.id }).first()).toBeTruthy();
  });

  it('searches backup history by localized date, status, and actual backup type', async () => {
    const inserted = await db('backup_runs').insert({
      started_at: '2026-10-14 01:58:00', completed_at: '2026-10-14 02:01:00', status: 'completed',
      backup_type: 'manual', files_backed_up: 3, total_size_bytes: 1234,
    }).returning('id');
    const id = inserted[0]?.id || inserted[0];
    for (const term of ['2026/10/14', 'completed', 'manual']) {
      const response = await request(app).get(`/api/admin/backup/status?search=${encodeURIComponent(term)}`)
        .set('Authorization', `Bearer ${token}`).expect(200);
      expect(response.body.recentBackups.some((run) => Number(run.id) === Number(id))).toBe(true);
    }
    await db('backup_runs').where({ id }).delete();
  });

  it('searches history by the displayed backup size and localized file count', async () => {
    const id = (await db('backup_runs').insert({
      started_at: '2026-10-15 00:13:00', completed_at: '2026-10-15 00:13:30', status: 'completed',
      backup_type: 'manual', files_backed_up: 899, total_size_bytes: Math.round(4.34 * 1024 ** 3),
    }).returning('id'))[0];
    const runId = id?.id || id;

    for (const term of ['4.34 GB', '899 个文件', '899']) {
      const response = await request(app)
        .get(`/api/admin/backup/status?includeHistory=true&search=${encodeURIComponent(term)}`)
        .set('Authorization', `Bearer ${token}`).expect(200);
      expect(response.body.recentBackups.some((run) => Number(run.id) === Number(runId))).toBe(true);
    }

    await db('backup_runs').where({ id: runId }).delete();
  });

  it('refuses to remove a restore point with an incremental dependent', async () => {
    const parent = await createRun();
    const child = await createRun({ parentId: parent.id });
    const response = await request(app).delete(`/api/admin/backup/runs/${parent.id}`)
      .set('Authorization', `Bearer ${token}`).expect(409);
    expect(response.body.error).toMatch(/required by a later incremental backup/i);
    expect(await db('backup_runs').where({ id: parent.id }).first()).toBeTruthy();
    await db('backup_runs').where({ id: child.id }).delete();
    await db('backup_runs').where({ id: parent.id }).delete();
  });

  it('removes the restore-point record and manifest but preserves the shared payload tree', async () => {
    const run = await createRun();
    const response = await request(app).delete(`/api/admin/backup/runs/${run.id}`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(response.body).toMatchObject({ success: true, id: run.id, manifestRemoved: true, payloadRetained: true });
    expect(await db('backup_runs').where({ id: run.id }).first()).toBeUndefined();
    await expect(fs.access(run.manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(run.payloadPath)).resolves.toBeUndefined();
  });

  it('expires an immutable local snapshot together with its manifest and row', async () => {
    const backupService = require('../../src/services/backupService');
    const expired = await createExpiredSnapshot();

    const deletedCount = await backupService.cleanupOldBackupRuns(30);
    expect(deletedCount).toBeGreaterThanOrEqual(1);

    expect(await db('backup_runs').where({ id: expired.id }).first()).toBeUndefined();
    await expect(fs.access(expired.manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(expired.snapshotRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps an expired parent while a surviving restore point references it', async () => {
    const backupService = require('../../src/services/backupService');
    const parent = await createExpiredSnapshot();
    const child = await createExpiredSnapshot({ ageDays: 1, parentId: parent.id });
    expect(Number((await db('backup_runs').where({ id: child.id }).first()).parent_backup_id)).toBe(Number(parent.id));
    expect(new Date((await db('backup_runs').where({ id: child.id }).first()).started_at).getTime())
      .toBeGreaterThan(Date.now() - 30 * 24 * 60 * 60 * 1000);
    expect(await db('backup_runs').where({ parent_backup_id: parent.id }).first()).toBeTruthy();
    await backupService.cleanupOldBackupRuns(30);

    expect(await db('backup_runs').where({ id: parent.id }).first()).toBeTruthy();
    await expect(fs.access(parent.manifestPath)).resolves.toBeUndefined();
    await expect(fs.access(parent.snapshotRoot)).resolves.toBeUndefined();
    await db('backup_runs').where({ id: child.id }).delete();
    await db('backup_runs').where({ id: parent.id }).delete();
    await fs.rm(child.snapshotRoot, { recursive: true, force: true });
    await fs.unlink(child.manifestPath).catch(() => {});
  });
});
