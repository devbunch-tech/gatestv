import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import Icon from './Icon';
import { RatingBadge, Thumb } from './Media';
import { useItemMeta } from './MetaSections';
import { useStore } from '../store';
import { WEB_BUILD, WEB_HINT, blockedByBrowser, detectKind, isExternal, isProxied, markProxyHost, streamUrl } from '../lib/net';
import { isTvMode, rememberFocus, useKeyHandler } from '../lib/keys';
import { baseName, channelKey, pickWorking, qualityRank, zapGroups } from '../lib/zapping';
import { playableUrl } from '../lib/health';
import { canCast, castDevices, castDiscover, castPause, castSession, castStart, castStatus, castStop } from '../lib/cast';
import { SMART_TV, hasNative, isTouch, native, vibrate } from '../lib/device';
import { findNow, fmtTime, nowNext, progressOf, useNow } from '../lib/epg';

const fmt = (s) => {
  if (!Number.isFinite(s)) return '--:--';
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

// Fontes de cada canal já tentadas nos últimos minutos (o player é remontado a cada troca).
const TRIED = new Map();

export default function Player() {
  const { playing } = useStore();
  if (!playing) return null;
  return <PlayerView key={playing.item.id} item={playing.item} rawQueue={playing.queue} />;
}

function PlayerView({ item, rawQueue }) {
  const { stop, play, saveProgress, history, settings, programmesFor, ratingOf, openMenu, openProgram, catalog, liveHealth, markLiveHealth, notify, loadEpisodes } =
    useStore();
  const videoRef = useRef(null);
  const wrapRef = useRef(null);
  const hideTimer = useRef(0);
  const lastSave = useRef(0);
  const isLive = item.type === 'live';
  const delay = isLive ? settings.liveDelay : 0; // segundos atrás do ao vivo (buffer contra travamentos)
  const [useTs, setUseTs] = useState(false);
  // Xtream: com atraso de segurança, usa o HLS (.m3u8), que já começa com o buffer cheio.
  const playUrl = useTs ? item.url : playableUrl(item, delay);
  const initialKind = detectKind(playUrl);
  const [kind, setKind] = useState(initialKind === 'unknown' ? 'hls' : initialKind);
  const [st, setSt] = useState({ paused: false, time: 0, dur: NaN, buffering: true, muted: false, volume: 1 });
  const [error, setError] = useState(null);
  const [ui, setUi] = useState(true);
  const [panel, setPanel] = useState(null); // null | 'info' | 'list'
  const [osd, setOsd] = useState(isLive);
  const [numBuf, setNumBuf] = useState('');

  const [bufAhead, setBufAhead] = useState(0);

  // Troca de canais: só os canais selecionados, sem duplicidade, na versão HD que está no ar.
  // Se o canal atual é uma das versões de um canal da lista, ele ocupa o lugar desse canal;
  // se não faz parte da lista, entra no topo.
  const groups = useMemo(() => (isLive && settings.curatedZap ? zapGroups(catalog.live, settings.uf) : []), [isLive, settings.curatedZap, settings.uf, catalog.live]);
  const queue = useMemo(() => {
    if (!groups.length) return rawQueue;
    let inList = false;
    const list = groups
      .map((g) => {
        if (g.candidates.some((c) => c.id === item.id)) {
          inList = true;
          return item;
        }
        return pickWorking(g.candidates, liveHealth);
      })
      .filter(Boolean);
    return inList ? list : [item, ...list];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, liveHealth, item.id]);

  // Título de seção de cada canal no painel (Canais abertos, Esportes, Infantil…).
  const labels = useMemo(() => {
    const m = new Map();
    for (const g of groups) for (const c of g.candidates) m.set(c.id, g.section);
    return m;
  }, [groups]);

  // Todas as versões (fontes) deste canal: as da troca rápida ou, para canais fora dela, os canais
  // da lista com o mesmo nome (ex.: "Premiere 2 HD", "Premiere 2 FHD", "Premiere 2 SD").
  const sameChannel = useMemo(() => {
    if (!isLive) return [];
    const g = groups.find((x) => x.candidates.some((c) => c.id === item.id));
    if (g) return g.candidates;
    const key = channelKey(baseName(item.name));
    return catalog.live.filter((c) => channelKey(baseName(c.name)) === key).sort((a, b) => qualityRank(a.name) - qualityRank(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, groups, item.id, catalog.live]);
  // Fontes já tentadas deste canal nos últimos minutos (vale entre as trocas, que remontam o player).
  const tried = () => {
    const k = sameChannel[0]?.id || item.id;
    let t = TRIED.get(k);
    if (!t || Date.now() - t.at > 3 * 60e3) TRIED.set(k, (t = { ids: new Set(), at: Date.now() }));
    t.ids.add(item.id);
    return t;
  };
  // Próxima fonte ainda não tentada (as que a validação marcou como fora do ar ficam por último).
  const nextSource = () => {
    const t = tried();
    const i = sameChannel.findIndex((c) => c.id === item.id);
    const ring = [...sameChannel.slice(i + 1), ...sameChannel.slice(0, Math.max(i, 0))].filter((c) => c.id !== item.id && !t.ids.has(c.id));
    return ring.find((c) => liveHealth[c.id]?.ok !== false) || ring[0] || null;
  };
  // Versão dublada ⇄ legendada do mesmo filme/episódio (botão "Legendado"/"Dublado" do player).
  // A legenda das listas IPTV vem gravada na imagem da versão legendada: trocar de versão é o
  // jeito de ligar/desligar a legenda. Continua do mesmo ponto.
  const langSwitch = useMemo(() => {
    if (isLive) return null;
    const shellId = item.seriesId || item.id;
    const pool = item.seriesId ? catalog.series : catalog.movies;
    const primary = pool.find((p) => p.id === shellId || p.variants?.some((v) => v.id === shellId));
    const vars = primary?.variants;
    if (!vars) return null;
    const cur = vars.find((v) => v.id === shellId);
    const wantLeg = cur?.lang !== 'leg';
    const target = vars.find((v) => (wantLeg ? v.lang === 'leg' : v.lang !== 'leg'));
    return target ? { id: target.id, toLeg: wantLeg } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, item.id, catalog.movies, catalog.series]);
  const [altPending, setAltPending] = useState(null);
  const switchVersion = () => {
    if (!langSwitch) return;
    const pos = videoRef.current?.currentTime || 0;
    const dur = videoRef.current?.duration || 0;
    if (!item.seriesId) {
      const target = catalog.byId.get(langSwitch.id);
      if (!target) return;
      if (pos > 10) saveProgress(target.id, { position: pos, duration: dur, type: target.type });
      return play(target, [target]);
    }
    setAltPending({ shellId: langSwitch.id, season: item.series?.season, episode: item.series?.episode, pos, dur, toLeg: langSwitch.toLeg });
    const shell = catalog.byId.get(langSwitch.id);
    if (shell && !shell.episodes) loadEpisodes(shell);
  };
  // Episódio: espera os episódios da outra versão carregarem e abre o mesmo episódio.
  useEffect(() => {
    if (!altPending) return;
    const shell = catalog.byId.get(altPending.shellId);
    if (shell?.episodesState?.error) return setAltPending(null), notify('Não foi possível abrir a outra versão deste episódio.');
    const eps = shell?.episodes;
    if (!eps?.length) return;
    const ep = eps.find((e) => e.series.season === altPending.season && e.series.episode === altPending.episode);
    setAltPending(null);
    if (!ep) return notify(`Este episódio não tem versão ${altPending.toLeg ? 'legendada' : 'dublada'}.`);
    if (altPending.pos > 10) saveProgress(ep.id, { position: altPending.pos, duration: altPending.dur, type: ep.type });
    play(ep, eps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [altPending, catalog.byId]);

  const FINDING = 'Estamos buscando uma melhor fonte para exibir seu conteúdo, aguarde alguns segundos.';
  // Um canal com problema dispara vários erros seguidos: troca (e avisa) uma vez só por canal.
  const failingRef = useRef(null);
  const failRef = useRef(null);
  failRef.current = (msg, { onlyIfAlt = false } = {}) => {
    if (failingRef.current === item.id) return;
    const alt = isLive ? nextSource() : null;
    if (alt) {
      failingRef.current = item.id;
      markLiveHealth(item.id, { ok: false, at: Date.now(), error: 'player' });
      notify(FINDING);
      play(alt, queue);
    } else if (!onlyIfAlt)
      setError(isLive && sameChannel.length > 1 ? `Este canal está fora do ar em todas as ${sameChannel.length} fontes no momento. Tente de novo em alguns minutos.` : msg);
  };
  // Botão "Outra fonte": a próxima ainda não tentada; depois de passar por todas, recomeça a volta.
  const findOtherSource = () => {
    let alt = nextSource();
    if (!alt && sameChannel.length > 1) {
      TRIED.delete(sameChannel[0]?.id || item.id);
      alt = nextSource();
    }
    if (!alt) return notify('Este canal só tem esta fonte na lista. Tente de novo em alguns minutos.');
    failingRef.current = item.id;
    notify(FINDING);
    play(alt, queue);
  };

  const idx = queue.findIndex((q) => q.id === item.id);
  const [sel, setSel] = useState(Math.max(0, idx));
  const prev = idx > 0 ? queue[idx - 1] : null;
  const next = idx >= 0 && idx < queue.length - 1 ? queue[idx + 1] : null;
  const seekable = !isLive && Number.isFinite(st.dur) && st.dur > 0;

  const now = useNow(15000);
  const progs = isLive ? programmesFor(item) : null;
  const guide = useMemo(() => nowNext(progs, now), [progs, now]);
  const meta = useItemMeta(isLive ? null : item);
  const age = ratingOf(item);
  const subtitle = item.series
    ? `T${item.series.season} · E${item.series.episode}${item.series.title ? ' — ' + item.series.title : ''}`
    : isLive
      ? guide.now?.title || item.group
      : item.group;

  // Carrega a fonte de acordo com o tipo do stream. Tenta direto no servidor (menor atraso);
  // se o servidor bloquear (CORS), refaz pelo proxy e memoriza o servidor.
  const [viaProxy, setViaProxy] = useState(false);
  // Smart TVs Samsung/LG: o player nativo da TV toca HLS e TS sem depender de CORS; se ele falhar
  // neste canal, usa hls.js / mpegts.js.
  const [mseFor, setMseFor] = useState(null);
  // ---------- Transmitir (Chromecast / Google TV) ----------
  // Transmitindo, o vídeo não toca aqui (o Chromecast usa a conexão com o servidor da lista).
  const [casting, setCasting] = useState(() => (canCast ? castSession.device : null));
  const [castPick, setCastPick] = useState(false);
  const [castList, setCastList] = useState([]);
  const [castSt, setCastSt] = useState({ state: 'idle' });
  const castStartedAt = useRef(0);
  const castFrom = useRef(0); // ponto do filme/episódio em que a transmissão começou
  useEffect(() => {
    if (!castPick) return;
    castDiscover();
    const tick = () => setCastList(castDevices());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [castPick]);
  // Ao abrir o player (ou trocar de canal/episódio) já transmitindo: manda este conteúdo.
  useEffect(() => {
    if (!casting) return;
    const start = !isLive ? castFrom.current || history[item.id]?.position || 0 : 0;
    castFrom.current = 0;
    castStartedAt.current = Date.now();
    castStart(casting, item, start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casting?.id, item.id]);
  const endCast = (msg) => {
    castSession.device = null;
    setCasting(null);
    setCastSt({ state: 'idle' });
    if (msg) notify(msg);
  };
  useEffect(() => {
    if (!casting) return;
    const t = setInterval(() => {
      const s = castStatus();
      setCastSt(s);
      if (s.state === 'error') endCast(s.error || 'A transmissão foi interrompida.');
      // Fechado no Chromecast (ou terminou): volta a tocar aqui.
      else if (s.state === 'idle' && Date.now() - castStartedAt.current > 8000) endCast('A transmissão terminou.');
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casting?.id]);
  const pickCast = (d) => {
    castFrom.current = videoRef.current?.currentTime || 0;
    castSession.device = d;
    setCastPick(false);
    setCasting(d);
  };
  const stopCast = () => {
    castStop();
    endCast();
  };

  const nativeFirst = SMART_TV && mseFor !== playUrl;
  useEffect(() => {
    const v = videoRef.current;
    if (casting) return undefined;
    const mode = settings.proxyMode;
    const src = streamUrl(playUrl, mode, viaProxy);
    const canRetry = !SMART_TV && !WEB_BUILD && mode === 'auto' && !isProxied(src) && isExternal(playUrl);
    const retryViaProxy = () => {
      markProxyHost(playUrl);
      setViaProxy(true);
    };
    let hls, ts, cushion;
    setError(null);
    if (blockedByBrowser(playUrl)) {
      setError('Este canal usa um endereço http://, que os navegadores bloqueiam por segurança. ' + WEB_HINT);
      return undefined;
    }
    setSt((x) => ({ ...x, buffering: true }));

    if (nativeFirst && (kind === 'hls' || kind === 'mpegts') && (kind === 'mpegts' || v.canPlayType('application/vnd.apple.mpegurl'))) {
      v.src = src;
    } else if (kind === 'hls' && Hls.isSupported()) {
      const liveCfg =
        delay > 0
          ? {
              // Toca "delay" segundos atrás do ao vivo e mantém esse colchão sempre carregado.
              lowLatencyMode: false,
              liveSyncDuration: delay,
              liveMaxLatencyDuration: delay + 25,
              maxLiveSyncPlaybackRate: 1,
              maxBufferLength: delay + 10,
              maxMaxBufferLength: delay + 40,
              backBufferLength: 30,
            }
          : {
              // Modo "mínimo": o mais perto possível do ao vivo.
              lowLatencyMode: true,
              liveSyncDurationCount: 2,
              liveMaxLatencyDurationCount: 4,
              maxLiveSyncPlaybackRate: 1.15,
              maxBufferLength: 8,
              backBufferLength: 10,
            };
      hls = new Hls({
        enableWorker: true,
        ...(isLive ? liveCfg : { maxBufferLength: 30, backBufferLength: 30 }),
        startFragPrefetch: true,
        capLevelToPlayerSize: true,
        abrEwmaDefaultEstimate: 5e6,
        manifestLoadingMaxRetry: 1,
        // Ao vivo: o servidor costuma falhar alguns segundos ao atualizar a lista do canal
        // (levelLoadError) — insiste mais antes de desistir, enquanto o colchão segura a imagem.
        levelLoadingMaxRetry: isLive ? 6 : 2,
        levelLoadingRetryDelay: 1000,
        fragLoadingMaxRetry: isLive ? 6 : 3,
      });
      let mediaErrors = 0;
      let netRetries = 0;
      let playedOk = false;
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        playedOk = true;
        netRetries = 0;
      });
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (!d.fatal) return;
        // Já estava tocando e a rede/servidor oscilou: recomeça a carregar em silêncio (até 4 vezes
        // seguidas, com pausas crescentes) antes de trocar de fonte.
        if (isLive && playedOk && d.type === Hls.ErrorTypes.NETWORK_ERROR && netRetries < 4) {
          netRetries++;
          setTimeout(() => hls && hls.startLoad(), 1500 * netRetries);
          return;
        }
        // Formato que o aparelho não decodifica (comum em 4K/H.265): vai direto para outra versão.
        if (d.details === Hls.ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR) return failRef.current('Formato de vídeo não suportado neste aparelho.');
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (++mediaErrors <= 2) return hls.recoverMediaError();
          return failRef.current('Não foi possível decodificar o vídeo deste canal.');
        }
        if (initialKind === 'unknown' && d.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR) return setKind('mpegts');
        // Primeiro tenta pelo proxy (servidor bloqueando acesso direto)…
        if (canRetry && d.type === Hls.ErrorTypes.NETWORK_ERROR) return retryViaProxy();
        // …e só então conclui que o servidor Xtream não tem HLS para este canal: volta para o .ts.
        if (playUrl !== item.url && /manifest/i.test(d.details)) {
          setUseTs(true);
          return setKind('mpegts');
        }
        failRef.current(`Não foi possível reproduzir este conteúdo (${d.details}).`);
      });
      hls.loadSource(src);
      hls.attachMedia(v);
    } else if (kind === 'hls' && v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = src;
    } else if (kind === 'mpegts' && mpegts.isSupported()) {
      ts = mpegts.createPlayer(
        { type: /\.flv(\?|$)/i.test(item.url) ? 'flv' : 'mpegts', isLive, url: new URL(src, location.href).href },
        {
          enableWorker: true,
          enableStashBuffer: delay > 0,
          stashInitialSize: delay > 0 ? 1024 * 1024 : 128 * 1024,
          lazyLoad: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 60,
          autoCleanupMinBackwardDuration: 30,
          // Com atraso configurado, não "corre atrás" do ao vivo: mantém o colchão.
          liveBufferLatencyChasing: isLive && delay === 0,
          liveBufferLatencyMaxLatency: 1.5,
          liveBufferLatencyMinRemain: 0.4,
        }
      );
      let tsRetries = 0;
      ts.on(mpegts.Events.ERROR, (type, detail) => {
        // Já estava tocando e a conexão caiu: reconecta em silêncio (até 3 vezes) antes de trocar de fonte.
        if (isLive && v.currentTime > 0 && type === mpegts.ErrorTypes.NETWORK_ERROR && tsRetries < 3) {
          tsRetries++;
          setTimeout(() => {
            if (!ts) return;
            ts.unload();
            ts.load();
            v.play().catch(() => {});
          }, 1500 * tsRetries);
          return;
        }
        if (canRetry && type === mpegts.ErrorTypes.NETWORK_ERROR) return retryViaProxy();
        failRef.current(`Erro ao reproduzir o stream (${type}: ${detail}).`);
      });
      ts.attachMediaElement(v);
      ts.load();
    } else {
      v.src = src;
    }

    const onVideoError = () => {
      if (nativeFirst && (kind === 'hls' || kind === 'mpegts') && (Hls.isSupported() || mpegts.isSupported())) return setMseFor(playUrl);
      if (canRetry && kind === 'file' && v.error?.code !== 3) retryViaProxy();
      // Ao vivo com erro de decodificação/formato (ex.: 4K que o aparelho não suporta): outra versão.
      else if (isLive && (v.error?.code === 3 || v.error?.code === 4)) failRef.current('Formato de vídeo não suportado neste aparelho.');
    };
    v.addEventListener('error', onVideoError);

    // Stream TS não traz o passado: começa com alguns segundos guardados e vai formando o colchão
    // tocando 5% mais devagar (imperceptível) até chegar ao atraso configurado.
    const tsCushion = kind === 'mpegts' && isLive && delay > 0;
    let started = !tsCushion;
    // Vigia: ao vivo parado (carregando) por mais de 20 s -> troca para outra versão do canal
    // (ex.: 4K pesado demais para a internet no momento).
    let lastTime = -1;
    let stuckSince = Date.now();
    cushion = setInterval(() => {
      if (isLive && !v.paused) {
        if (v.currentTime !== lastTime) {
          lastTime = v.currentTime;
          stuckSince = Date.now();
        } else if (Date.now() - stuckSince > 20000) {
          stuckSince = Infinity; // dispara uma vez só
          failRef.current('O canal parou de responder.', { onlyIfAlt: true });
        }
      }
      const b = v.buffered;
      if (!b.length) return;
      const ahead = Math.max(0, b.end(b.length - 1) - v.currentTime);
      setBufAhead(ahead);
      if (!tsCushion) return;
      if (!started) {
        if (ahead >= Math.min(5, delay)) {
          started = true;
          v.play().catch(() => {});
        }
        return;
      }
      v.playbackRate = ahead < delay - 1 ? 0.95 : 1;
    }, 500);

    const resume = history[item.id];
    if (!isLive && resume?.position > 10 && resume.position < (resume.duration || Infinity) - 30) {
      v.addEventListener('loadedmetadata', () => (v.currentTime = resume.position), { once: true });
    }
    if (started) v.play().catch(() => setSt((x) => ({ ...x, paused: true })));
    saveProgress(item.id, { type: item.type });

    return () => {
      clearInterval(cushion);
      v.playbackRate = 1;
      v.removeEventListener('error', onVideoError);
      if (!isLive && v.currentTime > 0) saveProgress(item.id, { position: v.currentTime, duration: v.duration });
      hls?.destroy();
      hls = null;
      if (ts) {
        ts.unload();
        ts.detachMediaElement();
        ts.destroy();
        ts = null;
      }
      v.removeAttribute('src');
      v.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, kind, viaProxy, playUrl, nativeFirst, casting?.id]);

  const close = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    stop();
  }, [stop]);

  const v = () => videoRef.current;
  const togglePlay = () => (v().paused ? v().play().catch(() => {}) : v().pause());
  const seekBy = (d) => {
    if (seekable) v().currentTime = Math.max(0, Math.min(v().duration, v().currentTime + d));
  };
  const toggleFs = () => (document.fullscreenElement ? document.exitFullscreen() : wrapRef.current.requestFullscreen?.());
  const toggleMute = () => (v().muted = !v().muted);
  const goto = (it) => it && play(it, queue);
  const togglePanel = (p) => setPanel((cur) => (cur === p ? null : p));

  const poke = useCallback(() => {
    setUi(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => !videoRef.current?.paused && setUi(false), 3500);
  }, []);
  useEffect(() => {
    poke();
    return () => clearTimeout(hideTimer.current);
  }, [poke]);

  // Celular/tablet: tela cheia sem barras do sistema e na horizontal enquanto o player está aberto.
  useEffect(() => {
    native('setPlayerMode', true);
    return () => native('setPlayerMode', false);
  }, []);
  const rotate = () => (hasNative('toggleOrientation') ? native('toggleOrientation') : toggleFs());

  // Gestos: toque mostra/esconde os controles; toque duplo nas laterais volta/avança 10 s;
  // ao vivo, deslizar para cima/baixo troca de canal e para a direita abre a lista de canais.
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const gest = useRef(null);
  const lastTap = useRef({ at: 0, side: 0 });
  const tapTimer = useRef(0);
  const [flash, setFlash] = useState(null);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 650);
    return () => clearTimeout(t);
  }, [flash]);
  useEffect(() => () => clearTimeout(tapTimer.current), []);
  const tapToggle = () => {
    if (panel) return setPanel(null);
    if (uiRef.current) {
      clearTimeout(hideTimer.current);
      setUi(false);
    } else poke();
  };
  const gestures = !isTouch
    ? {}
    : {
        onTouchStart: (e) => {
          if (e.touches.length > 1) return (gest.current = null);
          const t = e.touches[0];
          gest.current = { x: t.clientX, y: t.clientY, at: Date.now() };
        },
        onTouchEnd: (e) => {
          const g = gest.current;
          gest.current = null;
          if (!g) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - g.x;
          const dy = t.clientY - g.y;
          const ax = Math.abs(dx);
          const ay = Math.abs(dy);
          e.preventDefault();
          if (Math.max(ax, ay) > 60 && Date.now() - g.at < 800) {
            if (isLive && ay > ax * 1.3) {
              const to = dy < 0 ? next : prev;
              if (to) {
                vibrate();
                goto(to);
              }
            } else if (isLive && ax > ay * 1.3) {
              if (dx > 0) {
                setSel(Math.max(0, idx));
                setPanel('list');
              } else setPanel((p) => (p === 'list' ? null : 'info'));
            } else if (!isLive && ax > ay * 1.3 && seekable) {
              seekBy(dx > 0 ? 10 : -10);
              setFlash({ side: dx > 0 ? 1 : -1, key: Date.now() });
            }
            return;
          }
          if (ax > 14 || ay > 14) return;
          const w = window.innerWidth;
          const side = t.clientX < w / 3 ? -1 : t.clientX > (w * 2) / 3 ? 1 : 0;
          const now = Date.now();
          const double = !isLive && side && seekable && now - lastTap.current.at < 320 && lastTap.current.side === side;
          lastTap.current = { at: double ? 0 : now, side };
          clearTimeout(tapTimer.current);
          if (double) {
            seekBy(10 * side);
            setFlash({ side, key: now });
            return;
          }
          // Espera um instante para saber se é um toque duplo (só nas laterais de filmes/séries).
          tapTimer.current = setTimeout(tapToggle, !isLive && side && seekable ? 300 : 0);
        },
      };

  // Faixa de informações ao trocar de canal.
  useEffect(() => {
    if (!osd) return;
    const t = setTimeout(() => setOsd(false), 5000);
    return () => clearTimeout(t);
  }, [osd]);

  // Digitação direta do número do canal.
  useEffect(() => {
    if (!numBuf) return;
    const t = setTimeout(() => {
      const ch = catalog.live.find((c) => c.num === +numBuf);
      setNumBuf('');
      if (ch && ch.id !== item.id) play(ch, catalog.live);
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numBuf]);

  // Mantém o foco anterior ao fechar o player.
  useEffect(() => rememberFocus(), []);

  useKeyHandler((k, e) => {
    poke();
    if (!k) return true;
    if (panel === 'list') {
      if (k === 'up') setSel((s) => Math.max(0, s - 1));
      else if (k === 'down') setSel((s) => Math.min(queue.length - 1, s + 1));
      else if (k === 'chup') setSel((s) => Math.max(0, s - 10));
      else if (k === 'chdown') setSel((s) => Math.min(queue.length - 1, s + 10));
      else if (k === 'ok') queue[sel]?.id !== item.id ? goto(queue[sel]) : setPanel(null);
      else if (k === 'back' || k === 'left' || k === 'right') setPanel(null);
      return true;
    }
    if (k.length === 2 && k[0] === 'd') {
      if (isLive) setNumBuf((b) => (b + k[1]).slice(-4));
      return true;
    }
    switch (k) {
      case 'back':
        if (e.key === 'Escape' && document.fullscreenElement) return true;
        panel ? setPanel(null) : close();
        break;
      case 'up':
        isLive ? goto(prev) : togglePanel('info');
        break;
      case 'down':
        isLive ? goto(next) : togglePanel('info');
        break;
      case 'chup':
      case 'next':
        goto(next);
        break;
      case 'chdown':
      case 'prev':
        goto(prev);
        break;
      case 'left':
        if (isLive) {
          setSel(Math.max(0, idx));
          setPanel('list');
        } else seekBy(-10);
        break;
      case 'right':
        isLive ? togglePanel('info') : seekBy(10);
        break;
      case 'ok':
        if (!isLive) togglePlay();
        else if (panel === 'info' && guide.now) openProgram({ item, prog: guide.now });
        // Na TV, OK abre a lista de canais (como nos apps de IPTV); a informação fica no ▶ / Info.
        else if (isTvMode()) {
          setSel(Math.max(0, idx));
          setPanel('list');
        } else setPanel('info');
        break;
      case 'info':
        togglePanel('info');
        break;
      case 'playpause':
        togglePlay();
        break;
      case 'play':
        v().play().catch(() => {});
        break;
      case 'pause':
        v().pause();
        break;
      case 'stop':
        close();
        break;
      case 'ff':
        seekBy(30);
        break;
      case 'rw':
        seekBy(-30);
        break;
      case 'fullscreen':
        toggleFs();
        break;
      case 'mute':
        toggleMute();
        break;
      case 'menu':
        openMenu(item);
        break;
      default:
    }
    return true;
  });

  const ev = {
    onPlay: () => setSt((s) => ({ ...s, paused: false })),
    onPause: () => (setSt((s) => ({ ...s, paused: true })), setUi(true)),
    onWaiting: () => setSt((s) => ({ ...s, buffering: true })),
    onPlaying: () => setSt((s) => ({ ...s, buffering: false, paused: false })),
    onCanPlay: () => setSt((s) => ({ ...s, buffering: false })),
    onDurationChange: (e) => setSt((s) => ({ ...s, dur: e.target.duration })),
    onVolumeChange: (e) => setSt((s) => ({ ...s, muted: e.target.muted, volume: e.target.volume })),
    onTimeUpdate: (e) => {
      const el = e.target;
      setSt((s) => ({ ...s, time: el.currentTime }));
      if (!isLive && Date.now() - lastSave.current > 5000) {
        lastSave.current = Date.now();
        saveProgress(item.id, { position: el.currentTime, duration: el.duration });
      }
    },
    onEnded: () => {
      if (!isLive) saveProgress(item.id, { position: 0, duration: st.dur, watched: true });
      if (next && item.type === 'series') goto(next);
    },
    onError: () => {
      const el = videoRef.current;
      if (!el?.error) return;
      if (kind === 'file' && settings.proxyMode === 'auto' && !viaProxy && isExternal(item.url) && el.error.code !== 3) return;
      failRef.current('O navegador não conseguiu reproduzir este formato.');
    },
  };

  const showBanner = isLive && (osd || panel === 'info');

  return (
    <div ref={wrapRef} className={`player ${ui || panel ? '' : 'idle'}`} onMouseMove={isTouch ? undefined : poke} onTouchStart={isTouch ? undefined : poke} data-nav-root>
      <video ref={videoRef} playsInline onClick={isTouch ? undefined : togglePlay} onDoubleClick={isTouch ? undefined : toggleFs} {...ev} />
      {!isLive && settings.subtitles !== false && <Subtitles videoRef={videoRef} itemId={item.id} />}
      {casting && (
        <div className="cast-now">
          <Icon name="cast" size={40} />
          <strong>Transmitindo para {casting.name}</strong>
          <span className="muted">
            {{ connecting: 'Conectando…', loading: 'Abrindo o vídeo na TV…', buffering: 'Carregando na TV…', playing: 'Passando na TV', paused: 'Pausado na TV' }[castSt.state] || 'Conectando…'}
          </span>
          <div className="cast-actions">
            <button className="btn ghost" onClick={castPause} disabled={!['playing', 'paused', 'buffering'].includes(castSt.state)}>
              <Icon name={castSt.state === 'paused' ? 'play' : 'pause'} size={18} /> {castSt.state === 'paused' ? 'Continuar' : 'Pausar'}
            </button>
            <button className="btn" onClick={stopCast}>
              <Icon name="close" size={18} /> Parar transmissão
            </button>
          </div>
          <small className="muted">Pode trocar de canal ou episódio por aqui: a TV acompanha.</small>
        </div>
      )}
      {castPick && (
        <div className="cast-pick" onClick={() => setCastPick(false)}>
          <div className="cast-box" onClick={(e) => e.stopPropagation()}>
            <h3>Transmitir para</h3>
            {castList.length ? (
              castList.map((d) => (
                <button key={d.id} className="cast-dev" onClick={() => pickCast(d)}>
                  <Icon name="cast" size={22} />
                  <span>
                    <strong>{d.name}</strong>
                    {d.model && <small className="muted">{d.model}</small>}
                  </span>
                </button>
              ))
            ) : (
              <p className="muted">
                <span className="spinner sm" /> Procurando Chromecast e Google TV na sua rede…
                <br />
                <small>O celular e a TV precisam estar no mesmo Wi-Fi.</small>
              </p>
            )}
            <button className="btn ghost full" onClick={() => setCastPick(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {isTouch && <div className="gesture-layer" {...gestures} />}
      {flash && (
        <div key={flash.key} className={`seek-flash ${flash.side > 0 ? 'right' : 'left'}`}>
          {flash.side > 0 ? '+10 s' : '−10 s'}
        </div>
      )}
      {isTouch && !error && !panel && (
        <div className="touch-center" onTouchStart={poke}>
          <button className="tc-btn" onClick={() => (isLive ? goto(prev) : seekBy(-10))} disabled={isLive ? !prev : !seekable} aria-label={isLive ? 'Canal anterior' : 'Voltar 10 segundos'}>
            {isLive ? <Icon name="prev" size={26} /> : <span className="tc-skip">−10</span>}
          </button>
          <button className={`tc-btn play ${st.buffering ? 'is-loading' : ''}`} onClick={togglePlay} aria-label="Reproduzir/Pausar">
            <Icon name={st.paused ? 'play' : 'pause'} size={36} />
          </button>
          <button className="tc-btn" onClick={() => (isLive ? goto(next) : seekBy(10))} disabled={isLive ? !next : !seekable} aria-label={isLive ? 'Próximo canal' : 'Avançar 10 segundos'}>
            {isLive ? <Icon name="next" size={26} /> : <span className="tc-skip">+10</span>}
          </button>
        </div>
      )}

      <div className="player-top" onTouchStart={isTouch ? poke : undefined}>
        <button className="icon-btn big" onClick={close} aria-label="Voltar" tabIndex={-1}>
          <Icon name="back" size={26} />
        </button>
        <div className="player-logo">
          <Thumb src={item.logo} name={item.name} contain />
        </div>
        <div className="player-title">
          <strong>
            {isLive && <span className="ch-num">{item.num}</span>}
            {item.series?.name || item.name}
          </strong>
          <span>{subtitle}</span>
        </div>
        <RatingBadge age={age} large />
      </div>
      {/* Marca d'água fixa em filmes e séries; no ao vivo não aparece (a TV já tem o logo do canal). */}
      {!isLive && <img className="player-watermark" src="./logo.png" alt="" aria-hidden="true" />}

      {numBuf && <div className="num-osd">{numBuf}</div>}

      {(st.buffering || error) && (
        <div className="player-center">
          {error ? (
            <div className="player-error">
              <p>{error}</p>
              <small>
                {settings.proxyMode === 'never'
                  ? 'Dica: o proxy está desligado nas configurações — tente o modo automático.'
                  : 'Verifique se o canal está no ar no seu provedor.'}
              </small>
              <div className="player-error-actions">
                <button className="btn ghost" onClick={() => setKind((k) => (k === 'hls' ? 'mpegts' : 'hls'))}>
                  Tentar outro modo
                </button>
                {next && (
                  <button className="btn" onClick={() => goto(next)}>
                    Próximo
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="spinner" />
          )}
        </div>
      )}

      {panel === 'list' && isTouch && <div className="panel-scrim" onClick={() => setPanel(null)} />}
      {panel === 'list' && (
        <ChannelList
          queue={queue}
          sel={sel}
          currentId={item.id}
          now={now}
          programmesFor={programmesFor}
          labels={labels}
          onPick={(c) => (c.id === item.id ? setPanel(null) : goto(c))}
        />
      )}

      {showBanner && (
        <LiveBanner
          item={item}
          guide={guide}
          now={now}
          age={age}
          expanded={panel === 'info'}
          onDetails={() => guide.now && openProgram({ item, prog: guide.now })}
        />
      )}

      {!isLive && panel === 'info' && <VodInfo item={item} meta={meta} age={age} />}

      <div className="player-bottom" onTouchStart={isTouch ? poke : undefined}>
        {seekable ? (
          <div className="seek">
            <span>{fmt(st.time)}</span>
            <input
              type="range"
              min={0}
              max={st.dur}
              step={0.1}
              value={st.time}
              tabIndex={-1}
              style={{ '--p': `${(st.time / st.dur) * 100}%` }}
              onChange={(e) => (videoRef.current.currentTime = +e.target.value)}
            />
            <span>{fmt(st.dur)}</span>
          </div>
        ) : (
          <div className="seek live">
            <span className="badge-live">AO VIVO</span>
            {delay > 0 && (
              <span className="live-buffer" title="Atraso proposital para evitar travamentos">
                atraso de {delay}s · {Math.min(Math.round(bufAhead), 99)}s carregados
              </span>
            )}
          </div>
        )}
        <div className="controls">
          <button className="icon-btn" tabIndex={-1} onClick={() => goto(prev)} disabled={!prev} title={isLive ? 'Canal anterior (▲)' : 'Anterior'}>
            <Icon name="prev" />
          </button>
          <button className="icon-btn play" tabIndex={-1} onClick={togglePlay} title="Reproduzir/Pausar">
            <Icon name={st.paused ? 'play' : 'pause'} size={30} />
          </button>
          <button className="icon-btn" tabIndex={-1} onClick={() => goto(next)} disabled={!next} title={isLive ? 'Próximo canal (▼)' : 'Próximo'}>
            <Icon name="next" />
          </button>
          <div className="volume">
            <button className="icon-btn" tabIndex={-1} onClick={toggleMute} title="Mudo (m)">
              <Icon name={st.muted || st.volume === 0 ? 'mute' : 'volume'} />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              tabIndex={-1}
              value={st.muted ? 0 : st.volume}
              style={{ '--p': `${(st.muted ? 0 : st.volume) * 100}%` }}
              onChange={(e) => {
                videoRef.current.volume = +e.target.value;
                videoRef.current.muted = +e.target.value === 0;
              }}
            />
          </div>
          <div className="controls-spacer" />
          {/* Ao vivo: próximo programa deste canal (EPG). Séries: próximo episódio. */}
          {isLive
            ? guide.next && (
                <span className="up-next">
                  A seguir {fmtTime(guide.next.start)}: <strong>{guide.next.title}</strong>
                </span>
              )
            : next && (
                <span className="up-next">
                  A seguir: <strong>{next.name}</strong>
                </span>
              )}
          {langSwitch && (
            <button className="icon-btn source-btn" tabIndex={-1} onClick={switchVersion} disabled={!!altPending} title={langSwitch.toLeg ? 'Ver a versão legendada (continua deste ponto)' : 'Voltar para a versão dublada (continua deste ponto)'}>
              {altPending ? <span className="spinner sm" /> : <Icon name="cc" />} <span>{langSwitch.toLeg ? 'Legendado' : 'Dublado'}</span>
            </button>
          )}
          {isLive && (
            <button className="icon-btn source-btn" tabIndex={-1} onClick={findOtherSource} title="Buscar outra fonte deste canal (sem áudio, travando ou com problema)">
              <Icon name="refresh" /> <span>Outra fonte</span>
            </button>
          )}
          {isLive && (
            <button className="icon-btn" tabIndex={-1} onClick={() => togglePanel('list')} title="Lista de canais (◀)">
              <Icon name="list" />
            </button>
          )}
          <button className="icon-btn" tabIndex={-1} onClick={() => togglePanel('info')} title="Informações (OK / Info)">
            <Icon name="info" />
          </button>
          <button className="icon-btn" tabIndex={-1} onClick={() => openMenu(item)} title="Opções (Menu)">
            <Icon name="more" />
          </button>
          {canCast && (
            <button className={`icon-btn ${casting ? 'on' : ''}`} tabIndex={-1} onClick={() => (casting ? stopCast() : setCastPick(true))} title={casting ? 'Parar transmissão' : 'Transmitir para a TV (Chromecast)'}>
              <Icon name="cast" />
            </button>
          )}
          <button className="icon-btn" tabIndex={-1} onClick={isTouch ? rotate : toggleFs} title={isTouch ? 'Girar a tela' : 'Tela cheia (f)'}>
            <Icon name="fullscreen" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Legendas de filmes e séries que vêm junto com o vídeo (faixas de legenda do HLS/MP4), desenhadas
// pelo app: amarelas, centralizadas, a 40 px da base e das laterais, em fonte arredondada do próprio
// aparelho (nenhuma fonte é baixada). Legenda "queimada" na imagem (versão Legendada) não passa por aqui.
function Subtitles({ videoRef, itemId }) {
  const [text, setText] = useState('');
  useEffect(() => {
    const v = videoRef.current;
    if (!v?.textTracks) return;
    let track = null;
    const onCue = () => {
      const cues = track?.activeCues;
      setText(cues && cues.length ? Array.from(cues).map((c) => c.text || '').join('\n') : '');
    };
    const pick = () => {
      const list = Array.from(v.textTracks).filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
      const best = list.find((t) => /^pt/i.test(t.language || '') || /portug/i.test(t.label || '')) || list[0] || null;
      for (const t of list) if (t !== best && t.mode !== 'disabled') t.mode = 'disabled';
      // O app desenha a legenda; o navegador (ou o hls.js) só entrega o texto.
      if (best && best.mode !== 'hidden') best.mode = 'hidden';
      if (best === track) return;
      if (track) track.removeEventListener('cuechange', onCue);
      track = best;
      if (track) track.addEventListener('cuechange', onCue);
      onCue();
    };
    pick();
    v.textTracks.addEventListener?.('addtrack', pick);
    v.textTracks.addEventListener?.('change', pick);
    return () => {
      v.textTracks.removeEventListener?.('addtrack', pick);
      v.textTracks.removeEventListener?.('change', pick);
      if (track) track.removeEventListener('cuechange', onCue);
      setText('');
    };
  }, [videoRef, itemId]);
  if (!text) return null;
  // Tira marcações das legendas (<i>, <b>, {\an8}…), mantendo as quebras de linha.
  const lines = text.replace(/<[^>]+>|\{[^}]*\}/g, '').split(/\n|\\N/).filter((l) => l.trim());
  return (
    <div className="subtitles" aria-live="off">
      {lines.map((l, i) => (
        <span key={i}>{l}</span>
      ))}
    </div>
  );
}

function LiveBanner({ item, guide, now, age, expanded, onDetails }) {
  const { now: cur, next, list } = guide;
  return (
    <div className={`live-banner ${expanded ? 'expanded' : ''}`}>
      <div className="lb-head">
        <span className="lb-num">{item.num}</span>
        <div className="lb-logo">
          <Thumb src={item.logo} name={item.name} contain />
        </div>
        <div className="lb-ch">
          <strong>{item.name}</strong>
          <span>{item.group}</span>
        </div>
        <span className="lb-clock">{fmtTime(now)}</span>
      </div>
      {cur ? (
        <div className="lb-now">
          <div className="lb-title">
            <small>AGORA</small>
            <strong>{cur.title}</strong>
            <RatingBadge age={age} />
            <span className="muted">
              {fmtTime(cur.start)} – {fmtTime(cur.stop)}
            </span>
          </div>
          <div className="lb-progress">
            <span style={{ width: `${progressOf(cur, now) * 100}%` }} />
          </div>
          {expanded && cur.subtitle && <p className="lb-sub">{cur.subtitle}</p>}
          {expanded && <p className="lb-desc">{cur.desc || 'Sem descrição para este programa.'}</p>}
          {expanded && cur.category && <small className="muted">{cur.category}</small>}
        </div>
      ) : (
        <div className="lb-now muted">Sem informações de programação (EPG) para este canal.</div>
      )}
      {next && (
        <div className="lb-next">
          <small>A SEGUIR</small> {fmtTime(next.start)} · {next.title}
        </div>
      )}
      {!expanded && isTvMode() && <div className="lb-hint">OK lista de canais · ▶ informações · ▲▼ trocar de canal</div>}
      {expanded && list.length > 2 && (
        <ul className="lb-list">
          {list.slice(2).map((p) => (
            <li key={p.start}>
              <span>{fmtTime(p.start)}</span> {p.title}
            </li>
          ))}
        </ul>
      )}
      {expanded && (
        <div className="lb-actions">
          {cur && (
            <button className="btn" tabIndex={-1} onClick={onDetails}>
              <Icon name="info" size={18} /> Mais detalhes, elenco e trailer
            </button>
          )}
          <span className="muted hint">OK detalhes · ◀ lista de canais · ▲▼ trocar canal · Voltar fecha</span>
        </div>
      )}
    </div>
  );
}

function VodInfo({ item, meta, age }) {
  const d = meta.data;
  return (
    <div className="live-banner expanded vod-info">
      <div className="lb-title">
        <strong>{item.series?.name || item.name}</strong>
        <RatingBadge age={age} />
        {d?.year && <span className="muted">{d.year}</span>}
        {d?.genres?.length > 0 && <span className="muted">{d.genres.slice(0, 3).join(' · ')}</span>}
      </div>
      {item.series && (
        <p className="lb-sub">
          Temporada {item.series.season}, episódio {item.series.episode}
          {item.series.title && ` — ${item.series.title}`}
        </p>
      )}
      <p className="lb-desc">{d?.overview || (meta.enabled ? (meta.loading ? 'Carregando…' : 'Sem sinopse.') : item.group)}</p>
      {d?.cast?.length > 0 && (
        <p className="muted">
          <strong>Elenco:</strong> {d.cast.slice(0, 6).map((c) => c.name).join(', ')}
        </p>
      )}
      <span className="muted hint">◀ ▶ volta/avança 10s · OK pausa · Voltar fecha</span>
    </div>
  );
}

// Lista completa (a troca rápida tem algumas centenas de canais no máximo), com o nome do
// grupo como título de seção.
function ChannelList({ queue, sel, currentId, onPick, programmesFor, now, labels }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.querySelector('.cl-row.sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  return (
    <div className="channel-list" ref={ref}>
      <div className="cl-head">
        Canais <small>{queue.length}</small>
      </div>
      {queue.map((c, i) => {
        const p = findNow(programmesFor(c), now);
        const label = labels?.get(c.id);
        const showLabel = label && label !== labels.get(queue[i - 1]?.id);
        return (
          <Fragment key={c.id}>
          {showLabel && <div className="cl-section">{label}</div>}
          <button
            tabIndex={-1}
            className={`cl-row ${i === sel ? 'sel' : ''} ${c.id === currentId ? 'current' : ''}`}
            onClick={() => onPick(c)}
          >
            <span className="cl-num">{c.num}</span>
            <div className="cl-logo">
              <Thumb src={c.logo} name={c.name} contain />
            </div>
            <div className="cl-info">
              <strong>{c.name}</strong>
              <span>{p?.title || c.group}</span>
            </div>
            {p && (
              <div className="cl-progress">
                <span style={{ width: `${progressOf(p, now) * 100}%` }} />
              </div>
            )}
          </button>
          </Fragment>
        );
      })}
    </div>
  );
}
