// Resource leak check: lets the attract mode cycle through circuits at high
// speed and records GPU geometries/textures, programs and the JS heap per race.
// Usage: GAME_ROOT=<dir> node leak.mjs [races=8]
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = process.env.GAME_ROOT;
const N = +(process.argv[2] || 8);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f.endsWith('/') ? f + 'index.html' : f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const page = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('404')) logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
await page.goto(`http://localhost:${server.address().port}/index.html?q=medium&warp=8`);
await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 120000 });
const sample = () => page.evaluate(() => {
  if (window.gc) window.gc();
  const g = window.__game, r = g.view.renderer;
  return { track: g.race && g.race.track.id, geo: r.info.memory.geometries, tex: r.info.memory.textures, prog: r.info.programs ? r.info.programs.length : 0,
    heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0, scene: g.view.scene.children.length };
});
const rows = [await sample()];
let last = await page.evaluate(() => window.__game.race);
for (let k = 0; k < N; k++) {
  // wait for the next attract race to start
  await page.waitForFunction(() => window.__game.race && window.__game.race !== window.__lastRace && window.__game.race.state !== 'done', null, { timeout: 300000, polling: 1000 }).catch(() => {});
  await page.evaluate(() => { window.__lastRace = window.__game.race; });
  await page.waitForTimeout(1500);
  rows.push(await sample());
  // skip ahead: end this race quickly
  await page.evaluate(() => { const g = window.__game, r = g.race; if (r && r.state !== 'done') { r._finishRace(); g.onRaceDone(); } });
}
for (const r of rows) console.log(JSON.stringify(r));
console.log(logs.slice(0, 20).join('\n'));
await browser.close(); server.close();
