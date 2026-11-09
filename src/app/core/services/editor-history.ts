import { Injectable, OnDestroy, inject } from '@angular/core';
import { BehaviorSubject, Subscription, auditTime, merge } from 'rxjs';
import { ThreeEngineService } from './three-engine';

const MAX_HISTORY = 40;

@Injectable({ providedIn: 'root' })
export class EditorHistoryService implements OnDestroy {
  private readonly engine = inject(ThreeEngineService);
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private lastSnapshot = '';
  private capturing = false;
  private primed = false;
  private readonly canUndoSubject = new BehaviorSubject(false);
  private readonly canRedoSubject = new BehaviorSubject(false);
  private readonly subscription = new Subscription();

  readonly canUndo$ = this.canUndoSubject.asObservable();
  readonly canRedo$ = this.canRedoSubject.asObservable();

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Start listening to scene mutations (call once from the editor page). */
  attach(): void {
    if (this.primed) return;
    this.primed = true;
    this.lastSnapshot = this.safeSerialize();
    this.subscription.add(
      merge(this.engine.sceneChanged$, this.engine.transformChanged$)
        .pipe(auditTime(450))
        .subscribe(() => this.rememberCurrentAsUndoPoint()),
    );
  }

  /** Explicit checkpoint right before an action (delete, duplicate, etc.). */
  checkpoint(): void {
    if (this.capturing) return;
    const snapshot = this.safeSerialize();
    if (!snapshot || snapshot === this.lastSnapshot) return;
    this.pushUndo(this.lastSnapshot);
    this.lastSnapshot = snapshot;
    this.redoStack = [];
    this.publish();
  }

  undo(): boolean {
    if (!this.undoStack.length) return false;
    const current = this.safeSerialize();
    const previous = this.undoStack.pop()!;
    if (current) this.redoStack.push(current);
    return this.apply(previous);
  }

  redo(): boolean {
    if (!this.redoStack.length) return false;
    const current = this.safeSerialize();
    const next = this.redoStack.pop()!;
    if (current) this.pushUndo(current);
    return this.apply(next);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.lastSnapshot = this.safeSerialize();
    this.publish();
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  private rememberCurrentAsUndoPoint(): void {
    if (this.capturing) return;
    const snapshot = this.safeSerialize();
    if (!snapshot || snapshot === this.lastSnapshot) return;
    this.pushUndo(this.lastSnapshot);
    this.lastSnapshot = snapshot;
    this.redoStack = [];
    this.publish();
  }

  private apply(snapshot: string): boolean {
    this.capturing = true;
    try {
      const ok = this.engine.restoreScene(snapshot);
      this.lastSnapshot = snapshot;
      this.publish();
      return ok;
    } catch (error) {
      console.error('No se pudo restaurar el historial del editor.', error);
      return false;
    } finally {
      this.capturing = false;
    }
  }

  private pushUndo(snapshot: string): void {
    if (!snapshot) return;
    if (this.undoStack.at(-1) === snapshot) return;
    this.undoStack.push(snapshot);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
  }

  private safeSerialize(): string {
    try {
      return this.engine.serializeScene();
    } catch {
      return '';
    }
  }

  private publish(): void {
    this.canUndoSubject.next(this.canUndo);
    this.canRedoSubject.next(this.canRedo);
  }
}
