// Installable app / offline check: first visit online (the service worker saves the
// files the game used), then the connection is cut and the page reloaded: the game
// must boot and race from the saved copy. Also checks the manifest and its icons.
// Usage: GAME_ROOT=<dir> node offline.mjs
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = process.env.GAME_ROOT;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f.endsWith('/') ? f + 'index.html' : f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 800, height: 360 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
let ok = true;
const check = (cond, what) => { console.log((cond ? '  ok   ' : '  FAIL ') + what); if (!cond) ok = false; };
await page.goto(base + 'index.html?q=low&sw=1');
await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 180000 });
// wait until the service worker reports it saved the files
const cached = await page.evaluate(() => new Promise((res) => {
  const t = setTimeout(() => res(0), 90000);
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'cached') { clearTimeout(t); res(e.data.n); } });
}));
check(cached > 30, `the service worker saved the game files (${cached})`);
const man = await page.evaluate(async () => {
  const m = await (await fetch(document.querySelector('link[rel=manifest]').href)).json();
  const icons = await Promise.all(m.icons.map(async (i) => (await fetch(i.src)).ok));
  return { name: m.name, display: m.display, maskable: m.icons.some((i) => i.purpose === 'maskable'), icons: icons.every(Boolean), shots: (m.screenshots || []).length };
});
check(man.display === 'fullscreen' && man.maskable && man.icons, `manifest: ${man.display}, maskable icon, all icons load`);
check(man.shots >= 1, `install dialog screenshots (${man.shots})`);
// no connection from now on
await ctx.setOffline(true);
await page.reload();
let booted = false;
try { await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 120000 }); booted = true; } catch (e) { /* */ }
check(booted, 'offline: the game boots from the saved copy');
if (booted) {
  await page.evaluate(() => { const g = window.__game; g.toMenu(); g.startChampionship([{ truckId: 'blue', vehicle: 'truck' }], 'normal'); });
  let raced = false;
  try { await page.waitForFunction(() => window.__game.state === 'intro' || window.__game.state === 'race', null, { timeout: 60000 }); raced = true; } catch (e) { /* */ }
  check(raced, 'offline: a race starts (circuit, trucks, sounds)');
  await page.screenshot({ path: process.argv[2] || 'offline.png', timeout: 120000 });
}
check(!errors.length, 'no errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(ok ? 'OFFLINE OK' : 'OFFLINE FAIL');
await browser.close(); server.close();
