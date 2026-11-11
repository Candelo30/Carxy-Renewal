import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService, TranslationParams } from '../../core/services/i18n';

@Pipe({
  name: 'translate',
  standalone: true,
  // En detección de cambios zoneless basada en señales, un pipe puro reutilizaría
  // su valor cacheado y no refrescaría las traducciones al cambiar de idioma.
  // Transform lee la señal `language` del I18nService, lo que registra la dependencia
  // de la vista y fuerza su reevaluación; el coste es una búsqueda en objeto por ciclo.
  pure: false,
})
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(key: string | null | undefined, params?: TranslationParams): string {
    return this.i18n.translate(key, params);
  }
}
