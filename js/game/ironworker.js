// Ironman's time for a time trial, off the main thread (building a circuit takes a
// moment on a phone): { id, reverse, vehicle, laps, nitros } -> { t } or null
import { buildTrack } from '../sim/track.js';
import { trackById } from '../sim/tracks.js';
import { ironmanRun } from './medals.js';

self.onmessage = (e) => {
  const c = e.data;
  let out = null;
  try {
    const run = ironmanRun(buildTrack(trackById(c.id), { reverse: c.reverse }), c.vehicle, c.laps, undefined, c.nitros, c.rain);
    out = run ? { t: run.t } : null;
  } catch (err) { out = null; }
  self.postMessage(out);
};
