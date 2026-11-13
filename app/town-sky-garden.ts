import * as T from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { SurfaceKind } from './city-materials';
import { palette, hash, type TownContext } from './town-shared';
import type { Kit } from './town-kit';
import type { Nature } from './town-nature';
import type { Props } from './town-props';
import { ellipsoid, roundBox, sculpt } from './town-sculpt';

/*
 * The sky island's garden kit: the pieces that make it a "castle in the sky" and a lived-in garden.
 * Nothing in the town calls this module yet; the island's own module places the pieces.
 *
 * Every builder returns a group in a frame of its own (y 0 is the surface the piece stands on, or
 * the point it hangs from) and never moves that group: whoever places it sets its position and
 * turn. What moves hangs inside it on a pivot of its own (`keepSeparate`, batched on its own with no
 * contact shade) and is posed from town time alone through `ctx.animated`, so it holds under Pause
 * and for a visitor who prefers reduced motion, and every piece is posed once at time 0 as it is
 * built. Static parts are merged into one mesh a surface family as they are made; they take their
 * contact shade from the floor the island's own batch is given.
 *
 * Nothing here is two-sided, transparent or cut out, and nothing casts a shadow but the stone and
 * the timber. Every colour is on the vertices (the materials are white), so each family batches as
 * one mesh: stone (with the china and the rocks' turf), timber, brass, and the matte cloth of the
 * water and the clouds.
 */

/**
 * The kit's colours. Each is no more saturated than its palette family (SKY_GARDEN_FAMILY): the
 * falls' water from the pool's muted turquoise through paler and paler aqua to foam white; the
 * clouds' muted white (less saturated than the palette's own) over a cooler, darker base; the
 * spouts' kerb stone and the furniture's pale dressed stone (the villa's); the rocks' greys (the
 * airport armour's) with a little earth, under turf; teak and a darker mahogany; brass, its
 * blackened eyecup and a dark lens; white china with a slate band, scones and a planter's soil.
 */
export const SKY_GARDEN_LOOK = {
  pool: '#5ab4cc',
  poolRim: '#8fd0dc',
  channel: '#a9dbe3',
  pour: '#c3e6ec',
  sheet: '#d6edee',
  foam: '#eef6f3',
  cloud: '#f1f2ee',
  cloudBase: '#ccd4d9',
  kerb: palette.kerb,
  stone: '#ece4d1',
  rock: '#8b8c85',
  rockDark: '#7f847f',
  rockPale: '#97958a',
  earth: '#857768',
  turf: palette.grass,
  turfDark: palette.grassDark,
  teak: palette.wood,
  mahogany: palette.woodDark,
  brass: palette.brass,
  blackened: '#4a4c4b',
  lens: '#58666d',
  china: palette.white,
  band: palette.slate,
  scone: '#d8b98a',
  soil: palette.soil,
};
/** Each colour's palette family: the colour may be no more saturated than it (check-town). */
export const SKY_GARDEN_FAMILY: Record<keyof typeof SKY_GARDEN_LOOK, string> = {
  pool: palette.poolWater,
  poolRim: palette.poolEdge,
  channel: palette.poolEdge,
  pour: palette.poolSurface,
  sheet: palette.poolSurface,
  foam: palette.white,
  cloud: palette.white,
  cloudBase: palette.white,
  kerb: palette.kerb,
  stone: palette.render,
  rock: palette.lead,
  rockDark: palette.lead,
  rockPale: palette.lead,
  earth: palette.soil,
  turf: palette.grass,
  turfDark: palette.grassDark,
  teak: palette.wood,
  mahogany: palette.woodDark,
  brass: palette.brass,
  blackened: palette.metal,
  lens: palette.slate,
  china: palette.white,
  band: palette.slate,
  scone: palette.blonde,
  soil: palette.soil,
};

/**
 * How much darker the clouds, the puffs and the falls go at full night, as the balloon does
 * (town-movers' BALLOON_NIGHT_DIM): they are lit like the town, but they are the pale, round things
 * that hang unshadowed over the dark sea, and under the moon they would read as bright as by day.
 * No glow.
 */
export const SKY_NIGHT_DIM = 0.5;

/**
 * A fall, in its own frame: the origin is the rim point it leaves (the outer edge of the deck's
 * top), +z points out over the sea and y 0 is the deck's top there.
 * - `drop`, `width`: by default, how far below y 0 the fall ends (the middle of its puff) and how
 *   wide its sheet is under the pour. `depth` is the sheet's depth over that width (0.54: softly
 *   rounded, never a ribbon that turns to a hairline seen from its edge), and `flare` its width at
 *   the puff over its width at the top: a veil that spreads as it falls, never a straight post.
 * - `nose`: how far the stone spout reaches past the rim; `bend` the radius the water turns down
 *   over it by (so the sheet hangs `nose` + `bend` - 0.02 out from the rim, over the puff's middle);
 *   `stream` the stream's half-depth in the channel; `basin` the radius of the pool's water (never
 *   less than the channel is wide) and how far its near side lies in from the rim; `kerb` the
 *   kerb's width and its height over the ground under the pool; `level` the water's level over
 *   that ground; `foot` how far the kerb and the sill run on below y 0, so a domed deck never shows
 *   a gap under them.
 * - The lumps (FALL_LUMPS, one cluster every spacing) stand up to `proud` of the sheet's faces; the
 *   pour (the thick water under the bend) covers a cluster by `cover`, for `pour[0]` down from the
 *   bend's end, and has thinned to the sheet by `pour[1]`. The clusters are about `pitch` apart
 *   (fallLayout fits a whole number of them to the drop) and slide one spacing every `period`
 *   seconds; `phase` is where the loop stands at time 0 (lumps mid-fall, one coming out of the
 *   pour).
 * - `puff`: the cloud's radius; `puffRise` and `puffSink` how far it stands over and hangs under
 *   its middle (a flat base); `core` the round middle every puff has (the last cluster and the
 *   sheet's end hide inside it): its radius, and its middle over the puff's.
 */
export const FALL = {
  drop: 4.5,
  width: 0.82,
  depth: 0.54,
  flare: 1.6,
  nose: 0.33,
  bend: 0.36,
  stream: 0.055,
  basin: { back: 0.58, r: 0.5 },
  kerb: { width: 0.16, height: 0.2 },
  level: 0.16,
  foot: 0.12,
  proud: 0.07,
  cover: 0.03,
  pour: [0.86, 1.6] as [number, number],
  pitch: 1.04,
  period: 2.2,
  phase: 0.35,
  puff: 1.3,
  puffRise: 0.85,
  puffSink: 0.62,
  core: { r: 0.8, y: 0.05 },
};
/**
 * A cluster of lumps: swells of foam riding down the sheet, broader than tall. Each is an
 * ellipsoid sunk in a face of the sheet (`side` 1 the face to the sea, -1 the one to the rock)
 * until only its crown stands `proud`, so it meets the sheet at a shallow angle (a pill stuck on
 * the water reads as a rivet): its middle `x` across (in half-widths of the sheet) and `y` over the
 * cluster's own origin, its radii across (in half-widths), up and out. A big one and a small one a
 * face, set off from one another, so the fall reads from either side and no cluster is a ring.
 */
export const FALL_LUMPS = [
  { side: 1, x: -0.14, y: 0, r: [0.8, 0.24, 0.18], proud: 0.07 },
  { side: 1, x: 0.5, y: -0.34, r: [0.42, 0.16, 0.14], proud: 0.055 },
  { side: -1, x: 0.12, y: -0.04, r: [0.8, 0.24, 0.18], proud: 0.07 },
  { side: -1, x: -0.5, y: -0.38, r: [0.42, 0.16, 0.14], proud: 0.055 },
] as const;
/**
 * A fall's measures for a drop, a width and a `rise` (how much higher the deck is under the pool
 * than at the rim: the water lies level, so the spout stands that much taller at the rim): the
 * sheet's half-width and half-depth and the pour's; the channel's half-width; the pool (its water's
 * radius and its middle, inland of the rim); the water's level; `out`, how far from the rim the
 * sheet hangs; `head`, where the bend ends and the fall begins; a cluster's reach over and under
 * its origin; how many clusters there are, how far apart, and the first one's origin at the loop's
 * start (hidden in the pour; the last one, a spacing below its own start at the loop's end, is
 * hidden in the puff's core).
 */
