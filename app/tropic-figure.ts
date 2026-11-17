import * as T from 'three';
import {
  armState,
  AT_EASE,
  atEase,
  CUP_AXIS,
  cupOnSaucer,
  easeArm,
  figureClock,
  figureHand,
  handsInLap,
  HIP,
  LAP,
  lean,
  leaned,
  mix,
  mixV,
  putAway,
  reach,
  rising,
  SAUCER_WELL,
  SEAT,
  seated,
  smooth,
  soleOf,
  STRIDE,
  THIGH_R,
  UPPER,
  walking,
  type ArmState,
  type FigureJoints,
  type Material,
  type V3,
} from './figure-rig';
import { angleDiff, blendDay, planDay, samplePolyline, smoothstep, TROPIC, TROPIC_PATHS, TROPIC_PLAZA, tropicFloor, tropicInland, walkProgress, type DayGait, type XZ } from './town-plan';
import type { TownContext } from './town-shared';
import { sde4Plan } from './town-sde4';
import { TEA } from './town-sky-garden';
import { createFilip, FILIP_FACE, FILIP_PHONE, FILIP_SCALE, type FilipJoints, type FilipProps } from './tropic-figure-look';

/*
 * Filip Biljecki's figure on the tropic island (the neighbour island off the south shore, with the
 * cartoon of NUS SDE4): his motion. His body is the shared rig (figure-rig.ts: Alison's joints,
 * pivots, hierarchy and pose maths) inside a root scaled uniformly by FILIP_SCALE, so every pose here
 * is in the rig's own units and her solves drive him unchanged. His day is the owner's three
 * activities and the walks between them: working on a laptop at a desk on the veranda; a phone call
 * outdoors, pacing on the lawn; coffee at an outdoor café table. Pause and reduced motion hold him as
 * they hold Alison (figure-rig's clock, his still poses).
 *
 * Everything here is in the island's own frame (its origin the island's middle on the sea's level, +x
 * east, +z south, y up), so the island's group (at its middle, unturned) takes his root as it is.
 * What the island's other builders own comes in from outside:
 * - his body: tropic-figure-look's createFilip (FilipBody: its root already scaled FILIP_SCALE, the
 *   rig's joints, his hand props, and his face, FILIP_FACE, where his phone and cup go);
 * - where his day happens (FilipSite: the floor he stands on, SDE4's desk and café anchors and the
 *   floors their sets stand on, the call stretch, his ways between them, the solids he keeps clear of
 *   and how far in from the turf's lip a point is): FILIP_SITE, laid out on the land (town-plan's
 *   tropic island: its lawn, walks and coast) and on SDE4's plan (town-sde4's sde4Plan);
 * - his furniture, which the garden builds to his measures (FILIP_DESK, FILIP_CAFE, FILIP_CHAIR and
 *   FILIP_RING: where his hands, his belly, his knees, his cup and his soles go; filipFurniture has it
 *   as solids for the checks). These are the furniture's one source: town-tropic-garden makes its
 *   DESK, LAPTOP, SITTER, CAFE_TABLE and CAFE_SAUCER from them, and they take the town's seat and
 *   table (town-sky-garden's TEA) for what they share with it; check-town holds the built seats, keys
 *   and saucer to where his day puts him.
 */

/* ------------------------------------------------------------------ */
/* Who he is, and how big                                              */
/* ------------------------------------------------------------------ */
/** He is the rig (Alison's) scaled by this all over at his root (tropic-figure-look's): 1.0 tall to his crown, where she is 0.93. */
export { FILIP_SCALE };
export type { FilipJoints, FilipProps };
const S = FILIP_SCALE;

/* ------------------------------------------------------------------ */
/* His furniture, about him (the town's units)                         */
/* ------------------------------------------------------------------ */
/**
 * The veranda desk as he sits at it (the town's units, from his root seated, +z the way he faces):
 * its `top` over the floor his chair stands on (the tea table's TEA.top, 0.665: the town's seat 0.44 and
 * 0.225), its `near` edge ahead of his root (his belly clears it by 0.01 leaning in to type), its
 * `width` and `depth` and its top's `thick`ness. Its middle is `across` to his right, so he sits at its
 * east end, with the laptop square in front of him and the free end of the desk (its potted plant)
 * to his right; his left side, where he gets up to, is clear of it by 0.2, and he gets up `leave`
 * back from it as well (so he walks off with his arms clear of its corner). Nothing of the desk stands
 * under its top within `knees` of its near edge (his knees go 0.03 under it seated), nor within `legs`
 * of his middle across (his knees are 0.14 out). The laptop (a chunky toy: base and lid each `base`
 * thick, `w` across and `d` deep, the lid open `open` radians from the base, no logo) stands square
 * in front of him, its near edge `inset` behind the desk's; his hands rest on its keys `keys` from
 * the laptop's near edge, and his right hand strokes its trackpad `pad` from it.
 */
export const FILIP_DESK = { top: TEA.top, near: 0.185, width: 0.9, depth: 0.5, thick: 0.07, across: 0.15, leave: 0.15, knees: 0.12, legs: 0.19, laptop: { inset: 0.015, w: 0.3, d: 0.21, base: 0.07, open: (105 * Math.PI) / 180 }, keys: 0.06, pad: 0.045 };
/**
 * The café table (a round bistro table on one pedestal; no parasol: the rain tree is its shade) as he
 * sits at it: its `top` over its floor, its `radius`, its edge `gap` ahead of his chair's seat (so its
 * middle is radius, gap and his chair's setback ahead of his root). The saucer his cup rests in stands
 * on its top (it is the table's: the garden batches it with the table) at `saucer`: across (x, to
 * his left) and ahead of his root (z), turned `turn` from the way he faces.
 */
export const FILIP_CAFE = { top: TEA.top, radius: 0.34, gap: TEA.gap, saucer: [-0.07, 0.29] as XZ, turn: 0 };
/**
 * His chairs (the desk's and the café's: the town's seat, oak on dark bronze): the seat's `height`
 * over their floor, its `width` and `depth`, the back's rail from `rail[0]` to `rail[1]` up, leaning
 * back by `rake`; his root seated is `setback` behind the seat's front edge (the tea table's sitter's,
 * scaled with him). Each has a foot ring at the height his soles hang at seated (FILIP_RING), so his
 * feet rest on it (the town's seat leaves a figure's soles 0.3 off the floor).
 */
export const FILIP_CHAIR = { height: SEAT, width: TEA.chair.w, depth: TEA.chair.d, rail: TEA.rail, rake: TEA.rake, setback: TEA.setback * S };
const knee0 = new T.Matrix4(),
  shoe0 = new T.Vector3();
/** The middle of leg k's shoe in the root's frame, as the leg and knee are posed (their matrices up to date). */
function shoeMiddle(j: FigureJoints, k: 0 | 1, out = shoe0) {
  return out.set(0, -0.135, 0.025).applyMatrix4(knee0.multiplyMatrices(j.legs[k].matrix, j.knees[k].matrix));
}
/**
 * Where his soles rest seated on his chairs' seat (FILIP_CHAIR.height), the town's units: their lowest
 * point's `height` over the chair's floor and the shoes' middle `out` ahead of his root. His chairs'
 * foot rings run there (design.md 3.3: his feet rest on them, within 0.005): the top of the ring's
 * front bar at `height`, under the shoes' middle.
 */
export const FILIP_RING = (() => {
  const g = () => new T.Group(),
    j: FigureJoints = { root: g(), body: g(), legs: [g(), g()], knees: [g(), g()], arms: [g(), g()], elbows: [g(), g()] };
  j.legs.forEach((leg, k) => {
    leg.position.set((k ? 1 : -1) * 0.065, HIP, 0);
    leg.add(j.knees[k]);
    j.knees[k].position.y = -0.14;
  });
  const lift = seated(j, FILIP_CHAIR.height / S),
    low = Math.min(soleOf(j.legs[0], j.knees[0]), soleOf(j.legs[1], j.knees[1]));
  return { height: (lift + low) * S, out: shoeMiddle(j, 0).z * S };
})();

/* ------------------------------------------------------------------ */
/* What stands where he goes (for the checks)                          */
/* ------------------------------------------------------------------ */
/**
 * Something solid that stands where he goes, in the island's frame: a box (`size` its half sizes
 * along its own axes) or an upright post (a round column about its own y axis, `size` its radius and
 * the heights it runs between), placed by `at` (its own frame into the island's). Not used to pose
 * him: the checks keep all of him clear of every one (filipSolidDistance), his furniture's
 * (filipFurniture) and the site's (FilipSite.solids).
 */
export type FilipSolid = { name: string; kind: 'box' | 'post'; at: T.Matrix4; size: V3 };
/** A box from x0 to x1, y0 to y1 and z0 to z1 (the island's frame, unturned). */
export const filipBox = (name: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): FilipSolid => ({
  name,
  kind: 'box',
  at: new T.Matrix4().makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
  size: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2],
});
/** An upright post `r` round at (x, z), from y0 up to y1 (the island's frame). */
export const filipPost = (name: string, x: number, z: number, r: number, y0: number, y1: number): FilipSolid => ({ name, kind: 'post', at: new T.Matrix4().makeTranslation(x, 0, z), size: [r, y0, y1] });
const solidInverse = new WeakMap<FilipSolid, T.Matrix4>(),
  solidAt = new T.Vector3();
/** How far the island's point (x, y, z) is outside a solid (negative inside it). */
export function filipSolidDistance(s: FilipSolid, x: number, y: number, z: number) {
  let inv = solidInverse.get(s);
  if (!inv) solidInverse.set(s, (inv = s.at.clone().invert()));
  const p = solidAt.set(x, y, z).applyMatrix4(inv),
    [a, b, c] = s.size;
  if (s.kind === 'post') {
    const r = Math.hypot(p.x, p.z) - a,
      h = Math.max(b - p.y, p.y - c);
    return Math.hypot(Math.max(r, 0), Math.max(h, 0)) + Math.min(Math.max(r, h), 0);
  }
  const qx = Math.abs(p.x) - a,
    qy = Math.abs(p.y) - b,
    qz = Math.abs(p.z) - c;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
}
/** A solid's reach in plan: the middle of its plan and the radius round it that holds it all. */
export function filipSolidReach(s: FilipSolid) {
  const [a, b, c] = s.size,
    m = s.at.elements;
  return s.kind === 'post' ? { x: m[12], z: m[14], r: a } : { x: m[12], z: m[14], r: Math.hypot(a, b, c) };
}

/* ------------------------------------------------------------------ */
/* Where his day happens (the island's frame)                          */
/* ------------------------------------------------------------------ */
/**
 * Where his day happens, in the island's own frame (the island's builders hand it over at the merge):
 * - `floor`: the floor drawn at (x, z), what his soles stand on (the lawn, its paths, the terrace, the
 *   podium and the veranda's deck, the ramp between them);
 * - `desk`: the veranda desk's middle (SDE4's desk anchor), the heading its sitter faces (south, over
 *   the lawn) and `y`, the deck the desk and its chair stand on (floor there if not given); his chair
 *   stands behind it (FILIP_DESK);
 * - `cafe`: the café table's middle (SDE4's café anchor), the heading its sitter faces (south-east,
 *   over the lawn to the bay and toward the island's file) and `y`, the ground the café set stands on (the garden
 *   stands the table and both its chairs at one height: floor at the table's middle if not given);
 *   his chair stands on the far side of it (FILIP_CAFE);
 * - `call`: the call stretch (its two ends: the garden's), along which he paces on the phone: along a
 *   line 2·`turn` to its left, round a U-curve `turn` in radius at its end and back along the stretch
 *   itself, and so on;
 * - `ways`: the points his walks go through, their ends left out: `out`, from his desk's side down the
 *   veranda's ramp onto the call stretch (its last points on the stretch's own line, heading down it,
 *   short of its far end); `across`, from the stretch's far end on its left line (his pacing ends there,
 *   heading back toward the plaza) to his café chair's side; `home`, from there back up the ramp to his
 *   desk's side;
 * - `solids`: what stands where he goes besides his furniture (SDE4's columns, their collars and pads,
 *   its stack and fin block, the veranda's planters with their planting, its entrance steps), and `inland`, how far (x, z) is in from the turf's lip (negative off the lawn):
 *   the checks keep all of him clear of the one and his ways a metre in from the other. Not used to
 *   pose him.
 */
