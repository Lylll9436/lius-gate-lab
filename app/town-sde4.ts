import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SurfaceKind } from './city-materials';
import { palette, hash, sstep, type TownContext } from './town-shared';
import { RESIDENCE_LOOK } from './town-residence';
import type { WindowRole } from './town-batch';
import type { Kit } from './town-kit';
import { crown, mergeCrown, paintCrown, softenNormals, type Clump, type Nature } from './town-nature';
import type { Props } from './town-props';

/**
 * SDE4's colours, each no more saturated than its palette family (SDE4_FAMILY): white paint for
 * the roof's rim, the columns and their collars, the stair's upstand and the roof box's cap and posts
 * (the roof's membrane between the solar rows is the same paint a step deeper, by shade); the
 * residence's pale dressing stone for the slabs' white bands, the balustrades' kerbs, the planters,
 * the round concrete columns, the stair's treads, the ground floor's spandrel panels and the podium's
 * kerb and step (its kerb a step deeper); a dark warm bronze-brown for the roof's soffit and the
 * slabs' undersides (by colour, never by bake: the band of shade under every white edge); the
 * residence's toned-down champagne for the screens, their fins and the doors' pulls, matte (paint, so
 * no brass glint sweeps over it; the screens' body between the fins a step deeper); the studio's
 * light curtain-wall glass; the villa's grey-blue for the glazing's frames and bars and the
 * balustrades' rails (white uprights over glass twinkle); the residence's balustrade glass; a slate
 * grey for the solar rows; the residence's oak for the veranda's deck; its forecourt paving on the
 * podium.
 */
export const SDE4_LOOK = {
  paint: palette.white,
  band: RESIDENCE_LOOK.dressing,
  soffit: '#574d44',
  fin: RESIDENCE_LOOK.brass,
  glass: palette.studioGlass,
  bar: '#b2cbd2',
  rail: RESIDENCE_LOOK.balustrade,
  pv: '#59626c',
  deck: RESIDENCE_LOOK.timber,
  paving: RESIDENCE_LOOK.paving,
};
/** Each colour's palette family: the colour may be no more saturated than it (check-town). */
export const SDE4_FAMILY: Record<keyof typeof SDE4_LOOK, string> = {
  paint: palette.white,
  band: palette.render,
  soffit: palette.bronze,
  fin: palette.brass,
  glass: palette.glass,
  bar: palette.glass,
  rail: palette.glass,
  pv: palette.slate,
  deck: palette.wood,
  paving: palette.pavement,
};
/**
 * Shades (vertex colour, on the colour above) for the parts that are a step off their family's
 * colour: the membrane between the solar rows, the screens' body between their fins and their
 * narrow fins, the podium's kerb (the kerb's granite beside the paving), the planters, the columns'
 * pads, the round concrete columns and the stair's treads, the ground floor's solid spandrel panels,
 * and the spandrel lights under each bay's transom.
 */
export const SDE4_SHADE = { membrane: 0.86, body: 0.95, narrow: 0.95, kerb: 0.8, planter: 0.95, pad: 0.84, concrete: 0.93, panel: 0.9, spandrel: 0.84 };
/**
 * The planting's greens, painted (vertex colour) on the town's white foliage as its trees are, none
 * louder than the hedge's green (check-town). `shrubs`: three looks for the leafy clump masses, in
 * the crown paint's form (two body tones, a warm lit top, a cool dark underside): a mid hedge green,
 * a deeper cool green and a fresher yellow-green, so neighbouring shrubs never match. `fan`: the
 * heliconia fans' broad leaves, a cooler leaf green from the stalk (`base`) to the tip, their
 * backs a step toward `under`.
 */
export const SDE4_GREENS = {
  shrubs: [
    { tones: [palette.hedge, '#679632'], top: '#a9c05e', under: '#3c6a2e' },
    { tones: ['#4f7d34', '#58843a'], top: '#8fb26a', under: '#2f5530' },
    { tones: ['#7a9f34', '#84a63c'], top: '#c3cf63', under: '#4a6e2c' },
  ],
  fan: { base: '#3f7236', tip: '#6f9f45', under: '#2f5a32' },
};

/**
 * SDE4 (NUS College of Design and Engineering, after the owner's two photos), cartooned at the main
 * island's scale: a long low bar under one thin flat roof that oversails its south front as a tall
 * portico on six very slender white columns; three storeys on the town's domestic module (the
 * ground storey 1.7 floor to floor, each above 1.45), each a glazed box set back behind a terrace
 * with a glass balustrade, a planted roof terrace open under the roof over them with one small
 * glazed box on it; a champagne fluted screen at each end; the open east bay a timber veranda.
 * Measures in the building's own frame: x east, z south (the front faces +z), y 0 the podium's top,
 * the podium centred on the origin.
 * - `at`: where it stands on the island, in the island's frame (origin at the island's centre, x
 *   east, z south, y up from the sea's datum, as the airport's land): its podium's middle (x, z) and
 *   its top (y): 0.38, the land's level terrace (plan.TROPIC.pad, 0.26) and `lift`. The lawn round
 *   the podium is to stand about `lift` under its top. (The rebuild took the old plan's length off
 *   its west end and its depth off its north side, so the veranda, the desk, the ramp and the
 *   podium's south edge stand where they stood on the island.)
 * - `podium`: the low plinth everything stands on (its top y 0), its kerb's width, and its `foot`,
 *   to which the podium, its step and ramp, the screens, the columns' pads and the planters run
 *   down so a domed lawn buries their feet.
 * - `steps`: the court's step, one tread between two 0.06 risers, along the podium's front before
 *   the entrance; `ramp`: the veranda's ramp off the podium's front, a 1:6 fall of `drop`.
 * - `roof`: the floating roof, one thin plate over everything, screens and portico alike. Its plan
 *   (x0..x1, z0..z1), the underside of its dark soffit band (`soffit`), where its white rim begins
 *   (`rim`), its top (the membrane's) and its parapet's top (the edge 0.36 in all, 0.28 of it the
 *   white rim); the rim's width and plan corners' radius; the solar field's `margin` in from the
 *   rim, `rows` long rows `deep` each.
 * - `block`: the west screen, as tall as the soffit, its fins' faces flush with the roof's edge, its
 *   body inset `fin.proud` behind them; `east`: the east screen (the stack's east end, its south
 *   face behind the veranda's planters, so Filip at his desk is open to the south and the east);
 *   `fin`: the fins (a wide one and a narrow one a step deeper by turns, `pair` the pitch of the
 *   two), their depth, and the storey joints where the screens' panels meet: a `joint`-wide cut
 *   through every fin and a groove across the body at each, one band across the whole face.
 * - `columns`: radius (0.21 across: very slender, over the 0.18 under which a white shaft twinkles
 *   as the view moves), the x of each (evenly 1.28 apart, the veranda's way between two of them) and
 *   their z (the roof's front, 0.4 in, clear of every slab); `inner`: the round concrete columns
 *   standing in the open levels (the undercroft and the roof terrace), each its x, z and its foot
 *   and top (y).
 * - `west`: where the stack meets the west screen; `storeys` (floor and ceiling of G, L1 and L2),
 *   `plates` (each slab's y span and edges: front, back, east; each front 0.4 behind the one under
 *   it, so the terraces step back as they rise; the second's front steps back to `notch.front` east
 *   of `notch.x0`, the double-height bay the stair climbs) and `glass` (each storey's glass lines);
 *   `BAY`, the widest the glazing's bay may be (its bays 0.8 to 0.95 wide: the town's window, not a curtain wall).
 * - `stair`: the open straight flight from the first floor's terrace (its foot at x1) up to the
 *   second's (its head at x0), z0..z1 its width.
 * - `box`: the roof terrace's one glazed box, set back, and its cap's top.
 * - `entrance`: the lobby's vestibule under the first slab: its doors' span and line and the
 *   canopy's foot (its doors 1.1 tall, life-size to Filip); `veranda`: the open east bay's deck;
 *   `desk`, `cafe`: the anchors handed to the garden and the figure (see Sde4Build).
 */
export const SDE4 = {
  at: { x: 1.2, y: 0.38, z: -1.1 },
  lift: 0.12,
  podium: { x0: -4.7, x1: 4.7, z0: -2.8, z1: 2.8, kerb: 0.3, foot: -0.6 },
  steps: { x0: -3.3, x1: -1.8, run: 0.34, rise: 0.06 },
  ramp: { x0: 2.05, x1: 2.95, run: 0.72, drop: 0.12 },
  roof: { x0: -4.3, x1: 4.3, z0: -2.4, z1: 2.4, soffit: 6.02, rim: 6.1, top: 6.3, parapet: 6.38, width: 0.16, corner: 0.12, margin: 0.26, rows: 3, deep: 1.2 },
  block: { x0: -4.3, x1: -3.5, z0: -2.4, z1: 2.4 },
  east: { x0: 1.35, x1: 2.0, z0: -2.4, z1: 0.8 },
  fin: { pair: 0.84, w: 0.24, narrow: 0.14, proud: 0.16, corner: 0.24, joints: [1.6, 3.05, 4.5], joint: 0.07 },
  columns: { r: 0.105, x: [-3.205, -1.925, -0.645, 0.635, 1.915, 3.195], z: 2.0 },
  inner: { r: 0.12, at: [[-0.9, 1.25, 0, 1.5], [0.4, 1.25, 0, 1.5], [-2.9, 0.2, 4.6, 6.02], [1.0, 0.2, 4.6, 6.02]] as [number, number, number, number][] },
  west: -3.5,
  storeys: [[0, 1.5], [1.7, 2.95], [3.15, 4.4]] as [number, number][],
  plates: [
    { y0: 1.5, y1: 1.7, front: 1.75, back: -2.2, east: 1.35 },
    { y0: 2.95, y1: 3.15, front: 1.35, back: -2.2, east: 1.35, notch: { x0: -0.65, front: 0.6 } },
    { y0: 4.4, y1: 4.6, front: 0.95, back: -2.2, east: 1.35 },
  ] as { y0: number; y1: number; front: number; back: number; east: number; notch?: { x0: number; front: number } }[],
  glass: [
    { front: 0.8, back: -2.0, east: 1.35 },
    { front: 0.55, back: -2.0, east: 1.35 },
    { front: 0.35, back: -2.0, east: 1.35 },
  ],
  BAY: 0.95,
  stair: { x0: -0.65, x1: 1.2, z0: 0.68, z1: 1.28 },
  box: { x0: -2.0, x1: 0.4, z0: -2.0, z1: -1.0, top: 5.6, cap: 5.72 },
  entrance: { x0: -3.05, x1: -2.05, z: 1.4, top: 1.4 },
  veranda: { x0: 1.4, x1: 4.4, z0: -2.5, z1: 2.5 },
  desk: { x: 2.7, z: -0.6, heading: 0 },
  cafe: { x: -4.45, z: 4.8, heading: 1.18 },
};
/** Where SDE4 stands on the island by default (SDE4.at: see SDE4), in the island's frame. */
export const SDE4_AT = SDE4.at;
/**
 * The veranda's two planters (the building's frame, as SDE4: their troughs' plan, `top` their lip
 * over the podium) and the reach of the planting in each (its plan and its top over the podium:
 * check-town holds the built leaves inside it), with the way between them from the ramp to the
 * desk, which no leaf leans into (Filip walks it on the phone, his elbow out to his side).
 */
