import { TestBed } from '@angular/core/testing';
import { I18nService } from './i18n';

describe('I18nService', () => {
  let service: I18nService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(I18nService);
  });

  it('devuelve el texto en español cuando la clave no está traducida', () => {
    expect(service.translate('Un texto que no existe')).toBe('Un texto que no existe');
  });

  it('interpola parámetros en la traducción', () => {
    expect(service.translate('{count} mensajes nuevos', { count: 3 })).toBe('3 mensajes nuevos');
  });

  it('traduce las claves semánticas comunes', () => {
    expect(service.translate('common.cancel')).toBe('Cancelar');
    expect(service.translate('common.send')).toBe('Enviar');
  });

  it('cae al inglés cuando el idioma elegido todavía no ha cargado su capa', async () => {
    service.setLanguage('de');
    // La capa se descarga bajo demanda: hasta que llega, la cadena base es la
    // que se muestra, sin lanzar errores.
    expect(() => service.translate('common.cancel')).not.toThrow();
    expect(service.language()).toBe('de');
  });

  it('mantiene la consulta estable entre idiomas', () => {
    const spanish = service.translate('common.save');
    service.setLanguage('en');
    expect(service.translate('common.save')).toBe(spanish);
  });
});