export function fallLayout(drop = FALL.drop, width = FALL.width, rise = 0) {
  const a = width / 2,
    b = a * FALL.depth,
    level = rise + FALL.level,
    head = level - FALL.stream - FALL.bend,
    over = Math.max(...FALL_LUMPS.map((l) => l.y + l.r[1])),
    under = -Math.min(...FALL_LUMPS.map((l) => l.y - l.r[1])),
    first = head - 0.06 - over,
    // The last cluster ends the loop in the puff's core.
    travel = first + drop - FALL.core.y - 0.05,
    count = Math.max(2, Math.round(travel / FALL.pitch)),
    r = Math.max(FALL.basin.r, a + 0.09);
  return { drop, width, rise, a, b, pour: { a: a + 0.05, b: b + FALL.proud + FALL.cover }, channel: a - 0.01, pool: { r, z: -(FALL.basin.back + r) }, level, out: FALL.nose - 0.02 + FALL.bend, head, over, under, first, count, spacing: travel / count };
}
export type FallLayout = ReturnType<typeof fallLayout>;
/** The exponent of the fall's oval (a superellipse): softly rounded, fuller than an ellipse. */
export const FALL_OVAL = 2.5;
/**
 * The fall's oval `d` below the bend's end: its half-width and half-depth. The pour, then the neck
 * thinning to the sheet, then the sheet spreading (FALL.flare) down to its foot in the puff.
 */
export function fallSection(F: FallLayout, d: number) {
  const [p0, p1] = FALL.pour,
    foot = F.head + F.drop + 0.25;
  if (d <= p0) return { a: F.pour.a, b: F.pour.b };
  if (d <= p1) {
    const u = T.MathUtils.smoothstep((d - p0) / (p1 - p0), 0, 1);
    return { a: T.MathUtils.lerp(F.pour.a, F.a, u), b: T.MathUtils.lerp(F.pour.b, F.b, u) };
  }
  return { a: F.a * (1 + (FALL.flare - 1) * Math.min(1, (d - p1) / (foot - p1)) ** 1.15), b: F.b };
}
/** Where a fall's loop stands at `time` (town time): 0 to 1, a spacing's slide. */
export function fallPhase(time: number) {
  const u = time / FALL.period + FALL.phase;
  return u - Math.floor(u);
}

/**
 * A cloud at size 1: about 3.5 long, 1.9 deep and 1.3 tall over its flat base (y 0, its middle the
 * origin). It drifts `drift` either way along its length every `period` seconds and rises and sinks
 * by `bob`, twice as often. `grid` is the spacing of its distance grid (and the puff's): its
 * triangles go as 1 / grid², whatever its size. `fillet` rounds the valleys between its lobes.
 */
export const CLOUD = { drift: 0.4, bob: 0.06, period: 54, grid: 0.168, puffGrid: 0.205, fillet: 0.14 };
/** A cloud's place on its drift at `time`, in units of its size: along its length, and up. */
export function cloudDrift(time: number, seed: number) {
  const a = (time / CLOUD.period) * Math.PI * 2 + hash(seed * 5.3 + 1) * Math.PI * 2;
  return { x: CLOUD.drift * Math.sin(a), y: CLOUD.bob * Math.sin(2 * a + 1.1) };
}

/**
 * A floating rock at size 1: the airport armour's boulder (an icosahedron of `detail` 2, each corner
 * in or out by up to `jitter` / 2, shaded as the smooth rounded block), drawn down below its waist
 * into a blunt point (`taper` of its width left at the tip, the underside `stretch` times as deep),
 * about 2.1 across, 0.8 over its middle (the origin) and 1.6 under it: a chunk with a keel, since
 * from the town's high camera a flat pebble shows only its top. A low cap of turf and three
 * tussocks sit on it. It bobs by `bob` and rocks by `rock` radians every `period` seconds
 * (`periods`, picked by its seed).
 */
export const ROCK = { detail: 2, jitter: 0.08, taper: 0.3, stretch: 2, bob: 0.12, rock: 0.035, periods: [9, 10.5, 12] };
/** A rock's pose at `time`: how far it has risen (in units of its size) and how it tips, and its period. */
export function rockBob(time: number, seed: number) {
  const period = ROCK.periods[Math.floor(hash(seed * 3.7 + 2) * ROCK.periods.length) % ROCK.periods.length],
    a = (time / period) * Math.PI * 2 + hash(seed * 9.1 + 4) * Math.PI * 2;
  return { y: ROCK.bob * Math.sin(a), tip: ROCK.rock * Math.sin(a + 1.3), roll: ROCK.rock * 0.8 * Math.sin(a + 2.9), period };
}

/**
 * The tea table's measures. `seat` is the chairs' seat height, the town's park bench's (town-props'
 * bench: slats centred 0.405 up, 0.07 thick), which the island's seated figure assumes. The table
 * is `top` high and `radius` across; a chair's seat is `chair.w` wide and `chair.d` deep, its front
 * edge `gap` from the table's edge, its back's rail from `rail[0]` to `rail[1]` up and leaning back
 * by `rake`. A sitter's hips go `setback` behind the seat's front edge.
 */
export const TEA = {
  seat: 0.44,
  top: 0.665,
  radius: 0.42,
  gap: 0.1,
  chair: { w: 0.44, d: 0.42, leg: 0.08, slab: 0.08 },
  rail: [0.63, 0.84] as [number, number],
  rake: 0.1,
  setback: 0.09,
};

/**
 * The telescope. A resident's eyes are `eye` up (and `eyeOut` in front of the body's axis), the
 * hips `hip`; stooped from the hips by the tube's `tilt` (0.42, 24 degrees below level, so the
 * line of sight runs straight down the tube to the town below), the eye comes down to 0.676, and
 * the eyepiece's end is `relief` further along the line of sight: 0.65 up, the default `eyepiece`.
 * The tube is `length` long and turns on its mount `pivot` from the eye end, over the tripod's
 * middle; its eye end is `barrel` in radius (a hand either side cradles it), its objective `hood`.
 * The tripod's feet stand `spread` from its middle.
 */
export const TELESCOPE = {
  eye: 0.772,
  eyeOut: 0.137,
  hip: 0.31,
  tilt: 0.42,
  relief: 0.06,
  length: 0.735,
  pivot: 0.36,
  barrel: 0.04,
  hood: 0.072,
  spread: 0.27,
};
/** The eyepiece's height for a figure stooped by `tilt`, and how far in front of the figure's root its end is. */
export function telescopeEyepiece(tilt = TELESCOPE.tilt) {
  const { eye, eyeOut, hip, relief } = TELESCOPE,
    up = eye - hip;
  return { height: hip + up * Math.cos(tilt) - (eyeOut + relief) * Math.sin(tilt), standOff: up * Math.sin(tilt) + (eyeOut + relief) * Math.cos(tilt) };
}

/** A garden lamp: a frosted globe `globe` in radius on a brass cup, on a short stone pier; `height` is its top. */
export const GARDEN_LAMP = { base: 0.3, shaft: 0.22, cap: 0.49, cup: 0.13, globe: 0.135, height: 0.86 };
/** An urn: `height` to its rim on a square plinth `plinth` across; a planted ball of radius `plant.r` sits with its foot at `plant.y`. */
export const URN = { plinth: 0.44, height: 0.635, plant: { y: 0.585, r: 0.3 } };

type V3 = [number, number, number];
type Look = keyof typeof SKY_GARDEN_LOOK;
/** One step of a turned profile: radius r at height y; `sharp` breaks the shading there (an arris). */
type Turn = { r: number; y: number; sharp?: boolean };
/**
 * A profile swept round the y axis (town-props' turned, copied: its private helpers stay its own):
 * smooth up the profile except at a `sharp` step, and smooth all the way round. Trace a solid's
 * section anticlockwise (out along its foot, up its side, in over its top), so every face looks
 * out; a profile that starts and ends on the axis is closed.
 */
