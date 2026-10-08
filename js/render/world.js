// Everything visual about a race: the stadium, the current track (terrain,
// barriers, water, props), the trucks, particles, tyre marks, pickups and the
// cameras. The simulation lives in js/sim; this module only reads it.

import * as THREE from 'three';
import { buildTrack } from '../sim/track.js';
import { trackById } from '../sim/tracks.js';
import { buildTerrain, loadTerrainTextures } from './terrain.js';
import { buildBarriers } from './barriers.js';
import { TruckView, loadTruckTemplate } from './truckview.js';
import { Stadium } from './stadium.js';
import { FX } from './fx.js';
import { buildWater } from './water.js';
import { buildProps, PickupViews, loadPropsTemplate } from './props.js';
import { truckDef } from '../game/drivers.js';
import { wrapAngle, clamp, lerp } from '../sim/util.js';
import { TRUCK } from '../sim/truck.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _n = [0, 1, 0], _up = new THREE.Vector3(0, 1, 0), _nv = new THREE.Vector3(), _qy = new THREE.Quaternion();

// Ground ring under each human truck: the truck's colour with a white outline and an
// arrow at the front, lying on the ground (it stays there in the air, like a shadow).
let _ringTex = null;
function ringTexture() {
  if (_ringTex) return _ringTex;
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  const C = S / 2, R = S / 2;
  const ring = (r0, r1, col) => { g.fillStyle = col; g.beginPath(); g.arc(C, C, r1 * R, 0, Math.PI * 2); g.arc(C, C, r0 * R, 0, Math.PI * 2, true); g.fill(); };
  const arrow = (grow, col) => { // pointing to +u (the truck's front)
    g.fillStyle = col; g.beginPath();
    g.moveTo(C + (0.99 + grow) * R, C); g.lineTo(C + (0.74 - grow) * R, C - (0.17 + grow) * R); g.lineTo(C + (0.74 - grow) * R, C + (0.17 + grow) * R);
    g.closePath(); g.fill();
  };
  g.globalCompositeOperation = 'lighter';
  ring(0.6, 0.86, '#00ff00');           // G: the coloured band
  arrow(0, '#00ff00');
  ring(0.55, 0.6, '#ff0000');           // R: white outline inside and out
  ring(0.86, 0.9, '#ff0000');
  arrow(0.045, '#ff0000');
  _ringTex = new THREE.CanvasTexture(c);
  _ringTex.colorSpace = THREE.NoColorSpace;
  _ringTex.anisotropy = 4;
  return _ringTex;
}
function playerRing(color) {
  const geo = new THREE.PlaneGeometry(5.6, 5.6);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: ringTexture() }, color: { value: new THREE.Color(color) }, opacity: { value: 0.85 } },
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D map; uniform vec3 color; uniform float opacity; varying vec2 vUv;
      void main(){
        vec3 t = texture2D(map, vUv).rgb;
        float a = clamp(t.r + t.g, 0.0, 1.0) * opacity;
        if (a < 0.01) discard;
        // the band carries the colour (a touch brighter so dark liveries still read on dirt)
        gl_FragColor = vec4(mix(color * 1.25 + 0.06, vec3(1.0), clamp(t.r * 1.5, 0.0, 1.0)), a);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 4;
  m.frustumCulled = false;
  return m;
}

export class RaceWorld {
  constructor(view) {
    this.view = view;
    this.scene = view.scene;
    this.trackGroup = new THREE.Group();
    this.scene.add(this.trackGroup);
    this.views = [];
    this.camMode = 'classic';
    this.camT = 0;
    this.shake = 0;
    this.prev = [];
  }

  async init() {
    const [tpl, buggy] = await Promise.all([loadTruckTemplate('truck'), loadTruckTemplate('buggy'), loadTerrainTextures(this.view.renderer), loadPropsTemplate()]);
    this.template = tpl;
    this.templates = { truck: tpl, buggy: buggy || tpl };
    const low = this.view.qualityName === 'low';
    this.stadium = new Stadium({ density: low ? 0.55 : 1, shadows: !low });
    this.scene.add(this.stadium.group);
    this.fx = new FX(this.scene, this.view.qualityName);
    this.pickups = new PickupViews(this.scene);
    this._setupScreenCam();
  }

