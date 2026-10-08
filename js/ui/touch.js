// On-screen controls for phones and tablets (player 1).
// 'buttons': left/right steering buttons, gas and nitro on the right.
// 'stick':   a joystick that points the truck where you push (gas included).

import { h } from './ui.js';
import { safeInsets } from '../core/device.js';

// crisp vector icons (font glyphs like ◀ vary from phone to phone)
const ICON = {
  left: '<svg viewBox="0 0 24 24"><path d="M15 4 7 12l8 8" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 4l8 8-8 8" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  nitro: '<svg viewBox="0 0 24 24"><path d="M13.5 2 4.5 13.5h6.5L9.5 22l9.5-12.5h-6.7z" fill="currentColor"/></svg>',
  gas: '<svg viewBox="0 0 24 24"><path d="M12 3 4.5 11.5h4.5V21h6v-9.5h4.5z" fill="currentColor"/></svg>',
  brake: '<svg viewBox="0 0 24 24"><path d="M12 21 4.5 12.5h4.5V3h6v9.5h4.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/></svg>',
};

export class Touch {
  constructor(input, opt) {
    this.input = input;
    this.opt = opt;
    this.state = { active: false, steer: 0, gas: 0, brake: 0, nitroLatch: false, targetHeading: null, analog: false };
    input.touch = this.state;
    this.root = h('<div id="touch"></div>');
    document.body.appendChild(this.root);
    this.rotate = h('<div id="rotate"><img class="rot-logo" src="assets/ui/logo.webp" alt=""><div class="phone-ic"></div><div class="rot-msg">Gira el móvil</div><div class="rot-sub">Super Off Road se juega en horizontal</div></div>');
    document.body.appendChild(this.rotate);
    this.enabled = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    if (this.enabled) this.rotate.classList.add('need');
    this.mode = opt.touch || 'buttons';
    this.visible = false;
    this.camera = null;
    this.onPause = null;
    window.addEventListener('resize', () => this.layout());
  }

  setMode(m) { if (m === this.mode) return; this.mode = m; if (this.visible) { this.show(false); this.show(true); } }

