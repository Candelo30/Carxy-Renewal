/**
 * Configuración centralizada del servicio de correos de CARXY.
 *
 * Ajusta los valores aquí para cambiar el remitente, el nombre de la app,
 * los colores de marca y los enlaces públicos sin tocar el resto del código.
 */

export const EMAIL_CONFIG = {
  // Nombre de la app que se muestra en los correos
  appName: 'CARXY 3D Editor',

  // Dirección remite (debe estar verificada en Resend / tu proveedor)
  fromName: 'CARXY',
  fromEmail: 'noreply@tu-dominio.com', // <-- CAMBIAR por tu dominio verificado

  // URL base de tu aplicación web (para los enlaces de acción)
  appUrl: 'https://tu-app.web.app',

  // Colores de marca
  brand: {
    dark: '#0f172a',      // azul muy oscuro (fondos, encabezados)
    primary: '#2563eb',   // azul principal (botones, enlaces)
    accent: '#38bdf8',    // cian eléctrico (detalles)
    text: '#1f2937',      // texto principal
    muted: '#6b7280',     // texto secundario
    bg: '#f3f4f6',        // fondo del cuerpo
    success: '#10b981',   // verde para confirmaciones
    danger: '#ef4444',    // rojo para advertencias
  },

  // Enlaces útiles
  supportEmail: 'soporte@tu-dominio.com',
  privacyUrl: 'https://tu-app.web.app/privacidad',
  termsUrl: 'https://tu-app.web.app/terminos',
} as const;
