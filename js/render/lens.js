// Mud and water on the lens of the chase camera (CÁMARA PERSECUCIÓN): ploughing through
// water, a hard landing and the dirt a truck just ahead throws up leave a few drops and
// splats on the picture, which run and fade in a moment. Small and towards the sides of
// the screen, a few at a time: they never hide the race.

const MAX = 7;

export class LensDirt {
  constructor() {
    this.root = null;
    this.n = 0;
    this.cool = 0;
  }

  _el() {
    if (!this.root) {
      this.root = document.createElement('div');
      this.root.id = 'lens';
      document.body.appendChild(this.root);
    }
    return this.root;
  }

  // one splat: 'mud' (brown, sticks a while) or 'water' (clear drops that run down)
  splat(kind, big = 0.5) {
    if (this.n >= MAX) return;
    const root = this._el();
    const el = document.createElement('i');
    el.className = `lz ${kind}`;
    // the sides and the top: the middle low is where the truck is
    const side = Math.random() < 0.5;
    const x = side ? 2 + Math.random() * 26 : 72 + Math.random() * 24;
    const y = 4 + Math.random() * 62;
    const mud = kind === 'mud';
    const s = (mud ? 8 : 5) + Math.random() * (mud ? 7 : 5) * (0.5 + big);
    const life = mud ? 2.6 + Math.random() * 1.8 : 1.4 + Math.random() * 1;
    const r = () => 38 + Math.round(Math.random() * 24);
    // a few smaller drops thrown round a mud splat (shrunken copies of it, as shadows)
    const drops = mud ? [0, 1, 2].map(() => {
      const a = Math.random() * 6.28, d = s * (0.55 + Math.random() * 0.4);
      return `${(Math.cos(a) * d).toFixed(1)}vmin ${(Math.sin(a) * d).toFixed(1)}vmin 0 -${(s * (0.3 + Math.random() * 0.12)).toFixed(1)}vmin rgba(70, 46, 25, 0.75)`;
    }).join(', ') : '';
    Object.assign(el.style, {
      left: x + 'vw', top: y + 'vh', width: s + 'vmin', height: s * (0.75 + Math.random() * 0.5) + 'vmin',
      borderRadius: `${r()}% ${r()}% ${r()}% ${r()}% / ${r()}% ${r()}% ${r()}% ${r()}%`,
      transform: `rotate(${Math.round(Math.random() * 360)}deg)`, boxShadow: drops,
      animationDuration: life + 's',
    });
    root.appendChild(el);
    this.n++;
    setTimeout(() => { if (el.isConnected) { el.remove(); this.n--; } }, life * 1000);
  }

  // every frame of a race. me: this device's truck while the chase camera is on it
  // (null: none of it, and what is on the lens goes); others: the race's racers
  update(dt, me, racers) {
    if (!me) { if (this.n && this.root) this.clear(); return; }
    this.cool -= dt;
    if (this.cool > 0) return;
    const t = me.truck;
    // through water: drops
    if (t.water > 0.05 && t.speed > 7 && Math.random() < dt * 9) { this.splat('water', t.speed / 25); this.cool = 0.12; return; }
    // a truck just ahead throwing dirt (or water) back at us
    const fx = Math.cos(t.h), fz = Math.sin(t.h);
    for (const o of racers) {
      if (o === me) continue;
      const u = o.truck, dx = u.x - t.x, dz = u.z - t.z, d = Math.hypot(dx, dz);
      if (d > 11 || d < 2 || (dx * fx + dz * fz) < d * 0.8 || u.air) continue;
      const wet = u.water > 0.05;
      const throwing = wet ? u.speed > 6 : u.slip > 3 || (u.throttle > 0.5 && u.speed > 8);
      if (throwing && Math.random() < dt * (wet ? 5 : 2.2) * (1 - d / 12)) { this.splat(wet ? 'water' : 'mud', 0.4); this.cool = 0.25; return; }
    }
  }

  // a hard landing of our own truck splashes the lens (0..1)
  land(k) { if (k > 0.35) for (let i = 0; i < (k > 0.75 ? 2 : 1); i++) this.splat('mud', k); }

  clear() {
    if (!this.root) return;
    this.root.innerHTML = '';
    this.n = 0;
  }
}
