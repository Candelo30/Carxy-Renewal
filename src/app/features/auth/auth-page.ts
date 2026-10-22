import { AsyncPipe } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, firstValueFrom, take } from 'rxjs';
import { AuthService } from '../../core/services/auth';
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
  mode: 'login' | 'register' = 'login';
  email = '';
  password = '';
  displayName = '';
  error = '';
  busy = false;
  readonly user$ = inject(AuthService).user$;
  readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly subscription = new Subscription();

  ngOnInit(): void {
    this.subscription.add(this.route.data.subscribe((data) => {
      this.mode = data['mode'] === 'register' ? 'register' : 'login';
    }));
  }

  async submit(): Promise<void> {
    this.error = '';
    this.busy = true;
    try {
      if (this.mode === 'register') {
        await this.auth.register(this.email, this.password, this.displayName);
      } else {
        await this.auth.login(this.email, this.password);
      }
      this.notifications.success(
        this.mode === 'register' ? 'Tu cuenta ya está lista.' : 'Has iniciado sesión correctamente.',
        this.mode === 'register' ? 'Cuenta creada' : 'Sesión iniciada',
      );
      await this.finishLogin();
    } catch (error) {
      console.error('No se pudo completar la autenticación.', error);
      this.error = this.authErrorMessage(error);
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
      this.error = this.authErrorMessage(error);
      this.notifications.error(this.error, 'Error de acceso');
      this.changeDetector.markForCheck();
    }
  }

  private authErrorMessage(error: unknown): string {
    const code = error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
    if (code === 'auth/network-request-failed' || code === 'auth/operation-not-allowed') {
      return 'Firebase Authentication no está listo. En Firebase Console, inicializa Authentication y habilita Email/Password (y Google si usarás ese acceso).';
    }
    return error instanceof Error ? error.message : 'No se pudo completar la autenticación.';
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
      const message = error instanceof Error ? error.message : 'No se pudo cerrar sesión.';
      this.notifications.error(message, 'Error al cerrar sesión');
    }
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }
}
