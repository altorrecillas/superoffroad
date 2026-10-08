// Pure math helpers shared by the simulation and the renderer (no DOM, no three.js).

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const smootherstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const TAU = Math.PI * 2;
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
export const sign = (v) => (v < 0 ? -1 : 1);

// Deterministic RNG (mulberry32).
export function rng(seed) {
  let s = seed >>> 0;
  const f = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a, b) => a + (b - a) * f();
  f.int = (a, b) => Math.floor(a + (b - a + 1) * f());
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  return f;
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 2D gradient noise with a seeded permutation table.
export function makeNoise2D(seed) {
  const r = rng(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const a = r() * TAU;
    gx[i] = Math.cos(a); gy[i] = Math.sin(a);
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const a = perm[X + perm[Y]], b = perm[X + 1 + perm[Y]];
    const c = perm[X + perm[Y + 1]], d = perm[X + 1 + perm[Y + 1]];
    const n00 = gx[a] * xf + gy[a] * yf;
    const n10 = gx[b] * (xf - 1) + gy[b] * yf;
    const n01 = gx[c] * xf + gy[c] * (yf - 1);
    const n11 = gx[d] * (xf - 1) + gy[d] * (yf - 1);
    const u = fade(xf), v = fade(yf);
    return (n00 + u * (n10 - n00) + v * (n01 - n00 + u * (n11 - n01 - n10 + n00))) * 1.4142;
  }
  noise.fbm = (x, y, oct = 4, lac = 2.0, gain = 0.5) => {
    let s = 0, a = 1, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      s += a * noise(x * f, y * f);
      norm += a; a *= gain; f *= lac;
    }
    return s / norm;
  };
  return noise;
}

// Distance from point to segment, returns {d, t}.
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = clamp(t, 0, 1);
  const qx = ax + dx * t - px, qz = az + dz * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
}

// Signed distance to a closed polygon [[x,z],...] (negative inside).
export function polySDF(px, pz, poly) {
  let d = Infinity, inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i];
    d = Math.min(d, segDist(px, pz, ax, az, bx, bz));
    if ((az > pz) !== (bz > pz) && px < ((bx - ax) * (pz - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside ? -d : d;
}

export function polyBounds(poly, pad = 0) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
}

// Rounded rectangle polygon helper (center, size, rotation, corner radius).
export function roundRect(cx, cz, w, h, r = 0, rot = 0, seg = 4) {
  const pts = [];
  const hw = w / 2, hh = h / 2;
  r = Math.min(r, hw, hh);
  const corners = [[hw - r, hh - r, 0], [-hw + r, hh - r, Math.PI / 2], [-hw + r, -hh + r, Math.PI], [hw - r, -hh + r, 1.5 * Math.PI]];
  for (const [ox, oz, a0] of corners) {
    if (r <= 0) { pts.push([ox, oz]); continue; }
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([ox + Math.cos(a) * r, oz + Math.sin(a) * r]);
    }
  }
  const c = Math.cos(rot), s = Math.sin(rot);
  return pts.map(([x, z]) => [cx + x * c - z * s, cz + x * s + z * c]);
}

export function ellipsePoly(cx, cz, rx, rz, rot = 0, n = 28, wobble = 0, seed = 1) {
  const r = rng(seed);
  const ph = [r() * TAU, r() * TAU, r() * TAU];
  const pts = [];
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const w = 1 + wobble * (0.5 * Math.sin(a * 2 + ph[0]) + 0.3 * Math.sin(a * 3 + ph[1]) + 0.2 * Math.sin(a * 5 + ph[2]));
    const x = Math.cos(a) * rx * w, z = Math.sin(a) * rz * w;
    pts.push([cx + x * c - z * s, cz + x * s + z * c]);
  }
  return pts;
}
