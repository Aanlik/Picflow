'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'picpeak-workflow-summary-')), 'db.sqlite');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'workflow-summary-test-secret';
process.env.PIXCAKE_BRIDGE_URL = 'http://bridge:8080';
const originalExternalMediaRoot = process.env.EXTERNAL_MEDIA_ROOT;

const request = require('supertest');
const {
  bootTestDb,
  seedMinimal,
  assignAdminRole,
  mintAdminToken,
  buildRouteApp,
} = require('../integration/helpers/sqliteTestDb');
const { clearPermissionCache } = require('../../src/middleware/permissions');

describe('admin photography workflow summary', () => {
  const originalFetch = global.fetch;
  let db;
  let cleanup;
  let app;
  let token;
  let eventId;

  const auth = (req) => req.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const externalRoot = path.join(path.dirname(process.env.TEST_DATABASE_PATH), 'external-media');
    fs.mkdirSync(path.join(externalRoot, 'Camera', '2026', '26-10-04', '02_PROOF'), { recursive: true });
    process.env.EXTERNAL_MEDIA_ROOT = externalRoot;
    ({ db, cleanup } = await bootTestDb());
    const { adminId } = await seedMinimal(db);
    await assignAdminRole(db, adminId, 'super_admin');
    token = mintAdminToken(adminId);
    clearPermissionCache();
    const inserted = await db('events').insert({
      slug: 'workflow-summary', event_name: 'Workflow Summary', event_type: 'project',
      event_date: '2026-10-10', password_hash: 'x', share_token: 'workflow-summary-token',
      share_link: '/gallery/workflow-summary-token', expires_at: new Date(Date.now() + 86400000).toISOString(),
      is_active: true, is_archived: false, is_draft: false, created_by: adminId,
    }).returning('id');
    eventId = inserted[0]?.id ?? inserted[0];
    app = buildRouteApp('/api/admin/photography-workflow', require('../../src/routes/photographyWorkflow'));
  }, 120000);

  afterAll(async () => {
    global.fetch = originalFetch;
    if (originalExternalMediaRoot === undefined) delete process.env.EXTERNAL_MEDIA_ROOT;
    else process.env.EXTERNAL_MEDIA_ROOT = originalExternalMediaRoot;
    if (cleanup) await cleanup();
  });

  it('uses the current Picflow project names and ordering and excludes unknown ids', async () => {
    const olderInserted = await db('events').insert({
      slug: 'workflow-summary-older', event_name: 'Older upstream project', event_type: 'project',
      event_date: '2026-10-09', password_hash: 'x', share_token: 'workflow-summary-older-token',
      share_link: '/gallery/workflow-summary-older-token', expires_at: new Date(Date.now() + 86400000).toISOString(),
      is_active: true, is_archived: false, is_draft: false,
      created_by: (await db('events').where({ id: eventId }).first()).created_by,
    }).returning('id');
    const olderEventId = olderInserted[0]?.id ?? olderInserted[0];
    await db('events').where({ id: eventId }).update({
      event_name: 'Current Picflow name',
      created_at: new Date(Date.now()).toISOString(),
    });
    await db('events').where({ id: olderEventId }).update({
      created_at: new Date(Date.now() - 60000).toISOString(),
    });

    global.fetch = jest.fn(async () => ({
      status: 200,
      json: async () => [
        { event_id: olderEventId, name: 'Stale older name', stage: 'SELECTING', connected: true, summary: {} },
        { event_id: eventId, name: 'Stale Bridge name', stage: 'EDITING', connected: true, summary: { '客户已选': 8 } },
        { event_id: 999999, name: 'Unknown project', stage: 'SELECTING', connected: true, summary: {} },
      ],
    }));

    const result = await auth(request(app).get('/api/admin/photography-workflow/summary'));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ configured: true });
    expect(result.body.projects).toEqual([
      expect.objectContaining({ event_id: eventId, name: 'Current Picflow name', summary: { '客户已选': 8 } }),
      expect.objectContaining({ event_id: olderEventId, name: 'Older upstream project' }),
    ]);
    expect(String(global.fetch.mock.calls[0][0])).toBe('http://bridge:8080/api/projects');
  });

  it('auto-mount suggestions use the sibling 01_RAW when Picflow references 02_PROOF', async () => {
    await db('events').where({ id: eventId }).update({
      source_mode: 'reference',
      external_path: 'Camera/2026/26-10-04/02_PROOF',
    });
    global.fetch = jest.fn(async (url) => ({
      status: 404,
      json: async () => ({ detail: '项目尚未绑定' }),
      headers: { get: () => '' },
    }));
    // The first request checks whether the Bridge project exists. The second
    // is the mount probe whose path must point at the RAW sibling.
    global.fetch.mockImplementationOnce(async () => ({
      status: 404,
      json: async () => ({ detail: '项目尚未绑定' }),
      headers: { get: () => '' },
    })).mockImplementationOnce(async () => ({
      status: 200,
      json: async () => ({ writable_mount_ready: true }),
      headers: { get: () => '' },
    }));

    const result = await auth(request(app).get(`/api/admin/photography-workflow/${eventId}`));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      configured: false,
      auto_bind_available: true,
      suggested_raw_subdir: '2026/26-10-04/01_RAW',
    });
    expect(String(global.fetch.mock.calls[1][0])).toContain('raw_subdir=2026%2F26-10-04%2F01_RAW');
  });
});
