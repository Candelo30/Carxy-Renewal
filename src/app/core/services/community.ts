import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { BehaviorSubject, Observable, catchError, map, of } from 'rxjs';
import { LOCAL_KEYS, SOCIAL_COLLECTIONS } from '../config/app.constants';
import {
  CommunityAnswer,
  CommunityQuestion,
  FeedbackMessage,
  FeedbackStatus,
  FeedbackType,
  HelpArticle,
  HelpArticleCategory,
  User,
} from '../models/social.models';

export interface FeedbackInput {
  name: string;
  email: string;
  type: FeedbackType;
  subject: string;
  message: string;
}

export interface QuestionInput {
  title: string;
  body: string;
  tags: string[];
}

@Injectable({ providedIn: 'root' })
export class CommunityService {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly localFeedback = new BehaviorSubject<FeedbackMessage[]>(
    this.readLocal(LOCAL_KEYS.feedback, []),
  );
  private readonly localQuestions = new BehaviorSubject<CommunityQuestion[]>(
    this.readLocal(LOCAL_KEYS.communityQuestions, []),
  );
  private readonly localAnswers = new BehaviorSubject<Record<string, CommunityAnswer[]>>(
    this.readLocal(LOCAL_KEYS.communityAnswers, {}),
  );
  private readonly answerObservables = new Map<string, Observable<CommunityAnswer[]>>();

  readonly feedback$: Observable<FeedbackMessage[]> = this.firestore
    ? collectionData(
        query(
          collection(this.firestore, SOCIAL_COLLECTIONS.feedback),
          orderBy('createdAt', 'desc'),
          limit(200),
        ),
        { idField: 'id' },
      ).pipe(map((items) => items.map((item) => this.normalizeFeedback(item as Record<string, unknown>))))
    : this.demoFeedback();

