import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../store';
import { Empty, PageHeader, RatingBadge, Thumb } from '../components/Media';
import Icon from '../components/Icon';
import { fmtTime, nowNext, progressOf, useNow } from '../lib/epg';
import { pickWorking, zapGroups } from '../lib/zapping';
import { LIVE_AUTOPLAY_LABEL } from '../config/content';
import { STATES } from '../config/regions';
import { isDemo } from '../lib/device';
import { PERF } from '../config/perf';
import { useRestoredState } from '../lib/scrollMemory';

const ALL = 'Todos os canais';
const FAV = 'Favoritos';

export default function LiveTV() {
  const store = useStore();
  const { catalog, play, playing, isFavorite, toggleFavorite, favorites, loading, programmesFor, openMenu, openProgram, isRestricted, ratingOf, liveHealth, settings, updateSettings } = store;

  // Ao entrar em TV ao Vivo, abre direto a Globo do estado do cliente (ou a padrão), na versão que
  // estiver no ar, e a tela por trás do player passa a ser o Início: ao sair do player o cliente
  // volta para o Início, não para esta lista. (Na degustação a lista continua sendo a tela.)
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const autoplayed = useRef(false);
  const [leaving, setLeaving] = useState(!isDemo);
  useEffect(() => {
    if (autoplayed.current || loading || !catalog.live.length || (!isDemo && !settings.uf)) return;
    autoplayed.current = true;
    if (playing) return setLeaving(false);
    const groups = zapGroups(catalog.live, settings.uf);
    const g =
      groups.find((x) => x.region && /^Globo/.test(x.label)) ||
      groups.find((x) => x.label === LIVE_AUTOPLAY_LABEL) ||
      groups[0];
    const ch = g && pickWorking(g.candidates, liveHealth);
    if (!ch) return setLeaving(false);
    play(ch, catalog.live);
    if (!isDemo) navigate('/', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, catalog.live.length, settings.uf]);
  const group = params.get('g') || ALL;
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useRestoredState('liveLimit', PERF.liveBatch);
  const firstChannels = useRef(true);
  const sentinel = useRef(null);
  const now = useNow(30000);

  const groups = useMemo(() => {
    const m = new Map();
    for (const c of catalog.live) m.set(c.group, (m.get(c.group) || 0) + 1);
    return [...m.entries()];
  }, [catalog.live]);

  const channels = useMemo(() => {
    let list = catalog.live;
    if (group === FAV) list = list.filter((c) => favorites.includes(c.id));
    else if (group !== ALL) list = list.filter((c) => c.group === group);
    if (filter) {
      const f = filter.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(f) || String(c.num) === f);
    }
    return list;
  }, [catalog.live, group, filter, favorites]);

  useEffect(() => {
    if (firstChannels.current) return void (firstChannels.current = false);
    setLimit(PERF.liveBatch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setLimit((l) => l + PERF.liveBatch), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [channels.length, limit]);

  if (!isDemo && !settings.uf && catalog.live.length) return <StatePicker onPick={(uf) => updateSettings({ uf })} />;
  if (loading || leaving) return <div className="loading"><div className="spinner" /></div>;
  if (!catalog.live.length) return <Empty title="Nenhum canal ao vivo">Sua lista ainda não tem canais ao vivo.</Empty>;

  const select = (g) => setParams(g === ALL ? {} : { g }, { replace: true });

  return (
    <div className="live">
      <aside className="live-groups">
        {[[ALL, catalog.live.length], [FAV, catalog.live.filter((c) => favorites.includes(c.id)).length], ...groups].map(([g, n]) => (
          <button key={g} className={`group-item ${g === group ? 'active' : ''}`} onClick={() => select(g)}>
            <span>{g}</span>
            <em>{n}</em>
          </button>
        ))}
      </aside>

      <div className="live-main">
        <PageHeader title={group} count={channels.length}>
          <label className="search small">
            <Icon name="search" size={16} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar por nome ou número" />
          </label>
        </PageHeader>
        <p className="muted hint-line">
          <Icon name="remote" size={16} /> No controle: OK assiste · segure OK (ou Menu) para ocultar, bloquear ou excluir ·
          Info mostra o programa atual
        </p>

        <div className="guide">
          {channels.slice(0, limit).map((c) => {
            const { now: cur, next } = nowNext(programmesFor(c), now);
            const restricted = isRestricted(c);
            const age = ratingOf(c);
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                data-longpress={c.id}
                className={`guide-row ${playing?.item.id === c.id ? 'active' : ''}`}
                onClick={() => play(c, channels)}
                onContextMenu={(e) => (e.preventDefault(), openMenu(c))}
              >
                <span className="guide-num">{c.num}</span>
                <div className="guide-logo">
                  <Thumb src={c.logo} name={c.name} contain />
                </div>
                <div className="guide-info">
                  <strong>
                    {c.name}
                    {restricted && <Icon name="lock" size={14} className="inline-lock" />}
                  </strong>
                  <span>{c.group}</span>
                </div>
                <div className="guide-now">
                  {cur ? (
                    <>
                      <div className="guide-prog">
                        <strong>{cur.title}</strong>
                        <RatingBadge age={age} />
                        <span>
                          {fmtTime(cur.start)} – {fmtTime(cur.stop)}
                        </span>
                      </div>
                      <div className="guide-bar">
                        <span style={{ width: `${progressOf(cur, now) * 100}%` }} />
                      </div>
                      {next && (
                        <small className="guide-next">
                          A seguir {fmtTime(next.start)} · {next.title}
                        </small>
                      )}
                    </>
                  ) : next ? (
                    <small className="guide-next">
                      A seguir {fmtTime(next.start)} · {next.title}
                    </small>
                  ) : (
                    <span className="muted small">Sem guia de programação</span>
                  )}
                </div>
                <button
                  tabIndex={-1}
                  className="icon-btn"
                  disabled={!cur}
                  onClick={(e) => (e.stopPropagation(), openProgram({ item: c, prog: cur }))}
                  aria-label="Detalhes do programa"
                  title="Detalhes do programa"
                >
                  <Icon name="info" size={18} />
                </button>
                <button
                  tabIndex={-1}
                  className={`icon-btn fav ${isFavorite(c.id) ? 'on' : ''}`}
                  onClick={(e) => (e.stopPropagation(), toggleFavorite(c.id))}
                  aria-label="Favoritar"
                >
                  <Icon name="heart" size={18} filled={isFavorite(c.id)} />
                </button>
                <button
                  tabIndex={-1}
                  className="icon-btn"
                  onClick={(e) => (e.stopPropagation(), openMenu(c))}
                  aria-label="Opções"
                  title="Ocultar, bloquear, excluir…"
                >
                  <Icon name="more" size={18} />
                </button>
              </div>
            );
          })}
          {limit < channels.length && <div ref={sentinel} className="grid-sentinel" />}
          {!channels.length && <p className="muted pad">Nenhum canal encontrado.</p>}
        </div>
      </div>
    </div>
  );
}

// Primeira vez em TV ao Vivo: pergunta o estado para pôr a Globo e a Record dele em primeiro.
function StatePicker({ onPick }) {
  return (
    <div className="uf-picker">
      <h2>Em qual estado você está?</h2>
      <p className="muted">A Globo e a Record do seu estado vão aparecer primeiro na lista de canais. Dá para mudar depois em Configurações.</p>
      <div className="uf-grid">
        {STATES.map((s, i) => (
          <button key={s.uf} className="chip" data-autofocus={i === 0 ? true : undefined} onClick={() => onPick(s.uf)}>
            {s.name}
          </button>
        ))}
      </div>
      <button className="link-btn" onClick={() => onPick('-')}>
        Prefiro não informar
      </button>
    </div>
  );
}
