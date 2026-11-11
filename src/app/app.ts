import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, Component, inject, OnDestroy, PLATFORM_ID, signal } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { LocalStateService } from './core/services/local-state';
import { I18nService } from './core/services/i18n';
import { SocialService } from './core/services/social';
import { ThemeService } from './core/services/theme.service';
import { NotificationCenterComponent } from './shared/components/notification-center/notification-center';
import { NotificationService } from './core/services/notifications';
import { TranslatePipe } from './shared/pipes/translate.pipe';

@Component({
  imports: [
    TranslatePipe, RouterOutlet, NotificationCenterComponent],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App implements OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly localState = inject(LocalStateService);
  private readonly i18n = inject(I18nService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly routerSubscription = new Subscription();
  private readonly social = inject(SocialService);
  private readonly themeService = inject(ThemeService);
  private navigationTimer: ReturnType<typeof setTimeout> | undefined;
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
        if (event instanceof NavigationEnd) void this.social.recordActivity(event.url);
      }
    }));

    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      const prefs = this.localState.loadPreferences();
      this.themeService.apply({ theme: prefs.theme, accentColor: prefs.accentColor });
      this.i18n.setLanguage(prefs.language);
      this.notifications.setPosition(prefs.notificationPosition);
    });
  }

  ngOnDestroy(): void {
    this.clearNavigationTimer();
    this.routerSubscription.unsubscribe();
  }

  private clearNavigationTimer(): void {
    if (this.navigationTimer) clearTimeout(this.navigationTimer);
    this.navigationTimer = undefined;
  }
}
