const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { validateUploadedFiles } = require('../../src/middleware/uploadValidation');

describe('upload validation error details', () => {
  let directory;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'picflow-upload-validation-'));
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('returns a specific code for images below the minimum dimensions', async () => {
    const filePath = path.join(directory, 'tiny.png');
    await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } })
      .png().toFile(filePath);
    const req = { files: [{ path: filePath, originalname: 'tiny.png' }] };
    const next = jest.fn();

    await validateUploadedFiles(req, {}, next);

    expect(req.files).toEqual([]);
    expect(req.invalidFiles).toEqual([expect.objectContaining({
      filename: 'tiny.png',
      code: 'IMAGE_TOO_SMALL',
      error: 'Image dimensions too small',
    })]);
    expect(next).toHaveBeenCalled();
  });
});
