import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, NgZone, OnDestroy, PLATFORM_ID } from '@angular/core';
import { Subject } from 'rxjs';
import * as THREE from 'three';
import { I18nService } from './i18n';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';

export type PrimitiveType = 'box' | 'sphere' | 'cylinder' | 'torus' | 'cone' | 'plane' | 'ring';

export interface SceneObject {
  id: string;
  name: string;
  object: THREE.Group;
}

export interface SceneNode {
  id: string;
  name: string;
  depth: number;
  kind: 'mesh' | 'group' | 'object';
  visible: boolean;
  object: THREE.Object3D;
}

export interface EditableMaterial {
  uuid: string;
  name: string;
  type: string;
  color: string | null;
  roughness: number | null;
  metalness: number | null;
  opacity: number;
  transparent: boolean;
  emissive: string | null;
  emissiveIntensity: number;
  materialRef: THREE.Material;
}

export interface ViewportHotspot {
  id: string;
  label: string;
  position: THREE.Vector3;
  screenX: number;
  screenY: number;
  visible: boolean;
}

@Injectable({ providedIn: 'root' })
export class ThreeEngineService implements OnDestroy {
  private readonly i18n = inject(I18nService);
  public camera!: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  public readonly transformChanged$ = new Subject<void>();
  public readonly materialsLoaded$ = new Subject<void>();
  public readonly sceneChanged$ = new Subject<void>();
  public readonly selectionChanged$ = new Subject<void>();
  public currentMaterials: EditableMaterial[] = [];
  public isWireframeEnabled = false;
  public isOrthographic = false;
  public readonly hotspotsChanged$ = new Subject<void>();
  public readonly presentationChanged$ = new Subject<boolean>();
  public readonly xrStatus$ = new Subject<string>();
  public hotspotMode = false;
  public bloomEnabled = false;
  public depthOfFieldEnabled = false;
  public vignetteEnabled = false;
  public clippingEnabled = false;
  public presentationEnabled = false;
  public arSupported = false;
  public ownCursorUid: string | null = null;
  /** Último elemento lienzo o instancia de arranque (ver línea de siembra). */
  public skipStarterScene = false;

