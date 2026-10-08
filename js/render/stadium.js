// The stadium around the dirt floor: perimeter wall with sponsor boards,
// two-tier grandstands, an animated sprite crowd, light towers and the
// big screen. Built once and reused for every track.

import * as THREE from 'three';
import { rng } from '../sim/util.js';

// stadium floor outline (rounded rectangle) - the wall's inner face
export const BOWL = { A: 66.6, B: 41.6, R: 13 };

// sample a rounded rectangle offset outwards by d: [{x,z,nx,nz,s}]
function outline(d, step = 0.5) {
  const A = BOWL.A - BOWL.R, B = BOWL.B - BOWL.R, r = BOWL.R + d;
  const pts = [];
  const pushLine = (x0, z0, x1, z1, nx, nz) => {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / step));
    for (let i = 0; i < n; i++) { const t = i / n; pts.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, nx, nz }); }
  };
  const pushArc = (cx, cz, a0) => {
    const n = Math.max(4, Math.round((Math.PI / 2 * r) / step));
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI / 2;
      pts.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, nx: Math.cos(a), nz: Math.sin(a) });
    }
  };
  // clockwise seen from above starting at the top edge going +x (z = -B - r)
  pushLine(-A, -B - r, A, -B - r, 0, -1);
  pushArc(A, -B, -Math.PI / 2);
  pushLine(A + r, -B, A + r, B, 1, 0);
  pushArc(A, B, 0);
  pushLine(A, B + r, -A, B + r, 0, 1);
  pushArc(-A, B, Math.PI / 2);
  pushLine(-A - r, B, -A - r, -B, -1, 0);
  pushArc(-A, -B, Math.PI);
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    pts[i].s = s;
    const j = (i + 1) % pts.length;
    s += Math.hypot(pts[j].x - pts[i].x, pts[j].z - pts[i].z);
  }
  pts.length2 = s;
  return pts;
}

