import { describe, expect, it } from 'vitest';
import { resolvePublicSitePreviewColors } from '../publicSitePreview';

describe('public site preview branding', () => {
  it('supplies the default palette when legacy branding omits colors', () => {
    expect(resolvePublicSitePreviewColors({ companyName: 'Picflow' })).toEqual({
      primary: '#2563eb',
      accent: '#7c3aed',
      background: '#ffffff',
      text: '#171717',
      surface: '#ffffff',
      elevated: '#f5f5f5',
      border: '#e5e5e5',
      mutedText: '#737373',
    });
  });

  it('keeps supplied colors and falls back only for missing or malformed entries', () => {
    expect(resolvePublicSitePreviewColors({ colors: { primary: '#123456', surface: null, accent: '' } })).toMatchObject({
      primary: '#123456',
      accent: '#7c3aed',
      surface: '#ffffff',
      background: '#ffffff',
    });
  });

  it.each([null, undefined, 'legacy-value', []])('handles malformed branding value %p', (value) => {
    expect(resolvePublicSitePreviewColors(value).primary).toBe('#2563eb');
  });
});
