import { TestBed } from '@angular/core/testing';
import { NotificationService } from './notifications';

describe('NotificationService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds typed notifications and dismisses them automatically', () => {
    const service = TestBed.inject(NotificationService);

    service.success('Guardado');

    expect(service.notifications()).toEqual([
      expect.objectContaining({ type: 'success', message: 'Guardado' }),
    ]);
    vi.advanceTimersByTime(4500);
    expect(service.notifications()).toEqual([]);
  });

  it('limits the queue and supports manual dismissal', () => {
    const service = TestBed.inject(NotificationService);

    service.info('Uno');
    service.warning('Dos');
    service.error('Tres');
    service.success('Cuatro');
    service.info('Cinco');

    expect(service.notifications()).toHaveLength(4);
    expect(service.notifications()[0].message).toBe('Dos');
    service.dismiss(service.notifications()[0].id);
    expect(service.notifications()).toHaveLength(3);
  });

  it('stores a configurable screen position', () => {
    const service = TestBed.inject(NotificationService);

    service.setPosition('bottom-center');

    expect(service.position()).toBe('bottom-center');
  });
});
