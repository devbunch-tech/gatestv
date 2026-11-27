// Controle da narração no GATES Narração: o player do YouTube (IFrame API via postMessage, como em
// components/Narration.jsx), atrasar/adiantar, atraso guardado por narrador, "Sincronizar pelo lance",
// volume da narração e pausa. Aqui não há vídeo do jogo (ele toca em outro app): adiantar só avança a
// live até o ao vivo do YouTube, e a sincronia automática mantém a mesma distância do ao vivo.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { aiSupported, aiSync } from '../lib/clocksync';
import { edgeClock, loadAuto, loadOffset, median, offsetText, saveAuto, saveOffset } from '../lib/narration';
import { isDesktopNarr, loadPref, savePref } from './platform';

const LANCE_WAIT = 60e3; // "Sincronizar pelo lance": desiste se o segundo toque não vier em 1 min

export function useNarrPlayer(notify) {
  const [narr, setNarr] = useState(null); // { key, title, channel, channelId }
  const [offset, setOffset] = useState(0);
  const [paused, setPaused] = useState(false);
  const [volume, setVolumeState] = useState(() => Math.max(0, Math.min(100, Number(loadPref('vol', 100)) || 0)));
  const [auto, setAuto] = useState(loadAuto);
  const [lance, setLance] = useState(null); // primeiro toque do lance: { kind: 'saw' | 'heard', at }
  const frame = useRef(null);
  const info = useRef({ t: 0, d: 0, at: 0, s: -1 });
  const timers = useRef([]);
  const pending = useRef(0); // atraso guardado a aplicar quando a live começar a tocar
  const holdUntil = useRef(0); // narração segurada (pausa de atraso), não é pausa da pessoa
  const ready = useRef(false); // o player já respondeu (aplica o volume)
  const lanceTimer = useRef(0);
  const moveRef = useRef(null);
  const volRef = useRef(volume);
  volRef.current = volume;
  const narrEdge = useRef(edgeClock());
  // Sincronia automática: 'ref' é a distância do ao vivo (ponta - posição) logo depois de começar ou de um ajuste.
  const sync = useRef({ ref: null, samples: [], waitUntil: 0, lastFix: 0, lastCheck: 0 });
  const resync = (ms) => {
    sync.current = { ...sync.current, ref: null, samples: [], waitUntil: Date.now() + ms };
  };

  const cmd = useCallback((func, args = []) => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*'), []);
  const listen = useCallback(() => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'), []);
  const applyVolume = useCallback(
    (v) => {
      cmd('setVolume', [v]);
      cmd(v > 0 ? 'unMute' : 'mute');
    },
    [cmd]
  );

  const stop = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    clearTimeout(lanceTimer.current);
    setLance(null);
    setNarr(null);
    setPaused(false);
  }, []);
  const start = useCallback((n) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    info.current = { t: 0, d: 0, at: 0, s: -1 };
    ready.current = false;
    holdUntil.current = 0;
    narrEdge.current.reset();
    sync.current = { ref: null, samples: [], waitUntil: Date.now() + 8000, lastFix: 0, lastCheck: 0 };
    const saved = loadOffset(n.channelId);
    pending.current = saved;
    setOffset(saved);
    setPaused(false);
    setNarr(n);
  }, []);

  // O iframe carregou: pede as mensagens do player (repete até ele responder).
  const onFrameLoad = useCallback(() => {
    listen();
    let n = 0;
    const id = setInterval(() => {
      if (ready.current || ++n > 10) return clearInterval(id);
      listen();
    }, 1000);
    timers.current.push(id);
  }, [listen]);

  // Mensagens do player do YouTube: posição da live, estado e erros.
  useEffect(() => {
    if (!narr) return undefined;
    const onMsg = (e) => {
      if (e.source !== frame.current?.contentWindow) return;
      let m;
      try {
        m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (!m || typeof m !== 'object') return;
      if (!ready.current) {
        ready.current = true;
        applyVolume(volRef.current);
      }
      if (m.info?.currentTime != null) info.current = { ...info.current, t: m.info.currentTime, at: Date.now() };
      if (m.info?.duration != null) {
        info.current.d = m.info.duration;
        // Na live, a duração é a ponta do ao vivo do YouTube (vai crescendo).
        narrEdge.current.feed(m.info.duration);
      }
      if (m.info?.playerState != null) {
        info.current.s = m.info.playerState;
        // Pausa/play pelos controles do próprio player (fora da pausa usada para atrasar).
        if (Date.now() > holdUntil.current) {
          if (m.info.playerState === 2) setPaused(true);
          else if (m.info.playerState === 1) setPaused(false);
        }
      }
      // Live tocando: aplica o atraso guardado para este narrador.
      if (pending.current && info.current.s === 1 && info.current.t > 0) {
        const p = pending.current;
        pending.current = 0;
        resync(8000);
        timers.current.push(
          setTimeout(() => {
            moveRef.current?.(p);
            resync(6000);
          }, 1500)
        );
      }
      if (m.event === 'onError') {
        notify(`A live de “${narr.channel}” não pode tocar fora do YouTube. Escolha outra narração.`, 'err');
        stop();
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [narr, notify, stop, applyVolume]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      clearTimeout(lanceTimer.current);
    },
    []
  );

  // Posição estimada agora (entre uma mensagem e outra, anda pelo relógio se estiver tocando).
  const nowPos = () => {
    const y = info.current;
    return y.s === 1 && y.at ? y.t + (Date.now() - y.at) / 1000 : y.t;
  };

  // Segura a narração d segundos (pausa e retoma do mesmo ponto): atrasa mesmo sem a posição da live.
  const hold = (d) => {
    holdUntil.current = Date.now() + d * 1000 + 3000;
    cmd('pauseVideo');
    timers.current.push(setTimeout(() => cmd('playVideo'), d * 1000));
  };

  // d > 0: atrasa d segundos (volta a live; sem DVR, segura a narração). d < 0: adianta, sem passar
  // do ao vivo do YouTube. Devolve quanto foi ajustado de fato (0 = não deu para adiantar).
  const move = (d) => {
    const t = nowPos();
    if (d > 0) {
      if (t > d + 1) {
        const target = t - d;
        cmd('seekTo', [target, true]);
        // Confere depois de 2,5 s: se a posição não voltou, a live não tem DVR — segura a narração.
        timers.current.push(setTimeout(() => info.current.t > target + 7 && hold(d), 2500));
      } else hold(d);
      return d;
    }
    const edge = narrEdge.current.get();
    const fwd = Number.isFinite(edge) ? Math.min(-d, edge - 1.5 - t) : -d;
    if (fwd < 0.5) return 0;
    cmd('seekTo', [t + fwd, true]);
    return -Math.round(fwd);
  };
  moveRef.current = move;

  // 'why': começo do aviso (ex.: o resultado do "Sincronizar pelo lance").
  const shift = (d, why = '') => {
    if (!d || !narr) return;
    pending.current = 0;
    const done = move(d);
    if (!done) {
      notify(`${why}A narração já está no ponto mais recente da live: não dá para adiantar mais. Se ela ainda está atrás do jogo, atrase o jogo no outro app.`);
      return false;
    }
    resync(6000); // o ajuste manual vira a nova referência da sincronia automática
    const n = offset + done;
    setOffset(n);
    saveOffset(narr.channelId, n);
    notify(`${why}Sincronia: ${offsetText(n)}.`);
    return true;
  };
  const shiftRef = useRef(shift);
  shiftRef.current = shift;

  // Sincronizar pela IA (Windows): foto da tela inteira — o jogo é o que está por baixo da nossa janela
  // (pintada de preto) e a narração é o player dentro dela (lib/clocksync.js). Só pelo botão/atalho.
  const aiOk = useMemo(() => isDesktopNarr() && aiSupported(), []);
  const [aiBusy, setAiBusy] = useState(false);
  const aiGen = useRef(0);
  useEffect(() => {
    aiGen.current++;
    setAiBusy(false);
  }, [narr]);
  const aiWait = () => {
    if (info.current.s !== 1) return 'Deixe a narração tocando para a IA ler o relógio.';
    if (pending.current || Date.now() < holdUntil.current) return 'Espere o último ajuste terminar e tente de novo.';
    return '';
  };
  const runAi = async () => {
    if (!aiOk || !narr) return;
    if (aiBusy) return notify('A IA já está lendo o relógio…');
    const why = aiWait();
    if (why) return notify(why);
    const gen = aiGen.current;
    const alive = () => aiGen.current === gen;
    setAiBusy(true);
    notify('Lendo o relógio do placar no jogo e na narração…');
    try {
      const res = await aiSync({
        targets: () => frame.current && { game: 'all', narr: frame.current.getBoundingClientRect() },
        // Os avisos ficam por cima do player na janelinha: somem durante as fotos.
        cover: (on) => document.documentElement.classList.toggle('np-reading', on),
        apply: (d, w) => alive() && shiftRef.current(d, w),
        settle: () => Math.max(0, holdUntil.current - Date.now()),
        ready: aiWait,
        notify,
        alive,
      });
      if (alive() && res.error && res.error !== 'gone') notify(res.message, 'err');
    } finally {
      if (alive()) setAiBusy(false);
    }
  };

  // Sincronizar pelo lance: o tempo entre "Vi o lance" e "Ouvi o narrador" vira o ajuste.
  const markLance = (kind) => {
    if (!narr) return;
    const now = Date.now();
    clearTimeout(lanceTimer.current);
    if (!lance || lance.kind === kind || now - lance.at > LANCE_WAIT) {
      setLance({ kind, at: now });
      lanceTimer.current = setTimeout(() => {
        setLance(null);
        notify('Sincronia pelo lance cancelada: o segundo toque não veio em 1 minuto.');
      }, LANCE_WAIT);
      notify(kind === 'saw' ? 'Agora toque em “Ouvi o narrador” quando ele reagir ao lance.' : 'Agora toque em “Vi o lance” quando o lance aparecer na tela.');
      return;
    }
    setLance(null);
    const saw = kind === 'saw' ? now : lance.at;
    const heard = kind === 'heard' ? now : lance.at;
    const d = Math.round((saw - heard) / 1000);
    if (!d) return notify('Pelo lance, a narração já está em sincronia com o jogo.');
    shift(d, `Pelo lance, a narração estava ${Math.abs(d)} s ${d < 0 ? 'atrás' : 'na frente'} do jogo. `);
  };

  // Sincronia automática (anti-deriva): guarda a distância do ao vivo logo depois de um ajuste; se a
  // narração travar (ou o YouTube correr para a ponta) e ela mudar mais de 1,5 s, corrige a posição.
  useEffect(() => {
    if (!narr || !auto) return undefined;
    const id = setInterval(() => {
      const s = sync.current;
      const now = Date.now();
      const y = info.current;
      if (y.s !== 1 || now - y.at > 3000 || pending.current || now < s.waitUntil) {
        s.samples = [];
        return;
      }
      const yt = y.t + (now - y.at) / 1000;
      const nd = narrEdge.current.get(now) - yt;
      if (!(nd > -3 && nd < 900)) {
        s.samples = [];
        return;
      }
      s.samples = [...s.samples.slice(-4), nd];
      if (s.samples.length < 3) return;
      const m = median(s.samples);
      if (s.ref == null) {
        s.ref = m;
        s.lastCheck = now;
        return;
      }
      if (s.samples.length < 5 || now - s.lastCheck < 5000) return;
      s.lastCheck = now;
      const err = m - s.ref; // > 0: ficou mais longe do ao vivo (atrás do jogo)
      // Diferença enorme: a live recomeçou ou ficou muito tempo pausada; mede de novo.
      if (Math.abs(err) > 90) {
        s.ref = null;
        s.samples = [];
        return;
      }
      if (Math.abs(err) < 1.5 || now - s.lastFix < 10000) return;
      if (err > 0) {
        const target = Math.min(yt + err, narrEdge.current.get(now) - 1);
        if (target - yt < 1) return;
        cmd('seekTo', [target, true]);
      } else moveRef.current?.(-err);
      s.lastFix = now;
      s.samples = [];
      s.waitUntil = now + 4000;
    }, 1000);
    return () => clearInterval(id);
  }, [narr, auto, cmd]);

  const toggleAuto = () => {
    const on = !auto;
    setAuto(on);
    saveAuto(on);
    if (on) resync(2000);
    notify(on ? 'Sincronia automática ligada: se a narração travar, o atraso é corrigido sozinho.' : 'Sincronia automática desligada.');
  };

  const setVolume = useCallback(
    (v) => {
      const n = Math.max(0, Math.min(100, Math.round(v)));
      setVolumeState(n);
      savePref('vol', n);
      applyVolume(n);
    },
    [applyVolume]
  );

  const play = () => {
    holdUntil.current = 0;
    cmd('playVideo');
    setPaused(false);
  };
  const pause = () => {
    holdUntil.current = 0;
    cmd('pauseVideo');
    setPaused(true);
  };
  const togglePause = () => (paused ? play() : pause());

  return { narr, start, stop, frame, onFrameLoad, offset, shift, lance, markLance, auto, toggleAuto, volume, setVolume, paused, play, pause, togglePause, aiOk, aiBusy, aiSync: runAi };
}
