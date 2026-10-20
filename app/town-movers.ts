import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SurfaceKind } from './city-materials';
import { palette, type TownContext } from './town-shared';
import type { Kit } from './town-kit';
import { mouldedBlock, type Moulding } from './town-sculpt';

/* ------------------------------------------------------------------ */
/* Shapes the vehicles are made of                                     */
/* ------------------------------------------------------------------ */
/** Undergear, bumpers, lamp housings and the winch: painted dark iron, a shade off the street iron. */
const UNDERGEAR = '#3a3f44';
/**
 * A stadium plan (half-width hx, half-length hz: a box with half-round ends) swept up a moulding
 * profile: mouldedBlock with corners as round as the block is wide, so every ring is a stadium
 * inset by its step's s and the straight sides keep one length. Closed on top, open below.
 */
function stadium(hx: number, hz: number, profile: Moulding[], arc = 10) {
  return mouldedBlock(hx, hz, profile, hx, arc);
}
/**
 * A window post for a round-ended body, w wide and h tall on y 0, d deep out along +z, with a
 * concave quarter-round fillet of radius f at each of its four corners: set between a sill and a
 * header rail, the openings either side of it get rounded corners. Bevelled by b (which also
 * fattens its outline by b).
 */
function filletPost(w: number, h: number, f: number, d: number, b: number) {
  const s = new T.Shape(),
    x = w / 2;
  s.moveTo(-x - f, 0);
  s.lineTo(x + f, 0);
  s.absarc(x + f, f, f, -Math.PI / 2, Math.PI, true);
  s.lineTo(x, h - f);
  s.absarc(x + f, h - f, f, Math.PI, Math.PI / 2, true);
  s.lineTo(-x - f, h);
  s.absarc(-x - f, h - f, f, Math.PI / 2, 0, true);
  s.lineTo(-x, f);
  s.absarc(-x - f, f, f, 0, -Math.PI / 2, true);
  return frontOnly(new T.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 3 }), 0);
}
/** An extrusion without its hidden back: the triangles lying wholly at or behind z = back (its back cap and back bevel, set into a wall). */
function frontOnly(g: T.BufferGeometry, back: number) {
  const plain = g.index ? g.toNonIndexed() : g,
    p = plain.getAttribute('position'),
    keep: number[] = [];
  for (let i = 0; i < p.count; i += 3) if (Math.max(p.getZ(i), p.getZ(i + 1), p.getZ(i + 2)) > back + 1e-6) keep.push(i, i + 1, i + 2);
  const out = new T.BufferGeometry();
  for (const name of ['position', 'normal']) {
    const a = plain.getAttribute(name);
    out.setAttribute(name, new T.Float32BufferAttribute(keep.flatMap((i) => [a.getX(i), a.getY(i), a.getZ(i)]), 3));
  }
  g.dispose();
  if (plain !== g) plain.dispose();
  return out;
}
/** A rounded rectangle (w x h, corner radius r) about the origin, as a path (for a frame's outline or its hole). */
function roundedRect(path: T.Path, w: number, h: number, r: number) {
  const x = w / 2, y = h / 2;
  path.moveTo(-x + r, -y);
  path.lineTo(x - r, -y);
  path.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
  path.lineTo(x, y - r);
  path.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
  path.lineTo(-x + r, y);
  path.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
  path.lineTo(-x, -y + r);
  path.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
  return path;
}
/**
 * A frame: a rounded rectangle (w x h, corners r) with a rounded hole (iw x ih, corners ir), d
 * deep out along +z and bevelled by b (none at 0), about its middle; `curve` segments a corner.
 * Its back (z 0 and behind) is left off: frames are set on a face.
 */
