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
/**
 * Position and heading at a distance along a polyline. The heading is the segment's, so it steps
 * at each vertex; with `smooth` it turns evenly through each vertex instead, over half the
 * shorter of its two segments either side, so a mover rounds a sampled arc as it would a true one.
 */
export function samplePolyline(points: XZ[], distance: number, closed = false, smooth = false) {
  const total = polylineLength(points, closed);
  let d = ((distance % total) + total) % total;
  const n = points.length,
    count = closed ? n : n - 1;
  // A neighbouring segment's length and heading, and a heading part-way from one to another.
  const segment = (i: number) => {
    const a = points[(i + n) % n],
      b = points[(i + 1) % n];
    return { length: Math.hypot(b[0] - a[0], b[1] - a[1]), heading: Math.atan2(b[0] - a[0], b[1] - a[1]) };
  };
  const turn = (from: number, to: number, w: number) => {
    const h = from + angleDiff(to, from) * w;
    return Math.atan2(Math.sin(h), Math.cos(h));
  };
  for (let i = 0; i < count; i++) {
    const a = points[i],
      b = points[(i + 1) % n];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d <= length || i === count - 1) {
      const t = length ? Math.min(1, d / length) : 0,
        along = t * length,
        heading = Math.atan2(b[0] - a[0], b[1] - a[1]);
      let h = heading;
      if (smooth && (closed || i > 0)) {
        const prev = segment(i - 1),
          half = Math.min(prev.length, length) / 2;
        if (along < half) h = turn(prev.heading, heading, 0.5 + (0.5 * along) / half);
      }
      if (smooth && (closed || i < count - 1)) {
        const next = segment(i + 1),
          half = Math.min(next.length, length) / 2;
        if (length - along < half) h = turn(heading, next.heading, 0.5 - (0.5 * (length - along)) / half);
      }
      return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, heading: h };
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
 * `nightLight` keeps a dim warm lamp in the window all night: the three whose fronts face the
 * overview camera, so the island at 02:30 (09:30 in Beijing) still shows a few warm points.
 */
export const cottages: { x: number; z: number; rotation: number; color: string; nightLight?: boolean }[] = [
  { x: -24.6, z: -10.6, rotation: Math.PI / 2 - 0.55, color: '#e1cfa8', nightLight: true },
  { x: -24.6, z: 11.6, rotation: Math.PI / 2 + 0.55, color: '#d9c39a' },
  { x: 20.5, z: 1.5, rotation: -Math.PI / 2, color: '#e4d2ad' },
  { x: 5, z: -17.5, rotation: 0, color: '#cdb48d', nightLight: true },
  { x: -6.5, z: -17.8, rotation: 0.15, color: '#e1cfa8', nightLight: true },
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
/** A small square bale beside the rack's south end, its long side along z, clear of the wall and of the calf. */
export const hayBale = { x: -13.8, z: 21.62, ry: 0.12 };
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
 * (samples 29-31) is the working quay: creels, a float and a coil on the dry sand. The dinghy side
 * (37-43) has a net drying on a frame, two strand lines of wrack, driftwood, and rock pools on the
 * wet sand against the boulder at sample 42.
 */
export const shoreProps = {
  creelStack: { i: 30.3, w: 0.8, foot: 0.51 },
  creel: { i: 30.7, w: 1.65, turn: 0, foot: 0.31 }, // square to the stack: a creel set at an angle on its own read as a chest
  floats: [{ i: 29.6, w: 0.62, foot: 0.12 }],
  coil: { i: 29.6, w: 1.45, foot: 0.23 },
  netFrame: { from: { i: 37.4, w: 0.65 }, to: { i: 39.2, w: 0.65 }, foot: 0.3 }, // a capsule: the hangs splay to 0.24, the hem floats to 0.3
  driftwood: { from: { i: 40.05, w: 1.45 }, to: { i: 41.2, w: 1.38 }, foot: 0.1, rootFoot: 0.17 }, // a capsule, the root flare at `from`
  // Tucked against the boulder at sample 42 (seaward of it and beside it), so its rock is their rim; foot = 1.3 r (stretched along the shore, ragged).
  rockPools: [{ i: 42, w: 2.0, r: 0.32, foot: 0.42 }, { i: 42.65, w: 1.5, r: 0.2, foot: 0.26 }],
  // Strand lines: ribbons of weed along the shore from sample `from` to `to` at about w (older and browner up the beach). foot: half-width, wobble and bow.
  wrack: [{ from: 38.45, to: 39.4, w: 1.66, foot: 0.17 }, { from: 39.95, to: 40.75, w: 2.62, foot: 0.17 }],
};

/* ------------------------------------------------------------------ */
/* Planting and street furniture                                       */
/* ------------------------------------------------------------------ */

export type TreeSpec = {
  x: number;
  z: number;
  size: number;
  kind: 'round' | 'pine' | 'autumn' | 'birch' | 'rowan';
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
  const parkFrom = trees.length;
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
  const scatterFrom = trees.length;
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
  return scottishSpecies(trees.filter((t) => !insideRect(t.x, t.z, paddock, 1.2)), [parkFrom, parkFrom + 4], scatterFrom);
}
/**
 * Silver birch and rowan among the outskirts' and the park's round trees. Only `kind` changes:
 * every tree keeps its place, size and id, and the ring, avenue, plaza and terrace-garden trees,
 * the pines and the autumn accents stay as they are. Both are picked by a hash of the tree's id
 * number, so dropping a tree from the plan changes no other tree's species.
 * - Rowans stand alone (none within ROWAN_APART of another) by a cottage, the paddock's edge or
 *   the park's edge, the park's own trees included.
 * - Birches stand in loose groups of two or three on the hills and towards the coast and moor:
 *   a seed tree and its nearest one or two neighbours within BIRCH_REACH.
 * Nothing changes in the terrace clearing.
 */
const ROWANS = 6,
  ROWAN_APART = 5,
  BIRCHES = 9,
  BIRCH_REACH = 4.6;
function scottishSpecies(trees: TreeSpec[], parkIds: [number, number], scatterFrom: number) {
  const number = (t: TreeSpec) => Number(t.id.slice(5)),
    gap = (t: TreeSpec, r: { x: number; z: number; w: number; d: number }) =>
      Math.hypot(Math.max(0, Math.abs(t.x - r.x) - r.w / 2), Math.max(0, Math.abs(t.z - r.z) - r.d / 2)),
    inPark = (t: TreeSpec) => number(t) >= parkIds[0] && number(t) < parkIds[1],
    byHash = (seed: number) => (a: TreeSpec, b: TreeSpec) => hash(number(a) * 13 + seed) - hash(number(b) * 13 + seed);
  // The round trees that may change: not an accent (treeLook turns every 23rd), not in the clearing.
  const open = trees.filter(
    (t) =>
      t.kind === 'round' &&
      (number(t) * 7) % 23 !== 0 &&
      (number(t) >= scatterFrom || inPark(t)) &&
      !insideRect(t.x, t.z, terraceClearing, 1.5),
  );
  const rowanSpot = (t: TreeSpec) =>
    inPark(t) || gap(t, park) < 3 || gap(t, paddock) < 3 || cottages.some((c) => Math.hypot(c.x - t.x, c.z - t.z) < 5);
  const rowans: TreeSpec[] = [];
  for (const t of open.filter(rowanSpot).sort(byHash(5)))
    if (rowans.length < ROWANS && rowans.every((r) => Math.hypot(r.x - t.x, r.z - t.z) >= ROWAN_APART)) rowans.push(t);
  const wild = (t: TreeSpec) =>
    !rowans.includes(t) && (terrainHeight(t.x, t.z) > 0.1 || islandRadius(Math.atan2(t.z, t.x)) - Math.hypot(t.x, t.z) < 7.5);
  const birches: TreeSpec[] = [];
  for (const seed of open.filter(wild).sort(byHash(9))) {
    if (birches.length >= BIRCHES - 1 || birches.includes(seed)) continue;
    const want = hash(number(seed) * 13 + 1) < 0.5 ? 2 : 3,
      group = [seed, ...open
        .filter((t) => t !== seed && !rowans.includes(t) && !birches.includes(t) && Math.hypot(t.x - seed.x, t.z - seed.z) < BIRCH_REACH)
        .sort((a, b) => Math.hypot(a.x - seed.x, a.z - seed.z) - Math.hypot(b.x - seed.x, b.z - seed.z))]
        .slice(0, Math.min(want, BIRCHES - birches.length));
    if (group.length >= 2) birches.push(...group);
  }
  return trees.map((t) => (rowans.includes(t) ? { ...t, kind: 'rowan' as const } : birches.includes(t) ? { ...t, kind: 'birch' as const } : t));
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
 * and down to the zebra at road level, and back up on the far side. Where the kerb is dropped
 * at the zebras (droppedFloor) they walk down its ramp and over the tactile slabs instead.
 */
export function walkFloor(x: number, z: number) {
  const dropped = droppedFloor(x, z);
  if (dropped !== undefined) return terrainHeight(x, z) + dropped;
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

/** The tram's cruising pace on the ring (units per second). The cyclist keeps the same lap time. */
export const TRAM_SPEED = 2.1;
const RING_LENGTH = polylineLength(ringLine, true);
/** Half the distance between the tram's two bogies (its skirts at z ±1.1 in buildTram). */
const TRAM_BOGIE = 1.1;
/**
 * The cyclist's lane: 0.6 outside the ring's centre line. The ring runs clockwise on the map and
 * negative offsets are its outer side, so the cyclist keeps left, as in Glasgow: clear of the
 * tram's rails (0.42) and inside the kerb (0.85).
 */
export const cyclistLane = offsetPolyline(ringLine, -0.6);
const LANE_LENGTH = polylineLength(cyclistLane, true);
/**
 * Where the cyclist is at time 0 (the pose reduced motion holds): just into the south-west corner,
 * where the Life chapter's camera sees the whole bike rather than half of it behind an outer ring
 * tree. Everything else in the timetable below is measured from here.
 */
const CYCLIST_START = LANE_LENGTH / 2 + 1.5;

/* ------------------------------------------------------------------ */
/* Traffic signals and the rules of the road                           */
/* ------------------------------------------------------------------ */

/**
 * UK signals where the three avenues meet the ring (the north avenue ends at the Town Hall and
 * has none). Every junction runs the same cycle: the ring approach shows green, then amber, then
 * red; after a second of all-red the avenue shows red+amber, green and amber; after another second
 * of all-red the ring shows red+amber and then green again. The ring gets the larger share of the
 * green. `period` (P) is the sum of the parts: change the greens to change it.
 */
export const SIGNAL = (() => {
  const parts = { ringGreen: 5, avenueGreen: 3, amber: 3, allRed: 1, redAmber: 2 };
  return { ...parts, period: parts.ringGreen + parts.avenueGreen + 2 * (parts.amber + parts.allRed + parts.redAmber) };
})();
/** A signal's aspect: the UK sequence runs green, amber, red, red+amber, green. */
export type Aspect = 'green' | 'amber' | 'red' | 'redAmber';
export type Approach = 'ring' | 'avenue';
export type JunctionId = 'south' | 'west' | 'east';
/** The ring approach's aspect `u` seconds into its junction's cycle (its green comes on at 0). */
function ringAspect(u: number): Aspect {
  const { ringGreen, amber, redAmber, period } = SIGNAL;
  return u < ringGreen ? 'green' : u < ringGreen + amber ? 'amber' : u < period - redAmber ? 'red' : 'redAmber';
}
/** The avenue approach's aspect `u` seconds into the cycle: red all through the ring's turn and the all-reds. */
function avenueAspect(u: number): Aspect {
  const { ringGreen, avenueGreen, amber, allRed, redAmber } = SIGNAL,
    v = u - (ringGreen + amber + allRed);
  return v < 0 ? 'red' : v < redAmber ? 'redAmber' : v < redAmber + avenueGreen ? 'green' : v < redAmber + avenueGreen + amber ? 'amber' : 'red';
}
/** Distance along a closed polyline to the point on it nearest `p`. */
function alongPolyline(points: XZ[], p: XZ) {
  let best = Infinity,
    at = 0,
    walked = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length],
      length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d = distanceToSegment(p, a, b);
    if (d < best) {
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (length * length || 1)));
      best = d;
      at = walked + t * length;
    }
    walked += length;
  }
  return at;
}
/**
 * The signalled junctions: the centre `at`, the avenue's direction out of the plaza `u`, the
 * clockwise ring traffic's direction there `t` (every junction lies on a straight run of the ring),
 * and how far round the ring and the cyclist's lane it lies.
 */
