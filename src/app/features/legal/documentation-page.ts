import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

interface DocsLink {
  label: string;
  description: string;
  route?: string;
  fragment?: string;
  external?: string;
}

interface DocsSection {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  links: DocsLink[];
}

const SECTIONS: DocsSection[] = [
  {
    id: 'creadores',
    icon: '🎨',
    title: 'Para creadores y usuarios',
    subtitle: 'Todo lo que necesitas para crear, publicar y conectar con la comunidad.',
    links: [
      { label: 'Guía de inicio', description: 'De tu cuenta al primer modelo publicado, en seis pasos.', route: '/getting-started' },
      { label: 'Centro de ayuda', description: 'Guías del editor, publicación, comunidad y cuenta.', route: '/help' },
      { label: 'Atajos de teclado', description: 'Domina el editor sin tocar el ratón.', route: '/help', fragment: 'atajos' },
      { label: 'Escala por eje y renombrar', description: 'No uniform scale fields y cómo renombrar piezas seleccionadas.', route: '/help', fragment: 'escala-por-eje' },
      { label: 'Publicar un modelo', description: 'Título, descripción, etiquetas y visibilidad.', route: '/help', fragment: 'publicar' },
      { label: 'Remixes y créditos', description: 'Crea tu versión de cualquier publicación pública.', route: '/help', fragment: 'remix' },
      { label: 'Ayuda comunitaria', description: 'Pregunta y responde con otros creadores.', route: '/community-help' },
      { label: 'Proyectos colaborativos', description: 'Escenas compartidas con roles y presencia en vivo.', route: '/projects' },
      { label: 'Cursor en vivo y presencia', description: 'Mira a tus compañeros editando junto a ti en tiempo real.', route: '/help', fragment: 'cursores-remotos' },
      { label: 'Invitar seguidores', description: 'Invita con un clic y reciben notificación en su buzón.', route: '/help', fragment: 'invitar-seguidores' },
      { label: 'Enlaces de acceso', description: 'Comparte un proyecto con cualquier persona por enlace.', route: '/help', fragment: 'enlaces-acceso' },
      { label: 'Notificaciones', description: 'Tu buzón: likes, mensajes, seguimientos, remixes e invitaciones.', route: '/help', fragment: 'notificaciones' },
      { label: 'Guardado automático', description: 'Cómo la escena se guarda sola y se recupera tras cerrar.', route: '/help', fragment: 'guardado-auto' },
      { label: 'Mensajería directa', description: 'Escribe a cualquier creador desde su perfil o el feed.', route: '/help', fragment: 'mensajes-directos' },
    ],
  },
  {
    id: 'moderadores',
    icon: '🛡️',
    title: 'Para moderadores',
    subtitle: 'Cómo mantener la comunidad segura sin frenar la creatividad.',
    links: [
      { label: 'Guía para moderadores', description: 'Revisión de reportes, fijación, bloqueo y retirada de contenido.', route: '/help', fragment: 'guia-moderadores' },
      { label: 'Normas de la comunidad', description: 'Qué se permite, qué no y cómo se aplican las medidas.', route: '/politicas' },
      { label: 'Panel de moderación', description: 'Acceso a la cola de reportes y las herramientas de gestión.', route: '/moderation' },
      { label: 'Reportar un problema', description: 'Cómo escalar incidencias que no puedes resolver solo.', route: '/contact' },
      { label: 'Términos y condiciones', description: 'El marco legal que respalda las decisiones de moderación.', route: '/terminos' },
    ],
  },
  {
    id: 'administradores',
    icon: '⚙️',
    title: 'Para administradores',
    subtitle: 'Gestión de la plataforma, roles y seguridad operativa.',
    links: [
      { label: 'Guía para administradores', description: 'Panel, roles, suspensiones, métricas y auditoría.', route: '/help', fragment: 'guia-administradores' },
      { label: 'Roles y permisos', description: 'Qué puede hacer cada rol del proyecto y de la plataforma.', route: '/help', fragment: 'roles-permisos' },
      { label: 'Roles de la plataforma', description: 'Usuario, moderador y administrador: alcance y asignación.', route: '/help', fragment: 'roles-plataforma' },
      { label: 'Panel de administración', description: 'Usuarios, reportes, configuración y estado del servicio.', route: '/admin' },
      { label: 'Seguridad y datos', description: 'Arquitectura de reglas, almacenamiento y buenas prácticas.', route: '/help', fragment: 'privacidad' },
    ],
  },
  {
    id: 'legal',
    icon: '📜',
    title: 'Legal y confianza',
    subtitle: 'Documentos que explican tus derechos y nuestras obligaciones.',
    links: [
      { label: 'Términos y condiciones', description: 'Reglas de uso del servicio, cuentas y contenido.', route: '/terminos' },
      { label: 'Política de privacidad', description: 'Qué datos tratamos, dónde se guardan y cómo borrarlos.', route: '/privacidad' },
      { label: 'Políticas de la comunidad', description: 'Normas de convivencia y sistema de moderación y apelaciones.', route: '/politicas' },
      { label: 'Seguridad', description: 'Cómo reportar vulnerabilidades y proteger tu cuenta.', route: '/help', fragment: 'seguridad' },
    ],
  },
  {
    id: 'proyecto',
    icon: '🛠️',
    title: 'El proyecto',
    subtitle: 'CARXY es abierto: aprende cómo está construido y participa.',
    links: [
      { label: 'Sobre CARXY', description: 'La historia, el equipo y el roadmap del proyecto.', route: '/about' },
      { label: 'Repositorio en GitHub', description: 'Código fuente, issues y discusiones.', external: 'https://github.com/Candelo30/Carxy-Renewal' },
      { label: 'Reportar un bug', description: 'Ayúdanos a mejorar abriendo un issue con pasos para reproducirlo.', external: 'https://github.com/Candelo30/Carxy-Renewal/issues' },
      { label: 'Debates y propuestas', description: 'Ideas de funcionalidad y decisiones abiertas de la comunidad.', external: 'https://github.com/Candelo30/Carxy-Renewal/discussions' },
      { label: 'Contacto', description: 'Escríbenos cualquier cosa: te leemos.', route: '/contact' },
    ],
  },
];

@Component({
  selector: 'app-documentation-page',
  standalone: true,
  imports: [RouterLink, ShellHeaderComponent, SiteFooterComponent, TranslatePipe],
  templateUrl: './documentation-page.html',
  styleUrl: './legal-page.css',
})
export class DocumentationPageComponent {
  readonly sections = SECTIONS;
}
