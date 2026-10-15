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
/** Rowan: a deep, slightly cool green that turns orange-red in autumn. */
const ROWAN: Record<Season, { tones: string[]; top: string; under: string }> = {
  spring: { tones: ['#4e9052', '#559556'], top: '#a2c47a', under: '#285a38' },
  summer: { tones: ['#468a4c', '#4e9052'], top: '#9cc27a', under: '#245536' },
  autumn: { tones: ['#bc5634', '#c45e37'], top: '#e2945a', under: '#7c3624' },
  winter: { tones: ['#5a8250', '#618756'], top: '#a0b38a', under: '#2b4b38' },
};
const ROWAN_BARK = '#7b6f63';
export type TreeFruit = { kind: 'flowers' | 'berries'; colour: string; clusters: number };
/**
 * What a rowan carries: creamy flat flower heads in spring, a few ripening orange berry clusters
 * in (late) summer, full scarlet clusters in autumn and nothing in winter. Other trees carry none.
 * The colours stay inside their palette families (white, the flower red); the berries are the
 * small accent that may be the most saturated thing in frame.
 */
export function treeFruit(spec: plan.TreeSpec, season: Season): TreeFruit | null {
  if (spec.kind !== 'rowan') return null;
  if (season === 'spring') return { kind: 'flowers', colour: palette.white, clusters: 7 };
  if (season === 'summer') return { kind: 'berries', colour: '#cc6a3e', clusters: 4 };
  if (season === 'autumn') return { kind: 'berries', colour: '#c4453a', clusters: 5 };
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
/** One lump in tree space: only spun about y, so the squash and the ramp stay vertical. */
function canopyLump(r: number, detail: number, x: number, y: number, z: number, spin: number) {
  const g = new T.IcosahedronGeometry(r, detail);
  g.rotateY(spin); g.scale(1, 0.85, 1); g.translate(x, y, z);
  return g;
}
/** Clash two-tone: cool dark underside, warm lime crown, darker creases where lumps meet. */
function paintCanopy(geos: T.BufferGeometry[], spheres: number[][], look: { top: string; under: string }, tone: string, y0: number, y1: number) {
  const base = new T.Color(tone), top = new T.Color(look.top), under = new T.Color(look.under), c = new T.Color();
  geos.forEach((g, k) => {
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), out = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), v = sstep(y, y0, y1);
      let f = mix(0.45, 1.05, sstep(v, 0.12, 0.88));
      spheres.forEach(([sx, sy, sz, sr], j) => {
        if (j === k) return;
        const gap = Math.hypot(x - sx, (y - sy) / 0.85, z - sz) - sr;
        if (gap > 0) f *= 1 - 0.3 * (1 - sstep(gap, 0, 0.3 * sr));
      });
      c.copy(base).lerp(under, 0.3 * (1 - v)).lerp(top, 0.35 * sstep(v, 0.55, 1) * Math.max(0, n.getY(i)));
      out[i*3] = c.r*f; out[i*3+1] = c.g*f; out[i*3+2] = c.b*f;
    }
    g.setAttribute('color', new T.BufferAttribute(out, 3));
  });
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
/** A birch clump: a canopy lump stretched `tall`, whose lower half hangs a little longer and narrower, so it droops. */
function droopingLump(r: number, x: number, y: number, z: number, spin: number, tall = 1) {
  const g = canopyLump(r, 1, 0, 0, 0, spin), p = g.getAttribute('position'), n = g.getAttribute('normal'), v3 = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    const v = p.getY(i), t = Math.max(0, -v / (0.85 * r)), taper = 1 - 0.16 * t, stretch = tall * (v < 0 ? 1.28 : 1);
    p.setXYZ(i, p.getX(i) * taper, v * stretch, p.getZ(i) * taper);
    // The ellipsoid's normal for the stretch (the taper's slope is left out): it keeps the lump smooth.
    v3.set(n.getX(i) / taper, n.getY(i) / stretch, n.getZ(i) / taper).normalize();
    n.setXYZ(i, v3.x, v3.y, v3.z);
  }
  return g.translate(x, y, z);
}
/** Fruit on a crown's clumps: rowan berry clusters (four small berries each) or flat flower heads. */
const fruitBlob = (() => { const g = new T.IcosahedronGeometry(1, 0); g.setAttribute('normal', g.getAttribute('position').clone()); g.normalizeNormals(); g.deleteAttribute('uv'); return g; })(); // 20 tris, smooth
function fruit(spheres: number[][], s: number, index: number, f: TreeFruit) {
  const base = new T.Color(f.colour), c = new T.Color(), parts: T.BufferGeometry[] = [];
  const blob = (x: number, y: number, z: number, r: number, squash: number, shade: number) => {
    const g = fruitBlob.clone().scale(r, r * squash, r).translate(x, y, z), n = g.getAttribute('position').count;
    c.copy(base).multiplyScalar(shade);
    g.setAttribute('color', new T.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3));
    parts.push(g);
  };
  // Round the outer clumps (every sphere but the first, the crown's top), on their outer faces.
  const outer = spheres.slice(1);
  for (let k = 0; k < f.clusters; k++) {
    const [cx, cy, cz, cr] = outer[k % outer.length],
      out = Math.atan2(cz, cx) + (hash(index * 17 + k * 5) - 0.5) * 1.1,
      up = f.kind === 'flowers' ? 0.45 + 0.4 * hash(index * 19 + k) : -0.2 + 0.35 * hash(index * 19 + k),
      x = cx + Math.cos(out) * Math.cos(up) * cr,
      y = cy + Math.sin(up) * cr * 0.85,
      z = cz + Math.sin(out) * Math.cos(up) * cr,
      spin = hash(index * 23 + k) * Math.PI * 2;
    if (f.kind === 'flowers') {
      // A flat-topped head: one broad floret cushion and two smaller ones tucked under its rim.
      blob(x, y + 0.03 * s, z, 0.15 * s, 0.45, 0.97 + 0.05 * hash(index * 29 + k));
      for (const a of [0, 2.4]) blob(x + Math.cos(spin + a) * 0.13 * s, y - 0.005 * s, z + Math.sin(spin + a) * 0.13 * s, 0.1 * s, 0.5, 0.9);
    } else {
      const r = 0.065 * s;
      // Three berries in a loose triangle and one hanging below them, the lower ones a shade darker.
      for (const [a, dy, shade] of [[0, 0, 1.04], [2.1, -0.4, 0.96], [4.2, -0.3, 1.0], [1.0, -1.7, 0.86]])
        blob(x + Math.cos(spin + a) * (a ? 1.7 * r : 0), y + dy * r, z + Math.sin(spin + a) * (a ? 1.7 * r : 0), r, 1, shade);
    }
  }
  return mergeGeometries(parts)!;
}
/**
 * Silver birch: a slim trunk leaning a little and curving into its lean, cream-white with a few
 * dark marks (a pair of close rows each, dark on part of the round) and a dark foot, under a small,
 * narrow crown held high: one tall oval clump with three small drooping ones (two in winter)
 * spiralling round it on short pale limbs. Separate clumps stacked up the trunk read as topiary.
 */
