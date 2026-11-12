#!/usr/bin/env node
/**
 * Prepara la salida estática para GitHub Pages:
 * - fija el base href del despliegue;
 * - crea 404.html para enlaces profundos;
 * - crea directorios de rutas conocidas;
 * - añade .nojekyll para no procesar los assets con Jekyll.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const outputDir = resolve('dist/github-pages/browser');
const indexPath = join(outputDir, 'index.html');

if (!existsSync(indexPath)) {
  console.error(
    '[pages] No existe dist/github-pages/browser/index.html. Ejecuta primero el build estático.',
  );
  process.exit(1);
}

const rawBaseHref = (process.env.PAGES_BASE_HREF || '/Carxy-Renewal/').trim();
if (!rawBaseHref.startsWith('/') || !rawBaseHref.endsWith('/')) {
  console.error('[pages] PAGES_BASE_HREF debe empezar y terminar con "/".');
  process.exit(1);
}
const baseHref = rawBaseHref;

let html = readFileSync(indexPath, 'utf8');
if (!/<base\s+href="[^"]*"\s*\/?>/i.test(html)) {
  console.error('[pages] index.html no contiene una etiqueta <base href="…">.');
  process.exit(1);
}
html = html.replace(
  /<base\s+href="[^"]*"\s*\/?>/i,
  `<base href="${baseHref}">`,
);
writeFileSync(indexPath, html, 'utf8');

// GitHub Pages sirve 404.html para rutas desconocidas. La app usa clean URLs,
// así que el fallback debe ser una copia del shell de Angular.
writeFileSync(join(outputDir, '404.html'), html, 'utf8');
writeFileSync(join(outputDir, '.nojekyll'), '', 'utf8');

const routes = [
  'editor',
  'feed',
  'login',
  'register',
  'forgot-password',
  'profile',
  'chat',
  'my-models',
  'favorites',
  'projects',
  'dashboard',
  'admin',
  'moderation',
  'help',
  'getting-started',
  'about',
  'community-help',
  'contact',
  'ayuda',
  'guia',
  'nosotros',
  'ayuda-comunitaria',
  'contacto',
];

for (const route of routes) {
  const routeDir = join(outputDir, route);
  mkdirSync(routeDir, { recursive: true });
  writeFileSync(join(routeDir, 'index.html'), html, 'utf8');
}

const customDomain = process.env.PAGES_CUSTOM_DOMAIN?.trim();
if (customDomain) {
  writeFileSync(join(outputDir, 'CNAME'), `${customDomain}\n`, 'utf8');
  console.log(`[pages] CNAME configurado para ${customDomain}.`);
}

console.log(
  `[pages] Listo: base href ${baseHref}, 404.html, .nojekyll y ${routes.length} rutas.`,
);
