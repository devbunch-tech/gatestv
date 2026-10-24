// Edição de assinantes: só libera o app com a assinatura válida.
//   - sem licença: ativação (e-mail da compra + número do pedido, ou código na TV)
//   - em dia: app normal
//   - vencida (até 4 dias): app normal + aviso de suspensão, 1x por vencimento
//   - suspensa: tela de renovação
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AuthContext } from '../auth';
import { DEVICE, SMART_TV, isTouch, native, hasNative } from '../lib/device';
import { IS_TEST, REFRESH_HOURS, STORE_URL, licenseApiUrl, setLicenseApiUrl } from '../config/license';
import * as lic from '../lib/license';
import { focusEl } from '../lib/keys';
import Icon from './Icon';
import QrCode from './QrCode';

const LicenseCtx = createContext(null);
export const useLicense = () => useContext(LicenseCtx);

const fmtDate = (t) => (t ? new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const openExternal = (url) => url && !SMART_TV && (hasNative('openUrl') ? native('openUrl', url) : window.open(url, '_blank', 'noopener'));
// Smart TVs: o cliente resolve pelo celular (o endereço aparece na tela).
const siteHost = () => licenseApiUrl().replace(/^https?:\/\//, '');

// Uma "conta" local por assinante (perfis, favoritos e histórico ficam separados por e-mail).
function accountFor(email) {
  let h = 0;
  for (const ch of email) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const id = 'sub-' + h.toString(36);
  const first = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  const name = first ? first[0].toUpperCase() + first.slice(1) : 'Principal';
  return { id, email, name, profilesVersion: 1, profiles: [{ id: `${id}-main`, name, emoji: '😎', color: '#ec0b43', master: true }] };
}

export function LicenseProvider({ children }) {
  const [payload, setPayload] = useState(null);
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  // Abre com a licença guardada (conferindo a assinatura digital) e renova em seguida.
  const refreshNow = useCallback(async ({ quiet = false } = {}) => {
    if (!lic.loadSaved()) return;
    if (!quiet) setChecking(true);
    try {
      setPayload(await lic.refresh());
      setError('');
    } catch (err) {
      // Licença recusada pelo servidor (aparelho removido, token inválido): pede para entrar de novo.
      if (err.http === 401) {
        lic.clearSaved();
        setPayload(null);
      }
      setError(err.message);
    } finally {
      setChecking(false);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const saved = lic.loadSaved();
      const p = saved ? await lic.verifyToken(saved.token) : null;
      if (!alive) return;
      if (!p && saved) lic.clearSaved();
      setPayload(p);
      setReady(true);
      if (p) refreshNow({ quiet: true });
    })();
    return () => {
      alive = false;
    };
  }, [refreshNow]);

  // Renova a cada poucas horas e ao voltar para o app; recalcula a situação a cada minuto.
  useEffect(() => {
    const iv = setInterval(() => refreshNow({ quiet: true }), REFRESH_HOURS * 3600e3);
    const tick = setInterval(() => setNow(Date.now()), 60e3);
    const onVis = () => document.visibilityState === 'visible' && refreshNow({ quiet: true });
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(iv);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refreshNow]);

  const state = useMemo(() => lic.evaluate(payload, now), [payload, now]);
  const account = useMemo(() => (payload?.email && state.status !== 'none' ? accountFor(payload.email) : null), [payload?.email, state.status]);
  const logout = useCallback(async () => {
    await lic.logout();
    setPayload(null);
  }, []);
  const storeUrl = payload?.cfg?.storeUrl || STORE_URL;

  const value = { payload, state, checking, error, refreshNow, logout, storeUrl, setPayload };
  const auth = useMemo(() => ({ account, login: () => false, logout }), [account, logout]);

  let content;
  if (!ready) content = <div className="loading"><div className="spinner" /></div>;
  else if (state.status === 'none') content = <Activation onDone={setPayload} />;
  else if (state.status === 'suspended' || state.status === 'offline') content = <Blocked />;
  else
    content = (
      <>
        {children}
        {state.status === 'grace' && <GraceNotice />}
        {state.reason === 'trial' && <TrialBadge until={state.paidUntil} />}
      </>
    );

  return (
    <LicenseCtx.Provider value={value}>
      <AuthContext.Provider value={auth}>{content}</AuthContext.Provider>
    </LicenseCtx.Provider>
  );
}

// ---------- Ativação ----------
// Chave gravada no APK pelo link de download (ver InstallTag.java). Usada uma vez por aparelho:
// depois de ativar (ou de uma recusa do servidor), sair da conta volta para a ativação normal.
const triedKey = (t) => 'gates:install-tried:' + t;
function installToken() {
  const t = native('installToken');
  if (!t) return '';
  try {
    return localStorage.getItem(triedKey(t)) ? '' : t;
  } catch {
    return t;
  }
}
function markTried(t) {
  try {
    localStorage.setItem(triedKey(t), String(Date.now()));
  } catch {
    /* sem armazenamento: tenta de novo na próxima vez */
  }
}

function Activation({ onDone }) {
  // Na TV, digitar com o controle é ruim: o padrão é o código para confirmar pelo celular.
  const [mode, setMode] = useState(DEVICE === 'tv' ? 'code' : 'form');
  const [auto, setAuto] = useState(() => (installToken() ? 'trying' : ''));
  useEffect(() => {
    const token = installToken();
    if (!token) return;
    let alive = true;
    lic
      .activateInstall(token)
      .then((p) => {
        markTried(token);
        if (alive) onDone(p);
      })
      .catch((err) => {
        if (err.code !== 'network') markTried(token);
        if (alive) setAuto(err.message);
      });
    return () => {
      alive = false;
    };
  }, [onDone]);
  if (auto === 'trying')
    return (
      <div className="login license-screen" data-nav-root>
        <div className="login-card license-card">
          <img src="./logo.png" alt="GATES! TV" className="login-logo" />
          <h1>Ativando este aparelho…</h1>
          <div className="loading small-loading"><div className="spinner" /></div>
          <p className="muted license-sub">Reconhecemos o seu download. Só um instante.</p>
        </div>
      </div>
    );
  return (
    <div className="login license-screen" data-nav-root>
      <div className="login-card license-card">
        <img src="./logo.png" alt="GATES! TV" className="login-logo" />
        {IS_TEST && <span className="test-tag">VERSÃO DE TESTE</span>}
        {auto && <p className="msg err">Não foi possível ativar automaticamente: {auto}</p>}
        {mode === 'form' ? <ActivationForm onDone={onDone} /> : <PairCode onDone={onDone} />}
        <button type="button" className="link-btn license-switch" onClick={() => setMode((m) => (m === 'form' ? 'code' : 'form'))}>
          {mode === 'form' ? 'Ativar com um código (pelo celular)' : 'Digitar e-mail e CPF aqui'}
        </button>
        <NewCustomer />
        {IS_TEST && <TestPanel />}
      </div>
    </div>
  );
}

function ActivationForm({ onDone }) {
  const [email, setEmail] = useState('');
  const [order, setOrder] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => ref.current?.focus(), []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onDone(await lic.activate(email.trim(), order.trim()));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <h1>Ative sua assinatura</h1>
      <p className="muted license-sub">Use o e-mail da assinatura e o seu CPF (ou o código de acesso mostrado na compra).</p>
      <label className="field">
        <span>E-mail da compra</span>
        <input ref={ref} type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="field">
        <span>CPF ou código de acesso</span>
        <input inputMode="text" placeholder="000.000.000-00 ou GTV-XXXX-XXXX" value={order} onChange={(e) => setOrder(e.target.value)} required />
      </label>
      {error && <p className="msg err">{error}</p>}
      <button className="btn login-btn" disabled={busy}>
        {busy ? <span className="spinner sm" /> : 'Ativar'}
      </button>
    </form>
  );
}

