// Renders the synthesized sounds to WAV files for inspection: node tools/test/audiocheck.mjs <outDir>
import fs from 'fs';
import { engineLoop, noiseLoop, crowdLoop, oneShot } from '../../js/audio/synth.js';
const out = process.argv[2] || '.';
const ctx = {
  sampleRate: 44100,
  createBuffer(ch, len, sr) { const d = new Float32Array(len); return { length: len, sampleRate: sr, duration: len / sr, copyToChannel(src) { d.set(src); }, data: d }; },
};
function wav(file, data, sr) {
  const n = data.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(data[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, buf);
}
const stats = (name, b) => {
  const d = b.data; let peak = 0, rms = 0, nan = 0;
  for (const v of d) { if (Number.isNaN(v)) nan++; peak = Math.max(peak, Math.abs(v)); rms += v * v; }
  rms = Math.sqrt(rms / d.length);
  console.log(name.padEnd(12), 'dur', b.duration.toFixed(2), 'peak', peak.toFixed(2), 'rms', rms.toFixed(3), nan ? 'NaN!' : '');
  wav(`${out}/${name}.wav`, d, b.sampleRate);
};
[1000, 2800, 5200].forEach((r, i) => stats('eng' + i, engineLoop(ctx, r, 7)));
[1000, 2800, 5200].forEach((r, i) => stats('beng' + i, engineLoop(ctx, r * 1.3, 11, 'flat4')));
for (const k of ['skid', 'roll', 'water', 'flame']) stats(k, noiseLoop(ctx, k));
stats('crowd', crowdLoop(ctx));
for (const k of ['thud', 'clank', 'land', 'splash', 'nitro', 'pickup', 'cash', 'beep', 'go', 'lap', 'horn', 'boom', 'move', 'ok', 'back', 'deny']) stats(k, oneShot(ctx, k));
