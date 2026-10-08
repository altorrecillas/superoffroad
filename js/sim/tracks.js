// Track definitions: the eight circuits of the 1989 arcade, re-imagined for a
// widescreen stadium. Coordinates in metres on the stadium floor: x to the
// right, z towards the camera (screen bottom). The arena is 132 x 82 m.
//
// path:    closed loop of corners [x, z, filletRadius, width?] (direction = race direction)
// start:   point on the path where the start/finish line is
// areas:   extra drivable polygons (open fields)
// islands: {poly} barrier-ringed islands inside areas, {circle:[x,z,r], prop} solid props
// terrain: height shapes (mound, pit, crater, plateau, ridge, wash, kicker, table, ramp)
// water:   puddles {x,z,rx,rz,rot} or {poly}
// decor:   cosmetic items (bunting across the track, hay bales, tyre stacks...)

import { roundRect } from './util.js';
import { TRACK_PAK } from './trackpak.js';

const R = Math.PI / 180;

export const TRACKS = [
  // 1 ------------------------------------------------------------------
  {
    id: 'fandango',
    name: 'Fandango',
    time: 'day',
    width: 9.5,
    path: [
      [55, 31, 10], [55, -31, 10], [17, -31, 8], [-17, 31, 8],
      [-55, 31, 10], [-55, -31, 10], [-17, -31, 8], [17, 31, 8],
    ],
    start: [36, 31],
    terrain: [
      // the hill: raised top-right section with ramps in and out
      { t: 'plateau', poly: roundRect(40, -32, 38, 15, 4), h: 2.2, edge: 10 },
      { t: 'mound', x: 40, z: -40, rx: 26, rz: 6, h: 2.5, offTrack: true },
      // moguls down the left side
      { t: 'mound', x: -55, z: -13, r: 3.4, h: 0.85 },
      { t: 'mound', x: -54, z: -3, r: 3.4, h: 0.85 },
      { t: 'mound', x: -56, z: 7, r: 3.4, h: 0.85 },
      // washboard on the right
      { t: 'wash', x: 55, z: 9, len: 16, wid: 9.5, rot: 90 * R, amp: 0.3, wl: 2.6 },
      // kicker on the top-left straight
      { t: 'kicker', x: -38, z: -31, len: 6, wid: 9.5, h: 1.3, rot: 0 },
      // infield
      { t: 'mound', x: -37, z: 1, r: 10, h: 2.6, offTrack: true },
      { t: 'mound', x: 37, z: 3, r: 9, h: 2.0, offTrack: true },
      { t: 'crater', x: -30, z: 15, r: 3, depth: 0.6, offTrack: true },
      { t: 'crater', x: 31, z: -12, r: 2.6, depth: 0.5, offTrack: true },
      { t: 'crater', x: 0, z: 22, r: 2.4, depth: 0.5, offTrack: true },
    ],
    water: [],
    decor: [
      { t: 'bunting', a: [-38, -36.5], b: [-38, -25.5] },
      { t: 'bales', pts: [[-12, 10], [12, 10]] },
    ],
  },
  // 2 ------------------------------------------------------------------
  {
    id: 'huevos',
    name: 'Huevos Grande',
    time: 'day',
    width: 9.5,
    path: [
      [56, 31, 10], [56, -31, 9],
      [32, -31, 6.5], [32, -4, 6.5], [12, -4, 6.5], [12, -31, 6.5],
      [-12, -31, 6.5], [-12, -4, 6.5], [-32, -4, 6.5], [-32, -31, 6.5],
      [-56, -31, 9], [-56, 31, 10],
    ],
    start: [-14, 31],
    terrain: [
      // the eggs: big humps on the bottom straight and the left side
      { t: 'mound', x: 16, z: 31, rx: 3.6, rz: 5, h: 1.25 },
      { t: 'mound', x: 30, z: 31, rx: 3.6, rz: 5, h: 1.35 },
      { t: 'mound', x: 44, z: 31, rx: 3.6, rz: 5, h: 1.25 },
      { t: 'mound', x: -56, z: 4, rx: 5, rz: 3.6, h: 1.2 },
      { t: 'mound', x: -56, z: -10, rx: 5, rz: 3.6, h: 1.2 },
      // ramp up the right side onto a shelf
      { t: 'plateau', poly: roundRect(56, -20, 16, 30, 4), h: 1.6, edge: 9 },
      // washboard in the first notch
      { t: 'wash', x: 32, z: -18, len: 14, wid: 9.5, rot: 90 * R, amp: 0.28, wl: 2.4 },
      // infield eggs (decor) and hills
      { t: 'mound', x: -20, z: 15, rx: 7, rz: 5, h: 2.2, offTrack: true },
      { t: 'mound', x: 2, z: 13, rx: 6, rz: 4.5, h: 1.8, offTrack: true },
      { t: 'mound', x: 24, z: 15, rx: 7, rz: 5, h: 2.4, offTrack: true },
      { t: 'mound', x: 44, z: 10, r: 5, h: 1.6, offTrack: true },
      { t: 'mound', x: -42, z: 12, r: 5, h: 1.5, offTrack: true },
      { t: 'mound', x: 22, z: -24, rx: 5, rz: 8, h: 2.8, offTrack: true },
      { t: 'mound', x: -22, z: -24, rx: 5, rz: 8, h: 2.8, offTrack: true },
    ],
    water: [
      { x: 22, z: -4, rx: 6, rz: 3.2, depth: 0.5 },
      { x: -22, z: -4, rx: 6, rz: 3.2, depth: 0.5 },
      { x: -45, z: -31, rx: 5, rz: 3, depth: 0.45 },
    ],
    decor: [],
  },
  // 3 ------------------------------------------------------------------
  {
    id: 'sidewinder',
    name: 'Sidewinder',
    time: 'sunset',
    width: 9.5,
    path: [
      [56, 30, 9], [56, -31, 9], [-56, -31, 8], [-56, -11, 8],
      [30, -11, 8], [30, 9, 8], [-56, 9, 8], [-56, 30, 8],
    ],
    start: [-22, 30],
    terrain: [
      // the snake: a long diagonal ridge crossing every lane
      { t: 'ridge', pts: [[-12, 40], [36, -40]], w: 5.5, h: 1.6 },
      // moguls on the third lane
      { t: 'mound', x: -24, z: 9, r: 3.2, h: 0.8 },
      { t: 'mound', x: -33, z: 7.5, r: 3.2, h: 0.8 },
      { t: 'mound', x: -42, z: 10, r: 3.2, h: 0.8 },
      // washboard on the bottom straight
      { t: 'wash', x: 36, z: 30, len: 14, wid: 9.5, rot: 0, amp: 0.3, wl: 2.5 },
      // ledge on the top lane
      { t: 'kicker', x: -24, z: -31, len: 6, wid: 9.5, h: 1.2, rot: 180 * R },
      { t: 'mound', x: -10, z: -21, rx: 14, rz: 3, h: 1.8, offTrack: true },
      { t: 'mound', x: -14, z: 19, rx: 16, rz: 3, h: 1.6, offTrack: true },
      { t: 'crater', x: 44, z: -1, r: 3.5, depth: 0.7, offTrack: true },
      { t: 'crater', x: 46, z: 18, r: 2.5, depth: 0.5, offTrack: true },
    ],
    water: [],
    decor: [],
  },
  // 4 ------------------------------------------------------------------
  {
    id: 'bigdukes',
    name: 'Big Dukes',
    time: 'day',
    width: 9.5,
    path: [
      [56, 31, 9], [56, -31, 9], [-56, -31, 9], [-56, -3, 8],
      [20, -3, 7], [20, 14, 7], [-34, 14, 7], [-34, 31, 7],
    ],
    start: [-6, 31],
    terrain: [
      // the dukes: three big pyramids on the top straight
      { t: 'mound', x: -30, z: -31, rx: 4.2, rz: 6, h: 1.7, p: 0.8 },
      { t: 'mound', x: 0, z: -31, rx: 4.2, rz: 6, h: 1.9, p: 0.8 },
      { t: 'mound', x: 30, z: -31, rx: 4.2, rz: 6, h: 1.7, p: 0.8 },
      // the pit in the middle lane: drop in, splash, climb out
      { t: 'pit', x: -12, z: -3, rx: 9, rz: 7, depth: 1.5 },
      // raised shelf on the right side
      { t: 'plateau', poly: roundRect(56, 6, 14, 22, 4), h: 1.5, edge: 8 },
      // infield pyramids
      { t: 'mound', x: -46, z: 18, rx: 5, rz: 5, h: 3.2, p: 0.6, offTrack: true },
      { t: 'mound', x: 38, z: 12, rx: 6, rz: 6, h: 3.5, p: 0.6, offTrack: true },
      { t: 'mound', x: 38, z: -17, rx: 6, rz: 6, h: 3.0, p: 0.6, offTrack: true },
      { t: 'mound', x: -40, z: -17, rx: 6, rz: 6, h: 3.0, p: 0.6, offTrack: true },
      { t: 'mound', x: 0, z: -17, rx: 6, rz: 5, h: 2.5, p: 0.6, offTrack: true },
      { t: 'crater', x: -10, z: 23, r: 3, depth: 0.6, offTrack: true },
    ],
    water: [{ x: -12, z: -3, rx: 5.5, rz: 4, depth: 0.35, wobble: 0.15 }],
    decor: [],
  },
  // 5 ------------------------------------------------------------------
  {
    id: 'blaster',
    name: 'Blaster',
    time: 'sunset',
    width: 9.5,
    path: [
      [-55, -31, 9], [55, -31, 9], [55, -9, 8], [-30, -9, 8],
      [-30, 11, 8], [55, 11, 8], [55, 31, 9], [-55, 31, 9],
    ],
    start: [-55, 8],
    terrain: [
      // the blaster: a huge diagonal ridge, every crossing is a jump
      { t: 'ridge', pts: [[-26, 44], [26, -44]], w: 9, h: 1.75, profile: 'table' },
      // washboard up the left side
      { t: 'wash', x: -55, z: -8, len: 18, wid: 9.5, rot: 90 * R, amp: 0.3, wl: 2.6 },
      // moguls on the right
      { t: 'mound', x: 55, z: 22, r: 3.4, h: 0.85 },
      { t: 'mound', x: 41, z: 11, r: 3.4, h: 0.8 },
      { t: 'mound', x: 55, z: -21, r: 3.4, h: 0.85 },
      { t: 'mound', x: -44, z: 1, rx: 6, rz: 4, h: 1.6, offTrack: true },
      { t: 'mound', x: 28, z: 1, rx: 14, rz: 3, h: 1.4, offTrack: true },
      { t: 'mound', x: 20, z: -20, rx: 12, rz: 3.5, h: 1.6, offTrack: true },
      { t: 'mound', x: -22, z: 21, rx: 12, rz: 3.5, h: 1.6, offTrack: true },
    ],
    water: [],
    decor: [
      { t: 'bunting', a: [18.3, -36.5], b: [18.3, -25.5] },
      { t: 'bunting', a: [5.3, -14.5], b: [5.3, -3.5] },
      { t: 'bunting', a: [-6.5, 5.5], b: [-6.5, 16.5] },
      { t: 'bunting', a: [-18.3, 25.5], b: [-18.3, 36.5] },
    ],
  },
  // 6 ------------------------------------------------------------------
  {
    id: 'hurricane',
    name: 'Hurricane Gulch',
    time: 'night',
    width: 9.5,
    path: [
      [56, 31, 9], [56, -31, 9], [-56, -31, 9], [-56, 13, 8],
      [26, 13, 8], [26, -13, 8], [-30, -13, 8], [-30, 31, 8],
    ],
    start: [-4, 31],
    terrain: [
      // the eye of the hurricane: a big hill in the middle of the spiral
      { t: 'mound', x: -2, z: 0, rx: 20, rz: 8, h: 3.4, offTrack: true },
      // the gulch: a stream bed from the top wall into the eye
      { t: 'ridge', pts: [[2, -44], [1, -22], [-2, -6]], w: 4.5, h: -0.6 },
      // ramps and bumps
      { t: 'table', x: 56, z: 0, len: 16, wid: 9.5, h: 1.5, rot: -90 * R, up: 5, down: 5 },
      { t: 'mound', x: -56, z: -12, r: 3.3, h: 0.8 },
      { t: 'mound', x: -56, z: -2, r: 3.3, h: 0.8 },
      { t: 'wash', x: -8, z: 13, len: 14, wid: 9.5, rot: 0, amp: 0.28, wl: 2.4 },
      { t: 'mound', x: -46, z: 24, r: 6, h: 2, offTrack: true },
      { t: 'mound', x: 42, z: 2, rx: 6, rz: 12, h: 2.4, offTrack: true },
      { t: 'crater', x: 14, z: 23, r: 3, depth: 0.6, offTrack: true },
      { t: 'crater', x: -44, z: -6, r: 2.6, depth: 0.5, offTrack: true },
    ],
    water: [
      { poly: [[-1.5, -38], [4.5, -38], [4.2, -24], [3.0, -18], [1.5, -10], [-4.5, -8], [-3, -18], [-2.2, -26]], depth: 0.4 },
    ],
    decor: [],
  },
  // 7 ------------------------------------------------------------------
  {
    id: 'cliffhanger',
    name: 'Cliffhanger',
    time: 'day',
    width: 11,
    path: [
      [53, 29, 10], [53, -17, 12], [41, -28, 10], [-53, -29, 10], [-53, 17, 12], [-41, 28, 10],
    ],
    start: [6, 28.6],
    areas: [{ poly: roundRect(0, 0, 118, 72, 12) }],
    islands: [
      // the zig-zag island in the middle
      { poly: [[-34, -4], [-24, -10], [-14, -4], [-4, -10], [6, -4], [16, -10], [26, -4], [34, -4], [34, 4], [26, 10], [16, 4], [6, 10], [-4, 4], [-14, 10], [-24, 4], [-34, 4]] },
      // small barrier islands that force wide corners
      { poly: roundRect(43, 20, 8, 8, 2.5) },
      { poly: roundRect(-43, -20, 8, 8, 2.5) },
      // the giant oil drums
      { circle: [-6, -20, 2.3], prop: 'drum' },
      { circle: [8, 20, 2.3], prop: 'drum' },
      { circle: [-44, 14, 2.3], prop: 'drum' },
      { circle: [44, -14, 2.3], prop: 'drum' },
    ],
    terrain: [
      // the cliffs: two raised shelves with steep ramps, you fly off the far edge
      { t: 'table', x: 10, z: -25, len: 44, wid: 22, h: 1.8, rot: Math.PI, up: 8, down: 3.5, dir: true },
      { t: 'table', x: -12, z: 25, len: 44, wid: 22, h: 1.6, rot: 0, up: 8, down: 3.5, dir: true },
      { t: 'mound', x: 54, z: 6, r: 3.5, h: 0.8 },
      { t: 'mound', x: -54, z: -6, r: 3.5, h: 0.8 },
    ],
    water: [{ x: 53, z: -4, rx: 4, rz: 5, depth: 0.4 }],
    decor: [],
  },
  // 8 ------------------------------------------------------------------
  {
    id: 'wipeout',
    name: 'Wipeout',
    time: 'night',
    width: 9.5,
    path: [
      [56, 31, 9], [56, -31, 9], [24, -31, 8], [-12, 12, 8],
      [-56, 12, 8], [-56, -31, 9], [-24, -31, 8], [12, 31, 8],
    ],
    start: [36, 31],
    areas: [{ poly: roundRect(6, -4, 30, 26, 6) }],
    terrain: [
      // the wipeout field: bumps and puddles where the lanes cross
      { t: 'mound', x: 0, z: -6, r: 3, h: 0.7 },
      { t: 'mound', x: 12, z: -12, r: 3, h: 0.7 },
      { t: 'mound', x: 10, z: 4, r: 3, h: 0.7 },
      { t: 'mound', x: -2, z: 6, r: 2.8, h: 0.6 },
      // elevated top-left with a drop
      { t: 'plateau', poly: roundRect(-44, -33, 34, 15, 4), h: 2.0, edge: 9 },
      { t: 'kicker', x: -26, z: -31, len: 5, wid: 9.5, h: 0.8, rot: 0 },
      // washboard down the left side
      { t: 'wash', x: -56, z: -8, len: 16, wid: 9.5, rot: 90 * R, amp: 0.3, wl: 2.5 },
      // big humps on the right side
      { t: 'mound', x: 56, z: 8, rx: 5, rz: 3.8, h: 1.2 },
      { t: 'mound', x: 56, z: -8, rx: 5, rz: 3.8, h: 1.2 },
      { t: 'mound', x: 38, z: 8, r: 7, h: 2.2, offTrack: true },
      { t: 'mound', x: -36, z: 24, r: 6, h: 1.8, offTrack: true },
      { t: 'crater', x: -36, z: -10, r: 3, depth: 0.6, offTrack: true },
    ],
    water: [
      { x: 4, z: -15, rx: 4.5, rz: 2.6, rot: 20 * R, depth: 0.4 },
      { x: 18, z: 0, rx: 3.6, rz: 3, depth: 0.4 },
      { x: -8, z: 0, rx: 3.6, rz: 2.6, rot: -30 * R, depth: 0.4 },
      { x: -56, z: -20, rx: 3, rz: 5, depth: 0.4 },
    ],
    decor: [],
  },
];

