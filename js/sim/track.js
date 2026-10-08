// Track builder: turns a track definition (corners, areas, islands, terrain shapes,
// water) into the grids used by physics, AI and rendering.
// Pure JS: runs in the browser and in Node (tools/test).

import {
  clamp, lerp, smoothstep, smootherstep, rng, makeNoise2D, hashString,
  segDist, polySDF, polyBounds, ellipsePoly, wrapAngle,
} from './util.js';

// Stadium floor covered by the grids (metres). +x right, +z towards the camera.
export const ARENA = { x0: -66, z0: -41, x1: 66, z1: 41, cell: 0.25 };
export const WALL_FACE = 0.2;   // sdf value where a barrier face starts
export const BARRIER_ISO = 0.62; // sdf value of the barrier centre line
const PATH_DS = 0.5;            // centre line sampling step
const SPLAT_MARGIN = 9;         // how far outside a corridor the grids are filled

// ---------------------------------------------------------------- path

function filletPolyline(corners) {
  const n = corners.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const A = corners[(i - 1 + n) % n], P = corners[i], B = corners[(i + 1) % n];
    let d1x = P[0] - A[0], d1z = P[1] - A[1];
    let d2x = B[0] - P[0], d2z = B[1] - P[1];
    const l1 = Math.hypot(d1x, d1z), l2 = Math.hypot(d2x, d2z);
    d1x /= l1; d1z /= l1; d2x /= l2; d2z /= l2;
    const dot = clamp(d1x * d2x + d1z * d2z, -1, 1);
    const phi = Math.acos(dot);
    const r = P[2] ?? 6;
    if (phi < 1e-3 || r <= 0.01) { pts.push([P[0], P[1], i]); continue; }
    let t = r * Math.tan(phi / 2);
    const tmax = 0.5 * Math.min(l1, l2) - 0.01;
    if (t > tmax) t = tmax;
    const re = t / Math.tan(phi / 2);
    const cross = d1x * d2z - d1z * d2x;
    const sx = P[0] - d1x * t, sz = P[1] - d1z * t;
    const nx = cross > 0 ? -d1z : d1z, nz = cross > 0 ? d1x : -d1x;
    const cx = sx + nx * re, cz = sz + nz * re;
    const a0 = Math.atan2(sz - cz, sx - cx);
    const steps = Math.max(2, Math.ceil((phi * re) / 0.25));
    const dir = cross > 0 ? 1 : -1;
    for (let k = 0; k <= steps; k++) {
      const a = a0 + dir * phi * (k / steps);
      pts.push([cx + Math.cos(a) * re, cz + Math.sin(a) * re, i]);
    }
  }
  return pts;
}

export function buildPath(def, reverse) {
  let corners = def.path.map((c) => c.slice());
  // per-corner widths (4th value) default to the track width
  for (const c of corners) if (c[3] == null) c[3] = def.width ?? 9;
  if (reverse) corners = corners.reverse();
  const poly = filletPolyline(corners);
  // cumulative length of the raw polyline
  const m = poly.length;
  const cum = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    const a = poly[i], b = poly[(i + 1) % m];
    cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const L = cum[m];
  const n = Math.round(L / PATH_DS);
  const ds = L / n;
  const x = new Float32Array(n), z = new Float32Array(n), hw = new Float32Array(n);
  // width: interpolate corner widths by the polyline position of each corner
  const cornerS = new Float64Array(corners.length).fill(-1);
  for (let i = 0; i < m; i++) {
    const ci = poly[i][2];
    if (cornerS[ci] < 0) cornerS[ci] = cum[i];
  }
  // centre each corner's s in the middle of its arc
  const cornerEnd = new Float64Array(corners.length);
  for (let i = 0; i < m; i++) cornerEnd[poly[i][2]] = cum[i];
  const cs = [];
  for (let i = 0; i < corners.length; i++) cs.push([(cornerS[i] + cornerEnd[i]) / 2, corners[i][3]]);
  cs.sort((a, b) => a[0] - b[0]);
  function widthAt(s) {
    const k = cs.length;
    for (let i = 0; i < k; i++) {
      const a = cs[i], b = cs[(i + 1) % k];
      const sa = a[0], sb = i + 1 < k ? b[0] : b[0] + L;
      let ss = s;
      if (ss < sa) ss += L;
      if (ss >= sa && ss <= sb) {
        const t = (ss - sa) / Math.max(1e-6, sb - sa);
        // hold the width around corners, blend on the straights
        return lerp(a[1], b[1], smootherstep(0.15, 0.85, t));
      }
    }
    return cs[0][1];
  }
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = i * ds;
    while (cum[j + 1] < s && j < m - 1) j++;
    const a = poly[j], b = poly[(j + 1) % m];
    const seg = cum[j + 1] - cum[j];
    const t = seg > 0 ? (s - cum[j]) / seg : 0;
    x[i] = lerp(a[0], b[0], t);
    z[i] = lerp(a[1], b[1], t);
    hw[i] = widthAt(s) / 2;
  }
  return finishPath({ n, x, z, hw, L, ds });
}

