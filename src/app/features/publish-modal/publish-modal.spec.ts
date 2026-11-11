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
        { provide: LocalStateService, useValue: { loadPreferences: vi.fn(() => ({ theme: 'dark', accentColor: '#8b5cf6', language: 'es', backgroundColor: '#171a22', lightIntensity: 1.2, gizmoMode: 'translate', notificationPosition: 'top-right' })) } },
        { provide: NotificationService, useValue: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(PublishModalComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    // La vista previa se muestra en el paso 3 (Vista previa)
    fixture.componentInstance.currentStep = 3;
    fixture.detectChanges();

    expect(engine.captureImageDataUrl).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.preview).toBe(preview);
    const previewImg = fixture.nativeElement.querySelector('.preview-img') as HTMLImageElement | null;
    expect(previewImg).not.toBeNull();
    expect(previewImg?.src).toBe(preview);
  });
});
