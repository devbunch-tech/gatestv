// Esportes: todos os jogos e lutas da lista (pelo guia de programação), os que estão passando agora
// e os próximos, com todos os canais que transmitem cada um.
import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Empty, PageHeader, Thumb } from '../components/Media';
import Icon from '../components/Icon';
import { fmtTime, progressOf, useNow } from '../lib/epg';
import { splitGame, upcomingGames } from '../lib/home';

const HOURS = 48;

function dayLabel(ts, now) {
  const d = new Date(ts);
  const diff = Math.round((new Date(d.toDateString()) - new Date(new Date(now).toDateString())) / 864e5);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
}

function GameRow({ game, now }) {
  const { play, openProgram, catalog } = useStore();
  const { prog, channels } = game;
  const live = prog.start <= now && now < prog.stop;
  const { competition, home, away } = splitGame(prog.title);
  const open = (ch) => (live ? play(ch, catalog.live) : openProgram({ item: ch, prog }));
  return (
    <div className={`sport-row ${live ? 'is-live' : ''}`}>
      <div className="sport-when">
        {live ? <span className="badge-live static">AO VIVO</span> : <strong>{fmtTime(prog.start)}</strong>}
        {live && <small>até {fmtTime(prog.stop)}</small>}
      </div>
      <div className="sport-info">
        <strong>{away ? `${home} x ${away}` : home}</strong>
        <span className="muted">{competition || prog.category?.split(',')[0] || 'Esporte'}</span>
        {live && (
          <div className="guide-bar">
            <span style={{ width: `${progressOf(prog, now) * 100}%` }} />
          </div>
        )}
      </div>
      <div className="sport-channels">
        {channels.map((ch) => (
          <button key={ch.id} className="sport-channel" onClick={() => open(ch)} title={live ? `Assistir em ${ch.name}` : `${ch.name} — detalhes`}>
            <span className="sport-logo">
              <Thumb src={ch.logo} name={ch.name} contain />
            </span>
            <span>{ch.name}</span>
            <Icon name={live ? 'play' : 'info'} size={14} />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Sports() {
  const { catalog, programmesFor, loading } = useStore();
  const now = useNow(30000);
  const minute = Math.floor(now / 60000);
  const [filter, setFilter] = useState('');

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
      <p className="muted hint-line">Jogos e lutas de hoje e dos próximos 2 dias, pelo guia de programação dos seus canais.</p>
      {!sections.length && (
        <p className="muted pad">{filter ? 'Nenhum jogo encontrado.' : 'Nenhum jogo encontrado no guia de programação dos seus canais.'}</p>
      )}
      {sections.map((s) => (
        <section key={s.title} className="sport-section">
          <h2>{s.title}</h2>
          {s.games.map((g) => (
            <GameRow key={g.key} game={g} now={now} />
          ))}
        </section>
      ))}
    </div>
  );
}
