// Painel de comentários e chat ao vivo do YouTube (lib/ytsocial.js), ao lado do vídeo (TV e computador)
// ou embaixo (celular em pé), sem parar o vídeo. Abas "Chat ao vivo" (quando é live) e "Comentários".
// Escrever usa a conta do YouTube ligada pelo celular (QR code); "Comentar pelo celular" abre o vídeo
// no app do YouTube. Na TV: tudo pelo controle; Voltar fecha (ou volta do cartão de login).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from './Icon';
import QrCode from './QrCode';
import { useStore } from '../store';
import { SMART_TV, isTouch } from '../lib/device';
import { focusEl, isTvMode, moveFocus, rememberFocus, useKeyHandler } from '../lib/keys';
import { setVoiceTarget, startVoice, voiceMode } from '../lib/voice';
import {
  CHAT_MAX, COMMENT_MAX, canWrite, clampPoll, fmtClock, fmtCount, getAccount, getChat, getComments, getReplies,
  loginStatus, logout, mergeChat, openExternal, postComment, sendChat, socialAllowed, startLogin, watchUrl,
} from '../lib/ytsocial';

const DIRS = ['up', 'down', 'left', 'right'];
const BADGES = { owner: 'Dono', moderator: 'Moderador', member: 'Membro', verified: '✓' };

// Foca o [data-autofocus] (ou o primeiro botão) dentro de 'root'. No toque não foca (o teclado abriria).
function focusFirst(root) {
  if (!root || isTouch) return;
  focusEl(root.querySelector('[data-autofocus]') || root.querySelector('button:not([disabled]), input, [tabindex="0"]'));
}

function Avatar({ src, name }) {
  const [bad, setBad] = useState(false);
  if (src && !bad) return <img className="yc-av" src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} />;
  return <span className="yc-av">{(String(name || '?').replace(/^@/, '')[0] || '?').toUpperCase()}</span>;
}

