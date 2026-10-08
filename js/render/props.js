// Trackside props: the flagman's tower at the start line, blue corner flags,
// giant oil drums, rock pillars and lizard statues, bunting over the jumps, hay
// bales and tyre stacks, plus the nitro bottles and money bags that appear
// during the race.

import * as THREE from 'three';
import { gltfLoader } from './gltf.js';
import { mergeParts } from './merge.js';
import { rng, clamp } from '../sim/util.js';
import { BARRIER_ISO } from '../sim/track.js';

// Blender-made props (tools/blender/props.py)
let PT = null;
export async function loadPropsTemplate(url = 'assets/models/props.glb') {
  try {
    const g = await gltfLoader().loadAsync(url);
    const get = (n) => g.scene.getObjectByName(n);
    PT = {};
    for (const n of ['Flagman', 'FlagArm', 'FlagCloth', 'StartTower', 'Drum', 'HayBale', 'Tyre', 'NitroBottle', 'MoneyBag', 'RockPillar', 'Lizard']) {
      const o = get(n);
      if (o) {
        o.removeFromParent(); PT[n] = o;
        // template resources are shared by every track: never dispose them
        o.traverse((m) => { if (m.isMesh) { m.geometry.userData.shared = true; (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => (x.userData.shared = true)); } });
      }
    }
    // one draw call per prop: its parts merged with a finish that suits the whole
    const FINISH = {
      Flagman: { roughness: 0.7 }, FlagArm: { roughness: 0.7 }, StartTower: { roughness: 0.6, metalness: 0.35 },
      Drum: { roughness: 0.4, metalness: 0.45 }, HayBale: { roughness: 0.93 }, RockPillar: { roughness: 0.93 },
      Lizard: { roughness: 0.5 }, NitroBottle: { roughness: 0.25, metalness: 0.6 }, MoneyBag: { roughness: 0.82, metalness: 0.15 },
    };
    for (const [n, params] of Object.entries(FINISH)) if (PT[n]) mergeParts(PT[n], /./, params, n + 'Merged');
    return PT;
  } catch (e) { console.warn('props model failed', e); return null; }
}
// meshes of a template object (a node may hold several primitives, one per material)
function meshesOf(o) {
  const out = [];
  o.updateMatrixWorld(true);
  o.traverse((m) => { if (m.isMesh) out.push(m); });
  return out;
}
function cloneProp(name) {
  const o = PT[name].clone(true);
  o.position.set(0, 0, 0);
  o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return o;
}
// instanced copies of a template prop at the given matrices
function instanced(name, matrices) {
  const g = new THREE.Group();
  if (!matrices.length) return g;
  const src = PT[name];
  for (const m of meshesOf(src)) {
    const geo = m.geometry.clone();
    geo.userData.shared = false; // per-track copy
    // bake the node transform relative to the prop root
    const rel = new THREE.Matrix4().copy(src.matrixWorld).invert().multiply(m.matrixWorld);
    geo.applyMatrix4(rel);
    const im = new THREE.InstancedMesh(geo, m.material, matrices.length);
    matrices.forEach((mm, k) => im.setMatrixAt(k, mm));
    im.castShadow = im.receiveShadow = true;
    g.add(im);
  }
  return g;
}

const M = {};
function mats() {
  if (M.ready) return M;
  M.ready = true;
  M.wood = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.85 });
  M.metal = new THREE.MeshStandardMaterial({ color: 0xb7bcc2, roughness: 0.35, metalness: 0.8 });
  M.dark = new THREE.MeshStandardMaterial({ color: 0x232427, roughness: 0.6, metalness: 0.3 });
  M.white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 });
  M.blueFlag = new THREE.MeshStandardMaterial({ color: 0x1f4fd8, roughness: 0.6, side: THREE.DoubleSide });
  M.rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  M.hay = new THREE.MeshStandardMaterial({ color: 0xc9a24d, roughness: 1 });
  M.skin = new THREE.MeshStandardMaterial({ color: 0xc58c64, roughness: 0.7 });
  M.shirt = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.7 });
  M.pants = new THREE.MeshStandardMaterial({ color: 0x1d2a44, roughness: 0.8 });
  for (const k in M) if (M[k] && M[k].isMaterial) M[k].userData.shared = true;
  return M;
}

function drumTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ecebe6'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#c4161c'; g.fillRect(0, 70, 256, 34);
  g.fillStyle = '#1b46b8'; g.fillRect(0, 150, 256, 34);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (const y of [30, 128, 226]) g.fillRect(0, y, 256, 5);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// a little flag person on top of the start tower
function flagman() {
  const m = mats();
  const g = new THREE.Group();
  const body = new THREE.Group();
  const add = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; body.add(o); return o; };
  add(new THREE.CylinderGeometry(0.13, 0.15, 0.85, 8), m.pants, -0.1, 0.43, 0);
  add(new THREE.CylinderGeometry(0.13, 0.15, 0.85, 8), m.pants, 0.1, 0.43, 0);
  add(new THREE.CylinderGeometry(0.22, 0.2, 0.7, 10), m.shirt, 0, 1.2, 0);
  add(new THREE.SphereGeometry(0.15, 12, 10), m.skin, 0, 1.72, 0);
  const cap = add(new THREE.SphereGeometry(0.155, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8231f }), 0, 1.76, 0);
  cap.scale.y = 0.6;
  // arm + flag on a pivot so it can wave
  const arm = new THREE.Group();
  arm.position.set(0.26, 1.48, 0);
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6), m.shirt);
  upper.position.y = 0.28;
  arm.add(upper);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 5), m.wood);
  stick.position.y = 1.05;
  arm.add(stick);
  const flagCanvas = document.createElement('canvas');
  flagCanvas.width = 64; flagCanvas.height = 48;
  const flagTex = new THREE.CanvasTexture(flagCanvas);
  flagTex.colorSpace = THREE.SRGBColorSpace;
  const flagGeo = new THREE.PlaneGeometry(0.95, 0.7, 6, 1);
  flagGeo.translate(0.475, 0, 0);
  const flagMat = new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.8 });
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.position.set(0, 1.3, 0);
  flag.castShadow = true;
  arm.add(flag);
  body.add(arm);
  g.add(body);
  const setFlag = (kind) => {
    const c = flagCanvas.getContext('2d');
    if (kind === 'checkered') {
      for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) { c.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; c.fillRect(x * 8, y * 8, 8, 8); }
    } else {
      c.fillStyle = { green: '#19b43c', white: '#f4f4f4', yellow: '#f2d21a', red: '#d8231f' }[kind] || '#19b43c';
      c.fillRect(0, 0, 64, 48);
    }
    flagTex.needsUpdate = true;
  };
  setFlag('green');
  g.userData = { arm, flag, flagGeo, setFlag, base: flagGeo.attributes.position.array.slice() };
  return g;
}

