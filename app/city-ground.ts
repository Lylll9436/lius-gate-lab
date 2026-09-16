import { seaRoute } from './city-shore';
import { buildPathSurfaces, inPolygon } from './city-path-plan';
import { treePits } from './city-planting-plan';
import { onIsland } from './island-footprint';
import { buildings } from './city-data';
import { placement, buildingDimensions, spacingRules } from './city-layout';

export const grades = { soil: 0.1, road: 0.14, walk: 0.2, water: 0.0725 };
// Open-water navigation envelope, separate from the land footprint.
export const river = seaRoute;
export const crossings = [
  { x: -4.3, z: -5.5, width: 0.85 },
  { x: 0, z: -5.5, width: 1.6 },
  { x: 8.8, z: -5.5, width: 0.85 },
  { x: 0, z: 8.4, width: 1.6 },
];
// Non-walking supports are separate from public paving and its setback rules.
export const supportSurfaces = [
  {
    id: 'north-lawn',
    x: 0,
    z: -18.2,
    w: 39,
    d: 2.1,
    top: 0.11,
    bottom: 0.1,
    color: '#95ae77',
  },
  {
    id: 'civic-lawn',
    x: -10,
    z: -10,
    w: 5.8,
    d: 5.8,
    top: 0.12,
    bottom: 0.1,
    color: '#8ea872',
  },
  {
    id: 'courtyard-lawn',
    x: 10.5,
    z: -2.6,
    w: 3.4,
    d: 2.6,
    top: 0.12,
    bottom: 0.1,
    color: '#94a875',
  },
  {
    id: 'park-lawn',
    x: -10.65,
    z: 9.95,
    w: 5.45,
    d: 1.65,
    top: 0.125,
    bottom: 0.1,
    color: '#96ad7d',
  },
];
export type Surface = {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
  kind: 'walk' | 'road' | 'bridge' | 'ramp';
  color: string;
  accessTo?: string;
  /** Top elevations at the north and south edges, respectively. */
  north: number;
  south: number;
  ramp?: { x: number; z: number; core: number; north: number; south: number };
};
type Rect = Pick<Surface, 'x' | 'z' | 'w' | 'd'>;
export function contains(s: Rect, x: number, z: number) {
  return (
    Math.abs(x - s.x) <= s.w / 2 + 1e-8 && Math.abs(z - s.z) <= s.d / 2 + 1e-8
  );
}
/** Subtract positive-area intersections; touching edges remain connected. */
export function subtract(s: Surface, cut: Rect): Surface[] {
  const x0 = s.x - s.w / 2,
    x1 = s.x + s.w / 2,
    z0 = s.z - s.d / 2,
    z1 = s.z + s.d / 2;
  const a = Math.max(x0, cut.x - cut.w / 2),
    b = Math.min(x1, cut.x + cut.w / 2),
    c = Math.max(z0, cut.z - cut.d / 2),
    d = Math.min(z1, cut.z + cut.d / 2);
  if (b - a < 1e-8 || d - c < 1e-8) return [s];
  return [
    [x0, a, z0, z1],
    [b, x1, z0, z1],
    [a, b, z0, c],
    [a, b, d, z1],
  ]
    .filter(([l, r, n, t]) => r - l > 1e-8 && t - n > 1e-8)
    .map(([l, r, n, t]) => ({
      ...s,
      x: (l + r) / 2,
      z: (n + t) / 2,
      w: r - l,
      d: t - n,
      north: elevation(s, n),
      south: elevation(s, t),
    }));
}
export function elevation(s: Surface, z: number, x = s.x) {
  if (s.ramp) {
    const r = s.ramp,
      along = Math.max(0, Math.min(1, (z - r.z + 0.18) / 0.36));
    const center = r.north + (r.south - r.north) * along;
    const fade = Math.max(
      0,
      Math.min(1, (Math.abs(x - r.x) - r.core / 2) / 0.35),
    );
    return center + (grades.walk - center) * fade;
  }
  return (
    s.north +
    (s.south - s.north) * Math.max(0, Math.min(1, (z - s.z + s.d / 2) / s.d))
  );
}
export function buildGroundPlan() {
  const surfaces: Surface[] = [];
  function add(s: Surface, waterAllowed = false) {
    // Earlier surfaces win. Asphalt and ramps are registered before walks.
    let pieces = waterAllowed ? [s] : subtract(s, river);
    for (const cut of surfaces)
      pieces = pieces.flatMap((p) => subtract(p, cut));
    surfaces.push(...pieces);
  }
  function surface(
    id: string,
    x: number,
    z: number,
    w: number,
    d: number,
    kind: Surface['kind'] = 'walk',
    accessTo?: string,
  ): Surface {
    return {
      id,
      x,
      z,
      w,
      d,
      kind,
      accessTo,
      color:
        kind === 'road' ? '#8b9690' : kind === 'bridge' ? '#b0946b' : '#d8cdb3',
      north: kind === 'road' ? grades.road : grades.walk,
      south: kind === 'road' ? grades.road : grades.walk,
    };
  }
  const roadRects: Rect[] = [
    { x: 0, z: -5.5, w: 28, d: 1.1 },
    { x: 0, z: 8.4, w: 28, d: 1.1 },
    { x: -14, z: 1.45, w: 1.1, d: 13.9 },
    { x: 14, z: 1.45, w: 1.1, d: 13.9 },
  ];
  for (const x of [-14, 14])
    for (const z of [-5.5, 8.4]) roadRects.push({ x, z, w: 2.5, d: 2.5 });
  roadRects.forEach((r, i) =>
    add(surface('road-' + i, r.x, r.z, r.w, r.d, 'road')),
  );
  // Curb ramps face the marked crossings; no slab covers a traffic lane.
  for (const { x, z, width } of crossings)
    for (const side of [-1, 1]) {
      const r = surface(
        'crossing-ramp',
        x,
        z + side * (0.55 + 0.18),
        width,
        0.36,
        'ramp',
      );
      r.north = side < 0 ? grades.walk : grades.road;
      r.south = side < 0 ? grades.road : grades.walk;
      r.ramp = { x, z: r.z, core: r.w, north: r.north, south: r.south };
      add(r);
      for (const wing of [-1, 1])
        add({ ...r, x: x + wing * (r.w / 2 + 0.175), w: 0.35 });
    }
  const walk = (
    id: string,
    x: number,
    z: number,
    w: number,
    d: number,
    accessTo?: string,
  ) => add(surface(id, x, z, w, d, 'walk', accessTo));
  // Continuous perimeter, civic axis and cross streets, clipped by the road ring.
  walk('north-walk', 0, -18.2, 39, 0.75);
  for (const x of [-15.8, 15.8]) walk('outer-walk', x, -3.575, 0.75, 29.25);
  walk('civic-axis', 0, -3.3, 1.6, 29.8);
  walk('terrace-lane', 0, -14.415, 31.6, 0.64);
  for (const z of [-4.72, 1.35, 7.55, 11.05])
    walk('cross-walk', 0, z, z === 11.05 ? 42 : 26.4, 0.56);
  for (const x of [-21, 21]) walk('garden-path-landing', x, 11.05, 0.85, 0.8);
  // Corner aprons connect the four narrow sidewalks around each turning square.
  for (const r of roadRects) {
    const [x, z] = placement['pengyuan-liu'];
    const dim = buildingDimensions(
      buildings.find((b) => b.id === 'pengyuan-liu')!,
    );
    const buffer = 2 * spacingRules.pavementSetback;
    const apron = surface('roadside', r.x, r.z, r.w + 1.05, r.d + 1.05);
    subtract(apron, {
      x,
      z,
      w: dim.width + 0.32 + buffer,
      d: dim.depth + 0.32 + buffer,
    }).forEach((s) => add(s));
  }
  walk('civic-square', 0, 0, 9.1, 8.4);
  walk('garden-spine', -10, -10.76, 0.75, 7.31);
  walk('garden-cross', -10, -10, 5.8, 0.75);
  walk('courtyard', 10.5, -2.6, 2.6, 0.6);
  walk('courtyard-entry', 10.5, -0.625, 0.75, 3.95);
  // Entrance paths are the only intentional exceptions to pavement setbacks.
  for (const b of buildings) {
    if (b.id === 'lius-gate') continue;
    const p = placement[b.id] ?? [
      (b.x + b.w / 2 - 7) * 2.2,
      (b.z + b.d / 2 - 7) * 2.2,
    ];
    const front = p[1] + buildingDimensions(b).frontStep;
    const end =
      b.id === 'town-hall' || b.id === 'research-studio'
        ? -6.05
        : b.id === 'city-archive'
          ? 7.55
          : 1.35;
    walk(
      'entry-' + b.id,
      p[0],
      (front - 0.02 + end) / 2,
      0.8,
      end - front + 0.02,
      b.id,
    );
  }
  for (let i = 0; i < 5; i++) {
    const id = 'street-house-' + i,
      [x, z] = placement[id];
    walk('entry-' + id, x, (z + 0.8 - 14.415) / 2, 0.65, -14.415 - z - 0.8, id);
  }
  walk('cafe-entry', 17.6, 10.72, 0.8, 0.66, 'cafe');
  walk('park-entry', -10.65, 10.4875, 0.8, 1.125);
  walk('memories-entry', -7.1, 10.7, 1.1, 0.7);
  for (const x of [2.3, 6.6]) {
    walk('picnic-pad', x, 10, 1.55, 1.05);
    walk('picnic-entry', x, 10.75, 0.65, 0.6);
  }
  walk('phone-entry', -4.85, 2.8, 1.3, 0.85);
  walk('bike-stand', 6.5, -3.7, 2.9, 0.65);
  walk('bike-entry', 6.5, -4.15, 0.65, 0.9);
  for (const [i, [x, z]] of [
    [-18.3, -13],
    [18.3, -13],
    [18.3, -5],
  ].entries()) {
    const edge = Math.sign(x) * 15.8;
    walk('site-entry-' + i, x, z + 2.15, 0.8, 0.55, 'construction-site-' + i);
    walk(
      'site-approach-' + i,
      (x + edge) / 2,
      z + 2.4,
      Math.abs(x - edge) + 0.8,
      0.8,
    );
  }
  return surfaces;
}
export const groundSurfaces = buildGroundPlan();
export const curvedSurfaces = buildPathSurfaces(groundSurfaces);
export function curvedSurfaceAt(x: number, z: number) {
  return curvedSurfaces.find(
    (p) =>
      x >= p.minX - 1e-7 &&
      x <= p.maxX + 1e-7 &&
      z >= p.minZ - 1e-7 &&
      z <= p.maxZ + 1e-7 &&
      inPolygon(p.poly, x, z),
  );
}
export function walkSurfaceAt(x: number, z: number) {
  return (
    groundSurfaces.find((p) => contains(p, x, z)) ??
    (curvedSurfaceAt(x, z) ? { id: 'garden-path', kind: 'walk' } : undefined)
  );
}
export function baseGroundHeightAt(x: number, z: number) {
  const s = groundSurfaces.find((s) => contains(s, x, z));
  return s
    ? elevation(s, z, x)
    : curvedSurfaceAt(x, z)
      ? grades.walk
      : !onIsland(x, z)
        ? grades.water
        : Math.max(
            grades.soil,
            ...supportSurfaces
              .filter((s) => contains(s, x, z))
              .map((s) => s.top),
          );
}

export function groundHeightAt(x: number, z: number) {
  const base = baseGroundHeightAt(x, z);
  if (!treePits.some((p) => contains(p, x, z))) return base;
  return groundSurfaces.some((s) => contains(s, x, z))
    ? base - 0.016
    : base + 0.008;
}
