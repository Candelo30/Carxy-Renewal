import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

export interface LegalSection {
  id: string;
  title: string;
  paragraphs: string[];
  list?: string[];
}

export interface LegalDocument {
  docId: string;
  eyebrow: string;
  title: string;
  intro: string;
  updated: string;
  sections: LegalSection[];
  footnote: string;
}

const DOCS: Record<string, LegalDocument> = {
  terminos: {
    docId: 'terminos',
    eyebrow: 'DOCUMENTO LEGAL',
    title: 'Términos y condiciones de uso',
    intro: 'Estos términos regulan el acceso y el uso de CARXY 3D STUDIO: qué puedes hacer, qué esperamos de ti y qué responsabilidades asumimos. Al crear una cuenta o usar el editor aceptas este acuerdo.',
    updated: 'Última actualización: 11 de noviembre de 2026',
    sections: [
      {
        id: 'aceptacion',
        title: '1. Aceptación de los términos',
        paragraphs: [
          'Al acceder, navegar o usar CARXY 3D STUDIO confirmas que has leído, comprendido y aceptas estos términos, junto con nuestra política de privacidad y las políticas de la comunidad. Si no estás de acuerdo con alguna parte, debes abstenerte de usar el servicio.',
          'El uso del servicio por parte de personas menores de 14 años no está permitido. Si tienes entre 14 y 18 años necesitas el consentimiento de un adulto responsable.',
        ],
      },
      {
        id: 'servicio',
        title: '2. Descripción del servicio',
        paragraphs: [
          'CARXY es un estudio 3D que funciona en el navegador. Incluye un editor de escenas con primitivas, materiales y transformaciones; publicación de modelos en un feed comunitario; remixes; perfiles de creador; proyectos colaborativos; chat; y notificaciones.',
          'El servicio se ofrece «tal cual» y «según disponibilidad». Podemos modificar, suspender o discontinuar funciones, total o parcialmente, con o sin previo aviso, sin que ello genere derecho a indemnización.',
        ],
      },
      {
        id: 'cuentas',
        title: '3. Cuentas de usuario',
        paragraphs: [
          'Eres responsable de la confidencialidad de tus credenciales y de toda actividad realizada desde tu cuenta. Debes proporcionar información veraz y mantenerla actualizada.',
          'Está prohibido suplantar identidades, crear cuentas para eludir suspensiones o compartir el acceso de forma masiva. Podemos suspender cuentas que infrinjan estas reglas o que comprometan la seguridad de la plataforma.',
        ],
        list: [
          'Usa una contraseña única de al menos 8 caracteres, con letras y números.',
          'Verifica tu correo para habilitar todas las funciones.',
          'Notifícanos de inmediato cualquier acceso no autorizado.',
        ],
      },
      {
        id: 'contenido',
        title: '4. Contenido de los usuarios y licencia',
        paragraphs: [
          'Conservas todos los derechos sobre el contenido que creas y publicas. Al publicar en el feed nos concedes una licencia mundial, no exclusiva y libre de regalías para alojar, mostrar, reproducir y distribuir tu contenido dentro del servicio, con el único fin de operarlo y promocionarlo.',
          'Esta licencia se extingue cuando eliminas el contenido o tu cuenta, salvo que el contenido haya sido remixado por otras personas: los remixes conservan su propia licencia según estos mismos términos.',
          'Declaras que tu contenido no infringe derechos de terceros (propiedad intelectual, imagen, privacidad) ni las leyes aplicables.',
        ],
      },
      {
        id: 'uso-aceptable',
        title: '5. Uso aceptable',
        paragraphs: [
          'No puedes usar CARXY para actividades ilegales, dañinas o engañosas. Entre otras conductas prohibidas: contenido de odio, acoso, pornografía, malware, spam, scraping abusivo, ingeniería inversa de los servicios y cualquier intento de comprometer la infraestructura.',
          'La automatización del acceso (bots, scrapers) requiere autorización escrita previa. El uso abusivo puede dar lugar a la suspensión inmediata de la cuenta y a acciones legales.',
        ],
      },
      {
        id: 'propiedad',
        title: '6. Propiedad intelectual',
        paragraphs: [
          'El software, la marca, los logotipos, el diseño de la interfaz y la documentación de CARXY son propiedad de sus titulares y están protegidos por las leyes de propiedad intelectual.',
          'La comunidad puede compartir modelos bajo la licencia que indiques en cada publicación. La marca CARXY no puede usarse para sugerir respaldo oficial de productos o servicios ajenos sin autorización.',
        ],
      },
      {
        id: 'disponibilidad',
        title: '7. Disponibilidad y cambios del servicio',
        paragraphs: [
          'No garantizamos un funcionamiento ininterrumpido ni libre de errores. Pueden existir interrupciones por mantenimiento, incidentes de red o causas de fuerza mayor.',
          'El modo local de demostración guarda tus datos solo en tu navegador: bórralo y perderás tu información. Configura Firebase para sincronización en la nube y copias persistentes.',
        ],
      },
      {
        id: 'terminacion',
        title: '8. Suspensión y terminación',
        paragraphs: [
          'Puedes eliminar tu cuenta en cualquier momento desde el menú de cuenta → Seguridad → Eliminar cuenta. La eliminación es permanente: se borran perfil, publicaciones, likes y seguimientos; los mensajes se conservan como «Cuenta eliminada» para no romper las conversaciones ajenas.',
          'Podemos suspender o cancelar tu acceso si incumples estos términos, las políticas de la comunidad o la ley, o si tu conducta pone en riesgo a otras personas o a la plataforma. En casos graves, sin previo aviso.',
        ],
      },
      {
        id: 'responsabilidad',
        title: '9. Limitación de responsabilidad',
        paragraphs: [
          'En la máxima medida permitida por la ley, CARXY no responderá por daños indirectos, incidentales, especiales o consecuentes (pérdida de datos, de ganancias o de reputación) derivados del uso o la imposibilidad de uso del servicio.',
          'Nuestra responsabilidad total agregada por cualquier reclamación se limita al importe que hayas pagado por el servicio en los 12 meses anteriores (o a cero, dado que el servicio actualmente es gratuito).',
        ],
      },
      {
        id: 'ley',
        title: '10. Ley aplicable y resolución de disputas',
        paragraphs: [
          'Estos términos se rigen por las leyes de Colombia, sin perjuicio de las normas imperativas de protección al consumidor aplicables en tu país de residencia.',
          'Las disputas se someterán, en primera instancia, a un intento de resolución amistosa a través de contacto@carxy.app. Si no se resuelve, serán competentes los tribunales de la ciudad de residencia del titular del servicio, salvo que la ley disponga otra cosa.',
        ],
      },
      {
        id: 'cambios',
        title: '11. Cambios en estos términos',
        paragraphs: [
          'Podemos actualizar estos términos para reflejar cambios legales, técnicos o de producto. Publicaremos la versión vigente en esta página con su fecha de actualización.',
          'Si los cambios son sustanciales, te avisaremos dentro del servicio o por correo al menos 15 días antes de su entrada en vigor. El uso continuado tras la fecha implica aceptación.',
        ],
      },
      {
        id: 'contacto',
        title: '12. Contacto',
        paragraphs: [
          'Para dudas sobre estos términos escríbenos a contacto@carxy.app o abre un issue en el repositorio de GitHub del proyecto.',
          'Este documento es informativo y no constituye asesoría legal. Para casos específicos consulta a un profesional del derecho.',
        ],
      },
    ],
    footnote: 'Este documento es una plantilla estándar del proyecto y no sustituye el asesoramiento de un abogado para tu caso concreto.',
  },
  privacidad: {
    docId: 'privacidad',
    eyebrow: 'DOCUMENTO LEGAL',
    title: 'Política de privacidad',
    intro: 'Explicamos qué datos recopilamos, por qué, dónde se guardan y cómo ejercer tus derechos. Diseñamos CARXY para funcionar con la mínima cantidad de datos posible.',
    updated: 'Última actualización: 11 de noviembre de 2026',
    sections: [
      {
        id: 'responsable',
        title: '1. Responsable del tratamiento',
        paragraphs: [
          'El responsable del tratamiento de los datos personales tratados a través de CARXY 3D STUDIO es el equipo detrás del proyecto, contactable en contacto@carxy.app.',
          'Si despliegas tu propia instancia de CARXY, tú te conviertes en responsable del tratamiento de los datos que recopiles; esta política describe la instancia oficial.',
        ],
      },
      {
        id: 'datos',
        title: '2. Información que recopilamos',
        paragraphs: [
          'Recopilamos solo lo necesario para operar el servicio:',
        ],
        list: [
          'Datos de cuenta: nombre visible, correo, avatar, biografía y método de acceso (contraseña o Google).',
          'Contenido: modelos GLB, miniaturas, títulos, descripciones, etiquetas, comentarios, likes y publicaciones.',
          'Datos de uso: preferencias de editor, idioma, progreso de la guía y eventos de interacción dentro de la app.',
          'Datos técnicos: tipo de navegador, sistema operativo y registros de error para diagnóstico.',
          'En modo local: todo lo anterior se guarda únicamente en el almacenamiento de tu navegador.',
        ],
      },
      {
        id: 'uso',
        title: '3. Cómo usamos la información',
        paragraphs: [
          'Usamos tus datos para: crear y mantener tu cuenta; guardar y sincronizar tu portafolio; mostrar publicaciones al feed; operar comentarios, likes, seguidores y notificaciones; moderar contenido y atender reportes; y mejorar el producto con métricas agregadas.',
          'No vendemos tus datos personales ni los usamos para publicidad de terceros.',
        ],
      },
      {
        id: 'base',
        title: '4. Base legal del tratamiento',
        paragraphs: [
          'Tratamos tus datos con base en: la ejecución del contrato de servicio que aceptas al registrarte; tu consentimiento (por ejemplo, verificación de correo o comunicaciones); y nuestro interés legítimo en mantener la plataforma segura, prevenir abusos y cumplir la ley.',
          'Puedes retirar tu consentimiento en cualquier momento sin afectar la licitud del tratamiento previo.',
        ],
      },
      {
        id: 'almacenamiento',
        title: '5. Dónde se guardan los datos',
        paragraphs: [
          'Con Firebase configurado (producción), los perfiles y publicaciones viven en Cloud Firestore; los archivos GLB y las miniaturas en Cloud Storage; y la autenticación en Firebase Authentication (Google Cloud, con infraestructura en la región que elijas al desplegar).',
          'En el modo local de demostración no existe servidor propio: cuentas de prueba, borradores y preferencias se guardan en localStorage e IndexedDB de tu navegador. Borrar los datos del sitio equivale a eliminar esa información.',
          'Las reglas de seguridad de Firestore y Storage limitan quién puede leer y escribir cada documento; el detalle técnico está publicado en el repositorio.',
        ],
      },
      {
        id: 'cookies',
        title: '6. Cookies y almacenamiento local',
        paragraphs: [
          'CARXY no usa cookies de seguimiento ni píxeles publicitarios. Usamos almacenamiento local del navegador para: sesión de Firebase, preferencias de apariencia e idioma, borradores del editor y progreso de la guía.',
          'Puedes borrar este almacenamiento desde los ajustes de tu navegador; perderás sesión y borradores no publicados, pero no tu cuenta en la nube.',
        ],
      },
      {
        id: 'terceros',
        title: '7. Terceros y encargados del tratamiento',
        paragraphs: [
          'Compartimos datos con los proveedores estrictamente necesarios para operar:',
        ],
        list: [
          'Google / Firebase (autenticación, base de datos y almacenamiento de archivos).',
          'GitHub (enlaces a issues, discusiones y repositorio; no recibe datos de tu cuenta salvo que interactúes allí).',
          'Proveedores de correo transaccional (verificación y recuperación de contraseña), si los configuras.',
        ],
      },
      {
        id: 'retencion',
        title: '8. Retención de datos',
        paragraphs: [
          'Conservamos tus datos mientras tu cuenta esté activa o mientras sean necesarios para prestar el servicio. Las publicaciones eliminadas se borran de forma definitiva, incluidos sus archivos y miniaturas.',
          'Los mensajes se conservan como «Cuenta eliminada» tras la baja de una cuenta, sin datos personales del emisor. Los registros de seguridad se conservan hasta 12 meses.',
        ],
      },
      {
        id: 'derechos',
        title: '9. Tus derechos',
        paragraphs: [
          'Tienes derecho a acceder, rectificar, suprimir, oponerte, limitar el tratamiento y portar tus datos. También a retirar el consentimiento y a presentar una reclamación ante tu autoridad de protección de datos.',
        ],
        list: [
          'Acceso y rectificación: edítalos desde tu perfil o escríbenos.',
          'Eliminación: menú de cuenta → Seguridad → Eliminar cuenta.',
          'Portabilidad y exportación: descarga tus modelos GLB desde «Mis creaciones».',
          'Ejercicio de derechos: contacto@carxy.app con el asunto «Protección de datos».',
        ],
      },
      {
        id: 'seguridad',
        title: '10. Seguridad',
        paragraphs: [
          'Aplicamos cifrado en tránsito (HTTPS/TLS), reglas de acceso por rol en Firestore y Storage, validación de entradas y límites de actividad. Ninguna medida es infalible: reporta vulnerabilidades a contacto@carxy.app o mediante la política de seguridad del repositorio.',
        ],
      },
      {
        id: 'menores',
        title: '11. Menores de edad',
        paragraphs: [
          'CARXY no está dirigido a menores de 14 años y no recopilamos conscientemente sus datos. Si detectamos una cuenta de un menor sin consentimiento, la eliminaremos. Si eres adulto responsable y crees que un menor usa el servicio, contáctanos.',
        ],
      },
      {
        id: 'cambios',
        title: '12. Cambios en esta política',
        paragraphs: [
          'Publicaremos cualquier cambio en esta página con su fecha de actualización. Si los cambios son significativos te avisaremos dentro del servicio o por correo antes de que entren en vigor.',
        ],
      },
      {
        id: 'contacto',
        title: '13. Contacto y reclamaciones',
        paragraphs: [
          'Ejerce tus derechos o consulta dudas en contacto@carxy.app. También puedes abrir un issue en GitHub para cuestiones públicas no sensibles (nunca incluyas datos personales).',
          'Tienes derecho a presentar una reclamación ante la autoridad de protección de datos de tu país.',
        ],
      },
    ],
    footnote: 'Este documento resume nuestras prácticas de datos y no sustituye el asesoramiento legal para tu situación particular.',
  },
  politicas: {
    docId: 'politicas',
    eyebrow: 'CONVIVENCIA',
    title: 'Políticas de la comunidad',
    intro: 'CARXY es una comunidad de personas que crean juntas. Estas políticas explican las normas de convivencia, qué contenido no está permitido y cómo actuamos cuando algo sale mal.',
    updated: 'Última actualización: 11 de noviembre de 2026',
    sections: [
      {
        id: 'respeto',
        title: '1. Normas básicas de convivencia',
        paragraphs: [
          'Trata a las demás personas como te gustaría ser tratada: crítica su trabajo, no a las personas. No se toleran insultos, acoso, amenazas, discriminación por origen, identidad, género, religión o discapacidad, ni la difusión de datos personales ajenos.',
          'Los desacuerdos técnicos y creativos son bienvenidos; la hostilidad no. El feed, los comentarios, el chat y los proyectos colaborativos están sujetos a estas normas por igual.',
        ],
      },
      {
        id: 'prohibido',
        title: '2. Contenido prohibido',
        paragraphs: [
          'No publiques ni compartas:',
        ],
        list: [
          'Contenido ilegal, violento, sexual explícito o que ponga en riesgo a menores.',
          'Odio, acoso, doxxing o suplantación de identidad.',
          'Spam, estafa, phishing, malware o enlaces maliciosos.',
          'Infracción de propiedad intelectual: modelos o texturas que no tienes derecho a redistribuir.',
          'Contenido que glorifique autolesiones o conductas peligrosas.',
          'Desinformación deliberada sobre salud, seguridad o emergencias.',
        ],
      },
      {
        id: 'etiquetas',
        title: '3. Etiquetado y honestidad',
        paragraphs: [
          'Publica con títulos, descripciones y etiquetas honestas. No uses etiquetas engañosas para inflar visitas, ni marques como propio trabajo de terceros.',
          'Si tu contenido es remix de otra persona, indícalo en la descripción y menciona a la persona autora. La atribución honesta es la base de la cultura de remezcla.',
        ],
      },
      {
        id: 'remix',
        title: '4. Remixes y atribución',
        paragraphs: [
          'Cualquier publicación pública puede remixearse desde el editor. El remix es una obra nueva: no modifica el original ni transfiere su autoría.',
          'Remixear no borra las obligaciones: conserva los avisos de licencia originales cuando apliquen, acredita al autor y no subas remixes que infrinjan derechos de terceros.',
        ],
      },
      {
        id: 'moderacion',
        title: '5. Cómo funciona la moderación',
        paragraphs: [
          'La moderación revisa los reportes de la comunidad y actúa sobre contenido y conductas que infrinjan estas políticas. Las decisiones se basan en evidencia, contexto e historial.',
          'Cualquier persona puede reportar publicaciones, comentarios, mensajes y perfiles desde la propia interfaz. Los reportes son confidenciales: no se notifica al autor quién reportó.',
        ],
      },
      {
        id: 'acciones',
        title: '6. Medidas que puede aplicar la moderación',
        paragraphs: [
          'Según la gravedad y la reincidencia, las medidas posibles son:',
        ],
        list: [
          'Advertencia privada con indicación de la norma infringida.',
          'Eliminación del contenido infractor.',
          'Bloqueo temporal de publicación, comentario o chat.',
          'Suspensión temporal de la cuenta.',
          'Suspensión definitiva en casos graves o reiterados.',
          'Reporte a las autoridades cuando corresponda por la ley.',
        ],
      },
      {
        id: 'reportes',
        title: '7. Cómo reportar',
        paragraphs: [
          'Usa la opción de reporte del contenido correspondiente y describe brevemente el motivo. Para fallos técnicos o temas que no caben en un reporte, abre un issue en GitHub o escribe a contacto@carxy.app.',
          'No uses los reportes como represalia contra críticas legítimas: el abuso del sistema de reportes también se modera.',
        ],
      },
      {
        id: 'apelaciones',
        title: '8. Apelaciones y correcciones',
        paragraphs: [
          'Si tu contenido fue eliminado o tu cuenta suspendida y crees que es un error, puedes apelar respondiendo al aviso de moderación o escribiendo a contacto@carxy.app con el asunto «Apelación».',
          'Revisamos las apelaciones en un plazo máximo de 14 días. La decisión final corresponde al equipo de administración; los abusos reiterados no son apelables.',
        ],
      },
      {
        id: 'roles',
        title: '9. Moderadores y administradores',
        paragraphs: [
          'Los moderadores revisan reportes, fijan o bloquean hilos, eliminan contenido y aplican advertencias. Los administradores gestionan roles, suspensiones y la configuración de la plataforma.',
          'Nadie con rol especial está exento de estas normas, y estos roles no otorgan acceso a datos privados más allá de lo estrictamente necesario para moderar.',
        ],
      },
      {
        id: 'cambios',
        title: '10. Cambios en las políticas',
        paragraphs: [
          'Actualizaremos estas políticas cuando la comunidad o la ley lo requieran. La fecha de actualización figura en la parte superior de esta página; los cambios sustanciales se anunciarán dentro del servicio.',
        ],
      },
    ],
    footnote: 'Estas políticas conviven con los Términos y condiciones y la Política de privacidad del servicio.',
  },
};

@Component({
  selector: 'app-info-page',
  standalone: true,
  imports: [RouterLink, ShellHeaderComponent, SiteFooterComponent, TranslatePipe],
  templateUrl: './info-page.html',
  styleUrl: './legal-page.css',
})
export class InfoPageComponent {
  private readonly route = inject(ActivatedRoute);

  readonly docId = toSignal(
    this.route.data.pipe(map((data) => (typeof data['doc'] === 'string' ? data['doc'] : 'terminos'))),
    { initialValue: 'terminos' },
  );

  readonly doc = computed(() => DOCS[this.docId()] ?? DOCS['terminos']);
}
