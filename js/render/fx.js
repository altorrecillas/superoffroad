// Particle effects: instanced camera-facing quads updated on the CPU.
// Dust, mud clods, water spray, nitro flames, sparks, confetti, fireworks.

import * as THREE from 'three';

function makeTex(kind) {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  if (kind === 'puff') {
    // soft cloud with lumpy edges
    const img = g.createImageData(s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = (x - s / 2) / (s / 2), dy = (y - s / 2) / (s / 2);
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const lump = 0.82 + 0.1 * Math.sin(a * 5 + 1.3) + 0.06 * Math.sin(a * 9 + 0.4) + 0.04 * Math.sin(a * 13);
      let v = Math.max(0, 1 - r / lump);
      v = v * v * (3 - 2 * v);
      const n = 0.75 + 0.25 * Math.sin(x * 0.31 + Math.sin(y * 0.17) * 3) * Math.sin(y * 0.27 + Math.cos(x * 0.13) * 2);
      const i = (y * s + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * v * n);
    }
    g.putImageData(img, 0, 0);
  } else if (kind === 'glow') {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  } else if (kind === 'drop') {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.85)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); g.fill();
  } else if (kind === 'chunk') {
    g.fillStyle = '#fff';
    g.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2, r = s * (0.32 + 0.14 * Math.sin(i * 2.7));
      g.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r);
    }
    g.fill();
  } else if (kind === 'square') {
    g.fillStyle = '#fff'; g.fillRect(s * 0.15, s * 0.3, s * 0.7, s * 0.4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iColor;
  attribute vec3 iVel;
  attribute vec2 iSizeRot;
  uniform float uStretch;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vFogDepth;
  void main(){
    vUv = uv;
    vColor = iColor;
    vec4 mv = viewMatrix * vec4(iPos, 1.0);
    vec2 q = position.xy * iSizeRot.x;
    if (uStretch > 0.0) {
      // align with the screen-space velocity (sparks, drops)
      vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
      vec2 d = vv.xy;
      float l = length(d);
      vec2 dir = l > 1e-4 ? d / l : vec2(0.0, 1.0);
      vec2 nrm = vec2(-dir.y, dir.x);
      float len = iSizeRot.x * (1.0 + l * uStretch);
      q = dir * position.y * len + nrm * position.x * iSizeRot.x * 0.6;
    } else {
      float c = cos(iSizeRot.y), s = sin(iSizeRot.y);
      q = mat2(c, s, -s, c) * q;
    }
    mv.xy += q;
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 fogColor;
  uniform float fogNear, fogFar;
  uniform float uFog;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vFogDepth;
  void main(){
    vec4 t = texture2D(map, vUv);
    vec4 c = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
    if (c.a < 0.003) discard;
    float f = smoothstep(fogNear, fogFar, vFogDepth) * uFog;
    c.rgb = mix(c.rgb, fogColor, f);
    gl_FragColor = c;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Particles {
  constructor(max, opts = {}) {
    this.max = max;
    this.n = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.vel = new Float32Array(max * 3);
    this.sr = new Float32Array(max * 2);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSR = new THREE.InstancedBufferAttribute(this.sr, 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iColor', this.aCol);
    g.setAttribute('iVel', this.aVel);
    g.setAttribute('iSizeRot', this.aSR);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        map: { value: makeTex(opts.tex || 'puff') }, uStretch: { value: opts.stretch || 0 },
        fogColor: { value: new THREE.Color(0xc9d8e2) }, fogNear: { value: 220 }, fogFar: { value: 700 }, uFog: { value: 1 },
      },
      transparent: true, depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder ?? 10;
    // per-particle state
    this.p = [];
    for (let i = 0; i < max; i++) this.p.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, age: 0, s0: 1, s1: 1, r: 1, g: 1, b: 1, a: 1, drag: 0, grav: 0, rot: 0, vr: 0, ground: -1e9, fade: 1, bounce: 0 });
    this.geo = g;
  }

  spawn(o) {
    if (this.n >= this.max) {
      // recycle the oldest
      let oldest = 0, best = -1;
      for (let i = 0; i < this.n; i++) { const p = this.p[i]; const t = p.age / p.life; if (t > best) { best = t; oldest = i; } }
      this._set(this.p[oldest], o);
      return;
    }
    this._set(this.p[this.n++], o);
  }
  _set(p, o) {
    p.x = o.x; p.y = o.y; p.z = o.z;
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.life = o.life || 1; p.age = 0;
    p.s0 = o.size ?? 1; p.s1 = o.size1 ?? p.s0;
    p.r = o.r ?? 1; p.g = o.g ?? 1; p.b = o.b ?? 1; p.a = o.a ?? 1;
    p.r1 = o.r1 ?? p.r; p.g1 = o.g1 ?? p.g; p.b1 = o.b1 ?? p.b;
    p.drag = o.drag || 0; p.grav = o.grav || 0;
    p.rot = o.rot ?? Math.random() * 6.28; p.vr = o.vr || 0;
    p.ground = o.ground ?? -1e9; p.bounce = o.bounce || 0;
    p.fadeIn = o.fadeIn ?? 0.08;
    p.flutter = o.flutter || 0;
  }

  update(dt, groundFn) {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const p = this.p[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k; p.vy *= k; p.vz *= k;
      p.vy -= p.grav * dt;
      if (p.flutter) { p.vx += Math.sin(p.age * 7 + i) * p.flutter * dt; p.vz += Math.cos(p.age * 5 + i * 1.7) * p.flutter * dt; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.vr * dt;
      if (p.bounce >= 0 && p.grav > 0 && groundFn) {
        const gy = groundFn(p.x, p.z);
        if (p.y < gy) { p.y = gy; p.vy = -p.vy * p.bounce; p.vx *= 0.5; p.vz *= 0.5; p.vr *= 0.5; }
      }
      // compact live particles to the front
      if (w !== i) { const t = this.p[w]; this.p[w] = p; this.p[i] = t; }
      const t = p.age / p.life;
      const fin = Math.min(1, p.age / p.fadeIn);
      const a = p.a * fin * (1 - t) * (1 - t * 0.3);
      this.pos[w * 3] = p.x; this.pos[w * 3 + 1] = p.y; this.pos[w * 3 + 2] = p.z;
      this.col[w * 4] = p.r + (p.r1 - p.r) * t; this.col[w * 4 + 1] = p.g + (p.g1 - p.g) * t; this.col[w * 4 + 2] = p.b + (p.b1 - p.b) * t; this.col[w * 4 + 3] = a;
      this.vel[w * 3] = p.vx; this.vel[w * 3 + 1] = p.vy; this.vel[w * 3 + 2] = p.vz;
      this.sr[w * 2] = p.s0 + (p.s1 - p.s0) * t; this.sr[w * 2 + 1] = p.rot;
      w++;
    }
    this.n = w;
    this.geo.instanceCount = w;
    if (w) {
      this.aPos.needsUpdate = this.aCol.needsUpdate = this.aVel.needsUpdate = this.aSR.needsUpdate = true;
    }
  }
  clear() { this.n = 0; this.geo.instanceCount = 0; }
  setFog(fog) {
    if (!fog) { this.mat.uniforms.uFog.value = 0; return; }
    this.mat.uniforms.uFog.value = 1;
    this.mat.uniforms.fogColor.value.copy(fog.color);
    this.mat.uniforms.fogNear.value = fog.near; this.mat.uniforms.fogFar.value = fog.far;
  }
}

// all the effect layers used in a race
export class FX {
  constructor(scene, quality = 'high') {
    const k = quality === 'low' ? 0.5 : 1;
    this.k = k;
    this.dust = new Particles(Math.round(1400 * k), { tex: 'puff', renderOrder: 11 });
    this.smoke = new Particles(Math.round(300 * k), { tex: 'puff', renderOrder: 12 });
    this.clods = new Particles(Math.round(500 * k), { tex: 'chunk', renderOrder: 9 });
    this.spray = new Particles(Math.round(700 * k), { tex: 'drop', stretch: 0.06, renderOrder: 13 });
    this.fire = new Particles(Math.round(500 * k), { tex: 'glow', additive: true, renderOrder: 14 });
    this.sparks = new Particles(Math.round(300 * k), { tex: 'glow', additive: true, stretch: 0.12, renderOrder: 15 });
    this.confetti = new Particles(Math.round(900 * k), { tex: 'square', renderOrder: 16 });
    this.layers = [this.clods, this.dust, this.smoke, this.spray, this.fire, this.sparks, this.confetti];
    for (const l of this.layers) scene.add(l.mesh);
    this.dustColor = [0.62, 0.42, 0.28];
  }
  setFog(fog) { for (const l of this.layers) l.setFog(fog); }
  update(dt, ground) { for (const l of this.layers) l.update(dt, ground); }
  clear() { for (const l of this.layers) l.clear(); }

  // --- emitters
  wheelDust(x, y, z, vx, vz, amount, lit = 1) {
    const [r, g, b] = this.dustColor;
    const s = Math.random();
    this.dust.spawn({
      x: x + (Math.random() - 0.5) * 0.6, y: y + 0.25, z: z + (Math.random() - 0.5) * 0.6,
      vx: vx * 0.25 + (Math.random() - 0.5) * 1.6, vy: 0.6 + Math.random() * 1.2, vz: vz * 0.25 + (Math.random() - 0.5) * 1.6,
      life: 1.3 + Math.random() * 1.8 * amount, size: 1.0 + s * 0.7, size1: 4.0 + amount * 4.5 + s * 2.4,
      r: r * lit * (0.9 + s * 0.2), g: g * lit * (0.9 + s * 0.2), b: b * lit * (0.9 + s * 0.2), a: 0.26 + amount * 0.34,
      drag: 1.6, grav: -0.25, vr: (Math.random() - 0.5) * 0.8, fadeIn: 0.12,
    });
  }
  clod(x, y, z, vx, vy, vz, wet = 0) {
    const d = 0.18 + Math.random() * 0.1;
    this.clods.spawn({
      x, y, z, vx, vy, vz, life: 0.9 + Math.random() * 0.6, size: 0.12 + Math.random() * 0.16,
      r: d * (1.4 - wet * 0.5), g: d * (0.95 - wet * 0.3), b: d * (0.6 - wet * 0.2), a: 1,
      grav: 18, drag: 0.4, vr: (Math.random() - 0.5) * 20, ground: 0, bounce: 0.25, fadeIn: 0.01,
    });
  }
  splash(x, y, z, vx, vz, power) {
    const n = Math.round((6 + power * 14) * this.k);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 4 * power;
      this.spray.spawn({
        x: x + Math.cos(a) * 0.8, y: y + 0.2, z: z + Math.sin(a) * 0.8,
        vx: vx * 0.35 + Math.cos(a) * sp, vy: 2.5 + Math.random() * 5 * power, vz: vz * 0.35 + Math.sin(a) * sp,
        life: 0.7 + Math.random() * 0.5, size: 0.1 + Math.random() * 0.14,
        r: 0.78, g: 0.74, b: 0.68, a: 0.8, grav: 14, drag: 0.6, ground: 0, bounce: -1, fadeIn: 0.01,
      });
    }
    for (let i = 0; i < Math.round(2 + power * 3); i++) {
      this.smoke.spawn({
        x: x + (Math.random() - 0.5), y: y + 0.4, z: z + (Math.random() - 0.5),
        vx: vx * 0.2 + (Math.random() - 0.5) * 2, vy: 1 + Math.random(), vz: vz * 0.2 + (Math.random() - 0.5) * 2,
        life: 0.8 + Math.random() * 0.6, size: 1, size1: 3.5, r: 0.85, g: 0.85, b: 0.86, a: 0.35, drag: 2,
      });
    }
  }
  nitro(x, y, z, dx, dz, vx, vz) {
    for (let i = 0; i < 2; i++) {
      const sp = 7 + Math.random() * 5;
      this.fire.spawn({
        x, y, z, vx: vx * 0.6 + dx * sp + (Math.random() - 0.5) * 1.2, vy: (Math.random() - 0.2) * 1.2, vz: vz * 0.6 + dz * sp + (Math.random() - 0.5) * 1.2,
        life: 0.16 + Math.random() * 0.12, size: 0.55, size1: 0.15,
        r: 0.45, g: 0.75, b: 2.6, r1: 2.6, g1: 0.9, b1: 0.25, a: 1, drag: 3, fadeIn: 0.01,
      });
    }
  }
  exhaustPuff(x, y, z, vx, vz, dark = 0.3) {
    this.smoke.spawn({
      x, y, z, vx: vx * 0.3, vy: 0.8, vz: vz * 0.3, life: 0.9, size: 0.35, size1: 1.6,
      r: dark, g: dark, b: dark, a: 0.25, drag: 1.5,
    });
  }
  sparksAt(x, y, z, nx, nz, power) {
    const n = Math.round((5 + power * 10) * this.k);
    for (let i = 0; i < n; i++) {
      const sp = 3 + Math.random() * 7 * power;
      this.sparks.spawn({
        x, y: y + 0.4 + Math.random() * 0.4, z,
        vx: nx * sp + (Math.random() - 0.5) * 6, vy: 1 + Math.random() * 4, vz: nz * sp + (Math.random() - 0.5) * 6,
        life: 0.25 + Math.random() * 0.35, size: 0.07, r: 2.4, g: 1.6, b: 0.6, a: 1, grav: 12, drag: 1, fadeIn: 0.01,
      });
    }
  }
  landing(x, y, z, power) {
    const [r, g, b] = this.dustColor;
    const n = Math.round((6 + power * 12) * this.k);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4, sp = 2 + power * 4 + Math.random() * 2;
      this.dust.spawn({
        x: x + Math.cos(a) * 1.4, y: y + 0.2, z: z + Math.sin(a) * 1.4,
        vx: Math.cos(a) * sp, vy: 0.4 + Math.random(), vz: Math.sin(a) * sp,
        life: 1.0 + Math.random() * 1.2, size: 1, size1: 3 + power * 3, r, g, b, a: 0.35, drag: 2.4, grav: -0.2,
      });
    }
  }
  pickupBurst(x, y, z, kind) {
    const gold = kind === 'money';
    for (let i = 0; i < 26 * this.k; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, sp = 3 + Math.random() * 5;
      this.sparks.spawn({
        x, y: y + 1, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 2, vz: Math.sin(a) * Math.cos(e) * sp,
        life: 0.5 + Math.random() * 0.4, size: 0.1,
        r: gold ? 2.6 : 0.6, g: gold ? 2.0 : 1.4, b: gold ? 0.4 : 2.8, a: 1, grav: 6, drag: 1.5, fadeIn: 0.01,
      });
    }
    this.fire.spawn({ x, y: y + 1, z, life: 0.35, size: 1, size1: 5, r: gold ? 2 : 0.6, g: gold ? 1.6 : 1.2, b: gold ? 0.3 : 2.4, a: 0.8, fadeIn: 0.01 });
  }
  confettiBurst(x, y, z, n = 160) {
    const cols = [[1, 0.15, 0.1], [0.1, 0.35, 1], [1, 0.8, 0.05], [1, 1, 1], [0.1, 0.8, 0.3]];
    for (let i = 0; i < n * this.k; i++) {
      const c = cols[i % cols.length];
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 8;
      this.confetti.spawn({
        x, y, z, vx: Math.cos(a) * sp, vy: 4 + Math.random() * 9, vz: Math.sin(a) * sp,
        life: 3.5 + Math.random() * 2.5, size: 0.28, r: c[0], g: c[1], b: c[2], a: 1,
        grav: 4.5, drag: 1.4, vr: (Math.random() - 0.5) * 14, flutter: 6, fadeIn: 0.01,
      });
    }
  }
  firework(x, y, z, color) {
    const n = Math.round(70 * this.k);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const sp = 9 + Math.random() * 3;
      this.sparks.spawn({
        x, y, z, vx: r * Math.cos(a) * sp, vy: u * sp, vz: r * Math.sin(a) * sp,
        life: 1.1 + Math.random() * 0.6, size: 0.22, r: color[0] * 3, g: color[1] * 3, b: color[2] * 3, a: 1, grav: 5, drag: 1.2, fadeIn: 0.01,
      });
    }
    this.fire.spawn({ x, y, z, life: 0.4, size: 4, size1: 14, r: color[0] * 2, g: color[1] * 2, b: color[2] * 2, a: 0.7, fadeIn: 0.01 });
  }
}
