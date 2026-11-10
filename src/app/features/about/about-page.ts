import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer';

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
  imports: [RouterLink, ShellHeaderComponent, SiteFooterComponent],
  templateUrl: './about-page.html',
  styleUrl: './about-page.css',
})
export class AboutPage {
  readonly repositoryUrl = 'https://github.com/Candelo30/Carxy-Renewal';

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
