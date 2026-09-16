import { createResident, animateResident } from './city-people';
import { createStreetCraft } from './city-streetcraft';
import { createStreetLighting } from './city-lighting';
import { createIslandWater } from './city-water';
import { createDetailManager, type DetailAsset } from './city-detail';
import { createCityInk } from './city-ink';
import { groundHeightAt, grades } from './city-ground';
import * as T from 'three';
import {
  hoverPointer,
  pointerMove,
  clearPointer,
  hoverAllowed,
  labelPosition,
} from './city-hover';
import { placement, buildingDimensions, terraceUnit } from './city-layout';
import { createCraft } from './city-craft';
import {
  createCityMaterials,
  projectMaterialUV,
  type SurfaceKind,
} from './city-materials';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { fitStudy, roofDock } from './city-inspection';
import {
  makeWalker,
  stepCrowd,
  vehicleLoop,
  samplePath,
  lengthOf,
  boatPose,
  shortestAngle,
  type CollisionBody,
} from './city-motion';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildings, type Building, type BuildingId } from './city-data';
import {
  CELL,
  GRID_SIZE,
  districts,
  addGate,
  addPlannedLandscape,
  type DistrictId,
} from './city-plan';

export type CityAPI = {
  select: (id: BuildingId) => void;
  enter: (id: BuildingId) => void;
  reset: () => void;
  rotate: () => void;
  zoom: (factor: number) => void;
  setNight: (v: boolean) => void;
  setGrid: (v: boolean) => void;
  setPaused: (v: boolean) => void;
  setPlan: (v: boolean) => void;
  focusDistrict: (id: DistrictId) => void;
  focusPark: () => void;
  focusBuildings: (ids: BuildingId[]) => void;
  setInterior: (v: boolean) => void;
  dispose: () => void;
};

