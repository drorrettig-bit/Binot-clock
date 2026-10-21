type P = React.SVGProps<SVGSVGElement>;
const base = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const LogoIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={1.8} aria-hidden="true" {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
export const InIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={2.2} aria-hidden="true" {...p}>
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l-5-5 5-5M5 12h11" />
  </svg>
);
export const OutIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={2.2} aria-hidden="true" {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M14 7l5 5-5 5M19 12H8" />
  </svg>
);
export const LogoutIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={2} aria-hidden="true" {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </svg>
);
export const CheckIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={3} aria-hidden="true" {...p}>
    <path d="M5 12l5 5L20 7" />
  </svg>
);
export const XIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={3} aria-hidden="true" {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const PinIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={2} aria-hidden="true" {...p}>
    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </svg>
);
export const ChartIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={2} aria-hidden="true" {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);
export const DownloadIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={2} aria-hidden="true" {...p}>
    <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />
  </svg>
);
export const BackIcon = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={2} aria-hidden="true" {...p}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);
