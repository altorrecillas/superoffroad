// Keyboard, gamepad and touch input for up to 3 local players + menu navigation.

const KEYMAPS = [
  { left: ['ArrowLeft'], right: ['ArrowRight'], gas: ['ArrowUp'], brake: ['ArrowDown'], nitro: ['Enter', 'ShiftRight', 'ControlRight', 'Numpad0', 'Period', 'Slash', 'NumpadEnter'] },
  { left: ['KeyA'], right: ['KeyD'], gas: ['KeyW'], brake: ['KeyS'], nitro: ['ShiftLeft', 'KeyQ', 'KeyE', 'Tab'] },
  { left: ['KeyJ'], right: ['KeyL'], gas: ['KeyI'], brake: ['KeyK'], nitro: ['KeyU', 'KeyO', 'KeyH'] },
];
// single player: every scheme drives player 1, plus space / Z / X
const SOLO_EXTRA = { left: [], right: [], gas: ['KeyX'], brake: ['KeyC'], nitro: ['Space', 'KeyZ'] };

export class Input {
  constructor() {
    this.down = new Set();
    this.players = [0, 1, 2].map(() => ({ steer: 0, throttle: 0, brake: 0, nitro: false, nitroLatch: false, device: 'keys' }));
    this.solo = true;
    this.autoGas = [false, false, false];
    this.touch = null;        // set by the touch controller: {steer, gas, brake, nitroLatch}
    this.uiHandlers = [];
    this.padPrev = [];
    this.padOwner = new Map(); // gamepad index -> player
    this.lastDevice = 'keys';
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => this.down.clear());
  }

  // handlers run in priority order (higher first); returning true stops propagation
  onUI(fn, priority = 0) {
    fn.__prio = priority;
    this.uiHandlers.push(fn);
    this.uiHandlers.sort((a, b) => (b.__prio || 0) - (a.__prio || 0));
    return () => (this.uiHandlers = this.uiHandlers.filter((f) => f !== fn));
  }
  _ui(action, src) { for (const f of this.uiHandlers.slice()) if (f(action, src) === true) break; }

  _key(e, isDown) {
    const c = e.code;
    if (isDown) {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(c)) e.preventDefault();
      if (!this.down.has(c)) {
        this.lastDevice = 'keys';
        // nitro latches
        for (let p = 0; p < 3; p++) {
          const map = KEYMAPS[p];
          if (map.nitro.includes(c) || (this.solo && p === 0 && (SOLO_EXTRA.nitro.includes(c) || KEYMAPS[1].nitro.includes(c) || KEYMAPS[2].nitro.includes(c)))) {
            this.players[this.solo ? 0 : p].nitroLatch = true;
          }
        }
        const ui = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
          Enter: 'ok', Space: 'ok', NumpadEnter: 'ok', Escape: 'back', Backspace: 'back', KeyP: 'pause', KeyM: 'mute' }[c];
        if (ui) this._ui(ui, 'keys');
      }
      this.down.add(c);
    } else this.down.delete(c);
  }

  _any(list) { for (const k of list) if (this.down.has(k)) return true; return false; }

  // poll once per frame
  update() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let p = 0; p < 3; p++) {
      const s = this.players[p];
      const maps = this.solo && p === 0 ? [KEYMAPS[0], KEYMAPS[1], KEYMAPS[2], SOLO_EXTRA] : [KEYMAPS[p]];
      let l = false, r = false, g = false, b = false;
      for (const m of maps) { l ||= this._any(m.left); r ||= this._any(m.right); g ||= this._any(m.gas); b ||= this._any(m.brake); }
      s.steer = (r ? 1 : 0) - (l ? 1 : 0);
      s.throttle = g ? 1 : 0;
      s.brake = b ? 1 : 0;
      s.analog = false;
    }
    // gamepads
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!pad || !pad.connected) continue;
      const prev = this.padPrev[i] || [];
      const btn = (n) => pad.buttons[n] && (pad.buttons[n].pressed || pad.buttons[n].value > 0.5);
      const val = (n) => (pad.buttons[n] ? pad.buttons[n].value : 0);
      let owner = this.padOwner.get(i);
      if (owner == null) { owner = this.solo ? 0 : Math.min(2, this.padOwner.size); this.padOwner.set(i, owner); }
      if (this.solo) owner = 0;
      const s = this.players[owner];
      const ax = pad.axes[0] || 0;
      let steer = Math.abs(ax) > 0.18 ? (ax - Math.sign(ax) * 0.18) / 0.82 : 0;
      if (btn(14)) steer = -1;
      if (btn(15)) steer = 1;
      if (steer !== 0) { s.steer = Math.max(-1, Math.min(1, steer)); s.analog = true; this.lastDevice = 'pad'; }
      const gas = Math.max(btn(0) ? 1 : 0, val(7));
      const brk = Math.max(btn(1) ? 1 : 0, val(6));
      if (gas > 0.1) { s.throttle = Math.max(s.throttle, gas); this.lastDevice = 'pad'; }
      if (brk > 0.1) s.brake = Math.max(s.brake, brk);
      const nitroNow = btn(2) || btn(5) || btn(3) || btn(4);
      const nitroPrev = prev[2] || prev[5] || prev[3] || prev[4];
      if (nitroNow && !nitroPrev) s.nitroLatch = true;
      // menu navigation from the pad
      const cur = pad.buttons.map((b) => b.pressed);
      const edge = (n) => cur[n] && !prev[n];
      if (edge(12) || (pad.axes[1] < -0.6 && !(this._padAxisPrev?.[i] < -0.6))) this._ui('up', 'pad');
      if (edge(13) || (pad.axes[1] > 0.6 && !(this._padAxisPrev?.[i] > 0.6))) this._ui('down', 'pad');
      if (edge(14)) this._ui('left', 'pad');
      if (edge(15)) this._ui('right', 'pad');
      if (edge(0)) this._ui('ok', 'pad');
      if (edge(1)) this._ui('back', 'pad');
      if (edge(9)) this._ui('pause', 'pad');
      this.padPrev[i] = cur;
      (this._padAxisPrev ||= [])[i] = pad.axes[1];
    }
    // touch drives player 1
    if (this.touch) {
      const t = this.touch, s = this.players[0];
      if (t.active) {
        if (t.steer !== 0) { s.steer = t.steer; s.analog = !!t.analog; }
        if (t.targetHeading != null) s.targetHeading = t.targetHeading; else s.targetHeading = null;
        s.throttle = Math.max(s.throttle, t.gas);
        s.brake = Math.max(s.brake, t.brake);
        if (t.nitroLatch) { s.nitroLatch = true; t.nitroLatch = false; }
      }
    }
    for (let p = 0; p < 3; p++) {
      const s = this.players[p];
      if (this.autoGas[p] && !s.brake) s.throttle = 1;
    }
  }

  // the gamepad driving player p (for rumble), if any
  padOf(p) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (pad && pad.connected && (this.solo ? 0 : this.padOwner.get(i)) === p) return pad;
    }
    return null;
  }

  // input record for the simulation (nitro is consumed by the caller)
  get(p) {
    const s = this.players[p];
    s.nitro = s.nitroLatch;
    return s;
  }
  consumeNitro() { for (const s of this.players) { if (s.nitro) { s.nitroLatch = false; s.nitro = false; } } }
}
