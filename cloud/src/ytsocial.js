// Comentários dos vídeos e chat das lives do YouTube nos apps.
// Leitura: API interna do site do YouTube (youtubei, a mesma de youtube.js), sem chave de API.
// Envio: em nome do assinante, com a conta do YouTube dele (OAuth do Google; a entrada é por QR code
// na TV, no navegador do celular) pela YouTube Data API v3. O refresh token fica só no D1, cifrado,
// e nunca sai do servidor.
//   GET  /api/v1/yt/comments?v=ID[&sort=top|new][&next=T] -> { ok, count, comments, next } (ou disabled)
//   GET  /api/v1/yt/replies?next=T                         -> { ok, comments, next }
//   GET  /api/v1/yt/chat?v=ID[&next=T]                     -> { ok, live, messages, next, pollMs, removed }
//   POST /api/v1/yt/account | login | login/status | comment | chat/send | logout  (token + deviceId)
//   GET  /api/v1/yt/oauth/start?s=SESSÃO | /api/v1/yt/oauth/callback  (páginas do celular)
import { CONTEXT } from './youtube.js';
import { evaluate, readToken } from './license.js';

const YTI = 'https://www.youtube.com/youtubei/v1/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const VIDEO_ID = /^[\w-]{11}$/;

const json = (code, obj, headers = {}) =>
  new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

async function yti(ep, body) {
  const res = await fetch(YTI + ep + '?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept-Language': 'pt-BR', 'User-Agent': UA },
    body: JSON.stringify({ context: CONTEXT, ...body }),
  });
  if (!res.ok) throw Object.assign(new Error('YouTube HTTP ' + res.status), { http: res.status });
  return res.json();
}

// ---------- Leitura: comentários ----------
const emoji = (e) => (!e ? '' : e.isCustomEmoji ? e.shortcuts?.[0] || '' : e.emojiId || e.shortcuts?.[0] || '');
const runs = (t) => (t?.simpleText ?? (t?.runs || []).map((r) => r.text ?? emoji(r.emoji)).join('')) || '';
const thumb = (list) => {
  const u = (Array.isArray(list) && list.at(-1)?.url) || '';
  return u.startsWith('//') ? 'https:' + u : u;
};
// Primeira continuação dentro de um pedaço da resposta.
const tokenIn = (o) => (o ? JSON.stringify(o).match(/"token":"([^"]+)"/)?.[1] || null : null);
function find(o, pred, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 14) return null;
  if (pred(o)) return o;
  for (const k in o) {
    const r = find(o[k], pred, depth + 1);
    if (r) return r;
  }
  return null;
}
// "16" -> 16, "1,2 mil" -> 1200, "3 mi" -> 3000000
export function countNum(s) {
  const m = String(s || '').match(/([\d.,]+)\s*(mil|mi|bi|k|m|b)?/i);
  if (!m) return 0;
  const mult = { mil: 1e3, k: 1e3, mi: 1e6, m: 1e6, bi: 1e9, b: 1e9 }[(m[2] || '').toLowerCase()] || 1;
  const n = mult === 1 ? Number(m[1].replace(/[.,]/g, '')) : Number(m[1].replace(/\./g, '').replace(',', '.'));
  return Math.round(n * mult) || 0;
}

// Formato atual: dados em frameworkUpdates (commentEntityPayload), ligados pelo commentViewModel.
const fromEntity = (e, state) => {
  const p = e.properties || {};
  const a = e.author || {};
  const t = e.toolbar || {};
  return {
    id: p.commentId || '',
    author: a.displayName || '',
    avatar: a.avatarThumbnailUrl || '',
    text: p.content?.content || '',
    likes: String(t.likeCountNotliked || '').trim() || '0',
    when: p.publishedTime || '',
    replies: countNum(t.replyCount),
    repliesNext: null,
    owner: !!a.isCreator,
    hearted: state?.heartState === 'TOOLBAR_HEART_STATE_HEARTED',
    verified: !!a.isVerified,
  };
};
// Formato antigo (commentRenderer).
const fromRenderer = (r) => ({
  id: r.commentId || '',
  author: runs(r.authorText),
  avatar: thumb(r.authorThumbnail?.thumbnails),
  text: runs(r.contentText),
  likes: runs(r.voteCount).trim() || '0',
  when: runs(r.publishedTimeText),
  replies: Number(r.replyCount) || 0,
  repliesNext: null,
  owner: !!r.authorIsChannelOwner,
  hearted: !!r.actionButtons?.commentActionButtonsRenderer?.creatorHeart?.creatorHeartRenderer?.isHearted,
  verified: !!r.authorCommentBadge,
});

