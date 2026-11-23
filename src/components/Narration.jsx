// Narração do YouTube nos jogos ao vivo (lib/narration.js): escolha da live pelo nome do canal,
// favoritos, player pequeno no canto com o som da narração (o som do jogo fica mudo ou baixo),
// ajuste de sincronia (atrasar/adiantar) e, depois de 3 minutos, o convite para se inscrever no canal.
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import QrCode from './QrCode';
import { Modal } from './Overlays';
import { SMART_TV, hasNative, isTouch, native } from '../lib/device';
import { isTvMode } from '../lib/keys';
import { channelLive, isSubscribed, loadFavs, markSubscribed, queryFor, searchLives, subscribeUrl, toggleFav } from '../lib/narration';

const ASK_AFTER = 3 * 60e3; // convite para se inscrever depois de 3 min ouvindo
const ASK_AGAIN = 15 * 60e3; // "Agora não": pergunta de novo depois de 15 min
const openExternal = (url) => !SMART_TV && (hasNative('openUrl') ? native('openUrl', url) : window.open(url, '_blank', 'noopener'));
const offsetText = (o) => (o === 0 ? 'sincronia original' : o > 0 ? `narração ${o} s atrasada` : `narração ${-o} s adiantada`);

// Janela menor (picture-in-picture): tamanho, canto da tela e "inverter" (a live do YouTube em tela
// cheia e o jogo na janela menor). A janela nunca some: o YouTube exige o player visível (mín. 200 px).
export const NARR_SIZES = [
  { id: 's', label: 'Pequena' },
  { id: 'm', label: 'Média' },
  { id: 'l', label: 'Grande' },
];
export const NARR_CORNERS = [
  { id: 'br', label: 'Inferior direito', arrow: '↘' },
  { id: 'bl', label: 'Inferior esquerdo', arrow: '↙' },
  { id: 'tl', label: 'Superior esquerdo', arrow: '↖' },
  { id: 'tr', label: 'Superior direito', arrow: '↗' },
];
const VIEW_KEY = 'gates:narr:view';
const loadView = () => {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null') || {};
    return { size: NARR_SIZES.some((s) => s.id === v.size) ? v.size : 's', pos: NARR_CORNERS.some((c) => c.id === v.pos) ? v.pos : 'br', swap: false, hidden: false };
  } catch {
    return { size: 's', pos: 'br', swap: false, hidden: false };
  }
};
// Atraso da narração: o último ajuste fica guardado e vale como padrão para as próximas narrações.
const OFFSET_KEY = 'gates:narr:offset';
const loadOffset = () => {
  try {
    const n = Number(localStorage.getItem(OFFSET_KEY));
    return Number.isFinite(n) ? Math.round(n) : 0;
  } catch {
    return 0;
  }
};
const saveOffset = (n) => {
  try {
    localStorage.setItem(OFFSET_KEY, String(n));
  } catch {
    /* armazenamento cheio */
  }
};
const nextOf = (list, id) => list[(list.findIndex((x) => x.id === id) + 1) % list.length].id;

// Botões de sincronia. A narração do YouTube costuma chegar bem antes da TV (20 s a 1 min),
// por isso há passos grandes para atrasar.
const DELAYS = [1, 5, 10, 30];
const ADVANCES = [1, 5, 10];
function SyncButtons({ shift, offset, compact, autofocus }) {
  const tab = compact ? { tabIndex: -1 } : {};
  return (
    <>
      <div className="narr-sync">
        <span className="narr-sync-label">{compact ? 'Atrasar' : 'Atrasar a narração (ela está na frente do jogo)'}</span>
        {DELAYS.map((s, i) => (
          <button key={s} className="chip" {...tab} data-autofocus={autofocus && i === 1 ? true : undefined} onClick={() => shift(s)} title={`Atrasar a narração ${s} s`}>
            {s} s
          </button>
        ))}
      </div>
      <div className="narr-sync">
        <span className="narr-sync-label">{compact ? 'Adiantar' : 'Adiantar a narração (ela está atrás do jogo)'}</span>
        {ADVANCES.map((s) => (
          <button key={s} className="chip" {...tab} onClick={() => shift(-s)} title={`Adiantar a narração ${s} s`}>
            {s} s
          </button>
        ))}
        {offset !== 0 && (
          <button className="chip" {...tab} onClick={() => shift(-offset)} title="Voltar à sincronia original (sem atraso)">
            Zerar
          </button>
        )}
      </div>
    </>
  );
}

