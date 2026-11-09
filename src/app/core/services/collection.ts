import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { LOCAL_KEYS } from '../config/app.constants';
import { Post3D } from '../models/social.models';

export interface Collection {
  id: string;
  name: string;
  description: string;
  isPublic: boolean;
  postIds: string[];
  createdAt: number;
  updatedAt: number;
  ownerId: string;
}

const DEFAULT_COLLECTIONS: Collection[] = [];

@Injectable({ providedIn: 'root' })
export class CollectionService {
  private readonly collections = new BehaviorSubject<Collection[]>(this.readLocal());
  readonly collections$ = this.collections.asObservable();

  readonly localCollections = this.collections;

  private readLocal(): Collection[] {
    if (typeof localStorage === 'undefined') return DEFAULT_COLLECTIONS;
    try {
      const raw = localStorage.getItem(LOCAL_KEYS.posts); // reusamos clave de posts para simplicidad
      if (!raw) return DEFAULT_COLLECTIONS;
      const data = JSON.parse(raw) as { collections?: Collection[] };
      return data.collections ?? DEFAULT_COLLECTIONS;
    } catch {
      return DEFAULT_COLLECTIONS;
    }
  }

  private writeLocal(next: Collection[]): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(LOCAL_KEYS.posts);
      const data = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      localStorage.setItem(LOCAL_KEYS.posts, JSON.stringify({ ...data, collections: next }));
    } catch (error) {
      console.warn('No se pudieron guardar las colecciones.', error);
    }
  }

  getCollections(ownerId?: string): Collection[] {
    const all = this.collections.value;
    return ownerId ? all.filter((c) => c.ownerId === ownerId) : all;
  }

  getCollection(id: string): Collection | undefined {
    return this.collections.value.find((c) => c.id === id);
  }

  createCollection(name: string, description: string, isPublic: boolean, ownerId: string): Collection {
    const collection: Collection = {
      id: `col-${crypto.randomUUID()}`,
      name: name.trim(),
      description: description.trim(),
      isPublic,
      postIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ownerId,
    };
    const next = [...this.collections.value, collection];
    this.collections.next(next);
    this.writeLocal(next);
    return collection;
  }

  addToCollection(collectionId: string, postId: string): boolean {
    const collection = this.getCollection(collectionId);
    if (!collection) return false;
    if (collection.postIds.includes(postId)) return false;

    const next = this.collections.value.map((c) =>
      c.id === collectionId
        ? { ...c, postIds: [...c.postIds, postId], updatedAt: Date.now() }
        : c,
    );
    this.collections.next(next);
    this.writeLocal(next);
    return true;
  }

  removeFromCollection(collectionId: string, postId: string): boolean {
    const collection = this.getCollection(collectionId);
    if (!collection) return false;

    const next = this.collections.value.map((c) =>
      c.id === collectionId
        ? { ...c, postIds: c.postIds.filter((id) => id !== postId), updatedAt: Date.now() }
        : c,
    );
    this.collections.next(next);
    this.writeLocal(next);
    return true;
  }

  deleteCollection(id: string): void {
    const next = this.collections.value.filter((c) => c.id !== id);
    this.collections.next(next);
    this.writeLocal(next);
  }

  isInCollection(collectionId: string, postId: string): boolean {
    const collection = this.getCollection(collectionId);
    return collection?.postIds.includes(postId) ?? false;
  }

  getCollectionsForPost(postId: string): Collection[] {
    return this.collections.value.filter((c) => c.postIds.includes(postId));
  }

  updateCollection(id: string, patch: Partial<Pick<Collection, 'name' | 'description' | 'isPublic'>>): void {
    const next = this.collections.value.map((c) =>
      c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c,
    );
    this.collections.next(next);
    this.writeLocal(next);
  }
}