export const SDE4_VERANDA = {
  planters: [
    { x0: 1.5, x1: 2.06, z0: 1.05, z1: 1.65, top: 0.42, leaves: { x0: 1.72, x1: 2.0, z0: 0.84, z1: 1.86, top: 1.18 } },
    { x0: 3.05, x1: 4.1, z0: 1.05, z1: 1.65, top: 0.42, leaves: { x0: 3.09, x1: 4.2, z0: 0.9, z1: 1.88, top: 0.92 } },
  ],
  way: { x0: 2.06, x1: 3.05 },
};
/**
 * Its night: one light a bay in the 'campus' role (town-batch's WINDOW_MIX: offices, three in four
 * lit in the evening, half going out one by one between 22:30 and 01:30), each bay's spandrel and
 * vision lights one light. The lobby (its doors, transom and side lights) is the fixed 'entrance'
 * role, left on all night, so the front always has its door lit. The balustrades' glass is
 * 'clear', never lit. Roles of their own keep them out of check-town's room shares and its count
 * of night lamps.
 */
export const SDE4_WINDOWS: WindowRole = 'campus',
  SDE4_ENTRANCE: WindowRole = 'entrance',
  SDE4_RAILS: WindowRole = 'clear';

/**
 * A point the island's other builders work from, in the island's frame, and `heading`, the way one
 * faces there (as rotation.y: a bearing, looking along (sin, cos); 0 is south, +z).
 */
export type Sde4Anchor = { x: number; y: number; z: number; heading: number };
/**
 * The columns' collars, plain and modern (the real ones are plain tubes): a small collar at the
 * foot, 0.28 across and 0.10 tall, its top edge eased, and a plain disc under the soffit, 0.30
 * across and 0.07 tall, its lower edge eased: no more than a step out of the slender shaft, so
 * nothing of a classical base or capital, yet each column still reads as carrying the roof.
 */
const BASE: [number, number][] = [[0, 0], [0.14, 0], [0.14, 0.08], [0.125, 0.1], [0, 0.1]];
const CAPITAL: [number, number][] = [[0, 0], [0.135, 0], [0.15, 0.015], [0.15, 0.07], [0, 0.07]];
/** A rectangle in plan, in the island's frame. */
export type Sde4Rect = { x0: number; x1: number; z0: number; z1: number };
/** A box in the island's frame: its plan, and its foot and top (y0, y1); `name` says what it is. */
export type Sde4Box = Sde4Rect & { y0: number; y1: number; name: string };
/**
 * Where SDE4 stands and what it hands the island's other builders, all in the island's frame (the
 * group's), worked out from SDE4's measures alone (sde4Plan: the garden and the figure read it
 * without building anything; buildSde4 hands back the same, with the height it built):
 * - `desk`: the veranda desk's middle on the deck (y the deck's top), heading the way he looks
 *   from his chair behind it (south, over the lawn to the file's camera);
 * - `entrance`: the middle of the entrance doors on the floor, heading out of them;
 * - `cafe`: the café table's middle beside the court, in front of the west screen (y the lawn the
 *   podium assumes beside it: at.y - lift), heading the way he looks from his chair (east-south-east);
 * - `court`: the step's foot before the entrance, where the court's paving is to meet it (y the lawn level);
 * - `ramp`: the veranda's 1:6 ramp off the podium's front: its top on the podium's kerb and its foot
 *   on the lawn (each in the middle of its width, heading up it, north), its width and its sides (x0, x1);
 * - `deck`: the veranda's oak deck (its plan; y its top, the podium's); `podiumPlan`: the podium's;
 * - `footprint`: the plan box of everything the building stands on the ground (podium, step, ramp);
 * - `steps`: the court's step before the entrance (its plan; y its tread's top);
 * - `roof`: the roof's plan box (the building's outline seen from above), the underside of its dark
 *   soffit band and its membrane's top; `podium`, the podium's top; `lawn`, the lawn's level it
 *   assumes round the podium;
 * - `columns`: the six front columns' middles and radius, each `collar` round at its foot up to y
 *   `top` and on a square `pad` (its half width and top);
 * - `stack`: the glazed floors' plan (frames included) and the top of the top floor's roof (the roof
 *   terrace's floor), `glass` the ground floor's glazed front (z); `fin`: the west screen's plan and
 *   how far its fins stand out of its body; `screens`: both screens' plans, west and east;
 * - `keepOut`: what stands on the podium and the deck that a walker or a piece of furniture keeps
 *   clear of, as boxes: the ground floor's glazed stack, the lobby's vestibule, the two screens, the
 *   undercroft's columns, each veranda planter (its trough, then the reach of its planting over it)
 *   and the court's step;
 * - `way`: the way between the veranda's planters, from the ramp to the desk (its plan), which no leaf leans into.
 */
