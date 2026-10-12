// Daily challenge: the menu button opens today's card (circuit, direction, light,
// vehicle, twist); Ironman's medal times arrive from a worker without freezing the
// page; a run of it is a time trial with today's rules, and its best is kept for the day.
// Usage: GAME_ROOT=<dir> node flow_daily.mjs [outDir] [W H mobile]
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
const waitState = async (s, ms = 300000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await state(); if (v === s || (Array.isArray(s) && s.includes(v))) return v; await page.waitForTimeout(400); } throw new Error('timeout waiting ' + s + ' got ' + await state()); };
try {
  await page.goto(`http://localhost:${server.address().port}/index.html?q=low&warp=4&autopilot=1&nofade=1`);
  await waitState('title', 120000);
  await page.evaluate(() => window.__game.toMenu());
  await page.click('#menu [data-a=daily]');
  await page.waitForSelector('#daily .daily-track', { timeout: 10000 });
  const card = await page.evaluate(() => ({ track: document.querySelector('#daily .daily-track').textContent, chips: [...document.querySelectorAll('#daily .chips span')].map((e) => e.textContent) }));
  check(card.track && card.chips.length === 4, `today: ${card.track} · ${card.chips.join(' · ')}`);
  await page.waitForSelector('#daily .daily-medals .mt', { timeout: 60000 });
  const times = await page.evaluate(() => [...document.querySelectorAll('#daily .daily-medals .mt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  check(times.length === 3, `Ironman's medal times arrived from the worker: ${times.join(' | ')}`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/daily_${W}x${H}.png`, timeout: 180000 });
  await page.click('#daily [data-a=go]');
  await waitState(['intro', 'race'], 120000);
  const run = await page.evaluate(() => { const g = window.__game, f = g.session.free, me = g.race.racers.find((r) => r.human); return { daily: f.daily, laps: g.race.laps, nitros: me.truck.nitros, veh: me.entry.vehicle, trial: !!g.trial, key: g.trial.key }; });
  check(run.daily && run.trial && /^daily-/.test(run.key), `a time trial with today's rules (${run.laps} laps, ${run.nitros} nitros, ${run.veh})`);
  await page.evaluate(() => { const g = window.__game; if (g.introT != null) g.introT = g.introHold; });
  await waitState('results', 600000);
  const res = await page.evaluate(() => ({ head: document.querySelector('#results .head').textContent, saved: JSON.parse(localStorage.getItem('sor.daily.v1') || '{}') }));
  const day = Object.values(res.saved.days || {})[0];
  check(/DESAFÍO DEL DÍA/.test(res.head) && day && day.t > 5, `results of the daily run, today's best kept (${day && day.t.toFixed(2)} s${day && day.m ? ', ' + day.m : ''})`);
} catch (e) { check(false, 'flow: ' + e.message); await page.screenshot({ path: `${OUT}/daily_fail.png` }).catch(() => {}); }
check(!errors.length, 'no errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(ok ? 'DAILY OK' : 'DAILY FAIL');
await browser.close(); server.close();
