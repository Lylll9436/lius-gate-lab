import * as T from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SurfaceKind } from './city-materials';
import * as plan from './town-plan';
import { palette, hash, noise2, WATER, type TownContext } from './town-shared';
import { shoreHeight } from './town-ground';
import type { Kit, Piece } from './town-kit';
import type { Nature } from './town-nature';
import type { Props } from './town-props';

/**
 * The airport's colours, each no more saturated than its palette family: the cool greys of the
 * quarried armour (two of its six dark, so about a stone in three is), all a step under the
 * coping's kerb stone, and the darker rubble under it; the coping's and the parapets' kerb stone,
 * the runway's and the taxiway's dark matte concrete (the runway a step darker and cooler than the
 * town's asphalt, so it never reads as another road), the apron's mid-grey concrete and its bay
 * joints a step darker (the tones of the placement boxes the owner approved), the cream threshold
 * paint, the muted ochre lead-in line; the hall's cream render (the tram's) with blonde sandstone
 * dressings and its render's rustication a shade deeper, under a verdigris roof (the Town Hall's
 * copper) with ribs of the lighter copper; its paintwork in the tram's green; the board's dark
 * slate and its tiles, dark umber glass that glows amber at night; dark iron; the jet bridge's
 * light steel, dark rubber bellows and concrete footing; the hangar's light grey cladding (the
 * placement box's) and its doors' lighter green, and the windsock's white mast.
 */
export const AIRPORT_LOOK = {
  armour: ['#8b8c85', '#7f847f', '#97958a', '#868478', '#737874', '#6a6f6c'],
  rubble: '#72736c',
  coping: palette.kerb,
  runway: '#4f5458',
  taxiway: '#5f6367',
  apron: '#aeaba3',
  /** The apron's bay joints: its own concrete, this much darker. */
  joint: 0.91,
  paint: palette.roadLine,
  leadIn: '#d4b25e',
  render: palette.tramCream,
  rustic: '#e6d6b2',
  dressing: palette.blonde,
  roof: palette.copper,
  rib: palette.copperLight,
  green: palette.tram,
  slate: '#2a2f32',
  tile: '#3d3830',
  /** The tiles' own night glow (city-materials' `glow`): with the beacon's warm tint, an amber. */
  glow: '#ffc456',
  iron: '#3d4547',
  steel: '#8e938e',
  rubber: '#727773',
  footing: '#b9b4a6',
  cladding: '#b9b6aa',
  /** The hangar's doors: the paintwork's green a step lighter and greyer, so their panels read in the gable's shade. */
  doors: '#46785c',
  mast: palette.white,
};
/** The hall lane's kerb radii where it meets the ring's footway, and the width of its flush edging. */
export const LANE_DRESSING = { radius: 0.5, edge: 0.1 };
/** The hall's levels (y): its floor on the plinth, the walls' top (the eaves) and the barrel roof's apex. */
export const HALL_LEVELS = { floor: 0.7, eave: 2.92, apex: 4.0 };
/**
 * The hall's dressings (y from, to): the moulded plinth course, two courses of banded rustication
 * over it, the sill band the windows stand on, the piers' capitals and the cornice under the
 * eaves' rolls.
 */
export const HALL_DRESSING = {
  course: [0.64, 0.78] as [number, number],
  rustic: [0.78, 1.2] as [number, number],
  sill: [1.2, 1.3] as [number, number],
  capital: [2.32, 2.48] as [number, number],
  cornice: [2.48, 2.66] as [number, number],
};
/**
 * Each runway threshold's paint, in from the runway's end (x) and across its centre line (z): a bar
 * across the runway (`bar`, `across` wide), then four keys along it (`key`, at `keys`, each `width`
 * wide) and a pair of aiming blocks (`aim`, at `aims`, `aimWidth` wide). The bar is what tells it
 * from a zebra crossing, which never has one, and the keys run longer than a zebra's stripes (1.8,
 * 0.3 wide on gaps of 0.25: the first four, 1.2 long and 0.25 wide on 0.2, read as one).
 */
export const THRESHOLD = {
  bar: [0.15, 0.45] as [number, number],
  across: 1.95,
  key: [0.6, 2.4] as [number, number],
  keys: [-0.825, -0.275, 0.275, 0.825],
  width: 0.3,
  aim: [3.0, 4.4] as [number, number],
  aims: [-0.5, 0.5],
  aimWidth: 0.3,
};
/** The island's edge, out from the deck's edge: the coping's outer face, and the armour's bed from there to its toe (o, y). */
const EDGE = { coping: 0.05, bed: [[0.03, 0.31], [0.92, -0.58]] as [number, number][] };

/** One point of a swept band: where it is, its outward normal (in x, z) and its base height. */
type Station = { x: number; z: number; nx: number; nz: number; y: number };

