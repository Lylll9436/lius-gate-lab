import * as T from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SurfaceKind } from './city-materials';
import * as plan from './town-plan';
import type { Season } from './glasgow-sun';
import { palette, hash, sstep, mix, type TownContext } from './town-shared';
import type { Kit } from './town-kit';

/* ------------------------------------------------------------------ */
/* Planting kit: baked two-tone ramps for trees, hedges and beds       */
/* ------------------------------------------------------------------ */

/** Tree looks: body tones, a warm lime crown and a cool dark underside. */
const TREE = {
  round:   { tones: [palette.canopy[0], palette.canopy[1]], top: '#d2dc58', under: '#3c6a2e' },
  autumn:  { tones: [palette.autumn[0], palette.autumn[1]], top: '#f2c862', under: '#99582a' },
  blossom: { tones: [palette.blossom[0], palette.blossom[1]], top: '#fdd9e3', under: '#bf7590' },
  pine:    { tones: [palette.pine[0], palette.pine[1]], top: '#74b155', under: '#22503a' },
  winter:  { tones: ['#6a8f45', '#78994c'], top: '#aab87e', under: '#2f5238' },
  trunk: palette.bark, pineTrunk: palette.pineBark,
};
/**
 * Silver birch: a light yellow-green crown that turns butter yellow in autumn and, like the other
 * broadleaves, keeps a muted green in winter (paler here, and one clump sparser).
 */
const BIRCH: Record<Season, { tones: string[]; top: string; under: string }> = {
  spring: { tones: ['#a6c65a', '#afcb62'], top: '#e0e892', under: '#62893e' },
  summer: { tones: ['#9cbb4c', '#a5c255'], top: '#d9e183', under: '#58803a' },
  autumn: { tones: ['#cab034', '#d0b73e'], top: '#e6cd5c', under: '#8c7424' },
  winter: { tones: ['#809a58', '#88a05e'], top: '#bac392', under: '#4a6640' },
};
/** Birch bark: cream-white, a few dark marks and a dark, rough foot. */
const BIRCH_BARK = { body: '#e2dbcc', foot: '#5d5750', mark: '#55504a' };
/** Rowan: a deep, slightly cool green that turns orange in autumn, under its crimson berries. */
const ROWAN: Record<Season, { tones: string[]; top: string; under: string }> = {
  spring: { tones: ['#4e9052', '#559556'], top: '#a2c47a', under: '#285a38' },
  summer: { tones: ['#468a4c', '#4e9052'], top: '#9cc27a', under: '#245536' },
  autumn: { tones: ['#c46a34', '#cc7438'], top: '#e2945a', under: '#7c3624' },
  winter: { tones: ['#5a8250', '#618756'], top: '#a0b38a', under: '#2b4b38' },
};
const ROWAN_BARK = '#7b6f63';
export type TreeFruit = { kind: 'flowers' | 'berries'; colour: string; clusters: number };
/**
 * What a rowan carries: creamy flat flower heads in spring, a few ripening orange berry clusters
 * in (late) summer, full crimson clusters in autumn and nothing in winter. Other trees carry none.
 * The colours stay inside their palette families (white, the flower red); the berries are the
 * small accent that may be the most saturated thing in frame.
 */
export function treeFruit(spec: plan.TreeSpec, season: Season): TreeFruit | null {
  if (spec.kind !== 'rowan') return null;
  if (season === 'spring') return { kind: 'flowers', colour: palette.white, clusters: 7 };
  if (season === 'summer') return { kind: 'berries', colour: '#cc6a3e', clusters: 4 };
  if (season === 'autumn') return { kind: 'berries', colour: '#ad2f3a', clusters: 5 };
  return null;
}
/**
 * The season on the round trees. The accent trees (the plan's 'autumn' kind and every 23rd
 * round tree) blossom in spring and turn in autumn; in summer every canopy is green, and in
 * winter a muted, darker green. Birches and rowans wear their own looks (BIRCH, ROWAN).
 */
export function treeLook(spec: plan.TreeSpec, index: number, season: Season) {
  if (spec.kind === 'birch') return BIRCH[season];
  if (spec.kind === 'rowan') return ROWAN[season];
  const accent = spec.kind === 'autumn' || (index * 7) % 23 === 0;
  if (season === 'winter') return TREE.winter;
  if (!accent || season === 'summer') return TREE.round;
  return season === 'spring' ? TREE.blossom : TREE.autumn;
}
/** Bake colour × value(y) into vertex colours, e.g. a trunk that darkens up into its canopy. */
export function paintByHeight(geo: T.BufferGeometry, colour: string, value: (y: number) => number) {
  const p = geo.getAttribute('position'), c = new T.Color(colour), out = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const f = value(p.getY(i)); out[i*3] = c.r*f; out[i*3+1] = c.g*f; out[i*3+2] = c.b*f; }
  geo.setAttribute('color', new T.BufferAttribute(out, 3));
  return geo;
}
/* ------------------------------------------------------------------ */
/* Leafy clumps: the broadleaves' cauliflower crowns                   */
/* ------------------------------------------------------------------ */
/**
 * A clump of leaves in tree space: centre, radius, vertical squash `sy`, icosphere `detail`, and
 * its leafy lumps (`florets` soft domes `amp` × r proud of the valleys between them). `droop`
 * hangs the lower half longer and narrower (birch); `sag` lets a flattened spray's rim hang
 * down (rowan). Detail 3 for the big clumps keeps their outline round at zoom 6 (about 9° a
 * segment); the small ones get detail 2.
 */
export type Clump = {
  x: number; y: number; z: number; r: number; seed: number;
  sy?: number; detail?: number; florets?: number; amp?: number; droop?: number; sag?: number;
  /** A frond: drawn out `long` times along the bearing `heading` (rowan sprays reach outward). */
  long?: number; heading?: number;
  /**
   * A weeping hem: below the clump's middle each floret hangs down by up to `weep` × r, further
   * the lower it sits, while the valleys between them stay, so the hem parts into hanging tassels
   * (the birch's pendulous twigs).
   */
  weep?: number;
  /** Lay the clump on a slope: its own up (the axis `sy` squashes and `sag` hangs along) turned to this unit vector. */
  up?: T.Vector3;
};
/** Unit icospheres, indexed so the displaced vertices stay shared and the clumps shade smooth. */
const balls = new Map<number, T.BufferGeometry>();
function unitBall(detail: number) {
  let g = balls.get(detail);
  if (!g) {
    const ico = new T.IcosahedronGeometry(1, detail);
    ico.deleteAttribute('normal');
    ico.deleteAttribute('uv');
    g = mergeVertices(ico);
    ico.dispose();
    balls.set(detail, g);
  }
  return g;
}
/** Smooth 3D value noise in 0..1, for the clumps' gentle unevenness. */
function noise3(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z),
    u = sstep(x - ix, 0, 1), v = sstep(y - iy, 0, 1), w = sstep(z - iz, 0, 1),
    L = (i: number, j: number, k: number) => hash(i * 157.31 + j * 113.97 + k * 271.3);
  return mix(
    mix(mix(L(ix, iy, iz), L(ix + 1, iy, iz), u), mix(L(ix, iy + 1, iz), L(ix + 1, iy + 1, iz), u), v),
    mix(mix(L(ix, iy, iz + 1), L(ix + 1, iy, iz + 1), u), mix(L(ix, iy + 1, iz + 1), L(ix + 1, iy + 1, iz + 1), u), v),
    w,
  );
}
type BuiltClump = { geo: T.BufferGeometry; lump: Float32Array; clump: Clump };
/**
 * One clump: an icosphere pushed out into `florets` soft domes (evenly spread on a seeded
 * sunflower spiral, joined by a soft maximum so shallow valleys part them, like the florets of a
 * cauliflower) with a little low-frequency unevenness on top. `lump` keeps each vertex's floret
 * height (0 in a valley, about 1 on a crown) for the paint.
 */
