// Peças pequenas das telas do GATES Narração.
import { useState } from 'react';
import Icon from '../components/Icon';
import { offsetText } from '../lib/narration';

export const initials = (name) =>
  String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

export function Crest({ src, name, className = '' }) {
  const [err, setErr] = useState(false);
  return (
    <span className={`crest sg-crest ${className}`}>
      {src && !err ? <img src={src} alt="" loading="lazy" onError={() => setErr(true)} /> : <span>{initials(name)}</span>}
    </span>
  );
}

export const fmtTime = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

// Atraso curto, para o selo da janela flutuante e a barra da janelinha.
export const offsetShort = (o) => (o === 0 ? 'sincronia original' : o > 0 ? `atraso ${o} s` : `adiantada ${-o} s`);

// Uma live de narração: toca ao escolher; a estrela favorita o canal.
export function LiveRow({ l, fav, onPick, onFav, current, autofocus }) {
  return (
    <div className={`narr-row np-row ${current ? 'on' : ''}`}>
      <button className="narr-pick" data-autofocus={autofocus || undefined} onClick={() => onPick(l)}>
        <strong>
          {current && <Icon name="volume" size={14} />} {l.channel}
        </strong>
        <span className="muted">{l.title}</span>
        {(l.viewers || l.live) && <small className="narr-live">● AO VIVO{l.viewers ? ` · ${l.viewers}` : ''}</small>}
      </button>
      <button className={`icon-btn ${fav ? 'on' : ''}`} onClick={() => onFav({ id: l.channelId, name: l.channel }, l)} aria-label={fav ? `Tirar ${l.channel} dos favoritos` : `Favoritar ${l.channel}`} title={fav ? 'Tirar dos meus narradores' : 'Guardar em “Meus narradores”'}>
        <Icon name="star" filled={fav} />
      </button>
    </div>
  );
}

// Resultado de uma busca de lives: { loading } | { list } | { error }.
export function LiveList({ res, favIds, current, onPick, onFav, empty, autofocus }) {
  if (!res) return null;
  if (res.loading)
    return (
      <p className="muted np-wait">
        <span className="spinner sm" /> Procurando narrações ao vivo no YouTube…
      </p>
    );
  if (res.error) return <p className="muted">{res.error}</p>;
  if (!res.list?.length) return <p className="muted">{empty || 'Nenhuma live encontrada. Tente o nome do canal do narrador.'}</p>;
  return (
    <div className="np-list">
      {res.list.map((l, i) => (
        <LiveRow key={l.key} l={l} fav={favIds.has(l.channelId)} current={current === l.key} onPick={onPick} onFav={onFav} autofocus={autofocus && i === 0} />
      ))}
    </div>
  );
}

// Interruptor (mesmo visual das Configurações do app principal).
export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="toggle np-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

// Volume da narração (0–100): botões para o controle remoto e o controle deslizante.
export function VolumeControl({ value, onChange, compact }) {
  const tab = compact ? { tabIndex: -1 } : {};
  return (
    <div className={`np-vol ${compact ? 'compact' : ''}`}>
      <Icon name={value ? 'volume' : 'mute'} size={compact ? 16 : 20} />
      {!compact && (
        <button className="chip" onClick={() => onChange(value - 10)} aria-label="Baixar o volume da narração" title="Baixar o volume da narração">
          −
        </button>
      )}
      <input type="range" min="0" max="100" step="5" value={value} {...tab} onChange={(e) => onChange(Number(e.target.value))} aria-label="Volume da narração" />
      {!compact && (
        <button className="chip" onClick={() => onChange(value + 10)} aria-label="Aumentar o volume da narração" title="Aumentar o volume da narração">
          +
        </button>
      )}
      <span className="np-vol-n">{value}%</span>
    </div>
  );
}

// Botões de sincronia. A narração do YouTube costuma chegar bem antes da TV (20 s a 1 min),
// por isso há passos grandes para atrasar.
const DELAYS = [1, 5, 10, 30];
const ADVANCES = [1, 5, 10];
export function SyncControls({ p, autofocus }) {
  return (
    <>
      <p className="np-offset">
        <Icon name="refresh" size={14} /> {offsetText(p.offset)}
      </p>
      <div className="narr-sync">
        <span className="narr-sync-label">Atrasar (a narração está na frente do jogo)</span>
        {DELAYS.map((s, i) => (
          <button key={s} className="chip" data-autofocus={autofocus && i === 1 ? true : undefined} onClick={() => p.shift(s)} title={`Atrasar a narração ${s} s`}>
            +{s} s
          </button>
        ))}
      </div>
      <div className="narr-sync">
        <span className="narr-sync-label">Adiantar (a narração está atrás do jogo)</span>
        {ADVANCES.map((s) => (
          <button key={s} className="chip" onClick={() => p.shift(-s)} title={`Adiantar a narração ${s} s`}>
            −{s} s
          </button>
        ))}
        {p.offset !== 0 && (
          <button className="chip" onClick={() => p.shift(-p.offset)} title="Voltar à sincronia original (sem atraso)">
            Zerar
          </button>
        )}
      </div>
      {/* Pelo lance: um toque ao ver o lance na tela e outro ao ouvir o narrador, em qualquer ordem. */}
      <div className="narr-sync">
        <span className="narr-sync-label">Sincronizar pelo lance (toque nos dois, em qualquer ordem)</span>
        <button className={`chip ${p.lance?.kind === 'saw' ? 'active' : ''}`} onClick={() => p.markLance('saw')} title="Toque quando vir um lance marcante no jogo (gol, apito)">
          <Icon name="eye" size={12} /> Vi o lance
        </button>
        <button className={`chip ${p.lance?.kind === 'heard' ? 'active' : ''}`} onClick={() => p.markLance('heard')} title="Toque quando ouvir o narrador reagir ao mesmo lance">
          <Icon name="volume" size={12} /> Ouvi o narrador
        </button>
      </div>
      {/* Pela IA (Windows): lê o relógio do placar no jogo (por baixo da janela) e na narração. */}
      {p.aiOk && (
        <div className="narr-sync">
          <span className="narr-sync-label">Pela IA (lê o relógio do placar no jogo e na narração; deixe o jogo visível na tela)</span>
          <button className={`chip ${p.aiBusy ? 'active' : ''}`} onClick={p.aiSync} title="A IA lê o relógio do placar no jogo e na narração e acerta o atraso (Ctrl+Alt+I)">
            <Icon name="clock" size={12} /> {p.aiBusy ? 'Lendo o relógio…' : 'Sincronizar pela IA'}
          </button>
        </div>
      )}
      <div className="narr-sync">
        <button className={`chip ${p.auto ? 'active' : ''}`} onClick={p.toggleAuto} title="Se a narração travar, corrige o atraso sozinho">
          <Icon name="refresh" size={12} /> {p.auto ? 'Sincronia mantida automaticamente (toque para desligar)' : 'Sincronia automática desligada (toque para ligar)'}
        </button>
      </div>
    </>
  );
}