export function parseComments(data) {
  const ents = {};
  const states = {};
  for (const m of data?.frameworkUpdates?.entityBatchUpdate?.mutations || []) {
    const p = m.payload || {};
    if (p.commentEntityPayload) ents[m.entityKey] = p.commentEntityPayload;
    if (p.engagementToolbarStateEntityPayload) states[m.entityKey] = p.engagementToolbarStateEntityPayload;
  }
  const one = (vm, old) => {
    if (vm?.commentKey) {
      const e = ents[vm.commentKey];
      return e ? fromEntity(e, states[vm.toolbarStateKey] || states[e.properties?.toolbarStateKey]) : null;
    }
    return old ? fromRenderer(old) : null;
  };
  const items = (data?.onResponseReceivedEndpoints || []).flatMap((e) => (e.reloadContinuationItemsCommand || e.appendContinuationItemsAction)?.continuationItems || []);
  const comments = [];
  let next = null;
  let count = null;
  for (const it of items) {
    if (it.commentThreadRenderer) {
      const t = it.commentThreadRenderer;
      const c = one(t.commentViewModel?.commentViewModel, t.comment?.commentRenderer);
      if (!c) continue;
      c.repliesNext = tokenIn(t.replies);
      if (!c.replies && c.repliesNext) c.replies = countNum(runs(t.replies?.commentRepliesRenderer?.viewReplies?.buttonRenderer?.text));
      if (!c.replies) c.repliesNext = null;
      comments.push(c);
    } else if (it.commentViewModel || it.commentRenderer) {
      const c = one(it.commentViewModel, it.commentRenderer);
      if (c) comments.push(c);
    } else if (it.continuationItemRenderer) next ||= tokenIn(it.continuationItemRenderer);
    else if (it.commentsHeaderRenderer) count = runs(it.commentsHeaderRenderer.countText).replace(/\s*coment.*$/i, '').trim() || null;
  }
  return { count, comments: comments.filter((c) => c.id), next };
}

export async function commentsPage(v, sort = 'top', next = '') {
  if (next) return parseComments(await yti('next', { continuation: next }));
  const d = await yti('next', { videoId: v });
  const panel = (d.engagementPanels || []).map((x) => x.engagementPanelSectionListRenderer).find((x) => x?.panelIdentifier === 'engagement-panel-comments-section');
  const head = panel?.header?.engagementPanelTitleHeaderRenderer;
  const sorts = head?.menu?.sortFilterSubMenuRenderer?.subMenuItems || [];
  const section = find(d.contents, (o) => o.itemSectionRenderer?.sectionIdentifier === 'comment-item-section')?.itemSectionRenderer;
  // "Mais recentes" é o 2.º item do menu de ordenação; sem ele, vale a ordem padrão.
  const token = (sort === 'new' && tokenIn(sorts[1]?.serviceEndpoint)) || tokenIn(sorts[0]?.serviceEndpoint) || tokenIn(panel?.content) || tokenIn(section);
  if (!token) return { disabled: !!section, count: null, comments: [], next: null };
  const page = parseComments(await yti('next', { continuation: token }));
  return { ...page, count: runs(head?.contextualInfo).trim() || page.count || null };
}

// ---------- Leitura: chat ao vivo ----------
const BADGE = { OWNER: 'owner', MODERATOR: 'moderator', VERIFIED: 'verified' };
function chatItem(it) {
  const member = it.liveChatMembershipItemRenderer;
  const r = it.liveChatTextMessageRenderer || it.liveChatPaidMessageRenderer || it.liveChatPaidStickerRenderer || member;
  if (!r?.id) return null;
  const badges = [];
  for (const b of r.authorBadges || []) {
    const x = b.liveChatAuthorBadgeRenderer || {};
    const k = x.customThumbnail ? 'member' : BADGE[x.icon?.iconType];
    if (k && !badges.includes(k)) badges.push(k);
  }
  if (member && !badges.includes('member')) badges.push('member');
  const text = runs(r.message) || (member ? runs(r.headerSubtext) || runs(r.headerPrimaryText) : '');
  const amount = runs(r.purchaseAmountText) || null;
  if (!text && !amount) return null;
  return { id: r.id, author: runs(r.authorName), avatar: thumb(r.authorPhoto?.thumbnails), text, when: Math.round(Number(r.timestampUsec) / 1000) || Date.now(), badges, amount };
}