export function plotCenter(b: Pick<Building, 'id' | 'x' | 'z' | 'w' | 'd'>) {
  const position = placement[b.id];
  return position
    ? { x: position[0], z: position[1] }
    : { x: (b.x + b.w / 2 - 7) * CELL, z: (b.z + b.d / 2 - 7) * CELL };
}
const palette = {
  roof: '#43525b',
  stone: '#d3c19c',
  trim: '#eee0bd',
  dark: '#344c4a',
  glass: '#719b9b',
  grass: '#a9b984',
  path: '#d7cbb0',
  road: '#939a8d',
  wood: '#886344',
};
function wallHeight(b: Building) {
  return buildingDimensions(b).wallHeight;
}
export function buildCityModel(
  options: {
    quality?: 'far' | 'near';
    onlyBuilding?: BuildingId;
    library?: ReturnType<typeof createCityMaterials>;
  } = {},
) {
  const detailed = options.quality !== 'far',
    landscape = !options.onlyBuilding;
  const activeBuildings = options.onlyBuilding
    ? buildings.filter((b) => b.id === options.onlyBuilding)
    : buildings;
  const city = new T.Group(),
    land = new T.Group();
  city.add(land);
  const surfaceLibrary = options.library || createCityMaterials();
  const material = surfaceLibrary.material;
  const boxGeometry = new T.BoxGeometry(1, 1, 1);
  function box(
    g: T.Group,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: string,
    kind?: SurfaceKind,
  ) {
    const mat = material(color, kind);
    const rounded =
      ['wood', 'paint', 'fabric'].includes(mat.userData.surfaceKind) &&
      Math.min(w, h, d) > 0.025 &&
      Math.max(w, h, d) < 2;
    const geometry = rounded
      ? new RoundedBoxGeometry(
          w,
          h,
          d,
          1,
          Math.min(
            mat.userData.surfaceKind === 'fabric' ? 0.025 : 0.012,
            Math.min(w, h, d) * 0.18,
          ),
        )
      : boxGeometry;
    const m = new T.Mesh(geometry, mat);
    m.position.set(x, y, z);
    if (!rounded) m.scale.set(w, h, d);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  }
  const craft = createCraft(box, material, detailed ? 'near' : 'far');
  const nearCraft = createCraft(box, material, 'near');
  const street = createStreetCraft(box, material);
  function prism(
    g: T.Group,
    x: number,
    y: number,
    z: number,
    r: number,
    h: number,
    color: string,
    sides = 4,
  ) {
    const m = new T.Mesh(
      new T.CylinderGeometry(r, r, h, sides),
      material(color),
    );
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  }
  function cone(
    g: T.Group,
    x: number,
    y: number,
    z: number,
    r: number,
    h: number,
    color: string,
    sides = 4,
  ) {
    const m = new T.Mesh(new T.ConeGeometry(r, h, sides), material(color));
    m.position.set(x, y, z);
    m.rotation.y = Math.PI / 4;
    m.castShadow = true;
    g.add(m);
    return m;
  }
  function pitchedRoof(
    g: T.Group,
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    rise: number,
  ) {
    const mesh = craft.thinRoof(g, x, y, z, w, d, rise);
    for (const side of [-1, 1]) {
      const end = new T.Group();
      end.position.set(x, y, z + side * (d / 2 - 0.012));
      if (side < 0) end.rotation.y = Math.PI;
      g.add(end);
      craft.gable(end, w - 0.055, rise - 0.045, 0.06, palette.stone);
      box(
        g,
        x + side * w * 0.5,
        y - 0.02,
        z,
        0.045,
        0.05,
        d,
        '#485759',
        'metal',
      );
    }
    return mesh;
  }
  function factoryRoof(
    g: T.Group,
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    rise: number,
  ) {
    const shape = new T.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(d, 0);
    shape.lineTo(d, rise);
    shape.closePath();
    const mesh = new T.Mesh(
      new T.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false }),
      material(palette.roof),
    );
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(x - w / 2, y, z + d / 2);
    mesh.castShadow = true;
    g.add(mesh);
    box(
      g,
      x,
      y + rise * 0.54,
      z - d / 2 - 0.012,
      w * 0.88,
      rise * 0.78,
      0.025,
      '#8fafaa',
    );
    for (let dx = -w * 0.38; dx < w * 0.45; dx += 0.35)
      box(
        g,
        x + dx,
        y + rise * 0.54,
        z - d / 2 - 0.035,
        0.025,
        rise * 0.82,
        0.028,
        '#d4d5bc',
      );
  }
  function tree(g: T.Group, x: number, z: number, size = 1, autumn = false) {
    craft.tree(g, x, z, size, autumn);
    if (!detailed && g.userData.collider?.kind === 'tree')
      g.userData.treeSpec = [x, z, size, autumn];
  }
  function bench(g: T.Group, x: number, z: number, angle = 0) {
    const b = new T.Group();
    b.position.set(x, 0, z);
    b.rotation.y = angle;
    g.add(b);
    street.bench(b);
  }
  const { lamps, tram, ferry, cranes, jibs, roadSurfaces, pavementSurfaces } =
    landscape
      ? addPlannedLandscape(city, land, {
          box,
          tree,
          bench,
          material,
          pitchedRoof,
          craft,
        })
      : {
          lamps: [] as T.Mesh[],
          tram: new T.Group(),
          ferry: new T.Group(),
          cranes: [] as T.Group[],
          jibs: [] as T.Group[],
          roadSurfaces: [],
          pavementSurfaces: [],
        };
  const models = new Map<
    BuildingId,
    {
      root: T.Group;
      shell: T.Group;
      roof: T.Group;
      interior: T.Group;
      fade: T.MeshStandardMaterial[];
      center: T.Vector3;
    }
  >();
  function windowFront(
    g: T.Group,
    x: number,
    y: number,
    z: number,
    w = 0.4,
    h = 0.65,
    gothic = false,
    recess = 0.052,
  ) {
    craft.window(g, x, y, z, w, h, recess);
    // Stone lintels belong to the facade; no decorative cones over the glazing.
  }
  function windowSide(
    g: T.Group,
    x: number,
    y: number,
    z: number,
    w = 0.42,
    h = 0.65,
  ) {
    const face = new T.Group();
    face.position.set(x, y, z);
    face.rotation.y = Math.PI / 2;
    g.add(face);
    craft.window(face, 0, 0, 0, w, h);
  }
  function furnish(g: T.Group, w: number, d: number, b: Building) {
    const dark = b.variant === 'red-tenement',
      industrial = b.model === 'archive',
      floor = industrial ? '#b8b7a6' : dark ? '#9c7857' : '#cbbb97';
    g.userData.layout = b.id;
    g.userData.width = w;
    g.userData.depth = d;
    box(g, 0, 0.22, 0, w, 0.15, d, floor);
    for (let x = -w / 2 + 0.12; x < w / 2; x += industrial ? 0.44 : 0.19)
      box(
        g,
        x,
        0.299,
        0,
        0.012,
        0.007,
        d - 0.06,
        industrial ? '#959c91' : dark ? '#80654e' : '#a99c7c',
      );
    box(
      g,
      -w / 2 + 0.045,
      0.85,
      0,
      0.09,
      1.1,
      d,
      industrial ? '#ba9580' : palette.stone,
    );
    box(g, 0, 0.85, -d / 2 + 0.045, w, 1.1, 0.09, dark ? '#bb9679' : '#d5ceb5');
    const fixture = (
      id: string,
      x: number,
      z: number,
      build: (part: T.Group) => void,
      angle = 0,
    ) => {
      const part = new T.Group();
      part.position.set(x, 0, z);
      part.rotation.y = angle;
      part.userData.fixture = id;
      g.add(part);
      build(part);
      return part;
    };
    const desk = (part: T.Group, dw: number, dd: number, computer = true) => {
      box(part, 0, 0.755, 0, dw, 0.065, dd, '#947650', 'wood');
      for (const x of [-dw * 0.42, dw * 0.42])
        for (const z of [-dd * 0.36, dd * 0.36])
          box(part, x, 0.52, z, 0.035, 0.44, 0.035, '#55645a');
      if (computer) {
        box(part, 0, 0.805, -dd * 0.19, 0.19, 0.03, 0.12, '#3c514e');
        box(part, 0, 0.872, -dd * 0.22, 0.027, 0.13, 0.027, '#3c514e');
        box(
          part,
          0,
          1.015,
          -dd * 0.24,
          Math.min(0.39, dw * 0.66),
          0.25,
          0.037,
          '#334f51',
        );
        box(
          part,
          0,
          1.015,
          -dd * 0.24 + 0.023,
          Math.min(0.35, dw * 0.6),
          0.205,
          0.014,
          '#83a9a2',
        );
        box(
          part,
          0,
          0.803,
          dd * 0.19,
          Math.min(0.32, dw * 0.52),
          0.022,
          0.105,
          '#d7d6c4',
        );
        for (let i = 0; i < 4; i++)
          box(
            part,
            -0.105 + i * 0.07,
            0.817,
            dd * 0.19,
            0.04,
            0.004,
            0.06,
            '#85988d',
          );
        const mug = prism(
          part,
          dw * 0.34,
          0.837,
          dd * 0.12,
          0.033,
          0.085,
          '#d9cbb0',
          10,
        );
        box(part, dw * 0.34, 0.881, dd * 0.12, 0.04, 0.004, 0.04, '#66513e');
        mug.userData.craft = 'desk-cup';
        box(
          part,
          -dw * 0.28,
          0.797,
          dd * 0.11,
          Math.min(0.17, dw * 0.25),
          0.018,
          0.14,
          '#b69067',
        );
      } else {
        box(part, 0, 0.799, 0, dw * 0.49, 0.016, dd * 0.64, '#e6dfc9');
        box(part, 0.02, 0.811, 0.03, dw * 0.2, 0.007, 0.008, '#85998c');
      }
    };
    const chair = (part: T.Group, color = '#75836b') => {
      box(part, 0, 0.52, 0, 0.29, 0.055, 0.29, color, 'fabric');
      box(part, 0, 0.72, -0.127, 0.29, 0.34, 0.045, color, 'fabric');
      for (const x of [-0.1, 0.1])
        for (const z of [-0.1, 0.1])
          box(part, x, 0.41, z, 0.032, 0.22, 0.032, '#5c6858');
    };
    const shelf = (part: T.Group, sw: number, sd = 0.24, empty = false) => {
      for (const x of [-sw / 2, sw / 2])
        box(part, x, 0.86, 0, 0.032, 1.12, sd, '#6d7764');
      box(
        part,
        0,
        0.85,
        -sd / 2 + 0.014,
        sw,
        1.1,
        0.028,
        empty ? '#a6aa98' : '#8b7659',
      );
      for (let row = 0; row < 4; row++) {
        const y = 0.33 + row * 0.34;
        box(
          part,
          0,
          y,
          0,
          sw,
          0.033,
          sd,
          empty ? '#899888' : '#a08a62',
          empty ? 'metal' : 'wood',
        );
        const count = empty ? 1 : Math.max(2, Math.floor(sw / 0.1));
        for (let i = 0; i < count; i++) {
          const bw = empty ? sw * 0.22 : 0.064,
            x = empty
              ? sw * 0.22
              : -sw * 0.42 + i * ((sw * 0.84) / Math.max(1, count - 1));
          box(
            part,
            x,
            y + 0.13,
            0.015,
            bw,
            0.21,
            sd * 0.65,
            empty
              ? '#cdc3aa'
              : ['#6c8e87', '#bf9876', '#d1c19c', '#7d8062'][i % 4],
          );
          if (!empty)
            box(
              part,
              x,
              y + 0.17,
              sd * 0.35,
              bw * 0.7,
              0.012,
              0.009,
              '#ded3b6',
            );
        }
      }
    };
    const plant = (part: T.Group) => {
      const pot = new T.Mesh(
        new T.CylinderGeometry(0.095, 0.071, 0.2, 16),
        material('#ad805e', 'paint'),
      );
      pot.position.y = 0.4;
      pot.castShadow = pot.receiveShadow = true;
      part.add(pot);
      const rim = new T.Mesh(
        new T.TorusGeometry(0.087, 0.009, 6, 18),
        material('#bb9578', 'paint'),
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.495;
      part.add(rim);
      const soil = new T.Mesh(
        new T.CircleGeometry(0.081, 18),
        material('#505446', 'soil'),
      );
      soil.rotation.x = -Math.PI / 2;
      soil.position.y = 0.493;
      part.add(soil);
      craft.herbs(part, 0, 0.499, 0, 0.15, 0.15, 7, 0.24);
    };
    const lamp = (part: T.Group) => {
      prism(part, 0, 0.33, 0, 0.09, 0.04, '#5c6556', 12);
      box(part, 0, 0.88, 0, 0.024, 1.05, 0.024, '#82714c');
      cone(part, 0, 1.37, 0, 0.145, 0.18, '#ded0a7', 8);
    };
    const sofa = (part: T.Group, sw: number) => {
      for (const x of [-sw * 0.36, sw * 0.36])
        for (const z of [-0.14, 0.14])
          box(part, x, 0.37, z, 0.05, 0.14, 0.05, '#5c6858');
      box(part, 0, 0.52, 0, sw, 0.17, 0.43, '#718475', 'fabric');
      box(part, 0, 0.72, -0.18, sw, 0.37, 0.08, '#60766a', 'fabric');
      for (const x of [-sw / 2 + 0.045, sw / 2 - 0.045])
        box(part, x, 0.63, 0, 0.09, 0.3, 0.46, '#667d6e', 'fabric');
      for (const x of [-sw * 0.24, sw * 0.24])
        box(part, x, 0.64, 0.015, sw * 0.4, 0.08, 0.29, '#8c9b7e', 'fabric');
    };
    const wallBoard = (x: number, bw: number) => {
      box(g, x, 1.06, -d / 2 + 0.11, bw, 0.66, 0.035, '#758779');
      box(g, x, 1.06, -d / 2 + 0.136, bw - 0.08, 0.58, 0.02, '#dfdfc9');
      for (let i = 0; i < 4; i++)
        box(
          g,
          x - bw * 0.35 + i * bw * 0.23,
          1.03,
          -d / 2 + 0.15,
          0.035,
          0.38,
          0.008,
          '#a8b9a3',
        );
    };
    if (b.model === 'hall') {
      box(g, 0, 0.308, 0.1, 1.3, 0.014, d * 0.75, '#7e9181');
      fixture('reception-desk', 0, -d * 0.33, (p) => desk(p, 1.72, 0.55));
      wallBoard(0, 1.75);
      fixture('city-model-table', 0, 0.08, (p) => {
        desk(p, 0.92, 1.0, false);
        box(p, 0, 0.82, 0, 0.72, 0.035, 0.78, '#abb890');
        for (let i = 0; i < 7; i++)
          box(
            p,
            ((i % 3) - 1) * 0.19,
            0.9 + (i % 2) * 0.055,
            (Math.floor(i / 3) - 1) * 0.24,
            0.13,
            0.15 + (i % 2) * 0.11,
            0.17,
            i % 2 ? '#cbb28a' : '#8a9e8e',
          );
      });
      for (const x of [-w * 0.32, w * 0.32])
        for (const z of [-0.7, 0.1, 0.9])
          fixture(`public-seat-${x}-${z}`, x, z, (p) => chair(p, '#698179'));
      fixture('lectern', -w * 0.32, 1.84, (p) => {
        box(p, 0, 0.63, 0, 0.33, 0.65, 0.32, '#8b7351');
        box(p, 0, 0.98, 0, 0.47, 0.065, 0.41, '#b39b6b');
      });
      fixture('brochure-cabinet', w * 0.32, 1.82, (p) =>
        shelf(p, 0.5, 0.28, true),
      );
    } else if (b.variant === 'villa') {
      wallBoard(0.23, 0.85);
      fixture('bookcase', -0.5, -1.48, (p) => shelf(p, 0.68, 0.22));
      fixture('writing-desk', 0.46, -1.25, (p) => desk(p, 0.78, 0.44));
      fixture('desk-chair', 0.46, -0.68, (p) => chair(p));
      fixture('sofa', -0.6, 0.28, (p) => sofa(p, 0.94), Math.PI / 2);
      fixture('fireplace', 0.72, 0.35, (p) => {
        box(p, 0, 0.67, 0, 0.24, 0.73, 0.43, '#b8ab8b');
        box(p, -0.126, 0.62, 0, 0.012, 0.36, 0.25, '#4f5146');
        box(p, 0, 1.05, 0, 0.28, 0.07, 0.49, '#d9cbab');
      });
      fixture('side-table', -0.6, 1.0, (p) => desk(p, 0.36, 0.31, false));
      fixture('floor-lamp', -0.62, 1.43, lamp);
      fixture('entrance-plant', 0.63, 1.32, plant);
    } else if (b.variant === 'red-tenement') {
      fixture(
        'long-workbench',
        w * 0.32,
        -0.53,
        (p) => desk(p, 1.3, 0.34),
        Math.PI / 2,
      );
      fixture(
        'task-chair',
        0.1,
        -0.53,
        (p) => chair(p, '#7d8a87'),
        -Math.PI / 2,
      );
      fixture('tall-bookcase', -w * 0.28, -d * 0.39, (p) =>
        shelf(p, 0.46, 0.22),
      );
      fixture('reading-lamp', -w * 0.32, 0.22, lamp);
      fixture('window-chair', -w * 0.28, 0.83, (p) => chair(p, '#ad8668'));
      fixture('entry-cabinet', w * 0.32, 1.09, (p) => {
        box(p, 0, 0.55, 0, 0.31, 0.5, 0.36, '#887356');
        for (const y of [0.45, 0.62])
          box(p, 0, y, 0.188, 0.09, 0.019, 0.018, '#c6ba95');
      });
      wallBoard(0.02, 0.84);
    } else if (b.variant === 'gabled-house') {
      box(g, 0, 0.307, -0.2, w * 0.81, 0.014, 1.43, '#b3c4bd');
      for (const x of [-w * 0.29, w * 0.29])
        fixture(`reading-shelf-${x}`, x, -1.32, (p) => shelf(p, 0.42, 0.23));
      fixture('round-table', 0, -0.25, (p) => {
        prism(p, 0, 0.77, 0, 0.23, 0.055, '#d9cbad', 16);
        prism(p, 0, 0.53, 0, 0.055, 0.44, '#73847a', 8);
        box(p, 0, 0.81, 0.02, 0.22, 0.016, 0.15, '#efeadb');
      });
      fixture(
        'reading-seat-left',
        -0.47,
        -0.09,
        (p) => chair(p, '#8ca49b'),
        Math.PI / 2,
      );
      fixture(
        'reading-seat-right',
        0.47,
        -0.58,
        (p) => chair(p, '#8ca49b'),
        -Math.PI / 2,
      );
      fixture('low-storage', 0.47, 1.05, (p) => {
        box(p, 0, 0.49, 0, 0.32, 0.38, 0.44, '#bfba9e');
        box(p, 0, 0.73, 0, 0.18, 0.09, 0.25, '#809c98');
      });
      fixture('window-plant', -0.48, 1.1, plant);
    } else if (b.model === 'studio') {
      wallBoard(0, 2.7);
      for (const z of [-1.1, 0.08]) {
        fixture(`workstation-${z}`, -1.11, z, (p) => desk(p, 1.03, 0.48));
        fixture(`workstation-chair-${z}`, -1.11, z + 0.57, (p) =>
          chair(p, '#6f8b85'),
        );
      }
      fixture('discussion-table', 0.99, -1.1, (p) => desk(p, 0.9, 0.62, false));
      for (const x of [0.56, 1.45])
        fixture(`discussion-chair-${x}`, x, -0.47, (p) => chair(p, '#a6af8e'));
      fixture('model-island', 0.54, 0.73, (p) => {
        desk(p, 1.35, 0.65, false);
        box(p, 0, 0.83, 0, 0.64, 0.038, 0.4, '#abb591');
        for (let i = 0; i < 3; i++)
          box(
            p,
            -0.22 + i * 0.21,
            0.94,
            0,
            0.14,
            0.19,
            0.18,
            ['#c1a680', '#89a59a', '#cbbe9d'][i],
          );
      });
      for (const z of [-1.57, -0.58])
        box(g, 0.13, 0.92, z, 0.025, 1.22, 0.025, '#8a9c91');
      box(g, 0.13, 1.52, -1.07, 0.028, 0.025, 1.05, '#8a9c91');
      fixture('studio-plant', 1.48, 1.31, plant);
    } else {
      for (const x of [-1.3, 1.3])
        fixture(
          `archive-rack-${x}`,
          x,
          -0.35,
          (p) => shelf(p, 1.91, 0.34, true),
          Math.PI / 2,
        );
      fixture('flat-file-cabinet', 0, -1.29, (p) => {
        box(p, 0, 0.65, 0, 1.38, 0.7, 0.44, '#83978d');
        for (let y = 0.4; y < 0.98; y += 0.13) {
          box(p, 0, y, 0.235, 1.3, 0.015, 0.025, '#667b73');
          for (const x of [-0.36, 0.36])
            box(p, x, y + 0.042, 0.25, 0.17, 0.018, 0.018, '#d9d2b8');
        }
      });
      fixture('archive-reading-desk', 0.3, 0.77, (p) =>
        desk(p, 0.95, 0.49, false),
      );
      fixture(
        'archive-reading-chair',
        -0.42,
        0.85,
        (p) => chair(p, '#83978d'),
        Math.PI / 2,
      );
      for (const x of [-w * 0.4, w * 0.4])
        box(g, x, 1.43, 0, 0.09, 0.1, d - 0.15, '#596f65');
    }
  }
  for (const b of activeBuildings) {
    const root = new T.Group(),
      shell = new T.Group(),
      roof = new T.Group(),
      interior = new T.Group();
    root.add(interior, shell, roof);
    const p = plotCenter(b);
    root.position.set(p.x, 0.09, p.z);
    root.userData.buildingId = b.id;
    root.userData.terrace = terraceUnit(b.id);
    if (b.model !== 'gate')
      root.userData.collider = { id: b.id, kind: 'building' };
    city.add(root);
    if (b.model === 'gate') {
      addGate(shell, box);
      const fade: T.MeshStandardMaterial[] = [];
      shell.traverse((o) => {
        if (o instanceof T.Mesh)
          fade.push(o.material as T.MeshStandardMaterial);
      });
      models.set(b.id, {
        root,
        shell,
        roof,
        interior,
        fade,
        center: new T.Vector3(p.x, 0, p.z),
      });
      continue;
    }
    const { width: w, depth: d } = buildingDimensions(b),
      h = wallHeight(b);
    box(
      land,
      p.x,
      0.1,
      p.z,
      b.variant ? w : w + 0.12,
      0.18,
      d + 0.12,
      '#c8c3a9',
    );
    if (b.model === 'studio') {
      box(shell, 0, 0.68, 0, w, 1.0, d, b.color);
      box(shell, -w * 0.2, 2.12, 0, w * 0.58, 2.4, d, '#b9c7b5');
      box(shell, w * 0.29, 1.7, 0, w * 0.4, 1.5, d, '#86a49c');
    } else if (!b.variant) {
      const openings = [{ x: 0, y: 0.58, w: 0.49, h: 0.91 }];
      const sides: { x: number; y: number; w: number; h: number }[] = [];
      if (b.model === 'hall') {
        for (let y = 0.68; y < h; y += 0.88) {
          for (let j = 0; j < 4; j++)
            openings.push({ x: -w * 0.36 + j * w * 0.24, y, w: 0.47, h: 0.71 });
          for (let j = 0; j < 6; j++)
            sides.push({
              x: d * 0.36 - (j * d * 0.72) / 5,
              y,
              w: 0.44,
              h: 0.57,
            });
        }
      } else {
        for (let x = -w * 0.4; x < w * 0.49; x += 0.65)
          for (const y of [0.83, 1.57])
            if (Math.abs(x) >= 0.85) openings.push({ x, y, w: 0.48, h: 0.53 });
        for (let z = -d * 0.39; z < d * 0.49; z += 0.69)
          sides.push({ x: -z, y: 1.15, w: 0.51, h: 1.14 });
      }
      craft.wall(
        shell,
        b.model === 'hall' ? w - 0.52 : w,
        h,
        d / 2,
        b.color,
        openings,
      );
      box(
        shell,
        0,
        h / 2 + 0.18,
        -d / 2 + 0.065,
        b.model === 'hall' ? w - 0.52 : w,
        h,
        0.13,
        b.color,
      );
      for (const side of [-1, 1]) {
        const face = new T.Group();
        face.position.x = (side * w) / 2;
        face.rotation.y = (side * Math.PI) / 2;
        shell.add(face);
        craft.wall(
          face,
          d - (b.model === 'hall' ? 0.52 : 0.26),
          h,
          0,
          b.color,
          side > 0 ? sides : [],
        );
      }
    }
    box(shell, 0, 0.2, 0, b.variant ? w : w + 0.12, 0.23, d + 0.12, '#a69b83');
    if (b.model !== 'studio')
      box(
        shell,
        0,
        h + 0.08,
        0,
        b.variant ? w : w + 0.16,
        0.16,
        d + 0.16,
        palette.trim,
      );
    const pipeHeight =
      b.model === 'studio'
        ? 2.46
        : h +
          (b.model === 'hall' ? 0.195 : b.model === 'archive' ? 0.12 : 0.175);
    if (!b.variant)
      for (const z of [-d / 2 + 0.13, d / 2 - 0.15]) {
        box(
          shell,
          w / 2 + 0.07,
          (pipeHeight + 0.08) / 2,
          z,
          0.045,
          pipeHeight - 0.08,
          0.045,
          '#536963',
        );
        box(shell, w / 2 + 0.1, pipeHeight, z, 0.11, 0.045, 0.045, '#536963');
        for (let y = 0.5; y < pipeHeight; y += 0.72)
          box(shell, w / 2 + 0.071, y, z, 0.069, 0.033, 0.075, '#718078');
      }
    if (
      !b.variant &&
      b.model !== 'studio' &&
      b.model !== 'archive' &&
      b.variant !== 'gabled-house'
    )
      for (let floor = 0.68; floor < h; floor += 0.88) {
        for (let j = 0; j < (b.w === 1 ? 2 : 4); j++)
          windowFront(
            shell,
            -w * 0.36 + j * ((w * 0.72) / (b.w === 1 ? 1 : 3)),
            floor,
            d / 2 + 0.04,
            b.model === 'hall' ? 0.43 : 0.37,
            b.model === 'hall' ? 0.67 : 0.53,
            b.model === 'hall',
          );
        for (let j = 0; j < (b.d === 3 ? 6 : 3); j++)
          windowSide(
            shell,
            w / 2 + 0.02,
            floor,
            -d * 0.36 + j * ((d * 0.72) / (b.d === 3 ? 5 : 2)),
            0.4,
            0.53,
          );
      }
    // Stone string courses, lintels and corner quoins.
    if (!b.variant && b.model !== 'studio' && b.model !== 'hall')
      for (let y = 0.38; y < h; y += 0.3) {
        for (const x of [-w / 2, w / 2]) {
          box(shell, x, y, d / 2 + 0.045, 0.15, 0.16, 0.11, '#decaa3');
          box(shell, x + 0.035, y, -d / 2, 0.12, 0.16, 0.16, '#b7a17d');
        }
        if (Math.round(y * 10) % 3 === 0)
          box(shell, 0, y, d / 2 + 0.018, w, 0.017, 0.021, '#a7997f');
      }
    if (!b.variant) {
      box(shell, 0, 0.58, d / 2 - 0.04, 0.49, 0.91, 0.06, palette.dark);
      box(shell, 0, 1.1, d / 2 + 0.012, 0.63, 0.14, 0.15, palette.trim);
      box(shell, 0.13, 0.59, d / 2 + 0.007, 0.04, 0.045, 0.03, '#ddc68d');
    }
    for (let step = 0; step < 4; step++) {
      const top = 0.2 + ((step + 1) * (0.385 - 0.2)) / 4 - 0.09;
      const depth = 0.64 - step * 0.15;
      box(shell, 0, top / 2, d / 2 + depth / 2, 0.8, top, depth, '#c0b397');
    }
    if (b.model === 'hall') {
      pitchedRoof(roof, 0, h + 0.17, 0, w + 0.28, d + 0.24, 1.2);
      // Integral corner piers: the wall segments butt into these solid masonry corners.
      for (const x of [-w / 2 + 0.13, w / 2 - 0.13])
        for (const z of [-d / 2 + 0.13, d / 2 - 0.13]) {
          box(shell, x, h / 2 + 0.18, z, 0.26, h, 0.26, '#c6b18b');
          box(shell, x, h + 0.175, z, 0.3, 0.045, 0.3, palette.trim);
        }
      box(shell, 0, 4.42, d * 0.17, 1.21, 3.9, 1.36, palette.stone);
      box(shell, 0, 5.5, d * 0.17, 1.38, 0.18, 1.52, palette.trim);
      box(shell, 0, 6.26, d * 0.17, 1.45, 0.22, 1.6, palette.trim);
      for (const x of [-0.45, 0.45])
        for (const z of [d * 0.17 - 0.51, d * 0.17 + 0.51]) {
          prism(roof, x, 6.48, z, 0.1, 0.6, palette.stone, 6);
          cone(roof, x, 6.88, z, 0.18, 0.37, palette.roof, 6);
        }
      cone(roof, 0, 6.91, d * 0.17, 0.72, 1.25, palette.roof, 4);
      for (const x of [-0.3, 0.3])
        windowFront(shell, x, 5.83, d * 0.17 + 0.71, 0.14, 0.43, true);
      const clock = new T.Mesh(
        new T.CylinderGeometry(0.29, 0.29, 0.035, 16),
        material('#e5d6ae'),
      );
      clock.rotation.x = Math.PI / 2;
      clock.position.set(0, 4.95, d * 0.17 + 0.71);
      shell.add(clock);
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6,
          tick = box(
            shell,
            Math.sin(a) * 0.235,
            4.95 + Math.cos(a) * 0.235,
            d * 0.17 + 0.733,
            0.025,
            0.06,
            0.018,
            palette.dark,
          );
        tick.rotation.z = -a;
      }
      for (const side of [-1, 1])
        for (const z of [-d * 0.3, 0, d * 0.3])
          box(
            shell,
            side * (w / 2 + 0.085),
            1.18,
            z,
            0.12,
            2.02,
            0.21,
            '#b5a487',
          );
      box(shell, 0, 5.03, d * 0.17 + 0.739, 0.035, 0.18, 0.02, palette.dark);
      box(shell, 0.08, 4.95, d * 0.17 + 0.74, 0.17, 0.035, 0.02, palette.dark);
      // A small Scottish saltire above the entrance.
      box(roof, 0.9, 4.45, d * 0.36, 0.025, 1.5, 0.025, palette.dark);
      box(roof, 1.18, 4.99, d * 0.36, 0.52, 0.31, 0.025, '#55879e');
      for (const angle of [-0.53, 0.53]) {
        const stripe = box(
          roof,
          1.18,
          4.99,
          d * 0.36 + 0.018,
          0.58,
          0.055,
          0.018,
          '#e5e6d5',
        );
        stripe.rotation.z = angle;
      }
    } else if (b.model === 'studio') {
      box(
        shell,
        -w * 0.2,
        1.73,
        d / 2 + 0.07,
        w * 0.58,
        2.48,
        0.055,
        '#729797',
        'glass',
      );
      box(
        shell,
        w * 0.29,
        1.47,
        d / 2 + 0.07,
        w * 0.4,
        1.45,
        0.055,
        '#91b1a7',
        'glass',
      );
      for (let x = -w / 2 + 0.12; x < w / 2; x += 0.43) {
        const tall = x < w * 0.1;
        box(
          shell,
          x,
          tall ? 1.7 : 1.5,
          d / 2 + 0.14,
          0.04,
          tall ? 2.65 : 1.65,
          0.045,
          '#d6dcc4',
        );
      }
      for (const y of [0.54, 1.59, 2.62])
        box(shell, -w * 0.2, y, d / 2 + 0.16, w * 0.6, 0.07, 0.09, '#c0ccb8');
      for (let z = -d * 0.4; z < d * 0.5; z += 0.42)
        box(shell, -w / 2 - 0.045, 1.85, z, 0.13, 2.15, 0.047, '#c6b596');
      box(roof, -w * 0.2, h + 0.25, 0, w * 0.62, 0.18, d + 0.23, '#c6cbbb');
      box(roof, w * 0.3, 2.46, 0, w * 0.43, 0.18, d + 0.23, '#dce1cd');
      box(roof, w * 0.3, 2.6, 0, w * 0.34, 0.09, d - 0.35, '#819b69');
      for (const z of [-1.2, -0.3, 0.6]) {
        box(roof, w * 0.3, 2.72, z, 0.85, 0.16, 0.44, '#a1b082');
      }
      for (let i = 0; i < 3; i++) {
        const panel = box(
          roof,
          -w * 0.25,
          h + 0.43,
          -1.1 + i * 0.87,
          w * 0.42,
          0.045,
          0.63,
          '#3d6875',
        );
        panel.rotation.x = 0.16;
        for (let j = 0; j < 4; j++)
          box(
            roof,
            -w * 0.42 + j * w * 0.11,
            h + 0.47,
            -1.1 + i * 0.87,
            0.012,
            0.012,
            0.57,
            '#89a8a2',
          );
      }
      box(shell, 0, 1.34, d / 2 + 0.27, 1.25, 0.06, 0.53, '#dde0c8');
      for (const x of [-0.56, 0.56])
        box(shell, x, 0.77, d / 2 + 0.43, 0.04, 1.13, 0.04, '#5f807b');
    } else if (b.model === 'archive') {
      for (let i = 0; i < 3; i++) {
        factoryRoof(
          roof,
          0,
          h + 0.18,
          -d / 3 + (i * d) / 3,
          w + 0.2,
          d / 3 + 0.03,
          0.62,
        );
      }
      box(shell, -w * 0.35, 2.35, -d * 0.35, 0.48, 4.15, 0.48, b.color);
      box(roof, -w * 0.35, 4.43, -d * 0.35, 0.64, 0.16, 0.64, palette.trim);
      for (let x = -w * 0.4; x < w * 0.49; x += 0.65)
        for (const y of [0.83, 1.57])
          if (Math.abs(x) >= 0.85)
            windowFront(shell, x, y, d / 2 + 0.05, 0.44, 0.49);
      for (let z = -d * 0.39; z < d * 0.49; z += 0.69)
        windowSide(shell, w / 2 + 0.035, 1.15, z, 0.47, 1.1);
      box(shell, 0, 0.86, d / 2 + 0.14, 1.12, 1.37, 0.05, '#627a72');
      for (let y = 0.27; y < 1.56; y += 0.115)
        box(shell, 0, y, d / 2 + 0.174, 1.08, 0.023, 0.017, '#869990');
      box(shell, 0, 1.64, d / 2 + 0.18, 1.48, 0.055, 0.045, '#50695f');
      for (const x of [-0.69, 0.69])
        box(shell, x, 0.95, d / 2 + 0.19, 0.045, 1.45, 0.045, '#50695f');
      for (let y = 0.49; y < h; y += 0.24)
        box(shell, 0, y, -d / 2 - 0.014, w, 0.012, 0.012, '#a78068');
    } else {
      const unit = terraceUnit(b.id)!;
      const red = b.variant === 'red-tenement',
        gabled = b.variant === 'gabled-house';
      const frontApertures = [
        { x: 0, y: 0.8, w: 0.46, h: 1.1 },
        ...[-0.66, 0.66].flatMap((x) =>
          [0.95, 1.98].map((y) => ({
            x,
            y,
            w: !gabled && x < 0 ? 0.63 : 0.43,
            h: !gabled && x < 0 ? 0.87 : 0.7,
          })),
        ),
      ];
      craft.wall(shell, w, h, d / 2, b.color, frontApertures);
      for (const side of [-1, 1]) {
        const endWall = new T.Group();
        endWall.position.x = (side * w) / 2;
        endWall.rotation.y = (side * Math.PI) / 2;
        shell.add(endWall);
        const exposed = side < 0 ? !unit.left : !unit.right;
        craft.wall(
          endWall,
          d - 0.26,
          h,
          0,
          b.color,
          exposed ? [{ x: 0, y: 1.98, w: 0.44, h: 0.69 }] : [],
        );
        const attic = new T.Group();
        attic.position.y = h + 0.15;
        endWall.add(attic);
        craft.gable(attic, d, 0.81, 0.13, b.color);
      }
      const windowH = 0.66,
        holes = [
          { x: 0, y: 0.8, w: 0.68, h: 1.3 },
          ...[-0.66, 0.66].flatMap((x) =>
            [0.95, 1.98].map((y) => ({ x, y, w: 0.64, h: 0.86 })),
          ),
        ];
      craft.stoneFace(shell, w, h - 0.3, d / 2 + 0.012, b.color, holes);
      const rear = new T.Group();
      rear.position.z = -d / 2;
      rear.rotation.y = Math.PI;
      shell.add(rear);
      craft.wall(
        rear,
        w,
        h,
        0,
        b.color,
        [-0.58, 0.58].flatMap((x) =>
          [0.95, 1.98].map((y) => ({ x, y, w: 0.38, h: 0.67 })),
        ),
      );
      craft.stoneFace(
        rear,
        w,
        h - 0.3,
        0.012,
        b.color,
        [-0.58, 0.58].flatMap((x) =>
          [0.95, 1.98].map((y) => ({ x, y, w: 0.61, h: 0.85 })),
        ),
      );
      for (const x of [-0.58, 0.58])
        for (const y of [0.95, 1.98]) windowFront(rear, x, y, 0, 0.34, 0.63);
      craft.terraceRoof(roof, w, d + 0.18, h + 0.15, 0.85);
      for (const y of [1.46, 2.65])
        box(
          shell,
          0,
          y,
          d / 2 + 0.04,
          w,
          0.075,
          0.09,
          red ? '#a5785d' : '#d3c19d',
        );
      if (!gabled) craft.bay(shell, -0.66, 0, d / 2, b.color);
      for (const x of [-0.66, 0.66])
        for (const y of [0.95, 1.98]) {
          if (!gabled && x < 0) continue;
          windowFront(shell, x, y, d / 2, 0.39, windowH);
        }
      craft.door(
        shell,
        0,
        0.69,
        d / 2 - 0.04,
        red ? '#344e58' : gabled ? '#688575' : '#425f59',
        d / 2,
      );
      // Door leaf, fanlight, reveals and lintel share the same facade datum.
      for (const x of [-0.253, 0.253])
        box(shell, x, 0.8, d / 2 - 0.04, 0.046, 1.1, 0.13, '#d8c8a7');
      box(shell, 0, 1.385, d / 2 - 0.015, 0.58, 0.09, 0.13, '#e4d4b0');
      box(shell, 0, 1.225, d / 2 - 0.045, 0.44, 0.2, 0.018, '#769b95', 'glass');
      box(shell, 0, 1.116, d / 2 - 0.022, 0.44, 0.036, 0.06, '#d8c8a7');
      box(shell, 0, 1.225, d / 2 - 0.026, 0.018, 0.2, 0.018, '#d8c8a7');
      if (gabled) {
        // pitchedRoof supplies the single solid front gable.
        pitchedRoof(roof, 0, h + 0.08, d / 2 - 0.19, 1.08, 0.65, 0.68);
        windowFront(
          roof,
          0,
          h + 0.27,
          d / 2 + 0.123,
          0.26,
          0.31,
          false,
          -0.012,
        );
      } else {
        const dormerY = h + 0.15 + 0.85 * (1 - 1.22 / ((d + 0.18) / 2));
        const cheek = new T.Shape();
        const roofAt = (z: number) =>
          h + 0.15 + 0.85 * (1 - z / ((d + 0.18) / 2));
        cheek.moveTo(0.91, roofAt(0.91) - 0.025);
        cheek.lineTo(1.49, roofAt(1.49) - 0.025);
        cheek.lineTo(1.49, dormerY + 0.425);
        cheek.lineTo(0.91, dormerY + 0.425);
        cheek.closePath();
        const dormerBody = new T.Mesh(
          new T.ExtrudeGeometry(cheek, { depth: 0.58, bevelEnabled: false }),
          material(b.color),
        );
        dormerBody.rotation.y = -Math.PI / 2;
        dormerBody.position.x = 0.29;
        dormerBody.castShadow = dormerBody.receiveShadow = true;
        roof.add(dormerBody);
        const apron = box(
          roof,
          0,
          roofAt(1.515) + 0.026,
          1.515,
          0.65,
          0.018,
          0.11,
          '#737d80',
          'metal',
        );
        apron.rotation.x = Math.atan(0.85 / ((d + 0.18) / 2));
        windowFront(roof, 0, dormerY + 0.2, 1.49, 0.34, 0.34, false, -0.012);
        pitchedRoof(roof, 0, dormerY + 0.425, 1.2, 0.69, 0.68, 0.24);
      }
      // Party walls have no projecting side windows, cornices or rain pipes.
      for (const side of [-1, 1])
        if (side < 0 ? !unit.left : !unit.right) {
          const end = new T.Group();
          end.position.x = (side * w) / 2;
          end.rotation.y = (side * Math.PI) / 2;
          shell.add(end);
          craft.stoneFace(end, d, h - 0.3, 0.009, b.color, [
            { x: 0, y: 1.98, w: 0.66, h: 0.87 },
          ]);
          windowFront(end, 0, 1.98, 0, 0.4, 0.65);
          box(
            shell,
            side * (w / 2 - 0.035),
            (h + 0.2) / 2,
            d / 2 + 0.145,
            0.038,
            h + 0.2,
            0.04,
            '#43574e',
          );
        }
      const chimneyX = unit.left ? -0.79 : 0.79;
      for (const side of [-1, 1]) {
        const z = -0.16 + side * 0.25,
          roofY = h + 0.15 + 0.85 * (1 - Math.abs(z) / ((d + 0.18) / 2));
        const flashing = box(
          roof,
          chimneyX,
          roofY + 0.028,
          z,
          0.43,
          0.012,
          0.23,
          '#777f80',
          'metal',
        );
        flashing.rotation.x = Math.sign(z) * Math.atan(0.85 / ((d + 0.18) / 2));
      }
      box(
        roof,
        chimneyX,
        h + 0.98,
        -0.16,
        0.31,
        0.69,
        0.42,
        red ? '#a16e54' : '#b49b78',
      );
      box(roof, chimneyX, h + 1.31, -0.16, 0.39, 0.085, 0.5, '#d5c4a2');
      for (const dz of [-0.12, 0.12]) {
        prism(roof, chimneyX, h + 1.46, -0.16 + dz, 0.058, 0.23, '#a57656', 8);
        prism(roof, chimneyX, h + 1.575, -0.16 + dz, 0.07, 0.027, '#bd9270', 8);
      }
      for (const x of [-0.66, 0.66]) {
        const bay = !gabled && x < 0;
        craft.planter(shell, x, 0.5, d / 2 + (bay ? 0.285 : 0.14), 0.43);
        for (const dx of [-0.14, 0.14])
          box(
            shell,
            x + dx,
            0.49,
            d / 2 + (bay ? 0.25 : 0.09),
            0.023,
            0.027,
            bay ? 0.1 : 0.18,
            '#43574e',
          );
      }
      roof.userData.chimney = [chimneyX, h + 1.6, -0.16];
    }
    if (detailed) furnish(interior, w - 0.2, d - 0.2, b);
    // Keep roof and facade materials local to each building for section inspection.
    const fade: T.MeshStandardMaterial[] = [];
    for (const part of [shell, roof]) {
      const cache = new Map<T.Material, T.MeshStandardMaterial>();
      part.traverse((o) => {
        if (o instanceof T.Mesh) {
          const old = o.material as T.MeshStandardMaterial;
          if (!cache.has(old)) {
            const m = old.clone();
            cache.set(old, m);
            fade.push(m);
          }
          o.material = cache.get(old)!;
        }
      });
    }
    models.set(b.id, {
      root,
      shell,
      roof,
      interior,
      fade,
      center: new T.Vector3(p.x, 0, p.z),
    });
  }
  // Moving residents stay on the public pavements, independent of person profiles.
  const walkers: T.Group[] = [];
  for (let i = 0; i < (landscape ? 5 : 0); i++) {
    const person = createResident(i, material);
    city.add(person);
    walkers.push(person);
  }
  city.updateMatrixWorld(true);
  const colliders: CollisionBody[] = [];
  city.traverse((o) => {
    const tag = o.userData.collider;
    if (!tag) return;
    const bounds = new T.Box3().setFromObject(o);
    colliders.push({
      id: tag.id,
      kind: tag.kind,
      allowInside: o.userData.allowInside,
      min: bounds.min.toArray() as [number, number, number],
      max: bounds.max.toArray() as [number, number, number],
    });
  });
  for (const x of [-1.42, 1.42])
    colliders.push({
      id: 'gate-pier-' + x,
      kind: 'gate',
      min: [x - 0.625, 0.1, -0.9],
      max: [x + 0.625, 3.24, 0.9],
    });
  const smokeEmitters: T.Vector3[] = [];
  for (const b of activeBuildings) {
    const p = plotCenter(b),
      w = buildingDimensions(b).width,
      d = b.d * CELL - 0.6;
    if (b.variant) {
      const chimney = models.get(b.id)!.roof.userData.chimney;
      smokeEmitters.push(
        new T.Vector3(p.x + chimney[0], 0.09 + chimney[1], p.z + chimney[2]),
      );
    }
    if (b.model === 'archive')
      smokeEmitters.push(new T.Vector3(p.x - w * 0.35, 4.7, p.z - d * 0.35));
  }
  // Batch stationary meshes by material; the interactive buildings keep separate roots.
  // Keep a small number of physically distinct materials, not one shader for every pigment.
  function batch(g: T.Group) {
    g.updateMatrixWorld(true);
    const inv = g.matrixWorld.clone().invert(),
      groups = new Map<T.Material, T.BufferGeometry[]>(),
      old: T.Mesh[] = [];
    g.traverse((o) => {
      if (o instanceof T.Mesh && !lamps.includes(o)) {
        const source = o.material as T.MeshStandardMaterial;
        const mat = surfaceLibrary.batchMaterial(source, !!g.userData.layout);
        const geometry = o.geometry.clone();
        if (!geometry.userData.longitudinalUV) {
          const local = geometry.clone().scale(o.scale.x, o.scale.y, o.scale.z);
          projectMaterialUV(local, source.userData.surfaceKind);
          geometry.setAttribute('uv', local.getAttribute('uv').clone());
          local.dispose();
        }
        geometry.applyMatrix4(inv.clone().multiply(o.matrixWorld));
        if (source.userData.surfaceKind === 'grass')
          projectMaterialUV(geometry, 'grass');
        const count = geometry.getAttribute('position').count,
          previous = geometry.getAttribute('color');
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          colors[i * 3] = source.color.r * (previous ? previous.getX(i) : 1);
          colors[i * 3 + 1] =
            source.color.g * (previous ? previous.getY(i) : 1);
          colors[i * 3 + 2] =
            source.color.b * (previous ? previous.getZ(i) : 1);
        }
        geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
        if (!groups.has(mat)) groups.set(mat, []);
        groups.get(mat)!.push(geometry);
        old.push(o);
      }
    });
    old.forEach((o) => o.removeFromParent());
    for (const [mat, geometries] of groups) {
      const normalized = geometries.map((geo) => {
        if (!geo.index)
          geo.setIndex(
            Array.from(
              { length: geo.getAttribute('position').count },
              (_, i) => i,
            ),
          );
        return geo;
      });
      for (const geo of normalized) {
        for (const name of Object.keys(geo.attributes))
          if (
            name !== 'position' &&
            name !== 'normal' &&
            name !== 'color' &&
            name !== 'uv'
          )
            geo.deleteAttribute(name);
      }
      const merged = mergeGeometries(normalized, false);
      if (merged) {
        const mesh = new T.Mesh(merged, mat);
        mesh.castShadow =
          (mat as T.MeshStandardMaterial).userData.surfaceKind !== 'glass';
        mesh.receiveShadow = true;
        g.add(mesh);
      }
      const disposed = new Set<T.BufferGeometry>();
      for (const geo of [...geometries, ...normalized])
        if (!disposed.has(geo)) {
          geo.dispose();
          disposed.add(geo);
        }
    }
  }
  const treeLods = land.children
    .filter((g) => g.userData.treeSpec)
    .map((root) => {
      const low = new T.Group();
      low.add(...root.children);
      root.add(low);
      batch(low);
      const spec = root.userData.treeSpec as [number, number, number, boolean];
      return {
        root,
        low,
        create: () => {
          const group = new T.Group();
          group.position.copy(root.position);
          nearCraft.tree(group, ...spec);
          group.position.set(0, 0, 0);
          const foot = new T.Box3().setFromObject(group).min.y;
          group.position.y =
            groundHeightAt(root.position.x, root.position.z) -
            root.position.y -
            foot;
          batch(group);
          return group;
        },
      };
    });
  const parkAssets = land.children.filter((g) =>
    ['park-bench', 'memory-board', 'tree-12', 'tree-13'].includes(
      g.userData.collider?.id,
    ),
  );
  for (const g of parkAssets) land.remove(g);
  for (const t of treeLods) land.remove(t.root);
  batch(land);
  for (const t of treeLods) land.add(t.root);
  for (const g of parkAssets) {
    if (!treeLods.some((t) => t.root === g)) batch(g as T.Group);
    land.add(g);
    g.userData.parkSelection = true;
  }
  for (const m of models.values()) {
    batch(m.shell);
    batch(m.roof);
    batch(m.interior);
  }
  // Preserve shoulder, hip and knee pivots; merge only the rigid body and each limb section.
  for (const person of walkers)
    for (const part of person.children) {
      const joints = part.children.filter((o) => o instanceof T.Group);
      for (const joint of joints) {
        part.remove(joint);
        batch(joint as T.Group);
      }
      batch(part as T.Group);
      if (joints.length) part.add(...joints);
    }
  if (landscape) {
    batch(tram);
    batch(ferry);
  }
  cranes.forEach((crane, i) => {
    const jib = jibs[i];
    batch(jib);
    crane.remove(jib);
    batch(crane);
    crane.add(jib);
  });
  const water = landscape ? createIslandWater() : null;
  if (water) city.add(water.bottom, water.mesh);
  return {
    water,
    city,
    models,
    walkers,
    lamps,
    tram,
    ferry,
    cranes,
    jibs,
    roadSurfaces,
    pavementSurfaces,
    colliders,
    smokeEmitters,
    disposeMaterials: options.library ? () => {} : surfaceLibrary.dispose,
    treeLods,
    materialLibrary: surfaceLibrary,
  };
}

