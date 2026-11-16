import * as T from 'three';
import type { SurfaceKind } from './city-materials';
import * as plan from './town-plan';
import { palette, hash, noise2, WATER, type TownContext } from './town-shared';
import { SHORE_PROFILE, addTropicShallows, shoreHeight } from './town-ground';
import { boulder } from './town-sky-garden';
import { chisel } from './town-sky';
import { AIRPORT_LOOK } from './town-airport';
import { RESIDENCE_LOOK } from './town-residence';

/**
 * The tropic island's ground (plan.TROPIC; the island's own section of town-plan has its outline,
 * lawn, terrace, paths and shore): built in a group of its own, `tropicLand`, as the airport's is,
 * never in the land's batch. Its colours, each no more saturated than its palette family: the
 * town's own two lawn greens (the main island's and the airport deck's), the residence's pale
 * concrete for the paths and the court's field with their flush kerbs a shade lighter, the court's
 * rings in the kerb's pale granite and the residence's grey granite round a dark granite drum (the
 * airport's rubble), and the granite of its rocks: the airport armour's greys warmed a step
 * (Singapore's granite reads warm grey), two of five dark.
 */
export const TROPIC_LOOK = {
  lawn: ['#98b74a', '#aac757'],
  paving: RESIDENCE_LOOK.paving,
  kerb: '#e3dac6',
  court: [palette.kerb, RESIDENCE_LOOK.gravel],
  drum: AIRPORT_LOOK.rubble,
  drumRing: '#8f8e86',
  granite: ['#958f84', '#8b867d', '#9e978a', '#7d7871', '#706c66'],
};
/**
 * The round court's rings, out from its middle (plan.TROPIC_PLAZA): the dark granite drum's radius,
 * then each ring's outer radius and its stone (0 the kerb's pale granite, 1 the grey), every ring at
 * least 0.22 across, the outermost pale; then the flush kerb into the lawn, a shade lighter, out to
 * the court's edge. The court lies `rise` over the terrace (over the paths' ends, which it covers);
 * the drum stands `drum` over the court.
 */
export const TROPIC_COURT = { centre: 0.38, rings: [[0.7, 1], [1.02, 0], [1.34, 1], [1.62, 0]] as [number, number][], rise: 0.045, drum: 0.08, segments: 48 };
/**
 * The rocks on the shore (plan.TROPIC_ROCKY): clusters of the armour's chiselled boulders
 * (town-sky-garden's boulder, town-sky's chisel) along the rocky stretches, each placed by the
 * bearing it stands on and how far out on the shore profile its middle is (`at`: 0 the turf's
 * edge, plan.TROPIC.beach the waterline), with its stones' offsets in its own frame (t along the
 * shore, n out to sea), sizes (half sizes, unit-free: `size` scales them) and seeds; and two lone
 * boulders on the sand, as the town's own beach has. Each stone is sunk a third of its height,
 * damp-darkened below the waterline as the armour is, lighter where it faces the sky.
 */
