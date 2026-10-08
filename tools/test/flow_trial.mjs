// Time trial flow: free race -> MODO CONTRARRELOJ -> run (autopilot) -> the run is
// saved as a ghost -> OTRA VEZ -> the ghost races alongside -> results with the gap.
// Usage: GAME_ROOT=<dir> node flow_trial.mjs [outDir]
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
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message + '\n' + e.stack));
await page.goto(`http://localhost:${server.address().port}/index.html?q=low&autopilot=1&laps=2&warp=4`);
const state = () => page.evaluate(() => window.__game && window.__game.state);
const waitState = async (s, ms = 120000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await state(); if (v === s || (Array.isArray(s) && s.includes(v))) return v; await page.waitForTimeout(400); } throw new Error('timeout waiting ' + s + ' got ' + await state()); };
const shot = (n) => page.screenshot({ path: `${OUT}/trial_${n}.png`, timeout: 180000 });
let ok = true;
const check = (cond, what) => { console.log((cond ? '  ok   ' : '  FAIL ') + what); if (!cond) ok = false; };
try {
  await waitState('title', 90000);
  await page.keyboard.press('Enter'); await waitState('menu');
  await page.click('#menu [data-a=free]'); await waitState('free');
  await page.click('#free [data-a=mode]'); await page.waitForTimeout(300);
  const head = await page.evaluate(() => document.querySelector('#free .head').textContent);
  check(/CONTRARRELOJ/.test(head), 'the free race screen switches to CONTRARRELOJ');
  await page.click('#free .tcard[data-id=cutoff]'); await page.waitForTimeout(250);
  await page.click('#free [data-a=go]'); await page.waitForTimeout(400);
  await page.keyboard.press('Enter'); // red truck
  await waitState('intro'); await shot('1intro');
  const first = await page.evaluate(() => { const g = window.__game; return { racers: g.race.racers.length, pickups: g.race.pickupsOn, laps: g.race.laps, ghost: !!g.world.ghost, panel: !!document.querySelector('#hud .hud-me.trial') }; });
  check(first.racers === 1 && !first.pickups, `alone on the track, no pickups (${first.racers} truck)`);
  check(!first.ghost, 'no ghost the first time');
  check(first.panel, 'the time trial panel is in the HUD');
  await waitState('results', 300000); await page.waitForTimeout(600); await shot('2results');
  const saved = await page.evaluate(() => { const all = JSON.parse(localStorage.getItem('sor.ghosts.v1') || '{}'); const k = Object.keys(all)[0]; return k ? { k, t: all[k].t, n: all[k].s.length / 4, laps: all[k].laps } : null; });
  check(saved && saved.n > 100 && saved.laps.length === 2, `the run is saved as a ghost (${saved && saved.k}: ${saved && saved.t.toFixed(2)} s, ${saved && saved.n} samples)`);
  const verdict1 = await page.evaluate(() => document.querySelector('#results .verdict').textContent.trim().replace(/\s+/g, ' '));
  console.log('       verdict 1:', verdict1);
  // again, with the ghost
  await page.click('#results [data-a=again]');
  await waitState('intro', 60000);
  const second = await page.evaluate(() => { const g = window.__game; return { ghost: !!g.world.ghost, rec: document.querySelector('#hud .hud-me.trial')?.textContent.replace(/\s+/g, ' ') }; });
  check(second.ghost, 'the second run has the ghost');
  await waitState('race', 120000);
  let seen = false;
  for (let k = 0; k < 40 && !seen; k++) { seen = await page.evaluate(() => { const g = window.__game; return !!(g.world.ghost && g.world.ghost.v.root.visible && g.race.time > 1); }); if (!seen) await page.waitForTimeout(500); }
  check(seen, 'the ghost drives during the race');
  await shot('3ghost');
  await waitState('results', 300000); await page.waitForTimeout(600); await shot('4results');
  const res2 = await page.evaluate(() => ({ rows: document.querySelectorAll('#results .table.trial .place').length, verdict: document.querySelector('#results .verdict').textContent.trim().replace(/\s+/g, ' ') }));
  check(res2.rows === 2, 'results list both laps with the gap to the record');
  console.log('       verdict 2:', res2.verdict);
  console.log(ok ? 'TRIAL OK' : 'TRIAL FAIL');
} catch (e) { console.log('FAIL', e.message); await shot('fail'); }
if (logs.length) console.log(logs.slice(0, 10).join('\n'));
await browser.close(); server.close();
