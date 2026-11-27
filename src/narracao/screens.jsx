// Telas de escolha do GATES Narração: início (meus narradores, jogos de hoje, busca) e as lives de um jogo.
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon';
import { useLicense } from '../components/LicenseGate';
import { focusEl, isTvMode } from '../lib/keys';
import { offsetText, queryFor, searchLives } from '../lib/narration';
import { useTeamBadges, useTodaysEvents } from '../lib/sports';
import { cleanVoiceText, onVoice, startVoice, voiceMode } from '../lib/voice';
import { Crest, LiveList, LiveRow, fmtTime } from './parts';
import { isDesktopNarr } from './platform';

const SEARCH_ERR = 'Não foi possível buscar no YouTube agora. Verifique a internet e tente de novo.';
const isLive = (e, now) => e.start <= now && now < e.end;

function useNow(ms) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// Busca de lives (com o campo de texto): { loading } | { list } | { error }.
function useLiveSearch() {
  const [res, setRes] = useState(null);
  const seq = useRef(0);
  const run = async (term) => {
    const t = String(term || '').trim();
    if (t.length < 2) return;
    const n = ++seq.current;
    setRes({ loading: true });
    try {
      const list = await searchLives(t);
      if (n === seq.current) setRes({ list });
    } catch {
      if (n === seq.current) setRes({ error: SEARCH_ERR });
    }
  };
  return [res, run, setRes];
}

function GameCard({ e, now, badges, onOpen }) {
  const live = isLive(e, now);
  return (
    <button className={`sg-card np-game ${live ? 'is-live' : ''}`} onClick={() => onOpen(e)} title={e.away ? `${e.home} x ${e.away}` : e.home}>
      <div className="sg-top">
        {live ? <span className="badge-live static">AO VIVO</span> : <strong className="sg-time">{fmtTime(e.start)}</strong>}
      </div>
      <div className="sg-teams">
        <div className="sg-team">
          <Crest src={badges[e.home] || e.homeBadge} name={e.home} />
          <span>{e.home}</span>
        </div>
        {e.away && (
          <>
            <span className="sg-vs">x</span>
            <div className="sg-team">
              <Crest src={badges[e.away] || e.awayBadge} name={e.away} />
              <span>{e.away}</span>
            </div>
          </>
        )}
      </div>
      <div className="sg-foot">
        <span className="sg-comp">{e.leagueName}</span>
        <span className="sg-count">{e.round}</span>
      </div>
    </button>
  );
}