  show(on) {
    this.visible = on && this.enabled;
    this.root.classList.toggle('on', this.visible);
    this.state.active = this.visible;
    this.root.innerHTML = '';
    this.state.steer = 0; this.state.gas = 0; this.state.brake = 0; this.state.targetHeading = null;
    if (!this.visible) return;
    const btn = (cls, icon, label = '') => { const b = h(`<div class="tbtn ${cls}">${ICON[icon]}${label ? `<span>${label}</span>` : ''}</div>`); this.root.appendChild(b); return b; };
    this.els = {};
    if (this.mode === 'stick') {
      const st = h('<div class="tstick"><i></i></div>');
      this.root.appendChild(st);
      this.els.stick = st;
      this._stick(st);
      this.els.nitro = btn('nitro', 'nitro', 'NITRO');
      this.els.brake = btn('brake', 'brake', 'FRENO');
      this._hold(this.els.brake, (v) => (this.state.brake = v));
    } else {
      this.els.left = btn('steer', 'left');
      this.els.right = btn('steer', 'right');
      this.els.gas = this.opt.autoGas ? btn('brake', 'brake', 'FRENO') : btn('gas', 'gas', 'GAS');
      // nitro next to the gas and/or over the steering pair (option BOTÓN DE NITRO):
      // the one over the steering lets that thumb fire it while the other stays on gas
      const where = this.opt.nitroPos || 'both';
      if (where !== 'steer') this.els.nitro = btn('nitro', 'nitro', 'NITRO');
      if (where !== 'gas') this.els.nitro2 = btn('nitro nitro2', 'nitro', 'NITRO');
      this._steerPad(this.els.left, this.els.right);
      if (this.opt.autoGas) this._hold(this.els.gas, (v) => (this.state.brake = v));
      else this._hold(this.els.gas, (v) => (this.state.gas = v));
    }
    for (const n of [this.els.nitro, this.els.nitro2]) if (n) this._hold(n, (v) => { if (v) this.state.nitroLatch = true; });
    const p = h(`<div class="tpause">${ICON.pause}</div>`);
    p.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onPause && this.onPause(); });
    this.root.appendChild(p);
    this.layout();
  }

  layout() {
    if (!this.visible || !this.els) return;
    // keep clear of the notch, the rounded corners and the home bar
    const si = safeInsets();
    const W = innerWidth - si.left - si.right, H = innerHeight - si.bottom;
    // button size option (CONTROLES: PEQUEÑOS / NORMALES / GRANDES)
    const k = { s: 0.84, m: 1, l: 1.18 }[this.opt.touchSize] || 1;
    const s = Math.max(56, Math.min(128, Math.min(W, H) * 0.2 * k));
    const pad = Math.max(14, s * 0.18);
    // left-handed: steering on the right, gas and nitro on the left
    const mirror = this.opt.touchSide === 'left';
    const place = (el, x, y, size) => {
      if (!el) return;
      Object.assign(el.style, { width: size + 'px', height: size + 'px', left: ((mirror ? W - x - size : x) + si.left) + 'px', top: y + 'px' });
    };
    if (this.mode === 'stick') {
      const ss = s * 1.7;
      place(this.els.stick, pad + 10, H - ss - pad, ss);
      place(this.els.nitro, W - s * 1.15 - pad, H - s * 1.15 - pad, s * 1.15);
      place(this.els.brake, W - s * 2.2 - pad * 1.5, H - s * 0.9 - pad, s * 0.9);
    } else {
      // mirrored, the pair keeps ◀ on the left of ▶
      place(mirror ? this.els.right : this.els.left, pad, H - s - pad, s);
      place(mirror ? this.els.left : this.els.right, pad + s + pad * 0.8, H - s - pad, s);
      // centred over the pair, with a gap so a thumb on ◀ ▶ does not catch it
      const n2 = s * 0.86, pairMid = pad + s + pad * 0.4;
      place(this.els.nitro2, pairMid - n2 / 2, H - s - pad - Math.max(10, pad * 0.75) - n2, n2);
      place(this.els.gas, W - s * 1.2 - pad, H - s * 1.2 - pad, s * 1.2);
      place(this.els.nitro, W - s * 2.15 - pad * 1.6, H - s * 0.95 - pad, s * 0.95);
    }
  }

  _hold(el, fn) {
    const ids = new Set();
    const set = () => { el.classList.toggle('down', ids.size > 0); fn(ids.size > 0 ? 1 : 0); };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); ids.add(e.pointerId); try { el.setPointerCapture(e.pointerId); } catch (x) { /* */ } set(); });
    const up = (e) => { ids.delete(e.pointerId); set(); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  // the two steering buttons act as one pad: a thumb can slide from one to the
  // other without lifting (each finger steers towards the side it is over)
  _steerPad(L, R) {
    const fingers = new Map(); // pointerId -> -1 | 1
    const side = (x) => {
      const a = L.getBoundingClientRect(), b = R.getBoundingClientRect();
      return x > (a.right + b.left) / 2 ? 1 : -1;
    };
    const apply = () => {
      let l = 0, r = 0;
      for (const v of fingers.values()) { if (v < 0) l = 1; else r = 1; }
      L.classList.toggle('down', l > 0); R.classList.toggle('down', r > 0);
      this.state.steer = r - l;
    };
    for (const el of [L, R]) {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch (x) { /* */ }
        fingers.set(e.pointerId, side(e.clientX));
        apply();
      });
      el.addEventListener('pointermove', (e) => {
        if (!fingers.has(e.pointerId)) return;
        const v = side(e.clientX);
        if (v !== fingers.get(e.pointerId)) { fingers.set(e.pointerId, v); apply(); }
      });
      const up = (e) => { if (fingers.delete(e.pointerId)) apply(); };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    }
  }

  _stick(el) {
    const knob = el.querySelector('i');
    let id = null;
    const move = (e) => {
      const r = el.getBoundingClientRect();
      let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      knob.style.transform = `translate(${dx * r.width * 0.3}px, ${dy * r.height * 0.3}px)`;
      const mag = Math.min(1, l);
      this.stickVec = mag > 0.25 ? [dx, dy, mag] : null;
    };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; try { el.setPointerCapture(id); } catch (x) { /* */ } move(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const up = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; this.stickVec = null; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // stick direction is relative to the screen: convert with the camera
  update() {
    if (!this.visible || this.mode !== 'stick') return;
    const v = this.stickVec;
    if (!v || !this.camera) { this.state.targetHeading = null; this.state.gas = 0; return; }
    const e = this.camera.matrixWorld.elements;
    let rx = e[0], rz = e[2], fx = -e[8], fz = -e[10];
    const rl = Math.hypot(rx, rz) || 1, fl = Math.hypot(fx, fz) || 1;
    rx /= rl; rz /= rl; fx /= fl; fz /= fl;
    const wx = rx * v[0] - fx * v[1], wz = rz * v[0] - fz * v[1];
    this.state.targetHeading = Math.atan2(wz, wx);
    this.state.gas = v[2] > 0.55 ? 1 : 0.6;
  }
}
