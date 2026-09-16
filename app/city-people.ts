import * as T from 'three';
import type { SurfaceKind } from './city-materials';
export function createResident(
  index: number,
  material: (c: string, k?: SurfaceKind) => T.MeshStandardMaterial,
) {
  const root = new T.Group(),
    body = new T.Group();
  body.name = 'body';
  root.add(body);
  const coat = ['#9b6557', '#596f7d', '#ba9e6d', '#718067', '#876d7e'][
    index % 5
  ];
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
  ) {
    const m = new T.Mesh(new T.SphereGeometry(1, 12, 8), material(c, k));
    m.position.set(x, y, z);
    m.scale.set(rx, ry, rz);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }
  shape(body, 0, 0.395, 0, 0.075, 0.13, 0.058, coat);
  shape(body, 0, 0.57, 0.002, 0.052, 0.07, 0.048, '#c6a78c', 'paint');
  shape(
    body,
    0,
    0.618,
    -0.008,
    0.056,
    0.035,
    0.05,
    index % 2 ? '#473e39' : '#75614c',
  );
  shape(body, 0, 0.565, 0.046, 0.014, 0.019, 0.019, '#c6a78c', 'paint');
  for (const x of [-0.019, 0.019])
    shape(body, x, 0.585, 0.044, 0.004, 0.005, 0.004, '#41483f', 'paint');
  // Coat buttons, scarf and a satchel remain legible when studying the scene close up.
  for (const y of [0.36, 0.405, 0.45])
    shape(body, 0, y, 0.058, 0.005, 0.005, 0.003, '#ccb887', 'metal');
  shape(body, 0, 0.491, 0.01, 0.056, 0.014, 0.049, '#c8af80');
  if (index % 2)
    shape(body, 0.077, 0.348, -0.015, 0.029, 0.05, 0.039, '#846e53', 'wood');
  for (const side of [-1, 1]) {
    const hip = new T.Group();
    hip.name = side < 0 ? 'leg-left' : 'leg-right';
    hip.position.set(side * 0.038, 0.287, 0);
    root.add(hip);
    shape(hip, 0, -0.05, 0, 0.024, 0.06, 0.026, '#485455');
    const knee = new T.Group();
    knee.name = 'knee';
    knee.position.y = -0.1;
    hip.add(knee);
    shape(knee, 0, -0.054, 0, 0.022, 0.059, 0.024, '#485455');
    shape(knee, 0, -0.11, 0.016, 0.027, 0.017, 0.043, '#3f423b', 'paint').name =
      'shoe';
    const arm = new T.Group();
    arm.name = side < 0 ? 'arm-left' : 'arm-right';
    arm.position.set(side * 0.08, 0.46, 0);
    arm.rotation.z = side * 0.1;
    root.add(arm);
    shape(arm, 0, -0.065, 0, 0.019, 0.078, 0.023, coat);
    shape(arm, 0, -0.148, 0.005, 0.015, 0.022, 0.018, '#c6a78c', 'paint');
  }
  root.userData.gait = { phase: index * 1.7, amount: 0 };
  root.userData.sole = 0.06;
  return root;
}
export function animateResident(
  root: T.Group,
  distance: number,
  dt: number,
  paused: boolean,
) {
  if (paused) return;
  const gait = root.userData.gait;
  gait.phase += distance * 23;
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
    soles.push(
      0.287 -
        0.1 * Math.cos(a) -
        0.11 * Math.cos(b) -
        0.016 * Math.sin(b) -
        Math.hypot(0.017 * Math.cos(b), 0.043 * Math.sin(b)),
    );
    root.getObjectByName('arm-' + label)!.rotation.x =
      -swing * 0.36 * gait.amount;
  }
  root.userData.sole = Math.min(...soles);
}
