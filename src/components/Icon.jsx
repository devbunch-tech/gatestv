const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  tv: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm4 15h8M8 2l4 4 4-4',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4',
  series: 'M3 7h14v12H3zM7 3h14v12M5 5h14',
  heart: 'M12 20s-7-4.4-9.2-9A5 5 0 0 1 12 6a5 5 0 0 1 9.2 5C19 15.6 12 20 12 20z',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm10 17-5-5',
  settings:
    'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm7.4 4.5 1.8 1.4-2 3.4-2.1-.8a7.6 7.6 0 0 1-1.7 1l-.3 2.3h-4l-.3-2.3a7.6 7.6 0 0 1-1.7-1l-2.1.8-2-3.4 1.8-1.4a7.7 7.7 0 0 1 0-2L2.8 9.1l2-3.4 2.1.8a7.6 7.6 0 0 1 1.7-1L8.9 3h4l.3 2.3a7.6 7.6 0 0 1 1.7 1l2.1-.8 2 3.4-1.8 1.4a7.7 7.7 0 0 1 0 2z',
  play: 'M7 4.5v15l13-7.5z',
  pause: 'M7 4h3.5v16H7zM13.5 4H17v16h-3.5z',
  back: 'M15 5l-7 7 7 7',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-right': 'M9 5l7 7-7 7',
  volume: 'M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12',
  mute: 'M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6',
  fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  prev: 'M6 5v14M19 5 9 12l10 7z',
  next: 'M18 5v14M5 5l10 7-10 7z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  close: 'M6 6l12 12M18 6 6 18',
  menu: 'M4 6h16M4 12h16M4 18h16',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  info: 'M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20zM12 11v6M12 7.5v.01',
  cc: 'M3 5h18v14H3zM10.5 10a2.5 2.5 0 1 0 0 4M17 10a2.5 2.5 0 1 0 0 4',
  cast: 'M2 8V5h20v14h-7M2 12a9 9 0 0 1 9 9M2 16a5 5 0 0 1 5 5M2 20.5h.01',
  lock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  unlock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2',
  eye: 'M3 12s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6zm9-3a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  'eye-off': 'M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a16 16 0 0 1-3 3.4M6.6 6.6C4.3 8.2 3 12 3 12s4 6 9 6a8.9 8.9 0 0 0 4.4-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2',
  more: 'M10.4 5.6a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M10.4 12a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M10.4 18.4a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  guide: 'M3 5h18v14H3zM3 10h18M9 10v9',
  remote: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 5.5v.01M9.5 9h5M12 6.5v5',
};

const FILLED = new Set(['play', 'pause', 'prev', 'next', 'more', 'star']);

export default function Icon({ name, size = 20, filled, className }) {
  const fill = filled ?? FILLED.has(name);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={fill ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
