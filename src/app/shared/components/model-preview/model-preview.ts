import { isPlatformBrowser } from '@angular/common';
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, Input, OnDestroy, PLATFORM_ID, ViewChild, inject } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

@Component({
  selector: 'app-model-preview',
  standalone: true,
  template: `
    <div class="preview-viewport">
      <canvas #canvas aria-label="Visor 3D interactivo"></canvas>
      @if (loading) { <span class="preview-message">Cargando modelo 3D…</span> }
      @if (error) { <span class="preview-message preview-error" role="alert">{{ error }}</span> }
      <span class="preview-hint">Arrastra para orbitar · rueda para zoom</span>
    </div>
  `,
  styles: [`
    :host { display:block; }
    .preview-viewport { position:relative; width:100%; aspect-ratio:1.55; overflow:hidden; background:radial-gradient(ellipse at 50% 40%,#273247,#11141c 72%); }
    canvas { display:block; width:100%; height:100%; touch-action:none; }
    .preview-message { position:absolute; inset:0; display:grid; place-items:center; padding:18px; color:#cbd4e4; font-size:.82rem; text-align:center; }
    .preview-error { color:#ff9aa9; }
    .preview-hint { position:absolute; right:10px; bottom:9px; padding:5px 8px; border:1px solid #ffffff20; border-radius:7px; background:#11141caa; color:#aeb7c8; font-size:.63rem; pointer-events:none; }
    @media(prefers-reduced-motion:reduce) { * { scroll-behavior:auto; } }
  `],
})
export class ModelPreviewComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) modelUrl = '';
  @ViewChild('canvas', { static: true }) private canvasRef!: ElementRef<HTMLCanvasElement>;
  loading = true;
  error = '';

  private readonly platformId = inject(PLATFORM_ID);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private controls?: OrbitControls;
  private model?: THREE.Object3D;
  private loadController?: AbortController;
  private frame = 0;
  private resizeObserver?: ResizeObserver;
  private destroyed = false;

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    void this.loadModel();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.loadController?.abort();
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.disposeObject(this.model);
    this.renderer?.dispose();
  }

  private async loadModel(): Promise<void> {
    const controller = new AbortController();
    this.loadController = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 20_000);

    try {
      if (!this.modelUrl) throw new Error('URL vacía');

      const response = await fetch(this.modelUrl, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      if (this.destroyed) return;

      const gltf = await new Promise<GLTF>((resolve, reject) => {
        new GLTFLoader().parse(data, '', resolve, reject);
      });
      if (this.destroyed) {
        this.disposeObject(gltf.scene);
        return;
      }

      this.setupRenderer();
      this.model = gltf.scene;
      this.scene?.add(this.model);
      this.fitModel();
    } catch (error) {
      if (this.destroyed) return;
      console.error('No se pudo cargar el modelo para la vista previa.', error);
      this.error = this.getLoadErrorMessage(error, controller.signal.aborted);
    } finally {
      window.clearTimeout(timeoutId);
      if (!this.destroyed) {
        this.loading = false;
        this.changeDetector.markForCheck();
      }
    }
  }

  private getLoadErrorMessage(error: unknown, aborted: boolean): string {
    if (aborted) return 'La carga del modelo tardó demasiado. Inténtalo de nuevo más tarde.';
    if (error instanceof TypeError) {
      return 'No se pudo acceder al modelo. Revisa CORS y los permisos de Firebase Storage.';
    }
    if (error instanceof Error && error.message.startsWith('HTTP ')) {
      return `Firebase Storage rechazó la descarga (${error.message.slice(5)}).`;
    }
    if (error instanceof Error && /webgl/i.test(error.message)) {
      return 'WebGL no está disponible en este navegador.';
    }
    return 'No se pudo cargar el modelo 3D. Comprueba que el archivo GLB sea válido.';
  }

  private setupRenderer(): void {
    const canvas = this.canvasRef.nativeElement;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000);
    this.camera.position.set(3.5, 2.5, 4.5);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x202438, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 6, 5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x6bc8ff, 0.8);
    fill.position.set(-4, 2, -4);
    this.scene.add(fill);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    const render = () => {
      this.frame = requestAnimationFrame(render);
      this.controls?.update();
      if (this.scene && this.camera) this.renderer?.render(this.scene, this.camera);
    };
    render();
  }

  private resize(): void {
    const element = this.canvasRef.nativeElement.parentElement;
    const width = Math.max(1, element?.clientWidth ?? 1);
    const height = Math.max(1, element?.clientHeight ?? 1);
    if (this.camera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    this.renderer?.setSize(width, height, false);
  }

  private fitModel(): void {
    if (!this.model || !this.camera || !this.controls) return;
    const bounds = new THREE.Box3().setFromObject(this.model);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, size.z, 0.01);
    this.model.position.sub(center);
    this.camera.position.set(maxSize * 1.5, maxSize * 1.1, maxSize * 1.8);
    this.camera.near = Math.max(maxSize / 1000, 0.001);
    this.camera.far = maxSize * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = maxSize * 0.2;
    this.controls.maxDistance = maxSize * 20;
    this.controls.update();
  }

  private disposeObject(object?: THREE.Object3D): void {
    object?.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        Object.values(material).forEach((value) => {
          if (value instanceof THREE.Texture) value.dispose();
        });
        material.dispose();
      });
    });
  }
}
