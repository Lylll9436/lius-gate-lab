import type { BuildingId } from './city-data';

/**
 * The plan of the town: one island, one plaza around the gate, a ring road,
 * four avenues, a row of terrace houses, a harbour and a few hills.
 * Pure data and maths; nothing here touches WebGL.
 */
export type XZ = [number, number];
const TAU = Math.PI * 2;
export const hash = (n: number) => {
  const v = Math.sin(n * 127.1 + 78.23) * 43758.5453;
  return v - Math.floor(v);
};
const gauss = (t: number) => Math.exp(-t * t);
export const angleDiff = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

/* ------------------------------------------------------------------ */
/* Island                                                              */
/* ------------------------------------------------------------------ */

/** Island radius by bearing: a soft superellipse, a harbour bay in the south-east, a headland in the north-west. */
export function islandRadius(a: number) {
  const c = Math.cos(a),
    s = Math.sin(a);
  let r = 27.5 / Math.pow(c ** 4 + s ** 4, 0.25);
  r +=
    0.9 * Math.sin(a * 5 + 0.6) +
    0.5 * Math.sin(a * 9 + 1.9) +
    0.25 * Math.sin(a * 17 + 0.4);
  r -= 6.2 * gauss(angleDiff(a, 0.95) / 0.3);
  r += 2.4 * gauss(angleDiff(a, 3.85) / 0.32);
  return r;
}
export const OUTLINE_SAMPLES = 220;
export const islandOutline: XZ[] = Array.from(
  { length: OUTLINE_SAMPLES },
  (_, i) => {
    const a = (i / OUTLINE_SAMPLES) * TAU,
      r = islandRadius(a);
    return [Math.cos(a) * r, Math.sin(a) * r];
  },
);
export const islandBanks = [islandOutline];
export function onIsland(x: number, z: number, margin = 0) {
  return Math.hypot(x, z) < islandRadius(Math.atan2(z, x)) - margin;
}

/** Gentle hills on the outskirts; streets and building sites stay on the flat plateau. */
export const mounds = [
  { x: -20, z: -19, r: 4.5, h: 1.1 },
  { x: 22, z: -18, r: 4.5, h: 0.8 },
  // South of the terrace, clear of the cottage set back beside it.
  { x: -21.5, z: 15.5, r: 4.5, h: 0.6 },
  { x: 23, z: 4, r: 4, h: 0.5 },
];
export function terrainHeight(x: number, z: number) {
  let y = 0;
  for (const m of mounds) {
    const d = Math.hypot(x - m.x, z - m.z) / m.r;
    if (d < 1) y += m.h * (1 - d * d) ** 2;
  }
  // Cut a flat pad under each cottage so its plinth sits level (cottages is only read at call time).
  for (const c of cottages) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < 3.4) {
      const t = Math.max(0, (d - 2.2) / 1.2);
      y *= t * t * (3 - 2 * t);
    }
  }
  return y;
}

/* ------------------------------------------------------------------ */
/* Streets                                                             */
/* ------------------------------------------------------------------ */

export const PLAZA_RADIUS = 5.2;
export const ROAD_WIDTH = 1.7,
  PAVEMENT_WIDTH = 1.1;
export const ring = { hw: 16, hd: 14, cz: 1, radius: 5 };
/** Surface tops: the road lies on the grass; pavements, the plaza and kerbs are raised slabs. */
export const levels = { road: 0.02, pavement: 0.1, plaza: 0.1, kerb: 0.14 };

/** A closed rounded rectangle, sampled clockwise when seen from above. */
export function roundedRect(
  hw: number,
  hd: number,
  radius: number,
  cz = 0,
  cornerSamples = 10,
): XZ[] {
  const points: XZ[] = [];
  const corners: [number, number, number][] = [
    [hw - radius, cz - hd + radius, -Math.PI / 2],
    [hw - radius, cz + hd - radius, 0],
    [-hw + radius, cz + hd - radius, Math.PI / 2],
    [-hw + radius, cz - hd + radius, Math.PI],
  ];
  for (const [cx, cz2, start] of corners)
    for (let i = 0; i <= cornerSamples; i++) {
      const a = start + (i / cornerSamples) * (Math.PI / 2);
      points.push([cx + Math.cos(a) * radius, cz2 + Math.sin(a) * radius]);
    }
  return points;
}
export const ringLine = roundedRect(ring.hw, ring.hd, ring.radius, ring.cz);
/** Three avenues reach the ring; the short north avenue ends at the Town Hall steps. */
export const avenues: { id: string; from: XZ; to: XZ; crossing: boolean }[] = [
  { id: 'north', from: [0, -PLAZA_RADIUS], to: [0, -6.0], crossing: false },
  { id: 'south', from: [0, PLAZA_RADIUS], to: [0, ring.cz + ring.hd], crossing: true },
  { id: 'west', from: [-PLAZA_RADIUS, 0], to: [-ring.hw, 0], crossing: true },
  { id: 'east', from: [PLAZA_RADIUS, 0], to: [ring.hw, 0], crossing: true },
];
/** Where avenues meet the ring: crossings, and a gap in trees and lamps. */
export const junctions: XZ[] = avenues.filter((a) => a.crossing).map((a) => a.to);

