// Stadium floor: heightfield mesh + data textures (normals/AO, track field) +
// a dynamic tyre-marks layer. The dirt look is built in the shader.

import * as THREE from 'three';
import { clamp } from '../sim/util.js';

const TEX = {};
export function loadTerrainTextures(renderer) {
  const loader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer ? renderer.capabilities.getMaxAnisotropy() : 4);
  const names = ['track_c', 'track_n', 'loose_c', 'loose_n', 'mud_c', 'mud_n'];
  return Promise.all(names.map((n) => loader.loadAsync(`assets/textures/${n}.jpg`).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    t.colorSpace = n.endsWith('_c') ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    TEX[n] = t;
  }))).then(() => TEX);
}

export function buildTerrain(track, opts = {}) {
  const { nx, nz, cell, x0, z0 } = track;
  const W = (nx - 1) * cell, D = (nz - 1) * cell;

  // ---------------- data textures
  const normalData = new Uint8Array(nx * nz * 4);
  const H = track.height;
  const ao = computeAO(track);
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const c = k * nx + i;
      const hl = H[k * nx + Math.max(0, i - 1)], hr = H[k * nx + Math.min(nx - 1, i + 1)];
      const hd = H[Math.max(0, k - 1) * nx + i], hu = H[Math.min(nz - 1, k + 1) * nx + i];
      let gx = (hr - hl) / (2 * cell), gz = (hu - hd) / (2 * cell);
      let vx = -gx, vy = 1, vz = -gz;
      const l = Math.hypot(vx, vy, vz);
      vx /= l; vz /= l;
      normalData[c * 4] = Math.round((vx * 0.5 + 0.5) * 255);
      normalData[c * 4 + 1] = Math.round((vz * 0.5 + 0.5) * 255);
      normalData[c * 4 + 2] = Math.round(ao[c] * 255);
      normalData[c * 4 + 3] = 255;
    }
  }
  const normalTex = new THREE.DataTexture(normalData, nx, nz, THREE.RGBAFormat);
  normalTex.magFilter = THREE.LinearFilter;
  normalTex.minFilter = THREE.LinearMipmapLinearFilter;
  normalTex.generateMipmaps = true;
  normalTex.wrapS = normalTex.wrapT = THREE.ClampToEdgeWrapping;
  normalTex.needsUpdate = true;

  const field = new Uint16Array(nx * nz * 4);
  const toH = THREE.DataUtils.toHalfFloat;
  for (let c = 0; c < nx * nz; c++) {
    const sdf = clamp(track.sdf[c], -20, 20);
    const s = track.near[c] >= 0 ? track.near[c] * track.path.ds : -1;
    const wl = track.water[c];
    const wd = wl > -50 ? Math.max(0, wl - H[c]) : 0;
    // wetness halo around water
    field[c * 4] = toH(sdf);
    field[c * 4 + 1] = toH(track.near[c] >= 0 ? track.lat[c] : 0);
    field[c * 4 + 2] = toH(s);
    field[c * 4 + 3] = toH(wd);
  }
  const fieldTex = new THREE.DataTexture(field, nx, nz, THREE.RGBAFormat, THREE.HalfFloatType);
  fieldTex.magFilter = THREE.LinearFilter;
  fieldTex.minFilter = THREE.LinearFilter;
  fieldTex.needsUpdate = true;

  // wet halo texture (blurred water mask) for mud around puddles
  const wet = new Uint8Array(nx * nz);
  {
    const src = new Float32Array(nx * nz);
    for (let c = 0; c < nx * nz; c++) src[c] = track.water[c] > -50 ? 1 : 0;
    const b = blur(src, nx, nz, 10);
    for (let c = 0; c < nx * nz; c++) wet[c] = Math.round(clamp(b[c] * 2.2, 0, 1) * 255);
  }
  const wetTex = new THREE.DataTexture(wet, nx, nz, THREE.RedFormat);
  wetTex.magFilter = THREE.LinearFilter; wetTex.minFilter = THREE.LinearFilter;
  wetTex.needsUpdate = true;

  // ---------------- geometry (0.5 m grid)
  const step = opts.step ?? 2; // in cells
  const gx = Math.floor((nx - 1) / step) + 1, gz = Math.floor((nz - 1) / step) + 1;
  const pos = new Float32Array(gx * gz * 3);
  const uv = new Float32Array(gx * gz * 2);
  for (let k = 0; k < gz; k++) {
    for (let i = 0; i < gx; i++) {
      const ci = Math.min(nx - 1, i * step), ck = Math.min(nz - 1, k * step);
      const v = k * gx + i;
      pos[v * 3] = x0 + ci * cell;
      pos[v * 3 + 1] = H[ck * nx + ci];
      pos[v * 3 + 2] = z0 + ck * cell;
      uv[v * 2] = ci / (nx - 1);
      uv[v * 2 + 1] = ck / (nz - 1);
    }
  }
  const idx = new Uint32Array((gx - 1) * (gz - 1) * 6);
  let q = 0;
  for (let k = 0; k < gz - 1; k++) {
    for (let i = 0; i < gx - 1; i++) {
      const a = k * gx + i, b = a + 1, c = a + gx, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b;
      idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const marks = new MarksLayer(track, opts.marksSize ?? 2048);
  const noiseRT = opts.renderer ? bakeNoise(opts.renderer, x0, z0, W, D) : null;

  const uniforms = {
    tNormalAO: { value: normalTex },
    tField: { value: fieldTex },
    tWet: { value: wetTex },
    tMarks: { value: marks.rt.texture },
    tNoise: { value: noiseRT ? noiseRT.texture : null },
    uBaked: { value: noiseRT ? 1 : 0 },
    tTrackC: { value: TEX.track_c || null },
    tTrackN: { value: TEX.track_n || null },
    tLooseC: { value: TEX.loose_c || null },
    tLooseN: { value: TEX.loose_n || null },
    tMudC: { value: TEX.mud_c || null },
    tMudN: { value: TEX.mud_n || null },
    uHiQ: { value: opts.hiq === false ? 0 : 1 },
    uArena: { value: new THREE.Vector4(x0, z0, W, D) },
    uGrid: { value: new THREE.Vector4(x0, z0, 1 / cell, 0) },
    uGridN: { value: new THREE.Vector2(nx, nz) },
    uTrackLen: { value: track.L },
    uStart: { value: new THREE.Vector4(track.startLine.x, track.startLine.z, track.startLine.tx, track.startLine.tz) },
    uStartHW: { value: track.startLine.hw },
    // Volcano Valley: centre x/z, radius, rim fraction; lava glow (night 1, day ~0.3)
    uVolc: { value: opts.volcano ? new THREE.Vector4(opts.volcano.x, opts.volcano.z, opts.volcano.r, opts.volcano.rim ?? 0.2) : new THREE.Vector4() },
    uVolcOn: { value: opts.volcano ? 1 : 0 },
    uLava: { value: 0.3 },
    uTime: { value: 0 },
  };

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    );
    sh.fragmentShader = TERRAIN_FRAG_HEAD + sh.fragmentShader
      .replace('#include <color_fragment>', TERRAIN_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>', TERRAIN_NORMAL)
      .replace('#include <aomap_fragment>', TERRAIN_AO)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += tEmit;');
  };
  mat.customProgramCacheKey = () => 'terrain-v4';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  mesh.userData = { marks, uniforms, normalTex, fieldTex, wetTex, noiseRT };
  return mesh;
}

