'use strict';

// First-run bootstrap tests. bootTestDb() must run before requiring setupService
// so it binds to this suite's isolated SQLite database.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-32-characters-long!!';

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { bootTestDb, buildRouteApp } = require('./helpers/sqliteTestDb');

let db;
let cleanup;
let tmpDir;
let setupService;
let upsertAppSetting;
let app;

const VALID_PW = 'Str0ng-Passw0rd!';

beforeAll(async () => {
  ({ db, cleanup, tmpDir } = await bootTestDb());
  setupService = require('../../src/services/setupService');
  ({ upsertAppSetting } = require('../../src/utils/appSettings'));
  app = buildRouteApp('/api/setup', require('../../src/routes/setup'));
}, 120000);

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await db('admin_users').del();
  // Migration 161 seeds this stable row on every supported installation. Keep
  // the fixture in a fresh-install state for each test.
  await upsertAppSetting('setup_wizard_completed', JSON.stringify(false), 'boolean');
});

describe('setupService (first-run bootstrap)', () => {
  it('reports that the first administrator is needed on a fresh install', async () => {
    expect(await setupService.getSetupStatus()).toEqual({ needsAdmin: true, complete: false });
  });

  it('creates the first admin as super_admin without any setup token', async () => {
    const result = await setupService.createInitialAdmin({ username: 'SetupOwner', password: VALID_PW });

    expect(result.user.username).toBe('SetupOwner');
    expect(result.user.role.name).toBe('super_admin');
    expect(result.token).toEqual(expect.any(String));

    const row = await db('admin_users').first();
    const role = await db('roles').where({ name: 'super_admin' }).first();
    expect(row.role_id).toBe(role.id);
    expect(row.password_hash).not.toBe(VALID_PW);
    expect(await setupService.getSetupStatus()).toEqual({ needsAdmin: false, complete: true });
  });

  it('rejects an invalid username and a weak password', async () => {
    await expect(setupService.createInitialAdmin({ username: 'x', password: VALID_PW }))
      .rejects.toMatchObject({ statusCode: 400, details: 'username' });
    await expect(setupService.createInitialAdmin({ username: 'adminA', password: 'weak' }))
      .rejects.toMatchObject({ statusCode: 400, details: 'password' });
  });

  it('refuses a second administrator after setup has completed', async () => {
    await setupService.createInitialAdmin({ username: 'firstAdmin', password: VALID_PW });
    await expect(
      setupService.createInitialAdmin({ username: 'secondAdmin', password: VALID_PW })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('serialises concurrent first-admin submissions so only one admin is created', async () => {
    const results = await Promise.allSettled([
      setupService.createInitialAdmin({ username: 'adminA', password: VALID_PW }),
      setupService.createInitialAdmin({ username: 'adminB', password: VALID_PW }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const count = await db('admin_users').count({ c: '*' }).first();
    expect(Number(count.c)).toBe(1);
  });

  it('migration removes the retired token setting and its old data-volume file', async () => {
    const previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
    const tokenFile = path.join(tmpDir, 'SETUP_TOKEN');
    fs.writeFileSync(tokenFile, 'obsolete credential');
    await db('app_settings').insert({
      setting_key: 'setup_token',
      setting_value: JSON.stringify('obsolete credential'),
      setting_type: 'string',
      updated_at: new Date(),
    });

    try {
      await require('../../migrations/core/252_remove_setup_token').up(db);
      expect(await db('app_settings').where({ setting_key: 'setup_token' }).first()).toBeUndefined();
      expect(fs.existsSync(tokenFile)).toBe(false);
    } finally {
      if (previousDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDataDir;
    }
  });
});

describe('setup routes', () => {
  it('GET /api/setup/status reports that setup is pending', async () => {
    const res = await request(app).get('/api/setup/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ needsAdmin: true, complete: false });
  });

  it('POST /api/setup/admin creates the first admin without a token and sets the auth cookie', async () => {
    const res = await request(app)
      .post('/api/setup/admin')
      .send({ username: 'owner', password: VALID_PW });
    expect(res.status).toBe(201);
    expect(res.body.user.role.name).toBe('super_admin');
    expect((res.headers['set-cookie'] || []).join(';')).toMatch(/admin_token/);
    expect(await setupService.getSetupStatus()).toEqual({ needsAdmin: false, complete: true });
  });

  it('POST /api/setup/admin validates the account fields', async () => {
    const res = await request(app).post('/api/setup/admin').send({ username: 'owner' });
    expect(res.status).toBe(400);
  });

  it('POST /api/setup/admin is closed once an admin exists', async () => {
    await setupService.createInitialAdmin({ username: 'firstAdmin', password: VALID_PW });
    const res = await request(app)
      .post('/api/setup/admin')
      .send({ username: 'secondAdmin', password: VALID_PW });
    expect(res.status).toBe(409);
  });

  it('removes the obsolete verify-token endpoint', async () => {
    const res = await request(app).post('/api/setup/verify-token').send({});
    expect(res.status).toBe(404);
  });
});
