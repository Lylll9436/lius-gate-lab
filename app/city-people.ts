import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SurfaceKind } from './city-materials';
type Material = (c: string, k?: SurfaceKind) => T.MeshStandardMaterial;
type V3 = [number, number, number];
/** The hair (or the hat worn over it): a short crop, a side parting, a bob, a bun, a flat cap, a beanie or a cycle helmet. */
export type HairStyle = 'crop' | 'parted' | 'bob' | 'bun' | 'cap' | 'beanie' | 'helmet';
/**
 * A resident's colours and cut: `hair` is also the colour of a cap, beanie or helmet; `scarf` the
 * collar's; `skirt` swaps trousers for a skirt over dark tights.
 */
export type ResidentLook = { coat: string; legs: string; skin: string; hair: string; scarf: string; shoes: string; style: HairStyle; skirt: boolean };

/*
 * Every part is built from a few smooth solids (lathes, ellipsoids, tori, tubes) merged into one
 * geometry per surface kind with its colours on the vertices, so a figure batches into one mesh
 * per moving part: the body in fabric (coat, collar, hair, bag) and skin (head and face), and each
 * thigh, shin and arm in fabric (trousers and shoe, sleeve and mitten).
 */
const tone = new T.Color();
/**
 * A geometry's colour on its vertices: one colour, or one picked per vertex from its position;
 * `grade` [y0, y1, k0, k1] shades it from k0 at y0 to k1 at y1, so cloth darkens towards its hem.
 */
