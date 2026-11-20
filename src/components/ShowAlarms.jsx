// Avisos dos programas de TV favoritos do perfil:
//  - com o app aberto (qualquer aparelho): cartão na tela 5 min antes, com "Assistir";
//  - Windows: também a notificação do sistema, se a janela estiver minimizada;
//  - Android (APKs novos): alarmes do sistema agendados para as próximas 48 h, que avisam mesmo
//    com o app fechado; tocar no aviso abre o app já no canal.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { SHOW_LATE, upcomingShows } from '../lib/shows';
import { fmtTime, useNow } from '../lib/epg';
import { baseName } from '../lib/zapping';
import { hasNative, native } from '../lib/device';
import { useKeyHandler } from '../lib/keys';
import Icon from './Icon';

const ALERTED = 'gates:shows:alerted'; // { chave: horário do aviso }
const SCHEDULED = 'gates:shows:scheduled'; // alarmes do Android já agendados { chave: horário }
const load = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k) || '{}');
  } catch {
    return {};
  }
};
const save = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};

export default function ShowAlarms() {
  const { shows, catalog, programmesFor, play, playing, loading } = useStore();
  const now = useNow(20000);
  const minute = Math.floor(now / 60000);
  const upcoming = useMemo(
    () => (loading ? [] : upcomingShows(shows, catalog.live, programmesFor, now)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shows, catalog.live, programmesFor, minute, loading]
  );
  const [alert, setAlert] = useState(null);

  // Aviso na tela (e notificação do Windows com a janela minimizada).
  useEffect(() => {
    if (alert) return;
    const sent = load(ALERTED);
    const due = upcoming.find((u) => u.alarmAt <= now && u.prog.start > now - SHOW_LATE && !sent[u.key]);
    if (!due) return;
    sent[due.key] = now;
    for (const k of Object.keys(sent)) if (now - sent[k] > 3 * 864e5) delete sent[k];
    save(ALERTED, sent);
    if (playing?.item.id === due.item.id) return; // já está no canal
    setAlert(due);
    if (!hasNative('device') && document.hidden && typeof Notification !== 'undefined') {
      const show = () => {
        const n = new Notification(`${due.prog.title} ${due.prog.start > now ? 'começa às ' + fmtTime(due.prog.start) : 'começou'}`, { body: `No ${due.item.name}. Toque para assistir.` });
        n.onclick = () => {
          window.focus();
          play(due.item, catalog.live);
          setAlert(null);
        };
      };
      if (Notification.permission === 'granted') show();
      else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => p === 'granted' && show());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcoming, now, alert]);

  // Fecha sozinho depois que o programa começa há mais de 10 min.
  useEffect(() => {
    if (alert && now > alert.prog.start + SHOW_LATE) setAlert(null);
  }, [alert, now]);

  // Android: agenda os alarmes do sistema (troca só o que mudou).
  useEffect(() => {
    if (loading || !hasNative('scheduleReminder')) return;
    const want = new Map(upcoming.filter((u) => u.alarmAt > Date.now()).slice(0, 40).map((u) => [u.key, u]));
    const have = load(SCHEDULED);
    for (const key of Object.keys(have)) if (!want.has(key)) native('cancelReminder', key);
    const next = {};
    for (const [key, u] of want) {
      if (!have[key]) native('scheduleReminder', key, u.alarmAt, `${u.prog.title} começa às ${fmtTime(u.prog.start)}`, `No ${u.item.name}. Toque para assistir.`, u.item.name);
      next[key] = u.alarmAt;
    }
    save(SCHEDULED, next);
  }, [upcoming, loading]);

  // Android: o app foi aberto pelo aviso — vai direto para o canal.
  useEffect(() => {
    if (loading || !hasNative('takeReminder')) return undefined;
    const check = () => {
      const name = native('takeReminder');
      if (!name) return;
      const b = baseName(name);
      const ch = catalog.live.find((c) => c.name === name) || catalog.live.find((c) => baseName(c.name) === b);
      if (ch) play(ch, catalog.live);
    };
    check();
    const onVis = () => !document.hidden && check();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const watch = () => {
    play(alert.item, catalog.live);
    setAlert(null);
  };
  // Controle remoto: OK assiste, Voltar fecha o aviso.
  useKeyHandler((k) => {
    if (k === 'ok') return watch(), true;
    if (k === 'back') return setAlert(null), true;
    return false;
  }, !!alert);

  if (!alert) return null;
  const started = alert.prog.start <= Date.now();
  return (
    <div className="show-alert" role="alert">
      <Icon name="guide" size={26} />
      <div className="sa-text">
        <small>{started ? 'COMEÇOU AGORA' : `COMEÇA ÀS ${fmtTime(alert.prog.start)}`}</small>
        <strong>{alert.prog.title}</strong>
        <span className="muted">{alert.item.name}</span>
      </div>
      <button className="btn" tabIndex={-1} onClick={watch}>
        <Icon name="play" size={16} /> Assistir
      </button>
      <button className="icon-btn" tabIndex={-1} onClick={() => setAlert(null)} aria-label="Fechar aviso">
        <Icon name="close" />
      </button>
    </div>
  );
}
