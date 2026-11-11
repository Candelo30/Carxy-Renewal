"use strict";
/**
 * Plantillas HTML de correo para CARXY 3D Editor.
 *
 * Todas las funciones reciben un objeto de datos dinámico y devuelven un HTML
 * completo, responsivo y con CSS en línea (estándar para clientes de correo).
 *
 * Las plantillas usan únicamente estilos en atributo `style` y tablas para
 * garantizar compatibilidad con Gmail, Outlook, Apple Mail, etc.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyEmailTemplate = verifyEmailTemplate;
exports.resetPasswordTemplate = resetPasswordTemplate;
exports.welcomeTemplate = welcomeTemplate;
exports.projectInvitationTemplate = projectInvitationTemplate;
exports.feedbackConfirmationTemplate = feedbackConfirmationTemplate;
const config_1 = require("./config");
const { brand, appName, fromName, supportEmail, privacyUrl, termsUrl } = config_1.EMAIL_CONFIG;
/* ------------------------------------------------------------------ */
/*  Utilidades                                                        */
/* ------------------------------------------------------------------ */
/** Envuelve cualquier contenido en la estructura base de correo (header + cuerpo + footer). */
function wrap({ preheader, title, bodyHtml }) {
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-data-detectors" content="all">
  <title>${title}</title>
  <!--[if mso]>
  <noscript>
  <xml>
  <o:OfficeDocumentSettings>
    <o:AllowPNG/>
    <o:PixelsPerInch>96</o:PixelsPerInch>
  </o:OfficeDocumentSettings>
  </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0; padding:0; width:100%; background-color:${brand.bg}; color:${brand.text}; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height:1.6; -webkit-text-size-adjust:100%;">
  <!-- Preheader oculto (texto de vista previa en la bandeja de entrada) -->
  ${preheader ? `<div style="display:none; font-size:1px; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden; mso-hide:all;">${preheader}</div>` : ''}

  <!-- Contenedor principal centrado -->
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:620px; background-color:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 10px 25px -5px rgba(0,0,0,0.08); border:1px solid #e2e8f0;">
          ${bodyHtml}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
/** Encabezado de marca con logo tipo texto. */
function header({ title, subtitle }) {
    return `
    <tr>
      <td align="center" style="background:${brand.dark}; padding:32px 24px 24px;">
        <h1 style="margin:0; font-size:26px; font-weight:800; color:#ffffff; letter-spacing:-0.5px;">
          <span style="color:${brand.accent};">${fromName}</span> <span style="font-weight:600;">${appName}</span>
        </h1>
        ${subtitle ? `<p style="margin:8px 0 0; font-size:14px; color:#94a3b8; font-weight:400;">${subtitle}</p>` : ''}
      </td>
    </tr>`;
}
/** Línea divisoria sutil. */
function divider() {
    return `<tr><td style="height:1px; background-color:#e2e8f0; padding:0;"></td></tr>`;
}
/** Caja de contenido con padding. */
function content(html) {
    return `<tr><td style="padding:32px 28px;">${html}</td></tr>`;
}
/** Botón de llamada a la acción (CTA). */
function button({ url, text, style = 'primary' }) {
    const isPrimary = style === 'primary';
    const bg = isPrimary ? brand.primary : '#ffffff';
    const color = isPrimary ? '#ffffff' : brand.primary;
    const border = isPrimary ? 'none' : `2px solid ${brand.primary}`;
    return `
    <tr>
      <td align="center" style="padding:24px 28px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td align="center" style="border-radius:10px; background:${bg}; border:${border};">
              <a href="${url}" target="_blank" rel="noopener"
                 style="display:inline-block; padding:16px 32px; font-size:16px; font-weight:700; color:${color}; text-decoration:none; border-radius:8px; border:none;">
                ${text}
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}
/** Tarjeta de datos (etiqueta + valor). */
function infoRow({ label, value }) {
    return `
    <tr>
      <td style="padding:10px 0; font-size:14px; color:${brand.muted}; border-bottom:1px solid #f1f5f9;">
        <strong style="color:${brand.text};">${label}:</strong> ${value}
      </td>
    </tr>`;
}
/** Pie de página con datos de contacto y enlaces legales. */
function footer() {
    return `
    <tr>
      <td align="center" style="background:#f8fafc; padding:28px 24px; border-top:1px solid #e2e8f0;">
        <p style="margin:0 0 12px; font-size:12px; color:${brand.muted};">
          © ${new Date().getFullYear()} ${fromName} · ${appName}
        </p>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
          <tr>
            <td style="padding:0 6px;">
              <a href="${supportEmail}" style="font-size:12px; color:${brand.primary}; text-decoration:none; font-weight:600;">Soporte</a>
            </td>
            <td style="padding:0 6px;">
              <a href="${privacyUrl}" style="font-size:12px; color:${brand.muted}; text-decoration:none;">Privacidad</a>
            </td>
            <td style="padding:0 6px;">
              <a href="${termsUrl}" style="font-size:12px; color:${brand.muted}; text-decoration:none;">Términos</a>
            </td>
          </tr>
        </table>
        <p style="margin:14px 0 0; font-size:11px; color:#94a3b8;">
          Si no solicitaste este correo, puedes ignorarlo con seguridad.
        </p>
      </td>
    </tr>`;
}
function verifyEmailTemplate(data) {
    const { displayName, verifyUrl, expiresIn = '24 horas' } = data;
    const body = `
    ${header({ title: 'Confirma tu correo', subtitle: 'Un paso más para crear en 3D' })}
    ${divider()}
    ${content(`
      <h2 style="margin:0 0 12px; font-size:22px; color:${brand.dark}; font-weight:800;">Hola, ${escapeHtml(displayName)}</h2>
      <p style="margin:0 0 24px; font-size:16px; color:${brand.text};">
        Gracias por registrarte en <strong>${appName}</strong>. Para activar tu cuenta y proteger tu espacio de trabajo,
        confirma tu dirección de correo electrónico haciendo clic en el botón de abajo:
      </p>
      ${button({ url: verifyUrl, text: 'Confirmar mi correo electrónico' })}
      <p style="margin:20px 0 0; font-size:14px; color:${brand.muted};">
        Este enlace expira en <strong>${expiresIn}</strong>. Si no creaste esta cuenta, puedes ignorar este mensaje.
      </p>
    `)}
    ${footer()}
  `;
    return {
        subject: `Confirma tu correo en ${appName}`,
        html: wrap({ preheader: 'Confirma tu dirección de correo para activar tu cuenta de CARXY.', title: 'Confirma tu correo', bodyHtml: body }),
        text: `Hola ${displayName}, confirma tu correo en ${appName}: ${verifyUrl}. Expira en ${expiresIn}.`,
    };
}
function resetPasswordTemplate(data) {
    const { displayName, resetUrl, expiresIn = '60 minutos' } = data;
    const body = `
    ${header({ title: 'Restablecer tu contraseña', subtitle: 'Recupera el acceso a tu cuenta' })}
    ${divider()}
    ${content(`
      <h2 style="margin:0 0 12px; font-size:22px; color:${brand.dark}; font-weight:800;">Hola, ${escapeHtml(displayName)}</h2>
      <p style="margin:0 0 24px; font-size:16px; color:${brand.text};">
        Recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong>${appName}</strong>.
        Haz clic en el botón para crear una nueva contraseña:
      </p>
      ${button({ url: resetUrl, text: 'Restablecer mi contraseña' })}
      <p style="margin:20px 0 0; font-size:14px; color:${brand.muted};">
        Este enlace expira en <strong>${expiresIn}</strong>. Si no solicitaste este cambio, ignora este mensaje
        y te recomendamos cambiar tu contraseña desde los ajustes de seguridad.
      </p>
    `)}
    ${footer()}
  `;
    return {
        subject: `Restablecer tu contraseña en ${appName}`,
        html: wrap({ preheader: 'Restablece la contraseña de tu cuenta de CARXY.', title: 'Restablecer tu contraseña', bodyHtml: body }),
        text: `Hola ${displayName}, restablece tu contraseña en ${appName}: ${resetUrl}. Expira en ${expiresIn}.`,
    };
}
function welcomeTemplate(data) {
    const { displayName, dashboardUrl } = data;
    const body = `
    ${header({ title: '¡Bienvenido a CARXY!', subtitle: 'Tu portafolio 3D está listo' })}
    ${divider()}
    ${content(`
      <h2 style="margin:0 0 12px; font-size:22px; color:${brand.dark}; font-weight:800;">Hola, ${escapeHtml(displayName)}</h2>
      <p style="margin:0 0 20px; font-size:16px; color:${brand.text};">
        Tu cuenta ha sido creada con éxito. Ya puedes comenzar a modelar, editar y publicar tus escenas 3D desde el editor.
      </p>
      ${button({ url: dashboardUrl, text: 'Ir al editor 3D' })}
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:24px;">
        <tr>
          <td style="background:${brand.bg}; border-radius:10px; padding:20px;">
            <h3 style="margin:0 0 12px; font-size:16px; color:${brand.dark}; font-weight:700;">¿Qué puedes hacer ahora?</h3>
            <ul style="margin:0; padding-left:18px; font-size:14px; color:${brand.text};">
              <li style="margin-bottom:6px;">Crear y editar modelos 3D en tiempo real</li>
              <li style="margin-bottom:6px;">Guardar proyectos en la nube y acceder desde cualquier dispositivo</li>
              <li style="margin-bottom:6px;">Invitar a otros creadores a colaborar en tus proyectos</li>
              <li style="margin-bottom:0;">Publicar y compartir tu portafolio con la comunidad</li>
            </ul>
          </td>
        </tr>
      </table>
    `)}
    ${footer()}
  `;
    return {
        subject: `¡Bienvenido a ${appName}!`,
        html: wrap({ preheader: 'Tu cuenta de CARXY está lista. Comienza a crear en 3D.', title: '¡Bienvenido a CARXY!', bodyHtml: body }),
        text: `Hola ${displayName}, bienvenido a ${appName}. Accede al editor: ${dashboardUrl}`,
    };
}
function projectInvitationTemplate(data) {
    const { displayName, invitedByName, projectName, role, acceptUrl, expiresIn = '7 días' } = data;
    const roleMap = { owner: 'Dueño', editor: 'Editor', viewer: 'Visor' };
    const roleLabel = roleMap[String(role)] || String(role);
    const body = `
    ${header({ title: 'Nueva invitación a un proyecto', subtitle: 'Alguien te quiere en su equipo' })}
    ${divider()}
    ${content(`
      <h2 style="margin:0 0 12px; font-size:22px; color:${brand.dark}; font-weight:800;">Hola, ${escapeHtml(displayName)}</h2>
      <p style="margin:0 0 16px; font-size:16px; color:${brand.text};">
        <strong>${escapeHtml(invitedByName)}</strong> te ha invitado a colaborar en el proyecto
        <strong>${escapeHtml(projectName)}</strong> de <strong>${appName}</strong>.
      </p>
      ${infoRow({ label: 'Proyecto', value: projectName })}
      ${infoRow({ label: 'Invitado por', value: invitedByName })}
      ${infoRow({ label: 'Rol asignado', value: roleLabel })}
      ${divider()}
      <p style="margin:20px 0 20px; font-size:16px; color:${brand.text};">
        Acepta la invitación para acceder al proyecto y comenzar a editar junto al equipo:
      </p>
      ${button({ url: acceptUrl, text: 'Aceptar invitación' })}
      <p style="margin:20px 0 0; font-size:14px; color:${brand.muted};">
        Esta invitación expira en <strong>${expiresIn}</strong>.
      </p>
    `)}
    ${footer()}
  `;
    return {
        subject: `${invitedByName} te invitó al proyecto "${projectName}" en ${appName}`,
        html: wrap({ preheader: 'Has recibido una invitación para colaborar en un proyecto 3D.', title: 'Nueva invitación a un proyecto', bodyHtml: body }),
        text: `Hola ${displayName}, ${invitedByName} te invitó al proyecto "${projectName}" en ${appName} como ${roleLabel}. Acepta aquí: ${acceptUrl}`,
    };
}
function feedbackConfirmationTemplate(data) {
    const { displayName, subject, ticketId } = data;
    const body = `
    ${header({ title: 'Hemos recibido tu mensaje', subtitle: 'Gracias por escribirnos' })}
    ${divider()}
    ${content(`
      <h2 style="margin:0 0 12px; font-size:22px; color:${brand.dark}; font-weight:800;">Hola, ${escapeHtml(displayName)}</h2>
      <p style="margin:0 0 20px; font-size:16px; color:${brand.text};">
        Hemos recibido tu consulta sobre <strong>${escapeHtml(subject)}</strong>. Nuestro equipo la revisará y te responderá a la brevedad.
      </p>
      ${infoRow({ label: 'Asunto', value: subject })}
      ${infoRow({ label: 'Número de ticket', value: ticketId })}
      <p style="margin:24px 0 0; font-size:14px; color:${brand.muted};">
        Puedes responder a este correo si necesitas añadir más información.
      </p>
    `)}
    ${footer()}
  `;
    return {
        subject: `Tu mensaje ha sido recibido (${ticketId})`,
        html: wrap({ preheader: 'Hemos recibido tu mensaje de soporte de CARXY.', title: 'Hemos recibido tu mensaje', bodyHtml: body }),
        text: `Hola ${displayName}, hemos recibido tu mensaje sobre "${subject}". Ticket: ${ticketId}`,
    };
}
/* ------------------------------------------------------------------ */
/*  Helper de escape                                                  */
/* ------------------------------------------------------------------ */
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