export type FilipSite = {
  floor: (x: number, z: number) => number;
  desk: { x: number; z: number; heading: number; y?: number };
  cafe: { x: number; z: number; heading: number; y?: number };
  call: { ends: [XZ, XZ]; turn: number };
  ways: { out: XZ[]; across: XZ[]; home: XZ[] };
  solids: FilipSolid[];
  inland: (x: number, z: number) => number;
};
/** SDE4 as it stands on the island (town-sde4's sde4Plan): its podium, deck and ramp, its columns and what stands on its podium. */
const SDE4_PLAN = sde4Plan();
/**
 * The floor drawn at a point of the island's frame: SDE4's podium and deck (their top), its 1:6 ramp
 * from the podium's front edge down to the lawn, and off them the lawn with its walks (town-plan's
 * tropicFloor: each walk's lift over the lawn, eased over its edge).
 */
export function filipFloor(x: number, z: number) {
  const D = SDE4_PLAN,
    P = D.podiumPlan,
    R = D.ramp;
  if (x >= P.x0 && x <= P.x1 && z >= P.z0 && z <= P.z1) return D.podium;
  // (The ramp lands on the forecourt: at its foot the paving's surface, over the ramp's own toe, is the floor.)
  if (x >= R.x0 && x <= R.x1 && z > R.top.z && z < R.foot.z) return Math.max(R.top.y + ((R.foot.y - R.top.y) * (z - R.top.z)) / (R.foot.z - R.top.z), tropicFloor(x + TROPIC.x, z + TROPIC.z));
  return tropicFloor(x + TROPIC.x, z + TROPIC.z);
}
/**
 * What stands where he goes besides his furniture (FilipSite.solids), from SDE4's plan: its eight
 * columns with their collars and granite pads; what stands on its podium (keepOut: the ground floor's
 * glazed stack, the lobby, the fin block, the veranda's planters with the reach of their planting, the
 * court's step). (The plaza's medallion is flush: he walks over it.)
 */
export const FILIP_SOLIDS: FilipSolid[] = (() => {
  const D = SDE4_PLAN,
    out: FilipSolid[] = [];
  for (const c of D.columns)
    out.push(
      filipPost('column', c.x, c.z, c.r, 0, D.roof.soffit),
      filipPost('column collar', c.x, c.z, D.collar.r, 0, D.collar.top),
      filipBox('column pad', c.x - D.pad.half, c.x + D.pad.half, 0, D.pad.top, c.z - D.pad.half, c.z + D.pad.half),
    );
  for (const b of D.keepOut) out.push(filipBox(b.name, b.x0, b.x1, b.y0, b.y1, b.z0, b.z1));
  return out;
})();
/**
 * Where his day happens on the island (FilipSite): the floor (filipFloor); SDE4's desk anchor on its
 * veranda's deck (y the deck's top) and its café anchor on the walks' café terrace (y the terrace's
 * paving, where the garden stands the whole café set); the call stretch on the bay walk
 * (TROPIC_PATHS.stretch); his ways, worked out from the plan (TROPIC_PATHS and TROPIC_PLAZA, SDE4's
 * plan), never hand-placed: on the veranda down the desk's east side `VERANDA.clear` off its end (in
 * sight from the island's file: further east the big rain tree's crown hides him), through the gap
 * between the veranda's planters (SDE4's `way`, where no leaf leans in) and down its ramp; then along
 * the forecourt's line and, on one left arc (`CALL_ARC` round), onto the stretch itself heading down
 * it; from the call across the plaza (its medallion is flush: he walks over it) and along the café
 * room's north side to his café chair's side; and home the same way back. The solids (FILIP_SOLIDS);
 * and how far in from the turf's lip a point is (town-plan's tropicInland). His ways keep 0.27 (the
 * walkers' clearance) from every column, wall and piece of furniture, all of him clear of every solid
 * (his phone arm out to his side too), 0.24 or more in from the lawn and 1.2 or more inside the turf's lip.
 */
/** How far to the side of his chair he gets up to (FILIP_GAIT.slide, declared with his gait below). */
const SLIDE = 0.5;
/** His line down the veranda: `clear` east of the desk's east end (its top's 0.27 for walkers and a little). */
export const VERANDA = { clear: 0.35 };
/** The radius of his one left arc off the forecourt's line onto the call stretch. */
export const CALL_ARC = 0.75;
export const FILIP_SITE: FilipSite = (() => {
  const D = SDE4_PLAN,
    way = (D.way.x0 + D.way.x1) / 2,
    W = TROPIC_PATHS,
    Q = TROPIC_PLAZA,
    C = W.cafe,
    turn = 0.3,
    [, far] = W.stretch,
    // The stretch itself (east of the bay walk's axis: his first lane, down it from the far end).
    xb = far[0],
    // His line along the forecourt, between the ramp's foot and the forecourt's south edge.
    zw = (W.rampFoot + W.forecourt.z1) / 2,
    // His line down the veranda, east of the desk (the desk faces south: its width runs east and west).
    east = D.desk.x + FILIP_DESK.width / 2 + VERANDA.clear,
    /** Points `step` apart along a circle about c, radius r, from bearing a0 to a1. */
    circle = (c: XZ, r: number, a0: number, to: number, step = 0.05): XZ[] => {
      // (The shorter way round.)
      const a1 = a0 + angleDiff(to, a0),
        n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / step));
      return Array.from({ length: n + 1 }, (_, k): XZ => {
        const a = a0 + ((a1 - a0) * k) / n;
        return [c[0] + Math.sin(a) * r, c[1] + Math.cos(a) * r];
      });
    },
    // Off the forecourt's line heading west, one left arc onto the stretch heading down it (south).
    centre: XZ = [xb + CALL_ARC, zw + CALL_ARC],
    onto = circle(centre, CALL_ARC, Math.PI, -Math.PI / 2),
    // Across the plaza's west half, clear of the entrance's step, to the café room's north side: his
    // line there `C.z0 + 0.38`, between the podium's line and the table (his chair's side is on it).
    plazaWest: XZ = [Q.x - 1.25, Q.z + 0.3],
    room: XZ = [C.tableX + 0.55, C.z0 + 0.38];
  return {
    floor: filipFloor,
    desk: { x: D.desk.x, z: D.desk.z, heading: D.desk.heading, y: D.desk.y },
    cafe: { x: D.cafe.x, z: D.cafe.z, heading: D.cafe.heading, y: tropicFloor(D.cafe.x + TROPIC.x, D.cafe.z + TROPIC.z) },
    call: { ends: W.stretch, turn },
    ways: {
      // Down the veranda east of the desk, through the planters' gap and down the ramp onto the
      // forecourt, west along it and round one left arc onto the stretch, heading down it (the day
      // walks him on to its far end, where his pacing starts).
      out: [[east, D.desk.z - 0.15], [east, D.desk.z + 0.7], [way, -0.42], [way, 1.4], [way, zw], ...onto],
      // From the stretch's far end (heading north, his phone away) across the plaza's west half and
      // along the café room's north side (the day ends it at his chair's side).
      across: [plazaWest, room],
      // Back along the room's north side, across the plaza onto the forecourt's line, east along it to
      // the ramp, up it and the veranda east of the desk (the day ends it at his chair's side).
      home: [[room[0] + 0.07, room[1]], [Q.x - 1.25, Q.z + 0.15], [Q.x + 0.5, zw], [way, zw], [way, 1.4], [way, -0.4], [east - 0.02, D.desk.z + 0.7], [east - 0.08, D.desk.z - 0.2]],
    },
    solids: FILIP_SOLIDS,
    inland: tropicInland,
  };
})();

/* ------------------------------------------------------------------ */
/* His body and his props                                              */
/* ------------------------------------------------------------------ */
/**
 * A body for him, as tropic-figure-look's createFilip builds it: its root scaled FILIP_SCALE, the
 * rig's joints in it, and his hand props (his `phone`, its middle at its origin, long along y, its face
 * to +z; his coffee `cup`, Alison's teacup: its handle at its origin, its axis CUP_AXIS along +x; a
 * `saucer` the island drops, the café table carrying its own); and his `face` (FilipFace:
 * tropic-figure-look's FILIP_FACE), where the poses bring his phone and his cup.
 */
export type FilipBody = { root: T.Group; joints: FilipJoints; props: FilipProps; face: FilipFace };
/** His body as the island builds him: tropic-figure-look's createFilip, with his face (FILIP_FACE). */
export const filipBody = (material: Material): FilipBody => ({ ...createFilip(material), face: FILIP_FACE });
/** His phone, as built (tropic-figure-look's FILIP_PHONE, the rig's units): long, wide and thick. */
const PHONE = { long: FILIP_PHONE[1], wide: FILIP_PHONE[0], thick: FILIP_PHONE[2] };

/* ------------------------------------------------------------------ */
/* Poses                                                               */
/* ------------------------------------------------------------------ */
export const FILIP_POSES = ['stand', 'walk', 'sit', 'rise', 'desk', 'answer', 'call', 'coffee'] as const;
export type FilipPose = (typeof FILIP_POSES)[number];
/**
 * poseFilip's options (see there): `seat`, the seat over his floor (the rig's units); `amount`, a
 * walk's gait; `phone`, his phone at his ear (walking or standing), walking `answer` of the way from
 * his pocket (answering as he sets off); at the desk `keys` (his hands from
 * his lap to the keys), `back` (sitting back thinking, his hands on the desk's edge), `pad` (his right
 * hand on the trackpad), `tap` (typing, how much) and `sway`; on the phone `gesture` (his free hand
 * opening); at coffee `rest` (his left hand from his lap to the table's edge) and `look` (turned out
 * over the sea); and `cup`, where his cup rests when he does not hold it (the café table's saucer's
 * foot: [x, y over his floor, z, its turn], his frame, the rig's units).
 */
export type FilipPoseOptions = {
  seat?: number;
  amount?: number;
  phone?: boolean;
  keys?: number;
  back?: number;
  pad?: number;
  tap?: number;
  sway?: number;
  gesture?: number;
  rest?: number;
  look?: number;
  answer?: number;
  cup?: [number, number, number, number];
};
/** A height over the floor (seated on his chairs, the town's units) as a height in his seated root's frame (the rig's units). */
const seatedY = (over: number) => (over - FILIP_CHAIR.height) / S + HIP - THIGH_R;
/**
 * At the desk, in his seated frame (the rig's units): typing he leans in by `lean`, his shoulders
 * reaching `reach`; his hands' centres at the keys (`keys`, either side by `apart`), on the trackpad
 * (`pad`), and resting on the desk by its near edge either side of the laptop (`edge`), lifted
 * `lift` as they go out past the laptop's side (and `over` as they come onto the keys from his lap and
 * leave them); thinking he sits back to `back` (design.md's -0.04
 * leaves the desk out of his reach: his hands would leave it); the elbows bending the ways in `bend`.
 * Between his lap and the keys his hands rise over the share `rise` of the way and come forward over
 * `ahead` of it, bowed out `wide` to his sides halfway, and he leans in only over `leanIn` of it: so
 * they come up outside his collar's points, which his leaning in would bring forward into their way,
 * and then over the laptop's front edge (0.02 or more clear of both).
 */
