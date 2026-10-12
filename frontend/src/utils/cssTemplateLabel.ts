type Translate = (key: string) => string;

const BUILT_IN_TEMPLATE_KEYS: Record<string, string> = {
  'elegant dark': 'cssTemplates.presetNames.elegantDark',
  'apple liquid glass': 'cssTemplates.presetNames.appleLiquidGlass',
  'liquid glass dark': 'cssTemplates.presetNames.liquidGlassDark',
};

/** Translate known bundled templates without changing their persisted names. */
export function cssTemplateLabel(name: string, t: Translate): string {
  const key = BUILT_IN_TEMPLATE_KEYS[name.trim().toLowerCase()];
  return key ? t(key) : name;
}
