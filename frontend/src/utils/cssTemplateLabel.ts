type Translate = (key: string) => string;

const BUILT_IN_TEMPLATE_KEYS: Record<string, string> = {
  'elegant dark': 'cssTemplates.presetNames.elegantDark',
  '优雅暗色': 'cssTemplates.presetNames.elegantDark',
  'apple liquid glass': 'cssTemplates.presetNames.appleLiquidGlass',
  '苹果液态玻璃': 'cssTemplates.presetNames.appleLiquidGlass',
  'liquid glass dark': 'cssTemplates.presetNames.liquidGlassDark',
  '液态玻璃深色': 'cssTemplates.presetNames.liquidGlassDark',
};

/** Keep bundled presets localized across legacy and normalized database names. */
export function cssTemplateLabel(name: string, t: Translate): string {
  const key = BUILT_IN_TEMPLATE_KEYS[name.trim().toLowerCase()];
  return key ? t(key) : name;
}
