// Super Off Road · Remastered — entry point.
import { Game } from './game/game.js';

const game = new Game();
window.__game = game;
game.boot().catch((e) => {
  console.error(e);
  const l = document.querySelector('#loading .hint');
  if (l) l.textContent = 'Error al cargar: ' + (e && e.message ? e.message : e);
});
