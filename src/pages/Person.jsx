import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store';
import { Card, Chips, Row } from '../components/Media';
import Icon from '../components/Icon';
import { CreditCard, MetaHint, useAsync, useLocalMatcher } from '../components/MetaSections';
import { getPerson, img } from '../lib/meta';
import { initials } from '../components/Media';
import { PERF } from '../config/perf';

const FILTERS = ['Todos', 'Filmes', 'Séries', 'Para assistir agora'];

// Página de ator/atriz no estilo Plex: biografia, o que há na sua lista e a filmografia completa.
export default function Person() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings } = useStore();
  const match = useLocalMatcher();
  const [filter, setFilter] = useState('Todos');
  const [bioOpen, setBioOpen] = useState(false);
  const state = useAsync(() => (settings.tmdbKey ? getPerson(id) : null), [id, settings.tmdbKey]);
  const p = state.data;

  const credits = useMemo(() => (p?.credits || []).map((c) => ({ c, local: match(c) })), [p, match]);
  const local = credits.filter((x) => x.local);
  const shown = credits.filter(({ c, local: l }) =>
    filter === 'Filmes' ? c.type === 'movie' : filter === 'Séries' ? c.type === 'tv' : filter === 'Para assistir agora' ? l : true
  );

  if (!settings.tmdbKey || state.loading || state.error || !p)
    return (
      <div className="person-page">
        <button className="icon-btn back" onClick={() => navigate(-1)} aria-label="Voltar">
          <Icon name="back" size={24} />
        </button>
        {state.loading && settings.tmdbKey ? (
          <div className="loading"><div className="spinner" /></div>
        ) : (
          <MetaHint meta={{ enabled: !!settings.tmdbKey, loading: false, error: state.error, data: p }} />
        )}
      </div>
    );

  const life = [
    p.birthday && `Nascimento: ${new Date(p.birthday + 'T12:00').toLocaleDateString('pt-BR')}`,
    p.deathday && `Falecimento: ${new Date(p.deathday + 'T12:00').toLocaleDateString('pt-BR')}`,
    p.place,
  ].filter(Boolean);

  return (
    <div className="person-page">
      <button className="icon-btn back" onClick={() => navigate(-1)} aria-label="Voltar">
        <Icon name="back" size={24} />
      </button>
      <header className="person-head">
        <div className="person-photo xl">
          {p.profile ? <img src={img(p.profile, 'h632')} alt="" /> : <span>{initials(p.name)}</span>}
        </div>
        <div>
          <h1>{p.name}</h1>
          <div className="meta">
            {p.department && <span className="tag">{p.department === 'Acting' ? 'Atuação' : p.department}</span>}
            {life.map((l) => (
              <span key={l}>{l}</span>
            ))}
            {p.imdbId && (
              <a className="score imdb ghost" href={`https://www.imdb.com/name/${p.imdbId}/`} target="_blank" rel="noreferrer">
                IMDb
              </a>
            )}
          </div>
          {p.bio && (
            <p className={`bio ${bioOpen ? 'open' : ''}`}>
              {p.bio}
            </p>
          )}
          {p.bio?.length > 400 && (
            <button className="btn ghost small" onClick={() => setBioOpen((o) => !o)}>
              {bioOpen ? 'Ler menos' : 'Ler mais'}
            </button>
          )}
        </div>
      </header>

      {local.length > 0 && (
        <Row title="Para assistir agora">
          {local.map(({ c, local: it }) => (
            <Card key={it.id} item={it} sub={c.character ? `como ${c.character}` : c.job || it.group} />
          ))}
        </Row>
      )}

      <section className="filmography">
        <div className="page-head">
          <h2>Filmografia</h2>
          <Chips options={FILTERS} value={filter} onChange={setFilter} />
        </div>
        <div className="grid grid-poster">
          {shown.slice(0, PERF.personLimit).map(({ c, local: it }) => (
            <CreditCard
              key={c.type + c.id}
              c={c}
              local={it}
              sub={[c.year, c.character ? `como ${c.character}` : c.job].filter(Boolean).join(' · ')}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
