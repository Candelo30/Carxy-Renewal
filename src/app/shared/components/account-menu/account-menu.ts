import { AsyncPipe } from '@angular/common';
import { Component, ElementRef, inject, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  AuthService,
  evaluatePasswordStrength,
  isPasswordStrongEnough,
  PasswordStrength,
} from '../../../core/services/auth';
import { AppLanguage } from '../../../core/i18n/languages';
import { I18nService } from '../../../core/services/i18n';
import { LocalStateService } from '../../../core/services/local-state';
import { NotificationService } from '../../../core/services/notifications';
import { ThemeService } from '../../../core/services/theme.service';
import { EditorPreferences } from '../../../core/models/social.models';
import { SocialService } from '../../../core/services/social';
import { TranslatePipe } from '../../pipes/translate.pipe';

@Component({
  selector: 'app-account-menu',
  standalone: true,
  imports: [AsyncPipe, FormsModule, RouterLink, TranslatePipe],
  templateUrl: './account-menu.html',
  styleUrl: './account-menu.css',
})
export class AccountMenuComponent {
  @ViewChild('settingsDialog') private settingsDialog?: ElementRef<HTMLDialogElement>;
  readonly user$ = inject(AuthService).user$;
  readonly fallbackAvatar = 'user-avatar.svg';
  readonly i18n = inject(I18nService);
  readonly languages = this.i18n.languages;
  readonly preferences: EditorPreferences;
  open = false;
  settingsTab: 'appearance' | 'security' = 'appearance';
  readonly auth = inject(AuthService);
  private readonly social = inject(SocialService);
  private readonly state = inject(LocalStateService);
  private readonly notifications = inject(NotificationService);
  private readonly themeService = inject(ThemeService);
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
    this.settingsDialog?.nativeElement.showModal();
  }

  closeSettings(): void {
    this.settingsDialog?.nativeElement.close();
  }

  closeOnBackdrop(event: MouseEvent): void {
    const dialog = this.settingsDialog?.nativeElement;
    if (!dialog) return;
    if (event.target === dialog) dialog.close();
  }

  saveAppearance(): void {
    this.state.savePreferences(this.preferences);
    this.themeService.apply({ theme: this.preferences.theme, accentColor: this.preferences.accentColor });
  }

  setLanguage(language: AppLanguage): void {
    this.preferences.language = language;
    this.i18n.setLanguage(language);
    this.saveAppearance();
  }

  finishSettings(): void {
    this.saveAppearance();
    this.closeSettings();
    this.notifications.success(
      this.i18n.translate('account.settingsSaved'),
      this.i18n.translate('common.saved'),
    );
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
      this.notifications.success(
        this.i18n.translate('Revisa tu bandeja de entrada (y spam) para verificar el correo.'),
        this.i18n.translate('Verificación enviada'),
      );
    } catch (error) {
      this.notifications.error(this.auth.authErrorMessage(error), this.i18n.translate('No se pudo verificar'));
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
      this.notifications.success(
        this.i18n.translate('Tu contraseña se actualizó. Usa la nueva en el próximo inicio de sesión.'),
        this.i18n.translate('Contraseña actualizada'),
      );
    } catch (error) {
      this.notifications.error(this.auth.authErrorMessage(error), this.i18n.translate('No se pudo cambiar la contraseña'));
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
      this.closeSettings();
      await this.router.navigate(['/login']);
      this.notifications.success(
        this.i18n.translate('Tu cuenta se eliminó y tus conversaciones quedaron anonimizadas.'),
        this.i18n.translate('Cuenta eliminada'),
      );
    } catch (error) {
      console.error('No se pudo completar la eliminación de la cuenta.', error);
      this.notifications.error(this.auth.authErrorMessage(error), this.i18n.translate('Error al eliminar la cuenta'));
    } finally {
      this.deletingAccount = false;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.auth.logout();
      this.open = false;
      await this.router.navigate(['/login']);
      this.notifications.info(this.i18n.translate('Tu sesión se ha cerrado.'));
    } catch (error) {
      this.notifications.error(
        this.auth.authErrorMessage(error),
        this.i18n.translate('Error al cerrar sesión'),
      );
    }
  }
}
