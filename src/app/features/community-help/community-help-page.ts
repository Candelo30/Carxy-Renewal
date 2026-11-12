import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, startWith } from 'rxjs';
import {
  CommunityAnswer,
  CommunityQuestion,
  UserProfile,
} from '../../core/models/social.models';
import { AuthService } from '../../core/services/auth';
import { CommunityService } from '../../core/services/community';
import { I18nService } from '../../core/services/i18n';
import { NotificationService } from '../../core/services/notifications';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

type QuestionFilter = 'all' | 'open' | 'resolved' | 'mine';
type QuestionSort = 'newest' | 'answers' | 'votes';

@Component({
  selector: 'app-community-help-page',
  standalone: true,
  imports: [
    TranslatePipe,
    AsyncPipe,
    DatePipe,
    FormsModule,
    RouterLink,
    LoadingSpinner,
    ShellHeaderComponent,
    SiteFooterComponent,
  ],
  templateUrl: './community-help-page.html',
  styleUrl: './community-help-page.css',
})
export class CommunityHelpPage {
  readonly auth = inject(AuthService);
  readonly community = inject(CommunityService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);

  readonly user$ = this.auth.user$;
  readonly questions$: Observable<CommunityQuestion[] | null> = this.community.questions$.pipe(
    startWith(null),
  );
  readonly filters: QuestionFilter[] = ['all', 'open', 'resolved', 'mine'];
  readonly sorts: QuestionSort[] = ['newest', 'answers', 'votes'];

  currentUser: UserProfile | null = null;
  query = '';
  filter: QuestionFilter = 'all';
  sort: QuestionSort = 'newest';
  expandedId: string | null = null;
  showAskForm = false;
  askBusy = false;
  readonly answerBusy: Record<string, boolean> = {};
  readonly voteBusy: Record<string, boolean> = {};
  error = '';
  draft = { title: '', body: '', tags: '' };
  readonly answerDrafts: Record<string, string> = {};

