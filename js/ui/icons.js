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

// the touch control schemes (options)
export const CTRL_ICONS = {
  buttons: svg('<rect x="1.5" y="7" width="9" height="10" rx="2.5"/><rect x="13.5" y="7" width="9" height="10" rx="2.5"/><path d="M7.2 9.5 4.8 12l2.4 2.5M16.8 9.5l2.4 2.5-2.4 2.5"/>'),
  stick: svg('<circle cx="12" cy="12" r="9.5"/><circle cx="14.5" cy="9.5" r="3.6" fill="currentColor"/><path d="M12 12l1.2-1.2" stroke-width="1.6"/>'),
  tilt: svg('<g transform="rotate(-20 12 12)"><rect x="3" y="8" width="18" height="9" rx="2"/><path d="M18.4 10.6v3.8"/></g><path d="M4.5 4.5a10 10 0 0 1 6-2.4M19.5 19.5a10 10 0 0 1-6 2.4"/><path d="M8.6 1.2l2 .9-.9 2M15.4 22.8l-2-.9.9-2"/>'),
};

// achievement emblems
export const ACH_ICONS = {
  trophy: svg('<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/><path d="M12 14v4M8 20h8"/>'),
  cup: svg('<path d="M6 3h12v6a6 6 0 0 1-12 0z"/><path d="M6 5H3v1.5A3.5 3.5 0 0 0 6 10M18 5h3v1.5a3.5 3.5 0 0 1-3 3.5"/><path d="M12 15v3M7 21h10M9 18h6"/><path d="M12 5.5l.9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3z" fill="currentColor" stroke="none"/>'),
  podium: svg('<path d="M9 9h6v12H9zM3 13h6v8H3zM15 15h6v6h-6z"/><path d="M12 3.5l.8 1.6 1.7.2-1.2 1.2.3 1.7-1.6-.8-1.6.8.3-1.7-1.2-1.2 1.7-.2z" fill="currentColor" stroke="none"/>'),
  flame: svg('<path d="M12 21c-4 0-6.5-2.6-6.5-6 0-3.8 3.5-5.5 3.5-9.5 2.5 1.5 4 4 4 6 1-1 1.5-2.2 1.5-3.5 2.2 1.7 4 4.2 4 7 0 3.4-2.5 6-6.5 6z"/>'),
  rise: svg('<path d="M3 18l6-6 4 4 7-8"/><path d="M14 8h6v6"/>'),
  nonitro: svg('<rect x="8" y="6" width="8" height="15" rx="2"/><path d="M10 6V3h4v3"/><path d="M4 4l16 16"/>'),
  shield: svg('<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
  jump: svg('<path d="M2 20h7l4-5"/><path d="M15 20h7"/><path d="M8 11c2-5 8-7 12-4"/><path d="M17 4.5L20 7l-3.2 1.6"/>'),
  money: svg('<path d="M9 4h6l-2 3h-2z"/><path d="M11 7C6 9 4 13 4 16a5 5 0 0 0 5 5h6a5 5 0 0 0 5-5c0-3-2-7-7-9"/><path d="M12 11v7M14 12.5c-.5-.6-1.2-.9-2-.9-1.1 0-2 .6-2 1.4 0 2 4 1.1 4 3.1 0 .8-.9 1.4-2 1.4-.9 0-1.6-.3-2.1-.9"/>'),
  wrench: svg('<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5a4 4 0 0 0-5-5l2.5 2.5-1 2-2 1z"/>'),
  buggy: svg('<path d="M3 15h18M6 15l2-6h7l3 6"/><path d="M9 9l1-3h3"/><circle cx="7" cy="17" r="2.5"/><circle cx="17" cy="17" r="2.5"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  helmet: svg('<path d="M4 15a8 8 0 0 1 16 0v2H4z"/><path d="M12 9v8M4 17h16v2H4z"/><path d="M14 12h6"/>'),
  coin: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/><path d="M12 9.5v5"/>'),
  medal: svg('<path d="M8 3l3 6M16 3l-3 6"/><circle cx="12" cy="15" r="6"/><path d="M12 12l.9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3z" fill="currentColor" stroke="none"/>'),
  map: svg('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  road: svg('<path d="M9 3L5 21M15 3l4 18"/><path d="M12 5v2.5M12 11v2.5M12 17v3"/>'),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.6"/>'),
  film: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>'),
  people: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.6"/><path d="M15 14.5a5 5 0 0 1 6.5 4.5"/>'),
};
