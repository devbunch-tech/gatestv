import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { Card, Empty, Row, Thumb } from '../components/Media';
import Icon from '../components/Icon';
import { providerItems, recentUnique, splitGame, upcomingGames } from '../lib/home';
import { HOME_CACHE_DAYS, PROVIDER_ROW_LIMIT, PROVIDER_ROWS, PROVIDERS } from '../config/homeSections';
import { PlatformTitle } from '../components/Platform';
import { fmtTime, progressOf, useNow } from '../lib/epg';
import { findChannels, pickFeatured, todaysEvents, useTeamBadges } from '../lib/sports';
import { initials } from '../components/Media';
import { PERF } from '../config/perf';

function dayLabel(ts, now) {
  const d = new Date(ts);
  const diff = Math.round((new Date(d.toDateString()) - new Date(new Date(now).toDateString())) / 864e5);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

function Crest({ src, name, size = 44 }) {
  const [err, setErr] = useState(false);
  return (
    <span className="crest" style={{ width: size, height: size }}>
      {src && !err ? <img src={src} alt="" loading="lazy" onError={() => setErr(true)} /> : <span>{initials(name || '?')}</span>}
    </span>
  );
}

// ---------- Destaques do dia (agenda oficial + canal do EPG) ----------
function FeaturedGame({ evt, now, channels }) {
  const { play, openProgram, catalog, notify } = useStore();
  const live = evt.start <= now && now < evt.end;
  const ch = channels[0];
  const open = () => {
    if (!ch) return notify(`Nenhum canal da sua lista exibe ${evt.home} x ${evt.away} no guia de programação.`);
    if (live) play(ch.channel, catalog.live);
    else openProgram({ item: ch.channel, prog: ch.prog });
  };
  const score = live && evt.homeScore != null && evt.awayScore != null ? `${evt.homeScore} – ${evt.awayScore}` : null;
  return (
    <button className={`featured-game ${live ? 'is-live' : ''}`} onClick={open} title={`${evt.home} x ${evt.away}`}>
      <div className="fg-poster" style={evt.poster ? { backgroundImage: `url("${evt.poster}")` } : undefined} />
      <div className="fg-shade" />
      <div className="fg-top">
        {evt.leagueBadge && <img className="fg-league" src={evt.leagueBadge} alt="" />}
        <div className="fg-league-text">
          <strong>{evt.leagueName}</strong>
          {evt.round && <span>{evt.round}</span>}
        </div>
        {live ? <span className="badge-live static">AO VIVO</span> : <span className="fg-when">{dayLabel(evt.start, now)}</span>}
      </div>
      <div className="fg-teams">
        <div className="fg-team">
          <Crest src={evt.homeBadge} name={evt.home} size={72} />
          <strong>{evt.home}</strong>
        </div>
        <div className="fg-center">{score ? <span className="fg-score">{score}</span> : <span className="fg-time">{fmtTime(evt.start)}</span>}</div>
        <div className="fg-team">
          <Crest src={evt.awayBadge} name={evt.away} size={72} />
          <strong>{evt.away}</strong>
        </div>
      </div>
      {live && (
        <div className="lb-progress fg-progress">
          <span style={{ width: `${progressOf({ start: evt.start, stop: evt.end }, now) * 100}%` }} />
        </div>
      )}
      <div className="fg-channel">
        {ch ? (
          <>
            <div className="game-logo">
              <Thumb src={ch.channel.logo} name={ch.channel.name} contain />
            </div>
            <span>
              {ch.channel.name}
              {channels.length > 1 && <em> +{channels.length - 1} canal(is)</em>}
            </span>
            <Icon name={live ? 'play' : 'info'} size={16} />
          </>
        ) : (
          <span className="muted">{evt.venue || 'Canal não identificado no seu guia'}</span>
        )}
      </div>
    </button>
  );
}

function FeaturedGames({ now }) {
  const { catalog, programmesFor } = useStore();
  const [events, setEvents] = useState(null);
  const minute = Math.floor(now / 60000);
  useEffect(() => {
    let alive = true;
    todaysEvents(Date.now())
      .then((e) => alive && setEvents(e))
      .catch(() => alive && setEvents([]));
    return () => {
      alive = false;
    };
    // Recarrega a cada 10 minutos (a API é consultada com cache).
  }, [Math.floor(minute / 10)]);
  const channelsOf = useMemo(() => {
    const m = new Map();
    for (const e of events || []) m.set(e.id, findChannels(e, catalog.live, programmesFor));
    return m;
  }, [events, catalog.live, programmesFor]);
  const featured = useMemo(
    // Só jogos que têm canal na lista para assistir (sem fonte, o card não aparece).
    () => (events ? pickFeatured(events.filter((e) => channelsOf.get(e.id)?.length > 0), now).slice(0, PERF.featuredGames) : []),
    [events, channelsOf, minute] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const track = useRef(null);
  const scroll = (dir) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.85, behavior: 'smooth' });
  if (!featured.length) return null;
  return (
    <section className="featured">
      <div className="row-head">
        <h2>Próximos jogos e lutas</h2>
        <div className="row-nav">
          <button className="icon-btn" tabIndex={-1} onClick={() => scroll(-1)} aria-label="Anterior">
            <Icon name="chevron-left" />
          </button>
          <button className="icon-btn" tabIndex={-1} onClick={() => scroll(1)} aria-label="Próximo">
            <Icon name="chevron-right" />
          </button>
        </div>
      </div>
      <div className="featured-track" ref={track}>
        {featured.map((e) => (
          <FeaturedGame key={e.id} evt={e} now={now} channels={channelsOf.get(e.id) || []} />
        ))}
      </div>
    </section>
  );
}

