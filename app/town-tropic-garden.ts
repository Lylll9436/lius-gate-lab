import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { SurfaceKind } from './city-materials';
import { taper } from './city-people';
import { palette, hash, sstep, mix, type TownContext } from './town-shared';
import * as plan from './town-plan';
import { saucerPieces, type ChinaLook } from './figure-rig';
import { sde4Plan, type Sde4Plan } from './town-sde4';
import { tropicGroundAt, tropicLampPools, tropicLampSpots } from './town-tropic';
import { FILIP_CAFE, FILIP_CHAIR, FILIP_DESK, FILIP_SITE } from './tropic-figure';
import type { Kit } from './town-kit';
import { crown, mergeCrown, noise3, paintCrown, trunkTube, type Look as CrownLook } from './town-nature';
import { ellipsoid, roundBox, sculpt } from './town-sculpt';
import { RESIDENCE_LOOK } from './town-residence';
import { AIRPORT_LOOK } from './town-airport';
import { GARDEN_LAMP, TEA, blob, chairParts, fuse, placed, solidMesh, tableSet, toned, turned, turns, type ChairLook, type Part, type TableLook, type Tint } from './town-sky-garden';

/*
 * The tropic island's garden (Filip Biljecki's island, off the south shore): its planting, the round
 * plaza before SDE4's door and the outdoor furniture of his stations. town-build hands it a group in
 * the island's frame and the site (tropicGardenSite: the island's ground and SDE4's plan).
 *
 * Every builder returns a group in a frame of its own (y 0 the ground the piece stands on, its front
 * or its lean along a stated axis) and never moves that group: whoever places it sets its position and
 * turn. tropicGarden() places the whole garden in the island's frame (origin at its middle, +x east, +z
 * south, y up from the water level the land's own ground is measured from) round SDE4 as the other
 * lanes build it: its roof's middle at (1.2, -1.1), its front due south, the land's walks and its coast
 * (town-plan's tropic island), the round plaza on the land's level terrace before the door (the land
 * lays no paving there: TropicSite.plaza) and SDE4 as its plan says (town-sde4's sde4Plan,
 * TROPIC_GARDEN.building).
 *
 * Nothing moves, so nothing is animated and Pause and reduced motion have nothing to hold. Nothing is
 * two-sided, transparent or cut out, nothing glows, and the island is evergreen: Singapore has no
 * seasons, so nothing here reads ctx.season (the town's trees take theirs in town-nature's tree(), from
 * the plan's plantingPlan(), which these trees are never part of). Every colour is on the vertices (the
 * materials are white), so each surface family batches as one mesh: foliage (the crowns, fronds, leaves
 * and shrubs, casting), the small foliage that casts nothing (the ferns, the frangipani's flowers and
 * the desk's plant), bark (trunks, limbs and coconuts), timber (the oak tops, seats and rails) and paint
 * (the bronze frames, the laptop, the café's saucer and the desk plant's pot); and the plaza's paving
 * (flush, casting nothing, its medallion in it) and its steps' stone where it has steps. Filip's own props (his phone and his cup) are his
 * body's (tropic-figure-look's filipProps); the café's saucer is the figure rig's china (figure-rig).
 */

/**
 * The garden's colours, each no more saturated than its palette family (TROPIC_GARDEN_FAMILY). The
 * rain tree's canopy is a darker, slightly bluer green than Glasgow's (its body tones, the lime its
 * lit tops lean a little to and the dark green of its underside), on grey-brown bark paling toward the
 * limbs' tips, with fern-green epiphytes; the coconut palm's frond green with yellower tips over a
 * darker underside, its trunk a grey-brown with green-brown nuts; the frangipani's pale grey bark, deep
 * green paddle leaves and cream flowers with a yellow heart; the shrubs in the hedge greens (a little
 * calmer than the hedge's own, so their blends stay inside its family), the fans a cooler, darker
 * green; a plaza of its own in the pale and grey granite (the kerb's and the residence's gravel) round
 * a flush medallion of dark granite (the airport's rubble) with a paler ring; the furniture's light oak on dark
 * bronze (the residence's); the laptop's aluminium, its keyboard a shade darker and its screen's inner
 * face dark; the café's china white with a warm grey band, coffee and a baked pastry; the desk plant's pale stone
 * pot; the garden lamps' pale stone plinths, posts in SDE4's white (its columns') under a cap and cup
 * in the champagne brass of its fins, and their frosted globes.
 */
export const TROPIC_GARDEN_LOOK = {
  rainBody: '#6b9440',
  rainBody2: '#628b3c',
  rainLit: '#8fae4f',
  rainUnder: '#3f5f2e',
  rainBark: '#6f5a48',
  rainLimb: '#8a7866',
  fern: '#5f8a3a',
  palmTrunk: '#a39582',
  palmFrond: '#6a9a3c',
  palmTip: '#86a849',
  palmUnder: '#4f7a32',
  palmBoot: '#6c7440',
  coconut: '#77703f',
  frangiBark: '#8f877b',
  frangiLeaf: '#55843a',
  frangiLit: '#79a24a',
  flower: palette.white,
  flowerHeart: palette.flowers[1],
  shrub: '#61902f',
  shrub2: '#699632',
  shrubLit: palette.hedgeTop,
  shrubUnder: '#2f5a22',
  fan: '#4d7d3c',
  fanLit: '#6d9a48',
  granitePale: palette.kerb,
  graniteGrey: RESIDENCE_LOOK.gravel,
  drum: AIRPORT_LOOK.rubble,
  drumTop: '#8c8b83',
  oak: RESIDENCE_LOOK.timber,
  bronze: RESIDENCE_LOOK.bronze,
  aluminium: '#b9bdbf',
  keys: '#9da1a3',
  screen: '#33383b',
  china: palette.white,
  chinaBand: '#a59d92',
  coffee: '#5e4230',
  pastry: '#d4b588',
  pot: RESIDENCE_LOOK.stone,
  lampStone: RESIDENCE_LOOK.stone,
  lampPost: palette.white,
  lampBrass: RESIDENCE_LOOK.brass,
  frost: palette.white,
};
/** Each colour's palette family: the colour may be no more saturated than it (check-town). */
export const TROPIC_GARDEN_FAMILY: Record<keyof typeof TROPIC_GARDEN_LOOK, string> = {
  rainBody: palette.canopy[0],
  rainBody2: palette.canopy[0],
  rainLit: palette.canopy[0],
  rainUnder: palette.canopy[0],
  rainBark: palette.bark,
  rainLimb: palette.bark,
  fern: palette.hedge,
  palmTrunk: palette.bark,
  palmFrond: palette.hedge,
  palmTip: palette.hedgeTop,
  palmUnder: palette.hedge,
  palmBoot: palette.hedge,
  coconut: palette.bark,
  frangiBark: palette.bark,
  frangiLeaf: palette.hedge,
  frangiLit: palette.hedgeTop,
  flower: palette.white,
  flowerHeart: palette.flowers[1],
  shrub: palette.hedge,
  shrub2: palette.hedge,
  shrubLit: palette.hedgeTop,
  shrubUnder: palette.hedge,
  fan: palette.hedge,
  fanLit: palette.hedgeTop,
  granitePale: palette.kerb,
  graniteGrey: palette.kerb,
  drum: palette.lead,
  drumTop: palette.lead,
  oak: palette.wood,
  bronze: palette.bronze,
  aluminium: palette.metal,
  keys: palette.metal,
  screen: palette.metal,
  china: palette.white,
  chinaBand: palette.kerb,
  coffee: palette.woodDark,
  pastry: palette.blonde,
  pot: palette.kerb,
  lampStone: palette.kerb,
  lampPost: palette.white,
  lampBrass: palette.brass,
  frost: palette.white,
};
type Look = keyof typeof TROPIC_GARDEN_LOOK;
const L = TROPIC_GARDEN_LOOK;

/**
 * The rain tree (Samanea saman), big and small. The key form is the broad umbrella: a crown much
 * wider than it is tall (`radius` out from the trunk, from its level underside `under` to its flat
 * domed `top`), held on a short trunk (`trunk` its radius over the root flare) that forks low, at
 * `fork`, into `limbs` long sinuous limbs reaching out almost level into the crown. `ferns` epiphyte
 * ferns sit on the limbs near the fork, as Singapore's rain trees carry them.
 */
export const RAIN_TREE = {
  big: { top: 4.2, under: 2.5, radius: 3.1, fork: 1.1, trunk: 0.24, limbs: 4, ferns: 2 },
  small: { top: 3.4, under: 2.0, radius: 2.3, fork: 0.9, trunk: 0.19, limbs: 4, ferns: 1 },
};
export type RainTreeSize = keyof typeof RAIN_TREE;
/**
 * The rain tree's umbrella canopy, one closed smooth form sculpted the way the sky island's clouds are
 * (town-sculpt: lobes blended into one another in a distance field, cut flat underneath with a rounded
 * edge), so it is one canopy with lumps, never a cluster of balls or a stack of pads. In shares of the
 * tree's radius R across and of its crown's depth (top less underside) up:
 * - `core`: a wide flattened lobe filling the middle (its radius, half-depth and middle's height);
 * - `hem`: the umbrella's edge, a ring of broad flattened lobes overlapping by nearly half (how many,
 *   how far out, radius, half-depth, middle's height), their outer edges on R: a softly scalloped hem;
 * - `dome`: its low dome, a lobe over the middle and a ring round it (how many, how far out, radius,
 *   half-depth, middle's height), the top of the middle one the crown's top;
 * - `florets`: the leafy lumps over all of it but its level underside, as the town trees' crowns have
 *   them (town-nature's clumps: soft domes joined by a soft maximum, so shallow valleys part them):
 *   domes about `spacing` of R apart (each reaching `reach` of that), the surface pushed out along its
 *   normal by `amp` of R times how far a point is up its dome past `level`, its normals then leant
 *   `soften` of the way back to the form's own, so the lumps read softly;
 * - `fillet`, the lobes' blend (a share of R); `grid`, the field's spacing; the underside is cut level
 *   at the crown's underside with a `round` edge;
 * - `bay`: toward the island's file the hem draws in and up (half its width in radians, its depth as a
 *   share of R and its lift as a share of the depth), a continuous edge under which the trunk and the
 *   fork show from the file's camera;
 * - `limb`: the limbs end inside the canopy, this far out and this high (shares of R and the depth).
 * Painted by which way it faces (lit on top, the hem's sides a shade darker, dark underneath) and
 * deeper in its valleys (how soon a step out along the normal meets more of it), mottled a little.
 */
export const RAIN_CROWN = {
  core: { r: 0.6, half: 0.4, y: 0.45 },
  hem: { big: 11, small: 9, out: 0.66, r: 0.34, half: 0.34, y: 0.28 },
  dome: { big: 6, small: 5, out: 0.34, r: 0.3, half: 0.3, y: 0.68, top: 0.27 },
  florets: { spacing: 0.24, reach: 0.9, amp: 0.085, level: 0.62, soften: 0.38 },
  fillet: 0.14,
  grid: { big: 0.21, small: 0.18 },
  round: 0.08,
  bay: { half: 0.9, depth: 0.15, lift: 0.1 },
  limb: { out: 0.46, y: 0.2 },
};
/**
 * The coconut palm: `height` to the crown's heart (3.0 to 4.0), its trunk leaning `lean` radians out
 * (along the palm's own +x) and curving back up near the top, swollen at its foot and ringed every
 * `ring` by gentle swellings (`swell` of its radius, toned `tone` either way, never dark stripes).
 * `fronds` arching fronds about `frond` times the height long, each a closed keeled solid (a shallow
 * V, its edges `cup` of the half-width over the midrib, `keel` deep at the midrib and never under
 * `floor`) `width` wide at its widest, cut deep into `fingers` strap-like leaflets a side (a notch
 * `notch` of the blade's width, a shoulder `shoulder` of it, a tip carried `ahead` of a finger's pitch toward the
 * frond's tip), each leaflet hanging below the rachis (`hang`: its shoulder and its tip that share of
 * their half-width under it, so seen from above the crown's outline softens into hanging pinnae, never
 * a saw edge), its normals leant `soften` of the way to the frond's own up so it shades as one soft
 * drooping surface, never a two-tone fold;
 * `nuts` coconuts under the crown.
 */
export const PALM = { fronds: 11, frond: 0.44, width: 0.42, cup: 0.12, keel: 0.07, floor: 0.045, fingers: 6, notch: 0.17, shoulder: 0.6, ahead: 0.62, hang: { shoulder: 0.15, tip: 0.35 }, soften: 0.85, ring: 0.22, swell: 0.07, tone: 0.04, nuts: 4 };
/**
 * The frangipani (Plumeria): a stout pale trunk `trunk` in radius up to `fork`, forking into three
 * thick blunt limbs and each of those into two (a candelabra of `tips` tips about `height` tall), a
 * rosette of `leaves` paddle leaves (`leaf` long, closed solids) at every tip and on half the tips a
 * cluster of `flowers` five-lobed flowers (`flower` across, a soft cup), all year; the leaves' normals
 * leant `soften` of the way to their own up, so each reads as one soft paddle.
 */
export const FRANGIPANI = { height: 2.0, trunk: 0.09, fork: 0.55, tips: 6, leaves: 7, leaf: 0.3, flowers: 5, flower: 0.12, soften: 0.85 };
/**
 * A leafy shrub's mound (shrubGeometry): its leaves in three tiers over a small dark leafy heart, each
 * tier its share of the leaves, how high its leaves start up the heart, how far out, their rise and
 * droop (radians) and their length (a share of the shrub's radius); every leaf is `width` of its
 * length across at its widest, cupped `cup` of that, its keel `keel` deep at the midrib.
 */
export const SHRUB = {
  tiers: [
    { share: 0.22, from: 0.62, out: 0.12, rise: 1.2, droop: 0.55, length: 0.78 },
    { share: 0.36, from: 0.42, out: 0.42, rise: 0.72, droop: 0.8, length: 0.86 },
    { share: 0.42, from: 0.16, out: 0.66, rise: 0.32, droop: 0.95, length: 0.8 },
  ],
  width: 0.42,
  cup: 0.12,
  keel: 0.04,
};
/**
 * A shrub bed (bedGeometry): a row of rounded lobes along its line, `spacing` of its width apart, blended
 * with a `fillet` in a field of spacing `grid` (`single` for a single shrub) and cut level `sink` under
 * the lawn with a `round` edge
 * (leafyMass), its surface given florets (`florets`: their pitch, reach, push, level and softening, as
 * RAIN_CROWN's), and a broad leaf arching out over its edges for about every `leaf.every` of its length
 * and width (`leaf`: their length and their width as a share of it): one leafy border, massed, never a
 * row of balls or a clipped hedge. A bed `wide.from` or more across is massed two deep (`wide`): its
 * field on a coarser `grid` (its lobes are big enough for it) with a broader `fillet`, its lobes `spacing` of its width apart,
 * `across` as wide, staggered `stagger` of its half-width either side of its line by turns and their
 * tops `low` to all of its height.
 */
