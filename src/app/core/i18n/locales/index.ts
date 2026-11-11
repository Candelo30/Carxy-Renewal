import type { AppLanguage } from '../languages';
import { DE_TRANSLATIONS } from './de';
import { DE_EDITOR_TRANSLATIONS } from './de.editor';
import { DE_EXTRA_TRANSLATIONS } from './de.extra';
import { LEGAL_DE_TRANSLATIONS } from './legal.de';
import { HI_TRANSLATIONS } from './hi';
import { HI_EDITOR_TRANSLATIONS } from './hi.editor';
import { HI_EXTRA_TRANSLATIONS } from './hi.extra';
import { LEGAL_HI_TRANSLATIONS } from './legal.hi';
import { IT_TRANSLATIONS } from './it';
import { IT_EDITOR_TRANSLATIONS } from './it.editor';
import { IT_EXTRA_TRANSLATIONS } from './it.extra';
import { LEGAL_IT_TRANSLATIONS } from './legal.it';
import { JA_TRANSLATIONS } from './ja';
import { JA_EDITOR_TRANSLATIONS } from './ja.editor';
import { JA_EXTRA_TRANSLATIONS } from './ja.extra';
import { LEGAL_JA_TRANSLATIONS } from './legal.ja';
import { KO_TRANSLATIONS } from './ko';
import { KO_EDITOR_TRANSLATIONS } from './ko.editor';
import { KO_EXTRA_TRANSLATIONS } from './ko.extra';
import { LEGAL_KO_TRANSLATIONS } from './legal.ko';
import { RU_TRANSLATIONS } from './ru';
import { RU_EDITOR_TRANSLATIONS } from './ru.editor';
import { RU_EXTRA_TRANSLATIONS } from './ru.extra';
import { LEGAL_RU_TRANSLATIONS } from './legal.ru';
import { TR_TRANSLATIONS } from './tr';
import { TR_EDITOR_TRANSLATIONS } from './tr.editor';
import { TR_EXTRA_TRANSLATIONS } from './tr.extra';
import { LEGAL_TR_TRANSLATIONS } from './legal.tr';
import { ZH_TRANSLATIONS } from './zh';
import { ZH_EDITOR_TRANSLATIONS } from './zh.editor';
import { ZH_EXTRA_TRANSLATIONS } from './zh.extra';
import { LEGAL_ZH_TRANSLATIONS } from './legal.zh';

/**
 * Capas de traducción por idioma. Las claves pueden ser semánticas
 * (`common.cancel`) o el texto original en español (`Comunidad 3D`).
 *
 * Los idiomas base (es/en/fr/pt) viven en MESSAGES y SOURCE_TRANSLATIONS.
 * Para añadir un idioma nuevo basta con crear sus archivos y registrarlo aquí.
 */
export const LOCALE_OVERLAYS: Partial<Record<AppLanguage, Record<string, string>>> = {
  de: { ...DE_TRANSLATIONS, ...DE_EDITOR_TRANSLATIONS, ...DE_EXTRA_TRANSLATIONS, ...LEGAL_DE_TRANSLATIONS },
  hi: { ...HI_TRANSLATIONS, ...HI_EDITOR_TRANSLATIONS, ...HI_EXTRA_TRANSLATIONS, ...LEGAL_HI_TRANSLATIONS },
  it: { ...IT_TRANSLATIONS, ...IT_EDITOR_TRANSLATIONS, ...IT_EXTRA_TRANSLATIONS, ...LEGAL_IT_TRANSLATIONS },
  ja: { ...JA_TRANSLATIONS, ...JA_EDITOR_TRANSLATIONS, ...JA_EXTRA_TRANSLATIONS, ...LEGAL_JA_TRANSLATIONS },
  ko: { ...KO_TRANSLATIONS, ...KO_EDITOR_TRANSLATIONS, ...KO_EXTRA_TRANSLATIONS, ...LEGAL_KO_TRANSLATIONS },
  ru: { ...RU_TRANSLATIONS, ...RU_EDITOR_TRANSLATIONS, ...RU_EXTRA_TRANSLATIONS, ...LEGAL_RU_TRANSLATIONS },
  tr: { ...TR_TRANSLATIONS, ...TR_EDITOR_TRANSLATIONS, ...TR_EXTRA_TRANSLATIONS, ...LEGAL_TR_TRANSLATIONS },
  zh: { ...ZH_TRANSLATIONS, ...ZH_EDITOR_TRANSLATIONS, ...ZH_EXTRA_TRANSLATIONS, ...LEGAL_ZH_TRANSLATIONS },
};

