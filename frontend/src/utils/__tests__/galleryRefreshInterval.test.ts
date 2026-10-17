import { describe, expect, it } from 'vitest';
import { galleryRefreshInterval } from '../galleryRefreshInterval';

describe('galleryRefreshInterval', () => {
  it('keeps small galleries quick and scales polling with actual gallery size', () => {
    expect(galleryRefreshInterval(0)).toBe(5_000);
    expect(galleryRefreshInterval(50)).toBe(6_000);
    expect(galleryRefreshInterval(342)).toBe(12_000);
  });

  it('caps polling and treats invalid counts safely', () => {
    expect(galleryRefreshInterval(10_000)).toBe(30_000);
    expect(galleryRefreshInterval(Number.NaN)).toBe(5_000);
  });
});
