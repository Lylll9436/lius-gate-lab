import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WASH_PEAK, type SurfaceKind } from './city-materials';
import * as plan from './town-plan';
import { palette, hash, type TownContext } from './town-shared';
import { noise3, roundBox, roundCone, sculpt, type Shape } from './town-sculpt';
import type { Kit } from './town-kit';
import { BLOOMS, type Nature } from './town-nature';
import type { Props } from './town-props';
import { FALL, boulder, type SkyGarden } from './town-sky-garden';
import { createAlison, poseAlison } from './sky-figure';

/**
 * The sky island's colours, each no more saturated than its palette family: the lawn's two mown
 * greens (the town lawn's stripes); the coping's weathered stone, a step greyer and darker than
 * the kerb's buff, so the villa's pale dressings stay the brightest stone on the island; the
 * paths' pale gravel, between the pavement's and the park path's. Under the deck, the earth in
 * three beds from the warm brown under the turf down to a darker brown (well under the soil's
 * saturation, near the armour's greys in value), parted by pale seams; and the rock that stands
 * out of it and makes the spike, in warm greys, lighter where it faces the sky. (The villa's own
 * colours are town-sky-villa's VILLA_LOOK.)
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
 * either side, its profile sinks to `profile` (the same points, o and y as SKY_COPING's: its top
 * FALL.notch.floor over the rim's lawn, under the stream's water, its nose and underside drawn in
 * after it, so the stone stays 0.07 or more thick and 0.3 clear of the falling sheet). Three of the
 * rock's own boulders (`rocks`, the airport armour's shape: each one's middle and half sizes in the
 * fall's own frame, x across, y over the rim's lawn, z out) line it: one either side, sunk in the
 * coping over its ramps, and one over the stream's spring on the lawn behind it; `tone` lightens
 * them toward the sky.
 */
export const SKY_NOTCH = (() => {
  const top = FALL.notch.floor - plan.SKY.dome;
  return {
    profile: [[-0.46, top - 0.04], [-0.46, top - 0.01], [-0.41, top], [-0.14, top], [-0.04, top - 0.015], [0, top - 0.035], [-0.04, top - 0.05], [-0.14, top - 0.09], [-0.34, top - 0.12], [-0.62, -0.5]] as [number, number][],
    rocks: [
      { c: [-0.7, 0.06, -0.22], h: [0.34, 0.22, 0.3], seed: 3 },
      { c: [0.68, 0.05, -0.18], h: [0.3, 0.2, 0.33], seed: 7 },
      { c: [0.04, 0.12, -0.78], h: [0.42, 0.24, 0.3], seed: 11 },
    ] as { c: [number, number, number]; h: [number, number, number]; seed: number }[],
  };
})();
/**
 * One lobe of the underside, placed by the world bearing it hangs on (0 south, 90 east, as
 * everywhere in the plan): `proud`, how far its outer face stands past the earth body's surface at
 * its height (negative: inside it); `y`, its middle under SKY.top; `radial`, `tangential` and
 * `vertical`, its half sizes (along the bearing, across it and up); `tilt`, a small lean about the
 * deck's long axis; `rock`, whether it is rock standing out of the earth or the earth's own shoulder.
 */
