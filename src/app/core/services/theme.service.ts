import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly prefersDark =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  readonly mode = signal<ThemeMode>('system');

  readonly isDark = computed(() => {
    const mode = this.mode();
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return !!this.prefersDark?.matches;
  });

  constructor() {
    this.applyTheme();
    this.prefersDark?.addEventListener('change', () => {
      if (this.mode() === 'system') {
        this.applyTheme();
      }
    });
  }

  setMode(mode: ThemeMode): void {
    this.mode.set(mode);
    this.applyTheme();
  }

  toggle(): void {
    const current = this.mode();
    if (current === 'system') {
      this.setMode('light');
    } else if (current === 'light') {
      this.setMode('dark');
    } else {
      this.setMode('system');
    }
  }

  private applyTheme(): void {
    const mode = this.mode();
    const root = this.document.documentElement;
    if (mode === 'light') {
      root.setAttribute('data-theme', 'light');
    } else if (mode === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
  }
}