export function createCity(
  container: HTMLDivElement,
  onSelect: (id: BuildingId) => void,
  onPark: () => void = () => {},
): CityAPI {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new T.WebGLRenderer({
    antialias: true,
    alpha: true,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0, 0);
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute(
    'aria-label',
    "LIU'S GATE: a playful overview of the lab. All research content is also available below.",
  );
  container.appendChild(renderer.domElement);
  const scene = new T.Scene(),
    camera = new T.OrthographicCamera(-24, 24, 24, -24, 0.1, 180),
    model = buildCityModel({ quality: 'far' });
  const { city, models, walkers, lamps, tram, ferry, jibs } = model;
  const ink = createCityInk(renderer, scene, camera);
  scene.add(city);
  const detailAssets: DetailAsset[] = model.treeLods.map((t, i) => ({
    id: 'tree-' + i,
    root: t.root,
    low: t.low,
    height: new T.Box3().setFromObject(t.root).getSize(new T.Vector3()).y,
    kind: 'tree',
    create: t.create,
  }));
  for (const b of buildings) {
    const low = models.get(b.id)!;
    const anchor = new T.Group();
    anchor.position.copy(low.root.position);
    city.add(anchor);
    anchor.attach(low.root);
    let high: typeof low | undefined;
    detailAssets.push({
      id: b.id,
      root: anchor,
      low: low.root,
      height: Math.max(b.height, 3.2),
      kind: 'building',
      create: () => {
        const asset = buildCityModel({
          quality: 'near',
          onlyBuilding: b.id,
          library: model.materialLibrary,
        });
        high = asset.models.get(b.id)!;
        high.root.position.set(0, 0, 0);
        return high.root;
      },
      activate: (near) => models.set(b.id, near && high ? high : low),
      onEvict: () => {
        high = undefined;
      },
    });
  }
  const details = createDetailManager(detailAssets);
  const lighting = createStreetLighting(scene, lamps);
  const sky = new T.HemisphereLight('#f4f1e4', '#6e8986', 1.65);
  scene.add(sky);
  const sun = new T.DirectionalLight('#fff0d5', 3.3);
  sun.position.set(-16, 32, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -27,
    right: 27,
    top: 27,
    bottom: -27,
    near: 1,
    far: 90,
  });
  sun.shadow.normalBias = 0.012;
  sun.shadow.bias = -0.00012;
  scene.add(sun);
  scene.add(sun.target);
  function shadowFocus(center?: T.Vector3, radius = 30) {
    const resolution = center ? 4096 : 2048;
    if (sun.shadow.mapSize.x !== resolution) {
      sun.shadow.mapSize.set(resolution, resolution);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    sun.target.position.copy(center || new T.Vector3());
    sun.position.copy(sun.target.position).add(new T.Vector3(-16, 32, 20));
    Object.assign(sun.shadow.camera, {
      left: -radius,
      right: radius,
      top: radius,
      bottom: -radius,
    });
    sun.shadow.camera.updateProjectionMatrix();
  }
  const shadow = new T.Mesh(
    new T.PlaneGeometry(180, 180),
    new T.ShadowMaterial({
      color: '#4c6858',
      opacity: 0.12,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.56;
  shadow.receiveShadow = true;
  scene.add(shadow);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableRotate = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.minZoom = 0.7;
  controls.maxZoom = 4;
  controls.screenSpacePanning = true;
  controls.mouseButtons.LEFT = T.MOUSE.PAN;
  controls.mouseButtons.RIGHT = T.MOUSE.PAN;
  controls.touches.ONE = null;
  controls.touches.TWO = T.TOUCH.DOLLY_PAN;
  renderer.domElement.style.touchAction = 'pan-y';
  function wheelIntent(e: WheelEvent) {
    controls.enableZoom = e.ctrlKey || e.metaKey;
  }
  function touchIntent(e: PointerEvent) {
    if (e.pointerType === 'touch') controls.enableZoom = true;
  }
  renderer.domElement.addEventListener('wheel', wheelIntent, {
    capture: true,
    passive: true,
  });
  renderer.domElement.addEventListener('pointerdown', touchIntent, {
    capture: true,
  });
  let width = 1,
    height = 1,
    yaw = Math.PI / 4,
    targetYaw = yaw,
    night = 0,
    targetNight = 0,
    paused = reduced,
    disposed = false,
    raf = 0,
    last = 0,
    time = 0,
    targetZoom = 1,
    tween = true,
    plan = false,
    gridEnabled = false,
    inViewport = true,
    inspect: T.Group | null = null,
    inspectId: BuildingId | null = null,
    interior = false,
    openAmount = 0,
    inspectionAutoFit = true,
    trafficDistance = 0;
  const sectionPlane = new T.Plane(new T.Vector3(0, -1, 0), 100);
  const inspectionMaterials: T.Material[] = [];
  const target = new T.Vector3(),
    offset = new T.Vector3();
  const walkerStates = walkers.map((_, i) => makeWalker(i)),
    loop = vehicleLoop(),
    loopLength = lengthOf(loop);
  const grid = new T.GridHelper(
    GRID_SIZE * CELL,
    GRID_SIZE,
    '#81937e',
    '#a9b6a0',
  );
  (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach(
    (m) => (m.depthWrite = false),
  );
  grid.position.y = 0.26;
  grid.visible = false;
  scene.add(grid);
  const zones = new T.Group();
  zones.visible = false;
  scene.add(zones);
  for (const d of districts) {
    const m = new T.Mesh(
      new T.PlaneGeometry(...d.size),
      new T.MeshBasicMaterial({
        color: d.color,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(d.center[0], 0.265, d.center[1]);
    m.userData.district = d.id;
    zones.add(m);
  }
  const highlight = new T.LineLoop(
    new T.BufferGeometry().setFromPoints([
      new T.Vector3(-0.5, 0, -0.5),
      new T.Vector3(0.5, 0, -0.5),
      new T.Vector3(0.5, 0, 0.5),
      new T.Vector3(-0.5, 0, 0.5),
    ]),
    new T.LineBasicMaterial({ color: '#ad8142', depthWrite: false }),
  );
  highlight.visible = false;
  scene.add(highlight);
  const smoke = new T.Group();
  scene.add(smoke);
  // No decorative smoke blobs.
  const parkHit = new T.Mesh(
    new T.BoxGeometry(5.5, 1.4, 1.8),
    new T.MeshBasicMaterial({ visible: false }),
  );
  parkHit.position.set(-10.65, 0.7, 9.95);
  parkHit.userData.placeId = 'corner-park';
  city.add(parkHit);
  const hover = hoverPointer();
  const labels = [
    ...buildings.map((b) => ({
      b,
      element: container.parentElement!.querySelector<HTMLDivElement>(
        `[data-building-label="${b.id}"]`,
      ),
    })),
    {
      b: { id: 'corner-park' as const, height: 1.8 },
      element: container.parentElement!.querySelector<HTMLDivElement>(
        '[data-building-label="corner-park"]',
      ),
    },
  ];
  let focusedIds: BuildingId[] = [],
    parkSelected = false,
    autoFocus = false;
  function fitFocused() {
    const roots = focusedIds
      .map((id) => models.get(id)?.root)
      .filter((r): r is T.Group => !!r);
    if (!roots.length) return;
    city.updateMatrixWorld(true);
    const bounds = new T.Box3();
    roots.forEach((r) => bounds.union(new T.Box3().setFromObject(r)));
    target.copy(bounds.getCenter(new T.Vector3()));
    const size = bounds.getSize(new T.Vector3());
    const spanX = (size.x + size.z) * 0.707,
      spanY = (size.x + size.z) * 0.48 + size.y * 0.75;
    targetZoom = T.MathUtils.clamp(
      Math.min(
        ((camera.right - camera.left) * 0.62) / spanX,
        ((camera.top - camera.bottom) * 0.65) / spanY,
      ),
      1.3,
      3.4,
    );
    tween = true;
  }
  function focusBuildings(ids: BuildingId[]) {
    exitInspection();
    focusedIds = [...new Set(ids)];
    parkSelected = false;
    autoFocus = true;
    fitFocused();
  }
  function resize() {
    if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
    width = container.clientWidth;
    height = container.clientHeight;
    const aspect = width / Math.max(height, 1),
      vertical = Math.max(53, 76 / aspect);
    camera.left = (-vertical * aspect) / 2;
    camera.right = (vertical * aspect) / 2;
    camera.top = vertical / 2;
    camera.bottom = -vertical / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    ink.resize(width, height);
    inspectionAutoFit = true;
    if (autoFocus) fitFocused();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  const visibilityObserver = new IntersectionObserver(
    ([entry]) => {
      inViewport = entry.isIntersecting;
      if (!inViewport) clearHover();
      last = 0;
    },
    { rootMargin: '100px' },
  );
  visibilityObserver.observe(container);
  resize();
  function align() {
    offset.set(Math.sin(yaw) * 38, 35, Math.cos(yaw) * 38);
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);
    camera.updateProjectionMatrix();
  }
  align();
  controls.update();
  function exitInspection() {
    shadowFocus();
    clearHover();
    if (inspect) {
      scene.remove(inspect);
      inspect = null;
    }
    inspectId = null;
    inspectionMaterials.forEach((m) => m.dispose());
    inspectionMaterials.length = 0;
    interior = false;
    openAmount = 0;
    city.visible = true;
    smoke.visible = true;
    grid.visible = gridEnabled;
    zones.visible = plan;
    controls.maxZoom = 4;
  }
  function select(id: BuildingId) {
    exitInspection();
    const b = buildings.find((b) => b.id === id)!,
      m = models.get(id)!;
    target.copy(m.center).add(new T.Vector3(0, 1, 0));
    focusedIds = [id];
    parkSelected = false;
    autoFocus = true;
    fitFocused();
    tween = true;
    highlight.position.set(m.center.x, 0.3, m.center.z);
    highlight.scale.set(b.w * CELL, 1, b.d * CELL);
    highlight.visible = true;
  }
  function reset() {
    exitInspection();
    focusedIds = [];
    parkSelected = false;
    autoFocus = false;
    target.set(0, 0, 0);
    targetZoom = 1;
    targetYaw = yaw + shortestAngle(yaw, Math.PI / 4);
    tween = true;
    highlight.visible = false;
  }
  function cancel() {
    clearHover();
    autoFocus = false;
    inspectionAutoFit = false;
    tween = false;
    targetZoom = camera.zoom;
  }
  controls.addEventListener('start', cancel);
  const ray = new T.Raycaster(),
    mouse = new T.Vector2();
  let downX = 0,
    downY = 0,
    multiPointer = false;
  const activePointers = new Set<number>();
  function pickAt(clientX: number, clientY: number) {
    if (inspect) return null;
    const rect = container.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      clientX < rect.left ||
      clientX > rect.left + rect.width ||
      clientY < rect.top ||
      clientY > rect.top + rect.height
    )
      return null;
    mouse.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      (-(clientY - rect.top) / rect.height) * 2 + 1,
    );
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(
      [...Array.from(models.values(), (m) => m.root), parkHit],
      true,
    )[0];
    if (!hit) return null;
    let object: T.Object3D | null = hit.object;
    while (object && !object.userData.buildingId && !object.userData.placeId)
      object = object.parent;
    return (object?.userData.buildingId ?? object?.userData.placeId) as
      | BuildingId
      | 'corner-park'
      | null;
  }
  function down(e: PointerEvent) {
    clearHover();
    hover.dragging = true;
    activePointers.add(e.pointerId);
    if (activePointers.size > 1) multiPointer = true;
    else {
      downX = e.clientX;
      downY = e.clientY;
    }
  }
  function up(e: PointerEvent) {
    const tracked = activePointers.delete(e.pointerId);
    const blocked = multiPointer || activePointers.size > 0;
    if (activePointers.size === 0) {
      hover.dragging = false;
      multiPointer = false;
    }
    if (
      !tracked ||
      blocked ||
      e.button !== 0 ||
      Math.hypot(e.clientX - downX, e.clientY - downY) > 5
    )
      return;
    const id = pickAt(e.clientX, e.clientY);
    if (id === 'corner-park') onPark();
    else if (id) onSelect(id);
  }
  function move(e: PointerEvent) {
    pointerMove(hover, e);
    if (e.buttons) clearHover();
  }
  function clearHover() {
    clearPointer(hover);
    labels.forEach(({ element }) => {
      if (element) element.style.visibility = 'hidden';
    });
    renderer.domElement.style.cursor = 'grab';
  }
  function leave() {
    hover.dragging = false;
    activePointers.clear();
    multiPointer = false;
    clearHover();
  }
  function updateHover() {
    const active =
      hoverAllowed(hover, !!inspect, inViewport) && !document.hidden;
    const id = active ? pickAt(hover.x, hover.y) : null;
    const rect = container.getBoundingClientRect();
    renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
    for (const { b, element } of labels) {
      if (!element) continue;
      const visible = id === b.id;
      element.style.visibility = visible ? 'visible' : 'hidden';
      if (visible) {
        const p = labelPosition(
          { x: hover.x - rect.left, y: hover.y - rect.top },
          { width: element.offsetWidth, height: element.offsetHeight },
          { width, height },
        );
        element.style.transform =
          'translate(' + Math.round(p.x) + 'px,' + Math.round(p.y) + 'px)';
      }
    }
  }
  renderer.domElement.addEventListener('pointerdown', down);
  renderer.domElement.addEventListener('pointerup', up);
  renderer.domElement.addEventListener('pointermove', move);
  renderer.domElement.addEventListener('pointerleave', leave);
  renderer.domElement.addEventListener('pointercancel', leave);
  window.addEventListener('blur', leave);
  document.addEventListener('visibilitychange', leave);
  function frame(now: number) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    if (document.hidden || !inViewport) return;
    const blend = reduced ? 1 : 1 - Math.exp(-dt * 5.5);
    if (!paused) time += dt;
    if (Math.abs(targetYaw - yaw) > 0.0001) {
      yaw += shortestAngle(yaw, targetYaw) * blend;
      align();
    }
    if (tween) {
      controls.target.lerp(target, blend);
      camera.zoom = T.MathUtils.lerp(camera.zoom, targetZoom, blend);
      align();
      if (
        controls.target.distanceTo(target) < 0.002 &&
        Math.abs(camera.zoom - targetZoom) < 0.001
      )
        tween = false;
    }
    controls.update();
    details.update(camera, height, now, !!inspect || tween);
    night = T.MathUtils.lerp(night, targetNight, reduced ? 1 : blend * 0.45);
    model.materialLibrary.setNight(night);
    lighting.update(night, !!inspect);
    for (const m of inspectionMaterials)
      if (
        m instanceof T.MeshStandardMaterial &&
        m.userData.surfaceKind === 'glass'
      )
        m.emissiveIntensity = night * 0.72;
    sky.intensity = T.MathUtils.lerp(1.65, 0.42, night);
    sun.intensity = T.MathUtils.lerp(3.3, 0.45, night);
    sun.color.set('#fff1d6').lerp(new T.Color('#8daed0'), night);
    lamps.forEach(
      (l) =>
        ((l.material as T.MeshStandardMaterial).emissiveIntensity =
          night * 2.7),
    );
    if (inspect) {
      openAmount = reduced
        ? interior
          ? 1
          : 0
        : T.MathUtils.lerp(openAmount, interior ? 1 : 0, blend * 0.75);
      const b = buildings.find((b) => b.id === inspectId)!;
      const roof = inspect.children[2];
      if (inspectId === 'lius-gate' && inspectionAutoFit) {
        const fit = fitStudy(
          inspect.userData.exteriorBounds,
          camera,
          width / height,
        );
        target.copy(inspect.position).add(fit.focus);
        targetZoom = fit.zoom;
        tween = true;
      }
      if (inspectId !== 'lius-gate') {
        const dock = roofDock(
          inspect.userData.bodyBounds,
          inspect.userData.roofBounds,
          camera,
          width / height,
        );
        roof.position.copy(dock.offset).multiplyScalar(openAmount);
        roof.scale.setScalar(1 + (dock.scale - 1) * openAmount);
        roof.visible = dock.visible || openAmount < 0.015;
        if (inspectionAutoFit) {
          const outer = fitStudy(
            inspect.userData.exteriorBounds,
            camera,
            width / height,
          );
          target
            .copy(inspect.position)
            .add(outer.focus.lerp(dock.focus, openAmount));
          targetZoom = T.MathUtils.lerp(outer.zoom, dock.zoom, openAmount);
          tween = true;
        }
      }
      sectionPlane.constant = T.MathUtils.lerp(b.height + 3, 0.32, openAmount);
    }
    const previousPeople = walkerStates.map((w) => [w.x, w.z]);
    stepCrowd(walkerStates, dt, paused);
    walkerStates.forEach((w, i) => {
      animateResident(
        walkers[i],
        Math.hypot(w.x - previousPeople[i][0], w.z - previousPeople[i][1]),
        dt,
        paused,
      );
      walkers[i].position.set(
        w.x,
        groundHeightAt(w.x, w.z) - walkers[i].userData.sole,
        w.z,
      );
      walkers[i].rotation.y = w.heading;
    });
    const nextVehicle = samplePath(
      loop,
      (trafficDistance + dt * 0.65) % loopLength,
    );
    const yieldToPeople = walkerStates.some(
      (w) => Math.hypot(w.x - nextVehicle.x, w.z - nextVehicle.z) < 1.6,
    );
    if (!paused && !yieldToPeople)
      trafficDistance = (trafficDistance + dt * 0.65) % loopLength;
    const vehicle = samplePath(loop, trafficDistance);
    tram.position.set(vehicle.x, grades.road, vehicle.z);
    tram.rotation.y = vehicle.heading - Math.PI / 2;
    const boat = boatPose(time);
    ferry.position.set(boat.x, boat.y, boat.z);
    ferry.rotation.y = boat.heading;
    jibs.forEach((jib, i) => {
      jib.rotation.y = Math.sin(time * 0.08 + i * 1.7) * 0.42;
    });
    model.water?.update(time, night, camera);
    updateHover();
    ink.setSelection(
      inspect
        ? []
        : parkSelected
          ? city.children[0].children.filter((g) => g.userData.parkSelection)
          : focusedIds.map((id) => models.get(id)!.root),
    );
    ink.render();
  }
  raf = requestAnimationFrame(frame);
  return {
    select,
    enter(id) {
      exitInspection();
      details.ensure(id);
      const m = models.get(id)!;
      inspect = m.root.clone(true);
      m.root.getWorldPosition(inspect.position);
      m.root.updateMatrixWorld(true);
      const inverse = m.root.matrixWorld.clone().invert();
      inspect.userData.bodyBounds = new T.Box3()
        .setFromObject(m.interior)
        .applyMatrix4(inverse);
      inspect.userData.roofBounds = new T.Box3()
        .setFromObject(m.roof)
        .applyMatrix4(inverse);
      inspect.userData.exteriorBounds = new T.Box3()
        .setFromObject(m.root)
        .applyMatrix4(inverse);
      inspectionAutoFit = true;
      if (id !== 'lius-gate')
        inspect.children[1].traverse((o) => {
          if (o instanceof T.Mesh) {
            const copy = (original: T.Material) => {
              const mat = original.clone();
              mat.clippingPlanes = [sectionPlane];
              mat.clipShadows = true;
              inspectionMaterials.push(mat);
              return mat;
            };
            o.material = Array.isArray(o.material)
              ? o.material.map(copy)
              : copy(o.material);
          }
        });
      sectionPlane.constant = 100;
      scene.add(inspect);
      const studyBounds = new T.Box3().setFromObject(inspect);
      const studySize = studyBounds.getSize(new T.Vector3());
      shadowFocus(
        studyBounds.getCenter(new T.Vector3()),
        Math.max(7, studySize.length() * 0.85),
      );
      inspectId = id;
      controls.maxZoom = 8;
      city.visible = false;
      smoke.visible = false;
      zones.visible = false;
      grid.visible = false;
      highlight.visible = false;
      const fit = fitStudy(
        inspect.userData.exteriorBounds,
        camera,
        width / height,
      );
      target.copy(inspect.position).add(fit.focus);
      targetZoom = fit.zoom;
      tween = true;
    },
    setInterior(v) {
      interior = v;
      inspectionAutoFit = true;
    },
    reset,
    rotate() {
      targetYaw += Math.PI / 2;
      inspectionAutoFit = true;
    },
    zoom(f) {
      inspectionAutoFit = false;
      targetZoom = T.MathUtils.clamp(camera.zoom * f, 0.7, inspect ? 8 : 4);
      target.copy(controls.target);
      tween = true;
    },
    setNight(v) {
      targetNight = v ? 1 : 0;
    },
    setGrid(v) {
      gridEnabled = v;
      grid.visible = v && !inspect;
    },
    setPaused(v) {
      paused = v;
    },
    setPlan(v) {
      plan = v;
      zones.visible = v;
      if (v) reset();
    },
    focusBuildings,
    focusDistrict(id) {
      exitInspection();
      const d = districts.find((d) => d.id === id)!;
      target.set(d.center[0], 0, d.center[1]);
      targetZoom = 1.3;
      tween = true;
      zones.children.forEach(
        (o) =>
          ((
            o as T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>
          ).material.opacity = o.userData.district === id ? 0.35 : 0.09),
      );
    },
    focusPark() {
      exitInspection();
      focusedIds = [];
      parkSelected = true;
      autoFocus = false;
      highlight.visible = false;
      target.set(-10.65, 0, 9.95);
      targetZoom = 2.3;
      tween = true;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      exitInspection();
      observer.disconnect();
      visibilityObserver.disconnect();
      renderer.domElement.removeEventListener('wheel', wheelIntent, true);
      renderer.domElement.removeEventListener('pointerdown', touchIntent, true);
      controls.removeEventListener('start', cancel);
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', down);
      renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointerleave', leave);
      renderer.domElement.removeEventListener('pointercancel', leave);
      window.removeEventListener('blur', leave);
      document.removeEventListener('visibilitychange', leave);
      const geos = new Set<T.BufferGeometry>(),
        mats = new Set<T.Material>();
      scene.traverse((o) => {
        if (o instanceof T.Mesh || o instanceof T.Line) {
          geos.add(o.geometry);
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
            mats.add(m),
          );
        }
      });
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      details.dispose();
      lighting.dispose();
      model.water?.dispose();
      ink.dispose();
      model.disposeMaterials();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
