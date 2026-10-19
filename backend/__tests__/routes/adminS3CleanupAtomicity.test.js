const {
  hasSurvivingS3Child,
  removeS3RestorePointManifests,
  normalizeS3ObjectKey,
  parseRetentionDays,
} = require('../../src/routes/adminBackup')._internal;

function item(id = 1) {
  return {
    run: { id, manifest_path: `s3://bucket/backups/runs/${id}/manifest.json` },
    manifestKey: `backups/runs/${id}/manifest.json`,
  };
}

describe('S3 restore-point cleanup ordering', () => {
  it('normalizes safe object keys and refuses path traversal or absolute keys', () => {
    expect(normalizeS3ObjectKey('backups/objects/sha256/ab/cd')).toBe('backups/objects/sha256/ab/cd');
    expect(normalizeS3ObjectKey('backups\\objects\\sha256\\ab\\cd')).toBe('backups/objects/sha256/ab/cd');
    expect(normalizeS3ObjectKey('backups/../outside/secret')).toBeNull();
    expect(normalizeS3ObjectKey('/backups/private')).toBeNull();
  });

  it('rejects invalid S3 retention values instead of silently shortening cleanup', () => {
    expect(parseRetentionDays(undefined)).toBe(30);
    expect(parseRetentionDays('30')).toBe(30);
    for (const value of [0, -1, 1.5, 3651, 'not-a-number']) {
      expect(parseRetentionDays(value)).toBeNull();
    }
  });

  it('retains an expired parent referenced by a surviving S3 run in another prefix', async () => {
    const restorePoint = {
      run: { id: 4, manifest_path: 's3://bucket/backups/runs/4/manifests/manifest.json' },
      manifestKey: 'backups/runs/4/manifests/manifest.json',
      manifest: { backup: { id: 'parent-manifest-id' } },
    };
    const retainedRun = {
      id: 22,
      manifest_path: 's3://bucket/archive/runs/22/manifests/manifest.json',
    };

    await expect(hasSurvivingS3Child(restorePoint, [retainedRun], async () => ({
      manifest: { incremental: { parent_backup_id: 'parent-manifest-id' } },
    }))).resolves.toBe(true);
  });

  it('removes the index before allowing payload cleanup', async () => {
    const restorePoint = item();
    const deleteRun = jest.fn().mockResolvedValue(undefined);
    const restoreRun = jest.fn();
    const adapter = {
      deleteMany: jest.fn().mockResolvedValue({ Deleted: [{ Key: restorePoint.manifestKey }], Errors: [] }),
      exists: jest.fn(),
    };

    const result = await removeS3RestorePointManifests([restorePoint], adapter, { deleteRun, restoreRun });

    expect(result).toEqual({ removed: [restorePoint], failed: [] });
    expect(deleteRun).toHaveBeenCalledWith(restorePoint.run);
    expect(adapter.deleteMany).toHaveBeenCalledWith([restorePoint.manifestKey]);
    expect(restoreRun).not.toHaveBeenCalled();
  });

  it('restores the visible row when S3 confirms the manifest still exists', async () => {
    const restorePoint = item();
    const deleteRun = jest.fn().mockResolvedValue(undefined);
    const restoreRun = jest.fn().mockResolvedValue(undefined);
    const adapter = {
      deleteMany: jest.fn().mockResolvedValue({ Deleted: [], Errors: [{ Key: restorePoint.manifestKey }] }),
      exists: jest.fn().mockResolvedValue(true),
    };

    const result = await removeS3RestorePointManifests([restorePoint], adapter, { deleteRun, restoreRun });

    expect(result.removed).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(restoreRun).toHaveBeenCalledWith(restorePoint.run);
  });

  it('treats an ambiguous delete as removed only when a follow-up existence check says absent', async () => {
    const restorePoint = item();
    const adapter = {
      deleteMany: jest.fn().mockRejectedValue(new Error('connection interrupted')),
      exists: jest.fn().mockResolvedValue(false),
    };
    const result = await removeS3RestorePointManifests([restorePoint], adapter, {
      deleteRun: jest.fn().mockResolvedValue(undefined),
      restoreRun: jest.fn(),
    });

    expect(result).toEqual({ removed: [restorePoint], failed: [] });
  });

  it('does not contact S3 when the database record could not be hidden', async () => {
    const restorePoint = item();
    const adapter = { deleteMany: jest.fn(), exists: jest.fn() };
    const result = await removeS3RestorePointManifests([restorePoint], adapter, {
      deleteRun: jest.fn().mockRejectedValue(new Error('database unavailable')),
      restoreRun: jest.fn(),
    });

    expect(adapter.deleteMany).not.toHaveBeenCalled();
    expect(result.removed).toEqual([]);
    expect(result.failed).toHaveLength(1);
  });
});