function finishPath(p) {
  const { n, x, z } = p;
  const tx = new Float32Array(n), tz = new Float32Array(n), curv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    let dx = x[b] - x[a], dz = z[b] - z[a];
    const l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l; tz[i] = dz / l;
  }
  for (let i = 0; i < n; i++) {
    const a = (i - 2 + n) % n, b = (i + 2) % n;
    const h0 = Math.atan2(tz[a], tx[a]), h1 = Math.atan2(tz[b], tx[b]);
    curv[i] = wrapAngle(h1 - h0) / (4 * p.ds);
  }
  p.tx = tx; p.tz = tz; p.curv = curv;
  return p;
}

// rotate path arrays so index 0 is the sample closest to (sx, sz)
function rotatePath(p, sx, sz) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < p.n; i++) {
    const d = (p.x[i] - sx) ** 2 + (p.z[i] - sz) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  if (best === 0) return p;
  for (const k of ['x', 'z', 'hw', 'tx', 'tz', 'curv']) {
    const a = p[k], b = new Float32Array(p.n);
    for (let i = 0; i < p.n; i++) b[i] = a[(i + best) % p.n];
    p[k] = b;
  }
  return p;
}

// ---------------------------------------------------------------- terrain shapes

function localUV(px, pz, sh) {
  const c = Math.cos(sh.rot || 0), s = Math.sin(sh.rot || 0);
  const dx = px - sh.x, dz = pz - sh.z;
  return [dx * c + dz * s, -dx * s + dz * c];
}

function shapeBounds(sh) {
  switch (sh.t) {
    case 'mound': case 'pit': case 'crater': {
      const r = Math.max(sh.rx ?? sh.r, sh.rz ?? sh.r) * 1.3 + 1;
      return [sh.x - r, sh.z - r, sh.x + r, sh.z + r];
    }
    case 'plateau': return polyBounds(sh.poly, (sh.edge ?? 6) + 1);
    case 'ridge': {
      const b = polyBounds(sh.pts, sh.w + 1);
      return b;
    }
    case 'bank': return polyBounds(sh.pts, sh.w + (sh.fall ?? 4) + 1);
    case 'cone': {
      const r = sh.r + 1;
      return [sh.x - r, sh.z - r, sh.x + r, sh.z + r];
    }
    case 'wash': case 'kicker': case 'table': case 'ramp': {
      const r = Math.hypot(sh.len, sh.wid) / 2 + 2;
      return [sh.x - r, sh.z - r, sh.x + r, sh.z + r];
    }
    default: return [ARENA.x0, ARENA.z0, ARENA.x1, ARENA.z1];
  }
}

