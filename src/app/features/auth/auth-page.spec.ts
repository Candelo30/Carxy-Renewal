import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../core/services/auth';
import { AuthPage } from './auth-page';

describe('AuthPage', () => {
  it('shows Firebase setup errors and clears the loading state', async () => {
    const auth = {
      user$: of(null),
      isConfigured: true,
      register: vi.fn().mockRejectedValue({
        code: 'auth/network-request-failed',
        message: 'Firebase request failed',
      }),
    };
    await TestBed.configureTestingModule({
      imports: [AuthPage],
      providers: [
        { provide: AuthService, useValue: auth },
        {
          provide: ActivatedRoute,
          useValue: {
            data: of({ mode: 'register' }),
            snapshot: { queryParamMap: { get: () => null } },
          },
        },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AuthPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.email = 'creator@example.test';
    fixture.componentInstance.password = 'password123';
    fixture.componentInstance.displayName = 'Creator';
    await fixture.componentInstance.submit();
    fixture.detectChanges();

    expect(fixture.componentInstance.busy).toBe(false);
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent)
      .toContain('inicializa Authentication');
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(false);
  });
});
