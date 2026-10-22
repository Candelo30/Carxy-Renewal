import { TestBed } from '@angular/core/testing';
import { NotificationCenterComponent } from './notification-center';
import { NotificationService } from '../../../core/services/notifications';

describe('NotificationCenterComponent', () => {
  it('renders accessible success and error notices and permits dismissal', async () => {
    await TestBed.configureTestingModule({
      imports: [NotificationCenterComponent],
    }).compileComponents();

    const service = TestBed.inject(NotificationService);
    const fixture = TestBed.createComponent(NotificationCenterComponent);
    service.success('Perfil actualizado');
    service.error('Fallo al guardar');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.notification.success')?.getAttribute('role')).toBe('status');
    expect(fixture.nativeElement.querySelector('.notification.error')?.getAttribute('role')).toBe('alert');
    expect(fixture.nativeElement.textContent).toContain('Perfil actualizado');

    fixture.nativeElement.querySelector('.notification.error button').click();
    fixture.detectChanges();
    expect(service.notifications()).toHaveLength(1);
  });
});