// height contribution of one shape at (px, pz)
function shapeHeight(sh, px, pz) {
  switch (sh.t) {
    case 'mound': {
      const [u, v] = localUV(px, pz, sh);
      const rx = sh.rx ?? sh.r, rz = sh.rz ?? sh.r;
      const d = Math.sqrt((u / rx) ** 2 + (v / rz) ** 2);
      if (d >= 1) return 0;
      const k = 0.5 + 0.5 * Math.cos(Math.PI * d);
      return sh.h * Math.pow(k, sh.p ?? 1);
    }
    case 'pit': {
      const [u, v] = localUV(px, pz, sh);
      const rx = sh.rx ?? sh.r, rz = sh.rz ?? sh.r;
      const d = Math.sqrt((u / rx) ** 2 + (v / rz) ** 2);
      if (d >= 1) return 0;
      return -sh.depth * smootherstep(1, 0.45, d);
    }
    case 'crater': {
      const [u, v] = localUV(px, pz, sh);
      const r = sh.r;
      const d = Math.hypot(u, v) / r;
      if (d >= 1.3) return 0;
      const bowl = -sh.depth * smootherstep(0.85, 0.0, d);
      const rim = (sh.rim ?? sh.depth * 0.4) * Math.exp(-((d - 0.9) ** 2) / 0.03);
      return bowl + rim;
    }
    case 'plateau': {
      const d = polySDF(px, pz, sh.poly);
      const e = sh.edge ?? 6;
      return sh.h * smootherstep(e / 2, -e / 2, d);
    }
    case 'ridge': {
      let d = Infinity;
      const p = sh.pts;
      for (let i = 0; i + 1 < p.length; i++) d = Math.min(d, segDist(px, pz, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]));
      if (d >= sh.w) return 0;
      const q = d / sh.w;
      if (sh.profile === 'table') return sh.h * smootherstep(1, 0.55, q);
      return sh.h * (0.5 + 0.5 * Math.cos(Math.PI * q));
    }
    case 'wash': {
      const [u, v] = localUV(px, pz, sh);
      const hl = sh.len / 2, hwid = sh.wid / 2;
      if (Math.abs(u) > hl + 0.01 || Math.abs(v) > hwid + 1.5) return 0;
      const fade = smoothstep(hwid + 1.5, hwid - 0.5, Math.abs(v)) * smoothstep(hl, hl - sh.wl * 0.5, Math.abs(u));
      const ph = ((u + hl) / sh.wl) * Math.PI * 2;
      return sh.amp * (0.5 - 0.5 * Math.cos(ph)) * fade;
    }
    case 'kicker': {
      // rises along +u from u=-len/2 to the lip at +len/2 then drops off
      const [u, v] = localUV(px, pz, sh);
      const hl = sh.len / 2, hwid = sh.wid / 2;
      if (Math.abs(v) > hwid + 2) return 0;
      const fade = smoothstep(hwid + 2, hwid - 0.3, Math.abs(v));
      const drop = sh.drop ?? 1.2;
      let h;
      if (u < -hl || u > hl + drop) h = 0;
      else if (u <= hl) { const t = (u + hl) / sh.len; h = sh.h * Math.pow(t, 1.6); }
      else h = sh.h * smootherstep(hl + drop, hl, u);
      return h * fade;
    }
    case 'table': {
      // up ramp, flat top, down ramp along u
      const [u, v] = localUV(px, pz, sh);
      const hl = sh.len / 2, hwid = sh.wid / 2;
      if (Math.abs(v) > hwid + 2.5 || Math.abs(u) > hl) return 0;
      const fade = smoothstep(hwid + 2.5, hwid - 0.3, Math.abs(v));
      const up = sh.up ?? sh.len * 0.3, down = sh.down ?? up;
      let h;
      if (u < -hl + up) h = smootherstep(-hl, -hl + up, u);
      else if (u > hl - down) h = smootherstep(hl, hl - down, u);
      else h = 1;
      return sh.h * h * fade;
    }
    case 'bank': {
      // banked turn: height grows across the band towards the outside (side = +1: left of the polyline direction)
      const p = sh.pts;
      let best = Infinity, lat = 0, beyond = 0;
      for (let i = 0; i + 1 < p.length; i++) {
        const [ax, az] = p[i], [bx, bz] = p[i + 1];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, l = Math.sqrt(l2);
        const tr = ((px - ax) * dx + (pz - az) * dz) / l2;
        const t = tr < 0 ? 0 : tr > 1 ? 1 : tr;
        const qx = ax + dx * t, qz = az + dz * t;
        // lateral offset from the infinite line, longitudinal overshoot past the ends
        const latI = ((px - ax) * -dz + (pz - az) * dx) / l;
        const over = (tr < 0 ? -tr : tr > 1 ? tr - 1 : 0) * l;
        const d = Math.abs(latI) + over;
        if (d < best) { best = d; lat = latI; beyond = over; }
      }
      const o = lat * (sh.side ?? 1);
      if (o < -1) return 0;
      const fall = sh.fall ?? 4;
      const ends = smootherstep(sh.taper ?? 10, 0, beyond); // ease the bank in and out
      if (o <= sh.w) return sh.h * smootherstep(-1, sh.w, o) * ends;
      return sh.h * smootherstep(sh.w + fall, sh.w, o) * ends;
    }
    case 'cone': {
      // volcano: cone up to the rim (radius fraction cr), a lip on the rim and
      // a steep crater bowl with a flat floor inside
      const d = Math.hypot(px - sh.x, pz - sh.z) / sh.r;
      if (d >= 1) return 0;
      const rim = sh.cr ?? 0.22;
      const flank = sh.h * Math.pow(1 - Math.max(d, rim), sh.p ?? 1.4);
      const lip = (sh.lip ?? 0) * Math.exp(-(((d - rim) / 0.035) ** 2));
      const bowl = (sh.crater ?? 0) * smootherstep(rim, rim * 0.5, d);
      return flank + lip - bowl;
    }
    case 'ramp': {
      // plain slope from 0 at u=-len/2 to h at +len/2, extends flat beyond (used to join levels)
      const [u, v] = localUV(px, pz, sh);
      const hl = sh.len / 2, hwid = sh.wid / 2;
      if (Math.abs(v) > hwid + 2) return 0;
      const fade = smoothstep(hwid + 2, hwid - 0.3, Math.abs(v));
      if (u > hl + (sh.ext ?? 0)) return 0;
      return sh.h * smootherstep(-hl, hl, u) * fade;
    }
  }
  return 0;
}

