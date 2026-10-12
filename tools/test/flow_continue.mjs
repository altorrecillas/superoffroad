// CONTINUAR: a championship left half way (the page closed and opened again) goes on
// where it was. Saved before each race (that race starts again from the grid), once a
// race has counted and in the shop (on to the shop, the podium first after the last
// race of a cup, game over if the last credit went). Also: the version on the title
// and the menu, the question before a new championship replaces the saved one, free
// races not touching it, game over clearing it and a damaged save ignored.
// Usage: GAME_ROOT=<dir> node flow_continue.mjs [outDir] [W H mobile]
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = process.env.GAME_ROOT;
const OUT = process.argv[2] || '.';
const [W = 960, H = 540, MOB = '0'] = process.argv.slice(3);
const VERSION = /VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'js/version.js'), 'utf8'))[1];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f.endsWith('/') ? f + 'index.html' : f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: +W, height: +H }, isMobile: MOB === '1', hasTouch: MOB === '1' })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
let ok = true;
const check = (c, what) => { console.log((c ? '  ok   ' : '  FAIL ') + what); if (!c) ok = false; };
const state = () => page.evaluate(() => window.__game && window.__game.state);
const waitState = async (s, ms = 240000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await state().catch(() => null); if (v === s || (Array.isArray(s) && s.includes(v))) return v; await page.waitForTimeout(400); } throw new Error('timeout waiting ' + s + ' got ' + await state()); };
const URL_ = `http://localhost:${server.address().port}/index.html?q=low&laps=1&warp=4&autopilot=1&nofade=1`;
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('sor.run.v1')));
// "close the game and open it again": a reload keeps the browser's storage
// (loading under software rendering can take a while: generous time limits)
const reopen = async () => { await page.goto(URL_, { timeout: 180000 }); await waitState('title', 180000); };
// with the keyboard: a mouse resting over the menu would focus the button under it
const toMenu = async () => { await page.mouse.move(2, 2); await page.keyboard.press('Enter'); await waitState('menu', 20000); };
const skipIntro = () => page.evaluate(() => { const g = window.__game; if (g.introT != null) g.introT = g.introHold; });
const shopInfo = () => page.evaluate(() => {
  const el = document.querySelector('#shop');
  return el && { cash: el.querySelector('.cash').textContent, tires: el.querySelectorAll('.item[data-k=tires] .lv i.on').length };
});
try {
  await page.goto(URL_, { timeout: 180000 });
  await waitState('title', 180000);
  const ver = await page.evaluate(() => document.querySelector('#title .ver')?.textContent);
  check(ver === 'v' + VERSION, `the title shows the version (${ver})`);
  const vbox = await page.evaluate(() => {
    const v = document.querySelector('#title .ver').getBoundingClientRect(), f = document.querySelector('#title .foot').getBoundingClientRect();
    const inside = v.left >= 0 && v.right <= innerWidth && v.bottom <= innerHeight;
    const overlap = !(v.right <= f.left || v.left >= f.right || v.bottom <= f.top || v.top >= f.bottom);
    return { inside, overlap, h: Math.round(v.height) };
  });
  check(vbox.inside && !vbox.overlap && vbox.h <= 18, `small, in the corner, clear of the line under the title (${JSON.stringify(vbox)})`);
  await page.screenshot({ path: `${OUT}/cont_title_${W}x${H}.png`, timeout: 240000 });
  await toMenu();
  check(await page.evaluate(() => !document.querySelector('#menu [data-a=cont]') && document.querySelector('#menu .ver')?.textContent), 'no CONTINUAR without a saved game; the menu shows the version too');
  check(await saved() === null, 'nothing saved yet');

  // a championship from the menu, as a player starts it
  await page.click('#menu [data-a=p1]');
  if (await page.evaluate(() => !!document.querySelector('#ask'))) await page.click('#ask [data-a=skip]');
  await page.waitForSelector('#diff .dcard[data-k=normal]');
  await page.click('#diff .dcard[data-k=normal]');
  await page.waitForSelector('#select .card[data-id=red]');
  await page.click('#select .card[data-id=red]');
  await waitState(['intro', 'race']);
  let s = await saved();
  check(s && s.at === 'race' && s.s.raceNo === 0 && s.s.players[0].truckId === 'red' && s.s.difficulty === 'normal', 'saved before the first race');
  await skipIntro();
  await waitState('results', 300000);
  s = await saved();
  const won = s && s.s.players[0].money;
  check(s && s.at === 'shop' && s.s.raceNo === 1 && won > 0 && s.s.cup.race === 1, `the race counted and is saved (${won}, cup race ${s && s.s.cup.race})`);

  // closed on the results screen: CONTINUAR goes on to the shop with the prize
  await reopen();
  await toMenu();
  const btn = await page.evaluate(() => { const b = document.querySelector('#menu [data-a=cont]'); return b && { text: b.textContent.replace(/\s+/g, ' ').trim(), first: b === document.querySelector('#menu .btn'), focus: b.classList.contains('focus') }; });
  check(btn && btn.first && btn.focus && /COPA DEL POLVO · CARRERA 2\/4 · PILOTO/.test(btn.text), `CONTINUAR first and focused: "${btn && btn.text}"`);
  await page.screenshot({ path: `${OUT}/cont_menu_${W}x${H}.png`, timeout: 240000 });
  await page.click('#menu [data-a=cont]');
  await waitState('shop', 30000);
  let sh = await shopInfo();
  const money$ = (v) => '$' + Math.round(v).toLocaleString('es-ES');
  check(sh && sh.cash === money$(won), `the shop with the money won (${sh && sh.cash})`);
  const quiet = await page.evaluate(async () => { const g = window.__game, t0 = g.race.time; await new Promise((r) => setTimeout(r, 1200)); return { voices: g.audio.trucks.length, still: g.race.time === t0 }; });
  check(quiet.voices === 0 && quiet.still, 'no race running or sounding behind the shop');
  await page.click('#shop .item[data-k=tires]');
  await page.waitForTimeout(300);
  s = await saved();
  check(s && s.at === 'shop' && s.s.players[0].upgrades.tires === 1 && s.s.players[0].money === won - 20000, 'a purchase is saved straight away');

  // closed in the shop: the purchase is still there
  await reopen();
  await toMenu();
  await page.click('#menu [data-a=cont]');
  await waitState('shop', 30000);
  sh = await shopInfo();
  check(sh && sh.tires === 1 && sh.cash === money$(won - 20000), `the shop as it was left (tyres ${sh && sh.tires}, ${sh && sh.cash})`);
  await page.click('#shop .item[data-k=done]');
  await waitState(['intro', 'race'], 30000);
  const banner = await page.evaluate(() => document.querySelector('#intro .race')?.textContent || '');
  s = await saved();
  check(/CARRERA 2\/4/.test(banner) && s.at === 'race' && s.s.raceNo === 1, `on to the second race (${banner}), saved before it`);
  const track = await page.evaluate(() => { const t = window.__game.race.track; return t.id + (t.reverse ? '-r' : ''); });

  // closed during the race: it starts again from the grid, nothing counted
  await skipIntro();
  await page.waitForFunction(() => { const r = window.__game.race; return r.state === 'race' && r.time > 2; }, null, { timeout: 120000, polling: 300 });
  await reopen();
  await toMenu();
  await page.click('#menu [data-a=cont]');
  await waitState(['intro', 'race'], 30000);
  const again = await page.evaluate(() => { const g = window.__game, t = g.race.track; return { track: t.id + (t.reverse ? '-r' : ''), time: g.race.time, money: g.session.players[0].money, raceNo: g.session.raceNo, tires: g.session.players[0].upgrades.tires, banner: document.querySelector('#intro .race')?.textContent }; });
  check(again.track === track && again.time < 0.5 && again.raceNo === 1 && again.money === won - 20000 && again.tires === 1, `the same race from the start (${again.track}, ${again.banner})`);

  // leaving from the pause menu keeps it, and the button says so
  await skipIntro();
  await waitState('race', 30000);
  await page.evaluate(() => window.__game.pause());
  const quitLabel = await page.evaluate(() => document.querySelector('#pause [data-a=quit]').textContent);
  check(quitLabel === 'GUARDAR Y SALIR', `the pause menu offers ${quitLabel}`);
  await page.click('#pause [data-a=quit]');
  await waitState('title', 30000);
  await toMenu();
  check(await page.evaluate(() => !!document.querySelector('#menu [data-a=cont]')), 'CONTINUAR still there');

  // a new championship asks first; VOLVER keeps the saved one
  const before = JSON.stringify((await saved()).s);
  await page.click('#menu [data-a=p1]');
  await page.waitForSelector('#newrun');
  const ask = await page.evaluate(() => document.querySelector('#newrun').textContent.replace(/\s+/g, ' '));
  check(/PARTIDA GUARDADA/.test(ask) && /CARRERA 2\/4/.test(ask) && /se borrará/.test(ask), 'asked before replacing the saved championship');
  await page.screenshot({ path: `${OUT}/cont_ask_${W}x${H}.png`, timeout: 240000 });
  await page.click('#newrun [data-a=back]');
  await waitState('menu', 10000);
  check(JSON.stringify((await saved()).s) === before, 'VOLVER: the saved championship is untouched');
  await page.click('#menu [data-a=p1]');
  await page.waitForSelector('#newrun');
  await page.click('#newrun [data-a=new]');
  await page.waitForSelector('#diff .dcard[data-k=hard]');
  check(JSON.stringify((await saved()).s) === before, 'still kept while choosing (only a race that starts replaces it)');
  await page.click('#diff .dcard[data-k=hard]');
  await page.waitForSelector('#select .card[data-id=blue]');
  await page.click('#select .card[data-id=blue]');
  await waitState(['intro', 'race']);
  s = await saved();
  check(s.at === 'race' && s.s.raceNo === 0 && s.s.difficulty === 'hard' && s.s.players[0].truckId === 'blue', 'EMPEZAR OTRO: the new championship replaces it');

  // the last race of a cup, closed on its results: the podium, then the shop
  await page.evaluate(() => { const g = window.__game; g.session.cup.race = 3; g.session.cup.points = { red: 24, blue: 30, yellow: 12, grey: 26 }; });
  await skipIntro();
  await waitState('results', 300000);
  s = await saved();
  check(s.at === 'shop' && s.podium && s.podium.standings.length === 4 && s.s.cup.no === 1, 'saved with the podium still to see');
  await reopen();
  await toMenu();
  await page.click('#menu [data-a=cont]');
  await waitState('podium', 30000);
  s = await saved();
  check(!s.podium, 'the podium, once seen, is not shown again');
  await page.click('#podium .btn');
  await waitState(['shop', 'gameover'], 30000);
  check(await state() === 'shop', 'then the shop');

  // a free race does not touch the saved championship
  const keep = JSON.stringify(await saved());
  await reopen();
  await page.evaluate(() => { const g = window.__game; g.freeSetup = { id: 'fandango', reverse: false, time: 'day', trial: false, diff: 'normal' }; g.startFreeRace({ truckId: 'red', vehicle: 'truck' }); });
  await waitState(['intro', 'race']);
  await skipIntro();
  await waitState('race', 30000);
  await page.evaluate(() => window.__game.pause());
  const freeQuit = await page.evaluate(() => document.querySelector('#pause [data-a=quit]').textContent);
  await page.evaluate(() => window.__game.resume());
  check(freeQuit === 'SALIR AL TÍTULO', `a free race just leaves (${freeQuit})`);
  await waitState('results', 300000);
  check(JSON.stringify(await saved()) === keep, 'a free race leaves the saved championship alone');

  // the last credit lost in the saved race: CONTINUAR leads to the game over, which ends it
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('sor.run.v1')); d.at = 'shop'; d.podium = null; d.s.players[0].credits = 0; localStorage.setItem('sor.run.v1', JSON.stringify(d)); });
  await reopen();
  await toMenu();
  await page.click('#menu [data-a=cont]');
  await waitState('gameover', 30000);
  check(await saved() === null, 'game over: nothing left to continue');
  await reopen();
  await toMenu();
  check(await page.evaluate(() => !document.querySelector('#menu [data-a=cont]')), 'no CONTINUAR after the game over');

  // a damaged save is ignored (and removed)
  await page.evaluate(() => localStorage.setItem('sor.run.v1', '{"v":1,"at":"race","s":{"difficulty":"zzz","players":[]}}'));
  await reopen();
  await toMenu();
  check(await page.evaluate(() => !document.querySelector('#menu [data-a=cont]') && localStorage.getItem('sor.run.v1') === null), 'a damaged save is ignored');
} catch (e) { check(false, 'flow: ' + e.message); await page.screenshot({ path: `${OUT}/cont_fail.png` }).catch(() => {}); }
check(!errors.length, 'no errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(ok ? 'CONTINUE OK' : 'CONTINUE FAIL');
await browser.close(); server.close();