  // ------------------------------------------------------------ track
  loadTrack(id, reverse, timeName) {
    const def = trackById(id);
    this.disposeTrack();
    const t0 = performance.now();
    const track = buildTrack(def, { reverse });
    this.track = track;
    const time = timeName || def.time || 'day';
    this.view.setTime(time);
    this.timeName = time;
    this.terrain = buildTerrain(track, { marksSize: this.view.q.marks, hiq: this.view.qualityName === 'high', volcano: def.volcano, renderer: this.view.renderer });
    this.terrain.userData.uniforms.uLava.value = time === 'night' ? 1 : time === 'sunset' ? 0.55 : 0.28;
    this.barriers = buildBarriers(track);
    this.water = buildWater(track);
    this.props = buildProps(track, def);
    this.trackGroup.add(this.terrain, this.barriers, this.water, this.props);
    this.props.userData.night = time === 'night';
    this.stadium.setTime({ name: time }, this.scene);
    this.fx.setFog(this.scene.fog);
    this.fx.dustColor = time === 'night' ? [0.42, 0.33, 0.27] : time === 'sunset' ? [0.7, 0.45, 0.3] : [0.66, 0.45, 0.3];
    // classic camera framing the barriers
    const bb = new THREE.Box3().setFromObject(this.barriers);
    this.frameBox = [bb.min.x - 0.8, bb.min.z - 0.5, bb.max.x + 0.8, bb.max.z + 0.8];
    this.refit();
    this._tvSpots();
    this.buildMs = performance.now() - t0;
    return track;
  }

  // broadcast camera positions: on poles outside the barriers along the lap
  _tvSpots() {
    const tr = this.track, p = tr.path;
    const spots = [];
    const step = Math.round(38 / p.ds);
    for (let i = 0; i < p.n; i += step) {
      for (const side of [1, -1]) {
        const nx = -p.tz[i] * side, nz = p.tx[i] * side;
        let d = p.hw[i] + 2;
        while (d < p.hw[i] + 14 && tr.bsdfAt(p.x[i] + nx * d, p.z[i] + nz * d) < 1.6) d += 0.5;
        const x = p.x[i] + nx * d, z = p.z[i] + nz * d;
        if (Math.abs(x) > 64 || Math.abs(z) > 39) continue;
        spots.push({ x, z, y: tr.heightAt(x, z) + 3.2 + (spots.length % 3) * 1.4, i });
        break;
      }
    }
    this.tv = { spots, cur: null, look: new THREE.Vector3() };
  }

  // recompute the classic framing (track change, window resize, rotation)
  refit() {
    if (!this.frameBox) return;
    const prev = this.view.camera.position.clone(), q = this.view.camera.quaternion.clone();
    this.view.fitClassic(this.frameBox, this.pitch || 54, 0.985, 1.5, this.hudInset ? this.hudInset() : 0);
    if (this.camMode !== 'classic') { this.view.camera.position.copy(prev); this.view.camera.quaternion.copy(q); }
  }

