// iPhone checks in WebKit (Safari's engine) with real iPhone profiles:
//  - loads with no errors, the "Add to Home Screen" tip shows in Safari
//  - pinch on the page is blocked (iOS gesture events, two-finger touches)
//  - pinch on the track zooms the race camera
//  - home-screen (standalone) mode with the notch insets: no tip, no fullscreen
//    option, touch pad and HUD clear of the notch
// Usage: GAME_ROOT=<dir> node ios.mjs "<device>" outPrefix [standalone]
import { webkit, devices } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = process.env.GAME_ROOT;
const [DEV = 'iPhone 15 landscape', PRE = 'ios', MODE = ''] = process.argv.slice(2);
const standalone = MODE === 'standalone';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
await new Promise((r) => server.listen(0, r));
const browser = await webkit.launch();
const dev = devices[DEV];
// home-screen app: no browser bars (full screen size) and the notch insets of a landscape iPhone
const viewport = standalone ? { width: Math.round(dev.viewport.width * 1.14), height: Math.round(dev.viewport.height * 1.15) } : dev.viewport;
const ctx = await browser.newContext({ ...dev, viewport });
if (standalone) {
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { get: () => true });
    const st = document.createElement('style');
    st.textContent = ':root{--safe-l:47px!important;--safe-r:47px!important;--safe-b:21px!important} div[style*="safe-area-inset"]{padding:0 47px 21px 47px!important}';
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
  });
}
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
let ok = true;
const check = (cond, what) => { console.log((cond ? '  ok   ' : '  FAIL ') + what); if (!cond) ok = false; };
await page.goto(`http://localhost:${server.address().port}/index.html?q=low`);
await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 180000 });
await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; }' });
console.log(`${DEV}${standalone ? ' (home screen)' : ''} ${viewport.width}x${viewport.height}`);
const tip = await page.evaluate(() => !!document.querySelector('.ios-tip'));
check(standalone ? !tip : tip, standalone ? 'no "Add to Home Screen" tip in the home-screen app' : 'Safari shows the "Add to Home Screen" tip');
await page.screenshot({ path: `${PRE}_1title.png` });

// pinch on the page: iOS sends gesture* events and two-finger touchmoves; all must be cancelled
const pinch = await page.evaluate(() => {
  const res = {};
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) {
    const ev = new Event(t, { bubbles: true, cancelable: true });
    ev.scale = 1.6;
    document.body.dispatchEvent(ev);
    res[t] = ev.defaultPrevented;
  }
  // (WebKit on Linux cannot construct Touch objects: an event that carries two touches)
  const tm = new Event('touchmove', { bubbles: true, cancelable: true });
  Object.defineProperty(tm, 'touches', { value: { length: 2 } });
  document.body.dispatchEvent(tm);
  res.twoFingerMove = tm.defaultPrevented;
  const one = new Event('touchmove', { bubbles: true, cancelable: true });
  Object.defineProperty(one, 'touches', { value: { length: 1 } });
  document.body.dispatchEvent(one);
  res.oneFingerFree = !one.defaultPrevented; // one finger must stay free (menus scroll)
  res.viewport = document.querySelector('meta[name=viewport]').content;
  res.bodyTouchAction = getComputedStyle(document.body).touchAction;
  res.scale = window.visualViewport ? window.visualViewport.scale : 1;
  return res;
});
check(pinch.gesturestart && pinch.gesturechange && pinch.gestureend, 'iOS pinch gesture events are cancelled (the page never zooms)');
check(pinch.twoFingerMove === true, 'two-finger touchmove is cancelled');
check(pinch.oneFingerFree === true, 'one-finger touchmove is left alone (scrolling panels keep working)');
check(pinch.bodyTouchAction === 'none', `page touch-action is none (${pinch.bodyTouchAction})`);
check(pinch.scale === 1, 'page scale stays at 1');

// sound: iOS only lets audio start inside a tap; a real tap on the title must unlock it
const before = await page.evaluate(() => window.__game.audio.ctx && window.__game.audio.ctx.state);
await page.touchscreen.tap(viewport.width / 2, viewport.height / 2);
await page.waitForTimeout(1200);
const snd = await page.evaluate(() => ({ state: window.__game.audio.ctx && window.__game.audio.ctx.state, game: window.__game.state, music: !!window.__game.audio.musicEl }));
check(snd.state === 'running', `a tap starts the sound (${before} -> ${snd.state})`);
check(snd.game === 'menu', 'the tap opens the menu');
check(snd.music, 'the music starts');

