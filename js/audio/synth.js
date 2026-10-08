// Offline sound synthesis into AudioBuffers: V8 and flat-four engine loops, surface noises,
// crowd ambience and one-shot effects. Generated once at load time.

function rngf(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1; };
}

// RBJ biquad, processes in place
function biquad(x, sr, type, f, Q = 0.707, gainDb = 0) {
  const w = 2 * Math.PI * f / sr, cs = Math.cos(w), sn = Math.sin(w), a = sn / (2 * Q);
  const A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + a; a1 = -2 * cs; a2 = 1 - a; }
  else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + a; a1 = -2 * cs; a2 = 1 - a; }
  else if (type === 'bp') { b0 = a; b1 = 0; b2 = -a; a0 = 1 + a; a1 = -2 * cs; a2 = 1 - a; }
  else { b0 = 1 + a * A; b1 = -2 * cs; b2 = 1 - a * A; a0 = 1 + a / A; a1 = -2 * cs; a2 = 1 - a / A; } // peak
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    x[i] = y;
  }
  return x;
}
function normalize(x, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  if (m > 0) { const k = peak / m; for (let i = 0; i < x.length; i++) x[i] *= k; }
  return x;
}
function loopFade(x, n) {
  // crossfade the tail into the head so the buffer loops seamlessly
  const L = x.length - n;
  const out = new Float32Array(L);
  for (let i = 0; i < L; i++) out[i] = x[i + n];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[L - n + i] = out[L - n + i] * (1 - t) + x[i] * t;
  }
  return out;
}
function toBuffer(ctx, data, sr) {
  const b = ctx.createBuffer(1, data.length, sr);
  b.copyToChannel(data, 0);
  return b;
}

// engine loop at a given rpm: firing pulses through exhaust resonances.
// 'v8': crossplane V8 (the trucks), 'flat4': air-cooled boxer of the buggy,
// even firing, sharper pulses and a raspy stinger exhaust
const ENGINES = {
  v8: {
    base: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875],
    jitter: [0, 0.012, -0.006, 0.018, -0.01, 0.006, 0.015, -0.014],
    amp: [1, 0.82, 0.95, 1.12, 0.9, 1.05, 0.86, 1.1],
    decay: (rpm) => Math.max(0.0015, 0.007 - rpm * 0.0000008),
    ring: 180, noise: 0.35, dc: 0.8,
    bands: (rpm) => [['lp', 260, 0.9, 1.0], ['bp', 520 + rpm * 0.05, 2.2, 1.6], ['bp', 1400 + rpm * 0.12, 3.0, 0.55]],
    drive: 1.4,
  },
  flat4: {
    base: [0, 0.25, 0.5, 0.75],
    jitter: [0, 0.009, -0.005, 0.011],
    amp: [1, 0.9, 1.08, 0.93],
    decay: (rpm) => Math.max(0.0011, 0.0046 - rpm * 0.00000045),
    ring: 310, noise: 0.6, dc: 0.6,
    bands: (rpm) => [['lp', 320, 0.8, 0.55], ['bp', 780 + rpm * 0.07, 1.8, 1.5], ['bp', 2100 + rpm * 0.16, 2.2, 1.0]],
    drive: 3.4,
  },
};
export function engineLoop(ctx, rpm, seed = 1, kind = 'v8') {
  const E = ENGINES[kind] || ENGINES.v8;
  const sr = ctx.sampleRate;
  const r = rngf(seed + rpm);
  const cycleHz = rpm / 120;                // one 4-stroke cycle = 2 revolutions
  const cycles = Math.max(6, Math.round(1.4 * cycleHz));
  const fade = Math.round(sr * 0.03);
  const len = Math.round((cycles / cycleHz) * sr) + fade;
  const x = new Float32Array(len);
  const T = sr / cycleHz;
  const decay = E.decay(rpm);
  const nc = E.base.length;
  for (let c = -1; c < cycles + 2; c++) {
    for (let k = 0; k < nc; k++) {
      const t0 = (c + E.base[k] + E.jitter[k]) * T;
      const a = E.amp[k] * (0.9 + 0.2 * Math.abs(r()));
      const n = Math.round(decay * sr * 6);
      for (let i = 0; i < n; i++) {
        const idx = Math.round(t0) + i;
        if (idx < 0 || idx >= len) continue;
        const t = i / sr;
        const env = Math.exp(-t / decay);
        // pressure pulse: fast attack, a little ringing and combustion noise
        x[idx] += a * env * (Math.sin(2 * Math.PI * E.ring * t) * 0.6 + E.dc + r() * E.noise);
      }
    }
  }
  // exhaust and body resonances
  const y = new Float32Array(len);
  for (const [type, f, q, w] of E.bands(rpm)) {
    const b = biquad(x.slice(), sr, type, f, q);
    for (let i = 0; i < len; i++) y[i] += b[i] * w;
  }
  for (let i = 0; i < len; i++) y[i] += r() * 0.012;
  biquad(y, sr, 'hp', 45, 0.7);
  biquad(y, sr, 'lp', kind === 'flat4' ? 6500 : 5200, 0.7);
  // gentle saturation (harder on the boxer for the rasp)
  for (let i = 0; i < len; i++) y[i] = Math.tanh(y[i] * E.drive);
  normalize(y, 0.85);
  return toBuffer(ctx, loopFade(y, fade), sr);
}

