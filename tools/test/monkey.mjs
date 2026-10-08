// UI monkey test: random key presses through every menu, race, shop and game
// over for a few minutes (autopilot races at high speed). Reports page errors,
// console errors and states the game never leaves.
// Usage: GAME_ROOT=<dir> node monkey.mjs [seconds=240] [seed=1]
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = process.env.GAME_ROOT;
const DURATION = +(process.argv[2] || 240) * 1000;
let seed = +(process.argv[3] || 1);
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f.endsWith('/') ? f + 'index.html' : f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 800, height: 450 } })).newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
await page.goto(`http://localhost:${server.address().port}/index.html?q=low&autopilot=1&laps=1&warp=6&credits=1`);
await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 120000 });
// key mix: menu navigation heavy, some pause/back/mute
const MENU = [['Enter', 30], ['ArrowDown', 14], ['ArrowUp', 10], ['ArrowLeft', 8], ['ArrowRight', 8], ['Escape', 6], ['KeyP', 2], ['KeyM', 2], ['Space', 4], ['KeyW', 3], ['KeyS', 3]];
const RACE = [['ArrowLeft', 20], ['ArrowRight', 20], ['ArrowUp', 20], ['Space', 10], ['KeyW', 10], ['Escape', 1], ['KeyP', 1], ['KeyM', 1]];
const PAUSED = [['Enter', 60], ['ArrowDown', 10], ['ArrowUp', 10], ['Escape', 20]];
const pick = (st) => {
  const keys = st.endsWith('+paused') ? PAUSED : st === 'race' || st === 'intro' ? RACE : MENU;
  const total = keys.reduce((s, k) => s + k[1], 0);
  let x = rnd() * total;
  for (const [k, w] of keys) { x -= w; if (x < 0) return k; }
  return 'Enter';
};
const t0 = Date.now();
const states = {};
let lastState = '', since = Date.now(), presses = 0, stuck = [];
while (Date.now() - t0 < DURATION) {
  const k = pick(lastState);
  await page.keyboard.press(k).catch(() => {});
  presses++;
  await page.waitForTimeout(80 + rnd() * 260);
  const st = await page.evaluate(() => window.__game && `${window.__game.state}${window.__game.paused ? '+paused' : ''}`).catch(() => 'evalerr');
  states[st] = (states[st] || 0) + 1;
  if (st !== lastState) { lastState = st; since = Date.now(); }
  // a menu state that lasts very long while we keep pressing keys is suspicious (races run on autopilot)
  if (Date.now() - since > 90000 && !st.startsWith('race')) { stuck.push(st); since = Date.now(); }
}
const g = await page.evaluate(() => ({ state: window.__game.state, raceNo: window.__game.session && window.__game.session.raceNo, screens: [...document.querySelectorAll('#ui .screen')].map((e) => e.id) }));
console.log('presses', presses, 'states', JSON.stringify(states));
console.log('final', JSON.stringify(g));
if (stuck.length) console.log('STUCK', stuck.join(', '));
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].slice(0, 15).join('\n') : 'no errors');
await browser.close(); server.close();
