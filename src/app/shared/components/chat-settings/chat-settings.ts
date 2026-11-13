import { Component, EventEmitter, Input, Output, ViewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../pipes/translate.pipe';

/** Escala de texto disponible en el chat. */
export type ChatFontScale = 'sm' | 'md' | 'lg';

export interface ChatAccentOption {
  value: string;
  label: string;
}

export interface ChatBackgroundOption {
  id: string;
  label: string;
  css: string;
}

/**
 * Panel de ajustes del chat.
 *
 * Es un componente tonto: recibe el estado actual y emite los cambios, para
 * que la página del chat siga siendo ladueña de los datos.
 */
@Component({
  selector: 'app-chat-settings',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  templateUrl: './chat-settings.html',
  styleUrl: './chat-settings.css',
})
export class ChatSettingsComponent {
  @Input() fontScale: ChatFontScale = 'md';
  @Input() showTimestamps = true;
  @Input() accent = '#8b5cf6';
  @Input() muted = false;
  @Input() hasConversation = false;
  @Input() backgroundId = 'default';
  @Input() backgrounds: ChatBackgroundOption[] = [];
  @Input() accents: ChatAccentOption[] = [];

  @Output() fontScaleChange = new EventEmitter<ChatFontScale>();
  @Output() showTimestampsChange = new EventEmitter<boolean>();
  @Output() accentChange = new EventEmitter<string>();
  @Output() mutedChange = new EventEmitter<boolean>();
  @Output() backgroundChange = new EventEmitter<string>();
  @Output() exportRequest = new EventEmitter<void>();

  @ViewChild('dialog') private dialog?: ElementRef<HTMLDialogElement>;

  /** Abre el panel. */
  open(): void {
    this.dialog?.nativeElement.showModal();
  }

  /** Cierra el panel. */
  close(): void {
    this.dialog?.nativeElement.close();
  }

  /** Cierra el panel al pulsar fuera del contenido. */
  closeOnBackdrop(event: MouseEvent): void {
    const dialog = this.dialog?.nativeElement;
    if (!dialog || event.target !== dialog) return;
    dialog.close();
  }

  selectFontScale(scale: ChatFontScale): void {
    this.fontScaleChange.emit(scale);
  }

  toggleTimestamps(): void {
    this.showTimestampsChange.emit(!this.showTimestamps);
  }

  selectAccent(accent: string): void {
    this.accentChange.emit(accent);
  }

  toggleMute(): void {
    this.mutedChange.emit(!this.muted);
  }

  selectBackground(id: string): void {
    this.backgroundChange.emit(id);
  }
}
