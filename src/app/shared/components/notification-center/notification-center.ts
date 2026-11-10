import { Component, inject } from '@angular/core';
import { NotificationService } from '../../../core/services/notifications';import { TranslatePipe } from '../../pipes/translate.pipe';


@Component({
  selector: 'app-notification-center',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './notification-center.html',
  styleUrl: './notification-center.css',
})
export class NotificationCenterComponent {
  readonly notificationService = inject(NotificationService);
}
