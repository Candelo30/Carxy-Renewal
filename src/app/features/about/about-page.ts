import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer';import { TranslatePipe } from '../../shared/pipes/translate.pipe';

type PreviewMode = 'solid' | 'wireframe' | 'exploded' | 'xray' | 'team';

interface ExteriorOption {
  id: string;
  label: string;
  finish: string;
  swatch: string;
  paintStart: string;
  paintEnd: string;
}

type FinishId = 'gloss' | 'metallic' | 'matte';
type WheelId = 'sport' | 'steel' | 'aero';
type BodyId = 'coupe' | 'sedan' | 'familiar';

interface FinishOption {
  id: FinishId;
  label: string;
  gloss: number;
  sheen: number;
}

interface WheelOption {
  id: WheelId;
  label: string;
  rim: string;
  accent: string;
  hub: string;
}

interface BodyOption {
  id: BodyId;
  label: string;
  roof: string;
  rear: string;
  side: string;
}

interface InteriorOption {
  id: string;
  label: string;
  swatch: string;
  seat: string;
}


interface AboutFeature {
  icon: string;
  title: string;
  description: string;
}

interface AboutPrinciple {
  icon: string;
  title: string;
  description: string;
}

interface RoadmapItem {
  phase: string;
  tone: 'now' | 'next' | 'explore';
  items: string[];
}

@Component({
  selector: 'app-about-page',
  standalone: true,
  imports: [
    TranslatePipe,RouterLink, ShellHeaderComponent, SiteFooterComponent],
  templateUrl: './about-page.html',
  styleUrl: './about-page.css',
})
export class AboutPage {
  readonly repositoryUrl = 'https://github.com/Candelo30/Carxy-Renewal';

  protected previewMode: PreviewMode = 'solid';
  protected autoRotate = true;

  readonly previewModes: { id: PreviewMode; label: string }[] = [
    { id: 'solid', label: 'Sólido' },
    { id: 'wireframe', label: 'Alambre' },
    { id: 'exploded', label: 'Explosionado' },
    { id: 'xray', label: 'Rayos X' },
    { id: 'team', label: 'Trabajo en equipo' },
  ];

  protected setPreviewMode(mode: PreviewMode): void {
    this.previewMode = mode;
  }

  readonly exteriorOptions: ExteriorOption[] = [
    { id: 'arctic-white', label: 'Arctic White', finish: 'Acabado perlado', swatch: '#e5e7eb', paintStart: '#ffffff', paintEnd: '#cbd5e1' },
    { id: 'obsidian', label: 'Obsidian', finish: 'Acabado mate', swatch: '#111827', paintStart: '#1f2937', paintEnd: '#020617' },
    { id: 'crimson', label: 'Crimson Red', finish: 'Acabado brillante', swatch: '#dc2626', paintStart: '#ef4444', paintEnd: '#991b1b' },
    { id: 'midnight-azure', label: 'Midnight Azure', finish: 'Acabado metalizado', swatch: '#2563eb', paintStart: '#4f6df5', paintEnd: '#8b5cf6' },
    { id: 'solar-amber', label: 'Solar Amber', finish: 'Acabado brillante', swatch: '#f59e0b', paintStart: '#fbbf24', paintEnd: '#d97706' },
    { id: 'emerald', label: 'Emerald', finish: 'Acabado perlado', swatch: '#10b981', paintStart: '#34d399', paintEnd: '#047857' },
  ];

  readonly interiorOptions: InteriorOption[] = [
    { id: 'cognac-leather', label: 'Cuero coñac', swatch: '#7c4a21', seat: '#7c4a21' },
    { id: 'black-interior', label: 'Negro', swatch: '#111827', seat: '#111827' },
    { id: 'red-interior', label: 'Rojo', swatch: '#7f1d1d', seat: '#dc2626' },
    { id: 'cream-interior', label: 'Marfil', swatch: '#e5dcc5', seat: '#f3ead8' },
  ];