const DESK = (() => {
  const D = FILIP_DESK,
    top = seatedY(D.top),
    keysY = top + D.laptop.base / S,
    near = (D.near + D.laptop.inset) / S;
  return {
    lean: 0.15,
    reach: [0.012, 0, 0.04] as V3,
    back: 0.04,
    apart: 0.06,
    keys: [0, keysY + 0.047, near + D.keys / S] as V3,
    pad: [-0.03, keysY + 0.05, near + D.pad / S] as V3,
    edge: [0.2, top + 0.048, D.near / S + 0.04] as V3,
    stroke: 0.012,
    lift: 0.02,
    over: 0.02,
    wide: 0.06,
    leanIn: [0.5, 1] as [number, number],
    rise: [0, 0.6] as [number, number],
    ahead: [0.25, 1] as [number, number],
    bend: (k: 0 | 1): V3 => [(k ? 1 : -1) * 0.9, 0.25, -0.4],
    padBend: [-0.9, 0.35, -0.3] as V3,
  };
})();
/**
 * At coffee: leaning on the table (`lounge`, his left forearm on its edge: his arms do not reach it
 * sitting up), leaning in `lean` to reach his cup; the cup's tilt as he drinks (its middle at his lips:
 * FilipFaceTargets); his left hand's place on the table's edge (`edge`: across, over the table's top,
 * ahead).
 */
const COFFEE = { lean: 0.2, lounge: 0.1, reach: [0.012, 0, 0.035] as V3, sit: -0.03, tilt: 0.35, edge: [0.11, 0.056, (FILIP_CHAIR.setback + FILIP_CAFE.gap) / S + 0.03] as V3 };
/**
 * A drink's moments, as shares of its phase: his right hand to the cup's handle (`grip`), the cup up
 * to his lips (`up`), tipped and held (`sip`: tipping by `tip`, back by `untip`), down onto its saucer
 * (`down`) and his hand back to his lap. design.md 3.4's 0.6, 0.9, 1.6, 0.9 and 0.6 seconds of 4.6.
 */
const DRINK = { grip: 0.6 / 4.6, up: 1.5 / 4.6, tip: 1.8 / 4.6, untip: 2.8 / 4.6, down: 3.1 / 4.6, back: 4.0 / 4.6 };
/**
 * His phone at his ear, in his frame (the rig's units, his root unscaled), as a phone is held: its
 * inner face flat to the side of his head `gap` off the outside of his right ear (the outermost point
 * of his head there: 0.011 in the town's units), its long side tipped `tilt` from upright about the
 * across axis so its upper end lies over the ear (the ear's middle `over` above the phone's middle
 * along it) and its lower end leans forward and down toward the corner of his mouth; his right hand
 * holding its lower half (the hand's centre `grip` down the phone from its middle and `side` out from
 * it, so the mitten wraps the phone's back rather than pressing on his cheek), the elbow out, down and
 * forward (`bend`), and the wrist turning the phone from the forearm's line into its own
 * (filipFaceTargets solves the hand's place and the wrist's turn on his own face; design.md 3.4).
 */
const EAR = { gap: 0.011 / S, tilt: (38 * Math.PI) / 180, over: 0.022, grip: 0.034, side: 0.012, bend: [-0.5, -0.6, 0.9] as V3 };
/** His cup's middle as he drinks, from his mouth (FilipFace.mouth): the cup's rim stops 0.02 short of his lips. */
const LIPS: V3 = [0, -0.019, 0.081];
/**
 * His phone's pocket, and taking the phone out of it: his shirt's breast pocket on his right, the phone
 * in it wholly inside his chest (`at`, the phone's middle in his body's frame, upright, its faces to the
 * front), so it shows nowhere while it is there (the rig's arms reach no lower than its hips: a trouser
 * pocket is out of their reach). Answering, his right hand comes up to the pocket by `reach` (its
 * centre `hand`, the elbow out and down, `bend`); from `show` the phone is his (it shows, wholly inside
 * his chest); by `taken` hand and phone have come out and up before his shoulder (`glance`: the hand's
 * centre, within his short arm's reach, and the elbow's bend; the phone's screen tipped `tilt` up toward
 * his eyes, its middle `up` along it from the hand's centre): forward first (over `forward` of the
 * way), rising only from `rise` of it, so phone and hand come out in front of his collar's point (0.03
 * or more clear of it, his shirt buttoned up) before they come up past it; and he looks at it until
 * `look`; then hand and phone go up and out by `via` to his ear (EAR). Putting it away is the same
 * backwards.
 */
const POCKET = {
  at: [-0.085, 0.45, 0.03] as V3,
  hand: [-0.105, 0.505, 0.15] as V3,
  forward: 0.6,
  rise: 0.35,
  bend: [-0.85, -0.45, 0.2] as V3,
  reach: 0.3,
  show: 0.3,
  taken: 0.6,
  look: 0.66,
  glance: { hand: [-0.12, 0.6, 0.165] as V3, bend: [-0.75, -0.65, 0.1] as V3, tilt: 0.93, up: 0.07 },
  via: [-0.18, 0.67, 0.13] as V3,
};
/** His free hand opening as he talks: its centre before him, the elbow out and down. */
const GESTURE = { hand: [0.13, 0.47, 0.18] as V3, bend: [0.85, -0.45, -0.25] as V3 };
/**
 * Where things are on his face, in his own frame (his root unscaled, the rig's units), for the poses
 * that bring something to it: each ear's middle (his right ear's first) and his mouth (where one would
 * be: none is drawn): tropic-figure-look's FILIP_FACE carries these (with more) for his head.
 */
export type FilipFace = { ears: [V3, V3]; mouth: V3 };
/**
 * Where his poses bring things to his face (his frame, the rig's units): his right hand's centre with
 * his phone at his ear (`ear`) and the wrist's turn there (`wrist`: the phone's turn in the forearm's
 * frame, as a quaternion), and his cup's middle at his lips.
 */
export type FilipFaceTargets = { ear: V3; wrist: [number, number, number, number]; lips: V3 };
const elbowFrame = new T.Matrix4(),
  pocketAt = new T.Vector3(),
  pocketTurn = new T.Quaternion(),
  gripTurn = new T.Quaternion(),
  handAt = new T.Vector3(),
  one = new T.Vector3(),
  // His phone as he holds it, its +y down his forearm toward his elbow (his grip's sense: a slab reads
  // the same either way up, and a turn of the other sense would swing it out through his side): in his
  // pocket upright, its face (+z) to his chest; before him as he looks at it, its long side tipped `tilt`
  // from upright toward the front, its face up and back toward his eyes.
  pocketGrip = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI),
  wristTurn = new T.Quaternion(),
  glanceTurn = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI + POCKET.glance.tilt),
  // (cupOnSaucer places a saucer with the cup; the café table carries its own, so this one is never seen.)
  tableSaucer = new T.Object3D();
/** A bare rig (the rig's pivots, no meshes), for solving a pose's targets. */
function bareRig(): FigureJoints {
  const g = () => new T.Group(),
    j: FigureJoints = { root: g(), body: g(), legs: [g(), g()], knees: [g(), g()], arms: [g(), g()], elbows: [g(), g()] };
  j.root.add(j.body);
  for (const k of [0, 1] as const) {
    j.legs[k].position.set((k ? 1 : -1) * 0.065, HIP, 0);
    j.legs[k].add(j.knees[k]);
    j.knees[k].position.y = -0.14;
    j.arms[k].add(j.elbows[k]);
    j.elbows[k].position.y = -UPPER;
    j.root.add(j.legs[k], j.arms[k]);
  }
  atEase(j);
  return j;
}
/**
 * His phone in his right hand as he holds it to his ear, the arm as posed (in the root's frame): its
 * turn the forearm's (the rig's elbow frame: its long side along the forearm, its flat faces across its
 * fold) turned by the wrist (`wrist`, FilipFaceTargets), and its middle EAR.grip up it from the hand's
 * centre and EAR.side in toward it. Sets `phone`'s place and turn.
 */
function gripAt(j: FigureJoints, wrist: T.Quaternion, phone: T.Object3D) {
  j.arms[0].updateMatrix();
  j.elbows[0].updateMatrix();
  elbowFrame.multiplyMatrices(j.arms[0].matrix, j.elbows[0].matrix);
  phone.quaternion.setFromRotationMatrix(elbowFrame).multiply(wrist);
  figureHand(j, 0, phone.position).add(one.set(0, -EAR.grip, EAR.side).applyQuaternion(phone.quaternion));
}
/**
 * Where his poses bring things to his face, for a body (its face, FilipBody.face): his phone at his
 * right ear as EAR has it (its inner face EAR.gap off the outermost point of his head by the ear, the
 * ear or the hair over it, whichever stands further out; its long side tipped EAR.tilt toward his
 * mouth), the hand's centre that holds it there and the wrist's turn from the forearm into the phone's,
 * solved on a bare rig; his cup's middle LIPS from his mouth.
 */
export function filipFaceTargets(body: FilipBody): FilipFaceTargets {
  const face = body.face,
    [ex, ey, ez] = face.ears[0],
    v = new T.Vector3();
  let out = ex;
  body.joints.body.updateMatrixWorld(true);
  const toBody = body.joints.body.matrixWorld.clone().invert();
  body.joints.body.traverse((m) => {
    if (!(m instanceof T.Mesh)) return;
    const q = m.geometry.getAttribute('position'),
      into = toBody.clone().multiply(m.matrixWorld);
    for (let i = 0; i < q.count; i++) {
      v.fromBufferAttribute(q, i).applyMatrix4(into);
      if (Math.abs(v.y - ey) < 0.03 && Math.abs(v.z - ez) < 0.035 && v.x < out) out = v.x;
    }
  });
  // The phone's turn: its face (+z) to the side of his head, its +y (toward his hand) down the tipped
  // long side, forward toward his mouth; and its middle, the ear's middle EAR.over up that long side.
  const down = new T.Vector3(0, -Math.cos(EAR.tilt), Math.sin(EAR.tilt)),
    across = new T.Vector3(1, 0, 0),
    turn = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(new T.Vector3().crossVectors(down, across), down, across)),
    phone = new T.Vector3(out - EAR.gap - PHONE.thick / 2, ey, ez).addScaledVector(down, EAR.over),
    // The hand's centre on its lower half, out from it; the arm to it; the wrist's turn the rest.
    hand = phone.clone().add(new T.Vector3(0, EAR.grip, -EAR.side).applyQuaternion(turn)),
    j = bareRig();
  reach(j, 0, [hand.x, hand.y, hand.z], EAR.bend);
  j.arms[0].updateMatrix();
  j.elbows[0].updateMatrix();
  const forearm = new T.Quaternion().setFromRotationMatrix(elbowFrame.multiplyMatrices(j.arms[0].matrix, j.elbows[0].matrix)),
    wrist = forearm.invert().multiply(turn);
  return { ear: [hand.x, hand.y, hand.z], wrist: [wrist.x, wrist.y, wrist.z, wrist.w], lips: [face.mouth[0] + LIPS[0], face.mouth[1] + LIPS[1], face.mouth[2] + LIPS[2]] };
}
/**
 * His phone in his right hand as posed now: `glance` of the way from his grip at the ear (EAR.grip,
 * along his forearm) to held up before his chest to look at (POCKET.glance), and `taken` of the way out
 * of his breast pocket (POCKET.at, carried by his body as it leans) into his hand.
 */
