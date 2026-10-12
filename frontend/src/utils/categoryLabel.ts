type Translate = (key: string) => string;

const BUILT_IN_CATEGORY_KEYS: Record<string, string> = {
  ceremony: 'categories.defaults.ceremony',
  reception: 'categories.defaults.reception',
  portraits: 'categories.defaults.portraits',
  'group-photos': 'categories.defaults.groupPhotos',
  details: 'categories.defaults.details',
  party: 'categories.defaults.party',
};

/** Translate seeded categories by stable slug while preserving custom names. */
export function categoryLabel(
  category: { name?: string | null; slug?: string | null },
  t: Translate,
): string {
  const key = category.slug ? BUILT_IN_CATEGORY_KEYS[category.slug.toLowerCase()] : undefined;
  return key ? t(key) : (category.name || '');
}