type Lobe = { bearing: number; proud: number; y: number; radial: number; tangential: number; vertical: number; tilt: number; rock: boolean };
const lobe = (bearing: number, proud: number, y: number, radial: number, tangential: number, vertical: number, tilt: number, rock = false): Lobe => ({ bearing, proud, y, radial, tangential, vertical, tilt, rock });
/**
 * The underside, in the deck's own frame (x along its long axis, north; z east; y from SKY.top):
 * solids blended in a distance grid of spacing `grid` (town-sculpt), so it is one smooth mass with
 * no facet: the owner's reference 2, a grass top on an inverted cone of earth and rock tapering to
 * a point, in the town's own style. The earth's body (`body`, earthBody): cut flat `top` under
 * SKY.top inside the coping (under the turf), it stands straight down as cliffs at `share` of the
 * rim to `cliff` (a chunk of land, not a plate, from every side), then tapers to the tip,
 * SKY.depth down (as deep as the sea allows) and leaning toward the island's file's camera
 * (plan.skyTip), its flank a little convex (`belly`: full under the rim, narrowing to the point at
 * the last; any fuller and from the town's 42.6 degrees its foot would read as a bowl). A round cone
 * (`tip`: from this depth, its two radii, its fillet, and how far the blend swells it) makes the
 * point a spike of rock. The lobes (Lobe, each blended in with a fillet of `fillet`, the rock's of
 * `rockFillet` so they stand out of the earth as boulders, their edges rounded by `round` of their
 * least half size):
 * - the earth's chunky shoulders in the cliffs under the rim, a little proud of it, fullest on the
 *   south and south-east (the file's and the opening bearing's side) and where each view's outline
 *   runs; none proud on the north tip (the plane's side, check-town) nor under the falls;
 * - warm grey rock standing out of the flank lower down, each where a view's key light finds it
 *   (the key light turns with the camera, from 84 degrees to its left).
 * From the island's file (its own lower pitch, city-scene's SKY_PITCH) the body hangs 0.65 of the
 * deck's height below it and narrows to its tip; from the Rotate stops at the town's pitch it shows
 * as a thick body of earth (0.2 of the deck's height or more) narrowing under it.
 * The earth's beds change at `beds` (depths under SKY.top) by a wandering line (`wander`), each
 * change marked by a pale seam (`seam`: whole within its first number of the line, gone by its
 * second; at least two grid spacings across, so the vertices draw it as one soft band and never as
 * a row of dots). From `spike` down the earth gives way to rock, as at the reference's point, which
 * darkens a little from `beds[2]` to the tip. A vertex is also rock where it lies within
 * `outcrop[0]` of a rock lobe's own surface, fading to earth by `outcrop[1]`. Whatever faces down
 * takes the sea's light thrown back up (`bounce`, a lift a channel): under the town's high sun
 * nothing lights it, and it read as a hole. At night it dims by `night`, as the balloon does, and
 * keeps a faint fill of its own (`fill`): dark, never black (dimAtNight).
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
    // Rock standing out of the flanks, each where a view's key light finds it: south-south-west (the
    // file and the opening bearing), south-east lower down, east (q3), north-north-west (q5) and
    // west-south-west (q7).
    lobe(-22, 0.8, -3.2, 0.9, 1.3, 1.0, 0.12, true),
    lobe(32, 0.65, -4.9, 0.7, 0.9, 0.8, -0.1, true),
    lobe(80, 0.5, -2.8, 0.65, 0.9, 0.7, 0.08, true),
    lobe(200, 0.5, -3.3, 0.7, 0.9, 0.75, -0.08, true),
    lobe(292, 0.5, -3.6, 0.7, 0.9, 0.75, 0.1, true),
    lobe(8, 0.55, -2.25, 0.62, 0.95, 0.6, -0.1, true),
    lobe(50, 0.55, -3.5, 0.65, 0.9, 0.7, 0.1, true),
    lobe(30, 0.42, -1.62, 0.55, 0.85, 0.5, 0.06, true),
    lobe(68, 0.42, -1.75, 0.55, 0.8, 0.5, -0.06, true),
  ],
  round: 0.5,
  rockRound: 0.3,
  edge: 0.2,
  fillet: 0.6,
  set: 0.82,
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
/**
 * A lobe as a solid in the deck's own frame: its middle on its bearing from the body's middle at
 * its depth, its radial half along it, its outer face `proud` of the body's surface there.
 */
