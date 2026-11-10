import { AsyncPipe } from '@angular/common';
import {
  Component,
  EventEmitter,
  inject,
  Input,
  Output,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { AppLanguage, isAppLanguage } from '../../../core/i18n/languages';
import { AuthService } from '../../../core/services/auth';
import { I18nService } from '../../../core/services/i18n';
import { SocialService } from '../../../core/services/social';
import { NotificationService } from '../../../core/services/notifications';
import { AccountMenuComponent } from '../account-menu/account-menu';
import { ActivityNotificationsComponent } from '../activity-notifications/activity-notifications';
import { CommandPaletteComponent } from '../command-palette/command-palette';
import { TranslatePipe } from '../../pipes/translate.pipe';

@Component({
  selector: 'app-shell-header',
  standalone: true,
  imports: [
    AsyncPipe,
    FormsModule,
    RouterLink,
    AccountMenuComponent,
    ActivityNotificationsComponent,
    CommandPaletteComponent,
    TranslatePipe,
  ],
  templateUrl: './shell-header.html',
  styleUrl: './shell-header.css',
})
export class ShellHeaderComponent {
  readonly auth = inject(AuthService);
  readonly social = inject(SocialService);
  readonly notifications = inject(NotificationService);
  readonly i18n = inject(I18nService);
  private readonly router = inject(Router);

  @ViewChild(CommandPaletteComponent)
  private commandPalette?: CommandPaletteComponent;

  readonly user$: Observable<{ uid: string; displayName: string; photoURL: string | null; role: string; emailVerified: boolean } | null> =
    this.auth.user$ as Observable<{
      uid: string;
      displayName: string;
      photoURL: string | null;
      role: string;
      emailVerified: boolean;
    } | null>;

  readonly languages = this.i18n.languages;
  readonly currentLanguage = this.i18n.language;

  /** @deprecated El idioma se gestiona globalmente con I18nService. */
  @Input() language?: AppLanguage;
  @Input() showSearch = true;
  @Input() showNav = true;
  @Input() authMode = false;
  @Input() showPublish = false;
  @Input() showPresentation = false;
  @Input() title = '';
  @Input() subtitle = '';
  @Output() languageChange = new EventEmitter<AppLanguage>();
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

  submitSearch(): void {
    const query = this.searchQuery.trim();
    void this.router.navigate(['/feed'], {
      queryParams: query ? { q: query } : {},
    });
  }

  clearSearch(): void {
    this.searchQuery = '';
  }

  openCommandPalette(): void {
    this.commandPalette?.open();
  }

  setLanguage(language: AppLanguage): void {
    if (this.currentLanguage() === language) return;
    this.i18n.setLanguage(language);
    this.languageChange.emit(language);
  }

  onLanguageModelChange(value: string): void {
    if (isAppLanguage(value)) this.setLanguage(value);
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