function PairCode({ onDone }) {
  const [pair, setPair] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    setPair(null);
    setError('');
    lic
      .pairStart()
      .then((p) => {
        if (!alive) return;
        setPair(p);
        const poll = async () => {
          if (!alive) return;
          if (Date.now() > p.expiresAt) return setAttempt((a) => a + 1); // código novo
          try {
            const done = await lic.pairPoll(p.pairId);
            if (done) return alive && onDone(done);
          } catch (err) {
            if (err.code === 'pair_expired') return alive && setAttempt((a) => a + 1);
          }
          timer = setTimeout(poll, 3000);
        };
        timer = setTimeout(poll, 3000);
      })
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [attempt, onDone]);

  useEffect(() => {
    if (error) focusEl(ref.current);
  }, [error]);

  return (
    <div className="pair">
      <h1>Ative este aparelho</h1>
      {error ? (
        <>
          <p className="msg err">{error}</p>
          <button ref={ref} className="btn login-btn" onClick={() => setAttempt((a) => a + 1)}>
            Tentar de novo
          </button>
        </>
      ) : !pair ? (
        <div className="loading small-loading"><div className="spinner" /></div>
      ) : (
        <>
          <p className="muted license-sub">No celular ou computador, acesse:</p>
          <p className="pair-url">{pair.url.replace(/^https?:\/\//, '')}</p>
          <p className="muted license-sub">e digite o código:</p>
          <p className="pair-code">{pair.code}</p>
          <p className="muted small">
            <span className="spinner sm" /> Aguardando a confirmação… o código vale por 30 minutos.
          </p>
        </>
      )}
    </div>
  );
}

// ---------- Suspensa / sem internet ----------
function Blocked() {
  const { state, payload, checking, error, refreshNow, logout, storeUrl } = useLicense();
  const ref = useRef(null);
  useEffect(() => focusEl(ref.current), []);
  const offline = state.status === 'offline';
  // Teste grátis vencido (no servidor: trial_ended; sem internet, o app ainda tem a licença do teste).
  const trialOver = state.reason === 'trial_ended' || state.reason === 'trial';
  const reason =
    state.reason === 'blocked'
      ? 'O acesso desta conta foi bloqueado. Fale com o suporte.'
      : state.reason === 'awaiting_payment'
        ? 'Sua assinatura foi criada. Assim que o pagamento for confirmado, o acesso é liberado automaticamente (PIX e cartão: na hora).'
        : trialOver
        ? 'Seu teste grátis terminou. Gostou? Assine um plano para continuar assistindo — a liberação é na hora com PIX ou cartão.'
        : state.reason === 'no_subscription'
        ? 'Não encontramos uma assinatura ativa para este e-mail.'
        : `Não identificamos o pagamento da mensalidade. A assinatura venceu em ${fmtDate(state.paidUntil)} e foi suspensa.`;
  return (
    <div className="login license-screen" data-nav-root>
      <div className="login-card license-card">
        <img src="./logo.png" alt="GATES! TV" className="login-logo" />
        <h1>{offline ? 'Conecte-se à internet' : state.reason === 'awaiting_payment' ? 'Aguardando pagamento' : trialOver ? 'Seu teste terminou' : 'Assinatura suspensa'}</h1>
        <p className="muted license-sub">
          {offline ? 'Faz alguns dias que não conseguimos confirmar sua assinatura. Conecte o aparelho à internet para continuar.' : reason}
        </p>
        {error && <p className="msg err">{error}</p>}
        {!offline && !isTouch && (state.reason === 'awaiting_payment' ? payload?.cfg?.payUrl : storeUrl) && state.reason !== 'blocked' && (
          <div className="license-qr">
            <QrCode text={state.reason === 'awaiting_payment' ? payload.cfg.payUrl : storeUrl} size={200} />
            <p className="muted small">
              {trialOver ? 'Gostou? Aponte a câmera do celular e assine em 1 minuto.' : state.reason === 'awaiting_payment' ? 'Aponte a câmera do celular para pagar.' : 'Aponte a câmera do celular para renovar.'}
              {!SMART_TV && (
                <>
                  <br />A TV libera sozinha quando o pagamento for confirmado.
                </>
              )}
            </p>
          </div>
        )}
        {SMART_TV && !offline ? (
          <p className="license-sub">
            No celular, acesse <b>{siteHost()}/conta</b> {trialOver ? 'para assinar' : 'para pagar ou renovar'}. A TV volta sozinha quando o pagamento for confirmado.
          </p>
        ) : !offline && state.reason === 'awaiting_payment' && payload?.cfg?.payUrl ? (
          <button ref={ref} className="btn login-btn" onClick={() => openExternal(payload.cfg.payUrl)}>
            <Icon name="star" size={18} /> Pagar agora
          </button>
        ) : (
          !offline &&
          storeUrl &&
          state.reason !== 'blocked' && (
            <button ref={ref} className="btn login-btn" onClick={() => openExternal(storeUrl)}>
              <Icon name="star" size={18} /> {trialOver ? 'Assinar agora' : 'Renovar assinatura'}
            </button>
          )
        )}
        <button ref={offline || !storeUrl || SMART_TV ? ref : undefined} className="btn ghost login-btn license-gap" disabled={checking} onClick={() => refreshNow()}>
          {checking ? <span className="spinner sm" /> : <Icon name="refresh" size={18} />} {offline ? 'Tentar de novo' : 'Já paguei — verificar agora'}
        </button>
        <button className="link-btn license-switch" onClick={logout}>
          {payload?.email} · Sair deste aparelho
        </button>
      </div>
    </div>
  );
}

// ---------- Aviso de suspensão (1x por vencimento) ----------
function GraceNotice() {
  const { payload, state, storeUrl } = useLicense();
  const [open, setOpen] = useState(() => !lic.noticeSeen(payload));
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    lic.markNoticeSeen(payload);
    const t = setTimeout(() => focusEl(ref.current), 50);
    return () => clearTimeout(t);
  }, [open, payload]);
  if (!open) return null;
  const days = Math.max(1, Math.ceil((state.suspendAt - Date.now()) / 864e5));
  return (
    <div className="modal-scrim license-scrim" data-nav-root>
      <div className="modal license-notice" role="alertdialog" aria-modal="true">
        <div className="modal-body">
          <span className="license-badge">
            <Icon name="info" size={22} />
          </span>
          <h2>Sua assinatura será suspensa</h2>
          <p>
            Não identificamos o pagamento da sua mensalidade. Em até <strong>{days} dia(s)</strong> (até {fmtDate(state.suspendAt)}) o acesso
            será suspenso.
          </p>
          <p className="muted small">Se você já pagou, pode ignorar: a liberação é automática assim que o pagamento for confirmado.</p>
          <div className="license-actions">
            {SMART_TV && <p className="muted small">Pelo celular: {siteHost()}/conta</p>}
            {storeUrl && !SMART_TV && (
              <button className="btn" onClick={() => (openExternal(storeUrl), setOpen(false))}>
                Regularizar agora
              </button>
            )}
            <button ref={ref} className="btn ghost" onClick={() => setOpen(false)}>
              Entendi
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Só nas versões de teste ----------
// Endereço do servidor de licenças (o do seu PC na rede) e os clientes de exemplo do Shopify simulado.
function TestPanel() {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(licenseApiUrl());
  const [status, setStatus] = useState('');
  const check = async (u = licenseApiUrl()) => {
    setStatus('verificando…');
    try {
      const r = await fetch(u + '/health');
      const j = await r.json();
      setStatus(j.ok ? `conectado (${{ checkout: 'checkout próprio', shopify: 'Shopify', nuvemshop: 'Nuvemshop' }[j.store] || j.store})` : 'sem resposta');
    } catch {
      setStatus('não encontrado — o servidor de teste está ligado?');
    }
  };
  useEffect(() => {
    check();
  }, []);
  return (
    <div className="test-panel">
      <div className="test-row">
        <span>Servidor:</span>
        {editing ? (
          <>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.0.10:8787" />
            <button
              className="btn"
              onClick={() => {
                setLicenseApiUrl(url);
                setEditing(false);
                check(licenseApiUrl());
              }}
            >
              Salvar
            </button>
          </>
        ) : (
          <>
            <strong>{licenseApiUrl().replace(/^https?:\/\//, '')}</strong>
            <button className="link-btn" onClick={() => setEditing(true)}>
              alterar
            </button>
          </>
        )}
      </div>
      <small className={status.startsWith('conectado') ? 'ok' : ''}>{status}</small>
      <details>
        <summary>Clientes de teste (loja simulada)</summary>
        <ul>
          <li><b>em-dia@teste.com</b> · CPF <b>529.982.247-25</b> — em dia</li>
          <li><b>atrasado@teste.com</b> · CPF <b>111.444.777-35</b> — aviso de suspensão</li>
          <li><b>suspenso@teste.com</b> · CPF <b>123.456.789-09</b> — suspenso</li>
          <li>Ou faça uma compra de teste em <b>{licenseApiUrl().replace(/^https?:\/\//, '')}/assinar</b></li>
        </ul>
      </details>
    </div>
  );
}

// ---------- Selo do teste grátis (canto da tela, sem pegar o foco do controle) ----------
function TrialBadge({ until }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    // Some sozinho depois de 12 s; volta na próxima abertura do app.
    const t = setTimeout(() => setOpen(false), 12000);
    return () => clearTimeout(t);
  }, []);
  if (!open || !until) return null;
  const left = Math.max(0, until - Date.now());
  const hours = Math.floor(left / 36e5);
  const when = hours >= 1 ? `${hours}h` : `${Math.max(1, Math.round(left / 6e4))} min`;
  return (
    <div className="trial-badge" role="status">
      <b>Teste grátis</b> · termina em {when} · Assine em <b>{licenseApiUrl().replace(/^https?:\/\//, '')}/assinar</b>
    </div>
  );
}

// ---------- Quem ainda não é cliente (ex.: baixou o app direto na loja da TV) ----------
function NewCustomer() {
  const site = licenseApiUrl();
  const host = site.replace(/^https?:\/\//, '');
  const [price, setPrice] = useState('');
  const [hours, setHours] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch(site + '/api/v1/plans')
      .then((r) => r.json())
      .then((j) => {
        // Preço do plano mensal (o que o cliente paga por mês, sem precisar pagar o ano adiantado).
        const mensal = (j.plans || []).find((p) => p.days <= 31) || (j.plans || [])[0];
        if (alive && j.trialHours) setHours(j.trialHours);
        if (alive && mensal) setPrice(mensal.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [site]);
  const trialUrl = site + '/testar';
  const trialLen = hours ? (hours === 1 ? 'de 1 hora' : 'de ' + hours + ' horas') : '';
  return (
    <div className="license-new">
      <p className="license-new-title">Ainda não tem conta?</p>
      {isTouch ? (
        <>
          <p className="muted small">Teste grátis {trialLen}, sem cartão.{price && ` Depois, a partir de ${price}/mês.`}</p>
          <button type="button" className="btn ghost login-btn" onClick={() => openExternal(trialUrl)}>
            <Icon name="star" size={18} /> Começar teste grátis
          </button>
        </>
      ) : (
        <div className="license-qr">
          <QrCode text={trialUrl} size={150} />
          <p className="muted small">
            Aponte a câmera do celular e faça o <b>teste grátis {trialLen}</b>, sem cartão.
            {price && <> Depois, a assinatura é a partir de <b>{price}/mês</b>.</>}
            <br />
            Ou acesse <b style={{ wordBreak: 'break-all' }}>{host}/testar</b>.
          </p>
        </div>
      )}
    </div>
  );
}
