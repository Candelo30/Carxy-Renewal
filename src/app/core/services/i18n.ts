import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { APP_LANGUAGES, AppLanguage, DEFAULT_LANGUAGE, isAppLanguage } from '../i18n/languages';
import { LOCALE_OVERLAYS } from '../i18n/locales';
import { MESSAGES, MessageTranslations } from '../i18n/messages';
import { SOURCE_TRANSLATIONS, SourceTranslation } from '../i18n/source-translations';
import { LocalStateService } from './local-state';

export type TranslationParams = Record<string, string | number>;

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly localState = inject(LocalStateService);

  readonly language = signal<AppLanguage>(this.initialLanguage());
  readonly languages = APP_LANGUAGES;

  constructor() {
    this.applyDocumentLanguage(this.language());
  }
  readonly currentLanguage = computed(() => this.language());
  readonly isSpanish = computed(() => this.language() === 'es');

  setLanguage(language: AppLanguage): void {
    if (!isAppLanguage(language) || language === this.language()) return;
    this.language.set(language);
    this.applyDocumentLanguage(language);
    if (isPlatformBrowser(this.platformId)) {
      const preferences = this.localState.loadPreferences();
      this.localState.savePreferences({ ...preferences, language });
    }
  }

  toggleLanguage(): void {
    const index = APP_LANGUAGES.findIndex((option) => option.code === this.language());
    this.setLanguage(APP_LANGUAGES[(index + 1) % APP_LANGUAGES.length].code);
  }

  /** Traduce una clave semántica o un texto original en español. */
  translate(key: string | null | undefined, params?: TranslationParams): string {
    if (!key) return '';
    const language = this.language();
    const message = this.lookupMessage(key);
    const source = this.lookupSource(key);

    if (language === 'es') {
      const spanish = this.spanishMessage(key) ?? (source ? key : undefined);
      return this.interpolate(spanish ?? key, params);
    }

    const value = this.lookupOverlay(language, key)
      ?? message?.[language]
      ?? source?.[language]
      ?? message?.en
      ?? source?.en
      ?? this.spanishMessage(key)
      ?? (source ? key : undefined);

    return value ? this.interpolate(value, params) : key;
  }

  private readonly normalizedMessageIndex = new Map<string, MessageTranslations>();
  private readonly normalizedSourceIndex = new Map<string, SourceTranslation>();
  private readonly overlayIndexes = new Map<AppLanguage, Map<string, string>>();

  private lookupMessage(key: string): MessageTranslations | undefined {
    const direct = MESSAGES[key];
    if (direct) return direct;
    if (!this.normalizedMessageIndex.size) {
      for (const [candidate, value] of Object.entries(MESSAGES)) {
        const normalized = this.normalizeKey(candidate);
        if (!this.normalizedMessageIndex.has(normalized)) {
          this.normalizedMessageIndex.set(normalized, value);
        }
      }
    }
    return this.normalizedMessageIndex.get(this.normalizeKey(key));
  }

  private lookupSource(key: string): SourceTranslation | undefined {
    const direct = SOURCE_TRANSLATIONS[key];
    if (direct) return direct;
    if (!this.normalizedSourceIndex.size) {
      for (const [candidate, value] of Object.entries(SOURCE_TRANSLATIONS)) {
        const normalized = this.normalizeKey(candidate);
        if (!this.normalizedSourceIndex.has(normalized)) {
          this.normalizedSourceIndex.set(normalized, value);
        }
      }
    }
    return this.normalizedSourceIndex.get(this.normalizeKey(key));
  }

  private lookupOverlay(language: AppLanguage, key: string): string | undefined {
    const overlay = LOCALE_OVERLAYS[language];
    if (!overlay) return undefined;
    let index = this.overlayIndexes.get(language);
    if (!index) {
      index = new Map<string, string>();
      for (const [candidate, value] of Object.entries(overlay)) {
        const normalized = this.normalizeKey(candidate);
        if (!index.has(normalized)) index.set(normalized, value);
      }
      this.overlayIndexes.set(language, index);
    }
    return index.get(this.normalizeKey(key));
  }

  private normalizeKey(key: string): string {
    return key.replace(/\s+/g, ' ').trim();
  }

  /** Alias explícito para textos que ya están escritos en español. */
  source(spanish: string, params?: TranslationParams): string {
    return this.translate(spanish, params);
  }

  localize<T>(values: Partial<Record<AppLanguage, T>>): T | undefined {
    return values[this.language()] ?? values.en ?? values.es;
  }

  private spanishMessage(key: string): string | undefined {
    const spanish: Record<string, string> = {
      'common.cancel': 'Cancelar',
      'common.close': 'Cerrar',
      'common.save': 'Guardar',
      'common.saved': 'Guardado',
      'common.saving': 'Guardando…',
      'common.send': 'Enviar',
      'common.sending': 'Enviando…',
      'common.search': 'Buscar',
      'common.loading': 'Cargando…',
      'common.retry': 'Reintentar',
      'common.delete': 'Eliminar',
      'common.edit': 'Editar',
      'common.share': 'Compartir',
      'common.copy': 'Copiar',
      'common.copied': 'Copiado',
      'common.view': 'Ver',
      'common.public': 'Público',
      'common.private': 'Privado',
      'common.active': 'Activa',
      'common.suspended': 'Suspendida',
      'common.open': 'Abierto',
      'common.resolved': 'Resuelto',
      'common.dismissed': 'Descartado',
      'common.new': 'Nuevo',
      'common.inReview': 'En revisión',
      'common.all': 'Todos',
      'common.required': 'Obligatorio',
      'common.optional': 'Opcional',
      'common.back': 'Volver',
      'common.next': 'Siguiente',
      'common.previous': 'Anterior',
      'common.confirm': 'Confirmar',
      'common.remove': 'Quitar',
      'common.add': 'Añadir',
      'common.none': 'Ninguno',
      'common.yes': 'Sí',
      'common.no': 'No',
      'common.error': 'Algo salió mal',
      'common.success': 'Hecho',
      'common.language': 'Idioma',
      'common.spanish': 'Español',
      'common.english': 'Inglés',
      'common.french': 'Francés',
      'common.portuguese': 'Portugués',
      'nav.community': 'Comunidad',
      'nav.editor': 'Editor 3D',
      'nav.myModels': 'Mis creaciones',
      'nav.projects': 'Proyectos',
      'nav.messages': 'Mensajes',
      'nav.admin': 'Admin',
      'nav.moderation': 'Moderar',
      'nav.favorites': 'Mis favoritos',
      'nav.help': 'Centro de ayuda',
      'nav.gettingStarted': 'Guía de inicio',
      'nav.about': 'Sobre nosotros',
      'nav.contact': 'Contacto',
      'nav.communityHelp': 'Ayuda comunitaria',
      'nav.login': 'Iniciar sesión',
      'nav.register': 'Crear cuenta',
      'nav.logout': 'Cerrar sesión',
      'nav.account': 'Cuenta',
      'nav.language': 'Idioma',
      'nav.resources': 'Recursos',
      'nav.navigation': 'Navegación',
      'nav.menu': 'Menú',
      'nav.profile': 'Mi perfil',
      'nav.publish': 'Publicar',
      'nav.presentation': 'Presentación',
      'nav.searchPlaceholder': 'Buscar modelos, creadores, etiquetas…',
      'nav.searchAria': 'Buscar en la comunidad',
      'nav.clearSearch': 'Limpiar búsqueda',
      'nav.openMenu': 'Abrir menú principal',
      'nav.closeMenu': 'Cerrar menú',
      'nav.commandPalette': 'Abrir paleta de comandos',
      'nav.helpCenter': 'Centro de ayuda',
      'nav.adminPanel': 'Panel de administración',
      'nav.moderationPanel': 'Panel de moderación',
      'nav.myFavorites': 'Mis favoritos',
      'nav.footerLinks': 'Enlaces del pie de página',
      'nav.product': 'Producto',
      'nav.security': 'Seguridad',
      'nav.accountSecurity': 'Cuenta y seguridad',
      'nav.privacyData': 'Privacidad y datos',
      'nav.keyboardShortcuts': 'Atajos de teclado',
      'nav.github': 'GitHub',
      'nav.footerCopy': 'Hecho con Angular + Three.js · Creado para navegar, no para instalar',
      'footer.brandCopy': 'Un estudio 3D en el navegador para crear, publicar y remixear ideas con la comunidad.',
      'account.trigger': 'Cuenta y ajustes',
      'account.openMenu': 'Abrir menú de cuenta',
      'account.openSettings': 'Abrir ajustes',
      'account.unverifiedEmail': 'Correo sin verificar',
      'account.viewProfile': 'Ver perfil',
      'account.appearance': 'Apariencia',
      'account.security': 'Seguridad',
      'account.securityTitle': 'Seguridad de la cuenta',
      'account.appearanceTitle': 'Ajustes de apariencia',
      'account.appearanceIntro': 'Personaliza el espacio de trabajo. Los cambios se guardan en este dispositivo.',
      'account.theme': 'Tema',
      'account.themeHint': 'Elige el aspecto general de la aplicación',
      'account.dark': 'Oscuro',
      'account.light': 'Claro',
      'account.system': 'Sistema',
      'account.accentColor': 'Color de acento',
      'account.accentHint': 'Elige el color de acento de la aplicación',
      'account.done': 'Listo',
      'account.securityIntro': 'Protege tu acceso con verificación de correo y contraseña fuerte.',
      'account.email': 'Correo',
      'account.noEmail': 'Sin correo',
      'account.unverified': 'Sin verificar',
      'account.verified': 'Verificado',
      'account.resendVerification': 'Reenviar verificación',
      'account.loginMethods': 'Métodos de acceso',
      'account.unknown': 'Desconocido',
      'account.changePassword': 'Cambiar contraseña',
      'account.currentPassword': 'Contraseña actual',
      'account.newPassword': 'Nueva contraseña',
      'account.confirmPassword': 'Confirmar nueva contraseña',
      'account.passwordsMismatch': 'Las contraseñas no coinciden.',
      'account.updatePassword': 'Actualizar contraseña',
      'account.saving': 'Guardando…',
      'account.externalProvider': 'Tu cuenta usa un proveedor externo (p. ej. Google). Gestiona la contraseña desde ese proveedor.',
      'account.deleteAccount': 'Eliminar cuenta',
      'account.deleteAccountCopy': 'Se borrarán tu perfil, publicaciones y seguimientos. Tus conversaciones se conservarán y tus mensajes aparecerán como “Cuenta eliminada”.',
      'account.deleteMine': 'Eliminar mi cuenta',
      'account.typeDelete': 'Escribe ELIMINAR para confirmar',
      'account.password': 'Contraseña',
      'account.confirmDeletion': 'Confirmar eliminación',
      'account.deleting': 'Eliminando…',
      'account.close': 'Cerrar',
      'account.settingsSaved': 'Tus preferencias visuales quedaron guardadas en este dispositivo.',
      'palette.aria': 'Paleta de comandos',
      'palette.placeholder': 'Busca una acción, página o recurso…',
      'palette.searchAria': 'Buscar comando',
      'palette.empty': 'No encontramos comandos para «{query}».',
      'palette.emptyHint': 'Prueba con “editor”, “favoritos”, “tema” o “ayuda”.',
      'palette.navigate': 'navegar',
      'palette.open': 'abrir',
      'palette.close': 'cerrar',
      'contact.title': 'Contacto',
      'contact.subtitle': 'Cuéntanos qué necesitas. Leemos cada mensaje.',
      'contact.heroEyebrow': 'TE ESCUCHAMOS',
      'contact.heroTitle': 'Construyamos CARXY juntos.',
      'contact.heroText': 'Reporta un error, propón una mejora, pregunta por tu cuenta o plantea una colaboración. Elige el canal que prefieras.',
      'contact.formTitle': 'Envíanos un mensaje',
      'contact.formIntro': 'El mensaje se guarda de forma segura y aparece en el panel de administración. Si inicias sesión, podemos responderte en tu cuenta.',
      'contact.name': 'Tu nombre',
      'contact.email': 'Tu correo',
      'contact.subject': 'Asunto',
      'contact.message': 'Mensaje',
      'contact.type': 'Motivo',
      'contact.type.bug': 'Reportar un error',
      'contact.type.idea': 'Sugerencia',
      'contact.type.account': 'Ayuda con la cuenta',
      'contact.type.collaboration': 'Colaboración',
      'contact.type.other': 'Otro',
      'contact.submit': 'Enviar mensaje',
      'contact.success': 'Mensaje recibido. Gracias por ayudarnos a mejorar CARXY.',
      'contact.error': 'No pudimos enviar tu mensaje. Inténtalo de nuevo.',
      'contact.responseTime': 'Tiempo de respuesta habitual',
      'contact.channels': 'Canales directos',
      'contact.githubIssues': 'Reportar un problema en GitHub',
      'contact.githubDiscussions': 'Participar en las discusiones de GitHub',
      'contact.communityHelp': 'Preguntar a la comunidad',
      'contact.communityHelpCopy': 'Otros creadores pueden responder tus dudas y compartir soluciones.',
      'contact.privacy': 'Solo usamos tu correo para responderte. Nunca compartas contraseñas ni claves privadas.',
      'communityHelp.title': 'Ayuda comunitaria',
      'communityHelp.subtitle': 'Pregunta, responde y crece en comunidad',
      'communityHelp.heroEyebrow': 'CONOCIMIENTO COMPARTIDO',
      'communityHelp.heroTitle': 'Nadie debería quedarse atascado en soledad.',
      'communityHelp.heroText': 'Encuentra respuestas rápidas, abre una pregunta para la comunidad o ayuda a otro creador a resolver la suya. Cada pregunta resuelta mejora CARXY.',
      'communityHelp.ask': 'Hacer una pregunta',
      'communityHelp.browse': 'Explorar preguntas',
      'communityHelp.searchPlaceholder': 'Buscar preguntas y respuestas…',
      'communityHelp.filter.all': 'Todas',
      'communityHelp.filter.open': 'Abiertas',
      'communityHelp.filter.resolved': 'Resueltas',
      'communityHelp.filter.mine': 'Mías',
      'communityHelp.sort.newest': 'Más recientes',
      'communityHelp.sort.answers': 'Más respondidas',
      'communityHelp.sort.votes': 'Más votadas',
      'communityHelp.empty': 'Aún no hay preguntas con estos filtros.',
      'communityHelp.emptyAction': 'Sé la primera persona en preguntar',
      'communityHelp.questionTitle': 'Título de la pregunta',
      'communityHelp.questionBody': 'Describe tu pregunta',
      'communityHelp.questionTags': 'Etiquetas (separadas por comas)',
      'communityHelp.publishQuestion': 'Publicar pregunta',
      'communityHelp.signInToAsk': 'Inicia sesión para preguntar o responder',
      'communityHelp.answers': 'respuestas',
      'communityHelp.answerPlaceholder': 'Escribe una respuesta útil…',
      'communityHelp.postAnswer': 'Publicar respuesta',
      'communityHelp.accepted': 'Respuesta aceptada',
      'communityHelp.accept': 'Aceptar respuesta',
      'communityHelp.resolve': 'Marcar como resuelta',
      'communityHelp.reopen': 'Reabrir',
      'communityHelp.pin': 'Fijar',
      'communityHelp.unpin': 'Quitar fijación',
      'communityHelp.lock': 'Bloquear',
      'communityHelp.unlock': 'Desbloquear',
      'communityHelp.delete': 'Eliminar pregunta',
      'communityHelp.vote': 'Útil',
      'communityHelp.voted': 'Marcada como útil',
      'communityHelp.locked': 'Esta pregunta está bloqueada.',
      'communityHelp.pinned': 'Fijada',
      'communityHelp.by': 'por',
      'communityHelp.answerCount': '{count} respuestas',
      'communityHelp.guidelines': 'Sé específico, indica qué intentaste y respeta a los demás creadores.',
      'feedback.title': 'Feedback',
      'feedback.subtitle': 'Ayúdanos a priorizar lo que viene',
      'feedback.type': 'Tipo',
      'feedback.type.bug': 'Error',
      'feedback.type.idea': 'Idea',
      'feedback.type.question': 'Pregunta',
      'feedback.type.other': 'Otro',
      'feedback.message': 'Tu feedback',
      'feedback.email': 'Correo (opcional)',
      'feedback.submit': 'Enviar feedback',
      'feedback.success': '¡Gracias! Tu feedback quedó guardado.',
      'feedback.signInHint': 'Puedes enviar feedback sin cuenta. Si inicias sesión, podemos responderte en la app.',
      'feedback.privacy': 'No incluyas contraseñas ni claves privadas.',
      'admin.tab.users': 'Usuarios',
      'admin.tab.content': 'Publicaciones',
      'admin.tab.feedback': 'Feedback',
      'admin.tab.help': 'Ayuda comunitaria',
      'admin.feedbackTitle': 'Feedback y mensajes de contacto',
      'admin.feedbackIntro': 'Revisa errores, ideas y solicitudes de contacto. Actualiza su estado a medida que avances.',
      'admin.helpTitle': 'Preguntas de la comunidad',
      'admin.helpIntro': 'Modera el tablero de ayuda: fija preguntas útiles, bloquea hilos abusivos y elimina spam.',
      'admin.status.new': 'Nuevo',
      'admin.status.inReview': 'En revisión',
      'admin.status.reviewing': 'En revisión',
      'admin.status.resolved': 'Resuelto',
      'admin.feedbackEmpty': 'Aún no hay mensajes de feedback.',
      'admin.helpEmpty': 'Aún no hay preguntas de la comunidad.',
      'admin.markInReview': 'Marcar en revisión',
      'admin.markResolved': 'Marcar resuelto',
      'admin.deleteMessage': 'Eliminar mensaje',
      'feed.sort.recent': 'Más recientes',
      'feed.sort.likes': 'Más gustados',
      'feed.sort.views': 'Más vistos',
      'feed.sort.remixes': 'Más remixeados',
      'feed.report.spam': 'Spam',
      'feed.report.inappropriate': 'Contenido inapropiado',
      'feed.report.copyright': 'Derechos de autor',
      'feed.report.other': 'Otro',
      'profile.follow': 'Seguir creador',
      'profile.unfollow': 'Dejar de seguir',
      'profile.message': 'Enviar mensaje',
      'myModels.private': 'Privado',
      'myModels.public': 'Público',
      'myModels.edit': 'Editar detalles',
      'myModels.delete': 'Eliminar',
      'help.title': 'Centro de ayuda',
      'help.subtitle': 'Guías, atajos y respuestas para cada paso',
      'help.searchPlaceholder': 'Buscar guías y respuestas…',
      'help.all': 'Todas',
      'help.noResults': 'No encontramos artículos. Prueba otra búsqueda.',
      'help.communityCta': '¿Necesitas más ayuda? Pregunta a la comunidad',
      'help.contactCta': 'Contactar al equipo',
      'projects.eyebrow': 'Colaboración',
      'projects.statsProjects': 'Proyectos',
      'projects.statsInvitations': 'Invitaciones',
      'projects.createHint': 'Nombra tu proyecto, añade contexto y elige su visibilidad.',
      'projects.nameLabel': 'Nombre del proyecto',
      'projects.descriptionLabel': 'Descripción',
      'projects.nameRequired': 'El nombre del proyecto es obligatorio.',
      'projects.createdSuccess': 'Tu proyecto está listo.',
      'projects.createdTitle': 'Proyecto creado',
      'projects.createErrorTitle': 'No se pudo crear el proyecto',
      'projects.invitationAccepted': 'Invitación aceptada.',
      'projects.invitationRejected': 'Invitación rechazada.',
      'projects.deletedSuccess': 'Proyecto eliminado.',
      'projects.loading': 'Cargando tus proyectos…',
      'projects.emptyTitle': 'Aún no tienes proyectos',
      'projects.viewDetails': 'Detalles',
      'projects.member': 'Miembro',
      'projects.unknownUser': 'Un colaborador',
      'projects.inviteSent': 'Invitación enviada.',
      'projects.roleUpdated': 'Rol del miembro actualizado.',
      'projects.memberRemoved': 'Miembro eliminado.',
      'projects.share': 'Compartir',
      'projects.shareTitle': 'Enlace del proyecto',
      'projects.shareCopied': 'Enlace del proyecto copiado al portapapeles.',
      'projects.shareError': 'No se pudo copiar el enlace del proyecto.',
      'projects.shareHint': 'Comparte este proyecto invitando miembros abajo, o copia el enlace para abrir esta página. El acceso depende de los permisos del proyecto.',
      'projects.backToProjects': 'Volver a proyectos',
      'projects.notFoundTitle': 'Proyecto no encontrado',
      'projects.notFoundText': 'Este proyecto pudo haberse eliminado o es posible que no tengas acceso.',
      'projects.search': 'Buscar proyectos',
      'projects.searchPlaceholder': 'Buscar por nombre o descripción…',
      'projects.filter': 'Filtrar',
      'projects.sort': 'Ordenar',
      'projects.filterAll': 'Todos los proyectos',
      'projects.filterOwned': 'De mi propiedad',
      'projects.filterShared': 'Compartidos conmigo',
      'projects.filterPublic': 'Públicos',
      'projects.filterPrivate': 'Privados',
      'projects.sortUpdated': 'Actualizados recientemente',
      'projects.sortCreated': 'Creados recientemente',
      'projects.sortName': 'Nombre (A–Z)',
      'projects.clearFilters': 'Limpiar',
      'projects.noResultsTitle': 'No hay proyectos coincidentes',
      'projects.noResultsText': 'Prueba ajustando la búsqueda o los filtros.',
      'projects.editProject': 'Editar proyecto',
      'projects.updatedSuccess': 'Proyecto actualizado.',
      'projects.updateError': 'No se pudo actualizar el proyecto.',
      'projects.youJoinedProject': 'Te uniste al proyecto {name}',
      'projects.editingObject': 'Editando objeto',
      'guide.title': 'Guía de inicio',
      'guide.subtitle': 'Tu primera creación 3D, paso a paso',
      'guide.startTutorial': 'Iniciar tutorial guiado',
      'guide.reset': 'Reiniciar progreso',
      'guide.completed': 'Completado',
      'guide.next': 'Siguiente',
      'guide.progress': '{done} de {total} pasos completados',
      'guide.estimated': 'Tiempo estimado: 10 minutos',
      'guide.allDone': '¡Guía completada!',
      'about.title': 'Sobre nosotros',
      'about.subtitle': 'Un estudio 3D para crear, compartir y remixear',
      'about.start': 'Empezar a crear',
      'about.guide': 'Ver la guía de inicio',
      'about.community': 'Explorar la comunidad',
      'about.create': 'Crear un modelo',
      'chat.title': 'Mensajes',
      'chat.subtitle': 'Conversaciones directas con otros creadores',
      'chat.newChat': 'Nuevo chat',
      'chat.creatorUid': 'UID del creador',
      'chat.openConversation': 'Abrir conversación',
      'chat.recent': 'Recientes',
      'chat.noRecent': 'Aún no tienes conversaciones. Abre un perfil para enviar un mensaje o inicia un chat por UID.',
      'chat.messagePlaceholder': 'Escribe un mensaje…',
      'chat.send': 'Enviar',
      'chat.directConversation': 'Conversación directa',
      'chat.empty': 'Aún no hay mensajes. Saluda para iniciar la conversación.',
      'chat.yourConversations': 'Tus conversaciones',
      'chat.emptyHint': 'Escribe el UID de otro creador para iniciar un chat privado.',
      'chat.localMode': 'Modo local: los mensajes solo se sincronizan en este navegador.',
      'auth.welcomeBack': 'Bienvenido de vuelta',
      'auth.createAccount': 'Crea tu cuenta',
      'auth.resetPassword': 'Restablece tu contraseña',
      'auth.loginSubtitle': 'Inicia sesión para conectar con otros creadores.',
      'auth.registerSubtitle': 'Comparte tus modelos y descubre nuevas ideas.',
      'auth.resetSubtitle': 'Te enviaremos un enlace seguro a tu correo para crear una nueva contraseña.',
      'auth.displayName': 'Nombre visible',
      'auth.email': 'Correo electrónico',
      'auth.password': 'Contraseña',
      'auth.showPassword': 'Mostrar contraseña',
      'auth.hidePassword': 'Ocultar contraseña',
      'auth.show': 'Ver',
      'auth.hide': 'Ocultar',
      'auth.login': 'Iniciar sesión',
      'auth.register': 'Crear cuenta',
      'auth.sendReset': 'Enviar enlace de recuperación',
      'auth.forgot': '¿Olvidaste tu contraseña?',
      'auth.orContinue': 'o continúa con',
      'auth.google': 'Continuar con Google',
      'auth.noAccount': '¿Aún no tienes cuenta?',
      'auth.hasAccount': '¿Ya tienes una cuenta?',
      'auth.signUp': 'Regístrate',
      'auth.backToLogin': 'Volver al inicio de sesión',
      'auth.backToEditor': 'Volver al editor',
      'auth.localMode': 'Modo local de demostración. Los datos quedan en este navegador; configura Firebase para cuentas reales y sincronización en la nube.',
      'chat.connecting': 'Conectando conversación…',
      'auth.activeSession': 'SESIÓN ACTIVA',
      'auth.hello': 'Hola, {name}',
      'auth.workspaceReady': 'Tu espacio de creación está listo.',
      'auth.verifyHint': 'Tu correo aún no está verificado. Ábrelo desde Ajustes → Seguridad para proteger la cuenta.',
      'auth.goCommunity': 'Ir a la comunidad',
      'auth.logout': 'Cerrar sesión',
      'auth.resetSent': 'Revisa tu correo para encontrar el enlace de recuperación.',
      'loading.community': 'Preparando la comunidad…',
      'loading.favorites': 'Cargando tus favoritos…',
      'loading.admin': 'Cargando panel de control…',
      'admin.title.dashboard': 'Panel de control',
      'admin.title.users': 'Usuarios',
      'admin.title.content': 'Contenido',
      'admin.title.feedback': 'Feedback',
      'admin.title.help': 'Preguntas',
      'admin.title.projects': 'Proyectos',
      'admin.title.reports': 'Reportes',
      'admin.title.helpArticles': 'Artículos de ayuda',
      'admin.subtitle.moderation': 'Moderación de contenido',
      'admin.subtitle.main': 'Gestiona acceso, roles y publicaciones de la comunidad.',
      'admin.shellTitle.admin': 'Panel de administración',
      'admin.shellTitle.moderation': 'Moderación de contenido',
      'admin.shellSubtitle': 'Gestiona acceso, roles y publicaciones de la comunidad.',
      'admin.panelTitle': 'Panel de administración',
      'admin.panelSubtitle': 'Control, supervisión y gestión de la plataforma',
      'admin.dashboard': 'Dashboard',
      'admin.users': 'Usuarios',
      'admin.content': 'Contenido',
      'admin.reports': 'Reportes',
      'admin.feedback': 'Feedback',
      'admin.questions': 'Preguntas',
      'admin.projects': 'Proyectos',
      'admin.help': 'Ayuda',
      'admin.closeMenu': 'Cerrar menú',
      'admin.logout': 'Cerrar sesión',
      'admin.openMenu': 'Abrir menú',
      'admin.moderationMode': 'Modo moderación',
      'admin.searchPlaceholder': 'Buscar en la sección…',
      'admin.refresh': 'Actualizar',
      'admin.currentUser': 'Usuario actual',
      'admin.stats.users': 'Usuarios',
      'admin.stats.active': 'activos',
      'admin.stats.suspended': 'Suspendidos',
      'admin.stats.moderators': 'mods',
      'admin.stats.admins': 'admins',
      'admin.stats.publications': 'Publicaciones',
      'admin.stats.public': 'públicas',
      'admin.stats.private': 'privadas',
      'admin.stats.openReports': 'Reportes abiertos',
      'admin.stats.resolved': 'resueltos',
      'admin.stats.new': 'nuevos',
      'admin.stats.open': 'abiertas',
      'admin.stats.views': 'vistas',
      'admin.stats.remixes': 'remixes',
      'admin.stats.engagement': 'Engagement',
      'admin.stats.collaboration': 'Colaboración',
      'admin.charts.usersByRole': 'Usuarios por rol',
      'admin.charts.contentVisibility': 'Visibilidad de contenido',
      'admin.charts.reportsStatus': 'Estado de reportes',
      'admin.charts.feedbackStatus': 'Estado de feedback',
      'admin.recentPosts': 'Publicaciones recientes',
      'admin.recentActivity': 'Actividad reciente',
      'admin.noPostsYet': 'Sin publicaciones aún.',
      'admin.noRecentActivity': 'Sin actividad reciente.',
      'admin.views': 'vistas',
      'admin.report': 'Reporte',
      'admin.loadingPanel': 'Cargando panel…',
      'admin.registeredUsers': 'Usuarios registrados',
      'admin.accounts': 'cuentas',
      'admin.user': 'Usuario',
      'admin.email': 'Email',
      'admin.uid': 'UID',
      'admin.role': 'Rol',
      'admin.status': 'Estado',
      'admin.created': 'Creado',
      'admin.actions': 'Acciones',
      'admin.active': 'Activa',
      'admin.suspended': 'Suspendida',
      'admin.restore': 'Restaurar',
      'admin.suspend': 'Suspender',
      'admin.noUsersToShow': 'No hay usuarios para mostrar.',
      'admin.contentModeration': 'Moderación de contenido',
      'admin.models': 'modelos',
      'admin.by': 'Por',
      'admin.noContentToShow': 'No hay contenido para mostrar.',
      'admin.makePublic': 'Hacer público',
      'admin.makePrivate': 'Hacer privado',
      'admin.author': 'Autor',
      'admin.delete': 'Eliminar',
      'admin.noDescription': 'Sin descripción',
      'admin.contentReports': 'Reportes de contenido',
      'admin.all': 'Todos',
      'admin.open': 'Abiertos',
      'admin.resolved': 'Resueltos',
      'admin.dismissed': 'Descartados',
      'admin.model': 'Modelo',
      'admin.reportedBy': 'Reportado por',
      'admin.reason': 'Motivo',
      'admin.details': 'Detalles',
      'admin.date': 'Fecha',
      'admin.noReportsToShow': 'No hay reportes para mostrar.',
      'admin.resolve': 'Resolver',
      'admin.dismiss': 'Descartar',
      'admin.closed': 'Cerrado',
      'admin.feedbackAndContact': 'Feedback y contacto',
      'admin.messages': 'mensajes',
      'admin.type': 'Tipo',
      'admin.contact': 'Contacto',
      'admin.subjectMessage': 'Asunto / Mensaje',
      'admin.noFeedbackToShow': 'No hay feedback para mostrar.',
      'admin.communityQuestions': 'Preguntas de la comunidad',
      'admin.question': 'Pregunta',
      'admin.metrics': 'Métricas',
      'admin.pinned': 'Fijada',
      'admin.locked': 'Bloqueada',
      'admin.reopen': 'Reabrir',
      'admin.unpin': 'Desfijar',
      'admin.unlock': 'Desbloquear',
      'admin.noQuestionsToShow': 'No hay preguntas para mostrar.',
      'admin.collaborativeProjects': 'Proyectos colaborativos',
      'admin.project': 'Proyecto',
      'admin.updated': 'Actualizado',
      'admin.projectMembers': 'Miembros del proyecto',
      'admin.member': 'Miembro',
      'admin.joined': 'Ingreso',
      'admin.remove': 'Quitar',
      'admin.noMembersOrData': 'Sin miembros o proyecto sin datos.',
      'admin.noProjectsToShow': 'No hay proyectos para mostrar.',
      'admin.helpCenterArticles': 'Artículos del centro de ayuda',
      'admin.articles': 'artículos',
      'admin.published': 'Publicado',
      'admin.draft': 'Borrador',
      'admin.allCategories': 'Todas las categorías',
      'admin.editArticle': 'Editar artículo',
      'admin.newArticle': 'Nuevo artículo',
      'admin.editing': 'Editando',
      'admin.category': 'Categoría',
      'admin.icon': 'Icono',
      'admin.order': 'Orden',
      'admin.title': 'Título',
      'admin.subtitle': 'Subtítulo',
      'admin.keywords': 'Palabras clave',
      'admin.writeEachParagraph': 'Escribe cada párrafo. Puedes separar por línea en blanco o por salto de línea.',
      'admin.stepsOptional': 'Pasos (opcional, uno por línea)',
      'admin.tipOptional': 'Consejo (opcional)',
      'admin.publishedVisible': 'Publicado (visible en el centro de ayuda)',
      'admin.saveChanges': 'Guardar cambios',
      'admin.createArticle': 'Crear artículo',
      'admin.cancelEdit': 'Cancelar edición',
      'admin.clear': 'Limpiar',
      'admin.articlesList': 'Lista de artículos',
      'admin.noSubtitle': 'Sin subtítulo',
      'admin.noArticlesToShow': 'No hay artículos para mostrar',
      'admin.createFirstArticle': 'Crea tu primer artículo con el formulario de la izquierda o ajusta los filtros de búsqueda/categoría/estado.',
      'admin.createNewArticle': 'Crear nuevo artículo',
      'admin.deletePublication': 'Eliminar publicación',
      'admin.deletePublicationConfirm': '¿Seguro que deseas eliminar',
      'admin.deletePublicationFiles': 'y sus archivos asociados? Esta acción no se puede deshacer.',
      'admin.cancel': 'Cancelar',
      'admin.deletePermanently': 'Eliminar definitivamente',
      'admin.editPost': 'Editar publicación',
      'admin.privacyPrivate': 'Privado (solo el autor puede verlo)',
      'admin.postUpdated': 'Publicación actualizada.',
      'admin.postDeleted': 'Publicación y archivos eliminados.',
      'admin.cannotDeleteOwn': 'No puedes eliminar tu propia cuenta desde aquí.',
      'admin.roleUpdated': 'Rol actualizado.',
      'admin.accountSuspended': 'Cuenta suspendida.',
      'admin.accountRestored': 'Cuenta restaurada.',
      'admin.usersEmpty': 'No se encontraron usuarios.',
      'admin.postsEmpty': 'No se encontraron publicaciones.',
      'admin.reportsEmpty': 'No se encontraron reportes.',
    };
    return spanish[key];
  }

  private initialLanguage(): AppLanguage {
    if (!isPlatformBrowser(this.platformId)) return DEFAULT_LANGUAGE;
    const saved = this.localState.loadPreferences().language;
    return isAppLanguage(saved) ? saved : DEFAULT_LANGUAGE;
  }

  private applyDocumentLanguage(language: AppLanguage): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const option = APP_LANGUAGES.find((item) => item.code === language);
    this.document.documentElement.lang = option?.htmlLang ?? language;
    this.document.documentElement.dir = option?.dir ?? 'ltr';
  }

  private interpolate(value: string, params?: TranslationParams): string {
    if (!params) return value;
    return value.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  }
}