const NOISE_GLSL = /* glsl */ `
float th(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float tn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(th(i), th(i+vec2(1,0)), u.x), mix(th(i+vec2(0,1)), th(i+vec2(1,1)), u.x), u.y); }
float tfbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * tn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

// The two large-scale fbm noises of the ground never change during a race: bake
// them once per circuit into a texture instead of 32 hash evaluations per pixel.
function bakeNoise(renderer, x0, z0, W, D) {
  const rt = new THREE.WebGLRenderTarget(512, Math.round(512 * D / W), { depthBuffer: false, type: THREE.UnsignedByteType });
  rt.texture.minFilter = THREE.LinearFilter; rt.texture.magFilter = THREE.LinearFilter; rt.texture.generateMipmaps = false;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uArena: { value: new THREE.Vector4(x0, z0, W, D) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform vec4 uArena; varying vec2 vUv;' + NOISE_GLSL +
      'void main(){ vec2 wp = uArena.xy + vUv * uArena.zw; gl_FragColor = vec4(tfbm(wp * 0.05), tfbm(wp * 0.31 + 3.0), 0.0, 1.0); }',
    depthTest: false, depthWrite: false,
  });
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  const cam = new THREE.Camera();
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  quad.geometry.dispose(); mat.dispose();
  return rt;
}

const TERRAIN_FRAG_HEAD = /* glsl */ `
uniform sampler2D tNormalAO;
uniform sampler2D tField;
uniform sampler2D tWet;
uniform sampler2D tMarks;
uniform sampler2D tNoise;
uniform float uBaked;
uniform sampler2D tTrackC, tTrackN, tLooseC, tLooseN, tMudC, tMudN;
uniform float uHiQ;
uniform vec4 uArena;
uniform vec4 uGrid;
uniform vec2 uGridN;
uniform float uTrackLen;
uniform vec4 uStart;
uniform float uStartHW;
uniform vec4 uVolc;
uniform float uVolcOn, uLava, uTime;
varying vec3 vWPos;
vec3 tEmit;
float tRough;
float tAO;
vec3 tDetailN;

