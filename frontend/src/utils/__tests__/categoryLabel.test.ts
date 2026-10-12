import { describe, expect, it } from 'vitest';
import { categoryLabel } from '../categoryLabel';

describe('categoryLabel', () => {
  it('uses translated labels for seeded category slugs', () => {
    expect(categoryLabel({ name: 'Ceremony', slug: 'ceremony' }, (key) => key)).toBe('categories.defaults.ceremony');
  });

  it('preserves photographer-created category names', () => {
    expect(categoryLabel({ name: '客户特别要求', slug: 'custom-folder' }, (key) => key)).toBe('客户特别要求');
  });

  it('translates legacy default photo type labels without slugs', () => {
    expect(categoryLabel({ name: 'Individual Photos' }, (key) => key)).toBe('categories.defaults.individualPhotos');
    expect(categoryLabel({ name: 'Collages' }, (key) => key)).toBe('categories.defaults.collages');
  });
});
