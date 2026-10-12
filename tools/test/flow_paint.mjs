// Paint shop: in Ironman's garage the PINTURA item opens the paint jobs; locked ones
// cannot be chosen, won ones paint the truck on the turntable and in the next race
// (body colour of the race model, the ground ring and the HUD tag), and are kept.
// Usage: GAME_ROOT=<dir> node flow_paint.mjs [outDir] [W H mobile]
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = process.env.GAME_ROOT;
const OUT = process.argv[2] || '.';
const [W = 960, H = 540, MOB = '0'] = process.argv.slice(3);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f.endsWith('/') ? f + 'index.html' : f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: +W, height: +H }, isMobile: MOB === '1', hasTouch: MOB === '1' })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
let ok = true;
const check = (c, what) => { console.log((c ? '  ok   ' : '  FAIL ') + what); if (!c) ok = false; };
const state = () => page.evaluate(() => window.__game && window.__game.state);
const waitState = async (s, ms = 240000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await state(); if (v === s || (Array.isArray(s) && s.includes(v))) return v; await page.waitForTimeout(400); } throw new Error('timeout waiting ' + s + ' got ' + await state()); };
try {
  await page.goto(`http://localhost:${server.address().port}/index.html?q=low&nofade=1`);
  await waitState('title', 120000);
  await page.evaluate(() => { const g = window.__game; g.career.unlock('win1'); g.toMenu(); g.startChampionship([{ truckId: 'blue', vehicle: 'truck' }], 'normal'); });
  await waitState(['intro', 'race']);
  await page.evaluate(() => { const g = window.__game; g.introT = null; g.state = 'post'; g.ui.hideAll(); g.hud.destroy(); g.toShop(0); });
  await waitState('shop', 20000);
  await page.click('#shop .item[data-k=paint]');
  await page.waitForSelector('#paint .sw-l', { timeout: 5000 });
  const sw = await page.evaluate(() => ({ n: document.querySelectorAll('#paint .sw-l').length, locked: document.querySelectorAll('#paint .sw-l.locked').length }));
  check(sw.n === 14 && sw.locked === 12, `14 paint jobs, 12 still locked (${sw.locked})`);
  await page.click('#paint .sw-l[data-id=gold]');
  const lockedPick = await page.evaluate(() => window.__game.session.players[0].livery);
  check(lockedPick === 'team', 'a locked paint job cannot be chosen');
  await page.click('#paint .sw-l[data-id=carbon]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/paint_${W}x${H}.png` });
  const pick = await page.evaluate(() => { const g = window.__game; let col = null; g.garage.truck.root.traverse((o) => { if (o.isMesh && !col) { const m = Array.isArray(o.material) ? o.material : [o.material]; const p = m.find((x) => /^Paint/.test(x.name || '')); if (p) col = p.color.getHexString(); } }); return { liv: g.session.players[0].livery, saved: g.opt.liveries && g.opt.liveries[0], col }; });
  check(pick.liv === 'carbon' && pick.saved === 'carbon', `Carbono chosen and kept (${pick.saved})`);
  check(pick.col && pick.col !== '1747c4', `the truck on the turntable is repainted (#${pick.col})`);
  await page.click('#paint [data-k=back]');
  await page.waitForSelector('#shop .item[data-k=paint]', { timeout: 5000 });
  const label = await page.evaluate(() => document.querySelector('#shop .item[data-k=paint] .pr').textContent);
  check(/CARBONO/.test(label), `the shop shows the paint job (${label})`);
  // next race
  await page.click('#shop .item[data-k=done]');
  await waitState(['intro', 'race'], 60000);
  const race = await page.evaluate(() => { const g = window.__game, me = g.race.racers.find((r) => r.human); let col = null; g.world.views[me.i].root.traverse((o) => { if (o.isMesh && !col) { const m = Array.isArray(o.material) ? o.material : [o.material]; const p = m.find((x) => /^Paint/.test(x.name || '')); if (p) col = p.color.getHexString(); } }); return { liv: me.entry.livery, col, ring: g.world.rings[me.i].material.uniforms.color.value.getHexString() }; });
  check(race.liv === 'carbon' && race.col === race.ring, `the race truck and its ground ring wear it (#${race.col})`);
} catch (e) { check(false, 'flow: ' + e.message); await page.screenshot({ path: `${OUT}/paint_fail.png` }).catch(() => {}); }
check(!errors.length, 'no errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(ok ? 'PAINT OK' : 'PAINT FAIL');
await browser.close(); server.close();
