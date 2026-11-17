import * as T from 'three';
import type { SurfaceKind } from './city-materials';
import { blob, DEPTH, HEAD, lathe, paint, part, shade, TORSO, torsoAt } from './city-people';
import type { AlisonJoints } from './sky-figure';
import { ellipsoid, sculpt, strand, type Shape } from './town-sculpt';

/*
 * Filip Biljecki's little figure for the tropic island: his look only (his motion is the island's).
 * He is built on exactly Alison's rig (sky-figure.ts): the same parts, joint names, pivots and
 * hierarchy, so her pose maths and the residents' walk drive him unchanged; his root is scaled
 * FILIP_SCALE all over (he is taller), so every pose's numbers stay hers in his root's frame. His
 * look is the public profile's: short brown hair parted on his left and swept across to his right,
 * clean-shaven, no glasses, light skin, a white open-collar shirt with its sleeves rolled to the
 * elbow, tucked into navy chinos with a brown belt, and brown shoes. His head is his own
 * (FILIP_HEAD): a little longer and leaner than the residents' nearly round one, which read too
 * full on him. Every part is one mesh per surface kind with its colours on its vertices, as hers
 * are; features are drawn as flat colour cells whose edges are the triangles' own (the eyes and
 * brows, the open collar's skin, the placket, the buckle), so nothing thin stands free to twinkle.
 */
type Material = (c: string, k?: SurfaceKind) => T.MeshStandardMaterial;
type V3 = [number, number, number];

/** How much taller than Alison he is: his root is scaled this much all over (her rig's numbers hold inside it). */
export const FILIP_SCALE = 1.08;
/**
 * His colours (sRGB), every one at or under the figures' HSV saturation 0.55 (no exception: the
 * hair's brown is 0.53 and keeps that saturation in every shade). The shirt is a calm white a hair
 * cooler than the china (its brightest pixel under the strongest key light 242, 230, 212: it never
 * clips); the chinos a dark navy that anchors it at the overview; the eyes the residents' dark
 * brown and the brows a step deeper than the hair, both drawn on the face.
 */
export const FILIP_LOOK = {
  hair: '#6e4c34',
  brows: '#5a3e2b',
  skin: '#f0cba9',
  shirt: '#ece8df',
  trousers: '#3a4352',
  belt: '#4b392e',
  buckle: '#857152',
  shoes: '#5b4232',
  eyes: '#2b2622',
  phone: '#2d2b2e',
  china: '#efeae0',
  chinaBand: '#a39a8e',
  coffee: '#5e4230',
};

/* ------------------------------------------------------------------ */
/* Measures: Alison's (sky-figure.ts), which are the residents'        */
/* ------------------------------------------------------------------ */
/** The hips' pivot height, the shoulders' pivots, the arm's two bones and the thigh's radius at the hip. */
const HIP = 0.31,
  SHOULDER = { x: 0.165, y: 0.6 },
  UPPER = 0.095,
  FORE = 0.12,
  THIGH_R = 0.063;
/** The cup's axis stands this far from its handle (the cup's origin), along its +x: Alison's teacup. */
const CUP_AXIS = 0.058;
/** The hair's distance grid: its triangles go as 1/h² (about 1,600 show at this spacing). */
const HAIR_GRID = 0.02;
/**
 * Where the open collar's V of skin runs on the torso: from its point (`tip`) up to the neck, its
 * half-width growing by `spread` over its first `rise` (then held, as the torso closes in to the
 * neck), never more than `turn` radians round from straight ahead. The placket runs from the belt
 * up to the V's point, `placket` either side of the middle.
 */
const COLLAR = { tip: 0.53, spread: 0.046, rise: 0.088, turn: 0.489, placket: 0.011 };
/** The belt: its foot and head on the torso, how far it stands proud, and the buckle's half-width. */
const BELT = { foot: 0.316, head: 0.388, proud: 0.008, buckle: 0.022 };
/**
 * Features drawn on the head, each a cell between its rows (heights, bottom to top) either side of
 * the face: at each row, how far out its middle is (x) and its half-width there. His eyes are small
 * rounded ovals; his brows soft bars a little fuller at their inner ends, their outer ends tapering
 * down, so the face reads friendly, not stern. They are drawn as on a resident's head (HEAD); each
 * feature's middle is carried onto his by onFilip, its size kept (rows and half-widths about it).
 */
const EYES = { rows: [0.759, 0.7655, 0.7785, 0.785], x: [0.052, 0.052, 0.052, 0.052], half: [0.006, 0.0102, 0.0102, 0.006] },
  BROWS = { rows: [0.8025, 0.8085, 0.8138], x: [0.0535, 0.0528, 0.0498], half: [0.0185, 0.0198, 0.0128] };
/**
 * His head, his own: the residents' HEAD is nearly a ball (0.15 by 0.148 by 0.142), and on him it
 * read too round and full (the owner, 2026-11-16). His is a smooth egg a little longer and leaner,
 * taller than it is wide: its widest ring `y` up (its middle `z` ahead), `r` its half-width and
 * half-depth there; the crown rises `up` above it and the chin falls `down` below it (0.33 in all,
 * 11.5% more than HEAD's 0.296; 0.278 across, 7.3% less). Down its lower half (s from 0 at the
 * widest ring to -1 at the chin's end) each ring narrows across by `jaw` |s|^1.5 and in depth by
 * `tuck` |s|^1.5, and its middle comes forward by `chin` |s|^1.5: the cheeks are less full (the
 * face 8 to 10% narrower than HEAD's from the nose down), the jaw and chin narrow gently and come
 * a little lower and forward (the chin meets his shoulders 0.009 lower), and the back of his head
 * still meets his shoulders where HEAD's does, under the collar. Its upper half is HEAD's shape,
 * 7.3% narrower, 1.4% shallower and 4.7% taller, so the crown rises 0.007.
 */
export const FILIP_HEAD = { y: 0.75, z: 0.005, up: 0.155, down: 0.175, r: [0.139, 0.14] as [number, number], jaw: 0.26, tuck: 0.22, chin: 0.012 };
/** His ears' middles on a resident's head (HEAD), and their half-sizes: carried onto his, each stands 0.019 out of it. */
const EAR = { at: [0.131, 0.745, -0.006] as V3, r: [0.0372, 0.042, 0.0372] as V3 };
/** His nose's height on a resident's head, its middle 0.006 inside the face, and its half-sizes (a resident's). */
const NOSE = { y: 0.729, r: [0.022, 0.02, 0.02] as V3 };

