import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SurfaceKind } from './city-materials';
import { palette, hash, type TownContext } from './town-shared';
import { RESIDENCE_LOOK } from './town-residence';
import { WINDOW_BOX, muted } from './town-homes';
import type { Wash, WindowRole } from './town-batch';
import type { Kit } from './town-kit';
import type { Nature } from './town-nature';
import type { Props } from './town-props';

/**
 * The sky villa's colours, each no more saturated than its palette family (VILLA_FAMILY): red
 * brick (palette.brick, which is the brick kind by itself); white stone for the bands, the cornice,
 * the dressings, the quoins and the balustrade (the residence's dressing, the calmest pale stone in
 * the town); white paintwork for the frames, the doors, the dormers' fronts and the gutter; the
 * kerb's buff stone for the plinth, the terrace's walls and its steps' risers, and the residence's
 * forecourt flags on the terrace; a darker, warmer slate than the town's (the reference's roof, in
 * the slate family: less blue and no more saturated) on the slopes and the flats; lead for the rolls,
 * the dormers' cheeks and roofs and the flashings; cast iron for the balconies and the lamps'
 * housings, and the rainwater goods in the homes' softer grey (near-black ones drew an ink line);
 * terracotta chimney cans; brass on the doors; the back door in the homes' green enamel, the window
 * boxes painted a muted green.
 */
export const VILLA_LOOK = {
  brick: palette.brick,
  stone: RESIDENCE_LOOK.dressing,
  paint: palette.white,
  base: palette.kerb,
  paving: RESIDENCE_LOOK.paving,
  slate: '#5e6471',
  lead: palette.lead,
  iron: palette.metal,
  rain: '#737c83',
  pots: palette.pantile,
  brass: palette.brass,
  glass: palette.glass,
  door: palette.greenDoor,
  box: muted(palette.greenDoor, 0.25),
};
/** Each colour's palette family: the colour may be no more saturated than it (check-town). */
export const VILLA_FAMILY: Record<keyof typeof VILLA_LOOK, string> = {
  brick: palette.brick,
  stone: palette.render,
  paint: palette.white,
  base: palette.kerb,
  paving: palette.pavement,
  slate: palette.slate,
  lead: palette.lead,
  iron: palette.metal,
  rain: palette.metal,
  pots: palette.pantile,
  brass: palette.brass,
  glass: palette.glass,
  door: palette.greenDoor,
  box: palette.greenDoor,
};
/** The first floor's window boxes in winter carry dark evergreen sprigs (the homes' own colour). */
export const VILLA_SPRIG = '#3a5a34';
/**
 * The villa's measures, in its own frame: the front faces +z, y 0 is the deck's top and the
 * footprint is centred on the origin.
 * - `hx`, `hz`, `top`: the footprint box (half sizes) and its height. Everything stays inside it:
 *   the cornice's corona (0.25 proud of the walls), the terrace and its steps, the chimney cans.
 *   `top` keeps the cans under the placement's cap on the island's roofline, 8.2 over the deck's
 *   top (any higher and, seen from the north-west Rotate stop, they are drawn over the town's beach).
 * - `foot`: the plinth, the terrace's walls, the steps and their cheeks stand on y 0 and run on
 *   down to here, so a softly domed deck never shows a gap under them; nothing else goes below 0.
 * - `wall`: the main block's half width and its back and front faces; `bay` the centre bay's half
 *   width and how far it projects; `pier` how far the brick piers stand proud of their walls and
 *   their widths (the corners' and the bay's).
 * - `storeys`: each storey's brick from its foot to its head. The feet are 0, 16 and 30 brick
 *   courses (0.11) over the first, so every wall's coursing lines up with the piers' (batch()
 *   starts each mesh's courses at its own foot). `bands` the white string courses between them.
 * - `plinth`: the battered base's top, the rusticated course over it and the plinth course (its
 *   weathered top the walls' foot), round the sides and the back (the terrace hides the front).
 * - `cornice`: its bed, modillion course and corona (y from, to) and the corona's projection.
 * - `roof`: the hipped slate roof on the corona: its eave over the walls (the gutter stands on the
 *   corona in front of it, from `gutter[0]` to `gutter[1]` out and `gutter[2]` tall), the fascia, the
 *   rise to the flat and the run of the front and back slopes (`run`) and of the steeper end slopes
 *   (`runX`, so the side dormers stay clear of the hips); `bayPitch` the rise a unit of the bay's
 *   own low roof, which dies into the front slope in front of the middle dormer.
 * - `terrace`: its top (the ground floor's level), its depth from the main front wall, its half
 *   width, and its steps (half width, the run of a step and the number of risers).
 * - `chimney`: the two stacks (x either side, z, their plan and the shaft's height, where the cope
 *   sits: the cope, its flaunching and the tallest can end 0.57 over it).
 * - `back`: the back door (its width and sill, the leaf's head and the fanlight's), and the stair
 *   window over it (its width, sill and springing), which breaks the band between the upper floors.
 */
export const VILLA = {
  hx: 3.45,
  hz: 3.4,
  top: 8.18,
  foot: -0.3,
  wall: { hw: 3.2, back: -3.145, front: 1.255 },
  bay: { hw: 1.15, out: 0.4 },
  pier: { proud: 0.08, corner: 0.56, bay: 0.5 },
  storeys: [[0.5, 2.06], [2.26, 3.62], [3.8, 4.98]] as [number, number][],
  bands: [[2.06, 2.26], [3.62, 3.8]] as [number, number][],
  plinth: { base: 0.24, rustic: [0.22, 0.44] as [number, number], course: [0.42, 0.56] as [number, number] },
  cornice: { bed: [4.98, 5.06] as [number, number], modillions: [5.06, 5.24] as [number, number], corona: [5.24, 5.42] as [number, number], proud: 0.25 },
  roof: { eave: 0.1, gutter: [0.1, 0.245, 0.13] as [number, number, number], fascia: 0.06, rise: 1.5, run: 1.55, runX: 1.05, bayPitch: 0.4 },
  terrace: { top: 0.5, depth: 1.6, hw: 3.3, steps: { hw: 0.67, run: 0.25, risers: 3 } },
  chimney: { x: 2.8, z: -0.945, w: 1.0, d: 0.62, top: 7.6 },
  back: { door: { w: 0.64, sill: 0.28, leaf: 1.56, fan: 1.84 }, stair: { w: 0.6, sill: 2.74, spring: 3.98 } },
};
/**
 * The wall lamps: an up-and-down lamp on the front of each corner pier and each
 * of the bay's piers on the ground and first floors, as in the reference's dusk, at `y` (from each
 * storey's foot). Each pier carries one lamp, and its brick takes the lamp's light through batch()'s
 * aWash (see city-materials' WASH_FRAGMENT): the scallop above it has faded by 0.85 up and the one
 * below by 0.45 down, so neither reaches the bands; `half` is the half width it fades out by, just
 * inside each pier's (the corners' 0.28, the bay's 0.25). The lenses glow with the same light
 * (`lens`, its strength: about twice a lit window, and under 1 in luminance, so a lens 0.14 across
 * spills nothing over its edges when the multisampled frame resolves; at 1.6 it was 2.4). The corner
 * piers' quoins take the same lamp's light (`quoin`): white stone is about five times as bright as
 * the brick under the warm wash, so at 0.3 they catch it a little brighter than the brick round them,
 * and the scallop runs on over them unbroken.
 */
export const VILLA_LAMPS = { y: [0.7, 0.49], half: { corner: 0.27, bay: 0.24 }, strength: 1, lens: 0.6, quoin: 0.3 };
/**
 * The villa's night lights: one light a window (each sash's two panes, each French door's lights
 * and transom), every one in the 'villa' role (town-batch's WINDOW_MIX: warm, all lit in the
 * evening, a fifth of them dim; half go out one by one between 23:20 and 02:00 and the rest stay
 * on till morning). The front door alone is the fixed 'entrance' role: the hall behind it, warm
 * and left on all night, so the island's front always has its door lit. Roles of their own keep
 * them out of check-town's room shares and its count of night lamps.
 */
export const VILLA_WINDOWS: WindowRole = 'villa',
  VILLA_ENTRANCE: WindowRole = 'entrance';

/* ------------------------------------------------------------------ */
/* The sky villa                                                       */
/* ------------------------------------------------------------------ */
/**
 * The villa takes no street furniture or planting of its own (the island's lamps, lawn and garden
 * are its ground's; its window boxes are its own), so `_props` and `_nature` go unused; they stay in
 * the signature, which is every building factory's.
 */
