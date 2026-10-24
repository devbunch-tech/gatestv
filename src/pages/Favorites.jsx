import { useStore } from '../store';
import { Card, PageHeader, Row } from '../components/Media';
import Icon from '../components/Icon';

export default function Favorites() {
  const { favorites, catalog } = useStore();
  const items = favorites.map((id) => catalog.byId.get(id)).filter(Boolean);
  const live = items.filter((i) => i.type === 'live');
  const vod = items.filter((i) => i.type !== 'live');

  return (
    <div className="favorites">
      <PageHeader title="Favoritos" count={items.length} />
      {!items.length && (
        <div className="empty">
          <Icon name="heart" size={48} />
          <h3>Nenhum favorito ainda</h3>
          <p>Toque no coração em um canal, filme ou série para guardá-lo aqui.</p>
        </div>
      )}
      {live.length > 0 && (
        <Row title="Canais">
          {live.map((it) => (
            <Card key={it.id} item={it} variant="wide" sub={it.group} />
          ))}
        </Row>
      )}
      {vod.length > 0 && (
        <Row title="Filmes e séries">
          {vod.map((it) => (
            <Card key={it.id} item={it} sub={it.group} />
          ))}
        </Row>
      )}
    </div>
  );
}
