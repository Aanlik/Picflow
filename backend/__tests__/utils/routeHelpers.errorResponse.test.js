const logger = require('../../src/utils/logger');
const { errorResponse } = require('../../src/utils/routeHelpers');

jest.mock('../../src/utils/logger', () => ({
  error: jest.fn(),
}));

describe('errorResponse request correlation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns and logs the request id without exposing the internal exception', () => {
    const error = new Error('database constraint details');
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const res = {
      req: { method: 'POST', originalUrl: '/api/admin/events?secret=redacted', id: 'req-abc123' },
      status,
    };

    errorResponse(res, error, 500, 'Failed to create event');

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Failed to create event', requestId: 'req-abc123' });
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ requestId: 'req-abc123' }));
    expect(JSON.stringify(json.mock.calls)).not.toContain('database constraint details');
  });

  it('does not add an undefined request id to older callers', () => {
    const json = jest.fn();
    const res = {
      req: { method: 'GET', originalUrl: '/api/admin/events' },
      status: () => ({ json }),
    };

    errorResponse(res, new Error('internal'), 500, 'Failed');
    expect(json).toHaveBeenCalledWith({ error: 'Failed' });
  });
});
