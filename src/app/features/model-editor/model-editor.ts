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
  signal,
} from '@angular/core';
import { PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, DOCUMENT } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { interval, Subscription, Subject, firstValueFrom, take, catchError, map, of } from 'rxjs';
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
import { absoluteAppUrl, copyText } from '../../core/utils/share';
import type { ProjectShareLink } from '../../core/models/social.models';
import { EditorStatusService } from '../../core/services/editor-status.service';
import { LayersPanelComponent } from './layers-panel/layers-panel';
import type { NotificationPosition, ProjectActivity, ProjectPresence, PresenceTransform, ProjectMember, ProjectRole } from '../../core/models/social.models';
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

interface CameraBookmark {
  id: string;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  createdAt: number;
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
  public scaleX = 1;
  public scaleY = 1;
  public scaleZ = 1;
  public renameValue = '';
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
  private readonly document = inject(DOCUMENT);
  private readonly editorStatus = inject(EditorStatusService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** Última posición conocida del cursor propio en pantalla (0-100 %). */
  private ownCursorX = -1;
  private ownCursorY = -1;
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
  public savedViews: CameraBookmark[] = [];
  public snapEnabled = false;

  public collaborationOpen = false;
  public showShortcutsHelp = false;
  private saveResetTimer: ReturnType<typeof setTimeout> | null = null;
  public collaborators: Array<{ uid: string; displayName: string; color: string; objectId: string | null }> = [];
  public remoteCursors: Map<string, RemoteCursor> = new Map();
  public remoteSelections: Map<string, string | null> = new Map();
  public myCursor = { x: 0.5, y: 0.5 };

  public projectId: string | null = null;
  public projectName = '';
  public projectSceneLoaded = false;
  public canWrite = false;
  public isProjectOwner = false;
  public projectMembers: ProjectMember[] = [];
  public remotePresences: ProjectPresence[] = [];
  public shareToken: string | null = null;
  public shareAccessRole: ProjectRole | null = null;
  private memberCanWrite = false;
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
      this.refreshLightPanel();
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
    const share = this.route.snapshot.queryParamMap.get('share');
    this.shareToken = share;
    const initialProject = qp ?? null;

    // El editor y su motor son instancias en memoria: el contenido de la
    // escena NO sobrevive a un cambio de ?project sin destruir/recrear el
    // componente. Si la ruta cambia a otro proyecto (p.ej. el usuario abre
    // un proyecto distinto desde el panel en el mismo tab) y el componente
    // se reutiliza sin re-crear, el motor se quedaría mostrando la escena
    // ANTERIOR al proyecto nuevo. Rebaseamos con recarga completa. Solo se
    // compara contra el valor capturado al montar el componente.
    this.subscriptions.add(
      this.route.queryParamMap.subscribe((params) => {
        if ((params.get('project') ?? null) !== initialProject) {
          window.location.reload();
        }
      }),
    );

    if (qp) {
      // Suprimir el cubo de arranque: cada cliente plantaba el suyo al abrir
      // un proyecto compartido y las escenas divergían (los remotos nunca se
      // veían y la sincronía nunca funcionaba). La escena se siembra en local
      // o carga desde Firestore; aquí nunca debe sembrarse una caja extra.
      this.threeEngine.skipStarterScene = true;
      this.projectId = qp;

      this.subscriptions.add(
        this.collaboration.getProject(this.projectId).subscribe((project) => {
          this.projectName = project?.name ?? '';
          this.cdr.detectChanges();
        })
      );

      // La carga inicial debe leer SIEMPRE desde el servidor: la primera
      // emisión del listener puede servir contenido obsoleto de la caché
      // local, y el autosave lo re-escribiría sobre el proyecto.
      this.collaboration.getProjectSceneOnce(this.projectId).pipe(take(1)).subscribe((sceneJson) => {
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
          this.projectMembers = members;
          const member = uid ? members.find((m) => m.userId === uid) : undefined;
          this.isProjectOwner = member?.role === 'owner';
          this.memberCanWrite = hasPermission(member?.role ?? 'viewer', 'write');
          this.applyEffectiveAccess();
          this.cdr.detectChanges();
        })
      );

      if (this.shareToken) {
        void this.resolveShareAccess(this.shareToken);
      }

      // Auto-guardar escena en el proyecto al cambiar (debounced), solo cambios locales
      this.autoSaveSub = merge(this.threeEngine.sceneChanged$, this.threeEngine.transformChanged$)
        .pipe(debounceTime(400))
        .subscribe(() => {
          if (!this.projectId || this.isApplyingRemote || !this.canWrite) return;
          const json = this.threeEngine.serializeScene();
          this.lastLocalSceneSaveAt = Date.now();
          this.saveProjectScene(this.projectId, json);
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
        this.editorStatus.onlineCount.set(this.remotePresences.length + 1);
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
        this.refreshLightPanel();
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
        this.threeEngine.setRemoteSelectionMarker(sel.uid, sel.objectId, this.colorForUid(sel.uid));
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
        this.threeEngine.clearRemoteSelectionMarker(uid);
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

      // Toasts de presencia: quién se une y quién se va del proyecto
      this.subscriptions.add(
        this.threeEngine.collaboratorJoined$.subscribe((collab) => {
          if (collab.uid === this.auth.currentUser?.uid) return;
          this.notifications.info(
            this.i18n.translate('collab.joined', { name: collab.displayName }),
            this.i18n.translate('collab.title'),
          );
        }),
      );
      this.subscriptions.add(
        this.threeEngine.collaboratorLeft$.subscribe((uid) => {
          const memberName = this.projectMembers.find((m) => m.userId === uid)?.userName
            ?? this.remotePresences.find((p) => p.uid === uid)?.displayName
            ?? 'Alguien';
          this.notifications.info(
            this.i18n.translate('collab.left', { name: memberName }),
            this.i18n.translate('collab.title'),
          );
        }),
      );
    } else {
      // Sin proyecto: guardar en borrador local como antes
      this.subscriptions.add(
        merge(this.threeEngine.sceneChanged$, this.threeEngine.transformChanged$)
          .pipe(auditTime(800))
          .subscribe(() => {
            this.editorStatus.saveState.set('saving');
            this.localState.saveDraft(this.threeEngine.serializeScene());
            this.markSaved();
          }),
      );
      this.sceneObjects = this.threeEngine.getSceneObjects();
      this.selectedObjectId = this.threeEngine.getSceneObjects().at(-1)?.id ?? '';
      this.updateSelectionState();
      this.refreshSceneNodes();
      this.loadMaterialsFromEngine();
      this.applyAppearance();
      this.editorStatus.onlineCount.set(null);
    }

    // La biblioteca de assets es transversal a proyectos: se carga una vez
    void this.loadAssets();

    // Soporte de acciones rápidas desde la paleta de comandos (?action=...)
    this.subscriptions.add(
      this.route.queryParamMap.subscribe((params) => {
        const action = params.get('action');
        if (!action) return;
        switch (action) {
          case 'undo': this.undo(); break;
          case 'redo': this.redo(); break;
          case 'save': this.manualSave(); break;
          case 'capture': this.captureScreenshot(); break;
          case 'duplicate': this.duplicateSelectedObject(); break;
          case 'present': this.togglePresentation(); break;
          case 'gizmo-translate': this.setGizmoMode('translate'); break;
          case 'gizmo-rotate': this.setGizmoMode('rotate'); break;
          case 'gizmo-scale': this.setGizmoMode('scale'); break;
        }
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { action: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }),
    );
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
    if (this.shareLinkBlocksEditing) return;
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

  selectObject(id: string, event?: MouseEvent): void {
    const additive = !!event && (event.ctrlKey || event.metaKey);
    this.threeEngine.selectObject(id, additive);
  }

  selectNode(id: string): void {
    this.threeEngine.selectNode(id);
  }

  toggleNodeVisibility(node: SceneNode, event: Event): void {
    event.stopPropagation();
    this.threeEngine.setNodeVisibility(node.id, !node.visible);
    node.visible = !node.visible;
  }

  // --- Filtro de la lista de objetos (búsqueda + altura acotada) ---
  public objectSearchTerm = '';

  get filteredSceneObjects(): readonly SceneObject[] {
    const query = this.objectSearchTerm.trim().toLocaleLowerCase();
    if (!query) return this.sceneObjects;
    return this.sceneObjects.filter((item) =>
      item.name.toLocaleLowerCase().includes(query),
    );
  }

  get filteredSceneNodes(): SceneNode[] {
    const query = this.searchTerm.trim().toLocaleLowerCase();
    return query
      ? this.sceneNodes.filter((node) => node.name.toLocaleLowerCase().includes(query))
      : this.sceneNodes;
  }

  deleteSelectedObject(): void {
    if (this.shareLinkBlocksEditing) return;
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
    this.scaleX = model ? Number(model.scale.x.toFixed(2)) : 1;
    this.scaleY = model ? Number(model.scale.y.toFixed(2)) : 1;
    this.scaleZ = model ? Number(model.scale.z.toFixed(2)) : 1;
    this.renameValue = this.threeEngine.getSceneObjects().find((o) => o.id === this.selectedObjectId)?.name ?? '';
    this.cdr.detectChanges();
  }

  // --- MÉTODOS DE TRANSFORMACIÓN ---

  onScaleChange(): void {
    if (this.shareLinkBlocksEditing) return;
    this.threeEngine.updateScale(this.scale);
  }

  onScaleAxisChange(axis: 'x' | 'y' | 'z', value: number): void {
    if (this.shareLinkBlocksEditing) return;
    this.threeEngine.updateScaleAxis(axis, Number(value));
  }

  onRenameChange(value: string): void {
    if (this.shareLinkBlocksEditing) return;
    if (!this.selectedObjectId) return;
    this.threeEngine.renameObject(this.selectedObjectId, value);
  }

  onPositionChange(axis: 'x' | 'y' | 'z', value: number): void {
    if (this.shareLinkBlocksEditing) return;
    this.threeEngine.updatePosition(axis, value);
  }

  onRotationChange(axis: 'x' | 'y' | 'z', value: number): void {
    if (this.shareLinkBlocksEditing) return;
    this.threeEngine.updateRotation(axis, value);
  }

  onBgColorChange(): void {
    this.threeEngine.updateBackgroundColor(this.bgColor);
    this.persistPreferences();
  }

  // --- Vacíos y agrupación ---
  public quality: 'draft' | 'standard' | 'cinematic' = 'standard';

  public selectedCount(): number {
    return this.threeEngine.getSelectedObjects().length;
  }

  public canGroupSelected(): boolean {
    return !this.shareLinkBlocksEditing && this.selectedCount() >= 2;
  }

  public canUngroupSelected(): boolean {
    if (this.shareLinkBlocksEditing) return false;
    const id = this.selectedObjectId;
    if (!id) return false;
    return this.threeEngine.getGroupObjectInfo(id)?.isEmpty === true;
  }

  addEmpty(): void {
    if (this.shareLinkBlocksEditing) return;
    this.threeEngine.addEmpty();
  }

  groupSelected(): void {
    if (this.shareLinkBlocksEditing) return;
    const locked = this.threeEngine.getSelectedObjects().some(
      (item) => !this.isObjectEditable(item.id),
    );
    if (locked) {
      this.notifications.warning(this.i18n.translate('Hay objetos bloqueados por otro colaborador.'));
      return;
    }
    this.threeEngine.groupSelection();
  }

  ungroupSelected(): void {
    if (this.shareLinkBlocksEditing) return;
    if (!this.canUngroupSelected()) return;
    this.threeEngine.ungroupSelection();
  }

  setQuality(preset: 'draft' | 'standard' | 'cinematic'): void {
    if (this.shareLinkBlocksEditing) return;
    this.quality = preset;
    this.threeEngine.applyQualityPreset(preset);
    this.cdr.detectChanges();
  }

  // --- Biblioteca de assets ---
  public assetLibraryBusy = false;
  public assetLibraryError = '';
  public assetNameDraft = '';
  public assets: { id: string; name: string; createdAt: number }[] = [];

  async loadAssets(): Promise<void> {
    this.assetLibraryError = '';
    try {
      this.assets = await this.collaboration.listAssets();
    } catch (error) {
      console.warn('No se pudo listar la biblioteca de assets.', error);
      this.assetLibraryError = 'No se pudo cargar la biblioteca.';
      this.assets = [];
    }
    this.cdr.detectChanges();
  }

  async saveSelectedAsAsset(): Promise<void> {
    if (this.shareLinkBlocksEditing) return;
    const selected = this.threeEngine.getSelectedObjects();
    if (selected.length === 0) {
      this.notifications.warning(this.i18n.translate('Selecciona uno o más objetos para guardarlos.'));
      return;
    }
    const suggested = selected.length === 1 ? selected[0].name : `Grupo de ${selected.length} objetos`;
    const name = (this.assetNameDraft.trim() || suggested).slice(0, 80);
    const json = this.threeEngine.exportSelectionObjectsJSON();
    if (!json) {
      this.notifications.error(this.i18n.translate('No se pudo exportar la selección.'));
      return;
    }
    this.assetLibraryBusy = true;
    try {
      await this.collaboration.saveAsset(name, json);
      this.notifications.success(this.i18n.translate('Asset guardado en tu biblioteca.'), this.i18n.translate('Biblioteca'));
      this.assetNameDraft = '';
      await this.loadAssets();
    } catch (error) {
      console.warn('No se pudo guardar el asset.', error);
      this.notifications.error(this.i18n.translate('No se pudo guardar el asset. Revisa tu conexión.'));
    } finally {
      this.assetLibraryBusy = false;
      this.cdr.detectChanges();
    }
  }

  async insertAsset(assetId: string): Promise<void> {
    this.assetLibraryBusy = true;
    this.assetLibraryError = '';
    try {
      const json = await this.collaboration.getAssetJSON(assetId);
      if (!json) {
        this.notifications.error(this.i18n.translate('No se pudo leer el asset.'));
        return;
      }
      const ok = this.threeEngine.insertObjectsJSON(json);
      if (!ok) {
        this.notifications.error(this.i18n.translate('El asset no contiene objetos válidos.'));
        return;
      }
      this.refreshSceneNodes();
      this.sceneObjects = this.threeEngine.getSceneObjects();
      this.cdr.detectChanges();
      this.notifications.success(this.i18n.translate('Asset insertado en la escena.'), this.i18n.translate('Biblioteca'));
    } catch (error) {
      console.warn('No se pudo insertar el asset.', error);
      this.assetLibraryError = 'No se pudo insertar el asset.';
    } finally {
      this.assetLibraryBusy = false;
      this.cdr.detectChanges();
    }
  }

  async deleteAsset(assetId: string): Promise<void> {
    if (this.shareLinkBlocksEditing) return;
    this.assetLibraryBusy = true;
    try {
      await this.collaboration.deleteAsset(assetId);
      this.assets = this.assets.filter((asset) => asset.id !== assetId);
      this.notifications.success(this.i18n.translate('Asset eliminado.'), this.i18n.translate('Biblioteca'));
    } catch (error) {
      console.warn('No se pudo borrar el asset.', error);
      this.notifications.error(this.i18n.translate('No se pudo borrar el asset.'));
    } finally {
      this.assetLibraryBusy = false;
      this.cdr.detectChanges();
    }
  }

  captureThumbnailPNG(): void {
    const image = this.threeEngine.captureImageDataUrl();
    if (!image) {
      this.notifications.warning(this.i18n.translate('No se pudo capturar la vista actual.'));
      return;
    }
    const safe = (this.projectName || 'carxy-miniatura').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'carxy-miniatura';
    const link = document.createElement('a');
    link.href = image;
    link.download = `${safe}-miniatura.png`;
    link.click();
    this.notifications.success(this.i18n.translate('Miniatura PNG descargada.'), this.i18n.translate('Exportar'));
  }

  formatAssetDate(timestamp: number): string {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  onExportGLB(): void {
    this.exportSceneGLB();
  }

  // --- MÉTODOS DE MATERIALES ---

  // --- LUCES DE ESCENA ---
  public selectedLight: {
    kind: string;
    name: string;
    color: string;
    intensity: number;
    distance: number;
    decay: number;
    angle: number | null;
    penumbra: number | null;
  } | null = null;

  addLight(kind: 'point' | 'spot' | 'directional'): void {
    if (this.shareLinkBlocksEditing) return;
    this.threeEngine.addLightPrimitive(kind);
  }

  refreshLightPanel(): void {
    this.selectedLight = this.threeEngine.getSelectedLightInfo();
    this.cdr.detectChanges();
  }

  onLightColorChange(hex: string): void {
    if (this.shareLinkBlocksEditing) return;
    this.threeEngine.updateLightColor(hex);
    this.refreshLightPanel();
  }

  onLightPropertyChange(
    property: 'intensity' | 'distance' | 'decay' | 'angle' | 'penumbra',
    value: number,
  ): void {
    if (this.shareLinkBlocksEditing) return;
    this.threeEngine.updateLightProperty(property, value);
  }

  onMaterialColorChange(uuid: string, newColor: string): void {
    if (this.shareLinkBlocksEditing) return;
    this.threeEngine.updateMaterialColor(uuid, newColor);
  }

  onMaterialEmissiveChange(uuid: string, newColor: string): void {
    if (this.shareLinkBlocksEditing) return;
    this.threeEngine.updateMaterialEmissive(uuid, newColor);
  }

  onMaterialPropertyChange(
    uuid: string,
    property: 'roughness' | 'metalness' | 'opacity' | 'emissiveIntensity',
    value: number,
  ): void {
    if (this.shareLinkBlocksEditing) return;
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
    if (this.shareLinkBlocksEditing) return;
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
    copyText(payload).then(() => {
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
        this.i18n.firebaseError(error, 'No se pudo exportar la escena.'),
        this.i18n.translate('Exportar'),
      );
    } finally {
      this.exportBusy = false;
    }
  }

  async importSceneFile(event: Event): Promise<void> {
    if (this.shareLinkBlocksEditing) return;
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
        this.i18n.firebaseError(error, 'No se pudo importar el modelo.'),
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
        this.i18n.firebaseError(error, 'No se pudo grabar el video.'),
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
    const mod = event.ctrlKey || event.metaKey;
    const ro = this.shareLinkBlocksEditing;
    if (key === 'z' && mod && !event.shiftKey) { event.preventDefault(); if (!ro) this.undo(); }
    else if (key === 'y' && mod && !event.shiftKey) { event.preventDefault(); if (!ro) this.redo(); }
    else if (key === 'z' && mod && event.shiftKey) { event.preventDefault(); if (!ro) this.redo(); }
    else if (key === 's' && mod) { event.preventDefault(); if (!ro) this.manualSave(); }
    else if (key === '?' || (key === '/' && event.shiftKey)) { event.preventDefault(); this.showShortcutsHelp = !this.showShortcutsHelp; }
    else if (key === 'escape' && this.showShortcutsHelp) { event.preventDefault(); this.showShortcutsHelp = false; }
    else if (key === 'g') { event.preventDefault(); this.setGizmoMode('translate'); }
    else if (key === 'r') { event.preventDefault(); this.setGizmoMode('rotate'); }
    else if (key === 's' && !mod) { event.preventDefault(); this.setGizmoMode('scale'); }
    else if (key === 'delete' || key === 'backspace') { event.preventDefault(); if (!ro) this.deleteSelectedObject(); }
    else if (key === 'c' && mod) { event.preventDefault(); this.copySelectedToClipboard(); }
    else if (key === 'v' && mod) { event.preventDefault(); if (!ro) this.pasteFromClipboard(); }
    else if (key === 'd' && mod) { event.preventDefault(); if (!ro) this.duplicateSelectedObject(); }
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
      copyText(payload).then(() => {
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

  get selfUid(): string | null {
    return this.auth.currentUser?.uid ?? null;
  }

  get selfPhotoURL(): string | null {
    return this.auth.currentUser?.photoURL ?? null;
  }

  get selfName(): string {
    return this.auth.currentUser?.displayName ?? '';
  }

  get selfRole(): ProjectRole {
    if (this.isProjectOwner) return 'owner';
    return this.canWrite ? 'editor' : 'viewer';
  }

  get selfRoleLabel(): string {
    return 'projects.role' + (this.selfRole.charAt(0).toUpperCase() + this.selfRole.slice(1));
  }

  get onlineMembers(): ProjectMember[] {
    return this.projectMembers.filter((member) =>
      this.remotePresences.some((p) => p.uid === member.userId),
    );
  }

  get otherMembers(): ProjectMember[] {
    const uid = this.selfUid;
    return this.projectMembers.filter((member) => member.userId !== uid);
  }

  get totalMembers(): number {
    return this.projectMembers.length;
  }

  get onlineCount(): number {
    // Remota + tú mismo (siempre en línea mientras trabajas con proyecto abierto)
    return this.onlineMembers.length + 1;
  }

  memberPresence(member: ProjectMember): ProjectPresence | undefined {
    return this.remotePresences.find((p) => p.uid === member.userId);
  }

  isMemberOnline(member: ProjectMember): boolean {
    return !!this.memberPresence(member);
  }

  memberEditingName(member: ProjectMember): string | null {
    const presence = this.memberPresence(member);
    if (!presence?.currentObjectId) return null;
    const match = this.sceneObjects.find((o) => o.id === presence.currentObjectId);
    return match?.name ?? null;
  }

  memberRoleLabel(role: ProjectRole): string {
    return 'projects.role' + (role.charAt(0).toUpperCase() + role.slice(1));
  }

  readonly busyMemberRoleId = signal<string | null>(null);

  async onMemberRoleChange(member: ProjectMember, event: Event): Promise<void> {
    if (!this.projectId || !this.isProjectOwner) return;
    const target = event.target as HTMLSelectElement;
    const role = target.value as ProjectRole;
    if (role === 'owner' || role === 'editor' || role === 'viewer') {
      if (role === member.role || this.busyMemberRoleId() !== null) {
        target.value = member.role;
        return;
      }
      this.busyMemberRoleId.set(member.id);
      this.cdr.detectChanges();
      try {
        await this.collaboration.updateMemberRole(this.projectId, member.id, role);
        this.notifications.success(this.i18n.translate('projects.roleUpdated'));
      } catch (error) {
        target.value = member.role;
        this.notifications.error(this.i18n.firebaseError(error, 'No se pudo cambiar el rol.'));
      } finally {
        this.busyMemberRoleId.set(null);
        this.cdr.detectChanges();
      }
      return;
    }
    target.value = member.role;
  }

  useFallbackAvatar(event: Event): void {
    const image = event.target as HTMLImageElement | null;
    if (image) image.src = 'user-avatar.svg';
  }

  avatarInitial(name?: string): string {
    const trimmed = (name ?? '').trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
  }

  colorForUid(uid: string): string {
    const colors = ['#8b5cf6', '#38bdf8', '#f59e0b', '#34d399', '#fb923c', '#a78bfa', '#f472b6', '#60a5fa'];
    let hash = 0;
    for (let i = 0; i < uid.length; i++) {
      hash = (hash << 5) - hash + uid.charCodeAt(i);
      hash |= 0;
    }
    return colors[Math.abs(hash) % colors.length];
  }

  openProjectDetails(): void {
    if (!this.projectId) return;
    void this.router.navigate(['/projects', this.projectId]);
  }

  async copyProjectLink(): Promise<void> {
    if (!this.projectId || !isPlatformBrowser(this.platformId)) return;
    try {
      // Si el proyecto tiene un enlace de acceso activo, copiamos ESE: es el
      // único enlace que funciona para quien NO es miembro (abre como visor o
      // editor según el enlace). Sin enlace activo, copiamos la URL del
      // proyecto (útil para miembros que ya tienen acceso).
      const shareLink = await firstValueFrom(
        this.collaboration.getShareLinks(this.projectId).pipe(
          map((links) => links.find((link) => link.enabled) ?? null),
          catchError(() => of(null)),
          take(1),
        ),
      );
      const url = shareLink
        ? absoluteAppUrl(`editor?project=${encodeURIComponent(this.projectId)}&share=${encodeURIComponent(shareLink.id)}`, this.document.baseURI)
        : absoluteAppUrl(`projects/${encodeURIComponent(this.projectId)}`, this.document.baseURI);
      await copyText(url);
      this.notifications.success(this.i18n.translate('projects.shareCopied'), this.i18n.translate('projects.shareTitle'));
    } catch {
      this.notifications.error(this.i18n.translate('projects.shareError'));
    }
  }

  private async resolveShareAccess(token: string): Promise<void> {
    try {
      let link = await this.collaboration.resolveShareLink(token);
      if (!link || (this.projectId && link.projectId !== this.projectId)) {
        this.shareAccessRole = null;
        if (token) {
          this.notifications.warning(this.i18n.translate('El enlace de acceso no es válido o fue desactivado.'));
        }
        this.applyEffectiveAccess();
        this.cdr.detectChanges();
        return;
      }

      const uid = this.auth.currentUser?.uid ?? null;
      const wasMember = !!uid && this.projectMembers.some((m) => m.userId === uid);
      let joinedNow = false;

      // Intenta unirse al proyecto con el rol del enlace para obtener acceso real en Firestore.
      if (uid) {
        try {
          const joined = await this.collaboration.joinViaShareLink(token);
          if (joined) {
            link = joined;
            joinedNow = !wasMember;
          }
        } catch {
          // Sin permisos/reglas antiguas o sin sesión válida: seguimos con acceso por enlace best-effort.
        }
      }

      this.shareAccessRole = link.role;
      const roleLabel = link.role === 'editor'
        ? this.i18n.translate('projects.roleEditor')
        : this.i18n.translate('projects.roleViewer');
      this.notifications.info(this.i18n.translate('Acceso por enlace: {role}', { role: roleLabel }));

      this.applyEffectiveAccess();
      this.cdr.detectChanges();

      // Si acabamos de unirnos por enlace, recarga para reabrir listeners/lecturas con permisos de miembro.
      if (joinedNow && isPlatformBrowser(this.platformId)) {
        window.setTimeout(() => window.location.reload(), 400);
      }
    } catch {
      this.shareAccessRole = null;
      this.applyEffectiveAccess();
    }
  }

  private applyEffectiveAccess(): void {
    if (this.shareAccessRole) {
      // Un enlace de lectura fuerza sesión de solo lectura aunque el usuario sea editor/miembro.
      // Un enlace de diseño permite editar si el usuario tiene (o acaba de obtener) permisos de escritura.
      this.canWrite = this.shareAccessRole === 'editor' ? this.memberCanWrite : false;
    } else {
      this.canWrite = this.memberCanWrite;
    }
  }

  get readOnlyByShareLink(): boolean {
    return this.shareAccessRole === 'viewer';
  }

  get shareLinkBlocksEditing(): boolean {
    return !!this.projectId && !!this.shareAccessRole && !this.canWrite;
  }

  private saveProjectScene(projectId: string, sceneJson: string): void {
    if (!this.canWrite) return;
    this.editorStatus.saveState.set('saving');
    void this.collaboration.saveProjectScene(projectId, sceneJson)
      .then(() => this.markSaved())
      .catch(() => this.editorStatus.saveState.set('error'));
  }

  private markSaved(): void {
    this.editorStatus.lastSavedAt.set(Date.now());
    this.editorStatus.saveState.set('saved');
    if (this.saveResetTimer) clearTimeout(this.saveResetTimer);
    this.saveResetTimer = setTimeout(() => {
      if (this.editorStatus.saveState() === 'saved') {
        this.editorStatus.saveState.set('idle');
      }
      this.saveResetTimer = null;
    }, 4000);
  }

  private manualSave(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const json = this.threeEngine.serializeScene();
    this.editorStatus.saveState.set('saving');
    if (this.projectId) {
      this.lastLocalSceneSaveAt = Date.now();
      this.saveProjectScene(this.projectId, json);
      this.notifications.success(this.i18n.translate('Escena guardada.'), this.i18n.translate('Guardado'));
    } else {
      this.localState.saveDraft(json);
      this.markSaved();
      this.notifications.success(this.i18n.translate('Borrador guardado.'), this.i18n.translate('Guardado'));
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
    if (this.saveResetTimer) {
      clearTimeout(this.saveResetTimer);
      this.saveResetTimer = null;
    }
    this.editorStatus.onlineCount.set(null);
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
