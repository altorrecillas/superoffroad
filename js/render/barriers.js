// Red/white track barriers: swept K-rail profile along the iso-contours of the
// barrier field. One mesh per track, stripes and grime done in the shader.

import * as THREE from 'three';
import { BARRIER_ISO } from '../sim/track.js';
import { isoContours, smoothLine, resampleLine } from '../sim/contour.js';

// cross-section (lateral offset, height); symmetric jersey-barrier shape
const PROFILE = [
  [-0.42, -0.3], [-0.42, 0.08], [-0.39, 0.2], [-0.30, 0.36], [-0.25, 0.86], [-0.22, 0.98], [-0.14, 1.05], [-0.05, 1.07],
  [0.05, 1.07], [0.14, 1.05], [0.22, 0.98], [0.25, 0.86], [0.30, 0.36], [0.39, 0.2], [0.42, 0.08], [0.42, -0.3],
];
export const STRIPE = 1.9;

export function buildBarriers(track, opts = {}) {
  const raw = isoContours(track.bsdf, track.nx, track.nz, BARRIER_ISO, track.x0, track.z0, track.cell);
  const positions = [], normals = [], uvs = [], indices = [];
  const lines = [];
  let vbase = 0;
  // profile normals in (offset, height) space
  const PN = PROFILE.map((p, k) => {
    const a = PROFILE[Math.max(0, k - 1)], b = PROFILE[Math.min(PROFILE.length - 1, k + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    // outward normal: rotate the tangent; the profile runs left->over the top->right
    return [-ty, tx];
  });
  for (const r of raw) {
    if (r.length < 6) continue;
    const sm = smoothLine(r, 3, 0.5);
    const line = resampleLine(sm, 0.42);
    // align stripe phase so closed loops wrap seamlessly
    const L = line.length2;
    const stripeLen = line.closed ? L / Math.max(2, Math.round(L / (STRIPE * 2))) / 2 : STRIPE;
    const n = line.length;
    const ring = PROFILE.length;
    for (let i = 0; i < n; i++) {
      const p = line[i];
      const a = line[line.closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
      const b = line[line.closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const nx = -tz, nz = tx;
      // base height: lowest ground under the footprint so the barrier never floats
      const h0 = Math.min(
        track.heightAt(p[0], p[1]),
        track.heightAt(p[0] + nx * 0.42, p[1] + nz * 0.42),
        track.heightAt(p[0] - nx * 0.42, p[1] - nz * 0.42),
      );
      const u = p[2] / (stripeLen * 2);
      for (let k = 0; k < ring; k++) {
        const [o, h] = PROFILE[k];
        positions.push(p[0] + nx * o, h0 + h, p[1] + nz * o);
        uvs.push(u, k / (ring - 1));
        const [po, ph] = PN[k];
        normals.push(nx * po, ph, nz * po);
      }
    }
    const segs = line.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const i2 = (i + 1) % n;
      for (let k = 0; k < ring - 1; k++) {
        const a = vbase + i * ring + k, b = vbase + i2 * ring + k;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    // end caps for open lines
    if (!line.closed) {
      for (const i of [0, n - 1]) {
        const c = vbase + i * ring;
        for (let k = 1; k < ring - 2; k++) {
          indices.push(c, c + k + 1, c + k, c, c + k, c + k + 1);
        }
      }
    }
    vbase += n * ring;
    lines.push(line);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.0 });
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        float bHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float bNoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(bHash(i),bHash(i+vec2(1,0)),f.x),mix(bHash(i+vec2(0,1)),bHash(i+vec2(1,1)),f.x),f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float u = vBUv.x; float v = vBUv.y;
          float seg = floor(u);
          float red = mod(seg, 2.0);
          vec3 cRed = vec3(0.70, 0.03, 0.025);
          vec3 cWhite = vec3(0.92, 0.91, 0.88);
          vec3 c = mix(cWhite, cRed, red);
          // joints between blocks
          float fu = fract(u);
          float joint = smoothstep(0.0, 0.012, fu) * smoothstep(1.0, 0.988, fu);
          c *= mix(0.35, 1.0, joint);
          // grime: dirt splashed on the lower half, scuffs
          float hgt = 1.0 - abs(v - 0.5) * 2.0;      // 1 at the top
          float n1 = bNoise(vec2(u * 7.0, v * 9.0)) * 0.6 + bNoise(vec2(u * 23.0, v * 31.0)) * 0.4;
          float lowV = min(v, 1.0 - v);               // 0 at the feet of both faces
          float dirt = smoothstep(0.30, 0.04, lowV + n1 * 0.12);
          c = mix(c, vec3(0.32, 0.17, 0.09), dirt * 0.8);
          float scuff = smoothstep(0.75, 0.95, bNoise(vec2(u * 3.1, v * 2.0 + seg)));
          c = mix(c, c * 0.7, scuff * 0.5);
          diffuseColor.rgb = c;
          vBDirt = dirt;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.42, 0.95, vBDirt);`);
    sh.fragmentShader = 'varying vec2 vBUv;\nfloat vBDirt;\n' + sh.fragmentShader;
    sh.vertexShader = 'varying vec2 vBUv;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvBUv = uv;');
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'barriers';
  mesh.userData.lines = lines;
  return mesh;
}
