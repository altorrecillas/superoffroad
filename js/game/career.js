// Achievements and career statistics, kept in the browser. The game reports what
// happens (races, jumps, medals, photos...) and is told about every achievement it
// unlocks, so it can celebrate it.

const LS_A = 'sor.achievements.v1';
const LS_S = 'sor.stats.v1';

// goal(stats, extra) -> [value, target] for the ones with a progress bar
export const ACHIEVEMENTS = [
  { id: 'school', name: 'Escuela de pilotos', desc: 'Completa el tutorial.', icon: 'helmet' },
  { id: 'win1', name: 'Primera victoria', desc: 'Gana una carrera.', icon: 'trophy' },
  { id: 'podium10', name: 'Habitual del podio', desc: 'Sube al podio 10 veces.', icon: 'podium', goal: (s) => [s.podiums, 10] },
  { id: 'win25', name: 'Leyenda del barro', desc: 'Gana 25 carreras.', icon: 'trophy', goal: (s) => [s.wins, 25] },
  { id: 'streak3', name: 'Imparable', desc: 'Gana 3 carreras seguidas en un campeonato.', icon: 'flame' },
  { id: 'comeback', name: 'Remontada', desc: 'Gana una carrera en la que ibas último en la última vuelta.', icon: 'rise' },
  { id: 'nonitro', name: 'A pelo', desc: 'Gana una carrera sin usar el nitro.', icon: 'nonitro' },
  { id: 'clean', name: 'Conducción limpia', desc: 'Termina una carrera sin tocar las vallas.', icon: 'shield' },
  { id: 'air', name: 'Vuelo sin motor', desc: 'Pasa 0,7 segundos en el aire en un salto.', icon: 'jump' },
  { id: 'bags', name: 'Cazador de bolsas', desc: 'Recoge $100.000 en bolsas en una carrera.', icon: 'money' },
  { id: 'million', name: 'Millonario', desc: 'Gana $1.000.000 en una partida.', icon: 'money' },
  { id: 'maxed', name: 'Camión de fábrica', desc: 'Lleva las cuatro piezas del taller al máximo.', icon: 'wrench' },
  { id: 'buggy', name: 'Ligero y rápido', desc: 'Gana una carrera con el buggy.', icon: 'buggy' },
  { id: 'night', name: 'Bajo los focos', desc: 'Gana una carrera de noche.', icon: 'moon' },
  { id: 'expert', name: 'Ironman derrotado', desc: 'Gana una carrera en Experto.', icon: 'helmet' },
  { id: 'arcade', name: 'Como en 1989', desc: 'Gana una carrera en Arcade.', icon: 'coin' },
  { id: 'cup', name: 'Campeón de copa', desc: 'Gana una copa del campeonato.', icon: 'cup' },
  { id: 'gold', name: 'Oro', desc: 'Gana una medalla de oro en la contrarreloj.', icon: 'medal' },
  { id: 'gold8', name: 'Coleccionista', desc: 'Consigue 8 medallas de oro.', icon: 'medal', goal: (s, x) => [x.golds || 0, 8] },
  { id: 'tracks16', name: 'Trotamundos', desc: 'Corre en los 16 circuitos.', icon: 'map', goal: (s) => [s.tracks.length, 16] },
  { id: 'km100', name: 'Kilómetros de barro', desc: 'Recorre 100 km en carrera.', icon: 'road', goal: (s) => [Math.floor(s.km), 100] },
  { id: 'daily', name: 'Reto del día', desc: 'Gana una medalla en el desafío del día.', icon: 'flame' },
  { id: 'daily7', name: 'Constancia', desc: 'Gana medalla en 7 desafíos del día.', icon: 'flame', goal: (s) => [s.dailyMedals || 0, 7] },
  { id: 'photo', name: 'Fotógrafo', desc: 'Haz una foto en el modo foto de la repetición.', icon: 'camera' },
  { id: 'replay', name: 'Realizador', desc: 'Mira la repetición de una carrera.', icon: 'film' },
  { id: 'party', name: 'Pique entre amigos', desc: 'Juega una carrera a dos o tres jugadores.', icon: 'people' },
];

