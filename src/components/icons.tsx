import type { SVGProps } from 'react';

const base: SVGProps<SVGSVGElement> = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

const icon = (d: string) => (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}>
    <path d={d} />
  </svg>
);

export const IconSidebar = icon('M4 4h16v16H4zM9 4v16');
export const IconUpload = icon('M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3');
export const IconDownload = icon('M12 4v12M7 11l5 5 5-5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3');
export const IconPlus = icon('M12 5v14M5 12h14');
export const IconMinus = icon('M5 12h14');
export const IconChevronUp = icon('M6 15l6-6 6 6');
export const IconChevronDown = icon('M6 9l6 6 6-6');
export const IconClose = icon('M6 6l12 12M18 6L6 18');
export const IconLock = icon('M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3');
export const IconAlert = icon('M12 8v5M12 16.5v.5M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z');
export const IconFile = icon('M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4');
export const IconEdit = icon('M4 20h4L19 9l-4-4L4 16zM14 6l4 4');
export const IconInfo = icon('M12 8v.5M12 11v5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z');
export const IconSave = icon('M5 4h11l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 4v5h7V4M8 20v-6h8v6');
export const IconMore = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props} fill="currentColor" stroke="none">
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </svg>
);
export const IconFitWidth = icon('M4 5v14M20 5v14M8 12h8M8 12l3-3M8 12l3 3M16 12l-3-3M16 12l-3 3');
