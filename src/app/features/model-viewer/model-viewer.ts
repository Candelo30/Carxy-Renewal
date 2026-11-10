import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import {
  Component,
  ElementRef,
  HostListener,
  inject,
  Input,
  OnDestroy,
  PLATFORM_ID,
  ViewChild,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { ThreeEngineService } from '../../core/services/three-engine';
import { LocalStateService } from '../../core/services/local-state';
import { AuthService } from '../../core/services/auth';
import { CollaboratorCursorComponent } from '../../shared/components/collaborator-cursor/collaborator-cursor';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import type { ViewportHotspot } from '../../core/services/three-engine';

interface RemoteCursor {
  uid: string;
  displayName: string;
  color: string;
  x: number; // 0-1 normalized
  y: number; // 0-1 normalized
}

@Component({
  imports: [CollaboratorCursorComponent, DecimalPipe, TranslatePipe],
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
  public ownCursorUid: string | null = null;
  public showWireframe = false;
  public showGrid = true;
  public showShadows = true;
  public showAxes = false;
  public showClipping = false;
  public showBloom = false;
  public showExploded = false;
  public cameraView: 'perspective' | 'front' | 'side' | 'top' = 'perspective';
  public measuringDistance = false;
  public measurementDistance: number | null = null;
  public measureFirstObject: string | null = null;
  private measureFirstModelId: string | null = null;
  public isAutoRotate = false;
  private hotspotSubscription?: Subscription;
  private cursorSubscription?: Subscription;
  private projectionTimer?: number;
  private subscription = new Subscription();
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
      // El motor emite también el cursor propio: nunca debe dibujarse como remoto.
      if (c.uid === this.ownCursorUid || c.uid === this.threeEngine.ownCursorUid) {
        this.remoteCursors.delete(c.uid);
        return;
      }
      this.remoteCursors.set(c.uid, {
        uid: c.uid,
        displayName: this.threeEngine.getCollaborators().find((col) => col.uid === c.uid)?.displayName ?? c.uid,
        color: c.color,
        x: c.x,
        y: c.y,
      });
    });
    // Suscribirse a cambios de estado del motor 3D
    this.subscription.add(this.threeEngine.transformChanged$.subscribe(() => {
      // Sincronizar estado de explosión y otros cambios
    }));
    // Configurar el cursor propio del usuario actual y limpiar cualquier
    // entrada previa que se haya dibujado antes de conocer el UID.
    this.auth.user$.subscribe((user) => {
      if (!user) return;
      this.ownCursorUid = user.uid;
      this.threeEngine.setOwnCursorUid(user.uid);
      for (const uid of Array.from(this.remoteCursors.keys())) {
        if (uid === user.uid) this.remoteCursors.delete(uid);
      }
    });
    // Suscribirse a cambios de presentación
    this.subscription.add(this.threeEngine.presentationChanged$.subscribe((enabled) => {
      // La presentación está activa
    }));
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
    // Solo interceptamos el clic cuando el modo hotspot está activo.
    // El resto del tiempo OrbitControls maneja el arrastre, el zoom y el paneo.
    if (this.threeEngine.addHotspotFromPointer(event.clientX, event.clientY)) {
      event.stopPropagation();
    }
  }

  // --- Controles 3D ---
  toggleWireframe(): void {
    const enabled = this.threeEngine.toggleWireframe();
    this.showWireframe = enabled;
  }

  toggleGrid(): void {
    const enabled = this.threeEngine.toggleGrid();
    this.showGrid = enabled;
  }

  toggleShadows(): void {
    const enabled = this.threeEngine.toggleShadows();
    this.showShadows = enabled;
  }

  toggleAxes(): void {
    const enabled = this.threeEngine.toggleAxes();
    this.showAxes = enabled;
  }

  toggleClipping(): void {
    this.showClipping = !this.showClipping;
    this.threeEngine.setClipping(this.showClipping, 'x', 0);
  }

  toggleBloom(): void {
    this.showBloom = !this.showBloom;
    this.threeEngine.setBloom(this.showBloom, 0.7);
  }

  toggleExploded(): void {
    this.showExploded = !this.showExploded;
    this.threeEngine.setExplodedView(this.showExploded ? 0.5 : 0);
  }

  setCameraView(view: 'perspective' | 'front' | 'side' | 'top'): void {
    this.cameraView = view;
    this.threeEngine.setCameraView(view);
  }

  toggleAutoRotate(): void {
    const enabled = !this.threeEngine['controls']?.autoRotate;
    this.threeEngine.setAutoRotate(enabled);
    this.isAutoRotate = enabled;
  }

  focusSelectedNode(): void {
    this.threeEngine.focusSelectedNode();
  }

  toggleMeasureDistance(): void {
    this.measuringDistance = !this.measuringDistance;
    this.measurementDistance = null;
    this.measureFirstObject = null;
  }

  measureSelectedDistance(): void {
    if (!this.measureFirstObject) {
      const model = this.threeEngine.getCurrentModel();
      if (model) {
        this.measureFirstObject = model.id.toString();
        this.measurementDistance = null;
      }
      return;
    }
    const model = this.threeEngine.getCurrentModel();
    const firstId = this.measureFirstObject;
    if (model && firstId && model.id.toString() !== firstId) {
      const distance = this.threeEngine.measureDistanceBetweenObjects(firstId, model.id.toString());
      this.measurementDistance = distance ?? null;
      this.measureFirstObject = null;
      this.measuringDistance = false;
    } else if (model) {
      this.measureFirstObject = model.id.toString();
    } else {
      this.measureFirstObject = null;
    }
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
    this.subscription.unsubscribe();
    if (this.projectionTimer !== undefined) window.clearInterval(this.projectionTimer);
    this.threeEngine.releaseViewport();
  }
}