// Estado e controle da narração dentro do player. 'videoRef': o vídeo do jogo (fica mudo/baixo).
export function useNarration(videoRef, notify) {
  const [narr, setNarr] = useState(null); // { key, title, channel, channelId }
  const [offset, setOffset] = useState(loadOffset);
  const [gameVol, setGameVol] = useState(0); // som do jogo: 0 = mudo, 0.2 = baixo
  const [ask, setAsk] = useState(false);
  const [view, setViewState] = useState(loadView);
  const frame = useRef(null);

  // Tamanho e canto ficam guardados no aparelho; o "inverter" vale só para esta narração.
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ size: view.size, pos: view.pos }));
    } catch {
      /* armazenamento cheio */
    }
  }, [view.size, view.pos]);
  const setView = useCallback((patch) => setViewState((v) => ({ ...v, ...patch })), []);
  const cycleSize = useCallback(() => setViewState((v) => ({ ...v, size: nextOf(NARR_SIZES, v.size) })), []);
  const cycleCorner = useCallback(() => setViewState((v) => ({ ...v, pos: nextOf(NARR_CORNERS, v.pos) })), []);
  const toggleSwap = useCallback(() => setViewState((v) => ({ ...v, swap: !v.swap, hidden: false })), []);
  // Esconder: a janela some por completo e a narração continua tocando; "Mostrar" traz de volta.
  const toggleHidden = useCallback(() => setViewState((v) => ({ ...v, hidden: !v.hidden, swap: false })), []);
  const info = useRef({ t: 0, d: 0 });
  const timers = useRef([]);
  const pending = useRef(0); // atraso padrão a aplicar quando a live começar a tocar
  const moveRef = useRef(null);

  const stop = useCallback(() => {
    setNarr(null);
    setAsk(false);
    setViewState((v) => ({ ...v, swap: false, hidden: false }));
  }, []);
  const start = useCallback((n) => {
    info.current = { t: 0, d: 0 };
    setViewState((v) => ({ ...v, swap: false, hidden: false }));
    const saved = loadOffset();
    pending.current = saved;
    setOffset(saved);
    setNarr(n);
  }, []);

  // Som do jogo: mudo (ou baixo) enquanto a narração toca; volta ao normal ao desligar.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !narr) return undefined;
    const prev = { muted: v.muted, volume: v.volume };
    if (gameVol) {
      v.muted = false;
      v.volume = gameVol;
    } else v.muted = true;
    return () => {
      v.muted = prev.muted;
      v.volume = prev.volume;
    };
  }, [narr, gameVol, videoRef]);

  // Mensagens do player do YouTube: posição da live e erros (live que não permite tocar fora do YouTube).
  useEffect(() => {
    if (!narr) return undefined;
    const onMsg = (e) => {
      if (e.source !== frame.current?.contentWindow) return;
      let m;
      try {
        m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (m?.info?.currentTime != null) info.current.t = m.info.currentTime;
      if (m?.info?.duration != null) info.current.d = m.info.duration;
      if (m?.info?.playerState != null) info.current.s = m.info.playerState;
      // Live tocando: aplica o atraso padrão (o mesmo do último ajuste).
      if (pending.current && info.current.s === 1 && info.current.t > 0) {
        const p = pending.current;
        pending.current = 0;
        timers.current.push(setTimeout(() => moveRef.current?.(p, 0), 1500));
      }
      if (m?.event === 'onError') {
        notify(`A live de “${narr.channel}” não pode tocar fora do YouTube. Escolha outra narração.`, 'err');
        stop();
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [narr, notify, stop]);

  // Convite para se inscrever no canal da narração (uma vez por canal, quando ainda não é inscrito).
  useEffect(() => {
    if (!narr || isSubscribed(narr.channelId)) return undefined;
    const t = setTimeout(() => setAsk(true), ASK_AFTER);
    return () => clearTimeout(t);
  }, [narr]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const cmd = (func, args = []) => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  const listen = () => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');

  // Segura a narração d segundos (pausa e retoma do mesmo ponto): atrasa mesmo sem a posição da live.
  const hold = (d) => {
    cmd('pauseVideo');
    timers.current.push(setTimeout(() => cmd('playVideo'), d * 1000));
  };

  // d > 0: atrasa a narração d segundos (volta a live do YouTube; se a live não deixar voltar,
  // segura a narração pelo mesmo tempo). d < 0: adianta — desfaz primeiro o atraso já aplicado
  // ('cur', avançando a live); o que passar disso segura o vídeo do jogo pelo mesmo tempo.
  const move = (d, cur) => {
    const { t } = info.current;
    if (d > 0) {
      if (t > d + 1) {
        const target = t - d;
        cmd('seekTo', [target, true]);
        // Confere depois de 2,5 s: se a posição não voltou, a live não tem DVR — segura a narração.
        timers.current.push(setTimeout(() => info.current.t > target + 7 && hold(d), 2500));
      } else hold(d);
      return;
    }
    const back = Math.max(0, Math.min(-d, cur));
    if (back) cmd('seekTo', [t + back, true]);
    const rest = -d - back;
    const v = videoRef.current;
    if (rest > 0 && v && !v.paused) {
      v.pause();
      timers.current.push(setTimeout(() => v.play().catch(() => {}), rest * 1000));
    }
  };
  moveRef.current = move;
  const shift = (d) => {
    if (!d) return;
    pending.current = 0;
    move(d, offset);
    const n = offset + d;
    setOffset(n);
    saveOffset(n);
    notify(`Sincronia: ${offsetText(n)}.`);
  };

  const answer = (subscribed) => {
    setAsk(false);
    if (subscribed) markSubscribed(narr.channelId);
    else {
      const id = narr.channelId;
      timers.current.push(setTimeout(() => !isSubscribed(id) && setAsk(true), ASK_AGAIN));
    }
  };

  const origin = encodeURIComponent(window.location.origin);
  const dock = narr && (
    <div className="narr-dock">
      <iframe
        key={narr.key}
        ref={frame}
        onLoad={listen}
        src={`https://www.youtube-nocookie.com/embed/${narr.key}?autoplay=1&controls=1&rel=0&modestbranding=1&playsinline=1&fs=0&enablejsapi=1&hl=pt-BR&origin=${origin}`}
        title={`Narração: ${narr.channel}`}
        allow="autoplay; encrypted-media"
        tabIndex={-1}
      />
      <div className="narr-bar">
        <Icon name="volume" size={14} />
        <strong title={narr.title}>{narr.channel}</strong>
        <small className="muted">{offsetText(offset)}</small>
      </div>
      {!isTvMode() && (
        <div className="narr-sync narr-win">
          <button className="chip" tabIndex={-1} onClick={cycleSize} title="Mudar o tamanho da janela da narração">
            <Icon name="fullscreen" size={12} /> {NARR_SIZES.find((s) => s.id === view.size).label}
          </button>
          <button className="chip" tabIndex={-1} onClick={cycleCorner} title="Levar a janela para outro canto da tela">
            {NARR_CORNERS.find((c) => c.id === view.pos).arrow} Canto
          </button>
          <button className={`chip ${view.swap ? 'active' : ''}`} tabIndex={-1} onClick={toggleSwap} title="Inverter: a live do YouTube em tela cheia e o jogo na janela menor">
            <Icon name="refresh" size={12} /> Inverter
          </button>
          <button className="chip" tabIndex={-1} onClick={toggleHidden} title="Esconder a janela (a narração continua tocando)">
            <Icon name="eye" size={12} /> Esconder
          </button>
          <button className="chip" tabIndex={-1} onClick={stop} title="Desligar a narração (volta o som do jogo)">
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
      {!isTvMode() && <SyncButtons shift={shift} offset={offset} compact />}
    </div>
  );

  const askModal = narr && ask && (
    <Modal onClose={() => answer(false)} title={`Inscreva-se no canal ${narr.channel}`} className="narr-ask">
      <p>
        Gostando da narração? Inscreva-se no canal <b>{narr.channel}</b> no YouTube para apoiar quem narra
        {isTvMode() ? ': aponte a câmera do celular para o código.' : '.'}
      </p>
      <div className="narr-qr">
        <QrCode text={subscribeUrl(narr.channelId)} size={180} />
      </div>
      <div className="narr-ask-actions">
        {!isTvMode() && !SMART_TV && (
          <button className="btn" onClick={() => openExternal(subscribeUrl(narr.channelId))}>
            <Icon name="link" size={16} /> Abrir o canal no YouTube
          </button>
        )}
        <button className="btn" data-autofocus onClick={() => answer(true)}>
          <Icon name="heart" size={16} /> Já sou inscrito
        </button>
        <button className="btn ghost" onClick={() => answer(false)}>
          Agora não
        </button>
      </div>
    </Modal>
  );

  // Classes no <div className="player">: posicionam a janela menor (a narração ou, invertido, o jogo).
  const wrapClass = narr ? `narr-on narr-${view.size} narr-${view.pos}${view.swap ? ' narr-swap' : ''}${view.hidden ? ' narr-hidden' : ''}` : '';

  return { narr, start, stop, shift, offset, gameVol, setGameVol, dock, askModal, view, setView, cycleSize, cycleCorner, toggleSwap, toggleHidden, wrapClass };
}

// Uma linha de narração (live): toca ao escolher; a estrela favorita o canal.
function LiveRow({ l, fav, onPick, onFav, current }) {
  return (
    <div className={`narr-row ${current ? 'on' : ''}`}>
      <button className="narr-pick" onClick={() => onPick(l)}>
        <strong>{l.channel}</strong>
        <span className="muted">{l.title}</span>
        {l.viewers && <small className="narr-live">● AO VIVO · {l.viewers}</small>}
      </button>
      <button className={`icon-btn ${fav ? 'on' : ''}`} onClick={() => onFav({ id: l.channelId, name: l.channel }, l)} aria-label={fav ? `Tirar ${l.channel} dos favoritos` : `Favoritar ${l.channel}`}>
        <Icon name="star" filled={fav} />
      </button>
    </div>
  );
}

// Janela de escolha: favoritos (com quem está ao vivo agora), busca pelo nome do canal ou do jogo,
// e — com a narração ligada — sincronia e som do jogo.
export function NarrationPicker({ n, game, title, onClose }) {
  const [favs, setFavs] = useState(loadFavs);
  const [favLive, setFavLive] = useState({}); // id -> { loading } | live | null
  const [q, setQ] = useState(() => queryFor(game));
  const [res, setRes] = useState({ loading: true });
  const favIds = new Set(favs.map((f) => f.id));

  const search = async (e) => {
    e?.preventDefault();
    const term = q.trim();
    if (term.length < 2) return;
    setRes({ loading: true });
    try {
      setRes({ list: await searchLives(term) });
    } catch {
      setRes({ error: 'Não foi possível buscar no YouTube agora. Verifique a internet e tente de novo.' });
    }
  };
  useEffect(() => {
    search();
    let alive = true;
    for (const f of loadFavs()) {
      setFavLive((s) => ({ ...s, [f.id]: { loading: true } }));
      channelLive(f.id)
        .then((live) => alive && setFavLive((s) => ({ ...s, [f.id]: live })))
        .catch(() => alive && setFavLive((s) => ({ ...s, [f.id]: null })));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Favoritar uma live da busca: já sabemos que o canal está ao vivo.
  const fav = (c, l) => {
    setFavs(toggleFav(c));
    if (l?.key) setFavLive((s) => ({ ...s, [c.id]: { key: l.key, title: l.title } }));
  };
  const pick = (l) => {
    n.start({ key: l.key, title: l.title, channel: l.channel, channelId: l.channelId });
    onClose();
  };

  return (
    <Modal onClose={onClose} title="Narração do YouTube" className="narr-modal">
      {n.narr && (
        <section className="narr-sec">
          <h3>
            Ouvindo: {n.narr.channel} <small className="muted">· {offsetText(n.offset)}</small>
          </h3>
          <p className="muted">A narração está na frente do jogo? Atrase. Está atrás? Adiante. O ajuste fica salvo e vale para as próximas narrações.</p>
          <SyncButtons shift={n.shift} offset={n.offset} autofocus />
          <div className="narr-sync">
            <button className={`chip ${!n.gameVol ? 'active' : ''}`} onClick={() => n.setGameVol(0)}>Som do jogo: mudo</button>
            <button className={`chip ${n.gameVol ? 'active' : ''}`} onClick={() => n.setGameVol(0.2)}>Som do jogo: baixo</button>
            <button className="chip" onClick={() => (n.stop(), onClose())}>
              <Icon name="close" size={12} /> Desligar narração
            </button>
          </div>
          <h3 className="narr-sub">Janela da narração</h3>
          <div className="narr-sync">
            {NARR_SIZES.map((s) => (
              <button key={s.id} className={`chip ${n.view.size === s.id ? 'active' : ''}`} onClick={() => n.setView({ size: s.id })}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="narr-sync">
            {NARR_CORNERS.map((c) => (
              <button key={c.id} className={`chip ${n.view.pos === c.id ? 'active' : ''}`} onClick={() => n.setView({ pos: c.id })} title={c.label}>
                {c.arrow} {c.label}
              </button>
            ))}
          </div>
          <div className="narr-sync">
            <button className={`chip ${n.view.swap ? 'active' : ''}`} onClick={n.toggleSwap}>
              <Icon name="refresh" size={12} /> {n.view.swap ? 'Voltar: jogo em tela cheia' : 'Inverter: narração em tela cheia e jogo na janela'}
            </button>
            <button className={`chip ${n.view.hidden ? 'active' : ''}`} onClick={n.toggleHidden}>
              <Icon name="eye" size={12} /> {n.view.hidden ? 'Mostrar a janela' : 'Esconder a janela (só o som)'}
            </button>
          </div>
        </section>
      )}
      {favs.length > 0 && (
        <section className="narr-sec">
          <h3>Meus narradores</h3>
          {favs.map((f) => {
            const live = favLive[f.id];
            return live?.key ? (
              <LiveRow key={f.id} l={{ ...live, channel: f.name, channelId: f.id }} fav current={n.narr?.channelId === f.id} onPick={pick} onFav={fav} />
            ) : (
              <div key={f.id} className="narr-row off">
                <div className="narr-pick">
                  <strong>{f.name}</strong>
                  <span className="muted">{live?.loading ? 'Verificando se está ao vivo…' : 'Não está ao vivo agora'}</span>
                </div>
                <button className="icon-btn on" onClick={() => setFavs(toggleFav(f))} aria-label={`Tirar ${f.name} dos favoritos`}>
                  <Icon name="star" filled />
                </button>
              </div>
            );
          })}
        </section>
      )}
      <section className="narr-sec">
        <h3>Narrações ao vivo</h3>
        <form className="ck-add-form" onSubmit={search}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome do canal ou do jogo" enterKeyHint="search" />
          <button className="btn" type="submit" disabled={q.trim().length < 2 || res.loading}>
            {res.loading ? <span className="spinner sm" /> : <Icon name="search" size={16} />} Buscar
          </button>
        </form>
        {res.error && <p className="muted">{res.error}</p>}
        {res.list && !res.list.length && <p className="muted">Nenhuma live encontrada. Tente o nome do canal do narrador.</p>}
        {res.list?.map((l) => (
          <LiveRow key={l.key} l={l} fav={favIds.has(l.channelId)} current={n.narr?.key === l.key} onPick={pick} onFav={fav} />
        ))}
        {isTouch && <p className="muted narr-hint">Toque na estrela para guardar o canal em “Meus narradores”.</p>}
      </section>
    </Modal>
  );
}
