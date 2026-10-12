const fs = require('fs').promises;
const os = require('os');
const path = require('path');

jest.mock('../../src/database/db', () => {
  let event = null;
  const db = (table) => ({
    where() { return this; },
    count() { return this; },
    async first() { return table === 'events' ? event : { count: '0' }; },
  });
  return { db, __setEvent: (value) => { event = value; } };
});

jest.mock('../../src/services/photoCap', () => {
  let inserted = null;
  return {
    countEventPhotos: jest.fn(async () => 0),
    insertPhotoWithinCap: jest.fn(async (row) => { inserted = row; return [{ id: 42 }]; }),
    photoCapError: jest.fn(() => ({ error: 'cap reached' })),
    __inserted: () => inserted,
  };
});

jest.mock('../../src/services/storage', () => {
  const storage = {
    putFromFile: jest.fn(async () => {}),
    stat: jest.fn(async (_key, localPath) => ({ size: 12 })),
  };
  return { getStorage: () => storage, __storage: storage };
});

jest.mock('../../src/services/imageProcessor', () => ({}));
jest.mock('../../src/services/videoProcessor', () => ({ isVideoMimeType: (mime) => mime.startsWith('video/') }));
jest.mock('../../src/utils/filenameSanitizer', () => ({ generatePhotoFilename: () => 'stored-phone.jpg' }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

describe('queueFilesForProcessing upload provenance', () => {
  it('records guest uploads with their stable original filename and managed source', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'picpeak-guest-upload-'));
    const filePath = path.join(tempDir, 'phone-original.jpg');
    await fs.writeFile(filePath, Buffer.alloc(12, 1));
    require('../../src/database/db').__setEvent({ id: 7, slug: 'gallery', event_name: 'Gallery' });
    const { queueFilesForProcessing } = require('../../src/services/photoProcessor');

    try {
      const result = await queueFilesForProcessing([{
        path: filePath,
        originalname: 'Phone Original.jpg',
        mimetype: 'image/jpeg',
        size: 12,
      }], { eventId: 7, uploadedBy: 'guest' });

      expect(result.photos).toEqual([expect.objectContaining({ id: 42 })]);
      expect(require('../../src/services/photoCap').__inserted()).toEqual(expect.objectContaining({
        source_filename: 'Phone Original.jpg',
        original_filename: 'Phone Original.jpg',
        uploaded_by: 'guest',
        source_origin: 'managed',
        media_type: 'image',
      }));
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
