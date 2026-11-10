import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer';

type HelpCategory = 'primeros-pasos' | 'editor' | 'publicacion' | 'comunidad' | 'cuenta';
type HelpCategoryFilter = HelpCategory | 'todas';

interface HelpCategoryInfo {
  id: HelpCategoryFilter;
  label: string;
  icon: string;
}

interface HelpArticle {
  id: string;
  category: HelpCategory;
  title: string;
  summary: string;
  icon: string;
  keywords: string;
  body: string[];
  steps?: string[];
  tip?: string;
  action?: { label: string; route?: string; queryParams?: Record<string, string>; external?: string };
}

const CATEGORIES: HelpCategoryInfo[] = [
  { id: 'todas', label: 'Todas', icon: '◈' },
  { id: 'primeros-pasos', label: 'Primeros pasos', icon: '🚀' },
  { id: 'editor', label: 'Editor 3D', icon: '🧊' },
  { id: 'publicacion', label: 'Publicar', icon: '📤' },
  { id: 'comunidad', label: 'Comunidad', icon: '🌐' },
  { id: 'cuenta', label: 'Cuenta y seguridad', icon: '🛡' },
];

const ARTICLES: HelpArticle[] = [
  {
    id: 'primera-escena',
    category: 'primeros-pasos',
    title: 'Crea tu primera escena en 5 pasos',
    summary: 'De un lienzo vacío a un modelo publicado, sin instalar nada.',
    icon: '✨',
    keywords: 'empezar inicio nuevo tutorial primera escena crear',
    body: [
      'CARXY funciona por completo en el navegador. No necesitas descargar ni instalar ningún programa: todo lo que creas se guarda como borrador en este dispositivo hasta que lo publicas.',
      'La escena de inicio incluye un cubo de referencia. Puedes transformarlo, cambiarle el material o eliminarlo y empezar desde cero.',
    ],
    steps: [
      'Abre el Editor 3D desde el menú o con el botón «Crear un modelo».',
      'Añade una forma desde el panel izquierdo: cubo, esfera, cilindro, cono o toro.',
      'Selecciona la forma en el visor o en la jerarquía del panel.',
      'Muévela, rótala y escala con el gizmo o los campos numéricos.',
      'Pulsa «Publicar» para compartirla con la comunidad.',
    ],
    tip: 'Si quieres volver a ver el tutorial guiado, abre la Guía de inicio y pulsa «Iniciar tutorial guiado».',
    action: { label: 'Abrir la guía de inicio', route: '/getting-started' },
  },
  {
    id: 'cuenta',
    category: 'primeros-pasos',
    title: 'Crea tu cuenta y personaliza tu perfil',
    summary: 'Tu identidad de creador, tu portafolio y tus preferencias.',
    icon: '👤',
    keywords: 'registro cuenta perfil nombre avatar biografia iniciar sesion',
    body: [
      'Puedes explorar el editor y la comunidad sin cuenta, pero necesitas iniciar sesión para publicar, comentar, dar likes, seguir creadores y enviar mensajes.',
      'Tu perfil es público: muestra tu nombre visible, tu avatar, tu biografía y los modelos que hayas publicado como públicos.',
    ],
    steps: [
      'Pulsa «Crear cuenta» en el menú o en la pantalla de acceso.',
      'Escribe un nombre visible, tu correo y una contraseña de al menos 8 caracteres con letras y números.',
      'Verifica tu correo desde el enlace que recibirás (si Firebase está configurado).',
      'Abre el menú de cuenta y entra en tu perfil para editar nombre, avatar y biografía.',
    ],
    tip: 'El modo local de demostración guarda las cuentas solo en este navegador. Para cuentas reales y sincronización, configura Firebase.',
    action: { label: 'Crear una cuenta', route: '/register' },
  },
  {
    id: 'interfaz',
    category: 'editor',
    title: 'Conoce el editor: panel, visor y HUD',
    summary: 'Dónde está cada herramienta y cómo se organiza el espacio de trabajo.',
    icon: '🧭',
    keywords: 'interfaz panel visor hud herramientas barra lateral layout',
    body: [
      'El editor se divide en tres zonas. El panel izquierdo concentra la jerarquía de la escena, las primitivas, los materiales y los ajustes. El visor central es el lienzo 3D donde trabajas. El HUD flotante del visor agrupa las vistas de cámara y las herramientas de visualización.',
      'En la barra superior tienes «Presentación» para ocultar el panel y ver el modelo a pantalla completa, y «Publicar» para compartirlo.',
    ],
    steps: [
      'Arrastra con el botón izquierdo del ratón para orbitar la cámara.',
      'Usa la rueda para acercar o alejar el zoom.',
      'Arrastra con el botón derecho para desplazar la vista.',
      'Pulsa «Ocultar panel» si quieres más espacio para el visor.',
    ],
    tip: 'El botón «Editor» que aparece cuando el panel está oculto lo vuelve a mostrar.',
    action: { label: 'Abrir el editor', route: '/editor' },
  },
  {
    id: 'primitivas',
    category: 'editor',
    title: 'Añadir, duplicar y eliminar objetos',
    summary: 'Construye tu escena combinando formas básicas.',
    icon: '📦',
    keywords: 'cubo esfera cilindro cono toro primitiva duplicar eliminar borrar',
    body: [
      'Cada primitiva se añade a la escena como un objeto independiente con su propia posición, rotación, escala y material. Puedes combinarlas para construir estructuras más complejas.',
      'La jerarquía del panel izquierdo muestra todos los objetos y sus mallas. Desde ahí puedes seleccionar, ocultar o eliminar cada elemento.',
    ],
    steps: [
      'Pulsa una primitiva en el panel para añadirla al centro de la escena.',
      'Selecciona el objeto y pulsa Ctrl+D (o Cmd+D en Mac) para duplicarlo.',
      'Pulsa Supr o Retroceso para eliminar el objeto seleccionado.',
      'Usa los controles de visibilidad de la jerarquía para ocultar piezas sin borrarlas.',
    ],
    tip: 'Duplicar es la forma más rápida de crear patrones: duplica, mueve y repite.',
    action: { label: 'Probar en el editor', route: '/editor' },
  },
  {
    id: 'transformar',
    category: 'editor',
    title: 'Mover, rotar y escalar con precisión',
    summary: 'Usa el gizmo o los campos numéricos para controlar cada objeto.',
    icon: '🎯',
    keywords: 'mover rotar escalar transformar gizmo posicion rotacion escala',
    body: [
      'El gizmo de transformación aparece al seleccionar un objeto. Tiene tres modos: mover (flechas), rotar (aros) y escalar (cubos). También puedes escribir valores exactos en los campos del panel.',
      'Los cambios se agrupan en el historial para que puedas deshacerlos con Ctrl+Z.',
    ],
    steps: [
      'Selecciona un objeto en el visor o en la jerarquía.',
      'Pulsa G para mover, R para rotar o S para escalar.',
      'Arrastra una de las flechas, aros o cubos del gizmo.',
      'Ajusta valores exactos en los campos de posición, rotación y escala del panel.',
      'Pulsa Ctrl+Z para deshacer o Ctrl+Y para rehacer.',
    ],
    tip: 'Mantén pulsada una tecla de eje mientras arrastras para bloquear el movimiento a ese eje.',
    action: { label: 'Abrir el editor', route: '/editor' },
  },
  {
    id: 'materiales',
    category: 'editor',
    title: 'Colores, materiales y apariencia',
    summary: 'Da personalidad a tus objetos con color, rugosidad y metalicidad.',
    icon: '🎨',
    keywords: 'material color rugosidad metalicidad opacidad textura apariencia',
    body: [
      'El panel de materiales te permite editar el color base, la rugosidad, la metalicidad y la opacidad de cada malla. Los cambios se ven en tiempo real en el visor.',
      'También puedes cambiar el fondo, la iluminación, la exposición, la cuadrícula, los ejes y las sombras desde los ajustes del editor.',
    ],
    steps: [
      'Selecciona el objeto y abre la sección de materiales en el panel.',
      'Elige un color base con el selector de color.',
      'Ajusta la rugosidad para superficies mate o brillantes.',
      'Aumenta la metalicidad para un acabado metálico.',
      'Reduce la opacidad si quieres un efecto translúcido.',
    ],
    tip: 'Los materiales se guardan con el borrador y se incluyen en el archivo GLB al exportar.',
    action: { label: 'Probar materiales', route: '/editor' },
  },
  {
    id: 'camaras',
    category: 'editor',
    title: 'Cámaras, vistas y modo presentación',
    summary: 'Cambia de perspectiva y muestra tu trabajo sin distracciones.',
    icon: '🎥',
    keywords: 'camara vista perspectiva frontal lateral superior presentacion ortografica',
    body: [
      'El HUD superior derecho del visor cambia entre vista en perspectiva, frontal, lateral y superior. La vista en perspectiva vuelve a encuadrar el modelo automáticamente.',
      'El modo Presentación oculta el panel lateral y deja el visor a pantalla completa. La cámara pasa a un recorrido orbital suave para mostrar el modelo.',
    ],
    steps: [
      'Pulsa «Persp», «Frente», «Lado» o «Arriba» en el HUD de vistas.',
      'También puedes usar las teclas 1, 2, 3 y 4.',
      'Pulsa «Presentación» en la barra superior para activar el modo inmersivo.',
      'Vuelve a pulsar «Presentación» para recuperar el panel de edición.',
    ],
    tip: 'En presentación, los controles de órbita se pausan para que la cámara no se mueva accidentalmente.',
    action: { label: 'Abrir el editor', route: '/editor' },
  },
  {
    id: 'importar-exportar',
    category: 'editor',
    title: 'Importar y exportar modelos GLB/GLTF',
    summary: 'Lleva tus modelos a otras herramientas o tráelos a CARXY.',
    icon: '🔄',
    keywords: 'importar exportar glb gltf archivo modelo descargar cargar',
    body: [
      'CARXY puede importar archivos .glb y .gltf con sus mallas y materiales. Al importar, el cubo de inicio se sustituye por el modelo y la jerarquía completa aparece en el panel.',
      'La exportación genera un archivo .glb con la escena completa, lista para usarla en otros visores o motores 3D.',
    ],
    steps: [
      'Pulsa «Importar» en la barra del editor y elige un archivo .glb o .gltf.',
      'Espera a que termine la carga: verás el modelo y su jerarquía en el panel.',
      'Selecciona cualquier malla para transformarla o cambiar su material.',
      'Pulsa «Exportar» para descargar la escena como .glb.',
    ],
    tip: 'Si el modelo importado es muy pesado, oculta las piezas que no necesites para mantener el visor fluido.',
    action: { label: 'Importar un modelo', route: '/editor' },
  },
  {
    id: 'atajos',
    category: 'editor',
    title: 'Atajos de teclado',
    summary: 'Trabaja más rápido con el teclado y el ratón.',
    icon: '⌨️',
    keywords: 'atajos teclado keyboard shortcuts ctrl z copiar pegar duplicar',
    body: [
      'Estos atajos funcionan cuando el foco no está dentro de un campo de texto del panel. En macOS, usa Cmd en lugar de Ctrl.',
    ],
    tip: 'El historial guarda los últimos cambios de la escena. Si algo sale mal, Ctrl+Z es tu mejor amigo.',
  },
  {
    id: 'publicar',
    category: 'publicacion',
    title: 'Publica tu modelo paso a paso',
    summary: 'Comparte una escena con título, descripción, etiquetas y vista previa.',
    icon: '📤',
    keywords: 'publicar compartir subir modelo miniatura render comunidad',
    body: [
      'Publicar guarda tu escena como un archivo GLB y genera una vista previa para el feed. Los visitantes pueden verla en 3D, dar like, comentar y remixearla.',
      'Si no has iniciado sesión, el botón «Publicar» te lleva al acceso y, después, de vuelta al editor con el formulario abierto.',
    ],
    steps: [
      'Pulsa «Publicar» en la barra superior del editor.',
      'Escribe un título claro y una descripción que explique tu creación.',
      'Añade hasta 12 etiquetas separadas por comas para que sea fácil de encontrar.',
      'Elige si el modelo será público o privado.',
      'Confirma la publicación y ábrelo desde el feed o desde «Mis creaciones».',
    ],
    tip: 'Un buen render y un título descriptivo aumentan las visitas y los remixes.',
    action: { label: 'Publicar ahora', route: '/editor', queryParams: { publish: '1' } },
  },
  {
    id: 'metadatos',
    category: 'publicacion',
    title: 'Edita metadatos y privacidad',
    summary: 'Cambia el título, la descripción, las etiquetas o la visibilidad.',
    icon: '✏️',
    keywords: 'editar metadatos titulo descripcion etiquetas privado publico portafolio',
    body: [
      'Desde «Mis creaciones» puedes administrar tu portafolio: editar los metadatos de cada publicación, cambiar su visibilidad o eliminarla definitivamente.',
      'Los modelos privados no aparecen en el feed ni en tu perfil público, pero siguen disponibles en tu panel de creaciones.',
    ],
    steps: [
      'Abre «Mis creaciones» desde el menú de cuenta o del menú principal.',
      'Pulsa los tres puntos de la tarjeta que quieras editar.',
      'Actualiza el título, la descripción o las etiquetas y guarda los cambios.',
      'Usa el botón de privacidad para alternar entre público y privado.',
    ],
    tip: 'Eliminar un modelo borra también su archivo 3D y su miniatura; la acción no se puede deshacer.',
    action: { label: 'Ir a Mis creaciones', route: '/my-models' },
  },
  {
    id: 'remix',
    category: 'comunidad',
    title: 'Remixea el modelo de otra persona',
    summary: 'Abre una creación de la comunidad y crea tu propia versión.',
    icon: '🧬',
    keywords: 'remix remezclar copiar modelo comunidad editar version',
    body: [
      'Cualquier publicación pública puede abrirse en el editor para crear una versión propia. El remix parte de la escena original y se guarda como una publicación nueva, sin modificar la del creador original.',
      'La comunidad valora los remixes: si mejoras un modelo, cuenta qué cambiaste en la descripción.',
    ],
    steps: [
      'Explora el feed y abre una publicación que te inspire.',
      'Pulsa «Remixear» o «Abrir en el editor».',
      'Transforma la escena: cambia formas, materiales o composición.',
      'Publica tu versión con un título y una descripción propios.',
    ],
    tip: 'Menciona al creador original en la descripción para dar crédito.',
    action: { label: 'Explorar la comunidad', route: '/feed' },
  },
  {
    id: 'social',
    category: 'comunidad',
    title: 'Likes, comentarios, seguidores y notificaciones',
    summary: 'Cómo interactuar con otros creadores sin spam.',
    icon: '💬',
    keywords: 'like comentario comentar seguir seguidor notificacion campana actividad',
    body: [
      'Puedes dar like una sola vez a cada publicación, comentar y seguir a otros creadores. No se permiten los likes propios ni el spam de interacciones.',
      'La campana de actividad reúne follows, likes y comentarios. Cada notificación se puede marcar como leída.',
    ],
    steps: [
      'Abre una publicación del feed y pulsa el corazón para dar like.',
      'Escribe un comentario respetuoso y envíalo.',
      'Entra en el perfil de un creador y pulsa «Seguir».',
      'Abre la campana de actividad para revisar y marcar notificaciones.',
    ],
    tip: 'Si un comentario o publicación te parece inapropiado, usa la opción de reporte en lugar de responder con agresividad.',
    action: { label: 'Ir a la comunidad', route: '/feed' },
  },
  {
    id: 'reportar',
    category: 'comunidad',
    title: 'Reportar contenido o un problema técnico',
    summary: 'Ayúdanos a mantener la comunidad segura y la app estable.',
    icon: '🚩',
    keywords: 'reportar denunciar problema bug error soporte contacto',
    body: [
      'Los reportes de contenido llegan al panel de moderación, donde se revisan y se aplican las medidas necesarias. No se notifica al autor quién envió el reporte.',
      'Para errores técnicos o sugerencias, abre un issue en el repositorio de GitHub con los pasos para reproducirlo.',
    ],
    steps: [
      'Usa la opción de reporte de la publicación o del comentario.',
      'Describe brevemente el motivo del reporte.',
      'Para fallos técnicos, indica navegador, dispositivo y qué estabas haciendo.',
      'No compartas contraseñas ni datos privados en un reporte público.',
    ],
    tip: 'Los reportes abusivos también pueden ser moderados.',
    action: { label: 'Abrir un issue en GitHub', external: 'https://github.com/Candelo30/Carxy-Renewal/issues' },
  },
  {
    id: 'seguridad',
    category: 'cuenta',
    title: 'Protege tu cuenta',
    summary: 'Buenas prácticas de contraseña, verificación y sesiones.',
    icon: '🛡',
    keywords: 'seguridad contraseña password correo verificacion sesion proteger cuenta',
    body: [
      'Tu cuenta protege tu portafolio y tus conversaciones. Usa una contraseña única que no reutilices en otros servicios y actívala con al menos 8 caracteres, letras y números.',
      'La verificación de correo confirma que la dirección te pertenece. Si tu cuenta usa Google, la contraseña se gestiona desde Google y no desde CARXY.',
    ],
    steps: [
      'Abre el menú de cuenta y entra en «Seguridad».',
      'Comprueba que tu correo aparece como verificado.',
      'Si no lo está, pulsa «Reenviar verificación» y revisa tu bandeja de entrada.',
      'Cambia la contraseña periódicamente y no la compartas con nadie.',
      'Cierra sesión en dispositivos compartidos.',
    ],
    tip: 'CARXY nunca te pedirá tu contraseña por chat, correo ni redes sociales.',
  },
  {
    id: 'verificacion',
    category: 'cuenta',
    title: 'Verifica tu correo y recupera tu contraseña',
    summary: 'Qué hacer si no puedes entrar o no recibes el correo.',
    icon: '✉️',
    keywords: 'verificar correo recuperar contraseña olvide reset enlace',
    body: [
      'El enlace de verificación y el de recuperación se envían al correo registrado. Si no llegan, revisa la carpeta de spam o promociones y confirma que escribiste la dirección correcta.',
      'En el modo local de demostración no se envían correos reales: la recuperación de contraseña requiere Firebase configurado.',
    ],
    steps: [
      'En el acceso, pulsa «¿Olvidaste tu contraseña?».',
      'Escribe el correo de tu cuenta y envía el enlace.',
      'Abre el enlace del correo y define una contraseña nueva.',
      'Vuelve a iniciar sesión con la contraseña actualizada.',
    ],
    tip: 'Si el enlace ha caducado, solicita uno nuevo. Solo el último enlace es válido.',
    action: { label: 'Recuperar mi contraseña', route: '/forgot-password' },
  },
  {
    id: 'privacidad',
    category: 'cuenta',
    title: 'Privacidad y datos',
    summary: 'Qué se guarda, dónde se guarda y cómo eliminar tu cuenta.',
    icon: '🔒',
    keywords: 'privacidad datos gdpr borrar cuenta eliminar informacion local firebase',
    body: [
      'En modo local, las cuentas, publicaciones, borradores y preferencias se guardan en el almacenamiento del navegador. Nada se envía a un servidor y borrar los datos del sitio elimina esa información.',
      'Con Firebase configurado, el perfil público y las publicaciones se guardan en Firestore, y los archivos GLB y las miniaturas en Storage. Las reglas de seguridad limitan quién puede leer y escribir cada documento.',
      'Puedes eliminar tu cuenta desde el menú de cuenta. Se borran tu perfil, tus publicaciones y tus seguimientos; los mensajes se conservan como «Cuenta eliminada» para no romper las conversaciones de otras personas.',
    ],
    steps: [
      'Abre el menú de cuenta y entra en «Seguridad».',
      'Desplázate hasta «Eliminar cuenta».',
      'Escribe ELIMINAR y confirma con tu contraseña si se solicita.',
      'Recuerda que la eliminación es permanente.',
    ],
    tip: 'Los modelos privados no se muestran en el feed ni en tu perfil público.',
  },
  {
    id: 'local',
    category: 'cuenta',
    title: 'Modo local de demostración',
    summary: 'Cómo funciona la app sin Firebase y qué limitaciones tiene.',
    icon: '💾',
    keywords: 'local demo firebase configurar sin conexion almacenamiento navegador',
    body: [
      'Si no hay configuración de Firebase, CARXY arranca en modo local de demostración. Puedes crear, editar y publicar, pero todo queda en este navegador y no se sincroniza entre dispositivos.',
      'El modo local no está pensado para producción: las cuentas locales no sustituyen a un sistema de autenticación real. Para cuentas reales, verificación de correo, chat en la nube y almacenamiento de modelos, configura Firebase siguiendo el README del proyecto.',
    ],
    steps: [
      'Crea un proyecto en Firebase y habilita Authentication, Firestore y Storage.',
      'Copia la configuración web en public/firebase-config.js.',
      'Despliega firestore.rules, storage.rules y firestore.indexes.json.',
      'Recarga la app: el banner de modo local desaparecerá.',
    ],
    tip: 'Nunca pegues claves de cuenta de servicio en el cliente. La configuración web de Firebase son identificadores públicos.',
    action: { label: 'Ver el proyecto en GitHub', external: 'https://github.com/Candelo30/Carxy-Renewal' },
  },
];