/* ------------------------------------------------------------------ */
/* Colour                                                              */
/* ------------------------------------------------------------------ */
const srgb = new T.Color();
/** A hex colour as sRGB components (0..1). */
function sRGB(hex: string): V3 {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
/** A hex colour as HSV: hue in degrees, saturation and value 0..1. */
function toHsv(hex: string): V3 {
  const [r, g, b] = sRGB(hex),
    max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  return [max === min ? 0 : (60 * (g - b)) / (max - min), max ? (max - min) / max : 0, max];
}
/** HSV (hue in degrees, saturation and value 0..1) as sRGB components. */
function hsv(h: number, sat: number, v: number): V3 {
  const f = (k: number) => {
    const m = (k + h / 60) % 6;
    return v - v * sat * Math.max(0, Math.min(m, 4 - m, 1));
  };
  return [f(5), f(3), f(1)];
}
const smooth = T.MathUtils.smoothstep,
  TAU = Math.PI * 2;

/* ------------------------------------------------------------------ */
/* Ring surfaces: smooth solids of revolution with crisp colour cells  */
/* ------------------------------------------------------------------ */
/**
 * A column of a ring: its angle round the upright (0 straight ahead, +x at pi/2) and, for a column
 * that must meet the same column of the next ring along an edge, a tag.
 */
type Column = { a: number; tag?: string };
/** A point of a surface and its outward normal. */
type Corner = { p: T.Vector3; n: T.Vector3 };
/** A ring of a surface: its columns, and the surface's point and normal at an angle. A ring of one column is a pole. */
type Ring = { cols: Column[]; at: (a: number) => Corner };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/**
 * The columns round a ring: `n` evenly spaced (one straight ahead, so a figure stays symmetric) and
 * the `tags`; an even column within `gap` of a tag gives way to it, so no sliver is left beside an edge.
 */
function columns(n: number, tags: Column[] = [], gap = 0.035): Column[] {
  const even = Array.from({ length: n }, (_, j) => {
    const a = (TAU * j) / n;
    return { a: a > Math.PI + 1e-9 ? a - TAU : a };
  });
  // (A stable sort: two tags at one angle, the V's at its point, keep the order they were given in.)
  return [...even.filter((c) => tags.every((t) => Math.abs(wrap(c.a - t.a)) > gap)), ...tags].sort((p, q) => p.a - q.a);
}
/**
 * Stitch ring A to ring B with triangles, handing each to `emit` with the tags at the ends of the
 * stretch it lies in. Columns tagged alike in both rings are joined by an edge, and each stretch
 * between two such edges is stitched on its own (walking both rings by how far round the stretch
 * each column is), so no triangle crosses a tagged edge: the stretch between two tags is a cell
 * of its own, whatever its shape. A pole (a ring of one column) is a fan.
 */
function bridge(A: Ring, B: Ring, emit: (q: Corner[], cell: string) => void) {
  const nA = A.cols.length,
    nB = B.cols.length,
    ang = (R: Ring, k: number) => {
      const n = R.cols.length;
      return R.cols[((k % n) + n) % n].a + TAU * Math.floor(k / n);
    },
    at = (R: Ring, k: number) => R.at(ang(R, k)),
    tagOf = (R: Ring, k: number) => R.cols[((k % R.cols.length) + R.cols.length) % R.cols.length].tag ?? '';
  if (nA === 1 || nB === 1) {
    const [P, R] = nA === 1 ? [A, B] : [B, A];
    for (let k = 0; k < R.cols.length; k++) emit([at(P, 0), at(R, k), at(R, k + 1)], '|');
    return;
  }
  const pairs: [number, number][] = [];
  A.cols.forEach((c, i) => {
    const j = c.tag ? B.cols.findIndex((d) => d.tag === c.tag) : -1;
    if (j >= 0) pairs.push([i, j]);
  });
  if (!pairs.length) {
    // No edge to keep: start from A's first column and B's nearest.
    let best = Infinity,
      j0 = 0;
    B.cols.forEach((d, j) => {
      const g = Math.abs(wrap(d.a - A.cols[0].a));
      if (g < best) {
        best = g;
        j0 = j;
      }
    });
    pairs.push([0, j0]);
  }
  for (let s = 0; s < pairs.length; s++) {
    const [i0, j0] = pairs[s],
      [ni, nj] = pairs[(s + 1) % pairs.length],
      i1 = ni > i0 ? ni : ni + nA,
      j1 = nj > j0 ? nj : nj + nB,
      cell = `${tagOf(A, i0)}|${tagOf(A, i1)}`,
      // How far round the stretch a column is (by count where the stretch has no breadth: the V's point).
      along = (R: Ring, k0: number, k1: number, k: number) => {
        const span = ang(R, k1) - ang(R, k0);
        return span > 1e-9 ? (ang(R, k) - ang(R, k0)) / span : (k - k0) / (k1 - k0);
      };
    let i = i0,
      j = j0;
    while (i < i1 || j < j1)
      if (j >= j1 || (i < i1 && along(A, i0, i1, i + 1) <= along(B, j0, j1, j + 1))) emit([at(A, i), at(B, j), at(A, ++i)], cell);
      else emit([at(A, i), at(B, j), at(B, ++j)], cell);
  }
}
/**
 * The surface through `rings` (bottom to top), un-indexed: each triangle turned out (as its
 * corners' normals face), coloured by `colour` from its middle and the cell it lies in (its
 * stretch's two tags, 'a|b'), each corner's colour times `tone` there.
 */
function ringMesh(rings: Ring[], colour: (middle: T.Vector3, cell: string) => string, tone: (p: T.Vector3) => number = () => 1) {
  const pos: number[] = [],
    nor: number[] = [],
    col: number[] = [],
    u = new T.Vector3(),
    w = new T.Vector3(),
    middle = new T.Vector3(),
    c = new T.Color();
  const emit = (q: Corner[], cell: string) => {
    u.subVectors(q[1].p, q[0].p);
    w.subVectors(q[2].p, q[0].p);
    const face = u.clone().cross(w);
    if (face.lengthSq() < 1e-16) return;
    if (face.dot(q[0].n.clone().add(q[1].n).add(q[2].n)) < 0) q = [q[0], q[2], q[1]];
    middle.copy(q[0].p).add(q[1].p).add(q[2].p).multiplyScalar(1 / 3);
    const hex = colour(middle, cell);
    for (const k of q) {
      pos.push(k.p.x, k.p.y, k.p.z);
      nor.push(k.n.x, k.n.y, k.n.z);
      c.set(hex).multiplyScalar(tone(k.p));
      col.push(c.r, c.g, c.b);
    }
  };
  for (let i = 0; i + 1 < rings.length; i++) bridge(rings[i], rings[i + 1], emit);
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  return g;
}
/**
 * A profile's normals as three's lathe shades it ([radius, height] points, bottom to top): each
 * point's the sum of its two segments' (the first and last point's their one segment's), as
 * [outward, up], normalised.
 */
function profileNormals(P: number[][]): [number, number][] {
  const seg = P.slice(1).map((q, i) => [q[1] - P[i][1], -(q[0] - P[i][0])]);
  return P.map((_, k) => {
    const a = seg[Math.max(0, k - 1)],
      b = seg[Math.min(seg.length - 1, k)],
      s = k === 0 ? b : k === P.length - 1 ? a : [a[0] + b[0], a[1] + b[1]],
      l = Math.hypot(s[0], s[1]) || 1;
    return [s[0] / l, s[1] / l];
  });
}
/**
 * The rings of a lathe-like solid through the profile `P` ([radius, height], bottom to top, with
 * its normals `N`), `depth` as deep as it is wide (scaled about the upright, as the torso is), with
 * rows added at `extra` heights on its sides and each row's columns from `cols(y, r)`.
 */
function latheRings(P: number[][], N: [number, number][], depth: number, extra: number[], cols: (y: number, r: number) => Column[]): Ring[] {
  type Row = { r: number; y: number; nr: number; ny: number };
  const rows: Row[] = [];
  P.forEach(([r, y], k) => {
    rows.push({ r, y, nr: N[k][0], ny: N[k][1] });
    const next = P[k + 1];
    if (!next || next[1] <= y) return;
    for (const e of extra)
      if (e > y + 1e-9 && e < next[1] - 1e-9) {
        const t = (e - y) / (next[1] - y),
          nr = N[k][0] + (N[k + 1][0] - N[k][0]) * t,
          ny = N[k][1] + (N[k + 1][1] - N[k][1]) * t,
          l = Math.hypot(nr, ny);
        rows.push({ r: r + (next[0] - r) * t, y: e, nr: nr / l, ny: ny / l });
      }
  });
  return rows.map(({ r, y, nr, ny }) => {
    if (r < 1e-9) return { cols: [{ a: 0 }], at: () => ({ p: new T.Vector3(0, y, 0), n: new T.Vector3(0, Math.sign(ny) || 1, 0) }) };
    return {
      cols: cols(y, r),
      at: (a: number) => ({
        p: new T.Vector3(r * Math.sin(a), y, r * Math.cos(a) * depth),
        n: new T.Vector3(nr * Math.sin(a), ny, (nr * Math.cos(a)) / depth).normalize(),
      }),
    };
  });
}

/* ------------------------------------------------------------------ */
/* The shirt: torso, belt and collar                                   */
/* ------------------------------------------------------------------ */
/** How far round from straight ahead the V of his open collar reaches at height y (its edge), on the torso. */
function collarTurn(y: number) {
  const w = (COLLAR.spread * T.MathUtils.clamp(y - COLLAR.tip, 0, COLLAR.rise)) / COLLAR.rise,
    r = torsoAt(y);
  return r > 1e-6 ? Math.min(COLLAR.turn, Math.asin(Math.min(0.999, w / r))) : COLLAR.turn;
}
/**
 * The torso: a resident's (city-people's TORSO, 0.86 as deep as wide), as one smooth surface in the
 * white shirt, with the open collar's V of skin from his collarbones down to COLLAR.tip, the placket
 * a shade deeper from there down to the belt, and the chinos below it; each an exact cell of the
 * surface (its edges are the triangles'), so the V keeps a clean edge at any size. Darker a little
 * towards the waist.
 */
function torsoGeometry() {
  const L = FILIP_LOOK,
    P = TORSO,
    N = profileNormals(P),
    rings = latheRings(P, N, DEPTH, [0.352, BELT.head - 0.003, 0.5575, 0.6015], (y, r) => {
      const tags: Column[] = [];
      if (y > BELT.head - 0.004 && y <= COLLAR.tip + 1e-9) tags.push({ a: -COLLAR.placket / r, tag: 'pL' }, { a: COLLAR.placket / r, tag: 'pR' });
      if (y >= COLLAR.tip - 1e-9) tags.push({ a: -collarTurn(y), tag: 'vL' }, { a: collarTurn(y), tag: 'vR' });
      return columns(16, tags);
    });
  return ringMesh(
    rings,
    (m, cell) => (cell === 'vL|vR' ? shade(L.skin, 0.96) : cell === 'pL|pR' ? shade(L.shirt, 0.93) : m.y < 0.352 ? L.trousers : m.y < BELT.head ? L.belt : L.shirt),
    (p) => T.MathUtils.lerp(0.94, 1, smooth(p.y, 0.4, 0.62)),
  );
}
/**
 * The belt round his waist: a band standing BELT.proud out from the torso, its edges rounded, its
 * inner edges sunk into the torso; at its front the buckle, a muted brass cell of its face.
 */
function beltGeometry() {
  const { foot, head, proud, buckle } = BELT,
    profile = [
      [torsoAt(foot) - 0.01, foot - 0.002],
      [torsoAt(foot) + proud * 0.5, foot],
      [torsoAt(foot + 0.006) + proud, foot + 0.006],
      [torsoAt(head - 0.006) + proud, head - 0.006],
      [torsoAt(head) + proud * 0.5, head],
      [torsoAt(head) - 0.01, head + 0.002],
    ],
    rings = latheRings(profile, profileNormals(profile), DEPTH, [], (y, r) =>
      columns(16, y > foot + 0.003 && y < head - 0.003 ? [{ a: -buckle / r, tag: 'bL' }, { a: buckle / r, tag: 'bR' }] : []),
    );
  return ringMesh(rings, (_, cell) => (cell === 'bL|bR' ? FILIP_LOOK.buckle : FILIP_LOOK.belt));
}
/** The torso's surface point and its normal at angle a (0 ahead) and height y. */
function onTorso(a: number, y: number): Corner {
  const r = torsoAt(y),
    N = profileNormals(TORSO);
  let nr = 1,
    ny = 0;
  for (let k = 1; k < TORSO.length; k++) {
    const [, y0] = TORSO[k - 1],
      [, y1] = TORSO[k];
    if (y >= y0 && y <= y1 && y1 > y0) {
      const t = (y - y0) / (y1 - y0);
      nr = N[k - 1][0] + (N[k][0] - N[k - 1][0]) * t;
      ny = N[k - 1][1] + (N[k][1] - N[k - 1][1]) * t;
      break;
    }
  }
  return {
    p: new T.Vector3(r * Math.sin(a), y, r * Math.cos(a) * DEPTH),
    n: new T.Vector3(nr * Math.sin(a), ny, (nr * Math.cos(a)) / DEPTH).normalize(),
  };
}
/**
 * A smooth tube along a centripetal Catmull-Rom curve through `p`, its section an ellipse lying on
 * what it rests on (half-width `a` across it, half-thickness `b` along `out`, each running through
 * its list), closed at each end by a half ellipsoid as deep as it is thick; rings about `step` apart,
 * `radial` points round each, every normal the ellipse's own.
 */
function sweep(p: V3[], a: number[], b: number[], out: V3[], radial = 8, step = 0.022) {
  const curve = new T.CatmullRomCurve3(p.map((q) => new T.Vector3(...q)), false, 'centripetal'),
    length = curve.getLength(),
    n = Math.max(3, Math.ceil(length / step)),
    m = p.length - 1,
    along = (list: number[], t: number) => {
      const f = Math.min(m - 1e-9, Math.max(0, t * m)),
        i = Math.floor(f);
      return list[i] + (list[i + 1] - list[i]) * (f - i);
    },
    pos: number[] = [],
    nor: number[] = [],
    idx: number[] = [],
    starts: number[] = [];
  const frames = Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n,
      t = curve.getUtoTmapping(u, u * length),
      c = curve.getPointAt(u),
      tt = curve.getTangentAt(u),
      o = new T.Vector3(along(out.map((v) => v[0]), t), along(out.map((v) => v[1]), t), along(out.map((v) => v[2]), t));
    o.addScaledVector(tt, -o.dot(tt)).normalize();
    return { c, t: tt, N: o, S: new T.Vector3().crossVectors(o, tt), A: along(a, t), B: along(b, t) };
  });
  const ring = (f: (typeof frames)[number], lat: number, end: number) => {
    starts.push(pos.length / 3);
    const ca = Math.cos(lat),
      sa = Math.sin(lat);
    for (let j = 0; j < radial; j++) {
      const th = (j / radial) * TAU,
        x = Math.cos(th),
        y = Math.sin(th),
        q = f.c.clone().addScaledVector(f.S, f.A * x * ca).addScaledVector(f.N, f.B * y * ca).addScaledVector(f.t, f.B * sa * end),
        nn = f.S.clone().multiplyScalar((x * ca) / f.A).addScaledVector(f.N, (y * ca) / f.B).addScaledVector(f.t, (sa * end) / f.B).normalize();
      pos.push(q.x, q.y, q.z);
      nor.push(nn.x, nn.y, nn.z);
    }
  };
  const pole = (f: (typeof frames)[number], end: number) => {
    pos.push(f.c.x + f.t.x * f.B * end, f.c.y + f.t.y * f.B * end, f.c.z + f.t.z * f.B * end);
    nor.push(f.t.x * end, f.t.y * end, f.t.z * end);
    return pos.length / 3 - 1;
  };
  const first = pole(frames[0], -1);
  for (const lat of [(Math.PI * 3) / 8, Math.PI / 5]) ring(frames[0], lat, -1);
  for (const f of frames) ring(f, 0, 1);
  for (const lat of [Math.PI / 5, (Math.PI * 3) / 8]) ring(frames[n], lat, 1);
  const last = pole(frames[n], 1);
  for (let k = 0; k < starts.length; k++)
    for (let j = 0; j < radial; j++) {
      const v0 = starts[k] + j,
        v1 = starts[k] + ((j + 1) % radial);
      if (k === 0) idx.push(first, v1, v0);
      if (k === starts.length - 1) idx.push(v0, v1, last);
      else idx.push(v0, v1, v1 + radial, v0, v1 + radial, v0 + radial);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}
