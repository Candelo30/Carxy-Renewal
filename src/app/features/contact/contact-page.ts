import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom, take } from 'rxjs';
import { FeedbackType } from '../../core/models/social.models';
import { AuthService } from '../../core/services/auth';
import { CommunityService } from '../../core/services/community';
import { I18nService } from '../../core/services/i18n';
import { NotificationService } from '../../core/services/notifications';
import { environment } from '../../../environments/environment';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-contact-page',
  standalone: true,
  imports: [
    TranslatePipe,
    FormsModule,
    RouterLink,
    ShellHeaderComponent,
    SiteFooterComponent,
  ],
  templateUrl: './contact-page.html',
  styleUrl: './contact-page.css',
})
export class ContactPage {
  readonly auth = inject(AuthService);
  readonly links = environment.links;
  readonly types: FeedbackType[] = ['bug', 'idea', 'account', 'collaboration', 'other'];

  private readonly community = inject(CommunityService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);

  form = {
    name: '',
    email: '',
    type: 'bug' as FeedbackType,
    subject: '',
    message: '',
  };
  busy = false;
  sent = false;
  error = '';

  constructor() {
    this.auth.user$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => {
        if (!user) return;
        if (!this.form.name) this.form.name = user.displayName;
        if (!this.form.email) this.form.email = user.email;
      });
  }

  async submit(): Promise<void> {
    if (this.busy) return;
    this.error = '';
    const name = this.form.name.trim();
    const email = this.form.email.trim();
    const subject = this.form.subject.trim();
    const message = this.form.message.trim();
    if (!name || !email || !subject || !message) {
      this.error = this.i18n.translate('Completa tu nombre, correo, asunto y mensaje.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.error = this.i18n.translate('El correo no es válido.');
      return;
    }
    if (message.length < 10) {
      this.error = this.i18n.translate('Cuéntanos un poco más: el mensaje debe tener al menos 10 caracteres.');
      return;
    }
    this.busy = true;
    this.sent = false;
    try {
      const user = await firstValueFrom(this.auth.user$.pipe(take(1)));
      await this.community.createFeedback({ name, email, type: this.form.type, subject, message }, user);
      this.sent = true;
      this.form = {
        name: user?.displayName ?? '',
        email: user?.email ?? '',
        type: 'bug',
        subject: '',
        message: '',
      };
      this.notifications.success(
        this.i18n.translate('contact.success'),
        this.i18n.translate('Mensaje enviado'),
      );
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : this.i18n.translate('contact.error');
      this.notifications.error(this.error);
    } finally {
      this.busy = false;
    }
  }
}
