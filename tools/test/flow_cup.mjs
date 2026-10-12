// Cups: the results show the cup standings; the fourth race of a cup ends with the
// podium ceremony (the three best trucks on the podium, trophy, bonus) and then the shop.
// Usage: GAME_ROOT=<dir> node flow_cup.mjs [outDir] [W H mobile]
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
  await page.goto(`http://localhost:${server.address().port}/index.html?q=low&laps=1&warp=4&autopilot=1&nofade=1`);
  await waitState('title', 120000);
  await page.evaluate(() => { const g = window.__game; g.toMenu(); g.startChampionship([{ truckId: 'red', vehicle: 'truck' }], 'normal'); });
  await waitState(['intro', 'race']);
  const banner = await page.evaluate(() => document.querySelector('#intro .race')?.textContent || '');
  check(/COPA DEL POLVO · CARRERA 1\/4/.test(banner), `the intro names the cup (${banner})`);
  // jump to the last race of the cup
  await page.evaluate(() => { const g = window.__game; g.session.cup.race = 3; g.session.cup.points = { red: 24, blue: 18, yellow: 12, grey: 26 }; if (g.introT != null) g.introT = g.introHold; });
  await waitState('results', 300000);
  await page.waitForTimeout(500);
  const res = await page.evaluate(() => ({ head: document.querySelector('#results .head').textContent, chips: document.querySelectorAll('#results .cupstand .cs').length, strip: document.querySelector('#results .cupstand')?.textContent.replace(/\s+/g, ' ').trim() }));
  check(/COPA DEL POLVO · CARRERA 4\/4/.test(res.head) && res.chips === 4, `results show the cup (${res.head}) and its standings: ${res.strip}`);
  await page.screenshot({ path: `${OUT}/cup_results_${W}x${H}.png` });
  await page.click('#results [data-a=cont]');
  await waitState('podium', 30000);
  // the camera moves in on the winner and the panel comes in (ceremony time, not wall time:
  // software rendering runs it in slow motion)
  await page.waitForFunction(() => window.__game.podium && window.__game.podium.t > 6.5, null, { timeout: 180000, polling: 250 });
  await page.screenshot({ path: `${OUT}/cup_podium_${W}x${H}.png`, timeout: 120000 });
  const pod = await page.evaluate(() => { const g = window.__game; return { trucks: g.podium.trucks.length, won: document.querySelector('#podium .cup-won')?.textContent.replace(/\s+/g, ' ').trim(), next: g.session.cup.no, money: g.session.players[0].money, rows: document.querySelectorAll('#podium .table.cup .place').length }; });
  check(pod.trucks === 3 && pod.rows === 4, `three trucks on the podium, four in the table (${pod.won})`);
  check(pod.next === 1, 'the next cup starts');
  await page.click('#podium .btn');
  await waitState(['shop', 'gameover'], 30000);
  check(true, 'CONTINUAR goes on to the shop');
} catch (e) { check(false, 'flow: ' + e.message); await page.screenshot({ path: `${OUT}/cup_fail.png` }).catch(() => {}); }
check(!errors.length, 'no errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(ok ? 'CUP OK' : 'CUP FAIL');
await browser.close(); server.close();