// ---------- Jogos do guia de programação ----------
function GameCard({ game, now, badges }) {
  const { play, openProgram, catalog } = useStore();
  const { prog, channels } = game;
  const live = prog.start <= now && now < prog.stop;
  const { competition, home, away } = splitGame(prog.title);
  const ch = channels[0];
  const open = () => (live ? play(ch, catalog.live) : openProgram({ item: ch, prog }));
  return (
    <button className={`game-card ${live ? 'is-live' : ''}`} onClick={open} title={prog.title}>
      <div className="game-top">
        {live ? <span className="badge-live static">AO VIVO</span> : <span className="game-when">{dayLabel(prog.start, now)}</span>}
        <span className="game-time">{fmtTime(prog.start)}</span>
      </div>
      <div className="game-teams">
        <div className="game-team">
          <Crest src={badges[home]} name={home} size={34} />
          <strong>{home}</strong>
        </div>
        {away && (
          <div className="game-team">
            <Crest src={badges[away]} name={away} size={34} />
            <strong>{away}</strong>
          </div>
        )}
      </div>
      <div className="game-comp">{competition || prog.category?.split(',')[0] || 'Esporte'}</div>
      {live && (
        <div className="lb-progress">
          <span style={{ width: `${progressOf(prog, now) * 100}%` }} />
        </div>
      )}
      <div className="game-channel">
        <div className="game-logo">
          <Thumb src={ch.logo} name={ch.name} contain />
        </div>
        <span className="game-channel-name">
          {ch.name}
          {channels.length > 1 && <em> +{channels.length - 1} canal(is)</em>}
        </span>
        <Icon name={live ? 'play' : 'info'} size={16} />
      </div>
    </button>
  );
}

// ---------- Seções em cache (3 dias) ----------
// Depois da primeira leitura, as seções de filmes/séries ficam guardadas no aparelho por perfil:
// aparecem na hora ao abrir o app, mesmo antes da lista completa terminar de carregar.
const CACHE_MS = HOME_CACHE_DAYS * 864e5;
const ROWS = [
  { key: 'movies', title: 'Filmes adicionados recentemente', type: 'movie', limit: PERF.homeRecent, to: '/movies' },
  { key: 'series', title: 'Séries adicionadas recentemente', type: 'series', limit: PERF.homeRecent, to: '/series' },
  // LITE: menos fileiras de plataformas e menos títulos em cada uma.
  ...PROVIDER_ROWS.slice(0, PERF.providerRows).map((r) => ({ ...r, limit: Math.min(PROVIDER_ROW_LIMIT, PERF.providerRowItems), to: `/${r.type === 'movie' ? 'movies' : 'series'}?prov=${r.prov}` })),
];
const subOf = (it) =>
  it.type === 'series' && !it.shell ? `${it.episodes?.length || 0} episódio(s)` : [it.year, it.group].filter(Boolean).join(' · ');
const slim = (it) => ({
  id: it.id,
  type: it.type,
  name: it.name,
  displayName: it.displayName,
  logo: it.logo,
  group: it.group,
  year: it.year,
  shell: it.shell,
  lang: it.lang,
  sub: subOf(it),
});
const readCache = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
};

