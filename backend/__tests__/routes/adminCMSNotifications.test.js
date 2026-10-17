const express = require('express');
const request = require('supertest');

jest.mock('../../src/database/db', () => ({ db: jest.fn(), logActivity: jest.fn() }));
jest.mock('../../src/middleware/auth', () => ({ adminAuth: (req, _res, next) => { req.admin = { id: 7, username: 'admin' }; next(); } }));
jest.mock('../../src/middleware/permissions', () => ({ requirePermission: () => (_req, _res, next) => next() }));

const { db, logActivity } = require('../../src/database/db');
const router = require('../../src/routes/adminCMS');

describe('CMS save notifications', () => {
  let app;
  let page;
  let update;

  beforeEach(() => {
    page = { slug: 'gallery-not-found', title_en: 'Gallery Not Found', title_zh: '相册未找到' };
    update = jest.fn().mockImplementation(async (fields) => { Object.assign(page, fields); return 1; });
    const query = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockImplementation(async () => page),
      update,
    };
    db.mockReturnValue(query);
    logActivity.mockResolvedValue(undefined);
    app = express();
    app.use(express.json());
    app.use('/api/admin/cms', router);
  });

  afterEach(() => jest.clearAllMocks());

  it('records page titles only after the CMS update succeeds', async () => {
    const response = await request(app).put('/api/admin/cms/pages/gallery-not-found').send({
      title_en: 'Not Found', title_zh: '页面未找到', content_en: '<p>Contact us</p>', content_zh: '<p>请联系我们</p>',
    });
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith('cms_page_updated', {
      slug: 'gallery-not-found', pageNameEn: 'Not Found', pageNameZh: '页面未找到',
    }, null, { type: 'admin', id: 7, name: 'admin' });
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(logActivity.mock.invocationCallOrder[0]);
  });

  it('does not create a success notification when the database write fails', async () => {
    update.mockRejectedValueOnce(new Error('write failed'));
    const response = await request(app).put('/api/admin/cms/pages/gallery-not-found').send({
      title_en: 'Not Found', title_zh: '页面未找到', content_en: '<p>Contact us</p>', content_zh: '<p>请联系我们</p>',
    });
    expect(response.status).toBe(500);
    expect(logActivity).not.toHaveBeenCalled();
  });
});