export const SHRUB_BED = { spacing: 0.6, fillet: 0.1, grid: 0.1, single: 0.075, wide: { from: 1.0, grid: 0.17, fillet: 0.22, spacing: 0.45, across: 0.8, stagger: 0.34, low: 0.62 }, round: 0.05, sink: 0.05, florets: { pitch: 0.3, reach: 0.9, amp: 0.05, level: 0.62, soften: 0.45 }, leaf: { every: 0.55, length: 0.3, width: 0.42 } };
/**
 * A round plaza of the garden's own (design 1.6), built only where the land builds no court of its own
 * (TropicSite.plaza): `radius` across, in rings `rings` wide each from the outside in (pale and grey
 * granite by turns, the outermost pale with a flush `kerb` a shade lighter into the lawn; the innermost
 * `inner` plus its width out, run in to the medallion), lying `lift`
 * over the ground it is draped on with a `skirt` into it; at its middle a flush medallion (`medallion`:
 * a dark granite disc `r` round, its outer `ring` a paler granite; laid in the rings at their own lift,
 * clear of the entrance step's nosing, nothing standing proud: people walk over it); at its north edge
 * two broad shallow steps up to the podium (`step`: each riser, tread and how far the nosing's pale
 * band reaches back).
 */
export const GARDEN_PLAZA = {
  radius: 1.7,
  rings: [0.33, 0.33, 0.33, 0.33],
  kerb: 0.08,
  lift: plan.TROPIC_PLAZA.lift,
  skirt: 0.07,
  medallion: { r: 0.24, ring: 0.06 },
  inner: 0.36,
  step: { rise: 0.06, tread: 0.26, nosing: 0.07 },
};
/**
 * Filip as the furniture seats him (tropic-figure's FILIP_CHAIR, FILIP_DESK and FILIP_CAFE are the
 * furniture's one source: what the garden builds to his measures is made from them below): his root
 * seated `setback` behind his chair's front edge (the tea table's sitter's, scaled with him by 1.08).
 */
export const SITTER = { setback: FILIP_CHAIR.setback };
/**
 * The veranda desk (FILIP_DESK's): a light oak top `w` by `d`, `slab` thick, its top at the tea table's height
 * (TEA.top, so every seated solve of the sky island's figure holds), on four `leg` dark-bronze legs
 * with a `rail` under the top on its front and its ends (none on the sitter's side, where the knees
 * go). Its sitter faces it from its -z side: his root `near` behind its near edge and `across` to the
 * +x of its middle (the desk's middle to his right, its free end with a potted plant on his right),
 * the bistro chair under him (BISTRO_CHAIR, its front edge SITTER.setback ahead of his root). A laptop
 * (LAPTOP) stands square in front of him, its near edge `inset` behind the desk's; the potted plant
 * (`plant`: the pot's radius and height, and the leafy clump's radius) on the desk's far -x corner.
 */
export const DESK = { w: FILIP_DESK.width, d: FILIP_DESK.depth, slab: FILIP_DESK.thick, leg: 0.07, rail: 0.07, near: FILIP_DESK.near, across: FILIP_DESK.across, inset: FILIP_DESK.laptop.inset, plant: { pot: 0.065, height: 0.09, leaves: 0.11 } };
/** The chunky toy laptop (FILIP_DESK.laptop): base `w` by `d`, `base` thick, its lid as large and `lid` thick, opened `open` from the base (leaning back, away from its user). */
export const LAPTOP = { w: FILIP_DESK.laptop.w, d: FILIP_DESK.laptop.d, base: FILIP_DESK.laptop.base, lid: 0.07, open: FILIP_DESK.laptop.open };
/**
 * The bistro chair (the desk's and the café's): the town's 0.44 seat in oak on a dark-bronze frame,
 * with a foot ring whose top is `ring` over the floor, where a seated figure's soles rest (the
 * residents' convention leaves soles about 0.3 off the floor at that seat).
 */
export const BISTRO_CHAIR: ChairLook = { seat: 'oak', frame: 'bronze', frameKind: 'paint', ring: 0.3 };
/**
 * The café's round bistro table: an oak top FILIP_CAFE.radius (0.34) in radius at TEA.top on one dark-bronze pedestal on
 * a round foot, two bistro chairs opposite one another (their fronts TEA.gap off its edge), no tea set.
 * No parasol: from the file's camera, 42 degrees up, a parasol over a seated figure hides him. It
 * stands at the rim of the small rain tree's shade (TROPIC_GARDEN), as near as keeps him in sight from
 * all four of the file's Rotate stops, with a frangipani just south of it.
 */
export const CAFE_TABLE: TableLook = {
  name: 'tropic-cafe',
  radius: FILIP_CAFE.radius,
  top: 'oak',
  pedestal: { profile: [[0, 0], [0.2, 0, 1], [0.2, 0.022, 1], [0.16, 0.046], [0.07, 0.072], [0.045, 0.1, 1], [0.04, 0.16], [0.04, TEA.top - 0.12], [0.06, TEA.top - 0.096, 1], [0.12, TEA.top - 0.08, 1], [0, TEA.top - 0.08]], look: 'bronze', kind: 'paint', sides: 16 },
  chair: BISTRO_CHAIR,
  set: false,
};
/**
 * Where the café's saucer stands on its table: `ahead` of its sitter's root (in the -x chair) and
 * `right` to his right (FILIP_CAFE.saucer: across to his left, and ahead), where his right hand takes
 * the cup from it.
 */
export const CAFE_SAUCER = { ahead: FILIP_CAFE.saucer[1], right: -FILIP_CAFE.saucer[0] };
/**
 * The café table laid as Alison's tea table is (its china's family): a small round plate in the
 * café's china, `r` round and `h` from foot to rim (as chunky as its saucer; its well `well` up), with one chunky baked pastry
 * on it (a soft blob, half sizes `pastry`), on the table's far half across from his saucer: `left` to
 * his left of it and `ahead` further from him, clear of the way his right hand takes the cup from the
 * saucer to his mouth.
 */
export const CAFE_PLATE = { r: 0.06, h: 0.07, well: 0.04, pastry: [0.046, 0.036, 0.04] as [number, number, number], left: 0.15, ahead: 0.1 };
/**
 * The island's low garden lamps (town-tropic's tropicLampSpots says where; TROPIC_LAMPS): the sky
 * island's garden lamp (town-sky-garden's GARDEN_LAMP's measures: a frosted globe on a cup, on a short
 * post on a pale stone plinth), lighter, and in SDE4's own colours rather than the town's dark cast
 * iron (which read as black pawns beside its white columns): a white post, its cap and its cup in the
 * fins' champagne brass, its plinth and cap `base` square (narrower than the sky's, so a post beside
 * the bay walk keeps the walkers' 0.27 off Filip's call), the cup turned on `cup` sides (one mesh with
 * the posts and plinths), its globe `globe` round on `segments` (width and height), a little smaller
 * than the sky's for the same reason.
 */
export const TROPIC_LAMP = { base: 0.24, cup: 6, globe: 0.115, segments: [10, 6] as [number, number] };
/**
 * The walks' timber (plan.TROPIC_PATHS: the landing and the seat), light oak, boards drawn broad by a
 * quiet tonal step (`tones`, by turns), never by gaps:
 * - `landing`: its deck's boards `board` deep across the axis and `slab` thick, the deck's visible edge
 *   that slab (a thin fascia), and under it, `inset` in from every side, a dark plinth (`dark`: the oak
 *   in shadow) down into the lawn and the sand, so the deck reads light, floating a shadow's width over
 *   the ground; on its seaward side steps as wide as the deck, each `tread` deep, their rises even
 *   between `rise` (as many as the drop to the sand needs), each a block down into the sand;
 * - `bench`: on the seat's far rim (`back` beyond the seat's middle along the walk), facing back down
 *   the walk over the open lawn to the bay: an oak slab `length` by `depth`, `slab` thick, its top at
 *   the town's 0.44 seat (`seat`), on two oak legs `leg` thick set `inset` in from its ends.
 */
export const WALK_TIMBER = {
  landing: { board: 0.24, slab: 0.07, inset: 0.1, dark: 0.5, tread: 0.3, rise: [0.06, 0.08] as [number, number], tones: [1.06, 0.97] },
  bench: { length: 1.2, depth: 0.46, slab: 0.09, seat: 0.44, leg: 0.13, inset: 0.18, back: 0.2 },
};
/**
 * The landing as the garden builds it on the island's ground (`ground`, in the island's frame), from
 * plan.TROPIC_PATHS.landing: its plan (x0..x1, z0..z1), its deck's top (`top`: the bay walk's surface
 * where they meet and the landing's `over`), the sand at its seaward edge, and its steps down to the
 * sand (each tread's plan and top; the last rise lands on the sand at `foot`), `rise` each.
 */
export function tropicLanding(ground: (x: number, z: number) => number) {
  const W = plan.TROPIC_PATHS,
    D = W.landing,
    T0 = WALK_TIMBER.landing,
    x0 = D.x - D.width / 2,
    x1 = D.x + D.width / 2,
    walk = ground(D.x, D.z0) + W.lift,
    top = walk + D.over,
    sand = ground(D.x, D.z1),
    n = Math.max(1, Math.ceil((top - sand) / T0.rise[1] - 1e-9)),
    rise = (top - sand) / n,
    steps = Array.from({ length: n - 1 }, (_, k) => ({ z0: D.z1 + k * T0.tread, z1: D.z1 + (k + 1) * T0.tread, top: top - (k + 1) * rise }));
  return { x0, x1, z0: D.z0, z1: D.z1, walk, top, sand, rise, steps, foot: D.z1 + (n - 1) * T0.tread };
}
/** The seat's bench (WALK_TIMBER.bench) in the island's frame: its middle and the way its sitter faces (a bearing: back down the walk). */
export function tropicBench() {
  const W = plan.TROPIC_PATHS,
    a = W.tree.ahead,
    B = WALK_TIMBER.bench;
  return { x: W.seat.x + a[0] * B.back, z: W.seat.z + a[1] * B.back, facing: Math.atan2(-a[0], -a[1]) };
}

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */
type V3 = [number, number, number];
const UP = new T.Vector3(0, 1, 0);
/**
 * The thinnest keel any blade of the kit has been built with: a blade's depth under its midrib, where
 * it is thickest across (check-town reads it once the garden is built). Its edges come to a point, as
 * a leaf's do.
 */
export const BLADES = { thinnest: Infinity };
/**
 * A closed leaf solid along a midrib: the midrib's stations (`at`, its point; `along`, its unit
 * direction; `up`, the blade's own up there, square to `along`), each with the blade's half-width
 * there (`w`), how far its edges stand over the midrib (`v`: a shallow V when positive), the keel's
 * depth under the midrib (`t`) and how far the edges are carried forward along the midrib (`ahead`,
 * so a finger points toward the tip). The top face runs edge to midrib to edge; the bottom face
 * shares the edges and dips to the keel, so the solid closes along its outline and is never a
 * single sheet. Its base end is closed by a cap; a last station of no width closes the tip.
 * `colour(u, side, across)` paints it: u from base (0) to tip (1), side 1 the top face and -1 the
 * bottom, across 0 at the midrib and 1 at an edge. `soften` leans each face's normals that share of
 * the way to the blade's own up (or down), so its V shades as one soft surface.
 */
type Station = { at: T.Vector3; along: T.Vector3; up: T.Vector3; w: number; v: number; t: number; ahead?: number };
function bladeGeometry(stations: Station[], colour: (u: number, side: number, across: number) => T.Color, soften = 0) {
  const pos: number[] = [],
    col: number[] = [],
    index: number[] = [],
    n = stations.length,
    across = new T.Vector3(),
    p = new T.Vector3();
  const push = (q: T.Vector3, c: T.Color) => {
    pos.push(q.x, q.y, q.z);
    col.push(c.r, c.g, c.b);
    return pos.length / 3 - 1;
  };
  for (const s of stations) if (s.w > 0) BLADES.thinnest = Math.min(BLADES.thinnest, s.t);
  // Per station: left edge, midrib top, right edge (top face); left edge, keel, right edge (bottom face).
  const ids: number[][] = [];
  stations.forEach((s, i) => {
    const u = i / (n - 1);
    across.crossVectors(s.along, s.up).normalize();
    const edge = (side: number) => p.copy(s.at).addScaledVector(across, side * s.w).addScaledVector(s.up, s.v).addScaledVector(s.along, s.ahead ?? 0),
      row = [
        push(edge(-1), colour(u, 1, 1)),
        push(p.copy(s.at), colour(u, 1, 0)),
        push(edge(1), colour(u, 1, 1)),
        push(edge(-1), colour(u, -1, 1)),
        push(p.copy(s.at).addScaledVector(s.up, -s.t), colour(u, -1, 0)),
        push(edge(1), colour(u, -1, 1)),
      ];
    ids.push(row);
  });
  for (let i = 0; i + 1 < n; i++) {
    const [a0, a1, a2, b0, b1, b2] = ids[i],
      [c0, c1, c2, d0, d1, d2] = ids[i + 1];
    // Top: its normals along the blade's up (left edge, midrib, right edge, base to tip).
    index.push(a0, a1, c0, a1, c1, c0, a1, a2, c1, a2, c2, c1);
    // Bottom: the same quads, turned to face down.
    index.push(b0, d0, b1, b1, d0, d1, b1, d1, b2, b2, d1, d2);
  }
  // The base's cap, on vertices of its own (so it leaves the faces' shading alone): the top's middle
  // and the keel meet the two edges across it.
  const c = colour(0, -1, 0),
    [e0, e1, e2, , f1] = ids[0].map((i) => push(p.fromArray(pos, i * 3), c));
  index.push(e0, f1, e1, e1, f1, e2);
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  if (soften) {
    const normal = g.getAttribute('normal'),
      q = new T.Vector3(),
      down = new T.Vector3();
    stations.forEach((s, i) =>
      ids[i].forEach((id, k) => {
        q.fromBufferAttribute(normal, id).lerp(k < 3 ? s.up : down.copy(s.up).negate(), soften).normalize();
        normal.setXYZ(id, q.x, q.y, q.z);
      }),
    );
  }
  return g;
}
/**
 * A midrib arching from `from` out along the bearing `heading` (radians from +x toward +z), leaving
 * at `rise` radians over level and bending down by `droop` radians by its tip (`length` long), in
 * `count` stations at the shares `us` of its length; each station's up is the arch's own up.
 */