// broadband noise loop shaped by filters: 'skid', 'roll', 'water', 'wind'
export function noiseLoop(ctx, kind, seconds = 2) {
  const sr = ctx.sampleRate;
  const r = rngf(kind.length * 977);
  const fade = Math.round(sr * 0.05);
  const len = Math.round(seconds * sr) + fade;
  const x = new Float32Array(len);
  if (kind === 'skid') {
    // gritty scrape: noise with fast random grain bursts
    let g = 0;
    for (let i = 0; i < len; i++) { if (i % 90 === 0) g = 0.5 + Math.abs(r()); x[i] = r() * g; }
    biquad(x, sr, 'bp', 900, 0.8); biquad(x, sr, 'peak', 2400, 1.2, 5); biquad(x, sr, 'hp', 250);
  } else if (kind === 'roll') {
    let b = 0;
    for (let i = 0; i < len; i++) { b = b * 0.985 + r() * 0.15; x[i] = b + r() * 0.08; }
    biquad(x, sr, 'lp', 700); biquad(x, sr, 'peak', 180, 1, 4); biquad(x, sr, 'hp', 50);
  } else if (kind === 'water') {
    for (let i = 0; i < len; i++) x[i] = r() * (0.4 + 0.6 * Math.abs(Math.sin(i / sr * 23 + Math.sin(i / sr * 7) * 3)));
    biquad(x, sr, 'bp', 1600, 0.6); biquad(x, sr, 'lp', 5000);
  } else if (kind === 'flame') {
    let b = 0;
    for (let i = 0; i < len; i++) { b = b * 0.92 + r() * 0.3; x[i] = b * (0.7 + 0.3 * Math.abs(r())); }
    biquad(x, sr, 'lp', 1800); biquad(x, sr, 'peak', 120, 1, 6);
  }
  normalize(x, 0.8);
  return toBuffer(ctx, loopFade(x, fade), sr);
}

// stadium crowd: formant-filtered murmur with swelling cheers and claps
export function crowdLoop(ctx, seconds = 8) {
  const sr = ctx.sampleRate;
  const r = rngf(77);
  const fade = Math.round(sr * 0.4);
  const len = Math.round(seconds * sr) + fade;
  const n = new Float32Array(len);
  let p1 = 0, p2 = 0;
  for (let i = 0; i < len; i++) { const w = r(); p1 = 0.997 * p1 + 0.05 * w; p2 = 0.96 * p2 + 0.2 * w; n[i] = p1 + p2 * 0.6 + w * 0.15; }
  const out = new Float32Array(len);
  const formants = [[480, 3], [820, 4], [1250, 5], [2600, 6]];
  for (const [f, q] of formants) {
    const b = biquad(n.slice(), sr, 'bp', f, q);
    const ph = Math.abs(r()) * 6;
    for (let i = 0; i < len; i++) out[i] += b[i] * (0.6 + 0.4 * Math.sin(i / sr * (0.7 + f / 3000) + ph));
  }
  // claps
  for (let c = 0; c < seconds * 22; c++) {
    const t0 = Math.floor(Math.abs(r()) * (len - 2000));
    const a = 0.15 + Math.abs(r()) * 0.25;
    for (let i = 0; i < 600; i++) out[t0 + i] += r() * a * Math.exp(-i / 90);
  }
  biquad(out, sr, 'hp', 150);
  normalize(out, 0.7);
  return toBuffer(ctx, loopFade(out, fade), sr);
}

