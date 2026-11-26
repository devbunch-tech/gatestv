// Busca por voz do app (Windows e navegadores sem reconhecimento de voz): o áudio gravado (até ~6 s,
// em base64) é transcrito pelo Whisper da Cloudflare Workers AI (ligação "AI" no wrangler.toml).
export const VOICE_MAX = 1_000_000; // base64 (~730 KB de áudio; 6 s em opus têm ~25 KB)
export const VOICE_PER_DAY = 150; // buscas por voz por conta a cada 24 h

const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// Frases que o Whisper inventa em trechos sem fala.
const PHANTOM = /amara\.org|legendas pela comunidade|legendado por|obrigado por assistir|inscreva-se no canal/i;

export async function transcribe(AI, audio) {
  let r;
  try {
    r = await AI.run('@cf/openai/whisper-large-v3-turbo', { audio, language: 'pt' });
  } catch (e) {
    // Reserva: o modelo anterior (recebe os bytes do áudio).
    console.warn('[voz] turbo', e?.message);
    r = await AI.run('@cf/openai/whisper', { audio: [...fromB64(audio)] });
  }
  const text = String(r?.text || '').trim();
  return PHANTOM.test(text) ? '' : text.slice(0, 200);
}