${NOISE_GLSL}
mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
// two-scale sampling hides tiling from the high camera
vec4 tri(sampler2D t, vec2 uvA, vec2 uvB, float k){
  vec4 a = texture2D(t, uvA);
  if (uHiQ < 0.5) return a;
  return mix(a, texture2D(t, uvB), k);
}
`;

const TERRAIN_COLOR = /* glsl */ `
  vec2 auv = (vWPos.xz - uArena.xy) / uArena.zw;
  vec2 guv = ((vWPos.xz - uGrid.xy) * uGrid.z + 0.5) / uGridN;
  vec4 fld = texture2D(tField, guv);
  float sdf = fld.r; float lat = fld.g; float sp = fld.b; float wdepth = fld.a;
  float wetHalo = texture2D(tWet, guv).r;
  vec4 mk = texture2D(tMarks, auv);
  vec4 nao = texture2D(tNormalAO, guv);
  tAO = nao.b;
  vec2 wp = vWPos.xz;

  float nBig, nMid;
  if (uBaked > 0.5) { vec4 nzb = texture2D(tNoise, auv); nBig = nzb.r; nMid = nzb.g; }
  else { nBig = tfbm(wp * 0.05); nMid = tfbm(wp * 0.31 + 3.0); }
  float nFine0 = tn(wp * 1.7);
  float edgeN = (tn(wp * 0.9) - 0.5) * 0.9;
  float onTrack = smoothstep(0.7, -0.6, sdf + edgeN);

  vec2 uvA = wp / 2.7;
  vec2 uvB = rot2(0.83) * wp / 7.9 + 0.37;
  float kB = 0.45;
  vec4 cT = tri(tTrackC, uvA, uvB, kB);
  vec4 nT = tri(tTrackN, uvA, uvB, kB);
  vec4 cL = tri(tLooseC, uvA * 1.15, uvB * 1.1, kB);
  vec4 nL = tri(tLooseN, uvA * 1.15, uvB * 1.1, kB);
  float wetness = clamp(wetHalo * 1.1 + mk.g, 0.0, 1.0);
  vec4 cM = texture2D(tMudC, uvA * 0.9);
  vec4 nM = texture2D(tMudN, uvA * 0.9);

  // track surface: packed clay, worn darker along the racing groove
  vec3 tr = cT.rgb * vec3(1.02, 0.97, 0.92);
  float wear = smoothstep(4.8, 0.5, abs(lat));
  float groove = 0.5 + 0.5 * sin(lat * 8.0 + tn(vec2(sp * 0.13, lat * 0.4)) * 3.0 + nMid * 2.0);
  tr *= 0.93 + 0.1 * groove * onTrack;
  tr = mix(tr, tr * vec3(0.86, 0.82, 0.8), wear * 0.35);
  // infield: loose laterite, lighter dusty patches
  vec3 off = cL.rgb * vec3(1.05, 0.98, 0.95);
  float dust = smoothstep(0.45, 0.75, nBig);
  off = mix(off, off * vec3(1.32, 1.22, 1.12), dust * 0.6);
  vec3 col = mix(off, tr, onTrack);
  col *= 0.88 + 0.24 * nMid;
  // high and steep ground turns to dark volcanic rock (big mounds, the volcano)
  float steep = 1.0 - clamp((nao.r - 0.5) * (nao.r - 0.5) * 4.0 + (nao.g - 0.5) * (nao.g - 0.5) * 4.0, 0.0, 1.0);
  float rocky = smoothstep(3.0, 7.0, vWPos.y) * (1.0 - onTrack * 0.8);
  col = mix(col, vec3(0.2, 0.14, 0.11) * (0.8 + 0.4 * nFine0), clamp(rocky * (0.6 + 0.4 * (1.0 - steep)), 0.0, 0.85));
  // the volcano: basalt and ash gullies on the cone, lava channels running down from the rim
  tEmit = vec3(0.0);
  if (uVolcOn > 0.5) {
    vec2 dv = wp - uVolc.xy;
    float rr = length(dv);
    float dist = rr / uVolc.z;
    float rim = uVolc.w;
    float ang = atan(dv.y, dv.x);
    vec2 dir = dv / max(rr, 1e-3);
    float cone = smoothstep(0.95, 0.45, dist) * (1.0 - onTrack * 0.92);
    // radial ash gullies (noise sampled on the direction: no seam where atan wraps)
    float g = tn(dir * 8.0 + vec2(dist * 2.0, -dist * 1.3)) * 0.6 + tn(dir * 21.0 + vec2(dist * 6.0, dist * 4.0)) * 0.4;
    vec3 basalt = mix(vec3(0.07, 0.06, 0.055), vec3(0.25, 0.2, 0.17), g) * (0.85 + 0.3 * nFine0);
    col = mix(col, basalt, cone);
    // lava channels: five uneven slots around the rim, some empty, each with its
    // own length, width and meander (cells hashed modulo 5 so the wrap is seamless)
    float warp = ang + 0.3 * sin(ang * 2.0 + 1.3) + 0.1 * sin(ang * 3.0 + 4.1);
    float a5 = warp / 6.2831853 * 5.0;
    float c0 = mod(floor(a5 + 0.5), 5.0);
    float a5m = a5 + (tn(vec2(dist * 7.0, c0 * 1.7)) - 0.5) * 0.5;
    float ci = mod(floor(a5m + 0.5), 5.0);
    float present = step(0.3, th(vec2(ci, 3.0)));
    float across = abs(a5m - floor(a5m + 0.5)) * 1.2566371 * rr; // metres from the channel's centre line
    float len = rim + 0.08 + 0.3 * th(vec2(ci, 7.0));
    float along = clamp((dist - rim) / (len - rim), 0.0, 1.0);
    float wid = mix(1.2, 0.25, along) * (0.6 + 0.8 * th(vec2(ci, 11.0))) * (0.7 + 0.6 * tn(vec2(rr * 1.1, ci * 3.1)));
    float lava = smoothstep(wid, wid * 0.3, across) * smoothstep(rim * 0.97, rim * 1.06, dist)
      * (1.0 - smoothstep(0.75, 1.0, along)) * (1.0 - onTrack) * present;
    col = mix(col, vec3(0.045, 0.028, 0.022), lava * 0.92);
    float pulse = 0.55 + 0.45 * tn(vec2(rr * 1.4 - uTime * 0.9, ci * 5.3));
    tEmit = vec3(4.2, 1.0, 0.12) * lava * pulse * (1.0 - along * 0.65) * uLava;
  }
  // wet mud around water
  col = mix(col, cM.rgb * vec3(0.9, 0.8, 0.75), wetness * 0.85);
  // tyre marks: compacted darker dirt
  col = mix(col, col * vec3(0.62, 0.57, 0.53), clamp(mk.r, 0.0, 1.0) * 0.8);

  // start / finish line: checkered paint across the track at s = 0
  {
    vec2 d = wp - uStart.xy;
    float along = dot(d, uStart.zw);
    float across = dot(d, vec2(-uStart.w, uStart.z));
    if (abs(along) < 0.95 && abs(across) < uStartHW + 0.4) {
      float cx = floor(across / 0.95), cy = floor((along + 0.95) / 0.95);
      float chk = mod(cx + cy, 2.0);
      vec3 paint = mix(vec3(0.035), vec3(0.82, 0.8, 0.76), chk);
      float worn = smoothstep(0.35, 0.85, tn(wp * 2.3) * 0.7 + cT.r * 0.6 + mk.r * 0.5);
      col = mix(col, paint, (1.0 - worn * 0.6) * 0.9);
    }
  }
  diffuseColor.rgb = col;
  float rT = nT.b, rL = nL.b;
  tRough = mix(rL, rT, onTrack);
  tRough = mix(tRough, nM.b * 0.6, wetness);
  tRough = clamp(tRough - mk.r * 0.08, 0.2, 1.0);
  vec2 dn = mix(nL.rg, nT.rg, onTrack) * 2.0 - 1.0;
  dn = mix(dn, (nM.rg * 2.0 - 1.0), wetness * 0.7);
  float gAmp = mix(0.9, 0.7, onTrack);
  tDetailN = vec3(dn.x * gAmp, 0.0, dn.y * gAmp);
  tDetailN.x += cos(lat * 8.0) * 0.06 * onTrack;