  constructor() {
    this.auth.user$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => {
        this.currentUser = user;
      });
    const questionId = this.route.snapshot.queryParamMap.get('q');
    if (questionId) this.expandedId = questionId;
  }

  filteredQuestions(questions: CommunityQuestion[]): CommunityQuestion[] {
    const search = this.query.trim().toLowerCase();
    const list = questions.filter((question) => {
      if (this.filter === 'open' && question.resolved) return false;
      if (this.filter === 'resolved' && !question.resolved) return false;
      if (this.filter === 'mine' && question.authorId !== this.currentUser?.uid) return false;
      if (!search) return true;
      return [question.title, question.body, question.authorName, ...question.tags]
        .join(' ')
        .toLowerCase()
        .includes(search);
    });
    return [...list].sort((a, b) => {
      if (this.sort === 'answers') {
        return b.answersCount - a.answersCount || b.createdAt - a.createdAt;
      }
      if (this.sort === 'votes') {
        return b.votes - a.votes || b.createdAt - a.createdAt;
      }
      return Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt;
    });
  }

  answersFor(questionId: string): Observable<CommunityAnswer[]> {
    return this.community.answers$(questionId);
  }

  toggleQuestion(question: CommunityQuestion): void {
    this.expandedId = this.expandedId === question.id ? null : question.id;
  }

  openAskForm(): void {
    if (!this.requireUser()) return;
    this.showAskForm = !this.showAskForm;
  }

  async toggleVote(question: CommunityQuestion): Promise<void> {
    if (!this.requireUser() || this.voteBusy[question.id]) return;
    this.voteBusy[question.id] = true;
    this.error = '';
    try {
      const voted = await this.community.voteQuestion(question.id, this.currentUser!.uid);
      this.notifications.success(
        this.i18n.translate(
          voted ? 'communityHelp.voted' : 'Tu voto se retiró de la pregunta.',
        ),
        this.i18n.translate('communityHelp.vote'),
      );
    } catch (error) {
      this.handleError(error, 'No se pudo registrar tu voto.');
    } finally {
      this.voteBusy[question.id] = false;
    }
  }

  async publishQuestion(): Promise<void> {
    if (!this.requireUser() || this.askBusy) return;
    const title = this.draft.title.trim();
    const body = this.draft.body.trim();
    if (title.length < 8 || body.length < 15) {
      this.error = this.i18n.translate(
        'El título debe tener al menos 8 caracteres y la pregunta al menos 15.',
      );
      return;
    }
    this.askBusy = true;
    this.error = '';
    try {
      await this.community.askQuestion(
        { title, body, tags: this.draft.tags.split(',') },
        this.currentUser!,
      );
      this.draft = { title: '', body: '', tags: '' };
      this.showAskForm = false;
      this.notifications.success(
        this.i18n.translate('Tu pregunta se publicó en la comunidad.'),
        this.i18n.translate('Pregunta publicada'),
      );
    } catch (error) {
      this.handleError(error, 'No se pudo publicar la pregunta.');
    } finally {
      this.askBusy = false;
    }
  }

  async postAnswer(question: CommunityQuestion): Promise<void> {
    if (!this.requireUser() || this.answerBusy[question.id]) return;
    if (question.locked) {
      this.notifications.warning(this.i18n.translate('communityHelp.locked'));
      return;
    }
    const body = (this.answerDrafts[question.id] ?? '').trim();
    if (body.length < 5) {
      this.error = this.i18n.translate('Escribe una respuesta antes de enviarla.');
      return;
    }
    this.answerBusy[question.id] = true;
    this.error = '';
    try {
      await this.community.answerQuestion(question, body, this.currentUser!);
      this.answerDrafts[question.id] = '';
      this.notifications.success(
        this.i18n.translate('Tu respuesta se publicó.'),
        this.i18n.translate('Respuesta publicada'),
      );
    } catch (error) {
      this.handleError(error, 'No se pudo publicar la respuesta.');
    } finally {
      this.answerBusy[question.id] = false;
    }
  }

  async acceptAnswer(question: CommunityQuestion, answer: CommunityAnswer): Promise<void> {
    if (!this.requireUser() || question.authorId !== this.currentUser?.uid) return;
    this.error = '';
    try {
      await this.community.acceptAnswer(question, answer);
      this.notifications.success(
        this.i18n.translate('Respuesta aceptada. La pregunta quedó resuelta.'),
        this.i18n.translate('communityHelp.accepted'),
      );
    } catch (error) {
      this.handleError(error, 'No se pudo aceptar la respuesta.');
    }
  }

  async toggleResolved(question: CommunityQuestion): Promise<void> {
    if (!this.canManage(question)) return;
    this.error = '';
    try {
      await this.community.setQuestionResolved(question.id, !question.resolved);
      this.notifications.success(
        this.i18n.translate(
          question.resolved ? 'La pregunta se reabrió.' : 'La pregunta se marcó como resuelta.',
        ),
        this.i18n.translate('Pregunta actualizada'),
      );
    } catch (error) {
      this.handleError(error, 'No se pudo actualizar la pregunta.');
    }
  }

  async togglePinned(question: CommunityQuestion): Promise<void> {
    if (!this.isModerator()) return;
    this.error = '';
    try {
      await this.community.setQuestionPinned(question.id, !question.pinned);
      this.notifications.success(
        this.i18n.translate(question.pinned ? 'Pregunta desafijada.' : 'Pregunta fijada.'),
        this.i18n.translate('Pregunta actualizada'),
      );
    } catch (error) {
      this.handleError(error, 'No se pudo actualizar la pregunta.');
    }
  }

  async toggleLocked(question: CommunityQuestion): Promise<void> {
    if (!this.isModerator()) return;
    this.error = '';
    try {
      await this.community.setQuestionLocked(question.id, !question.locked);
      this.notifications.success(
        this.i18n.translate(
          question.locked ? 'La pregunta se desbloqueó.' : 'La pregunta se bloqueó.',
        ),
        this.i18n.translate('Pregunta actualizada'),
      );
    } catch (error) {
      this.handleError(error, 'No se pudo actualizar la pregunta.');
    }
  }

  async removeQuestion(question: CommunityQuestion): Promise<void> {
    if (!this.canManage(question)) return;
    if (
      typeof confirm === 'function' &&
      !confirm(
        this.i18n.translate('¿Eliminar esta pregunta y todas sus respuestas? Esta acción no se puede deshacer.'),
      )
    ) {
      return;
    }
    this.error = '';
    try {
      await this.community.deleteQuestion(question);
      if (this.expandedId === question.id) this.expandedId = null;
      this.notifications.success(
        this.i18n.translate('Pregunta eliminada.'),
        this.i18n.translate('communityHelp.delete'),
      );
    } catch (error) {
      this.handleError(error, 'No se pudo eliminar la pregunta.');
    }
  }

  isModerator(): boolean {
    return this.currentUser?.role === 'admin' || this.currentUser?.role === 'moderator';
  }

  canManage(question: CommunityQuestion): boolean {
    return this.isModerator() || question.authorId === this.currentUser?.uid;
  }

  isMine(question: CommunityQuestion): boolean {
    return question.authorId === this.currentUser?.uid;
  }

  private requireUser(): boolean {
    if (this.currentUser) return true;
    this.error = this.i18n.translate(
      'Inicia sesión para preguntar, responder, votar o aceptar respuestas.',
    );
    return false;
  }

  private handleError(error: unknown, fallback: string): void {
    this.error = this.i18n.firebaseError(error, fallback);
    this.notifications.error(this.error);
  }
}