function turned(profile: Turn[], sides: number) {
  const seg = profile.slice(1).map((q, i) => {
    const dr = q.r - profile[i].r,
      dy = q.y - profile[i].y,
      l = Math.hypot(dr, dy) || 1;
    return [dy / l, -dr / l];
  });
  const rings = profile.map((p, i) => {
    const lo = seg[i - 1],
      hi = seg[i];
    if (!lo || !hi || p.sharp) return { below: lo ?? hi, above: hi ?? lo };
    const n = [lo[0] + hi[0], lo[1] + hi[1]],
      l = Math.hypot(n[0], n[1]) || 1,
      r = [n[0] / l, n[1] / l];
    return { below: r, above: r };
  });
  const pos: number[] = [],
    nor: number[] = [];
  const vert = (p: Turn, a: number, n: number[]) => {
    pos.push(p.r * Math.cos(a), p.y, -p.r * Math.sin(a));
    nor.push(Math.cos(a) * n[0], n[1], -Math.sin(a) * n[0]);
  };
  for (let k = 0; k < sides; k++) {
    const a0 = (k / sides) * Math.PI * 2,
      a1 = ((k + 1) / sides) * Math.PI * 2;
    for (let i = 0; i < profile.length - 1; i++) {
      const p = profile[i],
        q = profile[i + 1],
        np = rings[i].above,
        nq = rings[i + 1].below;
      // On the axis a quad is one triangle.
      if (p.r > 1e-9) {
        vert(p, a0, np);
        vert(p, a1, np);
        vert(q, a1, nq);
      }
      if (q.r > 1e-9) {
        vert(p, a0, np);
        vert(q, a1, nq);
        vert(q, a0, nq);
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  return geometry;
}
/** A profile from (radius, height) pairs; a third entry marks an arris. */
const turns = (points: number[][]): Turn[] => points.map(([r, y, sharp]) => ({ r, y, sharp: !!sharp }));
/** An ellipsoid of radii r (city-people's blob): a sphere of `seg` segments round, scaled, so its normals are the ellipsoid's own. */
function blob(r: V3, seg = 12, rows = Math.max(5, Math.round(seg * 0.6))) {
  return new T.SphereGeometry(1, seg, rows).scale(r[0], r[1], r[2]);
}
/** A small smooth blob of 20 triangles (the flower beds' bloom): fine for things a tenth of a unit across. */
function pebble(r: V3) {
  const g = new T.IcosahedronGeometry(1, 0);
  g.setAttribute('normal', g.getAttribute('position').clone());
  g.deleteAttribute('uv');
  return g.scale(r[0], r[1], r[2]);
}
const ONE = new T.Vector3(1, 1, 1);
const placed = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), ONE);
const smooth = T.MathUtils.smoothstep,
  lerp = T.MathUtils.lerp;

/** A part's colour: one hex, or a colour for each vertex from its position and normal in the part's own frame. */
type Tint = string | ((p: T.Vector3, n: T.Vector3, out: T.Color) => void);
/** A part of a merged mesh: a geometry (in its own frame), its colour there (its own vertex colours when none is given), and where it goes. */
type Part = { geometry: T.BufferGeometry; tint?: Tint; matrix?: T.Matrix4 };
/** Parts as one geometry: positions, normals and the colours on the vertices. */
function fuse(parts: Part[]) {
  const c = new T.Color(),
    p = new T.Vector3(),
    n = new T.Vector3();
  const list = parts.map(({ geometry, tint, matrix }) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && (tint || name !== 'color')) g.deleteAttribute(name);
    if (tint) {
      const q = g.getAttribute('position'),
        m = g.getAttribute('normal'),
        out = new Float32Array(q.count * 3);
      if (typeof tint === 'string') c.set(tint);
      for (let i = 0; i < q.count; i++) {
        if (typeof tint !== 'string') tint(p.fromBufferAttribute(q, i), n.fromBufferAttribute(m, i), c);
        c.toArray(out, i * 3);
      }
      g.setAttribute('color', new T.BufferAttribute(out, 3));
    }
    return matrix ? g.applyMatrix4(matrix) : g;
  });
  const merged = mergeGeometries(list)!;
  list.forEach((g) => g.dispose());
  return merged;
}
/** A colour between two looks: `a` where f is 0, `b` where it is 1, times `tone`. */
const shadeA = new T.Color(),
  shadeB = new T.Color();
function blend(out: T.Color, a: string, b: string, f: number, tone = 1) {
  out.copy(shadeA.set(a)).lerp(shadeB.set(b), T.MathUtils.clamp(f, 0, 1)).multiplyScalar(tone);
}
/** A look a shade lighter or darker all over (as separate boards and stones are). */
const toned =
  (look: string, tone: number): Tint =>
  (_p, _n, c) => {
    c.set(look).multiplyScalar(tone);
  };

/**
 * A soft, matte toy cloud: round lobes blended into one another in a distance grid (town-sculpt),
 * cut flat underneath with a rounded edge, so it is one closed, smooth form with exact normals: its
 * lobes part in soft valleys, never in a crease. Its paint: the cloud's white on top; a cooler,
 * darker base underneath and low on its sides; and deeper in the valleys between lobes (read from
 * the field itself: how soon a step out along the normal meets another lobe), which is what parts
 * the lobes under the town's flat daylight.
 */
function cloudGeometry(lobes: { c: V3; r: V3 }[], fillet: number, h: number, base: number) {
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (const { c, r } of lobes)
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], c[a] - r[a]);
      hi[a] = Math.max(hi[a], c[a] + r[a]);
    }
  const pad = fillet + 3 * h,
    s = sculpt([lo[0] - pad, base - 3 * h, lo[2] - pad], [hi[0] + pad, hi[1] + pad, hi[2] + pad], h);
  lobes.forEach(({ c, r }, i) => s.add(ellipsoid(c, r), i ? fillet : 0));
  s.cut(roundBox([(lo[0] + hi[0]) / 2, base - 4, (lo[2] + hi[2]) / 2], [hi[0] - lo[0] + 4, 4, hi[2] - lo[2] + 4], 0), fillet * 0.8);
  const geometry = s.mesh(),
    p = geometry.getAttribute('position'),
    n = geometry.getAttribute('normal'),
    colour = new Float32Array(p.count * 3),
    c = new T.Color(),
    top = hi[1],
    reach = 2.2 * h;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i),
      ny = n.getY(i),
      // 1 in the open, less in a valley: how far the field has opened a step out along the normal.
      open = smooth(s.exact(x + n.getX(i) * reach, y + ny * reach, z + n.getZ(i) * reach) / reach, 0.3, 0.95),
      lit = (0.5 * smooth((y - base) / (top - base), 0, 0.55) + 0.5 * smooth(ny, -0.6, 0.35)) * lerp(0.45, 1, open);
    blend(c, SKY_GARDEN_LOOK.cloudBase, SKY_GARDEN_LOOK.cloud, lit, lerp(0.86, 1, open));
    c.toArray(colour, i * 3);
  }
  geometry.setAttribute('color', new T.BufferAttribute(colour, 3));
  return geometry;
}
/**
 * A cloud's lobes at size 1 over a flat base at y 0, each a ball sunk a little in the base: a big
 * dome off the middle, a lower one either side, a small one at either end, and one in front and
 * one behind, so its outline is scalloped from every side.
 */
function cloudLobes(seed: number, size: number): { c: V3; r: V3 }[] {
  const j = (k: number, a: number) => (hash(seed * 17.3 + k * 3.71) - 0.5) * 2 * a,
    flip = hash(seed * 2.9 + 7) < 0.5 ? -1 : 1,
    ball = (x: number, z: number, r: number, k: number, lift = 0.72): { c: V3; r: V3 } => {
      const q = r * (1 + j(k, 0.07));
      return { c: [(x * flip + j(k + 1, 0.06)) * size, q * lift * size, (z + j(k + 2, 0.06)) * size], r: [q * 1.04 * size, q * 0.96 * size, q * size] };
    };
  return [ball(-0.1, 0, 0.72, 10, 0.8), ball(0.94, 0.06, 0.5, 20, 0.78), ball(-1.06, -0.05, 0.47, 30, 0.78), ball(1.52, -0.04, 0.33, 40), ball(-1.6, 0.05, 0.31, 50), ball(0.36, 0.56, 0.4, 60), ball(-0.5, -0.54, 0.42, 70)];
}
/**
 * A puff's lobes about its middle (the origin): the round core every puff has, five balls round
 * it and a bump on its shoulder, over a flat base.
 */
