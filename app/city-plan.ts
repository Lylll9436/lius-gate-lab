import { addCurvedPaving } from './city-curved-paving';
import { addPaving } from './city-paving';
import { addPlantingWorks } from './city-landscape';
import { avenueTrees, wildTrees } from './city-planting-plan';
import { createStreetCraft } from './city-streetcraft';
import { crossings } from './city-ground';
import { addIsland } from './city-island';
import * as T from 'three';
import { placement, terraceUnit } from './city-layout';
import type { createCraft } from './city-craft';
import type { SurfaceKind } from './city-materials';
import { groundSurfaces, groundHeightAt, supportSurfaces } from './city-ground';
import { routeBetween, visitNodes } from './city-motion';
import type { BuildingId } from './city-data';

import { CELL, GRID_SIZE, districts, type DistrictId } from './city-districts';
export { CELL, GRID_SIZE, districts, type DistrictId };
export function walkingRoute(id: BuildingId): [number, number][] {
  return routeBetween('plaza', visitNodes[id]);
}
export function routeLength(points: [number, number][]) {
  return points
    .slice(1)
    .reduce(
      (sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]),
      0,
    );
}
type Box = (
  g: T.Group,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  color: string,
  kind?: SurfaceKind,
) => T.Mesh;
type Helpers = {
  craft: ReturnType<typeof createCraft>;
  box: Box;
  tree: (
    g: T.Group,
    x: number,
    z: number,
    size?: number,
    autumn?: boolean,
  ) => void;
  bench: (g: T.Group, x: number, z: number, angle?: number) => void;
  material: (color: string, kind?: SurfaceKind) => T.MeshStandardMaterial;
  pitchedRoof: (
    g: T.Group,
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    rise: number,
  ) => T.Mesh;
};

export function addGate(g: T.Group, box: Box) {
  const stone = '#d7c49e',
    trim = '#f0dfb6',
    dark = '#877b62';
  // Two real piers and a voussoir arch: the opening stays clear all the way through.
  for (const x of [-1.42, 1.42]) {
    box(g, x, 0.25, 0, 1.25, 0.3, 1.8, stone);
    box(g, x, 1.7, 0, 1, 2.8, 1.45, stone);
    box(g, x, 3.05, 0, 1.22, 0.2, 1.64, trim);
    for (const z of [-0.79, 0.79]) {
      box(g, x - 0.35, 1.7, z, 0.13, 2.5, 0.15, trim);
      box(g, x + 0.35, 1.7, z, 0.13, 2.5, 0.15, trim);
      box(g, x, 1.65, z, 0.37, 0.82, 0.08, dark);
      box(g, x, 1.65, z + 0.02, 0.24, 0.63, 0.1, stone);
    }
    for (let y = 0.5; y < 3; y += 0.32)
      box(g, x, y, 0.74, 1, 0.018, 0.012, '#b4a07d');
  }
  const opening = 0.92,
    outer = 1.5,
    base = 2.42;
  for (let i = 0; i < 11; i++) {
    const a = (i * Math.PI) / 11,
      b = ((i + 1) * Math.PI) / 11;
    const shape = new T.Shape();
    shape.moveTo(Math.cos(a) * opening, base + Math.sin(a) * opening);
    shape.lineTo(Math.cos(a) * outer, base + Math.sin(a) * outer);
    shape.lineTo(Math.cos(b) * outer, base + Math.sin(b) * outer);
    shape.lineTo(Math.cos(b) * opening, base + Math.sin(b) * opening);
    shape.closePath();
    const mesh = new T.Mesh(
      new T.ExtrudeGeometry(shape, { depth: 1.43, bevelEnabled: false }),
      new T.MeshStandardMaterial({ color: i % 2 ? stone : trim, roughness: 1 }),
    );
    mesh.position.z = -0.715;
    mesh.castShadow = true;
    g.add(mesh);
  }
  box(g, 0, 4.01, 0, 4.12, 0.34, 1.73, stone);
  box(g, 0, 4.34, 0, 4.34, 0.14, 1.93, trim);
  box(g, 0, 4.64, 0, 3.98, 0.5, 1.61, stone);
  box(g, 0, 4.94, 0, 4.22, 0.13, 1.83, trim);
  box(g, 0, 4.65, 0.824, 3.65, 0.38, 0.035, '#687365');
  box(g, 0, 4.65, -0.824, 3.65, 0.38, 0.035, '#687365');
  const glyph: Record<string, string[]> = {
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    I: ['111', '010', '010', '010', '010', '010', '111'],
    U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    "'": ['1', '1', '0', '0', '0', '0', '0'],
    ' ': ['00', '00', '00', '00', '00', '00', '00'],
  };
  const text = "LIU'S GATE",
    unit = 0.043,
    total =
      text.split('').reduce((n, c) => n + glyph[c][0].length + 1, 0) * unit;
  for (const front of [1, -1]) {
    let x = -total / 2;
    for (const c of text) {
      const rows = glyph[c];
      rows.forEach((row, r) =>
        row.split('').forEach((v, k) => {
          if (v === '1')
            box(
              g,
              front * (x + k * unit),
              4.78 - r * unit,
              front * 0.85,
              unit * 0.88,
              unit * 0.88,
              0.018,
              '#fff0c8',
            );
        }),
      );
      x += (rows[0].length + 1) * unit;
    }
  }
  for (const x of [-1.56, 1.56]) {
    box(g, x, 5.15, 0, 0.3, 0.34, 0.34, stone);
    const cap = new T.Mesh(
      new T.SphereGeometry(0.18, 6, 4),
      new T.MeshStandardMaterial({ color: trim, flatShading: true }),
    );
    cap.position.set(x, 5.42, 0);
    g.add(cap);
  }
  g.userData.openingWidth = opening * 2;
  g.userData.landmark = "LIU'S GATE";
}