export function polylineLength(points: XZ[], closed = false) {
  let total = 0;
  for (let i = 1; i < points.length; i++)
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  if (closed)
    total += Math.hypot(points[0][0] - points.at(-1)![0], points[0][1] - points.at(-1)![1]);
  return total;
}
/** Position and heading at a distance along a polyline. */
export function samplePolyline(points: XZ[], distance: number, closed = false) {
  const total = polylineLength(points, closed);
  let d = ((distance % total) + total) % total;
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d <= length || i === count - 1) {
      const t = length ? Math.min(1, d / length) : 0;
      return {
        x: a[0] + (b[0] - a[0]) * t,
        z: a[1] + (b[1] - a[1]) * t,
        heading: Math.atan2(b[0] - a[0], b[1] - a[1]),
      };
    }
    d -= length;
  }
  return { x: points[0][0], z: points[0][1], heading: 0 };
}
/** Subdivide every segment of a closed polyline into ceil(length / step) equal pieces. */
export function densify(points: XZ[], step: number): XZ[] {
  const out: XZ[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length],
      pieces = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < pieces; k++)
      out.push([a[0] + ((b[0] - a[0]) * k) / pieces, a[1] + ((b[1] - a[1]) * k) / pieces]);
  }
  return out;
}
/** Offset a closed polyline sideways (positive = to the right of travel). */
export function offsetPolyline(points: XZ[], offset: number, closed = true): XZ[] {
  const n = points.length;
  return points.map((p, i) => {
    const a = points[(i - 1 + n) % n],
      b = points[(i + 1) % n];
    if (!closed && (i === 0 || i === n - 1)) {
      const q = i === 0 ? b : a,
        dx = (i === 0 ? q[0] - p[0] : p[0] - q[0]),
        dz = (i === 0 ? q[1] - p[1] : p[1] - q[1]),
        l = Math.hypot(dx, dz) || 1;
      return [p[0] - (dz / l) * offset, p[1] + (dx / l) * offset];
    }
    const dx = b[0] - a[0],
      dz = b[1] - a[1],
      l = Math.hypot(dx, dz) || 1;
    return [p[0] - (dz / l) * offset, p[1] + (dx / l) * offset];
  });
}
export function distanceToSegment(p: XZ, a: XZ, b: XZ) {
  const x = b[0] - a[0],
    z = b[1] - a[1],
    t = Math.max(0, Math.min(1, ((p[0] - a[0]) * x + (p[1] - a[1]) * z) / (x * x + z * z || 1)));
  return Math.hypot(p[0] - a[0] - x * t, p[1] - a[1] - z * t);
}
export function distanceToPolyline(p: XZ, points: XZ[], closed = false) {
  let best = Infinity;
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++)
    best = Math.min(best, distanceToSegment(p, points[i], points[(i + 1) % points.length]));
  return best;
}
/** Distance from any paved street surface (plaza, avenues or ring). */
export function distanceToStreets(x: number, z: number) {
  const p: XZ = [x, z];
  let d = Math.max(0, Math.hypot(x, z) - PLAZA_RADIUS);
  d = Math.min(d, distanceToPolyline(p, ringLine, true) - ROAD_WIDTH / 2);
  for (const a of avenues)
    d = Math.min(d, distanceToSegment(p, a.from, a.to) - ROAD_WIDTH / 2);
  return d;
}
/** 1 inside the ring, its pavements and the terrace gardens (the mown town lawn), fading to 0 over 2.5 units. */
export function lawnCore(x:number,z:number){const rr=(cx:number,cz:number,hx:number,hz:number,r:number)=>{const qx=Math.abs(x-cx)-hx+r,qz=Math.abs(z-cz)-hz+r;return Math.hypot(Math.max(qx,0),Math.max(qz,0))+Math.min(Math.max(qx,qz),0)-r;};const d=Math.min(rr(0,ring.cz,ring.hw+ROAD_WIDTH/2+PAVEMENT_WIDTH+1.2,ring.hd+ROAD_WIDTH/2+PAVEMENT_WIDTH+1.2,ring.radius+2),rr(-22,1,5,7,2.5));const t=Math.min(1,Math.max(0,d/2.5));return 1-t*t*(3-2*t);}

/* ------------------------------------------------------------------ */
/* Sites                                                               */
/* ------------------------------------------------------------------ */

export type Site = {
  id: BuildingId;
  x: number;
  z: number;
  /** rotation.y: the building's local +z (its front) turns to this bearing. */
  rotation: number;
  w: number;
  d: number;
  height: number;
};
/**
 * The three homes stand side by side in a straight row, fronts in one line facing the ring
 * road (east), with a 2.4 gap between neighbours so each reads as its own house. Set back so
 * every front garden is as deep (about 1.9 beyond the pavement) as the deepest one used to be.
 */
export const terraceRow = { x: -22, z: 1, spacing: 5.0, w: 2.6, d: 4.2 };
function rowUnit(id: BuildingId, slot: -1 | 0 | 1): Site {
  return {
    id,
    x: terraceRow.x,
    z: terraceRow.z + slot * terraceRow.spacing,
    rotation: Math.PI / 2,
    w: terraceRow.w,
    d: terraceRow.d,
    height: 3.3,
  };
}
export const sites: Record<BuildingId, Site> = {
  'lius-gate': { id: 'lius-gate', x: 0, z: 0, rotation: 0, w: 4.8, d: 1.9, height: 6 },
  'town-hall': { id: 'town-hall', x: 0, z: -8.6, rotation: 0, w: 7.4, d: 4.6, height: 9.5 },
  'pengyuan-liu': rowUnit('pengyuan-liu', -1),
  'yunlong-liu': rowUnit('yunlong-liu', 0),
  'qin-li': rowUnit('qin-li', 1),
  'research-studio': { id: 'research-studio', x: 10.2, z: -5, rotation: -Math.PI / 2, w: 5.6, d: 5.2, height: 5 },
  'city-archive': { id: 'city-archive', x: 9.4, z: 9.2, rotation: -Math.PI / 2, w: 6.2, d: 4.8, height: 4.2 },
};
export const siteList = Object.values(sites);
/** The red phone box on the east edge of the plaza (the plaza tree beside it is left out). */
export const phoneBoxSpot: XZ = [4.65, -0.9];