// ---------------------------------------------------------------- build

export function buildTrack(def, { reverse = false } = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const A = ARENA;
  const cell = A.cell;
  const nx = Math.round((A.x1 - A.x0) / cell) + 1;
  const nz = Math.round((A.z1 - A.z0) / cell) + 1;
  const N = nx * nz;
  const seed = hashString(def.id);
  const noise = makeNoise2D(seed);
  const noise2 = makeNoise2D(seed ^ 0x9e3779b9);

  // --- centre line
  const path = buildPath(def, reverse);
  rotatePath(path, def.start[0], def.start[1]);
  const L = path.L;

  // --- signed distance (drivable < 0), nearest path sample, lateral offset
  const BIG = 99;
  const sdf = new Float32Array(N).fill(BIG);
  const pdist = new Float32Array(N).fill(BIG);
  const near = new Int32Array(N).fill(-1);
  const lat = new Float32Array(N);

  const idx = (i, k) => k * nx + i;
  const toI = (x) => (x - A.x0) / cell;
  const toK = (z) => (z - A.z0) / cell;

  for (let i = 0; i < path.n; i++) {
    const j = (i + 1) % path.n;
    const ax = path.x[i], az = path.z[i], bx = path.x[j], bz = path.z[j];
    const hwa = path.hw[i], hwb = path.hw[j];
    const R = Math.max(hwa, hwb) + SPLAT_MARGIN;
    const i0 = Math.max(0, Math.floor(toI(Math.min(ax, bx) - R)));
    const i1 = Math.min(nx - 1, Math.ceil(toI(Math.max(ax, bx) + R)));
    const k0 = Math.max(0, Math.floor(toK(Math.min(az, bz) - R)));
    const k1 = Math.min(nz - 1, Math.ceil(toK(Math.max(az, bz) + R)));
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1e-9;
    for (let k = k0; k <= k1; k++) {
      const pz = A.z0 + k * cell;
      for (let ii = i0; ii <= i1; ii++) {
        const px = A.x0 + ii * cell;
        let t = ((px - ax) * dx + (pz - az) * dz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + dx * t, qz = az + dz * t;
        const d = Math.hypot(px - qx, pz - qz);
        const c = idx(ii, k);
        const v = d - (hwa + (hwb - hwa) * t);
        if (v < sdf[c]) sdf[c] = v;
        if (d < pdist[c]) {
          pdist[c] = d;
          near[c] = i;
          // signed lateral offset: + is to the right of travel direction
          const tx = path.tx[i], tz = path.tz[i];
          lat[c] = (px - qx) * -tz + (pz - qz) * tx;
        }
      }
    }
  }

  // open areas (union)
  for (const ar of def.areas || []) {
    const poly = ar.poly;
    const [bx0, bz0, bx1, bz1] = polyBounds(poly, SPLAT_MARGIN);
    for (let k = Math.max(0, Math.floor(toK(bz0))); k <= Math.min(nz - 1, Math.ceil(toK(bz1))); k++) {
      const pz = A.z0 + k * cell;
      for (let i = Math.max(0, Math.floor(toI(bx0))); i <= Math.min(nx - 1, Math.ceil(toI(bx1))); i++) {
        const px = A.x0 + i * cell;
        const v = polySDF(px, pz, poly);
        const c = idx(i, k);
        if (v < sdf[c]) sdf[c] = v;
      }
    }
  }
  // islands with barriers (subtract)
  for (const is of def.islands || []) {
    if (is.circle) continue;
    const poly = is.poly;
    const [bx0, bz0, bx1, bz1] = polyBounds(poly, 3);
    for (let k = Math.max(0, Math.floor(toK(bz0))); k <= Math.min(nz - 1, Math.ceil(toK(bz1))); k++) {
      const pz = A.z0 + k * cell;
      for (let i = Math.max(0, Math.floor(toI(bx0))); i <= Math.min(nx - 1, Math.ceil(toI(bx1))); i++) {
        const px = A.x0 + i * cell;
        const v = -polySDF(px, pz, poly);
        const c = idx(i, k);
        if (v > sdf[c]) sdf[c] = v;
      }
    }
  }
  // barrier field = sdf so far; collision field also gets solid props (drums, tyre stacks)
  const bsdf = sdf.slice();
  const props = [];
  for (const is of def.islands || []) {
    if (!is.circle) continue;
    const [cx, cz, r] = is.circle;
    props.push({ kind: is.prop || 'drum', x: cx, z: cz, r, h: is.h });
    const R = r + 3;
    for (let k = Math.max(0, Math.floor(toK(cz - R))); k <= Math.min(nz - 1, Math.ceil(toK(cz + R))); k++) {
      const pz = A.z0 + k * cell;
      for (let i = Math.max(0, Math.floor(toI(cx - R))); i <= Math.min(nx - 1, Math.ceil(toI(cx + R))); i++) {
        const px = A.x0 + i * cell;
        const v = r + WALL_FACE - Math.hypot(px - cx, pz - cz);
        const c = idx(i, k);
        if (v > sdf[c]) sdf[c] = v;
      }
    }
  }

  // --- heightfield
  const height = new Float32Array(N);
  const shapes = def.terrain || [];
  // base undulation: gentle everywhere, rougher off the racing surface
  const noiseAmp = def.noiseAmp ?? 0.22;
  for (let k = 0; k < nz; k++) {
    const pz = A.z0 + k * cell;
    for (let i = 0; i < nx; i++) {
      const px = A.x0 + i * cell;
      const c = idx(i, k);
      const on = smoothstep(1.5, -1.0, sdf[c]); // 1 on track
      const n1 = noise.fbm(px * 0.045, pz * 0.045, 3);
      const n2 = noise2.fbm(px * 0.22, pz * 0.22, 3);
      height[c] = n1 * noiseAmp * (1 - 0.6 * on) + n2 * 0.09 * (1 - 0.85 * on);
    }
  }
  for (const sh0 of shapes) {
    const sh = reverse && (sh0.t === 'kicker' || sh0.dir) ? { ...sh0, rot: (sh0.rot || 0) + Math.PI } : sh0;
    const [bx0, bz0, bx1, bz1] = shapeBounds(sh);
    const k0 = Math.max(0, Math.floor(toK(bz0))), k1 = Math.min(nz - 1, Math.ceil(toK(bz1)));
    const i0 = Math.max(0, Math.floor(toI(bx0))), i1 = Math.min(nx - 1, Math.ceil(toI(bx1)));
    for (let k = k0; k <= k1; k++) {
      const pz = A.z0 + k * cell;
      for (let i = i0; i <= i1; i++) {
        const px = A.x0 + i * cell;
        const c = idx(i, k);
        let h = shapeHeight(sh, px, pz);
        if (sh.offTrack) h *= smoothstep(-0.5, 2.0, bsdf[c]);
        if (sh.onTrack) h *= smoothstep(4.0, 0.5, bsdf[c]);
        if (sh.max) height[c] = Math.max(height[c], h);
        else height[c] += h;
      }
    }
  }

  // --- water bodies: dig a basin and store the water level
  const water = new Float32Array(N).fill(-99);
  const waterBodies = [];
  for (const w of def.water || []) {
    const poly = w.poly || ellipsePoly(w.x, w.z, w.rx, w.rz, w.rot || 0, 32, w.wobble ?? 0.12, seed + waterBodies.length * 7);
    const depth = w.depth ?? 0.45;
    const edge = w.edge ?? 1.6;
    // reference level: average terrain height along the outline
    let ref = 0;
    for (const [x, z] of poly) ref += sampleGrid(height, nx, nz, toI(x), toK(z));
    ref /= poly.length;
    const level = ref - 0.06;
    const [bx0, bz0, bx1, bz1] = polyBounds(poly, edge + 1);
    for (let k = Math.max(0, Math.floor(toK(bz0))); k <= Math.min(nz - 1, Math.ceil(toK(bz1))); k++) {
      const pz = A.z0 + k * cell;
      for (let i = Math.max(0, Math.floor(toI(bx0))); i <= Math.min(nx - 1, Math.ceil(toI(bx1))); i++) {
        const px = A.x0 + i * cell;
        const d = polySDF(px, pz, poly);
        const c = idx(i, k);
        if (d < edge) {
          const target = ref - depth * smootherstep(edge, -edge * 0.8, d);
          height[c] = Math.min(height[c], lerp(height[c], target, smoothstep(edge, 0, d)));
        }
        if (d < edge * 0.5) water[c] = level;
      }
    }
    waterBodies.push({ poly, level, depth });
  }

  // light smoothing of the heightfield (removes grid creases that make physics jitter)
  smoothGrid(height, nx, nz, 1);

  const data = {
    def, id: def.id, name: def.name, reverse, seed,
    nx, nz, cell, x0: A.x0, z0: A.z0, x1: A.x1, z1: A.z1,
    sdf, bsdf, height, water, near, lat, pdist,
    path, L, props, waterBodies,
  };
  Object.assign(data, trackMethods);
  data.computeRacingLine();
  data.computeGrid();
  data.buildMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
  return data;
}

function sampleGrid(g, nx, nz, fi, fk) {
  fi = clamp(fi, 0, nx - 1.001); fk = clamp(fk, 0, nz - 1.001);
  const i = Math.floor(fi), k = Math.floor(fk);
  const u = fi - i, v = fk - k;
  const c = k * nx + i;
  const a = g[c], b = g[c + 1], d = g[c + nx], e = g[c + nx + 1];
  return (a + (b - a) * u) * (1 - v) + (d + (e - d) * u) * v;
}

function smoothGrid(g, nx, nz, passes) {
  const tmp = new Float32Array(g.length);
  for (let p = 0; p < passes; p++) {
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        const i0 = i > 0 ? i - 1 : i, i1 = i < nx - 1 ? i + 1 : i;
        const c = k * nx;
        tmp[c + i] = (g[c + i0] + 2 * g[c + i] + g[c + i1]) * 0.25;
      }
    }
    for (let k = 0; k < nz; k++) {
      const k0 = k > 0 ? k - 1 : k, k1 = k < nz - 1 ? k + 1 : k;
      for (let i = 0; i < nx; i++) {
        g[k * nx + i] = (tmp[k0 * nx + i] + 2 * tmp[k * nx + i] + tmp[k1 * nx + i]) * 0.25;
      }
    }
  }
}

