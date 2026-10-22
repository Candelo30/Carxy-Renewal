import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { AudioReactiveService } from '../../core/services/audio-reactive';
import { ThreeEngineService } from '../../core/services/three-engine';
import { ModelEditor } from './model-editor';

describe('ModelEditor', () => {
  let component: ModelEditor;
  let fixture: ComponentFixture<ModelEditor>;
  let engine!: {
    addPrimitive: ReturnType<typeof vi.fn>;
    setExplodedView: ReturnType<typeof vi.fn>;
    setClipping: ReturnType<typeof vi.fn>;
    setBloom: ReturnType<typeof vi.fn>;
    setDepthOfField: ReturnType<typeof vi.fn>;
    setVignette: ReturnType<typeof vi.fn>;
    setHotspotMode: ReturnType<typeof vi.fn>;
    setCameraView: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const engineMock = {
      materialsLoaded$: new Subject<void>(),
      transformChanged$: new Subject<void>(),
      sceneChanged$: new Subject<void>(),
      selectionChanged$: new Subject<void>(),
      hotspotsChanged$: new Subject<void>(),
      currentMaterials: [],
      getSceneObjects: vi.fn(() => []),
      getSelectedSceneNodes: vi.fn(() => []),
      getSelectedNodeId: vi.fn(() => null),
      getCurrentModel: vi.fn(() => null),
      serializeScene: vi.fn(() => '{}'),
      addPrimitive: vi.fn(),
      selectObject: vi.fn(),
      selectNode: vi.fn(),
      setNodeVisibility: vi.fn(),
      deleteCurrentModel: vi.fn(),
      setGizmoMode: vi.fn(),
      updateScale: vi.fn(),
      updatePosition: vi.fn(),
      updateRotation: vi.fn(),
      updateBackgroundColor: vi.fn(),
      updateMaterialColor: vi.fn(),
      updateMaterialProperty: vi.fn(),
      updateLightIntensity: vi.fn(),
      resetModelTransforms: vi.fn(),
      toggleWireframe: vi.fn(() => false),
      toggleCamera: vi.fn(() => false),
      toggleGrid: vi.fn(() => false),
      toggleShadows: vi.fn(() => false),
      toggleAxes: vi.fn(() => true),
      setAutoRotate: vi.fn(),
      setExposure: vi.fn(),
      setCameraView: vi.fn(),
      setExplodedView: vi.fn(),
      setClipping: vi.fn(),
      setBloom: vi.fn(),
      setDepthOfField: vi.fn(),
      setVignette: vi.fn(),
      setHotspotMode: vi.fn(),
      getHotspots: vi.fn(() => []),
      renameHotspot: vi.fn(),
      removeHotspot: vi.fn(),
      focusSelectedNode: vi.fn(),
      setAudioReactive: vi.fn(),
      setAudioLevels: vi.fn(),
    };
    engine = engineMock;

    await TestBed.configureTestingModule({
      imports: [ModelEditor],
      providers: [
        { provide: ThreeEngineService, useValue: engineMock },
        {
          provide: AudioReactiveService,
          useValue: {
            startFile: vi.fn(),
            startMicrophone: vi.fn(),
            stop: vi.fn(),
            readLevels: vi.fn(() => ({ bass: 0, treble: 0 })),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ModelEditor);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('adds each supported primitive, including the cylinder', () => {
    component.addPrimitive('cylinder');
    component.addPrimitive('box');
    component.addPrimitive('sphere');
    component.addPrimitive('torus');
    expect(engine['addPrimitive']).toHaveBeenNthCalledWith(1, 'cylinder');
    expect(engine['addPrimitive']).toHaveBeenCalledTimes(4);
  });

  it('wires exploded view and clipping settings to the engine', () => {
    component.explodedAmount = 0.65;
    component.onExplodedChange();
    component.clippingEnabled = true;
    component.clippingAxis = 'y';
    component.clippingOffset = 1.25;
    component.onClippingChange();
    expect(engine['setExplodedView']).toHaveBeenCalledWith(0.65);
    expect(engine['setClipping']).toHaveBeenCalledWith(true, 'y', 1.25);
  });

  it('wires post-processing, view and marker actions', () => {
    component.bloomEnabled = true;
    component.onBloomChange();
    component.depthOfFieldEnabled = true;
    component.onDepthOfFieldChange();
    component.vignetteEnabled = true;
    component.onVignetteChange();
    component.hotspotMode = true;
    component.onHotspotModeChange();
    component.setCameraView('front');
    expect(engine['setBloom']).toHaveBeenCalledWith(true);
    expect(engine['setDepthOfField']).toHaveBeenCalledWith(true);
    expect(engine['setVignette']).toHaveBeenCalledWith(true);
    expect(engine['setHotspotMode']).toHaveBeenCalledWith(true);
    expect(engine['setCameraView']).toHaveBeenCalledWith('front');
  });
});