/**
 * Reading-mode camera bearings per chapter. The camera sits along (sin b, cos b) from its
 * target and a building's front faces (sin r, cos r), so |b - r| is how far off-front the
 * subject is seen. Each chapter shows its subject's front from 15-50 degrees: a three-quarter
 * view of the doors, porches and bay windows rather than the back wall.
 */
export const chapterBearings: Record<string, number> = {
  overview: Math.PI / 4,
  'town-hall': 0.9,
  people: 1.9,
  'research-studio': -0.7,
  'city-archive': -0.97,
  // Facing the park's notice board (turned -0.6) rather than its edge.
  'corner-park': -0.35,
  'lius-gate': Math.PI / 4 - 0.18,
};
/** The buildings whose fronts each chapter is about (checked against the bearings above). */
export const chapterSubjects: Record<string, BuildingId[]> = {
  'town-hall': ['town-hall'],
  people: ['pengyuan-liu', 'yunlong-liu', 'qin-li'],
  'research-studio': ['research-studio'],
  'city-archive': ['city-archive'],
  'lius-gate': ['lius-gate'],
};
export const park = { x: -9.6, z: 9.2, w: 8.4, d: 5.4 };
export const reservedPlot = { x: 21, z: -7.5, w: 5, d: 5 };
/**
 * Cottages around the town. The two by the terrace stand about 3 back from the row's line
 * (x -22), turned in toward it, so the row reads as the three members' homes and not five.
 */
export const cottages: { x: number; z: number; rotation: number; color: string }[] = [
  { x: -24.6, z: -10.6, rotation: Math.PI / 2 - 0.55, color: '#e1cfa8' },
  { x: -24.6, z: 11.6, rotation: Math.PI / 2 + 0.55, color: '#d9c39a' },
  { x: 20.5, z: 1.5, rotation: -Math.PI / 2, color: '#e4d2ad' },
  { x: 5, z: -17.5, rotation: 0, color: '#cdb48d' },
  { x: -6.5, z: -17.8, rotation: 0.15, color: '#e1cfa8' },
];
/**
 * A dry-stone paddock for a small Highland herd, in the south-west outskirts between the ring's
 * outer trees and the south shore: on flat ground, 3.35 from the road, about 3.9 inside the
 * coast, 16 from the nearest cottage and far from the terrace row. From the Life chapter's
 * bearing (-0.35) it lies in front of the park, below it on the page. The rectangle is the
 * dykes' centre lines; the field gate opens in the north wall, toward the park. The heather,
 * thistles and other moorland props keep 1.0 clear of it.
 */
export const paddock = { x: -11.6, z: 20.9, w: 5.2, d: 3.4, wall: 0.34, gate: { x: -10.2, width: 1.1 } };
/**
 * The herd: two cows and a calf. `heading` is rotation.y (the nose points along
 * (sin h, cos h)); `phase` sets the idle graze cycle, so at time 0 (and so with reduced motion)
 * cow-b holds its head up toward the Life camera while cow-a eats at the rack and the calf grazes.
 * The calf grazes in front of cow-a, clear of cow-b's horns as the Life camera sees them.
 * Cow-a feeds a little turned toward the Life camera: square to the rack, its near horn pointed
 * almost straight at the camera and read as a short white tusk.
 */
export type HerdMember = { id: string; x: number; z: number; heading: number; scale: number; eating: boolean; phase: number };
export const herd: HerdMember[] = [
  { id: 'cow-a', x: -12.43, z: 20.36, heading: -Math.PI / 2 + 0.55, scale: 1, eating: true, phase: 1.2 },
  { id: 'cow-b', x: -10.4, z: 21.25, heading: -0.75, scale: 1, eating: false, phase: -Math.PI / 2 },
  { id: 'calf', x: -12.9, z: 21.8, heading: 1.9, scale: 0.62, eating: false, phase: 1.9 },
];
/** The hay rack against the paddock's west wall, its long side along z and its feeding side to +x. */
export const hayRack = { x: -13.65, z: 20.7 };
/**
 * A ring of standing stones (stone centre lines) at the tip of the north-west headland: flat
 * ground about 2.2 inside the coast, clear of the canopies and far from every chapter's view.
 */
export const stoneRing = { x: -23.75, z: -23.25, r: 1.15 };
/**
 * Glasgow's Duke of Wellington, cone and all, on the civic lawn west of the Town Hall: 4.75 from
 * the streets, 6.7 from the hall's footprint and well to the side of its front, on flat ground.
 * He rides east towards the hall steps (rotation.y, so the horse faces along (sin h, cos h)),
 * about 58 degrees off the opening bearing (pi/4) and 52 off the hall chapter's (0.9): a side
 * three-quarter view from both, never the head-on blob a smaller turn gives.
 */
export const statueSpot: XZ = [-10.4, -5.6];
export const statueHeading = 1.8;

/* ------------------------------------------------------------------ */
/* Harbour                                                             */
/* ------------------------------------------------------------------ */

