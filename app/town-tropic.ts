import * as T from 'three';
import { LAWN_TINT, WASH_PEAK, type SurfaceKind } from './city-materials';
import * as plan from './town-plan';
import { palette, hash, noise2, WATER, type TownContext } from './town-shared';
import { SHORE_PROFILE, addTropicShallows, shoreHeight } from './town-ground';
import { boulder } from './town-sky-garden';
import { chisel } from './town-sky';
import { RESIDENCE_LOOK } from './town-residence';

/**
 * The tropic island's ground (plan.TROPIC; the island's own section of town-plan has its outline,
 * lawn, terrace, walks and shore): built in a group of its own, `tropicLand`, as the airport's is,
 * never in the land's batch. Its colours, each no more saturated than its palette family: the
 * town's own two lawn greens (the main island's and the airport deck's), the residence's pale
 * concrete for the walks with their flush kerbs, the tree walk's a shade lighter (`kerb`) and the main
 * line's the grey granite of the plaza's grey rings (`kerbMain`), and the granite of its rocks: the
 * pale warm greys of the town's kerb granite (Singapore's granite reads warm grey), none dark. (The
 * round plaza before the building's door is the garden's: town-tropic-garden.)
 */
export const TROPIC_LOOK = {
  lawn: ['#98b74a', '#aac757'],
  paving: RESIDENCE_LOOK.paving,
  kerb: '#e3dac6',
  /** The main line's kerbs: the grey granite of the plaza's grey rings (the residence's gravel). */
  kerbMain: RESIDENCE_LOOK.gravel,
  granite: ['#aaa397', '#a19b90', '#b2ab9e', '#98928a'],
};
/**
 * The grid the land's paving is cut on (town-tropic's paths): `cell` square, each cell an edge passes
 * through halved and halved again down to `fine` where the edge bends (a distance at the cell's middle
 * or an edge's middle `bend` or more off the corners' blend), so a straight edge is exact, an arc's
 * chord lies within about 3 mm of it, and the creases where a walk meets the plaza's rim or the seat
 * (where the distances' max and min fold) within about 3 cm (the kerb's inner line about 5 cm).
 */
const PAVING_GRID = { cell: 0.2, fine: 0.05, bend: 0.008 };
/**
 * The rocks on the shore: clusters of the armour's chiselled boulders (town-sky-garden's boulder,
 * town-sky's chisel) on the two rocky stretches (plan.TROPIC_ROCKY): three round the tip and along the
 * flank of the low rocky point behind the building, one on the north-west where that stretch ends, and
 * one on the knoll on the south-west, the bay's west end. Each is placed by the bearing it stands on
 * and how far out on the shore profile its middle is (`at`: 0 the turf's edge, plan.TROPIC.beach the
 * waterline), with its stones' offsets in its own frame (t along the shore, spread `spread` along it;
 * n out to sea), sizes (half sizes, unit-free: `size` scales them) and seeds. Along the rocky
 * stretches, low ledges (`ledges`: one long flat stone each, `ledge` its half sizes) lie between and
 * beyond the clusters, unevenly spaced, so the point and the knoll read as low outcrops broken into
 * blocks, not piles on sand (the point's easternmost lies where that stretch turns fully rocky: its
 * stones begin where its beach has narrowed and its surf breaks); and two lone boulders lie on the
 * sand (at the bay's east end, 1.65 east of the east bay palm's foot so its trunk does not rise out of
 * the stone, and on the tail at the hollow's south end), as the town's own beach has. The point has one mass: the outcrop at its tip (the biggest cluster, a ledge stepping out
 * into the water beside it) and two small flank clusters of the template's first `stones` stones
 * only; each cluster turns the template's layout by its seed (`turn`), so none is a copy of another.
 * Each stone is sunk a third of its height, damp-darkened below the waterline as the armour is,
 * lighter where it faces the sky; the granite a pale warm grey (the town's kerb granite's family),
 * so it stays grey at night beside the town's pebbles.
 */
export const TROPIC_ROCKS = {
  clusters: [
    { bearing: Math.PI - 0.7, at: 2.0, size: 0.6, seed: 3, stones: 3 },
    { bearing: Math.PI - 0.38, at: 2.35, size: 1.35, seed: 11 },
    { bearing: Math.PI - 0.02, at: 2.1, size: 0.5, seed: 19, stones: 3 },
    { bearing: -0.98, at: 2.15, size: 0.86, seed: 29 },
    { bearing: -2.12, at: 2.25, size: 0.8, seed: 41 },
  ] as { bearing: number; at: number; size: number; seed: number; stones?: number }[],
  spread: 1.35,
  ledges: [
    { bearing: Math.PI - 1.02, at: 1.8, size: 1.1, seed: 73 },
    { bearing: Math.PI - 0.57, at: 1.7, size: 0.92, seed: 71 },
    { bearing: Math.PI - 0.2, at: 2.55, size: 1.12, seed: 79 },
    { bearing: Math.PI + 0.62, at: 1.75, size: 0.9, seed: 89 },
    { bearing: -1.13, at: 1.8, size: 0.85, seed: 97 },
  ],
  ledge: { half: [0.62, 0.17, 0.34] as [number, number, number], cuts: [[0, 1, 0.1, 0.62]] as [number, number, number, number][] },
  lone: [
    { bearing: 0.5, at: 1.3, size: 0.42, seed: 53 },
    { bearing: 1.5, at: 1.7, size: 0.36, seed: 61 },
  ],
  stones: [
    { t: 0, n: 0, half: [0.62, 0.44, 0.52], detail: 2, cuts: [[0, 0.75, 0.66, 0.72], [0.7, 0.2, 0.68, 0.78]] },
    { t: 0.78, n: 0.28, half: [0.44, 0.3, 0.38], detail: 2, cuts: [[0.2, 0.9, 0.3, 0.78]] },
    { t: -0.72, n: 0.34, half: [0.34, 0.26, 0.32], detail: 2, cuts: [] },
    { t: 0.3, n: -0.52, half: [0.2, 0.14, 0.18], detail: 1, cuts: [] },
    { t: -0.3, n: 0.78, half: [0.16, 0.12, 0.15], detail: 1, cuts: [] },
  ] as { t: number; n: number; half: [number, number, number]; detail: number; cuts: [number, number, number, number][] }[],
  /** How far each cluster turns the template's layout about its middle (radians, either way by its seed), so no two clusters are copies. */
  turn: 0.8,
};
/**
 * The tropic island's low garden lamps (the garden builds them: town-tropic-garden's tropicLamps) and
 * their pools of light at night, in the island's frame. Every lamp stands on the lawn beside the
 * paving, `off` out from the paving's edge (its outer kerb), never on it: Filip's ways run on the
 * paving. Their places are worked out from the walks' plan (plan.TROPIC_PLAZA and TROPIC_PATHS), so
 * they follow it wherever it moves (tropicLampSpots). `pool`: the pools (tropicLampPools), as the sky
 * island's are (town-sky's SKY_POOL): out to `r` from each lamp's foot, `strength` at its middle,
 * `lift` over the lawn, laid on a grid of `cell`. (No lamp at the landing: the bay walk is short, and
 * one there stood about a unit from the mouth's pair, crowding the axis rather than marking it.)
 */
