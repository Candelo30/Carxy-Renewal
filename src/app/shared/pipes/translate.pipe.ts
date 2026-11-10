import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService, TranslationParams } from '../../core/services/i18n';

@Pipe({
  name: 'translate',
  standalone: true,
  pure: false,
})
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(key: string | null | undefined, params?: TranslationParams): string {
    return this.i18n.translate(key, params);
  }
}
