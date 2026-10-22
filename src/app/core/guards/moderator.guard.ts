import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { from, map, switchMap, take } from 'rxjs';
import { AuthService } from '../services/auth';

export const moderatorGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return from(auth.waitForAuthReady()).pipe(
    switchMap(() => auth.user$.pipe(
      take(1),
      map((user) => !user?.isBanned && (user?.role === 'admin' || user?.role === 'moderator')
        ? true
        : router.createUrlTree(user ? ['/feed'] : ['/login'], { queryParams: { returnUrl: state.url } })),
    )),
  );
};
