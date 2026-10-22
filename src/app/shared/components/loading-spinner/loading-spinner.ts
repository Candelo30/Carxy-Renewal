import { Component, input } from '@angular/core';

export type LoadingSpinnerVariant = 'inline' | 'panel';

@Component({
  standalone: true,
  selector: 'app-loading-spinner',
  styleUrl: './loading-spinner.css',
  templateUrl: './loading-spinner.html',
})
export class LoadingSpinner {
  readonly label = input('Cargando…');
  readonly variant = input<LoadingSpinnerVariant>('panel');
}