function arch(from: T.Vector3, heading: number, rise: number, droop: number, length: number, us: number[]) {
  const out = new T.Vector3(Math.cos(heading), 0, Math.sin(heading)),
    stations: { at: T.Vector3; along: T.Vector3; up: T.Vector3 }[] = [],
    // (Fine steps: a station lands on the step its share falls in, and the palm's fingers are close.)
    steps = 160;
  let x = 0,
    y = 0,
    k = 0;
  const angle = (u: number) => rise - droop * u * u * (1.6 - 0.6 * u);
  for (let s = 0; s <= steps; s++) {
    const u = s / steps,
      a = angle(u);
    while (k < us.length && us[k] <= u + 1e-9) {
      const along = out.clone().multiplyScalar(Math.cos(a)).addScaledVector(UP, Math.sin(a)).normalize(),
        up = out.clone().multiplyScalar(-Math.sin(a)).addScaledVector(UP, Math.cos(a)).normalize();
      stations.push({ at: from.clone().addScaledVector(out, x).addScaledVector(UP, y), along, up });
      k++;
    }
    x += (Math.cos(a) * length) / steps;
    y += (Math.sin(a) * length) / steps;
  }
  return stations;
}
const tone = new T.Color(),
  toneB = new T.Color();
/** A colour between two looks, times `k`. */
const between = (a: string, b: string, f: number, k = 1) => tone.set(a).lerp(toneB.set(b), T.MathUtils.clamp(f, 0, 1)).multiplyScalar(k).clone();
/**
 * A smooth tube through points with round ends (city-people's taper), its faces turned outward
 * (taper winds them inward; the sky figure turns its own the same way).
 */
function tube(points: V3[], radii: number[], seg: number, radial: number) {
  const g = taper(points, radii, seg, radial),
    index = g.getIndex()!;
  for (let i = 0; i < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
  return g;
}
/** Paint every vertex of a geometry from its position (and normal). */
function painted(g: T.BufferGeometry, colour: (p: T.Vector3, n: T.Vector3) => T.Color) {
  const q = g.getAttribute('position'),
    m = g.getAttribute('normal'),
    out = new Float32Array(q.count * 3),
    p = new T.Vector3(),
    n = new T.Vector3();
  for (let i = 0; i < q.count; i++) colour(p.fromBufferAttribute(q, i), n.fromBufferAttribute(m, i)).toArray(out, i * 3);
  g.setAttribute('color', new T.BufferAttribute(out, 3));
  return g;
}
/** Geometries as one, their colours on the vertices (each must carry position, normal and color). */
function merged(list: T.BufferGeometry[]) {
  const plain = list.map((g) => {
    const f = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(f.attributes)) if (!['position', 'normal', 'color'].includes(name)) f.deleteAttribute(name);
    return f;
  });
  const out = mergeGeometries(plain)!;
  for (const g of new Set([...list, ...plain])) g.dispose();
  return out;
}
/** The café's china (figure-rig's cup and saucer): white with a warm grey band at the rim, and coffee. */
const CHINA: ChinaLook = { china: L.china, band: L.chinaBand, drink: L.coffee };

/** A lobe of a leafy mass: an ellipsoid's middle and radii, turned `rot` (an Euler, XYZ) when given. */
type Lobe = { c: V3; r: V3; rot?: V3 };
/** A leafy mass's colours: its two body tones, its dark underside and the lime its lit tops lean to. */
type LeafyLook = { body: string; body2: string; under: string; lit: string };
/**
 * A leafy mass (the rain trees' canopies, the shrub beds): its lobes blended into one another in a
 * distance field of spacing `grid` (town-sculpt, as the sky island's clouds are; the first lobe hard,
 * the rest with a `fillet`), cut level at `floor` with a `round` edge, so it is one closed smooth form
 * with exact normals, never a cluster of balls. Then its surface, but where it faces down, is given the
 * town crowns' florets (town-nature's clumps: soft domes on a seeded grid `pitch` apart, each reaching
 * `reach` of that, joined by a soft maximum so shallow valleys part them): pushed out along its normal
 * by `amp` times how far a point is up its dome past `level`, its normals leant `soften` of the way back
 * to the form's own so the lumps read softly. Painted by which way it faces (lit on top, the sides a shade
 * darker, dark underneath), lighter up its height (`y0` to `y1`), deeper in its valleys (how soon a step
 * out along the normal meets more of it) and between florets, mottled a little between its two tones.
 * Returns the geometry (position, normal, colour), its field (negative inside) and its top.
 */
function leafyMass(lobes: Lobe[], o: { fillet: number; grid: number; floor: number; round: number; pitch: number; reach: number; amp: number; level: number; soften: number; look: LeafyLook; y0: number; y1: number; seed: number }) {
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (const { c, r } of lobes) {
    const e = Math.max(...r);
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], c[i] - e);
      hi[i] = Math.max(hi[i], c[i] + e);
    }
  }
  const { grid, fillet, seed } = o,
    pad = fillet + 3 * grid,
    s = sculpt([lo[0] - pad, o.floor - 3 * grid, lo[2] - pad], [hi[0] + pad, hi[1] + pad, hi[2] + pad], grid);
  lobes.forEach(({ c, r, rot }, i) => s.add(ellipsoid(c, r, rot), i === 0 ? 0 : fillet));
  s.cut(roundBox([(lo[0] + hi[0]) / 2, o.floor - 2, (lo[2] + hi[2]) / 2], [hi[0] - lo[0] + 4, 2, hi[2] - lo[2] + 4], 0), o.round);
  const geometry = s.mesh(),
    p = geometry.getAttribute('position'),
    n = geometry.getAttribute('normal'),
    count = p.count,
    // The form's own normals and each point's floret height (0 in a valley, about 1 on a dome).
    form = Float32Array.from(n.array as Float32Array),
    lump = new Float32Array(count),
    { pitch } = o,
    reach = o.reach * pitch,
    // A floret's middle in each cell of a grid `pitch` apart, jittered by the seed (each worked out once).
    domes = new Map<number, V3>(),
    dome = (i: number, j: number, k: number) => {
      const key = (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512);
      let q = domes.get(key);
      if (!q) {
        const jitter = (d: number) => (hash(seed * 7.7 + i * 12.9898 + j * 78.233 + k * 37.719 + d * 3.1) - 0.5) * 0.7;
        q = [(i + 0.5 + jitter(1)) * pitch, (j + 0.5 + jitter(2)) * pitch, (k + 0.5 + jitter(3)) * pitch];
        domes.set(key, q);
      }
      return q;
    },
    at = new T.Vector3(),
    was = new T.Vector3();
  for (let v = 0; v < count; v++) {
    at.fromBufferAttribute(p, v);
    const gi = Math.floor(at.x / pitch),
      gj = Math.floor(at.y / pitch),
      gk = Math.floor(at.z / pitch);
    let sum = 0;
    for (let i = gi - 1; i <= gi + 1; i++)
      for (let j = gj - 1; j <= gj + 1; j++)
        for (let k = gk - 1; k <= gk + 1; k++) {
          const q = dome(i, j, k),
            t = Math.min(1, 1 - Math.hypot(at.x - q[0], at.y - q[1], at.z - q[2]) / reach);
          if (t > 0) {
            const e = t * t * (3 - 2 * t);
            sum += e * e * e;
          }
        }
    const l = Math.min(1.15, Math.cbrt(sum)),
      // A level underside keeps flat: no florets on faces turned down.
      push = o.amp * (l - o.level) * sstep(form[v * 3 + 1], -0.55, -0.15);
    lump[v] = l;
    p.setXYZ(v, at.x + form[v * 3] * push, at.y + form[v * 3 + 1] * push, at.z + form[v * 3 + 2] * push);
  }
  geometry.computeVertexNormals();
  for (let v = 0; v < count; v++) {
    at.fromBufferAttribute(n, v).lerp(was.fromArray(form, v * 3), o.soften).normalize();
    n.setXYZ(v, at.x, at.y, at.z);
  }
  const colour = new Float32Array(count * 3),
    c = new T.Color(),
    body = new T.Color(),
    under = new T.Color(o.look.under),
    lit = new T.Color(o.look.lit),
    step = 2.2 * grid;
  let top = -Infinity;
  for (let v = 0; v < count; v++) top = Math.max(top, p.getY(v));
  for (let v = 0; v < count; v++) {
    const x = p.getX(v),
      y = p.getY(v),
      z = p.getZ(v),
      ny = n.getY(v),
      // 1 in the open, less in a valley: how far the field has opened a step out along the normal.
      open = sstep(s.exact(x + n.getX(v) * step, y + ny * step, z + n.getZ(v) * step) / step, 0.3, 0.95),
      up = 0.35 * sstep((y - o.y0) / (o.y1 - o.y0), 0.05, 0.85) + 0.65 * sstep(ny, -0.45, 0.85),
      mottle = noise3(x * 0.8 + seed, y * 0.8, z * 0.8 - seed);
    body.set(o.look.body).lerp(c.set(o.look.body2), sstep(mottle, 0.3, 0.7));
    c.copy(body).lerp(under, 0.55 * (1 - up)).lerp(lit, 0.5 * sstep(up, 0.5, 1) * Math.max(0, ny));
    c.multiplyScalar(mix(0.6, 1.05, up) * mix(0.78, 1, open) * mix(0.84, 1.04, sstep(lump[v], 0.25, 0.95)) * (0.97 + 0.06 * noise3(x * 2.4 - seed, y * 2.4, z * 2.4)));
    c.toArray(colour, v * 3);
  }
  geometry.setAttribute('color', new T.BufferAttribute(colour, 3));
  return { geometry, field: s.exact, top };
}

