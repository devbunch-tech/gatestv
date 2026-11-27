// GATES Narração: toca a narração de uma live do YouTube (player visível, como o YouTube exige) por
// cima de outros apps de jogos. Android TV: janela flutuante (PiP) sobre o app do jogo. Windows:
// janelinha sempre por cima. Navegador comum: página normal (útil para testar).
// O iframe do YouTube fica sempre no mesmo lugar da árvore (não recarrega ao trocar de tela): na tela
// da narração acompanha o '.np-slot'; nas outras telas fica no canto; na janela flutuante / janelinha
// ocupa a janela.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon';
import { hasNative, native } from '../lib/device';
import { focusEl, isTvMode, setFallback, useKeyHandler } from '../lib/keys';
import { channelLive, loadFavs, narrEmbedUrl, toggleFav } from '../lib/narration';
import { MiniBar, PipBadge, PlayerScreen } from './PlayerScreen';
import { GameLives, Home } from './screens';
import { desk, isAndroidNarr, isDesktopNarr, loadPref, savePref, useNativeEvent } from './platform';
import { useNarrPlayer } from './useNarrPlayer';

// Avisos simples (o app novo não usa o StoreProvider do app principal).
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const notify = useCallback((text, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => (t.some((x) => x.text === text) ? t : [...t.slice(-2), { id, text, kind }]));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  const dismiss = (id) => setToasts((t) => t.filter((x) => x.id !== id));
  return { toasts, notify, dismiss };
}

// O player do YouTube. mode: 'slot' (sobre o '.np-slot' da tela da narração), 'dock' (canto),
// 'fill' (janela flutuante do Android) ou 'mini' (janelinha do Windows, acima da barra).
function Frame({ p, slot, mode }) {
  const [rect, setRect] = useState(null);
  useLayoutEffect(() => {
    if (mode !== 'slot' || !slot) {
      setRect(null);
      return undefined;
    }
    let raf = 0;
    const read = () => {
      const r = slot.getBoundingClientRect();
      setRect((o) => (o && o.left === r.left && o.top === r.top && o.width === r.width && o.height === r.height ? o : { left: r.left, top: r.top, width: r.width, height: r.height }));
    };
    const upd = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(read);
    };
    read();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(upd) : null;
    ro?.observe(slot);
    window.addEventListener('resize', upd);
    document.addEventListener('scroll', upd, true);
    const iv = setInterval(upd, 800); // mudanças de layout que nenhum evento avisa
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', upd);
      document.removeEventListener('scroll', upd, true);
      clearInterval(iv);
    };
  }, [slot, mode]);
  if (!p.narr) return null;
  const style = mode === 'slot' ? (rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : { visibility: 'hidden' }) : undefined;
  return (
    <div className={`np-frame np-frame-${mode}`} style={style}>
      <iframe
        key={p.narr.key}
        ref={p.frame}
        onLoad={p.onFrameLoad}
        src={narrEmbedUrl(p.narr.key)}
        title={`Narração: ${p.narr.channel}`}
        allow="autoplay; encrypted-media"
        tabIndex={-1}
      />
    </div>
  );
}