export const TROPIC_ROCKS = {
  clusters: [
    { bearing: Math.PI - 0.72, at: 2.0, size: 0.9, seed: 3 },
    { bearing: Math.PI - 0.28, at: 2.3, size: 1.05, seed: 11 },
    { bearing: Math.PI + 0.18, at: 2.1, size: 0.95, seed: 19 },
    { bearing: Math.PI + 0.62, at: 2.2, size: 0.85, seed: 29 },
    { bearing: -0.8, at: 2.2, size: 1.1, seed: 41 },
  ],
  lone: [
    { bearing: 0.42, at: 1.3, size: 0.42, seed: 53 },
    { bearing: 1.95, at: 1.6, size: 0.36, seed: 61 },
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
 * What of the tropic island can be on screen, as world points (decision 16's TROPIC_EXTENT): a ring
 * round its waterline as far out as anything of it reaches (`sea`: its beach's shelf under the
 * water, 4.31 past the waterline, and its shallows, 3; 32 points, so the ring's chords keep outside
 * it), once at the water's level (its shallows and its foam) and once at the shelf's floor
 * (`floor`, the shore profile's foot under the water, seen through it from a low camera); a ring 0.7
 * past the waterline 4.6 up (the crowns of its trees and palms, which lean out over the beach); and
 * its roof's four corners over the solar panels. Everything of the island, its foam and shallows
 * included, lies inside these points' hull, so their box on screen (as the scene measures the sky
 * island's: skyOnScreen) holds all of it from any side and pitch; a frame that box misses shows
 * nothing of it.
 */
export const TROPIC_REACH = { sea: 4.6, floor: SHORE_PROFILE[SHORE_PROFILE.length - 1].height, crowns: 0.7, crown: 4.6, points: 32 };
export const TROPIC_EXTENT: T.Vector3[] = (() => {
  const B = plan.TROPIC_BUILDING,
    P = plan.TROPIC,
    R = TROPIC_REACH;
  return [
    ...plan.tropicOutline(R.sea, R.points).map((p) => new T.Vector3(p.x, WATER, p.z)),
    ...plan.tropicOutline(R.sea, R.points).map((p) => new T.Vector3(p.x, R.floor, p.z)),
    ...plan.tropicOutline(R.crowns, R.points).map((p) => new T.Vector3(p.x, R.crown, p.z)),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => new T.Vector3(P.x + B.x + sx * B.hw, B.top, P.z + B.z + sz * B.hd))),
  ];
})();
/**
 * The tropic island's ground once built (town-build's 'tropic ground'): its group, and setShown,
 * which shows or hides the whole island in the scene: its ground, every group joined to it (the
 * merge joins its building's model root, its garden and its figure), its foam (the town's foam
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
   * and after the merge its garden and its figure). check-town holds them together to the island's
   * caps and inside TROPIC_EXTENT.
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
  /** The lawn's own normal at a world point (plan.tropicTop's), so the lawn, the paths and the court shade as one ground. */
  function lawnNormal(x: number, z: number) {
    const e = 0.05;
    return new T.Vector3(plan.tropicTop(x - e, z) - plan.tropicTop(x + e, z), 2 * e, plan.tropicTop(x, z - e) - plan.tropicTop(x, z + e)).normalize();
  }
  /**
   * A flat surface laid on the lawn `lift` over it, from triangles in world x, z (any winding: each
   * is turned to face up), each one flat colour; every vertex stands on the lawn and takes its
   * normal.
   */
  function draped(lift: number) {
    const pos: number[] = [],
      nor: number[] = [],
      col: number[] = [];
    return {
      triangle(a: plan.XZ, b: plan.XZ, c: plan.XZ, tone: T.Color) {
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
   * (plan.tropicBearings), so its rim is the shore's own inner edge; at the dome's, the mound's and
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
   * band falls just short of the waterline wherever the beach is narrower). Along the rocky
   * stretches the narrow beach's dry sand is a damp strip under the stones.
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
  /* Paths and the court                                               */
  /* ---------------------------------------------------------------- */
  /**
   * The two paths (plan.TROPIC_PATHS), laid on the lawn: pale concrete with a flush kerb a shade
   * lighter along both edges and round both ends, each band its own flat colour (the kerb is
   * geometry, never a line). Plain stone, no joints drawn: the town's paving draws its flags
   * square to the world, and they would cross a curving path at a slant.
   */
  function paths(g: T.Object3D) {
    const W = plan.TROPIC_PATHS,
      half = W.width / 2,
      inner = half - W.kerb,
      pave = new T.Color(L.paving),
      kerb = new T.Color(L.kerb),
      surface = draped(W.lift);
    const along = (points: plan.XZ[]): plan.XZ[] => {
      const curve = new T.CatmullRomCurve3(points.map(([x, z]) => new T.Vector3(P.x + x, 0, P.z + z)), false, 'centripetal');
      return curve.getSpacedPoints(Math.ceil(curve.getLength() / 0.25)).map((v): plan.XZ => [v.x, v.z]);
    };
    const quad = (a: plan.XZ, b: plan.XZ, c: plan.XZ, d: plan.XZ, tone: T.Color) => {
      surface.triangle(a, b, c, tone);
      surface.triangle(a, c, d, tone);
    };
    const ribbon = (line: plan.XZ[]) => {
      /** The line's unit direction at point i. */
      const dir = (i: number): plan.XZ => {
        const a = line[Math.max(0, i - 1)],
          b = line[Math.min(line.length - 1, i + 1)],
          l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      };
      /** Point i moved `o` across the line (to its right, looking along it). */
      const across = (i: number, o: number): plan.XZ => {
        const [dx, dz] = dir(i);
        return [line[i][0] - dz * o, line[i][1] + dx * o];
      };
      for (let i = 0; i + 1 < line.length; i++) {
        quad(across(i, -half), across(i, -inner), across(i + 1, -inner), across(i + 1, -half), kerb);
        quad(across(i, -inner), across(i, inner), across(i + 1, inner), across(i + 1, -inner), pave);
        quad(across(i, inner), across(i, half), across(i + 1, half), across(i + 1, inner), kerb);
      }
      // Round ends: half a disc of concrete beyond each end, its kerb round it.
      for (const [i, away] of [[0, -1], [line.length - 1, 1]] as const) {
        const [dx, dz] = dir(i),
          [cx, cz] = line[i],
          steps = 8,
          arc = (k: number, r: number): plan.XZ => {
            const a = -Math.PI / 2 + (k / steps) * Math.PI,
              u = Math.cos(a) * away,
              v = Math.sin(a);
            return [cx + (dx * u - dz * v) * r, cz + (dz * u + dx * v) * r];
          };
        for (let k = 0; k < steps; k++) {
          surface.triangle([cx, cz], arc(k, inner), arc(k + 1, inner), pave);
          quad(arc(k, inner), arc(k, half), arc(k + 1, half), arc(k + 1, inner), kerb);
        }
      }
    };
    ribbon(along(W.south));
    ribbon(along(W.front));
    solid(g, surface.geometry(), '#ffffff', 'stone', { shadow: false, ground: true, name: 'tropic-paths' });
  }
  /**
   * The round court before the entrance (plan.TROPIC_PLAZA, the photo's circular paving): on the
   * level terrace, its rings of pale and grey granite as flat geometry (TROPIC_COURT), the flush
   * kerb round them and a short skirt down into the terrace, so its edge never shows a gap; at its
   * middle a low drum of dark granite with a paler ring round its top. No water, nothing lit.
   */
  function court(g: T.Object3D) {
    const C = TROPIC_COURT,
      Q = plan.TROPIC_PLAZA,
      cx = P.x + Q.x,
      cz = P.z + Q.z,
      top = P.pad + C.rise,
      tones = [...L.court.map((t) => new T.Color(t)), new T.Color(L.kerb)],
      pos: number[] = [],
      col: number[] = [],
      n = C.segments,
      at = (k: number, r: number, y: number) => [cx + Math.cos((k / n) * Math.PI * 2) * r, y, cz + Math.sin((k / n) * Math.PI * 2) * r];
    const tri = (a: number[], b: number[], c: number[], tone: T.Color) => {
      pos.push(...a, ...b, ...c);
      for (let k = 0; k < 3; k++) col.push(tone.r, tone.g, tone.b);
    };
    const band = (r0: number, r1: number, tone: T.Color) => {
      for (let k = 0; k < n; k++) {
        const a = at(k, r0, top),
          b = at(k + 1, r0, top),
          c = at(k + 1, r1, top),
          d = at(k, r1, top);
        // The angle runs from +x toward +z (clockwise seen from above), so (a, b, c) faces up.
        tri(a, b, c, tone);
        tri(a, c, d, tone);
      }
    };
    let r = C.centre;
    for (const [outer, stone] of C.rings) {
      band(r, outer, tones[stone]);
      r = outer;
    }
    band(r, Q.r, tones[2]);
    // The skirt: the kerb's outer face down into the terrace.
    for (let k = 0; k < n; k++) {
      const a = at(k, Q.r, top),
        b = at(k + 1, Q.r, top),
        c = at(k + 1, Q.r, P.pad - 0.06),
        d = at(k, Q.r, P.pad - 0.06);
      tri(a, b, c, tones[2]);
      tri(a, c, d, tones[2]);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    geometry.computeVertexNormals();
    solid(g, geometry, '#ffffff', 'stone', { shadow: false, ground: true, name: 'tropic-court' });
    // The drum: dark granite turned from its profile (radius, height over the court), its top ring paler.
    const dark = new T.Color(L.drum),
      pale = new T.Color(L.drumRing),
      profile: [number, number, T.Color][] = [
        [C.centre, -0.02, dark],
        [C.centre, C.drum - 0.02, dark],
        [C.centre - 0.02, C.drum, pale],
        [C.centre - 0.09, C.drum, pale],
        [C.centre - 0.09, C.drum, dark],
        [0, C.drum, dark],
      ],
      sides = 28,
      dp: number[] = [],
      dc: number[] = [];
    for (let k = 0; k < sides; k++)
      for (let j = 0; j + 1 < profile.length; j++) {
        const [r0, y0, t0] = profile[j],
          [r1, y1, t1] = profile[j + 1];
        if (r0 === r1 && y0 === y1) continue;
        const p = (rr: number, yy: number, kk: number) => [cx + Math.cos((kk / sides) * Math.PI * 2) * rr, top + yy, cz + Math.sin((kk / sides) * Math.PI * 2) * rr];
        const quad = [p(r0, y0, k), p(r0, y0, k + 1), p(r1, y1, k + 1), p(r1, y1, k)],
          tone = j === 2 ? pale : t0 === t1 ? t0 : dark;
        // Outward and up: the profile runs from the foot up and in, so (a, d, c) and (a, c, b) face
        // out; at the middle (r1 nought) only the second is a triangle.
        for (const [a, b, c] of r1 > 0 ? [[quad[0], quad[3], quad[2]], [quad[0], quad[2], quad[1]]] : [[quad[0], quad[2], quad[1]]]) {
          dp.push(...a, ...b, ...c);
          for (let i = 0; i < 3; i++) dc.push(tone.r, tone.g, tone.b);
        }
      }
    const drum = new T.BufferGeometry();
    drum.setAttribute('position', new T.Float32BufferAttribute(dp, 3));
    drum.setAttribute('color', new T.Float32BufferAttribute(dc, 3));
    drum.computeVertexNormals();
    solid(g, drum, '#ffffff', 'stone', { name: 'tropic-court-drum' });
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
    const stone = (bearing: number, at: number, t: number, n: number, half: [number, number, number], detail: number, cuts: [number, number, number, number][], seed: number) => {
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
        turn = new T.Euler(0.22 * (hash(seed * 3.1) - 0.5), Math.atan2(ox, oz) + hash(seed * 5.7) * Math.PI * 2, 0.22 * (hash(seed * 7.9) - 0.5), 'YXZ'),
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
        stone(cl.bearing, cl.at, s.t * cl.size * mirror, s.n * cl.size, s.half.map((h) => h * cl.size * grow) as [number, number, number], s.detail, s.cuts, seed);
      });
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
   * The island's ground into `land` (its own group, in world space): the lawn, the beach, the paths,
   * the court and the rocks; then its shallows into the ground masks (`masks`, max-combined with the
   * town's, town-ground's addTropicShallows), with its foam already in the town's foam mesh (`foam`,
   * its rows from userData.tropicFoam on). Returns the island (TropicIsland), shown.
   */
  function tropicGround(land: T.Group, sea: { foam: T.Mesh; masks: T.DataTexture }): TropicIsland {
    lawn(land);
    shore(land);
    paths(land);
    court(land);
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

  /* ---------------------------------------------------------------- */
  /* The building's slot                                               */
  /* ---------------------------------------------------------------- */
  /**
   * A stand-in for the island's building, in the island's own frame (the model's shell: its root
   * is at the island's middle) on the terrace (TROPIC_BUILDING, TROPIC.pad): a pale podium, a glass
   * stack in panes under white floor bands, the champagne end block, eight slender white columns
   * and the one flat white roof over a dark soffit. It holds the slot the SDE4 (town-sde4.ts's
   * buildSde4, from its own lane) takes at the merge: town-build's 'tropic' branch calls this, and
   * the merge calls buildSde4 there instead. Its panes are glass in panes, so the town's window
   * lights ('campus') reach it as they will the SDE4's.
   */
  function standIn(shell: T.Group) {
    const B = plan.TROPIC_BUILDING,
      floor = P.pad + 0.12,
      box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, colour: string, kind: SurfaceKind) => {
        const m = new T.Mesh(new T.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), material(colour, kind));
        m.position.set((x0 + x1) / 2 + B.x, (y0 + y1) / 2, (z0 + z1) / 2 + B.z);
        m.castShadow = m.receiveShadow = true;
        shell.add(m);
        return m;
      };
    // The podium, the glass stack's floors and its panes (building-local x, z from TROPIC_BUILDING's middle).
    box(-B.hw, B.hw, P.pad - 0.06, floor, -B.hd, B.hd, RESIDENCE_LOOK.stone, 'stone');
    const storeys = [[0, 1.45], [1.65, 2.95], [3.15, 4.45], [4.65, 5.95]];
    storeys.forEach(([y0, y1], k) => {
      if (k) box(-3.7, 2.6, floor + y0 - 0.2, floor + y0, -2.9, 2.7 - 0.12 * k, RESIDENCE_LOOK.dressing, 'stone');
      const front = 1.9 - 0.25 * k,
        x1 = 2.6 - 0.45 * k;
      for (let i = 0; i < 5; i++) {
        const a = -3.7 + ((x1 + 3.7) * i) / 5,
          b = -3.7 + ((x1 + 3.7) * (i + 1)) / 5;
        box(a + 0.04, b - 0.04, floor + y0 + 0.04, floor + y1 - 0.04, front - 0.07, front, palette.studioGlass, 'glass');
        box(a + 0.04, b - 0.04, floor + y0 + 0.04, floor + y1 - 0.04, -2.6, -2.53, palette.studioGlass, 'glass');
      }
      box(x1 - 0.07, x1, floor + y0 + 0.04, floor + y1 - 0.04, -2.53, front - 0.07, palette.studioGlass, 'glass');
      box(-3.7, -3.6, floor + y0 + 0.04, floor + y1 - 0.04, -2.53, front - 0.07, palette.studioGlass, 'glass');
    });
    box(-3.7, 2.6, floor + 5.95, floor + 6.15, -2.9, 2.0, RESIDENCE_LOOK.dressing, 'stone');
    // The champagne end block, as tall as the roof's top.
    box(-5.5, -3.7, floor, floor + 7.3, -3.6, 3.6, RESIDENCE_LOOK.brass, 'paint');
    // The eight slender white columns, and the roof: a white slab over a dark soffit.
    for (const x of [-2.4, 0, 2.4, 4.8])
      for (const z of [-3.15, 3.15]) {
        const m = new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 6.95, 16), material(palette.white, 'paint'));
        m.position.set(x + B.x, floor + 6.95 / 2, z + B.z);
        m.castShadow = m.receiveShadow = true;
        shell.add(m);
      }
    box(-3.7, 5.5, floor + 6.9, floor + 6.97, -3.55, 3.55, '#574d44', 'wood');
    box(-3.7, 5.5, floor + 6.95, floor + 7.3, -3.6, 3.6, palette.white, 'paint');
  }

  return { tropicGround, standIn };
}
export type TropicIslandKit = ReturnType<typeof createTropicIsland>;
