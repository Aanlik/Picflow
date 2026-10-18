import { beforeEach, describe, expect, it, vi } from 'vitest';

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
