// Two or three phones, one championship (the quick race and four phones: flow_netquick.mjs): browsers with separate storage (like
// separate phones) pair with a room code through a local stand-in for the PeerJS cloud
// (mocksignal.mjs), then play: the room (player 1 starts when everyone is in), the
// difficulty on player 1's phone and each truck on its own phone, the race drawn on the
// guests' phones from player 1's simulation, a guest's controls driving its truck on
// player 1's phone, the same results everywhere, every shop at once (a guest's purchase
// made through player 1), the next race, a shared pause, and a guest leaving (the
// others play on, its truck for the CPU).
// Usage: GAME_ROOT=<dir> node flow_net.mjs [outDir] [players: 2|3] [guest engine: chromium|webkit]
import { chromium, webkit } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
import { mockSignal } from './mocksignal.mjs';
const ROOT = process.env.GAME_ROOT;
const OUT = process.argv[2] || '.';
const N = +(process.argv[3] || 2);
const GUEST = process.argv[4] || 'chromium';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f.endsWith('/') ? f + 'index.html' : f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
await new Promise((r) => server.listen(0, r));
const sig = await mockSignal();
const gl = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const bc = await chromium.launch({ args: gl });
const bg = GUEST === 'webkit' ? await webkit.launch() : bc;
const vp = { viewport: { width: 760, height: 400 } };
const H = await (await bc.newContext(vp)).newPage();
const GS = [];
for (let i = 1; i < N; i++) GS.push(await (await bg.newContext(vp)).newPage());
const ALL = [H, ...GS];
const errors = [];
ALL.forEach((p, i) => {
  p.on('pageerror', (e) => errors.push(`P${i + 1} PAGEERROR ${e.message}`));
  p.on('console', (m) => {
    if (m.text().startsWith('[net]')) console.log(`  (P${i + 1} ${((Date.now() / 1000) % 1000).toFixed(1)} ${m.text()})`);
    if (m.type() === 'error' && !m.text().includes('404') && !/does not belong to this context/.test(m.text())) errors.push(`P${i + 1} ${m.text()}`);
  });
});
let ok = true;
const check = (c, what) => { console.log((c ? '  ok   ' : '  FAIL ') + what); if (!c) ok = false; };
const waitFor = async (p, fn, arg, ms = 120000, what = 'condition') => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evaluate(fn, arg).catch(() => false)) return true; await p.waitForTimeout(300); } throw new Error('timeout: ' + what); };
const waitState = (p, s, ms = 180000) => waitFor(p, (s) => [].concat(s).includes(window.__game && window.__game.state), s, ms, 'state ' + s);
const all = (fn) => Promise.all(ALL.map(fn));
// (a long timeout: a page building a circuit under software rendering answers late)
const click = async (p, sel) => { await p.waitForSelector(sel, { timeout: 40000 }); await p.click(sel, { timeout: 120000 }); };
// (lankey: every page on the same "WiFi" without asking a STUN server)
const URL_ = `http://localhost:${server.address().port}/index.html?q=low&nofade=1&laps=1&maxfps=15&netdebug=1&lankey=testnet&sig=${encodeURIComponent(sig.url)}`;
const G = GS[0];
try {
  await all((p) => p.goto(URL_, { timeout: 240000 }));
  await all((p) => waitState(p, 'title', 240000));
  for (const p of ALL) { await p.mouse.move(2, 2); await p.keyboard.press('Enter'); await waitState(p, 'menu', 20000); }

  // player 1 opens a room for N; the others type its code
  await click(H, `#menu [data-a=p${N}]`); await click(H, '#two [data-a=net]'); await click(H, '#netmenu [data-a=host]');
  await waitFor(H, () => document.querySelectorAll('#nethost .netcode b').length === 4, null, 30000, 'room code');
  const code = await H.evaluate(() => [...document.querySelectorAll('#nethost .netcode b')].map((b) => b.textContent).join(''));
  check(/^\d{4}$/.test(code), `player 1 shows a room code (${code})`);
  check(await H.evaluate(() => document.querySelector('#nethost [data-a=go]').classList.contains('disabled')), 'EMPEZAR waits for someone to join');
  for (const [i, g] of GS.entries()) {
    await click(g, '#menu [data-a=p2]'); await click(g, '#two [data-a=net]');
    if (i === 0) {
      // the second phone finds the game on its WiFi by itself and joins with a tap
      await waitFor(g, (c) => !!document.querySelector(`#netmenu .found[data-code="${c}"]`), code, 40000, 'game found on the WiFi');
      const found = await g.evaluate(() => document.querySelector('#netmenu .found').textContent.replace(/\s+/g, ' ').trim());
      check(new RegExp(code).test(found), `the second phone finds the game on its WiFi by itself (${found})`);
      await click(g, `#netmenu .found[data-code="${code}"]`);
    } else {
      // the third one types the code
      await click(g, '#netmenu [data-a=join]');
      for (const d of code) await click(g, `#netjoin .key[data-d="${d}"]`);
    }
    await waitFor(g, () => !!document.querySelector('#netwait'), null, 60000, `guest ${i + 2} connected`);
    const me = await g.evaluate(() => window.__game.net.local);
    check(me === i + 1, `the ${i ? 'third' : 'second'} phone is player ${me + 1}`);
  }
  await waitFor(H, (n) => document.querySelectorAll('#nethost .netplayers span.in').length === n, N, 20000, 'room full');
  const go = await H.evaluate(() => document.querySelector('#nethost [data-a=go]').textContent);
  check(new RegExp(`${N} JUGADORES`).test(go), `the room shows everyone (${go})`);
  await waitFor(H, (n) => { const g = window.__game.net.guests; return g.length === n && g.every((p) => p.pongs > 0); }, N - 1, 30000, 'pongs').catch(() => {});
  const pongs = await H.evaluate(() => window.__game.net.guests.map((p) => p.pongs));
  check(pongs.length === N - 1 && pongs.every((x) => x > 0), `player 1 pings every phone (${pongs.join(', ')} answers so far)`);
  await click(H, '#nethost [data-a=go]');

  // championship or quick race (the others wait); then the difficulty on player 1's
  // phone, each truck on its own phone, in turn
  await waitFor(H, () => !!document.querySelector('#netmode .ccard[data-k=champ]'), null, 20000, 'what to play');
  for (const g of GS) await waitFor(g, () => /campeonato o carrera rápida/.test(document.querySelector('#netwait .netstatus')?.textContent || ''), null, 20000, 'guest waits for the choice');
  check(true, 'player 1 chooses championship or quick race; the others are told');
  await click(H, '#netmode .ccard[data-k=champ]');
  await waitFor(H, () => !!document.querySelector('#diff'), null, 20000, 'difficulty');
  await click(H, '#diff .dcard[data-k=normal]');
  await click(H, '#select .card[data-id=red]');
  const trucks = ['blue', 'yellow'];
  for (const [i, g] of GS.entries()) {
    await waitFor(g, () => !!document.querySelector('#select .card'), null, 30000, `select on phone ${i + 2}`);
    const sel = await g.evaluate(() => ({ head: document.querySelector('#select .head').textContent, taken: [...document.querySelectorAll('#select .card.taken')].map((c) => c.dataset.id) }));
    check(new RegExp(`JUGADOR ${i + 2}`).test(sel.head) && sel.taken.length === i + 1, `player ${i + 2} chooses on its phone, the trucks already taken marked (${sel.taken.join(', ')})`);
    if (i + 1 < GS.length) {
      const waits = await GS[i + 1].evaluate(() => document.querySelector('#netwait .netstatus')?.textContent || '');
      check(new RegExp(`jugador ${i + 2}`).test(waits), `the other phone waits for it (${waits.trim()})`);
    }
    await click(g, `#select .card[data-id=${trucks[i]}]`);
  }
  await all((p) => waitState(p, ['intro', 'race']));
  // (the race itself: a slow phone may already have left the fly-over and its banner,
  // since every phone starts the race when player 1's fly-over ends)
  const races = await all((p) => p.evaluate(() => { const g = window.__game; return `${g.race.track.id}${g.race.track.reverse ? ' (inv.)' : ''} · carrera ${g.session.cup.race + 1}/4 · ${g.race.laps} v`; }));
  check(races.every((b) => b === races[0]), `the same race on every phone (${races[0]})`);
  const humans = await H.evaluate(() => window.__game.race.racers.filter((r) => r.human).length);
  check(humans === N, `${N} human trucks in player 1's race`);
  await H.screenshot({ path: `${OUT}/net${N}_p1_intro.png`, timeout: 240000 });
  // a tap on a guest's phone skips the fly-over everywhere
  await G.evaluate(() => { window.__game.introT = 1; window.__game._skipIntro(); });
  await all((p) => waitState(p, 'race', 180000));
  check(true, "a guest's tap skipped the fly-over on every phone");

  // a guest's controls drive its truck on player 1's phone
  await waitFor(H, () => window.__game.race.state === 'race', null, 400000, 'green light');
  const t0 = await H.evaluate(() => window.__game.race.time);
  await G.keyboard.down('ArrowUp');
  await waitFor(H, (t0) => window.__game.race.time > t0 + 3, t0, 120000, '3 race seconds');
  const drive = await H.evaluate(() => { const r = window.__game.race.racers.find((x) => x.entry.player === 1); return { speed: r.truck.speed, prog: r.prog, remote: !!r.remote, human: r.human, start: r.entry.slot }; });
  const gview = await G.evaluate(() => { const g = window.__game, r = g.race.racers.find((x) => x.entry.player === 1); return { prog: r.prog, shadow: !!g.race.shadow, mine: r.human && !r.remote, snaps: g.net.snaps.length, delay: Math.round(g.net.clock.delay) }; });
  const pq = await G.evaluate(() => { const P = window.__game._pred; return P && { ready: P.ready, off: Math.hypot(P.off.x, P.off.z), hist: P.hist.length }; });
  await G.keyboard.up('ArrowUp');
  check(pq && pq.ready && pq.off < 2, `player 2's own truck is predicted on its phone (a correction of ${pq ? pq.off.toFixed(2) : '?'} m being smoothed, ${pq ? pq.hist : 0} controls not yet seen by player 1)`);
  check(drive.remote && drive.human && drive.speed > 8, `player 2's throttle moves its truck on player 1's phone (${drive.speed.toFixed(1)} m/s after 3 s)`);
  check(gview.shadow && gview.mine && Math.abs(gview.prog - drive.prog) < 25, `player 2's phone draws it where it is (${gview.prog.toFixed(0)} m there, ${drive.prog.toFixed(0)} m here; ${gview.snaps} snapshots kept, drawn ${gview.delay} ms behind)`);
  await G.screenshot({ path: `${OUT}/net${N}_p2_race.png`, timeout: 240000 });
  const hud = await G.evaluate(() => ({ tags: [...document.querySelectorAll('.ptag b')].map((b) => b.textContent).sort().join(','), ping: document.querySelector('.netping span')?.textContent }));
  check(/TÚ/.test(hud.tags) && /1P/.test(hud.tags) && (N < 3 || /3P/.test(hud.tags)) && /ms/.test(hud.ping || ''), `player 2 sees "TÚ" over its truck, the others' numbers and the ping (${hud.tags} · ${hud.ping})`);

  // a pause on one phone stops the race on all
  await G.evaluate(() => window.__game.pause());
  await waitFor(H, () => window.__game.paused, null, 10000, 'host paused');
  if (N > 2) await waitFor(GS[1], () => window.__game.paused, null, 10000, 'third phone paused');
  const p0 = await H.evaluate(() => window.__game.race.time);
  await H.waitForTimeout(1500);
  check(p0 === await H.evaluate(() => window.__game.race.time), `a pause on player 2's phone stops the race on every phone`);
  await H.evaluate(() => window.__game.resume());
  for (const g of GS) await waitFor(g, () => !window.__game.paused, null, 10000, 'resumed');
  check(true, 'and another phone can resume it');

  // the CPU finishes the race for everyone; the same results on every phone
  await H.evaluate(() => { window.__game.race.autopilot = true; window.__game.race.autopilotSkill = 0.9; window.__game.warp = 4; });
  await all((p) => waitState(p, 'results', 400000));
  const res = await all((p) => p.evaluate(() => [...document.querySelectorAll('#results .table .place')].map((e) => e.nextElementSibling.textContent.trim()).join(',')));
  check(res.every((r) => r === res[0]) && res[0].split(',').length === 4, `the same results on every phone (${res[0]})`);
  const meRows = await all((p) => p.evaluate(() => document.querySelector('#results .table .place.me')?.nextElementSibling.textContent.trim()));
  check(new Set(meRows).size === N && meRows.every(Boolean), `each phone highlights its own row (${meRows.join(' / ')})`);
  await H.evaluate(() => { window.__game.warp = 1; });
  await click(H, '#results [data-a=cont]');
  check(/ESPERANDO/.test(await H.evaluate(() => document.querySelector('#results [data-a=cont]').textContent)), 'player 1 waits for the others');
  for (const g of GS) await click(g, '#results [data-a=cont]');
  await all((p) => waitState(p, 'shop', 40000));
  const shops = await all((p) => p.evaluate(() => document.querySelector('#shop .who').textContent));
  check(shops.every((s, i) => new RegExp(`${i + 1}P`).test(s)), `each phone shops for its own player (${shops.join(' / ')})`);
  const before = await H.evaluate(() => ({ ...window.__game.session.players[1].upgrades, money: window.__game.session.players[1].money }));
  await click(G, '#shop .item[data-k=tires]');
  await waitFor(H, (m) => window.__game.session.players[1].money < m, before.money, 10000, 'purchase applied');
  const after = await H.evaluate(() => window.__game.session.players[1].upgrades.tires);
  await waitFor(G, (n) => document.querySelectorAll('#shop .item[data-k=tires] .lv i.on').length === n, after, 10000, 'guest shop updated');
  check(after === before.tires + 1, "player 2's purchase is made on player 1's phone and shows on its own");
  for (const g of GS) await click(g, '#shop .item[data-k=done]');
  await click(H, '#shop .item[data-k=done]');
  await all((p) => waitState(p, ['intro', 'race'], 90000));
  const b2 = await G.evaluate(() => document.querySelector('#intro .race')?.textContent || '');
  check(/CARRERA 2\/4/.test(b2), `on to the second race on every phone (${b2})`);
  check(await H.evaluate((n) => window.__game.race.racers.find((r) => r.entry.player === 1).entry.upgrades.tires === n, after), "with the new tyres on player 2's truck");

  // the WiFi drops on player 2's phone: the race waits, and it comes back by itself
  // (the same code, the same seat, the race where it was)
  await G.evaluate(() => { window.__game.introT = 1; window.__game._skipIntro(); });
  await waitState(G, 'race', 30000);
  await waitFor(H, () => window.__game.race.state === 'race', null, 400000, 'green light 2');
  // (counted, not looked for on screen: a fast phone is back before the notice can be seen)
  await H.evaluate(() => {
    const g = window.__game, lost = g._netLost.bind(g), back = g._netRejoined.bind(g);
    window.__lost = 0; window.__back = 0;
    g._netLost = (p) => { window.__lost++; const r = lost(p); window.__lostMsg = document.querySelector('#netlost')?.textContent.replace(/\s+/g, ' ') || ''; window.__lostPaused = g.paused; return r; };
    g._netRejoined = (p) => { window.__back++; return back(p); };
  });
  await G.evaluate(() => window.__game.net.host.link.pc.close());
  await waitFor(H, () => window.__lost > 0, null, 120000, 'player 1 notices');
  const lostMsg = await H.evaluate(() => window.__lostMsg), lostPaused = await H.evaluate(() => window.__lostPaused);
  check(/JUGADOR 2/.test(lostMsg) && /UNIRSE/.test(lostMsg) && lostPaused, `player 2's link drops: the race stops and player 1 is told (${lostMsg.slice(0, 70).trim()}…)`);
  await waitFor(H, () => window.__back > 0, null, 300000, 'player 2 back');
  await waitFor(G, () => { const n = window.__game.net; return n && n.open && !document.querySelector('#netlost'); }, null, 120000, 'player 2 connected again');
  await waitFor(H, () => !document.querySelector('#netlost'), null, 120000, "player 1's notice gone");
  const back = await G.evaluate(() => { const g = window.__game; return { local: g.net.local, shadow: !!(g.race && g.race.shadow), state: g.state }; });
  check(back.local === 1 && back.shadow && back.state === 'race', `player 2 comes back by itself: same seat, the race rebuilt where it was (${back.state})`);
  await H.evaluate(() => window.__game.resume());
  const tb = await H.evaluate(() => window.__game.race.time);
  await waitFor(H, (tb) => window.__game.race.time > tb + 1, tb, 400000, 'race running again');
  await waitFor(G, () => window.__game.net.snaps.length > 0 && !window.__game.paused, null, 120000, 'guest drawing again');
  check(true, 'and the race goes on for both');

  // a guest leaves: the others are told and play on, its truck for the CPU
  await G.evaluate(() => window.__game.pause());
  await click(G, '#pause [data-a=quit]');
  await waitState(G, 'title', 30000);
  await waitFor(H, () => !window.__game.session.players[1].alive, null, 15000, 'host told');
  const left = await H.evaluate(() => { const g = window.__game; return { net: !!g.net, sessNet: !!g.session.net, bot: !!g.race.racers.find((r) => r.entry.player === 1).bot }; });
  check(left.bot && left.net === (N > 2) && left.sessNet === (N > 2), `player 2 leaves: its truck goes on for the CPU, ${N > 2 ? 'players 1 and 3 play on' : 'player 1 plays on alone (an ordinary championship again)'}`);
  if (N > 2) check(await GS[1].evaluate(() => [...document.querySelectorAll('.toast')].some((t) => /jugador 2 ha salido/i.test(t.textContent)) || !!window.__game.net), 'the third phone is told and stays in the game');
  await H.evaluate(() => window.__game.resume());
  await H.waitForTimeout(1500);
  check(await H.evaluate(() => !window.__game.paused), 'the race carries on');
} catch (e) {
  check(false, 'flow: ' + e.message);
  console.log('signal log:', sig.log.slice(-10).join(' | '));
  for (const [i, p] of ALL.entries()) {
    console.log(`P${i + 1}`, await p.evaluate(() => { const g = window.__game, net = g.net; return JSON.stringify({ state: g.state, paused: g.paused, screens: [...document.querySelectorAll('#ui .screen')].map((e) => e.id), msg: document.querySelector('#netjoin [data-k=msg], #nethost [data-k=msg]')?.textContent, net: net && { role: net.role, local: net.local, peers: net.peers.map((x) => ({ player: x.player, open: x.open, link: x.link.isOpen, ice: x.link.pc.iceConnectionState })) } }); }).catch((x) => 'eval failed ' + x.message));
    await p.screenshot({ path: `${OUT}/net${N}_fail_p${i + 1}.png` }).catch(() => {});
  }
}
check(!errors.length, 'no errors' + (errors.length ? ': ' + errors.slice(0, 6).join(' | ') : ''));
console.log(ok ? 'NET OK' : 'NET FAIL');
await bc.close(); if (bg !== bc) await bg.close();
server.close(); sig.close();
