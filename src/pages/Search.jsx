import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../store';
import { Card, PageHeader, Row } from '../components/Media';
import Icon from '../components/Icon';
import { areasFor, loadAdded } from '../lib/clark';
import { loadFavs } from '../lib/narration';

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
import { PERF } from '../config/perf';

const LIMIT = PERF.searchLimit;

export default function Search() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const { catalog, profile } = useStore();
  const navigate = useNavigate();

  const results = useMemo(() => {
    const n = norm(q.trim());
    if (!n) return null;
    const words = n.split(/[^\w]+/).filter(Boolean);
    // Primeiro quem tem o texto inteiro; depois quem tem todas as palavras (ex.: "duna parte dois" → "Duna: Parte Dois").
    const find = (list) => {
      const all = [];
      const some = [];
      for (const x of list) {
        const s = norm(x.name || '');
        if (s.includes(n)) all.push(x);
        else if (words.length > 1 && words.every((w) => s.includes(w))) some.push(x);
      }
      return some.length ? all.concat(some) : all;
    };
    // Canais das áreas do YouTube deste perfil (perfis infantis só veem as áreas infantis).
    const areas = areasFor(profile);
    const yt = new Map();
    for (const a of areas) for (const c of [...a.channels, ...loadAdded(a.store)]) if (!yt.has(c.id)) yt.set(c.id, { ...c, area: a });
    // Narradores favoritos (fora dos perfis infantis): abrem numa área do YouTube que não é infantil.
    const adult = !profile?.kids && areas.find((a) => !a.kidsOk);
    return {
      live: find(catalog.live),
      movies: find(catalog.movies),
      series: find(catalog.series),
      yt: find([...yt.values()]),
      narr: adult ? find(loadFavs()).map((c) => ({ ...c, area: adult })) : [],
    };
  }, [q, catalog, profile]);

  const total = results ? results.live.length + results.movies.length + results.series.length + results.yt.length + results.narr.length : 0;
  const openChannel = (c) => navigate(c.area.path, { state: { ch: { id: c.id, name: c.name } } });

  return (
    <div className="search-page">
      <PageHeader title={q ? `Resultados para “${q}”` : 'Buscar'} count={results ? total : null} />
      {results && total === 0 && <p className="muted pad">Nada encontrado. Tente outro termo.</p>}
      {results?.live.length > 0 && (
        <Row title={`Canais (${results.live.length})`}>
          {results.live.slice(0, LIMIT).map((it) => (
            <Card key={it.id} item={it} variant="wide" sub={it.group} />
          ))}
        </Row>
      )}
      {results?.movies.length > 0 && (
        <Row title={`Filmes (${results.movies.length})`}>
          {results.movies.slice(0, LIMIT).map((it) => (
            <Card key={it.id} item={it} sub={it.group} />
          ))}
        </Row>
      )}
      {results?.series.length > 0 && (
        <Row title={`Séries (${results.series.length})`}>
          {results.series.slice(0, LIMIT).map((it) => (
            <Card key={it.id} item={it} sub={it.shell ? it.group : `${it.episodes.length} episódio(s)`} />
          ))}
        </Row>
      )}
      {results?.yt.length > 0 && (
        <Row title={`Canais do YouTube (${results.yt.length})`}>
          {results.yt.slice(0, LIMIT).map((c) => (
            <button key={c.id} className="yt-hub-card search-yt" onClick={() => openChannel(c)}>
              <Icon name={c.area.icon} size={28} />
              <strong>{c.name}</strong>
              <span className="muted">{c.area.title}</span>
            </button>
          ))}
        </Row>
      )}
      {results?.narr.length > 0 && (
        <Row title={`Narradores (${results.narr.length})`}>
          {results.narr.slice(0, LIMIT).map((c) => (
            <button key={c.id} className="yt-hub-card search-yt" onClick={() => openChannel(c)}>
              <Icon name="volume" size={28} />
              <strong>{c.name}</strong>
              <span className="muted">Meus narradores</span>
            </button>
          ))}
        </Row>
      )}
    </div>
  );
}
