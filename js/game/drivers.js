// The four trucks of the arcade cabinet and their CPU drivers.
// In the 1989 original the red, blue and yellow CPU trucks were "driven" by
// Leland staff members, and the grey truck was always Ivan "Ironman" Stewart.

export const TRUCKS = [
  { id: 'red', name: 'Rojo', color: 0xc81d18, accent: 0xf4f4f4, helmet: 0xf4f4f4, number: 2, css: '#e3261f',
    cpu: { name: '"Madman" Sam Powell', short: 'MADMAN', skill: 0.82, aggression: 0.75, bias: -0.7 } },
  { id: 'blue', name: 'Azul', color: 0x1747c4, accent: 0xf4f4f4, helmet: 0xffd21f, number: 3, css: '#2a63f0',
    cpu: { name: '"Hurricane" Earl Stratton', short: 'HURRICANE', skill: 0.8, aggression: 0.55, bias: 0.8 } },
  { id: 'yellow', name: 'Amarillo', color: 0xf0b40a, accent: 0x161616, helmet: 0x161616, number: 4, css: '#f7c21b',
    cpu: { name: '"Jammin\'" John Morgan', short: 'JAMMIN', skill: 0.76, aggression: 0.65, bias: 0 } },
  { id: 'grey', name: 'Gris', color: 0xaeb5bd, accent: 0x1a1a1a, helmet: 0xd81f1f, number: 1, css: '#b9c1ca',
    cpu: { name: 'Ivan "Ironman" Stewart', short: 'IRONMAN', skill: 0.95, aggression: 0.85, bias: 0.3, ironman: true } },
];

export const PLAYER_TRUCKS = ['red', 'blue', 'yellow'];
export const truckDef = (id) => TRUCKS.find((t) => t.id === id);
