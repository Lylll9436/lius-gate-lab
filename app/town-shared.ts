import * as T from 'three';
import type { createCityMaterials } from './city-materials';
import * as plan from './town-plan';
import type { XZ } from './town-plan';
import type { Season } from './glasgow-sun';

/* ------------------------------------------------------------------ */
/* Palette, noise and layout shared by the town modules                */
/* ------------------------------------------------------------------ */
export const palette = {
  blonde: '#dcc08c', pale: '#e6d2a2', red: '#b8604a', brick: '#a4452e', brickLight: '#dcc08c',
  trim: '#ecdcb6', trimRed: '#d29a7c', frame: '#f5efe0', stoneDark: '#c4a878', plinth: '#c4a878', plinthRed: '#93503c',
  slate: '#8fa4b9', slateLight: '#a9b8c6',
  copper: '#6faf9b', copperLight: '#8cc7b2', pantile: '#c8644a', pantileLight: '#d98a6c',
  glass: '#6fa8c4', glassDark: '#6fa8c4', studioGlass: '#8cc4d8', ink: '#26313a',
  greenDoor: '#2e6e4c', blueDoor: '#2d5f8f', redDoor: '#b23a30',
  wood: '#a06b3e', woodDark: '#6b4529', metal: '#4b545b', bronze: '#a87b45', gold: '#e8b84a', brass: '#dcbc78',
  road: '#6b7279', roadLine: '#e8e2cc', kerb: '#cfc3a6', pavement: '#d4c4a0', plaza: '#d4c4a0', plazaDark: '#bfac86', path: '#b8946a',
  pool: '#2a86b0', poolEdge: '#62c0d4', poolWater: '#3fa6c4', poolSurface: '#bfe6ee', render: '#f2e9d6',
  grass: '#a2bf50', grassLight: '#aac757', grassDark: '#98b74a', lawnPad: '#8bb038', lawnEdge: '#7a9638',
  sand: '#e4cc94', sandWet: '#c2a675', soil: '#6b4a2e',
  canopy: ['#7aab2e', '#93bb3a', '#86b234', '#6f9e2a'], hedge: '#5e8f28', hedgeTop: '#93bb3a',
  autumn: ['#d39a3a', '#e0ab45', '#c8862f', '#d9a03c'], blossom: ['#f0a6bd', '#f4b8cb', '#e894b0', '#f6c4d3'],
  pine: ['#3e8a4a', '#357a40', '#4a9655'], bark: '#6b4529', pineBark: '#5c3c22',
  flowers: ['#e5483c', '#f6c63f', '#f18fb0', '#f5efe0', '#8e6ad0'],
  white: '#f5efe0', lantern: '#ffd48a', tram: '#2f6b4a', tramOrange: '#e07a2c', tramCream: '#efe2c2',
  boat: '#c9412f', balloon: '#c9412f', balloonBand: '#efe2c2',
  // Harbour and shore details, each no more saturated than its family (sand, blueDoor, greenDoor, tramOrange, hedge, woodDark, wood).
  rope: '#c8b086', ropeBlue: '#46617a', creel: ['#3e6a87', '#3f6e55', '#b8703f'], net: '#4d6f66',
  weed: '#5d6b3a', kelp: '#5c4a2c', driftwood: '#b9ab92',
};
export const hash = plan.hash;
export function noise2(x: number, z: number) {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    fx = x - ix,
    fz = z - iz,
    u = fx * fx * (3 - 2 * fx),
    v = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number) => hash(a * 311 + b * 727 + 1);
  return T.MathUtils.lerp(
    T.MathUtils.lerp(h(ix, iz), h(ix + 1, iz), u),
    T.MathUtils.lerp(h(ix, iz + 1), h(ix + 1, iz + 1), u),
    v,
  );
}
export const sstep = T.MathUtils.smoothstep, mix = T.MathUtils.lerp;

/* ------------------------------------------------------------------ */
/* Layout shared by the town and its ground masks                      */
/* ------------------------------------------------------------------ */

/**
 * The plaza's reflecting pool ring (water from `inner` to `outer`, a 0.3 coping on each side),
 * cut by four causeways that stay at least 0.95 half-wide at the island, like the arch opening.
 */
export const POOL = { inner: 2.7, outer: 3.9, coping: 0.3 },
  POOL_GAP = Math.asin(1.3 / ((POOL.inner + POOL.outer) / 2));
/** One planter per pool sector, on the paving between the outer coping and the rim; its long side runs along the ring. */
export const PLANTER = { radius: 4.47, w: 1.2, d: 0.45 };
export const plazaPlanters = () =>
  [0, 1, 2, 3].map((i) => {
    const a = (Math.PI / 2) * i + Math.PI / 4; // the middle of pool sector i
    return { ry: Math.PI / 2 - a, x: Math.cos(a) * PLANTER.radius, z: Math.sin(a) * PLANTER.radius };
  });
/** The park's bandstand stands just behind the park centre. */
export const bandstandAt = (): XZ => [plan.park.x, plan.park.z - 0.3];
/** The crane's stone footing (square) and the hoarding panels' thickness; the ground masks stamp both. */
export const CRANE_BASE = 1.8,
  HOARDING_THICKNESS = 0.12;
/** The hoarding round the reserved plot: offset from the plot centre, length, rotation. */
export const hoardingWalls = (plot: typeof plan.reservedPlot) =>
  [
    [0, -plot.d / 2, plot.w, 0],
    [0, plot.d / 2, plot.w, 0],
    [-plot.w / 2, 0, plot.d, Math.PI / 2],
    [plot.w / 2, 0, plot.d, Math.PI / 2],
  ] as const;
/**
 * The paddock's dry-stone dykes as straight runs on the plan's centre lines: centre x, z,
 * length and rotation. The north and south runs reach over the corners; the field gate cuts the
 * north one, which stops at the outer faces of the gate posts (0.16 square, on the gateway's ends).
 */
export const paddockRuns = (): (readonly [number, number, number, number])[] => {
  const P = plan.paddock,
    x0 = P.x - P.w / 2 - P.wall / 2,
    x1 = P.x + P.w / 2 + P.wall / 2,
    g0 = P.gate.x - P.gate.width / 2 - 0.08,
    g1 = P.gate.x + P.gate.width / 2 + 0.08,
    north = P.z - P.d / 2;
  return [
    [(x0 + g0) / 2, north, g0 - x0, 0],
    [(g1 + x1) / 2, north, x1 - g1, 0],
    [P.x, P.z + P.d / 2, x1 - x0, 0],
    [P.x - P.w / 2, P.z, P.d - P.wall, Math.PI / 2],
    [P.x + P.w / 2, P.z, P.d - P.wall, Math.PI / 2],
  ];
};

export const WATER = -0.028;

export type TownContext = {
  library: ReturnType<typeof createCityMaterials>;
  material: ReturnType<typeof createCityMaterials>['material'];
  season: Season;
  land: T.Group;
  lamps: T.Mesh[];
  clocks: { hour: T.Object3D; minute: T.Object3D }[];
  animated: { object: T.Object3D; update: (time: number, night: number) => void }[];
};
