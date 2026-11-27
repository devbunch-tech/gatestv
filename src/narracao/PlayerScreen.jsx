// Tela da narração tocando: o player grande (o iframe fica no App e acompanha o '.np-slot') e os
// controles; no Android TV, abrir o app do jogo e a janela flutuante; no Windows, a janelinha, o
// volume dos outros apps e os atalhos. Também a barra da janelinha (Windows) e o selo da janela flutuante.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon';
import QrCode from '../components/QrCode';
import { hasNative, native } from '../lib/device';
import { isTvMode } from '../lib/keys';
import { isSubscribed, markSubscribed, offsetText, subscribeUrl } from '../lib/narration';
import { SyncControls, Toggle, VolumeControl, offsetShort } from './parts';
import { desk, loadPref, narrApps, pipSupported, savePref } from './platform';

const CORNERS = [
  { id: 'tl', arrow: '↖', label: 'Superior esquerdo' },
  { id: 'tr', arrow: '↗', label: 'Superior direito' },
  { id: 'bl', arrow: '↙', label: 'Inferior esquerdo' },
  { id: 'br', arrow: '↘', label: 'Inferior direito' },
];
const SHORTCUTS = [
  ['Ctrl+Alt+→', 'Atrasar 1 s'],
  ['Ctrl+Alt+←', 'Adiantar 1 s'],
  ['Ctrl+Alt+↑', 'Atrasar 5 s'],
  ['Ctrl+Alt+↓', 'Adiantar 5 s'],
  ['Ctrl+Alt+Espaço', 'Pausar / tocar'],
  ['Ctrl+Alt+M', 'Janelinha / janela completa'],
  ['Ctrl+Alt+V', '“Vi o lance”'],
  ['Ctrl+Alt+O', '“Ouvi o narrador”'],
  ['Ctrl+Alt+I', 'Sincronizar pela IA (relógio do placar)'],
];
const openExternal = (url) => (hasNative('openUrl') ? native('openUrl', url) : window.open(url, '_blank', 'noopener'));

