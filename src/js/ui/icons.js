// Inline SVG icons (24×24, stroke-based, currentColor).
const svg = (body) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  home: svg('<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/>'),
  fit: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><path d="M8 15c2-6 6-6 8 0" />'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  table: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M12 4v16"/>'),
  backspace: svg('<path d="M21 5H9l-6 7 6 7h12z"/><path d="M17 9l-5 6M12 9l5 6"/>'),
  left: svg('<path d="M15 6l-6 6 6 6"/>'),
  right: svg('<path d="M9 6l6 6-6 6"/>'),
  enter: svg('<path d="M20 5v7a3 3 0 0 1-3 3H5"/><path d="M9 11l-4 4 4 4"/>'),
  help: svg('<circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.3a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.4-2.7 4.2"/><path d="M12 17.6h.01"/>'),
  hideKeypad: svg('<path d="M6 9l6 6 6-6"/>'),
  keyboard: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  warning: svg('<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.01"/>'),
  analyse: svg('<path d="M3 20c3-1 5-7 8-11s6-5 10-5"/><path d="M4 13l16-6" stroke-dasharray="2 3"/><circle cx="11" cy="9.6" r="1.6" fill="currentColor"/>'),
  play: svg('<path d="M7 5l12 7-12 7z"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
};
