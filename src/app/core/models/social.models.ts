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

export interface ChatMessage {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  createdAt: number;
}

export interface ChatConversation {
  id: string;
  participantIds: string[];
  lastMessage?: ChatMessage;
  updatedAt: number;
}

export type ActivityNotificationKind = 'follow' | 'like' | 'comment';

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
  theme: 'dark' | 'light';
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
}

export interface ProjectInvitation {
  id: string;
  projectId: string;
  projectName: string;
  invitedBy: string;
  invitedByName: string;
  invitedEmail: string;
  invitedUid?: string;       // undefined si el invitado aún no tiene cuenta en CARXY
  role: ProjectRole;
  status: 'pending' | 'accepted' | 'rejected' | 'revoked' | 'expired';
  createdAt: number;
  expiresAt: number;
  respondedAt?: number;
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
  lastSeen: number;
}
