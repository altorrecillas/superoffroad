// Visual truck: follows the simulation state with suspension, body roll/pitch,
// spinning and steering wheels, swaying whip flag, livery and dirt build-up.

import * as THREE from 'three';
import { gltfLoader } from './gltf.js';
import { mergeParts } from './merge.js';
import { TRUCK } from '../sim/truck.js';
import { clamp } from '../sim/util.js';

const R = TRUCK.wheelR;
const MODELS = { truck: 'assets/models/truck.glb', buggy: 'assets/models/buggy.glb' };

const MATTE = /^(Black|Suit|Seat|Rubber)$/, METAL = /^(Tube|Shock|Chrome|Engine)$/;
function optimise(t) {
  mergeParts(t.body, MATTE, { roughness: 0.66, metalness: 0.2 }, 'MergedMatte');
  mergeParts(t.body, METAL, { roughness: 0.3, metalness: 0.95 }, 'MergedMetal');
  const seen = new Set();
  for (const a of t.axles) {
    if (!seen.has(a.model)) { seen.add(a.model); mergeParts(a.model, /^(Rubber|Black)$/, { roughness: 0.84 }, 'TyreMerged'); mergeParts(a.model, /^(Rim|Beadlock|Chrome)$/, { roughness: 0.26, metalness: 1 }, 'RimMerged'); }
    if (a.lod && !seen.has(a.lod)) { seen.add(a.lod); mergeParts(a.lod, /./, { roughness: 0.72, metalness: 0.25 }, 'WheelMerged'); }
  }
  if (t.whip) mergeParts(t.whip, /./, { roughness: 0.5, metalness: 0.3 }, 'WhipMerged');
}

// one template per vehicle body (Blender models: tools/blender/truck.py, buggy.py)
const templates = {};
export function loadTruckTemplate(kind = 'truck') {
  if (!templates[kind]) {
    templates[kind] = gltfLoader().loadAsync(MODELS[kind]).then((g) => {
      const root = g.scene;
      const get = (n) => root.getObjectByName(n);
      const markers = {};
      for (const n of ['ExhaustL', 'ExhaustR', 'HeadL', 'HeadR', 'RoofLights', 'TailL', 'TailR']) {
        const o = get(n);
        if (o) markers[n] = o.position.clone();
      }
      const t = { kind, body: get('Body'), whip: get('Whip'), markers };
      if (kind === 'buggy') {
        // narrow front wheels and big rears; the axle positions come from marker empties
        const f = get('WheelFL').position, r = get('WheelRL').position;
        t.axles = [
          { x: f.x, z: Math.abs(f.z), r: f.y, model: get('WheelF'), lod: get('WheelFLOD') },
          { x: r.x, z: Math.abs(r.z), r: r.y, model: get('WheelR'), lod: get('WheelRLOD') },
        ];
        t.travel = [-0.3, 0.2]; // long-travel suspension
      } else {
        const w = get('Wheel'), lod = get('WheelLOD');
        t.axles = [
          { x: TRUCK.wheelX, z: TRUCK.wheelZ, r: R, model: w, lod },
          { x: -TRUCK.wheelX, z: TRUCK.wheelZ, r: R, model: w, lod },
        ];
        t.travel = [-0.22, 0.13];
      }
      t.body.position.set(0, 0, 0);
      for (const a of t.axles) { a.model.position.set(0, 0, 0); if (a.lod) a.lod.position.set(0, 0, 0); }
      optimise(t);
      return t;
    }).catch((e) => { console.warn(kind + ' model failed', e); return null; });
  }
  return templates[kind];
}

