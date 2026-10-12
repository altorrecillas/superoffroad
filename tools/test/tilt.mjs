// Tilt steering: with the option INCLINAR, turning the phone (synthetic devicemotion
// events, as the sensor sends them) steers the truck; the position held at the start
// is straight ahead, and a device without the sensor falls back to the buttons.
// The sensor is only used once INCLINAR is chosen in the options: CONTROL TÁCTIL opens
// a choice of three (no cycling past INCLINAR). Chrome answers the permission with the
// site's setting (granted or not, never a question). On an iPhone (a stand-in for its
// DeviceMotionEvent.requestPermission) the question comes only from the tap on INCLINAR,
// never when the game starts; a permission the phone forgot sends the race back to
// the buttons, with no question.
// Usage: GAME_ROOT=<dir> node tilt.mjs [outDir]
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = process.env.GAME_ROOT;
const OUT = process.argv[2] || '.';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f.endsWith('/') ? f + 'index.html' : f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
await new Promise((r) => server.listen(0, r));
const URL = `http://localhost:${server.address().port}/index.html?q=low&nofade=1`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
let ok = true;
const check = (c, what) => { console.log((c ? '  ok   ' : '  FAIL ') + what); if (!c) ok = false; };

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
async function phone(iphone) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 360 }, isMobile: true, hasTouch: true, ...(iphone ? { userAgent: IPHONE_UA } : {}) });
  if (!iphone) {
    // Chrome's own requestPermission, watched
    await ctx.addInitScript(() => {
      window.__perm = [];
      const own = DeviceMotionEvent.requestPermission;
      if (own) DeviceMotionEvent.requestPermission = function () { window.__perm.push(!!(navigator.userActivation && navigator.userActivation.isActive)); return own.call(this); };
    });
  } else {
    // the iPhone's permission: asked from a tap it shows the question (answered by
    // test.perm); asked without one it only says what it remembers
    await ctx.addInitScript(() => {
      window.__perm = [];
      DeviceMotionEvent.requestPermission = () => {
        const tap = !!(navigator.userActivation && navigator.userActivation.isActive);
        window.__perm.push(tap);
        const m = localStorage.getItem('test.perm') || 'yes';
        if (m === 'remember') return Promise.resolve('granted');
        if (!tap) return Promise.reject(new DOMException('Requesting device motion access requires a user gesture to prompt', 'NotAllowedError'));
        return Promise.resolve(m === 'no' ? 'denied' : 'granted');
      };
    });
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  return page;
}
const state = (page) => page.evaluate(() => window.__game && window.__game.state);
const waitState = async (page, s, ms = 120000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await state(page); if (v === s || (Array.isArray(s) && s.includes(v))) return v; await page.waitForTimeout(300); } throw new Error('timeout waiting ' + s + ' got ' + await state(page)); };
// every message shown (software rendering is so slow they can be gone before a look)
const load = async (page) => {
  await page.goto(URL);
  await waitState(page, 'title', 120000);
  await page.evaluate(() => {
    const ui = window.__game.ui, own = ui.toast.bind(ui), show = ui.show.bind(ui);
    window.__toasts = []; window.__intro = '';
    ui.toast = (text, ...a) => { window.__toasts.push(text); return own(text, ...a); };
    ui.show = (id, html, ...a) => { if (id === 'intro') window.__intro = html; return show(id, html, ...a); };
  });
};
const refused = (page) => page.waitForFunction(() => { const c = document.querySelector('#ctrlpick .ccard.refused'); return c && /Sin permiso/.test(c.textContent); }, null, { timeout: 15000 });
const said = (page, re) => page.waitForFunction((src) => window.__toasts.some((t) => new RegExp(src).test(t)), re.source, { timeout: 15000 });
// the phone held in landscape (top of the phone to the left: screen angle 90), turned by
// `deg` clockwise like a wheel, a little tilted back
const motion = (page, deg) => page.evaluate((deg) => {
  const r = (deg * Math.PI) / 180, g = 9.81, back = 0.55;
  // gravity reaction in screen coordinates: up, rotated by the turn
  const sx = -Math.sin(r) * g * Math.cos(back), sy = Math.cos(r) * g * Math.cos(back);
  // to device coordinates for screen angle 90: x_d = screen up, y_d = screen left
  const ev = new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: sy, y: -sx, z: g * Math.sin(back) }, interval: 16 });
  window.dispatchEvent(ev);
}, deg);
const info = (page) => page.evaluate(() => {
  const g = window.__game, pk = document.querySelector('#ctrlpick'), v = document.querySelector('#options [data-k=touch] .val');
  return { opt: g.opt.touch, mode: g.touch.mode, listening: g.touch._listening, picker: !!pk, cards: pk ? pk.querySelectorAll('.ccard').length : 0, cur: pk && pk.querySelector('.ccard.cur') ? pk.querySelector('.ccard.cur').dataset.k : null,
    val: v ? v.textContent : null, optsHidden: document.querySelector('#options') ? getComputedStyle(document.querySelector('#options')).visibility === 'hidden' : null, nav: g.ui.nav && g.ui.nav.screen, perm: window.__perm ? window.__perm.slice() : null,
    toasts: window.__toasts.join(' | '), tiltCard: pk ? pk.querySelector('.ccard[data-k=tilt]').textContent : '' };
});
const toOptions = (page) => page.evaluate(() => { const g = window.__game; g.ui.hide('title'); g.toMenu(); g.ui.hide('menu'); g.toOptions(() => g.toMenu()); });
const openPicker = (page) => page.tap('#options [data-k=touch]');
const pick = (page, k) => page.tap(`#ctrlpick .ccard[data-k=${k}]`);
const race = async (page) => {
  await page.evaluate(() => { const g = window.__game; g.ui.hideAll(); g.toMenu(); g.startChampionship([{ truckId: 'red', vehicle: 'truck' }], 'normal'); });
  await waitState(page, ['intro', 'race']);
};

