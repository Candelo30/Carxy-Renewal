import { Injectable, NgZone } from '@angular/core';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import * as THREE from 'three';
import { ThreeEngineService } from './three-engine';
import { NotificationService } from './notifications';

@Injectable({
  providedIn: 'root',
})
export class FileHandler {
  private gltfLoader = new GLTFLoader();
  private gltfExporter = new GLTFExporter();

  constructor(
    private threeEngine: ThreeEngineService,
    private ngZone: NgZone,
    private notifications: NotificationService,
  ) {}

  // --- Cargar archivo .glb / .gltf ---
  public loadLocalGLTF(file: File): void {
    const objectUrl = URL.createObjectURL(file);

    this.gltfLoader.load(
      objectUrl,
      (gltf) => {
        // Ejecutamos la carga dentro de la zona de Angular
        this.ngZone.run(() => {
          const modelName = file.name.replace(/\.(glb|gltf)$/i, '');
          this.threeEngine.addModelToScene(gltf.scene, modelName || file.name);
          URL.revokeObjectURL(objectUrl);
          this.notifications.success(`Se importó ${file.name}.`, 'Modelo importado');
        });
      },
      undefined,
      (error) => {
        console.error('Error al cargar el modelo 3D:', error);
        URL.revokeObjectURL(objectUrl);
        this.ngZone.run(() => this.notifications.error(
          error instanceof Error ? error.message : 'Revisa que el archivo GLB o glTF sea válido.',
          'No se pudo importar el modelo',
        ));
      },
    );
  }

  // --- Exportar escena actual a .glb ---
  public exportCurrentModelGLB(): void {
    void this.createCurrentSceneBlob()
      .then((blob) => {
        this.downloadFile(blob, 'escena-3d.glb');
        this.notifications.success('La escena se exportó como archivo GLB.', 'Exportación lista');
      })
      .catch((error: unknown) => {
        console.error('Error al exportar a GLB:', error);
        this.notifications.error(
          error instanceof Error ? error.message : 'No se pudo exportar la escena.',
          'Error de exportación',
        );
      });
  }

  public createCurrentSceneBlob(): Promise<Blob> {
    const model = new THREE.Group();
    this.threeEngine.getSceneObjects().forEach(({ object }) => model.add(object.clone(true)));
    if (model.children.length === 0) return Promise.reject(new Error('No hay ningún modelo en la escena para exportar.'));

    return new Promise((resolve, reject) => {
      this.gltfExporter.parse(
        model,
        (gltf) => {
          if (!(gltf instanceof ArrayBuffer)) {
            reject(new Error('El exportador no produjo un archivo GLB binario.'));
            return;
          }
          resolve(new Blob([gltf], { type: 'model/gltf-binary' }));
        },
        (error) => reject(error),
        { binary: true },
      );
    });
  }

  public async loadGLBBlob(blob: Blob, name: string): Promise<void> {
    const data = await blob.arrayBuffer();
    await new Promise<void>((resolve, reject) => {
      this.gltfLoader.parse(
        data,
        '',
        (gltf) => {
          this.ngZone.run(() => this.threeEngine.addModelToScene(gltf.scene, name));
          resolve();
        },
        reject,
      );
    });
  }

  private downloadFile(blob: Blob, fileName: string): void {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  }
}