@Component({
  selector: 'app-help-page',
  standalone: true,
  imports: [FormsModule, RouterLink, ShellHeaderComponent, SiteFooterComponent],
  templateUrl: './help-page.html',
  styleUrl: './help-page.css',
})
export class HelpPage implements OnInit, OnDestroy {
  readonly categories = CATEGORIES;
  readonly articles = ARTICLES;

  activeCategory: HelpCategoryFilter = 'todas';
  query = '';
  expandedId: string | null = null;
  mobileMenuOpen = false;

  private readonly route = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly subscription = new Subscription();

  ngOnInit(): void {
    this.subscription.add(this.route.fragment.subscribe((fragment) => {
      if (!fragment) return;
      const article = this.articles.find((item) => item.id === fragment);
      if (article) {
        this.activeCategory = 'todas';
        this.query = '';
        this.expandedId = article.id;
        // El router puede emitir el fragmento fuera del ciclo de detección.
        this.cdr.markForCheck();
      }
      this.scrollToFragment(fragment);
    }));
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  get filteredArticles(): HelpArticle[] {
    const query = this.query.trim().toLowerCase();
    return this.articles.filter((article) => {
      if (this.activeCategory !== 'todas' && article.category !== this.activeCategory) return false;
      if (!query) return true;
      const haystack = [
        article.title,
        article.summary,
        article.keywords,
        ...article.body,
        ...(article.steps ?? []),
        article.tip ?? '',
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }

  get activeCategoryLabel(): string {
    return this.categories.find((category) => category.id === this.activeCategory)?.label ?? 'Todos los artículos';
  }

  countFor(category: HelpCategoryFilter): number {
    return category === 'todas'
      ? this.articles.length
      : this.articles.filter((article) => article.category === category).length;
  }

  categoryLabel(category: HelpCategory): string {
    return this.categories.find((item) => item.id === category)?.label ?? category;
  }

  selectCategory(category: HelpCategoryFilter): void {
    this.activeCategory = category;
    this.expandedId = null;
  }

  applyQuery(value: string): void {
    this.query = value;
    this.activeCategory = 'todas';
    this.expandedId = null;
  }

  clearSearch(): void {
    this.query = '';
    this.activeCategory = 'todas';
  }

  toggleArticle(id: string): void {
    this.expandedId = this.expandedId === id ? null : id;
  }

  get shortcuts(): Array<{ keys: string; action: string }> {
    return [
      { keys: 'G', action: 'Mover el objeto seleccionado' },
      { keys: 'R', action: 'Rotar el objeto seleccionado' },
      { keys: 'S', action: 'Escalar el objeto seleccionado' },
      { keys: 'F', action: 'Enfocar el objeto seleccionado' },
      { keys: 'M', action: 'Activar la medición de distancia' },
      { keys: 'Supr / Retroceso', action: 'Eliminar el objeto seleccionado' },
      { keys: 'Ctrl + Z', action: 'Deshacer el último cambio' },
      { keys: 'Ctrl + Y / Ctrl + Shift + Z', action: 'Rehacer el cambio' },
      { keys: 'Ctrl + C / Ctrl + V', action: 'Copiar y pegar un objeto' },
      { keys: 'Ctrl + D', action: 'Duplicar el objeto seleccionado' },
      { keys: '1 / 2 / 3 / 4', action: 'Vista perspectiva, frontal, lateral y superior' },
    ];
  }

  get mouseShortcuts(): Array<{ keys: string; action: string }> {
    return [
      { keys: 'Arrastrar con el botón izquierdo', action: 'Orbitar la cámara' },
      { keys: 'Rueda del ratón', action: 'Acercar o alejar el zoom' },
      { keys: 'Arrastrar con el botón derecho', action: 'Desplazar la vista (pan)' },
      { keys: 'Pellizcar con dos dedos', action: 'Zoom en pantallas táctiles' },
    ];
  }

  private scrollToFragment(fragment: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    window.setTimeout(() => {
      const element = document.getElementById(fragment);
      element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }
}
