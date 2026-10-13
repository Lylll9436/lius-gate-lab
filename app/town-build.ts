import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  createCityMaterials,
  GROUND_HEIGHT_RANGE,
  GROUND_KINDS,
  projectMaterialUV,
  type SurfaceKind,
} from './city-materials';
import { createResident } from './city-people';
import { buildings, type BuildingId } from './city-data';
import * as plan from './town-plan';
import type { XZ } from './town-plan';

/**
 * The town itself: terrain, streets, seven buildings, trees,
 * street furniture, the harbour, the lighthouse and the things that move.
 * Everything is procedural and merged into a few draw calls per surface family.
 */

export type Model = {
  root: T.Group;
  shell: T.Group;
  fade: T.MeshStandardMaterial[];
  center: T.Vector3;
  /** Invisible box for pointer picking, set by the scene. */
  hit?: T.Mesh;
};
export type Walker = { root: T.Group; loop: XZ[]; distance: number; speed: number };

export const palette = {
  blonde: '#dcc08c', pale: '#e6d2a2', red: '#b8604a', brick: '#a4452e', brickLight: '#dcc08c',
  trim: '#ecdcb6', trimRed: '#d29a7c', frame: '#f5efe0', stoneDark: '#c4a878', plinth: '#c4a878', plinthRed: '#93503c',
  slate: '#8fa4b9', slateLight: '#a9b8c6', slateDark: '#8fa4b9', // alias: no dark slate; delete once unused (Step 19)
  copper: '#6faf9b', copperLight: '#8cc7b2', pantile: '#c8644a', pantileLight: '#d98a6c',
  glass: '#6fa8c4', glassDark: '#6fa8c4', studioGlass: '#8cc4d8', ink: '#26313a',
  greenDoor: '#2e6e4c', blueDoor: '#2d5f8f', redDoor: '#b23a30',
  wood: '#a06b3e', woodDark: '#6b4529', metal: '#4b545b', bronze: '#a87b45', gold: '#e8b84a',
  road: '#6b7279', roadLine: '#e8e2cc', kerb: '#cfc3a6', pavement: '#d4c4a0', plaza: '#d4c4a0', plazaDark: '#bfac86', path: '#b8946a',
  pool: '#2a86b0', poolEdge: '#62c0d4', poolWater: '#3fa6c4', render: '#f2e9d6',
  grass: '#a2bf50', grassLight: '#aac757', grassDark: '#98b74a', lawnPad: '#8bb038', lawnEdge: '#7a9638',
  sand: '#e4cc94', sandWet: '#c2a675', soil: '#6b4a2e',
  canopy: ['#7aab2e', '#93bb3a', '#86b234', '#6f9e2a'], hedge: '#5e8f28', hedgeTop: '#93bb3a',
  autumn: ['#d39a3a', '#e0ab45', '#c8862f', '#d9a03c'], blossom: ['#f0a6bd', '#f4b8cb', '#e894b0', '#f6c4d3'],
  pine: ['#3e8a4a', '#357a40', '#4a9655'], bark: '#6b4529', pineBark: '#5c3c22',
  flowers: ['#e5483c', '#f6c63f', '#f18fb0', '#f5efe0', '#8e6ad0'],
  white: '#f5efe0', lantern: '#ffd48a', tram: '#2f6b4a', tramOrange: '#e07a2c', tramCream: '#efe2c2',
  boat: '#c9412f', balloon: '#c9412f', balloonBand: '#efe2c2',
};

type Point = [number, number, number];
/** batch() bakes contact and eave distances up to this many units (the shader's `aBake * 4.`). */
const BAKE_RANGE = 4;
const unitBox = new T.BoxGeometry(1, 1, 1);
/**
 * Soft, rendered-object edges: every box thicker than a slab gets a small rounded edge,
 * so the environment light draws a highlight along it instead of a hard pixel step.
 * Geometries are shared per size; batching bakes them into the merged meshes anyway.
 */
const roundedBoxes = new Map<string, RoundedBoxGeometry>();
function roundedBox(w: number, h: number, d: number, radius: number, segments: number) {
  const key = [w, h, d, radius, segments].map((n) => n.toFixed(4)).join('|');
  let geometry = roundedBoxes.get(key);
  if (!geometry) {
    geometry = new RoundedBoxGeometry(w, h, d, segments, radius);
    roundedBoxes.set(key, geometry);
  }
  return geometry;
}
const hash = plan.hash;
function noise2(x: number, z: number) {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    fx = x - ix,
    fz = z - iz,
    u = fx * fx * (3 - 2 * fx),
    v = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number) => hash(a * 311 + b * 727 + 1);
  return T.MathUtils.lerp(
    T.MathUtils.lerp(h(ix, iz), h(ix + 1, iz), u),
    T.MathUtils.lerp(h(ix, iz + 1), h(ix + 1, iz + 1), u),
    v,
  );
}

/* ------------------------------------------------------------------ */
/* Planting kit: baked two-tone ramps for trees, hedges and beds       */
/* ------------------------------------------------------------------ */

/** Tree looks: body tones, a warm lime crown and a cool dark underside. */
const TREE = {
  round:   { tones: [palette.canopy[0], palette.canopy[1]], top: '#d2dc58', under: '#3c6a2e' },
  autumn:  { tones: [palette.autumn[0], palette.autumn[1]], top: '#f2c862', under: '#99582a' },
  blossom: { tones: [palette.blossom[0], palette.blossom[1]], top: '#fdd9e3', under: '#bf7590' },
  pine:    { tones: [palette.pine[0], palette.pine[1]], top: '#74b155', under: '#22503a' },
  trunk: palette.bark, pineTrunk: palette.pineBark,
};
const sstep = T.MathUtils.smoothstep, mix = T.MathUtils.lerp;
/** Bake colour × value(y) into vertex colours, e.g. a trunk that darkens up into its canopy. */
export function paintByHeight(geo: T.BufferGeometry, colour: string, value: (y: number) => number) {
  const p = geo.getAttribute('position'), c = new T.Color(colour), out = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const f = value(p.getY(i)); out[i*3] = c.r*f; out[i*3+1] = c.g*f; out[i*3+2] = c.b*f; }
  geo.setAttribute('color', new T.BufferAttribute(out, 3));
  return geo;
}
/** One lump in tree space: only spun about y, so the squash and the ramp stay vertical. */
export function canopyLump(r: number, detail: number, x: number, y: number, z: number, spin: number) {
  const g = new T.IcosahedronGeometry(r, detail);
  g.rotateY(spin); g.scale(1, 0.85, 1); g.translate(x, y, z);
  return g;
}
/** Clash two-tone: cool dark underside, warm lime crown, darker creases where lumps meet. */
function paintCanopy(geos: T.BufferGeometry[], spheres: number[][], look: { top: string; under: string }, tone: string, y0: number, y1: number) {
  const base = new T.Color(tone), top = new T.Color(look.top), under = new T.Color(look.under), c = new T.Color();
  geos.forEach((g, k) => {
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), out = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), v = sstep(y, y0, y1);
      let f = mix(0.45, 1.05, sstep(v, 0.12, 0.88));
      spheres.forEach(([sx, sy, sz, sr], j) => {
        if (j === k) return;
        const gap = Math.hypot(x - sx, (y - sy) / 0.85, z - sz) - sr;
        if (gap > 0) f *= 1 - 0.3 * (1 - sstep(gap, 0, 0.3 * sr));
      });
      c.copy(base).lerp(under, 0.3 * (1 - v)).lerp(top, 0.35 * sstep(v, 0.55, 1) * Math.max(0, n.getY(i)));
      out[i*3] = c.r*f; out[i*3+1] = c.g*f; out[i*3+2] = c.b*f;
    }
    g.setAttribute('color', new T.BufferAttribute(out, 3));
  });
}
const BLOOMS = palette.flowers;
const bloomGeometry = (() => { const g = new T.IcosahedronGeometry(0.1, 0); g.setAttribute('normal', g.getAttribute('position').clone()); g.normalizeNormals(); return g; })(); // 20 tris, smooth blob
/**
 * Clone a shared box geometry and bake a bottom->top ramp plus a tint on up-facing tops (use with '#ffffff').
 * Keep `bottom` near 0.9: the batch bake already darkens every base towards the ground.
 */
function bakeRamp(m: T.Mesh, colour: string, bottom: number, top: number, tint = colour, amount = 0) {
  const geo = (m.geometry = (m.geometry as T.BufferGeometry).clone()); geo.computeBoundingBox();
  const { min, max } = geo.boundingBox!, p = geo.getAttribute('position'), n = geo.getAttribute('normal');
  const a = new T.Color(colour), b = new T.Color(tint), c = new T.Color(), out = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const v = (p.getY(i) - min.y) / Math.max(1e-6, max.y - min.y), f = mix(bottom, top, v);
    c.copy(a).lerp(b, amount * v * sstep(n.getY(i), 0.2, 0.9));
    out[i*3] = c.r*f; out[i*3+1] = c.g*f; out[i*3+2] = c.b*f;
  }
  geo.setAttribute('color', new T.BufferAttribute(out, 3)); return m;
}

/* ------------------------------------------------------------------ */
/* Layout shared by the town and its ground masks                      */
/* ------------------------------------------------------------------ */

/** The plaza's reflecting pool ring, cut by four causeways. */
const POOL = { inner: 2.0, outer: 3.65 },
  POOL_GAP = Math.asin(1.05 / ((POOL.inner + POOL.outer) / 2));
/** One planter per pool sector, between the pool and the plaza rim; its long side runs radially. */
const PLANTER = { radius: 4.45, w: 1.1, d: 0.5 };
const plazaPlanters = () =>
  [0, 1, 2, 3].map((i) => {
    const a = (Math.PI / 2) * i + POOL_GAP + (Math.PI / 2 - POOL_GAP * 2) / 2;
    return { a, x: Math.cos(a) * PLANTER.radius, z: Math.sin(a) * PLANTER.radius };
  });
/** The park's bandstand stands just behind the park centre. */
const bandstandAt = (): XZ => [plan.park.x, plan.park.z - 0.3];
const CRANE_BASE = 1.4,
  HOARDING_THICKNESS = 0.06;
/** The hoarding round the reserved plot: offset from the plot centre, length, rotation. */
const hoardingWalls = (plot: typeof plan.reservedPlot) =>
  [
    [0, -plot.d / 2, plot.w, 0],
    [0, plot.d / 2, plot.w, 0],
    [-plot.w / 2, 0, plot.d, Math.PI / 2],
    [plot.w / 2, 0, plot.d, Math.PI / 2],
  ] as const;

/* ------------------------------------------------------------------ */
/* Ground masks                                                        */
/* ------------------------------------------------------------------ */

/** One RGBA8 grid over ±MASK_EXTENT (0.34 units per texel); texel i runs along x, row j along z. */
export const MASK_EXTENT = 44,
  MASK_SIZE = 256;
/** Separable box blur along rows or columns, with a running sum and clamped edges. */
function boxBlur(src: Float32Array, dst: Float32Array, alongX: boolean, radius = 2) {
  const N = MASK_SIZE,
    width = radius * 2 + 1;
  for (let line = 0; line < N; line++) {
    const at = (k: number) => {
      const c = Math.min(N - 1, Math.max(0, k));
      return alongX ? line * N + c : c * N + line;
    };
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[at(k)];
    for (let k = 0; k < N; k++) {
      dst[at(k)] = sum / width;
      sum += src[at(k + radius + 1)] - src[at(k - radius)];
    }
  }
}
/**
 * Baked ground masks, all from plan data so later layout changes stay in sync.
 * R: ground darkening (footprint pads, canopy and trunk discs, lamp feet, the grass lip by the pavements).
 * G: the shallow-water ring round the coast and the lighthouse rock.
 * B: the mown town lawn (plan.lawnCore). A: terrain height over GROUND_HEIGHT_RANGE.
 */
export function buildGroundMasks(trees: plan.TreeSpec[], lampSpecs: plan.LampSpec[]) {
  const N = MASK_SIZE,
    E = MASK_EXTENT,
    texel = (2 * E) / N,
    centre = (i: number) => -E + (i + 0.5) * texel,
    ao = new Float32Array(N * N);
  const range = (lo: number, hi: number) =>
    [Math.max(0, Math.floor((lo + E) / texel)), Math.min(N - 1, Math.ceil((hi + E) / texel))] as const;
  /** Max-combine value(dx, dz) into every texel within `reach` of (cx, cz). */
  const stamp = (cx: number, cz: number, reach: number, value: (dx: number, dz: number) => number) => {
    const [i0, i1] = range(cx - reach, cx + reach),
      [j0, j1] = range(cz - reach, cz + reach);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const v = value(centre(i) - cx, centre(j) - cz);
        if (v > ao[j * N + i]) ao[j * N + i] = v;
      }
  };
  /** A w×d rectangle turned by ry (as rotation.y), full strength inside, fading over `margin` outside. */
  const rect = (cx: number, cz: number, w: number, d: number, ry: number, strength: number, margin: number) => {
    const c = Math.cos(ry),
      s = Math.sin(ry);
    stamp(cx, cz, Math.hypot(w, d) / 2 + margin, (dx, dz) => {
      const lx = dx * c - dz * s,
        lz = dx * s + dz * c,
        out = Math.hypot(Math.max(0, Math.abs(lx) - w / 2), Math.max(0, Math.abs(lz) - d / 2));
      return strength * (1 - T.MathUtils.smoothstep(out, 0, margin));
    });
  };
  const disc = (cx: number, cz: number, r: number, strength: number, feather: number) =>
    stamp(cx, cz, r + feather, (dx, dz) => strength * (1 - T.MathUtils.smoothstep(Math.hypot(dx, dz) - r, 0, feather)));

  for (const s of plan.siteList) rect(s.x, s.z, s.w + 0.4, s.d + 0.4, s.rotation, 1, 0.6);
  for (const c of plan.cottages) rect(c.x, c.z, 3.0, 2.6, c.rotation, 1, 0.5);
  const plot = plan.reservedPlot;
  rect(plot.x, plot.z, CRANE_BASE, CRANE_BASE, 0, 0.9, 0.4);
  for (const [dx, dz, l, ry] of hoardingWalls(plot)) rect(plot.x + dx, plot.z + dz, l, HOARDING_THICKNESS, ry, 0.5, 0.3);
  for (const p of plazaPlanters()) rect(p.x, p.z, PLANTER.w, PLANTER.d, -p.a, 0.7, 0.35);
  const [bx, bz] = bandstandAt();
  disc(bx, bz, 2.1, 1, 0.5);
  for (const t of trees) {
    disc(t.x, t.z, 1.0 * t.size, 0.45, 0.5);
    disc(t.x, t.z, 0.3 * t.size, 0.85, 0.3);
  }
  const scratch = new Float32Array(N * N);
  for (let pass = 0; pass < 2; pass++) {
    boxBlur(ao, scratch, true);
    boxBlur(scratch, ao, false);
  }
  // Features about a texel wide go in after the blur, which would flatten them to nothing;
  // their own falloffs and the texture's linear filtering keep them soft.
  for (const l of lampSpecs) disc(l.x, l.z, 0.25, 0.5, 0.2);
  // A darker grass lip along the pavements and the plaza rim; only texels near the ring can have one.
  // The 0.4-unit ramp is barely wider than a texel, so it starts half a texel out: the first grass
  // texel then always carries the full 0.35, wherever the edge falls between texel centres.
  const { ring } = plan,
    [li0, li1] = range(-ring.hw - 3, ring.hw + 3),
    [lj0, lj1] = range(ring.cz - ring.hd - 3, ring.cz + ring.hd + 3);
  for (let j = lj0; j <= lj1; j++)
    for (let i = li0; i <= li1; i++) {
      const x = centre(i),
        z = centre(j),
        pd = Math.min(plan.distanceToStreets(x, z) - plan.PAVEMENT_WIDTH, Math.hypot(x, z) - plan.PLAZA_RADIUS);
      const lip = pd > 0 ? 0.35 * (1 - Math.max(0, pd - texel / 2) / 0.4) : 0;
      if (lip > ao[j * N + i]) ao[j * N + i] = lip;
    }

  const data = new Uint8Array(N * N * 4),
    [rockX, rockZ] = plan.lighthouseRock,
    byte = (v: number) => Math.round(T.MathUtils.clamp(v, 0, 1) * 255);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = centre(i),
        z = centre(j),
        k = (j * N + i) * 4,
        offshore = Math.hypot(x, z) - plan.islandRadius(Math.atan2(z, x));
      const shallow = Math.max(
        1 - T.MathUtils.smoothstep(offshore, 2.6, 7.5),
        1 - T.MathUtils.smoothstep(Math.hypot(x - rockX, z - rockZ), 1.5, 4),
      );
      data[k] = byte(ao[j * N + i]);
      data[k + 1] = byte(shallow);
      data[k + 2] = byte(plan.lawnCore(x, z));
      data[k + 3] = byte(plan.terrainHeight(x, z) / GROUND_HEIGHT_RANGE);
    }
  const texture = new T.DataTexture(data, N, N, T.RGBAFormat, T.UnsignedByteType);
  texture.colorSpace = T.NoColorSpace;
  texture.minFilter = texture.magFilter = T.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = T.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.name = 'ground-masks';
  texture.needsUpdate = true;
  return texture;
}