export function parseChat(lc) {
  const messages = [];
  const removed = [];
  for (const a of lc?.actions || []) {
    const it = a.addChatItemAction?.item;
    const m = it && chatItem(it);
    if (m) messages.push(m);
    const gone = a.removeChatItemAction?.targetItemId || a.markChatItemAsDeletedAction?.targetItemId;
    if (gone) removed.push(gone);
  }
  // Reprise de live encerrada (liveChatReplayContinuationData) não conta como ao vivo.
  const c = lc?.continuations?.[0] || {};
  const cont = c.invalidationContinuationData || c.timedContinuationData || c.reloadContinuationData;
  if (!cont?.continuation) return { live: false, messages, next: null, pollMs: 0, removed };
  const pollMs = c.timedContinuationData ? Math.min(15000, Math.max(2000, Number(cont.timeoutMs) || 5000)) : 5000;
  return { live: true, messages, next: cont.continuation, pollMs, removed };
}

function initialData(html) {
  const m = html.match(/(?:window\["ytInitialData"\]|var ytInitialData)\s*=\s*/);
  if (!m) return null;
  const i = m.index + m[0].length;
  try {
    return JSON.parse(html.slice(i, html.indexOf(';</script>', i)));
  } catch {
    return null;
  }
}

const OFF = { live: false, messages: [], next: null, pollMs: 0, removed: [] };
export async function chatPage(v, next = '') {
  if (next) {
    let d;
    try {
      d = await yti('live_chat/get_live_chat', { continuation: next });
    } catch (e) {
      if (e.http === 400 || e.http === 404) return OFF; // continuação vencida ou chat encerrado
      throw e;
    }
    return d?.continuationContents?.liveChatContinuation ? parseChat(d.continuationContents.liveChatContinuation) : OFF;
  }
  const res = await fetch(`https://www.youtube.com/live_chat?v=${v}&is_popout=1&hl=pt-BR`, { headers: { 'Accept-Language': 'pt-BR,pt;q=0.9', 'User-Agent': UA } });
  if (!res.ok) throw new Error('YouTube HTTP ' + res.status);
  const d = initialData(await res.text());
  if (d) return d.contents?.liveChatRenderer ? parseChat(d.contents.liveChatRenderer) : OFF; // messageRenderer = sem chat
  // Página mudou de formato: pega a continuação do chat pela API (barra de conversa do vídeo).
  const w = await yti('next', { videoId: v });
  const tok = w.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer?.continuations?.[0]?.reloadContinuationData?.continuation;
  return tok ? chatPage(v, tok) : OFF;
}

// Limite simples em memória para as consultas repetidas do chat (a cada ~5 s por espectador):
// contar no D1 custaria uma gravação e uma leitura grande por consulta.
const mem = new Map();
function memLimited(k, max, windowMs) {
  const now = Date.now();
  let e = mem.get(k);
  if (!e || now - e.start > windowMs) {
    if (mem.size > 5000) mem.clear();
    e = { start: now, n: 0 };
    mem.set(k, e);
  }
  return ++e.n > max;
}

// ---------- Envio: conta do YouTube do assinante ----------
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';
const YT_API = 'https://www.googleapis.com/youtube/v3/';
const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const LOGIN_MS = 10 * 60e3; // validade do QR code de entrada
export const COMMENT_MAX = 1000;
export const CHAT_MAX = 200;
export const COMMENTS_PER_HOUR = 30;
export const CHAT_PER_10MIN = 60;

export const ytConfigured = (env) => !!(String(env.GOOGLE_CLIENT_ID || '').trim() && String(env.GOOGLE_CLIENT_SECRET || '').trim());