/* ------------------------------------------------------------------ */
/* The garden kit                                                      */
/* ------------------------------------------------------------------ */
export function createTropicGarden(ctx: TownContext, kit: Kit) {
  const { material, lamps } = ctx;
  const { chamfered } = kit;

  /** One mesh of geometries carrying their own colours, in g: it casts unless `shadow` is false. */
  function mesh(g: T.Object3D, geometry: T.BufferGeometry, kind: SurfaceKind, name: string, looks: Look[], opts: { shadow?: boolean; band?: boolean; ground?: boolean } = {}) {
    const m = new T.Mesh(geometry, material('#ffffff', kind));
    m.name = name;
    m.userData.looks = looks;
    const shadow = opts.shadow ?? true;
    m.castShadow = shadow;
    m.receiveShadow = true;
    if (!shadow) m.userData.noShadow = true;
    if (opts.band) m.userData.band = true;
    if (opts.ground) m.userData.ground = true;
    g.add(m);
    return m;
  }

  /* ---------------------------------------------------------------- */
  /* Rain tree                                                         */
  /* ---------------------------------------------------------------- */
  /**
   * A rain tree (RAIN_TREE), its trunk's foot on the origin. `facing` is the bearing (radians from +x
   * toward +z, in the tree's frame) the island's file looks from: the crown's hem draws in and up in a
   * bay there (RAIN_CROWN.bay), so the trunk and the fork show under one continuous edge.
   * - The trunk: short and stout, a gentle lean, its foot spread into five shallow buttresses, grey-
   *   brown bark shading as it goes up under the crown.
   * - The limbs: each a smooth tapering tube from the fork, rising steeply, then swinging out almost
   *   level in a gentle S, paler toward its tip, which ends inside the canopy (never a bare tip).
   * - The crown (canopy, RAIN_CROWN): one closed leafy form sculpted from a core, a low dome and a
   *   scalloped hem, cut level underneath, the town crowns' florets over it; painted by which way it
   *   faces (lit on top and on the hem's upper faces alike, the hem's sides a shade darker, dark only
   *   underneath), so it reads as one umbrella with lumps.
   * - Ferns: small rosettes of chunky blades sitting on the limbs near the fork.
   * `userData.crown` gives the crown's middle (x, z), radius, underside, top and bay bearing; and
   * `userData.limbs` each limb's tip (x, y, z), its radius there and how deep inside the canopy it is.
   */
  function rainTree({ size = 'big' as RainTreeSize, seed = 1, facing = 0 } = {}) {
    const S = RAIN_TREE[size],
      C = RAIN_CROWN,
      g = new T.Group();
    g.name = `tropic-rain-tree-${size}`;
    const h = (n: number) => hash(seed * 17.31 + n * 3.71),
      { top: H, under: U, radius: R, fork: F, trunk: r0 } = S,
      th = H - U,
      spin = h(1) * Math.PI * 2,
      lean = [(h(2) - 0.5) * 0.16, (h(3) - 0.5) * 0.16],
      bend = (y: number): [number, number] => {
        const q = Math.max(0, Math.min(1, y / F)) ** 2;
        return [lean[0] * q, lean[1] * q];
      };
    // The trunk: rows close at the foot (the buttresses) and at the fork.
    const rows = [-0.06, 0, 0.04, 0.09, 0.16, 0.26, 0.4, 0.58, 0.8, 1].map((v) => v * (F - 0.12)).concat([F, F + 0.14]);
    const wood = trunkTube(rows, 12, (y, a) => {
      const taper = mix(r0, r0 * 0.8, Math.max(0, y) / (F + 0.14)),
        foot = Math.max(0, 1 - Math.max(0, y) / 0.45) ** 2,
        buttress = 0.25 + 0.75 * Math.max(0, Math.cos(5 * (a + spin))) ** 2;
      return taper + 0.7 * r0 * foot * buttress;
    }, bend);
    painted(wood, (p) => between(L.rainBark, L.rainBark, 0, mix(1, 0.8, sstep(p.y, 0.3, F)) * (0.97 + 0.06 * noise3(p.x * 4 + seed, p.y * 3, p.z * 4))));
    const [fx, fz] = bend(F),
      forkAt = new T.Vector3(fx, F - 0.06, fz),
      limbs: T.BufferGeometry[] = [wood],
      seats: { at: T.Vector3; r: number }[] = [],
      tips: { at: V3; r: number }[] = [];
    // The limbs: out along their bearings, rising into the crown's underside and ending in its core.
    const k0 = r0 / 0.24,
      endY = U + C.limb.y * th,
      rise = endY - F;
    for (let k = 0; k < S.limbs; k++) {
      const a = spin + (k / S.limbs) * Math.PI * 2 + (h(10 + k) - 0.5) * 0.5,
        reach = R * (C.limb.out + 0.05 * h(20 + k)),
        out = new T.Vector3(Math.cos(a), 0, Math.sin(a)),
        side = new T.Vector3(-Math.sin(a), 0, Math.cos(a)),
        wiggle = (h(30 + k) - 0.5) * 0.5 * reach * 0.35,
        points: V3[] = [
          [forkAt.x, forkAt.y - 0.05, forkAt.z],
          forkAt.clone().addScaledVector(out, 0.16 * reach).addScaledVector(UP, 0.42 * rise).addScaledVector(side, -wiggle * 0.4).toArray() as V3,
          forkAt.clone().addScaledVector(out, 0.45 * reach).addScaledVector(UP, 0.78 * rise).addScaledVector(side, wiggle).toArray() as V3,
          forkAt.clone().addScaledVector(out, 0.75 * reach).addScaledVector(UP, 0.94 * rise).addScaledVector(side, -wiggle * 0.5).toArray() as V3,
          forkAt.clone().addScaledVector(out, reach).addScaledVector(UP, rise + 0.06).toArray() as V3,
        ],
        radii = [0.13 * k0, 0.11 * k0, 0.085 * k0, 0.065 * k0, 0.05 * k0],
        limb = tube(points, radii, 9, 7);
      // Paler toward the tip, in the canopy's shade where it climbs into it.
      painted(limb, (p) => {
        const along = Math.min(1, Math.hypot(p.x - forkAt.x, p.z - forkAt.z) / reach);
        return between(L.rainBark, L.rainLimb, along, 0.8 * mix(1, 0.88, sstep(p.y, U - 0.3, U + 0.2)) * (0.97 + 0.06 * noise3(p.x * 5, p.y * 5 + seed, p.z * 5)));
      });
      limbs.push(limb);
      // Where a fern may sit: on top of the limb between its first two bends, near the fork.
      seats.push({ at: new T.Vector3(...points[1]).lerp(new T.Vector3(...points[2]), 0.45), r: mix(radii[1], radii[2], 0.45) });
      tips.push({ at: points[4], r: radii[4] });
    }
    mesh(g, merged(limbs), 'bark', 'tropic-rain-wood', ['rainBark', 'rainLimb']);
    // The crown.
    const cx = fx,
      cz = fz,
      { geometry, field } = canopy(size, seed, cx, cz, U, H, R, facing);
    mesh(g, geometry, 'foliage', 'tropic-rain-crown', ['rainBody', 'rainBody2', 'rainLit', 'rainUnder']);
    // Ferns on the limbs near the fork, on their upper side.
    const ferns: T.BufferGeometry[] = [];
    for (let k = 0; k < S.ferns; k++) {
      const on = seats[(k * 2) % seats.length];
      ferns.push(fern(on.at.clone().addScaledVector(UP, on.r * 0.8), seed * 7 + k));
    }
    mesh(g, merged(ferns), 'foliage', 'tropic-rain-ferns', ['fern'], { shadow: false });
    g.userData.crown = { x: cx, z: cz, radius: R, under: U, top: H, bay: facing };
    // How deep inside the canopy each limb's tip is (the field's depth there, its radius included).
    g.userData.limbs = tips.map(({ at, r }) => ({ at, r, depth: -field(...at) }));
    return g;
  }
  /**
   * The rain tree's canopy (RAIN_CROWN), its middle over (cx, cz), from its level underside U to its top
   * H and R round: the core, the dome's lobes, the hem's ring (drawn in and up in the bay toward
   * `facing`), blended in one distance field and cut level at U, with the crowns' florets over all of
   * it but its underside (leafyMass); painted by which way it faces, deeper in its valleys and mottled a
   * little. Its top is exactly H. Returns the geometry and the field (negative inside), for the limbs' tips.
   */
  function canopy(size: RainTreeSize, seed: number, cx: number, cz: number, U: number, H: number, R: number, facing: number) {
    const C = RAIN_CROWN,
      th = H - U,
      h = (n: number) => hash(seed * 29.17 + n * 4.13),
      spin = h(1) * Math.PI * 2,
      bay = (a: number) => {
        const t = Math.abs(plan.angleDiff(a, facing)) / C.bay.half;
        return t < 1 ? Math.cos((t * Math.PI) / 2) ** 2 : 0;
      },
      lobes: { c: V3; r: V3 }[] = [],
      lobe = (a: number, d: number, y: number, r: number, half: number) => lobes.push({ c: [cx + Math.cos(a) * d, y, cz + Math.sin(a) * d], r: [r, half, r] });
    lobe(0, 0, U + C.core.y * th, C.core.r * R, C.core.half * th);
    lobe(0, 0, H - C.dome.top * th, C.dome.r * R * 1.05, C.dome.top * th);
    const D = C.dome,
      E = C.hem;
    for (let k = 0; k < D[size]; k++) lobe(spin + (k / D[size]) * Math.PI * 2 + (h(10 + k) - 0.5) * 0.4, D.out * R * (0.94 + 0.12 * h(20 + k)), U + D.y * th - 0.05 * th * h(30 + k), D.r * R * (0.94 + 0.12 * h(40 + k)), D.half * th);
    for (let k = 0; k < E[size]; k++) {
      const a = spin + 0.35 + (k / E[size]) * Math.PI * 2 + (h(50 + k) - 0.5) * 0.25,
        b = bay(a),
        r = E.r * R * (0.94 + 0.12 * h(60 + k)) * (1 - 0.1 * b);
      lobe(a, R - r - C.bay.depth * R * b, U + E.y * th + C.bay.lift * th * b + 0.04 * th * (h(70 + k) - 0.5), r, E.half * th * (1 - 0.1 * b));
    }
    const F = C.florets,
      { geometry, field, top } = leafyMass(lobes, {
        fillet: C.fillet * R,
        grid: C.grid[size],
        floor: U,
        round: C.round * R,
        pitch: F.spacing * R,
        reach: F.reach,
        amp: F.amp * R,
        level: F.level,
        soften: F.soften,
        look: { body: L.rainBody, body2: L.rainBody2, under: L.rainUnder, lit: L.rainLit },
        y0: U,
        y1: H,
        seed,
      });
    // Its top exactly H and its underside U: stretched up or down a little between them (the blend
    // rounds the lobes' tops off and the florets push them up), its normals turned to match.
    const k = (H - U) / (top - U),
      p = geometry.getAttribute('position'),
      n = geometry.getAttribute('normal'),
      q = new T.Vector3();
    for (let i = 0; i < p.count; i++) {
      p.setY(i, U + (p.getY(i) - U) * k);
      q.set(n.getX(i), n.getY(i) / k, n.getZ(i)).normalize();
      n.setXYZ(i, q.x, q.y, q.z);
    }
    return { geometry, field: (x: number, y: number, z: number) => field(x, U + (y - U) / k, z) };
  }
  /** An epiphyte fern: a rosette of six chunky arching blades, about 0.35 across, its heart at `at`. */
  function fern(at: T.Vector3, seed: number) {
    const blades: T.BufferGeometry[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + hash(seed * 5.1 + k) * 0.6,
        length = 0.17 + 0.03 * hash(seed * 2.7 + k),
        us = [0, 0.25, 0.5, 0.75, 1],
        stations = arch(at, a, 0.75, 1.2, length, us).map((s, i): Station => ({ ...s, w: 0.036 * Math.sin(Math.PI * Math.min(0.95, 0.12 + us[i] * 0.85)) + 0.004, v: 0.006, t: 0.03 * (1 - 0.3 * us[i]) + 0.009 }));
      blades.push(bladeGeometry(stations, (u, side) => between(L.fern, L.fern, 0, (side > 0 ? 1 : 0.78) * mix(0.82, 1.06, u))));
    }
    return merged(blades);
  }

  /* ---------------------------------------------------------------- */
  /* Coconut palm                                                      */
  /* ---------------------------------------------------------------- */
  /**
   * A coconut palm (PALM), its foot on the origin, leaning `lean` radians out along +x (whoever
   * places it turns that out to sea) and curving back up near the top, about `height` to the
   * crown's heart. The trunk is one smooth tapering tube, swollen at its foot, ringed by gentle
   * swellings toned a shade either way; at its top a green-brown boot the fronds spring from. The
   * fronds arch out round it on a seeded spiral, the upper ones rising, the middle ones level, the
   * lower ones hanging; each a closed keeled solid (bladeGeometry), cut deep into strap-like leaflets
   * (a notch, a shoulder and a tip each) that lean toward its tip and hang below the rachis, its green
   * yellowing toward the tip over a darker underside, softly shaded. A cluster of coconuts hangs under the boot.
   * `userData.crown` gives the crown's heart and its reach.
   */
  function coconutPalm({ height = 3.5, lean = 0.26, seed = 1 } = {}) {
    const g = new T.Group();
    g.name = 'tropic-palm';
    const h = (n: number) => hash(seed * 23.17 + n * 1.93),
      P = PALM,
      Hh = height,
      D = Hh * Math.tan(lean) * 0.85,
      // The trunk's middle line: out quickly, then straightening as it climbs.
      line = (y: number): [number, number] => {
        const t = Math.max(0, Math.min(1, y / Hh));
        return [D * (1.55 * t - 0.55 * t * t), 0];
      },
      k = Math.sqrt(Hh / 3.5),
      ringRows = Math.round(Hh / (P.ring / 3));
    const rows = [-0.05, 0, ...Array.from({ length: ringRows }, (_, i) => ((i + 1) * Hh) / ringRows)];
    const trunk = trunkTube(rows, 7, (y) => {
      const t = Math.max(0, y) / Hh,
        base = mix(0.12, 0.085, t) * k,
        foot = 0.09 * k * Math.max(0, 1 - Math.max(0, y) / 0.34) ** 2,
        swell = 1 + P.swell * (0.5 + 0.5 * Math.cos((2 * Math.PI * Math.max(0, y)) / P.ring));
      return (base + foot) * swell;
    }, line);
    painted(trunk, (p) => between(L.palmTrunk, L.palmTrunk, 0, (1 + P.tone * (2 * hash(Math.floor(Math.max(0, p.y) / P.ring) * 7.3 + seed) - 1)) * mix(0.94, 1.03, sstep(p.y, 0, 0.6))));
    const [hx] = line(Hh),
      heart = new T.Vector3(hx, Hh, 0),
      wood: T.BufferGeometry[] = [trunk],
      fronds: T.BufferGeometry[] = [];
    // The boot: a fat green-brown bud the fronds spring from, a little over the trunk's top.
    fronds.push(painted(new T.SphereGeometry(1, 12, 8).scale(0.15 * k, 0.2 * k, 0.15 * k).translate(heart.x, heart.y + 0.04, heart.z).deleteAttribute('uv') as T.BufferGeometry, (p) => between(L.palmBoot, L.palmFrond, sstep(p.y - heart.y, -0.1, 0.2), 0.92)));
    // The coconuts, under the boot on the lean's side.
    for (let n = 0; n < P.nuts; n++) {
      const a = (n / P.nuts) * Math.PI * 2 + h(5) * 2,
        r = 0.064 * k * (0.92 + 0.16 * h(10 + n));
      wood.push(painted(new T.SphereGeometry(1, 8, 6).scale(r, r * 1.08, r).translate(heart.x + 0.07 + Math.cos(a) * 0.08 * k, heart.y - 0.1 * k - 0.03 * h(20 + n), heart.z + Math.sin(a) * 0.08 * k).deleteAttribute('uv') as T.BufferGeometry, (p) => between(L.coconut, L.coconut, 0, 0.92 + 0.12 * sstep(p.y - heart.y, -0.2, -0.05))));
    }
    // The fronds: the stalk, then for each finger a notch, a shoulder and its tip, and the frond's tip.
    const N = P.fingers,
      pitchU = 0.88 / N,
      fingers = Array.from({ length: N }, (_, j) => {
        const u0 = 0.1 + pitchU * j;
        return [
          { u: u0 + 0.02, kind: 0 },
          { u: u0 + 0.3 * pitchU, kind: 1 },
          { u: u0 + 0.62 * pitchU, kind: 2 },
        ];
      }).flat(),
      marks = [{ u: 0, kind: -1 }, { u: 0.1, kind: -1 }, ...fingers, { u: 1, kind: 3 }],
      us = marks.map((m) => m.u);
    for (let f = 0; f < P.fronds; f++) {
      const tier = f % 3, // 0 upper, 1 middle, 2 lower
        a = h(30) * Math.PI * 2 + f * 2.39996,
        rise = [0.78, 0.32, -0.18][tier] + (h(40 + f) - 0.5) * 0.2,
        droop = [1.35, 1.25, 1.05][tier] + (h(50 + f) - 0.5) * 0.2,
        length = P.frond * Hh * [0.86, 1, 0.92][tier] * (0.94 + 0.12 * h(60 + f)),
        W = (P.width / 2) * (length / (P.frond * 3.5)),
        from = heart.clone().add(new T.Vector3(Math.cos(a) * 0.08 * k, 0.1 * k, Math.sin(a) * 0.08 * k)),
        frame = arch(from, a, rise, droop, length, us),
        tint = 0.95 + 0.1 * h(70 + f),
        pitch = pitchU * length,
        stations = frame.map((s, i): Station => {
          const { u, kind } = marks[i],
            body = W * Math.sin(Math.PI * Math.min(1, 0.04 + u)) ** 0.7,
            // The stalk, then notch, shoulder and tip by turns along the leaflets; the frond's tip closes it.
            w = kind === -1 ? 0.03 * k : kind === 0 ? body * P.notch : kind === 1 ? body * P.shoulder : kind === 2 ? body : 0,
            ahead = kind === 1 ? 0.12 * pitch : kind === 2 ? P.ahead * pitch : 0;
          // (The notches keep the shallow V; the leaflets hang below the rachis.)
          return { ...s, w, v: kind === 1 ? -P.hang.shoulder * w : kind === 2 ? -P.hang.tip * w : P.cup * w, t: Math.max(P.floor, P.keel * (1 - 0.5 * u)), ahead };
        });
      fronds.push(
        bladeGeometry(
          stations,
          (u, side, across) =>
            side > 0 ? between(L.palmFrond, L.palmTip, sstep(u, 0.55, 1), tint * mix(0.86, 1.02, sstep(u, 0, 0.35)) * (1 + 0.03 * across)) : between(L.palmUnder, L.palmFrond, 0.25 * u, tint * 0.9),
          P.soften,
        ),
      );
    }
    mesh(g, merged(wood), 'bark', 'tropic-palm-trunk', ['palmTrunk', 'coconut']);
    mesh(g, merged(fronds), 'foliage', 'tropic-palm-fronds', ['palmFrond', 'palmTip', 'palmUnder', 'palmBoot']);
    g.userData.crown = { x: heart.x, y: heart.y, z: heart.z, reach: P.frond * Hh };
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* Frangipani                                                        */
  /* ---------------------------------------------------------------- */
  /**
   * A frangipani (FRANGIPANI), its foot on the origin: a stout pale grey trunk forking twice into a
   * candelabra of thick blunt limbs (smooth tubes with round ends, curving up at their tips); at each
   * tip a rosette of paddle leaves radiating up and out, and on every other tip a cluster of
   * five-lobed flowers (cream, a yellow heart) on a small dome over the leaves. The flowers are a mesh
   * of their own that casts nothing. `userData.crown` gives its reach and top.
   */
  function frangipani({ seed = 1, height = FRANGIPANI.height } = {}) {
    const g = new T.Group();
    g.name = 'tropic-frangipani';
    const h = (n: number) => hash(seed * 11.71 + n * 2.13),
      F = FRANGIPANI,
      s = height / FRANGIPANI.height,
      spin = h(1) * Math.PI * 2,
      wood: T.BufferGeometry[] = [],
      leaves: T.BufferGeometry[] = [],
      flowers: T.BufferGeometry[] = [];
    const limb = (points: V3[], radii: number[]) =>
      wood.push(painted(tube(points, radii, 5, 8), (p) => between(L.frangiBark, L.frangiBark, 0, mix(0.9, 1.04, sstep(p.y, 0, 1.4 * s)) * (0.97 + 0.06 * noise3(p.x * 6 + seed, p.y * 6, p.z * 6)))));
    const fork: V3 = [0, F.fork * s, 0];
    limb([[0, -0.05, 0], [0.01, 0.25 * s, 0], [0, F.fork * s + 0.03, 0]], [F.trunk * 1.25, F.trunk, F.trunk * 0.85].map((r) => r * s));
    const tips: { at: T.Vector3; a: number }[] = [];
    for (let k = 0; k < 3; k++) {
      const a = spin + (k / 3) * Math.PI * 2 + (h(10 + k) - 0.5) * 0.4,
        out = (r: number, y: number): V3 => [Math.cos(a) * r, y, Math.sin(a) * r],
        mid = out(0.3 * s, (0.95 + 0.06 * (h(15 + k) - 0.5)) * s);
      limb([fork, out(0.12 * s, 0.75 * s), mid], [0.068 * s, 0.064 * s, 0.058 * s]);
      for (const side of [-1, 1]) {
        const b = a + side * (0.42 + 0.12 * h(20 + k * 2 + side)),
          r = (0.58 + 0.12 * h(30 + k * 2 + side)) * s,
          y = (1.45 + 0.18 * h(40 + k * 2 + side)) * s,
          tip: V3 = [Math.cos(b) * r, y, Math.sin(b) * r],
          elbow: V3 = [mix(mid[0], tip[0], 0.6), mix(mid[1], tip[1], 0.35), mix(mid[2], tip[2], 0.6)];
        limb([mid, elbow, tip], [0.056 * s, 0.052 * s, 0.05 * s]);
        tips.push({ at: new T.Vector3(...tip), a: b });
      }
    }
    tips.forEach((tip, k) => {
      // The rosette: paddle leaves round the tip, rising and spreading.
      for (let n = 0; n < F.leaves; n++) {
        const a = tip.a + (n / F.leaves) * Math.PI * 2 + (h(50 + k * 7 + n) - 0.5) * 0.5,
          length = F.leaf * s * (0.9 + 0.2 * h(60 + k * 7 + n)),
          us = [0, 0.25, 0.55, 0.82, 1],
          stations = arch(tip.at.clone().add(new T.Vector3(0, 0.03 * s, 0)), a, 0.5 + 0.28 * h(70 + k * 7 + n), 0.8, length, us).map((st, i): Station => {
            const u = us[i];
            return { ...st, w: 0.058 * s * Math.sin(Math.PI * Math.min(0.97, 0.06 + u * 0.94)) ** 0.6 + 0.006, v: 0.008, t: 0.036 * s * (1 - 0.3 * u) + 0.006 };
          });
        leaves.push(bladeGeometry(stations, (u, side) => (side > 0 ? between(L.frangiLeaf, L.frangiLit, sstep(u, 0.2, 1) * 0.6, 0.98 + 0.06 * hash(seed + k * 3.1 + n)) : between(L.frangiLeaf, L.frangiLeaf, 0, 0.8)), FRANGIPANI.soften));
      }
      if (k % 2) return;
      // The flowers: a small dome of them over the rosette's heart.
      const heart = tip.at.clone().add(new T.Vector3(0, 0.09 * s, 0));
      for (let n = 0; n < F.flowers; n++) {
        const a = (n / (F.flowers - 1)) * Math.PI * 2 + h(80 + k) * 6,
          centre = n === F.flowers - 1 ? heart.clone().add(new T.Vector3(0, 0.035 * s, 0)) : heart.clone().add(new T.Vector3(Math.cos(a) * 0.07 * s, 0, Math.sin(a) * 0.07 * s)),
          normal = n === F.flowers - 1 ? UP.clone() : new T.Vector3(Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55).normalize();
        flowers.push(flower(centre, normal, F.flower * s, seed * 13 + k * 5 + n));
      }
    });
    mesh(g, merged(wood), 'bark', 'tropic-frangipani-wood', ['frangiBark']);
    mesh(g, merged(leaves), 'foliage', 'tropic-frangipani-leaves', ['frangiLeaf', 'frangiLit']);
    mesh(g, merged(flowers), 'foliage', 'tropic-frangipani-flowers', ['flower', 'flowerHeart'], { shadow: false });
    let reach = 0;
    for (const t of tips) reach = Math.max(reach, Math.hypot(t.at.x, t.at.z) + F.leaf * s);
    g.userData.crown = { reach, top: Math.max(...tips.map((t) => t.at.y)) + 0.2 * s };
    return g;
  }
  /**
   * A frangipani flower: one chunky five-lobed star `size` across, its heart cupped down and its
   * petals' rounded tips turned up a little (a soft cup), its underside closing to the flower's tube
   * under the heart, so it stands 0.07 or more every way. Cream, its heart the yellow as vertex
   * colour (never a bead of its own), its underside a shade warmer and darker.
   */
  function flower(centre: T.Vector3, normal: T.Vector3, size: number, seed: number) {
    const R = size / 2,
      turn = new T.Quaternion().setFromUnitVectors(UP, normal),
      spin = hash(seed) * Math.PI * 2,
      pos: number[] = [],
      col: number[] = [],
      index: number[] = [],
      v = new T.Vector3();
    const push = (x: number, y: number, z: number, c: T.Color) => {
      v.set(x, y, z).applyQuaternion(turn).add(centre);
      pos.push(v.x, v.y, v.z);
      col.push(c.r, c.g, c.b);
      return pos.length / 3 - 1;
    };
    // The outline: for each petal its notch, a shoulder, its tip and a shoulder (the lobes lean round
    // a little, as frangipani petals overlap in a pinwheel).
    const outline: { x: number; z: number; y: number }[] = [];
    for (let k = 0; k < 5; k++) {
      const a = spin + (k / 5) * Math.PI * 2;
      for (const [da, r, y] of [[-0.5, 0.42, 0.004], [-0.22, 0.86, 0.012], [0.08, 1, 0.018], [0.36, 0.84, 0.012]] as const) {
        const b = a + da * ((Math.PI * 2) / 5);
        outline.push({ x: Math.cos(b) * r * R, z: Math.sin(b) * r * R, y: y * (R / 0.06) });
      }
    }
    const heart = (r: number) => between(L.flowerHeart, L.flower, sstep(r, 0.12 * R, 0.62 * R)),
      top = push(0, -0.012 * (R / 0.06), 0, heart(0)),
      rim = outline.map((p) => push(p.x, p.y, p.z, heart(Math.hypot(p.x, p.z)))),
      rimUnder = outline.map((p) => push(p.x, p.y, p.z, between(L.flower, L.flowerHeart, 0.15, 0.88))),
      foot = push(0, -0.058 * (R / 0.06), 0, between(L.flower, L.flowerHeart, 0.3, 0.84));
    for (let i = 0; i < rim.length; i++) {
      const j = (i + 1) % rim.length;
      index.push(top, rim[j], rim[i]);
      index.push(foot, rimUnder[i], rimUnder[j]);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    return geo;
  }

  /* ---------------------------------------------------------------- */
  /* Shrubs and fans                                                   */
  /* ---------------------------------------------------------------- */
  const SHRUB_LOOK: CrownLook = { tones: [L.shrub, L.shrub2], top: L.shrubLit, under: L.shrubUnder };
  /**
   * A leafy tropical shrub about `r` in radius and `height` tall, its foot on the origin: a mound of
   * `leaves` broad ovate leaves (closed blades, cupped and pointed) in three tiers (SHRUB) over a small
   * dark leafy heart (one clump of the crown kit's), a few short ones standing up in the middle, a ring
   * rising round them and a spreading ring arching out low over the lawn, so they overlap like shingles
   * and the heart only shows, dark, between them. Each leaf is a shade of its own, lighter toward its tip
   * and on its upper face, darker underneath: it reads as a bush of leaves, never as a ball or a
   * rosette of spikes. Planted shoulder to shoulder in beds, they mass into one leafy border.
   */
  function shrubGeometry({ r = 0.4, height = 0.6, seed = 1, leaves = 14 } = {}) {
    const h = (n: number) => hash(seed * 9.13 + n * 1.7),
      spin = h(1) * Math.PI * 2,
      core = r * 0.55,
      heart = crown([{ x: 0, y: height * 0.34, z: 0, r: core, sy: Math.min(1, (height * 0.36) / core), detail: 1, florets: 6, amp: 0.1, seed: seed * 5 + 1 }]);
    paintCrown(heart.built, SHRUB_LOOK, 0, height, new T.Vector3(0, height * 0.3, 0), seed, { floor: 0.5, valley: 0.82, gain: 0.8 });
    const parts: T.BufferGeometry[] = [mergeCrown(heart.built, 0)],
      us = [0, 0.4, 0.75, 1];
    let k = 0;
    SHRUB.tiers.forEach((tier, row) => {
      const n = Math.max(row ? 3 : 2, Math.round(leaves * tier.share));
      for (let i = 0; i < n; i++, k++) {
        const a = spin + ((i + 0.5 * row) / n) * Math.PI * 2 + (h(10 + k) - 0.5) * 0.5,
          length = Math.max(0.17, tier.length * r) * (0.9 + 0.2 * h(30 + k)),
          from = new T.Vector3(Math.cos(a) * tier.out * core, height * tier.from * (0.94 + 0.12 * h(20 + k)), Math.sin(a) * tier.out * core),
          tint = (0.92 + 0.14 * h(40 + k)) * (row === 0 ? 1.04 : 1),
          body = k % 2 ? L.shrub2 : L.shrub,
          // (A small leaf keeps the width of a 0.26 one, so none is under 0.07 across.)
          W = SHRUB.width * Math.max(length, 0.26),
          // (A small one's leaves rise more, so none lies under 0.07 deep.)
          stations = arch(from, a, tier.rise + 0.2 * (h(50 + k) - 0.5) + (r < 0.2 ? 0.45 : 0), tier.droop, length, us).map((st, j): Station => {
            const u = us[j],
              w = [0.12, 0.5, 0.4, 0][j] * W;
            return { ...st, w, v: SHRUB.cup * 2 * w, t: SHRUB.keel * (1 - 0.25 * u) };
          });
        parts.push(bladeGeometry(stations, (u, side) => (side > 0 ? between(body, L.shrubLit, sstep(u, 0.2, 1) * 0.5, tint) : between(L.shrubUnder, body, 0.45, tint * 0.92)), 0.35));
      }
    });
    return merged(parts);
  }
  /**
   * A bed of leafy shrubs (SHRUB_BED) along `line` (from its first point to its last; one point, a
   * single shrub) in g's frame, `width` across and about `height` tall over `ground` (its frame's ground
   * at x, z): a row of rounded lobes along it, each a little longer along the line than across it, each
   * standing a little different, the end ones smaller and rounder, blended into one leafy mass with the
   * crowns' florets (leafyMass) and sunk into the lawn: a border of massed leafy shrubs in the hedge
   * greens, lit on top and dark underneath, never a row of balls. Broad leaves arch out of it `leaves`
   * (toward a bearing from +x toward +z, within a spread either side), away from what it stands
   * against; none where it has no room (null).
   */
  function bedGeometry({ line, width, height, seed, ground, leaves: fan = { toward: 0, spread: Math.PI } }: { line: [number, number][]; width: number; height: number; seed: number; ground: (x: number, z: number) => number; leaves?: { toward: number; spread: number } | null }) {
    const h = (n: number) => hash(seed * 5.37 + n * 2.71),
      B = SHRUB_BED,
      [a, b] = [line[0], line[line.length - 1]],
      length = Math.hypot(b[0] - a[0], b[1] - a[1]),
      turn = Math.atan2(b[1] - a[1], b[0] - a[0]),
      // A wide bed is massed: its lobes closer, smaller across, staggered either side of its line and
      // of more varied heights, so it reads as shrubs two deep, never one long cushion.
      W = width >= B.wide.from ? B.wide : null,
      n = length > 0 ? Math.max(2, Math.round(length / ((W ? W.spacing : B.spacing) * width)) + 1) : 1,
      side: [number, number] = length > 0 ? [-(b[1] - a[1]) / length, (b[0] - a[0]) / length] : [0, 0],
      lobes: Lobe[] = [];
    let floor = Infinity,
      roof = -Infinity;
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0 : k / (n - 1),
        off = W ? (k % 2 ? 1 : -1) * W.stagger * (width / 2) * (0.7 + 0.6 * h(k + 90)) : 0,
        x = a[0] + (b[0] - a[0]) * t + (h(k) - 0.5) * 0.08 * width + side[0] * off,
        z = a[1] + (b[1] - a[1]) * t + (h(k + 20) - 0.5) * 0.08 * width + side[1] * off,
        end = n > 1 && (k === 0 || k === n - 1) ? 0.86 : 1,
        across = (width / 2) * end * (0.92 + 0.16 * h(k + 40)) * (W ? W.across : 1),
        tall = height * end * (0.44 + 0.2 * h(k + 60)),
        rise = W ? W.low + (1 - W.low) * h(k + 80) : 0.86 + 0.14 * h(k + 80),
        y = ground(x, z);
      floor = Math.min(floor, y);
      roof = Math.max(roof, y + height);
      lobes.push({ c: [x, y + height * end * rise - tall, z], r: [across * (n > 1 ? 1.06 : 1), tall, across], rot: [0, -turn, 0] });
    }
    const F = B.florets,
      // (A single shrub on a finer grid: it is small, and its outline is all of it.)
      mass = leafyMass(lobes, { fillet: W ? W.fillet : B.fillet, grid: n === 1 ? B.single : width >= B.wide.from ? B.wide.grid : B.grid, floor: floor - B.sink, round: B.round, pitch: F.pitch, reach: F.reach, amp: F.amp, level: F.level, soften: F.soften, look: { body: L.shrub, body2: L.shrub2, under: L.shrubUnder, lit: L.shrubLit }, y0: floor, y1: roof, seed }).geometry,
      // A few broad leaves arching out over its edges from under its top (the tropical shrubs' own
      // leaves, ovate with a rounded tip), so it reads as massed leafy shrubs, not a clipped hedge.
      leaves: T.BufferGeometry[] = [mass],
      count = fan ? Math.max(3, Math.round((length + width) / B.leaf.every)) : 0,
      us = [0, 0.35, 0.65, 0.88, 1];
    for (let k = 0; k < count; k++) {
      const t = count === 1 ? 0.5 : (k + 0.5) / count,
        x = a[0] + (b[0] - a[0]) * t,
        z = a[1] + (b[1] - a[1]) * t,
        heading = fan!.toward + (h(k + 100) - 0.5) * 2 * fan!.spread,
        from = new T.Vector3(x + Math.cos(heading) * width * 0.18, ground(x, z) + height * (0.62 + 0.12 * h(k + 120)), z + Math.sin(heading) * width * 0.18),
        long = B.leaf.length * (0.85 + 0.3 * h(k + 140)),
        W = B.leaf.width * long,
        tint = 0.96 + 0.1 * h(k + 160),
        body = k % 3 ? L.shrub2 : L.shrub,
        stations = arch(from, heading, 0.55 + 0.35 * h(k + 180), 0.95, long, us).map((st, j): Station => ({ ...st, w: [0.12, 0.5, 0.48, 0.28, 0][j] * W, v: 0.22 * [0.12, 0.5, 0.48, 0.28, 0][j] * W, t: SHRUB.keel * (1 - 0.25 * us[j]) }));
      leaves.push(bladeGeometry(stations, (u, sd) => (sd > 0 ? between(body, L.shrubLit, sstep(u, 0.2, 1) * 0.45, tint) : between(L.shrubUnder, body, 0.45, tint * 0.92)), 0.35));
    }
    return merged(leaves);
  }
  /**
   * A tall tropical fan (heliconia-like): `leaves` big paddle leaves on long stalks rising from a
   * small leafy shrub, fanned out in one plane (the fan's own x, y), each arching out at its top; a
   * cooler, darker green than the shrubs, lighter on its upper faces. `height` is about its top.
   */
  function fanGeometry({ height = 1.0, seed = 1, leaves = 5 } = {}) {
    const h = (n: number) => hash(seed * 4.31 + n * 2.9),
      parts: T.BufferGeometry[] = [shrubGeometry({ r: 0.24, height: 0.34, seed: seed + 50, leaves: 8 })];
    for (let k = 0; k < leaves; k++) {
      const spread = ((k + 0.5) / leaves - 0.5) * 1.5 + (h(10 + k) - 0.5) * 0.15,
        // Out in the fan's plane: its bearing +x or -x, rising steeply.
        a = spread >= 0 ? 0 : Math.PI,
        rise = Math.PI / 2 - Math.abs(spread) * 0.75,
        length = height * (0.95 + 0.12 * h(20 + k)) * (1 - 0.18 * Math.abs(spread)),
        us = [0, 0.2, 0.38, 0.56, 0.74, 0.9, 1],
        stations = arch(new T.Vector3(0, 0.1, (h(30 + k) - 0.5) * 0.06), a, rise, 0.55 + 0.2 * h(40 + k), length, us).map((s, i): Station => {
          const u = us[i],
            blade = sstep(u, 0.3, 0.42) * Math.sin(Math.PI * Math.min(1, Math.max(0, (u - 0.3) / 0.7))) ** 0.55;
          return { ...s, w: 0.036 + 0.05 * blade, v: 0.02 * blade, t: 0.04 };
        });
      parts.push(bladeGeometry(stations, (u, side) => (side > 0 ? between(L.fan, L.fanLit, sstep(u, 0.35, 1) * 0.7, 0.96 + 0.08 * h(50 + k)) : between(L.fan, L.fan, 0, 0.78)), 0.3));
    }
    return merged(parts);
  }

  /* ---------------------------------------------------------------- */
  /* A plaza of the garden's own                                       */
  /* ---------------------------------------------------------------- */
  /**
   * A round plaza (GARDEN_PLAZA), its middle on the origin, draped on `ground` (its own frame's ground
   * height at x, z) `lift` over it with a skirt into the lawn: its rings as flat strips of pale and grey
   * granite by turns (the outermost pale, with a flush kerb a shade lighter), the innermost grey ring
   * running in to the flush medallion at its middle (a dark disc and its paler ring). With `steps` (the podium's front edge as a z in the
   * plaza's frame, north of its middle, and the podium's top over the plaza's middle), two broad shallow
   * steps rise across the plaza's chord there, their nosings in the pale granite. The rings are paving
   * (a ground surface, flush, casting nothing), the medallion with them; the steps stone. Only for an island whose
   * land builds no court of its own: the tropic island's land does (lane site's court).
   */
  function plaza(ground: (x: number, z: number) => number, steps?: { front: number; top: number }) {
    const P = GARDEN_PLAZA,
      g = new T.Group();
    g.name = 'tropic-plaza';
    const sides = 72,
      // Ring edges from the medallion out, each with its colour (the innermost grey ring widened in to it).
      edges: { r: number; c: string; k: number }[] = [],
      pos: number[] = [],
      col: number[] = [],
      index: number[] = [],
      base = ground(0, 0) + P.lift;
    const M = P.medallion;
    edges.push({ r: 0, c: L.drum, k: 1 }, { r: M.r - M.ring, c: L.drumTop, k: 1 });
    let r = M.r;
    const radii = [...P.rings].reverse();
    radii.forEach((w, i) => {
      const pale = (radii.length - 1 - i) % 2 === 0;
      edges.push({ r, c: pale ? L.granitePale : L.graniteGrey, k: 1 });
      // (The innermost ring runs in to the medallion; its outer edge stays at `inner` and its width.)
      r = (i ? r : P.inner) + w;
    });
    edges.push({ r: P.radius - P.kerb, c: L.granitePale, k: 1.06 });
    const y = (x: number, z: number) => Math.max(ground(x, z) + P.lift, base - 0.03);
    // Each strip from one edge out to the next, its own colour; a skirt down from the outer edge.
    const strip = (r0: number, r1: number, colour: string, k: number) => {
      const c = tone.set(colour).multiplyScalar(k).clone();
      if (r0 === 0) {
        // (The medallion's disc: a fan about its middle.)
        pos.push(0, y(0, 0), 0);
        col.push(c.r, c.g, c.b);
        const mid = pos.length / 3 - 1;
        for (let s = 0; s <= sides; s++) {
          const a = (s / sides) * Math.PI * 2;
          pos.push(Math.cos(a) * r1, y(Math.cos(a) * r1, Math.sin(a) * r1), Math.sin(a) * r1);
          col.push(c.r, c.g, c.b);
          if (s) index.push(mid, pos.length / 3 - 1, pos.length / 3 - 2);
        }
        return;
      }
      for (let s = 0; s < sides; s++) {
        const a0 = (s / sides) * Math.PI * 2,
          a1 = ((s + 1) / sides) * Math.PI * 2,
          corner = (rr: number, a: number) => {
            const x = Math.cos(a) * rr,
              z = Math.sin(a) * rr;
            pos.push(x, y(x, z), z);
            col.push(c.r, c.g, c.b);
            return pos.length / 3 - 1;
          },
          i0 = corner(r0, a0),
          i1 = corner(r1, a0),
          i2 = corner(r1, a1),
          i3 = corner(r0, a1);
        index.push(i0, i2, i1, i0, i3, i2);
      }
    };
    for (let i = 0; i < edges.length; i++) strip(edges[i].r, i + 1 < edges.length ? edges[i + 1].r : P.radius, edges[i].c, edges[i].k);
    // The skirt: from the kerb's outer edge down into the lawn.
    const kerb = tone.set(L.granitePale).multiplyScalar(0.96).clone();
    for (let s = 0; s < sides; s++) {
      const a0 = (s / sides) * Math.PI * 2,
        a1 = ((s + 1) / sides) * Math.PI * 2,
        at = (a: number, down: number) => {
          const x = Math.cos(a) * P.radius,
            z = Math.sin(a) * P.radius;
          pos.push(x, y(x, z) - down, z);
          col.push(kerb.r, kerb.g, kerb.b);
          return pos.length / 3 - 1;
        },
        i0 = at(a0, 0),
        i1 = at(a0, P.skirt),
        i2 = at(a1, P.skirt),
        i3 = at(a1, 0);
      index.push(i0, i1, i2, i0, i2, i3);
    }
    const rings = new T.BufferGeometry();
    rings.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    rings.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    rings.setIndex(index);
    rings.computeVertexNormals();
    mesh(g, rings, 'paving', 'tropic-plaza-rings', ['granitePale', 'graniteGrey', 'drum', 'drumTop'], { shadow: false, ground: true });
    const stone: Part[] = [];
    if (steps) {
      const S = P.step;
      for (let k = 0; k < 2; k++) {
        // Each step spans the plaza's chord at its nosing, its top up one riser more.
        const z = steps.front + (2 - k) * S.tread - S.tread / 2,
          half = Math.sqrt(Math.max(0, P.radius ** 2 - (z + S.tread / 2) ** 2)) - 0.12,
          topY = steps.top - (1 - k) * S.rise,
          low = ground(0, z) - 0.06,
          tall = topY - low;
        stone.push({ geometry: chamfered(2 * half, tall, S.tread + 0.02), tint: ((p: T.Vector3, n: T.Vector3, c: T.Color) => void c.set(n.y > 0.5 && p.z > S.tread / 2 - S.nosing ? L.granitePale : p.y > tall / 2 - 0.005 ? L.graniteGrey : L.granitePale)) as Tint, matrix: placed(0, low + tall / 2, z) });
      }
    }
    if (stone.length) solidMesh(material, g, stone, 'stone', 'tropic-plaza-stone', ['granitePale', 'graniteGrey']);
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* Furniture and props                                               */
  /* ---------------------------------------------------------------- */
  /**
   * The chunky toy laptop (LAPTOP) as parts in its own frame: its base's bottom middle on the origin,
   * its user on its -z side (the keyboard's front edge toward -z, the hinge along its +z edge), the lid
   * opened LAPTOP.open from the base, leaning back past upright away from its user, so its screen faces
   * him and its back faces +z. Aluminium, the keyboard a shade darker field just proud of the base's
   * top, the screen's inner face dark and never lit. No logo. `keys` is the keyboard's middle on its top.
   */
  function laptopParts(): { parts: Part[]; keys: V3 } {
    const A = LAPTOP,
      hinge = placed(0, A.base, A.d / 2).multiply(new T.Matrix4().makeRotationX(A.open - Math.PI / 2)),
      lid = hinge.clone().multiply(placed(0, A.d / 2, -A.lid / 2)),
      parts: Part[] = [
        { geometry: new RoundedBoxGeometry(A.w, A.base, A.d, 1, 0.022), tint: L.aluminium, matrix: placed(0, A.base / 2, 0) },
        // The keyboard: a darker field just proud of the base's top, held in from its edges.
        { geometry: chamfered(A.w - 0.05, 0.07, A.d * 0.5), tint: L.keys, matrix: placed(0, A.base + 0.003 - 0.035, -0.012) },
        // The lid stands on the hinge, its screen to the user.
        { geometry: new RoundedBoxGeometry(A.w, A.d, A.lid, 1, 0.022), tint: L.aluminium, matrix: lid },
        { geometry: chamfered(A.w - 0.05, A.d - 0.05, 0.07), tint: L.screen, matrix: lid.clone().multiply(placed(0, 0, -A.lid / 2 - 0.003 + 0.035)) },
      ];
    return { parts, keys: [0, A.base + 0.003, -0.012] };
  }
  /** The laptop on its own, a group in its frame (laptopParts): one painted mesh. `userData.keys` gives the keyboard's middle. */
  function laptop() {
    const g = new T.Group();
    g.name = 'tropic-laptop';
    const { parts, keys } = laptopParts();
    solidMesh(material, g, parts, 'paint', 'tropic-laptop-body', ['aluminium', 'keys', 'screen']);
    g.userData.keys = keys;
    return g;
  }
  /**
   * The café set: the round bistro table (CAFE_TABLE: an oak top on a dark-bronze pedestal, two bistro
   * chairs with foot rings, no parasol) with a saucer standing on it in front of the -x chair, a little
   * to its sitter's right (CAFE_SAUCER), and a plate with a pastry across from it (CAFE_PLATE); the
   * china is batched with the frame. `userData.seats` (the sitter's root for each chair,
   * SITTER.setback behind its front edge, the -x chair first, then the +x one), `userData.saucer` (the
   * saucer's foot on the table) and `userData.plate` (the plate's) are in the set's frame, whose middle
   * is the table's.
   */
  function cafeSet() {
    const g = tableSet(material, chamfered, CAFE_TABLE),
      frame = g.getObjectByName(`${CAFE_TABLE.name}-frame`) as T.Mesh,
      back = CAFE_TABLE.radius + TEA.gap + SITTER.setback,
      // The sitter faces +x from the -x chair, so his right is the set's +z.
      at: V3 = [-back + CAFE_SAUCER.ahead, TEA.top, CAFE_SAUCER.right],
      dish = mergeGeometries(saucerPieces(CHINA).map((p) => p.applyMatrix4(placed(...at))))!,
      Pl = CAFE_PLATE,
      plateAt: V3 = [at[0] + Pl.ahead, TEA.top, at[2] - Pl.left],
      plate = fuse([
        { geometry: turned(turns([[0, 0], [Pl.r * 0.6, 0, 1], [Pl.r * 0.78, Pl.well * 0.7], [Pl.r, Pl.h - 0.006, 1], [Pl.r - 0.005, Pl.h, 1], [Pl.r * 0.72, Pl.well, 1], [0, Pl.well]]), 12), tint: ((p: T.Vector3, _n: T.Vector3, c: T.Color) => void c.set(p.y > Pl.h - 0.014 && Math.hypot(p.x, p.z) > Pl.r - 0.012 ? L.chinaBand : L.china)) as Tint, matrix: placed(...plateAt) },
        { geometry: blob(Pl.pastry, 10, 6), tint: ((p: T.Vector3, _n: T.Vector3, c: T.Color) => void c.set(L.pastry).multiplyScalar(0.86 + 0.18 * T.MathUtils.smoothstep(p.y, -Pl.pastry[1], Pl.pastry[1]))) as Tint, matrix: placed(plateAt[0], plateAt[1] + Pl.well + Pl.pastry[1] * 0.8, plateAt[2], 0, 0.6, 0) },
      ]);
    const old = frame.geometry;
    frame.geometry = mergeGeometries([old, dish, plate])!;
    old.dispose();
    dish.dispose();
    plate.dispose();
    frame.userData.looks = [...frame.userData.looks, 'china', 'chinaBand', 'pastry'];
    g.userData.seats = [-1, 1].map((s) => ({ x: s * back, z: 0, heading: (-s * Math.PI) / 2 }));
    g.userData.saucer = at;
    g.userData.plate = plateAt;
    return g;
  }
  /**
   * The veranda desk set, in its own frame: the desk (DESK) on the origin, its sitter on its -z side
   * facing +z (south, out over the lawn), his root DESK.near behind its near edge and DESK.across to the
   * +x of its middle, the bistro chair under him, the laptop on the desk square in front of him (its
   * screen to him, its lid's back to +z) and a small potted plant on the desk's far -x corner, the free
   * end to his right. The desk's oak top is a mesh of its own (an overhang); the chair's oak a second;
   * the bronze frames, the laptop and the plant's pot one painted mesh; the plant foliage.
   * `userData.seat` is where the sitter's root goes (x, z and heading) and `userData.keys` the
   * keyboard's middle, both in the set's frame.
   */
  function deskSet() {
    const g = new T.Group();
    g.name = 'tropic-desk';
    const D = DESK,
      top = TEA.top,
      under = top - D.slab,
      x = D.w / 2 - D.leg / 2 - 0.04,
      z = D.d / 2 - D.leg / 2 - 0.04,
      seat = { x: D.across, z: -D.d / 2 - D.near, heading: 0 },
      chairAt = placed(seat.x, 0, seat.z + SITTER.setback - TEA.chair.d / 2),
      lap = laptopParts(),
      lapAt = new T.Vector3(seat.x, top, -D.d / 2 + D.inset + LAPTOP.d / 2),
      frame: Part[] = [],
      timber: Part[] = [];
    solidMesh(material, g, [{ geometry: new RoundedBoxGeometry(D.w, D.slab, D.d, 1, 0.025), tint: toned(L.oak, 1.06), matrix: placed(0, top - D.slab / 2, 0) }], 'wood', 'tropic-desk-top', ['oak'], { band: false });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) frame.push({ geometry: chamfered(D.leg, under, D.leg), tint: L.bronze, matrix: placed(sx * x, under / 2, sz * z) });
    // The rail under the top: along the front (+z) and both ends, none on the sitter's side.
    frame.push({ geometry: chamfered(2 * x - D.leg, D.rail, D.rail), tint: L.bronze, matrix: placed(0, under - D.rail / 2, z) });
    for (const sx of [-1, 1]) frame.push({ geometry: chamfered(D.rail, D.rail, 2 * z - D.leg), tint: L.bronze, matrix: placed(sx * x, under - D.rail / 2, 0) });
    for (const part of chairParts(chamfered, chairAt, BISTRO_CHAIR)) (part.frame ? frame : timber).push(part);
    const lapMatrix = placed(lapAt.x, lapAt.y, lapAt.z);
    for (const part of lap.parts) frame.push({ ...part, matrix: lapMatrix.clone().multiply(part.matrix ?? new T.Matrix4()) });
    // The potted plant on the far -x corner: a pale stone pot (painted, so it batches with the frame
    // rather than as a small stone of its own) and one leafy clump.
    const Pp = D.plant,
      potAt = new T.Vector3(-D.w / 2 + 0.12, top, D.d / 2 - 0.12);
    frame.push({ geometry: turned(turns([[0, 0], [Pp.pot * 0.75, 0, 1], [Pp.pot, Pp.height - 0.012], [Pp.pot + 0.008, Pp.height, 1], [Pp.pot - 0.012, Pp.height, 1], [Pp.pot - 0.014, Pp.height - 0.02, 1], [0, Pp.height - 0.02]]), 14), tint: L.pot, matrix: placed(potAt.x, potAt.y, potAt.z) });
    solidMesh(material, g, frame, 'paint', 'tropic-desk-frame', ['bronze', 'aluminium', 'keys', 'screen', 'pot']);
    solidMesh(material, g, timber, 'wood', 'tropic-desk-timber', ['oak']);
    const leaves = shrubGeometry({ r: Pp.leaves, height: 0.17, seed: 77, leaves: 7 }).translate(potAt.x, potAt.y + Pp.height - 0.03, potAt.z);
    mesh(g, leaves, 'foliage', 'tropic-desk-plant', ['shrub', 'shrub2', 'shrubLit', 'shrubUnder'], { shadow: false });
    g.userData.seat = seat;
    g.userData.keys = [lapAt.x + lap.keys[0], lapAt.y + lap.keys[1], lapAt.z + lap.keys[2]];
    g.userData.laptop = lapAt.toArray();
    return g;
  }

  /**
   * The walks' timber in the island's frame (WALK_TIMBER), one oak mesh: the landing (tropicLanding:
   * its boards, the dark plinth under them, its steps down to the sand) and the seat's bench
   * (tropicBench, on the seat's paving, its lift over the lawn), each standing on `ground` (the
   * island's: the lawn, or the beach off it).
   */
  function walkTimber(ground: (x: number, z: number) => number) {
    const g = new T.Group();
    g.name = 'tropic-walk-timber';
    const D = tropicLanding(ground),
      L0 = WALK_TIMBER.landing,
      parts: Part[] = [],
      box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tint: Tint) => parts.push({ geometry: new T.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), tint, matrix: placed((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2) });
    // The deck's boards, across the axis, by turns a shade lighter and darker.
    const boards = Math.max(1, Math.round((D.z1 - D.z0) / L0.board));
    for (let k = 0; k < boards; k++) box(D.x0, D.x1, D.top - L0.slab, D.top, D.z0 + ((D.z1 - D.z0) * k) / boards, D.z0 + ((D.z1 - D.z0) * (k + 1)) / boards, toned(L.oak, L0.tones[k % 2]));
    // The plinth under them, in shadow, down into the lawn and the sand.
    let low = Infinity;
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) low = Math.min(low, ground(D.x0 + ((D.x1 - D.x0) * i) / 8, D.z0 + ((D.z1 - D.z0) * j) / 8));
    const plinth = { x0: D.x0 + L0.inset, x1: D.x1 - L0.inset, z0: D.z0 + L0.inset, z1: D.z1 - L0.inset, bottom: low - 0.05 };
    box(plinth.x0, plinth.x1, plinth.bottom, D.top - L0.slab + 0.001, plinth.z0, plinth.z1, toned(L.oak, L0.dark));
    // The steps: each tread a block down into the sand, its rise lit as the oak's side.
    const steps = D.steps.map((s) => {
      let under = Infinity;
      for (let i = 0; i <= 6; i++) for (const z of [s.z0, s.z1]) under = Math.min(under, ground(D.x0 + ((D.x1 - D.x0) * i) / 6, z));
      return { ...s, bottom: under - 0.05 };
    });
    steps.forEach((s, k) => box(D.x0, D.x1, s.bottom, s.top, s.z0, s.z1, toned(L.oak, L0.tones[(boards + k) % 2])));
    // The bench on the seat.
    const B = WALK_TIMBER.bench,
      at = tropicBench(),
      y = ground(at.x, at.z) + plan.TROPIC_PATHS.lift,
      m = new T.Matrix4().makeRotationY(at.facing).setPosition(at.x, y, at.z),
      on = (x: number, yy: number, z: number) => m.clone().multiply(placed(x, yy, z));
    parts.push({ geometry: chamfered(B.length, B.slab, B.depth), tint: toned(L.oak, 1.04), matrix: on(0, B.seat - B.slab / 2, 0) });
    for (const sx of [-1, 1]) {
      // Each leg from the seat's paving (its lowest point under the leg, sunk a hair) up to the slab.
      const lx = sx * (B.length / 2 - B.inset),
        c = Math.cos(at.facing),
        s = Math.sin(at.facing);
      let foot = Infinity;
      for (const [u, v] of [[-B.leg / 2, -B.depth / 2], [B.leg / 2, -B.depth / 2], [-B.leg / 2, B.depth / 2], [B.leg / 2, B.depth / 2]]) foot = Math.min(foot, ground(at.x + (lx + u) * c + v * s, at.z - (lx + u) * s + v * c) + plan.TROPIC_PATHS.lift - y - 0.01);
      parts.push({ geometry: chamfered(B.leg, B.seat - B.slab - foot, B.depth - 0.08), tint: toned(L.oak, 0.82), matrix: on(lx, (B.seat - B.slab + foot) / 2, 0) });
    }
    solidMesh(material, g, parts, 'wood', 'tropic-walk-oak', ['oak']);
    g.userData.landing = { ...D, steps, plinth, slab: L0.slab };
    g.userData.bench = at;
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* The garden, placed                                                */
  /* ---------------------------------------------------------------- */
  /**
   * The whole garden in g, in the island's frame (TROPIC_GARDEN's layout), each piece standing on
   * `site.ground` (the lawn's height at x, z): the two rain trees, the coconut palms on the beach's
   * edge leaning out to sea, the two frangipani, the shrub beds and fans along the building's foot,
   * the café set at SDE4's café anchor and the veranda desk set at its desk anchor, and a plaza only
   * when the site asks for one. A shrub or fan that would stand on SDE4's footprint (site.building:
   * its podium, steps and ramp) or within the walkers' clearance of a column is left out and named in
   * `skipped` (none is, round the stand-in). What it returns says where Filip's stations are (in the
   * island's frame): the desk's seat and keys, the café's seat and saucer (and the guest chair's seat),
   * and the call stretch the layout keeps clear.
   */
  /** One glass for the island's globes (the kit's lamp glass, frosted): the frame loop lights them with the town's lamps. */
  let globeGlass: T.MeshStandardMaterial | null = null;
  /**
   * The island's garden lamps (TROPIC_LAMP, GARDEN_LAMP's measures) at `spots` (each its foot, in g's
   * frame, on `ground`): the plinths, posts, caps and cups one stone mesh (casting; batched with the
   * garden's stone), the globes one mesh of the lamps' own glass, never batched, lit at night through
   * ctx.lamps as every lamp of the town is. Each plinth runs on 0.04 below its foot.
   */
  function tropicLamps(spots: { x: number; z: number }[], ground: (x: number, z: number) => number) {
    const G = GARDEN_LAMP,
      g = new T.Group();
    g.name = 'tropic-lamps';
    const stone: Part[] = [],
      globes: T.BufferGeometry[] = [],
      cup = turned(turns([[0, 0], [0.07, 0, 1], [0.07, 0.03], [0.05, 0.055], [0.05, 0.075], [0.095, 0.11], [0.095, G.cup, 1], [0, G.cup]]), TROPIC_LAMP.cup),
      centre = G.cap + G.cup + TROPIC_LAMP.globe - 0.03;
    for (const { x, z } of spots) {
      const y = ground(x, z);
      stone.push(
        { geometry: chamfered(TROPIC_LAMP.base, 0.12, TROPIC_LAMP.base), tint: L.lampStone, matrix: placed(x, y + 0.02, z) },
        { geometry: chamfered(G.shaft, G.cap - 0.14, G.shaft), tint: toned(L.lampPost, 0.93), matrix: placed(x, y + G.cap / 2, z) },
        { geometry: chamfered(TROPIC_LAMP.base, 0.08, TROPIC_LAMP.base), tint: L.lampBrass, matrix: placed(x, y + G.cap - 0.04, z) },
        { geometry: cup.clone(), tint: L.lampBrass, matrix: placed(x, y + G.cap, z) },
      );
      globes.push(new T.SphereGeometry(TROPIC_LAMP.globe, ...TROPIC_LAMP.segments).deleteAttribute('uv').translate(x, y + centre, z));
    }
    cup.dispose();
    solidMesh(material, g, stone, 'stone', 'tropic-lamp-posts', ['lampStone', 'lampPost', 'lampBrass']);
    if (!globeGlass) {
      globeGlass = kit.lampGlass();
      globeGlass.color.set(L.frost);
    }
    const glass = new T.Mesh(mergeGeometries(globes)!, globeGlass);
    globes.forEach((q) => q.dispose());
    glass.name = 'tropic-lamp-globes';
    glass.castShadow = false;
    glass.userData.noShadow = true;
    glass.userData.looks = ['frost'];
    g.add(glass);
    lamps.push(glass);
    return g;
  }

  function tropicGarden(g: T.Object3D, site: TropicSite) {
    const G = TROPIC_GARDEN,
      B = site.building ?? G.building,
      ground = site.ground,
      stand = (piece: T.Object3D, x: number, z: number, ry = 0, y = ground(x, z)) => {
        piece.position.set(x, y, z);
        piece.rotation.y = ry;
        g.add(piece);
        return piece;
      },
      // The bearing the island's file looks from, in a piece's frame turned ry (rotation.y).
      facing = (ry: number) => Math.PI / 2 - G.file + ry,
      skipped: string[] = [],
      clear = (name: string, x: number, z: number, r: number) => {
        const onFoot = B.footprint.some((f) => x + r > f.x0 && x - r < f.x1 && z + r > f.z0 && z - r < f.z1),
          byColumn = B.columns.some((c) => Math.hypot(x - c.x, z - c.z) < r + c.r + 0.27);
        if (onFoot || byColumn) skipped.push(`${name} at ${x}, ${z}`);
        return !onFoot && !byColumn;
      };
    for (const t of G.rainTrees) stand(rainTree({ size: t.size, seed: t.seed, facing: facing(t.ry) }), t.x, t.z, t.ry, ground(t.x, t.z) - 0.04);
    for (const p of G.palms) {
      const { x, z, toward } = palmAt(p);
      stand(coconutPalm({ height: p.height, lean: p.lean, seed: p.seed }), x, z, -toward, ground(x, z) - 0.05);
    }
    G.frangipani.forEach((f) => stand(frangipani({ seed: f.seed, height: f.height }), f.x, f.z, f.ry, ground(f.x, f.z) - 0.04));
    const shrubs = new T.Group();
    shrubs.name = 'tropic-shrubs';
    g.add(shrubs);
    const leafy: T.BufferGeometry[] = [];
    for (const bed of G.beds) if (bed.line.every(([x, z]) => clear('bed', x, z, bed.width / 2))) leafy.push(bedGeometry({ ...bed, ground }));
    for (const f of G.fans) if (clear('fan', f.x, f.z, 0.3)) leafy.push(fanGeometry({ height: f.height, seed: f.seed }).rotateY(-f.ry).translate(f.x, ground(f.x, f.z) - 0.03, f.z));
    mesh(shrubs, merged(leafy), 'foliage', 'tropic-shrubs-leaves', ['shrub', 'shrub2', 'shrubLit', 'shrubUnder', 'fan', 'fanLit']);
    // A plaza only where the land builds no court of its own.
    if (site.plaza) {
      const { x: px, z: pz, steps } = site.plaza;
      stand(plaza((x, z) => ground(px + x, pz + z) - ground(px, pz), steps && { front: steps.front - pz, top: steps.top - ground(px, pz) }), px, pz);
    }
    // The café: the table's middle on SDE4's café anchor, its sitter's chair (the table's -x one) facing
    // the anchor's heading.
    const C = site.cafe ?? B.cafe,
      cafeFloor = ground(C.x, C.z) + plan.TROPIC_PATHS.lift,
      cafe = stand(cafeSet(), C.x, C.z, C.heading - Math.PI / 2, cafeFloor);
    // The walks' timber: the landing at the bay walk's end and the seat's bench.
    g.add(walkTimber(ground));
    // The desk on the veranda: its middle on SDE4's desk anchor, on the deck.
    const anchor = site.desk ?? { ...B.desk, y: ground(B.desk.x, B.desk.z) + B.podium.top },
      desk = stand(deskSet(), anchor.x, anchor.z, anchor.heading, anchor.y);
    // The garden lamps beside the walks (town-tropic's tropicLampSpots, from the walks' plan), and
    // their pools on the land's lawn and paving as it was laid (site.land; town-tropic's
    // tropicLampPools): the lawn's one mesh in the garden's frame (flat ground, casting nothing, going
    // and coming with the island as the garden does), the paving's a wash on its own vertices.
    const spots = tropicLampSpots();
    g.add(tropicLamps(spots, ground));
    const P = plan.TROPIC,
      lawn = site.land?.getObjectByName('tropic-lawn'),
      paving = site.land?.getObjectByName('tropic-paths');
    if (lawn instanceof T.Mesh) {
      const pools = tropicLampPools(material, lawn, paving instanceof T.Mesh ? [paving] : [], spots.map((s) => [s.x + P.x, s.z + P.z]));
      mesh(g, pools.geometry.translate(-P.x, 0, -P.z), 'bark', 'tropic-lamp-pools', [], { shadow: false, ground: true }).userData.washed = pools.washed;
    }
    g.updateMatrixWorld(true);
    const world = (o: T.Object3D, [x, y, z]: V3) => new T.Vector3(x, y, z).applyMatrix4(new T.Matrix4().copy(g.matrixWorld).invert().multiply(o.matrixWorld)),
      seatOf = (o: T.Object3D, s: { x: number; z: number; heading: number }) => {
        const at = world(o, [s.x, 0, s.z]);
        return { x: at.x, y: at.y, z: at.z, heading: s.heading + o.rotation.y };
      };
    return {
      desk: { seat: seatOf(desk, desk.userData.seat), keys: world(desk, desk.userData.keys).toArray(), floor: anchor.y },
      cafe: { seat: seatOf(cafe, cafe.userData.seats[0]), guest: seatOf(cafe, cafe.userData.seats[1]), saucer: world(cafe, cafe.userData.saucer).toArray(), floor: cafeFloor },
      call: G.walks.call.map(([x, z]) => ({ x, y: ground(x, z), z })),
      lamps: spots,
      skipped,
    };
  }

  return { rainTree, coconutPalm, frangipani, shrubGeometry, bedGeometry, fanGeometry, plaza, laptop, cafeSet, deskSet, walkTimber, tropicGarden };
}
export type TropicGarden = ReturnType<typeof createTropicGarden>;

