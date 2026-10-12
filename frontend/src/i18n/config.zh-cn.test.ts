import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createElement } from 'react';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import { SUPPORTED_LANGUAGES } from '../components/common/LanguageSelector';
import { LanguageSelector } from '../components/common/LanguageSelector';

function flatten(value: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.entries(value).reduce<Record<string, string>>((result, [key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      Object.assign(result, flatten(child as Record<string, unknown>, path));
    } else if (typeof child === 'string') {
      result[path] = child;
    }
    return result;
  }, {});
}

describe('Simplified Chinese locale', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    localStorage.removeItem('picpeak-language');
    document.cookie = 'i18next=; Max-Age=0; path=/';
    vi.unstubAllEnvs();
  });

  it('loads the hyphenated locale with workflow terminology', async () => {
    const { default: i18n } = await import('./config');
    await i18n.changeLanguage('zh-CN');
    expect(i18n.hasResourceBundle('zh-CN', 'translation')).toBe(true);
    expect(i18n.t('feedback.colorLabels.green')).toBe('绿色');
    expect(i18n.t('feedback.colorLabelsTitle')).toBe('颜色标记');
    expect(i18n.t('feedback.setColorLabel', { color: i18n.t('feedback.colorLabels.green') })).toBe('选为绿色');
    expect(i18n.t('feedback.markedAs', { color: i18n.t('feedback.colorLabels.green') })).toBe('已选绿色');
    expect(i18n.t('feedback.settings.keybindColorsDesc')).toContain('快捷键只修改颜色标记');
    expect(i18n.t('gallery.photosSelected', { count: 50 })).toBe('已选择 50 张照片');
    expect(i18n.t('gallery.batchSelect')).toBe('批量选择');
  });

  it('uses the configured default instead of an old automatic English cache', async () => {
    vi.stubEnv('VITE_DEFAULT_LANGUAGE', 'zh-CN');
    localStorage.setItem('i18nextLng', 'en');
    const { default: first, i18nReady } = await import('./config');
    await i18nReady;
    expect(first.language).toBe('zh-CN');
  });

  it('preserves an explicit language choice across app restarts', async () => {
    vi.stubEnv('VITE_DEFAULT_LANGUAGE', 'zh-CN');
    localStorage.setItem('picpeak-language', 'en');
    const { default: first, i18nReady: firstReady } = await import('./config');
    await firstReady;
    expect(first.language).toBe('en');
    await first.changeLanguage('en');
    localStorage.setItem('picpeak-language', 'en');
    vi.resetModules();
    const { default: second, i18nReady: secondReady } = await import('./config');
    await secondReady;
    expect(second.language).toBe('en');
  });

  it('stores language selector choices separately from automatic browser detection', async () => {
    const { default: i18n, i18nReady } = await import('./config');
    await i18nReady;
    await i18n.changeLanguage('en');
    render(createElement(I18nextProvider, { i18n }, createElement(LanguageSelector)));
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    fireEvent.click(screen.getByRole('button', { name: '简体中文' }));
    expect(localStorage.getItem('picpeak-language')).toBe('zh-CN');
    await vi.waitFor(() => expect(i18n.resolvedLanguage).toBe('zh-CN'));
  });

  it('recognises a Chinese browser locale', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['zh-SG']);
    const { default: i18n, i18nReady } = await import('./config');
    await i18nReady;
    expect(i18n.language).toBe('zh-CN');
    vi.restoreAllMocks();
  });

  it('ships only English and Simplified Chinese bundles and falls back from retired locales', async () => {
    const { default: i18n, SUPPORTED_LOCALE_CODES, i18nReady } = await import('./config');
    await i18nReady;
    expect([...SUPPORTED_LOCALE_CODES].sort()).toEqual(['en', 'zh-CN']);
    expect(Object.keys(i18n.store.data).every((language) => SUPPORTED_LOCALE_CODES.includes(language as 'en' | 'zh-CN'))).toBe(true);
    expect(SUPPORTED_LANGUAGES.map(({ code }) => code)).toEqual(['zh-CN', 'en']);
    expect(i18n.hasResourceBundle('de', 'translation')).toBe(false);
    await i18n.changeLanguage('de-DE');
    expect(i18n.resolvedLanguage).toBe('en');
  });

  it('keeps English and Chinese keys, interpolation variables, and plural forms aligned', () => {
    const english = flatten(en);
    const chinese = flatten(zhCN);
    expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort());

    const variables = (value: string) => [...value.matchAll(/{{\s*([^}\s,]+)(?:,[^}]*)?\s*}}/g)]
      .map((match) => match[1])
      .sort();

    for (const key of Object.keys(english)) {
      expect(variables(chinese[key]), `${key} interpolation variables`).toEqual(variables(english[key]));
    }
  });

  it('has Chinese labels for every theme preset instead of falling back to English', async () => {
    const { default: i18n } = await import('./config');
    await i18n.changeLanguage('zh-CN');
    for (const [key, label] of Object.entries(en.events.themePresets)) {
      expect(i18n.t(`events.themePresets.${key}`)).not.toBe(label);
      expect(i18n.t(`events.themePresets.${key}`)).not.toBe(`events.themePresets.${key}`);
    }
    for (const [key, label] of Object.entries(en.events.themePresetDescriptions)) {
      expect(i18n.t(`events.themePresetDescriptions.${key}`)).not.toBe(label);
      expect(i18n.t(`events.themePresetDescriptions.${key}`)).not.toBe(`events.themePresetDescriptions.${key}`);
    }
  });

  it('uses the purple color name in translated labels', async () => {
    const { default: i18n } = await import('./config');
    await i18n.changeLanguage('zh-CN');
    expect(i18n.t('feedback.colorLabels.purple')).toBe('紫色');
    await i18n.changeLanguage('en');
    expect(i18n.t('feedback.colorLabels.purple')).toBe('Purple');
  });
});