/**
 * His open collar: a soft rolled band lying round the crease where his head meets his shoulders,
 * open at the front, each end turning down into a broad collar point lying on his chest beside the
 * V of skin (whose edge it covers), as an open-collar shirt's do. Two halves, meeting behind his neck.
 */
function collarGeometry() {
  // [angle round from ahead, height] on the torso, and the section's half-width there, from the back
  // of his neck (in the crease where head and shoulders meet, about 0.626 up all round) round his
  // side to the front, where it turns down beside the V (its inner edge on the V's), the point
  // flaring out a little from it.
  const path: [number, number, number][] = [
    [Math.PI, 0.627, 0.017],
    [2.35, 0.627, 0.018],
    [1.55, 0.626, 0.019],
    [0.95, 0.622, 0.021],
    [0.62, 0.611, 0.028],
    [0.47, 0.593, 0.027],
    [0.4, 0.575, 0.016],
    [0.39, 0.566, 0.009],
  ];
  const halves = [-1, 1].map((s) => {
    const on = path.map(([a, y]) => onTorso(s * a, y)),
      b = 0.0105;
    return sweep(
      on.map((c) => c.p.clone().addScaledVector(c.n, b * 0.8).toArray() as V3),
      path.map((q) => q[2]),
      path.map(() => b),
      on.map((c) => c.n.toArray() as V3),
      7,
      0.02,
    );
  });
  // (What the head and the torso hide of it is left out.)
  return halves.map((g) => shownOnly(paint(g, (p) => (p.y < 0.6 ? shade(FILIP_LOOK.shirt, 0.97) : FILIP_LOOK.shirt)), insideBody));
}