/** A rectangle in plan, in the island's frame. */
export type TropicRect = { x0: number; x1: number; z0: number; z1: number };
/**
 * What of SDE4 the garden lays itself out round, in the island's frame (tropicBuilding reads it off
 * SDE4's plan): its roof's plan, soffit and top (over the podium's top), its fin block (the west
 * screen), its glazed stack and the glazed front's plane, both its screens, its podium (its top over the terrace the land lays for it), its
 * steps and ramp, its veranda's deck and the deck's planters, its columns, and the anchors it hands
 * the garden: the desk's middle and the way its sitter faces, and the café table's middle and the way
 * its sitter faces. `footprint` is what stands on the ground (podium, steps, ramp).
 */
export type TropicBuilding = {
  roof: TropicRect & { soffit: number; top: number };
  fin: { x0: number; x1: number; proud: number };
  stack: TropicRect & { top: number };
  screens: TropicRect[];
  glass: number;
  podium: TropicRect & { top: number };
  footprint: TropicRect[];
  veranda: TropicRect;
  planters: TropicRect[];
  columns: { x: number; z: number; r: number }[];
  desk: { x: number; z: number; heading: number };
  cafe: { x: number; z: number; heading: number };
};
/**
 * What tropicGarden needs of the island, in the island's frame:
 * - `ground`: the ground's height at a point (town-tropic's tropicGroundAt, moved into the island's
 *   frame: the lawn, or the beach's shore profile off it, where the palms stand);
 * - `desk`: SDE4's desk anchor, the desk's middle on the veranda's deck (y the deck's top) and the
 *   heading its sitter faces (0 is +z, south);
 * - `cafe`: SDE4's café anchor, the café table's middle on the walks' café terrace and the heading its
 *   sitter faces (south-east, over the lawn to the bay); the set stands on the terrace's paving;
 * - `building`: SDE4's measures the garden keeps its beds off (TropicBuilding: its footprint and
 *   columns; the checks read the rest), TROPIC_GARDEN.building when not given;
 * - `plaza`: where the round plaza goes, on land that lays no paving of its own there (the tropic
 *   island's lays only its level terrace): its middle, and, where the building has no step of its own
 *   down to it, the podium's front edge (z) and top (y) where the plaza's two steps go up (SDE4 has
 *   its own step before its door, so the island passes none).
 */
