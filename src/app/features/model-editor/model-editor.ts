// src/app/features/model-editor/model-editor.component.ts
import {
  Component,
  HostListener,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  EventEmitter,
  Output,
  ViewChild,
  ElementRef,
  inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { interval, Subscription, Subject, firstValueFrom, take } from 'rxjs';
import { auditTime, debounceTime, distinctUntilChanged, merge } from 'rxjs';
import { ThreeEngineService } from '../../core/services/three-engine';
import { AudioReactiveService } from '../../core/services/audio-reactive';
import { LocalStateService } from '../../core/services/local-state';
import { NotificationService } from '../../core/services/notifications';
import { ThemeService } from '../../core/services/theme.service';
import { AuthService } from '../../core/services/auth';
import { FileHandler } from '../../core/services/file-handler';
import { EditorHistoryService } from '../../core/services/editor-history';
import { I18nService } from '../../core/services/i18n';
import { AppLanguage } from '../../core/i18n/languages';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { CollaborationService, hasPermission } from '../../core/services/collaboration';
import { LayersPanelComponent } from './layers-panel/layers-panel';
import type { NotificationPosition, ProjectActivity, ProjectPresence, PresenceTransform } from '../../core/models/social.models';
import type {
  EditableMaterial,
  PrimitiveType,
  SceneNode,
  SceneObject,
  ViewportHotspot,
} from '../../core/services/three-engine';
import * as THREE from 'three';

interface RemoteCursor {
  uid: string;
  x: number;
  y: number;
  color: string;
}

interface RemoteSelection {
  uid: string;
  objectId: string | null;
}

@Component({
  selector: 'app-model-editor',
  standalone: true,
  imports: [FormsModule, CommonModule, TranslatePipe, LayersPanelComponent],
  templateUrl: './model-editor.html',
  styleUrl: './model-editor.css',
})
export class ModelEditor implements OnInit, OnDestroy {
  public scale = 1;
  public posX = 0;
  public posY = 0;
  public posZ = 0;
  public rotX = 0;
  public rotY = 0;
  public rotZ = 0;
  public bgColor = '#171a22';
  public materials: EditableMaterial[] = [];
  public activeGizmoMode: 'translate' | 'rotate' | 'scale' = 'translate';
  public lightIntensity: number = 1.2;
  public isWireframe: boolean = false;
  public isOrthographic: boolean = false;
  public activePanel: 'scene' | 'settings' = 'scene';
  public sceneObjects: readonly SceneObject[] = [];
  public sceneNodes: SceneNode[] = [];
  public selectedObjectId = '';
  public selectedNodeId: string | null = null;
  public searchTerm = '';
  public theme: 'dark' | 'light' | 'system' = 'dark';
  public accentColor = '#8b5cf6';
  public language: AppLanguage = 'es';
  get languages() {
    return this.i18n.languages;
  }
  public notificationPosition: NotificationPosition = 'top-right';
  public showGrid = true;
  public showShadows = true;
  public showAxes = false;
  public autoRotate = false;
  public exposure = 1.15;
  public explodedAmount = 0;
  public clippingAxis: 'x' | 'y' | 'z' = 'x';
  public clippingOffset = 0;
  public clippingEnabled = false;
  public bloomEnabled = false;
  public depthOfFieldEnabled = false;
  public vignetteEnabled = false;
  public audioEnabled = false;
  public audioStatus = '';
  public hotspotMode = false;
  public hotspots: ViewportHotspot[] = [];
  @Output() languageChange = new EventEmitter<AppLanguage>();
  private subscriptions = new Subscription();
  private readonly platformId = inject(PLATFORM_ID);
  private readonly i18n = inject(I18nService);
  private readonly localState = inject(LocalStateService);
  private readonly notifications = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly fileHandler = inject(FileHandler);
  private readonly editorHistory = inject(EditorHistoryService);
  private readonly collaboration = inject(CollaborationService);
  private readonly themeService = inject(ThemeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** Última posición conocida del cursor propio en pantalla (0-100 %). */
  private ownCursorX = 0;
  private ownCursorY = 0;
  /** Última transformación propia enviada a los colaboradores. */
  private ownTransform: PresenceTransform | null = null;
  /** Marca de tiempo del último transform remoto aplicado por colaborador (evita reaplicar). */
  private lastRemoteTransformAt = new Map<string, number>();
  /** Dispara escrituras de presencia agregadas (cursor + transform) con auditable. */
  private readonly presenceWrite$ = new Subject<void>();

  @ViewChild('sceneFileInput') private sceneFileInput?: ElementRef<HTMLInputElement>;

  public triggerImport(): void {
    this.sceneFileInput?.nativeElement.click();
  }

  public triggerExport(): void {
    void this.exportSceneGLB();
  }

  public canUndo = false;
  public canRedo = false;
  public dimensions: { width: number; height: number; depth: number } | null = null;
  public exportBusy = false;
  public importBusy = false;
  public presentationBusy = false;
  public shareBusy = false;
  public measuringDistance = false;
  public distanceMeasurement: { idA: string; idB: string; distance: number } | null = null;
  public layers: string[] = [];
  public selectedLayer: string | null = null;
  public layerVisibility: Record<string, boolean> = {};
  public snapEnabled = false;

  public collaborationOpen = false;
  public collaborators: Array<{ uid: string; displayName: string; color: string; objectId: string | null }> = [];
  public remoteCursors: Map<string, RemoteCursor> = new Map();
  public remoteSelections: Map<string, string | null> = new Map();
  public myCursor = { x: 0.5, y: 0.5 };

  public projectId: string | null = null;
  public projectName = '';
  public projectSceneLoaded = false;
  public canWrite = false;
  public isProjectOwner = false;
  public remotePresences: ProjectPresence[] = [];
  private autoSaveSub: Subscription | null = null;
  private projectLockSub: Subscription | null = null;
  private remoteSceneSub: Subscription | null = null;
  private remoteCursorSub: Subscription | null = null;
  private remoteSelectionSub: Subscription | null = null;
  private remoteJoinedSub: Subscription | null = null;
  private remoteLeftSub: Subscription | null = null;
  private presenceSub: Subscription | null = null;
  private presenceHeartbeat: ReturnType<typeof setInterval> | null = null;
  private isApplyingRemote = false;
  private transformLockTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLocalSceneSaveAt = 0;

  constructor(
    private threeEngine: ThreeEngineService,
    private audioReactive: AudioReactiveService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.restorePreferences();
    if (isPlatformBrowser(this.platformId)) {
      this.subscriptions.add(interval(50).subscribe(() => this.updateAudioFrame()));
    }
    this.subscriptions.add(this.threeEngine.materialsLoaded$.subscribe(() => this.loadMaterialsFromEngine()));
    this.subscriptions.add(this.threeEngine.transformChanged$.subscribe(() => this.syncValuesFromEngine()));
    this.subscriptions.add(this.threeEngine.hotspotsChanged$.subscribe(() => {
      this.hotspots = this.threeEngine.getHotspots();
      this.cdr.detectChanges();
    }));
    this.subscriptions.add(this.threeEngine.sceneChanged$.subscribe(() => {
      this.sceneObjects = this.threeEngine.getSceneObjects();
      this.refreshSceneNodes();
      this.cdr.detectChanges();
    }));
    this.subscriptions.add(this.threeEngine.selectionChanged$.subscribe(() => {
      this.updateSelectionState();
      this.syncValuesFromEngine();
      this.loadMaterialsFromEngine();
      this.measureDimensions();
    }));
    this.editorHistory.attach();
    this.subscriptions.add(this.editorHistory.canUndo$.subscribe((value) => {
      this.canUndo = value;
      this.cdr.detectChanges();
    }));
    this.subscriptions.add(this.editorHistory.canRedo$.subscribe((value) => {
      this.canRedo = value;
      this.cdr.detectChanges();
    }));
    this.subscriptions.add(this.threeEngine.layerChanged$.subscribe(() => {
      this.refreshLayers();
      this.cdr.detectChanges();
    }));
    this.refreshLayers();
    this.snapEnabled = this.threeEngine.snapToGrid;

    // --- Proyecto: detectar ?project=<id> y cargar escena ---
    const qp = this.route.snapshot.queryParamMap.get('project');
    if (qp) {
      this.projectId = qp;

      this.subscriptions.add(
        this.collaboration.getProject(this.projectId).subscribe((project) => {
          this.projectName = project?.name ?? '';
          this.cdr.detectChanges();
        })
      );

      this.collaboration.getProjectScene(this.projectId).pipe(take(1)).subscribe((sceneJson) => {
        if (sceneJson) {
          this.threeEngine.loadProjectScene(sceneJson);
          this.projectSceneLoaded = true;
        }
        this.sceneObjects = this.threeEngine.getSceneObjects();
        this.selectedObjectId = this.threeEngine.getSceneObjects().at(-1)?.id ?? '';
        this.updateSelectionState();
        this.refreshSceneNodes();
        this.loadMaterialsFromEngine();
        this.applyAppearance();
        this.cdr.detectChanges();
      });

      // Permisos reactivos (miembros/rol pueden cambiar o cargar con retraso)
      this.subscriptions.add(
        this.collaboration.getMembers(this.projectId).subscribe((members) => {
          const uid = this.auth.currentUser?.uid;
          const member = uid ? members.find((m) => m.userId === uid) : undefined;
          this.isProjectOwner = member?.role === 'owner';
          this.canWrite = hasPermission(member?.role ?? 'viewer', 'write');
          this.cdr.detectChanges();
        })
      );

      // Auto-guardar escena en el proyecto al cambiar (debounced), solo cambios locales
      this.autoSaveSub = merge(this.threeEngine.sceneChanged$, this.threeEngine.transformChanged$)
        .pipe(debounceTime(400))
        .subscribe(() => {
          if (!this.projectId || this.isApplyingRemote || !this.canWrite) return;
          const json = this.threeEngine.serializeScene();
          this.lastLocalSceneSaveAt = Date.now();
          void this.collaboration.saveProjectScene(this.projectId, json);
        });

      // Suscribirse a presencias remotas en tiempo real
      this.presenceSub = this.collaboration.getPresences(this.projectId).subscribe((presences) => {
        const uid = this.auth.currentUser?.uid;
        // Descartar "fantasmas": colaboradores isOnline=true pero lastSeen desactualizado
        // (pestaña cerrada / navegador matado sin llegar a clearPresence).
        const PRESENCE_TTL_MS = 45000;
        this.remotePresences = presences.filter(
          (p) => p.uid !== uid && Date.now() - (p.lastSeen ?? 0) < PRESENCE_TTL_MS,
        );
        // Sincronizar colaboradores remotos en el motor 3D para cursores/selecciones
        for (const p of this.remotePresences) {
          this.threeEngine.joinCollaboration(p.uid, p.displayName);
          if (typeof p.cursorX === 'number' && typeof p.cursorY === 'number') {
            this.threeEngine.updateCollaboratorCursor(p.uid, p.cursorX, p.cursorY);
          }
          void this.threeEngine.setCollaboratorSelection(p.uid, p.currentObjectId ?? null);
          // Aplicar transformes remotos en tiempo real (objeto moviéndose en otro cliente)
          const t = p.transform;
          if (t && p.uid !== uid && t.objectId && typeof t.updatedAt === 'number') {
            const last = this.lastRemoteTransformAt.get(p.uid) ?? 0;
            if (t.updatedAt > last) {
              this.lastRemoteTransformAt.set(p.uid, t.updatedAt);
              this.isApplyingRemote = true;
              try {
                this.threeEngine.applyRemoteTransform(p.uid, t.objectId, t.position, t.rotation, t.scale);
              } finally {
                this.isApplyingRemote = false;
              }
            }
          }
        }
        // Limpiar colaboradores que ya no están presentes
        const activeUids = new Set(this.remotePresences.map((p) => p.uid));
        for (const c of this.threeEngine.getCollaborators()) {
          if (c.uid !== uid && !activeUids.has(c.uid)) {
            this.threeEngine.leaveCollaboration(c.uid);
          }
        }
        this.cdr.detectChanges();
      });

      // Escritura agregada de la presencia propia (cursor + transform) para colaboradores remotos.
      this.subscriptions.add(
        this.presenceWrite$.pipe(auditTime(150)).subscribe(async () => {
          if (!this.projectId) return;
          const uid = this.auth.currentUser?.uid;
          if (!uid) return;
          try {
            await this.collaboration.setPresence(
              this.projectId,
              uid,
              this.auth.currentUser?.displayName ?? 'Colaborador',
              this.auth.currentUser?.photoURL ?? null,
              true,
              this.threeEngine.getSelectedNodeId() ?? null,
              this.ownCursorX,
              this.ownCursorY,
              this.ownTransform
            );
          } catch {
            // presencia best-effort
          }
        })
      );

      // Seguir el ratón sobre el viewport y propagar la posición del cursor propio.
      this.subscriptions.add(
        this.threeEngine.cursorMoved$.subscribe(({ x, y }) => {
          this.ownCursorX = x;
          this.ownCursorY = y;
          this.presenceWrite$.next();
        })
      );

      // Registrar presencia propia al unirse y mantener heartbeat (más rápido para tiempo real)
      (async () => {
        const user = await firstValueFrom(this.auth.user$.pipe(take(1)));
        if (user && this.projectId) {
          // Registrar al usuario actual como colaborador en el motor para poder emitir cursor propio
          this.threeEngine.joinCollaboration(user.uid, user.displayName ?? user.email ?? 'Usuario');
          this.threeEngine.setOwnCursorUid(user.uid);
          await this.registerOwnPresence(user);
          if (isPlatformBrowser(this.platformId)) {
            this.presenceHeartbeat = setInterval(() => {
              void this.updateOwnPresence(this.threeEngine.getSelectedNodeId() ?? null);
            }, 3000);
          }
          this.notifications.success(
            this.i18n.translate('projects.youJoinedProject', { name: this.projectName || this.projectId }),
            this.i18n.translate('projects.project')
          );
        }
      })();

      // Registrar actividad de colaboración en el historial compartido
      const lastAction = { type: '' as string, id: '' as string };
      const logActivityDebounced = (action: ProjectActivity['action'], objectId: string, objectType: string, snapshot?: string) => {
        if (!this.projectId || !this.canWrite) return;
        void this.collaboration.logActivity(this.projectId, action, objectId, objectType, snapshot);
      };

      this.subscriptions.add(this.threeEngine.selectionChanged$.subscribe(() => {
        this.updateSelectionState();
        this.syncValuesFromEngine();
        this.loadMaterialsFromEngine();
        this.measureDimensions();
        this.updateOwnPresence();
        const selId = this.threeEngine.getSelectedNodeId();
        void this.threeEngine.setCollaboratorSelection(this.auth.currentUser?.uid ?? '', selId);
      }));

      this.subscriptions.add(this.threeEngine.sceneChanged$.subscribe(() => {
        this.sceneObjects = this.threeEngine.getSceneObjects();
        this.refreshSceneNodes();
        this.cdr.detectChanges();
      }));

      // Detectar creación/eliminación de objetos y loguear actividad
      this.subscriptions.add(this.threeEngine.sceneChanged$.subscribe(() => {
        const current = this.threeEngine.getSceneObjects();
        if (current.length === 0 && lastAction.type !== 'cleared') {
          // No loguear borrado masivo aquí, se maneja en deleteSelectedObject
        }
        // Guardar referencia para comparar en el siguiente cambio
        lastAction.type = 'scene';
        lastAction.id = current.map(o => o.id).join(',');
      }));

      // Loguear cuando se selecciona un objeto (selectionChanged ya existe arriba)
      // Enviar transform propia a colaboradores (audit 150ms; presencia agregada)
      this.subscriptions.add(this.threeEngine.transformChanged$.pipe(auditTime(150)).subscribe(() => {
        const selId = this.threeEngine.getSelectedNodeId();
        if (selId && this.canWrite) {
          const node = this.threeEngine.getSelectedSceneNodes().find((n) => n.id === selId);
          if (node) {
            this.ownTransform = {
              objectId: selId,
              position: { x: node.object.position.x, y: node.object.position.y, z: node.object.position.z },
              rotation: { x: node.object.rotation.x, y: node.object.rotation.y, z: node.object.rotation.z },
              scale: { x: node.object.scale.x, y: node.object.scale.y, z: node.object.scale.z },
              updatedAt: Date.now(),
            };
            this.presenceWrite$.next();
          }
        }
      }));

      // Bloquear el objeto mientras se transforma (audit 700ms; se libera 3s tras el último cambio)
      this.subscriptions.add(this.threeEngine.transformChanged$.pipe(auditTime(700)).subscribe(() => {
        const selId = this.threeEngine.getSelectedNodeId();
        if (selId && this.canWrite) {
          if (this.transformLockTimer) clearTimeout(this.transformLockTimer);
          void this.collaboration.lockObject(this.projectId!, selId, this.auth.currentUser?.uid ?? '');
          this.transformLockTimer = setTimeout(() => {
            void this.collaboration.unlockObject(this.projectId!, selId);
          }, 3000);
        }
      }));

      // Registrar actividad de colaboración (audit 3s; no serializar escena en cada cambio)
      this.subscriptions.add(this.threeEngine.transformChanged$.pipe(auditTime(3000)).subscribe(() => {
        const selId = this.threeEngine.getSelectedNodeId();
        if (selId && this.canWrite) {
          logActivityDebounced('object_updated', selId, 'object');
        }
      }));

      // --- Colaboración en tiempo real: cursores y selecciones remotas ---
      this.remoteCursorSub = this.threeEngine.remoteCursor$.subscribe((cursor) => {
        if (cursor.uid === this.auth.currentUser?.uid) return;
        this.remoteCursors.set(cursor.uid, cursor);
        this.cdr.detectChanges();
      });

      this.remoteSelectionSub = this.threeEngine.collaboratorSelection$.subscribe((sel) => {
        if (sel.uid === this.auth.currentUser?.uid) return;
        this.remoteSelections.set(sel.uid, sel.objectId);
        this.cdr.detectChanges();
      });

      this.remoteJoinedSub = this.threeEngine.collaboratorJoined$.subscribe((c) => {
        this.notifications.info(
          this.i18n.translate('projects.youJoinedProject', { name: c.displayName }),
          this.i18n.translate('projects.colaboracion')
        );
        this.cdr.detectChanges();
      });

      this.remoteLeftSub = this.threeEngine.collaboratorLeft$.subscribe((uid) => {
        this.remoteCursors.delete(uid);
        this.remoteSelections.delete(uid);
        this.lastRemoteTransformAt.delete(uid);
        this.cdr.detectChanges();
      });

      // Escuchar cambios remotos de la escena y aplicarlos localmente
      this.remoteSceneSub = this.collaboration.watchProjectScene(this.projectId).subscribe((remoteJson) => {
        if (!remoteJson) return;
        // Evitar bucle/eco justo después de un guardado local
        if (Date.now() - this.lastLocalSceneSaveAt < 1500) return;
        if (this.isApplyingRemote) return;
        const current = this.threeEngine.serializeScene();
        if (remoteJson === current) return;
        this.isApplyingRemote = true;
        try {
          const applied = this.threeEngine.loadProjectScene(remoteJson);
          if (applied) {
            this.sceneObjects = this.threeEngine.getSceneObjects();
            this.refreshSceneNodes();
            this.loadMaterialsFromEngine();
            this.cdr.detectChanges();
          }
        } finally {
          this.isApplyingRemote = false;
        }
      });

      // Sincronizar bloqueos de objetos remotos
      this.projectLockSub = this.threeEngine.objectLockChanged$.subscribe((lock) => {
        if (lock.lockedBy && lock.lockedBy !== this.auth.currentUser?.uid) {
          this.notifications.warning(
            this.i18n.translate('projects.objectLockedBy', { name: lock.lockedBy }),
            this.i18n.translate('projects.objectLocked')
          );
        }
      });

      // Sincronizar los locks del proyecto desde Firestore: marca como bloqueados
      // para este editor los objetos que otros clientes hayan bloqueado.
      this.subscriptions.add(
        this.collaboration.watchProjectLocks(this.projectId).subscribe((entries) => {
          this.threeEngine.setRemoteLocks(entries);
          this.cdr.detectChanges();
        }),
      );
    } else {
      // Sin proyecto: guardar en borrador local como antes
      this.subscriptions.add(
        merge(this.threeEngine.sceneChanged$, this.threeEngine.transformChanged$)
          .pipe(auditTime(800))
          .subscribe(() => this.localState.saveDraft(this.threeEngine.serializeScene())),
      );
      this.sceneObjects = this.threeEngine.getSceneObjects();
      this.selectedObjectId = this.threeEngine.getSceneObjects().at(-1)?.id ?? '';
      this.updateSelectionState();
      this.refreshSceneNodes();
      this.loadMaterialsFromEngine();
      this.applyAppearance();
    }
  }

  trackById(_index: number, item: { id: string }): string {
    return item.id;
  }

  trackByUuid(_index: number, item: { uuid: string }): string {
    return item.uuid;
  }

  private restorePreferences(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const preferences = this.localState.loadPreferences();
    this.theme = preferences.theme;
    this.accentColor = preferences.accentColor;
    this.language = this.i18n.language();
    this.notificationPosition = preferences.notificationPosition;
    this.bgColor = preferences.backgroundColor;
    this.lightIntensity = preferences.lightIntensity;
    this.activeGizmoMode = preferences.gizmoMode;
    this.languageChange.emit(this.language);
  }

  // Cambiar modo del Gizmo (Mover, Rotar, Escalar)
  setGizmoMode(mode: 'translate' | 'rotate' | 'scale'): void {
    this.activeGizmoMode = mode;
    this.threeEngine.setGizmoMode(mode);
    this.persistPreferences();
  }

  addPrimitive(type: PrimitiveType): void {
    const id = this.threeEngine.addPrimitive(type);
    if (id && this.projectId && this.canWrite) {
      const obj = this.threeEngine.getSceneObjects().find((o) => o.id === id);
      void this.collaboration.logActivity(
        this.projectId,
        'object_created',
        id,
        obj?.name ?? type,
        this.threeEngine.sceneJson
      );
    }
  }

  selectObject(id: string): void {
    this.threeEngine.selectObject(id);
  }

  selectNode(id: string): void {
    this.threeEngine.selectNode(id);
  }

  toggleNodeVisibility(node: SceneNode, event: Event): void {
    event.stopPropagation();
    this.threeEngine.setNodeVisibility(node.id, !node.visible);
    node.visible = !node.visible;
  }

  get filteredSceneNodes(): SceneNode[] {
    const query = this.searchTerm.trim().toLocaleLowerCase();
    return query
      ? this.sceneNodes.filter((node) => node.name.toLocaleLowerCase().includes(query))
      : this.sceneNodes;
  }

  deleteSelectedObject(): void {
    const id = this.threeEngine.deleteCurrentModel();
    if (id && this.projectId && this.canWrite) {
      void this.collaboration.logActivity(
        this.projectId,
        'object_deleted',
        id,
        'object',
        this.threeEngine.sceneJson
      );
    }
  }

  applyAppearance(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.themeService.apply({ theme: this.theme, accentColor: this.accentColor });
    this.persistPreferences();
  }

  setTheme(theme: 'dark' | 'light'): void {
    this.theme = theme;
    this.applyAppearance();
  }

  setLanguage(language: AppLanguage): void {
    this.language = language;
    this.i18n.setLanguage(language);
    this.languageChange.emit(language);
    this.persistPreferences();
  }

  setNotificationPosition(position: NotificationPosition): void {
    this.notificationPosition = position;
    this.notifications.setPosition(position);
    this.persistPreferences();
  }

  // Leer los valores actuales del objeto 3D y ponerlos en los sliders
  private syncValuesFromEngine(): void {
    const model = this.threeEngine.getCurrentModel();
    this.posX = model ? Number(model.position.x.toFixed(2)) : 0;
    this.posY = model ? Number(model.position.y.toFixed(2)) : 0;
    this.posZ = model ? Number(model.position.z.toFixed(2)) : 0;
    this.rotX = model ? Math.round(THREE.MathUtils.radToDeg(model.rotation.x)) : 0;
    this.rotY = model ? Math.round(THREE.MathUtils.radToDeg(model.rotation.y)) : 0;
    this.rotZ = model ? Math.round(THREE.MathUtils.radToDeg(model.rotation.z)) : 0;
    this.scale = model ? Number(model.scale.x.toFixed(2)) : 1;
    this.cdr.detectChanges();
  }

  // --- MÉTODOS DE TRANSFORMACIÓN ---

  onScaleChange(): void {
    this.threeEngine.updateScale(this.scale);
  }

  onPositionChange(axis: 'x' | 'y' | 'z', value: number): void {
    this.threeEngine.updatePosition(axis, value);
  }

  onRotationChange(axis: 'x' | 'y' | 'z', value: number): void {
    this.threeEngine.updateRotation(axis, value);
  }

  onBgColorChange(): void {
    this.threeEngine.updateBackgroundColor(this.bgColor);
    this.persistPreferences();
  }

  // --- MÉTODOS DE MATERIALES ---

  onMaterialColorChange(uuid: string, newColor: string): void {
    this.threeEngine.updateMaterialColor(uuid, newColor);
  }

  onMaterialPropertyChange(
    uuid: string,
    property: 'roughness' | 'metalness' | 'opacity',
    value: number,
  ): void {
    this.threeEngine.updateMaterialProperty(uuid, property, value);
  }

  private loadMaterialsFromEngine(): void {
    this.materials = [...this.threeEngine.currentMaterials];
    this.cdr.detectChanges();
  }

  private refreshSceneNodes(): void {
    this.sceneNodes = this.threeEngine.getSelectedSceneNodes();
  }

  private updateSelectionState(): void {
    const selected = this.threeEngine.getCurrentModel();
    const root = this.threeEngine.getSceneObjects().find((item) => {
      let containsSelected = false;
      item.object.traverse((node) => {
        if (node === selected) containsSelected = true;
      });
      return containsSelected;
    });
    this.selectedObjectId = root?.id ?? '';
    this.selectedNodeId = this.threeEngine.getSelectedNodeId();
    this.refreshSceneNodes();
  }

  // NUEVO MÉTODO: Cambio de iluminación
  onLightIntensityChange(): void {
    this.threeEngine.updateLightIntensity(this.lightIntensity);
    this.persistPreferences();
  }

  onResetTransforms(): void {
    this.threeEngine.resetModelTransforms();
  }

  // NUEVO MÉTODO: Alternar estructura
  onToggleWireframe(): void {
    this.isWireframe = this.threeEngine.toggleWireframe();
  }

  // NUEVO MÉTODO: Cambiar tipo de cámara
  onToggleCamera(): void {
    this.isOrthographic = this.threeEngine.toggleCamera();
  }

  onToggleGrid(): void {
    this.showGrid = this.threeEngine.toggleGrid();
  }

  onToggleShadows(): void {
    this.showShadows = this.threeEngine.toggleShadows();
  }

  onToggleAxes(): void {
    this.showAxes = this.threeEngine.toggleAxes();
  }

  onAutoRotateChange(): void {
    this.threeEngine.setAutoRotate(this.autoRotate);
  }

  onExposureChange(): void {
    this.threeEngine.setExposure(this.exposure);
  }

  private persistPreferences(): void {
    this.localState.savePreferences({
      theme: this.theme,
      accentColor: this.accentColor,
      language: this.language,
      backgroundColor: this.bgColor,
      lightIntensity: this.lightIntensity,
      gizmoMode: this.activeGizmoMode,
      notificationPosition: this.notificationPosition,
    });
  }

  onExplodedChange(): void {
    this.threeEngine.setExplodedView(this.explodedAmount);
  }

  onClippingChange(): void {
    this.threeEngine.setClipping(this.clippingEnabled, this.clippingAxis, this.clippingOffset);
  }

  onBloomChange(): void {
    this.threeEngine.setBloom(this.bloomEnabled);
  }

  onDepthOfFieldChange(): void {
    this.threeEngine.setDepthOfField(this.depthOfFieldEnabled);
  }

  onVignetteChange(): void {
    this.threeEngine.setVignette(this.vignetteEnabled);
  }

  onHotspotModeChange(): void {
    this.threeEngine.setHotspotMode(this.hotspotMode);
  }

  renameHotspot(hotspot: ViewportHotspot, label: string): void {
    this.threeEngine.renameHotspot(hotspot.id, label);
  }

  removeHotspot(hotspot: ViewportHotspot): void {
    this.threeEngine.removeHotspot(hotspot.id);
  }

  async startAudioFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      await this.audioReactive.startFile(file);
      this.audioEnabled = true;
      this.threeEngine.setAudioReactive(true);
      this.audioStatus = this.i18n.translate('Reproduciendo: {name}', { name: file.name });
      this.notifications.success(
        this.i18n.translate('Reproduciendo {name}.', { name: file.name }),
        this.i18n.translate('Audio activado'),
      );
    } catch (error) {
      console.error('No se pudo reproducir el archivo de audio.', error);
      await this.audioReactive.stop();
      this.audioStatus = this.i18n.translate('No se pudo abrir el audio. Revisa el formato del archivo.');
      this.notifications.error(this.audioStatus, this.i18n.translate('No se pudo abrir el audio'));
    }
  }

  async startMicrophone(): Promise<void> {
    try {
      await this.audioReactive.startMicrophone();
      this.audioEnabled = true;
      this.threeEngine.setAudioReactive(true);
      this.audioStatus = this.i18n.translate('Micrófono activo');
      this.notifications.info(this.i18n.translate('La escena responderá al sonido del micrófono.'));
    } catch (error) {
      console.error('No se pudo iniciar el micrófono.', error);
      await this.audioReactive.stop();
      this.audioStatus = this.i18n.translate('No se pudo acceder al micrófono. Revisa permisos y conexión segura.');
      this.notifications.warning(this.audioStatus, this.i18n.translate('Micrófono no disponible'));
    }
  }

  async stopAudio(): Promise<void> {
    await this.audioReactive.stop();
    this.audioEnabled = false;
    this.threeEngine.setAudioReactive(false);
    this.threeEngine.setAudioLevels(0, 0);
    this.audioStatus = this.i18n.translate('Audio detenido');
    this.notifications.info(this.audioStatus);
  }

  updateAudioFrame(): void {
    if (!this.audioEnabled) return;
    const levels = this.audioReactive.readLevels();
    this.threeEngine.setAudioLevels(levels.bass, levels.treble);
  }

  setCameraView(view: 'perspective' | 'front' | 'side' | 'top'): void {
    this.threeEngine.setCameraView(view);
  }

  focusSelectedNode(): void {
    this.threeEngine.focusSelectedNode();
  }

  private measureDimensions(): void {
    const model = this.threeEngine.getCurrentModel();
    if (!model) {
      this.dimensions = null;
      return;
    }
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    this.dimensions = {
      width: Number(size.x.toFixed(2)),
      height: Number(size.y.toFixed(2)),
      depth: Number(size.z.toFixed(2)),
    };
  }

  // --- Historial (deshacer / rehacer) ---

  undo(): void {
    if (!this.editorHistory.undo()) return;
    this.notifications.info(this.i18n.translate('Deshacer realizado.'), this.i18n.translate('Historial'));
  }

  redo(): void {
    if (!this.editorHistory.redo()) return;
    this.notifications.info(this.i18n.translate('Rehacer realizado.'), this.i18n.translate('Historial'));
  }

  clearHistory(): void {
    this.editorHistory.clear();
    this.notifications.info(this.i18n.translate('Historial limpiado.'), this.i18n.translate('Historial'));
  }

  // --- Duplicar / copiar / pegar ---

  duplicateSelectedObject(): void {
    const newId = this.threeEngine.duplicateSelected();
    if (!newId) {
      this.notifications.warning(this.i18n.translate('Selecciona un objeto para duplicar.'));
      return;
    }
    if (this.projectId && this.canWrite) {
      const obj = this.threeEngine.getSceneObjects().find((o) => o.id === newId);
      void this.collaboration.logActivity(
        this.projectId,
        'object_created',
        newId,
        obj?.name ?? 'object',
        this.threeEngine.sceneJson
      );
    }
    this.notifications.success(this.i18n.translate('Objeto duplicado.'), this.i18n.translate('Duplicar'));
  }

  copySelectedToClipboard(): void {
    const payload = this.threeEngine.copySelectedToClipboard();
    if (!payload) {
      this.notifications.warning(this.i18n.translate('Selecciona un objeto para copiar.'));
      return;
    }
    if (!isPlatformBrowser(this.platformId)) return;
    void navigator.clipboard.writeText(payload).then(() => {
      this.notifications.success(this.i18n.translate('Objeto copiado al portapapeles.'), this.i18n.translate('Copiar'));
    }, () => {
      this.notifications.error(this.i18n.translate('No se pudo acceder al portapapeles.'), this.i18n.translate('Copiar'));
    });
  }

  pasteFromClipboard(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    navigator.clipboard.readText().then((raw) => {
      const ok = this.threeEngine.pasteObjectFromClipboard(raw);
      if (!ok) {
        this.notifications.warning(this.i18n.translate('No hay un objeto 3D válido en el portapapeles.'));
        return;
      }
      this.notifications.success(this.i18n.translate('Objeto pegado desde el portapapeles.'), this.i18n.translate('Pegar'));
    }, () => {
      this.notifications.error(this.i18n.translate('No se pudo leer el portapapeles.'), this.i18n.translate('Pegar'));
    });
  }

  // --- Exportar / importar escena ---

  async exportSceneGLB(): Promise<void> {
    this.exportBusy = true;
    try {
      this.fileHandler.exportCurrentModelGLB();
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo exportar la escena.'),
        this.i18n.translate('Exportar'),
      );
    } finally {
      this.exportBusy = false;
    }
  }

  async importSceneFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.glb') && !file.name.toLowerCase().endsWith('.gltf')) {
      this.notifications.warning(this.i18n.translate('Selecciona un archivo .glb o .gltf.'));
      return;
    }
    this.importBusy = true;
    try {
      this.fileHandler.loadLocalGLTF(file);
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo importar el modelo.'),
        this.i18n.translate('Importar'),
      );
    } finally {
      this.importBusy = false;
    }
  }

  // --- Capturar imagen ---

  captureScreenshot(): void {
    const image = this.threeEngine.captureImageDataUrl();
    if (!image) {
      this.notifications.warning(this.i18n.translate('No se pudo capturar la vista actual.'));
      return;
    }
    const link = document.createElement('a');
    link.href = image;
    link.download = `carxy-render-${Date.now()}.png`;
    link.click();
    this.notifications.success(this.i18n.translate('Imagen capturada y descargada.'), this.i18n.translate('Captura'));
  }

  // --- Presentación / turntable ---

  togglePresentation(): void {
    const enabled = this.threeEngine.togglePresentation();
    this.notifications.info(
      enabled
        ? this.i18n.translate('Modo presentación activado.')
        : this.i18n.translate('Modo presentación desactivado.'),
      this.i18n.translate('Presentación'),
    );
  }

  async recordTurntable(): Promise<void> {
    this.presentationBusy = true;
    try {
      this.threeEngine.recordTurntable(10);
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo grabar el video.'),
        this.i18n.translate('Turntable'),
      );
    } finally {
      this.presentationBusy = false;
    }
  }

  private refreshLayers(): void {
    this.layers = this.threeEngine.getLayers();
    const nextVisibility: Record<string, boolean> = {};
    for (const layer of this.layers) {
      nextVisibility[layer] = this.threeEngine.getLayerVisibility(layer) ?? true;
    }
    this.layerVisibility = nextVisibility;
    if (this.selectedLayer && !this.layers.includes(this.selectedLayer)) {
      this.selectedLayer = this.layers.length ? this.layers[0] : null;
    }
  }

  // --- Atajos de teclado ---

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && (event.ctrlKey || event.metaKey) && !event.shiftKey) { event.preventDefault(); this.undo(); }
    else if (key === 'y' && (event.ctrlKey || event.metaKey) && !event.shiftKey) { event.preventDefault(); this.redo(); }
    else if (key === 'z' && (event.ctrlKey || event.metaKey) && event.shiftKey) { event.preventDefault(); this.redo(); }
    else if (key === 'g') { event.preventDefault(); this.setGizmoMode('translate'); }
    else if (key === 'r') { event.preventDefault(); this.setGizmoMode('rotate'); }
    else if (key === 's') { event.preventDefault(); this.setGizmoMode('scale'); }
    else if (key === 'delete' || key === 'backspace') { event.preventDefault(); this.deleteSelectedObject(); }
    else if (key === 'c' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); this.copySelectedToClipboard(); }
    else if (key === 'v' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); this.pasteFromClipboard(); }
    else if (key === 'd' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); this.duplicateSelectedObject(); }
    else if (key === 'f') { event.preventDefault(); this.focusSelectedNode(); }
    else if (key === 'm') { event.preventDefault(); this.toggleMeasureDistance(); }
    else if (key === '1') { event.preventDefault(); this.setCameraView('perspective'); }
    else if (key === '2') { event.preventDefault(); this.setCameraView('front'); }
    else if (key === '3') { event.preventDefault(); this.setCameraView('side'); }
    else if (key === '4') { event.preventDefault(); this.setCameraView('top'); }
  }

  toggleMeasureDistance(): void {
    this.measuringDistance = !this.measuringDistance;
    this.distanceMeasurement = null;
    this.notifications.info(
      this.measuringDistance
        ? this.i18n.translate('Modo medición activado. Selecciona dos objetos.')
        : this.i18n.translate('Modo medición desactivado.'),
      this.i18n.translate('Medición'),
    );
  }

  measureSelectedDistance(): void {
    if (!this.selectedObjectId) {
      this.notifications.warning(this.i18n.translate('Selecciona un objeto primero.'));
      return;
    }
    if (!this.distanceMeasurement) {
      this.distanceMeasurement = { idA: this.selectedObjectId, idB: '', distance: 0 };
      this.notifications.info(
        this.i18n.translate('Selecciona el segundo objeto para medir la distancia.'),
        this.i18n.translate('Medición'),
      );
      return;
    }
    if (this.distanceMeasurement.idA === this.selectedObjectId) {
      this.notifications.warning(this.i18n.translate('Selecciona un objeto diferente.'));
      return;
    }
    this.distanceMeasurement.idB = this.selectedObjectId;
    const distance = this.threeEngine.measureDistanceBetweenObjects(this.distanceMeasurement.idA, this.distanceMeasurement.idB);
    if (distance !== null) {
      this.distanceMeasurement.distance = distance;
      this.notifications.success(
        this.i18n.translate('Distancia: {distance} unidades.', { distance: distance.toFixed(2) }),
        this.i18n.translate('Medición'),
      );
    }
    this.measuringDistance = false;
  }

  // --- Más primitivas ---

  addCone(): void { this.threeEngine.addPrimitive('cone'); }
  addPlane(): void { this.threeEngine.addPrimitive('plane'); }
  addRing(): void { this.threeEngine.addPrimitive('ring'); }

  // --- Capas ---

  addLayer(): void {
    const name = prompt(this.i18n.translate('Nombre de la capa:'));
    if (!name || name.trim() === '') return;
    const trimmed = name.trim();
    if (this.layers.includes(trimmed)) {
      this.notifications.warning(this.i18n.translate('Esa capa ya existe.'));
      return;
    }
    this.threeEngine.addToLayer('', trimmed); // no-op para crear la capa (se crea al añadir un objeto)
    this.notifications.success(
      this.i18n.translate('Capa "{name}" creada. Asigna objetos a ella desde la lista.', { name: trimmed }),
      this.i18n.translate('Capa'),
    );
    this.refreshLayers();
  }

  removeLayer(): void {
    if (!this.selectedLayer) return;
    const layer = this.selectedLayer;
    // Remover todos los objetos de esta capa
    this.objectsInLayer(layer).forEach((id) => this.threeEngine.removeFromLayer(id));
    this.selectedLayer = null;
    this.refreshLayers();
    this.notifications.success(
      this.i18n.translate('Capa "{name}" eliminada.', { name: layer }),
      this.i18n.translate('Capa'),
    );
  }

  objectsInLayer(layerName: string): string[] {
    return this.sceneObjects
      .filter((item) => this.threeEngine.getObjectLayer(item.id) === layerName)
      .map((item) => item.id);
  }

  toggleLayerVisibility(layerName: string): void {
    const current = this.threeEngine.getLayerVisibility(layerName);
    this.threeEngine.setLayerVisibility(layerName, current !== false);
    this.layerVisibility = { ...this.layerVisibility, [layerName]: current === false };
    this.cdr.detectChanges();
  }

  assignSelectedToLayer(): void {
    if (!this.selectedLayer || !this.selectedObjectId) {
      this.notifications.warning(this.i18n.translate('Selecciona una capa y un objeto.'));
      return;
    }
    this.threeEngine.addToLayer(this.selectedObjectId, this.selectedLayer);
    this.notifications.success(
      this.i18n.translate('Objeto asignado a "{name}".', { name: this.selectedLayer }),
      this.i18n.translate('Capa'),
    );
  }

  removeSelectedFromLayer(): void {
    if (!this.selectedObjectId) return;
    this.threeEngine.removeFromLayer(this.selectedObjectId);
    this.notifications.info(this.i18n.translate('Objeto retirado de su capa.'), this.i18n.translate('Capa'));
  }

  // --- Snap a grid ---

  toggleSnapToGrid(): void {
    this.snapEnabled = !this.snapEnabled;
    this.threeEngine.setSnapToGrid(this.snapEnabled, this.threeEngine.gridStep);
    this.notifications.info(
      this.snapEnabled
        ? this.i18n.translate('Snap a grid activado.')
        : this.i18n.translate('Snap a grid desactivado.'),
      this.i18n.translate('Cuadrícula'),
    );
  }

  applySnapToGrid(): void {
    this.threeEngine.applySnapToGrid();
    this.notifications.success(this.i18n.translate('Posición ajustada a la cuadrícula.'), this.i18n.translate('Snap'));
  }

  // --- Compartir escena (colaboración) ---

  shareScene(): void {
    const title = prompt(this.i18n.translate('Título de la escena:'), this.i18n.translate('Mi escena 3D'));
    if (!title) return;
    const description = prompt(this.i18n.translate('Descripción (opcional):'), '');
    const userSub = this.auth.user$.subscribe((user) => {
      if (!user) {
        this.notifications.warning(this.i18n.translate('Inicia sesión para compartir la escena.'));
        userSub.unsubscribe();
        return;
      }
      const payload = this.threeEngine.exportSceneWithMetadata({
        title,
        description: description ?? '',
        authorId: user.uid,
        authorName: user.displayName,
      });
      if (!isPlatformBrowser(this.platformId)) {
        userSub.unsubscribe();
        return;
      }
      void navigator.clipboard.writeText(payload).then(() => {
        this.notifications.success(
          this.i18n.translate('Escena copiada al portapapeles. Comparte este código con otro creador.'),
          this.i18n.translate('Escena compartida'),
        );
        userSub.unsubscribe();
      }, () => {
        this.notifications.error(this.i18n.translate('No se pudo acceder al portapapeles.'), this.i18n.translate('Compartir'));
        userSub.unsubscribe();
      });
    });
    this.subscriptions.add(userSub);
  }

  importSharedScene(event: Event): void {
    const input = event.target as HTMLInputElement;
    const text = input.value;
    input.value = '';
    if (!text.trim()) return;
    this.applySharedSceneCode(text);
  }

  importSharedScenePrompt(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const text = prompt(this.i18n.translate('Pega el código de la escena compartida:'));
    if (!text) return;
    this.applySharedSceneCode(text);
  }

  private applySharedSceneCode(text: string): void {
    const parsed = this.threeEngine.importSceneWithMetadata(text);
    if (!parsed) {
      this.notifications.warning(this.i18n.translate('Código de escena inválido.'));
      return;
    }
    const ok = this.threeEngine.restoreScene(parsed.scene as string);
    if (ok) {
      this.notifications.success(
        this.i18n.translate('Escena importada correctamente.'),
        this.i18n.translate('Importar escena'),
      );
    } else {
      this.notifications.error(
        this.i18n.translate('No se pudo restaurar la escena.'),
        this.i18n.translate('Importar escena'),
      );
    }
  }

  // ========================================================================
  // COLABORACIÓN EN TIEMPO REAL
  // ========================================================================

  async joinCollaboration(): Promise<void> {
    const user = await firstValueFrom(this.auth.user$.pipe(take(1)));
    if (!user) return;
    this.threeEngine.joinCollaboration(user.uid, user.displayName);
    this.collaborators = this.threeEngine.getCollaborators();
    this.cdr.detectChanges();
  }

  leaveCollaboration(): void {
    const user = this.auth;
    // Obtener el uid del usuario actual de forma síncrona es complejo con AuthService,
    // así que dejamos que la limpieza se haga al destruir el componente.
  }

  async lockObject(objectId: string): Promise<void> {
    if (!this.projectId) return;
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;
    const ok = await this.collaboration.lockObject(this.projectId, objectId, uid);
    if (!ok) {
      this.notifications.warning(this.i18n.translate('projects.objectAlreadyLocked'), this.i18n.translate('projects.objectLocked'));
    } else {
      this.threeEngine.lockObject(objectId, uid);
    }
  }

  async unlockObject(objectId: string): Promise<void> {
    if (!this.projectId) return;
    await this.collaboration.unlockObject(this.projectId, objectId);
    this.threeEngine.unlockObject(objectId);
  }

  isObjectEditable(objectId: string): boolean {
    if (!this.projectId) return true;
    const uid = this.auth.currentUser?.uid;
    return !this.threeEngine.isObjectLockedByOther(objectId, uid ?? '');
  }

  private async registerOwnPresence(user: { uid: string; displayName: string; photoURL: string | null }): Promise<void> {
    if (!this.projectId) return;
    await this.collaboration.setPresence(
      this.projectId,
      user.uid,
      user.displayName,
      user.photoURL ?? null,
      true,
      null,
      this.ownCursorX,
      this.ownCursorY,
      this.ownTransform
    );
  }

  private async updateOwnPresence(objectId?: string | null): Promise<void> {
    if (!this.projectId) return;
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;
    try {
      await this.collaboration.setPresence(
        this.projectId,
        uid,
        this.auth.currentUser?.displayName ?? 'Colaborador',
        this.auth.currentUser?.photoURL ?? null,
        true,
        objectId ?? this.threeEngine.getSelectedNodeId() ?? null,
        this.ownCursorX,
        this.ownCursorY,
        this.ownTransform
      );
    } catch {
      // presencia best-effort
    }
  }

  toggleCollaborationPanel(): void {
    this.collaborationOpen = !this.collaborationOpen;
  }

  openProjectDetails(): void {
    if (!this.projectId) return;
    void this.router.navigate(['/projects', this.projectId]);
  }

  async copyProjectLink(): Promise<void> {
    if (!this.projectId || !isPlatformBrowser(this.platformId)) return;
    const url = `${window.location.origin}/projects/${encodeURIComponent(this.projectId)}`;
    try {
      await navigator.clipboard.writeText(url);
      this.notifications.success(this.i18n.translate('projects.shareCopied'), this.i18n.translate('projects.shareTitle'));
    } catch {
      this.notifications.error(this.i18n.translate('projects.shareError'));
    }
  }

  ngOnDestroy(): void {
    if (isPlatformBrowser(this.platformId)) {
      if (this.projectId) {
        void this.collaboration.saveProjectScene(this.projectId, this.threeEngine.serializeScene());
        const user = this.auth.currentUser?.uid;
        if (user) {
          void this.collaboration.clearPresence(this.projectId, user);
        }
      } else {
        this.localState.saveDraft(this.threeEngine.serializeScene());
      }
    }
    if (this.presenceHeartbeat) {
      clearInterval(this.presenceHeartbeat);
      this.presenceHeartbeat = null;
    }
    if (this.transformLockTimer) {
      clearTimeout(this.transformLockTimer);
      this.transformLockTimer = null;
    }
    this.autoSaveSub?.unsubscribe();
    this.projectLockSub?.unsubscribe();
    this.remoteSceneSub?.unsubscribe();
    this.remoteCursorSub?.unsubscribe();
    this.remoteSelectionSub?.unsubscribe();
    this.remoteJoinedSub?.unsubscribe();
    this.remoteLeftSub?.unsubscribe();
    this.presenceSub?.unsubscribe();
    this.subscriptions.unsubscribe();
    void this.audioReactive.stop();
  }
}