export const YT_MESSAGES = {
  yt_off: 'Comentar pelo app ainda não está disponível.',
  not_linked: 'Entre com a sua conta do YouTube para comentar.',
  no_channel: 'Sua conta do Google ainda não tem um canal do YouTube. Crie um canal (é grátis) em youtube.com e entre de novo.',
  comments_disabled: 'Os comentários estão desativados ou restritos neste vídeo.',
  chat_closed: 'O chat desta transmissão não está aberto para mensagens agora.',
  rate_limited: 'Você enviou muitas mensagens. Aguarde um pouco e tente de novo.',
  quota: 'O limite diário de envios ao YouTube foi atingido. Tente de novo amanhã.',
  bad_request: 'Dados incompletos.',
  invalid_token: 'Licença inválida. Entre novamente.',
  not_active: 'Comentar fica disponível com a assinatura em dia.',
  unavailable: 'O YouTube não respondeu agora. Tente de novo em instantes.',
};
const HTTP = { yt_off: 503, not_linked: 403, no_channel: 403, comments_disabled: 403, chat_closed: 409, rate_limited: 429, quota: 429, bad_request: 400, invalid_token: 401, not_active: 403, unavailable: 503 };
const fail = (error, message) => json(HTTP[error] || 400, { ok: false, error, message: message || YT_MESSAGES[error] || error });

// Tokens do Google cifrados no D1 (AES-GCM, chave derivada da chave das licenças).
const enc = new TextEncoder();
const b64 = (u8) => btoa(String.fromCharCode(...u8));
async function aesKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('gates-yt:' + (env.LICENSE_PRIVATE_JWK || env.GOOGLE_CLIENT_SECRET || '')));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, s) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(s)));
  return b64(iv) + '.' + b64(ct);
}
async function unseal(env, s) {
  try {
    const [iv, ct] = String(s || '').split('.').map((x) => Uint8Array.from(atob(x), (c) => c.charCodeAt(0)));
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aesKey(env), ct));
  } catch {
    return null;
  }
}

function links(D1) {
  const now = () => Date.now();
  return {
    get: (email) => D1.prepare('SELECT * FROM ytlinks WHERE email = ?').bind(email).first(),
    put: (email, refresh, access, exp, channel) =>
      D1.prepare(
        'INSERT INTO ytlinks (email, refresh, access, access_exp, channel, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET refresh = excluded.refresh, access = excluded.access, access_exp = excluded.access_exp, channel = excluded.channel, updated_at = excluded.updated_at'
      )
        .bind(email, refresh, access, exp, JSON.stringify(channel), now())
        .run(),
    setAccess: (email, access, exp) => D1.prepare('UPDATE ytlinks SET access = ?, access_exp = ?, updated_at = ? WHERE email = ?').bind(access, exp, now(), email).run(),
    del: (email) => D1.prepare('DELETE FROM ytlinks WHERE email = ?').bind(email).run(),
    session: (id) => D1.prepare('SELECT * FROM ytlogins WHERE id = ? AND expires_at > ?').bind(id, now()).first(),
    newSession: async (id, email) => {
      await D1.prepare('INSERT INTO ytlogins (id, email, status, expires_at) VALUES (?, ?, ?, ?)').bind(id, email, 'pending', now() + LOGIN_MS).run();
      if (Math.random() < 0.05) await D1.prepare('DELETE FROM ytlogins WHERE expires_at < ?').bind(now() - 3600e3).run();
    },
    setSession: (id, status) => D1.prepare('UPDATE ytlogins SET status = ? WHERE id = ?').bind(status, id).run(),
  };
}
const channelOf = (row) => {
  try {
    const c = JSON.parse(row.channel);
    return { name: c.name || '', avatar: c.avatar || '' };
  } catch {
    return null;
  }
};

async function googleToken(env, params) {
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID.trim(), client_secret: env.GOOGLE_CLIENT_SECRET.trim(), ...params }),
  });
  return { http: res.status, ...(await res.json().catch(() => ({}))) };
}
const revoke = (token) =>
  fetch(GOOGLE_REVOKE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) }).catch(() => null);