// fullscreen: iPhone Safari has no API, so no option and no broken requests
const fsOpt = await page.evaluate(() => { const g = window.__game; g.ui.hide('menu'); g.toOptions(() => {}); return !!document.querySelector('#options [data-k=fullscreen]'); });
check(!fsOpt, 'no PANTALLA COMPLETA option where the browser cannot do it');
await page.screenshot({ path: `${PRE}_2options.png` });

// screens fit
const fits = await page.evaluate(() => {
  const bad = [];
  for (const p of document.querySelectorAll('#ui .screen .panel')) { const r = p.getBoundingClientRect(); if (r.top < -1 || r.bottom > innerHeight + 1 || p.scrollHeight > p.clientHeight + 2) bad.push(p.closest('.screen').id); }
  return bad;
});
check(!fits.length, 'options panel fits whole' + (fits.length ? ' (' + fits.join(',') + ')' : ''));

// a race: pinch on the track zooms the camera
await page.evaluate(() => { const g = window.__game; g.ui.hide('options'); g.opt.camera = 'zoom'; g.opt.zoomLevel = 0.52; g.startChampionship([{ truckId: 'blue', vehicle: 'buggy' }], 'normal'); g.introT = g.introHold; });
await page.waitForFunction(() => window.__game.state === 'race', null, { timeout: 120000 });
await page.waitForTimeout(2500);
const z0 = await page.evaluate(() => window.__game.world.camOpts.zoom);
const pinchRace = await page.evaluate(async () => {
  const app = document.getElementById('app');
  const ev = (type, id, x, y) => app.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: id === 1 }));
  const cx = innerWidth / 2, cy = innerHeight / 2;
  ev('pointerdown', 1, cx - 40, cy); ev('pointerdown', 2, cx + 40, cy);
  for (let k = 1; k <= 10; k++) { ev('pointermove', 1, cx - 40 - k * 8, cy); ev('pointermove', 2, cx + 40 + k * 8, cy); }
  ev('pointerup', 1, cx - 120, cy); ev('pointerup', 2, cx + 120, cy);
  const zin = window.__game.world.camOpts.zoom;
  ev('pointerdown', 3, cx - 150, cy); ev('pointerdown', 4, cx + 150, cy);
  for (let k = 1; k <= 30; k++) { ev('pointermove', 3, cx - 150 + k * 4.5, cy); ev('pointermove', 4, cx + 150 - k * 4.5, cy); }
  ev('pointerup', 3, cx, cy); ev('pointerup', 4, cx, cy);
  return { zin, mode: window.__game.world.camMode, zout: window.__game.world.camOpts.zoom };
});
check(pinchRace.zin < z0, `spreading two fingers moves the camera in (${z0.toFixed(2)} -> ${pinchRace.zin.toFixed(2)})`);
check(pinchRace.mode === 'classic' || pinchRace.zout > pinchRace.zin, `pinching moves it out (${pinchRace.mode}, ${pinchRace.zout && pinchRace.zout.toFixed ? pinchRace.zout.toFixed(2) : pinchRace.zout})`);
await page.evaluate(() => { const g = window.__game; g.world.setCamera('zoom', { index: g.race.racers.find((r) => r.human).i, zoom: 0.52, snap: true }); });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${PRE}_3race.png` });

// touch pad and HUD clear of the notch / home bar
const clear = await page.evaluate(() => {
  const inset = { l: standaloneL(), r: standaloneR() };
  function standaloneL() { return navigator.standalone ? 47 : 0; }
  function standaloneR() { return navigator.standalone ? 47 : 0; }
  const out = [];
  for (const el of document.querySelectorAll('#touch .tbtn, #touch .tpause, #hud .hud-me, #hud .hud-board, #hud .hud-map')) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    if (r.left < inset.l - 0.5 || r.right > innerWidth - inset.r + 0.5 || r.bottom > innerHeight + 0.5) out.push(el.className + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']');
  }
  return out;
});
check(!clear.length, 'touch pad and HUD clear of the notch and screen edges' + (clear.length ? ': ' + clear.join(', ') : ''));
await page.evaluate(() => window.__game.pause());
await page.waitForTimeout(600);
await page.screenshot({ path: `${PRE}_4pause.png` });
check(!errors.length, 'no errors in Safari' + (errors.length ? ':\n' + [...new Set(errors)].slice(0, 8).join('\n') : ''));
console.log(ok ? 'IOS OK' : 'IOS FAIL');
await browser.close(); server.close();