// Painel "Como usar" (Voltar fecha).
function HelpPanel({ onClose, android, desktop }) {
  const ref = useRef(null);
  useKeyHandler((k) => (k === 'back' ? (onClose(), true) : 'nav'));
  useEffect(() => {
    const t = setTimeout(() => focusEl(ref.current), 30);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="modal-scrim np-scrim" data-nav-root onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal np-help" role="dialog" aria-modal="true" aria-label="Como usar">
        <div className="modal-body">
          <h2>Como usar o GATES Narração</h2>
          <ol>
            <li>Escolha a narração: um dos seus narradores, um jogo de hoje ou a busca pelo nome do canal.</li>
            {android && <li>Na tela da narração, escolha o app do jogo (Globoplay, Prime Video…). A narração continua numa janela flutuante por cima dele.</li>}
            {desktop && <li>Abra o jogo no navegador ou no app e toque em “Modo janelinha”: a narração fica numa janela pequena, sempre por cima.</li>}
            {!android && !desktop && <li>Deixe esta página aberta ao lado do jogo.</li>}
            <li>Tire ou baixe o som do jogo{desktop ? ' (em “Volume do jogo”)' : android ? ' (o app pode abaixar o som do outro app sozinho)' : ''}.</li>
            <li>A narração está na frente do jogo? Atrase. Está atrás? Adiante. Ou toque em “Vi o lance” e “Ouvi o narrador” num gol ou apito. O ajuste fica salvo para cada narrador.</li>
          </ol>
          <p className="muted small">O YouTube exige o player visível: por isso a narração aparece sempre numa janelinha com o vídeo da live.</p>
          <div className="narr-sync">
            <button ref={ref} className="btn" onClick={onClose}>
              Entendi
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { toasts, notify, dismiss } = useToasts();
  const p = useNarrPlayer(notify);
  const android = useMemo(isAndroidNarr, []);
  const desktop = useMemo(isDesktopNarr, []);

  // Telas em pilha (Voltar volta uma). As de baixo ficam montadas e escondidas: guardam busca e rolagem.
  const [stack, setStack] = useState([{ id: 0, name: 'home' }]);
  const nextId = useRef(1);
  const focusMem = useRef([]);
  const restore = useRef(null);
  const top = stack[stack.length - 1];
  const go = useCallback((s) => {
    setStack((st) => {
      focusMem.current[st.length - 1] = document.activeElement;
      return [...st, { ...s, id: nextId.current++ }];
    });
  }, []);
  const back = useCallback(() => {
    setStack((st) => {
      if (st.length < 2) return st;
      restore.current = focusMem.current[st.length - 2];
      return st.slice(0, -1);
    });
  }, []);
  const [help, setHelp] = useState(false);

  // Narradores favoritos e quem deles está ao vivo: id -> { loading } | live | null.
  const [favs, setFavs] = useState(loadFavs);
  const [favLive, setFavLive] = useState({});
  const checkFavs = useCallback(() => {
    for (const f of loadFavs()) {
      setFavLive((s) => ({ ...s, [f.id]: s[f.id]?.key ? s[f.id] : { loading: true } }));
      channelLive(f.id)
        .then((live) => setFavLive((s) => ({ ...s, [f.id]: live })))
        .catch(() => setFavLive((s) => ({ ...s, [f.id]: null })));
    }
  }, []);
  // Favoritar uma live tocando ou da busca: já sabemos que o canal está ao vivo.
  const onFav = useCallback((c, l) => {
    const next = toggleFav(c);
    setFavs(next);
    if (l?.key && next.some((f) => f.id === c.id)) setFavLive((s) => ({ ...s, [c.id]: { key: l.key, title: l.title } }));
  }, []);

  const pick = (l) => {
    p.start({ key: l.key, title: l.title, channel: l.channel, channelId: l.channelId });
    if (top.name !== 'player') go({ name: 'player' });
  };
  const stopNarr = () => {
    p.stop();
    setStack((st) => (st[st.length - 1].name === 'player' ? st.slice(0, -1) : st));
  };
  const toPlayer = () => p.narr && top.name !== 'player' && go({ name: 'player' });
  // A narração parou sozinha (live que não toca fora do YouTube): sai da tela dela.
  useEffect(() => {
    if (!p.narr && top.name === 'player') back();
  }, [p.narr, top.name, back]);

  // ---------- Android: janela flutuante, botões dela e "abaixar o som do outro app" ----------
  const [pip, setPip] = useState(false);
  useNativeEvent('gates-narr-pip', (d) => setPip(!!d.on));
  const [duck, setDuckState] = useState(() => loadPref('duck', true) !== false);
  const setDuck = (on) => {
    setDuckState(on);
    savePref('duck', on);
  };
  const ducked = useRef(false);
  const wantDuck = !!p.narr && !p.paused && duck;
  useEffect(() => {
    if (!hasNative('narrDuck') || ducked.current === wantDuck) return;
    ducked.current = wantDuck;
    native('narrDuck', wantDuck);
  }, [wantDuck]);
  useEffect(() => () => ducked.current && native('narrDuck', false), []);
  useEffect(() => {
    if (!p.narr || !hasNative('narrPipActions')) return;
    native(
      'narrPipActions',
      JSON.stringify([
        { id: 'delay+1', title: 'Atrasar 1 s', icon: 'plus' },
        { id: 'delay-1', title: 'Adiantar 1 s', icon: 'minus' },
        p.paused ? { id: 'play', title: 'Tocar', icon: 'play' } : { id: 'pause', title: 'Pausar', icon: 'pause' },
      ])
    );
  }, [p.narr, p.paused]);

  // ---------- Windows: janelinha ----------
  const [mode, setModeState] = useState('full');
  useNativeEvent('gates-narr-mode', (d) => setModeState(d.mode === 'mini' ? 'mini' : 'full'));
  const setMode = (m) => {
    if (m === 'mini' && !p.narr) return notify('Escolha uma narração primeiro.');
    setModeState(m);
    desk('setMode', m);
    if (m === 'mini') desk('setCorner', loadPref('corner', 'br'));
  };
  const mini = desktop && mode === 'mini';

  // Botões da janela flutuante (Android) e atalhos globais (Windows).
  useNativeEvent('gates-narr-action', (d) => {
    const id = String(d.id || '');
    if (id === 'mini') return setMode(mode === 'mini' ? 'full' : 'mini');
    if (!p.narr) return;
    const m = /^delay([+-]\d+)$/.exec(id);
    if (m) return p.shift(Number(m[1]));
    if (id === 'pause') return p.togglePause();
    if (id === 'play') return p.play();
    if (id === 'seen') return p.markLance('saw');
    if (id === 'heard') return p.markLance('heard');
    if (id === 'ai') return p.aiOk ? p.aiSync() : undefined;
  });

  // ---------- Controle remoto / teclado ----------
  // Teclas de mídia do controle: pausar/tocar a narração (o espaço e o 'k' ficam com os botões).
  useKeyHandler((k, e) => {
    if (!p.narr || !['playpause', 'play', 'pause'].includes(k) || e.key === ' ' || e.key === 'k') return false;
    if (k === 'play') p.play();
    else if (k === 'pause') p.pause();
    else p.togglePause();
    return true;
  });
  // Voltar: janelinha -> janela completa; tela -> a anterior; início com narração -> a narração;
  // início sem narração -> fecha o app (Android), como no app principal.
  const ref = useRef();
  ref.current = { stack, pip, mini, narr: p.narr, back, toPlayer, setMode };
  useEffect(() => {
    setFallback((k) => {
      if (k !== 'back') return false;
      const s = ref.current;
      if (s.pip) return true;
      if (s.mini) return s.setMode('full'), true;
      if (s.stack.length > 1) return s.back(), true;
      if (s.narr) return s.toPlayer(), true;
      if (window.GatesAndroid) return native('exit'), true;
      return false;
    });
    return () => setFallback(null);
  }, []);

  // Foco ao trocar de tela: volta onde estava (Voltar) ou, na TV, o primeiro elemento útil.
  useEffect(() => {
    const t = setTimeout(() => {
      const el = restore.current;
      restore.current = null;
      if (el?.isConnected && el.getBoundingClientRect().width) return focusEl(el);
      if (!isTvMode() && !el) return;
      const root = document.querySelector('.np-screen.on');
      focusEl(root?.querySelector('[data-autofocus]') || root?.querySelector('button:not([disabled]), input'));
    }, 120);
    return () => clearTimeout(t);
  }, [top.id]);

  // Onde fica o player do YouTube.
  const [slot, setSlot] = useState(null);
  const frameMode = pip ? 'fill' : mini ? 'mini' : slot && top.name === 'player' ? 'slot' : 'dock';

  const screenOf = (s) => {
    const active = s.id === top.id;
    if (s.name === 'home') return <Home active={active} p={p} favs={favs} favLive={favLive} checkFavs={checkFavs} onFav={onFav} onPick={pick} onGame={(game, crests) => go({ name: 'game', game, crests })} onPlayer={toPlayer} notify={notify} onHelp={() => setHelp(true)} />;
    if (s.name === 'game') return <GameLives game={s.game} crests={s.crests} p={p} favs={favs} onPick={pick} onFav={onFav} onBack={back} />;
    if (s.name === 'player')
      return (
        <PlayerScreen
          p={p}
          setSlot={setSlot}
          fav={!!p.narr && favs.some((f) => f.id === p.narr.channelId)}
          onFav={onFav}
          onChange={back}
          onStop={stopNarr}
          android={android}
          desktop={desktop}
          duck={duck}
          setDuck={setDuck}
          onMini={() => setMode('mini')}
        />
      );
    return null;
  };

  return (
    <div className={`np-app ${pip ? 'is-pip' : ''} ${mini ? 'is-mini' : ''} ${p.narr && frameMode === 'dock' ? 'has-dock' : ''}`}>
      <Frame p={p} slot={slot} mode={frameMode} />
      {pip && <PipBadge p={p} />}
      {mini && <MiniBar p={p} onFull={() => setMode('full')} />}
      <div className="np-screens" hidden={pip || mini}>
        {stack.map((s) => (
          <div key={s.id} className={`np-screen ${s.id === top.id ? 'on' : ''}`} aria-hidden={s.id === top.id ? undefined : true}>
            {screenOf(s)}
          </div>
        ))}
      </div>
      {p.narr && frameMode === 'dock' && (
        <button className="np-dock-btn" onClick={toPlayer} title="Abrir os controles da narração">
          <Icon name="volume" size={14} /> {p.narr.channel}
        </button>
      )}
      {help && !pip && !mini && <HelpPanel onClose={() => setHelp(false)} android={android} desktop={desktop} />}
      {!pip && (
        <div className="toasts np-toasts" aria-live="polite">
          {toasts.map((t) => (
            <button key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)} tabIndex={-1}>
              {t.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
