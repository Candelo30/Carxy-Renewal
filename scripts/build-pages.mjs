#!/usr/bin/env node
/**
 * Build reproducible para GitHub Pages.
 *
 * Uso:
 *   npm run build:pages
 *   PAGES_BASE_HREF=/ npm run build:pages   (dominio personalizado)
 */
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const baseHref = (process.env.PAGES_BASE_HREF || '/Carxy-Renewal/').trim();

if (!baseHref.startsWith('/') || !baseHref.endsWith('/')) {
  console.error('[pages] PAGES_BASE_HREF debe empezar y terminar con "/".');
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...options.env },
    shell: options.shell ?? false,
  });
  if (result.error) {
    console.error(`[pages] No se pudo ejecutar ${command}:`, result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// Permite sobrescribir la configuración pública de Firebase desde CI.
run(process.execPath, ['scripts/write-firebase-config.mjs']);

run(
  process.platform === 'win32' ? 'npx' : 'npx',
  ['ng', 'build', 'angular-3d-editor-pages', '--base-href', baseHref],
  { shell: process.platform === 'win32' },
);

run(process.execPath, ['scripts/prepare-pages.mjs'], {
  env: { PAGES_BASE_HREF: baseHref },
});
