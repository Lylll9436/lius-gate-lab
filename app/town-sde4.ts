import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SurfaceKind } from './city-materials';
import { palette, hash, type TownContext } from './town-shared';
import { RESIDENCE_LOOK } from './town-residence';
import type { WindowRole } from './town-batch';
import type { Kit } from './town-kit';
import type { Nature } from './town-nature';
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
 *   `fin.proud` behind them; `fin`: the fins' pitch, width and depth and the storey joints where the
 *   runs break.
 * - `columns`: radius, the x of each pair and the z either side (clear of every plate's edge).
 * - `storeys` (floor and ceiling of G, L1 and L2), `plates` (each slab's y span and edges: front,
 *   back, east; the west end meets the block at `west`) and `glass` (each storey's glass lines).
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
  fin: { pitch: 0.6, w: 0.24, proud: 0.16, corner: 0.3, joints: [1.85, 3.75, 5.62], joint: 0.14 },
  columns: { r: 0.13, x: [-2.4, 0, 2.4, 4.8], z: 3.15 },
  west: -3.7,
  storeys: [[0, 1.7], [2.0, 3.6], [3.9, 5.5]] as [number, number][],
  plates: [
    { y0: 1.7, y1: 2.0, front: 2.8, back: -2.75, east: 2.9 },
    { y0: 3.6, y1: 3.9, front: 2.6, back: -2.9, east: 2.9 },
    { y0: 5.5, y1: 5.75, front: 1.55, back: -2.55, east: 1.85 },
  ],
  glass: [
    { front: 1.9, back: -2.5, east: 2.6 },
    { front: 2.0, back: -2.6, east: 2.6 },
    { front: 1.3, back: -2.3, east: 1.6 },
  ],
  entrance: { x0: -3.0, x1: -1.2, z: 2.5, top: 1.62 },
  veranda: { x0: 2.6, x1: 5.6, z0: -3.7, z1: 3.7 },
  desk: { x: 3.9, z: 0.6, facing: 0 },
  cafe: { x: -4.0, z: 6.0, facing: 1.18 },
};
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

/** A point the island's other builders work from, in the island's frame, and the way one faces there (a bearing: along (sin, cos)). */
export type Sde4Anchor = { x: number; y: number; z: number; facing: number };
/**
 * What buildSde4 hands back, all in the island's frame (the group's):
 * - `desk`: the veranda desk's middle on the deck (y the deck's top), facing the way he looks
 *   from his chair behind it (south, over the lawn to the file's camera);
 * - `entrance`: the middle of the entrance doors on the floor, facing out of them;
 * - `cafe`: the café table's middle beside the court, in front of the fin block (y the lawn the
 *   podium assumes beside it: at.y - lift), facing the way he looks from his chair (east-south-east);
 * - `court`: the step's foot before the entrance, where the court's paving is to meet it (y the lawn level);
 * - `ramp`: the veranda ramp's foot (y the lawn level), facing up it (north);
 * - `footprint`: the plan box of everything the building stands on the ground (podium, step, ramp);
 * - `roof`: the parasol's plan box (with the fin block: the building's outline seen from above);
 * - `height`: the top of everything (the solar panels), and `podium`, the podium's top.
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
 * SDE4 takes no street furniture of its own, so `_props` goes unused; it stays in the signature,
 * which is every building factory's. Its terrace planting is the town's clipped shrubs
 * (nature.topiary), evergreen.
 */
export function createSde4(ctx: TownContext, kit: Kit, _props: Props, nature: Nature) {
  const { material } = ctx;
  const { prism } = kit;
  const { topiary } = nature;
  const L = SDE4_LOOK,
    S = SDE4,
    SH = SDE4_SHADE;

  /** A part for parts(): a shared geometry, where it goes in its mesh's space, and its shade. */
  type Part = { geometry: T.BufferGeometry; matrix: T.Matrix4; shade?: number };
  const ONE = new T.Vector3(1, 1, 1);
  const placed = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
    new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), ONE);
  const on = (g: T.Object3D | undefined, m: T.Matrix4) => (g ? g.matrix.clone().multiply(m) : m);
  /**
   * A block between two corners in g's frame (the building's without g), its edges round its +-z
   * faces chamfered by c (at most a quarter of its thinnest side): the face toward g's +z is the one
   * whose rim catches the light (a fin's or a frame's front).
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
   * The columns' collars: a moulded base (a fat roll over a cove, 0.42 across at its foot) and a
   * capital that flares out under the soffit into a round plate, both chunky enough to read at the
   * overview, so each column reads as carrying the roof and never as a pole.
   */
  const BASE: [number, number][] = [[0, 0], [0.21, 0], [0.21, 0.06], [0.19, 0.1], [0.165, 0.13], [0.155, 0.2], [0, 0.2]];
  const CAPITAL: [number, number][] = [[0, 0], [0.155, 0], [0.165, 0.05], [0.19, 0.09], [0.215, 0.12], [0.215, 0.17], [0, 0.17]];
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
   *   soffit on granite pads, each with a moulded base and a capital that flares under the soffit.
   * - The champagne end block at the west, as tall as the roof's rim and flush with it: corner piers
   *   and bold vertical fins (0.6 apart, 0.24 wide, 0.16 deep, chamfered round their fronts) down
   *   its south, west and north faces and on the strip of its east face the file's camera sees, the
   *   runs broken at the storey joints, each storey's panel of fins a shade of its own; a white coping.
   * - Three glass floor plates stepping back as they rise: each slab a thick white band over a dark
   *   underside set in from it (a shadow line under every band), the ground floor set back under the
   *   first slab (the undercroft), the top floor set back behind a planted terrace and shaded under
   *   the parasol; the glazing a simple grid of big floor-to-ceiling panes in chunky grey-blue frames
   *   0.1 proud of the glass (deep reveals), the frames' rails and corner posts as fat as their
   *   uprights; the east ends cascade under the open east bay. Glass balustrades (no posts) with a
   *   grey-blue rail round the terraces; long planters of soft, bold clipped masses.
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
      deck: Part[] = []; // the veranda's boards

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
          white.push({ geometry: post(C.r, top - 0.2), matrix: placed(x, 0.08 + (top - 0.2) / 2, z) });
          white.push({ geometry: capital, matrix: placed(x, top - 0.17, z) });
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
      // The body behind the fins, a step deeper than them, from the podium to under the coping.
      solid(frame, bx0, B.x1, P.foot + 0.1, B.top, bz0, bz1, L.fin, 'paint', { bevel: 0.04, shade: SH.body, band: true, name: 'sde4-block' });
      // The white coping over the whole block, flush with the fins' faces, a hair over the roof's
      // parapet where it meets the rim (so their tops never fight).
      solid(frame, B.x0, B.x1 + 0.05, B.top - 0.01, R.parapet + 0.012, B.z0, B.z1, L.paint, 'paint', { bevel: 0.035, band: true, name: 'sde4-coping' });
      // The runs: from the podium to each storey joint and on to under the coping.
      const runs: [number, number][] = [];
      let y = 0.1;
      for (const j of [...F.joints, B.top - 0.02]) {
        runs.push([y, j - F.joint / 2]);
        y = j + F.joint / 2;
      }
      // Square piers at the west corners (`corner` each way) and narrower ones at the south and
      // north faces' east ends beside the roof's rim, full height, closing the block's outline.
      for (const s of [-1, 1]) {
        const zf = s > 0 ? B.z1 : B.z0;
        solid(frame, B.x0, B.x0 + c, 0.02, B.top - 0.005, Math.min(zf, zf - s * c), Math.max(zf, zf - s * c), L.fin, 'paint', { bevel: 0.04, band: true, name: 'sde4-block' });
        solid(frame, B.x1 - 0.2, B.x1, 0.02, B.top - 0.005, Math.min(zf, zf - s * (p + 0.02)), Math.max(zf, zf - s * (p + 0.02)), L.fin, 'paint', { bevel: 0.04, band: true, name: 'sde4-block' });
      }
      // The fins, each panel of them a shade of its own: on the south and north faces between the
      // piers and down the west face, each built on its face (x along it, +z out of it), so the
      // chamfer runs round its front.
      const along = (a: number, b: number) => {
        const n = Math.max(1, Math.round((b - a) / F.pitch)),
          step = (b - a) / n;
        return Array.from({ length: n }, (_, k) => a + step * (k + 0.5));
      };
      const south = faceAt(frame, 0, bz1, 0),
        north = faceAt(frame, 0, bz0, Math.PI), // x along it runs west (-x)
        westFace = faceAt(frame, bx0, 0, -Math.PI / 2), // x along it runs south (+z)
        eastFace = faceAt(frame, B.x1, 0, Math.PI / 2); // x along it runs north (-z)
      // The east face is the stack's party wall; where it shows (the strip in front of every
      // plate's edge, toward the file's camera) it carries fins too, or it reads as a dark void.
      const strip = Math.max(...S.plates.map((q) => q.front)) + 0.12;
      runs.forEach(([y0, y1], r) => {
        const shade = 1 + 0.06 * (hash(r * 7.1 + 3) - 0.5),
          fin = (g: T.Object3D, x: number) => fins.push(block(x - F.w / 2, x + F.w / 2, y0, y1, -0.02, p, 0.04, g, shade));
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
    /* Terraces: balustrades and planters                             */
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
    /**
     * A planter trough (x0..x1, z0..z1) on a slab at y, `tall`, and its planting as soft, bold
     * masses: clipped clumps of mixed sizes packed close along the trough on a staggered line, so
     * they run together into one lumpy mass (never a file of separate balls or pills), bulging
     * over the lip and leaning `lean` toward the open side, now and then one taller; the whole
     * trough one green, a shade off its neighbours'.
     */
    const planter = (x0: number, x1: number, z0: number, z1: number, y: number, tall: number, seed: number, opts: { r?: number; lean?: [number, number] } = {}) => {
      solid(frame, x0, x1, y - 0.02, y + tall, z0, z1, L.band, 'stone', { bevel: 0.045, shade: SH.planter, band: true, name: 'sde4-planter' });
      const long = x1 - x0 >= z1 - z0,
        len = long ? x1 - x0 : z1 - z0,
        across = long ? z1 - z0 : x1 - x0,
        r = opts.r ?? across * 0.72,
        n = Math.max(1, Math.round(len / (r * 1.3))),
        step = len / n,
        stagger = across * (across >= 0.5 ? 0.22 : 0.12),
        [lx, lz] = opts.lean ?? [0, 0],
        base = hash(seed * 9.1);
      for (let k = 0; k < n; k++) {
        const h = (i: number) => hash(seed * 7.3 + k * 1.9 + i * 0.61),
          t = (long ? x0 : z0) + step * (k + 0.5) + (h(1) - 0.5) * step * 0.3,
          off = (k % 2 ? 1 : -1) * stagger * (0.6 + 0.4 * h(2)),
          rr = r * (0.8 + 0.34 * h(3)),
          sy = h(4) > 0.84 ? 1.22 : 0.8 + 0.2 * h(5),
          x = (long ? t : (x0 + x1) / 2 + off) + lx,
          z = (long ? (z0 + z1) / 2 + off : t) + lz,
          m = topiary(frame, x, y + tall + rr * sy * 0.25, z, rr, 1, long ? 1.15 : 0.95, sy, long ? 0.95 : 1.15);
        tint(m, base, k);
      }
    };
    /** A trough's green: its base a shade lighter and warmer or deeper and cooler, each clump within 3% of it. */
    function tint(m: T.Mesh, base: number, k: number) {
      const c = m.geometry.getAttribute('color'),
        v = 0.95 + 0.1 * base + 0.06 * (hash(k * 2.7 + base * 13) - 0.5),
        warm = (base - 0.5) * 0.06;
      if (!c) return;
      for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * v * (1 + warm), c.getY(i) * v, c.getZ(i) * v * (1 - warm));
    }
    {
      const [p1, p2] = S.plates,
        y1 = p1.y1,
        y2 = p2.y1,
        G2 = S.glass[2];
      // The first floor's terrace: its front and its east strip railed, left open (the glass
      // balustrade before the glass, as the photo's lower terrace: 0.6 deep, it holds no planter
      // whose shrubs would be more than a row of small lumps behind the rail).
      balustrade(west, p1.east - 0.045, p1.front - 0.115, p1.front - 0.045, y1);
      balustrade(p1.east - 0.115, p1.east - 0.045, p1.back + 0.1, p1.front - 0.045, y1);
      // The top floor's terrace wraps round its front, its east end and its back: railed all round,
      // a long planter along the front, its masses leaning toward the rail and showing over it, one
      // down the east terrace and a low one along the back balcony.
      balustrade(west, p2.east - 0.045, p2.front - 0.115, p2.front - 0.045, y2);
      balustrade(p2.east - 0.115, p2.east - 0.045, p2.back + 0.045, p2.front - 0.045, y2);
      balustrade(west, p2.east - 0.045, p2.back + 0.045, p2.back + 0.115, y2);
      planter(-3.45, 1.4, G2.front + 0.48, G2.front + 0.84, y2, 0.34, 13, { lean: [0, 0.06] });
      planter(G2.east + 0.6, G2.east + 0.94, -2.3, 1.95, y2, 0.34, 17, { lean: [0.05, 0] });
      planter(-2.9, 0.3, p2.back + 0.18, G2.back - 0.16, y2, 0.28, 19, { r: 0.16 });
      // The veranda's two big planters at its south edge, the way from the ramp to the desk between them.
      const V = S.veranda;
      planter(V.x0 + 0.1, V.x0 + 0.66, 2.25, 2.85, 0, 0.42, 23, { r: 0.3 });
      planter(4.25, 5.3, 2.25, 2.85, 0, 0.42, 29, { r: 0.27 });
    }

    parts(frame, white, L.paint, 'paint', { name: 'sde4-white' });
    parts(frame, bands, L.band, 'stone', { name: 'sde4-pads' });
    parts(frame, soffit, L.soffit, 'wood', { name: 'sde4-undersides' });
    parts(frame, fins, L.fin, 'paint', { tone: 0.03, name: 'sde4-fins' });
    parts(frame, bars, L.bar, 'paint', { shadow: false, name: 'sde4-frames' });
    parts(frame, pv, L.pv, 'paint', { name: 'sde4-solar' });
    parts(frame, deck, L.deck, 'wood', { tone: 0.08, name: 'sde4-deck' });

    // The anchors, in the island's frame; the height is the built one (the frame's own reach).
    const A = (x: number, y: number, z: number, facing: number): Sde4Anchor => ({ x: at.x + x, y: at.y + y, z: at.z + z, facing });
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
      desk: A(S.desk.x, 0, S.desk.z, S.desk.facing),
      entrance: A((S.entrance.x0 + S.entrance.x1) / 2, 0, S.entrance.z, 0),
      cafe: A(S.cafe.x, lawn, S.cafe.z, S.cafe.facing),
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