// one-shot effects
export function oneShot(ctx, kind) {
  const sr = ctx.sampleRate;
  const r = rngf(kind.length * 131 + kind.charCodeAt(0));
  const mk = (sec) => new Float32Array(Math.round(sec * sr));
  let x;
  switch (kind) {
    case 'thud': {
      x = mk(0.5);
      const crack = mk(0.5);
      for (let i = 0; i < x.length; i++) {
        const t = i / sr;
        x[i] = Math.sin(2 * Math.PI * (70 - 30 * t) * t) * Math.exp(-t * 11) * 0.9 + r() * Math.exp(-t * 35) * 0.6;
        crack[i] = r() * Math.exp(-t * 28);
      }
      biquad(x, sr, 'lp', 1400);
      // plastic/body crack in the mids so it is audible on small speakers
      biquad(crack, sr, 'bp', 650, 1.1);
      for (let i = 0; i < x.length; i++) x[i] += crack[i] * 1.8 + Math.sin(2 * Math.PI * 240 * i / sr) * Math.exp(-i / sr * 20) * 0.35;
      break;
    }
    case 'clank': {
      x = mk(0.6);
      const fs = [523, 811, 1247, 1873, 2611];
      for (let i = 0; i < x.length; i++) {
        const t = i / sr;
        let v = 0;
        fs.forEach((f, k) => (v += Math.sin(2 * Math.PI * f * t + k) * Math.exp(-t * (9 + k * 4)) / (k + 1)));
        x[i] = v * 0.7 + r() * Math.exp(-t * 60) * 0.5;
      }
      break;
    }
    case 'land': {
      x = mk(0.55);
      for (let i = 0; i < x.length; i++) {
        const t = i / sr;
        x[i] = Math.sin(2 * Math.PI * (55 - 20 * t) * t) * Math.exp(-t * 8) + r() * Math.exp(-t * 18) * 0.5 + Math.sin(2 * Math.PI * 340 * t) * Math.exp(-t * 25) * 0.45
          + Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 14) * 0.4;
      }
      biquad(x, sr, 'lp', 1300);
      break;
    }
    case 'splash': {
      x = mk(1.0);
      for (let i = 0; i < x.length; i++) {
        const t = i / sr;
        x[i] = r() * (Math.exp(-t * 4) * (t < 0.02 ? t / 0.02 : 1));
      }
      biquad(x, sr, 'bp', 1300, 0.5);
      // droplets
      for (let k = 0; k < 40; k++) {
        const t0 = Math.floor((0.05 + Math.abs(r()) * 0.7) * sr), f = 900 + Math.abs(r()) * 2500;
        for (let i = 0; i < 1400 && t0 + i < x.length; i++) x[t0 + i] += Math.sin(2 * Math.PI * f * (i / sr) * (1 + i / 3000)) * Math.exp(-i / 300) * 0.25;
      }
      break;
    }
    case 'nitro': {
      x = mk(1.3);
      let b = 0;
      for (let i = 0; i < x.length; i++) {
        const t = i / sr;
        b = b * 0.6 + r() * 0.4;
        const env = Math.min(1, t / 0.04) * Math.exp(-t * 1.6);
        x[i] = b * env;
      }
      // rising band
      const y = new Float32Array(x.length);
      let lp = 0, bp = 0;
      for (let i = 0; i < x.length; i++) {
        const f = 400 + 3200 * (i / x.length);
        const w = 2 * Math.sin(Math.PI * f / sr);
        lp += w * bp; const hp = x[i] - lp - 0.5 * bp; bp += w * hp;
        y[i] = bp;
      }
      x = y;
      for (let i = 0; i < x.length; i++) { const t = i / sr; x[i] += Math.sin(2 * Math.PI * (60 + t * 40) * t) * Math.exp(-t * 2.5) * 0.3; }
      break;
    }
    case 'pickup': {
      x = mk(0.55);
      const notes = [880, 1108.7, 1318.5, 1760];
      for (let i = 0; i < x.length; i++) {
        const t = i / sr;
        const k = Math.min(3, Math.floor(t / 0.06));
        const tn = t - k * 0.06;
        const f = notes[k];
        x[i] = (Math.sign(Math.sin(2 * Math.PI * f * t)) * 0.3 + Math.sin(2 * Math.PI * f * 2 * t) * 0.3) * Math.exp(-tn * 9) * (k === 3 ? Math.exp(-tn * 2) : 1);
      }
      biquad(x, sr, 'lp', 6000);
      break;
    }
    case 'cash': {
      x = mk(0.9);
      for (let i = 0; i < x.length; i++) {
        const t = i / sr;
        let v = r() * Math.exp(-t * 80) * 0.7;
        if (t > 0.07) { const u = t - 0.07; v += (Math.sin(2 * Math.PI * 2093 * u) + 0.6 * Math.sin(2 * Math.PI * 2637 * u) + 0.4 * Math.sin(2 * Math.PI * 3136 * u)) * Math.exp(-u * 5) * 0.35; }
        if (t > 0.16) { const u = t - 0.16; v += (Math.sin(2 * Math.PI * 2637 * u) + 0.5 * Math.sin(2 * Math.PI * 3951 * u)) * Math.exp(-u * 4) * 0.3; }
        x[i] = v;
      }
      break;
    }
    case 'beep': case 'go': case 'lap': {
      const f = kind === 'go' ? 1320 : kind === 'lap' ? 990 : 660;
      x = mk(kind === 'go' ? 0.9 : 0.3);
      for (let i = 0; i < x.length; i++) {
        const t = i / sr;
        const env = Math.min(1, t / 0.005) * (kind === 'go' ? Math.exp(-t * 2.2) : Math.exp(-t * 9));
        x[i] = (Math.sin(2 * Math.PI * f * t) * 0.6 + Math.sign(Math.sin(2 * Math.PI * f * t)) * 0.15) * env;
      }
      break;
    }
    case 'horn': {
      x = mk(1.4);
      for (let i = 0; i < x.length; i++) {
        const t = i / sr;
        const env = Math.min(1, t / 0.03) * (t > 1.1 ? Math.max(0, 1 - (t - 1.1) / 0.3) : 1);
        let v = 0;
        for (const f of [233, 294, 349]) for (let h = 1; h < 6; h++) v += Math.sin(2 * Math.PI * f * h * t) / (h * 1.3);
        x[i] = Math.tanh(v * 0.4) * env;
      }
      biquad(x, sr, 'lp', 3000);
      break;
    }
    case 'boom': {
      x = mk(1.6);
      let b = 0;
      for (let i = 0; i < x.length; i++) {
        const t = i / sr;
        b = b * 0.98 + r() * 0.2;
        x[i] = b * Math.exp(-t * 3) + Math.sin(2 * Math.PI * (45 - 15 * t) * t) * Math.exp(-t * 5) * 0.8;
      }
      biquad(x, sr, 'lp', 900);
      // crackle tail
      for (let k = 0; k < 60; k++) {
        const t0 = Math.floor((0.25 + Math.abs(r()) * 1.1) * sr);
        for (let i = 0; i < 200 && t0 + i < x.length; i++) x[t0 + i] += r() * Math.exp(-i / 30) * 0.25;
      }
      break;
    }
    case 'move': case 'ok': case 'back': case 'deny': {
      const f = { move: 1500, ok: 900, back: 600, deny: 180 }[kind];
      x = mk(kind === 'ok' ? 0.22 : 0.12);
      for (let i = 0; i < x.length; i++) {
        const t = i / sr;
        const ff = kind === 'ok' ? (t < 0.08 ? f : f * 1.5) : kind === 'back' ? f * (1 - t * 2) : f;
        const wave = kind === 'deny' ? Math.sign(Math.sin(2 * Math.PI * ff * t)) : Math.sin(2 * Math.PI * ff * t);
        x[i] = wave * Math.exp(-t * (kind === 'ok' ? 14 : 30)) * 0.5;
      }
      break;
    }
    default: x = mk(0.1);
  }
  normalize(x, 0.9);
  return toBuffer(ctx, x, sr);
}