function birch(t: T.Group, s: number, index: number, look: Look, season: Season, add: AddPart) {
  const H = 2.1 * s,
    lean = (0.07 + 0.07 * hash(index * 11 + 2)) / H,
    bend = (y: number) => lean * y * y,
    radial = 6,
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
    const f = mix(1, 0.6, sstep(y, 1.2 * s, H));
    out[i*3] = c.r*f; out[i*3+1] = c.g*f; out[i*3+2] = c.b*f;
    p.setX(i, p.getX(i) + bend(y));
  }
  trunk.setAttribute('color', new T.BufferAttribute(out, 3));
  add(trunk, 'bark');
  const spin = hash(index * 13) * Math.PI * 2,
    spheres = [[bend(2.05 * s), 2.05 * s, 0, 0.46 * s]],
    sides = [[1.66, 0.34, 0], [1.86, 0.32, 2.3], [2.06, 0.3, 4.4]].filter((_, k) => season !== 'winter' || k !== 1);
  for (const [y0, r, turn] of sides) {
    const a = spin + turn + (hash(index * 13 + turn) - 0.5) * 0.6,
      d = (0.42 + 0.05 * hash(index * 13 + turn + 5)) * s,
      y = (y0 + 0.06 * hash(index * 13 + turn + 9)) * s;
    spheres.push([bend(y) + Math.cos(a) * d, y, Math.sin(a) * d, r * s]);
  }
  const limbs = spheres.slice(1).map(([x, y, z]) => limb(new T.Vector3(bend(y - 0.34 * s), y - 0.34 * s, 0), new T.Vector3(x, y, z), 0.03 * s, 0.02 * s, 5, BIRCH_BARK.body, 0.62));
  add(mergeGeometries(limbs)!, 'bark');
  const geos = spheres.map(([x, y, z, r], k) => droopingLump(r, x, y, z, hash(index + k) * 3, k === 0 ? 1.35 : 1));
  // The ramp starts below the crown: a light, airy crown with no deep underside.
  paintCanopy(geos, spheres, look, look.tones[hash(index * 5 + 1) < 0.5 ? 0 : 1], 1.05 * s, 2.6 * s);
  add(mergeGeometries(geos)!, 'foliage');
  return t;
}
/**
 * Rowan: smaller than the round trees (0.85 of their scale), a grey-brown trunk forking into two
 * limbs, and a rounded, open crown: a top clump over four that stand a little apart. Its fruit
 * (treeFruit) sits on the outer clumps' faces.
 */