export const signalJunctions = avenues
  .filter((a) => a.crossing)
  .map((a) => {
    const length = Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]),
      u: XZ = [(a.to[0] - a.from[0]) / length, (a.to[1] - a.from[1]) / length],
      ringAt = alongPolyline(ringLine, a.to),
      { heading } = samplePolyline(ringLine, ringAt, true);
    return {
      id: a.id as JunctionId,
      at: a.to,
      from: a.from,
      length,
      u,
      t: [Math.sin(heading), Math.cos(heading)] as XZ,
      ring: ringAt,
      lane: alongPolyline(cyclistLane, a.to),
    };
  });
const junctionById = (id: JunctionId) => signalJunctions.find((j) => j.id === id)!;
/**
 * The white stop lines: across the ring's whole carriageway `setback` before each junction's
 * centre (its middle; `width` wide), and across the avenue's outbound lane `avenueBack` short of
 * the avenue's end, on the plaza side of its zebra. Vehicles stop `gap` short of the line.
 */
export const STOP_LINE = { setback: 1.55, avenueBack: 2.55, width: 0.12, gap: 0.05 };
/**
 * The signal posts, just past their stop lines: the ring's on its near-side (left, outer) kerb
 * `ringSetback` before the junction's centre and `ringOffset` out from the ring's centre line, the
 * avenue's on the avenue's left pavement `avenueBack` short of its end, `avenueOffset` from its
 * centre line. Both offsets keep the posts between the kerb (to 1.03) and the walkers (1.62).
 */
