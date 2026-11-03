import * as T from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SurfaceKind } from './city-materials';
import * as plan from './town-plan';
import { palette, hash, noise2, WATER, type TownContext } from './town-shared';
import { shoreHeight } from './town-ground';
import type { Kit, Piece } from './town-kit';
import type { Props } from './town-props';

/**
 * The airport's colours, each no more saturated than its palette family: the cool greys of the
 * quarried armour (two of its six dark, so about a stone in three is), all a step under the
 * coping's kerb stone, and the darker rubble under it; the coping's and the parapets' kerb stone,
 * the runway's and the taxiway's dark matte concrete (the runway a step darker and cooler than the
 * town's asphalt, so it never reads as another road), the apron's mid-grey concrete and its bay
 * joints a step darker (the tones of the placement boxes the owner approved), the cream threshold
 * paint, the muted ochre lead-in line, the hall's cream render under a verdigris roof (the Town
 * Hall's copper), the board's dark slate and amber rows in a dark green-grey frame.
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
  dressing: palette.trim,
  roof: palette.copper,
  slate: '#3b4146',
  amber: '#dcae52',
  frame: '#3d4a47',
};
/** The hall lane's kerb radii where it meets the ring's footway, and the width of its flush edging. */
export const LANE_DRESSING = { radius: 0.5, edge: 0.1 };
/** The hall's levels (y): its floor on the plinth, the walls' top (the eaves) and the barrel roof's apex. */
export const HALL_LEVELS = { floor: 0.7, eave: 2.92, apex: 4.0 };
/** The island's edge, out from the deck's edge: the coping's outer face, and the armour's bed from there to its toe (o, y). */
const EDGE = { coping: 0.05, bed: [[0.03, 0.31], [0.92, -0.58]] as [number, number][] };

/** One point of a swept band: where it is, its outward normal (in x, z) and its base height. */
type Station = { x: number; z: number; nx: number; nz: number; y: number };

