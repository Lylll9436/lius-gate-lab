import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAWN_TINT, WASH_PEAK, type SurfaceKind } from './city-materials';
import * as plan from './town-plan';
import { palette, hash, type TownContext } from './town-shared';
import { noise3, roundBox, roundCone, sculpt, type Shape } from './town-sculpt';
import { BLOOMS, type Nature } from './town-nature';
import type { Props } from './town-props';
import { FALL, boulder, type SkyGarden } from './town-sky-garden';
import { createAlison, poseAlison } from './sky-figure';
import { figureClock } from './figure-rig';

/**
 * The sky island's colours, each no more saturated than its palette family: the lawn's two mown
 * greens (the town lawn's stripes); the coping's weathered stone, a step greyer and darker than
 * the kerb's buff, so the villa's pale dressings stay the brightest stone on the island; the
 * paths' pale gravel, between the pavement's and the park path's. Under the deck, the earth in
 * three warm browns, a bed each from the turf down: dark, lighter, dark again (well under the
 * soil's saturation, near the armour's greys in value), parted by faint pale seams; and the rock
 * that stands out of it in outcrops and makes the spike, in the airport armour's cool greys,
 * lighter where it faces the sky (the lawn's outcrop and the rocks by the falls' notches take the
 * same greys). (The villa's own colours are town-sky-villa's VILLA_LOOK.)
 */
export const SKY_LOOK = {
  lawn: [palette.grassDark, palette.grassLight],
  coping: '#b9b19c',
  path: '#c6b08a',
  earth: ['#7a5236', '#9b7048', '#6e4f38'],
  seam: '#a2998a',
  rock: ['#8a8d88', '#757a76', '#666b68'],
};
/**
 * The lawn: mown in stripes `stripe` wide that run the deck's length (north-south, past the
 * villa's front), each stripe's triangles one flat colour, so no texture can shimmer (the town
 * lawn's checker is drawn by the ground shader from the masks, which do not know this island). It
 * is laid out to `edge` of the way to the rim, under the coping, in `rows` rows a stripe.
 */
export const SKY_LAWN = { stripe: 0.8, edge: 0.95, rows: 40 };
/**
 * The coping round the rim: chunky stones laid end to end, as a profile swept round it (o out from
 * the rim's line, y from SKY.top), listed from its inner foot under the turf, over its top (0.11
 * proud of the lawn beside it) and round its nose (the deck's widest ring, SKY.ring down) to its
 * underside, which runs back in and ends inside the rock's flat top. `stones` of them, each
 * `stations` stations long: at the joint between two the profile's outer half (the top's outer
 * edge, the nose and the underside) draws in by `joint` (a soft V, never a slit), and each stone's
 * sits up to `set` lower and further in than the next; each is a shade of its own within `tone`.
 * No stone reaches past the nose's line: the rim is the deck's outline.
 */
export const SKY_COPING = {
  profile: [[-0.46, -0.32], [-0.46, -0.19], [-0.41, -0.14], [-0.14, -0.14], [-0.04, -0.18], [0, -plan.SKY.ring], [-0.04, -0.36], [-0.14, -0.43], [-0.34, -0.47], [-0.62, -0.5]] as [number, number][],
  stones: 44,
  stations: 4,
  joint: 0.045,
  set: 0.025,
  tone: 0.06,
};
/**
 * Where each fall's stream runs out over the rim (town-sky-garden's FALL), the coping is notched:
 * over the stations within FALL.notch.half of the fall's rim point, easing back up over its `ramp`
 * either side, its profile sinks to `profile` (SKY_COPING.profile's points, each at its own o, sunk
 * point for point to the heights `sunk` gives: its top FALL.notch.floor over the rim's lawn, under
 * the stream's water, its nose and underside drawn in after it, so the stone stays 0.07 or more
 * thick and 0.3 clear of the falling sheet; the last, the underside's end inside the rock, stays
 * put). Three of the rock's own boulders (`rocks`, the airport armour's shape: each one's middle
 * and half sizes in the fall's own frame, x across, y over the rim's lawn, z out) line it: one
 * either side, sunk in the coping over its ramps, and one over the stream's spring on the lawn
 * behind it; each a shade of its own, lighter where it faces the sky (notchRocks).
 */
export const SKY_NOTCH = (() => {
  const top = FALL.notch.floor - plan.SKY.dome,
    sunk = [top - 0.04, top - 0.01, top, top, top - 0.015, top - 0.035, top - 0.05, top - 0.09, top - 0.12],
    end = SKY_COPING.profile.length - 1;
  return {
    profile: SKY_COPING.profile.map(([o, y], j): [number, number] => [o, j === end ? y : sunk[j]]),
    rocks: [
      { c: [-0.7, 0.06, -0.22], h: [0.34, 0.22, 0.3], seed: 3 },
      { c: [0.68, 0.05, -0.18], h: [0.3, 0.2, 0.33], seed: 7 },
      { c: [0.04, 0.12, -0.78], h: [0.42, 0.24, 0.3], seed: 11 },
    ] as { c: [number, number, number]; h: [number, number, number]; seed: number }[],
  };
})();
/**
 * One of the earth's shoulders under the rim, placed by the world bearing it hangs on (0 south, 90
 * east, as everywhere in the plan): `proud`, how far its outer face stands past the earth body's
 * surface at its height (negative: inside it); `y`, its middle under SKY.top; `radial`, `tangential`
 * and `vertical`, its half sizes (along the bearing, across it and up); `tilt`, a small lean about
 * the deck's long axis.
 */
type Lobe = { bearing: number; proud: number; y: number; radial: number; tangential: number; vertical: number; tilt: number };
const lobe = (bearing: number, proud: number, y: number, radial: number, tangential: number, vertical: number, tilt: number): Lobe => ({ bearing, proud, y, radial, tangential, vertical, tilt });
/**
 * One rock outcrop on the underside's flank, placed as a Lobe is (`bearing`; `y`, its middle under
 * SKY.top): a cluster of OUTCROP_STONES at `size`, its outermost stone `proud` past the earth there,
 * `seed` turning, sizing, shading and (by half) mirroring its stones, so no two outcrops are alike.
 */
type Outcrop = { bearing: number; y: number; size: number; proud: number; seed: number };
const outcrop = (bearing: number, y: number, size: number, proud: number, seed: number): Outcrop => ({ bearing, y, size, proud, seed });
/**
 * The underside, in the deck's own frame (x along its long axis, north; z east; y from SKY.top):
 * solids blended in a distance grid of spacing `grid` (town-sculpt), so it is one smooth mass with
 * no facet: the owner's reference 2, a grass top on an inverted cone of earth and rock tapering to
 * a point, in the town's own style. The earth's body (`body`, earthBody): cut flat `top` under
 * SKY.top inside the coping (under the turf; the cut's edge rolled into the cliffs over `cut`, so
 * the shoulders' blends never crease it), it stands straight down as cliffs at `share` of the
 * rim to `cliff` (a chunk of land, not a plate, from every side), then tapers to the tip,
 * SKY.depth down (as deep as the sea allows) and leaning toward the island's file's camera
 * (plan.skyTip), its flank a little convex (`belly`: full under the rim, narrowing to the point at
 * the last; any fuller and from the town's 42.6 degrees its foot would read as a bowl). A round cone
 * (`tip`: from this depth, its two radii, its fillet, and how far the blend swells it) makes the
 * point a spike of rock. The earth's chunky shoulders (`lobes`, Lobe, each blended in with a fillet
 * of `fillet`, their edges rounded by `round` of their least half size, at least `edge`) stand in
 * the cliffs under the rim, a little proud of it, fullest on the south and south-east (the file's
 * and the opening bearing's side) and where each view's outline runs; none proud on the north tip
 * (the plane's side, check-town) nor under the falls.
 * The rock stands out of the flank lower down as outcrops (`outcrops`, Outcrop: the art review found
 * the single rounded blocks there read as grey cushions or paving slabs), each a cluster of the
 * airport armour's own boulders (OUTCROP_STONES; the notch's rocks and the floating rocks are such
 * boulders too), set into the earth on its own normal there, so where stone meets earth the two
 * surfaces part in one crisp line; one or two outcrops face each Rotate stop of the island's file
 * (none alone in the middle of the cone, as the north-north-west block was at the third), and none
 * stands in a fall's way (check-town keeps the falls' water 0.3 clear of the rock; the nearest, at
 * 245 degrees, is 20 off the west fall's bearing).
 * From the island's file (its own lower pitch, city-scene's SKY_PITCH) the body hangs 0.65 of the
 * deck's height below it and narrows to its tip; from the Rotate stops at the town's pitch it shows
 * as a thick body of earth (0.2 of the deck's height or more) narrowing under it.
 * The earth's beds change at `beds` (depths under SKY.top), each change a soft level gradient
 * (`change`) under a pale seam (`seam`: whole within its first number of the line, gone by its
 * second; at least two grid spacings across, so the vertices draw it as one soft band and never as
 * a row of dots; `seamTone` of the way to SKY_LOOK.seam). From `spike` down the earth gives way to
 * rock, as at the reference's point, which darkens a little from `beds[2]` to the tip. A stone is a
 * shade darker (`set`) where it goes into the earth and (`crevice`) where it meets another stone of
 * its outcrop, so the cracks between them read. Whatever faces down takes the sea's light thrown
 * back up (`bounce`, a lift a channel): under the town's high sun nothing lights it, and it read as
 * a hole. At night it dims by `night`, as the balloon does, and keeps a faint fill of its own
 * (`fill`): dark, never black (dimAtNight).
 */
