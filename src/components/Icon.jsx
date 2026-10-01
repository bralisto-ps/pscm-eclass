const PATHS = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  book: 'M4 19V5a2 2 0 012-2h14v16H6a2 2 0 00-2 2zM8 7h8',
  clipboard: 'M9 3h6v4H9zM7 5H5v16h14V5h-2M9 13h6M9 17h4',
  quiz: 'M4 4h16v16H4zM8 12l3 3 5-6',
  chart: 'M5 20V11M12 20V4M19 20v-6',
  megaphone: 'M3 10v4h4l6 4V6l-6 4zM17 9a4 4 0 010 6',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  users: 'M9 12a4 4 0 100-8 4 4 0 000 8zM2 21c0-4 3-6 7-6s7 2 7 6M16 4a4 4 0 010 8M22 21c0-3-2-5-4-6',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  file: 'M6 3h8l5 5v13H6zM14 3v5h5',
  video: 'M3 6h13v12H3zM16 10l5-3v10l-5-3',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  edit: 'M4 20h4L20 8l-4-4L4 16z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  clock: 'M12 21a8 8 0 100-16 8 8 0 000 16zM12 9v4l2 2M9 2h6',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12M18 6L6 18',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  flag: 'M5 21V4h11l-2 4 2 4H5',
  key: 'M14 10a4 4 0 11-1.2-2.8L21 15v3h-3v-2h-2v-2l-3.2-3.2',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 .5-1.5-1L15 4h-6l-.5 2.5-1.5 1L5 7l-2 4 2 1-.1 1.5L3 15l2 4 2-.5 1.5 1L9 22h6l.5-2.5 1.5-1 2 .5 2-4-2-1.5z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  calendar: 'M4 5h16v16H4zM4 10h16M9 3v4M15 3v4',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 2h6l1-2h5',
};

export default function Icon({ name, size = 18, strokeWidth = 2, className, style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
    >
      <path d={PATHS[name] || PATHS.file} />
    </svg>
  );
}