const pierBearing = 1.0;
const pierDir: XZ = [Math.cos(pierBearing), Math.sin(pierBearing)];
const pierTangent: XZ = [-pierDir[1], pierDir[0]];
// The deck starts just inside the outline, so about 2.7 of its 6.0 run over water.
const pierStartRadius = islandRadius(pierBearing) - 0.6;
export const pier = {
  start: [pierDir[0] * pierStartRadius, pierDir[1] * pierStartRadius] as XZ,
  dir: pierDir,
  tangent: pierTangent,
  length: 6.0,
  width: 1.5,
};
export const pierEnd: XZ = [
  pier.start[0] + pierDir[0] * pier.length,
  pier.start[1] + pierDir[1] * pier.length,
];
// The loop clears the pier head, the two channel buoys and the dinghy.
export const boatLoop = {
  cx: pierEnd[0] + pierDir[0] * 3.2 + pierTangent[0] * 0.5,
  cz: pierEnd[1] + pierDir[1] * 3.2 + pierTangent[1] * 0.5,
  along: 3.3,
  across: 1.7,
};
export function boatPose(time: number) {
  const t = time * 0.1;
  const u = Math.cos(t) * boatLoop.along,
    v = Math.sin(t) * boatLoop.across;
  const x = boatLoop.cx + pierTangent[0] * u + pierDir[0] * v,
    z = boatLoop.cz + pierTangent[1] * u + pierDir[1] * v;
  const du = -Math.sin(t) * boatLoop.along,
    dv = Math.cos(t) * boatLoop.across;
  const dx = pierTangent[0] * du + pierDir[0] * dv,
    dz = pierTangent[1] * du + pierDir[1] * dv;
  return {
    x,
    z,
    y: Math.sin(time * 1.7) * 0.012, // the hull sits in the water
    heading: Math.atan2(dx, dz),
    roll: Math.sin(time * 1.1) * 0.03,
  };
}
export const lighthouseRock: XZ = [-8, 31.5];
/** A pier-local point (x across, + towards the hut; z out to sea) in world x, z. */
export const pierPoint = (x: number, z: number): XZ => [
  pier.start[0] + pierDir[0] * z + pierDir[1] * x,
  pier.start[1] + pierDir[1] * z - pierDir[0] * x,
];
/**
 * Out from outline sample i (fractional) by `width` along the outline's normal, smoothed over two
 * neighbours each side as the shore mesh is; between samples it is lerped. At an integer i this
 * is exactly the shore mesh's own point.
 */