export const SKY_ROCK = {
  grid: 0.25,
  body: { top: 0.42, cliff: 1.5, share: 0.955, belly: 1.2 },
  tip: { from: 6.2, r: [0.7, 0.24] as [number, number], fillet: 0.6, swell: 0.11 },
  lobes: [
    // The earth's chunky shoulders in the cliffs under the rim: fullest under the south and
    // south-east rims (the file's and the opening bearing's side), and where each view's outline runs
    // (east-north-east and west-south-west for the file, north-west and south-west for the Rotate
    // stops); none proud of the rim on the north tip (the plane's side), none under the falls (105
    // and 265 degrees).
    lobe(15, 0.32, -1.6, 0.8, 1.6, 0.8, 0.05),
    lobe(58, 0.32, -1.8, 0.8, 1.4, 0.85, -0.05),
    lobe(132, 0.3, -1.5, 0.7, 1.2, 0.75, 0.06),
    lobe(228, 0.28, -1.55, 0.7, 1.3, 0.8, -0.05),
    lobe(312, 0.32, -1.7, 0.8, 1.4, 0.8, 0.05),
  ],
  outcrops: [
    // South-south-west, the biggest (the file and the opening bearing, and the fourth stop); south,
    // higher; south-south-east low down (the first stop); east-north-east (the first and second);
    // north-north-west (the second and third); west-north-west low down (the third and fourth);
    // west-south-west (the fourth). None on the north-east flank: from the town's second Rotate stop
    // (its camera to the north-east, at the town's pitch) the body hangs least under the near rim,
    // and rock there widened its foot past a fifth of the deck (check-town).
    outcrop(-22, -3.0, 1.5, 0.85, 3),
    outcrop(10, -2.5, 1.1, 0.6, 7),
    outcrop(36, -4.8, 1.25, 0.72, 11),
    outcrop(72, -3.2, 1.2, 0.7, 13),
    outcrop(205, -3.0, 1.35, 0.75, 23),
    outcrop(245, -3.9, 1.15, 0.68, 29),
    outcrop(295, -3.4, 1.35, 0.75, 31),
  ],
  round: 0.5,
  edge: 0.2,
  fillet: 0.6,
  set: 0.82,
  crevice: 0.8,
  bounce: [1.7, 1.35, 1.6] as [number, number, number],
  night: 0.3,
  fill: '#3f3026',
  cut: 0.2,
  beds: [1.9, 4.0, 6.4],
  seam: [0.3, 0.75] as [number, number],
  seamTone: 0.4,
  change: 0.45,
  spike: [6.4, 7.4] as [number, number],
};
/**
 * An outcrop's stones (SKY_ROCK.outcrops), each one of the armour's boulders (town-sky-garden's
 * boulder: a jittered icosahedron pushed toward a rounded block, with the block's own normals, so it
 * shades as one smooth chunk), in the outcrop's own frame on the flank (t along it, level; u up it; n
 * out of it, the earth's own normal there) at size 1: its middle (`at`) and half sizes (`half`), its
 * roll about n (`roll`, the bedding's dip as the view sees it) and its pitch about t (`pitch`, its
 * top tipped back into the slope or forward), how square it is (`square`), its icosahedron's
 * `detail` (the small ones' 1: 80 triangles) and its fracture planes (`cuts`, chisel's: a normal in
 * its own unit frame and how far out the plane lies). A big block broken into flat faces at its front
 * and top; a thinner bed stepped back over it, so the strata read; a piece split off its side, a
 * V-crack between them (the fracture); a stone of scree at its foot and two pebbles beside it.
 * Mirrored for half the seeds; each stone sized, turned and shaded a little its own way by its seed.
 * Each stone sits a good part buried in the earth (the outcrop's outermost face `proud` past it), and
 * what the earth or another stone buries is left out.
 */
export const OUTCROP_STONES = [
  { at: [0, 0, 0], half: [0.74, 0.47, 0.6], roll: 0.12, pitch: 0.2, square: 0.66, detail: 2, cuts: [[0, 0.7, 0.7, 0.7], [0.75, 0.15, 0.65, 0.78], [-0.7, 0.35, 0.6, 0.8], [0.2, 0.95, 0.2, 0.82]] },
  { at: [0.38, 0.5, -0.12], half: [0.55, 0.26, 0.5], roll: -0.06, pitch: 0.3, square: 0.62, detail: 2, cuts: [[0, 0.85, 0.5, 0.72], [0.7, 0.3, 0.6, 0.8]] },
  { at: [-0.84, -0.05, -0.1], half: [0.3, 0.38, 0.5], roll: 0.32, pitch: 0.1, square: 0.55, detail: 1, cuts: [[-0.6, 0.3, 0.75, 0.74], [0.3, 0.8, 0.5, 0.8]] },
  { at: [-0.3, -0.56, 0.02], half: [0.2, 0.15, 0.2], roll: 0.2, pitch: 0, square: 0.45, detail: 1, cuts: [] },
  { at: [0.5, -0.46, 0], half: [0.15, 0.11, 0.15], roll: -0.3, pitch: 0, square: 0.45, detail: 1, cuts: [] },
  { at: [-1.15, -0.42, 0], half: [0.12, 0.09, 0.12], roll: 0.4, pitch: 0, square: 0.4, detail: 1, cuts: [] },
] as { at: [number, number, number]; half: [number, number, number]; roll: number; pitch: number; square: number; detail: number; cuts: [number, number, number, number][] }[];
/**
 * A stone split along fracture planes (in its own unit frame, each a normal and how far out it lies):
 * every corner beyond a plane is laid on it, so the stone shows flat broken faces. Round them the
 * normals are the faces' own (each corner the area-weighted mean of the faces about it: the plane's
 * own inside a broken face, a soft fall-off over one row of triangles at its edge, never a knife
 * edge); the rest of the stone keeps the rounded block's. The planes cut only a shallow cap of the
 * block, so no face turns over.
 */