// livery texture: number plate for doors and roof
function plateTexture(num, color, accent) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f2ec';
  g.fillRect(0, 0, 512, 256);
  // coloured border band
  g.lineWidth = 22;
  g.strokeStyle = '#' + color.getHexString();
  g.strokeRect(11, 11, 490, 234);
  g.lineWidth = 6;
  g.strokeStyle = '#' + accent.getHexString();
  g.strokeRect(30, 30, 452, 196);
  g.fillStyle = '#121212';
  g.font = '900 190px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(num), 256, 138);
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false; // glTF uv convention
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class TruckView {
  constructor(opts, template) {
    const { color, accent = 0xf2f2f2, number = 1, helmet } = opts;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.wheels = [];
    this.color = new THREE.Color(color);
    this.accent = new THREE.Color(accent);
    this.markers = {};
    this.dirt = 0;
    this.materials = [];
    if (template) this._fromTemplate(template, number, helmet);
    else this._placeholder();
    this.pitch = 0; this.roll = 0; this.pv = 0; this.rv = 0;
    this.bodyY = 0; this.bodyYv = 0;
    this.dist = 0; this.steerA = 0;
    this.susp = this.wheels.map((w) => w.r);
    this.whipA = 0; this.whipV = 0; this.whipB = 0; this.whipBV = 0;
    this.prevVf = 0; this.prevH = 0;
    // only the big shapes go into the shadow pass: plates, lenses, chrome, the driver
    // and the rims add draw calls but nothing visible to the shadow
    const NO_SHADOW = /^(Decal|Lens|Light|TailLight|Chrome|Helmet|Seat|Suit|Shock|Rim|Bead|Gold|Flag)/;
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      o.castShadow = !mats.every((m) => NO_SHADOW.test(m.name || ''));
    });
  }

  _placeholder() {
    const paint = new THREE.MeshPhysicalMaterial({ color: this.color, roughness: 0.32, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.6 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); this.body.add(m); return m; };
    add(new THREE.BoxGeometry(4.3, 0.5, 2.0), paint, 0, 0.95, 0);
    add(new THREE.BoxGeometry(1.4, 0.6, 1.7), paint, -0.1, 1.5, 0);
    add(new THREE.BoxGeometry(1.4, 0.3, 1.7), dark, -1.4, 1.2, 0);
    const tyre = new THREE.CylinderGeometry(R, R, 0.42, 20);
    tyre.rotateX(Math.PI / 2);
    const tmat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
    for (const [x, z] of [[TRUCK.wheelX, -TRUCK.wheelZ], [TRUCK.wheelX, TRUCK.wheelZ], [-TRUCK.wheelX, -TRUCK.wheelZ], [-TRUCK.wheelX, TRUCK.wheelZ]]) {
      const steer = new THREE.Group();
      steer.position.set(x, R, z);
      const spin = new THREE.Group();
      spin.add(new THREE.Mesh(tyre, tmat));
      steer.add(spin);
      this.root.add(steer);
      this.wheels.push({ steer, spin, x, z, r: R });
    }
    this.wb = TRUCK.wheelX * 2; this.tw = TRUCK.wheelZ * 2;
    this.travel = [-0.22, 0.13];
  }

  _fromTemplate(t, number, helmet) {
    const body = t.body.clone(true);
    const plate = plateTexture(number, this.color, this.accent);
    const cache = new Map();
    const recolor = (m) => {
      if (cache.has(m)) return cache.get(m);
      let out = m;
      const n = m.name || '';
      if (/^Paint/.test(n)) { out = m.clone(); out.color.copy(this.color); }
      else if (/^Accent/.test(n)) { out = m.clone(); out.color.copy(this.accent); }
      else if (/^Helmet/.test(n)) { out = m.clone(); out.color.set(helmet ?? this.accent); }
      else if (/^Decal/.test(n)) {
        // vinyl number plates: satin, so the white does not flare under the lights
        out = m.clone(); out.map = plate; out.color.set(0xffffff);
        out.roughness = Math.max(out.roughness, 0.5);
        if (out.clearcoat) { out.clearcoat = 0.35; out.clearcoatRoughness = 0.25; }
      }
      else if (/^(Light|Lens|TailLight)/.test(n)) { out = m.clone(); this.lamps = this.lamps || []; this.lamps.push(out); }
      // a mirror-sharp clearcoat turns point lights into bloom-blown glints
      if (out !== m && out.clearcoat > 0) out.clearcoatRoughness = Math.max(out.clearcoatRoughness, 0.12);
      if (out !== m) { this._dirtify(out, n); this.materials.push(out); } // only our own clones (shared ones stay)
      cache.set(m, out);
      return out;
    };
    body.traverse((o) => {
      if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(recolor) : recolor(o.material);
    });
    this.body.add(body);
    if (t.whip) {
      this.whip = t.whip.clone(true);
      this.body.add(this.whip);
      this.whipBase = this.whip.position.clone();
    }
    for (const k in t.markers) this.markers[k] = t.markers[k].clone();
    this.kind = t.kind;
    // front left/right, rear left/right (z < 0 is the left side)
    for (const [ai, side] of [[0, -1], [0, 1], [1, -1], [1, 1]]) {
      const a = t.axles[ai];
      const x = a.x, z = side * a.z;
      const steer = new THREE.Group();
      steer.position.set(x, a.r, z);
      const spin = new THREE.Group();
      const m = a.model.clone(true);
      if (z > 0) m.scale.z = -1; // the model is a left wheel
      spin.add(m);
      let lod = null;
      if (a.lod) {
        lod = a.lod.clone(true);
        if (z > 0) lod.scale.z = -1;
        lod.visible = false;
        spin.add(lod);
      }
      steer.add(spin);
      this.root.add(steer);
      this.wheels.push({ steer, spin, x, z, r: a.r, hi: m, lod });
    }
    this.wb = t.axles[0].x - t.axles[1].x;
    this.tw = t.axles[0].z + t.axles[1].z;
    this.travel = t.travel;
  }

  // dirt builds up on the paint during the race (lower body first)
  _dirtify(mat, name) {
    if (!/^(Paint|Accent|Decal)/.test(name)) return;
    mat.userData.dirt = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uDirt = mat.userData.dirt;
      sh.vertexShader = 'varying vec3 vLocalPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vLocalPos = position;');
      sh.fragmentShader = 'uniform float uDirt;\nvarying vec3 vLocalPos;\n' + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            float hgt = vLocalPos.y;
            vec3 p = vLocalPos * vec3(3.1, 2.7, 3.3);
            float n = fract(sin(dot(floor(p * 4.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            float n2 = fract(sin(dot(floor(p * 1.3), vec3(39.34, 11.13, 83.17))) * 9741.31);
            float mask = smoothstep(1.35, 0.55, hgt + (n2 - 0.5) * 0.35) * 0.9 + (n * n2) * 0.25;
            float d = clamp(uDirt * 1.5 * mask - (1.0 - uDirt) * 0.2, 0.0, 0.85);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.19, 0.11), d);
            vDirtAmt = d;
          }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.95, vDirtAmt);')
        .replace('void main() {', 'float vDirtAmt = 0.0;\nvoid main() {');
    };
    mat.customProgramCacheKey = () => 'dirt-' + name;
  }

  setDirt(v) {
    this.dirt = v;
    for (const m of this.materials) if (m.userData.dirt) m.userData.dirt.value = v;
  }

  setLights(on) {
    if (this.lamps) for (const m of this.lamps) m.emissiveIntensity = on ? 4 : 0.6;
    if (on && !this.beam) {
      // headlight pool on the ground (additive decal) - cheap and readable from above
      const c = document.createElement('canvas');
      c.width = 128; c.height = 128;
      const g = c.getContext('2d');
      const img = g.createImageData(128, 128);
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
        const u = x / 127, v = (y - 63.5) / 63.5;
        const spread = 0.18 + u * 0.82;
        const a = Math.max(0, 1 - Math.abs(v) / spread) * Math.pow(1 - u, 1.4) * Math.min(1, u * 6);
        const i = (y * 128 + x) * 4;
        img.data[i] = 255; img.data[i + 1] = 244; img.data[i + 2] = 214; img.data[i + 3] = Math.round(255 * Math.min(1, a * 1.3));
      }
      g.putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const geo = new THREE.PlaneGeometry(13, 8);
      geo.rotateX(-Math.PI / 2);
      geo.translate(2.2 + 6.5, 0.06, 0);
      this.beam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -2 }));
      this.beam.renderOrder = 3;
      this.body.add(this.beam);
    }
    if (this.beam) this.beam.visible = on;
  }

  // free the per-truck materials and textures (geometry is shared with the template)
  dispose() {
    for (const m of this.materials) { if (m.map && m.map.isCanvasTexture) m.map.dispose(); m.dispose(); }
    if (this.beam) { this.beam.material.map.dispose(); this.beam.material.dispose(); this.beam.geometry.dispose(); }
    this.materials.length = 0;
  }

  // pick the wheel detail from the camera distance
  setLod(far) {
    if (this.far === far) return;
    this.far = far;
    for (const w of this.wheels) if (w.lod) { w.lod.visible = far; w.hi.visible = !far; }
  }

  // s: interpolated sim state; dt render delta
  update(s, dt, track) {
    dt = Math.max(0, Math.min(dt, 0.05)); // springs below blow up with a negative step
    const r = this.root;
    r.position.set(s.x, s.y, s.z);
    r.rotation.set(0, -s.h, 0);
    const c = Math.cos(s.h), sn = Math.sin(s.h);
    const gh = _gh;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const wx = s.x + w.x * c - w.z * sn, wz = s.z + w.x * sn + w.z * c;
      gh[i] = track.heightAt(wx, wz);
    }
    // acceleration estimates for weight transfer
    const accel = (s.vf - this.prevVf) / Math.max(dt, 1e-3);
    this.prevVf = s.vf;
    this.accSm = (this.accSm || 0) + (accel - (this.accSm || 0)) * Math.min(1, dt * 6);
    let tPitch, tRoll;
    if (!s.air) {
      tPitch = Math.atan2((gh[0] + gh[1]) / 2 - (gh[2] + gh[3]) / 2, this.wb);
      tRoll = Math.atan2((gh[0] + gh[2]) / 2 - (gh[1] + gh[3]) / 2, this.tw);
      tPitch += clamp(-this.accSm * 0.004, -0.05, 0.05);
      tRoll += clamp(s.vf * s.w * 0.0042, -0.085, 0.085);
    } else {
      tPitch = clamp(Math.atan2(s.vy, Math.max(4, Math.abs(s.vf))) * 0.65, -0.45, 0.4);
      tRoll = this.roll * 0.98;
    }
    const k = 110, d = 15;
    this.pv += ((tPitch - this.pitch) * k - this.pv * d) * dt;
    this.rv += ((tRoll - this.roll) * k - this.rv * d) * dt;
    this.pitch += this.pv * dt; this.roll += this.rv * dt;
    if (s.landKick) this.bodyYv -= s.landKick;
    this.bodyYv += (-this.bodyY * 170 - this.bodyYv * 13) * dt;
    this.bodyY = clamp(this.bodyY + this.bodyYv * dt, -0.22, 0.16);
    this.body.position.y = this.bodyY;
    this.body.rotation.set(this.roll, 0, this.pitch);

    this.dist += s.vf * dt;
    this.steerA += (s.steer * 0.45 - this.steerA) * Math.min(1, dt * 12);
    const sp = Math.sin(this.pitch), sr = Math.sin(this.roll);
    const [lo, hi] = this.travel;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const plane = this.bodyY + w.x * sp - w.z * sr;
      let wy = s.air ? plane + w.r + lo + 0.02 : gh[i] - s.y + w.r;
      wy = clamp(wy, plane + w.r + lo, plane + w.r + hi);
      this.susp[i] += (wy - this.susp[i]) * Math.min(1, dt * 28);
      w.steer.position.y = this.susp[i];
      w.spin.rotation.z = -this.dist / w.r;
      if (i < 2) w.steer.rotation.y = -this.steerA;
    }
    // whip flag sways with acceleration and turning
    if (this.whip) {
      const tA = clamp(this.accSm * 0.02 + Math.abs(s.vf) * 0.006, -0.35, 0.45);
      const tB = clamp(-s.w * Math.abs(s.vf) * 0.012, -0.4, 0.4);
      this.whipV += ((tA - this.whipA) * 60 - this.whipV * 4) * dt;
      this.whipBV += ((tB - this.whipB) * 60 - this.whipBV * 4) * dt;
      this.whipA += this.whipV * dt; this.whipB += this.whipBV * dt;
      this.whip.rotation.set(this.whipB, 0, this.whipA);
    }
  }

  // world position of a marker (e.g. exhaust) - uses the current matrices
  markerWorld(name, out) {
    const m = this.markers[name];
    if (!m) return out.set(0, 0, 0).applyMatrix4(this.body.matrixWorld);
    return out.copy(m).applyMatrix4(this.body.matrixWorld);
  }
}
const _gh = [0, 0, 0, 0];
