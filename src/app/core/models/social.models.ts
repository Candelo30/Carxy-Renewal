import type { AppLanguage } from '../i18n/languages';

export type UserRole = 'admin' | 'moderator' | 'user';
export type NotificationPosition = 'top-right' | 'top-center' | 'top-left' | 'bottom-right' | 'bottom-center' | 'bottom-left';

export interface User {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string | null;
  bio: string;
  role?: UserRole;
  isBanned?: boolean;
  createdAt?: number;
  emailVerified?: boolean;
  providers?: string[];
}

export interface UserProfile extends User {
  role: UserRole;
  isBanned?: boolean;
  createdAt: number;
}

export interface UserActivity {
  uid: string;
  /**
   * Correo del usuario. Ya no se escribe: la colección `userActivity` es
   * legible por cualquier usuario autenticado (el chat muestra "visto hace"),
   * así que no debe contener datos personales. El panel de administración
   * obtiene el correo de `userPrivate`, que es solo de administradores.
   */
  email?: string;
  displayName: string;
  lastSeenAt: number;
  lastSeenPath: string;
  updatedAt: number;
}

export interface AccountDeletionAudit {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  deletedAt: number;
  deletedBy: string;
  reason: string;
}

export type ReportReason = 'spam' | 'inappropriate' | 'copyright' | 'other';
export type ReportStatus = 'open' | 'resolved' | 'dismissed';

export type FeedbackType = 'bug' | 'idea' | 'account' | 'collaboration' | 'other';
export type FeedbackStatus = 'new' | 'reviewing' | 'resolved';

export interface FeedbackMessage {
  id: string;
  userId: string;
  name: string;
  email: string;
  type: FeedbackType;
  subject: string;
  message: string;
  status: FeedbackStatus;
  createdAt: number;
  updatedAt?: number;
}

export interface CommunityAnswer {
  id: string;
  questionId: string;
  authorId: string;
  authorName: string;
  authorPhotoURL: string | null;
  body: string;
  createdAt: number;
  votes: number;
  voterIds: string[];
  accepted: boolean;
}

export interface CommunityQuestion {
  id: string;
  authorId: string;
  authorName: string;
  authorPhotoURL: string | null;
  title: string;
  body: string;
  tags: string[];
  createdAt: number;
  updatedAt?: number;
  answersCount: number;
  votes: number;
  voterIds: string[];
  resolved: boolean;
  pinned: boolean;
  locked: boolean;
  acceptedAnswerId: string | null;
}

export interface ContentReport {
  id: string;
  postId: string;
  postTitle: string;
  reporterId: string;
  reporterName: string;
  reason: ReportReason;
  details: string;
  status: ReportStatus;
  createdAt: number;
  resolvedAt?: number;
}

export interface Post3D {
  id: string;
  title: string;
  description: string;
  modelUrl: string;
  thumbnailUrl: string;
  author: User;
  likes: number;
  createdAt: number;
  authorId?: string;
  authorName?: string;
  likesCount?: number;
  viewsCount?: number;
  remixCount?: number;
  isPrivate?: boolean;
  tags?: string[];
  modelPath?: string;
  thumbnailPath?: string;
}

export interface Comment {
  id: string;
  text: string;
  author: User;
  createdAt: number;
}

export type ChatMessageKind = 'text' | 'audio' | 'image';

export interface ChatMessage {
  id: string;
  /** Texto en claro (mensajes antiguos), 'Imagen'/'Nota de voz' como etiqueta, o cadena vacía cuando va cifrado (ver `encrypted`). */
  text: string;
  senderId: string;
  senderName: string;
  /** Avatar del remitente (opcional: sirve para la notificación de mensaje). */
  senderPhotoURL?: string | null;
  createdAt: number;
  /** 'audio' notas de voz, 'image' imágenes; ausente/'text' para texto normal. */
  kind?: ChatMessageKind;
  /** Referencia al mensaje citado (responder). Solo id + autor; el texto se resuelve en cliente desde los mensajes cargados. */
  replyTo?: { id: string; senderId: string; senderName: string };
  /** MIME original del binario cifrado (imágenes; en claro, no revela contenido). */
  mediaMime?: string;
  /** `true` cuando el cuerpo va cifrado de extremo a extremo (AES-GCM con clave por par derivada de ECDH). */
  encrypted?: boolean;
  /** Vector de inicialización AES-GCM en base64 (12 bytes). Presente si `encrypted`. */
  iv?: string;
  /** Ciphertext AES-GCM en base64 (incluye el tag). Presente si `encrypted`. */
  ciphertext?: string;
  /** Algoritmo del cifrado: actualmente solo 'AES-GCM'. */
  algorithm?: string;
  /** MIME original del audio **solo cuando va cifrado** (en claro, no revela contenido). */
  audioMime?: string;
  /** URL pública del audio (kind='audio'). El blob apuntado puede estar cifrado (ver `encrypted`). */
  audioUrl?: string;
  /** Duración en segundos (kind='audio'). */
  audioDuration?: number;
}

