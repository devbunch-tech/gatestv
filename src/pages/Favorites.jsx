import { useState } from 'react';
import { useStore } from '../store';
import { Stars } from '../components/StarRating';
import { Card, PageHeader, Row, Thumb } from '../components/Media';
import Icon from '../components/Icon';
import { nextAiring } from '../lib/shows';
import { fmtTime, useNow } from '../lib/epg';

const dayLabel = (t) => {
  const d = new Date(t);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 864e5);
  if (d.toDateString() === today.toDateString()) return 'hoje';
  if (d.toDateString() === tomorrow.toDateString()) return 'amanhã';
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
};

export default function Favorites() {
  const { favorites, catalog, shows, removeShow, programmesFor, openProgram, later, toggleLater, ratings } = useStore();
  const [order, setOrder] = useState('best'); // classificações: melhores ou piores primeiro
  const [stars, setStars] = useState(0); // classificações: 0 = todas as notas
  const laterItems = later.map((id) => catalog.byId.get(id)).filter(Boolean);
  const allRated = Object.entries(ratings)
    .map(([id, r]) => ({ item: catalog.byId.get(id), stars: r.stars, at: r.at }))
    .filter((x) => x.item);
  const rated = allRated
    .filter((x) => !stars || x.stars === stars)
    .sort((a, b) => (order === 'best' ? b.stars - a.stars : a.stars - b.stars) || b.at - a.at);
  const now = useNow(60000);
  const items = favorites.map((id) => catalog.byId.get(id)).filter(Boolean);
  const live = items.filter((i) => i.type === 'live');
  const movies = items.filter((i) => i.type === 'movie');
  const series = items.filter((i) => i.type === 'series');
  const total = items.length + shows.length + laterItems.length + allRated.length;

  return (
    <div className="favorites">
      <PageHeader title="Favoritos" count={total} />
      {!total && (
        <div className="empty">
          <Icon name="heart" size={48} />
          <h3>Nenhum favorito ainda</h3>
          <p>Toque no coração em um canal, filme ou série para guardá-lo aqui. No guia de um canal, toque num programa e em “Avisar quando passar”. Nos trailers, use “Assistir depois”; nos filmes e séries, dê a sua nota em estrelas.</p>
        </div>
      )}
      {laterItems.length > 0 && (
        <section className="row fav-rated fav-later">
          <div className="row-head">
            <h2>Assistir depois</h2>
          </div>
          <div className="row-track fav-rated-track">
            {laterItems.map((it) => (
              <div key={it.id} className="fav-rated-item">
                <Card item={it} sub={it.type === 'series' ? 'Série' : 'Filme'} />
                <button className="chip fav-remove" onClick={() => toggleLater(it.id)} aria-label={`Excluir “${it.displayName || it.name}” da lista Assistir depois`}>
                  <Icon name="trash" size={14} /> Excluir
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {allRated.length > 0 && (
        <section className="row fav-rated">
          <div className="row-head">
            <h2>Classificações</h2>
            <div className="chips">
              <button className={`chip ${order === 'best' ? 'active' : ''}`} onClick={() => setOrder('best')}>
                Melhores primeiro
              </button>
              <button className={`chip ${order === 'worst' ? 'active' : ''}`} onClick={() => setOrder('worst')}>
                Piores primeiro
              </button>
              <button className={`chip ${!stars ? 'active' : ''}`} onClick={() => setStars(0)}>
                Todas
              </button>
              {[5, 4, 3, 2, 1].map((n) => (
                <button key={n} className={`chip ${stars === n ? 'active' : ''}`} onClick={() => setStars(n)} aria-label={`Só as de ${n} estrela${n > 1 ? 's' : ''}`}>
                  {n} <Icon name="star" size={12} filled />
                </button>
              ))}
            </div>
          </div>
          {rated.length ? (
            <div className="row-track fav-rated-track">
              {rated.map(({ item, stars: s }) => (
                <div key={item.id} className="fav-rated-item">
                  <Card item={item} sub={item.type === 'series' ? 'Série' : 'Filme'} />
                  <Stars value={s} />
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Nenhum título com {stars} estrela{stars > 1 ? 's' : ''}.</p>
          )}
        </section>
      )}
      {live.length > 0 && (
        <Row title="Canais">
          {live.map((it) => (
            <Card key={it.id} item={it} variant="wide" sub={it.group} />
          ))}
        </Row>
      )}
      {movies.length > 0 && (
        <Row title="Filmes">
          {movies.map((it) => (
            <Card key={it.id} item={it} sub={it.group} />
          ))}
        </Row>
      )}
      {series.length > 0 && (
        <Row title="Séries">
          {series.map((it) => (
            <Card key={it.id} item={it} sub={it.group} />
          ))}
        </Row>
      )}
      {shows.length > 0 && (
        <section className="row fav-shows">
          <div className="row-head">
            <h2>Programas de TV (lembretes)</h2>
          </div>
          <p className="muted">Avisamos 5 minutos antes de cada exibição, pela programação do canal.</p>
          <div className="fav-show-list">
            {shows.map((s) => {
              const next = nextAiring(s, catalog.live, programmesFor, now);
              return (
                <div key={s.id} className="fav-show">
                  <div className="lb-logo">
                    <Thumb src={next?.item.logo} name={s.channelName} contain />
                  </div>
                  <button className="fs-info" onClick={() => next && openProgram({ item: next.item, prog: next.prog })} disabled={!next}>
                    <strong>{s.title}</strong>
                    <span className="muted">
                      {s.channelName} ·{' '}
                      {next
                        ? next.prog.start <= now
                          ? 'passando agora'
                          : `próxima: ${dayLabel(next.prog.start)} às ${fmtTime(next.prog.start)}`
                        : 'sem exibição na programação das próximas 48 h'}
                    </span>
                  </button>
                  <button className="icon-btn" onClick={() => removeShow(s.id)} title="Desligar o lembrete" aria-label={`Desligar o lembrete de ${s.title}`}>
                    <Icon name="trash" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
