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
 * falls' stream in the pool's muted turquoise, the water at the lip the palette's own water's edge,
 * paling down the fall to the foam white of its foot and its lumps; the clouds' muted white (less
 * saturated than the palette's own) over a cooler, darker base; the furniture's pale dressed stone
 * (the villa's); the rocks' greys (the airport armour's) with a little earth, under turf; teak and a
 * darker mahogany; brass, its blackened eyecup and a dark lens; white china with a slate band,
 * scones and a planter's soil.
 */
export const SKY_GARDEN_LOOK = {
  stream: '#5ab4cc',
  water: palette.poolEdge,
  foam: '#eaf6f2',
  cloud: '#f1f2ee',
  cloudBase: '#ccd4d9',
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
  stream: palette.poolWater,
  water: palette.poolEdge,
  foam: palette.white,
  cloud: palette.white,
  cloudBase: palette.white,
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
 * The pale parts at night, as the balloon is dimmed (town-movers' BALLOON_NIGHT_DIM): the colour each
 * one's material takes at full night, a multiplier on its daylight paint (white keeps it as by day),
 * reached through the dusk from white. They are lit like the town, but they are the pale, round
 * things that hang unshadowed over the dark sea. `cloud` (the clouds): a cool moonlit grey that keeps
 * most of their daylight, so under the moon they read as clouds a little paler than the lawn, as the
 * town's own pale things do (at 0.7 grey they sank to slate lumps that read as boulders). `fall` (the
 * falls' water, its lumps and the puff each ends in): dimmed less than the clouds and a little bluer,
 * so a fall stays a pale blue-grey and never turns into a dark downpipe. No glow: nothing is emissive.
 */
export const SKY_NIGHT = { cloud: '#f6fbff', fall: '#fcfeff' };

/**
 * A fall, in its own frame: the origin is the rim point it leaves (on the line of the coping's nose,
 * the deck's widest ring), +z points out over the sea and y 0 is the lawn's level there (the rim's
 * skyTop). The owner's reference 2: thin water spilling over a natural edge.
 * - The stream: it wells up from under the lawn `stream.head` inland (where town-sky's notch rocks
 *   stand over its spring: `rise` is how much higher the lawn is there than at the rim) and runs out
 *   through a notch in the coping (`notch`, cut by town-sky's coping: its floor's half-width, the ramp
 *   up to the coping's top either side, and its floor's height): `stream.half` wide either side of
 *   its middle and `stream.depth` either side of its middle line, its surface `stream.level` over y 0,
 *   flush with the lawn's edge. No basin, no kerb: the water simply spills over the rim.
 * - The lip: over the notch's nose the water curls down by `lip` (the radius of its middle line), a
 *   short overhanging turn, never a pipe's elbow.
 * - The sheet: `width` wide under the lip and `depth` of that deep, a flat sheet with soft edges
 *   (FALL_OVAL), spreading to `flare` times as wide where it meets the puff. It hangs a little
 *   forward as it falls, as water thrown over a lip does: from the lip's end straight on to the
 *   puff's middle, `out` beyond the rim and `drop` under y 0.
 * - The channel: down the middle of each face of the sheet runs a shallow channel `recess.depth`
 *   deep, flat to `recess.flat` of its half-width and gone by `recess.edge`, and the lumps
 *   (FALL_LUMPS) ride in it, their crowns under the sheet's own outline, so from any side nothing on
 *   the fall's silhouette moves (the selection ring holds still round it). Under the lip the faces
 *   are whole down to `hide[0]` (the loop's first cluster waits inside the water there) and the
 *   channel is full by `hide[1]`.
 * - The lumps' clusters are about `pitch` apart (fallLayout fits a whole number of them to the
 *   sheet) and slide one spacing down it every `period` seconds; `phase` is where the loop stands at
 *   time 0 (lumps mid-fall, one coming out of the whole water under the lip).
 * - `puff`: the cloud's radius; `puffRise` and `puffSink` how far it stands over and hangs under
 *   its middle (a flat base); `core` the round middle every puff has (the last cluster and the
 *   sheet's end hide inside it): its radius, and its middle over the puff's.
 */
export const FALL = {
  drop: 4.5,
  width: 0.82,
  depth: 0.24,
  flare: 1.8,
  out: 0.67,
  stream: { half: 0.3, depth: 0.04, level: 0.035, head: 0.55 },
  notch: { half: 0.42, ramp: 0.22, floor: -0.06 },
  lip: 0.16,
  recess: { depth: 0.052, flat: 0.45, edge: 0.75 },
  hide: [0.9, 1.45] as [number, number],
  pitch: 1.04,
  period: 2.2,
  phase: 0.35,
  puff: 1.3,
  puffRise: 0.85,
  puffSink: 0.62,
  core: { r: 0.8, y: 0.05 },
};
/**
 * A cluster of lumps: low swells of white water riding down the sheet's channel, broader than tall.
 * Each is an ellipsoid sunk in the channel's floor on a face of the sheet (`side` 1 the face to the
 * sea, -1 the one to the rock) until only its crown stands `proud`, so it meets the water at a
 * shallow angle (a pill stuck on the water reads as a rivet): its middle `x` across (in half-widths
 * of the sheet under the lip) and `y` over the cluster's own origin, its radii across (in those
 * half-widths), up and out. All of it lies within the channel's flat floor (`x` and its radius
 * within FALL.recess.flat), so it never reaches the sheet's edges. A big one and a small one a face,
 * set off from one another, so the fall reads from either side and no cluster is a ring.
 */
export const FALL_LUMPS = [
  { side: 1, x: -0.03, y: 0, r: [0.41, 0.15, 0.05], proud: 0.032 },
  { side: 1, x: 0.2, y: -0.27, r: [0.24, 0.1, 0.045], proud: 0.026 },
  { side: -1, x: 0.03, y: -0.04, r: [0.41, 0.15, 0.05], proud: 0.032 },
  { side: -1, x: -0.2, y: -0.3, r: [0.24, 0.1, 0.045], proud: 0.026 },
] as const;
/** The exponent of the sheet's section (a superellipse): flat faces, softly rounded edges. */
export const FALL_OVAL = 4;
/**
 * A fall's measures for a drop, a width and a `rise` (how much higher the lawn is over the stream's
 * head than at the rim): the sheet's half-width and half-depth under the lip; the stream's middle
 * line (`mid`) and the lip's turn (its centre's height under the nose, the angle it turns through,
 * and `top`, where it ends and the sheet begins); `lean`, how far out the sheet carries for each unit
 * it falls; `line(y)`, the sheet's middle at a height; a cluster's reach over and under its origin;
 * how many clusters there are, how far apart (in height: each slides along the sheet's lean), and
 * the first one's origin at the loop's start (inside the whole water under the lip; the last one, a
 * spacing below its own start at the loop's end, is hidden in the puff's core).
 */
export function fallLayout(drop = FALL.drop, width = FALL.width, rise = 0) {
  const a = width / 2,
    b = a * FALL.depth,
    S = FALL.stream,
    R = FALL.lip,
    mid = S.level - S.depth,
    centre = mid - R,
    // The lip turns until its line, carried straight on, meets the puff's middle (out, -drop).
    A = FALL.out,
    B = -drop - centre,
    turn = Math.asin(R / Math.hypot(A, B)) - Math.atan2(B, A),
    top = { z: R * Math.sin(turn), y: centre + R * Math.cos(turn) },
    lean = 1 / Math.tan(turn),
    over = Math.max(...FALL_LUMPS.map((l) => l.y + l.r[1])),
    under = -Math.min(...FALL_LUMPS.map((l) => l.y - l.r[1])),
    first = top.y - FALL.hide[0] + under + 0.03,
    // The last cluster ends the loop in the puff's core.
    travel = first + drop - FALL.core.y - 0.05,
    count = Math.max(2, Math.round(travel / FALL.pitch));
  return { drop, width, rise, a, b, mid, centre, turn, top, lean, out: FALL.out, line: (y: number) => top.z + lean * (top.y - y), over, under, first, count, spacing: travel / count };
}
export type FallLayout = ReturnType<typeof fallLayout>;
/**
 * The sheet `d` below the lip's end (in height): its half-width, its half-depth, the channel's
 * depth down its faces, and its middle. It spreads (FALL.flare) to the puff's top and keeps that
 * width into the puff; its faces are whole under the lip (FALL.hide) and channelled below.
 */
export function fallSection(F: FallLayout, d: number) {
  const flareTo = F.top.y + F.drop - FALL.puffRise,
    spread = Math.min(1, Math.max(0, d) / flareTo) ** 1.15;
  return { a: F.a * (1 + (FALL.flare - 1) * spread), b: F.b, recess: FALL.recess.depth * T.MathUtils.smoothstep(d, FALL.hide[0], FALL.hide[1]), z: F.line(F.top.y - d) };
}
/**
 * How far out of the sheet's middle plane its face stands at `u` (a share of the half-width, -1 to
 * 1) for a section `s`: the superellipse's face less the channel down its middle.
 */
export function fallFace(s: { b: number; recess: number }, u: number) {
  const t = Math.min(1, Math.abs(u));
  return s.b * (1 - t ** FALL_OVAL) ** (1 / FALL_OVAL) - s.recess * (1 - T.MathUtils.smoothstep(t, FALL.recess.flat, FALL.recess.edge));
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
 * A floating rock at size 1: a chunk of rock, not a drop. Two of the airport armour's boulders (an
 * icosahedron of `detail` 2, each corner in or out by up to `jitter` / 2, shaded as the smooth
 * rounded block): a big one (`top`, its half sizes) and a smaller one (`keel`) set under it and off
 * to one side (`at`: how far out from under its middle and how far down), so the lump has a keel
 * (from the town's high camera a flat pebble shows only its top) and an outline of its own. A thin,
 * irregular patch of turf (`turf`: its reach over the big stone's top, how far it stands proud of
 * it, and how much its outline wanders) lies on the big one's top, set off its middle; no tussocks
 * (three small balls on a green cap read as eyes). Each seed turns, tilts and sizes its stones and
 * its patch its own way (each big stone tipped `tilt` (from, to) radians either way about both level
 * axes, so no top lies level like a pot's), so no two are alike. The turf is the crown of a low
 * lens `turf.rise` deep sunk in the stone's top until `proud` of it shows, so its edge follows the
 * stone's own bumps. About 2.1 across, 0.75 over its middle (the origin) and 1.3
 * under it. It bobs by `bob` and rocks by `rock` radians every `period` seconds (`periods`,
 * picked by its seed).
 */
export const ROCK = {
  detail: 2,
  jitter: 0.08,
  top: [1.0, 0.68, 0.84] as [number, number, number],
  keel: { r: [0.66, 0.6, 0.6] as [number, number, number], at: [0.36, -0.52] as [number, number] },
  tilt: [0.14, 0.3] as [number, number],
  turf: { reach: 0.66, proud: 0.06, rise: 0.2, wander: 0.24 },
  bob: 0.12,
  rock: 0.035,
  periods: [9, 10.5, 12],
};
/** The armour stones' shape (ROCK.detail): an icosahedron with its corners merged, so a corner moved moves every face round it. */
let STONE: T.BufferGeometry | null = null;
/**
 * One of the airport armour's boulders (town-airport's boulder(), copied: its helpers stay its own)
 * at size 1, about 2 across: the icosahedron pushed part way toward a rounded block (`square`, 0.3
 * to 0.65 by its seed), each corner in or out by up to ROCK.jitter / 2, with the rounded block's own
 * analytic normals, so it shades as one smooth chunk and no facet shows. Squash and turn it as it is
 * placed (a matrix takes its normals through the squash).
 */
export function boulder(seed: number, square = 0.3 + 0.35 * hash(seed * 7.31 + 1.913)) {
  STONE ??= mergeVertices(new T.IcosahedronGeometry(1, ROCK.detail).deleteAttribute('normal').deleteAttribute('uv'));
  const geometry = STONE.clone(),
    p = geometry.getAttribute('position'),
    normals = new Float32Array(p.count * 3),
    n = new T.Vector3(),
    u = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    u.fromBufferAttribute(p, i);
    const block = (u.x ** 4 + u.y ** 4 + u.z ** 4) ** -0.25,
      k = (1 + square * (block - 1)) * (1 + ROCK.jitter * (hash(seed * 31.7 + i * 3.17) - 0.5));
    n.set(u.x ** 3, u.y ** 3, u.z ** 3).normalize().multiplyScalar(square).addScaledVector(u, 1 - square).normalize().toArray(normals, i * 3);
    p.setXYZ(i, u.x * k, u.y * k, u.z * k);
  }
  geometry.setAttribute('normal', new T.BufferAttribute(normals, 3));
  return geometry;
}
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
   * The pale parts' night (SKY_NIGHT): once batched, a pivot's meshes take the kit's own copy of the
   * batch material they share for their role (the same shader program: one copy for the clouds, one
   * for the falls), so their colour can follow the night without darkening everything else made of
   * cloth (the balloon's way). They take no shadow either: a cloud half in the island's shadow reads
   * as a grey boulder.
   */
  const own = new Map<string, T.MeshStandardMaterial>(),
    nightTone = { cloud: new T.Color(SKY_NIGHT.cloud), fall: new T.Color(SKY_NIGHT.fall) };
  function dim(g: T.Object3D, night: number, role: keyof typeof SKY_NIGHT) {
    for (const part of g.children) {
      if (!(part instanceof T.Mesh) || !(part.material instanceof T.MeshStandardMaterial) || !part.material.vertexColors) continue;
      if (part.material.userData.skyGardenOwn !== role) {
        const shared = part.material,
          key = `${role}:${shared.uuid}`;
        let copy = own.get(key);
        if (!copy) {
          copy = shared.clone();
          copy.onBeforeCompile = (shader, renderer) => shared.onBeforeCompile(shader, renderer);
          copy.customProgramCacheKey = () => shared.customProgramCacheKey();
          copy.userData.skyGardenOwn = role;
          own.set(key, copy);
        }
        part.material = copy;
        part.receiveShadow = false;
      }
      part.material.color.setRGB(1, 1, 1).lerp(nightTone[role], night);
    }
  }

  /* ---------------------------------------------------------------- */
  /* The falls                                                         */
  /* ---------------------------------------------------------------- */
  /** Columns round the water's section, at shares `u` of its half-width: over its top face (or the sheet's face to the sea) from right to left, then back under it. */
  const FACE = [0.95, 0.85, 0.72, 0.6, 0.45, 0.28, 0, -0.28, -0.45, -0.6, -0.72, -0.85, -0.95],
    COLUMNS: [number, number][] = [[1, 0], ...FACE.map((u): [number, number] => [u, 1]), [-1, 0], ...FACE.map((u): [number, number] => [-u, -1])];
  /**
   * The water, one tube from the spring to the puff: its section a flat oval laid across the flow
   * (the stream's in the notch, flat and thin; the sheet's down the fall, FALL_OVAL with its channel,
   * fallFace), swept along the stream's middle line under the lawn's edge, round the lip's short turn
   * and straight down the sheet's lean to its foot in the puff. Its paint is on its vertices: the
   * stream's muted turquoise paling to the water's edge at the lip, then down the fall from the water
   * to foam white at the puff, with a few faint streaks of deeper water down it, so nothing scrolls
   * and nothing can crawl.
   */
  function waterGeometry(F: FallLayout, seed: number) {
    type Station = { z: number; y: number; ny: number; nz: number; a: number; b: number; recess: number; e: number; tone: (c: T.Color) => void; streak: number };
    const S = FALL.stream,
      R = FALL.lip,
      stations: Station[] = [],
      flatOval = 5,
      // The stream's top under the lawn at its head (the lawn there stands `rise` over y 0).
      headTop = Math.min(S.level, F.rise - 0.03),
      water = (f: number) => (c: T.Color) => blend(c, L.stream, L.water, f);
    // The stream: from under the lawn, over the notch's floor to the nose (z 0).
    for (const [z, f] of [[-S.head, 0], [-0.3, 0.45], [-0.12, 0.8], [0, 1]])
      stations.push({ z, y: z === -S.head ? headTop - S.depth : F.mid, ny: 1, nz: 0, a: S.half, b: S.depth, recess: 0, e: flatOval, tone: water(f), streak: 0 });
    // The lip: its short turn, the stream widening and thickening into the sheet.
    const B = 5,
      grow = (t: number) => smooth(t, 0, 1);
    for (let k = 1; k <= B; k++) {
      const t = k / B,
        th = t * F.turn;
      stations.push({ z: R * Math.sin(th), y: F.centre + R * Math.cos(th), ny: Math.cos(th), nz: Math.sin(th), a: lerp(S.half, F.a, grow(t)), b: lerp(S.depth, F.b, 0.75 * grow(t)), recess: 0, e: lerp(flatOval, FALL_OVAL, grow(t)), tone: water(1), streak: 0.5 * t });
    }
    // The sheet, straight down its lean to its foot in the puff: from the water at the lip to foam.
    const foot = F.top.y + F.drop - 0.15,
      foam = F.top.y + F.drop - FALL.puffRise,
      n = Math.hypot(1, F.lean),
      [h0, h1] = FALL.hide,
      depths = [0.12, 0.3, 0.55, h0 - 0.05, (h0 + h1) / 2, h1];
    for (let d = h1 + 0.55; d < foot - 0.2; d += 0.55) depths.push(d);
    depths.push(foot);
    for (const d of depths) {
      const s = fallSection(F, d),
        f = smooth(d, 0.1, foam);
      stations.push({ z: s.z, y: F.top.y - d, ny: F.lean / n, nz: 1 / n, a: s.a, b: d < 0.3 ? lerp(0.75 * F.b, F.b, smooth(d, 0, 0.3)) : s.b, recess: s.recess, e: FALL_OVAL, tone: (c) => blend(c, L.water, L.foam, f), streak: 1 - f });
    }
    const M = COLUMNS.length,
      pos: number[] = [],
      col: number[] = [],
      index: number[] = [],
      c = new T.Color(),
      deep = new T.Color(L.stream),
      channel = 0.22,
      streaks = COLUMNS.map((_, i) => (hash(seed * 7.7 + i * 3.3) > 0.62 ? 0.18 + 0.14 * hash(seed * 1.9 + i * 5.1) : 0));
    for (const s of stations)
      COLUMNS.forEach(([u, side], i) => {
        // Across the face: the oval's own face (the stream's flat one) less the sheet's channel.
        const w = side * (s.e === FALL_OVAL ? fallFace(s, u) : s.b * (1 - Math.abs(u) ** s.e) ** (1 / s.e));
        pos.push(u * s.a, s.y + w * s.ny, s.z + w * s.nz);
        s.tone(c);
        // Deeper water down the channel the lumps ride in, so their foam shows white against it.
        c.lerp(deep, Math.max(streaks[i], channel * (s.recess / FALL.recess.depth) * (1 - T.MathUtils.smoothstep(Math.abs(u), FALL.recess.flat, FALL.recess.edge))) * s.streak);
        col.push(c.r, c.g, c.b);
      });
    // The ring runs from the flow's right over its top to its left, so these faces look out.
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
   * The water that stands still, one mesh on a pivot of its own (it dims at night): the stream, its
   * lip and the sheet (waterGeometry) and the puff the fall ends in.
   */
  function stillWater(g: T.Object3D, F: FallLayout, seed: number) {
    return solid(
      g,
      [{ geometry: waterGeometry(F, seed) }, { geometry: cloudGeometry(puffLobes(seed, FALL.puff), CLOUD.fillet, CLOUD.puffGrid, -FALL.puffSink), matrix: placed(0, -F.drop, F.out) }],
      'fabric',
      'sky-fall-water',
      ['stream', 'water', 'foam', 'cloud', 'cloudBase'],
      { shadow: false },
    );
  }
  /**
   * The lumps, one mesh on a pivot inside the still water's: `count` clusters alike (FALL_LUMPS), a
   * spacing apart down the sheet's lean, each lump a smooth ellipsoid of foam white sunk in the
   * channel's floor on a face of the sheet, its crown under the sheet's outline.
   */
  function lumps(g: T.Object3D, F: FallLayout) {
    const parts: Part[] = [],
      big = blob([1, 1, 1], 10, 5),
      small = blob([1, 1, 1], 8, 4),
      n = Math.hypot(1, F.lean),
      // The sheet's face normal (to the sea), and its tilt off the vertical.
      normal = new T.Vector3(0, F.lean / n, 1 / n),
      tilt = -Math.atan(F.lean),
      floor = F.b - FALL.recess.depth;
    for (let k = 0; k < F.count; k++)
      for (const l of FALL_LUMPS) {
        const [rx, ry, rz] = l.r,
          y = F.first - k * F.spacing + l.y,
          at = new T.Vector3(l.x * F.a, y, F.line(y)).addScaledVector(normal, l.side * (floor + l.proud - rz));
        parts.push({
          geometry: rx > 0.3 ? big : small,
          tint: L.foam,
          matrix: new T.Matrix4().compose(at, new T.Quaternion().setFromEuler(new T.Euler(tilt, 0, l.side * 0.08)), new T.Vector3(rx * F.a, ry, rz)),
        });
      }
    const m = solid(g, parts, 'fabric', 'sky-fall-lumps', ['foam'], { shadow: false });
    big.dispose();
    small.dispose();
    return m;
  }
  /**
   * A short waterfall (FALL): a stream that wells up under the lawn's edge, runs out through a notch
   * in the coping (town-sky cuts it, and sets rocks round it) and spills over the rim, curls down over
   * a short lip and falls as a thin, flat sheet, leaning a little forward and spreading, to end
   * `drop` below the deck in a matte cloud puff; no water reaches the sea. The water is opaque and
   * matte, its paint on its vertices. A few low swells of white water slide down the channel in the
   * sheet's faces in a loop: the one mesh moves a spacing down the sheet's lean and back (fallPhase),
   * the cluster beyond either end hidden in the whole water under the lip and in the puff. Nothing
   * scrolls in a shader, so nothing can crawl. Stand its origin on the rim at the lawn's level there,
   * +z out over the sea; `rise` is how much higher the lawn is over the stream's head (FALL.stream.head
   * inland); `seed` picks the puff's lobes and the streaks.
   */
  function fall({ drop = FALL.drop, width = FALL.width, rise = 0, seed = 1 }: { drop?: number; width?: number; rise?: number; seed?: number } = {}) {
    const F = fallLayout(drop, width, rise),
      g = new T.Group();
    g.name = 'sky-fall';
    g.userData.fall = F;
    const water = pivot(g, 'sky-fall-still');
    stillWater(water, F, seed);
    const moving = pivot(water, 'sky-fall-moving');
    lumps(moving, F);
    const settle = (_time: number, night = 0) => dim(water, night, 'fall'),
      slide = (time: number, night = 0) => {
        const s = fallPhase(time) * F.spacing;
        moving.position.set(0, -s, s * F.lean);
        dim(moving, night, 'fall');
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
      dim(drift, night, 'cloud');
    };
    update(0, 0);
    animated.push({ object: drift, update });
    return g;
  }
  /**
   * A small floating rock (ROCK), one mesh: its two boulders in one of the armour's greys, lighter
   * toward the top, the big one's top a little earthy under its patch of turf. Its origin is its
   * middle. It bobs and rocks slowly on town time (rockBob) and casts nothing.
   */
  function floatingRock({ size = 0.6, seed = 1 }: { size?: number; seed?: number } = {}) {
    const g = new T.Group();
    g.name = 'sky-rock';
    const bob = pivot(g, 'sky-rock-bob'),
      h = (k: number) => hash(seed * 5.77 + k * 2.31),
      grey = [L.rock, L.rockDark, L.rockPale][Math.floor(h(1) * 3) % 3],
      tone = 0.94 + 0.12 * h(2),
      K = ROCK.keel,
      // The big stone's half sizes, each a little its own, and its turn and tilt.
      top = ROCK.top.map((r, k) => r * size * (0.9 + 0.2 * h(3 + k))) as [number, number, number],
      lean = (k: number) => (h(k) < 0.5 ? -1 : 1) * lerp(ROCK.tilt[0], ROCK.tilt[1], h(k + 30)),
      turn = new T.Euler(lean(6), h(7) * Math.PI * 2, lean(8)),
      // The keel: under the big stone, off to the side its seed picks.
      side = h(9) * Math.PI * 2,
      keel = new T.Vector3(Math.cos(side) * K.at[0] * size, K.at[1] * size, Math.sin(side) * K.at[0] * size),
      // A stone's paint, in its own unit frame: lighter toward its top, a little earthy over it.
      stone = (p: T.Vector3, n: T.Vector3, c: T.Color) => blend(c, grey, L.earth, 0.6 * smooth(p.y, 0.3, 0.9) * smooth(n.y, 0.4, 0.9), tone * lerp(0.8, 1.04, smooth(p.y, -1, 1))),
      parts: Part[] = [
        { geometry: boulder(seed * 3 + 1, 0.4 + 0.2 * h(10)), tint: stone, matrix: new T.Matrix4().compose(new T.Vector3(), new T.Quaternion().setFromEuler(turn), new T.Vector3(...top)) },
        {
          geometry: boulder(seed * 3 + 2, 0.5 + 0.25 * h(11)),
          tint: stone,
          matrix: new T.Matrix4().compose(keel, new T.Quaternion().setFromEuler(new T.Euler(0.3 * (h(12) - 0.5), h(13) * Math.PI * 2, 0.3 * (h(14) - 0.5))), new T.Vector3(...K.r.map((r, k) => r * size * (0.9 + 0.2 * h(15 + k))))),
        },
      ];
    // The turf: a low, closed lens with a wandering outline, sunk in the big stone's (tipped) top off
    // its middle, so only a thin, irregular patch of it shows over the stone.
    {
      const T0 = ROCK.turf,
        cap = new T.SphereGeometry(1, 18, 6),
        q = cap.getAttribute('position'),
        phase = h(18) * Math.PI * 2;
      for (let i = 0; i < q.count; i++) {
        const a = Math.atan2(q.getZ(i), q.getX(i)),
          k = 1 + T0.wander * (0.65 * Math.sin(2 * a + phase) + 0.35 * Math.sin(3 * a + 2.1 * phase));
        q.setXYZ(i, q.getX(i) * k, q.getY(i), q.getZ(i) * k);
      }
      cap.computeVertexNormals();
      const turn2 = (p: T.Vector3, scale: T.Vector3) => new T.Matrix4().makeRotationFromEuler(turn).multiply(new T.Matrix4().compose(p, new T.Quaternion().setFromEuler(new T.Euler(0, h(20) * Math.PI * 2, 0)), scale)),
        off = (0.12 + 0.1 * h(19)) * size,
        at = new T.Vector3(Math.cos(side + Math.PI) * off, top[1] * 0.94 + (T0.proud - T0.rise) * size, Math.sin(side + Math.PI) * off);
      parts.push({
        geometry: cap,
        tint: (p, _n, c) => blend(c, L.turfDark, L.turf, smooth(p.y, 0.3, 0.9)),
        matrix: turn2(at, new T.Vector3(T0.reach * top[0], T0.rise * size, T0.reach * top[2])),
      });
    }
    solid(bob, parts, 'stone', 'sky-rock-body', ['rock', 'rockDark', 'rockPale', 'earth', 'turf', 'turfDark'], { shadow: false });
    parts.forEach((p) => p.geometry.dispose());
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