// sweep a profile [[offset, height, colorIndex], ...] along an outline
function sweep(pts, profile, colorFn, uvScale = 1, open = false) {
  const pos = [], col = [], uv = [], idx = [];
  const n = pts.length, m = profile.length;
  const c = new THREE.Color();
  for (let i = 0; i <= (open ? n - 1 : n); i++) {
    const p = pts[i % n];
    const s = i === n ? pts.length2 : p.s;
    for (let k = 0; k < m; k++) {
      const [o, h, ci] = profile[k];
      pos.push(p.x + p.nx * o, h, p.z + p.nz * o);
      colorFn(c, ci, s, k, p);
      col.push(c.r, c.g, c.b);
      uv.push(s * uvScale, k / (m - 1));
    }
  }
  for (let i = 0; i < (open ? n - 1 : n); i++) {
    for (let k = 0; k < m - 1; k++) {
      const a = i * m + k, b = (i + 1) * m + k;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ sponsor boards
const SPONSORS = [
  ['SUPER OFF ROAD', '#ffd21f', '#b3120e'], ['IRONMAN SPEED SHOP', '#ffffff', '#1d1d1f'], ['NITRO X', '#4bd2ff', '#0b2a63'],
  ['DIRT KING TIRES', '#ffffff', '#c41d14'], ['BAJA FUEL', '#1d1d1f', '#f2b705'], ['MUD CITY', '#f4e7cf', '#5b3216'],
  ['LELAND RACING', '#ffffff', '#1f4fbf'], ['TURBO COLA', '#ffffff', '#d4151c'], ['STADIUM SERIES 1989', '#ffd21f', '#1a1a1a'],
  ['ROUGH RIDER SHOCKS', '#1a1a1a', '#e9e9e9'], ['GOLD BEAD WHEELS', '#2a1a05', '#e0a52a'], ['DESERT DUST', '#ffffff', '#c26a1f'],
];
function sponsorTexture() {
  const W = 2048, H = 128, n = SPONSORS.length;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const bw = W / n;
  SPONSORS.forEach(([txt, fg, bg], i) => {
    const x = i * bw;
    g.fillStyle = bg; g.fillRect(x, 0, bw, H);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x, 0, bw, H * 0.18);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, H * 0.86, bw, H * 0.14);
    g.fillStyle = fg;
    let size = 70;
    g.font = `italic 900 ${size}px "Arial Black", Impact, sans-serif`;
    while (g.measureText(txt).width > bw * 0.88 && size > 20) { size -= 2; g.font = `italic 900 ${size}px "Arial Black", Impact, sans-serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(txt, x + bw / 2, H * 0.52);
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x + bw - 3, 0, 3, H);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return { tex: t, period: n };
}

// ------------------------------------------------------------------ crowd sprites
// atlas of little people: R = shirt, G = skin, B = hair/trousers, A = alpha
function crowdAtlas() {
  const FW = 64, FH = 96, cols = 4, rows = 2;
  const c = document.createElement('canvas');
  c.width = FW * cols; c.height = FH * rows;
  const g = c.getContext('2d');
  const draw = (fx, fy, pose) => {
    const ox = fx * FW, oy = fy * FH;
    g.save();
    g.translate(ox + FW / 2, oy);
    const shirt = 'rgb(255,0,0)', skin = 'rgb(0,255,0)', dark = 'rgb(0,0,255)';
    const standing = pose >= 2;
    const torsoTop = standing ? 30 : 44, torsoBot = standing ? 70 : 80;
    // legs / trousers
    g.fillStyle = dark;
    if (standing) { g.fillRect(-11, torsoBot - 2, 9, 26); g.fillRect(2, torsoBot - 2, 9, 26); }
    else g.fillRect(-13, torsoBot - 4, 26, 14);
    // torso
    g.fillStyle = shirt;
    g.beginPath(); g.roundRect(-14, torsoTop, 28, torsoBot - torsoTop, 8); g.fill();
    // arms
    g.strokeStyle = shirt; g.lineWidth = 8; g.lineCap = 'round';
    const sh = torsoTop + 6;
    if (pose === 3) { // arms up cheering
      g.beginPath(); g.moveTo(-11, sh); g.lineTo(-20, sh - 26); g.stroke();
      g.beginPath(); g.moveTo(11, sh); g.lineTo(21, sh - 26); g.stroke();
      g.fillStyle = skin; g.beginPath(); g.arc(-21, sh - 29, 4.5, 0, 7); g.arc(22, sh - 29, 4.5, 0, 7); g.fill();
    } else if (pose === 1) { // clapping
      g.beginPath(); g.moveTo(-11, sh); g.lineTo(-3, sh + 14); g.stroke();
      g.beginPath(); g.moveTo(11, sh); g.lineTo(3, sh + 14); g.stroke();
      g.fillStyle = skin; g.beginPath(); g.arc(0, sh + 15, 5, 0, 7); g.fill();
    } else {
      g.beginPath(); g.moveTo(-12, sh); g.lineTo(-15, sh + 22); g.stroke();
      g.beginPath(); g.moveTo(12, sh); g.lineTo(15, sh + 22); g.stroke();
    }
    // head + hair
    const hy = torsoTop - 10;
    g.fillStyle = skin; g.beginPath(); g.arc(0, hy, 10, 0, 7); g.fill();
    g.fillStyle = dark; g.beginPath(); g.arc(0, hy - 3, 10, Math.PI * 1.05, Math.PI * 1.95); g.fill();
    g.restore();
  };
  for (let i = 0; i < 8; i++) draw(i % cols, Math.floor(i / cols), i % 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const CROWD_VERT = /* glsl */ `
  attribute vec4 iPos;     // xyz, phase
  attribute vec3 iShirt;
  attribute vec4 iMisc;    // skin tone, hair tone, frame, facing
  uniform float uTime, uExcite, uFlash;
  uniform vec3 uCamRight;
  varying vec2 vUv;
  varying vec3 vShirt;
  varying vec3 vSkin;
  varying vec3 vHair;
  varying float vShade;
  varying float vFogDepth;
  void main(){
    float ph = iPos.w;
    // excitement: more people stand and cheer, bouncing
    float wave = sin(uTime * 1.3 - iPos.x * 0.05) * 0.5 + 0.5;
    float hype = clamp(uExcite + wave * 0.15, 0.0, 1.0);
    float r = fract(ph * 7.31);
    float pose = iMisc.z; // base pose 0..3
    if (r < hype * 0.85) pose = mod(floor(uTime * (1.5 + r * 2.0) + ph * 10.0), 2.0) < 1.0 ? 3.0 : 2.0;
    else if (r < 0.15 + hype) pose = (fract(uTime * 2.0 + ph) < 0.5) ? 1.0 : 0.0;
    float variant = step(0.5, fract(ph * 3.7));
    float frame = pose + variant * 4.0;
    vec2 cell = vec2(mod(frame, 4.0), floor(frame / 4.0));
    vUv = (vec2(uv.x, 1.0 - uv.y) + cell) / vec2(4.0, 2.0);
    vUv.y = 1.0 - vUv.y;
    float bounce = (pose >= 2.0) ? abs(sin(uTime * 7.0 + ph * 20.0)) * 0.12 * hype : 0.0;
    vec3 wp = iPos.xyz + vec3(0.0, bounce, 0.0);
    // billboard: horizontal axis follows the camera, vertical stays up
    vec3 right = normalize(vec3(uCamRight.x, 0.0, uCamRight.z));
    wp += right * (position.x * 0.92) + vec3(0.0, position.y * 1.38, 0.0);
    vShirt = iShirt;
    vSkin = mix(vec3(0.95, 0.75, 0.6), vec3(0.32, 0.2, 0.13), iMisc.x);
    vHair = mix(vec3(0.05, 0.04, 0.03), vec3(0.55, 0.4, 0.25), iMisc.y);
    vShade = 0.8 + 0.2 * fract(ph * 13.1);
    // camera flashes at night
    float fl = fract(uTime * 0.37 + ph * 91.7);
    vShade += uFlash * step(0.9965 - uExcite * 0.004, fl) * 14.0;
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const CROWD_FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec3 uLight;
  uniform vec3 fogColor;
  uniform float fogNear, fogFar;
  varying vec2 vUv;
  varying vec3 vShirt, vSkin, vHair;
  varying float vShade;
  varying float vFogDepth;
  void main(){
    vec4 t = texture2D(uAtlas, vUv);
    if (t.a < 0.45) discard;
    float tot = t.r + t.g + t.b + 1e-4;
    vec3 c = (vShirt * t.r + vSkin * t.g + vHair * t.b) / tot;
    c *= uLight * vShade;
    float f = smoothstep(fogNear, fogFar, vFogDepth);
    gl_FragColor = vec4(mix(c, fogColor, f), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Stadium {
  constructor(opts = {}) {
    this.group = new THREE.Group();
    this.group.name = 'stadium';
    this.density = opts.density ?? 1;
    this.castShadows = opts.shadows ?? true;
    this.r = rng(1989);
    this.time = 0;
    this.excite = 0.08;
    this.exciteTarget = 0.06;
    this._build();
    // low quality: the stands and towers stop casting (a big share of the shadow pass)
    if (!this.castShadows) this.group.traverse((o) => { o.castShadow = false; });
  }

  _build() {
    const G = this.group;
    // flat dirt skirt between the terrain grid and the wall
    const skirtShape = new THREE.Shape();
    const ol = outline(1.2, 1);
    ol.forEach((p, i) => (i ? skirtShape.lineTo(p.x, -p.z) : skirtShape.moveTo(p.x, -p.z)));
    const skirt = new THREE.Mesh(new THREE.ShapeGeometry(skirtShape), new THREE.MeshStandardMaterial({ color: 0x5a3523, roughness: 1 }));
    skirt.rotation.x = -Math.PI / 2;
    skirt.position.y = -0.35;
    skirt.receiveShadow = true;
    G.add(skirt);

    // perimeter wall: concrete with sponsor boards on the inner face
    const sp = sponsorTexture();
    const wallPts = outline(0, 0.5);
    const boardLen = 9.5;
    const wallProfile = [[0, -0.5, 0], [0, 0.15, 1], [0, 1.45, 1], [0, 1.55, 0], [0.12, 1.75, 0], [0.45, 1.75, 0], [0.5, -0.5, 0]];
    const wallGeo = sweep(wallPts, wallProfile, (c, ci) => c.setRGB(0.62, 0.6, 0.57));
    // uv: boards on the board band only
    const uvA = wallGeo.attributes.uv;
    for (let i = 0; i < uvA.count; i++) uvA.setX(i, uvA.getX(i) / boardLen);
    const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    wallMat.onBeforeCompile = (sh) => {
      sh.uniforms.tBoards = { value: sp.tex };
      sh.uniforms.uPeriod = { value: sp.period };
      sh.vertexShader = 'varying vec2 vWuv;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n vWuv = uv;');
      sh.fragmentShader = 'uniform sampler2D tBoards; uniform float uPeriod; varying vec2 vWuv;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        {
          float band = step(0.16, vWuv.y) * step(vWuv.y, 0.34);
          float seg = floor(vWuv.x);
          float idx = mod(seg * 5.0 + floor(seg / 3.0), uPeriod);
          vec2 buv = vec2((idx + fract(vWuv.x)) / uPeriod, (vWuv.y - 0.16) / 0.18);
          vec3 b = texture2D(tBoards, buv).rgb;
          diffuseColor.rgb = mix(diffuseColor.rgb, b, band);
        }`);
    };
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.castShadow = true; wall.receiveShadow = true;
    G.add(wall);

    // grandstands: lower and upper tier with a concourse between
    const rows1 = 22, rows2 = 16;
    const prof = [];
    let o = 0.5, h = 1.75;
    prof.push([o, h, 2]);
    o += 1.2; prof.push([o, h, 2]);           // front walkway
    o += 0.0; h += 0.9; prof.push([o, h, 3]);  // parapet
    o += 0.25; prof.push([o, h, 2]);
    const seatRows = [];
    for (let i = 0; i < rows1; i++) {
      seatRows.push({ o: o + 0.45, h, tier: 0 });
      o += 0.85; prof.push([o, h, 1]);
      h += 0.42; prof.push([o, h, 0]);
    }
    o += 2.5; prof.push([o, h, 2]);            // concourse
    h += 2.2; prof.push([o, h, 3]);
    o += 0.3; prof.push([o, h, 2]);
    for (let i = 0; i < rows2; i++) {
      seatRows.push({ o: o + 0.45, h, tier: 1 });
      o += 0.85; prof.push([o, h, 1]);
      h += 0.55; prof.push([o, h, 0]);
    }
    o += 1.0; prof.push([o, h, 2]);
    h += 3.0; prof.push([o, h, 3]);            // back wall
    o += 0.6; prof.push([o, h, 3]);
    prof.push([o, -1, 3]);
    this.standTop = h; this.standDepth = o;
    const standPts = outline(0, 0.6);
    const seatCols = [new THREE.Color(0x1d3f9a), new THREE.Color(0xb0201a), new THREE.Color(0xd9a40e), new THREE.Color(0x2b2f36)];
    const colorAt = (c, ci, s) => {
      const block = Math.floor(s / 24);
      const aisle = (s % 24) < 1.3;
      if (ci === 1) {
        if (aisle) c.setRGB(0.5, 0.49, 0.47);
        else c.copy(seatCols[(block * 7) % 3]).multiplyScalar(0.8);
      } else if (ci === 0) c.setRGB(0.55, 0.54, 0.52);
      else if (ci === 3) c.setRGB(0.42, 0.42, 0.44);
      else c.setRGB(0.5, 0.49, 0.47);
    };
    const standGeo = new THREE.BufferGeometry();
    // split into chunks so the camera and the shadow pass can cull them
    const standMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    const CH = 12;
    const per = Math.ceil(standPts.length / CH);
    for (let c = 0; c < CH; c++) {
      const a = c * per, b = Math.min(standPts.length, (c + 1) * per + 1);
      const pts = standPts.slice(a, b);
      if (b === standPts.length) pts.push(standPts[0]);
      pts.length2 = pts[pts.length - 1].s;
      const g = sweep(pts, prof, (col, ci, sv) => colorAt(col, ci, sv), 1, true);
      const m = new THREE.Mesh(g, standMat);
      m.castShadow = true; m.receiveShadow = true;
      G.add(m);
    }
    standGeo.dispose();

    // roof canopy over the long sides with a lighting gantry
    const roofProf = [[this.standDepth - 0.6, this.standTop + 5.5, 0], [this.standDepth - 20, this.standTop + 7.5, 0], [this.standDepth - 20, this.standTop + 6.8, 1], [this.standDepth - 0.6, this.standTop + 4.6, 1]];
    for (const side of [-1, 1]) {
      const pts = outline(0, 1).filter((p) => p.nz * side > 0.99 && Math.abs(p.x) < 52);
      pts.length2 = pts.length;
      pts.forEach((p, i) => (p.s = i));
      const rg = sweep(pts, roofProf, (c, ci) => (ci ? c.setRGB(0.16, 0.17, 0.19) : c.setRGB(0.75, 0.76, 0.78)), 1, true);
      const roof = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide }));
      roof.castShadow = true;
      G.add(roof);
      // gantry lights under the roof edge
      const lights = new THREE.Group();
      for (let x = -48; x <= 48; x += 6) {
        const p = outline(0, 1).find((q) => q.nz * side > 0.99 && Math.abs(q.x - x) < 0.6);
        if (!p) continue;
        const lx = p.x + p.nx * (this.standDepth - 19.5), lz = p.z + p.nz * (this.standDepth - 19.5);
        lights.add(this._lamp(lx, this.standTop + 6.7, lz, 1.6));
      }
      G.add(lights);
    }

    // light towers in the corners
    this.lamps = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = sx * (BOWL.A + 36), z = sz * (BOWL.B + 34);
      const tower = new THREE.Group();
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.1, 46, 10), new THREE.MeshStandardMaterial({ color: 0x8e9196, roughness: 0.5, metalness: 0.6 }));
      mast.position.set(0, 23, 0);
      mast.castShadow = true;
      tower.add(mast);
      const head = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(12, 7, 0.8), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.5 }));
      head.add(frame);
      for (let i = 0; i < 4; i++) for (let k = 0; k < 6; k++) {
        const l = this._lamp(-5 + k * 2, -2.6 + i * 1.75, 0.5, 1.5);
        head.add(l);
      }
      head.position.set(0, 46, 0);
      head.lookAt(new THREE.Vector3(-x, -40, -z).add(new THREE.Vector3(0, 46, 0)));
      tower.add(head);
      tower.position.set(x, 0, z);
      G.add(tower);
    }

    // big screen above the north stand
    const screen = new THREE.Group();
    const frameM = new THREE.MeshStandardMaterial({ color: 0x1c1d21, roughness: 0.5, metalness: 0.4 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(22, 12.5, 1.6), frameM);
    box.castShadow = true;
    screen.add(box);
    this.screenMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(20.4, 11.2), this.screenMat);
    scr.position.z = 0.82;
    screen.add(scr);
    for (const sx of [-7, 7]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 18, 0.9), frameM);
      leg.position.set(sx, -14, -0.4);
      leg.castShadow = true;
      screen.add(leg);
    }
    screen.position.set(0, this.standTop + 14, -(BOWL.B + this.standDepth - 6));
    screen.rotation.x = -0.12;
    G.add(screen);
    this.screen = scr;

    // flags along the rim
    this.flags = [];
    const flagCols = [0xd8231f, 0xffffff, 0x1f4fd8, 0xf2c014];
    const flagGeo = new THREE.PlaneGeometry(2.2, 1.3, 8, 1);
    flagGeo.translate(1.1, 0, 0);
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 5, 5);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xcfd2d6, metalness: 0.7, roughness: 0.3 });
    const rimPts = outline(this.standDepth - 0.3, 1);
    for (let i = 0; i < rimPts.length; i += 18) {
      const p = rimPts[i];
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(p.x, this.standTop + 2.5, p.z);
      G.add(pole);
      const fm = new THREE.MeshStandardMaterial({ color: flagCols[(i / 18) % 4 | 0], roughness: 0.7, side: THREE.DoubleSide });
      fm.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.flagTime || (this.flagTime = { value: 0 });
        sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          float w = position.x / 2.2;
          transformed.z += sin(uTime * 6.0 + position.x * 2.5 + ${(i * 0.37).toFixed(2)}) * 0.25 * w;
          transformed.y += sin(uTime * 4.0 + position.x * 1.7) * 0.06 * w;`);
      };
      const flag = new THREE.Mesh(flagGeo, fm);
      flag.position.set(p.x, this.standTop + 4.3, p.z);
      flag.rotation.y = Math.atan2(-p.nx, -p.nz) + Math.PI / 2;
      G.add(flag);
    }

    this._buildCrowd(seatRows);
  }

  _lamp(x, y, z, s) {
    const m = this._lampMat || (this._lampMat = new THREE.MeshBasicMaterial({ color: 0xfff4dc, toneMapped: false }));
    const g = this._lampGeo || (this._lampGeo = new THREE.CircleGeometry(0.55, 10));
    const l = new THREE.Mesh(g, m);
    l.position.set(x, y, z);
    l.scale.setScalar(s);
    return l;
  }

  _buildCrowd(rows) {
    const r = this.r;
    const pos = [], shirt = [], misc = [];
    // mostly everyday clothes, with team colours sprinkled in
    const palette = [[0.85, 0.85, 0.82], [0.85, 0.85, 0.82], [0.12, 0.12, 0.14], [0.12, 0.12, 0.14], [0.35, 0.36, 0.4],
      [0.22, 0.3, 0.55], [0.55, 0.12, 0.1], [0.62, 0.5, 0.36], [0.3, 0.42, 0.28], [0.75, 0.15, 0.1],
      [0.15, 0.3, 0.75], [0.85, 0.65, 0.1], [0.45, 0.25, 0.18], [0.6, 0.62, 0.66]];
    for (const row of rows) {
      const pts = outline(row.o, 0.62);
      for (const p of pts) {
        if ((p.s % 24) < 1.4) continue;               // aisles
        if (r() > 0.78 * this.density) continue;      // empty seats
        const j = (r() - 0.5) * 0.18;
        pos.push(p.x + p.nx * j - p.nz * (r() - 0.5) * 0.15, row.h + 0.02, p.z + p.nz * j + p.nx * (r() - 0.5) * 0.15, r());
        const c = palette[Math.floor(r() * palette.length)];
        const v = 0.75 + r() * 0.35;
        shirt.push(c[0] * v, c[1] * v, c[2] * v);
        misc.push(r() * r(), r(), Math.floor(r() * 2), 0);
      }
    }
    const n = pos.length / 4;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(pos), 4));
    g.setAttribute('iShirt', new THREE.InstancedBufferAttribute(new Float32Array(shirt), 3));
    g.setAttribute('iMisc', new THREE.InstancedBufferAttribute(new Float32Array(misc), 4));
    g.instanceCount = n;
    this.crowdMat = new THREE.ShaderMaterial({
      vertexShader: CROWD_VERT, fragmentShader: CROWD_FRAG,
      uniforms: {
        uAtlas: { value: crowdAtlas() }, uTime: { value: 0 }, uExcite: { value: 0.2 }, uFlash: { value: 0 },
        uCamRight: { value: new THREE.Vector3(1, 0, 0) }, uLight: { value: new THREE.Color(1, 1, 1) },
        fogColor: { value: new THREE.Color(0xc9d8e2) }, fogNear: { value: 220 }, fogFar: { value: 700 },
      },
    });
    const crowd = new THREE.Mesh(g, this.crowdMat);
    crowd.frustumCulled = false;
    this.group.add(crowd);
    this.crowdCount = n;
  }

  setTime(t, scene) {
    const day = t.name !== 'night';
    this._lampMat && this._lampMat.color.set(day ? 0xb9b4a6 : 0xfff6e0);
    const l = this.crowdMat.uniforms.uLight.value;
    this.crowdMat.uniforms.uFlash.value = t.name === 'night' ? 1 : 0;
    if (t.name === 'night') l.setRGB(0.32, 0.33, 0.4);
    else if (t.name === 'sunset') l.setRGB(0.95, 0.75, 0.6);
    else l.setRGB(1.05, 1.0, 0.95);
    if (scene.fog) {
      this.crowdMat.uniforms.fogColor.value.copy(scene.fog.color);
      this.crowdMat.uniforms.fogNear.value = scene.fog.near;
      this.crowdMat.uniforms.fogFar.value = scene.fog.far;
    }
  }

  cheer(amount = 1) { this.excite = Math.min(1, this.excite + amount); }

  update(dt, camera) {
    this.time += dt;
    this.excite += (this.exciteTarget - this.excite) * Math.min(1, dt * 0.6);
    const u = this.crowdMat.uniforms;
    u.uTime.value = this.time;
    u.uExcite.value = this.excite;
    const e = camera.matrixWorld.elements;
    u.uCamRight.value.set(e[0], e[1], e[2]);
    if (this.flagTime) this.flagTime.value = this.time;
  }
}
