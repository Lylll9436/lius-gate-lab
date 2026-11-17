import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SurfaceKind } from './city-materials';
import { palette, hash, sstep, type TownContext } from './town-shared';
import { RESIDENCE_LOOK } from './town-residence';
import type { WindowRole } from './town-batch';
import type { Kit } from './town-kit';
import { crown, mergeCrown, paintCrown, softenNormals, type Clump, type Nature } from './town-nature';
import type { Props } from './town-props';

/**
 * SDE4's colours, each no more saturated than its palette family (SDE4_FAMILY): white paint for
 * the parasol roof's rim and parapet, the columns and their collars, the fin block's coping and the
 * roof's plant housings (the roof's membrane between the solar rows is the same paint a step
 * deeper, by shade); the residence's pale dressing stone for the floor plates' white bands, the
 * planters and the podium's kerb and step (its kerb a step deeper); a dark warm bronze-brown for
 * the roof's soffit and the plates' undersides (by colour, never by bake: the band of shade under
 * every white edge); the residence's toned-down champagne for the end block and its fins, matte
 * (paint, so no brass glint sweeps over it; the block's body between the fins a step deeper); the
 * studio's light curtain-wall glass; the villa's grey-blue for the glazing's chunky frames and the
 * balustrades' rails (white uprights over glass twinkle); the residence's balustrade glass; a slate
 * grey for the solar panels; the residence's oak for the veranda's deck; its forecourt paving on
 * the podium.
 */
export const SDE4_LOOK = {
  paint: palette.white,
  band: RESIDENCE_LOOK.dressing,
  soffit: '#574d44',
  fin: RESIDENCE_LOOK.brass,
  glass: palette.studioGlass,
  bar: '#b2cbd2',
  rail: RESIDENCE_LOOK.balustrade,
  pv: '#59626c',
  deck: RESIDENCE_LOOK.timber,
  paving: RESIDENCE_LOOK.paving,
};
/** Each colour's palette family: the colour may be no more saturated than it (check-town). */
export const SDE4_FAMILY: Record<keyof typeof SDE4_LOOK, string> = {
  paint: palette.white,
  band: palette.render,
  soffit: palette.bronze,
  fin: palette.brass,
  glass: palette.glass,
  bar: palette.glass,
  rail: palette.glass,
  pv: palette.slate,
  deck: palette.wood,
  paving: palette.pavement,
};
/**
 * Shades (vertex colour, on the colour above) for the parts that are a step off their family's
 * colour: the membrane between the solar rows, the fin block's body between its fins, the podium's
 * kerb (the kerb's granite beside the paving), the planters, the plant housings, the columns' pads.
 */
export const SDE4_SHADE = { membrane: 0.86, body: 0.95, kerb: 0.8, planter: 0.95, housing: 0.92, pad: 0.84 };
/**
 * The planting's greens, painted (vertex colour) on the town's white foliage as its trees are, none
 * louder than the hedge's green (check-town). `shrubs`: three looks for the leafy clump masses, in
 * the crown paint's form (two body tones, a warm lit top, a cool dark underside): a mid hedge green,
 * a deeper cool green and a fresher yellow-green, so neighbouring shrubs never match. `fan`: the
 * heliconia fans' broad leaves, a cooler leaf green from the stalk (`base`) to the tip, their
 * backs a step toward `under`.
 */
export const SDE4_GREENS = {
  shrubs: [
    { tones: [palette.hedge, '#679632'], top: '#a9c05e', under: '#3c6a2e' },
    { tones: ['#4f7d34', '#58843a'], top: '#8fb26a', under: '#2f5530' },
    { tones: ['#7a9f34', '#84a63c'], top: '#c3cf63', under: '#4a6e2c' },
  ],
  fan: { base: '#3f7236', tip: '#6f9f45', under: '#2f5a32' },
};

/**
 * SDE4 (NUS College of Design and Engineering, after the owner's two photos), as a chunky toy: one
 * big parasol roof on slender white columns over three glass floor plates that step back as they
 * rise, a champagne block of bold fins at the west end, a timber veranda in the open east bay.
 * Measures in the building's own frame: x east, z south (the front faces +z), y 0 the podium's top,
 * the footprint centred on the origin.
 * - `at`: where it stands on the island, in the island's frame (origin at the island's centre, x
 *   east, z south, y up from the sea's datum, as the airport's land): its footprint's middle (x, z)
 *   and the podium's top (y). The lawn round the podium is to stand about `lift` under its top.
 * - `podium`: the low plinth everything stands on (its top y 0), its kerb's width, and its `foot`,
 *   to which the podium, its step and ramp, the fin block, the columns' pads and the planters run
 *   down so a domed lawn buries their feet.
 * - `steps`: the court's step, one tread between two 0.06 risers, along the podium's front before
 *   the entrance; `ramp`: the veranda's ramp off the podium's front, a 1:6 fall of `drop`.
 * - `roof`: the parasol. Its plan (x0..x1, z0..z1; the west end runs into the fin block), the
 *   underside of its dark soffit band (`soffit`), where its white rim begins (`rim`), its top (the
 *   membrane's) and its parapet's top; the rim's width and plan corners' radius; the solar fields'
 *   `margin` in from the rim and the service strip down the middle (`strip`, its x span).
 * - `block`: the champagne end block (its fins' faces flush with the roof's rim), its body inset
 *   `fin.proud` behind them; `fin`: the fins' pitch, width and depth, and the storey joints where
 *   the block's panels meet: a `joint`-wide cut through every fin and a groove across the body at
 *   each, one shadow line across the whole face.
 * - `columns`: radius, the x of each pair and the z either side (clear of every plate's edge).
 * - `storeys` (floor and ceiling of G, L1 and L2), `plates` (each slab's y span and edges: front,
 *   back, east; the west end meets the block at `west`; each front 0.4 behind the one under it, so
 *   the terraces step back as they rise) and `glass` (each storey's glass lines).
 * - `entrance`: the lobby's glass vestibule under the first slab: its span, its doors' line and its
 *   top; `veranda`: the open east bay's deck; `desk`, `cafe`: the anchors handed to the garden and
 *   the figure (see Sde4Build).
 */
export const SDE4 = {
  at: { x: 0, y: 0.45, z: -2.3 },
  lift: 0.12,
  podium: { x0: -5.9, x1: 5.9, z0: -4.0, z1: 4.0, kerb: 0.3, foot: -0.6 },
  steps: { x0: -3.45, x1: -0.75, run: 0.34, rise: 0.06 },
  ramp: { x0: 3.25, x1: 4.15, run: 0.72, drop: 0.12 },
  roof: { x0: -3.7, x1: 5.5, z0: -3.6, z1: 3.6, soffit: 6.62, rim: 6.92, top: 7.34, parapet: 7.44, width: 0.16, corner: 0.12, margin: 0.42, strip: [0.6, 1.2] as [number, number] },
  block: { x0: -5.5, x1: -3.7, z0: -3.6, z1: 3.6, top: 7.34 },
  fin: { pitch: 0.6, w: 0.24, proud: 0.16, corner: 0.3, joints: [1.85, 3.75, 5.62], joint: 0.04 },
  columns: { r: 0.13, x: [-2.4, 0, 2.4, 4.8], z: 3.15 },
  west: -3.7,
  storeys: [[0, 1.7], [2.0, 3.6], [3.9, 5.5]] as [number, number][],
  plates: [
    { y0: 1.7, y1: 2.0, front: 2.9, back: -2.75, east: 2.9 },
    { y0: 3.6, y1: 3.9, front: 2.5, back: -2.9, east: 2.9 },
    { y0: 5.5, y1: 5.75, front: 1.55, back: -2.55, east: 1.85 },
  ],
  glass: [
    { front: 1.9, back: -2.5, east: 2.6 },
    { front: 2.0, back: -2.6, east: 2.6 },
    { front: 1.3, back: -2.3, east: 1.6 },
  ],
  entrance: { x0: -3.0, x1: -1.2, z: 2.5, top: 1.62 },
  veranda: { x0: 2.6, x1: 5.6, z0: -3.7, z1: 3.7 },
  desk: { x: 3.9, z: 0.6, heading: 0 },
  cafe: { x: -4.0, z: 6.0, heading: 1.18 },
};
/** Where SDE4 stands on the island by default (SDE4.at: see SDE4), in the island's frame. */
export const SDE4_AT = SDE4.at;
/**
 * Its night: one light a pane in the 'campus' role (town-batch's WINDOW_MIX: offices, three in four
 * lit in the evening, half going out one by one between 22:30 and 01:30). The entrance's doors are
 * the fixed 'entrance' role, the lobby left on all night, so the front always has its door lit. The
 * balustrades' glass is 'clear', never lit. Roles of their own keep them out of check-town's room
 * shares and its count of night lamps.
 */
