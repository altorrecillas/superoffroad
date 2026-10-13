// Production checks (v0.71): damaged saved options, an error thrown in the middle of a
// frame (the game must go on), a race with four human trucks and its replay (four players
// on four phones, one of them leaving half way), the announcer's language changed quickly,
// and a race resumed (as another phone would) while the touch pad editor is open.
// Usage: GAME_ROOT=<dir> node prodcheck.mjs [outDir]
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = process.env.GAME_ROOT, OUT = process.argv[2] || '.';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f.endsWith('/') ? f + 'index.html' : f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
// options left by an older version or damaged: the game must start and set them right
await ctx.addInitScript(() => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.setItem('sor.options.v1', JSON.stringify({
    quality: 'ultra', voice: true, music: 99, sfx: -3, camera: 'drone', touch: 'pedals', lastTruck: 'pink', zoomLevel: 'x', followZoom: 9,
    subs: 'yes', liveries: 'team', touchLayout: { buttons: { gas: { x: 'a', y: 0.5, k: 1 }, nitro: { x: 0.5, y: 0.5, k: 1.2 } }, wheel: { gas: { x: 1, y: 1, k: 1 } } },
  }));
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !m.text().startsWith('[frame]')) errors.push(m.text()); });
let ok = true;
const check = (c, what) => { console.log((c ? '  ok   ' : '  FAIL ') + what); if (!c) ok = false; };
const st = () => page.evaluate(() => window.__game && window.__game.state);
const waitState = async (s, ms = 300000) => { const t = Date.now(); while (Date.now() - t < ms) { if ([].concat(s).includes(await st())) return; await page.waitForTimeout(400); } throw new Error('timeout ' + s + ' got ' + await st()); };
try {
  await page.goto(`http://localhost:${server.address().port}/index.html?q=low&nofade=1&laps=1`, { timeout: 300000 });
  await waitState('title');
  const o = await page.evaluate(() => { const g = window.__game, o = g.opt; return { quality: o.quality, voice: o.voice, music: o.music, sfx: o.sfx, camera: o.camera, touch: o.touch, lastTruck: o.lastTruck, zoomLevel: o.zoomLevel, followZoom: o.followZoom, subs: o.subs, liveries: o.liveries, layout: o.touchLayout }; });
  check(o.quality === 'auto' && o.voice === 'es' && o.music === 7 && o.sfx === 8 && ['zoom', 'classic'].includes(o.camera) && o.touch === 'buttons', `damaged options back to their defaults (${JSON.stringify({ q: o.quality, v: o.voice, m: o.music, s: o.sfx, c: o.camera, t: o.touch })})`);
  check(o.lastTruck === undefined && o.zoomLevel === undefined && o.followZoom === undefined && o.subs === false && o.liveries === undefined, 'nonsense values dropped');
  check(o.layout && !o.layout.wheel && !o.layout.buttons.gas && o.layout.buttons.nitro, 'the touch layout keeps only the places that make sense');

  // an error in the middle of a frame: reported once, and the frames go on
  const before = await page.evaluate(() => { const g = window.__game; window.__frames = 0; const f = g._frame.bind(g); g._frame = (t) => { window.__frames++; return f(t); }; const u = g.world.update.bind(g.world); let n = 0; g.world.update = (...a) => { if (n++ < 3) throw new Error('test fault'); return u(...a); }; return window.__frames; });
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => window.__frames);
  check(after - before > 3, `a frame that throws does not stop the game (${after - before} frames since)`);

  // four human trucks (four players on four phones; here on one page) and the replay
  await page.evaluate(() => { const g = window.__game; g.ui.hideAll(); g.startChampionship([{ truckId: 'red', vehicle: 'truck' }, { truckId: 'blue', vehicle: 'buggy' }, { truckId: 'yellow', vehicle: 'truck' }, { truckId: 'grey', vehicle: 'buggy' }], 'normal'); });
  await waitState(['intro', 'race']);
  await page.evaluate(() => { const g = window.__game; g.introT = g.introHold; });
  await waitState('race');
  const four = await page.evaluate(() => window.__game.race.racers.filter((r) => r.human).map((r) => r.entry.truckId).join(','));
  check(four.split(',').length === 4 && /grey/.test(four), `four human trucks on the grid (${four})`);
  await page.waitForFunction(() => window.__game.race.state === 'race' && window.__game.race.time > 2, null, { timeout: 300000 });
  // the fourth player leaves: the CPU takes the truck (as in a game on several phones)
  await page.evaluate(() => { const g = window.__game, r = g.race; r.racers.find((x) => x.entry.player === 3).bot = true; r.autopilot = true; r.autopilotSkill = 0.9; g.warp = 4; });
  await waitState('results', 400000);
  await page.evaluate(() => { window.__game.warp = 1; });
  const bots = await page.evaluate(() => window.__game.replayRec.bots.length);
  check(bots === 1, 'the replay knows when the player left');
  await page.evaluate(() => window.__game.toReplay());
  await waitState('replay', 60000);
  await page.waitForFunction(() => window.__game.replayView && window.__game.replayView.step > 600, null, { timeout: 300000 });
  const rv = await page.evaluate(() => { const v = window.__game.replayView; return { step: v.step, bot: !!v.race.racers.find((r) => r.entry.player === 3).bot }; });
  check(rv.step > 600, `the replay of a race of four plays (${rv.step} steps)`);
  // pause it and leave it paused: the sound must come back with the results
  await page.evaluate(() => window.__game.replayView.setPlaying(false));
  check(await page.evaluate(() => window.__game.audio.paused === true), 'a paused replay pauses the sound');
  await page.evaluate(() => window.__game.replayView.exit());
  await waitState('results', 60000);
  check(await page.evaluate(() => window.__game.audio.paused === false), 'back from a paused replay: the sound and music are not left paused');

  // the announcer's language changed quickly: the last one wins
  await page.evaluate(async () => { const a = window.__game.audio; a.setVoice('en'); a.setVoice('es'); a.setVoice('en'); a.setVoice('es'); });
  await page.waitForTimeout(6000);
  const lang = await page.evaluate(() => ({ l: window.__game.audio.voiceLang, w: window.__game.audio._wantLang, b: !!window.__game.audio.buffers.v_go }));
  check(lang.l === 'es' && lang.b, `the announcer speaks the last language chosen (${lang.l})`);

  // the music follows the race: muffled in the countdown, open at the green, muffled in the pause
  await page.evaluate(() => { const g = window.__game; g.audio.unlock(); g.ui.hideAll(); g.session.raceNo = 1; g.nextRace(); });
  await waitState(['intro', 'race']);
  await page.evaluate(() => { const g = window.__game; g.introT = g.introHold; });
  await waitState('race');
  await page.waitForFunction(() => { const r = window.__game.race; return r.state === 'countdown' && r.time > -2.6; }, null, { timeout: 120000 });
  await page.waitForTimeout(500);
  const mus = { count: await page.evaluate(() => { const a = window.__game.audio; return a.mfx ? Math.round(a.mfx.lp.frequency.value) : -1; }) };
  await page.waitForFunction(() => window.__game.race.state === 'race' && window.__game.race.time > 1.5, null, { timeout: 120000 });
  mus.green = await page.evaluate(() => { const a = window.__game.audio; return a.mfx ? Math.round(a.mfx.lp.frequency.value) : -1; });
  mus.name = await page.evaluate(() => window.__game.audio.musicName);
  if (mus.count < 0) console.log('  (no music element in this browser: music checks skipped)');
  else check(mus.count < 4000 && mus.green > 10000, `the race music: muffled in the countdown (${mus.count} Hz), open at the green (${mus.green} Hz) · ${mus.name}`);

  // the touch pad editor open (options, from the pause menu) and the race resumed by another phone
  await page.evaluate(() => { const g = window.__game; g.pause(); g.toOptions(() => { g.paused = false; g.pause(); }); document.querySelector('#options [data-k=padEdit]').click(); });
  await page.waitForTimeout(800);
  const open = await page.evaluate(() => ({ edit: window.__game.touch.editing, screen: !!document.querySelector('#padedit') }));
  check(open.edit && open.screen, 'the touch pad editor opens from the pause menu');
  await page.evaluate(() => window.__game.resume(true));
  await page.waitForTimeout(800);
  const res = await page.evaluate(() => { const g = window.__game, t = g.touch; return { edit: !!t.editing, screen: !!document.querySelector('#padedit'), visible: t.visible, cls: t.root.className, pressable: !document.querySelector('#touch.edit') }; });
  check(!res.edit && !res.screen && res.visible && res.pressable, `resumed by another phone: the editor closes and the pad works again (${res.cls})`);
  await page.screenshot({ path: `${OUT}/prodcheck.png`, timeout: 240000 });
} catch (e) {
  check(false, 'flow: ' + e.message);
  await page.screenshot({ path: `${OUT}/prodcheck_fail.png` }).catch(() => {});
}
check(!errors.length, 'no errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(ok ? 'PRODCHECK OK' : 'PRODCHECK FAIL');
await browser.close(); server.close();
process.exit(ok ? 0 : 1);
