// Estatísticas de um jogo de futebol: chances do jogo, chances na temporada (simulação do resto do
// campeonato), últimos confrontos, momento dos times, artilheiros e próximos jogos dos dois clubes.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { compName, fetchMatch, pct, simulateSeason } from '../lib/match';
import { Modal } from './Overlays';
import Icon from './Icon';

const day = (d) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
const when = (d) => new Date(d).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function Crest({ src, name }) {
  return src ? <img className="ms-crest" src={src} alt="" loading="lazy" /> : <span className="ms-crest ms-crest-empty">{(name || '?')[0]}</span>;
}

function Form({ form }) {
  if (!form) return <span className="muted">—</span>;
  return (
    <span className="ms-form">
      {[...form].map((r, i) => (
        <span key={i} className={`ms-r ms-${r}`}>
          {r}
        </span>
      ))}
    </span>
  );
}

// Barra com as três chances do jogo.
function Odds({ odds, home, away }) {
  const parts = [
    { k: 'h', label: home, p: odds.home },
    { k: 'd', label: 'Empate', p: odds.draw },
    { k: 'a', label: away, p: odds.away },
  ];
  return (
    <>
      <div className="ms-bar">
        {parts.map((x) => (
          <span key={x.k} className={`ms-bar-${x.k}`} style={{ width: `${x.p * 100}%` }} />
        ))}
      </div>
      <div className="ms-bar-legend">
        {parts.map((x) => (
          <span key={x.k}>
            <i className={`ms-dot ms-bar-${x.k}`} /> {x.label} <b>{pct(x.p)}</b>
          </span>
        ))}
      </div>
    </>
  );
}

// "preload": dados já carregados (testes).
export function MatchStats({ evt, preload }) {
  const [state, setState] = useState(() => (preload ? { data: preload } : { loading: true }));
  useEffect(() => {
    if (preload) return undefined;
    let alive = true;
    setState({ loading: true });
    fetchMatch(evt.id)
      .then((data) => alive && setState({ data }))
      .catch((e) => alive && setState({ error: e.message }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evt.id]);
  const d = state.data;
  const season = useMemo(() => (d?.sim ? simulateSeason(d.sim, [d.home.id, d.away.id]) : null), [d]);

  if (state.loading)
    return (
      <div className="ms ms-loading">
        <span className="spinner sm" /> Carregando estatísticas do jogo…
      </div>
    );
  if (state.error) return <p className="muted ms">{state.error}</p>;
  const { home: H, away: A } = d;
  const tableLine = (t) => (t?.table ? `${t.table.rank}º · ${t.table.points} pts em ${t.table.played} jogos` : '');

  return (
    <div className="ms">
      {d.odds && (
        <section className="ms-sec" tabIndex={0}>
          <h3>Chances neste jogo</h3>
          <Odds odds={d.odds} home={H.short || H.name} away={A.short || A.name} />
          <small className="muted">Pelas cotações das casas de apostas{d.odds.provider ? ` (${d.odds.provider})` : ''}.</small>
        </section>
      )}

      {season && (
        <section className="ms-sec" tabIndex={0}>
          <h3>Chances na temporada · {compName(d.competition)}</h3>
          <table className="ms-table">
            <thead>
              <tr>
                <th />
                <th>
                  <Crest src={H.logo} name={H.name} /> {H.short || H.name}
                </th>
                <th>
                  <Crest src={A.logo} name={A.name} /> {A.short || A.name}
                </th>
              </tr>
            </thead>
            <tbody>
              {season.map((z) => (
                <tr key={z.label}>
                  <td>
                    {z.label} <small className="muted">({z.from === z.to ? `${z.from}º` : `${z.from}º–${z.to}º`})</small>
                  </td>
                  <td className={z.p[H.id] >= 0.5 ? 'hi' : ''}>{pct(z.p[H.id])}</td>
                  <td className={z.p[A.id] >= 0.5 ? 'hi' : ''}>{pct(z.p[A.id])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <small className="muted">Estimativa: o restante do campeonato simulado 3.000 vezes, pela média de gols de cada time.</small>
        </section>
      )}

      <section className="ms-sec" tabIndex={0}>
        <h3>Últimos confrontos</h3>
        {d.h2h.length ? (
          <ul className="ms-list">
            {d.h2h.map((g, i) => (
              <li key={i}>
                <span className="muted">{day(g.date)}</span>
                <span className="ms-h2h">
                  {g.home} <b>{g.homeScore}</b> x <b>{g.awayScore}</b> {g.away}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Sem confrontos recentes registrados.</p>
        )}
      </section>

      <section className="ms-sec ms-two" tabIndex={0}>
        {[H, A].map((t) => (
          <div key={t.id} className="ms-team">
            <h3>
              <Crest src={t.logo} name={t.name} /> {t.name}
            </h3>
            {tableLine(t) && <p className="muted">{tableLine(t)}</p>}
            <p>
              <span className="muted">Últimos jogos: </span>
              <Form form={t.form} />
            </p>
            <p>
              <Icon name="ball" size={14} /> <span className="muted">Artilheiro:</span>{' '}
              {t.scorer ? (
                <>
                  <b>{t.scorer.name}</b> — {t.scorer.goals} gols{t.scorer.matches ? ` em ${t.scorer.matches} jogos` : ''}
                </>
              ) : (
                '—'
              )}
            </p>
            <div className="ms-next">
              <span className="muted">Próximos jogos:</span>
              {t.next.length ? (
                <ul className="ms-list">
                  {t.next.map((g, i) => (
                    <li key={i}>
                      <span className="muted">{when(g.date)}</span>
                      <span>
                        {g.opponent} <small className="muted">· {g.home ? 'em casa' : 'fora'} · {compName(g.competition)}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Nenhum jogo marcado.</p>
              )}
            </div>
          </div>
        ))}
      </section>

      {d.leagueScorer && (
        <section className="ms-sec" tabIndex={0}>
          <h3>Artilheiro do campeonato</h3>
          <p>
            <b>{d.leagueScorer.name}</b> ({d.leagueScorer.team}) — {d.leagueScorer.goals} gols
            {d.leagueScorer.matches ? ` em ${d.leagueScorer.matches} jogos` : ''}
          </p>
        </section>
      )}
      <small className="muted ms-src">Dados: ESPN.</small>
    </div>
  );
}

// Janela com as estatísticas (aberta pelo player ou pelo detalhe do programa).
export function MatchModal() {
  const { matchEvt, closeMatch } = useStore();
  if (!matchEvt) return null;
  return (
    <Modal onClose={closeMatch} title={`${matchEvt.home} x ${matchEvt.away}`} className="match-modal">
      <MatchStats evt={matchEvt} />
    </Modal>
  );
}