function puffLobes(seed: number, R: number): { c: V3; r: V3 }[] {
  const k = R / FALL.puff,
    j = (i: number, a: number) => (hash(seed * 13.1 + i * 2.37) - 0.5) * 2 * a,
    turn = hash(seed * 4.3 + 9) * Math.PI * 2,
    out: { c: V3; r: V3 }[] = [{ c: [0, FALL.core.y * k, 0], r: [FALL.core.r * k, FALL.core.r * k, FALL.core.r * k] }];
  for (let i = 0; i < 5; i++) {
    const a = turn + (i / 5) * Math.PI * 2 + j(i, 0.2),
      d = (0.74 + j(i + 5, 0.05)) * k,
      r = (0.52 + j(i + 10, 0.06)) * k;
    out.push({ c: [Math.cos(a) * d, (-0.17 + j(i + 15, 0.06)) * k, Math.sin(a) * d], r: [r, r * 0.94, r] });
  }
  out.push({ c: [Math.cos(turn + 0.6) * 0.42 * k, 0.5 * k, Math.sin(turn + 0.6) * 0.42 * k], r: [0.42 * k, 0.4 * k, 0.42 * k] });
  return out;
}

/* ------------------------------------------------------------------ */
/* The garden kit                                                      */
/* ------------------------------------------------------------------ */
export function createSkyGarden(ctx: TownContext, kit: Kit, _props: Props, nature: Nature) {
  const { material, animated, lamps } = ctx;
  const { chamfered, lampGlass } = kit;
  const L = SKY_GARDEN_LOOK;

  /**
   * Parts as one mesh in g, its colours on the vertices; `looks` names the kit's colours it wears
   * (the checks hold its vertices to them). Stone and timber cast; a `band` is never an overhang.
   */
  function solid(g: T.Object3D, parts: Part[], kind: SurfaceKind, name: string, looks: Look[], opts: { shadow?: boolean; band?: boolean } = {}) {
    const m = new T.Mesh(fuse(parts), material('#ffffff', kind));
    m.name = name;
    m.userData.looks = looks;
    const shadow = opts.shadow ?? true;
    m.castShadow = shadow;
    m.receiveShadow = true;
    if (!shadow) m.userData.noShadow = true;
    if (opts.band ?? true) m.userData.band = true;
    g.add(m);
    return m;
  }
  /** A pivot for a moving part: batched on its own, never with what it hangs in. */
  function pivot(g: T.Object3D, name: string) {
    const p = new T.Group();
    p.name = name;
    p.userData.keepSeparate = true;
    g.add(p);
    return p;
  }
  /**
   * The pale parts' night: once batched, a pivot's meshes take the kit's own copy of the batch
   * material they share (the same shader program, one copy for the whole kit), so their colour can
   * follow the night without darkening everything else made of cloth (the balloon's way). They
   * take no shadow either: a cloud half in the island's shadow reads as a grey boulder.
   */
  const own = new Map<T.Material, T.MeshStandardMaterial>();
  function dim(g: T.Object3D, night: number) {
    const f = 1 - SKY_NIGHT_DIM * night;
    for (const part of g.children) {
      if (!(part instanceof T.Mesh) || !(part.material instanceof T.MeshStandardMaterial) || !part.material.vertexColors) continue;
      if (!part.material.userData.skyGardenOwn) {
        const shared = part.material;
        let copy = own.get(shared);
        if (!copy) {
          copy = shared.clone();
          copy.onBeforeCompile = (shader, renderer) => shared.onBeforeCompile(shader, renderer);
          copy.customProgramCacheKey = () => shared.customProgramCacheKey();
          copy.userData.skyGardenOwn = true;
          own.set(shared, copy);
        }
        part.material = copy;
        part.receiveShadow = false;
      }
      part.material.color.setScalar(f);
    }
  }

  /* ---------------------------------------------------------------- */
  /* The falls                                                         */
  /* ---------------------------------------------------------------- */
  /**
   * The spout's stone, one mesh: a kerb in one sweep from the spout's nose back along the channel,
   * round the pool and forward again (a keyhole seen from above), its top softly rounded, and the
   * sill the water runs over, its nose just inside the kerb's ends. Both run on below y 0 inside
   * the rim; past the rim the spout is a slab under the water.
   */
  function spout(g: T.Object3D, F: FallLayout) {
    const half = F.channel + 0.02, // the channel's half-width
      kw = FALL.kerb.width / 2,
      line = half + kw, // the kerb's middle
      ring = F.pool.r + kw,
      top = F.rise + FALL.kerb.height,
      under = F.rise - 0.03,
      end = FALL.nose,
      // The straight runs meet the ring where the ring is as far out as they are.
      a0 = Math.asin(line / ring),
      join = F.pool.z + ring * Math.cos(a0),
      path: { x: number; z: number; nx: number; nz: number; foot: number }[] = [];
    // From the right-hand end back to the pool, round it, and forward on the left.
    path.push({ x: line, z: end, nx: 1, nz: 0, foot: under }, { x: line, z: 0.02, nx: 1, nz: 0, foot: under }, { x: line, z: -0.02, nx: 1, nz: 0, foot: -FALL.foot });
    const N = 16;
    for (let k = 0; k <= N; k++) {
      const a = a0 + ((Math.PI * 2 - 2 * a0) * k) / N;
      path.push({ x: ring * Math.sin(a), z: F.pool.z + ring * Math.cos(a), nx: Math.sin(a), nz: Math.cos(a), foot: -FALL.foot });
    }
    path.push({ x: -line, z: -0.02, nx: -1, nz: 0, foot: -FALL.foot }, { x: -line, z: 0.02, nx: -1, nz: 0, foot: under }, { x: -line, z: end, nx: -1, nz: 0, foot: under });
    const section = (foot: number): [number, number][] => [[-kw, foot], [-kw, top - 0.05], [-kw + 0.03, top], [kw - 0.03, top], [kw, top - 0.05], [kw, foot]],
      pos: number[] = [],
      index: number[] = [],
      W = 6;
    for (const s of path) for (const [o, y] of section(s.foot)) pos.push(s.x + s.nx * o, y, s.z + s.nz * o);
    for (let k = 0; k + 1 < path.length; k++)
      for (let i = 0; i + 1 < W; i++) {
        const a = k * W + i,
          b = (k + 1) * W + i;
        index.push(a, a + 1, b, a + 1, b + 1, b);
      }
    const kerb = new T.BufferGeometry();
    kerb.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    kerb.setIndex(index);
    kerb.computeVertexNormals();
    // Its two ends, flat: a fan each, facing out over the sea.
    const ends: number[] = [];
    for (const [k, flip] of [[0, false], [path.length - 1, true]] as const) {
      const pts = section(path[k].foot).map(([o, y]) => [path[k].x + path[k].nx * o, y, path[k].z]);
      for (let i = 1; i + 1 < pts.length; i++) ends.push(...pts[0], ...(flip ? pts[i] : pts[i + 1]), ...(flip ? pts[i + 1] : pts[i]));
    }
    const caps = new T.BufferGeometry();
    caps.setAttribute('position', new T.Float32BufferAttribute(ends, 3));
    caps.setAttribute('normal', new T.Float32BufferAttribute(ends.map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
    const sillTop = F.rise + 0.07,
      sillHalf = half + 0.04,
      m = solid(
        g,
        [
          { geometry: kerb, tint: L.kerb },
          { geometry: caps, tint: L.kerb },
          // The sill's body under the channel, and its nose over the rim.
          { geometry: chamfered(2 * sillHalf, sillTop + FALL.foot, 0.02 - join + 0.1), tint: L.kerb, matrix: placed(0, (sillTop - FALL.foot) / 2, (0.02 + join - 0.1) / 2) },
          { geometry: chamfered(2 * sillHalf, sillTop - under, FALL.nose + 0.045), tint: L.kerb, matrix: placed(0, (sillTop + under) / 2, (FALL.nose - 0.055) / 2) },
        ],
        'stone',
        'sky-fall-spout',
        ['kerb'],
      );
    kerb.dispose();
    caps.dispose();
    return m;
  }
  /** The pool's paint at (x, z) from its middle: turquoise there, paler toward its kerb (R). */
  const poolTint = (x: number, z: number, R: number, c: T.Color) => blend(c, L.pool, L.poolRim, smooth(Math.hypot(x, z) / R, 0.25, 1));
  /**
   * The stream: one tube swept from the pool along the channel, down over the sill's nose in a
   * quarter turn and on down to the puff, its section a soft-cornered oval laid across the flow
   * (flat in the channel, thick in the pour under the bend, then the sheet, which spreads as it
   * falls: fallSection). Its paint runs from the pool's own turquoise through paler aqua to foam at
   * its foot, and down the fall every few columns of vertices are a shade bluer: soft streaks, in
   * the geometry's own colours, so nothing scrolls and nothing can crawl.
   */
  function streamGeometry(F: FallLayout, seed: number) {
    type Station = { z: number; y: number; nz: number; ny: number; a: number; b: number; e: number; from: string; to: string; f: number; streak: number; pool?: boolean };
    const yc = F.level - FALL.stream,
      z0 = FALL.nose - 0.02,
      R = FALL.bend,
      foot = -F.drop - 0.25,
      stations: Station[] = [],
      flat = { nz: 0, ny: 1, a: F.channel, e: 5, streak: 0 };
    // Out of the pool (its end just under the pool's own surface, in the pool's own paint) and along the channel.
    stations.push({ ...flat, z: F.pool.z + 0.2, y: F.level - 0.045, b: 0.03, from: L.poolRim, to: L.poolRim, f: 0, pool: true });
    for (const [z, f] of [[F.pool.z + 0.42, 0], [(F.pool.z + z0) / 2 + 0.2, 0.55], [z0, 1]]) stations.push({ ...flat, z, y: yc, b: FALL.stream, from: L.poolRim, to: L.channel, f, pool: f === 0 });
    // Over the nose: a quarter turn, thickening into the pour.
    const B = 6;
    for (let k = 1; k <= B; k++) {
      const t = k / B,
        th = (t * Math.PI) / 2,
        u = smooth(t, 0, 1);
      stations.push({ z: z0 + R * Math.sin(th), y: F.head + R * Math.cos(th), nz: Math.sin(th), ny: Math.cos(th), a: lerp(F.channel, F.pour.a, u), b: lerp(FALL.stream, F.pour.b, u), e: lerp(5, FALL_OVAL, u), from: L.channel, to: L.pour, f: t, streak: u });
    }
    // The pour, the neck, and the sheet spreading down to its foot in the puff.
    const [p0, p1] = FALL.pour,
      fall = (d: number) => stations.push({ z: F.out, y: F.head - d, nz: 1, ny: 0, ...fallSection(F, d), e: FALL_OVAL, from: L.sheet, to: L.foam, f: smooth(d, p1, F.head - foot), streak: 1 });
    for (const d of [p0 / 2, p0]) fall(d);
    for (const t of [0.25, 0.5, 0.75, 1]) fall(p0 + (p1 - p0) * t);
    const N = Math.max(3, Math.round((F.head - p1 - foot) / 0.7));
    for (let k = 1; k <= N; k++) fall(p1 + ((F.head - p1 - foot) * k) / N);
    // The pour is still the pour's colour: its sheet tone comes in down the neck.
    for (const s of stations) if (s.nz === 1 && F.head - s.y < p1 + 1e-6) Object.assign(s, { from: L.pour, to: L.sheet, f: smooth(F.head - s.y, p0 * 0.5, p1) });
    const M = 14,
      pos: number[] = [],
      col: number[] = [],
      index: number[] = [],
      c = new T.Color(),
      blue = new T.Color(L.channel),
      streaks = Array.from({ length: M }, (_, i) => (hash(seed * 7.7 + i * 3.3) > 0.56 ? 0.3 + 0.3 * hash(seed * 1.9 + i * 5.1) : 0));
    for (const s of stations)
      for (let i = 0; i < M; i++) {
        const phi = ((i + 0.5) / M) * Math.PI * 2,
          cx = Math.sign(Math.cos(phi)) * Math.abs(Math.cos(phi)) ** (2 / s.e),
          sw = Math.sign(Math.sin(phi)) * Math.abs(Math.sin(phi)) ** (2 / s.e);
        pos.push(s.a * cx, s.y + s.b * sw * s.ny, s.z + s.b * sw * s.nz);
        if (s.pool) poolTint(s.a * cx, s.z - F.pool.z, F.pool.r + 0.02, c);
        else blend(c, s.from, s.to, s.f);
        c.lerp(blue, streaks[i] * s.streak * (1 - 0.5 * (s.nz === 1 ? smooth(F.head - s.y, p1, F.head - foot) : 0)));
        col.push(c.r, c.g, c.b);
      }
    // The oval runs from the flow's right over its top to its left, so these faces look out.
    for (let k = 0; k + 1 < stations.length; k++)
      for (let i = 0; i < M; i++) {
        const a = k * M + i,
          b = k * M + ((i + 1) % M);
        index.push(a, b, a + M, b, b + M, a + M);
      }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
  }
  /**
   * The water that stands still, one mesh on a pivot of its own (it dims at night): the pool, a low
   * dome inside its kerb; the stream (streamGeometry); and the puff the fall ends in.
   */
  function stillWater(g: T.Object3D, F: FallLayout, seed: number) {
    const y0 = F.level,
      R = F.pool.r + 0.02;
    return solid(
      g,
      [
        {
          // Nearly level out to the kerb, where it turns down out of sight: the stream leaves it with no step.
          geometry: turned(turns([[R, y0 - 0.085], [R * 0.965, y0 - 0.022], [R * 0.9, y0 - 0.007], [0, y0 - 0.003]]), 16),
          tint: (p, _n, c) => poolTint(p.x, p.z, R, c),
          matrix: placed(0, 0, F.pool.z),
        },
        { geometry: streamGeometry(F, seed) },
        { geometry: cloudGeometry(puffLobes(seed, FALL.puff), CLOUD.fillet, CLOUD.puffGrid, -FALL.puffSink), matrix: placed(0, -F.drop, F.out) },
      ],
      'fabric',
      'sky-fall-water',
      ['pool', 'poolRim', 'channel', 'pour', 'sheet', 'foam', 'cloud', 'cloudBase'],
      { shadow: false },
    );
  }
  /**
   * The lumps, one mesh on a pivot inside the still water's: `count` clusters alike (FALL_LUMPS), a
   * spacing apart down the sheet, each lump a smooth ellipsoid half sunk in one of the sheet's
   * faces, foam white on top and the sheet's own tone where it meets the sheet.
   */
  function lumps(g: T.Object3D, F: FallLayout) {
    const parts: Part[] = [],
      big = blob([1, 1, 1], 12, 6),
      small = blob([1, 1, 1], 8, 5);
    for (let k = 0; k < F.count; k++)
      for (const l of FALL_LUMPS) {
        const [rx, ry, rz] = l.r,
          sink = rz - l.proud;
        parts.push({
          geometry: rx > 0.5 ? big : small,
          // The sheet's own tone where it leaves the sheet, foam on its crown.
          tint: (q, _n, c) => blend(c, L.sheet, L.foam, smooth(q.z * l.side, sink / rz - 0.05, 0.97)),
          matrix: new T.Matrix4().compose(new T.Vector3(l.x * F.a, F.first - k * F.spacing + l.y, l.side * (F.b - sink)), new T.Quaternion().setFromEuler(new T.Euler(0, 0, l.side * 0.1)), new T.Vector3(rx * F.a, ry, rz)),
        });
      }
    const m = solid(g, parts, 'fabric', 'sky-fall-lumps', ['sheet', 'foam'], { shadow: false });
    big.dispose();
    small.dispose();
    return m;
  }
  /**
   * A short waterfall: it leaves the deck's rim over a stone spout fed by a small pool (so the
   * water has a source) and ends `drop` below the deck in a matte cloud puff; no water reaches the
   * sea. The water is opaque and matte: a softly rounded oval sheet `width` across and about half
   * as deep, spreading as it falls, in pale colours on its vertices. A few chunky lumps slide down
   * it in a loop: the one mesh moves a spacing down and back (fallPhase), the cluster beyond either
   * end hidden in the thick pour under the lip and in the puff. Nothing scrolls in a shader, so
   * nothing can crawl. Stand its origin on the rim's outer edge at the deck's top, +z out over the
   * sea; `rise` is how much higher the deck is under the pool (its middle 1.08 in from the rim)
   * than at the rim; `seed` picks the puff's lobes and the streaks.
   */
  function fall({ drop = FALL.drop, width = FALL.width, rise = 0, seed = 1 }: { drop?: number; width?: number; rise?: number; seed?: number } = {}) {
    const F = fallLayout(drop, width, rise),
      g = new T.Group();
    g.name = 'sky-fall';
    g.userData.fall = F;
    spout(g, F);
    const water = pivot(g, 'sky-fall-still');
    stillWater(water, F, seed);
    const moving = pivot(water, 'sky-fall-moving');
    moving.position.z = F.out;
    lumps(moving, F);
    const settle = (_time: number, night = 0) => dim(water, night),
      slide = (time: number, night = 0) => {
        moving.position.y = -fallPhase(time) * F.spacing;
        dim(moving, night);
      };
    settle(0, 0);
    slide(0, 0);
    animated.push({ object: water, update: settle }, { object: moving, update: slide });
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* Clouds and floating rocks                                         */
  /* ---------------------------------------------------------------- */
  /**
   * A soft, matte, opaque toy cloud (cloudGeometry), about 3.6 x 2 x 1.3 at size 1, its flat base
   * at y 0 and its middle on the origin, long along x. It drifts a little along its length and
   * rises and sinks (cloudDrift), dims at night on the kit's own material, and casts nothing.
   */
  function cloud({ size = 1, seed = 1 }: { size?: number; seed?: number } = {}) {
    const g = new T.Group();
    g.name = 'sky-cloud';
    const drift = pivot(g, 'sky-cloud-drift');
    solid(drift, [{ geometry: cloudGeometry(cloudLobes(seed, size), CLOUD.fillet * size, CLOUD.grid * size, 0) }], 'fabric', 'sky-cloud-body', ['cloud', 'cloudBase'], { shadow: false });
    const update = (time: number, night = 0) => {
      const d = cloudDrift(time, seed);
      drift.position.set(d.x * size, d.y * size, 0);
      dim(drift, night);
    };
    update(0, 0);
    animated.push({ object: drift, update });
    return g;
  }
  /** The armour stones' shape (ROCK.detail): an icosahedron with its corners merged, so a corner moved moves every face round it. */
  let stone: T.BufferGeometry | null = null;
  /**
   * A floating rock's geometry (the airport armour's boulder, copied whole with its analytic
   * normals, then drawn down to a blunt point): the rounded block's own normals carried through the
   * squash and the taper, so it shades as one smooth chunk and no facet shows.
   */
  function rockGeometry(size: number, seed: number) {
    stone ??= mergeVertices(new T.IcosahedronGeometry(1, ROCK.detail).deleteAttribute('normal').deleteAttribute('uv'));
    const h = (k: number) => hash(seed * 7.31 + k * 1.913),
      geometry = stone.clone(),
      p = geometry.getAttribute('position'),
      normals = new Float32Array(p.count * 3),
      n = new T.Vector3(),
      square = 0.3 + 0.35 * h(1),
      sx = size * (0.95 + 0.2 * h(2)),
      sy = size * (0.72 + 0.16 * h(3)),
      sz = size * (0.85 + 0.2 * h(4));
    for (let i = 0; i < p.count; i++) {
      const ux = p.getX(i),
        uy = p.getY(i),
        uz = p.getZ(i),
        block = (ux ** 4 + uy ** 4 + uz ** 4) ** -0.25,
        k = (1 + square * (block - 1)) * (1 + ROCK.jitter * (hash(seed * 31.7 + i * 3.17) - 0.5));
      // The rounded block's normal, through the squash.
      n.set(ux ** 3, uy ** 3, uz ** 3).normalize().multiplyScalar(square).add(new T.Vector3(ux, uy, uz).multiplyScalar(1 - square)).normalize();
      n.set(n.x / sx, n.y / sy, n.z / sz);
      let x = ux * k * sx,
        y = uy * k * sy,
        z = uz * k * sz;
      if (y < 0) {
        // Below the waist: narrower and deeper toward the tip; the normal follows the taper.
        const t = Math.min(1, -y / sy),
          s = 1 - (1 - ROCK.taper) * t ** 1.4,
          ds = ((1 - ROCK.taper) * 1.4 * t ** 0.4) / sy,
          dy = 1 + 2 * (ROCK.stretch - 1) * t;
        n.set(n.x / s, (n.y - (ds * (x * n.x + z * n.z)) / s) / dy, n.z / s);
        y *= 1 + (ROCK.stretch - 1) * t;
        x *= s;
        z *= s;
      }
      p.setXYZ(i, x, y, z);
      n.normalize().toArray(normals, i * 3);
    }
    geometry.setAttribute('normal', new T.BufferAttribute(normals, 3));
    return { geometry, sx, sy, sz };
  }
  /**
   * A small floating rock (rockGeometry) with a low cap of turf and three tussocks on top, one mesh:
   * its greys are the armour's, lighter toward the top, with a band of earth under the turf. Its
   * origin is its middle: at size 1 it is about 2.1 across and reaches 0.8 up and 1.6 down. It bobs
   * and rocks slowly on town time (rockBob) and casts nothing.
   */
  function floatingRock({ size = 0.6, seed = 1 }: { size?: number; seed?: number } = {}) {
    const g = new T.Group();
    g.name = 'sky-rock';
    const bob = pivot(g, 'sky-rock-bob'),
      h = (k: number) => hash(seed * 5.77 + k * 2.31),
      { geometry, sx, sy, sz } = rockGeometry(size, seed),
      grey = [L.rock, L.rockDark, L.rockPale][Math.floor(h(1) * 3) % 3],
      tone = 0.94 + 0.12 * h(2),
      tip = -sy * ROCK.stretch,
      turn = placed(0, 0, 0, 0.16 * (h(3) - 0.5), h(4) * Math.PI * 2, 0.16 * (h(5) - 0.5)),
      tuft = Math.max(0.05, 0.15 * size),
      parts: Part[] = [
        { geometry, tint: (p, _n, c) => blend(c, grey, L.earth, 0.75 * smooth(p.y, -0.15 * sy, 0.6 * sy), tone * lerp(0.8, 1.04, smooth(p.y, tip, sy))), matrix: turn },
        // The turf: a low dome sunk in the top, so only its crown shows over the stone.
        {
          geometry: new T.SphereGeometry(1, 14, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.76 * sx, 0.32 * size, 0.76 * sz),
          tint: (p, _n, c) => blend(c, L.turfDark, L.turf, smooth(p.y, 0.1 * size, 0.3 * size)),
          matrix: turn.clone().multiply(placed(0, sy - 0.2 * size, 0)),
        },
      ];
    for (let k = 0; k < 3; k++) {
      const a = h(6) * Math.PI * 2 + k * 2.1 + 0.5 * (h(7 + k) - 0.5),
        d = 0.3 + 0.12 * h(10 + k),
        q = Math.max(0.055, tuft * (1 - 0.2 * k));
      parts.push({ geometry: pebble([q, q * 0.85, q]), tint: k % 2 ? L.turfDark : L.turf, matrix: turn.clone().multiply(placed(Math.cos(a) * d * sx, sy + 0.05 * size, Math.sin(a) * d * sz, 0, h(13 + k) * 3, 0)) });
    }
    solid(bob, parts, 'stone', 'sky-rock-body', ['rock', 'rockDark', 'rockPale', 'earth', 'turf', 'turfDark'], { shadow: false });
    geometry.dispose();
    g.userData.period = rockBob(0, seed).period;
    const update = (time: number) => {
      const b = rockBob(time, seed);
      bob.position.y = b.y * size;
      bob.rotation.set(b.tip, 0, b.roll);
    };
    update(0);
    animated.push({ object: bob, update });
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* Garden furniture                                                  */
  /* ---------------------------------------------------------------- */
  /** A garden chair's timber, its seat's middle on the origin's upright and its front to +z: four legs, a thick seat, two raked posts and one broad rail. */
  function chair(at: T.Matrix4): Part[] {
    const C = TEA.chair,
      x = C.w / 2 - C.leg / 2 - 0.01,
      z = C.d / 2 - C.leg / 2 - 0.01,
      under = TEA.seat - C.slab,
      [r0, r1] = TEA.rail,
      back = -z - TEA.rake * ((r0 + r1) / 2 - under),
      parts: Part[] = [{ geometry: new RoundedBoxGeometry(C.w, C.slab, C.d, 1, 0.025), tint: L.teak, matrix: placed(0, TEA.seat - C.slab / 2, 0) }];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) parts.push({ geometry: chamfered(C.leg, under + 0.01, C.leg), tint: L.teak, matrix: placed(sx * x, (under + 0.01) / 2, sz * z) });
      parts.push({ geometry: chamfered(C.leg, r1 - under, C.leg), tint: L.teak, matrix: placed(sx * x, (under + r1) / 2, -z - TEA.rake * ((r1 - under) / 2), -TEA.rake, 0, 0) });
    }
    // The rail lies within the posts' depth, so it stays clear of a sitter's hair.
    parts.push({ geometry: chamfered(C.w, r1 - r0, 0.07), tint: toned(L.teak, 1.05), matrix: placed(0, (r0 + r1) / 2, back, -TEA.rake, 0, 0) });
    return parts.map((p) => ({ ...p, matrix: at.clone().multiply(p.matrix!) }));
  }
  /**
   * A round garden table with two chairs and a tea set, in chunky teak: the table on the origin
   * (its top TEA.top up, on a turned pedestal), a chair either side along x facing it, their seats
   * TEA.seat up and clear. On the table: a teapot, a second cup on its saucer (toward the +x chair;
   * the sitter in the other holds her own) and a cake stand of scones, in white china with a slate
   * band. `userData.seats` gives where a sitter's root goes for each chair (x, z and heading; her
   * hips TEA.setback behind the seat's front edge), the -x chair first.
   */
  function teaTable() {
    const g = new T.Group();
    g.name = 'sky-tea-table';
    const front = TEA.radius + TEA.gap, // a seat's front edge, from the table's middle
      mid = front + TEA.chair.d / 2,
      top = TEA.top;
    // The top is a mesh of its own: an overhang, so the pedestal under it takes its shade.
    solid(
      g,
      [{ geometry: turned(turns([[0, top - 0.08], [TEA.radius - 0.04, top - 0.08], [TEA.radius, top - 0.065], [TEA.radius, top - 0.02], [TEA.radius - 0.02, top], [0, top]]), 24), tint: toned(L.teak, 1.06) }],
      'wood',
      'sky-tea-top',
      ['teak'],
      { band: false },
    );
    solid(
      g,
      [
        { geometry: turned(turns([[0, 0], [0.26, 0, 1], [0.26, 0.04, 1], [0.2, 0.075], [0.09, 0.12, 1], [0.07, 0.22], [0.075, 0.4], [0.1, 0.5], [0.17, 0.565], [0.17, top - 0.07, 1], [0, top - 0.07]]), 14), tint: L.teak },
        ...chair(placed(-mid, 0, 0, 0, Math.PI / 2, 0)),
        ...chair(placed(mid, 0, 0, 0, -Math.PI / 2, 0)),
      ],
      'wood',
      'sky-tea-timber',
      ['teak'],
    );
    // The tea set. Every piece is one turned form or a fat blob: nothing under 0.07 across.
    const banded = (y0: number, y1: number): Tint => (p, _n, c) => blend(c, L.china, L.band, p.y > y0 && p.y < y1 ? 1 : 0),
      pot = placed(0.02, top, -0.1, 0, 0.6, 0),
      china: Part[] = [
        // The teapot: a round body with a lid and a knob, a fat spout and a fat handle.
        { geometry: turned(turns([[0, 0], [0.06, 0, 1], [0.088, 0.035], [0.094, 0.07], [0.08, 0.108], [0.05, 0.126], [0.05, 0.132, 1], [0.03, 0.142], [0.024, 0.15], [0.03, 0.165], [0.022, 0.18], [0, 0.184]]), 12), tint: banded(0.05, 0.088), matrix: pot },
        { geometry: new T.CylinderGeometry(0.028, 0.038, 0.11, 10), tint: L.china, matrix: pot.clone().multiply(placed(0.118, 0.095, 0, 0, 0, -0.85)) },
        { geometry: new T.TorusGeometry(0.046, 0.036, 6, 10, Math.PI), tint: L.china, matrix: pot.clone().multiply(placed(-0.088, 0.086, 0, 0, 0, Math.PI / 2)) },
        // The second cup on its saucer, one turned piece.
        { geometry: turned(turns([[0, 0], [0.04, 0, 1], [0.078, 0.014], [0.08, 0.022, 1], [0.05, 0.024, 1], [0.04, 0.03], [0.052, 0.07], [0.056, 0.086, 1], [0.046, 0.086, 1], [0.04, 0.062], [0, 0.058]]), 10), tint: banded(0.062, 0.09), matrix: placed(0.22, top, 0.1) },
        // The cake stand, one turned piece, and three scones on it.
        { geometry: turned(turns([[0, 0], [0.06, 0, 1], [0.05, 0.016], [0.024, 0.03], [0.024, 0.055], [0.1, 0.07], [0.118, 0.078, 1], [0.118, 0.092, 1], [0.105, 0.09], [0, 0.088]]), 12), tint: banded(0.074, 0.1), matrix: placed(-0.1, top, 0.17) },
        ...[0, 1, 2].map((k): Part => ({ geometry: pebble([0.05, 0.045, 0.05]), tint: L.scone, matrix: placed(-0.1 + 0.052 * Math.cos(k * 2.1 + 0.4), top + 0.12, 0.17 + 0.05 * Math.sin(k * 2.1 + 0.4), 0, k * 1.3, 0) })),
      ];
    solid(g, china, 'stone', 'sky-tea-china', ['china', 'band', 'scone']);
    g.userData.seats = [-1, 1].map((s) => ({ x: s * (front + TEA.setback), z: 0, heading: (-s * Math.PI) / 2 }));
    return g;
  }
  /**
   * A brass telescope on a chunky mahogany tripod, looking along +z and down by `tilt`: a stepped
   * refractor (eye barrel, draw tube, main tube and objective hood, each step a ring; a blackened
   * eyecup and a dark lens set back in the hood), carried on a collar and a ball over the tripod's
   * hub. The tripod's middle is the origin and the tube turns over it; the eye end is `eyepiece`
   * over the ground (0.65 by default: telescopeEyepiece) at `userData.eyepiece`, and a figure
   * stooped to it stands at `userData.stand`, facing +z.
   */
  function telescope({ eyepiece, tilt = TELESCOPE.tilt }: { eyepiece?: number; tilt?: number } = {}) {
    const E = telescopeEyepiece(tilt),
      height = eyepiece ?? Math.round(E.height * 100) / 100,
      S = TELESCOPE,
      g = new T.Group();
    g.name = 'sky-telescope';
    const sin = Math.sin(tilt),
      cos = Math.cos(tilt),
      py = height - S.pivot * sin, // the pivot, on the tube's axis over the origin
      eye: V3 = [0, height, -S.pivot * cos],
      // The tube's frame: its own +y down the line of sight, from the eye end.
      along = new T.Matrix4().compose(new T.Vector3(...eye), new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(0, -sin, cos)), ONE),
      b = S.barrel,
      hub = py - 0.15,
      brass: Part[] = [
        // The eyecup; the tube, stepped out at each ring, its hood open at the front; the lens set back in the hood.
        { geometry: turned(turns([[0, 0], [b - 0.008, 0, 1], [b, 0.008], [b, 0.075, 1], [0, 0.075]]), 14), tint: L.blackened, matrix: along },
        {
          geometry: turned(
            turns([
              [0, 0.06], [b - 0.004, 0.06, 1], [b - 0.004, 0.17, 1], [0.052, 0.17, 1], [0.052, 0.2, 1], [0.046, 0.2, 1], [0.046, 0.34, 1], [0.066, 0.34, 1], [0.066, 0.38, 1], [0.058, 0.38, 1],
              [0.058, 0.655, 1], [S.hood, 0.655, 1], [S.hood, S.length, 1], [S.hood - 0.016, S.length, 1], [S.hood - 0.016, S.length - 0.03, 1], [0, S.length - 0.03],
            ]),
            14,
          ),
          tint: L.brass,
          matrix: along,
        },
        { geometry: turned(turns([[0, S.length - 0.1], [S.hood - 0.017, S.length - 0.1, 1], [S.hood - 0.017, S.length - 0.022, 1], [0, S.length - 0.022]]), 14), tint: L.lens, matrix: along },
        // The mount: a ball on the hub, under the collar.
        { geometry: blob([0.055, 0.055, 0.055], 10, 6), tint: L.brass, matrix: placed(0, py - 0.085, 0) },
      ],
      wood: Part[] = [{ geometry: turned(turns([[0, hub - 0.05], [0.075, hub - 0.05, 1], [0.08, hub + 0.02], [0.06, hub + 0.05, 1], [0, hub + 0.05]]), 12), tint: L.mahogany }];
    // Three legs, one forward under the tube and two back either side of whoever looks, each on a
    // brass shoe; they run on 0.04 below the ground, for a domed lawn.
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2,
        from = new T.Vector3(0.035 * Math.sin(a), hub, 0.035 * Math.cos(a)),
        to = new T.Vector3(S.spread * Math.sin(a), -0.04, S.spread * Math.cos(a)),
        run = to.clone().sub(from),
        length = run.length();
      wood.push({
        geometry: chamfered(0.075, length, 0.075),
        tint: L.mahogany,
        // Square to its own bearing, then leant out along it.
        matrix: new T.Matrix4().compose(from.clone().add(to).multiplyScalar(0.5), new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), run.normalize()), ONE).multiply(new T.Matrix4().makeRotationY(a)),
      });
      brass.push({ geometry: pebble([0.055, 0.05, 0.055]), tint: L.brass, matrix: placed(to.x, 0.015, to.z) });
    }
    solid(g, brass, 'brass', 'sky-telescope-brass', ['brass', 'blackened', 'lens'], { shadow: false });
    solid(g, wood, 'wood', 'sky-telescope-tripod', ['mahogany']);
    g.userData.eyepiece = eye;
    g.userData.stand = [0, 0, eye[2] - E.standOff];
    return g;
  }
  /** One glass for all the kit's globes: the frame loop sets the same glow on every lamp. */
  let globeGlass: T.MeshStandardMaterial | null = null;
  /**
   * Short garden lamps at `spots` (each its foot, in the frame of the returned group), as one set:
   * a frosted globe on a brass cup, on a short pier of the villa's stone with a base and a cap (the
   * airport forecourt's lamp, smaller). The globes are one mesh in the lamps' own glass, lit with
   * the town's lamps (ctx.lamps) and never batched; the piers are one stone mesh and the cups one
   * brass. Each pier runs on 0.04 below its foot, for a domed lawn.
   */
  function gardenLamps(spots: { x: number; y?: number; z: number }[]) {
    const G = GARDEN_LAMP,
      g = new T.Group();
    g.name = 'sky-garden-lamps';
    const stone: Part[] = [],
      brass: Part[] = [],
      globes: T.BufferGeometry[] = [],
      cup = turned(turns([[0, 0], [0.07, 0, 1], [0.07, 0.03], [0.05, 0.055], [0.05, 0.075], [0.095, 0.11], [0.095, G.cup, 1], [0, G.cup]]), 10),
      centre = G.cap + G.cup + G.globe - 0.03;
    for (const { x, y = 0, z } of spots) {
      stone.push(
        { geometry: chamfered(G.base, 0.12, G.base), tint: L.stone, matrix: placed(x, y + 0.02, z) },
        { geometry: chamfered(G.shaft, G.cap - 0.14, G.shaft), tint: toned(L.stone, 0.97), matrix: placed(x, y + G.cap / 2, z) },
        { geometry: chamfered(G.base, 0.08, G.base), tint: L.stone, matrix: placed(x, y + G.cap - 0.04, z) },
      );
      brass.push({ geometry: cup, tint: L.brass, matrix: placed(x, y + G.cap, z) });
      globes.push(new T.SphereGeometry(G.globe, 12, 8).translate(x, y + centre, z));
    }
    solid(g, stone, 'stone', 'sky-lamp-piers', ['stone']);
    solid(g, brass, 'brass', 'sky-lamp-cups', ['brass'], { shadow: false });
    cup.dispose();
    globeGlass ??= lampGlass();
    const glass = new T.Mesh(mergeGeometries(globes)!, globeGlass);
    globes.forEach((s) => s.dispose());
    glass.name = 'sky-lamp-globes';
    glass.castShadow = false;
    glass.userData.noShadow = true;
    g.add(glass);
    lamps.push(glass);
    return g;
  }
  /** One short garden lamp, its foot on the origin (see gardenLamps: a set of several shares one globe mesh). */
  function gardenLamp() {
    const g = gardenLamps([{ x: 0, z: 0 }]);
    g.name = 'sky-garden-lamp';
    return g;
  }
  /**
   * A stone garden urn on a square plinth, to hold topiary: a turned foot and stem, a full bowl and
   * a rolled rim, soil inside. `userData.plant` says where a planted ball goes (its foot's height
   * and its radius); `planted` plants it with the nature kit's clipped ball.
   */
  function urn({ planted = false }: { planted?: boolean } = {}) {
    const g = new T.Group();
    g.name = 'sky-urn';
    const U = URN,
      rim = U.height;
    solid(
      g,
      [
        { geometry: chamfered(U.plinth, 0.15, U.plinth), tint: L.stone, matrix: placed(0, 0.025, 0) },
        {
          geometry: turned(
            turns([
              [0.17, 0.1], [0.17, 0.14, 1], [0.1, 0.18, 1], [0.085, 0.24], [0.12, 0.29], [0.24, 0.36], [0.3, 0.47], [0.31, rim - 0.075], [0.335, rim - 0.055],
              [0.335, rim - 0.015], [0.3, rim], [0.27, rim - 0.015, 1], [0.26, U.plant.y - 0.015, 1], [0, U.plant.y],
            ]),
            14,
          ),
          tint: (p, n, c) => blend(c, L.stone, L.soil, p.y > U.plant.y - 0.03 && p.y < rim - 0.02 && n.y > 0.5 && Math.hypot(p.x, p.z) < 0.27 ? 1 : 0),
        },
      ],
      'stone',
      'sky-urn-stone',
      ['stone', 'soil'],
    );
    g.userData.plant = { ...U.plant };
    if (planted) nature.topiary(g, 0, U.plant.y + U.plant.r * 0.8, 0, U.plant.r, 1, 1, 0.9, 1);
    return g;
  }

  return { fall, cloud, floatingRock, teaTable, telescope, gardenLamp, gardenLamps, urn };
}
export type SkyGarden = ReturnType<typeof createSkyGarden>;
