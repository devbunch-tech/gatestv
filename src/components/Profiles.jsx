import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AVATARS, PROFILE_COLORS, newProfile, useStore } from '../store';
import { AGES, ageText } from '../lib/parental';
import { focusEl } from '../lib/keys';
import Icon from './Icon';
import { RatingBadge } from './Media';
import { Modal } from './Overlays';
import { useAuth } from '../auth';
import { EDITION } from '../lib/device';

// Edição admin: sem fotos nem emojis, só as letras do perfil ("ADM" no admin, 2 primeiras letras nos demais).
const initialsOf = (p) => p?.initials || (p?.name || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?';

export function Avatar({ profile, size = 32, className = '' }) {
  if (EDITION === 'admin') {
    const text = initialsOf(profile);
    return (
      <span
        className={`avatar-tile initials ${className}`}
        style={{ '--c': profile?.color || '#555', width: size, height: size, fontSize: size * (text.length > 2 ? 0.34 : 0.42) }}
        aria-hidden="true"
      >
        {text}
      </span>
    );
  }
  if (profile?.photo)
    return (
      <span className={`avatar-tile photo ${className}`} style={{ '--c': profile.color || '#555', width: size, height: size }} aria-hidden="true">
        <img src={profile.photo} alt="" style={{ objectPosition: profile.photoPos || '50% 30%' }} />
      </span>
    );
  return (
    <span
      className={`avatar-tile ${className}`}
      style={{ '--c': profile?.color || '#555', width: size, height: size, fontSize: size * 0.52 }}
      aria-hidden="true"
    >
      {profile?.emoji || profile?.name?.[0]?.toUpperCase() || '?'}
    </span>
  );
}

// ---------- "Quem está assistindo?" ----------
export function ProfileGate({ initialManage = false, onDone }) {
  const { profiles, selectProfile, canManageProfiles, account } = useStore();
  const { logout } = useAuth();
  const [manage, setManage] = useState(initialManage);
  const [editing, setEditing] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!editing) focusEl(ref.current?.querySelector('.gate-profile'));
  }, [manage, editing]);

  const pick = async (p) => {
    if (manage) {
      if (await canManageProfiles()) setEditing(p);
    } else if (await selectProfile(p.id)) onDone?.();
  };

  return (
    <div className="gate" ref={ref} data-nav-root>
      <img className="gate-logo" src="./logo.png" alt="GATES! TV" />
      <h1>{manage ? 'Gerenciar perfis' : 'Quem está assistindo?'}</h1>
      <div className="gate-grid">
        {profiles.map((p) => (
          <button key={p.id} className={`gate-profile ${manage ? 'managing' : ''}`} onClick={() => pick(p)}>
            <span className="gate-avatar">
              <Avatar profile={p} size={132} />
              {manage && (
                <span className="gate-edit">
                  <Icon name="settings" size={30} />
                </span>
              )}
              {p.pin && !manage && (
                <span className="gate-lock">
                  <Icon name="lock" size={16} />
                </span>
              )}
            </span>
            <strong>{p.name}</strong>
            {p.kids && <small className="kids-tag">Infantil</small>}
            {p.master && <small className="master-tag">Master</small>}
          </button>
        ))}
        {profiles.length < 8 && (
          <button
            className="gate-profile add"
            onClick={async () => (await canManageProfiles()) && setEditing(newProfile())}
          >
            <span className="gate-avatar">
              <span className="avatar-tile add" style={{ width: 132, height: 132 }}>
                <Icon name="plus" size={52} />
              </span>
            </span>
            <strong>Adicionar perfil</strong>
          </button>
        )}
      </div>
      <button
        className={`btn ${manage ? '' : 'ghost'} gate-manage`}
        onClick={async () => (manage ? setManage(false) : (await canManageProfiles()) && setManage(true))}
      >
        {manage ? 'Concluído' : 'Gerenciar perfis'}
      </button>
      {!account?.noLogin && (
        <button className="link-btn gate-logout" onClick={logout}>
          {account?.email} · Sair da conta
        </button>
      )}
      {editing && <ProfileEditor profile={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// Reduz a foto para 256x256 (recorte central) para caber no armazenamento local.
function resizePhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 256;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const s = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ---------- Criar / editar perfil ----------
export function ProfileEditor({ profile, onClose }) {
  const { profiles, saveProfile, deleteProfile, ensurePin, requestPin, parental } = useStore();
  const isNew = !profiles.some((p) => p.id === profile.id);
  const [d, setD] = useState({ ...newProfile(), ...profile });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [err, setErr] = useState('');
  const set = (patch) => setD((x) => ({ ...x, ...patch }));

  const setKids = (kids) =>
    set(kids ? { kids, maxAge: d.maxAge ?? 10, hideRestricted: true } : { kids, maxAge: null, hideRestricted: false, blockUnrated: false });

  const save = async () => {
    const name = d.name.trim();
    if (!name) return setErr('Dê um nome ao perfil.');
    if (profiles.some((p) => p.id !== d.id && p.name.toLowerCase() === name.toLowerCase())) return setErr('Já existe um perfil com esse nome.');
    // Perfis com restrição precisam do PIN de controle parental para não serem burlados.
    if ((d.kids || d.maxAge != null) && !parental.pin && !(await ensurePin('Crie o PIN de controle parental para proteger este perfil'))) return;
    saveProfile({ ...d, name });
    onClose();
  };

  return (
    <Modal onClose={onClose} title={isNew ? 'Novo perfil' : `Editar perfil`} className="profile-editor">
      <div className="pe-top">
        <Avatar profile={d} size={96} />
        <label className="field">
          <span>Nome</span>
          <input data-autofocus value={d.name} maxLength={20} onChange={(e) => set({ name: e.target.value })} placeholder="Ex.: Ana, Kids, Sala" />
        </label>
      </div>
      {err && <p className="msg err">{err}</p>}

      <div className="field">
        <span>Avatar</span>
        <div className="field-row pe-photo">
          <label className="btn ghost">
            <Icon name="upload" size={18} /> Enviar foto
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) set({ photo: await resizePhoto(f), photoPos: '50% 50%' });
              }}
            />
          </label>
          {d.photo && (
            <button className="btn ghost" onClick={() => set({ photo: '' })}>
              Usar emoji
            </button>
          )}
        </div>
        <div className="pe-emojis">
          {AVATARS.map((e) => (
            <button key={e} className={`pe-emoji ${!d.photo && d.emoji === e ? 'active' : ''}`} onClick={() => set({ emoji: e, photo: '' })} aria-label={`Avatar ${e}`}>
              {e}
            </button>
          ))}
        </div>
        <div className="pe-colors">
          {PROFILE_COLORS.map((c) => (
            <button key={c} className={`pe-color ${d.color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => set({ color: c })} aria-label={`Cor ${c}`} />
          ))}
        </div>
      </div>

      <label className="toggle">
        <input type="checkbox" checked={d.kids} onChange={(e) => setKids(e.target.checked)} />
        <span className="switch" />
        <div>
          <strong>Perfil infantil</strong>
          <small>Interface simplificada: esconde conteúdo acima da classificação e bloqueia Configurações e opções de adulto.</small>
        </div>
      </label>

      <div className="field">
        <span>Classificação máxima deste perfil</span>
        <div className="chips">
          {!d.kids && (
            <button className={`chip ${d.maxAge == null ? 'active' : ''}`} onClick={() => set({ maxAge: null })}>
              Padrão da conta
            </button>
          )}
          {AGES.map((a) => (
            <button key={a} className={`chip rating-chip ${d.maxAge === a ? 'active' : ''}`} onClick={() => set({ maxAge: a })} title={ageText(a)}>
              <RatingBadge age={a} /> {a === 18 ? 'Tudo' : `até ${ageText(a)}`}
            </button>
          ))}
        </div>
      </div>

      {(d.maxAge != null || d.kids) && (
        <>
          {!d.kids && (
            <label className="toggle">
              <input type="checkbox" checked={d.hideRestricted} onChange={(e) => set({ hideRestricted: e.target.checked })} />
              <span className="switch" />
              <div>
                <strong>Ocultar o que estiver acima da classificação</strong>
                <small>Em vez de pedir o PIN.</small>
              </div>
            </label>
          )}
          <label className="toggle">
            <input type="checkbox" checked={d.blockUnrated} onChange={(e) => set({ blockUnrated: e.target.checked })} />
            <span className="switch" />
            <div>
              <strong>Bloquear conteúdo sem classificação</strong>
              <small>Mais seguro, mas em listas IPTV muitos itens não têm classificação (use o TMDB, o EPG ou defina manualmente).</small>
            </div>
          </label>
        </>
      )}

      <div className="field">
        <span>PIN do perfil</span>
        <div className="field-row">
          <button
            className="btn ghost"
            onClick={() =>
              requestPin('', { create: true, onPin: (pin) => set({ pin }) })
            }
          >
            <Icon name="lock" size={18} /> {d.pin ? 'Alterar PIN do perfil' : 'Exigir PIN para entrar'}
          </button>
          {d.pin && (
            <button className="btn ghost" onClick={() => set({ pin: '' })}>
              <Icon name="unlock" size={18} /> Remover PIN
            </button>
          )}
        </div>
      </div>

      <div className="pe-actions">
        <button className="btn" onClick={save}>
          Salvar
        </button>
        <button className="btn ghost" onClick={onClose}>
          Cancelar
        </button>
        {!isNew && !d.master && profiles.length > 1 && (
          <button className={`btn ghost danger-btn ${confirmDelete ? 'confirm' : ''}`} onClick={() => (confirmDelete ? (deleteProfile(d.id), onClose()) : setConfirmDelete(true))}>
            <Icon name="trash" size={18} /> {confirmDelete ? 'Confirmar exclusão' : 'Excluir perfil'}
          </button>
        )}
      </div>
      {confirmDelete && <p className="muted small">Favoritos, histórico e itens ocultos deste perfil serão apagados.</p>}
    </Modal>
  );
}

// ---------- Menu do avatar (topo) ----------
export function ProfileMenu({ onClose }) {
  const { profiles, profile, selectProfile, switchProfile, canManageProfiles, account } = useStore();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(null);
  if (editing) return <ProfileEditor profile={editing} onClose={onClose} />;
  const others = profiles.filter((p) => p.id !== profile?.id);

  return (
    <Modal onClose={onClose} title={null} className="profile-menu">
      <div className="pm-current">
        <Avatar profile={profile} size={56} />
        <div>
          <strong>{profile?.name}</strong>
          <small className="muted">{profile?.master ? 'Perfil master' : profile?.kids ? 'Perfil infantil' : 'Perfil ativo'}
            {account?.email && ` · ${account.email}`}
          </small>
        </div>
      </div>
      <div className="menu-list">
        {others.map((p) => (
          <button
            key={p.id}
            onClick={async () => {
              if (await selectProfile(p.id)) {
                onClose();
                navigate('/');
              }
            }}
          >
            <Avatar profile={p} size={24} /> Trocar para {p.name}
            {(p.pin || p.kids) && <small>{[p.kids && 'Infantil', p.pin && 'Com PIN'].filter(Boolean).join(' · ')}</small>}
          </button>
        ))}
        <button onClick={async () => (await canManageProfiles()) && setEditing(profile)}>
          <Icon name="settings" /> Editar este perfil
        </button>
        <button
          onClick={() => {
            onClose();
            switchProfile();
          }}
        >
          <Icon name="user" /> Trocar ou gerenciar perfis
        </button>
        {!account?.noLogin && (
          <button className="danger" onClick={logout}>
            <Icon name="back" /> Sair da conta
          </button>
        )}
      </div>
    </Modal>
  );
}
