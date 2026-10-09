// Two players: select two trucks, race with autopilot, results, shop for both players, next race.
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = process.env.GAME_ROOT, OUT = process.argv[2] || '.';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0])); fs.readFile(f.endsWith('/') ? f + 'index.html' : f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); }); });
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const logs = [];
page.on('console', (m) => { if (['error'].includes(m.type()) && !m.text().includes('404')) logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message + '\n' + e.stack));
await page.goto(`http://localhost:${server.address().port}/index.html?q=low&autopilot=1&laps=1&warp=4`);
const state = () => page.evaluate(() => window.__game && window.__game.state);
const waitState = async (s, ms = 240000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await state(); if (v === s || (Array.isArray(s) && s.includes(v))) return v; await page.waitForTimeout(500); } throw new Error('timeout waiting ' + s + ' got ' + await state()); };
const shot = (n) => { console.log('stage', n); return page.screenshot({ path: `${OUT}/p2_${n}.png`, timeout: 180000 }); };
try {
  await waitState('title', 90000);
  await page.keyboard.press('Enter'); await waitState('menu');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  await page.keyboard.press('Enter'); await page.waitForTimeout(400); // difficulty: PILOTO
  await page.keyboard.press('Enter'); await page.waitForTimeout(400); await shot('1select2');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await waitState('race', 120000); await page.waitForTimeout(2000); await shot('2race');
  await waitState('results', 300000); await shot('3results');
  await page.keyboard.press('Enter'); await waitState('shop'); await shot('4shop1');
  await page.keyboard.press('Escape'); await page.waitForTimeout(600); await shot('5shop2');
  const who = await page.evaluate(() => document.querySelector('#shop .who')?.textContent);
  console.log('second shop:', who);
  await page.keyboard.press('Escape'); await waitState(['intro', 'race']);
  const info = await page.evaluate(() => window.__game.session.players.map((p) => ({ t: p.truckId, m: p.money, c: p.credits })));
  console.log('OK', JSON.stringify(info));
} catch (e) { console.log('FAIL', e.message); await shot('fail'); }
console.log(logs.slice(0, 20).join('\n'));
await browser.close(); server.close();
