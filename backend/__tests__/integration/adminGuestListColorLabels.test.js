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

  it.each([
    ['txt', 'text/plain', /photo-1\.jpg/],
    ['csv', 'text/csv', /filename,original_filename,feedback_type/],
    ['json', 'application/json', /"guest"/],
  ])('exports a single guest as %s, including an empty selection set', async (format, contentType, expected) => {
    await db('photo_feedback').insert({
      event_id: eventId,
      photo_id: photos[0].id,
      guest_id: guests[0].id,
      guest_identifier: guests[0].identifier,
      feedback_type: 'like',
      is_hidden: false,
    });
    const response = await request(app)
      .get(`/api/admin/events/${eventId}/guests/${guests[0].id}/export`)
      .query({ format });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain(contentType);
    expect(response.headers['content-disposition']).toContain(`Lin_${guests[0].id}.${format}`);
    expect(response.text).toMatch(expected);
  });

  it('returns a valid empty export for a guest with no interactions', async () => {
    const txt = await request(app)
      .get(`/api/admin/events/${eventId}/guests/${guests[1].id}/export`)
      .query({ format: 'txt' });
    const csv = await request(app)
      .get(`/api/admin/events/${eventId}/guests/${guests[1].id}/export`)
      .query({ format: 'csv' });
    const json = await request(app)
      .get(`/api/admin/events/${eventId}/guests/${guests[1].id}/export`)
      .query({ format: 'json' });

    expect(txt.status).toBe(200);
    expect(txt.text).toBe('');
    expect(csv.status).toBe(200);
    expect(csv.text).toBe('filename,original_filename,feedback_type');
    expect(json.status).toBe(200);
    expect(JSON.parse(json.text).selections).toEqual([]);
  });

  it('returns a valid empty ZIP when export-all has no guest rows', async () => {
    await db('gallery_guests').del();

    const response = await request(app)
      .get(`/api/admin/events/${eventId}/guests/export-all`)
      .query({ format: 'csv' })
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/zip');
    expect(response.body.length).toBeGreaterThan(0);
    // A valid empty ZIP is exactly an end-of-central-directory record. Check
    // the signature rather than trusting a 200 + application/zip response.
    expect(response.body.length).toBeGreaterThanOrEqual(22);
    expect(response.body.readUInt32LE(response.body.length - 22)).toBe(0x06054b50);
  });
});
