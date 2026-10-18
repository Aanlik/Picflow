const { flagEnabledFromValue } = require('../../src/middleware/requireFeatureFlag');

describe('feature flag value normalization', () => {
  it.each([true, 1, '1', 'true', 'TRUE', ' yes ', 'on'])(
    'treats %p as enabled consistently', (value) => {
      expect(flagEnabledFromValue(value)).toBe(true);
    },
  );

  it.each([false, 0, '0', 'false', 'FALSE', 'no', 'off', '', null, undefined, {}, []])(
    'treats %p as disabled consistently', (value) => {
      expect(flagEnabledFromValue(value)).toBe(false);
    },
  );
});
