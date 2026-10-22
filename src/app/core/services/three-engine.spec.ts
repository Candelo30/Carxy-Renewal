import { TestBed } from '@angular/core/testing';
import { ThreeEngineService } from './three-engine';

describe('ThreeEngine', () => {
  let service: ThreeEngineService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ThreeEngineService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('starts and stops the presentation tour', () => {
    expect(service.togglePresentation()).toBe(true);
    expect(service.togglePresentation()).toBe(false);
  });

  it('reports unavailable AR instead of failing silently', async () => {
    let status = '';
    const subscription = service.xrStatus$.subscribe((message) => (status = message));
    await service.startAR();
    expect(status).toContain('no está disponible');
    subscription.unsubscribe();
  });

  it('accepts inspection controls before a model is selected', () => {
    expect(service.getSelectedSceneNodes()).toEqual([]);
    expect(service.toggleGrid()).toBe(false);
    service.setExplodedView(0.5);
    service.setClipping(true, 'z', 1);
    service.setBloom(true);
    service.setDepthOfField(true);
    service.setVignette(true);
    expect(service.clippingEnabled).toBe(true);
    expect(service.bloomEnabled).toBe(true);
    expect(service.depthOfFieldEnabled).toBe(true);
  });
});
