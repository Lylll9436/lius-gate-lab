import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SurfaceKind } from './city-materials';
import * as plan from './town-plan';
import { palette, type TownContext } from './town-shared';
import type { Kit } from './town-kit';
import { mouldedBlock, type Moulding } from './town-sculpt';

/* ------------------------------------------------------------------ */
/* Shapes the vehicles are made of                                     */
/* ------------------------------------------------------------------ */
/** Undergear, bumpers, lamp housings and the winch: painted dark iron, a shade off the street iron. */
const UNDERGEAR = '#3a3f44';
/**
 * A stadium plan (half-width hx, half-length hz: a box with half-round ends) swept up a moulding
 * profile: mouldedBlock with corners as round as the block is wide, so every ring is a stadium
 * inset by its step's s and the straight sides keep one length. Closed on top, open below.
 */
function stadium(hx: number, hz: number, profile: Moulding[], arc = 10) {
  return mouldedBlock(hx, hz, profile, hx, arc);
}
/**
 * A window post for a round-ended body, w wide and h tall on y 0, d deep out along +z, with a
 * concave quarter-round fillet of radius f at each of its four corners: set between a sill and a
 * header rail, the openings either side of it get rounded corners. Bevelled by b (which also
 * fattens its outline by b).
 */
function filletPost(w: number, h: number, f: number, d: number, b: number) {
  const s = new T.Shape(),
    x = w / 2;
  s.moveTo(-x - f, 0);
  s.lineTo(x + f, 0);
  s.absarc(x + f, f, f, -Math.PI / 2, Math.PI, true);
  s.lineTo(x, h - f);
  s.absarc(x + f, h - f, f, Math.PI, Math.PI / 2, true);
  s.lineTo(-x - f, h);
  s.absarc(-x - f, h - f, f, Math.PI / 2, 0, true);
  s.lineTo(-x, f);
  s.absarc(-x - f, f, f, 0, -Math.PI / 2, true);
  return frontOnly(new T.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 3 }), 0);
}
/** An extrusion without its hidden back: the triangles lying wholly at or behind z = back (its back cap and back bevel, set into a wall). */
function frontOnly(g: T.BufferGeometry, back: number) {
  const plain = g.index ? g.toNonIndexed() : g,
    p = plain.getAttribute('position'),
    keep: number[] = [];
  for (let i = 0; i < p.count; i += 3) if (Math.max(p.getZ(i), p.getZ(i + 1), p.getZ(i + 2)) > back + 1e-6) keep.push(i, i + 1, i + 2);
  const out = new T.BufferGeometry();
  for (const name of ['position', 'normal']) {
    const a = plain.getAttribute(name);
    out.setAttribute(name, new T.Float32BufferAttribute(keep.flatMap((i) => [a.getX(i), a.getY(i), a.getZ(i)]), 3));
  }
  g.dispose();
  if (plain !== g) plain.dispose();
  return out;
}
/** A rounded rectangle (w x h, corner radius r) about the origin, as a path (for a frame's outline or its hole). */
function roundedRect(path: T.Path, w: number, h: number, r: number) {
  const x = w / 2, y = h / 2;
  path.moveTo(-x + r, -y);
  path.lineTo(x - r, -y);
  path.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
  path.lineTo(x, y - r);
  path.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
  path.lineTo(-x + r, y);
  path.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
  path.lineTo(-x, -y + r);
  path.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
  return path;
}
/**
 * A frame: a rounded rectangle (w x h, corners r) with a rounded hole (iw x ih, corners ir), d
 * deep out along +z and bevelled by b (none at 0), about its middle; `curve` segments a corner.
 * Its back (z 0 and behind) is left off: frames are set on a face.
 */
function frameGeometry(w: number, h: number, r: number, iw: number, ih: number, ir: number, d: number, b: number, curve = 3) {
  const shape = roundedRect(new T.Shape(), w, h, r) as T.Shape;
  shape.holes.push(roundedRect(new T.Path(), iw, ih, ir));
  return frontOnly(new T.ExtrudeGeometry(shape, { depth: d, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: curve }), 0);
}
/**
 * A profile (radius, height) swept round the y axis from angle a0 to a1 (0 is +z, a quarter turn
 * +x, as a lathe turns), its reach beyond rIn eased to nothing over the last `ease` of each end,
 * so a band laid round a round end dies into the body instead of stopping on an open section.
 */
