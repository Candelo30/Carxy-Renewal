import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { LocalStateService } from './local-state';
import { EditorPreferences } from '../models/social.models';

export type ThemeMode = 'light' | 'dark' | 'system';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly localState = inject(LocalStateService);
  private readonly prefersDark =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
  private mediaListener?: (event: MediaQueryListEvent) => void;

  readonly mode = signal<ThemeMode>('system');
  readonly accentColor = signal('#8b5cf6');

  constructor() {
    this.loadFromPreferences();
    this.apply();
    this.setupSystemThemeListener();
  }

  loadFromPreferences(): void {
    const prefs = this.localState.loadPreferences();
    this.mode.set(prefs.theme);
    this.accentColor.set(prefs.accentColor);
  }

  resolvedTheme(mode: ThemeMode = this.mode()): 'light' | 'dark' {
    if (mode === 'system') {
      return this.prefersDark?.matches ? 'dark' : 'light';
    }
    return mode;
  }

  setTheme(mode: ThemeMode, persist = true): void {
    this.mode.set(mode);
    this.apply();
    if (persist) this.persistAppearance();
  }

  setAccentColor(color: string, persist = true): void {
    this.accentColor.set(color);
    this.apply();
    if (persist) this.persistAppearance();
  }

  apply(preferences?: Pick<EditorPreferences, 'theme' | 'accentColor'>): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (preferences) {
      this.mode.set(preferences.theme);
      this.accentColor.set(preferences.accentColor);
    }
    const root = this.document.documentElement;
    root.dataset['theme'] = this.resolvedTheme();
    root.style.setProperty('--accent-color', this.accentColor());
  }

  persistAppearance(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const current = this.localState.loadPreferences();
    this.localState.savePreferences({
      ...current,
      theme: this.mode(),
      accentColor: this.accentColor(),
    });
  }

  private setupSystemThemeListener(): void {
    if (!this.prefersDark) return;
    this.mediaListener = () => {
      if (this.mode() === 'system') this.apply();
    };
    this.prefersDark.addEventListener('change', this.mediaListener);
  }
}
