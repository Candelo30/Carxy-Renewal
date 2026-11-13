import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';
import { from, map, switchMap, catchError, take, of } from 'rxjs';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return from(auth.waitForAuthReady()).pipe(
    // `currentUser` es síncrono y definitivo tras authStateReady: el login es
    // un hecho, no una carrera con `user$` (cuya caché shareReplay puede traer
    // un null previo a la restauración de la sesión y rebotar a /login).
    map(() => auth.currentUser),
    switchMap((firebaseUser) => {
      if (!firebaseUser) {
        return of(router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } }));
      }
      return auth.user$.pipe(
        take(1),
        map((user) => (user?.isBanned ? router.createUrlTree(['/feed']) : true)),
        // Si el perfil no llega (red caída), deja pasar: las reglas del backend
        // imponen isActiveUser() en cada escritura.
        catchError(() => of(true)),
      );
    }),
  );
};
