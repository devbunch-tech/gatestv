import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../store';
import { Thumb } from '../components/Media';
import Icon from '../components/Icon';
import { CastRow, Crew, MetaFacts, MetaHint, Recommendations, TrailerButton, WatchProviders, useItemMeta } from '../components/MetaSections';
import { img } from '../lib/meta';
import { useLoadedImage } from '../components/useLoadedImage';

export default function Details() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { catalog, play, history, isFavorite, toggleFavorite, playlists, loading, openMenu, ratingOf, isRestricted, loadEpisodes, openTrailer } = useStore();
  const base = catalog.byId.get(id);
  // Versão escolhida (Dublado/Legendado…). Padrão: a versão principal (dublada).
  // ?v=leg (filtro "Áudio: Legendado" da biblioteca) já abre na versão legendada.
  const [params] = useSearchParams();
  const want = params.get('v');
  const variants = base?.variants;
  const legVariant = variants?.find((v) => v.lang === 'leg') || null;
  const dubVariant = variants?.find((v) => v.lang !== 'leg') || null;
  const [variantId, setVariantId] = useState(null);
  useEffect(() => setVariantId(want === 'leg' ? legVariant?.id || null : null), [id, want, legVariant?.id]);
  const item = (variantId && catalog.byId.get(variantId)) || base;
  const [season, setSeason] = useState(null);
  const meta = useItemMeta(item);
  const d = meta.data;
  // Fundo: espera o TMDB responder e baixa só a imagem final (uma vez).
  const shownBg = useLoadedImage(
    item ? img(d?.backdrop, 'w1280') || item.backdrop || item.logo : null,
    !!item && (!meta.enabled || !meta.loading)
  );

  // Séries Xtream: episódios vêm do servidor quando a página abre.
  useEffect(() => {
    if (item?.shell && !item.episodesState) loadEpisodes(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);
  useEffect(() => setSeason(item?.seasons?.[0] ?? null), [item?.id, item?.seasons?.length]);

  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (!item)
    return (
      <div className="empty">
        <h3>Conteúdo não encontrado</h3>
        <button className="btn" onClick={() => navigate('/')}>Voltar ao início</button>
      </div>
    );

  const isSeries = item.type === 'series' && item.episodes;
  const playlist = playlists.find((p) => p.id === item.playlistId);
  const episodes = isSeries ? item.episodes.filter((e) => e.series.season === season) : [];
  const resumeEp = isSeries
    ? item.episodes
        .filter((e) => history[e.id]?.position > 0 && !history[e.id]?.watched)
        .sort((a, b) => history[b.id].at - history[a.id].at)[0] || item.episodes[0] || null
    : item;
  const epsLoading = item.shell && (!item.episodesState || item.episodesState === 'loading');
  const epsError = item.shell && item.episodesState?.error;
  const h = resumeEp ? history[resumeEp.id] : null;
  const resuming = h?.position > 10;
  const poster = img(d?.poster, 'w500') || item.logo;
  const backdrop = img(d?.backdrop, 'w1280') || item.backdrop || item.logo;
  const overview = d?.overview || item.plot;

  return (
    <div className="details">
      {shownBg && <div className="details-bg" style={{ backgroundImage: `url("${shownBg}")` }} />}
      <button className="icon-btn back" onClick={() => navigate(-1)} aria-label="Voltar">
        <Icon name="back" size={24} />
      </button>

      <div className="details-main">
        <div className="details-poster">
          <Thumb src={poster} name={item.name} />
          {isRestricted(item) && (
            <span className="badge-lock lg">
              <Icon name="lock" size={18} />
            </span>
          )}
        </div>
        <div className="details-info">
          <h1>{base.displayName || item.name}</h1>
          {d && d.title !== item.name && (
            <p className="muted original">
              {d.title}
              {d.originalTitle && d.originalTitle !== d.title && ` · ${d.originalTitle}`}
            </p>
          )}
          <MetaFacts data={d} age={ratingOf(item)} />
          <div className="meta subtle">
            <span className="tag">{{ movie: 'Filme', series: 'Série', live: 'Ao vivo' }[item.type]}</span>
            <span>{item.group}</span>
            {isSeries && (
              <span>
                {item.seasons.length} temporada(s) · {item.episodes.length} episódio(s) na lista
              </span>
            )}
            {playlist && <span>Fonte: {playlist.name}</span>}
          </div>
          {d?.tagline && <p className="tagline">“{d.tagline}”</p>}
          {overview && <p className="overview">{overview}</p>}
          {!d && item.cast && (
            <p className="crew">
              <span>Elenco:</span> {item.cast}
            </p>
          )}
          <Crew data={d} />
          <WatchProviders data={d} />

          {/* Versões: Dublada e Legendada (aparece só quando existe a legendada). */}
          {legVariant && (
            <div className="versions">
              <span>Versões</span>
              <div className="chips">
                {dubVariant && (
                  <button className={`chip ${item.id !== legVariant.id ? 'active' : ''}`} onClick={() => setVariantId(dubVariant.id)}>
                    Dublada
                  </button>
                )}
                <button className={`chip ${item.id === legVariant.id ? 'active' : ''}`} onClick={() => setVariantId(legVariant.id)}>
                  Legendada
                </button>
              </div>
            </div>
          )}
          <div className="details-actions">
            <button className="btn" data-autofocus disabled={!resumeEp} onClick={() => play(resumeEp, isSeries ? item.episodes : [item])}>
              {epsLoading ? <span className="spinner sm" /> : <Icon name="play" size={18} />}
              {epsLoading ? 'Carregando episódios…' : resuming ? 'Continuar' : 'Assistir'}
              {isSeries && resumeEp && ` T${resumeEp.series.season}E${resumeEp.series.episode}`}
            </button>
            <TrailerButton data={d} />
            {!d?.trailers?.length && item.trailer && (
              <button className="btn ghost" onClick={() => openTrailer({ key: item.trailer, title: `${item.name} — Trailer` })}>
                <Icon name="film" size={18} /> Trailer
              </button>
            )}
            <button className={`btn ghost round ${isFavorite(item.id) ? 'on' : ''}`} onClick={() => toggleFavorite(item.id)} title="Favoritar">
              <Icon name="heart" size={18} filled={isFavorite(item.id)} />
            </button>
            <button className="btn ghost round" onClick={() => openMenu(item)} title="Ocultar, bloquear, classificação…">
              <Icon name="more" size={18} />
            </button>
          </div>
          {resuming && h.duration > 0 && (
            <div className="details-progress">
              <div className="card-progress static">
                <span style={{ width: `${(h.position / h.duration) * 100}%` }} />
              </div>
              <small>Restam {Math.max(1, Math.round((h.duration - h.position) / 60))} min</small>
            </div>
          )}
          <MetaHint meta={meta} />
        </div>
      </div>

      {epsError && <p className="msg err">Não foi possível carregar os episódios: {epsError}</p>}
      {isSeries && item.episodes.length > 0 && (
        <section className="episodes">
          <div className="season-tabs">
            {item.seasons.map((s) => (
              <button key={s} className={`chip ${s === season ? 'active' : ''}`} onClick={() => setSeason(s)}>
                Temporada {s}
              </button>
            ))}
          </div>
          <div className="episode-list">
            {episodes.map((ep) => {
              const eh = history[ep.id];
              return (
                <button
                  key={ep.id}
                  className="episode"
                  data-longpress={ep.id}
                  onContextMenu={(e) => (e.preventDefault(), openMenu(ep))}
                  onClick={() => play(ep, item.episodes)}
                >
                  <div className="episode-thumb">
                    <Thumb src={ep.logo} name={ep.name} />
                    <span className="play-circle">
                      <Icon name="play" size={20} />
                    </span>
                    {eh?.position > 0 && eh.duration > 0 && (
                      <div className="card-progress">
                        <span style={{ width: `${eh.watched ? 100 : (eh.position / eh.duration) * 100}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="episode-info">
                    <small>Episódio {ep.series.episode}</small>
                    <strong>{ep.series.title || ep.name}</strong>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div className="details-rows">
        <CastRow data={d} />
        <Recommendations data={d} />
      </div>
    </div>
  );
}
