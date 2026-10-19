const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'picflow-guest-role-')), 'db.sqlite',
);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'guest-role-selection-test-secret';

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const { bootTestDb, seedMinimal } = require('../integration/helpers/sqliteTestDb');

const SLUG = 'guest-role-selection';

describe('returning customer role selection', () => {
  let db; let cleanup; let app; let eventId; let guestId;

  beforeAll(async () => {
    ({ db, cleanup } = await bootTestDb());
    await seedMinimal(db);
    const [event] = await db('events').insert({
      slug: SLUG,
      event_type: 'project',
      event_name: 'Role selection test',
      event_date: '2026-10-19',
      password_hash: 'unused',
      share_link: `/gallery/${SLUG}/share-token`,
      share_token: 'abcdefabcdefabcdefabcdefabcdefab',
      require_password: 0,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      is_active: 1,
      is_archived: 0,
      is_draft: 0,
      created_at: new Date().toISOString(),
    }).returning('id');
    eventId = event?.id ?? event;
    await db('event_feedback_settings').insert({
      event_id: eventId,
      feedback_enabled: true,
      identity_mode: 'guest',
      allow_likes: true,
      allow_comments: true,
      allow_ratings: true,
      allow_favorites: true,
    });
    const [guest] = await db('gallery_guests').insert({
      event_id: eventId,
      name: '验收客户A',
      identifier: 'role-selection-guest-a',
      is_deleted: false,
      created_at: new Date().toISOString(),
    }).returning('id');
    guestId = guest?.id ?? guest;
    await db('gallery_guests').insert({
      event_id: eventId,
      name: '已删除客户',
      identifier: 'role-selection-deleted',
      is_deleted: true,
      created_at: new Date().toISOString(),
    });

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/gallery', require('../../src/routes/gallery'));
    app.use('/api/gallery', require('../../src/routes/galleryGuests'));
  }, 120000);

  afterAll(async () => { if (cleanup) await cleanup(); });

  it('lists only active nicknames for an enabled guest-identity gallery', async () => {
    const res = await request(app).get(`/api/gallery/${SLUG}/guest/roles`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.body.guests).toEqual([expect.objectContaining({ id: guestId, name: '验收客户A' })]);
    expect(JSON.stringify(res.body)).not.toContain('role-selection-guest-a');
  });

  it('mints a gallery-bound guest session after a customer chooses an existing role', async () => {
    const selected = await request(app)
      .post(`/api/gallery/${SLUG}/guest/select`)
      .send({ guestId });
    expect(selected.status).toBe(200);
    expect(selected.body.guest).toMatchObject({ id: guestId, name: '验收客户A' });
    expect(typeof selected.body.token).toBe('string');

    const me = await request(app)
      .get(`/api/gallery/${SLUG}/guest/me`)
      .set('x-guest-token', selected.body.token);
    expect(me.status).toBe(200);
    expect(me.body.guest).toMatchObject({ id: guestId, name: '验收客户A' });
  });

  it('does not let the role-selection endpoint activate a deleted or foreign guest', async () => {
    const missing = await request(app)
      .post(`/api/gallery/${SLUG}/guest/select`)
      .send({ guestId: 999999 });
    expect(missing.status).toBe(404);
  });
});