function phoneInHand(j: FilipJoints, props: FilipProps, face: FilipFaceTargets, taken = 1, glance = 0) {
  const phone = props.phone,
    G = POCKET.glance;
  phone.visible = true;
  gripAt(j, wristTurn.set(...face.wrist), phone);
  if (glance > 0) {
    // Held up to look at: its middle `up` along its tipped long side from the hand's centre.
    const held = figureHand(j, 0, handAt).add(one.set(0, Math.cos(G.tilt), Math.sin(G.tilt)).multiplyScalar(G.up));
    phone.position.lerp(held, glance);
    gripTurn.copy(phone.quaternion);
    phone.quaternion.slerpQuaternions(gripTurn, glanceTurn, glance);
  }
  if (taken >= 1) return;
  j.body.updateMatrix();
  pocketAt.set(...POCKET.at).applyMatrix4(j.body.matrix);
  pocketTurn.copy(j.body.quaternion).multiply(pocketGrip);
  // (Slerping into its own quaternion would read the pocket's turn back: three's slerpQuaternions copies the first.)
  gripTurn.copy(phone.quaternion);
  phone.position.set(mix(pocketAt.x, phone.position.x, taken), mix(pocketAt.y, phone.position.y, smooth(taken, POCKET.rise, 1)), mix(pocketAt.z, phone.position.z, smooth(taken, 0, POCKET.forward)));
  phone.quaternion.slerpQuaternions(pocketTurn, gripTurn, taken);
}
/**
 * Turn his body by `yaw` about the upright through his root, after lean(): his torso and head and his
 * shoulders with them (his legs stay as they are). A seated look out over the sea.
 */
function twist(j: FilipJoints, yaw: number) {
  if (!yaw) return;
  const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw);
  j.body.position.applyQuaternion(q);
  j.body.quaternion.premultiply(q);
  for (const arm of j.arms) arm.position.applyQuaternion(q);
}
/**
 * How much lower his cup sits in the café table's saucer than in a saucer of his own: the saucer is
 * the table's, at the town's size, its well SAUCER_WELL up from its foot, where figure-rig's cupOnSaucer
 * takes a saucer at its holder's size (his root's scale: 1.08).
 */
const WELL = SAUCER_WELL * (1 - 1 / S);
/** His cup resting in the café table's saucer, its foot at `at` (his frame), turned `ry` (figure-rig's cupOnSaucer, the table's own saucer). */
function cupDown(props: FilipProps, at: V3, ry: number) {
  cupOnSaucer({ cup: props.cup, saucer: tableSaucer }, [at[0], at[1] - WELL, at[2]], ry);
}
/**
 * His cup back in the café table's saucer (its foot at `cup`: across and ahead of him in his frame and
 * its turn, as his day gives them) with his root `y` up (the island's), the saucer's foot `saucerY` up:
 * where his root stands on his soles rather than at his lift over his floor (walking up the ramp, or
 * on a path's edge), so his cup stays exactly in its saucer however he stands.
 */
export function cupAt(props: FilipProps, cup: [number, number, number, number], y: number, saucerY: number) {
  cupDown(props, [cup[0], (saucerY - y) / S, cup[2]], cup[3]);
}
/**
 * Pose him for `name` at `phase`, from nothing else (as poseAlison does: every joint and prop any pose
 * moves is set on each call). Returns `lift`, his root's height over his floor in the rig's units: on
 * the island his root goes at the floor plus lift times FILIP_SCALE (seated), or with his lower sole
 * on the floor drawn under it (standing and walking: filipClock).
 * - 'stand': at ease. 'sit': seated, hands in his lap. 'rise': from 'sit' (0) to 'stand' (1), whoever
 *   places him sliding his root out to his seat's side (the rig's rising).
 * - 'walk': the residents' walk, a stride a phase (`amount` its gait); `phone`, his phone at his ear,
 *   his free hand opening by `gesture` from its swing.
 * - 'desk': seated at the desk (FILIP_DESK), `phase` the seconds of his work (the typing's pace runs on
 *   it): his hands from his lap to the keys (`keys`), typing (`tap` of the way: each hand bobbing 0.006
 *   at 2.5 a second, out of step), thinking (`back`: leaned back, his hands on the desk's edge), or his
 *   right hand on the trackpad (`pad`, stroking), his body swaying `sway`. All at 0 but `keys` at 1:
 *   his hands at rest on the keys, still.
 * - 'answer': standing, his phone from his pocket (0, his hand at his side, the phone away) to his ear
 *   (1, the 'call' pose); back from 1 to 0 he puts it away.
 * - 'call': standing, his phone at his ear, his free hand opening before him by `gesture`.
 * - 'coffee': seated at the café table, `phase` through one drink (0 and 1: his hand in his lap, the
 *   cup in its saucer at `cup`), his left hand on the table's edge by `rest`, turned out by `look`.
 * `cup`, wherever he is, shows his cup in the café table's saucer where it stands, unless he holds it
 * (`resting`, in the answer, says so: whoever stands him with his root other than his lift over his
 * floor puts it back in the saucer by cupAt). A saucer his body brings stays hidden (the table has
 * its own).
 */
export function poseFilip(j: FilipJoints, props: FilipProps, name: FilipPose, phase: number, opts: FilipPoseOptions, face: FilipFaceTargets) {
  const u = ((phase % 1) + 1) % 1,
    p = T.MathUtils.clamp(phase, 0, 1),
    unit = (v: number | undefined, d = 0) => T.MathUtils.clamp(v ?? d, 0, 1);
  atEase(j);
  putAway(props as Record<string, T.Object3D>);
  let lift = 0,
    holding = false;
  if (name === 'sit' || name === 'desk' || name === 'coffee') lift = seated(j, opts.seat);
  if (name === 'walk') {
    lift = walking(j, u, opts.amount);
    if (opts.phone) {
      // (Answering as he sets off: his right arm from its swing.)
      const answer = unit(opts.answer, 1);
      if (answer < 1) answering(j, props, answer, face, armState(j, 0));
      else atEar(j, props, face);
      gesturing(j, unit(opts.gesture));
    }
  } else if (name === 'sit') handsInLap(j);
  else if (name === 'rise') lift = rising(j, p, opts.seat);
  else if (name === 'desk') atDesk(j, phase, unit(opts.keys, 1), unit(opts.back), unit(opts.pad), unit(opts.tap), opts.sway ?? 0);
  else if (name === 'answer') answering(j, props, p, face);
  else if (name === 'call') {
    atEar(j, props, face);
    gesturing(j, unit(opts.gesture));
  } else if (name === 'coffee') holding = drinking(j, props, p, lift, unit(opts.rest), unit(opts.look), face.lips, opts.cup);
  // His cup in the café table's saucer, unless he holds it.
  const c = opts.cup;
  if (c && !holding) cupDown(props, [c[0], c[1] - lift, c[2]], c[3]);
  j.root.userData.lift = lift;
  return { lift, resting: !!c && !holding };
}
/** His phone at his ear in his right hand (EAR, his hand at `face.ear`, his wrist turned by `face.wrist`). */
function atEar(j: FilipJoints, props: FilipProps, face: FilipFaceTargets) {
  reach(j, 0, face.ear, EAR.bend);
  phoneInHand(j, props, face);
}
/** His free (left) hand opening before him, `g` of the way from where the pose left it (at ease, or swinging as he walks). */
function gesturing(j: FilipJoints, g: number) {
  if (!g) return;
  const from = armState(j, 1);
  reach(j, 1, GESTURE.hand, GESTURE.bend);
  const open = armState(j, 1);
  easeArm(j, 1, from, open, smooth(g, 0, 1));
}
/**
 * Answering at `p` (POCKET), his right arm from `from` (at ease standing, or swinging as he walks):
 * his hand up to his breast pocket; from `show` his phone is out of it into his hand, which brings it
 * before his chest by `taken` (the phone tipped up to his eyes); a look at it until `look`; then hand
 * and phone go up and out on a curve to his ear (his hand at `ear`), the phone turning from his look into
 * his grip, his elbow coming out and down (1: 'call'). Back from 1 to 0, he puts it away.
 */
function answering(j: FilipJoints, props: FilipProps, p: number, face: FilipFaceTargets, from: ArmState = AT_EASE[0]) {
  const P = POCKET,
    G = P.glance,
    ear = face.ear;
  if (p < P.look) {
    // Up to the pocket (eased from where the arm was), then out before his chest with the phone.
    const out = smooth(p, P.show, P.taken),
      up = smooth(out, P.rise, 1),
      ahead = smooth(out, 0, P.forward);
    reach(j, 0, [mix(P.hand[0], G.hand[0], out), mix(P.hand[1], G.hand[1], up), mix(P.hand[2], G.hand[2], ahead)], mixV(P.bend, G.bend, out));
    if (p < P.reach) easeArm(j, 0, from, armState(j, 0), smooth(p, 0, P.reach));
    if (p >= P.show) phoneInHand(j, props, face, out, out);
    return;
  }
  // From before his chest, up and out by `via`, to his ear.
  const e = smooth(p, P.look, 1),
    w = [(1 - e) ** 2, 2 * e * (1 - e), e * e],
    via = [G.hand, P.via, ear],
    at = [0, 1, 2].map((i) => w[0] * via[0][i] + w[1] * via[1][i] + w[2] * via[2][i]) as V3;
  reach(j, 0, e >= 1 ? ear : at, e >= 1 ? EAR.bend : mixV(G.bend, EAR.bend, e));
  phoneInHand(j, props, face, 1, 1 - e);
}
/**
 * At the desk (DESK): his lean and his hands. `t` the seconds of his work, `keys` his hands from his
 * lap to the desk, `back` thinking, `pad` scrolling, `tap` typing, `sway` his body's slow sway.
 */
function atDesk(j: FilipJoints, t: number, keys: number, back: number, pad: number, tap: number, sway: number) {
  const D = DESK,
    // Leaned in to type as his hands come up to the keys, back to think; swaying as he types.
    a = mix(mix(-0.03, D.lean, smooth(keys, D.leanIn[0], D.leanIn[1])), D.back, back) + sway,
    r = mixV([0, 0, 0], D.reach, keys);
  lean(j, a, r);
  for (const k of [0, 1] as const) {
    const side = k ? 1 : -1,
      // Typing: each hand bobs up off the keys and back, out of step with the other; scrolling, the
      // right hand strokes.
      bob = 0.006 * tap * (0.5 - 0.5 * Math.cos(Math.PI * 2 * 2.5 * t + k * Math.PI)),
      typing: V3 = [D.keys[0] + side * D.apart, D.keys[1] + bob, D.keys[2]],
      stroke: V3 = [D.pad[0], D.pad[1], D.pad[2] + D.stroke * Math.sin((Math.PI * 2 * t) / 1.6) * pad],
      edge: V3 = [side * D.edge[0], D.edge[1], D.edge[2]],
      // At the desk: on the keys, or the trackpad (his right hand: on the laptop still), or the desk
      // beside the laptop (his left as he scrolls, both as he sits back): on the way off the laptop a
      // hand lifts, goes out past its side and only then comes down onto the desk, and back the same way.
      on = k ? typing : mixV(typing, stroke, pad),
      off = k ? Math.max(pad, back) : back,
      onDesk: V3 = [mix(on[0], edge[0], smooth(off, 0, 0.6)), mix(on[1], edge[1], smooth(off, 0.6, 1)) + D.lift * Math.sin(Math.PI * Math.min(1, off / 0.6) * 0.5) * (1 - smooth(off, 0.6, 1)), mix(on[2], edge[2], smooth(off, 0, 0.6))];
    const [lap, lapBend] = LAP(k),
      // From his lap up first, then forward over the desk's edge, lifted `over` as he goes (his forearms
      // clear of the laptop's front edge as his hands come onto the keys and leave them).
      over = D.over * smooth(keys, 0.25, 0.75) * (1 - smooth(keys, 0.85, 1)),
      at: V3 = [mix(lap[0], onDesk[0], keys) + side * D.wide * Math.sin(Math.PI * keys), mix(lap[1], onDesk[1], smooth(keys, D.rise[0], D.rise[1])) + over, mix(lap[2], onDesk[2], smooth(keys, D.ahead[0], D.ahead[1]))];
    reach(j, k, at, mixV(lapBend, k ? D.bend(k) : mixV(D.bend(k), D.padBend, pad), keys));
  }
}
/**
 * At coffee, a drink at `p` (DRINK): his right hand from his lap to the cup's handle as it rests in its
 * saucer, the cup up to his lips, tipped and back, down into its saucer, his hand back to his lap; he
 * leans in to the table for the cup and sits up to drink. His left hand on the table's edge by `rest`;
 * turned out over the sea by `look`. `lift` is his root's over his floor (the cup's place is given over
 * his floor). Returns whether the cup is off its saucer (in his hand).
 */