function frameGeometry(w: number, h: number, r: number, iw: number, ih: number, ir: number, d: number, b: number, curve = 3) {
  const shape = roundedRect(new T.Shape(), w, h, r) as T.Shape;
  shape.holes.push(roundedRect(new T.Path(), iw, ih, ir));
  return frontOnly(new T.ExtrudeGeometry(shape, { depth: d, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: curve }), 0);
}
/**
 * A profile (radius, height) swept round the y axis from angle a0 to a1 (0 is +z, a quarter turn
 * +x, as a lathe turns), its reach beyond rIn eased to nothing over the last `ease` of each end,
 * so a band laid round a round end dies into the body instead of stopping on an open section.
 */
function endBand(profile: [number, number][], a0: number, a1: number, n: number, rIn: number, ease: number) {
  const pos: number[] = [], idx: number[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n,
      a = a0 + (a1 - a0) * t,
      e = T.MathUtils.smoothstep(Math.min(t, 1 - t), 0, ease);
    for (const [r, y] of profile) {
      const rr = rIn + (r - rIn) * e;
      pos.push(rr * Math.sin(a), y, rr * Math.cos(a));
    }
  }
  const m = profile.length;
  for (let k = 0; k < n; k++)
    for (let j = 0; j < m - 1; j++) {
      const a = k * m + j, b = a + m;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** Merge geometries (positions and normals only) into one, as one part. */
function mergeParts(list: T.BufferGeometry[]) {
  const plain = list.map((g) => {
    const p = g.index ? g.toNonIndexed() : g.clone();
    for (const name of Object.keys(p.attributes)) if (name !== 'position' && name !== 'normal') p.deleteAttribute(name);
    if (!p.getAttribute('normal')) p.computeVertexNormals();
    return p;
  });
  const merged = mergeGeometries(plain, false)!;
  for (const g of [...list, ...plain]) g.dispose();
  return merged;
}
/** A geometry placed: turned by ry about y (then rx about x), moved to (x, y, z). */
function placed(g: T.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0) {
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  return g.translate(x, y, z);
}

/* ------------------------------------------------------------------ */
/* Vehicles and people                                                 */
/* ------------------------------------------------------------------ */
/**
 * The balloon's beat, out over the west shore and the sea, so it stays out of every chapter's
 * subject. On the opening view it hangs in the open band between the masthead and the hero
 * copy, under the gap between the wordmark and the nav pill, and drifts to and fro across the
 * frame there: from its anchor `at` (an angle on a ring of `radius` round the island) up to
 * 2 x `reach` along the opening view's screen-left, which leaves its height in the frame alone
 * (along the ring there it would mostly rise and sink), easing to a stop at each end. `rate` is
 * the swing's pace (radians of its phase per second), `height` its basket's height and `bob`
 * how far it rises and sinks. It never leaves the frame: a long swing round the far side climbed
 * out of the top of the frame between its rests, through the masthead, and on short wide
 * screens (1280 x 720) its rests sat behind the frosted tools pill or the nav pill, or dipped
 * behind the hero copy and the News card. It also turns with the camera's idle drift
 * (followDrift), which would otherwise swing it up and down the frame by about 50 px.
 */
export const BALLOON = { radius: 32, at: 2.58, reach: 1.3, rate: 0.02, height: 12.8, bob: 0.3 };
/**
 * Turn a sky object with the camera's idle drift: by `drift` about the vertical line through
 * the view's centre `target`, so it holds its place in the frame while the town turns beneath
 * it. Call it after the object's own update each frame.
 */
export function followDrift(object: T.Object3D, target: T.Vector3, drift: number) {
  if (!drift) return;
  const c = Math.cos(drift),
    s = Math.sin(drift),
    x = object.position.x - target.x,
    z = object.position.z - target.z;
  object.position.x = target.x + x * c + z * s;
  object.position.z = target.z - x * s + z * c;
  object.rotation.y += drift;
}
/**
 * How much darker the balloon's own colours go at full night. It is lit like the town, but it
 * is the one big, pale, round thing hanging unshadowed over the darkest part of the frame, with
 * no ground under it to darken its foot: under the same moonlight its cream gores still read
 * as bright as by day against the night sea. Dimmed this far it sits with the town's moonlit
 * walls. No glow and no burner light.
 */
export const BALLOON_NIGHT_DIM = 0.5;

export function createMovers(ctx: TownContext, kit: Kit) {
  const { material, lamps, animated } = ctx;
  const { box, cylinder, strut, hullShape, hullSolid, lampGlass } = kit;
  function hotAirBalloon(g: T.Object3D) {
    const b = new T.Group();
    g.add(b);
    // A teardrop envelope lathed from the mouth (y 0) to the crown (y 4.1), with 12 crisp gores.
    const prof = [[0, 0], [0.3, 0.02], [0.42, 0.3], [0.75, 0.9], [1.25, 1.6], [1.55, 2.3], [1.6, 2.75], [1.48, 3.25], [1.15, 3.7], [0.62, 4.0], [0, 4.1]].map(
      ([r, y]) => new T.Vector2(r, y),
    );
    const lathe = new T.LatheGeometry(prof, 24).toNonIndexed(),
      pos = lathe.getAttribute('position'),
      col = new Float32Array(pos.count * 3),
      stripe = [new T.Color(palette.balloon), new T.Color(palette.balloonBand)];
    for (let i = 0; i < pos.count; i += 3) {
      const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3,
        cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      const c = stripe[Math.floor(((Math.atan2(cx, cz) + Math.PI) / (Math.PI * 2)) * 12) % 2];
      for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
    }
    lathe.setAttribute('color', new T.BufferAttribute(col, 3));
    const envelope = new T.Mesh(lathe, material('#ffffff', 'fabric'));
    envelope.position.y = 0.95;
    envelope.receiveShadow = true;
    b.add(envelope);
    cylinder(b, 0, 5.0, 0, 0.5, 0.62, 0.12, palette.gold, 'fabric', 18); // crown cap
    box(b, 0, 0.2, 0, 0.7, 0.5, 0.7, palette.wood, 'wood'); // basket
    box(b, 0, 0.47, 0, 0.8, 0.1, 0.8, palette.woodDark, 'wood'); // rim
    // Rope tops end inside the mouth (r 0.32 there).
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        strut(b, new T.Vector3(sx * 0.32, 0.5, sz * 0.32), new T.Vector3(sx * 0.17, 1.02, sz * 0.17), 0.035, palette.woodDark, 'wood');
    // No shadow: from its beat off the west shore the sun lays it on the beach behind the
    // terrace, where it reads as a dark blot in the People chapter rather than as a balloon.
    b.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.castShadow = false;
        o.userData.noShadow = true;
      }
    });
    b.userData.keepSeparate = true;
    b.userData.followsDrift = true; // city-scene turns it with the idle drift (followDrift)
    /**
     * The balloon's batched meshes take their own copies of the shared batch materials (the same
     * shader program), so their colour can follow the night without darkening everything else
     * made of fabric or wood.
     */
    function dim(night: number) {
      const f = 1 - BALLOON_NIGHT_DIM * night;
      for (const part of b.children) {
        if (!(part instanceof T.Mesh) || !(part.material instanceof T.MeshStandardMaterial) || !part.material.vertexColors) continue;
        if (!part.material.userData.balloonOwn) {
          const shared = part.material,
            own = shared.clone();
          own.onBeforeCompile = (shader, renderer) => shared.onBeforeCompile(shader, renderer);
          own.customProgramCacheKey = () => shared.customProgramCacheKey();
          own.userData.balloonOwn = true;
          part.material = own;
        }
        part.material.color.setScalar(f);
      }
    }
    animated.push({
      object: b,
      update(time, night) {
        dim(night);
        // To and fro across the opening view's open band over the west shore and the sea, so it
        // never drifts across a chapter's subject or out of that band; it eases to a stop at each
        // end, as in a lull, and turns back.
        const a = BALLOON.at,
          across = BALLOON.reach * (Math.cos(time * BALLOON.rate) - 1), // 0 to -2 reach, along screen-right
          r = Math.SQRT1_2;
        // The crown stays at about 17.9; the gulls fly below 10.7.
        b.position.set(
          Math.cos(a) * BALLOON.radius + across * r,
          BALLOON.height + Math.sin(time * 0.4) * BALLOON.bob,
          Math.sin(a) * BALLOON.radius - across * r,
        );
        b.rotation.y = -a;
        b.rotation.z = Math.sin(time * 0.6) * 0.03;
      },
    });
    return b;
  }

  /** One mesh of `geometry` in g, casting and receiving unless `noShadow`. */
  function part(g: T.Object3D, geometry: T.BufferGeometry, colour: string, kind: SurfaceKind, noShadow = false) {
    const m = new T.Mesh(geometry, material(colour, kind));
    m.castShadow = !noShadow;
    m.receiveShadow = true;
    if (noShadow) m.userData.noShadow = true;
    g.add(m);
    return m;
  }
  /**
   * The tram's measures (local units: +z forward, y 0 the rail head). The body is a stadium
   * TRAM.half wide with half-round ends about z ±TRAM.straight; the bogies sit at ±TRAM.bogie
   * (plan's TRAM_BOGIE) on wheels over the rails at x ±TRAM.gauge; the headlamp housings' rims
   * are its nose (plan's TRAM_DRIVE.nose).
   */
  const TRAM = { half: 0.6, straight: 1.26, bogie: 1.1, gauge: 0.42, wheel: 0.12, wheelbase: 0.5, nose: 1.89 };
  /**
   * A Glasgow Corporation 'Coronation'-style single-deck car in the Corporation's orange, green and
   * cream. The body is swept up moulded profiles round its half-round ends: a green bottom rail,
   * orange lower panels with a slight tumblehome, a proud green waist rail, a cream sill, wrap-round
   * glazing between cream window posts whose filleted corners round every opening, a cream header
   * rail and a green domed roof with a rain-strip eave, a cream roof board and a blank destination
   * box on the dome at either end. A framed, glazed door at each corner over a dark step; at each
   * end a dark wrap-round bumper, the lifeguard's tray under it and a headlamp in a drum housing; under
   * it two bogies with visible wheels on the rails, side frames and axle boxes. The trolley pole
   * rises aft from a sprung base on the roof board to its wheel. Nothing on it is lettered.
   */
  function buildTram() {
    const tram = new T.Group();
    tram.name = 'tram';
    const orange = palette.tramOrange, green = palette.tram, cream = palette.tramCream,
      { half: R, straight: az } = TRAM,
      hz = az + R;
    const body = (profile: Moulding[], colour: string, kind: SurfaceKind = 'enamel', arc = 8) =>
      part(tram, stadium(R, hz, profile, arc), colour, kind);
    // The body, foot to roof (s is the inset from the 0.6 half-width).
    body([{ s: 0.12, y: 0.22 }, { s: 0.07, y: 0.245 }, { s: 0.05, y: 0.27 }, { s: 0.05, y: 0.3 }, { s: 0.07, y: 0.32 }], green); // bottom rail
    body([{ s: 0.075, y: 0.3 }, { s: 0.068, y: 0.4 }, { s: 0.062, y: 0.55 }, { s: 0.062, y: 0.75 }], orange); // lower panels
    body([{ s: 0.07, y: 0.73 }, { s: 0.045, y: 0.75 }, { s: 0.035, y: 0.78 }, { s: 0.035, y: 0.82 }, { s: 0.045, y: 0.85 }, { s: 0.07, y: 0.87 }], green); // waist rail
    body([{ s: 0.07, y: 0.86 }, { s: 0.06, y: 0.88 }, { s: 0.06, y: 0.92, sharp: true }, { s: 0.11, y: 0.935 }], cream); // sill
    body([{ s: 0.11, y: 1.3 }, { s: 0.06, y: 1.315, sharp: true }, { s: 0.06, y: 1.38 }, { s: 0.08, y: 1.39 }], cream); // header rail
    body([
      { s: 0.08, y: 1.38 }, { s: 0.01, y: 1.395 }, { s: 0, y: 1.42 }, { s: 0.01, y: 1.445 }, { s: 0.05, y: 1.46, sharp: true }, // rain-strip eave
      { s: 0.07, y: 1.49 }, { s: 0.12, y: 1.54 }, { s: 0.19, y: 1.58 }, { s: 0.27, y: 1.605 }, { s: 0.33, y: 1.615 },
    ], green, 'enamel', 10); // domed roof
    part(tram, stadium(0.25, 1.2, [{ s: 0.02, y: 1.58 }, { s: 0, y: 1.6 }, { s: 0, y: 1.66, sharp: true }, { s: 0.035, y: 1.69 }], 6), cream, 'enamel'); // roof board
    // Glazing: one wrap-round band behind the posts, and the doors' lights, as one pane.
    const glass: T.BufferGeometry[] = [stadium(R, hz, [{ s: 0.11, y: 0.92 }, { s: 0.11, y: 1.31 }], 10)];
    // Window posts on the glazing's face (0.49 out): three bays a side between the doors, three
    // lights round each end (a quarter light either side of the windscreen).
    const posts: T.BufferGeometry[] = [],
      rg = R - 0.11,
      post = () => filletPost(0.09, 0.39, 0.05, 0.035, 0.012).translate(0, 0.925, -0.01);
    for (const sx of [-1, 1]) for (const z of [-0.8, -0.27, 0.27, 0.8]) posts.push(placed(post(), sx * rg, 0, z, (sx * Math.PI) / 2));
    for (const ez of [-1, 1])
      for (const a of [0, 0.9, Math.PI - 0.9, Math.PI]) {
        const nx = Math.cos(a), nz = ez * Math.sin(a);
        posts.push(placed(post(), rg * nx, 0, ez * az + rg * nz, Math.atan2(nx, nz)));
      }
    part(tram, mergeParts(posts), cream, 'enamel');
    // Doors at the four corners: a cream frame, a green leaf with a big light over a panel, a dark step.
    const frames: T.BufferGeometry[] = [], leaves: T.BufferGeometry[] = [], steps: T.BufferGeometry[] = [];
    for (const sx of [-1, 1])
      for (const ez of [-1, 1]) {
        const z = ez * 1.03, ry = (sx * Math.PI) / 2, at = (x: number) => sx * x;
        frames.push(placed(frameGeometry(0.4, 1.08, 0.06, 0.3, 0.99, 0.035, 0.025, 0.01, 2), at(0.555), 0.81, z, ry));
        leaves.push(
          placed(new RoundedBoxGeometry(0.3, 0.6, 0.045, 1, 0.015), at(0.552), 0.6, z, ry), // the lower panel
          placed(frameGeometry(0.3, 0.46, 0.02, 0.16, 0.32, 0.03, 0.035, 0, 2), at(0.535), 1.08, z, ry), // stiles and rails round the light
        );
        glass.push(placed(new T.BoxGeometry(0.17, 0.37, 0.02), at(0.555), 1.08, z, ry));
        steps.push(placed(new RoundedBoxGeometry(0.11, 0.07, 0.36, 1, 0.02), at(0.535), 0.215, z));
      }
    part(tram, mergeParts(frames), cream, 'enamel');
    part(tram, mergeParts(leaves), green, 'enamel');
    part(tram, mergeParts(glass), palette.glass, 'glass');
    // The ends: a destination box on the dome (a green hood round a blank cream blind), a wrap-round
    // bumper over the bottom rail, the lifeguard's tray under it, and the headlamp's drum housing.
    const hoods: T.BufferGeometry[] = [], blinds: T.BufferGeometry[] = [], dark: T.BufferGeometry[] = [];
    const bumper: [number, number][] = [[0.5, 0.25], [0.57, 0.255], [0.595, 0.275], [0.6, 0.305], [0.595, 0.335], [0.57, 0.355], [0.5, 0.36]],
      lifeguard: [number, number][] = [[0.4, 0.07], [0.49, 0.07], [0.52, 0.09], [0.53, 0.13], [0.52, 0.2], [0.4, 0.22]];
    const housing = [[0.085, 0], [0.105, 0.03], [0.105, 0.08], [0.114, 0.1], [0.1, 0.12], [0.08, 0.1]].map(([r, y]) => new T.Vector2(r, y));
    for (const ez of [-1, 1]) {
      const end = (g: T.BufferGeometry) => (ez > 0 ? g.translate(0, 0, az) : g.rotateY(Math.PI).translate(0, 0, -az));
      hoods.push(placed(new RoundedBoxGeometry(0.46, 0.17, 0.22, 1, 0.05), 0, 1.6, ez * 1.6));
      blinds.push(placed(new RoundedBoxGeometry(0.34, 0.09, 0.04, 1, 0.015), 0, 1.6, ez * 1.705));
      dark.push(end(endBand(bumper, -1.32, 1.32, 20, 0.5, 0.18)));
      dark.push(end(endBand(lifeguard, -0.95, 0.95, 12, 0.4, 0.25)));
      dark.push(placed(new T.LatheGeometry(housing, 12), 0, 0.52, ez * (TRAM.nose - 0.12), ez > 0 ? 0 : Math.PI, Math.PI / 2));
    }
    part(tram, mergeParts(hoods), green, 'enamel');
    part(tram, mergeParts(blinds), cream, 'enamel');
    part(tram, mergeParts(dark), UNDERGEAR, 'enamel');
    // Bogies: per bogie, the wheels on the rails, side frames outside them with an axle box over
    // each axle and a spring plank between, and a bolster under the body.
    for (const ez of [-1, 1]) {
      const zc = ez * TRAM.bogie, gear: T.BufferGeometry[] = [];
      for (const sx of [-1, 1]) {
        for (const dz of [-TRAM.wheelbase / 2, TRAM.wheelbase / 2]) {
          gear.push(new T.CylinderGeometry(TRAM.wheel, TRAM.wheel, 0.07, 12).rotateZ(Math.PI / 2).translate(sx * TRAM.gauge, TRAM.wheel, zc + dz)); // wheel
          gear.push(placed(new T.BoxGeometry(0.09, 0.12, 0.13), sx * 0.5, 0.13, zc + dz)); // axle box
        }
        gear.push(placed(new RoundedBoxGeometry(0.07, 0.1, 0.82, 1, 0.025), sx * 0.5, 0.2, zc)); // side frame
        gear.push(placed(new T.BoxGeometry(0.08, 0.07, 0.3), sx * 0.5, 0.115, zc)); // spring plank
      }
      gear.push(placed(new T.BoxGeometry(0.92, 0.07, 0.18), 0, 0.2, zc)); // bolster
      part(tram, mergeParts(gear), UNDERGEAR, 'iron');
    }
    part(tram, mergeParts(steps), UNDERGEAR, 'iron');
    // The trolley pole: a sprung base on the roof board, the pole rising aft, the trolley head and wheel.
    const foot = new T.Vector3(0, 1.79, 0.45), head = new T.Vector3(0, 2.33, -0.72), along = head.clone().sub(foot).normalize();
    const pole = [
      placed(new T.CylinderGeometry(0.13, 0.14, 0.05, 16), 0, 1.715, 0.45), // turntable
      placed(new RoundedBoxGeometry(0.18, 0.1, 0.34, 1, 0.03), 0, 1.79, 0.38), // spring housing
      new T.CylinderGeometry(0.035, 0.04, foot.distanceTo(head), 8)
        .applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), along))
        .translate((foot.x + head.x) / 2, (foot.y + head.y) / 2, (foot.z + head.z) / 2),
      placed(new RoundedBoxGeometry(0.1, 0.09, 0.12, 1, 0.025), head.x, head.y, head.z), // trolley head
      new T.CylinderGeometry(0.065, 0.065, 0.07, 14).rotateZ(Math.PI / 2).translate(head.x, head.y + 0.05, head.z - 0.06), // wheel
    ];
    part(tram, mergeParts(pole), palette.metal, 'iron');
    // The headlamps' lenses, set in their housings (the nose is the housings' rims).
    for (const ez of [-1, 1]) {
      const lens = new T.Mesh(new T.IcosahedronGeometry(0.08, 1).scale(1, 1, 0.4), lampGlass());
      lens.position.set(0, 0.52, ez * (TRAM.nose - 0.035));
      tram.add(lens);
      lamps.push(lens);
    }
    return tram;
  }
  /** Harbour boat: a shaped red hull sitting in the water (waterline at local 0), a wheelhouse, funnel and a mast on its roof. */
  function buildBoat() {
    const boat = new T.Group();
    boat.name = 'harbour-boat';
    const red = palette.boat, cream = palette.tramCream, wood = palette.wood, dark = palette.woodDark;
    hullSolid(boat, 0.62, 2.0, 1.45, -0.12, 0.36, 0.06, red, 'enamel'); // -0.12..0.36, waterline at local 0
    hullSolid(boat, 0.66, 2.02, 1.47, 0.34, 0.04, 0.04, cream, 'enamel'); // gunwale 0.34..0.46, 0.02 proud
    const deck = new T.Mesh(new T.ShapeGeometry(hullShape(0.56, 1.8, 1.32), 6).rotateX(-Math.PI / 2), material(wood, 'wood'));
    deck.position.y = 0.465;
    deck.receiveShadow = true;
    boat.add(deck);
    box(boat, 0, 0.83, -0.45, 0.9, 0.74, 0.85, cream, 'enamel'); // wheelhouse 0.46..1.20
    box(boat, 0, 0.95, -0.45, 0.94, 0.26, 0.89, palette.glass, 'glass'); // wrap-round windows
    box(boat, 0, 1.26, -0.45, 1.04, 0.12, 1.0, red, 'enamel'); // roof, 0.07 eave
    cylinder(boat, 0, 1.52, -0.72, 0.13, 0.15, 0.4, cream, 'enamel', 18); // funnel
    cylinder(boat, 0, 1.66, -0.72, 0.145, 0.145, 0.1, red, 'enamel', 18); // funnel band
    cylinder(boat, 0, 1.75, -0.15, 0.055, 0.065, 0.9, dark, 'wood', 18); // mast stepped ON the roof (1.30..2.20)
    box(boat, 0, 1.98, -0.15, 0.7, 0.08, 0.08, dark, 'wood'); // yard
    box(boat, 0.18, 0.62, 0.75, 0.32, 0.3, 0.32, wood, 'wood', { ry: 0.3 }); // deck cargo
    box(boat, -0.2, 0.6, 1.05, 0.26, 0.26, 0.26, palette.gold, 'paint', { ry: -0.2 });
    for (const sx of [-1, 1])
      for (const fz of [-0.6, 0.35]) {
        const f = new T.Mesh(new T.TorusGeometry(0.09, 0.045, 6, 10), material('#3a3f44', 'paint')); // fenders
        f.position.set(sx * 0.72, 0.22, fz);
        f.rotation.y = Math.PI / 2;
        f.castShadow = true;
        boat.add(f);
      }
    const buoyRing = new T.Mesh(new T.TorusGeometry(0.14, 0.05, 8, 14), material(palette.flowers[0], 'enamel'));
    buoyRing.position.set(0.5, 0.66, -0.45);
    buoyRing.rotation.y = Math.PI / 2;
    boat.add(buoyRing);
    // Bow waves: each strip's forward end hugs the stem and its aft end trails outward, just clear of the hull.
    for (const s of [-1, 1]) box(boat, s * 0.52, 0.02, 1.5, 0.12, 0.03, 0.7, '#eaf6f2', 'paint', { ry: -s * 0.5 });
    const light = lampGlass();
    const lanternMesh = new T.Mesh(new T.SphereGeometry(0.1, 12, 8), light);
    lanternMesh.position.set(0, 2.28, -0.15); // mast lantern
    boat.add(lanternMesh);
    lamps.push(lanternMesh);
    return boat;
  }
  /**
   * A town bike (local +z forward, y 0 the ground, about 0.9 long): two tyres, a diamond frame in
   * `colour`, a dark bar and saddle, a chainring on the left, and optionally a wicker basket and a
   * front lamp (a dark housing round a lantern lens the frame loop lights at night, no light or
   * halo). Matte paint, not enamel, so the thin tubes do not glint; nothing casts, since thin
   * members ghost in the shadow map.
   */
  function bicycle(g: T.Object3D, colour: string, opts: { basket?: boolean; lamp?: boolean } = {}) {
    const bike = new T.Group();
    g.add(bike);
    const rubber = '#3a3f44',
      dark = '#3b3633',
      v = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
    const parts: T.Mesh[] = [];
    for (const z of [-0.3, 0.3]) {
      const tyre = new T.Mesh(new T.TorusGeometry(0.115, 0.035, 6, 14), material(rubber, 'paint'));
      tyre.position.set(0, 0.15, z);
      tyre.rotation.y = Math.PI / 2;
      bike.add(tyre);
      parts.push(tyre);
    }
    const bb = v(0, 0.15, 0),
      seat = v(0, 0.3, -0.08),
      head = v(0, 0.4, 0.21),
      rear = v(0, 0.15, -0.3),
      front = v(0, 0.15, 0.3);
    for (const [a, b] of [[bb, seat], [seat, head], [bb, v(0, 0.37, 0.22)], [bb, rear], [seat, rear], [head, front], [head, v(0, 0.56, 0.19)]])
      parts.push(strut(bike, a, b, 0.035, colour, 'paint'));
    parts.push(box(bike, 0, 0.56, 0.2, 0.36, 0.06, 0.06, dark, 'paint')); // handlebar
    parts.push(box(bike, 0, 0.33, -0.1, 0.1, 0.06, 0.17, dark, 'paint')); // saddle
    const ring = cylinder(bike, -0.05, 0.15, 0, 0.07, 0.07, 0.04, rubber, 'paint'); // chainring, axis along x
    ring.rotation.z = Math.PI / 2;
    parts.push(ring);
    if (opts.basket) parts.push(box(bike, 0, 0.5, 0.34, 0.24, 0.16, 0.2, palette.wood, 'wood'));
    if (opts.lamp) parts.push(box(bike, 0, 0.47, 0.25, 0.08, 0.07, 0.06, dark, 'paint')); // the lamp's housing, on the stem
    for (const m of parts) {
      m.castShadow = false;
      m.receiveShadow = true;
      m.userData.noShadow = true;
    }
    if (opts.lamp) {
      // Only the lens shows, set in the housing's front: a pale ball out on its own would read
      // as a third hand by day.
      const light = new T.Mesh(new T.IcosahedronGeometry(0.035, 1).scale(1, 1, 0.5), lampGlass());
      light.position.set(0, 0.47, 0.28);
      bike.add(light);
      lamps.push(light);
    }
    return bike;
  }
  return { hotAirBalloon, buildTram, buildBoat, bicycle };
}
