// Monta a lista de troca rápida: só os canais configurados, sem duplicidade, na versão HD
// que estiver funcionando (validação feita pelo store ao abrir o app).
import { PREFER_4K, ZAP_EXCLUDE, ZAP_KEEP, ZAP_PREFER_NUM, ZAP_RULES } from '../config/zapping.js';
import { regionRules } from '../config/regions.js';

// Superescritos e sobrescritos (¹²³, ᴴᴰ, ᶠᴴᴰ, ⁶⁰ᶠᵖˢ…) são marcações da lista, não parte do nome.
const MARKS = /[²³¹⁰-₟ᴬ-ᵪᶛ-ᶿ™®*★☆✓✔•·]/g;

const prep = (s) =>
  String(s || '')
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const QTAG = '(?:4k|uhd|2160p?|fhd|full ?hd|1080p?|hd|720p?|sd|480p?|h\\.?265|hevc|h\\.?264)';
const QUALITY = new RegExp(`\\b(${QTAG}|60 ?fps|50 ?fps|fps)\\b`, 'g');
const ALT = /\b(op(?:cao|c|t)?|opt(?:ion)?|alt(?:ernativo|ernativa)?|reserva|backup|bkp|sinal|fonte|server|srv)\s*\d*\b|#\s*\d+/g;
const COUNTRY = /\b(br|brasil|brazil|bra|pt|ptbr|pt br)\b/g;

export function qualityRank(name) {
  // Números sobrescritos ("HD²") marcam fonte alternativa: tirados antes, para "HD" continuar sendo reconhecido.
  const n = prep(String(name || '').replace(/[²³¹⁰-⁹]/g, ' '));
  let r = 2; // sem marcação
  if (/\bh\.?265\b|\bhevc\b/.test(n)) r = 6; // muitos aparelhos não decodificam H.265 no navegador
  // "HD1", "FHD2", "SD1": número colado = versão alternativa da mesma qualidade.
  else if (/\b(hd|720p?)\d{0,2}\b/.test(n) && !/\b(fhd|full ?hd)\d{0,2}\b/.test(n)) r = 0; // HD (preferido)
  else if (/\b(fhd|full ?hd|1080p?)\d{0,2}\b/.test(n)) r = 1;
  else if (/\b(4k|uhd|2160p?)\b/.test(n)) r = PREFER_4K ? -1 : 3; // 4K na frente quando existir
  else if (/\b(sd|480p?)\d{0,2}\b/.test(n)) r = 4;
  // Fontes alternativas/reserva ficam depois da principal de mesma qualidade.
  const alt = ALT.test(prep(String(name).replace(MARKS, ' '))) || /[²³¹⁰-⁹]/.test(name) ? 0.5 : 0;
  ALT.lastIndex = 0;
  return r + alt;
}

// "BR | HBO POP HD² [ALT]" / "HBO POP FHD 2" / "HBO POP (Opção 2)" -> "hbo pop"   ·   "HBO 2 HD" -> "hbo 2"
export function baseName(name) {
  let s = prep(String(name || '').replace(MARKS, ' '));
  s = s
    .replace(/^\s*(\[[^\]]*\]|\|[^|]*\||[a-z]{2,3}\s*[:|]|[a-z]{2,3}\s+-)\s*/, '')
    .replace(/[([][^)\]]*[)\]]/g, ' ')
    // Número logo depois da qualidade = versão alternativa ("HD 2"), não o canal "2".
    .replace(new RegExp(`\\b(${QTAG})[\\s\\-_.]*\\d{1,2}\\b`, 'g'), ' ')
    .replace(ALT, ' ')
    .replace(QUALITY, ' ')
    .replace(/[^a-z0-9+&]+/g, ' ')
    .replace(COUNTRY, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s
    .replace(/\b([a-z]{3,}?)(fhd|uhd|hd)$/, '$1') // "lifetimefhd" -> "lifetime"
    .replace(/^tc (?=premium|action|pipoca|cult|fun|touch)/, 'telecine ');
}