export function shoreAt(i: number, width: number): XZ {
  const n = OUTLINE_SAMPLES,
    at = (k: number): XZ => {
      const j = ((k % n) + n) % n,
        p = islandOutline[j],
        prev = islandOutline[(j + n - 2) % n],
        next = islandOutline[(j + 2) % n];
      const dx = next[0] - prev[0],
        dz = next[1] - prev[1],
        l = Math.hypot(dx, dz) || 1;
      return [p[0] + (dz / l) * width, p[1] - (dx / l) * width];
    };
  const k = Math.floor(i),
    t = i - k,
    a = at(k);
  if (t === 0) return a;
  const b = at(k + 1);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
/** rotation.y turning local +z out to sea at sample i (local +x then runs along the shore). */
export const shoreTurn = (i: number) => {
  const [ax, az] = shoreAt(i, 0),
    [bx, bz] = shoreAt(i, 1);
  return Math.atan2(bx - ax, bz - az);
};
/**
 * The harbour's working details, pier-local (x across, + towards the hut; z out to sea). The
 * dinghy is moored to the pile heads at z 3.5 and 6.1 (the code's bollards) by two lines from
 * fairleads inside its hull (dinghy-local x, y, z). The boat never rests, so its berth at the
 * pier head is an empty bollard with a coiled line on the planks beside it; the coil shares the
 * bollard's world x, so the lead between them runs along world z (see pierAndHarbour).
 */
export const harbour = {
  dinghy: { x: -1.4, z: 5.3, turn: 0.06 },
  lines: [
    { fairlead: [0.1, 0.1, -0.6], pile: [-0.72, 3.5] }, // stern line, aft
    { fairlead: [0.12, 0.1, 0.5], pile: [-0.72, 6.1] }, // bow line, forward to the head pile
  ] as { fairlead: [number, number, number]; pile: XZ }[],
  headBollard: [0.2, 5.95] as XZ,
  berthCoil: [0.5, 5.48] as XZ,
  pileWrack: [[-0.98, 3.6], [0.98, 3.4]] as XZ[],
};
/**
 * Beach details either side of the pier, in shore coordinates: outline sample i (fractional) and
 * width w out from the outline. `foot` is the plan radius every part stays inside. The hut side
 * (samples 29-31) is the working quay: creels, floats and a coil on the dry sand. The dinghy side
 * (37-43) has a net drying on a frame, a strand line of wrack and driftwood, and rock pools on the
 * wet sand round the boulder at sample 42.
 */
export const shoreProps = {
  creelStack: { i: 30.3, w: 0.8, foot: 0.51 },
  creel: { i: 30.7, w: 1.65, turn: 0.4, foot: 0.31 },
  floats: [{ i: 29.6, w: 0.62, foot: 0.12 }, { i: 29.25, w: 0.95, foot: 0.12 }],
  coil: { i: 29.6, w: 1.45, foot: 0.23 },
  netFrame: { from: { i: 37.4, w: 0.65 }, to: { i: 39.2, w: 0.65 }, foot: 0.3 }, // a capsule: the hangs splay to 0.24, the hem floats to 0.3
  driftwood: { from: { i: 40.05, w: 1.45 }, to: { i: 41.2, w: 1.38 }, foot: 0.1, rootFoot: 0.17 }, // a capsule, the root flare at `from`
  rockPools: [{ i: 42, w: 2.42, r: 0.32, foot: 0.6 }, { i: 43.1, w: 2.3, r: 0.26, foot: 0.53 }], // foot = 1.15 r + 0.23 (stretched along the shore, rim rocks)
  wrack: [{ i: 42.4, w: 2.0, s: 1, foot: 0.17 }, { i: 40.3, w: 2.68, s: 0.8, foot: 0.136 }, { i: 39.3, w: 1.6, s: 0.9, foot: 0.153 }, { i: 38.7, w: 1.7, s: 0.7, foot: 0.119 }], // foot = 0.17 s
};

/* ------------------------------------------------------------------ */
/* Planting and street furniture                                       */
/* ------------------------------------------------------------------ */

export type TreeSpec = {
  x: number;
  z: number;
  size: number;
  kind: 'round' | 'pine' | 'autumn';
  id: string;
};
function nearJunction(x: number, z: number, radius: number) {
  return (
    junctions.some(([jx, jz]) => Math.hypot(jx - x, jz - z) < radius) ||
    Math.hypot(x, z) < PLAZA_RADIUS + radius
  );
}
function insideRect(x: number, z: number, r: { x: number; z: number; w: number; d: number }, pad = 0) {
  return Math.abs(x - r.x) < r.w / 2 + pad && Math.abs(z - r.z) < r.d / 2 + pad;
}
function nearSite(x: number, z: number, pad: number) {
  return siteList.some((s) => Math.hypot(s.x - x, s.z - z) < Math.max(s.w, s.d) / 2 + pad);
}
export function plantingPlan(): TreeSpec[] {
  const trees: TreeSpec[] = [];
  const push = (x: number, z: number, size: number, kind: TreeSpec['kind']) =>
    trees.push({ x, z, size, kind, id: 'tree-' + trees.length });
  // Avenue trees: outside the ring and along the four avenues, never at a junction.
  const outer = offsetPolyline(ringLine, -2.7);
  const outerLength = polylineLength(outer, true);
  for (let d = 1.6; d < outerLength; d += 3.7) {
    const p = samplePolyline(outer, d, true);
    if (p.x < -15.5) continue; // the terrace gardens face this side
    if (nearJunction(p.x, p.z, 3.2)) continue;
    // Bigger canopies: keep clear of the crane hoarding and the cottages and their front gardens.
    if (insideRect(p.x, p.z, reservedPlot, 1.0)) continue;
    if (cottages.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 3.0)) continue;
    push(p.x, p.z, 0.82 + hash(d * 3) * 0.12, 'round');
  }
  for (const avenue of avenues)
    for (const side of [-1, 1]) {
      const length = Math.hypot(avenue.to[0] - avenue.from[0], avenue.to[1] - avenue.from[1]);
      const dx = (avenue.to[0] - avenue.from[0]) / length,
        dz = (avenue.to[1] - avenue.from[1]) / length;
      for (let d = 2.4; d < length - 2.6; d += 3.4) {
        const x = avenue.from[0] + dx * d - dz * side * 2.7,
          z = avenue.from[1] + dz * d + dx * side * 2.7;
        if (nearSite(x, z, 0.9) || insideRect(x, z, park, 0.4)) continue;
        push(x, z, 0.78 + hash(d * 7 + side) * 0.1, 'round');
      }
    }
  // Plaza trees flank the planters in each quadrant, clear of the causeways.
  for (let i = 0; i < 4; i++)
    for (const side of [-1, 1]) {
      const a = (Math.PI / 2) * i + Math.PI / 4 + side * 0.4;
      const x = Math.cos(a) * 4.55,
        z = Math.sin(a) * 4.55;
      // The phone box takes this tree's place on the plaza edge.
      if (Math.hypot(x - phoneBoxSpot[0], z - phoneBoxSpot[1]) < 1.4) continue;
      push(x, z, 0.6, 'round');
    }
  // Park: four trees framing the bandstand, each at least 3.4 from the park centre and clear of
  // the flower beds, the benches, the memory board and the gravel strip.
  for (const [dx, dz, size, kind] of [[-3.4, 0.1, 1.05, 'round'], [3.6, -0.6, 0.95, 'autumn'], [-3.3, -2.25, 0.9, 'round'], [3.4, -2.35, 0.85, 'round']] as const)
    push(park.x + dx, park.z + dz, size, kind);
  // Terrace gardens: one tree behind each gap, never in a gap or a front garden. The trunks stand
  // 1.44 from the nearest walls, clear of the canopy's reach (about 1.0) and 1.3 inside the shore.
  for (const [x, z] of [
    [-24.9, terraceRow.z - terraceRow.spacing / 2],
    [-24.9, terraceRow.z + terraceRow.spacing / 2],
  ] as XZ[])
    push(x, z, 0.85, 'round');
  // Outskirts: a seeded scatter that keeps clear of streets, sites and the shore.
  for (let i = 0; i < 900 && trees.length < 118; i++) {
    const x = (hash(i * 5 + 1) - 0.5) * 60,
      z = (hash(i * 5 + 2) - 0.5) * 60;
    if (!onIsland(x, z, 3.4)) continue;
    if (distanceToStreets(x, z) < 2.3) continue;
    if (nearSite(x, z, 2.2) || insideRect(x, z, park, 1.2)) continue;
    if (insideRect(x, z, reservedPlot, 1.6)) continue;
    if (cottages.some((c) => Math.hypot(c.x - x, c.z - z) < 3.2)) continue;
    if (Math.hypot(x - pier.start[0], z - pier.start[1]) < 4.8) continue;
    if (x > -27.5 && x < -16.5 && Math.abs(z - terraceRow.z) < terraceRow.spacing + 4) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 2.9)) continue;
    const hilly = terrainHeight(x, z) > 0.15 || z < -16;
    push(
      x,
      z,
      0.9 + hash(i + 81) * 0.5,
      hilly && hash(i + 9) < 0.55 ? 'pine' : hash(i + 17) < 0.14 ? 'autumn' : 'round',
    );
  }
  // The paddock takes the one scatter tree that stood in it. Filtering afterwards (rather than
  // in the scatter loop) leaves every other tree, and its id, where it was.
  return trees.filter((t) => !insideRect(t.x, t.z, paddock, 1.2));
}

