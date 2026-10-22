import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth';
import { LocalStateService } from '../../../core/services/local-state';
import { NotificationService } from '../../../core/services/notifications';
import { EditorPreferences } from '../../../core/models/social.models';
import { SocialService } from '../../../core/services/social';

@Component({
  selector: 'app-account-menu',
  standalone: true,
  imports: [AsyncPipe, FormsModule, RouterLink],
  templateUrl: './account-menu.html',
  styleUrl: './account-menu.css',
})
export class AccountMenuComponent {
  readonly user$ = inject(AuthService).user$;
  readonly fallbackAvatar = '/user-avatar.svg';
  readonly preferences: EditorPreferences;
  open = false;
  settingsOpen = false;
  readonly auth = inject(AuthService);
  private readonly social = inject(SocialService);
  private readonly state = inject(LocalStateService);
  private readonly notifications = inject(NotificationService);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  accountDeletionOpen = false;
  deleteConfirmation = '';
  deletePassword = '';
  deletingAccount = false;

  constructor() {
    this.preferences = this.state.loadPreferences();
  }

  onAvatarError(event: Event): void {
    const image = event.target;
    if (image instanceof HTMLImageElement) image.src = this.fallbackAvatar;
  }

  toggleSettings(): void {
    this.open = false;
    this.settingsOpen = !this.settingsOpen;
  }

  saveAppearance(): void {
    this.document.documentElement.dataset['theme'] = this.preferences.theme;
    this.document.documentElement.style.setProperty('--accent-color', this.preferences.accentColor);
    this.state.savePreferences(this.preferences);
  }

  finishSettings(): void {
    this.saveAppearance();
    this.settingsOpen = false;
    this.notifications.success('Tus preferencias visuales quedaron guardadas en este dispositivo.', 'Ajustes guardados');
  }

  cancelAccountDeletion(): void {
    this.accountDeletionOpen = false;
    this.deleteConfirmation = '';
    this.deletePassword = '';
  }

  async deleteAccount(uid: string): Promise<void> {
    if (this.deleteConfirmation !== 'ELIMINAR') return;
    this.deletingAccount = true;
    try {
      await this.auth.reauthenticateForAccountDeletion(this.deletePassword);
      await this.social.deleteAccountData(uid);
      await this.auth.deleteAccount();
      this.open = false;
      this.settingsOpen = false;
      await this.router.navigate(['/login']);
      this.notifications.success('Tu cuenta se eliminó y tus conversaciones quedaron anonimizadas.', 'Cuenta eliminada');
    } catch (error) {
      console.error('No se pudo completar la eliminación de la cuenta.', error);
      this.notifications.error(error instanceof Error ? error.message : 'No se pudo eliminar la cuenta.', 'Error al eliminar la cuenta');
    } finally {
      this.deletingAccount = false;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.auth.logout();
      this.open = false;
      this.settingsOpen = false;
      await this.router.navigate(['/login']);
      this.notifications.info('Tu sesión se ha cerrado.');
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : 'No se pudo cerrar la sesión.',
        'Error al cerrar sesión',
      );
    }
  }
}
