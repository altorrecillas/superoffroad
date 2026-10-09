// End-to-end flow test: title -> menu -> select -> race (autopilot) -> results -> shop -> next race.
// Usage: GAME_ROOT=<dir> node flow.mjs [outDir]
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
const shot = (n) => { console.log('stage', n, new Date().toISOString().slice(11, 19)); return page.screenshot({ path: `${OUT}/flow_${n}.png`, timeout: 180000 }); };
try {
  await waitState('title', 90000); await shot('1title');
  await page.keyboard.press('Enter'); await waitState('menu'); await shot('2menu');
  await page.keyboard.press('Enter'); await page.waitForTimeout(400); await shot('3diff'); // difficulty: PILOTO
  await page.keyboard.press('Enter'); await page.waitForTimeout(400); await shot('3select');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await waitState('intro'); await page.waitForTimeout(1500); await shot('4intro');
  await waitState('race', 120000); await page.waitForTimeout(2500); await shot('5race');
  await waitState('results', 240000); await shot('6results');
  await page.keyboard.press('Enter'); await waitState('shop'); await shot('7shop');
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(200); }
  await shot('8shop_bought');
  await page.keyboard.press('Escape'); await waitState(['intro', 'race']); await page.waitForTimeout(1000); await shot('9race2');
  const info = await page.evaluate(() => { const g = window.__game; const p = g.session.players[0]; return { race: g.session.raceNo, money: p.money, up: p.upgrades, credits: p.credits, nitros: p.nitros }; });
  console.log('OK', JSON.stringify(info));
} catch (e) { console.log('FAIL', e.message); await shot('fail'); }
console.log(logs.slice(0, 20).join('\n'));
await browser.close(); server.close();