function useHomeRows() {
  const { catalog, loading, profile, playlists } = useStore();
  const key = `gates:p:${profile?.id}:homeRows`;
  // Muda quando as fontes ou a lista de seções mudam: aí o cache é refeito na hora.
  const sig = playlists.map((p) => p.id).join(',') + '|' + ROWS.map((r) => r.key).join(',');
  const [cache, setCache] = useState(() => readCache(key));

  useEffect(() => {
    if (loading) return;
    const c = readCache(key);
    // Recalcula só se o cache venceu (3 dias) ou se as fontes mudaram.
    if (c && Date.now() - c.at < CACHE_MS && c.sig === sig) {
      setCache(c);
      return;
    }
    const rows = {};
    for (const r of ROWS) {
      const source = r.type === 'movie' ? catalog.movies : catalog.series;
      const list = r.prov ? providerItems(source, PROVIDERS[r.prov]) : source;
      rows[r.key] = recentUnique(list, r.limit).map(slim);
    }
    const next = { at: Date.now(), sig, rows };
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* armazenamento cheio */
    }
    setCache(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, key, sig]);

  // Com a lista carregada, usa o item completo e descarta o que foi ocultado/excluído desde então.
  const visible = useMemo(() => (loading ? null : new Set([...catalog.movies, ...catalog.series].map((x) => x.id))), [loading, catalog.movies, catalog.series]);
  return useMemo(
    () =>
      ROWS.map((r) => {
        const cached = cache?.rows?.[r.key] || [];
        const items = visible ? cached.filter((x) => visible.has(x.id)).map((x) => ({ item: catalog.byId.get(x.id) || x, sub: x.sub })) : cached.map((x) => ({ item: x, sub: x.sub }));
        return { ...r, items };
      }),
    [cache, visible, catalog.byId]
  );
}

export function clearHomeCache() {
  try {
    for (const k of Object.keys(localStorage)) if (/^gates:p:.*:homeRows$/.test(k)) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export default function Home() {
  const { catalog, loading, programmesFor, epgSources, epg } = useStore();
  const now = useNow(60000);
  const rows = useHomeRows();

  const minute = Math.floor(now / 60000);
  const games = useMemo(
    () => upcomingGames(catalog.live, programmesFor, now, { limit: PERF.homeGames }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog.live, programmesFor, minute]
  );
  const teamNames = useMemo(() => [...new Set(games.flatMap((g) => Object.values(splitGame(g.prog.title)).slice(1)).filter(Boolean))], [games]);
  const badges = useTeamBadges(teamNames);
  const epgLoading = epgSources.some((s) => epg[s.key]?.loading);
  const hasCached = rows.some((r) => r.items.length);

  if (loading && !hasCached) return <div className="loading"><div className="spinner" /></div>;
  if (!loading && !catalog.all.length && !catalog.series.length)
    return <Empty title="Nenhum conteúdo ainda">Adicione uma lista M3U ou uma conta Xtream Codes para começar.</Empty>;

  const [recentMovies, recentSeries, ...providerRows] = rows;
  const renderRow = (r, emptyText) =>
    r.items.length || emptyText ? (
      <Row key={r.key} title={r.prov ? <PlatformTitle platform={PROVIDERS[r.prov]} text={r.title} /> : r.title} to={r.to}>
        {r.items.length ? r.items.map(({ item, sub }) => <Card key={item.id} item={item} sub={sub} />) : <p className="muted row-empty">{emptyText}</p>}
      </Row>
    ) : null;

  return (
    <div className="home clean">
      <FeaturedGames now={now} />

      {renderRow(recentMovies, 'Nenhum filme nas suas listas.')}
      {renderRow(recentSeries, 'Nenhuma série nas suas listas.')}

      <Row title="Jogos ao vivo e próximos" to="/live">
        {games.length ? (
          games.map((g) => <GameCard key={g.key} game={g} now={now} badges={badges} />)
        ) : (
          <p className="muted row-empty">
            {loading || epgLoading
              ? 'Carregando o guia de programação…'
              : epgSources.length
                ? 'Nenhum jogo encontrado no guia de programação para as próximas 48 horas.'
                : 'Configure um guia de programação (EPG) para ver os jogos.'}
          </p>
        )}
      </Row>

      {/* Plataformas: só aparecem se a fonte tiver a categoria correspondente. */}
      {providerRows.map((r) => renderRow(r))}
    </div>
  );
}
