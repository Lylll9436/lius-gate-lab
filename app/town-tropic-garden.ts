import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { SurfaceKind } from './city-materials';
import { blob as ball, lathe, paint, taper } from './city-people';
import { palette, hash, sstep, mix, type TownContext } from './town-shared';
import type { Kit } from './town-kit';
import { crown, mergeCrown, noise3, paintCrown, softenNormals, trunkTube, type Clump, type Look as CrownLook } from './town-nature';
import { RESIDENCE_LOOK } from './town-residence';
import { AIRPORT_LOOK } from './town-airport';
import { TEA, chairParts, fuse, placed, solidMesh, tableSet, toned, turned, turns, type ChairLook, type Part, type TableLook, type Tint } from './town-sky-garden';

/*
 * The tropic island's garden (Filip Biljecki's island, off the south shore): its planting, the round
 * entrance plaza and the outdoor furniture and props of his three stations. Nothing in the town calls
 * this module yet: the island's own module hands it its land group and SDE4's anchors.
 *
 * Every builder returns a group in a frame of its own (y 0 the ground the piece stands on, its front
 * or its lean along a stated axis) and never moves that group: whoever places it sets its position and
 * turn. tropicGarden() places the whole garden in the island's frame (origin at its middle, +x east, +z
 * south, y up from the water level the land's own ground is measured from) on the ground it is given.
 *
 * Nothing moves, so nothing is animated and Pause and reduced motion have nothing to hold. Nothing is
 * two-sided, transparent or cut out, nothing glows, and the island is evergreen: Singapore has no
 * seasons, so nothing here reads ctx.season (the town's trees take theirs in town-nature's tree(), from
 * the plan's plantingPlan(), which these trees are never part of). Every colour is on the vertices (the
 * materials are white), so each surface family batches as one mesh: foliage (the crowns, fronds, leaves
 * and shrubs, casting), the small foliage that casts nothing (the ferns, the frangipani's flowers and
 * the desk's plant),
 * bark (trunks, limbs and coconuts), timber (the oak tops, seats and rails), paint (the bronze frames,
 * the laptop, the café's saucer and the desk plant's pot), stone (the plaza's drum and steps) and the
 * plaza's paving (flush, casting nothing).
 */

/**
 * The garden's colours, each no more saturated than its palette family (TROPIC_GARDEN_FAMILY). The
 * rain tree's canopy is a darker, slightly bluer green than Glasgow's (its body tones, the lime its
 * lit tops lean to and the dark green of its underside), on grey-brown bark paling toward the limbs'
 * tips, with fern-green epiphytes; the coconut palm's frond green with yellower tips over a darker
 * underside, its trunk a grey-brown with green-brown nuts; the frangipani's pale grey bark, deep
 * green paddle leaves and cream flowers with a yellow heart; the shrubs in the hedge greens (a little
 * calmer than the hedge's own, so their blends stay inside its family), the fans a cooler, darker green; the plaza's pale and grey granite (the kerb's and the residence's gravel)
 * round a dark granite drum (the airport's rubble) with a paler top ring; the furniture's light oak
 * on dark bronze (the residence's); the laptop's aluminium, its keyboard a shade darker and its
 * screen's inner face dark; the phone's graphite; the café's china white with a warm grey band, and
 * coffee; the desk plant's pale stone pot.
 */
export const TROPIC_GARDEN_LOOK = {
  rainBody: '#6b9440',
  rainBody2: '#628b3c',
  rainLit: '#a8c25a',
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
  graphite: '#2d2b2e',
  china: palette.white,
  chinaBand: '#a59d92',
  coffee: '#5e4230',
  pot: RESIDENCE_LOOK.stone,
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
  graphite: palette.metal,
  china: palette.white,
  chinaBand: palette.kerb,
  coffee: palette.woodDark,
  pot: palette.kerb,
};
type Look = keyof typeof TROPIC_GARDEN_LOOK;
const L = TROPIC_GARDEN_LOOK;

/**
 * The rain tree (Samanea saman), big and small. The key form is the broad umbrella: a crown much
 * wider than it is tall (`radius` out from the trunk, from its level underside `under` to its flat
 * domed `top`), held on a short trunk (`trunk` its radius over the root flare) that forks low, at
 * `fork`, into `limbs` long sinuous limbs reaching out almost level into the crown's rim. `ferns`
 * epiphyte ferns sit on the limbs near the fork, as Singapore's rain trees carry them.
 */
export const RAIN_TREE = {
  big: { top: 4.2, under: 2.5, radius: 3.1, fork: 1.26, trunk: 0.24, limbs: 4, ferns: 2 },
  small: { top: 3.4, under: 2.0, radius: 2.3, fork: 1.02, trunk: 0.19, limbs: 4, ferns: 1 },
};
export type RainTreeSize = keyof typeof RAIN_TREE;
/** The rim of a rain tree's crown leaves out its clumps within this many radians of the file's bearing, so the limbs show under it there. */
export const RAIN_GAP = 0.32;
/** How many clumps a rain tree's crown has round its flat top's middle one, and in its rim ring. */
export const RAIN_CROWN: Record<RainTreeSize, { top: number; rim: number }> = { big: { top: 6, rim: 11 }, small: { top: 5, rim: 9 } };
/**
 * The coconut palm: `height` to the crown's heart (3.0 to 4.0), its trunk leaning `lean` radians out
 * (along the palm's own +x) and curving back up near the top, swollen at its foot and ringed every
 * `ring` by gentle swellings (`swell` of its radius, toned `tone` either way, never dark stripes).
 * `fronds` arching fronds about `frond` times the height long, each a closed keeled solid (a shallow
 * V, `keel` deep at the midrib) `width` wide at its widest, notched into `fingers` broad leaflet
 * fingers a side; `nuts` coconuts under the crown.
 */