export type LampSpec = { x: number; z: number; id: string };
export function lampPlan(): LampSpec[] {
  const lamps: LampSpec[] = [];
  const push = (x: number, z: number) => lamps.push({ x, z, id: 'lamp-' + lamps.length });
  for (const avenue of avenues)
    for (const side of [-1, 1]) {
      const length = Math.hypot(avenue.to[0] - avenue.from[0], avenue.to[1] - avenue.from[1]);
      const dx = (avenue.to[0] - avenue.from[0]) / length,
        dz = (avenue.to[1] - avenue.from[1]) / length;
      // Stop 2.4 short of the ring so no avenue lamp stands on the ring pavement.
      for (let d = 1.1; d < length - 2.4; d += 5.2)
        push(avenue.from[0] + dx * d - dz * side * 1.25, avenue.from[1] + dz * d + dx * side * 1.25);
    }
  // Ring lamps on the kerb side of the inner pavement: bases span 1.05-1.39, clear of the kerb
  // (to 1.03) and of the walkers at 1.62.
  const inner = offsetPolyline(ringLine, 1.22);
  const innerLength = polylineLength(inner, true);
  for (let d = 3; d < innerLength; d += 9.0) {
    const p = samplePolyline(inner, d, true);
    if (nearJunction(p.x, p.z, 2.4)) continue;
    push(p.x, p.z);
  }
  // No lamps on the plaza: the pool ring fills it, and the avenue lamps light the gate.
  return lamps;
}

/** Pedestrians walk the pavements of the ring and the avenues as one long loop. */
export function walkLoop(offset: number): XZ[] {
  return offsetPolyline(ringLine, offset);
}
/**
 * Height of the surface under a walker: the pavement, except where an avenue opens into the
 * ring. There the inner walkers step onto the avenue's kerb (0.85-1.03 from its centre line)
 * and down to the zebra at road level, and back up on the far side.
 */
export function walkFloor(x: number, z: number) {
  let d = Infinity;
  for (const a of avenues) if (a.crossing) d = Math.min(d, distanceToSegment([x, z], a.from, a.to));
  const step = (from: number, to: number) => {
    const t = Math.min(1, Math.max(0, (d - from) / (to - from)));
    return t * t * (3 - 2 * t);
  };
  const edge = ROAD_WIDTH / 2;
  return (
    terrainHeight(x, z) +
    levels.road +
    (levels.kerb - levels.road) * step(edge - 0.08, edge + 0.02) -
    (levels.kerb - levels.pavement) * step(edge + 0.14, edge + 0.22)
  );
}
export const tramLoop = ringLine;

/* ------------------------------------------------------------------ */
/* Street life                                                         */
/* ------------------------------------------------------------------ */

/** The tram's pace on the ring (units per second). The cyclist keeps the same lap time. */
export const TRAM_SPEED = 2.1;
const RING_LENGTH = polylineLength(ringLine, true);
/** Where the tram is at `time` (seconds of town time; held at 0 under reduced motion). */
export const tramPose = (time: number) => samplePolyline(tramLoop, (TRAM_SPEED * time) % RING_LENGTH, true);
/**
 * The cyclist's lane: 0.6 outside the ring's centre line. The ring runs clockwise on the map and
 * negative offsets are its outer side, so the cyclist keeps left, as in Glasgow: clear of the
 * tram's rails (0.42) and inside the kerb (0.85).
 */
export const cyclistLane = offsetPolyline(ringLine, -0.6);
const LANE_LENGTH = polylineLength(cyclistLane, true);
/**
 * Where the cyclist sets off: half a lap from the tram's start, and 1.5 further on, into the
 * south-west corner, where the Life chapter's camera sees the whole bike at time 0 (the pose
 * reduced motion holds) rather than half of it behind an outer ring tree.
 */
const CYCLIST_START = LANE_LENGTH / 2 + 1.5;
/**
 * The cyclist at `time`: about half a lap from the tram (by lap fraction, so the two never meet),
 * leaning into the four corner arcs (eased over a unit either side of each arc's start), the
 * crank turning with the distance ridden (the pedals level at time 0).
 */
export function cyclistPose(time: number) {
  const d = (TRAM_SPEED * time * LANE_LENGTH) / RING_LENGTH,
    p = samplePolyline(cyclistLane, d + CYCLIST_START, true);
  const k = Math.min(Math.abs(p.x) - (ring.hw - ring.radius), Math.abs(p.z - ring.cz) - (ring.hd - ring.radius)),
    t = Math.min(1, Math.max(0, k + 0.6));
  return { ...p, lean: 0.13 * t * t * (3 - 2 * t), crank: 3.3 * d + Math.PI / 2 };
}
/**
 * The dog walk: a slim lap of the open lawn between the corner park's east edge and the south
 * avenue's trees, 0.4 off the park, clear of the trunks and the pavements. The dog trots on a
 * lane 0.3 inside it (right of travel on the clockwise loop), a little ahead of the walker.
 */
export const dogLoop = densify(roundedRect(0.55, 3.2, 0.5, 0, 6).map(([x, z]): XZ => [x - 4.45, z + 9.25]), 0.2);
export const dogLane = offsetPolyline(dogLoop, 0.3);
const WALK_LENGTH = polylineLength(dogLoop, true),
  DOG_LENGTH = polylineLength(dogLane, true);
