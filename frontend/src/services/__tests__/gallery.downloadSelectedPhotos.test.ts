import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/api', () => ({ api: { post: vi.fn(), get: vi.fn() } }));

let galleryService: typeof import('../gallery.service').galleryService;
let apiMock: { post: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };

describe('galleryService.downloadSelectedPhotos', () => {
  beforeEach(async () => {
    vi.resetModules();
    const services = await import('../gallery.service');
    galleryService = services.galleryService;
    apiMock = (await import('../../config/api')).api as any;
    apiMock.post.mockReset();
    apiMock.get.mockReset();
    vi.spyOn(galleryService, 'triggerBrowserDownload').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('queues one authenticated download action per selected photo without making a ZIP request', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    await galleryService.downloadSelectedPhotos('wedding-2026', [11, 22, 11, 33]);

    expect(galleryService.triggerBrowserDownload).not.toHaveBeenCalled();
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('picflow:download-queue');
    expect(event.detail).toEqual([
      { slug: 'wedding-2026', photoId: 11 },
      { slug: 'wedding-2026', photoId: 22 },
      { slug: 'wedding-2026', photoId: 33 },
    ]);
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('keeps the chosen rendition on each queued authenticated download', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    await galleryService.downloadSelectedPhotos('wedding-2026', [11, 22], 'web');

    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual([
      { slug: 'wedding-2026', photoId: 11, resolution: 'web' },
      { slug: 'wedding-2026', photoId: 22, resolution: 'web' },
    ]);
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('does nothing for an empty selection', async () => {
    await galleryService.downloadSelectedPhotos('wedding-2026', []);

    expect(galleryService.triggerBrowserDownload).not.toHaveBeenCalled();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('uses the authenticated blob path for a single selected photo', async () => {
    const blob = new Blob(['photo'], { type: 'image/jpeg' });
    apiMock.get.mockResolvedValueOnce({
      data: blob,
      headers: { 'content-disposition': 'attachment; filename="DSC00125.JPG"' },
    });
    const trigger = vi.spyOn(galleryService, 'triggerBrowserDownload').mockImplementation(() => {});

    await galleryService.downloadSelectedPhotos('wedding-2026', [11], 'web');

    expect(apiMock.get).toHaveBeenCalledWith('/gallery/wedding-2026/download/11', {
      responseType: 'blob', params: { resolution: 'web' },
    });
    expect(trigger).toHaveBeenCalledWith(blob, 'DSC00125.JPG');
  });
});