export const PALM = { fronds: 12, frond: 0.44, width: 0.5, keel: 0.07, fingers: 6, notch: 0.1, ring: 0.22, swell: 0.07, tone: 0.04, nuts: 4 };
/**
 * The frangipani (Plumeria): a stout pale trunk `trunk` in radius up to `fork`, forking into three
 * thick blunt limbs and each of those into two (a candelabra of `tips` tips about `height` tall), a
 * rosette of `leaves` paddle leaves (`leaf` long, closed solids) at every tip and on half the tips a
 * cluster of `flowers` five-lobed flowers (`flower` across, a soft cup), all year.
 */
export const FRANGIPANI = { height: 2.0, trunk: 0.09, fork: 0.55, tips: 6, leaves: 7, leaf: 0.3, flowers: 5, flower: 0.12 };
/**
 * The round entrance plaza (SDE4's court, design 1.6): `radius` across, in rings `rings` wide each
 * from the outside in (pale and grey granite by turns, the outermost pale with a flush `kerb` a shade
 * lighter into the lawn), lying `lift` over the ground it is draped on with a `skirt` into it; at its
 * middle a low dark granite drum (`drum`: its radius, height and the width of its paler top ring); at
 * its north edge two broad shallow steps up to the podium (`step`: each riser, tread and how far the
 * nosing's pale band reaches back).
 */
export const TROPIC_PLAZA = {
  radius: 1.7,
  rings: [0.33, 0.33, 0.33, 0.33],
  kerb: 0.08,
  lift: 0.012,
  skirt: 0.07,
  drum: { r: 0.38, h: 0.08, ring: 0.08 },
  step: { rise: 0.06, tread: 0.26, nosing: 0.07 },
};
/**
 * The veranda desk: a light oak top `w` by `d`, `slab` thick, its top at the tea table's height
 * (TEA.top, so every seated solve of the sky island's figure holds), on four `leg` dark-bronze legs
 * with a `rail` under the top on its front and its ends (none on the sitter's side, where the knees
 * go). Its chair (BISTRO_CHAIR) faces it across `gap` from its back edge. A laptop (LAPTOP) stands on
 * it `inset` from the sitter's edge, and a potted plant (`plant`: the pot's radius and height, and
 * the leafy clump's radius) on its far corner.
 */
export const DESK = { w: 0.9, d: 0.5, slab: 0.07, leg: 0.07, rail: 0.07, gap: 0.02, inset: 0.01, plant: { pot: 0.065, height: 0.09, leaves: 0.11 } };
/** The chunky toy laptop: base `w` by `d`, `base` thick, its lid as large and `lid` thick, opened `open` from the base. */
export const LAPTOP = { w: 0.3, d: 0.21, base: 0.07, lid: 0.07, open: (105 * Math.PI) / 180 };
/** The phone: a rounded slab `w` by `h` by `d`. */
export const PHONE = { w: 0.075, h: 0.12, d: 0.07 };
/** The cup's axis stands this far from its handle (the cup's origin), along its +x: the sky figure's teacup's. */
export const CUP_AXIS = 0.058;
/**
 * The bistro chair (the desk's and the café's): the town's 0.44 seat in oak on a dark-bronze frame,
 * with a foot ring whose top is `ring` over the floor, where a seated figure's soles rest (the
 * residents' convention leaves soles about 0.3 off the floor at that seat).
 */
export const BISTRO_CHAIR: ChairLook = { seat: 'oak', frame: 'bronze', frameKind: 'paint', ring: 0.3 };
/**
 * The café's round bistro table: an oak top 0.34 in radius at TEA.top on one dark-bronze pedestal on
 * a round foot, two bistro chairs opposite one another, no tea set (and no parasol: the rain tree's
 * canopy is the shade).
 */
export const CAFE_TABLE: TableLook = {
  name: 'tropic-cafe',
  radius: 0.34,
  top: 'oak',
  pedestal: { profile: [[0, 0], [0.2, 0, 1], [0.2, 0.022, 1], [0.16, 0.046], [0.07, 0.072], [0.045, 0.1, 1], [0.04, 0.16], [0.04, TEA.top - 0.12], [0.06, TEA.top - 0.096, 1], [0.12, TEA.top - 0.08, 1], [0, TEA.top - 0.08]], look: 'bronze', kind: 'paint', sides: 16 },
  chair: BISTRO_CHAIR,
  set: false,
};
/**
 * Where the café's saucer stands on its table: `ahead` of its sitter's root (in the -x chair) and
 * `across` to his +x side, as the sky island's SKY_TEA.place sets Alison's down.
 */
export const CAFE_SAUCER = { ahead: 0.3, across: 0.03 };

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */
type V3 = [number, number, number];
const UP = new T.Vector3(0, 1, 0);
/**
 * A closed leaf solid along a midrib: the midrib's stations (`at`, its point; `along`, its unit
 * direction; `up`, the blade's own up there, square to `along`), each with the blade's half-width
 * there (`w`), how far its edges stand over the midrib (`v`: a shallow V when positive), the keel's
 * depth under the midrib (`t`) and how far the edges are carried forward along the midrib (`ahead`,
 * so a finger points toward the tip). The top face runs edge to midrib to edge; the bottom face
 * shares the edges and dips to the keel, so the solid closes along its outline and is never a
 * single sheet. Its base end is closed by a cap; a last station of no width closes the tip.
 * `colour(u, side, across)` paints it: u from base (0) to tip (1), side 1 the top face and -1 the
 * bottom, across 0 at the midrib and 1 at an edge.
 */
