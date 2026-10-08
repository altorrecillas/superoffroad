// Visual QA: walks every screen at one viewport and saves a screenshot of each,
// plus a contact sheet. Reports panels that do not fit.
// Usage: GAME_ROOT=<dir> node screens.mjs W H mobile(0|1) outPrefix
//        GAME_ROOT=<dir> node screens.mjs "<Playwright device, e.g. Galaxy S24 landscape>" outPrefix
import { chromium, webkit, devices } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = process.env.GAME_ROOT;
const byDevice = isNaN(+process.argv[2]);
const DEV = byDevice ? devices[process.argv[2]] : null;
if (byDevice && !DEV) throw new Error('unknown device ' + process.argv[2]);
const [W, H, MOB, PRE] = byDevice
  ? [DEV.viewport.width, DEV.viewport.height, DEV.isMobile, process.argv[3]]
  : [+process.argv[2], +process.argv[3], process.argv[4] === '1', process.argv[5]];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
await new Promise((r) => server.listen(0, r));
const engine = DEV && DEV.defaultBrowserType === 'webkit' ? webkit : chromium;
const browser = await engine.launch(engine === chromium ? { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {});
// emulate the device, but render at 1:1 so software rendering stays usable
const ctx = await browser.newContext(DEV ? { ...DEV, deviceScaleFactor: 1 } : { viewport: { width: W, height: H }, isMobile: MOB, hasTouch: MOB });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
await page.goto(`http://localhost:${server.address().port}/index.html?q=low`);
await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 120000 });
await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; }' });
const names = [];
// does every panel fit inside the viewport (after any scaling)?
const check = () => page.evaluate(() => {
  const out = [];
  for (const p of document.querySelectorAll('#ui .screen .panel, #ui .screen .banner')) {
    const r = p.getBoundingClientRect();
    const clipped = r.top < -1 || r.left < -1 || r.bottom > innerHeight + 1 || r.right > innerWidth + 1;
    const scrolls = p.scrollHeight > p.clientHeight + 2;
    const k = p.style.scale ? (+p.style.scale).toFixed(2) : '1';
    if (clipped || scrolls) out.push(`${p.closest('.screen').id}: ${clipped ? 'clipped ' : ''}${scrolls ? `scrolls ${p.scrollHeight}>${p.clientHeight}` : ''} [${Math.round(r.top)},${Math.round(r.bottom)}] x${k}`);
    else if (k !== '1') out.push(`${p.closest('.screen').id}: cabe a escala x${k}`);
  }
  // labels wider than their box (clipped or spilling text)
  for (const el of document.querySelectorAll('#ui .screen .btn, #ui .screen .item, #ui .screen .card .nm, #ui .screen .card .who, #ui .screen .vtab, #ui .screen .head, #ui .screen .verdict, #hud .hud-me .line, #hud .hud-board > div')) {
    if (!el.offsetParent) continue;
    if (el.scrollWidth > el.clientWidth + 1) out.push(`TEXTO NO CABE "${el.textContent.trim().replace(/\s+/g, ' ').slice(0, 34)}" (${el.scrollWidth}>${el.clientWidth})`);
  }
  return out;
});
const snap = async (name, fn, wait = 900) => {
  await page.evaluate(fn);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${PRE}_${name}.png`, timeout: 240000 });
  const bad = await check();
  console.log(name.padEnd(12), bad.length ? bad.join(' | ') : 'ok');
  names.push(name);
};
await snap('01title', () => {});
await snap('02menu', () => window.__game.toMenu());
await snap('03options', () => { const g = window.__game; g.ui.hide('menu'); g.toOptions(() => {}); });
await snap('04help', () => { const g = window.__game; g.ui.hide('options'); g.toHelp(() => {}); });
await snap('05scores', () => { const g = window.__game; g.ui.hide('help'); g.toScores(() => {}); });
await snap('06select', () => { const g = window.__game; g.ui.hide('scores'); g.toSelect(1, 'normal'); });
await snap('07free', () => { const g = window.__game; g.ui.hide('select'); g.toFreeRace(); });
await snap('08intro', () => { const g = window.__game; g.ui.hide('free'); g.freeSetup = null; g.startChampionship([{ truckId: 'red', vehicle: 'truck' }], 'normal'); g.warp = 0.02; }, 2500);
await snap('09race', () => { const g = window.__game; g.introT = g.introHold; g.warp = 1; }, 6000);
await snap('10pause', () => window.__game.pause());
await snap('11results', () => {
  const g = window.__game; g.resume();
  const race = g.race; for (let t = 0; t < 400 && race.state !== 'done'; t += 1 / 60) race.step(1 / 60, []);
  g.showResults(g.session.applyResults(race));
});
await snap('12shop', () => { const g = window.__game; g.ui.hide('results'); g.session.players[0].money = 180000; g.toShop(0); });
await snap('13gameover', () => {
  const g = window.__game; g.ui.hide('shop'); g.view.setActive(null, null); g.stateTick = null;
  const p = g.session.players[0]; p.earned = 2650000; p.credits = 0; g.session.raceNo = 17; g.toGameOver();
});
// contact sheet
const { execFileSync } = await import('child_process');
fs.writeFileSync(`${PRE}_sheet.py`, `
from PIL import Image
names = ${JSON.stringify(names)}
w, h = ${W} // 2, ${H} // 2
cols = 4
rows = (len(names) + cols - 1) // cols
s = Image.new('RGB', (w * cols, h * rows), (20, 20, 20))
for k, n in enumerate(names):
    s.paste(Image.open('${PRE}_%s.png' % n).resize((w, h)), ((k % cols) * w, (k // cols) * h))
s.save('${PRE}_sheet.png')
`);
try { execFileSync('python3', [`${PRE}_sheet.py`]); } catch (e) { /* no PIL */ }
if (logs.length) console.log(logs.slice(0, 10).join('\n'));
await browser.close(); server.close();
