// Super Off Road · Remastered — entry point.
import { Game } from './game/game.js';

window.__booting = true; // (index.html: the code did start)
const game = new Game();
window.__game = game;

// the browser offers to install the game as an app (Chrome on Android and desktop):
// keep the offer for the INSTALAR button of the main menu
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); game.installPrompt = e; });
window.addEventListener('appinstalled', () => { game.installPrompt = null; });

game.boot().then(() => {
  // offline play: the service worker keeps every file the game has just used.
  // Needs https (or localhost); automated test browsers skip it unless ?sw=1.
  const q = new URLSearchParams(location.search);
  if (!('serviceWorker' in navigator) || !window.isSecureContext || (navigator.webdriver && !q.has('sw')) || q.has('nosw')) return;
  navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).then((reg) => {
    const urls = performance.getEntriesByType('resource').map((r) => r.name)
      .filter((u) => u.startsWith(location.origin) && !/\/assets\/music\//.test(u));
    urls.push(new URL('./', location.href).href, new URL('./index.html', location.href).href);
    if (reg.active) reg.active.postMessage({ type: 'cache', urls: [...new Set(urls.map((u) => u.split('#')[0]))] });
  }).catch(() => { /* no offline mode */ });
}).catch((e) => {
  console.error(e);
  const l = document.querySelector('#loading .hint');
  const msg = e && e.message ? e.message : String(e);
  // (no 3D at all: say what to do, not the browser's technical message)
  if (l) l.textContent = /webgl|context/i.test(msg)
    ? 'Este navegador no puede mostrar gráficos 3D (WebGL). Actualízalo, prueba con Chrome o Safari, o activa la aceleración por hardware en sus ajustes.'
    : 'Error al cargar: ' + msg + '. Recarga la página.';
});
