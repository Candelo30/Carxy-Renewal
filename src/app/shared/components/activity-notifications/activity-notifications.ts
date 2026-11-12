import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth';
import { I18nService } from '../../../core/services/i18n';
import { NotificationService } from '../../../core/services/notifications';
import { SocialService } from '../../../core/services/social';
import { ActivityNotification } from '../../../core/models/social.models';
import { of, switchMap } from 'rxjs';import { TranslatePipe } from '../../pipes/translate.pipe';


@Component({
  selector: 'app-activity-notifications',
  standalone: true,
  imports: [
    TranslatePipe,AsyncPipe, DatePipe, RouterLink],
  templateUrl: './activity-notifications.html',
  styleUrl: './activity-notifications.css',
})
export class ActivityNotificationsComponent {
  readonly user$ = inject(AuthService).user$;
  readonly activities$ = this.user$.pipe(
    switchMap((user) => user ? this.social.activityNotifications$(user.uid) : of([] as ActivityNotification[])),
  );
  /** Estado del panel como signal: la app es zoneless y un `boolean` simple
   *  no redibujaría el popover al cambiar desde código. */
  readonly open = signal(false);
  private readonly social = inject(SocialService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  private readonly host = inject(ElementRef<HTMLElement>);

  /** Cierra el panel al pulsar fuera de él o al pulsar Escape. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.open()) return;
    const target = event.target as Node | null;
    if (target && this.host.nativeElement.contains(target)) return;
    this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.open.set(false);
  }

  unreadCount(items: ActivityNotification[]): number {
    return items.filter((item) => !item.read).length;
  }

  messageFor(item: ActivityNotification): string {
    if (item.kind === 'follow') return this.i18n.translate('comenzó a seguirte');
    if (item.kind === 'like') return this.i18n.translate('marcó tu modelo como favorito');
    return this.i18n.translate('comentó en tu modelo');
  }

  async markRead(item: ActivityNotification, uid: string): Promise<void> {
    this.open.set(false);
    if (item.read) return;
    try {
      await this.social.markActivityNotificationRead(uid, item.id);
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar la notificación.'));
    }
  }

  async markAllRead(items: ActivityNotification[], uid: string): Promise<void> {
    const unread = items.filter((item) => !item.read);
    if (!unread.length) {
      this.notifications.info(
        this.i18n.translate('No tienes notificaciones pendientes.'),
        this.i18n.translate('Todo al día'),
      );
      return;
    }
    try {
      await Promise.all(unread.map((item) => this.social.markActivityNotificationRead(uid, item.id)));
      this.notifications.success(
        this.i18n.translate('Marcaste {count} notificaciones como leídas.', { count: unread.length }),
        this.i18n.translate('Todo al día'),
      );
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : this.i18n.translate('No se pudieron actualizar las notificaciones.'));
    }
  }
}
