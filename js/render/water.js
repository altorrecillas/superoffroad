// Muddy puddles: animated ripples, reflections, shoreline foam and
// expanding rings where trucks splash through.

import * as THREE from 'three';
import { ellipsePoly } from '../sim/util.js';

export function buildWater(track) {
  const group = new THREE.Group();
  group.name = 'water';
  if (!track.waterBodies.length) return group;
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2a2116, roughness: 0.16, metalness: 0.0, transparent: true, opacity: 0.9, depthWrite: false, envMapIntensity: 0.28,
  });
  const uniforms = {
    uLake: { value: 0 },
    uTime: { value: 0 },
    tField: { value: null },
    uGrid: { value: new THREE.Vector4(track.x0, track.z0, 1 / track.cell, 0) },
    uGridN: { value: new THREE.Vector2(track.nx, track.nz) },
    uRings: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -10, 0)) },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = `uniform float uLake; uniform float uTime; uniform sampler2D tField; uniform vec4 uGrid; uniform vec2 uGridN; uniform vec4 uRings[8];
      varying vec3 vWPos;
      float wh(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      float wn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(wh(i), wh(i+vec2(1,0)), f.x), mix(wh(i+vec2(0,1)), wh(i+vec2(1,1)), f.x), f.y); }
      float wf(vec2 p){ return wn(p) * 0.5 + wn(p * 2.1 + 7.0) * 0.3 + wn(p * 4.3 + 3.0) * 0.2; }
      ` + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 guv = ((vWPos.xz - uGrid.xy) * uGrid.z + 0.5) / uGridN;
        float depth = texture2D(tField, guv).a;
        float shore = smoothstep(0.0, 0.14, depth);
        diffuseColor.rgb = mix(vec3(0.20, 0.14, 0.08), vec3(0.055, 0.05, 0.035), smoothstep(0.03, 0.4, depth));
        // big lakes: clearer, greener water
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.16, 0.2, 0.16), vec3(0.03, 0.08, 0.1), smoothstep(0.05, 0.8, depth)), uLake);
        float foam = (1.0 - smoothstep(0.0, 0.07, depth)) * (0.6 + 0.4 * wn(vWPos.xz * 3.0 + uTime));
        // rings from splashes
        float ring = 0.0;
        for (int i = 0; i < 8; i++) {
          vec4 r = uRings[i];
          float age = uTime - r.z;
          if (age < 0.0 || age > 2.5) continue;
          float d = length(vWPos.xz - r.xy);
          float rad = age * (2.2 + r.w * 2.0);
          ring += exp(-pow((d - rad) * 3.0, 2.0)) * (1.0 - age / 2.5) * r.w;
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.36, 0.28), clamp(foam * 0.35 + ring * 0.3, 0.0, 0.7));
        diffuseColor.a *= shore * 0.9 + 0.1;
        vRing = ring;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 p = vWPos.xz * 1.6;
          float t = uTime * 0.6;
          float e = 0.05;
          float h0 = wf(p + vec2(t, t * 0.7));
          float hx = wf(p + vec2(e, 0.0) + vec2(t, t * 0.7));
          float hz = wf(p + vec2(0.0, e) + vec2(t, t * 0.7));
          vec3 wn3 = normalize(vec3(-(hx - h0) / e * 0.08 - vRing * 0.2, 1.0, -(hz - h0) / e * 0.08));
          normal = normalize((viewMatrix * vec4(wn3, 0.0)).xyz);
        }`)
      .replace('void main() {', 'float vRing = 0.0;\nvoid main() {');
  };
  const lakeMat = mat.clone();
  const lakeUniforms = { ...uniforms, uLake: { value: 1 } };
  lakeMat.envMapIntensity = 0.55;
  lakeMat.roughness = 0.08;
  lakeMat.onBeforeCompile = (sh) => { mat.onBeforeCompile(sh); Object.assign(sh.uniforms, lakeUniforms); };
  lakeMat.customProgramCacheKey = () => 'lake';
  for (const wb of track.waterBodies) {
    // grow the outline so the water meets the banks; the terrain hides the excess
    let cx = 0, cz = 0;
    for (const [x, z] of wb.poly) { cx += x; cz += z; }
    cx /= wb.poly.length; cz /= wb.poly.length;
    const shape = new THREE.Shape();
    wb.poly.forEach(([x, z], i) => {
      const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1;
      const px = x + (dx / l) * 1.6, pz = z + (dz / l) * 1.6;
      if (i === 0) shape.moveTo(px, -pz); else shape.lineTo(px, -pz);
    });
    const g = new THREE.ShapeGeometry(shape, 8);
    g.rotateX(-Math.PI / 2);
    // polygon area decides lake or puddle
    let area = 0;
    for (let i = 0; i < wb.poly.length; i++) { const a = wb.poly[i], b = wb.poly[(i + 1) % wb.poly.length]; area += a[0] * b[1] - b[0] * a[1]; }
    const isLake = Math.abs(area) / 2 > 160;
    const m = new THREE.Mesh(g, isLake ? lakeMat : mat);
    m.position.y = wb.level;
    m.renderOrder = 2;
    m.receiveShadow = true;
    group.add(m);
  }
  group.userData = { uniforms, mat, ringIdx: 0 };
  group.userData.update = (dt, fieldTex) => {
    uniforms.uTime.value += dt;
    uniforms.tField.value = fieldTex;
  };
  group.userData.ring = (x, z, power) => {
    const u = group.userData;
    uniforms.uRings.value[u.ringIdx].set(x, z, uniforms.uTime.value, power);
    u.ringIdx = (u.ringIdx + 1) % 8;
  };
  return group;
}
