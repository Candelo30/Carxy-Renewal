"use strict";
/**
 * Transporte de envío de correos.
 *
 * Modo simple: no requiere configuración adicional. Registra el correo que se
 * habría enviado y no falla.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendMail = sendMail;
exports.buildActionUrl = buildActionUrl;
const config_1 = require("./config");
async function sendMail(options) {
    console.warn(`[EMAIL DEV MODE] Se habría enviado a "${options.to}"\nAsunto: ${options.subject}\n`);
    return;
}
/**
 * Helper para construir una URL de acción con parámetros de consulta.
 */
function buildActionUrl(path, params) {
    const search = new URLSearchParams(params).toString();
    return `${config_1.EMAIL_CONFIG.appUrl}${path}?${search}`;
}
