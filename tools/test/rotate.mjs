// Rotation and app-switch checks on a phone, in Chrome (chromium) or Safari (webkit):
//  - turning the phone upright mid-race: "rotate" notice, race paused, 3D stops drawing
//  - turning it back: notice gone, pause menu fits, the race resumes with pad and HUD
//  - leaving the app (page hidden): the race pauses
//  - menus re-fit after rotating
// Usage: GAME_ROOT=<dir> node rotate.mjs [chromium|webkit] outPrefix
import { chromium, webkit } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = process.env.GAME_ROOT;
const [ENG = 'chromium', PRE = 'rot'] = process.argv.slice(2);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
await new Promise((r) => server.listen(0, r));
const engine = ENG === 'webkit' ? webkit : chromium;
const browser = await engine.launch(ENG === 'webkit' ? {} : { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 780, height: 360 }, isMobile: ENG !== 'webkit' ? true : undefined, hasTouch: true,
  userAgent: ENG === 'webkit' ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' : undefined });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
let ok = true;
const check = (cond, what) => { console.log((cond ? '  ok   ' : '  FAIL ') + what); if (!cond) ok = false; };
await page.goto(`http://localhost:${server.address().port}/index.html?q=low&nofade=1`);
await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 180000 });
await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; }' });
await page.evaluate(() => { const g = window.__game; g.toMenu(); g.startChampionship([{ truckId: 'red', vehicle: 'truck' }], 'normal'); g.introT = g.introHold; });
await page.waitForFunction(() => window.__game.state === 'race', null, { timeout: 120000 });
await page.waitForTimeout(3000);
console.log(ENG);

// 1. upright
const f0 = await page.evaluate(() => window.__game.view.renderer.info.render.frame);
await page.setViewportSize({ width: 360, height: 780 });
await page.waitForTimeout(2500);
const up = await page.evaluate(() => ({ rotate: getComputedStyle(document.getElementById('rotate')).display, paused: window.__game.paused, frame: window.__game.view.renderer.info.render.frame }));
check(up.rotate === 'flex', 'upright: the "turn your phone" notice shows');
check(up.paused, 'upright: the race pauses');
const f1 = up.frame;
await page.waitForTimeout(1500);
const f2 = await page.evaluate(() => window.__game.view.renderer.info.render.frame);
check(f2 - f1 <= 1, `upright: the 3D view stops drawing (${f2 - f1} frames in 1.5 s)`);
await page.screenshot({ path: `${PRE}_${ENG}_1upright.png` });

// 2. back to landscape
await page.setViewportSize({ width: 780, height: 360 });
await page.waitForTimeout(2500);
const back = await page.evaluate(() => {
  const p = document.querySelector('#pause .panel'), r = p && p.getBoundingClientRect();
  return { rotate: getComputedStyle(document.getElementById('rotate')).display, pause: !!p, fits: !!r && r.top >= -1 && r.bottom <= innerHeight + 1, frame: window.__game.view.renderer.info.render.frame };
});
check(back.rotate === 'none', 'landscape again: the notice is gone');
check(back.pause && back.fits, 'landscape again: the pause menu is there and fits');
await page.screenshot({ path: `${PRE}_${ENG}_2back.png` });
await page.evaluate(() => document.querySelector('#pause [data-a=resume]').click());
await page.waitForTimeout(2500);
const run = await page.evaluate(() => {
  const g = window.__game, t = g.race.racers.find((r) => r.human).truck;
  return { paused: g.paused, state: g.state, time: g.race.time, pad: getComputedStyle(document.getElementById('touch')).display, board: !!document.querySelector('#hud .hud-board'), frame: g.view.renderer.info.render.frame };
});
check(!run.paused && run.state === 'race', 'the race resumes');
check(run.pad === 'block', 'the touch pad is back');
check(run.board, 'the HUD is back');
check(run.frame > back.frame, 'the 3D view draws again');
await page.screenshot({ path: `${PRE}_${ENG}_3resumed.png` });

// 3. switching apps
const hid = await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  return { paused: window.__game.paused };
});
check(hid.paused, 'leaving the app pauses the race');
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
});

// a tap on a button puts Chrome in fullscreen (Safari on iPhone has no fullscreen API)
const full = await page.evaluate(() => !!document.fullscreenElement);
if (ENG === 'chromium') check(full, 'the tap on CONTINUAR put the game in fullscreen');
if (full) { await page.evaluate(() => document.exitFullscreen()); await page.waitForTimeout(800); }

// 4. menus re-fit after rotation
await page.evaluate(() => { const g = window.__game; g.opt.fullscreen = false; g.resume(); g.toTitle(); g.toMenu(); g.ui.hide('menu'); g.toOptions(() => {}); });
await page.waitForTimeout(800);
await page.setViewportSize({ width: 360, height: 780 });
await page.waitForTimeout(800);
await page.setViewportSize({ width: 700, height: 320 });
await page.waitForTimeout(1500);
const fit = await page.evaluate(() => { const p = document.querySelector('#options .panel'), r = p.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: innerHeight, scroll: p.scrollHeight > p.clientHeight + 2, scale: p.style.scale }; });
check(fit.top >= -1 && fit.bottom <= fit.h + 1 && !fit.scroll, `options re-fit after rotating to a smaller screen (scale ${fit.scale || 1}, ${fit.top}..${fit.bottom} of ${fit.h})`);
await page.screenshot({ path: `${PRE}_${ENG}_4options.png` });
check(!errors.length, 'no errors' + (errors.length ? ':\n' + [...new Set(errors)].slice(0, 8).join('\n') : ''));
console.log(ok ? 'ROTATE OK' : 'ROTATE FAIL');
await browser.close(); server.close();
