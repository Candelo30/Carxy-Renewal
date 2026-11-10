/**
 * Registro único de idiomas de la aplicación.
 *
 * Para añadir un idioma:
 *   1. Añade una entrada a APP_LANGUAGES.
 *   2. Crea src/app/core/i18n/locales/<código>.ts con las traducciones.
 *   3. Regístralo en src/app/core/i18n/locales/index.ts.
 *
 * No hace falta tocar cada traducción existente: las claves que falten caen
 * primero a inglés y después al texto original en español.
 */
export const APP_LANGUAGES = [
  { code: 'es', label: 'Español', shortLabel: 'ES', htmlLang: 'es', dir: 'ltr' },
  { code: 'en', label: 'English', shortLabel: 'EN', htmlLang: 'en', dir: 'ltr' },
  { code: 'fr', label: 'Français', shortLabel: 'FR', htmlLang: 'fr', dir: 'ltr' },
  { code: 'pt', label: 'Português', shortLabel: 'PT', htmlLang: 'pt', dir: 'ltr' },
  { code: 'de', label: 'Deutsch', shortLabel: 'DE', htmlLang: 'de', dir: 'ltr' },
  { code: 'it', label: 'Italiano', shortLabel: 'IT', htmlLang: 'it', dir: 'ltr' },
  { code: 'ja', label: '日本語', shortLabel: 'JA', htmlLang: 'ja', dir: 'ltr' },
  { code: 'zh', label: '中文', shortLabel: 'ZH', htmlLang: 'zh-CN', dir: 'ltr' },
  { code: 'ko', label: '한국어', shortLabel: 'KO', htmlLang: 'ko', dir: 'ltr' },
  { code: 'ru', label: 'Русский', shortLabel: 'RU', htmlLang: 'ru', dir: 'ltr' },
  { code: 'hi', label: 'हिन्दी', shortLabel: 'HI', htmlLang: 'hi', dir: 'ltr' },
  { code: 'tr', label: 'Türkçe', shortLabel: 'TR', htmlLang: 'tr', dir: 'ltr' },
] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number]['code'];

export interface LanguageOption {
  code: AppLanguage;
  label: string;
  shortLabel: string;
  htmlLang: string;
  dir: 'ltr' | 'rtl';
}

export const DEFAULT_LANGUAGE: AppLanguage = 'es';

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === 'string'
    && APP_LANGUAGES.some((option) => option.code === value);
}
