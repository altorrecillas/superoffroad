// Free race: menu -> CARRERA LIBRE -> pick a Track Pak circuit, reverse, night -> truck -> race -> results -> other circuit.
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
const shot = (n) => { console.log('stage', n); return page.screenshot({ path: `${OUT}/free_${n}.png`, timeout: 180000 }); };
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(120); } };
try {
  await waitState('title', 90000);
  await key('Enter'); await waitState('menu');
  await key('ArrowDown', 3); await key('Enter'); await waitState('free');
  // the grid has 4 or 8 columns depending on the screen: pick by identity
  const pick = async (sel) => { await page.click(sel); await page.waitForTimeout(250); };
  await pick('.tcard[data-id=volcano]');                       // Volcano Valley
  // keyboard from the cards: down lands on the buttons row (spatial navigation)
  await key('ArrowDown');
  const onBtn = await page.evaluate(() => document.querySelector('#free .focus')?.dataset.a || null);
  if (!onBtn) throw new Error('down from the last cards did not reach the buttons');
  await pick('#free [data-a=dir]');                            // reverse
  for (let k = 0; k < 3; k++) await pick('#free [data-a=time]'); // day -> sunset -> night
  await shot('1picker');
  await pick('#free [data-a=go]');                             // ELEGIR VEHÍCULO
  await page.waitForTimeout(400); await key('Enter');
  await waitState('race', 120000); await page.waitForTimeout(1500); await shot('2race');
  const info = await page.evaluate(() => { const g = window.__game; return { track: g.world.track.id, rev: g.world.track.reverse, time: g.world.timeName }; });
  console.log('race on', JSON.stringify(info));
  await waitState('results', 300000); await shot('3results');
  await key('ArrowDown'); await key('Enter'); await waitState('free', 60000); await shot('4back');
  console.log('OK');
} catch (e) { console.log('FAIL', e.message); await shot('fail'); }
console.log(logs.slice(0, 20).join('\n'));
await browser.close(); server.close();
