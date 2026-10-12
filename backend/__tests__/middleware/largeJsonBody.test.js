const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'picpeak-largejson-')), 'db.sqlite');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'largejson-test-secret-with-32-chars!!';
process.env.STORAGE_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'picpeak-largejson-storage-'));

const { bootTestDb, seedMinimal, mintAdminToken } = require('../integration/helpers/sqliteTestDb');
const { createLargeJsonBody } = require('../../src/middleware/largeJsonBody');
const bigBody = JSON.stringify({ blob: 'x'.repeat(3 * 1024 * 1024) });
const smallBody = JSON.stringify({ blob: 'x' });

describe('large JSON parser requires a live admin session', () => {
  let cleanup;
  let app;
  let adminId;

  beforeAll(async () => {
    const seeded = await bootTestDb();
    cleanup = seeded.cleanup;
    const admin = await seedMinimal(seeded.db);
    adminId = admin.adminId;
    app = express();
    app.use(cookieParser());
    app.use('/api/admin', createLargeJsonBody({ limit: '50mb' }));
    app.use(express.json({ limit: '2mb' }));
    app.post('/api/admin/echo', (req, res) => res.json({ size: JSON.stringify(req.body).length }));
    app.post('/api/other/echo', (req, res) => res.json({ size: JSON.stringify(req.body).length }));
  }, 120000);

  afterAll(async () => { if (cleanup) await cleanup(); });

  const post = (url) => request(app).post(url).set('Content-Type', 'application/json');

  it('limits anonymous and out-of-scope requests while preserving small JSON', async () => {
    expect((await post('/api/admin/echo').send(bigBody)).status).toBe(413);
    expect((await post('/api/other/echo').send(bigBody)).status).toBe(413);
    const small = await post('/api/admin/echo').send(smallBody);
    expect(small.status).toBe(200);
    expect(small.body.size).toBe(smallBody.length);
  });

  it('accepts a valid admin JWT in the header or admin cookie', async () => {
    const token = mintAdminToken(adminId);
    const header = await post('/api/admin/echo').set('Authorization', `Bearer ${token}`).send(bigBody);
    expect(header.status).toBe(200);
    expect(header.body.size).toBe(bigBody.length);
    const cookie = await post('/api/admin/echo').set('Cookie', `admin_token=${token}`).send(bigBody);
    expect(cookie.status).toBe(200);
  });

  it('does not trust forged or non-admin JWTs', async () => {
    const forged = jwt.sign({ id: adminId, type: 'admin' }, 'wrong-secret', { issuer: 'picpeak-auth' });
    expect((await post('/api/admin/echo').set('Authorization', `Bearer ${forged}`).send(bigBody)).status).toBe(413);
    const gallery = jwt.sign({ id: 1, type: 'gallery' }, process.env.JWT_SECRET, { issuer: 'picpeak-auth' });
    expect((await post('/api/admin/echo').set('Authorization', `Bearer ${gallery}`).send(bigBody)).status).toBe(413);
  });

  it('uses the inflated body size for compressed JSON', async () => {
    const gz = zlib.gzipSync(Buffer.from(bigBody));
    expect(gz.length).toBeLessThan(64 * 1024);
    const token = mintAdminToken(adminId);
    const raw = (req) => req.serialize((data) => data);
    const allowed = await raw(post('/api/admin/echo').set('Authorization', `Bearer ${token}`)
      .set('Content-Encoding', 'gzip')).send(gz);
    expect(allowed.status).toBe(200);
    expect(allowed.body.size).toBe(bigBody.length);
    const refused = await raw(post('/api/admin/echo').set('Content-Encoding', 'gzip')).send(gz);
    expect(refused.status).toBe(413);
  });
});