function clumpGeometry(c: Clump): BuiltClump {
  const sy = c.sy ?? 0.85, amp = c.amp ?? 0.1, K = c.florets ?? 9, droop = c.droop ?? 0, sag = c.sag ?? 0,
    geo = unitBall(c.detail ?? 2).clone(),
    p = geo.getAttribute('position'),
    lump = new Float32Array(p.count),
    h = (n: number) => hash(c.seed * 13.7 + n),
    spin = new T.Quaternion().setFromEuler(new T.Euler(h(1) * 6.283, h(2) * 6.283, h(3) * 6.283)),
    tilt = c.up ? new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), c.up) : null,
    turned = new T.Vector3(),
    dirs: T.Vector3[] = [];
  for (let k = 0; k < K; k++) {
    const y = 1 - (2 * (k + 0.5)) / K, ring = Math.sqrt(1 - y * y), a = k * 2.39996 + (h(k + 4) - 0.5) * 0.6;
    dirs.push(new T.Vector3(Math.cos(a) * ring, y, Math.sin(a) * ring).applyQuaternion(spin));
  }
  // A floret's reach: a little more than half the spacing, so neighbours meet in shallow valleys.
  const reach = Math.cos(Math.min(1.5, 1.2 * Math.sqrt(4 / K))), span = 1 - reach, P = p.array as Float32Array;
  for (let i = 0; i < p.count; i++) {
    const ux = P[i * 3], uy = P[i * 3 + 1], uz = P[i * 3 + 2];
    let sum = 0;
    for (const d of dirs) {
      const t = Math.min(1, (ux * d.x + uy * d.y + uz * d.z - reach) / span);
      if (t > 0) {
        const e = t * t * (3 - 2 * t);
        sum += e * e * e;
      }
    }
    const l = Math.min(1.15, Math.cbrt(sum)),
      even = noise3(ux * 1.7 + c.seed, uy * 1.7 + c.seed * 0.37, uz * 1.7 - c.seed * 0.71) - 0.5,
      r = c.r * (1 + amp * (l - 0.7) + amp * 0.6 * even);
    lump[i] = l;
    let x = ux * r, y = uy * r, z = uz * r;
    if (droop && y < 0) {
      const t = -y / c.r, taper = 1 - 0.16 * t * droop;
      x *= taper; z *= taper; y *= 1 + 0.28 * droop;
    }
    if (c.weep && uy < 0.15) y -= c.weep * c.r * (0.15 - uy) * Math.min(1, l) ** 2;
    if (c.long) {
      // Out along the heading, the tip hanging lowest (the sag below reads the stretched spray as one).
      const ch = Math.cos(c.heading ?? 0), sh = Math.sin(c.heading ?? 0), along = (x * ch + z * sh) * c.long, across = -x * sh + z * ch;
      if (sag) y -= sag * c.r * ((along / c.long) ** 2 + across * across) / (c.r * c.r) + sag * 0.6 * Math.max(0, along) / c.long;
      x = along * ch - across * sh;
      z = along * sh + across * ch;
    } else if (sag) y -= sag * c.r * ((x * x + z * z) / (c.r * c.r));
    if (tilt) {
      const v = turned.set(x, y * sy, z).applyQuaternion(tilt);
      p.setXYZ(i, c.x + v.x, c.y + v.y, c.z + v.z);
    } else p.setXYZ(i, c.x + x, c.y + y * sy, c.z + z);
  }
  geo.computeVertexNormals();
  return { geo, lump, clump: c };
}
/**
 * Leave out each clump's triangles that lie wholly inside another clump (its core, well under
 * the florets' valleys): nobody sees them, and they cost triangles, overdraw and shadow.
 */
function cullHidden(built: BuiltClump[]) {
  // Each clump's centre, 1 / squash and the squared radius of its solid core.
  const n = built.length, table = new Float64Array(n * 5);
  built.forEach(({ clump: o }, j) => {
    // A tilted clump's squash no longer runs up and down: test its core as a sphere as thin as the squash.
    const core = o.r * (1 - (o.amp ?? 0.1) * 1.1 - (o.droop || o.sag ? 0.12 : 0.04)) * (o.up ? Math.min(1, o.sy ?? 0.85) : 1);
    table.set([o.x, o.y, o.z, o.up ? 1 : 1 / (o.sy ?? 0.85), core * core], j * 5);
  });
  built.forEach(({ geo }, k) => {
    const P = geo.getAttribute('position').array as Float32Array, count = P.length / 3, index = geo.getIndex()!, hidden = new Uint8Array(count), kept: number[] = [];
    for (let i = 0; i < count; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      for (let j = 0; j < n; j++) {
        if (j === k) continue;
        const dx = x - table[j * 5], dy = (y - table[j * 5 + 1]) * table[j * 5 + 3], dz = z - table[j * 5 + 2];
        if (dx * dx + dy * dy + dz * dz < table[j * 5 + 4]) {
          hidden[i] = 1;
          break;
        }
      }
    }
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
      if (!(hidden[a] && hidden[b] && hidden[c])) kept.push(a, b, c);
    }
    geo.setIndex(kept);
  });
}
/**
 * A crown's paint, in tree space: each clump a tone of its own (between the look's two tones,
 * its hue a shade warmer or cooler, top clumps a little lighter); the whole crown dark
 * underneath and light on top (`y0` to `y1`), darker where it turns in toward the crown's
 * middle (`core`) and in the creases where clumps meet, and each clump's florets a shade lighter
 * than the valleys between them. Up-facing tops lean to the look's warm `top`, the underside to
 * its cool `under`.
 */
