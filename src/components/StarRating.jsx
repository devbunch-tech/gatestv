// Avaliação do perfil (1 a 5 estrelas) para filmes e séries. Tocar na mesma estrela tira a nota.
import { useState } from 'react';
import { useStore } from '../store';
import Icon from './Icon';

const LABEL = ['', 'Não gostei', 'Mais ou menos', 'Bom', 'Muito bom', 'Amei'];

export function Stars({ value, size = 14 }) {
  return (
    <span className="stars-view" aria-label={`${value} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon key={n} name="star" size={size} filled={n <= value} className={n <= value ? 'on' : ''} />
      ))}
    </span>
  );
}

export default function StarRating({ id }) {
  const { ratings, rate } = useStore();
  const value = ratings[id]?.stars || 0;
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="star-rating" onMouseLeave={() => setHover(0)}>
      <span className="muted">Sua avaliação:</span>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          className={`star-btn ${n <= shown ? 'on' : ''}`}
          onClick={() => rate(id, n)}
          onMouseEnter={() => setHover(n)}
          onFocus={() => setHover(n)}
          onBlur={() => setHover(0)}
          aria-label={`${n} estrela${n > 1 ? 's' : ''} — ${LABEL[n]}`}
          title={LABEL[n]}
        >
          <Icon name="star" size={22} filled={n <= shown} />
        </button>
      ))}
      <span className="star-label">{shown ? LABEL[shown] : 'sem nota'}</span>
    </div>
  );
}
