import { describe, expect, it } from 'vitest';
import { toLocalISODate } from '../localDate';

describe('toLocalISODate', () => {
  it('formats the local calendar day without shifting it through UTC', () => {
    expect(toLocalISODate(new Date(2026, 9, 13, 0, 30))).toBe('2026-10-13');
  });
});
