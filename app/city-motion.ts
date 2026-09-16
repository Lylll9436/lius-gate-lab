import { landscapePaths, offsetRail } from './city-path-plan';
import { seaRoute } from './city-shore';
export type Point = [number, number];
export const pedestrianNodes: Record<string, Point> = {
  gate: [0, 0],
  plaza: [0, 1.35],
  north: [0, -4.72],
  west: [-12.1, 1.35],
  peng: [-11.2, 1.35],
  home: [-9, 1.35],
  south: [0, 7.55],
  qin: [-6.8, 1.35],
  'south-garden': [-7.7, 7.55],
  archive: [8.8, 7.55],
  hall: [-4.4, -4.72],
  studio: [8.8, -4.72],
  promenade: [0, 11.05],
  park: [-10.6, 11.05],
  river: [9, 11.05],
  shore: [0, 16.6],
  'shore-west': [-15, 16.6],
  'shore-east': [15, 16.6],
  'garden-west': [-21, 11.05],
  'garden-east': [21, 11.05],
};
// Nearby door addresses must not create overlapping junction reservations.
const junctions = Object.values(pedestrianNodes).map(([x, z], i, nodes) => ({
  x,
  z,
  radius: Math.min(
    0.55,
    ...nodes
      .filter((_, j) => i !== j)
      .map(([nx, nz]) => Math.hypot(nx - x, nz - z) * 0.45),
  ),
}));
const edges = [
  ['gate', 'plaza'],
  ['gate', 'north'],
  ['plaza', 'qin'],
  ['qin', 'home'],
  ['home', 'peng'],
  ['peng', 'west'],
  ['north', 'hall'],
  ['north', 'studio'],
  ['plaza', 'south'],
  ['south', 'south-garden'],
  ['south', 'archive'],
  ['south', 'promenade'],
  ['promenade', 'park'],
  ['promenade', 'river'],
  ['promenade', 'shore'],
  ['shore', 'shore-west'],
  ['shore', 'shore-east'],
  ['park', 'garden-west'],
  ['river', 'garden-east'],
  ['garden-west', 'shore-west'],
  ['shore-east', 'garden-east'],
];
export function routeBetween(from: string, to: string): Point[] {
  const queue = [[from]],
    seen = new Set([from]);
  while (queue.length) {
    const path = queue.shift()!,
      last = path[path.length - 1];
    if (last === to) {
      const points: Point[] = [];
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1],
          b = path[i],
          curve = landscapePaths.find(
            (p) => (p.from === a && p.to === b) || (p.from === b && p.to === a),
          );
        const section = curve
          ? curve.from === a
            ? curve.points
            : [...curve.points].reverse()
          : [pedestrianNodes[a], pedestrianNodes[b]];
        points.push(...section.slice(points.length ? 1 : 0));
      }
      return points.length ? points : [pedestrianNodes[from]];
    }
    for (const [a, b] of edges) {
      const next = a === last ? b : b === last ? a : null;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push([...path, next]);
      }
    }
  }
  throw Error('Unconnected pedestrian path');
}
export function lengthOf(path: Point[]) {
  return path
    .slice(1)
    .reduce(
      (n, p, i) => n + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]),
      0,
    );
}
export function samplePath(path: Point[], distance: number) {
  let remaining = Math.max(0, distance);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i],
      length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (remaining <= length || i === path.length - 1) {
      const t = length ? Math.min(1, remaining / length) : 1;
      return {
        x: a[0] + (b[0] - a[0]) * t,
        z: a[1] + (b[1] - a[1]) * t,
        heading: Math.atan2(b[0] - a[0], b[1] - a[1]),
      };
    }
    remaining -= length;
  }
  return { x: path[0][0], z: path[0][1], heading: 0 };
}
export function shortestAngle(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}
export function vehicleLoop(): Point[] {
  const points: Point[] = [];
  const corners: [number, number, number][] = [
    [13.2, -4.7, -Math.PI / 2],
    [13.2, 7.6, 0],
    [-13.2, 7.6, Math.PI / 2],
    [-13.2, -4.7, Math.PI],
  ];
  for (const [cx, cz, start] of corners)
    for (let i = 0; i <= 48; i++) {
      const a = start + (i * Math.PI) / 96;
      points.push([cx + Math.cos(a) * 0.8, cz + Math.sin(a) * 0.8]);
    }
  points.push(points[0]);
  return points;
}
export type Walker = {
  at: string;
  destination: string;
  path: Point[];
  distance: number;
  wait: number;
  speed: number;
  seed: number;
  x: number;
  z: number;
  heading: number;
  moving: boolean;
};
function random(w: Walker) {
  w.seed = (Math.imul(w.seed, 1664525) + 1013904223) >>> 0;
  return w.seed / 4294967296;
}
export function makeWalker(index: number): Walker {
  const starts = ['west', 'studio', 'qin', 'park', 'archive'];
  const at = starts[index % starts.length],
    p = pedestrianNodes[at];
  return {
    at,
    destination: at,
    path: [p],
    distance: 0,
    wait: index * 0.65,
    speed: 0.43 + index * 0.045,
    seed: 7651 + index * 59,
    x: p[0],
    z: p[1],
    heading: 0,
    moving: false,
  };
}
export function laneRoute(from: string, to: string, start: Point): Point[] {
  const route = routeBetween(from, to);
  if (route.length < 2) return [start];
  return [start, ...offsetRail(route, -0.14)].filter(
    (p, i, all) =>
      !i || Math.hypot(p[0] - all[i - 1][0], p[1] - all[i - 1][1]) > 1e-7,
  );
}
export function stepWalker(w: Walker, dt: number, paused = false) {
  if (paused) return;
  if (w.wait > 0) {
    w.wait = Math.max(0, w.wait - dt);
    w.moving = false;
    return;
  }
  if (w.distance >= lengthOf(w.path)) {
    w.at = w.destination;
    const candidates = Object.keys(pedestrianNodes).filter((id) => id !== w.at);
    w.destination = candidates[Math.floor(random(w) * candidates.length)];
    w.path = laneRoute(w.at, w.destination, [w.x, w.z]);
    w.distance = 0;
    w.wait = 0.6 + random(w) * 2.5;
    w.moving = false;
    return;
  }
  w.moving = true;
  w.distance = Math.min(lengthOf(w.path), w.distance + w.speed * dt);
  const p = samplePath(w.path, w.distance);
  w.x = p.x;
  w.z = p.z;
  w.heading += shortestAngle(w.heading, p.heading) * Math.min(1, dt * 7);
}
export function stepCrowd(walkers: Walker[], dt: number, paused = false) {
  if (paused) return;
  for (const w of walkers) {
    const next = { ...w };
    stepWalker(next, dt);
    const others = walkers.filter((other) => other !== w);
    const obstructed = others.some(
      (other) => Math.hypot(next.x - other.x, next.z - other.z) < 0.23,
    );
    const junctionTaken = junctions.some(
      ({ x, z, radius }) =>
        Math.hypot(w.x - x, w.z - z) >= radius &&
        Math.hypot(next.x - x, next.z - z) < radius &&
        others.some((other) => Math.hypot(other.x - x, other.z - z) < radius),
    );
    if ((obstructed || junctionTaken) && next.moving) {
      w.moving = false;
    } else Object.assign(w, next);
  }
}
export function boatPose(time: number) {
  const t = time * 0.12;
  return {
    x: -7.5 + Math.cos(t) * 4.4,
    y: 0.025 + Math.sin(time * 1.8) * 0.014,
    z: seaRoute.z + Math.sin(t) * 0.65,
    heading: Math.atan2(-Math.cos(t) * 0.65, -Math.sin(t) * 4.4),
  };
}
export const visitNodes: Record<string, string> = {
  'lius-gate': 'gate',
  'town-hall': 'hall',
  'pengyuan-liu': 'peng',
  'yunlong-liu': 'home',
  'qin-li': 'qin',
  'research-studio': 'studio',
  'city-archive': 'archive',
};
export type CollisionBody = {
  id: string;
  kind: string;
  allowInside?: string;
  min: [number, number, number];
  max: [number, number, number];
};
export function overlaps(a: CollisionBody, b: CollisionBody, margin = 0) {
  return a.min.every(
    (v, i) => v < b.max[i] + margin && a.max[i] > b.min[i] - margin,
  );
}
export function actorBody(
  id: string,
  x: number,
  z: number,
  halfX: number,
  halfZ: number,
  height = 0.78,
  base = 0.14,
): CollisionBody {
  return {
    id,
    kind: 'actor',
    min: [x - halfX, base, z - halfZ],
    max: [x + halfX, base + height, z + halfZ],
  };
}
