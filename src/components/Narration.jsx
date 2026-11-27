// Narração do YouTube nos jogos ao vivo (lib/narration.js): escolha da live pelo nome do canal,
// favoritos, player pequeno no canto com o som da narração (o som do jogo fica mudo ou baixo),
// ajuste de sincronia (atrasar/adiantar) e, depois de 3 minutos, o convite para se inscrever no canal.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import QrCode from './QrCode';
import { Modal } from './Overlays';
import { SMART_TV, hasNative, isTouch, native } from '../lib/device';
import { isTvMode } from '../lib/keys';
import { CHECK_EVERY, SYNC_MODES, aiMessage, aiSupported, aiSync, ensureCapture, loadSyncMode, releaseCapture, saveSyncMode, videoBox } from '../lib/clocksync';
import {
  channelLive,
  edgeClock,
  isSubscribed,
  loadFavs,
  loadOffset,
  markSubscribed,
  median,
  narrEmbedUrl,
  offsetText,
  queryFor,
  saveOffset,
  searchLives,
  subscribeUrl,
  toggleFav,
} from '../lib/narration';

const ASK_AFTER = 3 * 60e3; // convite para se inscrever depois de 3 min ouvindo
const ASK_AGAIN = 15 * 60e3; // "Agora não": pergunta de novo depois de 15 min
const openExternal = (url) => !SMART_TV && (hasNative('openUrl') ? native('openUrl', url) : window.open(url, '_blank', 'noopener'));

// Janela menor (picture-in-picture): tamanho, canto da tela e "inverter" (a live do YouTube em tela
// cheia e o jogo na janela menor). A janela nunca some: o YouTube exige o player visível (mín. 200 px).
export const NARR_SIZES = [
  { id: 's', label: 'Pequena' },
  { id: 'm', label: 'Média' },
  { id: 'l', label: 'Grande' },
];
export const NARR_CORNERS = [
  { id: 'br', label: 'Inferior direito', arrow: '↘' },
  { id: 'bl', label: 'Inferior esquerdo', arrow: '↙' },
  { id: 'tl', label: 'Superior esquerdo', arrow: '↖' },
  { id: 'tr', label: 'Superior direito', arrow: '↗' },
];
const VIEW_KEY = 'gates:narr:view';
const loadView = () => {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null') || {};
    return { size: NARR_SIZES.some((s) => s.id === v.size) ? v.size : 's', pos: NARR_CORNERS.some((c) => c.id === v.pos) ? v.pos : 'br', swap: false, hidden: false };
  } catch {
    return { size: 's', pos: 'br', swap: false, hidden: false };
  }
};
// Atraso guardado por narrador e sincronia automática: lib/narration.js (loadOffset, saveOffset, loadAuto).
const LANCE_WAIT = 60e3; // "Sincronizar pelo lance": desiste se o segundo toque não vier em 1 min
let deniedOnce = false; // a pessoa negou a captura da tela: avisa uma vez e não pergunta de novo sozinho
const nextOf = (list, id) => list[(list.findIndex((x) => x.id === id) + 1) % list.length].id;

// Botões de sincronia. A narração do YouTube costuma chegar bem antes da TV (20 s a 1 min),
// por isso há passos grandes para atrasar.
const DELAYS = [1, 5, 10, 30];
const ADVANCES = [1, 5, 10];
function SyncButtons({ shift, offset, compact, autofocus, lance, markLance, ai }) {
  const tab = compact ? { tabIndex: -1 } : {};
  // Sincronizar pela IA (lib/clocksync.js): lê o relógio do placar no jogo e na narração.
  const aiBtn = ai?.ok && (
    <button className={`chip ${ai.busy ? 'active' : ''}`} {...tab} onClick={ai.run} title="A IA lê o relógio do placar no jogo e na narração e acerta o atraso">
      <Icon name="clock" size={12} /> {ai.busy ? 'Lendo o relógio…' : compact ? 'IA' : 'Sincronizar pela IA'}
    </button>
  );
  return (
    <>
      <div className="narr-sync">
        <span className="narr-sync-label">{compact ? 'Atrasar' : 'Atrasar a narração (ela está na frente do jogo)'}</span>
        {DELAYS.map((s, i) => (
          <button key={s} className="chip" {...tab} data-autofocus={autofocus && i === 1 ? true : undefined} onClick={() => shift(s)} title={`Atrasar a narração ${s} s`}>
            {s} s
          </button>
        ))}
      </div>
      <div className="narr-sync">
        <span className="narr-sync-label">{compact ? 'Adiantar' : 'Adiantar a narração (ela está atrás do jogo)'}</span>
        {ADVANCES.map((s) => (
          <button key={s} className="chip" {...tab} onClick={() => shift(-s)} title={`Adiantar a narração ${s} s`}>
            {s} s
          </button>
        ))}
        {offset !== 0 && (
          <button className="chip" {...tab} onClick={() => shift(-offset)} title="Voltar à sincronia original (sem atraso)">
            Zerar
          </button>
        )}
      </div>
      {/* Pelo lance: um toque ao ver o lance na tela e outro ao ouvir o narrador, em qualquer ordem. */}
      <div className="narr-sync">
        <span className="narr-sync-label">{compact ? 'Lance' : 'Sincronizar pelo lance (toque nos dois, em qualquer ordem)'}</span>
        <button className={`chip ${lance?.kind === 'saw' ? 'active' : ''}`} {...tab} onClick={() => markLance('saw')} title="Toque quando vir um lance marcante na tela (gol, apito)">
          <Icon name="eye" size={12} /> Vi o lance
        </button>
        <button className={`chip ${lance?.kind === 'heard' ? 'active' : ''}`} {...tab} onClick={() => markLance('heard')} title="Toque quando ouvir o narrador reagir ao mesmo lance">
          <Icon name="volume" size={12} /> Ouvi o narrador
        </button>
        {compact && aiBtn}
      </div>
      {!compact && aiBtn && (
        <div className="narr-sync">
          <span className="narr-sync-label">Pela IA (lê o relógio do placar no jogo e na narração)</span>
          {aiBtn}
        </div>
      )}
    </>
  );
}

