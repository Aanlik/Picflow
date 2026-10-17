const request = require('supertest');
const { bootTestDb, seedMinimal, assignAdminRole, mintAdminToken, buildRouteApp } = require('./helpers/sqliteTestDb');

describe('local administrator account lifecycle', () => {
  let db; let cleanup; let app; let rootId; let token; let viewerRole;
  beforeAll(async () => {
    ({ db, cleanup } = await bootTestDb());
    ({ adminId: rootId } = await seedMinimal(db));
    await assignAdminRole(db, rootId, 'super_admin');
    token = mintAdminToken(rootId);
    viewerRole = await db('roles').where({ name: 'viewer' }).first();
    app = buildRouteApp('/api/admin/local-users', require('../../src/routes/adminLocalUsers'));
  }, 180000);
  afterAll(async () => { if (cleanup) await cleanup(); });

  it('allows changing role/status and deleting a temporary account', async () => {
    const password = await require('bcrypt').hash('Temporary-Strong-Password-55!', 4);
    const inserted = await db('admin_users').insert({
      username: 'temporary_viewer', email: 'temporary_viewer@local.invalid', password_hash: password,
      role_id: viewerRole.id, is_active: true, must_change_password: true, created_at: new Date(),
    }).returning('id');
    const id = inserted[0]?.id || inserted[0];

    await request(app).patch(`/api/admin/local-users/${id}`).set('Authorization', `Bearer ${token}`)
      .send({ is_active: false }).expect(200);
    expect(Number((await db('admin_users').where({ id }).first()).is_active)).toBe(0);

    await request(app).patch(`/api/admin/local-users/${id}`).set('Authorization', `Bearer ${token}`)
      .send({ is_active: true }).expect(200);
    await request(app).delete(`/api/admin/local-users/${id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(await db('admin_users').where({ id }).first()).toBeUndefined();
  });

  it('prevents disabling or deleting the current administrator', async () => {
    await request(app).patch(`/api/admin/local-users/${rootId}`).set('Authorization', `Bearer ${token}`)
      .send({ is_active: false }).expect(409);
    await request(app).delete(`/api/admin/local-users/${rootId}`).set('Authorization', `Bearer ${token}`).expect(409);
  });
});
