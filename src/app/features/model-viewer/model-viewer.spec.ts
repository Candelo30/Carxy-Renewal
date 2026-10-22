import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ThreeEngineService } from '../../core/services/three-engine';
import { ModelViewer } from './model-viewer';

describe('ModelViewer', () => {
  let component: ModelViewer;
  let fixture: ComponentFixture<ModelViewer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ModelViewer],
      providers: [{
        provide: ThreeEngineService,
        useValue: {
          initialize: () => undefined,
          updateBackgroundColor: () => undefined,
          updateLightIntensity: () => undefined,
          setGizmoMode: () => undefined,
          restoreScene: () => false,
          releaseViewport: () => undefined,
          resize: () => undefined,
          hotspotsChanged$: new Subject<void>(),
          getHotspots: () => [],
          addHotspotFromPointer: () => false,
          placeCurrentModelOnARSurface: () => false,
        },
      }],
    }).compileComponents();

    fixture = TestBed.createComponent(ModelViewer);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
