import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-site-footer',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './site-footer.html',
  styleUrl: './site-footer.css',
})
export class SiteFooterComponent {
  @Input() language: 'es' | 'en' = 'es';
  readonly year = new Date().getFullYear();
  readonly repositoryUrl = 'https://github.com/Candelo30/Carxy-Renewal';
}
