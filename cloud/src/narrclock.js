// Relógio da partida lido por IA (Workers AI, ligação "AI") em dois quadros tirados no mesmo instante:
// o vídeo do jogo e a live do narrador. O app usa a diferença para sincronizar a narração com o jogo.
export const CLOCK_MAX = 350_000; // base64 por imagem (~260 KB de JPEG; quadro inteiro de 960 px tem ~60-150 KB)
export const CLOCK_PER_DAY = 300; // leituras por conta a cada 24 h
// Modelo principal e reserva, escolhidos por acerto e tempo em 24 quadros reais de transmissões e lives
// (Mistral: 24/24 em 960 px, ~1 s; Llama 4 Scout: 23/24, ~2,7 s). Abaixo de ~900 px de largura o relógio
// fica pequeno demais e os modelos passam a inventar números: o app deve mandar 960 px ou mais.
export const CLOCK_MODELS = ['@cf/mistralai/mistral-small-3.1-24b-instruct', '@cf/meta/llama-4-scout-17b-16e-instruct'];

export const CLOCK_PROMPT =
  'This is a frame from a soccer broadcast or a live stream about a soccer match. Find the MATCH CLOCK: the running game timer on the scoreboard graphic ' +
  '(e.g. "23:41", usually next to the team names and score, sometimes with 1T/2T, 1º/2º, 1st/2nd or "+N" added time). ' +
  'Ignore: time of day, countdowns ("ao vivo em", "começa em", "a bola rola em", any h:mm:ss timer), kickoff times like 20:00 or 21h30, ' +
  'video player time, and goal minutes like 40\'. ' +
  'Answer ONLY with JSON: {"clock":"MM:SS","half":null,"extra":null}. half is 1 or 2 only if the graphic shows it (1T/2T, 1º/2º, 1st/2nd), else null. ' +
  'extra is the "+N" added minutes shown next to the clock, else null. ' +
  'If there is no running match clock, answer {"clock":null,"half":null,"extra":null}.';

const NONE = { clock: null, seconds: null, half: null, extra: null, elapsed: null, confidence: 0 };
const pad = (n) => String(n).padStart(2, '0');
const toHalf = (h) => {
  const m = /([12])/.exec(String(h ?? ''));
  return m ? +m[1] : null;
};

