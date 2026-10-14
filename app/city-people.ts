import * as T from 'three';
import type { SurfaceKind } from './city-materials';
type Material = (c: string, k?: SurfaceKind) => T.MeshStandardMaterial;
/** A resident's colours; the hair cap can be worn as a hat (a flat cap, a helmet). */
export type ResidentLook = { coat: string; legs: string; skin: string; hair: string; scarf: string };
/**
 * A 0.9-tall Clash-style villager: a fat coat, a big head (a third of the height) under a
 * hair cap, a collar scarf, and chunky limbs. Soles rest at y 0, so the root sits on the pavement.
 * `look` overrides the colours `index` picks (odd indices carry a satchel).
 */
export function createResident(index: number, material: Material, look: Partial<ResidentLook> = {}) {
  const root = new T.Group(),
    body = new T.Group();
  body.name = 'body';
  root.add(body);
  const coat = look.coat ?? ['#c9412f', '#2d5f8f', '#e8b84a', '#2e6e4c', '#8e6ad0'][index % 5],
    legs = look.legs ?? ['#3a4654', '#4b545b', '#5c3c22'][index % 3],
    skin = look.skin ?? ['#f0c8a0', '#d9a477', '#b07a52'][index % 3],
    hair = look.hair ?? ['#5c3c22', '#2d2a28', '#e8b84a', '#a4452e'][index % 4],
    scarf = look.scarf ?? ['#f5efe0', '#e8b84a', '#f18fb0', '#62c0d4'][index % 4];
  function shape(
    g: T.Group,
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
    c: string,
    k: SurfaceKind = 'fabric',
    seg = 12,
  ) {
    const m = new T.Mesh(new T.SphereGeometry(1, seg, Math.round(seg * 0.7)), material(c, k));
    m.position.set(x, y, z);
    m.scale.set(rx, ry, rz);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }
  // Limbs are small enough that 10-segment spheres look the same as 12. Shoes and hands are matte
  // like the limb they end, so each moving limb batches into one mesh (in paint they were a second
  // draw call on every knee and arm of every figure, too small to show the difference).
  const limb = 10;
  shape(body, 0, 0.47, 0, 0.15, 0.2, 0.12, coat, 'fabric', 16); // coat 0.27..0.67
  shape(body, 0, 0.635, 0, 0.125, 0.04, 0.105, scarf); // collar
  shape(body, 0, 0.75, 0.005, 0.15, 0.15, 0.14, skin, 'paint', 16); // head 0.60..0.90 = 33%
  shape(body, 0, 0.815, -0.02, 0.158, 0.095, 0.15, hair, 'fabric', 16); // hair cap, face shows below 0.8
  if (index % 2) shape(body, 0.15, 0.42, -0.03, 0.05, 0.08, 0.07, '#a06b3e', 'wood');
  for (const side of [-1, 1]) {
    const hip = new T.Group();
    hip.name = side < 0 ? 'leg-left' : 'leg-right';
    hip.position.set(side * 0.065, 0.31, 0);
    root.add(hip);
    shape(hip, 0, -0.07, 0, 0.06, 0.085, 0.065, legs, 'fabric', limb);
    const knee = new T.Group();
    knee.name = 'knee';
    knee.position.y = -0.14;
    hip.add(knee);
    shape(knee, 0, -0.07, 0, 0.055, 0.08, 0.06, legs, 'fabric', limb);
    shape(knee, 0, -0.135, 0.025, 0.06, 0.035, 0.085, '#2d2a28', 'fabric', limb).name = 'shoe';
    const arm = new T.Group();
    arm.name = side < 0 ? 'arm-left' : 'arm-right';
    arm.position.set(side * 0.165, 0.6, 0);
    arm.rotation.z = side * 0.12;
    root.add(arm);
    shape(arm, 0, -0.1, 0, 0.05, 0.11, 0.055, coat, 'fabric', limb);
    shape(arm, 0, -0.21, 0.005, 0.045, 0.045, 0.045, skin, 'fabric', limb);
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
    // Lowest point of the shoe (rest = 0.000).
    soles.push(
      0.31 -
        0.14 * Math.cos(a) -
        0.135 * Math.cos(b) -
        0.025 * Math.sin(b) -
        Math.hypot(0.035 * Math.cos(b), 0.085 * Math.sin(b)),
    );
    root.getObjectByName('arm-' + label)!.rotation.x =
      -swing * 0.36 * gait.amount;
  }
  root.userData.sole = Math.min(...soles);
}
/** The dog's coat and its white points (the snout, and the tail's tip, a little muted). */
const DOG = { coat: '#3b3633', white: '#ece3cf', tip: '#cdbfa6' };
/**
 * A small Border collie, about 0.36 long and 0.24 tall (local +z is the nose, the origin between
 * the feet): a dark body on four short legs, a head with a white snout on its own pivot
 * ('dog-head', to sniff) and a tail with a pale tip on another ('dog-tail', to wag). Every part
 * is fabric. The body is just long enough (0.31) to cast a shadow; nothing else does.
 */
export function createDog(material: Material) {
  const dog = new T.Group();
  dog.name = 'dog';
  const part = (g: T.Object3D, geometry: T.BufferGeometry, colour: string, x: number, y: number, z: number) => {
    const m = new T.Mesh(geometry, material(colour, 'fabric'));
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  part(dog, new T.IcosahedronGeometry(0.1, 1).scale(0.8, 0.75, 1.55), DOG.coat, 0, 0.15, -0.02);
  for (const x of [-0.045, 0.045]) for (const z of [-0.09, 0.09]) part(dog, new T.BoxGeometry(0.07, 0.09, 0.07), DOG.coat, x, 0.045, z);
  const head = new T.Group();
  head.name = 'dog-head';
  head.position.set(0, 0.2, 0.12);
  head.userData.keepSeparate = true;
  dog.add(head);
  part(head, new T.IcosahedronGeometry(0.075, 1), DOG.coat, 0, 0.04, 0.05);
  part(head, new T.BoxGeometry(0.07, 0.06, 0.08), DOG.white, 0, 0.01, 0.12);
  const tail = new T.Group();
  tail.name = 'dog-tail';
  tail.position.set(0, 0.2, -0.16);
  tail.userData.keepSeparate = true;
  dog.add(tail);
  // The pale tip is painted on (vertex colours, which batching multiplies in): a muted cream over
  // the brush's top quarter, blending into the coat below it, so it reads as a tip, not a spike.
  const cone = new T.ConeGeometry(0.045, 0.13, 6, 5),
    p = cone.getAttribute('position'),
    tones = new Float32Array(p.count * 3),
    tip = new T.Color(DOG.tip),
    coat = new T.Color(DOG.coat);
  for (let i = 0; i < p.count; i++) (p.getY(i) > 0.03 ? tip : coat).toArray(tones, i * 3);
  cone.setAttribute('color', new T.BufferAttribute(tones, 3));
  const brush = part(tail, cone, '#ffffff', 0, 0.0295, -0.0579);
  brush.rotation.x = -1.1; // its base on the pivot, its tip back and up
  return dog;
}
