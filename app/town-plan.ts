import type { BuildingId } from './city-data';
import type { DistrictId } from './city-districts';

/**
 * The plan of the town: one island, one plaza around the gate, a ring road,
 * four avenues, a crescent of homes, a harbour and a few hills.
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
  { x: -24, z: 12, r: 4.5, h: 0.6 },
  { x: 23, z: 4, r: 4, h: 0.5 },
];
export function terrainHeight(x: number, z: number) {
  let y = 0;
  for (const m of mounds) {
    const d = Math.hypot(x - m.x, z - m.z) / m.r;
    if (d < 1) y += m.h * (1 - d * d) ** 2;
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
export const levels = { road: 0.02, pavement: 0.06, plaza: 0.06 };

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
const crescent = { x: -29, z: 1, r: 8.2 };
function crescentUnit(id: BuildingId, theta: number): Site {
  return {
    id,
    x: crescent.x + crescent.r * Math.cos(theta),
    z: crescent.z + crescent.r * Math.sin(theta),
    rotation: Math.atan2(Math.cos(theta), Math.sin(theta)),
    w: 2.6,
    d: 4.2,
    height: 3.3,
  };
}
export const sites: Record<BuildingId, Site> = {
  'lius-gate': { id: 'lius-gate', x: 0, z: 0, rotation: 0, w: 4.8, d: 1.9, height: 6 },
  'town-hall': { id: 'town-hall', x: 0, z: -8.6, rotation: 0, w: 7.4, d: 4.6, height: 9.5 },
  'pengyuan-liu': crescentUnit('pengyuan-liu', -0.5),
  'yunlong-liu': crescentUnit('yunlong-liu', 0),
  'qin-li': crescentUnit('qin-li', 0.5),
  'research-studio': { id: 'research-studio', x: 10.2, z: -5, rotation: -Math.PI / 2, w: 5.6, d: 5.2, height: 5 },
  'city-archive': { id: 'city-archive', x: 9.4, z: 9.2, rotation: -Math.PI / 2, w: 6.2, d: 4.8, height: 4.2 },
};
export const siteList = Object.values(sites);
export const park = { x: -9.6, z: 9.2, w: 8.4, d: 5.4 };
export const reservedPlot = { x: 21, z: -7.5, w: 5, d: 5 };
export const cottages: { x: number; z: number; rotation: number; color: string }[] = [
  { x: -21.5, z: -9.5, rotation: Math.PI / 2, color: '#e1cfa8' },
  { x: -21, z: 10.5, rotation: Math.PI / 2 + 0.3, color: '#d9c39a' },
  { x: 19.5, z: 1.5, rotation: -Math.PI / 2, color: '#e4d2ad' },
  { x: 5, z: -17.5, rotation: 0, color: '#cdb48d' },
  { x: -6.5, z: -17.8, rotation: 0.15, color: '#e1cfa8' },
];

/* ------------------------------------------------------------------ */
/* Harbour                                                             */
/* ------------------------------------------------------------------ */

const pierBearing = 1.0;
const pierDir: XZ = [Math.cos(pierBearing), Math.sin(pierBearing)];
const pierTangent: XZ = [-pierDir[1], pierDir[0]];
const pierStartRadius = islandRadius(pierBearing) - 1.4;
export const pier = {
  start: [pierDir[0] * pierStartRadius, pierDir[1] * pierStartRadius] as XZ,
  dir: pierDir,
  tangent: pierTangent,
  length: 5.4,
  width: 1.5,
};
export const pierEnd: XZ = [
  pier.start[0] + pierDir[0] * pier.length,
  pier.start[1] + pierDir[1] * pier.length,
];
export const boatLoop = {
  cx: pierEnd[0] + pierDir[0] * 3 + pierTangent[0] * 0.5,
  cz: pierEnd[1] + pierDir[1] * 3 + pierTangent[1] * 0.5,
  along: 3.3,
  across: 2.1,
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
    y: 0.03 + Math.sin(time * 1.7) * 0.012,
    heading: Math.atan2(dx, dz),
    roll: Math.sin(time * 1.1) * 0.03,
  };
}
export const lighthouseRock: XZ = [-8, 31.5];

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
    if (p.x < -15.5) continue; // the crescent gardens face this side
    if (nearJunction(p.x, p.z, 3.2)) continue;
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
      push(Math.cos(a) * 4.55, Math.sin(a) * 4.55, 0.6, 'round');
    }
  // Park and crescent gardens.
  for (let i = 0; i < 7; i++) {
    const x = park.x + (hash(i * 11 + 3) - 0.5) * (park.w - 1.6),
      z = park.z + (hash(i * 11 + 5) - 0.5) * (park.d - 1.6);
    if (Math.hypot(x - park.x, z - park.z) < 1.6) continue;
    push(x, z, 0.9 + hash(i * 11 + 7) * 0.25, i % 3 === 1 ? 'autumn' : 'round');
  }
  for (const [x, z] of [
    [-24.8, -2.2],
    [-25.4, 4.4],
    [-23.9, 1.1],
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
    if (Math.hypot(x - pier.start[0], z - pier.start[1]) < 4) continue;
    if (Math.hypot(x - crescent.x, z - crescent.z) < 10.5 && x > -27) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 2.9)) continue;
    const hilly = terrainHeight(x, z) > 0.15 || z < -16;
    push(
      x,
      z,
      0.9 + hash(i + 81) * 0.5,
      hilly && hash(i + 9) < 0.55 ? 'pine' : hash(i + 17) < 0.14 ? 'autumn' : 'round',
    );
  }
  return trees;
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
      for (let d = 1.1; d < length - 1.4; d += 4.1)
        push(avenue.from[0] + dx * d - dz * side * 1.25, avenue.from[1] + dz * d + dx * side * 1.25);
    }
  const inner = offsetPolyline(ringLine, 1.3);
  const innerLength = polylineLength(inner, true);
  for (let d = 3; d < innerLength; d += 7.3) {
    const p = samplePolyline(inner, d, true);
    if (nearJunction(p.x, p.z, 2.4)) continue;
    push(p.x, p.z);
  }
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 2) * i + Math.PI / 4;
    push(Math.cos(a) * 2.6, Math.sin(a) * 2.6);
  }
  return lamps;
}

/** Pedestrians walk the pavements of the ring and the avenues as one long loop. */
export function walkLoop(offset: number): XZ[] {
  return offsetPolyline(ringLine, offset);
}
export const tramLoop = ringLine;

export const districtAnchors: Record<DistrictId, { center: XZ; size: XZ }> = {
  civic: { center: [0, -8.5], size: [13, 9] },
  residential: { center: [-21.5, 1], size: [10, 14] },
  research: { center: [12.5, -5], size: [13, 11] },
  waterfront: { center: [4, 12.5], size: [26, 9] },
};