export type TropicSite = {
  ground: (x: number, z: number) => number;
  desk?: { x: number; y: number; z: number; heading: number };
  cafe?: { x: number; z: number; heading: number };
  building?: TropicBuilding;
  plaza?: { x: number; z: number; steps?: { front: number; top: number } };
  /** The island's ground as tropicGround laid it (its lawn and paving meshes, by name), where the lamps' pools are laid. */
  land?: T.Object3D;
};

/**
 * SDE4 as the garden lays itself out round it (TropicBuilding), from its plan (town-sde4's sde4Plan,
 * in the island's frame): its parasol, fin block, glazed stack and podium (their heights over the
 * podium's top, the podium's over the lawn it assumes), what of it stands on the ground (podium, step,
 * ramp), its veranda's deck and planters, its columns, and its desk and café anchors.
 */
export function tropicBuilding(p: Sde4Plan): TropicBuilding {
  const rect = (r: TropicRect): TropicRect => ({ x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1 }),
    up = (y: number) => y - p.podium;
  return {
    roof: { ...rect(p.roof), soffit: up(p.roof.soffit), top: up(p.roof.top) },
    fin: { x0: p.fin.x0, x1: p.fin.x1, proud: p.fin.proud },
    stack: { ...rect(p.stack), top: up(p.stack.top) },
    screens: p.screens.map(rect),
    glass: p.glass,
    podium: { ...rect(p.podiumPlan), top: p.podium - p.lawn },
    footprint: [rect(p.podiumPlan), rect(p.steps), { x0: p.ramp.x0, x1: p.ramp.x1, z0: p.podiumPlan.z1, z1: p.ramp.foot.z }],
    veranda: rect(p.deck),
    planters: p.keepOut.filter((b) => b.name === 'veranda planter').map(rect),
    columns: p.columns.map((c) => ({ ...c })),
    desk: { x: p.desk.x, z: p.desk.z, heading: p.desk.heading },
    cafe: { x: p.cafe.x, z: p.cafe.z, heading: p.cafe.heading },
  };
}
/**
 * The site the island hands tropicGarden (TropicSite), in its frame: its ground (the lawn, or the
 * beach off it), SDE4's desk and café anchors and its measures (tropicBuilding, from what buildSde4
 * handed back: its plan), and the round plaza on the land's level terrace (plan.TROPIC_PLAZA), with no
 * steps of its own (SDE4 has its step down to it).
 */
