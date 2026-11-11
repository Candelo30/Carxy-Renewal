import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { I18nService } from '../../../core/services/i18n';
import { TranslatePipe } from '../../pipes/translate.pipe';

@Component({
  selector: 'app-site-footer',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  templateUrl: './site-footer.html',
  styleUrl: './site-footer.css',
})
export class SiteFooterComponent {
  readonly i18n = inject(I18nService);
  readonly year = new Date().getFullYear();
  readonly repositoryUrl = environment.links.repository;
  readonly issuesUrl = environment.links.issues;
  readonly discussionsUrl = environment.links.discussions;
  readonly securityPolicyUrl = `${environment.links.repository}/security/policy`;
}
