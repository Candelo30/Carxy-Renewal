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
  ];

  protected selectedExteriorId = 'midnight-azure';
  protected selectedInteriorId = 'cognac-leather';
  protected savedAt: string | null = null;

  get selectedExterior(): ExteriorOption {
    return this.exteriorOptions.find((option) => option.id === this.selectedExteriorId) ?? this.exteriorOptions[0];
  }

  get selectedInterior(): InteriorOption {
    return this.interiorOptions.find((option) => option.id === this.selectedInteriorId) ?? this.interiorOptions[0];
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

  protected saveConfiguration(): void {
    this.savedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
