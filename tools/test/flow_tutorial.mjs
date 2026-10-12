// Tutorial: a first-time player pressing 1 JUGADOR is offered the guided lap; the steps
// (gas, steer, slow down, nitro, money bag, the lap) complete by driving (a bot presses
// the real keys), and at the end the difficulty screen opens; it is never asked again.
// Usage: GAME_ROOT=<dir> node flow_tutorial.mjs [outDir]
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = process.env.GAME_ROOT;
const OUT = process.argv[2] || '.';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f.endsWith('/') ? f + 'index.html' : f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
let ok = true;
const check = (c, what) => { console.log((c ? '  ok   ' : '  FAIL ') + what); if (!c) ok = false; };
const state = () => page.evaluate(() => window.__game && window.__game.state);
const waitState = async (s, ms = 300000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await state(); if (v === s || (Array.isArray(s) && s.includes(v))) return v; await page.waitForTimeout(400); } throw new Error('timeout waiting ' + s + ' got ' + await state()); };
try {
  await page.goto(`http://localhost:${server.address().port}/index.html?q=low&warp=2&nofade=1`);
  await waitState('title', 120000);
  await page.keyboard.press('Enter'); await waitState('menu');
  await page.keyboard.press('Enter'); // 1 JUGADOR
  await page.waitForSelector('#ask .btn', { timeout: 10000 });
  check(true, 'a first-time player is offered the tutorial');
  await page.keyboard.press('Enter'); // HACER EL TUTORIAL
  await waitState(['intro', 'race'], 60000);
  await page.evaluate(() => { const g = window.__game; if (g.introT != null) g.introT = g.introHold; });
  await waitState('race');
  // the bot: the racing line's brain pressing the arrow keys and space
  await page.evaluate(async () => {
    const g = window.__game;
    const { AIDriver } = await import('./js/sim/ai.js');
    const me = g.race.racers.find((r) => r.human);
    const brain = new AIDriver(me.truck, g.race.track, { skill: 0.8, aggression: 0.6, seed: 3 });
    let last = performance.now();
    const tick = (now) => {
      if (!g.tutorial) { for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']) g.input.down.delete(k); return; }
      const dt = Math.min(0.05, (now - last) / 1000) * g.warp; last = now;
      const a = brain.update(dt, g.race.trucks);
      const d = g.input.down, step = g.tutorial.step && g.tutorial.step.id;
      d.delete('ArrowLeft'); d.delete('ArrowRight');
      if (a.steer < -0.3) d.add('ArrowLeft'); else if (a.steer > 0.3) d.add('ArrowRight');
      // the slow-down step: lift off the gas and keep it lifted, like a player told to
      if (step === 'slow') { d.delete('ArrowUp'); d.delete('ArrowDown'); } else if (a.brake > 0.5) { d.delete('ArrowUp'); d.add('ArrowDown'); } else { d.add('ArrowUp'); d.delete('ArrowDown'); }
      if (step === 'nitro') g.input.players[0].nitroLatch = true;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 400000) {
    const st = await page.evaluate(() => { const g = window.__game; return { k: g.tutorial ? g.tutorial.k : -9, id: g.tutorial && g.tutorial.step ? g.tutorial.step.id : null, done: g.tutorial ? g.tutorial.done : true, state: g.state, diff: !!document.querySelector('#diff .dcard') }; });
    if (st.id && !seen.has(st.id)) { seen.add(st.id); console.log('       step', st.k + 1, st.id); if (st.id === 'pickup') await page.screenshot({ path: `${OUT}/tutorial_pickup.png`, timeout: 120000 }).catch(() => {}); }
    if (st.diff) break;
    await page.waitForTimeout(300);
  }
  check(['gas', 'steer', 'slow', 'nitro', 'pickup', 'lap'].every((x) => seen.has(x)), `all six steps done by driving (${[...seen].join(', ')})`);
  const end = await page.evaluate(() => ({ diff: !!document.querySelector('#diff .dcard'), done: window.__game.opt.tutorialDone, ach: window.__game.career.has('school') }));
  check(end.diff && end.done && end.ach, 'the difficulty screen follows; tutorial marked done (achievement "Escuela de pilotos")');
  await page.evaluate(() => { const g = window.__game; g.ui.hideAll(); g.toMenu(); });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  check(!(await page.$('#ask')) && !!(await page.$('#diff')), 'not asked again');
} catch (e) { check(false, 'flow: ' + e.message); await page.screenshot({ path: `${OUT}/tutorial_fail.png` }).catch(() => {}); }
check(!errors.length, 'no errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(ok ? 'TUTORIAL OK' : 'TUTORIAL FAIL');
await browser.close(); server.close();