export function buildProps(track, def) {
  const m = mats();
  const group = new THREE.Group();
  group.name = 'props';
  const r = rng(track.seed);
  const p = track.path;

  // --- start tower with the flagman, just outside the barrier at the line
  {
    const sl = track.startLine;
    const nx = -sl.tz, nz = sl.tx; // right of the travel direction
    // put the tower on the side with more room (usually the outside)
    let best = null;
    for (const side of [1, -1]) {
      let d = sl.hw + 1.2;
      while (d < sl.hw + 10 && track.bsdfAt(sl.x + nx * side * d, sl.z + nz * side * d) < BARRIER_ISO + 0.9) d += 0.25;
      const x = sl.x + nx * side * (d + 1.1), z = sl.z + nz * side * (d + 1.1);
      const room = track.bsdfAt(x, z);
      // prefer the outside of the loop (towards the stands) when there is room for the tower
      const outside = Math.hypot(x, z) > Math.hypot(sl.x, sl.z);
      const score = (room > 2.2 ? 10 : 0) + (outside ? 5 : 0) + Math.min(room, 4);
      if (!best || score > best.score) best = { x, z, room, side, score };
    }
    let tower, fm, h;
    if (PT && PT.StartTower) {
      tower = new THREE.Group();
      const t = cloneProp('StartTower');
      tower.add(t);
      h = 2.63;
      fm = new THREE.Group();
      const body = cloneProp('Flagman');
      const arm = cloneProp('FlagArm');
      arm.position.copy(PT.FlagArm.position);
      const cloth = cloneProp('FlagCloth');
      cloth.position.copy(PT.FlagCloth.position);
      arm.attach(cloth);
      fm.add(body, arm);
      // the cloth gets its own material so the flag colour can change
      const clothMesh = meshesOf(cloth)[0];
      clothMesh.material = clothMesh.material.clone();
      clothMesh.material.userData.shared = false;
      clothMesh.material.side = THREE.DoubleSide;
      const base = clothMesh.geometry.attributes.position.array.slice();
      const colors = { green: 0x19b43c, white: 0xf4f4f4, yellow: 0xf2d21a, red: 0xd8231f };
      let checker = null;
      fm.userData = {
        arm, flagGeo: clothMesh.geometry, base, model: true,
        setFlag: (kind) => {
          const mat = clothMesh.material;
          if (kind === 'checkered') {
            if (!checker) {
              const c = document.createElement('canvas'); c.width = 64; c.height = 48;
              const g = c.getContext('2d');
              for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; g.fillRect(x * 8, y * 8, 8, 8); }
              checker = new THREE.CanvasTexture(c); checker.colorSpace = THREE.SRGBColorSpace;
            }
            mat.map = checker; mat.color.set(0xffffff);
          } else { mat.map = null; mat.color.set(colors[kind] || colors.green); }
          mat.needsUpdate = true;
        },
      };
      fm.userData.setFlag('green');
      fm.position.set(0, h, 0.45); // front half of the deck, next to the track
      // START / FINISH board under the deck
      const sc = document.createElement('canvas');
      sc.width = 512; sc.height = 144;
      const sg = sc.getContext('2d');
      sg.fillStyle = '#f4f2ec'; sg.fillRect(0, 0, 512, 144);
      for (let x = 0; x < 512; x += 24) for (let y = 0; y < 2; y++) { sg.fillStyle = ((x / 24) + y) % 2 ? '#111' : '#f4f2ec'; sg.fillRect(x, y * 12, 24, 12); sg.fillRect(x, 120 + y * 12, 24, 12); }
      sg.fillStyle = '#c81d18';
      sg.font = 'italic 900 64px "Arial Black", Impact, sans-serif';
      sg.textAlign = 'center'; sg.textBaseline = 'middle';
      sg.fillText('START · FINISH', 256, 74);
      const stex = new THREE.CanvasTexture(sc); stex.colorSpace = THREE.SRGBColorSpace; stex.anisotropy = 4;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.96, 0.55), new THREE.MeshStandardMaterial({ map: stex, roughness: 0.5 }));
      board.position.set(0, h - 0.45, 1.04);
      tower.add(board);
      tower.add(fm);
    } else {
      tower = new THREE.Group();
      h = 2.6;
      const plat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 2.2), m.wood);
      plat.position.y = h;
      tower.add(plat);
      fm = flagman();
      fm.position.set(0, h + 0.09, 0);
      tower.add(fm);
    }
    const gy = track.heightAt(best.x, best.z);
    tower.position.set(best.x, gy - 0.05, best.z);
    // the tower's sign side (-Z in the model, +Y in Blender... -Y) faces the track; the flagman faces the trucks
    const toTrack = Math.atan2(sl.x - best.x, sl.z - best.z);
    tower.rotation.y = toTrack;
    tower.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(tower);
    group.userData.flagman = fm;
    // face the oncoming trucks: look back along the track from the line
    fm.updateMatrixWorld(true);
    const look = new THREE.Vector3(sl.x - sl.tx * 25, gy + h, sl.z - sl.tz * 25);
    const local = fm.parent.worldToLocal(look.clone());
    fm.rotation.y = Math.atan2(-(local.z - fm.position.z), local.x - fm.position.x);
  }

  // --- blue flags on the inside of sharp corners
  {
    const flagGeo = new THREE.PlaneGeometry(0.8, 0.55);
    flagGeo.translate(0.4, 0, 0);
    const poleGeo = new THREE.CylinderGeometry(0.035, 0.035, 2.4, 5);
    let last = -100;
    for (let i = 0; i < p.n; i += 2) {
      const c = p.curv[i];
      if (Math.abs(c) < 0.09 || i * p.ds - last < 18) continue;
      // apex of the corner: local max of curvature
      let mx = true;
      for (let k = -6; k <= 6; k++) if (Math.abs(p.curv[(i + k + p.n) % p.n]) > Math.abs(c) + 1e-4) { mx = false; break; }
      if (!mx) continue;
      last = i * p.ds;
      const side = c > 0 ? 1 : -1; // inside of the turn
      const nx = -p.tz[i] * side, nz = p.tx[i] * side;
      let d = p.hw[i];
      while (d < p.hw[i] + 6 && track.bsdfAt(p.x[i] + nx * d, p.z[i] + nz * d) < BARRIER_ISO) d += 0.2;
      const x = p.x[i] + nx * (d + 0.5), z = p.z[i] + nz * (d + 0.5);
      if (track.bsdfAt(x, z) < BARRIER_ISO + 0.2) continue;
      const gy = track.heightAt(x, z);
      const pole = new THREE.Mesh(poleGeo, m.white);
      pole.position.set(x, gy + 1.2, z);
      pole.castShadow = true;
      const flag = new THREE.Mesh(flagGeo, m.blueFlag);
      flag.position.set(x, gy + 2.1, z);
      flag.rotation.y = Math.atan2(p.tz[i], p.tx[i]) + r() * 0.6;
      flag.castShadow = true;
      group.add(pole, flag);
    }
  }

  // --- giant oil drums (Cliffhanger)
  if (track.props.length && PT && PT.Drum) {
    for (const pr of track.props) {
      if (pr.kind === 'rock' && PT.RockPillar) {
        const rk = cloneProp('RockPillar');
        const hs = 0.8 + r() * 0.6;
        rk.scale.set(pr.r * 0.92, pr.r * hs, pr.r * 0.92);
        rk.position.set(pr.x, track.heightAt(pr.x, pr.z) - 0.25, pr.z);
        rk.rotation.y = r() * 6.28;
        group.add(rk);
        continue;
      }
      const d = cloneProp('Drum');
      d.scale.set(pr.r, 2.1, pr.r);
      d.position.set(pr.x, track.heightAt(pr.x, pr.z) - 0.1, pr.z);
      d.rotation.y = r() * 6.28;
      group.add(d);
    }
  } else if (track.props.length) {
    const tex = drumTexture();
    const drumMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.35 });
    const topMat = new THREE.MeshStandardMaterial({ color: 0x9b9ea3, roughness: 0.5, metalness: 0.6 });
    for (const pr of track.props) {
      const h = 4.2;
      const d = new THREE.Mesh(new THREE.CylinderGeometry(pr.r, pr.r, h, 32, 1, true), drumMat);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(pr.r * 0.98, pr.r * 0.98, 0.1, 32), topMat);
      const gy = track.heightAt(pr.x, pr.z);
      d.position.set(pr.x, gy + h / 2 - 0.1, pr.z);
      top.position.set(pr.x, gy + h - 0.12, pr.z);
      for (const rimY of [0.05, h * 0.5, h - 0.15]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(pr.r + 0.02, 0.06, 6, 32), topMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(pr.x, gy + rimY - 0.1, pr.z);
        group.add(ring);
      }
      d.castShadow = d.receiveShadow = true;
      top.castShadow = true;
      group.add(d, top);
    }
  }

  // --- numbered posts painted on their islands (Pig Bog)
  for (const is of def.islands || []) {
    if (!is.num || !is.poly) continue;
    let cx = 0, cz = 0;
    for (const [x, z] of is.poly) { cx += x; cz += z; }
    cx /= is.poly.length; cz /= is.poly.length;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#f2f0ea'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill();
    g.fillStyle = '#c81d18'; g.font = 'italic 900 96px "Arial Black", Impact, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(is.num), 64, 70);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(cx, track.heightAt(cx, cz) + 0.08, cz);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (def.volcano) {
    const v = def.volcano;
    // lava pool on the crater floor (the bowl is flat inside half the rim radius)
    const lava = new THREE.Mesh(new THREE.CircleGeometry(v.r * (v.rim ?? 0.2) * 0.58, 40), new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec2 p = vUv * 6.0;
          float k = n(p + vec2(uTime * 0.3, uTime * 0.17)) * 0.6 + n(p * 2.3 - uTime * 0.4) * 0.4;
          vec3 c = mix(vec3(1.6, 0.25, 0.03), vec3(3.2, 1.6, 0.25), smoothstep(0.45, 0.85, k));
          c = mix(vec3(0.12, 0.04, 0.02), c, smoothstep(0.25, 0.45, k));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
    lava.rotation.x = -Math.PI / 2;
    lava.position.set(v.x, track.heightAt(v.x, v.z) + 0.15, v.z);
    group.add(lava);
    const glow = new THREE.PointLight(0xff5a1a, 0, 60, 2);
    glow.position.set(v.x, track.heightAt(v.x, v.z) + 6.5, v.z);
    group.add(glow);
    group.userData.volcano = { lava, glow, x: v.x, z: v.z, y: track.heightAt(v.x, v.z) };
  }

  // --- decor: bunting over jumps, hay bales, tyre stacks
  for (const dc of def.decor || []) {
    if (dc.t === 'bunting') {
      const [ax, az] = dc.a, [bx, bz] = dc.b;
      const ha = track.heightAt(ax, az), hb = track.heightAt(bx, bz);
      for (const [x, z, h] of [[ax, az, ha], [bx, bz, hb]]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.6, 6), m.white);
        pole.position.set(x, h + 2.3, z);
        pole.castShadow = true;
        group.add(pole);
      }
      const n = 14;
      const cols = [0xd8231f, 0xf4f4f4, 0x1f4fd8, 0xf2c014];
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.22, 0, 0, 0.22, 0, 0, 0, -0.5, 0], 3));
      tri.computeVertexNormals();
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const sag = Math.sin(t * Math.PI) * 0.6;
        const y = ha + (hb - ha) * t + 4.4 - sag;
        const f = new THREE.Mesh(tri, new THREE.MeshStandardMaterial({ color: cols[i % 4], side: THREE.DoubleSide, roughness: 0.7 }));
        f.position.set(x, y, z);
        f.rotation.y = Math.atan2(-(bz - az), bx - ax);
        f.castShadow = true;
        group.add(f);
      }
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, Math.hypot(bx - ax, bz - az), 4), m.dark);
      rope.position.set((ax + bx) / 2, (ha + hb) / 2 + 4.4 - 0.5, (az + bz) / 2);
      rope.rotation.z = Math.PI / 2;
      rope.rotation.y = Math.atan2(-(bz - az), bx - ax);
      group.add(rope);
    } else if (dc.t === 'lizard') {
      // giant lizard statues in the infield (Leapin' Lizards); rot as in the sim (+x towards +z)
      if (!PT || !PT.Lizard) continue;
      const lz = cloneProp('Lizard');
      const sc = dc.s ?? 3;
      lz.scale.set(sc, sc, dc.flip ? -sc : sc);
      lz.position.set(dc.x, track.heightAt(dc.x, dc.z) - 0.04 * sc, dc.z);
      lz.rotation.y = -(dc.rot || 0);
      group.add(lz);
    } else if (dc.t === 'bales') {
      for (const [x, z] of dc.pts) {
        for (let k = 0; k < 3; k++) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.55), m.hay);
          const gy = track.heightAt(x, z);
          b.position.set(x + (k - 1) * 1.25, gy + 0.25, z);
          b.rotation.y = (r() - 0.5) * 0.2;
          b.castShadow = b.receiveShadow = true;
          group.add(b);
        }
      }
    }
  }

  // tyre walls behind the barrier on the outside of the sharp corners, hay bales
  // along the inside of the long straights (never on the racing surface)
  {
    const tyreGeo = new THREE.TorusGeometry(0.42, 0.17, 8, 16);
    tyreGeo.rotateX(Math.PI / 2);
    const tyreInst = [], baleInst = [];
    const free = (x, z, need) => track.bsdfAt(x, z) > need && track.waterAt(x, z) <= 0 && Math.abs(x) < 62 && Math.abs(z) < 37;
    let last = -100;
    for (let i = 0; i < p.n; i += 2) {
      const c = p.curv[i];
      if (Math.abs(c) < 0.08 || i * p.ds - last < 16) continue;
      let mx = true;
      for (let k = -6; k <= 6; k++) if (Math.abs(p.curv[(i + k + p.n) % p.n]) > Math.abs(c) + 1e-4) { mx = false; break; }
      if (!mx) continue;
      last = i * p.ds;
      const side = c > 0 ? -1 : 1; // outside of the turn
      const nx = -p.tz[i] * side, nz = p.tx[i] * side;
      let d = p.hw[i];
      while (d < p.hw[i] + 8 && track.bsdfAt(p.x[i] + nx * d, p.z[i] + nz * d) < BARRIER_ISO + 0.5) d += 0.2;
      // a short wall following the barrier
      for (let k = -3; k <= 3; k++) {
        const j = (i + k * 3 + p.n) % p.n;
        const jnx = -p.tz[j] * side, jnz = p.tx[j] * side;
        let dd = p.hw[j];
        while (dd < p.hw[j] + 8 && track.bsdfAt(p.x[j] + jnx * dd, p.z[j] + jnz * dd) < BARRIER_ISO + 0.5) dd += 0.2;
        const x = p.x[j] + jnx * (dd + 0.6), z = p.z[j] + jnz * (dd + 0.6);
        if (!free(x, z, 1.4)) continue;
        tyreInst.push([x, z, 2 + (Math.abs(k) < 2 ? 1 : 0)]);
      }
    }
    // hay bales: on the infield side of long straights
    last = -100;
    for (let i = 0; i < p.n; i += 4) {
      let straight = true;
      for (let k = -16; k <= 16; k += 4) if (Math.abs(p.curv[(i + k + p.n) % p.n]) > 0.01) { straight = false; break; }
      if (!straight || i * p.ds - last < 30) continue;
      for (const side of [1, -1]) {
        const nx = -p.tz[i] * side, nz = p.tx[i] * side;
        let d = p.hw[i];
        while (d < p.hw[i] + 6 && track.bsdfAt(p.x[i] + nx * d, p.z[i] + nz * d) < BARRIER_ISO + 0.5) d += 0.2;
        const x = p.x[i] + nx * (d + 1.4), z = p.z[i] + nz * (d + 1.4);
        if (!free(x, z, 2.2) || !free(x + p.tx[i] * 2, z + p.tz[i] * 2, 2.2) || !free(x - p.tx[i] * 2, z - p.tz[i] * 2, 2.2)) continue;
        last = i * p.ds;
        for (let k = -1; k <= 1; k++) baleInst.push([x + p.tx[i] * k * 1.25, z + p.tz[i] * k * 1.25, Math.atan2(p.tz[i], p.tx[i]), r()]);
        break;
      }
    }
    const tyreCount = tyreInst.reduce((a, t) => a + t[2], 0);
    if (PT && PT.Tyre && PT.HayBale) {
      const mats = [];
      const mm = new THREE.Matrix4();
      for (const [x, z, h] of tyreInst) {
        const gy = track.heightAt(x, z);
        for (let k = 0; k < h; k++) mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x + (r() - 0.5) * 0.08, gy + 0.2 + k * 0.38, z + (r() - 0.5) * 0.08), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6), new THREE.Vector3(1, 1, 1)));
      }
      group.add(instanced('Tyre', mats));
      const bm = baleInst.map(([x, z, a, rr]) => new THREE.Matrix4().compose(new THREE.Vector3(x, track.heightAt(x, z) - 0.02, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + (rr - 0.5) * 0.15), new THREE.Vector3(1, 1, 1)));
      group.add(instanced('HayBale', bm));
    } else if (tyreCount) {
      const im = new THREE.InstancedMesh(tyreGeo, m.rubber, tyreCount);
      const mm = new THREE.Matrix4();
      let n = 0;
      for (const [x, z, h] of tyreInst) {
        const gy = track.heightAt(x, z);
        for (let k = 0; k < h; k++) { mm.makeTranslation(x + (r() - 0.5) * 0.08, gy + 0.17 + k * 0.32, z + (r() - 0.5) * 0.08); im.setMatrixAt(n++, mm); }
      }
      im.castShadow = im.receiveShadow = true;
      group.add(im);
    }
    if (baleInst.length && !(PT && PT.HayBale)) {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.5, 0.55), m.hay, baleInst.length);
      const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
      baleInst.forEach(([x, z, a, rr], k) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + (rr - 0.5) * 0.15);
        pos.set(x, track.heightAt(x, z) + 0.25, z);
        mm.compose(pos, q, sc);
        im.setMatrixAt(k, mm);
      });
      im.castShadow = im.receiveShadow = true;
      group.add(im);
    }
  }

  group.userData.update = (dt, race) => {
    const vol = group.userData.volcano;
    if (vol) {
      vol.lava.material.uniforms.uTime.value += dt;
      vol.glow.intensity = (group.userData.night ? 900 : 250) * (0.85 + 0.15 * Math.sin(vol.lava.material.uniforms.uTime.value * 3.1));
    }
    const fm = group.userData.flagman;
    if (!fm) return;
    const u = fm.userData;
    const t = (group.userData.t = (group.userData.t || 0) + dt);
    // waving
    let wave = 0;
    if (race) {
      if (race.state === 'countdown') {
        u.setFlag(race.time > -1.2 ? 'green' : 'yellow');
        wave = race.time > -0.25 ? Math.sin(t * 12) * 0.9 : 0.15 * Math.sin(t * 2);
        u.arm.rotation.z = race.time > -1.2 ? 2.6 : 1.2;
      } else {
        const lead = race.order[0];
        let kind = 'green';
        if (race.finishOrder.length) kind = 'checkered';
        else if (lead && lead.lap === race.laps - 1) kind = 'white';
        if (u.kind !== kind) { u.setFlag(kind); u.kind = kind; }
        u.arm.rotation.z = 2.3 + Math.sin(t * (kind === 'checkered' ? 9 : 3)) * (kind === 'checkered' ? 0.7 : 0.25);
        wave = Math.sin(t * 9) * 0.6;
      }
    }
    if (u.model) {
      // the Blender arm points up; raise/lower and wave it sideways
      const raise = u.arm.rotation.z;
      u.arm.rotation.set(-wave * 0.45 - (raise > 2 ? 0 : 0.9), 0, 0);
      const pos = u.flagGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const along = u.base[i * 3 + 2]; // 0..0.9 away from the stick
        pos.setX(i, u.base[i * 3] + Math.sin(t * 11 + along * 8) * 0.09 * (along / 0.9));
      }
      pos.needsUpdate = true;
      return;
    }
    u.arm.rotation.x = wave * 0.3;
    // flag cloth ripple
    const pos = u.flagGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = u.base[i * 3];
      pos.setZ(i, Math.sin(t * 10 + x * 7) * 0.08 * (x / 0.95));
    }
    pos.needsUpdate = true;
  };
  return group;
}