/* ------------------------------------------------------------------ */
/* The head: face, ears and hair                                       */
/* ------------------------------------------------------------------ */
/** Where height y lies on his head's own scale: 1 at the crown, 0 at the widest ring, -1 at the chin's end. */
const headS = (y: number) => (y - FILIP_HEAD.y) / (y < FILIP_HEAD.y ? FILIP_HEAD.down : FILIP_HEAD.up);
/**
 * His head's ring at s on its own scale: its height, its middle (z), and its half-width and
 * half-depth before the ring's own sqrt(1 - s²) (so the ring is x² / X² + (z - mid)² / Z² = 1 - s²).
 */
function headRing(s: number) {
  const H = FILIP_HEAD,
    low = s < 0 ? Math.min(1, -s) ** 1.5 : 0;
  return { y: H.y + s * (s < 0 ? H.down : H.up), mid: H.z + H.chin * low, X: H.r[0] * (1 - H.jaw * low), Z: H.r[1] * (1 - H.tuck * low) };
}
/**
 * How far out a point is on his head's own scale: 1 on its surface, less inside (as HEAD's
 * ellipsoid test is on a resident's head).
 */
export function filipHeadReach(x: number, y: number, z: number) {
  const s = headS(y),
    R = headRing(s);
  return Math.hypot(x / R.X, s, (z - R.mid) / R.Z);
}
/** His face's front (its z) at x across and y up, on his head's surface. */
function headFront(x: number, y: number) {
  const s = headS(y),
    R = headRing(s);
  return R.mid + R.Z * Math.sqrt(Math.max(0, 1 - s * s - (x / R.X) ** 2));
}
/**
 * A point carried from a resident's head (HEAD) onto his, keeping its place: as far round, as high
 * on its head's own scale and as far out (1 on the surface), so what was drawn on HEAD (his hair, his
 * ears, his nose, his features' middles) lies on his head as it lay on HEAD. offFilip carries it back.
 */
function onFilip([x, y, z]: V3): V3 {
  const [a, b, c] = HEAD.r,
    s = (y - HEAD.y) / b,
    R = headRing(s);
  return [(x / a) * R.X, R.y, R.mid + ((z - 0.005) / c) * R.Z];
}
function offFilip([x, y, z]: V3): V3 {
  const [a, b, c] = HEAD.r,
    s = headS(y),
    R = headRing(s);
  return [(x / R.X) * a, HEAD.y + s * b, 0.005 + ((z - R.mid) / R.Z) * c];
}
/**
 * A normal carried with its point (q, already carried) by onFilip: the gradient there of the
 * normal's plane carried back (offFilip's inverse transpose), so a carried surface shades as its own.
 */
