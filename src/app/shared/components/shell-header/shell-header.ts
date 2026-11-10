import { AsyncPipe } from '@angular/common';
import {
  Component,
  EventEmitter,
  inject,
  Input,
  Output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { AuthService } from '../../../core/services/auth';
import { SocialService } from '../../../core/services/social';
import { NotificationService } from '../../../core/services/notifications';
import { AccountMenuComponent } from '../account-menu/account-menu';
import { ActivityNotificationsComponent } from '../activity-notifications/activity-notifications';

@Component({
  selector: 'app-shell-header',
  standalone: true,
  imports: [
    AsyncPipe,
    FormsModule,
    RouterLink,
    AccountMenuComponent,
    ActivityNotificationsComponent,
  ],
  templateUrl: './shell-header.html',
  styleUrl: './shell-header.css',
})
export class ShellHeaderComponent {
  readonly auth = inject(AuthService);
  readonly social = inject(SocialService);
  readonly notifications = inject(NotificationService);

  readonly user$: Observable<{ uid: string; displayName: string; photoURL: string | null; role: string; emailVerified: boolean } | null> =
    this.auth.user$ as Observable<{
      uid: string;
      displayName: string;
      photoURL: string | null;
      role: string;
      emailVerified: boolean;
    } | null>;

  @Input() language: 'es' | 'en' = 'es';
  @Input() showSearch = true;
  @Input() showNav = true;
  @Input() authMode = false;
  @Input() showPublish = false;
  @Input() showPresentation = false;
  @Input() title = '';
  @Input() subtitle = '';
  @Output() languageChange = new EventEmitter<'es' | 'en'>();
  @Output() menuToggle = new EventEmitter<void>();
  @Output() publishClick = new EventEmitter<void>();
  @Output() presentationChange = new EventEmitter<boolean>();

  openUserMenu = false;
  openMobileMenu = false;
  searchQuery = '';
  presentationEnabled = false;

  trackByUid(_index: number, item: { uid: string }): string {
    return item.uid;
  }

  onSearchChange(value: string): void {
    this.searchQuery = value;
  }

  clearSearch(): void {
    this.searchQuery = '';
  }

  setLanguage(language: 'es' | 'en'): void {
    if (this.language === language) return;
    this.language = language;
    this.languageChange.emit(language);
  }

  togglePresentation(): void {
    this.presentationEnabled = !this.presentationEnabled;
    this.presentationChange.emit(this.presentationEnabled);
  }

  toggleMobileMenu(): void {
    this.openMobileMenu = !this.openMobileMenu;
  }

  closeMobileMenu(): void {
    this.openMobileMenu = false;
  }

  get isAdmin(): boolean {
    return false; // se resuelve en el template con user$
  }
}
