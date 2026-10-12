// The guided first lap: one step at a time (accelerate, steer, slow down for a bend,
// nitro, pick something up, finish the lap), each one done by doing it. The words
// follow the controls in use (touch, keyboard, gamepad) and on a phone the button to
// press glows.

const STEPS = [
  { id: 'gas', title: 'ACELERA', touch: 'Mantén pulsado <b>GAS</b>', keys: 'Mantén pulsada <b>↑</b>', pad: 'Mantén <b>A</b> o el gatillo derecho', glow: ['gas'] },
  { id: 'steer', title: 'GIRA', touch: 'Usa <b>◀ ▶</b> y sigue las flechas del suelo', tilt: 'Gira el móvil como un volante y sigue las flechas', keys: 'Usa <b>← →</b> y sigue las flechas del suelo', pad: 'Usa el <b>stick</b> y sigue las flechas del suelo', glow: ['steer'] },
  { id: 'slow', title: 'CURVA CERRADA', touch: 'Cuando la línea se ponga <b class="r">roja</b>, suelta el <b>GAS</b>', keys: 'Cuando la línea se ponga <b class="r">roja</b>, frena con <b>↓</b>', pad: 'Cuando la línea se ponga <b class="r">roja</b>, frena con <b>B</b>', glow: ['brake'] },
  { id: 'nitro', title: 'NITRO', touch: 'En una recta, toca <b>NITRO</b>', keys: 'En una recta, pulsa <b>ESPACIO</b>', pad: 'En una recta, pulsa <b>X</b> o <b>RB</b>', glow: ['nitro'] },
  { id: 'pickup', title: 'RECOGE', touch: 'Pasa por encima de la <b class="g">bolsa de dinero</b>', keys: 'Pasa por encima de la <b class="g">bolsa de dinero</b>', pad: 'Pasa por encima de la <b class="g">bolsa de dinero</b>' },
  { id: 'lap', title: 'COMPLETA LA VUELTA', touch: 'Sigue las flechas hasta la meta', keys: 'Sigue las flechas hasta la meta', pad: 'Sigue las flechas hasta la meta' },
];

export class Tutorial {
  constructor(game) {
    this.g = game;
    this.k = -1;
    this.t = 0;
    this.done = false;
  }

  get step() { return STEPS[this.k]; }

  _device() {
    const g = this.g;
    if (g.input.lastDevice === 'pad') return 'pad';
    if (g.touch.visible) return g.touch.mode === 'tilt' ? 'tilt' : 'touch';
    return 'keys';
  }

  _show() {
    const s = this.step, dev = this._device();
    const text = s[dev] || s.touch;
    this.g.ui.show('tutor', `<div class="tutor"><div class="tn">${this.k + 1}/${STEPS.length}</div><div class="tt">${s.title}</div><div class="tx">${text}</div><div class="tbar"><i></i></div></div>`, 'passive');
    this._glow(s.glow || []);
    this.g.audio.sfx('lap', { vol: 0.45, vary: 0, ui: true });
  }

  _glow(list) {
    const els = this.g.touch.els || {};
    for (const k in els) if (els[k] && els[k].classList) els[k].classList.remove('hint');
    for (const k of list) {
      if (k === 'steer') { for (const e of [els.left, els.right]) if (e) e.classList.add('hint'); }
      else if (k === 'nitro') { for (const e of [els.nitro, els.nitro2]) if (e) e.classList.add('hint'); }
      else if (k === 'brake') { const e = els.brake || els.gas; if (e) e.classList.add('hint'); }
      else if (els[k]) els[k].classList.add('hint');
    }
  }

  next() {
    this.k++;
    this.t = 0;
    this.prog0 = this.me ? this.me.prog : 0;
    this.lap0 = this.me ? this.me.lap : 0;
    if (this.k >= STEPS.length) return this._finish();
    if (this.step.id === 'pickup') this._spawnBag();
    this._show();
  }

  // a money bag on the racing line, 35 m ahead
  _spawnBag() {
    const race = this.g.race, tr = race.track, ln = tr.line, me = this.me;
    const stride = ln.idx[1] - ln.idx[0] || 4;
    const k = (Math.floor(me.idx / stride) + Math.round(35 / (stride * tr.path.ds))) % ln.m;
    const x = ln.x[k], z = ln.z[k];
    race.pickups.push({ id: (race._pid = (race._pid || 0) + 1), type: 'money', value: 10000, x, z, y: tr.heightAt(x, z), age: 0, life: 9999, taken: false });
    this.bagT = 0;
  }

  // per frame while racing; me: the player's racer
  update(dt, me, inp) {
    if (this.done) return;
    this.me = me;
    const race = this.g.race;
    if (this.k < 0) { if (race.state === 'race') this.next(); return; }
    this.t += dt;
    const s = this.step;
    let ok = false, fill = 0;
    if (s.id === 'gas') { fill = Math.min(1, me.truck.vf / 9); ok = me.truck.vf > 9; }
    else if (s.id === 'steer') { const d = me.prog - this.prog0; fill = Math.min(1, d / 90); ok = d > 90; }
    else if (s.id === 'slow') {
      // lifting off (or braking) for a moment, begun at speed (the truck may slow right down)
      const off = inp.throttle < 0.1 || inp.brake > 0.2;
      if (!off) this.offT = 0;
      else if (this.offT || me.truck.vf > 7) this.offT = (this.offT || 0) + dt;
      fill = Math.min(1, (this.offT || 0) / 0.3);
      ok = this.offT > 0.3;
    } else if (s.id === 'nitro') ok = me.truck.nitroT > 0;
    else if (s.id === 'pickup') {
      const live = race.pickups.some((p) => p.type === 'money' && p.life > 9000);
      if (!live) ok = true;
      else if ((this.bagT += dt) > 25) { race.pickups = race.pickups.filter((p) => p.life < 9000); this._spawnBag(); } // missed it: another one
    } else if (s.id === 'lap') { fill = Math.min(1, (((me.prog % race.track.L) + race.track.L) % race.track.L) / race.track.L); ok = me.lap > this.lap0; }
    const bar = this.g.ui.get('tutor') && this.g.ui.get('tutor').querySelector('.tbar i');
    if (bar) bar.style.width = `${Math.round((ok ? 1 : fill) * 100)}%`;
    if (ok && this.t > 0.6) {
      this.g.ui.toast('¡Bien!', 'money small', 900);
      this.next();
    }
  }

  _finish() {
    this.done = true;
    this._glow([]);
    this.g.ui.show('tutor', `<div class="tutor end"><div class="tt">¡LISTO!</div><div class="tx">Ya sabes lo básico. Ahora, a por Ironman.</div></div>`, 'passive');
    this.g.audio.sfx('horn', { vol: 0.5, vary: 0 });
    this.g.audio.announce('winner');
    if (this.g.career) this.g.career.unlock('school');
    this.g.opt.tutorialDone = true;
    this.g.saveOpt();
    setTimeout(() => this.g.endTutorial(), 3200);
  }
}