export const SIGNAL_POST = { ringSetback: 1.25, ringOffset: 1.22, avenueBack: 2.25, avenueOffset: 1.2 };
/**
 * The clearing round the terrace row that the outskirts' trees keep out of (the three homes, their
 * gardens and the gaps between them); the moorland props and the signals keep out of it too.
 */
const terraceClearing = { x: terraceRow.x, z: terraceRow.z, w: 11, d: 2 * (terraceRow.spacing + 4) };
export type SignalPost = { junction: JunctionId; approach: Approach; x: number; z: number; facing: XZ; heading: number };
/**
 * Two signals per junction, each facing the traffic it controls: the ring's faces the clockwise
 * traffic coming up to the junction, the avenue's the traffic coming out from the plaza. The west
 * junction's ring signal would stand on the outer pavement in front of the terrace's gardens, in
 * the clearing the homes keep (terraceClearing), so it stands on the inner kerb instead, as an
 * offside primary does. `heading` is rotation.y turning a post's local +z (its lenses) to `facing`.
 */
export const signalPosts: SignalPost[] = signalJunctions.flatMap((j) => {
  const { ringSetback, ringOffset, avenueBack, avenueOffset } = SIGNAL_POST,
    inner: XZ = [-j.t[1], j.t[0]], // right of the ring traffic: into the ring
    left: XZ = [j.u[1], -j.u[0]]; // left of the avenue traffic leaving the plaza
  const ringAt = (side: number): XZ => [
    j.at[0] - j.t[0] * ringSetback + inner[0] * ringOffset * side,
    j.at[1] - j.t[1] * ringSetback + inner[1] * ringOffset * side,
  ];
  const outer = ringAt(-1),
    [rx, rz] = insideRect(outer[0], outer[1], terraceClearing, 0.5) ? ringAt(1) : outer,
    along = j.length - avenueBack,
    ax = j.from[0] + j.u[0] * along + left[0] * avenueOffset,
    az = j.from[1] + j.u[1] * along + left[1] * avenueOffset;
  const post = (approach: Approach, x: number, z: number, facing: XZ): SignalPost => ({
    junction: j.id,
    approach,
    x,
    z,
    facing,
    heading: Math.atan2(facing[0], facing[1]),
  });
  return [post('ring', rx, rz, [-j.t[0], -j.t[1]]), post('avenue', ax, az, [-j.u[0], -j.u[1]])];
});
/**
 * The stop lines as boxes: centre, the direction of the traffic they stop (`along`, the line's
 * thin side) and their length across the road.
 */
