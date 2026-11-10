/**
 * Utilidades de compartir y portapapeles.
 * Se usan desde el feed y la paleta de comandos, siempre en el navegador.
 */

export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === 'undefined') {
    throw new Error('No se pudo copiar el enlace en este entorno.');
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();

  if (!copied) throw new Error('El navegador no permitió copiar el enlace.');
}

export async function shareOrCopy(
  url: string,
  title: string,
  text = '',
): Promise<'shared' | 'copied'> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (error) {
      // El usuario canceló el diálogo nativo: no es un error.
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'shared';
      }
    }
  }

  await copyText(url);
  return 'copied';
}

/** Construye una URL absoluta respetando el base href de GitHub Pages. */
export function absoluteAppUrl(path: string, baseUri: string): string {
  const base = baseUri.endsWith('/') ? baseUri : `${baseUri}/`;
  return new URL(path.replace(/^\//, ''), base).toString();
}
