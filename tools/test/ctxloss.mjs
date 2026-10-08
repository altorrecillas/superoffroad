// WebGL context loss in the middle of a race (what a phone does under memory
// pressure): the game must pause and say so, then carry on drawing when the
// context comes back. Usage: GAME_ROOT=<dir> node ctxloss.mjs [chromium|webkit] outPrefix
import { chromium, webkit } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = process.env.GAME_ROOT;
const [ENG = 'chromium', PRE = 'ctx'] = process.argv.slice(2);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
await new Promise((r) => server.listen(0, r));
const engine = ENG === 'webkit' ? webkit : chromium;
const browser = await engine.launch(ENG === 'webkit' ? {} : { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 800, height: 360 }, hasTouch: true })).newPage();
const errors = [];
// WebGL itself may log about objects of the dead context being released (resizes while
// the context is lost); that is expected in this scenario, any other error is not
const EXPECTED = /context lost|CONTEXT_LOST|does not belong to this context/i;
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !EXPECTED.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
let ok = true;
const check = (cond, what) => { console.log((cond ? '  ok   ' : '  FAIL ') + what); if (!cond) ok = false; };
await page.goto(`http://localhost:${server.address().port}/index.html?q=medium&nofade=1`);
await page.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 180000 });
await page.evaluate(() => { const g = window.__game; g.toMenu(); g.startChampionship([{ truckId: 'yellow', vehicle: 'buggy' }], 'normal'); g.introT = g.introHold; });
await page.waitForFunction(() => window.__game.state === 'race', null, { timeout: 120000 });
await page.waitForTimeout(2500);
console.log(ENG);
await page.evaluate(() => { window.__lc = window.__game.view.renderer.getContext().getExtension('WEBGL_lose_context'); window.__lc.loseContext(); });
await page.waitForTimeout(1500);
const lost = await page.evaluate(() => ({ paused: window.__game.paused, msg: !!document.querySelector('#ctxlost'), lost: window.__game.view.renderer.getContext().isContextLost() }));
check(lost.lost, 'the context is lost');
check(lost.paused, 'the race pauses');
check(lost.msg, 'the player is told what is happening');
await page.screenshot({ path: `${PRE}_${ENG}_1lost.png`, timeout: 120000 });
await page.evaluate(() => window.__lc.restoreContext());
await page.waitForTimeout(2500);
const back = await page.evaluate(() => ({ msg: !!document.querySelector('#ctxlost'), lost: window.__game.view.renderer.getContext().isContextLost(), frame: window.__game.view.renderer.info.render.frame }));
check(!back.lost, 'the context comes back');
check(!back.msg, 'the message goes away');
await page.evaluate(() => { const b = document.querySelector('#pause [data-a=resume]'); if (b) b.click(); });
await page.waitForTimeout(3000);
const run = await page.evaluate(() => ({ paused: window.__game.paused, frame: window.__game.view.renderer.info.render.frame, t: window.__game.race.time }));
check(!run.paused && run.frame > back.frame, `the race carries on drawing (${run.frame - back.frame} frames)`);
// the picture is not black: sample the canvas through a screenshot
const shot = await page.screenshot({ path: `${PRE}_${ENG}_2back.png`, timeout: 120000 });
const { execFileSync } = await import('child_process');
const mean = +execFileSync('python3', ['-c', `from PIL import Image, ImageStat; im = Image.open('${PRE}_${ENG}_2back.png').convert('L'); print(ImageStat.Stat(im).mean[0])`]).toString();
check(mean > 40, `the scene is drawn again, not black (mean brightness ${mean.toFixed(0)})`);
check(!errors.length, 'no errors' + (errors.length ? ':\n' + [...new Set(errors)].slice(0, 8).join('\n') : ''));
console.log(ok ? 'CTX OK' : 'CTX FAIL');
await browser.close(); server.close();
