const fs = require('fs');
const os = require('os');
const path = require('path');
const mockEvents = [];
const mockStorage = { delete: jest.fn(async key => mockEvents.push(`delete:${key}`)), putFromFile: jest.fn(async () => mockEvents.push('put')) };
const mockUpdate = jest.fn(async () => { mockEvents.push('commit'); return 1; });
jest.mock('../../src/database/db', () => ({ db: jest.fn(() => ({ where: jest.fn().mockReturnThis(), update: mockUpdate, first: jest.fn(async () => ({ id: 7 })) })) }));
jest.mock('../../src/services/storage', () => ({ getStorage: () => mockStorage }));
jest.mock('sharp', () => jest.fn(() => ({ metadata: async () => ({ width: 10, height: 10 }), stats: async () => ({}) })));
jest.mock('../../src/services/imageProcessor', () => ({
  generateThumbnail: jest.fn(async () => 'new-thumb'), extractCaptureDate: jest.fn(async () => null),
  withProcessableImage: jest.fn(async p => ({ path: p, cleanup: async () => {} })),
  orientedDimensions: () => ({ width: 10, height: 10 }), deleteThumbnailTiers: jest.fn(async () => {}), deletePreviewTiers: jest.fn(async () => {}),
}));
jest.mock('../../src/utils/filenameSanitizer', () => ({ generatePhotoFilename: () => 'new.jpg' }));
jest.mock('../../src/services/photoResolver', () => ({ resolvePhotoStorageKey: () => 'old-original' }));
jest.mock('../../src/services/watermarkGeneratorService', () => ({ deleteForPhoto: jest.fn(async () => {}) }));
const { replacePhoto } = require('../../src/services/photoReplacementService');
let directory;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'replace-atomic-')); mockEvents.length = 0; jest.clearAllMocks(); });
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
const run = () => { const file = path.join(directory, 'new.jpg'); fs.writeFileSync(file, 'new'); return replacePhoto({ id: 1, filename: 'old.jpg', event_id: 7, thumbnail_path: 'old-thumb', preview_path: 'old-preview' }, file, { originalFilename: 'DSC.JPG', mimeType: 'image/jpeg', event: { event_name: 'Project', slug: 'project' } }); };
test('storage failure preserves the old original and derivatives', async () => {
  mockStorage.putFromFile.mockRejectedValueOnce(new Error('disk full'));
  expect((await run()).success).toBe(false);
  expect(mockStorage.delete).not.toHaveBeenCalledWith('old-original');
  expect(mockStorage.delete).not.toHaveBeenCalledWith('old-preview');
  expect(mockStorage.delete).not.toHaveBeenCalledWith('old-thumb');
  expect(mockUpdate).not.toHaveBeenCalled();
});
test('database failure reclaims only the new object', async () => {
  mockUpdate.mockRejectedValueOnce(new Error('database unavailable'));
  expect((await run()).success).toBe(false);
  expect(mockStorage.delete).toHaveBeenCalledWith('events/active/project/individual/new.jpg');
  expect(mockStorage.delete).not.toHaveBeenCalledWith('old-original');
});
test('successful commit precedes old original deletion', async () => {
  expect((await run()).success).toBe(true);
  expect(mockUpdate.mock.calls[0][0]).toMatchObject({ preview_path: null });
  expect(mockEvents.indexOf('put')).toBeLessThan(mockEvents.indexOf('commit'));
  expect(mockEvents.indexOf('commit')).toBeLessThan(mockEvents.indexOf('delete:old-original'));
  expect(mockEvents.indexOf('commit')).toBeLessThan(mockEvents.indexOf('delete:old-preview'));
});
test('a concurrent photo change preserves old bytes', async () => {
  mockUpdate.mockResolvedValueOnce(0);
  expect((await run()).success).toBe(false);
  expect(mockStorage.delete).not.toHaveBeenCalledWith('old-original');
});

test('corrupt replacement is rejected before storing or changing the proof', async () => {
  require('sharp').mockImplementationOnce(jest.requireActual('sharp'));
  expect(await run()).toMatchObject({ success: false, code: 'INVALID_IMAGE_CONTENT' });
  expect(mockStorage.putFromFile).not.toHaveBeenCalled();
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockStorage.delete).not.toHaveBeenCalled();
});
