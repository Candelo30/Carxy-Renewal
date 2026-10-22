export const APP_ROUTES = {
  editor: '/editor',
  feed: '/feed',
  login: '/login',
  register: '/register',
  profile: (uid: string) => `/profile/${encodeURIComponent(uid)}`,
  chat: '/chat',
  admin: '/admin',
  myModels: '/my-models',
} as const;

export const SOCIAL_COLLECTIONS = {
  users: 'users',
  privateUsers: 'userPrivate',
  posts: 'posts',
  chats: 'chats',
  reports: 'reports',
  follows: 'follows',
} as const;

export const SOCIAL_STORAGE_PATHS = {
  model: (uid: string, postId: string) => `models/${uid}/${postId}.glb`,
  thumbnail: (uid: string, postId: string) => `thumbnails/${uid}/${postId}.png`,
} as const;

export const LOCAL_KEYS = {
  user: 'forma-local-user',
  accounts: 'forma-local-accounts',
  posts: 'forma-social-posts',
  comments: 'forma-social-comments',
  chats: 'forma-social-chat',
  follows: 'forma-social-follows',
  activityNotifications: 'forma-social-activity-notifications',
  modelDatabase: 'forma-social-models',
  preferences: 'forma-3d-preferences',
  draft: 'forma-3d-draft',
} as const;