// ------------------------------------------------------------------ pickups
function nitroBottle() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.25, 20), new THREE.MeshPhysicalMaterial({ color: 0x1b4fd6, roughness: 0.25, metalness: 0.4, clearcoat: 1 }));
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.3, 0.3, 16), new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.2, metalness: 1 }));
  neck.position.y = 0.77;
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.22, 10), new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.2, metalness: 1 }));
  valve.position.y = 1.0;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.28, 20), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
  band.position.y = 0.1;
  g.add(body, neck, valve, band);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function moneyBag() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 0.85 });
  const sack = new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 14), mat);
  sack.scale.set(1, 0.9, 1);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 0.32, 12), mat);
  neck.position.y = 0.62;
  const tie = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.04, 6, 14), new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.4, metalness: 0.6 }));
  tie.rotation.x = Math.PI / 2;
  tie.position.y = 0.66;
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.3, 10), mat);
  top.position.y = 0.88;
  top.rotation.x = Math.PI;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#f2d24a'; x.font = '900 100px Arial Black, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('$', 64, 70);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.75), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5 }));
  sign.position.set(0, 0.02, 0.6);
  const sign2 = sign.clone(); sign2.position.z = -0.6; sign2.rotation.y = Math.PI;
  g.add(sack, neck, tie, top, sign, sign2);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