/* ------------------------------------------------------------------ */
/* The airport                                                         */
/* ------------------------------------------------------------------ */
export function createAirport(ctx: TownContext, kit: Kit, props: Props) {
  const { material } = ctx;
  const { box, chamfered, cluster, frameRing, windowAt, rod } = kit;
  const { lamp } = props;
  const A = plan.AIRPORT,
    R = plan.AIRPORT_ROAD,
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
      top = A.deck + 0.03;
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
    // Markings, never under 0.25 wide: at each threshold four bars along the runway either side of
    // its centre line, then a pair of broad aiming blocks; no centre-line dashes, no numbers. On the
    // apron the stand's lead-in line, ending at the parked plane's nose.
    const paint: Piece[] = [],
      y = top + 0.004;
    for (const end of [-1, 1]) {
      const from = end < 0 ? RW.x0 : RW.x1,
        bar = (a: number, b: number, c: number, width: number) => {
          const [x0, x1] = [from - end * a, from - end * b].sort((p, q) => p - q);
          paint.push({ geometry: flat(x1 - x0, width), at: [(x0 + x1) / 2, y, RW.z + c] });
        };
      for (const c of [-0.675, -0.225, 0.225, 0.675]) bar(0.3, 1.5, c, 0.25);
      for (const c of [-0.5, 0.5]) bar(3.0, 4.4, c, 0.3);
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
    for (const z of lampsAt)
      lamp(g, R.x + mid, z, 1.6, plan.airportRoadTop(z) + 0.5).traverse((o) => {
        if (!(o instanceof T.Mesh) || !o.castShadow || (o.material as T.Material).userData.surfaceKind === 'brass') return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        if (o.geometry.boundingBox!.min.y > 1.0) {
          o.castShadow = false;
          o.userData.noShadow = true;
        }
      });
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

  /**
   * The airport's ground, in its own group (the town's `airportLand`, batched on its own): the deck,
   * its coping and armour, the runway, taxiway, apron and forecourt with their markings, the road from
   * the ring over the beach ramp and the causeway, its parapets and lamps. The boulders of the
   * armour and the causeway's flanks are merged into one geometry before batching.
   */
  function airportGround(g: T.Group) {
    deckLawn(g);
    const rocks = deckEdge(g);
    surfaces(g);
    asphalt(g);
    laneDressing(g);
    causeway(g, rocks);
    const merged = mergeGeometries(rocks, false)!;
    rocks.forEach((r) => r.dispose());
    STONE.forEach((s) => s.dispose());
    solid(g, merged, '#ffffff', 'stone', { name: 'airport-armour' });
  }

  /* ---------------------------------------------------------------- */
  /* The Departures Hall, its link block and the control tower        */
  /* ---------------------------------------------------------------- */
  /**
   * The building 'airport' (site.w 6.6, site.d 3.8; front +z, toward the causeway): a first massing,
   * already in the town's language. The Departures Hall (x -3.2..1.0 here, centred on the
   * causeway's axis): a battered stone plinth, cream rendered walls 2.2 high between buff corner
   * pilasters, a verdigris barrel roof with bull-nosed eaves, and in the south gable an open arch
   * 2.4 wide in a buff voussoir band with a keystone: a glazed screen at the back of its porch, the
   * blank board hung in its mouth (dark slate in a dark frame, three amber rows lit all night, no
   * glyphs). East of it a low link block, then the control tower: a tapered cream shaft with
   * verdigris bands, an octagonal cab of raked glass, a thick cap and a short mast to 7.0.
   * Window roles: the hall's and the link's glass 'civic' (the batch's), the cab 'kiosk', the
   * board's rows 'beacon'.
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
      dress: Piece[] = [],
      iron: Piece[] = [];
    /** A box between two corners (local x0..x1, y0..y1, za..zb). */
    const block = (g: T.Object3D, x0: number, x1: number, y0: number, y1: number, za: number, zb: number, colour: string, kind: SurfaceKind, opts: { bevel?: number } = {}) =>
      box(g, (x0 + x1) / 2, (y0 + y1) / 2, (za + zb) / 2, x1 - x0, y1 - y0, zb - za, colour, kind, opts);
    const piece = (x0: number, x1: number, y0: number, y1: number, za: number, zb: number): Piece => ({ geometry: chamfered(x1 - x0, y1 - y0, zb - za), at: [(x0 + x1) / 2, (y0 + y1) / 2, (za + zb) / 2] });
    // The barrel: an arc through the apex and the eaves' edges (0.2 out from the walls), 0.14 thick.
    const chord = hw + 0.2,
      rise = apex - (eave - 0.02),
      Ro = (chord * chord + rise * rise) / (2 * rise),
      yc = apex - Ro,
      Ri = Ro - 0.14,
      under = (x: number) => yc + Math.sqrt(Math.max(0, Ri * Ri - x * x)); // the vault's underside over x

    /* Plinths: the hall's (battered), the link's a little lower, the tower's drum a little higher. */
    box(shell, hx, floor / 2, (z0 + z1) / 2, 2 * hw + 0.24, floor, z1 - z0 + 0.24, palette.plinth, 'ashlar', { taper: floor * 0.105 });
    block(shell, hx + hw + 0.12, hx + hw + 0.9, 0, floor - 0.04, -1.3, 1.3, palette.plinth, 'ashlar');

    /* The walls: the back gable, the body, and the front gable round the arch's porch. */
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
      const m = new T.Mesh(
        new T.ExtrudeGeometry(gable(open), { depth: depth - 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelOffset: -0.02, bevelSegments: 1, curveSegments: 24 }),
        material(L.render, 'paint'),
      );
      m.position.set(hx, 0, za + 0.02);
      m.castShadow = m.receiveShadow = true;
      shell.add(m);
    }
    block(shell, hx - hw, hx + hw, floor, eave + 0.02, z0 + 0.3, z1 - porch, L.render, 'paint', { bevel: 0.02 });

    /* The roof: the barrel shell over both gables, and a bull-nosed roll along each eave. */
    {
      const a = Math.asin(chord / Ro),
        b = Math.asin(chord / Ri),
        s = new T.Shape();
      s.absarc(0, yc, Ro, Math.PI / 2 + a, Math.PI / 2 - a, true);
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
        high = yc + Ro * Math.cos(a);
      for (const side of [-1, 1]) {
        const roll = new T.Mesh(new T.CylinderGeometry(0.13, 0.13, len, 16).rotateX(Math.PI / 2), material(L.roof, 'copper'));
        roll.position.set(hx + side * (chord - 0.04), (low + high) / 2, (z0 + z1) / 2);
        roll.castShadow = roll.receiveShadow = true;
        roll.userData.band = true;
        shell.add(roll);
      }
    }

    /* Pilasters: buff, at the four corners (0.42 square, 0.08 proud both ways) and between the west windows. */
    for (const [x, z] of [[hx - hw, z1], [hx + hw, z1], [hx - hw, z0], [hx + hw, z0]]) {
      const cx = x - Math.sign(x - hx) * 0.13,
        cz = z - Math.sign(z) * 0.13;
      dress.push(piece(cx - 0.21, cx + 0.21, floor - 0.02, eave - 0.14, cz - 0.21, cz + 0.21));
      dress.push(piece(cx - 0.26, cx + 0.26, eave - 0.16, eave - 0.02, cz - 0.26, cz + 0.26));
    }
    dress.push(piece(hx - hw - 0.08, hx - hw + 0.12, floor - 0.02, eave - 0.14, -0.21, 0.21));
    dress.push(piece(hx - hw - 0.12, hx - hw + 0.12, eave - 0.16, eave - 0.02, -0.26, 0.26));

    /* The arch: its voussoir band and keystone on the gable's face, the porch's screen and the board. */
    frameRing(shell, hx, (floor + spring) / 2, z1, archW, spring - floor, 0.22, 0.1, L.dressing, 'stone', true, true);
    dress.push(piece(hx - 0.16, hx + 0.16, spring + archW / 2 + 0.02, spring + archW / 2 + 0.44, z1, z1 + 0.15));
    {
      // The glazed screen at the back of the porch: doors below, a fanlight in the arch's head; one
      // light, kept on late (0.8, as the civic fronts are).
      const back = z1 - porch,
        doors = new T.Mesh(new T.PlaneGeometry(archW - 0.3, spring - floor - 0.05), material(palette.glass, 'glass')),
        fan = new T.Shape();
      doors.position.set(hx, (floor + spring) / 2, back + 0.03);
      doors.userData.windowGroup = 'airport-doors';
      doors.userData.windowLit = 0.8;
      shell.add(doors);
      fan.absarc(0, 0, archW / 2 - 0.15, 0, Math.PI, false);
      fan.closePath();
      const fanlight = new T.Mesh(new T.ShapeGeometry(fan, 12), material(palette.glass, 'glass'));
      fanlight.position.set(hx, spring + 0.03, back + 0.03);
      fanlight.userData.windowGroup = 'airport-doors';
      shell.add(fanlight);
      iron.push(piece(hx - archW / 2 + 0.12, hx + archW / 2 - 0.12, spring - 0.03, spring + 0.05, back, back + 0.08));
      iron.push(piece(hx - 0.04, hx + 0.04, floor, spring, back, back + 0.08));
    }
    {
      // The board, hung in the arch's mouth 0.14 behind the gable's face: a dark frame, a slate face
      // and three amber rows, blank (no glyphs, no numbers), on two hangers from the arch's soffit.
      const y = 1.975,
        z = z1 - 0.2;
      block(shell, hx - 1.05, hx + 1.05, y - 0.43, y + 0.43, z - 0.06, z + 0.02, L.frame, 'paint', { bevel: 0.025 });
      block(shell, hx - 0.97, hx + 0.97, y - 0.35, y + 0.35, z + 0.02, z + 0.045, L.slate, 'stone', { bevel: 0 });
      for (const dy of [0.26, 0, -0.26]) block(shell, hx - 0.85, hx + 0.85, y + dy - 0.08, y + dy + 0.08, z + 0.045, z + 0.06, L.amber, 'glass', { bevel: 0 }).userData.window = 'beacon';
      const soffit = spring + Math.sqrt((archW / 2) ** 2 - 0.8 ** 2);
      for (const s of [-1, 1]) iron.push(piece(hx + s * 0.8 - 0.035, hx + s * 0.8 + 0.035, y + 0.42, soffit + 0.03, z - 0.055, z + 0.015));
    }
    /* Two steps up from the forecourt to the hall's floor, wider than the arch's band. Like the
     * plinth they stand on y 0 (the deck hides their foot), so Inspect sees them on the ground. */
    for (let i = 0; i < 2; i++)
      block(shell, hx - archW / 2 - 0.3 + i * 0.08, hx + archW / 2 + 0.3 - i * 0.08, 0, A.deck + 0.06 + 0.12 * (i + 1), z1 + 0.1, z1 + 0.1 + 0.3 * (2 - i), palette.plinth, 'stone');

    /* Windows: two arched on the west wall, two on the back. */
    for (const [face, along] of [
      [{ x: hx - hw, z: 0, ry: -Math.PI / 2 }, [-0.72, 0.72]],
      [{ x: hx, z: z0, ry: Math.PI }, [-1.0, 1.0]],
    ] as const) {
      const f = new T.Group();
      f.position.set(face.x, 0, face.z);
      f.rotation.y = face.ry;
      shell.add(f);
      for (const u of along) windowAt(f, u, 1.65, 0, 0.62, 0.8, { arched: true, frame: palette.white, dress: L.dressing, lintel: false });
    }

    /* The link block: low and cream under a flat buff-capped roof, a window to the south. */
    {
      const x0 = hx + hw,
        x1 = hx + hw + 0.8;
      block(shell, x0 - 0.05, x1, floor - 0.04, 2.05, -1.2, 1.2, L.render, 'paint', { bevel: 0.03 });
      const cap = block(shell, x0 - 0.05, x1 + 0.08, 2.05, 2.17, -1.28, 1.28, L.dressing, 'stone', { bevel: 0.03 });
      cap.userData.roof = true;
      cap.userData.eaveY = 2.05;
      const cx = (x0 + x1) / 2 + 0.02,
        glass = new T.Mesh(new T.PlaneGeometry(0.42, 0.62), material(palette.glass, 'glass'));
      glass.position.set(cx, 1.35, 1.2 + 0.03);
      shell.add(glass);
      frameRing(shell, cx, 1.35, 1.2, 0.42, 0.62, 0.08, 0.08, palette.white, 'paint');
    }

    /* The control tower. */
    {
      const tx = 3.9 - site.x,
        tz = -47.4 - site.z,
        octagon = (rt: number, rb: number, h: number, open = false) => {
          const g = new T.CylinderGeometry(rt, rb, h, 8, 1, open).toNonIndexed();
          g.computeVertexNormals();
          return g;
        },
        at = (geometry: T.BufferGeometry, colour: string, kind: SurfaceKind, y: number) => {
          const m = new T.Mesh(geometry, material(colour, kind));
          m.position.set(tx, y, tz);
          m.castShadow = m.receiveShadow = true;
          shell.add(m);
          return m;
        };
      at(new T.CylinderGeometry(0.58, 0.62, 0.78, 24), palette.plinth, 'ashlar', 0.39);
      at(new T.CylinderGeometry(0.36, 0.44, 4.37, 24), L.render, 'paint', 0.78 + 4.37 / 2);
      for (const y of [2.3, 3.95]) {
        const r = 0.44 - ((y - 0.78) / 4.37) * 0.08 + 0.03;
        at(new T.CylinderGeometry(r - 0.004, r, 0.16, 24), L.roof, 'paint', y);
      }
      // The cab: a gallery floor, raked glass wider at the top, slim corner posts, the cap and the mast.
      at(octagon(0.76, 0.66, 0.14), L.roof, 'paint', 5.22);
      at(octagon(0.82, 0.68, 1.04, true), palette.glass, 'glass', 5.81).userData.window = 'kiosk';
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        iron.push(rod([tx + Math.sin(a) * 0.69, 5.29, tz + Math.cos(a) * 0.69], [tx + Math.sin(a) * 0.83, 6.33, tz + Math.cos(a) * 0.83], 0.04));
      }
      at(octagon(0.95, 0.9, 0.2), L.roof, 'paint', 6.43);
      at(new T.CylinderGeometry(0.42, 0.5, 0.16, 24), L.roof, 'paint', 6.61);
      iron.push(rod([tx, 6.6, tz], [tx, 7.0, tz], 0.045));
    }

    cluster(shell, dress, L.dressing, 'stone');
    cluster(shell, iron, L.frame, 'iron', { shadow: false });
  }
  return { airportGround, buildAirport };
}
export type Airport = ReturnType<typeof createAirport>;
