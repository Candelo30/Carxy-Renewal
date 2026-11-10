import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { afterNextRender, Component, inject, OnDestroy, PLATFORM_ID, signal } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { LocalStateService } from './core/services/local-state';
import { I18nService } from './core/services/i18n';
import { NotificationCenterComponent } from './shared/components/notification-center/notification-center';
import { NotificationService } from './core/services/notifications';
import { TranslatePipe } from './shared/pipes/translate.pipe';

type Theme = 'dark' | 'light' | 'system';

@Component({
  imports: [
    TranslatePipe, RouterOutlet, NotificationCenterComponent],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App implements OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly localState = inject(LocalStateService);
  private readonly i18n = inject(I18nService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly routerSubscription = new Subscription();
  private navigationTimer: ReturnType<typeof setTimeout> | undefined;
  private themeMediaQuery: MediaQueryList | null = null;
  private themeMediaListener: ((event: MediaQueryListEvent) => void) | null = null;
  readonly navigationLoading = signal(false);

  constructor() {
    this.routerSubscription.add(this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.clearNavigationTimer();
        this.navigationTimer = setTimeout(() => this.navigationLoading.set(true), 180);
      } else if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      ) {
        this.clearNavigationTimer();
        this.navigationLoading.set(false);
      }
    }));

    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      this.applyTheme();
      this.i18n.setLanguage(this.localState.loadPreferences().language);
      this.document.documentElement.style.setProperty('--accent-color', this.localState.loadPreferences().accentColor);
      this.notifications.setPosition(this.localState.loadPreferences().notificationPosition);
      this.listenToSystemThemeChanges();
    });
  }

  private getStoredTheme(): Theme {
    return this.localState.loadPreferences().theme;
  }

  private applyTheme(): void {
    const stored = this.getStoredTheme();
    let resolved: 'dark' | 'light' = 'dark';

    if (stored === 'system') {
      resolved = this.matchSystemTheme() ? 'dark' : 'light';
    } else {
      resolved = stored;
    }

    this.document.documentElement.dataset['theme'] = resolved;
  }

  private matchSystemTheme(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  private listenToSystemThemeChanges(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.getStoredTheme() !== 'system') return;

    this.themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.themeMediaListener = (event) => {
      this.document.documentElement.dataset['theme'] = event.matches ? 'dark' : 'light';
    };
    this.themeMediaQuery.addEventListener('change', this.themeMediaListener);
  }

  ngOnDestroy(): void {
    this.clearNavigationTimer();
    this.routerSubscription.unsubscribe();
    if (this.themeMediaQuery && this.themeMediaListener) {
      this.themeMediaQuery.removeEventListener('change', this.themeMediaListener);
    }
  }

  private clearNavigationTimer(): void {
    if (this.navigationTimer) clearTimeout(this.navigationTimer);
    this.navigationTimer = undefined;
  }
}