function paint(geometry: T.BufferGeometry, colour: string | ((p: T.Vector3) => string), grade?: [number, number, number, number]) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  const p = g.getAttribute('position'),
    out = new Float32Array(p.count * 3),
    v = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    tone.set(typeof colour === 'string' ? colour : colour(v));
    if (grade) tone.multiplyScalar(T.MathUtils.lerp(grade[2], grade[3], T.MathUtils.smoothstep(v.y, grade[0], grade[1])));
    tone.toArray(out, i * 3);
  }
  g.setAttribute('color', new T.BufferAttribute(out, 3));
  return g;
}
/** An ellipsoid of radii r at c, turned by rot (XYZ), with seg segments round. */
function blob(r: V3, c: V3, seg = 12, rot?: V3) {
  const g = new T.SphereGeometry(1, seg, Math.max(5, Math.round(seg * 0.65)));
  g.scale(r[0], r[1], r[2]);
  if (rot) g.applyMatrix4(new T.Matrix4().makeRotationFromEuler(new T.Euler(...rot)));
  return g.translate(c[0], c[1], c[2]);
}
/** A cushion: a unit sphere pushed out towards its box (a rounded square face), then sized like blob(). */
function cushion(r: V3, c: V3, rot?: V3) {
  const g = new T.SphereGeometry(1, 10, 8),
    p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const v = [p.getX(i), p.getY(i), p.getZ(i)].map((u) => Math.sign(u) * Math.abs(u) ** 0.55);
    p.setXYZ(i, v[0], v[1], v[2]);
  }
  g.computeVertexNormals();
  g.scale(r[0], r[1], r[2]);
  if (rot) g.applyMatrix4(new T.Matrix4().makeRotationFromEuler(new T.Euler(...rot)));
  return g.translate(c[0], c[1], c[2]);
}
/** A solid of revolution about y through (radius, height) points, given top to bottom or bottom to top. */
function lathe(profile: number[][], seg = 14) {
  // Three's lathe faces outwards when its profile runs upwards.
  const up = profile[0][1] <= profile[profile.length - 1][1] ? profile : [...profile].reverse();
  return new T.LatheGeometry(up.map(([r, y]) => new T.Vector2(r, y)), seg);
}
/** A smooth tube through points, its radius running through r (one per point), closed with round caps. */
function taper(points: V3[], r: number[], seg = 10, radial = 6) {
  const curve = new T.CatmullRomCurve3(points.map((p) => new T.Vector3(...p)), false, 'centripetal'),
    frames = curve.computeFrenetFrames(seg, false),
    pos: number[] = [],
    nor: number[] = [],
    idx: number[] = [],
    radius = (t: number) => {
      const f = t * (r.length - 1),
        i = Math.min(r.length - 2, Math.floor(f));
      return r[i] + (r[i + 1] - r[i]) * (f - i);
    };
  for (let i = 0; i <= seg; i++) {
    const t = i / seg,
      c = curve.getPointAt(t),
      n = frames.normals[i],
      b = frames.binormals[i],
      rr = radius(t);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2,
        dx = Math.cos(a) * n.x + Math.sin(a) * b.x,
        dy = Math.cos(a) * n.y + Math.sin(a) * b.y,
        dz = Math.cos(a) * n.z + Math.sin(a) * b.z;
      pos.push(c.x + dx * rr, c.y + dy * rr, c.z + dz * rr);
      nor.push(dx, dy, dz);
    }
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j,
        b = i * radial + ((j + 1) % radial),
        c = a + radial,
        d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
  // Round caps: a point just past each end, fanned to its ring.
  for (const [end, ring, sign] of [[0, 0, -1], [1, seg * radial, 1]] as const) {
    const tip = curve.getPointAt(end),
      dir = curve.getTangentAt(end).multiplyScalar(sign),
      k = pos.length / 3;
    pos.push(tip.x + dir.x * r[end ? r.length - 1 : 0] * 0.7, tip.y + dir.y * r[end ? r.length - 1 : 0] * 0.7, tip.z + dir.z * r[end ? r.length - 1 : 0] * 0.7);
    nor.push(dir.x, dir.y, dir.z);
    for (let j = 0; j < radial; j++) {
      const a = ring + j,
        b = ring + ((j + 1) % radial);
      if (sign < 0) idx.push(k, a, b);
      else idx.push(k, b, a);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}
/** One mesh of painted parts in a kind; its material's own colour is white, the vertices carry the rest. */
function part(g: T.Object3D, pieces: T.BufferGeometry[], material: Material, kind: SurfaceKind, name?: string) {
  const m = new T.Mesh(mergeGeometries(pieces)!, material('#ffffff', kind));
  m.castShadow = m.receiveShadow = true;
  if (name) m.name = name;
  g.add(m);
  return m;
}

/** Muted, generic clothes: nobody reads as a particular member of the group. */
const COATS = ['#5f7186', '#7d8a5c', '#a8735a', '#c2a878', '#6d6378', '#4f6b66', '#9b8a6e'],
  LEGS = ['#3a4654', '#4b545b', '#5c4a3a', '#6b6f63'],
  SKIN = ['#f0c8a0', '#d9a477', '#b07a52'],
  HAIR = ['#5a4030', '#2d2a28', '#b89b6a', '#7e5040', '#9a948c'],
  SCARF = ['#e9e1d0', '#c9ad78', '#b98a8f', '#8fa9ad'],
  SHOES = ['#2d2a28', '#4a3426', '#3a3f45'],
  STYLES: HairStyle[] = ['crop', 'bob', 'beanie', 'parted', 'bun', 'cap', 'crop'],
  EYES = '#2b2622';
/** A shade of a colour: darker below 1, lighter above. */
const shade = (c: string, k: number) => '#' + new T.Color(c).multiplyScalar(k).getHexString();

/** The head's centre and radii (0.6 to 0.9: a third of the figure). */
const HEAD = { y: 0.75, r: [0.15, 0.148, 0.142] as V3 };
/** A point on the head's surface at (x, y), pushed out by `out`, for the face's features. */
function onHead(x: number, y: number, out = 0): V3 {
  const [a, b, c] = HEAD.r,
    u = 1 - (x / a) ** 2 - ((y - HEAD.y) / b) ** 2;
  return [x, y, 0.005 + c * Math.sqrt(Math.max(0, u)) + out];
}
/** The torso's profile (radius, height), hem to neck; it is 0.86 as deep as it is wide. */
const TORSO = [[0, 0.268], [0.13, 0.268], [0.152, 0.285], [0.16, 0.33], [0.163, 0.4], [0.158, 0.47], [0.146, 0.53], [0.127, 0.585], [0.098, 0.618], [0.06, 0.638], [0, 0.642]],
  DEPTH = 0.86;
/** The torso's radius at height y. */
function torsoAt(y: number) {
  for (let i = 1; i < TORSO.length; i++) {
    const [r0, y0] = TORSO[i - 1],
      [r1, y1] = TORSO[i];
    if (y >= y0 && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return 0;
}
/** A point on the torso's surface at height y and angle a (0 straight ahead, +x at pi/2), pushed out by `out`. */
function onTorso(y: number, a: number, out = 0): V3 {
  const r = torsoAt(y) + out;
  return [r * Math.sin(a), y, r * Math.cos(a) * DEPTH];
}

/** The hair, or the hat over it, as fabric pieces in the hair colour. */
function hair(style: HairStyle, colour: string) {
  const [a, b, c] = HEAD.r,
    y = HEAD.y,
    dark = shade(colour, 0.85),
    out: T.BufferGeometry[] = [];
  /**
   * A cap over the head `grow` proud of it, reaching theta from its crown, its crown tipped back by
   * `tilt` (so it comes down to the brows in front and the nape behind); `phi` leaves a gap.
   */
  const shell = (grow: number, theta: number, tilt: number, seg = 16, phi: [number, number] = [0, Math.PI * 2]) =>
    new T.SphereGeometry(1, seg, Math.round(seg * 0.6), phi[0], phi[1], 0, theta)
      .rotateX(-tilt)
      .scale(a + grow, b + grow, c + grow)
      .translate(0, y, 0.005);
  if (style === 'crop' || style === 'parted' || style === 'bun' || style === 'cap') {
    // A close crop: the hairline across the top of the forehead, over the ears, down to the nape.
    out.push(paint(shell(0.009, 1.63, 0.59), style === 'cap' ? shade(colour, 0.7) : colour));
    if (style === 'parted') out.push(paint(blob([0.075, 0.03, 0.09], [0.05, y + 0.114, 0.045], 10, [0.25, 0, -0.32]), colour)); // the swept side
    if (style === 'bun') out.push(paint(blob([0.058, 0.055, 0.055], [0, y + 0.095, -0.105], 10), colour), paint(new T.TorusGeometry(0.045, 0.012, 5, 12).rotateX(-0.9).translate(0, y + 0.072, -0.082), dark));
    if (style === 'cap') {
      // A flat cap: a soft, flat crown pulled forward over the brow and a short peak.
      out.push(paint(blob([a + 0.02, 0.046, c + 0.036], [0, y + 0.098, 0.02], 16, [0.2, 0, 0]), colour));
      out.push(paint(blob([0.115, 0.013, 0.07], [0, y + 0.068, 0.175], 12, [0.3, 0, 0]), shade(colour, 0.68)));
    }
  } else if (style === 'bob') {
    // Hair to the jaw all round, open at the face, with a fringe to the brows.
    out.push(paint(shell(0.011, 2.2, 0.1, 18, [Math.PI * 0.72, Math.PI * 1.56]), colour), paint(shell(0.009, 1.25, 0.32), colour));
  } else if (style === 'beanie') {
    // A knitted beanie down to the brows, with a turned-up cuff round its rim.
    const grow = 0.011,
      rim = (a + grow) * Math.sin(1.62);
    out.push(paint(shell(grow, 1.62, 0.37), colour));
    out.push(paint(new T.TorusGeometry(rim, 0.02, 6, 18).scale(1, 1, (c + grow) / (a + grow)).rotateX(Math.PI / 2 - 0.37).translate(0, y + Math.cos(1.62) * (b + grow), 0.005), dark));
  } else {
    // A cycle helmet: a rounded shell over the hair with three shallow ridges and a short peak.
    const grow = 0.022;
    out.push(paint(shell(grow, 1.42, 0.52, 18), colour));
    // The ridges run over the shell from its brow to its back, half sunk in it.
    for (const x of [-0.055, 0, 0.055]) {
      const q = Math.sqrt(1 - (x / (a + grow)) ** 2),
        ridge: V3[] = [];
      for (let t = -1.5; t <= 0.76; t += 0.375) ridge.push([x, y + (b + grow) * Math.cos(t) * q, 0.005 + (c + grow) * Math.sin(t) * q]);
      out.push(paint(taper(ridge, [0.008, 0.012, 0.012, 0.008], 10, 5), shade(colour, 1.08)));
    }
    out.push(paint(blob([0.1, 0.012, 0.05], [0, y + 0.098, 0.135], 10, [0.25, 0, 0]), dark));
  }
  return out;
}

/**
 * A 0.9-tall Clash-style villager: a big round head (a third of the height) with two small dark
 * eyes, a nose and ears, under one of several hair styles or a hat; a rounded jacket or jumper
 * with a collar and a hem; mitten hands; trousers (or a skirt over tights) and chunky shoes. Soles
 * rest at y 0, so the root sits on the pavement. `look` overrides what `index` picks (odd indices
 * carry a satchel). The pivots are the animation's: 'body' (the rider leans it), 'leg-left' and
 * 'leg-right' at the hips with a 'knee' each, and 'arm-left' and 'arm-right' at the shoulders.
 */
export function createResident(index: number, material: Material, look: Partial<ResidentLook> = {}) {
  const root = new T.Group(),
    body = new T.Group();
  body.name = 'body';
  root.add(body);
  const style = look.style ?? STYLES[index % STYLES.length],
    skirt = look.skirt ?? (index === 1 || index === 4),
    coat = look.coat ?? COATS[index % COATS.length],
    legs = look.legs ?? LEGS[index % LEGS.length],
    skin = look.skin ?? SKIN[index % SKIN.length],
    hairColour = look.hair ?? HAIR[index % HAIR.length],
    scarf = look.scarf ?? SCARF[index % SCARF.length],
    shoes = look.shoes ?? SHOES[index % SHOES.length],
    jumper = index % 3 === 1,
    tights = shade(legs, 0.7),
    mitts = style === 'beanie' ? shade(scarf, 0.8) : skin;
  // The body: a jacket (a zip down its front and a darker hem) or a jumper (a ribbed hem a shade
  // lighter), a rolled collar, the hair, and for odd indices a satchel on a strap across the chest.
  const cloth: T.BufferGeometry[] = [
    paint(lathe(TORSO, 16).scale(1, 1, DEPTH), coat, [0.27, 0.6, 0.86, 1.04]),
    paint(new T.TorusGeometry(0.152, 0.02, 5, 16).rotateX(Math.PI / 2).scale(1, 1, DEPTH).translate(0, 0.29, 0), shade(coat, jumper ? 1.12 : 0.82)),
    paint(new T.TorusGeometry(0.074, 0.03, 6, 14).rotateX(Math.PI / 2).translate(0, 0.628, 0.004), scarf),
    ...hair(style, hairColour),
  ];
  if (jumper) cloth.push(paint(new T.TorusGeometry(0.163, 0.013, 4, 16).rotateX(Math.PI / 2).scale(1, 1, DEPTH).translate(0, 0.44, 0), scarf)); // a stripe round the chest
  else {
    // A jacket: the zip down its front and two patch pockets low on it.
    cloth.push(paint(taper([onTorso(0.3, 0, 0.004), onTorso(0.44, 0, 0.004), onTorso(0.6, 0, 0.004)], [0.007, 0.007, 0.007], 8, 4), shade(coat, 0.7)));
    for (const s of [-1, 1]) cloth.push(paint(cushion([0.038, 0.032, 0.01], onTorso(0.355, s * 0.5, -0.003), [0, s * 0.5, 0]), shade(coat, 0.86)));
  }
  if (skirt) cloth.push(paint(lathe([[0, 0.34], [0.158, 0.34], [0.172, 0.29], [0.192, 0.2], [0.196, 0.185], [0.185, 0.175], [0, 0.175]], 16).scale(1, 1, 0.9), legs));
  if (index % 2) {
    const strap: V3[] = [];
    for (let i = 0; i <= 6; i++) strap.push(onTorso(0.4 + i * 0.036, 1.45 - i * 0.42, 0.006));
    cloth.push(paint(taper(strap, [0.011, 0.011], 12, 4), '#6b4a33'));
    cloth.push(paint(blob([0.04, 0.068, 0.078], [0.168, 0.38, -0.01], 10), '#7a5a3e'), paint(blob([0.043, 0.03, 0.08], [0.168, 0.42, -0.01], 10), '#6b4a33'));
  }
  part(body, cloth, material, 'fabric');
  // The head, the neck under the collar, the ears, a small nose and two dark eyes, in one skin mesh.
  const face: T.BufferGeometry[] = [
    paint(blob(HEAD.r, [0, HEAD.y, 0.005], 16), skin),
    paint(lathe([[0, 0.585], [0.05, 0.585], [0.05, 0.66], [0, 0.66]], 10), skin),
    paint(blob([0.022, 0.02, 0.02], onHead(0, 0.732, -0.006), 8), shade(skin, 0.97)),
  ];
  for (const s of [-1, 1]) {
    face.push(paint(blob([0.018, 0.03, 0.024], [s * 0.147, 0.745, 0.0], 8), shade(skin, 0.95)));
    const at = onHead(s * 0.052, 0.772, -0.004);
    face.push(paint(blob([0.013, 0.02, 0.008], at, 8, [0, s * 0.36, 0]), EYES));
  }
  part(body, face, material, 'paint');
  for (const side of [-1, 1]) {
    const hip = new T.Group();
    hip.name = side < 0 ? 'leg-left' : 'leg-right';
    hip.position.set(side * 0.065, 0.31, 0);
    root.add(hip);
    // The thigh, and the shin with its turned-up hem over a chunky shoe (its sole a shade apart).
    part(hip, [paint(lathe([[0, 0.03], [0.05, 0.025], [0.063, 0.0], [0.06, -0.07], [0.055, -0.14], [0.03, -0.165], [0, -0.17]], 12), skirt ? tights : legs, [-0.17, 0.02, 0.92, 1.02])], material, 'fabric');
    const knee = new T.Group();
    knee.name = 'knee';
    knee.position.y = -0.14;
    hip.add(knee);
    const shoe = blob([0.058, 0.044, 0.09], [0, 0, 0], 12);
    const sp = shoe.getAttribute('position');
    for (let i = 0; i < sp.count; i++) if (sp.getY(i) < 0) sp.setY(i, sp.getY(i) * 0.8); // a flatter sole
    shoe.computeVertexNormals();
    shoe.translate(0, -0.135, 0.025);
    const shin = skirt
      ? lathe([[0, 0.02], [0.05, 0.01], [0.048, -0.06], [0.044, -0.1], [0, -0.11]], 12)
      : lathe([[0, 0.02], [0.055, 0.01], [0.051, -0.07], [0.054, -0.088], [0.056, -0.1], [0.04, -0.106], [0, -0.108]], 12);
    part(knee, [paint(shin, skirt ? tights : legs, [-0.1, 0.02, 0.84, 0.94]), paint(shoe, (p) => (p.y < -0.157 ? shade(shoes, 1.35) : shoes))], material, 'fabric', 'shoe');
    const arm = new T.Group();
    arm.name = side < 0 ? 'arm-left' : 'arm-right';
    arm.position.set(side * 0.165, 0.6, 0);
    arm.rotation.z = side * 0.12;
    root.add(arm);
    // A sleeve with a cuff, and a mitten hand with its thumb forward and in.
    part(arm, [
      paint(lathe([[0, 0.045], [0.04, 0.035], [0.055, 0.0], [0.05, -0.1], [0.045, -0.165], [0, -0.175]], 12), coat, [-0.17, 0.03, 0.88, 1.04]),
      paint(new T.TorusGeometry(0.044, 0.01, 4, 12).rotateX(Math.PI / 2).translate(0, -0.168, 0), shade(coat, jumper ? 1.12 : 0.82)),
      paint(blob([0.043, 0.05, 0.046], [0, -0.215, 0.004], 10), mitts),
      paint(blob([0.016, 0.024, 0.017], [-side * 0.03, -0.2, 0.028], 6, [0.4, 0, 0]), mitts),
    ], material, 'fabric');
  }
  root.userData.gait = { phase: index * 1.7, amount: 0 };
  root.userData.sole = 0;
  return root;
}
/** A rider's legs: the hip and knee groups pedalRider turns. */
export type RiderJoints = { hips: T.Object3D[]; knees: T.Object3D[] };
/**
 * Seat a resident on a bicycle's saddle (its root placed 0.05 up and 0.1 back on the bike, so the
 * hips sit on the saddle at bike-local y 0.36): the body leans 0.35 forward about the hip line
 * and both hands reach the handlebar. Returns the leg joints, found once, for pedalRider.
 */
export function seatRider(root: T.Object3D): RiderJoints {
  const body = root.getObjectByName('body')!;
  body.rotation.x = 0.35;
  body.position.set(0, 0.019, -0.106); // keeps the hip line (y 0.31) where it was
  for (const [side, name] of [[-1, 'arm-left'], [1, 'arm-right']] as const) {
    const arm = root.getObjectByName(name)!;
    arm.position.set(side * 0.165, 0.582, 0.1);
    arm.rotation.set(-1.2, 0, side * 0.05);
  }
  const hips = ['leg-left', 'leg-right'].map((name) => root.getObjectByName(name)!);
  return { hips, knees: hips.map((hip) => hip.getObjectByName('knee')!) };
}
// The leg's two bones: hip to knee, and knee to the shoe's centre (which sits 0.025 forward of
// the shin's axis, hence the tilt the knee adds back).
const THIGH = 0.14,
  SHIN = Math.hypot(0.135, 0.025),
  SHOE_TILT = Math.atan2(0.025, 0.135);
/**
 * Pedal: put each shoe's centre on the crank's circle (bike-local centre y 0.185, radius 0.065,
 * the shoe's half-height above a 0.065 crank on the bottom bracket), the two feet half a turn
 * apart, by a two-bone solve from the hip with the knee bending forward.
 */
export function pedalRider(joints: RiderJoints, crank: number) {
  for (let k = 0; k < 2; k++) {
    const c = crank + k * Math.PI,
      dz = 0.1 + 0.065 * Math.sin(c),
      dy = -0.175 - 0.065 * Math.cos(c),
      d = Math.min(Math.hypot(dz, dy), 0.27);
    joints.hips[k].rotation.x = -(Math.atan2(dz, -dy) + Math.acos((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d)));
    joints.knees[k].rotation.x = Math.PI - Math.acos((THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN)) + SHOE_TILT;
  }
}
export function animateResident(
  root: T.Group,
  distance: number,
  dt: number,
  paused: boolean,
) {
  if (paused) return;
  const gait = root.userData.gait;
  gait.phase += distance * 17;
  const target = distance > 1e-5 ? 1 : 0;
  gait.amount += (target - gait.amount) * (1 - Math.exp(-dt * 12));
  const soles: number[] = [];
  for (const [side, label] of [
    [-1, 'left'],
    [1, 'right'],
  ] as const) {
    const swing = Math.sin(gait.phase + (side < 0 ? 0 : Math.PI));
    const leg = root.getObjectByName('leg-' + label)!;
    leg.rotation.x = swing * 0.42 * gait.amount;
    leg.getObjectByName('knee')!.rotation.x =
      Math.max(0, -swing) * 0.48 * gait.amount;
    const a = leg.rotation.x,
      b = a + leg.getObjectByName('knee')!.rotation.x;
    // Lowest point of the shoe (rest = 0.000): its sole is 0.035 below its centre, its toe and heel 0.09 from it.
    soles.push(
      0.31 -
        0.14 * Math.cos(a) -
        0.135 * Math.cos(b) -
        0.025 * Math.sin(b) -
        Math.hypot(0.035 * Math.cos(b), 0.09 * Math.sin(b)),
    );
    root.getObjectByName('arm-' + label)!.rotation.x =
      -swing * 0.36 * gait.amount;
  }
  root.userData.sole = Math.min(...soles);
}
/** The dog's coat and its white points (the blaze and snout, the chest, the paws and the tail's tip). */
const DOG = { coat: '#3b3633', white: '#ece3cf', tip: '#cdbfa6', nose: '#1f1c1a' };
/**
 * A small Border collie, about 0.36 long and 0.24 tall (local +z is the nose, the origin between
 * the feet): a deep-chested dark body with a white chest and ruff on four slim legs with white
 * paws, the hind ones bent at the hock; a head with a white snout, a dark nose, two eyes and
 * half-pricked ears on its own pivot ('dog-head', to sniff); and a low brush of a tail that
 * curves up at its pale tip on another ('dog-tail', to wag). Every part is fabric, its colours on
 * the vertices. The body is just long enough (0.31) to cast a shadow; nothing else does.
 */
export function createDog(material: Material) {
  const dog = new T.Group();
  dog.name = 'dog';
  const white = (test: (p: T.Vector3) => boolean) => (p: T.Vector3) => (test(p) ? DOG.white : DOG.coat);
  // The body: barrel, deep chest and a full ruff at the neck, white under the chest and on the ruff's front.
  part(dog, [
    paint(blob([0.07, 0.066, 0.155], [0, 0.155, -0.03], 14), white((p) => p.z > 0.06 && p.y < 0.14), [0.09, 0.22, 0.85, 1.04]),
    paint(blob([0.07, 0.076, 0.07], [0, 0.165, 0.075], 12), white((p) => p.z > 0.1 || p.y < 0.12), [0.09, 0.24, 0.88, 1.04]),
    paint(blob([0.066, 0.062, 0.058], [0, 0.208, 0.105], 12, [0.5, 0, 0]), white((p) => p.z > 0.125)),
  ], material, 'fabric');
  // Slim legs on white paws; the hind legs angle back to the hock and down.
  const legs: T.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    legs.push(paint(taper([[s * 0.042, 0.13, 0.085], [s * 0.042, 0.06, 0.09], [s * 0.042, 0.018, 0.09]], [0.024, 0.02, 0.018], 4, 5), white((p) => p.y < 0.04)));
    legs.push(paint(blob([0.02, 0.012, 0.028], [s * 0.042, 0.012, 0.1], 7), DOG.white));
    legs.push(paint(taper([[s * 0.045, 0.14, -0.1], [s * 0.048, 0.085, -0.13], [s * 0.046, 0.05, -0.145], [s * 0.045, 0.018, -0.13]], [0.032, 0.022, 0.017, 0.016], 6, 5), white((p) => p.y < 0.035)));
    legs.push(paint(blob([0.02, 0.012, 0.028], [s * 0.045, 0.012, -0.12], 7), DOG.white));
  }
  part(dog, legs, material, 'fabric');
  const head = new T.Group();
  head.name = 'dog-head';
  head.position.set(0, 0.2, 0.12);
  head.userData.keepSeparate = true;
  dog.add(head);
  // Skull, a long white snout and a blaze up the brow, the nose, eyes and half-pricked ears
  // folded over at their tips.
  const face: T.BufferGeometry[] = [
    paint(blob([0.056, 0.052, 0.06], [0, 0.048, 0.035], 12), white((p) => Math.abs(p.x) < 0.013 && p.z > 0.065)),
    paint(taper([[0, 0.04, 0.065], [0, 0.031, 0.11], [0, 0.025, 0.138]], [0.034, 0.027, 0.022], 6, 8), white((p) => p.z > 0.095 || p.y < 0.022 || Math.abs(p.x) < 0.012)),
    paint(blob([0.013, 0.011, 0.011], [0, 0.032, 0.158], 6), DOG.nose),
  ];
  for (const s of [-1, 1]) {
    face.push(paint(blob([0.008, 0.009, 0.006], [s * 0.025, 0.064, 0.088], 6, [0, s * 0.5, 0]), DOG.nose));
    // The ear: a flap standing from the skull, its upper half tipped forward and out.
    face.push(paint(blob([0.021, 0.026, 0.008], [s * 0.036, 0.09, 0.02], 8, [-0.15, 0, -s * 0.35]), DOG.coat));
    face.push(paint(blob([0.017, 0.02, 0.007], [s * 0.047, 0.108, 0.034], 8, [1.0, 0, -s * 0.5]), shade(DOG.coat, 0.85)));
  }
  part(head, face, material, 'fabric');
  const tail = new T.Group();
  tail.name = 'dog-tail';
  tail.position.set(0, 0.2, -0.16);
  tail.userData.keepSeparate = true;
  dog.add(tail);
  // A low, full brush that hangs back and down and flicks up at its pale tip (painted on, blending in).
  part(tail, [
    paint(taper([[0, 0.0, 0.0], [0, -0.045, -0.04], [0, -0.095, -0.065], [0, -0.125, -0.095], [0, -0.115, -0.13]], [0.022, 0.032, 0.034, 0.026, 0.013], 12, 6), (p) => (p.z < -0.105 ? DOG.tip : DOG.coat)),
  ], material, 'fabric');
  return dog;
}