// Chave para identificar o mesmo canal escrito de formas diferentes:
// "Prime Box Brazil" = "Primebox Brazil", "Fish TV" = "Fish".
// "Globo Rio de Janeiro" (4K) = "Globo Rio" (HD), "SporTV 1" = "SporTV".
export function channelKey(base) {
  return (
    base
      .replace(/\brio de janeiro\b/g, 'rio')
      .replace(/\bsao paulo\b/g, 'sp')
      .replace(/\btv\b/g, ' ')
      .replace(/\s1$/, '')
      .replace(/\s+/g, '') || base
  );
}

const preferNum = (ch) => (ZAP_PREFER_NUM.includes(+ch.num) ? 0 : 1);
const natural = (a, b) => a.localeCompare(b, 'pt-BR', { numeric: true });

// Canais da troca rápida, já agrupados: [{ key, label, candidates: [canal, …] }] — candidatos
// ordenados do melhor (HD principal) para o pior. uf: estado do cliente — a Globo e a Record
// do estado dele vêm antes de todos.
export function zapGroups(live, uf) {
  const RULES = uf ? [...regionRules(uf), ...ZAP_RULES] : ZAP_RULES;
  const byBase = new Map(); // base -> { rule, candidates }
  const others = []; // canais que não casaram com nenhuma regra (ex.: grupo "4K")
  live.forEach((ch, order) => {
    const base = baseName(ch.name);
    const group = prep(ch.group);
    if (!base || ZAP_EXCLUDE.test(base) || (ZAP_EXCLUDE.test(group) && !ZAP_KEEP.test(base))) return;
    const r = RULES.findIndex((rule) => rule.test(base, group));
    const key = channelKey(base);
    if (r < 0) return others.push({ key, ch, order });
    const e = byBase.get(key);
    if (e) {
      e.rule = Math.min(e.rule, r); // a mesma emissora em vários grupos entra uma vez só
      e.candidates.push({ ch, order });
    } else byBase.set(key, { base, rule: r, candidates: [{ ch, order }] });
  });
  // Versões do mesmo canal que estão em outro grupo da fonte (ex.: "GNT 4K" no grupo 4K,
  // enquanto o GNT entrou pelo grupo Variedades) viram opções desse canal — sem criar canais novos.
  for (const o of others) byBase.get(o.key)?.candidates.push({ ch: o.ch, order: o.order });
  for (const e of byBase.values())
    e.candidates = e.candidates.sort((a, b) => preferNum(a.ch) - preferNum(b.ch) || qualityRank(a.ch.name) - qualityRank(b.ch.name) || a.order - b.order).map((x) => x.ch);

  const out = [];
  RULES.forEach((rule, i) => {
    const list = [...byBase.values()].filter((e) => e.rule === i).sort((a, b) => natural(a.base, b.base));
    if (!list.length) return;
    if (rule.all) out.push(...list);
    else {
      const pref = (e) => (rule.prefer?.test(e.base) ? 0 : 1);
      list.sort((a, b) => pref(a) - pref(b) || qualityRank(a.candidates[0].name) - qualityRank(b.candidates[0].name) || a.base.length - b.base.length);
      // Um canal só na lista, mas as outras versões que casaram com a regra (ex.: "Globo NSC Floripa
      // FHD" para a Globo SC) ficam de reserva, depois das versões do canal escolhido.
      const [best, ...rest] = list;
      out.push({ ...best, candidates: [...best.candidates, ...rest.flatMap((e) => e.candidates)] });
    }
  });
  return out.map((e) => ({ key: e.base, label: RULES[e.rule].label, section: RULES[e.rule].section, region: !!RULES[e.rule].region, candidates: e.candidates }));
}

// health: { [idDoCanal]: { ok: boolean } }. Usa a melhor versão que funciona; enquanto a
// validação não termina, usa a melhor versão ainda não reprovada. Canal sem nenhuma versão no ar sai.
export function pickWorking(candidates, health = {}) {
  return candidates.find((c) => health[c.id]?.ok === true) || candidates.find((c) => health[c.id]?.ok !== false) || null;
}

export function curatedChannels(live, health = {}, uf) {
  return zapGroups(live, uf)
    .map((g) => pickWorking(g.candidates, health))
    .filter(Boolean);
}
