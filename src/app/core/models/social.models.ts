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
}

export interface UserProfile extends User {
  role: UserRole;
  isBanned?: boolean;
  createdAt: number;
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
  language: 'es' | 'en';
  backgroundColor: string;
  lightIntensity: number;
  gizmoMode: 'translate' | 'rotate' | 'scale';
  notificationPosition: NotificationPosition;
}
