export type AppLanguage = 'es' | 'en' | 'fr' | 'pt';

export interface LanguageOption {
  code: AppLanguage;
  label: string;
  shortLabel: string;
  htmlLang: string;
}

export const APP_LANGUAGES: readonly LanguageOption[] = [
  { code: 'es', label: 'Español', shortLabel: 'ES', htmlLang: 'es' },
  { code: 'en', label: 'English', shortLabel: 'EN', htmlLang: 'en' },
  { code: 'fr', label: 'Français', shortLabel: 'FR', htmlLang: 'fr' },
  { code: 'pt', label: 'Português', shortLabel: 'PT', htmlLang: 'pt' },
] as const;

export const DEFAULT_LANGUAGE: AppLanguage = 'es';

export function isAppLanguage(value: unknown): value is AppLanguage {
  return value === 'es' || value === 'en' || value === 'fr' || value === 'pt';
}