// Converte a resposta do modelo em relógio. Aceita JSON (mesmo cercado de texto/markdown) e, se não houver,
// procura MM:SS no texto (confiança menor). "45:00 +2" → 45:00 com extra 2; "90+3" (só minutos) → 93:00.
export function parseClock(text) {
  const raw = String(text ?? '').trim();
  let j = null;
  const m = /\{[\s\S]*?\}/.exec(raw);
  if (m) {
    try {
      j = JSON.parse(m[0].replace(/'/g, '"'));
    } catch {}
  }
  let conf = 0.9;
  let clock = j && 'clock' in j ? j.clock : undefined;
  let half = j ? toHalf(j.half) : null;
  let extra = j && j.extra != null && /^\+?\d{1,2}$/.test(String(j.extra).trim()) ? +String(j.extra).replace('+', '') : null;
  if (clock === undefined) {
    // Fora do formato: aproveita o primeiro MM:SS do texto.
    if (/\bnull\b|no (match )?clock|not visible|none/i.test(raw) && !/\d{1,3}:\d{2}/.test(raw)) return { ...NONE };
    clock = raw;
    conf = 0.6;
    half = toHalf((/\b([12])\s*(?:º|°|ª|t\b|st\b|nd\b|half|tempo)/i.exec(raw) || [])[1]);
  }
  if (clock == null || clock === '' || /^null$/i.test(String(clock))) return { ...NONE };
  const s = String(clock).trim();
  let mm, ss;
  let c = /(\d{1,3})\s*[:.'’]\s*(\d{2})(?!\d)/.exec(s);
  if (c) {
    mm = +c[1];
    ss = +c[2];
    const plus = /\+\s*(\d{1,2})/.exec(s.slice(c.index + c[0].length));
    if (plus && extra == null) extra = +plus[1];
  } else if ((c = /^(\d{2,3})\s*'?\s*\+\s*(\d{1,2})\s*'?$/.exec(s))) {
    // "90+3": minuto 93 (sem segundos)
    mm = +c[1] + +c[2];
    ss = 0;
    conf = Math.min(conf, 0.5);
  } else if ((c = /^(\d{1,3})\s*'?$/.exec(s))) {
    mm = +c[1];
    ss = 0;
    conf = Math.min(conf, 0.4);
  } else return { ...NONE };
  // Relógio de jogo vai de 0 a ~130 min (prorrogação com acréscimos); horas ("1:57:25") ficam de fora.
  if (mm > 130 || ss > 59 || /\d{1,2}:\d{2}:\d{2}/.test(s)) return { ...NONE };
  if (extra != null && (extra < 0 || extra > 30)) extra = null;
  // Acréscimo só aparece a partir dos 45 min: "00:53 +24" é contagem regressiva (0:53:24) lida pela metade.
  if (extra != null && mm < 45) return { ...NONE };
  const seconds = mm * 60 + ss;
  // Tempo desde o início do jogo: transmissões brasileiras zeram o relógio no 2º tempo ("2º 19:09" = 64:09)
  // e mostram o acréscimo do 2º tempo como "2T 45:14 +6".
  const elapsed = half === 2 && (mm < 45 || (mm < 90 && extra != null)) ? seconds + 45 * 60 : seconds;
  return { clock: `${pad(mm)}:${pad(ss)}`, seconds, half, extra, elapsed, confidence: conf };
}

// Entrada do modelo de visão: imagem (JPEG em base64) como data URL na mensagem, no formato de chat.
export function clockInput(model, b64) {
  const url = 'data:image/jpeg;base64,' + b64;
  if (/moondream/.test(model)) return { task: 'query', image: url, question: CLOCK_PROMPT };
  const input = {
    messages: [{ role: 'user', content: [{ type: 'text', text: CLOCK_PROMPT }, { type: 'image_url', image_url: { url } }] }],
    max_tokens: 60,
    temperature: 0,
  };
  // Modelos que "pensam" antes de responder: sem raciocínio (mais rápido e barato; a resposta é curta).
  if (/qwen|deepseek|inkling/.test(model)) input.chat_template_kwargs = { enable_thinking: false };
  return input;
}

// Chamada com tempo máximo: um modelo travado passa a vez para o reserva.
export const CLOCK_TIMEOUT = 15_000;
const run = (AI, model, input) =>
  new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('tempo esgotado')), CLOCK_TIMEOUT);
    AI.run(model, input).then(ok, fail).finally(() => clearTimeout(timer));
  });

// Pede ao modelo de visão o relógio de uma imagem.
async function ask(AI, model, b64) {
  const input = clockInput(model, b64);
  try {
    return await run(AI, model, input);
  } catch (e) {
    // Os modelos Llama 3.2 da Meta exigem aceitar a licença uma vez por conta (prompt "agree").
    if (!/'agree'|prompt "agree"/i.test(e?.message || '')) throw e;
    await AI.run(model, { prompt: 'agree' }).catch(() => {});
    return run(AI, model, input);
  }
}

// Texto da resposta (cada modelo devolve num formato: "response", estilo OpenAI ou "answer";
// às vezes a Workers AI já entrega o JSON da resposta como objeto).
export function textOf(r) {
  const v = typeof r === 'string' ? r : (r?.response ?? r?.choices?.[0]?.message?.content ?? r?.answer);
  return v && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
}

// Lê o relógio de uma imagem; se o modelo principal falhar, tenta o reserva.
export async function readClock(AI, b64, models = CLOCK_MODELS) {
  let err;
  for (const model of models) {
    try {
      const r = await ask(AI, model, b64);
      return { ...parseClock(textOf(r)), model };
    } catch (e) {
      err = e;
      console.warn('[relógio]', model, e?.message);
    }
  }
  throw err;
}

// Os dois quadros em paralelo. diff = quanto a narração está atrás do jogo, em segundos (negativo = à frente).
export async function readClocks(AI, game, narr) {
  const [g, n] = await Promise.all([readClock(AI, game), readClock(AI, narr)]);
  const diff = g.elapsed != null && n.elapsed != null ? g.elapsed - n.elapsed : null;
  const { model: gm, ...gameOut } = g;
  const { model: nm, ...narrOut } = n;
  return { game: gameOut, narr: narrOut, diff, model: gm === nm ? gm : `${gm},${nm}` };
}