function carriedNormal(q: V3, n: T.Vector3) {
  const e = 1e-5,
    f = (x: number, y: number, z: number) => {
      const p = offFilip([x, y, z]);
      return p[0] * n.x + p[1] * n.y + p[2] * n.z;
    };
  return new T.Vector3(f(q[0] + e, q[1], q[2]) - f(q[0] - e, q[1], q[2]), f(q[0], q[1] + e, q[2]) - f(q[0], q[1] - e, q[2]), f(q[0], q[1], q[2] + e) - f(q[0], q[1], q[2] - e)).normalize();
}
/** His head's outward normal at p on it (its reach's gradient). */
function headNormal(p: T.Vector3) {
  const e = 1e-5,
    f = (x: number, y: number, z: number) => filipHeadReach(x, y, z) ** 2;
  return new T.Vector3(f(p.x + e, p.y, p.z) - f(p.x - e, p.y, p.z), f(p.x, p.y + e, p.z) - f(p.x, p.y - e, p.z), f(p.x, p.y, p.z + e) - f(p.x, p.y, p.z - e)).normalize();
}
/**
 * A feature (EYES, BROWS) carried onto his head: its middle carried by onFilip (its middle row's
 * height and its middle's x there), its rows and half-widths kept about it.
 */
function carried(F: { rows: number[]; x: number[]; half: number[] }) {
  const y = (F.rows[0] + F.rows[F.rows.length - 1]) / 2,
    x = F.x.reduce((n, v) => n + v, 0) / F.x.length,
    [cx, cy] = onFilip([x, y, 0.005 + HEAD.r[2] * Math.sqrt(Math.max(0, 1 - (x / HEAD.r[0]) ** 2 - ((y - HEAD.y) / HEAD.r[1]) ** 2))]);
  return { rows: F.rows.map((r) => r - y + cy), x: F.x.map((v) => v - x + cx), half: F.half };
}
const FACE_EYES = carried(EYES),
  FACE_BROWS = carried(BROWS);
/**
 * Where things are on his face, in his own frame (his root unscaled): each eye's middle on his face,
 * each ear's middle, the nose's middle; the crown (his skull's top, under the hair); his mouth, where
 * a mouth would be (none is drawn: on his face's midline, half way from the nose's underside down to
 * where his chin meets his shoulders); and that height (`chin`). For the poses that bring something
 * to his face (the phone to his ear, the cup to his mouth).
 */
export const FILIP_FACE = (() => {
  const eyeY = (FACE_EYES.rows[0] + FACE_EYES.rows[FACE_EYES.rows.length - 1]) / 2,
    eyeX = FACE_EYES.x.reduce((n, v) => n + v, 0) / FACE_EYES.x.length,
    nose = onFilip([0, NOSE.y, 0.005 + HEAD.r[2] * Math.sqrt(1 - ((NOSE.y - HEAD.y) / HEAD.r[1]) ** 2) - 0.006]),
    ear = onFilip(EAR.at);
  // Where his chin goes under his shoulders: down his face's midline to where it meets the torso's front.
  let chin = nose[1];
  while (chin > 0.55 && headFront(0, chin - 0.0005) > torsoAt(chin - 0.0005) * DEPTH) chin -= 0.0005;
  const mouthY = (nose[1] - NOSE.r[1] + chin) / 2;
  return {
    eyes: [-1, 1].map((s) => [s * eyeX, eyeY, headFront(s * eyeX, eyeY)]) as [V3, V3],
    ears: [-1, 1].map((s) => [s * ear[0], ear[1], ear[2]]) as [V3, V3],
    nose,
    mouth: [0, mouthY, headFront(0, mouthY)] as V3,
    crown: FILIP_HEAD.y + FILIP_HEAD.up,
    chin,
  };
})();
/**
 * His head (FILIP_HEAD) as a lat-long surface, 16 round by 10 up as a resident's and three rings
 * more down the jaw (where it narrows, so its outline stays round), with his eyes and brows drawn on
 * it as cells whose edges are the triangles' own: each eye a small dark rounded oval (EYES), each
 * brow a short soft bar in a deeper brown than his hair (BROWS).
 */
function headGeometry() {
  // Each ring by its place on the head's own scale (s): ten even steps of latitude, half steps down
  // the jaw (9, 27 and 45 degrees below the widest ring), and the features' rows.
  const steps = [
      ...Array.from({ length: 11 }, (_, k) => (k === 0 ? -1 : k === 10 ? 1 : Math.sin(-Math.PI / 2 + (Math.PI * k) / 10))),
      ...[9, 27, 45].map((d) => -Math.sin((d * Math.PI) / 180)),
      ...[...FACE_EYES.rows, ...FACE_BROWS.rows].map(headS),
    ].sort((p, q) => p - q),
    rings: Ring[] = steps.map((s) => {
      const R = headRing(s),
        q = Math.sqrt(Math.max(0, 1 - s * s)),
        y = R.y;
      if (q < 1e-9) return { cols: [{ a: 0 }], at: () => ({ p: new T.Vector3(0, y, R.mid), n: new T.Vector3(0, Math.sign(s), 0) }) };
      const tags: Column[] = [];
      for (const [F, edge] of [[FACE_EYES, 'AB'], [FACE_BROWS, 'CD']] as const) {
        const row = F.rows.findIndex((e) => Math.abs(e - y) < 1e-9);
        if (row >= 0)
          for (const [side, name] of [[-1, 'r'], [1, 'l']] as const) {
            const mid = side * F.x[row],
              half = F.half[row];
            tags.push({ a: Math.asin((mid - half) / (R.X * q)), tag: name + edge[0] }, { a: Math.asin((mid + half) / (R.X * q)), tag: name + edge[1] });
          }
      }
      return {
        cols: columns(16, tags, 0.03),
        at: (t: number) => {
          const p = new T.Vector3(R.X * q * Math.sin(t), y, R.mid + R.Z * q * Math.cos(t));
          return { p, n: headNormal(p) };
        },
      };
    });
  return ringMesh(rings, (_, cell) => (cell === 'rA|rB' || cell === 'lA|lB' ? FILIP_LOOK.eyes : cell === 'rC|rD' || cell === 'lC|lD' ? FILIP_LOOK.brows : FILIP_LOOK.skin));
}
/** Whether a point is hidden inside his head or his torso (a little under their surfaces). */
function insideBody(x: number, y: number, z: number) {
  if (filipHeadReach(x, y, z) < 0.94) return true;
  const r = torsoAt(y);
  return r > 0 && Math.hypot(x / r, z / (r * DEPTH)) < 0.9;
}
/** An un-indexed geometry (positions, normals and colours) without the triangles whose three corners are all `hidden`. */
function shownOnly(geometry: T.BufferGeometry, hidden: (x: number, y: number, z: number) => boolean) {
  const keep: number[] = [],
    p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i += 3) if (![0, 1, 2].every((k) => hidden(p.getX(i + k), p.getY(i + k), p.getZ(i + k)))) keep.push(i, i + 1, i + 2);
  const g = new T.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const from = geometry.getAttribute(name),
      out = new Float32Array(keep.length * 3);
    keep.forEach((i, k) => out.set([from.getX(i), from.getY(i), from.getZ(i)], k * 3));
    g.setAttribute(name, new T.BufferAttribute(out, 3));
  }
  return g;
}
/**
 * The triangles of an indexed geometry that are not wholly `hidden`, un-indexed, with colours on
 * their vertices from `colour` (sRGB, from each vertex's position and normal), every vertex and its
 * normal first carried by `carry` (the colour taken where it was, `hidden` asked where it goes).
 */
