import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SurfaceKind } from './city-materials';
import { palette, hash, type TownContext } from './town-shared';
import { RESIDENCE_LOOK } from './town-residence';
import type { Wash, WindowRole } from './town-batch';
import type { Kit } from './town-kit';
import type { Nature } from './town-nature';
import type { Props } from './town-props';

/**
 * The sky villa's colours, each no more saturated than its palette family (VILLA_FAMILY): red
 * brick (palette.brick, which is the brick kind by itself); white stone for the bands, the cornice,
 * the dressings and the balustrade (the residence's dressing, the calmest pale stone in the town);
 * white paintwork for the frames, the doors and the dormers; the kerb's buff stone for the plinth,
 * the terrace's walls and its steps, and the residence's forecourt flags on the terrace; the town's
 * mid blue-grey slate (never dark slate) on the slopes and the flats, its lighter rolls on the hips
 * and round the flat; cast iron for the balconies and the lamps' housings; terracotta chimney cans;
 * one brass knob on the front door.
 */
export const VILLA_LOOK = {
  brick: palette.brick,
  stone: RESIDENCE_LOOK.dressing,
  paint: palette.white,
  base: palette.kerb,
  paving: RESIDENCE_LOOK.paving,
  slate: palette.slate,
  roll: palette.slateLight,
  iron: palette.metal,
  pots: palette.pantile,
  brass: palette.brass,
  glass: palette.glass,
};
/** Each colour's palette family: the colour may be no more saturated than it (check-town). */
export const VILLA_FAMILY: Record<keyof typeof VILLA_LOOK, string> = {
  brick: palette.brick,
  stone: palette.render,
  paint: palette.white,
  base: palette.kerb,
  paving: palette.pavement,
  slate: palette.slate,
  roll: palette.slateLight,
  iron: palette.metal,
  pots: palette.pantile,
  brass: palette.brass,
  glass: palette.glass,
};
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
 *   starts each mesh's courses at its own foot). `bands` the white floor bands between them.
 * - `cornice`: its bed, modillion course and corona (y from, to) and the corona's projection.
 * - `roof`: the hipped slate roof on the corona: its eave over the walls, the fascia, the rise to
 *   the flat and the run of the front and back slopes (`run`) and of the steeper end slopes
 *   (`runX`, so the side dormers stay clear of the hips); `bayPitch` the rise a unit of the bay's
 *   own low roof, which dies into the front slope in front of the middle dormer.
 * - `terrace`: its top (the ground floor's level), its depth from the main front wall, its half
 *   width, and its steps (half width, the run of a step and the number of risers).
 * - `chimney`: the two stacks (x either side, z, their plan and the shaft's height, where the cope
 *   sits: the cope, its flaunching and the tallest can end 0.565 over it).
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
  cornice: { bed: [4.98, 5.06] as [number, number], modillions: [5.06, 5.24] as [number, number], corona: [5.24, 5.42] as [number, number], proud: 0.25 },
  roof: { eave: 0.23, fascia: 0.06, rise: 1.5, run: 1.55, runX: 1.05, bayPitch: 0.4 },
  terrace: { top: 0.5, depth: 1.6, hw: 3.3, steps: { hw: 0.67, run: 0.25, risers: 3 } },
  chimney: { x: 2.8, z: -0.945, w: 1.0, d: 0.62, top: 7.6 },
};
/**
 * The wall lamps: an up-and-down lamp on the front of each corner pier and each
 * of the bay's piers on the ground and first floors, as in the reference's dusk, at `y` (from each
 * storey's foot). Each pier carries one lamp, and its brick takes the lamp's light through batch()'s
 * aWash (see city-materials' WASH_FRAGMENT): the scallop above it has faded by 0.85 up and the one
 * below by 0.45 down, so neither reaches the bands; `half` is the half width it fades out by, just
 * inside each pier's (the corners' 0.28, the bay's 0.25). The lenses glow with the same light
 * (`lens`, its strength: about twice a lit window, and under 1 in luminance, so a lens 0.14 across
 * spills nothing over its edges when the multisampled frame resolves; at 1.6 it was 2.4).
 */
export const VILLA_LAMPS = { y: [0.7, 0.49], half: { corner: 0.27, bay: 0.24 }, strength: 1, lens: 0.6 };
/**
 * The villa's night lights: one light a window (each sash's two panes, each French door's leaves
 * and fanlight), every one in the 'villa' role (town-batch's WINDOW_MIX: warm, all lit in the
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
 * are its ground's), so `_props` and `_nature` go unused; they stay in the signature, which is every
 * building factory's.
 */
