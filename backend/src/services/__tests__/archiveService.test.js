const { filterDeliveredPhotoEntries, getArchivableDeliveredPhotoIds, archivePhotoDisplayName } = require('../archiveService');
const { buildContentDisposition } = require('../../utils/filenameSanitizer');

describe('Bridge project archive contents', () => {
  it('keeps only the managed photo rows marked as delivered', () => {
    const event = { slug: 'portrait', source_mode: 'managed' };
    const photos = [
      { id: 1, path: 'events/active/portrait/individual/proof.jpg' },
      { id: 2, path: 'events/active/portrait/individual/retouched.jpg' },
      { id: 3, path: 'events/active/portrait/individual/not-delivered.jpg' },
    ];
    const entries = photos.map((photo) => ({ key: photo.path }));

    expect(filterDeliveredPhotoEntries(event, photos, new Set([2]), entries))
      .toEqual([{ key: 'events/active/portrait/individual/retouched.jpg' }]);
  });

  it('leaves ordinary non-Bridge archives unchanged', () => {
    const entries = [{ key: 'events/active/portrait/individual/proof.jpg' }];
    expect(filterDeliveredPhotoEntries({}, [], null, entries)).toBe(entries);
  });

  it('archives only currently retained deliveries after a customer withdrawal', () => {
    expect(getArchivableDeliveredPhotoIds([
      { photo_id: 1, delivered: true, selection_cancelled: false },
      { photo_id: 2, delivered: true, selection_cancelled: true },
      { photo_id: 3, delivered: true, withdraw_pending: true },
      { photo_id: 4, delivered: false, selection_cancelled: false },
    ])).toEqual(new Set([1]));
  });

  it('uses the camera filename for Bridge exports and strips the private marker', () => {
    const photo = {
      filename: 'generated-file.jpg',
      original_filename: `2026-10-12_individual_DSC04270.__bridge_${'a'.repeat(64)}.jpg`,
      source_filename: 'DSC04270.ARW',
    };
    expect(archivePhotoDisplayName(photo, true)).toBe('DSC04270.jpg');
    expect(archivePhotoDisplayName(photo, false)).toBe('DSC04270.jpg');
  });

  it('keeps Unicode camera names and excludes internal Bridge hash suffixes', () => {
    const photo = {
      filename: 'generated-file.jpg',
      original_filename: `upload.__bridge_${'b'.repeat(64)}.jpg`,
      source_filename: '林晓雨.ARW',
    };
    const archiveName = archivePhotoDisplayName(photo, true);
    expect(archiveName).toBe('林晓雨.jpg');
    expect(archiveName).not.toContain('__bridge_');

    const header = buildContentDisposition('林晓雨项目.zip');
    expect(header).toContain("filename*=UTF-8''%E6%9E%97%E6%99%93%E9%9B%A8%E9%A1%B9%E7%9B%AE.zip");
  });
});
