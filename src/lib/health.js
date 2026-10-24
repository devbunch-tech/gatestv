// Validação das fontes dos canais ao vivo (via /probe no servidor do app).

// Xtream: o mesmo canal ao vivo existe em .ts e .m3u8; com atraso de segurança o player usa o HLS.
export const XTREAM_LIVE_TS = /\/live\/[^/]+\/[^/]+\/\d+\.ts(\?.*)?$/;

export const playableUrl = (item, delay) =>
  delay > 0 && XTREAM_LIVE_TS.test(item.url) ? item.url.replace(/\.ts(\?.*)?$/, '.m3u8$1') : item.url;

async function probeUrl(url) {
  try {
    const r = await fetch('/probe?url=' + encodeURIComponent(url));
    return await r.json();
  } catch {
    return { ok: false, error: 'rede' };
  }
}

// Um canal está no ar se a URL que o player vai usar responde; para Xtream, também vale o .ts original.
export async function probeChannel(item, delay) {
  const main = playableUrl(item, delay);
  const r = await probeUrl(main);
  if (r.ok || main === item.url) return { ok: !!r.ok, at: Date.now(), kind: r.kind, error: r.error };
  const r2 = await probeUrl(item.url);
  return { ok: !!r2.ok, at: Date.now(), kind: r2.kind, error: r2.error };
}
