import type { FirebaseOptions } from 'firebase/app';

declare global {
  interface Window {
    __FORMA_FIREBASE_CONFIG__?: FirebaseOptions;
  }
}

export function getFirebaseRuntimeConfig(): FirebaseOptions | null {
  if (typeof window === 'undefined') return null;
  const config = window.__FORMA_FIREBASE_CONFIG__;
  if (!config) return null;
  const requiredFields: (keyof FirebaseOptions)[] = [
    'apiKey',
    'authDomain',
    'projectId',
    'storageBucket',
    'appId',
  ];
  if (requiredFields.some((field) => typeof config[field] !== 'string' || !config[field]?.trim())) {
    return null;
  }
  return config;
}
