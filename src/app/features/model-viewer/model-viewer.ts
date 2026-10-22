import { isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, HostListener, inject, OnDestroy, PLATFORM_ID, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { ThreeEngineService } from '../../core/services/three-engine';
import { LocalStateService } from '../../core/services/local-state';
import type { ViewportHotspot } from '../../core/services/three-engine';

@Component({
  imports: [],
  selector: 'app-model-viewer',
  styleUrl: './model-viewer.css',
  templateUrl: './model-viewer.html',
})
export class ModelViewer implements OnDestroy {
  // Capturamos el <canvas #rendererCanvas> del HTML
  @ViewChild('rendererCanvas', { static: true })
  public rendererCanvas!: ElementRef<HTMLCanvasElement>;
  public hotspots: ViewportHotspot[] = [];
  private hotspotSubscription?: Subscription;
  private projectionTimer?: number;
  private readonly platformId = inject(PLATFORM_ID);
  private readonly localState = inject(LocalStateService);

  constructor(private threeEngine: ThreeEngineService) {}

  ngAfterViewInit(): void {
    this.threeEngine.initialize(this.rendererCanvas.nativeElement);
    const preferences = this.localState.loadPreferences();
    this.threeEngine.updateBackgroundColor(preferences.backgroundColor);
    this.threeEngine.updateLightIntensity(preferences.lightIntensity);
    this.threeEngine.setGizmoMode(preferences.gizmoMode);
    const draft = this.localState.loadDraft();
    if (draft) this.threeEngine.restoreScene(draft);
    this.hotspotSubscription = this.threeEngine.hotspotsChanged$.subscribe(() => this.refreshHotspots());
    if (isPlatformBrowser(this.platformId)) {
      this.projectionTimer = window.setInterval(() => this.refreshHotspots(), 100);
    }
  }

  onCanvasPointerDown(event: PointerEvent): void {
    if (this.threeEngine.addHotspotFromPointer(event.clientX, event.clientY)) {
      event.stopPropagation();
      return;
    }
    this.threeEngine.placeCurrentModelOnARSurface();
  }

  private refreshHotspots(): void {
    this.hotspots = this.threeEngine.getHotspots();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.threeEngine.resize();
    this.refreshHotspots();
  }

  ngOnDestroy(): void {
    this.hotspotSubscription?.unsubscribe();
    if (this.projectionTimer !== undefined) window.clearInterval(this.projectionTimer);
    this.threeEngine.releaseViewport();
  }
}
