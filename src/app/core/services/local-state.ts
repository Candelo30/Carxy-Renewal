import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { LOCAL_KEYS } from '../config/app.constants';
import { EditorPreferences, NotificationPosition } from '../models/social.models';

const DEFAULT_PREFERENCES: EditorPreferences = {
  theme: 'dark',
  accentColor: '#8b5cf6',
  language: 'es',
  backgroundColor: '#171a22',
  lightIntensity: 1.2,
  gizmoMode: 'translate',
  notificationPosition: 'top-right',
};

function isNotificationPosition(value: unknown): value is NotificationPosition {
  return value === 'top-right'
    || value === 'top-center'
    || value === 'top-left'
    || value === 'bottom-right'
    || value === 'bottom-center'
    || value === 'bottom-left';
}

@Injectable({ providedIn: 'root' })
export class LocalStateService {
  private readonly platformId = inject(PLATFORM_ID);

  loadPreferences(): EditorPreferences {
    if (!isPlatformBrowser(this.platformId)) return { ...DEFAULT_PREFERENCES };
    const raw = localStorage.getItem(LOCAL_KEYS.preferences);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    try {
      const saved = JSON.parse(raw) as Partial<EditorPreferences>;
      return {
        ...DEFAULT_PREFERENCES,
        ...saved,
        accentColor: this.validColor(saved.accentColor, DEFAULT_PREFERENCES.accentColor),
        backgroundColor: this.validColor(saved.backgroundColor, DEFAULT_PREFERENCES.backgroundColor),
        lightIntensity: Number.isFinite(saved.lightIntensity)
          ? Math.max(0, Math.min(5, saved.lightIntensity!))
          : DEFAULT_PREFERENCES.lightIntensity,
        theme: saved.theme === 'light' ? 'light' : 'dark',
        language: saved.language === 'en' ? 'en' : 'es',
        gizmoMode: ['translate', 'rotate', 'scale'].includes(saved.gizmoMode ?? '')
          ? saved.gizmoMode!
          : 'translate',
        notificationPosition: isNotificationPosition(saved.notificationPosition)
          ? saved.notificationPosition
          : DEFAULT_PREFERENCES.notificationPosition,
      };
    } catch (error) {
      console.warn('No se pudieron recuperar las preferencias locales.', error);
      localStorage.removeItem(LOCAL_KEYS.preferences);
      return { ...DEFAULT_PREFERENCES };
    }
  }

  savePreferences(preferences: EditorPreferences): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      localStorage.setItem(LOCAL_KEYS.preferences, JSON.stringify(preferences));
    } catch (error) {
      console.error('No se pudieron guardar las preferencias locales.', error);
    }
  }

  saveDraft(scene: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      localStorage.setItem(LOCAL_KEYS.draft, JSON.stringify({ savedAt: Date.now(), scene }));
    } catch (error) {
      console.error('No se pudo guardar el borrador local del modelo.', error);
    }
  }

  loadDraft(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    try {
      const draft = localStorage.getItem(LOCAL_KEYS.draft);
      if (!draft) return null;
      const parsed = JSON.parse(draft) as { scene?: unknown };
      return typeof parsed.scene === 'string' ? parsed.scene : null;
    } catch (error) {
      console.warn('Se descartó un borrador local inválido.', error);
      localStorage.removeItem(LOCAL_KEYS.draft);
      return null;
    }
  }

  clearDraft(): void {
    if (isPlatformBrowser(this.platformId)) localStorage.removeItem(LOCAL_KEYS.draft);
  }

  private validColor(value: unknown, fallback: string): string {
    return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
  }
}