/** Pace (units per second), each cycle's seconds walking and standing, and the dog's lead. */
export const DOG_WALK = { speed: 0.5, walk: 11, stop: 4, lead: 0.45 };
/**
 * The walker and the dog at `time`: every 15 s they walk for 11 and stand for 4 while the dog
 * sniffs (`sniff` eases 0 to 1 and back over half a second). Time 0 falls mid-stop at the
 * loop's south end, nearest the Life camera, so reduced motion holds a still pose there.
 */
export function dogWalkPose(time: number) {
  const { speed, walk, stop, lead } = DOG_WALK,
    t = time + 1.5;
  const n = Math.floor(t / (walk + stop)),
    into = t - n * (walk + stop);
  const s = WALK_LENGTH / 2 + speed * (n * walk + Math.max(0, into - stop));
  const sniff = into < stop ? Math.min(1, into / 0.5, (stop - into) / 0.5) : 0;
  return {
    s,
    sniff,
    walker: samplePolyline(dogLoop, s, true),
    dog: samplePolyline(dogLane, ((s + lead) / WALK_LENGTH) * DOG_LENGTH, true),
  };
}
/**
 * Ducks on the gate's pool, which lies between radii 2.7 and 3.9 in four sectors centred on the
 * diagonals (the causeways cut the axes). A hen and a drake paddle one path in the south-east
 * sector, the drake 1.3 behind in phase; a lone hen keeps the south-west one. Each traces a slow
 * Lissajous about the pool's mid-line (r 3.3): `a` and `ra` are its swings in angle and radius,
 * `rate` its pace in phase per second (at most about 0.04 units per second).
 */
export const ducks = [
  { mid: Math.PI / 4, a: 0.22, ra: 0.18, q: 0, shift: 0, rate: 0.05, look: 'hen' },
  { mid: Math.PI / 4, a: 0.22, ra: 0.18, q: 0, shift: -1.3, rate: 0.05, look: 'drake' },
  { mid: (3 * Math.PI) / 4, a: 0.2, ra: 0.16, q: 1.0, shift: 2.0, rate: 0.042, look: 'hen' },
] as const;
/** Duck `i` at phase `u`: its position and heading (rotation.y, along its path). */
export function duckPose(i: number, u: number) {
  const d = ducks[i],
    v = u + d.shift,
    phi = d.mid + d.a * Math.sin(v),
    r = 3.3 + d.ra * Math.sin(2 * v + d.q);
  const dphi = d.a * Math.cos(v),
    dr = 2 * d.ra * Math.cos(2 * v + d.q),
    c = Math.cos(phi),
    s = Math.sin(phi);
  return { x: r * c, z: r * s, heading: Math.atan2(dr * c - r * s * dphi, dr * s + r * c * dphi) };
}
/**
 * The height of duck `i`'s origin (its body centre) and its forward tip (`dip`, radians about its
 * own x): a slow bob, and about every 25 s a 1.75 s tip toward the water, never in step with the
 * others and none at night (roosting). The body rises a little with the tip, so the chest stays
 * off the pool's bed (0.02); the water's surface (0.07) cuts the body below its centre.
 */
export function duckBob(i: number, time: number, night: number) {
  const f = (((time / 25 + i * 0.37) % 1) + 1) % 1;
  const bump = Math.sin(Math.PI * Math.min(1, Math.max(0, (f - 0.93) / 0.07)));
  const dip = 0.3 * (1 - night) * bump;
  return { dip, y: 0.1 + 0.006 * Math.sin(time * 1.3 + i) + 0.05 * dip };
}
/**
 * The bike rack at the Research Studio: three Sheffield hoops in a row along x on the west edge
 * of its entrance apron (centred x 5.93, at each `hoops` z, on the apron's top `y`), between the
 * bench and the canopy's south post and clear of the way from the path to the door, with bikes
 * leaning on the first two. The studio chapter (bearing -0.7) sees it beside the entrance, clear
 * of the gate's attic. It is part of the studio's shell, so it answers the pointer, rings and
 * inspects with the studio.
 */
export const bikeRack = { x: 5.93, y: 0.06, hoops: [-5.95, -5.35, -4.75], parked: [0, 1] };

/**
 * The clearing round the terrace row that the outskirts' trees keep out of (the three homes, their
 * gardens and the gaps between them); the moorland props keep out of it too.
 */
const terraceClearing = { x: terraceRow.x, z: terraceRow.z, w: 11, d: 2 * (terraceRow.spacing + 4) };
/**
 * Thistles at the foot of the paddock's dyke, in two tight clumps of four plants by its south
 * (sea) corners: 0.23-0.47 out from the wall's outer face, so each rosette (r 0.17) clears the
 * stones, off the mown lawn and away from the gate in the north wall.
 */
export const thistles: XZ[] = [
  [-13.86, 23.06],
  [-13.58, 23.0],
  [-13.68, 23.24],
  [-13.48, 23.2],
  [-9.46, 23.06],
  [-9.18, 23.0],
  [-9.28, 23.24],
  [-9.08, 23.2],
];
export type HeatherDrift = {
  id: string;
  x: number;
  z: number;
  /** The small, low tufts (world x, z and radius) that make up the drift's mat. */
  lumps: { x: number; z: number; r: number }[];
};
/** How far a drift's lumps reach from its centre. */
export const heatherReach = (d: HeatherDrift) => Math.max(...d.lumps.map((l) => Math.hypot(l.x - d.x, l.z - d.z) + l.r));
/**
 * Heather on the moor: at most 12 drifts on the four hills (never on the beach), most of them
 * small cushions of six to eight tufts and about one in three a wider patch of twelve. Candidates are
 * seeded round each hill in turn; a drift stays off the mown town lawn, the terrace, the streets
 * and the buildings, clear of the trees' trunks, the paddock, the thistles, the sheep, the stone
 * ring and, by 3.5, the other drifts.
 */