function paintCrown(built: BuiltClump[], look: Look, y0: number, y1: number, core: T.Vector3, seed: number, opts: { floor?: number; valley?: number; lift?: number; gain?: number; crease?: number; inner?: number } = {}) {
  const top = new T.Color(look.top), under = new T.Color(look.under), a = new T.Color(look.tones[0]), b = new T.Color(look.tones[1] ?? look.tones[0]),
    c = new T.Color(), base = new T.Color(), toCore = new T.Vector3(), floor = opts.floor ?? 0.5, valley = opts.valley ?? 0.8, lift = opts.lift ?? 0.38, crease = opts.crease ?? 0.26, inner = opts.inner ?? 0.3,
    heights = built.map(({ clump }) => clump.y), lo = Math.min(...heights), hi = Math.max(...heights),
    others = new Float64Array(built.flatMap(({ clump: o }) => [o.x, o.y, o.z, o.up ? 1 : 1 / (o.sy ?? 0.85), o.r]));
  built.forEach(({ geo, lump }, k) => {
    const h = (n: number) => hash(seed * 7.3 + k * 3.1 + n);
    base.copy(a).lerp(b, 0.6 * hash(seed * 3.7 + 1) + 0.4 * h(1)).offsetHSL((h(2) - 0.5) * 0.03, 0, 0);
    const own = (opts.gain ?? 1) * (0.95 + 0.07 * h(3)) * mix(0.96, 1.04, hi > lo ? (built[k].clump.y - lo) / (hi - lo) : 1);
    const P = geo.getAttribute('position').array as Float32Array, N = geo.getAttribute('normal').array as Float32Array, count = P.length / 3, out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], v = sstep(y, y0, y1), ny = N[i * 3 + 1];
      let f = own * mix(floor, 1.06, sstep(v, 0.08, 0.9)) * mix(valley, 1.04, sstep(lump[i], 0.25, 0.95));
      // Turned in toward the crown's middle: shaded by the clumps round it.
      toCore.set(core.x - x, (core.y - y) * 0.6, core.z - z).normalize();
      f *= 1 - inner * sstep(N[i * 3] * toCore.x + ny * toCore.y + N[i * 3 + 2] * toCore.z, 0.05, 0.75);
      for (let j = 0; j < others.length; j += 5) {
        if (j === k * 5) continue;
        const dx = x - others[j], dy = (y - others[j + 1]) * others[j + 3], dz = z - others[j + 2], r = others[j + 4],
          gap = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
        if (gap > 0 && gap < 0.3 * r) f *= 1 - crease * (1 - sstep(gap, 0, 0.3 * r));
      }
      c.copy(base).lerp(under, 0.32 * (1 - v)).lerp(top, lift * sstep(v, 0.5, 1) * Math.max(0, ny));
      out[i * 3] = c.r * f; out[i * 3 + 1] = c.g * f; out[i * 3 + 2] = c.b * f;
    }
    geo.setAttribute('color', new T.BufferAttribute(out, 3));
  });
}
/**
 * Lean each clump's normals toward the crown's own round (an ellipsoid round `centre`, `squash`
 * as tall as it is wide): the light then reads the crown as one soft volume with lumps in it
 * instead of a cluster of separate balls, each with its own lit side and dark rim. `weight` 0
 * keeps each clump's own shading, 1 the crown's alone.
 */
function softenNormals(built: BuiltClump[], centre: T.Vector3, squash: number, weight: number) {
  const k = 1 / (squash * squash);
  for (const { geo } of built) {
    const P = geo.getAttribute('position').array as Float32Array, n = geo.getAttribute('normal'), N = n.array as Float32Array;
    for (let i = 0; i < N.length; i += 3) {
      const ox = P[i] - centre.x, oy = (P[i + 1] - centre.y) * k, oz = P[i + 2] - centre.z, ol = Math.hypot(ox, oy, oz) || 1,
        x = N[i] * (1 - weight) + (ox / ol) * weight, y = N[i + 1] * (1 - weight) + (oy / ol) * weight, z = N[i + 2] * (1 - weight) + (oz / ol) * weight,
        l = Math.hypot(x, y, z) || 1;
      N[i] = x / l;
      N[i + 1] = y / l;
      N[i + 2] = z / l;
    }
    n.needsUpdate = true;
  }
}
/** Build, cull and merge a crown's clumps; returns the geometry and its top (tree space). */
function crown(clumps: Clump[]) {
  const built = clumps.map(clumpGeometry);
  cullHidden(built);
  let top = -Infinity;
  for (const { geo } of built) {
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) top = Math.max(top, p.getY(i));
  }
  return { built, top };
}
/** Merge built clumps (after painting) into one geometry; each is lifted by `dy` first. */
function mergeCrown(built: BuiltClump[], dy = 0) {
  const geo = mergeGeometries(built.map(({ geo }) => (dy ? geo.translate(0, dy, 0) : geo)))!;
  built.forEach(({ geo }) => geo.dispose());
  return geo;
}
/**
 * A trunk: rings at `rows` heights round a gentle bend (`bend(y)` gives the sideways offset), each
 * ring `radius(y, angle)` from its centre, joined into one smooth open tube.
 */
function trunkTube(rows: number[], radial: number, radius: (y: number, a: number) => number, bend: (y: number) => [number, number]) {
  const position: number[] = [], index: number[] = [];
  rows.forEach((y) => {
    const [bx, bz] = bend(y);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2, r = radius(y, a);
      position.push(bx + Math.cos(a) * r, y, bz + Math.sin(a) * r);
    }
  });
  for (let i = 0; i < rows.length - 1; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = a + radial, d = b + radial;
      index.push(a, c, b, b, c, d);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
/** Pine: three rounded lathe tiers, each rim overhanging the narrow waist of the tier below. */
function pine(t: T.Group, s: number, index: number, add: (g: T.BufferGeometry, k: SurfaceKind) => void) {
  add(paintByHeight(new T.CylinderGeometry(0.1*s, 0.15*s, 0.8*s, 8, 1, true).translate(0, 0.4*s, 0), TREE.pineTrunk, (y) => mix(0.95, 0.8, y / (0.8*s))), 'bark');
  const profile = [[0.001, -0.04], [0.82, 0], [1, 0.14], [0.48, 0.66], [0.13, 0.94], [0.001, 1]]; // bottom->top = outward normals
  const base = new T.Color(TREE.pine.tones[index % 2]), top = new T.Color(TREE.pine.top), under = new T.Color(TREE.pine.under), c = new T.Color();
  const geos = [[1.0, 0.85, 0.5], [0.78, 0.78, 1.05], [0.52, 0.72, 1.55]].map(([r, h, y0], k) => {
    const g = new T.LatheGeometry(profile.map(([px, py]) => new T.Vector2(px * r * s, py * h * s)), 10).translate(0, y0 * s, 0);
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), out = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const ly = (p.getY(i) - y0 * s) / (h * s), f = mix(0.5, 1.0, sstep(ly, -0.02, 0.3)) * mix(0.88, 1.05, k / 2);
      c.copy(base).lerp(under, 0.3 * (1 - sstep(ly, 0, 0.3))).lerp(top, 0.3 * sstep(ly, 0.3, 1) * Math.max(0, n.getY(i)));
      out[i*3] = c.r*f; out[i*3+1] = c.g*f; out[i*3+2] = c.b*f;
    }
    g.setAttribute('color', new T.BufferAttribute(out, 3)); return g;
  });
  add(mergeGeometries(geos)!, 'foliage');
  return t;
}
type AddPart = (g: T.BufferGeometry, k: SurfaceKind) => void;
type Look = { tones: string[]; top: string; under: string };
/** A slim open tube from a to b (radius ra at a, rb at b), painted from `colour` at a to `colour` × fade at b. */
function limb(a: T.Vector3, b: T.Vector3, ra: number, rb: number, radial: number, colour: string, fade: number) {
  const d = b.clone().sub(a), g = new T.CylinderGeometry(rb, ra, d.length(), radial, 1, true);
  g.translate(0, d.length() / 2, 0);
  paintByHeight(g, colour, (y) => mix(1, fade, y / d.length()));
  g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()));
  return g.translate(a.x, a.y, a.z);
}
/** A hex for `colour` × `value` (limbs start at the shade the trunk has where they leave it). */
const shade = (colour: string, value: number) => '#' + new T.Color(colour).multiplyScalar(value).getHexString();
/** Where the crowns top out, in units of the tree's size (check-town's TREE_TOPS and sheep test). */
const ROUND_TOP = 2.37,
  BIRCH_TOP = 2.578,
  ROWAN_TOP = 1.906;
/**
 * A berry: a small smooth pentagonal bipyramid (10 triangles; at the berries' size its outline
 * reads round), a little squashed.
 */