async function ytApi(token, method, path, body) {
  const res = await fetch(YT_API + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { http: res.status, data: await res.json().catch(() => ({})) };
}

// Access token válido da conta (renova pelo refresh token quando faltar menos de 1 min).
async function accessToken(env, st, email, force = false) {
  const row = await st.get(email);
  if (!row) return { error: 'not_linked' };
  if (!force && row.access && row.access_exp > Date.now() + 60e3) {
    const a = await unseal(env, row.access);
    if (a) return { token: a };
  }
  const refresh = await unseal(env, row.refresh);
  if (!refresh) {
    await st.del(email);
    return { error: 'not_linked' };
  }
  const t = await googleToken(env, { grant_type: 'refresh_token', refresh_token: refresh });
  // Acesso removido pelo usuário (myaccount.google.com) ou token vencido: desliga a conta.
  if (t.error === 'invalid_grant') {
    await st.del(email);
    return { error: 'not_linked' };
  }
  if (!t.access_token) throw new Error('Google token HTTP ' + t.http + ' ' + (t.error || ''));
  await st.setAccess(email, await seal(env, t.access_token), Date.now() + (Number(t.expires_in) || 3600) * 1000);
  return { token: t.access_token };
}

// Chama a API do YouTube com o token da conta; com 401, renova o token e tenta uma vez mais.
async function asUser(env, st, email, method, path, body) {
  let a = await accessToken(env, st, email);
  if (a.error) return a;
  let r = await ytApi(a.token, method, path, body);
  if (r.http === 401) {
    a = await accessToken(env, st, email, true);
    if (a.error) return a;
    r = await ytApi(a.token, method, path, body);
    if (r.http === 401) return { error: 'not_linked' };
  }
  return r;
}

// Erro da API do YouTube -> código do app.
function apiError(r, kind) {
  const e = r.data?.error || {};
  const reasons = (e.errors || []).map((x) => x.reason).concat((e.details || []).map((x) => x.reason));
  const has = (...l) => l.some((x) => reasons.includes(x));
  if (has('quotaExceeded', 'dailyLimitExceeded')) return 'quota';
  if (has('rateLimitExceeded', 'userRateLimitExceeded')) return 'rate_limited';
  if (has('ineligibleAccount', 'youtubeSignupRequired', 'channelNotFound', 'NO_CHANNEL')) return 'no_channel';
  if (has('commentsDisabled')) return 'comments_disabled';
  if (has('liveChatEnded', 'liveChatDisabled', 'liveChatNotFound', 'liveChatClosed')) return 'chat_closed';
  if (r.http === 403) return kind === 'chat' ? 'chat_closed' : 'comments_disabled';
  if (r.http === 400 || r.http === 404) return 'bad_request';
  return 'unavailable';
}
const apiFail = (r, kind) => {
  const error = apiError(r, kind);
  if (error === 'unavailable') console.warn('[yt envio]', r.http, JSON.stringify(r.data?.error || {}).slice(0, 300));
  if (error === 'bad_request') return fail(error, r.http === 404 ? 'Vídeo ou comentário não encontrado no YouTube.' : 'O YouTube recusou o texto. Revise e tente de novo.');
  if (error === 'chat_closed' && r.http === 403 && !r.data?.error?.errors?.some((x) => /liveChat/.test(x.reason)))
    return fail(error, 'O chat não aceita mensagens suas agora (pode ser só para membros ou inscritos, ou você foi bloqueado pelo canal).');
  return fail(error);
};

// Comentário devolvido pela Data API -> mesmo formato da leitura.
function fromApi(item, parentChannel) {
  const top = item.snippet?.topLevelComment;
  const s = top?.snippet || item.snippet || {};
  const owner = item.snippet?.channelId || s.channelId || parentChannel || '';
  return {
    id: top?.id || item.id || '',
    author: s.authorDisplayName || '',
    avatar: s.authorProfileImageUrl || '',
    text: s.textOriginal ?? s.textDisplay ?? '',
    likes: '0',
    when: 'agora',
    replies: 0,
    repliesNext: null,
    owner: !!owner && s.authorChannelId?.value === owner,
    hearted: false,
    verified: false,
  };
}

// ID do chat ativo de cada live (videos.list custa 1 unidade; guardado 5 min por instância).
const chatIds = new Map();

// Texto: sem espaços nas pontas e até "max" caracteres; chat em uma linha só.
const cleanText = (s, max, oneLine) => {
  let t = String(s ?? '').replace(/\r\n?/g, '\n');
  t = (oneLine ? t.replace(/\s+/g, ' ') : t.replace(/\n{4,}/g, '\n\n\n')).trim();
  return t && [...t].length <= max ? t : null;
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Página simples mostrada no celular depois da entrada no Google.
function page(cfg, { ok, title, text, avatar }) {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · ${esc(cfg.brand)}</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:radial-gradient(circle at 30% 0,#2a1438,#0d0d14 70%);color:#f2f2f7}
.card{width:100%;max-width:420px;background:#17171f;border:1px solid #2c2c3a;border-radius:20px;padding:32px 24px;text-align:center;box-shadow:0 20px 60px #0008}
.icon{width:72px;height:72px;margin:0 auto 18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:38px;background:${ok ? '#1f7a4a' : '#7a2a2a'}}
.avatar{width:72px;height:72px;margin:0 auto 18px;border-radius:50%;object-fit:cover;border:3px solid #1f7a4a}
h1{font-size:24px;margin:0 0 10px}p{font-size:16px;line-height:1.5;color:#c4c4d0;margin:0 0 8px}.brand{margin-top:22px;font-size:13px;color:#77778a;letter-spacing:.04em}
a{color:#ff6b6b}</style></head><body><main class="card">
${avatar ? `<img class="avatar" src="${esc(avatar)}" alt="" referrerpolicy="no-referrer">` : `<div class="icon">${ok ? '✓' : '!'}</div>`}
<h1>${esc(title)}</h1>${text.map((t) => `<p>${t}</p>`).join('')}<div class="brand">${esc(cfg.brand)}</div></main></body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' } });
}
const expiredPage = (cfg) => page(cfg, { ok: false, title: 'O código expirou', text: ['Gere um novo QR code na TV (Entrar com o YouTube) e leia de novo com o celular.'] });

const randomId = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);

// Desliga a conta do YouTube de um assinante (sair no app ou exclusão do cadastro).
export async function ytForget(env, email) {
  const st = links(env.DB);
  const row = await st.get(email).catch(() => null);
  if (!row) return;
  const refresh = await unseal(env, row.refresh);
  if (refresh) await revoke(refresh);
  await st.del(email);
}

// Rotas /api/v1/yt/* desta parte (null = não é daqui). "db" é o de db.js (limite de tentativas).
export async function ytSocialRoute({ req, env, cfg, db, url, p, b, ip }) {
  if (!p.startsWith('/api/v1/yt/') || p === '/api/v1/yt/videos') return null;
  const q = (k) => url.searchParams.get(k) || '';

  // ----- Leitura (pública) -----
  if (req.method === 'GET' && (p === '/api/v1/yt/comments' || p === '/api/v1/yt/replies')) {
    const v = q('v');
    const next = q('next');
    const sort = q('sort') === 'new' ? 'new' : 'top';
    if (next.length > 6000 || (p === '/api/v1/yt/comments' ? !VIDEO_ID.test(v) && !next : !next)) return fail('bad_request');
    if (await db.limited('ytcm:' + ip, 600, 3600e3)) return fail('rate_limited', 'Muitas consultas. Aguarde alguns minutos.');
    try {
      const r = await commentsPage(v, sort, next);
      const out = p === '/api/v1/yt/replies' ? { ok: true, comments: r.comments, next: r.next } : { ok: true, count: r.count, ...(r.disabled ? { disabled: true } : {}), comments: r.comments, next: r.next };
      return json(200, out, { 'Cache-Control': 'public, max-age=120' });
    } catch (e) {
      console.warn('[yt comentários]', v, e.message);
      return fail('unavailable', 'Não foi possível carregar os comentários agora.');
    }
  }
  if (req.method === 'GET' && p === '/api/v1/yt/chat') {
    const v = q('v');
    const next = q('next');
    if (!VIDEO_ID.test(v) || next.length > 6000) return fail('bad_request');
    // Abrir o chat conta no D1; as consultas seguintes (a cada ~5 s) só em memória.
    if (next ? memLimited('chat:' + ip, 1500, 10 * 60e3) : await db.limited('ytchat:' + ip, 240, 3600e3)) return fail('rate_limited', 'Muitas consultas ao chat. Aguarde alguns minutos.');
    try {
      return json(200, { ok: true, ...(await chatPage(v, next)) });
    } catch (e) {
      console.warn('[yt chat]', v, e.message);
      return fail('unavailable', 'Não foi possível carregar o chat agora.');
    }
  }

  // ----- Entrada no Google (páginas abertas no celular pelo QR code) -----
  const redirectUri = cfg.publicUrl + '/api/v1/yt/oauth/callback';
  if (req.method === 'GET' && p === '/api/v1/yt/oauth/start') {
    if (!ytConfigured(env)) return page(cfg, { ok: false, title: 'Indisponível', text: [YT_MESSAGES.yt_off] });
    const st = links(env.DB);
    const s = q('s');
    const sess = /^[\w-]{20,64}$/.test(s) && (await st.session(s));
    if (!sess || !['pending', 'opened'].includes(sess.status)) return expiredPage(cfg);
    await st.setSession(s, 'opened');
    const go = new URL(GOOGLE_AUTH);
    for (const [k, val] of Object.entries({ client_id: env.GOOGLE_CLIENT_ID.trim(), redirect_uri: redirectUri, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', state: s }))
      go.searchParams.set(k, val);
    return new Response(null, { status: 302, headers: { Location: go.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  }
  if (req.method === 'GET' && p === '/api/v1/yt/oauth/callback') {
    if (!ytConfigured(env)) return page(cfg, { ok: false, title: 'Indisponível', text: [YT_MESSAGES.yt_off] });
    const st = links(env.DB);
    const s = q('state');
    const sess = /^[\w-]{20,64}$/.test(s) && (await st.session(s));
    if (!sess || !['pending', 'opened'].includes(sess.status)) return expiredPage(cfg);
    if (q('error') || !q('code')) {
      await st.setSession(s, 'denied');
      return page(cfg, { ok: false, title: 'Entrada cancelada', text: ['Você não autorizou o acesso ao YouTube. Para comentar pelo app, gere um novo QR code na TV e toque em <b>Permitir</b>.'] });
    }
    const t = await googleToken(env, { grant_type: 'authorization_code', code: q('code'), redirect_uri: redirectUri });
    const errPage = () => page(cfg, { ok: false, title: 'Não deu certo', text: ['Não foi possível entrar com a sua conta agora. Gere um novo QR code na TV e tente de novo.'] });
    if (!t.access_token) {
      console.warn('[yt oauth]', t.http, t.error);
      await st.setSession(s, 'error');
      return errPage();
    }
    if (!String(t.scope || '').includes('youtube.force-ssl')) {
      await revoke(t.access_token);
      await st.setSession(s, 'denied');
      return page(cfg, { ok: false, title: 'Falta uma permissão', text: ['Para comentar pelo app, é preciso marcar a permissão de <b>gerenciar sua conta do YouTube</b>. Gere um novo QR code na TV e tente de novo.'] });
    }
    const ch = await ytApi(t.access_token, 'GET', 'channels?part=snippet&mine=true');
    const item = ch.data?.items?.[0];
    if (ch.http !== 200 || !item) {
      await revoke(t.refresh_token || t.access_token);
      await st.setSession(s, ch.http === 200 || ch.http === 403 ? 'no_channel' : 'error');
      if (ch.http !== 200 && ch.http !== 403) return errPage();
      return page(cfg, {
        ok: false,
        title: 'Falta criar o seu canal',
        text: [
          'Para comentar no YouTube, a sua conta do Google precisa ter um canal (é grátis e leva um minuto).',
          'Abra <a href="https://www.youtube.com/create_channel">youtube.com/create_channel</a>, crie o canal e depois gere um novo QR code na TV.',
        ],
      });
    }
    if (!t.refresh_token) {
      await revoke(t.access_token);
      await st.setSession(s, 'error');
      return errPage();
    }
    const channel = { id: item.id, name: item.snippet?.title || '', avatar: item.snippet?.thumbnails?.default?.url || item.snippet?.thumbnails?.medium?.url || '' };
    // Entrou de novo: só substitui (revogar o token antigo derrubaria também o novo se for a mesma conta do Google).
    await st.put(sess.email, await seal(env, t.refresh_token), await seal(env, t.access_token), Date.now() + (Number(t.expires_in) || 3600) * 1000, channel);
    await st.setSession(s, 'done');
    return page(cfg, { ok: true, title: 'Pronto! Volte para a TV', text: [`Você entrou como <b>${esc(channel.name)}</b>.`, 'Já dá para comentar e mandar mensagens no chat pelo app. Pode fechar esta página.'], avatar: channel.avatar });
  }

  // ----- Envio (assinante com aparelho ativado) -----
  if (req.method !== 'POST') return null;
  const configured = ytConfigured(env);
  if (p === '/api/v1/yt/account' && !configured) return json(200, { ok: true, configured: false, linked: false, channel: null });
  if (!configured) return fail('yt_off');
  const t = await readToken(b.token, cfg);
  if (!t || (b.deviceId && b.deviceId !== t.did)) return fail('invalid_token');
  if (await db.limited('yts:' + t.did, 600, 15 * 60e3)) return fail('rate_limited', 'Muitas tentativas. Aguarde alguns minutos.');
  const c = await db.get(t.email);
  if (!c?.devices?.[t.did]) return fail('invalid_token');
  const status = evaluate(c, cfg).status;
  if (status !== 'active' && status !== 'grace') return fail('not_active');
  const email = c.email;
  const st = links(env.DB);
  const linkState = async () => {
    const row = await st.get(email);
    return { linked: !!row, channel: row ? channelOf(row) : null };
  };

  if (p === '/api/v1/yt/account') return json(200, { ok: true, configured: true, ...(await linkState()) });
  if (p === '/api/v1/yt/login') {
    if (await db.limited('ytlogin:' + email, 20, 3600e3)) return fail('rate_limited', 'Muitas tentativas de entrar. Aguarde alguns minutos.');
    const session = randomId();
    await st.newSession(session, email);
    return json(200, { ok: true, session, url: `${cfg.publicUrl}/api/v1/yt/oauth/start?s=${session}`, expiresIn: LOGIN_MS / 1000 });
  }
  if (p === '/api/v1/yt/login/status') {
    const s = String(b.session || '');
    const sess = /^[\w-]{20,64}$/.test(s) ? await st.session(s) : null;
    // state: pending (esperando ler o QR), opened (no Google), done, no_channel, denied, error, expired.
    const state = sess && sess.email === email ? sess.status : 'expired';
    return json(200, { ok: true, ...(await linkState()), state });
  }
  if (p === '/api/v1/yt/logout') {
    await ytForget(env, email);
    return json(200, { ok: true });
  }
  if (p === '/api/v1/yt/comment' || p === '/api/v1/yt/chat/send') {
    const chat = p === '/api/v1/yt/chat/send';
    const v = String(b.v || '');
    const text = cleanText(b.text, chat ? CHAT_MAX : COMMENT_MAX, chat);
    if (!VIDEO_ID.test(v)) return fail('bad_request');
    if (!text) return fail('bad_request', chat ? `Escreva uma mensagem de até ${CHAT_MAX} caracteres.` : `Escreva um comentário de até ${COMMENT_MAX} caracteres.`);
    const parent = b.parent ? String(b.parent).split('.')[0] : ''; // respostas ficam todas no comentário principal
    if (!chat && b.parent && !/^[\w-]{10,100}$/.test(parent)) return fail('bad_request');
    if (!(await st.get(email))) return fail('not_linked');
    if (chat ? await db.limited('ytm:' + email, CHAT_PER_10MIN, 10 * 60e3) : await db.limited('ytc:' + email, COMMENTS_PER_HOUR, 3600e3)) return fail('rate_limited');
    try {
      if (!chat) {
        const r = parent
          ? await asUser(env, st, email, 'POST', 'comments?part=snippet', { snippet: { parentId: parent, textOriginal: text } })
          : await asUser(env, st, email, 'POST', 'commentThreads?part=snippet', { snippet: { videoId: v, topLevelComment: { snippet: { textOriginal: text } } } });
        if (r.error) return fail(r.error);
        if (r.http !== 200) return apiFail(r, 'comment');
        return json(200, { ok: true, comment: fromApi(r.data) });
      }
      let live = chatIds.get(v);
      if (!live || Date.now() - live.at > 5 * 60e3) {
        const r = await asUser(env, st, email, 'GET', `videos?part=liveStreamingDetails&id=${v}`);
        if (r.error) return fail(r.error);
        if (r.http !== 200) return apiFail(r, 'chat');
        const id = r.data?.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
        if (!id) return fail('chat_closed');
        chatIds.set(v, (live = { id, at: Date.now() }));
      }
      const r = await asUser(env, st, email, 'POST', 'liveChat/messages?part=snippet', { snippet: { liveChatId: live.id, type: 'textMessageEvent', textMessageDetails: { messageText: text } } });
      if (r.error) return fail(r.error);
      if (r.http !== 200) {
        if (r.http === 403 || r.http === 404) chatIds.delete(v);
        return apiFail(r, 'chat');
      }
      return json(200, { ok: true, id: r.data?.id || null });
    } catch (e) {
      console.warn('[yt envio]', e.message);
      return fail('unavailable');
    }
  }
  return null;
}