// ---------- Android TV ----------
function AndroidPanel({ duck, setDuck }) {
  const apps = useMemo(narrApps, []);
  const pipOk = useMemo(pipSupported, []);
  return (
    <section className="np-sec">
      <h3>Abrir o app do jogo</h3>
      <p className="muted small">A narração continua tocando numa janela flutuante por cima do app escolhido.</p>
      {apps.length ? (
        <div className="np-apps">
          {apps.map((a, i) => (
            <button key={a.pkg} className="np-applink" data-autofocus={i === 0 ? true : undefined} onClick={() => native('narrOpenApp', a.pkg)} title={`Abrir ${a.label || a.pkg}`}>
              <Icon name="tv" size={30} />
              <span>{a.label || a.pkg}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">Nenhum app de jogos encontrado neste aparelho. Abra o app do jogo pelo menu da TV: a narração fica na janela flutuante.</p>
      )}
      {pipOk && (
        <div className="narr-sync">
          <button className="btn ghost" onClick={() => native('narrPip')}>
            <Icon name="fullscreen" size={16} /> Janela flutuante
          </button>
        </div>
      )}
      {hasNative('narrDuck') && <Toggle checked={duck} onChange={setDuck} label="Abaixar o som do outro app" hint="Enquanto a narração toca, o sistema pede para o app do jogo baixar o volume." />}
    </section>
  );
}

// ---------- Windows ----------
function GameVolume() {
  const [apps, setApps] = useState(null); // null = carregando
  const load = async () => {
    setApps(null);
    const l = await desk('audioApps');
    setApps(Array.isArray(l) ? l : []);
  };
  useEffect(() => {
    load();
  }, []);
  const patch = (id, v) => setApps((l) => l.map((a) => (a.id === id ? { ...a, ...v } : a)));
  return (
    <section className="np-sec">
      <h3>
        Volume do jogo
        <button className="btn ghost small np-h-btn" onClick={load}>
          <Icon name="refresh" size={14} /> Atualizar lista
        </button>
      </h3>
      <p className="muted small">Baixe ou tire o som do app em que o jogo está passando (navegador, Globoplay, Prime Video…).</p>
      {apps === null ? (
        <p className="muted np-wait">
          <span className="spinner sm" /> Procurando os apps com som…
        </p>
      ) : !apps.length ? (
        <p className="muted">Nenhum app tocando som agora. Abra o jogo e toque em “Atualizar lista”.</p>
      ) : (
        <div className="np-audio">
          {apps.map((a) => (
            <div key={a.id} className="np-audio-row">
              <div className="np-audio-name">
                <strong>{a.name}</strong>
                {a.title && a.title !== a.name && <small className="muted">{a.title}</small>}
              </div>
              <button
                className={`icon-btn ${a.muted ? 'active' : ''}`}
                onClick={() => {
                  patch(a.id, { muted: !a.muted });
                  desk('setAppMute', a.id, !a.muted);
                }}
                aria-label={a.muted ? `Ligar o som de ${a.name}` : `Tirar o som de ${a.name}`}
                title={a.muted ? 'Ligar o som' : 'Tirar o som'}
              >
                <Icon name={a.muted ? 'mute' : 'volume'} size={18} />
              </button>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={Math.round((Number(a.volume) || 0) * 100)}
                onChange={(e) => {
                  const v = Number(e.target.value) / 100;
                  patch(a.id, { volume: v });
                  desk('setAppVolume', a.id, v);
                }}
                aria-label={`Volume de ${a.name}`}
              />
              <span className="np-vol-n">{Math.round((Number(a.volume) || 0) * 100)}%</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DesktopPanel() {
  return (
    <>
      <GameVolume />
      <section className="np-sec">
        <h3>Atalhos (funcionam com qualquer janela na frente)</h3>
        <dl className="np-keys">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}

// Convite para se inscrever no canal (apoia quem narra); some depois de "Já sou inscrito".
function Subscribe({ narr }) {
  const [done, setDone] = useState(() => isSubscribed(narr.channelId));
  useEffect(() => setDone(isSubscribed(narr.channelId)), [narr.channelId]);
  if (done) return null;
  return (
    <section className="np-sec np-subscribe">
      <h3>Apoie quem narra</h3>
      <p className="muted small">Gostando da narração? Inscreva-se no canal {narr.channel} no YouTube{isTvMode() ? ': aponte a câmera do celular para o código.' : '.'}</p>
      <div className="np-sub-row">
        {isTvMode() && <QrCode text={subscribeUrl(narr.channelId)} size={120} />}
        <div className="narr-sync">
          {!isTvMode() && (
            <button className="chip" onClick={() => openExternal(subscribeUrl(narr.channelId))}>
              <Icon name="link" size={12} /> Abrir o canal no YouTube
            </button>
          )}
          <button
            className="chip"
            onClick={() => {
              markSubscribed(narr.channelId);
              setDone(true);
            }}
          >
            <Icon name="heart" size={12} /> Já sou inscrito
          </button>
        </div>
      </div>
    </section>
  );
}

export function PlayerScreen({ p, setSlot, fav, onFav, onChange, onStop, android, desktop, duck, setDuck, onMini }) {
  const n = p.narr;
  if (!n) return null;
  return (
    <div className="np-player">
      <div className="np-left">
        <div className="np-slot" ref={setSlot} />
        <div className="np-now">
          <div className="np-now-text">
            <strong title={n.title}>{n.channel}</strong>
            <span className="muted">{n.title}</span>
          </div>
          <small className="muted">
            {p.paused ? 'Pausada · ' : ''}
            {offsetText(p.offset)}
            {p.auto ? ' · auto' : ''}
          </small>
        </div>
        <div className="narr-sync np-actions">
          <button className="btn" onClick={p.togglePause} data-autofocus={!android && !desktop ? true : undefined}>
            <Icon name={p.paused ? 'play' : 'pause'} size={16} /> {p.paused ? 'Tocar' : 'Pausar'}
          </button>
          <button className={`btn ghost ${fav ? 'on' : ''}`} onClick={() => onFav({ id: n.channelId, name: n.channel }, n)}>
            <Icon name="star" filled={fav} size={16} /> {fav ? 'Favorito' : 'Favoritar'}
          </button>
          <button className="btn ghost" onClick={onChange}>
            <Icon name="list" size={16} /> Trocar narração
          </button>
          <button className="btn ghost" onClick={onStop}>
            <Icon name="close" size={16} /> Parar
          </button>
        </div>
      </div>
      <div className="np-right">
        {android && <AndroidPanel duck={duck} setDuck={setDuck} />}
        {desktop && (
          <section className="np-sec">
            <h3>Janelinha por cima do jogo</h3>
            <p className="muted small">A narração fica numa janela pequena, sempre por cima, com os botões de sincronia. Abra o jogo no navegador ou no app e use os atalhos abaixo.</p>
            <button className="btn" data-autofocus onClick={onMini}>
              <Icon name="fullscreen" size={16} /> Modo janelinha
            </button>
          </section>
        )}
        <section className="np-sec">
          <h3>Sincronia com o jogo</h3>
          <p className="muted small">A narração está na frente do jogo? Atrase. Está atrás? Adiante. Ou use “Vi o lance” e “Ouvi o narrador” num gol ou apito. O ajuste fica salvo para este narrador.</p>
          <SyncControls p={p} />
        </section>
        <section className="np-sec">
          <h3>Volume da narração</h3>
          <VolumeControl value={p.volume} onChange={p.setVolume} />
        </section>
        {desktop && <DesktopPanel />}
        <Subscribe narr={n} />
      </div>
    </div>
  );
}

// ---------- Windows: barra da janelinha ----------
export function MiniBar({ p, onFull }) {
  const ref = useRef(null);
  const [corner, setCorner] = useState(() => loadPref('corner', 'br'));
  // Altura da barra: o player ocupa o resto da janelinha.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const put = () => document.documentElement.style.setProperty('--np-mini-bar', `${el.offsetHeight}px`);
    put();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(put) : null;
    ro?.observe(el);
    window.addEventListener('resize', put);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', put);
    };
  }, []);
  const pickCorner = (c) => {
    setCorner(c);
    savePref('corner', c);
    desk('setCorner', c);
  };
  const on = !!p.narr;
  return (
    <div className="np-mini-bar" ref={ref}>
      {!on && <span className="muted np-mini-msg">Nenhuma narração tocando.</span>}
      {on && (
        <>
          <span className="np-mini-off" title={offsetText(p.offset)}>
            {offsetShort(p.offset)}
          </span>
          <span className="np-mini-group">
            <button className="chip" tabIndex={-1} onClick={() => p.shift(-5)} title="Adiantar a narração 5 s">−5</button>
            <button className="chip" tabIndex={-1} onClick={() => p.shift(-1)} title="Adiantar a narração 1 s">−1</button>
            <button className="chip" tabIndex={-1} onClick={() => p.shift(1)} title="Atrasar a narração 1 s">+1</button>
            <button className="chip" tabIndex={-1} onClick={() => p.shift(5)} title="Atrasar a narração 5 s">+5</button>
          </span>
          <span className="np-mini-group">
            <button className={`chip ${p.lance?.kind === 'saw' ? 'active' : ''}`} tabIndex={-1} onClick={() => p.markLance('saw')} title="Vi o lance (no jogo)">
              <Icon name="eye" size={12} /> Vi
            </button>
            <button className={`chip ${p.lance?.kind === 'heard' ? 'active' : ''}`} tabIndex={-1} onClick={() => p.markLance('heard')} title="Ouvi o narrador (reagir ao mesmo lance)">
              <Icon name="volume" size={12} /> Ouvi
            </button>
            {p.aiOk && (
              <button className={`chip ${p.aiBusy ? 'active' : ''}`} tabIndex={-1} onClick={p.aiSync} title="Sincronizar pela IA: lê o relógio do placar no jogo e na narração (Ctrl+Alt+I)">
                <Icon name="clock" size={12} /> {p.aiBusy ? '…' : 'IA'}
              </button>
            )}
            <button className="chip" tabIndex={-1} onClick={p.togglePause} title={p.paused ? 'Tocar' : 'Pausar'} aria-label={p.paused ? 'Tocar' : 'Pausar'}>
              <Icon name={p.paused ? 'play' : 'pause'} size={12} />
            </button>
          </span>
          <VolumeControl value={p.volume} onChange={p.setVolume} compact />
        </>
      )}
      <span className="np-mini-group np-mini-end">
        {CORNERS.map((c) => (
          <button key={c.id} className={`chip ${corner === c.id ? 'active' : ''}`} tabIndex={-1} onClick={() => pickCorner(c.id)} title={`Levar a janelinha para o canto ${c.label.toLowerCase()}`} aria-label={c.label}>
            {c.arrow}
          </button>
        ))}
        <button className="chip" tabIndex={-1} onClick={onFull} title="Voltar à janela completa" aria-label="Voltar à janela completa">
          ⤢
        </button>
      </span>
    </div>
  );
}

// ---------- Android: selo da janela flutuante (o atraso atual; pisca a cada ajuste) ----------
export function PipBadge({ p }) {
  if (!p.narr) return <div className="np-pip-empty">Escolha uma narração no GATES Narração.</div>;
  return (
    <div key={`${p.offset}-${p.paused}`} className="np-pip-badge">
      {p.paused && <Icon name="pause" size={10} />} {offsetShort(p.offset)}
    </div>
  );
}