function chisel(geometry: T.BufferGeometry, cuts: [number, number, number, number][]) {
  const p = geometry.getAttribute('position'),
    n = geometry.getAttribute('normal'),
    index = geometry.getIndex()!,
    moved = new Uint8Array(p.count),
    v = new T.Vector3(),
    m = new T.Vector3();
  for (const [mx, my, mz, d] of cuts) {
    m.set(mx, my, mz).normalize();
    for (let i = 0; i < p.count; i++) {
      const over = v.fromBufferAttribute(p, i).dot(m) - d;
      if (over <= 0) continue;
      p.setXYZ(i, v.x - m.x * over, v.y - m.y * over, v.z - m.z * over);
      moved[i] = 1;
    }
  }
  // The corners of every face that a cut moved, and the faces' own normals summed about them.
  const near = new Uint8Array(p.count),
    sum = new Float32Array(p.count * 3),
    a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3();
  for (let t = 0; t < index.count; t += 3) {
    const k = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    a.fromBufferAttribute(p, k[0]);
    b.fromBufferAttribute(p, k[1]).sub(a);
    c.fromBufferAttribute(p, k[2]).sub(a);
    b.cross(c);
    for (const i of k) {
      sum[i * 3] += b.x;
      sum[i * 3 + 1] += b.y;
      sum[i * 3 + 2] += b.z;
    }
    if (k.some((i) => moved[i])) for (const i of k) near[i] = 1;
  }
  for (let i = 0; i < p.count; i++) {
    if (!near[i]) continue;
    v.fromArray(sum, i * 3).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return geometry;
}

/**
 * The earth's body, for town-sculpt, in the deck's own frame: an ellipse of half-axes a and b at
 * `share` of their size, standing straight down as cliffs from above `top` to `cliff` under it,
 * then tapering to its tip, `depth` under it at (tx, tz): `k` of the way down the taper its
 * section is the ellipse at share x (1 - k^belly) (over 1, a convex belly, full under the rim and
 * narrowing to the point at the last), its middle moved toward the tip as k squared. A bound that is
 * close to the true distance near its surface.
 */
function earthBody(a: number, b: number, top: number, cliff: number, depth: number, share: number, belly: number, tx: number, tz: number): Shape {
  const run = depth - cliff,
    // The flank's lean at its flattest (at the tip, on the long axis, the lean added), so the bound never overstates the distance.
    lean = Math.cos(Math.atan((share * belly * Math.max(a, b) + 2 * Math.hypot(tx, tz)) / run));
  return {
    d(x, y, z) {
      const t = -y;
      if (t >= depth) return Math.hypot(x - tx, z - tz, t - depth);
      const k = Math.max(0, (t - cliff) / run),
        out = Math.hypot((x - tx * k * k) / a, (z - tz * k * k) / b);
      return (out - share * (1 - k ** belly)) * Math.min(a, b) * lean;
    },
    min: [-a * share - Math.abs(tx), -depth, -b * share - Math.abs(tz)],
    max: [a * share + Math.abs(tx), -top + 1, b * share + Math.abs(tz)],
  };
}
/**
 * The earth body's section `depth` under SKY.top (earthBody's, from SKY_ROCK.body and the tip's
 * place): its middle in the deck's frame and its size, a share of the rim's ellipse.
 */
function bodySection(depth: number) {
  const S = plan.SKY,
    B = SKY_ROCK.body,
    [tx, tz] = plan.skyLocal(plan.skyTip().x, plan.skyTip().z),
    k = Math.min(1, Math.max(0, (depth - B.cliff) / (S.depth - SKY_ROCK.tip.swell - B.cliff)));
  return { x: tx * k * k, z: tz * k * k, share: B.share * (1 - k ** B.belly) };
}
/** A bearing's direction in the deck's frame (x north, z east). */
function bearingDirection(bearing: number) {
  const b = (bearing * Math.PI) / 180;
  return { dx: -Math.cos(b), dz: Math.sin(b) };
}
/**
 * A shoulder as a solid in the deck's own frame: its middle on its bearing from the body's middle at
 * its depth, its radial half along it, its outer face `proud` of the body's surface there.
 */
function lobeShape(l: Lobe): Shape {
  const S = plan.SKY,
    { dx, dz } = bearingDirection(l.bearing),
    body = bodySection(-l.y),
    // The body's reach along the bearing.
    r = body.share / Math.hypot(dx / S.a, dz / S.b) + l.proud - l.radial;
  return roundBox([body.x + r * dx, l.y, body.z + r * dz], [l.radial, l.vertical, l.tangential], Math.max(SKY_ROCK.edge, SKY_ROCK.round * Math.min(l.radial, l.vertical, l.tangential)), [l.tilt, Math.atan2(-dz, dx), 0]);
}
/** One stone of an outcrop, placed in the deck's own frame: its matrix (from the boulder's own frame) and that matrix's inverse, its seed and its shade. */
type OutcropStone = { matrix: T.Matrix4; inverse: T.Matrix4; seed: number; square: number; detail: number; cuts: [number, number, number, number][]; tone: number; outcrop: number };
/**
 * An outcrop's stones (OUTCROP_STONES) in the deck's own frame, set on the earth `field` (the
 * sculpted mass's exact distance): where its bearing meets the earth at its depth (found from the
 * body's middle outward), the frame of the earth's own normal there (n, out of the flank; t, level
 * along it; u, up it); its outermost stone `proud` past that surface.
 */
function outcropStones(o: Outcrop, k: number, field: (x: number, y: number, z: number) => number): OutcropStone[] {
  const { dx, dz } = bearingDirection(o.bearing),
    body = bodySection(-o.y),
    at = (r: number) => field(body.x + r * dx, o.y, body.z + r * dz);
  // Out from the body's middle to the first point outside the earth, then halved down to the surface.
  let r0 = 0,
    r1 = 0.1;
  while (at(r1) < 0 && r1 < 12) {
    r0 = r1;
    r1 += 0.1;
  }
  for (let i = 0; i < 24; i++) {
    const m = (r0 + r1) / 2;
    if (at(m) < 0) r0 = m;
    else r1 = m;
  }
  const r = (r0 + r1) / 2,
    surface = new T.Vector3(body.x + r * dx, o.y, body.z + r * dz),
    e = 0.05,
    n = new T.Vector3(
      field(surface.x + e, surface.y, surface.z) - field(surface.x - e, surface.y, surface.z),
      field(surface.x, surface.y + e, surface.z) - field(surface.x, surface.y - e, surface.z),
      field(surface.x, surface.y, surface.z + e) - field(surface.x, surface.y, surface.z - e),
    ).normalize(),
    t = new T.Vector3(n.z, 0, -n.x).normalize(),
    u = new T.Vector3().crossVectors(n, t),
    frame = new T.Matrix4().makeBasis(t, u, n),
    // Mirrored for half the seeds; the cluster's outermost face `proud` past the surface.
    flip = hash(o.seed * 3.17 + 0.5) < 0.5 ? -1 : 1,
    out = Math.max(...OUTCROP_STONES.map((s) => s.at[2] + s.half[2])) * o.size,
    origin = surface.clone().addScaledVector(n, o.proud - out);
  return OUTCROP_STONES.map((s, j) => {
    const seed = o.seed * 7 + j * 13,
      jitter = (i: number, a: number) => (hash(seed * 1.93 + i * 4.71) - 0.5) * 2 * a,
      half = s.half.map((h, i) => h * o.size * (1 + jitter(i, 0.12))),
      middle = origin
        .clone()
        .addScaledVector(t, flip * s.at[0] * o.size)
        .addScaledVector(u, s.at[1] * o.size)
        .addScaledVector(n, s.at[2] * o.size),
      turn = new T.Matrix4()
        .makeRotationZ(flip * s.roll + jitter(3, 0.1))
        .multiply(new T.Matrix4().makeRotationX(s.pitch + jitter(4, 0.1)))
        .multiply(new T.Matrix4().makeRotationY(jitter(5, 0.25))),
      matrix = new T.Matrix4()
        .makeTranslation(middle.x, middle.y, middle.z)
        .multiply(frame)
        .multiply(turn)
        .multiply(new T.Matrix4().makeScale(half[0], half[1], half[2]));
    return {
      matrix,
      inverse: matrix.clone().invert(),
      seed,
      square: s.square,
      detail: s.detail,
      cuts: s.cuts.map(([x, y, z, d]): [number, number, number, number] => [flip * x, y, z, d]),
      tone: 0.94 + 0.12 * hash(seed * 2.3 + 1.1),
      outcrop: k,
    };
  });
}
/** How far into a stone a point lies, in its own unit frame: under 1 inside the boulder's inscribed ball (its corners are pushed out from it). */
const stonePoint = new T.Vector3(),
  stoneDepth = (s: OutcropStone, x: number, y: number, z: number) => stonePoint.set(x, y, z).applyMatrix4(s.inverse).length(),
  /** Whether a point lies well inside a stone: inside its inscribed ball by a tenth, and behind every fracture plane. */
  inStone = (s: OutcropStone, x: number, y: number, z: number) => {
    const v = stonePoint.set(x, y, z).applyMatrix4(s.inverse);
    return v.length() < 0.9 && s.cuts.every(([mx, my, mz, d]) => (v.x * mx + v.y * my + v.z * mz) / Math.hypot(mx, my, mz) < d - 0.05);
  };
/** One point of a swept band: where it is, its outward normal (in x, z) and its base height. */
type Station = { x: number; z: number; nx: number; nz: number; y: number };
/**
 * A garden piece's place on the island, as lane G's builders take it: where its own frame's origin
 * goes and its rotation.y (its local +z turns to that bearing, as a site's front does).
 */
export type SkySlot = { x: number; y: number; z: number; ry: number };
/**
 * Where each of lane G's garden pieces (town-sky-garden's createSkyGarden) stands; each builds in a
 * frame of its own, y 0 its foot (a lamp set's spots are in its group's frame):
 * - `tea`: teaTable(), its middle on the lawn, turned so its -x chair (hers) faces SKY_STATIONS'.
 * - `telescope`: telescope({ eyepiece, tilt }), the tripod's middle, looking along its +z at the
 *   Town Hall: its tube along her own gaze (`tilt` below level), its eyepiece `eyepiece` over the
 *   tripod's foot, which is her eye over the lawn she stands on behind it.
 * - `bench`: props.bench(), facing the town.
 * - `tree`: nature.tree() of the plan's `size` and `kind` (it stands a tree on the town's terrain:
 *   move its group up to `y`).
 * - `borders`: the town's flower bed for each (east, then west): its middle, `w` along the terrace
 *   and `d` deep (its kerb's outline), and `floor`, the lowest lawn under that kerb, which it stands
 *   on (the dome falls away under it: set level into the lawn's higher side, it never floats over
 *   the lower).
 * - `lamps`: gardenLamps(spots), one set, its group at the island's middle (south of the
 *   airport's lamps' line), the spots each lamp's foot in that group's frame.
 * - `falls`: fall({ rise }) for each: the rim point at the deck's level, turned out over the sea.
 * - `clouds` and `rocks`: cloud({ size, seed }) and floatingRock({ size, seed }), where the plan's
 *   SKY_CLOUDS and SKY_ROCKS put them (in the air, so `y` is theirs, not the lawn's).
 * - `urns`: urn({ planted: true }), the clipped planting (plan.SKY_URNS).
 * Pieces on the deck stand on the lawn (plan.skyTop).
 */
export function skySlots() {
  const on = (x: number, z: number, ry = 0): SkySlot => ({ x, y: plan.skyTop(x, z), z, ry }),
    { tea, telescope, bench } = plan.SKY_STATIONS,
    border = (b: (typeof plan.SKY_BORDERS)['east']) => {
      // The lawn under the kerb, sampled finely enough to find its lowest corner.
      let floor = Infinity;
      for (let i = 0; i <= 16; i++) for (let j = 0; j <= 8; j++) floor = Math.min(floor, plan.skyTop(b.x0 + ((b.x1 - b.x0) * i) / 16, b.z0 + ((b.z1 - b.z0) * j) / 8));
      return { ...on((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2), w: b.x1 - b.x0, d: b.z1 - b.z0, floor };
    },
    lamps = on(plan.SKY.x, plan.SKY.z);
  return {
    tea: on(tea.x, tea.z, tea.ry),
    telescope: { ...on(telescope.x, telescope.z, telescope.ry), eyepiece: telescope.eyepiece, tilt: plan.SKY_SEATS.tilt },
    bench: on(bench.x, bench.z, bench.ry),
    tree: { ...on(plan.SKY_TREE.x, plan.SKY_TREE.z), size: plan.SKY_TREE.size, kind: plan.SKY_TREE.kind },
    borders: [border(plan.SKY_BORDERS.east), border(plan.SKY_BORDERS.west)],
    lamps: { ...lamps, spots: plan.SKY_LAMPS.map(([x, z]) => ({ x: x - lamps.x, y: plan.skyTop(x, z) - lamps.y, z: z - lamps.z })) },
    falls: plan.skyFalls.map((f) => ({ x: f.x, y: f.y, z: f.z, ry: f.ry, rise: f.rise })),
    clouds: plan.SKY_CLOUDS.map((c) => ({ ...c })),
    rocks: plan.SKY_ROCKS.map((r) => ({ ...r })),
    urns: plan.SKY_URNS.map(([x, z]) => on(x, z)),
  };
}

/**
 * The flower borders' planting (skyBorder): each is the town's flower bed's kerb (the border's own
 * outline, drawn in at its outer end by `trim`, so the walk's turn up to the telescope clears it), and
 * inside it, in place of the bed's smooth green bar (the art review: its row of five like blobs on the
 * bar read as beads or sweets), a bed of flowering plants: a low leafy planting (`leaves`) and the
 * town's own blooms over it in two staggered rows along the back (`rows`).
 * - The leaves: one mound over the bar's footprint (reaching back over the kerb to `wall` from the
 *   terrace wall), its edge `base` over the floor, tucked into the kerb, over a level (`level`: at the back, against the terrace wall, and at the front) rising to
 *   two rows of clumps (`clumps`: each row's line in from the terrace wall, its clumps' reach and
 *   height (from, to) and how many; the front row set off from the back's), so its outline is a row
 *   of soft clumps, taller at the back; a heightfield of `cells` (along, across) with its own
 *   normals, painted in the hedge's green with lighter crowns and darker hollows.
 * - The blooms: `count` a row; each row `back` in from the terrace wall, its blooms sized a share
 *   (`size`, from, to) of the town's bloom (0.6 at least: the bloom, squashed, then stands 0.07 tall,
 *   the thinnest part the town allows), each nestled in the leaves under it (its middle `sit` over
 *   them); the back row on the tall clumps' crowns and larger, the front one between them. Each
 *   bloom's colour is one of the border's own (`palette`, the town's bloom colours, by its seed: its
 *   pink, red and purple, near the leaves' own value, so the many small blooms never twinkle as the
 *   view moves, where white ones on the dark leaves did), and
 *   its size and place a little its own, so no two neighbours match; the west border mirrors the
 *   east, so the pair flanks the steps alike.
 * Her watering can (sky-figure's ALISON: reaching 0.60 at the most, hanging no lower than 0.48 over
 * her feet) passes over the low front of the planting as she walks the watering stretch: the blooms
 * stand at the back, out of its way, and the leaves under its reach stay as low as the bar was.
 */
export const SKY_BEDS = {
  trim: 0.15,
  leaves: {
    base: 0.2,
    wall: 0.03,
    level: [0.31, 0.25] as [number, number],
    clumps: [
      { back: 0.14, r: 0.1, h: [0.1, 0.13] as [number, number], count: 7 },
      { back: 0.35, r: 0.09, h: [0.06, 0.09] as [number, number], count: 7 },
    ],
    cells: [16, 5] as [number, number],
  },
  rows: [
    { back: 0.115, size: [0.7, 0.85] as [number, number] },
    { back: 0.172, size: [0.6, 0.68] as [number, number] },
  ],
  count: 7,
  sit: 0.008,
  palette: [2, 0, 2, 4, 2, 0],
  seeds: [53, 59],
};
/** The tree's seed (town-nature's tree index): its turn and its crown's clumps. */
export const SKY_TREE_SEED = 3;
/** A border's slot (skySlots' `borders`). */
type BorderSlot = ReturnType<typeof skySlots>['borders'][number];
/**
 * One flower border (SKY_BEDS; `k` 0 is the east one, 1 the west), in a group of its own in g: the
 * town's flower bed's kerb standing on the lowest lawn under it, its leafy planting and its blooms.
 */
export function skyBorder(nature: Nature, g: T.Object3D, b: BorderSlot, k: number) {
  const bed = new T.Group(),
    side = k ? -1 : 1,
    B = SKY_BEDS,
    // Its middle, drawn in toward the steps with its outer end.
    x = b.x - (side * B.trim) / 2,
    // The bed inside the kerb (flowerBed's kerb stands 0.08 proud of the bed it is given all round),
    // and the bar's footprint in it (0.02 in), where the leaves grow.
    w = b.w - B.trim - 0.16,
    d = b.d - 0.16,
    hw = w / 2 - 0.02,
    hd = d / 2 - 0.02,
    back = b.z - b.d / 2,
    seed = B.seeds[0];
  bed.name = 'sky-border';
  g.add(bed);
  nature.flowerBed(bed, x, b.floor, b.z, w, d, B.seeds[k]);
  // The bed's own bar and blooms make way for the planting (the leaves take the bar's material: the
  // foliage's, white, their colours on their vertices).
  const planted = bed.children.filter((o): o is T.Mesh => o instanceof T.Mesh && o.material instanceof T.Material && o.material.userData.surfaceKind === 'foliage'),
    bar = planted.find((o) => !o.userData.noShadow)!;
  for (const o of planted) o.removeFromParent();
  // The leaves: a heightfield over the bar's footprint (u along the bed, from the steps' end when
  // mirrored; z across it, from the terrace wall), the clumps' crowns summed over a level that falls
  // from the back to the front and rolls down into the kerb all round.
  const L = B.leaves,
    [nu, nv] = L.cells,
    // (At the back the leaves grow over the kerb to the terrace wall; at the front and ends they stop
    // where the bar did, so her can and the kerb's top stay as they were.)
    z0 = L.wall,
    z1 = 0.1 + 2 * hd,
    // A place along the bed, a share `f` of the way, kept 6% in from either end.
    along = (f: number) => -hw + 2 * hw * (0.06 + 0.88 * f),
    clumps = L.clumps.flatMap((row, r) =>
      Array.from({ length: row.count }, (_, i) => ({
        u: along((i + (r ? 0.75 : 0.25)) / row.count) + (hash(seed + r * 13.1 + i * 3.7) - 0.5) * 0.06,
        z: row.back,
        r: row.r,
        h: T.MathUtils.lerp(row.h[0], row.h[1], hash(seed + r * 7.9 + i * 5.3 + 1.7)),
      })),
    ),
    crown = (u: number, z: number) => clumps.reduce((sum, q) => sum + q.h * Math.exp(-((u - q.u) ** 2 + (z - q.z) ** 2) / (q.r * q.r)), 0),
    height = (u: number, z: number) => {
      const edge = T.MathUtils.smoothstep(Math.min(hw - Math.abs(u), z - z0, z1 - z), 0, 0.07),
        level = T.MathUtils.lerp(L.level[0], L.level[1], (z - z0) / (z1 - z0));
      return L.base + (level - L.base + crown(u, z)) * edge;
    },
    pos: number[] = [],
    nor: number[] = [],
    col: number[] = [],
    index: number[] = [],
    hedge = new T.Color(palette.hedge),
    top = new T.Color(palette.hedgeTop),
    c = new T.Color(),
    n = new T.Vector3(),
    e = 0.01,
    most = Math.max(...clumps.map((q) => q.h)),
    highest = L.level[0] + most;
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const u = -hw + (i / nu) * 2 * hw,
        z = z0 + (j / nv) * (z1 - z0),
        h = height(u, z),
        bump = crown(u, z) / most;
      pos.push(x + side * u, b.floor + h, back + z);
      n.set(-(height(u + e, z) - height(u - e, z)) * side, 2 * e, -(height(u, z + e) - height(u, z - e))).normalize();
      nor.push(n.x, n.y, n.z);
      // The hedge's green, lighter up the planting and on the crowns that face the sky, darker in the hollows between them.
      c.copy(hedge)
        .lerp(top, 0.55 * T.MathUtils.smoothstep(n.y, 0.4, 0.95) * T.MathUtils.smoothstep(bump, 0.3, 0.9))
        .multiplyScalar(T.MathUtils.lerp(0.9, 1.06, (h - L.base) / (highest - L.base)) * T.MathUtils.lerp(0.86, 1, T.MathUtils.smoothstep(bump, 0.1, 0.6)));
      col.push(c.r, c.g, c.b);
    }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i,
        q = a + nu + 1;
      // Wound to face up whichever way the border is mirrored.
      if (side > 0) index.push(a, q, a + 1, a + 1, q, q + 1);
      else index.push(a, a + 1, q, a + 1, q + 1, q);
    }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  geometry.setIndex(index);
  const leaves = new T.Mesh(geometry, bar.material);
  leaves.name = 'sky-border-leaves';
  leaves.castShadow = leaves.receiveShadow = true;
  bed.add(leaves);
  // The blooms: two staggered rows along the back (the back one on the tall clumps' crowns, the front
  // one between them), each nestled in the leaves under it, its colour, size and place by its seed.
  B.rows.forEach((row, r) => {
    let last = -1;
    for (let i = 0; i < B.count; i++) {
      const h = (k: number) => hash(seed + r * 31.7 + i * 7.3 + k),
        u = along((i + (r ? 0.75 : 0.25)) / B.count) + (h(1) - 0.5) * 0.04;
      let pick = Math.floor(h(2) * B.palette.length) % B.palette.length;
      if (B.palette[pick] === last) pick = (pick + 1) % B.palette.length;
      last = B.palette[pick];
      const size = T.MathUtils.lerp(row.size[0], row.size[1], h(3)),
        bloom = nature.bloom(bed, x + side * u, b.floor + height(u, row.back) + B.sit, back + row.back, BLOOMS[last]);
      bloom.scale.multiplyScalar(size);
    }
  });
  return bed;
}
/**
 * The outcrop (plan.SKY_OUTCROP): the rock's own cool grey breaking through the turf, three rounded
 * blocks of falling size (`lumps`: each one's middle, half sizes, rounding and tilt, in the outcrop's
 * frame, y 0 the lawn) blended by a small `fillet` into one low group of stones, sculpted on a grid of
 * `grid` (smooth: its normals are the field's own), its foot cut flat `sink` under the lawn so the
 * dome never shows a gap under it. Its creases between the stones take a shade (`crease`, read from
 * the field: how soon a step out along the normal meets another stone), as the clouds' valleys do.
 */
