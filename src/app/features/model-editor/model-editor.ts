// src/app/features/model-editor/model-editor.component.ts
import {
  Component,
  HostListener,
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
import { interval, Subscription, firstValueFrom, take } from 'rxjs';
import { auditTime, merge } from 'rxjs';
import { ThreeEngineService } from '../../core/services/three-engine';
import { AudioReactiveService } from '../../core/services/audio-reactive';
import { LocalStateService } from '../../core/services/local-state';
import { NotificationService } from '../../core/services/notifications';
import { AuthService } from '../../core/services/auth';
import { FileHandler } from '../../core/services/file-handler';
import { EditorHistoryService } from '../../core/services/editor-history';
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
  private readonly auth = inject(AuthService);
  private readonly fileHandler = inject(FileHandler);
  private readonly editorHistory = inject(EditorHistoryService);

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
  public snapEnabled = false;

  public collaborationOpen = false;
  public collaborators: Array<{ uid: string; displayName: string; color: string; objectId: string | null }> = [];
  public myCursor = { x: 0.5, y: 0.5 };

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
    this.notifications.info('Deshacer realizado.', 'Historial');
  }

  redo(): void {
    if (!this.editorHistory.redo()) return;
    this.notifications.info('Rehacer realizado.', 'Historial');
  }

  clearHistory(): void {
    this.editorHistory.clear();
    this.notifications.info('Historial limpiado.', 'Historial');
  }

  // --- Duplicar / copiar / pegar ---

  duplicateSelectedObject(): void {
    const ok = this.threeEngine.duplicateSelected();
    if (!ok) {
      this.notifications.warning('Selecciona un objeto para duplicar.');
      return;
    }
    this.notifications.success('Objeto duplicado.', 'Duplicar');
  }

  copySelectedToClipboard(): void {
    const payload = this.threeEngine.copySelectedToClipboard();
    if (!payload) {
      this.notifications.warning('Selecciona un objeto para copiar.');
      return;
    }
    if (!isPlatformBrowser(this.platformId)) return;
    void navigator.clipboard.writeText(payload).then(() => {
      this.notifications.success('Objeto copiado al portapapeles.', 'Copiar');
    }, () => {
      this.notifications.error('No se pudo acceder al portapapeles.', 'Copiar');
    });
  }

  pasteFromClipboard(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    navigator.clipboard.readText().then((raw) => {
      const ok = this.threeEngine.pasteObjectFromClipboard(raw);
      if (!ok) {
        this.notifications.warning('No hay un objeto 3D válido en el portapapeles.');
        return;
      }
      this.notifications.success('Objeto pegado desde el portapapeles.', 'Pegar');
    }, () => {
      this.notifications.error('No se pudo leer el portapapeles.', 'Pegar');
    });
  }

  // --- Exportar / importar escena ---

  async exportSceneGLB(): Promise<void> {
    this.exportBusy = true;
    try {
      this.fileHandler.exportCurrentModelGLB();
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : 'No se pudo exportar la escena.',
        'Exportar',
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
      this.notifications.warning('Selecciona un archivo .glb o .gltf.');
      return;
    }
    this.importBusy = true;
    try {
      this.fileHandler.loadLocalGLTF(file);
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : 'No se pudo importar el modelo.',
        'Importar',
      );
    } finally {
      this.importBusy = false;
    }
  }

  // --- Capturar imagen ---

  captureScreenshot(): void {
    const image = this.threeEngine.captureImageDataUrl();
    if (!image) {
      this.notifications.warning('No se pudo capturar la vista actual.');
      return;
    }
    const link = document.createElement('a');
    link.href = image;
    link.download = `carxy-render-${Date.now()}.png`;
    link.click();
    this.notifications.success('Imagen capturada y descargada.', 'Captura');
  }

  // --- Presentación / turntable ---

  togglePresentation(): void {
    const enabled = this.threeEngine.togglePresentation();
    this.notifications.info(
      enabled ? 'Modo presentación activado.' : 'Modo presentación desactivado.',
      'Presentación',
    );
  }

  async recordTurntable(): Promise<void> {
    this.presentationBusy = true;
    try {
      this.threeEngine.recordTurntable(10);
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : 'No se pudo grabar el video.',
        'Turntable',
      );
    } finally {
      this.presentationBusy = false;
    }
  }

  private refreshLayers(): void {
    this.layers = this.threeEngine.getLayers();
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
      this.measuringDistance ? 'Modo medición activado. Selecciona dos objetos.' : 'Modo medición desactivado.',
      'Medición',
    );
  }

  measureSelectedDistance(): void {
    if (!this.selectedObjectId) {
      this.notifications.warning('Selecciona un objeto primero.');
      return;
    }
    if (!this.distanceMeasurement) {
      this.distanceMeasurement = { idA: this.selectedObjectId, idB: '', distance: 0 };
      this.notifications.info('Selecciona el segundo objeto para medir la distancia.', 'Medición');
      return;
    }
    if (this.distanceMeasurement.idA === this.selectedObjectId) {
      this.notifications.warning('Selecciona un objeto diferente.');
      return;
    }
    this.distanceMeasurement.idB = this.selectedObjectId;
    const distance = this.threeEngine.measureDistanceBetweenObjects(this.distanceMeasurement.idA, this.distanceMeasurement.idB);
    if (distance !== null) {
      this.distanceMeasurement.distance = distance;
      this.notifications.success(`Distancia: ${distance.toFixed(2)} unidades.`, 'Medición');
    }
    this.measuringDistance = false;
  }

  // --- Más primitivas ---

  addCone(): void { this.threeEngine.addPrimitive('cone'); }
  addPlane(): void { this.threeEngine.addPrimitive('plane'); }
  addRing(): void { this.threeEngine.addPrimitive('ring'); }

  // --- Capas ---

  addLayer(): void {
    const name = prompt('Nombre de la capa:');
    if (!name || name.trim() === '') return;
    const trimmed = name.trim();
    if (this.layers.includes(trimmed)) {
      this.notifications.warning('Esa capa ya existe.');
      return;
    }
    this.threeEngine.addToLayer('', trimmed); // no-op para crear la capa (se crea al añadir un objeto)
    this.notifications.success(`Capa "${trimmed}" creada. Asigna objetos a ella desde la lista.`, 'Capa');
    this.refreshLayers();
  }

  removeLayer(): void {
    if (!this.selectedLayer) return;
    const layer = this.selectedLayer;
    // Remover todos los objetos de esta capa
    this.objectsInLayer(layer).forEach((id) => this.threeEngine.removeFromLayer(id));
    this.selectedLayer = null;
    this.refreshLayers();
    this.notifications.success(`Capa "${layer}" eliminada.`, 'Capa');
  }

  objectsInLayer(layerName: string): string[] {
    return this.sceneObjects
      .filter((item) => this.threeEngine.getObjectLayer(item.id) === layerName)
      .map((item) => item.id);
  }

  toggleLayerVisibility(layerName: string): void {
    const current = this.threeEngine.getLayerVisibility(layerName);
    this.threeEngine.setLayerVisibility(layerName, current !== false);
    this.cdr.detectChanges();
  }

  isLayerVisible(layerName: string): boolean {
    const v = this.threeEngine.getLayerVisibility(layerName);
    return v ?? true;
  }

  assignSelectedToLayer(): void {
    if (!this.selectedLayer || !this.selectedObjectId) {
      this.notifications.warning('Selecciona una capa y un objeto.');
      return;
    }
    this.threeEngine.addToLayer(this.selectedObjectId, this.selectedLayer);
    this.notifications.success(`Objeto asignado a "${this.selectedLayer}".`, 'Capa');
  }

  removeSelectedFromLayer(): void {
    if (!this.selectedObjectId) return;
    this.threeEngine.removeFromLayer(this.selectedObjectId);
    this.notifications.info('Objeto retirado de su capa.', 'Capa');
  }

  // --- Snap a grid ---

  toggleSnapToGrid(): void {
    this.snapEnabled = !this.snapEnabled;
    this.threeEngine.setSnapToGrid(this.snapEnabled, this.threeEngine.gridStep);
    this.notifications.info(
      this.snapEnabled ? 'Snap a grid activado.' : 'Snap a grid desactivado.',
      'Cuadrícula',
    );
  }

  applySnapToGrid(): void {
    this.threeEngine.applySnapToGrid();
    this.notifications.success('Posición ajustada a la cuadrícula.', 'Snap');
  }

  // --- Compartir escena (colaboración) ---

  shareScene(): void {
    const title = prompt('Título de la escena:', 'Mi escena 3D');
    if (!title) return;
    const description = prompt('Descripción (opcional):', '');
    const userSub = this.auth.user$.subscribe((user) => {
      if (!user) {
        this.notifications.warning('Inicia sesión para compartir la escena.');
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
        this.notifications.success('Escena copiada al portapapeles. Comparte este código con otro creador.', 'Escena compartida');
        userSub.unsubscribe();
      }, () => {
        this.notifications.error('No se pudo acceder al portapapeles.', 'Compartir');
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
    const text = prompt('Pega el código de la escena compartida:');
    if (!text) return;
    this.applySharedSceneCode(text);
  }

  private applySharedSceneCode(text: string): void {
    const parsed = this.threeEngine.importSceneWithMetadata(text);
    if (!parsed) {
      this.notifications.warning('Código de escena inválido.');
      return;
    }
    const ok = this.threeEngine.restoreScene(parsed.scene as string);
    if (ok) {
      this.notifications.success('Escena importada correctamente.', 'Importar escena');
    } else {
      this.notifications.error('No se pudo restaurar la escena.', 'Importar escena');
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

  toggleCollaborationPanel(): void {
    this.collaborationOpen = !this.collaborationOpen;
  }

  ngOnDestroy(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.localState.saveDraft(this.threeEngine.serializeScene());
    }
    this.subscriptions.unsubscribe();
    void this.audioReactive.stop();
  }
}
