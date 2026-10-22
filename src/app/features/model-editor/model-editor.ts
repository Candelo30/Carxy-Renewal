// src/app/features/model-editor/model-editor.component.ts
import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  EventEmitter,
  Output,
  inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { interval, Subscription } from 'rxjs';
import { auditTime, merge } from 'rxjs';
import { ThreeEngineService } from '../../core/services/three-engine';
import { AudioReactiveService } from '../../core/services/audio-reactive';
import { LocalStateService } from '../../core/services/local-state';
import { NotificationService } from '../../core/services/notifications';
import type { NotificationPosition } from '../../core/models/social.models';
import type {
  EditableMaterial,
  PrimitiveType,
  SceneNode,
  SceneObject,
  ViewportHotspot,
} from '../../core/services/three-engine';
import * as THREE from 'three';

@Component({
  selector: 'app-model-editor',
  standalone: true,
  imports: [FormsModule, CommonModule],
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
  public theme: 'dark' | 'light' = 'dark';
  public accentColor = '#8b5cf6';
  public language: 'es' | 'en' = 'es';
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
  @Output() languageChange = new EventEmitter<'es' | 'en'>();
  private subscriptions = new Subscription();
  private readonly platformId = inject(PLATFORM_ID);
  private readonly localState = inject(LocalStateService);
  private readonly notifications = inject(NotificationService);

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
    }));
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
    this.language = preferences.language;
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
    this.threeEngine.addPrimitive(type);
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
    this.threeEngine.deleteCurrentModel();
  }

  applyAppearance(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    document.documentElement.dataset['theme'] = this.theme;
    document.documentElement.style.setProperty('--accent-color', this.accentColor);
    this.persistPreferences();
  }

  setTheme(theme: 'dark' | 'light'): void {
    this.theme = theme;
    this.applyAppearance();
  }

  setLanguage(language: 'es' | 'en'): void {
    this.language = language;
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

  // [FALTABA ESTE MÉTODO]
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
      this.audioStatus = `Reproduciendo: ${file.name}`;
      this.notifications.success(`Reproduciendo ${file.name}.`, 'Audio activado');
    } catch (error) {
      console.error('No se pudo reproducir el archivo de audio.', error);
      await this.audioReactive.stop();
      this.audioStatus = 'No se pudo abrir el audio. Revisa el formato del archivo.';
      this.notifications.error(this.audioStatus, 'No se pudo abrir el audio');
    }
  }

  async startMicrophone(): Promise<void> {
    try {
      await this.audioReactive.startMicrophone();
      this.audioEnabled = true;
      this.threeEngine.setAudioReactive(true);
      this.audioStatus = 'Micrófono activo';
      this.notifications.info('La escena responderá al sonido del micrófono.');
    } catch (error) {
      console.error('No se pudo iniciar el micrófono.', error);
      await this.audioReactive.stop();
      this.audioStatus = 'No se pudo acceder al micrófono. Revisa permisos y conexión segura.';
      this.notifications.warning(this.audioStatus, 'Micrófono no disponible');
    }
  }

  async stopAudio(): Promise<void> {
    await this.audioReactive.stop();
    this.audioEnabled = false;
    this.threeEngine.setAudioReactive(false);
    this.threeEngine.setAudioLevels(0, 0);
    this.audioStatus = 'Audio detenido';
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

  ngOnDestroy(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.localState.saveDraft(this.threeEngine.serializeScene());
    }
    this.subscriptions.unsubscribe();
    void this.audioReactive.stop();
  }
}
