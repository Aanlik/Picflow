describe('download filename default', () => {
  let settingRow;
  let getUseOriginalFilenames;

  beforeEach(() => {
    jest.resetModules();
    settingRow = undefined;
    const first = jest.fn(async () => settingRow);
    const where = jest.fn(() => ({ first }));
    const db = jest.fn(() => ({ where }));
    jest.doMock('../../src/database/db', () => ({ db }));
    jest.doMock('../../src/utils/logger', () => ({ warn: jest.fn() }));
    ({ getUseOriginalFilenames } = require('../../src/services/downloadFilenameService'));
  });

  afterEach(() => jest.dontMock('../../src/database/db'));

  it('uses original camera filenames when the setting has not been configured', async () => {
    await expect(getUseOriginalFilenames()).resolves.toBe(true);
  });
});