type Station = { at: T.Vector3; along: T.Vector3; up: T.Vector3; w: number; v: number; t: number; ahead?: number };
function bladeGeometry(stations: Station[], colour: (u: number, side: number, across: number) => T.Color) {
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
    steps = 48;
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

/* ------------------------------------------------------------------ */
/* The garden kit                                                      */
/* ------------------------------------------------------------------ */
export function createTropicGarden(ctx: TownContext, kit: Kit) {
  const { material } = ctx;
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
   * toward +z, in the tree's frame) the island's file looks from; the crown's rim clumps on that side
   * are its silhouette there and get the finer detail.
   * - The trunk: short and stout, a gentle lean, its foot spread into five shallow buttresses, grey-
   *   brown bark shading as it goes up under the crown.
   * - The limbs: each a smooth tapering tube from the fork, rising steeply, then swinging out almost
   *   level in a gentle S into a clump of the rim, paler toward its tip.
   * - The crown (town-nature's crown kit): a wide, flattened core disc that keeps the underside level,
   *   a top clump and an upper tier over it, and a lower, wider ring of rim clumps, each flattened and
   *   lumpy with florets; painted dark underneath and lime-lit on top, its normals leant toward one
   *   flat dome, so it reads as one canopy with lumps, never a cluster of balls.
   * - Ferns: small rosettes of chunky blades sitting on the limbs near the fork.
   * `userData.crown` gives the crown's middle (x, z), radius, underside and top, for the checks.
   */
  function rainTree({ size = 'big' as RainTreeSize, seed = 1, facing = 0 } = {}) {
    const S = RAIN_TREE[size],
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
      ends: { x: number; z: number; a: number }[] = [];
    // The limbs: out along their bearings into the rim, the last one turned toward the file a little less far.
    for (let k = 0; k < S.limbs; k++) {
      const a = spin + (k / S.limbs) * Math.PI * 2 + (h(10 + k) - 0.5) * 0.5,
        reach = R * (0.6 + 0.08 * h(20 + k)),
        rise = U + 0.3 * th - F,
        out = new T.Vector3(Math.cos(a), 0, Math.sin(a)),
        side = new T.Vector3(-Math.sin(a), 0, Math.cos(a)),
        wiggle = (h(30 + k) - 0.5) * 0.5 * reach * 0.35,
        points: V3[] = [
          [forkAt.x, forkAt.y - 0.05, forkAt.z],
          forkAt.clone().addScaledVector(out, 0.16 * reach).addScaledVector(UP, 0.42 * rise).addScaledVector(side, -wiggle * 0.4).toArray() as V3,
          forkAt.clone().addScaledVector(out, 0.45 * reach).addScaledVector(UP, 0.78 * rise).addScaledVector(side, wiggle).toArray() as V3,
          forkAt.clone().addScaledVector(out, 0.75 * reach).addScaledVector(UP, 0.94 * rise).addScaledVector(side, -wiggle * 0.5).toArray() as V3,
          forkAt.clone().addScaledVector(out, reach).addScaledVector(UP, rise + 0.08).toArray() as V3,
        ],
        k0 = r0 / 0.24,
        limb = tube(points, [0.13 * k0, 0.11 * k0, 0.085 * k0, 0.065 * k0, 0.05 * k0], 9, 7);
      // Paler toward the tip, in the canopy's shade where it climbs into it.
      painted(limb, (p) => {
        const along = Math.min(1, Math.hypot(p.x - forkAt.x, p.z - forkAt.z) / reach);
        return between(L.rainBark, L.rainLimb, along, 0.8 * mix(1, 0.88, sstep(p.y, U - 0.3, U + 0.2)) * (0.97 + 0.06 * noise3(p.x * 5, p.y * 5 + seed, p.z * 5)));
      });
      limbs.push(limb);
      ends.push({ x: points[4][0], z: points[4][2], a });
    }
    mesh(g, merged(limbs), 'bark', 'tropic-rain-wood', ['rainBark', 'rainLimb']);
    // The crown.
    const cx = fx,
      cz = fz,
      clump = (a: number, d: number, y: number, r: number, half: number, detail: number, florets: number, n: number, extra: Partial<Clump> = {}): Clump => ({
        x: cx + Math.cos(a) * d,
        y,
        z: cz + Math.sin(a) * d,
        r,
        sy: half / r,
        detail,
        florets,
        amp: 0.16,
        seed: seed * 31 + n,
        ...extra,
      }),
      // Two plates of flattened leafy clumps: a flat top (one in the middle and a ring round it, all
      // reaching the same height) and, tucked under its edge, a wider rim ring whose underside is
      // the level U; a core disc fills the middle. Detail 3 throughout (a coarser clump, flattened,
      // shows its facets).
      tiers = RAIN_CROWN[size],
      topR = 0.3 * R,
      topHalf = 0.13 * R,
      rimR = 0.24 * R,
      rimHalf = 0.55 * rimR,
      // The rim leaves a gap toward the file (`facing`), where the limbs and the fork show under it.
      near = (a: number) => Math.abs(((((a - facing) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI),
      clumps: Clump[] = [clump(0, 0, U + 0.4 * th, 0.6 * R, 0.3 * th, 1, 6, 1), clump(0, 0, H - topHalf * 1.06, topR * 1.08, topHalf, 3, 16, 2)];
    for (let k = 0; k < tiers.top; k++) {
      const a = spin + (k / tiers.top) * Math.PI * 2 + (h(40 + k) - 0.5) * 0.3,
        r = topR * (0.95 + 0.1 * h(45 + k));
      clumps.push(clump(a, (0.42 + 0.04 * h(50 + k)) * R, H - topHalf * 1.06 - 0.06 * th * h(55 + k), r, topHalf, 3, 15, 3 + k));
    }
    for (let k = 0; k < tiers.rim; k++) {
      const a = spin + 0.3 + (k / tiers.rim) * Math.PI * 2 + (h(60 + k) - 0.5) * 0.3,
        r = rimR * (0.94 + 0.12 * h(65 + k));
      if (near(a) < RAIN_GAP) continue;
      clumps.push(clump(a, R - r * 1.04, U + rimHalf * 1.02 + 0.03 * th * (h(70 + k) - 0.5), r, rimHalf, 3, 13, 20 + k, { sag: 0.07 }));
    }
    const built = crown(clumps),
      dy = H - built.top;
    paintCrown(built.built, { tones: [L.rainBody, L.rainBody2], top: L.rainLit, under: L.rainUnder } satisfies CrownLook, U, H, new T.Vector3(cx, U + 0.4 * th, cz), seed, { floor: 0.45, valley: 0.84, lift: 0.32, crease: 0.06, inner: 0.15 });
    softenNormals(built.built, new T.Vector3(cx, U + 0.3 * th, cz), 0.32, 0.66);
    mesh(g, mergeCrown(built.built, dy), 'foliage', 'tropic-rain-crown', ['rainBody', 'rainBody2', 'rainLit', 'rainUnder']);
    // Ferns on the limbs near the fork, on their upper side.
    const ferns: T.BufferGeometry[] = [];
    for (let k = 0; k < S.ferns; k++) {
      const end = ends[k % ends.length],
        at = forkAt.clone().addScaledVector(new T.Vector3(Math.cos(end.a), 0, Math.sin(end.a)), 0.2 * R).addScaledVector(UP, 0.45 * (U + 0.3 * th - F) + 0.08 * (r0 / 0.24));
      ferns.push(fern(at, seed * 7 + k));
    }
    mesh(g, merged(ferns), 'foliage', 'tropic-rain-ferns', ['fern'], { shadow: false });
    g.userData.crown = { x: cx, z: cz, radius: R, under: U, top: H };
    return g;
  }
  /** An epiphyte fern: a rosette of six chunky arching blades, about 0.35 across, its heart at `at`. */
  function fern(at: T.Vector3, seed: number) {
    const blades: T.BufferGeometry[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + hash(seed * 5.1 + k) * 0.6,
        length = 0.17 + 0.03 * hash(seed * 2.7 + k),
        us = [0, 0.25, 0.5, 0.75, 1],
        stations = arch(at, a, 0.75, 1.2, length, us).map((s, i): Station => ({ ...s, w: 0.036 * Math.sin(Math.PI * Math.min(0.95, 0.12 + us[i] * 0.85)) + 0.004, v: 0.006, t: 0.028 * (1 - 0.6 * us[i]) + 0.004 }));
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
   * lower ones hanging; each a closed keeled solid (bladeGeometry), notched into broad fingers that
   * point toward its tip, its green yellowing toward the tip over a darker underside. A cluster of
   * coconuts hangs under the boot. `userData.crown` gives the crown's heart and its reach.
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
    // The fronds.
    const N = P.fingers,
      us = [0, 0.1, ...Array.from({ length: N }, (_, j) => [0.1 + (0.88 * j) / N + 0.02, 0.1 + (0.88 * (j + 0.72)) / N]).flat(), 1];
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
        stations = frame.map((s, i): Station => {
          const u = us[i],
            body = W * Math.sin(Math.PI * Math.min(1, 0.04 + u)) ** 0.7,
            // Notch, then finger tip, by turns along the leaflets; the base is the stalk.
            finger = i >= 2 && i < us.length - 1 ? (i % 2 === 1 ? 1 : 0) : -1,
            w = u <= 0.1 ? 0.03 * k : finger === 1 ? body : finger === 0 ? body * P.notch : 0,
            pitch = (0.88 / N) * length;
          return { ...s, w, v: 0.38 * w, t: Math.max(0.026, P.keel * (1 - 0.62 * u)), ahead: finger === 1 ? 0.62 * pitch : 0 };
        });
      fronds.push(
        bladeGeometry(stations, (u, side, across) =>
          side > 0 ? between(L.palmFrond, L.palmTip, sstep(u, 0.55, 1), tint * mix(0.86, 1.02, sstep(u, 0, 0.35)) * (1 + 0.04 * across)) : between(L.palmUnder, L.palmFrond, 0.25 * u, tint * 0.9),
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
            return { ...st, w: 0.058 * s * Math.sin(Math.PI * Math.min(0.97, 0.06 + u * 0.94)) ** 0.6 + 0.006, v: 0.008, t: 0.03 * s * (1 - 0.5 * u) + 0.004 };
          });
        leaves.push(bladeGeometry(stations, (u, side) => (side > 0 ? between(L.frangiLeaf, L.frangiLit, sstep(u, 0.2, 1) * 0.6, 0.98 + 0.06 * hash(seed + k * 3.1 + n)) : between(L.frangiLeaf, L.frangiLeaf, 0, 0.8))));
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
   * `leaves` broad leaves (closed blades) in two rings round a small leafy heart (one clump of the
   * crown kit's), the inner ones standing up and the outer ones spreading and arching over, in the
   * hedge greens (each leaf a shade of its own, lighter toward its tip and on its upper face, darker
   * underneath), so it reads as a clump of leaves, never as a ball.
   */
  function shrubGeometry({ r = 0.4, height = 0.6, seed = 1, leaves = 11 } = {}) {
    const h = (n: number) => hash(seed * 9.13 + n * 1.7),
      spin = h(1) * Math.PI * 2,
      heart = crown([{ x: 0, y: height * 0.32, z: 0, r: r * 0.42, sy: 0.85, detail: 1, florets: 6, amp: 0.1, seed: seed * 5 + 1 }]);
    paintCrown(heart.built, SHRUB_LOOK, 0, height, new T.Vector3(0, height * 0.3, 0), seed, { floor: 0.55, valley: 0.86 });
    const parts: T.BufferGeometry[] = [mergeCrown(heart.built, 0)],
      inner = Math.round(leaves * 0.38),
      outer = leaves - inner,
      us = [0, 0.2, 0.45, 0.7, 0.88, 1];
    for (let k = 0; k < leaves; k++) {
      const ring = k < inner ? 0 : 1,
        a = spin + (ring ? (k - inner + 0.5) / outer : k / inner) * Math.PI * 2 + (h(10 + k) - 0.5) * 0.4,
        // (The outer ring of a small one rises more, so no leaf lies under 0.07 deep.)
        rise = ring ? (r < 0.25 ? 0.9 : 0.55) + 0.25 * h(20 + k) : 1.05 + 0.2 * h(20 + k),
        length = (ring ? r * 1.1 : height * 0.85) * (0.9 + 0.2 * h(30 + k)),
        from = new T.Vector3(Math.cos(a) * 0.05, 0.04, Math.sin(a) * 0.05),
        tint = (0.93 + 0.12 * h(40 + k)) * (ring ? 1 : 1.04),
        body = k % 2 ? L.shrub2 : L.shrub,
        stations = arch(from, a, rise, ring ? 0.95 : 0.7, length, us).map((st, i): Station => {
          const u = us[i];
          // (A small leaf keeps the width of a 0.25 one, so none is under 0.07 across.)
          return { ...st, w: 0.17 * Math.max(length, 0.25) * Math.sin(Math.PI * Math.min(0.97, 0.05 + 0.95 * u)) ** 0.6 + 0.008, v: 0.03 * length, t: 0.035 * (1 - 0.4 * u) };
        });
      parts.push(bladeGeometry(stations, (u, side) => (side > 0 ? between(body, L.shrubLit, sstep(u, 0.25, 1) * 0.55, tint) : between(L.shrubUnder, body, 0.4, tint * 0.95))));
    }
    return merged(parts);
  }
  /**
   * A tall tropical fan (heliconia-like): `leaves` big paddle leaves on long stalks rising from a
   * small leafy clump, fanned out in one plane (the fan's own x, y), each arching out at its top; a
   * cooler, darker green than the shrubs, lighter on its upper faces. `height` is about its top.
   */
  function fanGeometry({ height = 1.0, seed = 1, leaves = 5 } = {}) {
    const h = (n: number) => hash(seed * 4.31 + n * 2.9),
      parts: T.BufferGeometry[] = [shrubGeometry({ r: 0.2, height: 0.3, seed: seed + 50, leaves: 4 })];
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
          return { ...s, w: 0.036 + 0.05 * blade, v: 0.02 * blade, t: 0.036 };
        });
      parts.push(bladeGeometry(stations, (u, side) => (side > 0 ? between(L.fan, L.fanLit, sstep(u, 0.35, 1) * 0.7, 0.96 + 0.08 * h(50 + k)) : between(L.fan, L.fan, 0, 0.78))));
    }
    return merged(parts);
  }

  /* ---------------------------------------------------------------- */
  /* The entrance plaza                                                */
  /* ---------------------------------------------------------------- */
  /**
   * The round entrance plaza (TROPIC_PLAZA), its middle on the origin, draped on `ground` (its own
   * frame's ground height at x, z) `lift` over it with a skirt into the lawn: its rings as flat strips
   * of pale and grey granite by turns (the outermost pale, with a flush kerb a shade lighter), and the
   * low dark granite drum at its middle with a paler top ring. With `steps` (the podium's front edge
   * as a z in the plaza's frame, north of its middle, and the podium's top over the plaza's middle),
   * two broad shallow steps rise across the plaza's chord there, their nosings in the pale granite.
   * The rings are paving (a ground surface, flush, casting nothing); the drum and the steps stone.
   */
  function plaza(ground: (x: number, z: number) => number, steps?: { front: number; top: number }) {
    const P = TROPIC_PLAZA,
      g = new T.Group();
    g.name = 'tropic-plaza';
    const sides = 72,
      // Ring edges from the drum out, each with its colour.
      edges: { r: number; c: string; k: number }[] = [],
      pos: number[] = [],
      col: number[] = [],
      index: number[] = [],
      base = ground(0, 0) + P.lift;
    let r = P.drum.r - 0.02;
    const radii = [...P.rings].reverse();
    radii.forEach((w, i) => {
      const pale = (radii.length - 1 - i) % 2 === 0;
      edges.push({ r, c: pale ? L.granitePale : L.graniteGrey, k: pale ? 1 : 1 });
      r += w;
    });
    edges.push({ r: P.radius - P.kerb, c: L.granitePale, k: 1.06 });
    const y = (x: number, z: number) => Math.max(ground(x, z) + P.lift, base - 0.03);
    // Each strip from one edge out to the next, its own colour; a skirt down from the outer edge.
    const strip = (r0: number, r1: number, colour: string, k: number) => {
      const c = tone.set(colour).multiplyScalar(k).clone();
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
    mesh(g, rings, 'paving', 'tropic-plaza-rings', ['granitePale', 'graniteGrey'], { shadow: false, ground: true });
    // The drum, standing on the plaza's middle.
    const D = P.drum,
      foot = y(0, 0) - 0.02,
      drum = turned(turns([[0, foot], [D.r, foot, 1], [D.r, foot + D.h + 0.02 - 0.012], [D.r - 0.012, foot + D.h + 0.02, 1], [D.r - D.ring, foot + D.h + 0.02, 1], [D.r - D.ring, foot + D.h + 0.005, 1], [0, foot + D.h + 0.005]]), 36);
    const stone: Part[] = [{ geometry: drum, tint: ((p: T.Vector3, n: T.Vector3, c: T.Color) => void c.set(n.y > 0.5 && Math.hypot(p.x, p.z) > D.r - D.ring - 0.005 ? L.drumTop : L.drum)) as Tint }];
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
    solidMesh(material, g, stone, 'stone', 'tropic-plaza-stone', ['drum', 'drumTop', 'granitePale', 'graniteGrey']);
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* Furniture and props                                               */
  /* ---------------------------------------------------------------- */
  /**
   * The chunky toy laptop (LAPTOP) as parts in its own frame: its base's bottom middle on the origin,
   * its user on its -z side (the keyboard's front edge toward -z, the hinge along its +z edge), the lid
   * opened LAPTOP.open from the base so its screen faces the user and its back faces +z. Aluminium,
   * the keyboard a shade darker field just proud of the base's top, the screen's inner face dark and
   * never lit. No logo. `keys` is the keyboard's middle on its top.
   */
  function laptopParts(): { parts: Part[]; keys: V3 } {
    const A = LAPTOP,
      hinge = placed(0, A.base, A.d / 2).multiply(new T.Matrix4().makeRotationX(-(A.open - Math.PI / 2))),
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
   * The phone, a hand prop: one rounded graphite slab (PHONE), its middle on the origin, its long side
   * along y and its face to +z, a mesh of its own (the figure shows it only between taking it out of
   * his pocket and putting it back). No logo, never lit.
   */
  function phone() {
    const g = new T.Group();
    g.name = 'tropic-phone';
    const P = PHONE;
    mesh(g, painted(new RoundedBoxGeometry(P.w, P.h, P.d, 2, 0.026).deleteAttribute('uv') as T.BufferGeometry, (_p, n) => between(L.graphite, L.graphite, 0, n.z > 0.7 ? 0.86 : 1)), 'paint', 'tropic-phone-body', ['graphite']);
    return g;
  }
  /**
   * The coffee cup, a hand prop: the sky figure's teacup (the same turned shape, CUP_AXIS from its
   * handle, which is its origin, a lug on its -x side) in plain white china with a warm grey band at
   * the rim and coffee inside. One mesh of its own.
   */
  function cup() {
    const g = new T.Group();
    g.name = 'tropic-cup';
    const ring = (p: T.Vector3) => Math.hypot(p.x - CUP_AXIS, p.z);
    const body = paint(lathe([[0, -0.037], [0.034, -0.037], [0.049, 0.014], [0.052, 0.037], [0.046, 0.039], [0.041, 0.024], [0, 0.024]], 9).translate(CUP_AXIS, 0, 0), (p) =>
        p.y < 0.0245 && p.y > 0.02 && ring(p) < 0.0415 ? L.coffee : p.y > 0.024 && ring(p) > 0.0485 ? L.chinaBand : L.china,
      ),
      lug = paint(ball([0.037, 0.037, 0.037], [0, 0, 0], 8), L.china);
    mesh(g, merged([body, lug]), 'paint', 'tropic-cup-body', ['china', 'chinaBand', 'coffee']);
    return g;
  }
  /** The saucer's parts (the sky figure's saucer: a dish 0.15 across with a well), its foot on the origin, white with a warm grey band at its rim. */
  function saucerParts(at: T.Matrix4): Part[] {
    const geometry = paint(lathe([[0, 0], [0.04, 0], [0.06, 0.03], [0.075, 0.064], [0.071, 0.07], [0.056, 0.044], [0.044, 0.036], [0, 0.036]], 9), (p) => (p.y > 0.055 && Math.hypot(p.x, p.z) > 0.066 ? L.chinaBand : L.china));
    return [{ geometry, matrix: at }];
  }
  /** The saucer on its own (the café set carries its own, batched with the table): a group with one mesh. */
  function saucer() {
    const g = new T.Group();
    g.name = 'tropic-saucer';
    solidMesh(material, g, saucerParts(new T.Matrix4()), 'paint', 'tropic-saucer-body', ['china', 'chinaBand']);
    return g;
  }
  /**
   * The café set: the round bistro table (CAFE_TABLE: an oak top on a dark-bronze pedestal, two bistro
   * chairs with foot rings, no parasol) with a saucer standing on it in front of the -x chair, toward
   * its sitter's +x hand (CAFE_SAUCER); the saucer is batched with the frame. `userData.seats` (from
   * tableSet: the sitter's root, the -x chair first, then the +x one) and `userData.saucer` (the
   * saucer's foot on the table) are in the set's frame.
   */
  function cafeSet() {
    const g = tableSet(material, chamfered, CAFE_TABLE),
      frame = g.getObjectByName(`${CAFE_TABLE.name}-frame`) as T.Mesh,
      // The sitter faces +x from the -x chair, so his +x side is the table's -z.
      at: V3 = [-(CAFE_TABLE.radius + TEA.gap + TEA.setback) + CAFE_SAUCER.ahead, TEA.top, -CAFE_SAUCER.across],
      dish = fuse(saucerParts(placed(...at)));
    const old = frame.geometry;
    frame.geometry = mergeGeometries([old, dish])!;
    old.dispose();
    dish.dispose();
    frame.userData.looks = [...frame.userData.looks, 'china', 'chinaBand'];
    g.userData.saucer = at;
    return g;
  }
  /**
   * The veranda desk set, in its own frame: the desk (DESK) on the origin, its sitter on its -z side
   * facing +z (south, out over the lawn), the bistro chair there, the laptop on the desk in front of
   * him (its screen to him, its lid's back to +z) and a small potted plant on the desk's far +x
   * corner. The desk's oak top is a mesh of its own (an overhang); the chair's oak a second; the
   * bronze frames, the laptop and the plant's pot one painted mesh; the plant foliage.
   * `userData.seat` is where the sitter's root goes (x, z and heading; his hips TEA.setback behind the
   * seat's front edge) and `userData.keys` the keyboard's middle, both in the set's frame.
   */
  function deskSet() {
    const g = new T.Group();
    g.name = 'tropic-desk';
    const D = DESK,
      top = TEA.top,
      under = top - D.slab,
      x = D.w / 2 - D.leg / 2 - 0.04,
      z = D.d / 2 - D.leg / 2 - 0.04,
      seatFront = -(D.d / 2 + D.gap),
      chairAt = placed(0, 0, seatFront - TEA.chair.d / 2),
      lap = laptopParts(),
      lapAt = new T.Vector3(-0.06, top, -D.d / 2 + D.inset + LAPTOP.d / 2),
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
    // The potted plant on the far +x corner: a pale stone pot (painted, so it batches with the frame
    // rather than as a small stone of its own) and one leafy clump.
    const Pp = D.plant,
      potAt = new T.Vector3(D.w / 2 - 0.12, top, D.d / 2 - 0.12);
    frame.push({ geometry: turned(turns([[0, 0], [Pp.pot * 0.75, 0, 1], [Pp.pot, Pp.height - 0.012], [Pp.pot + 0.008, Pp.height, 1], [Pp.pot - 0.012, Pp.height, 1], [Pp.pot - 0.014, Pp.height - 0.02, 1], [0, Pp.height - 0.02]]), 14), tint: L.pot, matrix: placed(potAt.x, potAt.y, potAt.z) });
    solidMesh(material, g, frame, 'paint', 'tropic-desk-frame', ['bronze', 'aluminium', 'keys', 'screen', 'pot']);
    solidMesh(material, g, timber, 'wood', 'tropic-desk-timber', ['oak']);
    const leaves = shrubGeometry({ r: Pp.leaves, height: 0.17, seed: 77, leaves: 7 }).translate(potAt.x, potAt.y + Pp.height - 0.03, potAt.z);
    mesh(g, leaves, 'foliage', 'tropic-desk-plant', ['shrub', 'shrub2', 'shrubLit', 'shrubUnder']);
    g.userData.seat = { x: 0, z: seatFront - TEA.setback, heading: 0 };
    g.userData.keys = [lapAt.x + lap.keys[0], lapAt.y + lap.keys[1], lapAt.z + lap.keys[2]];
    g.userData.laptop = lapAt.toArray();
    return g;
  }

  /* ---------------------------------------------------------------- */
  /* The garden, placed                                                */
  /* ---------------------------------------------------------------- */
  /**
   * The whole garden in g, in the island's frame (TROPIC_GARDEN's layout), each piece standing on
   * `site.ground` (the lawn's height at x, z): the two rain trees, the coconut palms on the beach's
   * edge leaning out to sea, the two frangipani, the shrubs and fans, the round entrance plaza (with
   * its steps up to the podium's front edge), the café set and the veranda desk set at SDE4's desk
   * anchor. What it returns says where Filip's stations are (in the island's frame): the desk's seat
   * and keys, the café's seat and saucer (and the guest chair's seat), and the call stretch's ends.
   */
  function tropicGarden(g: T.Object3D, site: TropicSite) {
    const G = TROPIC_GARDEN,
      ground = site.ground,
      stand = (piece: T.Object3D, x: number, z: number, ry = 0, y = ground(x, z)) => {
        piece.position.set(x, y, z);
        piece.rotation.y = ry;
        g.add(piece);
        return piece;
      },
      // The bearing the island's file looks from, in a piece's frame turned ry (rotation.y).
      facing = (ry: number) => Math.PI / 2 - G.file + ry;
    for (const t of G.rainTrees) stand(rainTree({ size: t.size, seed: t.seed, facing: facing(t.ry) }), t.x, t.z, t.ry, ground(t.x, t.z) - 0.04);
    G.palms.forEach((p) => stand(coconutPalm({ height: p.height, lean: p.lean, seed: p.seed }), p.x, p.z, -p.toward, ground(p.x, p.z) - 0.05));
    G.frangipani.forEach((f) => stand(frangipani({ seed: f.seed, height: f.height }), f.x, f.z, f.ry, ground(f.x, f.z) - 0.04));
    const shrubs = new T.Group();
    shrubs.name = 'tropic-shrubs';
    g.add(shrubs);
    const leafy: T.BufferGeometry[] = [];
    for (const s of G.shrubs) leafy.push(shrubGeometry({ r: s.r, height: s.height, seed: s.seed, leaves: s.leaves }).rotateY(hash(s.seed) * 6.28).translate(s.x, ground(s.x, s.z) - 0.03, s.z));
    for (const f of G.fans) leafy.push(fanGeometry({ height: f.height, seed: f.seed }).rotateY(-f.ry).translate(f.x, ground(f.x, f.z) - 0.03, f.z));
    mesh(shrubs, merged(leafy), 'foliage', 'tropic-shrubs-leaves', ['shrub', 'shrub2', 'shrubLit', 'shrubUnder', 'fan', 'fanLit']);
    // The plaza: in front of the entrance, its steps up to the podium's front edge.
    const entrance = site.entrance ?? G.entrance,
      px = entrance.x,
      pz = entrance.z + G.plaza.ahead,
      podium = site.podium;
    stand(plaza((x, z) => ground(px + x, pz + z) - ground(px, pz), podium && { front: podium.front - pz, top: podium.top - ground(px, pz) }), px, pz);
    // The café, its sitter's chair (the table's -x one) facing G.cafe.facing.
    const C = G.cafe,
      cafe = stand(cafeSet(), C.x, C.z, -C.facing, ground(C.x, C.z) - 0.03);
    // The desk on the veranda, at SDE4's anchor.
    const anchor = site.desk ?? { ...G.desk, y: ground(0, 0) + G.podium.top + G.deck },
      desk = stand(deskSet(), anchor.x, anchor.z, anchor.heading, anchor.y);
    g.updateMatrixWorld(true);
    const world = (o: T.Object3D, [x, y, z]: V3) => new T.Vector3(x, y, z).applyMatrix4(new T.Matrix4().copy(g.matrixWorld).invert().multiply(o.matrixWorld)),
      seatOf = (o: T.Object3D, s: { x: number; z: number; heading: number }) => {
        const at = world(o, [s.x, 0, s.z]);
        return { x: at.x, y: at.y, z: at.z, heading: s.heading + o.rotation.y };
      };
    return {
      desk: { seat: seatOf(desk, desk.userData.seat), keys: world(desk, desk.userData.keys).toArray(), floor: anchor.y },
      cafe: { seat: seatOf(cafe, cafe.userData.seats[0]), guest: seatOf(cafe, cafe.userData.seats[1]), saucer: world(cafe, cafe.userData.saucer).toArray(), floor: ground(C.x, C.z) },
      call: G.call.map(([x, z]) => ({ x, y: ground(x, z), z })),
    };
  }

  return { rainTree, coconutPalm, frangipani, shrubGeometry, fanGeometry, plaza, laptop, phone, cup, saucer, cafeSet, deskSet, tropicGarden };
}
export type TropicGarden = ReturnType<typeof createTropicGarden>;

/**
 * What tropicGarden needs of the island: the lawn's height at a point of the island's frame (the
 * land's own ground function, which the island's module has), and SDE4's anchors from its builder
 * when they differ from the layout's stand-ins (TROPIC_GARDEN.desk, .entrance and .podium): where the
 * veranda desk stands (its floor's height and the heading its sitter faces), the entrance's middle on
 * its front, and the podium's front edge (z) and top (y) at the plaza.
 */
export type TropicSite = {
  ground: (x: number, z: number) => number;
  desk?: { x: number; y: number; z: number; heading: number };
  entrance?: { x: number; z: number };
  podium?: { front: number; top: number };
};

/**
 * The garden's layout, in the island's frame (origin at its middle, +x east, +z south; decision 2:
 * the sand ellipse 12 by 9.5 with SDE4's 11 by 7.2 roof centred on it, its front to +z). It was
 * planned on stand-ins for what the other parts own, which the checks also read: `lawn`, the turf lip
 * as an ellipse a by b with the lawn domed `dome` over it; `building`, SDE4's roof plan (design 2.2),
 * its fin block's inner face, its veranda's plan and its columns; `podium`, its front edge and top
 * over the lawn's crown (and the veranda's deck over it); `entrance`, the door's middle; `desk`,
 * where the desk stands on the veranda (design 3.3); `paths`, the land's paths (0.56 wide); `call`,
 * the call stretch. `file` is the island's file's bearing (the gate's), whose side of each crown gets
 * the finer silhouette.
 * - Rain trees: the big one at the west end, its crown clear of the fin block, framing the building's
 *   left edge from the file; the small one on the east lawn north of the veranda, framing its right.
 * - Palms on the beach's edge (the turf lip or just past it), leaning out to sea (`toward`, the
 *   bearing they lean along), clear of the file's lines of sight to every station.
 * - Frangipani by the plaza's west side and on the south-east lawn by the veranda's ramp.
 * - Shrubs at the building's corners and either side of the plaza's steps and the ramp, along its
 *   back and at the palms' feet; fans as accents by the fin block and the veranda.
 * - The café at the edge of the plaza, in front of the fin block, its sitter facing east-south-east.
 */
export const TROPIC_GARDEN = {
  file: Math.PI / 4 - 0.18,
  lawn: { a: 10, b: 7.6, dome: 0.35 },
  building: { x0: -5.5, x1: 5.5, z0: -3.6, z1: 3.6, fin: -3.7, top: 7.3, soffit: 6.95, veranda: { x0: 2.6, x1: 5.3, z0: -2.8, z1: 3.0 }, columns: [-2.4, 0, 2.4, 4.8].flatMap((x) => [[x, -3.15], [x, 3.15]]) as [number, number][] },
  podium: { front: 2.9, top: 0.12 },
  deck: 0.04,
  entrance: { x: -2.1, z: 1.2 },
  desk: { x: 3.9, z: 0.6, heading: 0 },
  plaza: { ahead: 3.4 },
  rainTrees: [
    { size: 'big' as RainTreeSize, x: -8.95, z: 1.35, ry: 0.3, seed: 3 },
    { size: 'small' as RainTreeSize, x: 8.1, z: -1.5, ry: 1.1, seed: 5 },
  ],
  palms: [
    { x: 9.25, z: 3.45, height: 3.6, lean: 0.27, toward: 0.45, seed: 1 },
    { x: 7.25, z: 5.75, height: 3.15, lean: 0.22, toward: 0.95, seed: 2 },
    { x: 7.4, z: -5.55, height: 3.85, lean: 0.24, toward: -0.75, seed: 3 },
    { x: -5.4, z: 6.9, height: 3.35, lean: 0.26, toward: 1.95, seed: 4 },
  ],
  frangipani: [
    { x: -2.0, z: 6.5, ry: 0.4, height: 2.05, seed: 1 },
    { x: 7.3, z: 1.95, ry: 1.7, height: 1.95, seed: 2 },
  ],
  shrubs: [
    { x: -6.15, z: 4.25, r: 0.44, height: 0.72, leaves: 11, seed: 1 },
    { x: 0.25, z: 4.0, r: 0.38, height: 0.62, leaves: 11, seed: 3 },
    { x: 1.75, z: 3.95, r: 0.32, height: 0.55, leaves: 8, seed: 4 },
    { x: 3.75, z: 3.9, r: 0.32, height: 0.55, leaves: 8, seed: 11 },
    { x: 5.9, z: 3.9, r: 0.42, height: 0.68, leaves: 11, seed: 5 },
    { x: -2.6, z: -4.05, r: 0.44, height: 0.7, leaves: 11, seed: 6 },
    { x: 1.9, z: -4.05, r: 0.42, height: 0.66, leaves: 11, seed: 7 },
    { x: -6.2, z: -4.1, r: 0.4, height: 0.64, leaves: 11, seed: 8 },
    { x: 8.6, z: 4.4, r: 0.34, height: 0.5, leaves: 8, seed: 9 },
    { x: 6.65, z: -5.0, r: 0.34, height: 0.52, leaves: 8, seed: 10 },
  ],
  fans: [
    { x: -6.2, z: 2.5, height: 1.0, ry: 1.45, seed: 1 },
    { x: 5.95, z: 2.75, height: 0.95, ry: -0.3, seed: 2 },
    { x: 5.95, z: -3.0, height: 1.05, ry: 1.3, seed: 3 },
  ],
  cafe: { x: -4.7, z: 5.15, facing: Math.PI / 8 },
  paths: [
    [[-0.45, 4.95], [1.2, 5.05], [2.35, 4.6], [2.95, 3.85]],
    [[1.6, 5.0], [2.9, 5.35], [3.5, 5.3], [5.1, 5.3]],
    [[-3.4, 5.95], [-4.35, 6.2], [-5.35, 5.8]],
  ] as [number, number][][],
  call: [[3.5, 5.3], [5.1, 5.3]] as [number, number][],
};
/**
 * The stand-in lawn TROPIC_GARDEN was planned on: its height at a point of the island's frame, domed
 * `dome` over the turf lip's ellipse (0 at the lip, under it on the beach). The island's module hands
 * tropicGarden the land's real ground instead.
 */
export function tropicLawn(x: number, z: number) {
  const W = TROPIC_GARDEN.lawn,
    q = (x / W.a) ** 2 + (z / W.b) ** 2;
  return W.dome * (1 - q) * (q < 1 ? 1 : 0.3);
}
