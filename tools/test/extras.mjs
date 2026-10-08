import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = process.env.GAME_ROOT, OUT = process.argv[2];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); }); });
await new Promise((r) => server.listen(0, r));
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 800, height: 360 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', (e) => errors.push(e.message));
let ok = true; const check = (c, w) => { console.log((c ? '  ok   ' : '  FAIL ') + w); if (!c) ok = false; };
await p.goto(`http://localhost:${server.address().port}/index.html?q=low&nofade=1`);
await p.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 180000 });
await p.touchscreen.tap(400, 180); await p.waitForTimeout(800);           // a real tap: menu + history entry
await p.evaluate(() => { const g = window.__game; g.opt.fullscreen = false; document.fullscreenElement && document.exitFullscreen(); });
// back in the menu: back to the title, still in the game
await p.goBack(); await p.waitForTimeout(800);
let st = await p.evaluate(() => ({ url: location.pathname, state: window.__game && window.__game.state }));
check(st.state === 'title' && /index\.html/.test(st.url), `back in the menu returns to the title, the page stays (${st.state})`);
// a race: back pauses it
await p.touchscreen.tap(400, 180); await p.waitForTimeout(500);
await p.evaluate(() => { const g = window.__game; g.opt.touchSide = 'left'; g.startChampionship([{ truckId: 'red', vehicle: 'buggy' }], 'normal'); g.introT = g.introHold; });
await p.waitForFunction(() => window.__game.state === 'race', null, { timeout: 120000 });
await p.waitForTimeout(1500);
await p.touchscreen.tap(400, 120); await p.waitForTimeout(300);            // arms the trap again
await p.goBack(); await p.waitForTimeout(800);
st = await p.evaluate(() => ({ state: window.__game.state, paused: window.__game.paused, pause: !!document.querySelector('#pause') }));
check(st.state === 'race' && st.paused && st.pause, 'back during a race pauses it (does not leave the game)');
await p.evaluate(() => document.querySelector('#pause [data-a=resume]').click()); await p.waitForTimeout(600);
// left-handed pad: steering on the right, gas on the left
const pad = await p.evaluate(() => {
  const r = (sel) => { const e = document.querySelectorAll('#touch .tbtn'); return [...e].map((x) => ({ c: x.className, l: Math.round(x.getBoundingClientRect().left) })); };
  return r();
});
const steer = pad.filter((x) => /steer/.test(x.c)).map((x) => x.l), gas = pad.find((x) => /gas/.test(x.c));
check(gas && steer.every((l) => l > gas.l), `left-handed: gas on the left (${gas && gas.l}), steering on the right (${steer})`);
// nitro: speed streaks while it lasts (after the green light)
await p.waitForFunction(() => window.__game.race.state === 'race' && window.__game.race.time > 0.5, null, { timeout: 120000, polling: 300 });
await p.evaluate(() => { const g = window.__game, t = g.race.racers.find((r) => r.human).truck; t.nitros = 5; g.input.players[0].nitroLatch = true; });
await p.waitForTimeout(700);
console.log('debug', await p.evaluate(() => { const g = window.__game, r = g.race.racers.find((x) => x.human); return JSON.stringify({ nitroT: r.truck.nitroT, nitros: r.truck.nitros, fx: !!document.querySelector('#hud .speedfx'), cls: document.querySelector('#hud .speedfx') && document.querySelector('#hud .speedfx').className, me: !!g.hud.me, boostOn: g.hud.boostOn, state: g.race.state, paused: g.paused, gstate: g.state }); }));
const fx = await p.waitForFunction(() => document.querySelector('#hud .speedfx').classList.contains('on'), null, { timeout: 5000, polling: 50 }).then(() => true, () => false);
check(fx, 'nitro shows the speed streaks');
await p.screenshot({ path: OUT, timeout: 120000 });
check(!errors.length, 'no errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
console.log(ok ? 'EXTRAS OK' : 'EXTRAS FAIL');
await b.close(); server.close();
