import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, NgZone, OnDestroy, PLATFORM_ID } from '@angular/core';
import { Subject } from 'rxjs';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';

export type PrimitiveType = 'box' | 'sphere' | 'cylinder' | 'torus';

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
      this.ambientLight = new THREE.AmbientLight(0xffffff, 0.66);
      this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
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
    this.initializePostProcessing(width, height);
    this.detectARSupport();

    if (firstSceneInitialization && this.objects.length === 0
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
      restoredObjects.forEach((object) => this.addObject(object, object.name || 'Modelo'));
      return true;
    } catch (error) {
      console.error('No se pudo restaurar el borrador de la escena.', error);
      return false;
    }
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

  public selectObject(id: string): void {
    const item = this.objects.find((entry) => entry.id === id);
    if (!item || (item.object === this.currentModel && this.selectedNode === item.object)) return;
    this.currentModel = item.object;
    this.selectedNode = item.object;
    this.transformControls?.attach(this.selectedNode);
    this.audioBaseScale.copy(this.selectedNode.scale);
    this.applyWireframeState();
    this.refreshMaterials();
    this.selectionChanged$.next();
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
      label: `Nota ${this.hotspotRecords.length + 1}`,
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
    this.sceneChanged$.next();
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

  public addPrimitive(type: PrimitiveType): void {
    if (!this.scene) {
      this.pendingPrimitives.push(type);
      return;
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
      default:
        geometry = new THREE.BoxGeometry(1.6, 1.6, 1.6);
        name = 'Cubo';
    }
    const primitiveColors: Record<PrimitiveType, string> = {
      box: '#8b5cf6',
      sphere: '#38bdf8',
      cylinder: '#f59e0b',
      torus: '#34d399',
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
    this.addObject(group, name);
    this.resetCamera();
  }

  private addObject(object: THREE.Group, name: string): void {
    if (!this.scene) return;
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
    const item = { id: `object-${this.nextObjectId++}`, name, object };
    this.initialPositions.set(object, object.position.clone());
    this.objects.push(item);
    this.scene.add(object);
    this.selectObject(item.id);
    this.sceneChanged$.next();
  }

  public deleteCurrentModel(): void {
    if (!this.scene || !this.currentModel) return;
    const removed = this.currentModel;
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

  public updateRotation(axis: 'x' | 'y' | 'z', degrees: number): void {
    const target = this.getCurrentModel();
    if (target) target.rotation[axis] = THREE.MathUtils.degToRad(degrees);
  }

  public updatePosition(axis: 'x' | 'y' | 'z', value: number): void {
    const target = this.getCurrentModel();
    if (target) target.position[axis] = value;
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

  public updateMaterialProperty(uuid: string, property: 'roughness' | 'metalness' | 'opacity', value: number): void {
    const material = this.currentMaterials.find((item) => item.uuid === uuid)?.materialRef as
      | (THREE.Material & { roughness?: number; metalness?: number; opacity: number })
      | undefined;
    if (!material) return;
    material[property] = value;
    if (property === 'opacity') {
      material.transparent = value < 1;
      material.needsUpdate = true;
    }
  }

  public ngOnDestroy(): void {
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
