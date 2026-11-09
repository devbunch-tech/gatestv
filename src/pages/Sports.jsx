// Esportes: todos os jogos e lutas da lista (pelo guia de programação), os que estão passando agora
// e os próximos. Cada jogo é um cartão com os escudos; ao abrir, mostra todos os canais que transmitem.
import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Empty, PageHeader, Thumb, initials } from '../components/Media';
import { Modal } from '../components/Overlays';
import Icon from '../components/Icon';
import { fmtTime, progressOf, useNow } from '../lib/epg';
import { splitGame, upcomingGames } from '../lib/home';
import { useTeamBadges } from '../lib/sports';

const HOURS = 48;

function dayLabel(ts, now) {
  const d = new Date(ts);
  const diff = Math.round((new Date(d.toDateString()) - new Date(new Date(now).toDateString())) / 864e5);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
}

function Crest({ src, name }) {
  const [err, setErr] = useState(false);
  return (
    <span className="crest sg-crest">
      {src && !err ? <img src={src} alt="" loading="lazy" onError={() => setErr(true)} /> : <span>{initials(name || '?')}</span>}
    </span>
  );
}

function GameCard({ game, now, badges, onOpen }) {
  const { prog, channels } = game;
  const live = prog.start <= now && now < prog.stop;
  const { competition, home, away } = splitGame(prog.title);
  return (
    <button className={`sg-card ${live ? 'is-live' : ''}`} onClick={() => onOpen(game)} title={away ? `${home} x ${away}` : home}>
      <div className="sg-top">
        {live ? <span className="badge-live static">AO VIVO</span> : <strong className="sg-time">{fmtTime(prog.start)}</strong>}
        <span className="sg-count">{channels.length === 1 ? '1 canal' : `${channels.length} canais`}</span>
      </div>
      <div className="sg-teams">
        <div className="sg-team">
          <Crest src={badges[home]} name={home} />
          <span>{home}</span>
        </div>
        {away && (
          <>
            <span className="sg-vs">x</span>
            <div className="sg-team">
              <Crest src={badges[away]} name={away} />
              <span>{away}</span>
            </div>
          </>
        )}
      </div>
      <div className="sg-comp">{competition || prog.category?.split(',')[0] || 'Esporte'}</div>
      {live && (
        <div className="lb-progress sg-progress">
          <span style={{ width: `${progressOf(prog, now) * 100}%` }} />
        </div>
      )}
    </button>
  );
}

// Janela com todos os canais que transmitem o jogo.
function GameChannels({ game, now, badges, onClose }) {
  const { play, openProgram, catalog } = useStore();
  const { prog, channels } = game;
  const live = prog.start <= now && now < prog.stop;
  const { competition, home, away } = splitGame(prog.title);
  const open = (ch) => {
    onClose();
    if (live) play(ch, catalog.live);
    else openProgram({ item: ch, prog });
  };
  return (
    <Modal onClose={onClose} className="sg-modal">
      <div className="sg-modal-head">
        <div className="sg-teams">
          <div className="sg-team">
            <Crest src={badges[home]} name={home} />
            <strong>{home}</strong>
          </div>
          {away && (
            <>
              <span className="sg-vs">{live ? <span className="badge-live static">AO VIVO</span> : fmtTime(prog.start)}</span>
              <div className="sg-team">
                <Crest src={badges[away]} name={away} />
                <strong>{away}</strong>
              </div>
            </>
          )}
        </div>
        <p className="muted">
          {competition || prog.category?.split(',')[0] || 'Esporte'} · {fmtTime(prog.start)} – {fmtTime(prog.stop)} ·{' '}
          {channels.length === 1 ? '1 canal' : `${channels.length} canais`}
        </p>
      </div>
      <div className="sg-channels">
        {channels.map((ch, i) => (
          <button
            key={ch.id}
            className="sport-channel"
            data-autofocus={i === 0 ? '' : undefined}
            onClick={() => open(ch)}
            title={live ? `Assistir em ${ch.name}` : `${ch.name} — detalhes`}
          >
            <span className="sport-logo">
              <Thumb src={ch.logo} name={ch.name} contain />
            </span>
            <span className="sg-ch-name">{ch.name}</span>
            <Icon name={live ? 'play' : 'info'} size={14} />
          </button>
        ))}
      </div>
    </Modal>
  );
}

export default function Sports() {
  const { catalog, programmesFor, loading } = useStore();
  const now = useNow(30000);
  const minute = Math.floor(now / 60000);
  const [filter, setFilter] = useState('');
  const [openKey, setOpenKey] = useState(null);

  const games = useMemo(
    () => upcomingGames(catalog.live, programmesFor, Date.now(), { limit: Infinity, hours: HOURS }),
    // Recalcula a cada minuto (jogos que começam/terminam).
    [catalog.live, programmesFor, minute] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const sections = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = (f ? games.filter((g) => `${g.prog.title} ${g.channels.map((c) => c.name).join(' ')}`.toLowerCase().includes(f)) : games)
      .slice()
      .sort((a, b) => a.prog.start - b.prog.start);
    const out = [];
    const liveNow = list.filter((g) => g.prog.start <= now && now < g.prog.stop);
    if (liveNow.length) out.push({ title: 'Passando agora', games: liveNow });
    const byDay = new Map();
    for (const g of list) {
      if (g.prog.start <= now) continue;
      const d = dayLabel(g.prog.start, now);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(g);
    }
    for (const [d, gs] of byDay) out.push({ title: `Próximos · ${d}`, games: gs });
    return out;
  }, [games, filter, now]);

  // Escudos: primeiro os jogos que estão passando, depois os próximos.
  const teamNames = useMemo(
    () => [...new Set(sections.flatMap((s) => s.games.flatMap((g) => Object.values(splitGame(g.prog.title)).slice(1))).filter(Boolean))],
    [sections]
  );
  const badges = useTeamBadges(teamNames);
  const openGame = openKey ? games.find((g) => g.key === openKey) : null;

  if (loading && !catalog.live.length) return <div className="loading"><div className="spinner" /></div>;
  if (!catalog.live.length) return <Empty title="Nenhum canal ao vivo">Sua lista ainda não tem canais ao vivo.</Empty>;

  return (
    <div className="sports-page">
      <PageHeader title="Esportes" count={games.length}>
        <label className="search small">
          <Icon name="search" size={16} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar por time, campeonato ou canal" />
        </label>
      </PageHeader>
      <p className="muted hint-line">Jogos e lutas de hoje e dos próximos 2 dias, pelo guia de programação dos seus canais. Escolha um jogo para ver os canais.</p>
      {!sections.length && (
        <p className="muted pad">{filter ? 'Nenhum jogo encontrado.' : 'Nenhum jogo encontrado no guia de programação dos seus canais.'}</p>
      )}
      {sections.map((s) => (
        <section key={s.title} className="sport-section">
          <h2>{s.title}</h2>
          <div className="sg-grid">
            {s.games.map((g) => (
              <GameCard key={g.key} game={g} now={now} badges={badges} onOpen={(game) => setOpenKey(game.key)} />
            ))}
          </div>
        </section>
      ))}
      {openGame && <GameChannels game={openGame} now={now} badges={badges} onClose={() => setOpenKey(null)} />}
    </div>
  );
}
