import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import Icon from './Icon';
import { useStore } from '../store';
import { Avatar, ProfileMenu } from './Profiles';
import { isPhone, isTouch } from '../lib/device';
import { IS_TEST } from '../config/license';
import { isDemo } from '../lib/device';

const NAV = [
  { to: '/', label: 'Início', icon: 'home', end: true },
  { to: '/live', label: 'TV ao Vivo', icon: 'tv' },
  { to: '/movies', label: 'Filmes', icon: 'film' },
  { to: '/series', label: 'Séries', icon: 'series' },
  { to: '/favorites', label: 'Favoritos', icon: 'heart' },
];

export function TopBar({ onMenu }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [profileMenu, setProfileMenu] = useState(false);
  const { profile } = useStore();
  // Celular: a busca fica recolhida num ícone e abre ocupando a barra.
  const [searchOpen, setSearchOpen] = useState(false);
  const compact = isPhone && !searchOpen && location.pathname !== '/search';

  useEffect(() => {
    if (location.pathname !== '/search') setQ('');
    if (location.pathname !== '/search') setSearchOpen(false);
  }, [location.pathname]);

  const onChange = (e) => {
    const value = e.target.value;
    setQ(value);
    // No celular, apagar o texto mantém a busca aberta (fecha pela seta).
    const to = value ? `/search?q=${encodeURIComponent(value)}` : isPhone ? '/search' : '/';
    navigate(to, { replace: location.pathname === '/search' });
  };

  if (isPhone && !compact)
    return (
      <header className="topbar search-mode">
        <button
          className="icon-btn"
          onClick={() => {
            setSearchOpen(false);
            if (location.pathname === '/search') navigate(-1);
          }}
          aria-label="Fechar busca"
        >
          <Icon name="back" />
        </button>
        <label className="search">
          <Icon name="search" size={18} />
          <input value={q} onChange={onChange} placeholder="Buscar canais, filmes e séries" autoFocus enterKeyHint="search" />
          {q && (
            <button className="icon-btn" onClick={() => onChange({ target: { value: '' } })} aria-label="Limpar">
              <Icon name="close" size={16} />
            </button>
          )}
        </label>
      </header>
    );

  return (
    <header className="topbar">
      {!isTouch && (
        <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Menu">
          <Icon name="menu" />
        </button>
      )}
      <Link to="/" className="brand" aria-label="GATES! TV — início">
        <img src="./logo.png" alt="GATES! TV" />
      </Link>
      {compact ? (
        <div className="topbar-spacer" />
      ) : (
      <label className="search">
        <Icon name="search" size={18} />
        <input value={q} onChange={onChange} placeholder="Buscar canais, filmes e séries" enterKeyHint="search" />
        {q && (
          <button className="icon-btn" onClick={() => onChange({ target: { value: '' } })} aria-label="Limpar">
            <Icon name="close" size={16} />
          </button>
        )}
      </label>
      )}
      <div className="topbar-right">
        {IS_TEST && <span className="test-tag">TESTE</span>}
        {compact && (
          <button className="icon-btn" onClick={() => setSearchOpen(true)} aria-label="Buscar">
            <Icon name="search" />
          </button>
        )}
        {profile?.kids && <span className="kids-tag">Infantil</span>}
        {!profile?.kids && !isDemo && (
          <NavLink to="/settings" className="icon-btn" aria-label="Configurações">
            <Icon name="settings" />
          </NavLink>
        )}
        <button className="profile-btn" onClick={() => setProfileMenu(true)} title={`Perfil: ${profile?.name}`}>
          <Avatar profile={profile} size={34} />
          <span>{profile?.name}</span>
        </button>
        {profileMenu && <ProfileMenu onClose={() => setProfileMenu(false)} />}
      </div>
    </header>
  );
}

export function Sidebar({ open, onClose }) {
  const { playlists, catalog, profile } = useStore();
  const counts = { '/live': catalog.live.length, '/movies': catalog.movies.length, '/series': catalog.series.length };
  return (
    <>
      <div className={`scrim ${open ? 'show' : ''}`} onClick={onClose} />
      <nav className={`sidebar ${open ? 'open' : ''}`} onClick={onClose}>
        {NAV.filter((n) => !isDemo || n.to === '/live').map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="nav-item">
            <Icon name={n.icon} />
            <span>{n.label}</span>
            {counts[n.to] > 0 && <em>{counts[n.to]}</em>}
          </NavLink>
        ))}
        {!profile?.kids && !isDemo && (
          <>
        <div className="nav-section">Fontes</div>
        {playlists.map((p) => (
          <Link key={p.id} to={`/settings#${p.id}`} className="nav-item small">
            <Icon name="list" size={18} />
            <span>{p.name}</span>
          </Link>
        ))}
        <NavLink to="/settings" className="nav-item small">
          <Icon name="plus" size={18} />
          <span>Adicionar lista</span>
        </NavLink>
          </>
        )}
        <div className="sidebar-foot">GATES! TV</div>
      </nav>
    </>
  );
}