// the Track Pak circuits join the list (TRACKS = the 8 originals + the 8 of the expansion)
TRACKS.push(...TRACK_PAK);

export function trackById(id) {
  return TRACKS.find((t) => t.id === id);
}

// race order of the season (forward / reverse), like the arcade's rotation
export const SEASON_CLASSIC = [
  ['fandango', false], ['huevos', false], ['fandango', true], ['bigdukes', false],
  ['sidewinder', false], ['huevos', true], ['wipeout', false], ['bigdukes', true],
  ['hurricane', false], ['sidewinder', true], ['cliffhanger', false], ['blaster', false],
  ['wipeout', true], ['hurricane', true], ['cliffhanger', true], ['blaster', true],
];

export const SEASON_PAK = [
  ['redoubt', false], ['riotrio', false], ['leapin', false], ['redoubt', true],
  ['boulder', false], ['cutoff', false], ['riotrio', true], ['shortcut', false],
  ['leapin', true], ['pigbog', false], ['boulder', true], ['volcano', false],
  ['cutoff', true], ['shortcut', true], ['pigbog', true], ['volcano', true],
];
// both packs: the originals first, the expansion tracks joining from race 5
export const SEASON_ALL = [
  ...SEASON_CLASSIC.slice(0, 4), ...SEASON_PAK.slice(0, 2), ...SEASON_CLASSIC.slice(4, 8), ...SEASON_PAK.slice(2, 6),
  ...SEASON_CLASSIC.slice(8, 12), ...SEASON_PAK.slice(6, 10), ...SEASON_CLASSIC.slice(12), ...SEASON_PAK.slice(10),
];
export const SEASONS = { classic: SEASON_CLASSIC, pak: SEASON_PAK, all: SEASON_ALL };
export const SEASON = SEASON_ALL;