export interface ChatConversation {
  id: string;
  participantIds: string[];
  lastMessage?: ChatMessage;
  updatedAt: number;
}

export type ActivityNotificationKind = 'follow' | 'like' | 'comment' | 'message' | 'remix' | 'share' | 'invite';

export interface ActivityNotification {
  id: string;
  recipientId: string;
  actorId: string;
  actorName: string;
  actorPhotoURL: string | null;
  kind: ActivityNotificationKind;
  targetId?: string;
  createdAt: number;
  read: boolean;
}

export interface Follow {
  followerId: string;
  followingId: string;
  createdAt: number;
}

export interface EditorPreferences {
  theme: 'dark' | 'light' | 'system';
  accentColor: string;
  language: AppLanguage;
  backgroundColor: string;
  lightIntensity: number;
  gizmoMode: 'translate' | 'rotate' | 'scale';
  notificationPosition: NotificationPosition;
}

/* ============================================================================
   COLABORACIÓN — Proyectos, miembros e invitaciones
   ============================================================================ */

export type ProjectRole = 'owner' | 'editor' | 'viewer';

/** Rol que otorga un enlace compartido. No incluye owner para evitar escalado accidental. */
export type ProjectShareLinkRole = 'editor' | 'viewer';

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  sceneJson?: string;        // Serialización de la escena Three.js
  thumbnailUrl?: string;
  isPublic: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  userName: string;
  userPhotoURL: string | null;
  role: ProjectRole;
  joinedAt: number;
  /** ID del enlace compartido usado para unirse (si aplica). */
  joinedViaShareLink?: string | null;
}

export interface ProjectInvitation {
  id: string;
  projectId: string;
  projectName: string;
  invitedBy: string;
  invitedByName: string;
  invitedEmail: string;
  invitedUid?: string | null;   // null si el invitado aún no tiene cuenta en CARXY
  role: ProjectRole;
  status: 'pending' | 'accepted' | 'rejected' | 'revoked' | 'expired';
  createdAt: number;
  expiresAt: number;
  respondedAt?: number;
}

export interface ProjectShareLink {
  /** Token usado en la URL (?share=<id>). También es el ID del documento. */
  id: string;
  projectId: string;
  role: ProjectShareLinkRole;
  label?: string;
  createdBy: string;
  createdByName: string;
  createdAt: number;
  updatedAt: number;
  enabled: boolean;
}

export interface ProjectActivity {
  id: string;
  projectId: string;
  actorId: string;
  actorName: string;
  action: 'object_created' | 'object_updated' | 'object_deleted' | 'material_changed' | 'layer_changed';
  objectId: string;
  objectType: string;
  snapshot?: string;         // JSON del objeto afectado (para deshacer/rehacer compartido)
  createdAt: number;
}

export interface ProjectPresence {
  uid: string;
  projectId: string;
  displayName: string;
  photoURL: string | null;
  isOnline: boolean;
  currentObjectId: string | null;
  cursorX: number;
  cursorY: number;
  /** Transformación del objeto que está moviendo este colaborador (tiempo real). */
  transform?: PresenceTransform | null;
  lastSeen: number;
}

export interface PresenceTransform {
  objectId: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  updatedAt: number;
}

export type HelpArticleCategory = 'primeros-pasos' | 'editor' | 'publicacion' | 'comunidad' | 'colaboracion' | 'cuenta';

export interface HelpArticle {
  id: string;
  category: HelpArticleCategory;
  title: string;
  subtitle: string;
  icon: string;
  keywords: string;
  body: string[];
  steps?: string[];
  tip?: string;
  order: number;
  isPublished: boolean;
  createdAt: number;
  updatedAt: number;
}

export type AdminActionKind =
  | 'role_changed'
  | 'user_banned'
  | 'user_restored'
  | 'post_deleted'
  | 'post_visibility_changed'
  | 'report_resolved'
  | 'report_dismissed'
  | 'feedback_deleted'
  | 'feedback_status_changed'
  | 'question_deleted'
  | 'question_pinned'
  | 'question_locked'
  | 'question_resolved'
  | 'project_deleted'
  | 'project_member_role_changed'
  | 'project_member_removed'
  | 'help_article_created'
  | 'help_article_updated'
  | 'help_article_deleted'
  | 'help_article_published_toggled'
  | 'inactive_users_purged';

export interface AdminAction {
  id: string;
  adminId: string;
  adminName: string;
  action: AdminActionKind;
  targetType: 'user' | 'post' | 'report' | 'feedback' | 'question' | 'project' | 'help-article' | 'bulk' | 'system';
  targetId: string;
  targetLabel: string;
  detail: string;
  createdAt: number;
}

export type AdminActionTargetType = AdminAction['targetType'];

// Re-exported for convenience