export const SDE4_WINDOWS: WindowRole = 'campus',
  SDE4_ENTRANCE: WindowRole = 'entrance',
  SDE4_RAILS: WindowRole = 'clear';

/**
 * A point the island's other builders work from, in the island's frame, and `heading`, the way one
 * faces there (as rotation.y: a bearing, looking along (sin, cos); 0 is south, +z).
 */
export type Sde4Anchor = { x: number; y: number; z: number; heading: number };
/**
 * What buildSde4 hands back, all in the island's frame (the group's):
 * - `desk`: the veranda desk's middle on the deck (y the deck's top), heading the way he looks
 *   from his chair behind it (south, over the lawn to the file's camera);
 * - `entrance`: the middle of the entrance doors on the floor, heading out of them;
 * - `cafe`: the café table's middle beside the court, in front of the fin block (y the lawn the
 *   podium assumes beside it: at.y - lift), heading the way he looks from his chair (east-south-east);
 * - `court`: the step's foot before the entrance, where the court's paving is to meet it (y the lawn level);
 * - `ramp`: the veranda ramp's foot (y the lawn level), heading up it (north);
 * - `footprint`: the plan box of everything the building stands on the ground (podium, step, ramp);
 * - `roof`: the parasol's plan box (with the fin block: the building's outline seen from above);
 * - `height`: the top of everything: the roof's plant housings' lids, 0.37 over its membrane (the
 *   solar panels reach about 0.23 over it); `podium`, the podium's top.
 */
export type Sde4Build = {
  desk: Sde4Anchor;
  entrance: Sde4Anchor;
  cafe: Sde4Anchor;
  court: Sde4Anchor;
  ramp: Sde4Anchor;
  footprint: { x0: number; x1: number; z0: number; z1: number };
  roof: { x0: number; x1: number; z0: number; z1: number };
  height: number;
  podium: number;
};

/* ------------------------------------------------------------------ */
/* SDE4                                                                */
/* ------------------------------------------------------------------ */
/**
 * SDE4 takes no street furniture of its own and no tree from the town's planting kit, so `_props`
 * and `_nature` go unused; they stay in the signature, which is every building factory's. Its
 * terrace planting is built here, evergreen, from leaves of its own (lance blades in rosettes,
 * heliconia fans of paddle leaves) over hearts of leafy clumps from town-nature's crown kit (the
 * town's trees' cauliflower clumps: crown, paintCrown, softenNormals, mergeCrown).
 */