export const SKY_OUTCROP_SHAPE = {
  grid: 0.065,
  fillet: 0.06,
  sink: 0.12,
  crease: 0.78,
  lumps: [
    { c: [0, 0.06, 0], h: [0.5, 0.38, 0.4], round: 0.3, rot: [0.08, 0, -0.1] },
    { c: [0.62, -0.02, 0.24], h: [0.32, 0.27, 0.28], round: 0.2, rot: [-0.12, 0.5, 0.1] },
    { c: [-0.52, -0.05, -0.26], h: [0.28, 0.19, 0.24], round: 0.15, rot: [0.12, -0.4, 0.06] },
  ] as { c: [number, number, number]; h: [number, number, number]; round: number; rot: [number, number, number] }[],
};

/**
 * The garden lamps' pools of light on the deck at night, as the street lamps on the square throw
 * theirs, but with no light in the scene (a phone pays for every one) and nothing see-through: under
 * the lamps (plan.SKY_LAMPS, wherever they stand) the deck's own surface (the lawn's stripes, the
 * paths' gravel) is laid again over itself `lift` up, out to `r` from each lamp's foot, in the
 * colour that ground shows by day (the lawn's grain and tint folded in) and a matte finish as rough
 * as the lawn's, so by day it cannot be told from the ground. At night the town's wall wash
 * (city-materials, through batch()'s aWash, at the night's level) lights it warm from the lamp's
 * foot out: `strength` at the middle, fading to nothing at `r` (a vertex's u runs from the wash's
 * peak at the foot out to where its scallop has faded, so the pool is round and soft-edged; where
 * two pools meet each point takes the nearer lamp's). `cell` is the size its triangles are cut to,
 * so the pool's fall-off is smooth.
 */
