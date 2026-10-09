// Buggy flow test: menu -> select (↓ picks the buggy) -> race (autopilot) -> results -> shop.
// Checks the race racer, the 3D model and the shop label all use the buggy.
// Usage: GAME_ROOT=<dir> node flow_buggy.mjs [outDir]
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = process.env.GAME_ROOT;
const OUT = process.argv[2] || '.';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f.endsWith('/') ? f + 'index.html' : f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('404')) logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message + '\n' + e.stack));
await page.goto(`http://localhost:${server.address().port}/index.html?q=low&autopilot=1&laps=1&warp=4`);
const state = () => page.evaluate(() => window.__game && window.__game.state);
const waitState = async (s, ms = 120000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await state(); if (v === s || (Array.isArray(s) && s.includes(v))) return v; await page.waitForTimeout(500); } throw new Error('timeout waiting ' + s + ' got ' + await state()); };
const shot = (n) => { console.log('stage', n, new Date().toISOString().slice(11, 19)); return page.screenshot({ path: `${OUT}/flowb_${n}.png`, timeout: 180000 }); };
let ok = true;
const check = (cond, what) => { if (!cond) { ok = false; console.log('CHECK FAILED:', what); } };
try {
  await waitState('title', 90000);
  await page.keyboard.press('Enter'); await waitState('menu');
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  await page.keyboard.press('Enter'); await page.waitForTimeout(400); // difficulty: PILOTO
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300); await shot('1select');
  const tab = await page.evaluate(() => document.querySelector('#select .vtab.on')?.dataset.v);
  check(tab === 'buggy', `select tab is ${tab}`);
  await page.keyboard.press('Enter');
  await waitState('intro'); await waitState('race', 120000);
  // minimap: hidden with the classic camera, shown with the close one
  const map = await page.evaluate(async () => {
    const g = window.__game, el = document.querySelector('#hud .hud-map');
    g.warp = 0.2; // keep the race running while we look
    const before = el && el.style.display;
    g.world.setCamera('zoom', { index: g.race.racers.find((x) => x.human).i, zoom: 0.52 });
    // software rendering can be very slow: wait for a few HUD updates, not a fixed time
    for (let k = 0; k < 60 && el.style.display === 'none'; k++) await new Promise((r) => setTimeout(r, 250));
    const after = el && el.style.display;
    g.world.setCamera('classic', { snap: true });
    g.warp = 4;
    return { exists: !!el, before, after, state: g.state };
  });
  check(map.exists && map.before === 'none' && map.after === '', 'minimap ' + JSON.stringify(map));
  await page.waitForTimeout(1000); await shot('2race');
  const race = await page.evaluate(() => {
    const g = window.__game, r = g.race.racers.find((x) => x.human);
    return { vehicle: r.entry.vehicle, kind: r.truck.stats.kind, mass: r.truck.stats.mass, view: g.world.views[r.i].kind };
  });
  check(race.vehicle === 'buggy' && race.kind === 'buggy' && race.view === 'buggy', 'race racer ' + JSON.stringify(race));
  // lap records (autopilot laps do not count, so feed two human laps directly)
  const rec = await page.evaluate(() => {
    const g = window.__game, r = g.race.racers.find((x) => x.human);
    g.race.autopilot = false;
    g._lapDone(['lap', r.i, 1, 31.5]);
    const first = document.querySelectorAll('.toast').length;
    g._lapDone(['lap', r.i, 2, 30.25]);
    g._lapDone(['lap', r.i, 3, 33]);
    g.race.autopilot = true;
    const all = JSON.parse(localStorage.getItem('sor.laps.v1'));
    const key = g.race.track.id + (g.race.track.reverse ? '-r' : '');
    return { key, rec: all[key], first, toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent) };
  });
  check(rec.rec && rec.rec.t === 30.25 && rec.rec.v === 'buggy' && rec.toasts.some((t) => /Récord de vuelta/.test(t)), 'lap record ' + JSON.stringify(rec));
  await waitState('results', 240000); await shot('3results');
  const laprec = await page.evaluate(() => document.querySelector('#results .laprec')?.textContent || '');
  check(/30\.25/.test(laprec) && /BUGGY/.test(laprec), 'results record line: ' + laprec);
  await page.keyboard.press('Enter'); await waitState('shop'); await page.waitForTimeout(500); await shot('4shop');
  const shop = await page.evaluate(() => ({ who: document.querySelector('#shop .who')?.textContent, kind: window.__game.garage.truck.kind }));
  check(/BUGGY/.test(shop.who) && shop.kind === 'buggy', 'shop ' + JSON.stringify(shop));
  await page.keyboard.press('Escape'); await waitState(['intro', 'race']);
  const again = await page.evaluate(() => window.__game.race.racers.find((x) => x.human).entry.vehicle);
  check(again === 'buggy', 'second race vehicle ' + again);
  console.log(ok ? 'OK' : 'FAIL', JSON.stringify({ race, shop, again }));
} catch (e) { console.log('FAIL', e.message); await shot('fail'); }
console.log(logs.slice(0, 20).join('\n'));
await browser.close(); server.close();
