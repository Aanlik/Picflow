type Translate = (key: string, options?: Record<string, unknown>) => string;
type Category = { name?: string | null; slug?: string | null; is_global?: boolean };

const BUILT_IN_CATEGORY_KEYS: Record<string, string> = {
  uncategorized: 'categories.defaults.uncategorized',
  ceremony: 'categories.defaults.ceremony',
  reception: 'categories.defaults.reception',
  portraits: 'categories.defaults.portraits',
  'group-photos': 'categories.defaults.groupPhotos',
  details: 'categories.defaults.details',
  party: 'categories.defaults.party',
  'individual-photos': 'categories.defaults.individualPhotos',
  collages: 'categories.defaults.collages',
};

const BUILT_IN_CATEGORY_NAMES: Record<string, string> = {
  uncategorized: 'categories.defaults.uncategorized',
  ceremony: 'categories.defaults.ceremony',
  reception: 'categories.defaults.reception',
  portraits: 'categories.defaults.portraits',
  'group photos': 'categories.defaults.groupPhotos',
  details: 'categories.defaults.details',
  party: 'categories.defaults.party',
  'individual photos': 'categories.defaults.individualPhotos',
  collages: 'categories.defaults.collages',
};

const BUILT_IN_CATEGORY_DEFAULT_NAMES: Record<string, string> = {
  uncategorized: 'uncategorized',
  ceremony: 'ceremony',
  reception: 'reception',
  portraits: 'portraits',
  'group-photos': 'group photos',
  details: 'details',
  party: 'party',
  'individual-photos': 'individual photos',
  collages: 'collages',
};

/** Translate seeded categories by stable slug while preserving custom names. */
export function categoryLabel(
  category: Category,
  t: Translate,
): string {
  const slug = category.slug?.toLowerCase();
  const defaultName = slug ? BUILT_IN_CATEGORY_DEFAULT_NAMES[slug] : undefined;
  const name = category.name?.trim().toLowerCase();
  // A custom project category may legally reuse a seeded category's slug.
  // Translate only when the persisted name is still the actual built-in label;
  // otherwise a user-provided title such as "ACC136..." must remain intact.
  const slugKey = defaultName && name === defaultName && category.is_global !== false && slug
    ? BUILT_IN_CATEGORY_KEYS[slug]
    : undefined;
  const key = slugKey
    || (category.is_global === false
      ? undefined
      : (category.name ? BUILT_IN_CATEGORY_NAMES[category.name.trim().toLowerCase()] : undefined));
  return key ? t(key) : (category.name || '');
}

/** Name the category scope and persisted title in destructive confirmations. */
export function categoryDeleteConfirmation(category: Category, t: Translate): string {
  if (category.is_global) {
    return t('categories.deleteGlobalConfirm', { name: categoryLabel(category, t) });
  }
  return t('categories.deleteEventConfirm', { name: category.name || categoryLabel(category, t) });
}
