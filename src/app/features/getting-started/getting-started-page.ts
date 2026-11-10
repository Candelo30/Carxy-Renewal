import { isPlatformBrowser } from '@angular/common';
import { Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LOCAL_KEYS } from '../../core/config/app.constants';
import { I18nService } from '../../core/services/i18n';
import { NotificationService } from '../../core/services/notifications';
import { OnboardingService } from '../../core/services/onboarding';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer';import { TranslatePipe } from '../../shared/pipes/translate.pipe';


interface GuideStep {
  id: string;
  icon: string;
  title: string;
  description: string;
  actionLabel: string;
  route: string;
  queryParams?: Record<string, string>;
  tip?: string;
}

const STEPS: GuideStep[] = [
  {
    id: 'cuenta',
    icon: '👤',
    title: 'Crea tu cuenta',
    description: 'Regístrate para guardar tu portafolio, publicar modelos y conectar con otros creadores.',
    actionLabel: 'Crear cuenta',
    route: '/register',
    tip: 'Si ya tienes cuenta, inicia sesión y marca este paso como completado.',
  },
  {
    id: 'editor',
    icon: '🧊',
    title: 'Abre el editor 3D',
    description: 'Familiarízate con el panel izquierdo, el visor central y el HUD flotante de herramientas.',
    actionLabel: 'Abrir el editor',
    route: '/editor',
    tip: 'Arrastra para orbitar, usa la rueda para el zoom y el botón derecho para desplazar.',
  },
  {
    id: 'forma',
    icon: '📦',
    title: 'Añade tu primera forma',
    description: 'Elige una primitiva del panel: cubo, esfera, cilindro, cono o toro.',
    actionLabel: 'Añadir una forma',
    route: '/editor',
    tip: 'Puedes duplicar cualquier objeto con Ctrl+D.',
  },
  {
    id: 'transforma',
    icon: '🎯',
    title: 'Transforma y da color',
    description: 'Mueve, rota y escala el objeto con el gizmo. Después ajusta su color, rugosidad y opacidad.',
    actionLabel: 'Probar transformaciones',
    route: '/editor',
    tip: 'Usa G para mover, R para rotar y S para escalar.',
  },
  {
    id: 'publica',
    icon: '📤',
    title: 'Publica tu modelo',
    description: 'Abre el formulario de publicación, escribe un título, una descripción y añade etiquetas.',
    actionLabel: 'Publicar',
    route: '/editor',
    queryParams: { publish: '1' },
    tip: 'Una buena descripción y etiquetas ayudan a que encuentren tu modelo.',
  },
  {
    id: 'comparte',
    icon: '🌐',
    title: 'Explora y remixea',
    description: 'Recorre la comunidad, da likes, comenta y abre un modelo para crear tu propia versión.',
    actionLabel: 'Explorar la comunidad',
    route: '/feed',
    tip: 'Si remixes un modelo, menciona al creador original en la descripción.',
  },
];

@Component({
  selector: 'app-getting-started-page',
  standalone: true,
  imports: [
    TranslatePipe,RouterLink, ShellHeaderComponent, SiteFooterComponent],
  templateUrl: './getting-started-page.html',
  styleUrl: './getting-started-page.css',
})
export class GettingStartedPage implements OnInit {
  readonly steps = STEPS;
  readonly completed = new Set<string>();

  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  private readonly onboarding = inject(OnboardingService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const raw = localStorage.getItem(LOCAL_KEYS.guideProgress);
      if (!raw) return;
      const saved = JSON.parse(raw) as unknown;
      if (!Array.isArray(saved)) return;
      for (const id of saved) {
        if (typeof id === 'string' && this.steps.some((step) => step.id === id)) {
          this.completed.add(id);
        }
      }
    } catch {
      // Progreso corrupto: se ignora y se empieza de cero.
    }
  }

  get completedCount(): number {
    return this.completed.size;
  }

  get progressPercent(): number {
    return Math.round((this.completed.size / this.steps.length) * 100);
  }

  get allDone(): boolean {
    return this.completed.size === this.steps.length;
  }

  get nextStep(): GuideStep | null {
    return this.steps.find((step) => !this.completed.has(step.id)) ?? null;
  }

  isDone(id: string): boolean {
    return this.completed.has(id);
  }

  toggleStep(id: string): void {
    const wasDone = this.completed.has(id);
    if (wasDone) {
      this.completed.delete(id);
    } else {
      this.completed.add(id);
      if (this.completed.size === this.steps.length) {
        this.notifications.success(
          this.i18n.translate('¡Guía completada! Ya puedes crear, publicar y compartir tus modelos.'),
          this.i18n.translate('Guía de inicio'),
        );
      }
    }
    this.persist();
  }

  resetProgress(): void {
    this.completed.clear();
    this.persist();
    this.notifications.info(
      this.i18n.translate('Progreso de la guía reiniciado.'),
      this.i18n.translate('Guía de inicio'),
    );
  }

  startTutorial(): void {
    this.onboarding.reset();
    void this.router.navigate(['/editor'], { queryParams: { tutorial: '1' } });
  }

  private persist(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      localStorage.setItem(LOCAL_KEYS.guideProgress, JSON.stringify(Array.from(this.completed)));
    } catch {
      // Sin almacenamiento disponible: el progreso solo dura la sesión actual.
    }
  }
}
