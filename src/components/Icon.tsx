/** Inline stroke icons (no icon font or external file). Decorative: always hidden from assistive technology. */
const PATHS = {
  lock: ['M5 13a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z', 'M8 11V8a4 4 0 0 1 8 0v3'],
  shield: ['M12 3l7.5 3v5.5c0 4.6-3.1 8.3-7.5 9.9-4.4-1.6-7.5-5.3-7.5-9.9V6z', 'M8.8 12.2l2.2 2.2 4.3-4.4'],
  upload: ['M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5', 'M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4'],
  sheet: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M8.5 12.5h7M8.5 16.5h7M12 12.5v4'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  checkCircle: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'M8 12.5l2.8 2.8L16 10'],
  alert: ['M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z', 'M12 9.5v4', 'M12 17.2h.01'],
  xCircle: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'M15 9l-6 6M9 9l6 6'],
  info: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'M12 11v5.5', 'M12 7.8h.01'],
  reconciliation: ['M4 6.5l1.6 1.6L8.5 5.2', 'M4 12.5l1.6 1.6 2.9-2.9', 'M4 18.5l1.6 1.6 2.9-2.9', 'M11.5 7h8.5M11.5 13h8.5M11.5 19h8.5'],
  panel: [
    'M4 5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 10 5v6.5A1.5 1.5 0 0 1 8.5 13h-3A1.5 1.5 0 0 1 4 11.5z',
    'M14 5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 20 5v2a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 14 7z',
    'M14 13.5a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 14 19z',
    'M4 17.5A1.5 1.5 0 0 1 5.5 16h3a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 4 19z',
  ],
  table: ['M3.5 6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z', 'M3.5 9.5h17M3.5 15h17M9.5 4v16'],
  justify: ['M20.5 12a8.5 8.5 0 0 1-12.3 7.6L3.5 20.5l1.1-4.4A8.5 8.5 0 1 1 20.5 12z', 'M8.5 10.5h7M8.5 14h4.5'],
  download: ['M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5', 'M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1'],
  sliders: [
    'M4 6h9M19 6h1M4 12h3M11 12h9M4 18h11M19 18h1',
    'M18 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM11 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM19 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  ],
  help: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.7v.3', 'M12 17h.01'],
  sun: [
    'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
    'M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
  ],
  moon: ['M20 14.6A8.2 8.2 0 1 1 9.4 4a6.6 6.6 0 0 0 10.6 10.6z'],
  power: ['M12 3.5v8', 'M6.6 6.6a7.6 7.6 0 1 0 10.8 0'],
  plus: ['M12 5v14M5 12h14'],
  arrowUp: ['M12 19V5M6.5 10.5 12 5l5.5 5.5'],
  arrowDown: ['M12 5v14M6.5 13.5 12 19l5.5-5.5'],
  arrowRight: ['M5 12h14M13 6l6 6-6 6'],
  trash: ['M4 7h16', 'M10 11v6M14 11v6', 'M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12', 'M9 7V4.5h6V7'],
  search: ['M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0z', 'M20 20l-4-4'],
  chevronDown: ['M6 9l6 6 6-6'],
  chevronRight: ['M9 6l6 6-6 6'],
  refresh: ['M20 11a8 8 0 0 0-14.9-3.5M4 4v4h4', 'M4 13a8 8 0 0 0 14.9 3.5M20 20v-4h-4'],
  x: ['M6 6l12 12M18 6 6 18'],
  clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'M12 7v5l3.2 2'],
  activity: ['M3 12h4l3-7.5 4 15 3-7.5h4'],
  hash: ['M5 9h14M5 15h14M10.5 3.5l-2 17M15.5 3.5l-2 17'],
  database: [
    'M20 5.5c0 1.7-3.6 3-8 3s-8-1.3-8-3 3.6-3 8-3 8 1.3 8 3z',
    'M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13',
    'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  ],
  calendar: ['M3.5 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z', 'M3.5 10h17M8 3v4M16 3v4'],
  layers: ['M12 3.5 2.5 8.5l9.5 5 9.5-5z', 'M2.5 13l9.5 5 9.5-5', 'M2.5 17.5l9.5 5 9.5-5'],
  zap: ['M13 2.5 4.5 13.5h7l-1 8 8.5-11h-7z'],
  file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5'],
  copy: ['M9 11a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2z', 'M5 15a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2'],
  flag: ['M5 21V4', 'M5 4h12l-2.5 4 2.5 4H5'],
  filter: ['M3.5 5h17l-6.5 8v6l-4 1.5V13z'],
  pen: ['M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z', 'M13.5 6.5l4 4'],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className, strokeWidth = 1.8 }: { name: IconName; size?: number; className?: string | undefined; strokeWidth?: number }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

