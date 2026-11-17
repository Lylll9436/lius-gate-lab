import * as T from 'three';
import type { SurfaceKind } from './city-materials';
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
 * concrete for the walks with their flush kerbs a shade lighter, and the granite of its rocks: the
 * airport armour's greys warmed a step (Singapore's granite reads warm grey), two of five dark. (The
 * round plaza before the building's door is the garden's: town-tropic-garden.)
 */
export const TROPIC_LOOK = {
  lawn: ['#98b74a', '#aac757'],
  paving: RESIDENCE_LOOK.paving,
  kerb: '#e3dac6',
  granite: ['#958f84', '#8b867d', '#9e978a', '#7d7871', '#706c66'],
};
/**
 * How far apart the points along the island's walks stand (town-tropic's paths): `step`, and
 * `fine` over the first `mouth` of the call walk, where it leaves the front walk, so its kerbs start
 * within that of the front walk's edge.
 */
const WALK_STEP = { step: 0.25, fine: 0.05, mouth: 0.9 };
/**
 * The rocks on the shore: clusters of the armour's chiselled boulders (town-sky-garden's boulder,
 * town-sky's chisel) on the two rocky stretches (plan.TROPIC_ROCKY): three round the tip and along the
 * flank of the low rocky point behind the building, one on the north-west where that stretch ends, and
 * one on the knoll on the south-west, the bay's west end. Each is placed by the bearing it stands on
 * and how far out on the shore profile its middle is (`at`: 0 the turf's edge, plan.TROPIC.beach the
 * waterline), with its stones' offsets in its own frame (t along the shore, spread `spread` along it;
 * n out to sea), sizes (half sizes, unit-free: `size` scales them) and seeds. Along the rocky
 * stretches, low ledges (`ledges`: one long flat stone each, `ledge` its half sizes) lie between and
 * beyond the clusters, so the point and the knoll read as low outcrops broken into blocks, not piles
 * on sand (the point's easternmost lies where that stretch turns fully rocky: its stones begin
 * where its beach has narrowed and its surf breaks); and two lone boulders lie on the sand (at the
 * bay's east end, and on the tail at the hollow's south end), as the town's own beach has. Each
 * stone is sunk a third of its height, damp-darkened below the waterline as the armour is, lighter
 * where it faces the sky.
 */
