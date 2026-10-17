const request = require('supertest');
const { bootTestDb, seedMinimal, assignAdminRole, mintAdminToken, buildRouteApp } = require('./helpers/sqliteTestDb');

describe('admin failed-photo retry route', () => {
  let db;
  let cleanup;
  let app;
  let token;

  beforeAll(async () => {
    ({ db, cleanup } = await bootTestDb());
    const { adminId } = await seedMinimal(db);
    await assignAdminRole(db, adminId, 'super_admin');
    token = mintAdminToken(adminId);
    app = buildRouteApp('/api/admin/photos', require('../../src/routes/adminPhotos'));
  }, 180000);

  afterAll(async () => { if (cleanup) await cleanup(); });

  it('matches the client URL and requeues only failed processing records', async () => {
    await db('events').insert({
      event_type: 'project', event_name: 'Retry route', event_date: '2026-10-17', slug: 'retry-route',
      share_link: '/gallery/retry-route', is_active: true, is_archived: false, is_draft: false,
      password_hash: '',
      created_at: new Date().toISOString(),
    });
    const event = await db('events').where({ slug: 'retry-route' }).first();
    const inserted = await db('photos').insert({
      event_id: event.id, filename: 'broken.jpg', path: 'broken.jpg', type: 'individual',
      processing_status: 'failed', processing_error: 'invalid image', uploaded_at: new Date().toISOString(),
    }).returning('id');
    const photoId = inserted[0]?.id || inserted[0];

    const response = await request(app)
      .post(`/api/admin/photos/${photoId}/retry`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body).toMatchObject({ id: photoId, status: 'pending' });
    expect(await db('photos').where({ id: photoId }).first()).toMatchObject({
      processing_status: 'pending', processing_error: null, processing_started_at: null,
    });
  }, 180000);
});