export function heatherPlan(trees: TreeSpec[] = plantingPlan()): HeatherDrift[] {
  const drifts: HeatherDrift[] = [];
  for (let i = 0; i < 1500 && drifts.length < 12; i++) {
    const m = mounds[i % mounds.length],
      ma = hash(i * 7 + 3) * Math.PI * 2,
      md = Math.sqrt(hash(i * 7 + 4)) * m.r * 0.85;
    const x = m.x + Math.cos(ma) * md,
      z = m.z + Math.sin(ma) * md,
      spin = hash(i * 7 + 6) * Math.PI * 2;
    const wide = hash(i * 7 + 2) < 0.3,
      n = wide ? 12 : 6 + Math.floor(hash(i * 7 + 1) * 3),
      spread = wide ? 0.42 : 0.3;
    // A sunflower spiral of overlapping tufts, so the drift reads as one bumpy cushion.
    const lumps = Array.from({ length: n }, (_, k) => {
      const a = spin + k * 2.4 + 0.6 * hash(i * 7 + 5 + k),
        d = spread * Math.sqrt((k + 0.3 * hash(i * 11 + k)) / n),
        r = (k === 0 ? 0.2 : 0.14) + 0.07 * hash(i * 13 + k * 5);
      return { x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, r };
    });
    const drift = { id: 'heather-' + drifts.length, x, z, lumps },
      reach = heatherReach(drift);
    if (!onIsland(x, z, 0.3 + reach) || !(terrainHeight(x, z) > 0.2)) continue;
    if (lumps.some((l) => lawnCore(l.x, l.z) > 0.02) || distanceToStreets(x, z) < 2.5) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 0.35 * t.size + 0.5 + reach)) continue;
    if (cottages.some((c) => Math.hypot(c.x - x, c.z - z) < 3.4 + reach)) continue;
    if (nearSite(x, z, 1.5 + reach) || Math.hypot(x - pier.start[0], z - pier.start[1]) < 5.5) continue;
    if (insideRect(x, z, terraceClearing, reach) || insideRect(x, z, paddock, 1.0 + reach)) continue;
    if (insideRect(x, z, reservedPlot, 1.5 + reach)) continue;
    if (thistles.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 0.5 + reach)) continue;
    if (flock.some((s) => Math.hypot(s.x - x, s.z - z) < 0.8 + reach)) continue;
    if (Math.hypot(x - stoneRing.x, z - stoneRing.z) < stoneRing.r + 2.2) continue;
    if (drifts.some((o) => Math.hypot(o.x - x, o.z - z) < 3.5)) continue;
    drifts.push(drift);
  }
  return drifts;
}

export type SheepSpec = { id: string; x: number; z: number; heading: number; grazing: boolean };
/**
 * Blackface sheep on the two empty hilltops, three on the north-west hill and two on the
 * north-east one: at least 0.9 clear of the canopies, 1.6 of the coast, 7 of the streets and
 * about 10 of the cottages. `heading` is rotation.y, so the nose points along (sin h, cos h);
 * the ones on the steeper flanks stand along the slope. From the opening bearing none stands
 * just behind a tree's top, or it would seem to perch on the canopy (sheep-0 stands beside the
 * pine tree-46, not straight behind it).
 */
export const flock: SheepSpec[] = [
  { id: 'sheep-0', x: -19.3, z: -19.8, heading: 2.3, grazing: true },
  { id: 'sheep-1', x: -21.2, z: -20.95, heading: -1.0, grazing: false },
  { id: 'sheep-2', x: -17.3, z: -20.3, heading: -2.7, grazing: true },
  { id: 'sheep-3', x: 22.5, z: -19.75, heading: -1.9, grazing: true },
  { id: 'sheep-4', x: 21.3, z: -18.6, heading: 0.6, grazing: false },
];
/** A sheep's four hooves in world x, z (local x ±0.1, z ±0.18). */
export function sheepFeet(s: SheepSpec): XZ[] {
  const c = Math.cos(s.heading),
    n = Math.sin(s.heading);
  return [[-0.1, 0.18], [0.1, 0.18], [-0.1, -0.18], [0.1, -0.18]].map(([lx, lz]) => [s.x + lx * c + lz * n, s.z - lx * n + lz * c]);
}

export type StandingStone = { x: number; z: number; ry: number; w: number; h: number; recumbent: boolean };
/**
 * The ring's stones: seven on eight slots, one long gone. As in the recumbent circles of
 * Aberdeenshire, a long stone lies on its side between the two tallest; here it is on the seaward
 * (north-north-west) side, so the opening camera sees it framed by its flankers against the sand
 * rather than behind tree-71, and the empty slot is the one that tree hides. `ry` (rotation.y)
 * turns each stone's broad face to the centre and its length along the ring.
 */
export function standingStones(): StandingStone[] {
  const stones: StandingStone[] = [];
  for (let k = 0; k < 8; k++) {
    if (k === 2) continue;
    const a = (k * Math.PI) / 4 + 0.3,
      recumbent = k === 5,
      flanker = k === 4 || k === 6;
    stones.push({
      x: stoneRing.x + Math.cos(a) * stoneRing.r,
      z: stoneRing.z + Math.sin(a) * stoneRing.r,
      ry: Math.PI / 2 - a,
      recumbent,
      w: recumbent ? 1.0 : 0.38 + 0.12 * hash(k * 3 + 1),
      h: recumbent ? 0.3 : flanker ? 1.18 + 0.07 * hash(k * 3 + 2) : 0.75 + 0.3 * hash(k * 3 + 2),
    });
  }
  return stones;
}
