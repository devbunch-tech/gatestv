// Imagens salvas no aparelho (APK Android 1.0.9+): capas, fundos e logos passam pelo servidor
// local (/img), que guarda cada imagem na primeira vez. APKs antigos e outros aparelhos usam o
// endereço original.
const HAS_CACHE = typeof window !== 'undefined' && typeof window.GatesAndroid?.imageCache === 'function';

export const cachedImg = (url) => (HAS_CACHE && url && /^https?:\/\//.test(url) ? `/img?u=${encodeURIComponent(url)}` : url);