function drinking(j: FilipJoints, props: FilipProps, p: number, lift: number, rest: number, look: number, lipsAt: V3, cup?: [number, number, number, number]) {
  const C = COFFEE,
    s = cup ?? [FILIP_CAFE.saucer[0] / S, seatedY(FILIP_CAFE.top) + lift, FILIP_CAFE.saucer[1] / S, FILIP_CAFE.turn],
    at: V3 = [s[0], s[1] - lift, s[2]],
    // How far his hand is from his lap to the cup (in its saucer), and how far the cup is up.
    toCup = smooth(p, 0, DRINK.grip) * (1 - smooth(p, DRINK.back, 1)),
    up = smooth(p, DRINK.grip, DRINK.up) * (1 - smooth(p, DRINK.down, DRINK.back)),
    tip = smooth(p, DRINK.up, DRINK.tip) * (1 - smooth(p, DRINK.untip, DRINK.down)),
    // Leaning on the table as his left hand comes to its edge, and in while his right hand is down at the table.
    inward = toCup * (1 - up),
    leaning = mix(mix(C.sit, C.lounge, rest), C.lean, inward);
  lean(j, leaning, mixV([0, 0, 0], C.reach, Math.max(rest, inward)));
  twist(j, 0.1 * smooth(look, 0, 1));
  // The cup in its saucer, and where it goes: its middle from its rest up to his lips.
  cupDown(props, at, s[3]);
  const restCup = props.cup.position.clone(),
    restQ = props.cup.quaternion.clone(),
    axis = new T.Vector3(CUP_AXIS, 0, 0).applyQuaternion(restQ).add(restCup),
    lips = new T.Vector3(...leaned(lipsAt, leaning)).applyAxisAngle(new T.Vector3(0, 1, 0), 0.1 * smooth(look, 0, 1)),
    mid = axis.clone().lerp(lips, up);
  // (Up off the saucer before it comes back toward him.)
  mid.y += 0.05 * Math.sin(Math.PI * up);
  if (up > 0) {
    const q = new T.Quaternion().setFromEuler(new T.Euler(-C.tilt * tip, s[3] - 0.5, 0, 'YXZ')),
      lug = new T.Vector3(-CUP_AXIS, 0, 0).applyQuaternion(q);
    props.cup.quaternion.copy(q);
    props.cup.position.copy(mid).add(lug);
  }
  // His right hand: from his lap to the cup's handle and with it; his left on the table's edge.
  const [lap0, bend0] = LAP(0),
    [lap1, bend1] = LAP(1),
    handle = props.cup.position;
  // (Up from his lap first and then out over the table's edge, and back the same way.)
  reach(j, 0, [mix(lap0[0], handle.x, toCup), mix(lap0[1], handle.y, smooth(toCup, 0, 0.6)), mix(lap0[2], handle.z, smooth(toCup, 0.3, 1))], mixV(bend0, [-0.8, -0.5, -0.3], toCup));
  // (His left hand on the table's edge, the saucer's foot being on the table's top whatever its
  // height: up from his lap first and then out over the edge, and back the same way.)
  const edge: V3 = [C.edge[0], at[1] + C.edge[1], C.edge[2]];
  reach(j, 1, [mix(lap1[0], edge[0], rest), mix(lap1[1], edge[1], smooth(rest, 0, 0.6)), mix(lap1[2], edge[2], smooth(rest, 0.35, 1))], mixV(bend1, [0.8, -0.35, -0.45], rest));
  return up > 0;
}

/* ------------------------------------------------------------------ */
/* How he goes about his day                                           */
/* ------------------------------------------------------------------ */
/**
 * How he walks: his `speed` (the town's units a second: a shade brisker than Alison's 0.4 scaled with
 * him, as his stations stand further apart on his bigger island; his stride is hers scaled with him,
 * so a walk's phase is the distance over it and his feet never slide), easing in and out over `ease`
 * seconds; on the phone he paces slower (FILIP_PACE). A walk never starts with a spin on the spot
 * (Alison's open finding, the turn-on-the-spot skate): it sets off on a curve of radius `radius` round
 * to his way; his corners are rounded on it, his pacing turns round on U-curves, and he comes to each
 * chair's side on a curve that leaves him facing near the way he sits, turning the rest on the spot
 * (a quarter in `turn` seconds, `minTurn` at the least). He stands `pause` seconds at a chair's side
 * before sitting down and after getting up, and gets up or sits down over `rise` seconds, sliding
 * `slide` out to the chair's side.
 */
export const FILIP_GAIT: DayGait & { radius: number; pause: number; rise: number; slide: number } = { speed: 0.52, stride: STRIDE * S, ease: 1.2, turn: 1.0, minTurn: 0.4, radius: 0.4, pause: 0.35, rise: 0.9, slide: SLIDE };
export const FILIP_PACE: DayGait = { ...FILIP_GAIT, speed: 0.32 };
/**
 * His work at the desk (seconds from the day's start): typing (`typing`), thinking (`think`), typing,
 * scrolling (`scroll`), typing, his hands at rest on the keys, down to his lap over `down` seconds by
 * `done`; each change
 * eased over `ease`; his typing in bursts (`burst` on, `gap` off, each easing in and out over
 * `tapEase`) within each stretch of typing; his body swaying `sway` (radians) every `swayEvery`
 * seconds while he works. Back at his desk after coffee he sits `settle` seconds with his hands in his
 * lap and brings them up to the keys over `up`. (His elbows ride high over the laptop's front edge,
 * so his hands go between his lap and the keys no faster than over 1.2 seconds.)
 */
export const FILIP_WORK = { typing: [[0.6, 7.4], [10.4, 16.4], [20.4, 29.0]] as [number, number][], think: [7.8, 9.9] as [number, number], scroll: [16.8, 19.9] as [number, number], done: 30.5, down: 1.3, ease: 0.5, burst: 2.1, gap: 0.8, tapEase: 0.3, sway: 0.012, swayEvery: 6.5, settle: 1, up: 1.2 };
/**
 * The call: his phone from his pocket to his ear over `answer` seconds standing (and back the same: at
 * design.md's 0.8 his hand and the phone flew up 0.04 a frame), `walking` as he walks (his walk moves
 * his hand too), taken out `after` seconds into his walk from the desk
 * (once he has turned out from behind it: his phone arm comes out to his side); a `listen` standing still
 * between his lengths; his free hand opens before him (`gesture` seconds up, `hold`, as long down) at
 * `gestures` seconds into each stretch he paces, and once as he listens.
 */
export const FILIP_CALL = { answer: 1.4, walking: 2.4, after: 0.2, listen: 2.4, gesture: 0.7, hold: 0.6, gestures: [2.4, 8.2] };
/**
 * Coffee: `settle` seconds as he sits down (his left hand to the table's edge over its last `rest`),
 * `drinks` drinks of `drink` seconds `between` apart (a look out over the sea in each gap: `look`
 * seconds turning out and back), then his left hand back to his lap over `rest` before he gets up.
 */
export const FILIP_COFFEE = { settle: 1, rest: 0.6, drink: 4.6, between: 2, drinks: 3, look: 1.6 };
/** Where he is in his day: at the desk, on the call, at coffee, or walking between. */
export type FilipStation = 'desk' | 'call' | 'cafe' | 'walk';
/**
 * One stretch of his day, from `t0` to `t1` seconds into it, at a station, `phone` if his phone is in
 * his hand (at his ear) all through it:
 * - `desk`: at the desk, `back` false for his morning's work (FILIP_WORK), true back from coffee;
 * - `rise`: getting up out of his chair at `seat` to its side (`up`), or sitting down from there;
 * - `stand` and `turn`: standing at (x, z), facing `heading`, or turning on the spot;
 * - `walk`: along `line` (`length` long, `walked` before it), at `gait` if not FILIP_GAIT; answering
 *   his phone as he goes, if it has `answer`: from `at` seconds into it, over `seconds`;
 * - `answer`: at (x, z), his phone from his pocket to his ear (`up`) or back;
 * - `call`: standing on the phone, listening;
 * - `cafe`: at the café table (FILIP_COFFEE).
 */
export type FilipAct = { t0: number; t1: number; station: FilipStation; phone: boolean } & (
  | { kind: 'desk'; back: boolean }
  | { kind: 'rise'; up: boolean; seat: 'desk' | 'cafe' }
  | { kind: 'stand'; x: number; z: number; heading: number }
  | { kind: 'turn'; x: number; z: number; from: number; to: number }
  | { kind: 'walk'; line: XZ[]; length: number; walked: number; gait?: DayGait; answer?: { at: number; seconds: number } }
  | { kind: 'answer'; x: number; z: number; heading: number; up: boolean }
  | { kind: 'call'; x: number; z: number; heading: number }
  | { kind: 'cafe' }
);
type FilipStep<A = FilipAct> = A extends FilipAct ? Omit<A, 't0' | 't1' | 'phone'> : never;
/** filipDay's answer: where he is and how poseFilip poses him there (its options by their own names). */
export type FilipDay = {
  station: FilipStation;
  pose: FilipPose;
  phase: number;
  x: number;
  z: number;
  heading: number;
  amount: number;
  seat: number;
  phone: boolean;
  keys: number;
  back: number;
  pad: number;
  tap: number;
  sway: number;
  gesture: number;
  rest: number;
  look: number;
  answer: number;
  cup: [number, number, number, number];
};
/** A point `d` along bearing `b` from (x, z); a bearing b points along (sin b, cos b). */
const along = (x: number, z: number, b: number, d: number): XZ => [x + Math.sin(b) * d, z + Math.cos(b) * d];
/** A point `d` across to the left of someone at (x, z) facing `b` (their left is (cos b, -sin b)). */
const aside = (x: number, z: number, b: number, d: number): XZ => [x + Math.cos(b) * d, z - Math.sin(b) * d];
/** The bearing from a to b. */
const bearing = (a: XZ, b: XZ) => Math.atan2(b[0] - a[0], b[1] - a[1]);
/**
 * An arc from (x, z), facing `heading`, turning `turn` radians (+: toward greater bearings, his left)
 * on a circle of radius `r`, as points about `step` apart, the first (x, z) itself.
 */