try {
  // ---- a phone that gives the sensor without asking (Android)
  {
    const page = await phone(false);
    await load(page);
    let s = await info(page);
    check(s.opt !== 'tilt' && !s.listening, `the sensor is not listened to before INCLINAR is chosen (${s.opt})`);
    await toOptions(page);
    await openPicker(page);
    s = await info(page);
    check(s.picker && s.cards === 3 && s.cur === 'buttons' && s.opt === 'buttons' && s.optsHidden && s.nav === 'ctrlpick', 'CONTROL TÁCTIL opens a choice of three (buttons in use) instead of cycling');
    check(!/pedirá permiso/.test(await page.evaluate(() => document.querySelector('#ctrlpick .ccard[data-k=tilt]').textContent)), 'no "it will ask" note where the phone does not ask');
    await pick(page, 'stick');
    s = await info(page);
    check(!s.picker && s.opt === 'stick' && s.mode === 'stick' && s.val === 'JOYSTICK' && !s.optsHidden && s.nav === 'options' && !s.listening, 'JOYSTICK chosen: back to the options, no sensor');
    // keys: → on the row opens the choice too, Esc closes it untouched
    await page.keyboard.press('ArrowRight');
    s = await info(page);
    check(s.picker && s.cur === 'stick', '→ on CONTROL TÁCTIL opens the choice');
    await page.keyboard.press('Escape');
    s = await info(page);
    check(!s.picker && s.opt === 'stick' && s.nav === 'options', 'Esc closes it with nothing changed');
    // motion sensors blocked for the site: INCLINAR is refused
    await openPicker(page);
    await pick(page, 'tilt');
    await refused(page);
    s = await info(page);
    check(s.opt === 'stick' && s.picker && !s.listening && /ajustes del sitio/.test(s.tiltCard), 'motion sensors blocked: INCLINAR refused (the card says where to allow them), JOYSTICK kept');
    // allowed (Chrome's default)
    await page.context().grantPermissions(['accelerometer', 'gyroscope']);
    await pick(page, 'tilt');
    await page.waitForFunction(() => window.__game.opt.touch === 'tilt', null, { timeout: 5000 });
    s = await info(page);
    check(s.mode === 'tilt' && s.listening && s.val === 'INCLINAR' && !s.picker, 'INCLINAR chosen: the sensor is listened to');
    await page.screenshot({ path: `${OUT}/tilt_options.png` });
    // next visit: on again by itself, with no question
    await load(page);
    s = await info(page);
    check(s.opt === 'tilt' && s.mode === 'tilt' && s.listening && s.perm.every((t) => !t), `next visit: tilt on with no tap needed ${JSON.stringify(s.perm)}`);

    await page.evaluate(() => { try { Object.defineProperty(screen.orientation, 'angle', { get: () => 90, configurable: true }); } catch (e) { /* */ } });
    await race(page);
    for (let i = 0; i < 10; i++) { await motion(page, 8); await page.waitForTimeout(30); } // held a little turned: that is straight ahead
    await page.evaluate(() => { const g = window.__game; g.introT = g.introHold; });
    await waitState(page, 'race');
    await page.waitForFunction(() => window.__game.race.state === 'countdown' && window.__game.race.time > -0.3 || window.__game.race.state === 'race', null, { timeout: 60000, polling: 50 });
    for (let i = 0; i < 6; i++) { await motion(page, 8); await page.waitForTimeout(30); }
    await page.evaluate(() => window.__game.touch.calibrate());
    const els = await page.evaluate(() => ({ gas: !!document.querySelector('#touch .tbtn.gas'), brake: !!document.querySelector('#touch .tbtn.brake'), nitros: document.querySelectorAll('#touch .tbtn.nitro').length, bar: !!document.querySelector('#touch .ttilt'), steerBtns: document.querySelectorAll('#touch .tbtn.steer').length }));
    check(els.gas && els.brake && els.nitros === 2 && els.bar && els.steerBtns === 0, `tilt pad: gas, brake, two nitros, the tilt bar, no steering buttons`);
    // the steering the touch layer computes from the sensor (synchronously: software
    // rendering runs the frame loop at about one frame a second)
    const read = async (deg) => { for (let i = 0; i < 12; i++) await motion(page, deg); return page.evaluate(() => { const t = window.__game.touch; t.update(0); return t.state.steer; }); };
    const straight = await read(8), right = await read(8 + 20), left = await read(8 - 30), small = await read(9.5);
    check(Math.abs(straight) < 0.05, `held as at the start: straight ahead (${straight.toFixed(2)})`);
    check(right > 0.7, `turned 20° clockwise: steers right (${right.toFixed(2)})`);
    check(left < -0.99, `turned 30° the other way: full left (${left.toFixed(2)})`);
    check(Math.abs(small) < 0.02, `a 1.5° wobble is ignored (${small.toFixed(2)})`);
    // and the game reads it as player 1's steering
    await read(8 + 20);
    await page.waitForFunction(() => window.__game.input.players[0].steer > 0.7, null, { timeout: 30000, polling: 100 });
    check(true, 'the game steers with it (player 1 input)');
    await page.screenshot({ path: `${OUT}/tilt_pad.png` });
    await page.context().close();
  }

  // ---- an iPhone: the motion sensor needs a permission
  {
    const page = await phone(true);
    await load(page);
    let s = await info(page);
    check(s.perm.length === 0 && !s.listening, 'starting the game asks nothing');
    await toOptions(page);
    await openPicker(page);
    await pick(page, 'stick');
    await openPicker(page);
    s = await info(page);
    check(s.perm.length === 0 && s.opt === 'stick', 'opening the choice and picking JOYSTICK asks nothing');
    const tilt = await page.evaluate(() => document.querySelector('#ctrlpick .ccard[data-k=tilt]').textContent);
    check(/pedirá permiso/.test(tilt), 'the INCLINAR card says the phone will ask');
    await page.screenshot({ path: `${OUT}/tilt_picker.png` });
    // the question answered no: nothing changes
    await page.evaluate(() => localStorage.setItem('test.perm', 'no'));
    await pick(page, 'tilt');
    await refused(page);
    s = await info(page);
    check(s.perm.length === 1 && s.perm[0] === true && s.opt === 'stick' && s.picker && !s.listening && /cierra el navegador/.test(s.tiltCard), `INCLINAR asks from the tap; a no keeps JOYSTICK and the card says how to ask again (asked: ${JSON.stringify(s.perm)})`);
    await page.screenshot({ path: `${OUT}/tilt_refused.png` });
    // and answered yes
    await page.evaluate(() => localStorage.setItem('test.perm', 'yes'));
    await pick(page, 'tilt');
    await page.waitForFunction(() => window.__game.opt.touch === 'tilt', null, { timeout: 5000 });
    s = await info(page);
    check(s.perm.length === 2 && s.perm[1] === true && s.mode === 'tilt' && s.listening && !s.picker, 'a yes: INCLINAR on, sensor listened to');

    // the next visit, the phone still remembers it: back on with no question
    await page.evaluate(() => localStorage.setItem('test.perm', 'remember'));
    await load(page);
    s = await info(page);
    check(s.opt === 'tilt' && s.listening && s.perm.length === 1 && s.perm[0] === false, `next visit, permission remembered: tilt on, asked without a tap (no question) ${JSON.stringify(s.perm)}`);
    await race(page);
    s = await info(page);
    check(s.mode === 'tilt' && await page.evaluate(() => !!document.querySelector('#touch .ttilt')), 'the race uses tilt');

    // the phone forgot it (Safari closed): no question, the race goes with the buttons
    await page.evaluate(() => localStorage.setItem('test.perm', 'yes'));
    await load(page);
    s = await info(page);
    check(s.opt === 'tilt' && !s.listening && s.perm.length === 1 && s.perm[0] === false, 'next visit, permission forgotten: nothing asked when the game starts');
    await page.evaluate(() => { const g = window.__game; g.ui.hideAll(); g.toMenu(); g.startChampionship([{ truckId: 'red', vehicle: 'truck' }], 'normal'); });
    await page.screenshot({ path: `${OUT}/tilt_forgot.png` });
    await waitState(page, ['intro', 'race']);
    await page.waitForFunction(() => /NECESITA TU PERMISO/.test(window.__intro), null, { timeout: 15000 });
    s = await info(page);
    const pad = await page.evaluate(() => ({ steer: document.querySelectorAll('#touch .tbtn.steer').length, bar: !!document.querySelector('#touch .ttilt'), saved: JSON.parse(localStorage.getItem('sor.options.v1')).touch }));
    check(s.mode === 'buttons' && s.opt === 'buttons' && pad.saved === 'buttons' && pad.steer === 2 && !pad.bar && s.perm.length === 1, 'the race starts with the buttons and its banner says to choose INCLINAR again in the options');

    // forgotten, but this time INCLINAR is chosen again in the options before racing
    await page.evaluate(() => { const o = JSON.parse(localStorage.getItem('sor.options.v1')); o.touch = 'tilt'; localStorage.setItem('sor.options.v1', JSON.stringify(o)); });
    await load(page);
    await toOptions(page);
    await openPicker(page);
    s = await info(page);
    check(s.cur === 'tilt' && /olvidado el permiso/.test(s.tiltCard) && s.perm.length === 1 && !s.listening, 'the INCLINAR card says the phone forgot the permission');
    await pick(page, 'tilt');
    await page.waitForFunction(() => window.__game.touch._listening, null, { timeout: 15000 });
    s = await info(page);
    check(s.perm.length === 2 && s.perm[1] === true && s.mode === 'tilt' && !s.picker, 'a tap on it asks again and turns the sensor back on');
    await race(page);
    s = await info(page);
    check(s.mode === 'tilt' && await page.evaluate(() => !!document.querySelector('#touch .ttilt') && !/NECESITA/.test(window.__intro)), 'and the race uses tilt');
    await page.context().close();
  }
} catch (e) { check(false, 'flow: ' + e.message); }
check(!errors.length, 'no errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(ok ? 'TILT OK' : 'TILT FAIL');
await browser.close(); server.close();
