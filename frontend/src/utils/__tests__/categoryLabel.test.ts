import { describe, expect, it } from 'vitest';
import { categoryDeleteConfirmation, categoryLabel } from '../categoryLabel';

describe('categoryLabel', () => {
  it('uses translated labels for seeded category slugs', () => {
    expect(categoryLabel({ name: 'Ceremony', slug: 'ceremony' }, (key) => key)).toBe('categories.defaults.ceremony');
  });

  it('preserves photographer-created category names', () => {
    expect(categoryLabel({ name: '客户特别要求', slug: 'custom-folder' }, (key) => key)).toBe('客户特别要求');
  });

  it('does not translate a custom category just because its slug matches a default', () => {
    expect(categoryLabel({ name: 'ACC136重复标识复测', slug: 'details', is_global: false }, (key) => key))
      .toBe('ACC136重复标识复测');
    expect(categoryLabel({ name: '客户细节备注', slug: 'details' }, (key) => key))
      .toBe('客户细节备注');
    expect(categoryLabel({ name: 'Details', slug: 'details', is_global: false }, (key) => key))
      .toBe('Details');
  });

  it('translates legacy default photo type labels without slugs', () => {
    for (const [name, key] of [
      ['Ceremony', 'ceremony'],
      ['Details', 'details'],
      ['Group Photos', 'groupPhotos'],
      ['Party', 'party'],
      ['Portraits', 'portraits'],
      ['Reception', 'reception'],
    ]) {
      expect(categoryLabel({ name }, (value) => value)).toBe(`categories.defaults.${key}`);
    }
    expect(categoryLabel({ name: 'Individual Photos' }, (key) => key)).toBe('categories.defaults.individualPhotos');
    expect(categoryLabel({ name: 'Collages' }, (key) => key)).toBe('categories.defaults.collages');
  });

  it('names the exact custom category and its scope in delete confirmation', () => {
    const translate = (key: string, options?: Record<string, unknown>) => `${key}:${options?.name || ''}`;
    expect(categoryDeleteConfirmation({ name: 'ACC136重复标识复测', slug: 'details', is_global: false }, translate))
      .toBe('categories.deleteEventConfirm:ACC136重复标识复测');
    expect(categoryDeleteConfirmation({ name: 'Details', slug: 'details', is_global: true }, translate))
      .toBe('categories.deleteGlobalConfirm:categories.defaults.details:');
  });
});
