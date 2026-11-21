// Áreas do YouTube (CLARK, Sergio, Paula; para assinantes: Youtube e Youtube Crianças): canais com os
// vídeos mais recentes, vídeos avulsos, sugestões e canais adicionados pelo nome (lib/clark.js: YT_AREAS).
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useStore } from '../store';
import { PageHeader, Row } from '../components/Media';
import Icon from '../components/Icon';
import { areaById, areasFor, channelVideos, searchChannels, thumb } from '../lib/clark';
import { useKeyHandler } from '../lib/keys';
import { native } from '../lib/device';

// Canais adicionados em cada área (guardados no aparelho).
const loadAdded = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
};

function VideoCard({ v, onPlay, sub }) {
  return (
    <button className="ck-card" onClick={onPlay} title={v.title}>
      <span className="ck-thumb">
        <img src={thumb(v.key)} alt="" loading="lazy" />
        <Icon name="play" size={28} />
      </span>
      <span className="ck-title">{v.title}</span>
      {sub && <span className="ck-sub muted">{sub}</span>}
    </button>
  );
}

// Uma fileira por canal, com os vídeos mais recentes.
function ChannelRow({ ch, onPlay, onRemove }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    channelVideos(ch.id)
      .then((list) => alive && setState({ list }))
      .catch(() => alive && setState({ error: true }));
    return () => {
      alive = false;
    };
  }, [ch.id]);
  return (
    <div className="ck-channel">
      {onRemove && (
        <button className="btn ghost small ck-remove" onClick={onRemove}>
          <Icon name="trash" size={14} /> Tirar do menu
        </button>
      )}
      <Row title={ch.name}>
        {state.loading && <span className="muted ck-msg">Carregando vídeos…</span>}
        {state.error && <span className="muted ck-msg">Não foi possível carregar os vídeos deste canal agora.</span>}
        {state.list?.map((v, i) => (
          <VideoCard key={v.key} v={v} onPlay={() => onPlay(state.list, i)} />
        ))}
      </Row>
    </div>
  );
}