export function createSkyVilla(ctx: TownContext, kit: Kit, _props: Props, _nature: Nature) {
  const { material, season } = ctx;
  const { box, chamfered, cone, frameRing, prism, slopeFrame } = kit;
  const L = VILLA_LOOK,
    V = VILLA;

  /** A part for parts(): a shared geometry and where it goes in its mesh's space. */
  type Part = { geometry: T.BufferGeometry; matrix: T.Matrix4 };
  const ONE = new T.Vector3(1, 1, 1),
    UP = new T.Vector3(0, 1, 0),
    IDENTITY = new T.Matrix4();
  const placed = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
    new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), ONE);
  const on = (g: T.Object3D | undefined, m: T.Matrix4) => (g ? g.matrix.clone().multiply(m) : m);
  /** A chamfered block between two corners in g's plan (the shell's without g). */
  const block = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, g?: T.Object3D): Part => ({
    geometry: chamfered(x1 - x0, y1 - y0, z1 - z0),
    matrix: on(g, placed((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)),
  });
  /**
   * Parts as one mesh in g's space, each a shade of its own within +-tone/2 (vertex colours the
   * bake multiplies in), as separate dressed stones get. It casts unless `shadow` is false (a thin
   * caster ghosts in the shadow map), and is a `band` unless told otherwise: dressings spread over
   * a wall would otherwise read to batch() as an overhang and darken the wall under them.
   * (The airport's merge(), copied: its private helpers stay its own.)
   */
  function parts(g: T.Object3D, list: Part[], colour: string, kind: SurfaceKind, opts: { shadow?: boolean; tone?: number; band?: boolean; name?: string } = {}) {
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
    if (opts.name) m.name = opts.name;
    g.add(m);
    return m;
  }
  /**
   * A plan extruded upward from y0 to y0 + h, every edge round its top and bottom chamfered by c,
   * so stacked courses part in V joints seen from any side (the Town Hall's `upright`, copied).
   */
  const uprights = new Map<string, T.BufferGeometry>();
  function upright(points: [number, number][], h: number, c: number, y0 = 0) {
    const key = [...points.flat(), h, c, y0].map((n) => n.toFixed(4)).join('|');
    let g = uprights.get(key);
    if (!g) {
      g = prism(points.map(([x, z]): [number, number] => [x, -z]), h, c, y0).clone().rotateX(-Math.PI / 2);
      uprights.set(key, g);
    }
    return g;
  }
  /** The house's plan (the main block and the centre bay), every face moved `grow` out. */
  function plan(grow: number): [number, number][] {
    const { hw, back, front } = V.wall,
      b = V.bay.hw + grow,
      x = hw + grow,
      zb = back - grow,
      zf = front + grow,
      zp = front + V.bay.out + grow;
    return [[-x, zb], [x, zb], [x, zf], [b, zf], [b, zp], [-b, zp], [-b, zf], [-x, zf]];
  }
  /**
   * The walls' outline (plan(0)) as a path for sweep(): closed, or (`gap`) open where it leaves the
   * back wall's middle |x| < gap free (the back door and the stair window break the plinth course
   * and the upper band there).
   */
  function around(gap = 0): { path: [number, number][]; closed: boolean } {
    const p = plan(0),
      back = V.wall.back;
    return gap ? { path: [[gap, back], ...p.slice(1), p[0], [-gap, back]], closed: false } : { path: p, closed: true };
  }
  /**
   * A moulding swept along a path in the shell's plan: at each corner the profile's points, each
   * `o` out along the corner's mitre and `y` up from y0, joined corner to corner by flat faces, so
   * every arris of the profile and every turn of the path stays crisp (never a soft blob). The path
   * keeps its outside on its right walking along it, as plan() runs round the house; the profile
   * runs from its top at the wall outward and down to its foot. An open path is closed by flat end
   * caps. String courses with their drip, the plinth course, the gutter and the dormers' cornices.
   */
  function sweep(path: [number, number][], closed: boolean, profile: [number, number][], y0: number) {
    const n = path.length,
      count = closed ? n : n - 1,
      edge = Array.from({ length: count }, (_, i) => {
        const [ax, az] = path[i],
          [bx, bz] = path[(i + 1) % n],
          l = Math.hypot(bx - ax, bz - az);
        return { dx: (bx - ax) / l, dz: (bz - az) / l, nx: (bz - az) / l, nz: -(bx - ax) / l };
      }),
      mitre = path.map((_, i) => {
        const a = edge[closed ? (i - 1 + count) % count : Math.max(0, i - 1)],
          b = edge[closed ? i : Math.min(count - 1, i)],
          k = 1 + a.nx * b.nx + a.nz * b.nz;
        return [(a.nx + b.nx) / k, (a.nz + b.nz) / k];
      }),
      at = (i: number, [o, y]: [number, number]) => new T.Vector3(path[i][0] + mitre[i][0] * o, y0 + y, path[i][1] + mitre[i][1] * o),
      pos: number[] = [],
      e1 = new T.Vector3(),
      e2 = new T.Vector3(),
      c = new T.Vector3(),
      want = new T.Vector3();
    // Each triangle wound to face `want`: out of the profile's segment, along the path's normal.
    const tri = (a: T.Vector3, b: T.Vector3, d: T.Vector3) => {
      c.crossVectors(e1.subVectors(b, a), e2.subVectors(d, a));
      for (const p of c.dot(want) >= 0 ? [a, b, d] : [a, d, b]) pos.push(p.x, p.y, p.z);
    };
    for (let e = 0; e < count; e++) {
      const j = (e + 1) % n,
        { nx, nz } = edge[e];
      for (let k = 0; k + 1 < profile.length; k++) {
        const [o0, h0] = profile[k],
          [o1, h1] = profile[k + 1];
        want.set(-nx * (h1 - h0), o1 - o0, -nz * (h1 - h0));
        const a = at(e, profile[k]),
          b = at(j, profile[k]),
          q = at(j, profile[k + 1]),
          d = at(e, profile[k + 1]);
        tri(a, b, q);
        tri(a, q, d);
      }
    }
    if (!closed) {
      const faces = T.ShapeUtils.triangulateShape(profile.map(([o, y]) => new T.Vector2(o, y)), []);
      for (const [i, e, s] of [[0, edge[0], -1], [n - 1, edge[count - 1], 1]] as const) {
        want.set(s * e.dx, 0, s * e.dz);
        for (const [p, q, r] of faces) tri(at(i, profile[p]), at(i, profile[q]), at(i, profile[r]));
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geometry.computeVertexNormals(); // non-indexed: each face its own normal
    return geometry;
  }
  /**
   * The profiles swept round the house (o out of the wall, y up; from the top at the wall outward
   * and down to the foot):
   * - a string course `h` tall: a weathered top falling 0.02 to an arris, a nose 0.185 proud, its
   *   soffit the drip (a deep shadow line over the bed from the town's camera) and a bed 0.12 proud;
   * - the plinth course: a weathered top (0.12 flat, then a 0.08 chamfer) over a 0.07 face, 0.2 proud;
   * - the gutter on the corona: an ogee front 0.145 deep and 0.13 tall, its back against the slates;
   * - the dormers' cornice: a corona 0.13 proud over a bed 0.07 proud.
   */
  const PROFILE = {
    band: (h: number): [number, number][] => [[0, h], [0.15, h - 0.02], [0.185, h - 0.05], [0.185, h - 0.12], [0.12, h - 0.12], [0.12, 0.025], [0.095, 0], [0, 0]],
    course: [[0, 0.14], [0.12, 0.14], [0.2, 0.07], [0.2, 0], [0, 0]] as [number, number][],
    gutter: [[0.1, 0.13], [0.215, 0.13], [0.245, 0.105], [0.245, 0.07], [0.225, 0.03], [0.19, 0.005], [0.15, 0], [0.1, 0]] as [number, number][],
    cornice: [[0, 0.14], [0.11, 0.14], [0.13, 0.12], [0.13, 0.06], [0.07, 0.06], [0.07, 0.025], [0.045, 0], [0, 0]] as [number, number][],
  };
  /** A round rod of radius r from a to b (8 sides unless told), as a part in g's frame (the shell's without g). */
  const rods = new Map<string, T.BufferGeometry>();
  const rodPart = (a: T.Vector3, b: T.Vector3, r: number, g?: T.Object3D, sides = 8): Part => {
    const d = b.clone().sub(a),
      key = [r, d.length(), sides].map((n) => n.toFixed(4)).join('|');
    let geometry = rods.get(key);
    if (!geometry) rods.set(key, (geometry = new T.CylinderGeometry(r, r, d.length(), sides)));
    return { geometry, matrix: on(g, new T.Matrix4().compose(a.clone().addScaledVector(d, 0.5), new T.Quaternion().setFromUnitVectors(UP, d.normalize()), ONE)) };
  };
  const v3 = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
  /** A face (x along it, y up, +z out of it) at (x, z) turned by ry, in the shell. */
  function faceAt(shell: T.Object3D, x: number, z: number, ry: number) {
    const g = new T.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    g.updateMatrix();
    shell.add(g);
    return g;
  }
  /** A pane of glass on g's face (+z out of it), centred at (x, y, z): its own plane, one light with its `group`. */
  function pane(g: T.Object3D, x: number, y: number, z: number, w: number, h: number, group: string, sashPane = false) {
    const m = new T.Mesh(new T.PlaneGeometry(w, h), material(L.glass, 'glass'));
    m.position.set(x, y, z);
    m.userData.windowGroup = group;
    m.userData.window = VILLA_WINDOWS;
    if (sashPane) m.userData.sashPane = true;
    g.add(m);
    return m;
  }
  /** A tapered keystone, `foot` wide at its foot and `head` at its head, `tall` from y 0 up, `deep` out of the wall. */
  const keystone = (foot: number, head: number, tall: number, deep: number) =>
    prism([[-foot / 2, 0], [foot / 2, 0], [head / 2, tall], [-head / 2, tall]], deep, 0.02);
  /**
   * An L-shaped quoin round the corner (cx, cz) (sx, sz its outward signs): arms ax along x and az
   * along z, q proud of both faces, 0.04 into the pier (the Town Hall's quoin(), copied).
   */
  const quoin = (cx: number, cz: number, sx: number, sz: number, ax: number, az: number, q: number, y0: number, h: number) =>
    upright(
      [
        [cx - sx * ax, cz - sz * 0.04],
        [cx - sx * ax, cz + sz * q],
        [cx + sx * q, cz + sz * q],
        [cx + sx * q, cz - sz * az],
        [cx - sx * 0.04, cz - sz * az],
        [cx - sx * 0.04, cz - sz * 0.04],
      ],
      h,
      0.02,
      y0,
    );
  /** A triangular pediment's raking cornice: a chevron band `thick` deep (vertical) under a slope that rises `rise` over the half-span `half` (the Town Hall's, copied). */
  const chevron = (half: number, rise: number, thick: number, depth: number, c = 0.02) => {
    const k = rise / half,
      inner = rise - thick;
    return prism([[-half, 0], [-inner / k, 0], [0, inner], [inner / k, 0], [half, 0], [0, rise]], depth, c);
  };
  /** An arch's voussoirs between radii R0 and R1, `deep` out of the wall from z0, about the springing's middle; the crown is left for a keystone (the Town Hall's, copied). */
  function voussoirs(R0: number, R1: number, deep: number, z0: number, n = 7) {
    const out: T.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      if (i === (n - 1) / 2) continue;
      const a0 = (i * Math.PI) / n,
        a1 = ((i + 1) * Math.PI) / n,
        p = (a: number, r: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];
      out.push(prism([p(a0, R0), p(a0, R1), p(a1, R1), p(a1, R0)], deep, 0.018, z0));
    }
    return out;
  }
  /**
   * A small console under a sill or a hood (a scroll in profile: out of the wall `out` at its top,
   * dying into the wall `tall` below), 0.12 wide; its top at y 0 (turned onto x in parts()).
   */
  const corbel = (out: number, tall: number) =>
    prism([[0, 0], [out, 0], [out, -0.035], [out * 0.7, -tall * 0.5], [out * 0.35, -tall * 0.82], [0.03, -tall], [0, -tall]], 0.12, 0.02, -0.06);
  /** A chimney can's profile (radius, height): a flared foot, a tapering body, a rolled rim (the kit's). */
  const CAN = [[0, 0], [0.125, 0], [0.125, 0.045], [0.1, 0.075], [0.088, 0.25], [0.116, 0.27], [0.116, 0.31], [0.09, 0.325], [0, 0.325]];
  const canGeometry = (tall: number) => new T.LatheGeometry(CAN.map(([r, y]) => new T.Vector2(r, y * tall)), 10);
  /** A garden urn on a die (radius, height): a moulded foot, a stem, a gadrooned bowl's swell, a lid and its knop. */
  const URN = new T.LatheGeometry(
    ([[0, 0], [0.11, 0], [0.11, 0.04], [0.065, 0.075], [0.055, 0.11], [0.11, 0.16], [0.145, 0.23], [0.13, 0.29], [0.085, 0.315], [0.1, 0.335], [0.1, 0.365], [0.055, 0.39], [0.04, 0.42], [0.05, 0.45], [0, 0.47]] as [number, number][]).map(([r, y]) => new T.Vector2(r, y)),
    12,
  );
  /** A tapered rainwater head, wide at its top (the archive's hopper, copied). */
  const HOPPER = (() => {
    const g = new T.BoxGeometry(0.2, 0.24, 0.18),
      p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) p.setXYZ(i, p.getX(i) * 0.55, p.getY(i), p.getZ(i) * 0.6);
    g.computeVertexNormals();
    return g;
  })();
  /** A small smooth blob (20 triangles): a window-box bloom (the homes', copied). */
  const BLOB = (() => {
    const g = new T.IcosahedronGeometry(1, 0);
    g.setAttribute('normal', g.getAttribute('position').clone());
    g.normalizeNormals();
    return g;
  })();
  /**
   * A convex solid from its faces (each a loop of corners), every face wound away from the solid's
   * middle and keeping its own normal.
   */
  function convex(faces: T.Vector3[][]) {
    const mid = new T.Vector3(),
      pos: number[] = [],
      ab = new T.Vector3(),
      ac = new T.Vector3();
    let count = 0;
    for (const f of faces)
      for (const p of f) {
        mid.add(p);
        count++;
      }
    mid.divideScalar(count);
    for (const f of faces)
      for (let i = 1; i + 1 < f.length; i++) {
        const [a, b, c] = [f[0], f[i], f[i + 1]],
          n = ab.subVectors(b, a).cross(ac.subVectors(c, a)),
          out = a.clone().add(b).add(c).divideScalar(3).sub(mid);
        for (const p of n.dot(out) >= 0 ? [a, b, c] : [a, c, b]) pos.push(p.x, p.y, p.z);
      }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geometry.computeVertexNormals();
    return geometry;
  }
  /**
   * A hipped roof with a flat top, as one solid: a fascia `fascia` tall round the eave rectangle
   * (x0..x1, z0..z1 at y), four slopes rising `rise` to the flat, the front and back ones over `run`
   * and the ends over `runX`, and the flat. Flat faces, each its own normal: the hips stay crisp,
   * each slope takes the slate's coursing up its fall by itself (batch()'s surface coordinates) and
   * the flat and the fascia, which are not sloped, stay plain.
   */
  function hippedRoof(x0: number, x1: number, z0: number, z1: number, y: number, fascia: number, rise: number, run: number, runX: number) {
    const y1 = y + fascia,
      y2 = y1 + rise,
      eave: [number, number][] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]],
      flat: [number, number][] = [[x0 + runX, z0 + run], [x1 - runX, z0 + run], [x1 - runX, z1 - run], [x0 + runX, z1 - run]],
      at = (p: [number, number], h: number) => new T.Vector3(p[0], h, p[1]),
      faces: T.Vector3[][] = [eave.map((p) => at(p, y)), flat.map((p) => at(p, y2))];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      faces.push([at(eave[i], y), at(eave[j], y), at(eave[j], y1), at(eave[i], y1)], [at(eave[i], y1), at(eave[j], y1), at(flat[j], y2), at(flat[i], y2)]);
    }
    return { geometry: convex(faces), eave, flat, y1, y2 };
  }
  /**
   * The main roof's eave breaking forward over the bay, as one solid: from a fascia `fascia` tall
   * round the bay's eave (x -X..X, out from the main eave at zb to zf), a front slope and two
   * hipped ends rise at `pitch` (rise per run) until they die into the main front slope, which rises
   * at `mainPitch` back from zb.
   */
  function bayRoof(X: number, zb: number, zf: number, y: number, fascia: number, pitch: number, mainPitch: number) {
    const E = y + fascia,
      t = ((zf - zb) * mainPitch) / (mainPitch - pitch), // each hip's run in plan, to the main slope
      A = v3(-X, E, zf),
      B = v3(X, E, zf),
      C = v3(X, E, zb),
      D = v3(-X, E, zb),
      P = v3(X - t, E + t * pitch, zf - t),
      Q = v3(-X + t, E + t * pitch, zf - t),
      [a, b, c, d] = [A, B, C, D].map((p) => v3(p.x, y, p.z));
    // The hips meet the main slope behind its eave (P and Q lie over the main roof), so the solid's
    // back runs from its foot at the main eave up to them, under the main slope and hidden by it.
    return convex([
      [A, B, P, Q], // the front slope
      [B, C, P], // the hips
      [D, A, Q],
      [a, b, B, A], // the fascia
      [b, c, C, B],
      [d, a, A, D],
      [c, C, P], // the back, inside the main roof
      [d, D, Q],
      [c, d, Q, P],
      [a, b, c, d],
    ]);
  }

  /**
   * The villa (front +z, in the shell's frame; see VILLA), a fancy British red-brick villa after the
   * owner's reference, in the town's Clash language at the Town Hall's and the residence's quality:
   * chunky masses with secondary and tertiary structure on every face, calm surfaces.
   * - The walls: a battered stone base, a rusticated course of V-jointed blocks over it and a plinth
   *   course with a weathered top; red brick of three storeys with brick piers (0.08 proud) at the
   *   four corners and either side of the projecting centre bay, the corners dressed in L-shaped stone
   *   quoins, long and short by turns; two string courses with a drip under their weathered nose;
   *   under the eaves a deep white cornice (a bed, a modillion course and a corona 0.25 proud, which
   *   breaks forward over the bay and whose eave shades the frieze).
   * - The windows: white sashes, two lights over two (a meeting rail and a glazing bar 0.07 or more),
   *   in white stone architrave jambs under a flat arch of five voussoirs splayed outward with a
   *   proud keystone; on the ground floor a sill on two corbels, above a projecting sill on the band;
   *   the first floor's carry painted window boxes planted for the season (WINDOW_BOX, as the homes').
   *   Two a storey on the front, two on each side, two on the back either side of the stair.
   * - The centre bay: on each floor white-framed French doors of four lights (two opening leaves
   *   between two fixed side lights, on kick panels) under a transom and a transom light of four, in
   *   a white stone architrave with a keystone; on the ground floor they are the front door, opening
   *   onto the terrace, with a brass knob; on the first and second floors they open onto balconies:
   *   a white slab with a moulded bed on two consoles, and a cast-iron railing of end posts with ball
   *   finials, a bottom rail, four square bars with knops and a handrail (a few fat members, so it
   *   reads as a railing and never as a dark slot, nor shimmers in front of the lit glass).
   * - Up-and-down wall lamps on the piers (VILLA_LAMPS): iron housings with cream lenses.
   * - The back: a green four-panel back door with a fanlight, in stone jambs under a hood on two
   *   consoles, on a threshold and a step; over it a tall round-headed stair window at the half
   *   landing, in jambs and voussoirs with a keystone, on a sill and corbels, breaking the band.
   * - Rainwater: a white ogee gutter on the corona round every eave, and at each corner a cast-iron
   *   downpipe on the side wall from a hopper head under the cornice, held by sockets and ears and
   *   kicked out in a shoe over the plinth course.
   * - The roof: hipped, in a darker, warmer slate (one solid: its slopes take the slate's coursing),
   *   lead rolls on its hips (each ending in a ball over the gutter) and round the flat top, with
   *   bosses at the flat's corners and rolls across it; its eave breaks forward over the bay in a low
   *   hipped roof of its own. Three dormers with white painted fronts between pilasters and lead
   *   cheeks: the middle one wider, with a pair of sashes under a white stone pediment and a slate
   *   gable roof with a lead ridge; the side ones with a sash under a white cornice and a low hipped
   *   slate roof; lead aprons where they meet the slates. Brick chimney stacks at both ends rise from just inside
   *   the eaves: a white stone band, a cap corbelled out in two brick courses, a white stone cope and
   *   flaunching, three terracotta cans of different heights, lead flashings down the slope.
   * - In front, the raised terrace (VILLA.terrace): buff stone walls; calm flags as geometry, a kerb
   *   round its front and ends and a field of large flags in running bond; a white stone balustrade
   *   of turned balusters between dies on its front and ends, urns on the corner piers and balls on
   *   the other dies; steps down at its centre with white nosed treads between sloping cheek walls
   *   under white copings.
   * No text, numbers or signage anywhere, and nothing that moves. Glass is one light a window: the
   * front door's in the 'entrance' role, the rest in the 'villa' role (VILLA_WINDOWS). The lamp
   * piers' brick, the corner quoins on them and the lamps' lenses carry `userData.wash` (Wash), which
   * batch() bakes into aWash for the night wash.
   * To wire it: build into a shell whose origin is the footprint's middle on the deck's top, then
   * `batch(shell, { place, floor: () => the deck's top in the world })`, after the town's buildings
   * (so its windows' claims on the night clock's bytes move none of theirs). The plinth, the
   * terrace's walls and the steps run on down to VILLA.foot for a domed lawn to bury.
   */
  function buildSkyVilla(shell: T.Group, site: { id: string }) {
    const { hw, back, front } = V.wall,
      bay = V.bay,
      bayFront = front + bay.out,
      [S0, S1, S2] = V.storeys,
      { proud } = V.pier,
      id = site.id;
    const stone: Part[] = [], // white stone dressings, each a shade of its own
      base: Part[] = [], // the plinth's and the terrace's buff stone dressings
      flags: Part[] = [], // the terrace's flags
      paint: Part[] = [], // white paintwork that casts (the dormers' fronts, the doors' panels)
      bars: Part[] = [], // slim white members: meeting rails, glazing bars, mullions, transoms (cast nothing)
      iron: Part[] = [], // the balconies and the lamps' housings (cast nothing)
      rain: Part[] = [], // the downpipes and their hoppers (cast nothing)
      brass: Part[] = [], // the doors' knobs
      enamel: Part[] = [], // the back door's leaf
      slates: Part[] = [], // the roof's flat, in slate
      lead: Part[] = []; // rolls, the dormers' cheeks and roofs, the flashings
    const frontFace = faceAt(shell, 0, front, 0),
      bayFace = faceAt(shell, 0, bayFront, 0),
      backFace = faceAt(shell, 0, back, Math.PI),
      east = faceAt(shell, hw, 0, Math.PI / 2), // +x: face x toward the back
      west = faceAt(shell, -hw, 0, -Math.PI / 2); // -x: face x toward the front
    const brick = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, opts: { bevel?: number } = {}) =>
      box(shell, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, L.brick, 'brick', opts);
    const D = V.back.door,
      ST = V.back.stair;

    /* -------------------------------------------------------------- */
    /* Masses: the plinth, the walls, the piers                       */
    /* -------------------------------------------------------------- */
    // The base, battered (6 degrees), 0.15 proud at its foot, from the foot to under the rusticated course.
    const P = V.plinth;
    const plinth = box(shell, 0, (V.foot + P.base) / 2, (back + front) / 2, 2 * hw + 0.3, P.base - V.foot, front - back + 0.3, L.base, 'ashlar', { taper: (P.base - V.foot) * 0.105 });
    plinth.name = 'sky-villa-plinth';
    // The main block and the bay, each one brick mass from the plinth to the frieze (their feet
    // are the ground floor's, so the courses line up with the piers').
    brick(-hw, hw, S0[0], S2[1], back, front);
    brick(-bay.hw, bay.hw, S0[0], S2[1], front - 0.1, bayFront);
    // The piers, storey by storey (each from its storey's foot, a course multiple over the first,
    // to 0.04 inside the band above): the corners proud of both faces, the bay's round its front
    // corners and over its returns. The front ones on the ground and first floors carry the lamps.
    // (A soft 0.05 arris: the kit's own bevel for a pier this size, 0.11, turned them into round columns.)
    const lampPiers: T.Mesh[] = [];
    const pierAt = (x0: number, x1: number, z0: number, z1: number, s: number, lamp?: { x: number; z: number; half: number }) => {
      const [y0, y1] = V.storeys[s],
        m = brick(x0, x1, y0, y1 + 0.04, z0, z1, { bevel: 0.05 });
      if (lamp && s < 2) {
        const wash: Wash = { x: lamp.x, y: y0 + VILLA_LAMPS.y[s], z: lamp.z, nx: 0, nz: 1, strength: VILLA_LAMPS.strength, half: lamp.half };
        m.userData.wash = wash;
        lampPiers.push(m);
      }
      return m;
    };
    const cw = V.pier.corner,
      bw = V.pier.bay;
    for (let s = 0; s < 3; s++)
      for (const sx of [-1, 1]) {
        const cx0 = sx < 0 ? -hw - proud : hw - cw + proud,
          cx1 = sx < 0 ? -hw + cw - proud : hw + proud;
        pierAt(cx0, cx1, front - cw + proud, front + proud, s, { x: sx * (hw - cw / 2 + proud), z: front + proud, half: VILLA_LAMPS.half.corner });
        pierAt(cx0, cx1, back - proud, back + cw - proud, s);
        const bx0 = sx < 0 ? -bay.hw - proud : bay.hw - bw + proud,
          bx1 = sx < 0 ? -bay.hw + bw - proud : bay.hw + proud;
        pierAt(bx0, bx1, front - 0.02, bayFront + proud, s, { x: sx * (bay.hw - bw / 2 + proud), z: bayFront + proud, half: VILLA_LAMPS.half.bay });
      }
    // The quoins on the four corner piers: L-shaped white stones 0.04 proud of the brick, their arms
    // long and short by turns, about 0.4 a course, from the plinth course to each band and to the
    // cornice. On the front the arms stay clear of the lamps (at most 0.2 of the 0.56 face); on the
    // lamp piers they are a mesh a storey and take the lamp's wash, so the scallop runs on over them.
    {
      const course = (y0: number, y1: number) => {
        const n = Math.max(2, Math.round((y1 - y0) / 0.42));
        return Array.from({ length: n }, (_, i): [number, number] => [y0 + (i * (y1 - y0)) / n, (y1 - y0) / n]);
      };
      for (const sz of [1, -1])
        for (const sx of [-1, 1]) {
          const cx = sx * (hw + proud),
            cz = sz > 0 ? front + proud : back - proud;
          let i = 0;
          V.storeys.forEach(([y0, y1], s) => {
            const list: Part[] = [];
            for (const [y, h] of course(s ? y0 : P.course[1], y1)) {
              const long = i++ % 2 === 0,
                [ax, az] = sz > 0 ? (long ? [0.2, 0.3] : [0.12, 0.46]) : long ? [0.42, 0.26] : [0.26, 0.42];
              list.push({ geometry: quoin(cx, cz, sx, sz, ax, az, 0.04, y, h), matrix: IDENTITY });
            }
            if (sz < 0 || s === 2) stone.push(...list);
            else {
              const m = parts(shell, list, L.stone, 'stone', { tone: 0.05 })!,
                wash: Wash = { x: sx * (hw - cw / 2 + proud), y: y0 + VILLA_LAMPS.y[s], z: front + proud, nx: 0, nz: 1, strength: VILLA_LAMPS.quoin, half: VILLA_LAMPS.half.corner };
              m.userData.wash = wash;
              m.userData.quoin = true;
            }
          });
        }
    }

    /* -------------------------------------------------------------- */
    /* The white stone: plinth courses, string courses, cornice       */
    /* -------------------------------------------------------------- */
    // The rusticated course on the base, round the sides and the back (the terrace hides the front;
    // the back door breaks it): V-jointed blocks about 0.6 long, 0.12 proud.
    {
      const run = (g: T.Object3D, a: number, b: number) => {
        const n = Math.max(1, Math.round((b - a) / 0.6));
        for (let k = 0; k < n; k++) base.push(block(a + ((b - a) * k) / n, a + ((b - a) * (k + 1)) / n, P.rustic[0], P.rustic[1], -0.06, 0.12, g));
      };
      const gap = D.w / 2 + 0.07 + 0.12;
      run(backFace, -hw - 0.12, -gap);
      run(backFace, gap, hw + 0.12);
      // (Each side from the back corner to the terrace's back, front - 0.05.)
      run(east, -(front - 0.05), -back + 0.12);
      run(west, back - 0.12, front - 0.05);
      // The plinth course: a weathered top 0.2 proud round the house, the back door's threshold its gap.
      const { path, closed } = around(gap);
      stone.push({ geometry: sweep(path, closed, PROFILE.course, P.course[0]), matrix: IDENTITY });
    }
    // The string courses, each one moulding round the house: a weathered nose 0.185 proud with its
    // drip over a bed. The upper one breaks for the stair window.
    V.bands.forEach(([y0, y1], k) => {
      const { path, closed } = around(k ? ST.w / 2 + 0.07 + 0.11 : 0);
      stone.push({ geometry: sweep(path, closed, PROFILE.band(y1 - y0), y0), matrix: IDENTITY });
    });
    // The cornice: the bed mould over the frieze, a modillion under the corona about every 0.34
    // (on every face and round the bay), and the corona, a mesh of its own (not a band), so its
    // eave shades the frieze under it.
    const C = V.cornice;
    stone.push({ geometry: upright(plan(0.09), C.bed[1] - C.bed[0], 0.025, C.bed[0]), matrix: IDENTITY });
    {
      const m = chamfered(0.12, C.modillions[1] - C.modillions[0] - 0.02, 0.2),
        y = (C.modillions[0] + C.modillions[1]) / 2,
        run = (a: number, b: number, at: (t: number) => T.Matrix4) => {
          const n = Math.max(1, Math.round((b - a) / 0.34));
          for (let k = 0; k <= n; k++) stone.push({ geometry: m, matrix: at(a + ((b - a) * k) / n) });
        };
      // Front (either side of the bay), the bay's front and returns, the back and the ends.
      for (const sx of [-1, 1]) {
        run(bay.hw + 0.28, hw - 0.06, (t) => placed(sx * t, y, front + 0.1));
        run(front + 0.18, bayFront - 0.06, (t) => placed(sx * (bay.hw + 0.1), y, t, 0, Math.PI / 2));
        run(back + 0.06, front - 0.06, (t) => placed(sx * (hw + 0.1), y, t, 0, Math.PI / 2));
      }
      run(-bay.hw + 0.06, bay.hw - 0.06, (t) => placed(t, y, bayFront + 0.1));
      run(-hw + 0.06, hw - 0.06, (t) => placed(t, y, back - 0.1));
      // The modillion course's soffit: a band behind the modillions, so they stand off a stone face.
      stone.push({ geometry: upright(plan(0.04), C.modillions[1] - C.modillions[0], 0.015, C.modillions[0]), matrix: IDENTITY });
    }
    // (Over the bay the corona runs out past the main roof's eave; the bay's own roof covers it.)
    parts(shell, [{ geometry: upright(plan(C.proud), C.corona[1] - C.corona[0], 0.045, C.corona[0]), matrix: IDENTITY }], L.stone, 'stone', { band: false, name: 'sky-villa-corona' });
    // The gutter on the corona, round every eave and the bay's: a white ogee in front of the slates.
    paint.push({ geometry: sweep(plan(0), true, PROFILE.gutter, C.corona[1]), matrix: IDENTITY });

    /* -------------------------------------------------------------- */
    /* Windows                                                         */
    /* -------------------------------------------------------------- */
    /**
     * A flat arch over an opening's head at y on g (x across, +z out): five voussoirs `wide` across
     * at their foot, their joints radiating so the arch splays 0.06 wider each side at its top, and
     * `tall`, 0.12 proud, the middle one a keystone 0.17 proud rising 0.08 higher.
     */
    function flatArch(g: T.Object3D, x: number, y: number, wide: number, tall: number) {
      const n = 5,
        s = (wide + 0.12) / wide;
      for (let k = 0; k < n; k++) {
        if (k === (n - 1) / 2) continue;
        const a = -wide / 2 + (k * wide) / n,
          b = -wide / 2 + ((k + 1) * wide) / n;
        stone.push({ geometry: prism([[a, 0], [b, 0], [b * s, tall], [a * s, tall]], 0.14, 0.015, -0.02), matrix: on(g, placed(x, y, 0)) });
      }
      stone.push({ geometry: keystone(wide / n + 0.02, wide / n + 0.08, tall + 0.08, 0.19), matrix: on(g, placed(x, y - 0.01, -0.02)) });
    }
    /**
     * A window box on a sill (its top y) in front of a window on g: a painted box 0.09 tall, `length`
     * long and `depth` deep from its back at z, holding a leafy mound and the season's planting
     * (WINDOW_BOX: blooms from spring to autumn, evergreen sprigs and heather in winter). Its
     * planting stays under the glass's foot as the town's camera sees it (check-town).
     */
    function windowBox(g: T.Object3D, x: number, y: number, z: number, length: number, depth: number, seed: number) {
      const H = 0.09,
        look = WINDOW_BOX[season],
        zc = z + depth / 2,
        soft = (m: T.Mesh) => {
          m.castShadow = false;
          m.userData.noShadow = true;
          return m;
        };
      box(g, x, y + H / 2, zc, length, H, depth, L.box, 'paint');
      soft(box(g, x, y + H + 0.025, zc, length - 0.05, 0.07, depth - 0.03, look.leaf, 'foliage', { bevel: 0.025 }));
      // Fewer, fatter blooms read as flowers (each 0.07 or more every way, squashed to 0.8).
      const n = Math.max(3, Math.round(length / 0.17)),
        top = y + H + 0.035,
        big = Math.min(0.058, depth * 0.49);
      for (let i = 0; i < n; i++) {
        const r = big * (0.9 + 0.1 * hash(seed + i * 5)),
          along = ((i + 0.5) / n - 0.5) * (length - 2 * big - 0.02) + (hash(seed + i * 11) - 0.5) * 0.03,
          across = (hash(seed + i * 7) - 0.5) * Math.max(0, depth - 2 * r - 0.01);
        if (look.sprigs && i % 2 === 0) soft(cone(g, x + along, top + 0.02, zc + across, r * 0.8, 0.1, VILLA_SPRIG, 'foliage', 6, hash(seed + i)));
        else {
          const m = soft(new T.Mesh(BLOB, material(look.blooms[(seed + i) % look.blooms.length], 'foliage')));
          m.position.set(x + along, top + 0.008 * hash(seed + i * 3), zc + across);
          m.scale.set(r, r * 0.8, r);
          m.rotation.y = hash(x * 17 + across * 5 + i) * 3;
          g.add(m);
        }
      }
    }
    /** The storeys' sash openings: width, height and middle, the ground floor's tallest. */
    const SASH: [number, number, number][] = [
      [0.7, 1.02, 1.36],
      [0.68, 0.9, 2.88],
      [0.64, 0.74, 4.34],
    ];
    /** Each storey's flat arch: as tall as the wall between the frame's head and the band allows. */
    const ARCH = [0.16, 0.17, 0.16];
    /**
     * A tall sash window on a face (local +z out of the wall), its opening w x h about (x, y) on
     * storey s: a white frame 0.07 wide and 0.09 proud, two panes (one light at night, `group`), a
     * meeting rail and a glazing bar 0.07 or more; white stone jambs 0.1 wide and 0.12 proud beside
     * it, a flat arch over it; under it a sill on two corbels (the ground floor), or a projecting
     * sill on the band (the floors above), carrying a window box on the first floor when `box` (its seed).
     */
    function sashWindow(g: T.Object3D, x: number, s: number, group: string, boxSeed?: number) {
      const [w, h, y] = SASH[s],
        foot = y - h / 2 - 0.07,
        head = y + h / 2 + 0.07,
        jx = w / 2 + 0.07,
        wide = 2 * (jx + 0.1) + 0.06,
        sill = wide + 0.1;
      frameRing(g, x, y, 0, w, h, 0.07, 0.09, L.paint, 'paint');
      const ph = (h - 0.07) / 2 + 0.01;
      for (const k of [-1, 1]) pane(g, x, y + (k * (h + 0.07)) / 4, 0.03, w + 0.02, ph, group, true);
      bars.push(block(x - w / 2, x + w / 2, y - 0.035, y + 0.035, 0, 0.08, g), block(x - 0.035, x + 0.035, y - h / 2, y + h / 2, 0, 0.075, g));
      for (const k of [-1, 1]) stone.push(block(k < 0 ? x - jx - 0.1 : x + jx, k < 0 ? x - jx : x + jx + 0.1, foot, head, -0.02, 0.12, g));
      flatArch(g, x, head, wide, ARCH[s]);
      if (s === 0) {
        stone.push(block(x - sill / 2, x + sill / 2, foot - 0.09, foot, -0.02, 0.2, g));
        for (const k of [-1, 1]) stone.push({ geometry: corbel(0.17, foot - 0.09 - P.course[1]), matrix: on(g, placed(x + k * (jx + 0.05), foot - 0.09, 0, 0, -Math.PI / 2, 0)) });
      } else stone.push(block(x - sill / 2, x + sill / 2, foot - 0.1, foot, -0.02, boxSeed === undefined ? 0.22 : 0.25, g));
      // (0.245 out at most: on the sides and the back that is the footprint's edge.)
      if (boxSeed !== undefined) windowBox(g, x, foot, 0.125, wide - 0.06, 0.12, boxSeed);
    }
    const windowX = (bay.hw + proud + hw - cw + proud) / 2; // the front's, midway between the bay's piers and the corners'
    for (let s = 0; s < 3; s++)
      for (const sx of [-1, 1]) {
        const side = sx < 0 ? 'w' : 'e',
          seed = (k: number) => (s === 1 ? k * 13 + (sx < 0 ? 3 : 7) : undefined);
        sashWindow(frontFace, sx * windowX, s, `${id}-front-${s}-${side}`, seed(1));
        // The sides: two a storey (face x toward the back on the east, the front on the west).
        for (const [k, z] of [-1.805, -0.085].entries()) sashWindow(sx > 0 ? east : west, sx > 0 ? -z : z, s, `${id}-side-${s}-${side}-${k}`, seed(k + 2));
        // The back: two a storey, either side of the door and the stair window.
        sashWindow(backFace, sx * 1.8, s, `${id}-back-${s}-${sx * 1.8}`, seed(4));
      }

    /* -------------------------------------------------------------- */
    /* The bay: French doors on each floor, balconies above            */
    /* -------------------------------------------------------------- */
    /**
     * White-framed French doors on the bay's front, w wide from the sill y0: four lights to `leaves`
     * (two opening leaves between two fixed side lights) on white kick panels, parted by mullions
     * 0.07 and a meeting stile 0.09, under a transom and a transom light to y1 that the mullions part
     * into four, in a white frame 0.08 wide, all one light at night; a white stone architrave (jambs
     * and a head, open at the foot) and a keystone rising into the band over it. The panes are tagged
     * `frenchDoor`. The ground floor's are the front door: its light is the hall's ('entrance', on
     * all night), and a brass knob sits on its meeting stile (on the white stile, not over the glass).
     */
    function frenchDoors(s: number, w: number, y0: number, leaves: number, y1: number) {
      const g = bayFace,
        group = `${id}-bay-${s}`,
        f = 0.08,
        kick = 0.24,
        cy = (y0 + y1) / 2,
        m = 0.07,
        st = 0.09,
        light = (w - 2 * m - st) / 4,
        glazing: T.Mesh[] = [];
      frameRing(g, 0, cy, 0, w, y1 - y0, f, 0.1, L.paint, 'paint', false, true);
      const xs = [-w / 2 + light / 2, -st / 2 - light / 2, st / 2 + light / 2, w / 2 - light / 2];
      for (const x of xs) {
        glazing.push(pane(g, x, (y0 + kick + leaves) / 2, 0.03, light + 0.02, leaves - y0 - kick + 0.01, group));
        paint.push(block(x - light / 2, x + light / 2, y0, y0 + kick, 0, 0.07, g));
      }
      glazing.push(pane(g, 0, (leaves + 0.08 + y1) / 2, 0.03, w + 0.02, y1 - leaves - 0.08 + 0.01, group));
      for (const p of glazing) {
        p.userData.frenchDoor = true;
        if (s === 0) p.userData.window = VILLA_ENTRANCE;
      }
      const mx = st / 2 + light + m / 2;
      bars.push(block(-st / 2, st / 2, y0, y1, 0, 0.09, g), block(-w / 2, w / 2, leaves, leaves + 0.08, 0, 0.09, g));
      for (const k of [-1, 1]) bars.push(block(k * mx - m / 2, k * mx + m / 2, y0, y1, 0, 0.085, g));
      if (s === 0) brass.push({ geometry: new T.IcosahedronGeometry(0.045, 1), matrix: on(g, placed(0, y0 + 0.78, 0.105)) });
      // The architrave: jambs 0.12 wide and 0.1 proud from the sill, a head over the frame, a keystone.
      const head = y1 + f;
      for (const k of [-1, 1]) stone.push(block(k < 0 ? -w / 2 - f - 0.12 : w / 2 + f, k < 0 ? -w / 2 - f : w / 2 + f + 0.12, y0, head + 0.12, -0.02, 0.11, g));
      stone.push(block(-w / 2 - f - 0.12, w / 2 + f + 0.12, head, head + 0.12, -0.02, 0.11, g));
      stone.push({ geometry: keystone(0.16, 0.22, 0.24, 0.16), matrix: on(g, placed(0, head + 0.02, 0)) });
    }
    // Each set's architrave stops at the bay's piers (x 0.73).
    frenchDoors(0, 1.04, S0[0], 1.62, 1.86);
    frenchDoors(1, 1.0, S1[0] + 0.02, 3.16, 3.38);
    frenchDoors(2, 0.92, S2[0] + 0.02, 4.5, 4.7);
    /**
     * A balcony on the bay at the floor y (its slab's top, 0.02 over the band it grows from): a white
     * stone slab 0.1 thick and `out` deep (an overhang: it shades the wall under it) over a moulded bed
     * 0.06 in, on two consoles under the door's jambs; on it a cast-iron railing: end posts 0.1 square
     * at its corners (ball finials on the front ones), a bottom rail, four square bars 0.075 a front
     * with a knop at their middle and one a return, and a handrail. A few fat members with wide gaps
     * (about 0.31 a bar and its gap, as the pierced plate's slots were): from the town's camera the
     * railing lies over the doors' white kick panels, not their glass, and reads as a railing.
     */
    function balcony(y: number, half: number, out: number, consoleX: number) {
      const z0 = bayFront,
        z1 = bayFront + out,
        zw = z0 + proud + 0.05; // the posts against the bay's piers
      const slab = box(shell, 0, y - 0.05, (z0 + z1) / 2 - 0.01, 2 * half, 0.1, out + 0.02, L.stone, 'stone', { bevel: 0.03 });
      slab.name = 'sky-villa-balcony';
      stone.push(block(-half + 0.06, half - 0.06, y - 0.17, y - 0.1, z0, z1 - 0.06));
      // Two consoles: a scroll profile 0.12 wide, 0.36 out at its top, dying into the wall 0.34 down.
      const profile: [number, number][] = [[0, 0], [0, -0.34], [0.06, -0.33], [0.13, -0.24], [0.2, -0.1], [0.32, -0.05], [0.36, 0]];
      for (const sx of [-1, 1]) stone.push({ geometry: prism(profile, 0.12, 0.02, -0.06), matrix: placed(sx * consoleX, y - 0.17, z0, 0, -Math.PI / 2, 0) });
      const rail = 0.44,
        top = y + rail + 0.08,
        px = half - 0.07,
        pz = z1 - 0.07;
      for (const sx of [-1, 1]) {
        iron.push(block(sx * px - 0.05, sx * px + 0.05, y, top + 0.04, pz - 0.05, pz + 0.05), block(sx * px - 0.05, sx * px + 0.05, y, top, zw - 0.05, zw + 0.05));
        iron.push({ geometry: new T.IcosahedronGeometry(0.06, 1), matrix: placed(sx * px, top + 0.09, pz) });
        // The return: a bottom rail, one bar with its knop, the handrail.
        const zm = (zw + pz) / 2;
        iron.push(block(sx * px - 0.035, sx * px + 0.035, y + 0.05, y + 0.12, zw + 0.05, pz - 0.05));
        iron.push(block(sx * px - 0.0375, sx * px + 0.0375, y + 0.12, y + rail, zm - 0.0375, zm + 0.0375), block(sx * px - 0.055, sx * px + 0.055, y + 0.25, y + 0.33, zm - 0.055, zm + 0.055));
        iron.push(block(sx * px - 0.055, sx * px + 0.055, y + rail, top, zw + 0.05, pz - 0.05));
      }
      // The front: a bottom rail, four bars with knops, the handrail.
      iron.push(block(-px + 0.05, px - 0.05, y + 0.05, y + 0.12, pz - 0.035, pz + 0.035), block(-px + 0.05, px - 0.05, y + rail, top, pz - 0.055, pz + 0.055));
      for (let k = 1; k <= 4; k++) {
        const x = -px + (2 * px * k) / 5;
        iron.push(block(x - 0.0375, x + 0.0375, y + 0.12, y + rail, pz - 0.0375, pz + 0.0375), block(x - 0.055, x + 0.055, y + 0.25, y + 0.33, pz - 0.055, pz + 0.055));
      }
    }
    balcony(S1[0] + 0.02, 0.86, 0.5, 0.67);
    balcony(S2[0] + 0.02, 0.8, 0.46, 0.62);

    /* -------------------------------------------------------------- */
    /* The wall lamps                                                  */
    /* -------------------------------------------------------------- */
    // On each lamp pier's face: an iron housing 0.12 wide and 0.2 tall, its cream lenses over and
    // under it lit with the wash (`glow`).
    for (const o of lampPiers) {
      const w = o.userData.wash as Wash;
      iron.push(block(w.x - 0.06, w.x + 0.06, w.y - 0.1, w.y + 0.1, w.z - 0.01, w.z + 0.08));
      for (const s of [-1, 1]) {
        const lens = box(shell, w.x, w.y + s * 0.135, w.z + 0.04, 0.14, 0.07, 0.1, L.paint, 'paint', { bevel: 0 });
        lens.castShadow = false;
        lens.userData.noShadow = true;
        const glow: Wash = { ...w, strength: VILLA_LAMPS.lens, glow: true };
        lens.userData.wash = glow;
      }
    }

    /* -------------------------------------------------------------- */
    /* Rainwater: a downpipe at each corner                            */
    /* -------------------------------------------------------------- */
    // On the side walls between the corner piers and the windows: from the gutter an outlet down
    // through the cornice into a hopper head under its bed, the pipe held by sockets with ears (just
    // clear of the string courses, which it runs through) and kicked out in a shoe on the plinth course.
    for (const [g, at] of [[east, -0.64], [east, 2.54], [west, 0.64], [west, -2.54]] as [T.Object3D, number][]) {
      const z = 0.075;
      rain.push(
        rodPart(v3(at, C.corona[0] + 0.04, 0.12), v3(at, C.bed[0] - 0.04, 0.12), 0.035, g),
        { geometry: HOPPER, matrix: on(g, placed(at, 4.74, 0.1)) },
        block(at - 0.12, at + 0.12, 4.86, 4.93, -0.01, 0.2, g),
        rodPart(v3(at, 4.64, z), v3(at, 0.64, z), 0.045, g),
        rodPart(v3(at, 0.68, z), v3(at, 0.6, z + 0.09), 0.045, g),
      );
      for (const y of [1.25, 1.95, 2.37, 3.5, 3.91, 4.5]) rain.push({ geometry: new T.CylinderGeometry(0.06, 0.06, 0.07, 10), matrix: on(g, placed(at, y, z)) }, block(at - 0.085, at + 0.085, y - 0.035, y + 0.035, -0.02, 0.05, g));
    }

    /* -------------------------------------------------------------- */
    /* The back: the back door and the stair window                    */
    /* -------------------------------------------------------------- */
    {
      const g = backFace,
        { w, sill, leaf, fan } = D,
        f = 0.07,
        head = fan + f,
        group = `${id}-back-door`;
      frameRing(g, 0, (sill + fan) / 2, 0, w, fan - sill, f, 0.1, L.paint, 'paint', false, true);
      // The leaf: a slab under raised stiles, rails and a muntin (0.04 proud of it), so its four
      // panels read sunk between them.
      enamel.push(block(-w / 2 + 0.01, w / 2 - 0.01, sill, leaf, 0, 0.07, g));
      for (const k of [-1, 1]) enamel.push(block(k * (w / 2 - 0.01) - (k > 0 ? 0.11 : 0), k * (w / 2 - 0.01) + (k < 0 ? 0.11 : 0), sill, leaf, 0.04, 0.11, g));
      for (const [y0, y1] of [[sill, sill + 0.14], [sill + 0.6, sill + 0.72], [leaf - 0.12, leaf]])
        enamel.push(block(-w / 2 + 0.12, w / 2 - 0.12, y0, y1, 0.04, 0.11, g));
      enamel.push(block(-0.04, 0.04, sill + 0.14, leaf - 0.12, 0.04, 0.11, g));
      brass.push({ geometry: new T.IcosahedronGeometry(0.045, 1), matrix: on(g, placed(w / 2 - 0.18, sill + 0.66, 0.15)) });
      // The transom and the fanlight (the back hall's light), parted by two glazing bars.
      bars.push(block(-w / 2, w / 2, leaf, leaf + 0.07, 0, 0.09, g));
      pane(g, 0, (leaf + 0.07 + fan) / 2, 0.03, w + 0.02, fan - leaf - 0.07 + 0.01, group);
      for (const k of [-1, 1]) bars.push(block(k * w / 6 - 0.035, k * w / 6 + 0.035, leaf + 0.07, fan, 0, 0.075, g));
      // The stone: jambs from the base, a hood 0.25 proud (the footprint's edge) on two consoles under
      // the band, a threshold.
      for (const k of [-1, 1]) stone.push(block(k < 0 ? -w / 2 - f - 0.12 : w / 2 + f, k < 0 ? -w / 2 - f : w / 2 + f + 0.12, P.base, head, -0.02, 0.12, g));
      stone.push(block(-w / 2 - f - 0.2, w / 2 + f + 0.2, head + 0.03, S0[1], -0.02, 0.25, g));
      for (const k of [-1, 1]) stone.push({ geometry: corbel(0.2, 0.2), matrix: on(g, placed(k * (w / 2 + f + 0.06), head + 0.03, 0, 0, -Math.PI / 2, 0)) });
      stone.push(block(-w / 2 - f - 0.12, w / 2 + f + 0.12, sill - 0.07, sill, -0.02, 0.14, g));
      // The step: a buff riser under a white tread nosed 0.03 over it, inside the footprint (0.255
      // behind the wall).
      const riser = box(g, 0, (V.foot + sill / 2 - 0.07) / 2, 0.175, 1.2, sill / 2 - 0.07 - V.foot, 0.1, L.base, 'stone', { bevel: 0.03 });
      riser.name = 'sky-villa-steps';
      stone.push(block(-0.62, 0.62, sill / 2 - 0.07, sill / 2, 0.11, 0.255, g));
    }
    {
      const g = backFace,
        { w, sill, spring } = ST,
        r = w / 2,
        f = 0.07,
        cy = (sill + spring) / 2,
        group = `${id}-back-stair`;
      const ring = frameRing(g, 0, cy, 0, w, spring - sill, f, 0.09, L.paint, 'paint', true);
      const glass = new T.Mesh(new T.ShapeGeometry(ring(0.01), 8), material(L.glass, 'glass'));
      glass.position.set(0, cy, 0.03);
      glass.userData.windowGroup = group;
      glass.userData.window = VILLA_WINDOWS;
      g.add(glass);
      // A glazing bar up its middle, a meeting rail and a bar at the springing.
      bars.push(block(-0.035, 0.035, sill, spring + r, 0, 0.08, g), block(-r, r, cy - 0.035, cy + 0.035, 0, 0.08, g), block(-r, r, spring - 0.035, spring + 0.035, 0, 0.08, g));
      // The stone: jambs to the springing, six voussoirs and a keystone round the head, a sill on corbels.
      for (const k of [-1, 1]) stone.push(block(k < 0 ? -r - f - 0.11 : r + f, k < 0 ? -r - f : r + f + 0.11, sill - f, spring, -0.02, 0.12, g));
      for (const v of voussoirs(r + f, r + f + 0.15, 0.14, -0.02)) stone.push({ geometry: v, matrix: on(g, placed(0, spring, 0)) });
      stone.push({ geometry: prism([[-0.08, r + f - 0.02], [0.08, r + f - 0.02], [0.12, r + f + 0.24], [-0.12, r + f + 0.24]], 0.19, 0.02, -0.02), matrix: on(g, placed(0, spring, 0)) });
      const foot = sill - f;
      stone.push(block(-r - 0.3, r + 0.3, foot - 0.09, foot, -0.02, 0.2, g));
      for (const k of [-1, 1]) stone.push({ geometry: corbel(0.17, 0.15), matrix: on(g, placed(k * (r + f + 0.05), foot - 0.09, 0, 0, -Math.PI / 2, 0)) });
    }

    /* -------------------------------------------------------------- */
    /* The roof: slate hips, the flat, dormers, the stacks             */
    /* -------------------------------------------------------------- */
    const R = V.roof,
      x0 = -hw - R.eave,
      x1 = hw + R.eave,
      z0 = back - R.eave,
      z1 = front + R.eave,
      roofFoot = C.corona[1];
    const hip = hippedRoof(x0, x1, z0, z1, roofFoot, R.fascia, R.rise, R.run, R.runX),
      roof = new T.Mesh(hip.geometry, material(L.slate, 'slate'));
    roof.castShadow = roof.receiveShadow = true;
    roof.userData.roof = true;
    roof.userData.eaveY = roofFoot;
    roof.name = 'sky-villa-roof';
    shell.add(roof);
    const [fx0, fz0] = hip.flat[0],
      [fx1, fz1] = hip.flat[2];
    // Lead rolls: on each hip from just over the gutter (where a ball ends it) to the flat's corner,
    // round the flat's edges (its ridges), with a boss where they meet, and across the flat every 1.1.
    for (let i = 0; i < 4; i++) {
      const foot = v3(hip.eave[i][0], hip.y1 + 0.02, hip.eave[i][1]),
        head = v3(hip.flat[i][0], hip.y2 + 0.03, hip.flat[i][1]),
        start = foot.clone().lerp(head, 0.06);
      lead.push(rodPart(start, head, 0.075, undefined, 10), { geometry: new T.IcosahedronGeometry(0.09, 1), matrix: placed(start.x, start.y + 0.01, start.z) });
      lead.push({ geometry: new T.IcosahedronGeometry(0.1, 1), matrix: placed(head.x, head.y + 0.02, head.z) });
    }
    for (const [a, b] of [[[fx0, fz0], [fx1, fz0]], [[fx0, fz1], [fx1, fz1]], [[fx0, fz0], [fx0, fz1]], [[fx1, fz0], [fx1, fz1]]] as [number, number][][])
      lead.push(rodPart(v3(a[0], hip.y2 + 0.03, a[1]), v3(b[0], hip.y2 + 0.03, b[1]), 0.075, undefined, 10));
    slates.push(block(fx0 + 0.02, fx1 - 0.02, hip.y2 - 0.03, hip.y2 + 0.04, fz0 + 0.02, fz1 - 0.02));
    {
      const n = Math.max(2, Math.round((fx1 - fx0) / 1.1));
      for (let k = 1; k < n; k++) {
        const x = fx0 + ((fx1 - fx0) * k) / n;
        lead.push(rodPart(v3(x, hip.y2 + 0.06, fz0 + 0.06), v3(x, hip.y2 + 0.06, fz1 - 0.06), 0.05));
      }
    }
    // The eave breaks forward over the bay: the bay's own low hipped roof (R.bayPitch), from a fascia
    // round its eave (R.eave out from the bay's walls) to where it dies into the front slope. An
    // overhang of its own, so it shades the bay's frieze. Its hips are plain arrises: rolls on them
    // stopped short in mid-air where the hips die into the slope, like two loose pipes.
    {
      const m = new T.Mesh(bayRoof(bay.hw + R.eave, z1, bayFront + R.eave, roofFoot, R.fascia, R.bayPitch, R.rise / R.run), material(L.slate, 'slate'));
      m.castShadow = m.receiveShadow = true;
      m.userData.roof = true;
      m.userData.eaveY = roofFoot;
      m.name = 'sky-villa-bay-roof';
      shell.add(m);
    }
    /** The front slope's height at z (from the eave's top to the flat). */
    const slopeAt = (z: number) => hip.y1 + ((z1 - z) * R.rise) / R.run;
    /**
     * A dormer on the front slope, centred at x, its front at `zf`: lead cheeks running back into the
     * slope (a lead body: its sides above the slates are the cheeks), a white painted front between
     * two pilasters, a sash (or a pair, the pediment's) on a white sill, a white stone cornice round
     * its head and cheeks, and a lead apron where its front meets the slates. The middle one carries
     * a pediment (a tympanum under a raking cornice, a ball at its apex) and a slate gable roof with a
     * lead ridge running back into the slope; the side ones a low hipped slate roof on their cornice.
     * (Lead flats on the side ones read from the town's height, and from behind over the main roof's
     * flat, as lidded grey boxes.)
     */
    function dormer(k: number, x: number, w: number, pediment: boolean) {
      const zf = 1.05,
        head = 6.6,
        zc = 0.12,
        y0 = slopeAt(zf) - 0.12,
        g = faceAt(shell, x, zf, 0),
        group = `${id}-dormer-${k}`;
      lead.push(block(x - w / 2, x + w / 2, y0, head, zc, zf - 0.05));
      paint.push(block(-w / 2, w / 2, y0, head, -0.07, 0, g));
      for (const s of [-1, 1]) paint.push(block(s < 0 ? -w / 2 : w / 2 - 0.08, s < 0 ? -w / 2 + 0.08 : w / 2, y0, head, -0.02, 0.05, g));
      const [sw, sh, sy] = [pediment ? 0.36 : 0.4, 0.44, 6.24];
      const sashAt = (cx: number, bar: boolean) => {
        frameRing(g, cx, sy, 0, sw, sh, 0.07, 0.09, L.paint, 'paint');
        for (const s of [-1, 1]) pane(g, cx, sy + (s * (sh + 0.07)) / 4, 0.03, sw + 0.02, (sh - 0.07) / 2 + 0.01, group, true);
        bars.push(block(cx - sw / 2, cx + sw / 2, sy - 0.035, sy + 0.035, 0, 0.08, g));
        if (bar) bars.push(block(cx - 0.035, cx + 0.035, sy - sh / 2, sy + sh / 2, 0, 0.075, g));
      };
      if (pediment) for (const s of [-1, 1]) sashAt(s * (sw / 2 + 0.06), false);
      else sashAt(0, true);
      stone.push(block(-w / 2 + 0.06, w / 2 - 0.06, sy - sh / 2 - 0.16, sy - sh / 2 - 0.07, -0.02, 0.13, g));
      // The cornice round the head and the cheeks, its back ends buried in the slope.
      stone.push({ geometry: sweep([[x + w / 2, zc], [x + w / 2, zf], [x - w / 2, zf], [x - w / 2, zc]], false, PROFILE.cornice, head), matrix: IDENTITY });
      const top = head + 0.14;
      if (pediment) {
        const half = w / 2,
          rise = 0.18,
          pitch = rise / half,
          eave = half + 0.12,
          ridge = top + eave * pitch + 0.02;
        paint.push({ geometry: prism([[-half, 0], [half, 0], [0, rise]], 0.08, 0.02, -0.06), matrix: on(g, placed(0, top, 0)) });
        stone.push({ geometry: chevron(half + 0.13, (half + 0.13) * pitch, 0.1, 0.17), matrix: on(g, placed(0, top - 0.005, -0.04)) });
        stone.push({ geometry: new T.IcosahedronGeometry(0.08, 1), matrix: on(g, placed(0, top + (half + 0.13) * pitch + 0.06, 0.05)) });
        const zb = -0.26,
          zr = zf + 0.04,
          A = v3(x - eave, top, zr),
          B = v3(x + eave, top, zr),
          Rf = v3(x, ridge, zr),
          A2 = v3(x - eave, top, zb),
          B2 = v3(x + eave, top, zb),
          R2 = v3(x, ridge, zb);
        const gable = new T.Mesh(convex([[A, B, Rf], [A2, B2, R2], [A, Rf, R2, A2], [Rf, B, B2, R2], [A, A2, B2, B]]), material(L.slate, 'slate'));
        gable.castShadow = gable.receiveShadow = true;
        gable.userData.roof = true;
        gable.userData.eaveY = top;
        gable.name = 'sky-villa-dormer-roof';
        shell.add(gable);
        lead.push(rodPart(v3(x, ridge + 0.02, zr - 0.02), v3(x, ridge + 0.02, zb), 0.05));
      } else {
        // A low hipped slate roof flush with the corona, its hips at the sides' pitch, its ridge
        // running back until it dies into the main slope; a lead roll on the ridge.
        const half = w / 2 + 0.13,
          rise = 0.16,
          zb = -0.15,
          zr = zf + 0.13,
          ridge = top + rise,
          [FL, FR, BL, BR] = [v3(x - half, top, zr), v3(x + half, top, zr), v3(x - half, top, zb), v3(x + half, top, zb)],
          Rf = v3(x, ridge, zr - half),
          Rb = v3(x, ridge, zb);
        const hipped = new T.Mesh(convex([[FL, FR, Rf], [FL, BL, Rb, Rf], [FR, Rf, Rb, BR], [BL, BR, Rb], [FL, FR, BR, BL]]), material(L.slate, 'slate'));
        hipped.castShadow = hipped.receiveShadow = true;
        hipped.userData.roof = true;
        hipped.userData.eaveY = top;
        hipped.name = 'sky-villa-dormer-roof';
        shell.add(hipped);
        lead.push(rodPart(v3(x, ridge + 0.015, zr - half), v3(x, ridge + 0.015, zb), 0.045), { geometry: new T.IcosahedronGeometry(0.06, 1), matrix: placed(x, ridge + 0.02, zr - half) });
      }
      // The apron: a lead plate on the slope at the front's foot.
      const f = slopeFrame(shell, x, zf + 0.08, 0, hip.y2, R.rise / R.run, fz1);
      f.updateMatrix();
      lead.push({ geometry: chamfered(w + 0.08, 0.2, 0.07), matrix: on(f, placed(0, 0, 0.035)) });
    }
    dormer(0, 0, 1.24, true);
    for (const sx of [-1, 1]) dormer(sx < 0 ? 1 : 2, sx * windowX, 0.72, false);
    // The stacks at both ends, rising through the end slopes from just inside the eaves to over the
    // flat (their long side across the house, so the cans stand in a row seen from the front, not
    // one behind another): a brick shaft with a white stone band, a cap corbelled out in two brick
    // courses, a white stone cope and its flaunching, three terracotta cans of different heights, and
    // lead flashings down the slope beside the shaft.
    for (const sx of [-1, 1]) {
      const { x: cx, z, w, d, top } = V.chimney,
        x = sx * cx,
        heights = sx < 0 ? [0.82, 1.14, 0.96] : [1.06, 0.84, 1.12];
      box(shell, x, (roofFoot + top - 0.24) / 2, z, w, top - 0.24 - roofFoot, d, L.brick, 'brick');
      box(shell, x, top - 0.18, z, w + 0.1, 0.12, d + 0.1, L.brick, 'brick');
      box(shell, x, top - 0.06, z, w + 0.2, 0.12, d + 0.2, L.brick, 'brick');
      stone.push(block(x - w / 2 - 0.04, x + w / 2 + 0.04, top - 0.54, top - 0.44, z - d / 2 - 0.04, z + d / 2 + 0.04));
      box(shell, x, top + 0.08, z, w + 0.28, 0.16, d + 0.28, L.stone, 'stone');
      stone.push(block(x - w / 2 + 0.02, x + w / 2 - 0.02, top + 0.16, top + 0.23, z - d / 2 + 0.02, z + d / 2 - 0.02));
      const cans = heights.map((tall, i): Part => ({ geometry: canGeometry(tall), matrix: placed(x + (i - 1) * 0.27, top + 0.2, z) }));
      parts(shell, cans, L.pots, 'pantile');
      for (const s of [-1, 1]) {
        const f = slopeFrame(shell, x, z + s * (d / 2 + 0.05), (sx * Math.PI) / 2, hip.y2, R.rise / R.runX, x1 - R.runX);
        f.updateMatrix();
        lead.push({ geometry: chamfered(0.1, w * Math.hypot(1, R.rise / R.runX), 0.07), matrix: on(f, placed(0, 0, 0.035)) });
      }
    }

    /* -------------------------------------------------------------- */
    /* The terrace                                                     */
    /* -------------------------------------------------------------- */
    {
      const TR = V.terrace,
        top = TR.top,
        tz0 = front - 0.05,
        tz1 = front + TR.depth,
        tw = TR.hw;
      // Its walls: one buff stone mass from the foot to under the flags.
      const body = box(shell, 0, (V.foot + top - 0.07) / 2, (tz0 + tz1) / 2, 2 * tw, top - 0.07 - V.foot, tz1 - tz0, L.base, 'ashlar', { bevel: 0.04 });
      body.name = 'sky-villa-terrace';
      // The flags, as geometry (calm: large stones 0.07 thick, each a shade of its own, every top edge
      // chamfered so they part in fine V joints both ways and close at their corners): a kerb 0.3
      // wide round the front and the ends, nosed 0.04 over the walls, which the balustrade stands on;
      // inside it two rows of flags in running bond.
      const kerb = 0.3,
        fy0 = top - 0.07,
        fx = tw - kerb,
        flag = (a: number, b: number, c: number, d: number) => flags.push({ geometry: upright([[a, c], [b, c], [b, d], [a, d]], 0.07, 0.012, fy0), matrix: IDENTITY });
      for (const [a, b] of [[-tw - 0.04, -2.0], [-2.0, -TR.steps.hw], [-TR.steps.hw, TR.steps.hw], [TR.steps.hw, 2.0], [2.0, tw + 0.04]]) flag(a, b, tz1 - kerb, tz1 + 0.04);
      for (const sx of [-1, 1]) {
        const zm = (tz0 + tz1 - kerb) / 2;
        flag(sx < 0 ? -tw - 0.04 : fx, sx < 0 ? -fx : tw + 0.04, tz0, zm);
        flag(sx < 0 ? -tw - 0.04 : fx, sx < 0 ? -fx : tw + 0.04, zm, tz1 - kerb);
      }
      const rowZ = [tz0, (tz0 + tz1 - kerb) / 2, tz1 - kerb],
        n = 7,
        size = (2 * fx) / n;
      for (let r = 0; r < 2; r++) {
        const edges = r === 0 ? Array.from({ length: n + 1 }, (_, k) => -fx + k * size) : [-fx, ...Array.from({ length: n }, (_, k) => -fx + (k + 0.5) * size), fx];
        for (let k = 0; k + 1 < edges.length; k++) flag(edges[k], edges[k + 1], rowZ[r], rowZ[r + 1]);
      }
      // The steps down at its centre, between sloping cheek walls: risers of buff stone under white
      // nosed treads, the top one the terrace's own kerb.
      const { hw: shw, run, risers } = TR.steps,
        rise = top / risers;
      for (let i = 1; i < risers; i++) {
        const tread = top - i * rise,
          out = i * run;
        const step = box(shell, 0, (V.foot + tread - 0.06) / 2, tz1 - 0.05 + (out + 0.05) / 2, 2 * shw, tread - 0.06 - V.foot, out + 0.05, L.base, 'stone', { bevel: 0.03 });
        step.name = 'sky-villa-steps';
        stone.push(block(-shw - 0.02, shw + 0.02, tread - 0.07, tread, tz1 - 0.05, tz1 + out + 0.03));
      }
      const reach = (risers - 1) * run + 0.03;
      for (const sx of [-1, 1]) {
        const cheek = new T.Mesh(
          prism([[tz1 - 0.12, V.foot], [tz1 + reach, V.foot], [tz1 + reach, 0.2], [tz1 - 0.12, top + 0.14]].map(([zz, yy]): [number, number] => [-zz, yy]), 0.2, 0.025, -0.1).clone().rotateY(Math.PI / 2),
          material(L.base, 'stone'),
        );
        cheek.position.x = sx * (shw + 0.1);
        cheek.castShadow = cheek.receiveShadow = true;
        cheek.name = 'sky-villa-steps';
        shell.add(cheek);
        // Its coping: a white stone 0.07 thick along the slope, 0.03 over each face, stopping short
        // of the cheek's low end (inside the footprint).
        const a = v3(sx * (shw + 0.1), top + 0.14, tz1 - 0.12),
          b = v3(sx * (shw + 0.1), 0.2, tz1 + reach),
          dir = b.clone().sub(a).normalize(),
          lo = b.clone().addScaledVector(dir, -0.07),
          len = lo.distanceTo(a),
          tilt = Math.atan2(a.y - b.y, b.z - a.z),
          mid = a.clone().add(lo).multiplyScalar(0.5).add(v3(0, Math.cos(tilt) * 0.035, Math.sin(tilt) * 0.035));
        stone.push({ geometry: chamfered(0.26, 0.07, len), matrix: placed(mid.x, mid.y, mid.z, tilt, 0, 0) });
      }
      // The balustrade (white stone) on the kerb: a base, turned balusters about every 0.25 and a
      // coping, between dies with caps; urns on the corner piers, balls on the other dies.
      const by = top,
        baseTop = by + 0.08,
        copeY = baseTop + 0.3,
        BAL = new T.LatheGeometry(
          ([[0, 0], [0.065, 0], [0.065, 0.03], [0.05, 0.05], [0.07, 0.12], [0.06, 0.18], [0.042, 0.23], [0.06, 0.27], [0.06, 0.3], [0, 0.3]] as [number, number][]).map(([r, y]) => new T.Vector2(r, y)),
          8,
        ),
        rz = tz1 - 0.14, // the front run's line
        ex = tw - 0.14, // the ends' runs' line
        die = 0.26,
        pier = 0.32,
        dies: [number, number, number][] = [[-(shw + 0.12), rz, die], [shw + 0.12, rz, die], [-ex, front + 0.3, die], [ex, front + 0.3, die]];
      const runOf = (a: T.Vector3, b: T.Vector3) => {
        const d = b.clone().sub(a),
          len = d.length(),
          ry = Math.atan2(d.x, d.z) + Math.PI / 2,
          mid = a.clone().add(b).multiplyScalar(0.5),
          n = Math.max(1, Math.round(len / 0.25));
        stone.push({ geometry: chamfered(len, 0.08, 0.2), matrix: placed(mid.x, by + 0.04, mid.z, 0, ry, 0) });
        stone.push({ geometry: chamfered(len + 0.02, 0.09, 0.24), matrix: placed(mid.x, copeY + 0.045, mid.z, 0, ry, 0) });
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          stone.push({ geometry: BAL, matrix: placed(a.x + d.x * t, baseTop, a.z + d.z * t) });
        }
      };
      const at = (x: number, z: number) => v3(x, 0, z);
      for (const sx of [-1, 1]) {
        runOf(at(sx * (shw + 0.12 + die / 2), rz), at(sx * (ex - pier / 2), rz));
        runOf(at(sx * ex, rz - pier / 2), at(sx * ex, front + 0.3 + die / 2));
        // The corner pier: a die 0.32 square, a moulded cap, and an urn on it.
        stone.push(
          block(sx * ex - pier / 2, sx * ex + pier / 2, by, copeY + 0.16, rz - pier / 2, rz + pier / 2),
          block(sx * ex - pier / 2 - 0.04, sx * ex + pier / 2 + 0.04, copeY + 0.16, copeY + 0.24, rz - pier / 2 - 0.04, rz + pier / 2 + 0.04),
          { geometry: URN, matrix: placed(sx * ex, copeY + 0.24, rz) },
        );
      }
      for (const [x, z, s] of dies) {
        stone.push(block(x - s / 2, x + s / 2, by, copeY + 0.09, z - s / 2, z + s / 2));
        stone.push(block(x - s / 2 - 0.04, x + s / 2 + 0.04, copeY + 0.09, copeY + 0.16, z - s / 2 - 0.04, z + s / 2 + 0.04));
        stone.push({ geometry: new T.CylinderGeometry(0.07, 0.09, 0.08, 12), matrix: placed(x, copeY + 0.2, z) }, { geometry: new T.IcosahedronGeometry(0.12, 2), matrix: placed(x, copeY + 0.36, z) });
      }
    }

    parts(shell, stone, L.stone, 'stone', { tone: 0.05 });
    parts(shell, base, L.base, 'stone', { tone: 0.05 });
    parts(shell, flags, L.paving, 'stone', { tone: 0.035, name: 'sky-villa-flags' });
    parts(shell, paint, L.paint, 'paint');
    parts(shell, bars, L.paint, 'paint', { shadow: false });
    parts(shell, iron, L.iron, 'iron', { shadow: false });
    parts(shell, rain, L.rain, 'iron', { shadow: false });
    parts(shell, brass, L.brass, 'brass', { shadow: false });
    parts(shell, enamel, L.door, 'enamel');
    parts(shell, slates, L.slate, 'slate');
    parts(shell, lead, L.lead, 'paint');
  }
  return { buildSkyVilla };
}
export type SkyVilla = ReturnType<typeof createSkyVilla>;