function rowan(t: T.Group, size: number, index: number, look: Look, f: TreeFruit | null, add: AddPart, quiet: (g: T.BufferGeometry) => void) {
  const s = 0.85 * size;
  const trunk = new T.CylinderGeometry(0.08*s, 0.115*s, 1.1*s, 8, 2, true).translate(0, 0.55*s, 0);
  const flare = new T.CylinderGeometry(0.115*s, 0.17*s, 0.12*s, 8, 1, true).translate(0, 0.06*s, 0);
  const wood = mergeGeometries([trunk, flare])!;
  paintByHeight(wood, ROWAN_BARK, (y) => y < 0.8*s ? 1.0 : mix(1.0, 0.55, (y - 0.8*s) / (0.3*s)));
  add(wood, 'bark');
  const spheres = [[0, 1.8 * s, 0, 0.52 * s]];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + (hash(index * 13 + k) - 0.5) * 0.5,
      d = (0.52 + 0.06 * hash(index * 13 + k + 5)) * s;
    spheres.push([Math.cos(a) * d, (1.5 + 0.1 * hash(index * 13 + k + 9)) * s, Math.sin(a) * d, (0.38 + 0.05 * hash(index * 13 + k + 2)) * s]);
  }
  const fork = new T.Vector3(0, 0.9 * s, 0);
  add(mergeGeometries([1, 3].map((k) => limb(fork, new T.Vector3(spheres[k][0] * 0.7, spheres[k][1] * 0.95, spheres[k][2] * 0.7), 0.05 * s, 0.032 * s, 6, ROWAN_BARK, 0.7)))!, 'bark');
  const geos = spheres.map(([x, y, z, r], k) => canopyLump(r, 1, x, y, z, hash(index + k) * 3));
  paintCanopy(geos, spheres, look, look.tones[hash(index * 5 + 1) < 0.5 ? 0 : 1], 1.05 * s, 2.3 * s);
  add(mergeGeometries(geos)!, 'foliage');
  if (f) quiet(fruit(spheres, s, index, f));
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
    if (spec.kind === 'rowan')
      return rowan(t, s, index, treeLook(spec, index, season), treeFruit(spec, season), add, (geo) => {
        // Berries and flower heads: small, so they cast no shadow (like the beds' blooms).
        const m = new T.Mesh(geo, material('#ffffff', 'foliage'));
        m.castShadow = false; m.receiveShadow = true; m.userData.noShadow = true; m.userData.fruit = true; t.add(m);
      });
    // A thick flared trunk (about 30% shows below the canopy; the batch bake darkens its base)
    // under a fat main lump and two or three side lumps, painted two-tone in tree space.
    const look = treeLook(spec, index, season);
    const trunk = new T.CylinderGeometry(0.12*s, 0.16*s, 1.15*s, 10, 2, true).translate(0, 0.575*s, 0);
    const flare = new T.CylinderGeometry(0.16*s, 0.25*s, 0.14*s, 10, 1, true).translate(0, 0.07*s, 0);
    const wood = mergeGeometries([trunk, flare])!;
    paintByHeight(wood, TREE.trunk, (y) => y < 0.6*s ? 1.0 : mix(1.0, 0.55, (y - 0.6*s) / (0.55*s)));
    add(wood, 'bark');
    const spheres = [[0, 1.62, 0, 0.9], [0.64, 1.28, 0.24, 0.6], [-0.52, 1.36, -0.34, 0.58]];
    if (s >= 1) spheres.push([0.1, 1.5, 0.66, 0.5]);
    const lumps = spheres.map(([x, y, z, r]) => [x*s, y*s, z*s, r*s]);
    const geos = lumps.map(([x, y, z, r], k) => canopyLump(r, k === 0 ? 2 : 1, x, y, z, hash(index + k) * 3));
    paintCanopy(geos, lumps, look, look.tones[hash(index*5+1) < 0.5 ? 0 : 1], 0.75*s, 2.4*s);
    add(mergeGeometries(geos)!, 'foliage');
    return t;
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
  /** A clipped topiary lump, painted like a canopy. */
  function topiary(g: T.Object3D, x: number, y: number, z: number, r: number, detail: number, sx = 1, sy = 0.9, sz = 1) {
    const geo = new T.IcosahedronGeometry(r, detail); geo.scale(sx, sy, sz);
    paintCanopy([geo], [[0, 0, 0, r]], TREE.round, palette.hedge, -r * sy, r * sy);
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
