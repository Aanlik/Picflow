import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/downloadBlob', () => ({ downloadBlob: vi.fn() }));
import { downloadBlob } from '../../utils/downloadBlob';
vi.mock('../../config/api', () => ({ api: { get: vi.fn() } }));
import { api } from '../../config/api';
import { transfersService } from '../transfers.service';

describe('transfers service response shape', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a non-array transfer list so the page can show its retry state instead of crashing', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: { transfers: { id: 1 } } } as never);

    await expect(transfersService.list()).rejects.toThrow('Invalid transfer list response');
  });

  it('normalizes optional legacy detail collections before the page renders them', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: { transfer: { id: 7, title: 'Test' } },
    } as never);

    await expect(transfersService.get(7)).resolves.toMatchObject({
      id: 7,
      files: [],
      extra_files: [],
      uploads: [],
    });
  });

  it('rejects a missing detail object as a recoverable query error', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: {} } as never);

    await expect(transfersService.get(7)).rejects.toThrow('Invalid transfer detail response');
  });
});

 describe('admin return-file download', () => {
  it('fetches through the authenticated client and downloads the returned bytes under the original name', async () => {
    const file = new Blob(['return-data']);
    vi.mocked(api.get).mockResolvedValueOnce({ data: file } as never);
    await transfersService.downloadUpload(8, 12, '客户回传.png');
    expect(api.get).toHaveBeenCalledWith('/admin/transfers/8/uploads/12/download', { responseType: 'blob' });
    expect(downloadBlob).toHaveBeenCalledWith(file, '客户回传.png');
  });
  it('does not report success when the authenticated download fails', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('blocked'));
    await expect(transfersService.downloadUpload(8, 12, 'test.png')).rejects.toThrow('blocked');
  });
});
