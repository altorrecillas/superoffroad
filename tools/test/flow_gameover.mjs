// Game over flow: one credit, weak autopilot, arcade difficulty -> lose -> initials -> scores -> continue screen.
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
await page.goto(`http://localhost:${server.address().port}/index.html?q=low&autopilot=1&apskill=-1&laps=1&warp=4&credits=1`);
const state = () => page.evaluate(() => window.__game && window.__game.state);
const waitState = async (s, ms = 240000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await state(); if (v === s || (Array.isArray(s) && s.includes(v))) return v; await page.waitForTimeout(500); } throw new Error('timeout waiting ' + s + ' got ' + await state()); };
const shot = (n) => { console.log('stage', n); return page.screenshot({ path: `${OUT}/go_${n}.png`, timeout: 180000 }); };
try {
  await waitState('title', 90000);
  await page.keyboard.press('Enter'); await waitState('menu');
  // difficulty -> arcade
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await waitState('race', 120000);
  await waitState('results', 300000); await shot('1results');
  await page.keyboard.press('Enter');
  const st = await waitState(['gameover', 'shop'], 60000);
  console.log('after results:', st);
  await page.waitForTimeout(1000); await shot('2after');
  if (await page.$('#initials')) {
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    await page.waitForTimeout(800); await shot('3scores');
    await page.keyboard.press('Enter'); await page.waitForTimeout(800); await shot('4continue');
  }
  const scores = await page.evaluate(() => localStorage.getItem('sor.highscores.v1'));
  console.log('OK scores', scores);
} catch (e) { console.log('FAIL', e.message); await shot('fail'); }
console.log(logs.slice(0, 20).join('\n'));
await browser.close(); server.close();
