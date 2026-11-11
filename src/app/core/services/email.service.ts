/**
 * Servicio de correos de CARXY.
 *
 * Envía peticiones a las Cloud Functions propias (desplegadas en Firebase) que
 * renderizan plantillas HTML dinámicas y elegantes. Cubre todos los casos de
 * uso de correo de la aplicación: verificación, recuperación, bienvenida,
 * invitaciones a proyectos y confirmación de feedback.
 *
 * Requiere que las funciones estén desplegadas:
 *   firebase deploy --only functions:sendVerifyEmail,functions:sendResetPassword,...
 */

import { Injectable, inject } from '@angular/core';
import {
  FirebaseFunctions,
  httpsCallable,
} from '@angular/fire/functions';
import { firstValueFrom } from 'rxjs';

export interface EmailResult {
  ok: boolean;
  to: string;
}

@Injectable({ providedIn: 'root' })
export class EmailService {
  private readonly functions = inject(FirebaseFunctions, { optional: true });

  /** Llama a una función onCall de Firebase Functions y devuelve el resultado. */
  private async call(name: string, data: Record<string, unknown>): Promise<EmailResult> {
    if (!this.functions) {
      throw new Error('Firebase Functions no está configurado.');
    }
    const callable = httpsCallable(this.functions, name);
    const result = await firstValueFrom(callable(data));
    return result as EmailResult;
  }

  /* ------------------------------------------------------------------ */
  /*  Verificación de correo (registro / reenvío)                       */
  /* ------------------------------------------------------------------ */

  async sendVerifyEmail(params: {
    to: string;
    displayName: string;
    verifyUrl: string;
    expiresIn?: string;
  }): Promise<EmailResult> {
    return this.call('sendVerifyEmail', params);
  }

  /* ------------------------------------------------------------------ */
  /*  Restablecer contraseña                                            */
  /* ------------------------------------------------------------------ */

  async sendResetPassword(params: {
    to: string;
    displayName: string;
    resetUrl: string;
    expiresIn?: string;
  }): Promise<EmailResult> {
    return this.call('sendResetPassword', params);
  }

  /* ------------------------------------------------------------------ */
  /*  Correo de bienvenida                                              */
  /* ------------------------------------------------------------------ */

  async sendWelcomeEmail(params: {
    to: string;
    displayName: string;
    dashboardUrl?: string;
  }): Promise<EmailResult> {
    return this.call('sendWelcomeEmail', params);
  }

  /* ------------------------------------------------------------------ */
  /*  Invitación a proyecto (colaboración)                              */
  /* ------------------------------------------------------------------ */

  async sendProjectInvitation(params: {
    to: string;
    displayName: string;
    invitedByName: string;
    projectName: string;
    role: string;
    acceptUrl: string;
    expiresIn?: string;
  }): Promise<EmailResult> {
    return this.call('sendProjectInvitation', params);
  }

  /* ------------------------------------------------------------------ */
  /*  Confirmación de feedback / soporte                                */
  /* ------------------------------------------------------------------ */

  async sendFeedbackConfirmation(params: {
    to: string;
    displayName: string;
    subject: string;
    ticketId: string;
  }): Promise<EmailResult> {
    return this.call('sendFeedbackConfirmation', params);
  }
}
