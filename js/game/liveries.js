// Paint jobs for the players' trucks, chosen in Ironman's garage. Each one is won
// with an achievement; 'team' (the truck's own colours) is always there.
// finish: how the body paint reflects (gloss, metal, matte, pearl, chrome)

import { truckDef } from './drivers.js';

export const LIVERIES = [
  { id: 'team', name: 'De equipo', finish: 'gloss' },
  { id: 'carbon', name: 'Carbono', color: 0x1b1c1f, accent: 0xd8261c, helmet: 0xd8261c, finish: 'matte', unlock: 'win1' },
  { id: 'clean', name: 'Inmaculado', color: 0xf2f1ec, accent: 0x9aa3ad, helmet: 0x1f6fd0, finish: 'pearl', unlock: 'clean' },
  { id: 'neon', name: 'Neón', color: 0x9dff2a, accent: 0xff2fa8, helmet: 0x111111, finish: 'gloss', unlock: 'air' },
  { id: 'fire', name: 'Fuego', color: 0xff5a14, accent: 0xffd21f, helmet: 0x161616, finish: 'gloss', unlock: 'streak3' },
  { id: 'night', name: 'Medianoche', color: 0x10235a, accent: 0x22d3ff, helmet: 0x22d3ff, finish: 'metal', unlock: 'night' },
  { id: 'money', name: 'Millonario', color: 0x1f7a3a, accent: 0xffcf3a, helmet: 0xffcf3a, finish: 'metal', unlock: 'million' },
  { id: 'iron', name: 'Plata Ironman', color: 0xc9ced6, accent: 0x161616, helmet: 0xd81f1f, finish: 'metal', unlock: 'expert' },
  { id: 'retro', name: 'Recreativa 1989', color: 0xf4f2ec, accent: 0x1747c4, helmet: 0xd81f1f, finish: 'gloss', unlock: 'arcade' },
  { id: 'mech', name: 'Mecánico', color: 0xff8a1f, accent: 0x3a3d42, helmet: 0x3a3d42, finish: 'matte', unlock: 'maxed' },
  { id: 'gold', name: 'Oro', color: 0xffc23a, accent: 0x161616, helmet: 0x161616, finish: 'chrome', unlock: 'gold' },
  { id: 'champ', name: 'Campeón', color: 0xf7f4ea, accent: 0xd9a816, helmet: 0xd9a816, finish: 'pearl', unlock: 'cup' },
  { id: 'bolt', name: 'Rayo', color: 0x161616, accent: 0xc8ff1a, helmet: 0xc8ff1a, finish: 'metal', unlock: 'daily7' },
  { id: 'chrome', name: 'Espejo', color: 0xe6ebf0, accent: 0x1b1c1f, helmet: 0x1b1c1f, finish: 'chrome', unlock: 'gold8' },
];

export const liveryById = (id) => LIVERIES.find((l) => l.id === id) || LIVERIES[0];

// the colours a truck is drawn with: its own, or the paint job's
export function paintOf(truckId, liveryId) {
  const d = truckDef(truckId) || truckDef('red'), l = liveryById(liveryId);
  if (!l.color) return { color: d.color, accent: d.accent, helmet: d.helmet, number: d.number, finish: l.finish, css: d.css };
  return { color: l.color, accent: l.accent, helmet: l.helmet, number: d.number, finish: l.finish, css: '#' + l.color.toString(16).padStart(6, '0') };
}
