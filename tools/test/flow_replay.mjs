// Replay end to end: a race driven through the real keyboard input (a bot holds and
// releases arrow keys, with the steering assist on), then VER REPETICIÓN at ×4: the
// replay must end with exactly the live race's finishing order and times. Then a
// jump back on the timeline, the photo mode (a JPEG is made), and back to the results.
// Usage: GAME_ROOT=<dir> node flow_replay.mjs [chromium|webkit] [outDir]
import { chromium, webkit } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = process.env.GAME_ROOT;
const ENG = process.argv[2] || 'chromium';
const OUT = process.argv[3] || '.';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f.endsWith('/') ? f + 'index.html' : f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
await new Promise((r) => server.listen(0, r));
const browser = await (ENG === 'webkit' ? webkit : chromium).launch(ENG === 'webkit' ? {} : { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message + ' ' + (e.stack || '').split('\n')[1]));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
let ok = true;
const check = (c, what) => { console.log((c ? '  ok   ' : '  FAIL ') + what); if (!c) ok = false; };
const state = () => page.evaluate(() => window.__game && window.__game.state);
const waitState = async (s, ms = 120000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await state(); if (v === s || (Array.isArray(s) && s.includes(v))) return v; await page.waitForTimeout(300); } throw new Error('timeout waiting ' + s + ' got ' + await state()); };
const shot = (n) => page.screenshot({ path: `${OUT}/replay_${ENG}_${n}.png`, timeout: 180000 });
try {
  await page.goto(`http://localhost:${server.address().port}/index.html?q=low&laps=1&warp=2&nofade=1`);
  await waitState('title', 120000);
  await page.evaluate(() => { const g = window.__game; g.opt.assist = 'soft'; g.toMenu(); g.startChampionship([{ truckId: 'red', vehicle: 'truck' }], 'hard'); });
  await waitState('intro');
  await page.evaluate(() => { const g = window.__game; g.introT = g.introHold; });
  await waitState('race');
  // the bot: reads the track like a player would and presses the real keys
  await page.evaluate(async () => {
    const g = window.__game;
    const { AIDriver } = await import('./js/sim/ai.js');
    const me = g.race.racers.find((r) => r.human);
    const brain = new AIDriver(me.truck, g.race.track, { skill: 0.75, aggression: 0.6, seed: 3 });
    let last = performance.now(), nitroT = 0;
    const tick = (now) => {
      if (g.state !== 'race') { for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) g.input.down.delete(k); return; }
      const dt = Math.min(0.05, (now - last) / 1000) * g.warp; last = now;
      const a = brain.update(dt, g.race.trucks);
      const d = g.input.down;
      d.delete('ArrowLeft'); d.delete('ArrowRight');
      if (a.steer < -0.3) d.add('ArrowLeft'); else if (a.steer > 0.3) d.add('ArrowRight');
      if (a.brake > 0.5) { d.delete('ArrowUp'); d.add('ArrowDown'); } else { d.add('ArrowUp'); d.delete('ArrowDown'); }
      if (a.nitro && (nitroT -= dt) <= 0) { g.input.players[0].nitroLatch = true; nitroT = 3; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.waitForTimeout(4000); await shot('1race');
  await waitState('results', 300000); await page.waitForTimeout(500); await shot('2results');
  const live = await page.evaluate(() => {
    const g = window.__game, r = g.race;
    return { order: r.finishOrder.map((x) => `${x.i}:${x.dnf ? 'dnf' : x.finishTime.toFixed(5)}`).join(' '), steps: g.replayRec.length, marks: g.replayRec.marks.length, btn: !!document.querySelector('#results [data-a=replay]'), assist: g.assistUsed, mult: g.lastSummary.mult };
  });
  check(live.btn, `results offer VER REPETICIÓN (${live.steps} steps recorded, ${live.marks} director notes)`);
  check(live.assist === 1 && live.mult === 1.13, `soft assist used: prize ×${live.mult} (Experto ×1.25 −10 %)`);
  await page.click('#results [data-a=replay]');
  await waitState('replay', 20000);
  await page.waitForTimeout(1500); await shot('3replay_start');
  // ×4 (speed button three times: ×1 -> ×2 -> ×4 -> ... ) and watch to the end
  await page.evaluate(() => { const v = window.__game.replayView; v.speed = 4; v.cur = 4; });
  await page.waitForTimeout(2500); await shot('4replay_mid');
  const cams = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    const s = await page.evaluate(() => { const v = window.__game.replayView; return v && { ended: !!v.ended, cam: v.shotMode, step: v.step }; });
    if (!s) break;
    cams.add(s.cam);
    if (s.ended) break;
    await page.waitForTimeout(250);
  }
  const rp = await page.evaluate(() => { const r = window.__game.replayView.race; return r.finishOrder.map((x) => `${x.i}:${x.dnf ? 'dnf' : x.finishTime.toFixed(5)}`).join(' '); });
  check(rp === live.order, `the replay ends exactly like the race (${rp})`);
  check(cams.size >= 3, `the director used several cameras: ${[...cams].join(', ')}`);
  // back on the timeline, then play to the end again: still the same race
  const target = await page.evaluate(() => { const v = window.__game.replayView; const t = v.step - 1200; v.seek(t); v.setPlaying(true); return t; });
  // the jump re-simulates from the start a few milliseconds per frame (slow under software rendering)
  await page.waitForFunction(() => window.__game.replayView.seekTo == null, null, { timeout: 120000, polling: 200 });
  const afterSeek = await page.evaluate(() => window.__game.replayView.step);
  check(afterSeek >= target && afterSeek < target + 600, `jumping back 10 s lands there (step ${afterSeek}, asked ${target})`);
  await page.waitForFunction(() => window.__game.replayView.ended, null, { timeout: 180000, polling: 250 });
  const rp2 = await page.evaluate(() => { const r = window.__game.replayView.race; return r.finishOrder.map((x) => `${x.i}:${x.dnf ? 'dnf' : x.finishTime.toFixed(5)}`).join(' '); });
  check(rp2 === live.order, `and playing on from there ends with the same race (${rp2})`);
  // photo mode
  await page.evaluate(() => { const v = window.__game.replayView; v.seek(Math.round(v.rec.length * 0.4)); });
  await page.waitForTimeout(1200);
  await page.click('#replay [data-a=photo]', { force: true });
  await waitState('photo', 10000);
  await page.evaluate(() => { const v = window.__game.replayView; v.photo.yaw += 1.2; v.photo.dist = 9; v._photoAct('filter'); v._photoAct('lens'); v._photoAct('lens'); });
  await page.waitForTimeout(800); await shot('5photo');
  await page.click('#photo [data-a=shoot]');
  await page.waitForSelector('#photoprev img', { timeout: 15000 });
  await page.waitForTimeout(800); await shot('6photo_preview');
  const ph = await page.evaluate(() => { const v = window.__game.replayView; const img = document.querySelector('#photoprev img'); return { ...v.lastPhoto, w: img.naturalWidth, h: img.naturalHeight }; });
  check(ph.size > 20000 && ph.w > 300, `the photo is a JPEG of ${ph.w}x${ph.h} (${Math.round(ph.size / 1024)} KB) named ${ph.name}`);
  await page.click('#photoprev [data-a=more]');
  await page.waitForTimeout(300);
  check(!(await page.$('#photoprev')) && (await state()) === 'photo', 'OTRA FOTO goes back to the photo mode');
  await page.keyboard.press('Escape');
  await waitState('replay', 5000);
  // Esc leaves the replay (a first press only wakes the controls when they are hidden)
  for (let i = 0; i < 3 && (await state()) === 'replay'; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(700); }
  await waitState('results', 15000); await page.waitForTimeout(500); await shot('7back');
  const back = await page.evaluate(() => { const g = window.__game; return { btn: !!document.querySelector('#results [data-a=replay]'), same: g.race.finishOrder.map((x) => `${x.i}:${x.dnf ? 'dnf' : x.finishTime.toFixed(5)}`).join(' '), rings: g.world.rings.some((m) => m && m.visible) }; });
  check(back.btn && back.same === live.order && back.rings, 'back at the results over the real race (rings on, replay still offered)');
  // and the championship goes on
  await page.keyboard.press('Enter');
  await waitState('shop', 30000);
  check(true, 'CONTINUAR -> shop');
} catch (e) { check(false, 'flow: ' + e.message); await shot('fail').catch(() => {}); }
check(!errors.length, 'no errors' + (errors.length ? ': ' + errors.slice(0, 6).join(' | ') : ''));
console.log(ok ? 'REPLAY FLOW OK' : 'REPLAY FLOW FAIL');
await browser.close(); server.close();