  readonly finishOptions: FinishOption[] = [
    { id: 'gloss', label: 'Brillante', gloss: 0.32, sheen: 0.9 },
    { id: 'metallic', label: 'Metalizado', gloss: 0.22, sheen: 0.7 },
    { id: 'matte', label: 'Mate', gloss: 0, sheen: 0.15 },
  ];

  readonly wheelOptions: WheelOption[] = [
    { id: 'sport', label: 'Sport', rim: '#7dd3fc', accent: '#e2e8f0', hub: '#0b1020' },
    { id: 'steel', label: 'Acero', rim: '#cbd5e1', accent: '#475569', hub: '#1f2937' },
    { id: 'aero', label: 'Aero', rim: '#a78bfa', accent: '#ddd6fe', hub: '#2e1065' },
  ];

  readonly bodyOptions: BodyOption[] = [
    { id: 'coupe', label: 'Coupé', roof: 'M 244 211 C 266 185 322 177 368 179 C 408 181 434 196 446 208 L 244 211 Z', rear: 'M 462 211 C 500 213 522 223 524 241 C 524 251 518 256 505 256 L 462 252 Z', side: 'M 160 240 C 260 232 420 232 518 240' },
    { id: 'sedan', label: 'Sedán', roof: 'M 238 207 C 258 177 318 165 370 167 C 416 169 444 188 452 207 L 238 207 Z', rear: 'M 452 207 C 500 210 524 224 526 241 C 526 251 519 256 503 256 L 452 252 Z', side: 'M 160 240 C 260 230 420 229 520 240' },
    { id: 'familiar', label: 'Familiar', roof: 'M 236 207 C 254 174 308 158 362 160 C 410 162 444 182 452 207 L 236 207 Z', rear: 'M 452 207 C 500 210 524 224 526 241 C 526 251 519 256 503 256 L 452 252 Z', side: 'M 160 240 C 260 231 420 231 520 240' },
  ];

  protected selectedFinishId: FinishId = 'metallic';
  protected selectedWheelId: WheelId = 'sport';
  protected selectedBodyId: BodyId = 'coupe';
  protected showSpoiler = false;
  protected lightsOn = false;

  protected selectedExteriorId = 'midnight-azure';
  protected selectedInteriorId = 'cognac-leather';
  protected savedAt: string | null = null;
  protected history: string[] = [];

  get selectedExterior(): ExteriorOption {
    return this.exteriorOptions.find((option) => option.id === this.selectedExteriorId) ?? this.exteriorOptions[0];
  }

  get selectedInterior(): InteriorOption {
    return this.interiorOptions.find((option) => option.id === this.selectedInteriorId) ?? this.interiorOptions[0];
  }

  get selectedFinish(): FinishOption {
    return this.finishOptions.find((option) => option.id === this.selectedFinishId) ?? this.finishOptions[1];
  }

  get selectedWheel(): WheelOption {
    return this.wheelOptions.find((option) => option.id === this.selectedWheelId) ?? this.wheelOptions[0];
  }

  get selectedBody(): BodyOption {
    return this.bodyOptions.find((option) => option.id === this.selectedBodyId) ?? this.bodyOptions[0];
  }

  get paintGlossOpacity(): number {
    return this.selectedFinish.gloss;
  }

  get paintSheenOpacity(): number {
    return this.selectedFinish.sheen;
  }

  get configurationSummary(): string {
    return `${this.selectedBody.label} · ${this.selectedExterior.label} (${this.selectedFinish.label}) · ${this.selectedInterior.label}`;
  }

  protected selectExterior(id: string): void {
    if (this.exteriorOptions.some((option) => option.id === id)) {
      this.selectedExteriorId = id;
      this.savedAt = null;
    }
  }

  protected selectInterior(id: string): void {
    if (this.interiorOptions.some((option) => option.id === id)) {
      this.selectedInteriorId = id;
      this.savedAt = null;
    }
  }

