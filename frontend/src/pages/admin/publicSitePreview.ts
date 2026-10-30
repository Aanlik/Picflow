export interface PublicSitePreviewColors {
  primary: string;
  accent: string;
  background: string;
  text: string;
  surface: string;
  elevated: string;
  border: string;
  mutedText: string;
}

const DEFAULT_COLORS: PublicSitePreviewColors = {
  primary: '#2563eb',
  accent: '#7c3aed',
  background: '#ffffff',
  text: '#171717',
  surface: '#ffffff',
  elevated: '#f5f5f5',
  border: '#e5e5e5',
  mutedText: '#737373',
};

/**
 * Older public-site settings can contain a branding object without a color
 * palette. Keep the preview renderable while preserving every supplied color.
 */
export function resolvePublicSitePreviewColors(value: unknown): PublicSitePreviewColors {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_COLORS };

  const branding = value as { colors?: unknown };
  const colors = branding.colors && typeof branding.colors === 'object' && !Array.isArray(branding.colors)
    ? branding.colors as Record<string, unknown>
    : {};

  return Object.fromEntries(
    Object.entries(DEFAULT_COLORS).map(([key, fallback]) => {
      const color = colors[key];
      return [key, typeof color === 'string' && color.trim() ? color : fallback];
    }),
  ) as PublicSitePreviewColors;
}
