import { afterEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../config/api', () => ({ api: { get, getUri: vi.fn() } }));

import { galleryService } from '../gallery.service';

describe('galleryService.downloadPhoto', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    get.mockReset();
  });

  it('uses the Axios-authenticated route and the server filename', async () => {
    const blob = new Blob(['photo bytes'], { type: 'image/jpeg' });
    get.mockResolvedValue({
      data: blob,
      headers: { 'content-disposition': "attachment; filename*=UTF-8''DSC04603.jpg" },
    });
    const trigger = vi.spyOn(galleryService, 'triggerBrowserDownload').mockImplementation(() => undefined);

    await galleryService.downloadPhoto('demo', 42, 'fallback.jpg');

    expect(get).toHaveBeenCalledWith('/gallery/demo/download/42', { responseType: 'blob' });
    expect(trigger).toHaveBeenCalledWith(blob, 'DSC04603.jpg');
  });

  it('falls back only when the original download is missing', async () => {
    get.mockRejectedValueOnce({ response: { status: 404 } }).mockResolvedValueOnce({
      data: new Blob(['preview'], { type: 'image/jpeg' }),
      headers: {},
    });
    const trigger = vi.spyOn(galleryService, 'triggerBrowserDownload').mockImplementation(() => undefined);

    await galleryService.downloadPhoto('demo', 42, 'fallback.jpg');

    expect(get).toHaveBeenNthCalledWith(1, '/gallery/demo/download/42', { responseType: 'blob' });
    expect(get).toHaveBeenNthCalledWith(2, '/gallery/demo/photo/42', { responseType: 'blob' });
    expect(trigger).toHaveBeenCalledWith(expect.any(Blob), 'fallback.jpg');
  });
});
