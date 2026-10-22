import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { afterNextRender, Component, inject, OnDestroy, PLATFORM_ID, signal } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { LocalStateService } from './core/services/local-state';
import { NotificationCenterComponent } from './shared/components/notification-center/notification-center';
import { NotificationService } from './core/services/notifications';

@Component({
  imports: [RouterOutlet, NotificationCenterComponent],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App implements OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly localState = inject(LocalStateService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly routerSubscription = new Subscription();
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
      }
    }));

    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      const preferences = this.localState.loadPreferences();
      this.document.documentElement.dataset['theme'] = preferences.theme;
      this.document.documentElement.style.setProperty('--accent-color', preferences.accentColor);
      this.notifications.setPosition(preferences.notificationPosition);
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