`;

const TERRAIN_NORMAL = /* glsl */ `
  {
    vec2 nxz = nao.rg * 2.0 - 1.0;
    vec3 wn = vec3(nxz.x, sqrt(max(0.0, 1.0 - dot(nxz, nxz))), nxz.y);
    wn = normalize(wn + tDetailN);
    normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
  }
`;

const TERRAIN_AO = /* glsl */ `
  {
    float aoF = mix(1.0, tAO, 0.55);
    reflectedLight.indirectDiffuse *= aoF;
    reflectedLight.indirectSpecular *= aoF;
  }
`;

// horizon-based ambient occlusion from the heightfield
function computeAO(track) {
  const { nx, nz, cell, height: H } = track;
  const ao = new Float32Array(nx * nz);
  const dirs = 8;
  const dists = [0.5, 1, 2, 3.5, 6, 10];
  const offs = [];
  for (let d = 0; d < dirs; d++) {
    const a = (d / dirs) * Math.PI * 2;
    offs.push(dists.map((r) => [Math.round((Math.cos(a) * r) / cell), Math.round((Math.sin(a) * r) / cell), r]));
  }
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const h0 = H[k * nx + i];
      let occ = 0;
      for (let d = 0; d < dirs; d++) {
        let mx = 0;
        for (const [di, dk, r] of offs[d]) {
          const ii = i + di, kk = k + dk;
          if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) continue;
          const s = (H[kk * nx + ii] - h0) / r;
          if (s > mx) mx = s;
        }
        occ += Math.min(1, mx / Math.sqrt(1 + mx * mx) * 1.2);
      }
      ao[k * nx + i] = 1 - (occ / dirs) * 0.85;
    }
  }
  return ao;
}

function blur(src, nx, nz, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let k = 0; k < nz; k++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[k * nx + clamp(i, 0, nx - 1)];
    for (let i = 0; i < nx; i++) {
      tmp[k * nx + i] = acc / (2 * r + 1);
      acc += src[k * nx + clamp(i + r + 1, 0, nx - 1)] - src[k * nx + clamp(i - r, 0, nx - 1)];
    }
  }
  for (let i = 0; i < nx; i++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[clamp(k, 0, nz - 1) * nx + i];
    for (let k = 0; k < nz; k++) {
      out[k * nx + i] = acc / (2 * r + 1);
      acc += tmp[clamp(k + r + 1, 0, nz - 1) * nx + i] - tmp[clamp(k - r, 0, nz - 1) * nx + i];
    }
  }
  return out;
}

// ------------------------------------------------------------------ tyre marks

export class MarksLayer {
  constructor(track, size) {
    const aspect = (track.x1 - track.x0) / (track.z1 - track.z0);
    this.w = size; this.h = Math.round(size / aspect);
    this.rt = new THREE.WebGLRenderTarget(this.w, this.h, { depthBuffer: false, type: THREE.UnsignedByteType });
    this.rt.texture.generateMipmaps = false;
    this.rt.texture.minFilter = THREE.LinearFilter;
    this.track = track;
    this.cam = new THREE.OrthographicCamera(track.x0, track.x1, track.z1, track.z0, -10, 10);
    // look down so that +x maps right and +z maps to texture v
    this.cam.position.set(0, 5, 0);
    this.cam.up.set(0, 0, 1);
    this.cam.lookAt(0, 0, 0);
    this.scene = new THREE.Scene();
    this.max = 256;
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uArena: { value: new THREE.Vector4(track.x0, track.z0, track.x1 - track.x0, track.z1 - track.z0) } },
      vertexShader: `
        uniform vec4 uArena;
        attribute vec2 iStr;
        varying vec2 vStr; varying vec2 vUv;
        void main(){
          vStr = iStr; vUv = uv;
          vec4 w = instanceMatrix * vec4(position, 1.0);
          vec2 ndc = (w.xz - uArena.xy) / uArena.zw * 2.0 - 1.0;
          gl_Position = vec4(ndc, 0.0, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vStr; varying vec2 vUv;
        void main(){
          float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
          gl_FragColor = vec4(vStr.x * edge, vStr.y * edge, 0.0, 1.0);
        }`,
    });
    this.inst = new THREE.InstancedMesh(g, this.mat, this.max);
    this.inst.frustumCulled = false;
    this.str = new Float32Array(this.max * 2);
    this.inst.geometry.setAttribute('iStr', new THREE.InstancedBufferAttribute(this.str, 2));
    this.scene.add(this.inst);
    this.count = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this.needsClear = true;
  }
  clear() { this.needsClear = true; }
  dispose() { this.rt.dispose(); this.inst.geometry.dispose(); this.mat.dispose(); this.inst.dispose(); }
  add(x0, z0, x1, z1, width, dark, wet) {
    if (this.count >= this.max) return;
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return;
    const ang = Math.atan2(dz, dx);
    this._p.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    this._q.setFromAxisAngle(_Y, -ang + Math.PI / 2);
    this._s.set(width, 1, len + 0.08);
    this._m.compose(this._p, this._q, this._s);
    this.inst.setMatrixAt(this.count, this._m);
    this.str[this.count * 2] = dark; this.str[this.count * 2 + 1] = wet;
    this.count++;
  }
  flush(renderer) {
    if (!this.count && !this.needsClear) return;
    const prevRT = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.setRenderTarget(this.rt);
    if (this.needsClear) { renderer.setClearColor(0x000000, 0); renderer.clear(); this.needsClear = false; }
    renderer.autoClear = false;
    if (this.count) {
      this.inst.count = this.count;
      this.inst.instanceMatrix.needsUpdate = true;
      this.inst.geometry.attributes.iStr.needsUpdate = true;
      renderer.render(this.scene, this.cam);
    }
    renderer.autoClear = prevAuto;
    renderer.setRenderTarget(prevRT);
    this.count = 0;
  }
}
const _Y = new THREE.Vector3(0, 1, 0);
