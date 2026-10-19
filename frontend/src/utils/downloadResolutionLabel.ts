type Translate = (key: string) => string;

const BUILT_IN_SIZE_KEYS: Record<string, string> = {
  original: 'settings.downloads.original',
  large: 'settings.downloads.size.large',
  medium: 'settings.downloads.size.medium',
  small: 'settings.downloads.size.small',
  custom: 'settings.downloads.size.custom',
};

/** Translate the bundled size labels while preserving custom photographer labels. */
export function downloadResolutionLabel(label: string, t: Translate): string {
  const key = BUILT_IN_SIZE_KEYS[label.trim().toLowerCase()];
  return key ? t(key) : label;
}
