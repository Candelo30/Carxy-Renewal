import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { from, map, switchMap, take } from 'rxjs';
import { AuthService } from '../services/auth';

export const adminGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return from(auth.waitForAuthReady()).pipe(
    switchMap(() => auth.user$.pipe(
      take(1),
      map((user) => user?.role === 'admin' && !user.isBanned
        ? true
        : router.createUrlTree(user ? ['/feed'] : ['/login'], { queryParams: { returnUrl: state.url } })),
    )),
  );
};