export const stopLines = signalJunctions.flatMap((j) => {
  const { setback, avenueBack } = STOP_LINE,
    left: XZ = [j.u[1], -j.u[0]],
    half = ROAD_WIDTH / 2;
  return [
    { junction: j.id, approach: 'ring' as Approach, x: j.at[0] - j.t[0] * setback, z: j.at[1] - j.t[1] * setback, along: j.t, length: ROAD_WIDTH - 0.1 },
    {
      junction: j.id,
      approach: 'avenue' as Approach,
      x: j.from[0] + j.u[0] * (j.length - avenueBack) + left[0] * (half / 2 + 0.005),
      z: j.from[1] + j.u[1] * (j.length - avenueBack) + left[1] * (half / 2 + 0.005),
      along: j.u,
      length: half - 0.11,
    },
  ];
});

/**
 * The rules of the road. The tram and the cyclist run clockwise and each obeys the ring signals:
 * once a lap it comes up to the east junction on red, brakes to a stop with its front at the stop
 * line, waits, and moves off REACT seconds after its green comes on; at the south and west
 * junctions it always meets green, mid-way through it. Everything is a pure function of town
 * time: no state is kept from frame to frame, so reduced motion (time held at 0), Inspect, the
 * checks and the reading camera all see the same thing.
 *
 * Periodic by construction: a lap, with its wait and the time lost braking and pulling away, takes
 * exactly LAP = 3 x SIGNAL.period seconds and every lap is the same. Each vehicle's wait is what is
 * left of LAP after its drive (its timetable's `wait`). The cyclist rides a cycle ahead of the tram:
 * it stops at the east junction one cycle before the tram does, about a third of a lap away (the
 * two keep at least 20 apart; half a lap would need LAP = 2 or 4 cycles, a much faster or slower
 * ride). The junctions' offsets follow from that timetable (signalOffsets below), so changing
 * SIGNAL, LAP, a speed or a start re-solves them; check-town proves the result.
 */
export const LAP = 3 * SIGNAL.period;
/** Seconds between a vehicle's green coming on and its moving off. */
const REACT = 0.5;
/** The junction where both vehicles stop each lap: the one the opening overview shows clear of the hero copy on most screens. */
export const STOP_JUNCTION: JunctionId = 'east';
/**
 * How each vehicle drives: its cruising `speed`, the distances over which it brakes to a stop and
 * pulls away again (`brake`, `pull`; the speed eases along a smoothstep in time, so neither end has
 * a jolt), and its `nose`, how far its front reaches ahead of the point its pose is taken at: the
 * tram's front bogie plus its overhang (the lamps at z 1.8, r 0.09), the bike's front tyre.
 */
export const TRAM_DRIVE = { speed: TRAM_SPEED, brake: 1.5, pull: 1.5, nose: TRAM_BOGIE + 0.79 };
export const CYCLIST_DRIVE = { speed: (TRAM_SPEED * LANE_LENGTH) / RING_LENGTH, brake: 1.2, pull: 1.2, nose: 0.45 };
type Drive = typeof TRAM_DRIVE;
/**
 * A vehicle's timetable: it moves off its stop at time `go` (and every LAP after), from distance
 * `stopAt` round its path (and one `length` further each lap). Pulling away takes 2 pull / speed
 * seconds, braking 2 brake / speed, and it stands for `wait`.
 */
