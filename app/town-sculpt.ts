import * as T from 'three';

/* ------------------------------------------------------------------ */
/* Sculpting: smooth-blended solids meshed from a distance field        */
/* ------------------------------------------------------------------ */
/*
 * A sculpted form (the Wellington bronze) is built the way a modeller blocks out clay: rounded
 * solids (ellipsoids, round cones, rounded boxes, tori) blended into each other with a smooth
 * union of radius k, so a neck flows into a chest and a leg into a body without the crease two
 * overlapping meshes leave. The blend lives in a distance grid of spacing h; a surface net turns
 * it into one closed, evenly tessellated mesh with normals taken from the field's own gradient,
 * so it shades smoothly at any size. Detail finer than about 2h is lost: add it as small meshes.
 */
type V3 = readonly [number, number, number];
/** A solid's signed distance (negative inside; a bound, close to the true distance near its surface) and its box. */
export type Shape = { d: (x: number, y: number, z: number) => number; min: V3; max: V3 };

/** Local (rotated) frame: m is row-major world-from-local; the inverse is its transpose. */
function frame(rot?: V3) {
  const m = new T.Matrix4().makeRotationFromEuler(new T.Euler(...(rot ?? [0, 0, 0]))).elements;
  // three stores column-major: world = M * local, M[row][col] = e[col * 4 + row].
  return [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
}
/** Half-extents of a box of half-size (a, b, c) after the rotation r (row-major). */
function spread(r: number[], a: number, b: number, c: number): V3 {
  return [
    Math.abs(r[0]) * a + Math.abs(r[1]) * b + Math.abs(r[2]) * c,
    Math.abs(r[3]) * a + Math.abs(r[4]) * b + Math.abs(r[5]) * c,
    Math.abs(r[6]) * a + Math.abs(r[7]) * b + Math.abs(r[8]) * c,
  ];
}
/** An ellipsoid of radii r at c, turned by rot (an Euler, XYZ). */
export function ellipsoid(c: V3, r: V3, rot?: V3): Shape {
  const m = frame(rot),
    [rx, ry, rz] = r,
    e = spread(m, rx, ry, rz);
  return {
    d(x, y, z) {
      const px = x - c[0],
        py = y - c[1],
        pz = z - c[2];
      // Into the ellipsoid's frame (the transpose of m).
      const lx = m[0] * px + m[3] * py + m[6] * pz,
        ly = m[1] * px + m[4] * py + m[7] * pz,
        lz = m[2] * px + m[5] * py + m[8] * pz;
      const ax = lx / rx, ay = ly / ry, az = lz / rz,
        bx = ax / rx, by = ay / ry, bz = az / rz,
        k0 = Math.sqrt(ax * ax + ay * ay + az * az),
        k1 = Math.sqrt(bx * bx + by * by + bz * bz);
      return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
    },
    min: [c[0] - e[0], c[1] - e[1], c[2] - e[2]],
    max: [c[0] + e[0], c[1] + e[1], c[2] + e[2]],
  };
}
/** A round cone: a sphere of radius ra at a swept to one of radius rb at b (iq's exact distance). */
export function roundCone(a: V3, b: V3, ra: number, rb: number): Shape {
  const bx = b[0] - a[0],
    by = b[1] - a[1],
    bz = b[2] - a[2],
    l2 = bx * bx + by * by + bz * bz,
    rr = ra - rb,
    a2 = l2 - rr * rr,
    il2 = 1 / l2;
  const r = Math.max(ra, rb);
  return {
    d(x, y, z) {
      const px = x - a[0],
        py = y - a[1],
        pz = z - a[2],
        t = px * bx + py * by + pz * bz,
        u = t - l2;
      const qx = px * l2 - bx * t,
        qy = py * l2 - by * t,
        qz = pz * l2 - bz * t,
        x2 = qx * qx + qy * qy + qz * qz,
        y2 = t * t * l2,
        z2 = u * u * l2,
        k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(u) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
      if (Math.sign(t) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
      return (Math.sqrt(x2 * a2 * il2) + t * rr) * il2 - ra;
    },
    min: [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r],
    max: [Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r],
  };
}
/** A chain of round cones through points p with radii r: a limb, a tail, a lock of mane. */
export function chain(p: V3[], r: number[]): Shape[] {
  return p.slice(1).map((b, i) => roundCone(p[i], b, r[i], r[i + 1]));
}
/** Solids joined with a hard minimum into one, to blend into another as a whole. */
export function join(parts: Shape[]): Shape {
  const ax = [0, 1, 2] as const;
  return {
    d(x, y, z) {
      let d = FAR;
      // A part whose box is already further than the nearest so far cannot be nearer.
      for (const s of parts) {
        const ox = Math.max(s.min[0] - x, 0, x - s.max[0]),
          oy = Math.max(s.min[1] - y, 0, y - s.max[1]),
          oz = Math.max(s.min[2] - z, 0, z - s.max[2]);
        if (ox * ox + oy * oy + oz * oz < d * d) d = Math.min(d, s.d(x, y, z));
      }
      return d;
    },
    min: ax.map((a) => Math.min(...parts.map((s) => s.min[a]))) as unknown as V3,
    max: ax.map((a) => Math.max(...parts.map((s) => s.max[a]))) as unknown as V3,
  };
}
/**
 * One smooth limb or lock through the points p (a centripetal Catmull-Rom curve, n round cones
 * between each pair), its radius running through r (one per point). The cones join with a hard
 * minimum: blended one by one, every joint would swell into a bead.
 */
export function strand(p: V3[], r: number[], n = 3): Shape {
  const curve = new T.CatmullRomCurve3(p.map((q) => new T.Vector3(...q)), false, 'centripetal'),
    steps = (p.length - 1) * n,
    pts: V3[] = [],
    rad: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const q = curve.getPoint(i / steps),
      f = i / n,
      j = Math.min(r.length - 2, Math.floor(f));
    pts.push([q.x, q.y, q.z]);
    rad.push(r[j] + (r[j + 1] - r[j]) * (f - j));
  }
  return join(chain(pts, rad));
}
/** A box of half-size s with its edges rounded by `round`, at c, turned by rot. */
export function roundBox(c: V3, s: V3, round: number, rot?: V3): Shape {
  const m = frame(rot),
    e = spread(m, s[0], s[1], s[2]);
  return {
    d(x, y, z) {
      const px = x - c[0],
        py = y - c[1],
        pz = z - c[2];
      const qx = Math.abs(m[0] * px + m[3] * py + m[6] * pz) - s[0] + round,
        qy = Math.abs(m[1] * px + m[4] * py + m[7] * pz) - s[1] + round,
        qz = Math.abs(m[2] * px + m[5] * py + m[8] * pz) - s[2] + round;
      const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, oz = qz > 0 ? qz : 0;
      return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - round;
    },
    min: [c[0] - e[0], c[1] - e[1], c[2] - e[2]],
    max: [c[0] + e[0], c[1] + e[1], c[2] + e[2]],
  };
}
/** A torus of ring radius R and tube radius r about its local y axis, at c, turned by rot. */
export function torus(c: V3, R: number, r: number, rot?: V3): Shape {
  const m = frame(rot),
    e = spread(m, R + r, r, R + r);
  return {
    d(x, y, z) {
      const px = x - c[0],
        py = y - c[1],
        pz = z - c[2];
      const lx = m[0] * px + m[3] * py + m[6] * pz,
        ly = m[1] * px + m[4] * py + m[7] * pz,
        lz = m[2] * px + m[5] * py + m[8] * pz;
      const ring = Math.sqrt(lx * lx + lz * lz) - R;
      return Math.sqrt(ring * ring + ly * ly) - r;
    },
    min: [c[0] - e[0], c[1] - e[1], c[2] - e[2]],
    max: [c[0] + e[0], c[1] + e[1], c[2] + e[2]],
  };
}
/** A solid squashed across x by sx about the plane x = cx (a neck deeper than it is wide). */
export function squashX(s: Shape, sx: number, cx = 0): Shape {
  const f = Math.min(1, sx);
  return {
    d: (x, y, z) => s.d(cx + (x - cx) / sx, y, z) * f,
    min: [cx + (s.min[0] - cx) * sx, s.min[1], s.min[2]],
    max: [cx + (s.max[0] - cx) * sx, s.max[1], s.max[2]],
  };
}
/** The part of a solid inside a second one (a saddle cloth: the inflated barrel within its outline), edges blended by k. */
export function within(s: Shape, region: Shape, k = 0): Shape {
  return {
    d: (x, y, z) => smax(s.d(x, y, z), region.d(x, y, z), k),
    min: [Math.max(s.min[0], region.min[0]), Math.max(s.min[1], region.min[1]), Math.max(s.min[2], region.min[2])],
    max: [Math.min(s.max[0], region.max[0]), Math.min(s.max[1], region.max[1]), Math.min(s.max[2], region.max[2])],
  };
}
/** A solid grown by g all round (a cloth over a body). */
export function grow(s: Shape, g: number): Shape {
  return { d: (x, y, z) => s.d(x, y, z) - g, min: [s.min[0] - g, s.min[1] - g, s.min[2] - g], max: [s.max[0] + g, s.max[1] + g, s.max[2] + g] };
}
/** The polynomial smooth minimum: a fillet of radius about k where two solids meet. */
export function smin(a: number, b: number, k: number) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export function smax(a: number, b: number, k: number) {
  return -smin(-a, -b, k);
}
const FAR = 1e3;

/** A solid's field anywhere (not only on the grid), for another sculpt's union. */
type Field = { exact: (x: number, y: number, z: number) => number; values: Float32Array };
type Op =
  | { kind: 'add' | 'cut' | 'layer'; s: Shape; k: number; g: number; lo: V3; hi: V3 }
  | { kind: 'union'; other: Field; k: number };
/** The four tetrahedral probe directions: their sum is 0 and the sum of their outer products 4I. */
const TETRA = [
  [1, -1, -1],
  [-1, -1, 1],
  [-1, 1, -1],
  [1, 1, 1],
];

/**
 * A distance grid over [min, max] at spacing h. add() blends solids in (each only over its own
 * box, grown by its blend and a margin), cut() carves them out, union() joins another grid's
 * solid with a hard edge (a rider sitting on his horse), and mesh() runs the surface net. Every
 * step is also kept as a list, so exact() gives the blended field at any point: the mesh's
 * vertices are put back on the true surface and take their normals from it, not from the grid.
 */
export function sculpt(min: V3, max: V3, h: number) {
  const nx = Math.ceil((max[0] - min[0]) / h) + 1,
    ny = Math.ceil((max[1] - min[1]) / h) + 1,
    nz = Math.ceil((max[2] - min[2]) / h) + 1,
    v = new Float32Array(nx * ny * nz).fill(FAR),
    ops: Op[] = [];
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const combine = (kind: 'add' | 'cut' | 'layer', k: number, g: number) =>
    kind === 'add'
      ? (a: number, b: number) => smin(a, b, k)
      : kind === 'cut'
        ? (a: number, b: number) => smax(a, -b, k)
        : // A smooth minimum with the body too: a hard crease where the layer ends aliases into steps.
          (a: number, b: number) => smin(a, smax(a - g, b, k), k * 0.5);
  function apply(s: Shape, k: number, kind: 'add' | 'cut' | 'layer', g = 0) {
    // The grid takes whole samples, so the exact field's box reaches one spacing further.
    const m = k + 3 * h,
      lo = (a: number, o: number) => Math.max(0, Math.floor((a - m - o) / h)),
      hi = (a: number, o: number, n: number) => Math.min(n - 1, Math.ceil((a + m - o) / h)),
      op = combine(kind, k, g);
    blocks = null;
    ops.push({ kind, s, k, g, lo: [s.min[0] - m - h, s.min[1] - m - h, s.min[2] - m - h], hi: [s.max[0] + m + h, s.max[1] + m + h, s.max[2] + m + h] });
    const i0 = lo(s.min[0], min[0]), i1 = hi(s.max[0], min[0], nx),
      j0 = lo(s.min[1], min[1]), j1 = hi(s.max[1], min[1], ny),
      k0 = lo(s.min[2], min[2]), k1 = hi(s.max[2], min[2], nz);
    for (let kk = k0; kk <= k1; kk++)
      for (let j = j0; j <= j1; j++)
        for (let i = i0, n = at(i0, j, kk); i <= i1; i++, n++)
          v[n] = op(v[n], s.d(min[0] + i * h, min[1] + j * h, min[2] + kk * h));
  }
  /**
   * The steps that reach each block of the grid (B spacings a side), built when exact() is first
   * asked after a change: a point replays only those, in order, not the whole list.
   */
  const B = 3,
    bx = Math.ceil(nx / B),
    by = Math.ceil(ny / B),
    bz = Math.ceil(nz / B);
  let blocks: Op[][] | null = null;
  function index() {
    const out: Op[][] = Array.from({ length: bx * by * bz }, () => []),
      span = B * h,
      cl = (a: number, n: number) => Math.min(n - 1, Math.max(0, a));
    for (const o of ops) {
      const lo = o.kind === 'union' ? min : o.lo,
        hi = o.kind === 'union' ? max : o.hi;
      const i0 = cl(Math.floor((lo[0] - min[0]) / span), bx), i1 = cl(Math.floor((hi[0] - min[0]) / span), bx),
        j0 = cl(Math.floor((lo[1] - min[1]) / span), by), j1 = cl(Math.floor((hi[1] - min[1]) / span), by),
        k0 = cl(Math.floor((lo[2] - min[2]) / span), bz), k1 = cl(Math.floor((hi[2] - min[2]) / span), bz);
      for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out[i + bx * (j + by * k)].push(o);
    }
    return out;
  }
  /** The blended field at any point, every step replayed (each only inside its own box, as on the grid). */
  function exact(x: number, y: number, z: number) {
    blocks ??= index();
    const span = B * h,
      i = Math.min(bx - 1, Math.max(0, Math.floor((x - min[0]) / span))),
      j = Math.min(by - 1, Math.max(0, Math.floor((y - min[1]) / span))),
      k = Math.min(bz - 1, Math.max(0, Math.floor((z - min[2]) / span)));
    let a = FAR;
    for (const o of blocks[i + bx * (j + by * k)]) {
      if (o.kind === 'union') {
        a = smin(a, o.other.exact(x, y, z), o.k);
        continue;
      }
      if (x < o.lo[0] || y < o.lo[1] || z < o.lo[2] || x > o.hi[0] || y > o.hi[1] || z > o.hi[2]) continue;
      const b = o.s.d(x, y, z);
      a = o.kind === 'add' ? smin(a, b, o.k) : o.kind === 'cut' ? smax(a, -b, o.k) : smin(a, smax(a - o.g, b, o.k), o.k * 0.5);
    }
    return a;
  }
  /** The field at any point, trilinear between the grid's samples (FAR outside it). */
  function sample(x: number, y: number, z: number) {
    const fx = (x - min[0]) / h,
      fy = (y - min[1]) / h,
      fz = (z - min[2]) / h;
    if (fx < 0 || fy < 0 || fz < 0 || fx >= nx - 1 || fy >= ny - 1 || fz >= nz - 1) return FAR;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz),
      tx = fx - i, ty = fy - j, tz = fz - k,
      n = at(i, j, k), sy = nx, sz = nx * ny;
    const c00 = v[n] + (v[n + 1] - v[n]) * tx,
      c10 = v[n + sy] + (v[n + sy + 1] - v[n + sy]) * tx,
      c01 = v[n + sz] + (v[n + sz + 1] - v[n + sz]) * tx,
      c11 = v[n + sy + sz] + (v[n + sy + sz + 1] - v[n + sy + sz]) * tx;
    return (c00 + (c10 - c00) * ty) * (1 - tz) + (c01 + (c11 - c01) * ty) * tz;
  }
  /**
   * The surface net: one vertex per cell the surface crosses, one quad per crossed grid edge.
   * Each vertex is then put on the exact surface (a Newton step along the exact field's gradient,
   * at most half a spacing) and takes the exact gradient as its normal, so the trilinear grid's
   * small dents never show in the shading or the silhouette.
   */
  function mesh() {
    const cells = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1),
      cell = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k),
      pos: number[] = [],
      idx: number[] = [],
      c = new Float32Array(8);
    // The 12 cube edges as corner pairs (corner bit 1 = +x, 2 = +y, 4 = +z).
    const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const sxy = nx * ny,
      corner = [0, 1, nx, nx + 1, sxy, sxy + 1, sxy + nx, sxy + nx + 1],
      inside = new Uint8Array(v.length);
    for (let n = 0; n < v.length; n++) inside[n] = v[n] < 0 ? 1 : 0;
    for (let k = 0; k < nz - 1; k++)
      for (let j = 0; j < ny - 1; j++)
        for (let i = 0, base = at(0, j, k); i < nx - 1; i++, base++) {
          let mask = 0;
          for (let q = 0; q < 8; q++) mask |= inside[base + corner[q]] << q;
          if (mask === 0 || mask === 255) continue;
          for (let q = 0; q < 8; q++) c[q] = v[base + corner[q]];
          let sx = 0, sy = 0, sz = 0, n = 0;
          for (const [a, b] of E) {
            if ((c[a] < 0) === (c[b] < 0)) continue;
            const t = c[a] / (c[a] - c[b]);
            sx += (a & 1) + (((b & 1) - (a & 1)) * t);
            sy += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t);
            sz += ((a >> 2) & 1) + ((((b >> 2) & 1) - ((a >> 2) & 1)) * t);
            n++;
          }
          cells[cell(i, j, k)] = pos.length / 3;
          pos.push(min[0] + (i + sx / n) * h, min[1] + (j + sy / n) * h, min[2] + (k + sz / n) * h);
        }
    const quad = (a: number, b: number, cc: number, d: number, lowIn: boolean) => {
      if (a < 0 || b < 0 || cc < 0 || d < 0) return;
      if (lowIn) idx.push(a, b, cc, a, cc, d);
      else idx.push(a, d, cc, a, cc, b);
    };
    for (let k = 1; k < nz - 1; k++)
      for (let j = 1; j < ny - 1; j++)
        for (let i = 0; i < nx - 1; i++) {
          const n = at(i, j, k), a = inside[n] === 1;
          if (inside[n] === inside[n + 1]) continue;
          quad(cells[cell(i, j - 1, k - 1)], cells[cell(i, j, k - 1)], cells[cell(i, j, k)], cells[cell(i, j - 1, k)], a);
        }
    for (let k = 1; k < nz - 1; k++)
      for (let j = 0; j < ny - 1; j++)
        for (let i = 1; i < nx - 1; i++) {
          const n = at(i, j, k), a = inside[n] === 1;
          if (inside[n] === inside[n + nx]) continue;
          quad(cells[cell(i - 1, j, k - 1)], cells[cell(i - 1, j, k)], cells[cell(i, j, k)], cells[cell(i, j, k - 1)], a);
        }
    for (let k = 0; k < nz - 1; k++)
      for (let j = 1; j < ny - 1; j++)
        for (let i = 1; i < nx - 1; i++) {
          const n = at(i, j, k), a = inside[n] === 1;
          if (inside[n] === inside[n + sxy]) continue;
          quad(cells[cell(i - 1, j - 1, k)], cells[cell(i, j - 1, k)], cells[cell(i, j, k)], cells[cell(i - 1, j, k)], a);
        }
    const count = pos.length / 3,
      p = Float32Array.from(pos),
      nor = new Float32Array(count * 3),
      e = h * 0.3,
      g = [0, 0, 0];
    /** The exact field's gradient at (x, y, z) into g, from four probes e away. */
    const gradient = (x: number, y: number, z: number) => {
      g[0] = g[1] = g[2] = 0;
      for (const [a, b, cc] of TETRA) {
        const f = exact(x + a * e, y + b * e, z + cc * e);
        g[0] += a * f;
        g[1] += b * f;
        g[2] += cc * f;
      }
      return Math.hypot(g[0], g[1], g[2]);
    };
    for (let i = 0; i < count; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2],
        f = exact(x, y, z),
        l = gradient(x, y, z) || 1;
      // One Newton step along the unit gradient by the field's value (a distance bound, so the
      // gradient's length is about 4e), never more than h / 2; the gradient there is the normal.
      const move = T.MathUtils.clamp((f * 4 * e) / l, -h * 0.5, h * 0.5) / l;
      p.set([x - g[0] * move, y - g[1] * move, z - g[2] * move], i * 3);
      nor.set([g[0] / l, g[1] / l, g[2] / l], i * 3);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(p, 3));
    geometry.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geometry.setIndex(idx);
    return geometry;
  }
  const api = {
    /** Blend a solid in with a fillet of radius k (0: a hard union). */
    add(s: Shape, k = 0) {
      apply(s, k, 'add');
      return api;
    },
    /** Carve a solid out, its edge softened by k. */
    cut(s: Shape, k = 0) {
      apply(s, k, 'cut');
      return api;
    },
    /**
     * Lay a layer g thick over what is there so far, inside `region` (its edge rounded by k): a
     * saddle cloth or a girth that follows the body under it, wherever the blend has put it.
     */
    layer(region: Shape, g: number, k = 0) {
      apply(region, k, 'layer', g);
      return api;
    },
    /** Join another grid's solid (the same bounds and spacing), with a fillet of radius k (a small one keeps the seam crisp but unaliased). */
    union(other: Field, k = 0) {
      blocks = null;
      ops.push({ kind: 'union', other, k });
      for (let n = 0; n < v.length; n++) v[n] = smin(v[n], other.values[n], k);
      return api;
    },
    exact,
    sample,
    mesh,
    values: v,
  };
  return api;
}
function hash3(i: number, j: number, k: number) {
  let n = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x9e3779b1);
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}
function value3(x: number, y: number, z: number) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = x - i, fy = y - j, fz = z - k,
    u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy), s = fz * fz * (3 - 2 * fz);
  const a = hash3(i, j, k) + (hash3(i + 1, j, k) - hash3(i, j, k)) * u,
    b = hash3(i, j + 1, k) + (hash3(i + 1, j + 1, k) - hash3(i, j + 1, k)) * u,
    c = hash3(i, j, k + 1) + (hash3(i + 1, j, k + 1) - hash3(i, j, k + 1)) * u,
    d = hash3(i, j + 1, k + 1) + (hash3(i + 1, j + 1, k + 1) - hash3(i, j + 1, k + 1)) * u;
  return (a + (b - a) * w) * (1 - s) + (c + (d - c) * w) * s;
}
/** Two-octave value noise in 3D (0..1), for weathering that follows the form rather than a texture. */
export function noise3(x: number, y: number, z: number) {
  return value3(x, y, z) * 0.65 + value3(x * 2.1 + 17.3, y * 2.1 - 4.1, z * 2.1 + 9.7) * 0.35;
}

