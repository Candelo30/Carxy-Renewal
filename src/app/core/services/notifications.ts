import { Injectable, inject, signal } from '@angular/core';
import { NotificationPosition } from '../models/social.models';
import { I18nService } from './i18n';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface AppNotification {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
}

const MAX_NOTIFICATIONS = 4;

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly i18n = inject(I18nService);
  readonly notifications = signal<AppNotification[]>([]);
  readonly position = signal<NotificationPosition>('top-right');
  private nextId = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  success(message: string, title = this.i18n.translate('Operación exitosa')): void {
    this.show('success', title, message);
  }

  error(message: string, title = this.i18n.translate('No se pudo completar')): void {
    this.show('error', title, message);
  }

  warning(message: string, title = this.i18n.translate('Atención')): void {
    this.show('warning', title, message);
  }

  info(message: string, title = this.i18n.translate('Información')): void {
    this.show('info', title, message);
  }

  setPosition(position: NotificationPosition): void {
    this.position.set(position);
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.notifications.update((notifications) => notifications.filter((notification) => notification.id !== id));
  }

  private show(type: NotificationType, title: string, message: string): void {
    const id = ++this.nextId;
    const notification = { id, type, title, message };
    const current = this.notifications();
    if (current.length >= MAX_NOTIFICATIONS) this.dismiss(current[0].id);
    this.notifications.update((notifications) => [...notifications, notification]);
    const duration = type === 'error' ? 7000 : type === 'warning' ? 6000 : 4500;
    this.timers.set(id, setTimeout(() => this.dismiss(id), duration));
  }
}
