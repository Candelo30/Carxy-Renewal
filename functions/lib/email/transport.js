"use strict";
/**
 * Transporte de envío de correos.
 *
 * Por defecto usa Resend (moderno, fácil de configurar y buena entregabilidad).
 * Si prefieres otro proveedor (SendGrid, Mailgun, Nodemailer SMTP, AWS SES...),
 * solo reemplaza la función `sendMail` abajo manteniendo la misma firma.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendMail = sendMail;
exports.buildActionUrl = buildActionUrl;
const resend_1 = require("resend");
const config_1 = require("./config");
let resend = null;
function getResend() {
    if (!resend) {
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
            throw new Error('RESEND_API_KEY no está configurada en las variables de entorno de Firebase.');
        }
        resend = new resend_1.Resend(apiKey);
    }
    return resend;
}
/**
 * Envía un correo electrónico.
 * Lanza error si falla para que la Cloud Function lo reporte correctamente.
 */
async function sendMail(options) {
    // Si no hay API key configurada (desarrollo local sin email real),
    // solo logueamos y no fallamos. En producción exige la variable de entorno.
    if (!process.env.RESEND_API_KEY) {
        console.warn(`[EMAIL DEV MODE] Se habría enviado a "${options.to}"\nAsunto: ${options.subject}\n`);
        return;
    }
    const { error } = await getResend().emails.send({
        from: `${config_1.EMAIL_CONFIG.fromName} <${config_1.EMAIL_CONFIG.fromEmail}>`,
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
function buildActionUrl(path, params) {
    const search = new URLSearchParams(params).toString();
    return `${config_1.EMAIL_CONFIG.appUrl}${path}?${search}`;
}
