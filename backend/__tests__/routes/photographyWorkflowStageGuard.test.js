const express = require('express');
const request = require('supertest');

const mockDb = jest.fn();
const mockSetWorkflowStage = jest.fn();

jest.mock('../../src/database/db', () => ({ db: mockDb, logActivity: jest.fn() }));
jest.mock('../../src/middleware/auth', () => ({ adminAuth: (_req, _res, next) => next() }));
jest.mock('../../src/middleware/permissions', () => ({ requirePermission: () => (_req, _res, next) => next() }));
jest.mock('../../src/middleware/ownership', () => ({
  requireEventOwnership: (_req, _res, next) => next(),
  scopeEventsListQuery: (query) => query,
}));
jest.mock('../../src/services/photographyWorkflowBridge', () => ({
  bridgeRequest: jest.fn(),
  getProjectDetail: jest.fn(),
  setWorkflowStage: mockSetWorkflowStage,
}));

const router = require('../../src/routes/photographyWorkflow');

describe('photography workflow stage guard', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/admin/photography-workflow', router);
  });

  it.each([
    ['archived', { is_archived: 1, is_archiving: 0 }],
    ['currently archiving', { is_archived: 0, is_archiving: 1 }],
  ])('rejects stage changes for a project that is %s', async (_label, state) => {
    mockDb.mockReturnValue({ where: () => ({ first: async () => ({ id: 42, ...state }) }) });

    const response = await request(app)
      .post('/api/admin/photography-workflow/42/stage')
      .send({ stage: 'EDITING' });

    expect(response.status).toBe(409);
    expect(mockSetWorkflowStage).not.toHaveBeenCalled();
  });
  it('proxies confirmed repairs and preserves actionable conflict errors', async () => {
    const { bridgeRequest } = require('../../src/services/photographyWorkflowBridge');
    mockDb.mockReturnValue({ where: () => ({ first: async () => ({ id:42, is_archived:0, is_archiving:0 }) }) });
    bridgeRequest.mockResolvedValueOnce({status:409, data:{detail:'照片仍存在于Picflow，不能清理其索引'}});
    const response = await request(app).post('/api/admin/photography-workflow/42/photos/9/recovery')
      .send({action:'forget_missing',confirm:true});
    expect(response.status).toBe(409);
    expect(response.body.error).toContain('不能清理');
    expect(bridgeRequest).toHaveBeenCalledWith('/api/projects/42/photos/9/recovery', {
      method:'POST',body:{action:'forget_missing',confirm:true},
    });
  });
  it('rejects repair on archived projects before contacting Bridge', async () => {
    const { bridgeRequest } = require('../../src/services/photographyWorkflowBridge');
    mockDb.mockReturnValue({ where: () => ({ first: async () => ({id:42,is_archived:1}) }) });
    const response = await request(app).get('/api/admin/photography-workflow/42/photos/9/recovery');
    expect(response.status).toBe(409);
    expect(bridgeRequest).not.toHaveBeenCalled();
  });
});