// ---------------------------------------------------------------- queries

const trackMethods = {
  gx(x) { return (x - this.x0) / this.cell; },
  gz(z) { return (z - this.z0) / this.cell; },
  heightAt(x, z) { return sampleGrid(this.height, this.nx, this.nz, this.gx(x), this.gz(z)); },
  sdfAt(x, z) { return sampleGrid(this.sdf, this.nx, this.nz, this.gx(x), this.gz(z)); },
  bsdfAt(x, z) { return sampleGrid(this.bsdf, this.nx, this.nz, this.gx(x), this.gz(z)); },
  waterAt(x, z) {
    // water depth at a point (0 if dry)
    const lv = sampleGrid(this.water, this.nx, this.nz, this.gx(x), this.gz(z));
    if (lv < -50) return 0;
    const d = lv - this.heightAt(x, z);
    return d > 0 ? d : 0;
  },
  waterLevelAt(x, z) {
    const lv = sampleGrid(this.water, this.nx, this.nz, this.gx(x), this.gz(z));
    return lv < -50 ? null : lv;
  },
  // gradient of the collision sdf (points away from the drivable area)
  sdfGrad(x, z, out) {
    const e = this.cell;
    const gx = this.sdfAt(x + e, z) - this.sdfAt(x - e, z);
    const gz = this.sdfAt(x, z + e) - this.sdfAt(x, z - e);
    const l = Math.hypot(gx, gz) || 1;
    out[0] = gx / l; out[1] = gz / l;
    return out;
  },
  normalAt(x, z, out) {
    const e = 0.5;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    let nx = -hx / (2 * e), ny = 1, nz = -hz / (2 * e);
    const l = Math.hypot(nx, ny, nz);
    out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
    return out;
  },
  // nearest centre line sample, searched in a window around a hint index
  nearestIndex(x, z, hint = -1, back = 24, fwd = 48) {
    const p = this.path;
    let best = -1, bd = Infinity;
    if (hint < 0) {
      for (let i = 0; i < p.n; i++) {
        const d = (p.x[i] - x) ** 2 + (p.z[i] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }
    for (let o = -back; o <= fwd; o++) {
      const i = (hint + o + p.n) % p.n;
      const d = (p.x[i] - x) ** 2 + (p.z[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  },
  // continuous s (metres) of a point given its nearest sample index
  sOf(x, z, i) {
    const p = this.path;
    const s = i * p.ds + ((x - p.x[i]) * p.tx[i] + (z - p.z[i]) * p.tz[i]);
    return ((s % this.L) + this.L) % this.L;
  },

  // free lateral interval around the centre line sample i (handles open areas and props)
  _room(i, margin) {
    const p = this.path;
    const nxv = -p.tz[i], nzv = p.tx[i];
    const step = 0.5, n = 60;
    const free = new Uint8Array(2 * n + 1);
    for (let k = -n; k <= n; k++) {
      const o = k * step;
      const x = p.x[i] + nxv * o, z = p.z[i] + nzv * o;
      let ok = this.sdfAt(x, z) <= -margin;
      if (ok) for (const pr of this.props) if ((x - pr.x) ** 2 + (z - pr.z) ** 2 < (pr.r + margin + 1.4) ** 2) { ok = false; break; }
      free[k + n] = ok ? 1 : 0;
    }
    // intervals of free cells; pick the one containing 0, else the widest close to 0
    let best = null, bestScore = -Infinity;
    for (let k = 0; k <= 2 * n; ) {
      if (!free[k]) { k++; continue; }
      let e = k;
      while (e + 1 <= 2 * n && free[e + 1]) e++;
      const lo = (k - n) * step, hi = (e - n) * step;
      const contains = lo <= 0 && hi >= 0;
      const dist = contains ? 0 : Math.min(Math.abs(lo), Math.abs(hi));
      const score = (contains ? 1000 : 0) + (hi - lo) - dist * 2;
      if (score > bestScore) { bestScore = score; best = [lo, hi]; }
      k = e + 1;
    }
    return best || [0, 0];
  },

  computeRacingLine() {
    const p = this.path;
    const stride = 4; // 2 m
    const m = Math.floor(p.n / stride);
    const idxs = new Int32Array(m);
    const lo = new Float32Array(m), hi = new Float32Array(m), off = new Float32Array(m);
    const margin = 2.3;
    for (let k = 0; k < m; k++) {
      const i = k * stride;
      idxs[k] = i;
      const [a, b] = this._room(i, margin);
      lo[k] = a; hi[k] = b;
      off[k] = clamp(0, lo[k], hi[k]);
    }
    const X = (k) => p.x[idxs[k]] + -p.tz[idxs[k]] * off[k];
    const Z = (k) => p.z[idxs[k]] + p.tx[idxs[k]] * off[k];
    // string pulling relaxation, blended towards a smoother minimum-curvature-ish line
    for (let it = 0; it < 400; it++) {
      for (let k = 0; k < m; k++) {
        const a = (k - 1 + m) % m, b = (k + 1) % m;
        const tx = (X(a) + X(b)) / 2, tz = (Z(a) + Z(b)) / 2;
        const i = idxs[k];
        const o = (tx - p.x[i]) * -p.tz[i] + (tz - p.z[i]) * p.tx[i];
        off[k] = clamp(lerp(off[k], o, 0.6), lo[k], hi[k]);
      }
    }
    // keep a little away from the walls: blend 80% optimal / 20% centre
    const lx = new Float32Array(m), lz = new Float32Array(m), ls = new Float32Array(m);
    for (let k = 0; k < m; k++) {
      off[k] *= 0.85;
      lx[k] = X(k); lz[k] = Z(k); ls[k] = idxs[k] * p.ds;
    }
    // curvature of the racing line and target speeds
    const curv = new Float32Array(m), vmax = new Float32Array(m);
    for (let k = 0; k < m; k++) {
      const a = (k - 2 + m) % m, b = (k + 2) % m;
      const ax = lx[k] - lx[a], az = lz[k] - lz[a];
      const bx = lx[b] - lx[k], bz = lz[b] - lz[k];
      const ang = wrapAngle(Math.atan2(bz, bx) - Math.atan2(az, ax));
      const len = (Math.hypot(ax, az) + Math.hypot(bx, bz)) / 2 || 1;
      curv[k] = ang / len;
    }
    // smooth curvature a bit
    const c2 = new Float32Array(m);
    for (let k = 0; k < m; k++) c2[k] = (curv[(k - 1 + m) % m] + 2 * curv[k] + curv[(k + 1) % m]) / 4;
    this.line = { m, x: lx, z: lz, s: ls, off, curv: c2, idx: idxs, lo, hi, vmax };
  },

  // speed profile for a given lateral grip / braking capability. Jumps are
  // simulated: no braking is possible in the air, so the speed at take-off is
  // limited by what the landing zone allows.
  speedProfile(grip, brake, vtop, gAir = 23) {
    const ln = this.line, m = ln.m;
    if (!ln.h) {
      ln.h = new Float32Array(m); ln.ds = new Float32Array(m);
      for (let k = 0; k < m; k++) {
        ln.h[k] = this.heightAt(ln.x[k], ln.z[k]);
        const nk = (k + 1) % m;
        ln.ds[k] = Math.hypot(ln.x[nk] - ln.x[k], ln.z[nk] - ln.z[k]) || 1;
      }
    }
    const v = new Float32Array(m);
    for (let k = 0; k < m; k++) {
      const c = Math.abs(ln.curv[k]);
      v[k] = c > 1e-4 ? Math.min(vtop, Math.sqrt(grip / c)) : vtop;
    }
    const cap = v.slice();
    const backward = () => {
      for (let pass = 0; pass < 2; pass++) {
        for (let k = m - 1; k >= 0; k--) {
          const nk = (k + 1) % m;
          v[k] = Math.min(v[k], Math.sqrt(v[nk] * v[nk] + 2 * brake * ln.ds[k]));
        }
      }
    };
    backward();
    this.jumps = [];
    for (let it = 0; it < 3; it++) {
      for (let k = 0; k < m; k++) {
        const pk = (k - 1 + m) % m;
        const slope = (ln.h[k] - ln.h[pk]) / ln.ds[pk];
        if (slope < -0.05) continue;
        const sp = v[k];
        const vy = sp * Math.min(slope, 1.2);
        let d = 0, j = k, air = 0;
        for (let q = 1; q < 40; q++) {
          j = (k + q) % m;
          d += ln.ds[(j - 1 + m) % m];
          const t = d / sp;
          const y = ln.h[k] + vy * t - 0.5 * gAir * t * t;
          if (y <= ln.h[j] + 0.08) break;
          air = q;
        }
        if (air >= 2) {
          // landing index j: cannot brake in between
          const land = j;
          let lim = v[land];
          // landing unsettles the truck: be gentler for a few samples
          for (let q = 0; q < 4; q++) lim = Math.min(lim, cap[(land + q) % m] * 0.9);
          if (v[k] > lim) v[k] = lim;
          for (let q = 1; q <= air; q++) v[(k + q) % m] = Math.min(v[(k + q) % m], Math.max(lim, v[(k + q) % m]));
          if (it === 2) this.jumps.push([k, land, air]);
        }
      }
      backward();
    }
    return v;
  },

  // starting grid: 2x2 behind the line
  computeGrid() {
    const p = this.path;
    const slots = [];
    // place slots a few metres behind s=0
    const rows = [[-7.0, -0.45], [-7.0, 0.45], [-13.5, -0.45], [-13.5, 0.45]];
    for (const [back, side] of rows) {
      const i = (Math.round(back / p.ds) + p.n) % p.n;
      const hw = p.hw[i];
      const o = side * (hw - 2.0) * 0.9;
      slots.push({
        x: p.x[i] + -p.tz[i] * o,
        z: p.z[i] + p.tx[i] * o,
        h: Math.atan2(p.tz[i], p.tx[i]),
        s: i * p.ds - p.L,
      });
    }
    this.grid = slots;
    this.startLine = { x: p.x[0], z: p.z[0], tx: p.tx[0], tz: p.tz[0], hw: p.hw[0] };
  },
};

// sample a few random on-track spots for pickups
export function randomTrackSpot(track, r, avoid = []) {
  const p = track.path;
  for (let tries = 0; tries < 60; tries++) {
    const i = Math.floor(r() * p.n);
    const hw = p.hw[i];
    const o = (r() * 2 - 1) * Math.max(0, hw - 2.2);
    const x = p.x[i] + -p.tz[i] * o, z = p.z[i] + p.tx[i] * o;
    if (track.sdfAt(x, z) > -1.6) continue;
    if (track.waterAt(x, z) > 0.02) continue;
    // not on steep ground
    const n = track.normalAt(x, z, [0, 0, 0]);
    if (n[1] < 0.97) continue;
    // keep away from the start line and other items
    const sDist = Math.min(i * p.ds, track.L - i * p.ds);
    if (sDist < 12) continue;
    let ok = true;
    for (const a of avoid) if ((a.x - x) ** 2 + (a.z - z) ** 2 < 64) { ok = false; break; }
    if (!ok) continue;
    return { x, z, i };
  }
  return null;
}