function lobeShape(l: Lobe, round: number): Shape {
  const S = plan.SKY,
    b = (l.bearing * Math.PI) / 180,
    // The bearing's direction in the deck's frame (x north, z east), and the body's reach along it.
    dx = -Math.cos(b),
    dz = Math.sin(b),
    body = bodySection(-l.y),
    r = body.share / Math.hypot(dx / S.a, dz / S.b) + l.proud - l.radial;
  return roundBox([body.x + r * dx, l.y, body.z + r * dz], [l.radial, l.vertical, l.tangential], Math.max(SKY_ROCK.edge, round * Math.min(l.radial, l.vertical, l.tangential)), [l.tilt, Math.atan2(-dz, dx), 0]);
}
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
 * The flower borders' planting (skyBorder): each is the town's flower bed (its kerb the border's own
 * outline, drawn in at its outer end by `trim`, so the walk's turn up to the telescope clears it;
 * its mound inside), its blooms not where the bed scatters them but in one row along its back, `back`
 * in from the terrace wall, `spacing` apart, their colours the town's bloom colours in `order`
 * (mirrored on the west border, so the pair flanks the steps alike). Her watering can (lane F's
 * ALISON: its rose 0.53 ahead of her and 0.444 up, nothing of it hanging lower than 0.38, reaching
 * 0.589 at the most) passes over the mound in front of them as she walks the watering stretch:
 * blooms under it would stand in its way.
 */
export const SKY_BEDS = { trim: 0.15, back: 0.15, spacing: 0.34, order: [2, 3, 0, 3, 4], seeds: [53, 59] };
/** The tree's seed (town-nature's tree index): its turn and its crown's clumps. */
export const SKY_TREE_SEED = 3;
/** A border's slot (skySlots' `borders`). */
type BorderSlot = ReturnType<typeof skySlots>['borders'][number];
/**
 * One flower border (SKY_BEDS; `k` 0 is the east one, 1 the west), in a group of its own in g: the
 * town's flower bed standing on the lowest lawn under its kerb, with its blooms in a row at the back.
 */