export function createSkyVilla(ctx: TownContext, kit: Kit, _props: Props, _nature: Nature) {
  const { material } = ctx;
  const { box, chamfered, frameRing, prism, stack } = kit;
  const L = VILLA_LOOK,
    V = VILLA;

  /** A part for parts(): a shared geometry and where it goes in its mesh's space. */
  type Part = { geometry: T.BufferGeometry; matrix: T.Matrix4 };
  const ONE = new T.Vector3(1, 1, 1);
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
  /** A round rod of radius r from a to b (8 sides), as a part. */
  const rodPart = (a: T.Vector3, b: T.Vector3, r: number): Part => {
    const d = b.clone().sub(a);
    return {
      geometry: new T.CylinderGeometry(r, r, d.length(), 8),
      matrix: new T.Matrix4().compose(a.clone().addScaledVector(d, 0.5), new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()), ONE),
    };
  };
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
      mid = new T.Vector3((x0 + x1) / 2, (y + y2) / 2, (z0 + z1) / 2),
      pos: number[] = [],
      ab = new T.Vector3(),
      ac = new T.Vector3();
    // Each triangle wound to face away from the solid's middle (it is convex).
    const tri = (a: T.Vector3, b: T.Vector3, c: T.Vector3) => {
      const n = ab.subVectors(b, a).cross(ac.subVectors(c, a)),
        out = a.clone().add(b).add(c).divideScalar(3).sub(mid);
      for (const p of n.dot(out) >= 0 ? [a, b, c] : [a, c, b]) pos.push(p.x, p.y, p.z);
    };
    const quad = (a: T.Vector3, b: T.Vector3, c: T.Vector3, d: T.Vector3) => {
      tri(a, b, c);
      tri(a, c, d);
    };
    const at = (p: [number, number], h: number) => new T.Vector3(p[0], h, p[1]);
    quad(at(eave[0], y), at(eave[1], y), at(eave[2], y), at(eave[3], y));
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      quad(at(eave[i], y), at(eave[j], y), at(eave[j], y1), at(eave[i], y1));
      quad(at(eave[i], y1), at(eave[j], y1), at(flat[j], y2), at(flat[i], y2));
    }
    quad(at(flat[0], y2), at(flat[1], y2), at(flat[2], y2), at(flat[3], y2));
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geometry.computeVertexNormals(); // non-indexed: each face its own normal
    return { geometry, eave, flat, y1, y2 };
  }
  /** A convex solid from its faces (each a loop of corners), every face wound away from the solid's middle and keeping its own normal. */
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
   * The main roof's eave breaking forward over the bay, as one solid: from a fascia `fascia` tall
   * (from y) round the bay's eave (x -X..X, out from the main eave at zb to zf), a front slope and two
   * hipped ends rise at `pitch` (rise per run) until they die into the main front slope, which rises
   * at `mainPitch` back from zb.
   */
  function bayRoof(X: number, zb: number, zf: number, y: number, fascia: number, pitch: number, mainPitch: number) {
    const E = y + fascia,
      t = ((zf - zb) * mainPitch) / (mainPitch - pitch), // each hip's run in plan, to the main slope
      v = (x: number, h: number, z: number) => new T.Vector3(x, h, z);
    const A = v(-X, E, zf),
      B = v(X, E, zf),
      C = v(X, E, zb),
      D = v(-X, E, zb),
      P = v(X - t, E + t * pitch, zf - t),
      Q = v(-X + t, E + t * pitch, zf - t),
      [a, b, c, d] = [A, B, C, D].map((p) => v(p.x, y, p.z));
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
   * A cast-iron balcony front `length` long on g's face (x along it, +z out of it), standing on y 0:
   * a plate 0.07 thick and `tall` high pierced with a few tall slots (about `slot` wide, fitted to
   * the length, with `bar` of iron between them and `end` at the plate's ends, so it reads as a row
   * of fat bars), under a chunky handrail. The town's way with railings in front of lit glass (the
   * bandstand's panels): a few fat members and a pierced plate, never hairlines. Slots 0.12 wide
   * with 0.1 of iron between them were about 3 pixels a pair in the overview, and the row beat as
   * the view panned; at 0.31 a pair they hold. From the town's camera (42.6 degrees down) the plate
   * lies over the doors' white kick panels, not their glass (the handrail's line of sight meets the
   * doors below the panels' top).
   */
  const RAIL = { tall: 0.44, slot: 0.17, bar: 0.14, end: 0.1, border: 0.06, rail: [0.08, 0.1] as [number, number] };
  const railPlates = new Map<string, T.BufferGeometry>();
  function railPlate(length: number) {
    const key = length.toFixed(4);
    let g = railPlates.get(key);
    if (!g) {
      const { tall, bar, end, border } = RAIL,
        s = new T.Shape([new T.Vector2(-length / 2, 0), new T.Vector2(length / 2, 0), new T.Vector2(length / 2, tall), new T.Vector2(-length / 2, tall)]),
        n = Math.max(1, Math.round((length - 2 * end + bar) / (RAIL.slot + bar))),
        slot = (length - 2 * end - (n - 1) * bar) / n,
        span = n * slot + (n - 1) * bar;
      // Square-cornered slots (a 0.02 round), so the iron between them reads as bars between a
      // bottom and a top rail. (Round-ended ones read as a row of white pills.)
      for (let k = 0; k < n; k++) {
        const x0 = -span / 2 + k * (slot + bar),
          x1 = x0 + slot,
          y0 = border + 0.02,
          y1 = tall - border,
          r = 0.02,
          hole = new T.Path();
        hole.moveTo(x0 + r, y0);
        hole.lineTo(x1 - r, y0);
        hole.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
        hole.lineTo(x1, y1 - r);
        hole.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
        hole.lineTo(x0 + r, y1);
        hole.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
        hole.lineTo(x0, y0 + r);
        hole.absarc(x0 + r, y0 + r, r, Math.PI, 1.5 * Math.PI, false);
        s.holes.push(hole);
      }
      g = new T.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: false, curveSegments: 4 }).translate(0, 0, -0.035);
      railPlates.set(key, g);
    }
    return g;
  }

  /**
   * The villa (front +z, in the shell's frame; see VILLA), a fancy British red-brick villa after the
   * owner's reference, in the town's Clash language at the Town Hall's and the residence's quality:
   * - A battered stone plinth under a moulded plinth course; red brick walls of three storeys,
   *   with brick piers (0.08 proud) at the four corners and either side of the projecting centre
   *   bay, belted by two white stone floor bands and capped by a deep white cornice (a bed, a
   *   modillion course and a corona 0.25 proud, which breaks forward over the bay and whose eave
   *   shades the frieze).
   * - The centre bay: on each floor white-framed French doors (two glazed leaves over white kick
   *   panels, a meeting stile, a transom and a fanlight) in a white stone architrave with a keystone;
   *   on the ground floor they are the front door, opening onto the terrace, with a brass knob; on
   *   the first and second floors they open onto iron balconies (a white stone slab on two consoles,
   *   a cast-iron front pierced with five fat slots under a chunky handrail).
   * - Elsewhere tall white sash windows (two panes and a meeting rail) in white architraves with
   *   keystones, on sills and corbels on the ground floor and on the bands above: two a storey on
   *   the front, two on each side, three on the back.
   * - Up-and-down wall lamps on the piers (VILLA_LAMPS): iron housings with cream lenses.
   * - A hipped slate roof with a flat top (one solid: its slopes take the slate's coursing),
   *   lighter rolls on its hips and round the flat; its eave breaks forward over the bay in a low
   *   hipped roof of its own; three square white dormers on the front slope (the middle one wider,
   *   with a pair of sashes), each under a white stone crown with a slate flat on it; tall brick
   *   chimney stacks at both ends, rising from just inside the eaves, with white copes and necking
   *   bands and a row of terracotta cans across the house.
   * - In front, the raised terrace (VILLA.terrace): buff stone walls, flagged, with a white stone
   *   balustrade of turned balusters between dies on its front and ends, ball finials on the dies
   *   that flank the steps down at its centre, the steps between sloping cheek walls.
   * No text, numbers or signage anywhere, and nothing that moves. Glass is one light a window: the
   * front door's in the 'entrance' role, the rest in the 'villa' role (VILLA_WINDOWS). The lamp
   * piers' brick and the lamps' lenses carry `userData.wash` (Wash), which batch() bakes into aWash
   * for the night wash.
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
      paint: Part[] = [], // white paintwork that casts (the dormers, the doors' panels)
      bars: Part[] = [], // slim white members: meeting rails, stiles, transoms (cast nothing)
      iron: Part[] = [], // the balconies and the lamps' housings (cast nothing)
      brass: Part[] = [], // the front door's knob
      flat: Part[] = [], // the roof's and the dormers' flats, in slate
      rolls: Part[] = [];
    const frontFace = faceAt(shell, 0, front, 0),
      bayFace = faceAt(shell, 0, bayFront, 0),
      backFace = faceAt(shell, 0, back, Math.PI),
      east = faceAt(shell, hw, 0, Math.PI / 2), // +x: face x toward the back
      west = faceAt(shell, -hw, 0, -Math.PI / 2); // -x: face x toward the front
    const brick = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, opts: { bevel?: number } = {}) =>
      box(shell, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, L.brick, 'brick', opts);

    /* -------------------------------------------------------------- */
    /* Masses: the plinth, the walls, the piers                       */
    /* -------------------------------------------------------------- */
    // The plinth, battered (6 degrees), 0.1 proud of the walls at its top, from the foot.
    const plinthTop = S0[0];
    const plinth = box(shell, 0, (V.foot + plinthTop) / 2, (back + front) / 2, 2 * hw + 0.28, plinthTop - V.foot, front - back + 0.28, L.base, 'ashlar', { taper: (plinthTop - V.foot) * 0.105 });
    plinth.name = 'sky-villa-plinth';
    // The main block and the bay, each one brick mass from the plinth to the frieze (their feet
    // are the ground floor's, so the courses line up with the piers').
    brick(-hw, hw, S0[0], S2[1], back, front);
    brick(-bay.hw, bay.hw, S0[0], S2[1], front - 0.1, bayFront);
    // The piers, storey by storey (each from its storey's foot, a course multiple over the first,
    // to 0.04 inside the band above): the corners proud of both faces, the bay's round its front
    // corners and over its returns. The front ones on the ground and first floors carry the lamps.
    // (A soft 0.05 arris: the kit's own bevel for a pier this size, 0.11, turned them into round columns.)
    const pierAt = (x0: number, x1: number, z0: number, z1: number, s: number, lamp?: { x: number; z: number; half: number }) => {
      const [y0, y1] = V.storeys[s],
        m = brick(x0, x1, y0, y1 + 0.04, z0, z1, { bevel: 0.05 });
      if (lamp && s < 2) {
        const wash: Wash = { x: lamp.x, y: y0 + VILLA_LAMPS.y[s], z: lamp.z, nx: 0, nz: 1, strength: VILLA_LAMPS.strength, half: lamp.half };
        m.userData.wash = wash;
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

    /* -------------------------------------------------------------- */
    /* The white stone: plinth course, floor bands, cornice           */
    /* -------------------------------------------------------------- */
    // The moulded plinth course (0.16 proud) round the block and the bay, at the walls' foot.
    base.push({ geometry: upright(plan(0.16), 0.12, 0.035, S0[0] - 0.08), matrix: new T.Matrix4() });
    // The floor bands: a bed (0.1 proud) and a weathered course (0.15 proud, over the piers' 0.08).
    for (const [y0, y1] of V.bands)
      stone.push(
        { geometry: upright(plan(0.1), 0.07, 0.02, y0), matrix: new T.Matrix4() },
        { geometry: upright(plan(0.15), y1 - y0 - 0.07, 0.04, y0 + 0.07), matrix: new T.Matrix4() },
      );
    // The cornice: the bed mould over the frieze, a modillion under the corona about every 0.34
    // (on every face and round the bay), and the corona, a mesh of its own (not a band), so its
    // eave shades the frieze under it.
    const C = V.cornice;
    stone.push({ geometry: upright(plan(0.09), C.bed[1] - C.bed[0], 0.025, C.bed[0]), matrix: new T.Matrix4() });
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
      stone.push({ geometry: upright(plan(0.04), C.modillions[1] - C.modillions[0], 0.015, C.modillions[0]), matrix: new T.Matrix4() });
    }
    // (Over the bay the corona runs out past the main roof's eave; the bay's own roof covers it.)
    parts(shell, [{ geometry: upright(plan(C.proud), C.corona[1] - C.corona[0], 0.045, C.corona[0]), matrix: new T.Matrix4() }], L.stone, 'stone', { band: false, name: 'sky-villa-corona' });

    /* -------------------------------------------------------------- */
    /* Windows                                                         */
    /* -------------------------------------------------------------- */
    /**
     * A tall sash window on a face (local +z out of the wall), its opening w x h about (x, y): a
     * white frame 0.07 wide and 0.09 proud, two panes (one light at night, `group`) and a meeting
     * rail 0.07 square; a white stone architrave 0.1 wide and 0.11 proud round it, a keystone at its
     * head, and (`sill`) a sill on two corbels under it.
     */
    function sashWindow(g: T.Object3D, x: number, y: number, w: number, h: number, group: string, sill = false) {
      frameRing(g, x, y, 0, w, h, 0.07, 0.09, L.paint, 'paint');
      const ph = (h - 0.07) / 2 + 0.01;
      for (const s of [-1, 1]) pane(g, x, y + (s * (h + 0.07)) / 4, 0.03, w + 0.02, ph, group, true);
      bars.push(block(x - w / 2, x + w / 2, y - 0.035, y + 0.035, 0.0, 0.08, g));
      frameRing(g, x, y, 0, w + 0.14, h + 0.14, 0.1, 0.11, L.stone, 'stone');
      const head = y + h / 2 + 0.17;
      stone.push({ geometry: keystone(0.14, 0.2, 0.2, 0.15), matrix: on(g, placed(x, head - 0.06, 0)) });
      if (sill) {
        const foot = y - h / 2 - 0.17;
        stone.push(block(x - w / 2 - 0.25, x + w / 2 + 0.25, foot - 0.09, foot, 0, 0.2, g));
        for (const s of [-1, 1]) stone.push(block(x + s * (w / 2 + 0.12) - 0.05, x + s * (w / 2 + 0.12) + 0.05, foot - 0.21, foot - 0.09, 0, 0.13, g));
      }
    }
    /** The storeys' sash openings: width, height and middle, the ground floor's tallest. */
    const SASH: [number, number, number][] = [
      [0.7, 1.02, 1.36],
      [0.68, 0.9, 2.88],
      [0.64, 0.74, 4.34],
    ];
    const windowX = (bay.hw + proud + hw - cw + proud) / 2; // the front's, midway between the bay's piers and the corners'
    SASH.forEach(([w, h, y], s) => {
      for (const sx of [-1, 1]) {
        sashWindow(frontFace, sx * windowX, y, w, h, `${id}-front-${s}-${sx < 0 ? 'w' : 'e'}`, s === 0);
        // The sides: two a storey (face x toward the back on the east, the front on the west).
        for (const [k, z] of [-1.805, -0.085].entries()) sashWindow(sx > 0 ? east : west, sx > 0 ? -z : z, y, w, h, `${id}-side-${s}-${sx < 0 ? 'w' : 'e'}-${k}`, s === 0);
      }
      // The back: three a storey.
      for (const x of [-1.8, 0, 1.8]) sashWindow(backFace, x, y, w, h, `${id}-back-${s}-${x}`, s === 0);
    });

    /* -------------------------------------------------------------- */
    /* The bay: French doors on each floor, balconies above            */
    /* -------------------------------------------------------------- */
    /**
     * White-framed French doors on the bay's front, w wide from the sill y0: two glazed leaves to
     * `leaves` over white kick panels, a meeting stile, a transom and a fanlight to y1, in a white
     * frame 0.08 wide, all one light at night; a white stone architrave (jambs and a head, open at
     * the foot) and a keystone rising into the band over it. The panes are tagged `frenchDoor`.
     * The ground floor's are the front door: its light is the hall's ('entrance', on all night), and
     * a brass knob sits on its meeting stile (on the white stile, not over the glass).
     */
    function frenchDoors(s: number, w: number, y0: number, leaves: number, y1: number) {
      const g = bayFace,
        group = `${id}-bay-${s}`,
        f = 0.08,
        kick = 0.24,
        cy = (y0 + y1) / 2,
        glazing: T.Mesh[] = [];
      frameRing(g, 0, cy, 0, w, y1 - y0, f, 0.1, L.paint, 'paint', false, true);
      const leafW = w / 2 - 0.045;
      for (const sx of [-1, 1]) {
        const x = (sx * (w / 2 + 0.045)) / 2;
        glazing.push(pane(g, x, (y0 + kick + leaves) / 2, 0.03, leafW + 0.02, leaves - y0 - kick + 0.01, group));
        paint.push(block(x - leafW / 2, x + leafW / 2, y0, y0 + kick, -0.0, 0.07, g));
      }
      glazing.push(pane(g, 0, (leaves + 0.08 + y1) / 2, 0.03, w + 0.02, y1 - leaves - 0.08 + 0.01, group));
      for (const p of glazing) {
        p.userData.frenchDoor = true;
        if (s === 0) p.userData.window = VILLA_ENTRANCE;
      }
      bars.push(block(-0.045, 0.045, y0, leaves, 0, 0.09, g), block(-w / 2, w / 2, leaves, leaves + 0.08, 0, 0.09, g));
      if (s === 0) brass.push({ geometry: new T.IcosahedronGeometry(0.045, 1), matrix: on(g, placed(0, y0 + 0.78, 0.105)) });
      // The architrave: jambs 0.12 wide and 0.1 proud from the sill, a head over the frame, a keystone.
      const head = y1 + f;
      for (const sx of [-1, 1]) stone.push(block(sx < 0 ? -w / 2 - f - 0.12 : w / 2 + f, sx < 0 ? -w / 2 - f : w / 2 + f + 0.12, y0, head + 0.12, -0.02, 0.11, g));
      stone.push(block(-w / 2 - f - 0.12, w / 2 + f + 0.12, head, head + 0.12, -0.02, 0.11, g));
      stone.push({ geometry: keystone(0.16, 0.22, 0.24, 0.16), matrix: on(g, placed(0, head + 0.02, 0)) });
    }
    // Each pair's architrave stops at the bay's piers (x 0.73).
    frenchDoors(0, 1.04, S0[0], 1.62, 1.86);
    frenchDoors(1, 1.0, S1[0] + 0.02, 3.16, 3.38);
    frenchDoors(2, 0.92, S2[0] + 0.02, 4.5, 4.7);
    /**
     * A balcony on the bay at the floor y (its slab's top, 0.02 over the band it grows from): a white
     * stone slab 0.12 thick and `out` deep (an overhang: it shades the wall under it) on two consoles
     * under the door's jambs; on it the pierced iron front and returns (railPlate) and the handrail.
     */
    function balcony(y: number, half: number, out: number, consoleX: number) {
      const z0 = bayFront,
        z1 = bayFront + out;
      const slab = box(shell, 0, y - 0.06, (z0 + z1) / 2 - 0.01, 2 * half, 0.12, out + 0.02, L.stone, 'stone', { bevel: 0.03 });
      slab.name = 'sky-villa-balcony';
      // Two consoles: a scroll profile 0.12 wide, 0.36 out at its top, dying into the wall 0.34 down.
      const profile: [number, number][] = [[0, 0], [0, -0.34], [0.06, -0.33], [0.13, -0.24], [0.2, -0.1], [0.32, -0.05], [0.36, 0]];
      for (const sx of [-1, 1])
        stone.push({ geometry: prism(profile.map(([zz, yy]): [number, number] => [zz, yy]), 0.12, 0.02, -0.06), matrix: placed(sx * consoleX, y - 0.12, z0, 0, -Math.PI / 2, 0) });
      const rail = RAIL.tall,
        [rh, rd] = RAIL.rail;
      iron.push({ geometry: railPlate(2 * half - 0.1), matrix: placed(0, y, z1 - 0.07) });
      iron.push(block(-half + 0.02, half - 0.02, y + rail, y + rail + rh, z1 - 0.07 - rd / 2, z1 - 0.07 + rd / 2));
      for (const sx of [-1, 1]) {
        const x = sx * (half - 0.07),
          len = out - 0.07 - 0.04;
        iron.push({ geometry: railPlate(len), matrix: placed(x, y, z0 + 0.04 + len / 2, 0, Math.PI / 2, 0) });
        iron.push(block(x - rd / 2, x + rd / 2, y + rail, y + rail + rh, z0 + 0.02, z1 - 0.07));
      }
    }
    balcony(S1[0] + 0.02, 0.86, 0.5, 0.67);
    balcony(S2[0] + 0.02, 0.8, 0.46, 0.62);

    /* -------------------------------------------------------------- */
    /* The wall lamps                                                  */
    /* -------------------------------------------------------------- */
    // On each lamp-carrying pier's face: an iron housing 0.12 wide and 0.2 tall, its cream lenses
    // over and under it lit with the wash (`glow`).
    shell.children.slice().forEach((o) => {
      const w = o.userData.wash as Wash | undefined;
      if (!w || w.glow) return;
      iron.push(block(w.x - 0.06, w.x + 0.06, w.y - 0.1, w.y + 0.1, w.z - 0.01, w.z + 0.08));
      for (const s of [-1, 1]) {
        const lens = box(shell, w.x, w.y + s * 0.135, w.z + 0.04, 0.14, 0.07, 0.1, L.paint, 'paint', { bevel: 0 });
        lens.castShadow = false;
        lens.userData.noShadow = true;
        const glow: Wash = { ...w, strength: VILLA_LAMPS.lens, glow: true };
        lens.userData.wash = glow;
      }
    });

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
    // A roll on each hip, from just up from the eave's corner (so its end stays over the corona and
    // inside the footprint) to the flat's.
    for (let i = 0; i < 4; i++) {
      const foot = new T.Vector3(hip.eave[i][0], hip.y1 - 0.02, hip.eave[i][1]),
        head = new T.Vector3(hip.flat[i][0], hip.y2 + 0.02, hip.flat[i][1]);
      rolls.push(rodPart(foot.clone().lerp(head, 0.07), head, 0.07));
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
    // The flat over the top, in the slopes' slate (a level face, so plain) inside a rim of the hips'
    // lighter rolls, which the hip rolls run up to, and rolls across it about every 1.2. (In lead, a
    // darker grey, it read from the town's height as a lid as big as a slope; rolls every 0.8 striped
    // it like a metal deck.)
    {
      const fx0 = hip.flat[0][0],
        fx1 = hip.flat[1][0],
        fz0 = hip.flat[0][1],
        fz1 = hip.flat[2][1];
      flat.push(block(fx0 - 0.05, fx1 + 0.05, hip.y2 - 0.02, hip.y2 + 0.07, fz0 - 0.05, fz1 + 0.05));
      for (const [a, b, c, d] of [[fx0 - 0.05, fx1 + 0.05, fz0 - 0.05, fz0 + 0.07], [fx0 - 0.05, fx1 + 0.05, fz1 - 0.07, fz1 + 0.05], [fx0 - 0.05, fx0 + 0.07, fz0 + 0.07, fz1 - 0.07], [fx1 - 0.07, fx1 + 0.05, fz0 + 0.07, fz1 - 0.07]])
        rolls.push(block(a, b, hip.y2 + 0.07, hip.y2 + 0.15, c, d));
      const n = Math.max(2, Math.round((fx1 - fx0) / 1.2));
      for (let k = 1; k < n; k++) {
        const x = fx0 + ((fx1 - fx0) * k) / n;
        rolls.push(block(x - 0.04, x + 0.04, hip.y2 + 0.07, hip.y2 + 0.14, fz0 + 0.07, fz1 - 0.07));
      }
    }
    /** The front slope's height at z (from the eave's top to the flat). */
    const slopeAt = (z: number) => hip.y1 + ((z1 - z) * R.rise) / R.run;
    /**
     * A square white dormer on the front slope, centred at x, its front at `zf`: a white painted
     * body running back into the slope, a sash (or a pair, `pair`) in its front and a white crown
     * round its head (an overhang: it shades the window under it).
     */
    function dormer(k: number, x: number, w: number, pair: boolean) {
      const zf = 1.05,
        head = 6.6,
        zb = z1 - ((head + 0.12 - hip.y1) * R.run) / R.rise,
        y0 = slopeAt(zf) - 0.12,
        g = faceAt(shell, x, zf, 0),
        group = `${id}-dormer-${k}`;
      paint.push(block(x - w / 2, x + w / 2, y0, head, zb, zf));
      const [sw, sh, sy] = [pair ? 0.36 : 0.4, 0.44, 6.24];
      if (pair) {
        for (const sx of [-1, 1]) {
          const cx = sx * (sw / 2 + 0.06);
          frameRing(g, cx, sy, 0, sw, sh, 0.07, 0.09, L.paint, 'paint');
          for (const s of [-1, 1]) pane(g, cx, sy + (s * (sh + 0.07)) / 4, 0.03, sw + 0.02, (sh - 0.07) / 2 + 0.01, group, true);
          bars.push(block(cx - sw / 2, cx + sw / 2, sy - 0.035, sy + 0.035, 0, 0.08, g));
        }
      } else {
        frameRing(g, 0, sy, 0, sw, sh, 0.07, 0.09, L.paint, 'paint');
        for (const s of [-1, 1]) pane(g, 0, sy + (s * (sh + 0.07)) / 4, 0.03, sw + 0.02, (sh - 0.07) / 2 + 0.01, group, true);
        bars.push(block(-sw / 2, sw / 2, sy - 0.035, sy + 0.035, 0, 0.08, g));
      }
      // The sill under the window. The crown: a white stone cornice round the head, 0.14 tall and
      // 0.06 proud of the front and cheeks, a mesh of its own so batch() takes it for the dormer's
      // overhang, and on it a slate flat inside a 0.05 rim; both run back into the slope. (Lids of
      // lead or slate that overhung the cornice sat on the slope like grey boxes.)
      stone.push(block(-w / 2 + 0.04, w / 2 - 0.04, sy - sh / 2 - 0.15, sy - sh / 2 - 0.07, 0, 0.1, g));
      const crown = box(shell, x, head, (zb + zf + 0.06) / 2, w + 0.12, 0.14, zf + 0.06 - zb, L.stone, 'stone', { bevel: 0.025 });
      crown.name = 'sky-villa-dormer-crown';
      flat.push(block(x - w / 2 + 0.01, x + w / 2 - 0.01, head + 0.03, head + 0.1, zb + 0.02, zf + 0.01));
    }
    dormer(0, 0, 1.24, true);
    for (const sx of [-1, 1]) dormer(sx < 0 ? 1 : 2, sx * windowX, 0.64, false);
    // The stacks at both ends, rising through the end slopes from just inside the eaves to over the
    // flat (their long side across the house, so the cans stand in a row seen from the front, not
    // one behind another): brick with a white cope and necking band, three cans each. (A third
    // white band, at the flat's level, striped the short shaft over the roof.)
    for (const sx of [-1, 1]) {
      const { x, z, w, d, top } = V.chimney;
      stack(shell, sx * x, z, 5.6, top, { colour: L.brick, dress: L.stone, kind: 'brick', w, d, heights: sx < 0 ? [1, 1.12, 0.94] : [1.08, 0.94, 1.1] });
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
      // Its walls: one buff stone mass from the foot to under the flags, the flags 0.07 thick with a
      // 0.04 nosing (a surface, not an overhang).
      const body = box(shell, 0, (V.foot + top - 0.07) / 2, (tz0 + tz1) / 2, 2 * tw, top - 0.07 - V.foot, tz1 - tz0, L.base, 'ashlar', { bevel: 0.04 });
      body.name = 'sky-villa-terrace';
      const flags = box(shell, 0, top - 0.035, (tz0 + tz1 + 0.04) / 2, 2 * tw + 0.08, 0.07, tz1 - tz0 + 0.04, L.paving, 'paving', { bevel: 0 });
      flags.userData.band = true;
      flags.name = 'sky-villa-flags';
      // The steps down at its centre, between sloping cheek walls: risers of buff stone under nosed
      // treads, the top one the terrace's own edge.
      const { hw: shw, run, risers } = TR.steps,
        rise = top / risers,
        treads: Part[] = [];
      for (let i = 1; i < risers; i++) {
        const tread = top - i * rise,
          out = i * run;
        const step = box(shell, 0, (V.foot + tread - 0.06) / 2, tz1 - 0.05 + (out + 0.05) / 2, 2 * shw, tread - 0.06 - V.foot, out + 0.05, L.base, 'stone', { bevel: 0.03 });
        step.name = 'sky-villa-steps';
        treads.push(block(-shw - 0.02, shw + 0.02, tread - 0.07, tread, tz1 - 0.05, tz1 + out + 0.03));
      }
      base.push(...treads);
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
      }
      // The balustrade (white stone) on the flags: a base, turned balusters about every 0.25 and a
      // coping, between dies with caps; balls on the dies that flank the steps.
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
        dies: [number, number][] = [[-ex, rz], [ex, rz], [-(shw + 0.12), rz], [shw + 0.12, rz], [-ex, front + 0.3], [ex, front + 0.3]];
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
      const at = (x: number, z: number) => new T.Vector3(x, 0, z);
      for (const sx of [-1, 1]) {
        runOf(at(sx * (shw + 0.12 + die / 2), rz), at(sx * (ex - die / 2), rz));
        runOf(at(sx * ex, rz - die / 2), at(sx * ex, front + 0.3 + die / 2));
      }
      for (const [x, z] of dies) {
        stone.push(block(x - die / 2, x + die / 2, by, copeY + 0.09, z - die / 2, z + die / 2));
        stone.push(block(x - die / 2 - 0.04, x + die / 2 + 0.04, copeY + 0.09, copeY + 0.16, z - die / 2 - 0.04, z + die / 2 + 0.04));
      }
      for (const sx of [-1, 1])
        stone.push(
          { geometry: new T.CylinderGeometry(0.07, 0.09, 0.08, 12), matrix: placed(sx * (shw + 0.12), copeY + 0.2, rz) },
          { geometry: new T.SphereGeometry(0.12, 14, 10), matrix: placed(sx * (shw + 0.12), copeY + 0.36, rz) },
        );
    }

    parts(shell, stone, L.stone, 'stone', { tone: 0.05 });
    parts(shell, base, L.base, 'stone', { tone: 0.05 });
    parts(shell, paint, L.paint, 'paint');
    parts(shell, bars, L.paint, 'paint', { shadow: false });
    parts(shell, iron, L.iron, 'iron', { shadow: false });
    parts(shell, brass, L.brass, 'brass', { shadow: false });
    parts(shell, flat, L.slate, 'slate');
    parts(shell, rolls, L.roll, 'slate');
  }
  return { buildSkyVilla };
}
export type SkyVilla = ReturnType<typeof createSkyVilla>;
