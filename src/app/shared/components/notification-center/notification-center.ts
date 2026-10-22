import { Component, inject } from '@angular/core';
import { NotificationService } from '../../../core/services/notifications';

@Component({
  selector: 'app-notification-center',
  standalone: true,
  templateUrl: './notification-center.html',
  styleUrl: './notification-center.css',
})
export class NotificationCenterComponent {
  readonly notificationService = inject(NotificationService);
}