export type Sde4Plan = {
  desk: Sde4Anchor;
  entrance: Sde4Anchor;
  cafe: Sde4Anchor;
  court: Sde4Anchor;
  ramp: { top: Sde4Anchor; foot: Sde4Anchor; width: number; x0: number; x1: number };
  deck: Sde4Rect & { y: number };
  podiumPlan: Sde4Rect;
  footprint: Sde4Rect;
  steps: Sde4Rect & { y: number };
  roof: Sde4Rect & { soffit: number; top: number };
  podium: number;
  lawn: number;
  columns: { x: number; z: number; r: number }[];
  collar: { r: number; top: number };
  pad: { half: number; top: number };
  stack: Sde4Rect & { top: number };
  glass: number;
  fin: Sde4Rect & { proud: number };
  screens: Sde4Rect[];
  keepOut: Sde4Box[];
  way: Sde4Rect;
};
/** What buildSde4 hands back: its plan (Sde4Plan) and `height`, the top of everything as built (the solar rows' high edges, about 0.16 over the membrane). */
export type Sde4Build = Sde4Plan & { height: number };
/** SDE4's plan (Sde4Plan) standing at `at`, from its measures alone. */
export function sde4Plan(at: { x: number; y: number; z: number } = SDE4.at): Sde4Plan {
  const S = SDE4,
    P = S.podium,
    R = S.roof,
    B = S.block,
    EB = S.east,
    C = S.columns,
    G0 = S.glass[0],
    E = S.entrance,
    V = S.veranda,
    ST = S.steps,
    RA = S.ramp,
    lawn = -S.lift,
    // The frames stand this far proud of the glass (glaze's PROUD and a hair).
    frames = 0.08;
  const A = (x: number, y: number, z: number, heading: number): Sde4Anchor => ({ x: at.x + x, y: at.y + y, z: at.z + z, heading }),
    rect = (x0: number, x1: number, z0: number, z1: number): Sde4Rect => ({ x0: at.x + x0, x1: at.x + x1, z0: at.z + z0, z1: at.z + z1 }),
    box = (name: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Sde4Box => ({ name, ...rect(x0, x1, z0, z1), y0: at.y + y0, y1: at.y + y1 }),
    rampX = (RA.x0 + RA.x1) / 2,
    stepTop = P.z1 - 0.06,
    keepOut: Sde4Box[] = [
      box('glazed stack', S.west, G0.east, 0, S.plates[2].y1, G0.back - frames, G0.front + frames),
      box('lobby', E.x0 - 0.13, E.x1 + 0.13, 0, E.top + 0.1, G0.front - 0.05, E.z + 0.22),
      box('fin block', B.x0, B.x1, P.foot, R.soffit, B.z0, B.z1),
      box('east screen', EB.x0, EB.x1, P.foot, R.soffit, EB.z0, EB.z1),
    ];
  for (const [x, z, y0, y1] of S.inner.at) if (y0 === 0) keepOut.push(box('inner column', x - S.inner.r, x + S.inner.r, 0, y1, z - S.inner.r, z + S.inner.r));
  for (const t of SDE4_VERANDA.planters) {
    keepOut.push(box('veranda planter', t.x0, t.x1, P.foot, t.top, t.z0, t.z1));
    keepOut.push(box('veranda planting', t.leaves.x0, t.leaves.x1, t.top - 0.12, t.leaves.top, t.leaves.z0, t.leaves.z1));
  }
  keepOut.push(box('court step', ST.x0, ST.x1, P.foot, -ST.rise, stepTop, P.z1 + ST.run));
  return {
    desk: A(S.desk.x, 0, S.desk.z, S.desk.heading),
    entrance: A((E.x0 + E.x1) / 2, 0, E.z, 0),
    cafe: A(S.cafe.x, lawn, S.cafe.z, S.cafe.heading),
    court: A((ST.x0 + ST.x1) / 2, lawn, P.z1 + ST.run, 0),
    ramp: { top: A(rampX, 0, P.z1, Math.PI), foot: A(rampX, -RA.drop, P.z1 + RA.run, Math.PI), width: RA.x1 - RA.x0, x0: at.x + RA.x0, x1: at.x + RA.x1 },
    deck: { ...rect(V.x0, P.x1 - P.kerb + 0.01, P.z0 + P.kerb - 0.01, P.z1 - P.kerb + 0.01), y: at.y },
    podiumPlan: rect(P.x0, P.x1, P.z0, P.z1),
    footprint: rect(P.x0, P.x1, P.z0, P.z1 + Math.max(ST.run, RA.run)),
    steps: { ...rect(ST.x0, ST.x1, stepTop, P.z1 + ST.run), y: at.y - ST.rise },
    roof: { ...rect(R.x0, R.x1, R.z0, R.z1), soffit: at.y + R.soffit, top: at.y + R.top },
    podium: at.y,
    lawn: at.y + lawn,
    columns: C.x.map((x) => ({ x: at.x + x, z: at.z + C.z, r: C.r })),
    collar: { r: BASE[1][0], top: at.y + 0.06 + BASE[BASE.length - 1][1] },
    pad: { half: 0.25, top: at.y + 0.06 },
    stack: { ...rect(S.west, G0.east, G0.back - frames, G0.front + frames), top: at.y + S.plates[2].y1 },
    glass: at.z + G0.front,
    fin: { ...rect(B.x0, B.x1, B.z0, B.z1), proud: S.fin.proud },
    screens: [rect(B.x0, B.x1, B.z0, B.z1), rect(EB.x0, EB.x1, EB.z0, EB.z1)],
    keepOut,
    way: rect(SDE4_VERANDA.way.x0, SDE4_VERANDA.way.x1, SDE4_VERANDA.planters[0].z0, SDE4_VERANDA.planters[0].z1),
  };
}

/* ------------------------------------------------------------------ */
/* SDE4                                                                */
/* ------------------------------------------------------------------ */
/**
 * SDE4 takes no street furniture of its own and no tree from the town's planting kit, so `_props`
 * and `_nature` go unused; they stay in the signature, which is every building factory's. Its
 * terrace planting is built here, evergreen, from leaves of its own (plants of broad or lance
 * blades, heliconia fans of paddle leaves) and a heart of leafy clumps from town-nature's crown kit
 * (the town's trees' cauliflower clumps: crown, paintCrown, softenNormals, mergeCrown).
 */
export function createSde4(ctx: TownContext, kit: Kit, _props: Props, _nature: Nature) {
  const { material } = ctx;
  const { prism } = kit;
  const L = SDE4_LOOK,
    S = SDE4,
    SH = SDE4_SHADE,
    GR = SDE4_GREENS;

  /** A part for parts(): a shared geometry, where it goes in its mesh's space, and its shade. */
  type Part = { geometry: T.BufferGeometry; matrix: T.Matrix4; shade?: number };
  const ONE = new T.Vector3(1, 1, 1);
  const placed = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
    new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), ONE);
  const on = (g: T.Object3D | undefined, m: T.Matrix4) => (g ? g.matrix.clone().multiply(m) : m);
  /**
   * A block between two corners in g's frame (the building's without g), its edges round its +-z
   * faces chamfered by c (at most a quarter of its thinnest side): the face toward g's +z is the one
   * whose rim catches the light (a frame's front).
   */
  const block = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c = 0.02, g?: T.Object3D, shade = 1): Part => {
    const w = x1 - x0,
      h = y1 - y0,
      d = z1 - z0,
      k = Math.min(c, 0.24 * Math.min(w, h, d));
    return { geometry: prism([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], d, k, -d / 2), matrix: on(g, placed((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)), shade };
  };
  /**
   * Parts as one mesh in g's space, each a shade of its own (its `shade`, within +-tone/2 of it:
   * vertex colours the bake multiplies in), as separate panels get. It casts unless `shadow` is
   * false (a thin caster ghosts in the shadow map), and is a `band` unless told otherwise: a run of
   * fins or frames spread over a face would otherwise read to batch() as an overhang.
   */
  function parts(g: T.Object3D, list: Part[], colour: string, kind: SurfaceKind, opts: { shadow?: boolean; tone?: number; band?: boolean; name?: string } = {}) {
    if (!list.length) return undefined;
    const tone = opts.tone ?? 0,
      mid = new T.Vector3();
    const geometries = list.map(({ geometry, matrix, shade = 1 }) => {
      const p = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(matrix);
      for (const name of Object.keys(p.attributes)) if (name !== 'position' && name !== 'normal') p.deleteAttribute(name);
      p.computeBoundingBox();
      p.boundingBox!.getCenter(mid);
      const k = shade * (1 + tone * (hash(mid.x * 12.9898 + mid.y * 78.233 + mid.z * 37.719) - 0.5));
      p.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(p.getAttribute('position').count * 3).fill(k), 3));
      return p;
    });
    const m = new T.Mesh(mergeGeometries(geometries)!, material(colour, kind));
    geometries.forEach((p) => p.dispose());
    const shadow = opts.shadow ?? true;
    m.castShadow = shadow;
    m.receiveShadow = true;
    if (!shadow) m.userData.noShadow = true;
    if (opts.band ?? true) m.userData.band = true;
    if (opts.name) m.name = opts.name;
    g.add(m);
    return m;
  }
  /** Rounded boxes (the kit's Clash bevel), shared by size. */
  const roundedBoxes = new Map<string, RoundedBoxGeometry>();
  function roundedBox(w: number, h: number, d: number, r: number) {
    const key = [w, h, d, r].map((n) => n.toFixed(4)).join('|');
    let geometry = roundedBoxes.get(key);
    if (!geometry) roundedBoxes.set(key, (geometry = new RoundedBoxGeometry(w, h, d, 1, r)));
    return geometry;
  }
  /**
   * A chunky mass between two corners in g, a mesh of its own (a rounded box, so batch() gives its
   * bevels their light and its concave corners their shade): bevelled `bevel` (0.05 unless told), a
   * shade off its colour if asked. Flat and wide (0.3 tall or less, 0.5 across or more), it is an
   * overhang to batch() unless it is a `band`: what stands under its edge darkens up to it.
   */
  function solid(g: T.Object3D, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, colour: string, kind: SurfaceKind, opts: { bevel?: number; shade?: number; band?: boolean; name?: string } = {}) {
    const w = x1 - x0,
      h = y1 - y0,
      d = z1 - z0;
    const r = Math.min(opts.bevel ?? 0.05, 0.45 * Math.min(w, h, d));
    let geometry: T.BufferGeometry = r > 0 ? roundedBox(w, h, d, r) : new T.BoxGeometry(w, h, d);
    if (opts.shade !== undefined && opts.shade !== 1) {
      geometry = geometry.clone();
      geometry.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(opts.shade), 3));
    }
    const m = new T.Mesh(geometry, material(colour, kind));
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = m.receiveShadow = true;
    if (opts.band) m.userData.band = true;
    if (opts.name) m.name = opts.name;
    g.add(m);
    return m;
  }
  /** A face (x along it, y up, +z out of it) at (x, z) turned by ry, in g. */
  function faceAt(g: T.Object3D, x: number, z: number, ry: number) {
    const f = new T.Group();
    f.position.set(x, 0, z);
    f.rotation.y = ry;
    f.updateMatrix();
    g.add(f);
    return f;
  }
  /**
   * A pane of glass on g's face (+z out of it), its middle at (x, y) on the face: its own plane, so
   * batch() gives it its own glint, and its own night light (one light a `group`, in `role`).
   * `shade` deepens it (the top floor, in the parasol's shade).
   */
  function pane(g: T.Object3D, x: number, y: number, w: number, h: number, role: WindowRole, group: string, shade = 1) {
    const geometry = new T.PlaneGeometry(w, h);
    if (shade !== 1) geometry.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(shade), 3));
    const m = new T.Mesh(geometry, material(L.glass, 'glass'));
    m.position.set(x, y, 0);
    m.userData.windowGroup = group;
    m.userData.window = role;
    g.add(m);
    return m;
  }
  /**
   * A round post from (x, y0, z) up to y1 on 16 sides, and turned collars (a lathe's profile:
   * radius, height), as parts.
   */
  const columnGeometries = new Map<string, T.BufferGeometry>();
  const post = (r: number, h: number) => {
    const key = `post|${r}|${h.toFixed(4)}`;
    let g = columnGeometries.get(key);
    if (!g) columnGeometries.set(key, (g = new T.CylinderGeometry(r, r, h, 16)));
    return g;
  };
  const lathe = (name: string, profile: [number, number][]) => {
    let g = columnGeometries.get(name);
    if (!g) columnGeometries.set(name, (g = new T.LatheGeometry(profile.map(([r, y]) => new T.Vector2(r, y)), 16)));
    return g;
  };
  /**
   * A ring round a plan (x0..x1, z0..z1, its corners rounded r), `width` wide, standing from y0 to
   * y1, as one seamless solid whose every edge is chamfered c: the roof's white fascia and parapet
   * all round. (In the shape's plane y is -z.)
   */
  function ringGeometry(x0: number, x1: number, z0: number, z1: number, width: number, r: number, y0: number, y1: number, c: number) {
    const rounded = (path: T.Path, a0: number, a1: number, b0: number, b1: number, q: number) => {
      path.moveTo(a0 + q, b0);
      path.lineTo(a1 - q, b0);
      path.quadraticCurveTo(a1, b0, a1, b0 + q);
      path.lineTo(a1, b1 - q);
      path.quadraticCurveTo(a1, b1, a1 - q, b1);
      path.lineTo(a0 + q, b1);
      path.quadraticCurveTo(a0, b1, a0, b1 - q);
      path.lineTo(a0, b0 + q);
      path.quadraticCurveTo(a0, b0, a0 + q, b0);
    };
    const s = new T.Shape(),
      hole = new T.Path();
    rounded(s, x0, x1, -z1, -z0, r);
    rounded(hole, x0 + width, x1 - width, -z1 + width, -z0 - width, Math.max(0.02, r - width));
    s.holes.push(hole);
    return new T.ExtrudeGeometry(s, { depth: y1 - y0 - 2 * c, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelOffset: -c, bevelSegments: 2, curveSegments: 3 })
      .translate(0, 0, y0 + c)
      .rotateX(-Math.PI / 2);
  }
  /* ---------------------------------------------------------------- */
  /* The planting kit                                                  */
  /* ---------------------------------------------------------------- */
  /** A leaf's paint: its stalk's green (`base`), its tip's (`tip`) and the green its underside leans to (`under`). */
  type LeafLook = { base: T.Color; tip: T.Color; under: T.Color };
  const FAN: LeafLook = { base: new T.Color(GR.fan.base), tip: new T.Color(GR.fan.tip), under: new T.Color(GR.fan.under) },
    // The rosettes' blades in the shrubs' three greens: a step deeper at the foot, a little lit toward the tip.
    BLADE: LeafLook[] = GR.shrubs.map((g) => ({ base: new T.Color(g.tones[0]).multiplyScalar(0.8), tip: new T.Color(g.tones[1]).lerp(new T.Color(g.top), 0.3), under: new T.Color(g.under) })),
    LEAF_STEPS = 24;
  /** A leafy clump of the crown kit at a shrub's scale: few, deep florets (the trees' cauliflower, never a clipped ball). */
  const clump = (x: number, y: number, z: number, r: number, seed: number, sy = 0.85): Clump => ({ x, y, z, r, sy, florets: 9, amp: 0.17, detail: 2, seed });
  /** A plant for mass(): its leafy clumps and its green (an index into SDE4_GREENS.shrubs). */
  type Plant = { clumps: Clump[]; green: number };
  /**
   * Plants as one leafy geometry: their clumps' hidden insides culled across the whole mass (so
   * neighbours run into each other), then each plant painted in its own green, dark low down and
   * lit on top between y0 and y1, darker in the creases between its clumps and its florets' valleys,
   * and its normals eased toward its own round, so it reads as one soft shrub with leafy lumps.
   */
  function mass(plants: Plant[], y0: number, y1: number, seed: number) {
    const { built } = crown(plants.flatMap((p) => p.clumps));
    let k = 0;
    plants.forEach((p, i) => {
      const own = built.slice(k, (k += p.clumps.length)),
        weight = p.clumps.reduce((s, c) => s + c.r, 0),
        centre = p.clumps.reduce((v, c) => v.add(new T.Vector3(c.x, c.y, c.z).multiplyScalar(c.r / weight)), new T.Vector3());
      paintCrown(own, GR.shrubs[p.green], y0, y1, centre, seed * 13 + i, { floor: 0.55, valley: 0.8, crease: 0.24, inner: 0.2 });
      softenNormals(own, centre, 0.85, 0.3);
    });
    return compact(mergeCrown(built));
  }
  /** An indexed geometry without the vertices no triangle uses (the crown kit's culling leaves them behind). */
  function compact(g: T.BufferGeometry) {
    const index = g.getIndex()!,
      slot = new Int32Array(g.getAttribute('position').count).fill(-1),
      order: number[] = [],
      out = new T.BufferGeometry();
    for (let i = 0; i < index.count; i++) {
      const k = index.getX(i);
      if (slot[k] < 0) {
        slot[k] = order.length;
        order.push(k);
      }
    }
    for (const name of Object.keys(g.attributes)) {
      const a = g.getAttribute(name) as T.BufferAttribute,
        size = a.itemSize,
        from = a.array,
        to = new Float32Array(order.length * size);
      order.forEach((k, j) => {
        for (let c = 0; c < size; c++) to[j * size + c] = from[k * size + c];
      });
      out.setAttribute(name, new T.BufferAttribute(to, size));
    }
    out.setIndex(Array.from({ length: index.count }, (_, i) => slot[index.getX(i)]));
    g.dispose();
    return out;
  }
  /**
   * A leaf on its stalk, a closed smooth solid from its foot: the stalk 0.07 round for `stalk` of its
   * `length`, then a blade `half` its half width and 0.07 thick at the midrib, its edges lifted
   * toward its face (a shallow cup), closing to a blunt tip (a paddle) or tapering to a point
   * (`point`: a lance). Its spine leans `lean` from the vertical and arches over by `arch` more
   * toward the tip, in the upright plane along leaf space's x, which turns to (cos face, -sin face)
   * in the building's frame. A paddle's blade lies in that plane and shows its breadth to the
   * bearing `face` (its tip bowing `bow` toward it); a `flat` blade lies across the plane and shows
   * its breadth to the sky as it arches over. `ring` sides round it (6, or 4 for a small blade: a
   * keeled section). Painted from `look.base` at the stalk to `look.tip`, its underside a step
   * toward `look.under`.
   */
  function leaf(foot: T.Vector3, face: number, o: { length: number; stalk: number; half: number; lean: number; arch: number; bow?: number; flat?: boolean; point?: boolean }, look: LeafLook, ring = 6) {
    const { length, half, lean, arch } = o,
      bow = o.bow ?? 0,
      s0 = o.stalk / length,
      rest = 1 - s0,
      stations = o.flat ? [0, s0, s0 + 0.22 * rest, s0 + 0.5 * rest, s0 + 0.8 * rest, 1] : [0, s0, s0 + 0.1 * rest, s0 + 0.3 * rest, s0 + 0.52 * rest, s0 + 0.74 * rest, s0 + 0.9 * rest, 1],
      cf = Math.cos(face),
      sf = Math.sin(face),
      position: number[] = [],
      colour: number[] = [],
      index: number[] = [],
      c = new T.Color(),
      angle = (u: number) => lean + arch * u ** 1.8;
    // The spine in leaf space's upright plane (x, y), in fine steps; z, across that plane, is the bow.
    const spine: [number, number][] = [[0, 0]];
    for (let i = 1; i <= LEAF_STEPS; i++) {
      const phi = angle((i - 0.5) / LEAF_STEPS),
        [px, py] = spine[i - 1];
      spine.push([px + (length / LEAF_STEPS) * Math.sin(phi), py + (length / LEAF_STEPS) * Math.cos(phi)]);
    }
    // Leaf space to the building's frame: turned about the vertical by `face`, at the foot.
    const put = (x: number, y: number, z: number) => position.push(foot.x + x * cf + z * sf, foot.y + y, foot.z - x * sf + z * cf);
    stations.forEach((u, r) => {
      const f = u * LEAF_STEPS,
        i = Math.min(LEAF_STEPS - 1, Math.floor(f)),
        t = f - i,
        px = spine[i][0] + (spine[i + 1][0] - spine[i][0]) * t,
        py = spine[i][1] + (spine[i + 1][1] - spine[i][1]) * t,
        pz = bow * u ** 3,
        v = Math.max(0, (u - s0) / rest),
        green = (back: number) => {
          c.copy(look.base).lerp(look.tip, sstep(v, 0.05, 1)).lerp(look.under, back);
          if (u <= s0) c.multiplyScalar(0.88);
          colour.push(c.r, c.g, c.b);
        };
      if (r === stations.length - 1) {
        put(px, py, pz);
        green(0);
        return;
      }
      const w = u <= s0 ? 0.035 : Math.max(0.035, half * (o.point ? Math.sin(Math.PI * v ** 0.8) ** 0.9 : Math.sin(Math.PI * v) ** 0.6)),
        th = u <= s0 ? 0.035 : 0.035 * (1 - 0.4 * v * v),
        phi = angle(u),
        // The section's axes: across the blade (e1) and out of its face (e2); e1 x e2 runs back down the spine.
        [e1x, e1y, e1z, e2x, e2y, e2z] = o.flat ? [0, 0, 1, -Math.cos(phi), Math.sin(phi), 0] : [Math.cos(phi), -Math.sin(phi), 0, 0, 0, 1];
      for (let j = 0; j < ring; j++) {
        const q = (j / ring) * Math.PI * 2,
          across = w * Math.cos(q),
          out = th * Math.sin(q) + (u > s0 ? 0.3 * w * Math.cos(q) ** 2 : 0);
        put(px + e1x * across + e2x * out, py + e1y * across + e2y * out, pz + e1z * across + e2z * out);
        green(Math.sin(q) < -0.1 ? 0.35 : 0);
      }
    });
    // Rings joined round the spine (each band's two triangles facing out), closed at the tip; the
    // stalk's foot stays open, sunk in its planter or its plant.
    const rings = stations.length - 1,
      tip = rings * ring;
    for (let r = 0; r + 1 < rings; r++)
      for (let j = 0; j < ring; j++) {
        const a = r * ring + j,
          b = r * ring + ((j + 1) % ring);
        index.push(a, a + ring, b + ring, a, b + ring, b);
      }
    for (let j = 0; j < ring; j++) index.push((rings - 1) * ring + j, tip, (rings - 1) * ring + ((j + 1) % ring));
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(colour, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  }
  /**
   * A heliconia-like fan: `n` paddle leaves on stalks from one foot at (x, y, z), spread across its
   * face (turned to the bearing `face`), the middle ones tallest, each blade arching over to its
   * own side and its tip bowing a little forward, each turned a little out of the face so the fan
   * has depth; `size` is the middle leaf's length, `half` the blades' half width.
   */
  function fan(x: number, y: number, z: number, face: number, size: number, n: number, seed: number, half = 0.1) {
    const foot = new T.Vector3(x, y, z),
      leaves: T.BufferGeometry[] = [];
    for (let k = 0; k < n; k++) {
      const h = (i: number) => hash(seed * 5.1 + k * 2.3 + i * 0.77),
        s = n > 1 ? k / (n - 1) - 0.5 : 0,
        side = Math.sign(s) || (h(1) < 0.5 ? -1 : 1),
        length = size * (1 - 0.5 * Math.abs(s)) * (0.92 + 0.12 * h(2));
      leaves.push(leaf(foot, face + (h(3) - 0.5) * 0.6, { length, stalk: 0.4 * length, half: half * (0.9 + 0.2 * h(4)), lean: 1.15 * s + (h(5) - 0.5) * 0.12, arch: side * (0.25 + 0.9 * Math.abs(s)), bow: 0.05 + 0.08 * h(6) }, FAN));
    }
    return leaves;
  }
  /**
   * A leafy plant of blades from one foot at (x, y, z), in toy form: `n` broad leaves (a philodendron
   * or a peace lily; `point`, lance blades: a cordyline) each leaning out from the vertical about
   * `lean` and arching over about `arch` more toward its tip, so the plant is a fountain of leaves
   * with a leafy, uneven outline. The blades point all round it, or across `arc` about the bearing
   * `turn` (on a narrow balcony, away from the glass); `size` is their length, `half` their half
   * width, in the blade green `green`.
   */
  function rosette(x: number, y: number, z: number, green: number, seed: number, o: { n: number; size: number; half?: number; lean?: number; arch?: number; point?: boolean; turn?: number; arc?: number }) {
    const foot = new T.Vector3(x, y, z),
      round = o.arc === undefined,
      arc = o.arc ?? Math.PI * 2,
      leaves: T.BufferGeometry[] = [];
    for (let k = 0; k < o.n; k++) {
      const h = (i: number) => hash(seed * 4.3 + k * 1.7 + i * 0.53),
        bearing = (o.turn ?? hash(seed * 0.37) * 6.283) + (round ? (k / o.n) * arc : o.n > 1 ? (k / (o.n - 1) - 0.5) * arc : 0) + (h(1) - 0.5) * (round ? 0.6 : 0.2),
        length = o.size * (0.82 + 0.3 * h(2));
      leaves.push(leaf(foot, bearing - Math.PI / 2, { length, stalk: 0.1 * length, half: (o.half ?? 0.07) * (0.9 + 0.2 * h(5)), lean: (o.lean ?? 0.6) * (0.6 + 0.8 * h(3)), arch: (o.arch ?? 0.85) * (0.8 + 0.4 * h(4)), flat: true, point: o.point ?? false }, BLADE[green], 4));
    }
    return leaves;
  }
  /** The terraces' three kinds of leafy plant (rosette() options): broad and spreading, lance blades, broad and upright. */
  const PLANTS = [
    { n: 7, size: 0.5, half: 0.11, lean: 0.6, arch: 1.0 },
    { n: 8, size: 0.48, half: 0.075, lean: 0.45, arch: 0.8, point: true },
    { n: 7, size: 0.55, half: 0.115, lean: 0.3, arch: 1.05 },
  ];
  /**
   * Leafy plants packed along a planter (x0..x1, z0..z1, its soil at `top`), about `step` apart and
   * a little off its middle line by turns, so their leaves run together into one leafy mass with an
   * uneven top: each a kind of PLANTS by turns and a green of its own, never its neighbour's;
   * `scale` sizes them.
   */
  function bed(x0: number, x1: number, z0: number, z1: number, top: number, seed: number, o: { step: number; scale?: number }) {
    const long = x1 - x0 >= z1 - z0,
      a = long ? x0 : z0,
      b = long ? x1 : z1,
      mid = long ? (z0 + z1) / 2 : (x0 + x1) / 2,
      n = Math.max(1, Math.round((b - a) / o.step)),
      step = (b - a) / n,
      leaves: T.BufferGeometry[] = [];
    let green = Math.floor(hash(seed * 3.3) * 3);
    for (let k = 0; k < n; k++) {
      const h = (i: number) => hash(seed * 7.3 + k * 1.9 + i * 0.61),
        t = a + step * (k + 0.5) + (h(1) - 0.5) * step * 0.3,
        off = (k % 2 ? 1 : -1) * 0.05 * (0.5 + h(2)),
        kind = PLANTS[(k + Math.floor(h(3) * 2)) % 3],
        scale = (o.scale ?? 1) * (0.9 + 0.22 * h(4));
      green = (green + 1 + Math.floor(h(5) * 1.999)) % 3;
      const [x, z] = long ? [t, mid + off] : [mid + off, t];
      leaves.push(...rosette(x, top - 0.03, z, green, seed * 31 + k, { ...kind, size: kind.size * scale }));
    }
    return leaves;
  }
  /**
   * Leaves spilling over a lip or a rail toward the bearing `toward`: `n` long lance blades (`size`
   * long) from a foot at (x, y, z) inside the planting, spread a little either side of it, each
   * leaning out about `lean` and arching right over by about `arch` more, so it clears the edge
   * and its tip hangs down past it.
   */
  function spill(x: number, y: number, z: number, toward: number, green: number, seed: number, o: { n?: number; size?: number; lean?: number; arch?: number } = {}) {
    const foot = new T.Vector3(x, y, z),
      n = o.n ?? 3,
      size = o.size ?? 0.55,
      leaves: T.BufferGeometry[] = [];
    for (let k = 0; k < n; k++) {
      const h = (i: number) => hash(seed * 3.1 + k * 2.9 + i * 0.41),
        bearing = toward + (n > 1 ? (k / (n - 1) - 0.5) * (n > 2 ? 1.3 : 0.65) : 0) + (h(1) - 0.5) * 0.2;
      leaves.push(leaf(foot, bearing - Math.PI / 2, { length: size * (0.9 + 0.2 * h(2)), stalk: 0.06 * size, half: 0.06, lean: (o.lean ?? 0.85) + 0.08 * h(3), arch: (o.arch ?? 2.1) + 0.2 * h(4), flat: true, point: true }, BLADE[green], 4));
    }
    return leaves;
  }

  /**
   * SDE4 (front +z; see SDE4), in the toy language of the town's Clash look at the main island's
   * scale: few, bold parts with rich secondary and tertiary structure at the town's own sizes, and
   * calm surfaces.
   * - The roof: one thin flat plate floating over everything, its edge a white rim (fascia and
   *   parapet in one seamless chamfered ring, its plan corners rounded) over a dark soffit band set
   *   back under it, so from every side and from the town's camera above it reads as a white-edged
   *   plate with a line of shade under it; on top, inside the parapet, a membrane a step deeper than
   *   the rim and the solar field: three long continuous rows tilted to the south on dark rails.
   * - Six very slender white columns, 0.21 across, along the south front only, standing clear of
   *   the slabs from the podium to the soffit on granite pads, each with a small plain collar at its
   *   foot and a disc under the soffit; round concrete columns, 0.24 across, in the undercroft and on
   *   the roof terrace.
   * - The champagne screens at both ends, as tall as the soffit: corner piers and fluted fins (a wide
   *   one and a narrow one a step deeper by turns, their front corners chamfered) on every face the
   *   town sees, their storey panels (body and fins, each a shade of its own) meeting in a joint at
   *   every storey, one band across the face, the fins cut square there.
   * - Three glazed storeys, each a box set back behind its terrace, the slabs stepping back as they
   *   rise: each slab a white band over a dark underside set in from it (a shadow line under every
   *   band), the ground floor set back under the first slab (the undercroft); the second slab
   *   stepped back over the east third of the front, a double-height bay that the open stair climbs
   *   (a solid sloping white upstand beside stone treads). The glazing in bays 0.8 to 0.95 wide, each
   *   bay framed (uprights, sill and head 0.08), a transom over a spandrel light a step deeper, a
   *   mid-mullion halving the vision light above it (0.07 each, a hair proud, casting nothing). Glass
   *   balustrades on a pale kerb under one grey-blue top rail along every terrace edge.
   * - The roof terrace, open under the roof's tall void: one small set-back glazed box under a white
   *   cap, and a long planter along its front.
   * - The planting, evergreen: the first floor's and the roof terrace's planters along their rails,
   *   leafy plants of broad and lance blades in three greens (over a heart of leafy clumps on the
   *   roof terrace) rising over the rail, heliconia fans of paddle leaves standing out of them and
   *   leaves spilling over the rail; in the veranda's planters a heliconia fan, and a leafy bush
   *   spilling over its lip.
   * - The entrance: a shallow glazed lobby standing out of the ground floor under the first slab: a
   *   framed pair of doors (stiles, a kick rail, pulls) under a transom light and a thin white canopy,
   *   a side light to the west; its lights warm at night; a step down to the court before it. Solid
   *   spandrel panels along the ground floor's back.
   * - The veranda: the open east bay under the roof, a tall portico: a timber deck flush with the
   *   podium, two big planters at its south edge leaving the way from the ramp to the desk open, the
   *   ramp off the podium's front.
   * - The podium: a low paved plinth with a granite kerb.
   * No text, numbers or signage anywhere, and nothing that moves. Every bay is a light of its own.
   * To wire it: build into a group in the island's frame (its origin at the island's centre, y the
   * sea's datum); the building's frame stands at `at` in it. Then `batch(group, { place,
   * floor: () => the lawn's height })`, after the town's buildings; its panes carry their own roles.
   */
  function buildSde4(group: T.Group, at: { x: number; y: number; z: number } = S.at): Sde4Build {
    const frame = new T.Group();
    frame.name = 'sde4';
    frame.position.set(at.x, at.y, at.z);
    frame.updateMatrix();
    group.add(frame);
    const id = 'tropic-island-sde4',
      west = S.west,
      P = S.podium,
      R = S.roof,
      B = S.block,
      EB = S.east,
      F = S.fin;
    const white: Part[] = [], // white paint: the columns' shafts and collars, the stair's upstand, the box's cap and posts
      bands: Part[] = [], // the dressing stone: the columns' pads, the inner columns, the balustrades' kerbs, the stair's treads, the spandrel panels
      soffit: Part[] = [], // the slabs' dark undersides
      fins: Part[] = [], // the champagne fins and the doors' pulls
      bars: Part[] = [], // the glazing's frames and bars and the rails (cast nothing)
      pv: Part[] = [], // the solar rows and their rails
      deck: Part[] = [], // the veranda's boards
      greenery: T.BufferGeometry[] = []; // every shrub mass and leaf: one foliage mesh

    /* -------------------------------------------------------------- */
    /* The podium                                                     */
    /* -------------------------------------------------------------- */
    {
      const k = P.kerb,
        top = 0,
        foot = P.foot,
        V = S.veranda;
      // The granite kerb round it, chunky and bevelled, its top flush with the paving.
      solid(frame, P.x0, P.x1, foot, top, P.z1 - k, P.z1, L.band, 'stone', { bevel: 0.06, shade: SH.kerb, name: 'sde4-podium' });
      solid(frame, P.x0, P.x1, foot, top, P.z0, P.z0 + k, L.band, 'stone', { bevel: 0.06, shade: SH.kerb, name: 'sde4-podium' });
      solid(frame, P.x0, P.x0 + k, foot, top, P.z0 + k - 0.02, P.z1 - k + 0.02, L.band, 'stone', { bevel: 0.06, shade: SH.kerb, name: 'sde4-podium' });
      solid(frame, P.x1 - k, P.x1, foot, top, P.z0 + k - 0.02, P.z1 - k + 0.02, L.band, 'stone', { bevel: 0.06, shade: SH.kerb, name: 'sde4-podium' });
      // The paving inside it (a ground surface: no bake), round the veranda's deck.
      const x0 = P.x0 + k - 0.01,
        x1 = P.x1 - k + 0.01,
        z0 = P.z0 + k - 0.01,
        z1 = P.z1 - k + 0.01;
      const pave = (a: number, b: number, c: number, d: number) => {
        const m = solid(frame, a, b, foot + 0.05, top - 0.004, c, d, L.paving, 'paving', { bevel: 0.02, name: 'sde4-podium' });
        m.userData.ground = true;
      };
      pave(x0, V.x0, z0, z1);
      // East of it the deck fills the kerb's whole open east bay: oak boards running north-south,
      // flush with the paving (its top y 0), each a shade of its own (tone strips, no grooves to crawl).
      const boards = Math.round((x1 - V.x0) / 0.3),
        w = (x1 - V.x0) / boards;
      for (let i = 0; i < boards; i++) deck.push(block(V.x0 + i * w + 0.004, V.x0 + (i + 1) * w - 0.004, -0.075, 0, z0, z1, 0.012));
      // The court's step before the entrance: one tread between two risers of `rise`, its nosing
      // the podium's kerb, its foot run down for the lawn to bury.
      const ST = S.steps;
      solid(frame, ST.x0, ST.x1, foot, -ST.rise, P.z1 - 0.06, P.z1 + ST.run, L.band, 'stone', { bevel: 0.03, shade: SH.kerb, name: 'sde4-podium' });
      // The veranda's ramp: a 1:6 fall from the kerb's edge, paved, its foot at the lawn round the
      // podium (its top runs back level into the kerb, so it meets it with no lip).
      const RA = S.ramp,
        ramp = new T.Mesh(
          prism([[P.z1 - 0.06, 0], [P.z1, 0], [P.z1 + RA.run, -RA.drop], [P.z1 + RA.run, foot], [P.z1 - 0.06, foot]].map(([zz, yy]): [number, number] => [-zz, yy]), RA.x1 - RA.x0, 0.015, 0)
            .clone()
            .rotateY(Math.PI / 2),
          material(L.paving, 'paving'),
        );
      ramp.position.x = RA.x0;
      ramp.castShadow = ramp.receiveShadow = true;
      ramp.userData.ground = true;
      ramp.name = 'sde4-podium';
      frame.add(ramp);
    }

    /* -------------------------------------------------------------- */
    /* The roof                                                       */
    /* -------------------------------------------------------------- */
    {
      // The white rim: fascia and parapet as one seamless ring round the whole plate.
      const rim = new T.Mesh(ringGeometry(R.x0, R.x1, R.z0, R.z1, R.width, R.corner, R.rim, R.parapet, 0.03), material(L.paint, 'paint'));
      rim.castShadow = rim.receiveShadow = true;
      rim.userData.band = true;
      rim.name = 'sde4-roof-rim';
      frame.add(rim);
      // The roof's body inside the rim, its top the membrane (a step deeper than the rim).
      solid(frame, R.x0 + R.width - 0.03, R.x1 - R.width + 0.03, R.rim + 0.03, R.top, R.z0 + R.width - 0.03, R.z1 - R.width + 0.03, L.paint, 'paint', { bevel: 0.03, shade: SH.membrane, band: true, name: 'sde4-roof' });
      // The dark soffit band: the roof's underside, its edge set 0.02 back under the rim, so a line
      // of shade runs under the white edge seen from every side (the photos' dark soffit). An
      // overhang to batch(): the columns' heads and the screens' tops darken up into it.
      solid(frame, R.x0 + 0.02, R.x1 - 0.02, R.soffit, R.rim + 0.002, R.z0 + 0.02, R.z1 - 0.02, L.soffit, 'wood', { bevel: 0.025, name: 'sde4-soffit' });
      // The solar field: `rows` long continuous rows, each one panel the field's length, tilted 5
      // degrees to the south on a dark rail under its high (north) edge, the membrane showing
      // between them (few, long edges: nothing to crawl).
      const inner = R.width + R.margin,
        zA = R.z0 + inner,
        zB = R.z1 - inner,
        x0 = R.x0 + inner,
        x1 = R.x1 - inner,
        w = x1 - x0,
        deep = R.deep,
        gap = (zB - zA - R.rows * deep) / (R.rows - 1),
        tilt = (5 * Math.PI) / 180,
        // The panel's middle stands so its low (south) edge clears the membrane by 0.02.
        rise = 0.02 + 0.04 * Math.cos(tilt) + (deep / 2) * Math.sin(tilt);
      for (let r = 0; r < R.rows; r++) {
        const zc = zA + r * (deep + gap) + deep / 2,
          north = zc - deep / 2;
        pv.push(block(x0 + 0.1, x1 - 0.1, R.top - 0.02, R.top + rise + 0.05, north + 0.05, north + 0.17, 0.02, undefined, 0.8));
        pv.push({ geometry: prism([[-w / 2, -0.04], [w / 2, -0.04], [w / 2, 0.04], [-w / 2, 0.04]], deep, 0.02, -deep / 2), matrix: placed((x0 + x1) / 2, R.top + rise, zc, tilt, 0, 0), shade: 1 + 0.04 * (r - 1) });
      }
    }

    /* -------------------------------------------------------------- */
    /* The columns                                                    */
    /* -------------------------------------------------------------- */
    {
      const C = S.columns,
        base = lathe('base', BASE),
        capital = lathe('capital', CAPITAL),
        top = R.soffit;
      for (const x of C.x) {
        const z = C.z;
        // The granite pad (dressing stone a step deeper), its foot in the paving.
        bands.push(block(x - 0.25, x + 0.25, -0.04, 0.06, z - 0.25, z + 0.25, 0.025, undefined, SH.pad));
        white.push({ geometry: base, matrix: placed(x, 0.06, z) });
        // The shaft, from inside the collar up into the disc.
        white.push({ geometry: post(C.r, top - 0.1), matrix: placed(x, 0.08 + (top - 0.1) / 2, z) });
        white.push({ geometry: capital, matrix: placed(x, top - 0.07, z) });
      }
      // The round concrete columns standing in the open levels, from floor to slab or soffit.
      for (const [x, z, y0, y1] of S.inner.at) bands.push({ geometry: post(S.inner.r, y1 - y0), matrix: placed(x, (y0 + y1) / 2, z), shade: SH.concrete });
    }

    /* -------------------------------------------------------------- */
    /* The champagne screens                                          */
    /* -------------------------------------------------------------- */
    {
      const p = F.proud,
        c = F.corner,
        // The storeys' panels, each a shade of its own (its body and its fins alike), and the fins'
        // runs: from the podium to each storey joint and on to under the soffit.
        levels = [P.foot + 0.1, ...F.joints, R.soffit],
        tones = levels.slice(1).map((_, r) => 1 + 0.06 * (hash(r * 7.1 + 3) - 0.5)),
        runs: [number, number][] = [];
      let y = 0.1;
      for (const j of [...F.joints, R.soffit + F.joint / 2 - 0.02]) {
        runs.push([y, j - F.joint / 2]);
        y = j + F.joint / 2;
      }
      /** The fins along a run of a face (a to b): a wide one and a narrow one by turns, `pair` apart, or one alone on a short run. */
      const rhythm = (a: number, b: number) => {
        const len = b - a;
        if (len < 0.3) return [];
        if (len < 0.75 * F.pair) return [{ x: (a + b) / 2, w: len < 0.45 ? F.narrow : F.w, shade: 1 }];
        const n = Math.max(1, Math.round(len / F.pair)),
          step = len / n;
        return Array.from({ length: n }, (_, k) => a + step * (k + 0.5)).flatMap((m) => [
          { x: m - step / 4, w: F.w, shade: 1 },
          { x: m + step / 4, w: F.narrow, shade: SH.narrow },
        ]);
      };
      // A fin's plan section (w across, from 0.02 inside the body to `proud` out of it, its two
      // front corners chamfered), run straight up its storey, its ends cut square, so a joint is a
      // clean shadow line and never a lit notch.
      const upright = new T.Matrix4().makeRotationX(-Math.PI / 2), // the section's extrusion up; its y is out of the face
        section = (w: number): [number, number][] => {
          const ch = w > 0.2 ? 0.045 : 0.035;
          return [[-w / 2, 0.02], [-w / 2, ch - p], [ch - w / 2, -p], [w / 2 - ch, -p], [w / 2, ch - p], [w / 2, 0.02]];
        },
        fluted = (g: T.Object3D, a: number, b: number, only?: number) =>
          runs.forEach(([y0, y1], r) => {
            if (only !== undefined && r !== only) return;
            for (const f of rhythm(a, b)) fins.push({ geometry: prism(section(f.w), y1 - y0, 0, 0), matrix: on(g, placed(f.x, y0, 0).multiply(upright)), shade: tones[r] * f.shade });
          }),
        top = runs.length - 1,
        panels = (x0: number, x1: number, z0: number, z1: number) => {
          for (let i = 0; i + 1 < levels.length; i++) solid(frame, x0, x1, levels[i], levels[i + 1], z0, z1, L.fin, 'paint', { bevel: 0.035, shade: SH.body * tones[i], band: true, name: 'sde4-block' });
        },
        pier = (x0: number, x1: number, z0: number, z1: number) => solid(frame, x0, x1, 0.02, R.soffit - 0.005, z0, z1, L.fin, 'paint', { bevel: 0.04, band: true, name: 'sde4-block' });
      // The west screen: its body inset behind its fins on the south, west and north (its east face
      // the stack's party wall, flush), a panel a storey, their bevels meeting in a shallow groove at
      // each joint, which runs on through the fins' cuts; square piers at its west corners and
      // narrower ones at the south and north faces' east ends.
      {
        const bx0 = B.x0 + p,
          bz0 = B.z0 + p,
          bz1 = B.z1 - p;
        panels(bx0, B.x1, bz0, bz1);
        for (const s of [-1, 1]) {
          const zf = s > 0 ? B.z1 : B.z0;
          pier(B.x0, B.x0 + c, Math.min(zf, zf - s * c), Math.max(zf, zf - s * c));
          pier(B.x1 - 0.2, B.x1, Math.min(zf, zf - s * (p + 0.02)), Math.max(zf, zf - s * (p + 0.02)));
        }
        fluted(faceAt(frame, 0, bz1, 0), B.x0 + c, B.x1 - 0.2);
        const north = faceAt(frame, 0, bz0, Math.PI); // x along it runs west (-x)
        runs.forEach((_, r) => rhythm(B.x0 + c, B.x1 - 0.2).forEach((f) => fins.push({ geometry: prism(section(f.w), runs[r][1] - runs[r][0], 0, 0), matrix: on(north, placed(-f.x, runs[r][0], 0).multiply(upright)), shade: tones[r] * f.shade })));
        fluted(faceAt(frame, bx0, 0, -Math.PI / 2), B.z0 + c, B.z1 - c); // x along it runs south (+z)
        // Its east face shows over the roof terrace: fins there too, on the top storey's run.
        fluted(faceAt(frame, B.x1, 0, Math.PI / 2), -1.5, 2.1, top); // x along it runs north (-z)
      }
      // The east screen, the stack's east end beside the veranda: its body inset behind the fins on
      // the east (toward the veranda and the desk) and at its south and north faces, square piers at
      // its east corners and narrower ones at its west end; its west face flush with the stack and,
      // over the roof terrace, fluted on the top storey's run.
      {
        const bx1 = EB.x1 - p,
          bz0 = EB.z0 + p,
          bz1 = EB.z1 - p;
        panels(EB.x0, bx1, bz0, bz1);
        for (const s of [-1, 1]) {
          const zf = s > 0 ? EB.z1 : EB.z0;
          pier(EB.x1 - c, EB.x1, Math.min(zf, zf - s * c), Math.max(zf, zf - s * c));
          pier(EB.x0, EB.x0 + 0.2, Math.min(zf, zf - s * (p + 0.02)), Math.max(zf, zf - s * (p + 0.02)));
        }
        const east = faceAt(frame, bx1, 0, Math.PI / 2); // x along it runs north (-z)
        runs.forEach((_, r) => rhythm(EB.z0 + c, EB.z1 - c).forEach((f) => fins.push({ geometry: prism(section(f.w), runs[r][1] - runs[r][0], 0, 0), matrix: on(east, placed(-f.x, runs[r][0], 0).multiply(upright)), shade: tones[r] * f.shade })));
        fluted(faceAt(frame, EB.x0, 0, -Math.PI / 2), -2.1, -0.2, top); // x along it runs south (+z)
      }
    }

    /* -------------------------------------------------------------- */
    /* The slabs and their glass                                      */
    /* -------------------------------------------------------------- */
    const BAR = 0.08, // the frames' uprights, sill and head
      PROUD = 0.06,
      LIGHT = 0.07, // the transom and the mid-mullion
      LIGHT_PROUD = 0.035;
    let lights = 0;
    /**
     * One storey's glazing on a face (g: x along it, y up, +z out of it) from x a to b, y0 to y1, in
     * bays no wider than BAY, each one light (in `role`, or the one `group` given): a frame round
     * each bay (uprights, a sill and a head PROUD in front of the glass), and inside it a transom
     * `spandrel` over the sill (the spandrel light under it a step deeper, or a solid stone panel)
     * and a mid-mullion halving the vision light over it (none where the bay is narrow, or `mullion`
     * is false). A `spandrel` of 0 leaves the bay one vision light.
     */
    function glaze(g: T.Object3D, a: number, b: number, y0: number, y1: number, opts: { role?: WindowRole; group?: string; shade?: number; n?: number; spandrel?: number; solid?: boolean; mullion?: boolean } = {}) {
      const n = opts.n ?? Math.max(1, Math.ceil((b - a) / S.BAY - 1e-6)),
        w = (b - a) / n,
        role = opts.role ?? SDE4_WINDOWS,
        shade = opts.shade ?? 1,
        sp = opts.spandrel ?? 0.27,
        s0 = y0 + BAR,
        h0 = y1 - BAR,
        t0 = s0 + sp,
        t1 = sp > 0 ? t0 + LIGHT : s0,
        iw = w - BAR;
      for (let k = 0; k < n; k++) {
        const xc = a + w * (k + 0.5),
          group = opts.group ?? `${id}-${lights++}`;
        if (sp > 0) {
          if (opts.solid) bands.push(block(xc - iw / 2 - 0.01, xc + iw / 2 + 0.01, s0 - 0.01, t0 + 0.01, -0.05, 0.03, 0.015, g, SH.panel));
          else pane(g, xc, (s0 + t0) / 2, iw + 0.02, sp + 0.02, role, group, shade * SH.spandrel);
          bars.push(block(xc - iw / 2 - 0.01, xc + iw / 2 + 0.01, t0, t1, LIGHT_PROUD - LIGHT, LIGHT_PROUD, 0.015, g));
        }
        if ((opts.mullion ?? true) && iw > 0.6) {
          const half = (iw - LIGHT) / 2;
          for (const s of [-1, 1]) pane(g, xc + (s * (half + LIGHT)) / 2, (t1 + h0) / 2, half + 0.02, h0 - t1 + 0.02, role, group, shade);
          bars.push(block(xc - LIGHT / 2, xc + LIGHT / 2, t1, h0, LIGHT_PROUD - LIGHT, LIGHT_PROUD, 0.015, g));
        } else pane(g, xc, (t1 + h0) / 2, iw + 0.02, h0 - t1 + 0.02, role, group, shade);
      }
      for (let k = 0; k <= n; k++) bars.push(block(a + w * k - BAR / 2, a + w * k + BAR / 2, y0, y1, -0.02, PROUD, 0.02, g));
      bars.push(block(a - BAR / 2, b + BAR / 2, y0, s0, -0.02, PROUD, 0.02, g), block(a - BAR / 2, b + BAR / 2, h0, y1, -0.02, PROUD, 0.02, g));
    }
    S.storeys.forEach(([y0, y1], s) => {
      const G = S.glass[s],
        front = faceAt(frame, 0, G.front, 0),
        back = faceAt(frame, 0, G.back, Math.PI); // x along it runs west (-x)
      if (s === 0) {
        // The ground floor's front: the lobby, a shallow glazed vestibule standing out under the
        // first slab (set back as deep as the glass is, its doors would be hidden from the town's
        // camera under the slab's edge), a side light west of it; then the bays to the east.
        const E = S.entrance,
          lobby = { role: SDE4_ENTRANCE, group: `${id}-entrance` },
          mid = (E.x0 + E.x1) / 2,
          DOOR = 1.12, // the leaves' head over the floor: 1.1 times Filip's height, as the villa's are to Alison
          doors = faceAt(frame, 0, E.z, 0);
        glaze(front, west, E.x0, y0, y1, { ...lobby, n: 1, spandrel: 0 });
        glaze(front, E.x1, G.east, y0, y1);
        // Its two leaves (each a light of the lobby), the transom light over them, their frame: the
        // jambs and the meeting stiles, a kick rail and the transom; a pull on each meeting stile.
        for (const s2 of [-1, 1]) pane(doors, mid + (s2 * (E.x1 - E.x0)) / 4, (0.07 + DOOR) / 2, (E.x1 - E.x0) / 2 - 0.06, DOOR - 0.05, lobby.role, lobby.group);
        pane(doors, mid, (DOOR + LIGHT + E.top) / 2, E.x1 - E.x0 - 0.06, E.top - DOOR - LIGHT + 0.02, lobby.role, lobby.group);
        for (const x of [E.x0, mid, E.x1]) bars.push(block(x - (x === mid ? 0.05 : BAR / 2), x + (x === mid ? 0.05 : BAR / 2), 0, E.top, -0.02, PROUD, 0.02, doors));
        bars.push(block(E.x0, E.x1, 0, 0.09, -0.02, PROUD, 0.02, doors), block(E.x0, E.x1, DOOR, DOOR + LIGHT, -0.02, PROUD, 0.02, doors));
        for (const s2 of [-1, 1]) fins.push(block(mid + s2 * 0.09 - 0.035, mid + s2 * 0.09 + 0.035, 0.36, 0.7, PROUD, PROUD + 0.07, 0.015, doors));
        // Its sides, a light each, and the thin white canopy over it all, standing out over the doors.
        glaze(faceAt(frame, E.x0, 0, -Math.PI / 2), G.front, E.z, y0, E.top, { ...lobby, n: 1, spandrel: 0 }); // x along it runs south
        glaze(faceAt(frame, E.x1, 0, Math.PI / 2), -E.z, -G.front, y0, E.top, { ...lobby, n: 1, spandrel: 0 }); // x along it runs north
        solid(frame, E.x0 - 0.12, E.x1 + 0.12, E.top, y1 + 0.02, G.front - 0.05, E.z + 0.2, L.paint, 'paint', { bevel: 0.025, band: true, name: 'sde4-entrance' });
      } else glaze(front, west, G.east, y0, y1, { shade: s === 2 ? 0.9 : 1 });
      // The back: the same bays, the ground floor's spandrels solid panels.
      glaze(back, -G.east, -west, y0, y1, { solid: s === 0, spandrel: s === 0 ? 0.34 : 0.27 });
    });
    // The slabs: a white band (an overhang to batch(): the glass under it darkens up to it) over a
    // dark underside set 0.08 in from it, a shadow line under every band; the second stepped back
    // east of its notch.
    S.plates.forEach((p) => {
      const spans: [number, number, number][] = p.notch ? [[west - 0.05, p.notch.x0, p.front], [p.notch.x0, p.east, p.notch.front]] : [[west - 0.05, p.east, p.front]];
      for (const [x0, x1, front] of spans) {
        solid(frame, x0, x1, p.y0 + 0.06, p.y1, p.back, front, L.band, 'stone', { bevel: 0.045, name: 'sde4-plate' });
        soffit.push(block(Math.max(x0, west), x1, p.y0, p.y0 + 0.09, p.back + 0.08, front - 0.08, 0.02));
      }
    });
    // The ground floor's spandrels a step deeper under the first slab's ground glazing: no more.

    /* -------------------------------------------------------------- */
    /* The open stair                                                 */
    /* -------------------------------------------------------------- */
    {
      // One straight flight up the double-height bay, from the first floor's terrace at its foot (x1)
      // to the second's at its head (x0): stone treads on a sloping soffit, and on its open side a
      // solid sloping white upstand (its top 0.42 over the nosings), never a rail of thin bars.
      const T0 = S.plates[0].y1,
        T1 = S.plates[1].y1,
        { x0, x1, z0, z1 } = S.stair,
        n = 8,
        rise = (T1 - T0) / n,
        going = (x1 - x0) / n,
        profile: [number, number][] = [[x1, T0]];
      for (let k = 1; k <= n; k++) profile.push([x1 - (k - 1) * going, T0 + k * rise], [x1 - k * going, T0 + k * rise]);
      profile.push([x0, T1 - 0.28], [x1 - 0.3, T0]);
      bands.push({ geometry: prism(profile, z1 - z0 - 0.1, 0, 0), matrix: placed(0, 0, z0), shade: SH.concrete });
      const nose = (x: number) => T0 + ((x1 - x) / (x1 - x0)) * (T1 - T0),
        foot = x0 + (T1 - 0.32 - T0) / ((T1 - T0) / (x1 - x0));
      white.push({ geometry: prism([[x1, T0], [x1, T0 + 0.42], [x0, T1 + 0.42], [x0, nose(x0) - 0.32], [foot, T0]], 0.1, 0.02, 0), matrix: placed(0, 0, z1 - 0.1) });
    }

    /* -------------------------------------------------------------- */
    /* The roof terrace's glazed box                                  */
    /* -------------------------------------------------------------- */
    {
      const X = S.box,
        y0 = S.plates[2].y1;
      glaze(faceAt(frame, 0, X.z1, 0), X.x0, X.x1, y0, X.top, { spandrel: 0 });
      glaze(faceAt(frame, 0, X.z0, Math.PI), -X.x1, -X.x0, y0, X.top, { spandrel: 0 });
      glaze(faceAt(frame, X.x1, 0, Math.PI / 2), -X.z1, -X.z0, y0, X.top, { spandrel: 0, n: 1 });
      glaze(faceAt(frame, X.x0, 0, -Math.PI / 2), X.z0, X.z1, y0, X.top, { spandrel: 0, n: 1 });
      for (const x of [X.x0, X.x1]) for (const z of [X.z0, X.z1]) white.push(block(x - 0.07, x + 0.07, y0, X.top, z - 0.07, z + 0.07, 0.02));
      solid(frame, X.x0 - 0.12, X.x1 + 0.12, X.top, X.cap, X.z0 - 0.12, X.z1 + 0.12, L.paint, 'paint', { bevel: 0.03, band: true, name: 'sde4-box' });
    }

    /* -------------------------------------------------------------- */
    /* Terraces: balustrades and planting                             */
    /* -------------------------------------------------------------- */
    /**
     * A glass balustrade along a straight run (its plan x0..x1, z0..z1, the run's depth 0.12) on a
     * slab at y: a pale stone kerb 0.09 tall, the glass on it, one grey-blue rail on top at 0.52.
     */
    const balustrade = (x0: number, x1: number, z0: number, z1: number, y: number) => {
      const along = x1 - x0 >= z1 - z0,
        mx = (x0 + x1) / 2,
        mz = (z0 + z1) / 2;
      bands.push(block(x0, x1, y - 0.01, y + 0.09, z0, z1, 0.02));
      const m = along ? solid(frame, x0, x1, y + 0.09, y + 0.46, mz - 0.02, mz + 0.02, L.rail, 'glass', { bevel: 0 }) : solid(frame, mx - 0.02, mx + 0.02, y + 0.09, y + 0.46, z0, z1, L.rail, 'glass', { bevel: 0 });
      m.userData.window = SDE4_RAILS;
      m.userData.noShadow = true;
      m.castShadow = false;
      bars.push(along ? block(x0, x1, y + 0.45, y + 0.52, mz - 0.04, mz + 0.04, 0.02) : block(mx - 0.04, mx + 0.04, y + 0.45, y + 0.52, z0, z1, 0.02));
    };
    /** A planter trough (x0..x1, z0..z1) on a slab at y, `tall`: pale stone, its soil never shown. */
    const trough = (x0: number, x1: number, z0: number, z1: number, y: number, tall: number) =>
      solid(frame, x0, x1, y - 0.02, y + tall, z0, z1, L.band, 'stone', { bevel: 0.045, shade: SH.planter, band: true, name: 'sde4-planter' });
    {
      const [p1, p2, p3] = S.plates,
        RAIL = 0.52, // a balustrade's top over its slab
        GAP = 0.05, // a planter's face behind its rail's kerb
        K = 0.12; // a balustrade's depth
      // The first floor's terrace: its front, and its east end beyond the east screen.
      balustrade(west, p1.east, p1.front - K, p1.front, p1.y1);
      balustrade(p1.east - K, p1.east, EB.z1, p1.front - K, p1.y1);
      // The second's: its front west of the notch, and the notch's edge over the double-height bay.
      balustrade(west, p2.notch!.x0, p2.front - K, p2.front, p2.y1);
      balustrade(p2.notch!.x0, p2.east, p2.notch!.front - K, p2.notch!.front, p2.y1);
      // The roof terrace's: its front and its back.
      balustrade(west, p3.east, p3.front - K, p3.front, p3.y1);
      balustrade(west, p3.east, p3.back, p3.back + K, p3.y1);
      // The first floor's planter, along its rail west of the stair: leafy plants rising over the
      // rail under the slab over it, a fan, leaves spilling over the rail at one place.
      {
        const x0 = west + 0.15,
          x1 = -1.0,
          z1 = p1.front - K - GAP,
          z0 = z1 - 0.3,
          top = p1.y1 + RAIL - 0.08;
        trough(x0, x1, z0, z1, p1.y1, RAIL - 0.08);
        greenery.push(...bed(x0 + 0.08, x1 - 0.08, z0, z1, top, 23, { step: 0.62, scale: 0.85 }));
        greenery.push(...fan(-2.2, top - 0.04, (z0 + z1) / 2, 0.2, 0.5, 3, 61));
        greenery.push(...spill(-1.5, top - 0.02, z0 + 0.18, 0, 2, 160, { n: 2, size: 0.7, lean: 0.8, arch: 3.1 }));
      }
      // The roof terrace's planter along its front rail: leafy plants of broad and lance blades in
      // the three greens over a heart of leafy clumps, heliconia fans standing out of them, leaves
      // spilling over the rail at two places and hanging down its face. (Under the rail's top it
      // all keeps a hair behind its glass, and clear of the glazed box.)
      {
        const x0 = west + 0.15,
          x1 = p3.east - 0.15,
          z1 = p3.front - K - GAP,
          z0 = z1 - 0.34,
          top = p3.y1 + RAIL - 0.04,
          mid = (z0 + z1) / 2;
        trough(x0, x1, z0, z1, p3.y1, RAIL - 0.04);
        greenery.push(mass(Array.from({ length: 4 }, (_, k) => ({ clumps: [{ ...clump(x0 + 0.55 + k * 1.15 + (hash(k + 0.1) - 0.5) * 0.12, top + 0.02 + 0.04 * hash(k + 0.2), z0 + 0.15, 0.19 + 0.03 * hash(k + 0.3), 130 + k), florets: 9, long: 1.6, heading: 0 }], green: [1, 0, 2, 1][k] })), top - 0.05, top + 0.3, 13));
        greenery.push(...bed(x0 + 0.08, x1 - 0.08, z0, z1, top, 13, { step: 0.66 }));
        [-2.75, 0.75].forEach((x, k) => greenery.push(...fan(x, top - 0.04, mid + 0.02, (hash(k * 3.7 + 1) - 0.5) * 0.5, 0.6, 4, 71 + k)));
        for (const [x, k] of [[-1.6, 0], [-0.1, 1]]) greenery.push(...spill(x, top - 0.02, z0 + 0.22, 0, k + 1, 150 + k, { size: 0.8, lean: 0.8, arch: 3.1 }));
      }
      // The veranda's two big planters at its south edge, the way from the ramp to the desk between
      // them (Filip walks it, on the phone: no leaf leans into it, SDE4_VERANDA's `way`): a heliconia
      // fan in the west one, its paddles spread north-south along the trough; in the east one a leafy
      // bush (three leafy plants side by side, kept to its east part) spilling over its front.
      const [wp, ep] = SDE4_VERANDA.planters,
        PT = wp.top,
        zm = (wp.z0 + wp.z1) / 2;
      trough(wp.x0, wp.x1, wp.z0, wp.z1, 0, PT);
      trough(ep.x0, ep.x1, ep.z0, ep.z1, 0, PT);
      greenery.push(...fan(wp.x0 + 0.3, PT - 0.04, zm, Math.PI / 2 + 0.2, 0.84, 6, 91, 0.11));
      greenery.push(...rosette(ep.x0 + 0.43, PT - 0.03, zm, 0, 97, { n: 8, size: 0.44, half: 0.11, lean: 0.45, arch: 1.0 }));
      greenery.push(...rosette(ep.x0 + 0.67, PT - 0.03, zm - 0.13, 1, 99, { n: 7, size: 0.52, half: 0.075, lean: 0.3, arch: 0.8, point: true }));
      greenery.push(...rosette(ep.x0 + 0.85, PT - 0.03, zm, 2, 96, { n: 8, size: 0.44, half: 0.11, lean: 0.4, arch: 1.0 }));
      for (const [dx, k] of [[0.37, 0], [0.92, 1]]) greenery.push(...spill(ep.x0 + dx, PT + 0.04, zm + 0.07, 0, 1, 98 + k, { n: 2, size: 0.5 }));
    }

    parts(frame, white, L.paint, 'paint', { name: 'sde4-white' });
    parts(frame, bands, L.band, 'stone', { name: 'sde4-stone' });
    parts(frame, soffit, L.soffit, 'wood', { name: 'sde4-undersides' });
    parts(frame, fins, L.fin, 'paint', { tone: 0.03, name: 'sde4-fins' });
    parts(frame, bars, L.bar, 'paint', { shadow: false, name: 'sde4-frames' });
    parts(frame, pv, L.pv, 'paint', { name: 'sde4-solar' });
    parts(frame, deck, L.deck, 'wood', { tone: 0.08, name: 'sde4-deck' });
    // The planting: one mesh of the town's white foliage, its greens painted on.
    {
      const m = new T.Mesh(mergeGeometries(greenery)!, material('#ffffff', 'foliage'));
      greenery.forEach((g) => g.dispose());
      m.castShadow = m.receiveShadow = true;
      m.name = 'sde4-planting';
      frame.add(m);
    }

    // Its plan, in the island's frame (sde4Plan), and the height it built (the frame's own reach).
    const v = new T.Vector3(),
      m4 = new T.Matrix4();
    let top = -Infinity;
    frame.updateMatrixWorld(true);
    const toFrame = frame.matrixWorld.clone().invert();
    frame.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      const p = o.geometry.getAttribute('position');
      m4.multiplyMatrices(toFrame, o.matrixWorld);
      for (let i = 0; i < p.count; i++) top = Math.max(top, v.fromBufferAttribute(p, i).applyMatrix4(m4).y);
    });
    return { ...sde4Plan(at), height: at.y + top };
  }
  return { buildSde4 };
}
export type Sde4 = ReturnType<typeof createSde4>;
