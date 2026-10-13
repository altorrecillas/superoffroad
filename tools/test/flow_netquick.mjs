// Four phones, a quick race and its rematch: four browsers with separate storage pair
// with a room code through the local stand-in for the PeerJS cloud (mocksignal.mjs);
// player 1 picks CARRERA RÁPIDA, a circuit and its settings (no room for the CPU with
// four), each player picks a vehicle on its own phone (the fourth gets Ironman's grey
// truck), a photo finish shown on every phone, the results with REVANCHA (when everyone
// is ready) and OTRO CIRCUITO (player 1 picks, the others wait).
// Usage: GAME_ROOT=<dir> node flow_netquick.mjs [outDir] [players: 2..4]
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
import { mockSignal } from './mocksignal.mjs';
const ROOT = process.env.GAME_ROOT;
const OUT = process.argv[2] || '.';
const N = +(process.argv[3] || 4);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f.endsWith('/') ? f + 'index.html' : f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
await new Promise((r) => server.listen(0, r));
const sig = await mockSignal();
const bc = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const vp = { viewport: { width: 740, height: 360 } };
const ALL = [];
for (let i = 0; i < N; i++) ALL.push(await (await bc.newContext(vp)).newPage());
const [H, ...GS] = ALL;
const errors = [];
ALL.forEach((p, i) => {
  p.on('pageerror', (e) => errors.push(`P${i + 1} PAGEERROR ${e.message}`));
  p.on('console', (m) => {
    if (m.text().startsWith('[net]') && /lost|failed|refuse/.test(m.text())) console.log(`  (P${i + 1} ${m.text()})`);
    if (m.type() === 'error' && !m.text().includes('404') && !/does not belong to this context/.test(m.text())) errors.push(`P${i + 1} ${m.text()}`);
  });
});
let ok = true;
const check = (c, what) => { console.log((c ? '  ok   ' : '  FAIL ') + what); if (!c) ok = false; };
const waitFor = async (p, fn, arg, ms = 120000, what = 'condition') => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evaluate(fn, arg).catch(() => false)) return true; await p.waitForTimeout(300); } throw new Error('timeout: ' + what); };
const waitState = (p, s, ms = 240000) => waitFor(p, (s) => [].concat(s).includes(window.__game && window.__game.state), s, ms, 'state ' + s);
const all = (fn) => Promise.all(ALL.map(fn));
const click = async (p, sel) => { await p.waitForSelector(sel, { timeout: 60000 }); await p.click(sel, { timeout: 180000 }); };
const URL_ = `http://localhost:${server.address().port}/index.html?q=low&nofade=1&laps=1&maxfps=10&lankey=testnet4&sig=${encodeURIComponent(sig.url)}`;
// the CPU finishes the race for everyone (on player 1's phone, which runs it)
const finish = async () => {
  await waitFor(H, () => window.__game.race && window.__game.race.state === 'race', null, 400000, 'green light');
  await H.evaluate(() => { const g = window.__game; g.race.autopilot = true; g.race.autopilotSkill = 0.9; g.warp = 4; });
  await all((p) => waitState(p, 'results', 500000));
  await H.evaluate(() => { window.__game.warp = 1; });
};
const skipIntro = async () => {
  await all((p) => waitState(p, ['intro', 'race']));
  await GS[0].evaluate(() => { window.__game.introT = 1; window.__game._skipIntro(); });
  await all((p) => waitState(p, 'race', 240000));
};
try {
  await all((p) => p.goto(URL_, { timeout: 300000 }));
  await all((p) => waitState(p, 'title', 300000));
  for (const p of ALL) { await p.mouse.move(2, 2); await p.keyboard.press('Enter'); await waitState(p, 'menu', 30000); }

  // player 1: N JUGADORES (four: straight to the phones' screen) -> CREAR PARTIDA
  if (N === 4) await click(H, '#menu [data-a=p4]'); else { await click(H, `#menu [data-a=p${N}]`); await click(H, '#two [data-a=net]'); }
  await click(H, '#netmenu [data-a=host]');
  await waitFor(H, () => document.querySelectorAll('#nethost .netcode b').length === 4, null, 30000, 'room code');
  const code = await H.evaluate(() => [...document.querySelectorAll('#nethost .netcode b')].map((b) => b.textContent).join(''));
  check(await H.evaluate((n) => document.querySelectorAll('#nethost .netplayers span').length === n, N), `a room for ${N} (${code})`);
  for (const [i, g] of GS.entries()) {
    await click(g, '#menu [data-a=p2]'); await click(g, '#two [data-a=net]');
    await click(g, '#netmenu [data-a=join]');
    // (a page this slow can miss its turn, as a person would: then the code again)
    for (let tries = 0; ; tries++) {
      for (const d of code) await click(g, `#netjoin .key[data-d="${d}"]`);
      await waitFor(g, () => !!document.querySelector('#netwait') || (!window.__game.net && !!document.querySelector('#netjoin') && /conectar|encuentro|servidor/i.test(document.querySelector('#netjoin [data-k=msg]').textContent)), null, 240000, `guest ${i + 2} joining`);
      if (await g.evaluate(() => !!document.querySelector('#netwait'))) break;
      if (tries >= 1) throw new Error(`guest ${i + 2} could not join: ` + await g.evaluate(() => document.querySelector('#netjoin [data-k=msg]').textContent));
      console.log(`  (guest ${i + 2}: the first try did not connect, again)`);
    }
  }
  const seats = await Promise.all(GS.map((g) => g.evaluate(() => window.__game.net.local)));
  check(seats.join() === GS.map((g, i) => i + 1).join(), `every phone has its seat (players ${seats.map((s) => s + 1).join(', ')})`);
  await waitFor(H, (n) => document.querySelectorAll('#nethost .netplayers span.in').length === n, N, 30000, 'room full');
  await click(H, '#nethost [data-a=go]');

  // CARRERA RÁPIDA: circuit and settings on player 1's phone, the others wait
  await click(H, '#netmode .ccard[data-k=quick]');
  await waitFor(H, () => !!document.querySelector('#netquick .tcard'), null, 20000, 'quick race setup');
  for (const g of GS) await waitFor(g, () => /eligiendo el circuito/.test(document.querySelector('#netwait .netstatus')?.textContent || ''), null, 20000, 'guest waits for the circuit');
  check(true, 'quick race: player 1 sets it up, the others are told');
  const rivals = await H.evaluate(() => document.querySelector('#netquick [data-a=rivals]').textContent.replace(/\s+/g, ' ').trim());
  if (N === 4) check(/SIN SITIO/.test(rivals), `four players fill the grid: no CPU (${rivals})`);
  await click(H, '#netquick .tcard[data-id=huevos]');
  await click(H, '#netquick [data-a=dir]');
  await H.screenshot({ path: `${OUT}/netquick_setup.png`, timeout: 240000 });
  await click(H, '#netquick [data-a=go]');

  // the vehicles, each on its own phone; with four, Ironman's grey truck too
  const trucks = ['red', 'blue', 'yellow', 'grey'];
  await waitFor(H, () => !!document.querySelector('#select .card'), null, 30000, 'host select');
  const cards = await H.evaluate(() => [...document.querySelectorAll('#select .card')].map((c) => c.dataset.id).join(','));
  check(N === 4 ? /grey/.test(cards) : !/grey/.test(cards), `the trucks to choose from: ${cards}`);
  await click(H, '#select .card[data-id=red]');
  for (const [i, g] of GS.entries()) {
    await waitFor(g, () => !!document.querySelector('#select .card'), null, 40000, `select on phone ${i + 2}`);
    await click(g, `#select .card[data-id=${trucks[i + 1]}]`);
  }
  await skipIntro();
  const banner = await GS[N - 2].evaluate(() => window.__game.session.free && window.__game.session.free.quick && window.__game.race.track.id + (window.__game.race.track.reverse ? ' rev' : ''));
  const humans = await H.evaluate(() => window.__game.race.racers.filter((r) => r.human).map((r) => r.entry.truckId).join(','));
  check(banner === 'huevos rev' && humans.split(',').length === N, `the quick race on every phone (${banner}; players: ${humans})`);
  if (N === 4) check(await H.evaluate(() => window.__game.race.racers.every((r) => r.human)), 'four players, four human trucks, no CPU');
  await GS[N - 2].screenshot({ path: `${OUT}/netquick_p${N}_race.png`, timeout: 240000 });

  // a photo finish (forced): slow motion on every phone, the guests' prediction off,
  // the picture everywhere, then full speed again
  await H.evaluate(() => window.__game._photoStart(0, 1));
  for (const g of GS) await waitFor(g, () => window.__game.photo && window.__game.photo.phase === 'slow', null, 30000, 'guest slow motion');
  const pred = await GS[0].evaluate(() => ({ k: window.__game.photo.k, ready: window.__game._pred && window.__game._pred.ready }));
  check(pred.ready === false, `the slow motion reaches every phone (k ${pred.k.toFixed(2)}), their own truck drawn as player 1 runs it`);
  await H.evaluate(() => { const g = window.__game, r = g.race; r.racers[0].place = 1; r.racers[1].place = 2; g._photoFreeze(); });
  for (const g of GS) await waitFor(g, () => !!document.querySelector('#photofin .pf-card'), null, 30000, 'guest photo');
  const card = await GS[0].evaluate(() => document.querySelector('#photofin .pf-card').textContent.replace(/\s+/g, ' ').trim());
  check(/FOTO FINISH/.test(card) && /\+0,0/.test(card) && /1º/.test(card) && /2º/.test(card) && /1P/.test(card), `the photo finish on every phone, with the places and the players' numbers (${card})`);
  check(await GS[0].evaluate(() => document.getElementById('app').classList.contains('photo-look')), "a guest's picture has the photo's look too");
  await GS[0].screenshot({ path: `${OUT}/netquick_photo.png`, timeout: 240000 });
  await all((p) => waitFor(p, () => !window.__game.photo, null, 60000, 'photo over'));
  check(await GS[0].evaluate(() => window.__game.world.camMode !== 'finish' && !document.querySelector('#photofin')), 'and back to the race on every phone');

  // the results: REVANCHA everywhere, OTRO CIRCUITO on player 1's phone
  await finish();
  const btns = await all((p) => p.evaluate(() => [...document.querySelectorAll('#results .btn')].map((b) => b.dataset.a).join(',')));
  check(/^again,other/.test(btns[0]) && btns.slice(1).every((b) => b === 'again,quit'), `results: ${btns[0]} for player 1, ${btns[1]} for the others`);
  await H.screenshot({ path: `${OUT}/netquick_results.png`, timeout: 240000 });
  await click(H, '#results [data-a=again]');
  check(/ESPERANDO/.test(await H.evaluate(() => document.querySelector('#results [data-a=again]').textContent)), 'REVANCHA waits for everyone');
  for (const g of GS) await click(g, '#results [data-a=again]');
  await skipIntro();
  const again = await all((p) => p.evaluate(() => window.__game.race.track.id));
  check(again.every((t) => t === 'huevos'), `the rematch: the same race again on every phone (${again[0]})`);

  // OTRO CIRCUITO: player 1 picks another one, the others wait, then all race on it
  await finish();
  await click(H, '#results [data-a=other]');
  await waitFor(H, () => !!document.querySelector('#netquick [data-a=go]'), null, 20000, 'setup again');
  check(/A CORRER/.test(await H.evaluate(() => document.querySelector('#netquick [data-a=go]').textContent)), 'OTRO CIRCUITO: straight to the grid with the same vehicles');
  for (const g of GS) await waitFor(g, () => /eligiendo el circuito/.test(document.querySelector('#netwait .netstatus')?.textContent || ''), null, 20000, 'guest waits');
  await click(H, '#netquick .tcard[data-id=volcano]');
  await click(H, '#netquick [data-a=go]');
  await skipIntro();
  // (on a guest's phone the others' trucks are rivals there: compare the whole grid)
  const other = await all((p) => p.evaluate(() => window.__game.race.track.id + ':' + window.__game.race.racers.filter((r) => r.human || r.remote).map((r) => r.entry.truckId).sort().join(',')));
  check(other.every((t) => t === other[0]) && /^volcano/.test(other[0]), `another circuit on every phone (${other[0]})`);
} catch (e) {
  check(false, 'flow: ' + e.message);
  for (const [i, p] of ALL.entries()) {
    console.log(`P${i + 1}`, await p.evaluate(() => { const g = window.__game, net = g.net; return JSON.stringify({ state: g.state, paused: g.paused, screens: [...document.querySelectorAll('#ui .screen')].map((e) => e.id), net: net && { role: net.role, local: net.local, peers: net.peers.map((x) => ({ player: x.player, open: x.open })) } }); }).catch((x) => 'eval failed ' + x.message));
    await p.screenshot({ path: `${OUT}/netquick_fail_p${i + 1}.png` }).catch(() => {});
  }
}
check(!errors.length, 'no errors' + (errors.length ? ': ' + errors.slice(0, 6).join(' | ') : ''));
console.log(ok ? 'NETQUICK OK' : 'NETQUICK FAIL');
await bc.close();
server.close(); sig.close();
