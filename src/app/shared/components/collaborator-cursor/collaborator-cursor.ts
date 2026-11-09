import { Component, inject, input } from '@angular/core';
import { ThreeEngineService } from '../../../core/services/three-engine';

@Component({
  selector: 'app-collaborator-cursor',
  standalone: true,
  imports: [],
  template: `
    <div class="collab-cursor"
         [style.left.%]="cursorX()"
         [style.top.%]="cursorY()"
         [style.--color]="collab().color"
         [attr.title]="collab().displayName">
      <div class="collab-dot"></div>
      <span class="collab-name">{{ collab().displayName }}</span>
    </div>
  `,
  styles: [`
    :host {
      position: absolute;
      z-index: 10;
      pointer-events: none;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.7rem;
      font-weight: 700;
      color: var(--text-primary);
      white-space: nowrap;
    }

    .collab-cursor {
      position: relative;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .collab-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--color);
      border: 2px solid #ffffff;
      box-shadow: 0 0 10px var(--color);
      transform: translate(-4px, -4px);
    }

    .collab-name {
      padding: 2px 6px;
      border-radius: 4px;
      background: color-mix(in srgb, var(--color) 20%, var(--surface-panel));
      border: 1px solid color-mix(in srgb, var(--color) 50%, var(--border-color));
      color: var(--text-primary);
    }
  `],
})
export class CollaboratorCursorComponent {
  readonly engine = inject(ThreeEngineService);
  readonly collab = input.required<{ uid: string; displayName: string; color: string }>();
  readonly cursorX = input.required<number>();
  readonly cursorY = input.required<number>();
}
