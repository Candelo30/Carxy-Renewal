import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';
import { LOCAL_KEYS } from './core/config/app.constants';
import { LocalStateService } from './core/services/local-state';
import { NotificationService } from './core/services/notifications';

describe('App routes', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes)],
    }).compileComponents();
  });

  it('should create the application shell', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('restores the saved theme on routes that do not render the editor', async () => {
    TestBed.inject(LocalStateService).savePreferences({
      theme: 'light',
      accentColor: '#123456',
      language: 'en',
      backgroundColor: '#171a22',
      lightIntensity: 1.2,
      gizmoMode: 'translate',
      notificationPosition: 'bottom-center',
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--accent-color')).toBe('#123456');
    expect(TestBed.inject(NotificationService).position()).toBe('bottom-center');
    localStorage.removeItem(LOCAL_KEYS.preferences);
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.removeProperty('--accent-color');
  });

  it('should provide lazy routes for editor and community features', () => {
    const paths = routes.map((route) => route.path);
    expect(paths).toEqual(expect.arrayContaining([
      'editor', 'feed', 'login', 'register', 'profile/:uid', 'chat',
    ]));
    expect(routes.find((route) => route.path === 'chat')?.canActivate).toBeTruthy();
    expect(routes.find((route) => route.path === 'profile/:uid')?.loadComponent).toBeTruthy();
    expect(routes.find((route) => route.path === 'profile/:uid')?.canActivate).toBeUndefined();
  });
});