const berry = (() => {
  const ring = Array.from({ length: 5 }, (_, k) => [Math.cos((k / 5) * Math.PI * 2), 0, Math.sin((k / 5) * Math.PI * 2)]),
    tip = [0, 0.9, 0],
    foot = [0, -0.9, 0],
    position: number[] = [];
  for (let k = 0; k < 5; k++) {
    const a = ring[k], b = ring[(k + 1) % 5];
    position.push(...tip, ...b, ...a, ...foot, ...a, ...b);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(position.map((v, i) => (i % 3 === 1 ? v / 0.9 : v)), 3));
  g.normalizeNormals();
  return g;
})();
/** Fruit on a rowan's outer sprays: drooping berry bunches, or flat flower heads in spring. */
const fruitBlob = (() => { const g = new T.IcosahedronGeometry(1, 0); g.setAttribute('normal', g.getAttribute('position').clone()); g.normalizeNormals(); g.deleteAttribute('uv'); return g; })(); // 20 tris, smooth
function fruit(sprays: Clump[], s: number, index: number, f: TreeFruit) {
  const base = new T.Color(f.colour), c = new T.Color(), parts: T.BufferGeometry[] = [];
  const blob = (shape: T.BufferGeometry, x: number, y: number, z: number, r: number, squash: number, value: number) => {
    const g = shape.clone().scale(r, r * squash, r).translate(x, y, z), n = g.getAttribute('position').count;
    c.copy(base).multiplyScalar(value);
    g.setAttribute('color', new T.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3));
    parts.push(g);
  };
  for (let k = 0; k < f.clusters; k++) {
    const h = (n: number) => hash(index * 19 + k * 5.3 + n),
      { x: cx, y: cy, z: cz, r, sy = 0.85, sag = 0, long = 1, heading, up: tilt } = sprays[k % sprays.length],
      out = (heading ?? Math.atan2(cz, cx)) + (h(1) - 0.5) * (long > 1 ? 0.3 : 0.9),
      spin = h(2) * Math.PI * 2,
      // A point on the spray, from its own frame (laid on its slope when it has one) to the tree's.
      on = (x: number, y: number, z: number) => {
        const v = new T.Vector3(x, y, z);
        if (tilt) v.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), tilt));
        return [cx + v.x, cy + v.y, cz + v.z];
      };
    if (f.kind === 'flowers') {
      // A flat-topped head on the spray's upper face: one broad floret cushion and two smaller ones under its rim.
      const up = 0.5 + 0.35 * h(3),
        [x, y, z] = on(Math.cos(out) * Math.cos(up) * r, Math.sin(up) * r * sy, Math.sin(out) * Math.cos(up) * r);
      blob(fruitBlob, x, y + 0.03 * s, z, 0.14 * s, 0.42, 0.97 + 0.05 * h(4));
      for (const a of [0, 2.4]) blob(fruitBlob, x + Math.cos(spin + a) * 0.12 * s, y - 0.005 * s, z + Math.sin(spin + a) * 0.12 * s, 0.09 * s, 0.5, 0.9);
    } else {
      // A bunch hanging from the spray's rim: three tiers of berries (four, three, two), each tier
      // smaller and turned a little, the lower ones a shade darker in the bunch's own shade.
      const rim = 0.72 + 0.14 * h(5),
        b = 0.06 * s,
        [x, top, z] = on(Math.cos(out) * r * long * rim, -(sag * r * (rim * rim + 0.6 * rim) + 0.3 * r) * sy, Math.sin(out) * r * long * rim),
        y = top - 0.01 * s;
      [[4, 1.1, 0, 1.04], [3, 0.75, -1.2, 0.95], [2, 0.38, -2.2, 0.86]].forEach(([count, spread, dy, value], tier) => {
        for (let j = 0; j < count; j++) {
          const a = spin + tier * 0.7 + (j / count) * Math.PI * 2 + (h(6 + j + tier * 4) - 0.5) * 0.5;
          blob(berry, x + Math.cos(a) * spread * b, y + dy * b, z + Math.sin(a) * spread * b, b * (0.92 + 0.16 * h(20 + j + tier * 4)), 0.92, value * (0.95 + 0.08 * h(30 + j + tier * 4)));
        }
      });
    }
  }
  return mergeGeometries(parts)!;
}
/**
 * Silver birch: a slim trunk leaning a little and curving into its lean, cream-white with a few
 * dark marks (a pair of close rows each, dark on part of the round) and a dark foot, under a
 * narrow, airy crown held high: a body of small overlapping clumps over a fringe of smaller
 * weeping ones on fine pale twigs, light all through (no deep underside). Big clumps stacked up
 * the trunk read as topiary or cotton buds; separate egg-shaped clumps read as a bunch of grapes.
 */
