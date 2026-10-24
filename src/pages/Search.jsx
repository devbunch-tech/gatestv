import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../store';
import { Card, PageHeader, Row } from '../components/Media';

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
import { PERF } from '../config/perf';

const LIMIT = PERF.searchLimit;

export default function Search() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const { catalog } = useStore();

  const results = useMemo(() => {
    const n = norm(q.trim());
    if (!n) return null;
    const match = (x) => norm(x.name).includes(n);
    return {
      live: catalog.live.filter(match),
      movies: catalog.movies.filter(match),
      series: catalog.series.filter(match),
    };
  }, [q, catalog]);

  const total = results ? results.live.length + results.movies.length + results.series.length : 0;

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
    </div>
  );
}
