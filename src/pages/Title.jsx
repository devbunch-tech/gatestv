import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store';
import { Thumb } from '../components/Media';
import Icon from '../components/Icon';
import { CastRow, Crew, MetaFacts, MetaHint, Recommendations, TrailerButton, WatchProviders, useAsync, useLocalMatcher } from '../components/MetaSections';
import { getDetails, img } from '../lib/meta';

// Título vindo do TMDB (filmografia de um ator, recomendações, programa do EPG).
export default function Title() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const { settings } = useStore();
  const match = useLocalMatcher();
  const state = useAsync(() => (settings.tmdbKey ? getDetails(type, +id) : null), [type, id, settings.tmdbKey]);
  const d = state.data;
  const local = d ? match({ type, id: d.id, title: d.title, originalTitle: d.originalTitle }) : null;

  return (
    <div className="details">
      <div className="details-bg" style={d?.backdrop ? { backgroundImage: `url("${img(d.backdrop, 'w1280')}")` } : undefined} />
      <button className="icon-btn back" onClick={() => navigate(-1)} aria-label="Voltar">
        <Icon name="back" size={24} />
      </button>
      {!d ? (
        state.loading && settings.tmdbKey ? (
          <div className="loading"><div className="spinner" /></div>
        ) : (
          <MetaHint meta={{ enabled: !!settings.tmdbKey, loading: false, error: state.error, data: d }} />
        )
      ) : (
        <>
          <div className="details-main">
            <div className="details-poster">
              <Thumb src={img(d.poster, 'w500')} name={d.title} />
            </div>
            <div className="details-info">
              <h1>{d.title}</h1>
              {d.originalTitle && d.originalTitle !== d.title && <p className="muted original">{d.originalTitle}</p>}
              <MetaFacts data={d} />
              {d.tagline && <p className="tagline">“{d.tagline}”</p>}
              {d.overview && <p className="overview">{d.overview}</p>}
              <Crew data={d} />
              <WatchProviders data={d} />
              <div className="details-actions">
                {local ? (
                  <button className="btn" data-autofocus onClick={() => navigate(`/item/${local.id}`)}>
                    <Icon name="play" size={18} /> Abrir na sua lista
                  </button>
                ) : null}
                <TrailerButton data={d} />
              </div>
            </div>
          </div>
          <div className="details-rows">
            <CastRow data={d} />
            <Recommendations data={d} />
          </div>
        </>
      )}
    </div>
  );
}