export const TROPIC_LAMPS = { off: 0.44, pool: { r: 0.9, strength: 0.38, lift: 0.006, cell: 0.26 } };
/** Where the wash's up scallop has faded out (city-materials' WASH_SHAPE.upFade[1], as town-sky's POOL_EDGE). */
const POOL_EDGE = 0.85;
/**
 * The lamps' feet in the island's frame, each named:
 * - `mouth west` and `mouth east`: a pair flanking the bay walk where it leaves the plaza, `off` out
 *   from its edges, as near the plaza as keeps their pools off its granite (the pools are laid on the
 *   land's lawn and paving only: the plaza's rim is a pool's radius from each);
 * - `cafe`: off the café terrace's outer (south-west) corner, out along the corner's diagonal;
 * - `seat`: off the seat's round where the tree walk arrives, opposite the bench, turned round the
 *   round from the walk's line toward the south (the open lawn) to the first place `off` clear of
 *   the paving.
 */
export function tropicLampSpots() {
  const W = plan.TROPIC_PATHS,
    Q = plan.TROPIC_PLAZA,
    L = TROPIC_LAMPS,
    C = W.cafe,
    side = W.bay.width / 2 + L.off,
    mouth = Q.z + Math.sqrt((Q.r + L.pool.r) ** 2 - side ** 2),
    k = C.corner + L.off,
    seat = (() => {
      const [vx, vz] = [-W.tree.ahead[0], -W.tree.ahead[1]],
        out = W.seat.r + L.off,
        // (Turning this way swings straight back down the walk, -ahead, toward +z.)
        s = Math.sign(vx) || 1;
      for (let a = 0; a <= Math.PI; a += 0.01) {
        const dx = vx * Math.cos(a) - s * vz * Math.sin(a),
          dz = s * vx * Math.sin(a) + vz * Math.cos(a),
          x = W.seat.x + dx * out,
          z = W.seat.z + dz * out;
        if (plan.tropicPaving(x, z).union >= L.off - 1e-6) return { x, z };
      }
      return { x: W.seat.x, z: W.seat.z + out };
    })();
  return [
    { name: 'mouth west', x: W.bay.x - side, z: mouth },
    { name: 'mouth east', x: W.bay.x + side, z: mouth },
    { name: 'cafe', x: C.x0 + C.corner - k * Math.SQRT1_2, z: C.z1 - C.corner + k * Math.SQRT1_2 },
    { name: 'seat', ...seat },
  ];
}
/**
 * The lamps' pools (TROPIC_LAMPS.pool) on the island's ground as tropicGround laid it, as the sky
 * island's are (town-sky's lampPools: the town's wall wash at the night's level, warm from each lamp's
 * foot out, fading to nothing at the pool's edge; nothing glows, nothing is see-through):
 * - on the paving (`paving`, the land's walks as laid, a stone surface the wash already reaches),
 *   each vertex takes the nearer lamp's wash in an aWash of its own (faded to nothing past a pool's
 *   edge): no triangle is added and by day the paving is exactly itself;
 * - on the lawn (`lawn`, as laid; its grass shader takes no wash), a mesh laid over it `lift` up, on
 *   a grid of the pool's `cell` round each lamp, each vertex where the lawn as built has it (its
 *   height, normal and colour read off the lawn's own triangle there) in the colour the lawn shows by
 *   day (the grass map's grain and the lawn tint, city-materials' LAWN_TINT), carrying the nearer
 *   lamp's wash. Under the paving and the plaza it lies hidden; off the lawn (the beach) none is laid.
 * `lamps` are the lamps' feet, world x, z. Returns the lawn's pool geometry (world space) and how many
 * of the paving's vertices took a wash.
 */
