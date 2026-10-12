const express = require('express');
const request = require('supertest');
const { bootTestDb, seedMinimal } = require('./helpers/sqliteTestDb');

describe('admin guest list color-label totals', () => {
  let db; let cleanup; let app; let eventId; let guests; let photos;

  beforeAll(async () => {
    jest.resetModules();
    jest.doMock('../../src/middleware/auth', () => ({
      adminAuth: (req, _res, next) => { req.admin = { id: 1, username: 'tester' }; next(); },
    }));
    jest.doMock('../../src/middleware/permissions', () => ({
      requirePermission: () => (_req, _res, next) => next(),
    }));
    jest.doMock('../../src/middleware/ownership', () => ({
      requireEventOwnership: (_req, _res, next) => next(),
    }));

    ({ db, cleanup } = await bootTestDb());
    await seedMinimal(db);
    const [event] = await db('events').insert({
      slug: 'guest-color-counts', event_type: 'project', event_name: 'Guest color counts',
      event_date: '2026-10-01', password_hash: 'x', share_link: '/gallery/guest-color-counts/share',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      is_active: true, is_archived: false, is_draft: false,
    }).returning('id');
    eventId = event.id ?? event;

    app = express();
    app.use(express.json());
    app.use('/api/admin', require('../../src/routes/adminGuests'));
  }, 180000);

  beforeEach(async () => {
    await db('photo_feedback').del();
    await db('gallery_guests').del();
    await db('photos').del();
    guests = await db('gallery_guests').insert(['Lin', 'Mei'].map((name) => ({
      event_id: eventId,
      name,
      identifier: `guest-${name}`,
      is_deleted: false,
    }))).returning('*');
    photos = await db('photos').insert([1, 2, 3].map((number) => ({
      event_id: eventId,
      filename: `photo-${number}.jpg`,
      path: `guest-color-counts/photo-${number}.jpg`,
      type: 'individual',
    }))).returning('*');
  });

  afterAll(async () => { if (cleanup) await cleanup(); });

  it('returns the same per-guest color-label count in the list and detail views', async () => {
    const addLabel = (guest, photo, color) => db('photo_feedback').insert({
      event_id: eventId,
      photo_id: photo.id,
      guest_id: guest.id,
      guest_identifier: guest.identifier,
      feedback_type: 'color_label',
      color_label: color,
      is_hidden: false,
    });
    await addLabel(guests[0], photos[0], 'purple');
    await addLabel(guests[0], photos[1], 'green');
    await addLabel(guests[1], photos[2], 'red');

    const list = await request(app).get(`/api/admin/events/${eventId}/guests`);
    const detail = await request(app).get(`/api/admin/events/${eventId}/guests/${guests[0].id}`);

    expect(list.status).toBe(200);
    expect(detail.status).toBe(200);
    expect(list.body.guests.find((guest) => guest.id === guests[0].id).stats.color_labels).toBe(2);
    expect(detail.body.guest.stats.color_labels).toBe(2);
  });
});
