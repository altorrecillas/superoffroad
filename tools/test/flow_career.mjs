// Career: a race is counted (races, km, tracks), achievements unlock with a banner,
// the LOGROS screen lists them with progress, and everything survives a reload.
// Usage: GAME_ROOT=<dir> node flow_career.mjs [outDir] [W H mobile]
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
const ctx = await browser.newContext({ viewport: { width: +W, height: +H }, isMobile: MOB === '1', hasTouch: MOB === '1' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
let ok = true;
const check = (c, what) => { console.log((c ? '  ok   ' : '  FAIL ') + what); if (!c) ok = false; };
const state = () => page.evaluate(() => window.__game && window.__game.state);
const waitState = async (s, ms = 240000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await state(); if (v === s || (Array.isArray(s) && s.includes(v))) return v; await page.waitForTimeout(400); } throw new Error('timeout waiting ' + s + ' got ' + await state()); };
const base = `http://localhost:${server.address().port}/index.html?q=low&laps=1&warp=4&autopilot=1&nofade=1`;
try {
  await page.goto(base);
  await waitState('title', 120000);
  await page.evaluate(() => { const g = window.__game; g.toMenu(); g.startChampionship([{ truckId: 'blue', vehicle: 'buggy' }], 'normal'); });
  await waitState(['intro', 'race']);
  await page.evaluate(() => { const g = window.__game; if (g.introT != null) g.introT = g.introHold; });
  await waitState('results', 300000);
  const st = await page.evaluate(() => { const g = window.__game; return { stats: g.career.stats, got: Object.keys(g.career.got), place: g.lastSummary.players[0].place }; });
  check(st.stats.races === 1 && st.stats.km > 0.2 && st.stats.tracks.length === 1, `the race is counted (races ${st.stats.races}, ${st.stats.km.toFixed(2)} km, track ${st.stats.tracks[0]}, place ${st.place})`);
  check(st.place !== 1 || st.got.includes('win1'), `a win unlocks "Primera victoria" (${st.got.join(', ') || 'none yet'})`);
  // an unlock shows the banner
  await page.evaluate(() => window.__game.career.unlock('photo'));
  // banners come one after another: wait for this one
  const toast = await (await page.waitForFunction(() => [...document.querySelectorAll('.ach-toast')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()).find((x) => /Fotógrafo/.test(x)) || null, null, { timeout: 40000, polling: 100 })).jsonValue();
  await page.screenshot({ path: `${OUT}/career_toast.png` });
  check(/LOGRO DESBLOQUEADO/.test(toast) && /Fotógrafo/.test(toast), `the banner announces it (${toast})`);
  // the screen
  await page.evaluate(() => { const g = window.__game; g.ui.hideAll(); g.toTitle(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const g = window.__game; g.toMenu(); });
  const menuVal = await page.evaluate(() => document.querySelector('#menu [data-a=ach] .val').textContent);
  check(/^\d+\/26$/.test(menuVal), `the menu shows the count (${menuVal})`);
  await page.click('#menu [data-a=ach]');
  await page.waitForSelector('#achievements .ach', { timeout: 5000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/career_screen_${W}x${H}.png` });
  const scr = await page.evaluate(() => ({ cards: document.querySelectorAll('#achievements .ach').length, got: document.querySelectorAll('#achievements .ach.got').length, bars: document.querySelectorAll('#achievements .ach u').length, km: [...document.querySelectorAll('#achievements .ach-stats div')].map((d) => d.textContent.replace(/\s+/g, ' ').trim()).join(' | ') }));
  check(scr.cards === 26 && scr.got >= 1 && scr.bars >= 3, `LOGROS lists all 26 (${scr.got} unlocked, ${scr.bars} progress bars)`);
  console.log('       stats:', scr.km);
  // kept after a reload
  await page.reload();
  await waitState('title', 120000);
  const after = await page.evaluate(() => ({ races: window.__game.career.stats.races, photo: window.__game.career.has('photo') }));
  check(after.races === 1 && after.photo, 'kept in the browser after reloading');
} catch (e) { check(false, 'flow: ' + e.message); }
check(!errors.length, 'no errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(ok ? 'CAREER OK' : 'CAREER FAIL');
await browser.close(); server.close();
