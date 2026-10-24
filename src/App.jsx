import { SMART_TV } from './lib/device';
import { exitApp } from './lib/smarttv';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { Sidebar, TopBar } from './components/Layout';
import Player from './components/Player';
import { ItemMenu, PinDialog, ProgramModal, TrailerModal } from './components/Overlays';
import Home from './pages/Home';
import LiveTV from './pages/LiveTV';
import Library from './pages/Library';
import Details from './pages/Details';
import Search from './pages/Search';
import Favorites from './pages/Favorites';
import Settings from './pages/Settings';
import Person from './pages/Person';
import Title from './pages/Title';
import { useStore } from './store';
import { ProfileGate } from './components/Profiles';
import { detectTv, focusEl, handleOkPress, moveFocus, setFallback, setTvMode } from './lib/keys';
import { isDemo, isTouch } from './lib/device';
import { BottomTabs, useLongPressMenu } from './components/TouchUI';
import { hasMemory, pageMem, restore, snapshot } from './lib/scrollMemory';

function Toasts() {
  const { toasts, dismissToast, syncing } = useStore();
  return (
    <div className="toasts" aria-live="polite">
      {syncing && <div className="toast muted-toast"><span className="spinner sm" /> Verificando novidades nas suas fontes…</div>}
      {toasts.map((t) => (
        <button key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)} tabIndex={-1}>
          {t.text}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [menu, setMenu] = useState(false);
  const main = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const store = useStore();
  const tv = !isTouch && (store.settings.tvMode === 'on' || (store.settings.tvMode === 'auto' && detectTv()));
  useLongPressMenu();
  setTvMode(tv);

  // Ao voltar (Voltar do navegador, do celular ou do controle) a tela reabre na mesma posição;
  // ao abrir uma tela nova, começa do topo.
  const navType = useNavigationType();
  const keyRef = useRef(location.key);
  useLayoutEffect(() => {
    keyRef.current = location.key;
  }, [location.key]);
  const hasMain = !!store.profile;
  useEffect(() => {
    const m = main.current;
    if (!m) return;
    const onClick = () => snapshot(keyRef.current, m);
    const onScroll = () => (pageMem(keyRef.current).y = m.scrollTop);
    m.addEventListener('click', onClick, true);
    m.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      m.removeEventListener('click', onClick, true);
      m.removeEventListener('scroll', onScroll);
    };
  }, [hasMain]);

  useEffect(() => {
    const restored = navType === 'POP' && hasMemory(location.key) && restore(location.key, main.current, { focus: tv });
    if (!restored) main.current?.scrollTo({ top: 0, behavior: 'instant' });
    if (!tv || restored) return;
    // No modo TV, coloca o foco no primeiro elemento útil da nova tela.
    const t = setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body && document.body.contains(document.activeElement)) {
        if (!document.querySelector('.sidebar')?.contains(document.activeElement)) return;
      }
      // Prioridade: botão principal da tela (ex.: Assistir) > primeiro card/canal > qualquer botão.
      const m = main.current;
      focusEl(m?.querySelector('[data-autofocus]') || m?.querySelector('.lib-hero .btn, .card, .group-tile, .guide-row, .episode') || m?.querySelector('button, a[href]'));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key, tv]);

  // Na TV, o menu lateral fica escondido em Filmes, Séries e detalhes; ◀ na borda esquerda abre.
  const [navOpen, setNavOpen] = useState(false);
  const navCollapsed = tv && /^\/(movies|series|item|title|person)/.test(location.pathname);
  useEffect(() => setNavOpen(false), [location.pathname]);
  useEffect(() => {
    if (!navOpen) return;
    const onFocus = (e) => !e.target.closest?.('.sidebar') && setNavOpen(false);
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, [navOpen]);

  useEffect(() => {
    setTvMode(tv);
    document.body.classList.toggle('tv', tv);
  }, [tv]);

  // Teclas que nenhuma tela tratou: Voltar, Menu e "segurar OK".
  const ref = useRef();
  ref.current = { store, location, navigate, menu, navCollapsed, navOpen };
  useEffect(() => {
    setFallback((k, e) => {
      const { store: s, location: loc, navigate: nav, menu: m, navCollapsed: collapsed, navOpen: open } = ref.current;
      if (k === 'left' && collapsed && !open && !moveFocus('left')) {
        setNavOpen(true);
        setTimeout(() => focusEl(document.querySelector('.sidebar .nav-item.active') || document.querySelector('.sidebar .nav-item')), 30);
        return true;
      }
      const itemFromFocus = () => {
        const el = document.activeElement?.closest?.('[data-longpress]');
        return el && s.catalog.byId.get(el.dataset.longpress);
      };
      if (k === 'back') {
        if (m) return setMenu(false), true;
        if (open) return setNavOpen(false), true;
        if (loc.pathname !== '/') return nav(-1), true;
        // App de Android TV: "Voltar" na tela inicial fecha o app.
        if (window.GatesAndroid) return window.GatesAndroid.exit(), true;
        if (SMART_TV) return exitApp(), true;
        return false;
      }
      if (k === 'menu') {
        const it = itemFromFocus();
        return it ? (s.openMenu(it), true) : false;
      }
      if (k === 'ok') return handleOkPress(e, () => itemFromFocus() && s.openMenu(itemFromFocus()));
      return false;
    });
  }, []);

  // Degustação: tudo acontece no Ao vivo (as outras telas pediriam uma lista própria).
  useEffect(() => {
    if (isDemo && location.pathname !== '/live') navigate('/live', { replace: true });
  }, [location.pathname, navigate]);

  if (!store.profile)
    return (
      <>
        <ProfileGate onDone={() => navigate('/')} />
        <PinDialog />
      </>
    );

  return (
    <div className={`app ${store.profile.kids ? 'kids' : ''} ${store.playing ? 'playing' : ''} ${navCollapsed ? 'nav-collapsed' : ''} ${navOpen ? 'nav-open' : ''} ${isTouch ? 'touch-app' : ''} ${isDemo ? 'demo-app' : ''}`}>
      <TopBar onMenu={() => setMenu((m) => !m)} />
      {isDemo && (
        <div className="demo-bar">
          <span>
            <b>Degustação grátis</b> · canais de sinal aberto (TV Câmara e TV Brasil). Assine para usar o GATES! TV com a sua lista em todas as telas.
          </span>
          <a className="btn" href="../assinar" target="_top">
            Assinar
          </a>
        </div>
      )}
      {!isTouch && <Sidebar open={menu} onClose={() => setMenu(false)} />}
      <main className="main" ref={main}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/live" element={<LiveTV />} />
          <Route path="/movies" element={<Library kind="movie" />} />
          <Route path="/series" element={<Library kind="series" />} />
          <Route path="/item/:id" element={<Details />} />
          <Route path="/person/:id" element={<Person />} />
          <Route path="/title/:type/:id" element={<Title />} />
          <Route path="/search" element={<Search />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
      {isTouch && <BottomTabs />}
      <Player />
      <ProgramModal />
      <ItemMenu />
      <TrailerModal />
      <PinDialog />
      <Toasts />
    </div>
  );
}
