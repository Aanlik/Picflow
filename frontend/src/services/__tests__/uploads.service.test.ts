import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../config/api';
import { uploadsService } from '../uploads.service';

vi.mock('../../config/api', () => ({
  api: {
    get: vi.fn(),
    defaults: { baseURL: '/api' },
  },
}));

afterEach(() => vi.clearAllMocks());

describe('admin photo upload progress URLs', () => {
  it('polls the status route mounted under admin/photos', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { upload_id: 'batch-1' } });

    await uploadsService.getStatus('batch-1');

    expect(api.get).toHaveBeenCalledWith('/admin/photos/uploads/batch-1/status');
  });

  it('opens the matching event stream route', () => {
    expect(uploadsService.streamUrl('batch-1')).toBe('/api/admin/photos/uploads/batch-1/stream');
  });
});