// Estado e controle da narração dentro do player. 'videoRef': o vídeo do jogo (fica mudo/baixo).
export function useNarration(videoRef, notify) {
  const [narr, setNarr] = useState(null); // { key, title, channel, channelId }
  const [offset, setOffset] = useState(loadOffset);
  const [gameVol, setGameVol] = useState(0); // som do jogo: 0 = mudo, 0.2 = baixo
  const [ask, setAsk] = useState(false);
  const [view, setViewState] = useState(loadView);
  const frame = useRef(null);

  // Tamanho e canto ficam guardados no aparelho; o "inverter" vale só para esta narração.
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ size: view.size, pos: view.pos }));
    } catch {
      /* armazenamento cheio */
    }
  }, [view.size, view.pos]);
  const setView = useCallback((patch) => setViewState((v) => ({ ...v, ...patch })), []);
  const cycleSize = useCallback(() => setViewState((v) => ({ ...v, size: nextOf(NARR_SIZES, v.size) })), []);
  const cycleCorner = useCallback(() => setViewState((v) => ({ ...v, pos: nextOf(NARR_CORNERS, v.pos) })), []);
  const toggleSwap = useCallback(() => setViewState((v) => ({ ...v, swap: !v.swap, hidden: false })), []);
  // Esconder: a janela some por completo e a narração continua tocando; "Mostrar" traz de volta.
  const toggleHidden = useCallback(() => setViewState((v) => ({ ...v, hidden: !v.hidden, swap: false })), []);
  const info = useRef({ t: 0, d: 0, at: 0 });
  const timers = useRef([]);
  const pending = useRef(0); // atraso padrão a aplicar quando a live começar a tocar
  const moveRef = useRef(null);
  // Sincronia automática: 'ref' é a diferença de "distância do ao vivo" (narração - jogo) logo depois
  // de começar ou de um ajuste; 'samples', as últimas leituras (1 por segundo).
  // Sincronia: 'ai' (IA pelo relógio; na TV, o padrão), 'auto' (anti-deriva) ou 'manual'. No modo IA a
  // anti-deriva fica desligada, a não ser que a IA não funcione nesta narração (sem autorização, narrador sem relógio).
  const aiOk = useMemo(aiSupported, []);
  const [aiOff, setAiOff] = useState(false); // a nuvem está sem a IA
  const canAi = aiOk && !aiOff;
  const [syncMode, setSyncModeState] = useState(() => loadSyncMode(aiOk, isTvMode()));
  const [aiDown, setAiDown] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [reading, setReading] = useState(false); // tirando as fotos: janelinha visível, controles fora da frente
  const auto = syncMode === 'auto' || (syncMode === 'ai' && (aiDown || !canAi));
  // at: quando rodar a primeira leitura (TV); last: a última; synced: já sincronizou pela IA nesta narração.
  const ai = useRef({ gen: 0, busy: false, at: 0, last: 0, synced: false, armed: false, tries: 0, fails: 0 });
  const quietUntil = useRef(0); // ajuste em andamento (narração ou jogo segurados): não lê o relógio
  const sync = useRef({ ref: null, samples: [], waitUntil: 0, lastFix: 0, lastCheck: 0 });
  const narrEdge = useRef(edgeClock());
  const gameEdge = useRef(edgeClock());
  // Recomeça a referência depois de 'ms' (tempo para o ajuste ou a troca assentar).
  const resync = (ms) => {
    sync.current = { ...sync.current, ref: null, samples: [], waitUntil: Date.now() + ms };
  };
  const [lance, setLance] = useState(null); // primeiro toque do "Sincronizar pelo lance": { kind: 'saw' | 'heard', at }
  const lanceTimer = useRef(0);

  const stop = useCallback(() => {
    setNarr(null);
    setAsk(false);
    setLance(null);
    clearTimeout(lanceTimer.current);
    setViewState((v) => ({ ...v, swap: false, hidden: false }));
    ai.current = { ...ai.current, gen: ai.current.gen + 1, busy: false };
    setAiBusy(false);
    setReading(false);
    releaseCapture();
  }, []);
  const start = useCallback((n) => {
    info.current = { t: 0, d: 0, at: 0 };
    ai.current = { gen: ai.current.gen + 1, busy: false, at: 0, last: 0, synced: false, armed: false, tries: 0, fails: 0 };
    setAiBusy(false);
    setAiDown(false);
    narrEdge.current.reset();
    sync.current = { ref: null, samples: [], waitUntil: Date.now() + 8000, lastFix: 0, lastCheck: 0 };
    setViewState((v) => ({ ...v, swap: false, hidden: false }));
    const saved = loadOffset(n.channelId);
    pending.current = saved;
    setOffset(saved);
    setNarr(n);
  }, []);

  // Som do jogo: mudo (ou baixo) enquanto a narração toca; volta ao normal ao desligar.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !narr) return undefined;
    const prev = { muted: v.muted, volume: v.volume };
    if (gameVol) {
      v.muted = false;
      v.volume = gameVol;
    } else v.muted = true;
    return () => {
      v.muted = prev.muted;
      v.volume = prev.volume;
    };
  }, [narr, gameVol, videoRef]);

  // Mensagens do player do YouTube: posição da live e erros (live que não permite tocar fora do YouTube).
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
      // 'at': quando chegou a posição (entre uma mensagem e outra, a posição é estimada pelo relógio).
      if (m?.info?.currentTime != null) info.current = { ...info.current, t: m.info.currentTime, at: Date.now() };
      if (m?.info?.duration != null) {
        info.current.d = m.info.duration;
        // Na live, a duração é a ponta do ao vivo do YouTube (vai crescendo).
        narrEdge.current.feed(m.info.duration);
      }
      if (m?.info?.playerState != null) info.current.s = m.info.playerState;
      // Na TV (modo IA), a primeira leitura do relógio ~8 s depois de a live tocar com o atraso salvo.
      if (!ai.current.armed && info.current.s === 1 && info.current.t > 0) {
        ai.current.armed = true;
        if (isTvMode()) ai.current.at = Date.now() + (pending.current ? 9500 : 8000);
      }
      // Live tocando: aplica o atraso padrão (o guardado para este narrador).
      if (pending.current && info.current.s === 1 && info.current.t > 0) {
        const p = pending.current;
        pending.current = 0;
        resync(8000);
        timers.current.push(
          setTimeout(() => {
            moveRef.current?.(p, 0);
            resync(6000);
          }, 1500)
        );
      }
      if (m?.event === 'onError') {
        notify(`A live de “${narr.channel}” não pode tocar fora do YouTube. Escolha outra narração.`, 'err');
        stop();
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [narr, notify, stop]);

  // Convite para se inscrever no canal da narração (uma vez por canal, quando ainda não é inscrito).
  useEffect(() => {
    if (!narr || isSubscribed(narr.channelId)) return undefined;
    const t = setTimeout(() => setAsk(true), ASK_AFTER);
    return () => clearTimeout(t);
  }, [narr]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      clearTimeout(lanceTimer.current);
    },
    []
  );

  // Vídeo do jogo trocado ou recarregado (outro canal/fonte): a ponta do ao vivo é outra, mede de novo.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !narr) return undefined;
    const onReset = () => {
      gameEdge.current.reset();
      resync(6000);
    };
    v.addEventListener('emptied', onReset);
    return () => v.removeEventListener('emptied', onReset);
  }, [narr, videoRef]);

  // Sincronia automática (anti-deriva). Distância do ao vivo da narração = duração - posição no YouTube;
  // a do jogo = ponta do trecho disponível (seekable, que serve para hls.js, mpegts.js e o player
  // nativo) - posição do vídeo. Logo depois de começar ou de um ajuste guarda a diferença entre as duas;
  // se um dos dois travar e ela se afastar mais de 1,5 s, corrige a posição da narração.
  useEffect(() => {
    if (!narr || !auto) return undefined;
    const id = setInterval(() => {
      const s = sync.current;
      const now = Date.now();
      const v = videoRef.current;
      if (!v) return;
      const r = v.seekable.length ? v.seekable : v.buffered;
      if (r.length) gameEdge.current.feed(r.end(r.length - 1), now);
      const y = info.current;
      // Só mede com os dois tocando normalmente (sem carregar, pausa ou o jogo correndo atrás do ao vivo)
      // e fora do tempo de acomodação de um ajuste.
      const steady = !v.paused && !v.seeking && v.readyState >= 3 && v.playbackRate === 1 && y.s === 1 && now - y.at < 3000;
      if (!steady || pending.current || now < s.waitUntil) {
        s.samples = [];
        return;
      }
      const yt = y.t + (now - y.at) / 1000;
      const nd = narrEdge.current.get(now) - yt;
      const gd = gameEdge.current.get(now) - v.currentTime;
      // Leitura absurda (ponta desconhecida ou parada): não mede.
      if (!(nd > -3 && nd < 900 && gd > -3 && gd < 900)) {
        s.samples = [];
        return;
      }
      s.samples = [...s.samples.slice(-4), nd - gd];
      if (s.samples.length < 3) return;
      const m = median(s.samples);
      if (s.ref == null) {
        s.ref = m;
        s.lastCheck = now;
        return;
      }
      if (s.samples.length < 5 || now - s.lastCheck < 5000) return;
      s.lastCheck = now;
      // err > 0: a narração ficou mais longe do ao vivo do que no ajuste (atrás do jogo).
      // Diferença enorme é leitura errada, não travamento; e no máximo uma correção a cada 10 s.
      const err = m - s.ref;
      if (Math.abs(err) < 1.5 || Math.abs(err) > 90 || now - s.lastFix < 10000) return;
      if (err > 0) {
        // Adianta a narração, sem passar do ao vivo do YouTube.
        const target = Math.min(yt + err, narrEdge.current.get(now) - 1);
        if (target - yt < 1) return;
        cmd('seekTo', [target, true]);
      } else moveRef.current?.(-err, 0); // atrasa (volta a live ou, sem DVR, segura a narração)
      s.lastFix = now;
      s.samples = [];
      s.waitUntil = now + 4000;
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narr, auto, videoRef]);
  const setSyncMode = (m) => {
    if (m === syncMode) return;
    setSyncModeState(m);
    saveSyncMode(m);
    if (m === 'auto') resync(2000);
    if (m === 'ai') {
      setAiDown(false);
      // Na TV a IA começa sozinha logo depois de escolher; no computador/celular, pelo botão.
      if (isTvMode() && !ai.current.synced) ai.current.at = Date.now() + 1500;
    }
    notify(
      m === 'ai'
        ? `Sincronia pela IA: ela lê o relógio do placar no jogo e na narração e acerta o atraso${isTvMode() ? ' (e confere a cada 3 minutos).' : '. Toque em “Sincronizar pela IA”.'}`
        : m === 'auto'
          ? 'Sincronia automática ligada: se o jogo ou a narração travar, o atraso é corrigido sozinho.'
          : 'Sincronia manual: use os botões de atrasar e adiantar ou o “Sincronizar pelo lance”.'
    );
  };
  const toggleAuto = () => setSyncMode(auto ? 'manual' : 'auto');

  const cmd = (func, args = []) => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  const listen = () => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');

  // Segura a narração d segundos (pausa e retoma do mesmo ponto): atrasa mesmo sem a posição da live.
  const hold = (d) => {
    quietUntil.current = Math.max(quietUntil.current, Date.now() + d * 1000 + 2500);
    cmd('pauseVideo');
    timers.current.push(setTimeout(() => cmd('playVideo'), d * 1000));
  };

  // d > 0: atrasa a narração d segundos (volta a live do YouTube; se a live não deixar voltar,
  // segura a narração pelo mesmo tempo). d < 0: adianta — desfaz primeiro o atraso já aplicado
  // ('cur', avançando a live); o que passar disso segura o vídeo do jogo pelo mesmo tempo.
  const move = (d, cur) => {
    const { t } = info.current;
    quietUntil.current = Math.max(quietUntil.current, Date.now() + 3000);
    if (d > 0) {
      if (t > d + 1) {
        const target = t - d;
        cmd('seekTo', [target, true]);
        // Confere depois de 2,5 s: se a posição não voltou, a live não tem DVR — segura a narração.
        timers.current.push(setTimeout(() => info.current.t > target + 7 && hold(d), 2500));
      } else hold(d);
      return;
    }
    const back = Math.max(0, Math.min(-d, cur));
    if (back) cmd('seekTo', [t + back, true]);
    const rest = -d - back;
    const v = videoRef.current;
    if (rest > 0 && v && !v.paused) {
      quietUntil.current = Math.max(quietUntil.current, Date.now() + rest * 1000 + 2500);
      v.pause();
      timers.current.push(setTimeout(() => v.play().catch(() => {}), rest * 1000));
    }
  };
  moveRef.current = move;
  // 'why': começo do aviso (ex.: o resultado do "Sincronizar pelo lance").
  const shift = (d, why = '') => {
    if (!d) return;
    pending.current = 0;
    move(d, offset);
    resync(6000); // o ajuste manual vira a nova referência da sincronia automática
    const n = offset + d;
    setOffset(n);
    saveOffset(narr?.channelId, n);
    notify(`${why}Sincronia: ${offsetText(n)}.`);
  };
  const shiftRef = useRef(shift);
  shiftRef.current = shift;

  // ---------- Sincronizar pela IA (lib/clocksync.js) ----------
  // Onde estão os dois vídeos na tela e o que fica por cima de cada um (pintado de preto na foto).
  const viewRef = useRef(view);
  viewRef.current = view;
  const aiTargets = () => {
    const v = videoRef.current;
    const f = frame.current;
    if (!v || !f) return null;
    const swap = viewRef.current.swap;
    const dock = f.parentElement?.getBoundingClientRect();
    return { game: videoBox(v), narr: f.getBoundingClientRect(), gameMask: swap ? [] : [dock], narrMask: swap ? [v.getBoundingClientRect()] : [] };
  };
  // '' = pode ler; senão, o motivo (o jogo e a narração precisam estar tocando, sem ajuste em andamento).
  const aiWait = () => {
    const v = videoRef.current;
    if (!v || v.paused) return 'Dê play no jogo para a IA ler o relógio.';
    if (v.seeking || v.readyState < 3) return 'Espere o jogo carregar e tente de novo.';
    if (info.current.s !== 1) return 'Espere a narração começar a tocar e tente de novo.';
    if (pending.current || Date.now() < quietUntil.current) return 'Espere o último ajuste terminar e tente de novo.';
    return '';
  };
  // manual: pelo botão (avisa tudo); check: conferência periódica (1 foto, quieta).
  const runAi = async ({ manual = false, check = false } = {}) => {
    const a = ai.current;
    if (!canAi) return;
    if (a.busy) return manual && notify('A IA já está lendo o relógio…');
    const why = aiWait();
    if (why) return manual && notify(why);
    const gen = a.gen;
    const alive = () => ai.current.gen === gen;
    a.busy = true;
    setAiBusy(true);
    try {
      // Android/navegador: autorização para capturar a tela (na conferência não pergunta de novo).
      let okCap = false;
      try {
        okCap = await ensureCapture({ ask: !check && (manual || !deniedOnce) });
      } catch (e) {
        if (manual) notify(e.message);
      }
      if (!alive()) return;
      if (!okCap) {
        if (manual) return notify(aiMessage('denied'));
        // Sem autorização (ou o sistema encerrou a captura): fica a sincronia automática.
        setAiDown(true);
        if (!deniedOnce) notify('Sem autorização para capturar a tela, a IA não lê o relógio: a sincronia automática ficou ligada. Para usar a IA, toque em “Sincronizar pela IA”.');
        deniedOnce = true;
        return;
      }
      // A janela de autorização do sistema pode ter segurado o jogo ou a narração: espera voltarem.
      for (let i = 0; i < 12 && aiWait() && alive(); i++) await new Promise((r) => setTimeout(r, 500));
      if (!alive()) return;
      const late = aiWait();
      if (late) {
        if (manual) notify(late);
        else if (!check) a.at = Date.now() + 5000;
        return;
      }
      if (manual) notify('Lendo o relógio do placar no jogo e na narração…');
      const res = await aiSync({
        targets: aiTargets,
        cover: (on) => alive() && setReading(on),
        apply: (d, w) => alive() && (shiftRef.current(d, w), true),
        settle: () => Math.max(0, quietUntil.current - Date.now()),
        ready: aiWait,
        notify,
        check,
        alive,
      });
      if (!alive() || res.error === 'gone') return;
      a.last = Date.now();
      if (res.ok) {
        a.synced = true;
        a.fails = 0;
        setAiDown(false);
        return;
      }
      if (res.error === 'ai_off') setAiOff(true);
      // Narrador sem relógio: a IA não serve para esta narração (fica a anti-deriva no modo IA).
      if (res.error === 'narr' && !check) setAiDown(true);
      if (check) {
        // Conferências falhando seguidas (placar sumiu, narrador tirou o relógio): para de conferir.
        if (++a.fails >= 3) {
          setAiDown(true);
          notify(`${res.message} A sincronia automática ficou ligada.`);
        }
        return;
      }
      // Primeira leitura automática (TV) que falhou por um motivo passageiro: tenta de novo em 1 min.
      if (!manual && res.error !== 'narr' && res.error !== 'ai_off' && ++a.tries < 3) a.at = Date.now() + 60e3;
      if (manual || a.tries <= 1 || res.error === 'narr') notify(res.message, 'err');
    } finally {
      if (alive()) {
        a.busy = false;
        setAiBusy(false);
      }
    }
  };
  const runAiRef = useRef(runAi);
  runAiRef.current = runAi;
  // Modo IA: a primeira leitura na TV (quando a live já toca com o atraso salvo) e a conferência a cada
  // 3 min depois de sincronizar.
  useEffect(() => {
    if (!narr || syncMode !== 'ai' || !canAi || aiDown) return undefined;
    const id = setInterval(() => {
      const a = ai.current;
      const now = Date.now();
      if (a.busy || aiWait()) return;
      if (a.at && now >= a.at) {
        a.at = 0;
        runAiRef.current();
        // Conferência periódica só na TV; no computador e no celular a IA roda só pelo botão.
      } else if (isTvMode() && a.synced && now - a.last >= CHECK_EVERY) runAiRef.current({ check: true });
    }, 2000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narr, syncMode, canAi, aiDown]);
  useEffect(() => () => releaseCapture(), []);
  const aiRun = () => runAi({ manual: true });
  const aiCtl = { ok: canAi, busy: aiBusy, run: aiRun };

  // Sincronizar pelo lance: o tempo entre "Vi o lance" e "Ouvi o narrador" vira o ajuste.
  // Ouviu depois de ver: a narração está atrás do jogo, adianta; ouviu antes: atrasa pelo mesmo tempo.
  const markLance = (kind) => {
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

  const answer = (subscribed) => {
    setAsk(false);
    if (subscribed) markSubscribed(narr.channelId);
    else {
      const id = narr.channelId;
      timers.current.push(setTimeout(() => !isSubscribed(id) && setAsk(true), ASK_AGAIN));
    }
  };

  const dock = narr && (
    <div className="narr-dock">
      <iframe
        key={narr.key}
        ref={frame}
        onLoad={listen}
        src={narrEmbedUrl(narr.key)}
        title={`Narração: ${narr.channel}`}
        allow="autoplay; encrypted-media"
        tabIndex={-1}
      />
      <div className="narr-bar">
        <Icon name="volume" size={14} />
        <strong title={narr.title}>{narr.channel}</strong>
        <small className="muted">{offsetText(offset)}</small>
        {auto ? (
          <small className="muted" title="Sincronia mantida automaticamente: se o jogo ou a narração travar, o atraso é corrigido sozinho">
            · auto
          </small>
        ) : (
          syncMode === 'ai' && (
            <small className="muted" title="Sincronia pela IA: ela lê o relógio do placar no jogo e na narração">
              · IA
            </small>
          )
        )}
      </div>
      {!isTvMode() && (
        <div className="narr-sync narr-win">
          <button className="chip" tabIndex={-1} onClick={cycleSize} title="Mudar o tamanho da janela da narração">
            <Icon name="fullscreen" size={12} /> {NARR_SIZES.find((s) => s.id === view.size).label}
          </button>
          <button className="chip" tabIndex={-1} onClick={cycleCorner} title="Levar a janela para outro canto da tela">
            {NARR_CORNERS.find((c) => c.id === view.pos).arrow} Canto
          </button>
          <button className={`chip ${view.swap ? 'active' : ''}`} tabIndex={-1} onClick={toggleSwap} title="Inverter: a live do YouTube em tela cheia e o jogo na janela menor">
            <Icon name="refresh" size={12} /> Inverter
          </button>
          <button className="chip" tabIndex={-1} onClick={toggleHidden} title="Esconder a janela (a narração continua tocando)">
            <Icon name="eye" size={12} /> Esconder
          </button>
          <button className="chip" tabIndex={-1} onClick={stop} title="Desligar a narração (volta o som do jogo)">
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
      {!isTvMode() && <SyncButtons shift={shift} offset={offset} lance={lance} markLance={markLance} ai={aiCtl} compact />}
    </div>
  );

  const askModal = narr && ask && (
    <Modal onClose={() => answer(false)} title={`Inscreva-se no canal ${narr.channel}`} className="narr-ask">
      <p>
        Gostando da narração? Inscreva-se no canal <b>{narr.channel}</b> no YouTube para apoiar quem narra
        {isTvMode() ? ': aponte a câmera do celular para o código.' : '.'}
      </p>
      <div className="narr-qr">
        <QrCode text={subscribeUrl(narr.channelId)} size={180} />
      </div>
      <div className="narr-ask-actions">
        {!isTvMode() && !SMART_TV && (
          <button className="btn" onClick={() => openExternal(subscribeUrl(narr.channelId))}>
            <Icon name="link" size={16} /> Abrir o canal no YouTube
          </button>
        )}
        <button className="btn" data-autofocus onClick={() => answer(true)}>
          <Icon name="heart" size={16} /> Já sou inscrito
        </button>
        <button className="btn ghost" onClick={() => answer(false)}>
          Agora não
        </button>
      </div>
    </Modal>
  );

  // Classes no <div className="player">: posicionam a janela menor (a narração ou, invertido, o jogo).
  // Lendo o relógio: a janela escondida aparece e os controles saem da frente dos vídeos (narr-reading).
  const wrapClass = narr ? `narr-on narr-${view.size} narr-${view.pos}${view.swap ? ' narr-swap' : ''}${view.hidden && !reading ? ' narr-hidden' : ''}${reading ? ' narr-reading' : ''}` : '';

  return { narr, start, stop, shift, offset, auto, toggleAuto, syncMode, setSyncMode, aiOk: canAi, aiBusy, aiSync: aiRun, ai: aiCtl, lance, markLance, gameVol, setGameVol, dock, askModal, view, setView, cycleSize, cycleCorner, toggleSwap, toggleHidden, wrapClass };
}

// Uma linha de narração (live): toca ao escolher; a estrela favorita o canal.
function LiveRow({ l, fav, onPick, onFav, current }) {
  return (
    <div className={`narr-row ${current ? 'on' : ''}`}>
      <button className="narr-pick" onClick={() => onPick(l)}>
        <strong>{l.channel}</strong>
        <span className="muted">{l.title}</span>
        {l.viewers && <small className="narr-live">● AO VIVO · {l.viewers}</small>}
      </button>
      <button className={`icon-btn ${fav ? 'on' : ''}`} onClick={() => onFav({ id: l.channelId, name: l.channel }, l)} aria-label={fav ? `Tirar ${l.channel} dos favoritos` : `Favoritar ${l.channel}`}>
        <Icon name="star" filled={fav} />
      </button>
    </div>
  );
}

// Janela de escolha: favoritos (com quem está ao vivo agora), busca pelo nome do canal ou do jogo,
// e — com a narração ligada — sincronia e som do jogo.
export function NarrationPicker({ n, game, title, onClose }) {
  const [favs, setFavs] = useState(loadFavs);
  const [favLive, setFavLive] = useState({}); // id -> { loading } | live | null
  const [q, setQ] = useState(() => queryFor(game));
  const [res, setRes] = useState({ loading: true });
  const favIds = new Set(favs.map((f) => f.id));

  const search = async (e) => {
    e?.preventDefault();
    const term = q.trim();
    if (term.length < 2) return;
    setRes({ loading: true });
    try {
      setRes({ list: await searchLives(term) });
    } catch {
      setRes({ error: 'Não foi possível buscar no YouTube agora. Verifique a internet e tente de novo.' });
    }
  };
  useEffect(() => {
    search();
    let alive = true;
    for (const f of loadFavs()) {
      setFavLive((s) => ({ ...s, [f.id]: { loading: true } }));
      channelLive(f.id)
        .then((live) => alive && setFavLive((s) => ({ ...s, [f.id]: live })))
        .catch(() => alive && setFavLive((s) => ({ ...s, [f.id]: null })));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Favoritar uma live da busca: já sabemos que o canal está ao vivo.
  const fav = (c, l) => {
    setFavs(toggleFav(c));
    if (l?.key) setFavLive((s) => ({ ...s, [c.id]: { key: l.key, title: l.title } }));
  };
  const pick = (l) => {
    n.start({ key: l.key, title: l.title, channel: l.channel, channelId: l.channelId });
    onClose();
  };

  return (
    <Modal onClose={onClose} title="Narração do YouTube" className="narr-modal">
      {n.narr && (
        <section className="narr-sec">
          <h3>
            Ouvindo: {n.narr.channel} <small className="muted">· {offsetText(n.offset)}</small>
          </h3>
          <p className="muted">
            A narração está na frente do jogo? Atrase. Está atrás? Adiante. Ou use “Vi o lance” e “Ouvi o narrador” num gol ou apito{n.aiOk ? ', ou deixe a IA ler o relógio do placar' : ''}. O ajuste fica salvo para este narrador e vale como padrão para os novos.
          </p>
          {/* "Sincronizar pela IA" fecha a janela: a IA precisa ver o jogo e a narração. */}
          <SyncButtons shift={n.shift} offset={n.offset} lance={n.lance} markLance={n.markLance} ai={n.ai && { ...n.ai, run: () => (onClose(), n.ai.run()) }} autofocus />
          <div className="narr-sync">
            <span className="narr-sync-label">Sincronia</span>
            {SYNC_MODES.filter((m) => m.id !== 'ai' || n.aiOk).map((m) => (
              <button key={m.id} className={`chip ${n.syncMode === m.id ? 'active' : ''}`} onClick={() => n.setSyncMode(m.id)} title={m.hint}>
                <Icon name={m.id === 'ai' ? 'clock' : m.id === 'auto' ? 'refresh' : 'remote'} size={12} /> {m.label}
              </button>
            ))}
          </div>
          <div className="narr-sync">
            <button className={`chip ${!n.gameVol ? 'active' : ''}`} onClick={() => n.setGameVol(0)}>Som do jogo: mudo</button>
            <button className={`chip ${n.gameVol ? 'active' : ''}`} onClick={() => n.setGameVol(0.2)}>Som do jogo: baixo</button>
            <button className="chip" onClick={() => (n.stop(), onClose())}>
              <Icon name="close" size={12} /> Desligar narração
            </button>
          </div>
          <h3 className="narr-sub">Janela da narração</h3>
          <div className="narr-sync">
            {NARR_SIZES.map((s) => (
              <button key={s.id} className={`chip ${n.view.size === s.id ? 'active' : ''}`} onClick={() => n.setView({ size: s.id })}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="narr-sync">
            {NARR_CORNERS.map((c) => (
              <button key={c.id} className={`chip ${n.view.pos === c.id ? 'active' : ''}`} onClick={() => n.setView({ pos: c.id })} title={c.label}>
                {c.arrow} {c.label}
              </button>
            ))}
          </div>
          <div className="narr-sync">
            <button className={`chip ${n.view.swap ? 'active' : ''}`} onClick={n.toggleSwap}>
              <Icon name="refresh" size={12} /> {n.view.swap ? 'Voltar: jogo em tela cheia' : 'Inverter: narração em tela cheia e jogo na janela'}
            </button>
            <button className={`chip ${n.view.hidden ? 'active' : ''}`} onClick={n.toggleHidden}>
              <Icon name="eye" size={12} /> {n.view.hidden ? 'Mostrar a janela' : 'Esconder a janela (só o som)'}
            </button>
          </div>
        </section>
      )}
      {favs.length > 0 && (
        <section className="narr-sec">
          <h3>Meus narradores</h3>
          {favs.map((f) => {
            const live = favLive[f.id];
            return live?.key ? (
              <LiveRow key={f.id} l={{ ...live, channel: f.name, channelId: f.id }} fav current={n.narr?.channelId === f.id} onPick={pick} onFav={fav} />
            ) : (
              <div key={f.id} className="narr-row off">
                <div className="narr-pick">
                  <strong>{f.name}</strong>
                  <span className="muted">{live?.loading ? 'Verificando se está ao vivo…' : 'Não está ao vivo agora'}</span>
                </div>
                <button className="icon-btn on" onClick={() => setFavs(toggleFav(f))} aria-label={`Tirar ${f.name} dos favoritos`}>
                  <Icon name="star" filled />
                </button>
              </div>
            );
          })}
        </section>
      )}
      <section className="narr-sec">
        <h3>Narrações ao vivo</h3>
        <form className="ck-add-form" onSubmit={search}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome do canal ou do jogo" enterKeyHint="search" />
          <button className="btn" type="submit" disabled={q.trim().length < 2 || res.loading}>
            {res.loading ? <span className="spinner sm" /> : <Icon name="search" size={16} />} Buscar
          </button>
        </form>
        {res.error && <p className="muted">{res.error}</p>}
        {res.list && !res.list.length && <p className="muted">Nenhuma live encontrada. Tente o nome do canal do narrador.</p>}
        {res.list?.map((l) => (
          <LiveRow key={l.key} l={l} fav={favIds.has(l.channelId)} current={n.narr?.key === l.key} onPick={pick} onFav={fav} />
        ))}
        {isTouch && <p className="muted narr-hint">Toque na estrela para guardar o canal em “Meus narradores”.</p>}
      </section>
    </Modal>
  );
}
