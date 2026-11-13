"use strict";
/**
 * Asistente CARXY (beta): responde preguntas sobre el editor 3D, la publicación,
 * la comunidad y la cuenta. Usa la API gratuita de Gemini; la clave vive en el
 * secret `GEMINI_API_KEY` (firebase functions:secrets:set GEMINI_API_KEY) y
 * nunca llega al cliente. Si el secret no está configurado, devuelve una
 * respuesta amable indicando que aún no está disponible.
 *
 * Contexto: encabeza siempre con una lista corta de los artículos publicados
 * del Centro de ayuda (los que el admin gestiona) para que las respuestas
 * apunten a documentación real y no se inventen pasos.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

const db = admin.firestore();
const geminiKey = defineSecret('GEMINI_API_KEY');

const SYSTEM_PROMPT = [
  'Eres el asistente oficial de CARXY 3D Studio, un editor 3D gratuito que funciona en el navegador (Angular + Three.js + Firebase).',
  'Responde SIEMPRE en español, con tono cercano, claro y útil.',
  'Tu ámbito: el editor 3D, publicar modelos, la comunidad, proyectos colaborativos y la cuenta del usuario.',
  'Reglas:',
  '- Respuestas breves (máx. ~150 palabras) salvo que pidan más detalle.',
  '- Si no sabes algo con seguridad, dilo y recomienda el Centro de ayuda (/help) o la página de Contacto.',
  '- No inventes funciones que no existen; si te piden algo fuera de CARXY, dilo con honestidad.',
  '- Nunca pidas ni aceptes contraseñas, claves ni datos personales del usuario.',
  '- Al explicar pasos, usa listas numeradas cortas.',
].join('\n');

/** Recoge los títulos de artículos publicados como contexto (best-effort). */
async function loadHelpCorpus() {
  try {
    const snap = await db.collection('helpArticles')
      .where('isPublished', '==', true)
      .limit(15)
      .get();
    const titles = snap.docs.map((d) => (d.data() || {}).title).filter((t) => typeof t === 'string' && t.trim());
    if (!titles.length) return '';
    return [
      'Artículos publicados en el Centro de ayuda (úsalos como referencia y avísalo cuando ayude a resolver la duda):',
      ...titles.map((t) => '- ' + t),
    ].join('\n');
  } catch (error) {
    console.warn('No se pudo cargar el corpus de ayuda.', error);
    return '';
  }
}

const askCarxyBot = onCall(
  { secrets: [geminiKey], invoker: 'public' },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión para hablar con el asistente.');
    }
    const question = String(request.data?.question ?? '').trim();
    if (!question) {
      throw new HttpsError('invalid-argument', 'La pregunta está vacía.');
    }
    if (question.length > 500) {
      throw new HttpsError('invalid-argument', 'La pregunta es demasiado larga (máximo 500 caracteres).');
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'REPLACE_WITH_YOUR_KEY') {
      console.warn('GEMINI_API_KEY no configurado (o placeholder); el asistente responde con el modo "no disponible".');
      return {
        answer: 'El asistente está en modo mantenimiento. Mientras tanto, el Centro de ayuda (/help) responde casi todo: publícalo, busca tu duda o escríbenos desde Contacto.',
        configured: false,
      };
    }

    const corpus = await loadHelpCorpus();
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT + (corpus ? '\n\n' + corpus : '') }] },
        contents: [{ role: 'user', parts: [{ text: question }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 700 },
      }),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      console.warn('Gemini respondió', res.status, detail);
      throw new HttpsError('internal', 'El asistente no pudo responder ahora. Inténtalo de nuevo en unos segundos.');
    }

    const payload = await res.json();
    const answer = (payload?.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p?.text ?? '')
      .join('')
      .trim();
    return { answer: answer || 'No pude generar una respuesta ahora. Intenta reformular tu pregunta.', configured: true };
  },
);

module.exports = { askCarxyBot };