function timetable(drive: Drive, length: number, stopAt: number, go: number) {
  const pulling = (2 * drive.pull) / drive.speed,
    braking = (2 * drive.brake) / drive.speed,
    cruising = (length - drive.pull - drive.brake) / drive.speed;
  return { ...drive, length, stopAt, go, pulling, cruising, braking, wait: LAP - pulling - cruising - braking };
}
export type Timetable = ReturnType<typeof timetable>;
/** Distance round its path at `time`: pull away, cruise, brake, stand; the same every lap. */
export function driveDistance(tt: Timetable, time: number) {
  const lap = Math.floor((time - tt.go) / LAP),
    s = time - tt.go - lap * LAP,
    { pull, brake, speed, pulling, cruising, braking, length } = tt;
  let along: number;
  if (s < pulling) {
    const x = s / pulling;
    along = pull * x * x * x * (2 - x); // speed × smoothstep(x)
  } else if (s < pulling + cruising) along = pull + speed * (s - pulling);
  else if (s < pulling + cruising + braking) {
    const x = (s - pulling - cruising) / braking;
    along = length - brake + brake * x * (2 - 2 * x * x + x * x * x); // speed × (1 - smoothstep(x))
  } else along = length;
  return tt.stopAt + lap * length + along;
}
/** The near edge of a junction's ring stop line, as a distance round a path that passes it at `at`. */
const lineEdge = (at: number) => at - STOP_LINE.setback - STOP_LINE.width / 2;
/**
 * The cyclist cruises through CYCLIST_START at time 0, reaches the east stop line `gap` further on
 * (braking over its last `brake`), stands, and moves off at `go`; the tram moves off the same stop
 * one cycle later.
 */
const cyclistStop = lineEdge(junctionById(STOP_JUNCTION).lane) - STOP_LINE.gap - CYCLIST_DRIVE.nose,
  cyclistGap = (((cyclistStop - CYCLIST_START) % LANE_LENGTH) + LANE_LENGTH) % LANE_LENGTH,
  cyclistWait = timetable(CYCLIST_DRIVE, LANE_LENGTH, 0, 0).wait,
  cyclistGo = (cyclistGap + CYCLIST_DRIVE.brake) / CYCLIST_DRIVE.speed + cyclistWait;
export const CYCLIST_TIMETABLE = timetable(CYCLIST_DRIVE, LANE_LENGTH, CYCLIST_START + cyclistGap, cyclistGo);
export const TRAM_TIMETABLE = timetable(
  TRAM_DRIVE,
  RING_LENGTH,
  lineEdge(junctionById(STOP_JUNCTION).ring) - STOP_LINE.gap - TRAM_DRIVE.nose,
  cyclistGo + SIGNAL.period,
);
/** The tram's distance round the ring (its bogies' midpoint) and the cyclist's round its lane, at `time`. */
export const tramDistance = (time: number) => driveDistance(TRAM_TIMETABLE, time);
export const cyclistDistance = (time: number) => driveDistance(CYCLIST_TIMETABLE, time);
/**
 * When a vehicle's front crosses a junction's ring stop line, in seconds after it moves off (it is
 * cruising by then), with `at` the junction's distance round the vehicle's path.
 */
function passAfterGo(tt: Timetable, at: number) {
  const ahead = (((lineEdge(at) - tt.nose - tt.stopAt) % tt.length) + tt.length) % tt.length;
  return tt.pulling + (ahead - tt.pull) / tt.speed;
}
/**
 * Each junction's offset: when its ring green comes on, in seconds of the cycle. At the stop
 * junction the green comes on REACT before the vehicles move off; elsewhere the green is centred
 * on the two vehicles' passes (a cycle apart in time, so a fraction of a second apart in phase).
 */
export const signalOffsets = Object.fromEntries(
  signalJunctions.map((j) => {
    const P = SIGNAL.period,
      wrap = (t: number) => ((t % P) + P) % P;
    if (j.id === STOP_JUNCTION) return [j.id, wrap(CYCLIST_TIMETABLE.go - REACT)];
    const tram = TRAM_TIMETABLE.go + passAfterGo(TRAM_TIMETABLE, j.ring),
      bike = CYCLIST_TIMETABLE.go + passAfterGo(CYCLIST_TIMETABLE, j.lane),
      apart = wrap(bike - tram + P / 2) - P / 2;
    return [j.id, wrap(tram + apart / 2 - SIGNAL.ringGreen / 2)];
  }),
) as Record<JunctionId, number>;
/** What a junction's signal shows its approach at `time` (seconds of town time). */
export function signalState(junction: JunctionId, approach: Approach, time: number): Aspect {
  const P = SIGNAL.period,
    u = (((time - signalOffsets[junction]) % P) + P) % P;
  return approach === 'ring' ? ringAspect(u) : avenueAspect(u);
}

/**
 * Where the tram is at `time` (seconds of town time; held at 0 under reduced motion), as its
 * timetable drives it. Like a real tram it rides on two bogies that both stay on the rails: the
 * body sits midway between them and faces from the rear one to the front one, so it swings round
 * each corner arc as one smooth turn instead of stepping 9° at every sample of the arc, and its
 * ends overhang the curve as a long car's do.
 */
export const tramPose = (time: number) => {
  const d = tramDistance(time),
    front = samplePolyline(tramLoop, d + TRAM_BOGIE, true),
    rear = samplePolyline(tramLoop, d - TRAM_BOGIE, true);
  return {
    x: (front.x + rear.x) / 2,
    z: (front.z + rear.z) / 2,
    heading: Math.atan2(front.x - rear.x, front.z - rear.z),
  };
};
/**
 * The cyclist at `time`, as its timetable drives it: steering evenly round the four corner arcs (a
 * smooth heading, not one 9° step per sample) and leaning into them (eased over a unit either side
 * of each arc's start), the crank turning with the distance ridden, so it stands still while the
 * bike waits at a red (the pedals level at time 0).
 */