export function buildTown(
  options: { library?: ReturnType<typeof createCityMaterials> } = {},
) {
  const library = options.library || createCityMaterials();
  const material = library.material;
  const city = new T.Group(),
    land = new T.Group();
  city.name = 'town';
  land.name = 'land';
  city.add(land);
  const lamps: T.Mesh[] = [],
    clocks: { hour: T.Object3D; minute: T.Object3D }[] = [],
    animated: { object: T.Object3D; update: (time: number, night: number) => void }[] = [];

  /* ---------------------------------------------------------------- */
  /* Primitives                                                        */
  /* ---------------------------------------------------------------- */
  function box(
    g: T.Object3D,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: string,
    kind?: SurfaceKind,
    opts: { bevel?: number; segments?: number; taper?: number; ry?: number; rx?: number; rz?: number } = {},
  ) {
    const mat = material(color, kind);
    const thinnest = Math.min(w, h, d);
    // Clash bevel: r = clamp(0.2*thinnest, 0.03, 0.12), x0.6 on metal; plates under 0.1 stay sharp.
    // An explicit bevel overrides the automatic one ({ bevel: 0 } is sharp); under 0.06 is always sharp.
    const auto =
      thinnest >= 0.1
        ? T.MathUtils.clamp(0.2 * thinnest, 0.03, 0.12) * (mat.userData.surfaceKind === 'metal' ? 0.6 : 1)
        : 0;
    const radius = thinnest < 0.06 ? 0 : Math.min(opts.bevel ?? auto, thinnest * 0.45);
    let geometry: T.BufferGeometry = radius > 0 ? roundedBox(w, h, d, radius, opts.segments ?? 1) : unitBox;
    if (opts.taper && radius > 0) { // battered plinths: top ring pulled in by `taper`
      geometry = geometry.clone();
      const p = geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const t = p.getY(i) / h + 0.5;
        p.setX(i, p.getX(i) * (1 - (2 * opts.taper * t) / w));
        p.setZ(i, p.getZ(i) * (1 - (2 * opts.taper * t) / d));
      }
    }
    const m = new T.Mesh(geometry, mat);
    m.position.set(x, y, z);
    if (radius <= 0) m.scale.set(w, h, d);
    if (opts.ry) m.rotation.y = opts.ry;
    if (opts.rx) m.rotation.x = opts.rx;
    if (opts.rz) m.rotation.z = opts.rz;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }
  function cylinder(
    g: T.Object3D,
    x: number,
    y: number,
    z: number,
    rTop: number,
    rBottom: number,
    h: number,
    color: string,
    kind?: SurfaceKind,
    sides = 12,
  ) {
    // Thin posts and pivots need far fewer sides than towers and tanks.
    const rr = Math.max(rTop, rBottom);
    const smooth = sides < 5 ? sides : rr < 0.06 ? 8 : rr < 0.2 ? 12 : Math.max(sides, 18);
    const m = new T.Mesh(new T.CylinderGeometry(rTop, rBottom, h, smooth), material(color, kind));
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }
  function cone(
    g: T.Object3D,
    x: number,
    y: number,
    z: number,
    r: number,
    h: number,
    color: string,
    kind?: SurfaceKind,
    sides = 4,
    ry = Math.PI / 4,
  ) {
    const smooth = sides < 5 ? sides : r < 0.2 ? 12 : Math.max(sides, 18);
    let geo: T.BufferGeometry = new T.ConeGeometry(r, h, smooth);
    if (smooth <= 6) { geo = geo.toNonIndexed(); geo.computeVertexNormals(); } // flat pyramid facets
    const m = new T.Mesh(geo, material(color, kind));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }
  function sphere(
    g: T.Object3D,
    x: number,
    y: number,
    z: number,
    r: number,
    color: string,
    kind?: SurfaceKind,
    segments = 12,
  ) {
    // Small spheres (flowers, hubs, finials) become icosahedra with smooth normals.
    const s = Math.max(segments, 18);
    const geo =
      r < 0.16
        ? new T.IcosahedronGeometry(r, 1)
        : r < 0.3
          ? new T.IcosahedronGeometry(r, 2)
          : new T.SphereGeometry(r, s, Math.round(s * 0.7));
    const m = new T.Mesh(geo, material(color, kind));
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }
  /** A pitched roof along the local x axis, with gable ends and a ridge cap. */
  function pitchedRoof(
    g: T.Object3D,
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    rise: number,
    color = palette.slate,
    opts: { ridge?: boolean; thickness?: number } = {},
  ) {
    const shape = new T.Shape();
    shape.moveTo(-d / 2, 0);
    shape.lineTo(d / 2, 0);
    shape.lineTo(0, rise);
    shape.closePath();
    const mesh = new T.Mesh(
      new T.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false }),
      material(color, 'slate'),
    );
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(x - w / 2, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    // An overhang for the eave bake, measured from the wall plate.
    mesh.userData.roof = true;
    mesh.userData.eaveY = y;
    g.add(mesh);
    if (opts.ridge !== false) {
      box(g, x, y + rise + 0.02, z, w + 0.04, 0.07, 0.16, palette.slateLight, 'slate');
    }
    // Eaves boards along the long sides.
    for (const side of [-1, 1])
      box(g, x, y + 0.02, z + (side * d) / 2, w + 0.04, 0.09, 0.08, palette.trim, 'wood');
    return mesh;
  }
  function gabledRoofEnds(
    g: T.Object3D,
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    rise: number,
    color: string,
  ) {
    // Stone gables stand 2 cm proud of the slate end faces, so the two never share a plane.
    for (const side of [-1, 1]) {
      const shape = new T.Shape();
      shape.moveTo(-d / 2 + 0.06, 0);
      shape.lineTo(d / 2 - 0.06, 0);
      shape.lineTo(0, rise - 0.04);
      shape.closePath();
      const mesh = new T.Mesh(
        new T.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false }),
        material(color),
      );
      mesh.rotation.y = Math.PI / 2;
      mesh.position.set(side > 0 ? x + w / 2 - 0.12 : x - w / 2 - 0.02, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
    }
  }
  /** A window: dark glass set into a light frame, sill and lintel. Faces local +z. */
  function windowAt(
    g: T.Object3D,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    opts: { arched?: boolean; frame?: string; sill?: boolean; bars?: number } = {},
  ) {
    const frame = opts.frame ?? palette.trim;
    box(g, x, y, z + 0.015, w, h, 0.05, palette.glassDark, 'glass');
    const t = 0.045;
    box(g, x - w / 2, y, z + 0.035, t, h + t, 0.07, frame, 'paint');
    box(g, x + w / 2, y, z + 0.035, t, h + t, 0.07, frame, 'paint');
    box(g, x, y - h / 2, z + 0.035, w + t, t, 0.07, frame, 'paint');
    if (!opts.arched) box(g, x, y + h / 2, z + 0.035, w + t, t, 0.07, frame, 'paint');
    const bars = opts.bars ?? 1;
    for (let i = 1; i <= bars; i++)
      box(g, x, y - h / 2 + (h * i) / (bars + 1), z + 0.04, w, 0.025, 0.03, frame, 'paint');
    box(g, x, y, z + 0.04, 0.025, h, 0.03, frame, 'paint');
    if (opts.sill !== false)
      box(g, x, y - h / 2 - 0.05, z + 0.07, w + 0.2, 0.07, 0.16, palette.trim, 'stone');
    if (opts.arched) {
      const arch = new T.Mesh(
        new T.CylinderGeometry(w / 2, w / 2, 0.05, 14, 1, false, Math.PI / 2, Math.PI),
        material(palette.glassDark, 'glass'),
      );
      arch.rotation.x = Math.PI / 2;
      arch.position.set(x, y + h / 2, z + 0.015);
      arch.castShadow = true;
      g.add(arch);
      const ring = new T.Mesh(
        new T.TorusGeometry(w / 2 + 0.01, 0.028, 6, 16, Math.PI),
        material(frame, 'paint'),
      );
      ring.position.set(x, y + h / 2, z + 0.04);
      g.add(ring);
      box(g, x, y + h / 2 + w / 2 + 0.03, z + 0.06, 0.12, 0.14, 0.1, palette.trim, 'stone');
    } else {
      box(g, x, y + h / 2 + 0.07, z + 0.06, w + 0.22, 0.09, 0.12, palette.trim, 'stone');
    }
  }
  function door(
    g: T.Object3D,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    color: string,
    opts: { fanlight?: boolean; steps?: number; surround?: string; width?: number } = {},
  ) {
    const surround = opts.surround ?? palette.trim;
    // The leaf stands proud of the wall face at z; the surround frames it.
    box(g, x, y + h / 2, z + 0.02, w, h, 0.08, color, 'paint');
    for (const dx of [-w * 0.26, w * 0.26])
      for (const dy of [h * 0.3, h * 0.62])
        box(g, x + dx, y + dy, z + 0.07, w * 0.34, h * 0.22, 0.02, color, 'paint', { bevel: 0.01 });
    box(g, x + w * 0.3, y + h * 0.47, z + 0.085, 0.035, 0.035, 0.035, palette.bronze, 'metal');
    for (const side of [-1, 1])
      box(g, x + side * (w / 2 + 0.07), y + h / 2 + 0.1, z + 0.02, 0.14, h + 0.2, 0.16, surround, 'stone');
    if (opts.fanlight) {
      const fan = new T.Mesh(
        new T.CylinderGeometry(w / 2, w / 2, 0.06, 14, 1, false, Math.PI / 2, Math.PI),
        material(palette.glass, 'glass'),
      );
      fan.rotation.x = Math.PI / 2;
      fan.position.set(x, y + h, z + 0.03);
      g.add(fan);
      const rim = new T.Mesh(
        new T.TorusGeometry(w / 2 + 0.02, 0.035, 6, 16, Math.PI),
        material(surround, 'stone'),
      );
      rim.position.set(x, y + h, z + 0.06);
      g.add(rim);
      box(g, x, y + h + w / 2 + 0.08, z + 0.03, w + 0.34, 0.12, 0.18, surround, 'stone');
    } else {
      box(g, x, y + h + 0.1, z + 0.03, w + 0.34, 0.16, 0.2, surround, 'stone');
    }
    const steps = opts.steps ?? 2;
    for (let s = 0; s < steps; s++) {
      const depth = 0.34 + s * 0.2;
      box(
        g,
        x,
        y - 0.07 - s * 0.09,
        z + depth / 2 + 0.02,
        (opts.width ?? w + 0.6) + s * 0.16,
        0.09,
        depth,
        palette.stoneDark,
        'stone',
      );
    }
  }
  function railing(g: T.Object3D, x: number, y: number, z: number, length: number, height: number, ry = 0) {
    const r = new T.Group();
    r.position.set(x, y, z);
    r.rotation.y = ry;
    g.add(r);
    const posts = Math.max(2, Math.round(length / 0.28));
    for (let i = 0; i < posts; i++)
      box(r, -length / 2 + (length * i) / (posts - 1), height / 2, 0, 0.022, height, 0.022, palette.metal, 'metal');
    box(r, 0, height, 0, length + 0.03, 0.03, 0.03, palette.metal, 'metal');
    box(r, 0, height * 0.45, 0, length + 0.03, 0.02, 0.02, palette.metal, 'metal');
    return r;
  }
  function balustrade(g: T.Object3D, x: number, y: number, z: number, length: number, ry = 0, color = palette.trim) {
    const r = new T.Group();
    r.position.set(x, y, z);
    r.rotation.y = ry;
    g.add(r);
    const posts = Math.max(3, Math.round(length / 0.24));
    for (let i = 0; i < posts; i++) {
      const px = -length / 2 + (length * i) / (posts - 1);
      cylinder(r, px, 0.2, 0, 0.035, 0.05, 0.36, color, 'stone', 8);
    }
    box(r, 0, 0.42, 0, length + 0.1, 0.07, 0.14, color, 'stone');
    box(r, 0, 0.03, 0, length + 0.1, 0.06, 0.14, color, 'stone');
    return r;
  }
  function quoins(g: T.Object3D, w: number, d: number, h: number, color: string, y0 = 0.1) {
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        for (let y = y0 + 0.2; y < h - 0.2; y += 0.52) {
          const long = Math.round(y * 10) % 2 === 0;
          box(g, (sx * w) / 2, y, (sz * d) / 2, long ? 0.34 : 0.22, 0.24, long ? 0.22 : 0.34, color, 'stone');
        }
  }

  /* ---------------------------------------------------------------- */
  /* Terrain                                                           */
  /* ---------------------------------------------------------------- */
  const WATER = -0.028;
  function buildTerrain() {
    const rings = 26,
      segments = plan.OUTLINE_SAMPLES;
    const positions: number[] = [],
      colors: number[] = [],
      indices: number[] = [];
    // A clean yellow-green town lawn (lawnCore: inside the ring and the terrace gardens) and a
    // patchier outer meadow, from two low octaves only so the ~1-unit vertex spacing cannot alias.
    const lo = new T.Color('#98b74a'),
      hi = new T.Color('#aac757'),
      patch = new T.Color('#8bb038'),
      crest = new T.Color('#b4cf5c');
    positions.push(0, plan.terrainHeight(0, 0), 0);
    colors.push(...new T.Color('#a2bf50').toArray());
    for (let i = 1; i <= rings; i++)
      for (let j = 0; j < segments; j++) {
        const a = (j / segments) * Math.PI * 2,
          t = Math.pow(i / rings, 1.15),
          r = plan.islandRadius(a) * t,
          x = Math.cos(a) * r,
          z = Math.sin(a) * r;
        positions.push(x, plan.terrainHeight(x, z), z);
        const n = noise2(x * 0.07 + 5, z * 0.07 + 3) * 0.6 + noise2(x * 0.19 + 11, z * 0.19 + 7) * 0.4;
        const c = lo.clone().lerp(hi, T.MathUtils.smoothstep(n, 0.3, 0.7));
        c.lerp(patch, 0.6 * (1 - plan.lawnCore(x, z)) * T.MathUtils.smoothstep(noise2(x * 0.23 + 31, z * 0.23 + 17), 0.6, 0.7));
        c.lerp(crest, 0.45 * T.MathUtils.clamp(plan.terrainHeight(x, z) / 0.9, 0, 1));
        colors.push(c.r, c.g, c.b);
      }
    const index = (i: number, j: number) => (i === 0 ? 0 : 1 + (i - 1) * segments + (j % segments));
    for (let j = 0; j < segments; j++) indices.push(0, index(1, j + 1), index(1, j));
    for (let i = 1; i < rings; i++)
      for (let j = 0; j < segments; j++) {
        const a = index(i, j),
          b = index(i, j + 1),
          c = index(i + 1, j),
          d = index(i + 1, j + 1);
        indices.push(a, d, c, a, b, d);
      }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const ground = new T.Mesh(geometry, material('#ffffff', 'grass'));
    ground.receiveShadow = true;
    ground.name = 'island-ground';
    land.add(ground);

    // The shore: a crisp darker turf lip, dry sand, wet sand, the waterline, a pale shelf, the drop.
    // The shelf colours sit under the sea's translucent turquoise shallows.
    const profile = [
      { width: 0, height: 0, color: '#98b74a' },
      { width: 0.22, height: -0.004, color: palette.lawnEdge },
      { width: 0.32, height: -0.008, color: '#efd9a4' },
      { width: 1.9, height: -0.014, color: palette.sand },
      { width: 2.5, height: -0.02, color: '#d6ba86' },
      { width: 2.85, height: -0.026, color: palette.sandWet },
      { width: 3.3, height: -0.05, color: '#a8d8cf' },
      { width: 4.6, height: -0.17, color: '#5fb8c8' },
      { width: 7.2, height: -0.48, color: '#2f8fb6' },
    ];
    /** The shore surface height at a given width out from the outline. */
    const shoreHeight = (width: number) => {
      for (let j = 1; j < profile.length; j++)
        if (width <= profile[j].width) {
          const a = profile[j - 1],
            b = profile[j];
          return T.MathUtils.lerp(a.height, b.height, (width - a.width) / (b.width - a.width));
        }
      return profile[profile.length - 1].height;
    };
    const n = plan.OUTLINE_SAMPLES;
    const shorePoint = (i: number, width: number, height: number): Point => {
      // Offset along the outline normal, smoothed over two neighbours each side.
      const p = plan.islandOutline[i % n],
        prev = plan.islandOutline[(i + n - 2) % n],
        next = plan.islandOutline[(i + 2) % n];
      const dx = next[0] - prev[0],
        dz = next[1] - prev[1],
        l = Math.hypot(dx, dz) || 1;
      return [p[0] + (dz / l) * width, height, p[1] - (dx / l) * width];
    };
    const sp: number[] = [],
      sc: number[] = [],
      si: number[] = [];
    for (let i = 0; i < n; i++)
      for (const band of profile) {
        // The inner edge meets the lawn's outer ring, which rises where a mound reaches the coast;
        // a flat edge there leaves a crack that shows the sea under the island.
        const [ox, oz] = plan.islandOutline[i],
          p = shorePoint(i, band.width, band.width === 0 ? plan.terrainHeight(ox, oz) : band.height);
        sp.push(...p);
        const tone = 0.96 + 0.04 * Math.sin(i * 0.9 + band.width * 2.1) + 0.02 * (hash(i * 7 + band.width * 13) - 0.5);
        const c = new T.Color(band.color).multiplyScalar(tone);
        sc.push(c.r, c.g, c.b);
      }
    for (let i = 0; i < n; i++)
      for (let j = 0; j < profile.length - 1; j++) {
        const a = i * profile.length + j,
          b = ((i + 1) % n) * profile.length + j;
        si.push(a, b, b + 1, a, b + 1, a + 1);
      }
    const shoreGeometry = new T.BufferGeometry();
    shoreGeometry.setAttribute('position', new T.Float32BufferAttribute(sp, 3));
    shoreGeometry.setAttribute('color', new T.Float32BufferAttribute(sc, 3));
    shoreGeometry.setIndex(si);
    shoreGeometry.computeVertexNormals();
    const beach = new T.Mesh(shoreGeometry, material('#ffffff', 'sand'));
    beach.receiveShadow = true;
    beach.name = 'shore';
    land.add(beach);
    // Foam: a bright wobbling band on the tide line and a fainter, straight one just beyond it.
    // RGBA vertex colours (itemSize 4) carry each band's alpha.
    const fp: number[] = [],
      fc: number[] = [],
      fi: number[] = [];
    const foamColour = new T.Color('#eaf6f2');
    const foamBands = [
      { from: 2.8, to: 3.0, wobble: 0.5, alpha: 0.9 },
      { from: 3.3, to: 3.46, wobble: 0, alpha: 0.45 },
    ];
    foamBands.forEach((band, b) => {
      for (let i = 0; i < n; i++) {
        const wobble = (0.12 * Math.sin(i * 1.7) + 0.08 * Math.sin(i * 4.3)) * band.wobble;
        fp.push(...shorePoint(i, band.from + wobble, WATER + 0.006), ...shorePoint(i, band.to + wobble, WATER + 0.006));
        for (let k = 0; k < 2; k++) fc.push(foamColour.r, foamColour.g, foamColour.b, band.alpha);
      }
      for (let i = 0; i < n; i++) {
        const a = (b * n + i) * 2,
          c = (b * n + ((i + 1) % n)) * 2;
        fi.push(a, c, c + 1, a, c + 1, a + 1);
      }
    });
    const foamGeometry = new T.BufferGeometry();
    foamGeometry.setAttribute('position', new T.Float32BufferAttribute(fp, 3));
    foamGeometry.setAttribute('color', new T.Float32BufferAttribute(fc, 4));
    foamGeometry.setIndex(fi);
    foamGeometry.computeVertexNormals();
    const foamMaterial = material('#ffffff', 'paint').clone();
    foamMaterial.vertexColors = true;
    foamMaterial.transparent = true;
    foamMaterial.opacity = 0.92;
    foamMaterial.depthWrite = false;
    foamMaterial.emissive.set('#ffffff');
    foamMaterial.emissiveIntensity = 0.2;
    const foam = new T.Mesh(foamGeometry, foamMaterial);
    foam.name = 'tide-foam';
    foam.renderOrder = 3;
    foam.userData.keepSeparate = true;
    land.add(foam);
    animated.push({
      object: foam,
      update(time, night) {
        foamMaterial.emissiveIntensity = 0.2 * (1 - 0.7 * night);
        foamMaterial.opacity = 0.92 + Math.sin(time * 0.7) * 0.06;
      },
    });
    // A few chunky, rounded boulders on the beach. They only turn about y, so their tops stay flat,
    // and brighten upwards; the batch's contact bake darkens their feet.
    for (let i = 0; i < n; i++) {
      if (hash(i) >= 0.07) continue;
      const width = 0.6 + 1.6 * hash(i * 3 + 1),
        r = 0.26 + 0.18 * (0.5 + 0.5 * Math.sin(i * 17.1)),
        p = shorePoint(i, width, shoreHeight(width)),
        geometry = new T.IcosahedronGeometry(r, 1),
        position = geometry.getAttribute('position'),
        tint = new T.Color(i % 2 ? '#b9b6a2' : '#9da394'),
        tone = new Float32Array(position.count * 3);
      for (let k = 0; k < position.count; k++) {
        const v = 0.9 + 0.15 * T.MathUtils.smoothstep(position.getY(k), -r, r);
        tone.set([tint.r * v, tint.g * v, tint.b * v], k * 3);
      }
      geometry.setAttribute('color', new T.BufferAttribute(tone, 3));
      const stone = new T.Mesh(geometry, material('#ffffff', 'stone'));
      // Resting on the sand, then sunk by 35% of its half-height.
      stone.position.set(p[0], p[1] + 0.62 * r * (1 - 0.35), p[2]);
      stone.scale.set(1.35, 0.62, 1.05);
      stone.rotation.y = i * 0.93;
      stone.castShadow = stone.receiveShadow = true;
      land.add(stone);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Streets                                                           */
  /* ---------------------------------------------------------------- */
  function ribbon(
    g: T.Object3D,
    points: XZ[],
    width: number,
    y: number,
    color: string,
    kind: SurfaceKind,
    closed: boolean,
    gap?: (x: number, z: number) => boolean,
    shade = 0.03,
  ) {
    const n = points.length,
      count = closed ? n + 1 : n;
    const pos: number[] = [],
      col: number[] = [],
      idx: number[] = [];
    const base = new T.Color(color);
    for (let k = 0; k < count; k++) {
      const i = k % n;
      const p = points[i];
      const a = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)],
        b = points[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0],
        dz = b[1] - a[1],
        l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l,
        nz = dx / l;
      const h = plan.terrainHeight(p[0], p[1]);
      pos.push(p[0] + (nx * width) / 2, y + h, p[1] + (nz * width) / 2);
      pos.push(p[0] - (nx * width) / 2, y + h, p[1] - (nz * width) / 2);
      const tone = 1 - shade / 2 + shade * noise2(p[0] * 0.8, p[1] * 0.8);
      const c = base.clone().multiplyScalar(tone);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let k = 0; k < count - 1; k++) {
      // One gap test per segment, at its midpoint.
      const p = points[k % n],
        q = points[(k + 1) % n];
      if (gap && gap((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)) continue;
      const a = k * 2,
        b = a + 1,
        c = a + 2,
        d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    geometry.setIndex(idx);
    geometry.computeVertexNormals();
    const mesh = new T.Mesh(geometry, material('#ffffff', kind));
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  }
  /**
   * A raised strip with real side faces: a top, two sides from `bottom` to `top`, and an end cap
   * wherever a run starts or stops. `right` is either the second edge polyline or a width, in which
   * case `left` is the centre line. Sides are `side` or the top colour x0.74. Ground-like: no bake.
   */
  function slab(
    g: T.Object3D,
    left: XZ[],
    right: XZ[] | number,
    top: number,
    bottom: number,
    color: string,
    kind: SurfaceKind,
    closed: boolean,
    keep: (k: number) => boolean = () => true,
    side?: string,
  ): T.Mesh {
    if (typeof right === 'number')
      return slab(g, plan.offsetPolyline(left, -right / 2, closed), plan.offsetPolyline(left, right / 2, closed), top, bottom, color, kind, closed, keep, side);
    const n = left.length,
      count = closed ? n : n - 1;
    const pos: number[] = [],
      col: number[] = [];
    const topColor = new T.Color(color),
      sideColor = side ? new T.Color(side) : topColor.clone().multiplyScalar(0.74);
    const at = (p: XZ, y: number) => new T.Vector3(p[0], y + plan.terrainHeight(p[0], p[1]), p[1]);
    const up = new T.Vector3(0, 1, 0);
    // a-b-c-d run round the quad; flip it if it does not face `outward`.
    const quad = (a: T.Vector3, b: T.Vector3, c: T.Vector3, d: T.Vector3, outward: T.Vector3, tone: T.Color) => {
      if (b.clone().sub(a).cross(c.clone().sub(a)).dot(outward) < 0) [b, d] = [d, b];
      for (const v of [a, b, c, a, c, d]) {
        pos.push(v.x, v.y, v.z);
        col.push(tone.r, tone.g, tone.b);
      }
    };
    const kept = (k: number) => (closed ? keep((k + count) % count) : k >= 0 && k < count && keep(k));
    for (let k = 0; k < count; k++) {
      if (!keep(k)) continue;
      const j = (k + 1) % n,
        l0 = left[k],
        l1 = left[j],
        r0 = right[k],
        r1 = right[j];
      const along = new T.Vector3(l1[0] + r1[0] - l0[0] - r0[0], 0, l1[1] + r1[1] - l0[1] - r0[1]).normalize(),
        across = new T.Vector3(r0[0] + r1[0] - l0[0] - l1[0], 0, r0[1] + r1[1] - l0[1] - l1[1]).normalize();
      quad(at(l0, top), at(l1, top), at(r1, top), at(r0, top), up, topColor);
      quad(at(l0, bottom), at(l1, bottom), at(l1, top), at(l0, top), across.clone().negate(), sideColor);
      quad(at(r0, bottom), at(r1, bottom), at(r1, top), at(r0, top), across, sideColor);
      if (!kept(k - 1)) quad(at(l0, bottom), at(r0, bottom), at(r0, top), at(l0, top), along.clone().negate(), sideColor);
      if (!kept(k + 1)) quad(at(l1, bottom), at(r1, bottom), at(r1, top), at(l1, top), along, sideColor);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    geometry.computeVertexNormals();
    const mesh = new T.Mesh(geometry, material('#ffffff', kind));
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData.noShadow = true;
    mesh.userData.ground = true;
    g.add(mesh);
    return mesh;
  }
  function buildStreets() {
    const R = plan.ROAD_WIDTH,
      P = plan.PAVEMENT_WIDTH,
      KERB = 0.18,
      { road: roadY, pavement: pavementY, kerb: kerbY } = plan.levels;
    // Avenues that cross into the ring: direction u, and the ring tangent t at the junction.
    const crossings = plan.avenues
      .filter((a) => a.crossing)
      .map((a) => {
        const length = Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]),
          u: XZ = [(a.to[0] - a.from[0]) / length, (a.to[1] - a.from[1]) / length];
        return { ...a, length, u, t: [-u[1], u[0]] as XZ };
      });
    // The ring, densified (plan.ringLine has no points on its straight runs) with exact cut
    // stations where each avenue's road edge and kerb meet it.
    const ring = plan.densify(plan.ringLine, 2);
    for (const a of crossings)
      for (const o of [R / 2, R / 2 + KERB])
        for (const s of [-1, 1]) {
          const p: XZ = [a.to[0] + a.t[0] * o * s, a.to[1] + a.t[1] * o * s];
          if (ring.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6)) continue;
          const k = ring.findIndex((q, i) => plan.distanceToSegment(p, q, ring[(i + 1) % ring.length]) < 1e-6);
          if (k >= 0) ring.splice(k + 1, 0, p);
        }
    /** Within `o` of an avenue mouth, along the ring, on the avenue side. */
    const mouth = (o: number) => (x: number, z: number) =>
      crossings.some(
        (a) =>
          Math.abs((x - a.to[0]) * a.t[0] + (z - a.to[1]) * a.t[1]) < o &&
          plan.distanceToSegment([x, z], a.from, a.to) < R / 2 + P + 0.1,
      );
    /** Keep segment k unless its midpoint (between edges a and b) is in the gap. */
    const openAt = (a: XZ[], b: XZ[], gap: (x: number, z: number) => boolean) => (k: number) => {
      const j = (k + 1) % a.length;
      return !gap((a[k][0] + a[j][0] + b[k][0] + b[j][0]) / 4, (a[k][1] + a[j][1] + b[k][1] + b[j][1]) / 4);
    };
    // Ring road, and tram rails under the tram's wheels, unbroken through the junctions.
    ribbon(land, ring, R, roadY, palette.road, 'asphalt', true);
    for (const s of [-1, 1])
      ribbon(land, plan.offsetPolyline(ring, s * 0.42), 0.07, roadY + 0.003, palette.metal, 'metal', true, undefined, 0).userData.noShadow = true;
    // Raised pavements and kerbs on both sides. The kerb's road face is the riser; the pavement's
    // road edge tucks under the kerb. Only the inner side opens at the avenue mouths.
    for (const side of [-1, 1]) {
      const edges = (o0: number, o1: number) => [plan.offsetPolyline(ring, side * o0), plan.offsetPolyline(ring, side * o1)];
      const [pa, pb] = edges(R / 2 + KERB / 2, R / 2 + P),
        [ka, kb] = edges(R / 2, R / 2 + KERB),
        inner = side > 0;
      slab(land, pa, pb, pavementY, -0.02, palette.pavement, 'paving', true, inner ? openAt(pa, pb, mouth(R / 2 + KERB)) : undefined, palette.plazaDark);
      slab(land, ka, kb, kerbY, 0, palette.kerb, 'stone', true, inner ? openAt(ka, kb, mouth(R / 2 + KERB)) : undefined);
    }
    // Avenues: explicit ends. Edges start on the circle r = 5.1, under the plaza's kerb ring;
    // the road abuts the ring road, kerbs return to the ring's kerb line, pavements meet the
    // ring's inner pavement.
    for (const a of crossings) {
      const n: XZ = [-a.u[1], a.u[0]];
      const at = (along: number, o: number): XZ => [a.from[0] + a.u[0] * along + n[0] * o, a.from[1] + a.u[1] * along + n[1] * o];
      const start = (o: number) => Math.sqrt(5.1 ** 2 - o ** 2) - plan.PLAZA_RADIUS,
        edge = (o: number, end: number) => [at(start(o), o), at(end, o)];
      // The road's start corners sit on r = 5.1 too, so no grass shows at the plaza rim.
      ribbon(land, [at(start(R / 2), 0), at(a.length - R / 2, 0)], R, roadY, palette.road, 'asphalt', false);
      for (const side of [-1, 1]) {
        const paveEnd = a.length - (R / 2 + P),
          kerbEnd = a.length - R / 2;
        slab(land, edge(side * (R / 2 + KERB / 2), paveEnd), edge(side * (R / 2 + P), paveEnd), pavementY, -0.02, palette.pavement, 'paving', false, undefined, palette.plazaDark);
        slab(land, edge((side * R) / 2, kerbEnd), edge(side * (R / 2 + KERB), kerbEnd), kerbY, 0, palette.kerb, 'stone', false);
      }
      // Centre dashes, and a zebra across the mouth, where the ring's inner pavement is cut.
      for (let d = 1.6; d < a.length - 3.2; d += 1.6) {
        const [x, z] = at(d, 0);
        box(land, x, roadY + 0.004, z, 0.1 + Math.abs(a.u[0]) * 0.6, 0.006, 0.1 + Math.abs(a.u[1]) * 0.6, palette.roadLine, 'paint');
      }
      for (const o of [-0.54, -0.18, 0.18, 0.54]) {
        const [x, z] = at(a.length - (R / 2 + P / 2), o);
        box(land, x, roadY + 0.004, z, 0.24 + Math.abs(a.u[0]) * 0.66, 0.006, 0.24 + Math.abs(a.u[1]) * 0.66, palette.roadLine, 'paint');
      }
    }
    // The north avenue is the Town Hall's forecourt: one paved slab from the hall plinth to the
    // plaza rim (z -6.3 to -5.1), its top and sides coloured by facing.
    {
      const e = Math.sqrt(5.1 ** 2 - 9),
        shape = new T.Shape();
      shape.moveTo(-3, 6.3);
      shape.lineTo(3, 6.3);
      shape.lineTo(3, e);
      shape.absarc(0, 0, 5.1, Math.atan2(e, 3), Math.atan2(e, -3), false);
      const geometry = new T.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, -0.02, 0);
      const normals = geometry.getAttribute('normal'),
        topColor = new T.Color(palette.pavement),
        sideColor = new T.Color(palette.plazaDark),
        tones: number[] = [];
      for (let i = 0; i < normals.count; i++) tones.push(...(normals.getY(i) > 0.5 ? topColor : sideColor).toArray());
      geometry.setAttribute('color', new T.Float32BufferAttribute(tones, 3));
      const forecourt = new T.Mesh(geometry, material('#ffffff', 'paving'));
      forecourt.receiveShadow = true;
      forecourt.userData.ground = true;
      forecourt.userData.noShadow = true;
      land.add(forecourt);
    }
    // The plaza: an inner island for the gate, a reflecting pool ring with four causeways,
    // and an outer paved ring. Pieces meet at shared edges; nothing is stacked.
    const poolInner = POOL.inner,
      poolOuter = POOL.outer,
      gapAngle = POOL_GAP;
    const flat = (geometry: T.BufferGeometry, color: string, kind: SurfaceKind, y: number) => {
      const mesh = new T.Mesh(geometry, material(color, kind));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      mesh.receiveShadow = true;
      land.add(mesh);
      return mesh;
    };
    flat(new T.CircleGeometry(poolInner - 0.08, 48), palette.plaza, 'paving', plan.levels.plaza);
    flat(new T.RingGeometry(poolOuter + 0.08, plan.PLAZA_RADIUS, 64), palette.plaza, 'paving', plan.levels.plaza);
    for (let i = 0; i < 4; i++)
      flat(
        new T.RingGeometry(poolInner - 0.08, poolOuter + 0.08, 12, 1, (Math.PI / 2) * i - gapAngle, gapAngle * 2),
        palette.plaza,
        'paving',
        plan.levels.plaza,
      );
    flat(new T.RingGeometry(plan.PLAZA_RADIUS - 0.16, plan.PLAZA_RADIUS + 0.02, 64), palette.kerb, 'stone', plan.levels.plaza + 0.005);
    // Paving pattern: concentric rings of darker stone.
    for (const r of [1.72, 4.1])
      for (let i = 0; i < 4; i++)
        flat(
          new T.RingGeometry(r - 0.05, r + 0.05, 48, 1, (Math.PI / 2) * i + 0.42, Math.PI / 2 - 0.84),
          palette.plazaDark,
          'stone',
          plan.levels.plaza + 0.004,
        );
    for (let i = 0; i < 4; i++) {
      const start = (Math.PI / 2) * i + gapAngle,
        span = Math.PI / 2 - gapAngle * 2;
      const bed = new T.Mesh(new T.RingGeometry(poolInner, poolOuter, 32, 1, start, span), material(palette.pool, 'stone'));
      bed.rotation.x = -Math.PI / 2;
      bed.position.y = plan.levels.plaza - 0.16;
      bed.receiveShadow = true;
      land.add(bed);
      const water = material('#7fb7b8', 'water').clone();
      water.transparent = true;
      water.opacity = 0.72;
      water.depthWrite = false;
      water.roughness = 0.12;
      water.metalness = 0.25;
      const surface = new T.Mesh(new T.RingGeometry(poolInner, poolOuter, 32, 1, start, span), water);
      surface.rotation.x = -Math.PI / 2;
      surface.position.y = plan.levels.plaza - 0.03;
      surface.name = 'pool-' + i;
      surface.renderOrder = 2;
      land.add(surface);
      // Pool walls: short curved kerbs on both edges of each sector, visible from both sides.
      const wallMaterial = material(palette.trim, 'stone').clone();
      wallMaterial.side = T.DoubleSide;
      for (const [r, wide] of [
        [poolInner - 0.08, 0.16],
        [poolOuter + 0.08, 0.16],
      ] as const) {
        const wall = new T.Mesh(new T.RingGeometry(r - wide / 2, r + wide / 2, 32, 1, start, span), material(palette.trim, 'stone'));
        wall.rotation.x = -Math.PI / 2;
        wall.position.y = plan.levels.plaza + 0.1;
        land.add(wall);
        for (const radius of [r + wide / 2, r - wide / 2]) {
          const side = new T.Mesh(
            new T.CylinderGeometry(radius, radius, 0.26, 32, 1, true, start, span),
            wallMaterial,
          );
          side.position.y = plan.levels.plaza - 0.03;
          land.add(side);
        }
        // Closed ends where the wall meets a causeway: thin across, as wide as the wall.
        for (const a of [start, start + span])
          box(land, Math.cos(a) * r, plan.levels.plaza + 0.03, Math.sin(a) * r, wide, 0.26, 0.04, palette.trim, 'stone', { ry: -a });
      }
      // Between the pool and the rim: a planter with a clipped hedge and flowers, two benches facing the water.
      const { a, x: px, z: pz } = plazaPlanters()[i];
      box(land, px, plan.levels.plaza + 0.18, pz, PLANTER.w, 0.36, PLANTER.d, palette.stoneDark, 'stone', { bevel: 0.03, ry: -a });
      box(land, px, plan.levels.plaza + 0.5, pz, 0.95, 0.3, 0.36, palette.canopy[1], 'foliage', { bevel: 0.1, ry: -a });
      for (let f = 0; f < 6; f++) {
        const t = -0.4 + (0.8 * f) / 5;
        sphere(land, px + Math.cos(a) * t, plan.levels.plaza + 0.68, pz + Math.sin(a) * t, 0.05, palette.flowers[f % palette.flowers.length], 'paint', 6);
      }
      for (const side of [-1, 1]) {
        const ba = a + side * 0.62,
          bx = Math.cos(ba) * 3.6,
          bz = Math.sin(ba) * 3.6;
        bench(land, bx, plan.levels.plaza, bz, Math.atan2(-Math.cos(ba), -Math.sin(ba)));
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Furniture, planting, small things                                 */
  /* ---------------------------------------------------------------- */
  function bench(g: T.Object3D, x: number, y: number, z: number, ry = 0) {
    const b = new T.Group();
    b.position.set(x, y, z);
    b.rotation.y = ry;
    g.add(b);
    for (const sx of [-0.55, 0.55]) {
      box(b, sx, 0.22, 0, 0.05, 0.44, 0.42, palette.metal, 'metal');
      box(b, sx, 0.52, -0.2, 0.05, 0.5, 0.05, palette.metal, 'metal');
    }
    for (const dz of [-0.14, 0, 0.14]) box(b, 0, 0.45, dz, 1.3, 0.04, 0.11, palette.wood, 'wood', { bevel: 0.01 });
    for (const dy of [0.62, 0.76]) box(b, 0, dy, -0.2, 1.3, 0.1, 0.04, palette.wood, 'wood', { bevel: 0.01 });
    return b;
  }
  function lamp(g: T.Object3D, x: number, z: number, height = 2.3) {
    const y = plan.terrainHeight(x, z);
    const post = new T.Group();
    post.position.set(x, y, z);
    g.add(post);
    cylinder(post, 0, 0.1, 0, 0.09, 0.12, 0.2, palette.metal, 'metal', 8);
    cylinder(post, 0, height / 2, 0, 0.03, 0.045, height, palette.metal, 'metal', 8);
    box(post, 0, height - 0.02, 0, 0.1, 0.05, 0.1, palette.metal, 'metal');
    const glass = material(palette.lantern, 'glass').clone();
    glass.emissive.set(palette.lantern);
    glass.emissiveIntensity = 0;
    const lantern = new T.Mesh(new T.BoxGeometry(0.22, 0.26, 0.22), glass);
    lantern.position.set(0, height + 0.15, 0);
    lantern.castShadow = false;
    post.add(lantern);
    cone(post, 0, height + 0.34, 0, 0.19, 0.14, palette.metal, 'metal', 4);
    lamps.push(lantern);
    return post;
  }
  function tree(g: T.Object3D, spec: plan.TreeSpec, index: number) {
    const t = new T.Group();
    const y = plan.terrainHeight(spec.x, spec.z);
    t.position.set(spec.x, y, spec.z);
    t.rotation.y = hash(index * 3) * Math.PI * 2;
    g.add(t);
    const s = spec.size;
    if (spec.kind === 'pine') {
      cylinder(t, 0, 0.5 * s, 0, 0.05 * s, 0.09 * s, 1.0 * s, palette.bark, 'bark', 7);
      const tones = palette.pine;
      for (let i = 0; i < 3; i++) {
        const r = (0.95 - i * 0.22) * s,
          h = (1.1 - i * 0.12) * s,
          cy = (0.9 + i * 0.62) * s;
        const c = cone(t, 0, cy + h / 2 - 0.2 * s, 0, r, h, tones[(index + i) % 3], 'foliage', 7, hash(i + index) * 2);
        c.userData.softFoliage = true;
      }
      return t;
    }
    cylinder(t, 0, 0.42 * s, 0, 0.06 * s, 0.11 * s, 0.85 * s, palette.bark, 'bark', 7);
    for (const side of [-1, 1])
      box(t, side * 0.12 * s, 0.95 * s, 0, 0.05 * s, 0.32 * s, 0.05 * s, palette.bark, 'bark', { rz: -side * 0.6 });
    const tones =
      spec.kind === 'autumn'
        ? palette.autumn
        : spec.kind === 'round' && (index * 7) % 23 === 0
          ? palette.blossom
          : palette.canopy;
    const lumps = [
      [0, 1.35, 0, 0.72],
      [0.34, 1.15, 0.18, 0.5],
      [-0.3, 1.2, -0.22, 0.52],
      [0.05, 1.72, -0.05, 0.48],
      [-0.1, 1.05, 0.33, 0.42],
    ];
    for (const [lx, ly, lz, lr] of lumps) {
      const geometry = new T.IcosahedronGeometry(lr * s, 1);
      const p = geometry.getAttribute('position'),
        colors = new Float32Array(p.count * 3);
      const tone = new T.Color(tones[Math.abs(index + Math.round(lx * 10)) % tones.length]);
      for (let i = 0; i < p.count; i++) {
        const v = T.MathUtils.clamp(0.72 + (p.getY(i) / (lr * s) + 1) * 0.2, 0.6, 1.05);
        colors[i * 3] = tone.r * v;
        colors[i * 3 + 1] = tone.g * v;
        colors[i * 3 + 2] = tone.b * v;
      }
      geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
      const m = new T.Mesh(geometry, material('#ffffff', 'foliage'));
      m.position.set(lx * s, ly * s, lz * s);
      m.scale.set(1, 0.86, 1);
      m.rotation.set(hash(index + lx) * 1.2, hash(index + ly) * 3, 0);
      m.castShadow = m.receiveShadow = true;
      m.userData.softFoliage = true;
      t.add(m);
    }
    return t;
  }
  /** One fat bloom: a squashed 20-triangle blob that casts no shadow. */
  function bloom(g: T.Object3D, x: number, y: number, z: number, colour: string) {
    const m = new T.Mesh(bloomGeometry, material(colour, 'foliage'));
    m.position.set(x, y, z); m.scale.set(1, 0.7, 1); m.rotation.y = hash(x * 13 + z * 7) * 3;
    m.castShadow = false; m.receiveShadow = true; m.userData.noShadow = true; g.add(m); return m;
  }
  /** A hedge as one rounded mass with a lime top, optionally split by a gap (`at` along its length). */
  function hedge(g: T.Object3D, x: number, y: number, z: number, length: number, ry = 0, height = 0.55, gap?: { at: number; width: number }) {
    const h = new T.Group(); h.position.set(x, y, z); h.rotation.y = ry; g.add(h);
    const spans = gap ? [[-length / 2, gap.at - gap.width / 2], [gap.at + gap.width / 2, length / 2]] : [[-length / 2, length / 2]];
    for (const [a, b] of spans) if (b - a >= 0.45)
      bakeRamp(box(h, (a + b) / 2, height / 2, 0, b - a, height, 0.6, '#ffffff', 'foliage', { bevel: 0.12, segments: 1 }), palette.hedge, 0.9, 1.05, palette.hedgeTop, 0.45);
    return h;
  }
  /** A stone kerb, a green mound and three to six chunky blooms. */
  function flowerBed(g: T.Object3D, x: number, y: number, z: number, w: number, d: number, seed: number) {
    box(g, x, y + 0.11, z, w + 0.16, 0.22, d + 0.16, palette.stoneDark, 'stone'); // kerb
    bakeRamp(box(g, x, y + 0.27, z, w - 0.04, 0.2, d - 0.04, '#ffffff', 'foliage', { bevel: 0.09, segments: 1 }), palette.hedge, 0.9, 1.05, palette.hedgeTop, 0.4); // mound
    const count = T.MathUtils.clamp(Math.round(w * d * 4), 3, 6), long = w >= d;
    for (let i = 0; i < count; i++) {
      const along = ((i + 0.5) / count - 0.5) * (Math.max(w, d) - 0.3), across = (hash(seed + i * 3) - 0.5) * Math.max(0, Math.min(w, d) - 0.35);
      bloom(g, x + (long ? along : across), y + 0.4, z + (long ? across : along), BLOOMS[(seed + i) % 5]);
    }
  }
  /** A clipped topiary lump, painted like a canopy. */
  function topiary(g: T.Object3D, x: number, y: number, z: number, r: number, detail: number, sx = 1, sy = 0.9, sz = 1) {
    const geo = new T.IcosahedronGeometry(r, detail); geo.scale(sx, sy, sz);
    paintCanopy([geo], [[0, 0, 0, r]], TREE.round, palette.hedge, -r * sy, r * sy);
    const m = new T.Mesh(geo, material('#ffffff', 'foliage')); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m;
  }
  function phoneBox(g: T.Object3D, x: number, y: number, z: number, ry = 0) {
    const p = new T.Group();
    p.position.set(x, y, z);
    p.rotation.y = ry;
    g.add(p);
    box(p, 0, 0.75, 0, 0.6, 1.5, 0.6, '#b3332b', 'paint', { bevel: 0.03 });
    for (const side of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const face = new T.Group();
      face.rotation.y = side;
      p.add(face);
      box(face, 0, 0.85, 0.3, 0.42, 1.05, 0.02, palette.glass, 'glass');
      for (let i = 1; i < 4; i++) box(face, 0, 0.5 + i * 0.26, 0.31, 0.44, 0.02, 0.02, '#b3332b', 'paint');
    }
    box(p, 0, 1.56, 0, 0.66, 0.12, 0.66, '#9d2b24', 'paint');
    cone(p, 0, 1.7, 0, 0.42, 0.18, '#9d2b24', 'paint', 4);
    return p;
  }
  function bin(g: T.Object3D, x: number, y: number, z: number) {
    cylinder(g, x, y + 0.3, z, 0.17, 0.15, 0.6, palette.metal, 'metal', 8);
    cylinder(g, x, y + 0.62, z, 0.19, 0.19, 0.05, '#2d3838', 'metal', 8);
  }
  function bike(g: T.Object3D, x: number, y: number, z: number, ry: number, color: string) {
    const b = new T.Group();
    b.position.set(x, y, z);
    b.rotation.y = ry;
    g.add(b);
    for (const dx of [-0.32, 0.32]) {
      const wheel = new T.Mesh(new T.TorusGeometry(0.17, 0.022, 6, 16), material(palette.metal, 'metal'));
      wheel.position.set(dx, 0.19, 0);
      wheel.castShadow = true;
      b.add(wheel);
    }
    box(b, 0, 0.3, 0, 0.5, 0.03, 0.03, color, 'paint', { rz: 0.35 });
    box(b, 0.1, 0.38, 0, 0.03, 0.36, 0.03, color, 'paint', { rz: -0.3 });
    box(b, -0.2, 0.45, 0, 0.03, 0.3, 0.03, color, 'paint', { rz: 0.2 });
    box(b, -0.22, 0.62, 0, 0.06, 0.03, 0.34, palette.metal, 'metal');
    box(b, 0.12, 0.58, 0, 0.16, 0.04, 0.08, palette.woodDark, 'wood');
  }
  function pavilion(g: T.Object3D, x: number, y: number, z: number) {
    const p = new T.Group();
    p.position.set(x, y, z);
    g.add(p);
    cylinder(p, 0, 0.08, 0, 1.75, 1.85, 0.16, palette.stoneDark, 'stone', 8);
    cylinder(p, 0, 0.2, 0, 1.6, 1.6, 0.08, palette.plaza, 'paving', 8);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      cylinder(p, Math.cos(a) * 1.35, 1.35, Math.sin(a) * 1.35, 0.045, 0.055, 2.3, palette.trim, 'paint', 8);
      box(p, Math.cos(a) * 1.35, 0.72, Math.sin(a) * 1.35, 0.9, 0.04, 0.04, palette.trim, 'paint', { ry: -a + Math.PI / 2 });
    }
    const ring = new T.Mesh(new T.CylinderGeometry(1.5, 1.5, 0.12, 8, 1, true), material(palette.trim, 'paint'));
    ring.position.y = 2.5;
    p.add(ring);
    cone(p, 0, 3.02, 0, 1.75, 1.0, palette.copper, 'slate', 8, Math.PI / 8);
    sphere(p, 0, 3.6, 0, 0.09, palette.bronze, 'metal', 8);
    bench(p, 0, 0.24, 0.55, Math.PI);
    return p;
  }
  function memoryBoard(g: T.Object3D, x: number, y: number, z: number, ry: number) {
    const b = new T.Group();
    b.position.set(x, y, z);
    b.rotation.y = ry;
    g.add(b);
    for (const dx of [-0.6, 0.6]) box(b, dx, 0.8, 0, 0.07, 1.6, 0.07, palette.woodDark, 'wood');
    box(b, 0, 1.15, 0, 1.35, 0.8, 0.05, palette.wood, 'wood', { bevel: 0.01 });
    box(b, 0, 1.15, 0.03, 1.2, 0.66, 0.01, '#e6e0cc', 'paint');
    box(b, 0, 1.62, 0, 1.5, 0.08, 0.3, palette.slate, 'slate');
    return b;
  }
  function crane(g: T.Object3D, x: number, z: number) {
    const base = new T.Group();
    base.position.set(x, 0, z);
    g.add(base);
    box(base, 0, 0.12, 0, CRANE_BASE, 0.24, CRANE_BASE, '#9b9a90', 'stone');
    const mastH = 7.5;
    for (const sx of [-0.28, 0.28])
      for (const sz of [-0.28, 0.28]) box(base, sx, mastH / 2 + 0.24, sz, 0.07, mastH, 0.07, palette.gold, 'metal');
    for (let y = 0.6; y < mastH; y += 0.7) {
      box(base, 0, y + 0.24, 0.28, 0.6, 0.04, 0.04, palette.gold, 'metal');
      box(base, 0, y + 0.24, -0.28, 0.6, 0.04, 0.04, palette.gold, 'metal');
      box(base, 0.28, y + 0.24, 0, 0.04, 0.04, 0.6, palette.gold, 'metal');
      box(base, -0.28, y + 0.24, 0, 0.04, 0.04, 0.6, palette.gold, 'metal');
      box(base, 0, y + 0.59, 0.28, 0.68, 0.035, 0.035, palette.gold, 'metal', { rz: 0.8 });
    }
    const jib = new T.Group();
    jib.position.set(0, mastH + 0.4, 0);
    jib.userData.keepSeparate = true;
    base.add(jib);
    box(jib, 0, 0.1, 0, 0.9, 0.5, 0.9, palette.gold, 'metal');
    box(jib, 2.9, 0.4, 0, 6.4, 0.12, 0.12, palette.gold, 'metal');
    box(jib, 2.9, 0.0, 0, 6.4, 0.08, 0.08, palette.gold, 'metal');
    for (let i = 0; i < 9; i++) box(jib, 0.4 + i * 0.7, 0.2, 0, 0.05, 0.42, 0.05, palette.gold, 'metal', { rz: i % 2 ? 0.7 : -0.7 });
    box(jib, -1.6, 0.25, 0, 2.2, 0.1, 0.1, palette.gold, 'metal');
    box(jib, -2.2, 0.0, 0, 0.9, 0.5, 0.9, '#7b7b74', 'stone');
    box(jib, 0, 1.2, 0, 0.1, 1.8, 0.1, palette.gold, 'metal');
    box(jib, 1.6, 1.3, 0, 3.6, 0.02, 0.02, palette.metal, 'metal', { rz: -0.42 });
    box(jib, -1.2, 1.3, 0, 2.4, 0.02, 0.02, palette.metal, 'metal', { rz: 0.56 });
    box(jib, 0.3, 0.6, 0, 1.0, 0.3, 0.9, palette.gold, 'metal');
    box(jib, 0.3, 0.55, 0.4, 0.5, 0.3, 0.02, palette.glass, 'glass');
    box(jib, 4.2, 0.3, 0, 0.3, 0.12, 0.3, palette.metal, 'metal');
    box(jib, 4.2, -1.6, 0, 0.02, 3.6, 0.02, palette.metal, 'metal');
    box(jib, 4.2, -3.5, 0, 0.26, 0.26, 0.14, palette.metal, 'metal');
    animated.push({
      object: jib,
      update(time) {
        jib.rotation.y = Math.sin(time * 0.07) * 0.9;
      },
    });
    // Hoarding and materials on the plot.
    const plot = plan.reservedPlot;
    for (const [dx, dz, l, ry] of hoardingWalls(plot))
      box(g, plot.x + dx, 0.45, plot.z + dz, l, 0.9, HOARDING_THICKNESS, '#d9d4c5', 'paint', { ry });
    box(g, plot.x - 1.4, 0.3, plot.z + 1.3, 1.2, 0.6, 0.8, '#b4a58b', 'wood');
    box(g, plot.x + 1.2, 0.25, plot.z + 1.4, 0.9, 0.5, 0.9, '#9a8f7c', 'stone');
    box(g, plot.x + 1.3, 0.2, plot.z - 1.5, 1.6, 0.4, 0.7, '#c2b8a4', 'stone');
    return base;
  }
  function pierAndHarbour(g: T.Object3D) {
    const [sx, sz] = plan.pier.start,
      [dx, dz] = plan.pier.dir;
    const heading = Math.atan2(dx, dz);
    const p = new T.Group();
    p.position.set(sx, 0, sz);
    p.rotation.y = heading;
    g.add(p);
    const L = plan.pier.length,
      W = plan.pier.width;
    box(p, 0, 0.14, L / 2, W, 0.08, L + 0.4, palette.wood, 'wood');
    for (let z = 0.4; z <= L; z += 0.6) box(p, 0, 0.19, z, W + 0.04, 0.02, 0.1, palette.woodDark, 'wood');
    for (let z = 0.2; z <= L; z += 1.2)
      for (const side of [-1, 1]) {
        cylinder(p, side * (W / 2 - 0.1), -0.2, z, 0.07, 0.08, 0.7, palette.woodDark, 'wood', 7);
        if (Math.round(z / 1.2) % 2 === 0) cylinder(p, side * (W / 2 - 0.12), 0.32, z, 0.07, 0.08, 0.3, palette.woodDark, 'wood', 7);
      }
    railing(p, -W / 2 + 0.06, 0.18, L / 2, L - 0.3, 0.55, Math.PI / 2);
    // A harbour master's hut with a lantern at the landward end.
    const hut = new T.Group();
    hut.position.set(W / 2 + 1.1, 0, 0.9);
    hut.rotation.y = -0.2;
    p.add(hut);
    box(hut, 0, 0.9, 0, 1.6, 1.8, 1.4, palette.render, 'paint', { bevel: 0.02 });
    pitchedRoof(hut, 0, 1.8, 0, 1.8, 1.6, 0.55, palette.slateDark);
    windowAt(hut, -0.35, 1.0, 0.7, 0.5, 0.6, { bars: 1 });
    door(hut, 0.4, 0.0, 0.7, 0.5, 1.3, palette.blueDoor, { steps: 1, width: 0.7 });
    lamp(p, W / 2 + 0.3, 0.3, 1.9).position.y += 0.18;
    lamp(p, -W / 2 - 0.3, L - 0.4, 1.9).position.y += 0.18;
    for (let i = 0; i < 3; i++) {
      const a = plan.pier.tangent;
      const bx = plan.pierEnd[0] + a[0] * (i - 1) * 2.6 + dx * 1.6 + (i - 1) * dx * 0.4,
        bz = plan.pierEnd[1] + a[1] * (i - 1) * 2.6 + dz * 1.6 + (i - 1) * dz * 0.4;
      const buoy = new T.Group();
      buoy.position.set(bx, WATER, bz);
      buoy.userData.keepSeparate = true;
      g.add(buoy);
      sphere(buoy, 0, 0.1, 0, 0.19, '#e4652f', 'paint', 10);
      cone(buoy, 0, 0.42, 0, 0.1, 0.4, '#e4652f', 'paint', 8);
      const glow = material(palette.lantern, 'glass').clone();
      glow.emissive.set(palette.lantern);
      const lampMesh = new T.Mesh(new T.SphereGeometry(0.05, 6, 5), glow);
      lampMesh.position.y = 0.66;
      buoy.add(lampMesh);
      lamps.push(lampMesh);
      animated.push({
        object: buoy,
        update(time) {
          buoy.position.y = WATER + Math.sin(time * 1.3 + i * 2) * 0.03;
          buoy.rotation.z = Math.sin(time * 0.9 + i) * 0.08;
        },
      });
    }
    // A moored dinghy beside the pier.
    const dinghy = new T.Group();
    dinghy.position.set(sx + dx * 2.2 - plan.pier.tangent[0] * 1.5, WATER, sz + dz * 2.2 - plan.pier.tangent[1] * 1.5);
    dinghy.rotation.y = heading + 0.3;
    dinghy.userData.keepSeparate = true;
    g.add(dinghy);
    box(dinghy, 0, 0.1, 0, 0.7, 0.22, 1.6, '#e9e2cf', 'paint', { bevel: 0.05 });
    box(dinghy, 0, 0.18, 0, 0.5, 0.04, 1.4, palette.wood, 'wood');
    box(dinghy, 0, 0.3, 0, 0.56, 0.04, 0.1, palette.woodDark, 'wood');
    animated.push({
      object: dinghy,
      update(time) {
        dinghy.position.y = WATER + Math.sin(time * 1.1 + 1) * 0.015;
        dinghy.rotation.x = Math.sin(time * 0.8) * 0.02;
      },
    });
  }
  function lighthouse(g: T.Object3D) {
    const [x, z] = plan.lighthouseRock;
    const rock = new T.Group();
    rock.position.set(x, 0, z);
    g.add(rock);
    for (let i = 0; i < 5; i++) {
      const stone = new T.Mesh(new T.DodecahedronGeometry(1.2 - i * 0.12, 0), material(i % 2 ? '#7f8b86' : '#99a39b', 'stone'));
      stone.position.set((hash(i * 9) - 0.5) * 1.6, -0.5 + i * 0.12, (hash(i * 9 + 1) - 0.5) * 1.6);
      stone.scale.set(1.5, 0.75, 1.2);
      stone.rotation.set(i * 0.6, i * 1.1, 0.2);
      stone.castShadow = stone.receiveShadow = true;
      rock.add(stone);
    }
    cylinder(rock, 0, 0.4, 0, 0.9, 1.0, 0.3, palette.stoneDark, 'stone', 12);
    cylinder(rock, 0, 2.1, 0, 0.45, 0.6, 3.2, palette.white, 'paint', 14);
    cylinder(rock, 0, 2.2, 0, 0.47, 0.5, 0.5, palette.boat, 'paint', 14);
    cylinder(rock, 0, 3.75, 0, 0.62, 0.62, 0.12, palette.metal, 'metal', 14);
    const railRing = new T.Mesh(new T.TorusGeometry(0.6, 0.02, 6, 20), material(palette.metal, 'metal'));
    railRing.rotation.x = Math.PI / 2;
    railRing.position.y = 4.1;
    rock.add(railRing);
    const glass = material(palette.lantern, 'glass').clone();
    glass.emissive.set(palette.lantern);
    const lanternRoom = new T.Mesh(new T.CylinderGeometry(0.36, 0.36, 0.7, 10), glass);
    lanternRoom.position.y = 4.2;
    rock.add(lanternRoom);
    lamps.push(lanternRoom);
    cone(rock, 0, 4.78, 0, 0.5, 0.45, palette.boat, 'paint', 10, 0);
    sphere(rock, 0, 5.05, 0, 0.07, palette.bronze, 'metal', 8);
    // The beam: a translucent cone that sweeps the harbour at night.
    const beamMaterial = new T.MeshBasicMaterial({
      color: palette.lantern,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: T.DoubleSide,
    });
    const beam = new T.Mesh(new T.ConeGeometry(2.6, 16, 14, 1, true), beamMaterial);
    beam.rotation.z = Math.PI / 2;
    beam.position.x = 8;
    const pivot = new T.Group();
    pivot.position.set(x, 4.2, z);
    pivot.add(beam);
    g.add(pivot);
    pivot.userData.keepSeparate = true;
    animated.push({
      object: pivot,
      update(time, night) {
        pivot.rotation.y = time * 0.5;
        beamMaterial.opacity = night * 0.14;
      },
    });
  }
  function hotAirBalloon(g: T.Object3D) {
    const b = new T.Group();
    g.add(b);
    const envelope = sphere(b, 0, 2.4, 0, 1.4, palette.balloon, 'fabric', 16);
    envelope.scale.set(1, 1.18, 1);
    const band = new T.Mesh(new T.TorusGeometry(1.38, 0.12, 8, 24), material(palette.balloonBand, 'fabric'));
    band.rotation.x = Math.PI / 2;
    band.position.y = 2.4;
    b.add(band);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      box(b, Math.cos(a) * 1.3, 2.4, Math.sin(a) * 1.3, 0.06, 2.4, 0.06, palette.balloonBand, 'fabric', { ry: -a });
    }
    cone(b, 0, 0.92, 0, 0.7, 0.9, palette.balloon, 'fabric', 10, 0).rotation.x = Math.PI;
    box(b, 0, 0.0, 0, 0.6, 0.45, 0.6, palette.wood, 'wood', { bevel: 0.04 });
    for (const sx of [-0.25, 0.25]) for (const sz of [-0.25, 0.25]) box(b, sx, 0.4, sz, 0.015, 0.5, 0.015, palette.metal, 'metal');
    b.userData.keepSeparate = true;
    animated.push({
      object: b,
      update(time) {
        const a = time * 0.025 + 1.2;
        b.position.set(4 + Math.cos(a) * 19, 13.5 + Math.sin(time * 0.4) * 0.5, -2 + Math.sin(a) * 15);
        b.rotation.y = -a;
        b.rotation.z = Math.sin(time * 0.6) * 0.03;
      },
    });
    return b;
  }

  /* ---------------------------------------------------------------- */
  /* Buildings                                                         */
  /* ---------------------------------------------------------------- */
  function buildGate(shell: T.Group) {
    const stone = palette.blonde,
      trim = palette.trim;
    for (const x of [-1.45, 1.45]) {
      box(shell, x, 0.17, 0, 1.4, 0.34, 1.9, palette.plinth, 'stone');
      box(shell, x, 1.85, 0, 1.05, 3.0, 1.5, stone, 'stone', { segments: 2 });
      for (const z of [-0.78, 0.78]) {
        box(shell, x - 0.38, 1.85, z, 0.16, 2.7, 0.14, trim, 'stone');
        box(shell, x + 0.38, 1.85, z, 0.16, 2.7, 0.14, trim, 'stone');
        box(shell, x, 1.7, z + 0.04 * Math.sign(z), 0.42, 0.9, 0.08, palette.stoneDark, 'stone');
        box(shell, x, 1.7, z + 0.07 * Math.sign(z), 0.28, 0.66, 0.06, stone, 'stone');
      }
      box(shell, x, 3.45, 0, 1.3, 0.22, 1.72, trim, 'stone');
      box(shell, x, 3.62, 0, 1.12, 0.12, 1.56, stone, 'stone');
    }
    const opening = 0.95,
      outer = 1.52,
      base = 2.5;
    for (let i = 0; i < 11; i++) {
      const a = (i * Math.PI) / 11,
        b = ((i + 1) * Math.PI) / 11;
      const shape = new T.Shape();
      shape.moveTo(Math.cos(a) * opening, base + Math.sin(a) * opening);
      shape.lineTo(Math.cos(a) * outer, base + Math.sin(a) * outer);
      shape.lineTo(Math.cos(b) * outer, base + Math.sin(b) * outer);
      shape.lineTo(Math.cos(b) * opening, base + Math.sin(b) * opening);
      shape.closePath();
      const mesh = new T.Mesh(new T.ExtrudeGeometry(shape, { depth: 1.5, bevelEnabled: false }), material(i % 2 ? stone : trim, 'stone'));
      mesh.position.z = -0.75;
      mesh.castShadow = mesh.receiveShadow = true;
      shell.add(mesh);
    }
    box(shell, 0, base + outer + 0.05, 0, 0.5, 0.42, 1.6, trim, 'stone');
    box(shell, 0, 4.25, 0, 4.3, 0.42, 1.78, stone, 'stone');
    box(shell, 0, 4.56, 0, 4.55, 0.16, 1.98, trim, 'stone');
    box(shell, 0, 4.98, 0, 4.0, 0.7, 1.62, stone, 'stone');
    for (const z of [-0.83, 0.83]) box(shell, 0, 4.98, z, 2.9, 0.42, 0.04, '#4e5a56', 'metal');
    box(shell, 0, 5.4, 0, 4.3, 0.14, 1.86, trim, 'stone');
    balustrade(shell, 0, 5.47, 0.82, 3.9);
    balustrade(shell, 0, 5.47, -0.82, 3.9);
    for (const x of [-1.45, 1.45]) {
      cylinder(shell, x, 5.65, 0, 0.1, 0.14, 0.4, palette.bronze, 'metal', 8);
      const glow = material(palette.lantern, 'glass').clone();
      glow.emissive.set(palette.lantern);
      const bowl = new T.Mesh(new T.SphereGeometry(0.17, 10, 8), glow);
      bowl.position.set(x, 5.95, 0);
      shell.add(bowl);
      lamps.push(bowl);
    }
    shell.userData.landmark = "LIU'S GATE";
    shell.userData.openingWidth = opening * 2;
  }

  function buildHall(shell: T.Group, site: plan.Site) {
    const w = site.w,
      d = site.d,
      h = 4.2,
      stone = palette.blonde;
    box(shell, 0, 0.15, 0, w + 0.3, 0.3, d + 0.3, palette.plinth, 'stone');
    box(shell, 0, 0.3 + h / 2, 0, w, h, d, stone, 'stone');
    quoins(shell, w, d, h + 0.3, palette.trim);
    // Pilasters and arched windows on the front, plain windows elsewhere.
    for (let i = 0; i < 7; i++) {
      const x = -w / 2 + 0.55 + (i * (w - 1.1)) / 6;
      box(shell, x, 0.3 + h / 2, d / 2 + 0.05, 0.3, h, 0.12, palette.trim, 'stone');
    }
    for (let i = 0; i < 6; i++) {
      const x = -w / 2 + 0.55 + ((i + 0.5) * (w - 1.1)) / 6;
      if (i === 2 || i === 3) {
        windowAt(shell, x, 3.1, d / 2, 0.56, 0.95, { arched: true });
        continue;
      }
      windowAt(shell, x, 1.45, d / 2, 0.58, 1.3, { arched: true });
      windowAt(shell, x, 3.1, d / 2, 0.56, 0.95, { arched: false });
    }
    for (const side of [-1, 1]) {
      const face = new T.Group();
      face.position.x = (side * w) / 2;
      face.rotation.y = (side * Math.PI) / 2;
      shell.add(face);
      for (let i = 0; i < 4; i++) {
        const x = -d / 2 + 0.6 + (i * (d - 1.2)) / 3;
        windowAt(face, x, 1.45, 0, 0.55, 1.25, { arched: true });
        windowAt(face, x, 3.1, 0, 0.52, 0.9);
      }
    }
    const rear = new T.Group();
    rear.position.z = -d / 2;
    rear.rotation.y = Math.PI;
    shell.add(rear);
    for (let i = 0; i < 6; i++) {
      const x = -w / 2 + 0.7 + (i * (w - 1.4)) / 5;
      windowAt(rear, x, 1.45, 0, 0.55, 1.25);
      windowAt(rear, x, 3.1, 0, 0.52, 0.9);
    }
    // Entrance: double door, surround, balcony and steps down to the forecourt.
    door(shell, 0, 0.3, d / 2 + 0.02, 1.2, 2.1, palette.greenDoor, { fanlight: true, steps: 3, width: 2.4 });
    box(shell, 0, 2.85, d / 2 + 0.3, 2.1, 0.12, 0.7, palette.trim, 'stone');
    balustrade(shell, 0, 2.91, d / 2 + 0.6, 2.0);
    for (const sx of [-0.9, 0.9]) box(shell, sx, 2.6, d / 2 + 0.3, 0.14, 0.4, 0.5, palette.trim, 'stone');
    for (const sx of [-2.2, 2.2]) {
      cylinder(shell, sx, 0.65, d / 2 + 0.9, 0.3, 0.26, 0.36, palette.plinth, 'stone', 10);
      topiary(shell, sx, 1.1, d / 2 + 0.9, 0.3, 2);
    }
    box(shell, 0, 0.3 + h * 0.52, 0, w + 0.12, 0.09, d + 0.12, palette.trim, 'stone');
    box(shell, 0, 0.3 + h + 0.08, 0, w + 0.36, 0.2, d + 0.36, palette.trim, 'stone');
    balustrade(shell, 0, 0.3 + h + 0.18, d / 2 + 0.1, w - 2.6);
    pitchedRoof(shell, 0, 0.3 + h + 0.18, 0, w + 0.2, d + 0.2, 1.35);
    gabledRoofEnds(shell, 0, 0.3 + h + 0.18, 0, w + 0.2, d + 0.2, 1.35, stone);
    // The tower: clock faces, belfry, spire, weather vane.
    const tx = 0,
      tz = 0.3,
      tw = 1.8,
      th = 8.0;
    box(shell, tx, 0.3 + th / 2, tz, tw, th, tw, stone, 'stone', { segments: 2 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(shell, tx + (sx * tw) / 2, 0.3 + th / 2, tz + (sz * tw) / 2, 0.24, th, 0.24, palette.trim, 'stone');
    for (const y of [4.6, 6.1]) box(shell, tx, y, tz, tw + 0.2, 0.1, tw + 0.2, palette.trim, 'stone');
    for (const side of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const face = new T.Group();
      face.position.set(tx, 0, tz);
      face.rotation.y = side;
      shell.add(face);
      windowAt(face, 0, 5.3, tw / 2, 0.42, 0.9, { arched: true, bars: 2 });
      // The belfry opening.
      box(face, 0, 7.05, tw / 2 + 0.02, 0.5, 1.0, 0.06, '#3e4a48', 'metal');
      for (let i = 0; i < 4; i++) box(face, 0, 6.65 + i * 0.25, tw / 2 + 0.06, 0.54, 0.04, 0.06, palette.trim, 'stone');
      // The clock: a cream dial behind glass (lit after dusk like the windows), a dark bezel
      // and hands that keep Glasgow time.
      const dial = new T.Mesh(new T.CylinderGeometry(0.46, 0.46, 0.06, 24), material('#f4ecd8', 'glass'));
      dial.rotation.x = Math.PI / 2;
      dial.position.set(0, 7.95, tw / 2 + 0.04);
      dial.userData.flatGlass = true; // an even cream face, not a window's gradient
      face.add(dial);
      const bezel = new T.Mesh(new T.TorusGeometry(0.47, 0.035, 6, 24), material(palette.ink, 'metal'));
      bezel.position.set(0, 7.95, tw / 2 + 0.07);
      face.add(bezel);
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        box(face, Math.sin(a) * 0.37, 7.95 + Math.cos(a) * 0.37, tw / 2 + 0.075, 0.03, i % 3 ? 0.06 : 0.1, 0.01, palette.ink, 'metal', { rz: -a });
      }
      const hands = new T.Group();
      hands.position.set(0, 7.95, tw / 2 + 0.09);
      hands.userData.keepSeparate = true;
      face.add(hands);
      const hour = new T.Group(),
        minute = new T.Group();
      hands.add(hour, minute);
      box(hour, 0, 0.13, 0, 0.05, 0.3, 0.015, palette.ink, 'metal');
      box(minute, 0, 0.18, 0, 0.035, 0.4, 0.012, palette.ink, 'metal');
      sphere(hands, 0, 0, 0, 0.035, palette.bronze, 'metal', 8);
      clocks.push({ hour, minute });
    }
    box(shell, tx, 0.3 + th + 0.1, tz, tw + 0.36, 0.2, tw + 0.36, palette.trim, 'stone');
    balustrade(shell, tx, 0.3 + th + 0.2, tz + tw / 2 + 0.12, tw + 0.2);
    balustrade(shell, tx, 0.3 + th + 0.2, tz - tw / 2 - 0.12, tw + 0.2);
    balustrade(shell, tx + tw / 2 + 0.12, 0.3 + th + 0.2, tz, tw + 0.2, Math.PI / 2);
    balustrade(shell, tx - tw / 2 - 0.12, 0.3 + th + 0.2, tz, tw + 0.2, Math.PI / 2);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      cylinder(shell, tx + sx * (tw / 2 + 0.02), 0.3 + th + 0.55, tz + sz * (tw / 2 + 0.02), 0.08, 0.1, 0.5, stone, 'stone', 6);
      cone(shell, tx + sx * (tw / 2 + 0.02), 0.3 + th + 1.0, tz + sz * (tw / 2 + 0.02), 0.14, 0.45, palette.slate, 'slate', 6, 0);
    }
    cone(shell, tx, 0.3 + th + 0.2 + 1.3, tz, 1.15, 2.6, palette.slate, 'slate', 4);
    cylinder(shell, tx, 0.3 + th + 3.6, tz, 0.03, 0.05, 0.6, palette.bronze, 'metal', 6);
    sphere(shell, tx, 0.3 + th + 3.9, tz, 0.09, palette.bronze, 'metal', 8);
    const vane = new T.Group();
    vane.position.set(tx, 0.3 + th + 4.05, tz);
    vane.userData.keepSeparate = true;
    shell.add(vane);
    box(vane, 0, 0, 0, 0.5, 0.02, 0.02, palette.bronze, 'metal');
    cone(vane, 0.28, 0, 0, 0.05, 0.12, palette.bronze, 'metal', 4, 0).rotation.z = -Math.PI / 2;
    box(vane, -0.2, 0, 0, 0.12, 0.09, 0.015, palette.bronze, 'metal');
    animated.push({
      object: vane,
      update(time) {
        vane.rotation.y = Math.sin(time * 0.3) * 0.8 + Math.sin(time * 0.07) * 1.5;
      },
    });
  }

  function buildTerrace(shell: T.Group, site: plan.Site, variant: 'villa' | 'red-tenement' | 'gabled-house', seed: number) {
    const w = site.w,
      d = site.d,
      h = 3.1;
    const stone = variant === 'villa' ? palette.blonde : variant === 'red-tenement' ? palette.red : palette.pale;
    const trim = variant === 'red-tenement' ? palette.trimRed : palette.trim;
    const doorColor = variant === 'villa' ? palette.greenDoor : variant === 'red-tenement' ? palette.blueDoor : palette.redDoor;
    box(shell, 0, 0.12, 0, w + 0.2, 0.24, d + 0.2, variant === 'red-tenement' ? palette.plinthRed : palette.plinth, 'stone');
    box(shell, 0, 0.24 + h / 2, 0, w, h, d, stone, 'stone');
    quoins(shell, w, d, h + 0.24, trim, 0.24);
    box(shell, 0, 0.24 + h * 0.5, 0, w + 0.08, 0.07, d + 0.08, trim, 'stone');
    box(shell, 0, 0.24 + h + 0.06, 0, w + 0.3, 0.16, d + 0.3, trim, 'stone');
    // Ground floor: a bay window and the front door; first floor: two sashes.
    const bayX = -0.6,
      doorX = 0.72;
    const bay = new T.Group();
    bay.position.set(bayX, 0, d / 2);
    shell.add(bay);
    box(bay, 0, 0.9, 0.2, 1.05, 1.5, 0.42, stone, 'stone');
    box(bay, 0, 0.3, 0.2, 1.15, 0.3, 0.52, palette.plinth, 'stone');
    box(bay, 0, 1.72, 0.2, 1.2, 0.1, 0.56, trim, 'stone');
    windowAt(bay, 0, 1.0, 0.41, 0.6, 1.0, { frame: trim, sill: false });
    for (const side of [-1, 1]) {
      const face = new T.Group();
      face.position.set(side * 0.52, 0, 0.2);
      face.rotation.y = (side * Math.PI) / 2;
      bay.add(face);
      windowAt(face, 0, 1.0, 0.0, 0.26, 0.95, { frame: trim, sill: false, bars: 1 });
    }
    door(shell, doorX, 0.24, d / 2 + 0.02, 0.74, 1.95, doorColor, { fanlight: true, steps: 2, width: 1.1 });
    railing(shell, doorX - 0.6, 0.24, d / 2 + 0.5, 0.7, 0.8, Math.PI / 2);
    railing(shell, doorX + 0.6, 0.24, d / 2 + 0.5, 0.7, 0.8, Math.PI / 2);
    for (const x of [-0.65, 0.65]) windowAt(shell, x, 0.24 + h * 0.76, d / 2, 0.58, 0.95, { frame: trim });
    // Rear windows and a garden door.
    const rear = new T.Group();
    rear.position.z = -d / 2;
    rear.rotation.y = Math.PI;
    shell.add(rear);
    for (const x of [-0.65, 0.65]) {
      windowAt(rear, x, 0.24 + h * 0.76, 0, 0.5, 0.9, { frame: trim });
      windowAt(rear, x, 1.2, 0, 0.5, 0.95, { frame: trim });
    }
    for (const side of [-1, 1]) {
      const face = new T.Group();
      face.position.x = (side * w) / 2;
      face.rotation.y = (side * Math.PI) / 2;
      shell.add(face);
      windowAt(face, 0.9, 0.24 + h * 0.76, 0, 0.5, 0.9, { frame: trim });
      windowAt(face, -0.9, 1.2, 0, 0.5, 0.95, { frame: trim });
    }
    // Roof, dormer or gable, chimney with two pots.
    const roofY = 0.24 + h + 0.14,
      rise = 1.05;
    if (variant === 'gabled-house') {
      pitchedRoof(shell, 0, roofY, 0, w + 0.24, d + 0.3, rise, palette.slateDark);
      gabledRoofEnds(shell, 0, roofY, 0, w + 0.24, d + 0.3, rise, stone);
      // A front-facing gable over the bay.
      const front = new T.Group();
      front.position.set(bayX, roofY, d / 2 - 0.55);
      front.rotation.y = Math.PI / 2;
      shell.add(front);
      pitchedRoof(front, 0, 0, 0, 1.3, 1.4, 0.75, palette.slateDark);
      const gable = new T.Shape();
      gable.moveTo(-0.66, 0);
      gable.lineTo(0.66, 0);
      gable.lineTo(0, 0.72);
      gable.closePath();
      const gableMesh = new T.Mesh(new T.ExtrudeGeometry(gable, { depth: 0.12, bevelEnabled: false }), material(stone, 'stone'));
      gableMesh.position.set(bayX, roofY, d / 2 + 0.08);
      gableMesh.castShadow = true;
      shell.add(gableMesh);
      windowAt(shell, bayX, roofY + 0.3, d / 2 + 0.2, 0.3, 0.36, { frame: trim, sill: false, bars: 1 });
    } else {
      pitchedRoof(shell, 0, roofY, 0, w + 0.24, d + 0.3, rise, variant === 'red-tenement' ? palette.slateDark : palette.slate);
      gabledRoofEnds(shell, 0, roofY, 0, w + 0.24, d + 0.3, rise, stone);
      const dormer = new T.Group();
      dormer.position.set(0.2, roofY + 0.32, d / 2 - 0.95);
      shell.add(dormer);
      box(dormer, 0, 0.3, 0, 0.78, 0.62, 0.7, stone, 'stone');
      windowAt(dormer, 0, 0.3, 0.35, 0.36, 0.42, { frame: trim, sill: false, bars: 1 });
      pitchedRoof(dormer, 0, 0.62, 0, 0.9, 0.78, 0.3, palette.slate, { ridge: false });
    }
    const chimneyX = seed % 2 ? -w / 2 + 0.35 : w / 2 - 0.35;
    box(shell, chimneyX, roofY + rise * 0.55 + 0.35, -0.2, 0.46, 1.3, 0.72, variant === 'red-tenement' ? '#a16e54' : '#c2a983', 'stone');
    box(shell, chimneyX, roofY + rise * 0.55 + 1.02, -0.2, 0.56, 0.09, 0.82, trim, 'stone');
    for (const dz of [-0.18, 0.18]) cylinder(shell, chimneyX, roofY + rise * 0.55 + 1.2, -0.2 + dz, 0.07, 0.08, 0.28, '#b06a4a', 'stone', 8);
    // Front garden: hedge, path, a splash of flowers.
    hedge(shell, -0.1, 0, d / 2 + 1.3, w - 0.5, 0, 0.42);
    box(shell, doorX, 0.03, d / 2 + 0.95, 0.8, 0.06, 1.0, palette.plaza, 'paving');
    flowerBed(shell, bayX, 0, d / 2 + 0.75, 1.0, 0.45, seed * 31);
  }

  function buildStudio(shell: T.Group, site: plan.Site) {
    const w = site.w,
      d = site.d;
    box(shell, 0, 0.12, 0, w + 0.4, 0.24, d + 0.4, palette.plinth, 'stone');
    // Volume A: the glass block. Volume B: the rendered block with ribbon windows.
    const aw = 3.4,
      ah = 4.3,
      ax = -1.1;
    box(shell, ax, 0.24 + ah / 2, 0, aw, ah, d, palette.glass, 'glass');
    for (const z of [-d / 2, d / 2]) {
      for (let x = -aw / 2; x <= aw / 2 + 0.01; x += aw / 6) box(shell, ax + x, 0.24 + ah / 2, z, 0.06, ah, 0.08, palette.frame, 'paint');
      for (let y = 0.24; y <= 0.24 + ah + 0.01; y += ah / 4) box(shell, ax, y, z, aw + 0.04, 0.08, 0.1, palette.frame, 'paint');
    }
    for (const x of [ax - aw / 2, ax + aw / 2]) {
      for (let z = -d / 2; z <= d / 2 + 0.01; z += d / 6) box(shell, x, 0.24 + ah / 2, z, 0.08, ah, 0.06, palette.frame, 'paint');
      for (let y = 0.24; y <= 0.24 + ah + 0.01; y += ah / 4) box(shell, x, y, 0, 0.1, 0.08, d + 0.04, palette.frame, 'paint');
    }
    const bw = 2.2,
      bh = 3.1,
      bx = 1.6;
    box(shell, bx, 0.24 + bh / 2, 0.3, bw, bh, d - 0.6, palette.render, 'paint');
    for (const y of [1.3, 2.5]) {
      box(shell, bx, y, d / 2 - 0.3 + 0.02, bw - 0.4, 0.55, 0.05, palette.glassDark, 'glass');
      box(shell, bx + bw / 2 + 0.02, y, 0.3, 0.05, 0.55, d - 1.2, palette.glassDark, 'glass');
      box(shell, bx, y - 0.32, d / 2 - 0.3 + 0.05, bw - 0.3, 0.06, 0.1, '#d5d0c0', 'stone');
    }
    // Entrance canopy on the front, bikes and a bench beside it.
    box(shell, ax, 2.55, d / 2 + 0.55, 2.4, 0.1, 1.1, palette.frame, 'paint');
    for (const sx of [-1.0, 1.0]) cylinder(shell, ax + sx, 1.4, d / 2 + 0.95, 0.04, 0.04, 2.3, palette.metal, 'metal', 8);
    box(shell, ax, 1.1, d / 2 + 0.02, 1.1, 2.2, 0.06, '#5e7f7f', 'glass');
    box(shell, ax, 1.1, d / 2 + 0.05, 0.05, 2.2, 0.08, palette.frame, 'paint');
    box(shell, ax, 0.22, d / 2 + 0.8, 2.0, 0.06, 1.3, palette.plaza, 'paving');
    for (let i = 0; i < 3; i++) bike(shell, bx + 0.2 + i * 0.5, 0.24, d / 2 + 0.7, 0.2, ['#c23a2e', '#2f5b4c', '#2e4b63'][i]);
    bench(shell, -w / 2 + 0.6, 0.24, d / 2 + 0.75, Math.PI);
    // Roofs: a green roof with panels and a deck on A, planters on B.
    box(shell, ax, 0.24 + ah + 0.1, 0, aw + 0.3, 0.2, d + 0.3, '#c9d2c0', 'stone');
    box(shell, ax - 0.2, 0.24 + ah + 0.26, 0.3, aw - 0.8, 0.14, d - 1.4, palette.canopy[1], 'foliage', { bevel: 0.05 });
    for (let i = 0; i < 3; i++) {
      const panel = box(shell, ax + 0.9, 0.24 + ah + 0.42, -d / 2 + 0.9 + i * 1.3, 1.0, 0.05, 0.75, '#2f4e66', 'metal');
      panel.rotation.x = 0.3;
      box(shell, ax + 0.9, 0.24 + ah + 0.3, -d / 2 + 0.9 + i * 1.3, 1.04, 0.04, 0.3, palette.metal, 'metal');
    }
    railing(shell, ax, 0.24 + ah + 0.2, d / 2 + 0.1, aw + 0.2, 0.5);
    railing(shell, ax, 0.24 + ah + 0.2, -d / 2 - 0.1, aw + 0.2, 0.5);
    box(shell, bx, 0.24 + bh + 0.06, 0.3, bw + 0.2, 0.12, d - 0.4, '#dcd8ca', 'stone');
    for (const dz of [-1.2, 0.2, 1.4]) {
      box(shell, bx + 0.4, 0.24 + bh + 0.3, dz, 0.8, 0.36, 0.5, '#b7ab93', 'stone', { bevel: 0.03 });
      sphere(shell, bx + 0.4, 0.24 + bh + 0.6, dz, 0.28, palette.canopy[1], 'foliage', 8).userData.softFoliage = true;
    }
  }

  function buildArchive(shell: T.Group, site: plan.Site) {
    const w = site.w,
      d = site.d,
      h = 3.3;
    box(shell, 0, 0.12, 0, w + 0.3, 0.24, d + 0.3, palette.plinth, 'stone');
    box(shell, 0, 0.24 + h / 2, 0, w, h, d, palette.brick, 'stone');
    quoins(shell, w, d, h + 0.24, palette.brickLight, 0.24);
    for (let i = 0; i < 5; i++) {
      const x = -w / 2 + 0.6 + (i * (w - 1.2)) / 4;
      box(shell, x, 0.24 + h / 2, d / 2 + 0.05, 0.28, h, 0.1, palette.brickLight, 'stone');
      box(shell, x, 0.24 + h / 2, -d / 2 - 0.05, 0.28, h, 0.1, palette.brickLight, 'stone');
    }
    for (let i = 0; i < 4; i++) {
      const x = -w / 2 + 0.6 + ((i + 0.5) * (w - 1.2)) / 4;
      if (i === 1) continue;
      windowAt(shell, x, 1.6, d / 2, 0.62, 1.4, { arched: true, frame: '#3f4a4a', bars: 3 });
    }
    const rear = new T.Group();
    rear.position.z = -d / 2;
    rear.rotation.y = Math.PI;
    shell.add(rear);
    for (let i = 0; i < 4; i++) windowAt(rear, -w / 2 + 0.6 + ((i + 0.5) * (w - 1.2)) / 4, 1.6, 0, 0.62, 1.4, { arched: true, frame: '#3f4a4a', bars: 3 });
    for (const side of [-1, 1]) {
      const face = new T.Group();
      face.position.x = (side * w) / 2;
      face.rotation.y = (side * Math.PI) / 2;
      shell.add(face);
      for (let i = 0; i < 3; i++) windowAt(face, -d / 2 + 0.8 + (i * (d - 1.6)) / 2, 1.6, 0, 0.6, 1.3, { arched: true, frame: '#3f4a4a', bars: 3 });
    }
    // The big arched doorway, a canopy and a loading dock.
    const doorX = -w / 2 + 0.6 + (1.5 * (w - 1.2)) / 4;
    box(shell, doorX, 0.24 + 1.1, d / 2 + 0.02, 1.3, 2.2, 0.08, '#3a4744', 'metal');
    for (let i = 0; i < 6; i++) box(shell, doorX, 0.5 + i * 0.36, d / 2 + 0.07, 1.26, 0.03, 0.02, '#596b66', 'metal');
    const archTop = new T.Mesh(new T.CylinderGeometry(0.65, 0.65, 0.06, 16, 1, false, Math.PI / 2, Math.PI), material('#3a4744', 'metal'));
    archTop.rotation.x = Math.PI / 2;
    archTop.position.set(doorX, 0.24 + 2.2, d / 2 + 0.03);
    shell.add(archTop);
    const archRim = new T.Mesh(new T.TorusGeometry(0.68, 0.07, 6, 18, Math.PI), material(palette.brickLight, 'stone'));
    archRim.position.set(doorX, 0.24 + 2.2, d / 2 + 0.03);
    shell.add(archRim);
    box(shell, doorX, 3.15, d / 2 + 0.45, 2.2, 0.08, 0.9, palette.metal, 'metal');
    for (const sx of [-0.9, 0.9]) box(shell, doorX + sx, 2.75, d / 2 + 0.85, 0.05, 0.8, 0.05, palette.metal, 'metal', { rx: -0.5 });
    box(shell, doorX, 0.4, d / 2 + 0.5, 2.0, 0.32, 1.0, palette.plinth, 'stone');
    box(shell, doorX + 1.6, 0.35, d / 2 + 0.5, 0.6, 0.22, 0.5, '#b4a58b', 'wood');
    box(shell, doorX + 1.6, 0.52, d / 2 + 0.5, 0.5, 0.12, 0.4, '#9a8f7c', 'wood');
    box(shell, 0, 0.24 + h + 0.08, 0, w + 0.3, 0.16, d + 0.3, palette.brickLight, 'stone');
    // Sawtooth roof: three bays, glazing facing the rear.
    const bays = 3,
      bayW = (w + 0.2) / bays;
    for (let i = 0; i < bays; i++) {
      const x = -(w + 0.2) / 2 + bayW * (i + 0.5);
      const shape = new T.Shape();
      shape.moveTo(-(d + 0.2) / 2, 0);
      shape.lineTo((d + 0.2) / 2, 0);
      shape.lineTo((d + 0.2) / 2 - 0.3, 0.95);
      shape.closePath();
      const saw = new T.Mesh(new T.ExtrudeGeometry(shape, { depth: bayW, bevelEnabled: false }), material(palette.slate, 'slate'));
      saw.rotation.y = Math.PI / 2;
      saw.position.set(x - bayW / 2, 0.24 + h + 0.16, 0);
      saw.castShadow = saw.receiveShadow = true;
      saw.userData.roof = true;
      saw.userData.eaveY = 0.24 + h + 0.16;
      shell.add(saw);
      const glazing = new T.Group();
      glazing.position.set(x, 0.24 + h + 0.16, -(d + 0.2) / 2 + 0.1);
      glazing.rotation.y = Math.PI;
      glazing.rotation.x = 0.3;
      shell.add(glazing);
      box(glazing, 0, 0.45, 0, bayW - 0.2, 0.86, 0.05, palette.glass, 'glass');
      for (let k = -2; k <= 2; k++) box(glazing, (k * (bayW - 0.2)) / 5, 0.45, 0.03, 0.04, 0.86, 0.03, '#d9dfd6', 'paint');
      box(shell, x, 0.24 + h + 0.16 + 0.97, -(d + 0.2) / 2 + 0.3, bayW + 0.04, 0.07, 0.1, palette.slateLight, 'slate');
    }
    cylinder(shell, -w / 2 + 0.5, 0.24 + h + 2.2, -d / 2 + 0.5, 0.25, 0.3, 4.2, palette.brick, 'stone', 12);
    cylinder(shell, -w / 2 + 0.5, 0.24 + h + 4.0, -d / 2 + 0.5, 0.32, 0.3, 0.3, palette.brickLight, 'stone', 12);
    cylinder(shell, -w / 2 + 0.5, 0.24 + h + 4.3, -d / 2 + 0.5, 0.2, 0.28, 0.25, '#4b4f4a', 'metal', 12);
  }

  function buildCottage(g: T.Object3D, c: (typeof plan.cottages)[number], index: number) {
    const root = new T.Group();
    root.position.set(c.x, plan.terrainHeight(c.x, c.z), c.z);
    root.rotation.y = c.rotation;
    g.add(root);
    const w = 2.8,
      d = 2.4,
      h = 2.2;
    box(root, 0, 0.1, 0, w + 0.2, 0.2, d + 0.2, palette.plinth, 'stone');
    box(root, 0, 0.2 + h / 2, 0, w, h, d, c.color, 'stone');
    pitchedRoof(root, 0, 0.2 + h, 0, w + 0.3, d + 0.3, 0.9, index % 2 ? palette.slate : palette.slateDark);
    gabledRoofEnds(root, 0, 0.2 + h, 0, w + 0.3, d + 0.3, 0.9, c.color);
    door(root, 0.6, 0.2, d / 2, 0.6, 1.5, [palette.greenDoor, palette.blueDoor, palette.redDoor][index % 3], { steps: 1, width: 0.9 });
    windowAt(root, -0.65, 1.1, d / 2, 0.55, 0.7);
    box(root, -0.8, 0.2 + h + 0.7, 0, 0.4, 0.9, 0.4, c.color, 'stone');
    cylinder(root, -0.8, 0.2 + h + 1.25, 0, 0.07, 0.08, 0.2, '#b06a4a', 'stone', 8);
    hedge(root, 0, 0, d / 2 + 1.0, w, 0, 0.36);
  }

  /* ---------------------------------------------------------------- */
  /* Vehicles and people                                               */
  /* ---------------------------------------------------------------- */
  function buildTram() {
    const tram = new T.Group();
    tram.name = 'tram';
    box(tram, 0, 0.5, 0, 0.95, 0.5, 3.4, palette.tram, 'paint', { bevel: 0.05 });
    box(tram, 0, 0.95, 0, 0.92, 0.5, 3.3, palette.tramCream, 'paint', { bevel: 0.05 });
    box(tram, 0, 1.0, 0, 0.98, 0.3, 3.0, palette.glass, 'glass');
    for (let z = -1.3; z <= 1.3; z += 0.52) box(tram, 0, 1.0, z, 1.0, 0.32, 0.05, palette.tramCream, 'paint');
    box(tram, 0, 1.3, 0, 0.9, 0.12, 3.5, palette.tram, 'paint', { bevel: 0.04 });
    box(tram, 0, 1.45, 0, 0.5, 0.05, 1.6, palette.metal, 'metal');
    box(tram, 0, 1.75, 0, 0.04, 0.55, 0.04, palette.metal, 'metal', { rx: 0.5 });
    box(tram, 0, 1.75, 0, 0.04, 0.55, 0.04, palette.metal, 'metal', { rx: -0.5 });
    box(tram, 0, 2.0, 0, 0.5, 0.03, 0.03, palette.metal, 'metal');
    for (const z of [-1.1, 1.1]) for (const x of [-0.42, 0.42]) cylinder(tram, x, 0.22, z, 0.2, 0.2, 0.1, '#2d3838', 'metal', 10).rotation.z = Math.PI / 2;
    for (const z of [-1.72, 1.72]) {
      box(tram, 0, 0.75, z, 0.8, 0.36, 0.04, palette.glass, 'glass');
      const light = material(palette.lantern, 'glass').clone();
      light.emissive.set(palette.lantern);
      const head = new T.Mesh(new T.SphereGeometry(0.07, 8, 6), light);
      head.position.set(0, 0.5, z);
      tram.add(head);
      lamps.push(head);
    }
    return tram;
  }
  function buildBoat() {
    const boat = new T.Group();
    boat.name = 'harbour-boat';
    box(boat, 0, 0.16, 0, 1.0, 0.36, 2.6, palette.boat, 'paint', { bevel: 0.08 });
    box(boat, 0, 0.3, 0, 1.04, 0.08, 2.64, '#efe6cf', 'paint', { bevel: 0.03 });
    box(boat, 0, 0.36, 0.1, 0.86, 0.06, 2.3, palette.wood, 'wood');
    box(boat, 0, 0.68, -0.4, 0.7, 0.6, 0.9, '#efe6cf', 'paint', { bevel: 0.03 });
    box(boat, 0, 0.76, -0.4, 0.74, 0.26, 0.94, palette.glass, 'glass');
    box(boat, 0, 1.02, -0.4, 0.8, 0.08, 1.0, palette.boat, 'paint', { bevel: 0.02 });
    cylinder(boat, 0, 1.6, 0.4, 0.025, 0.035, 1.3, palette.woodDark, 'wood', 7);
    box(boat, 0, 1.3, 0.4, 0.6, 0.02, 0.02, palette.woodDark, 'wood');
    cone(boat, 0, 0.12, 1.4, 0.45, 0.7, palette.boat, 'paint', 4).rotation.x = Math.PI / 2;
    const light = material(palette.lantern, 'glass').clone();
    light.emissive.set(palette.lantern);
    const lanternMesh = new T.Mesh(new T.SphereGeometry(0.06, 8, 6), light);
    lanternMesh.position.set(0, 2.3, 0.4);
    boat.add(lanternMesh);
    lamps.push(lanternMesh);
    return boat;
  }

  /* ---------------------------------------------------------------- */
  /* Assembly                                                          */
  /* ---------------------------------------------------------------- */
  buildTerrain();
  buildStreets();
  const lampSpecs = plan.lampPlan();
  for (const spec of lampSpecs) lamp(land, spec.x, spec.z);
  const trees = plan.plantingPlan();
  // Ground shade, shallows and the town lawn, shared by every ground material (and later the sea).
  const groundMasks = buildGroundMasks(trees, lampSpecs);
  library.bakeUniforms.groundMasks.value = groundMasks;
  const parkGroup = new T.Group();
  parkGroup.name = 'corner-park';
  parkGroup.userData.parkSelection = true;
  city.add(parkGroup);
  trees.forEach((spec, i) => {
    const inPark = Math.abs(spec.x - plan.park.x) < plan.park.w / 2 + 0.2 && Math.abs(spec.z - plan.park.z) < plan.park.d / 2 + 0.2;
    tree(inPark ? parkGroup : land, spec, i);
  });
  // The corner park: a lawn, a pavilion, benches, flowers and the memory board.
  box(parkGroup, plan.park.x, 0.02, plan.park.z, plan.park.w, 0.04, plan.park.d, palette.grassLight, 'grass');
  box(parkGroup, plan.park.x, 0.045, plan.park.z + plan.park.d / 2 - 0.6, plan.park.w, 0.02, 0.8, palette.plaza, 'paving');
  pavilion(parkGroup, bandstandAt()[0], 0.04, bandstandAt()[1]);
  memoryBoard(parkGroup, plan.park.x + plan.park.w / 2 - 1.0, 0.04, plan.park.z + 1.6, -0.6);
  bench(parkGroup, plan.park.x - 2.6, 0.04, plan.park.z + 1.9, Math.PI);
  bench(parkGroup, plan.park.x + 1.4, 0.04, plan.park.z + 1.9, Math.PI);
  flowerBed(parkGroup, plan.park.x - 2.8, 0.04, plan.park.z - 1.4, 1.6, 0.7, 7);
  flowerBed(parkGroup, plan.park.x + 2.6, 0.04, plan.park.z - 1.2, 1.4, 0.7, 19);
  bin(parkGroup, plan.park.x + 3.3, 0.04, plan.park.z + 2.2);
  // Plaza furniture.
  phoneBox(land, 4.65, plan.levels.plaza, -0.9, -0.6);
  bin(land, 0.9, plan.levels.plaza, 4.9);
  bin(land, -4.9, plan.levels.plaza, 0.9);
  // Terrace gardens: a flower bed in each gap between the three homes, standing on the lawn (y 0).
  for (const [side, seed] of [[-0.5, 41], [0.5, 43]] as const)
    flowerBed(land, plan.terraceRow.x + 0.4, 0, plan.terraceRow.z + side * plan.terraceRow.spacing, 1.4, 0.8, seed);
  plan.cottages.forEach((c, i) => buildCottage(land, c, i));
  crane(land, plan.reservedPlot.x, plan.reservedPlot.z);
  pierAndHarbour(land);
  lighthouse(city);
  hotAirBalloon(city);

  const models = new Map<BuildingId, Model>();
  for (const b of buildings) {
    const site = plan.sites[b.id];
    const root = new T.Group(),
      shell = new T.Group();
    root.add(shell);
    root.position.set(site.x, 0, site.z);
    root.rotation.y = site.rotation;
    root.userData.buildingId = b.id;
    root.name = 'building-' + b.id;
    city.add(root);
    if (b.model === 'gate') buildGate(shell);
    else if (b.model === 'hall') buildHall(shell, site);
    else if (b.model === 'studio') buildStudio(shell, site);
    else if (b.model === 'archive') buildArchive(shell, site);
    else buildTerrace(shell, site, b.variant ?? 'villa', b.id === 'pengyuan-liu' ? 0 : b.id === 'yunlong-liu' ? 1 : 2);
    models.set(b.id, { root, shell, fade: [], center: new T.Vector3(site.x, 0, site.z) });
  }

  // People: seven residents on the pavements of the ring.
  const walkers: Walker[] = [];
  for (let i = 0; i < 7; i++) {
    const root = createResident(i, material);
    city.add(root);
    const inner = i % 2 === 0;
    walkers.push({
      root,
      loop: plan.walkLoop(inner ? 1.35 : -1.35),
      distance: i * 13.7 + 4,
      speed: (inner ? 0.75 : -0.75) * (0.85 + hash(i + 3) * 0.3),
    });
  }
  const tram = buildTram();
  city.add(tram);
  const boat = buildBoat();
  city.add(boat);

  /* ---------------------------------------------------------------- */
  /* Static batching by surface family                                 */
  /* ---------------------------------------------------------------- */
  function batch(g: T.Object3D, opts: { contact?: 'terrain' | 'local' | 'none'; localFloor?: number } = {}) {
    const mode = opts.contact ?? 'terrain',
      localFloor = opts.localFloor ?? 0;
    g.updateMatrixWorld(true);
    const inv = g.matrixWorld.clone().invert(),
      groups = new Map<string, { mat: T.Material; cast: boolean; list: T.BufferGeometry[] }>(),
      old: T.Mesh[] = [];
    const kindOf = (o: T.Mesh) => (o.material as T.Material).userData?.surfaceKind as SurfaceKind;
    // Pass 1: overhangs in g space (roofs and flat solid slabs, never foliage or ground), in a 4-unit grid.
    type Cap = { id: number; box: T.Box3; top: number };
    const caps = new Map<number, Cap[]>();
    const cellOf = (x: number, z: number) => (Math.floor(x / 4) + 512) * 1024 + Math.floor(z / 4) + 512;
    if (mode !== 'none')
      g.traverse((o) => {
        if (!(o instanceof T.Mesh) || lamps.includes(o)) return;
        const k = kindOf(o);
        if (GROUND_KINDS.has(k) || k === 'foliage' || o.userData.softFoliage || o.userData.ground) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const toG = inv.clone().multiply(o.matrixWorld),
          box = o.geometry.boundingBox!.clone().applyMatrix4(toG),
          s = box.getSize(new T.Vector3());
        if (!o.userData.roof && !(s.y <= 0.3 && s.y >= 0.03 && Math.min(s.x, s.z) >= 0.5)) return;
        // A sloped roof's box drops below the wall plate, so roofs say where their eave is.
        const top =
          o.userData.eaveY !== undefined
            ? new T.Vector3(0, o.userData.eaveY, 0).applyMatrix4(inv.clone().multiply(o.parent!.matrixWorld)).y
            : box.min.y;
        const cap = { id: o.id, box, top };
        for (let cx = Math.floor(box.min.x / 4); cx <= Math.floor(box.max.x / 4); cx++)
          for (let cz = Math.floor(box.min.z / 4); cz <= Math.floor(box.max.z / 4); cz++) {
            const key = (cx + 512) * 1024 + cz + 512;
            const list = caps.get(key);
            if (list) list.push(cap);
            else caps.set(key, [cap]);
          }
      });
    const world = new T.Vector3();
    g.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      if (lamps.includes(o)) return;
      let keep: T.Object3D | null = o;
      while (keep && keep !== g) {
        if (keep.userData.keepSeparate) return;
        keep = keep.parent;
      }
      const source = o.material as T.MeshStandardMaterial;
      if (!(source instanceof T.MeshStandardMaterial)) return;
      const mat = library.batchMaterial(source, source.side === T.DoubleSide);
      const geometry = o.geometry.clone();
      if (!geometry.userData.longitudinalUV) {
        const local = geometry.clone().scale(o.scale.x, o.scale.y, o.scale.z);
        projectMaterialUV(local, source.userData.surfaceKind);
        geometry.setAttribute('uv', local.getAttribute('uv').clone());
        local.dispose();
      }
      geometry.applyMatrix4(inv.clone().multiply(o.matrixWorld));
      // Cast by size: glass volumes cast, flowers, trims and thin panes do not, water never does.
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox!,
        size = bb.getSize(new T.Vector3());
      const k = source.userData.surfaceKind as SurfaceKind;
      const cast = Math.max(size.x, size.y, size.z) >= 0.3 && k !== 'water'
        && !(k === 'glass' && Math.min(size.x, size.y, size.z) < 0.3) && !o.userData.noShadow;
      const key = mat.uuid + (cast ? '|c' : '|n');
      if (source.userData.surfaceKind === 'grass') projectMaterialUV(geometry, 'grass');
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      const count = geometry.getAttribute('position').count,
        previous = geometry.getAttribute('color'),
        positions = geometry.getAttribute('position'),
        normals = geometry.getAttribute('normal'),
        meshNormals = o.geometry.getAttribute('normal');
      // Solids get the bake; ground surfaces and wafer-thin decals keep their own shading.
      const solid = !GROUND_KINDS.has(k) && !o.userData.ground && size.y >= 0.03,
        rounded = o.geometry instanceof RoundedBoxGeometry,
        span = Math.max(1e-3, size.y);
      const colors = new Float32Array(count * 3),
        bake = new Uint8Array(count * 2);
      for (let i = 0; i < count; i++) {
        let h = BAKE_RANGE,
          eave = BAKE_RANGE,
          shade = 1,
          warm = 0;
        if (solid) {
          const px = positions.getX(i),
            py = positions.getY(i),
            pz = positions.getZ(i),
            nx = normals.getX(i),
            ny = normals.getY(i),
            nz = normals.getZ(i);
          // Contact: height above the ground; eave: depth below the nearest overhang.
          if (mode !== 'none' && ny < 0.6) {
            if (mode === 'local') h = py - localFloor;
            else {
              world.set(px, py, pz).applyMatrix4(g.matrixWorld);
              h = world.y - plan.terrainHeight(world.x, world.z);
            }
            if (Math.abs(ny) < 0.6) {
              const qx = px + nx * 0.08,
                qz = pz + nz * 0.08;
              for (const c of caps.get(cellOf(qx, qz)) ?? [])
                if (c.id !== o.id && c.top > py - 0.06 && qx >= c.box.min.x && qx <= c.box.max.x && qz >= c.box.min.z && qz <= c.box.max.z)
                  eave = Math.min(eave, Math.max(0, c.top - py));
            }
          }
          // Bright tops, bevels that catch the light (mesh-local normals), glass that brightens upwards.
          if (ny > 0.6) shade *= 1.04;
          if (rounded) {
            const e = 1 - Math.max(Math.abs(meshNormals.getX(i)), Math.abs(meshNormals.getY(i)), Math.abs(meshNormals.getZ(i)));
            if (ny < -0.2) shade *= 1 - 0.35 * e;
            else {
              const lift = 0.35 * e * T.MathUtils.clamp(ny * 0.8 + 0.4, 0, 1);
              shade *= 1 + lift;
              warm = lift * 0.3;
            }
          }
          if (k === 'glass' && !o.userData.flatGlass) shade *= T.MathUtils.lerp(0.7, 1.15, (py - bb.min.y) / span);
        }
        bake[i * 2] = Math.round(T.MathUtils.clamp(h / BAKE_RANGE, 0, 1) * 255);
        bake[i * 2 + 1] = Math.round(T.MathUtils.clamp(eave / BAKE_RANGE, 0, 1) * 255);
        colors[i * 3] = source.color.r * (previous ? previous.getX(i) : 1) * shade * (1 + warm);
        colors[i * 3 + 1] = source.color.g * (previous ? previous.getY(i) : 1) * shade;
        colors[i * 3 + 2] = source.color.b * (previous ? previous.getZ(i) : 1) * shade * (1 - 0.6 * warm);
      }
      geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
      geometry.setAttribute('aBake', new T.BufferAttribute(bake, 2, true));
      if (!groups.has(key)) groups.set(key, { mat, cast, list: [] });
      groups.get(key)!.list.push(geometry);
      old.push(o);
    });
    old.forEach((o) => o.removeFromParent());
    for (const { mat, cast, list: geometries } of groups.values()) {
      const normalized = geometries.map((geo) => {
        const plain = geo.index ? geo.toNonIndexed() : geo;
        for (const name of Object.keys(plain.attributes))
          if (!['position', 'normal', 'color', 'uv', 'aBake'].includes(name)) plain.deleteAttribute(name);
        if (!plain.getAttribute('normal')) plain.computeVertexNormals();
        return plain;
      });
      const merged = mergeGeometries(normalized, false);
      if (merged) {
        const mesh = new T.Mesh(merged, mat);
        mesh.castShadow = cast;
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
  city.updateMatrixWorld(true);
  batch(land);
  batch(parkGroup);
  // Buildings share the library's batch materials, so one night toggle lights every window.
  for (const m of models.values()) batch(m.shell);
  for (const walker of walkers)
    for (const part of walker.root.children) {
      const joints = part.children.filter((o) => o instanceof T.Group);
      for (const joint of joints) {
        part.remove(joint);
        batch(joint as T.Group, { contact: 'none' });
      }
      batch(part as T.Group, { contact: 'none' });
      if (joints.length) part.add(...joints);
    }
  batch(tram, { contact: 'local', localFloor: 0 });
  batch(boat, { contact: 'none' });
  for (const entry of animated) if (entry.object.children.length > 1 || entry.object.children.some((c) => c instanceof T.Mesh)) batch(entry.object, { contact: 'none' });
  city.updateMatrixWorld(true);

  // Sprinkle a soft "lit window" marker for night: glass materials are shared, so one toggle lights the town.
  const parkHit = new T.Mesh(new T.BoxGeometry(plan.park.w, 2.2, plan.park.d), new T.MeshBasicMaterial({ visible: false }));
  parkHit.position.set(plan.park.x, 1.1, plan.park.z);
  parkHit.userData.placeId = 'corner-park';
  city.add(parkHit);

  return {
    city,
    land,
    models,
    walkers,
    tram,
    boat,
    lamps,
    clocks,
    animated,
    parkGroup,
    parkHit,
    waterLevel: WATER,
    groundMasks,
    materialLibrary: library,
    disposeMaterials: options.library ? () => {} : library.dispose,
  };
}
