import { describe, expect, it } from 'vitest';
import { cssTemplateLabel } from '../cssTemplateLabel';

describe('cssTemplateLabel', () => {
  it('localizes bundled CSS presets and preserves custom template names', () => {
    expect(cssTemplateLabel('Apple Liquid Glass', (key) => key)).toBe('cssTemplates.presetNames.appleLiquidGlass');
    expect(cssTemplateLabel('优雅暗色', (key) => key)).toBe('cssTemplates.presetNames.elegantDark');
    expect(cssTemplateLabel('液态玻璃深色', (key) => key)).toBe('cssTemplates.presetNames.liquidGlassDark');
    expect(cssTemplateLabel('摄影师自定义', (key) => key)).toBe('摄影师自定义');
  });
});
