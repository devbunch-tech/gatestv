// Baixa, descompacta e interpreta o XMLTV fora da thread principal (evita travar a interface).
import { parseXmltvText } from './xmltv';

self.onmessage = async ({ data }) => {
  const { id, target, from, to, ids, names } = data;
  try {
    const res = await fetch(target);
    if (!res.ok) throw new Error(`EPG indisponível (HTTP ${res.status}).`);
    const buf = new Uint8Array(await res.arrayBuffer());
    let text;
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
      text = await new Response(stream).text();
    } else text = new TextDecoder().decode(buf);
    const wanted = ids || names ? { ids: new Set(ids || []), names: new Set(names || []) } : null;
    self.postMessage({ id, ok: true, result: parseXmltvText(text, { from, to, wanted }) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message || String(err) });
  }
};
