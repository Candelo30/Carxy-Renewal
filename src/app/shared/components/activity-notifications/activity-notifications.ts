import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth';
import { NotificationService } from '../../../core/services/notifications';
import { SocialService } from '../../../core/services/social';
import { ActivityNotification } from '../../../core/models/social.models';
import { of, switchMap } from 'rxjs';

@Component({
  selector: 'app-activity-notifications',
  standalone: true,
  imports: [AsyncPipe, DatePipe, RouterLink],
  templateUrl: './activity-notifications.html',
  styleUrl: './activity-notifications.css',
})
export class ActivityNotificationsComponent {
  readonly user$ = inject(AuthService).user$;
  readonly activities$ = this.user$.pipe(
    switchMap((user) => user ? this.social.activityNotifications$(user.uid) : of([] as ActivityNotification[])),
  );
  open = false;
  private readonly social = inject(SocialService);
  private readonly notifications = inject(NotificationService);

  unreadCount(items: ActivityNotification[]): number {
    return items.filter((item) => !item.read).length;
  }

  messageFor(item: ActivityNotification): string {
    if (item.kind === 'follow') return 'comenzó a seguirte';
    if (item.kind === 'like') return 'marcó tu modelo como favorito';
    return 'comentó en tu modelo';
  }

  async markRead(item: ActivityNotification, uid: string): Promise<void> {
    this.open = false;
    if (item.read) return;
    try {
      await this.social.markActivityNotificationRead(uid, item.id);
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : 'No se pudo actualizar la notificación.');
    }
  }

  async markAllRead(items: ActivityNotification[], uid: string): Promise<void> {
    const unread = items.filter((item) => !item.read);
    try {
      await Promise.all(unread.map((item) => this.social.markActivityNotificationRead(uid, item.id)));
      this.notifications.success('No tienes notificaciones pendientes.', 'Todo al día');
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : 'No se pudieron actualizar las notificaciones.');
    }
  }
}
