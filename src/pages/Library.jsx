import { useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useStore } from '../store';
import { Card, Empty, Grid, PageHeader, Row } from '../components/Media';
import Icon from '../components/Icon';
import LibraryHero from '../components/LibraryHero';
import { PlatformTitle } from '../components/Platform';
import { PERF } from '../config/perf';
import { useRestoredState } from '../lib/scrollMemory';
import { PLATFORMS, platformOf, platformWordmark } from '../config/platforms';
import { recentUnique } from '../lib/home';
import { genresOf, inGroup, platformsOfItem } from '../lib/library';

const SORTS = {
  default: { label: 'Adicionados recentemente', fn: (a, b) => (b.added || b.firstSeen || 0) - (a.added || a.firstSeen || 0) },
  year: { label: 'Mais novos primeiro', fn: (a, b) => (b.year || 0) - (a.year || 0) || (b.added || 0) - (a.added || 0) },
  az: { label: 'A–Z', fn: (a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name, 'pt-BR') },
  za: { label: 'Z–A', fn: (a, b) => (b.displayName || b.name).localeCompare(a.displayName || a.name, 'pt-BR') },
};
const DURATIONS = {
  short: { label: 'Até 30 min', test: (m) => m > 0 && m <= 30 },
  mid: { label: '30 min a 1 h', test: (m) => m > 30 && m <= 60 },
  long: { label: 'Mais de 1 h', test: (m) => m > 60 },
};
const NOW_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: NOW_YEAR - 1960 + 1 }, (_, i) => NOW_YEAR - i);
const RELEASES = 15;
// Versões de áudio do título (sem marcação na lista = dublado, padrão das listas brasileiras).
const hasLeg = (x) => x.lang === 'leg' || !!x.variants?.some((v) => v.lang === 'leg');
const hasDub = (x) => x.lang !== 'leg' || !!x.variants?.some((v) => v.lang !== 'leg');
const ROW_SIZE = PERF.libraryRowItems;
const ALL = 'all';