export function cyclistPose(time: number) {
  const d = cyclistDistance(time),
    p = samplePolyline(cyclistLane, d, true, true);
  const k = Math.min(Math.abs(p.x) - (ring.hw - ring.radius), Math.abs(p.z - ring.cz) - (ring.hd - ring.radius)),
    t = Math.min(1, Math.max(0, k + 0.6));
  return { ...p, lean: 0.13 * t * t * (3 - 2 * t), crank: 3.3 * (d - CYCLIST_START) + Math.PI / 2 };
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
 * sniffs (`sniff` eases 0 to 1 and back over half a second). Both turn evenly round the loop's
 * ends (smooth headings: the corners are sampled in 15° steps, too coarse to show close up). Time 0
 * falls mid-stop at the loop's south end, nearest the Life camera, so reduced motion holds a still
 * pose there.
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
    walker: samplePolyline(dogLoop, s, true, true),
    dog: samplePolyline(dogLane, ((s + lead) / WALK_LENGTH) * DOG_LENGTH, true, true),
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
  return { dip, y: DUCK_REST + 0.006 * Math.sin(time * 1.3 + i) + 0.05 * dip };
}
/** A duck's body centre at rest: as low as its bob keeps its chest off the bed (0.02), so the surface (0.07) cuts its side about a third of the way up. */
export const DUCK_REST = 0.0965;
/**
 * The bike rack at the Research Studio: two Sheffield hoops in a row along x on the west edge of
 * its entrance apron (centred x 5.93, at each `hoops` z, on the apron's top `y`), between the
 * bench and the canopy's south post and clear of the way from the path to the door, with a bike
 * leaning on each. The studio chapter (bearing -0.7) sees it beside the entrance, clear of the
 * gate's attic. (An empty third hoop stood alone beside the attic's finial there and read as a
 * dark hook or a cane handle.) It is part of the studio's shell, so it answers the pointer, rings
 * and inspects with the studio.
 */
export const bikeRack = { x: 5.93, y: 0.06, hoops: [-5.95, -5.35], parked: [0, 1] };

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

/* ------------------------------------------------------------------ */
/* Street details: plaza granite, dropped kerbs, covers and wear      */
/* ------------------------------------------------------------------ */

/**
 * The plaza's granite, as the paving shader lays it by world position: flags in concentric rings
 * round the gate (`ring` wide, about `flag` long, every other ring offset by half a flag; the
 * outermost from the pool's outer coping to `setts` is narrower), and a band of darker setts
 * (`settRows` rows, about `sett` long) from `setts` out to the kerb ring at `rim`, the band the
 * avenues and the forecourt meet. The rings' joints fall on the pool copings' edges (2.4, and
 * `coping`, town-shared's POOL.outer + POOL.coping), so `ring` must divide both.
 */
export const PLAZA_PAVING = { rim: 5.1, setts: 4.72, coping: 4.2, ring: 0.6, flag: 0.9, sett: 0.24, settRows: 2 };
/**
 * UK dropped kerbs at the zebras. At each end of a crossing (on the ring's inner pavement, where
 * the walkers cross the avenue) the avenue's kerb drops to `top`, 0.02 over the road, along the
 * whole width of the ring's inner pavement; that pavement drops with it, its first `tactile` out
 * from the avenue's line laid in buff blister slabs, then ramps back up to the pavement by `ramp`.
 * The ring's own kerb keeps its height beside it.
 */
export const DROPPED_KERB = { top: 0.04, kerb: ROAD_WIDTH / 2 + 0.18, tactile: 1.51, ramp: 2.0 };
/** Each crossing's drop: its avenue, and the stretch of that avenue (from `from`) the drop spans: the ring's inner pavement. */
export const droppedCrossings = signalJunctions.map((j) => ({
  junction: j.id,
  from: j.from,
  u: j.u,
  along: [j.length - (ROAD_WIDTH / 2 + PAVEMENT_WIDTH), j.length - (ROAD_WIDTH / 2 + 0.09)] as XZ,
}));
/**
 * The walking surface's height above the terrain inside a dropped crossing (the road, the kerb's
 * small step up to `top`, the tactile slabs, the ramp), or undefined outside one. The ramp is a
 * smoothstep, flat where it meets the pavement and the slabs; the geometry follows it in three steps.
 */
export function droppedFloor(x: number, z: number): number | undefined {
  const { top, tactile, ramp } = DROPPED_KERB,
    edge = ROAD_WIDTH / 2,
    ease = (from: number, to: number, v: number) => {
      const t = Math.min(1, Math.max(0, (v - from) / (to - from)));
      return t * t * (3 - 2 * t);
    };
  for (const d of droppedCrossings) {
    const dx = x - d.from[0],
      dz = z - d.from[1],
      along = dx * d.u[0] + dz * d.u[1],
      c = Math.abs(dx * d.u[1] - dz * d.u[0]);
    if (along < d.along[0] || along > d.along[1] || c > ramp) continue;
    return levels.road + (top - levels.road) * ease(edge - 0.08, edge + 0.02, c) + (levels.pavement - top) * ease(tactile, ramp, c);
  }
  return undefined;
}
/** The pavement's top above the terrain: lower in a dropped crossing. Things standing on the pavement stand on this. */
export const pavementTop = (x: number, z: number) => droppedFloor(x, z) ?? levels.pavement;
/**
 * The roads' own coordinates: `along` the centre line (the ring from ringLine[0], clockwise, as
 * the tram runs; an avenue from its plaza end, `from`) and `across` it, positive to the right of
 * that direction (the ring's inner side; an avenue's inbound lane). The road ribbons carry the same
 * pair in their uv (an avenue's along plus 1000 × its place in ROADS), so the road shader's wear
 * lines up with these.
 */
