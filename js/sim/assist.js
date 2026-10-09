// Steering assist (Options → DIRECCIÓN ASISTIDA), mostly for touch screens. It works
// on the player's input before the simulation sees it, so replays just store the result.
//  soft:   hands off the steering, the truck follows the track a little on its own,
//          and heading into a barrier it is pulled back towards the racing line
//  strong: it follows the racing line hands-off, lifts off the throttle before the
//          tight corners and pulls harder away from the barriers
// The player always wins: steering away from the barrier, or harder in the right
// direction, is never reduced.

import { AIDriver } from './ai.js';
import { WALL_FACE } from './track.js';
import { clamp } from './util.js';

export const ASSIST_LEVELS = { off: 0, soft: 1, strong: 2 };

export class SteerAssist {
  constructor(truck, track, level) {
    this.t = truck;
    this.track = track;
    this.level = typeof level === 'number' ? level : (ASSIST_LEVELS[level] ?? 0);
    this.ai = new AIDriver(truck, track, { skill: 0.9, aggression: 0, assist: true, noWander: true, seed: 5 });
    this.out = { steer: 0, throttle: 0, brake: 0, nitro: false };
    this.help = 0; // how much it is steering for the player right now (0..1), for the HUD
  }

  apply(dt, u) {
    const o = this.out, t = this.t;
    o.steer = u.steer; o.throttle = u.throttle; o.brake = u.brake; o.nitro = u.nitro;
    this.help = 0;
    if (this.level <= 0 || t.frozen) return o;
    const a = this.ai.update(dt, null);
    if (t.air || t.vf < 3) return o; // in the air, stopped or reversing: all the player's
    const strong = this.level >= 2;
    const before = o.steer;
    // hands off while driving: follow the track
    if (Math.abs(u.steer) < 0.08 && u.throttle > 0) o.steer = a.steer * (strong ? 0.85 : 0.35);
    // a barrier ahead where the truck is heading: blend towards the line
    const look = clamp(0.3 + t.speed * 0.014, 0.3, 0.7); // seconds
    const d = this.track.sdfAt(t.x + t.vx * look, t.z + t.vz * look) - WALL_FACE; // > 0: inside the barrier
    const danger = clamp((d + 2.4) / 2.4, 0, 1);
    if (danger > 0) {
      const away = Math.sign(o.steer) === Math.sign(a.steer) && Math.abs(o.steer) >= Math.abs(a.steer);
      if (!away) o.steer += (a.steer - o.steer) * danger * (strong ? 0.9 : 0.5);
    }
    // strong: lift before the corners the truck would not make
    if (strong && u.throttle > 0 && a.brake > 0.2) o.throttle = Math.min(o.throttle, a.brake > 0.5 ? 0 : 0.35);
    o.steer = clamp(o.steer, -1, 1);
    this.help = Math.min(1, Math.abs(o.steer - before) + (o.throttle < u.throttle ? 0.5 : 0));
    return o;
  }
}