export function tropicLampPools(material: TownContext['material'], lawn: T.Mesh, paving: T.Mesh[], lamps: [number, number][]) {
  const P = TROPIC_LAMPS.pool,
    map = material('#ffffff', 'grass').map,
    image = map?.image as { data: Uint8Array; width: number; height: number } | undefined,
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
    near = (x: number, z: number) => Math.min(...lamps.map(([lx, lz]) => Math.hypot(x - lx, z - lz))),
    washAt = (d: number) => [P.strength, 0, WASH_PEAK + (POOL_EDGE - WASH_PEAK) * Math.min(1, d / P.r), -1];
  // The paving: a wash on its own vertices near a lamp.
  let washed = 0;
  for (const m of paving) {
    m.updateMatrixWorld(true);
    const p = m.geometry.getAttribute('position'),
      out = new Float32Array(p.count * 4),
      q = new T.Vector3();
    for (let i = 0; i < p.count; i++) {
      // Every vertex carries the wash (past the pool's edge it is at the edge, where it has faded
      // to nothing), so a triangle that reaches into a pool fades smoothly across, never to a peak.
      q.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      const d = near(q.x, q.z);
      out.set(washAt(d), i * 4);
      if (d < P.r) washed++;
    }
    m.geometry.setAttribute('aWash', new T.BufferAttribute(out, 4));
  }
  // The lawn as laid: its triangles near a lamp, in world space, to read heights, normals and colours off.
  lawn.updateMatrixWorld(true);
  const g = lawn.geometry,
    p = g.getAttribute('position'),
    n = g.getAttribute('normal'),
    k = g.getAttribute('color'),
    index = g.getIndex(),
    count = index ? index.count : p.count,
    id = (i: number) => (index ? index.getX(i) : i),
    reach = P.r + P.cell,
    tris: { v: number[]; a: T.Vector3; b: T.Vector3; c: T.Vector3 }[] = [];
  for (let t = 0; t < count; t += 3) {
    const v = [id(t), id(t + 1), id(t + 2)],
      [a, b, c] = v.map((i) => new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(lawn.matrixWorld)),
      x0 = Math.min(a.x, b.x, c.x),
      x1 = Math.max(a.x, b.x, c.x),
      z0 = Math.min(a.z, b.z, c.z),
      z1 = Math.max(a.z, b.z, c.z);
    if (lamps.some(([lx, lz]) => Math.hypot(Math.max(x0 - lx, 0, lx - x1), Math.max(z0 - lz, 0, lz - z1)) < reach)) tris.push({ v, a, b, c });
  }
  const normal = new T.Vector3(),
    q = new T.Vector3(),
    /** The lawn as laid at (x, z): its height, normal and day colour (null off it). */
    sample = (x: number, z: number) => {
      for (const { v, a, b, c } of tris) {
        const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z),
          u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det,
          w = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det,
          r = 1 - u - w;
        if (u < -1e-7 || w < -1e-7 || r < -1e-7) continue;
        const f = [u, w, r];
        normal.set(0, 0, 0);
        v.forEach((i, j) => normal.addScaledVector(q.fromBufferAttribute(n, i), f[j]));
        normal.transformDirection(lawn.matrixWorld);
        const tone = [0, 1, 2].map((ch) => v.reduce((sum, i, j) => sum + k.getComponent(i, ch) * f[j], 0) * grain(x, z) * LAWN_TINT[ch]);
        return { y: a.y * u + b.y * w + c.y * r, n: normal.toArray(), c: tone };
      }
      return null;
    };
  const pos: number[] = [],
    nor: number[] = [],
    col: number[] = [],
    wash: number[] = [],
    cell = P.cell,
    grid = new Map<string, (NonNullable<ReturnType<typeof sample>> & { x: number; z: number; d: number }) | null>(),
    vertex = (i: number, j: number) => {
      const key = i + ',' + j;
      if (!grid.has(key)) {
        const x = i * cell,
          z = j * cell,
          at = sample(x, z);
        grid.set(key, at && { ...at, x, z, d: near(x, z) });
      }
      return grid.get(key) ?? null;
    };
  const seen = new Set<string>();
  for (const [lx, lz] of lamps)
    for (let i = Math.floor((lx - reach) / cell); i <= Math.ceil((lx + reach) / cell); i++)
      for (let j = Math.floor((lz - reach) / cell); j <= Math.ceil((lz + reach) / cell); j++) {
        if (seen.has(i + ',' + j)) continue;
        seen.add(i + ',' + j);
        for (const tri of [[vertex(i, j), vertex(i, j + 1), vertex(i + 1, j)], [vertex(i + 1, j), vertex(i, j + 1), vertex(i + 1, j + 1)]]) {
          if (tri.some((t) => !t) || Math.min(...tri.map((t) => t!.d)) > P.r) continue;
          for (const t of tri) {
            pos.push(t!.x, t!.y + P.lift, t!.z);
            nor.push(...t!.n);
            col.push(...t!.c);
            wash.push(...washAt(t!.d));
          }
        }
      }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  geometry.setAttribute('aWash', new T.Float32BufferAttribute(wash, 4));
  return { geometry, washed };
}
/**
 * How far the tropic island's two bounds reach, as rings of `points` round its waterline (32, so a
 * ring's sides include the four axes):
 * - TROPIC_EXTENT's: a polygon round its waterline at the water's level, and over it the same as high
 *   as any of its crowns rise (`crown`: the rain trees' umbrellas and the palms' crowns, the palms
 *   leaning out over the beach, every one inside the waterline);
 * - TROPIC_SEEN's, on the sea round it as well: a ring `sea` past the waterline (its beach's shelf
 *   under the water reaches 4.31 past it along the rays, so no further from it; its shallows 3, its
 *   foam less; the stones that stand in the water a few tenths) at the water's level and again at the
 *   shelf's floor (`floor`, the shore profile's foot, seen through the water from a low camera); and
 *   its crowns' ring `crowns` past the waterline (a palm that leans further out than planned still
 *   stays inside it).
 */
export const TROPIC_REACH = { sea: 4.6, floor: SHORE_PROFILE[SHORE_PROFILE.length - 1].height, crown: 4.6, crowns: 0.7, points: 32 };
/** The building's corners at its top, over its whole footprint (TROPIC_BUILDING: the podium's plan, the roof's 8.6 by 4.8 inside it). */
const ROOF_CORNERS = (() => {
  const B = plan.TROPIC_BUILDING,
    P = plan.TROPIC;
  return [-1, 1].flatMap((sx) => [-1, 1].map((sz) => new T.Vector3(P.x + B.x + sx * B.hw, B.top, P.z + B.z + sz * B.hd)));
})();
/**
 * A polygon round the tropic island's waterline `out` past it, world x, z: TROPIC_REACH.points sides,
 * each on a line `out` beyond one that touches the waterline from outside (plan.tropicSupport), their
 * outward normals evenly round from the east (the four axes among them), clockwise seen from above;
 * its corners are where neighbouring sides meet. Everything within `out` of the waterline lies inside
 * it, whatever the coast's shape (it holds the waterline's hull, grown by `out`: over the bay and the
 * hollow it bridges the shore). At `out` nought (WATERLINE_HULL) its box is exactly the waterline's
 * (plan.TROPIC_SPAN) and its corners stand a little out.
 */
