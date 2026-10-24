import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import Icon from './Icon';
import { useItemMeta } from './MetaSections';
import { PlatformLogo } from './Platform';
import { RatingBadge } from './Media';
import { useLoadedImage } from './useLoadedImage';
import { useSwipe } from './TouchUI';
import { PERF } from '../config/perf';
import { recentUnique } from '../lib/home';
import { canonGroup, platformOfItem } from '../lib/library';
import { cleanTitle, img, normTitle } from '../lib/meta';
import { fmtTime } from '../lib/epg';
import { ADULT_RE } from '../lib/parental';
import { normGroup } from '../config/platforms';

const ROTATE_MS = 8000;

// "Apple", "Séries Netflix", "HBO Max" = só o nome da plataforma (não repete o selo da plataforma);
// "Netflix Lançamentos 2026" traz informação a mais e é exibida.
const isJustPlatform = (group, platform) => {
  if (!platform) return false;
  const g = normGroup(group);
  if (!platform.test(g)) return false;
  return g.replace(/\b(series|serie|filmes|filme|tv|max|play|video|plus)\b|[+()]/g, ' ').trim().split(/\s+/).filter(Boolean).length <= 1;
};

const fmtRuntime =(min) => (min ? `${Math.floor(min / 60) ? Math.floor(min / 60) + 'h ' : ''}${min % 60}min` : '');

// Procura o título no guia de programação dos canais ao vivo (próximas 24 h).
function useAiring(item) {
  const { catalog, programmesFor } = useStore();
  return useMemo(() => {
    if (!item) return null;
    const t = normTitle(cleanTitle(item.series?.name || item.name).title);
    if (t.length < 3) return null;
    const now = Date.now();
    let best = null;
    for (const ch of catalog.live) {
      const progs = programmesFor(ch);
      if (!progs) continue;
      for (const p of progs) {
        if (p.stop <= now) continue;
        if (p.start > now + 24 * 3600e3) break;
        if (normTitle(cleanTitle(p.title).title) === t && (!best || p.start < best.prog.start)) best = { channel: ch, prog: p };
      }
    }
    return best;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, catalog.live, programmesFor]);
}

