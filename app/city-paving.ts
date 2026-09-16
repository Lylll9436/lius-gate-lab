import * as T from 'three';
import {
  groundSurfaces,
  curvedSurfaces,
  curvedSurfaceAt,
  groundHeightAt,
  elevation,
  subtract,
  contains,
  type Surface,
} from './city-ground';
import { treePits } from './city-planting-plan';
import { outsideEdges, kerbStrips, intersectRect } from './city-street-edges';
import type { SurfaceKind } from './city-materials';
type Piece = Surface & { finish: 'asphalt' | 'paving' | 'kerb' | 'gutter' };
const edges = outsideEdges(groundSurfaces.filter((s) => s.kind === 'road'));
export const roadBoundary = edges;
export function pavingPieces(): Piece[] {
  const result: Piece[] = [],
    strips = kerbStrips(edges),
    gutters = kerbStrips(edges, 0.09, -1);
  for (const s of groundSurfaces) {
    const road = s.kind === 'road';
    let remaining = [s];
    if (!road)
      for (const cut of treePits)
        remaining = remaining.flatMap((p) => subtract(p, cut));
    for (const cut of road ? gutters : strips) {
      const next: Surface[] = [];
      for (const p of remaining) {
        const hit = intersectRect(p, cut);
        if (hit)
          result.push({
            ...p,
            ...hit,
            north: elevation(p, hit.z - hit.d / 2, hit.x),
            south: elevation(p, hit.z + hit.d / 2, hit.x),
            finish: road ? 'gutter' : 'kerb',
          });
        next.push(...subtract(p, cut));
      }
      remaining = next;
    }
    result.push(
      ...remaining.map((p) => ({
        ...p,
        finish: road ? ('asphalt' as const) : ('paving' as const),
      })),
    );
  }
  return result;
}
export function addPaving(
  land: T.Group,
  material: (c: string, k?: SurfaceKind) => T.MeshStandardMaterial,
) {
  const pieces = pavingPieces();
  function mesh(positions: number[], color: string, kind: SurfaceKind) {
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    const m = new T.Mesh(geo, material(color, kind));
    m.castShadow = m.receiveShadow = true;
    land.add(m);
    return m;
  }
  const sideCourses: number[] = [],
    bedding: number[] = [],
    kerbJoints: number[] = [];
  const triangle = (
    target: number[],
    a: number[],
    b: number[],
    c: number[],
  ) => {
    const u = b.map((v, i) => v - a[i]),
      v = c.map((n, i) => n - a[i]);
    if (
      (u[1] * v[2] - u[2] * v[1]) ** 2 +
        (u[2] * v[0] - u[0] * v[2]) ** 2 +
        (u[0] * v[1] - u[1] * v[0]) ** 2 >
      1e-18
    )
      target.push(...a, ...b, ...c);
  };
  const quad = (
    target: number[],
    a: number[],
    b: number[],
    c: number[],
    d: number[],
  ) => {
    triangle(target, a, b, c);
    triangle(target, a, c, d);
  };
  for (const s of pieces) {
    const top: number[] = [],
      nx = s.kind === 'ramp' ? 4 : 1,
      nz = s.kind === 'ramp' ? 4 : 1;
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const x = s.x - s.w / 2 + (i * s.w) / nx,
          z = s.z - s.d / 2 + (j * s.d) / nz;
        const p = (a: number, b: number) => [a, elevation(s, b, a), b];
        quad(
          top,
          p(x, z),
          p(x, z + s.d / nz),
          p(x + s.w / nx, z + s.d / nz),
          p(x + s.w / nx, z),
        );
      }
    const m = mesh(
      top,
      s.finish === 'kerb'
        ? '#bcbda9'
        : s.finish === 'gutter'
          ? '#7e8982'
          : s.color,
      s.finish === 'asphalt'
        ? 'asphalt'
        : s.finish === 'kerb' || s.finish === 'gutter'
          ? 'stone'
          : 'paving',
    );
    m.userData.surface = s;
    m.userData.pavingFinish = s.finish;
    if (s.finish === 'kerb') {
      const alongX = s.w > s.d,
        length = alongX ? s.w : s.d,
        count = Math.ceil(length / 0.4);
      for (let i = 1; i < count; i++) {
        const at =
          (alongX ? s.x - s.w / 2 : s.z - s.d / 2) + (i * length) / count;
        const x = alongX ? at : s.x,
          z = alongX ? s.z : at,
          dx = alongX ? 0.0025 : s.w / 2,
          dz = alongX ? s.d / 2 : 0.0025;
        const p = (x: number, z: number) => [x, elevation(s, z, x) + 0.0006, z];
        quad(
          kerbJoints,
          p(x - dx, z - dz),
          p(x - dx, z + dz),
          p(x + dx, z + dz),
          p(x + dx, z - dz),
        );
      }
    }
  }
  // Skirts exist only where the union drops in height; internal rectangle faces are absent.
  for (const s of pieces)
    for (const e of outsideEdges([s])) {
      const cuts = [e.start, e.end];
      for (const curve of curvedSurfaces)
        for (let i = 0; i < curve.poly.length; i++) {
          const p = curve.poly[i],
            q = curve.poly[(i + 1) % curve.poly.length],
            axis = e.axis === 'x' ? 1 : 0,
            along = 1 - axis;
          if (Math.abs(p[axis] - q[axis]) < 1e-8) continue;
          const t = (e.fixed - p[axis]) / (q[axis] - p[axis]);
          if (t < 0 || t > 1) continue;
          const at = p[along] + t * (q[along] - p[along]);
          if (at > e.start + 1e-6 && at < e.end - 1e-6) cuts.push(at);
        }
      for (const p of pieces) {
        const across = e.axis === 'x' ? p.z : p.x,
          depth = e.axis === 'x' ? p.d : p.w;
        if (
          Math.abs(across - depth / 2 - e.fixed) < 1e-6 ||
          Math.abs(across + depth / 2 - e.fixed) < 1e-6
        ) {
          const mid = e.axis === 'x' ? p.x : p.z,
            size = e.axis === 'x' ? p.w : p.d;
          for (const at of [mid - size / 2, mid + size / 2])
            if (at > e.start + 1e-6 && at < e.end - 1e-6) cuts.push(at);
        }
      }
      cuts.sort((a, b) => a - b);
      for (let i = 1; i < cuts.length; i++) {
        const a = cuts[i - 1],
          b = cuts[i];
        if (b - a < 1e-6) continue;
        const at = (a + b) / 2,
          x = e.axis === 'x' ? at : e.fixed + e.normal * 1e-5,
          z = e.axis === 'x' ? e.fixed + e.normal * 1e-5 : at;
        const other = pieces.find((p) => p !== s && contains(p, x, z));
        const lowAt = (v: number) => {
          if (!other && curvedSurfaceAt(x, z)) return 0.2;
          const px = e.axis === 'x' ? v : e.fixed + e.normal * 1e-5,
            pz = e.axis === 'x' ? e.fixed + e.normal * 1e-5 : v;
          return other ? elevation(other, pz, px) : groundHeightAt(px, pz);
        };
        const point = (v: number, y: number) =>
          e.axis === 'x' ? [v, y, e.fixed] : [e.fixed, y, v];
        const height = (v: number) =>
          e.axis === 'x' ? elevation(s, e.fixed, v) : elevation(s, v, e.fixed);
        const h0 = height(a),
          h1 = height(b),
          low0 = Math.min(h0, lowAt(a + Math.min(1e-6, (b - a) / 10))),
          low1 = Math.min(h1, lowAt(b - Math.min(1e-6, (b - a) / 10)));
        if (h0 - low0 < 1e-5 && h1 - low1 < 1e-5) continue;
        const split0 = Math.max(low0, h0 - 0.035),
          split1 = Math.max(low1, h1 - 0.035);
        const emit = (
          target: number[],
          y0: number,
          y1: number,
          t0: number,
          t1: number,
        ) => {
          const q = [point(a, y0), point(b, y1), point(b, t1), point(a, t0)];
          if (
            (e.axis === 'x' && e.normal < 0) ||
            (e.axis === 'z' && e.normal > 0)
          )
            q.reverse();
          quad(target, ...(q as [number[], number[], number[], number[]]));
        };
        if (split0 - low0 > 1e-5 || split1 - low1 > 1e-5)
          emit(bedding, low0, low1, split0, split1);
        emit(sideCourses, split0, split1, h0, h1);
      }
    }
  if (bedding.length)
    mesh(bedding, '#8f9383', 'soil').name = 'pavement-bedding-course';
  if (sideCourses.length)
    mesh(sideCourses, '#b8b69f', 'stone').name = 'exposed-paving-courses';
  if (kerbJoints.length)
    mesh(kerbJoints, '#8d9486', 'stone').name = 'kerb-stone-joints';
  return { pieces, edges };
}