export const SKY_POOL = { r: 0.9, strength: 0.38, lift: 0.006, cell: 0.26 };
/** Where the wash's up scallop has faded out (city-materials' WASH_SHAPE.upFade[1]). */
const POOL_EDGE = 0.85;

/* ------------------------------------------------------------------ */
/* The sky island                                                      */
/* ------------------------------------------------------------------ */
/**
 * The sky island's own ground: its lawn and paths, its garden (lane G's kit, `garden`, with the
 * town's own bench, tree, flower beds and clipped box, and an outcrop of its own rock), and the rock
 * under it and its coping (its villa is town-sky-villa's).
 */
export function createSkyIsland(ctx: TownContext, props: Props, nature: Nature, garden: SkyGarden) {
  const { material } = ctx;
  const S = plan.SKY,
    L = SKY_LOOK;

  /** A mesh of `geometry` in the material (colour, kind), added to g. */
  function solid(g: T.Object3D, geometry: T.BufferGeometry, colour: string, kind: SurfaceKind, opts: { shadow?: boolean; ground?: boolean; band?: boolean; name?: string } = {}) {
    const m = new T.Mesh(geometry, material(colour, kind));
    m.castShadow = opts.shadow ?? true;
    m.receiveShadow = true;
    if (opts.shadow === false) m.userData.noShadow = true;
    if (opts.ground) m.userData.ground = true;
    if (opts.band) m.userData.band = true;
    if (opts.name) m.name = opts.name;
    g.add(m);
    return m;
  }
  /** The lawn's own normal at (x, z): the dome's, so the stripes and the paths shade as one surface. */
  function lawnNormal(x: number, z: number) {
    const e = 0.05;
    return new T.Vector3(plan.skyTop(x - e, z) - plan.skyTop(x + e, z), 2 * e, plan.skyTop(x, z - e) - plan.skyTop(x, z + e)).normalize();
  }
  /** The deck's own triangles as the lawn and the paths lay them (draped's record), for the lamps' pools. */
  const deck = { lawn: [] as { a: plan.XZ; b: plan.XZ; c: plan.XZ; tone?: T.Color }[], gravel: [] as { a: plan.XZ; b: plan.XZ; c: plan.XZ }[] };
  /**
   * A flat surface laid on the lawn, `lift` over it, from the triangles it is given (in x, z, any
   * winding: each is turned to face up); every vertex stands on the dome and takes its normal. Each
   * triangle (turned to face up) is kept in `record` if one is given.
   */
  function draped(lift: number, record?: { a: plan.XZ; b: plan.XZ; c: plan.XZ; tone?: T.Color }[]) {
    const pos: number[] = [],
      nor: number[] = [],
      colours: number[] = [];
    const put = (x: number, z: number, tone?: T.Color) => {
      pos.push(x, plan.skyTop(x, z) + lift, z);
      lawnNormal(x, z).toArray(nor, nor.length);
      if (tone) colours.push(tone.r, tone.g, tone.b);
    };
    return {
      triangle(a: plan.XZ, b: plan.XZ, c: plan.XZ, tone?: T.Color) {
        const turn = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
        if (Math.abs(turn) < 1e-9) return;
        for (const p of turn > 0 ? [a, b, c] : [a, c, b]) put(p[0], p[1], tone);
        record?.push(turn > 0 ? { a, b, c, tone } : { a, b: c, c: b, tone });
      },
      geometry() {
        const geometry = new T.BufferGeometry();
        geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
        geometry.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
        if (colours.length) geometry.setAttribute('color', new T.Float32BufferAttribute(colours, 3));
        return geometry;
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* The deck: lawn and paths                                          */
  /* ---------------------------------------------------------------- */
  /** The mown lawn (SKY_LAWN): stripes along the deck's long axis, alternately the darker and the lighter green. */
  function lawn(g: T.Object3D) {
    const { stripe, edge, rows } = SKY_LAWN,
      half = S.b * edge,
      // A stripe's ends follow the turf's outline: how far it runs either way at lz across the deck.
      reach = (lz: number) => S.a * edge * Math.sqrt(Math.max(0, 1 - (lz / half) ** 2)),
      tones = L.lawn.map((c) => new T.Color(c)),
      turf = draped(0, deck.lawn);
    // The stripes' edges are whole stripes from the long axis, so the outermost stripe that shows
    // beside the coping is most of a stripe wide (0.74), never a sliver.
    const bounds = [-half];
    for (let k = Math.ceil(-half / stripe); k * stripe < half; k++) if (k * stripe > -half) bounds.push(k * stripe);
    bounds.push(half);
    for (let s = 0; s + 1 < bounds.length; s++) {
      const z0 = bounds[s],
        z1 = bounds[s + 1],
        tone = tones[Math.abs(Math.floor((z0 + z1) / 2 / stripe)) % 2],
        at = (lz: number, j: number) => plan.skyPoint(((2 * j) / rows - 1) * reach(lz), lz);
      for (let j = 0; j < rows; j++) {
        turf.triangle(at(z0, j), at(z1, j), at(z1, j + 1), tone);
        turf.triangle(at(z0, j), at(z1, j + 1), at(z0, j + 1), tone);
      }
    }
    solid(g, turf.geometry(), '#ffffff', 'grass', { shadow: false, ground: true, name: 'sky-lawn' });
  }
  /** The gravel paths (plan.SKY_PATHS), laid on the lawn: ribbons with round ends, and the round landing. */
  function paths(g: T.Object3D) {
    const P = plan.SKY_PATHS,
      half = P.width / 2,
      gravel = draped(P.lift, deck.gravel);
    const disc = ([x, z]: plan.XZ, r: number, sides: number) => {
      const rim = (k: number): plan.XZ => [x + Math.cos((k / sides) * Math.PI * 2) * r, z + Math.sin((k / sides) * Math.PI * 2) * r];
      for (let k = 0; k < sides; k++) gravel.triangle([x, z], rim(k), rim(k + 1));
    };
    /** Points about 0.25 apart along the line through `points`: straight from one to the next, or one smooth curve through them all. */
    const along = (points: plan.XZ[], curved: boolean): plan.XZ[] => {
      if (curved) {
        const curve = new T.CatmullRomCurve3(points.map(([x, z]) => new T.Vector3(x, 0, z)), false, 'centripetal');
        return curve.getSpacedPoints(Math.ceil(curve.getLength() / 0.25)).map((v): plan.XZ => [v.x, v.z]);
      }
      return points.flatMap((a, i): plan.XZ[] => {
        const b = points[i + 1];
        if (!b) return [a];
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25));
        return Array.from({ length: steps }, (_, k): plan.XZ => [a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]);
      });
    };
    const ribbon = (line: plan.XZ[]) => {
      // A point's two edges: `half` either side of it, across the line's direction there.
      const edge = (i: number, side: number): plan.XZ => {
        const a = line[Math.max(0, i - 1)],
          b = line[Math.min(line.length - 1, i + 1)],
          l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [line[i][0] + (side * (b[1] - a[1]) * half) / l, line[i][1] - (side * (b[0] - a[0]) * half) / l];
      };
      for (let i = 0; i + 1 < line.length; i++) {
        gravel.triangle(edge(i, -1), edge(i, 1), edge(i + 1, 1));
        gravel.triangle(edge(i, -1), edge(i + 1, 1), edge(i + 1, -1));
      }
      disc(line[0], half, 16);
      disc(line[line.length - 1], half, 16);
    };
    ribbon(along(P.walk, true));
    ribbon(along(P.stem, false));
    disc([P.landing.x, P.landing.z], P.landing.r, 32);
    solid(g, gravel.geometry(), L.path, 'gravel', { shadow: false, ground: true, name: 'sky-paths' });
  }
  /**
   * The lamps' pools (SKY_POOL), one mesh laid over the deck: the lawn's and the paths' own triangles
   * near any lamp, cut to SKY_POOL.cell, at their own colours (the lawn's as its ground shader shows
   * it under the island: its stripe, the grass map's grain and the lawn tint the empty ground masks
   * leave, city-materials' LAWN_TINT; the gravel's plain), each vertex carrying the nearer lamp's
   * wash. As flat ground (`ground`) it takes no contact shade; it casts nothing.
   */
  function lampPools(g: T.Object3D) {
    const P = SKY_POOL,
      lamps = plan.SKY_LAMPS,
      reach = P.r + P.cell,
      map = material('#ffffff', 'grass').map,
      image = map?.image as { data: Uint8Array; width: number; height: number } | undefined,
      // The grain as the ground shader samples it: linear, bilinear at its finest level, repeating.
      lut = Float32Array.from({ length: 256 }, (_, v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)),
      grain = (x: number, z: number) => {
        if (!image || !map) return 1;
        const W = image.width,
          H = image.height,
          u = x * map.repeat.x * W - 0.5,
          v = z * map.repeat.y * H - 0.5,
          i = Math.floor(u),
          j = Math.floor(v),
          fu = u - i,
          fv = v - j,
          at = (a: number, b: number) => lut[image.data[((((b % H) + H) % H) * W + (((a % W) + W) % W)) * 4]];
        return (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv;
      },
      tint = LAWN_TINT,
      path = new T.Color(L.path),
      pos: number[] = [],
      nor: number[] = [],
      col: number[] = [],
      wash: number[] = [],
      near = (x: number, z: number) => {
        let d = Infinity;
        for (const [lx, lz] of lamps) d = Math.min(d, (x - lx) ** 2 + (z - lz) ** 2);
        return Math.sqrt(d);
      },
      /** A vertex's attributes, worked out once and laid down by every triangle that shares it. */
      vertex = (x: number, z: number, lift: number, tone?: T.Color) => {
        const n = lawnNormal(x, z),
          d = near(x, z),
          k = tone ? grain(x, z) : 1;
        return {
          d,
          p: [x, plan.skyTop(x, z) + lift, z],
          n: [n.x, n.y, n.z],
          c: tone ? [tone.r * k * tint[0], tone.g * k * tint[1], tone.b * k * tint[2]] : [path.r, path.g, path.b],
          w: [P.strength, 0, WASH_PEAK + (POOL_EDGE - WASH_PEAK) * Math.min(1, d / P.r), -1],
        };
      },
      lay = (tris: { a: plan.XZ; b: plan.XZ; c: plan.XZ; tone?: T.Color }[], lift: number) => {
        for (const { a, b, c, tone } of tris) {
          // Only the triangles whose box comes within a pool's reach of a lamp.
          const x0 = Math.min(a[0], b[0], c[0]),
            x1 = Math.max(a[0], b[0], c[0]),
            z0 = Math.min(a[1], b[1], c[1]),
            z1 = Math.max(a[1], b[1], c[1]);
          if (!lamps.some(([lx, lz]) => Math.hypot(Math.max(x0 - lx, 0, lx - x1), Math.max(z0 - lz, 0, lz - z1)) < reach)) continue;
          const n = Math.max(1, Math.ceil(Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1]), Math.hypot(a[0] - c[0], a[1] - c[1])) / P.cell)),
            grid = new Map<number, ReturnType<typeof vertex>>(),
            at = (i: number, j: number) => {
              const key = i * (n + 1) + j;
              let v = grid.get(key);
              if (!v) grid.set(key, (v = vertex(a[0] + ((b[0] - a[0]) * i + (c[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * i + (c[1] - a[1]) * j) / n, lift, tone)));
              return v;
            };
          for (let i = 0; i < n; i++)
            for (let j = 0; i + j < n; j++)
              for (const t of i + j + 1 < n ? [[at(i, j), at(i + 1, j), at(i, j + 1)], [at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]] : [[at(i, j), at(i + 1, j), at(i, j + 1)]]) {
                if (Math.min(t[0].d, t[1].d, t[2].d) > P.r) continue;
                for (const v of t) {
                  pos.push(...v.p);
                  nor.push(...v.n);
                  col.push(...v.c);
                  wash.push(...v.w);
                }
              }
        }
      };
    lay(deck.lawn, P.lift);
    lay(deck.gravel, plan.SKY_PATHS.lift + P.lift);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    geometry.setAttribute('aWash', new T.Float32BufferAttribute(wash, 4));
    solid(g, geometry, '#ffffff', 'bark', { shadow: false, ground: true, name: 'sky-lamp-pools' });
  }
  /**
   * The low outcrop on the south-west lawn (SKY_OUTCROP_SHAPE, at plan.SKY_OUTCROP), batched with the
   * lawn as its floor, so its foot takes the contact shade: its paint the rock's own cool grey, lighter
   * where it faces the sky and a shade darker low down, with the rock's faint broad mottle. Its buried
   * foot (the cut under the lawn) is left out.
   */
  function outcrop(g: T.Object3D) {
    const O = SKY_OUTCROP_SHAPE,
      P = plan.SKY_OUTCROP,
      reach = 1.2,
      s = sculpt([-reach, -O.sink - 2 * O.grid, -reach], [reach, 0.7, reach], O.grid);
    O.lumps.forEach((l, k) => s.add(roundBox(l.c, l.h, l.round, l.rot), k ? O.fillet : 0));
    s.cut(roundBox([0, -O.sink - 2, 0], [reach + 1, 2, reach + 1], 0), O.fillet / 2);
    const geometry = s.mesh(),
      p = geometry.getAttribute('position'),
      n = geometry.getAttribute('normal'),
      tones = new Float32Array(p.count * 3),
      stone = L.rock.map((c) => new T.Color(c)),
      c = new T.Color(),
      step = T.MathUtils.smoothstep;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i),
        z = p.getZ(i),
        mottle = 1 + 0.07 * (noise3(x * 1.6 + 4.1, y * 1.6, z * 1.6 + 8.3) - 0.5),
        // 1 in the open, less in a crease between two stones.
        open = step(s.exact(x + n.getX(i) * 0.15, y + n.getY(i) * 0.15, z + n.getZ(i) * 0.15) / 0.15, 0.25, 0.75);
      c.copy(stone[1])
        .lerp(stone[0], step(n.getY(i), -0.1, 0.7))
        .lerp(stone[2], 0.5 * (1 - step(y, -0.05, 0.12)))
        .multiplyScalar(mottle * T.MathUtils.lerp(O.crease, 1, open))
        .toArray(tones, i * 3);
    }
    geometry.setAttribute('color', new T.BufferAttribute(tones, 3));
    const index = geometry.getIndex()!,
      kept: number[] = [];
    for (let t = 0; t < index.count; t += 3) {
      const corners = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
      if (!corners.every((i) => p.getY(i) < -O.sink + 0.02)) kept.push(...corners);
    }
    geometry.setIndex(kept);
    const m = solid(g, geometry, '#ffffff', 'stone', { name: 'sky-outcrop' });
    m.position.set(P.x, plan.skyTop(P.x, P.z), P.z);
    m.rotation.y = P.ry;
  }
  /**
   * The rocks round each fall's notch (SKY_NOTCH.rocks), one mesh batched with the deck's stone: the
   * airport armour's boulders (town-sky-garden's boulder) in the rock's own greys, lighter where they
   * face the sky and each a shade of its own, their feet sunk in the coping and the lawn.
   */
  function notchRocks(g: T.Object3D) {
    const parts: T.BufferGeometry[] = [],
      stone = L.rock.map((c) => new T.Color(c)),
      c = new T.Color(),
      step = T.MathUtils.smoothstep;
    plan.skyFalls.forEach((f, k) => {
      const frame = new T.Matrix4().compose(new T.Vector3(f.x, f.y, f.z), new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), f.ry), new T.Vector3(1, 1, 1));
      for (const r of SKY_NOTCH.rocks) {
        const seed = r.seed + 17 * k,
          shape = boulder(seed, 0.6 + 0.2 * hash(seed * 1.7)),
          turn = new T.Euler(0.2 * (hash(seed * 3.1) - 0.5), hash(seed * 5.7) * Math.PI * 2, 0.2 * (hash(seed * 7.9) - 0.5)),
          plain = shape.applyMatrix4(frame.clone().multiply(new T.Matrix4().compose(new T.Vector3(...r.c), new T.Quaternion().setFromEuler(turn), new T.Vector3(...r.h)))).toNonIndexed(),
          p = plain.getAttribute('position'),
          n = plain.getAttribute('normal'),
          tones = new Float32Array(p.count * 3),
          tone = 0.94 + 0.12 * hash(seed * 2.3);
        shape.dispose();
        // (A shade darker low down, where it meets the stone and the turf: as low stones they take
        // no contact shade of the deck's, which would bake them to its darkest.)
        for (let i = 0; i < p.count; i++)
          c.copy(stone[1])
            .lerp(stone[0], step(n.getY(i), -0.1, 0.7))
            .multiplyScalar(tone * T.MathUtils.lerp(0.8, 1, step(p.getY(i) - f.y - r.c[1], -r.h[1], 0.2 * r.h[1])))
            .toArray(tones, i * 3);
        plain.setAttribute('color', new T.BufferAttribute(tones, 3));
        parts.push(plain);
      }
    });
    solid(g, mergeGeometries(parts)!, '#ffffff', 'stone', { name: 'sky-notch-rocks', ground: true });
    parts.forEach((p) => p.dispose());
  }
  /**
   * The garden (lane G's kit, `garden`, built once in town-build with the other factories), each
   * piece in its slot (skySlots, through standAt), everything in `land`: what stands on the deck is
   * batched with the lawn as its floor, and every part of a piece that hangs in the air (the falls'
   * water and puffs, the clouds, the floating rocks) sits on a pivot of its own in ctx.animated,
   * which the town batches on its own with no contact shade.
   * - Tea on the lawn before the terrace: her chair is the table's -x one, the second cup faces the
   *   other. The telescope on the rim, looking at the Town Hall, its tube along her own gaze.
   * - The town's bench, facing the town; the island's one tree, a round one that shows the season.
   * - The flower borders at the terrace's foot (SKY_BEDS) and the four garden lamps as one set.
   * - The clipped box: a planted urn either side of the back door's step (plan.SKY_URNS); and a low
   *   outcrop of the rock's own grey through the turf of the south-west lawn.
   * - The two short falls, the clouds and the floating rocks.
   */
  function skyGarden(land: T.Group) {
    const s = skySlots();
    standAt(land, s.tea, 'sky-tea').add(garden.teaTable());
    standAt(land, s.telescope, 'sky-telescope').add(garden.telescope({ eyepiece: s.telescope.eyepiece, tilt: s.telescope.tilt }));
    props.bench(land, s.bench.x, s.bench.y, s.bench.z, s.bench.ry).name = 'sky-bench';
    const tree = nature.tree(land, { x: s.tree.x, z: s.tree.z, size: s.tree.size, kind: s.tree.kind, id: 'sky-tree' }, SKY_TREE_SEED);
    tree.name = 'sky-tree';
    tree.position.y = s.tree.y;
    s.borders.forEach((b, k) => skyBorder(nature, land, b, k));
    standAt(land, s.lamps, 'sky-lamps').add(garden.gardenLamps(s.lamps.spots));
    for (const u of s.urns) standAt(land, u, 'sky-urn').add(garden.urn({ planted: true }));
    outcrop(land);
    s.falls.forEach((f, k) => standAt(land, f, 'sky-fall').add(garden.fall({ rise: f.rise, seed: k + 1 })));
    notchRocks(land);
    for (const c of s.clouds) standAt(land, c, 'sky-cloud').add(garden.cloud({ size: c.size, seed: c.seed }));
    for (const r of s.rocks) standAt(land, r, 'sky-float').add(garden.floatingRock({ size: r.size, seed: r.seed }));
  }
  /** A group in g at a slot (see skySlots), for a garden piece built in its own frame. */
  function standAt(g: T.Object3D, slot: SkySlot, name: string) {
    const frame = new T.Group();
    frame.name = name;
    frame.position.set(slot.x, slot.y, slot.z);
    frame.rotation.y = slot.ry;
    g.add(frame);
    return frame;
  }
  /** The ground skyGround laid, for the lamps' pools (laid over it in the 'sky rock' phase). */
  let deckLand: T.Group | null = null;
  /** The island's ground, in its own group (the town's `sky.land`): the lawn, the paths and the garden. */
  function skyGround(land: T.Group) {
    lawn(land);
    paths(land);
    skyGarden(land);
    deckLand = land;
  }

  /* ---------------------------------------------------------------- */
  /* The underside: rock and coping                                    */
  /* ---------------------------------------------------------------- */
  /**
   * A band swept round a closed `path`: at each station its profile's points, each `o` out along
   * the station's normal and `y` up from its base height, joined to the next station's by quads
   * (town-airport's sweep, with a profile a station). The path runs clockwise seen from above and
   * the profile is listed from inside to outside, so it faces up and out. Smooth normals: a soft
   * edge on every turn.
   */
  function sweep(path: Station[], profile: (station: number) => [number, number][]) {
    const pos: number[] = [],
      index: number[] = [],
      width = profile(0).length;
    path.forEach((s, k) => {
      for (const [o, y] of profile(k)) pos.push(s.x + s.nx * o, s.y + y, s.z + s.nz * o);
    });
    for (let k = 0; k < path.length; k++) {
      const a = k * width,
        b = ((k + 1) % path.length) * width;
      for (let j = 0; j + 1 < width; j++) index.push(a + j, b + j, a + j + 1, a + j + 1, b + j, b + j + 1);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
  }
  /**
   * The coping (SKY_COPING): a chunky band of kerb stone round the rim, its nose the island's
   * widest ring, each stone a shade of its own. It hides where the turf ends and where the rock
   * begins. A `band`: a surface, never an overhang.
   */
  function coping(g: T.Object3D) {
    const C = SKY_COPING,
      // How far a stone sits in and down from the profile, each its own (never out past the nose's line).
      seat = (stone: number) => C.set * hash(stone * 5.71 + 1.3),
      path = plan.skyOutline(0, C.stones * C.stations).map((p) => ({ ...p, y: S.top })),
      // How far each station sinks into a fall's notch (SKY_NOTCH): 1 at the notch's floor, 0 clear of it.
      notch = path.map((p) => Math.max(0, ...plan.skyFalls.map((f) => 1 - T.MathUtils.smoothstep(Math.hypot(p.x - f.x, p.z - f.z), FALL.notch.half, FALL.notch.half + FALL.notch.ramp)))),
      swept = sweep(path, (k) => {
        const stone = Math.floor(k / C.stations),
          // A joint station takes the lower of the two stones it parts, drawn in by the joint.
          joint = k % C.stations === 0,
          sit = joint ? Math.max(seat(stone), seat((stone + C.stones - 1) % C.stones)) + C.joint : seat(stone);
        // Only the top's outer edge, the nose and the underside take it: the inner face and its
        // arris run level all round the lawn (one clean edge, not a dotted one), and the
        // underside's end stays put inside the rock.
        return C.profile.map(([o, y], j): [number, number] => {
          const [po, py] = j < 3 || j === C.profile.length - 1 ? [o, y] : [o - sit, y - (j < 6 ? sit : 0)],
            [no, ny] = SKY_NOTCH.profile[j];
          return [po + (no - po) * notch[k], py + (ny - py) * notch[k]];
        });
      }),
      geometry = swept.toNonIndexed(),
      count = geometry.getAttribute('position').count,
      tones = new Float32Array(count * 3),
      perStone = (C.profile.length - 1) * 6 * C.stations;
    swept.dispose();
    // A stone's own shade: the quads from its joint to the next.
    for (let i = 0; i < count; i++) tones.fill(1 + C.tone * (hash(Math.floor(i / perStone) * 7.13 + 2.1) - 0.5), i * 3, i * 3 + 3);
    geometry.setAttribute('color', new T.BufferAttribute(tones, 3));
    solid(g, geometry, L.coping, 'stone', { band: true, name: 'sky-coping' });
  }
  /**
   * The underside (SKY_ROCK): the earth tapering to a blunt point, its chunky shoulders hung under
   * the rim, sculpted as one smooth mass (its normals the blended field's own, so nothing is
   * faceted), and the rock: the spike at its point, and the outcrops standing out of its flanks,
   * each a cluster of the armour's boulders (OUTCROP_STONES) set into the earth on its own normal
   * there, so where stone meets earth the two surfaces part in one crisp line (a colour faded across
   * the net's triangles there smeared like paint). Their colours are on their vertices: the earth in
   * three beds, each change a soft gradient level all round under a faint paler seam, giving way to
   * rock down the spike; the stones in the armour's cool greys, each a shade of its own, lighter
   * where they face the sky and a shade darker where they go into the earth and where they meet one
   * another; a faint broad mottle over both. Whatever faces down takes the sea's light thrown back up.
   */
  function rock(g: T.Object3D) {
    const R = SKY_ROCK,
      B = R.body,
      // The tip's place in the deck's frame (plan.skyTip: it leans toward the file's camera).
      [tx, tz] = plan.skyLocal(plan.skyTip().x, plan.skyTip().z),
      mass = sculpt([-S.a - 0.6 - Math.abs(tx), -S.depth - 0.5, -S.b - 0.6 - Math.abs(tz)], [S.a + 0.6 + Math.abs(tx), -B.top + 2 * R.grid, S.b + 0.6 + Math.abs(tz)], R.grid);
    // (Blended, the body and the round cone swell the tip by `swell`: both stop that short of SKY.depth.)
    const tipAt = S.depth - R.tip.swell,
      // The spike's axis, from the body's middle at `from` down to the tip.
      kFrom = (R.tip.from - B.cliff) / (tipAt - B.cliff),
      tip = roundCone([tx * kFrom * kFrom, -R.tip.from, tz * kFrom * kFrom], [tx, -tipAt + R.tip.r[1], tz], R.tip.r[0], R.tip.r[1]);
    mass.add(earthBody(S.a, S.b, B.top, B.cliff, tipAt, B.share, B.belly, tx, tz));
    mass.add(tip, R.tip.fillet);
    for (const l of R.lobes) mass.add(lobeShape(l), R.fillet);
    // A flat top under the turf, level with the body's, its edge rolled into the cliffs (never a crease
    // where the shoulders' blends meet it): the coping's underside ends inside it.
    mass.cut(roundBox([0, 4 - B.top, 0], [S.a + 2, 4, S.b + 2], 0), R.cut);
    const field = (x: number, y: number, z: number) => mass.exact(x, y, z),
      stones = R.outcrops.flatMap((o, k) => outcropStones(o, k, field));
    const earth = L.earth.map((c) => new T.Color(c)),
      seam = new T.Color(L.seam),
      stone = L.rock.map((c) => new T.Color(c)),
      c = new T.Color(),
      r = new T.Color(),
      step = T.MathUtils.smoothstep,
      [b0, b1, b2] = R.beds,
      /**
       * A vertex's paint: `stoneAt` how much of it is rock (the rest earth); for a stone, `into` how
       * near the earth it is (0 at it), `apart` how near another stone of its outcrop (that stone's
       * own unit depth: 1 at its surface), `tone` its own shade.
       */
      paint = (x: number, y: number, z: number, ny: number, stoneAt: number, into: number, apart: number, tone: number, out: Float32Array, i: number) => {
        const depth = -y,
          mottle = 1 + 0.07 * (noise3(x * 0.9 + 11.3, y * 1.4 + 5.2, z * 0.9 + 2.9) - 0.5),
          seamAt = Math.max(...[b0, b1].map((b) => 1 - step(Math.abs(depth - b), R.seam[0], R.seam[1])));
        c.copy(earth[0])
          .lerp(earth[1], step(depth, b0 - R.change, b0 + R.change))
          .lerp(earth[2], step(depth, b1 - R.change, b1 + R.change))
          .lerp(seam, seamAt * R.seamTone);
        // Rock: its cool grey, lighter on faces turned to the sky, a little darker toward the tip,
        // where a stone goes into the earth and in the crack where it meets another.
        r.copy(stone[1])
          .lerp(stone[0], step(ny, -0.1, 0.7))
          .lerp(stone[2], step(depth, b2, S.depth) * 0.6)
          .multiplyScalar(tone * T.MathUtils.lerp(R.set, 1, step(into, 0, 0.35)) * T.MathUtils.lerp(R.crevice, 1, step(apart, 1, 1.45)));
        c.lerp(r, stoneAt).multiplyScalar(mottle);
        // The sea's light thrown back up under the island: whatever faces down is lifted (warm, against
        // the hemisphere's olive ground light), so under the town's high sun the body reads as brown
        // earth and grey rock, never as a hole.
        const under = step(-ny, -0.1, 0.8);
        c.setRGB(c.r * (1 + R.bounce[0] * under), c.g * (1 + R.bounce[1] * under), c.b * (1 + R.bounce[2] * under)).toArray(out, i * 3);
      },
      /** Paint a mesh's vertices (each `shade`: how much rock, how near the earth, how near another stone, its tone), and keep only the triangles that are not all `hidden`. */
      finish = (geometry: T.BufferGeometry, shade: (x: number, y: number, z: number) => [number, number, number, number], hidden: (i: number) => boolean) => {
        const p = geometry.getAttribute('position'),
          n = geometry.getAttribute('normal'),
          tones = new Float32Array(p.count * 3);
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i),
            y = p.getY(i),
            z = p.getZ(i),
            [stoneAt, into, apart, tone] = shade(x, y, z);
          paint(x, y, z, n.getY(i), stoneAt, into, apart, tone, tones, i);
        }
        geometry.setAttribute('color', new T.BufferAttribute(tones, 3));
        const index = geometry.getIndex()!,
          kept: number[] = [];
        for (let t = 0; t < index.count; t += 3) {
          const corners = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
          if (!corners.every(hidden)) kept.push(...corners);
        }
        geometry.setIndex(kept);
        return geometry;
      };
    // The earth, rock down its spike; the flat top is never seen (the turf lies over it): only its rim
    // is kept, under the coping; nor is what the stones bury (well inside one: its inscribed ball).
    const ground = mass.mesh(),
      gp = ground.getAttribute('position'),
      buried = (x: number, y: number, z: number, but = -1) => stones.some((s, j) => j !== but && inStone(s, x, y, z));
    finish(
      ground,
      (_x, y) => [step(-y, R.spike[0], R.spike[1]), 1, 2, 1],
      (i) => (gp.getY(i) > -B.top - 0.1 && Math.hypot(gp.getX(i) / S.a, gp.getZ(i) / S.b) < B.share - 0.1) || buried(gp.getX(i), gp.getY(i), gp.getZ(i)),
    );
    // The outcrops' stones: what the earth or another stone buries is left out.
    const parts = [ground];
    stones.forEach((s, j) => {
      const geometry = chisel(boulder(s.seed, s.square, s.detail), s.cuts).applyMatrix4(s.matrix),
        sp = geometry.getAttribute('position'),
        // (Its own outcrop's other stones, for the cracks between them.)
        others = stones.filter((o, k) => k !== j && o.outcrop === s.outcrop);
      parts.push(
        finish(
          geometry,
          (x, y, z) => [1, field(x, y, z), Math.min(2, ...others.map((o) => stoneDepth(o, x, y, z))), s.tone],
          (i) => field(sp.getX(i), sp.getY(i), sp.getZ(i)) < -0.08 || buried(sp.getX(i), sp.getY(i), sp.getZ(i), j),
        ),
      );
    });
    const geometry = mergeGeometries(parts)!;
    parts.forEach((p) => p.dispose());
    const m = solid(g, geometry, '#ffffff', 'stone', { name: 'sky-rock' });
    // In the deck's own frame: its long axis on x, its level at y 0.
    m.position.set(S.x, S.top, S.z);
    m.rotation.y = S.heading;
  }
  /**
   * The underside's night dim (SKY_ROCK.night, as the balloon's): its batched meshes take their own
   * copies of the shared batch materials (the same shader program), whose colour follows the
   * night, so a pale mass never hangs lit in the night sky and nothing else darkens. Under the
   * night's high moon it would go quite black (nothing lights what faces down), so it keeps a
   * faint fill of its own (SKY_ROCK.fill, the moonlit sea's light under it, a dark brown, far from
   * a glow): dark, never black. Registered in ctx.animated (the town's frame loop calls it), after
   * batching: the group is batched in its own phase ('batch sky'), never by the animated loop.
   */
  function dimAtNight(g: T.Group) {
    const fill = new T.Color(SKY_ROCK.fill);
    g.userData.prebatched = true;
    ctx.animated.push({
      object: g,
      update(_time, night) {
        for (const part of g.children) {
          if (!(part instanceof T.Mesh) || !(part.material instanceof T.MeshStandardMaterial) || !part.material.vertexColors) continue;
          if (!part.material.userData.skyOwn) {
            const shared = part.material,
              own = shared.clone();
            own.onBeforeCompile = (shader, renderer) => shared.onBeforeCompile(shader, renderer);
            own.customProgramCacheKey = () => shared.customProgramCacheKey();
            own.userData.skyOwn = true;
            part.material = own;
          }
          part.material.color.setScalar(1 - SKY_ROCK.night * night);
          part.material.emissive.copy(fill).multiplyScalar(night);
        }
      },
    });
  }
  /**
   * The island's underside, in its own group (the town's `sky.rock`, batched with no contact
   * shade: measured from the lawn, everything below it would bake to its darkest): the rock and
   * the coping over it; and, on the deck skyGround laid, the lamps' pools.
   */
  function skyUnderside(g: T.Group) {
    rock(g);
    coping(g);
    dimAtNight(g);
    // The lamps' pools go on the deck skyGround laid (the town's `sky.land`, batched with it), here
    // rather than there: 'sky ground', with the villa and the garden in it, is the longer phase (each
    // of the island's phases has a time limit of its own in check-town's timed builds).
    if (deckLand) lampPools(deckLand);
  }

  /* ---------------------------------------------------------------- */
  /* Alison                                                            */
  /* ---------------------------------------------------------------- */
  /**
   * Alison Heppenstall's figure (sky-figure's createAlison) on the island, in `root` (the island's
   * own root, outside every static batch: her root is a pivot of its own), going about her day:
   * plan.alisonDay says where she is and what she does, poseAlison poses her, and she stands on the
   * ground drawn there (plan.skyFloor: the lawn, or the paths' gravel where she is on it) or sits on
   * her chair. She keeps a clock of her own, town time less however
   * long she has been held (or was coming back from it) while the town ran on, so nothing of her day
   * runs on under her while she is held. When the town is held (the frame's `held`: Pause) she
   * settles where she is into the still pose plan.alisonStill gives, over SKY_HOLD's seconds of the
   * frame's own time (its `cut`, reduced motion, nearly at once), the water from her can stopping and
   * going down into the bed as water does (plan.alisonStream, in real time); let go, she comes back
   * the same way into her day as it was when she was held, and only then does it go on. Asked
   * without a frame (the build's own first pose, a check sampling her day), she is simply her day at
   * that time. A visitor who prefers reduced motion gets the town paused at load, which holds her at
   * time 0, in her chair at tea, her cup resting on its saucer: already still; Play then brings her
   * back with the people and the tram (only the plane stays parked). Night and rain change nothing,
   * as for the town's walkers.
   * Returns her root, which the town batches part by part as it does its figures (it is
   * `prebatched`: never by the animated loop).
   */
  function alison(root: T.Group) {
    const { root: figure, joints, props: held } = createAlison(material);
    figure.userData.keepSeparate = true;
    figure.userData.prebatched = true;
    root.add(figure);
    type Water = { front: number; tail: number };
    const H = plan.SKY_HOLD,
      hidden = (s: Water) => s.front <= 1e-6 || s.tail >= 1 - 1e-6;
    // Her clock (figure-rig's): held, she settles into alisonStill over SKY_HOLD's seconds (`take` if
    // she is bending to her can, `reduced` under reduced motion), and her water goes on in real time
    // (the clock's flow), down into the bed, until her day's own catches up with it.
    const update = figureClock<plan.AlisonDay, Water>({
      day: plan.alisonDay,
      still: plan.alisonStill,
      blend: plan.alisonBlend,
      settle: (live, cut) => (cut ? H.reduced : live.pose === 'take' ? H.take : H.settle),
      pose: (day) => {
        // (alisonDay's answer carries poseAlison's options by their own names.)
        const { lift } = poseAlison(joints, held, day.pose, day.phase, day);
        figure.position.set(day.x, plan.skyFloor(day.x, day.z) + lift, day.z);
        figure.rotation.y = day.heading;
      },
      flow: {
        from: (live) => ({ front: live.front, tail: live.tail }),
        step: (from, day, dt, settle) => plan.alisonStream(from, day.pour, (dt * H.settle) / settle),
        // (Moving while some of it shows: the loop draws her shadow again.)
        moved: (from, to) => (to.front !== from.front || to.tail !== from.tail) && !(hidden(to) && hidden(from)),
        apply: (day, water) => Object.assign(day, water),
        home: (water, live) => (hidden(water) && hidden(live)) || (Math.abs(water.front - live.front) < 1e-6 && Math.abs(water.tail - live.tail) < 1e-6),
      },
    });
    update(0);
    ctx.animated.push({ object: figure, update });
    return figure;
  }

  return { skyGround, skyUnderside, standAt, skySlots, alison };
}
export type SkyIsland = ReturnType<typeof createSkyIsland>;
