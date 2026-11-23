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

// Estado e controle da narração dentro do player. 'videoRef': o vídeo do jogo (fica mudo/baixo).
export function useNarration(videoRef, notify) {
  const [narr, setNarr] = useState(null); // { key, title, channel, channelId }
  const [offset, setOffset] = useState(0);
  const [gameVol, setGameVol] = useState(0); // som do jogo: 0 = mudo, 0.2 = baixo
  const [ask, setAsk] = useState(false);
  const frame = useRef(null);
  const info = useRef({ t: 0, d: 0 });
  const timers = useRef([]);

  const stop = useCallback(() => {
    setNarr(null);
    setAsk(false);
  }, []);
  const start = useCallback((n) => {
    info.current = { t: 0, d: 0 };
    setOffset(0);
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

  // d > 0: atrasa a narração d segundos (volta a live do YouTube). d < 0: adianta — avança a live
  // se ela estiver atrás do ao vivo; senão, segura o vídeo do jogo pelo mesmo tempo.
  const shift = (d) => {
    const { t, d: dur } = info.current;
    if (d > 0) cmd('seekTo', [Math.max(0, t - d), true]);
    else if (dur && dur - t > -d + 2) cmd('seekTo', [t - d, true]);
    else {
      const v = videoRef.current;
      if (v && !v.paused) {
        v.pause();
        timers.current.push(setTimeout(() => v.play().catch(() => {}), -d * 1000));
      }
    }
    setOffset((o) => {
      const n = o + d;
      notify(`Sincronia: ${offsetText(n)}.`);
      return n;
    });
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
        <div className="narr-sync">
          <button className="chip" tabIndex={-1} onClick={() => shift(5)} title="Atrasar a narração 5 s (ela está na frente do vídeo)">
            −5 s
          </button>
          <button className="chip" tabIndex={-1} onClick={() => shift(1)} title="Atrasar a narração 1 s">
            −1 s
          </button>
          <button className="chip" tabIndex={-1} onClick={() => shift(-1)} title="Adiantar a narração 1 s">
            +1 s
          </button>
          <button className="chip" tabIndex={-1} onClick={() => shift(-5)} title="Adiantar a narração 5 s (ela está atrás do vídeo)">
            +5 s
          </button>
          <button className="chip" tabIndex={-1} onClick={stop} title="Desligar a narração (volta o som do jogo)">
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
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

  return { narr, start, stop, shift, offset, gameVol, setGameVol, dock, askModal };
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
          <p className="muted">A narração está na frente do vídeo? Atrase. Está atrás? Adiante.</p>
          <div className="narr-sync">
            <button className="chip" data-autofocus onClick={() => n.shift(5)}>Atrasar 5 s</button>
            <button className="chip" onClick={() => n.shift(1)}>Atrasar 1 s</button>
            <button className="chip" onClick={() => n.shift(-1)}>Adiantar 1 s</button>
            <button className="chip" onClick={() => n.shift(-5)}>Adiantar 5 s</button>
          </div>
          <div className="narr-sync">
            <button className={`chip ${!n.gameVol ? 'active' : ''}`} onClick={() => n.setGameVol(0)}>Som do jogo: mudo</button>
            <button className={`chip ${n.gameVol ? 'active' : ''}`} onClick={() => n.setGameVol(0.2)}>Som do jogo: baixo</button>
            <button className="chip" onClick={() => (n.stop(), onClose())}>
              <Icon name="close" size={12} /> Desligar narração
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
