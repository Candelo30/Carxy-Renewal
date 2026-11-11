import { Injectable, signal } from '@angular/core';

export type EditorSaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Estado compartido de la sesión de edición: sirve para el badge "Guardado"
 * y el chip de colaboradores que viven en la página del editor.
 * Lo alimenta el ModelEditor; las vistas lo consumen como signals.
 */
@Injectable({ providedIn: 'root' })
export class EditorStatusService {
  /** 'idle' oculta el badge; cualquier otro valor lo muestra. */
  readonly saveState = signal<EditorSaveState>('idle');
  /** Marca de tiempo del último guardado completado. */
  readonly lastSavedAt = signal<number | null>(null);
  /** Número de colaboradores en línea (incluyéndote). null = sin sesión/proyecto. */
  readonly onlineCount = signal<number | null>(null);
}
