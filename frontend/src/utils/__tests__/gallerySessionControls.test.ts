import { describe, expect, it } from 'vitest';
import { shouldShowGalleryLogoutControl } from '../gallerySessionControls';

describe('gallery logout control session boundary', () => {
  it('never exposes customer logout in an admin preview, even if a client session exists', () => {
    expect(shouldShowGalleryLogoutControl(false, true, true)).toBe(false);
    expect(shouldShowGalleryLogoutControl(true, true, true)).toBe(false);
  });

  it('keeps logout available to customer sessions that have credentials to clear', () => {
    expect(shouldShowGalleryLogoutControl(true, false, false)).toBe(true);
    expect(shouldShowGalleryLogoutControl(false, true, false)).toBe(true);
    expect(shouldShowGalleryLogoutControl(false, false, false)).toBe(false);
  });
});