export function createSde4(ctx: TownContext, kit: Kit, _props: Props, _nature: Nature) {
  const { material } = ctx;
  const { prism } = kit;
  const L = SDE4_LOOK,
    S = SDE4,
    SH = SDE4_SHADE,
    GR = SDE4_GREENS;

  /** A part for parts(): a shared geometry, where it goes in its mesh's space, and its shade. */
  type Part = { geometry: T.BufferGeometry; matrix: T.Matrix4; shade?: number };
  const ONE = new T.Vector3(1, 1, 1);
  const placed = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
    new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), ONE);
  const on = (g: T.Object3D | undefined, m: T.Matrix4) => (g ? g.matrix.clone().multiply(m) : m);
  /**
   * A block between two corners in g's frame (the building's without g), its edges round its +-z
   * faces chamfered by c (at most a quarter of its thinnest side): the face toward g's +z is the one
   * whose rim catches the light (a frame's front).
   */
  const block = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c = 0.02, g?: T.Object3D, shade = 1): Part => {
    const w = x1 - x0,
      h = y1 - y0,
      d = z1 - z0,
      k = Math.min(c, 0.24 * Math.min(w, h, d));
    return { geometry: prism([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], d, k, -d / 2), matrix: on(g, placed((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)), shade };
  };
  /**
   * Parts as one mesh in g's space, each a shade of its own (its `shade`, within +-tone/2 of it:
   * vertex colours the bake multiplies in), as separate panels get. It casts unless `shadow` is
   * false (a thin caster ghosts in the shadow map), and is a `band` unless told otherwise: a run of
   * fins or frames spread over a face would otherwise read to batch() as an overhang.
   */
  function parts(g: T.Object3D, list: Part[], colour: string, kind: SurfaceKind, opts: { shadow?: boolean; tone?: number; band?: boolean; name?: string } = {}) {
    if (!list.length) return undefined;
    const tone = opts.tone ?? 0,
      mid = new T.Vector3();
    const geometries = list.map(({ geometry, matrix, shade = 1 }) => {
      const p = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(matrix);
      for (const name of Object.keys(p.attributes)) if (name !== 'position' && name !== 'normal') p.deleteAttribute(name);
      p.computeBoundingBox();
      p.boundingBox!.getCenter(mid);
      const k = shade * (1 + tone * (hash(mid.x * 12.9898 + mid.y * 78.233 + mid.z * 37.719) - 0.5));
      p.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(p.getAttribute('position').count * 3).fill(k), 3));
      return p;
    });
    const m = new T.Mesh(mergeGeometries(geometries)!, material(colour, kind));
    geometries.forEach((p) => p.dispose());
    const shadow = opts.shadow ?? true;
    m.castShadow = shadow;
    m.receiveShadow = true;
    if (!shadow) m.userData.noShadow = true;
    if (opts.band ?? true) m.userData.band = true;
    if (opts.name) m.name = opts.name;
    g.add(m);
    return m;
  }
  /** Rounded boxes (the kit's Clash bevel), shared by size. */
  const roundedBoxes = new Map<string, RoundedBoxGeometry>();
  function roundedBox(w: number, h: number, d: number, r: number) {
    const key = [w, h, d, r].map((n) => n.toFixed(4)).join('|');
    let geometry = roundedBoxes.get(key);
    if (!geometry) roundedBoxes.set(key, (geometry = new RoundedBoxGeometry(w, h, d, 1, r)));
    return geometry;
  }
  /**
   * A chunky mass between two corners in g, a mesh of its own (a rounded box, so batch() gives its
   * bevels their light and its concave corners their shade): bevelled `bevel` (0.05 unless told), a
   * shade off its colour if asked. Flat and wide (0.3 tall or less, 0.5 across or more), it is an
   * overhang to batch() unless it is a `band`: what stands under its edge darkens up to it.
   */
  function solid(g: T.Object3D, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, colour: string, kind: SurfaceKind, opts: { bevel?: number; shade?: number; band?: boolean; name?: string } = {}) {
    const w = x1 - x0,
      h = y1 - y0,
      d = z1 - z0;
    const r = Math.min(opts.bevel ?? 0.05, 0.45 * Math.min(w, h, d));
    let geometry: T.BufferGeometry = r > 0 ? roundedBox(w, h, d, r) : new T.BoxGeometry(w, h, d);
    if (opts.shade !== undefined && opts.shade !== 1) {
      geometry = geometry.clone();
      geometry.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(opts.shade), 3));
    }
    const m = new T.Mesh(geometry, material(colour, kind));
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = m.receiveShadow = true;
    if (opts.band) m.userData.band = true;
    if (opts.name) m.name = opts.name;
    g.add(m);
    return m;
  }
  /** A face (x along it, y up, +z out of it) at (x, z) turned by ry, in g. */
  function faceAt(g: T.Object3D, x: number, z: number, ry: number) {
    const f = new T.Group();
    f.position.set(x, 0, z);
    f.rotation.y = ry;
    f.updateMatrix();
    g.add(f);
    return f;
  }
  /**
   * A pane of glass on g's face (+z out of it), its middle at (x, y) on the face: its own plane, so
   * batch() gives it its own glint, and its own night light (one light a `group`, in `role`).
   * `shade` deepens it (the top floor, in the parasol's shade).
   */
  function pane(g: T.Object3D, x: number, y: number, w: number, h: number, role: WindowRole, group: string, shade = 1) {
    const geometry = new T.PlaneGeometry(w, h);
    if (shade !== 1) geometry.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(shade), 3));
    const m = new T.Mesh(geometry, material(L.glass, 'glass'));
    m.position.set(x, y, 0);
    m.userData.windowGroup = group;
    m.userData.window = role;
    g.add(m);
    return m;
  }
  /**
   * A round post from (x, y0, z) up to y1 on 16 sides, and turned collars (a lathe's profile:
   * radius, height), as parts.
   */
  const columnGeometries = new Map<string, T.BufferGeometry>();
  const post = (r: number, h: number) => {
    const key = `post|${r}|${h.toFixed(4)}`;
    let g = columnGeometries.get(key);
    if (!g) columnGeometries.set(key, (g = new T.CylinderGeometry(r, r, h, 16)));
    return g;
  };
  const lathe = (name: string, profile: [number, number][]) => {
    let g = columnGeometries.get(name);
    if (!g) columnGeometries.set(name, (g = new T.LatheGeometry(profile.map(([r, y]) => new T.Vector2(r, y)), 16)));
    return g;
  };
  /**
   * The columns' collars, plain and modern (the real ones are plain tubes): a drum at the foot,
   * 0.40 across and 0.125 tall, its top edge eased, and a disc under the soffit, 0.42 across and
   * 0.09 tall, its lower edge eased; big enough to read at the overview, so each column reads as
   * carrying the roof and never as a pole.
   */
  const BASE: [number, number][] = [[0, 0], [0.2, 0], [0.2, 0.1], [0.18, 0.125], [0, 0.125]];
  const CAPITAL: [number, number][] = [[0, 0], [0.185, 0], [0.21, 0.025], [0.21, 0.09], [0, 0.09]];
  /**
   * A rim round a plan (x0..x1, z0..z1, its east corners rounded r), `width` wide on the south, east
   * and north (its west side is the end block's face, so it stays open there: a U in plan), standing
   * from y0 to y1, as one seamless solid whose every edge is chamfered c: the parasol's white fascia
   * and parapet. (In the shape's plane y is -z.)
   */
  function rimGeometry(x0: number, x1: number, z0: number, z1: number, width: number, r: number, y0: number, y1: number, c: number) {
    const s = new T.Shape(),
      a = -z1,
      b = -z0,
      w = width,
      q = Math.max(0.02, r - w);
    s.moveTo(x0, a);
    s.lineTo(x1 - r, a);
    s.quadraticCurveTo(x1, a, x1, a + r);
    s.lineTo(x1, b - r);
    s.quadraticCurveTo(x1, b, x1 - r, b);
    s.lineTo(x0, b);
    s.lineTo(x0, b - w);
    s.lineTo(x1 - w - q, b - w);
    s.quadraticCurveTo(x1 - w, b - w, x1 - w, b - w - q);
    s.lineTo(x1 - w, a + w + q);
    s.quadraticCurveTo(x1 - w, a + w, x1 - w - q, a + w);
    s.lineTo(x0, a + w);
    s.lineTo(x0, a);
    return new T.ExtrudeGeometry(s, { depth: y1 - y0 - 2 * c, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelOffset: -c, bevelSegments: 2, curveSegments: 3 })
      .translate(0, 0, y0 + c)
      .rotateX(-Math.PI / 2);
  }
  /* ---------------------------------------------------------------- */
  /* The planting kit                                                  */
  /* ---------------------------------------------------------------- */
  /** A leaf's paint: its stalk's green (`base`), its tip's (`tip`) and the green its underside leans to (`under`). */
  type LeafLook = { base: T.Color; tip: T.Color; under: T.Color };
  const FAN: LeafLook = { base: new T.Color(GR.fan.base), tip: new T.Color(GR.fan.tip), under: new T.Color(GR.fan.under) },
    // The rosettes' blades in the shrubs' three greens: a step deeper at the foot, a little lit toward the tip.
    BLADE: LeafLook[] = GR.shrubs.map((g) => ({ base: new T.Color(g.tones[0]).multiplyScalar(0.8), tip: new T.Color(g.tones[1]).lerp(new T.Color(g.top), 0.3), under: new T.Color(g.under) })),
    LEAF_STEPS = 24;
  /** A leafy clump of the crown kit at a shrub's scale: few, deep florets (the trees' cauliflower, never a clipped ball). */
  const clump = (x: number, y: number, z: number, r: number, seed: number, sy = 0.85): Clump => ({ x, y, z, r, sy, florets: 9, amp: 0.17, detail: 2, seed });
  /** A plant for mass(): its leafy clumps and its green (an index into SDE4_GREENS.shrubs). */
  type Plant = { clumps: Clump[]; green: number };
  /**
   * Plants as one leafy geometry: their clumps' hidden insides culled across the whole mass (so
   * neighbours run into each other), then each plant painted in its own green, dark low down and
   * lit on top between y0 and y1, darker in the creases between its clumps and its florets' valleys,
   * and its normals eased toward its own round, so it reads as one soft shrub with leafy lumps.
   */
  function mass(plants: Plant[], y0: number, y1: number, seed: number) {
    const { built } = crown(plants.flatMap((p) => p.clumps));
    let k = 0;
    plants.forEach((p, i) => {
      const own = built.slice(k, (k += p.clumps.length)),
        weight = p.clumps.reduce((s, c) => s + c.r, 0),
        centre = p.clumps.reduce((v, c) => v.add(new T.Vector3(c.x, c.y, c.z).multiplyScalar(c.r / weight)), new T.Vector3());
      paintCrown(own, GR.shrubs[p.green], y0, y1, centre, seed * 13 + i, { floor: 0.55, valley: 0.8, crease: 0.24, inner: 0.2 });
      softenNormals(own, centre, 0.85, 0.3);
    });
    return compact(mergeCrown(built));
  }
  /** An indexed geometry without the vertices no triangle uses (the crown kit's culling leaves them behind). */
  function compact(g: T.BufferGeometry) {
    const index = g.getIndex()!,
      slot = new Int32Array(g.getAttribute('position').count).fill(-1),
      order: number[] = [],
      out = new T.BufferGeometry();
    for (let i = 0; i < index.count; i++) {
      const k = index.getX(i);
      if (slot[k] < 0) {
        slot[k] = order.length;
        order.push(k);
      }
    }
    for (const name of Object.keys(g.attributes)) {
      const a = g.getAttribute(name) as T.BufferAttribute,
        size = a.itemSize,
        from = a.array,
        to = new Float32Array(order.length * size);
      order.forEach((k, j) => {
        for (let c = 0; c < size; c++) to[j * size + c] = from[k * size + c];
      });
      out.setAttribute(name, new T.BufferAttribute(to, size));
    }
    out.setIndex(Array.from({ length: index.count }, (_, i) => slot[index.getX(i)]));
    g.dispose();
    return out;
  }
  /**
   * A leaf on its stalk, a closed smooth solid from its foot: the stalk 0.07 round for `stalk` of its
   * `length`, then a blade `half` its half width and 0.07 thick at the midrib, its edges lifted
   * toward its face (a shallow cup), closing to a blunt tip (a paddle) or tapering to a point
   * (`point`: a lance). Its spine leans `lean` from the vertical and arches over by `arch` more
   * toward the tip, in the upright plane along leaf space's x, which turns to (cos face, -sin face)
   * in the building's frame. A paddle's blade lies in that plane and shows its breadth to the
   * bearing `face` (its tip bowing `bow` toward it); a `flat` blade lies across the plane and shows
   * its breadth to the sky as it arches over. `ring` sides round it (6, or 4 for a small blade: a
   * keeled section). Painted from `look.base` at the stalk to `look.tip`, its underside a step
   * toward `look.under`.
   */
  function leaf(foot: T.Vector3, face: number, o: { length: number; stalk: number; half: number; lean: number; arch: number; bow?: number; flat?: boolean; point?: boolean }, look: LeafLook, ring = 6) {
    const { length, half, lean, arch } = o,
      bow = o.bow ?? 0,
      s0 = o.stalk / length,
      rest = 1 - s0,
      stations = o.flat ? [0, s0, s0 + 0.22 * rest, s0 + 0.5 * rest, s0 + 0.8 * rest, 1] : [0, s0, s0 + 0.1 * rest, s0 + 0.3 * rest, s0 + 0.52 * rest, s0 + 0.74 * rest, s0 + 0.9 * rest, 1],
      cf = Math.cos(face),
      sf = Math.sin(face),
      position: number[] = [],
      colour: number[] = [],
      index: number[] = [],
      c = new T.Color(),
      angle = (u: number) => lean + arch * u ** 1.8;
    // The spine in leaf space's upright plane (x, y), in fine steps; z, across that plane, is the bow.
    const spine: [number, number][] = [[0, 0]];
    for (let i = 1; i <= LEAF_STEPS; i++) {
      const phi = angle((i - 0.5) / LEAF_STEPS),
        [px, py] = spine[i - 1];
      spine.push([px + (length / LEAF_STEPS) * Math.sin(phi), py + (length / LEAF_STEPS) * Math.cos(phi)]);
    }
    // Leaf space to the building's frame: turned about the vertical by `face`, at the foot.
    const put = (x: number, y: number, z: number) => position.push(foot.x + x * cf + z * sf, foot.y + y, foot.z - x * sf + z * cf);
    stations.forEach((u, r) => {
      const f = u * LEAF_STEPS,
        i = Math.min(LEAF_STEPS - 1, Math.floor(f)),
        t = f - i,
        px = spine[i][0] + (spine[i + 1][0] - spine[i][0]) * t,
        py = spine[i][1] + (spine[i + 1][1] - spine[i][1]) * t,
        pz = bow * u ** 3,
        v = Math.max(0, (u - s0) / rest),
        green = (back: number) => {
          c.copy(look.base).lerp(look.tip, sstep(v, 0.05, 1)).lerp(look.under, back);
          if (u <= s0) c.multiplyScalar(0.88);
          colour.push(c.r, c.g, c.b);
        };
      if (r === stations.length - 1) {
        put(px, py, pz);
        green(0);
        return;
      }
      const w = u <= s0 ? 0.035 : Math.max(0.035, half * (o.point ? Math.sin(Math.PI * v ** 0.8) ** 0.9 : Math.sin(Math.PI * v) ** 0.6)),
        th = u <= s0 ? 0.035 : 0.035 * (1 - 0.4 * v * v),
        phi = angle(u),
        // The section's axes: across the blade (e1) and out of its face (e2); e1 x e2 runs back down the spine.
        [e1x, e1y, e1z, e2x, e2y, e2z] = o.flat ? [0, 0, 1, -Math.cos(phi), Math.sin(phi), 0] : [Math.cos(phi), -Math.sin(phi), 0, 0, 0, 1];
      for (let j = 0; j < ring; j++) {
        const q = (j / ring) * Math.PI * 2,
          across = w * Math.cos(q),
          out = th * Math.sin(q) + (u > s0 ? 0.3 * w * Math.cos(q) ** 2 : 0);
        put(px + e1x * across + e2x * out, py + e1y * across + e2y * out, pz + e1z * across + e2z * out);
        green(Math.sin(q) < -0.1 ? 0.35 : 0);
      }
    });
    // Rings joined round the spine (each band's two triangles facing out), closed at the tip; the
    // stalk's foot stays open, sunk in its planter or its plant.
    const rings = stations.length - 1,
      tip = rings * ring;
    for (let r = 0; r + 1 < rings; r++)
      for (let j = 0; j < ring; j++) {
        const a = r * ring + j,
          b = r * ring + ((j + 1) % ring);
        index.push(a, a + ring, b + ring, a, b + ring, b);
      }
    for (let j = 0; j < ring; j++) index.push((rings - 1) * ring + j, tip, (rings - 1) * ring + ((j + 1) % ring));
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(colour, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  }
  /**
   * A heliconia-like fan: `n` paddle leaves on stalks from one foot at (x, y, z), spread across its
   * face (turned to the bearing `face`), the middle ones tallest, each blade arching over to its
   * own side and its tip bowing a little forward, each turned a little out of the face so the fan
   * has depth; `size` is the middle leaf's length, `half` the blades' half width.
   */
  function fan(x: number, y: number, z: number, face: number, size: number, n: number, seed: number, half = 0.1) {
    const foot = new T.Vector3(x, y, z),
      leaves: T.BufferGeometry[] = [];
    for (let k = 0; k < n; k++) {
      const h = (i: number) => hash(seed * 5.1 + k * 2.3 + i * 0.77),
        s = n > 1 ? k / (n - 1) - 0.5 : 0,
        side = Math.sign(s) || (h(1) < 0.5 ? -1 : 1),
        length = size * (1 - 0.5 * Math.abs(s)) * (0.92 + 0.12 * h(2));
      leaves.push(leaf(foot, face + (h(3) - 0.5) * 0.6, { length, stalk: 0.4 * length, half: half * (0.9 + 0.2 * h(4)), lean: 1.15 * s + (h(5) - 0.5) * 0.12, arch: side * (0.25 + 0.9 * Math.abs(s)), bow: 0.05 + 0.08 * h(6) }, FAN));
    }
    return leaves;
  }
  /**
   * A leafy plant of blades from one foot at (x, y, z), in toy form: `n` broad leaves (a philodendron
   * or a peace lily; `point`, lance blades: a cordyline) each leaning out from the vertical about
   * `lean` and arching over about `arch` more toward its tip, so the plant is a fountain of leaves
   * with a leafy, uneven outline. The blades point all round it, or across `arc` about the bearing
   * `turn` (on a narrow balcony, away from the glass); `size` is their length, `half` their half
   * width, in the blade green `green`.
   */
  function rosette(x: number, y: number, z: number, green: number, seed: number, o: { n: number; size: number; half?: number; lean?: number; arch?: number; point?: boolean; turn?: number; arc?: number }) {
    const foot = new T.Vector3(x, y, z),
      round = o.arc === undefined,
      arc = o.arc ?? Math.PI * 2,
      leaves: T.BufferGeometry[] = [];
    for (let k = 0; k < o.n; k++) {
      const h = (i: number) => hash(seed * 4.3 + k * 1.7 + i * 0.53),
        bearing = (o.turn ?? hash(seed * 0.37) * 6.283) + (round ? (k / o.n) * arc : o.n > 1 ? (k / (o.n - 1) - 0.5) * arc : 0) + (h(1) - 0.5) * (round ? 0.6 : 0.2),
        length = o.size * (0.82 + 0.3 * h(2));
      leaves.push(leaf(foot, bearing - Math.PI / 2, { length, stalk: 0.1 * length, half: (o.half ?? 0.07) * (0.9 + 0.2 * h(5)), lean: (o.lean ?? 0.6) * (0.6 + 0.8 * h(3)), arch: (o.arch ?? 0.85) * (0.8 + 0.4 * h(4)), flat: true, point: o.point ?? false }, BLADE[green], 4));
    }
    return leaves;
  }
  /** The terraces' three kinds of leafy plant (rosette() options): broad and spreading, lance blades, broad and upright. */
  const PLANTS = [
    { n: 7, size: 0.5, half: 0.11, lean: 0.6, arch: 1.0 },
    { n: 8, size: 0.48, half: 0.075, lean: 0.45, arch: 0.8, point: true },
    { n: 7, size: 0.55, half: 0.115, lean: 0.3, arch: 1.05 },
  ];
  /**
   * Leafy plants packed along a planter (x0..x1, z0..z1, its soil at `top`), about `step` apart and
   * a little off its middle line by turns, so their leaves run together into one leafy mass with an
   * uneven top: each a kind of PLANTS by turns and a green of its own, never its neighbour's;
   * `scale` sizes them.
   */
  function bed(x0: number, x1: number, z0: number, z1: number, top: number, seed: number, o: { step: number; scale?: number }) {
    const long = x1 - x0 >= z1 - z0,
      a = long ? x0 : z0,
      b = long ? x1 : z1,
      mid = long ? (z0 + z1) / 2 : (x0 + x1) / 2,
      n = Math.max(1, Math.round((b - a) / o.step)),
      step = (b - a) / n,
      leaves: T.BufferGeometry[] = [];
    let green = Math.floor(hash(seed * 3.3) * 3);
    for (let k = 0; k < n; k++) {
      const h = (i: number) => hash(seed * 7.3 + k * 1.9 + i * 0.61),
        t = a + step * (k + 0.5) + (h(1) - 0.5) * step * 0.3,
        off = (k % 2 ? 1 : -1) * 0.05 * (0.5 + h(2)),
        kind = PLANTS[(k + Math.floor(h(3) * 2)) % 3],
        scale = (o.scale ?? 1) * (0.9 + 0.22 * h(4));
      green = (green + 1 + Math.floor(h(5) * 1.999)) % 3;
      const [x, z] = long ? [t, mid + off] : [mid + off, t];
      leaves.push(...rosette(x, top - 0.03, z, green, seed * 31 + k, { ...kind, size: kind.size * scale }));
    }
    return leaves;
  }
  /**
   * Leaves spilling over a lip or a rail toward the bearing `toward`: `n` long lance blades (`size`
   * long) from a foot at (x, y, z) inside the planting, spread a little either side of it, each
   * leaning out about `lean` and arching right over by about `arch` more, so it clears the edge
   * and its tip hangs down past it.
   */
  function spill(x: number, y: number, z: number, toward: number, green: number, seed: number, o: { n?: number; size?: number; lean?: number; arch?: number } = {}) {
    const foot = new T.Vector3(x, y, z),
      n = o.n ?? 3,
      size = o.size ?? 0.55,
      leaves: T.BufferGeometry[] = [];
    for (let k = 0; k < n; k++) {
      const h = (i: number) => hash(seed * 3.1 + k * 2.9 + i * 0.41),
        bearing = toward + (n > 1 ? (k / (n - 1) - 0.5) * (n > 2 ? 1.3 : 0.65) : 0) + (h(1) - 0.5) * 0.2;
      leaves.push(leaf(foot, bearing - Math.PI / 2, { length: size * (0.9 + 0.2 * h(2)), stalk: 0.06 * size, half: 0.06, lean: (o.lean ?? 0.85) + 0.08 * h(3), arch: (o.arch ?? 2.1) + 0.2 * h(4), flat: true, point: true }, BLADE[green], 4));
    }
    return leaves;
  }

  /**
   * SDE4 (front +z; see SDE4), in the toy language of the town's Clash look: few, big, bold parts
   * with clear secondary and tertiary structure and calm surfaces.
   * - The parasol: one huge flat roof over everything, its edge a thick white rim (fascia and
   *   parapet in one seamless chamfered piece, its plan corners rounded) over a dark soffit band set
   *   back under it, so from every side and from the town's camera above it reads as a white-edged
   *   plate with a band of shade under it; on top, inside the parapet, a membrane a step deeper than
   *   the rim and two fields of solar panels either side of a service strip (rows of chunky modules
   *   tilted to the south on dark rails, two louvred plant housings on the strip).
   * - Eight slender white columns, Ø0.26, standing clear of the plates from the podium to the
   *   soffit on granite pads, each with a plain drum at its foot and a disc under the soffit.
   * - The champagne end block at the west, as tall as the roof's rim and flush with it: corner piers
   *   and bold vertical fins (0.6 apart, 0.24 wide, 0.16 deep, their front corners chamfered) down
   *   its south, west and north faces and on the strip of its east face the file's camera sees; its
   *   storey panels (body and fins, each a shade of its own) meet in one narrow shadow line across
   *   the face, the fins cut square there; a white coping.
   * - Three glass floor plates stepping back as they rise: each slab a thick white band over a dark
   *   underside set in from it (a shadow line under every band), the ground floor set back under the
   *   first slab (the undercroft), the top floor set back behind a planted terrace and shaded under
   *   the parasol; the glazing a simple grid of big floor-to-ceiling panes in chunky grey-blue frames
   *   0.1 proud of the glass (deep reveals), the frames' rails and corner posts as fat as their
   *   uprights; the east ends cascade under the open east bay. Glass balustrades (no posts) with a
   *   grey-blue rail round the terraces.
   * - The planting, evergreen: the top terrace's planters against its rails, leafy rosettes of lance
   *   blades in three greens over a heart of leafy clumps, rising over the rail, heliconia fans of
   *   paddle leaves standing out of them and, on the file's front, leaves spilling over the rail at
   *   two places; in the veranda's planters a heliconia fan, and a leafy shrub spilling over its lip.
   * - The entrance: the lobby's glass vestibule standing out of the ground floor under the first
   *   slab, under a white cap, its doors warm at night; a step down to the court before it.
   * - The veranda: the open east bay, a timber deck flush with the podium, two big planters at its
   *   south edge leaving the way from the ramp to the desk open, the ramp off the podium's front.
   * - The podium: a low paved plinth with a granite kerb.
   * No text, numbers or signage anywhere, and nothing that moves. Every pane is a light of its own.
   * To wire it: build into a group in the island's frame (its origin at the island's centre, y the
   * sea's datum); the building's frame stands at `at` in it. Then `batch(group, { place,
   * floor: () => the lawn's height })`, after the town's buildings; its panes carry their own roles.
   */
  function buildSde4(group: T.Group, at: { x: number; y: number; z: number } = S.at): Sde4Build {
    const frame = new T.Group();
    frame.name = 'sde4';
    frame.position.set(at.x, at.y, at.z);
    frame.updateMatrix();
    group.add(frame);
    const id = 'tropic-island-sde4',
      west = S.west,
      P = S.podium,
      R = S.roof,
      B = S.block,
      F = S.fin;
    const white: Part[] = [], // white paint: the columns' shafts and collars, the plant housings
      bands: Part[] = [], // the dressing stone: the columns' pads
      soffit: Part[] = [], // the plates' dark undersides
      fins: Part[] = [], // the champagne fins
      bars: Part[] = [], // the glazing's frames and the rails (cast nothing)
      pv: Part[] = [], // the solar modules and their rails
      deck: Part[] = [], // the veranda's boards
      greenery: T.BufferGeometry[] = []; // every shrub mass and leaf: one foliage mesh

    /* -------------------------------------------------------------- */
    /* The podium                                                     */
    /* -------------------------------------------------------------- */
    {
      const k = P.kerb,
        top = 0,
        foot = P.foot,
        V = S.veranda;
      // The granite kerb round it, chunky and bevelled, its top flush with the paving.
      solid(frame, P.x0, P.x1, foot, top, P.z1 - k, P.z1, L.band, 'stone', { bevel: 0.06, shade: SH.kerb, name: 'sde4-podium' });
      solid(frame, P.x0, P.x1, foot, top, P.z0, P.z0 + k, L.band, 'stone', { bevel: 0.06, shade: SH.kerb, name: 'sde4-podium' });
      solid(frame, P.x0, P.x0 + k, foot, top, P.z0 + k - 0.02, P.z1 - k + 0.02, L.band, 'stone', { bevel: 0.06, shade: SH.kerb, name: 'sde4-podium' });
      solid(frame, P.x1 - k, P.x1, foot, top, P.z0 + k - 0.02, P.z1 - k + 0.02, L.band, 'stone', { bevel: 0.06, shade: SH.kerb, name: 'sde4-podium' });
      // The paving inside it (a ground surface: no bake), round the veranda's deck.
      const x0 = P.x0 + k - 0.01,
        x1 = P.x1 - k + 0.01,
        z0 = P.z0 + k - 0.01,
        z1 = P.z1 - k + 0.01;
      const pave = (a: number, b: number, c: number, d: number) => {
        const m = solid(frame, a, b, foot + 0.05, top - 0.004, c, d, L.paving, 'paving', { bevel: 0.02, name: 'sde4-podium' });
        m.userData.ground = true;
      };
      pave(x0, V.x0, z0, z1);
      // East of it the deck fills the kerb's whole open east bay: oak boards running north-south,
      // flush with the paving (its top y 0), each a shade of its own (tone strips, no grooves to crawl).
      const boards = Math.round((x1 - V.x0) / 0.3),
        w = (x1 - V.x0) / boards;
      for (let i = 0; i < boards; i++) deck.push(block(V.x0 + i * w + 0.004, V.x0 + (i + 1) * w - 0.004, -0.075, 0, z0, z1, 0.012));
      // The court's step before the entrance: one tread between two risers of `rise`, its nosing
      // the podium's kerb, its foot run down for the lawn to bury.
      const ST = S.steps;
      solid(frame, ST.x0, ST.x1, foot, -ST.rise, P.z1 - 0.06, P.z1 + ST.run, L.band, 'stone', { bevel: 0.03, shade: SH.kerb, name: 'sde4-podium' });
      // The veranda's ramp: a 1:6 fall off the kerb, paved, its foot at the lawn round the podium.
      const RA = S.ramp,
        ramp = new T.Mesh(
          prism([[P.z1 - 0.06, 0], [P.z1 + RA.run, -RA.drop], [P.z1 + RA.run, foot], [P.z1 - 0.06, foot]].map(([zz, yy]): [number, number] => [-zz, yy]), RA.x1 - RA.x0, 0.015, 0)
            .clone()
            .rotateY(Math.PI / 2),
          material(L.paving, 'paving'),
        );
      ramp.position.x = RA.x0;
      ramp.castShadow = ramp.receiveShadow = true;
      ramp.userData.ground = true;
      ramp.name = 'sde4-podium';
      frame.add(ramp);
    }

    /* -------------------------------------------------------------- */
    /* The parasol                                                    */
    /* -------------------------------------------------------------- */
    {
      // The white rim: fascia and parapet as one seamless piece, its west end inside the block.
      const rim = new T.Mesh(rimGeometry(R.x0, R.x1, R.z0, R.z1, R.width, R.corner, R.rim, R.parapet, 0.035), material(L.paint, 'paint'));
      rim.castShadow = rim.receiveShadow = true;
      rim.userData.band = true;
      rim.name = 'sde4-roof-rim';
      frame.add(rim);
      // The roof's body inside the rim, its top the membrane (a step deeper than the rim).
      solid(frame, R.x0 - 0.02, R.x1 - R.width + 0.03, R.rim + 0.03, R.top, R.z0 + R.width - 0.03, R.z1 - R.width + 0.03, L.paint, 'paint', { bevel: 0.03, shade: SH.membrane, band: true, name: 'sde4-roof' });
      // The dark soffit band: the roof's underside, 0.3 deep, its edge set 0.02 back under the rim,
      // so a band of shade runs under the white edge seen from every side and from above (the
      // photos' dark soffit, which the town's camera, looking down, would otherwise never see). An
      // overhang to batch(): the columns' heads darken up into it.
      solid(frame, R.x0 - 0.02, R.x1 - 0.02, R.soffit, R.rim + 0.002, R.z0 + 0.02, R.z1 - 0.02, L.soffit, 'wood', { bevel: 0.025, name: 'sde4-soffit' });
      // The solar fields: either side of the service strip, inside the margin; rows of chunky
      // modules (0.95 by 0.8) tilted 10 degrees to the south on a dark rail under each row's high
      // (north) edge, the membrane showing between the rows.
      const inner = R.width + R.margin,
        zA = R.z0 + inner,
        zB = R.z1 - inner,
        rows = 6,
        deep = 0.78,
        gap = (zB - zA - rows * deep) / (rows - 1),
        tilt = (10 * Math.PI) / 180,
        // The module's middle stands so its low (south) edge clears the membrane by 0.02.
        rise = 0.02 + 0.04 * Math.cos(tilt) + (deep / 2) * Math.sin(tilt);
      for (const [x0, x1] of [[B.x1 + inner, R.strip[0]], [R.strip[1], R.x1 - inner]] as [number, number][]) {
        const n = Math.max(1, Math.round((x1 - x0) / 0.95)),
          mw = (x1 - x0) / n;
        for (let r = 0; r < rows; r++) {
          const zc = zA + r * (deep + gap) + deep / 2,
            north = zc - deep / 2;
          // The rail under the row's high edge.
          pv.push(block(x0 + 0.05, x1 - 0.05, R.top - 0.02, R.top + rise + 0.05, north + 0.04, north + 0.15, 0.02));
          for (let k = 0; k < n; k++) {
            const xa = x0 + k * mw + 0.006,
              xb = x0 + (k + 1) * mw - 0.006,
              w = xb - xa;
            pv.push({
              geometry: prism([[-w / 2, -0.04], [w / 2, -0.04], [w / 2, 0.04], [-w / 2, 0.04]], deep, 0.02, -deep / 2),
              matrix: placed((xa + xb) / 2, R.top + rise, zc, tilt, 0, 0),
              shade: 1 + 0.06 * (hash(xa * 3.1 + zc * 7.7) - 0.5),
            });
          }
        }
      }
      // Two plant housings on the strip: chunky white boxes under an overhanging lid, three broad
      // louvres on each long side.
      const sx = (R.strip[0] + R.strip[1]) / 2;
      for (const zc of [-1.25, 1.25]) {
        white.push(block(sx - 0.22, sx + 0.22, R.top - 0.02, R.top + 0.3, zc - 0.45, zc + 0.45, 0.03, undefined, SH.housing));
        white.push(block(sx - 0.28, sx + 0.28, R.top + 0.3, R.top + 0.37, zc - 0.51, zc + 0.51, 0.025, undefined, SH.housing));
        for (let k = 0; k < 3; k++) {
          const y = R.top + 0.04 + k * 0.085;
          for (const s of [-1, 1]) white.push(block(sx + s * 0.22 - 0.035, sx + s * 0.22 + 0.035, y, y + 0.07, zc - 0.4, zc + 0.4, 0.015, undefined, SH.housing));
        }
      }
    }

    /* -------------------------------------------------------------- */
    /* The columns                                                    */
    /* -------------------------------------------------------------- */
    {
      const C = S.columns,
        base = lathe('base', BASE),
        capital = lathe('capital', CAPITAL),
        top = R.soffit;
      for (const x of C.x)
        for (const s of [-1, 1]) {
          const z = s * C.z;
          // The granite pad (dressing stone a step deeper), its foot in the paving.
          bands.push(block(x - 0.25, x + 0.25, -0.04, 0.06, z - 0.25, z + 0.25, 0.025, undefined, SH.pad));
          white.push({ geometry: base, matrix: placed(x, 0.06, z) });
          // The shaft, from inside the drum up into the disc.
          white.push({ geometry: post(C.r, top - 0.13), matrix: placed(x, 0.08 + (top - 0.13) / 2, z) });
          white.push({ geometry: capital, matrix: placed(x, top - 0.09, z) });
        }
    }

    /* -------------------------------------------------------------- */
    /* The champagne end block                                        */
    /* -------------------------------------------------------------- */
    {
      const p = F.proud,
        bx0 = B.x0 + p,
        bz0 = B.z0 + p,
        bz1 = B.z1 - p,
        c = F.corner;
      // The storeys' panels, each a shade of its own (its body and its fins alike), and the fins'
      // runs: from the podium to each storey joint and on to under the coping.
      const levels = [P.foot + 0.1, ...F.joints, B.top],
        tones = levels.slice(1).map((_, r) => 1 + 0.06 * (hash(r * 7.1 + 3) - 0.5)),
        runs: [number, number][] = [];
      let y = 0.1;
      for (const j of [...F.joints, B.top - 0.02]) {
        runs.push([y, j - F.joint / 2]);
        y = j + F.joint / 2;
      }
      // The body behind the fins, a step deeper than them, from the podium to under the coping: a
      // panel a storey, their bevels meeting in a shallow groove at each joint, which runs on through
      // the fins' cuts, so every joint is one line across the face.
      for (let i = 0; i + 1 < levels.length; i++)
        solid(frame, bx0, B.x1, levels[i], levels[i + 1], bz0, bz1, L.fin, 'paint', { bevel: 0.035, shade: SH.body * tones[i], band: true, name: 'sde4-block' });
      // The white coping over the whole block, flush with the fins' faces, a hair over the roof's
      // parapet where it meets the rim (so their tops never fight).
      solid(frame, B.x0, B.x1 + 0.05, B.top - 0.01, R.parapet + 0.012, B.z0, B.z1, L.paint, 'paint', { bevel: 0.035, band: true, name: 'sde4-coping' });
      // Square piers at the west corners (`corner` each way) and narrower ones at the south and
      // north faces' east ends beside the roof's rim, full height, closing the block's outline.
      for (const s of [-1, 1]) {
        const zf = s > 0 ? B.z1 : B.z0;
        solid(frame, B.x0, B.x0 + c, 0.02, B.top - 0.005, Math.min(zf, zf - s * c), Math.max(zf, zf - s * c), L.fin, 'paint', { bevel: 0.04, band: true, name: 'sde4-block' });
        solid(frame, B.x1 - 0.2, B.x1, 0.02, B.top - 0.005, Math.min(zf, zf - s * (p + 0.02)), Math.max(zf, zf - s * (p + 0.02)), L.fin, 'paint', { bevel: 0.04, band: true, name: 'sde4-block' });
      }
      // The fins, on the south and north faces between the piers and down the west face, each
      // built on its face (x along it, +z out of it): its plan section (F.w across, from 0.02 inside
      // the body to `proud` out of it, its two front corners chamfered) run straight up its storey,
      // its ends cut square, so a joint is a clean shadow line and never a lit notch.
      const along = (a: number, b: number) => {
        const n = Math.max(1, Math.round((b - a) / F.pitch)),
          step = (b - a) / n;
        return Array.from({ length: n }, (_, k) => a + step * (k + 0.5));
      };
      const ch = 0.045,
        section: [number, number][] = [[-F.w / 2, 0.02], [-F.w / 2, ch - p], [ch - F.w / 2, -p], [F.w / 2 - ch, -p], [F.w / 2, ch - p], [F.w / 2, 0.02]],
        upright = new T.Matrix4().makeRotationX(-Math.PI / 2); // the section's extrusion up; its y is out of the face
      const south = faceAt(frame, 0, bz1, 0),
        north = faceAt(frame, 0, bz0, Math.PI), // x along it runs west (-x)
        westFace = faceAt(frame, bx0, 0, -Math.PI / 2), // x along it runs south (+z)
        eastFace = faceAt(frame, B.x1, 0, Math.PI / 2); // x along it runs north (-z)
      // The east face is the stack's party wall; where it shows (the strip in front of every
      // plate's edge, toward the file's camera) it carries fins too, or it reads as a dark void.
      const strip = Math.max(...S.plates.map((q) => q.front)) + 0.12;
      runs.forEach(([y0, y1], r) => {
        const fin = (g: T.Object3D, x: number) => fins.push({ geometry: prism(section, y1 - y0, 0, 0), matrix: on(g, placed(x, y0, 0).multiply(upright)), shade: tones[r] });
        for (const x of along(B.x0 + c, B.x1 - 0.2)) {
          fin(south, x);
          fin(north, -x);
        }
        for (const z of along(B.z0 + c, B.z1 - c)) fin(westFace, z);
        for (const z of along(strip, bz1)) fin(eastFace, -z);
      });
    }

    /* -------------------------------------------------------------- */
    /* The floor plates and their glass                               */
    /* -------------------------------------------------------------- */
    const PANE = 1.25,
      BAR = 0.1,
      PROUD = 0.1,
      SILL = 0.1,
      HEAD = 0.08;
    let lights = 0;
    /**
     * One storey's glazing on a face (g: x along it, y up, +z out of it) from x a to b, y0 to y1:
     * floor-to-ceiling panes about PANE wide, each its own light (in `role`, or the one `group`
     * given), in chunky frames PROUD in front of the glass (an upright at each end and between every
     * two panes, a sill rail and a head rail).
     */
    function glaze(g: T.Object3D, a: number, b: number, y0: number, y1: number, opts: { role?: WindowRole; group?: string; shade?: number; n?: number } = {}) {
      const n = opts.n ?? Math.max(1, Math.round((b - a) / PANE)),
        w = (b - a) / n,
        role = opts.role ?? SDE4_WINDOWS;
      for (let k = 0; k < n; k++) pane(g, a + w * (k + 0.5), (y0 + SILL + y1 - HEAD) / 2, w - BAR + 0.02, y1 - y0 - SILL - HEAD + 0.02, role, opts.group ?? `${id}-${lights++}`, opts.shade);
      for (let k = 0; k <= n; k++) bars.push(block(a + w * k - BAR / 2, a + w * k + BAR / 2, y0, y1, -0.02, PROUD, 0.025, g));
      bars.push(block(a - BAR / 2, b + BAR / 2, y0, y0 + SILL, -0.02, PROUD, 0.025, g), block(a - BAR / 2, b + BAR / 2, y1 - HEAD, y1, -0.02, PROUD, 0.025, g));
    }
    S.storeys.forEach(([y0, y1], s) => {
      const G = S.glass[s],
        shade = s === 2 ? 0.82 : 1,
        front = faceAt(frame, 0, G.front, 0),
        east = faceAt(frame, G.east, 0, Math.PI / 2), // x along it runs north (-z)
        back = faceAt(frame, 0, G.back, Math.PI); // x along it runs west (-x)
      if (s === 0) {
        // The ground floor's front either side of the entrance: a glass vestibule standing out
        // under the first slab (set back as deep as the glass is, the doors would be hidden from
        // the town's camera, which looks down under the slab's edge), its doors in front and its
        // sides one light with them (the lobby, lit all night), under a white cap.
        const E = S.entrance,
          lobby = { role: SDE4_ENTRANCE, group: `${id}-entrance` };
        glaze(front, west, E.x0, y0, y1);
        glaze(front, E.x1, G.east, y0, y1);
        glaze(faceAt(frame, 0, E.z, 0), E.x0, E.x1, y0, E.top, { ...lobby, n: 2 });
        glaze(faceAt(frame, E.x0, 0, -Math.PI / 2), G.front, E.z, y0, E.top, { ...lobby, n: 1 }); // x along it runs south
        glaze(faceAt(frame, E.x1, 0, Math.PI / 2), -E.z, -G.front, y0, E.top, { ...lobby, n: 1 }); // x along it runs north
        solid(frame, E.x0 - 0.1, E.x1 + 0.1, E.top, y1 + 0.02, G.front - 0.05, E.z + 0.14, L.paint, 'paint', { bevel: 0.03, band: true, name: 'sde4-entrance' });
      } else glaze(front, west, G.east, y0, y1, { shade });
      glaze(east, -G.front, -G.back, y0, y1, { shade });
      glaze(back, -G.east, -west, y0, y1, { shade });
      // Fat corner posts where the east end meets the front and the back.
      for (const z of [G.front, G.back]) {
        const s = Math.sign(z),
          za = z - 0.06 * s,
          zb = z + (PROUD + 0.02) * s;
        bars.push(block(G.east - 0.06, G.east + PROUD + 0.02, y0, y1, Math.min(za, zb), Math.max(za, zb), 0.025));
      }
    });
    // The slabs: a thick white band (an overhang to batch(): the glass under it darkens up to it)
    // over a dark underside set 0.1 in from it, a shadow line under every band.
    S.plates.forEach((p) => {
      solid(frame, west - 0.05, p.east, p.y0 + 0.08, p.y1, p.back, p.front, L.band, 'stone', { bevel: 0.06, name: 'sde4-plate' });
      soffit.push(block(west, p.east - 0.1, p.y0, p.y0 + 0.1, p.back + 0.1, p.front - 0.1, 0.02));
    });

    /* -------------------------------------------------------------- */
    /* Terraces: balustrades and planting                             */
    /* -------------------------------------------------------------- */
    /** A glass balustrade (no posts) along a straight run at height y, its grey-blue rail on top. */
    const balustrade = (x0: number, x1: number, z0: number, z1: number, y: number) => {
      const m = solid(frame, x0, x1, y - 0.02, y + 0.53, z0, z1, L.rail, 'glass', { bevel: 0 });
      m.userData.window = SDE4_RAILS;
      m.userData.noShadow = true;
      m.castShadow = false;
      const wx = x1 - x0 < 0.2 ? 0.05 : 0,
        wz = z1 - z0 < 0.2 ? 0.05 : 0;
      bars.push(block(x0 - wx, x1 + wx, y + 0.52, y + 0.6, z0 - wz, z1 + wz, 0.025));
    };
    /** A planter trough (x0..x1, z0..z1) on a slab at y, `tall`: pale stone, its soil never shown. */
    const trough = (x0: number, x1: number, z0: number, z1: number, y: number, tall: number) =>
      solid(frame, x0, x1, y - 0.02, y + tall, z0, z1, L.band, 'stone', { bevel: 0.045, shade: SH.planter, band: true, name: 'sde4-planter' });
    {
      const [p1, p2] = S.plates,
        y1 = p1.y1,
        y2 = p2.y1,
        RAIL = 0.6, // a balustrade's top over its slab
        GAP = 0.05; // a planter's face behind its rail's glass
      // The first floor's terrace: its front and its east strip railed, left open (the glass
      // balustrade before the glass, as the photo's lower terrace).
      balustrade(west, p1.east - 0.045, p1.front - 0.115, p1.front - 0.045, y1);
      balustrade(p1.east - 0.115, p1.east - 0.045, p1.back + 0.1, p1.front - 0.045, y1);
      // The top floor's terrace wraps round its front, its east end and its back: railed all round,
      // a planter against each rail, its lip a hair under the rail's top. Its planting rises over
      // the rail: leafy rosettes of lance blades in the three greens, packed so their blades run
      // together, over a heart of leafy clumps; heliconia fans standing out of them; along the
      // file's front, leaves spilling over the rail at two places. (Under the rail's top it all keeps
      // a hair behind its glass, and 0.15 or more off the top floor's own glass.)
      balustrade(west, p2.east - 0.045, p2.front - 0.115, p2.front - 0.045, y2);
      balustrade(p2.east - 0.115, p2.east - 0.045, p2.back + 0.045, p2.front - 0.045, y2);
      balustrade(west, p2.east - 0.045, p2.back + 0.045, p2.back + 0.115, y2);
      {
        const x0 = -3.45,
          x1 = 1.4,
          z1 = p2.front - 0.115 - GAP,
          z0 = z1 - 0.36,
          top = y2 + RAIL - 0.02,
          mid = (z0 + z1) / 2,
          fans = [-2.85, -0.6, 1.0];
        trough(x0, x1, z0, z1, y2, RAIL - 0.02);
        // A low leafy heart along its back half: overlapping clumps drawn out along it, their uneven
        // top a step over the rail, the plants' leaves rising out of it and over it.
        greenery.push(mass(Array.from({ length: 5 }, (_, k) => ({ clumps: [{ ...clump(x0 + 0.45 + k * 0.95 + (hash(k + 0.1) - 0.5) * 0.12, top + 0.02 + 0.04 * hash(k + 0.2), z0 + 0.15, 0.2 + 0.03 * hash(k + 0.3), 130 + k), florets: 10, long: 1.6, heading: 0 }], green: [1, 0, 1, 2, 1][k] })), top - 0.05, top + 0.3, 13));
        greenery.push(...bed(x0 + 0.08, x1 - 0.08, z0, z1, top, 13, { step: 0.58 }));
        fans.forEach((x, k) => greenery.push(...fan(x, top - 0.04, mid + 0.02, (hash(k * 3.7 + 1) - 0.5) * 0.5, 0.62, 4, 71 + k)));
        for (const [x, k] of [[-1.6, 0], [0.7, 1]]) greenery.push(...spill(x, top - 0.02, z0 + 0.22, 0, k + 1, 150 + k, { size: 0.85, lean: 0.8, arch: 3.1 }));
      }
      {
        const x1 = p2.east - 0.115 - GAP,
          x0 = x1 - 0.34,
          z0 = -2.3,
          z1 = 1.95,
          top = y2 + 0.52,
          mid = (x0 + x1) / 2;
        trough(x0, x1, z0, z1, y2, 0.52);
        greenery.push(...bed(x0, x1, z0 + 0.08, z1 - 0.45, top, 17, { step: 0.62 }));
        greenery.push(...fan(mid, top - 0.04, z1 - 0.3, Math.PI / 2 + 0.15, 0.62, 5, 81));
      }
      {
        // The back balcony's, short (the balcony is 0.49 deep between its rail and the top floor's
        // glass): its plants' blades point north and to the sides, never back at the glass.
        const z0 = p2.back + 0.115 + GAP,
          z1 = z0 + 0.26,
          top = y2 + RAIL - 0.02,
          mid = (z0 + z1) / 2;
        trough(-2.25, -0.55, z0, z1, y2, RAIL - 0.02);
        [-1.95, -1.4, -0.85].forEach((x, k) => greenery.push(...rosette(x, top - 0.03, mid - 0.02, (k + 2) % 3, 190 + k, { n: 5, size: 0.32, half: 0.06, point: k === 1, turn: Math.PI, arc: 3.2 })));
      }
      // The veranda's two big planters at its south edge, the way from the ramp to the desk between
      // them: a heliconia fan in the west one (turned off the column beside it); in the east one a
      // leafy bush (two broad-leaved plants side by side) spilling over its front either side of the
      // column before it.
      const V = S.veranda,
        PT = 0.42;
      trough(V.x0 + 0.1, V.x0 + 0.66, 2.25, 2.85, 0, PT);
      trough(4.25, 5.3, 2.25, 2.85, 0, PT);
      greenery.push(...fan(V.x0 + 0.42, PT - 0.04, 2.52, 0.25, 0.88, 6, 91, 0.11));
      greenery.push(...rosette(4.52, PT - 0.03, 2.55, 0, 97, { n: 8, size: 0.52, half: 0.11, lean: 0.55, arch: 1.0 }));
      greenery.push(...rosette(4.8, PT - 0.03, 2.42, 1, 99, { n: 7, size: 0.56, half: 0.075, lean: 0.3, arch: 0.8, point: true }));
      greenery.push(...rosette(5.06, PT - 0.03, 2.52, 2, 96, { n: 8, size: 0.48, half: 0.11, lean: 0.45, arch: 1.0 }));
      for (const [x, k] of [[4.42, 0], [5.17, 1]]) greenery.push(...spill(x, PT + 0.04, 2.62, 0, 1, 98 + k, { n: 2, size: 0.5 }));
    }

    parts(frame, white, L.paint, 'paint', { name: 'sde4-white' });
    parts(frame, bands, L.band, 'stone', { name: 'sde4-pads' });
    parts(frame, soffit, L.soffit, 'wood', { name: 'sde4-undersides' });
    parts(frame, fins, L.fin, 'paint', { tone: 0.03, name: 'sde4-fins' });
    parts(frame, bars, L.bar, 'paint', { shadow: false, name: 'sde4-frames' });
    parts(frame, pv, L.pv, 'paint', { name: 'sde4-solar' });
    parts(frame, deck, L.deck, 'wood', { tone: 0.08, name: 'sde4-deck' });
    // The planting: one mesh of the town's white foliage, its greens painted on.
    {
      const m = new T.Mesh(mergeGeometries(greenery)!, material('#ffffff', 'foliage'));
      greenery.forEach((g) => g.dispose());
      m.castShadow = m.receiveShadow = true;
      m.name = 'sde4-planting';
      frame.add(m);
    }

    // The anchors, in the island's frame; the height is the built one (the frame's own reach).
    const A = (x: number, y: number, z: number, heading: number): Sde4Anchor => ({ x: at.x + x, y: at.y + y, z: at.z + z, heading });
    const lawn = -S.lift,
      v = new T.Vector3(),
      m4 = new T.Matrix4();
    let top = -Infinity;
    frame.updateMatrixWorld(true);
    const toFrame = frame.matrixWorld.clone().invert();
    frame.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      const p = o.geometry.getAttribute('position');
      m4.multiplyMatrices(toFrame, o.matrixWorld);
      for (let i = 0; i < p.count; i++) top = Math.max(top, v.fromBufferAttribute(p, i).applyMatrix4(m4).y);
    });
    return {
      desk: A(S.desk.x, 0, S.desk.z, S.desk.heading),
      entrance: A((S.entrance.x0 + S.entrance.x1) / 2, 0, S.entrance.z, 0),
      cafe: A(S.cafe.x, lawn, S.cafe.z, S.cafe.heading),
      court: A((S.steps.x0 + S.steps.x1) / 2, lawn, P.z1 + S.steps.run, 0),
      ramp: A((S.ramp.x0 + S.ramp.x1) / 2, lawn, P.z1 + S.ramp.run, Math.PI),
      footprint: { x0: at.x + P.x0, x1: at.x + P.x1, z0: at.z + P.z0, z1: at.z + P.z1 + Math.max(S.steps.run, S.ramp.run) },
      roof: { x0: at.x + B.x0, x1: at.x + R.x1, z0: at.z + R.z0, z1: at.z + R.z1 },
      height: at.y + top,
      podium: at.y,
    };
  }
  return { buildSde4 };
}
export type Sde4 = ReturnType<typeof createSde4>;
