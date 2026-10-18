/**
 * Regression coverage for issue #554.
 *
 * `savePhotoToDevice` originally (PR #531) routed through navigator.share
 * whenever `canShare({files})` returned true, on the assumption that any
 * mobile share sheet would expose a "Save Image" action. That's only true
 * on iOS — Android's share sheet only lists installed apps that handle
 * image/* intents, so the user gets an app-picker instead of a save
 * dialog. These tests pin the iOS-only gating: iOS goes through Web Share,
 * everywhere else falls through to <a download>.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15';
const IPADOS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';

// Stub the photo blob fetch + the download trigger so the test
// exercises the iOS-vs-other branching logic. fetchPhotoBlob is
// network; triggerBrowserDownload calls document.createElement + click
// which is side-effecty in jsdom (and not what we're testing here).
const fetchedBlob = { blob: new Blob(['x'], { type: 'image/jpeg' }), serverFilename: 'IMG_0001.jpg' };

let galleryService: typeof import('../gallery.service').galleryService;

const installNavigator = (overrides: Partial<{
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  share: ReturnType<typeof vi.fn>;
  canShare: ReturnType<typeof vi.fn>;
}>) => {
  const desc = (value: any) => ({ value, configurable: true, writable: true });
  Object.defineProperties(navigator, {
    userAgent: desc(overrides.userAgent ?? ''),
    platform: desc(overrides.platform ?? ''),
    maxTouchPoints: desc(overrides.maxTouchPoints ?? 0),
  });
  // share / canShare don't exist on jsdom's navigator by default, so
  // they're plain assignments rather than defineProperty.
  (navigator as any).share = overrides.share;
  (navigator as any).canShare = overrides.canShare;
};

describe('galleryService.savePhotoToDevice — iOS gating (#554)', () => {
  beforeEach(async () => {
    vi.resetModules();
    galleryService = (await import('../gallery.service')).galleryService;

    vi.spyOn(galleryService, 'fetchPhotoBlob').mockResolvedValue(fetchedBlob as any);
    vi.spyOn(galleryService, 'triggerBrowserDownload').mockImplementation(() => undefined);
    vi.spyOn(galleryService, 'triggerDirectDownload').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (navigator as any).share;
    delete (navigator as any).canShare;
  });

  it('routes through navigator.share on iOS when canShare({files}) is true', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    installNavigator({ userAgent: IOS_UA, share, canShare });

    await galleryService.savePhotoToDevice('slug', 1, 'fallback.jpg');

    expect(share).toHaveBeenCalledTimes(1);
    expect(canShare).toHaveBeenCalledWith({ files: expect.any(Array) });
    expect(galleryService.triggerBrowserDownload).not.toHaveBeenCalled();
    expect(galleryService.triggerDirectDownload).not.toHaveBeenCalled();
  });

  it('uses the authenticated fetch and browser download on Android', async () => {
    // A native anchor cannot carry the gallery bearer token injected by Axios.
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    installNavigator({ userAgent: ANDROID_UA, share, canShare });

    await galleryService.savePhotoToDevice('slug', 1, 'fallback.jpg');

    expect(share).not.toHaveBeenCalled();
    expect(galleryService.fetchPhotoBlob).toHaveBeenCalledWith('slug', 1, undefined);
    expect(galleryService.triggerBrowserDownload).toHaveBeenCalledWith(fetchedBlob.blob, 'IMG_0001.jpg');
    expect(galleryService.triggerDirectDownload).not.toHaveBeenCalled();
  });

  it('uses the authenticated fetch and browser download on desktop Safari', async () => {
    installNavigator({ userAgent: DESKTOP_UA });

    await galleryService.savePhotoToDevice('slug', 1, 'fallback.jpg');

    expect(galleryService.fetchPhotoBlob).toHaveBeenCalledWith('slug', 1, undefined);
    expect(galleryService.triggerBrowserDownload).toHaveBeenCalledWith(fetchedBlob.blob, 'IMG_0001.jpg');
    expect(galleryService.triggerDirectDownload).not.toHaveBeenCalled();
  });

  it('detects iPadOS 13+ (reports as MacIntel + touch) as iOS', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    installNavigator({
      userAgent: IPADOS_UA,
      platform: 'MacIntel',
      maxTouchPoints: 5,
      share,
      canShare,
    });

    await galleryService.savePhotoToDevice('slug', 1, 'fallback.jpg');

    expect(share).toHaveBeenCalledTimes(1);
    expect(galleryService.triggerBrowserDownload).not.toHaveBeenCalled();
    expect(galleryService.triggerDirectDownload).not.toHaveBeenCalled();
    expect(galleryService.fetchPhotoBlob).toHaveBeenCalledWith('slug', 1, undefined);
  });

  it('does NOT treat a regular Mac (MacIntel + no touch) as iOS', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    installNavigator({
      userAgent: DESKTOP_UA,
      platform: 'MacIntel',
      maxTouchPoints: 0,
      share,
      canShare,
    });

    await galleryService.savePhotoToDevice('slug', 1, 'fallback.jpg');

    expect(share).not.toHaveBeenCalled();
    expect(galleryService.fetchPhotoBlob).toHaveBeenCalledWith('slug', 1, undefined);
    expect(galleryService.triggerBrowserDownload).toHaveBeenCalledWith(fetchedBlob.blob, 'IMG_0001.jpg');
    expect(galleryService.triggerDirectDownload).not.toHaveBeenCalled();
  });

  it('does not fall back to download when the user dismisses the iOS share sheet (AbortError)', async () => {
    // AbortError signals a deliberate user dismissal; falling back to a
    // download would surprise them with a file landing in Downloads
    // anyway, defeating the dismissal.
    const abortErr = Object.assign(new Error('user cancelled'), { name: 'AbortError' });
    const share = vi.fn().mockRejectedValue(abortErr);
    const canShare = vi.fn().mockReturnValue(true);
    installNavigator({ userAgent: IOS_UA, share, canShare });

    await galleryService.savePhotoToDevice('slug', 1, 'fallback.jpg');

    expect(share).toHaveBeenCalledTimes(1);
    expect(galleryService.triggerBrowserDownload).not.toHaveBeenCalled();
  });

  it('does fall back to download when navigator.share() rejects with a non-Abort error', async () => {
    const otherErr = Object.assign(new Error('not allowed'), { name: 'NotAllowedError' });
    const share = vi.fn().mockRejectedValue(otherErr);
    const canShare = vi.fn().mockReturnValue(true);
    installNavigator({ userAgent: IOS_UA, share, canShare });

    await galleryService.savePhotoToDevice('slug', 1, 'fallback.jpg');

    expect(galleryService.triggerBrowserDownload).toHaveBeenCalledTimes(1);
  });
});