function birch(t: T.Group, s: number, index: number, look: Look, season: Season, add: AddPart) {
  const H = 2.1 * s,
    lean = (0.07 + 0.07 * hash(index * 11 + 2)) / H,
    bend = (y: number) => lean * y * y,
    radial = 8,
    marks = [0.4 + 0.06 * hash(index * 11 + 3), 0.72 + 0.08 * hash(index * 11 + 4)],
    rows = [0, 0.05, 0.16, 0.28, marks[0] - 0.03, marks[0] + 0.03, (marks[0] + marks[1]) / 2, marks[1] - 0.03, marks[1] + 0.03, 1.05, 1.5, 2.1];
  const trunk = new T.LatheGeometry(rows.map((y) => new T.Vector2((mix(0.1, 0.055, y / 2.1) + (y < 0.1 ? 0.022 * (1 - y / 0.1) : 0)) * s, y * s)), radial);
  const p = trunk.getAttribute('position'), body = new T.Color(BIRCH_BARK.body), foot = new T.Color(BIRCH_BARK.foot), mark = new T.Color(BIRCH_BARK.mark), c = new T.Color(), out = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const col = Math.floor(i / rows.length) % radial, row = i % rows.length, y = p.getY(i);
    // A ragged dark foot, then the white bark; marks on two or three neighbouring sides of their row pair.
    c.copy(foot).lerp(body, sstep(y, (0.08 + 0.08 * hash(index * 3 + col)) * s, (0.24 + 0.06 * hash(index * 5 + col)) * s));
    const m = row >= 4 && row <= 8 && row !== 6 ? (row < 6 ? 0 : 1) : -1;
    if (m >= 0 && (col - Math.floor(hash(index * 7 + m) * radial) + radial) % radial < 2 + m) c.lerp(mark, 0.8);
    // Shaded where the crown closes over it.
    const f = mix(1, 0.62, sstep(y, 1.3 * s, H));
    out[i*3] = c.r*f; out[i*3+1] = c.g*f; out[i*3+2] = c.b*f;
    p.setX(i, p.getX(i) + bend(y));
  }
  trunk.setAttribute('color', new T.BufferAttribute(out, 3));
  add(trunk, 'bark');
  // The crown: a narrow body of three big soft clumps at the top of the trunk (a leader over two),
  // and round its foot four smaller clumps (two in winter) hanging lower and further out on fine
  // pale twigs that arch out and down, with sky between them. Every clump's hem weeps into
  // tassels like the birch's pendulous twigs, more the lower it hangs.
  const spin = hash(index * 13) * Math.PI * 2,
    h = (k: number) => hash(index * 13 + k * 3.7),
    hang = season === 'winter' ? 2 : 4,
    clumps: Clump[] = [{ x: bend(2.28 * s), y: 2.28 * s, z: 0, r: 0.2 * s, sy: 1.25, detail: 3, florets: 10, amp: 0.13, droop: 0.6, weep: 0.3, seed: index * 7 + 1 }];
  for (let j = 0; j < 2; j++) {
    const a = spin + j * Math.PI + (h(j) - 0.5) * 0.8, d = (0.12 + 0.03 * h(j + 3)) * s, y = (1.97 + 0.06 * (h(j + 5) - 0.5)) * s;
    clumps.push({ x: bend(y) + Math.cos(a) * d, y, z: Math.sin(a) * d, r: (0.2 + 0.02 * h(j + 7)) * s, sy: 1.2, detail: 3, florets: 10, amp: 0.13, droop: 0.8, weep: 0.45, seed: index * 7 + 2 + j });
  }
  for (let j = 0; j < hang; j++) {
    const a = spin + 0.8 + (j / hang) * Math.PI * 2 + (h(j + 10) - 0.5) * 0.7, d = (0.26 + 0.04 * h(j + 13)) * s, y = (mix(1.74, 1.5, hang > 1 ? j / (hang - 1) : 0) + 0.05 * (h(j + 16) - 0.5)) * s;
    clumps.push({ x: bend(y) + Math.cos(a) * d, y, z: Math.sin(a) * d, r: (0.145 + 0.025 * h(j + 19)) * s, sy: 1.25, detail: 2, florets: 7, amp: 0.14, droop: 0.8, weep: 0.6, seed: index * 7 + 4 + j });
  }
  const { built, top } = crown(clumps),
    dy = BIRCH_TOP * s - top,
    middle = new T.Vector3(bend(1.95 * s), 1.95 * s, 0);
  paintCrown(built, look, 1.25 * s, 2.6 * s, middle, index, { floor: 0.8, valley: 0.86, crease: 0.12 });
  softenNormals(built, middle, 1.6, 0.45);
  add(mergeCrown(built, dy), 'foliage');
  // Pale limbs: the body's rise from the trunk into their clumps; the hanging clumps' twigs arch
  // out from the trunk and down into the top of their clump, so each shows above it.
  const pale = shade(BIRCH_BARK.body, 0.8),
    limbs = clumps.slice(1).flatMap(({ x, y, z }, j) => {
      if (j < 2) return [limb(new T.Vector3(bend(y - 0.3 * s), y - 0.3 * s, 0), new T.Vector3(x, y + dy - 0.04 * s, z), 0.028 * s, 0.016 * s, 5, pale, 0.7)];
      const from = new T.Vector3(bend(y + 0.12 * s), y + 0.12 * s, 0),
        elbow = new T.Vector3(mix(from.x, x, 0.6), y + dy + 0.3 * s, mix(0, z, 0.6)),
        end = new T.Vector3(x, y + dy + 0.12 * s, z);
      return [limb(from, elbow, 0.022 * s, 0.015 * s, 5, pale, 0.85), limb(elbow, end, 0.015 * s, 0.011 * s, 5, shade(BIRCH_BARK.body, 0.68), 0.9)];
    });
  add(mergeGeometries(limbs)!, 'bark');
  return t;
}
/**
 * Rowan: smaller than the round trees (0.85 of their scale), a grey-brown trunk with a slight
 * bend forking into three limbs, and an upright oval crown of small, flattened, lumpy sprays laid
 * over its dome like feathers (each about half a round tree's clump across, the side ones
 * standing), rather than a cluster of balls. Its fruit (treeFruit) hangs in bunches from the rims
 * of the lowest sprays.
 */
