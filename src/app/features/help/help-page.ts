import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Subscription } from 'rxjs';
import { I18nService } from '../../core/services/i18n';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer';import { TranslatePipe } from '../../shared/pipes/translate.pipe';


type HelpCategory = 'primeros-pasos' | 'editor' | 'publicacion' | 'comunidad' | 'colaboracion' | 'cuenta' | 'moderacion';
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
  { id: 'colaboracion', label: 'Colaboración', icon: '🤝' },
  { id: 'cuenta', label: 'Cuenta y seguridad', icon: '🛡' },
  { id: 'moderacion', label: 'Moderación y administración', icon: '⚖️' },
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
      'Ctrl+Z deshacer  ·  Ctrl+Y / Ctrl+Shift+Z rehacer  ·  Ctrl+S guardar  ·  Ctrl+D duplicar  ·  Ctrl+C / Ctrl+V copiar y pegar objeto entre pestañas  ·  Supr/Retroceso borrar pieza  ·  G mover  ·  R rotar  ·  S escalar  ·  F enfocar pieza  ·  M modo medición  ·  1 Vista 3D  ·  2 Frontal  ·  3 Lateral  ·  4 Superior  ·  ? ayuda de atajos',
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
      'Puedes eliminar tu cuenta desde el menú de cuenta. Se borran tu perfil, tus publicaciones y tus seguimientos, tus likes y tus guardados. Los mensajes se conservan como «Cuenta eliminada» para no romper las conversaciones de otras personas.',
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
  {
    id: 'proyectos-colaborativos',
    category: 'colaboracion',
    title: 'Crear y gestionar proyectos 3D en equipo',
    summary: 'Trabaja con otros creadores en escenas compartidas.',
    icon: '🤝',
    keywords: 'proyecto colaborativo equipo equipo escena compartir crear',
    body: [
      'Los proyectos te permiten trabajar con otros creadores en la misma escena 3D. Cada proyecto tiene su propia escena, miembros y configuración de privacidad.',
      'Cada proyecto tiene un enlace de acceso (lectura o diseño) que comparte la entrada sin hacer falta escribir correos.',
      'Crea un proyecto desde la página de Proyectos y ábrelo desde el editor para comenzar a crear en equipo.',
    ],
    steps: [
      'Ve a la página de Proyectos y pulsa «Crear un proyecto».',
      'Escribe un nombre y una descripción opcional, y elige si será público o privado.',
      'Una vez creado, pulsa «Abrir en editor» para cargar la escena del proyecto.',
      'Los cambios se guardan automáticamente en la nube cada pocos segundos.',
    ],
    tip: 'Si trabajas sin un proyecto, tus cambios se guardan solo como borrador local en este navegador.',
    action: { label: 'Ir a Proyectos', route: '/projects' },
  },
  {
    id: 'invitaciones-miembros',
    category: 'colaboracion',
    title: 'Invitar y gestionar miembros de un proyecto',
    summary: 'Añade colaboradores a tu proyecto con un rol específico.',
    icon: '📨',
    keywords: 'invitar miembro colaborador email rol dueño editor visor',
    body: [
      'Solo el dueño y los editores de un proyecto pueden invitar a nuevas personas.',
      'Las invitaciones expiran a los 7 días si no se aceptan.',
      'Además de por correo, puedes invitar con un clic a cualquiera de tus seguidores en «Invitar seguidores» del detalle del proyecto.',
      'Puedes cambiar el rol de cualquier miembro o eliminarlo del proyecto en cualquier momento.',
    ],
    steps: [
      'Abre el detalle de tu proyecto desde la página de Proyectos.',
      'En la sección «Invitar miembros», escribe el correo y elige un rol (Editor o Visor).',
      'O desplázate hasta «Invitar seguidores» para invitar a quien ya sigues, con un solo clic.',
      'La persona recibirá la invitación en sus invitaciones pendientes.',
      'Para cambiar un rol o eliminar a un miembro, usa las opciones de la lista de miembros.',
    ],
    tip: 'El dueño del proyecto no puede ser eliminado ni cambiar su propio rol.',
    action: { label: 'Ir a Proyectos', route: '/projects' },
  },
  {
    id: 'roles-permisos',
    category: 'colaboracion',
    title: 'Roles y permisos: dueño, editor y visor',
    summary: 'Entiende qué puede hacer cada rol en un proyecto compartido.',
    icon: '🛡',
    keywords: 'rol permiso dueño owner editor editor visor viewer lectura escritura',
    body: [
      'Cada miembro de un proyecto tiene un rol que define qué puede hacer:',
      '- **Dueño (owner)**: puede hacer todo: editar, invitar, cambiar roles, eliminar miembros y borrar el proyecto.',
      '- **Editor (editor)**: puede editar la escena e invitar miembros, pero no borrar el proyecto ni cambiar roles de otros.',
      '- **Visor (viewer)**: solo puede ver la escena, no puede editar ni invitar.',
    ],
    steps: [
      'Abre el detalle del proyecto y ve a la sección Miembros.',
      'Cada miembro muestra su rol actual junto a su nombre.',
      'Si eres dueño, usa el selector de rol para cambiar el rol de cualquier miembro (excepto tú mismo).',
    ],
    tip: 'Solo el dueño puede eliminar el proyecto o cambiar el rol de otros miembros.',
  },
  {
    id: 'bloqueo-objetos',
    category: 'colaboracion',
    title: 'Bloquear objetos mientras otros editan',
    summary: 'Evita que dos personas editen el mismo objeto al mismo tiempo.',
    icon: '🔒',
    keywords: 'bloquear objeto editar simultaneo conflicto candado',
    body: [
      'Cuando trabajas en un proyecto con otros, puedes bloquear un objeto para que nadie más lo modifique mientras tú lo editas.',
      'Los objetos bloqueados aparecen con un candado 🔒 en el panel de objetos.',
      'Solo quien bloqueó el objeto (o el dueño del proyecto) puede desbloquearlo.',
    ],
    steps: [
      'En el panel de objetos del editor, pulsa el botón 🔓 junto al objeto para bloquearlo.',
      'El objeto aparecerá con 🔒 para los demás colaboradores.',
      'Cuando termines, pulsa 🔒 para liberarlo y que otros puedan editarlo de nuevo.',
    ],
    tip: 'Si intentas editar un objeto bloqueado por otro colaborador, verás una notificación avisándote.',
  },
  {
    id: 'historial-actividad',
    category: 'colaboracion',
    title: 'Historial compartido de actividad',
    summary: 'Consulta quién creó, modificó o eliminó cada objeto y cuándo.',
    icon: '📜',
    keywords: 'historial actividad quien hizo que cuando actividad compartida',
    body: [
      'Cada acción en un proyecto compartido se registra automáticamente: quién creó un objeto, quién lo modificó, quién lo eliminó y cuándo.',
      'El historial se muestra en el detalle del proyecto, en la sección Actividad.',
      'Así puedes saber exactamente qué cambios hizo cada miembro del equipo.',
    ],
    steps: [
      'Abre el detalle de tu proyecto desde la página de Proyectos.',
      'Desplázate hasta la sección «Actividad».',
      'Verás una lista con el avatar del colaborador, la acción realizada, el objeto afectado y la hora.',
    ],
    tip: 'El historial se actualiza en tiempo real a medida que los colaboradores hacen cambios en la escena.',
    action: { label: 'Ir a Proyectos', route: '/projects' },
  },
  {
    id: 'roles-plataforma',
    category: 'moderacion',
    title: 'Usuarios, moderadores y administradores',
    summary: 'Qué puede hacer cada rol en CARXY y cómo se asignan.',
    icon: '👥',
    keywords: 'rol roles usuario moderador administrador admin permisos permiso plataforma',
    body: [
      'CARXY tiene tres roles de plataforma. Todas las personas empiezan como usuarias y el equipo eleva roles cuando corresponde.',
      '- **Usuario**: crea y publica modelos, comenta, da likes, sigue creadores, participa en proyectos colaborativos y en la ayuda comunitaria.',
      '- **Moderador**: todo lo anterior, más revisar reportes de contenido, fijar y bloquear hilos de la ayuda comunitaria, retirar publicaciones que incumplen las normas y aplicar advertencias.',
      '- **Administrador**: todo lo anterior, más gestionar roles, suspender y reactivar cuentas, configurar la plataforma, consultar métricas globales y resolver apelaciones.',
      'Los permisos se aplican en el servidor (reglas de Firestore y Storage), no solo en la interfaz: un rol elevado no da acceso a datos privados ajenos salvo necesidad operativa.',
    ],
    steps: [
      'Entra en tu perfil y revisa el rol que aparece bajo tu nombre.',
      'Si crees que mereces el rol de moderador, escríbenos desde la página de contacto con tu trayectoria en la comunidad.',
      'Los administradores asignan y revocan roles desde el panel de administración.',
    ],
    tip: 'Los roles de proyecto (dueño, editor, visor) y los roles de plataforma (usuario, moderador, administrador) son distintos; un dueño de proyecto no es moderador de la plataforma.',
    action: { label: 'Ver las políticas de la comunidad', route: '/politicas' },
  },
  {
    id: 'guia-moderadores',
    category: 'moderacion',
    title: 'Guía para moderadores',
    summary: 'Cómo revisar reportes y actuar con criterio y consistencia.',
    icon: '⚖️',
    keywords: 'moderador moderacion reportes revisar fijar bloquear eliminar sancion advertencia',
    body: [
      'La moderación empieza en la cola de reportes. Cada reporte indica el contenido señalado, el motivo y el contexto; tu trabajo es verificar si infringe las políticas de la comunidad.',
      'Principios: evidencia antes de actuar, proporcionalidad de la medida, y registro de lo que decides y por qué. En caso de duda, escala a un administrador antes de aplicar una suspensión.',
      'Medidas habituales, de menor a mayor gravedad: advertencia privada, retirada del contenido, bloqueo temporal de publicación o chat, suspensión temporal y, en casos graves, suspensión definitiva.',
      'Nunca reveles quién reportó ni compartas datos personales fuera del equipo de moderación.',
    ],
    steps: [
      'Abre el panel de moderación desde el menú de cuenta (o /moderation).',
      'Filtra la cola por tipo de contenido o por estado (pendiente, en revisión, resuelto).',
      'Abre el reporte, revisa el contexto completo y el historial de la cuenta.',
      'Aplica la medida proporcional: aviso, retirada, bloqueo o escalado a administración.',
      'Marca el reporte como resuelto; queda registro para auditoría del equipo.',
      'En la ayuda comunitaria puedes fijar, bloquear o eliminar preguntas y marcar respuestas como aceptadas.',
    ],
    tip: 'La regla de oro: si no estás seguro, pide una segunda opinión a otro moderador o a un administrador antes de sancionar.',
    action: { label: 'Ir al panel de moderación', route: '/moderation' },
  },
  {
    id: 'guia-administradores',
    category: 'moderacion',
    title: 'Guía para administradores',
    summary: 'Gestión de roles, cuentas, configuración y estado de la plataforma.',
    icon: '⚙️',
    keywords: 'administrador admin panel gestionar roles suspender reactivar metricas configuracion auditoria',
    body: [
      'Los administradores responden por la salud de la plataforma: accesos, roles, seguridad y disponibilidad.',
      'El panel de administración (/admin) concentra usuarios, reportes, métricas y configuración. Toda acción queda registrada; la auditoría no se puede borrar.',
      'Asignar o revocar roles requiere justificación. Suspende cuentas solo con evidencia clara; el usuario puede apelar y la decisión la revisa otro administrador.',
      'Mantén al menos dos administradores activos para evitar puntos únicos de fallo, y revisa periódicamente las cuentas con rol elevado.',
    ],
    steps: [
      'Abre el panel de administración desde el menú de cuenta (solo visible con rol de administrador).',
      'Revisa las métricas: altas, publicaciones, reportes pendientes y errores.',
      'Gestiona roles desde la ficha de cada usuario, con el motivo por escrito.',
      'Atiende apelaciones en un plazo máximo de 14 días y documenta la resolución.',
      'Verifica el despliegue de firestore.rules y storage.rules tras cada cambio de permisos.',
    ],
    tip: 'La configuración de Firebase (rules, indexes, CORS) vive en el repositorio: cualquier cambio debe pasar por revisión y desplegarse desde una máquina autorizada.',
    action: { label: 'Abrir el panel de administración', route: '/admin' },
  },
  {
    id: 'normas-comunidad',
    category: 'moderacion',
    title: 'Normas de la comunidad y contenido prohibido',
    summary: 'Qué se permite en el feed, los comentarios y el chat.',
    icon: '📜',
    keywords: 'normas reglas prohibido contenido odio acoso spam politicas comunidad nsfw',
    body: [
      'CARXY tolera la crítica creativa y el debate técnico; no tolera el odio, el acoso, el spam, el contenido ilegal ni la suplantación.',
      'Publicar con etiquetas engañosas, robar atribución o redistribuir modelos sin derecho también infringe las normas, aunque el contenido sea legal.',
      'Las medidas van de una advertencia privada a la suspensión definitiva, según gravedad y reincidencia. Los reportes son confidenciales.',
    ],
    steps: [
      'Lee las políticas de la comunidad completas antes de moderar o apelar.',
      'Si detectas contenido infractor, repórtalo desde la propia publicación o comentario.',
      'Si tu contenido fue retirado, apela por el aviso o escríbenos con el asunto «Apelación».',
    ],
    tip: 'El abuso del sistema de reportes (usarlo como represalia) también se modera.',
    action: { label: 'Leer las políticas de la comunidad', route: '/politicas' },
  },
  {
    id: 'apelar-sancion',
    category: 'moderacion',
    title: 'Apelar una sanción o retirada de contenido',
    summary: 'Cómo pedir la revisión de una decisión de moderación.',
    icon: '📨',
    keywords: 'apelacion apelar sancion retirada suspension revision injusticia recurso',
    body: [
      'Si consideras que una moderación fue un error, tienes derecho a apelar. Las apelaciones las revisa un administrador distinto de quien aplicó la medida.',
      'Incluye en tu apelación: qué contenido o acción fue sancionado, por qué crees que fue un error y cualquier contexto que ayude a la revisión.',
      'El plazo máximo de respuesta es de 14 días. Si la apelación se estima, se restaura el contenido y se anota la corrección; si se desestima, la medida se mantiene.',
    ],
    steps: [
      'Localiza el aviso de moderación en tus notificaciones o correo.',
      'Responde al aviso o escribe a contacto@carxy.app con el asunto «Apelación».',
      'Adjunta capturas o enlaces que respalden tu versión.',
      'Espera la revisión; no crees cuentas nuevas para eludir la suspensión mientras tanto.',
    ],
    tip: 'Las apelaciones respetuosas y con evidencia se resuelven más rápido que los mensajes agresivos.',
    action: { label: 'Escribir a contacto', route: '/contact' },
  },
  {
    id: 'guardado-auto',
    category: 'publicacion',
    title: 'Guardado automático y recuperación de escenas',
    summary: 'Qué se guarda, cuándo y cómo confirmar que está a salvo.',
    icon: '💾',
    keywords: 'guardar autosave automaticamente nube guardado recuperacion sesion borrador confirmacion',
    body: [
      'El editor guarda la escena automáticamente cada vez que cambias el modelo (mover, rotar, escalar, materiales, visibilidad, añadir o borrar piezas).',
      'Mientras editas verás el indicador «Guardando…» en la barra superior; cuando termina aparece «✓ Guardado». Solo hace falta esperar a que pase de uno a otro.',
      'Las escenas viven en Firestore. Si cierras el navegador o cambias de pestaña mientras editas, al abrir el proyecto de nuevo se recupera el último estado guardado.',
    ],
    steps: [
      'Crea o abre un proyecto desde la página Proyectos.',
      'Edita tu escena. El indicador de la barra de estado pasará de «Guardando…» a «✓ Guardado».',
      'Cierra la pestaña y vuelve más tarde a abrir el mismo proyecto. Tu escena aparecerá tal cual la dejaste.',
      'Si ves «⚠ Error al guardar», comprueba tu conexión y recarga la página antes de seguir editando.',
    ],
    tip: 'El guardado es relativo a tu cuenta: si el proyecto es compartido, los demás miembros verán tus cambios al instante.',
    action: { label: 'Ir a Proyectos', route: '/projects' },
  },
  {
    id: 'capas-profundidad',
    category: 'editor',
    title: 'Capas del proyecto y visibilidad por pieza',
    summary: 'Organiza el modelo, oculta lo que estorba y recupera piezas rápido.',
    icon: '🗂',
    keywords: 'capas layer visibility ocultar mostrar jerarquia piezas organizacion ver',
    body: [
      'El panel «Capas» del editor muestra el árbol del modelo con todas sus piezas. Cada pieza puede ocultarse con su ojo o mostrarse de nuevo sin afectar al resto.',
      'Usa capas para trabajar sobre una zona concreta sin distraerte con el resto: por ejemplo, oculta el chasis mientras modelas el interior.',
      'Las piezas ocultas conservan su posición y material; nada se pierde al ocultarlas.',
    ],
    steps: [
      'En el panel derecho, abre «Capas» si no está expandido.',
      'Pulsa el ojo 👁 junto a una pieza para alternar su visibilidad.',
      'Para localizar una pieza concreta, escribe su nombre en el buscador del panel.',
      'Oculta varias piezas a la vez para centrarte en una zona del modelo.',
    ],
    tip: 'La visibilidad también se sincroniza entre los miembros del proyecto: si ocultas algo, tus compañeros lo verán oculto en tiempo real.',
  },
  {
    id: 'herramientas-inspeccion',
    category: 'editor',
    title: 'Herramientas de inspección y presentación del modelo',
    summary: 'Bloom, profundidad de campo, viñeta, corte y vista explosionada.',
    icon: '🔍',
    keywords: 'bloom profundidad campo viñeta corte clip vista explosionada exploded inspection exposicion rejilla ejes',
    body: [
      'El menú «Ajustes» del editor ofrece herramientas de inspección pensadas para revisar piezas con detalle o presentar el modelo de forma profesional.',
      'Algunas solo afectan al render; otras también cambian la geometría mostrada:',
      '- **Explosionada**: separa las piezas a lo largo de sus ejes para inspeccionar el ensamblaje.',
      '- **Plano de corte**: corta la escena por un eje (x/y/z) con desplazamiento sincronizado.',
      '- **Rejilla y ejes**: activa o desactiva la malla de referencia.',
      '- **Sombras, rotación automática y exposición**: ajustan la escena para tomar capturas.',
    ],
    steps: [
      'Abre «Ajustes» en el editor (botón de rueda dentada de la esquina).',
      'Ajusta «Vista explosionada» con el deslizador para separar piezas.',
      'Activa «Plano de corte» y elige el eje para rebanar el modelo.',
      'Activa «Bloom», «Viñeta» o «Profundidad de campo» para un acabado cinematográfico.',
    ],
    tip: 'Estas herramientas no modifican tu escena guardada; solo cambian cómo se ve.',
    action: { label: 'Abrir el editor con una escena', route: '/editor' },
  },
  {
    id: 'escala-por-eje',
    category: 'editor',
    title: 'Escala por eje, renombrar objetos y duplicar',
    summary: 'Controles finos para ajustar cada eje sin perder tu trabajo.',
    icon: '↔',
    keywords: 'escala eje renombrar objetos duplicar escala uniforme non-uniform axis',
    body: [
      'Además de la escala uniforme, el panel «Propiedades» incluye tres campos para hacer escala no uniforme por eje (X, Y, Z). Son ideales para hacer ruedas más anchas, carrocerías más bajas o cualquier proporción asimétrica.',
      'El campo «Nombre» renombra la pieza seleccionada; el nuevo nombre aparece al instante en la lista de objetos y capas.',
      'Duplicar crea una copia exacta de la pieza seleccionada (Ctrl+D). Es la forma más rápida de crear 4 ruedas o 2 retrovisores iguales.',
      'Con «Restablecer transformaciones» se devuelven posición, rotación y escala a los valores originales de la pieza.',
    ],
    steps: [
      'Selecciona un objeto en el panel o en el visor.',
      'Usa los campos X/Y/Z de «Escala por eje» para cambiar cada eje de forma independiente.',
      'Escribe un nuevo nombre en el campo «Nombre» y pulsa fuera (o Enter) para confirmar.',
      'Duplica con Ctrl+D para clonar y con ello crea piezas simétricas rápidamente.',
    ],
    tip: 'Fija escala, rotación y posición con campos numéricos; el gizmo como atajo para ajustar sin tocar con el ratón.',
  },
  {
    id: 'renombrar-objetos',
    category: 'editor',
    title: 'Renombra tus piezas y capas',
    summary: 'Un modelo bien nombrado se comparte y se mantiene mejor.',
    icon: '✏️',
    keywords: 'renombrar nombre objeto pieza capa renombrar lista',
    body: [
      'Cada pieza del modelo tiene un nombre por defecto (Cubo, Cilindro, etc.). Puedes renombrarla desde «Propiedades».',
      'El nombre aparece en la lista de objetos, en el buscador del panel y en el panel de capas.',
      'Unos nombres bien elegidos hacen que el proyecto sea comprensible para otros miembros si lo compartís.',
    ],
    steps: [
      'Selecciona la pieza que quieras renombrar.',
      'En «Propiedades», busca el campo «Nombre» (debajo del gizmo).',
      'Escribe el nombre y pulsa fuera del campo o pulsa Enter.',
      'El nuevo nombre aparece en la lista y en el panel de capas.',
    ],
    tip: 'Usa nombres descriptivos en vez de «Cubo 1/Cubo 2»: «Faro izquierdo», «Rueda trasera derecha».',
  },
  {
    id: 'cursores-remotos',
    category: 'colaboracion',
    title: 'Cursor en vivo y presencia de tu equipo',
    summary: 'Mira lo que están editando tus compañeros en tiempo real.',
    icon: '👋',
    keywords: 'cursor remoto presencia colaborador compañero edicion en vivo live avatar',
    body: [
      'Cuando trabajas en un proyecto con otros, verás cursores de color con el nombre de cada miembro que está editando a la vez.',
      'El panel izquierdo del editor lista quién está en línea, quién editó el objeto seleccionado y las piezas que están tocando.',
      'El indicador «X/Y Online» de la cabecera te dice cuántos están conectados ahora mismo.',
    ],
    steps: [
      'Crea o abre un proyecto con miembros.',
      'Abre el editor en otra cuenta (o pide a un compañero que lo haga).',
      'Mira el panel izquierdo: verás al otro como «Online» y el objeto que está editando.',
    ],
    tip: 'El cursor y el objeto que está editando el otro cambian en tiempo real; si no los ves, seguro que nadie más está en el proyecto en ese instante.',
    action: { label: 'Ir a Proyectos', route: '/projects' },
  },
  {
    id: 'enlaces-acceso',
    category: 'colaboracion',
    title: 'Enlaces de acceso: comparte un proyecto sin correo',
    summary: 'Cualquier persona con el enlace entra con rol lector o editor.',
    icon: '🔗',
    keywords: 'enlace acceso compartir share link lector editor miembro joined optional caducidad invite',
    body: [
      'El dueño de un proyecto puede crear enlaces de acceso desde el detalle del proyecto. Hay dos tipos: lectura (visor) y diseño (editor).',
      'Cualquier persona con el enlace puede abrir el proyecto en el editor y sumarse al instante; no hace falta escribir su correo.',
      'Los enlaces siempre dependen del proyecto y pueden desactivarse o cambiarse de tipo en cualquier momento desde la misma sección.',
      'Un enlace desactivado deja de funcionar inmediatamente para nuevos accesos; los que ya entraron siguen siendo miembros.',
    ],
    steps: [
      'Abre la página del proyecto (no el editor) en la página de Proyectos.',
      'En la sección «Enlaces de acceso» elige el tipo (Lectura o Diseño).',
      'Pulsa «Crear enlace» y cópialo para compartirlo.',
      'Si necesitas cortar accesos, desactívalo con el botón «Desactivar».',
    ],
    tip: 'Los enlaces solo amplían permisos; nunca elevan a Dueño. El último dueño no puede ser eliminado.',
    action: { label: 'Ir a Proyectos', route: '/projects' },
  },
  {
    id: 'invitar-seguidores',
    category: 'colaboracion',
    title: 'Invita a quien ya sigues con un clic',
    summary: 'Visible en «Invitar seguidores» del detalle del proyecto.',
    icon: '🫶',
    keywords: 'invitar seguidores seguir follow inbox invitar boton invitacion uno-click',
    body: [
      'Si sigues a personas en la comunidad, tu proyecto puede enumerarlas en «Invitar seguidores» dentro del detalle del proyecto.',
      'Pulsa «Invitar» en cada fila: la invitación se envía y la persona recibe una notificación en su buzón de actividades.',
      'La invitación queda pendiente hasta que la acepte desde su propia sección de notificaciones o desde la página de Proyectos.',
      'Si la persona no acepta nunca, el enlace expira automáticamente a los 7 días sin coste para nadie.',
    ],
    steps: [
      'Sigue a la persona que quieres invitar en su perfil (pulsa el botón «Seguir»).',
      'Entra al detalle del proyecto y desplázate hasta «Invitar seguidores».',
      'Pulsa «Invitar» en la fila correcta: la notificación se envía al instante.',
      'Cuando la persona acepte, aparecerá como miembro del proyecto en la lista de Miembros.',
    ],
    tip: 'Los Invitados por seguidores quedan como miembro automáticamente al aceptar, no hace falta hacer email-based.',
    action: { label: 'Ir a Proyectos', route: '/projects' },
  },
  {
    id: 'notificaciones',
    category: 'comunidad',
    title: 'Tu buzón de notificaciones',
    summary: 'Likes, comentarios, mensajes, follows, remixes y más.',
    icon: '🔔',
    keywords: 'notificaciones like comment follow mensaje remix invitacion todos borrar filtrar inbox',
    body: [
      'La campana de la cabecera muestra tus notificaciones en vivo: quién te sigue, quién dio like a tu modelo, quién comentó, quién te envió un mensaje, quién remixeó tu pieza o quién se unió a tu proyecto.',
      'Puedes verlas agrupadas por fecha (Hoy / Ayer / Anteriores), filtrar solo las no leídas con «Sin leer» y borrar todas las leídas con «Borrar leídas».',
      'Pulsa cualquier notificación para ir al contenido relacionado (mensaje → conversación, like → tu modelo, etc.).',
      'Pulsa «Marcar todas» para marcar todas como leídas de una sola vez.',
    ],
    steps: [
      'Pulsa la campana 🔔 en la cabecera.',
      'Despliega un grupo (Hoy / Ayer / Anteriores) para ver actividad reciente.',
      'Filtra con «Sin leer» para ver únicamente las que te faltan por ver.',
      'Pulsa cualquier notificación para ir a la conversación o al modelo, o marca todas como leídas.',
    ],
    tip: 'Si no ves al actor o la fecha, comprueba tu conexión; el buzón se llena solo con conexión.',
    action: { label: 'Ir a la comunidad', route: '/feed' },
  },
  {
    id: 'seguir-creadores',
    category: 'comunidad',
    title: 'Seguir y dejar de seguir creadores',
    summary: 'Construye tu feed y activa las notificaciones de quien sigues.',
    icon: '⭐',
    keywords: 'seguir unfollow seguir sigue followers unfollow perfil notificacion',
    body: [
      'Cuando sigues a una persona, verás su contenido primero en tu feed personalizado y recibirás una notificación por cada like, comentario, mensaje, remix o invitación que recibas suyo.',
      'Puedes seguir desde el perfil del creador o desde cualquier publicación tocando el nombre de su autor y pulsando «Seguir».',
      'Para dejar de seguir, pulsa el mismo botón («Siguiendo») en su perfil.',
      'Las publicaciones de quien sigues se ven primero en el feed, aunque no tengas notificaciones activadas en ellas.',
    ],
    steps: [
      'Abre cualquier publicación y pulsa el nombre del autor.',
      'En su perfil, pulsa «Seguir».',
      'Vuelve a «Tu feed» para ver sus publicaciones destacadas primero.',
      'Si quieres dejar de seguir, pulsa «Siguiendo» en su perfil.',
    ],
    tip: 'Seguir a un creador es lo más parecido a «ambientarte» con su estilo: por eso sus avances te aparecen antes.',
    action: { label: 'Ir a la comunidad', route: '/feed' },
  },
  {
    id: 'mensajes-directos',
    category: 'comunidad',
    title: 'Mensajes directos entre creadores',
    summary: 'Chatea con cualquier creador desde el feed o su perfil.',
    icon: '💬',
    keywords: 'mensajes directo privado chat escribir mensaje contacto',
    body: [
      'Cualquier usuario puede escribir un mensaje privado a cualquier otro desde el campo «Enviar mensaje» del perfil o del botón de burbuja en el chat.',
      'Los mensajes se entregan en tiempo real y quedan en la página de Mensajes (/chat).',
      'Recibes una notificación con cada mensaje, y se marca como leído al abrirlo.',
      'Los mensajes incluyen lo último enviado: feedback sobre un modelo, dudas, invitaciones a proyectos, etc.',
    ],
    steps: [
      'Abre el perfil del creador o un modelo suyo.',
      'Pulsa el botón «Enviar mensaje» (burbuja 💬).',
      'Escribe tu mensaje; aparecerá en la página /chat.',
      'Espera la respuesta: llegará con una notificación en tu campana.',
    ],
    tip: 'Los mensajes respetuosos y directos consiguen mejores respuestas que los mensajes de recién llegado.',
    action: { label: 'Ir a Mensajes', route: '/chat' },
  },
  {
    id: 'escena-comparte',
    category: 'colaboracion',
    title: 'Comparte tu escena con un código',
    summary: 'La forma más rápida de pasar una escena de /editor a otra pestaña.',
    icon: '📎',
    keywords: 'compartir escena codigo base64 copiar pega tab exportar pegar',
    body: [
      'Además de los proyectos, puedes compartir una escena con código copiando el contenido desde el menú de Exportar → «Copiar escena como código».',
      'El código es el JSON de la escena listo para crear una copia idéntica en otro editor abierto en otra pestaña.',
      'Es la vía más rápida para saltarse publicar un proyecto o compartir por enlace: simplemente pega el código en «Importar escena» del otro editor.',
    ],
    steps: [
      'Abre el menú Exportar del editor.',
      'Elige «Copiar escena como código».',
      'Abre otro editor (u otro dispositivo) y pulsa «Importar escena».',
      'Pega el código; tu escena aparecerá tal cual la tenías.',
    ],
    tip: 'Si planeas compartir regularmente, mejor crea un proyecto y comparte por enlace: los mensajes y la versión se sincronizan igual.',
    action: { label: 'Abrir el editor', route: '/editor' },
  },
];

