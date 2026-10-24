import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { rememberFocus, useKeyHandler } from '../lib/keys';
import { AGES, ageLabel, ageText } from '../lib/parental';
import { fmtTime, progressOf } from '../lib/epg';
import { img } from '../lib/meta';
import Icon from './Icon';
import { RatingBadge, Thumb, useOpenItem } from './Media';
import { CastRow, Crew, MetaFacts, MetaHint, TrailerButton, useTmdbFind } from './MetaSections';

export function Modal({ onClose, title, children, className = '' }) {
  const ref = useRef(null);
  useKeyHandler((k) => (k === 'back' ? (onClose(), true) : 'nav'));
  useEffect(() => {
    const restore = rememberFocus();
    const el =
      ref.current?.querySelector('[data-autofocus]') ||
      ref.current?.querySelector('.modal-body button, .modal-body a[href], .modal-body input') ||
      ref.current?.querySelector('button');
    el?.focus({ preventScroll: true });
    return restore;
  }, []);
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div ref={ref} data-nav-root className={`modal ${className}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {title && (
          <div className="modal-head">
            <h2>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Fechar" tabIndex={-1}>
              <Icon name="close" />
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ---------- PIN ----------
export function PinDialog() {
  const { pinReq, resolvePin, parental } = useStore();
  if (!pinReq) return null;
  return <PinPad key={pinReq.create ? 'new' : 'verify'} reason={pinReq.reason} pin={pinReq.create ? '' : pinReq.pin ?? parental.pin} onDone={resolvePin} />;
}

function PinPad({ reason, pin, onDone }) {
  const [step, setStep] = useState(pin ? 'verify' : 'new');
  const [digits, setDigits] = useState('');
  const [first, setFirst] = useState('');
  const [err, setErr] = useState('');
  const ref = useRef(null);
  useAutofocus(ref);

  useEffect(() => {
    if (digits.length < 4) return;
    const t = setTimeout(() => {
      if (step === 'verify') {
        if (digits === pin) onDone(true);
        else {
          setErr('PIN incorreto. Tente novamente.');
          setDigits('');
        }
      } else if (step === 'new') {
        setFirst(digits);
        setDigits('');
        setErr('');
        setStep('confirm');
      } else if (digits === first) onDone(true, digits);
      else {
        setErr('Os PINs não conferem. Comece de novo.');
        setStep('new');
        setDigits('');
      }
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits]);

  const add = (n) => setDigits((d) => (d.length >= 4 ? d : d + n));
  const erase = () => setDigits((d) => d.slice(0, -1));

  useKeyHandler((k) => {
    if (k?.length === 2 && k[0] === 'd') return add(k[1]), true;
    if (k === 'back') {
      if (digits) erase();
      else onDone(false);
      return true;
    }
    return 'nav';
  });

  const heading = { verify: 'Digite o PIN', new: 'Crie um PIN de 4 dígitos', confirm: 'Confirme o novo PIN' }[step];
  return (
    <div className="modal-scrim pin-scrim">
      <div className="modal pin" ref={ref} data-nav-root role="dialog" aria-modal="true">
        <Icon name="shield" size={36} className="pin-icon" />
        <h2>{heading}</h2>
        {reason && step === 'verify' && <p className="muted">{reason}</p>}
        {step !== 'verify' && <p className="muted">O PIN protege conteúdos bloqueados e as configurações do controle parental.</p>}
        <div className="pin-dots">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={i < digits.length ? 'on' : ''} />
          ))}
        </div>
        {err && <p className="msg err">{err}</p>}
        <div className="pin-pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n, i) => (
            <button key={n} onClick={() => add(n)} data-autofocus={i === 4 ? '' : undefined}>
              {n}
            </button>
          ))}
          <button className="muted" onClick={() => onDone(false)}>
            Cancelar
          </button>
          <button onClick={() => add('0')}>0</button>
          <button onClick={erase} aria-label="Apagar">
            ⌫
          </button>
        </div>
      </div>
    </div>
  );
}

// Foca o "5" do teclado numérico ao abrir (centro do D-pad).
function useAutofocus(ref) {
  useEffect(() => {
    const restore = rememberFocus();
    ref.current?.querySelector('[data-autofocus]')?.focus();
    return restore;
  }, [ref]);
}

// ---------- Menu de opções do item ----------
export function ItemMenu() {
  const { menuItem, closeMenu } = useStore();
  if (!menuItem) return null;
  return <ItemMenuBody key={menuItem.id} item={menuItem} onClose={closeMenu} />;
}

function ItemMenuBody({ item, onClose }) {
  const s = useStore();
  const open = useOpenItem();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const o = s.overrides[item.id] || {};
  const locked = !!o.locked;
  const kind = { live: 'canal', movie: 'filme', series: item.episodes ? 'série' : 'episódio' }[item.type];
  const autoRating = o.rating == null ? s.ratingOf(item) : null;
  const hidden = s.hiddenList.includes(item.id);
  // Ocultar/excluir vale para todas as versões do título (dublado, legendado…).
  const ids = item.variants ? item.variants.map((v) => v.id) : [item.id];
  const byMaster = s.isHiddenByMaster(item.id);
  // No perfil infantil, bloquear/classificar/excluir só com o PIN de um adulto.
  const adult = !s.profile?.kids || s.unlocked;

  const run = (fn) => async () => {
    await fn();
  };

  return (
    <Modal onClose={onClose} title={item.name} className="item-menu">
      <div className="menu-list">
        <button
          data-autofocus
          onClick={() => {
            onClose();
            open(item);
          }}
        >
          <Icon name="play" /> {item.type === 'live' ? 'Assistir canal' : 'Abrir'}
        </button>
        <button onClick={() => s.toggleFavorite(item.id)}>
          <Icon name="heart" filled={s.isFavorite(item.id)} /> {s.isFavorite(item.id) ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
        </button>
        <button
          onClick={() => {
            for (const i of ids) if (s.hiddenList.includes(i) === hidden) s.toggleHidden(i);
            onClose();
          }}
          disabled={byMaster}
        >
          <Icon name={hidden ? 'eye' : 'eye-off'} /> {hidden ? `Mostrar ${kind}` : `Ocultar ${kind}`}
          <small>{s.isMaster ? 'Vale para todos os perfis (perfil master)' : `Só no perfil ${s.profile?.name}`}; restaure em Configurações</small>
        </button>
        {!adult && (
          <button onClick={() => s.unlock('Digite o PIN de controle parental para ver mais opções')}>
            <Icon name="shield" /> Mais opções (adulto)
            <small>Bloquear, classificar e excluir exigem o PIN de controle parental</small>
          </button>
        )}
        {adult && (
          <>
        <button
          onClick={run(async () => {
            if (locked ? await s.unlock(`Digite o PIN para desbloquear “${item.name}”`) : await s.ensurePin())
              s.setOverride(item.id, { locked: !locked });
          })}
        >
          <Icon name={locked ? 'unlock' : 'lock'} /> {locked ? `Desbloquear ${kind}` : `Bloquear ${kind} com PIN`}
          <small>{locked ? 'Hoje exige PIN para assistir' : 'Exigirá o PIN para assistir'}</small>
        </button>

        <div className="menu-section">
          <span>Classificação indicativa</span>
          <div className="chips">
            <button
              className={`chip ${o.rating == null ? 'active' : ''}`}
              onClick={run(async () => (await s.unlock()) && s.setOverride(item.id, { rating: null }))}
            >
              Automática{autoRating != null ? ` (${ageLabel(autoRating)})` : ''}
            </button>
            {AGES.map((a) => (
              <button
                key={a}
                className={`chip rating-chip ${o.rating === a ? 'active' : ''}`}
                onClick={run(async () => (await s.ensurePin()) && s.setOverride(item.id, { rating: a }))}
                title={ageText(a)}
              >
                <RatingBadge age={a} />
              </button>
            ))}
          </div>
        </div>

        {confirmDelete ? (
          <button
            className="danger"
            onClick={() => {
              for (const i of ids) s.deleteItem(i);
              onClose();
            }}
          >
            <Icon name="trash" /> Confirmar exclusão de “{item.name}”
            <small>{s.isMaster ? 'Some para todos os perfis' : `Some só do perfil ${s.profile?.name}`} · pode ser restaurado em Configurações</small>
          </button>
        ) : (
          <button className="danger" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" /> Excluir {kind} da lista
            <small>{s.isMaster ? 'Perfil master: remove para todos os perfis' : `Remove só do perfil ${s.profile?.name}`}</small>
          </button>
        )}
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------- Trailer ----------
export function TrailerModal() {
  const { trailer, closeTrailer } = useStore();
  if (!trailer) return null;
  return (
    <Modal onClose={closeTrailer} title={trailer.title} className="trailer">
      <div className="trailer-frame">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${trailer.key}?autoplay=1&rel=0`}
          title={trailer.title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
      <button className="btn ghost" onClick={closeTrailer}>
        <Icon name="back" size={18} /> Voltar
      </button>
    </Modal>
  );
}