const STATS0 = () => ({ races: 0, wins: 0, podiums: 0, km: 0, jumps: 0, bestAir: 0, nitros: 0, bags: 0, bestScore: 0, tracks: [], trials: 0, photos: 0, replays: 0, cups: 0 });

function load(key, def) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' ? v : def; } catch (e) { return def; }
}

export class Career {
  constructor(onUnlock = () => {}) {
    this.onUnlock = onUnlock;
    this.got = load(LS_A, {});
    this.stats = Object.assign(STATS0(), load(LS_S, {}));
    if (!Array.isArray(this.stats.tracks)) this.stats.tracks = [];
  }

  _save() {
    try {
      localStorage.setItem(LS_A, JSON.stringify(this.got));
      localStorage.setItem(LS_S, JSON.stringify(this.stats));
    } catch (e) { /* storage unavailable */ }
  }

  has(id) { return !!this.got[id]; }
  get count() { return ACHIEVEMENTS.filter((a) => this.got[a.id]).length; }

  unlock(id) {
    if (this.got[id] || !ACHIEVEMENTS.some((a) => a.id === id)) return false;
    this.got[id] = Date.now();
    this._save();
    this.onUnlock(ACHIEVEMENTS.find((a) => a.id === id));
    return true;
  }

  // progress of the counting ones (extra: values the career does not keep, like golds)
  progress(a, extra = {}) { return a.goal ? a.goal(this.stats, extra) : null; }
  _goals(extra) {
    for (const a of ACHIEVEMENTS) {
      if (!a.goal || this.got[a.id]) continue;
      const [v, n] = a.goal(this.stats, extra);
      if (v >= n) this.unlock(a.id);
    }
  }

  // a jump of the player (air time in seconds)
  jump(air) {
    this.stats.jumps++;
    if (air > this.stats.bestAir) this.stats.bestAir = Math.round(air * 100) / 100;
    if (air >= 0.7) this.unlock('air');
  }

  // a finished race (not a time trial). r: { place, field, finished, humans, difficulty,
  // vehicle, night, nitro, walls, bags, lastInFinal, track, km, streak, free }
  race(r) {
    const s = this.stats;
    s.races++;
    s.km = Math.round((s.km + Math.max(0, r.km || 0)) * 1000) / 1000;
    s.nitros += r.nitro || 0;
    s.bags += r.bags || 0;
    if (r.track && !s.tracks.includes(r.track)) s.tracks.push(r.track);
    const win = r.place === 1 && r.finished;
    if (win) s.wins++;
    if (r.place <= 3 && r.finished) s.podiums++;
    this._save();
    if (r.humans > 1) this.unlock('party');
    if (r.finished && r.walls === 0) this.unlock('clean');
    if ((r.bags || 0) >= 100000) this.unlock('bags');
    if (win) {
      this.unlock('win1');
      if (!r.nitro) this.unlock('nonitro');
      if (r.lastInFinal) this.unlock('comeback');
      if (r.vehicle === 'buggy') this.unlock('buggy');
      if (r.night) this.unlock('night');
      if (r.difficulty === 'hard') this.unlock('expert');
      if (r.difficulty === 'arcade') this.unlock('arcade');
      if (!r.free && r.streak >= 3) this.unlock('streak3');
    }
    this._goals({});
  }

  trial({ medal, golds }) {
    this.stats.trials++;
    this._save();
    if (medal === 'gold') this.unlock('gold');
    this._goals({ golds });
  }

  score(earned) {
    if (earned > this.stats.bestScore) { this.stats.bestScore = earned; this._save(); }
    if (earned >= 1000000) this.unlock('million');
  }

  daily({ medal, medals }) {
    if (medals > (this.stats.dailyMedals || 0)) { this.stats.dailyMedals = medals; this._save(); }
    if (medal) this.unlock('daily');
    this._goals({});
  }

  cup(won) { if (won) { this.stats.cups++; this._save(); this.unlock('cup'); } }
  photo() { this.stats.photos++; this._save(); this.unlock('photo'); }
  replay() { this.stats.replays++; this._save(); this.unlock('replay'); }
  maxed() { this.unlock('maxed'); }
}
