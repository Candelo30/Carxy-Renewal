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
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';

@Component({
  selector: 'app-auth-page',
  standalone: true,
  imports: [AsyncPipe, FormsModule, LoadingSpinner, RouterLink],
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
        this.status = 'Te enviamos un enlace para restablecer la contraseña. Revisa tu bandeja y spam.';
        this.notifications.success(this.status, 'Correo enviado');
        return;
      }
      if (this.mode === 'register') {
        if (!this.passwordReady) {
          throw new Error('La contraseña debe tener al menos 8 caracteres, incluir letras y un número.');
        }
        await this.auth.register(this.email, this.password, this.displayName);
        this.notifications.success(
          'Cuenta creada. Revisa tu correo para verificarla y proteger tu espacio.',
          'Cuenta creada',
        );
      } else {
        await this.auth.login(this.email, this.password);
        this.notifications.success('Has iniciado sesión correctamente.', 'Sesión iniciada');
      }
      await this.finishLogin();
    } catch (error) {
      console.error('No se pudo completar la autenticación.', error);
      this.error = this.auth.authErrorMessage(error);
      this.notifications.error(this.error, 'Error de acceso');
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
      this.notifications.success('Has iniciado sesión correctamente.', 'Sesión iniciada');
      await this.finishLogin();
    } catch (error) {
      console.error('No se pudo autenticar con Google.', error);
      this.error = this.auth.authErrorMessage(error);
      this.notifications.error(this.error, 'Error de acceso');
      this.changeDetector.markForCheck();
    }
  }

  private async finishLogin(): Promise<void> {
    const user = await firstValueFrom(this.auth.user$.pipe(take(1)));
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    await this.router.navigateByUrl(returnUrl?.startsWith('/') ? returnUrl : user ? '/feed' : '/editor');
  }

  async logout(): Promise<void> {
    try {
      await this.auth.logout();
      this.notifications.info('Tu sesión se ha cerrado.');
    } catch (error) {
      const message = this.auth.authErrorMessage(error);
      this.notifications.error(message, 'Error al cerrar sesión');
    }
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }
}
