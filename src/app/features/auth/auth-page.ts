import { AsyncPipe } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, firstValueFrom, take } from 'rxjs';
import {
  AuthService,
  evaluatePasswordStrength,
  isPasswordStrongEnough,
  PasswordStrength,
} from '../../core/services/auth';
import { NotificationService } from '../../core/services/notifications';
import { I18nService } from '../../core/services/i18n';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';import { TranslatePipe } from '../../shared/pipes/translate.pipe';


@Component({
  selector: 'app-auth-page',
  standalone: true,
  imports: [
    TranslatePipe,
    ShellHeaderComponent,
    AsyncPipe,
    FormsModule,
    LoadingSpinner,
    RouterLink,
  ],
  templateUrl: './auth-page.html',
  styleUrl: './auth-page.css',
})
export class AuthPage implements OnInit, OnDestroy {
  mode: 'login' | 'register' | 'reset' = 'login';
  email = '';
  password = '';
  displayName = '';
  error = '';
  status = '';
  busy = false;
  showPassword = false;
  readonly user$ = inject(AuthService).user$;
  readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly subscription = new Subscription();

  get passwordStrength(): PasswordStrength {
    return evaluatePasswordStrength(this.password);
  }

  get passwordReady(): boolean {
    return isPasswordStrongEnough(this.password);
  }

  ngOnInit(): void {
    this.subscription.add(this.route.data.subscribe((data) => {
      const mode = data['mode'];
      this.mode = mode === 'register' || mode === 'reset' ? mode : 'login';
    }));
  }

  async submit(): Promise<void> {
    this.error = '';
    this.status = '';
    this.busy = true;
    try {
      if (this.mode === 'reset') {
        await this.auth.sendPasswordReset(this.email);
        this.status = this.i18n.translate('Te enviamos un enlace para restablecer la contraseña. Revisa tu bandeja y spam.');
        this.notifications.success(this.status, this.i18n.translate('Correo enviado'));
        return;
      }
      if (this.mode === 'register') {
        if (!this.passwordReady) {
          throw new Error(this.i18n.translate('La contraseña debe tener al menos 8 caracteres, incluir letras y un número.'));
        }
        await this.auth.register(this.email, this.password, this.displayName);
        this.notifications.success(
          this.i18n.translate('Cuenta creada. Revisa tu correo para verificarla y proteger tu espacio.'),
          this.i18n.translate('Cuenta creada'),
        );
      } else {
        await this.auth.login(this.email, this.password);
        this.notifications.success(
          this.i18n.translate('Has iniciado sesión correctamente.'),
          this.i18n.translate('Sesión iniciada'),
        );
      }
      await this.finishLogin();
    } catch (error) {
      console.error('No se pudo completar la autenticación.', error);
      this.error = this.auth.authErrorMessage(error);
      this.notifications.error(this.error, this.i18n.translate('Error de acceso'));
      this.changeDetector.markForCheck();
    } finally {
      this.busy = false;
      this.changeDetector.markForCheck();
    }
  }

  async googleLogin(): Promise<void> {
    this.error = '';
    try {
      await this.auth.loginWithGoogle();
      this.notifications.success(
        this.i18n.translate('Has iniciado sesión correctamente.'),
        this.i18n.translate('Sesión iniciada'),
      );
      await this.finishLogin();
    } catch (error) {
      console.error('No se pudo autenticar con Google.', error);
      this.error = this.auth.authErrorMessage(error);
      this.notifications.error(this.error, this.i18n.translate('Error de acceso'));
      this.changeDetector.markForCheck();
    }
  }

  private async finishLogin(): Promise<void> {
    const user = await firstValueFrom(this.auth.user$.pipe(take(1)));
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    await this.router.navigateByUrl(this.resolveSafeReturnUrl(returnUrl, user ? '/feed' : '/editor'));
  }

  private resolveSafeReturnUrl(returnUrl: string | null, fallback: string): string {
    if (!returnUrl) return fallback;
    const value = returnUrl.trim();
    // Solo se permiten rutas internas relativas (evita URLs absolutas, esquemas y rutas protocol-relative).
    if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
      return fallback;
    }
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value)) {
      return fallback;
    }
    return value;
  }

  async logout(): Promise<void> {
    try {
      await this.auth.logout();
      this.notifications.info(this.i18n.translate('Tu sesión se ha cerrado.'));
    } catch (error) {
      const message = this.auth.authErrorMessage(error);
      this.notifications.error(message, this.i18n.translate('Error al cerrar sesión'));
    }
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }
}
