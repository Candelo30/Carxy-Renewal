import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  AuthService,
  evaluatePasswordStrength,
  isPasswordStrongEnough,
  PasswordStrength,
} from '../../../core/services/auth';
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
  settingsTab: 'appearance' | 'security' = 'appearance';
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
  currentPassword = '';
  nextPassword = '';
  confirmPassword = '';
  changingPassword = false;
  sendingVerification = false;

  constructor() {
    this.preferences = this.state.loadPreferences();
  }

  get nextPasswordStrength(): PasswordStrength {
    return evaluatePasswordStrength(this.nextPassword);
  }

  get canChangePassword(): boolean {
    return this.auth.hasPasswordProvider
      && !!this.currentPassword
      && isPasswordStrongEnough(this.nextPassword)
      && this.nextPassword === this.confirmPassword;
  }

  onAvatarError(event: Event): void {
    const image = event.target;
    if (image instanceof HTMLImageElement) image.src = this.fallbackAvatar;
  }

  toggleSettings(tab: 'appearance' | 'security' = 'appearance'): void {
    this.open = false;
    this.settingsTab = tab;
    this.settingsOpen = true;
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

  async sendVerification(): Promise<void> {
    this.sendingVerification = true;
    try {
      await this.auth.sendVerificationEmail();
      this.notifications.success('Revisa tu bandeja de entrada (y spam) para verificar el correo.', 'Verificación enviada');
    } catch (error) {
      this.notifications.error(this.auth.authErrorMessage(error), 'No se pudo verificar');
    } finally {
      this.sendingVerification = false;
    }
  }

  async changePassword(): Promise<void> {
    if (!this.canChangePassword) return;
    this.changingPassword = true;
    try {
      await this.auth.changePassword(this.currentPassword, this.nextPassword);
      this.currentPassword = '';
      this.nextPassword = '';
      this.confirmPassword = '';
      this.notifications.success('Tu contraseña se actualizó. Usa la nueva en el próximo inicio de sesión.', 'Contraseña actualizada');
    } catch (error) {
      this.notifications.error(this.auth.authErrorMessage(error), 'No se pudo cambiar la contraseña');
    } finally {
      this.changingPassword = false;
    }
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
      this.notifications.error(this.auth.authErrorMessage(error), 'Error al eliminar la cuenta');
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
        this.auth.authErrorMessage(error),
        'Error al cerrar sesión',
      );
    }
  }
}
