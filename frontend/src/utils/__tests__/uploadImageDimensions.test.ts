import { afterEach, describe, expect, it, vi } from 'vitest';
import { meetsMinimumUploadImageDimensions } from '../uploadImageDimensions';

describe('meetsMinimumUploadImageDimensions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('skips non-image files', async () => {
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    expect(await meetsMinimumUploadImageDimensions(file)).toBe(true);
  });

  it('matches the server minimum for decoded images', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1, height: 1, close }));
    const file = new File(['image'], 'tiny.png', { type: 'image/png' });
    expect(await meetsMinimumUploadImageDimensions(file)).toBe(false);
    expect(close).toHaveBeenCalledOnce();
  });

  it('accepts images that meet the minimum and lets the server handle decode errors', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn()
      .mockResolvedValueOnce({ width: 10, height: 12, close: vi.fn() })
      .mockRejectedValueOnce(new Error('unsupported browser decoder')));
    expect(await meetsMinimumUploadImageDimensions(new File(['a'], 'ok.png', { type: 'image/png' }))).toBe(true);
    expect(await meetsMinimumUploadImageDimensions(new File(['b'], 'unknown.png', { type: 'image/png' }))).toBe(true);
  });
});