export type RoadId = 'ring' | JunctionId;
export const ROADS: RoadId[] = ['ring', 'south', 'west', 'east'];
export type RoadSpot = { road: RoadId; along: number; across: number; x: number; z: number; heading: number };
export function roadSpot(road: RoadId, along: number, across: number): RoadSpot {
  let x: number, z: number, heading: number;
  if (road === 'ring') ({ x, z, heading } = samplePolyline(ringLine, along, true));
  else {
    const a = avenues.find((v) => v.id === road)!,
      length = Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]);
    heading = Math.atan2(a.to[0] - a.from[0], a.to[1] - a.from[1]);
    x = a.from[0] + ((a.to[0] - a.from[0]) * along) / length;
    z = a.from[1] + ((a.to[1] - a.from[1]) * along) / length;
  }
  // Right of travel: (-cos h, sin h) for a heading h measured as atan2(dx, dz).
  return { road, along, across, x: x - Math.cos(heading) * across, z: z + Math.sin(heading) * across, heading };
}
/**
 * Manhole covers: round, flush, dark iron with a raised rim and a grid of lugs, drawn by the road
 * shader at these points (city-materials' COVERS). On the ring they lie in the lanes outside the
 * tram's rails (±0.42), 0.65 out, never between them, about every 12-20 units and on either side
 * at random; each avenue has one in a lane, off its centre dashes. None in a junction, on a stop
 * line or a zebra, nor beside a signal.
 */
export const MANHOLE = { radius: 0.14 };
export const manholes: RoadSpot[] = (
  [
    ['ring', 6.1, 0.65],
    ['ring', 20.4, -0.65],
    ['ring', 39.0, 0.65],
    ['ring', 52.4, -0.65],
    ['ring', 69.4, -0.65],
    ['ring', 82.7, 0.65],
    ['ring', 102.2, -0.65],
    ['south', 5.6, 0.42],
    ['west', 3.0, -0.42],
    ['east', 6.9, 0.42],
  ] as const
).map(([road, along, across]) => roadSpot(road, along, across));
/**
 * Drain gullies: small iron gratings (`length` along the kerb, `width` out from it) in the gutter,
 * their outer edge 0.01 off the kerb's face, every 8-10 units along both kerbs of the ring and one
 * a side on each avenue. Each one steps on until it is clear of the lamps' and signals' bases (0.8
 * centre to centre), the stop lines and zebras (0.3) and, on the ring's inner kerb, the avenue
 * mouths, where that kerb stops.
 */