export const TROPIC_ROCKS = {
  clusters: [
    { bearing: Math.PI - 0.7, at: 2.05, size: 0.9, seed: 3 },
    { bearing: Math.PI - 0.38, at: 2.3, size: 1.08, seed: 11 },
    { bearing: Math.PI - 0.02, at: 2.1, size: 0.92, seed: 19 },
    { bearing: -0.98, at: 2.15, size: 0.86, seed: 29 },
    { bearing: -2.12, at: 2.25, size: 0.8, seed: 41 },
  ],
  spread: 1.35,
  ledges: [
    { bearing: Math.PI - 1.02, at: 1.8, size: 1.1, seed: 73 },
    { bearing: Math.PI - 0.54, at: 1.75, size: 1.0, seed: 71 },
    { bearing: Math.PI - 0.2, at: 1.85, size: 1.12, seed: 79 },
    { bearing: Math.PI + 0.28, at: 1.8, size: 1.02, seed: 83 },
    { bearing: Math.PI + 0.62, at: 1.75, size: 0.9, seed: 89 },
    { bearing: -1.13, at: 1.8, size: 0.85, seed: 97 },
  ],
  ledge: { half: [0.62, 0.17, 0.34] as [number, number, number], cuts: [[0, 1, 0.1, 0.62]] as [number, number, number, number][] },
  lone: [
    { bearing: 0.42, at: 1.3, size: 0.42, seed: 53 },
    { bearing: 1.5, at: 1.7, size: 0.36, seed: 61 },
  ],
  stones: [
    { t: 0, n: 0, half: [0.62, 0.44, 0.52], detail: 2, cuts: [[0, 0.75, 0.66, 0.72], [0.7, 0.2, 0.68, 0.78]] },
    { t: 0.78, n: 0.28, half: [0.44, 0.3, 0.38], detail: 2, cuts: [[0.2, 0.9, 0.3, 0.78]] },
    { t: -0.72, n: 0.34, half: [0.34, 0.26, 0.32], detail: 2, cuts: [] },
    { t: 0.3, n: -0.52, half: [0.2, 0.14, 0.18], detail: 1, cuts: [] },
    { t: -0.3, n: 0.78, half: [0.16, 0.12, 0.15], detail: 1, cuts: [] },
  ] as { t: number; n: number; half: [number, number, number]; detail: number; cuts: [number, number, number, number][] }[],
};
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
/** The building's corners at its top, over its whole footprint (TROPIC_BUILDING: the podium's plan, the roof's 11 by 7.2 inside it). */
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
 * top, 8.1 up). Everything of the island that stands on it, at or over the water and inside its
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
  /**
   * A flat surface laid on the lawn, from triangles in world x, z (any winding: each is turned to
   * face up), each one flat colour and `lift` over the lawn; every vertex stands on the lawn and takes
   * its normal.
   */
  function draped() {
    const pos: number[] = [],
      nor: number[] = [],
      col: number[] = [];
    return {
      triangle(a: plan.XZ, b: plan.XZ, c: plan.XZ, tone: T.Color, lift: number) {
        const turn = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
        if (Math.abs(turn) < 1e-9) return;
        for (const [x, z] of turn > 0 ? [a, b, c] : [a, c, b]) {
          pos.push(x, plan.tropicTop(x, z) + lift, z);
          lawnNormal(x, z).toArray(nor, nor.length);
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
   * The three walks (plan.TROPIC_PATHS, along their lines, plan.TROPIC_PATH_LINES), laid on the lawn:
   * pale concrete with a flush kerb a shade lighter along both edges, each band its own flat colour
   * (the kerb is geometry, never a line). Plain stone, no joints drawn: the town's paving draws its
   * flags square to the world, and they would cross a curving walk at a slant. The south and front
   * walks start at the plaza's rim, their first edge fitted to it (the garden's paving covers the
   * plaza); the call walk starts on the front walk's middle line, a hair over it and all paving
   * where it lies on it, so the front walk's kerb is gone across its mouth and its own kerbs start at
   * the front walk's edge. Each walk's far end is round. Points along a walk stand WALK_STEP apart.
   */
  function paths(g: T.Object3D) {
    const W = plan.TROPIC_PATHS,
      Q = plan.TROPIC_PLAZA,
      [qx, qz] = [P.x + Q.x, P.z + Q.z],
      half = W.width / 2,
      inner = half - W.kerb,
      pave = new T.Color(L.paving),
      kerb = new T.Color(L.kerb),
      surface = draped();
    /** Points along a fine line at the distances from its start that `at` lists (its length given), its end last. */
    const resample = (line: plan.XZ[], at: (length: number) => number[]): plan.XZ[] => {
      const lengths = [0];
      for (let i = 1; i < line.length; i++) lengths.push(lengths[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
      let i = 0;
      return at(lengths[lengths.length - 1]).map((d): plan.XZ => {
        while (i + 2 < lengths.length && lengths[i + 1] < d) i++;
        const f = Math.min(1, Math.max(0, (d - lengths[i]) / (lengths[i + 1] - lengths[i] || 1)));
        return [line[i][0] + (line[i + 1][0] - line[i][0]) * f, line[i][1] + (line[i + 1][1] - line[i][1]) * f];
      });
    };
    /** Distances `step` apart (evenly, to the end), `fine` apart up to `from` first. */
    const spaced = (from: number, fine: number) => (length: number) => {
      const out: number[] = [];
      for (let d = 0; d < from - 1e-9; d += fine) out.push(d);
      const n = Math.max(1, Math.ceil((length - from) / WALK_STEP.step));
      for (let k = 0; k <= n; k++) out.push(from + ((length - from) * k) / n);
      return out;
    };
    const quad = (a: plan.XZ, b: plan.XZ, c: plan.XZ, d: plan.XZ, tone: T.Color, lift: number) => {
      surface.triangle(a, b, c, tone, lift);
      surface.triangle(a, c, d, tone, lift);
    };
    /**
     * One walk along `line`, `lift` over the lawn: its first edge fitted to the plaza's rim (`rim`) or
     * cut square; its kerbs painted as paving wherever they lie on another walk (`on`).
     */
    const ribbon = (line: plan.XZ[], lift: number, rim: boolean, on?: (x: number, z: number) => boolean) => {
      /** The line's unit direction at point i. */
      const dir = (i: number): plan.XZ => {
        const a = line[Math.max(0, i - 1)],
          b = line[Math.min(line.length - 1, i + 1)],
          l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      };
      /** Point i moved `o` across the line (to its right, looking along it); at the start of a walk from the plaza, slid along it onto the rim. */
      const across = (i: number, o: number): plan.XZ => {
        const [dx, dz] = dir(i),
          x = line[i][0] - dz * o,
          z = line[i][1] + dx * o;
        if (i || !rim) return [x, z];
        // |p + t d - c| = r, the root nearest nought (the middle of the edge is on the rim already).
        const px = x - qx,
          pz = z - qz,
          b = px * dx + pz * dz,
          t = -b + Math.sqrt(Math.max(0, b * b - (px * px + pz * pz - Q.r * Q.r)));
        return [x + dx * t, z + dz * t];
      };
      const bands: [number, number, T.Color][] = [
        [-half, -inner, kerb],
        [-inner, inner, pave],
        [inner, half, kerb],
      ];
      for (let i = 0; i + 1 < line.length; i++)
        for (const [o0, o1, tone] of bands) {
          const a = across(i, o0),
            b = across(i, o1),
            c = across(i + 1, o1),
            d = across(i + 1, o0),
            lying = on?.((a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4);
          quad(a, b, c, d, lying ? pave : tone, lift);
        }
      // Its far end round: half a disc of concrete beyond it, its kerb round it.
      const last = line.length - 1,
        [dx, dz] = dir(last),
        [cx, cz] = line[last],
        steps = 8,
        arc = (k: number, r: number): plan.XZ => {
          const a = -Math.PI / 2 + (k / steps) * Math.PI,
            u = Math.cos(a),
            v = Math.sin(a);
          return [cx + (dx * u - dz * v) * r, cz + (dz * u + dx * v) * r];
        };
      for (let k = 0; k < steps; k++) {
        surface.triangle([cx, cz], arc(k, inner), arc(k + 1, inner), pave, lift);
        quad(arc(k, inner), arc(k, half), arc(k + 1, half), arc(k + 1, inner), kerb, lift);
      }
    };
    const lines = plan.TROPIC_PATH_LINES,
      even = spaced(0, WALK_STEP.step);
    ribbon(resample(lines.south, even), W.lift, true);
    ribbon(resample(lines.front, even), W.lift, true);
    ribbon(resample(lines.call, spaced(WALK_STEP.mouth, WALK_STEP.fine)), W.branch, false, (x, z) => plan.tropicWalkInside('front', x, z) > 0);
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
    for (const cl of R.clusters)
      R.stones.forEach((s, k) => {
        const seed = cl.seed * 13 + k * 7,
          mirror = hash(cl.seed * 2.9) < 0.5 ? -1 : 1,
          grow = 0.85 + 0.3 * hash(seed * 1.3);
        stone(cl.bearing, cl.at, s.t * cl.size * R.spread * mirror, s.n * cl.size, s.half.map((h) => h * cl.size * grow) as [number, number, number], s.detail, s.cuts, seed);
      });
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