export function skyBorder(nature: Nature, g: T.Object3D, b: BorderSlot, k: number) {
  const bed = new T.Group(),
    side = k ? -1 : 1,
    B = SKY_BEDS,
    // Its middle, drawn in toward the steps with its outer end.
    x = b.x - (side * B.trim) / 2;
  bed.name = 'sky-border';
  g.add(bed);
  // (flowerBed's kerb stands 0.08 proud of the bed it is given all round.)
  nature.flowerBed(bed, x, b.floor, b.z, b.w - B.trim - 0.16, b.d - 0.16, B.seeds[k]);
  for (const bloom of bed.children.filter((o) => o.userData.noShadow)) bloom.removeFromParent();
  B.order.forEach((c, i) => nature.bloom(bed, x + side * (i - (B.order.length - 1) / 2) * B.spacing, b.floor + 0.4, b.z - b.d / 2 + B.back, BLOOMS[c]));
  return bed;
}
/**
 * The outcrop (plan.SKY_OUTCROP): the rock's own warm grey breaking through the turf, three rounded
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
export const SKY_POOL = { r: 0.9, strength: 0.3, lift: 0.006, cell: 0.26 };
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
export function createSkyIsland(ctx: TownContext, _kit: Kit, props: Props, nature: Nature, garden: SkyGarden) {
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
   * leave, (0.93, 0.95, 0.90); the gravel's plain), each vertex carrying the nearer lamp's wash. As
   * flat ground (`ground`) it takes no contact shade; it casts nothing.
   */
  function lampPools(g: T.Object3D) {
    const P = SKY_POOL,
      lamps = plan.SKY_LAMPS,
      map = material('#ffffff', 'grass').map,
      image = map?.image as { data: Uint8Array; width: number; height: number } | undefined,
      linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4),
      // The grain as the ground shader samples it: linear, bilinear at its finest level, repeating.
      texel = image ? Float32Array.from({ length: image.width * image.height }, (_, i) => linear(image.data[i * 4] / 255)) : null,
      grain = (x: number, z: number) => {
        if (!texel || !image || !map) return 1;
        const u = x * map.repeat.x * image.width - 0.5,
          v = z * map.repeat.y * image.height - 0.5,
          i = Math.floor(u),
          j = Math.floor(v),
          fu = u - i,
          fv = v - j,
          at = (a: number, b: number) => texel[(((b % image.height) + image.height) % image.height) * image.width + (((a % image.width) + image.width) % image.width)];
        return T.MathUtils.lerp(T.MathUtils.lerp(at(i, j), at(i + 1, j), fu), T.MathUtils.lerp(at(i, j + 1), at(i + 1, j + 1), fu), fv);
      },
      tint = [0.93, 0.95, 0.9],
      path = new T.Color(L.path),
      pos: number[] = [],
      nor: number[] = [],
      col: number[] = [],
      wash: number[] = [],
      near = (x: number, z: number) => Math.min(...lamps.map(([lx, lz]) => Math.hypot(x - lx, z - lz))),
      put = (x: number, z: number, lift: number, tone?: T.Color) => {
        pos.push(x, plan.skyTop(x, z) + lift, z);
        lawnNormal(x, z).toArray(nor, nor.length);
        if (tone) {
          const k = grain(x, z);
          col.push(tone.r * k * tint[0], tone.g * k * tint[1], tone.b * k * tint[2]);
        } else col.push(path.r, path.g, path.b);
        wash.push(P.strength, 0, WASH_PEAK + (POOL_EDGE - WASH_PEAK) * Math.min(1, near(x, z) / P.r), -1);
      },
      lay = (tris: { a: plan.XZ; b: plan.XZ; c: plan.XZ; tone?: T.Color }[], lift: number) => {
        for (const { a, b, c, tone } of tris) {
          if (Math.min(...[a, b, c, [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3] as plan.XZ].map(([x, z]) => near(x, z))) > P.r + Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1]), Math.hypot(a[0] - c[0], a[1] - c[1]))) continue;
          const n = Math.max(1, Math.ceil(Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1]), Math.hypot(a[0] - c[0], a[1] - c[1])) / P.cell)),
            at = (i: number, j: number): plan.XZ => [a[0] + ((b[0] - a[0]) * i + (c[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * i + (c[1] - a[1]) * j) / n];
          for (let i = 0; i < n; i++)
            for (let j = 0; i + j < n; j++)
              for (const t of i + j + 1 < n ? [[at(i, j), at(i + 1, j), at(i, j + 1)], [at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]] : [[at(i, j), at(i + 1, j), at(i, j + 1)]]) {
                if (Math.min(...t.map(([x, z]) => near(x, z))) > P.r) continue;
                for (const [x, z] of t) put(x, z, lift, tone);
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
   * lawn as its floor, so its foot takes the contact shade: its paint the rock's own warm grey, lighter
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
          shape = boulder(seed),
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
   * which the town batches on its own with no contact shade. `air` is for anything static that
   * hangs off the deck or beside it (batched with no contact shade); the garden has none.
   * - Tea on the lawn before the terrace: her chair is the table's -x one, the second cup faces the
   *   other. The telescope on the rim, looking at the Town Hall, its tube along her own gaze.
   * - The town's bench, facing the town; the island's one tree, a round one that shows the season.
   * - The flower borders at the terrace's foot (SKY_BEDS) and the four garden lamps as one set.
   * - The clipped box: a planted urn either side of the back door's step (plan.SKY_URNS); and a low
   *   outcrop of the rock's own grey through the turf of the south-west lawn.
   * - The two short falls, the clouds and the floating rocks.
   */
  function skyGarden(land: T.Group, _air: T.Group) {
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
  /** The island's ground, in its own group (the town's `sky.land`): the lawn, the paths and the garden. */
  function skyGround(land: T.Group, air: T.Group) {
    lawn(land);
    paths(land);
    lampPools(land);
    skyGarden(land, air);
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
   * faceted), and the rock: the spike at its point, and boulders standing out of its flanks, each a
   * rounded block sculpted on its own and set into the earth, so where they meet the two surfaces
   * part in one crisp line (a colour faded across the net's triangles there smeared like paint).
   * Their colours are on their vertices: the earth in three beds, each change a soft gradient level
   * all round under a faint paler seam, giving way to rock down the spike; the boulders in the
   * armour's cool greys, lighter where they face the sky and a shade darker where they go into the
   * earth; a faint broad mottle over both. Whatever faces down takes the sea's light thrown back up.
   */
  function rock(g: T.Object3D) {
    const R = SKY_ROCK,
      B = R.body,
      // The tip's place in the deck's frame (plan.skyTip: it leans toward the file's camera).
      [tx, tz] = plan.skyLocal(plan.skyTip().x, plan.skyTip().z),
      mass = sculpt([-S.a - 0.6 - Math.abs(tx), -S.depth - 0.5, -S.b - 0.6 - Math.abs(tz)], [S.a + 0.6 + Math.abs(tx), -B.top + 2 * R.grid, S.b + 0.6 + Math.abs(tz)], R.grid),
      shapes = R.lobes.map((l) => lobeShape(l, l.rock ? R.rockRound : R.round)),
      boulders = shapes.filter((_, k) => R.lobes[k].rock);
    // (Blended, the body and the round cone swell the tip by `swell`: both stop that short of SKY.depth.)
    const tipAt = S.depth - R.tip.swell,
      // The spike's axis, from the body's middle at `from` down to the tip.
      kFrom = (R.tip.from - B.cliff) / (tipAt - B.cliff),
      tip = roundCone([tx * kFrom * kFrom, -R.tip.from, tz * kFrom * kFrom], [tx, -tipAt + R.tip.r[1], tz], R.tip.r[0], R.tip.r[1]);
    mass.add(earthBody(S.a, S.b, B.top, B.cliff, tipAt, B.share, B.belly, tx, tz));
    mass.add(tip, R.tip.fillet);
    for (const [k, shape] of shapes.entries()) if (!R.lobes[k].rock) mass.add(shape, R.fillet);
    // A flat top under the turf, level with the body's, its edge rolled into the cliffs (never a crease
    // where the shoulders' blends meet it): the coping's underside ends inside it.
    mass.cut(roundBox([0, 4 - B.top, 0], [S.a + 2, 4, S.b + 2], 0), R.cut);
    const earth = L.earth.map((c) => new T.Color(c)),
      seam = new T.Color(L.seam),
      stone = L.rock.map((c) => new T.Color(c)),
      c = new T.Color(),
      r = new T.Color(),
      step = T.MathUtils.smoothstep,
      [b0, b1, b2] = R.beds,
      /** A vertex's paint: `stoneAt` how much of it is rock (the rest earth), `into` how near the earth a boulder's vertex is (0 at it). */
      paint = (x: number, y: number, z: number, ny: number, stoneAt: number, into: number, out: Float32Array, i: number) => {
        const depth = -y,
          mottle = 1 + 0.07 * (noise3(x * 0.9 + 11.3, y * 1.4 + 5.2, z * 0.9 + 2.9) - 0.5),
          seamAt = Math.max(...[b0, b1].map((b) => 1 - step(Math.abs(depth - b), R.seam[0], R.seam[1])));
        c.copy(earth[0])
          .lerp(earth[1], step(depth, b0 - R.change, b0 + R.change))
          .lerp(earth[2], step(depth, b1 - R.change, b1 + R.change))
          .lerp(seam, seamAt * R.seamTone);
        // Rock: its cool grey, lighter on faces turned to the sky, a little darker toward the tip and
        // where a boulder goes into the earth.
        r.copy(stone[1])
          .lerp(stone[0], step(ny, -0.1, 0.7))
          .lerp(stone[2], step(depth, b2, S.depth) * 0.6)
          .multiplyScalar(T.MathUtils.lerp(R.set, 1, step(into, 0, 0.35)));
        c.lerp(r, stoneAt).multiplyScalar(mottle);
        // The sea's light thrown back up under the island: whatever faces down is lifted (warm, against
        // the hemisphere's olive ground light), so under the town's high sun the body reads as brown
        // earth and grey rock, never as a hole.
        const under = step(-ny, -0.1, 0.8);
        c.setRGB(c.r * (1 + R.bounce[0] * under), c.g * (1 + R.bounce[1] * under), c.b * (1 + R.bounce[2] * under)).toArray(out, i * 3);
      },
      /** Paint a mesh's vertices, and keep only the triangles that are not all `hidden`. */
      finish = (geometry: T.BufferGeometry, stoneAt: (x: number, y: number, z: number) => number, into: (x: number, y: number, z: number) => number, hidden: (i: number) => boolean) => {
        const p = geometry.getAttribute('position'),
          n = geometry.getAttribute('normal'),
          tones = new Float32Array(p.count * 3);
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i),
            y = p.getY(i),
            z = p.getZ(i);
          paint(x, y, z, n.getY(i), stoneAt(x, y, z), into(x, y, z), tones, i);
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
    // is kept, under the coping; nor is what the boulders bury.
    const ground = mass.mesh(),
      gp = ground.getAttribute('position'),
      inBoulder = (x: number, y: number, z: number) => Math.min(...boulders.map((s) => s.d(x, y, z)));
    finish(
      ground,
      (_x, y) => step(-y, R.spike[0], R.spike[1]),
      () => 1,
      (i) => (gp.getY(i) > -B.top - 0.1 && Math.hypot(gp.getX(i) / S.a, gp.getZ(i) / S.b) < B.share - 0.1) || inBoulder(gp.getX(i), gp.getY(i), gp.getZ(i)) < -0.08,
    );
    // The boulders, each on a grid of its own over its box: what the earth buries is left out.
    const parts = [ground];
    for (const shape of boulders) {
      const pad = 3 * R.grid,
        s = sculpt([shape.min[0] - pad, shape.min[1] - pad, shape.min[2] - pad], [shape.max[0] + pad, shape.max[1] + pad, shape.max[2] + pad], R.grid);
      s.add(shape);
      const stoneMesh = s.mesh(),
        sp = stoneMesh.getAttribute('position');
      parts.push(finish(stoneMesh, () => 1, (x, y, z) => mass.exact(x, y, z), (i) => mass.exact(sp.getX(i), sp.getY(i), sp.getZ(i)) < -0.08));
    }
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
   * the coping over it.
   */
  function skyUnderside(g: T.Group) {
    rock(g);
    coping(g);
    dimAtNight(g);
  }

  /* ---------------------------------------------------------------- */
  /* Alison                                                            */
  /* ---------------------------------------------------------------- */
  /**
   * Alison Heppenstall's figure (sky-figure's createAlison) on the island, in `root` (the island's
   * own root, outside every static batch: her root is a pivot of its own), going about her day from
   * town time alone: plan.alisonDay says where she is and what she does, poseAlison poses her, and
   * she stands on the lawn there (skyTop) or sits on her chair. So Pause and reduced motion, which
   * hold the town at time 0, leave her in her chair at tea, her cup resting on its saucer. Night and
   * rain change nothing, as for the town's walkers. Returns her root, which the town batches part by
   * part as it does its figures (it is `prebatched`: never by the animated loop).
   */
  function alison(root: T.Group) {
    const { root: figure, joints, props: held } = createAlison(material);
    figure.userData.keepSeparate = true;
    figure.userData.prebatched = true;
    root.add(figure);
    const update = (time: number) => {
      const day = plan.alisonDay(time),
        { lift } = poseAlison(joints, held, day.pose, day.phase, { seat: day.seat, amount: day.amount, step: day.step, side: day.side });
      figure.position.set(day.x, plan.skyTop(day.x, day.z) + lift, day.z);
      figure.rotation.y = day.heading;
    };
    update(0);
    ctx.animated.push({ object: figure, update });
    return figure;
  }

  return { skyGround, skyUnderside, standAt, skySlots, alison };
}
export type SkyIsland = ReturnType<typeof createSkyIsland>;