/** One step of a moulding's profile: inset s from the block's outline at height y; `sharp` breaks the shading there (an arris). */
export type Moulding = { s: number; y: number; sharp?: boolean };
/**
 * A rectangular block of half-size (hx, hz) swept up a moulding profile (a plinth's base
 * moulding, its die and its cornice): each step is a rounded rectangle inset by s at height y,
 * its corners rounded by `corner` (never under 0.02, so no arris is knife-sharp), and the top is
 * closed. Normals follow the profile, so a torus or a cavetto shades round and an arris stays crisp.
 */
export function mouldedBlock(hx: number, hz: number, profile: Moulding[], corner = 0.05, arc = 4) {
  // The profile's outward normals (out, up) on the segments below and above each step.
  const seg = profile.slice(1).map((p, i) => {
    const dr = profile[i].s - p.s, // outward is -s
      dy = p.y - profile[i].y,
      l = Math.hypot(dr, dy) || 1;
    return [dy / l, -dr / l];
  });
  type Ring = { s: number; y: number; n: number[] };
  const rings: { below?: Ring; above?: Ring }[] = profile.map((p, i) => {
    const lo = seg[i - 1], hi = seg[i];
    if (!lo || !hi) return { below: lo && { ...p, n: lo }, above: hi && { ...p, n: hi } };
    if (p.sharp) return { below: { ...p, n: lo }, above: { ...p, n: hi } };
    const n = [lo[0] + hi[0], lo[1] + hi[1]], l = Math.hypot(n[0], n[1]) || 1;
    const r = { ...p, n: [n[0] / l, n[1] / l] };
    return { below: r, above: r };
  });
  /** The ring's points (x, z) and horizontal normals, clockwise seen from above starting at +x. */
  const loop = (s: number) => {
    const rc = Math.max(0.02, corner - s),
      ax = hx - s - rc,
      az = hz - s - rc,
      out: number[][] = [];
    for (const [cx, cz, a0] of [[ax, az, 0], [-ax, az, Math.PI / 2], [-ax, -az, Math.PI], [ax, -az, Math.PI * 1.5]])
      for (let q = 0; q <= arc; q++) {
        const a = a0 + (q / arc) * (Math.PI / 2);
        out.push([cx + rc * Math.cos(a), cz + rc * Math.sin(a), Math.cos(a), Math.sin(a)]);
      }
    return out;
  };
  const pos: number[] = [], nor: number[] = [];
  const vert = (pt: number[], r: Ring) => {
    pos.push(pt[0], r.y, pt[1]);
    nor.push(pt[2] * r.n[0], r.n[1], pt[3] * r.n[0]);
  };
  for (let i = 0; i < profile.length - 1; i++) {
    const a = rings[i].above!, b = rings[i + 1].below!,
      la = loop(a.s), lb = loop(b.s), n = la.length;
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      vert(la[k], a); vert(lb[k], b); vert(lb[k1], b);
      vert(la[k], a); vert(lb[k1], b); vert(la[k1], a);
    }
  }
  // The top: a fan from the middle.
  const last = profile[profile.length - 1], top = loop(last.s), up = { s: last.s, y: last.y, n: [0, 1] };
  for (let k = 0; k < top.length; k++) {
    const k1 = (k + 1) % top.length;
    pos.push(0, last.y, 0);
    nor.push(0, 1, 0);
    vert(top[k1], up); vert(top[k], up);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  return geometry;
}