  protected selectFinish(id: FinishId): void {
    if (this.finishOptions.some((option) => option.id === id)) {
      this.selectedFinishId = id;
      this.savedAt = null;
    }
  }

  protected selectWheel(id: WheelId): void {
    if (this.wheelOptions.some((option) => option.id === id)) {
      this.selectedWheelId = id;
      this.savedAt = null;
    }
  }

  protected selectBody(id: BodyId): void {
    if (this.bodyOptions.some((option) => option.id === id)) {
      this.selectedBodyId = id;
      this.savedAt = null;
    }
  }

  protected toggleSpoiler(): void {
    this.showSpoiler = !this.showSpoiler;
    this.savedAt = null;
  }

  protected toggleLights(): void {
    this.lightsOn = !this.lightsOn;
    this.savedAt = null;
  }

  protected saveConfiguration(): void {
    this.savedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.history = [this.configurationSummary, ...this.history].slice(0, 4);
  }

  protected clearHistory(): void {
    this.history = [];
  }

  protected toggleRotation(): void {
    this.autoRotate = !this.autoRotate;
  }

  readonly stats = [
    { value: '100%', label: 'en el navegador' },
    { value: '0', label: 'instalaciones' },
    { value: 'GLB', label: 'importar y exportar' },
    { value: '3D', label: 'comunidad y remixes' },
  ];

  readonly features: AboutFeature[] = [
    {
      icon: '🧊',
      title: 'Editor 3D completo',
      description: 'Primitivas, jerarquía, gizmo de transformación, materiales, historial y vistas de cámara.',
    },
    {
      icon: '🔄',
      title: 'Importa y exporta',
      description: 'Carga modelos .glb y .gltf, explora su jerarquía y exporta la escena completa en un clic.',
    },
    {
      icon: '🎨',
      title: 'Materiales en vivo',
      description: 'Color, rugosidad, metalicidad y opacidad con previsualización inmediata en el visor.',
    },
    {
      icon: '🌐',
      title: 'Comunidad y remixes',
      description: 'Feed curado, perfiles de creador, likes, comentarios, seguimiento y remixes con crédito.',
    },
    {
      icon: '🤝',
      title: 'Colaboración',
      description: 'Cursores de colaboradores, selección compartida y transformaciones sincronizadas en la escena.',
    },
    {
      icon: '🛡',
      title: 'Seguridad primero',
      description: 'Verificación de correo, contraseñas fuertes, roles, moderación y reglas estrictas en Firestore.',
    },
  ];

  readonly principles: AboutPrinciple[] = [
    {
      icon: '🔒',
      title: 'Privacidad por defecto',
      description: 'Tú decides qué es público y qué es privado. Los datos de demostración se quedan en tu navegador.',
    },
    {
      icon: '♿',
      title: 'Accesible por diseño',
      description: 'Navegación por teclado, foco visible, contraste cuidado y movimiento reducido cuando lo pides.',
    },
    {
      icon: '💬',
      title: 'Comunidad con respeto',
      description: 'Herramientas de reporte, moderación y reglas claras para que compartir sea seguro.',
    },
    {
      icon: '🧩',
      title: 'Proyecto abierto',
      description: 'El código está en GitHub. Puedes revisarlo, aprender de él y proponer mejoras.',
    },
  ];

  readonly roadmap: RoadmapItem[] = [
    {
      phase: 'Ahora',
      tone: 'now',
      items: ['Editor 3D y feed social', 'Perfiles, chat y notificaciones', 'Moderación y panel de administración'],
    },
    {
      phase: 'Próximo',
      tone: 'next',
      items: ['Más primitivas y texturas', 'Plantillas de escena', 'Mejor colaboración en tiempo real'],
    },
    {
      phase: 'Explorando',
      tone: 'explore',
      items: ['Realidad aumentada', 'Audio reactivo', 'Exportación avanzada y animaciones'],
    },
  ];

  readonly stack = ['Angular 22', 'TypeScript', 'Three.js', 'Firebase', 'WebGL', 'SSR'];
}