  disposeTrack() {
    for (const o of [this.terrain, this.barriers, this.water, this.props]) {
      if (!o) continue;
      this.trackGroup.remove(o);
      o.traverse((m) => {
        if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
        if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => { if (!x.userData.shared) { if (x.map && x.map.isCanvasTexture) x.map.dispose(); x.dispose(); } });
      });
    }
    if (this.terrain) {
      const u = this.terrain.userData;
      u.marks.dispose();
      u.normalTex.dispose(); u.fieldTex.dispose(); u.wetTex.dispose();
      if (u.noiseRT) u.noiseRT.dispose();
    }
    this.terrain = this.barriers = this.water = this.props = null;
  }

  // ------------------------------------------------------------ race
  setRace(race) {
    this.race = race;
    for (const v of this.views) { this.scene.remove(v.root); v.dispose(); }
    this.views = race.racers.map((r) => {
      const d = truckDef(r.entry.truckId);
      const v = new TruckView({ color: d.color, accent: d.accent, number: d.number, helmet: d.helmet }, this.templates[r.entry.vehicle] || this.template);
      v.truckId = d.id;
      this.scene.add(v.root);
      v.setLights(this.timeName === 'night');
      return v;
    });
    for (const m of this.rings || []) if (m) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this.rings = race.racers.map((r) => {
      if (!r.human) return null;
      const m = playerRing(truckDef(r.entry.truckId).color);
      this.scene.add(m);
      return m;
    });
    this.prev = race.racers.map((r) => ({ x: r.truck.x, y: r.truck.y, z: r.truck.z, h: r.truck.h }));
    this.fxState = race.racers.map(() => ({ wet: 0, lastWheel: null, dustAcc: 0, clodAcc: 0, landKick: 0, wasWater: 0 }));
    this.terrain.userData.marks.clear();
    this._seedWear();
    this.fx.clear();
    this.pickups.clear();
    this.leader = 0;
  }

  // practice laps already left tyre tracks along the racing line
  _seedWear() {
    const marks = this.terrain.userData.marks, ln = this.track.line, p = this.track.path;
    const r = Math.random;
    for (let pass = 0; pass < 5; pass++) {
      const off = (r() - 0.5) * 3.2;
      for (let k = 0; k < ln.m; k++) {
        const k2 = (k + 1) % ln.m;
        const i = ln.idx[k], i2 = ln.idx[k2];
        const nx = -p.tz[i], nz = p.tx[i], nx2 = -p.tz[i2], nz2 = p.tx[i2];
        for (const w of [-0.98, 0.98]) {
          const o = off + w + Math.sin(k * 0.07 + pass) * 0.6;
          marks.add(ln.x[k] + nx * o, ln.z[k] + nz * o, ln.x[k2] + nx2 * o, ln.z[k2] + nz2 * o, 0.45, 0.07, 0);
          if (marks.count >= marks.max - 2) marks.flush(this.view.renderer);
        }
      }
    }
    marks.flush(this.view.renderer);
  }

  // called before every sim step
  savePrev() {
    this.race.racers.forEach((r, i) => {
      const t = r.truck, p = this.prev[i];
      p.x = t.x; p.y = t.y; p.z = t.z; p.h = t.h;
    });
  }

  // sim events of the frame -> effects
  handleEvents(events) {
    const fx = this.fx;
    for (const ev of events) {
      const r = this.race.racers[ev[1]];
      const t = r && r.truck;
      switch (ev[0]) {
        case 'land': {
          const sev = clamp((ev[2] - 3) / 9, 0, 1);
          if (sev > 0.05) fx.landing(t.x, t.y, t.z, sev);
          this.fxState[ev[1]].landKick = clamp(ev[2] * 0.22, 0, 2.6);
          if (sev > 0.4) this.stadium.cheer(0.25);
          if (r.human && sev > 0.5) this.shake = Math.max(this.shake, sev * 0.35);
          break;
        }
        case 'wall': fx.sparksAt(ev[3], t.y, ev[4], ev[5], ev[6], clamp(ev[2] / 12, 0.2, 1)); if (ev[2] > 8) this.stadium.cheer(0.15); break;
        case 'bump': {
          fx.sparksAt(ev[4], this.track.heightAt(ev[4], ev[5]), ev[5], 0, 0, clamp(ev[3] / 10, 0.2, 1));
          this.stadium.cheer(0.1);
          break;
        }
        case 'pickup': fx.pickupBurst(ev[4], this.track.heightAt(ev[4], ev[5]), ev[5], ev[2]); break;
        case 'finish': this.stadium.cheer(0.6); fx.confettiBurst(t.x, t.y + 2, t.z, 120); break;
        case 'go': this.stadium.cheer(0.5); break;
        case 'nitro': this.stadium.cheer(0.08); break;
      }
    }
  }

  // per frame visual sync; alpha = sim interpolation factor
  update(dt, alpha) {
    const race = this.race, track = this.track;
    if (!race) return;
    const marks = this.terrain.userData.marks;
    this.terrain.userData.uniforms.uTime.value += dt;
    const fx = this.fx;
    let leadProg = -1e9;
    race.racers.forEach((r, i) => {
      const t = r.truck, p = this.prev[i], v = this.views[i], st = this.fxState[i];
      const s = _state;
      s.x = lerp(p.x, t.x, alpha); s.y = lerp(p.y, t.y, alpha); s.z = lerp(p.z, t.z, alpha);
      s.h = p.h + wrapAngle(t.h - p.h) * alpha;
      s.vf = t.vf; s.w = t.w; s.vy = t.vy; s.air = t.air && t.hAbove > 0.08; s.steer = t.steer;
      s.landKick = st.landKick; st.landKick = 0;
      v.update(s, dt, track);
      const ring = this.rings && this.rings[i];
      if (ring) {
        // on the ground under the truck, tilted with the slope, pointing where it points
        track.normalAt(s.x, s.z, _n);
        _nv.set(_n[0], _n[1], _n[2]).normalize();
        ring.quaternion.setFromUnitVectors(_up, _nv).multiply(_qy.setFromAxisAngle(_up, -s.h));
        ring.position.set(s.x, track.heightAt(s.x, s.z) + 0.06, s.z);
        // brighter on the grid so you find yourself, then a steady glow
        const start = race.state === 'countdown' || race.time < 2.5;
        ring.material.uniforms.opacity.value = start ? 0.7 + 0.3 * Math.sin(performance.now() / 110) : 0.8;
      }
      v.setLod(this.view.camera.position.distanceToSquared(v.root.position) > 900);
      if (r.prog > leadProg && !r.finished) { leadProg = r.prog; this.leader = i; }
      // dirt builds up during the race
      v.setDirt(Math.min(1, (race.time > 0 ? race.time : 0) / 70 + st.wet * 0.2));

      // wheels: marks, dust, clods, water
      const speed = t.speed;
      const c = Math.cos(t.h), sn = Math.sin(t.h);
      const wet = t.water > 0.04;
      if (wet) st.wet = 1; else st.wet = Math.max(0, st.wet - dt * 0.12);
      const grounded = !t.air || t.hAbove < 0.15;
      if (!st.lastWheel) st.lastWheel = [[0, 0], [0, 0], [0, 0], [0, 0]];
      for (let w = 0; w < 4; w++) {
        const lx = w < 2 ? TRUCK.wheelX : -TRUCK.wheelX, lz = w % 2 ? TRUCK.wheelZ : -TRUCK.wheelZ;
        const wx = t.x + lx * c - lz * sn, wz = t.z + lx * sn + lz * c;
        const lw = st.lastWheel[w];
        if (grounded && speed > 0.6 && race.state !== 'countdown') {
          const strength = 0.035 + Math.min(0.08, t.slip * 0.012) + t.throttle * 0.012;
          marks.add(lw[0], lw[1], wx, wz, 0.42, strength, st.wet > 0.05 ? 0.06 * st.wet : 0);
        }
        lw[0] = wx; lw[1] = wz;
      }
      if (race.state === 'countdown') {
        if (t.throttle > 0 && Math.random() < dt * 8) {
          v.markerWorld('ExhaustL', _v);
          fx.exhaustPuff(_v.x, _v.y, _v.z, -c * 2, -sn * 2, 0.25);
        }
        return;
      }
      if (grounded && !wet && speed > 4) {
        st.dustAcc += dt * (speed * 0.9 + t.slip * 4) * fx.k;
        while (st.dustAcc > 1) {
          st.dustAcc -= 1;
          const side = Math.random() < 0.5 ? -1 : 1;
          const lx = -TRUCK.wheelX - 0.3, lz = side * TRUCK.wheelZ;
          const wx = t.x + lx * c - lz * sn, wz = t.z + lx * sn + lz * c;
          fx.wheelDust(wx, track.heightAt(wx, wz), wz, t.vx, t.vz, clamp(speed / 24 + t.slip / 8, 0.1, 1), this.timeName === 'night' ? 0.8 : 1);
        }
      }
      // wheelspin and slides throw clods
      const spin = t.throttle > 0.5 && t.vf < 9 ? 1 : 0;
      if (grounded && !wet && (spin || t.slip > 3)) {
        st.clodAcc += dt * (spin * 14 + t.slip * 3) * fx.k;
        while (st.clodAcc > 1) {
          st.clodAcc -= 1;
          const side = Math.random() < 0.5 ? -1 : 1;
          const lx = -TRUCK.wheelX - 0.4, lz = side * TRUCK.wheelZ;
          const wx = t.x + lx * c - lz * sn, wz = t.z + lx * sn + lz * c;
          fx.clod(wx, track.heightAt(wx, wz) + 0.3, wz, -c * (3 + Math.random() * 4) + (Math.random() - 0.5) * 2, 2 + Math.random() * 3, -sn * (3 + Math.random() * 4) + (Math.random() - 0.5) * 2, st.wet);
        }
      }
      if (wet && speed > 2) {
        if (!st.wasWater) {
          fx.splash(t.x, t.y, t.z, t.vx, t.vz, clamp(speed / 18, 0.3, 1.2));
          if (this.water.userData.ring) this.water.userData.ring(t.x, t.z, clamp(speed / 15, 0.4, 1.2));
          st.wasWater = 1; st.ringT = 0;
        }
        st.ringT = (st.ringT || 0) + dt;
        if (st.ringT > 0.35 && this.water.userData.ring) { st.ringT = 0; this.water.userData.ring(t.x, t.z, clamp(speed / 25, 0.25, 0.8)); }
        if (Math.random() < dt * speed * 2.2) {
          const side = Math.random() < 0.5 ? -1 : 1;
          const lx = (Math.random() < 0.5 ? 1 : -1) * TRUCK.wheelX, lz = side * (TRUCK.wheelZ + 0.25);
          fx.splash(t.x + lx * c - lz * sn, t.y, t.z + lx * sn + lz * c, t.vx * 0.6, t.vz * 0.6, clamp(speed / 30, 0.15, 0.6));
        }
      } else st.wasWater = 0;
      // nitro flames
      if (t.nitroT > 0) {
        for (const m of ['ExhaustL', 'ExhaustR']) {
          v.markerWorld(m, _v);
          fx.nitro(_v.x, _v.y, _v.z, -c, -sn, t.vx, t.vz);
        }
      }
    });
    marks.flush(this.view.renderer);
    // smoke from the volcano
    const vol = this.props && this.props.userData.volcano;
    if (vol && Math.random() < dt * 6) {
      const night = this.timeName === 'night';
      fx.smoke.spawn({
        x: vol.x + (Math.random() - 0.5) * 3, y: vol.y + 1, z: vol.z + (Math.random() - 0.5) * 3,
        vx: 0.6 + Math.random(), vy: 2.2 + Math.random() * 1.5, vz: (Math.random() - 0.5) * 0.8,
        life: 5 + Math.random() * 3, size: 3, size1: 11, r: night ? 0.45 : 0.42, g: night ? 0.3 : 0.38, b: night ? 0.26 : 0.36, a: 0.4, drag: 0.3, fadeIn: 0.6,
      });
    }
    fx.update(dt, (x, z) => track.heightAt(x, z));
    this.pickups.update(dt, race, track);
    this.stadium.update(dt, this.view.camera);
    this._camera(dt);
    this._screen(dt);
  }

  // ------------------------------------------------------------ cameras
  setCamera(mode, opts = {}) {
    this.camMode = mode;
    this.camT = 0;
    this.camOpts = opts;
    if (mode === 'classic') this._camSnap = !!opts.snap;
  }

  _camera(dt) {
    const cam = this.view.camera, cl = this.view.classic;
    this.camT += dt;
    if (this.camMode !== 'tv' && this._fovTouched && cl) { cam.fov = cl.fov; cam.updateProjectionMatrix(); this._fovTouched = false; }
    const race = this.race;
    if (this.camMode === 'classic' && cl) {
      if (this._camSnap) { cam.position.copy(cl.pos); this._camSnap = false; }
      _v.copy(cl.pos);
      cam.position.lerp(_v, Math.min(1, dt * 2.5));
      this._look = this._look || cl.target.clone();
      this._look.lerp(cl.target, Math.min(1, dt * 2.5));
      cam.lookAt(this._look);
    } else if (this.camMode === 'zoom' && race && cl) {
      // classic angle, closer, tracking the player but staying over the arena
      const r = race.racers[this.camOpts.index ?? 0];
      const t = r.truck;
      const k = this.camOpts.zoom ?? 0.5;
      const dir = _v2.copy(cl.target).sub(cl.pos);
      const dist = dir.length();
      dir.normalize();
      const lead = Math.min(1, t.speed / 25) * 7;
      const tx0 = t.x + t.vx / Math.max(1, t.speed) * lead, tz0 = t.z + t.vz / Math.max(1, t.speed) * lead;
      // a little north of the truck so it sits below the HUD board
      const tx = clamp(tx0, cl.target.x - 46, cl.target.x + 46), tz = clamp(tz0 - 3.5, cl.target.z - 30, cl.target.z + 24);
      this._zt = this._zt || new THREE.Vector3(tx, 0, tz);
      // entering: snap at the race start, otherwise glide from where we were looking
      if (this.camT < 0.05) { if (this.camOpts.snap || !this._look) this._zt.set(tx, 0, tz); else this._zt.set(this._look.x, 0, this._look.z); }
      this._zt.x += (tx - this._zt.x) * Math.min(1, dt * 2.6);
      this._zt.z += (tz - this._zt.z) * Math.min(1, dt * 2.6);
      cam.position.copy(this._zt).addScaledVector(dir, -dist * k);
      cam.lookAt(this._zt);
      this._look = this._zt.clone();
    } else if (this.camMode === 'follow' && race) {
      const r = race.racers[this.camOpts.index ?? 0];
      const t = r.truck;
      const fz = this.camOpts.zoom ?? 1; // pinch / wheel distance scale
      const back = (11 + t.speed * 0.15) * fz, up = 6.5 * fz;
      const vx = t.speed > 2 ? t.vx / t.speed : Math.cos(t.h), vz = t.speed > 2 ? t.vz / t.speed : Math.sin(t.h);
      const hx = lerp(Math.cos(t.h), vx, 0.4), hz = lerp(Math.sin(t.h), vz, 0.4);
      _v.set(t.x - hx * back, t.y + up, t.z - hz * back);
      if (this.camT < 0.05) cam.position.copy(_v);
      cam.position.lerp(_v, Math.min(1, dt * 4));
      const minY = this.track.heightAt(cam.position.x, cam.position.z) + 2.5;
      if (cam.position.y < minY) cam.position.y = minY;
      _v2.set(t.x + hx * 4, t.y + 1, t.z + hz * 4);
      this._look = this._look || _v2.clone();
      this._look.lerp(_v2, Math.min(1, dt * 6));
      cam.lookAt(this._look);
    } else if (this.camMode === 'intro') {
      // sweep from a low corner view over the stadium into the classic view
      const T = this.camOpts.duration || 6;
      const u = clamp(this.camT / T, 0, 1);
      const e = u * u * (3 - 2 * u);
      const a = -2.3 + e * 1.0;
      const rad = lerp(95, 0, e);
      const p0 = _v.set(Math.cos(a) * rad, lerp(16, 0, e), Math.sin(a) * rad * 0.7 + lerp(10, 0, e));
      cam.position.copy(p0).lerp(cl.pos, e * e);
      cam.position.y = lerp(18, cl.pos.y, e * e);
      _v2.copy(cl.target).add(new THREE.Vector3(lerp(20, 0, e), 0, lerp(-6, 0, e)));
      cam.lookAt(_v2);
      this._look = _v2.clone();
    } else if (this.camMode === 'tv' && race && this.tv && this.tv.spots.length) {
      // pick the pole the focused truck is approaching, cut when it has gone past
      const fi = this.camOpts.index != null ? this.camOpts.index : this.leader;
      const t = race.racers[fi].truck;
      const tv = this.tv;
      const dist = (sp) => Math.hypot(sp.x - t.x, sp.z - t.z);
      const ahead = (sp) => (sp.x - t.x) * t.vx + (sp.z - t.z) * t.vz > 0;
      if (!tv.cur || (dist(tv.cur) > 34 && !ahead(tv.cur)) || dist(tv.cur) > 70 || this.camT < 0.02) {
        let best = null, bd = Infinity;
        for (const sp of tv.spots) {
          const d = dist(sp);
          if (d < 12 || d > 60 || !ahead(sp)) continue;
          if (d < bd) { bd = d; best = sp; }
        }
        if (!best) for (const sp of tv.spots) { const d = dist(sp); if (d < bd) { bd = d; best = sp; } }
        if (best !== tv.cur) { tv.cur = best; tv.cut = true; }
      }
      const sp = tv.cur;
      cam.position.set(sp.x, sp.y, sp.z);
      _v2.set(t.x + t.vx * 0.15, t.y + 1.0, t.z + t.vz * 0.15);
      if (tv.cut) { tv.look.copy(_v2); tv.cut = false; }
      tv.look.lerp(_v2, Math.min(1, dt * 7));
      cam.lookAt(tv.look);
      const d = Math.max(6, cam.position.distanceTo(tv.look));
      cam.fov = THREE.MathUtils.clamp(2 * Math.atan(7.5 / d) * 180 / Math.PI, 9, 50);
      cam.updateProjectionMatrix();
      this._fovTouched = true;
    } else if (this.camMode === 'fixed') {
      const o = this.camOpts;
      cam.position.set(o.pos[0], o.pos[1], o.pos[2]);
      cam.lookAt(o.look[0], o.look[1], o.look[2]);
    } else if (this.camMode === 'orbit') {
      const tgt = this.camOpts.target ? this.camOpts.target() : new THREE.Vector3();
      const a = this.camT * (this.camOpts.speed ?? 0.18) + (this.camOpts.phase || 0);
      const rad = this.camOpts.radius ?? 12, h = this.camOpts.height ?? 5;
      _v.set(tgt.x + Math.cos(a) * rad, tgt.y + h, tgt.z + Math.sin(a) * rad);
      cam.position.lerp(_v, this.camT < 0.05 ? 1 : Math.min(1, dt * 3));
      _v2.set(tgt.x, tgt.y + 1.2, tgt.z);
      cam.lookAt(_v2);
    }
    if (this.shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 8);
    }
  }

  // live feed on the big screen: a chase camera on the leader
  _setupScreenCam() {
    if (this.view.qualityName !== 'high') {
      // cheaper big screen: a live standings board drawn on a canvas
      const c = document.createElement('canvas');
      c.width = 512; c.height = 282;
      this.boardCanvas = c;
      this.boardTex = new THREE.CanvasTexture(c);
      this.boardTex.colorSpace = THREE.SRGBColorSpace;
      this.stadium.screenMat.map = this.boardTex;
      this.stadium.screenMat.needsUpdate = true;
      this.boardAcc = 1;
      return;
    }
    this.screenRT = new THREE.WebGLRenderTarget(480, 264, { samples: 0 });
    this.screenRT.texture.colorSpace = THREE.SRGBColorSpace;
    this.screenCam = new THREE.PerspectiveCamera(42, 20.4 / 11.2, 1, 400);
    this.stadium.screenMat.map = this.screenRT.texture;
    this.stadium.screenMat.needsUpdate = true;
    this.screenAcc = 0;
  }
  _board(dt) {
    this.boardAcc += dt;
    if (this.boardAcc < 0.5 || !this.race) return;
    this.boardAcc = 0;
    const g = this.boardCanvas.getContext('2d'), W = 512, H = 282, race = this.race;
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#101826'); grad.addColorStop(1, '#05070c');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.fillStyle = '#c81d18'; g.fillRect(0, 0, W, 46);
    g.font = 'italic 900 30px "Arial Black", Impact, sans-serif';
    g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillText('SUPER OFF ROAD', 16, 24);
    g.textAlign = 'right'; g.font = '700 26px Impact, sans-serif'; g.fillStyle = '#ffd21f';
    const lap = Math.min(race.laps, Math.max(1, (race.order[0]?.lap ?? 0) + 1));
    g.fillText(race.state === 'countdown' ? 'READY' : `LAP ${lap}/${race.laps}`, W - 16, 24);
    race.order.forEach((r, i) => {
      const d = truckDef(r.entry.truckId), y = 62 + i * 52;
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)';
      g.fillRect(10, y, W - 20, 46);
      g.fillStyle = d.css; g.fillRect(10, y, 12, 46);
      g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = 'italic 900 30px "Arial Black", Impact, sans-serif';
      g.fillText(String(i + 1), 34, y + 24);
      g.font = '700 26px Impact, sans-serif';
      g.fillText((r.human ? (r.entry.name || 'PLAYER') : (r.entry.short || r.entry.name)).toUpperCase().slice(0, 18), 80, y + 24);
      g.textAlign = 'right'; g.fillStyle = '#9fd0ff';
      g.fillText(`N ${r.truck.nitros}`, W - 24, y + 24);
    });
    this.boardTex.needsUpdate = true;
  }

  _screen(dt) {
    if (this.boardCanvas) return this._board(dt);
    if (!this.screenRT || !this.race) return;
    this.screenAcc += dt;
    if (this.screenAcc < 1 / 20) return;
    this.screenAcc = 0;
    const t = this.race.racers[this.leader].truck;
    const c = this.screenCam;
    const a = t.h + Math.PI + 0.5;
    c.position.set(t.x + Math.cos(a) * 9, t.y + 4, t.z + Math.sin(a) * 9);
    c.lookAt(t.x, t.y + 1, t.z);
    const r = this.view.renderer;
    const prevRT = r.getRenderTarget();
    const prevTM = r.toneMapping;
    this.stadium.screen.visible = false;
    const au = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false; // reuse this frame's shadow map
    r.setRenderTarget(this.screenRT);
    r.render(this.scene, c);
    r.setRenderTarget(prevRT);
    r.shadowMap.autoUpdate = au;
    this.stadium.screen.visible = true;
  }
}
const _state = {};