function rowan(t: T.Group, size: number, index: number, look: Look, f: TreeFruit | null, add: AddPart, quiet: (g: T.BufferGeometry) => void, facing: number) {
  const s = 0.85 * size,
    h = (n: number) => hash(index * 23.3 + n),
    F = (0.86 + 0.06 * h(1)) * s,
    lean = [(h(2) - 0.5) * 0.12 * s, (h(3) - 0.5) * 0.12 * s],
    bend = (y: number): [number, number] => {
      const q = Math.max(0, Math.min(1, y / F)) ** 2;
      return [lean[0] * q, lean[1] * q];
    };
  const wood = trunkTube([-0.05, 0, 0.04, 0.1, 0.2, 0.36, 0.54, 0.72].map((v) => v * s).concat([F, F + 0.1 * s]), 10, (y, a) => {
    const taper = mix(0.115, 0.075, Math.max(0, y) / (F + 0.1 * s)) * s,
      foot = Math.max(0, 1 - Math.max(0, y) / (0.22 * s)) ** 2;
    return taper + 0.07 * s * foot * (0.5 + 0.5 * Math.max(0, Math.cos(1.5 * a + h(4) * 6)) ** 2);
  }, bend);
  const trunkShade = (y: number) => mix(1.0, 0.6, sstep(y, 0.55 * s, F + 0.1 * s));
  paintByHeight(wood, ROWAN_BARK, trunkShade);
  add(wood, 'bark');
  // The crown: small, lumpy sprays packed over an open dome round a little core (a seeded
  // sunflower spiral, so no rings show), each drawn out a little along its own bearing and hanging
  // at the tip; the lowest ones leave a gap toward the camera, like the round trees'. They are
  // half the round trees' clumps across, so the crown reads finer, and they share the crown's
  // light (softenNormals), so it reads as one feathery dome, not a cluster of balls.
  const [tx, tz] = bend(F),
    clumps: Clump[] = [{ x: tx, y: 1.56 * s, z: tz, r: 0.34 * s, sy: 1.05, detail: 1, florets: 6, seed: index * 13 + 1 }], // the core
    N = 16,
    turn = h(5) * Math.PI * 2;
  for (let k = 0; k < N; k++) {
    const q = (k + 0.5) / N,
      polar = Math.acos(1 - 1.3 * q), // from the top down to about 107 degrees
      a = turn + k * 2.39996,
      off = Math.abs(((a - facing) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
    if (polar > 1.2 && off < 0.55) continue; // the gap under the rim, toward the camera
    const d = Math.sin(polar) * 0.45 * s,
      y = 1.56 * s + Math.cos(polar) * 0.46 * s,
      r = (0.14 + 0.025 * h(9 + k) + 0.025 * (1 - q)) * s;
    // Each spray lies along the dome (its up most of the way to the dome's), so the side ones stand.
    const up = new T.Vector3(Math.cos(a) * Math.sin(polar), Math.cos(polar), Math.sin(a) * Math.sin(polar)).normalize().lerp(new T.Vector3(0, 1, 0), 0.3).normalize();
    clumps.push({ x: tx + Math.cos(a) * d, y, z: tz + Math.sin(a) * d, r, sy: 0.75, sag: 0.2, long: 1.3 + 0.15 * h(20 + k), heading: a + (h(30 + k) - 0.5) * 1.6, detail: 2, florets: 8, amp: 0.16, up, seed: index * 13 + 2 + k });
  }
  const { built, top } = crown(clumps),
    dy = ROWAN_TOP * size - top;
  // A rowan's warm top only glints: lifted further, its autumn orange turns to flesh pink after the grade.
  paintCrown(built, look, 1.05 * s, 2.3 * s, new T.Vector3(tx, 1.5 * s, tz), index, { floor: 0.52, lift: 0.18, gain: 0.93, crease: 0.12 });
  softenNormals(built, new T.Vector3(tx, 1.56 * s, tz), 1.05, 0.5);
  add(mergeCrown(built, dy), 'foliage');
  // Three limbs from the fork into the lowest sprays round the gap; bunches hang from the lower sprays first.
  const fork = new T.Vector3(tx, F - 0.04 * s, tz),
    outer = clumps.slice(1).sort((p, q) => p.y - q.y),
    ends = outer.slice(0, 3);
  add(mergeGeometries(ends.map((c) => limb(fork, new T.Vector3(mix(tx, c.x, 0.7), c.y + dy - 0.08 * s, mix(tz, c.z, 0.7)), 0.05 * s, 0.025 * s, 6, shade(ROWAN_BARK, trunkShade(F)), 0.75)))!, 'bark');
  // The berries hang from the outer sprays round the crown's sides, the flower heads sit on the
  // sprays over its top; those toward the camera first (so they show from the opening bearing),
  // on the side that faces out.
  const toward = (c: Clump) => Math.cos(Math.atan2(c.z - tz, c.x - tx) - facing);
  if (f)
    quiet(fruit(outer.filter((c) => (f.kind === 'flowers' ? c.y > 1.75 * s : Math.hypot(c.x - tx, c.z - tz) > 0.3 * s)).sort((p, q) => toward(q) - toward(p)).map((c) => ({ ...c, y: c.y + dy, heading: Math.atan2(c.z - tz, c.x - tx) })), s, index, f));
  return t;
}
/**
 * The round tree (avenues, plaza, park and outskirts; the autumn accents share it): a trunk with a
 * slight bend, a taper and a root flare of four buttresses, forking at about 0.77 × size into
 * three limbs that reach up into a cauliflower crown of seven to nine leafy clumps (a big one on
 * top, three round it and three to five lower and further out, over a core that fills the
 * middle). `facing` is the bearing (in tree space) the opening camera looks from: the rings
 * leave a gap there, so the fork shows under the crown's rim instead of behind a clump.
 */
function roundTree(t: T.Group, s: number, index: number, look: Look, add: AddPart, facing: number) {
  const h = (n: number) => hash(index * 31.7 + n);
  const F = (0.74 + 0.06 * h(1)) * s,
    lean = [(h(2) - 0.5) * 0.14 * s, (h(3) - 0.5) * 0.14 * s],
    bend = (y: number): [number, number] => {
      const q = Math.max(0, Math.min(1, y / F)) ** 2;
      return [lean[0] * q, lean[1] * q];
    },
    roots = h(4) * Math.PI * 2;
  const rows = [-0.05, 0, 0.035, 0.08, 0.14, 0.22, 0.34, 0.48, 0.62].map((v) => v * s).concat([F, F + 0.12 * s]);
  const wood = trunkTube(rows, 12, (y, a) => {
    const taper = mix(0.15, 0.1, Math.max(0, y) / (F + 0.12 * s)) * s,
      foot = Math.max(0, 1 - Math.max(0, y) / (0.3 * s)) ** 2,
      buttress = 0.4 + 0.6 * Math.max(0, Math.cos(2 * (a + roots))) ** 2; // four roots
    return taper + 0.15 * s * foot * buttress;
  }, bend);
  const trunkShade = (y: number) => mix(1.0, 0.62, sstep(y, 0.4 * s, F + 0.12 * s));
  paintByHeight(wood, TREE.trunk, trunkShade);
  add(wood, 'bark');
  // The crown: a core, a big top clump, three round it (to the back and sides) and three to five
  // lower and further out, all leaving a gap toward the camera.
  const [tx, tz] = bend(F),
    lower = 3 + Math.floor(h(6) * 2.99), // 3 to 5
    gap = 1.5,
    at = (a: number, d: number, y: number, r: number, detail: number, florets: number, seed: number): Clump =>
      ({ x: tx + Math.cos(a) * d, y, z: tz + Math.sin(a) * d, r, detail, florets, amp: 0.14, seed }),
    clumps: Clump[] = [
      { x: tx, y: 1.6 * s, z: tz, r: 0.5 * s, detail: 1, florets: 6, seed: index * 11 + 1 }, // the core
      at(facing + h(7) * 6.283, 0.05 * s * h(8), 1.92 * s, (0.52 + 0.04 * h(9)) * s, 3, 14, index * 11 + 2),
    ];
  for (let k = 0; k < 3; k++)
    clumps.push(at(facing + Math.PI + (k - 1) * 2.15 + (h(10 + k) - 0.5) * 0.4, (0.4 + 0.06 * h(13 + k)) * s, (1.74 + 0.06 * h(16 + k)) * s, (0.44 + 0.04 * h(19 + k)) * s, 3, 12, index * 11 + 3 + k));
  for (let k = 0; k < lower; k++)
    clumps.push(at(facing + gap / 2 + ((k + 0.5) / lower) * (Math.PI * 2 - gap) + (h(22 + k) - 0.5) * 0.3, (0.6 + 0.07 * h(27 + k)) * s, (1.4 + 0.08 * h(32 + k)) * s, (0.4 + 0.05 * h(37 + k)) * s, 3, 11, index * 11 + 6 + k));
  const { built, top } = crown(clumps),
    dy = ROUND_TOP * s - top;
  paintCrown(built, look, 1.0 * s, 2.4 * s, new T.Vector3(tx, 1.6 * s, tz), index, { valley: 0.88, crease: 0.15, inner: 0.25 });
  softenNormals(built, new T.Vector3(tx, 1.7 * s, tz), 0.75, 0.4);
  add(mergeCrown(built, dy), 'foliage');
  // Three limbs from the fork: into the two lower clumps either side of the gap and the upper one
  // at the back, so a Y opens under the crown's rim.
  const fork = new T.Vector3(tx, F - 0.04 * s, tz),
    ends = [clumps[5], clumps[clumps.length - 1], clumps[3]];
  add(mergeGeometries(ends.map((c) => limb(fork, new T.Vector3(mix(tx, c.x, 0.72), c.y + dy - 0.12 * s, mix(tz, c.z, 0.72)), 0.085 * s, 0.045 * s, 6, shade(TREE.trunk, trunkShade(F)), 0.7)))!, 'bark');
  return t;
}
export const BLOOMS = palette.flowers;
const bloomGeometry = (() => { const g = new T.IcosahedronGeometry(0.1, 0); g.setAttribute('normal', g.getAttribute('position').clone()); g.normalizeNormals(); return g; })(); // 20 tris, smooth blob
/**
 * Clone a shared box geometry and bake a bottom->top ramp plus a tint on up-facing tops (use with '#ffffff').
 * Keep `bottom` near 0.9: the batch bake already darkens every base towards the ground.
 */
export function bakeRamp(m: T.Mesh, colour: string, bottom: number, top: number, tint = colour, amount = 0) {
  const geo = (m.geometry = (m.geometry as T.BufferGeometry).clone()); geo.computeBoundingBox();
  const { min, max } = geo.boundingBox!, p = geo.getAttribute('position'), n = geo.getAttribute('normal');
  const a = new T.Color(colour), b = new T.Color(tint), c = new T.Color(), out = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const v = (p.getY(i) - min.y) / Math.max(1e-6, max.y - min.y), f = mix(bottom, top, v);
    c.copy(a).lerp(b, amount * v * sstep(n.getY(i), 0.2, 0.9));
    out[i*3] = c.r*f; out[i*3+1] = c.g*f; out[i*3+2] = c.b*f;
  }
  geo.setAttribute('color', new T.BufferAttribute(out, 3)); return m;
}
/**
 * Heather keeps its own season, like the trees: a muted mauve bloom in late summer, greyer as it
 * fades in autumn, plain green shoots in spring and a dull olive in winter, so the bare drifts
 * recede. `stem` is a heather green a shade darker than the turf, so a drift's edge melts into
 * the grass; `bloom` speckles the up-facing tops.
 */
export function heatherLook(season: Season) {
  if (season === 'spring') return { stem: '#6f8a46', bloom: '#8e9a58' };
  if (season === 'winter') return { stem: '#66783f', bloom: '#7d7746' };
  if (season === 'autumn') return { stem: '#6a7e46', bloom: '#937391' };
  return { stem: '#68804a', bloom: '#9a7499' };
}

export function createNature(ctx: TownContext, kit: Kit) {
  const { material, season } = ctx;
  const { box, cylinder, cone, groundY } = kit;
  function tree(g: T.Object3D, spec: plan.TreeSpec, index: number) {
    const t = new T.Group();
    const y = plan.terrainHeight(spec.x, spec.z);
    t.position.set(spec.x, y, spec.z);
    t.rotation.y = hash(index * 3) * Math.PI * 2;
    g.add(t);
    const s = spec.size;
    const add = (geo: T.BufferGeometry, kind: SurfaceKind) => { const m = new T.Mesh(geo, material('#ffffff', kind)); m.castShadow = m.receiveShadow = true; t.add(m); };
    if (spec.kind === 'pine') return pine(t, s, index, add);
    if (spec.kind === 'birch') return birch(t, s, index, treeLook(spec, index, season), season, add);
    // The bearing the opening camera looks from, in the tree's own (spun) frame.
    const facing = Math.PI / 2 - plan.chapterBearings.overview + t.rotation.y;
    if (spec.kind === 'rowan')
      return rowan(t, s, index, treeLook(spec, index, season), treeFruit(spec, season), add, (geo) => {
        // Berries and flower heads: small, so they cast no shadow (like the beds' blooms).
        const m = new T.Mesh(geo, material('#ffffff', 'foliage'));
        m.castShadow = false; m.receiveShadow = true; m.userData.noShadow = true; m.userData.fruit = true; t.add(m);
      }, facing);
    return roundTree(t, s, index, treeLook(spec, index, season), add, facing);
  }
  /** One fat bloom: a squashed 20-triangle blob that casts no shadow. */
  function bloom(g: T.Object3D, x: number, y: number, z: number, colour: string) {
    const m = new T.Mesh(bloomGeometry, material(colour, 'foliage'));
    m.position.set(x, y, z); m.scale.set(1, 0.7, 1); m.rotation.y = hash(x * 13 + z * 7) * 3;
    m.castShadow = false; m.receiveShadow = true; m.userData.noShadow = true; g.add(m); return m;
  }
  /** A hedge as one rounded mass with a lime top, optionally split by a gap (`at` along its length). */
  function hedge(g: T.Object3D, x: number, y: number, z: number, length: number, ry = 0, height = 0.55, gap?: { at: number; width: number }) {
    const h = new T.Group(); h.position.set(x, y, z); h.rotation.y = ry; g.add(h);
    const spans = gap ? [[-length / 2, gap.at - gap.width / 2], [gap.at + gap.width / 2, length / 2]] : [[-length / 2, length / 2]];
    for (const [a, b] of spans) if (b - a >= 0.45)
      bakeRamp(box(h, (a + b) / 2, height / 2, 0, b - a, height, 0.6, '#ffffff', 'foliage', { bevel: 0.12, segments: 1 }), palette.hedge, 0.9, 1.05, palette.hedgeTop, 0.45);
    return h;
  }
  /** A stone kerb, a green mound and three to six chunky blooms. */
  function flowerBed(g: T.Object3D, x: number, y: number, z: number, w: number, d: number, seed: number) {
    box(g, x, y + 0.11, z, w + 0.16, 0.22, d + 0.16, palette.stoneDark, 'stone'); // kerb
    bakeRamp(box(g, x, y + 0.27, z, w - 0.04, 0.2, d - 0.04, '#ffffff', 'foliage', { bevel: 0.09, segments: 1 }), palette.hedge, 0.9, 1.05, palette.hedgeTop, 0.4); // mound
    const count = T.MathUtils.clamp(Math.round(w * d * 4), 3, 6), long = w >= d;
    for (let i = 0; i < count; i++) {
      const along = ((i + 0.5) / count - 0.5) * (Math.max(w, d) - 0.3), across = (hash(seed + i * 3) - 0.5) * Math.max(0, Math.min(w, d) - 0.35);
      bloom(g, x + (long ? along : across), y + 0.4, z + (long ? across : along), BLOOMS[(seed + i) % 5]);
    }
  }
  /**
   * A clipped topiary lump: one leafy clump with many small, shallow florets (clipped leaves, not
   * a cauliflower), a detail finer than asked so its outline stays round close up, painted like a
   * crown in the hedge's green.
   */
  function topiary(g: T.Object3D, x: number, y: number, z: number, r: number, detail: number, sx = 1, sy = 0.9, sz = 1) {
    const built = [clumpGeometry({ x: 0, y: 0, z: 0, r, sy: 1, detail: Math.max(2, detail + 1), florets: 18, amp: 0.05, seed: Math.round(x * 13 + z * 7) })],
      geo = built[0].geo;
    geo.scale(sx, sy, sz);
    geo.computeVertexNormals();
    paintCrown(built, { tones: [palette.hedge], top: TREE.round.top, under: TREE.round.under }, -r * sy, r * sy, new T.Vector3(), Math.round(x * 5 + z * 3), { floor: 0.55, valley: 0.9 });
    const m = new T.Mesh(geo, material('#ffffff', 'foliage')); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m;
  }
  /**
   * A heather drift: one low mat over the plan's tufts (their union gives its outline, a little
   * nibbled), heather green fading at its rim to the turf's own green, stippled with many small
   * shoots in the season's bloom. One surface with a fine texture, so it reads as a patch of
   * scrub: a cluster of a few separate domes, each with an outline and a shaded underside, read
   * as a pile of pebbles. Like the turf it takes no contact shading and casts no shadow.
   */
  function heatherDrift(g: T.Object3D, drift: plan.HeatherDrift, index: number) {
    const look = heatherLook(season),
      stem = new T.Color(look.stem),
      bloom = new T.Color(look.bloom),
      turf = new T.Color(palette.grass),
      c = new T.Color(),
      // The built hill runs a little under the smooth terrainHeight; follow it, measured once per drift.
      drop = groundY(drift.x, drift.z) - plan.terrainHeight(drift.x, drift.z);
    const SPOKES = 24,
      RINGS = 5,
      HEIGHT = 0.06;
    // How far the tufts reach from the drift's centre along a bearing: the far side of their union.
    const reach = (a: number) => {
      const dx = Math.cos(a),
        dz = Math.sin(a);
      let far = 0;
      for (const l of drift.lumps) {
        const ox = l.x - drift.x,
          oz = l.z - drift.z,
          t = ox * dx + oz * dz,
          side = ox * ox + oz * oz - t * t;
        if (side < l.r * l.r) far = Math.max(far, t + Math.sqrt(l.r * l.r - side));
      }
      return far;
    };
    const rim = Array.from({ length: SPOKES }, (_, k) => reach((k / SPOKES) * Math.PI * 2) * (0.9 + 0.12 * hash(index * 13 + k * 3.1)));
    const rimAt = (a: number) => {
      const u = ((((a / (Math.PI * 2)) % 1) + 1) % 1) * SPOKES,
        k = Math.floor(u);
      return mix(rim[k % SPOKES], rim[(k + 1) % SPOKES], u - k);
    };
    // The mat's height over the turf, from the centre (f = 0) to the rim (f = 1, just under the turf).
    const lift = (f: number) => (f >= 1 ? -0.015 : HEIGHT * Math.pow(1 - f * f, 0.6));
    const ground = (x: number, z: number) => plan.terrainHeight(x, z) + drop;
    const position: number[] = [],
      colour: number[] = [],
      faces: number[] = [];
    // Ring 0 is the centre; the last ring is the rim. Inner points wander a little off their ring
    // and spoke, so no radial pattern shows.
    for (let ring = 0; ring <= RINGS; ring++)
      for (let k = 0; k < (ring ? SPOKES : 1); k++) {
        const wander = ring && ring < RINGS ? 0.35 : 0,
          a = ((k + (ring % 2) * 0.5 + wander * (hash(index * 41 + ring * 13 + k) - 0.5)) / SPOKES) * Math.PI * 2,
          f = Math.min(1, (ring + wander * (hash(index * 43 + ring * 7 + k * 3) - 0.5)) / RINGS),
          x = drift.x + Math.cos(a) * f * rimAt(a),
          z = drift.z + Math.sin(a) * f * rimAt(a);
        position.push(x, ground(x, z) + lift(ring === RINGS ? 1 : Math.min(f, 0.99)), z);
        const shade = 0.92 + 0.12 * hash(index * 3 + ring * 5 + k * 0.7);
        c.copy(stem).lerp(turf, 0.55 * sstep(f, 0.5, 1));
        colour.push(c.r * shade, c.g * shade, c.b * shade);
      }
    const at = (ring: number, k: number) => (ring ? 1 + (ring - 1) * SPOKES + (k % SPOKES) : 0);
    for (let k = 0; k < SPOKES; k++) {
      faces.push(0, at(1, k + 1), at(1, k));
      for (let ring = 1; ring < RINGS; ring++) {
        // Odd rings sit half a step on, so each quad leans the same way round the ring.
        const o = ring % 2;
        faces.push(at(ring, k), at(ring + 1, k + o), at(ring + 1, k + o - 1 + SPOKES));
        faces.push(at(ring, k), at(ring, k + 1), at(ring + 1, k + o));
      }
    }
    const mat = new T.BufferGeometry();
    mat.setAttribute('position', new T.Float32BufferAttribute(position, 3));
    mat.setAttribute('color', new T.Float32BufferAttribute(colour, 3));
    mat.setIndex(faces);
    mat.computeVertexNormals();
    // The shoots: small, flat, smooth blobs half sunk in the mat, packed on a sunflower spiral so
    // they stipple its crown; most flower, the rest stay a lighter green.
    const shoot = mergeVertices((() => {
      const ico = new T.IcosahedronGeometry(1, 0);
      ico.deleteAttribute('normal');
      ico.deleteAttribute('uv');
      return ico;
    })());
    const area = drift.lumps.reduce((sum, l) => Math.max(sum, Math.PI * (Math.hypot(l.x - drift.x, l.z - drift.z) + l.r) ** 2), 0),
      count = Math.round(Math.min(60, Math.max(24, area / 0.013))),
      spin = hash(index * 19) * Math.PI * 2;
    const shoots = Array.from({ length: count }, (_, k) => {
      const a = spin + k * 2.39996,
        f = 0.82 * Math.sqrt((k + 0.5) / count),
        r = 0.05 + 0.035 * hash(index * 23 + k * 1.9),
        x = drift.x + Math.cos(a) * f * rimAt(a),
        z = drift.z + Math.sin(a) * f * rimAt(a),
        geo = shoot.clone();
      geo.rotateY(hash(index * 29 + k) * Math.PI);
      geo.scale(r, r * 0.55, r);
      geo.translate(x, ground(x, z) + lift(f) - 0.012, z);
      geo.computeVertexNormals();
      const flower = hash(index * 31 + k * 2.7) < 0.7,
        shade = 0.9 + 0.16 * hash(index * 37 + k * 1.1),
        n = geo.getAttribute('position').count;
      c.copy(flower ? bloom : stem).lerp(turf, flower ? 0 : 0.2);
      geo.setAttribute('color', new T.Float32BufferAttribute(Array.from({ length: n }, () => [c.r * shade, c.g * shade, c.b * shade]).flat(), 3));
      return geo;
    });
    shoot.dispose();
    const m = new T.Mesh(mergeGeometries([mat, ...shoots])!, material('#ffffff', 'foliage'));
    mat.dispose();
    shoots.forEach((s) => s.dispose());
    m.castShadow = false;
    m.receiveShadow = true;
    m.userData.noShadow = true;
    m.userData.ground = true;
    g.add(m);
    return m;
  }
  /**
   * A thistle plant: a dark, spiky rosette of three flat leaves and one or two stems, each with a
   * faceted green bulb under a flared purple brush (the emblem's silhouette). No shadow.
   */
  function thistle(g: T.Object3D, x: number, z: number, seed: number) {
    const t = new T.Group();
    t.position.set(x, plan.terrainHeight(x, z), z);
    t.rotation.y = hash(seed) * Math.PI;
    g.add(t);
    const leaf = '#5d7a45',
      quiet = (m: T.Mesh) => {
        m.castShadow = false;
        m.userData.noShadow = true;
        return m;
      };
    for (let k = 0; k < 3; k++) quiet(cone(t, 0, 0.02, 0, 0.17, 0.05, leaf, 'foliage', 4, (k * Math.PI) / 6));
    const stems = hash(seed + 1) < 0.5 ? 1 : 2;
    for (let k = 0; k < stems; k++) {
      const a = k * 2.3 + hash(seed + k) * 0.6,
        sx = Math.cos(a) * 0.04,
        sz = Math.sin(a) * 0.04,
        rz = (hash(seed + k * 3 + 2) - 0.5) * 0.4,
        h = 0.3 - k * 0.07 - 0.05 * hash(seed + k * 5 + 4);
      quiet(box(t, sx, h / 2, sz, 0.05, h, 0.05, leaf, 'foliage', { rz }));
      const tx = sx - (Math.sin(rz) * h) / 2,
        ty = h / 2 + (Math.cos(rz) * h) / 2;
      const bulb = quiet(cone(t, tx, ty + 0.03, sz, 0.06, 0.08, leaf, 'foliage', 6, 0)); // flat facets read as spines
      bulb.rotation.x = Math.PI; // apex down, into the stem
      quiet(cylinder(t, tx, ty + 0.095, sz, 0.06, 0.035, 0.06, '#9b6aa6', 'foliage')); // thistle purple, s 0.36
    }
    return t;
  }
  /** Moorland on the outskirts: heather drifts on the hills, two clumps of thistles by the paddock. */
  function moorland(g: T.Object3D, trees: plan.TreeSpec[]) {
    plan.heatherPlan(trees).forEach((drift, i) => heatherDrift(g, drift, i));
    plan.thistles.forEach(([x, z], i) => thistle(g, x, z, 31 + i * 7));
  }
  return { tree, bloom, hedge, flowerBed, topiary, heatherDrift, thistle, moorland };
}
export type Nature = ReturnType<typeof createNature>;
