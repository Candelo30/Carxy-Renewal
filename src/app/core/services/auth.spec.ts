import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth';

describe('AuthService local mode', () => {
  let service: AuthService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(AuthService);
  });

  afterEach(() => localStorage.clear());

  it('creates and clears a local demonstration session', async () => {
    await service.register('creator@example.test', 'password123', 'Creator');
    expect(await firstValueFrom(service.user$)).toMatchObject({
      displayName: 'Creator',
      email: 'creator@example.test',
    });

    await service.logout();
    expect(await firstValueFrom(service.user$)).toBeNull();
  });
});