// Um comentário (ou resposta). O texto é um bloco focável e os botões ficam numa linha à parte,
// para o controle remoto passar por eles com ▲ ▼.
function CommentRow({ c, onReply, reply }) {
  return (
    <>
      <div className={`yc-item ${reply ? 'yc-reply' : ''}`} tabIndex={0}>
        <Avatar src={c.avatar} name={c.author} />
        <div className="yc-body">
          <div className="yc-meta">
            <strong className={c.owner ? 'yc-owner' : ''}>{c.author}</strong>
            {c.when && <small className="muted">{c.when}</small>}
          </div>
          <p className="yc-text">{c.text}</p>
          {(!!c.likes || c.hearted) && (
            <div className="yc-stats muted">
              {!!c.likes && String(c.likes) !== '0' && <span>{fmtCount(c.likes)} curtida{String(c.likes) === '1' ? '' : 's'}</span>}
              {c.hearted && (
                <span className="yc-heart" title="O criador do vídeo marcou com coração">
                  <Icon name="heart" size={12} filled /> do criador
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      {onReply && (
        <div className={`yc-actions ${reply ? 'yc-reply' : ''}`}>
          <button className="chip yc-act" onClick={() => onReply(c)}>
            Responder
          </button>
        </div>
      )}
    </>
  );
}

// Cartão de login: QR code do link do servidor; confere a cada 3 s até a conta ficar ligada.
function LoginCard({ onLinked, onFail, onPhone, onBack }) {
  const [s, setS] = useState({ loading: true }); // { url, until } | { expired } | { error }
  const [round, setRound] = useState(0);
  const ref = useRef(null);
  const cb = useRef({ onLinked, onFail });
  cb.current = { onLinked, onFail };
  useEffect(() => {
    let alive = true;
    let done = false;
    let busy = false;
    let timer = 0;
    let check = () => {};
    setS({ loading: true });
    startLogin()
      .then((r) => {
        if (!alive) return;
        const until = Date.now() + (Number(r.expiresIn) || 600) * 1000;
        setS({ url: r.url, until });
        const stop = (st) => {
          done = true;
          if (st) setS(st);
        };
        check = async () => {
          clearTimeout(timer);
          if (!alive || done || busy) return;
          if (Date.now() > until) return stop({ expired: true });
          busy = true;
          try {
            const st = await loginStatus(r.session);
            if (!alive) return;
            if (st.linked) {
              stop();
              return cb.current.onLinked(st.channel || null);
            }
          } catch (e) {
            if (!alive) return;
            // Sem internet: continua tentando. Outro erro (sessão vencida, conta sem canal…): para.
            if (e.code !== 'network') {
              if (e.code === 'bad_request') return stop({ expired: true });
              cb.current.onFail(e);
              return stop({ error: e.message });
            }
          } finally {
            busy = false;
          }
          timer = setTimeout(check, 3000);
        };
        timer = setTimeout(check, 3000);
      })
      .catch((e) => {
        if (!alive) return;
        cb.current.onFail(e);
        setS({ error: e.message });
      });
    // Voltando ao app (login feito no próprio celular): confere na hora.
    const onVis = () => !document.hidden && check();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [round]);
  useEffect(() => focusFirst(ref.current), [s.url, s.expired, s.error]);
  const tv = isTvMode();
  return (
    <div ref={ref} className="yc-card">
      <h3>Entre com sua conta do YouTube para comentar</h3>
      {s.loading && <span className="spinner" />}
      {s.url && (
        <>
          <p className="muted">
            {tv
              ? 'Aponte a câmera do celular para o código e entre com a sua conta Google. Depois é só voltar: o campo para escrever aparece sozinho.'
              : 'Abra o link ou aponte a câmera do celular para o código e entre com a sua conta Google.'}
          </p>
          <div className="yc-qr">
            <QrCode text={s.url} size={tv ? 200 : 170} />
          </div>
          <code className="yc-url">{s.url}</code>
          <p className="muted yc-wait">
            <span className="spinner sm" /> Aguardando você entrar…
          </p>
          {!tv && !SMART_TV && (
            <button className="btn" data-autofocus onClick={() => openExternal(s.url)}>
              <Icon name="link" size={16} /> Abrir o link
            </button>
          )}
        </>
      )}
      {s.expired && <p className="muted">O código venceu. Gere outro para entrar.</p>}
      {s.error && <p className="muted">{s.error}</p>}
      {(s.expired || s.error) && (
        <button className="btn" data-autofocus onClick={() => setRound((n) => n + 1)}>
          <Icon name="refresh" size={16} /> Gerar outro código
        </button>
      )}
      <div className="yc-card-actions">
        <button className="chip" onClick={onPhone}>
          Comentar pelo celular
        </button>
        <button className="chip" data-autofocus={tv && s.url ? true : undefined} onClick={onBack}>
          Voltar
        </button>
      </div>
    </div>
  );
}

// Alternativa sempre disponível: o vídeo no app do YouTube do celular.
function PhoneCard({ v, live, onBack }) {
  const ref = useRef(null);
  useEffect(() => focusFirst(ref.current), []);
  const url = watchUrl(v);
  const tv = isTvMode();
  return (
    <div ref={ref} className="yc-card">
      <h3>Comentar pelo celular</h3>
      <p className="muted">
        Aponte a câmera do celular para o código: o vídeo abre no app do YouTube, onde você pode {live ? 'escrever no chat e comentar' : 'comentar e responder'}.
      </p>
      <div className="yc-qr">
        <QrCode text={url} size={tv ? 200 : 170} />
      </div>
      <code className="yc-url">{url}</code>
      <div className="yc-card-actions">
        {!tv && !SMART_TV && (
          <button className="chip" onClick={() => openExternal(url)}>
            <Icon name="link" size={12} /> Abrir no YouTube
          </button>
        )}
        <button className="chip" data-autofocus onClick={onBack}>
          Voltar
        </button>
      </div>
    </div>
  );
}

// Campo para escrever (só com a conta ligada): texto, ditado por voz e enviar.
function Composer({ max, placeholder, replyTo, onCancelReply, onSend, inputRef }) {
  const { notify } = useStore();
  const [text, setText] = useState(() => (replyTo?.mention ? replyTo.mention + ' ' : ''));
  const [busy, setBusy] = useState(false);
  const sendRef = useRef(null);
  const maxRef = useRef(max);
  maxRef.current = max;
  useEffect(() => {
    setText(replyTo?.mention ? replyTo.mention + ' ' : '');
  }, [replyTo]);

  // Ditado: enquanto o campo existe, o resultado da voz (também a tecla do microfone do controle
  // no Android) vem para cá, sem limpeza de busca, em vez de virar uma busca.
  const [mode, setMode] = useState(null);
  const [vs, setVs] = useState(null); // 'listening' | 'working' | null
  const stop = useRef(null);
  useEffect(() => {
    let alive = true;
    voiceMode().then((m) => alive && setMode(m));
    return () => {
      alive = false;
      stop.current?.();
    };
  }, []);
  useEffect(
    () =>
      setVoiceTarget(({ text: said, error }) => {
        if (error) return notify(error, 'err');
        const t = String(said || '').trim();
        if (!t) return;
        setText((cur) => (cur.trim() ? cur.replace(/\s*$/, ' ') + t : t).slice(0, maxRef.current));
        // Na TV o foco vai para "Enviar" (focar o campo abriria o teclado).
        if (isTvMode()) focusEl(sendRef.current);
        else if (!isTouch) inputRef.current?.focus();
      }),
    [notify, inputRef]
  );
  const toggleVoice = () => {
    if (vs) return stop.current?.();
    stop.current = startVoice(mode, setVs);
  };
  useKeyHandler((k) => (k === 'back' ? (stop.current?.(), true) : false), !!vs);

  const submit = async (e) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await onSend(t);
      setText('');
    } catch {
      /* o painel já mostrou o erro; o texto fica no campo */
    }
    setBusy(false);
  };
  const listening = vs === 'listening' ? 'Ouvindo… fale o seu comentário' : vs ? 'Entendendo…' : '';
  return (
    <form className="yc-compose" onSubmit={submit}>
      {replyTo && (
        <div className="yc-replying">
          <small className="muted">
            Respondendo a <b>{replyTo.author}</b>
          </small>
          <button type="button" className="icon-btn" onClick={onCancelReply} aria-label="Cancelar a resposta">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      <input
        ref={inputRef}
        value={listening ? '' : text}
        onChange={(e) => setText(e.target.value.slice(0, max))}
        maxLength={max}
        placeholder={listening || placeholder}
        enterKeyHint="send"
        aria-label={placeholder}
      />
      <div className="yc-send-row">
        {mode && (
          <button type="button" className={`icon-btn voice-btn ${vs ? 'on' : ''}`} onClick={toggleVoice} aria-label={vs ? 'Parar o ditado' : 'Ditar por voz'} title="Ditar por voz">
            {vs === 'working' ? <span className="spinner sm" /> : <Icon name="mic" size={18} />}
          </button>
        )}
        <small className={`yc-count ${text.length >= max ? 'full' : ''}`}>
          {text.length}/{max}
        </small>
        <button ref={sendRef} type="submit" className="btn yc-send" disabled={!text.trim() || busy}>
          {busy ? <span className="spinner sm" /> : <Icon name="send" size={16} />} Enviar
        </button>
      </div>
    </form>
  );
}

function Panel({ v, live, title, onClose }) {
  const { notify } = useStore();
  const ref = useRef(null);
  const inputRef = useRef(null);
  const [chatLive, setChatLive] = useState(live === true ? true : live === false ? false : null); // null = ainda não sabe
  const [tab, setTab] = useState(live === true ? 'chat' : 'comments');
  const touched = useRef(false); // a pessoa já escolheu a aba
  const [view, setView] = useState('list'); // 'list' | 'login' | 'phone'
  const [replyTo, setReplyTo] = useState(null); // { id (do comentário principal), author, mention }

  // Mantém o foco anterior ao fechar; ao abrir, foca o painel.
  useEffect(() => rememberFocus(), []);
  useEffect(() => {
    if (view === 'list') focusFirst(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // ---------- Conta do YouTube ----------
  const writable = canWrite();
  const [acct, setAcct] = useState(writable ? { loading: true } : null); // { configured, linked, channel }
  useEffect(() => {
    if (!writable) return undefined;
    let alive = true;
    getAccount()
      .then((a) => alive && setAcct({ configured: a.configured !== false, linked: !!a.linked, channel: a.channel || null }))
      .catch((e) => {
        if (!alive) return;
        if (e.code === 'yt_off') return setAcct({ configured: false });
        // Sem resposta: deixa tentar entrar (o servidor responde de novo ao gerar o código).
        setAcct({ configured: true, linked: false, failed: true });
      });
    return () => {
      alive = false;
    };
  }, [writable]);
  const canLogin = writable && acct && !acct.loading && acct.configured;
  // Erros do servidor ao escrever/entrar: a mensagem em pt-BR e, conforme o caso, volta ao login.
  const onError = useCallback(
    (e) => {
      notify(e.message, 'err');
      if (e.code === 'not_linked') {
        setAcct((a) => ({ ...a, linked: false, channel: null }));
        setView('login');
      } else if (e.code === 'yt_off') {
        setAcct({ configured: false });
        setView('phone');
      } else if (e.code === 'comments_disabled') setCm((s) => ({ ...s, disabled: true }));
      else if (e.code === 'chat_closed') setChatLive(false);
    },
    [notify]
  );
  // Tentar escrever: sem conta ligada → cartão de login; sem login possível → pelo celular.
  const wantWrite = (parent) => {
    if (!canLogin) return setView('phone');
    if (parent) setReplyTo(parent);
    if (!acct.linked) return setView('login');
    setTimeout(() => (isTvMode() ? focusEl(inputRef.current) : inputRef.current?.focus()), 0);
  };
  const linked = (channel) => {
    setAcct({ configured: true, linked: true, channel });
    notify(channel?.name ? `Conta do YouTube ligada: ${channel.name}.` : 'Conta do YouTube ligada.', 'ok');
    setView('list');
  };
  const signOut = async () => {
    try {
      await logout();
      setAcct({ configured: true, linked: false, channel: null });
      setReplyTo(null);
      notify('Você saiu da conta do YouTube neste aparelho.');
    } catch (e) {
      onError(e);
    }
  };

  // ---------- Comentários ----------
  const [sort, setSort] = useState('top');
  const [cm, setCm] = useState({ list: [], next: null, loading: false, error: '', disabled: false, count: null });
  const [reps, setReps] = useState({}); // id -> { list, next, open, loading, fetched }
  const cReq = useRef(0);
  const loadComments = useCallback(
    async (next = '') => {
      const id = ++cReq.current;
      setCm((s) => ({ ...(next ? s : { list: [], count: null, disabled: false }), next: next ? s.next : null, loading: true, error: '' }));
      if (!next) setReps({});
      try {
        const r = await getComments(v, sort, next);
        if (id !== cReq.current) return;
        setCm((s) => {
          const old = next ? s.list : [];
          const seen = new Set(old.map((c) => c.id));
          return { list: [...old, ...(r.comments || []).filter((c) => !seen.has(c.id))], next: r.next || null, loading: false, error: '', disabled: !!r.disabled, count: r.count ?? s.count };
        });
      } catch (e) {
        if (id !== cReq.current) return;
        if (e.code === 'comments_disabled') return setCm((s) => ({ ...s, loading: false, disabled: true }));
        notify(e.message, 'err');
        setCm((s) => ({ ...s, loading: false, error: e.message }));
      }
    },
    [v, sort, notify]
  );
  const loadedFor = useRef('');
  useEffect(() => {
    if (tab !== 'comments' || loadedFor.current === v + '|' + sort) return;
    loadedFor.current = v + '|' + sort;
    loadComments();
  }, [tab, v, sort, loadComments]);

  const showReplies = async (c, more) => {
    const cur = reps[c.id];
    if (!more && (cur?.fetched || cur?.open)) return setReps((m) => ({ ...m, [c.id]: { ...cur, open: !cur.open } }));
    const token = more ? cur?.next : c.repliesNext;
    if (!token) return setReps((m) => ({ ...m, [c.id]: { list: [], ...m[c.id], open: !m[c.id]?.open } }));
    setReps((m) => ({ ...m, [c.id]: { list: [], ...m[c.id], open: true, loading: true } }));
    try {
      const r = await getReplies(token);
      setReps((m) => {
        const old = m[c.id]?.list || [];
        const got = r.comments || [];
        const ids = new Set(got.map((x) => x.id));
        const list = more ? [...old, ...got.filter((x) => !old.some((o) => o.id === x.id))] : [...got, ...old.filter((x) => !ids.has(x.id))];
        return { ...m, [c.id]: { list, next: r.next || null, open: true, loading: false, fetched: true } };
      });
    } catch (e) {
      notify(e.message, 'err');
      setReps((m) => ({ ...m, [c.id]: { list: [], ...m[c.id], loading: false } }));
    }
  };

  // ---------- Chat ao vivo ----------
  const [msgs, setMsgs] = useState([]);
  const msgsRef = useRef([]);
  const nextRef = useRef('');
  const [chatErr, setChatErr] = useState('');
  const [chatLoading, setChatLoading] = useState(true);
  const [fresh, setFresh] = useState(0); // mensagens novas enquanto a pessoa lê lá em cima
  const stick = useRef(true);
  const chatBox = useRef(null);
  const pollNow = useRef(() => {});
  const addMsgs = (list) => {
    const before = new Set(msgsRef.current.map((m) => m.id));
    msgsRef.current = mergeChat(msgsRef.current, list);
    const added = msgsRef.current.filter((m) => !before.has(m.id)).length;
    setMsgs(msgsRef.current);
    if (added && !stick.current) setFresh((n) => n + added);
  };
  // Vídeo sem a informação de live (áreas do YouTube): pergunta uma vez se tem chat ao vivo.
  useEffect(() => {
    if (chatLive !== null) return undefined;
    let alive = true;
    getChat(v)
      .then((r) => {
        if (!alive) return;
        if (!r.live) return setChatLive(false);
        nextRef.current = r.next || '';
        addMsgs(r.messages);
        setChatLoading(false);
        setChatLive(true);
        if (!touched.current) setTab('chat');
      })
      .catch(() => alive && setChatLive(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  // Consulta o chat a cada pollMs (3 a 10 s) com a aba aberta; para com o painel fechado ou o app oculto.
  const chatOff = chatLive === false;
  useEffect(() => {
    if (tab !== 'chat' || chatOff || chatLive === null) return undefined;
    let alive = true;
    let timer = 0;
    let busy = false;
    let errs = 0;
    const tick = async () => {
      clearTimeout(timer);
      timer = 0;
      if (!alive || busy || document.hidden) return;
      busy = true;
      try {
        const r = await getChat(v, nextRef.current);
        if (!alive) return;
        errs = 0;
        setChatErr('');
        setChatLoading(false);
        if (r.live === false) return setChatLive(false);
        nextRef.current = r.next || nextRef.current;
        addMsgs(r.messages);
        timer = setTimeout(tick, clampPoll(r.pollMs));
      } catch (e) {
        if (!alive) return;
        setChatLoading(false);
        if (e.code === 'chat_closed') return setChatLive(false);
        if (!errs++) notify(e.message, 'err'); // só no primeiro erro seguido
        setChatErr(e.message);
        timer = setTimeout(tick, 10000);
      } finally {
        busy = false;
      }
    };
    pollNow.current = tick;
    timer = setTimeout(tick, msgsRef.current.length ? 3000 : 0);
    const onVis = () => {
      if (document.hidden) {
        clearTimeout(timer);
        timer = 0;
      } else if (!timer && !busy) tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      clearTimeout(timer);
      pollNow.current = () => {};
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, v, chatOff, chatLive === null]);
  // Chat terminou: os comentários ficam no lugar.
  useEffect(() => {
    if (chatOff && tab === 'chat' && !msgsRef.current.length) setTab('comments');
  }, [chatOff, tab]);
  // Rolagem automática para a última mensagem (pausa se a pessoa rolou para cima).
  useLayoutEffect(() => {
    stick.current = true;
    setFresh(0);
  }, [tab, view]);
  useLayoutEffect(() => {
    const el = chatBox.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs, tab, view]);
  const onChatScroll = (e) => {
    const el = e.currentTarget;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (stick.current) setFresh(0);
  };
  const toBottom = () => {
    const el = chatBox.current;
    stick.current = true;
    setFresh(0);
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    if (isTvMode()) focusEl(el.lastElementChild);
  };

  // ---------- Enviar ----------
  const send = async (text) => {
    try {
      if (tab === 'chat') {
        await sendChat(v, text);
        stick.current = true;
        setTimeout(() => pollNow.current(), 800);
        return;
      }
      const r = await postComment(v, text, replyTo?.id);
      const c = r.comment || { id: 'local-' + Date.now(), author: acct?.channel?.name || 'Você', avatar: acct?.channel?.avatar, text, when: 'agora', likes: 0 };
      if (replyTo) {
        const pid = replyTo.id;
        setReps((m) => ({ ...m, [pid]: { list: [...(m[pid]?.list || []), c], next: m[pid]?.next || null, fetched: m[pid]?.fetched, open: true } }));
        setCm((s) => ({ ...s, list: s.list.map((x) => (x.id === pid ? { ...x, replies: (Number(x.replies) || 0) + 1 } : x)) }));
        setReplyTo(null);
      } else setCm((s) => ({ ...s, list: [c, ...s.list], count: s.count != null ? s.count + 1 : s.count }));
      notify(replyTo ? 'Resposta publicada.' : 'Comentário publicado.', 'ok');
    } catch (e) {
      onError(e);
      throw e;
    }
  };

  // ---------- Controle remoto ----------
  useKeyHandler((k) => {
    const el = ref.current;
    const inside = el?.contains(document.activeElement);
    if (k === 'back') {
      // Saindo do campo de texto: o foco vai para "Enviar" (o próximo Voltar fecha).
      if (inside && document.activeElement.tagName === 'INPUT') {
        document.activeElement.blur();
        focusEl(el.querySelector('.yc-send') || el.querySelector('button'));
      } else if (view !== 'list') setView('list');
      else onClose();
      return true;
    }
    if (!DIRS.includes(k) && k !== 'ok') return false; // play/pausa, canal etc. continuam no vídeo
    if (!inside) {
      // Na TV o foco volta para o painel; no computador, sem foco nele, as setas e o OK ficam no vídeo.
      if (!isTvMode()) return false;
      focusFirst(el);
      return true;
    }
    if (k === 'ok') return 'nav'; // o OK clica no botão focado
    moveFocus(k);
    return true;
  });

  const pickTab = (t) => {
    touched.current = true;
    setTab(t);
    setReplyTo(null);
  };
  // Resposta a uma resposta: vai para o mesmo comentário principal, começando com @nome.
  const at = (name) => (/^@/.test(name || '') ? name : '@' + String(name || '').replace(/\s+/g, ''));
  const reply = (c, parent) => wantWrite({ id: (parent || c).id, author: c.author, mention: parent ? at(c.author) : '' });
  const showChat = chatLive === true || (chatOff && msgs.length > 0);
  const chatOpen = tab === 'chat' && chatLive === true;
  const max = tab === 'chat' ? CHAT_MAX : COMMENT_MAX;
  const writeLabel = tab === 'chat' ? 'Escrever no chat…' : replyTo ? `Responder a ${replyTo.author}…` : 'Escrever um comentário…';

  let foot = null;
  if (view === 'list' && (tab === 'comments' ? !cm.disabled : chatOpen)) {
    const phone = (
      <button className="chip yc-phone" onClick={() => setView('phone')}>
        Comentar pelo celular
      </button>
    );
    foot = (
      <div className="yc-foot">
        {acct?.linked ? (
          <>
            <div className="yc-account">
              <Avatar src={acct.channel?.avatar} name={acct.channel?.name} />
              <span>{acct.channel?.name || 'Sua conta do YouTube'}</span>
              <button className="chip yc-act" onClick={signOut}>
                Sair do YouTube
              </button>
            </div>
            <Composer key={tab} max={max} placeholder={writeLabel} replyTo={tab === 'comments' ? replyTo : null} onCancelReply={() => setReplyTo(null)} onSend={send} inputRef={inputRef} />
            {phone}
          </>
        ) : acct?.loading ? (
          <p className="muted yc-wait">
            <span className="spinner sm" /> Verificando sua conta do YouTube…
          </p>
        ) : canLogin ? (
          <>
            <button className="yc-fake-input" onClick={() => wantWrite()}>
              <Icon name="chat" size={16} /> {writeLabel}
            </button>
            {phone}
          </>
        ) : (
          <>
            {!writable && <p className="muted yc-note">Aqui dá para ler. Para escrever, use o app do YouTube no celular.</p>}
            {phone}
          </>
        )}
      </div>
    );
  }

  return (
    <aside ref={ref} className="yc-panel" data-nav-root role="dialog" aria-label={`Comentários: ${title || 'vídeo do YouTube'}`}>
      <div className="yc-head">
        <div className="yc-tabs">
          {showChat && (
            <button className={`chip ${tab === 'chat' ? 'active' : ''}`} data-autofocus={tab === 'chat' ? true : undefined} onClick={() => pickTab('chat')}>
              <span className="yc-dot" /> Chat ao vivo
            </button>
          )}
          <button className={`chip ${tab === 'comments' ? 'active' : ''}`} data-autofocus={tab === 'comments' ? true : undefined} onClick={() => pickTab('comments')}>
            Comentários{cm.count ? ` · ${fmtCount(cm.count)}` : ''}
          </button>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar os comentários" title="Fechar (Voltar)">
          <Icon name="close" />
        </button>
      </div>

      {view === 'login' && <LoginCard onLinked={linked} onFail={onError} onPhone={() => setView('phone')} onBack={() => setView('list')} />}
      {view === 'phone' && <PhoneCard v={v} live={chatLive === true} onBack={() => setView('list')} />}

      {view === 'list' && tab === 'chat' && (
        <div className="yc-chat">
          <div ref={chatBox} className="yc-scroll" onScroll={onChatScroll}>
            {chatLoading && !msgs.length && !chatOff && <span className="spinner yc-spin" />}
            {!chatLoading && !msgs.length && !chatErr && chatLive && <p className="muted yc-empty">Nenhuma mensagem ainda. Seja o primeiro a escrever!</p>}
            {msgs.map((m) => {
              const badges = (m.badges || []).map((b) => String(b));
              const staff = badges.some((b) => /owner|moderator|dono|moderador/i.test(b));
              return (
                <div key={m.id} className={`yc-item yc-msg ${m.amount ? 'yc-super' : ''}`} tabIndex={0}>
                  <Avatar src={m.avatar} name={m.author} />
                  <div className="yc-body">
                    <div className="yc-meta">
                      <strong className={staff ? 'yc-owner' : ''}>{m.author}</strong>
                      {badges.map((b) => (
                        <span key={b} className="chip-tag">
                          {BADGES[b] || b}
                        </span>
                      ))}
                      <small className="muted">{fmtClock(m.when)}</small>
                    </div>
                    {m.amount && <span className="yc-amount">{m.amount}</span>}
                    {m.text && <p className="yc-text">{m.text}</p>}
                  </div>
                </div>
              );
            })}
            {chatOff && <p className="muted yc-empty">O chat ao vivo terminou ou está desligado.</p>}
            {chatErr && !msgs.length && <p className="muted yc-empty">{chatErr}</p>}
          </div>
          {fresh > 0 && (
            <button className="btn yc-fresh" onClick={toBottom}>
              ↓ {fresh === 1 ? '1 nova mensagem' : `${fresh > 99 ? '99+' : fresh} novas mensagens`}
            </button>
          )}
        </div>
      )}

      {view === 'list' && tab === 'comments' && (
        <div className="yc-scroll">
          <div className="yc-sort">
            <button className={`chip ${sort === 'top' ? 'active' : ''}`} onClick={() => setSort('top')}>
              Mais relevantes
            </button>
            <button className={`chip ${sort === 'new' ? 'active' : ''}`} onClick={() => setSort('new')}>
              Mais recentes
            </button>
          </div>
          {cm.disabled && <p className="muted yc-empty">Os comentários estão desativados neste vídeo.</p>}
          {!cm.disabled && !cm.loading && !cm.error && !cm.list.length && <p className="muted yc-empty">Ainda não há comentários.</p>}
          {cm.list.map((c) => {
            const r = reps[c.id];
            const n = Number(c.replies) || 0;
            return (
              <div key={c.id} className="yc-cm">
                <CommentRow c={c} onReply={(x) => reply(x)} />
                {n > 0 && (
                  <div className="yc-actions">
                    <button className="chip yc-act" onClick={() => showReplies(c)} disabled={r?.loading}>
                      {r?.loading && !r.list?.length ? <span className="spinner sm" /> : null}
                      {r?.open ? 'Ocultar respostas' : n === 1 ? 'Ver 1 resposta' : `Ver ${fmtCount(n)} respostas`}
                    </button>
                  </div>
                )}
                {r?.open && (
                  <div className="yc-replies">
                    {r.list.map((x) => (
                      <CommentRow key={x.id} c={x} reply onReply={(y) => reply(y, c)} />
                    ))}
                    {r.next && (
                      <div className="yc-actions yc-reply">
                        <button className="chip yc-act" onClick={() => showReplies(c, true)} disabled={r.loading}>
                          {r.loading ? <span className="spinner sm" /> : null} Mais respostas
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {cm.loading && <span className="spinner yc-spin" />}
          {!cm.loading && (cm.next || cm.error) && (
            <div className="yc-more">
              {cm.error && <p className="muted">{cm.error}</p>}
              <button className="btn ghost" onClick={() => loadComments(cm.error && !cm.list.length ? '' : cm.next)}>
                {cm.error ? 'Tentar de novo' : 'Carregar mais'}
              </button>
            </div>
          )}
        </div>
      )}

      {foot}
    </aside>
  );
}

// Perfil infantil: sem comentários nem chat. 'live': true (narração), false ou indefinido (descobre).
export default function YtComments(props) {
  const { profile } = useStore();
  if (!socialAllowed(profile) || !props.v) return null;
  return <Panel key={props.v} {...props} />;
}
