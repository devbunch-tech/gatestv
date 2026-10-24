import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from './Icon';
import { useStore } from '../store';
import { findNow } from '../lib/epg';
import { ageLabel, ageText } from '../lib/parental';
import { PERF } from '../config/perf';
import { useRestoredState } from '../lib/scrollMemory';

export function initials(name) {
  return (
    name
      .replace(/[^\p{L}\p{N} ]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '?'
  );
}

export function Thumb({ src, name, contain }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed)
    return (
      <div className="thumb-fallback">
        <span>{initials(name)}</span>
      </div>
    );
  return (
    <img
      className={contain && !src.startsWith('/logos/') ? 'contain' : ''}
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

// Abre um item: canais e episódios tocam direto; filmes e séries abrem a página de detalhes.
export function useOpenItem() {
  const navigate = useNavigate();
  const { play, catalog } = useStore();
  return (item, queue) => {
    if (item.type === 'live') return play(item, queue || catalog.live);
    if (item.type === 'series' && item.seriesId) {
      const s = catalog.byId.get(item.seriesId);
      return play(item, s?.episodes);
    }
    navigate(`/item/${item.id}${item._openLang ? '?v=' + item._openLang : ''}`);
  };
}

export function RatingBadge({ age, large }) {
  if (age == null) return null;
  return (
    <span className={`rating rating-${age} ${large ? 'lg' : ''}`} title={`Classificação: ${ageText(age)}`}>
      {ageLabel(age)}
    </span>
  );
}

export function Card({ item, variant = 'poster', sub, progress, onClick }) {
  const open = useOpenItem();
  const { programmesFor, isRestricted, openMenu } = useStore();
  const isLive = item.type === 'live';
  const restricted = isRestricted(item);
  const subtitle = sub ?? (isLive ? findNow(programmesFor(item))?.title || item.group : undefined);
  return (
    <button
      className={`card card-${variant}`}
      onClick={onClick || (() => open(item))}
      onContextMenu={(e) => (e.preventDefault(), openMenu(item))}
      data-longpress={item.id}
      title={item.displayName || item.name}
    >
      <div className="card-media">
        <Thumb src={item.logo} name={item.name} contain={isLive} />
        {isLive && <span className="badge-live">AO VIVO</span>}
        {item.lang === 'leg' && !item.variants?.some((v) => v.lang !== 'leg') && <span className="badge-lang">LEG</span>}
        {restricted && (
          <span className="badge-lock" title="Bloqueado">
            <Icon name="lock" size={14} />
          </span>
        )}
        <div className="card-hover">
          <span className="play-circle">
            <Icon name="play" size={22} />
          </span>
        </div>
        {progress > 0 && (
          <div className="card-progress">
            <span style={{ width: `${Math.min(progress, 1) * 100}%` }} />
          </div>
        )}
      </div>
      <div className="card-title">{item.displayName || item.name}</div>
      {subtitle && <div className="card-sub">{subtitle}</div>}
    </button>
  );
}

export function Row({ title, to, children }) {
  const track = useRef(null);
  const scroll = (dir) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.85, behavior: 'smooth' });
  return (
    <section className="row">
      <div className="row-head">
        <h2>
          {to ? (
            <Link to={to}>
              {title}
              <Icon name="chevron-right" size={18} />
            </Link>
          ) : (
            title
          )}
        </h2>
        <div className="row-nav">
          <button className="icon-btn" tabIndex={-1} onClick={() => scroll(-1)} aria-label="Anterior">
            <Icon name="chevron-left" />
          </button>
          <button className="icon-btn" tabIndex={-1} onClick={() => scroll(1)} aria-label="Próximo">
            <Icon name="chevron-right" />
          </button>
        </div>
      </div>
      <div className="row-track" ref={track}>
        {children}
      </div>
    </section>
  );
}

// Grade com renderização incremental — listas IPTV podem ter dezenas de milhares de itens.
export function Grid({ items, variant = 'poster', sub, memoryKey = 'grid' }) {
  const PAGE = PERF.gridPage;
  // Lembra quantos itens já estavam carregados para voltar no mesmo ponto da grade.
  const [count, setCount] = useRestoredState(memoryKey, PAGE);
  const firstItems = useRef(true);
  const sentinel = useRef(null);

  useEffect(() => {
    if (firstItems.current) return void (firstItems.current = false);
    setCount(PAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => e.isIntersecting && setCount((c) => Math.min(c + PAGE, items.length)),
      { rootMargin: PERF.gridMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [items.length]);

  return (
    <>
      <div className={`grid grid-${variant}`}>
        {items.slice(0, count).map((it) => (
          <Card key={it.id} item={it} variant={variant} sub={sub?.(it)} />
        ))}
      </div>
      {count < items.length && <div ref={sentinel} className="grid-sentinel" />}
    </>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <img src="./logo.png" alt="" />
      <h3>{title}</h3>
      <p>{children}</p>
      <Link to="/settings" className="btn">
        <Icon name="plus" size={18} /> Adicionar lista IPTV
      </Link>
    </div>
  );
}

export function PageHeader({ title, count, children }) {
  return (
    <div className="page-head">
      <h1>
        {title}
        {count != null && <span className="count">{count.toLocaleString('pt-BR')}</span>}
      </h1>
      <div className="page-tools">{children}</div>
    </div>
  );
}

export function Chips({ options, value, onChange }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={o} className={`chip ${o === value ? 'active' : ''}`} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}