export function tropicGardenSite(sde4: Sde4Plan, land?: T.Object3D): TropicSite {
  const P = plan.TROPIC;
  return {
    ground: (x, z) => tropicGroundAt(x + P.x, z + P.z),
    desk: { ...sde4.desk },
    cafe: { x: sde4.cafe.x, z: sde4.cafe.z, heading: sde4.cafe.heading },
    building: tropicBuilding(sde4),
    plaza: { x: plan.TROPIC_PLAZA.x, z: plan.TROPIC_PLAZA.z },
    land,
  };
}

/**
 * The garden's layout, in the island's frame (origin at its middle, +x east, +z south), round the land
 * (town-plan's tropic island: its coast, lawn, walks and plaza) and SDE4 (its plan):
 * - `file`: the island's file's bearing (the gate's), toward which each rain tree's hem draws into its bay;
 * - `building`: SDE4 as its plan stands it (tropicBuilding of sde4Plan: its roof's middle at (1.2, -1.1),
 *   its podium's top 0.12 over the land's terrace, the desk's middle at (3.9, -1.7) facing south, the
 *   café table's middle on the walks' café terrace (town-plan's TROPIC_PATHS.cafe: halfway between
 *   the terrace's west end and the plaza's rim, at its mid-depth, (-4.22, 2.75) on take b's plan) facing
 *   south-east);
 * - `walks`: Filip's day as tropic-figure lays it (FILIP_SITE): the call stretch's middle line and his
 *   pacing turn, and the points of his walks between his stations, which the planting keeps the
 *   walkers' clearance from;
 * - rain trees: the big one on the east lawn beside the veranda's open bay (photo 1's big trees stand to
 *   the building's right), its crown clear of the desk's lines of sight and its hem over the tree walk's
 *   seat (the seat and its bench in sight from the file); the small one on the west lawn north-west of
 *   the café terrace, its shade reaching the terrace's west end (the café at the rim of its shade), as
 *   near as keeps Filip in sight at the café from all four of the file's Rotate stops;
 * - palms on the sandy beach (two on the bay's crescent, one each side of the bay walk's axis framing
 *   its landing, two on the fuller south-east by the tail),
 *   each at a bearing from the island's middle and `shore` out on the beach's profile from the turf's
 *   edge (on the dry sand), leaning out to sea along the coast's own normal there, their crowns no more
 *   than about a unit past the waterline (a third of one as they stand), clear of every station's
 *   lines of sight (the bay's pair west of the call stretch's lines to the file's camera and to the
 *   south-west stop's, the tail's pair east of them);
 * - frangipani: two on the west lawn, one off the west screen's corner beside the café terrace and one
 *   on the knoll (the mound) to the south-west;
 * - beds of massed leafy shrubs (bedGeometry: a line, its width and height, and which way their broad
 *   leaves arch out, away from what they stand against) along SDE4's foot: a low bed backing the café
 *   terrace's north side where it passes the building's south-west corner (its leaves arching north,
 *   away from the paving), one inside the tree walk's arc along the podium's east face, along the back
 *   (one foundation bed the building's length) and the podium's west edge, single shrubs on the
 *   lawn's edge by the south-east and south-west beaches and at the big rain tree's foot, and one
 *   informal drift along the north lawn's rim (three massed parts), leaving the
 *   lawn between it and the building open; heliconia fans as accents in the beds. The forecourt is the building's front edge (no bed between
 *   it and the podium), and the south lawn between the bay walk and the tree walk stays one open panel,
 *   as photo 1's does.
 */
