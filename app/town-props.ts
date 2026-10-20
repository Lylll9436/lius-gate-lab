import * as T from 'three';
import type { SurfaceKind } from './city-materials';
import * as plan from './town-plan';
import {
  palette,
  CRANE_BASE,
  HOARDING_THICKNESS,
  hoardingWalls,
  type TownContext,
} from './town-shared';
import type { Kit } from './town-kit';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ellipsoid, mouldedBlock, noise3, roundBox, roundCone, sculpt, squashX, strand, torus, within } from './town-sculpt';

/**
 * The Wellington statue's materials: grey granite (a shade lighter on the cornice and the
 * panels) and the bronze's patina, its verdigris (no more saturated than the copper roofs) and
 * the worn bright bronze where it is rubbed (no more saturated than palette.bronze).
 */
const STATUE = {
  granite: '#aca598', cornice: '#b2ab9e', panel: '#b2ab9e',
  plate: '#575645', patina: '#735f46', verdigris: '#7fae9c', worn: '#a8865a',
};

/** One step of a turned or cast profile: radius r (a polygon's apothem) at height y; `sharp` breaks the shading there (an arris). */
type Turn = { r: number; y: number; sharp?: boolean };
/**
 * A profile swept round the y axis as a lathe does, with mouldedBlock's normals: smooth up the
 * profile except at a `sharp` step. Round, it shades smoothly all the way round; with `facets`,
 * it is a regular polygon of `sides` flat faces, one square to +x (a cast plinth's octagon), each
 * catching the light on its own. Open at both ends unless `cap` closes the top.
 */
function turned(profile: Turn[], sides: number, opts: { facets?: boolean; cap?: boolean } = {}) {
  // The profile's outward normals (out, up) on each segment, then each step's below and above.
  const seg = profile.slice(1).map((q, i) => {
    const dr = q.r - profile[i].r,
      dy = q.y - profile[i].y,
      l = Math.hypot(dr, dy) || 1;
    return [dy / l, -dr / l];
  });
  const rings = profile.map((p, i) => {
    const lo = seg[i - 1], hi = seg[i];
    if (!lo || !hi || p.sharp) return { below: lo ?? hi, above: hi ?? lo };
    const n = [lo[0] + hi[0], lo[1] + hi[1]], l = Math.hypot(n[0], n[1]) || 1, r = [n[0] / l, n[1] / l];
    return { below: r, above: r };
  });
  const half = Math.PI / sides,
    grow = opts.facets ? 1 / Math.cos(half) : 1,
    pos: number[] = [],
    nor: number[] = [];
  // Angle a runs anticlockwise seen from above (x = cos a, z = -sin a); a face's normal turns with
  // its own middle (facets) or with each vertex (round).
  const vert = (p: Turn, a: number, face: number, n: number[]) => {
    const h = opts.facets ? face : a;
    pos.push(p.r * grow * Math.cos(a), p.y, -p.r * grow * Math.sin(a));
    nor.push(Math.cos(h) * n[0], n[1], -Math.sin(h) * n[0]);
  };
  for (let k = 0; k < sides; k++) {
    const face = 2 * k * half,
      a0 = opts.facets ? face - half : face,
      a1 = opts.facets ? face + half : face + 2 * half;
    for (let i = 0; i < profile.length - 1; i++) {
      const p = profile[i], q = profile[i + 1], np = rings[i].above, nq = rings[i + 1].below;
      vert(p, a0, face, np); vert(p, a1, face, np); vert(q, a1, face, nq);
      vert(p, a0, face, np); vert(q, a1, face, nq); vert(q, a0, face, nq);
    }
    if (opts.cap) {
      const top = profile[profile.length - 1];
      pos.push(0, top.y, 0);
      nor.push(0, 1, 0);
      vert(top, a0, face, [0, 1]);
      vert(top, a1, face, [0, 1]);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  return geometry;
}
/**
 * A cast drum through `rows` (radius r at height y) cut into `flutes` flat-bottomed channels:
 * three flat facets round each, a fillet on the full radius and the channel's floor `depth` in,
 * whose walls turn from the light and catch it in turn. The channels run out where a row's `cut`
 * is 0 (the lamp's drum: at its head, in a short slope; at its foot they die into the plinth).
 * Open at both ends.
 */
function flutedDrum(rows: { r: number; y: number; cut: number }[], flutes: number, depth: number) {
  const n = flutes * 3,
    at = (j: number, i: number) => {
      const row = rows[j],
        a = ((i % n) / n) * Math.PI * 2,
        r = row.r - (i % 3 ? depth * row.cut : 0);
      return [r * Math.cos(a), row.y, -r * Math.sin(a)];
    },
    pos: number[] = [];
  for (let j = 0; j < rows.length - 1; j++)
    for (let i = 0; i < n; i++) pos.push(...at(j, i), ...at(j, i + 1), ...at(j + 1, i + 1), ...at(j, i), ...at(j + 1, i + 1), ...at(j + 1, i));
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/*
 * The street furniture's detail kit. Small parts are merged into one geometry per material as
 * they are made (`mergePieces`), so a bandstand's dozens of brackets and rails batch as a few
 * meshes. An extruded outline (`extrude`) is a plate with one 45-degree chamfer round both faces:
 * cheap, and every edge still catches a soft line of light. Thin members are plain unit boxes
 * (12 triangles); nothing is under 0.07 thick, so nothing crawls at the overview.
 */
type V3 = [number, number, number];
/** A part of a merged prop: a geometry placed at `at`, turned by `rotation` (XYZ) and scaled, or placed by `matrix`. */
type Piece = { geometry: T.BufferGeometry; at?: V3; rotation?: V3; scale?: V3; matrix?: T.Matrix4 };
/** Pieces as one geometry, position and normal only (batching writes the surface coordinates). */
function mergePieces(pieces: Piece[]) {
  const m4 = new T.Matrix4(),
    q = new T.Quaternion();
  const parts = pieces.map(({ geometry, at = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], matrix }) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    return g.applyMatrix4(matrix ?? m4.compose(new T.Vector3(...at), q.setFromEuler(new T.Euler(...rotation)), new T.Vector3(...scale)));
  });
  const out = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return out;
}
/** An outline extruded `depth` along z about z = 0, its edges chamfered by c. */
function extrude(shape: T.Shape, depth: number, c = 0.012, curve = 8) {
  return new T.ExtrudeGeometry(shape, {
    depth: depth - 2 * c,
    bevelEnabled: c > 0,
    bevelThickness: c,
    bevelSize: c,
    bevelOffset: -c,
    bevelSegments: 1,
    curveSegments: curve,
  }).translate(0, 0, -depth / 2 + c);
}
/** A rectangle's outline from (x0, y0) to (x1, y1). */
function rectShape(x0: number, y0: number, x1: number, y1: number) {
  return new T.Shape([new T.Vector2(x0, y0), new T.Vector2(x1, y0), new T.Vector2(x1, y1), new T.Vector2(x0, y1)]);
}
/**
 * A rounded rectangle from (x0, y0) to (x1, y1) as a hole's outline, its corners of radius r
 * sampled in n steps each (a round-ended slot when r is half its width).
 */
function slotPath(x0: number, y0: number, x1: number, y1: number, r: number, n = 2) {
  const pts: T.Vector2[] = [];
  for (const [cx, cy, a0] of [[x1 - r, y0 + r, -Math.PI / 2], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, Math.PI / 2], [x0 + r, y0 + r, Math.PI]])
    for (let k = 0; k <= n; k++) {
      const a = a0 + (k / n) * (Math.PI / 2),
        q = new T.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a));
      if (!pts.length || q.distanceTo(pts[pts.length - 1]) > 1e-6) pts.push(q);
    }
  if (pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts.pop();
  return new T.Path(pts);
}
/** A round hole's outline, n points round. */
const circlePath = (x: number, y: number, r: number, n = 10) =>
  new T.Path(Array.from({ length: n }, (_, k) => new T.Vector2(x + r * Math.cos((k / n) * Math.PI * 2), y + r * Math.sin((k / n) * Math.PI * 2))));
const chamferBoxes = new Map<string, T.BufferGeometry>();
/** A w x h x d block about its middle, chamfered by a quarter of its thinnest side (at most 0.02); shared per size. */
function chamferBox(w: number, h: number, d: number) {
  const key = [w, h, d].map((n) => n.toFixed(4)).join('|');
  let g = chamferBoxes.get(key);
  if (!g) chamferBoxes.set(key, (g = extrude(rectShape(-w / 2, -h / 2, w / 2, h / 2), d, Math.min(0.02, 0.25 * Math.min(w, h, d)), 1)));
  return g;
}
const UNIT_BOX = new T.BoxGeometry(1, 1, 1);
/** A straight member w x d in section from a to b (a lattice bar, a strut, a stay). */
function member(a: V3, b: V3, w: number, d = w): Piece {
  const A = new T.Vector3(...a),
    B = new T.Vector3(...b),
    along = B.clone().sub(A),
    length = along.length();
  return {
    geometry: UNIT_BOX,
    matrix: new T.Matrix4().compose(A.add(B).multiplyScalar(0.5), new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), along.normalize()), new T.Vector3(w, length, d)),
  };
}

