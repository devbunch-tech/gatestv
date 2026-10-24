// Memória de cada tela visitada (por entrada do histórico): posição da rolagem, fileiras
// roladas para o lado, quantos itens já tinham sido carregados e o card clicado. Ao voltar
// (botão Voltar / "Voltar" do controle), a tela reabre exatamente onde estava.
import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';

const mem = new Map();
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex="0"], [data-longpress]';
const MAX = 60; // telas lembradas

export function pageMem(key) {
  let m = mem.get(key);
  if (!m) {
    m = { y: 0, tracks: [], focusId: null, state: {} };
    mem.set(key, m);
    if (mem.size > MAX) mem.delete(mem.keys().next().value);
  }
  return m;
}

// useState que sobrevive à ida e volta para a tela (ex.: quantos itens da grade já estavam
// carregados), para que a página volte com a mesma altura e a rolagem caia no mesmo lugar.
export function useRestoredState(name, initial) {
  const { key } = useLocation();
  const m = pageMem(key);
  const [value, setValue] = useState(() => (name in m.state ? m.state[name] : initial));
  const set = useCallback(
    (next) =>
      setValue((prev) => {
        const v = typeof next === 'function' ? next(prev) : next;
        m.state[name] = v;
        return v;
      }),
    [m, name]
  );
  return [value, set];
}

// Guarda o que é preciso para voltar ao mesmo ponto (chamado ao clicar em algo da tela).
export function snapshot(key, main) {
  if (!main) return;
  const m = pageMem(key);
  m.y = main.scrollTop;
  m.tracks = [...main.querySelectorAll('.row-track, .featured-track, .live-groups, .season-tabs')].map((t) => t.scrollLeft);
  // Item clicado/focado: pelo id do card, pelo link ou pela posição entre os itens da tela.
  const el = document.activeElement && main.contains(document.activeElement) ? document.activeElement : null;
  m.focusId = el?.closest?.('[data-longpress]')?.dataset.longpress || null;
  m.focusHref = el?.closest?.('a[href]')?.getAttribute('href') || null;
  m.focusIndex = el ? [...main.querySelectorAll(FOCUSABLE)].indexOf(el) : -1;
}

// Restaura a rolagem; tenta por até ~1,5 s enquanto a tela termina de montar (imagens, listas).
export function restore(key, main, { focus } = {}) {
  const m = mem.get(key);
  if (!main || !m) return false;
  let tries = 0;
  const step = () => {
    [...main.querySelectorAll('.row-track, .featured-track, .live-groups, .season-tabs')].forEach((t, i) => {
      if (m.tracks[i]) t.scrollLeft = m.tracks[i];
    });
    main.scrollTo({ top: m.y, behavior: 'instant' });
    if (Math.abs(main.scrollTop - m.y) > 2 && tries++ < 50) return setTimeout(step, 30);
    // TV: volta o foco para o card que tinha sido aberto (sem mexer na rolagem).
    if (focus) {
      const el =
        (m.focusId && main.querySelector(`[data-longpress="${CSS.escape(m.focusId)}"]`)) ||
        (m.focusHref && main.querySelector(`a[href="${CSS.escape(m.focusHref)}"]`)) ||
        (m.focusIndex >= 0 && main.querySelectorAll(FOCUSABLE)[m.focusIndex]);
      if (el) el.focus({ preventScroll: true });
    }
  };
  step();
  return true;
}

export const hasMemory = (key) => mem.has(key);