/* ------------------------------------------------------------------ */
/* The airport                                                         */
/* ------------------------------------------------------------------ */
export function createAirport(ctx: TownContext, kit: Kit, props: Props, nature: Nature) {
  const { material } = ctx;
  const { box, chamfered, cluster, frameRing, prism, lampGlass } = kit;
  const { lamp } = props;
  const { topiary } = nature;
  const A = plan.AIRPORT,
    R = plan.AIRPORT_ROAD,
    JET_BRIDGE = plan.JET_BRIDGE,
    L = AIRPORT_LOOK;

  /**
   * A band swept along `path`: at each station the profile's points, each `o` out along the
   * station's normal and `y` up from its base height, joined to the next station's by quads. A path
   * running clockwise seen from above (or south along the road, its normal east) with the profile
   * listed from inside to outside faces up and out. Smooth normals: a soft edge on every turn.
   */
  function sweep(path: Station[], profile: (s: Station) => [number, number][], closed = false) {
    const pos: number[] = [],
      index: number[] = [];
    let width = 0;
    for (const s of path) {
      const points = profile(s);
      width = points.length;
      for (const [o, y] of points) pos.push(s.x + s.nx * o, s.y + y, s.z + s.nz * o);
    }
    const count = closed ? path.length : path.length - 1;
    for (let k = 0; k < count; k++) {
      const a = k * width,
        b = ((k + 1) % path.length) * width;
      for (let j = 0; j + 1 < width; j++) index.push(a + j, b + j, a + j + 1, a + j + 1, b + j, b + j + 1);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
  }
  /** A mesh of `geometry` in the material (colour, kind), added to g. */
  function solid(g: T.Object3D, geometry: T.BufferGeometry, colour: string, kind: SurfaceKind, opts: { shadow?: boolean; ground?: boolean; band?: boolean; name?: string } = {}) {
    const m = new T.Mesh(geometry, material(colour, kind));
    m.castShadow = opts.shadow ?? true;
    m.receiveShadow = true;
    if (opts.shadow === false) m.userData.noShadow = true;
    if (opts.ground) m.userData.ground = true;
    if (opts.band) m.userData.band = true;
    if (opts.name) m.name = opts.name;
    g.add(m);
    return m;
  }
  /** A flat slab between two corners (ground-like: no bake, casts nothing). */
  function slab(g: T.Object3D, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, colour: string, kind: SurfaceKind) {
    const m = box(g, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, colour, kind, { bevel: 0 });
    m.castShadow = false;
    m.userData.noShadow = true;
    m.userData.ground = true;
    return m;
  }
  /**
   * The armour stones' shapes: an icosahedron with its corners merged, so a corner moved moves
   * every face round it (no cracks); the capstones' one step finer.
   */
  const STONE = [1, 2].map((detail) => mergeVertices(new T.IcosahedronGeometry(1, detail).deleteAttribute('normal').deleteAttribute('uv')));
  /**
   * An armour stone, quarried rather than rolled: the shape pushed part way toward a rounded block
   * (each stone its own squareness), each corner in or out by up to 8%, squashed (longest across
   * the slope's line, lowest upright), turned about y and tipped up to 0.25 either way. It shades
   * as the smooth rounded block (its normals are the block's, not the corners'), so no facet
   * shows. Pushed onto `list` at (x, y, z) in world space with its tone baked in: one of the
   * armour's greys a little lighter or darker, lighter toward its top, damp below the waterline.
   */
  function boulder(list: T.BufferGeometry[], x: number, y: number, z: number, r: number, seed: number, big = false) {
    const h = (k: number) => hash(seed * 7.31 + k * 1.913),
      geometry = STONE[big ? 1 : 0].clone(),
      p = geometry.getAttribute('position'),
      normals = new Float32Array(p.count * 3),
      n = new T.Vector3(),
      square = 0.3 + 0.35 * h(1);
    for (let i = 0; i < p.count; i++) {
      const ux = p.getX(i),
        uy = p.getY(i),
        uz = p.getZ(i),
        block = (ux ** 4 + uy ** 4 + uz ** 4) ** -0.25,
        k = (1 + square * (block - 1)) * (1 + 0.16 * (hash(seed * 31.7 + i * 3.17) - 0.5));
      p.setXYZ(i, ux * k, uy * k, uz * k);
      n.set(ux ** 3, uy ** 3, uz ** 3).normalize().multiplyScalar(square).add(new T.Vector3(ux, uy, uz).multiplyScalar(1 - square)).normalize().toArray(normals, i * 3);
    }
    geometry.setAttribute('normal', new T.BufferAttribute(normals, 3));
    const squash = new T.Vector3(r * (1.15 + 0.3 * h(2)), r * (0.62 + 0.2 * h(3)), r * (0.9 + 0.25 * h(4)));
    // (applyMatrix4 turns the normals with the stone, through its squash.)
    geometry.applyMatrix4(new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(0.5 * (h(5) - 0.5), h(6) * Math.PI * 2, 0.5 * (h(7) - 0.5), 'YXZ')), squash));
    const plain = geometry.toNonIndexed(),
      q = plain.getAttribute('position'),
      tint = new T.Color(L.armour[Math.floor(h(8) * L.armour.length) % L.armour.length]).multiplyScalar(0.9 + 0.16 * h(9)),
      tone = new Float32Array(q.count * 3);
    geometry.dispose();
    for (let i = 0; i < q.count; i++) {
      const py = q.getY(i),
        v = (0.88 + 0.16 * T.MathUtils.smoothstep(py, y - squash.y, y + squash.y)) * (1 - 0.18 * (1 - T.MathUtils.smoothstep(py, WATER - 0.09, WATER + 0.07)));
      tone.set([tint.r * v, tint.g * v, tint.b * v], i * 3);
    }
    plain.setAttribute('color', new T.BufferAttribute(tone, 3));
    list.push(plain);
    return plain;
  }
  /**
   * A course of stones along `path` (stations about 0.1 apart): uneven spacings (`step` give or
   * take 40%), the odd stone left out (`skip`) so the bed shows, each set a little up or down the
   * slope round its course's line (`f` of the way down the bed, give or take `spread`), and sized
   * 0.72 to 1.28 times `r`. `place` turns a station, a share down the bed and a size into a stone.
   */
  function course(path: Station[], step: number, skip: number, seed: number, place: (s: Station, f: number, size: number, seed: number) => void, f: number, spread: number, r: number) {
    let next = step * hash(seed),
      run = 0;
    path.forEach((s, i) => {
      if (i) run += Math.hypot(s.x - path[i - 1].x, s.z - path[i - 1].z);
      if (run < next) return;
      seed++;
      next = run + step * (0.6 + 0.8 * hash(seed * 5 + 4));
      if (hash(seed * 5 + 5) < skip) return;
      place(s, f + spread * 2 * (hash(seed * 5 + 1) - 0.5), r * (0.72 + 0.56 * hash(seed * 5 + 3)), seed);
    });
  }
  /** The beach or the sea bed under the causeway's line at z: the shore's profile out from the outline. */
  function bedAt(z: number) {
    const out = Math.hypot(R.x, z) - plan.islandRadius(Math.atan2(z, R.x));
    return out <= 0 ? plan.terrainHeight(R.x, z) : shoreHeight(out);
  }
  /** The open outline round the deck from the causeway's landing (stations at height 0). */
  const round = (offset: number, step: number, reach: number): Station[] => plan.airportOutlineRound(offset, step, reach).map((p) => ({ ...p, y: 0 }));

  /* ---------------------------------------------------------------- */
  /* The island: deck, coping, armour                                  */
  /* ---------------------------------------------------------------- */
  /** The deck's mown grass: a grid clipped to the outline 0.3 in (under the coping), toned as the island's lawns are. */
  function deckLawn(g: T.Object3D) {
    const inset = 0.3,
      hw = A.hw - inset,
      hd = A.hd - inset,
      r = A.radius - inset,
      geometry = new T.PlaneGeometry(2 * A.hw, 2 * A.hd, 48, 24).rotateX(-Math.PI / 2),
      p = geometry.getAttribute('position'),
      colours = new Float32Array(p.count * 3),
      lo = new T.Color('#98b74a'),
      hi = new T.Color('#aac757'),
      c = new T.Color();
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i),
        z = p.getZ(i);
      const qx = Math.abs(x) - (hw - r),
        qz = Math.abs(z) - (hd - r);
      if (qx > 0 && qz > 0 && Math.hypot(qx, qz) > r) {
        const l = Math.hypot(qx, qz);
        x = Math.sign(x) * (hw - r + (qx * r) / l);
        z = Math.sign(z) * (hd - r + (qz * r) / l);
      } else {
        x = T.MathUtils.clamp(x, -hw, hw);
        z = T.MathUtils.clamp(z, -hd, hd);
      }
      const wx = A.x + x,
        wz = A.z + z,
        n = noise2(wx * 0.07 + 5, wz * 0.07 + 3) * 0.6 + noise2(wx * 0.19 + 11, wz * 0.19 + 7) * 0.4;
      p.setXYZ(i, wx, A.deck, wz);
      c.copy(lo).lerp(hi, T.MathUtils.smoothstep(n, 0.3, 0.7)).toArray(colours, i * 3);
    }
    geometry.setAttribute('color', new T.BufferAttribute(colours, 3));
    solid(g, geometry, '#ffffff', 'grass', { shadow: false, ground: true, name: 'airport-deck' });
  }
  /** The coping, the armour's bed and its boulders (returned, to be merged with the causeway's). */
  function deckEdge(g: T.Object3D) {
    // The coping: a buff stone band 0.47 wide over the deck's edge, 0.075 proud of the grass, its
    // outer face down to the armour. A surface, not an overhang (band), so batch() leaves the
    // armour under it unshaded. It stops at the causeway's parapets.
    const coping = sweep(round(0, 0.4, R.top / 2), () => [[-0.42, 0.38], [-0.42, 0.45], [-0.39, 0.475], [0.0, 0.475], [EDGE.coping, 0.445], [EDGE.coping, 0.28]]);
    solid(g, coping, L.coping, 'stone', { band: true, name: 'airport-coping' });
    // The armour's bed: dark rubble from under the coping down into the sea, so no gap between the
    // boulders shows the sea bed. It meets the causeway's flanks where the causeway lands.
    solid(g, sweep(round(0, 0.4, R.top / 2 + 0.9), () => EDGE.bed), L.rubble, 'stone', { shadow: false, band: true, name: 'airport-armour-bed' });
    // The armour: two courses of quarried stones on that bed, the upper set back under the coping,
    // the lower at the waterline, overlapping, unevenly spaced and the odd one missing; and eight
    // big capstones, at the four corners, either side of where the causeway lands and two along
    // the north side, their tops about level with the coping.
    const rocks: T.BufferGeometry[] = [],
      [[o0, y0], [o1, y1]] = EDGE.bed,
      path = round(0, 0.1, R.top / 2 + 0.75),
      put = (p: Station, f: number, size: number, seed: number, big = false) => {
        const o = o0 + f * (o1 - o0),
          slide = 0.1 * (hash(seed * 5 + 2) - 0.5),
          stone = boulder(rocks, p.x + p.nx * o + slide * p.nz, y0 + f * (y1 - y0) + size * 0.3, p.z + p.nz * o - slide * p.nx, size, seed, big),
          at = stone.getAttribute('position');
        // A stone reaching past the armour's toe (A.armour, give or take 0.15) is drawn back up the slope.
        let reach = -Infinity;
        for (let i = 0; i < at.count; i++) reach = Math.max(reach, plan.airportDistance(at.getX(i), at.getZ(i)));
        const excess = reach - (A.armour + 0.15);
        if (excess > 0) stone.translate(-p.nx * excess, 0, -p.nz * excess);
      };
    course(path, 0.55, 0.1, 1, put, 0.2, 0.07, 0.25);
    course(path, 0.6, 0.04, 500, put, 0.52, 0.07, 0.3);
    const corner = (sx: number, sz: number): Station => {
      const a = Math.atan2(sz, sx);
      return { x: A.x + sx * (A.hw - A.radius) + Math.cos(a) * A.radius, z: A.z + sz * (A.hd - A.radius) + Math.sin(a) * A.radius, nx: Math.cos(a), nz: Math.sin(a), y: 0 };
    };
    const caps: Station[] = [
      ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => corner(sx, sz)),
      ...[-1, 1].map((s): Station => ({ x: R.x + s * (R.top / 2 + 0.95), z: A.z + A.hd, nx: 0, nz: 1, y: 0 })),
      ...[-4.2, 3.6].map((dx): Station => ({ x: A.x + dx, z: A.z - A.hd, nx: 0, nz: -1, y: 0 })),
    ];
    caps.forEach((p, k) => put(p, 0.34, 0.47 + 0.08 * hash(k * 3 + 0.5), 800 + k * 3, true));
    return rocks;
  }

  /* ---------------------------------------------------------------- */
  /* Airside and landside surfaces                                     */
  /* ---------------------------------------------------------------- */
  function surfaces(g: T.Object3D) {
    const { RUNWAY: RW, TAXIWAY: TW, APRON: AP, FORECOURT: FC, STAND } = plan,
      top = plan.AIRSIDE;
    // Runway 09/27, the taxiway and its two stubs: dark matte concrete slabs 0.03 proud of the grass,
    // ground-like (no contact bake) and never overlapping, so no two tops fight.
    slab(g, RW.x0, RW.x1, RW.z - RW.width / 2, RW.z + RW.width / 2, A.deck - 0.01, top, L.runway, 'stone');
    slab(g, TW.x0 - TW.width / 2, TW.x1 + TW.width / 2, TW.z - TW.width / 2, TW.z + TW.width / 2, A.deck - 0.01, top, L.taxiway, 'stone');
    for (const x of TW.stubs) slab(g, x - TW.width / 2, x + TW.width / 2, RW.z + RW.width / 2, TW.z - TW.width / 2, A.deck - 0.01, top, L.taxiway, 'stone');
    // The apron in plain concrete out to the taxiway's edge (the paving's flags made it read as a
    // town square), cast in four bays along it and two across, their joints 0.08 wide and a step
    // darker (the one across runs under the stand's lead-in line); the forecourt in the town's
    // pavement, a kerb's height up, inside the coping. The joints and the paint are flat sheets
    // laid on the concrete, with no sides to show as a dotted sliver at a slant.
    const flat = (along: number, across: number) => new T.PlaneGeometry(along, across).rotateX(-Math.PI / 2),
      apronZ0 = TW.z + TW.width / 2;
    slab(g, AP.x0, AP.x1, apronZ0, AP.z1, A.deck - 0.01, top, L.apron, 'stone');
    const joints: Piece[] = [],
      bay = (AP.x1 - AP.x0) / 4;
    for (let k = 1; k < 4; k++) joints.push({ geometry: flat(0.08, AP.z1 - apronZ0), at: [AP.x0 + k * bay, top + 0.002, (apronZ0 + AP.z1) / 2] });
    joints.push({ geometry: flat(AP.x1 - AP.x0, 0.08), at: [(AP.x0 + AP.x1) / 2, top + 0.002, (apronZ0 + AP.z1) / 2] });
    // In the apron's own material (so they batch with it), darkened by their vertex colour.
    const jointMesh = cluster(g, joints, L.apron, 'stone', { shadow: false });
    if (jointMesh) {
      jointMesh.userData.ground = true;
      const count = jointMesh.geometry.getAttribute('position').count;
      jointMesh.geometry.setAttribute('color', new T.BufferAttribute(new Float32Array(count * 3).fill(L.joint), 3));
    }
    slab(g, FC.x0, FC.x1, FC.z0, FC.z1 - 0.4, A.deck - 0.02, A.deck + 0.06, palette.pavement, 'paving');
    // Markings, never under 0.25 wide (THRESHOLD): at each threshold a bar across the runway, four
    // keys along it either side of its centre line, then a pair of broad aiming blocks; no
    // centre-line dashes, no numbers. On the apron the stand's lead-in line, ending at the parked
    // plane's nose.
    const paint: Piece[] = [],
      y = top + 0.004,
      TH = THRESHOLD;
    for (const end of [-1, 1]) {
      const from = end < 0 ? RW.x0 : RW.x1,
        bar = ([a, b]: [number, number], c: number, width: number) => {
          const [x0, x1] = [from - end * a, from - end * b].sort((p, q) => p - q);
          paint.push({ geometry: flat(x1 - x0, width), at: [(x0 + x1) / 2, y, RW.z + c] });
        };
      bar(TH.bar, 0, TH.across);
      for (const c of TH.keys) bar(TH.key, c, TH.width);
      for (const c of TH.aims) bar(TH.aim, c, TH.aimWidth);
    }
    const lead0 = AP.x0 + 1.6,
      lead1 = STAND.x + 1.8;
    for (const [pieces, colour] of [
      [paint, L.paint],
      [[{ geometry: flat(lead1 - lead0, 0.25), at: [(lead0 + lead1) / 2, y, STAND.z] }], L.leadIn],
    ] as [Piece[], string][]) {
      const m = cluster(g, pieces, colour, 'paint', { shadow: false });
      if (m) m.userData.ground = true;
    }
    [...joints, ...paint].forEach((p) => p.geometry.dispose());
  }

  /* ---------------------------------------------------------------- */
  /* The road: hall lane, beach ramp, causeway                         */
  /* ---------------------------------------------------------------- */
  /** Where the causeway's surfaces end on the deck: the coping's inner edge, where the forecourt begins. */
  const landingZ = plan.FORECOURT.z1 - 0.4;
  /** The road's z stations, from the lane's start to the forecourt's kerb (finer on the ramp). */
  function roadStations() {
    const zs: number[] = [];
    for (let z = R.lane; z > R.beach + 1e-6; z -= 0.5) zs.push(z);
    for (let z = R.beach; z > R.causeway + 1e-6; z -= 0.2) zs.push(z);
    for (let z = R.causeway; z > landingZ + 1e-6; z -= 0.5) zs.push(z);
    zs.push(landingZ);
    return zs;
  }
  /**
   * The asphalt: one ribbon 1.7 wide from the lane's start to the forecourt, on the road's bed
   * (plan.airportRoadTop) at the road's level, its end tucked under the forecourt's edge. Its uv is
   * the road's own (across, along), along from 4000 (its place in plan.ROADS), so the road shader
   * draws only the gutters' faint wear on it.
   */
  function asphalt(g: T.Object3D) {
    const half = plan.ROAD_WIDTH / 2,
      base = new T.Color(palette.road),
      pos: number[] = [],
      col: number[] = [],
      uv: number[] = [],
      index: number[] = [],
      zs = [...roadStations(), landingZ - 0.05];
    zs.forEach((z, k) => {
      const y = plan.airportRoadTop(z) + plan.levels.road,
        along = 1000 * plan.ROADS.indexOf('airport') + (R.lane - z),
        c = base.clone().multiplyScalar(0.985 + 0.03 * noise2(R.x * 0.8, z * 0.8));
      pos.push(R.x + half, y, z, R.x - half, y, z);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      uv.push(half, along, -half, along);
      if (k) {
        const a = (k - 1) * 2;
        index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    });
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    geometry.userData.longitudinalUV = true;
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    solid(g, geometry, '#ffffff', 'asphalt', { shadow: false, ground: true, name: 'airport-road' });
  }
  /**
   * The hall lane's dressing, flat on the ground: at its mouth the asphalt turns into the ring's
   * footway on two kerb radii (`LANE_DRESSING.radius`), and an edging of the town's paving (its
   * flags read as kerb stones) runs flush along both its edges, `edge` wide, from the footway round
   * the radii to where the causeway's footways begin. The radii's asphalt carries the road's uv
   * (across held at the carriageway's edge), so it batches into the road's one mesh.
   */
  function laneDressing(g: T.Object3D) {
    const { radius, edge } = LANE_DRESSING,
      half = plan.ROAD_WIDTH / 2,
      y = plan.levels.road,
      base = 1000 * plan.ROADS.indexOf('airport'),
      end = R.beach - 0.15,
      road = new T.Color(palette.road),
      fill = { pos: [] as number[], col: [] as number[], uv: [] as number[] },
      strip: number[] = [],
      steps = 8;
    for (const side of [-1, 1]) {
      const cx = R.x + side * (half + radius),
        cz = R.lane - radius,
        at = (k: number, r: number) => {
          const a = Math.PI / 2 + (side * Math.PI * k) / (2 * steps);
          return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
        };
      // The radius: a fan from the corner of the lane's edge and the footway's to the arc.
      const vertex = (x: number, z: number) => {
        fill.pos.push(x, y, z);
        fill.col.push(road.r, road.g, road.b);
        fill.uv.push(side * half, base + (R.lane - z));
      };
      for (let k = 0; k < steps; k++) {
        const [x0, z0] = at(k, radius),
          [x1, z1] = at(k + 1, radius);
        // Wound to face up from either side.
        if (side > 0) [[R.x + half, R.lane], [x0, z0], [x1, z1]].forEach(([x, z]) => vertex(x, z));
        else [[R.x - half, R.lane], [x1, z1], [x0, z0]].forEach(([x, z]) => vertex(x, z));
      }
      // The edging: round the radius on its grass side, then down the lane's edge to the causeway.
      const inner: number[][] = [],
        outer: number[][] = [];
      for (let k = 0; k <= steps; k++) {
        inner.push(at(k, radius));
        outer.push(at(k, radius - edge));
      }
      for (let z = cz - 0.5; z > end + 1e-6; z -= 0.5) {
        inner.push([R.x + side * half, z]);
        outer.push([R.x + side * (half + edge), z]);
      }
      inner.push([R.x + side * half, end]);
      outer.push([R.x + side * (half + edge), end]);
      for (let k = 0; k + 1 < inner.length; k++) {
        const quad = [inner[k], outer[k], outer[k + 1], inner[k], outer[k + 1], inner[k + 1]];
        for (const [x, z] of side > 0 ? quad : [quad[0], quad[2], quad[1], quad[3], quad[5], quad[4]]) strip.push(x, y + 0.003, z);
      }
    }
    const radii = new T.BufferGeometry();
    radii.setAttribute('position', new T.Float32BufferAttribute(fill.pos, 3));
    radii.setAttribute('color', new T.Float32BufferAttribute(fill.col, 3));
    radii.setAttribute('uv', new T.Float32BufferAttribute(fill.uv, 2));
    radii.userData.longitudinalUV = true;
    radii.computeVertexNormals();
    solid(g, radii, '#ffffff', 'asphalt', { shadow: false, ground: true, name: 'airport-lane-radii' });
    const edging = new T.BufferGeometry();
    edging.setAttribute('position', new T.Float32BufferAttribute(strip, 3));
    edging.computeVertexNormals();
    solid(g, edging, palette.pavement, 'paving', { shadow: false, ground: true, name: 'airport-lane-edging' });
  }
  /**
   * A town lamp whose head (above the post's boss: the ladder bar and the lantern's tray, roof and
   * cap, but for the brass finial) casts no shadow, only its post: the causeway's lamps stand where
   * the heads' shadows read as something else (four in a row threw chevrons that read as arrows
   * painted on the road).
   */
  function quietHead(post: T.Object3D) {
    post.traverse((o) => {
      if (!(o instanceof T.Mesh) || !o.castShadow || (o.material as T.Material).userData.surfaceKind === 'brass') return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      if (o.geometry.boundingBox!.min.y > 1.0) {
        o.castShadow = false;
        o.userData.noShadow = true;
      }
    });
    return post;
  }
  /**
   * The ramp and the causeway: a rubble-mound embankment 2.5 wide on top, from the beach to the
   * island. Footways 0.24 wide either side of the road, a buff parapet 0.16 thick along each edge,
   * and rock flanks (plan.AIRPORT_ROAD.flank) down to the beach or the sea bed, faced with boulders.
   * Piers stand in the parapets at both ends and under the four lamps on the east side.
   */
  function causeway(g: T.Object3D, rocks: T.BufferGeometry[]) {
    const from = R.beach - 0.15,
      half = R.top / 2,
      walk = plan.ROAD_WIDTH / 2 + 0.24,
      mid = (half + walk) / 2, // the parapet's middle: the piers' and the lamps' line
      // Southward (the normal east), so profiles listed west to east face up and out.
      path: Station[] = [from, ...roadStations().filter((z) => z < from - 1e-6)].reverse().map((z) => ({ x: R.x, z, nx: 1, nz: 0, y: plan.airportRoadTop(z) })),
      toe = (s: Station) => Math.min(bedAt(s.z) - 0.05, -0.06),
      reach = (s: Station) => half + (s.y - 0.03 - toe(s)) * R.flank;
    // The flanks' rubble, from under the parapets down to the toe on each side.
    solid(g, sweep(path, (s) => [[-reach(s), toe(s) - s.y], [-half + 0.02, -0.03], [half - 0.02, -0.03], [reach(s), toe(s) - s.y]]), L.rubble, 'stone', { shadow: false, band: true, name: 'airport-causeway-bed' });
    // Footways in the town's pavement, 0.04 over the road (a kerb face to it).
    const edge = plan.ROAD_WIDTH / 2;
    for (const side of [-1, 1]) {
      const prof = (): [number, number][] => (side < 0 ? [[-walk - 0.02, 0.06], [-edge, 0.06], [-edge, 0.0]] : [[edge, 0.0], [edge, 0.06], [walk + 0.02, 0.06]]);
      solid(g, sweep(path, prof), palette.pavement, 'paving', { shadow: false, ground: true });
    }
    // Parapets: a buff kerb wall 0.16 thick standing 0.26 over the footway, rounded on top, its outer
    // face down into the flank.
    for (const side of [-1, 1]) {
      const prof = (): [number, number][] =>
        side < 0
          ? [[-half, -0.12], [-half, 0.29], [-half + 0.03, 0.32], [-walk - 0.03, 0.32], [-walk, 0.29], [-walk, 0.05]]
          : [[walk, 0.05], [walk, 0.29], [walk + 0.03, 0.32], [half - 0.03, 0.32], [half, 0.29], [half, -0.12]];
      solid(g, sweep(path, prof), L.coping, 'stone', { band: true, name: 'airport-parapet' });
    }
    // Piers, square and a little proud of the parapet both ways, capped: at each end on both sides,
    // and under the four lamps on the east side.
    const stone: Piece[] = [],
      caps: Piece[] = [],
      lampsAt = [-31.4, -35.2, -39.0, -42.0],
      piers: [number, number][] = [...[-1, 1].flatMap((s): [number, number][] => [[s, from + 0.05], [s, landingZ + 0.12]]), ...lampsAt.map((z): [number, number] => [1, z])];
    for (const [side, z] of piers) {
      const x = R.x + side * mid,
        y = plan.airportRoadTop(z);
      stone.push({ geometry: chamfered(0.36, 0.56, 0.36), at: [x, y + 0.14, z] });
      caps.push({ geometry: chamfered(0.44, 0.08, 0.44), at: [x, y + 0.46, z] });
    }
    cluster(g, stone, L.coping, 'stone', { band: false });
    cluster(g, caps, L.dressing, 'stone', { band: false });
    // The causeway's lamps: the town's cast-iron standard, a little shorter, on the east piers.
    // Their heads (the ladder bar, the lantern's tray, roof and cap) cast no shadow: four in a row
    // threw a row of chevrons along the road that read as painted arrows pointing at the airport.
    // The key light turns with the camera and throws shadows to the right of the frame, so from the
    // east parapet even the posts' thin shadows fall on the flank and the sea in the opening view
    // and the airport's chapter.
    for (const z of lampsAt) quietHead(lamp(g, R.x + mid, z, 1.6, plan.airportRoadTop(z) + 0.5));
    // Stones on both flanks in two overlapping courses like the island's, smaller where the ramp is
    // low, up to the island's own armour.
    const flank: Station[] = [];
    for (let z = from - 0.3; z > A.z + A.hd + 0.25; z -= 0.1) flank.push({ x: R.x, z, nx: 1, nz: 0, y: plan.airportRoadTop(z) });
    for (const side of [-1, 1])
      for (const [f0, r0, step, skip, seed] of [[0.22, 0.24, 0.55, 0.08, 1000 + side * 300], [0.56, 0.29, 0.6, 0.04, 2000 + side * 300]] as const)
        course(flank, step, skip, seed, (s, f, size, k) => {
          const drop = s.y - 0.03 - toe(s);
          if (drop * (1 - f) < 0.06) return;
          const r = size * T.MathUtils.clamp(drop / 0.9, 0.45, 1),
            o = half + f * (reach(s) - half);
          boulder(rocks, R.x + side * o, s.y - 0.03 - f * drop + r * 0.3, s.z + 0.08 * (hash(k * 7 + 3) - 0.5), r, k);
        }, f0, 0.07, r0);
  }

  /* ---------------------------------------------------------------- */
  /* The hangar, the windsock and the forecourt's furniture            */
  /* ---------------------------------------------------------------- */
  /**
   * The hangar west of the apron (plan.HANGAR: 3.0 along x, 4.4 across, its ribs' crowns 2.4 over
   * the deck), the hall's working sibling: a stone plinth course; walls of light grey cladding
   * between blonde piers (one at each corner and one under each rib), a blonde cornice under the
   * eaves; a verdigris barrel roof (the hall's copper) with a bull-nosed roll along each eave,
   * ribbed in the lighter copper (a broad rib on each verge). To the apron (east) the gable's
   * arched doorway, 3.0 wide, framed by blonde jambs and imposts and an archivolt rising to just
   * under the roof's edge, closed by four green leaves under an arched head (their stiles and rails
   * proud, handles where the middle two meet); across the west gable, to the sea, the cornice
   * carried round and an archivolt under the roof's edge, as on the hall's gables. In the south wall
   * a green door for people, on a step. A concrete pad runs from under the doors to the apron. All
   * of it stands inside its plan (the overview frames the hangar by it) and on y 0, like the hall's
   * plinth. No glass, no lettering.
   */
  function hangar(g: T.Group) {
    const H = plan.HANGAR,
      h = new T.Group(),
      len = H.x1 - H.x0,
      half = (H.z1 - H.z0) / 2,
      wall = half - 0.2, // the side walls' faces (z), under the eaves
      gable = len / 2 - 0.12, // the gables' faces (x), under the verges
      roll = 0.09, // the eaves' rolls, out to the plan's edge
      edge = half - roll + 0.03, // the barrel's edges (z)
      eave = 1.22, // the barrel's outer edge (y)
      crown = H.top - 0.055, // the barrel's crown, the ribs' under them
      rise = crown - eave,
      Ro = (edge * edge + rise * rise) / (2 * rise),
      yc = crown - Ro,
      Ri = Ro - 0.12,
      spread = Math.asin(edge / Ro),
      under = (z: number) => yc + Math.sqrt(Math.max(0, Ri * Ri - z * z)), // the vault's underside over z
      // The doorway: straight jambs to its springing, then an arch about the vault's own axis, its
      // archivolt between the arch and the roof's edge.
      door = { half: 1.5, arch: Ri - 0.14 },
      spring = yc + Math.sqrt(door.arch * door.arch - door.half * door.half),
      springAngle = Math.atan2(spring - yc, door.half),
      archY = (z: number) => yc + Math.sqrt(Math.max(0, door.arch * door.arch - z * z)),
      foot = 0.18, // the plinth course's top
      cornice = [0.92, 1.02];
    h.name = 'airport-hangar';
    h.position.set((H.x0 + H.x1) / 2, A.deck, (H.z0 + H.z1) / 2);
    g.add(h);
    const stone: Part[] = [], // blonde dressings
      plinth: Part[] = [],
      cladding: Part[] = [],
      green: Part[] = [],
      ribs: Part[] = [],
      iron: Part[] = [];
    /** A chamfered block between two corners in the hangar's plan. */
    const block = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Part => ({
      geometry: chamfered(x1 - x0, y1 - y0, z1 - z0),
      matrix: placed((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
    });
    // The walls: the two gables (their heads under the vault, the east one open for the doors) and
    // the side walls between them, up into the roof.
    /** The doorway's outline from its foot at -door.half round its arch to door.half (z, y). */
    const doorway = (s: T.Path) => {
      s.lineTo(-door.half, spring);
      s.absarc(0, yc, door.arch, Math.PI - springAngle, springAngle, true);
      s.lineTo(door.half, 0);
    };
    const gableShape = (open: boolean) => {
      const s = new T.Shape(),
        head = under(wall);
      s.moveTo(-wall, 0);
      if (open) {
        s.lineTo(-door.half, 0);
        doorway(s);
      }
      s.lineTo(wall, 0);
      s.lineTo(wall, head);
      s.absarc(0, yc, Ri, Math.atan2(head - yc, wall), Math.atan2(head - yc, -wall), false);
      s.closePath();
      return s;
    };
    for (const [open, x] of [[true, gable - 0.2], [false, -gable]] as const)
      cladding.push({ geometry: new T.ExtrudeGeometry(gableShape(open), { depth: 0.2, bevelEnabled: false, curveSegments: 24 }), matrix: placed(x, 0, 0, 0, Math.PI / 2, 0) });
    for (const s of [-1, 1]) cladding.push(block(-gable + 0.2, gable - 0.2, 0, under(wall) + 0.02, s > 0 ? wall - 0.2 : -wall, s > 0 ? wall : -wall + 0.2));
    // The plinth course, 0.08 proud, round the walls but for the doorway and the south door: the
    // side walls' runs end to end, the gables' between them.
    const p = 0.08,
      jamb = 0.2, // the doorway's jambs, as wide as the archivolt at its springing
      side = { x: 0.6, half: 0.22 }; // the south door's middle and its frame's half-width
    plinth.push(
      block(-gable - p, gable + p, 0, foot, -wall - p, -wall + 0.1),
      block(-gable - p, side.x - side.half, 0, foot, wall - 0.1, wall + p),
      block(side.x + side.half, gable + p, 0, foot, wall - 0.1, wall + p),
      block(-gable - p, -gable + 0.1, 0, foot, -wall + 0.1, wall - 0.1),
    );
    for (const s of [-1, 1]) plinth.push(block(gable - 0.1, gable + p, 0, foot, s > 0 ? door.half + jamb : -wall + 0.1, s > 0 ? wall - 0.1 : -door.half - jamb));
    // Piers: one at each corner (0.06 proud of both faces) and one under each rib along the side
    // walls; a cornice along the side walls under the eaves' rolls.
    const ribX = [-0.9, -0.3, 0.3, 0.9];
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const [x0, x1] = sx > 0 ? [gable - 0.22, gable + 0.06] : [-gable - 0.06, -gable + 0.22],
          [z0, z1] = sz > 0 ? [wall - 0.22, wall + 0.06] : [-wall - 0.06, -wall + 0.22];
        stone.push(block(x0, x1, foot - 0.01, cornice[0], z0, z1));
      }
    for (const sz of [-1, 1]) {
      const [z0, z1] = sz > 0 ? [wall - 0.02, wall + 0.06] : [-wall - 0.06, -wall + 0.02];
      for (const x of ribX) stone.push(block(x - 0.08, x + 0.08, foot - 0.01, cornice[0], z0, z1));
      stone.push(block(-gable - 0.06, gable + 0.06, cornice[0], cornice[1], sz > 0 ? wall - 0.02 : -wall - 0.07, sz > 0 ? wall + 0.07 : -wall + 0.02));
    }
    // The west gable, to the sea: the cornice carried across it between the corners, and an
    // archivolt from eave to eave under the roof's edge, as the hall's gables have.
    stone.push(
      block(-gable - 0.06, -gable + 0.02, cornice[0], cornice[1], -wall + 0.02, wall - 0.02),
      { geometry: prism(arcBand(Ri - 0.14, Ri - 0.005, Math.atan2(under(wall) - yc, wall), Math.PI - Math.atan2(under(wall) - yc, wall), 20), 0.08, 0.02, 0), matrix: placed(-gable, yc, 0, 0, -Math.PI / 2, 0) },
    );
    // The roof: the barrel shell from verge to verge, a bull-nosed roll along each eave, its ribs
    // over the standing seams (one over each pier) and a broader one on each verge, all reaching
    // the crown's 2.4 and no further.
    {
      const b = Math.asin(edge / Ri),
        s = new T.Shape();
      s.absarc(0, yc, Ro, Math.PI / 2 + spread, Math.PI / 2 - spread, true);
      s.absarc(0, yc, Ri, Math.PI / 2 - b, Math.PI / 2 + b, false);
      s.closePath();
      const shell = new T.Mesh(
        new T.ExtrudeGeometry(s, { depth: len - 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelOffset: -0.03, bevelSegments: 2, curveSegments: 24 })
          .rotateY(Math.PI / 2)
          .translate(-len / 2 + 0.03, 0, 0),
        material(L.roof, 'copper'),
      );
      shell.castShadow = shell.receiveShadow = true;
      shell.userData.roof = true;
      shell.userData.eaveY = under(wall); // the side walls' head
      h.add(shell);
      const low = yc + Ri * Math.cos(b),
        high = yc + Ro * Math.cos(spread);
      for (const sz of [-1, 1]) {
        const r = new T.Mesh(new T.CylinderGeometry(roll, roll, len, 16).rotateZ(Math.PI / 2), material(L.roof, 'copper'));
        r.position.set(0, (low + high) / 2, sz * (edge - 0.03));
        r.castShadow = r.receiveShadow = true;
        r.userData.band = true;
        h.add(r);
      }
      const rib = (x: number, wide: number) =>
        ribs.push({ geometry: prism(arcBand(Ro - 0.03, Ro + 0.055, Math.PI / 2 - spread + 0.05, Math.PI / 2 + spread - 0.05, 24), wide, 0.02, -wide / 2), matrix: placed(x, yc, 0, 0, Math.PI / 2, 0) });
      for (const x of ribX) rib(x, 0.1);
      for (const sx of [-1, 1]) rib(sx * (len / 2 - 0.065), 0.13);
    }
    // The doorway: blonde jambs on the gable's face either side, an impost on each, and the
    // archivolt from impost to impost round the arch, up to just under the roof's edge. In it four
    // green leaves under the arched head, set 0.08 back from the face, their stiles (to the arch)
    // and rails 0.03 proud of them, a rail round the head, and handles where the middle two meet.
    {
      for (const s of [-1, 1]) {
        const [z0, z1] = s > 0 ? [door.half, door.half + jamb] : [-door.half - jamb, -door.half];
        stone.push(block(gable, gable + 0.07, 0, spring - 0.08, z0, z1), block(gable, gable + 0.09, spring - 0.08, spring, z0 - 0.03, z1 + 0.03));
      }
      stone.push({ geometry: prism(arcBand(door.arch, Ri - 0.005, springAngle, Math.PI - springAngle, 24), 0.08, 0.02, 0), matrix: placed(gable, yc, 0, 0, Math.PI / 2, 0) });
      const leaves = new T.Shape(),
        face = gable - 0.08;
      leaves.moveTo(-door.half, 0);
      leaves.lineTo(door.half, 0);
      leaves.lineTo(door.half, spring);
      leaves.absarc(0, yc, door.arch, springAngle, Math.PI - springAngle, false);
      leaves.closePath();
      green.push({ geometry: new T.ExtrudeGeometry(leaves, { depth: 0.06, bevelEnabled: false, curveSegments: 24 }), matrix: placed(face - 0.06, 0, 0, 0, Math.PI / 2, 0) });
      for (const z of [-door.half + 0.045, -door.half / 2, 0, door.half / 2, door.half - 0.045])
        green.push(block(face - 0.01, face + 0.038, 0.02, archY(Math.abs(z) + 0.04) - 0.03, z - 0.04, z + 0.04));
      for (const y of [0.07, 0.56, 1.02, spring - 0.05]) green.push(block(face - 0.01, face + 0.03, y - 0.045, y + 0.045, -door.half, door.half));
      green.push({ geometry: prism(arcBand(door.arch - 0.09, door.arch - 0.01, springAngle + 0.01, Math.PI - springAngle - 0.01, 24), 0.03, 0.008, 0), matrix: placed(face, yc, 0, 0, Math.PI / 2, 0) });
      for (const s of [-1, 1]) iron.push(block(face + 0.03, face + 0.06, 0.66, 0.86, s * 0.075 - 0.015, s * 0.075 + 0.015));
    }
    // The south door, for people: a green leaf in a blonde frame under a lintel, on a stone step.
    {
      const { x, half: f } = side,
        z = wall;
      green.push(block(x - f + 0.06, x + f - 0.06, 0.12, 0.78, z - 0.02, z + 0.03));
      stone.push(
        block(x - f, x - f + 0.06, 0.08, 0.8, z - 0.02, z + 0.07),
        block(x + f - 0.06, x + f, 0.08, 0.8, z - 0.02, z + 0.07),
        block(x - f - 0.03, x + f + 0.03, 0.78, 0.88, z - 0.02, z + 0.09),
      );
      plinth.push(block(x - f - 0.02, x + f + 0.02, 0, 0.12, z - 0.02, z + 0.18));
      iron.push(block(x + f - 0.13, x + f - 0.1, 0.42, 0.5, z + 0.03, z + 0.06));
    }
    merge(h, stone, L.dressing, 'stone', { tone: 0.05 });
    merge(h, plinth, palette.plinth, 'stone', { tone: 0.04 });
    merge(h, cladding, L.cladding, 'paint');
    merge(h, green, L.doors, 'paint', { tone: 0.06 });
    merge(h, ribs, L.rib, 'copper');
    merge(h, iron, L.iron, 'iron', { shadow: false });
    // The pad: the apron's concrete from under the doors to the apron's west edge.
    slab(g, H.x1 - 0.3, plan.APRON.x0, h.position.z - door.half - 0.35, h.position.z + door.half + 0.35, A.deck - 0.01, plan.AIRSIDE, L.apron, 'stone');
  }
  /**
   * The windsock (plan.WINDSOCK) on the grass by the runway's east end (its 27 threshold): a concrete
   * footing, a white mast and a steel swivel at its head, the sock's steel hoop hung from it by its
   * rim, and the sock in five bands (the tram's orange and cream, orange at either end) streaming
   * east-north-east on the prevailing westerly, drooping a little. Its mouth is dark inside the
   * hoop and its tail closed, so it never reads as an empty ring. Still for now: the sock hangs on
   * a pivot of its own (`windsock-sock`) at the hoop's middle, its axis the pivot's +y.
   */
  function windsock(g: T.Group) {
    const W = plan.WINDSOCK,
      w = new T.Group(),
      mast = 1.7,
      heading = -0.5, // from east toward the north
      droop = 0.3,
      mouth = 0.13,
      tail = 0.075,
      bands = 5,
      band = 0.14,
      d = new T.Vector3(Math.cos(droop) * Math.cos(heading), -Math.sin(droop), Math.cos(droop) * Math.sin(heading));
    w.name = 'airport-windsock';
    w.position.set(W.x, A.deck, W.z);
    g.add(w);
    merge(w, [{ geometry: new T.CylinderGeometry(0.15, 0.17, 0.1, 16), matrix: placed(0, 0.03, 0) }], L.footing, 'stone');
    merge(w, [{ geometry: new T.CylinderGeometry(0.042, 0.05, mast, 10), matrix: placed(0, mast / 2, 0) }], L.mast, 'paint', { band: false });
    // The sock on its pivot: the hoop's middle, out from the swivel by the hoop's radius.
    const sock = new T.Group();
    sock.name = 'windsock-sock';
    sock.position.set(Math.cos(heading) * (mouth + 0.05), mast, Math.sin(heading) * (mouth + 0.05));
    sock.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d);
    w.add(sock);
    const radius = (s: number) => mouth + ((tail - mouth) * s) / (bands * band),
      colours: Part[][] = [[], []];
    for (let k = 0; k < bands; k++)
      colours[k % 2].push({ geometry: new T.CylinderGeometry(radius((k + 1) * band), radius(k * band), band, 16, 1, true), matrix: placed(0, (k + 0.5) * band, 0) });
    colours[0].push({ geometry: new T.CylinderGeometry(tail, tail, 0.012, 16), matrix: placed(0, bands * band - 0.006, 0) });
    merge(sock, colours[0], palette.tramOrange, 'paint', { band: false });
    merge(sock, colours[1], palette.tramCream, 'paint', { band: false });
    // The dark inside, a little in from the mouth; the hoop round the mouth; the swivel.
    merge(sock, [{ geometry: new T.CylinderGeometry(mouth - 0.01, mouth - 0.01, 0.012, 16), matrix: placed(0, 0.035, 0) }], L.iron, 'paint', { shadow: false });
    merge(sock, [{ geometry: new T.TorusGeometry(mouth, 0.035, 6, 20), matrix: placed(0, 0, 0, Math.PI / 2, 0, 0) }], L.steel, 'paint', { shadow: false });
    merge(w, [{ geometry: new T.CylinderGeometry(0.06, 0.06, 0.12, 12), matrix: placed(0, mast + 0.02, 0) }], L.steel, 'paint', { shadow: false });
  }
  /**
   * A forecourt lamp (local y 0 on the paving): a frosted globe, the gate's kind of lamp, lit with
   * the town's lamps, in a short iron cup on a stone pier (a base course and a moulded cap in blonde
   * sandstone round a shaft of the causeway piers' kerb stone). The town's cast-iron standard here,
   * its fine black ironwork against the pale paving, was the forecourt's flicker as the view moved.
   */
  const PIER_LAMP = { base: 0.12, shaft: [0.12, 0.92] as [number, number], cap: 0.1, cup: 0.15, globe: 0.17 };
  function pierLamp(g: T.Object3D, x: number, z: number, y: number) {
    const P = PIER_LAMP,
      top = P.shaft[1] + P.cap,
      post = new T.Group();
    post.name = 'forecourt-lamp';
    post.position.set(x, y, z);
    g.add(post);
    merge(post, [{ geometry: chamfered(0.32, P.shaft[1] - P.shaft[0], 0.32), matrix: placed(0, (P.shaft[0] + P.shaft[1]) / 2, 0) }], L.coping, 'stone', { band: false });
    merge(
      post,
      [
        { geometry: chamfered(0.42, P.base, 0.42), matrix: placed(0, P.base / 2, 0) },
        { geometry: chamfered(0.42, P.cap, 0.42), matrix: placed(0, P.shaft[1] + P.cap / 2, 0) },
      ],
      L.dressing,
      'stone',
      { band: false, tone: 0.05 },
    );
    merge(post, [{ geometry: new T.LatheGeometry([[0.075, 0], [0.075, 0.03], [0.05, 0.06], [0.05, 0.09], [0.1, 0.13], [0.1, P.cup], [0, P.cup]].map(([r, h]) => new T.Vector2(r, h)), 12), matrix: placed(0, top, 0) }], L.iron, 'iron', { band: false });
    const globe = new T.Mesh(new T.SphereGeometry(P.globe, 18, 12), lampGlass());
    globe.position.y = top + P.cup + P.globe - 0.03;
    globe.castShadow = false;
    post.add(globe);
    ctx.lamps.push(globe);
    return post;
  }
  /**
   * The forecourt's furniture, between the causeway's end and the hall's steps, chunky and calm (the
   * town's slatted park benches, moulded cast-iron bollards and lamp standards, packed into this
   * small square, made it the busiest patch of the overview): on the road's axis a round planter of
   * blonde stone holding a clipped box ball; along the kerb either side of it two stone bollards each
   * (0.14 across; the outer pair in line with the causeway's last piers); a pier lamp at each front
   * corner (pierLamp); and along each side, facing in, a bench of one thick timber seat on two blocks
   * of the hall's stone. Each piece stands on the paving on its own, so each takes its own top-lit
   * gradient in the batch.
   */
  function forecourt(g: T.Group) {
    const y = A.deck + 0.06,
      ax = R.x,
      kerb = landingZ,
      turned = (points: number[][], n: number) => new T.LatheGeometry(points.map(([r, h]) => new T.Vector2(r, h)), n),
      planter = new T.Group();
    planter.name = 'forecourt-planter';
    planter.position.set(ax, y, kerb - 0.7);
    g.add(planter);
    merge(planter, [{ geometry: turned([[0.41, 0], [0.42, 0.02], [0.42, 0.08], [0.36, 0.12], [0.36, 0.28], [0.42, 0.32], [0.42, 0.38], [0.39, 0.41], [0.33, 0.41], [0.33, 0.37]], 24), matrix: placed(0, 0, 0) }], L.dressing, 'stone', { band: false });
    merge(planter, [{ geometry: new T.CylinderGeometry(0.335, 0.335, 0.02, 20), matrix: placed(0, 0.38, 0) }], palette.soil, 'stone', { band: false, shadow: false });
    topiary(planter, 0, 0.58, 0, 0.3, 1, 1, 0.85, 1);
    // The bollards, as one cluster: a foot, a plain shaft and a domed head.
    const post = turned([[0.07, 0], [0.07, 0.06], [0.06, 0.09], [0.06, 0.36], [0.055, 0.4], [0.04, 0.44], [0, 0.46]], 12);
    const bollards = cluster(g, [-1.05, -0.6, 0.6, 1.05].map((dx): Piece => ({ geometry: post, at: [ax + dx, y, kerb - 0.25] })), L.dressing, 'stone', { band: false });
    if (bollards) bollards.name = 'forecourt-bollards';
    for (const s of [-1, 1]) {
      pierLamp(g, ax + s * 2.0, kerb - 0.35, y);
      // The bench (its seat along local x, its front +z), turned to face the axis.
      const bench = new T.Group();
      bench.name = 'forecourt-bench';
      bench.position.set(ax + s * 2.0, y, kerb - 1.25);
      bench.rotation.y = -s * (Math.PI / 2);
      g.add(bench);
      merge(bench, [-0.42, 0.42].map((x): Part => ({ geometry: chamfered(0.16, 0.3, 0.36), matrix: placed(x, 0.15, 0) })), L.dressing, 'stone', { band: false, tone: 0.05 });
      merge(bench, [{ geometry: chamfered(1.14, 0.08, 0.42), matrix: placed(0, 0.34, 0.01) }], palette.wood, 'wood', { band: false });
    }
  }

  /**
   * The airport's ground, in its own group (the town's `airportLand`, batched on its own): the deck,
   * its coping and armour, the runway, taxiway, apron and forecourt with their markings, the road from
   * the ring over the beach ramp and the causeway, its parapets and lamps; the hangar, the windsock
   * and the forecourt's furniture. The boulders of the armour and the causeway's flanks are merged
   * into one geometry before batching.
   */
  function airportGround(g: T.Group) {
    deckLawn(g);
    const rocks = deckEdge(g);
    surfaces(g);
    asphalt(g);
    laneDressing(g);
    causeway(g, rocks);
    hangar(g);
    windsock(g);
    forecourt(g);
    const merged = mergeGeometries(rocks, false)!;
    rocks.forEach((r) => r.dispose());
    STONE.forEach((s) => s.dispose());
    solid(g, merged, '#ffffff', 'stone', { name: 'airport-armour' });
  }

  /* ---------------------------------------------------------------- */
  /* The Departures Hall, its link block, the tower and the jet bridge */
  /* ---------------------------------------------------------------- */
  /** A part for merge(): a shared geometry and where it goes in its mesh's space. */
  type Part = { geometry: T.BufferGeometry; matrix: T.Matrix4 };
  const ONE = new T.Vector3(1, 1, 1);
  const placed = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
    new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), ONE);
  /**
   * Parts as one mesh in g's space, each a shade of its own within +-tone/2 (vertex colours the
   * bake multiplies in), as separate dressed stones get. It casts unless `shadow` is false (a thin
   * caster ghosts in the shadow map), and is a `band` unless told otherwise: dressings spread over
   * a wall would otherwise read to batch() as an overhang and darken the wall under them.
   */
  function merge(g: T.Object3D, list: Part[], colour: string, kind: SurfaceKind, opts: { shadow?: boolean; tone?: number; band?: boolean } = {}) {
    if (!list.length) return undefined;
    const tone = opts.tone ?? 0,
      mid = new T.Vector3();
    const geometries = list.map(({ geometry, matrix }) => {
      const p = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(matrix);
      for (const name of Object.keys(p.attributes)) if (name !== 'position' && name !== 'normal') p.deleteAttribute(name);
      if (tone) {
        p.computeBoundingBox();
        p.boundingBox!.getCenter(mid);
        const k = 1 + tone * (hash(mid.x * 12.9898 + mid.y * 78.233 + mid.z * 37.719) - 0.5);
        p.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(p.getAttribute('position').count * 3).fill(k), 3));
      }
      return p;
    });
    const m = new T.Mesh(mergeGeometries(geometries)!, material(colour, kind));
    geometries.forEach((p) => p.dispose());
    const shadow = opts.shadow ?? true;
    m.castShadow = shadow;
    m.receiveShadow = true;
    if (!shadow) m.userData.noShadow = true;
    if (opts.band ?? true) m.userData.band = true;
    g.add(m);
    return m;
  }
  /** An outline of arc from angle a0 to a1 (from +x toward +y) between radii R0 and R1, in n steps. */
  const arcBand = (R0: number, R1: number, a0: number, a1: number, n: number): [number, number][] => [
    ...Array.from({ length: n + 1 }, (_, k): [number, number] => [Math.cos(a0 + ((a1 - a0) * k) / n) * R1, Math.sin(a0 + ((a1 - a0) * k) / n) * R1]),
    ...Array.from({ length: n + 1 }, (_, k): [number, number] => [Math.cos(a1 - ((a1 - a0) * k) / n) * R0, Math.sin(a1 - ((a1 - a0) * k) / n) * R0]),
  ];
  /**
   * An arch's voussoirs between radii R0 and R1 about its springing's middle, from 0.03 inside the
   * wall's face to `deep` out of it, the crown left for a keystone (n odd). They butt, so each
   * joint is the V of two chamfers.
   */
  const voussoirs = (R0: number, R1: number, deep: number, n: number) =>
    Array.from({ length: n }, (_, i) => i)
      .filter((i) => i !== (n - 1) / 2)
      .map((i) => prism(arcBand(R0, R1, (i * Math.PI) / n, ((i + 1) * Math.PI) / n, 1), deep + 0.03, 0.018, -0.03));
  /** A tapered keystone from radius r0 up to r1 over the springing's middle, `deep` out of the wall. */
  const keystone = (r0: number, r1: number, foot: number, head: number, deep: number) =>
    prism([[-foot / 2, r0], [foot / 2, r0], [head / 2, r1], [-head / 2, r1]], deep + 0.03, 0.022, -0.03);
  /** A round rod of radius r from a to b (8 sides), as a part. */
  const rodPart = (a: T.Vector3, b: T.Vector3, r: number): Part => {
    const d = b.clone().sub(a);
    return {
      geometry: new T.CylinderGeometry(r, r, d.length(), 8),
      matrix: new T.Matrix4().compose(a.clone().addScaledVector(d, 0.5), new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()), ONE),
    };
  };
  /** An upright octagon (rTop over rBottom, h tall about its middle), a face toward +z: flat facets. */
  const octagon = (rTop: number, rBottom: number, h: number, open = false) => {
    const g = new T.CylinderGeometry(rTop, rBottom, h, 8, 1, open).rotateY(Math.PI / 8).toNonIndexed();
    g.computeVertexNormals();
    return g;
  };

  /**
   * The building 'airport' (site.w 6.6, site.d 3.8; front +z, down the causeway), in the town's
   * Clash language at the Town Hall's and the residence's quality:
   * - The Departures Hall (x -3.2..1.0 here, centred on the causeway's axis): a battered stone
   *   plinth under a moulded plinth course; cream render walls 2.2 high, banded with two courses of
   *   rustication up to a sill band, between chunky blonde piers at the corners and pilasters
   *   between the bays (each a base, a shaft and a capital) under a cornice whose corona carries the
   *   bull-nosed copper eaves and returns round the gables; a verdigris barrel roof (apex 4.0) ribbed
   *   over its standing seams, end ribs on its verges; in each gable a blonde archivolt under the
   *   roof. In the south gable the open arch, 2.4 wide on the causeway's axis: jambs in alternating
   *   blocks, imposts, nine voussoirs and a keystone rising to the archivolt; in its porch a green
   *   screen of glazed doors and a sunburst fanlight (lit late), and in its mouth the blank board: a
   *   dark slate in a green frame on two iron hangers, three rows of tiles (dark umber glass by day,
   *   amber at night: 'beacon', no glyphs). Arched windows in blonde surrounds, green frames and
   *   glazing bars: one on the west wall, two on the back.
   * - East of it the link block, low and cream under a blonde coping, a window to the south and the
   *   north; then the control tower, echoing the lighthouse: a stone drum, a moulded base course, a
   *   tapered cream shaft with two green bands, stair windows and a door case to the south, a
   *   corbelled gallery with an iron railing, the octagonal cab of raked glass ('cab': dim and warm,
   *   lit all night) on a green sill between iron mullions, a thick copper cap, its roof and a short
   *   mast to 7.0.
   * - West of it the jet bridge, toward the stand: a portal in the west wall, two telescoping
   *   sections (cream, ribbed in steel, glazed along both sides over a green skirt) on a footing and
   *   two legs, and a cab whose grey bellows meet the parked plane's port side (JET_BRIDGE).
   * No text, numbers or logos anywhere. Window roles: the glass is 'civic' (the batch's) but for
   * the cab ('cab') and the board's rows ('beacon').
   */
  function buildAirport(shell: T.Group, site: plan.Site) {
    const { floor, eave, apex } = HALL_LEVELS,
      hx = R.x - site.x, // the hall's middle, on the causeway's axis
      hw = 2.1,
      z0 = -1.6,
      z1 = 1.8,
      porch = 0.7,
      archW = 2.4,
      spring = floor + 1.4,
      { course: COURSE, rustic: RUSTIC, sill: SILL, capital: CAPITAL, cornice: CORNICE } = HALL_DRESSING;
    const stone: Part[] = [], // the blonde dressings, each a shade of its own
      courses: Part[] = [], // the render's rustication, a shade deeper than the walls
      green: Part[] = [], // green paintwork that casts (the screen, the door, the bands, the cab's sill)
      bars: Part[] = [], // slim green glazing bars: cast nothing
      iron: Part[] = [], // dark iron (the hangers, the railing, the mullions, the mast): cast nothing
      ribs: Part[] = [], // the roof's ribs
      slate: Part[] = [],
      steel: Part[] = [], // the jet bridge's roofs, collars and legs
      rubber: Part[] = [],
      footing: Part[] = [];
    /** A box between two corners in the shell (the kit's rounded box). */
    const solid = (x0: number, x1: number, y0: number, y1: number, za: number, zb: number, colour: string, kind: SurfaceKind, opts: { bevel?: number; taper?: number } = {}) =>
      box(shell, (x0 + x1) / 2, (y0 + y1) / 2, (za + zb) / 2, x1 - x0, y1 - y0, zb - za, colour, kind, opts);
    /** A face (x along it, y up, +z out of it) at (x, z) turned by ry. */
    const faceAt = (x: number, z: number, ry: number) => {
      const g = new T.Group();
      g.position.set(x, 0, z);
      g.rotation.y = ry;
      g.updateMatrix();
      shell.add(g);
      return g;
    };
    const on = (g: T.Object3D | undefined, m: T.Matrix4) => (g ? g.matrix.clone().multiply(m) : m);
    /** A chamfered block between two corners in g's plan (the shell's without g). */
    const block = (x0: number, x1: number, y0: number, y1: number, za: number, zb: number, g?: T.Object3D): Part => ({
      geometry: chamfered(x1 - x0, y1 - y0, zb - za),
      matrix: on(g, placed((x0 + x1) / 2, (y0 + y1) / 2, (za + zb) / 2)),
    });
    // The barrel: an arc through the apex and the eaves' edges (0.2 out from the walls), 0.14 thick.
    const chord = hw + 0.2,
      rise = apex - (eave - 0.02),
      Ro = (chord * chord + rise * rise) / (2 * rise),
      yc = apex - Ro,
      Ri = Ro - 0.14,
      half = Math.asin(chord / Ro),
      under = (x: number) => yc + Math.sqrt(Math.max(0, Ri * Ri - x * x)); // the vault's underside over x
    const front = faceAt(hx, z1, 0),
      back = faceAt(hx, z0, Math.PI),
      west = faceAt(hx - hw, 0, -Math.PI / 2); // x toward the front

    /* -------------------------------------------------------------- */
    /* The hall's masses                                               */
    /* -------------------------------------------------------------- */
    // The plinth, battered, from y 0 (the deck hides its foot, so Inspect sees it on the ground).
    box(shell, hx, floor / 2, (z0 + z1) / 2, 2 * hw + 0.24, floor, z1 - z0 + 0.24, palette.plinth, 'ashlar', { taper: floor * 0.105 });
    // The walls: the back gable, the body, and the front gable round the arch's porch, sharp-edged
    // so that their joints on the side walls show no seam.
    const gable = (open: boolean) => {
      const s = new T.Shape(),
        top = under(hw);
      s.moveTo(-hw, floor);
      if (open) {
        s.lineTo(-archW / 2, floor);
        s.lineTo(-archW / 2, spring);
        s.absarc(0, spring, archW / 2, Math.PI, 0, true);
        s.lineTo(archW / 2, floor);
      }
      s.lineTo(hw, floor);
      s.lineTo(hw, top);
      s.absarc(0, yc, Ri, Math.atan2(top - yc, hw), Math.atan2(top - yc, -hw), false);
      s.closePath();
      return s;
    };
    for (const [open, za, depth] of [[false, z0, 0.3], [true, z1 - porch, porch]] as const) {
      const m = new T.Mesh(new T.ExtrudeGeometry(gable(open), { depth, bevelEnabled: false, curveSegments: 24 }), material(L.render, 'paint'));
      m.position.set(hx, 0, za);
      m.castShadow = m.receiveShadow = true;
      shell.add(m);
    }
    solid(hx - hw, hx + hw, floor, eave + 0.02, z0 + 0.3, z1 - porch, L.render, 'paint', { bevel: 0 });

    /* The roof: the barrel shell over both gables, a bull-nosed roll along each eave, and ribs. */
    {
      const b = Math.asin(chord / Ri),
        s = new T.Shape();
      s.absarc(0, yc, Ro, Math.PI / 2 + half, Math.PI / 2 - half, true);
      s.absarc(0, yc, Ri, Math.PI / 2 - b, Math.PI / 2 + b, false);
      s.closePath();
      const len = z1 - z0 + 0.3,
        roof = new T.Mesh(
          new T.ExtrudeGeometry(s, { depth: len - 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelOffset: -0.03, bevelSegments: 2, curveSegments: 28 }),
          material(L.roof, 'copper'),
        );
      roof.position.set(hx, 0, z0 - 0.15 + 0.03);
      roof.castShadow = roof.receiveShadow = true;
      roof.userData.roof = true;
      roof.userData.eaveY = eave;
      shell.add(roof);
      const low = yc + Ri * Math.cos(b),
        high = yc + Ro * Math.cos(half);
      for (const side of [-1, 1]) {
        const roll = new T.Mesh(new T.CylinderGeometry(0.13, 0.13, len, 16).rotateX(Math.PI / 2), material(L.roof, 'copper'));
        roll.position.set(hx + side * (chord - 0.04), (low + high) / 2, (z0 + z1) / 2);
        roll.castShadow = roll.receiveShadow = true;
        roll.userData.band = true;
        shell.add(roll);
      }
      // Ribs over the barrel from roll to roll, on every other standing seam of the copper (0.42
      // apart along z), and a broader rib on each verge: chunky, few, and in the roof's lighter
      // copper, so they read at the overview without crawling.
      const rib = (z: number, wide: number) =>
        ribs.push({ geometry: prism(arcBand(Ro - 0.03, Ro + 0.055, Math.PI / 2 - half + 0.04, Math.PI / 2 + half - 0.04, 24), wide, 0.02, -wide / 2), matrix: placed(hx, yc, z) });
      for (const z of [-1.26, -0.42, 0.42, 1.26]) rib(z, 0.1);
      for (const z of [z0 - 0.15 + 0.065, z1 + 0.15 - 0.065]) rib(z, 0.13);
    }

    /* -------------------------------------------------------------- */
    /* The hall's dressings                                            */
    /* -------------------------------------------------------------- */
    // The moulded plinth course round the hall, 0.12 proud, stopped at the arch's jambs.
    {
      const p = 0.12,
        jamb = archW / 2 + 0.24;
      stone.push(block(hx - hw - p, hx + hw + p, COURSE[0], COURSE[1], z0 - p, z0 + 0.1));
      for (const sx of [-1, 1]) {
        const [a, b] = sx < 0 ? [hx - hw - p, hx - hw + 0.1] : [hx + hw - 0.1, hx + hw + p];
        stone.push(block(a, b, COURSE[0], COURSE[1], z0 - p, z1 + p));
        stone.push(block(sx < 0 ? hx - hw - p : hx + jamb, sx < 0 ? hx - jamb : hx + hw + p, COURSE[0], COURSE[1], z1 - 0.1, z1 + p));
      }
    }
    /** A pier or a pilaster (a base, a shaft, a necking and a capital) on a w x d plan about (x, z) in g's plan. */
    const pier = (x: number, z: number, w: number, d: number, g?: T.Object3D) =>
      stone.push(
        block(x - w / 2 - 0.05, x + w / 2 + 0.05, COURSE[1] - 0.01, COURSE[1] + 0.15, z - d / 2 - 0.05, z + d / 2 + 0.05, g),
        block(x - w / 2, x + w / 2, COURSE[1] + 0.14, CAPITAL[0], z - d / 2, z + d / 2, g),
        block(x - w / 2 - 0.03, x + w / 2 + 0.03, CAPITAL[0], CAPITAL[0] + 0.07, z - d / 2 - 0.03, z + d / 2 + 0.03, g),
        block(x - w / 2 - 0.07, x + w / 2 + 0.07, CAPITAL[0] + 0.07, CAPITAL[1], z - d / 2 - 0.07, z + d / 2 + 0.07, g),
      );
    // Corner piers 0.46 square, 0.1 proud of both faces; a pilaster between the bays of the west
    // wall and of the back (the east wall is the link's).
    for (const sx of [-1, 1]) for (const cz of [z0 + 0.13, z1 - 0.13]) pier(hx + sx * (hw - 0.13), cz, 0.46, 0.46);
    pier(0.1, 0.03, 0.42, 0.14, west);
    pier(0, 0.03, 0.42, 0.14, back);
    /** Two courses of banded rustication and the sill band on a face from a to b (none under 0.15 long). */
    const banded = (g: T.Object3D, a: number, b: number) => {
      if (b - a < 0.15) return;
      const mid = (RUSTIC[0] + RUSTIC[1]) / 2;
      for (const [y0, y1] of [[RUSTIC[0], mid], [mid, RUSTIC[1]]]) courses.push({ geometry: prism([[a, y0], [b, y0], [b, y1], [a, y1]], 0.09, 0.035, -0.04), matrix: g.matrix.clone() });
      stone.push(block(a, b, SILL[0], SILL[1], -0.04, 0.07, g));
    };
    const cornerIn = hw - 0.36 - 0.05, // a corner pier's base, from a face's middle
      bayIn = 0.26; // a pilaster's base, either side of it
    banded(back, -cornerIn, -bayIn);
    banded(back, bayIn, cornerIn);
    // The west wall: the jet bridge's portal in its north bay, a window in the south bay.
    const portal = { u: JET_BRIDGE.z - site.z, w: JET_BRIDGE.width[0], y0: JET_BRIDGE.floor, y1: JET_BRIDGE.floor + JET_BRIDGE.height[0] };
    banded(west, z0 + 0.36 + 0.05, portal.u - portal.w / 2 - 0.14);
    banded(west, 0.1 + bayIn, z1 - 0.36 - 0.05);
    // The cornice under the eaves' rolls: a bed and a corona along both side walls, returned 0.5
    // round each corner onto the gables.
    for (const sx of [-1, 1]) {
      const x = hx + sx * hw,
        span = (inner: number, outer: number): [number, number] => (sx < 0 ? [x - outer, x + inner] : [x - inner, x + outer]),
        [b0, b1] = span(0.04, 0.06),
        [c0, c1] = span(0.04, 0.15),
        [r0, r1] = span(0.5, 0.15),
        [s0, s1] = span(0.5, 0.06),
        bed = CORNICE[0] + 0.07;
      stone.push(block(b0, b1, CORNICE[0], bed, z0 - 0.06, z1 + 0.06), block(c0, c1, bed, CORNICE[1], z0 - 0.15, z1 + 0.15));
      for (const [za, zb, wa, wb] of [[z1 - 0.04, z1 + 0.06, z1 - 0.04, z1 + 0.15], [z0 - 0.06, z0 + 0.04, z0 - 0.15, z0 + 0.04]])
        stone.push(block(s0, s1, CORNICE[0], bed, za, zb), block(r0, r1, bed, CORNICE[1], wa, wb));
    }
    // Each gable's archivolt: a blonde band under the roof's edge, from eave to eave.
    {
      const a0 = Math.atan2(under(hw) - yc, hw);
      for (const g of [front, back]) stone.push({ geometry: prism(arcBand(Ri - 0.13, Ri - 0.005, a0, Math.PI - a0, 20), 0.11, 0.02, -0.03), matrix: on(g, placed(0, yc, 0)) });
    }
    /**
     * An arched window on a face (local +z out of it), standing on the sill band: a green frame, the
     * pane (0.06 out; its centre seeds its night light), green glazing bars (a mullion, a transom at
     * the springing and two head bars), and a blonde surround: jambs, imposts, five voussoirs, a
     * keystone and a sill on the band.
     */
    function archWindow(g: T.Object3D, u: number) {
      const w = 0.56,
        h = 0.52,
        f = 0.07,
        r = w / 2,
        y = SILL[1] + 0.08 + h / 2,
        s = y + h / 2,
        R0 = r + f,
        R1 = R0 + 0.13,
        deep = 0.12;
      const ring = frameRing(g, u, y, 0.02, w, h, f, 0.1, L.green, 'paint', true),
        pane = new T.Mesh(new T.ShapeGeometry(ring(0.01), 8), material(palette.glass, 'glass'));
      pane.position.set(u, y, 0.06);
      g.add(pane);
      const bar = (bw: number, bh: number) => new T.BoxGeometry(bw, bh, 0.04);
      bars.push(
        { geometry: bar(0.07, h + r), matrix: on(g, placed(u, y + r / 2, 0.09)) },
        { geometry: bar(w, 0.07), matrix: on(g, placed(u, s, 0.09)) },
        ...[-1, 1].map((k): Part => ({ geometry: bar(0.07, r), matrix: on(g, placed(u + (k * r * Math.SQRT1_2) / 2, s + (r * Math.SQRT1_2) / 2, 0.09, 0, 0, (-k * Math.PI) / 4)) })),
      );
      for (const v of voussoirs(R0, R1, deep, 5)) stone.push({ geometry: v, matrix: on(g, placed(u, s, 0)) });
      stone.push({ geometry: keystone(R0 - 0.02, R1 + 0.08, 0.14, 0.22, deep + 0.03), matrix: on(g, placed(u, s, 0)) });
      for (const k of [-1, 1]) {
        const [j0, j1] = k < 0 ? [u - R1, u - R0] : [u + R0, u + R1];
        stone.push(block(j0, j1, SILL[1], s - 0.08, -0.03, deep, g), block(j0 - 0.02, j1 + 0.02, s - 0.08, s, -0.03, deep + 0.03, g));
      }
      stone.push(block(u - R1 - 0.06, u + R1 + 0.06, SILL[1] - 0.05, SILL[1] + 0.05, -0.03, 0.17, g));
      return pane;
    }
    archWindow(west, (0.1 + bayIn + z1 - 0.41) / 2);
    for (const u of [-0.95, 0.95]) archWindow(back, u);

    /* -------------------------------------------------------------- */
    /* The arch, its porch's screen and the board                      */
    /* -------------------------------------------------------------- */
    {
      const R0 = archW / 2,
        R1 = R0 + 0.24,
        deep = 0.14;
      for (const v of voussoirs(R0, R1, deep, 9)) stone.push({ geometry: v, matrix: on(front, placed(0, spring, 0)) });
      // The keystone rises to the archivolt.
      stone.push({ geometry: keystone(R0 - 0.03, under(0) - spring - 0.12, 0.26, 0.4, deep + 0.05), matrix: on(front, placed(0, spring, 0)) });
      // Jambs in three blocks, alternately long and short into the wall, and the imposts.
      for (const k of [-1, 1])
        for (let i = 0; i < 3; i++) {
          const y0 = COURSE[1] + ((spring - 0.12 - COURSE[1]) * i) / 3,
            y1 = COURSE[1] + ((spring - 0.12 - COURSE[1]) * (i + 1)) / 3,
            reach = i % 2 ? R1 : R1 + 0.08;
          stone.push(k < 0 ? block(-reach, -R0, y0, y1, -0.03, deep, front) : block(R0, reach, y0, y1, -0.03, deep, front));
          if (i === 2) stone.push(k < 0 ? block(-R1 - 0.05, -R0 + 0.04, y1, spring, -0.03, deep + 0.05, front) : block(R0 - 0.04, R1 + 0.05, y1, spring, -0.03, deep + 0.05, front));
        }
      // The screen at the back of the porch: glazed doors under a transom at the springing and a
      // fanlight in the arch's head, one light lit late (0.8, as the civic fronts are), in a green
      // frame: the arch's edge, the transom, four mullions, a rail across the doors, kick panels and
      // the fanlight's sunburst of five bars round a half-round hub.
      const screen = z1 - porch,
        inner = R0 - 0.08;
      const doors = new T.Mesh(new T.PlaneGeometry(archW - 0.04, spring - floor), material(palette.glass, 'glass'));
      doors.position.set(hx, (floor + spring) / 2, screen + 0.03);
      doors.userData.windowGroup = 'airport-doors';
      doors.userData.windowLit = 0.8;
      shell.add(doors);
      const fan = new T.Shape();
      fan.absarc(0, 0, R0 - 0.02, 0, Math.PI, false);
      fan.closePath();
      const fanlight = new T.Mesh(new T.ShapeGeometry(fan, 16), material(palette.glass, 'glass'));
      fanlight.position.set(hx, spring, screen + 0.03);
      fanlight.userData.windowGroup = 'airport-doors';
      shell.add(fanlight);
      frameRing(shell, hx, (floor + spring) / 2, screen, 2 * inner, spring - floor, 0.08, 0.09, L.green, 'paint', true, true);
      green.push(block(hx - inner, hx + inner, spring - 0.05, spring + 0.05, screen, screen + 0.1));
      for (const x of [-0.62, 0, 0.62]) green.push(block(hx + x - (x ? 0.04 : 0.05), hx + x + (x ? 0.04 : 0.05), floor, spring, screen, screen + 0.09));
      green.push(block(hx - 0.62, hx + 0.62, 1.12, 1.19, screen, screen + 0.09));
      green.push(block(hx - inner, hx + inner, floor, floor + 0.24, screen, screen + 0.07));
      const hub = new T.Shape();
      hub.absarc(0, 0, 0.24, 0, Math.PI, false);
      hub.closePath();
      green.push({ geometry: new T.ExtrudeGeometry(hub, { depth: 0.06, bevelEnabled: false, curveSegments: 8 }), matrix: placed(hx, spring + 0.05, screen + 0.03) });
      for (let k = 1; k < 6; k++) {
        const a = (k * Math.PI) / 6,
          r = (0.24 + inner) / 2;
        bars.push({ geometry: new T.BoxGeometry(0.07, inner - 0.24, 0.04), matrix: placed(hx + Math.cos(a) * r, spring + 0.05 + Math.sin(a) * r, screen + 0.06, 0, 0, a - Math.PI / 2) });
      }
    }
    {
      // The board, hung in the arch's mouth 0.15 behind the gable's face: a green frame round a dark
      // slate and three rows of tiles. Each row is one pane of dark umber glass (its centre on the
      // road's axis seeds its light), its tiles parted by shading alone (each darkens over its last
      // 0.022 at either side; no gap, no glyph), so by day the rows are dark tiles and at night they
      // glow amber all night ('beacon', in a glass of its own glow), the joints a little dimmer
      // (glowShade) so they read as blank lit tiles, not a lit blind. Two iron hangers from the soffit.
      const y = 1.99,
        z = z1 - 0.15,
        tiles = 12,
        width = 1.7,
        tall = 0.16;
      frameRing(shell, hx, y, z - 0.1, 2.0, 0.76, 0.08, 0.1, L.green, 'paint');
      slate.push(block(hx - 1.0, hx + 1.0, y - 0.38, y + 0.38, z - 0.1, z - 0.03));
      const rowGlass = material(L.tile, 'glass', L.glow);
      for (const dy of [0.26, 0, -0.26]) {
        const pos: number[] = [],
          col: number[] = [];
        for (let k = 0; k < tiles; k++) {
          const a = -width / 2 + (width * k) / tiles,
            b = a + width / tiles,
            xs = [a, a + 0.022, b - 0.022, b],
            tone = [0.55, 1, 1, 0.55];
          for (let i = 0; i < 3; i++) {
            const quad = [[xs[i], -tall / 2, tone[i]], [xs[i + 1], -tall / 2, tone[i + 1]], [xs[i + 1], tall / 2, tone[i + 1]], [xs[i], -tall / 2, tone[i]], [xs[i + 1], tall / 2, tone[i + 1]], [xs[i], tall / 2, tone[i]]];
            for (const [px, py, t] of quad) {
              pos.push(px, py, 0);
              col.push(t, t, t);
            }
          }
        }
        const geometry = new T.BufferGeometry();
        geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
        geometry.setAttribute('color', new T.Float32BufferAttribute(col, 3));
        geometry.computeVertexNormals();
        const row = new T.Mesh(geometry, rowGlass);
        row.position.set(hx, y + dy, z - 0.025);
        row.userData.window = 'beacon';
        row.userData.glowShade = 0.4; // its joints' shade dims the glow too (by 18%), so the tiles part at night
        shell.add(row);
      }
      for (const s of [-1, 1]) {
        const x = hx + s * 0.72,
          top = spring + Math.sqrt((archW / 2) ** 2 - 0.72 ** 2) + 0.03;
        iron.push(block(x - 0.035, x + 0.035, y + 0.45, top, z - 0.085, z - 0.015));
      }
    }
    /* Two steps up from the forecourt to the hall's floor, wider than the arch's jambs. Like the
     * plinth they stand on y 0 (the deck hides their foot), so Inspect sees them on the ground. */
    for (let i = 0; i < 2; i++)
      solid(hx - archW / 2 - 0.3 + i * 0.08, hx + archW / 2 + 0.3 - i * 0.08, 0, A.deck + 0.06 + 0.12 * (i + 1), z1 + 0.1, z1 + 0.1 + 0.3 * (2 - i), palette.plinth, 'stone');

    /* -------------------------------------------------------------- */
    /* The link block                                                  */
    /* -------------------------------------------------------------- */
    {
      const x0 = hx + hw,
        x1 = x0 + 0.8,
        za = -1.2,
        zb = 1.2,
        top = 2.14;
      solid(x0 - 0.05, x1 + 0.1, 0, floor - 0.04, za - 0.1, zb + 0.1, palette.plinth, 'ashlar');
      solid(x0 - 0.05, x1, floor - 0.06, top, za, zb, L.render, 'paint', { bevel: 0.03 });
      // The hall's banded base runs on round it: the plinth course, the two courses of rustication
      // and the sill band; a cornice band under a blonde coping (its roof, whose eave shades the
      // walls), and to the south and the north a window on the sill band in a blonde surround.
      stone.push(
        block(x0, x1 + 0.12, COURSE[0], COURSE[1], zb - 0.1, zb + 0.12),
        block(x0, x1 + 0.12, COURSE[0], COURSE[1], za - 0.12, za + 0.1),
        block(x0, x1 + 0.06, top - 0.1, top, za - 0.06, zb + 0.06),
      );
      const cap = solid(x0 - 0.05, x1 + 0.1, top, top + 0.12, za - 0.1, zb + 0.1, L.dressing, 'stone', { bevel: 0.03 });
      cap.userData.roof = true;
      cap.userData.eaveY = top;
      for (const [z, ry] of [[zb, 0], [za, Math.PI]] as const) {
        const g = faceAt((x0 + x1) / 2, z, ry),
          w = 0.34,
          h = 0.5,
          y = SILL[1] + 0.07 + h / 2,
          ring = frameRing(g, 0, y, 0.02, w, h, 0.07, 0.09, L.green, 'paint'),
          pane = new T.Mesh(new T.ShapeGeometry(ring(0.01), 4), material(palette.glass, 'glass'));
        pane.position.set(0, y, 0.06);
        g.add(pane);
        banded(g, -0.38, 0.38);
        bars.push({ geometry: new T.BoxGeometry(w, 0.07, 0.04), matrix: on(g, placed(0, y + 0.06, 0.09)) });
        stone.push(
          block(-w / 2 - 0.16, w / 2 + 0.16, y + h / 2 + 0.07, y + h / 2 + 0.16, -0.03, 0.12, g),
          block(-w / 2 - 0.14, w / 2 + 0.14, SILL[1] - 0.05, SILL[1] + 0.05, -0.03, 0.15, g),
        );
      }
    }

    /* -------------------------------------------------------------- */
    /* The control tower                                               */
    /* -------------------------------------------------------------- */
    {
      const tx = 3.9 - site.x,
        tz = -47.4 - site.z,
        foot = 0.8, // the shaft, from the base course ...
        neck = 4.6, // ... up behind the corbels to the gallery's cornice
        shaftR = (y: number) => 0.54 + ((0.42 - 0.54) * (y - foot)) / (neck - foot),
        turned = (profile: [number, number][], segments = 32): Part => ({ geometry: new T.LatheGeometry(profile.map(([r, y]) => new T.Vector2(r, y)), segments), matrix: placed(tx, 0, tz) }),
        mesh = (geometry: T.BufferGeometry, colour: string, kind: SurfaceKind, y: number) => {
          const m = new T.Mesh(geometry, material(colour, kind));
          m.position.set(tx, y, tz);
          m.castShadow = m.receiveShadow = true;
          shell.add(m);
          return m;
        },
        /** A group on the tower's axis, its +z toward bearing a. */
        facing = (a: number) => {
          const g = new T.Group();
          g.position.set(tx, 0, tz);
          g.rotation.y = a;
          g.updateMatrix();
          shell.add(g);
          return g;
        };
      // The stone drum and its moulded base course (a torus and a cavetto into the shaft).
      mesh(new T.CylinderGeometry(0.66, 0.7, 0.66, 32), palette.plinth, 'ashlar', 0.33);
      stone.push(turned([[0.6, 0.6], [0.72, 0.6], [0.74, 0.63], [0.74, 0.67], [0.71, 0.7], [0.66, 0.72], [0.62, 0.75], [0.57, 0.78], [0.54, 0.82], [0.4, 0.82]]));
      // The shaft, tapering, and its two green bands, 0.03 proud.
      mesh(new T.CylinderGeometry(shaftR(neck), shaftR(foot), neck - foot, 32), L.render, 'paint', (foot + neck) / 2);
      for (const [y0, y1] of [[1.95, 2.15], [3.05, 3.25]]) green.push({ geometry: new T.CylinderGeometry(shaftR(y1) + 0.03, shaftR(y0) + 0.03, y1 - y0, 32), matrix: placed(tx, (y0 + y1) / 2, tz) });
      // Stair windows in blonde surrounds (a sill and a head), lit together.
      for (const [a, y] of [[0, 2.62], [0.95, 1.55], [0.95, 3.62]]) {
        const g = facing(a),
          r = shaftR(y);
        frameRing(g, 0, y, r - 0.05, 0.2, 0.3, 0.07, 0.12, L.dressing, 'stone');
        const pane = new T.Mesh(new T.PlaneGeometry(0.22, 0.32), material(palette.glass, 'glass'));
        pane.position.set(0, y, r + 0.012);
        pane.userData.windowGroup = 'airport-tower';
        g.add(pane);
        stone.push(block(-0.19, 0.19, y - 0.26, y - 0.19, r - 0.06, r + 0.1, g), block(-0.17, 0.17, y + 0.22, y + 0.3, r - 0.06, r + 0.08, g));
      }
      // The door to the south: a green leaf in a blonde case (pilasters, a lintel and a low
      // pediment), three steps down to the deck that, like the plinth, stand on y 0.
      {
        const g = facing(0),
          sill = foot,
          head = 1.62;
        green.push(block(-0.18, 0.18, sill, head, 0.4, 0.56, g));
        stone.push(
          block(-0.29, -0.19, sill - 0.02, head + 0.04, 0.4, 0.62, g),
          block(0.19, 0.29, sill - 0.02, head + 0.04, 0.4, 0.62, g),
          block(-0.35, 0.35, head + 0.04, head + 0.14, 0.4, 0.66, g),
          { geometry: prism([[-0.36, 0], [0.36, 0], [0, 0.15]], 0.2, 0.02, -0.1), matrix: on(g, placed(0, head + 0.14, 0.55)) },
        );
        for (let i = 0; i < 3; i++) solid(tx - 0.3 - i * 0.03, tx + 0.3 + i * 0.03, 0, sill - 0.133 * i, tz + 0.46, tz + 0.84 + 0.18 * i, palette.plinth, 'stone');
      }
      // The corbelled gallery: eight blonde consoles (an ogee each) under the cab's corners carry a
      // moulded cornice whose top is the gallery's floor, an iron deck plate on it, and a railing:
      // sixteen stanchions, a mid rail and a fat top rail.
      {
        const profile = new T.Shape(([[0.36, 3.95], [0.47, 3.95], [0.49, 4.07], [0.53, 4.2], [0.6, 4.33], [0.7, 4.43], [0.8, 4.5], [0.86, 4.53], [0.86, 4.6], [0.36, 4.6]] as [number, number][]).map(([r, y]) => new T.Vector2(r, y))),
          one = new T.ExtrudeGeometry(profile, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelOffset: -0.015, bevelSegments: 1, curveSegments: 1 }).rotateY(-Math.PI / 2).translate(0.06, 0, 0);
        for (let k = 0; k < 8; k++) stone.push({ geometry: one, matrix: placed(tx, 0, tz, 0, Math.PI / 8 + (k * Math.PI) / 4) });
      }
      const deck = 4.86;
      stone.push(turned([[0.4, 4.58], [0.84, 4.58], [0.9, 4.62], [0.95, 4.68], [0.98, 4.75], [0.98, deck - 0.03], [0.95, deck], [0.4, deck]], 40));
      iron.push({ geometry: new T.CylinderGeometry(0.93, 0.93, 0.07, 40), matrix: placed(tx, deck + 0.035, tz) });
      for (let k = 0; k < 16; k++) {
        const a = ((k + 0.5) * Math.PI) / 8;
        iron.push({ geometry: new T.BoxGeometry(0.075, 0.38, 0.075), matrix: placed(tx + Math.sin(a) * 0.92, deck + 0.21, tz + Math.cos(a) * 0.92, 0, a) });
      }
      for (const [y, t] of [[deck + 0.21, 0.035], [deck + 0.4, 0.045]]) iron.push({ geometry: new T.TorusGeometry(0.92, t, 5, 40).rotateX(Math.PI / 2), matrix: placed(tx, y, tz) });
      // The cab: a green sill, the raked glass (wider at its head; lit all night, dim and warm, and
      // like a lamp it casts nothing), iron mullions on its eight corners, the thick copper cap
      // (an eave over the glass), its low roof and the mast with a ball to 7.0.
      const glass0 = deck + 0.26,
        glass1 = 6.28;
      green.push({ geometry: octagon(0.73, 0.73, glass0 - deck), matrix: placed(tx, (deck + glass0) / 2, tz) });
      const cab = mesh(octagon(0.86, 0.72, glass1 - glass0, true), palette.glass, 'glass', (glass0 + glass1) / 2);
      cab.castShadow = false;
      cab.userData.noShadow = true;
      cab.userData.window = 'cab';
      for (let k = 0; k < 8; k++) {
        const a = Math.PI / 8 + (k * Math.PI) / 4;
        iron.push(rodPart(new T.Vector3(tx + Math.sin(a) * 0.72, glass0, tz + Math.cos(a) * 0.72), new T.Vector3(tx + Math.sin(a) * 0.86, glass1, tz + Math.cos(a) * 0.86), 0.04));
      }
      const cap = mesh(octagon(1.0, 0.95, 0.24), L.roof, 'copper', glass1 + 0.12);
      cap.userData.roof = true;
      cap.userData.eaveY = glass1;
      mesh(octagon(0.22, 0.8, 0.22), L.roof, 'copper', glass1 + 0.35);
      iron.push(
        { geometry: new T.CylinderGeometry(0.1, 0.12, 0.08, 12), matrix: placed(tx, glass1 + 0.5, tz) },
        rodPart(new T.Vector3(tx, glass1 + 0.5, tz), new T.Vector3(tx, 6.95, tz), 0.035),
        { geometry: new T.IcosahedronGeometry(0.06, 1), matrix: placed(tx, 7.0 - 0.06, tz) },
      );
    }

    /* -------------------------------------------------------------- */
    /* The jet bridge                                                  */
    /* -------------------------------------------------------------- */
    {
      const J = JET_BRIDGE,
        wx = hx - hw, // the west wall
        bz = J.z - site.z,
        cabX = J.cab - site.x,
        // Two telescoping sections (x from, x to, width, height): the outer one a little larger.
        sections: [number, number, number, number][] = [
          [wx + 0.05, wx - 0.97, J.width[0], J.height[0]],
          [wx - 0.9, cabX + 0.31, J.width[1], J.height[1]],
        ];
      // The portal in the west wall: blonde jambs and a lintel round the inner section.
      stone.push(
        block(portal.u - portal.w / 2 - 0.13, portal.u - portal.w / 2 - 0.01, COURSE[1], portal.y1 + 0.03, -0.03, 0.1, west),
        block(portal.u + portal.w / 2 + 0.01, portal.u + portal.w / 2 + 0.13, COURSE[1], portal.y1 + 0.03, -0.03, 0.1, west),
        block(portal.u - portal.w / 2 - 0.17, portal.u + portal.w / 2 + 0.17, portal.y1 + 0.03, portal.y1 + 0.17, -0.03, 0.13, west),
      );
      // Each section: a cream tube under a steel roof, a green skirt along its foot (the tram's and
      // the plane's livery), two steel ribs round it and, on the outer one, a collar round its mouth
      // where the inner one slides in.
      sections.forEach(([xa, xb, w, h], i) => {
        const y0 = J.floor - (w - J.width[0]) / 2,
          y1 = y0 + h,
          [x0, x1] = [Math.min(xa, xb), Math.max(xa, xb)];
        solid(x0, x1, y0, y1, bz - w / 2, bz + w / 2, L.render, 'paint', { bevel: 0.03 });
        steel.push(block(x0 - 0.02, x1 + (i ? 0.02 : 0), y1, y1 + 0.07, bz - w / 2 - 0.03, bz + w / 2 + 0.03));
        green.push(block(x0 + 0.02, x1, y0 - 0.01, y0 + 0.13, bz - w / 2 - 0.015, bz + w / 2 + 0.015));
        for (const t of [1 / 3, 2 / 3]) {
          const x = x0 + (x1 - x0) * t;
          steel.push(block(x - 0.04, x + 0.04, y0 - 0.025, y1 + 0.08, bz - w / 2 - 0.025, bz + w / 2 + 0.025));
        }
        if (i) steel.push(block(x1 - 0.08, x1 + 0.01, y0 - 0.025, y1 + 0.025, bz - w / 2 - 0.025, bz + w / 2 + 0.025));
        // A glazed strip along each side, one light for the whole bridge.
        for (const s of [-1, 1]) {
          const pane = new T.Mesh(new T.PlaneGeometry(x1 - x0 - 0.2, 0.13), material(palette.glass, 'glass'));
          pane.position.set((x0 + x1) / 2 - 0.04, y1 - 0.15, bz + s * (w / 2 + 0.005));
          pane.rotation.y = s > 0 ? 0 : Math.PI;
          pane.userData.windowGroup = 'airport-bridge';
          shell.add(pane);
        }
      });
      // The cab, turned to the plane: a cream box under a steel roof with the green skirt, windows
      // ahead and to the north, and grey bellows on its south face in two folds, stopping short of
      // the parked fuselage.
      const c0 = cabX - 0.31,
        c1 = cabX + 0.31,
        cz0 = bz - 0.36,
        cz1 = J.bellows - site.z - 0.1,
        cy0 = J.floor - 0.06,
        cy1 = cy0 + 0.66;
      solid(c0, c1, cy0, cy1, cz0, cz1, L.render, 'paint', { bevel: 0.03 });
      steel.push(block(c0 - 0.03, c1 + 0.03, cy1, cy1 + 0.07, cz0 - 0.03, cz1 + 0.03));
      green.push(block(c0 - 0.015, c1 + 0.015, cy0 - 0.01, cy0 + 0.13, cz0 - 0.015, cz1 + 0.015));
      rubber.push(
        block(cabX - 0.26, cabX + 0.26, cy0 + 0.04, cy1 - 0.04, cz1 - 0.02, cz1 + 0.05),
        block(cabX - 0.22, cabX + 0.22, cy0 + 0.08, cy1 - 0.08, cz1 + 0.03, cz1 + 0.1),
      );
      for (const [x, z, ry, wide] of [[c0 - 0.005, (cz0 + cz1) / 2, -Math.PI / 2, 0.44], [cabX, cz0 - 0.005, Math.PI, 0.38]] as const) {
        const pane = new T.Mesh(new T.PlaneGeometry(wide, 0.2), material(palette.glass, 'glass'));
        pane.position.set(x, cy1 - 0.17, z);
        pane.rotation.y = ry;
        pane.userData.windowGroup = 'airport-bridge';
        shell.add(pane);
      }
      // Its footing (concrete, from y 0 like the plinth) and two steel legs under the outer section.
      const lx = J.legs - site.x;
      footing.push(block(lx - 0.2, lx + 0.2, 0, A.deck + 0.07, bz - 0.26, bz + 0.26));
      for (const s of [-1, 1]) steel.push(block(lx - 0.05, lx + 0.05, A.deck + 0.06, J.floor - 0.02, bz + s * 0.16 - 0.05, bz + s * 0.16 + 0.05));
      steel.push(block(lx - 0.07, lx + 0.07, J.floor - 0.12, J.floor - 0.02, bz - 0.24, bz + 0.24));
    }

    merge(shell, stone, L.dressing, 'stone', { tone: 0.05 });
    merge(shell, courses, L.rustic, 'paint', { tone: 0.03 });
    merge(shell, green, L.green, 'paint');
    merge(shell, slate, L.slate, 'stone');
    merge(shell, ribs, L.rib, 'copper');
    merge(shell, steel, L.steel, 'paint');
    merge(shell, rubber, L.rubber, 'paint');
    merge(shell, footing, L.footing, 'stone');
    merge(shell, bars, L.green, 'paint', { shadow: false });
    merge(shell, iron, L.iron, 'iron', { shadow: false });
  }
  return { airportGround, buildAirport };
}
export type Airport = ReturnType<typeof createAirport>;
