import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import Icon from './Icon';
import { useStore } from '../store';
import { isDemo, vibrate } from '../lib/device';

const TABS = [
  { to: '/', label: 'Início', icon: 'home', end: true },
  { to: '/live', label: 'Ao vivo', icon: 'tv' },
  { to: '/movies', label: 'Filmes', icon: 'film' },
  { to: '/series', label: 'Séries', icon: 'series' },
  { to: '/favorites', label: 'Favoritos', icon: 'heart' },
];

// Celular e tablet: navegação principal em abas na parte de baixo (alcance do polegar).
export function BottomTabs() {
  return (
    <nav className="bottom-tabs" aria-label="Navegação principal">
      {TABS.filter((t) => !isDemo || t.to === '/live').map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className="bottom-tab" replace>
          <Icon name={t.icon} size={22} />
          <span>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

// Segurar o dedo num card / canal / episódio abre o menu de opções (ocultar, bloquear, favoritar…).
export function useLongPressMenu() {
  const { catalog, openMenu } = useStore();
  const ref = useRef();
  ref.current = { catalog, openMenu };
  useEffect(() => {
    let timer = 0;
    let start = null;
    let fired = false;
    const cancel = () => {
      clearTimeout(timer);
      start = null;
    };
    const onStart = (e) => {
      const el = e.target.closest?.('[data-longpress]');
      fired = false;
      if (!el || e.touches.length > 1) return cancel();
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      clearTimeout(timer);
      timer = setTimeout(() => {
        const { catalog: c, openMenu: open } = ref.current;
        const item = c.byId.get(el.dataset.longpress);
        if (!item) return;
        fired = true;
        vibrate(20);
        open(item);
      }, 520);
    };
    const onMove = (e) => {
      if (!start) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - start.x) > 10 || Math.abs(t.clientY - start.y) > 10) cancel();
    };
    // Depois de abrir o menu, o "toque" que termina o gesto não pode abrir o item.
    const onClick = (e) => {
      if (!fired) return;
      fired = false;
      e.preventDefault();
      e.stopPropagation();
    };
    const onContext = (e) => {
      // O WebView também dispara "contextmenu" ao segurar; o menu já foi aberto acima.
      if (fired || start) e.preventDefault();
      if (fired) e.stopPropagation();
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', cancel, { passive: true });
    document.addEventListener('touchcancel', cancel, { passive: true });
    document.addEventListener('click', onClick, true);
    document.addEventListener('contextmenu', onContext, true);
    return () => {
      cancel();
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', cancel);
      document.removeEventListener('touchcancel', cancel);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('contextmenu', onContext, true);
    };
  }, []);
}

// Deslizar horizontalmente sobre um elemento (destaques): chama onSwipe(-1 | 1).
export function useSwipe(onSwipe) {
  const s = useRef(null);
  const cb = useRef(onSwipe);
  cb.current = onSwipe;
  return {
    onTouchStart: (e) => {
      const t = e.touches[0];
      s.current = { x: t.clientX, y: t.clientY, at: Date.now() };
    },
    onTouchEnd: (e) => {
      const st = s.current;
      s.current = null;
      if (!st) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - st.x;
      const dy = t.clientY - st.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - st.at < 800) cb.current(dx < 0 ? 1 : -1);
    },
  };
}
