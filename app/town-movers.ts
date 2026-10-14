import * as T from 'three';
import type { SurfaceKind } from './city-materials';
import { palette, type TownContext } from './town-shared';
import type { Kit } from './town-kit';

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

  /** Glasgow Corporation tram: orange, green and cream tiers with half-round ends, an eaved roof and a trolley pole. */
  function buildTram() {
    const tram = new T.Group();
    tram.name = 'tram';
    const orange = palette.tramOrange, green = palette.tram, cream = palette.tramCream, half = 1.26;
    // Each tier is a box with a half-round cylinder at either end.
    const tier = (y: number, h: number, r: number, c: string, k: SurfaceKind) => {
      box(tram, 0, y, 0, r * 2, h, half * 2, c, k);
      for (const z of [-half, half]) cylinder(tram, 0, y, z, r, r, h, c, k, 24);
    };
    tier(0.48, 0.55, 0.54, orange, 'enamel'); // 0.205..0.755
    tier(0.8, 0.1, 0.565, green, 'enamel'); // waist band
    tier(1.09, 0.48, 0.52, cream, 'enamel'); // 0.85..1.33
    tier(1.1, 0.3, 0.535, palette.glass, 'glass'); // wrap-round windows, 0.015 proud
    tier(1.4, 0.14, 0.6, green, 'enamel'); // roof 1.33..1.47, 0.08 eave
    box(tram, 0, 1.53, 0, 0.7, 0.12, 2.0, cream, 'enamel'); // clerestory 1.47..1.59
    for (const z of [-0.84, -0.28, 0.28, 0.84]) box(tram, 0, 1.1, z, 1.1, 0.32, 0.1, cream, 'enamel'); // pillars
    for (const z of [-1.1, 1.1]) box(tram, 0, 0.13, z, 0.86, 0.22, 0.9, '#3a3f44', 'iron'); // bogie skirts replace 8 wheels
    box(tram, 0, 1.65, 0.5, 0.3, 0.12, 0.3, palette.metal, 'iron'); // pole base ON the clerestory
    box(tram, 0, 1.99, -0.085, 0.07, 0.07, 1.3, palette.metal, 'iron', { rx: 0.45 }); // trolley pole, lower end at the base
    for (const z of [-1.8, 1.8]) {
      const light = lampGlass();
      const head = new T.Mesh(new T.SphereGeometry(0.09, 12, 8), light);
      head.position.set(0, 0.5, z);
      tram.add(head);
      lamps.push(head);
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