function kept(geometry: T.BufferGeometry, hidden: (x: number, y: number, z: number) => boolean, colour: (p: T.Vector3, n: T.Vector3) => V3, carry?: (p: T.Vector3, n: T.Vector3) => void) {
  const p = geometry.getAttribute('position').clone(),
    nrm = geometry.getAttribute('normal').clone(),
    index = geometry.index!,
    gone = new Uint8Array(p.count),
    rgb = new Float32Array(p.count * 3),
    v = new T.Vector3(),
    n = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    const [r, g, b] = colour(v.fromBufferAttribute(p, i), n.fromBufferAttribute(nrm, i));
    srgb.setRGB(r, g, b, T.SRGBColorSpace).toArray(rgb, i * 3);
    if (carry) {
      carry(v, n);
      p.setXYZ(i, v.x, v.y, v.z);
      nrm.setXYZ(i, n.x, n.y, n.z);
    }
    gone[i] = hidden(p.getX(i), p.getY(i), p.getZ(i)) ? 1 : 0;
  }
  const pos: number[] = [],
    nor: number[] = [],
    col: number[] = [];
  for (let k = 0; k < index.count; k += 3) {
    const tri = [index.getX(k), index.getX(k + 1), index.getX(k + 2)];
    if (tri.every((i) => gone[i])) continue;
    for (const i of tri) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      col.push(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  return g;
}
/**
 * The hairline round his head (on a resident's head, HEAD, as the hair is sculpted; see hair()): its
 * height at each azimuth (0 straight ahead, + round to his left, +x), as [azimuth, height] for one
 * side, mirrored, but over the forehead, where the side parting lifts it on his left and the swept
 * fringe lowers it on his right. Close over the ears, down to the nape behind, where it is drawn a
 * little higher (0.699) than it ends, so that carried onto his longer head it ends about 0.69 up,
 * as it did on HEAD, and his nape still shows; the sideburns are added on their own.
 */
const HAIRLINE: [number, number][] = [
  [-Math.PI, 0.699],
  [-2.4, 0.711],
  [-2.0, 0.76],
  [-1.75, 0.795],
  [-1.38, 0.8],
  [-1.15, 0.818],
  [-0.85, 0.834],
  [-0.42, 0.838],
  [0, 0.846],
  [0.42, 0.858],
  [0.85, 0.838],
  [1.15, 0.818],
  [1.38, 0.8],
  [1.75, 0.795],
  [2.0, 0.76],
  [2.4, 0.711],
  [Math.PI, 0.699],
];
/** The hairline's height and its slope (per radian) at azimuth `t`: a smooth curve through HAIRLINE, round the head. */
function hairline(t: number): [number, number] {
  const H = HAIRLINE,
    n = H.length - 1,
    // The k-th point round and round the head (H[n] is H[0] a turn on).
    point = (k: number) => {
      const q = H[((k % n) + n) % n];
      return [q[0] + TAU * Math.floor(k / n), q[1]];
    },
    a = wrap(t),
    i = Math.max(0, H.findIndex((q, k) => k < n && a >= q[0] && a <= H[k + 1][0])),
    [t0, h0] = point(i),
    [t1, h1] = point(i + 1),
    // Catmull-Rom slopes, round the seam at the back.
    prev = point(i - 1),
    next = point(i + 2),
    m0 = (h1 - prev[1]) / (t1 - prev[0]),
    m1 = (next[1] - h0) / (next[0] - t0),
    d = t1 - t0,
    s = (a - t0) / d,
    h = (2 * s ** 3 - 3 * s ** 2 + 1) * h0 + (s ** 3 - 2 * s ** 2 + s) * d * m0 + (-2 * s ** 3 + 3 * s ** 2) * h1 + (s ** 3 - s ** 2) * d * m1,
    dh = ((6 * s ** 2 - 6 * s) * h0 + (3 * s ** 2 - 4 * s + 1) * d * m0 + (-6 * s ** 2 + 6 * s) * h1 + (3 * s ** 2 - 2 * s) * d * m1) / d;
  return [h, dh];
}
/** Everything under the hairline, as a solid for the hair to be cut by (its distance a close bound). */
const underHairline: Shape = {
  d(x, y, z) {
    const rho = Math.max(0.05, Math.hypot(x, z - 0.005)),
      [h, dh] = hairline(Math.atan2(x, z - 0.005));
    return (y - h) / Math.hypot(1, dh / rho);
  },
  min: [-0.3, 0.4, -0.3],
  max: [0.3, 0.92, 0.3],
};
/** A rotation (Euler XYZ) that turns x onto `x` and y onto `y` (made square to it). */
function turnTo(x: V3, y: V3): V3 {
  const X = new T.Vector3(...x).normalize(),
    Y = new T.Vector3(...y),
    Z = new T.Vector3().crossVectors(X, Y).normalize();
  Y.crossVectors(Z, X);
  const e = new T.Euler().setFromRotationMatrix(new T.Matrix4().makeBasis(X, Y, Z));
  return [e.x, e.y, e.z];
}
/**
 * His hair, short and side-swept, as one smooth sculpted cap on a distance grid (town-sculpt), every
 * normal the exact field's, so nothing is faceted:
 * - a close crop over the skull, about 0.02 off it at the sides and back and 0.03 over the crown,
 *   fading in to 0.01 where it ends at the nape;
 * - over the top, the swept mass: fullest just right of the parting and falling away over his right
 *   temple, with a soft lift over the front of his forehead;
 * - cut away under the hairline (HAIRLINE), so the forehead, temples and ears are clear and the
 *   crop's thickness steps in over the ears and at the nape; short sideburns in front of the ears;
 * - the parting, a soft crease on his left, and three broad, shallow comb grooves that follow the
 *   sweep from the parting across to his right.
 * It is sculpted on a resident's head (HEAD), which its numbers here (and HAIRLINE's) are drawn to,
 * then carried onto his own by onFilip, every vertex and its normal: so the crop keeps its thickness
 * over his longer, narrower head, and the parting, the fringe, the grooves, the sideburns and the
 * nape lie on it where they lay on HEAD, clear of his ears (carried the same way). Whatever his head
 * or the torso hides is left out. Its brown keeps one saturation in every shade: a step lighter on
 * what faces up, deeper on what faces down, towards the nape and in the creases (all taken before
 * the carry). Returns the cap and `covers`: whether a point (on his head) lies under the hair.
 */
function hair() {
  const s = sculpt([-0.205, 0.62, -0.215], [0.205, 0.985, 0.205], HAIR_GRID);
  // The crop: its middle above the skull's, so it is fuller over the crown and fades in close
  // towards the nape (about 0.01 off the skull where it ends there, 0.023 at the back of the head).
  s.add(ellipsoid([0, 0.772, 0], [0.165, 0.157, 0.158]));
  // The swept mass: its high end at the parting, falling to his right and a little back.
  s.add(ellipsoid([-0.042, 0.856, 0.03], [0.118, 0.07, 0.122], turnTo([1, 0.2, 0.12], [-0.2, 1, 0])), 0.05);
  // The lift over the front of the forehead, its front edge running from the parting down to his
  // right temple.
  s.add(ellipsoid([-0.012, 0.866, 0.085], [0.1, 0.046, 0.05], turnTo([1, 0.16, 0.18], [0, 1, -0.45])), 0.045);
  s.cut(underHairline, 0.012);
  // Sideburns: short and close, in front of each ear, down to its upper half.
  for (const side of [-1, 1]) s.add(strand([[side * 0.146, 0.806, 0.04], [side * 0.147, 0.782, 0.043], [side * 0.146, 0.764, 0.044]], [0.0125, 0.0115, 0.01]), 0.01);
  // The surface over a point of the top (stepping down from above to the first point inside the
  // hair, then halving), and its normal.
  const surface = (x: number, z: number) => {
    let hi = 0.99,
      lo = hi;
    while (lo > 0.6 && s.exact(x, lo, z) >= 0) {
      hi = lo;
      lo -= 0.004;
    }
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (s.exact(x, mid, z) < 0) lo = mid;
      else hi = mid;
    }
    const y = (lo + hi) / 2,
      e = 0.002,
      n = new T.Vector3(s.exact(x + e, y, z) - s.exact(x - e, y, z), s.exact(x, y + e, z) - s.exact(x, y - e, z), s.exact(x, y, z + e) - s.exact(x, y, z - e)).normalize();
    return { p: new T.Vector3(x, y, z), n };
  };
  // A groove along a line over the top ([x, z] points), `depth` deep, its round section `radius`.
  const groove = (line: [number, number][], radius: number, depth: number, k: number) => {
    const axis = line.map(([x, z]) => {
      const { p, n } = surface(x, z);
      return p.addScaledVector(n, radius - depth).toArray() as V3;
    });
    s.cut(strand(axis, axis.map(() => radius)), k);
  };
  // The comb grooves first (each from near the parting across to his right and a little back), then the parting.
  for (const z of [0.088, 0.028, -0.034]) groove([[0.04, z], [-0.02, z - 0.008], [-0.08, z - 0.022], [-0.13, z - 0.045]], 0.021, 0.0085, 0.012);
  groove([[0.066, 0.128], [0.068, 0.07], [0.07, 0.01], [0.068, -0.05]], 0.0125, 0.0105, 0.008);
  const [hue, sat, value] = toHsv(FILIP_LOOK.hair),
    brown = (p: T.Vector3, n: T.Vector3): V3 => {
      // How far the field opens out along the normal (a distance-field occlusion): the parting, the
      // grooves and the cap's underside come out deeper.
      let shut = 0;
      for (const [d, w] of [[0.008, 0.5], [0.018, 0.35], [0.034, 0.2]]) shut += (w * Math.max(0, d - s.exact(p.x + n.x * d, p.y + n.y * d, p.z + n.z * d))) / d;
      const up = smooth(n.y, 0.2, 0.9),
        down = smooth(-n.y, 0.1, 0.8),
        k = T.MathUtils.lerp(0.9, 1, smooth(p.y, 0.7, 0.86)) * (1 + 0.1 * up - 0.1 * down) * (1 - 0.34 * Math.min(1, shut));
      return hsv(hue + 2 * up, sat, value * k);
    };
  return {
    cap: kept(s.mesh(), insideBody, brown, (p, n) => {
      const q = onFilip([p.x, p.y, p.z]);
      n.copy(carriedNormal(q, n));
      p.set(...q);
    }),
    covers: (x: number, y: number, z: number) => s.exact(...offFilip([x, y, z])) < -0.004,
  };
}

