// Line icons for the replay and photo controls (inline SVG, they take the text colour).

const svg = (body, fill = false) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  replay: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M10 8.5v7l5.5-3.5z" fill="currentColor" stroke="none"/>'),
  play: svg('<path d="M7 4.5v15l12.5-7.5z"/>', true),
  pause: svg('<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>', true),
  restart: svg('<path d="M5 5v14"/><path d="M19 5.5v13l-10-6.5z" fill="currentColor"/>'),
  back: svg('<path d="M11 6l-6 6 6 6"/><path d="M19 6l-6 6 6 6"/>'),
  fwd: svg('<path d="M13 6l6 6-6 6"/><path d="M5 6l6 6-6 6"/>'),
  cam: svg('<rect x="2.5" y="6.5" width="13" height="11" rx="2"/><path d="M15.5 10.5l6-3.5v10l-6-3.5z"/>'),
  photo: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.6"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  prev: svg('<path d="M15 5l-7 7 7 7"/>'),
  next: svg('<path d="M9 5l7 7-7 7"/>'),
  share: svg('<path d="M12 3v12"/><path d="M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v8h14v-8"/>'),
  save: svg('<path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/>'),
  lens: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>'),
  filter: svg('<circle cx="9" cy="10" r="5.5"/><circle cx="15" cy="10" r="5.5"/><circle cx="12" cy="15" r="5.5"/>'),
};