export const GULLY = { length: 0.26, width: 0.13, across: ROAD_WIDTH / 2 - 0.01 - 0.065 };
/** A zebra's block on its avenue: 0.9 along it, 1.32 across, centred on the ring's inner pavement. */
export const zebras = signalJunctions.map((j) => {
  const along = j.length - (ROAD_WIDTH / 2 + PAVEMENT_WIDTH / 2);
  return { junction: j.id, x: j.from[0] + j.u[0] * along, z: j.from[1] + j.u[1] * along, u: j.u, half: [0.45, 0.66] as XZ };
});
/** Signed distance from a point to a rectangle centred at (x, z), half-sizes `half` along u and across it. */
export function toRect(px: number, pz: number, r: { x: number; z: number; u: XZ; half: XZ }) {
  const a = Math.abs((px - r.x) * r.u[0] + (pz - r.z) * r.u[1]) - r.half[0],
    c = Math.abs((px - r.x) * r.u[1] - (pz - r.z) * r.u[0]) - r.half[1];
  return Math.hypot(Math.max(a, 0), Math.max(c, 0)) + Math.min(Math.max(a, c), 0);
}
/** A stop line as a rectangle (its `along` is the traffic's way, the line's thin side). */
export const stopLineRect = (l: (typeof stopLines)[number]) => ({ x: l.x, z: l.z, u: l.along, half: [STOP_LINE.width / 2, l.length / 2] as XZ });
/** A gully as a rectangle. */
export const gullyRect = (g: RoadSpot) => ({ x: g.x, z: g.z, u: [Math.sin(g.heading), Math.cos(g.heading)] as XZ, half: [GULLY.length / 2, GULLY.width / 2] as XZ });
export function gullyClear(g: RoadSpot, lamps = lampPlan()) {
  const r = gullyRect(g),
    corners = [-1, 1].flatMap((a) => [-1, 1].map((c): XZ => [r.x + r.u[0] * a * r.half[0] + r.u[1] * c * r.half[1], r.z + r.u[1] * a * r.half[0] - r.u[0] * c * r.half[1]]));
  if (lamps.some((l) => Math.hypot(l.x - g.x, l.z - g.z) < 0.8)) return false;
  if (signalPosts.some((p) => Math.hypot(p.x - g.x, p.z - g.z) < 0.8)) return false;
  for (const [x, z] of corners) {
    if (stopLines.some((l) => toRect(x, z, stopLineRect(l)) < 0.3)) return false;
    if (zebras.some((zb) => toRect(x, z, zb) < 0.3)) return false;
  }
  // The ring's inner kerb opens at each avenue mouth (to 1.03 either side of the avenue's line).
  if (g.road === 'ring' && g.across > 0 && signalJunctions.some((j) => Math.abs(((g.along - j.ring + RING_LENGTH / 2) % RING_LENGTH + RING_LENGTH) % RING_LENGTH - RING_LENGTH / 2) < 2.2)) return false;
  return true;
}
export const gullies: RoadSpot[] = (() => {
  const out: RoadSpot[] = [],
    lamps = lampPlan();
  for (const side of [1, -1]) {
    const first = side > 0 ? 1.4 : 5.3;
    for (let s = first, k = 0; s < first + RING_LENGTH - 7.6; k++) {
      let g = roadSpot('ring', s, side * GULLY.across);
      while (!gullyClear(g, lamps)) g = roadSpot('ring', (s += 0.2), side * GULLY.across);
      if (s >= first + RING_LENGTH - 7.6) break;
      out.push(roadSpot('ring', s % RING_LENGTH, side * GULLY.across));
      s += 8.3 + 1.4 * hash(k * 5 + (side > 0 ? 1 : 2));
    }
  }
  for (const road of ['south', 'west', 'east'] as const)
    for (const [along, side] of [[3.7, 1], [4.4, -1]] as const) out.push(roadSpot(road, along, side * GULLY.across));
  return out;
})();
/**
 * Road wear, drawn by the road shader and kept very faint: two or three repair patches of fresher
 * asphalt (on straight runs, as world rectangles x0, z0, x1, z1), plus the darker wheel tracks and
 * the waiting stains behind the stop lines, which follow the cyclist's lane, the rails and
 * stopLines by themselves. A patch keeps clear of the covers, gullies, stop lines and zebras.
 */
export const roadPatches = (
  [
    ['ring', [10.6, 11.9], [-0.75, -0.2]],
    ['ring', [94.6, 96.4], [-0.55, 0.62]],
    ['west', [6.2, 7.3], [0.12, 0.78]],
  ] as const
).map(([road, [s0, s1], [c0, c1]]) => {
  const corners = [roadSpot(road, s0, c0), roadSpot(road, s1, c1)];
  return {
    road,
    along: [s0, s1] as XZ,
    across: [c0, c1] as XZ,
    box: [Math.min(corners[0].x, corners[1].x), Math.min(corners[0].z, corners[1].z), Math.max(corners[0].x, corners[1].x), Math.max(corners[0].z, corners[1].z)],
  };
});
/**
 * The lighthouse on its rock, local to plan.lighthouseRock (y up). Bearings a point along
 * (sin a, cos a): the door faces the overview, the yard's gate and landing stair face the beach.
 * Heights: the yard floor, the parapet's top (under its cope), the door's head, the red bands,
 * the gallery's underside and floor, the glazing and the dome's rise. Each window is a bearing,
 * a height and whether it is the beacon window (lit all night). Radii: the platform's top and
 * foot, the parapet's inner and outer faces.
 */
export const LIGHTHOUSE = {
  door: 0.8,
  landward: Math.PI,
  floor: 0.7,
  platform: [1.6, 1.72] as XZ,
  wall: [1.4, 1.6] as XZ,
  wallTop: 1.0,
  gate: 0.6,
  lintel: 1.6,
  bands: [[1.8, 2.2], [2.84, 3.24]] as XZ[],
  windows: [[0.8, 2.52, true], [2.1, 1.42, false], [-0.5, 2.52, false], [3.4, 1.42, false]] as [number, number, boolean][],
  gallery: 3.8,
  deck: 4.0,
  glazing: [4.26, 5.0] as XZ,
  domeRise: 0.36,
};
/**
 * The pier's timber deck and its stone quay head, pier-local (x across, + towards the hut; z out
 * to sea; y up). The deck's planks stand `deck` high on piles (the pile rows `piles` along z, at
 * x ±`pileX`), 0.45 higher than the first deck so the piles and their cross-bracing show above
 * the water. The quay head the deck lands on spans x `quay.x` and z `quay.z` to 0, with `quay.steps`
 * steps of `quay.tread` down its landward face to the grass, `quay.width` wide. The ladder hangs
 * on the pier head's end, its stiles at x `ladder.x` ± `ladder.half`.
 */
export const PIER_DECK = {
  deck: 0.65,
  piles: [0.9, 2.2, 3.5, 4.8, 6.1],
  pileX: 0.72,
  quay: { x: [-0.95, 0.9] as XZ, z: -1.0, steps: 3, tread: 0.26, width: 0.9 },
  ladder: { x: -0.25, half: 0.21 },
};
