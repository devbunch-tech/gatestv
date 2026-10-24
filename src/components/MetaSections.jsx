import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { cleanTitle, findTitle, getDetails, img, normTitle } from '../lib/meta';
import { RatingBadge, Row, Thumb, initials } from './Media';
import Icon from './Icon';

export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    Promise.resolve()
      .then(fn)
      .then(
        (data) => alive && setState({ loading: false, data }),
        (error) => alive && setState({ loading: false, error })
      );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

// Metadados TMDB de um item local (filme, série ou episódio).
export function useItemMeta(item) {
  const { settings, setMetaRating, linkTmdb } = useStore();
  const key = settings.tmdbKey;
  const name = item && item.type !== 'live' ? (item.type === 'series' ? item.series?.name || item.name : item.name) : null;
  const q = name ? cleanTitle(name) : null;
  const type = item?.type === 'movie' ? 'movie' : 'tv';
  const target = item?.seriesId || item?.id;
  const state = useAsync(async () => {
    if (!q || !key) return null;
    const hit = await findTitle({ ...q, type });
    return hit ? getDetails(hit.type, hit.id) : null;
  }, [q?.title, q?.year, type, key]);

  useEffect(() => {
    if (!state.data || !target) return;
    if (state.data.cert != null) setMetaRating(target, state.data.cert);
    linkTmdb(`${state.data.type}:${state.data.id}`, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.data, target]);
  return { ...state, enabled: !!key };
}

// Busca livre (ex.: título de um programa do EPG).
export function useTmdbFind({ title, year, type = 'multi' }) {
  const { settings } = useStore();
  const key = settings.tmdbKey;
  const state = useAsync(async () => {
    if (!title || !key) return null;
    const q = cleanTitle(title);
    const hit = await findTitle({ title: q.title, year: year || q.year, type });
    return hit ? getDetails(hit.type, hit.id) : null;
  }, [title, year, type, key]);
  return { ...state, enabled: !!key };
}

// Liga créditos do TMDB a itens da lista do usuário (por vínculo salvo ou por título normalizado).
export function useLocalMatcher() {
  const { catalog, tmdbLinks } = useStore();
  return useMemo(() => {
    const idx = new Map();
    const visible = new Set();
    for (const it of [...catalog.movies, ...catalog.series]) {
      visible.add(it.id);
      const k = normTitle(cleanTitle(it.name).title);
      if (!idx.has(k)) idx.set(k, it);
    }
    return (c) => {
      const linked = tmdbLinks[`${c.type}:${c.id}`];
      if (linked && visible.has(linked)) return catalog.byId.get(linked);
      return idx.get(normTitle(c.title)) || idx.get(normTitle(c.originalTitle)) || null;
    };
  }, [catalog, tmdbLinks]);
}

export function Scores({ data }) {
  if (!data) return null;
  return (
    <>
      {data.imdbRating && (
        <a
          className="score imdb"
          href={`https://www.imdb.com/title/${data.imdbId}/`}
          target="_blank"
          rel="noreferrer"
          title={`${data.imdbVotes || ''} votos no IMDb`}
        >
          IMDb <strong>{data.imdbRating}</strong>
        </a>
      )}
      {data.vote > 0 && (
        <span className="score tmdb" title={`${data.voteCount} votos no TMDB`}>
          <Icon name="star" size={14} /> {data.vote.toFixed(1)}
        </span>
      )}
      {!data.imdbRating && data.imdbId && (
        <a className="score imdb ghost" href={`https://www.imdb.com/title/${data.imdbId}/`} target="_blank" rel="noreferrer">
          IMDb
        </a>
      )}
    </>
  );
}

export function MetaFacts({ data, age }) {
  const runtime = data?.runtime ? `${Math.floor(data.runtime / 60) ? Math.floor(data.runtime / 60) + 'h ' : ''}${data.runtime % 60}min` : null;
  return (
    <div className="meta">
      <RatingBadge age={age ?? data?.cert ?? null} />
      {data?.year && <span>{data.year}</span>}
      {runtime && <span>{runtime}</span>}
      {data?.seasons && <span>{data.seasons} temporada(s)</span>}
      {data?.genres?.length > 0 && <span>{data.genres.slice(0, 3).join(' · ')}</span>}
      <Scores data={data} />
    </div>
  );
}

export function TrailerButton({ data }) {
  const { openTrailer } = useStore();
  const t = data?.trailers?.[0];
  if (!t) return null;
  return (
    <button className="btn ghost" onClick={() => openTrailer({ key: t.key, title: `${data.title} — ${t.name}` })}>
      <Icon name="film" size={18} /> Trailer
    </button>
  );
}

export function PersonChip({ p, sub }) {
  const { stop, closeProgram } = useStore();
  return (
    <Link
      to={`/person/${p.id}`}
      className="person"
      onClick={() => {
        stop();
        closeProgram();
      }}
    >
      <div className="person-photo">
        {p.profile ? <img src={img(p.profile, 'w185')} alt="" loading="lazy" /> : <span>{initials(p.name)}</span>}
      </div>
      <strong>{p.name}</strong>
      {sub && <small>{sub}</small>}
    </Link>
  );
}

export function CastRow({ data, title = 'Elenco' }) {
  if (!data?.cast?.length) return null;
  return (
    <Row title={title}>
      {data.cast.map((p) => (
        <PersonChip key={p.id} p={p} sub={p.character} />
      ))}
    </Row>
  );
}

export function Crew({ data }) {
  if (!data?.directors?.length) return null;
  return (
    <p className="crew">
      <span>{data.type === 'movie' ? 'Direção' : 'Criação'}:</span>{' '}
      {data.directors.map((d, i) => (
        <span key={d.id}>
          {i > 0 && ', '}
          <Link to={`/person/${d.id}`}>{d.name}</Link>
        </span>
      ))}
    </p>
  );
}

// Pôster de um título do TMDB: abre o item local se existir, senão a página de descoberta.
export function CreditCard({ c, local, sub }) {
  const navigate = useNavigate();
  return (
    <button
      className="card"
      onClick={() => navigate(local ? `/item/${local.id}` : `/title/${c.type}/${c.id}`)}
      title={c.title}
    >
      <div className="card-media">
        <Thumb src={img(c.poster, 'w342') || local?.logo} name={c.title} />
        <div className="card-hover">
          <span className="play-circle">
            <Icon name={local ? 'play' : 'info'} size={22} />
          </span>
        </div>
      </div>
      <div className="card-title">{c.title}</div>
      <div className="card-sub">{sub ?? [c.year, c.type === 'tv' ? 'Série' : 'Filme'].filter(Boolean).join(' · ')}</div>
    </button>
  );
}

export function Recommendations({ data }) {
  const match = useLocalMatcher();
  const recs = data?.recommendations || [];
  if (!recs.length) return null;
  const withLocal = recs.map((c) => ({ c, local: match(c) })).sort((a, b) => !!b.local - !!a.local);
  return (
    <Row title="Títulos relacionados">
      {withLocal.map(({ c, local }) => (
        <CreditCard key={c.type + c.id} c={c} local={local} />
      ))}
    </Row>
  );
}

// Onde o título está disponível no Brasil (dados do JustWatch via TMDB).
export function WatchProviders({ data }) {
  const p = data?.providers;
  if (!p) return null;
  const groups = [
    ['Streaming', p.flatrate],
    ['Grátis', p.free],
    ['Com anúncios', p.ads],
    ['Alugar', p.rent],
    ['Comprar', p.buy],
  ].filter(([, list]) => list?.length);
  if (!groups.length) return null;
  return (
    <div className="providers">
      <span className="providers-title">Onde assistir no Brasil</span>
      {groups.map(([label, list]) => (
        <div key={label} className="providers-row">
          <small>{label}</small>
          <div className="providers-list">
            {list.map((x) => (
              <span key={x.id} className="provider" title={x.name}>
                {x.logo ? <img src={img(x.logo, 'w92')} alt="" /> : null}
                <span>{x.name}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
      <small className="muted providers-src">
        Fonte:{' '}
        <a href={p.link || 'https://www.justwatch.com/br'} target="_blank" rel="noreferrer">
          JustWatch
        </a>
      </small>
    </div>
  );
}

export function MetaHint({ meta }) {
  if (meta.enabled) {
    if (meta.loading) return <p className="muted meta-hint"><span className="spinner sm" /> Buscando informações no TMDB…</p>;
    if (meta.error) return <p className="msg err">{meta.error.message}</p>;
    if (!meta.data) return <p className="muted meta-hint">Não encontramos este título no TMDB.</p>;
    return null;
  }
  return (
    <p className="muted meta-hint">
      <Icon name="info" size={16} /> Configure a chave do TMDB em <Link to="/settings#meta">Configurações</Link> para ver sinopse,
      elenco, trailers, notas do IMDb e classificação indicativa.
    </p>
  );
}