export function Home({ active, p, favs, favLive, checkFavs, onFav, onPick, onGame, onPlayer, notify, onHelp }) {
  const lic = useLicense();
  const now = useNow(60e3);
  const [q, setQ] = useState('');
  const [res, search, setRes] = useLiveSearch();
  const favIds = useMemo(() => new Set(favs.map((f) => f.id)), [favs]);

  // Quem está ao vivo entre os favoritos: confere ao abrir e ao voltar para esta tela (no máx. 1x/min).
  const lastCheck = useRef(0);
  useEffect(() => {
    if (!active || Date.now() - lastCheck.current < 60e3) return;
    lastCheck.current = Date.now();
    checkFavs();
  }, [active, checkFavs]);

  // Busca por voz (lib/voice.js). No Windows a Web Speech do Electron não funciona: sem microfone.
  const [voice, setVoice] = useState(null);
  const [listening, setListening] = useState(null);
  const cancelVoice = useRef(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    let alive = true;
    voiceMode()
      .then((m) => alive && setVoice(m === 'web' && isDesktopNarr() ? null : m))
      .catch(() => {});
    const off = onVoice((d) => {
      if (!activeRef.current) return;
      if (d.error) return notify(d.error, 'err');
      const t = cleanVoiceText(d.text);
      if (!t) return;
      setQ(t);
      search(t);
    });
    return () => {
      alive = false;
      off();
      cancelVoice.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const mic = () => {
    if (listening) return cancelVoice.current?.();
    cancelVoice.current = startVoice(voice, setListening);
  };

  const submit = (e) => {
    e.preventDefault();
    search(q);
  };

  // Jogos de hoje (agenda do servidor, lib/sports.js): os ao vivo primeiro. Sem jogos hoje: os próximos.
  const events = useTodaysEvents();
  const games = useMemo(() => {
    const endToday = new Date(now).setHours(24, 0, 0, 0);
    const today = events.filter((e) => e.start < endToday);
    return (today.length ? today : events.slice(0, 10)).slice().sort((a, b) => isLive(b, now) - isLive(a, now) || a.start - b.start);
  }, [events, now]);
  const hasToday = games.some((e) => e.start < new Date(now).setHours(24, 0, 0, 0));
  const badges = useTeamBadges(useMemo(() => [...new Set(games.flatMap((e) => [e.home, e.away]).filter(Boolean))], [games]));

  return (
    <div className="np-home">
      <header className="np-head">
        <img src="./logo.png" alt="" className="np-logo" />
        <div className="np-head-title">
          <h1>GATES Narração</h1>
          <p className="muted">A narração do YouTube por cima do app do jogo.</p>
        </div>
        <button className="btn ghost small" onClick={onHelp}>
          <Icon name="info" size={16} /> Como usar
        </button>
      </header>

      {p.narr && (
        <section className="np-sec np-nowcard">
          <div>
            <small className="muted">Ouvindo agora</small>
            <strong>{p.narr.channel}</strong>
            <span className="muted">
              {p.paused ? 'Pausada · ' : ''}
              {offsetText(p.offset)}
            </span>
          </div>
          <button className="btn" data-autofocus onClick={onPlayer}>
            <Icon name="volume" size={16} /> Voltar à narração
          </button>
          <button className="btn ghost" onClick={p.stop}>
            <Icon name="close" size={16} /> Parar
          </button>
        </section>
      )}

      <section className="np-sec">
        <h2>Buscar narração</h2>
        <form className="np-search" onSubmit={submit}>
          <label className="search">
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome do canal, do narrador ou do jogo" enterKeyHint="search" />
          </label>
          {voice && (
            <button type="button" className={`icon-btn big ${listening ? 'active' : ''}`} onClick={mic} aria-label="Buscar por voz" title={listening === 'working' ? 'Reconhecendo…' : listening ? 'Ouvindo… (toque para cancelar)' : 'Buscar por voz'}>
              {listening === 'working' ? <span className="spinner sm" /> : <Icon name="mic" />}
            </button>
          )}
          <button className="btn" type="submit" disabled={q.trim().length < 2 || res?.loading}>
            Buscar
          </button>
          {res && (
            <button type="button" className="btn ghost" onClick={() => (setRes(null), setQ(''))}>
              Limpar
            </button>
          )}
        </form>
        <LiveList res={res} favIds={favIds} current={p.narr?.key} onPick={onPick} onFav={onFav} />
      </section>

      <section className="np-sec">
        <h2>
          Meus narradores
          {favs.length > 0 && (
            <button className="icon-btn np-h-btn" onClick={() => ((lastCheck.current = Date.now()), checkFavs())} aria-label="Ver de novo quem está ao vivo" title="Ver de novo quem está ao vivo">
              <Icon name="refresh" size={16} />
            </button>
          )}
        </h2>
        {!favs.length && <p className="muted">Toque na estrela de uma narração para guardar o canal aqui. Assim você vê na hora quem está ao vivo.</p>}
        <div className="np-list">
          {favs.map((f) => {
            const live = favLive[f.id];
            return live?.key ? (
              <LiveRow key={f.id} l={{ ...live, channel: f.name, channelId: f.id, live: true }} fav current={p.narr?.channelId === f.id} onPick={onPick} onFav={onFav} autofocus={!p.narr} />
            ) : (
              <div key={f.id} className="narr-row np-row off">
                <div className="narr-pick">
                  <strong>{f.name}</strong>
                  <span className="muted">{live?.loading ? 'Verificando se está ao vivo…' : 'Não está ao vivo agora'}</span>
                </div>
                <button className="icon-btn on" onClick={() => onFav(f)} aria-label={`Tirar ${f.name} dos favoritos`} title="Tirar dos meus narradores">
                  <Icon name="star" filled />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="np-sec">
        <h2>{hasToday ? 'Jogos de hoje' : 'Próximos jogos'}</h2>
        {!games.length ? (
          <p className="muted np-wait">
            {events.length ? 'Nenhum jogo hoje.' : 'Carregando a agenda de jogos…'}{' '}
            <button className="link-btn" onClick={() => onGame(null)}>
              Ver narrações de futebol ao vivo
            </button>
          </p>
        ) : (
          <div className="sg-grid np-games">
            {games.map((e) => (
              <GameCard key={e.id} e={e} now={now} badges={badges} onOpen={(g) => onGame(g, { home: badges[g.home] || g.homeBadge, away: badges[g.away] || g.awayBadge })} />
            ))}
          </div>
        )}
      </section>

      {lic?.payload?.email && (
        <footer className="np-foot muted">
          {lic.payload.email} ·{' '}
          <button className="link-btn" onClick={lic.logout}>
            Sair deste aparelho
          </button>
        </footer>
      )}
    </div>
  );
}

// Lives de narração de um jogo (busca no YouTube pelo nome dos times; o termo pode ser editado).
export function GameLives({ game, crests, p, favs, onPick, onFav, onBack }) {
  const [q, setQ] = useState(() => queryFor(game));
  const [res, search] = useLiveSearch();
  const favIds = useMemo(() => new Set(favs.map((f) => f.id)), [favs]);
  useEffect(() => {
    search(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // TV: as lives chegaram e o foco ainda está no "Voltar" (ou em lugar nenhum): vai para a primeira.
  const page = useRef(null);
  useEffect(() => {
    if (!res?.list?.length || !isTvMode()) return;
    const a = document.activeElement;
    if (a && a !== document.body && !page.current?.querySelector('.np-head')?.contains(a)) return;
    focusEl(page.current?.querySelector('.narr-pick'));
  }, [res]);
  return (
    <div className="np-gamepage" ref={page}>
      <header className="np-head">
        <button className="icon-btn big" onClick={onBack} aria-label="Voltar" title="Voltar">
          <Icon name="back" />
        </button>
        {game ? (
          <div className="sg-teams np-game-head">
            <div className="sg-team">
              <Crest src={crests?.home} name={game.home} />
              <strong>{game.home}</strong>
            </div>
            {game.away && (
              <>
                <span className="sg-vs">{game.start <= Date.now() ? <span className="badge-live static">AO VIVO</span> : fmtTime(game.start)}</span>
                <div className="sg-team">
                  <Crest src={crests?.away} name={game.away} />
                  <strong>{game.away}</strong>
                </div>
              </>
            )}
          </div>
        ) : (
          <h1>Narrações ao vivo</h1>
        )}
      </header>
      {game && (
        <p className="muted np-center">
          {game.leagueName}
          {game.round ? ` · ${game.round}` : ''} · {fmtTime(game.start)}
        </p>
      )}
      <section className="np-sec">
        <h2>Narrações deste jogo</h2>
        <form
          className="np-search"
          onSubmit={(e) => {
            e.preventDefault();
            search(q);
          }}
        >
          <label className="search">
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome do canal ou do jogo" enterKeyHint="search" />
          </label>
          <button className="btn" type="submit" disabled={q.trim().length < 2 || res?.loading}>
            <Icon name="refresh" size={16} /> Buscar de novo
          </button>
        </form>
        <LiveList res={res} favIds={favIds} current={p.narr?.key} onPick={onPick} onFav={onFav} autofocus empty="Nenhuma narração ao vivo deste jogo agora. Perto do horário do jogo os narradores abrem a live; tente de novo ou busque pelo nome do canal." />
      </section>
    </div>
  );
}
