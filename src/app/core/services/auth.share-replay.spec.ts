import { TestBed } from '@angular/core/testing';
import { firstValueFrom, skip } from 'rxjs';
import { AuthService } from './auth';

/**
 * `user$` se comparte con `shareReplay({ bufferSize: 1, refCount: false })` para
 * que todos los consumidores reutilicen la misma suscripción en lugar de abrir
 * listeners `docData` duplicados. Multiplicar esos listeners es lo que aumenta
 * el número de targets del watch stream y hace más probable la carrera de
 * target IDs del SDK (aserción interna `ca9`).
 */
describe('AuthService user$ sharing', () => {
  let service: AuthService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(AuthService);
  });

  afterEach(() => localStorage.clear());

  it('reuses a single subscription for every consumer', async () => {
    const seen: unknown[] = [];
    const first = service.user$.subscribe((user) => seen.push(user));
    const second = service.user$.subscribe((user) => seen.push(user));

    await service.register('shared@example.test', 'password123', 'Shared');
    const user = await firstValueFrom(service.user$.pipe(skip(0)));

    // Ambas suscripciones reciben el mismo usuario y la misma referencia de
    // objeto: `shareReplay` reparte un único valor almacenado.
    expect(user?.displayName).toBe('Shared');
    expect(user).not.toBeNull();
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[seen.length - 1]).toBe(user);
    expect(seen[seen.length - 2]).toBe(user);

    first.unsubscribe();
    second.unsubscribe();
  });

  it('keeps serving the cached user to late subscribers', async () => {
    await service.register('late@example.test', 'password123', 'Late');
    const cached = await firstValueFrom(service.user$);

    // Un suscriptor que llega tarde recibe el valor cacheado sin esperar una
    // nueva emisión del `BehaviorSubject` de origen.
    const late = await firstValueFrom(service.user$);
    expect(late).toBe(cached);
  });
});