export function addPlannedLandscape(city: T.Group, land: T.Group, h: Helpers) {
  const { box, tree, bench, material, pitchedRoof, craft } = h,
    lamps: T.Mesh[] = [];
  const street = createStreetCraft(box, material);
  const roadSurfaces = groundSurfaces.filter((s) => s.kind === 'road');
  const pavementSurfaces = groundSurfaces.filter((s) => s.kind !== 'road');
  const place = (
    id: string,
    kind: string,
    x: number,
    z: number,
    make: (g: T.Group) => void,
  ) => {
    const g = new T.Group();
    const position = placement[id];
    g.position.set(position?.[0] ?? x, 0, position?.[1] ?? z);
    g.userData.collider = { id, kind };
    g.userData.terrace = terraceUnit(id);
    land.add(g);
    make(g);
    return g;
  };
  addIsland(land, material);
  for (const s of supportSurfaces) {
    const mesh = box(
      land,
      s.x,
      (s.top + s.bottom) / 2,
      s.z,
      s.w,
      s.top - s.bottom,
      s.d,
      s.color,
      s.id.includes('lawn') ? 'grass' : 'stone',
    );
    mesh.userData.support = s;
  }
  addPaving(land, material);
  addCurvedPaving(land, material);
  addPlantingWorks(land, box, material, craft);
  for (const x of [-11, 5, 11])
    for (const z of [-5.5, 8.4]) {
      box(land, x, 0.1408, z + 0.505, 0.28, 0.0015, 0.075, '#40534e', 'metal');
      for (let dx = -0.1; dx < 0.12; dx += 0.04)
        box(
          land,
          x + dx,
          0.142,
          z + 0.505,
          0.014,
          0.001,
          0.065,
          '#7e8d80',
          'metal',
        );
    }
  for (const t of avenueTrees)
    place(t.id, 'tree', t.x, t.z, (g) => tree(g, 0, 0, t.size));
  for (const [i, t] of wildTrees.entries())
    place(t.id, 'tree', t.x, t.z, (g) => tree(g, 0, 0, t.size, i % 5 === 0));
  for (const [x, z] of [
    [-18.3, -13],
    [18.3, -13],
    [18.3, -5],
  ]) {
    box(land, x, 0.035, z, 3.3, 0.04, 3.8, '#b2bb91');
    for (const dx of [-1.65, 1.65])
      for (let dz = -1.7; dz < 1.9; dz += 0.6)
        box(land, x + dx, 0.12, z + dz, 0.055, 0.12, 0.28, '#dfd4b6');
    for (const dz of [-1.9, 1.9])
      for (let dx = -1.5; dx < 1.7; dx += 0.6)
        box(land, x + dx, 0.12, z + dz, 0.28, 0.12, 0.055, '#dfd4b6');
  }
  // This is a narrow one-way street: direction arrows, no two-lane centre line.
  for (const [x, z, heading] of [
    [4, -5.5, Math.PI / 2],
    [-5, 8.4, -Math.PI / 2],
    [14, 2, 0],
    [-14, 2, Math.PI],
  ]) {
    const shape = new T.Shape();
    [
      [-0.035, -0.28],
      [0.035, -0.28],
      [0.035, 0.04],
      [0.14, 0.04],
      [0, 0.28],
      [-0.14, 0.04],
      [-0.035, 0.04],
    ].forEach(([px, pz], i) =>
      i ? shape.lineTo(px, -pz) : shape.moveTo(px, -pz),
    );
    shape.closePath();
    const mark = new T.Mesh(
      new T.ShapeGeometry(shape),
      material('#ddd7c1', 'paint'),
    );
    mark.rotation.set(-Math.PI / 2, 0, 0);
    const group = new T.Group();
    group.rotation.y = heading;
    group.position.set(x, 0.1409, z);
    group.add(mark);
    land.add(group);
  }
  // Bars parallel traffic, repeated across the road width, between paired curb ramps.
  for (const { x, z, width } of crossings)
    for (let i = 0; i < 5; i++) {
      const stripe = box(
        land,
        x,
        0.142,
        z - 0.44 + i * 0.22,
        width,
        0.004,
        0.12,
        '#eee8d7',
        'paint',
      );
      stripe.userData.crossing = { x, z, width };
    }
  for (const x of [-3.4, 3.4])
    for (const z of [-2.6, 3])
      place(`square-planter-${x}-${z}`, 'planter', x, z, (g) => {
        box(g, 0, 0.35, 0, 1.05, 0.3, 0.9, '#bbab8c');
        box(g, 0, 0.495, 0, 0.95, 0.026, 0.8, '#59634b', 'soil');
        craft.herbs(
          g,
          0,
          0.51,
          0,
          0.86,
          0.7,
          Math.round(x * 71 + z * 101),
          0.28,
        );
      });
  for (const x of [-3.5, 3.5])
    place(`square-bench-${x}`, 'bench', x, -0.65, (g) =>
      bench(g, 0, 0, x > 0 ? -Math.PI / 2 : Math.PI / 2),
    );
  // Civic garden: the mature trees have their own planting beds and clear setbacks.
  const treeSites: [number, number, number][] = [
    [-11.8, -11.8, 1.1],
    [-8.2, -11.8, 1.1],
    [-11.8, -8.2, 1.1],
    [-8.2, -8.2, 1.1],
    [-14, -10, 1],
    [-3, -14.5, 0.85],
    [2.7, -12.4, 1],
    [3, -8.8, 1],
    [12.3, 1.3, 0.8],
    [12.3, 5.5, 0.85],
    [-12, 4.2, 0.85],
    [-4.9, 5.3, 0.75],
    [-12.1, 9.9, 0.65],
    [-9.2, 9.9, 0.65],
    [10.7, 10.1, 0.75],
  ];
  treeSites.forEach(([x, z, size], i) =>
    place(`tree-${i}`, 'tree', x, z, (g) => tree(g, 0, 0, size, i % 6 === 0)),
  );
  // Street houses frame the back edge without pretending to be extra researchers.
  for (const [i, x, z, tint] of [
    [0, -13.1, -14.4, '#bb8366'],
    [1, -11.4, -14.4, '#c2936e'],
    [2, -9.7, -14.4, '#d0b78b'],
    [3, 6.3, -13.5, '#c9b794'],
    [4, 8.1, -13.5, '#b58e70'],
  ] as const)
    place(`street-house-${i}`, 'building', x, z, (g) => {
      craft.wall(
        g,
        1.8,
        2,
        0.825,
        tint,
        [
          { x: 0, y: 0.48, w: 0.3, h: 0.86 },
          ...[-0.53, 0.53].flatMap((x) =>
            [0.65, 1.45].map((y) => ({ x, y, w: 0.3, h: 0.5 })),
          ),
        ],
        0.05,
      );
      box(g, 0, 1.05, -0.76, 1.8, 2, 0.13, tint);
      for (const side of [-1, 1]) {
        box(g, side * 0.835, 1.05, 0, 0.13, 2, 1.39, tint);
        const end = new T.Group();
        end.position.set(side * 0.9, 2.1, 0);
        end.rotation.y = (side * Math.PI) / 2;
        g.add(end);
        craft.gable(end, 1.65, 0.53, 0.13, tint);
      }
      craft.terraceRoof(g, 1.8, 1.81, 2.1, 0.57);
      craft.stoneFace(g, 1.8, 1.7, 0.827, tint, [
        { x: 0, y: 0.48, w: 0.44, h: 0.9 },
        ...[-0.53, 0.53].flatMap((x) =>
          [0.65, 1.45].map((y) => ({ x, y, w: 0.42, h: 0.66 })),
        ),
      ]);
      for (const y of [0.65, 1.45])
        for (const dx of [-0.53, 0.53])
          craft.window(g, dx, y, 0.825, 0.26, 0.46);
      box(g, 0, 0.48, 0.84, 0.28, 0.86, 0.045, '#506e64');
      box(g, 0, 0.1, 0.895, 0.45, 0.1, 0.16, '#bfb398');
      box(g, -0.4, 2.66, -0.3, 0.22, 0.8, 0.3, '#a78668');
      box(g, -0.4, 3.055, -0.3, 0.28, 0.065, 0.36, '#d4c4a0');
      craft.planter(g, 0.53, 0.28, 0.92, 0.31);
    });
  // Small front gardens share a building line, with a clear gate at every entrance.
  for (const id of ['pengyuan-liu', 'yunlong-liu', 'qin-li']) {
    const [x] = placement[id];
    place('front-garden-' + id, 'furniture', x, 0.89, (g) => {
      for (const side of [-1, 1]) {
        craft.rail(g, side * 0.78, 0, 0.54, 0.115);
        craft.planter(g, side * 0.77, 0.115, -0.3, 0.35);
      }
    });
  }
  function lamp(id: string, x: number, z: number) {
    place(id, 'lamp', x, z, (g) => {
      lamps.push(street.lamp(g));
    });
  }
  [
    [-12, -6.4],
    [-7, -6.4],
    [3.5, -6.4],
    [12, -6.4],
    [-6, 9.2],
    [1.25, 9.2],
    [8.1, 9.2],
    [13, 9.6],
    [-4.1, -3.9],
    [4.1, -3.9],
    [-4.1, 3.9],
    [4.1, 3.9],
  ].forEach(([x, z], i) => lamp(`lamp-${i}`, x, z));
  // The former central worksite is now a quiet research courtyard.
  const cranes: T.Group[] = [],
    jibs: T.Group[] = [];
  const sites = [
    [-18.3, -13],
    [18.3, -13],
    [18.3, -5],
  ];
  sites.forEach(([x, z], index) => {
    const siteId = `construction-site-${index}`;
    place(siteId, 'construction', x, z, (g) => {
      box(g, 0, 0.12, 0, 3.3, 0.15, 3.8, '#baa27e');
      for (const dx of [-1.65, 1.65])
        box(g, dx, 0.46, 0, 0.055, 0.7, 3.8, '#8e9e91');
      box(g, 0, 0.46, -1.9, 3.3, 0.7, 0.055, '#8e9e91');
      for (const dx of [-1.15, 1.15])
        box(g, dx, 0.46, 1.9, 1, 0.7, 0.055, '#8e9e91');
      for (const dx of [-1.55, 1.55])
        box(g, dx, 0.89, 1.87, 0.075, 0.2, 0.075, '#d4ad51');
      for (let i = 0; i < 3; i++)
        box(g, -0.9, 0.225 + i * 0.06, 0.82, 0.75, 0.06, 0.3, '#bcad93');
      box(g, 0.9, 0.345, -0.8, 0.7, 0.3, 0.7, '#a88a66');
    });
    const crane = new T.Group(),
      jib = new T.Group();
    crane.position.set(x, 0, z);
    crane.scale.set(0.5, 0.85, 0.5);
    crane.rotation.y = [0, Math.PI / 2, -Math.PI / 4][index];
    crane.userData.collider = {
      id: `crane-base-${index}`,
      kind: 'construction',
    };
    crane.userData.allowInside = siteId;
    city.add(crane);
    box(crane, 0, 0.23, 0, 0.85, 0.4, 0.85, '#82785f');
    for (let y = 0.5; y < 5.9; y += 0.43) {
      for (const dx of [-0.16, 0.16])
        for (const dz of [-0.16, 0.16])
          box(crane, dx, y, dz, 0.055, 0.45, 0.055, '#d3a147');
      box(crane, 0, y, 0, 0.39, 0.035, 0.39, '#e2b04f');
      for (const side of [-0.18, 0.18]) {
        const brace = box(
          crane,
          side,
          y + 0.1,
          0,
          0.025,
          0.46,
          0.035,
          '#ddb051',
        );
        brace.rotation.x = 0.68;
      }
    }
    jib.position.y = 5.8;
    crane.add(jib);
    box(jib, 0.7, 0, 0, 4.3, 0.15, 0.28, '#dfb355');
    for (let dx = -1.4; dx < 2.8; dx += 0.4) {
      box(jib, dx, 0.16, 0, 0.035, 0.26, 0.22, '#e4bb65');
      const brace = box(jib, dx, 0.15, 0, 0.48, 0.03, 0.035, '#d9a544');
      brace.rotation.z = 0.5;
    }
    box(jib, -1.25, -0.15, 0, 0.7, 0.38, 0.6, '#7c8175');
    box(jib, 0.25, -0.17, 0, 0.45, 0.36, 0.4, '#758f8b');
    box(jib, 2.3, -0.95, 0, 0.023, 1.75, 0.023, '#56675c');
    box(jib, 2.3, -1.84, 0, 0.16, 0.13, 0.11, '#b98c3b');
    for (const z of [-0.215, 0.215])
      for (const x of [0.1, 0.39])
        box(jib, x, -0.15, z, 0.018, 0.3, 0.022, '#d8b15c', 'metal');
    for (const x of [-1.49, -1.25, -1.01])
      box(jib, x, -0.16, 0, 0.012, 0.38, 0.61, '#646e65', 'stone');
    street.tube(jib, [2.3, 0.03, -0.07], [2.3, 0.03, 0.07], 0.071, '#737c6a');
    const hook = new T.Mesh(
      new T.TorusGeometry(0.062, 0.014, 8, 12, Math.PI * 1.4),
      material('#58665d', 'metal'),
    );
    hook.position.set(2.3, -1.96, 0);
    jib.add(hook);
    cranes.push(crane);
    jibs.push(jib);
  });
  // A continuous planted southern shore, joined to the civic axis.
  // Ripple relief is continuous across the river, not a grid of floating rectangles.
  place('cafe', 'building', 4.3, 10.05, (g) => {
    box(g, 0, 0.91, 0, 1.8, 1.7, 1.1, '#d0b68c');
    box(g, 0, 0.11, 0.62, 0.5, 0.1, 0.14, '#bfb398');
    pitchedRoof(g, 0, 1.82, 0, 2.02, 1.25, 0.45);
    box(g, 0, 1, 0.57, 1.42, 0.65, 0.04, '#4e7775');
    for (const x of [-0.4, 0, 0.4])
      box(g, x, 1, 0.61, 0.025, 0.65, 0.025, '#d9caa3');
    street.tube(g, [-0.97, 1.8, 0.58], [0.97, 1.8, 0.58], 0.027, '#465e55');
    street.tube(g, [0.9, 1.8, 0.58], [0.9, 0.1, 0.58], 0.018, '#465e55');
    box(g, 0, 0.68, 0.62, 1.53, 0.045, 0.18, '#a18057', 'wood');
    for (let x = -0.6; x < 0.65; x += 0.31) {
      box(g, x, 0.73, 0.59, 0.1, 0.1, 0.12, '#d8c4a0', 'paint');
    }
  });
  for (const x of [2.3, 6.6])
    place(`cafe-table-${x}`, 'furniture', x, 10, (g) => street.picnic(g));
  // The corner park is reserved for future memories; nothing fictional is displayed.
  place('park-bench', 'bench', -10.65, 9.75, (g) => bench(g, 0, 0));
  place('memory-board', 'memorial', -7.1, 10.2, (g) => {
    box(g, 0, 0.6, 0, 0.055, 1.16, 0.055, '#70856a');
    box(g, 0, 1, 0, 0.95, 0.6, 0.11, '#c4b088');
    box(g, 0, 1, 0.07, 0.78, 0.44, 0.025, '#f0e7cc');
  });
  place('phone-box', 'furniture', -5.1, 2.8, (g) => street.telephone(g));
  for (const [i, x] of [5.6, 6.5, 7.4].entries())
    place(`bike-${i}`, 'bicycle', x, -3.65, (g) => {
      for (const dx of [-0.2, 0.2]) {
        const wheel = new T.Mesh(
          new T.TorusGeometry(0.17, 0.023, 5, 12),
          material('#445f58'),
        );
        wheel.position.set(dx, 0.35, 0);
        g.add(wheel);
        for (let i = 0; i < 10; i++) {
          const a = (i * Math.PI) / 5;
          craft.branch(
            g,
            [dx, 0.35, 0],
            [dx + Math.cos(a) * 0.153, 0.35 + Math.sin(a) * 0.153, 0],
            0.003,
            0.003,
            '#adb4a0',
          );
        }
      }
      const frame = box(g, 0, 0.42, 0, 0.4, 0.035, 0.035, '#ac803e');
      frame.rotation.z = 0.4;
      box(g, 0.2, 0.54, 0, 0.025, 0.35, 0.025, '#445f58');
      for (const [a, b] of [
        [
          [-0.2, 0.35, 0],
          [-0.04, 0.56, 0],
        ],
        [
          [-0.04, 0.56, 0],
          [0, 0.35, 0],
        ],
        [
          [0, 0.35, 0],
          [-0.2, 0.35, 0],
        ],
        [
          [-0.04, 0.56, 0],
          [0.15, 0.58, 0],
        ],
        [
          [0.15, 0.58, 0],
          [0, 0.35, 0],
        ],
        [
          [0.15, 0.58, 0],
          [0.2, 0.35, 0],
        ],
      ] as [[number, number, number], [number, number, number]][])
        craft.branch(g, a, b, 0.009, 0.009, '#a88655');
      box(g, -0.045, 0.6, 0, 0.13, 0.025, 0.065, '#4f5c4a');
      box(g, 0.18, 0.71, 0, 0.1, 0.022, 0.1, '#445f58');
    });
  for (const g of land.children) {
    const info = g.userData.collider;
    if (
      !info ||
      g.userData.grounded ||
      ['construction', 'railing'].includes(info.kind)
    )
      continue;
    const bounds = new T.Box3().setFromObject(g);
    const support = groundHeightAt(g.position.x, g.position.z);
    g.position.y += support - bounds.min.y;
  }
  const tram = new T.Group();
  street.van(tram);
  city.add(tram);
  const ferry = new T.Group();
  street.boat(ferry);
  city.add(ferry);
  return { lamps, tram, ferry, cranes, jibs, roadSurfaces, pavementSurfaces };
}
