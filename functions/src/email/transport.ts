/**
 * Transporte de envío de correos.
 *
 * Por defecto usa Resend (moderno, fácil de configurar y buena entregabilidad).
 * Si prefieres otro proveedor (SendGrid, Mailgun, Nodemailer SMTP, AWS SES...),
 * solo reemplaza la función `sendMail` abajo manteniendo la misma firma.
 */

import { Resend } from 'resend';
import { EMAIL_CONFIG } from './config';

let resend: Resend | null = null;

function getResend(): Resend {
  if (!resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY no está configurada en las variables de entorno de Firebase.');
    }
    resend = new Resend(apiKey);
  }
  return resend;
}

export interface MailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string; // versión plano para clientes que no renderizan HTML
}

/**
 * Envía un correo electrónico.
 * Lanza error si falla para que la Cloud Function lo reporte correctamente.
 */
export async function sendMail(options: MailOptions): Promise<void> {
  // Si no hay API key configurada (desarrollo local sin email real),
  // solo logueamos y no fallamos. En producción exige la variable de entorno.
  if (!process.env.RESEND_API_KEY) {
    console.warn(
      `[EMAIL DEV MODE] Se habría enviado a "${options.to}"\nAsunto: ${options.subject}\n`,
    );
    return;
  }

  const { error } = await getResend().emails.send({
    from: `${EMAIL_CONFIG.fromName} <${EMAIL_CONFIG.fromEmail}>`,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  });

  if (error) {
    console.error('Error enviando correo con Resend:', error);
    throw new Error(`No se pudo enviar el correo: ${error.message}`);
  }
}

/**
 * Helper para construir una URL de acción con parámetros de consulta.
 */
export function buildActionUrl(path: string, params: Record<string, string | number>): string {
  const search = new URLSearchParams(params as Record<string, string>).toString();
  return `${EMAIL_CONFIG.appUrl}${path}?${search}`;
}
