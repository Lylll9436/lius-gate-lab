import * as T from 'three';
import type { SurfaceKind } from './city-materials';
import { animateResident, blob, DEPTH, HEAD, lathe, paint, part, shade, torsoAt } from './city-people';
import type { AnimationFrame } from './town-shared';

/*
 * The rig the town's named figures share: Alison Heppenstall on the sky island (sky-figure.ts) and
 * Filip Biljecki on the tropic island (tropic-figure.ts). A resident's body (city-people.ts: the same
 * kit, scale, pivots and joints, so the residents' walk drives it) with an elbow in each arm; the
 * solves that put a hand on a target and a sole on the floor; the poses every figure has (at ease,
 * walking, seated, getting up); the china their tea and coffee come in; and the clock that takes a
 * figure through its day in town time and holds it, settling, while the town is held. Each figure
 * keeps its own look, its own props and poses, and its own day (town-plan's planDay builds them).
 * A figure taller or shorter than Alison is her rig scaled uniformly at its root: every measure here
 * is in the rig's own units.
 */
export type Material = (c: string, k?: SurfaceKind) => T.MeshStandardMaterial;
export type V3 = [number, number, number];

/* ------------------------------------------------------------------ */
/* Measures (the residents', see city-people.ts)                       */
/* ------------------------------------------------------------------ */
/** The hips' pivot height (each leg's group), and the arms' pivots (shoulders). */
export const HIP = 0.31,
  SHOULDER = { x: 0.165, y: 0.6 };
/** The arm's two bones: shoulder to elbow, and elbow to the hand's (mitten's) centre (0.215 in all, as a resident's). */
export const UPPER = 0.095,
  FORE = 0.12;
/** The thigh's radius at the hip: seated, its underside rests this far below the hip line. */
export const THIGH_R = 0.063;
/** An eye's point on the face (where a resident's eyes sit). */
export const EYE: V3 = [0, 0.772, 0.137];
/**
 * The seat a figure sits on, its top above its floor, by default: the town's park bench (town-props'
 * bench: slats centred 0.405 up, 0.07 thick, so 0.44). Seated, the hip line is 0.193 over the floor
 * (`lift`), the thighs rest on the seat, and the short legs hang from the knee with the soles 0.33
 * clear of the floor, as a resident's would. Any seat from 0.11 (where the soles just clear the floor)
 * works: the poses take `seat`.
 */
export const SEAT = 0.44;
/** A stride (one 'walk' phase, two steps) in the rig's units: animateResident's gait turns 17 radians a unit. */
export const STRIDE = (Math.PI * 2) / 17;
export const TAU = Math.PI * 2;
export const smooth = T.MathUtils.smoothstep;
/** A mix of a and b, exact at both ends. */
export const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t,
  mixV = (a: V3, b: V3, t: number): V3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/* ------------------------------------------------------------------ */
/* Colour and the hair's helpers                                       */
/* ------------------------------------------------------------------ */
const srgb = new T.Color();
/** A hex colour as sRGB components (0..1). */
export function sRGB(hex: string): V3 {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
/** A hex colour as HSV: hue in degrees, saturation and value 0..1. */
export function toHsv(hex: string): V3 {
  const [r, g, b] = sRGB(hex),
    max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  return [max === min ? 0 : (60 * (g - b)) / (max - min), max ? (max - min) / max : 0, max];
}
/** HSV (hue in degrees, saturation and value 0..1) as sRGB components. */
export function hsv(h: number, sat: number, v: number): V3 {
  const f = (k: number) => {
    const m = (k + h / 60) % 6;
    return v - v * sat * Math.max(0, Math.min(m, 4 - m, 1));
  };
  return [f(5), f(3), f(1)];
}
/** Whether a point is hidden inside the head or the torso (a little under their surfaces). */
export function insideBody(x: number, y: number, z: number) {
  const [a, b, c] = HEAD.r;
  if (Math.hypot(x / a, (y - HEAD.y) / b, (z - 0.005) / c) < 0.94) return true;
  const r = torsoAt(y);
  return r > 0 && Math.hypot(x / r, z / (r * DEPTH)) < 0.9;
}
/** A geometry (un-indexed, its positions and normals only) without the triangles whose three corners are all `hidden`. */
export function shown(geometry: T.BufferGeometry, hidden: (x: number, y: number, z: number) => boolean) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry,
    p = flat.getAttribute('position'),
    n = flat.getAttribute('normal'),
    pos: number[] = [],
    nor: number[] = [];
  for (let i = 0; i < p.count; i += 3) {
    if ([0, 1, 2].every((k) => hidden(p.getX(i + k), p.getY(i + k), p.getZ(i + k)))) continue;
    for (let k = 0; k < 3; k++) {
      pos.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k));
      nor.push(n.getX(i + k), n.getY(i + k), n.getZ(i + k));
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  return g;
}
/**
 * The triangles of an indexed geometry that are not wholly `hidden`, un-indexed, with colours on
 * their vertices from `colour` (sRGB, from each vertex's position and normal).
 */
