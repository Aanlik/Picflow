jest.mock('../../src/database/db', () => ({
  db: () => ({
    where: () => ({
      first: async () => ({ setting_value: JSON.stringify({ format: 'yyyy-MM-dd', locale: 'en-CA' }) }),
    }),
  }),
}));
jest.mock('../../src/utils/logger', () => ({ warn: jest.fn(), error: jest.fn() }));

const { formatDate } = require('../../src/utils/dateFormatter');

describe('dateFormatter ISO format', () => {
  it('formats the lower-case date-fns ISO preference without a timezone shift', async () => {
    await expect(formatDate(new Date(2026, 2, 4, 12), 'zh-CN')).resolves.toBe('2026-03-04');
    await expect(formatDate('2026-03-04', 'en')).resolves.toBe('2026-03-04');
  });
});