/* ------------------------------------------------------------------ */
/* His hand props                                                      */
/* ------------------------------------------------------------------ */
/** His hand props, each a group of its own in his root (one mesh each, batched part by part), hidden until a pose shows one. */
export type FilipProps = { phone: T.Group; cup: T.Group; saucer: T.Group };
/** A cushion: a sphere pushed out towards its box (a slab with soft corners and edges), r its half-sizes, at c. */
function cushion(r: V3, c: V3) {
  const g = new T.SphereGeometry(1, 10, 8),
    p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const v = [p.getX(i), p.getY(i), p.getZ(i)].map((u) => Math.sign(u) * Math.abs(u) ** 0.45);
    p.setXYZ(i, v[0], v[1], v[2]);
  }
  g.computeVertexNormals();
  g.scale(...r);
  return g.translate(...c);
}
/**
 * His hand props (each one's origin is where it is held, its pieces all 0.07 or more across):
 * - the phone: a chunky graphite slab 0.075 by 0.12 by 0.07, its screen (a shade darker) on its +z
 *   face, no logo; its origin its middle;
 * - the coffee cup and its saucer: Alison's china shapes (the cup's origin its handle, its axis
 *   CUP_AXIS along +x; the saucer's its foot), plain white with a warm grey band, coffee in the cup.
 */
export function filipProps(material: Material): FilipProps {
  const L = FILIP_LOOK,
    phone = new T.Group(),
    cup = new T.Group(),
    saucer = new T.Group();
  phone.name = 'phone';
  cup.name = 'coffee-cup';
  saucer.name = 'saucer';
  // (Its sides' widest points fall between the sphere's columns: 0.0362 deep a side keeps it 0.07 through.)
  part(phone, [paint(cushion([0.0375, 0.06, 0.0362], [0, 0, 0]), (p) => (p.z > 0.034 && Math.abs(p.x) < 0.03 && Math.abs(p.y) < 0.05 ? shade(L.phone, 0.82) : L.phone))], material, 'paint', 'phone');
  const ring = (p: T.Vector3) => Math.hypot(p.x - CUP_AXIS, p.z);
  part(cup, [
    paint(lathe([[0, -0.037], [0.034, -0.037], [0.049, 0.014], [0.052, 0.037], [0.046, 0.039], [0.041, 0.024], [0, 0.024]], 9).translate(CUP_AXIS, 0, 0), (p) =>
      p.y < 0.0245 && p.y > 0.02 && ring(p) < 0.0415 ? L.coffee : p.y > 0.024 && ring(p) > 0.0485 ? L.chinaBand : L.china,
    ),
    paint(blob([0.037, 0.037, 0.037], [0, 0, 0], 8), L.china),
  ], material, 'paint', 'coffee-cup');
  part(saucer, [
    paint(lathe([[0, 0], [0.04, 0], [0.06, 0.03], [0.075, 0.064], [0.071, 0.07], [0.056, 0.044], [0.044, 0.036], [0, 0.036]], 9), (p) =>
      p.y > 0.055 && Math.hypot(p.x, p.z) > 0.066 ? L.chinaBand : L.china,
    ),
  ], material, 'paint', 'saucer');
  for (const g of [phone, cup, saucer]) g.visible = false;
  return { phone, cup, saucer };
}

