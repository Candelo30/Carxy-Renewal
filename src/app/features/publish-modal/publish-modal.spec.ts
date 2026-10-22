import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../core/services/auth';
import { FileHandler } from '../../core/services/file-handler';
import { LocalStateService } from '../../core/services/local-state';
import { NotificationService } from '../../core/services/notifications';
import { SocialService } from '../../core/services/social';
import { ThreeEngineService } from '../../core/services/three-engine';
import { PublishModalComponent } from './publish-modal';

describe('PublishModalComponent', () => {
  it('captures the preview after the viewer has rendered', async () => {
    const preview = 'data:image/png;base64,dGVzdA==';
    const engine = {
      captureImageDataUrl: vi.fn(() => preview),
      serializeScene: vi.fn(() => ''),
    };
    await TestBed.configureTestingModule({
      imports: [PublishModalComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { user$: of(null) } },
        { provide: FileHandler, useValue: {} },
        { provide: SocialService, useValue: {} },
        { provide: ThreeEngineService, useValue: engine },
        { provide: LocalStateService, useValue: {} },
        { provide: NotificationService, useValue: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(PublishModalComponent);
    expect(fixture.componentInstance.preview).toBeNull();

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(engine.captureImageDataUrl).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('.preview')?.getAttribute('src')).toBe(preview);
  });
});