function hullRing(out: number) {
  const n = TROPIC_REACH.points,
    P = plan.TROPIC,
    step = (Math.PI * 2) / n,
    h = Array.from({ length: n }, (_, k) => plan.tropicSupport(Math.cos(k * step), Math.sin(k * step)) + out);
  return Array.from({ length: n }, (_, k) => {
    const a = k * step,
      b = (k + 1) * step,
      ha = h[k],
      hb = h[(k + 1) % n],
      det = Math.sin(step);
    return { x: P.x + (ha * Math.sin(b) - hb * Math.sin(a)) / det, z: P.z + (Math.cos(a) * hb - Math.cos(b) * ha) / det };
  });
}
const WATERLINE_HULL = hullRing(0);
/**
 * The tropic island as the camera frames it (decision 16's TROPIC_EXTENT), world points: its outline
 * at the water (WATERLINE_HULL, round its waterline: its box is the waterline's, plan.TROPIC_SPAN), the
 * tops of its trees (that ring again, TROPIC_REACH.crown up) and of its building (its corners at its
 * top, 6.9 up). Everything of the island that stands on it, at or over the water and inside its
 * waterline, lies inside these points' hull, so their box on screen holds it from any side and pitch
 * (check-town). What lies on the sea round it (its shelf under the water, its shallows, its foam, the
 * feet of the stones that stand in the water) is not in it: that is TROPIC_SEEN's.
 */
export const TROPIC_EXTENT: T.Vector3[] = [
  ...WATERLINE_HULL.map((p) => new T.Vector3(p.x, WATER, p.z)),
  ...WATERLINE_HULL.map((p) => new T.Vector3(p.x, TROPIC_REACH.crown, p.z)),
  ...ROOF_CORNERS.map((p) => p.clone()),
];
/**
 * Everything of the tropic island that can show on screen, world points: TROPIC_EXTENT, and the sea
 * round it that goes and comes with it (TROPIC_REACH: the polygon round the waterline grown to rings
 * past it at the water's level and at its shelf's floor, and its crowns' ring past it). Everything
 * of the island, its shelf, foam and shallows included, lies inside these points' hull, so their box
 * on screen (as the scene measures the sky island's: skyOnScreen) holds all of it from any side and
 * pitch (check-town): a frame that box misses shows nothing of it. The scene's rule for when the
 * island may go measures this (decision 4: never taken away while any of it is in view); its
 * framings use TROPIC_EXTENT.
 */
export const TROPIC_SEEN: T.Vector3[] = (() => {
  const R = TROPIC_REACH,
    sea = hullRing(R.sea);
  return [
    ...TROPIC_EXTENT.map((p) => p.clone()),
    ...sea.map((p) => new T.Vector3(p.x, WATER, p.z)),
    ...sea.map((p) => new T.Vector3(p.x, R.floor, p.z)),
    ...hullRing(R.crowns).map((p) => new T.Vector3(p.x, R.crown, p.z)),
  ];
})();
/**
 * The ground drawn at a world point of the tropic island: the lawn (plan.tropicTop) or, off it, the
 * beach's shore profile (town-ground's shoreHeight), as its rocks stand on it; what the garden stands
 * its trees on (its palms on the sand).
 */
export function tropicGroundAt(x: number, z: number) {
  const width = plan.tropicAt(x, z).shore;
  return width <= 0 ? plan.tropicTop(x, z) : shoreHeight(width);
}
/**
 * The tropic island's ground once built (town-build's 'tropic ground'): its group, and setShown,
 * which shows or hides the whole island in the scene: its ground, every group joined to it (its
 * building's model root, its garden and Filip), its foam (the town's foam
 * mesh drawn only up to the island's rows) and its shallows (the ground masks' G over the island,
 * written back as it was without them). Hidden, nothing of it is drawn, casts or answers the
 * pointer (city-scene's pickTarget passes over a model whose root is hidden), and no ring is left on
 * the sea. The scene decides when (decision 4: never while it is in view).
 */
export type TropicIsland = {
  land: T.Group;
  /** The groups setShown takes with the island's own ground. */
  join: (...groups: T.Object3D[]) => void;
  /**
   * Every group setShown takes: its ground first, then each one joined (its building's model root,
   * its garden and Filip). check-town holds them together to the island's caps, inside TROPIC_SEEN,
   * and what of them stands on the island inside TROPIC_EXTENT.
   */
  groups: () => readonly T.Object3D[];
  setShown: (shown: boolean) => void;
  shown: () => boolean;
};

