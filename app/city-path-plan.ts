export type PathPoint = [number, number];
export type Cubic = [PathPoint, PathPoint, PathPoint, PathPoint];
export type LandscapePath = {
  id: string;
  from: string;
  to: string;
  width: number;
  curves: Cubic[];
};
const defs: LandscapePath[] = [
  {
    id: 'garden-link',
    from: 'promenade',
    to: 'shore',
    width: 0.8,
    curves: [
      [
        [0, 11.05],
        [0, 12.5],
        [1.5, 13],
        [1.3, 14.35],
      ],
      [
        [1.3, 14.35],
        [1.1, 15.7],
        [0, 15.85],
        [0, 16.6],
      ],
    ],
  },
  {
    id: 'shore-west',
    from: 'shore-west',
    to: 'shore',
    width: 0.8,
    curves: [
      [
        [-15, 16.6],
        [-11, 16.6],
        [-9, 15.7],
        [-6, 15.9],
      ],
      [
        [-6, 15.9],
        [-3, 16.1],
        [-2.3, 16.6],
        [0, 16.6],
      ],
    ],
  },
  {
    id: 'shore-east',
    from: 'shore',
    to: 'shore-east',
    width: 0.8,
    curves: [
      [
        [0, 16.6],
        [3, 16.6],
        [4.7, 16.95],
        [7.5, 16.85],
      ],
      [
        [7.5, 16.85],
        [10.3, 16.75],
        [12, 16.6],
        [15, 16.6],
      ],
    ],
  },
  {
    id: 'west-garden-loop',
    from: 'garden-west',
    to: 'shore-west',
    width: 0.8,
    curves: [
      [
        [-21, 11.05],
        [-21.3, 13.5],
        [-19.8, 16.6],
        [-17, 16.6],
      ],
      [
        [-17, 16.6],
        [-16.3, 16.6],
        [-15.6, 16.6],
        [-15, 16.6],
      ],
    ],
  },
  {
    id: 'east-garden-loop',
    from: 'shore-east',
    to: 'garden-east',
    width: 0.8,
    curves: [
      [
        [15, 16.6],
        [15.6, 16.6],
        [16.3, 16.6],
        [17, 16.6],
      ],
      [
        [17, 16.6],
        [21.8, 16.6],
        [22, 15.5],
        [21, 11.05],
      ],
    ],
  },
];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function sampleCubics(curves: Cubic[]) {
  const points: PathPoint[] = [];
  for (const c of curves) {
    const length = c
        .slice(1)
        .reduce((n, p, i) => n + Math.hypot(p[0] - c[i][0], p[1] - c[i][1]), 0),
      steps = Math.max(12, Math.ceil(length / 0.38));
    for (let i = points.length ? 1 : 0; i <= steps; i++) {
      const t = i / steps,
        u = 1 - t;
      points.push(
        [0, 1].map(
          (k) =>
            u * u * u * c[0][k] +
            3 * u * u * t * c[1][k] +
            3 * u * t * t * c[2][k] +
            t * t * t * c[3][k],
        ) as PathPoint,
      );
    }
  }
  return points;
}
export const landscapePaths = defs.map((p) => {
  const points = sampleCubics(p.curves),
    lengths = [0];
  for (let i = 1; i < points.length; i++)
    lengths.push(
      lengths[i - 1] +
        Math.hypot(
          points[i][0] - points[i - 1][0],
          points[i][1] - points[i - 1][1],
        ),
    );
  return { ...p, points, lengths, length: lengths.at(-1)! };
});
export function pathStation(
  path: (typeof landscapePaths)[number],
  distance: number,
  offset = 0,
) {
  const d = Math.max(0, Math.min(path.length, distance)),
    i = Math.max(
      1,
      path.lengths.findIndex((v) => v >= d),
    ),
    a = path.points[i - 1],
    b = path.points[i],
    length = Math.hypot(b[0] - a[0], b[1] - a[1]),
    t = (d - path.lengths[i - 1]) / length;
  return {
    x: lerp(a[0], b[0], t) - ((b[1] - a[1]) / length) * offset,
    z: lerp(a[1], b[1], t) + ((b[0] - a[0]) / length) * offset,
    heading: Math.atan2(b[0] - a[0], b[1] - a[1]),
  };
}
export const signedArea = (poly: PathPoint[]) =>
  poly.reduce((sum, a, i) => {
    const b = poly[(i + 1) % poly.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;
export function inPolygon(poly: PathPoint[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j],
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      l = dx * dx + dz * dz,
      t = l
        ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l))
        : 0;
    if (Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz) < 1e-6) return true;
    if (
      a[1] > z !== b[1] > z &&
      x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
export function offsetRail(points: PathPoint[], distance: number): PathPoint[] {
  return points.map((p, i) => {
    const before = points[Math.max(0, i - 1)],
      after = points[Math.min(points.length - 1, i + 1)];
    const normal = (a: PathPoint, b: PathPoint) => {
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return d ? [-(b[1] - a[1]) / d, (b[0] - a[0]) / d] : [0, 0];
    };
    const n0 = normal(before, p),
      n1 = normal(p, after),
      sum: [number, number] = [n0[0] + n1[0], n0[1] + n1[1]],
      norm = Math.hypot(...sum),
      n = norm ? [sum[0] / norm, sum[1] / norm] : n1;
    const reference = i === points.length - 1 ? n0 : n1,
      miter =
        distance / Math.max(0.5, n[0] * reference[0] + n[1] * reference[1]);
    return [p[0] + n[0] * miter, p[1] + n[1] * miter];
  });
}
const cross = (a: PathPoint, b: PathPoint, p: PathPoint) =>
  (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
function halfPlane(
  poly: PathPoint[],
  a: PathPoint,
  b: PathPoint,
  keepInside: boolean,
) {
  const out: PathPoint[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i],
      q = poly[(i + 1) % poly.length],
      u = cross(a, b, p),
      v = cross(a, b, q),
      pin = keepInside ? u >= -1e-9 : u <= 1e-9,
      qin = keepInside ? v >= -1e-9 : v <= 1e-9;
    if (pin) out.push(p);
    if (pin !== qin && Math.abs(u - v) > 1e-12) {
      const t = u / (u - v);
      out.push([lerp(p[0], q[0], t), lerp(p[1], q[1], t)]);
    }
  }
  return out;
}
export function subtractPolygon(
  poly: PathPoint[],
  clip: PathPoint[],
): PathPoint[][] {
  let remaining = poly;
  const out: PathPoint[][] = [];
  const c = signedArea(clip) < 0 ? [...clip].reverse() : clip;
  for (let i = 0; i < c.length && remaining.length >= 3; i++) {
    const a = c[i],
      b = c[(i + 1) % c.length],
      outside = halfPlane(remaining, a, b, false);
    if (outside.length >= 3 && Math.abs(signedArea(outside)) > 1e-8)
      out.push(outside);
    remaining = halfPlane(remaining, a, b, true);
  }
  return out;
}
export const polygonBounds = (poly: PathPoint[]) => ({
  minX: Math.min(...poly.map((p) => p[0])),
  maxX: Math.max(...poly.map((p) => p[0])),
  minZ: Math.min(...poly.map((p) => p[1])),
  maxZ: Math.max(...poly.map((p) => p[1])),
});
// Shared curve endpoints need a physical junction, because their sampled chord
// normals can differ slightly even when the analytic cubic tangents agree.
export const pathJunctions = (() => {
  const endpoints = new Map<
    string,
    { point: PathPoint; width: number; count: number }
  >();
  for (const path of landscapePaths)
    for (const [node, point] of [
      [path.from, path.points[0]],
      [path.to, path.points.at(-1)!],
    ] as [string, PathPoint][]) {
      const old = endpoints.get(node);
      endpoints.set(node, {
        point,
        width: Math.max(old?.width ?? 0, path.width),
        count: (old?.count ?? 0) + 1,
      });
    }
  return [...endpoints]
    .filter(([, entry]) => entry.count > 1)
    .map(([node, entry]) => ({
      id: 'path-junction-' + node,
      node,
      radius: entry.width / 2 + 0.02,
      poly: Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2,
          radius = entry.width / 2 + 0.02;
        return [
          entry.point[0] + Math.cos(a) * radius,
          entry.point[1] + Math.sin(a) * radius,
        ] as PathPoint;
      }),
    }));
})();
export function buildPathSurfaces(
  rects: { x: number; z: number; w: number; d: number }[],
) {
  const cuts = rects
    .map((r) => ({
      poly: [
        [r.x - r.w / 2, r.z - r.d / 2],
        [r.x + r.w / 2, r.z - r.d / 2],
        [r.x + r.w / 2, r.z + r.d / 2],
        [r.x - r.w / 2, r.z + r.d / 2],
      ] as PathPoint[],
    }))
    .map((p) => ({ ...p, ...polygonBounds(p.poly) }));
  const output: {
    id: string;
    poly: PathPoint[];
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  }[] = [];
  const emit = (id: string, source: PathPoint[]) => {
    const bounds = polygonBounds(source);
    let pieces = [source];
    for (const cut of cuts) {
      if (
        cut.maxX < bounds.minX ||
        cut.minX > bounds.maxX ||
        cut.maxZ < bounds.minZ ||
        cut.minZ > bounds.maxZ
      )
        continue;
      pieces = pieces.flatMap((poly) => subtractPolygon(poly, cut.poly));
      if (!pieces.length) break;
    }
    const emitted = pieces.map((poly) => ({
      id,
      poly,
      ...polygonBounds(poly),
    }));
    output.push(...emitted);
    return emitted;
  };
  // Urban paving owns its footprint; then junctions, then ribbons. Every visible
  // top patch has exactly one owner and the same patches drive height queries.
  for (const junction of pathJunctions)
    cuts.push(...emit(junction.id, junction.poly));
  for (const path of landscapePaths) {
    const left = offsetRail(path.points, path.width / 2),
      right = offsetRail(path.points, -path.width / 2);
    const owned: typeof output = [];
    for (let i = 1; i < left.length; i++)
      owned.push(
        ...emit(path.id, [left[i - 1], right[i - 1], right[i], left[i]]),
      );
    cuts.push(...owned);
  }
  return output;
}