// Destaque do topo de Filmes/Séries: os 5 adicionados mais recentemente, trocando de forma
// aleatória a cada 8 segundos.
export default function LibraryHero({ items }) {
  // Conteúdo adulto nunca vai para o destaque.
  const picks = useMemo(() => recentUnique(items.filter((it) => !(it.groups || [it.group]).some((g) => ADULT_RE.test(g || ''))), PERF.heroItems), [items]);
  const [i, setI] = useState(0);
  const [info, setInfo] = useState({});
  const { getXtreamInfo, play } = useStore();
  const navigate = useNavigate();
  const paused = useRef(false);
  const [tick, setTick] = useState(0); // reinicia a contagem ao tirar o mouse de cima

  useEffect(() => {
    if (picks.length < 2 || !PERF.heroRotate) return;
    // O tempo conta a partir da última troca (automática ou escolhida pelo usuário).
    const t = setTimeout(() => {
      if (paused.current) return; // pausado com o mouse em cima; volta a contar ao sair
      setI((cur) => {
        let n = cur;
        while (n === cur) n = Math.floor(Math.random() * picks.length);
        return n;
      });
    }, ROTATE_MS);
    return () => clearTimeout(t);
  }, [picks.length, i, tick]);

  // Busca duração/sinopse/fundo no servidor Xtream (com cache), um título de cada vez.
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const it of picks) {
        const v = await getXtreamInfo(it);
        if (!alive) return;
        setInfo((m) => ({ ...m, [it.id]: v || {} })); // {} = já consultado, sem dados
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks.map((p) => p.id).join('|')]);

  // Celular/tablet: deslizar para o lado troca o destaque.
  const swipe = useSwipe((dir) => picks.length > 1 && setI((cur) => (cur + dir + picks.length) % picks.length));
  const item = picks[i % (picks.length || 1)];
  const meta = useItemMeta(item);
  const airing = useAiring(item);
  // Escolhe o fundo só depois de saber qual é o melhor (TMDB > Xtream > capa) e baixa uma vez.
  const bgReady = !!item && (!meta.enabled || !meta.loading) && info[item.id] !== undefined;
  const bestBg = item ? img(meta.data?.backdrop, 'w1280') || info[item.id]?.backdrop || item.backdrop || item.logo : null;
  const shownBg = useLoadedImage(bestBg, bgReady);
  if (!item) return null;

  const d = meta.data;
  const x = info[item.id] || {};
  const backdrop = img(d?.backdrop, 'w1280') || x.backdrop || item.backdrop || item.logo;
  const runtime = d?.runtime || x.runtime;
  const platform = platformOfItem(item);
  const streaming = d?.providers?.flatrate?.map((p) => p.name).filter((n) => n !== platform?.name) || [];
  const overview = d?.overview || x.plot || item.plot;
  const year = d?.year || x.year || item.year;
  const isSeries = item.type === 'series';

  const watch = () => (isSeries ? navigate(`/item/${item.id}`) : play(item));

  return (
    <section className="lib-hero" {...swipe} onMouseEnter={() => (paused.current = true)} onMouseLeave={() => {
        paused.current = false;
        setTick((t) => t + 1);
      }}>
      {shownBg && <div key={shownBg} className="lib-hero-bg" style={{ backgroundImage: `url("${shownBg}")` }} />}
      <div className="lib-hero-shade" />
      <div className="lib-hero-content">
        <span className="lib-hero-kicker">Adicionado recentemente</span>
        <h1>{item.displayName || item.name}</h1>
        <div className="meta">
          <RatingBadge age={d?.cert ?? null} />
          {year && <span>{year}</span>}
          {runtime && <span>{isSeries ? `${runtime} min por episódio` : fmtRuntime(runtime)}</span>}
          {isSeries && (x.seasons || d?.seasons) && <span>{x.seasons || d.seasons} temporada(s)</span>}
          {(d?.genres?.length ? d.genres.slice(0, 2).join(' · ') : x.genre) && <span>{d?.genres?.length ? d.genres.slice(0, 2).join(' · ') : x.genre}</span>}
        </div>
        {overview && <p className="lib-hero-plot">{overview}</p>}
        <div className="lib-hero-where">
          {platform && (
            <span className="where-chip">
              <PlatformLogo platform={platform} size={18} /> {platform.name}
            </span>
          )}
          {streaming.slice(0, 2).map((n) => (
            <span key={n} className="where-chip">
              {n}
            </span>
          ))}
          {!isJustPlatform(canonGroup(item.group), platform) && (
            <span className="where-chip muted-chip" title="Categoria na sua lista">
              <Icon name="list" size={14} /> {canonGroup(item.group)}
            </span>
          )}
          {airing && (
            <span className="where-chip live-chip" title="Passando num canal ao vivo da sua lista">
              <Icon name="tv" size={14} /> {airing.channel.name} · {airing.prog.start <= Date.now() ? 'agora' : fmtTime(airing.prog.start)}
            </span>
          )}
        </div>
        <div className="hero-actions">
          <button className="btn" onClick={watch}>
            <Icon name="play" size={18} /> {isSeries ? 'Ver episódios' : 'Assistir'}
          </button>
          <button className="btn ghost" onClick={() => navigate(`/item/${item.id}`)}>
            Mais informações
          </button>
        </div>
      </div>
      {picks.length > 1 && (
        <div className="hero-dots">
          {picks.map((p, n) => (
            <button key={p.id} className={n === i ? 'active' : ''} onClick={() => setI(n)} aria-label={p.displayName || p.name} tabIndex={-1} />
          ))}
        </div>
      )}
    </section>
  );
}