// ---------- Programa do EPG + dados do TMDB/IMDb ----------
export function ProgramModal() {
  const { program, closeProgram } = useStore();
  if (!program) return null;
  return <ProgramBody key={program.item.id + program.prog.start} {...program} onClose={closeProgram} />;
}

function ProgramBody({ item, prog, onClose }) {
  const { play, catalog, playing } = useStore();
  const navigate = useNavigate();
  const type = /filme|movie|cinema/i.test(prog.category) ? 'movie' : /s[ée]rie|series/i.test(prog.category) ? 'tv' : 'multi';
  const meta = useTmdbFind({ title: prog.title, year: prog.year, type });
  const d = meta.data;
  const now = Date.now();
  const live = prog.start <= now && now < prog.stop;

  return (
    <Modal onClose={onClose} title={null} className="program">
      <div className="program-hero" style={d?.backdrop ? { backgroundImage: `url("${img(d.backdrop, 'w1280')}")` } : undefined}>
        <div className="program-hero-inner">
          {d?.poster && <img className="program-poster" src={img(d.poster, 'w342')} alt="" />}
          <div>
            <div className="program-channel">
              <div className="lb-logo">
                <Thumb src={item.logo} name={item.name} contain />
              </div>
              <span>
                {item.num} · {item.name}
              </span>
            </div>
            <h2>{prog.title}</h2>
            {prog.subtitle && <p className="muted">{prog.subtitle}</p>}
            <div className="meta">
              <RatingBadge age={prog.rating ?? d?.cert ?? null} />
              <span>
                {new Date(prog.start).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })} ·{' '}
                {fmtTime(prog.start)} – {fmtTime(prog.stop)}
              </span>
              {prog.category && <span>{prog.category}</span>}
            </div>
            {live && (
              <div className="lb-progress">
                <span style={{ width: `${progressOf(prog, now) * 100}%` }} />
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="program-desc">{prog.desc || d?.overview || 'Sem descrição disponível.'}</p>
      {d && prog.desc && d.overview && d.overview !== prog.desc && (
        <p className="muted program-desc">
          <strong>Sinopse (TMDB):</strong> {d.overview}
        </p>
      )}
      {d && <MetaFacts data={d} age={prog.rating} />}
      <Crew data={d} />

      <div className="details-actions">
        {playing?.item.id !== item.id && (
          <button
            className="btn"
            data-autofocus
            onClick={() => {
              onClose();
              play(item, catalog.live);
            }}
          >
            <Icon name="play" size={18} /> Assistir canal
          </button>
        )}
        <TrailerButton data={d} />
        {d && (
          <button
            className="btn ghost"
            onClick={() => {
              onClose();
              navigate(`/title/${d.type}/${d.id}`);
            }}
          >
            <Icon name="info" size={18} /> Página do título
          </button>
        )}
      </div>
      <MetaHint meta={meta} />
      <CastRow data={d} />
    </Modal>
  );
}