function arc(x: number, z: number, heading: number, turn: number, r: number, step = 0.02): XZ[] {
  const s = Math.sign(turn),
    // The circle's middle, on the side it turns to.
    cx = x + Math.sin(heading + (s * Math.PI) / 2) * r,
    cz = z + Math.cos(heading + (s * Math.PI) / 2) * r,
    n = Math.max(2, Math.ceil((Math.abs(turn) * r) / step)),
    out: XZ[] = [];
  for (let i = 0; i <= n; i++) {
    const h = heading + (turn * i) / n - (s * Math.PI) / 2;
    out.push([cx + Math.sin(h) * r, cz + Math.cos(h) * r]);
  }
  return out;
}
/**
 * A polyline through `points` with each corner rounded on an arc of radius `r` (less where a leg
 * either side is too short for it), so a walk along it turns as a walk does.
 */
function rounded(points: XZ[], r: number): XZ[] {
  const out: XZ[] = [points[0]],
    n = points.length;
  for (let i = 1; i + 1 < n; i++) {
    const [px, pz] = points[i],
      a = [px - points[i - 1][0], pz - points[i - 1][1]],
      b = [points[i + 1][0] - px, points[i + 1][1] - pz],
      la = Math.hypot(a[0], a[1]),
      lb = Math.hypot(b[0], b[1]),
      hin = Math.atan2(a[0], a[1]),
      turn = angleDiff(Math.atan2(b[0], b[1]), hin);
    if (Math.abs(turn) < 1e-3) {
      out.push(points[i]);
      continue;
    }
    // The tangent's length along each leg: at most half of a leg it shares with another corner, all
    // of the first or the last.
    const t = Math.min(r * Math.tan(Math.abs(turn) / 2), i === 1 ? la : la / 2, i + 2 === n ? lb : lb / 2),
      rr = t / Math.tan(Math.abs(turn) / 2);
    out.push(...arc(px - (a[0] / la) * t, pz - (a[1] / la) * t, hin, turn, rr));
  }
  out.push(points[points.length - 1]);
  return out;
}
/** A sliver straight ahead from (x, z) facing `heading`: a walk that starts with it has no turn of its own (planDay's walk turns to its first stretch). */
const sliver = (x: number, z: number, heading: number): XZ => [x + Math.sin(heading) * 1e-4, z + Math.cos(heading) * 1e-4];
/**
 * A walk from (x, z), facing `heading`, through `points` (the first his next goal): he sets off
 * straight ahead and round on a curve of FILIP_GAIT.radius until he faces his goal, however little
 * he has to turn (a sliver straight ahead first, so the walk's own turn is none: never a spin on the
 * spot, nor a kink in his heading), and on through the rest, its corners rounded on the same radius.
 */
function setOff(x: number, z: number, heading: number, points: XZ[]): XZ[] {
  const G = FILIP_GAIT,
    off = angleDiff(bearing([x, z], points[0]), heading);
  if (Math.abs(off) < 1e-4) return [[x, z], ...rounded([sliver(x, z, heading), ...points], G.radius)];
  // Round on the circle until he faces the goal (the bearing from his place on it to the goal is his heading there).
  const s = Math.sign(off),
    [gx, gz] = points[0],
    cx = x + Math.sin(heading + (s * Math.PI) / 2) * G.radius,
    cz = z + Math.cos(heading + (s * Math.PI) / 2) * G.radius;
  let turn = 0;
  for (let k = 1; k <= 400; k++) {
    const h = heading + s * k * 0.01,
      px = cx + Math.sin(h - (s * Math.PI) / 2) * G.radius,
      pz = cz + Math.cos(h - (s * Math.PI) / 2) * G.radius;
    if (Math.sign(angleDiff(Math.atan2(gx - px, gz - pz), h)) !== s) break;
    turn = s * k * 0.01;
  }
  const curve = arc(x, z, heading, turn, G.radius),
    [ex, ez] = curve[curve.length - 1];
  return [[x, z], sliver(x, z, heading), ...curve.slice(1), ...rounded([[ex, ez], ...points], G.radius).slice(1)];
}
/** 1 from `a` to `b` seconds, easing in and out over `ease` at each end, and 0 outside. */
const span = (t: number, a: number, b: number, ease: number) => smoothstep((t - a) / ease) * (1 - smoothstep((t - (b - ease)) / ease));
/** His morning's work `t` seconds in (FILIP_WORK): his hands on the keys, thinking, scrolling, typing and his sway. */
function workAt(t: number) {
  const W = FILIP_WORK;
  let tap = 0;
  for (const [a, b] of W.typing) for (let s = a; s < b; s += W.burst + W.gap) tap = Math.max(tap, span(t, s, Math.min(s + W.burst, b), W.tapEase));
  return {
    keys: 1 - smoothstep((t - (W.done - W.down)) / W.down),
    back: span(t, W.think[0], W.think[1], W.ease),
    pad: span(t, W.scroll[0], W.scroll[1], W.ease),
    tap,
    sway: W.sway * Math.sin((Math.PI * 2 * t) / W.swayEvery) * span(t, 0.5, W.done - 2, 1),
  };
}
/** His coffee `t` seconds after he sat down (FILIP_COFFEE), `seconds` in all: the drink's phase, his left hand on the table's edge, his look out. */
function coffeeAt(t: number, seconds: number) {
  const K = FILIP_COFFEE;
  let phase = 0,
    look = 0;
  for (let i = 0; i < K.drinks; i++) {
    const s = K.settle + i * (K.drink + K.between);
    if (t >= s && t < s + K.drink) phase = (t - s) / K.drink;
    if (i + 1 < K.drinks) {
      const g = s + K.drink + (K.between - K.look) / 2;
      look = Math.max(look, span(t, g, g + K.look, K.look / 2));
    }
  }
  return { phase, look, rest: smoothstep((t - (K.settle - K.rest)) / K.rest) * (1 - smoothstep((t - (seconds - K.rest)) / K.rest)) };
}
/**
 * His free hand's gesture `t` seconds into a stretch on the phone `seconds` long, opening at each of
 * `at` that ends (up, held and down again) a second or more before the stretch does.
 */
function gestureAt(t: number, at: number[], seconds: number) {
  const C = FILIP_CALL,
    long = 2 * C.gesture + C.hold;
  return at.reduce((g, s) => (s + long <= seconds - 1 ? Math.max(g, span(t, s, s + long, C.gesture)) : g), 0);
}

/**
 * His day on a site (FilipSite), FILIP_DAY on the island's: its acts, one after another, `period`
 * seconds round (Alison's is 127, so the two islands never fall into step); `seats`, where he sits and
 * stands (his root seated at the desk and at the café, and each chair's side, where getting up takes
 * him: on his left at both, the desk's east and the café's north-east, toward the plaza); `saucer`, the café table's saucer's
 * foot (its turn `ry`), where his cup rests; `walked`, his walking in a day; and his moment at a time
 * (`day`), the still pose he settles into if held then (`still`) and the blend between them (`blend`).
 *
 * The day: at the desk working (the day's start: time 0 is his hands at rest on the keys, the frozen
 * frame); up out of his chair to its side and a little back from the desk; off down the veranda east
 * of the desk, taking his phone from his pocket to his ear as he goes (a look at its screen on the
 * way), and on the phone down the veranda's ramp, west along the forecourt and round one left arc onto
 * the call stretch on the bay walk; pacing it four lengths (down the stretch, round a U-curve and back
 * up its left line, a moment standing to listen at the plaza's end, round again, down and back up),
 * his phone back in his pocket at the plaza's end; across the plaza's west half and along the café
 * room's north side to his chair's side, into his chair, coffee (three drinks, a look out over the
 * sea between them), up again; back along the room's north side, across the plaza onto the
 * forecourt, up the ramp and the veranda east of the desk to its side, turned to sit, into his chair,
 * and his hands back up to the keys. His cup stays in the café table's saucer all day but while he drinks;
 * his phone is in his pocket but from his answering it, as he sets off, to his putting it away.
 */