/* ------------------------------------------------------------------ */
/* His figure                                                          */
/* ------------------------------------------------------------------ */
/**
 * What a station needs to know of him (units of the island, his root scaled FILIP_SCALE):
 * - `scale`: his root's scale all over; every number of Alison's rig (her lift, her hand points, her
 *   stride, her seat) is in his root's frame, so it is this much larger on the island;
 * - `height`: standing, to the top of his hair (0.948 in his own frame: his longer head carries it
 *   0.009 higher than on a resident's head);
 * - `stride`: how far one 'walk' phase (two steps, the residents' gait) carries him.
 */
export const FILIP = { scale: FILIP_SCALE, height: 0.948 * FILIP_SCALE, stride: ((Math.PI * 2) / 17) * FILIP_SCALE };
/** His joints: exactly Alison's (sky-figure's AlisonJoints). */
export type FilipJoints = AlisonJoints;

/**
 * Filip Biljecki's figure, his root scaled FILIP_SCALE: inside it, exactly Alison's body and rig
 * (a resident's 0.9-tall body standing with its soles on y 0 and facing +z; the 'body', 'leg-left'
 * and 'leg-right' with a 'knee' each, 'arm-left' and 'arm-right' with an 'elbow' each, at her
 * pivots, in her order, so animateResident walks him and poseAlison's maths pose him) in his own
 * look. Each part is one mesh per surface kind, as hers: batched part by part he is 10 meshes, and
 * each prop one more. Returns `{ root, joints, props }`, as createAlison does, standing at ease.
 */
export function createFilip(material: Material) {
  const L = FILIP_LOOK,
    root = new T.Group(),
    body = new T.Group();
  root.name = 'filip';
  root.scale.setScalar(FILIP_SCALE);
  body.name = 'body';
  root.add(body);
  // The shirt: the torso (its open V, placket and the chinos at the waist), the belt and the collar;
  // then the hair (on its own, as Alison's is).
  part(body, [torsoGeometry(), beltGeometry(), ...collarGeometry()], material, 'fabric');
  const locks = hair();
  part(body, [locks.cap], material, 'fabric', 'filip-hair');
  // Skin: his head with his eyes and brows drawn on it (less what the hair covers), the neck (hidden
  // between his head and his shoulders), a resident's small nose and two low ears, the nose and the
  // ears where they sit on a resident's head, carried onto his (FILIP_FACE).
  const F = FILIP_FACE;
  part(body, [
    shownOnly(headGeometry(), locks.covers),
    paint(lathe([[0, 0.585], [0.05, 0.585], [0.05, 0.66], [0, 0.66]], 8), shade(L.skin, 0.96)),
    paint(blob(NOSE.r, F.nose, 8), shade(L.skin, 0.97)),
    // (Each ear whole, most of it sunk in the head: only a low bump of it shows, and it is 0.07 or
    // more across every way.)
    ...F.ears.map((ear) => paint(blob(EAR.r, ear, 8), shade(L.skin, 0.95))),
  ], material, 'paint');
  const legs: T.Object3D[] = [],
    knees: T.Object3D[] = [],
    arms: T.Object3D[] = [],
    elbows: T.Object3D[] = [];
  for (const side of [-1, 1]) {
    // The legs: Alison's, in navy chinos over brown shoes.
    const hip = new T.Group();
    hip.name = side < 0 ? 'leg-left' : 'leg-right';
    hip.position.set(side * 0.065, HIP, 0);
    root.add(hip);
    part(hip, [paint(lathe([[0, 0.03], [0.05, 0.025], [THIGH_R, 0.0], [0.06, -0.07], [0.055, -0.14], [0.03, -0.165], [0, -0.17]], 10), L.trousers, [-0.17, 0.02, 0.92, 1.02])], material, 'fabric');
    const knee = new T.Group();
    knee.name = 'knee';
    knee.position.y = -0.14;
    hip.add(knee);
    const shoe = blob([0.058, 0.044, 0.09], [0, 0, 0], 10),
      sp = shoe.getAttribute('position');
    for (let i = 0; i < sp.count; i++) if (sp.getY(i) < 0) sp.setY(i, sp.getY(i) * 0.8); // a flatter sole
    shoe.computeVertexNormals();
    shoe.translate(0, -0.135, 0.025);
    part(knee, [
      paint(lathe([[0, 0.02], [0.055, 0.01], [0.052, -0.07], [0.053, -0.094], [0.04, -0.106], [0, -0.108]], 10), L.trousers, [-0.1, 0.02, 0.84, 0.94]),
      paint(shoe, (p) => (p.y < -0.157 ? shade(L.shoes, 1.3) : L.shoes)),
    ], material, 'fabric', 'shoe');
    // The arms: Alison's, split at the elbow, in the white shirt with its sleeves rolled to the
    // elbow: the rolled cuff a chunky white band round it, standing proud of the sleeve, then the
    // bare forearm and the mitten hand.
    const arm = new T.Group();
    arm.name = side < 0 ? 'arm-left' : 'arm-right';
    arm.position.set(side * SHOULDER.x, SHOULDER.y, 0);
    arm.rotation.z = side * 0.12;
    root.add(arm);
    // (White shows a lathe's facets where Alison's black did not: a few more sides round, and the
    // shoulder's cap rounded over, where hers is nearly flat on top and read boxy in white.)
    part(arm, [paint(lathe([[0, 0.047], [0.026, 0.043], [0.044, 0.03], [0.053, 0.013], [0.055, 0.0], [0.051, -0.05], [0.048, -UPPER], [0.034, -0.129], [0, -0.143]], 12), L.shirt, [-0.14, 0.03, 0.93, 1.0])], material, 'fabric');
    const elbow = new T.Group();
    elbow.name = 'elbow';
    elbow.position.y = -UPPER;
    arm.add(elbow);
    part(elbow, [
      paint(lathe([[0, 0.052], [0.04, 0.04], [0.054, 0.024], [0.0555, -0.017], [0.051, -0.031], [0.0415, -0.036], [0.038, -0.07], [0.028, -0.086], [0, -0.092]], 12), (p) =>
        p.y > -0.0335 ? (Math.hypot(p.x, p.z) > 0.053 ? L.shirt : shade(L.shirt, 0.93)) : shade(L.skin, 0.97),
      ),
      paint(blob([0.043, 0.05, 0.046], [0, -FORE, 0], 8), L.skin),
    ], material, 'fabric');
    legs.push(hip);
    knees.push(knee);
    arms.push(arm);
    elbows.push(elbow);
  }
  const props = filipProps(material);
  root.add(props.phone, props.cup, props.saucer);
  root.userData.gait = { phase: 0, amount: 0 };
  root.userData.sole = 0;
  root.userData.lift = 0;
  const joints: FilipJoints = {
    root,
    body,
    legs: legs as [T.Object3D, T.Object3D],
    knees: knees as [T.Object3D, T.Object3D],
    arms: arms as [T.Object3D, T.Object3D],
    elbows: elbows as [T.Object3D, T.Object3D],
  };
  // At ease, as Alison's 'stand' at 0 leaves her: upright, legs straight, arms down and a little
  // out, elbows soft.
  elbows.forEach((e) => e.rotation.set(-0.12, 0, 0));
  return { root, joints, props };
}
