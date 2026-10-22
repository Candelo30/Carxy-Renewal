import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { AuthService } from '../../core/services/auth';
import { FileHandler } from '../../core/services/file-handler';
import { ThreeEngineService } from '../../core/services/three-engine';
import { TopToolbar } from './top-toolbar';

describe('TopToolbar', () => {
  let component: TopToolbar;
  let fixture: ComponentFixture<TopToolbar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TopToolbar],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { user$: of(null), logout: vi.fn() } },
        { provide: FileHandler, useValue: { loadLocalGLTF: vi.fn(), exportCurrentModelGLB: vi.fn() } },
        {
          provide: ThreeEngineService,
          useValue: {
            xrStatus$: new Subject<string>(),
            presentationChanged$: new Subject<boolean>(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TopToolbar);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('groups secondary viewing tools in a compact menu', () => {
    fixture.detectChanges();

    const menu = fixture.nativeElement.querySelector('.view-tools');
    expect(menu.querySelector('summary').textContent).toContain('Vista');
    expect(menu.querySelectorAll('.view-tools-menu button')).toHaveLength(5);
    expect(fixture.nativeElement.querySelector('.publish-button')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.export-button')).toBeTruthy();
  });

  it('keeps workspace navigation available in the compact layout', () => {
    fixture.detectChanges();

    const navigation = fixture.nativeElement.querySelector('.compact-navigation');
    expect(navigation.querySelector('summary').textContent).toContain('Espacio de trabajo');
    expect(navigation.querySelector('a[href="/feed"]')).toBeTruthy();
  });
});