function endBand(profile: [number, number][], a0: number, a1: number, n: number, rIn: number, ease: number) {
  const pos: number[] = [], idx: number[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n,
      a = a0 + (a1 - a0) * t,
      e = T.MathUtils.smoothstep(Math.min(t, 1 - t), 0, ease);
    for (const [r, y] of profile) {
      const rr = rIn + (r - rIn) * e;
      pos.push(rr * Math.sin(a), y, rr * Math.cos(a));
    }
  }
  const m = profile.length;
  for (let k = 0; k < n; k++)
    for (let j = 0; j < m - 1; j++) {
      const a = k * m + j, b = a + m;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** Merge geometries (positions and normals only) into one, as one part. */
function mergeParts(list: T.BufferGeometry[]) {
  const plain = list.map((g) => {
    const p = g.index ? g.toNonIndexed() : g.clone();
    for (const name of Object.keys(p.attributes)) if (name !== 'position' && name !== 'normal') p.deleteAttribute(name);
    if (!p.getAttribute('normal')) p.computeVertexNormals();
    return p;
  });
  const merged = mergeGeometries(plain, false)!;
  for (const g of [...list, ...plain]) g.dispose();
  return merged;
}
/**
 * The harbour boat's lines (local units: bow +z, waterline y 0): the stem at `bow`, the transom at
 * `stern`, `beam` the half-breadth amidships, the keel's depth, the flat deck's height inside the
 * bulwarks and the bulwarks' thickness.
 */
export const BOAT = { bow: 2.0, stern: -1.45, beam: 0.66, keel: -0.14, deck: 0.44, bulwark: 0.07 };
/** The hull's half-breadth at z: full amidships, a full bow drawn in to a fine stem, quarters eased into the transom. */
export function boatBreadth(z: number) {
  if (z >= 0.4) {
    const t = Math.min(1, (z - 0.4) / (BOAT.bow - 0.4));
    return BOAT.beam * Math.pow(1 - Math.pow(t, 1.8), 0.7);
  }
  if (z <= -0.95) {
    const t = Math.min(1, (-0.95 - z) / (-0.95 - BOAT.stern));
    return BOAT.beam * (1 - 0.16 * t * t);
  }
  return BOAT.beam;
}
/** The sheer (the bulwarks' top) at z: lowest just abaft amidships, rising to a raised bow. */
export function boatSheer(z: number) {
  const t = (z - BOAT.stern) / (BOAT.bow - BOAT.stern);
  return 0.56 + 0.17 * Math.pow(t, 2.6) + 0.03 * Math.pow(1 - t, 3);
}
/** The hull's outer face at height y of the station at z (half-breadth b): the bilge rounds in below y 0.06, the side flares a little above it. */
function hullHalf(b: number, y: number, top: number) {
  if (y >= 0.06) return b * (1 + (0.05 * (y - 0.06)) / (top - 0.06));
  const c = (0.06 - y) / (0.06 - BOAT.keel);
  return b * Math.sqrt(Math.max(0, 1 - c * c));
}
/** The boat's stations, stern to stem, closer together where the bow draws in. */
const boatStations = Array.from({ length: 25 }, (_, i) => BOAT.stern + (BOAT.bow - BOAT.stern) * (1 - Math.pow(1 - i / 24, 1.35)));
/**
 * The hull's outer skin, keel to sheer: each station a section from the port sheer down round the
 * bilge to the keel and up to the starboard sheer, lofted stern to stem and smooth-shaded.
 */
function hullSkin() {
  const half = [0.5, 0.75, 0.9, 1].map((a) => Math.sin((a * Math.PI) / 2)); // bilge rows (fractions round the quarter)
  const pos: number[] = [], idx: number[] = [];
  let width = 0;
  for (const z of boatStations) {
    const b = boatBreadth(z), top = boatSheer(z), rows: [number, number][] = [];
    for (const s of half) {
      const y = 0.06 - (0.06 - BOAT.keel) * Math.cos(Math.asin(s));
      rows.push([b * s, y]);
    }
    for (const f of [1 / 3, 2 / 3, 1]) {
      const y = 0.06 + (top - 0.06) * f;
      rows.push([hullHalf(b, y, top), y]);
    }
    const section: [number, number][] = [...rows.slice().reverse().map(([x, y]): [number, number] => [-x, y]), [0, BOAT.keel], ...rows];
    width = section.length;
    for (const [x, y] of section) pos.push(x, y, z);
  }
  for (let i = 0; i < boatStations.length - 1; i++)
    for (let j = 0; j < width - 1; j++) {
      const a = i * width + j, c = a + width;
      idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { skin: g, section: (i: number) => Array.from({ length: width }, (_, j) => new T.Vector2(pos[(i * width + j) * 3], pos[(i * width + j) * 3 + 1])) };
}
/** A band on the hull's skin from y0 to y1, `out` proud of it, along both sides and across the transom (the boot-top at the waterline). */
function hullBand(y0: number, y1: number, out: number) {
  const pos: number[] = [],
    at = (z: number, y: number, sx: number) => [sx * (hullHalf(boatBreadth(z), y, boatSheer(z)) + out), y, z];
  // Rows every 0.03 or so, so the band follows the bilge's curve instead of cutting under it.
  const rows = Math.max(1, Math.ceil((y1 - y0) / 0.03));
  for (let i = 0; i < boatStations.length - 1; i++)
    for (let r = 0; r < rows; r++) {
      const za = boatStations[i], zb = boatStations[i + 1], ya = y0 + ((y1 - y0) * r) / rows, yb = y0 + ((y1 - y0) * (r + 1)) / rows;
      for (const sx of [-1, 1]) {
        const a0 = at(za, ya, sx), a1 = at(za, yb, sx), b0 = at(zb, ya, sx), b1 = at(zb, yb, sx);
        pos.push(...(sx > 0 ? [...a0, ...a1, ...b0, ...a1, ...b1, ...b0] : [...a0, ...b0, ...a1, ...a1, ...b0, ...b1]));
      }
    }
  const z = BOAT.stern - out, l0 = at(BOAT.stern, y0, -1), l1 = at(BOAT.stern, y1, -1);
  pos.push(-l0[0], y0, z, l0[0], y0, z, l1[0], y1, z, -l0[0], y0, z, l1[0], y1, z, -l1[0], y1, z);
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
/** A geometry placed: turned by ry about y (then rx about x), moved to (x, y, z). */
function placed(g: T.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0) {
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  return g.translate(x, y, z);
}

/*
 * The plane's shapes (plan.PLANE's units: +z to the nose, +x to port, y 0 the slabs it stands on).
 */
/** Where the nose starts to round (its station), where the tail cone starts to draw in, and the tail cone's end radius. */
const PLANE_NOSE = 1.42,
  PLANE_TAIL = -0.95,
  PLANE_TAIL_END = 0.07;
/**
 * The fuselage at station z: its radius and the height of its axis. A constant section between
 * the tail cone and the nose; the nose rounds over its last 0.78 to a blunt tip a little under the
 * axis (the cockpit's brow sloping down to it); the tail cone draws in to PLANE_TAIL_END while its
 * axis rises, so its top runs on almost level and its belly sweeps up.
 */
export function planeSection(z: number) {
  const { length, radius: R, axis: A } = plan.PLANE,
    tip = length / 2;
  if (z > PLANE_NOSE) {
    const t = Math.min(1, (z - PLANE_NOSE) / (tip - PLANE_NOSE));
    return { r: R * Math.sqrt(Math.max(0, 1 - t * t)), y: A - 0.1 * t * t };
  }
  if (z < PLANE_TAIL) {
    const t = Math.min(1, (PLANE_TAIL - z) / (PLANE_TAIL + tip)),
      s = t * t * (3 - 2 * t);
    return { r: R - (R - PLANE_TAIL_END) * s, y: A + 0.9 * (R - PLANE_TAIL_END) * s };
  }
  return { r: R, y: A };
}
/**
 * The livery's green belly: its top edge at station z, as the sine of its angle up the side. Level
 * along the cabin, a little under the axis; up the tail cone it sweeps toward the fin (the
 * cheatline's flourish), leaving a cream strip along the top for the fin's orange.
 */
export function planeBelly(z: number) {
  const t = T.MathUtils.clamp((-0.9 - z) / 1.3, 0, 1);
  return -0.04 + 0.79 * t * t * (3 - 2 * t);
}
/** The cabin's window band (stations, and angles up the port side; mirrored to starboard) and the cockpit's glazing (stations; from the band's foot over the top). */
export const PLANE_GLAZING = { cabin: [-0.85, 1.28], band: [0.21, 0.61], cockpit: [1.7, 1.93] };
/** The navigation lights' steady emissive, the traffic signals' own: no strobe, no blink, no boost at night. */
export const PLANE_LIGHT = 0.95;
/** The skin's point at station z and angle a (0 to port, a quarter turn up), `out` proud of it, with the smooth skin's normal there. */
function skinPoint(z: number, a: number, out = 0) {
  const tip = plan.PLANE.length / 2,
    lo = Math.max(-tip, z - 1e-4),
    hi = Math.min(tip, z + 1e-4),
    s0 = planeSection(lo),
    s1 = planeSection(hi),
    s = planeSection(z),
    c = Math.cos(a),
    sn = Math.sin(a),
    // Out of the surface (r cos a, y + r sin a, z): (cos a, sin a, -(r' + y' sin a)).
    n = new T.Vector3(c, sn, -(s1.r - s0.r + (s1.y - s0.y) * sn) / (hi - lo)).normalize();
  return { p: new T.Vector3(s.r * c, s.y + s.r * sn, z).addScaledVector(n, out), n };
}
type SkinList = { p: number[]; n: number[] };
/**
 * Cells of the skin between stations zs (ascending) and the angles keys(z) gives at each (ascending,
 * as many at every station), `out` proud of it: each cell goes to the list its middle's paint(z, a)
 * names, or to none, as two triangles with the smooth skin's normals at their corners, so a
 * colour's edge is crisp and leaves no seam in the shading.
 */
function skinCells(zs: number[], keys: (z: number) => number[], out: number, paint: (z: number, a: number) => string | null, lists: Map<string, SkinList>) {
  const rows = zs.map((z) => keys(z).map((a) => skinPoint(z, a, out)));
  for (let i = 0; i + 1 < zs.length; i++) {
    const ka = keys(zs[i]),
      kb = keys(zs[i + 1]);
    for (let j = 0; j + 1 < ka.length; j++) {
      const name = paint((zs[i] + zs[i + 1]) / 2, (ka[j] + ka[j + 1] + kb[j] + kb[j + 1]) / 4);
      if (!name) continue;
      let list = lists.get(name);
      if (!list) lists.set(name, (list = { p: [], n: [] }));
      const a = rows[i][j],
        b = rows[i][j + 1],
        c = rows[i + 1][j],
        d = rows[i + 1][j + 1];
      for (const v of [a, b, c, b, d, c]) {
        list.p.push(v.p.x, v.p.y, v.p.z);
        list.n.push(v.n.x, v.n.y, v.n.z);
      }
    }
  }
}
/**
 * A panel raised `rise` off the skin over stations z0..z1 and the angles `keys` (ascending), its top
 * and its four low sides (each side flat-shaded, facing out of the panel), painted by paint.
 */
function skinPanel(z0: number, z1: number, keys: number[], rise: number, paint: (z: number, a: number) => string, lists: Map<string, SkinList>) {
  const zm = (z0 + z1) / 2,
    zs = [z0, zm, z1];
  skinCells(zs, () => keys, rise, paint, lists);
  const last = keys.length - 1,
    loop: [number, number][] = [
      ...keys.map((a): [number, number] => [z0, a]),
      [zm, keys[last]],
      ...keys.slice().reverse().map((a): [number, number] => [z1, a]),
      [zm, keys[0]],
    ],
    centre = skinPoint(zm, (keys[0] + keys[last]) / 2).p,
    face = new T.Vector3(),
    mid = new T.Vector3();
  loop.forEach(([za, aa], k) => {
    const [zb, ab] = loop[(k + 1) % loop.length],
      p0 = skinPoint(za, aa).p,
      q0 = skinPoint(zb, ab).p,
      p1 = skinPoint(za, aa, rise).p,
      q1 = skinPoint(zb, ab, rise).p;
    face.subVectors(q0, p0).cross(new T.Vector3().subVectors(p1, p0)).normalize();
    const outward = face.dot(mid.addVectors(p0, q0).multiplyScalar(0.5).sub(centre)) > 0,
      tri = outward ? [p0, q0, q1, p0, q1, p1] : [p0, q1, q0, p0, p1, q1];
    if (!outward) face.negate();
    const name = paint((za + zb) / 2, (aa + ab) / 2);
    let list = lists.get(name);
    if (!list) lists.set(name, (list = { p: [], n: [] }));
    for (const v of tri) {
      list.p.push(v.x, v.y, v.z);
      list.n.push(face.x, face.y, face.z);
    }
  });
}
/** A NACA-style thickness along the chord (u 0 at the leading edge, 1 at the trailing): 1 at its thickest (30%), none at the trailing edge. */
const foilHalf = (u: number) => (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4) / 0.1;
const FOIL_U = [0, 0.03, 0.09, 0.2, 0.34, 0.52, 0.74, 1];
type FoilStation = { at: number; le: number; chord: number; mid: number; thick: number };
/**
 * A foil (a wing, the tailplane or the fin) lofted through stations along its span: each its
 * place along the span, its leading edge's station, its chord, its middle and its thickness, the
 * upper side taking `upper` of it. place(at, z, across) puts a point of it in the plane's space.
 * Smooth skinned round its leading edge; its trailing edge a crisp edge (its two sides end on
 * points of their own: one shared point there turned both sides' shading toward the ground, a
 * dark line along every trailing edge); its ends closed flat; wound to face out however placed.
 */
function foil(stations: FoilStation[], place: (at: number, z: number, across: number) => T.Vector3, upper = 0.55) {
  const ring = (s: FoilStation) => [
    ...FOIL_U.slice().reverse().map((u) => place(s.at, s.le - u * s.chord, s.mid + upper * s.thick * foilHalf(u))),
    ...FOIL_U.slice(1).map((u) => place(s.at, s.le - u * s.chord, s.mid - (1 - upper) * s.thick * foilHalf(u))),
  ];
  const rings = stations.map(ring),
    m = rings[0].length,
    pos: number[] = [],
    index: number[] = [],
    all = rings.flat(),
    middle = all.reduce((s, v) => s.add(v), new T.Vector3()).multiplyScalar(1 / all.length);
  all.forEach((v) => pos.push(v.x, v.y, v.z));
  // The skin, wound so that a face on the thickest part of the upper side faces away from its section's middle.
  const sides: number[] = [];
  for (let i = 0; i + 1 < rings.length; i++)
    for (let k = 0; k + 1 < m; k++) {
      const a = i * m + k,
        b = a + 1,
        c = a + m,
        d = b + m;
      sides.push(a, b, c, b, d, c);
    }
  const probe = FOIL_U.length - 1 - 4, // the upper side's point at u 0.34
    section = rings[0].reduce((s, v) => s.add(v), new T.Vector3()).multiplyScalar(1 / m),
    normal = new T.Vector3().subVectors(rings[0][probe + 1], rings[0][probe]).cross(new T.Vector3().subVectors(rings[1][probe], rings[0][probe]));
  if (normal.dot(new T.Vector3().subVectors(rings[0][probe], section)) < 0) for (let t = 0; t < sides.length; t += 3) [sides[t + 1], sides[t + 2]] = [sides[t + 2], sides[t + 1]];
  index.push(...sides);
  // Flat end caps, each a fan round its own copy of its end ring, facing away from the foil's middle.
  for (const r of [rings[0], rings[rings.length - 1]]) {
    const base = pos.length / 3,
      centre = r.reduce((s, v) => s.add(v), new T.Vector3()).multiplyScalar(1 / m),
      out = new T.Vector3().subVectors(r[1], centre).cross(new T.Vector3().subVectors(r[2], centre)).dot(new T.Vector3().subVectors(centre, middle)) > 0;
    r.forEach((v) => pos.push(v.x, v.y, v.z));
    pos.push(centre.x, centre.y, centre.z);
    for (let k = 0; k < m; k++) index.push(base + m, out ? base + k : base + ((k + 1) % m), out ? base + ((k + 1) % m) : base + k);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ */
/* Vehicles and people                                                 */
/* ------------------------------------------------------------------ */
/**
 * The balloon's beat, out over the west shore and the sea, so it stays out of every chapter's
 * subject. On the opening view it hangs in the open band between the masthead and the hero
 * copy, under the gap between the wordmark and the nav pill, and drifts to and fro across the
 * frame there: from its anchor `at` (an angle on a ring of `radius` round the island) up to
 * 2 x `reach` along the opening view's screen-left, which leaves its height in the frame alone
 * (along the ring there it would mostly rise and sink), easing to a stop at each end. `rate` is
 * the swing's pace (radians of its phase per second), `height` its basket's height and `bob`
 * how far it rises and sinks. It never leaves the frame: a long swing round the far side climbed
 * out of the top of the frame between its rests, through the masthead, and on short wide
 * screens (1280 x 720) its rests sat behind the frosted tools pill or the nav pill, or dipped
 * behind the hero copy and the News card. It also turns with the camera's idle drift
 * (followDrift), which would otherwise swing it up and down the frame by about 50 px.
 */
export const BALLOON = { radius: 32, at: 2.58, reach: 1.3, rate: 0.02, height: 12.8, bob: 0.3 };
/**
 * Turn a sky object with the camera's idle drift: by `drift` about the vertical line through
 * the view's centre `target`, so it holds its place in the frame while the town turns beneath
 * it. Call it after the object's own update each frame.
 */
export function followDrift(object: T.Object3D, target: T.Vector3, drift: number) {
  if (!drift) return;
  const c = Math.cos(drift),
    s = Math.sin(drift),
    x = object.position.x - target.x,
    z = object.position.z - target.z;
  object.position.x = target.x + x * c + z * s;
  object.position.z = target.z - x * s + z * c;
  object.rotation.y += drift;
}
/**
 * How much darker the balloon's own colours go at full night. It is lit like the town, but it
 * is the one big, pale, round thing hanging unshadowed over the darkest part of the frame, with
 * no ground under it to darken its foot: under the same moonlight its cream gores still read
 * as bright as by day against the night sea. Dimmed this far it sits with the town's moonlit
 * walls. No glow and no burner light.
 */
export const BALLOON_NIGHT_DIM = 0.5;

/**
 * The balloon envelope's profile (radius, height over its base): the mouth, the cone's gentle
 * S, the full shoulder (1.56 across at 2.75, so with its gores it stays within 1.6) and the dome
 * to the crown ring.
 */
const BALLOON_PROFILE = [[0.36, 0.06], [0.52, 0.35], [0.85, 0.95], [1.26, 1.62], [1.5, 2.25], [1.56, 2.75], [1.47, 3.25], [1.2, 3.65], [0.8, 3.93], [0.42, 4.04]];
/** The skirt round the burner: a deep red, quieter than the gores. */
const BALLOON_SKIRT = '#8e3b2e';
/** The basket's wicker, a pale cane in the wood family, and the darker cane of its woven bands. */
const BALLOON_WICKER = '#c49c68',
  BALLOON_WEAVE = '#98744c';
/**
 * The envelope as `gores` panels round the y axis along `profile` (radius x at height y), each
 * `cols` columns wide and a little full (by `full` of the radius at the equator, nothing at the
 * mouth and crown) between its seams, so the seams crease as a real envelope's load tapes do.
 * Each panel is shaded on its own; alternate panels go to `red` and `cream`. `tapes` is a ribbon
 * 0.08 wide, 0.012 proud, along every seam.
 */
function balloonEnvelope(profile: T.Vector2[], gores: number, cols: number, full: number) {
  const red: T.BufferGeometry[] = [], cream: T.BufferGeometry[] = [], rows = profile.length;
  const grid = (at: (i: number, c: number) => number[], width: number) => {
    const pos: number[] = [], idx: number[] = [];
    for (let i = 0; i < rows; i++) for (let c = 0; c <= width; c++) pos.push(...at(i, c));
    for (let i = 0; i < rows - 1; i++)
      for (let c = 0; c < width; c++) {
        const a = i * (width + 1) + c, d = a + width + 1;
        idx.push(a, a + 1, d, a + 1, d + 1, d);
      }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geometry.setIndex(idx);
    geometry.computeVertexNormals();
    return geometry;
  };
  const tapes: T.BufferGeometry[] = [];
  for (let gore = 0; gore < gores; gore++) {
    const panel = grid((i, c) => {
      const { x: r, y } = profile[i], f = c / cols, a = ((gore + f) / gores) * Math.PI * 2,
        rr = r * (1 + full * Math.pow(Math.sin(Math.PI * f), 0.7) * Math.sin((Math.PI * i) / (rows - 1)));
      return [rr * Math.sin(a), y, rr * Math.cos(a)];
    }, cols);
    (gore % 2 ? cream : red).push(panel);
    tapes.push(grid((i, c) => {
      const { x: r, y } = profile[i], a = (gore / gores) * Math.PI * 2 + ((c - 0.5) * 0.08) / r, rr = r + 0.012;
      return [rr * Math.sin(a), y, rr * Math.cos(a)];
    }, 1));
  }
  return { red, cream, tapes: mergeParts(tapes) };
}

export function createMovers(ctx: TownContext, kit: Kit) {
  const { material, lamps, animated } = ctx;
  const { box, cylinder, strut, lampGlass } = kit;
  function hotAirBalloon(g: T.Object3D) {
    const b = new T.Group();
    g.add(b);
    // The envelope: twelve gores in red and cream, a little full between their load tapes, from the
    // mouth (y 0.06 over its base at 0.95) up a smooth teardrop to the crown ring (y 4.04).
    const base = 0.95,
      profile = new T.SplineCurve(BALLOON_PROFILE.map(([r, y]) => new T.Vector2(r, y))).getSpacedPoints(25),
      { red, cream, tapes } = balloonEnvelope(profile, 12, 6, 0.025);
    part(b, mergeParts(red).translate(0, base, 0), palette.balloon, 'fabric', true);
    part(b, mergeParts(cream).translate(0, base, 0), palette.balloonBand, 'fabric', true);
    part(b, tapes.translate(0, base, 0), palette.rope, 'fabric', true);
    // The crown: a dark ring round the parachute vent's domed cap; the mouth: a dark ring and the skirt below it.
    const top = profile[profile.length - 1], mouth = profile[0],
      lathe = (pts: number[][], n = 24) => new T.LatheGeometry(pts.map(([r, y]) => new T.Vector2(r, y)), n).translate(0, base, 0);
    part(b, mergeParts([
      new T.TorusGeometry(top.x, 0.05, 6, 24).rotateX(Math.PI / 2).translate(0, base + top.y, 0),
      new T.TorusGeometry(mouth.x, 0.045, 6, 24).rotateX(Math.PI / 2).translate(0, base + mouth.y, 0),
    ]), palette.woodDark, 'fabric', true);
    part(b, lathe([[top.x, top.y - 0.02], [top.x - 0.07, top.y + 0.035], [top.x * 0.5, top.y + 0.062], [0, top.y + 0.07]]), palette.gold, 'fabric', true);
    part(b, lathe([[mouth.x + 0.06, mouth.y - 0.18], [mouth.x + 0.03, mouth.y - 0.06], [mouth.x + 0.01, mouth.y + 0.02]]), BALLOON_SKIRT, 'fabric', true);
    // The burner under the mouth on its square frame, the frame on four rods from the basket's
    // corners, and four flying wires from the corners up inside the skirt to the mouth ring.
    const steel = '#7d8288',
      rod = (a: T.Vector3, c: T.Vector3) => new T.TubeGeometry(new T.LineCurve3(a, c), 1, 0.035, 6, false);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    part(b, mergeParts([
      new T.CylinderGeometry(0.1, 0.1, 0.12, 12).translate(0, 0.8, 0), // burner
      new T.TorusGeometry(0.1, 0.035, 5, 12).rotateX(Math.PI / 2).translate(0, 0.86, 0), // coil
      ...[0, 1, 2, 3].map((k) => new T.BoxGeometry(0.51, 0.07, 0.07).translate(0, 0.7, 0.22).rotateY((k * Math.PI) / 2)), // frame
      ...corners.map(([sx, sz]) => rod(new T.Vector3(sx * 0.27, 0.5, sz * 0.27), new T.Vector3(sx * 0.22, 0.7, sz * 0.22))),
      ...corners.map(([sx, sz]) => rod(new T.Vector3(sx * 0.3, 0.5, sz * 0.3), new T.Vector3(sx * mouth.x * Math.SQRT1_2, base + mouth.y, sz * mouth.x * Math.SQRT1_2))),
    ]), steel, 'fabric', true);
    // The wicker basket, a little narrower at its foot, with a woven band round it, a dark skid at
    // its foot, a padded leather rim and its dark inside.
    part(b, mouldedBlock(0.35, 0.35, [{ s: 0.035, y: -0.05 }, { s: 0, y: 0.06 }, { s: 0, y: 0.42 }], 0.07, 3), BALLOON_WICKER, 'fabric', true);
    part(b, mergeParts([
      mouldedBlock(0.35, 0.35, [{ s: -0.012, y: 0.2 }, { s: -0.016, y: 0.235 }, { s: -0.012, y: 0.27 }], 0.07, 3),
      mouldedBlock(0.35, 0.35, [{ s: 0.03, y: -0.05 }, { s: -0.005, y: -0.015 }, { s: -0.005, y: 0.03 }, { s: 0.01, y: 0.05 }], 0.07, 3),
    ]), BALLOON_WEAVE, 'fabric', true);
    part(b, mergeParts([0, 1, 2, 3].map((k) => new RoundedBoxGeometry(0.8, 0.1, 0.1, 1, 0.045).translate(0, 0.465, 0.35).rotateY((k * Math.PI) / 2))), palette.woodDark, 'fabric', true);
    part(b, new T.BoxGeometry(0.62, 0.02, 0.62).translate(0, 0.43, 0), '#4f3a2a', 'fabric', true);
    // No shadow: from its beat off the west shore the sun lays it on the beach behind the
    // terrace, where it reads as a dark blot in the People chapter rather than as a balloon.
    b.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.castShadow = false;
        o.userData.noShadow = true;
      }
    });
    b.userData.keepSeparate = true;
    b.userData.followsDrift = true; // city-scene turns it with the idle drift (followDrift)
    /**
     * The balloon's batched meshes take their own copies of the shared batch materials (the same
     * shader program), so their colour can follow the night without darkening everything else
     * made of fabric or wood.
     */
    function dim(night: number) {
      const f = 1 - BALLOON_NIGHT_DIM * night;
      for (const part of b.children) {
        if (!(part instanceof T.Mesh) || !(part.material instanceof T.MeshStandardMaterial) || !part.material.vertexColors) continue;
        if (!part.material.userData.balloonOwn) {
          const shared = part.material,
            own = shared.clone();
          own.onBeforeCompile = (shader, renderer) => shared.onBeforeCompile(shader, renderer);
          own.customProgramCacheKey = () => shared.customProgramCacheKey();
          own.userData.balloonOwn = true;
          part.material = own;
        }
        part.material.color.setScalar(f);
      }
    }
    animated.push({
      object: b,
      update(time, night) {
        dim(night);
        // To and fro across the opening view's open band over the west shore and the sea, so it
        // never drifts across a chapter's subject or out of that band; it eases to a stop at each
        // end, as in a lull, and turns back.
        const a = BALLOON.at,
          across = BALLOON.reach * (Math.cos(time * BALLOON.rate) - 1), // 0 to -2 reach, along screen-right
          r = Math.SQRT1_2;
        // The crown stays at about 17.9; the gulls fly below 10.7.
        b.position.set(
          Math.cos(a) * BALLOON.radius + across * r,
          BALLOON.height + Math.sin(time * 0.4) * BALLOON.bob,
          Math.sin(a) * BALLOON.radius - across * r,
        );
        b.rotation.y = -a;
        b.rotation.z = Math.sin(time * 0.6) * 0.03;
      },
    });
    return b;
  }

  /** One mesh of `geometry` in g, casting and receiving unless `noShadow`. */
  function part(g: T.Object3D, geometry: T.BufferGeometry, colour: string, kind: SurfaceKind, noShadow = false) {
    const m = new T.Mesh(geometry, material(colour, kind));
    m.castShadow = !noShadow;
    m.receiveShadow = true;
    if (noShadow) m.userData.noShadow = true;
    g.add(m);
    return m;
  }
  /**
   * The tram's measures (local units: +z forward, y 0 the rail head). The body is a stadium
   * TRAM.half wide with half-round ends about z ±TRAM.straight; the bogies sit at ±TRAM.bogie
   * (plan's TRAM_BOGIE) on wheels over the rails at x ±TRAM.gauge; the headlamp housings' rims
   * are its nose (plan's TRAM_DRIVE.nose).
   */
  const TRAM = { half: 0.6, straight: 1.26, bogie: 1.1, gauge: 0.42, wheel: 0.12, wheelbase: 0.5, nose: 1.89 };
  /**
   * A Glasgow Corporation 'Coronation'-style single-deck car in the Corporation's orange, green and
   * cream. The body is swept up moulded profiles round its half-round ends: a green bottom rail,
   * orange lower panels with a slight tumblehome, a proud green waist rail, a cream sill, wrap-round
   * glazing between cream window posts whose filleted corners round every opening, a cream header
   * rail and a green domed roof with a rain-strip eave, a cream roof board and a blank destination
   * box on the dome at either end. A framed, glazed door at each corner over a dark step; at each
   * end a dark wrap-round bumper, the lifeguard's tray under it and a headlamp in a drum housing; under
   * it two bogies with visible wheels on the rails, side frames and axle boxes. The trolley pole
   * rises aft from a sprung base on the roof board to its wheel. Nothing on it is lettered.
   */
  function buildTram() {
    const tram = new T.Group();
    tram.name = 'tram';
    const orange = palette.tramOrange, green = palette.tram, cream = palette.tramCream,
      { half: R, straight: az } = TRAM,
      hz = az + R;
    const body = (profile: Moulding[], colour: string, kind: SurfaceKind = 'enamel', arc = 8) =>
      part(tram, stadium(R, hz, profile, arc), colour, kind);
    // The body, foot to roof (s is the inset from the 0.6 half-width).
    body([{ s: 0.12, y: 0.22 }, { s: 0.07, y: 0.245 }, { s: 0.05, y: 0.27 }, { s: 0.05, y: 0.3 }, { s: 0.07, y: 0.32 }], green); // bottom rail
    body([{ s: 0.075, y: 0.3 }, { s: 0.068, y: 0.4 }, { s: 0.062, y: 0.55 }, { s: 0.062, y: 0.75 }], orange); // lower panels
    body([{ s: 0.07, y: 0.73 }, { s: 0.045, y: 0.75 }, { s: 0.035, y: 0.78 }, { s: 0.035, y: 0.82 }, { s: 0.045, y: 0.85 }, { s: 0.07, y: 0.87 }], green); // waist rail
    body([{ s: 0.07, y: 0.86 }, { s: 0.06, y: 0.88 }, { s: 0.06, y: 0.92, sharp: true }, { s: 0.11, y: 0.935 }], cream); // sill
    body([{ s: 0.11, y: 1.3 }, { s: 0.06, y: 1.315, sharp: true }, { s: 0.06, y: 1.38 }, { s: 0.08, y: 1.39 }], cream); // header rail
    body([
      { s: 0.08, y: 1.38 }, { s: 0.01, y: 1.395 }, { s: 0, y: 1.42 }, { s: 0.01, y: 1.445 }, { s: 0.05, y: 1.46, sharp: true }, // rain-strip eave
      { s: 0.07, y: 1.49 }, { s: 0.12, y: 1.54 }, { s: 0.19, y: 1.58 }, { s: 0.27, y: 1.605 }, { s: 0.33, y: 1.615 },
    ], green, 'enamel', 10); // domed roof
    part(tram, stadium(0.25, 1.2, [{ s: 0.02, y: 1.58 }, { s: 0, y: 1.6 }, { s: 0, y: 1.66, sharp: true }, { s: 0.035, y: 1.69 }], 6), cream, 'enamel'); // roof board
    // Glazing: one wrap-round band behind the posts, and the doors' lights, as one pane.
    const glass: T.BufferGeometry[] = [stadium(R, hz, [{ s: 0.11, y: 0.92 }, { s: 0.11, y: 1.31 }], 10)];
    // Window posts on the glazing's face (0.49 out): three bays a side between the doors, three
    // lights round each end (a quarter light either side of the windscreen).
    const posts: T.BufferGeometry[] = [],
      rg = R - 0.11,
      post = () => filletPost(0.09, 0.39, 0.05, 0.035, 0.012).translate(0, 0.925, -0.01);
    for (const sx of [-1, 1]) for (const z of [-0.8, -0.27, 0.27, 0.8]) posts.push(placed(post(), sx * rg, 0, z, (sx * Math.PI) / 2));
    for (const ez of [-1, 1])
      for (const a of [0, 0.9, Math.PI - 0.9, Math.PI]) {
        const nx = Math.cos(a), nz = ez * Math.sin(a);
        posts.push(placed(post(), rg * nx, 0, ez * az + rg * nz, Math.atan2(nx, nz)));
      }
    part(tram, mergeParts(posts), cream, 'enamel');
    // Doors at the four corners: a cream frame, a green leaf with a big light over a panel, a dark step.
    const frames: T.BufferGeometry[] = [], leaves: T.BufferGeometry[] = [], steps: T.BufferGeometry[] = [];
    for (const sx of [-1, 1])
      for (const ez of [-1, 1]) {
        const z = ez * 1.03, ry = (sx * Math.PI) / 2, at = (x: number) => sx * x;
        frames.push(placed(frameGeometry(0.4, 1.1, 0.06, 0.3, 0.99, 0.035, 0.025, 0.01, 2), at(0.555), 0.81, z, ry));
        leaves.push(
          placed(new RoundedBoxGeometry(0.3, 0.6, 0.045, 1, 0.015), at(0.552), 0.6, z, ry), // the lower panel
          placed(frameGeometry(0.3, 0.46, 0.02, 0.16, 0.32, 0.03, 0.035, 0, 2), at(0.535), 1.08, z, ry), // stiles and rails round the light
        );
        glass.push(placed(new T.BoxGeometry(0.17, 0.37, 0.02), at(0.555), 1.08, z, ry));
        steps.push(placed(new RoundedBoxGeometry(0.11, 0.07, 0.36, 1, 0.02), at(0.535), 0.215, z));
      }
    part(tram, mergeParts(frames), cream, 'enamel');
    part(tram, mergeParts(leaves), green, 'enamel');
    part(tram, mergeParts(glass), palette.glass, 'glass');
    // The ends: a destination box on the dome (a green hood round a blank cream blind), a wrap-round
    // bumper over the bottom rail, the lifeguard's tray under it, and the headlamp's drum housing.
    const hoods: T.BufferGeometry[] = [], blinds: T.BufferGeometry[] = [], dark: T.BufferGeometry[] = [];
    const bumper: [number, number][] = [[0.5, 0.25], [0.57, 0.255], [0.595, 0.275], [0.6, 0.305], [0.595, 0.335], [0.57, 0.355], [0.5, 0.36]],
      lifeguard: [number, number][] = [[0.4, 0.07], [0.49, 0.07], [0.52, 0.09], [0.53, 0.13], [0.52, 0.2], [0.4, 0.22]];
    const housing = [[0.085, 0], [0.105, 0.03], [0.105, 0.08], [0.114, 0.1], [0.1, 0.12], [0.08, 0.1]].map(([r, y]) => new T.Vector2(r, y));
    for (const ez of [-1, 1]) {
      const end = (g: T.BufferGeometry) => (ez > 0 ? g.translate(0, 0, az) : g.rotateY(Math.PI).translate(0, 0, -az));
      hoods.push(placed(new RoundedBoxGeometry(0.46, 0.17, 0.22, 1, 0.05), 0, 1.6, ez * 1.6));
      blinds.push(placed(new RoundedBoxGeometry(0.34, 0.09, 0.04, 1, 0.015), 0, 1.6, ez * 1.705));
      dark.push(end(endBand(bumper, -1.32, 1.32, 20, 0.5, 0.18)));
      dark.push(end(endBand(lifeguard, -0.95, 0.95, 12, 0.4, 0.25)));
      dark.push(placed(new T.LatheGeometry(housing, 12), 0, 0.52, ez * (TRAM.nose - 0.12), ez > 0 ? 0 : Math.PI, Math.PI / 2));
    }
    part(tram, mergeParts(hoods), green, 'enamel');
    part(tram, mergeParts(blinds), cream, 'enamel');
    part(tram, mergeParts(dark), UNDERGEAR, 'enamel');
    // Bogies: per bogie, the wheels on the rails, side frames outside them with an axle box over
    // each axle and a spring plank between, and a bolster under the body.
    for (const ez of [-1, 1]) {
      const zc = ez * TRAM.bogie, gear: T.BufferGeometry[] = [];
      for (const sx of [-1, 1]) {
        for (const dz of [-TRAM.wheelbase / 2, TRAM.wheelbase / 2]) {
          gear.push(new T.CylinderGeometry(TRAM.wheel, TRAM.wheel, 0.07, 12).rotateZ(Math.PI / 2).translate(sx * TRAM.gauge, TRAM.wheel, zc + dz)); // wheel
          gear.push(placed(new T.BoxGeometry(0.09, 0.12, 0.13), sx * 0.5, 0.13, zc + dz)); // axle box
        }
        gear.push(placed(new RoundedBoxGeometry(0.07, 0.1, 0.82, 1, 0.025), sx * 0.5, 0.2, zc)); // side frame
        gear.push(placed(new T.BoxGeometry(0.08, 0.07, 0.3), sx * 0.5, 0.115, zc)); // spring plank
      }
      gear.push(placed(new T.BoxGeometry(0.92, 0.07, 0.18), 0, 0.2, zc)); // bolster
      part(tram, mergeParts(gear), UNDERGEAR, 'iron');
    }
    part(tram, mergeParts(steps), UNDERGEAR, 'iron');
    // The trolley pole: a sprung base on the roof board, the pole rising aft, the trolley head and wheel.
    const foot = new T.Vector3(0, 1.79, 0.45), head = new T.Vector3(0, 2.33, -0.72), along = head.clone().sub(foot).normalize();
    const pole = [
      placed(new T.CylinderGeometry(0.13, 0.14, 0.05, 16), 0, 1.715, 0.45), // turntable
      placed(new RoundedBoxGeometry(0.18, 0.1, 0.34, 1, 0.03), 0, 1.79, 0.38), // spring housing
      new T.CylinderGeometry(0.035, 0.04, foot.distanceTo(head), 8)
        .applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), along))
        .translate((foot.x + head.x) / 2, (foot.y + head.y) / 2, (foot.z + head.z) / 2),
      placed(new RoundedBoxGeometry(0.1, 0.09, 0.12, 1, 0.025), head.x, head.y, head.z), // trolley head
      new T.CylinderGeometry(0.065, 0.065, 0.07, 14).rotateZ(Math.PI / 2).translate(head.x, head.y + 0.05, head.z - 0.06), // wheel
    ];
    part(tram, mergeParts(pole), palette.metal, 'iron');
    // The headlamps' lenses, set in their housings (the nose is the housings' rims).
    for (const ez of [-1, 1]) {
      const lens = new T.Mesh(new T.IcosahedronGeometry(0.08, 1).scale(1, 1, 0.4), lampGlass());
      lens.position.set(0, 0.52, ez * (TRAM.nose - 0.035));
      tram.add(lens);
      lamps.push(lens);
    }
    return tram;
  }
  /**
   * The harbour boat, a little Clyde puffer (BOAT's lines; waterline at local 0, bow +z): a lofted
   * red hull with a round bilge, a flared side and a sheer rising to a raised bow, a square transom,
   * a dark rubbing strake round it at the deck line and a cream cap rail on cream bulwarks round a
   * planked deck. Aft, a cream wheelhouse on a dark skirting: three framed windows forward, a side
   * window over a quartered lifebuoy and a glazed teak door on either side, under a red roof with a
   * deep rounded eave. Forward of it, the engine casing and the funnel (cream, a red band, a dark
   * top with a flared rim); amidships, the hold's coaming under a lashed tarpaulin; then the winch
   * (a drum of rope between its frames, warping ends outboard) at the foot of the mast, which carries
   * a crosstree, the derrick boom over the hatch, a forestay, shrouds, a topping lift and the mast
   * lantern; fish boxes in the bows, a locker at the stern and tyre-dark fenders over the sides. No
   * name, no number. Parts of a colour merge before batching, so the boat keeps its batched meshes.
   */
  function buildBoat() {
    const boat = new T.Group();
    boat.name = 'harbour-boat';
    const red = palette.boat, cream = palette.tramCream, wood = palette.wood, dark = palette.woodDark,
      tarp = '#66705f', t = BOAT.bulwark;
    // The hull: the skin, the transom, the bulwarks' inner face and the deck.
    const { skin, section } = hullSkin();
    const transom = new T.ShapeGeometry(new T.Shape(section(0)), 1).rotateY(Math.PI).translate(0, 0, BOAT.stern);
    part(boat, mergeParts([skin, transom]), red, 'enamel');
    part(boat, hullBand(-0.01, 0.09, 0.004), UNDERGEAR, 'enamel'); // the boot-top at the waterline
    const inner = (z: number) => Math.max(0, hullHalf(boatBreadth(z), boatSheer(z), boatSheer(z)) - t);
    const lining: number[] = [];
    for (let i = 0; i < boatStations.length - 1; i++)
      for (const sx of [-1, 1]) {
        const za = boatStations[i], zb = boatStations[i + 1],
          a0 = [sx * inner(za), boatSheer(za), za], a1 = [sx * inner(za), BOAT.deck, za],
          b0 = [sx * inner(zb), boatSheer(zb), zb], b1 = [sx * inner(zb), BOAT.deck, zb];
        lining.push(...(sx > 0 ? [...a0, ...a1, ...b0, ...a1, ...b1, ...b0] : [...a0, ...b0, ...a1, ...a1, ...b0, ...b1]));
      }
    {
      const zs = BOAT.stern + t, x = inner(zs), top = boatSheer(zs);
      lining.push(-x, top, zs, -x, BOAT.deck, zs, x, BOAT.deck, zs, -x, top, zs, x, BOAT.deck, zs, x, top, zs); // the transom's inner face
    }
    const bulwarks = new T.BufferGeometry();
    bulwarks.setAttribute('position', new T.Float32BufferAttribute(lining, 3));
    bulwarks.computeVertexNormals();
    // The cap rail and the rubbing strake: closed tubes round the sheer and round the deck line.
    const loop = (y: (z: number) => number, x: (z: number) => number, aft = 0) => {
      const zs = [BOAT.stern + aft, BOAT.stern + aft + 0.05, ...boatStations.slice(1, -1)],
        side = (sx: number) => (sx > 0 ? zs : zs.slice().reverse()).map((z) => new T.Vector3(sx * x(z), y(z), z));
      // Across the transom it runs straight, through points of its own, rather than bowing aft between the quarters.
      const z0 = zs[0], x0 = x(z0), across = [x0 - 0.05, x0 / 2, 0, -x0 / 2, 0.05 - x0].map((ax) => new T.Vector3(-ax, y(z0), z0));
      return new T.CatmullRomCurve3([...side(1), new T.Vector3(0, y(BOAT.bow - 0.02), BOAT.bow - 0.01), ...side(-1), ...across], true, 'centripetal');
    };
    // The cap rail's outer edge is flush with the skin and the transom at the sheer, so only its rounded top shows.
    const capX = (z: number) => Math.max(0, hullHalf(boatBreadth(z), boatSheer(z), boatSheer(z)) - 0.048),
      cap = loop((z) => boatSheer(z), capX, 0.048);
    const strake = loop((z) => boatSheer(z) - 0.16, (z) => hullHalf(boatBreadth(z), boatSheer(z) - 0.16, boatSheer(z)));
    part(boat, mergeParts([bulwarks, new T.TubeGeometry(cap, 72, 0.048, 6, true)]), cream, 'enamel');
    part(boat, new T.TubeGeometry(strake, 72, 0.04, 5, true), dark, 'wood');
    const deckOutline = boatStations.slice(0, -1).map((z) => new T.Vector2(inner(z), -z));
    const deck = new T.ShapeGeometry(new T.Shape([...deckOutline, ...deckOutline.slice().reverse().map((p) => new T.Vector2(-p.x, p.y))]), 1)
      .rotateX(-Math.PI / 2)
      .translate(0, BOAT.deck, 0);
    part(boat, deck, wood, 'wood');
    // The wheelhouse, aft: walls on a dark skirting, a red roof with a deep rounded eave.
    const wz = -0.78, wx = 0.4, wd = 0.34, face = wz + wd;
    part(boat, mouldedBlock(wx, wd, [{ s: 0, y: 0.5 }, { s: 0, y: 1.12 }, { s: -0.012, y: 1.14 }], 0.04, 3).translate(0, 0, wz), cream, 'enamel');
    part(boat, mouldedBlock(wx, wd, [{ s: -0.025, y: BOAT.deck }, { s: -0.025, y: 0.51, sharp: true }, { s: 0, y: 0.53 }], 0.05, 3).translate(0, 0, wz), dark, 'wood');
    part(boat, mouldedBlock(wx + 0.08, wd + 0.08, [{ s: 0.06, y: 1.12 }, { s: 0.01, y: 1.15 }, { s: 0, y: 1.17 }, { s: 0, y: 1.2, sharp: true }, { s: 0.035, y: 1.235 }, { s: 0.09, y: 1.25 }], 0.12, 3).translate(0, 0, wz), red, 'enamel');
    // Windows (a red frame round a glass pane set into the wall) and the doors.
    const frames: T.BufferGeometry[] = [], panes: T.BufferGeometry[] = [], leaves: T.BufferGeometry[] = [];
    const glazed = (x: number, y: number, z: number, ry: number, w: number, h: number) => {
      frames.push(placed(frameGeometry(w + 0.12, h + 0.12, 0.06, w, h, 0.03, 0.025, 0.008, 2), x, y, z, ry)); // members 0.06 (0.076 with the bevel)
      panes.push(placed(new T.BoxGeometry(w + 0.02, h + 0.02, 0.03), x - 0.005 * Math.sin(ry), y, z - 0.005 * Math.cos(ry), ry));
    };
    for (const x of [-0.235, 0, 0.235]) glazed(x, 0.93, face, 0, 0.13, 0.2);
    for (const sx of [-1, 1]) {
      const ry = (sx * Math.PI) / 2;
      glazed(sx * wx, 0.95, wz + 0.17, ry, 0.14, 0.2);
      // The door, aft: a teak leaf with a small light, in a red frame.
      frames.push(placed(frameGeometry(0.32, 0.66, 0.06, 0.2, 0.54, 0.03, 0.025, 0.008, 2), sx * wx, 0.8, wz - 0.14, ry));
      leaves.push(placed(new RoundedBoxGeometry(0.2, 0.55, 0.04, 1, 0.015), sx * (wx - 0.005), 0.8, wz - 0.14, ry));
      panes.push(placed(new T.BoxGeometry(0.1, 0.13, 0.03), sx * (wx + 0.012), 0.93, wz - 0.14, ry));
    }
    part(boat, mergeParts(frames), red, 'enamel');
    part(boat, mergeParts(panes), palette.glass, 'glass');
    part(boat, mergeParts(leaves), wood, 'wood');
    // A lifebuoy under each side window: a ring in red and cream quarters.
    const buoys: T.BufferGeometry[][] = [[], []];
    for (const sx of [-1, 1])
      for (let k = 0; k < 4; k++)
        buoys[k % 2].push(new T.TorusGeometry(0.105, 0.042, 5, 4, Math.PI / 2).rotateZ((k * Math.PI) / 2 + Math.PI / 4).rotateY(Math.PI / 2).translate(sx * (wx + 0.07), 0.64, wz + 0.17));
    part(boat, mergeParts(buoys[0]), palette.flowers[0], 'enamel');
    part(boat, mergeParts(buoys[1]), cream, 'enamel');
    // The engine casing and the funnel on it: cream, a red band, a dark top with a flared rim.
    part(boat, mouldedBlock(0.26, 0.17, [{ s: -0.015, y: BOAT.deck }, { s: -0.015, y: 0.47, sharp: true }, { s: 0, y: 0.48 }, { s: 0, y: 0.6 }, { s: 0.02, y: 0.62 }], 0.05, 3).translate(0, 0, -0.26), cream, 'enamel');
    const fz = -0.27,
      turn = (pts: number[][]) => new T.LatheGeometry(pts.map(([r, y]) => new T.Vector2(r, y)), 16).translate(0, 0, fz);
    part(boat, mergeParts([turn([[0.17, 0.6], [0.168, 0.64], [0.156, 0.68], [0.146, 1.3]]), turn([[0.141, 1.42], [0.139, 1.5]])]), cream, 'enamel');
    part(boat, turn([[0.144, 1.29], [0.156, 1.3], [0.156, 1.42], [0.141, 1.43]]), red, 'enamel');
    part(boat, turn([[0.14, 1.49], [0.146, 1.5], [0.146, 1.58], [0.158, 1.6], [0.158, 1.62], [0.125, 1.62], [0.112, 1.595], [0, 1.59]]), UNDERGEAR, 'enamel'); // sooted inside
    // The hold: a teak coaming under a domed tarpaulin, battened along its sides and lashed across.
    const hz = 0.43, hd = 0.42, hw = 0.37;
    part(boat, mouldedBlock(hw, hd, [{ s: 0, y: BOAT.deck }, { s: 0, y: 0.58, sharp: true }, { s: -0.02, y: 0.6 }, { s: 0, y: 0.62 }], 0.05, 3).translate(0, 0, hz), dark, 'wood');
    const cover: Moulding[] = [{ s: 0, y: 0.6 }, { s: 0, y: 0.64 }, { s: 0.07, y: 0.685 }, { s: 0.16, y: 0.7 }, { s: 0.3, y: 0.705 }];
    part(boat, mouldedBlock(hw - 0.01, hd - 0.01, cover, 0.06, 3).translate(0, 0, hz), tarp, 'paint');
    /** The tarpaulin's height |x| out from the middle (its profile read across). */
    const crown = (x: number) => {
      const s = hw - 0.01 - Math.abs(x);
      for (let k = 2; k < cover.length; k++)
        if (s <= cover[k].s) return T.MathUtils.lerp(cover[k - 1].y, cover[k].y, (s - cover[k - 1].s) / (cover[k].s - cover[k - 1].s));
      return cover[cover.length - 1].y;
    };
    const lashings = [-0.27, 0, 0.27].map((dz) =>
      new T.TubeGeometry(new T.CatmullRomCurve3(Array.from({ length: 7 }, (_, k) => {
        const x = -hw - 0.005 + ((2 * hw + 0.01) * k) / 6;
        return new T.Vector3(x, Math.abs(x) > hw - 0.02 ? 0.6 : crown(x) + 0.02, hz + dz);
      })), 12, 0.035, 5, false));
    part(boat, mergeParts([...lashings, ...[-1, 1].map((sx) => new RoundedBoxGeometry(0.07, 0.07, 2 * hd, 1, 0.02).translate(sx * (hw - 0.01), 0.635, hz))]), palette.rope, 'paint');
    // The winch at the mast's foot: a drum of rope between two frames on a bedplate, warping ends outboard.
    const mz = 1.3, kz = 1.06;
    part(boat, mergeParts([
      new RoundedBoxGeometry(0.44, 0.07, 0.22, 1, 0.02).translate(0, BOAT.deck + 0.025, kz),
      ...[-1, 1].flatMap((sx) => [
        new RoundedBoxGeometry(0.07, 0.22, 0.2, 1, 0.02).translate(sx * 0.15, 0.57, kz),
        new T.CylinderGeometry(0.05, 0.065, 0.09, 10).rotateZ((sx * Math.PI) / 2).translate(sx * 0.235, 0.6, kz),
      ]),
      new T.CylinderGeometry(0.092, 0.092, 0.07, 14).rotateZ(Math.PI / 2).translate(-0.085, 0.6, kz), // drum flanges
      new T.CylinderGeometry(0.092, 0.092, 0.07, 14).rotateZ(Math.PI / 2).translate(0.085, 0.6, kz),
    ]), UNDERGEAR, 'paint');
    part(boat, new T.CylinderGeometry(0.075, 0.075, 0.12, 14).rotateZ(Math.PI / 2).translate(0, 0.6, kz), palette.rope, 'paint', true); // the drum's rope
    // The mast, its crosstree and cap, the derrick boom over the hatch and the stemhead.
    const top = new T.Vector3(0, 2.2, mz), goose = new T.Vector3(0, 0.8, mz - 0.06), boomEnd = new T.Vector3(0, 1.0, 0.22);
    const boom = boomEnd.clone().sub(goose);
    part(boat, mergeParts([
      new T.CylinderGeometry(0.045, 0.062, 2.2 - BOAT.deck, 10).translate(0, (2.2 + BOAT.deck) / 2, mz),
      new RoundedBoxGeometry(0.5, 0.07, 0.07, 1, 0.02).translate(0, 1.92, mz),
      new T.CylinderGeometry(0.04, 0.04, boom.length(), 8)
        .applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), boom.clone().normalize()))
        .translate((goose.x + boomEnd.x) / 2, (goose.y + boomEnd.y) / 2, (goose.z + boomEnd.z) / 2),
      new RoundedBoxGeometry(0.09, 0.16, 0.09, 1, 0.025).translate(0, boatSheer(BOAT.bow - 0.06) + 0.05, BOAT.bow - 0.06), // stemhead
    ]), dark, 'wood');
    part(boat, new T.CylinderGeometry(0.06, 0.06, 0.08, 10).translate(0, 2.2, mz), UNDERGEAR, 'paint'); // mast cap under the lantern
    // Standing rigging (galvanised wire) and the topping lift: thin, so they cast no shadow.
    const wire = (a: T.Vector3, b: T.Vector3) => new T.TubeGeometry(new T.LineCurve3(a, b), 1, 0.035, 5, false);
    const stem = new T.Vector3(0, boatSheer(BOAT.bow - 0.06) + 0.1, BOAT.bow - 0.06);
    part(boat, mergeParts([
      wire(top.clone().setY(2.12), stem),
      ...[-1, 1].map((sx) => wire(new T.Vector3(0, 1.9, mz), new T.Vector3(sx * capX(mz - 0.25), boatSheer(mz - 0.25), mz - 0.25))), // shrouds, into the cap rail
      wire(top.clone().setY(2.08), boomEnd.clone().add(new T.Vector3(0, 0.03, 0))),
    ]), '#7d8288', 'paint', true);
    // Fish boxes in the bows, a locker at the stern, fenders over the sides.
    part(boat, mergeParts([
      new RoundedBoxGeometry(0.26, 0.14, 0.24, 1, 0.03).rotateY(0.1).translate(0.1, BOAT.deck + 0.07, 1.48),
      new RoundedBoxGeometry(0.26, 0.14, 0.24, 1, 0.03).rotateY(-0.04).translate(0.09, BOAT.deck + 0.21, 1.47),
      new RoundedBoxGeometry(0.5, 0.2, 0.16, 1, 0.04).translate(0, BOAT.deck + 0.1, BOAT.stern + t + 0.11),
    ]), wood, 'wood');
    part(boat, new RoundedBoxGeometry(0.2, 0.18, 0.18, 1, 0.04).rotateY(0.2).translate(-0.165, BOAT.deck + 0.09, 1.5), palette.gold, 'paint');
    const fenders: T.BufferGeometry[] = [];
    for (const sx of [-1, 1])
      for (const z of [-0.55, 0.45]) {
        const b = boatBreadth(z), x = sx * (hullHalf(b, 0.3, boatSheer(z)) + 0.07);
        fenders.push(new T.CylinderGeometry(0.07, 0.07, 0.24, 10).translate(x, 0.3, z));
        fenders.push(wire(new T.Vector3(x, 0.4, z), new T.Vector3(sx * (inner(z) + t), boatSheer(z) - 0.01, z)));
      }
    part(boat, mergeParts(fenders), UNDERGEAR, 'paint', true);
    // Bow waves: each strip's forward end hugs the stem and its aft end trails outward, just clear of the hull.
    for (const s of [-1, 1]) {
      const fore = [s * (boatBreadth(1.8) + 0.07), 1.8], aft = [s * (boatBreadth(1.15) + 0.2), 1.15],
        dx = fore[0] - aft[0], dz = fore[1] - aft[1];
      box(boat, (fore[0] + aft[0]) / 2, 0.02, (fore[1] + aft[1]) / 2, 0.12, 0.03, Math.hypot(dx, dz), '#eaf6f2', 'paint', { ry: Math.atan2(dx, dz) });
    }
    const light = lampGlass();
    const lanternMesh = new T.Mesh(new T.SphereGeometry(0.1, 12, 8), light);
    lanternMesh.position.set(0, 2.32, mz); // mast lantern
    boat.add(lanternMesh);
    lamps.push(lanternMesh);
    return boat;
  }
  /**
   * The plane: a toy regional twin-jet in the tram's livery (plan.PLANE's measures and units), with
   * no lettering, registration or logo. A smooth fuselage (planeSection): cream, its belly green
   * (planeBelly) up to a little under the axis and sweeping up the tail cone toward the fin; a band
   * of cabin windows along both sides and the cockpit's glazing wrapped round the nose over the band's
   * foot, all one 'vehicle' glass (lit all night); a forward door either side, raised a little off
   * the skin with a small light at the windows' height (the port one where the jet bridge docks).
   * Low swept wings with a little dihedral and the tailplane in cream, the swept fin in orange; two
   * nacelles under the wings (green, a cream intake lip, dark fan faces, no propellers) on cream
   * pylons; chunky fixed gear (a nose leg with twin wheels, a main leg under each wing root with two
   * wheels), every part at least 0.08 across, so it all casts and nothing thin crawls. Steady
   * navigation lights, red to port and green to starboard at the wingtips and white at the tail:
   * small lenses lit by their own emissive (as the traffic signals' are), out of the lamps' night
   * loop, kept apart from the batch (`plane-lights`). Parts of a colour merge before batching, so
   * it batches as two meshes (its enamel and its glass) besides the three lenses.
   */
  function buildPlane() {
    const plane = new T.Group();
    plane.name = 'plane';
    const P = plan.PLANE,
      tip = P.length / 2,
      cream = palette.tramCream,
      green = palette.tram,
      orange = palette.tramOrange,
      steel = '#a6aaa5',
      G = PLANE_GLAZING,
      skins = new Map<string, SkinList>(),
      parts = new Map<string, T.BufferGeometry[]>(),
      add = (colour: string, ...list: T.BufferGeometry[]) => {
        const known = parts.get(colour);
        if (known) known.push(...list);
        else parts.set(colour, list);
      };
    // The fuselage's skin: stations closer where the nose and the tail cone curve, and on every
    // edge of the glazing; round each station the belly's edge, the band's edges and the top, so
    // each colour's edge falls on cells' edges.
    const nose = Array.from({ length: 12 }, (_, k) => PLANE_NOSE + (tip - PLANE_NOSE) * (1 - (1 - (k + 1) / 12) ** 1.6)).filter((z) => G.cockpit.every((c) => Math.abs(z - c) > 0.015)),
      zs = [...Array.from({ length: 12 }, (_, k) => -tip + (k * (PLANE_TAIL + tip)) / 12), PLANE_TAIL, G.cabin[0], -0.3, 0.3, 0.8, G.cabin[1], PLANE_NOSE, ...nose, ...G.cockpit].sort((a, b) => a - b),
      steps = (a: number, b: number, n: number) => Array.from({ length: n }, (_, k) => a + ((b - a) * k) / n),
      keys = (z: number) => {
        const belly = Math.asin(planeBelly(z)),
          b0 = Math.max(G.band[0], belly + 0.05),
          b1 = Math.max(G.band[1], b0 + 0.05),
          port = [...steps(-Math.PI / 2, belly, 5), ...steps(belly, b0, 2), ...steps(b0, b1, 2), ...steps(b1, Math.PI / 2, 4)];
        return [...port, Math.PI / 2, ...port.slice().reverse().map((a) => Math.PI - a)];
      },
      glazed = (z: number, a: number) => {
        const s = Math.sin(a);
        return (z > G.cabin[0] && z < G.cabin[1] && s > Math.sin(G.band[0]) && s < Math.sin(G.band[1])) || (z > G.cockpit[0] && z < G.cockpit[1] && s > Math.sin(G.band[0]));
      },
      livery = (z: number, a: number) => (Math.sin(a) < planeBelly(z) ? green : cream);
    skinCells(zs, keys, 0, (z, a) => (glazed(z, a) ? 'glass' : livery(z, a)), skins);
    // The tail cone's end, closed (the white light sits on it).
    {
      const end = planeSection(-tip),
        ring = keys(-tip),
        list = skins.get(green)!;
      for (let j = 0; j + 1 < ring.length; j++)
        for (const a of [ring[j + 1], ring[j], null]) {
          const [x, y] = a === null ? [0, end.y] : [end.r * Math.cos(a), end.y + end.r * Math.sin(a)];
          list.p.push(x, y, -tip);
          list.n.push(0, 0, -1);
        }
    }
    // The forward doors, either side, raised 0.012 off the skin in the livery's colours, each with a
    // small light at the windows' height; the port one is where the jet bridge's bellows meet it.
    for (const side of [1, -1]) {
      const turn = (a: number) => (side > 0 ? a : Math.PI - a),
        sorted = (list: number[]) => list.map(turn).sort((a, b) => a - b),
        belly = Math.asin(planeBelly(P.door));
      skinPanel(P.door - 0.11, P.door + 0.11, sorted([-0.66, (belly - 0.66) / 2, belly, G.band[0], 0.47, 0.73]), 0.012, livery, skins);
      skinCells([P.door - 0.05, P.door + 0.05], () => sorted([0.26, 0.56]), 0.015, () => 'glass', skins);
    }
    const glass: T.BufferGeometry[] = [];
    for (const [name, list] of skins) {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(list.p, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(list.n, 3));
      if (name === 'glass') glass.push(g);
      else add(name, g);
    }
    // The wings: one low swept foil from tip to tip through the fuselage's belly, with a little
    // dihedral; the tailplane likewise through the tail cone; the fin up from inside its top.
    const across = (at: number, z: number, y: number) => new T.Vector3(at, y, z),
      wing = (x: number): FoilStation => {
        const s = Math.abs(x) / (P.span / 2);
        return { at: x, le: 0.35 - 0.77 * s, chord: 1.1 - 0.68 * s, mid: 0.38 + 0.16 * s, thick: 0.13 - 0.06 * s };
      },
      tailY = planeSection(-1.8).y,
      tailplane = (x: number): FoilStation => {
        const s = Math.abs(x) / 0.8;
        return { at: x, le: -1.5 - 0.35 * s, chord: 0.55 - 0.25 * s, mid: tailY + 0.06 * s, thick: 0.085 - 0.015 * s };
      },
      root = 0.86,
      fin = (y: number): FoilStation => {
        const s = (y - root) / (P.fin - root);
        return { at: y, le: -1.1 - 0.72 * s, chord: 1.05 - 0.67 * s, mid: 0, thick: 0.11 - 0.04 * s };
      };
    add(cream, foil([wing(-P.span / 2), wing(0), wing(P.span / 2)], across));
    add(cream, foil([tailplane(-0.8), tailplane(0), tailplane(0.8)], across));
    add(orange, foil([fin(root), fin(P.fin)], (at, z, x) => new T.Vector3(x, at, z), 0.5));
    // The engines, under the wings: a nacelle turned about its axis (the exhaust's plug and nozzle
    // dark, the cowl green, the intake's lip cream, curling in to the dark fan face and its
    // spinner), on a cream pylon.
    const turned = (points: number[][]) => new T.LatheGeometry(points.map(([r, h]) => new T.Vector2(r, h)), 16).rotateX(Math.PI / 2);
    for (const s of [-1, 1]) {
      const at = (g: T.BufferGeometry) => g.translate(s * 0.95, 0.226, 0.05);
      add(UNDERGEAR, at(turned([[0.0005, -0.4], [0.045, -0.36], [0.075, -0.3], [0.1, -0.29], [0.118, -0.3]])));
      add(green, at(turned([[0.118, -0.3], [0.136, -0.2], [0.152, 0.0], [0.155, 0.18], [0.148, 0.32], [0.14, 0.375]])));
      add(cream, at(turned([[0.14, 0.375], [0.125, 0.41], [0.108, 0.395], [0.102, 0.36], [0.1, 0.3]])));
      add(UNDERGEAR, at(turned([[0.1, 0.3], [0.035, 0.3], [0.02, 0.325], [0.0005, 0.34]])));
      add(cream, new RoundedBoxGeometry(0.075, 0.1, 0.36, 1, 0.03).translate(s * 0.95, 0.405, -0.1));
    }
    // The gear: a nose leg with twin wheels, and a main leg under each wing root with two wheels on
    // its axle, the tyres dark with pale hubs, all standing on y 0.
    const wheel = (x: number, r: number, w: number, z: number) => {
      add(UNDERGEAR, new T.CylinderGeometry(r, r, w, 16).rotateZ(Math.PI / 2).translate(x, r, z));
      add(steel, new T.CylinderGeometry(r * 0.48, r * 0.48, w + 0.008, 12).rotateZ(Math.PI / 2).translate(x, r, z));
    };
    for (const s of [-1, 1]) {
      const x = (s * P.track) / 2;
      add(steel, new T.CylinderGeometry(0.045, 0.045, 0.3, 10).translate(x, 0.26, P.main));
      for (const w of [-1, 1]) wheel(x + w * 0.085, 0.11, 0.075, P.main);
    }
    add(steel, new T.CylinderGeometry(0.04, 0.04, 0.27, 10).translate(0, 0.225, P.nose));
    for (const w of [-1, 1]) wheel(w * 0.075, 0.085, 0.06, P.nose);
    for (const [colour, list] of parts) part(plane, mergeParts(list), colour, 'enamel');
    part(plane, mergeParts(glass), palette.glass, 'glass');
    // The navigation lights: steady lenses lit by their own emissive, kept apart from the batch.
    const lights = new T.Group();
    lights.name = 'plane-lights';
    lights.userData.keepSeparate = true;
    plane.add(lights);
    const tipAt = wing(P.span / 2),
      end = planeSection(-tip);
    for (const [lit, dark, x, y, z, stretch] of [
      ['#ff3426', '#3d1c19', P.span / 2 + 0.005, tipAt.mid, tipAt.le - 0.12, 1.4],
      ['#1fe39b', '#163a2c', -P.span / 2 - 0.005, tipAt.mid, tipAt.le - 0.12, 1.4],
      ['#fff1d6', '#5a5650', 0, end.y, -tip - 0.012, 1],
    ] as const) {
      const lens = new T.Mesh(new T.SphereGeometry(0.06, 12, 8).scale(1, 0.85, stretch), new T.MeshStandardMaterial({ color: dark, emissive: lit, emissiveIntensity: PLANE_LIGHT, roughness: 0.3, metalness: 0 }));
      lens.material.name = 'nav-light';
      lens.position.set(x, y, z);
      lens.castShadow = lens.receiveShadow = false;
      lights.add(lens);
    }
    return plane;
  }
  /**
   * A town bike (local +z forward, y 0 the ground, about 0.9 long): two tyres, a diamond frame in
   * `colour`, a dark bar and saddle, a chainring on the left, and optionally a wicker basket and a
   * front lamp (a dark housing round a lantern lens the frame loop lights at night, no light or
   * halo). Matte paint, not enamel, so the thin tubes do not glint; nothing casts, since thin
   * members ghost in the shadow map.
   */
  function bicycle(g: T.Object3D, colour: string, opts: { basket?: boolean; lamp?: boolean } = {}) {
    const bike = new T.Group();
    g.add(bike);
    const rubber = '#3a3f44',
      dark = '#3b3633',
      v = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
    const parts: T.Mesh[] = [];
    for (const z of [-0.3, 0.3]) {
      const tyre = new T.Mesh(new T.TorusGeometry(0.115, 0.035, 6, 14), material(rubber, 'paint'));
      tyre.position.set(0, 0.15, z);
      tyre.rotation.y = Math.PI / 2;
      bike.add(tyre);
      parts.push(tyre);
    }
    const bb = v(0, 0.15, 0),
      seat = v(0, 0.3, -0.08),
      head = v(0, 0.4, 0.21),
      rear = v(0, 0.15, -0.3),
      front = v(0, 0.15, 0.3);
    for (const [a, b] of [[bb, seat], [seat, head], [bb, v(0, 0.37, 0.22)], [bb, rear], [seat, rear], [head, front], [head, v(0, 0.56, 0.19)]])
      parts.push(strut(bike, a, b, 0.035, colour, 'paint'));
    parts.push(box(bike, 0, 0.56, 0.2, 0.36, 0.06, 0.06, dark, 'paint')); // handlebar
    parts.push(box(bike, 0, 0.33, -0.1, 0.1, 0.06, 0.17, dark, 'paint')); // saddle
    const ring = cylinder(bike, -0.05, 0.15, 0, 0.07, 0.07, 0.04, rubber, 'paint'); // chainring, axis along x
    ring.rotation.z = Math.PI / 2;
    parts.push(ring);
    if (opts.basket) parts.push(box(bike, 0, 0.5, 0.34, 0.24, 0.16, 0.2, palette.wood, 'wood'));
    if (opts.lamp) parts.push(box(bike, 0, 0.47, 0.25, 0.08, 0.07, 0.06, dark, 'paint')); // the lamp's housing, on the stem
    for (const m of parts) {
      m.castShadow = false;
      m.receiveShadow = true;
      m.userData.noShadow = true;
    }
    if (opts.lamp) {
      // Only the lens shows, set in the housing's front: a pale ball out on its own would read
      // as a third hand by day.
      const light = new T.Mesh(new T.IcosahedronGeometry(0.035, 1).scale(1, 1, 0.5), lampGlass());
      light.position.set(0, 0.47, 0.28);
      bike.add(light);
      lamps.push(light);
    }
    return bike;
  }
  return { hotAirBalloon, buildTram, buildBoat, buildPlane, bicycle };
}
