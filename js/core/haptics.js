// Haptic feedback for the player's own knocks: gamepad rumble (dual-rumble) or
// phone vibration (Android). Short pulses with a cooldown so it never buzzes.

export class Haptics {
  constructor(input, opt) {
    this.input = input;
    this.opt = opt;
    this.next = [0, 0, 0];
  }

  pulse(player, ms, strength = 1) {
    if (this.opt.haptics === false) return;
    const now = performance.now();
    if (now < this.next[player]) return;
    this.next[player] = now + ms + 60;
    const k = Math.max(0, Math.min(1, strength));
    const pad = this.input.padOf(player);
    if (pad && pad.vibrationActuator && pad.vibrationActuator.playEffect) {
      pad.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: k, weakMagnitude: Math.min(1, 0.3 + k * 0.7) }).catch(() => {});
    } else if (player === 0 && this.input.touch && this.input.touch.active && navigator.vibrate) {
      try { navigator.vibrate(Math.round(ms * (0.5 + 0.5 * k))); } catch (e) { /* not allowed */ }
    }
  }

  // race events -> pulses for the human trucks
  handle(events, race) {
    const who = (i) => { const r = race.racers[i]; return r && r.human && !r.finished ? r.entry.player : -1; };
    for (const ev of events) {
      switch (ev[0]) {
        case 'go': for (const r of race.racers) if (r.human) this.pulse(r.entry.player, 70, 0.6); break;
        case 'wall': { const p = who(ev[1]); if (p >= 0 && ev[2] > 5) this.pulse(p, Math.min(90, 20 + ev[2] * 4), ev[2] / 14); break; }
        case 'bump': for (const i of [ev[1], ev[2]]) { const p = who(i); if (p >= 0 && ev[3] > 3.5) this.pulse(p, 40, ev[3] / 12); } break;
        case 'land': { const p = who(ev[1]); if (p >= 0 && ev[2] > 7) this.pulse(p, 45, (ev[2] - 6) / 10); break; }
        case 'nitro': { const p = who(ev[1]); if (p >= 0) this.pulse(p, 90, 0.3); break; }
      }
    }
  }
}