  public readonly collaboratorJoined$ = new Subject<{ uid: string; displayName: string; color: string }>();
  public readonly collaboratorLeft$ = new Subject<string>();
  public readonly collaboratorTransform$ = new Subject<{ uid: string; objectId: string; position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number } }>();
  public readonly collaboratorSelection$ = new Subject<{ uid: string; objectId: string | null }>();
  public readonly remoteCursor$ = new Subject<{ uid: string; x: number; y: number; color: string; hasCursor: boolean }>();
  /** Posición del cursor propio sobre el viewport (0-100 %), emitida al mover el ratón. */
  public readonly cursorMoved$ = new Subject<{ x: number; y: number }>();
  public readonly objectLockChanged$ = new Subject<{ objectId: string; lockedBy: string | null }>();
  public snapToGrid = false;
  public gridStep = 0.5;
  readonly layerChanged$ = new Subject<string>();

  private canvas?: HTMLCanvasElement;
  private renderer?: THREE.WebGLRenderer;
  private composer?: EffectComposer;
  private renderPass?: RenderPass;
  private bloomPass?: UnrealBloomPass;
  private bokehPass?: BokehPass;
  private cinematicPass?: ShaderPass;
  private scene?: THREE.Scene;
  private controls?: OrbitControls;
  private transformControls?: TransformControls;
  private frameId: number | null = null;
  private _pointerMoveListener?: (event: PointerEvent) => void;
  private ambientLight?: THREE.AmbientLight;
  private directionalLight?: THREE.DirectionalLight;
  private perspectiveCamera?: THREE.PerspectiveCamera;
  private orthographicCamera?: THREE.OrthographicCamera;
  private objects: SceneObject[] = [];
  private currentModel: THREE.Group | null = null;
  private selectedNode: THREE.Object3D | null = null;
  private starterObjectId: string | null = null;
  private gridVisible = true;
  private shadowsEnabled = true;
  private axesHelper?: THREE.AxesHelper;
  private clippingPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
  private clippingAxis: 'x' | 'y' | 'z' = 'x';
  private explodedFactor = 0;
  private readonly explodedMeshPositions = new WeakMap<THREE.Mesh, THREE.Vector3>();
  private readonly hotspotRecords: {
    id: string;
    label: string;
    position: THREE.Vector3;
    marker: THREE.Mesh;
    model: THREE.Group;
  }[] = [];
  private audioLevels = { bass: 0, treble: 0 };
  private audioReactive = false;
  private audioBaseScale = new THREE.Vector3(1, 1, 1);
  private mediaRecorder?: MediaRecorder;
  private lastHotspotUpdate = 0;
  private presentationCurve?: THREE.CatmullRomCurve3;
  private presentationElapsed = 0;
  private readonly presentationTarget = new THREE.Vector3();
  private readonly timer = new THREE.Timer();
  private arHitTestSource?: XRHitTestSource;
  private arReticle?: THREE.Mesh;
  private arReferenceSpace?: XRReferenceSpace;
  private readonly collaborators = new Map<string, { displayName: string; color: string; objectId: string | null; x: number; y: number; hasCursor: boolean }>();
  private readonly collaboratorObjects = new Map<string, THREE.Group>();
  private readonly layers = new Map<string, Set<THREE.Object3D>>();
  private readonly objectLayer = new Map<THREE.Object3D, string>();
  private readonly initialPositions = new WeakMap<THREE.Group, THREE.Vector3>();
  private readonly initialNodeTransforms = new WeakMap<THREE.Object3D, {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: THREE.Vector3;
  }>();
  private pendingModels: { model: THREE.Group; name: string }[] = [];
  private pendingPrimitives: PrimitiveType[] = [];
  private nextObjectId = 1;
  private readonly platformId = inject(PLATFORM_ID);
  private sceneInitialized = false;
  private readonly lockedObjects = new Map<string, string>(); // objectId -> uid del bloqueador
  private readonly remoteLockedObjects = new Map<string, string>(); // locks de otros clientes (sincronizados desde Firestore)
  private readonly remoteSelectionMarkers = new Map<string, { objectId: string; group: THREE.Group; offsetY: number; ring: THREE.Mesh }>();

  /**
   * Si el usuario suelta el puntero fuera del canvas (header, HUD, otra ventana),
   * TransformControls puede quedar en estado "dragging" y dejar la cámara
   * bloqueada. Esta salvaguarda devuelve siempre el control de órbita.
   */
  private readonly handleGlobalPointerUp = (): void => {
    if (this.transformControls?.dragging) {
      this.transformControls.dragging = false;
    }
    if (this.controls && !this.presentationEnabled) {
      this.controls.enabled = true;
    }
  };

  constructor(private ngZone: NgZone) {}

  public initialize(canvas: HTMLCanvasElement): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.releaseViewport();

    this.canvas = canvas;
    const firstSceneInitialization = !this.sceneInitialized;
    if (!this.sceneInitialized) {
      this.timer.connect(document);
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color('#171a22');
      this.ambientLight = new THREE.AmbientLight(0xffffff, 1.35);
      this.directionalLight = new THREE.DirectionalLight(0xfff6e8, 2.35);
      this.directionalLight.position.set(5, 10, 7);
      this.directionalLight.castShadow = true;
      this.scene.add(this.ambientLight, this.directionalLight);

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(100, 100),
        new THREE.ShadowMaterial({ opacity: 0.22 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.02;
      ground.receiveShadow = true;
      this.scene.add(ground, new THREE.GridHelper(30, 30, '#596174', '#343a49'));
      this.sceneInitialized = true;
    }

    const width = Math.max(canvas.clientWidth, 1);
    const height = Math.max(canvas.clientHeight, 1);
    const aspect = width / height;
    this.perspectiveCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    this.perspectiveCamera.position.set(7, 6, 9);
    this.orthographicCamera = new THREE.OrthographicCamera(
      -5 * aspect,
      5 * aspect,
      5,
      -5,
      0.1,
      1000,
    );
    this.orthographicCamera.position.copy(this.perspectiveCamera.position);
    this.camera = this.isOrthographic ? this.orthographicCamera : this.perspectiveCamera;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.localClippingEnabled = true;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.addEventListener('dragging-changed', (event) => {
      if (this.controls) this.controls.enabled = !event.value;
    });
    this.transformControls.addEventListener('change', () => this.transformChanged$.next());
    this.scene!.add(this.transformControls.getHelper());
    window.addEventListener('pointerup', this.handleGlobalPointerUp);
    window.addEventListener('pointercancel', this.handleGlobalPointerUp);
    window.addEventListener('blur', this.handleGlobalPointerUp);
    // Seguimiento del cursor propio sobre el viewport para colaboradores remotos.
    const dom = this.renderer!.domElement;
    this._pointerMoveListener = (event: PointerEvent) => {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      const nx = (event.clientX - rect.left) / Math.max(rect.width, 1);
      const ny = (event.clientY - rect.top) / Math.max(rect.height, 1);
      const x = Math.min(1, Math.max(0, nx));
      const y = Math.min(1, Math.max(0, ny));
      this.cursorMoved$.next({ x, y });
      if (this.ownCursorUid) this.updateOwnCursor(x, y);
    };
    dom.addEventListener('pointermove', this._pointerMoveListener, { passive: true });
    this.initializePostProcessing(width, height);
    this.detectARSupport();

    if (firstSceneInitialization
      && !this.skipStarterScene
      && this.objects.length === 0
      && this.pendingModels.length === 0 && this.pendingPrimitives.length === 0) {
      this.addPrimitive('box');
      this.starterObjectId = this.objects.at(-1)?.id ?? null;
    }
    this.pendingModels.splice(0).forEach(({ model, name }) => this.addModelToScene(model, name));
    this.pendingPrimitives.splice(0).forEach((type) => this.addPrimitive(type));
    const selected = this.selectedNode ?? this.currentModel;
    if (selected) this.transformControls.attach(selected);
    this.animate();
  }

  public releaseViewport(): void {
    if (this.frameId !== null) this.renderer?.setAnimationLoop(null);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerup', this.handleGlobalPointerUp);
      window.removeEventListener('pointercancel', this.handleGlobalPointerUp);
      window.removeEventListener('blur', this.handleGlobalPointerUp);
    }
    if (this._pointerMoveListener && this.renderer?.domElement) {
      this.renderer.domElement.removeEventListener('pointermove', this._pointerMoveListener);
    }
    this._pointerMoveListener = undefined;
    if (this.transformControls) {
      this.scene?.remove(this.transformControls.getHelper());
      this.transformControls.dispose();
    }
    this.controls?.dispose();
    this.composer?.dispose();
    this.renderer?.dispose();
    this.frameId = null;
    this.transformControls = undefined;
    this.controls = undefined;
    this.composer = undefined;
    this.renderPass = undefined;
    this.bloomPass = undefined;
    this.bokehPass = undefined;
    this.cinematicPass = undefined;
    this.renderer = undefined;
    this.canvas = undefined;
  }

  public animate(): void {
    if (!this.renderer || !this.scene || this.frameId !== null) return;
    this.ngZone.runOutsideAngular(() => {
      this.renderer!.setAnimationLoop((time, frame) => {
        this.timer.update(time);
        const delta = Math.min(this.timer.getDelta(), 0.1);
        this.controls?.update();
        this.updatePresentation(delta);
        if (frame) this.updateARPlacement(frame);
        if (!this.scene || !this.renderer) return;
        this.updateAudioVisualization();
        this.updateHotspotProjection();
        this.updateRemoteSelectionMarkers();
        if (this.composer && !this.renderer.xr.isPresenting) this.composer.render();
        else this.renderer.render(this.scene, this.camera);
      });
      this.frameId = -1;
    });
  }

  public getCurrentModel(): THREE.Object3D | null {
    return this.selectedNode ?? this.currentModel;
  }

  public getSceneObjects(): readonly SceneObject[] {
    return this.objects;
  }

  public serializeScene(): string {
    const draft = new THREE.Group();
    this.objects.forEach(({ object }) => draft.add(object.clone(true)));
    return JSON.stringify(draft.toJSON());
  }

  private suppressSceneEvents = 0;

  public restoreScene(serialized: string): boolean {
    if (!this.scene) return false;
    try {
      const parsed = new THREE.ObjectLoader().parse(JSON.parse(serialized) as THREE.Object3DJSON);
      if (!(parsed instanceof THREE.Group) || parsed.children.length === 0) return false;
      const unwrap = (object: THREE.Object3D): THREE.Object3D[] => {
        if (object instanceof THREE.Group && object.name === 'Borrador local') {
          return object.children.flatMap(unwrap);
        }
        return [object];
      };
      const restoredObjects = parsed.children.flatMap(unwrap).map((object) => {
        if (object instanceof THREE.Group) return object;
        const group = new THREE.Group();
        group.add(object);
        return group;
      });
      if (restoredObjects.length === 0) return false;
      this.objects.forEach(({ object }) => {
        this.scene?.remove(object);
        this.disposeObject(object);
      });
      this.objects = [];
      this.currentModel = null;
      this.selectedNode = null;
      this.transformControls?.detach();
      this.starterObjectId = null;
      // La restauración no debe provocar autosaves: una carga de escena
      // sobreescribía el proyecto con contenido potencialmente rancio.
      this.suppressSceneEvents++;
      try {
        restoredObjects.forEach((object) => this.addObject(object, object.name || 'Modelo'));
      } finally {
        this.suppressSceneEvents--;
      }
      return true;
    } catch (error) {
      console.error('No se pudo restaurar el borrador de la escena.', error);
      return false;
    }
  }

  /** Carga una escena serializada como contenido inicial de un proyecto compartido. */
  public loadProjectScene(serialized: string): boolean {
    return this.restoreScene(serialized);
  }

  /** Devuelve la serialización actual de la escena para guardarla en el proyecto. */
  public get sceneJson(): string {
    return this.serializeScene();
  }

  /** Bloquea un objeto para que solo el usuario indicado pueda editarlo. */
  public lockObject(objectId: string, uid: string): boolean {
    if (this.lockedObjects.has(objectId)) return false;
    this.lockedObjects.set(objectId, uid);
    this.objectLockChanged$.next({ objectId, lockedBy: uid });
    return true;
  }

  /** Desbloquea un objeto. */
  public unlockObject(objectId: string): void {
    this.lockedObjects.delete(objectId);
    this.objectLockChanged$.next({ objectId, lockedBy: null });
  }

  /** Devuelve true si el objeto está bloqueado por otro usuario. */
  public isObjectLockedByOther(objectId: string, currentUid: string): boolean {
    const localLocker = this.lockedObjects.get(objectId);
    const remoteLocker = this.remoteLockedObjects.get(objectId);
    return (!!localLocker && localLocker !== currentUid) || (!!remoteLocker && remoteLocker !== currentUid);
  }

  /**
   * Sincroniza los bloqueos de objetos que otros clientes tienen en el proyecto.
   * Se llama cuando el colector de `locks` emite el snapshot más reciente desde Firestore.
   */
  public setRemoteLocks(locks: ReadonlyArray<{ objectId: string; lockedBy: string }>): void {
    this.remoteLockedObjects.clear();
    for (const lock of locks) {
      if (lock?.objectId && lock?.lockedBy) {
        this.remoteLockedObjects.set(lock.objectId, lock.lockedBy);
      }
    }
  }

  /** Bloqueos conocidos (locales y remotos) del editor. */
  public getRemoteLockedObjects(): ReadonlyMap<string, string> {
    return this.remoteLockedObjects;
  }

  /** Devuelve el mapa de objetos bloqueados. */
  public getLockedObjects(): ReadonlyMap<string, string> {
    return this.lockedObjects;
  }

  public getSelectedNodeId(): string | null {
    return this.selectedNode?.uuid ?? null;
  }

  public getSelectedSceneNodes(): SceneNode[] {
    if (!this.currentModel) return [];
    const nodes: SceneNode[] = [];
    let meshIndex = 0;
    let groupIndex = 0;
    const visit = (object: THREE.Object3D, depth: number): void => {
      const isMesh = object instanceof THREE.Mesh;
      const isRoot = object === this.currentModel;
      if (isMesh || object.children.length > 0 || isRoot) {
        const baseName = object.name.trim();
        const index = isMesh ? ++meshIndex : ++groupIndex;
        let materialName = '';
        if (object instanceof THREE.Mesh) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materialName = materials.map((material) => material.name).filter(Boolean).join(', ');
        }
        const fallback = isMesh
          ? `${materialName ? `${materialName} · ` : ''}Parte ${index}`
          : `Grupo ${index}`;
        nodes.push({
          id: object.uuid,
          name: baseName || fallback,
          depth,
          kind: isRoot ? 'object' : isMesh ? 'mesh' : 'group',
          visible: object.visible,
          object,
        });
      }
      object.children.forEach((child) => visit(child, depth + 1));
    };
    visit(this.currentModel, 0);
    return nodes;
  }

  private readonly selectedIds = new Set<string>();

  public selectObject(id: string, additive = false): void {
    const item = this.objects.find((entry) => entry.id === id);
    if (!item) return;
    if (additive) {
      if (this.selectedIds.has(id)) {
        this.selectedIds.delete(id);
        if (this.selectedNode === item.object && this.selectedIds.size > 0) {
          const remaining = [...this.selectedIds];
          const fallback = this.objects.find((entry) => entry.id === remaining[remaining.length - 1]);
          if (fallback) {
            this.currentModel = fallback.object;
            this.selectedNode = fallback.object;
            this.transformControls?.attach(this.selectedNode);
            this.audioBaseScale.copy(this.selectedNode.scale);
            this.refreshMaterials();
          }
        }
        this.applyWireframeState();
        this.selectionChanged$.next();
        return;
      }
      this.selectedIds.add(id);
    } else {
      this.selectedIds.clear();
      this.selectedIds.add(id);
    }
    this.currentModel = item.object;
    this.selectedNode = item.object;
    this.transformControls?.attach(this.selectedNode);
    this.audioBaseScale.copy(this.selectedNode.scale);
    this.applyWireframeState();
    this.refreshMaterials();
    this.selectionChanged$.next();
  }

  public getSelectedObjectIds(): string[] {
    return [...this.selectedIds].filter((id) => this.objects.some((item) => item.id === id));
  }

  public getSelectedObjects(): SceneObject[] {
    return this.getSelectedObjectIds()
      .map((id) => this.objects.find((item) => item.id === id))
      .filter((item): item is SceneObject => !!item);
  }

  public getGroupObjectInfo(objectId: string): { isEmpty: boolean; childCount: number } | null {
    const item = this.objects.find((entry) => entry.id === objectId);
    if (!item) return null;
    const marker = item.object.children.find(
      (child) => child.userData?.['isEmptyMarker'] === true,
    );
    return {
      isEmpty: marker !== undefined,
      childCount: item.object.children.filter((child) => child !== marker).length,
    };
  }

  private createEmptyMarker(scale = 0.09): THREE.Mesh {
    const material = new THREE.MeshBasicMaterial({ color: '#cbd5e1', wireframe: true });
    const marker = new THREE.Mesh(new THREE.OctahedronGeometry(scale, 0), material);
    marker.userData['isEmptyMarker'] = true;
    marker.name = 'Marcador vacío';
    return marker;
  }

  public addEmpty(): string | null {
    if (!this.scene) return null;
    const group = new THREE.Group();
    group.name = `Vacío`;
    group.add(this.createEmptyMarker());
    const emptyCount = this.objects.filter((entry) =>
      entry.object.name.startsWith('Vacío'),
    ).length;
    group.name = `Vacío ${emptyCount + 1}`;
    const id = this.addObject(group, group.name);
    return id;
  }

  public groupSelection(): string | null {
    if (!this.scene) return null;
    const selected = this.getSelectedObjects();
    if (selected.length < 2) return null;
    const centroid = new THREE.Vector3();
    for (const item of selected) {
      centroid.add(item.object.getWorldPosition(new THREE.Vector3()));
    }
    centroid.divideScalar(selected.length);
    const group = new THREE.Group();
    group.name = 'Vacío';
    group.position.copy(centroid);
    const marker = this.createEmptyMarker(0.11);
    group.add(marker);
    this.scene.add(group);
    const rootObjects = new Set(selected.map((item) => item.object));
    this.objects = this.objects.filter((item) => !rootObjects.has(item.object));
    // Conserva el id original en userData para poder restablecerlo al desagrupar
    for (const item of selected) {
      item.object.userData['originalObjectId'] = item.id;
      group.attach(item.object);
    }
    const id = this.addObject(group, group.name);
    this.selectedIds.clear();
    this.selectedIds.add(id);
    this.selectObject(id);
    this.sceneChanged$.next();
    return id;
  }

  public ungroupSelection(): boolean {
    const selected = this.selectedNode;
    if (!this.scene || !selected) return false;
    const item = this.objects.find((entry) => entry.object === selected);
    if (!item) return false;
    const markerIndex = selected.children.findIndex(
      (child) => child.userData?.['isEmptyMarker'] === true,
    );
    if (markerIndex === -1) return false;
    const marker = selected.children[markerIndex];
    const members = selected.children.filter((child) => child !== marker);
    // Desparentar preservando el transform mundial
    for (const child of members) {
      this.scene.attach(child);
    }
    // Eliminar el vacío del listado y de la escena
    this.scene.remove(selected);
    this.objects = this.objects.filter((entry) => entry !== item);
    this.disposeObject(selected);
    // Re-añadir los miembros como objetos raíz serializables.
    // Los miembros pueden ser meshes sueltos: se envuelven en un Group
    // (consistente con cómo restoreScene normaliza objetos sueltos).
    for (const child of members) {
      let root: THREE.Group;
      if (child instanceof THREE.Group) {
        root = child;
      } else {
        const wrapper = new THREE.Group();
        wrapper.name = child.name || 'Objeto';
        this.scene.add(wrapper);
        wrapper.attach(child);
        root = wrapper;
      }
      // Recupera el id original si el usuario no cambió el objeto desde la agrupación
      const originalId = root.userData?.['originalObjectId'] as string | undefined;
      const childId = originalId && !this.objects.some((entry) => entry.id === originalId)
        ? originalId
        : `object-${this.nextObjectId++}`;
      delete root.userData?.['originalObjectId'];
      this.objects.push({ id: childId, name: root.name || 'Objeto', object: root });
    }
    if (members.length > 0) {
      this.selectObject(this.objects[this.objects.length - 1].id);
    }
    this.refreshMaterials();
    this.sceneChanged$.next();
    return true;
  }

  public exportSelectionObjectsJSON(): string | null {
    const selected = this.getSelectedObjects();
    if (selected.length === 0) return null;
    const draft = new THREE.Group();
    for (const item of selected) {
      draft.add(item.object.clone(true));
    }
    // Rebajas materiales duplicados a referencias compartidas vía toJSON nativo
    return JSON.stringify(draft.toJSON());
  }

  public insertObjectsJSON(serialized: string): boolean {
    if (!this.scene) return false;
    try {
      const parsed = new THREE.ObjectLoader().parse(JSON.parse(serialized) as THREE.Object3DJSON);
      if (!(parsed instanceof THREE.Group) || parsed.children.length === 0) return false;
      const unwrap = (object: THREE.Object3D): THREE.Object3D[] => {
        if (object instanceof THREE.Group && object.name.startsWith('Vacío')) {
          return object.children.flatMap(unwrap);
        }
        return [object];
      };
      const targets = parsed.children.flatMap(unwrap);
      if (targets.length === 0) return false;
      // La clonación preserva materiales/geometrías por UUID — verificación rápida de nombre
      for (const object of targets) {
        const root = object instanceof THREE.Group
          ? object
          : (() => { const group = new THREE.Group(); group.add(object); return group; })();
        const cloneWorld = root.clone(true);
        cloneWorld.position.x += 0.75;
        cloneWorld.position.z += 0.75;
        this.addObject(cloneWorld, cloneWorld.name || 'Asset');
      }
      this.sceneChanged$.next();
      return true;
    } catch (error) {
      console.warn('No se pudo insertar el asset.', error);
      return false;
    }
  }

  public applyQualityPreset(preset: 'draft' | 'standard' | 'cinematic'): void {
    if (!this.renderer) return;
    if (preset === 'draft') {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
    } else if (preset === 'standard') {
      this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
      this.renderer.shadowMap.enabled = true;
    } else {
      this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
      this.renderer.shadowMap.enabled = true;
    }
    this.scene?.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        const material = node.material as THREE.Material | THREE.Material[];
        if (Array.isArray(material)) material.forEach((m) => (m.needsUpdate = true));
        else if (material) material.needsUpdate = true;
      }
    });
  }

  public selectNode(uuid: string): void {
    if (!this.currentModel) return;
    const matches: THREE.Object3D[] = [];
    this.currentModel.traverse((node) => {
      if (node.uuid === uuid) matches.push(node);
    });
    const target = matches[0];
    if (!target || target === this.selectedNode) return;
    this.selectedNode = target;
    this.transformControls?.attach(target);
    this.audioBaseScale.copy(target.scale);
    this.applyWireframeState();
    this.refreshMaterials();
    this.selectionChanged$.next();
  }

  public setNodeVisibility(uuid: string, visible: boolean): void {
    if (!this.currentModel) return;
    this.currentModel.traverse((node) => {
      if (node.uuid === uuid) node.visible = visible;
    });
    this.sceneChanged$.next();
  }

  /**
   * Muestra u oculta "en bloque" todos los marcadores auxiliares (luces y vacíos).
   * Los objetos son interactivos (clicables en 3D); ocultarlos sólo cambia su
   * visibilidad, no los elimina de la escena ni de la serialización.
   */
  public setMarkersVisible(visible: boolean): void {
    if (!this.scene) return;
    this.scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const u = node.userData ?? {};
      if (u['isLightMarker'] === true || u['isEmptyMarker'] === true) {
        node.visible = visible;
      }
    });
  }

  public get markersVisibleCount(): number {
    if (!this.scene) return 0;
    let count = 0;
    this.scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const u = node.userData ?? {};
      if ((u['isLightMarker'] === true || u['isEmptyMarker'] === true) && node.visible) count++;
    });
    return count;
  }

  public setExplodedView(amount: number): void {
    this.explodedFactor = THREE.MathUtils.clamp(amount, 0, 1);
    const model = this.currentModel;
    if (!model) return;
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const base = this.explodedMeshPositions.get(child);
        if (base) child.position.copy(base);
      }
    });
    model.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
    const radius = Math.max(new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere()).radius, 0.1);
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      let basePosition = this.explodedMeshPositions.get(child);
      if (!basePosition) {
        basePosition = child.position.clone();
        this.explodedMeshPositions.set(child, basePosition);
      }
      if (this.explodedFactor === 0) {
        child.position.copy(basePosition);
        return;
      }
      child.updateWorldMatrix(true, false);
      const worldPosition = child.getWorldPosition(new THREE.Vector3());
      const direction = worldPosition.sub(center);
      if (direction.lengthSq() < 1e-8) direction.set(0, 1, 0);
      direction.normalize();
      const parentQuaternion = child.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
      direction.applyQuaternion(parentQuaternion.invert());
      child.position.copy(basePosition).addScaledVector(direction, radius * this.explodedFactor);
    });
  }

  public setHotspotMode(enabled: boolean): void {
    this.hotspotMode = enabled;
  }

  public addHotspotFromPointer(clientX: number, clientY: number): boolean {
    if (!this.hotspotMode || !this.canvas || !this.camera || !this.currentModel) return false;
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    const hits = raycaster.intersectObject(this.currentModel, true);
    if (!hits.length) return false;
    const position = hits[0].point.clone();
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 12, 12),
      new THREE.MeshBasicMaterial({ color: '#fbbf24', depthTest: false }),
    );
    marker.position.copy(position);
    marker.renderOrder = 10;
    this.scene?.add(marker);
    this.hotspotRecords.push({
      id: `hotspot-${crypto.randomUUID()}`,
      label: this.i18n.translate('Nota {index}', { index: this.hotspotRecords.length + 1 }),
      position,
      marker,
    model: this.currentModel,
    });
    this.hotspotsChanged$.next();
    return true;
  }

  public getHotspots(): ViewportHotspot[] {
    return this.hotspotRecords.map(({ id, label, position }) => {
      const projected = position.clone().project(this.camera);
      return {
        id,
        label,
        position: position.clone(),
        screenX: ((projected.x + 1) / 2) * (this.canvas?.clientWidth ?? 0),
        screenY: ((1 - projected.y) / 2) * (this.canvas?.clientHeight ?? 0),
        visible: projected.z >= -1 && projected.z <= 1,
      };
    });
  }

  public renameHotspot(id: string, label: string): void {
    const record = this.hotspotRecords.find((hotspot) => hotspot.id === id);
    if (!record) return;
    record.label = label.trim() || 'Nota';
    this.hotspotsChanged$.next();
  }

  public removeHotspot(id: string): void {
    const index = this.hotspotRecords.findIndex((hotspot) => hotspot.id === id);
    if (index < 0) return;
    const [removed] = this.hotspotRecords.splice(index, 1);
    this.scene?.remove(removed.marker);
    removed.marker.geometry.dispose();
    (removed.marker.material as THREE.Material).dispose();
    this.hotspotsChanged$.next();
  }

  public setClipping(enabled: boolean, axis = this.clippingAxis, offset = 0): void {
    this.clippingEnabled = enabled;
    this.clippingAxis = axis;
    const normal = new THREE.Vector3(
      axis === 'x' ? 1 : 0,
      axis === 'y' ? 1 : 0,
      axis === 'z' ? 1 : 0,
    );
    this.clippingPlane.set(normal, -offset);
    this.objects.forEach(({ object }) => object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        const existing: THREE.Plane[] = (material.clippingPlanes ?? []).filter(
          (plane: THREE.Plane) => plane !== this.clippingPlane,
        );
        material.clippingPlanes = enabled ? [...existing, this.clippingPlane] : existing;
        material.needsUpdate = true;
      });
    }));
  }

  public setBloom(enabled: boolean, strength = 0.7): void {
    this.bloomEnabled = enabled;
    if (this.bloomPass) {
      this.bloomPass.enabled = enabled;
      this.bloomPass.strength = strength;
    }
  }

  public setDepthOfField(enabled: boolean, focus = 8): void {
    this.depthOfFieldEnabled = enabled;
    if (!this.bokehPass) return;
    this.bokehPass.enabled = enabled;
    const focusUniform = (this.bokehPass.uniforms as Record<string, { value: number }>)['focus'];
    if (focusUniform) focusUniform.value = focus;
  }

  public setVignette(enabled: boolean): void {
    this.vignetteEnabled = enabled;
    if (this.cinematicPass) {
      this.cinematicPass.uniforms['vignette']!.value = enabled ? 0.35 : 0;
      this.cinematicPass.enabled = enabled;
    }
  }

  public togglePresentation(): boolean {
    this.presentationEnabled = !this.presentationEnabled;
    if (this.presentationEnabled) {
      const bounds = this.currentModel
        ? new THREE.Box3().setFromObject(this.currentModel)
        : new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
      bounds.getCenter(this.presentationTarget);
      const radius = Math.max(bounds.getBoundingSphere(new THREE.Sphere()).radius, 1);
      const cameraPosition =
        this.camera?.position ??
        this.presentationTarget.clone().add(new THREE.Vector3(radius * 2, radius, radius * 2));
      const start = cameraPosition.clone().sub(this.presentationTarget);
      const startAngle = Math.atan2(start.z, start.x);
      const radiusPath = Math.max(start.length(), radius * 2);
      const points = Array.from({ length: 9 }, (_, index) => {
        const angle = startAngle + (index / 8) * Math.PI * 2;
        return new THREE.Vector3(
          this.presentationTarget.x + Math.cos(angle) * radiusPath,
          this.presentationTarget.y + Math.max(start.y, radius * 0.45) + Math.sin(angle * 2) * radius * 0.12,
          this.presentationTarget.z + Math.sin(angle) * radiusPath,
        );
      });
      this.presentationCurve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
      this.presentationElapsed = 0;
      this.timer.reset();
      if (this.controls) this.controls.enabled = false;
    } else {
      this.presentationCurve = undefined;
      if (this.controls) this.controls.enabled = true;
    }
    this.presentationChanged$.next(this.presentationEnabled);
    return this.presentationEnabled;
  }

  private updatePresentation(delta: number): void {
    if (!this.presentationEnabled || !this.presentationCurve) return;
    this.presentationElapsed = (this.presentationElapsed + delta / 18) % 1;
    this.camera.position.copy(this.presentationCurve.getPointAt(this.presentationElapsed));
    this.camera.lookAt(this.presentationTarget);
  }

  public recordTurntable(durationSeconds = 8): void {
    if (!this.canvas || !this.canvas.captureStream || typeof MediaRecorder === 'undefined') {
      this.xrStatus$.next('La grabación WebM no está disponible en este navegador.');
      return;
    }
    if (this.mediaRecorder?.state === 'recording') return;
    const stream = this.canvas.captureStream(30);
    const options = MediaRecorder.isTypeSupported('video/webm') ? { mimeType: 'video/webm' } : undefined;
    this.mediaRecorder = new MediaRecorder(stream, options);
    const chunks: BlobPart[] = [];
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    this.mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'forma-turntable.webm';
      anchor.click();
      URL.revokeObjectURL(url);
      stream.getTracks().forEach((track) => track.stop());
      this.xrStatus$.next('Video de presentación descargado.');
    };
    this.mediaRecorder.start();
    if (!this.presentationEnabled) this.togglePresentation();
    window.setTimeout(() => {
      if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.stop();
      if (this.presentationEnabled) this.togglePresentation();
    }, THREE.MathUtils.clamp(durationSeconds, 3, 30) * 1000);
  }

  public async startAR(): Promise<void> {
    if (!this.renderer || !this.arSupported) {
      this.xrStatus$.next('WebXR AR no está disponible. Usa HTTPS y un dispositivo compatible.');
      return;
    }
    const xr = (navigator as Navigator & { xr?: { requestSession: (mode: string, options?: object) => Promise<XRSession> } }).xr;
    if (!xr) return;
    try {
      const session = await xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: document.body },
      });
      if (!session.requestHitTestSource) {
        await session.end();
        throw new Error('Este dispositivo no admite consultas de hit-test para superficies.');
      }
      this.renderer.xr.enabled = true;
      this.renderer.xr.setReferenceSpaceType('local-floor');
      await this.renderer.xr.setSession(session);
      const viewerSpace = await session.requestReferenceSpace('viewer');
      this.arHitTestSource = (await session.requestHitTestSource({ space: viewerSpace })) ?? undefined;
      this.arReferenceSpace = this.renderer.xr.getReferenceSpace() ?? undefined;
      this.arReticle = new THREE.Mesh(
        new THREE.RingGeometry(0.12, 0.16, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#a78bfa', side: THREE.DoubleSide }),
      );
      this.arReticle.matrixAutoUpdate = false;
      this.arReticle.visible = false;
      this.scene!.add(this.arReticle);
      this.renderer.setClearColor(0x000000, 0);
      this.scene!.background = null;
      this.xrStatus$.next('Modo AR activo. Pulsa salir en el visor para volver.');
      session.addEventListener('end', () => {
        this.arHitTestSource?.cancel();
        this.arHitTestSource = undefined;
        this.arReticle?.removeFromParent();
        this.arReticle?.geometry.dispose();
        (this.arReticle?.material as THREE.Material | undefined)?.dispose();
        this.arReticle = undefined;
        this.arReferenceSpace = undefined;
        if (this.renderer) this.renderer.setClearColor(0x000000, 1);
        if (this.scene) this.scene.background = new THREE.Color('#171a22');
        this.xrStatus$.next('Sesión AR finalizada.');
      }, { once: true });
    } catch (error) {
      console.error('No se pudo iniciar la sesión WebXR AR.', error);
      this.xrStatus$.next('No se pudo iniciar AR. Comprueba permisos y compatibilidad del dispositivo.');
    }
  }

  public placeCurrentModelOnARSurface(): boolean {
    if (!this.arReticle?.visible || !this.currentModel) return false;
    this.arReticle.updateMatrixWorld(true);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    this.arReticle.matrixWorld.decompose(position, quaternion, scale);
    this.currentModel.position.copy(position);
    this.currentModel.quaternion.copy(quaternion);
    this.currentModel.scale.copy(scale);
    this.arReticle.visible = false;
    this.transformChanged$.next();
    return true;
  }

  private updateARPlacement(frame: XRFrame): void {
    if (!this.arHitTestSource || !this.arReferenceSpace || !this.arReticle) return;
    const hit = frame.getHitTestResults(this.arHitTestSource)[0];
    if (!hit) {
      this.arReticle.visible = false;
      return;
    }
    const pose = hit.getPose(this.arReferenceSpace);
    if (!pose) return;
    this.arReticle.visible = true;
    this.arReticle.matrix.fromArray(pose.transform.matrix);
  }

  public setAudioReactive(enabled: boolean): void {
    this.audioReactive = enabled;
    const selected = this.getCurrentModel();
    if (selected) this.audioBaseScale.copy(selected.scale);
    if (!enabled) {
      selected?.scale.copy(this.audioBaseScale);
      this.directionalLight && (this.directionalLight.intensity = 1.2);
    }
  }

  public setAudioLevels(bass: number, treble: number): void {
    this.audioLevels.bass = THREE.MathUtils.clamp(bass, 0, 1);
    this.audioLevels.treble = THREE.MathUtils.clamp(treble, 0, 1);
  }

  private updateAudioVisualization(): void {
    if (!this.audioReactive) return;
    const selected = this.getCurrentModel();
    const pulse = 1 + this.audioLevels.bass * 0.16;
    selected?.scale.copy(this.audioBaseScale).multiplyScalar(pulse);
    if (this.directionalLight) {
      this.directionalLight.intensity = 1.2 + this.audioLevels.treble * 2.2;
    }
  }

  private updateHotspotProjection(): void {
    const now = performance.now();
    if (now - this.lastHotspotUpdate < 100) return;
    this.lastHotspotUpdate = now;
    this.hotspotsChanged$.next();
  }

  private async detectARSupport(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    const xr = (navigator as Navigator & { xr?: { isSessionSupported: (mode: string) => Promise<boolean> } }).xr;
    if (!xr) return;
    try {
      this.arSupported = await xr.isSessionSupported('immersive-ar');
    } catch (error) {
      console.warn('No se pudo comprobar la compatibilidad WebXR.', error);
      this.arSupported = false;
    }
    // No emitir sceneChanged$: la autodetección de AR no es una edición del
    // usuario y disparaba un autosave al abrir la página.
  }

  private initializePostProcessing(width: number, height: number): void {
    if (!this.renderer || !this.scene) return;
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.7, 0.4, 0.85);
    this.bloomPass.enabled = false;
    this.composer.addPass(this.bloomPass);
    this.bokehPass = new BokehPass(this.scene, this.camera, {
      focus: 8,
      aperture: 0.00008,
      maxblur: 0.01,
    });
    this.bokehPass.enabled = false;
    this.composer.addPass(this.bokehPass);
    this.cinematicPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        vignette: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float vignette;
        varying vec2 vUv;
        void main() {
          vec2 offset = (vUv - 0.5) * 0.003;
          vec4 color;
          color.r = texture2D(tDiffuse, vUv + offset).r;
          color.g = texture2D(tDiffuse, vUv).g;
          color.b = texture2D(tDiffuse, vUv - offset).b;
          color.a = texture2D(tDiffuse, vUv).a;
          float shade = smoothstep(0.78, 0.18, distance(vUv, vec2(0.5)));
          color.rgb *= mix(1.0, shade, vignette);
          gl_FragColor = color;
        }
      `,
    });
    this.cinematicPass.enabled = false;
    this.composer.addPass(this.cinematicPass);
    this.composer.addPass(new OutputPass());
  }

  public focusSelectedNode(): void {
    const node = this.getCurrentModel();
    if (!node || !this.controls) return;
    const box = new THREE.Box3().setFromObject(node);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 0.5);
    this.controls.target.copy(center);
    const distance = radius * 3;
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.controls.update();
  }

  public toggleGrid(): boolean {
    const grid = this.scene?.children.find((child) => child instanceof THREE.GridHelper);
    if (!grid) return false;
    this.gridVisible = !this.gridVisible;
    grid.visible = this.gridVisible;
    return this.gridVisible;
  }

  public toggleShadows(): boolean {
    if (!this.renderer) return false;
    this.shadowsEnabled = !this.shadowsEnabled;
    this.renderer.shadowMap.enabled = this.shadowsEnabled;
    this.renderer.shadowMap.needsUpdate = true;
    return this.shadowsEnabled;
  }

  public toggleAxes(): boolean {
    if (!this.scene) return false;
    if (!this.axesHelper) {
      this.axesHelper = new THREE.AxesHelper(2);
      this.scene.add(this.axesHelper);
    } else this.axesHelper.visible = !this.axesHelper.visible;
    return this.axesHelper.visible;
  }

  public setAutoRotate(enabled: boolean): void {
    if (this.controls) this.controls.autoRotate = enabled;
  }

  public setExposure(value: number): void {
    if (this.renderer) this.renderer.toneMappingExposure = value;
  }

  /** Estado de cámara persistible (para vistas guardadas). */
  public getCameraState(): { position: [number, number, number]; target: [number, number, number] } | null {
    if (!this.camera) return null;
    const target = this.controls?.target?.clone() ?? new THREE.Vector3();
    return {
      position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      target: [target.x, target.y, target.z],
    };
  }

  public restoreCameraState(state: { position: [number, number, number]; target: [number, number, number] }): void {
    if (!this.controls || !state) return;
    this.camera.position.set(state.position[0], state.position[1], state.position[2]);
    this.controls.target.set(state.target[0], state.target[1], state.target[2]);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  /** Marcador pulsante de color sobre el objeto que un colaborador remoto tiene seleccionado. */
  public setRemoteSelectionMarker(uid: string, objectId: string | null, color: string): void {
    this.clearRemoteSelectionMarker(uid);
    if (!this.scene || !objectId) return;
    const item = this.objects.find((o) => o.id === objectId);
    if (!item) return;
    const box = new THREE.Box3().setFromObject(item.object);
    const size = box.getSize(new THREE.Vector3());
    const offsetY = Math.max(Math.abs(size.y) / 2 + 0.32, 0.5);
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.26, 0.032, 8, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false }),
    );
    ring.renderOrder = 120;
    ring.rotation.x = Math.PI / 2;
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 10, 10),
      new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    dot.renderOrder = 121;
    group.add(ring, dot);
    this.scene.add(group);
    this.remoteSelectionMarkers.set(uid, { objectId, group, offsetY, ring });
    this.updateRemoteSelectionMarkers();
  }

  public clearRemoteSelectionMarker(uid: string): void {
    const existing = this.remoteSelectionMarkers.get(uid);
    if (!existing) return;
    this.scene?.remove(existing.group);
    existing.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
    this.remoteSelectionMarkers.delete(uid);
  }

  private updateRemoteSelectionMarkers(): void {
    const t = Date.now() * 0.004;
    const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 2.2));
    for (const marker of this.remoteSelectionMarkers.values()) {
      const item = this.objects.find((o) => o.id === marker.objectId);
      if (!item) {
        marker.group.visible = false;
        continue;
      }
      const world = new THREE.Vector3();
      item.object.getWorldPosition(world);
      marker.group.visible = true;
      marker.group.position.set(world.x, world.y + marker.offsetY, world.z);
      marker.ring.rotation.y = (marker.ring.rotation.y + 0.035) % (Math.PI * 2);
      (marker.ring.material as THREE.MeshBasicMaterial).opacity = pulse;
      const ringIndex = marker.group.children.indexOf(marker.ring);
      const dot = marker.group.children[1 - ringIndex] as THREE.Mesh | undefined;
      if (dot) (dot.material as THREE.MeshBasicMaterial).opacity = pulse;
    }
  }

  public setCameraView(view: 'perspective' | 'front' | 'side' | 'top'): void {
    if (!this.controls) return;
    const target = this.controls.target.clone();
    const radius = this.getCurrentModel()
      ? Math.max(new THREE.Box3().setFromObject(this.getCurrentModel()!).getBoundingSphere(new THREE.Sphere()).radius, 1)
      : 5;
    if (view === 'perspective') {
      this.resetCamera();
      return;
    }
    const directions: Record<'front' | 'side' | 'top', THREE.Vector3> = {
      front: new THREE.Vector3(0, 0.12, 1),
      side: new THREE.Vector3(1, 0.12, 0),
      top: new THREE.Vector3(0, 1, 0),
    };
    const direction = directions[view];
    this.camera.up.set(0, 1, 0);
    if (view === 'top') this.camera.up.set(0, 0, -1);
    this.camera.position.copy(target).addScaledVector(direction, radius * 3.2);
    this.camera.lookAt(target);
    this.controls.update();
  }

  public addModelToScene(model: THREE.Group, name = 'Modelo importado'): void {
    if (!this.scene) {
      this.pendingModels.push({ model, name });
      return;
    }
    this.removeStarterObject();
    this.addObject(model, name);
    this.resetCamera();
  }

  private removeStarterObject(): void {
    if (!this.starterObjectId) return;
    const starter = this.objects.find((item) => item.id === this.starterObjectId);
    this.starterObjectId = null;
    if (!starter || !this.scene) return;
    this.transformControls?.detach();
    this.scene.remove(starter.object);
    this.disposeObject(starter.object);
    this.objects = this.objects.filter((item) => item.id !== starter.id);
    if (this.currentModel === starter.object) {
      this.currentModel = null;
      this.selectedNode = null;
    }
  }

  public addLightPrimitive(kind: 'point' | 'spot' | 'directional'): string {
    if (!this.scene) return '';
    const name = kind === 'point' ? 'Luz de punto' : kind === 'spot' ? 'Luz de foco' : 'Luz direccional';
    const markerColor = kind === 'point' ? '#ffd166' : kind === 'spot' ? '#7dd3fc' : '#f4f1de';
    const group = new THREE.Group();
    group.name = name;
    // Marcador: un octaedro emissive/brillante para ver el "foco" en el viewport.
    const markerMaterial = new THREE.MeshBasicMaterial({ color: markerColor, toneMapped: false });
    const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), markerMaterial);
    marker.name = 'Marcador de luz';
    marker.userData['isLightMarker'] = true;
    let light: THREE.PointLight | THREE.SpotLight | THREE.DirectionalLight;
    if (kind === 'point') {
      light = new THREE.PointLight(0xffd9a0, 30, 0, 1.8);
    } else if (kind === 'spot') {
      light = new THREE.SpotLight(0xffffff, 80, 0, Math.PI / 7, 0.42, 1.5);
    } else {
      light = new THREE.DirectionalLight(0xffffff, 2.2);
    }
    light.name = name;
    if ('castShadow' in light) light.castShadow = false;
    group.add(marker, light);
    const spawn: [number, number, number] =
      kind === 'point' ? [0.8, 2.1, 1.2] : kind === 'spot' ? [2.1, 1.6, 1.6] : [3.2, 4.5, 2.4];
    group.position.set(spawn[0], spawn[1], spawn[2]);
    const id = this.addObject(group, name);
    return id;
  }

  public getSelectedLightInfo(): {
    kind: string; name: string; color: string; intensity: number;
    distance: number; decay: number; angle: number | null; penumbra: number | null;
  } | null {
    const selected = this.selectedNode;
    if (!selected) return null;
    const found: THREE.Light[] = [];
    selected.traverse((node) => {
      if ((node as THREE.Light).isLight) found.push(node as THREE.Light);
    });
    const light = found[0] ?? null;
    if (!light) return null;
    const color = 'color' in light && light.color instanceof THREE.Color ? `#${light.color.getHexString()}` : '#ffffff';
    const distance = 'distance' in light && typeof light.distance === 'number' ? light.distance : 0;
    const decay = 'decay' in light && typeof light.decay === 'number' ? light.decay : 0;
    const angle = light instanceof THREE.SpotLight ? THREE.MathUtils.radToDeg(light.angle) : null;
    const penumbra = light instanceof THREE.SpotLight ? light.penumbra : null;
    return {
      kind: light.type.replace('Light', '').toLowerCase(),
      name: light.name,
      color,
      intensity: light.intensity,
      distance,
      decay,
      angle,
      penumbra,
    };
  }

  public updateLightProperty(
    property: 'intensity' | 'distance' | 'decay' | 'angle' | 'penumbra',
    value: number,
  ): void {
    const selected = this.selectedNode;
    if (!selected) return;
    const found: THREE.Light[] = [];
    selected.traverse((node) => {
      if ((node as THREE.Light).isLight) found.push(node as THREE.Light);
    });
    const light = found[0] ?? null;
    if (!light) return;
    if (property === 'angle') {
      if (light instanceof THREE.SpotLight) light.angle = THREE.MathUtils.degToRad(value);
    } else if (property === 'penumbra') {
      if (light instanceof THREE.SpotLight) light.penumbra = value;
    } else if (property === 'distance' || property === 'decay' || property === 'intensity') {
      (light as THREE.PointLight | THREE.SpotLight)[property] = value;
      if (property === 'intensity') light.intensity = value;
    }
    this.sceneChanged$.next();
  }

  public updateLightColor(hexColor: string): void {
    const selected = this.selectedNode;
    if (!selected) return;
    const found: THREE.Light[] = [];
    selected.traverse((node) => {
      if ((node as THREE.Light).isLight) found.push(node as THREE.Light);
    });
    const light = found[0] ?? null;
    if (!light || !('color' in light) || !(light.color instanceof THREE.Color)) return;
    light.color.set(hexColor);
    this.sceneChanged$.next();
  }

  public addPrimitive(type: PrimitiveType): string {
    if (!this.scene) {
      this.pendingPrimitives.push(type);
      return '';
    }
    let geometry: THREE.BufferGeometry;
    let name: string;
    switch (type) {
      case 'sphere':
        geometry = new THREE.SphereGeometry(1, 32, 24);
        name = 'Esfera';
        break;
      case 'cylinder':
        geometry = new THREE.CylinderGeometry(0.8, 0.8, 1.6, 32);
        name = 'Cilindro';
        break;
      case 'torus':
        geometry = new THREE.TorusGeometry(0.8, 0.28, 18, 48);
        name = 'Toro';
        break;
      case 'cone':
        geometry = new THREE.ConeGeometry(0.8, 1.6, 32);
        name = 'Cono';
        break;
      case 'plane':
        geometry = new THREE.PlaneGeometry(1.6, 1.6);
        geometry.rotateX(-Math.PI / 2);
        name = 'Plano';
        break;
      case 'ring':
        geometry = new THREE.TorusGeometry(0.8, 0.2, 16, 32);
        name = 'Anillo';
        break;
      default:
        geometry = new THREE.BoxGeometry(1.6, 1.6, 1.6);
        name = 'Cubo';
    }
    const primitiveColors: Record<PrimitiveType, string> = {
      box: '#8b5cf6',
      sphere: '#38bdf8',
      cylinder: '#f59e0b',
      torus: '#34d399',
      cone: '#fb923c',
      plane: '#a78bfa',
      ring: '#c4b5fd',
    };
    const material = new THREE.MeshStandardMaterial({
      color: primitiveColors[type],
      roughness: 0.38,
      metalness: 0.08,
    });
    material.name = `${name} · Material`;
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, material));
    const offset = this.objects.length * 0.45;
    group.position.set(offset, 0.8, offset);
    const id = this.addObject(group, name);
    this.resetCamera();
    return id;
  }

  private addObject(object: THREE.Group, name: string): string {
    if (!this.scene) return '';
    object.name = name;
    object.traverse((child) => {
      this.initialNodeTransforms.set(child, {
        position: child.position.clone(),
        rotation: child.rotation.clone(),
        scale: child.scale.clone(),
      });
      if (child instanceof THREE.Mesh) {
        if (this.explodedFactor === 0) this.explodedMeshPositions.set(child, child.position.clone());
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    if (this.snapToGrid) {
      object.position.x = Math.round(object.position.x / this.gridStep) * this.gridStep;
      object.position.y = Math.round(object.position.y / this.gridStep) * this.gridStep;
      object.position.z = Math.round(object.position.z / this.gridStep) * this.gridStep;
    }
    const item = { id: `object-${this.nextObjectId++}`, name, object };
    this.initialPositions.set(object, object.position.clone());
    this.objects.push(item);
    this.scene.add(object);
    this.selectObject(item.id);
    if (this.suppressSceneEvents === 0) this.sceneChanged$.next();
    return item.id;
  }

  // --- Medición de distancia 3D ---

  measureDistance(pointA: THREE.Vector3, pointB: THREE.Vector3): number {
    return pointA.distanceTo(pointB);
  }

  measureDistanceBetweenObjects(idA: string, idB: string): number | null {
    const a = this.objects.find((item) => item.id === idA)?.object;
    const b = this.objects.find((item) => item.id === idB)?.object;
    if (!a || !b) return null;
    const pa = new THREE.Vector3();
    const pb = new THREE.Vector3();
    a.getWorldPosition(pa);
    b.getWorldPosition(pb);
    return pa.distanceTo(pb);
  }

  // --- Capas / Layers ---

  addToLayer(objectId: string, layerName: string): void {
    const item = this.objects.find((entry) => entry.id === objectId);
    if (!item) return;
    const prev = this.objectLayer.get(item.object);
    if (prev === layerName) return;
    if (prev) {
      this.layers.get(prev)?.delete(item.object);
      this.layerChanged$.next(prev);
    }
    if (!this.layers.has(layerName)) this.layers.set(layerName, new Set());
    this.layers.get(layerName)!.add(item.object);
    this.objectLayer.set(item.object, layerName);
    this.layerChanged$.next(layerName);
  }

  removeFromLayer(objectId: string): void {
    const item = this.objects.find((entry) => entry.id === objectId);
    if (!item) return;
    const layer = this.objectLayer.get(item.object);
    if (!layer) return;
    this.layers.get(layer)?.delete(item.object);
    this.objectLayer.delete(item.object);
    this.layerChanged$.next(layer);
  }

  setLayerVisibility(layerName: string, visible: boolean): void {
    const members = this.layers.get(layerName);
    if (!members) return;
    members.forEach((object) => {
      object.traverse((child) => {
        child.visible = visible;
      });
    });
  }

  getLayerVisibility(layerName: string): boolean | null {
    const members = this.layers.get(layerName);
    if (!members || members.size === 0) return null;
    const first = members.values().next().value;
    if (!first) return null;
    return first.visible;
  }

  getLayers(): string[] {
    return Array.from(this.layers.keys());
  }

  getObjectLayer(objectId: string): string | null {
    const item = this.objects.find((entry) => entry.id === objectId);
    if (!item) return null;
    return this.objectLayer.get(item.object) ?? null;
  }

  // --- Snap a grid ---

  setSnapToGrid(enabled: boolean, step = 0.5): void {
    this.snapToGrid = enabled;
    this.gridStep = step;
  }

  applySnapToGrid(): void {
    if (!this.snapToGrid || !this.currentModel) return;
    this.currentModel.position.x = Math.round(this.currentModel.position.x / this.gridStep) * this.gridStep;
    this.currentModel.position.y = Math.round(this.currentModel.position.y / this.gridStep) * this.gridStep;
    this.currentModel.position.z = Math.round(this.currentModel.position.z / this.gridStep) * this.gridStep;
    this.transformChanged$.next();
  }

  // --- Compartir escena (colaboración) ---

  exportSceneWithMetadata(metadata: { title: string; description: string; authorId: string; authorName: string }): string {
    const scene = this.serializeScene();
    const payload = {
      type: 'carxy-scene',
      version: 1,
      metadata,
      scene,
      exportedAt: Date.now(),
    };
    return JSON.stringify(payload);
  }

  importSceneWithMetadata(raw: string): { metadata: unknown; scene: string } | null {
    try {
      const payload = JSON.parse(raw) as {
        type?: string;
        version?: number;
        metadata?: unknown;
        scene?: string;
        exportedAt?: number;
      };
      if (payload.type !== 'carxy-scene' || !payload.scene) return null;
      return { metadata: payload.metadata ?? {}, scene: payload.scene };
    } catch {
      return null;
    }
  }

  public deleteCurrentModel(): string | null {
    if (!this.scene || !this.currentModel) return null;
    const removed = this.currentModel;
    const item = this.objects.find((it) => it.object === removed);
    const removedId = item?.id ?? null;
    this.transformControls?.detach();
    this.scene.remove(removed);
    this.disposeObject(removed);
    this.objects = this.objects.filter((item) => item.object !== removed);
    this.hotspotRecords
      .filter((hotspot) => hotspot.model === removed)
      .map((hotspot) => hotspot.id)
      .forEach((id) => this.removeHotspot(id));
    this.currentModel = null;
    this.selectedNode = null;
    const next = this.objects.at(-1);
    if (next) this.selectObject(next.id);
    else {
      this.currentMaterials = [];
      this.materialsLoaded$.next();
      this.selectionChanged$.next();
    }
    this.sceneChanged$.next();
    return removedId;
  }

  public duplicateSelected(): string | null {
    if (!this.scene || !this.currentModel) return null;
    const source = this.currentModel;
    const clone = source.clone(true) as THREE.Group;
    clone.position.x += 1.2;
    clone.position.z += 0.4;
    const baseName = source.name?.trim() || 'Objeto';
    const newId = this.addObject(clone, `${baseName} copia`);
    return newId;
  }

  public copySelectedToClipboard(): string | null {
    if (!this.currentModel) return null;
    const payload = {
      type: 'carxy-object',
      name: this.currentModel.name || 'Objeto',
      object: this.currentModel.toJSON(),
    };
    return JSON.stringify(payload);
  }

  public pasteObjectFromClipboard(raw: string): boolean {
    if (!this.scene || !raw.trim()) return false;
    try {
      const payload = JSON.parse(raw) as { type?: string; name?: string; object?: object };
      if (payload.type !== 'carxy-object' || !payload.object) return false;
      const loader = new THREE.ObjectLoader();
      const loaded = loader.parse(payload.object);
      const group = loaded instanceof THREE.Group ? loaded : new THREE.Group().add(loaded);
      group.position.x += 1.1;
      this.addObject(group, `${payload.name || 'Objeto'} pegado`);
      return true;
    } catch (error) {
      console.warn('No se pudo pegar el objeto 3D del portapapeles.', error);
      return false;
    }
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    });
  }

  public setGizmoMode(mode: 'translate' | 'rotate' | 'scale'): void {
    this.transformControls?.setMode(mode);
  }

  public updateScale(value: number): void {
    this.getCurrentModel()?.scale.setScalar(value);
    this.transformChanged$.next();
  }

  /** Escala individual por eje (x, y o z) para piezas no uniformes. */
  public updateScaleAxis(axis: 'x' | 'y' | 'z', value: number): void {
    const clamped = Math.min(20, Math.max(0.05, value));
    const target = this.getCurrentModel();
    if (target) target.scale[axis] = clamped;
    this.transformChanged$.next();
  }

  /** Renombra el objeto actualmente seleccionado. */
  public renameObject(objectId: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const item = this.objects.find((entry) => entry.id === objectId);
    if (!item) return;
    item.name = trimmed.slice(0, 80);
    item.object.name = item.name;
    this.sceneChanged$.next();
  }

  public updateRotation(axis: 'x' | 'y' | 'z', degrees: number): void {
    const target = this.getCurrentModel();
    if (target) target.rotation[axis] = THREE.MathUtils.degToRad(degrees);
    this.transformChanged$.next();
  }

  public updatePosition(axis: 'x' | 'y' | 'z', value: number): void {
    const target = this.getCurrentModel();
    if (target) target.position[axis] = value;
    this.transformChanged$.next();
  }

  public updateBackgroundColor(color: string): void {
    if (this.scene) this.scene.background = new THREE.Color(color);
  }

  public updateLightIntensity(intensity: number): void {
    if (this.directionalLight) this.directionalLight.intensity = intensity;
    if (this.ambientLight) this.ambientLight.intensity = intensity * 0.55;
  }

  public toggleWireframe(): boolean {
    this.isWireframeEnabled = !this.isWireframeEnabled;
    this.applyWireframeState();
    return this.isWireframeEnabled;
  }

  private applyWireframeState(): void {
    this.objects.forEach(({ object }) => object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if ('wireframe' in material) material.wireframe = this.isWireframeEnabled;
      });
    }));
  }

  public toggleCamera(): boolean {
    if (!this.perspectiveCamera || !this.orthographicCamera) return this.isOrthographic;
    const previousCamera = this.camera;
    this.isOrthographic = !this.isOrthographic;
    this.camera = this.isOrthographic ? this.orthographicCamera : this.perspectiveCamera;
    if (this.renderPass) this.renderPass.camera = this.camera;
    this.camera.position.copy(previousCamera.position);
    this.camera.quaternion.copy(previousCamera.quaternion);
    if (this.controls) {
      this.controls.object = this.camera;
      this.controls.update();
    }
    if (this.transformControls) this.transformControls.camera = this.camera;
    if (this.bokehPass) this.bokehPass.camera = this.camera;
    return this.isOrthographic;
  }

  public resize(): void {
    if (!this.canvas || !this.renderer) return;
    const width = Math.max(this.canvas.clientWidth, 1);
    const height = Math.max(this.canvas.clientHeight, 1);
    const aspect = width / height;
    this.renderer.setSize(width, height, false);
    if (this.perspectiveCamera) {
      this.perspectiveCamera.aspect = aspect;
      this.perspectiveCamera.updateProjectionMatrix();
    }
    if (this.orthographicCamera) {
      this.orthographicCamera.left = -5 * aspect;
      this.orthographicCamera.right = 5 * aspect;
      this.orthographicCamera.updateProjectionMatrix();
    }
    this.composer?.setSize(width, height);
  }

  public resetCamera(): void {
    if (!this.camera || !this.controls) return;
    const focusObject = this.getCurrentModel();
    const bounds = focusObject ? new THREE.Box3().setFromObject(focusObject) : null;
    const target = bounds?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
    const radius = bounds ? Math.max(bounds.getBoundingSphere(new THREE.Sphere()).radius, 0.5) : 1;
    this.controls.target.copy(target);
    const direction = new THREE.Vector3(1, 0.72, 1.25).normalize();
    const aspect = Math.max((this.canvas?.clientWidth ?? 1) / (this.canvas?.clientHeight ?? 1), 0.1);
    const verticalFov =
      this.camera instanceof THREE.PerspectiveCamera
        ? THREE.MathUtils.degToRad(this.camera.fov)
        : Math.PI / 4;
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const fitFov = Math.min(verticalFov, horizontalFov);
    const distance = (radius / Math.sin(fitFov / 2)) * 1.2;
    this.camera.position.copy(target).addScaledVector(direction, distance);
    if (this.camera instanceof THREE.OrthographicCamera) {
      const halfHeight = (radius * 1.25) / Math.min(aspect, 1);
      this.camera.top = halfHeight;
      this.camera.bottom = -halfHeight;
      this.camera.left = -halfHeight * aspect;
      this.camera.right = halfHeight * aspect;
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(target);
    this.controls.update();
  }

  public resetModelTransforms(): void {
    const target = this.getCurrentModel();
    if (!target) return;
    const initial = this.initialNodeTransforms.get(target);
    if (initial) {
      target.position.copy(initial.position);
      target.rotation.copy(initial.rotation);
      target.scale.copy(initial.scale);
    } else {
      target.position.set(0, 0, 0);
      target.rotation.set(0, 0, 0);
      target.scale.set(1, 1, 1);
    }
    this.transformControls?.attach(target);
    this.transformChanged$.next();
  }

  public captureImage(): void {
    const image = this.captureImageDataUrl();
    if (!image) return;
    const link = document.createElement('a');
    link.href = image;
    link.download = 'render-3d.png';
    link.click();
  }

  public captureImageDataUrl(): string | null {
    if (!this.renderer || !this.canvas || !this.scene || !isPlatformBrowser(this.platformId)) return null;
    if (this.composer && !this.renderer.xr.isPresenting) this.composer.render();
    else this.renderer.render(this.scene!, this.camera);
    return this.canvas.toDataURL('image/png');
  }

  private refreshMaterials(): void {
    this.currentMaterials = [];
    const selected = this.getCurrentModel();
    const addMaterial = (material: THREE.Material): void => {
      if (this.currentMaterials.some((item) => item.uuid === material.uuid)) return;
      const color = 'color' in material && material.color instanceof THREE.Color
        ? `#${material.color.getHexString()}`
        : null;
      const value = material as THREE.Material & {
        roughness?: number;
        metalness?: number;
        opacity?: number;
        transparent?: boolean;
        emissive?: THREE.Color;
        emissiveIntensity?: number;
      };
      this.currentMaterials.push({
        uuid: material.uuid,
        name: material.name || material.type,
        type: material.type,
        color,
        roughness: typeof value.roughness === 'number' ? value.roughness : null,
        metalness: typeof value.metalness === 'number' ? value.metalness : null,
        opacity: value.opacity ?? 1,
        transparent: value.transparent ?? false,
        emissive: value.emissive instanceof THREE.Color ? `#${value.emissive.getHexString()}` : null,
        emissiveIntensity: typeof value.emissiveIntensity === 'number' ? value.emissiveIntensity : 1,
        materialRef: material,
      });
    };
    const visit = (object: THREE.Object3D): void => {
      if (object instanceof THREE.Mesh) {
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach(addMaterial);
      }
      object.children.forEach(visit);
    };
    if (selected) visit(selected);
    this.materialsLoaded$.next();
  }

  public updateMaterialColor(uuid: string, hexColor: string): void {
    const item = this.currentMaterials.find((material) => material.uuid === uuid);
    if (item?.color && 'color' in item.materialRef && item.materialRef.color instanceof THREE.Color) {
      item.materialRef.color.set(hexColor);
    }
  }

  public updateMaterialProperty(uuid: string, property: 'roughness' | 'metalness' | 'opacity' | 'emissiveIntensity', value: number): void {
    const material = this.currentMaterials.find((item) => item.uuid === uuid)?.materialRef as
      | (THREE.Material & { roughness?: number; metalness?: number; opacity: number; emissiveIntensity?: number })
      | undefined;
    if (!material) return;
    material[property] = value;
    if (property === 'opacity') {
      material.transparent = value < 1;
      material.needsUpdate = true;
    }
    if (property === 'emissiveIntensity') {
      const item = this.currentMaterials.find((entry) => entry.uuid === uuid);
      if (item) item.emissiveIntensity = value;
    }
  }

  public updateMaterialEmissive(uuid: string, hexColor: string): void {
    const item = this.currentMaterials.find((material) => material.uuid === uuid);
    if (item?.emissive && 'emissive' in item.materialRef && item.materialRef.emissive instanceof THREE.Color) {
      item.materialRef.emissive.set(hexColor);
      item.emissive = hexColor;
    }
  }

  // ========================================================================
  // COLABORACIÓN EN TIEMPO REAL
  // ========================================================================

  joinCollaboration(uid: string, displayName: string): void {
    if (this.collaborators.has(uid)) return;
    // El cursor propio nunca se dibuja como colaborador remoto.
    if (uid === this.ownCursorUid) return;
    const color = this.collaboratorColor(uid);
    this.collaborators.set(uid, { displayName, color, objectId: null, x: 0, y: 0, hasCursor: false });
    this.collaboratorJoined$.next({ uid, displayName, color });
    this.spawnCollaboratorMarker(uid, color);
  }

  leaveCollaboration(uid: string): void {
    if (!this.collaborators.has(uid)) return;
    this.collaborators.delete(uid);
    this.removeCollaboratorMarker(uid);
    this.collaboratorLeft$.next(uid);
  }

  setOwnCursorUid(uid: string): void {
    this.ownCursorUid = uid;
    // Guardamos el color propio para el broadcast, pero sin marcador 3D:
    // el cursor local lo dibuja el navegador, no la escena.
    if (!this.collaborators.has(uid)) {
      this.collaborators.set(uid, {
        displayName: uid,
        color: this.collaboratorColor(uid),
        objectId: null,
        x: 0,
        y: 0,
        hasCursor: false,
      });
    }
    this.removeCollaboratorMarker(uid);
  }

  updateOwnCursor(x: number, y: number): void {
    if (!this.ownCursorUid || !this.canvas) return;
    const collab = this.collaborators.get(this.ownCursorUid);
    if (!collab) return;
    collab.hasCursor = true;
    this.moveCollaboratorMarker(this.ownCursorUid, x, y);
    this.remoteCursor$.next({ uid: this.ownCursorUid, x, y, color: collab.color, hasCursor: true });
  }

  updateCollaboratorCursor(uid: string, x: number, y: number): void {
    const collab = this.collaborators.get(uid);
    if (!collab) return;
    const clampedX = Math.min(0.93, Math.max(0.07, x));
    const clampedY = Math.min(0.93, Math.max(0.07, y));
    collab.x = clampedX;
    collab.y = clampedY;
    collab.hasCursor = true;
    this.moveCollaboratorMarker(uid, clampedX, clampedY);
    this.remoteCursor$.next({ uid, x: clampedX, y: clampedY, color: collab.color, hasCursor: true });
  }

  setCollaboratorSelection(uid: string, objectId: string | null): void {
    const collab = this.collaborators.get(uid);
    if (!collab) return;
    collab.objectId = objectId;
    this.collaboratorSelection$.next({ uid, objectId });
    this.updateCollaboratorMarker(uid);
  }

  applyRemoteTransform(uid: string, objectId: string, position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }, scale: { x: number; y: number; z: number }): void {
    const target = this.objects.find((item) => item.id === objectId)?.object;
    if (!target) return;
    target.position.set(position.x, position.y, position.z);
    target.rotation.set(rotation.x, rotation.y, rotation.z);
    target.scale.set(scale.x, scale.y, scale.z);
    // No se re-emite collaboratorTransform$ aquí para evitar bucles;
    // los transformes remotos se aplican desde la presencia en model-editor.
  }

  getCollaborators(): Array<{ uid: string; displayName: string; color: string; objectId: string | null }> {
    return Array.from(this.collaborators.entries()).map(([uid, c]) => ({ uid, displayName: c.displayName, color: c.color, objectId: c.objectId }));
  }

  private collaboratorColor(uid: string): string {
    const colors = ['#8b5cf6', '#38bdf8', '#f59e0b', '#34d399', '#fb923c', '#a78bfa', '#c4b5fd', '#f472b6'];
    let hash = 0;
    for (let i = 0; i < uid.length; i++) {
      hash = (hash << 5) - hash + uid.charCodeAt(i);
      hash |= 0;
    }
    return colors[Math.abs(hash) % colors.length];
  }

  private spawnCollaboratorMarker(uid: string, color: string): void {
    // No dibujamos un marcador 3D grande; la etiqueta HTML con el nombre
    // del colaborador y su color es suficiente y evita el "bola flotante".
    return;
  }

  private removeCollaboratorMarker(uid: string): void {
    const group = this.collaboratorObjects.get(uid);
    if (!group) return;
    this.scene?.remove(group);
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
    this.collaboratorObjects.delete(uid);
  }

  private moveCollaboratorMarker(uid: string, x: number, y: number): void {
    const group = this.collaboratorObjects.get(uid);
    if (!group || !this.camera || !this.canvas) return;
    group.visible = true;
    // Convertir coordenadas de pantalla (0-1) a mundo 3D cerca de la cámara
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x * 2 - 1, -(y * 2 - 1)), this.camera);
    const dir = raycaster.ray.direction;
    const pos = raycaster.ray.origin.clone().addScaledVector(dir, 3);
    group.position.copy(pos);
    // Mantener el anillo mirando a la cámara para que siempre se lea bien.
    group.lookAt(this.camera.position);
  }

  private updateCollaboratorMarker(uid: string): void {
    const group = this.collaboratorObjects.get(uid);
    const collab = this.collaborators.get(uid);
    if (!group || !collab) return;
    // El marcador sigue el cursor del colaborador (si aún no lo movió, permanece oculto).
    if (collab.hasCursor) {
      this.moveCollaboratorMarker(uid, collab.x, collab.y);
      return;
    }
    group.visible = false;
  }

  public ngOnDestroy(): void {
    for (const uid of Array.from(this.remoteSelectionMarkers.keys())) {
      this.clearRemoteSelectionMarker(uid);
    }
    this.releaseViewport();
    this.timer.dispose();
    this.transformChanged$.complete();
    this.materialsLoaded$.complete();
    this.sceneChanged$.complete();
    this.selectionChanged$.complete();
    this.hotspotsChanged$.complete();
    this.presentationChanged$.complete();
    this.xrStatus$.complete();
  }
}
