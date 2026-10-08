// The 1989 "Track Pak" expansion: eight more circuits, re-imagined like the
// originals. Same definition format as tracks.js.

import { roundRect } from './util.js';

const R = Math.PI / 180;

export const TRACK_PAK = [
  // 9 ------------------------------------------------------------------
  {
    id: 'redoubt',
    name: 'Redoubt About',
    pak: true,
    time: 'day',
    width: 9.5,
    path: [
      [-50, 31, 14], [-50, -31, 14], [30, -31, 9], [30, -12, 8], [-24, -12, 8], [-24, 8, 8], [52, 8, 9], [52, 31, 9],
    ],
    start: [6, 31],
    terrain: [
      // the big banked "C" on the left: the lane leans towards the outside
      { t: 'bank', pts: [[-45.2, 16], [-45.2, -16]], w: 9.5, h: 1.5, side: -1, fall: 5, taper: 12, onTrack: true },
      { t: 'bank', pts: [[-30, -26.2], [16, -26.2]], w: 9.5, h: 1.2, side: 1, fall: 5, taper: 10, onTrack: true },
      { t: 'bank', pts: [[36, 12.8], [-8, 12.8]], w: 9.5, h: 1.1, side: -1, fall: 4, taper: 10, onTrack: true },
      // berms in the infield (the "redoubts")
      { t: 'ridge', pts: [[-36, 22], [-36, -20], [-30, -24]], w: 4, h: 1.8, offTrack: true },
      { t: 'ridge', pts: [[-10, -2], [16, -2], [20, 2]], w: 3.5, h: 1.5, offTrack: true },
      { t: 'mound', x: 40, z: -20, r: 7, h: 2.2, offTrack: true },
      { t: 'mound', x: 2, z: 22, rx: 12, rz: 4, h: 1.6, offTrack: true },
      { t: 'wash', x: 0, z: 8, len: 14, wid: 9.5, rot: 0, amp: 0.28, wl: 2.5 },
    ],
    water: [],
    decor: [],
  },
  // 10 -----------------------------------------------------------------
  {
    id: 'riotrio',
    name: 'Rio Trio',
    pak: true,
    time: 'sunset',
    width: 9.5,
    path: [
      [-54, 31, 9], [-54, -6, 9], [-30, -6, 8], [-30, -31, 9], [54, -31, 9], [54, -8, 9], [20, -8, 8], [20, 31, 9],
    ],
    start: [0, 31],
    terrain: [
      { t: 'mound', x: -14, z: -18, rx: 9, rz: 4, h: 1.8, offTrack: true },
      { t: 'mound', x: 36, z: -18, rx: 8, rz: 4, h: 1.4, offTrack: true },
      { t: 'kicker', x: 0, z: -31, len: 6, wid: 9.5, h: 1.2, rot: 0 },
      { t: 'mound', x: -54, z: -20, rx: 4.5, rz: 3.4, h: 0.9 },
    ],
    water: [
      // the three rivers/lakes
      { x: -47, z: -24, rx: 10, rz: 8, depth: 0.9, wobble: 0.2 },
      { x: 42, z: 17, rx: 13, rz: 15, depth: 1.0, wobble: 0.18 },
      { x: -10, z: 12, rx: 15, rz: 9, depth: 0.9, wobble: 0.2 },
      // shallow fords on the track
      { x: -54, z: 13, rx: 4, rz: 6, depth: 0.35 },
      { x: 20, z: 13, rx: 4, rz: 5, depth: 0.35 },
      { x: 30, z: -31, rx: 5, rz: 3.5, depth: 0.35 },
    ],
    decor: [],
  },
  // 11 -----------------------------------------------------------------
  {
    id: 'leapin',
    name: "Leapin' Lizards",
    pak: true,
    time: 'day',
    width: 9.5,
    path: [
      [54, 31, 9], [54, -31, 9], [-14, -31, 9], [-54, -2, 10], [-54, 31, 9],
    ],
    start: [10, 31],
    terrain: [
      // the leaps: kickers with a puddle on the landing
      { t: 'kicker', x: 54, z: 14, len: 7, wid: 9.5, h: 1.7, rot: -90 * R },
      { t: 'kicker', x: 18, z: -31, len: 7, wid: 9.5, h: 1.6, rot: 180 * R },
      { t: 'kicker', x: -40, z: 31, len: 6, wid: 9.5, h: 1.3, rot: 0 },
      { t: 'mound', x: -38, z: -18, r: 2.2, h: 0.9, offTrack: true },
      { t: 'mound', x: -46, z: -26, rx: 3.2, rz: 1.6, h: 0.8, offTrack: true },
      // bumps on the left
      { t: 'mound', x: -54, z: 10, r: 3.3, h: 0.8 },
      { t: 'mound', x: -55, z: 20, r: 3.3, h: 0.8 },
    ],
    water: [
      // the lizard pond in the cut-off corner, plus landing splashes
      { x: -44, z: -24, rx: 12, rz: 8, rot: -30 * R, depth: 0.9, wobble: 0.25 },
      { x: 54, z: -1, rx: 4, rz: 5, depth: 0.35 },
      { x: 2, z: -31, rx: 5, rz: 3.5, depth: 0.35 },
    ],
    decor: [
      { t: 'bunting', a: [48.5, 16], b: [59.5, 16] },
      { t: 'bunting', a: [20, -36.5], b: [20, -25.5] },
      // the lizards: giant statues sunning themselves in the infield
      { t: 'lizard', x: 12, z: 10, rot: 25 * R, s: 3.2 },
      { t: 'lizard', x: 32, z: -6, rot: 160 * R, s: 2.8, flip: true },
      { t: 'lizard', x: -20, z: 11, rot: -40 * R, s: 2.6 },
    ],
  },
  // 12 -----------------------------------------------------------------
  {
    id: 'cutoff',
    name: 'Cutoff Pass',
    pak: true,
    time: 'sunset',
    width: 9.5,
    path: [
      [54, 31, 9], [54, -31, 9], [10, -31, 8], [10, -2, 8], [-24, -2, 8], [-24, -31, 8], [-54, -31, 9], [-54, 31, 9],
    ],
    start: [0, 31],
    terrain: [
      // the pass: a mesa across the top; climb it, run the U below, climb again and jump off the west edge
      { t: 'plateau', poly: [[-30, -42], [17, -42], [17, -12], [-30, -12]], h: 2.3, edge: 8 },
      { t: 'wash', x: 54, z: 2, len: 16, wid: 9.5, rot: -90 * R, amp: 0.3, wl: 2.5 },
      { t: 'mound', x: -7, z: 16, rx: 14, rz: 5, h: 2.2, offTrack: true },
      { t: 'mound', x: 34, z: 8, r: 6, h: 2, offTrack: true },
      { t: 'mound', x: -40, z: 6, rx: 5, rz: 12, h: 2, offTrack: true },
    ],
    water: [
      { x: -7, z: 4, rx: 10, rz: 3.2, depth: 0.45 },
      { x: 30, z: 31, rx: 5, rz: 3.2, depth: 0.35 },
    ],
    decor: [],
  },
  // 13 -----------------------------------------------------------------
  {
    id: 'boulder',
    name: 'Boulder Hill',
    pak: true,
    time: 'day',
    width: 13,
    path: [[52, 28, 12], [52, -27, 12], [-52, -27, 12], [-52, 28, 12]],
    start: [0, 28],
    islands: [
      // rock pillars: a slalom on every straight
      { circle: [30, -23.5, 1.8], prop: 'rock' }, { circle: [10, -30.5, 1.8], prop: 'rock' }, { circle: [-12, -23.5, 1.9], prop: 'rock' }, { circle: [-32, -30.5, 1.7], prop: 'rock' },
      { circle: [-30, 24.5, 1.8], prop: 'rock' }, { circle: [-8, 31.5, 1.7], prop: 'rock' }, { circle: [14, 24.5, 1.9], prop: 'rock' }, { circle: [34, 31.5, 1.8], prop: 'rock' },
      { circle: [-48.5, -6, 1.8], prop: 'rock' }, { circle: [-55.5, 12, 1.7], prop: 'rock' },
      { circle: [48.5, 10, 1.8], prop: 'rock' }, { circle: [55.5, -8, 1.7], prop: 'rock' },
      // the hill of boulders in the middle
      { circle: [-24, -6, 2.6], prop: 'rock' }, { circle: [-12, 6, 3.0], prop: 'rock' }, { circle: [2, -8, 2.4], prop: 'rock' },
      { circle: [16, 8, 2.8], prop: 'rock' }, { circle: [28, -6, 2.4], prop: 'rock' }, { circle: [-34, 10, 2.2], prop: 'rock' },
    ],
    terrain: [
      { t: 'mound', x: 0, z: 0, rx: 32, rz: 12, h: 3.2, offTrack: true },
      { t: 'mound', x: 0, z: -27, rx: 5, rz: 4, h: 0.9 },
      { t: 'mound', x: -52, z: 0, rx: 4, rz: 5, h: 0.9 },
    ],
    water: [{ x: 22, z: 28, rx: 4.5, rz: 3, depth: 0.35 }],
    decor: [],
  },
  // 14 -----------------------------------------------------------------
  {
    id: 'pigbog',
    name: 'Pig Bog',
    pak: true,
    time: 'night',
    width: 11,
    path: [[50, 27, 15], [50, -26, 15], [-50, -26, 15], [-50, 27, 15]],
    start: [0, 27.5],
    areas: [{ poly: roundRect(0, 0, 118, 72, 14) }],
    islands: [
      { poly: roundRect(0, 0, 54, 22, 10) },
      // the four numbered posts
      { poly: roundRect(-40, 17, 7, 6, 2.5), num: 1 },
      { poly: roundRect(40, -17, 7, 6, 2.5), num: 2 },
      { poly: roundRect(40, 17, 7, 6, 2.5), num: 3 },
      { poly: roundRect(-40, -17, 7, 6, 2.5), num: 4 },
    ],
    noiseAmp: 0.32,
    terrain: [
      { t: 'mound', x: 0, z: -30, rx: 6, rz: 3, h: 0.7 },
      { t: 'mound', x: 0, z: 31, rx: 6, rz: 3, h: 0.7 },
    ],
    water: [
      // bog channels across the whole field
      { x: -45, z: -6, rx: 13, rz: 3.2, rot: -8 * R, depth: 0.4, wobble: 0.35 },
      { x: 46, z: 3, rx: 12, rz: 3.2, rot: 10 * R, depth: 0.4, wobble: 0.35 },
      { x: -15, z: -26, rx: 10, rz: 3.0, rot: 80 * R, depth: 0.4, wobble: 0.35 },
      { x: 15, z: 26, rx: 10, rz: 3.0, rot: 100 * R, depth: 0.4, wobble: 0.35 },
      { x: 30, z: -30, rx: 6, rz: 3.5, depth: 0.4 },
      { x: -30, z: 30, rx: 6, rz: 3.5, depth: 0.4 },
    ],
    decor: [],
  },
  // 15 -----------------------------------------------------------------
  {
    id: 'shortcut',
    name: 'Shortcut',
    pak: true,
    time: 'day',
    width: 9.5,
    path: [
      [54, 31, 9], [54, 10, 8], [30, 10, 8], [30, -10, 8], [6, -10, 8], [6, -31, 9], [-54, -31, 9], [-54, 31, 9],
    ],
    start: [-30, 31],
    terrain: [
      // whoops down the left side
      { t: 'wash', x: -54, z: 0, len: 30, wid: 9.5, rot: 90 * R, amp: 0.32, wl: 2.6 },
      // the staircase sits on a raised step
      { t: 'plateau', poly: [[2, -40], [62, -40], [62, 4], [36, 4], [36, -4], [2, -4]], h: 1.6, edge: 8 },
      { t: 'table', x: -24, z: -31, len: 18, wid: 9.5, h: 1.4, rot: 0, up: 6, down: 6 },
      { t: 'mound', x: -24, z: 4, rx: 16, rz: 10, h: 2.6, offTrack: true },
      { t: 'mound', x: 22, z: 22, rx: 10, rz: 4, h: 1.6, offTrack: true },
    ],
    water: [
      { x: 30, z: 31, rx: 6, rz: 3.4, depth: 0.4 },
      { x: -40, z: 24, rx: 5, rz: 4, depth: 0.4, wobble: 0.2 },
    ],
    decor: [],
  },
  // 16 -----------------------------------------------------------------
  {
    id: 'volcano',
    name: 'Volcano Valley',
    pak: true,
    time: 'night',
    width: 9.5,
    path: [
      [54, 31, 12], [54, -31, 12], [22, -31, 9], [0, -16, 9], [-22, -31, 9], [-54, -31, 12], [-54, 31, 12],
    ],
    start: [0, 31],
    volcano: { x: 0, z: 2, r: 34, h: 11.5, crater: 3.4, rim: 0.2 },
    terrain: [
      // the volcano: the top lane climbs over its northern shoulder
      { t: 'cone', x: 0, z: 2, r: 34, h: 11.5, p: 1.5, crater: 3.4, cr: 0.2, lip: 0.55 },
      { t: 'wash', x: 54, z: 0, len: 14, wid: 9.5, rot: -90 * R, amp: 0.28, wl: 2.4 },
      { t: 'mound', x: -54, z: 6, r: 3.3, h: 0.8 },
      { t: 'mound', x: -54, z: -6, r: 3.3, h: 0.8 },
    ],
    water: [
      { x: -40, z: 31, rx: 6, rz: 3.4, depth: 0.4 },
      { x: 40, z: -31, rx: 6, rz: 3.4, depth: 0.4 },
    ],
    decor: [],
  },
];
