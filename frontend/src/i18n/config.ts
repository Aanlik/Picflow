import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

export const SUPPORTED_LOCALE_CODES = ['en', 'zh-CN'] as const;
const i18n = i18next.createInstance();

const localeFiles = import.meta.glob<Record<string, string>>('./locales/*.json', { import: 'default' });

// An optional build-time deployment default comes after the visitor's saved
// choice and before browser detection. It never overrides an explicit choice.
const detector = new LanguageDetector();
const normalizeSupportedLanguage = (language: string | undefined): 'en' | 'zh-CN' | undefined => {
  if (!language) return undefined;
  if (/^zh(?:-|$)/i.test(language)) return 'zh-CN';
  if (/^en(?:-|$)/i.test(language)) return 'en';
  return 'en';
};

// Keep the selected language out of the initial app bundle. The previous
// eager glob embedded both 3,000-key dictionaries in every first-page load,
// even though i18next only needs the visitor's language and its English
// fallback. This backend loads the small, supported locale chunks on demand.
const localeBackend = {
  type: 'backend' as const,
  init: () => {},
  read: (
    language: string,
    _namespace: string,
    callback: (error: Error | null, translations?: Record<string, string> | false) => void
  ) => {
    const locale = normalizeSupportedLanguage(language) || 'en';
    const loadLocale = localeFiles[`./locales/${locale}.json`];
    if (!loadLocale) {
      callback(new Error(`Unsupported locale: ${language}`), false);
      return;
    }
    loadLocale()
      .then((translations) => callback(null, translations))
      .catch((error: Error) => callback(error, false));
  },
};

// The built-in localStorage detector caches even an automatically detected
// browser language. That stale cache used to outrank VITE_DEFAULT_LANGUAGE,
// leaving existing installs in English after switching the deployment
// default to Simplified Chinese. Persist only an explicit choice made in the
// language selector; old i18nextLng/cookie values are intentionally ignored.
detector.addDetector({
  name: 'userLanguagePreference',
  lookup: () => {
    try {
      return normalizeSupportedLanguage(localStorage.getItem('picpeak-language') || undefined);
    } catch {
      return undefined;
    }
  },
});

detector.addDetector({
  name: 'deploymentDefault',
  lookup: () => normalizeSupportedLanguage(import.meta.env.VITE_DEFAULT_LANGUAGE),
});

export const i18nReady = i18n
  .use(localeBackend as any)
  .use(detector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    debug: false,

    // An empty translation should fall through to English rather than render a
    // blank UI label.
    returnEmptyString: false,

    supportedLngs: [...SUPPORTED_LOCALE_CODES],
    load: 'currentOnly',

    interpolation: {
      escapeValue: false,
    },

    // Use v4 format for pluralization (_one/_other instead of _plural suffix)
    compatibilityJSON: 'v4',

    detection: {
      order: ['userLanguagePreference', 'deploymentDefault', 'navigator', 'htmlTag'],
      caches: [],
      convertDetectedLanguage: (language: string) => normalizeSupportedLanguage(language) || 'en',
    },
  });

export default i18n;
