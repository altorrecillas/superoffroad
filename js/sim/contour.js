// Marching squares iso-contours on a scalar grid, stitched into polylines.

export function isoContours(f, nx, nz, iso, x0, z0, cell) {
  // edge point cache: horizontal edges (i,k)-(i+1,k) id = 2*(k*nx+i), vertical (i,k)-(i,k+1) id = 2*(k*nx+i)+1
  const pts = new Map();
  const edgePoint = (id) => {
    let p = pts.get(id);
    if (p) return p;
    const base = id >> 1, i = base % nx, k = (base - i) / nx;
    const a = f[base];
    let x, z;
    if ((id & 1) === 0) {
      const b = f[base + 1];
      const t = (iso - a) / (b - a);
      x = x0 + (i + t) * cell; z = z0 + k * cell;
    } else {
      const b = f[base + nx];
      const t = (iso - a) / (b - a);
      x = x0 + i * cell; z = z0 + (k + t) * cell;
    }
    p = [x, z];
    pts.set(id, p);
    return p;
  };
  const adj = new Map();
  const link = (e1, e2) => {
    let a = adj.get(e1); if (!a) adj.set(e1, (a = []));
    let b = adj.get(e2); if (!b) adj.set(e2, (b = []));
    a.push(e2); b.push(e1);
  };
  for (let k = 0; k < nz - 1; k++) {
    for (let i = 0; i < nx - 1; i++) {
      const c = k * nx + i;
      const v0 = f[c], v1 = f[c + 1], v2 = f[c + nx + 1], v3 = f[c + nx];
      let code = 0;
      if (v0 > iso) code |= 1;
      if (v1 > iso) code |= 2;
      if (v2 > iso) code |= 4;
      if (v3 > iso) code |= 8;
      if (code === 0 || code === 15) continue;
      const eT = 2 * c, eB = 2 * (c + nx), eL = 2 * c + 1, eR = 2 * (c + 1) + 1;
      switch (code) {
        case 1: case 14: link(eL, eT); break;
        case 2: case 13: link(eT, eR); break;
        case 3: case 12: link(eL, eR); break;
        case 4: case 11: link(eR, eB); break;
        case 6: case 9: link(eT, eB); break;
        case 7: case 8: link(eL, eB); break;
        case 5: case 10: {
          const center = (v0 + v1 + v2 + v3) / 4;
          const hi = center > iso;
          if ((code === 5) === hi) { link(eL, eB); link(eT, eR); }
          else { link(eL, eT); link(eR, eB); }
          break;
        }
      }
    }
  }
  // walk
  const used = new Set();
  const lines = [];
  for (const start of adj.keys()) {
    if (used.has(start)) continue;
    const nb = adj.get(start);
    // prefer starting at an open end
    const line = [];
    let cur = start, prev = -1;
    used.add(cur);
    line.push(edgePoint(cur));
    for (;;) {
      const ns = adj.get(cur);
      let next = -1;
      for (const n of ns) if (n !== prev && !used.has(n)) { next = n; break; }
      if (next < 0) {
        // closed?
        if (ns.includes(start) && line.length > 2) line.closed = true;
        break;
      }
      used.add(next);
      line.push(edgePoint(next));
      prev = cur; cur = next;
    }
    // extend backwards from start if open
    if (!line.closed && nb.length > 1) {
      const back = [];
      let cur2 = start, prev2 = adj.get(start)[0];
      for (;;) {
        const ns = adj.get(cur2);
        let next = -1;
        for (const n of ns) if (n !== prev2 && !used.has(n)) { next = n; break; }
        if (next < 0) break;
        used.add(next);
        back.push(edgePoint(next));
        prev2 = cur2; cur2 = next;
      }
      if (back.length) {
        const merged = back.reverse().concat(line);
        merged.closed = false;
        lines.push(merged);
        continue;
      }
    }
    lines.push(line);
  }
  return lines;
}

// Laplacian smoothing (keeps ends of open lines)
export function smoothLine(line, iters = 2, k = 0.5) {
  let a = line.map((p) => p.slice());
  const closed = !!line.closed;
  const n = a.length;
  for (let it = 0; it < iters; it++) {
    const b = a.map((p) => p.slice());
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      const p = a[(i - 1 + n) % n], q = a[(i + 1) % n];
      b[i][0] = a[i][0] + k * ((p[0] + q[0]) / 2 - a[i][0]);
      b[i][1] = a[i][1] + k * ((p[1] + q[1]) / 2 - a[i][1]);
    }
    a = b;
  }
  a.closed = closed;
  return a;
}

// Resample a polyline at a fixed spacing; returns points with cumulative length.
export function resampleLine(line, spacing) {
  const closed = !!line.closed;
  const pts = closed ? line.concat([line[0]]) : line;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  const n = Math.max(2, Math.round(L / spacing));
  const out = [];
  let j = 0;
  const count = closed ? n : n + 1;
  for (let s = 0; s < count; s++) {
    const d = (s / n) * L;
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = Math.min(1, Math.max(0, (d - cum[j]) / seg));
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t, d]);
  }
  out.closed = closed;
  out.length2 = L;
  return out;
}