export function filipDayOf(site: FilipSite) {
  const G = FILIP_GAIT,
    W = FILIP_WORK,
    K = FILIP_COFFEE,
    D = FILIP_DESK,
    floor = site.floor;
  // Where he sits and stands.
  const desk = (() => {
      const h = site.desk.heading,
        [x, z] = aside(...along(site.desk.x, site.desk.z, h, -(D.near + D.depth / 2)), h, D.across);
      return { x, z, facing: h };
    })(),
    cafe = (() => {
      const h = site.cafe.heading,
        [x, z] = along(site.cafe.x, site.cafe.z, h, -(FILIP_CAFE.radius + FILIP_CAFE.gap + FILIP_CHAIR.setback));
      return { x, z, facing: h };
    })(),
    seats = { desk, cafe, deskSide: along(...aside(desk.x, desk.z, desk.facing, G.slide), desk.facing, -D.leave), cafeSide: aside(cafe.x, cafe.z, cafe.facing, G.slide) },
    sides = { desk: seats.deskSide, cafe: seats.cafeSide },
    // The café table's saucer, on its top in front of his chair.
    [sx, sz] = aside(...along(cafe.x, cafe.z, cafe.facing, FILIP_CAFE.saucer[1]), cafe.facing, FILIP_CAFE.saucer[0]),
    // The floors the desk set and the café set stand on (each set, its chairs with it, at one height).
    levels = { desk: site.desk.y ?? floor(site.desk.x, site.desk.z), cafe: site.cafe.y ?? floor(site.cafe.x, site.cafe.z) },
    saucer = { x: sx, z: sz, y: levels.cafe + FILIP_CAFE.top, ry: cafe.facing + FILIP_CAFE.turn };
  // The call stretch: its near end (south, by the landing) and its far end (north, at the plaza's
  // rim, toward the café, where he puts his phone away); its two lines, the stretch itself
  // (lane(p, -1)) and one 2r to its left on the way from near to far (lane(p, 1): west), which
  // U-curves of radius r join.
  const [near, far] = site.call.ends,
    r = site.call.turn,
    out = bearing(near, far),
    lane = (p: XZ, side: number): XZ => aside(p[0], p[1], out, (side + 1) * r),
    [start, end] = [lane(far, -1), lane(near, -1)];
  const tag = { phone: false },
    days = planDay<FilipAct>(desk.facing, G, () => G.turn),
    add = (seconds: number, act: FilipStep) => days.add(seconds, act),
    heading = () => days.day.heading,
    go = (from: XZ, points: XZ[], pace?: DayGait) => days.walk(setOff(from[0], from[1], heading(), points), pace);
  days.day.tag = tag;
  // The morning's work, and up out of his chair to its side.
  add(W.done, { kind: 'desk', station: 'desk', back: false });
  add(G.rise, { kind: 'rise', station: 'desk', up: true, seat: 'desk' });
  add(G.pause, { kind: 'stand', station: 'desk', x: seats.deskSide[0], z: seats.deskSide[1], heading: heading() });
  // Off on the phone, taking it from his pocket to his ear as he sets off (out from behind the desk,
  // his phone arm clear of it), down the ramp and along the walks onto the call stretch, heading down
  // it to its far end (his ways end on its line, heading down it, so his pacing starts with no turn of
  // its own).
  tag.phone = true;
  go(seats.deskSide, [...site.ways.out, start]);
  (days.acts[days.acts.length - 1] as FilipAct & { kind: 'walk' }).answer = { at: FILIP_CALL.after, seconds: FILIP_CALL.walking };
  // Pacing four lengths: down the stretch, round a U-curve onto its left line and back up to the far
  // end; a moment standing there to listen; round again, down the stretch and back up its left line,
  // so the call ends at the plaza's end, toward the café. (His pacing is the call's: its walks are at
  // the call stretch.)
  const pace = (points: XZ[]) => {
    days.walk(points, FILIP_PACE);
    days.acts[days.acts.length - 1].station = 'call';
  };
  const home = lane(far, 1),
    uturn = (p: XZ, h: number) => arc(...p, h, -Math.PI, r).slice(1);
  pace([start, end, ...uturn(end, out + Math.PI), home]);
  add(FILIP_CALL.listen, { kind: 'call', station: 'call', x: home[0], z: home[1], heading: heading() });
  pace([home, sliver(...home, out), ...uturn(home, out), end, sliver(...end, out + Math.PI), ...uturn(end, out + Math.PI), home]);
  add(FILIP_CALL.answer, { kind: 'answer', station: 'call', x: home[0], z: home[1], heading: heading(), up: false });
  tag.phone = false;
  // On to the café table, round to his chair's side, and turned to sit.
  go(home, [...site.ways.across, seats.cafeSide]);
  days.turnTo(seats.cafeSide[0], seats.cafeSide[1], cafe.facing, 'cafe');
  add(G.pause, { kind: 'stand', station: 'cafe', x: seats.cafeSide[0], z: seats.cafeSide[1], heading: heading() });
  add(G.rise, { kind: 'rise', station: 'cafe', up: false, seat: 'cafe' });
  add(K.settle + K.drinks * K.drink + (K.drinks - 1) * K.between + K.rest, { kind: 'cafe', station: 'cafe' });
  add(G.rise, { kind: 'rise', station: 'cafe', up: true, seat: 'cafe' });
  add(G.pause, { kind: 'stand', station: 'cafe', x: seats.cafeSide[0], z: seats.cafeSide[1], heading: heading() });
  // Home: across the plaza, along the forecourt and up the ramp, down the veranda east of the desk to
  // its side, and turned on the spot to sit.
  go(seats.cafeSide, [...site.ways.home, seats.deskSide]);
  days.turnTo(seats.deskSide[0], seats.deskSide[1], desk.facing, 'desk');
  add(G.pause, { kind: 'stand', station: 'desk', x: seats.deskSide[0], z: seats.deskSide[1], heading: heading() });
  add(G.rise, { kind: 'rise', station: 'desk', up: false, seat: 'desk' });
  // Back at work: his hands in his lap a moment, up to the keys, at rest there as the day comes round.
  const { t } = days.day,
    period = Math.ceil(t + W.settle + W.up + 0.5);
  add(period - t, { kind: 'desk', station: 'desk', back: true });
  const acts = days.acts;

  /** His seat over the floor where he is (the rig's units), the chair standing on the `level` of its set. */
  const seatOver = (level: number, x: number, z: number) => (level + FILIP_CHAIR.height - floor(x, z)) / S;
  /** Where his cup rests in the café table's saucer, in his frame where he is (the rig's units). */
  const cupFor = (o: FilipDay) => {
    const c = Math.cos(o.heading),
      s = Math.sin(o.heading),
      dx = saucer.x - o.x,
      dz = saucer.z - o.z;
    o.cup = [(dx * c - dz * s) / S, (saucer.y - floor(o.x, o.z)) / S, (dx * s + dz * c) / S, saucer.ry - o.heading];
    return o;
  };
  /**
   * Filip at time `time` of his day (pure: the same time always gives the same answer; time 0 has him
   * at his desk, his hands at rest on the keys): `station`; `pose` and `phase`, poseFilip's arguments,
   * and its options by their own names; (x, z), his root's place in the island's frame, and `heading`,
   * its rotation.y. Getting up and sitting down his root slides between his chair's seat and its side
   * by the smoothstep of 'rise''s phase.
   */
  const day = (time: number): FilipDay => {
    const tt = ((time % period) + period) % period,
      act = acts.find((a) => tt < a.t1) ?? acts[acts.length - 1],
      into = tt - act.t0,
      o: FilipDay = { station: act.station, pose: 'stand', phase: 0, x: 0, z: 0, heading: 0, amount: 0, seat: 0, phone: act.phone, keys: 0, back: 0, pad: 0, tap: 0, sway: 0, gesture: 0, rest: 0, look: 0, answer: 1, cup: [0, 0, 0, 0] };
    switch (act.kind) {
      case 'desk':
        Object.assign(o, { pose: 'desk', x: desk.x, z: desk.z, heading: desk.facing }, act.back ? { keys: smoothstep((into - W.settle) / W.up) } : { phase: into, ...workAt(into) });
        o.seat = seatOver(levels.desk, desk.x, desk.z);
        break;
      case 'rise': {
        const f = into / (act.t1 - act.t0),
          b = act.up ? f : 1 - f,
          e = smoothstep(b),
          seat = seats[act.seat],
          side = sides[act.seat];
        Object.assign(o, { pose: 'rise', phase: b, x: seat.x * (1 - e) + side[0] * e, z: seat.z * (1 - e) + side[1] * e, heading: seat.facing });
        o.seat = seatOver(levels[act.seat], o.x, o.z);
        break;
      }
      case 'stand':
        Object.assign(o, { pose: act.phone ? 'call' : 'stand', x: act.x, z: act.z, heading: act.heading });
        break;
      case 'turn':
        Object.assign(o, { pose: act.phone ? 'call' : 'stand', x: act.x, z: act.z, heading: act.from + (act.to - act.from) * smoothstep(into / (act.t1 - act.t0)) });
        break;
      case 'walk': {
        const gait = act.gait ?? G,
          { along: d, pace } = walkProgress(act.length, into, gait),
          p = samplePolyline(act.line, Math.min(act.length - 1e-9, d), false, true);
        Object.assign(o, { pose: 'walk', phase: (act.walked + d) / G.stride, x: p.x, z: p.z, heading: p.heading, amount: pace / gait.speed });
        // Answering as he sets off; pacing on the phone, his free hand opens now and then.
        if (act.answer) o.answer = T.MathUtils.clamp((into - act.answer.at) / act.answer.seconds, 0, 1);
        if (act.phone && act.gait) o.gesture = gestureAt(into, FILIP_CALL.gestures, act.t1 - act.t0);
        break;
      }
      case 'answer': {
        const f = into / (act.t1 - act.t0);
        Object.assign(o, { pose: 'answer', phase: act.up ? f : 1 - f, x: act.x, z: act.z, heading: act.heading });
        break;
      }
      case 'call': {
        const C = FILIP_CALL,
          seconds = act.t1 - act.t0;
        Object.assign(o, { pose: 'call', x: act.x, z: act.z, heading: act.heading, gesture: gestureAt(into, [(seconds - 2 * C.gesture - C.hold) / 2], seconds + 1) });
        break;
      }
      case 'cafe':
        Object.assign(o, { pose: 'coffee', x: cafe.x, z: cafe.z, heading: cafe.facing }, coffeeAt(into, act.t1 - act.t0));
        o.seat = seatOver(levels.cafe, cafe.x, cafe.z);
        break;
    }
    o.heading = Math.atan2(Math.sin(o.heading), Math.cos(o.heading));
    return cupFor(o);
  };
  /**
   * The still pose he settles into if his day is held at `time` (day's answer there, made still;
   * pure): where he is, as he is, but never mid-movement. At the desk his hands come to rest where they
   * are nearer (on the keys or in his lap), no typing, thinking or scrolling; getting up or sitting down
   * he finishes whichever he is nearer; walking, he stands, his feet together where he is (his phone
   * still at his ear if he is on the call, his free hand down); turning, he stands as he is turned;
   * answering or putting his phone away, he finishes whichever he is nearer (at his ear, or away); at
   * coffee the cup comes back down into its saucer with his hand on it (or his hand stays in his lap,
   * as it is nearer), his look comes back, his left hand rests where it is nearer.
   */
  const still = (time: number): FilipDay => {
    const o = day(time),
      nearer = (v: number) => (v < 0.5 ? 0 : 1);
    o.gesture = 0;
    switch (o.pose) {
      case 'desk':
        Object.assign(o, { keys: nearer(o.keys), back: 0, pad: 0, tap: 0, sway: 0 });
        break;
      case 'rise': {
        const b = nearer(o.phase),
          which = o.station === 'cafe' ? 'cafe' : 'desk',
          seat = seats[which],
          side = sides[which];
        Object.assign(o, { phase: b, x: seat.x * (1 - b) + side[0] * b, z: seat.z * (1 - b) + side[1] * b });
        o.seat = seatOver(levels[which], o.x, o.z);
        break;
      }
      case 'walk':
        Object.assign(o, { amount: 0, answer: nearer(o.answer) });
        break;
      case 'answer':
        o.phase = nearer(o.phase);
        break;
      case 'coffee': {
        const p = o.phase;
        o.phase = p < DRINK.grip / 2 ? 0 : p > (1 + DRINK.back) / 2 ? 1 : p < 0.5 ? DRINK.grip : DRINK.back;
        Object.assign(o, { look: 0, rest: nearer(o.rest) });
        break;
      }
    }
    return cupFor(o);
  };
  /** Part of the way `e` from one moment's answer `a` to another's `b` of the same pose (his live day and the still pose it settles into). */
  const blend = (a: FilipDay, b: FilipDay, e: number): FilipDay => cupFor(blendDay(a, b, e, ['phase', 'x', 'z', 'amount', 'seat', 'keys', 'back', 'pad', 'tap', 'sway', 'gesture', 'rest', 'look', 'answer']));
  return { period, acts, seats, levels, saucer, walked: days.day.walked, floor, site, day, still, blend };
}
export type FilipPlan = ReturnType<typeof filipDayOf>;
/**
 * His furniture as solids (FilipSolid), in the island's frame, where his day on `plan` stands it and as
 * the garden builds it to his measures (its deskSet and cafeSet, its chairParts with a foot ring):
 * the desk's top, its legs and its rails (none on his side), the laptop and the potted plant on its
 * free end; each chair's seat, legs, raked back posts and back rail, and its foot ring (FILIP_RING:
 * side bars outside the legs, a front bar out before the seat, a back bar); the café table's top, its
 * pedestal and foot, and the guest's chair across the table from his.
 */
