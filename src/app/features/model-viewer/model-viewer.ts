import { isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, HostListener, inject, OnDestroy, PLATFORM_ID, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { ThreeEngineService } from '../../core/services/three-engine';
import { LocalStateService } from '../../core/services/local-state';
import { AuthService } from '../../core/services/auth';
import { CollaboratorCursorComponent } from '../../shared/components/collaborator-cursor/collaborator-cursor';
import type { ViewportHotspot } from '../../core/services/three-engine';

interface RemoteCursor {
  uid: string;
  displayName: string;
  color: string;
  x: number; // 0-1 normalized
  y: number; // 0-1 normalized
}

@Component({
  imports: [CollaboratorCursorComponent],
  selector: 'app-model-viewer',
  styleUrl: './model-viewer.css',
  templateUrl: './model-viewer.html',
})
export class ModelViewer implements OnDestroy {
  // Capturamos el <canvas #rendererCanvas> del HTML
  @ViewChild('rendererCanvas', { static: true })
  public rendererCanvas!: ElementRef<HTMLCanvasElement>;
  public hotspots: ViewportHotspot[] = [];
  public remoteCursors: Map<string, RemoteCursor> = new Map();
  private hotspotSubscription?: Subscription;
  private cursorSubscription?: Subscription;
  private projectionTimer?: number;
  private readonly platformId = inject(PLATFORM_ID);
  private readonly localState = inject(LocalStateService);
  private readonly auth = inject(AuthService);

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
    this.cursorSubscription = this.threeEngine.remoteCursor$.subscribe((c) => {
      this.remoteCursors.set(c.uid, {
        uid: c.uid,
        displayName: this.threeEngine.getCollaborators().find((col) => col.uid === c.uid)?.displayName ?? c.uid,
        color: c.color,
        x: c.x,
        y: c.y,
      });
    });
    // Configurar el cursor propio del usuario actual
    this.auth.user$.subscribe((user) => {
      if (user) {
        this.threeEngine.setOwnCursorUid(user.uid);
      }
    });
    if (isPlatformBrowser(this.platformId)) {
      this.projectionTimer = window.setInterval(() => this.refreshHotspots(), 100);
    }
  }

  onCanvasMouseMove(event: MouseEvent): void {
    const canvas = this.rendererCanvas.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    this.threeEngine.updateOwnCursor(Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)));
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
    this.cursorSubscription?.unsubscribe();
    if (this.projectionTimer !== undefined) window.clearInterval(this.projectionTimer);
    this.threeEngine.releaseViewport();
  }
}
