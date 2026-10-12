// The cup ceremony: the three best drivers of the cup on a podium under the
// lights, a golden trophy, confetti and spark fountains, a giant screen with the
// cup's name, and a camera that moves in on the winner and then circles the stage.

import * as THREE from 'three';
import { TruckView } from './truckview.js';
import { paintOf } from '../game/liveries.js';

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const BLOCKS = [ // place: x, height, trim colour
  { x: 0, h: 1.5, trim: 0xffc21a },
  { x: -5.2, h: 1.0, trim: 0xcfd6de },
  { x: 5.2, h: 0.62, trim: 0xd4874a },
];
const CONFETTI = 260;
const SPARKS = 160;

export class Podium {
  constructor(view, templates) {
    this.view = view;
    this.templates = templates;
    const s = (this.scene = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.3, 200);
    s.background = new THREE.Color(0x07060a);
    s.fog = new THREE.Fog(0x07060a, 22, 60);
    s.environment = view.scene.environment;
    s.environmentIntensity = 0.45;
    this.disposables = [];
    const keep = (x) => (this.disposables.push(x), x);

    // stage floor: glossy black with a red carpet up to the podium
    const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(80, 80)), keep(new THREE.MeshStandardMaterial({ color: 0x0d0c10, roughness: 0.22, metalness: 0.3 })));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    const carpet = new THREE.Mesh(keep(new THREE.PlaneGeometry(4.2, 18)), keep(new THREE.MeshStandardMaterial({ color: 0x8e0f0b, roughness: 0.85 })));
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(0, 0.012, 7);
    carpet.receiveShadow = true;
    s.add(carpet);

    // the podium: three blocks with the place on the front
    this.blocks = BLOCKS.map((b, i) => {
      const num = keep(canvasTex(256, 256, (g, w, h) => {
        g.fillStyle = '#f2f0ea'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#c81d18'; g.fillRect(0, h * 0.84, w, h * 0.16);
        g.font = 'italic 900 170px "Russo", "Arial Black", sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = '#1a1412'; g.fillText(String(i + 1), w / 2, h * 0.44);
      }));
      const side = keep(new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.5 }));
      const front = keep(new THREE.MeshStandardMaterial({ map: num, roughness: 0.5 }));
      const top = keep(new THREE.MeshStandardMaterial({ color: b.trim, roughness: 0.28, metalness: 0.75 }));
      const geo = keep(new THREE.BoxGeometry(5, b.h, 3.6));
      const m = new THREE.Mesh(geo, [side, side, top, side, front, side]);
      m.position.set(b.x, b.h / 2, 0);
      m.castShadow = m.receiveShadow = true;
      s.add(m);
      return m;
    });

    // the giant screen behind the podium (its texture is drawn per cup)
    this.screenCanvas = document.createElement('canvas');
    this.screenCanvas.width = 1024; this.screenCanvas.height = 384;
    this.screenTex = keep(new THREE.CanvasTexture(this.screenCanvas));
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(keep(new THREE.PlaneGeometry(22, 8.25)), keep(new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false, color: new THREE.Color(1.5, 1.5, 1.5) })));
    screen.position.set(0, 6.4, -7.5);
    s.add(screen);
    const frame = new THREE.Mesh(keep(new THREE.BoxGeometry(22.8, 9, 0.4)), keep(new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.4, metalness: 0.6 })));
    frame.position.set(0, 6.4, -7.75);
    s.add(frame);

    // the trophy, on a pedestal in front of the podium
    const gold = keep(new THREE.MeshStandardMaterial({ color: 0xffc83a, roughness: 0.16, metalness: 1 }));
    const cupPts = [[0, 0], [0.55, 0], [0.55, 0.12], [0.18, 0.2], [0.12, 0.5], [0.16, 0.62], [0.42, 0.75], [0.62, 1.1], [0.66, 1.42], [0.6, 1.44], [0.56, 1.12], [0.38, 0.82], [0, 0.78]]
      .map(([x, y]) => new THREE.Vector2(x, y));
    const trophy = new THREE.Group();
    const body = new THREE.Mesh(keep(new THREE.LatheGeometry(cupPts, 40)), gold);
    body.castShadow = true;
    trophy.add(body);
    for (const sx of [-1, 1]) {
      const handle = new THREE.Mesh(keep(new THREE.TorusGeometry(0.26, 0.05, 10, 24, Math.PI * 1.2)), gold);
      handle.position.set(sx * 0.66, 1.08, 0);
      handle.rotation.z = sx > 0 ? -Math.PI * 0.6 : Math.PI * 1.6;
      trophy.add(handle);
    }
    // low and well forward: in the foreground, below the line of sight to the podium
    const ped = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.7, 0.85, 0.3, 32)), keep(new THREE.MeshStandardMaterial({ color: 0x16151a, roughness: 0.35, metalness: 0.5 })));
    ped.position.y = 0.15;
    ped.castShadow = ped.receiveShadow = true;
    trophy.position.set(0, 0.3, 0);
    trophy.scale.setScalar(0.85);
    this.trophy = new THREE.Group();
    this.trophy.add(ped, trophy);
    this.trophy.position.set(0, 0, 6.8);
    this.trophyCup = trophy;
    s.add(this.trophy);

    // lights: a key light per block, a blue rim, a light sweeping the stage
    s.add(new THREE.HemisphereLight(0x8a96c8, 0x1a1210, 0.55));
    BLOCKS.forEach((b, i) => {
      const sp = new THREE.SpotLight(i === 0 ? 0xfff0c8 : 0xffffff, i === 0 ? 420 : 260, 0, 0.42, 0.55, 2);
      sp.position.set(b.x * 0.7, 12, 7);
      sp.target.position.set(b.x, b.h, 0);
      if (i === 0) { sp.castShadow = true; sp.shadow.mapSize.set(1024, 1024); sp.shadow.bias = -0.0004; }
      s.add(sp, sp.target);
    });
    const rim = new THREE.SpotLight(0x7fb0ff, 260, 0, 0.7, 0.6, 2);
    rim.position.set(0, 9, -9); rim.target.position.set(0, 1, 0);
    s.add(rim, rim.target);
    this.sweep = new THREE.SpotLight(0xffd36a, 300, 0, 0.18, 0.4, 2);
    this.sweep.position.set(0, 14, 10);
    s.add(this.sweep, this.sweep.target);
    const tl = new THREE.PointLight(0xffc040, 18, 6, 2);
    tl.position.set(0, 2.6, 7.6);
    s.add(tl);

    // confetti: little paper squares tumbling down
    const cGeo = keep(new THREE.PlaneGeometry(0.16, 0.1));
    this.confetti = new THREE.InstancedMesh(cGeo, keep(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6, metalness: 0.2 })), CONFETTI);
    this.confetti.frustumCulled = false;
    const cols = [0xe3261f, 0xf7c21b, 0x2a63f0, 0xf2f0ea, 0x3cd070, 0xff8a2a];
    this.cf = [];
    for (let i = 0; i < CONFETTI; i++) {
      this.confetti.setColorAt(i, new THREE.Color(cols[i % cols.length]));
      this.cf.push({ x: 0, y: -10, z: 0, vy: 0, a: 0, ax: 0, spin: 0, ph: 0 });
    }
    s.add(this.confetti);
    // spark fountains either side of the podium
    const sGeo = keep(new THREE.SphereGeometry(0.035, 4, 3));
    this.sparks = new THREE.InstancedMesh(sGeo, keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3.2, 1.2), toneMapped: false })), SPARKS);
    this.sparks.frustumCulled = false;
    this.sp = Array.from({ length: SPARKS }, () => ({ x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, life: 0 }));
    s.add(this.sparks);

    this.trucks = [];
    this.t = 0;
    this.shift = 0;  // fraction of the screen taken by the panel (animated)
    this.panel = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
  }

  // top: up to three drivers in order { truckId, vehicle }; cupName for the screen
  setup(top, cupName, subtitle) {
    for (const tv of this.trucks) { this.scene.remove(tv.root); tv.dispose(); }
    this.trucks = top.slice(0, 3).map((d, i) => {
      const def = paintOf(d.truckId, d.livery);
      const tv = new TruckView({ color: def.color, accent: def.accent, number: def.number, helmet: def.helmet, finish: def.finish }, this.templates[d.vehicle] || this.templates.truck);
      const flat = { heightAt: () => 0 };
      const st = { x: 0, y: 0, z: 0, h: 0, vf: 0, w: 0, vy: 0, air: false, steer: 0, landKick: 0 };
      for (let k = 0; k < 30; k++) tv.update(st, 1 / 30, flat); // settle the suspension
      const b = BLOCKS[i];
      tv.root.position.set(b.x, b.h, 0.1);
      tv.root.rotation.set(0, Math.PI / 2 + (i === 1 ? 0.5 : i === 2 ? -0.5 : 0.18), 0); // nose towards the camera
      tv.setLights(true);
      this.scene.add(tv.root);
      return tv;
    });
    // the giant screen
    const g = this.screenCanvas.getContext('2d'), W = 1024, H = 384;
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#1b2440'); grad.addColorStop(1, '#070a14');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.fillStyle = '#c81d18'; g.fillRect(0, 0, W, 64);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'italic 900 40px "Russo", "Arial Black", sans-serif'; g.fillStyle = '#fff';
    g.fillText('SUPER OFF ROAD · CEREMONIA', W / 2, 34);
    g.font = 'italic 900 96px "Russo", "Arial Black", sans-serif';
    g.shadowColor = '#ffb21a'; g.shadowBlur = 26; g.fillStyle = '#ffe28a';
    g.fillText(cupName, W / 2, 190);
    g.shadowBlur = 0;
    g.font = '700 46px "Teko", "Arial Narrow", sans-serif'; g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillText(subtitle, W / 2, 300);
    this.screenTex.needsUpdate = true;
    this.t = 0;
    this.shift = 0;
    for (const c of this.cf) this._dropConfetti(c, true);
    for (const p of this.sp) p.life = 0;
  }

  _dropConfetti(c, anywhere) {
    c.x = (Math.random() - 0.5) * 22; c.z = (Math.random() - 0.5) * 12 + 1;
    c.y = anywhere ? 2 + Math.random() * 14 : 13 + Math.random() * 4;
    c.vy = 1.1 + Math.random() * 1.2; c.spin = 2 + Math.random() * 6; c.ph = Math.random() * 6.3;
  }

  update(dt) {
    const t = (this.t += dt);
    // camera: wide, then in on the winner, then circling slowly
    const cam = this.camera;
    const intro = Math.min(1, t / 5), e = intro * intro * (3 - 2 * intro);
    const a = -0.35 + Math.max(0, t - 5) * 0.06;
    // the panel slides in on the right after a moment: the shot moves aside and
    // opens up so the whole podium fits in what is left of the screen
    this.shift += ((t > 2.2 ? this.panel || 0 : 0) - this.shift) * Math.min(1, dt * 2.2);
    const rad = (21 - 7 * e) * (1 + this.shift * 0.7), hgt = 6.5 - 2.4 * e + this.shift * 1.5;
    cam.position.set(Math.sin(a) * rad, hgt, Math.cos(a) * rad);
    cam.lookAt(0, 2.1 + 0.3 * e, 0);
    const W = 1000, H = Math.round(W / cam.aspect);
    cam.setViewOffset(W, H, (W * this.shift) / 2, 0, W, H);
    // the sweeping light
    this.sweep.target.position.set(Math.sin(t * 0.7) * 9, 0, Math.cos(t * 0.45) * 3);
    // the trophy turns
    this.trophyCup.rotation.y = t * 0.8;
    // confetti
    const m = this._m, q = this._q, p = this._p, eu = this._e;
    this.cf.forEach((c, i) => {
      c.y -= c.vy * dt;
      c.x += Math.sin(t * 1.3 + c.ph) * dt * 0.6;
      if (c.y < 0.05) this._dropConfetti(c, false);
      eu.set(t * c.spin + c.ph, t * c.spin * 0.7, c.ph);
      q.setFromEuler(eu);
      p.set(c.x, c.y, c.z);
      m.compose(p, q, this._s);
      this.confetti.setMatrixAt(i, m);
    });
    this.confetti.instanceMatrix.needsUpdate = true;
    // spark fountains (in bursts)
    const on = (t % 4) < 2.2;
    let spawn = on ? Math.round(dt * 140) : 0;
    this.sp.forEach((s, i) => {
      if (s.life <= 0 && spawn > 0) {
        spawn--;
        const side = i % 2 ? 1 : -1;
        s.x = side * 8.4; s.y = 0.2; s.z = 0.5;
        const ang = (Math.random() - 0.5) * 0.5, sp = 7 + Math.random() * 3;
        s.vx = Math.sin(ang) * sp * 0.5 - side * 0.8; s.vy = sp; s.vz = Math.cos(ang) * 0.6;
        s.life = 0.9 + Math.random() * 0.5;
      }
      if (s.life > 0) {
        s.life -= dt;
        s.vy -= 14 * dt;
        s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      }
      p.set(s.x, s.life > 0 ? s.y : -10, s.z);
      m.compose(p, q.identity(), this._s);
      this.sparks.setMatrixAt(i, m);
    });
    this.sparks.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const tv of this.trucks) { this.scene.remove(tv.root); tv.dispose(); }
    this.trucks = [];
    for (const d of this.disposables) d.dispose();
    this.confetti.dispose(); this.sparks.dispose();
  }
}