/* ------------------------------------------------------------------ */
/* Furniture, planting, small things                                   */
/* ------------------------------------------------------------------ */
export function createProps(ctx: TownContext, kit: Kit) {
  const { material, lamps, animated } = ctx;
  const { box, lampGlass } = kit;
  /** Pieces as one mesh in g, in one material; `shadow: false` keeps thin parts out of the shadow maps. */
  function part(g: T.Object3D, pieces: Piece[] | T.BufferGeometry, colour: string, kind: SurfaceKind, shadow = true) {
    const m = new T.Mesh(Array.isArray(pieces) ? mergePieces(pieces) : pieces, material(colour, kind));
    m.castShadow = shadow;
    m.receiveShadow = true;
    if (!shadow) m.userData.noShadow = true;
    g.add(m);
    return m;
  }
  /**
   * A park bench's cast-iron end in its own plane (u forward, v up), 0.07 thick, in one casting:
   * the front leg, the arched rail under the seat, the back leg raked up into the back post, and the
   * arm over an open loop, its front end curled down into the leg.
   */
  const benchEnd = (() => {
    const v = (pts: number[][]) => pts.map(([a, b]) => new T.Vector2(a, b)),
      // A smooth run from `from` through pts, about one sample per point.
      run = (from: number[], pts: number[][]) => new T.SplineCurve(v([from, ...pts])).getPoints(pts.length).slice(1);
    const outline = [
      ...v([[0.255, 0], [0.16, 0]]),
      ...run([0.16, 0], [[0.15, 0.12], [0.135, 0.22], [0.08, 0.29], [0, 0.31], [-0.09, 0.29], [-0.14, 0.22], [-0.16, 0.12], [-0.17, 0]]),
      ...v([[-0.27, 0]]),
      ...run([-0.27, 0], [[-0.245, 0.14], [-0.225, 0.32], [-0.225, 0.48], [-0.25, 0.66], [-0.285, 0.8], [-0.315, 0.9]]),
      ...v([[-0.245, 0.915]]),
      ...run([-0.245, 0.915], [[-0.22, 0.8], [-0.19, 0.69], [-0.1, 0.655], [0.1, 0.655], [0.2, 0.66], [0.262, 0.62], [0.26, 0.56], [0.225, 0.535]]),
      ...run([0.225, 0.535], [[0.235, 0.45], [0.255, 0.3], [0.26, 0.15]]),
    ];
    const s = new T.Shape(outline);
    s.holes.push(slotPath(-0.15, 0.455, 0.17, 0.57, 0.055));
    return extrude(s, 0.07, 0.012, 1).rotateY(-Math.PI / 2);
  })();
  /**
   * A Victorian park bench, 1.24 long and 0.92 tall over its ends: two cast-iron ends (benchEnd)
   * and timber slats, three on the seat and two on the back leaning with the back posts, the gaps
   * between them 0.035 or more so they stay calm at the overview.
   */
  function bench(g: T.Object3D, x: number, y: number, z: number, ry = 0) {
    const b = new T.Group(); b.position.set(x, y, z); b.rotation.y = ry; g.add(b);
    part(b, [-0.56, 0.56].map((sx): Piece => ({ geometry: benchEnd, at: [sx, 0, 0] })), palette.metal, 'iron');
    part(b, [
      ...[0.15, -0.015, -0.18].map((u): Piece => ({ geometry: chamferBox(1.24, 0.07, 0.13), at: [0, 0.405, u] })),
      ...[[-0.21, 0.57], [-0.245, 0.76]].map(([u, h]): Piece => ({ geometry: chamferBox(1.24, 0.13, 0.07), at: [0, h, u], rotation: [-0.245, 0, 0] })),
    ], palette.wood, 'wood');
    return b;
  }
  /**
   * A Sheffield cycle hoop (0.57 wide, 0.49 tall: below a parked bike's bar, which passes over it)
   * along the local x axis: one bent tube, its legs turning into the flat top through round
   * shoulders, on a round foot plate each; thin, so it casts no shadow.
   */
  const hoopTube = (() => {
    const X = 0.25, R = 0.12, top = 0.455, pts: T.Vector3[] = [];
    pts.push(new T.Vector3(-X, -0.02, 0), new T.Vector3(-X, 0.16, 0));
    for (let i = 0; i <= 4; i++) pts.push(new T.Vector3(-X + R - R * Math.cos((i / 4) * (Math.PI / 2)), top - R + R * Math.sin((i / 4) * (Math.PI / 2)), 0));
    pts.push(new T.Vector3(0, top, 0));
    for (let i = 4; i >= 0; i--) pts.push(new T.Vector3(X - R + R * Math.cos((i / 4) * (Math.PI / 2)), top - R + R * Math.sin((i / 4) * (Math.PI / 2)), 0));
    pts.push(new T.Vector3(X, 0.16, 0), new T.Vector3(X, -0.02, 0));
    return new T.TubeGeometry(new T.CatmullRomCurve3(pts, false, 'centripetal'), 30, 0.035, 6, false);
  })();
  function cycleHoop(g: T.Object3D, x: number, y: number, z: number) {
    const h = new T.Group(); h.position.set(x, y, z); g.add(h);
    const steel = '#7d8288'; // galvanised, paler than the street iron, so the hoops part from the tyres
    part(h, [
      { geometry: hoopTube },
      ...[-0.25, 0.25].map((sx): Piece => ({ geometry: new T.CylinderGeometry(0.065, 0.07, 0.02, 10), at: [sx, 0.01, 0] })),
    ], steel, 'iron', false);
    return h;
  }
  // Every street and pier lantern shares one glass; the frame loop sets the same glow on all of them.
  const lanternGlass = lampGlass();
  lanternGlass.emissiveIntensity = 0;
  /**
   * A lamp standard's parts for a lantern whose middle is at H, made once per height and shared by
   * every lamp (batching copies them into the merged meshes). Everything from the shaft up moves
   * with H. The thin parts (`cast: false`: the lantern's corner bars and the scrolls) stay out of
   * the shadow maps, where thin casters ghost. `name` marks the parts the town checks measure.
   */
  type LampPart = { geometry: T.BufferGeometry; colour: string; kind: SurfaceKind; cast: boolean; name: string };
  const lampSets = new Map<number, { parts: LampPart[]; glass: T.BufferGeometry }>();
  function lampSet(H: number) {
    const known = lampSets.get(H);
    if (known) return known;
    const up = H - 1.8,
      iron = palette.metal,
      parts: LampPart[] = [],
      add = (geometry: T.BufferGeometry, colour = iron, kind: SurfaceKind = 'iron', cast = true, name = '') => parts.push({ geometry, colour, kind, cast, name });
    // The base: an octagonal plinth of two chamfered steps (0.34 across its flats), a fluted drum
    // and the brass collar on its head.
    add(turned([
      { r: 0.17, y: 0 }, { r: 0.17, y: 0.08, sharp: true }, { r: 0.154, y: 0.096, sharp: true }, { r: 0.138, y: 0.096, sharp: true },
      { r: 0.138, y: 0.17, sharp: true }, { r: 0.124, y: 0.186, sharp: true },
    ], 8, { facets: true, cap: true }));
    add(flutedDrum([{ r: 0.126, y: 0.184, cut: 1 }, { r: 0.118, y: 0.46, cut: 1 }, { r: 0.112, y: 0.495, cut: 0 }], 8, 0.024));
    add(turned([{ r: 0.108, y: 0.49 }, { r: 0.13, y: 0.503 }, { r: 0.137, y: 0.53 }, { r: 0.13, y: 0.557 }, { r: 0.108, y: 0.57 }], 10), palette.brass, 'brass');
    // The shaft tapers from 0.092 to 0.07 between its foot (a cavetto off the collar) and the boss,
    // with a bead a third of the way up and a fatter ring the scrolls spring from.
    const top = 1.315 + up,
      bar = 1.36 + up,
      rs = (y: number) => T.MathUtils.lerp(0.092, 0.07, (y - 0.65) / (top - 0.65)),
      bead = (y: number, proud: number): Turn[] =>
        [-0.03, -0.017, 0, 0.017, 0.03].map((d, k) => ({ r: rs(y + d) + proud * [0, 0.75, 1, 0.75, 0][k], y: y + d }));
    add(turned([
      { r: 0.11, y: 0.565 }, { r: 0.1, y: 0.6 }, { r: rs(0.65), y: 0.65 },
      ...bead(0.86 + up * 0.5, 0.026), ...bead(bar - 0.25, 0.03),
      // The boss the ladder bar passes through, a neck, and the bell collar carrying the tray.
      { r: rs(top), y: top }, { r: 0.088, y: bar - 0.035 }, { r: 0.088, y: bar + 0.035 }, { r: 0.064, y: bar + 0.062 },
      { r: 0.098, y: bar + 0.105 }, { r: 0.112, y: bar + 0.132 }, { r: 0.104, y: bar + 0.155 },
    ], 8));
    // The ladder bar: a round arm with a ball at each end, 0.58 long, through the boss. It and its
    // scrolls run square to the overview's line of sight (a diagonal of the town's grid), so the
    // opening views see both arms and both scrolls rather than one arm in front of the shaft.
    const across = Math.PI / 4;
    add(turned([
      { r: 0, y: -0.29 }, { r: 0.046, y: -0.278 }, { r: 0.054, y: -0.25 }, { r: 0.036, y: -0.22 },
      { r: 0.036, y: 0.22 }, { r: 0.054, y: 0.25 }, { r: 0.046, y: 0.278 }, { r: 0, y: 0.29 },
    ], 8).rotateZ(-Math.PI / 2).rotateY(across).translate(0, bar, 0), iron, 'iron', true, 'ladder-bar');
    // A scroll under each arm: from the shaft below the boss, out and up into the arm by its ball.
    const scroll = new T.TubeGeometry(
      new T.CatmullRomCurve3([[0.03, -0.25], [0.085, -0.244], [0.14, -0.215], [0.18, -0.162], [0.203, -0.098], [0.213, -0.035], [0.215, 0.005]].map(([px, py]) => new T.Vector3(px, bar + py, 0)), false, 'centripetal'),
      8, 0.036, 5, false,
    );
    add(scroll.clone().rotateY(across), iron, 'iron', false, 'scroll');
    add(scroll.rotateY(across + Math.PI), iron, 'iron', false, 'scroll');
    // The lantern: a tray under it, four panes between corner bars, 0.32 across at the foot and
    // 0.4 at the head, a cornice and a bell-cast roof, then the vent cap and the brass finial.
    const foot = H - 0.2, head = H + 0.2, low = 0.16, high = 0.2;
    add(mouldedBlock(0.19, 0.19, [
      { s: 0.075, y: foot - 0.1 }, { s: 0.05, y: foot - 0.072 }, { s: 0.018, y: foot - 0.034 }, { s: 0, y: foot - 0.014, sharp: true }, { s: 0, y: foot + 0.02, sharp: true },
    ], 0.03, 1));
    // Each bar stands 0.0175 proud of its corner and covers 0.0575 of either pane beside it.
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sz]) => {
      const a = new T.Vector3(sx * (low - 0.02), foot - 0.01, sz * (low - 0.02)),
        b = new T.Vector3(sx * (high - 0.02), head - 0.01, sz * (high - 0.02)),
        along = b.clone().sub(a);
      return new T.BoxGeometry(0.075, along.length(), 0.075)
        .applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), along.normalize()))
        .translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    });
    add(mergeGeometries(corners, false)!, iron, 'iron', false, 'corner-bars');
    corners.forEach((c) => c.dispose());
    add(mouldedBlock(0.235, 0.235, [
      { s: 0.03, y: head - 0.025 }, { s: 0, y: head + 0.016, sharp: true }, { s: 0, y: head + 0.05, sharp: true },
      { s: 0.02, y: head + 0.066, sharp: true }, { s: 0.075, y: head + 0.092 }, { s: 0.122, y: head + 0.13 }, { s: 0.153, y: head + 0.18 },
      { s: 0.167, y: head + 0.24, sharp: true },
    ], 0.035, 1));
    add(turned([
      { r: 0.066, y: head + 0.23 }, { r: 0.066, y: head + 0.275, sharp: true }, { r: 0.053, y: head + 0.283, sharp: true }, { r: 0.053, y: head + 0.295, sharp: true },
      { r: 0.09, y: head + 0.303, sharp: true }, { r: 0.093, y: head + 0.32 }, { r: 0.064, y: head + 0.35 }, { r: 0.032, y: head + 0.37 }, { r: 0.028, y: head + 0.385 },
    ], 8));
    add(turned([
      { r: 0.026, y: head + 0.377 }, { r: 0.045, y: head + 0.395 }, { r: 0.05, y: head + 0.422 }, { r: 0.036, y: head + 0.449 }, { r: 0, y: head + 0.48 },
    ], 8), palette.brass, 'brass');
    // The glass, about its middle: a four-sided frustum with flat panes, wider at the top.
    const glass = new T.CylinderGeometry(high * Math.SQRT2, low * Math.SQRT2, head - foot, 4).rotateY(Math.PI / 4).toNonIndexed();
    glass.computeVertexNormals();
    const set = { parts, glass };
    lampSets.set(H, set);
    return set;
  }
  /**
   * A Glasgow cast-iron lamp standard, 2.48 tall on a 0.34 octagonal plinth (see lampSet), in
   * muted iron with two brass accents (the collar on the base, round so it sweeps a highlight,
   * and the finial). The lantern glass (its middle at `height`) is the lamps entry the night loop
   * lights; the frame round it stays iron, so the panes glow and the frame stays dark.
   */
  function lamp(g: T.Object3D, x: number, z: number, height = 1.8, y = plan.terrainHeight(x, z)) {
    const post = new T.Group();
    post.position.set(x, y, z);
    // Square to the world whatever g's turn (the pier's), so every ladder bar crosses the
    // overview's line of sight the same way.
    post.rotation.y = -new T.Euler().setFromQuaternion(g.getWorldQuaternion(new T.Quaternion()), 'YXZ').y;
    g.add(post);
    const { parts, glass } = lampSet(height);
    for (const part of parts) {
      const m = new T.Mesh(part.geometry, material(part.colour, part.kind));
      m.name = part.name;
      m.castShadow = part.cast;
      m.receiveShadow = true;
      if (!part.cast) m.userData.noShadow = true;
      post.add(m);
    }
    const lantern = new T.Mesh(glass, lanternGlass);
    lantern.position.y = height;
    lantern.castShadow = false;
    post.add(lantern);
    lamps.push(lantern);
    return post;
  }
  /**
   * The lenses: dark glass tinted red, amber or green (`dark`), and lit by their own emissive
   * (`lit`), a clear bright red, amber or green that reads by day and at night with nothing
   * spilling off the glass. The light alone carries a lit lens's colour: sunlight on a bright base
   * as well would wash it out to salmon and peach under the tone curve. `on` says which aspects
   * light it (red and amber both show in red+amber). These may be the most saturated small accents
   * in the frame after the grade.
   */
  const LENSES: { lit: string; dark: string; on: (a: plan.Aspect) => boolean }[] = [
    { lit: '#ff3426', dark: '#3d1c19', on: (a) => a === 'red' || a === 'redAmber' },
    { lit: '#ffa21f', dark: '#3d2d16', on: (a) => a === 'amber' || a === 'redAmber' },
    { lit: '#1fe39b', dark: '#163a2c', on: (a) => a === 'green' },
  ];
  /** A lit lens's emissive intensity; an unlit one has none. */
  const LENS_GLOW = 0.95;
  /**
   * UK traffic signals at the ring's three junctions (plan.signalPosts), two each: a slim iron pole
   * on a small foot, a black head with three round lenses (red over amber over green) under short
   * visors, and a narrow black backboard, in the street lamps' chunky proportions and about their
   * height. No lettering, no signs. Poles, heads, visors and boards batch with the land; the lenses
   * stay apart (keepSeparate), one small mesh and one material per lens, all made here at build time.
   * The frame loop (the animated entry) re-reads each signal's aspect from town time
   * (plan.signalState) and sets a lens's emissive intensity only when its signal changes, so no
   * aspect ever compiles a shader or adds a program: the lens material is the lanterns' plain
   * standard one. Like the lamps they take no pointer, follow the town's Plan tints and hide with it
   * in Inspect; paused or under reduced motion, town time holds and so do they.
   */
  function trafficSignals(g: T.Object3D) {
    const root = new T.Group();
    root.name = 'traffic-signals';
    root.userData.prebatched = true; // the static parts batch with the land; the lenses stay apart
    g.add(root);
    const black = palette.ink,
      lensGeometry = new T.CylinderGeometry(0.078, 0.078, 0.03, 14).rotateX(Math.PI / 2),
      HEAD_Y = 1.47,
      PITCH = 0.225;
    const heads = plan.signalPosts.map((p) => {
      const post = new T.Group();
      post.position.set(p.x, plan.pavementTop(p.x, p.z) + plan.terrainHeight(p.x, p.z), p.z); // lower where it stands in a dropped crossing
      post.rotation.y = p.heading;
      root.add(post);
      box(post, 0, 0.05, 0, 0.2, 0.1, 0.2, palette.metal, 'iron'); // foot
      const pole = new T.Mesh(new T.CylinderGeometry(0.045, 0.052, 1.1, 10, 1, true), material(palette.metal, 'iron'));
      pole.position.y = 0.1 + 0.55; // into the head's underside
      pole.castShadow = pole.receiveShadow = true;
      post.add(pole);
      box(post, 0, HEAD_Y, 0, 0.27, 0.72, 0.2, black, 'enamel'); // head, 1.11..1.83
      box(post, 0, HEAD_Y, -0.12, 0.43, 0.88, 0.04, black, 'enamel'); // backboard, behind the head
      const lenses = new T.Group();
      lenses.userData.keepSeparate = true;
      post.add(lenses);
      const meshes = LENSES.map((look, k) => {
        const y = HEAD_Y + PITCH * (1 - k);
        // A short visor over each lens: a longer one would hide the lit glass from the high camera.
        box(post, 0, y + 0.095, 0.12, 0.19, 0.02, 0.04, black, 'enamel');
        const lens = new T.Mesh(
          lensGeometry,
          new T.MeshStandardMaterial({ color: look.dark, emissive: look.lit, emissiveIntensity: 0, roughness: 0.3, metalness: 0 }),
        );
        lens.material.name = 'signal-lens';
        lens.position.set(0, y, 0.112);
        lens.castShadow = lens.receiveShadow = false;
        lenses.add(lens);
        return lens;
      });
      return { post: p, meshes, shown: '' as plan.Aspect | '' };
    });
    const update = (time: number) => {
      for (const head of heads) {
        const aspect = plan.signalState(head.post.junction, head.post.approach, time);
        if (aspect === head.shown) continue;
        head.shown = aspect;
        head.meshes.forEach((lens, k) => (lens.material.emissiveIntensity = LENSES[k].on(aspect) ? LENS_GLOW : 0));
      }
    };
    update(0);
    animated.push({ object: root, update });
    return root;
  }
  /**
   * The K6 roof over a square of half-width h from y0: each face's top edge is a segmental arch
   * rising s at its middle, and the roof between them a shallow dome, the sum of the two arches
   * (s twice over at the middle, nothing at the corners). Smooth on top, crisp at the arched edges,
   * with a flat tympanum under each arch down to `foot`.
   */
  function k6Roof(h: number, y0: number, s: number, foot: number) {
    const n = 12,
      arch = (u: number) => s * (1 - (u / h) ** 2),
      top = new T.BufferGeometry(),
      pos: number[] = [],
      index: number[] = [];
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        const x = -h + (2 * h * i) / n,
          z = -h + (2 * h * j) / n;
        pos.push(x, y0 + arch(x) + arch(z), z);
      }
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        index.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
      }
    top.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    top.setIndex(index);
    top.computeVertexNormals();
    const sides: number[] = [];
    for (let i = 0; i < n; i++) {
      const u0 = -h + (2 * h * i) / n,
        u1 = u0 + (2 * h) / n;
      sides.push(u0, foot, h, u1, foot, h, u1, y0 + arch(u1), h, u0, foot, h, u1, y0 + arch(u1), h, u0, y0 + arch(u0), h);
    }
    const face = new T.BufferGeometry();
    face.setAttribute('position', new T.Float32BufferAttribute(sides, 3));
    face.computeVertexNormals();
    return mergePieces([{ geometry: top }, ...[0, 1, 2, 3].map((k): Piece => ({ geometry: face, rotation: [0, (k * Math.PI) / 2, 0] }))]);
  }
  /** The abstract crown on a K6 tympanum: a band under three round lobes, 0.15 x 0.06, never a cipher. */
  const k6Crown = (() => {
    const s = new T.Shape();
    s.moveTo(-0.075, 0);
    s.lineTo(0.075, 0);
    s.lineTo(0.075, 0.03);
    for (const cx of [0.05, 0, -0.05]) s.absarc(cx, 0.03, 0.025, 0, Math.PI, false);
    s.lineTo(-0.075, 0);
    return extrude(s, 0.03, 0, 3);
  })();
  /**
   * A red K6 kiosk, 0.84 square on its plinth and 2.06 tall: a stone plinth, a moulded red skirt,
   * a body framed by four corner posts, on each face a glazed door or window divided into three
   * columns and six rows by glazing bars (one pane each, a cool light all night), a blank cream
   * sign band under a moulded cornice, and the K6's domed roof: an arched head on every face (a
   * rolled rim over a tympanum with an abstract crown in relief) and a shallow dome between them.
   */
  function phoneBox(g: T.Object3D, x: number, y: number, z: number, ry = 0) {
    const p = new T.Group(); p.position.set(x, y, z); p.rotation.y = ry; g.add(p);
    const red = palette.boat; // the palette's accent red
    part(p, mouldedBlock(0.42, 0.42, [{ s: 0, y: 0 }, { s: 0, y: 0.165, sharp: true }, { s: 0.035, y: 0.2, sharp: true }], 0.03, 1), palette.stoneDark, 'stone');
    const body: Piece[] = [
      { geometry: mouldedBlock(0.385, 0.385, [{ s: 0, y: 0.2 }, { s: 0, y: 0.32, sharp: true }, { s: 0.015, y: 0.34 }, { s: 0.03, y: 0.36, sharp: true }], 0.03, 2) },
      { geometry: chamferBox(0.66, 1.4, 0.66), at: [0, 1.06, 0] },
      { geometry: mouldedBlock(0.39, 0.39, [{ s: 0.03, y: 1.715 }, { s: 0, y: 1.74 }, { s: 0, y: 1.765, sharp: true }, { s: 0.012, y: 1.78, sharp: true }], 0.04, 2) },
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz): Piece => ({ geometry: chamferBox(0.11, 1.36, 0.11), at: [sx * 0.315, 1.04, sz * 0.315] }))),
    ];
    const bars: Piece[] = [];
    // Each arched head's rolled rim, along the arch just proud of the tympanum.
    const rim = new T.TubeGeometry(
      new T.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => {
        const u = -0.375 + (0.75 * i) / 8;
        return new T.Vector3(u, 1.78 + 0.14 * (1 - (u / 0.375) ** 2) - 0.012, 0.378);
      })),
      10, 0.035, 5, false,
    );
    for (let k = 0; k < 4; k++) {
      const turn = (k * Math.PI) / 2,
        on = (at: V3): V3 => [at[0] * Math.cos(turn) + at[2] * Math.sin(turn), at[1], -at[0] * Math.sin(turn) + at[2] * Math.cos(turn)];
      const pane = box(p, ...on([0, 1.0, 0.336]), 0.46, 1.0, 0.02, palette.glass, 'glass', { ry: turn });
      pane.userData.window = 'kiosk'; // a cool light all night
      body.push(
        { geometry: rim, rotation: [0, turn, 0] },
        { geometry: k6Crown, at: on([0, 1.795, 0.384]), rotation: [0, turn, 0] },
        // The door or window frame: head and sill rails and two stiles over the glass's edges.
        ...[0.47, 1.53].map((h): Piece => ({ geometry: chamferBox(0.52, 0.06, 0.05), at: on([0, h, 0.35]), rotation: [0, turn, 0] })),
        ...[-1, 1].map((s): Piece => ({ geometry: chamferBox(0.05, 1.12, 0.05), at: on([s * 0.245, 1.0, 0.35]), rotation: [0, turn, 0] })),
        { geometry: chamferBox(0.52, 0.05, 0.05), at: on([0, 1.69, 0.35]), rotation: [0, turn, 0] },
      );
      // The glazing bars: three columns and six rows of small panes.
      for (const u of [-0.077, 0.077]) bars.push({ geometry: UNIT_BOX, at: on([u, 1.0, 0.348]), rotation: [0, turn, 0], scale: [0.045, 1.0, 0.03] });
      for (let r = 1; r < 6; r++) bars.push({ geometry: UNIT_BOX, at: on([0, 0.5 + r / 6, 0.348]), rotation: [0, turn, 0], scale: [0.46, 0.045, 0.03] });
      // The sign band, blank, between the window's head and the frieze rail.
      box(p, ...on([0, 1.612, 0.338]), 0.48, 0.1, 0.03, palette.white, 'enamel', { ry: turn });
    }
    part(p, body, red, 'enamel');
    // The dome in a matte finish: clear-coated, its top caught the sky as a pale pink spot.
    part(p, k6Roof(0.375, 1.78, 0.14, 1.76), red, 'paint');
    part(p, bars, red, 'enamel');
    return p;
  }
  /**
   * A cast-iron litter bin, 0.48 across and 0.87 tall: a moulded foot, a fluted body painted deep
   * green, a brass band, the dark opening under the lid, and a domed iron lid with a knob.
   */
  function bin(g: T.Object3D, x: number, y: number, z: number) {
    const b = new T.Group(); b.position.set(x, y, z); g.add(b);
    const green = palette.greenDoor;
    part(b, [
      { geometry: turned([{ r: 0.215, y: 0 }, { r: 0.222, y: 0.03, sharp: true }, { r: 0.234, y: 0.05 }, { r: 0.224, y: 0.072 }, { r: 0.206, y: 0.088 }, { r: 0.2, y: 0.1 }], 14) },
      { geometry: flutedDrum([{ r: 0.2, y: 0.095, cut: 0 }, { r: 0.205, y: 0.135, cut: 1 }, { r: 0.215, y: 0.5, cut: 1 }, { r: 0.215, y: 0.53, cut: 0 }], 12, 0.02) },
    ], green, 'enamel');
    part(b, turned([{ r: 0.21, y: 0.515 }, { r: 0.232, y: 0.53 }, { r: 0.238, y: 0.555 }, { r: 0.232, y: 0.58 }, { r: 0.21, y: 0.595 }], 16), palette.brass, 'brass');
    part(b, turned([{ r: 0.2, y: 0.59 }, { r: 0.19, y: 0.6, sharp: true }, { r: 0.19, y: 0.675 }], 14), palette.ink, 'iron');
    part(b, turned([
      { r: 0.19, y: 0.67 }, { r: 0.25, y: 0.67, sharp: true }, { r: 0.256, y: 0.69 }, { r: 0.25, y: 0.71, sharp: true }, { r: 0.238, y: 0.72 },
      { r: 0.2, y: 0.758 }, { r: 0.13, y: 0.788 }, { r: 0.06, y: 0.804 }, { r: 0.034, y: 0.81, sharp: true }, { r: 0.045, y: 0.83 }, { r: 0.04, y: 0.856 }, { r: 0, y: 0.868 },
    ], 14), palette.metal, 'iron');
  }
  /**
   * The park bandstand, a Victorian cast-iron bandstand on an octagonal plan (its faces square to
   * the axes, the entrance to +z), 3.72 across its plinth and 4.7 to the finial's tip:
   * - a stone plinth (ashlar) with a moulded foot and an overhanging moulded coping, three steps up
   *   to the entrance and a timber floor;
   * - eight slender cream-painted iron columns on square pedestals, each with a moulded base, a
   *   band where the railing meets it, a necking bead, a bell capital and an abacus;
   * - between them (but for the entrance) a cast railing panel pierced with a roundel and four
   *   round-ended slots, under a handrail;
   * - an arched, pierced bracket under the frieze in every bay, and over it the frieze: plates
   *   pierced with three roundels between a bottom and a middle rail, with a console over each
   *   column, and a moulded cornice under the eaves;
   * - an ogee roof of verdigris copper (convex at the eaves, sweeping up concave to a neck), a
   *   rolled rib on every hip, and a brass ball finial and spike on a copper collar.
   * The eaves overhang the frieze by 0.4 only: at the overview's 42-degree elevation they hide
   * what is in the frieze's plane above about 0.37 under them, so the roundels and the brackets
   * sit in the frieze's lower half. Thin parts are merged per material, so they all cast.
   */
  function pavilion(g: T.Object3D, x: number, y: number, z: number) {
    const p = new T.Group(); p.position.set(x, y, z); g.add(p);
    const CREAM = palette.frame, // painted cast iron
      FLOOR = 0.47,
      FRIEZE = 2.32, // the frieze's foot, on the capitals' abaci
      EAVE = 2.86, // the soffit
      R = 1.55, // the columns' circle
      A = R * Math.cos(Math.PI / 8), // the columns' face line, 1.432
      span = 2 * R * Math.sin(Math.PI / 8), // between column centres, 1.186
      corner = (i: number) => Math.PI / 8 + (i * Math.PI) / 4, // from +z: x = sin, z = cos
      face = (i: number) => ((i + 1) * Math.PI) / 4, // the bay between corners i and i + 1 (7 is the entrance)
      atAngle = (th: number, r: number, h: number): V3 => [r * Math.sin(th), h, r * Math.cos(th)];
    // The plinth: a moulded foot, the die (one course of ashlar) and a coping with a rounded edge.
    part(p, turned([
      { r: 1.86, y: 0 }, { r: 1.86, y: 0.06, sharp: true }, { r: 1.82, y: 0.09, sharp: true }, { r: 1.8, y: 0.1, sharp: true },
      { r: 1.8, y: 0.3, sharp: true }, { r: 1.83, y: 0.315 }, { r: 1.86, y: 0.34 }, { r: 1.87, y: 0.37, sharp: true }, { r: 1.87, y: 0.41, sharp: true }, { r: 1.84, y: 0.44, sharp: true },
    ], 8, { facets: true, cap: true }), palette.stoneDark, 'ashlar');
    // Three steps up to the entrance, each running back under the one above.
    part(p, [0.33, 0.22, 0.11].map((h, k): Piece => ({ geometry: chamferBox(1.02, h, 0.32 + 0.21 * k), at: [0, h / 2, 1.75 + (0.32 + 0.21 * k) / 2] })), palette.stoneDark, 'ashlar');
    part(p, turned([{ r: 1.68, y: 0.43 }, { r: 1.68, y: FLOOR, sharp: true }], 8, { facets: true, cap: true }), '#b08a62', 'wood');
    // The columns.
    const shaft = (h: number) => T.MathUtils.lerp(0.07, 0.058, (h - 0.75) / (2.1 - 0.75)),
      bead = (h: number, proud: number): Turn[] => [{ r: shaft(h - 0.025), y: h - 0.025 }, { r: shaft(h) + proud, y: h }, { r: shaft(h + 0.025), y: h + 0.025 }];
    const column = turned([
      { r: 0.096, y: 0.62 }, { r: 0.104, y: 0.645 }, { r: 0.096, y: 0.67 }, { r: 0.08, y: 0.69, sharp: true }, { r: 0.074, y: 0.71, sharp: true },
      { r: shaft(0.75), y: 0.75 }, ...bead(0.93, 0.024), ...bead(2.06, 0.022),
      { r: 0.064, y: 2.11 }, { r: 0.078, y: 2.16 }, { r: 0.1, y: 2.21 }, { r: 0.128, y: 2.255, sharp: true }, { r: 0.128, y: 2.27, sharp: true },
    ], 8);
    const iron: Piece[] = [];
    for (let i = 0; i < 8; i++) {
      const th = corner(i);
      iron.push(
        { geometry: column, at: atAngle(th, R, 0) },
        { geometry: chamferBox(0.2, 0.15, 0.2), at: atAngle(th, R, FLOOR + 0.075), rotation: [0, th, 0] }, // pedestal
        { geometry: chamferBox(0.27, 0.05, 0.27), at: atAngle(th, R, FRIEZE - 0.025), rotation: [0, th, 0] }, // abacus
      );
    }
    // The railing panels, the arched brackets and the frieze, bay by bay.
    const hw = span / 2 - 0.065;
    const railing = (() => {
      const s = rectShape(-hw, 0, hw, 0.42);
      s.holes.push(circlePath(0, 0.21, 0.1));
      for (const c of [-0.37, -0.22, 0.22, 0.37]) s.holes.push(slotPath(c - 0.04, 0.08, c + 0.04, 0.34, 0.04));
      return extrude(s, 0.07, 0, 1);
    })();
    const bracket = (() => {
      const w = span / 2 - 0.05,
        s = new T.Shape();
      s.moveTo(-w, 0);
      s.lineTo(w, 0);
      s.lineTo(w, -0.42);
      s.absellipse(0, -0.42, w, 0.31, 0, Math.PI, false);
      s.lineTo(-w, 0);
      for (const c of [-1, 1]) s.holes.push(circlePath(c * 0.42, -0.12, 0.05, 8));
      return extrude(s, 0.07, 0, 5);
    })();
    const frieze = (() => {
      const s = rectShape(-0.61, 0, 0.61, EAVE - FRIEZE);
      for (const c of [-0.3, 0, 0.3]) s.holes.push(circlePath(c, 0.14, 0.065));
      return extrude(s, 0.07, 0, 1);
    })();
    for (let i = 0; i < 8; i++) {
      const th = face(i),
        turn: V3 = [0, th, 0];
      if (i !== 7)
        iron.push(
          { geometry: railing, at: atAngle(th, A, FLOOR), rotation: turn },
          { geometry: chamferBox(2 * hw + 0.03, 0.06, 0.11), at: atAngle(th, A, FLOOR + 0.45), rotation: turn }, // handrail
        );
      iron.push(
        { geometry: bracket, at: atAngle(th, A, FRIEZE), rotation: turn },
        { geometry: frieze, at: atAngle(th, A + 0.02, FRIEZE), rotation: turn },
        ...[0.03, 0.27].map((h): Piece => ({ geometry: chamferBox(1.24, 0.06, 0.12), at: atAngle(th, A + 0.02, FRIEZE + h), rotation: turn })), // its rails
        { geometry: chamferBox(0.17, EAVE - FRIEZE - 0.02, 0.17), at: atAngle(corner(i), R + 0.02, (FRIEZE + EAVE) / 2), rotation: [0, corner(i), 0] }, // console over the column
      );
    }
    // The cornice under the eaves, and the ceiling.
    iron.push({ geometry: turned([{ r: 0, y: EAVE - 0.06 }, { r: A + 0.03, y: EAVE - 0.06, sharp: true }, { r: A + 0.09, y: EAVE - 0.03 }, { r: A + 0.16, y: EAVE, sharp: true }], 8, { facets: true }) });
    part(p, iron, CREAM, 'enamel');
    // The roof: the soffit, a fascia and the ogee, faceted on the plan, smooth up its profile.
    const ogee: Turn[] = [
      { r: 1.86, y: 2.94, sharp: true }, { r: 1.8, y: 3.06 }, { r: 1.68, y: 3.18 }, { r: 1.5, y: 3.29 }, { r: 1.28, y: 3.37 }, { r: 1.04, y: 3.44 },
      { r: 0.8, y: 3.51 }, { r: 0.58, y: 3.6 }, { r: 0.4, y: 3.72 }, { r: 0.28, y: 3.87 }, { r: 0.2, y: 4.04 }, { r: 0.15, y: 4.2, sharp: true },
    ];
    part(p, turned([{ r: A + 0.1, y: EAVE }, { r: 1.82, y: EAVE + 0.02, sharp: true }, { r: 1.86, y: EAVE + 0.03, sharp: true }, ...ogee], 8, { facets: true }), palette.copper, 'copper');
    // A rolled rib up every hip, sitting on the roof's corner line.
    const grow = 1 / Math.cos(Math.PI / 8),
      ribs: Piece[] = [];
    const hip = new T.TubeGeometry(new T.CatmullRomCurve3(ogee.map((q) => new T.Vector3(0, q.y + 0.02, q.r * grow + 0.01))), 14, 0.04, 5, false);
    // Each rib ends at the eaves in a round knob.
    const knob = new T.IcosahedronGeometry(0.065, 1);
    for (let i = 0; i < 8; i++) ribs.push({ geometry: hip, rotation: [0, corner(i), 0] }, { geometry: knob, at: atAngle(corner(i), ogee[0].r * grow + 0.02, ogee[0].y + 0.03) });
    ribs.push({ geometry: turned([{ r: 0.2, y: 4.15 }, { r: 0.21, y: 4.19 }, { r: 0.2, y: 4.24 }, { r: 0.13, y: 4.26, sharp: true }], 10, { cap: true }) }); // collar
    part(p, ribs, palette.copperLight, 'copper');
    part(p, turned([
      { r: 0.05, y: 4.25 }, { r: 0.075, y: 4.29 }, { r: 0.118, y: 4.35 }, { r: 0.12, y: 4.4 }, { r: 0.1, y: 4.45 }, { r: 0.055, y: 4.48, sharp: true },
      { r: 0.04, y: 4.52 }, { r: 0.03, y: 4.62 }, { r: 0, y: 4.72 },
    ], 10), palette.brass, 'brass');
    return p;
  }
  /**
   * The park's memory board: two timber posts on stone shoes, a dark backboard in a moulded
   * frame, a cork face with five blank cards pinned at slight angles (pale tints, never any
   * writing), and a little gabled slate roof on two braces, with bargeboards and a ridge.
   */
  function memoryBoard(g: T.Object3D, x: number, y: number, z: number, ry: number) {
    const b = new T.Group(); b.position.set(x, y, z); b.rotation.y = ry; g.add(b);
    part(b, [-0.62, 0.62].map((dx): Piece => ({ geometry: chamferBox(0.22, 0.14, 0.22), at: [dx, 0.07, 0] })), palette.stoneDark, 'stone');
    const dark: Piece[] = [
      ...[-0.62, 0.62].map((dx): Piece => ({ geometry: chamferBox(0.13, 1.62, 0.13), at: [dx, 0.87, 0] })), // posts
      { geometry: chamferBox(1.14, 0.8, 0.07), at: [0, 1.17, -0.01] }, // backboard
      // Braces from each post up to the eaves, front and back.
      ...[-1, 1].flatMap((s) => [-1, 1].map((sz): Piece => member([s * 0.62, 1.42, 0], [s * 0.62, 1.66, sz * 0.2], 0.07))),
    ];
    part(b, dark, palette.woodDark, 'wood');
    part(b, [
      ...[0.775, 1.565].map((h): Piece => ({ geometry: chamferBox(1.16, 0.08, 0.1), at: [0, h, 0.02] })), // frame rails
      ...[-1, 1].map((s): Piece => ({ geometry: chamferBox(0.08, 0.86, 0.1), at: [s * 0.54, 1.17, 0.02] })), // and stiles
      // Bargeboards up both verges of each gable end.
      ...[-1, 1].flatMap((s) => [-1, 1].map((sz) => member([s * 0.875, 1.68, sz * 0.31], [s * 0.875, 1.87, 0], 0.07, 0.1))),
    ], palette.wood, 'wood');
    part(b, [{ geometry: chamferBox(1.0, 0.71, 0.02), at: [0, 1.17, 0.035] }], '#b58e64', 'paint'); // the cork face
    // Five blank cards, each a tint of its own (vertex colour over a white card).
    const cards: [number, number, number, number, number, string][] = [
      [-0.3, 1.33, 0.26, 0.2, 0.06, palette.white], [0.02, 1.34, 0.22, 0.27, -0.04, '#dfe5e2'], [0.3, 1.3, 0.26, 0.2, 0.05, '#ece2bc'],
      [-0.2, 1.02, 0.3, 0.2, -0.03, '#ecdccf'], [0.24, 1.0, 0.2, 0.22, 0.02, palette.white],
    ];
    const sheet = mergePieces(cards.map(([cx, cy, w, h, rz]): Piece => ({ geometry: UNIT_BOX, at: [cx, cy, 0.052], rotation: [0, 0, rz], scale: [w, h, 0.016] })));
    const tint = new Float32Array(sheet.getAttribute('position').count * 3),
      c = new T.Color();
    cards.forEach((card, k) => {
      c.set(card[5]);
      for (let i = k * 36; i < (k + 1) * 36; i++) c.toArray(tint, i * 3);
    });
    sheet.setAttribute('color', new T.BufferAttribute(tint, 3));
    part(b, sheet, '#ffffff', 'paint');
    // The roof: a gabled slate cap along the board, with a ridge.
    const gable = new T.Shape([new T.Vector2(-0.3, 0), new T.Vector2(0.3, 0), new T.Vector2(0.3, 0.04), new T.Vector2(0, 0.215), new T.Vector2(-0.3, 0.04)]);
    part(b, [
      { geometry: extrude(gable, 1.72, 0.015, 1), at: [0, 1.66, 0], rotation: [0, Math.PI / 2, 0] },
      { geometry: chamferBox(1.78, 0.06, 0.08), at: [0, 1.875, 0] },
    ], palette.slate, 'slate');
    return b;
  }
  /**
   * The tower crane on the reserved plot and its building site.
   * The crane: a lattice mast of four chords braced on every face by horizontals and diagonals
   * (zigzag, the opposite faces' parallel, so the near and far faces read as one lattice rather
   * than a net of crosses), on base plates on its concrete footing. On it the slewing part turns
   * (keepSeparate, animated): the turntable, the slewing platform, an A-frame tower head with a
   * sheave block, the triangular lattice jib (a Warren truss each side, rungs underneath) with its
   * tip frame, the counter-jib with a walkway and rails, the winch and three concrete
   * counterweight slabs, the pendants from the head to the jib and the counter-jib, the trolley
   * on the bottom chords, two hoist ropes to a red hook block, and a bundle of boards on slings.
   * The operator cab hangs beside the jib's root: cream, with a roof cap, a front and a side
   * window in dark frames; its panes are unlit at night (window 'unlit', one light shared with the
   * site cabin's).
   * The site (built into g, inside the hoarding): blank hoarding panels on a grey kick strip
   * under a blue capping rail, posts outside them at every panel joint and a gate of two braced
   * leaves on the road side (west), timber rails and raking props with concrete feet inside;
   * a gravel floor, a site cabin on sleepers, a cement mixer, a ground slab with the formwork for
   * a wall (shutters, soldiers, walers, props and rebar), a stack of boards and a pallet of bricks.
   */
  function crane(g: T.Object3D, x: number, z: number) {
    const Y = palette.gold, // crane yellow, enamelled
      IRON = palette.metal,
      CONCRETE = '#a8a59c';
    const base = new T.Group();
    base.position.set(x, 0, z);
    g.add(base);
    box(base, 0, 0.18, 0, CRANE_BASE, 0.36, CRANE_BASE, '#bdb6a4', 'stone'); // footing
    // The mast: four chords from the footing to 7.56, braced every 1.2.
    const H0 = 0.36,
      SEC = 1.2,
      N = 6,
      M = 0.3,
      TOP = H0 + N * SEC;
    const chords: Piece[] = [],
      plates: Piece[] = [];
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        chords.push({ geometry: chamferBox(0.15, TOP - H0, 0.15), at: [sx * M, (H0 + TOP) / 2, sz * M] });
        plates.push({ geometry: chamferBox(0.3, 0.05, 0.3), at: [sx * M, H0 + 0.025, sz * M] });
        for (const d of [-1, 1]) plates.push({ geometry: chamferBox(0.07, 0.06, 0.07), at: [sx * M + d * 0.1, H0 + 0.07, sz * M - d * 0.1] }); // anchor nuts
      }
    for (let k = 0; k <= N; k++) {
      const h = H0 + k * SEC + (k === 0 ? 0.12 : k === N ? -0.06 : 0);
      for (const s of [-1, 1]) chords.push(member([-M, h, s * M], [M, h, s * M], 0.08), member([s * M, h, -M], [s * M, h, M], 0.08));
      if (k === N) break;
      const h1 = H0 + (k + 1) * SEC - (k + 1 === N ? 0.06 : 0),
        f = k % 2 ? 1 : -1;
      for (const s of [-1, 1]) chords.push(member([-f * M, h, s * M], [f * M, h1, s * M], 0.08), member([s * M, h, -f * M], [s * M, h1, f * M], 0.08));
    }
    part(base, chords, Y, 'enamel');
    part(base, plates, IRON, 'iron');
    // The slewing part.
    const jib = new T.Group();
    jib.position.set(0, 7.86, 0);
    jib.userData.keepSeparate = true;
    base.add(jib);
    const yellow: Piece[] = [],
      iron: Piece[] = [],
      cream: Piece[] = [],
      weights: Piece[] = [],
      boards: Piece[] = [];
    iron.push({ geometry: new T.CylinderGeometry(0.5, 0.5, 0.12, 16), at: [0, -0.24, 0] }); // turntable
    yellow.push({ geometry: chamferBox(1.0, 0.4, 1.0), at: [0, 0.02, 0] }); // slewing platform
    // The tower head: four legs to a sheave block, two rings of ties.
    const head = 2.2,
      leg = (sx: number, sz: number, t: number): V3 => [sx * T.MathUtils.lerp(0.34, 0.07, t), T.MathUtils.lerp(0.22, head, t), sz * T.MathUtils.lerp(0.34, 0.07, t)];
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        yellow.push(member(leg(sx, sz, 0), leg(sx, sz, 1), 0.12));
        for (const t of [0.4, 0.75]) yellow.push(member(leg(sx, sz, t), leg(sx, -sz, t), 0.07), member(leg(sx, sz, t), leg(-sx, sz, t), 0.07));
      }
    iron.push({ geometry: chamferBox(0.28, 0.2, 0.28), at: [0, head + 0.08, 0] }, { geometry: new T.CylinderGeometry(0.1, 0.1, 0.3, 12), at: [0, head + 0.12, 0], rotation: [Math.PI / 2, 0, 0] });
    // The jib: a triangular lattice from the platform to 6.4.
    const J0 = 0.5,
      J1 = 6.4,
      W = 0.27,
      JH = 0.62,
      panels = 9,
      P = (J1 - J0) / panels,
      low = (u: number, s: number): V3 => [u, 0, s * W],
      high = (u: number): V3 => [u, JH, 0];
    for (const s of [-1, 1]) yellow.push({ geometry: chamferBox(J1 - J0, 0.12, 0.12), at: [(J0 + J1) / 2, 0, s * W] });
    yellow.push({ geometry: chamferBox(J1 - J0, 0.13, 0.13), at: [(J0 + J1) / 2, JH, 0] }, { geometry: chamferBox(0.12, 0.7, 0.66), at: [J1, JH / 2, 0] });
    for (let j = 0; j <= panels; j++) {
      const u = J0 + j * P;
      yellow.push(member(low(u, -1), low(u, 1), 0.08));
      if (j === panels) break;
      for (const s of [-1, 1]) yellow.push(member(low(u, s), high(u + P / 2), 0.08), member(high(u + P / 2), low(u + P, s), 0.08));
    }
    // The counter-jib: two beams, rungs, a walkway between rails, the winch and three counterweights.
    const C0 = -0.5,
      C1 = -3.05;
    for (const s of [-1, 1]) {
      yellow.push({ geometry: chamferBox(C0 - C1, 0.16, 0.12), at: [(C0 + C1) / 2, 0, s * 0.3] });
      // The walkway's handrails, painted like the jib.
      for (const u of [-0.9, -1.7, -2.5]) yellow.push(member([u, 0.08, s * 0.3], [u, 0.48, s * 0.3], 0.07));
      yellow.push(member([-0.6, 0.48, s * 0.3], [-2.95, 0.48, s * 0.3], 0.07));
    }
    for (const u of [-1.1, -1.9, -2.7]) yellow.push(member([u, 0, -0.3], [u, 0, 0.3], 0.08));
    const galvanised: Piece[] = [{ geometry: chamferBox(2.3, 0.04, 0.48), at: [-1.75, 0.1, 0] }]; // walkway grating
    iron.push({ geometry: new T.CylinderGeometry(0.17, 0.17, 0.46, 14), at: [-1.15, 0.3, 0], rotation: [Math.PI / 2, 0, 0] }); // winch drum
    cream.push({ geometry: chamferBox(0.34, 0.3, 0.3), at: [-1.6, 0.27, 0] }); // its motor
    for (const u of [-2.38, -2.62, -2.86]) weights.push({ geometry: chamferBox(0.22, 0.95, 0.8), at: [u, -0.4, 0] });
    // Pendants from the head: to the jib's top chord, and to the counter-jib's end.
    iron.push(member([0.05, head + 0.1, 0], [4.2, JH, 0], 0.07));
    for (const s of [-1, 1]) iron.push(member([-0.05, head + 0.1, s * 0.04], [C1 + 0.1, 0.08, s * 0.3], 0.07));
    // The cab beside the jib's root, facing along it.
    cream.push({ geometry: chamferBox(0.66, 0.66, 0.56), at: [0.62, 0, 0.66] }, { geometry: chamferBox(0.74, 0.07, 0.64), at: [0.62, 0.365, 0.66] });
    const frame = (at: V3, w: number, h: number, alongX: boolean) => {
      const o = (u: number, v: number): V3 => (alongX ? [at[0] + u, at[1] + v, at[2]] : [at[0], at[1] + v, at[2] + u]),
        sx = (a: number) => (alongX ? [a, 0.05, 0.03] : [0.03, 0.05, a]) as V3,
        sy = (a: number) => (alongX ? [0.05, a, 0.03] : [0.03, a, 0.05]) as V3;
      for (const v of [-h / 2, h / 2]) iron.push({ geometry: UNIT_BOX, at: o(0, v), scale: sx(w + 0.05) });
      for (const u of [-w / 2, w / 2]) iron.push({ geometry: UNIT_BOX, at: o(u, 0), scale: sy(h) });
    };
    const cab = (at: V3, w: number, h: number, alongX: boolean) => {
      const pane = box(jib, at[0], at[1], at[2], alongX ? w : 0.02, h, alongX ? 0.02 : w, palette.glass, 'glass');
      pane.userData.window = 'unlit'; // the crane's cab stays dark at night
      pane.userData.windowGroup = 'building-site';
      frame([at[0] + (alongX ? 0 : 0.008), at[1], at[2] + (alongX ? 0.008 : 0)], w, h, alongX);
    };
    cab([0.955, 0.03, 0.66], 0.44, 0.4, false); // front
    cab([0.6, 0.06, 0.945], 0.46, 0.36, true); // side
    // The trolley, the ropes, the hook block and the load.
    const TX = 4.6;
    yellow.push({ geometry: chamferBox(0.5, 0.12, 0.66), at: [TX, -0.13, 0] });
    for (const s of [-1, 1]) for (const d of [-0.16, 0.16]) iron.push({ geometry: new T.CylinderGeometry(0.06, 0.06, 0.05, 10), at: [TX + d, -0.02, s * (W + 0.09)], rotation: [Math.PI / 2, 0, 0] });
    for (const d of [-0.08, 0.08]) iron.push(member([TX + d, -0.19, 0], [TX + d, -2.86, 0], 0.07));
    const hook: Piece[] = [
      { geometry: chamferBox(0.34, 0.3, 0.2), at: [TX, -3.0, 0] },
      { geometry: new T.CylinderGeometry(0.15, 0.15, 0.22, 14), at: [TX, -2.86, 0], rotation: [Math.PI / 2, 0, 0] },
    ];
    iron.push(
      member([TX, -3.15, 0], [TX, -3.3, 0], 0.07),
      { geometry: new T.TorusGeometry(0.08, 0.035, 6, 10, Math.PI * 1.3), at: [TX, -3.38, 0], rotation: [0, 0, -Math.PI * 0.55] },
      ...[-1, 1].flatMap((s) => [-1, 1].map((sz) => member([TX, -3.42, 0], [TX + s * 0.45, -3.76, sz * 0.18], 0.07))),
    );
    for (let k = 0; k < 3; k++) boards.push({ geometry: chamferBox(1.2, 0.07, 0.5), at: [TX, -3.95 + k * 0.075, 0] });
    for (const s of [-1, 1]) boards.push({ geometry: chamferBox(0.1, 0.07, 0.56), at: [TX + s * 0.4, -4.02, 0] });
    part(jib, yellow, Y, 'enamel');
    part(jib, hook, palette.boat, 'enamel');
    part(jib, cream, palette.tramCream, 'enamel');
    part(jib, iron, IRON, 'iron');
    part(jib, galvanised, '#8d9396', 'iron');
    part(jib, weights, CONCRETE, 'stone');
    part(jib, boards, palette.wood, 'wood');
    animated.push({
      object: jib,
      update(time) {
        jib.rotation.y = Math.sin(time * 0.07) * 0.9;
      },
    });
    buildingSite(g);
    return base;
  }
  /** The reserved plot's hoarding and the building site inside it (see crane). */
  function buildingSite(g: T.Object3D) {
    const plot = plan.reservedPlot,
      site = new T.Group();
    site.position.set(plot.x, plan.terrainHeight(plot.x, plot.z), plot.z);
    g.add(site);
    const PANEL = '#efe2c2',
      KICK = '#9aa1a3',
      BAND = palette.blueDoor,
      HT = HOARDING_THICKNESS;
    const panels: Piece[] = [],
      kick: Piece[] = [],
      blue: Piece[] = [],
      timber: Piece[] = [],
      stone: Piece[] = [];
    /** Things on the site floor (x0, z0, x1, z1 in the plot's frame): props keep off them. */
    const taken: [number, number, number, number][] = [
      [-CRANE_BASE / 2, -CRANE_BASE / 2, CRANE_BASE / 2, CRANE_BASE / 2],
      [-0.05, -2.3, 1.55, -1.4], // cabin
      [-0.85, -2.3, -0.05, -0.9], // mixer
      [-2.35, -1.1, -1.05, 1.3], // slab
      [1.25, -1.45, 2.05, 0.05], // boards
      [1.25, 0.2, 2.15, 0.9], // bricks
    ];
    const free = (x0: number, z0: number, x1: number, z1: number) => !taken.some(([a, b, c, d]) => x1 > a && x0 < c && z1 > b && z0 < d);
    for (const [dx, dz, l, ry] of hoardingWalls(plot)) {
      const inward = dx < 0 || dz < 0 ? 1 : -1,
        west = dx < 0,
        frameOf = new T.Matrix4().compose(new T.Vector3(dx, 0, dz), new T.Quaternion().setFromEuler(new T.Euler(0, ry, 0)), new T.Vector3(1, 1, 1)),
        put = (list: Piece[], geometry: T.BufferGeometry, at: V3, rotation: V3 = [0, 0, 0]) =>
          list.push({ geometry, matrix: frameOf.clone().multiply(new T.Matrix4().compose(new T.Vector3(...at), new T.Quaternion().setFromEuler(new T.Euler(...rotation)), new T.Vector3(1, 1, 1))) }),
        toPlot = (u: number, w: number) => new T.Vector3(u, 0, w).applyMatrix4(frameOf);
      put(panels, chamferBox(l + HT, 0.84, HT), [0, 0.12 + 0.42, 0]);
      put(kick, chamferBox(l + HT + 0.02, 0.14, HT + 0.04), [0, 0.07, 0]);
      put(blue, chamferBox(l + HT + 0.06, 0.1, HT + 0.08), [0, 1.0, 0]); // capping rail
      const out = -inward * (HT / 2 + 0.035);
      const posts = west ? [-1.75, -0.95, 0.95, 1.75] : [-1.25, 0, 1.25];
      for (const u of posts) {
        const gate = west && Math.abs(u) < 1;
        put(blue, chamferBox(0.12, gate ? 1.2 : 1.1, 0.07), [u, gate ? 0.6 : 0.55, out]);
        if (gate) put(blue, chamferBox(0.16, 0.05, 0.11), [u, 1.225, out]);
        // Inside: a raking prop from the inner rail at the post to a concrete foot, where the floor is free.
        const foot = toPlot(u, inward * 0.62);
        if (!gate && free(foot.x - 0.15, foot.z - 0.15, foot.x + 0.15, foot.z + 0.15)) {
          const a = toPlot(u, inward * (HT / 2 + 0.06)),
            b = toPlot(u, inward * 0.6);
          timber.push(member([a.x, 0.82, a.z], [b.x, 0.12, b.z], 0.07));
          stone.push({ geometry: chamferBox(0.2, 0.12, 0.2), at: [b.x, 0.06, b.z], rotation: [0, ry, 0] });
        }
      }
      // Two timber rails along the inside.
      for (const h of [0.3, 0.8]) put(timber, chamferBox(l - 0.1, 0.08, 0.07), [0, h, inward * (HT / 2 + 0.035)]);
      if (west)
        // The gate's two leaves, framed and braced on the road side.
        for (const s of [-1, 1]) {
          const c = s * 0.45;
          for (const h of [0.25, 0.85]) put(blue, chamferBox(0.84, 0.08, 0.05), [c, h, out + inward * 0.01]);
          for (const e of [-0.38, 0.38]) put(blue, chamferBox(0.07, 0.68, 0.05), [c + e, 0.55, out + inward * 0.01]); // stiles
          const a = new T.Vector3(c - s * 0.36, 0.28, out + inward * 0.01).applyMatrix4(frameOf),
            b = new T.Vector3(c + s * 0.36, 0.82, out + inward * 0.01).applyMatrix4(frameOf);
          blue.push(member([a.x, a.y, a.z], [b.x, b.y, b.z], 0.07));
        }
    }
    // The corner posts outside the hoarding's corners.
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) blue.push({ geometry: chamferBox(0.18, 1.12, 0.18), at: [sx * (plot.w / 2 + 0.02), 0.56, sz * (plot.d / 2 + 0.02)] });
    // The floor: grey-brown compacted gravel inside the hoarding.
    const floor = box(site, 0, 0.015, 0, plot.w - HT - 0.02, 0.03, plot.d - HT - 0.02, '#b3a487', 'gravel');
    floor.userData.noShadow = true;
    // The site cabin on two sleepers: a steel frame, a roof cap, two windows and a door.
    const CABIN = '#7f949f',
      STEEL = '#5f6b72',
      cabin = { x: 0.75, z: -1.85 },
      cabinPaint: Piece[] = [{ geometry: chamferBox(1.48, 0.76, 0.78), at: [cabin.x, 0.49, cabin.z] }],
      steel: Piece[] = [{ geometry: chamferBox(1.6, 0.07, 0.9), at: [cabin.x, 0.905, cabin.z] }];
    for (const s of [-1, 1]) timber.push({ geometry: chamferBox(0.12, 0.1, 0.86), at: [cabin.x + s * 0.55, 0.08, cabin.z] });
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) steel.push({ geometry: chamferBox(0.08, 0.78, 0.08), at: [cabin.x + sx * 0.74, 0.5, cabin.z + sz * 0.39] });
    for (const sz of [-1, 1]) for (const h of [0.15, 0.85]) steel.push({ geometry: chamferBox(1.48, 0.07, 0.07), at: [cabin.x, h, cabin.z + sz * 0.39] });
    for (const u of [-0.36, 0.3]) {
      const pane = box(site, cabin.x + u, 0.56, cabin.z + 0.4, 0.36, 0.26, 0.02, palette.glass, 'glass');
      pane.userData.window = 'unlit';
      pane.userData.windowGroup = 'building-site';
      for (const h of [-0.15, 0.15]) panels.push({ geometry: UNIT_BOX, at: [cabin.x + u, 0.56 + h, cabin.z + 0.405], scale: [0.42, 0.05, 0.03] });
      for (const w of [-0.2, 0.2]) panels.push({ geometry: UNIT_BOX, at: [cabin.x + u + w, 0.56, cabin.z + 0.405], scale: [0.05, 0.3, 0.03] });
    }
    steel.push({ geometry: chamferBox(0.04, 0.62, 0.36), at: [cabin.x + 0.755, 0.46, cabin.z + 0.02] }); // door
    stone.push({ geometry: chamferBox(0.24, 0.1, 0.44), at: [cabin.x + 0.9, 0.05, cabin.z + 0.02] }); // its step
    part(site, cabinPaint, CABIN, 'paint');
    part(site, steel, STEEL, 'paint');
    // The cement mixer, long and low so it reads as a machine: a fat drum leaning back on its
    // cradle (a band round its belly, the dark mouth), the frame's two rails over a pair of wheels,
    // a dark engine cover behind the drum, a stand leg and a tow bar. Its mouth looks north, away
    // from the overview and the Research chapter alike: seen end-on, the round drum and its dark
    // mouth read as a face with one eye.
    const mixer = new T.Group();
    mixer.position.set(-0.45, 0, -1.5);
    mixer.rotation.y = -Math.PI / 2;
    site.add(mixer);
    const tilt: V3 = [0, 0, 0.9],
      pivot: V3 = [0.02, 0.3, 0];
    part(mixer, [
      { geometry: turned([{ r: 0, y: 0 }, { r: 0.09, y: 0.01 }, { r: 0.19, y: 0.06 }, { r: 0.255, y: 0.17 }, { r: 0.265, y: 0.28 }, { r: 0.22, y: 0.41 }, { r: 0.14, y: 0.52 }, { r: 0.12, y: 0.58, sharp: true }], 12), at: pivot, rotation: tilt },
      { geometry: turned([{ r: 0.258, y: 0.25 }, { r: 0.278, y: 0.27 }, { r: 0.258, y: 0.29 }], 12), at: pivot, rotation: tilt },
    ], '#c9783a', 'enamel');
    part(mixer, [
      { geometry: turned([{ r: 0.12, y: 0.58 }, { r: 0.1, y: 0.56, sharp: true }, { r: 0, y: 0.52 }], 12), at: pivot, rotation: tilt }, // the mouth
      ...[-1, 1].map((s): Piece => ({ geometry: new T.CylinderGeometry(0.15, 0.15, 0.07, 14), at: [0.28, 0.15, s * 0.3], rotation: [Math.PI / 2, 0, 0] })), // wheels
      { geometry: chamferBox(0.22, 0.17, 0.32), at: [0.34, 0.33, 0] }, // engine cover
    ], palette.ink, 'iron');
    part(mixer, [
      ...[-1, 1].flatMap((s) => [
        member([-0.5, 0.2, s * 0.17], [0.42, 0.2, s * 0.17], 0.07), // the frame's rails
        member([0.02, 0.2, s * 0.17], [0.02, 0.36, s * 0.27], 0.07), // the cradle's arms
        member([-0.42, 0.2, s * 0.17], [-0.46, 0, s * 0.2], 0.07), // the stand's legs
      ]),
      member([0.28, 0.15, -0.34], [0.28, 0.15, 0.34], 0.07), // axle
      member([-0.5, 0.2, 0], [-0.7, 0.08, 0], 0.07), // tow bar
      { geometry: chamferBox(0.1, 0.08, 0.1), at: [-0.7, 0.04, 0] },
    ], palette.metal, 'iron');
    // The ground slab and the formwork for a wall on it: two plywood shutters, soldiers and walers
    // either side, raking props, and rebar standing out of the top.
    const slab = { x: -1.7, z: 0.1 };
    stone.push({ geometry: chamferBox(1.25, 0.1, 2.35), at: [slab.x, 0.05, slab.z] });
    for (const s of [-1, 1]) {
      timber.push({ geometry: chamferBox(0.07, 0.5, 1.8), at: [slab.x + s * 0.15, 0.35, slab.z] });
      for (const w of [-0.65, 0, 0.65]) {
        timber.push({ geometry: chamferBox(0.07, 0.58, 0.08), at: [slab.x + s * 0.225, 0.39, slab.z + w] });
        timber.push(member([slab.x + s * 0.26, 0.6, slab.z + w], [slab.x + s * 0.52, 0.1, slab.z + w], 0.07));
      }
      for (const h of [0.24, 0.52]) timber.push({ geometry: chamferBox(0.07, 0.07, 1.95), at: [slab.x + s * 0.295, h, slab.z] });
    }
    part(site, Array.from({ length: 5 }, (_, k): Piece => member([slab.x, 0.4, slab.z - 0.7 + k * 0.35], [slab.x + (k % 2 ? 0.02 : -0.02), 0.86, slab.z - 0.7 + k * 0.35], 0.07)), '#6e5546', 'iron');
    // A stack of boards on bearers, and a pallet of bricks.
    for (const v of [-1.25, -0.25]) timber.push({ geometry: chamferBox(0.66, 0.08, 0.1), at: [1.65, 0.08, v] });
    for (let layer = 0; layer < 2; layer++) for (const u of [1.45, 1.65, 1.85]) timber.push({ geometry: chamferBox(0.16, 0.07, 1.4), at: [u + layer * 0.02, 0.155 + layer * 0.075, -0.7] });
    timber.push({ geometry: chamferBox(0.86, 0.1, 0.66), at: [1.7, 0.08, 0.55] });
    part(site, [{ geometry: chamferBox(0.76, 0.4, 0.58), at: [1.7, 0.33, 0.55] }], palette.brick, 'stone');
    part(site, panels, PANEL, 'paint');
    part(site, kick, KICK, 'paint');
    part(site, blue, BAND, 'paint');
    part(site, timber, palette.wood, 'wood');
    part(site, stone, '#c8c2b4', 'stone'); // concrete
    return site;
  }
  /**
   * A tartan picnic blanket and a hamper on the park turf, front-left of the bandstand under the
   * edge of the west tree: 0.27 clear of the bandstand plinth, 0.5 of the bench (so the bench back
   * hides no more than a corner from the Life chapter's camera) and 0.48 of the trunk.
   * The tartan is one flat colour per triangle on a 0.05 grid, the mix of a muted red, navy, green
   * and cream sett across and along it (0.5 repeat), so no texture can shimmer. It lies 0.012 over
   * the turf (top 0.10), casts no shadow and takes no contact bake.
   */
  function picnic(g: T.Object3D) {
    const spot = { x: -12.25, z: 10.08, ry: 0.12 },
      W = 1.1,
      D = 0.8,
      cell = 0.05;
    const red = new T.Color('#a94a3e'),
      navy = new T.Color('#34506e'),
      green = new T.Color('#3d6450'),
      cream = new T.Color(palette.white);
    // The sett in 0.05 cells: red 4, navy 2, red 1, green 2, cream 1.
    const sett = [red, red, red, red, navy, navy, red, green, green, cream];
    const stripe = (t: number) => sett[((Math.floor(t / cell + 1e-6) % sett.length) + sett.length) % sett.length];
    const geo = new T.PlaneGeometry(W, D, Math.round(W / cell), Math.round(D / cell)).rotateX(-Math.PI / 2).toNonIndexed();
    const p = geo.getAttribute('position'),
      out = new Float32Array(p.count * 3),
      c = new T.Color();
    for (let i = 0; i < p.count; i += 3) {
      const u = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3 + W / 2,
        v = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3 + D / 2;
      c.copy(stripe(u)).lerp(stripe(v), 0.5);
      for (let k = 0; k < 3; k++) c.toArray(out, (i + k) * 3);
    }
    geo.setAttribute('color', new T.BufferAttribute(out, 3));
    const rug = new T.Group();
    rug.position.set(spot.x, 0.112, spot.z);
    rug.rotation.y = spot.ry;
    g.add(rug);
    const blanket = new T.Mesh(geo, material('#ffffff', 'fabric'));
    blanket.castShadow = false;
    blanket.receiveShadow = true;
    blanket.userData.noShadow = true;
    rug.add(blanket);
    // A wicker hamper on the back corner, away from the Life chapter's camera: a pale wicker basket,
    // a slightly darker lid and an arched cane handle over it, so it reads as a basket, not a box.
    const hamper = new T.Group();
    hamper.position.set(-0.32, 0, -0.17);
    hamper.rotation.y = -0.18;
    rug.add(hamper);
    box(hamper, 0, 0.12, 0, 0.42, 0.24, 0.3, '#b08a5c', 'wood');
    box(hamper, 0, 0.265, 0, 0.45, 0.05, 0.33, '#9c7850', 'wood');
    const handle = new T.Mesh(new T.TorusGeometry(0.1, 0.016, 6, 12, Math.PI), material(palette.woodDark, 'wood'));
    handle.position.y = 0.29; // the arch stands on the lid along the basket's length
    handle.castShadow = handle.receiveShadow = true;
    hamper.add(handle);
    return rug;
  }
  /**
   * The Duke of Wellington as Glasgow knows him: a bronze rider on a walking horse, an orange
   * traffic cone on his head, on a grey granite plinth over a 12-sided paved pad (about 3.6 to the
   * cone's tip). The bronze is sculpted (town-sculpt.ts): the horse's barrel, arched neck and
   * bowed head, its legs (the near foreleg lifted mid-stride) and its tail are blended solids, as
   * is the Duke in his cloak and riding boots, one hand on the reins and the other resting on his
   * thigh, all one closed casting on a bronze base plate. Its colour is painted on the vertices:
   * a dark patina, verdigris settled on the tops and in the hollows (and a little run down the
   * flanks), and the bright bronze the hands of passers-by have rubbed on the horse's knees and
   * muzzle and the Duke's boot toes. The plinth has a base moulding, a die with a plain raised
   * panel on each face (no inscription), and a cornice whose top the plate stands on.
   */
  function wellington(g: T.Object3D) {
    const [x, z] = plan.statueSpot;
    const root = new T.Group();
    root.position.set(x, 0, z);
    root.rotation.y = plan.statueHeading;
    g.add(root);
    const pad = new T.Mesh(new T.CylinderGeometry(1.6, 1.6, 0.1, 12), material(palette.plazaDark, 'paving'));
    pad.position.y = 0.05;
    pad.receiveShadow = true;
    root.add(pad);
    const solid = (geometry: T.BufferGeometry, colour: string, kind: SurfaceKind) => {
      const m = new T.Mesh(geometry, material(colour, kind));
      m.castShadow = m.receiveShadow = true;
      root.add(m);
      return m;
    };
    // The plinth: a plain base block with a torus and a cove up to the die (battered 0.01), and a
    // cornice (cove, corona, rounded top edge) in its own mesh, which batching takes as the
    // overhang that shades the die's head.
    const [HX, HZ] = [0.75, 1.15],
      y0 = 1.43;
    solid(mouldedBlock(HX, HZ, [
      { s: 0, y: 0.1, sharp: true }, { s: 0, y: 0.22, sharp: true }, { s: 0.03, y: 0.22, sharp: true },
      { s: 0.042, y: 0.235 }, { s: 0.036, y: 0.26 }, { s: 0.046, y: 0.284 }, { s: 0.07, y: 0.298, sharp: true },
      { s: 0.1, y: 0.305 }, { s: 0.12, y: 0.33 }, { s: 0.13, y: 0.36, sharp: true }, { s: 0.14, y: 1.2, sharp: true },
    ]), STATUE.granite, 'stone');
    solid(mouldedBlock(HX, HZ, [
      { s: 0.15, y: 1.19, sharp: true }, { s: 0.135, y: 1.215 }, { s: 0.11, y: 1.245 }, { s: 0.08, y: 1.27 },
      { s: 0.06, y: 1.285, sharp: true }, { s: 0.06, y: 1.37, sharp: true }, { s: 0.072, y: 1.405 }, { s: 0.1, y: y0, sharp: true },
    ]), STATUE.cornice, 'stone');
    // A plain raised panel on each face of the die (0.035 proud, bevelled), never lettered.
    for (const s of [-1, 1]) {
      box(root, s * 0.612, 0.78, 0, 0.07, 0.56, 1.5, STATUE.panel, 'stone', { bevel: 0.025 });
      box(root, 0, 0.78, s * 1.012, 0.86, 0.56, 0.07, STATUE.panel, 'stone', { bevel: 0.025 });
    }
    // The bronze plate the horse stands on (a band, so batching never takes it for an overhang).
    box(root, 0, y0 + 0.02, 0, 0.64, 0.06, 1.36, STATUE.plate, 'iron', { bevel: 0.025 }).userData.band = true;
    const casting = bronzeCasting(),
      bronze = solid(casting.geometry, '#ffffff', 'iron');
    bronze.position.y = y0 + 0.05;
    // The cone, knocked askew on the Duke's head: an orange square foot, the cone and its white band.
    const hat = new T.Group();
    hat.position.set(casting.crown[0], y0 + 0.05 + casting.crown[1] + 0.004, casting.crown[2]);
    hat.rotation.set(-0.08, 0, 0.17);
    root.add(hat);
    box(hat, 0, 0.012, 0, 0.27, 0.03, 0.27, palette.tramOrange, 'enamel', { bevel: 0.012 });
    const coneShape = (r0: number, r1: number, y0c: number, y1c: number) =>
      new T.LatheGeometry([[0, y0c], [r0, y0c], [r0 * 0.98, y0c + 0.008], [r1 * 1.02, y1c - 0.008], [r1, y1c], [0, y1c]].map(([r, y]) => new T.Vector2(r, y)), 20);
    const conePart = (r0: number, r1: number, a: number, b: number, colour: string) => {
      const m = new T.Mesh(coneShape(r0, r1, a, b), material(colour, 'enamel'));
      m.castShadow = m.receiveShadow = true;
      hat.add(m);
    };
    // Height 0.36 from r 0.105 at y 0.025 to a rounded tip: the band stands 0.004 proud between 0.15 and 0.215.
    const rAt = (y: number) => 0.105 + (0.016 - 0.105) * ((y - 0.025) / 0.335);
    conePart(0.105, 0.016, 0.025, 0.36, palette.tramOrange);
    conePart(rAt(0.15) + 0.004, rAt(0.215) + 0.004, 0.15, 0.215, palette.white);
    return root;
  }
  /**
   * The casting's geometry in the plate's frame (y 0 on its top, the horse facing +z, its near
   * side +x, the side the opening view sees), its colour on the vertices. The sculpt grid is
   * 0.025: finer things (the ears, the bridle, the reins, the stirrups and their leathers) are
   * small meshes of their own, merged in.
   */
  function bronzeCasting() {
    type V = [number, number, number];
    const add = (a: V, b: V, k = 1): V => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
    const G = 0.025,
      lo: V = [-0.38, -0.04, -0.94],
      hi: V = [0.38, 1.86, 1.08];
    const horse = sculpt(lo, hi, G);
    // The body, compact and deep, Clash-chunky: barrel, chest and croup, the two lobes of the
    // breast, the withers and the dock; then the haunches and the sloped shoulders on each side.
    horse
      .add(ellipsoid([0, 0.74, -0.02], [0.2, 0.225, 0.42]))
      .add(ellipsoid([0, 0.75, 0.27], [0.19, 0.235, 0.22]), 0.1)
      .add(ellipsoid([0, 0.79, -0.33], [0.195, 0.23, 0.25]), 0.1)
      .add(ellipsoid([0, 0.92, 0.2], [0.075, 0.07, 0.16]), 0.08)
      .add(ellipsoid([0, 0.93, -0.55], [0.06, 0.065, 0.07]), 0.06);
    for (const s of [-1, 1])
      horse
        .add(ellipsoid([s * 0.07, 0.66, 0.43], [0.085, 0.11, 0.075]), 0.06)
        .add(ellipsoid([s * 0.085, 0.76, -0.37], [0.125, 0.2, 0.21]), 0.08)
        .add(ellipsoid([s * 0.095, 0.76, 0.3], [0.105, 0.2, 0.12], [-0.35, 0, 0]), 0.06);
    // A saddle cloth over the barrel (a rounded outline, a soft rolled edge) and a girth under it,
    // laid over the body as blended so far; the saddle itself, with its pommel and cantle.
    horse
      .layer(roundBox([0, 0.83, -0.06], [0.32, 0.17, 0.26], 0.12), 0.03, 0.05)
      .layer(roundBox([0, 0.5, 0.13], [0.32, 0.25, 0.035], 0.02), 0.022, 0.025)
      .add(ellipsoid([0, 0.975, -0.06], [0.165, 0.06, 0.21]), 0.03)
      .add(ellipsoid([0, 1.03, -0.22], [0.12, 0.05, 0.05]), 0.03)
      .add(ellipsoid([0, 1.02, 0.12], [0.07, 0.045, 0.045]), 0.03);
    // The neck, arched, thick and deeper than it is wide.
    const N: V[] = [[0, 0.84, 0.36], [0, 1.05, 0.5], [0, 1.22, 0.6], [0, 1.34, 0.65]],
      NR = [0.175, 0.15, 0.12, 0.1];
    horse.add(squashX(strand(N, NR), 0.74), 0.1);
    // The head, big and bowed: P the poll, D from the poll to the muzzle's tip, F the way the face looks.
    const P: V = [0, 1.37, 0.67],
      D: V = [0, -0.3, 0.25],
      F: V = [0, 0.64, 0.768],
      H = (t: number, f = 0, side = 0): V => add(add(add(P, D, t), F, f), [side, 0, 0]),
      tilt: V = [0.876, 0, 0];
    horse
      .add(ellipsoid(H(0.14, 0.0), [0.1, 0.1, 0.125], tilt), 0.07) // cranium
      .add(ellipsoid(H(0.42, -0.08), [0.092, 0.1, 0.1], tilt), 0.05) // the round jowl
      .add(squashX(roundCone(H(0.18, 0.02), H(0.82), 0.078, 0.062), 0.86), 0.05) // the face
      .add(ellipsoid(H(0.86, -0.025), [0.074, 0.07, 0.082], tilt), 0.04) // muzzle
      .add(ellipsoid(H(0.84, -0.1), [0.05, 0.035, 0.052], tilt), 0.025) // lower lip
      .add(ellipsoid(H(0.05, 0.075), [0.042, 0.024, 0.06], tilt), 0.02); // the forelock
    for (const s of [-1, 1])
      horse
        .add(ellipsoid(H(0.9, 0.0, s * 0.045), [0.026, 0.03, 0.028], tilt), 0.015) // flared nostrils
        .add(ellipsoid(H(0.26, 0.03, s * 0.083), [0.024, 0.03, 0.036], tilt), 0.012) // eyes
        .add(ellipsoid(H(0.2, 0.06, s * 0.07), [0.026, 0.018, 0.045], tilt), 0.015); // brows
    // The mane: a rolled crest from poll to withers and six broad locks along it, each leaning a
    // little to the off side, so the crest's line is scalloped.
    const crest = (t: number): V => {
      const u = t * (N.length - 1),
        i = Math.min(N.length - 2, Math.floor(u)),
        f = u - i,
        a = N[i],
        b = N[i + 1],
        r = NR[i] + (NR[i + 1] - NR[i]) * f,
        l = Math.hypot(b[1] - a[1], b[2] - a[2]);
      return add(add(a, [0, b[1] - a[1], b[2] - a[2]], f), [0, (b[2] - a[2]) / l, -(b[1] - a[1]) / l], r * 0.86);
    };
    horse.add(strand([0.98, 0.7, 0.4, 0.08].map(crest), [0.032, 0.04, 0.044, 0.036]), 0.04);
    for (let i = 0; i < 6; i++) {
      const c = crest(0.93 - i * 0.165);
      horse.add(ellipsoid(add(c, [-0.014, 0.012, 0]), [0.034, 0.05, 0.055], [-0.55, 0, 0.35]), 0.03);
    }
    // The legs through their joints, each one smooth strand: forearm or gaskin, knee or hock,
    // cannon, fetlock and pastern; the knees and fetlocks rounded out and the hooves flat-soled.
    // The off foreleg (-x, the side the opening view sees) is lifted mid-stride, its knee forward
    // and its hoof tucked back.
    const hoof = (a: V, b: V, flat: boolean) => {
      const c = roundCone(a, b, 0.05, 0.066);
      horse.add(flat ? within(c, roundBox([b[0], 0.08, b[2]], [0.12, 0.08, 0.12], 0), 0.012) : c, 0.015);
    };
    const leg = (pts: V[], r: number[], flat: boolean) => {
      horse.add(strand(pts.slice(0, -1), r), 0.08);
      horse.add(ellipsoid(pts[2], [0.062, 0.066, 0.066]), 0.03).add(ellipsoid(pts[3], [0.054, 0.052, 0.058]), 0.02);
      hoof(pts[pts.length - 2], pts[pts.length - 1], flat);
    };
    leg([[0.1, 0.66, 0.31], [0.1, 0.5, 0.36], [0.1, 0.33, 0.38], [0.1, 0.12, 0.38], [0.1, 0.075, 0.405], [0.1, 0.0, 0.43]], [0.1, 0.08, 0.06, 0.052, 0.046], true);
    leg([[-0.1, 0.66, 0.31], [-0.1, 0.52, 0.42], [-0.1, 0.42, 0.52], [-0.1, 0.22, 0.47], [-0.1, 0.175, 0.43], [-0.1, 0.12, 0.375]], [0.1, 0.08, 0.06, 0.052, 0.046], false);
    // Hind: the gaskin from the stifle, the hock (and its point), the cannon and fetlock; the far one steps forward.
    for (const [s, step] of [[-1, 0], [1, 0.07]] as const) {
      const X = s * 0.11;
      leg([[X, 0.68, -0.33], [X, 0.5, -0.27 + step * 0.4], [X, 0.32, -0.44 + step], [X, 0.12, -0.42 + step], [X, 0.075, -0.395 + step], [X, 0.0, -0.37 + step]], [0.11, 0.085, 0.06, 0.052, 0.046], true);
      horse.add(ellipsoid([X, 0.34, -0.48 + step], [0.036, 0.04, 0.036]), 0.02);
    }
    // The tail: carried off the dock in an arch, then falling full to below the hocks in three
    // locks that part a little towards their tips, grooved where they meet.
    const TAIL: V[] = [[0, 0.93, -0.58], [0, 0.91, -0.68], [0, 0.8, -0.75], [0.01, 0.62, -0.765], [0.02, 0.45, -0.745], [0.03, 0.31, -0.71]];
    horse.add(strand(TAIL, [0.05, 0.055, 0.06, 0.062, 0.054, 0.036]), 0.05);
    for (const s of [-1, 1])
      horse.add(strand(TAIL.slice(2).map((p, i): V => add(p, [s * (0.03 + 0.016 * i), 0.012 * i * (s + 2) - 0.01, -0.006 * i])), [0.05, 0.052, 0.044, 0.03]), 0.025);
    // The Duke, chunky, with a big head: seat, coat and chest, square shoulders under a cloak that
    // hangs down his back and spreads over the croup, a high collar, and a round head
    // with a strong nose, a brow, ears and hair under the cone; his coat's skirts fall over the saddle.
    const duke = sculpt(lo, hi, G);
    duke
      .add(ellipsoid([0, 1.07, -0.07], [0.14, 0.08, 0.13]))
      .add(roundCone([0, 1.12, -0.07], [0, 1.3, -0.06], 0.112, 0.12), 0.05)
      .add(ellipsoid([0, 1.29, -0.035], [0.12, 0.09, 0.09]), 0.04);
    for (const s of [-1, 1])
      duke
        .add(ellipsoid([s * 0.122, 1.35, -0.06], [0.066, 0.055, 0.066]), 0.04) // shoulder
        .add(roundBox([s * 0.15, 0.99, -0.1], [0.03, 0.09, 0.1], 0.025, [0.1, 0, s * 0.3]), 0.035); // coat skirt
    // The cloak: a layer over his back and shoulders, its hem spread on the croup behind the saddle.
    duke
      .layer(roundBox([0, 1.22, -0.2], [0.24, 0.25, 0.15], 0.06), 0.028, 0.04)
      .add(ellipsoid([0, 1.0, -0.26], [0.19, 0.065, 0.13]), 0.07);
    duke
      .add(torus([0, 1.405, -0.06], 0.06, 0.03), 0.03) // high collar
      .add(roundCone([0, 1.4, -0.05], [0, 1.46, -0.04], 0.05, 0.05), 0.02) // neck
      .add(ellipsoid([0, 1.565, -0.03], [0.11, 0.12, 0.11]), 0.03) // head
      .add(ellipsoid([0, 1.482, 0.01], [0.08, 0.06, 0.08]), 0.04) // jaw and chin, sunk in the collar
      .add(ellipsoid([0, 1.576, 0.068], [0.064, 0.014, 0.022]), 0.02) // brow
      .add(roundCone([0, 1.552, 0.08], [0, 1.53, 0.102], 0.026, 0.026), 0.035) // a broad, soft nose
      .add(ellipsoid([0, 1.585, -0.065], [0.112, 0.1, 0.09]), 0.02); // hair
    for (const s of [-1, 1]) {
      duke
        .add(ellipsoid([s * 0.107, 1.545, -0.03], [0.018, 0.03, 0.022]), 0.01) // ear
        // Thigh down the flank to the knee, a riding boot with its wide top, and the foot in the stirrup.
        .add(roundCone([s * 0.08, 1.07, -0.04], [s * 0.215, 0.93, 0.12], 0.075, 0.062), 0.04)
        .add(ellipsoid([s * 0.215, 0.93, 0.12], [0.064, 0.064, 0.064]), 0.03)
        .add(roundCone([s * 0.22, 0.92, 0.12], [s * 0.262, 0.68, 0.07], 0.058, 0.05), 0.02)
        .add(ellipsoid([s * 0.222, 0.875, 0.11], [0.074, 0.045, 0.074]), 0.015)
        .add(ellipsoid([s * 0.27, 0.64, 0.12], [0.05, 0.045, 0.1]), 0.03);
    }
    // Left hand (+x) on the reins over the withers, the right arm resting, its fist on his thigh;
    // both in gauntlets with a flared cuff.
    const arm = (pts: V[], fist: V) => {
      duke
        .add(strand(pts, [0.058, 0.05, 0.042]), 0.05)
        .add(ellipsoid(add(pts[2], add(fist, pts[2], -1), -0.4), [0.05, 0.05, 0.05]), 0.015)
        .add(ellipsoid(fist, [0.046, 0.044, 0.05]), 0.015);
    };
    arm([[0.14, 1.35, -0.06], [0.235, 1.21, 0.0], [0.13, 1.15, 0.14]], [0.1, 1.15, 0.18]);
    arm([[-0.14, 1.35, -0.06], [-0.24, 1.2, -0.07], [-0.215, 1.08, 0.05]], [-0.2, 1.045, 0.1]);
    horse.union(duke, 0.06);
    const cast = horse.mesh();
    // The top of his head, where the cone sits.
    let top = 1.85;
    while (top > 1.4 && horse.exact(0, top, -0.03) > 0) top -= 0.002;
    // Small parts: the ears (pricked forward), the bridle (noseband, cheek straps, browband), the
    // reins (bit to fist, clear of the neck) and the stirrups on their leathers.
    const extras: T.BufferGeometry[] = [];
    const ear = new T.LatheGeometry([[0, 0], [0.03, 0.022], [0.035, 0.055], [0.022, 0.095], [0.004, 0.124], [0, 0.126]].map(([r, y]) => new T.Vector2(r, y)), 8);
    for (const s of [-1, 1]) {
      const e = ear.clone().scale(1, 1, 0.6).applyMatrix4(new T.Matrix4().makeRotationFromEuler(new T.Euler(0.3, 0, -s * 0.25)));
      const at = H(0.03, 0.04, s * 0.052);
      extras.push(e.translate(at[0], at[1], at[2]));
    }
    /** Move a point along the field's gradient until it is gap from the casting (`out`: only ever outwards). */
    const settle = (p: V, gap: number, out: boolean): V => {
      let q = p;
      for (let i = 0; i < 6; i++) {
        const d = horse.exact(...q);
        if (out ? d >= gap : Math.abs(d - gap) < 0.001) break;
        const e = 0.01,
          gx = horse.exact(q[0] + e, q[1], q[2]) - horse.exact(q[0] - e, q[1], q[2]),
          gy = horse.exact(q[0], q[1] + e, q[2]) - horse.exact(q[0], q[1] - e, q[2]),
          gz = horse.exact(q[0], q[1], q[2] + e) - horse.exact(q[0], q[1], q[2] - e),
          l = Math.hypot(gx, gy, gz) || 1;
        q = add(q, [gx / l, gy / l, gz / l], gap - d);
      }
      return q;
    };
    const away = (p: V, gap: number) => settle(p, gap, true),
      onto = (p: V, gap: number) => settle(p, gap, false);
    const tube = (pts: V[], r: number, closed = false, n = 16) =>
      new T.TubeGeometry(new T.CatmullRomCurve3(pts.map((p) => new T.Vector3(...p)), closed, 'centripetal'), n, r, 5, closed);
    /** A strap round the head at t along it, hugging the surface by gap. */
    const band = (t: number, gap: number) =>
      Array.from({ length: 10 }, (_, i): V => {
        const a = (i / 10) * Math.PI * 2;
        return onto(H(t, 0.11 * Math.cos(a), 0.11 * Math.sin(a)), gap);
      });
    extras.push(tube(band(0.62, 0.008), 0.011, true, 20)); // noseband
    for (const s of [-1, 1]) {
      extras.push(tube([onto(H(0.62, -0.02, s * 0.1), 0.008), onto(H(0.36, -0.03, s * 0.1), 0.008), onto(H(0.08, -0.02, s * 0.1), 0.008)], 0.011)); // cheek strap
      // Each rein runs from the bit up the side of the neck to the left fist.
      const bit = away(H(0.8, -0.06, s * 0.08), 0.004);
      extras.push(new T.TorusGeometry(0.022, 0.007, 4, 10).rotateY(Math.PI / 2).translate(bit[0], bit[1], bit[2]));
      extras.push(tube([bit, away(H(0.55, -0.1, s * 0.12), 0.03), away([s * 0.1, 1.17, 0.42], 0.03), [0.1 + s * 0.012, 1.15, 0.19]], 0.012, false, 20));
      // The stirrup round the foot's ball, hung on its leather from the saddle's flap.
      const foot: V = [s * 0.27, 0.6, 0.15];
      extras.push(new T.TorusGeometry(0.06, 0.013, 5, 14).scale(1, 1, 0.8).translate(foot[0], foot[1] + 0.02, foot[2]));
      extras.push(tube([away([s * 0.16, 0.95, -0.02], 0.004), away([s * 0.24, 0.78, 0.09], 0.012), [foot[0], foot[1] + 0.08, foot[2]]], 0.01, false, 10));
    }
    const rubbed: [V, number][] = [
      [[0.1, 0.33, 0.39], 0.07], [[-0.1, 0.42, 0.54], 0.07], [H(0.92, 0), 0.07], // knees, the muzzle
      [[0.27, 0.64, 0.21], 0.06], [[-0.27, 0.64, 0.21], 0.06], [[0.1, 1.15, 0.21], 0.05], // boot toes, the rein fist
    ];
    const geometry = mergeGeometries([cast, ...extras].map((p) => {
      for (const n of Object.keys(p.attributes)) if (n !== 'position' && n !== 'normal') p.deleteAttribute(n);
      patina(p, horse.sample, rubbed); // on the shared vertices, before they are split
      return p.index ? p.toNonIndexed() : p;
    }))!;
    return { geometry, crown: [0, top, -0.03] as V };
  }
  /**
   * The bronze's colour on its vertices: a dark warm patina, varied gently over the form; verdigris
   * where rain sits (faces turned up) and in the hollows the field's own occlusion finds, run down
   * the sides below in soft vertical streaks; the hollows darker still; and a worn bright bronze
   * on the rubbed spots, fading out over their radius.
   */
  function patina(geometry: T.BufferGeometry, field: (x: number, y: number, z: number) => number, rubbed: [[number, number, number], number][]) {
    const p = geometry.getAttribute('position'),
      n = geometry.getAttribute('normal'),
      out = new Float32Array(p.count * 3),
      base = new T.Color(STATUE.patina),
      green = new T.Color(STATUE.verdigris),
      worn = new T.Color(STATUE.worn),
      c = new T.Color(),
      steps = [0.03, 0.07, 0.13, 0.22],
      weights = [1, 0.75, 0.5, 0.35];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i),
        nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
      let occ = 0, wsum = 0;
      steps.forEach((d, k) => {
        const f = Math.min(field(x + nx * d, y + ny * d, z + nz * d), d);
        occ += weights[k] * T.MathUtils.clamp((d - f) / d, 0, 1);
        wsum += weights[k];
      });
      // The plate's top occludes the hooves and the lowest tail.
      const ao = (1 - occ / wsum) * T.MathUtils.lerp(0.6, 1, T.MathUtils.smoothstep(y, 0, 0.16) * 0.7 + 0.3 * (ny > 0 ? 1 : 0));
      const up = T.MathUtils.smoothstep(ny, 0.3, 0.9),
        side = 1 - T.MathUtils.smoothstep(Math.abs(ny), 0.35, 0.7),
        // Streaks: narrow across, long down the form, only on the sides.
        streak = T.MathUtils.smoothstep(noise3(x * 16 + z * 3, y * 1.3, z * 16 - x * 3), 0.55, 0.8) * side,
        vg = T.MathUtils.clamp(0.9 * up * (0.45 + 0.55 * noise3(x * 6 + 3, y * 6, z * 6)) + 0.45 * Math.pow(1 - ao, 0.8) + 0.4 * streak, 0, 0.85);
      c.copy(base).multiplyScalar(0.88 + 0.24 * noise3(x * 3.1, y * 3.1, z * 3.1)).lerp(green, vg);
      c.multiplyScalar(T.MathUtils.lerp(0.5, 1, ao));
      let rub = 0;
      for (const [[cx, cy, cz], r] of rubbed) rub = Math.max(rub, T.MathUtils.smoothstep(r - Math.hypot(x - cx, y - cy, z - cz), 0, r * 0.8));
      c.lerp(worn, rub * 0.6);
      c.toArray(out, i * 3);
    }
    geometry.setAttribute('color', new T.BufferAttribute(out, 3));
  }
  return { bench, cycleHoop, lamp, trafficSignals, phoneBox, bin, pavilion, memoryBoard, crane, picnic, wellington };
}
export type Props = ReturnType<typeof createProps>;