  readonly questions$: Observable<CommunityQuestion[]> = this.firestore
    ? collectionData(
        query(
          collection(this.firestore, SOCIAL_COLLECTIONS.communityQuestions),
          orderBy('createdAt', 'desc'),
          limit(200),
        ),
        { idField: 'id' },
      ).pipe(
        map((items) =>
          items
            .map((item) => this.normalizeQuestion(item as Record<string, unknown>))
            .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt),
        ),
      )
    : this.demoQuestions();

  private demoFeedback(): Observable<FeedbackMessage[]> {
    const stored = this.localFeedback.value;
    if (stored.length > 0) return this.localFeedback.asObservable();
    const items: FeedbackMessage[] = [
      {
        id: 'demo-feedback-1',
        userId: 'demo-user-1',
        name: 'Creador Demo',
        email: 'creator@carxy.demo',
        type: 'bug',
        subject: 'El gizmo de rotación no funciona en Safari',
        message: 'Al intentar rotar un objeto en Safari, el gizmo no responde correctamente.',
        status: 'new',
        createdAt: Date.now() - 86400000 * 3,
      },
      {
        id: 'demo-feedback-2',
        userId: 'demo-user-1',
        name: 'Creador Demo',
        email: 'creator@carxy.demo',
        type: 'idea',
        subject: 'Añadir soporte para modelos OBJ',
        message: 'Sería útil poder importar archivos .OBJ además de .glb y .gltf.',
        status: 'reviewing',
        createdAt: Date.now() - 86400000 * 7,
      },
      {
        id: 'demo-feedback-3',
        userId: 'demo-user-1',
        name: 'Creador Demo',
        email: 'creator@carxy.demo',
        type: 'account',
        subject: 'No puedo verificar mi correo',
        message: 'El enlace de verificación nunca llega a mi bandeja de entrada.',
        status: 'resolved',
        createdAt: Date.now() - 86400000 * 10,
        updatedAt: Date.now() - 86400000 * 9,
      },
    ];
    return of(items);
  }

  private demoQuestions(): Observable<CommunityQuestion[]> {
    const stored = this.localQuestions.value;
    if (stored.length > 0) return this.localQuestions.asObservable();
    const items: CommunityQuestion[] = [
      {
        id: 'demo-question-1',
        authorId: 'demo-user-1',
        authorName: 'Creador Demo',
        authorPhotoURL: null,
        title: 'Cómo exportar escena con texturas',
        body: '¿Alguien sabe cómo exportar una escena que incluya texturas personalizadas?',
        tags: ['exportar', 'texturas'],
        createdAt: Date.now() - 86400000 * 2,
        answersCount: 2,
        votes: 5,
        voterIds: ['demo-mod-1'],
        resolved: false,
        pinned: true,
        locked: false,
        acceptedAnswerId: null,
      },
      {
        id: 'demo-question-2',
        authorId: 'demo-user-2',
        authorName: 'Usuario Suspendido',
        authorPhotoURL: null,
        title: 'Problema con el chat',
        body: 'No puedo enviar mensajes en el chat directo.',
        tags: ['chat', 'bug'],
        createdAt: Date.now() - 86400000 * 5,
        answersCount: 0,
        votes: 0,
        voterIds: [],
        resolved: false,
        pinned: false,
        locked: false,
        acceptedAnswerId: null,
      },
    ];
    return of(items);
  }

  answers$(questionId: string): Observable<CommunityAnswer[]> {
    const cached = this.answerObservables.get(questionId);
    if (cached) return cached;
    const stream = this.firestore
      ? collectionData(
          query(
            collection(this.firestore, SOCIAL_COLLECTIONS.communityQuestions, questionId, 'answers'),
            orderBy('createdAt', 'asc'),
          ),
          { idField: 'id' },
        ).pipe(map((items) => items.map((item) => this.normalizeAnswer(item as Record<string, unknown>))))
      : this.localAnswers.asObservable().pipe(map((all) => all[questionId] ?? []));
    this.answerObservables.set(questionId, stream);
    return stream;
  }

  async createFeedback(input: FeedbackInput, user: User | null): Promise<void> {
    const feedback: FeedbackMessage = {
      id: crypto.randomUUID(),
      userId: user?.uid ?? '',
      name: input.name.trim().slice(0, 80),
      email: input.email.trim().slice(0, 120),
      type: input.type,
      subject: input.subject.trim().slice(0, 120),
      message: input.message.trim().slice(0, 4000),
      status: 'new',
      createdAt: Date.now(),
    };
    if (this.firestore) {
      await setDoc(doc(this.firestore, SOCIAL_COLLECTIONS.feedback, feedback.id), {
        userId: feedback.userId,
        name: feedback.name,
        email: feedback.email,
        type: feedback.type,
        subject: feedback.subject,
        message: feedback.message,
        status: feedback.status,
        createdAt: feedback.createdAt,
      });
      return;
    }
    const next = [feedback, ...this.localFeedback.value];
    this.localFeedback.next(next);
    this.writeLocal(LOCAL_KEYS.feedback, next);
  }

  async updateFeedbackStatus(id: string, status: FeedbackStatus): Promise<void> {
    if (this.firestore) {
      await updateDoc(doc(this.firestore, SOCIAL_COLLECTIONS.feedback, id), {
        status,
        updatedAt: Date.now(),
      });
      return;
    }
    const next = this.localFeedback.value.map((item) =>
      item.id === id ? { ...item, status, updatedAt: Date.now() } : item,
    );
    this.localFeedback.next(next);
    this.writeLocal(LOCAL_KEYS.feedback, next);
  }

  async deleteFeedback(id: string): Promise<void> {
    if (this.firestore) {
      await deleteDoc(doc(this.firestore, SOCIAL_COLLECTIONS.feedback, id));
      return;
    }
    const next = this.localFeedback.value.filter((item) => item.id !== id);
    this.localFeedback.next(next);
    this.writeLocal(LOCAL_KEYS.feedback, next);
  }

  async askQuestion(input: QuestionInput, author: User): Promise<CommunityQuestion> {
    const question: CommunityQuestion = {
      id: crypto.randomUUID(),
      authorId: author.uid,
      authorName: author.displayName,
      authorPhotoURL: author.photoURL ?? null,
      title: input.title.trim().slice(0, 140),
      body: input.body.trim().slice(0, 4000),
      tags: [...new Set(input.tags.map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean))].slice(0, 5),
      createdAt: Date.now(),
      answersCount: 0,
      votes: 0,
      voterIds: [],
      resolved: false,
      pinned: false,
      locked: false,
      acceptedAnswerId: null,
    };
    if (this.firestore) {
      await setDoc(doc(this.firestore, SOCIAL_COLLECTIONS.communityQuestions, question.id), {
        authorId: question.authorId,
        authorName: question.authorName,
        authorPhotoURL: question.authorPhotoURL,
        title: question.title,
        body: question.body,
        tags: question.tags,
        createdAt: question.createdAt,
        answersCount: 0,
        votes: 0,
        voterIds: [],
        resolved: false,
        pinned: false,
        locked: false,
        acceptedAnswerId: null,
      });
      return question;
    }
    const next = [question, ...this.localQuestions.value];
    this.localQuestions.next(next);
    this.writeLocal(LOCAL_KEYS.communityQuestions, next);
    return question;
  }

  async answerQuestion(question: CommunityQuestion, body: string, author: User): Promise<void> {
    if (question.locked) throw new Error('La pregunta está bloqueada.');
    const answer: CommunityAnswer = {
      id: crypto.randomUUID(),
      questionId: question.id,
      authorId: author.uid,
      authorName: author.displayName,
      authorPhotoURL: author.photoURL ?? null,
      body: body.trim().slice(0, 4000),
      createdAt: Date.now(),
      votes: 0,
      voterIds: [],
      accepted: false,
    };
    if (this.firestore) {
      const batch = writeBatch(this.firestore);
      batch.set(
        doc(this.firestore, SOCIAL_COLLECTIONS.communityQuestions, question.id, 'answers', answer.id),
        {
          authorId: answer.authorId,
          authorName: answer.authorName,
          authorPhotoURL: answer.authorPhotoURL,
          body: answer.body,
          createdAt: answer.createdAt,
          votes: 0,
          voterIds: [],
          accepted: false,
        },
      );
      batch.update(doc(this.firestore, SOCIAL_COLLECTIONS.communityQuestions, question.id), {
        answersCount: increment(1),
      });
      await batch.commit();
      return;
    }
    const answers = { ...this.localAnswers.value };
    answers[question.id] = [...(answers[question.id] ?? []), answer];
    this.localAnswers.next(answers);
    this.writeLocal(LOCAL_KEYS.communityAnswers, answers);
    this.updateLocalQuestion(question.id, (item) => ({ ...item, answersCount: item.answersCount + 1 }));
  }

  async voteQuestion(questionId: string, uid: string): Promise<boolean> {
    if (this.firestore) {
      return runTransaction(this.firestore, async (transaction) => {
        const reference = doc(this.firestore!, SOCIAL_COLLECTIONS.communityQuestions, questionId);
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists()) throw new Error('La pregunta ya no existe.');
        const voterIds = Array.isArray(snapshot.data()['voterIds'])
          ? (snapshot.data()['voterIds'] as string[])
          : [];
        const hasVoted = voterIds.includes(uid);
        const nextVoters = hasVoted ? voterIds.filter((id) => id !== uid) : [...voterIds, uid];
        transaction.update(reference, {
          votes: hasVoted ? Math.max(0, Number(snapshot.data()['votes'] ?? 0) - 1) : Number(snapshot.data()['votes'] ?? 0) + 1,
          voterIds: nextVoters,
        });
        return !hasVoted;
      });
    }
    let voted = false;
    this.updateLocalQuestion(questionId, (item) => {
      const hasVoted = item.voterIds.includes(uid);
      voted = !hasVoted;
      return {
        ...item,
        votes: hasVoted ? Math.max(0, item.votes - 1) : item.votes + 1,
        voterIds: hasVoted ? item.voterIds.filter((id) => id !== uid) : [...item.voterIds, uid],
      };
    });
    return voted;
  }

  async acceptAnswer(question: CommunityQuestion, answer: CommunityAnswer): Promise<void> {
    if (this.firestore) {
      const answersRef = collection(
        this.firestore,
        SOCIAL_COLLECTIONS.communityQuestions,
        question.id,
        'answers',
      );
      const snapshot = await getDocs(answersRef);
      const batch = writeBatch(this.firestore);
      snapshot.forEach((document) => {
        const data = document.data() as Record<string, unknown>;
        if (data['accepted'] === true && document.id !== answer.id) {
          batch.update(document.ref, { accepted: false });
        }
      });
      batch.update(doc(this.firestore, SOCIAL_COLLECTIONS.communityQuestions, question.id), {
        acceptedAnswerId: answer.id,
        resolved: true,
        updatedAt: Date.now(),
      });
      batch.update(
        doc(this.firestore, SOCIAL_COLLECTIONS.communityQuestions, question.id, 'answers', answer.id),
        { accepted: true },
      );
      await batch.commit();
      return;
    }
    const answers = { ...this.localAnswers.value };
    answers[question.id] = (answers[question.id] ?? []).map((item) => ({
      ...item,
      accepted: item.id === answer.id,
    }));
    this.localAnswers.next(answers);
    this.writeLocal(LOCAL_KEYS.communityAnswers, answers);
    this.updateLocalQuestion(question.id, (item) => ({
      ...item,
      acceptedAnswerId: answer.id,
      resolved: true,
      updatedAt: Date.now(),
    }));
  }

  async setQuestionResolved(questionId: string, resolved: boolean): Promise<void> {
    if (this.firestore) {
      await updateDoc(doc(this.firestore, SOCIAL_COLLECTIONS.communityQuestions, questionId), {
        resolved,
        updatedAt: Date.now(),
      });
      return;
    }
    this.updateLocalQuestion(questionId, (item) => ({ ...item, resolved, updatedAt: Date.now() }));
  }

  async setQuestionPinned(questionId: string, pinned: boolean): Promise<void> {
    if (this.firestore) {
      await updateDoc(doc(this.firestore, SOCIAL_COLLECTIONS.communityQuestions, questionId), {
        pinned,
        updatedAt: Date.now(),
      });
      return;
    }
    this.updateLocalQuestion(questionId, (item) => ({ ...item, pinned, updatedAt: Date.now() }));
  }

  async setQuestionLocked(questionId: string, locked: boolean): Promise<void> {
    if (this.firestore) {
      await updateDoc(doc(this.firestore, SOCIAL_COLLECTIONS.communityQuestions, questionId), {
        locked,
        updatedAt: Date.now(),
      });
      return;
    }
    this.updateLocalQuestion(questionId, (item) => ({ ...item, locked, updatedAt: Date.now() }));
  }

  async deleteQuestion(question: CommunityQuestion): Promise<void> {
    if (this.firestore) {
      const answersRef = collection(
        this.firestore,
        SOCIAL_COLLECTIONS.communityQuestions,
        question.id,
        'answers',
      );
      const snapshot = await getDocs(answersRef);
      const references = snapshot.docs.map((document) => document.ref);
      references.push(doc(this.firestore, SOCIAL_COLLECTIONS.communityQuestions, question.id));
      for (let offset = 0; offset < references.length; offset += 450) {
        const batch = writeBatch(this.firestore);
        references.slice(offset, offset + 450).forEach((reference) => batch.delete(reference));
        await batch.commit();
      }
      return;
    }
    const questions = this.localQuestions.value.filter((item) => item.id !== question.id);
    this.localQuestions.next(questions);
    this.writeLocal(LOCAL_KEYS.communityQuestions, questions);
    const answers = { ...this.localAnswers.value };
    delete answers[question.id];
    this.localAnswers.next(answers);
    this.writeLocal(LOCAL_KEYS.communityAnswers, answers);
  }

  hasVoted(question: CommunityQuestion, uid: string | null | undefined): boolean {
    return !!uid && question.voterIds.includes(uid);
  }

  private updateLocalQuestion(
    questionId: string,
    updater: (question: CommunityQuestion) => CommunityQuestion,
  ): void {
    const next = this.localQuestions.value.map((item) =>
      item.id === questionId ? updater(item) : item,
    );
    this.localQuestions.next(next);
    this.writeLocal(LOCAL_KEYS.communityQuestions, next);
  }

  private normalizeFeedback(data: Record<string, unknown>): FeedbackMessage {
    const type = data['type'];
    const status = data['status'];
    return {
      id: String(data['id'] ?? ''),
      userId: String(data['userId'] ?? ''),
      name: String(data['name'] ?? ''),
      email: String(data['email'] ?? ''),
      type:
        type === 'bug' || type === 'idea' || type === 'account' || type === 'collaboration'
          ? type
          : 'other',
      subject: String(data['subject'] ?? ''),
      message: String(data['message'] ?? ''),
      status: status === 'reviewing' || status === 'resolved' ? status : 'new',
      createdAt: this.normalizeTimestamp(data['createdAt']),
      updatedAt: data['updatedAt'] == null ? undefined : this.normalizeTimestamp(data['updatedAt']),
    };
  }

  private normalizeQuestion(data: Record<string, unknown>): CommunityQuestion {
    return {
      id: String(data['id'] ?? ''),
      authorId: String(data['authorId'] ?? ''),
      authorName: String(data['authorName'] ?? ''),
      authorPhotoURL: typeof data['authorPhotoURL'] === 'string' ? data['authorPhotoURL'] : null,
      title: String(data['title'] ?? ''),
      body: String(data['body'] ?? ''),
      tags: Array.isArray(data['tags'])
        ? data['tags'].filter((tag): tag is string => typeof tag === 'string')
        : [],
      createdAt: this.normalizeTimestamp(data['createdAt']),
      updatedAt: data['updatedAt'] == null ? undefined : this.normalizeTimestamp(data['updatedAt']),
      answersCount: Number(data['answersCount'] ?? 0),
      votes: Number(data['votes'] ?? 0),
      voterIds: Array.isArray(data['voterIds'])
        ? data['voterIds'].filter((id): id is string => typeof id === 'string')
        : [],
      resolved: data['resolved'] === true,
      pinned: data['pinned'] === true,
      locked: data['locked'] === true,
      acceptedAnswerId:
        typeof data['acceptedAnswerId'] === 'string' ? data['acceptedAnswerId'] : null,
    };
  }

  private normalizeAnswer(data: Record<string, unknown>): CommunityAnswer {
    return {
      id: String(data['id'] ?? ''),
      questionId: String(data['questionId'] ?? ''),
      authorId: String(data['authorId'] ?? ''),
      authorName: String(data['authorName'] ?? ''),
      authorPhotoURL: typeof data['authorPhotoURL'] === 'string' ? data['authorPhotoURL'] : null,
      body: String(data['body'] ?? ''),
      createdAt: this.normalizeTimestamp(data['createdAt']),
      votes: Number(data['votes'] ?? 0),
      voterIds: Array.isArray(data['voterIds'])
        ? data['voterIds'].filter((id): id is string => typeof id === 'string')
        : [],
      accepted: data['accepted'] === true,
    };
  }

  private normalizeTimestamp(value: unknown): number {
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value.getTime();
    if (
      value &&
      typeof value === 'object' &&
      'toMillis' in value &&
      typeof value.toMillis === 'function'
    ) {
      return value.toMillis();
    }
    return Date.now();
  }

  private readLocal<T>(key: string, fallback: T): T {
    if (typeof localStorage === 'undefined') return fallback;
    try {
      const value = localStorage.getItem(key);
      return value ? (JSON.parse(value) as T) : fallback;
    } catch (error) {
      console.warn(`No se pudo recuperar el almacenamiento local: ${key}`, error);
      localStorage.removeItem(key);
      return fallback;
    }
  }

  private writeLocal(key: string, value: unknown): void {
    localStorage.setItem(key, JSON.stringify(value));
  }

  /* ------------------------------------------------------------------ */
  /*  Help Articles (Centro de Ayuda)                                   */
  /* ------------------------------------------------------------------ */

  getHelpArticles(): Observable<HelpArticle[]> {
    if (this.firestore) {
      try {
        const q = query(
          collection(this.firestore, SOCIAL_COLLECTIONS.helpArticles),
          orderBy('order', 'asc'),
          orderBy('createdAt', 'desc'),
        );
        return (collectionData(q, { idField: 'id' }) as Observable<Record<string, unknown>[]>).pipe(
          map((items) => items.map((item) => this.normalizeHelpArticle(item))),
          catchError((err) => {
            console.warn('Fallback al obtener artículos de ayuda sin doble orderBy:', err);
            return (collectionData(collection(this.firestore!, SOCIAL_COLLECTIONS.helpArticles), { idField: 'id' }) as Observable<Record<string, unknown>[]>).pipe(
              map((items) =>
                items
                  .map((item) => this.normalizeHelpArticle(item))
                  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0))
              ),
              catchError(() => of([] as HelpArticle[]))
            );
          })
        );
      } catch {
        return of([] as HelpArticle[]);
      }
    }
    return of([] as HelpArticle[]);
  }

  async createHelpArticle(article: Omit<HelpArticle, 'id'>): Promise<string> {
    if (this.firestore) {
      const ref = doc(collection(this.firestore, SOCIAL_COLLECTIONS.helpArticles));
      const now = Date.now();
      const full: HelpArticle = {
        id: ref.id,
        ...article,
        order: article.order ?? 0,
        isPublished: article.isPublished ?? true,
        createdAt: now,
        updatedAt: now,
      };
      await setDoc(ref, full);
      return ref.id;
    }
    return '';
  }

  async updateHelpArticle(article: HelpArticle): Promise<void> {
    if (this.firestore) {
      await updateDoc(doc(this.firestore, SOCIAL_COLLECTIONS.helpArticles, article.id), {
        ...article,
        updatedAt: Date.now(),
      });
      return;
    }
  }

  async deleteHelpArticle(id: string): Promise<void> {
    if (this.firestore) {
      await deleteDoc(doc(this.firestore, SOCIAL_COLLECTIONS.helpArticles, id));
      return;
    }
  }

  private normalizeHelpArticle(data: Record<string, unknown>): HelpArticle {
    const rawBody = data['body'];
    const body = Array.isArray(rawBody)
      ? rawBody.map((p) => String(p)).filter((p) => p.trim().length > 0)
      : String(rawBody ?? '').split('\n').map((p) => p.trim()).filter((p) => p.length > 0);
    const rawSteps = data['steps'];
    const steps = Array.isArray(rawSteps)
      ? rawSteps.map((s) => String(s)).filter((s) => s.trim().length > 0)
      : undefined;
    return {
      id: String(data['id'] ?? ''),
      category:
        data['category'] === 'primeros-pasos' ||
        data['category'] === 'editor' ||
        data['category'] === 'publicacion' ||
        data['category'] === 'comunidad' ||
        data['category'] === 'colaboracion' ||
        data['category'] === 'cuenta'
          ? (data['category'] as HelpArticleCategory)
          : 'primeros-pasos',
      title: String(data['title'] ?? ''),
      subtitle: String(data['subtitle'] ?? ''),
      icon: String(data['icon'] ?? '📄'),
      keywords: String(data['keywords'] ?? ''),
      body: body.length ? body : [],
      steps: steps && steps.length ? steps : undefined,
      tip: typeof data['tip'] === 'string' && data['tip'].trim() ? data['tip'] : undefined,
      order: Number(data['order'] ?? 0),
      isPublished: data['isPublished'] !== false,
      createdAt: this.normalizeTimestamp(data['createdAt']),
      updatedAt: this.normalizeTimestamp(data['updatedAt']),
    };
  }
}