export function filipFurniture(plan: FilipPlan): FilipSolid[] {
  const D = FILIP_DESK,
    CH = FILIP_CHAIR,
    CF = FILIP_CAFE,
    { site, seats, levels } = plan,
    out: FilipSolid[] = [];
  // A frame at (x, y, z) turned ry; a box in it (its middle, half sizes, leaning rx about its own x)
  // and a post (at x, z in it, r round, from y0 to y1 up).
  const frame = (x: number, y: number, z: number, ry: number) => new T.Matrix4().makeRotationY(ry).setPosition(x, y, z),
    box = (name: string, f: T.Matrix4, [x, y, z]: V3, size: V3, rx = 0) => out.push({ name, kind: 'box', at: f.clone().multiply(new T.Matrix4().makeTranslation(x, y, z)).multiply(new T.Matrix4().makeRotationX(rx)), size }),
    post = (name: string, f: T.Matrix4, x: number, z: number, r: number, y0: number, y1: number) => out.push({ name, kind: 'post', at: f.clone().multiply(new T.Matrix4().makeTranslation(x, 0, z)), size: [r, y0, y1] });
  // A chair, its frame's origin the seat's middle on its floor, its front +z (the garden's chairParts).
  const chair = (name: string, f: T.Matrix4) => {
    const w = CH.width / 2,
      d = CH.depth / 2,
      leg = 0.04,
      x = w - leg - 0.01,
      z = d - leg - 0.01,
      under = CH.height - 0.08,
      [r0, r1] = CH.rail,
      B = 0.035,
      side = x + leg + B,
      ahead = d + 0.04,
      from = -z - leg,
      y = FILIP_RING.height - B;
    box(`${name} seat`, f, [0, CH.height - 0.04, 0], [w, 0.04, d]);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) box(`${name} leg`, f, [sx * x, (under + 0.01) / 2, sz * z], [leg, (under + 0.01) / 2, leg]);
      box(`${name} back post`, f, [sx * x, (under + r1) / 2, -z - (CH.rake * (r1 - under)) / 2], [leg, (r1 - under) / 2, leg], -CH.rake);
      box(`${name} foot ring`, f, [sx * side, y, (from + ahead + B) / 2], [B, B, (ahead + B - from) / 2]);
    }
    box(`${name} back`, f, [0, (r0 + r1) / 2, -z - CH.rake * ((r0 + r1) / 2 - under)], [w, (r1 - r0) / 2, 0.035], -CH.rake);
    box(`${name} foot ring`, f, [0, y, ahead], [side - B, B, B]);
    box(`${name} foot ring`, f, [0, y, -z], [x - leg, B, B]);
  };
  /** A chair under a sitter whose root is at `seat`, on `level`. */
  const chairUnder = (name: string, seat: { x: number; z: number; facing: number }, level: number) => {
    const back = CH.setback - CH.depth / 2;
    chair(name, frame(seat.x + Math.sin(seat.facing) * back, level, seat.z + Math.cos(seat.facing) * back, seat.facing));
  };
  // The desk: its frame's origin its middle on the deck, +z away from him (the garden's deskSet).
  {
    const f = frame(site.desk.x, levels.desk, site.desk.z, site.desk.heading),
      under = D.top - D.thick,
      lx = D.width / 2 - 0.075,
      lz = D.depth / 2 - 0.075,
      L = D.laptop,
      lap = -D.depth / 2 + L.inset + L.d / 2,
      hinge = lap + L.d / 2,
      tilt = L.open - Math.PI / 2;
    box('desk top', f, [0, D.top - D.thick / 2, 0], [D.width / 2, D.thick / 2, D.depth / 2]);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) box('desk leg', f, [sx * lx, under / 2, sz * lz], [0.035, under / 2, 0.035]);
      box('desk rail', f, [sx * lx, under - 0.035, 0], [0.035, 0.035, lz - 0.035]);
    }
    box('desk rail', f, [0, under - 0.035, lz], [lx - 0.035, 0.035, 0.035]);
    box('laptop', f, [D.across, D.top + L.base / 2, lap], [L.w / 2, L.base / 2, L.d / 2]);
    // (The lid's slab stands on the hinge's near side, its screen to him, as the garden's laptopParts has it.)
    box('laptop lid', f, [D.across, D.top + L.base + (Math.cos(tilt) * L.d) / 2 + (Math.sin(tilt) * L.base) / 2, hinge + (Math.sin(tilt) * L.d) / 2 - (Math.cos(tilt) * L.base) / 2], [L.w / 2, L.d / 2, L.base / 2], tilt);
    post('desk plant', f, -D.width / 2 + 0.12, D.depth / 2 - 0.12, 0.11, D.top, D.top + 0.26);
    chairUnder('desk chair', seats.desk, levels.desk);
  }
  // The café table, his chair at it and the guest's across it.
  {
    const f = frame(site.cafe.x, levels.cafe, site.cafe.z, 0),
      h = site.cafe.heading,
      guest = CF.radius + CF.gap + CH.setback;
    post('café table top', f, 0, 0, CF.radius, CF.top - 0.08, CF.top);
    post('café table pedestal', f, 0, 0, 0.06, 0, CF.top - 0.08);
    post('café table pedestal', f, 0, 0, 0.12, CF.top - 0.11, CF.top - 0.08);
    post('café table foot', f, 0, 0, 0.2, 0, 0.05);
    chairUnder('café chair', seats.cafe, levels.cafe);
    chairUnder('guest chair', { x: site.cafe.x + Math.sin(h) * guest, z: site.cafe.z + Math.cos(h) * guest, facing: h + Math.PI }, levels.cafe);
  }
  return out;
}
/** His day on the island (FILIP_SITE). */
export const FILIP_DAY = filipDayOf(FILIP_SITE);
/** Filip at time `time` of his day on the island (FILIP_DAY.day). */
export const filipDay = FILIP_DAY.day;

/* ------------------------------------------------------------------ */
/* On the island                                                       */
/* ------------------------------------------------------------------ */
/**
 * When the town is held (Pause; under reduced motion the town starts paused) he settles where he is,
 * over `settle` seconds of the frame's own time (`reduced` under reduced motion, nearly a cut), into
 * the still pose his day gives, and comes back into his day as smoothly when it is let go.
 */
export const FILIP_HOLD = { settle: 0.8, reduced: 0.15 };
const SEATED: FilipPose[] = ['desk', 'coffee', 'sit', 'rise'];
/**
 * A shoe's half sizes (the rig's shoe, its sole flattened: figure-rig's SHOE), and the points round its
 * sole's rim (heel, toe and its two sides, `RIM` radians up from its bottom), in its own frame from its
 * middle: where a sole on a slope or over an edge meets the floor before its lowest point does.
 */
const SHOE_R: V3 = [0.058, 0.0352, 0.09],
  RIM = 1.0,
  RIM_AT: V3[] = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((b): V3 => [SHOE_R[0] * Math.sin(RIM) * Math.sin(b), -SHOE_R[1] * Math.cos(RIM), SHOE_R[2] * Math.sin(RIM) * Math.cos(b)]);
const footAt = new T.Vector3(),
  rimAt = RIM_AT.map(() => new T.Vector3()),
  rimFloor = [0, 0, 0, 0];
/**
 * His root's height on the island, posed for `day` (its lift from poseFilip): seated, or getting up,
 * the floor where his root is and his lift; standing or walking, his soles on the floor drawn under
 * them. For each shoe the floor is read under the four points of its sole's rim (RIM_AT); the plane
 * through them gives the floor's slope there, and the floor is read once more under the point of the
 * sole that meets that slope first (the shoe's ellipsoid's lowest point along it); none of those five
 * points goes under the floor and the lowest rests on it. So up the ramp, over a path's edge or across
 * the lawn's dome neither sole sinks in, for ten readings of the floor a frame.
 */
export function filipHeight(j: FilipJoints, day: FilipDay, lift: number, floor: (x: number, z: number) => number) {
  if (SEATED.includes(day.pose)) return floor(day.x, day.z) + lift * S;
  const c = Math.cos(day.heading),
    s = Math.sin(day.heading),
    // A point of his root's frame (the rig's units) in the island's plan.
    wx = (p: T.Vector3) => day.x + S * (p.x * c + p.z * s),
    wz = (p: T.Vector3) => day.z + S * (-p.x * s + p.z * c);
  let y = -Infinity;
  for (const k of [0, 1] as const) {
    j.legs[k].updateMatrix();
    j.knees[k].updateMatrix();
    const m = shoeMiddle(j, k, footAt),
      e = knee0.elements,
      [a, b, d] = SHOE_R;
    // The rim's points, the floor under each, and none of them under it.
    for (let i = 0; i < 4; i++) {
      const [u, v, w] = RIM_AT[i],
        r = rimAt[i].set(m.x + e[0] * u + e[4] * v + e[8] * w, m.y + e[1] * u + e[5] * v + e[9] * w, m.z + e[2] * u + e[6] * v + e[10] * w);
      rimFloor[i] = floor(wx(r), wz(r));
      y = Math.max(y, rimFloor[i] - S * r.y);
    }
    // The floor's slope under the shoe, in his root's frame: from heel to toe and from side to side.
    const along = rimAt[0].clone().sub(rimAt[2]),
      across = rimAt[1].clone().sub(rimAt[3]),
      la = Math.hypot(along.x, along.z),
      lc = Math.hypot(across.x, across.z),
      ga = la > 1e-6 ? (rimFloor[0] - rimFloor[2]) / (S * la) : 0,
      gc = lc > 1e-6 ? (rimFloor[1] - rimFloor[3]) / (S * lc) : 0,
      // (Heel to toe and side to side are square to one another in plan whatever his gait.)
      gx = (la > 1e-6 ? (ga * along.x) / la : 0) + (lc > 1e-6 ? (gc * across.x) / lc : 0),
      gz = (la > 1e-6 ? (ga * along.z) / la : 0) + (lc > 1e-6 ? (gc * across.z) / lc : 0),
      // The shoe's point lowest along the floor's slope: its middle less M·Mᵀ·n / |Mᵀ·n| (M its axes, n the slope's normal).
      n0 = -gx,
      n2 = -gz,
      t0 = e[0] * n0 + e[1] + e[2] * n2,
      t1 = e[4] * n0 + e[5] + e[6] * n2,
      t2 = e[8] * n0 + e[9] + e[10] * n2,
      len = Math.hypot(a * t0, b * t1, d * t2),
      q0 = (a * a * t0) / len,
      q1 = (b * b * t1) / len,
      q2 = (d * d * t2) / len,
      low = footAt.set(m.x - (e[0] * q0 + e[4] * q1 + e[8] * q2), m.y - (e[1] * q0 + e[5] * q1 + e[9] * q2), m.z - (e[2] * q0 + e[6] * q1 + e[10] * q2));
    y = Math.max(y, floor(wx(low), wz(low)) - S * low.y);
  }
  return y;
}
/**
 * His update for the town's animated list (figure-rig's clock) on his day `plan`: his day posed
 * (poseFilip) and his root placed on the plan's floor (filipHeight); held, he settles into its still
 * pose.
 */
export function filipClock(body: FilipBody, plan: FilipPlan = FILIP_DAY) {
  const H = FILIP_HOLD,
    { root, joints, props } = body,
    face = filipFaceTargets(body);
  return figureClock<FilipDay>({
    day: plan.day,
    still: plan.still,
    blend: plan.blend,
    settle: (_live, cut) => (cut ? H.reduced : H.settle),
    pose: (day) => {
      // (The day's answer carries poseFilip's options by their own names.)
      const { lift, resting } = poseFilip(joints, props, day.pose, day.phase, day, face),
        y = filipHeight(joints, day, lift, plan.floor);
      root.rotation.y = day.heading;
      root.position.set(day.x, y, day.z);
      if (resting) cupAt(props, day.cup, y, plan.saucer.y);
    },
  });
}
/**
 * Filip on the tropic island, for its build (as town-sky's alison() stands Alison on hers): his
 * figure in `parent` (the island's group: its origin the island's middle, unturned), a pivot of its
 * own (`keepSeparate`, `prebatched`: the town batches it part by part, town-build's batchFigure, never
 * in a static batch), going about his day on `site` (FILIP_SITE, the island's, by default), one entry
 * in the town's animated list, posed at time 0 as built. `body` builds him (filipBody: tropic-figure-
 * look's createFilip, with its FILIP_FACE as the body's `face`, by default); the saucer it brings is
 * dropped. Night and rain change nothing, as for the town's walkers. Returns his root, his day and his
 * body.
 */
export function placeFilip(ctx: { material: Material; animated: TownContext['animated'] }, parent: T.Object3D, o: { site?: FilipSite; body?: (m: Material) => FilipBody } = {}) {
  const plan = !o.site || o.site === FILIP_SITE ? FILIP_DAY : filipDayOf(o.site),
    body = (o.body ?? filipBody)(ctx.material),
    { root } = body;
  // A saucer his body brings is never his to show (the café table carries its own): it goes, and its mesh with it.
  if (body.props.saucer) {
    body.props.saucer.removeFromParent();
    body.props.saucer.traverse((m: T.Object3D) => m instanceof T.Mesh && m.geometry.dispose());
    delete body.props.saucer;
  }
  root.name = 'filip';
  root.userData.keepSeparate = true;
  root.userData.prebatched = true;
  parent.add(root);
  const update = filipClock(body, plan);
  update(0);
  ctx.animated.push({ object: root, update });
  return { root, plan, body };
}