@Component({
  selector: 'app-help-page',
  standalone: true,
  imports: [
    TranslatePipe,FormsModule, RouterLink, ShellHeaderComponent, SiteFooterComponent],
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

  /** --- Asistente CARXY (beta) --- */
  readonly assistantQuestion = signal('');
  readonly assistantAnswer = signal('');
  readonly assistantError = signal('');
  readonly asking = signal(false);
  readonly assistantHistory = signal<Array<{ q: string; a: string }>>([]);

  private readonly route = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly i18n = inject(I18nService);
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
        this.i18n.translate(article.title),
        this.i18n.translate(article.summary),
        ...article.body.map((paragraph) => this.i18n.translate(paragraph)),
        ...(article.steps ?? []).map((step) => this.i18n.translate(step)),
        this.i18n.translate(article.tip ?? ''),
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

  /**
   * Pregunta al asistente (Gemini vía Cloud Function `askCarxyBot`).
   * La clave de la API nunca toca el cliente; si el backend no está configurado,
   * la función devuelve un mensaje amable y el asistente no falla.
   */
  async askAssistant(): Promise<void> {
    const question = this.assistantQuestion().trim();
    if (!question || this.asking()) return;
    this.asking.set(true);
    this.assistantError.set('');
    this.assistantAnswer.set('');
    try {
      if (typeof getFunctions !== 'function') {
        throw new Error('functions-not-available');
      }
      const callable = httpsCallable(getFunctions(), 'askCarxyBot');
      const result = await callable({ question });
      const answer = String((result?.data as { answer?: string } | undefined)?.answer ?? '').trim();
      if (!answer) throw new Error('empty-answer');
      this.assistantAnswer.set(answer);
      this.assistantHistory.update((history) => [...history, { q: question, a: answer }].slice(-3));
      this.assistantQuestion.set('');
    } catch (error) {
      const code = String((error as { code?: string; message?: string })?.code ?? '');
      if (code.includes('unauthenticated')) {
        this.assistantError.set(this.i18n.translate('Tu sesión aún no está lista. Recarga la página o inténtalo de nuevo en un momento.'));
      } else {
        this.assistantError.set(this.i18n.translate('El asistente no pudo responder ahora. Inténtalo de nuevo en unos segundos.'));
      }
    } finally {
      this.asking.set(false);
      this.cdr.detectChanges();
    }
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
