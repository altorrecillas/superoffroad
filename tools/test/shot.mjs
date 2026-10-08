// Headless screenshot of the game (software WebGL).
// Usage: GAME_ROOT=<game dir> node shot.mjs "<page?query>" out.png [W H timeoutMs]
// Needs playwright (install it next to a copy of this script).
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';

const ROOT = process.env.GAME_ROOT || path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../..');
const [page = 'index.html', out = 'shot.png', W = '1280', H = '720', TO = '240000'] = process.argv.slice(2);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.json': 'application/json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.ktx2': 'image/ktx2', '.bin': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(ROOT, p);
  if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});
const mobile = process.env.MOBILE === '1';
const ctx = await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
const pg = await ctx.newPage();
const logs = [];
pg.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || process.env.SHOT_LOG) logs.push(`[${m.type()}] ${m.text()}`); });
pg.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
const t0 = Date.now();
await pg.goto(`http://localhost:${port}/${page}`, { waitUntil: 'load' });
try {
  await pg.waitForFunction(() => window.__ready === true, null, { timeout: +TO, polling: 500 });
} catch (e) {
  logs.push('[timeout] window.__ready not set');
}
const info = await pg.evaluate(() => (window.__shotInfo ? JSON.stringify(window.__shotInfo) : ''));
await pg.screenshot({ path: out, timeout: 180000 });
console.log(`shot ${out} in ${((Date.now() - t0) / 1000).toFixed(1)}s ${info}`);
if (logs.length) console.log(logs.slice(0, 30).join('\n'));
await browser.close();
server.close();
