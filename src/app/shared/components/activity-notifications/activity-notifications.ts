import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth';
import { I18nService } from '../../../core/services/i18n';
import { NotificationService } from '../../../core/services/notifications';
import { SocialService } from '../../../core/services/social';
import { ActivityNotification } from '../../../core/models/social.models';
import { of, switchMap, catchError } from 'rxjs';import { TranslatePipe } from '../../pipes/translate.pipe';


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
    switchMap((user) => user
      ? this.social.activityNotifications$(user.uid).pipe(
          catchError(() => {
            this.failed = true;
            return of([] as ActivityNotification[]);
          }),
        )
      : of([] as ActivityNotification[])),
  );
  /** True cuando la carga de la bandeja falló (permisos, índice, red). */
  failed = false;
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

  /** Filtro del panel: todos / no leídos. */
  readonly onlyUnread = signal(false);

  visibleItems(items: ActivityNotification[]): ActivityNotification[] {
    return this.onlyUnread() ? items.filter((item) => !item.read) : items;
  }

  groupLabel(item: ActivityNotification): 'Hoy' | 'Ayer' | 'Anteriores' {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const DAY = 24 * 60 * 60 * 1000;
    const t = item.createdAt;
    if (t >= startOfDay) return 'Hoy';
    if (t >= startOfDay - DAY) return 'Ayer';
    return 'Anteriores';
  }

  groupEntries(items: ActivityNotification[]): { label: 'Hoy' | 'Ayer' | 'Anteriores'; items: ActivityNotification[] }[] {
    const visible = this.visibleItems(items);
    const order: Array<'Hoy' | 'Ayer' | 'Anteriores'> = ['Hoy', 'Ayer', 'Anteriores'];
    return order
      .map((label) => ({ label, items: visible.filter((item) => this.groupLabel(item) === label) }))
      .filter((group) => group.items.length > 0);
  }

  messageFor(item: ActivityNotification): string {
    if (item.kind === 'follow') return this.i18n.translate('comenzó a seguirte');
    if (item.kind === 'like') return this.i18n.translate('marcó tu modelo como favorito');
    if (item.kind === 'message') return this.i18n.translate('te envió un mensaje');
    if (item.kind === 'remix') return this.i18n.translate('remixeó tu modelo');
    if (item.kind === 'share') return this.i18n.translate('se unió a tu proyecto por el enlace');
    if (item.kind === 'invite') return this.i18n.translate('te quiere invitar a un proyecto');
    return this.i18n.translate('comentó en tu modelo');
  }

  /** Un mensaje lleva a la conversación; compartir e invitación al proyecto; el resto, al perfil de quien actuó. */
  linkFor(item: ActivityNotification): string[] {
    if (item.kind === 'message') return ['/chat'];
    if (item.kind === 'share') return ['/projects', item.targetId ?? ''];
    if (item.kind === 'invite') return ['/projects', item.targetId ?? ''];
    return ['/profile', item.actorId];
  }

  queryParamsFor(item: ActivityNotification): Record<string, string> | null {
    return item.kind === 'message' ? { peer: item.actorId } : null;
  }

  async clearRead(uid: string): Promise<void> {
    try {
      const removed = await this.social.clearReadActivityNotifications(uid);
      this.notifications.success(
        this.i18n.translate(removed > 0
          ? 'Borraste {count} notificaciones leídas.'
          : 'No había notificaciones leídas que borrar.', { count: removed }),
        this.i18n.translate('Bandeja al día'),
      );
      this.open.set(false);
    } catch (error) {
      this.notifications.error(this.i18n.firebaseError(error, 'No se pudieron borrar las notificaciones leídas.'));
    }
  }

  async markRead(item: ActivityNotification, uid: string): Promise<void> {
    this.open.set(false);
    if (item.read) return;
    try {
      await this.social.markActivityNotificationRead(uid, item.id);
    } catch (error) {
      this.notifications.error(this.i18n.firebaseError(error, 'No se pudo actualizar la notificación.'));
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
      await this.social.markAllActivityNotificationsRead(uid, unread.map((item) => item.id));
      this.notifications.success(
        this.i18n.translate('Marcaste {count} notificaciones como leídas.', { count: unread.length }),
        this.i18n.translate('Todo al día'),
      );
    } catch (error) {
      this.notifications.error(this.i18n.firebaseError(error, 'No se pudieron actualizar las notificaciones.'));
    }
  }
}
