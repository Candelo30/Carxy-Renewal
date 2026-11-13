import type { AppLanguage } from '../languages';

/**
 * Capas de traducción por idioma. Las claves pueden ser semánticas
 * (`common.cancel`) o el texto original en español (`Comunidad 3D`).
 *
 * Los idiomas base (es/en/fr/pt) viven en MESSAGES y SOURCE_TRANSLATIONS.
 * Para añadir un idioma nuevo basta con crear sus archivos y registrarlo aquí.
 *
 * Las capas se cargan **bajo demanda**: cada idioma es un chunk aparte que
 * solo se descarga si el usuario lo elige. Antes iban todas en el bundle
 * inicial (más de 1 MB de diccionarios) y pesaban igual a un usuario en
 * español que a uno en japonés. Mientras se descarga, la interfaz usa la
 * cadena base en inglés y se repinta al terminar.
 */
export const LOCALE_OVERLAY_LOADERS: Partial<
  Record<AppLanguage, () => Promise<Record<string, string>>>
> = {
  de: async () => {
    const [base, editor, extra, legal] = await Promise.all([
      import('./de'),
      import('./de.editor'),
      import('./de.extra'),
      import('./legal.de'),
    ]);
    return {
      ...base.DE_TRANSLATIONS,
      ...editor.DE_EDITOR_TRANSLATIONS,
      ...extra.DE_EXTRA_TRANSLATIONS,
      ...legal.LEGAL_DE_TRANSLATIONS,
    };
  },
  hi: async () => {
    const [base, editor, extra, legal] = await Promise.all([
      import('./hi'),
      import('./hi.editor'),
      import('./hi.extra'),
      import('./legal.hi'),
    ]);
    return {
      ...base.HI_TRANSLATIONS,
      ...editor.HI_EDITOR_TRANSLATIONS,
      ...extra.HI_EXTRA_TRANSLATIONS,
      ...legal.LEGAL_HI_TRANSLATIONS,
    };
  },
  it: async () => {
    const [base, editor, extra, legal] = await Promise.all([
      import('./it'),
      import('./it.editor'),
      import('./it.extra'),
      import('./legal.it'),
    ]);
    return {
      ...base.IT_TRANSLATIONS,
      ...editor.IT_EDITOR_TRANSLATIONS,
      ...extra.IT_EXTRA_TRANSLATIONS,
      ...legal.LEGAL_IT_TRANSLATIONS,
    };
  },
  ja: async () => {
    const [base, editor, extra, legal] = await Promise.all([
      import('./ja'),
      import('./ja.editor'),
      import('./ja.extra'),
      import('./legal.ja'),
    ]);
    return {
      ...base.JA_TRANSLATIONS,
      ...editor.JA_EDITOR_TRANSLATIONS,
      ...extra.JA_EXTRA_TRANSLATIONS,
      ...legal.LEGAL_JA_TRANSLATIONS,
    };
  },
  ko: async () => {
    const [base, editor, extra, legal] = await Promise.all([
      import('./ko'),
      import('./ko.editor'),
      import('./ko.extra'),
      import('./legal.ko'),
    ]);
    return {
      ...base.KO_TRANSLATIONS,
      ...editor.KO_EDITOR_TRANSLATIONS,
      ...extra.KO_EXTRA_TRANSLATIONS,
      ...legal.LEGAL_KO_TRANSLATIONS,
    };
  },
  ru: async () => {
    const [base, editor, extra, legal] = await Promise.all([
      import('./ru'),
      import('./ru.editor'),
      import('./ru.extra'),
      import('./legal.ru'),
    ]);
    return {
      ...base.RU_TRANSLATIONS,
      ...editor.RU_EDITOR_TRANSLATIONS,
      ...extra.RU_EXTRA_TRANSLATIONS,
      ...legal.LEGAL_RU_TRANSLATIONS,
    };
  },
  tr: async () => {
    const [base, editor, extra, legal] = await Promise.all([
      import('./tr'),
      import('./tr.editor'),
      import('./tr.extra'),
      import('./legal.tr'),
    ]);
    return {
      ...base.TR_TRANSLATIONS,
      ...editor.TR_EDITOR_TRANSLATIONS,
      ...extra.TR_EXTRA_TRANSLATIONS,
      ...legal.LEGAL_TR_TRANSLATIONS,
    };
  },
  zh: async () => {
    const [base, editor, extra, legal] = await Promise.all([
      import('./zh'),
      import('./zh.editor'),
      import('./zh.extra'),
      import('./legal.zh'),
    ]);
    return {
      ...base.ZH_TRANSLATIONS,
      ...editor.ZH_EDITOR_TRANSLATIONS,
      ...extra.ZH_EXTRA_TRANSLATIONS,
      ...legal.LEGAL_ZH_TRANSLATIONS,
    };
  },
};