export function createTropicIsland(ctx: TownContext) {
  const { material } = ctx,
    L = TROPIC_LOOK,
    P = plan.TROPIC;

  /** A mesh of `geometry` in the material (colour, kind), added to g. */
  function solid(g: T.Object3D, geometry: T.BufferGeometry, colour: string, kind: SurfaceKind, opts: { shadow?: boolean; ground?: boolean; name?: string } = {}) {
    const m = new T.Mesh(geometry, material(colour, kind));
    m.castShadow = opts.shadow ?? true;
    m.receiveShadow = true;
    if (opts.shadow === false) m.userData.noShadow = true;
    if (opts.ground) m.userData.ground = true;
    if (opts.name) m.name = opts.name;
    g.add(m);
    return m;
  }
  /** The lawn's own normal at a world point (plan.tropicTop's), so the lawn and the walks shade as one ground. */
  function lawnNormal(x: number, z: number) {
    const e = 0.05;
    return new T.Vector3(plan.tropicTop(x - e, z) - plan.tropicTop(x + e, z), 2 * e, plan.tropicTop(x, z - e) - plan.tropicTop(x, z + e)).normalize();
  }
  const UP = new T.Vector3(0, 1, 0);
  /**
   * A flat surface laid on the lawn, from triangles in world x, z (any winding: each is turned to
   * face up), each one flat colour and `lift` over the lawn; every vertex stands on the lawn and takes
   * its normal.
   */
  function draped() {
    const pos: number[] = [],
      nor: number[] = [],
      col: number[] = [],
      // The lawn's height and normal at each point, worked out once (a point is shared by several
      // triangles; keyed to 1e-5 by number: the island's x and z are under 70, so the key is exact).
      // On the level terrace (the pad's height there) the normal is straight up: the terrace is level
      // for 0.6 round everything paved on it, and level-flat where it eases.
      seen = new Map<number, [number, T.Vector3]>(),
      lawnAt = (x: number, z: number) => {
        const key = Math.round(x * 1e5) * 1e8 + Math.round(z * 1e5);
        let at = seen.get(key);
        if (!at) {
          const y = plan.tropicTop(x, z);
          seen.set(key, (at = [y, Math.abs(y - P.pad) < 1e-9 ? UP : lawnNormal(x, z)]));
        }
        return at;
      };
    return {
      triangle(a: plan.XZ, b: plan.XZ, c: plan.XZ, tone: T.Color, lift: number) {
        const turn = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
        if (Math.abs(turn) < 1e-9) return;
        for (const [x, z] of turn > 0 ? [a, b, c] : [a, c, b]) {
          const [y, n] = lawnAt(x, z);
          pos.push(x, y + lift, z);
          n.toArray(nor, nor.length);
          col.push(tone.r, tone.g, tone.b);
        }
      },
      /**
       * An upright face from a to b (world x, z), from `low` to `high` over the lawn, its front facing
       * `normal` (x, z), shaded as the lawn's surface is there (so it reads as the slab's own edge, one
       * tone with its top, never a dark line).
       */
      face(a: plan.XZ, b: plan.XZ, low: number, high: number, normal: plan.XZ, tone: T.Color) {
        const [ya] = lawnAt(a[0], a[1]),
          [yb] = lawnAt(b[0], b[1]),
          // (Wound so its front faces `normal`.)
          turn = (b[0] - a[0]) * normal[1] - (b[1] - a[1]) * normal[0],
          [p, q, yp, yq] = turn > 0 ? [a, b, ya, yb] : [b, a, yb, ya],
          quad: [number, number, number][] = [[p[0], yp + low, p[1]], [q[0], yq + low, q[1]], [q[0], yq + high, q[1]], [p[0], yp + low, p[1]], [q[0], yq + high, q[1]], [p[0], yp + high, p[1]]];
        for (const v of quad) {
          pos.push(...v);
          lawnAt(v[0], v[2])[1].toArray(nor, nor.length);
          col.push(tone.r, tone.g, tone.b);
        }
      },
      geometry() {
        const geometry = new T.BufferGeometry();
        geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
        geometry.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
        geometry.setAttribute('color', new T.Float32BufferAttribute(col, 3));
        return geometry;
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* Lawn and shore                                                    */
  /* ---------------------------------------------------------------- */
  /**
   * The lawn: rings from the middle out to the turf's edge along the shore's stations
   * (plan.tropicBearings, evenly along the waterline), so its rim is the shore's own inner edge; at the dome's, the mound's and
   * the terrace's heights (plan.tropicTop) and normals, toned with low noise from the town's two
   * lawn greens. No stripes: the ground masks' lawn checker is not drawn here (B is nought), and
   * the ground shader's lawn tint is (as on the airport's deck).
   */
  function lawn(g: T.Object3D) {
    const rings = 13,
      stations = plan.tropicBearings,
      m = stations.length,
      pos: number[] = [],
      nor: number[] = [],
      col: number[] = [],
      index: number[] = [],
      lo = new T.Color(L.lawn[0]),
      hi = new T.Color(L.lawn[1]),
      c = new T.Color();
    const put = (x: number, z: number) => {
      pos.push(x, plan.tropicTop(x, z), z);
      lawnNormal(x, z).toArray(nor, nor.length);
      const n = noise2(x * 0.07 + 5, z * 0.07 + 3) * 0.6 + noise2(x * 0.19 + 11, z * 0.19 + 7) * 0.4;
      c.copy(lo).lerp(hi, T.MathUtils.smoothstep(n, 0.3, 0.7)).toArray(col, col.length);
    };
    put(P.x, P.z);
    for (let i = 1; i <= rings; i++)
      for (const bearing of stations) {
        const [ex, ez] = plan.tropicShorePoint(bearing, 0),
          t = i / rings;
        put(P.x + (ex - P.x) * t, P.z + (ez - P.z) * t);
      }
    const at = (i: number, j: number) => (i === 0 ? 0 : 1 + (i - 1) * m + (j % m));
    for (let j = 0; j < m; j++) index.push(0, at(1, j + 1), at(1, j));
    for (let i = 1; i < rings; i++)
      for (let j = 0; j < m; j++) {
        const a = at(i, j),
          b = at(i, j + 1),
          d = at(i + 1, j),
          e = at(i + 1, j + 1);
        index.push(a, e, d, a, b, e);
      }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    geometry.setIndex(index);
    solid(g, geometry, '#ffffff', 'grass', { shadow: false, ground: true, name: 'tropic-lawn' });
  }
  /**
   * The beach: the town's own shore profile (SHORE_PROFILE: the turf's lip, dry sand, wet sand,
   * the waterline, the pale shelf and the drop) on every station's ray, as the main island's shore
   * is laid on its outline, in the same sand (its uv.x the profile's own width, so the sand's wet
   * band falls just short of the waterline wherever the beach is narrower or wider: a wide beach, the
   * bay's or the tail's, is the profile drawn out). Along the rocky stretches the narrow beach's dry
   * sand is a damp strip under the stones.
   */
  function shore(g: T.Object3D) {
    const stations = plan.tropicBearings,
      m = stations.length,
      bands = SHORE_PROFILE.length,
      wet = new T.Color(palette.sandWet),
      pos: number[] = [],
      col: number[] = [],
      uv: number[] = [],
      index: number[] = [],
      c = new T.Color();
    stations.forEach((bearing, j) => {
      const rocky = plan.tropicRockiness(bearing);
      for (const band of SHORE_PROFILE) {
        const [x, z] = plan.tropicShorePoint(bearing, band.width),
          tone = 0.96 + 0.04 * Math.sin(j * 0.9 + band.width * 2.1) + 0.02 * (hash(j * 7 + band.width * 13 + 500) - 0.5);
        pos.push(x, band.width === 0 ? plan.tropicTop(x, z) : band.height, z);
        c.set(band.color);
        if (band.width > 0.25 && band.width < 2.86) c.lerp(wet, 0.55 * rocky);
        c.multiplyScalar(tone);
        col.push(c.r, c.g, c.b);
        uv.push(band.width, 0);
      }
    });
    for (let j = 0; j < m; j++)
      for (let k = 0; k < bands - 1; k++) {
        const a = j * bands + k,
          b = ((j + 1) % m) * bands + k;
        index.push(a, b, b + 1, a, b + 1, a + 1);
      }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    geometry.userData.longitudinalUV = true; // batch() keeps this uv
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    solid(g, geometry, '#ffffff', 'sand', { shadow: false, ground: true, name: 'tropic-beach' });
  }

  /* ---------------------------------------------------------------- */
  /* The walks                                                         */
  /* ---------------------------------------------------------------- */
  /**
   * The land's paving (plan.tropicPaving, from plan.TROPIC_PATHS): the forecourt, the café terrace,
   * the bay walk, the tree walk and the seat, one draped surface `lift` over the lawn in the
   * residence's pale concrete, its flush kerbs its own outer band (`kerb` wide in from every lawn edge:
   * grey granite on the main line, the light kerb on the tree walk and the seat), so a kerb runs on
   * through every junction round its fillet, and none runs along the podium or the plaza's rim. Each
   * band is its own flat colour (an edge is geometry, never a line); plain stone, no joints drawn.
   * Cut from the paving's distances on a grid (PAVING_GRID): each `cell` an edge passes through is
   * halved, and halved again down to `fine`, only where the edge bends there; each leaf is laid as its
   * own outline with its neighbours' corners on its sides (so no crack opens where a fine leaf meets a
   * coarse one), cut into triangles and clipped along the edges, which lie where the distances cross
   * nought (exact on a straight edge; see PAVING_GRID for the rest). Where the paving runs onto the
   * plaza's rim (0.01, over its stone) its edge is closed by a riser down to the lawn, in its own
   * colour and facing the plaza, so no lawn shows under it from across the plaza.
   */
  function paths(g: T.Object3D) {
    const W = plan.TROPIC_PATHS,
      Q = plan.TROPIC_PLAZA,
      G = PAVING_GRID,
      pave = new T.Color(L.paving),
      main = new T.Color(L.kerbMain),
      light = new T.Color(L.kerb),
      surface = draped(),
      n = Math.round(G.cell / G.fine);
    // A vertex: its place in the island's frame and the paving's distances there (paving, union, split line).
    type V = [number, number, number, number, number];
    // (Every point lies on the fine lattice, (i, j) in fines: each is worked out once.)
    const known = new Map<number, V>(),
      vertex = (i: number, j: number): V => {
        const key = i * 100003 + j;
        let v = known.get(key);
        if (!v) {
          const x = i * G.fine,
            z = j * G.fine,
            p = plan.tropicPaving(x, z);
          known.set(key, (v = [x, z, p.paving, p.union, x - W.split]));
        }
        return v;
      };
    /** The part of a convex polygon where field k is at most `at` (or more, `above`), the field linear along its edges. */
    const clip = (poly: V[], k: number, at: number, above = false): V[] => {
      const side = (v: V) => (above ? v[k] - at > 0 : v[k] - at <= 0);
      // (Wholly on one side: all of it, or none.)
      let kept = 0;
      for (const v of poly) if (side(v)) kept++;
      if (kept === poly.length) return poly;
      if (!kept) return [];
      const out: V[] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i],
          b = poly[(i + 1) % poly.length];
        if (side(a)) out.push(a);
        if (side(a) !== side(b)) {
          const f = (at - a[k]) / (b[k] - a[k]);
          out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f, a[4] + (b[4] - a[4]) * f]);
        }
      }
      return out;
    };
    const emit = (poly: V[], tone: T.Color) => {
      for (let i = 1; i + 1 < poly.length; i++) surface.triangle([P.x + poly[0][0], P.z + poly[0][1]], [P.x + poly[i][0], P.z + poly[i][1]], [P.x + poly[i + 1][0], P.z + poly[i + 1][1]], tone, W.lift);
    };
    /** A triangle (or any convex piece no edge crosses twice) clipped to the paving, its kerb bands and their stones. */
    const piece = (t: V[]) => {
      const paved = clip(t, 2, 0);
      if (paved.length < 3) return;
      for (const [east, kerb, edge] of [[false, W.main.kerb, main], [true, W.tree.kerb, light]] as const) {
        const part = clip(paved, 4, 0, east);
        if (part.length < 3) continue;
        emit(clip(part, 3, -kerb), pave);
        emit(clip(part, 3, -kerb, true), edge);
      }
    };
    // The quadtree's leaves, (i, j) their north-west corner and `size` their side, in fines; and the
    // lattice points that are any leaf's corner.
    const leaves: [number, number, number][] = [],
      corners = new Set<number>(),
      // The edges a cell can hold: the paving's edge and the kerb's inner line (main and tree).
      levels: [number, number][] = [[2, 0], [3, -W.main.kerb], [3, -W.tree.kerb]],
      /** Whether a contour can pass through the cell (a distance moves no faster than 1). */
      near = (m: V, size: number) => levels.some(([k, at]) => Math.abs(m[k] - at) < size * G.fine * 0.71),
      /** Whether a field bends in the cell: at its middle or an edge's middle off its corners' blend. */
      bent = (i: number, j: number, size: number) => {
        const h = size / 2,
          c = [vertex(i, j), vertex(i + size, j), vertex(i + size, j + size), vertex(i, j + size)];
        return [2, 3].some((k) => {
          const mid = (a: number, b: number) => (c[a][k] + c[b][k]) / 2;
          return (
            Math.abs(vertex(i + h, j + h)[k] - (mid(0, 1) + mid(2, 3)) / 2) > G.bend ||
            Math.abs(vertex(i + h, j)[k] - mid(0, 1)) > G.bend ||
            Math.abs(vertex(i + size, j + h)[k] - mid(1, 2)) > G.bend ||
            Math.abs(vertex(i + h, j + size)[k] - mid(2, 3)) > G.bend ||
            Math.abs(vertex(i, j + h)[k] - mid(3, 0)) > G.bend
          );
        });
      },
      split = (i: number, j: number, size: number) => {
        const h = size / 2,
          m = vertex(i + h, j + h);
        // (Wholly off the paving: nothing.)
        if (m[2] > size * G.fine * 0.71) return;
        if (size > 1 && near(m, size) && bent(i, j, size)) {
          for (const [di, dj] of [[0, 0], [h, 0], [h, h], [0, h]]) split(i + di, j + dj, h);
          return;
        }
        leaves.push([i, j, size]);
        for (const [di, dj] of [[0, 0], [size, 0], [size, size], [0, size]]) corners.add((i + di) * 100003 + j + dj);
      };
    const F = W.forecourt,
      C = W.cafe,
      box = { x0: Math.min(C.x0, W.bay.x - W.bay.width) - 0.4, x1: W.seat.x + W.seat.r + 0.4, z0: Math.min(F.z0, W.seat.z - W.seat.r) - 0.4, z1: W.bay.end + 0.3 },
      [i0, j0] = [Math.floor(box.x0 / G.cell) * n, Math.floor(box.z0 / G.cell) * n];
    for (let i = i0; i * G.fine < box.x1; i += n) for (let j = j0; j * G.fine < box.z1; j += n) split(i, j, n);
    for (const [i, j, size] of leaves) {
      // Its outline, round from its north-west corner, with any finer neighbour's corners on its sides.
      const ring: V[] = [];
      for (const [ai, aj, di, dj] of [[i, j, 1, 0], [i + size, j, 0, 1], [i + size, j + size, -1, 0], [i, j + size, 0, -1]]) {
        ring.push(vertex(ai, aj));
        for (let k = 1; k < size; k++) if (corners.has((ai + di * k) * 100003 + aj + dj * k)) ring.push(vertex(ai + di * k, aj + dj * k));
      }
      if (ring.length === 4) {
        // Two triangles, split along the diagonal the paving's distance changes least over.
        const [a, b, d, e] = ring;
        if (Math.abs(a[2] - d[2]) <= Math.abs(b[2] - e[2])) {
          piece([a, b, d]);
          piece([a, d, e]);
        } else {
          piece([a, b, e]);
          piece([b, d, e]);
        }
        continue;
      }
      // (More: wholly on one side of every edge it is one convex piece; else a fan about its middle.)
      const same = (k: number, at: number) => ring.every((v) => v[k] <= at) || ring.every((v) => v[k] > at);
      if (levels.every(([k, at]) => same(k, at)) && same(4, 0)) piece(ring);
      else {
        const m = vertex(i + size / 2, j + size / 2);
        for (let k = 0; k < ring.length; k++) piece([m, ring[k], ring[(k + 1) % ring.length]]);
      }
    }
    // The riser where the paving runs onto the plaza's rim: on every stretch of the rim the walks meet
    // (paved just outside it), at the paving's edge there, from its surface down to the lawn.
    {
      const steps = Math.ceil((Math.PI * 2 * Q.r) / G.fine),
        r = Q.r - 0.01,
        at = (a: number): plan.XZ => [Q.x + Math.cos(a) * r, Q.z + Math.sin(a) * r];
      for (let k = 0; k < steps; k++) {
        const a0 = (k / steps) * Math.PI * 2,
          a1 = ((k + 1) / steps) * Math.PI * 2,
          am = (a0 + a1) / 2,
          out = plan.tropicPaving(Q.x + Math.cos(am) * (Q.r + 0.02), Q.z + Math.sin(am) * (Q.r + 0.02));
        if (out.paving > 0) continue;
        const [p, q] = [at(a0), at(a1)];
        surface.face([P.x + p[0], P.z + p[1]], [P.x + q[0], P.z + q[1]], 0, W.lift, [-Math.cos(am), -Math.sin(am)], out.union > -out.kerb ? (Q.x + Math.cos(am) * r > W.split ? light : main) : pave);
      }
    }
    solid(g, surface.geometry(), '#ffffff', 'stone', { shadow: false, ground: true, name: 'tropic-paths' });
  }

  /* ---------------------------------------------------------------- */
  /* Rocks                                                             */
  /* ---------------------------------------------------------------- */
  /**
   * The granite on the shore (TROPIC_ROCKS), one geometry: each cluster's stones and the lone
   * boulders, each a chiselled armour boulder sunk a third of its height into the beach or the
   * shelf under it, tipped and turned by its seed, toned from the granite greys (lighter where it
   * faces the sky, a shade darker low down, damp below the waterline).
   */
  function rocks(g: T.Object3D) {
    const R = TROPIC_ROCKS,
      greys = L.granite.map((t) => new T.Color(t)),
      parts: T.BufferGeometry[] = [],
      c = new T.Color(),
      step = T.MathUtils.smoothstep;
    /** A stone (its turn about the upright random, or `along` the shore's line give or take a little). */
    const stone = (bearing: number, at: number, t: number, n: number, half: [number, number, number], detail: number, cuts: [number, number, number, number][], seed: number, along = false) => {
      // The ray's frame at the stone: out to sea (n) and along the shore (t), clockwise seen from above.
      const ox = Math.sin(bearing),
        oz = Math.cos(bearing),
        [bx, bz] = plan.tropicShorePoint(bearing, at),
        x = bx + ox * n - oz * t,
        z = bz + oz * n + ox * t,
        width = plan.tropicAt(x, z).shore,
        ground = width <= 0 ? plan.tropicTop(x, z) : shoreHeight(width),
        squash = new T.Vector3(...half),
        shape = chisel(boulder(seed, 0.45 + 0.25 * hash(seed * 1.7), detail), cuts),
        turn = new T.Euler(0.22 * (hash(seed * 3.1) - 0.5), Math.atan2(ox, oz) + (along ? 0.3 * (hash(seed * 5.7) - 0.5) : hash(seed * 5.7) * Math.PI * 2), 0.22 * (hash(seed * 7.9) - 0.5), 'YXZ'),
        plain = shape.applyMatrix4(new T.Matrix4().compose(new T.Vector3(x, ground + half[1] / 3, z), new T.Quaternion().setFromEuler(turn), squash)).toNonIndexed(),
        p = plain.getAttribute('position'),
        nrm = plain.getAttribute('normal'),
        tones = new Float32Array(p.count * 3),
        tint = greys[Math.floor(hash(seed * 2.3) * greys.length) % greys.length],
        tone = 0.94 + 0.12 * hash(seed * 4.1);
      shape.dispose();
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i),
          v = tone * (0.9 + 0.14 * step(nrm.getY(i), -0.1, 0.7)) * (1 - 0.08 * (1 - step(y, ground, ground + half[1]))) * (1 - 0.18 * (1 - step(y, WATER - 0.09, WATER + 0.07)));
        c.copy(tint).multiplyScalar(v).toArray(tones, i * 3);
      }
      plain.setAttribute('color', new T.BufferAttribute(tones, 3));
      parts.push(plain);
    };
    for (const cl of R.clusters) {
      const mirror = hash(cl.seed * 2.9) < 0.5 ? -1 : 1,
        a = (2 * hash(cl.seed * 4.7) - 1) * R.turn,
        ca = Math.cos(a),
        sa = Math.sin(a);
      R.stones.slice(0, cl.stones ?? R.stones.length).forEach((s, k) => {
        const seed = cl.seed * 13 + k * 7,
          grow = 0.85 + 0.3 * hash(seed * 1.3),
          t = s.t * R.spread * mirror,
          n = s.n;
        stone(cl.bearing, cl.at, (t * ca - n * sa) * cl.size, (t * sa + n * ca) * cl.size, s.half.map((h) => h * cl.size * grow) as [number, number, number], s.detail, s.cuts, seed);
      });
    }
    for (const l of R.ledges) stone(l.bearing, l.at, 0, 0, R.ledge.half.map((h) => h * l.size) as [number, number, number], 1, R.ledge.cuts, l.seed, true);
    for (const b of R.lone) stone(b.bearing, b.at, 0, 0, [b.size * 1.35, b.size * 0.7, b.size * 1.05], 2, [], b.seed);
    const geometry = new T.BufferGeometry(),
      merged = parts.reduce((n, q) => n + q.getAttribute('position').count, 0),
      pos = new Float32Array(merged * 3),
      nor = new Float32Array(merged * 3),
      col = new Float32Array(merged * 3);
    let o = 0;
    for (const q of parts) {
      pos.set(q.getAttribute('position').array as Float32Array, o * 3);
      nor.set(q.getAttribute('normal').array as Float32Array, o * 3);
      col.set(q.getAttribute('color').array as Float32Array, o * 3);
      o += q.getAttribute('position').count;
      q.dispose();
    }
    geometry.setAttribute('position', new T.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geometry.setAttribute('color', new T.BufferAttribute(col, 3));
    solid(g, geometry, '#ffffff', 'stone', { name: 'tropic-rocks' });
  }

  /* ---------------------------------------------------------------- */
  /* The island                                                        */
  /* ---------------------------------------------------------------- */
  /**
   * The island's ground into `land` (its own group, in world space): the lawn, the beach, the walks
   * and the rocks; then its shallows into the ground masks (`masks`, max-combined with the
   * town's, town-ground's addTropicShallows), with its foam already in the town's foam mesh (`foam`,
   * its rows from userData.tropicFoam on). Returns the island (TropicIsland), shown.
   */
  function tropicGround(land: T.Group, sea: { foam: T.Mesh; masks: T.DataTexture }): TropicIsland {
    lawn(land);
    shore(land);
    paths(land);
    rocks(land);
    const shallows = addTropicShallows(sea.masks),
      foamRows = sea.foam.userData.tropicFoam as number,
      groups: T.Object3D[] = [land];
    let shown = true;
    return {
      land,
      join: (...more) => {
        for (const g of more) {
          if (!groups.includes(g)) groups.push(g);
          g.visible = shown;
        }
      },
      groups: () => groups,
      setShown(on) {
        if (on === shown) return;
        shown = on;
        for (const g of groups) g.visible = on;
        sea.foam.geometry.setDrawRange(0, on ? Infinity : foamRows);
        shallows.show(on);
      },
      shown: () => shown,
    };
  }

  return { tropicGround };
}
export type TropicIslandKit = ReturnType<typeof createTropicIsland>;