export function kept(geometry: T.BufferGeometry, hidden: (x: number, y: number, z: number) => boolean, colour: (p: T.Vector3, n: T.Vector3) => V3) {
  const p = geometry.getAttribute('position'),
    nrm = geometry.getAttribute('normal'),
    index = geometry.index!,
    gone = new Uint8Array(p.count),
    rgb = new Float32Array(p.count * 3),
    v = new T.Vector3(),
    n = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    gone[i] = hidden(p.getX(i), p.getY(i), p.getZ(i)) ? 1 : 0;
    const [r, g, b] = colour(v.fromBufferAttribute(p, i), n.fromBufferAttribute(nrm, i));
    srgb.setRGB(r, g, b, T.SRGBColorSpace).toArray(rgb, i * 3);
  }
  const pos: number[] = [],
    nor: number[] = [],
    col: number[] = [];
  for (let k = 0; k < index.count; k += 3) {
    const tri = [index.getX(k), index.getX(k + 1), index.getX(k + 2)];
    if (tri.every((i) => gone[i])) continue;
    for (const i of tri) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      col.push(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  return g;
}

/* ------------------------------------------------------------------ */
/* The rig                                                             */
/* ------------------------------------------------------------------ */
/**
 * A figure's joints, the residents' pivots: its root (soles on y 0, facing +z), its body (torso and
 * head, leaned about the hip line), 'leg-left' (-x) and 'leg-right' (+x) with a 'knee' each, and
 * 'arm-left' (-x: the figure's own right hand; the residents name their sides by the viewer's left)
 * and 'arm-right' (+x) with an 'elbow' each.
 */
export type FigureJoints = {
  root: T.Group;
  body: T.Object3D;
  legs: [T.Object3D, T.Object3D];
  knees: [T.Object3D, T.Object3D];
  arms: [T.Object3D, T.Object3D];
  elbows: [T.Object3D, T.Object3D];
};
/** A limb's colours: the trousers and shoes, the sleeve (upper arm and, unless `forearm` says otherwise, the forearm) and the hand. */
export type LimbLook = { trousers: string; shoes: string; sleeve: string; skin: string; forearm?: string | ((p: T.Vector3) => string) };
/**
 * One side's leg and arm, on the residents' pivots, in `root`: the leg (a hip group 'leg-left' or
 * 'leg-right' at the hip, its thigh, and a 'knee' with the shin and a plain shoe) and the arm (an
 * 'arm-left' or 'arm-right' group at the shoulder, its sleeve, and an 'elbow' 0.095 down with the
 * forearm and a mitten hand), each half capped round at the elbow so the joint stays whole bent.
 * Every part is one mesh in 'fabric', its colours on its vertices. The leg is added to `root`
 * first, then the arm.
 */
export function limb(root: T.Group, side: number, material: Material, look: LimbLook) {
  const hip = new T.Group();
  hip.name = side < 0 ? 'leg-left' : 'leg-right';
  hip.position.set(side * 0.065, HIP, 0);
  root.add(hip);
  part(hip, [paint(lathe([[0, 0.03], [0.05, 0.025], [THIGH_R, 0.0], [0.06, -0.07], [0.055, -0.14], [0.03, -0.165], [0, -0.17]], 10), look.trousers, [-0.17, 0.02, 0.92, 1.02])], material, 'fabric');
  const knee = new T.Group();
  knee.name = 'knee';
  knee.position.y = -0.14;
  hip.add(knee);
  const shoe = blob([0.058, 0.044, 0.09], [0, 0, 0], 10),
    sp = shoe.getAttribute('position');
  for (let i = 0; i < sp.count; i++) if (sp.getY(i) < 0) sp.setY(i, sp.getY(i) * 0.8); // a flatter sole
  shoe.computeVertexNormals();
  shoe.translate(0, -0.135, 0.025);
  part(knee, [
    paint(lathe([[0, 0.02], [0.055, 0.01], [0.052, -0.07], [0.053, -0.094], [0.04, -0.106], [0, -0.108]], 10), look.trousers, [-0.1, 0.02, 0.84, 0.94]),
    paint(shoe, (p) => (p.y < -0.157 ? shade(look.shoes, 1.35) : look.shoes)),
  ], material, 'fabric', 'shoe');
  const arm = new T.Group();
  arm.name = side < 0 ? 'arm-left' : 'arm-right';
  arm.position.set(side * SHOULDER.x, SHOULDER.y, 0);
  arm.rotation.z = side * 0.12;
  root.add(arm);
  part(arm, [paint(lathe([[0, 0.045], [0.04, 0.035], [0.055, 0.0], [0.051, -0.05], [0.048, -UPPER], [0.034, -0.129], [0, -0.143]], 10), look.sleeve, [-0.14, 0.03, 0.9, 1.04])], material, 'fabric');
  const elbow = new T.Group();
  elbow.name = 'elbow';
  elbow.position.y = -UPPER;
  arm.add(elbow);
  part(elbow, [
    paint(lathe([[0, 0.048], [0.034, 0.034], [0.047, 0.0], [0.045, -0.04], [0.043, -0.072], [0.03, -0.083], [0, -0.088]], 10), look.forearm ?? look.sleeve, [-0.08, 0.04, 0.88, 1.0]),
    paint(blob([0.043, 0.05, 0.046], [0, -FORE, 0], 8), look.skin),
  ], material, 'fabric');
  return { hip, knee, arm, elbow };
}

/** A body-frame point after the body leans forward by `a` about the hip line (as seatRider leans the rider). */
export function leaned([x, y, z]: V3, a: number): V3 {
  const dy = y - HIP;
  return [x, HIP + dy * Math.cos(a) - z * Math.sin(a), dy * Math.sin(a) + z * Math.cos(a)];
}
/**
 * Lean the body forward by `a` about the hip line (y 0.31), carrying the shoulders with it; `reach`
 * draws each shoulder in, up and forward (the shoulder blade sliding round as an arm reaches out);
 * `back` moves the hips, and all of the figure over them, back over its feet (as its knees bend).
 */
export function lean(j: FigureJoints, a: number, reach: V3 = [0, 0, 0], back = 0) {
  j.body.rotation.set(a, 0, 0);
  j.body.position.set(0, HIP - HIP * Math.cos(a), -HIP * Math.sin(a) - back);
  j.arms.forEach((arm, k) => {
    arm.position.set(...leaned([(k ? 1 : -1) * (SHOULDER.x - reach[0]), SHOULDER.y + reach[1], reach[2]], a));
    arm.position.z -= back;
  });
  j.legs.forEach((leg) => (leg.position.z = -back));
}
/** A hand's centre (the mitten's) in the root's frame, from its arm and elbow as posed. */
export function figureHand(j: FigureJoints, k: 0 | 1, out = new T.Vector3()) {
  const arm = j.arms[k],
    elbow = j.elbows[k];
  return out.set(0, -FORE, 0).applyQuaternion(elbow.quaternion).add(elbow.position).applyQuaternion(arm.quaternion).add(arm.position);
}
const basis = new T.Matrix4();
/**
 * Put hand k's centre on `target` (the root's frame) by a two-bone solve from the shoulder, the
 * elbow pointing along `bend` as far as it can (out and down, so the arm folds as an arm does), the
 * forearm folding forward about the elbow. A target out of reach leaves the arm straight towards
 * it, and the checks catch that.
 */
export function reach(j: FigureJoints, k: 0 | 1, target: V3, bend: V3) {
  const S = j.arms[k].position,
    d = new T.Vector3(target[0] - S.x, target[1] - S.y, target[2] - S.z),
    dist = T.MathUtils.clamp(d.length(), FORE - UPPER + 1e-4, UPPER + FORE - 1e-4),
    a = d.normalize(),
    cosA = (UPPER * UPPER + dist * dist - FORE * FORE) / (2 * UPPER * dist),
    e = new T.Vector3(...bend);
  e.addScaledVector(a, -e.dot(a)).normalize();
  // The upper arm's direction, then the forearm's.
  const u = a.clone().multiplyScalar(cosA).addScaledVector(e, Math.sqrt(Math.max(0, 1 - cosA * cosA))),
    f = a.clone().multiplyScalar(dist).addScaledVector(u, -UPPER).normalize(),
    cosE = T.MathUtils.clamp(f.dot(u), -1, 1);
  // The arm's frame: -y down the upper arm, z the way the forearm folds, x across.
  const ly = u.clone().negate(),
    lz = f.clone().addScaledVector(u, -cosE);
  if (lz.lengthSq() < 1e-10) lz.set(0, 0, 1).addScaledVector(u, -u.z);
  lz.normalize();
  j.arms[k].quaternion.setFromRotationMatrix(basis.makeBasis(new T.Vector3().crossVectors(ly, lz), ly, lz));
  j.elbows[k].rotation.set(-Math.acos(cosE), 0, 0);
}
/** The lowest point of a leg's shoe above the floor its hip stands over, for a hip swing a and a knee bend b (animateResident's sole). */
export function sole(a: number, b: number) {
  const c = a + b;
  return HIP - 0.14 * Math.cos(a) - 0.135 * Math.cos(c) - 0.025 * Math.sin(c) - Math.hypot(0.035 * Math.cos(c), 0.09 * Math.sin(c));
}
/** From the hip to the middle of the shoe, down a straight leg (thigh 0.14, shin 0.135); and the shoe's half sizes under its middle (its sole is flattened). */
export const LEG = 0.275,
  SHOE: V3 = [0.058, 0.0352, 0.09];
const kneeFrame = new T.Matrix4(),
  shoeAt = new T.Vector3();
/**
 * The lowest point of a leg's shoe over the floor under the root, however the leg is turned (its
 * hip, `leg`, and its `knee`, as posed): the bottom of the shoe's ellipsoid, carried by both joints.
 */
export function soleOf(leg: T.Object3D, knee: T.Object3D) {
  leg.updateMatrix();
  knee.updateMatrix();
  const m = kneeFrame.multiplyMatrices(leg.matrix, knee.matrix),
    e = m.elements;
  shoeAt.set(0, -0.135, 0.025).applyMatrix4(m);
  // The ellipsoid's lowest point: its middle less its reach straight down (the y row of its turn).
  return shoeAt.y - Math.hypot(SHOE[0] * e[1], SHOE[1] * e[5], SHOE[2] * e[9]);
}
/** An arm as a pose leaves it: its turn at the shoulder and its elbow's bend. */
export type ArmState = { q: T.Quaternion; bend: number };
export const armState = (j: FigureJoints, k: 0 | 1): ArmState => ({ q: j.arms[k].quaternion.clone(), bend: j.elbows[k].rotation.x });
/** Arm k part of the way `t` from one state to another (exactly each at 0 and 1). */
export function easeArm(j: FigureJoints, k: 0 | 1, a: ArmState, b: ArmState, t: number) {
  j.arms[k].quaternion.slerpQuaternions(a.q, b.q, t);
  j.elbows[k].rotation.set(mix(a.bend, b.bend, t), 0, 0);
}
/** Each arm at ease, as atEase() leaves it. */
export const AT_EASE = [-1, 1].map((s) => ({ q: new T.Quaternion().setFromEuler(new T.Euler(0, 0, s * 0.12)), bend: -0.12 })) as [ArmState, ArmState];
/** Hand k's place in the lap seated, and the way its elbow bends there ('sit'). */
export const LAP = (k: 0 | 1): [V3, V3] => [
  [(k ? 1 : -1) * 0.1, 0.42, 0.075],
  [(k ? 1 : -1) * 0.8, -0.2, -0.6],
];
/** Getting up from a seat: how far the figure leans forward at its middle, as anyone does to stand up. */
export const RISE = { lean: 0.16 };

/* ------------------------------------------------------------------ */
/* The poses every figure has                                          */
/* ------------------------------------------------------------------ */
/** At ease: upright, legs straight, arms down and a little out, elbows soft. Every pose starts here. */
export function atEase(j: FigureJoints) {
  lean(j, 0);
  j.legs.forEach((leg) => leg.rotation.set(0, 0, 0));
  j.knees.forEach((knee) => knee.rotation.set(0, 0, 0));
  j.arms.forEach((arm, k) => arm.rotation.set(0, 0, (k ? 1 : -1) * 0.12));
  j.elbows.forEach((elbow) => elbow.rotation.set(-0.12, 0, 0));
}
/** Every prop hidden at the root's origin, unturned, for a pose to show those it holds. */
export function putAway(props: Record<string, T.Object3D>) {
  for (const p of Object.values(props)) {
    p.visible = false;
    p.position.set(0, 0, 0);
    p.rotation.set(0, 0, 0, 'XYZ');
  }
}
/** The root's lift seated on a seat `seat` high (SEAT if none is given; never under 0.11, where the soles would meet the floor). */
export const seatLift = (seat?: number) => Math.max(0.11, seat ?? SEAT) + THIGH_R - HIP;
/** Seated: thighs level and a little apart, shins hanging just forward of plumb, sitting up. Returns the root's lift. */
export function seated(j: FigureJoints, seat?: number) {
  const lift = seatLift(seat);
  j.legs.forEach((leg, k) => leg.rotation.set(-Math.PI / 2, 0, (k ? 1 : -1) * 0.07));
  j.knees.forEach((knee) => knee.rotation.set(Math.PI / 2 - 0.12, 0, 0));
  lean(j, -0.03);
  return lift;
}
/**
 * The residents' own walk at `u` of a stride (0..1), its gait scaled by `amount` (1 by default: 0 is
 * standing); the elbows fold a little more as each arm swings forward. Returns the root's lift (the
 * lower sole on the floor).
 */
export function walking(j: FigureJoints, u: number, amount?: number) {
  const a = T.MathUtils.clamp(amount ?? 1, 0, 1);
  j.root.userData.gait = { phase: u * TAU, amount: a };
  animateResident(j.root, 0, 0, false);
  const lift = -j.root.userData.sole;
  j.arms.forEach((arm, k) => j.elbows[k].rotation.set(-0.12 - 0.04 * a - 0.5 * Math.max(0, -arm.rotation.x), 0, 0));
  return lift;
}
/** Seated, both hands resting on the thighs (LAP). */
export function handsInLap(j: FigureJoints) {
  for (const k of [0, 1] as const) {
    const [lap, bend] = LAP(k);
    reach(j, k, lap, bend);
  }
}
/**
 * Getting up from a seat `seat` high, `p` from seated with the hands in the lap (0) to standing at
 * ease (1): every joint goes from the one to the other by the same smoothstep that slides the root
 * (whoever places the figure slides it), the seat's lift comes down to the floor, and the figure
 * leans into it midway. Back from 1 to 0, it sits down. Returns the root's lift.
 */
export function rising(j: FigureJoints, p: number, seat?: number) {
  const e = smooth(p, 0, 1),
    lift = seatLift(seat) * (1 - e);
  j.legs.forEach((leg, k) => leg.rotation.set((-Math.PI / 2) * (1 - e), 0, (k ? 1 : -1) * 0.07 * (1 - e)));
  j.knees.forEach((knee) => knee.rotation.set((Math.PI / 2 - 0.12) * (1 - e), 0, 0));
  lean(j, -0.03 * (1 - e) + RISE.lean * 4 * e * (1 - e));
  // The arms from the lap (as handsInLap reaches them, from the shoulders as they are now) to at ease.
  const easy = new T.Quaternion();
  for (const k of [0, 1] as const) {
    const [lap, bend] = LAP(k);
    reach(j, k, lap, bend);
    const bent = j.elbows[k].rotation.x;
    easy.setFromEuler(new T.Euler(0, 0, (k ? 1 : -1) * 0.12));
    j.arms[k].quaternion.slerp(easy, e);
    j.elbows[k].rotation.set(mix(bent, -0.12, e), 0, 0);
  }
  return lift;
}

/* ------------------------------------------------------------------ */
/* China: a cup and its saucer                                          */
/* ------------------------------------------------------------------ */
/** The cup's axis stands this far from its handle (the cup's origin), along its +x. */
export const CUP_AXIS = 0.058;
/** A cup's colours: the china, the band at its rim and what is in it. */
export type ChinaLook = { china: string; band: string; drink: string };
/** How far a cup's foot stands under its handle (the cup's origin). */
export const CUP_FOOT = 0.037;
/** How far a saucer's well (where a cup's foot rests) stands over the saucer's foot. */
export const SAUCER_WELL = 0.036;
/**
 * A cup, its handle (a lug 0.074 across) at the origin on its -x side, its axis CUP_AXIS along +x:
 * a turned bowl 0.104 across with the drink inside and a band at its rim, its foot CUP_FOOT under
 * the origin. Two pieces, for one 'paint' mesh.
 */
export function cupPieces(look: ChinaLook) {
  const ring = (p: T.Vector3) => Math.hypot(p.x - CUP_AXIS, p.z);
  return [
    paint(lathe([[0, -CUP_FOOT], [0.034, -CUP_FOOT], [0.049, 0.014], [0.052, 0.037], [0.046, 0.039], [0.041, 0.024], [0, 0.024]], 9).translate(CUP_AXIS, 0, 0), (p) =>
      p.y < 0.0245 && p.y > 0.02 && ring(p) < 0.0415 ? look.drink : p.y > 0.024 && ring(p) > 0.0485 ? look.band : look.china,
    ),
    paint(blob([0.037, 0.037, 0.037], [0, 0, 0], 8), look.china),
  ];
}
/** A saucer, its foot at the origin: a dish 0.15 across, 0.07 from foot to rim, with a well for the cup (SAUCER_WELL up) and a band at its rim. */
export function saucerPieces(look: Omit<ChinaLook, 'drink'>) {
  return [
    paint(lathe([[0, 0], [0.04, 0], [0.06, 0.03], [0.075, 0.064], [0.071, 0.07], [0.056, 0.044], [0.044, SAUCER_WELL], [0, SAUCER_WELL]], 9), (p) =>
      p.y > 0.055 && Math.hypot(p.x, p.z) > 0.066 ? look.band : look.china,
    ),
  ];
}
const tmp = new T.Vector3();
/**
 * A cup resting in its saucer's well (its handle back and to the figure's -x, as its -x hand holds
 * it): the saucer's foot at `at`, both turned `ry` about the upright.
 */
export function cupOnSaucer(props: { cup: T.Object3D; saucer: T.Object3D }, at: V3, ry: number) {
  const { cup, saucer } = props;
  saucer.visible = cup.visible = true;
  saucer.position.set(...at);
  saucer.rotation.set(0, ry, 0);
  cup.rotation.set(0, ry - 0.5, 0, 'YXZ');
  const lug = tmp.set(-CUP_AXIS, 0, 0).applyQuaternion(cup.quaternion);
  // Its handle over the saucer's well by the cup's foot (added in this order: Alison's frames are pinned).
  cup.position.set(at[0] + lug.x, at[1] + SAUCER_WELL + CUP_FOOT + lug.y, at[2] + lug.z);
}

/* ------------------------------------------------------------------ */
/* The clock: a figure's day in town time, held while the town is held */
/* ------------------------------------------------------------------ */
/**
 * Something of a figure that goes on in real time while it is held (Alison's water: once it stops
 * it goes on falling into the bed). `from` takes it from a moment of the day; `step` runs it on over
 * a frame `dt` long (the hold's own `settle` seconds); `moved` says whether a step moved it where it
 * can be seen; `apply` writes it into the moment posed; `home` says whether the day has it again.
 */
export type FigureFlow<D, S> = {
  from: (live: D) => S;
  step: (from: S, day: D, dt: number, settle: number) => S;
  moved: (from: S, to: S) => boolean;
  apply: (day: D, s: S) => void;
  home: (s: S, live: D) => boolean;
};
/**
 * How a figure goes about its day: `day(time)`, the moment of its day at a time (pure); `still(time)`,
 * the still pose it settles into if held then; `blend(a, b, e)`, part of the way from one to the
 * other; `settle(live, cut)`, how many seconds the settle takes from `live` (`cut`: under reduced
 * motion, nearly at once); `pose(day)`, posing it so; and, if it has one, a `flow` (FigureFlow).
 */
export type FigureClock<D, S> = {
  day: (time: number) => D;
  still: (time: number) => D;
  blend: (a: D, b: D, e: number) => D;
  settle: (live: D, cut: boolean) => number;
  pose: (day: D) => void;
  flow?: FigureFlow<D, S>;
};
/**
 * A figure's update for the town's animated list. It keeps a clock of its own, town time less however
 * long the figure has been held (or was coming back from it) while the town ran on, so nothing of its
 * day runs on under it while it is held. When the town is held (the frame's `held`: Pause) it settles
 * where it is into the still pose its day gives, over `settle` seconds of the frame's own time (its
 * `cut`, reduced motion, nearly at once); let go, it comes back the same way into its day as it was
 * when it was held, and only then does its day go on. Held, every frame in which it moves (settling,
 * or its flow going on) raises the frame's `moved`, so the paused loop draws its shadow again that
 * frame. Asked without a frame (the build's own first pose, a check sampling its day), or at a jump
 * of the town's clock of more than a second (the debug clock), it is simply its day at that time.
 */
export function figureClock<D, S = never>(o: FigureClock<D, S>) {
  // The clock's lag behind town time; how far it has settled (0 to 1); and the flow while it goes by
  // itself, until the day's own catches up with it.
  let lag = 0,
    last = 0,
    settled = 0,
    flow: S | null = null;
  return (time: number, _night?: number, _rain?: number, frame?: AnimationFrame) => {
    const step = time - last,
      dt = frame?.dt ?? 0;
    last = time;
    if (!frame || Math.abs(step) > 1) {
      lag = settled = 0;
      flow = null;
      if (!frame) return o.pose(o.day(time));
    } else if (frame.held || settled > 0) lag += step;
    const clock = time - lag,
      live = o.day(clock),
      settle = o.settle(live, frame.cut),
      was = settled;
    settled = frame.held ? Math.min(1, settled + dt / settle) : Math.max(0, settled - dt / settle);
    if (!settled && !flow) return o.pose(live);
    const day = o.blend(live, o.still(clock), T.MathUtils.smoothstep(settled, 0, 1));
    let moving = false;
    if (o.flow) {
      const from = flow ?? o.flow.from(live);
      flow = o.flow.step(from, day, dt, settle);
      moving = o.flow.moved(from, flow);
      o.flow.apply(day, flow);
      // Let go, and the day's flow where this is: the day's again.
      if (!settled && o.flow.home(flow, live)) flow = null;
    }
    // Held, and moving in real time: the loop draws the figure's shadow again this frame.
    if (frame.held && (settled !== was || moving)) frame.moved = true;
    o.pose(day);
  };
}