// Player do YouTube em tela cheia, controlado pelo controle remoto:
// OK pausa/continua · ◀ ▶ 10 s · ▲ ▼ vídeo anterior/próximo · Voltar fecha.
function YtPlayer({ list, start, onClose }) {
  const [i, setI] = useState(start);
  const v = list[i];
  const frame = useRef(null);
  const info = useRef({ t: 0, state: -1 });
  const close = useRef(onClose);
  close.current = onClose;
  const next = () => setI((x) => (x < list.length - 1 ? x + 1 : x));
  const prev = () => setI((x) => (x > 0 ? x - 1 : x));
  const cmd = (func, args = []) => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  useEffect(() => {
    native('setPlayerMode', true);
    return () => native('setPlayerMode', false);
  }, []);
  useEffect(() => {
    info.current = { t: 0, state: -1 };
    const onMsg = (e) => {
      if (!/youtube/.test(e.origin || '')) return;
      let m;
      try {
        m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (m?.info?.currentTime != null) info.current.t = m.info.currentTime;
      const st = m?.event === 'onStateChange' ? m.info : m?.info?.playerState;
      if (st != null) info.current.state = st;
      if (st === 0) setI((x) => (x < list.length - 1 ? x + 1 : x)); // acabou: próximo vídeo
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [i, list.length]);
  useKeyHandler((k) => {
    if (k === 'back') close.current();
    else if (k === 'ok' || k === 'playpause') cmd(info.current.state === 1 ? 'pauseVideo' : 'playVideo');
    else if (k === 'play') cmd('playVideo');
    else if (k === 'pause') cmd('pauseVideo');
    else if (k === 'left') cmd('seekTo', [Math.max(0, info.current.t - 10), true]);
    else if (k === 'right') cmd('seekTo', [info.current.t + 10, true]);
    else if (k === 'up' || k === 'prev') prev();
    else if (k === 'down' || k === 'next') next();
    return true;
  });
  const listen = () => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
  const origin = encodeURIComponent(window.location.origin);
  return (
    <div className="ck-player" data-nav-root>
      <iframe
        key={v.key}
        ref={frame}
        onLoad={listen}
        src={`https://www.youtube-nocookie.com/embed/${v.key}?autoplay=1&controls=1&rel=0&modestbranding=1&playsinline=1&fs=0&enablejsapi=1&hl=pt-BR&cc_lang_pref=pt&origin=${origin}`}
        title={v.title}
        allow="autoplay; encrypted-media; picture-in-picture"
        tabIndex={-1}
      />
      <div className="ck-bar">
        <button className="icon-btn" onClick={onClose} aria-label="Fechar" tabIndex={-1}>
          <Icon name="back" />
        </button>
        <strong>{v.title}</strong>
        {list.length > 1 && (
          <span className="ck-nav">
            <button className="icon-btn" onClick={prev} disabled={i === 0} aria-label="Vídeo anterior" tabIndex={-1}>
              <Icon name="prev" />
            </button>
            <small className="muted">
              {i + 1} de {list.length}
            </small>
            <button className="icon-btn" onClick={next} disabled={i === list.length - 1} aria-label="Próximo vídeo" tabIndex={-1}>
              <Icon name="next" />
            </button>
          </span>
        )}
        <small className="muted ck-hint">OK pausa · ◀ ▶ 10 s · ▲ ▼ outro vídeo · Voltar fecha</small>
      </div>
    </div>
  );
}

// Adicionar um canal pelo nome: busca no YouTube e mostra os canais encontrados para escolher.
function AddChannel({ fixedChannels, added, onAdd, first }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState(null); // { loading } | { list } | { error }
  const fixed = new Set([...fixedChannels, ...added].map((c) => c.id));
  const search = async (e) => {
    e?.preventDefault();
    const name = q.trim();
    if (name.length < 2) return;
    setState({ loading: true });
    try {
      setState({ list: await searchChannels(name) });
    } catch {
      setState({ error: 'Não foi possível buscar agora. Verifique a internet e tente de novo.' });
    }
  };
  return (
    <section className="row ck-add">
      <div className="row-head">
        <h2>Adicionar canal pelo nome</h2>
      </div>
      {first && <p className="muted">Ainda não há canais aqui. Digite o nome de um canal do YouTube que você gosta e toque em “Buscar”.</p>}
      <form className="ck-add-form" onSubmit={search}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome do canal no YouTube" enterKeyHint="search" />
        <button className="btn" type="submit" disabled={q.trim().length < 2 || state?.loading}>
          {state?.loading ? <span className="spinner sm" /> : <Icon name="search" size={16} />} Buscar
        </button>
      </form>
      {state?.error && <p className="muted">{state.error}</p>}
      {state?.list && !state.list.length && <p className="muted">Nenhum canal encontrado com esse nome.</p>}
      {state?.list?.length > 0 && (
        <div className="ck-sug-list">
          {state.list.map((c) => (
            <div key={c.id} className="ck-sug">
              {c.photo && <img className="ck-avatar" src={c.photo} alt="" loading="lazy" />}
              <div>
                <strong>
                  {c.name} {c.verified && <Icon name="shield" size={13} />}
                </strong>
                <span className="muted">{c.about || 'Canal do YouTube'}</span>
              </div>
              {fixed.has(c.id) ? (
                <span className="muted">no menu</span>
              ) : (
                <button className="btn small" onClick={() => onAdd({ id: c.id, name: c.name, about: c.about })}>
                  <Icon name="plus" size={14} /> Adicionar
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function YoutubeArea({ area }) {
  const [added, setAdded] = useState(() => loadAdded(area.store));
  const [playing, setPlaying] = useState(null); // { list, start }
  const save = (l) => {
    setAdded(l);
    try {
      localStorage.setItem(area.store, JSON.stringify(l));
    } catch {
      /* armazenamento cheio */
    }
  };
  const videos = area.videos || [];
  const addedIds = new Set(added.map((c) => c.id));
  const suggestions = (area.suggestions || []).filter((s) => !addedIds.has(s.id));
  const play = (list, start = 0) => setPlaying({ list, start });
  const empty = !area.channels.length && !added.length && !videos.length;
  const addChannel = <AddChannel fixedChannels={area.channels} added={added} first={empty} onAdd={(c) => save([...added.filter((x) => x.id !== c.id), c])} />;

  return (
    <div className="clark">
      <PageHeader title={area.title} />
      {empty && addChannel}
      {videos.length > 0 && (
        <Row title="Vídeos">
          {videos.map((v, i) => (
            <VideoCard key={v.key} v={v} sub={v.sub} onPlay={() => play(videos, i)} />
          ))}
        </Row>
      )}
      {area.channels.map((ch) => (
        <ChannelRow key={ch.id} ch={ch} onPlay={play} />
      ))}
      {added.map((ch) => (
        <ChannelRow key={ch.id} ch={ch} onPlay={play} onRemove={() => save(added.filter((c) => c.id !== ch.id))} />
      ))}
      {suggestions.length > 0 && (
        <section className="row ck-suggest">
          <div className="row-head">
            <h2>Sugestões de canais parecidos</h2>
          </div>
          <p className="muted">Toque em “Adicionar” para o canal entrar no menu com os vídeos mais recentes.</p>
          <div className="ck-sug-list">
            {suggestions.map((s) => (
              <div key={s.id} className="ck-sug">
                <div>
                  <strong>{s.name}</strong>
                  <span className="muted">{s.about}</span>
                </div>
                <button className="btn small" onClick={() => save([...added, s])}>
                  <Icon name="plus" size={14} /> Adicionar
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {!empty && addChannel}
      {playing && <YtPlayer list={playing.list} start={playing.start} onClose={() => setPlaying(null)} />}
    </div>
  );
}

// Rota /clark e /yt/:area (perfis infantis só abrem as áreas infantis).
export default function YoutubeAreaPage({ id }) {
  const params = useParams();
  const { profile } = useStore();
  const area = areaById(id || params.area);
  if (!area || (profile?.kids && !area.kidsOk)) return <Navigate to="/yt" replace />;
  return <YoutubeArea key={area.id} area={area} />;
}

// /yt: as áreas disponíveis para o perfil (atalho da barra de baixo no celular).
export function YoutubeHub() {
  const { profile } = useStore();
  const areas = areasFor(profile);
  return (
    <div className="clark">
      <PageHeader title="YouTube" />
      {!areas.length && <p className="muted">Nenhuma área do YouTube disponível neste perfil.</p>}
      <div className="yt-hub">
        {areas.map((a) => (
          <Link key={a.id} to={a.path} className="yt-hub-card">
            <Icon name={a.icon} size={28} />
            <strong>{a.title}</strong>
            <span className="muted">{a.channels.length ? `${a.channels.length} canais` : 'seus canais'}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
