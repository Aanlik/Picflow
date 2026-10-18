import { describe, expect, it } from 'vitest';
import { parsePublicSiteEnabled } from '../CMSPage';

describe('CMS public-site setting from SQLite', () => {
  it.each([
    [false, false],
    [0, false],
    ['0', false],
    ['false', false],
    [true, true],
    [1, true],
    ['1', true],
    ['true', true],
  ])('normalizes %j to %j', (value, expected) => {
    expect(parsePublicSiteEnabled(value)).toBe(expected);
  });
});
