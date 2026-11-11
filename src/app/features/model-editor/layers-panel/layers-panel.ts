import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-layers-panel',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './layers-panel.html',
  styleUrl: './layers-panel.css',
})
export class LayersPanelComponent {
  @Input() layers: string[] = [];
  @Input() selectedLayer: string | null = null;
  @Input() hasSelectedObject = false;
  /** Visibilidad por capa (true = visible). */
  @Input() layerVisibility: Record<string, boolean> = {};

  @Output() add = new EventEmitter<void>();
  @Output() remove = new EventEmitter<void>();
  @Output() toggleVisibility = new EventEmitter<string>();
  @Output() assignSelected = new EventEmitter<void>();
  @Output() removeSelected = new EventEmitter<void>();

  isVisible(layer: string): boolean {
    return this.layerVisibility[layer] ?? true;
  }
}