let _dollar = null;
let _dollarGeo = null;
function dollarSigns() {
  if (!_dollar) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#f2d24a'; x.font = '900 100px Arial Black, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('$', 64, 70);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    _dollar = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1 });
    _dollar.userData.shared = true;
    _dollarGeo = new THREE.PlaneGeometry(0.62, 0.62);
    _dollarGeo.userData.shared = true;
  }
  const g = new THREE.Group();
  for (const sgn of [1, -1]) {
    const s = new THREE.Mesh(_dollarGeo, _dollar);
    s.position.set(0, 0.5, 0.56 * sgn);
    if (sgn < 0) s.rotation.y = Math.PI;
    g.add(s);
  }
  return g;
}

export class PickupViews {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.ringGeo = new THREE.RingGeometry(0.9, 1.5, 32);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.ringGeo.userData.shared = true;
  }
  // remove a pickup and free what was made for it (template and shared resources stay)
  _drop(v) {
    this.scene.remove(v.g);
    v.g.traverse((o) => {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      if (o.material) for (const m of [].concat(o.material)) if (!m.userData.shared) m.dispose();
    });
  }
  clear() { for (const v of this.items.values()) this._drop(v); this.items.clear(); }
  update(dt, race, track) {
    const live = new Set();
    for (const pk of race.pickups) {
      live.add(pk.id);
      let v = this.items.get(pk.id);
      if (!v) {
        const g = new THREE.Group();
        const model = PT && PT.NitroBottle ? cloneProp(pk.type === 'nitro' ? 'NitroBottle' : 'MoneyBag') : (pk.type === 'nitro' ? nitroBottle() : moneyBag());
        if (PT && PT.MoneyBag && pk.type === 'money') model.add(dollarSigns());
        g.add(model);
        const ring = new THREE.Mesh(this.ringGeo, this.glowMat.clone());
        ring.material.color.set(pk.type === 'nitro' ? 0x3a8cff : 0xffc62e);
        g.add(ring);
        g.position.set(pk.x, pk.y, pk.z);
        this.scene.add(g);
        v = { g, model, ring, t: 0 };
        this.items.set(pk.id, v);
      }
      v.t += dt;
      const appear = clamp(v.t * 3, 0, 1);
      const leave = clamp((pk.life - pk.age) * 2, 0, 1);
      const s = appear * leave;
      v.model.scale.setScalar(s * (pk.type === 'nitro' ? 1 : 0.9));
      v.model.position.y = (PT ? 0.45 : 0.9) + Math.sin(v.t * 3) * 0.18;
      v.model.rotation.y = v.t * 2.2;
      if (pk.type === 'nitro') v.model.rotation.z = 0.35;
      v.ring.material.opacity = (0.35 + 0.25 * Math.sin(v.t * 6)) * s;
      v.ring.scale.setScalar(1 + 0.15 * Math.sin(v.t * 4));
      v.ring.position.y = 0.06;
      // blink before vanishing
      v.g.visible = pk.life - pk.age > 2.5 || Math.sin(v.t * 25) > -0.3;
    }
    for (const [id, v] of this.items) {
      if (!live.has(id)) { this._drop(v); this.items.delete(id); }
    }
  }
}
