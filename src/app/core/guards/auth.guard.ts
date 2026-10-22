import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';
import { from, map, switchMap, take } from 'rxjs';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return from(auth.waitForAuthReady()).pipe(
    switchMap(() => auth.user$.pipe(
      take(1),
      map((user) => user && !user.isBanned
        ? true
        : router.createUrlTree(user ? ['/feed'] : ['/login'], { queryParams: { returnUrl: state.url } })),
    )),
  );
};