export const TROPIC_GARDEN = {
  file: Math.PI / 4 - 0.18,
  building: tropicBuilding(sde4Plan()),
  walks: {
    call: FILIP_SITE.call.ends,
    turn: FILIP_SITE.call.turn,
    ways: [FILIP_SITE.ways.out, FILIP_SITE.ways.across, FILIP_SITE.ways.home],
  },
  rainTrees: [
    { size: 'big' as RainTreeSize, x: 8.45, z: -1.2, ry: 1.1, seed: 3 },
    { size: 'small' as RainTreeSize, x: -8.4, z: 1.5, ry: 0.3, seed: 5 },
  ],
  palms: [
    { bearing: 1.0, shore: 1.0, height: 3.6, lean: 0.27, seed: 1 },
    { bearing: 0.35, shore: 1.0, height: 3.15, lean: 0.22, seed: 2 },
    { bearing: 1.32, shore: 1.1, height: 3.85, lean: 0.24, seed: 3 },
    { bearing: -0.42, shore: 1.0, height: 3.35, lean: 0.26, seed: 4 },
  ],
  frangipani: [
    { x: -4.75, z: 0.55, ry: 0.4, height: 2.05, seed: 1 },
    { x: -6.6, z: 5.4, ry: 1.7, height: 1.95, seed: 2 },
  ],
  beds: [
    // Behind the café terrace, where it passes the building's south-west corner and the west screen.
    { line: [[-5.05, 1.27], [-4.05, 1.25]], width: 0.6, height: 0.5, seed: 1, leaves: { toward: -Math.PI / 2, spread: 0.55 } },
    // Inside the tree walk's arc, along the podium's east face.
    { line: [[6.5, -0.55], [6.55, 0.95]], width: 0.62, height: 0.56, seed: 3, leaves: { toward: 0, spread: 0.6 } },
    // Along the back: one foundation bed the building's length, its fan inside it.
    { line: [[-3.05, -4.72], [2.35, -4.66]], width: 1.0, height: 0.62, seed: 4, leaves: { toward: -Math.PI / 2, spread: 0.7 } },
    // Along the fin block's west face.
    { line: [[-4.1, -3.15], [-4.05, -1.05]], width: 0.68, height: 0.6, seed: 6, leaves: { toward: Math.PI, spread: 0.7 } },
    // At the palms' and the big rain tree's feet.
    { line: [[8.65, 2.95]], width: 0.6, height: 0.5, seed: 7 },
    { line: [[-6.75, 6.45]], width: 0.64, height: 0.52, seed: 8 },
    { line: [[7.75, -0.6]], width: 0.68, height: 0.56, seed: 9 },
    // One drift along the north lawn's rim, about 1.2 in from the turf's lip and following it, in
    // three massed parts (two gaps of lawn), heights varied; a fan in its east part. The lawn between it and the back bed stays open.
    { line: [[-3.7, -7.85], [-1.95, -8.38]], width: 1.45, height: 0.8, seed: 10, leaves: { toward: -Math.PI / 2, spread: 0.6 } },
    { line: [[-0.55, -8.75], [0.75, -9.1]], width: 1.2, height: 0.58, seed: 11, leaves: { toward: -Math.PI / 2, spread: 0.6 } },
    { line: [[2.05, -9.3], [3.7, -9.22]], width: 1.45, height: 0.76, seed: 12, leaves: { toward: -Math.PI / 2, spread: 0.6 } },
  ] as { line: [number, number][]; width: number; height: number; seed: number; leaves?: { toward: number; spread: number } | null }[],
  fans: [
    { x: -4.2, z: 1.22, height: 0.9, ry: 0.1, seed: 1 },
    { x: 6.55, z: 0.25, height: 0.95, ry: -0.2, seed: 2 },
    { x: -0.95, z: -4.62, height: 1.05, ry: 0.05, seed: 3 },
    { x: 2.65, z: -9.05, height: 1.1, ry: 0.1, seed: 5 },
    { x: -4.1, z: -2.05, height: 1.0, ry: 1.5, seed: 4 },
  ],
};
/**
 * Where a palm of TROPIC_GARDEN stands in the island's frame (its bearing from the island's middle,
 * `shore` out on the beach's profile from the turf's edge: plan.tropicShorePoint) and `toward`, the
 * bearing it leans along (from +x toward +z): the coast's own outward normal there.
 */
export function palmAt(p: { bearing: number; shore: number }) {
  const [x, z] = plan.tropicShorePoint(p.bearing, p.shore),
    [nx, nz] = plan.tropicNormal(p.bearing);
  return { x: x - plan.TROPIC.x, z: z - plan.TROPIC.z, toward: Math.atan2(nz, nx) };
}
