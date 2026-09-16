import * as T from 'three';
import {
  curvedSurfaces,
  groundSurfaces,
  groundHeightAt,
  grades,
} from './city-ground';
import { signedArea, type PathPoint } from './city-path-plan';
import type { SurfaceKind } from './city-materials';

export function addCurvedPaving(
  land: T.Group,
  material: (c: string, k?: SurfaceKind) => T.MeshStandardMaterial,
) {
  const sides: number[] = [];
  const boundaries: PathPoint[][] = [
    ...curvedSurfaces.map((p) => p.poly),
    ...groundSurfaces.map(
      (r) =>
        [
          [r.x - r.w / 2, r.z - r.d / 2],
          [r.x + r.w / 2, r.z - r.d / 2],
          [r.x + r.w / 2, r.z + r.d / 2],
          [r.x - r.w / 2, r.z + r.d / 2],
        ] as PathPoint[],
    ),
  ];
  const cross = (x: number, z: number, a: number, b: number) => x * b - z * a;
  for (const surface of curvedSurfaces) {
    const poly =
        signedArea(surface.poly) > 0
          ? [...surface.poly].reverse()
          : surface.poly,
      positions: number[] = [];
    const point = (p: PathPoint, y = grades.walk) => [p[0], y, p[1]];
    for (let i = 1; i < poly.length - 1; i++) {
      const a = poly[0],
        b = poly[i],
        c = poly[i + 1];
      if (
        Math.abs(cross(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1])) <
        1e-10
      )
        continue;
      positions.push(...point(a), ...point(b), ...point(c));
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    const mesh = new T.Mesh(geo, material('#c7bfa5', 'gravel'));
    mesh.receiveShadow = true;
    mesh.userData.curvedSurface = surface;
    land.add(mesh);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length],
        dx = b[0] - a[0],
        dz = b[1] - a[1],
        len = Math.hypot(dx, dz);
      if (len < 1e-7) continue;
      const cuts = [0, 1];
      for (const boundary of boundaries)
        for (let j = 0; j < boundary.length; j++) {
          const c = boundary[j],
            d = boundary[(j + 1) % boundary.length],
            ex = d[0] - c[0],
            ez = d[1] - c[1],
            ax = c[0] - a[0],
            az = c[1] - a[1],
            den = cross(dx, dz, ex, ez);
          if (Math.abs(den) > 1e-10) {
            const t = cross(ax, az, ex, ez) / den,
              u = cross(ax, az, dx, dz) / den;
            if (t > 1e-7 && t < 1 - 1e-7 && u >= -1e-7 && u <= 1 + 1e-7)
              cuts.push(t);
          } else if (Math.abs(cross(dx, dz, ax, az)) < len * 1e-7) {
            for (const p of [c, d]) {
              const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (len * len);
              if (t > 1e-7 && t < 1 - 1e-7) cuts.push(t);
            }
          }
        }
      cuts.sort((u, v) => u - v);
      for (let j = 1; j < cuts.length; j++) {
        const lo = cuts[j - 1],
          hi = cuts[j];
        if ((hi - lo) * len < 1e-7) continue;
        const t = (lo + hi) / 2,
          x = a[0] + dx * t - (dz / len) * 1e-5,
          z = a[1] + dz * t + (dx / len) * 1e-5,
          low = groundHeightAt(x, z);
        if (low >= grades.walk - 1e-5) continue;
        const p: PathPoint = [a[0] + dx * lo, a[1] + dz * lo],
          q: PathPoint = [a[0] + dx * hi, a[1] + dz * hi];
        sides.push(
          ...point(p, low),
          ...point(q, low),
          ...point(q),
          ...point(p, low),
          ...point(q),
          ...point(p),
        );
      }
    }
  }
  if (sides.length) {
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(sides, 3));
    geo.computeVertexNormals();
    const edge = new T.Mesh(geo, material('#aaa68e', 'soil'));
    edge.name = 'garden-path-earth-edges';
    edge.receiveShadow = true;
    land.add(edge);
  }
}
