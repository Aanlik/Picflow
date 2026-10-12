import { describe, expect, it } from 'vitest';
import { photoDisplayFilename, photoMatchesFilenameSearch } from '../photoFilename';

describe('photo display filename', () => {
  it('uses the source camera stem and final image extension for Bridge deliveries', () => {
    const photo = {
      filename: 'opaque-id.jpg',
      original_filename: `2026-10-12_individual_DSC04270.__bridge_${'a'.repeat(64)}.jpg`,
      source_filename: 'DSC04270.ARW',
    };
    expect(photoDisplayFilename(photo)).toBe('DSC04270.jpg');
  });

  it('keeps source filename searchable when the stored name is generated', () => {
    expect(photoMatchesFilenameSearch({
      filename: 'opaque-id.jpg',
      original_filename: 'generated.jpg',
      source_filename: 'DSC04270.ARW',
    }, 'dsc04270')).toBe(true);
  });
});
