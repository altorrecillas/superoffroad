// Two phones with no internet: QR codes. Player 1 shows its connection as a QR; player
// 2's camera (Chromium's fake camera, fed a video of that very QR on a screen) reads it
// with jsQR, as on an iPhone, and shows its answer as a QR, which player 1 reads; then
// the room, the start and a race on both. Also: the QR drawn decodes to the text it
// carries, and a QR from another version or another app is turned down kindly.
// Usage: GAME_ROOT=<dir> node flow_netqr.mjs [outDir]
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
import { execFileSync } from 'child_process';
const ROOT = process.env.GAME_ROOT;
const OUT = process.argv[2] || '.';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f.endsWith('/') ? f + 'index.html' : f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
await new Promise((r) => server.listen(0, r));
const gl = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const vp = { viewport: { width: 760, height: 400 } };
const URL_ = `http://localhost:${server.address().port}/index.html?q=low&nofade=1&laps=1&maxfps=15&sig=ws://127.0.0.1:9/none`;
const errors = [];
let ok = true;
const check = (c, what) => { console.log((c ? '  ok   ' : '  FAIL ') + what); if (!c) ok = false; };
const waitFor = async (p, fn, arg, ms = 120000, what = 'condition') => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evaluate(fn, arg).catch(() => false)) return true; await p.waitForTimeout(300); } throw new Error('timeout: ' + what); };
const waitState = (p, s, ms = 180000) => waitFor(p, (s) => [].concat(s).includes(window.__game && window.__game.state), s, ms, 'state ' + s);
const click = async (p, sel) => { await p.waitForSelector(sel, { timeout: 40000 }); await p.click(sel, { timeout: 120000 }); };
const watch = (p, n) => {
  p.on('pageerror', (e) => errors.push(`${n} PAGEERROR ${e.message}`));
  p.on('console', (m) => {
    if (m.text().startsWith('[net]')) console.log(`  (${n} ${m.text()})`);
    if (m.type() === 'error' && !m.text().includes('404') && !/does not belong to this context|ERR_CONNECTION_REFUSED|WebSocket/.test(m.text())) errors.push(`${n} ${m.text()}`);
  });
};
// the text of the QR drawn in a page, read back with jsQR from its own pixels
const decodeIn = (p, sel) => p.evaluate(async (sel) => {
  const c = document.querySelector(sel + ' canvas');
  const jsQR = (await import('/vendor/qr/jsqr.js')).default;
  const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  const r = jsQR(img.data, img.width, img.height);
  return r && r.data;
}, sel);
const bh = await chromium.launch({ args: gl });
const H = await (await bh.newContext(vp)).newPage();
watch(H, 'P1');
let bg = null;
try {
  await H.goto(URL_, { timeout: 240000 });
  await waitState(H, 'title', 240000);
  await H.mouse.move(2, 2); await H.keyboard.press('Enter'); await waitState(H, 'menu', 20000);
  await click(H, '#menu [data-a=p2]'); await click(H, '#two [data-a=net]'); await click(H, '#netmenu [data-a=qrhost]');
  await waitFor(H, () => !!document.querySelector('#nethost .qrbox')?.dataset.text, null, 60000, 'host QR');
  const offer = await H.evaluate(() => document.querySelector('#nethost .qrbox').dataset.text);
  const modules = await H.evaluate(() => +document.querySelector('#nethost .qrbox canvas').dataset.modules);
  check(/^SOR1\|/.test(offer) && offer.length < 220, `player 1 shows its connection as a QR (${offer.length} characters, ${modules}×${modules} squares)`);
  check(await decodeIn(H, '#nethost .qrbox') === offer, 'the QR drawn reads back as the same text');
  const camMsg = await H.evaluate(() => document.querySelector('#nethost [data-k=msg]').textContent);
  check(/cámara/.test(camMsg), `no camera here: said plainly (${camMsg.trim()})`);
  await H.screenshot({ path: `${OUT}/netqr_p1.png`, timeout: 240000 });
  // a QR from another version, and one that is not ours, are turned down kindly
  const wrong = await H.evaluate(async (offer) => {
    const sc = window.__game.net.scanner, msg = () => document.querySelector('#nethost [data-k=msg]').textContent;
    sc.feed(offer.replace(/^SOR1\|[^|]+\|o\|/, 'SOR1|0.01|a|'));
    await new Promise((r) => setTimeout(r, 400));
    const a = msg();
    sc.feed('https://example.com/');
    await new Promise((r) => setTimeout(r, 400));
    return [a, msg()];
  }, offer);
  check(/otra versión/.test(wrong[0]) && /no es de una partida/.test(wrong[1]), `other versions and other QR codes are turned down (${wrong.map((w) => w.slice(0, 44)).join(' / ')})`);

  // player 2's camera sees that QR on player 1's screen: a video of it for the fake camera
  const png = path.join(OUT, 'qr_offer.png'), y4m = path.join(OUT, 'qr_offer.y4m');
  await H.locator('#nethost .qrbox canvas').screenshot({ path: png });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', png, '-vf', 'scale=300:300,pad=640:480:170:90:color=white,format=yuv420p', '-t', '2', '-r', '10', y4m]);
  bg = await chromium.launch({ args: [...gl, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`] });
  const G = await (await bg.newContext({ ...vp, permissions: ['camera'] })).newPage();
  watch(G, 'P2');
  await G.goto(URL_, { timeout: 240000 });
  await waitState(G, 'title', 240000);
  await G.mouse.move(2, 2); await G.keyboard.press('Enter'); await waitState(G, 'menu', 20000);
  await click(G, '#menu [data-a=p2]'); await click(G, '#two [data-a=net]'); await click(G, '#netmenu [data-a=qrjoin]');
  // and the right one, read by the camera
  await waitFor(G, () => !!document.querySelector('#netqr [data-k=mine] .qrbox')?.dataset.text, null, 90000, 'guest read the QR with its camera');
  check(true, "player 2's camera read player 1's QR (jsQR, as on an iPhone)");
  const answer = await G.evaluate(() => document.querySelector('#netqr [data-k=mine] .qrbox').dataset.text);
  check(/^SOR1\|[^|]+\|a\|/.test(answer) && await decodeIn(G, '#netqr [data-k=mine] .qrbox') === answer, `player 2 shows its answer as a QR (${answer.length} characters)`);
  await G.screenshot({ path: `${OUT}/netqr_p2.png`, timeout: 240000 });
  // player 1 reads it (its camera fed the text)
  await H.evaluate((a) => window.__game.net.scanner.feed(a), answer);
  await waitFor(H, () => document.querySelectorAll('#nethost .netplayers span.in').length === 2, null, 60000, 'host room: player 2 in');
  await waitFor(G, () => !!document.querySelector('#netwait'), null, 30000, 'guest connected');
  check(true, 'connected with no internet at all');
  await click(H, '#nethost [data-a=go]');
  await click(H, '#diff .dcard[data-k=easy]');
  await click(H, '#select .card[data-id=yellow]');
  await click(G, '#select .card[data-id=red]');
  await Promise.all([waitState(H, ['intro', 'race']), waitState(G, ['intro', 'race'])]);
  const tracks = await Promise.all([H, G].map((p) => p.evaluate(() => document.querySelector('#intro .track')?.textContent)));
  check(tracks[0] && tracks[0] === tracks[1], `and the championship starts on both (${tracks[0]})`);
  await G.evaluate(() => window.__game.pause());
  await click(G, '#pause [data-a=quit]');
  await waitFor(H, () => !window.__game.net, null, 20000, 'host alone');
  check(true, 'player 2 leaves; player 1 goes on alone');
} catch (e) {
  check(false, 'flow: ' + e.message);
  await H.screenshot({ path: `${OUT}/netqr_fail_p1.png` }).catch(() => {});
}
check(!errors.length, 'no errors' + (errors.length ? ': ' + errors.slice(0, 6).join(' | ') : ''));
console.log(ok ? 'NETQR OK' : 'NETQR FAIL');
await bh.close(); if (bg) await bg.close();
server.close();