// Só monta a fileira quando ela se aproxima da tela (há várias por plataforma).
function LazyRow({ id, children }) {
  const ref = useRef(null);
  const [shown, setShown] = useRestoredState('row:' + id, false);
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setShown(true), { rootMargin: PERF.gridMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  return <div ref={ref} className={shown ? '' : 'lazy-row'}>{shown ? children : null}</div>;
}

// Lançamentos: títulos dos últimos 2 anos, do mais recente adicionado; completa com os mais recentes.
function releasesOf(items, n = RELEASES) {
  const fresh = items.filter((it) => it.year && it.year >= NOW_YEAR - 1);
  const first = recentUnique(fresh, n);
  if (first.length >= n) return first;
  const ids = new Set(first.map((x) => x.id));
  return [...first, ...recentUnique(items, n * 2).filter((x) => !ids.has(x.id))].slice(0, n);
}

// Faixa de logos das plataformas (abre a plataforma escolhida).
function PlatformStrip({ items }) {
  const counts = useMemo(() => {
    const m = new Map();
    for (const it of items) for (const p of platformsOfItem(it)) m.set(p.key, (m.get(p.key) || 0) + 1);
    return m;
  }, [items]);
  const list = PLATFORMS.filter((p) => !p.noStrip && counts.get(p.key));
  if (!list.length) return null;
  return (
    <Row title="Plataformas">
      {list.map((p) => (
        <Link key={p.key} to={`?p=${p.key}`} className="platform-tile" title={`${p.name} · ${counts.get(p.key).toLocaleString('pt-BR')} títulos`}>
          <img src={platformWordmark(p)} alt={p.name} loading="lazy" />
        </Link>
      ))}
      <Link to={`?p=${ALL}`} className="platform-tile platform-tile-all" title="Todos os títulos">
        <span>Todos</span>
      </Link>
    </Row>
  );
}

// Biblioteca de Filmes ou Séries.
//   Tela principal: logos das plataformas + 15 lançamentos.
//   Plataforma (?p=netflix): lançamentos primeiro e depois uma fileira por gênero; com filtros
//   (ano, duração nas séries, classificação, ordem) a tela vira uma grade.
export default function Library({ kind }) {
  const { catalog, loading } = useStore();
  const [params, setParams] = useSearchParams();
  const label = kind === 'series' ? 'Séries' : 'Filmes';
  const all = kind === 'series' ? catalog.series : catalog.movies;

  const pKey = params.get('p') || params.get('prov');
  const platform = pKey && pKey !== ALL ? PLATFORMS.find((p) => p.key === pKey) : null;
  const group = params.get('g');
  const genre = params.get('gen');
  const sort = params.get('sort') || 'default';
  const year = params.get('ano') || '';
  const dur = params.get('dur') || '';
  const audio = params.get('audio') || '';
  const filtering = sort !== 'default' || year || dur || audio || genre;

  const source = useMemo(() => {
    if (platform) return all.filter((it) => platformsOfItem(it).some((p) => p.key === platform.key));
    return all;
  }, [all, platform]);

  const filtered = useMemo(() => {
    let list = group ? all.filter((x) => inGroup(x, group)) : source;
    if (genre) list = list.filter((x) => genresOf(x).includes(genre));
    if (year) list = list.filter((x) => String(x.year) === year);
    if (dur && DURATIONS[dur]) list = list.filter((x) => DURATIONS[dur].test(x.runtime || 0));
    // Áudio: só os títulos que têm aquela versão; no Legendado, o título já abre na versão legendada.
    if (audio === 'leg') list = list.filter(hasLeg).map((x) => ({ ...x, _openLang: 'leg' }));
    else if (audio === 'dub') list = list.filter(hasDub);
    return SORTS[sort]?.fn ? [...list].sort(SORTS[sort].fn) : list;
  }, [all, source, group, genre, year, dur, audio, sort]);

  const genreRows = useMemo(() => {
    if (!pKey || filtering) return [];
    const m = new Map();
    for (const it of source) for (const g of genresOf(it)) (m.get(g) || m.set(g, []).get(g)).push(it);
    return [...m.entries()].filter(([, l]) => l.length >= 3).sort((a, b) => b[1].length - a[1].length);
  }, [source, pKey, filtering]);

  const update = (patch) => {
    const next = Object.fromEntries(params);
    Object.assign(next, patch);
    for (const k of Object.keys(next)) if (next[k] == null || next[k] === '' || (k === 'sort' && next[k] === 'default')) delete next[k];
    setParams(next, { replace: true });
  };

  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (!all.length) return <Empty title={`Nenhum(a) ${label.toLowerCase()}`}>Sua lista ainda não tem {label.toLowerCase()}.</Empty>;

  const subOf = (it) => (kind === 'series' && !it.shell ? `${it.episodes.length} episódio(s)` : [it.year, it.group].filter(Boolean).join(' · '));
  const back = (to) => (
    <button className="link-btn back-link" onClick={() => setParams(to, { replace: false })}>
      <Icon name="chevron-left" size={16} /> {to.p ? 'Voltar' : `Todas as plataformas de ${label.toLowerCase()}`}
    </button>
  );
  const filters = (
    <div className="lib-filters">
      <select value={sort} onChange={(e) => update({ sort: e.target.value })} aria-label="Ordem">
        {Object.entries(SORTS).map(([k, s]) => (
          <option key={k} value={k}>
            {s.label}
          </option>
        ))}
      </select>
      <select value={year} onChange={(e) => update({ ano: e.target.value })} aria-label="Ano">
        <option value="">Todos os anos</option>
        {YEARS.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      {kind === 'series' && (
        <select value={dur} onChange={(e) => update({ dur: e.target.value })} aria-label="Duração">
          <option value="">Qualquer duração</option>
          {Object.entries(DURATIONS).map(([k, d]) => (
            <option key={k} value={k}>
              {d.label}
            </option>
          ))}
        </select>
      )}
      <select value={audio} onChange={(e) => update({ audio: e.target.value })} aria-label="Áudio">
        <option value="">Áudio: todos</option>
        <option value="dub">Áudio: Dublado</option>
        <option value="leg">Áudio: Legendado</option>
      </select>
    </div>
  );

  // ---------- Categoria da lista (links antigos ?g=) ----------
  if (group) {
    const gp = platformOf(group);
    return (
      <div className="library">
        {back({})}
        <PageHeader title={<PlatformTitle platform={gp} text={group} />} count={filtered.length}>
          {filters}
        </PageHeader>
        <Grid items={filtered} sub={subOf} />
      </div>
    );
  }

  // ---------- Plataforma (ou "Todos") ----------
  if (pKey) {
    const title = platform ? platform.name : `Todos os ${label.toLowerCase()}`;
    const logo = platform && !platform.noStrip ? platformWordmark(platform) : '';
    const heading = (
      <span className="platform-title">
        {logo ? <img className="platform-head-logo" src={logo} alt={title} /> : title}
        {genre && <span> · {genre}</span>}
      </span>
    );
    if (filtering) {
      return (
        <div className="library">
          {back(genre ? { p: pKey } : {})}
          <PageHeader title={heading} count={filtered.length}>
            {filters}
          </PageHeader>
          {filtered.length ? <Grid items={filtered} sub={subOf} memoryKey={'grid:' + pKey + genre + year + dur + audio + sort} /> : <Empty title="Nada encontrado">Nenhum título com esses filtros.</Empty>}
        </div>
      );
    }
    return (
      <div className="library lib-overview">
        {/* Destaques: os adicionados recentemente desta plataforma. */}
        <LibraryHero key={pKey} items={source} />
        {back({})}
        <PageHeader title={heading} count={source.length}>
          {filters}
        </PageHeader>
        <Row title="Lançamentos">
          {releasesOf(source).map((it) => (
            <Card key={it.id} item={it} sub={subOf(it)} />
          ))}
        </Row>
        {genreRows.map(([g, list]) => (
          <LazyRow key={pKey + g} id={pKey + ':' + g}>
            <Row
              title={
                <Link to={`?p=${pKey}&gen=${encodeURIComponent(g)}`} className="row-title-link">
                  {g}
                </Link>
              }
            >
              {recentUnique(list, ROW_SIZE).map((it) => (
                <Card key={it.id} item={it} sub={subOf(it)} />
              ))}
              {list.length > ROW_SIZE && (
                <Link to={`?p=${pKey}&gen=${encodeURIComponent(g)}`} className="see-all-card">
                  <Icon name="chevron-right" size={28} />
                  <span>Ver todos</span>
                  <small>{list.length.toLocaleString('pt-BR')} títulos</small>
                </Link>
              )}
            </Row>
          </LazyRow>
        ))}
      </div>
    );
  }

  // ---------- Tela principal ----------
  return (
    <div className="library lib-overview">
      <LibraryHero items={all} />
      <div className="library-head">
        <PageHeader title={label} count={all.length} />
      </div>
      <PlatformStrip items={all} />
      <Row title="Lançamentos">
        {releasesOf(all).map((it) => (
          <Card key={it.id} item={it} sub={subOf(it)} />
        ))}
      </Row>
    </div>
  );
}
