import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCityMaterials, type SurfaceKind } from './city-materials';
import { createResident } from './city-people';
import { buildings, type BuildingId } from './city-data';
import * as plan from './town-plan';
import type { XZ } from './town-plan';
import type { Season } from './glasgow-sun';
import {
  palette,
  hash,
  sstep,
  mix,
  bandstandAt,
  paddockRuns,
  WATER,
  type TownContext,
} from './town-shared';
import { createKit } from './town-kit';
import { createBatch } from './town-batch';
import { paintByHeight, bakeRamp, createNature } from './town-nature';
import { createProps } from './town-props';
import { buildGroundMasks, createGround } from './town-ground';
import { createStreets } from './town-streets';
import { createHarbour } from './town-harbour';
import { createHomes } from './town-homes';
export { palette } from './town-shared';
export { treeLook, heatherLook } from './town-nature';
export { MASK_EXTENT, MASK_SIZE, buildGroundMasks } from './town-ground';

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

/**
 * The balloon's beat: a ring centred on the island, out over the shore and the sea, so it stays
 * out of every chapter's subject. It does not lap the ring (a lap brought it behind the hero
 * text and the News card once every seven minutes) but swings to and fro along its far side
 * as the opening view sees it, between the open top left and top right of that view, out of
 * frame above the island in between. `middle` and `reach` are angles on the ring (radians),
 * `rate` the swing's pace (radians per second, a swing there and back in about six and a
 * half minutes). It sets off from the north-east end, over the sea.
 */
export const BALLOON = { radius: 32, middle: 3.8, reach: 1.35, rate: 0.016 };

type TownOptions = {
  library?: ReturnType<typeof createCityMaterials>;
  /** Which season the trees wear (blossom, autumn tones); summer, all green, by default. */
  season?: Season;
};
export type Town = ReturnType<typeof buildTown>;

/** The whole town at once (the checks, and anything that cannot wait). */
export function buildTown(options: TownOptions = {}) {
  const phases = buildTownInPhases(options);
  for (;;) {
    const step = phases.next();
    if (step.done) return step.value;
  }
}

/**
 * The town in phases: it stops after each one (yielding the phase's name), so the page can
 * hand the main thread back to the browser between them instead of freezing for the whole
 * build. Run to the end, it returns the same town as buildTown.
 */
export function* buildTownInPhases(options: TownOptions = {}) {
  const library = options.library || createCityMaterials();
  const season = options.season ?? 'summer';
  const material = library.material;
  const city = new T.Group(),
    land = new T.Group();
  city.name = 'town';
  land.name = 'land';
  city.add(land);
  const lamps: T.Mesh[] = [],
    clocks: { hour: T.Object3D; minute: T.Object3D }[] = [],
    animated: { object: T.Object3D; update: (time: number, night: number) => void }[] = [];
  const ctx: TownContext = { library, material, season, land, lamps, clocks, animated };
  const kit = createKit(ctx), nature = createNature(ctx, kit), props = createProps(ctx, kit);
  const { buildTerrain } = createGround(ctx);
  const { buildStreets } = createStreets(ctx, kit, nature);
  const { pierAndHarbour, lighthouse } = createHarbour(ctx, kit, props);
  const { buildTerrace, buildCottage } = createHomes(kit, nature);
  const { batch } = createBatch(ctx);
  const { box, cylinder, strut, cone, sphere, hullShape, hullSolid, slabRoof, windowAt, door, plinth, lampGlass, groundY } = kit, { tree, flowerBed, topiary, moorland } = nature, { bench, lamp, phoneBox, bin, pavilion, memoryBoard, crane, picnic, wellington } = props;

  /* ---------------------------------------------------------------- */
  /* Furniture, planting, small things                                 */
  /* ---------------------------------------------------------------- */
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
    envelope.castShadow = envelope.receiveShadow = true;
    b.add(envelope);
    cylinder(b, 0, 5.0, 0, 0.5, 0.62, 0.12, palette.gold, 'fabric', 18); // crown cap
    box(b, 0, 0.2, 0, 0.7, 0.5, 0.7, palette.wood, 'wood'); // basket
    box(b, 0, 0.47, 0, 0.8, 0.1, 0.8, palette.woodDark, 'wood'); // rim
    // Rope tops end inside the mouth (r 0.32 there).
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        strut(b, new T.Vector3(sx * 0.32, 0.5, sz * 0.32), new T.Vector3(sx * 0.17, 1.02, sz * 0.17), 0.035, palette.woodDark, 'wood');
    b.userData.keepSeparate = true;
    animated.push({
      object: b,
      update(time) {
        // To and fro on the ring's far side, out over the shore and the sea, so it never drifts
        // across a chapter's subject or comes down past the hero text; it eases to a stop at
        // each end, as in a lull, and turns back.
        const a = BALLOON.middle + BALLOON.reach * Math.cos(time * BALLOON.rate);
        // The crown stays at about 17.9; the gulls fly below 10.7.
        b.position.set(Math.cos(a) * BALLOON.radius, 12.8 + Math.sin(time * 0.4) * 0.5, Math.sin(a) * BALLOON.radius);
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
    // One solid arch mass: piers, spandrels and entablature are a single bevelled extrusion, so no
    // light shows between the piers and the attic. Red and cream voussoirs, battered plinths.
    const W = 2.2,
      D = 1.5,
      r = 0.95,
      foot = 0.45,
      spring = 2.45,
      top = 4.2,
      b = 0.1,
      stone = palette.blonde,
      dress = palette.trim;
    // Plinth corners at (2.35, 0.9) stay inside the causeway sector (21.0 degrees, under 21.8).
    for (const sx of [-1, 1]) box(shell, sx * 1.6, foot / 2, 0, 1.5, foot, D + 0.3, palette.plinth, 'stone', { taper: 0.05 });
    const body = new T.Shape();
    body.moveTo(-W, foot);
    body.lineTo(-r, foot);
    body.lineTo(-r, spring);
    body.absarc(0, spring, r, Math.PI, 0, true);
    body.lineTo(r, foot);
    body.lineTo(W, foot);
    body.lineTo(W, top);
    body.lineTo(-W, top);
    body.closePath();
    const mass = new T.Mesh(
      new T.ExtrudeGeometry(body, { depth: D - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 16 }),
      material(stone, 'stone'),
    );
    mass.position.z = -D / 2 + b;
    mass.castShadow = mass.receiveShadow = true;
    shell.add(mass);
    // Seven chunky voussoirs, alternating dressing and red, standing 0.08 proud of each face.
    for (let i = 0; i < 7; i++) {
      const a0 = (i * Math.PI) / 7 + 0.012,
        a1 = ((i + 1) * Math.PI) / 7 - 0.012,
        ri = r - 0.03,
        ro = 1.5;
      const v = new T.Shape();
      v.moveTo(Math.cos(a0) * ri, spring + Math.sin(a0) * ri);
      v.lineTo(Math.cos(a0) * ro, spring + Math.sin(a0) * ro);
      v.lineTo(Math.cos(a1) * ro, spring + Math.sin(a1) * ro);
      v.lineTo(Math.cos(a1) * ri, spring + Math.sin(a1) * ri);
      v.closePath();
      const m = new T.Mesh(
        new T.ExtrudeGeometry(v, { depth: D + 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelOffset: -0.03, bevelSegments: 1 }),
        material(i % 2 ? palette.red : dress, 'stone'),
      );
      m.position.z = -(D + 0.16) / 2 + 0.03;
      m.castShadow = m.receiveShadow = true;
      shell.add(m);
    }
    box(shell, 0, 3.8, 0, 0.5, 0.9, D + 0.24, dress, 'stone'); // keystone into cornice
    for (const sx of [-1, 1]) {
      box(shell, sx * (r + 0.1), spring - 0.1, 0, 0.32, 0.2, D + 0.12, dress, 'stone'); // impost
      for (const sz of [-1, 1]) box(shell, sx * 1.6, 1.5, (sz * D) / 2, 0.7, 1.5, 0.12, dress, 'stone'); // pier panel, half set in
    }
    box(shell, 0, top + 0.1, 0, 2 * W + 0.3, 0.2, D + 0.3, dress, 'stone');
    box(shell, 0, top + 0.6, 0, 2 * W - 0.3, 0.8, D - 0.1, stone, 'stone', { segments: 2 });
    for (const sz of [-1, 1]) box(shell, 0, top + 0.6, sz * ((D - 0.1) / 2 + 0.03), 2.4, 0.46, 0.06, palette.bronze, 'brass'); // blank bronze plaques
    box(shell, 0, top + 1.1, 0, 2 * W - 0.1, 0.2, D + 0.1, dress, 'stone');
    box(shell, 0, top + 1.4, 0, 1.6, 0.4, 0.9, stone, 'stone');
    for (const sx of [-1, 1]) {
      cylinder(shell, sx * 1.75, top + 1.45, 0, 0.1, 0.13, 0.5, palette.bronze, 'brass');
      const glow = lampGlass();
      const bowl = new T.Mesh(new T.SphereGeometry(0.24, 14, 10), glow);
      bowl.position.set(sx * 1.75, top + 1.92, 0);
      shell.add(bowl);
      lamps.push(bowl);
    }
    shell.userData.landmark = "LIU'S GATE";
    shell.userData.openingWidth = r * 2;
  }

  function buildHall(shell: T.Group, site: plan.Site) {
    // A squat two-bay block (walls 0.5 to 4.3) under a copper roof, and a fat clock tower that
    // stands 0.6 proud of the front over the arched entrance (tower z 0.4 to 2.9).
    const w = site.w,
      d = site.d,
      tw = 2.5,
      tz = d / 2 + 0.6 - tw / 2;
    plinth(shell, w, d, palette.plinth, { height: 0.5 });
    plinth(shell, tw, tw, palette.plinth, { z: tz, height: 0.52, blocks: true });
    box(shell, 0, 2.4, 0, w, 3.8, d, palette.blonde, 'stone');
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) box(shell, sx * 3.6, 2.4, sz * 2.2, 0.45, 3.8, 0.45, palette.trim, 'stone'); // corner pilasters
      box(shell, sx * 1.475, 2.4, d / 2, 0.45, 3.8, 0.3, palette.trim, 'stone'); // tower-flank pilasters
    }
    box(shell, 0, 2.9, 0, w + 0.3, 0.2, d + 0.3, palette.trim, 'stone'); // string course
    box(shell, 0, 4.4, 0, w + 0.3, 0.2, d + 0.3, palette.trim, 'stone'); // cornice
    // Eave 0.3, not 0.35: a longer front slab's upper corner pokes 0.03 through the tower face
    // (z 2.9) as a thin copper line under the tower window.
    slabRoof(shell, 0, 4.5, 0, w, d + 0.3, 2.2, palette.copper, { eave: 0.3, verge: 0.3, thick: 0.22, ridge: palette.copperLight, gable: palette.blonde });
    // Two bays a side: arched windows below the string course, plain ones above. The rear has masses only.
    for (const sx of [-1, 1]) {
      windowAt(shell, sx * 2.54, 1.5, d / 2, 0.85, 1.15, { arched: true });
      windowAt(shell, sx * 2.54, 3.55, d / 2, 0.85, 0.95, { sill: false, lintel: false });
      const face = new T.Group();
      face.position.x = (sx * w) / 2;
      face.rotation.y = (sx * Math.PI) / 2;
      shell.add(face);
      for (const z of [-0.95, 0.95]) {
        windowAt(face, z, 1.5, 0, 0.85, 1.15, { arched: true });
        windowAt(face, z, 3.55, 0, 0.85, 0.95, { sill: false, lintel: false });
      }
    }
    // The tower: buttresses with pyramid caps either side of the arched door, a mullioned window above.
    box(shell, 0, 4.675, tz, tw, 8.35, tw, palette.blonde, 'stone', { segments: 2 });
    for (const sx of [-1, 1]) {
      box(shell, sx * 1.2, 3.05, tz + 1.2, 0.5, 5.1, 0.5, palette.trim, 'stone');
      cone(shell, sx * 1.2, 5.8, tz + 1.2, 0.4, 0.4, palette.trim, 'stone', 4);
    }
    door(shell, 0, 0.52, tz + tw / 2, 1.3, 2.2, palette.greenDoor, { arched: true, landing: 0.25, width: 2.0 });
    windowAt(shell, 0, 4.65, tz + tw / 2, 0.8, 1.2, { arched: true, mullion: true });
    box(shell, 0, 6.1, tz, tw + 0.3, 0.2, tw + 0.3, palette.trim, 'stone');
    // Four clocks at 70% of the face: an iron rim, a cream dial that glows after dusk like the
    // windows, four iron markers, a fixed brass hub and iron hands that keep Glasgow time.
    for (const side of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const face = new T.Group();
      face.position.set(0, 0, tz);
      face.rotation.y = side;
      shell.add(face);
      // The dial is a flat glass face 0.004 proud of the rim: a dial with sides showed a strip of
      // its upward side above the rim, and that caught the glass glint as a pale ring on the shaded clocks.
      const rim = new T.Mesh(new T.CylinderGeometry(0.95, 0.95, 0.096, 24), material(palette.metal, 'iron'));
      rim.rotation.x = Math.PI / 2;
      rim.position.set(0, 7.75, tw / 2 + 0.048);
      rim.castShadow = rim.receiveShadow = true;
      face.add(rim);
      const dial = new T.Mesh(new T.CircleGeometry(0.85, 24), material(palette.white, 'glass'));
      dial.position.set(0, 7.75, tw / 2 + 0.1);
      dial.userData.flatGlass = true; // an even cream face under the glass glint, not a window's gradient
      face.add(dial);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        box(face, Math.sin(a) * 0.66, 7.75 + Math.cos(a) * 0.66, tw / 2 + 0.105, 0.1, 0.2, 0.03, palette.metal, 'iron', { rz: -a });
      }
      const hub = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 0.05, 12), material(palette.brass, 'brass'));
      hub.rotation.x = Math.PI / 2;
      hub.position.set(0, 7.75, tw / 2 + 0.16); // static, so it batches with the tower
      face.add(hub);
      const hands = new T.Group();
      hands.position.set(0, 7.75, tw / 2 + 0.14);
      hands.userData.keepSeparate = true;
      face.add(hands);
      const hour = new T.Group(),
        minute = new T.Group();
      hands.add(hour, minute);
      box(hour, 0, 0.2, 0, 0.09, 0.45, 0.02, palette.ink, 'iron');
      box(minute, 0, 0.3, 0, 0.07, 0.65, 0.02, palette.ink, 'iron');
      clocks.push({ hour, minute });
    }
    // The crown: a cornice, four pinnacles, a copper spire (9.05 to 12.05), a finial and a flag.
    box(shell, 0, 8.95, tz, tw + 0.36, 0.2, tw + 0.36, palette.trim, 'stone');
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        cylinder(shell, sx * 1.25, 9.35, tz + sz * 1.25, 0.16, 0.18, 0.6, palette.trim, 'stone');
        cone(shell, sx * 1.25, 9.9, tz + sz * 1.25, 0.26, 0.5, palette.copper, 'copper', 4);
      }
    cone(shell, 0, 10.55, tz, 1.41, 3.0, palette.copper, 'copper', 4);
    cylinder(shell, 0, 12.55, tz, 0.035, 0.05, 1.2, palette.bronze, 'brass'); // starts 0.1 inside the apex
    sphere(shell, 0, 13.2, tz, 0.1, palette.brass, 'brass');
    const vane = new T.Group();
    vane.position.set(0, 12.85, tz);
    vane.userData.keepSeparate = true;
    shell.add(vane);
    box(vane, 0.42, 0, 0, 0.75, 0.5, 0.04, palette.blueDoor, 'fabric');
    animated.push({
      object: vane,
      update(time) {
        vane.rotation.y = Math.sin(time * 0.3) * 0.8 + Math.sin(time * 0.07) * 1.5;
      },
    });
    // Forecourt planters, grounded, each with a clipped topiary ball.
    for (const sx of [-1, 1]) {
      box(shell, sx * 1.85, 0.25, d / 2 + 1.15, 0.7, 0.5, 0.7, palette.plinth, 'stone', { taper: 0.04 });
      topiary(shell, sx * 1.85, 0.85, d / 2 + 1.15, 0.38, 2);
    }
  }

  function buildStudio(shell: T.Group, site: plan.Site) {
    const w = site.w,
      d = site.d,
      white = '#eef0ea';
    // A low kerb-stone plinth under two volumes. A: a glass box in a chunky white frame (corner
    // posts, two bands, sharp mullions) under a green roof slab. B: a rendered block 0.3 behind A's
    // front with metal-framed ribbon windows on its front and on the +x face seen at overview.
    plinth(shell, w, d, palette.kerb, { height: 0.35 });
    const aw = 3.4,
      ah = 4.0,
      ax = -1.1;
    box(shell, ax, 2.35, 0, aw - 0.24, ah, d - 0.24, palette.studioGlass, 'glass').userData.paneSpan = true; // one gentle glint over both storeys
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) box(shell, ax + sx * (aw / 2 - 0.11), 2.35, sz * (d / 2 - 0.11), 0.22, ah, 0.22, white, 'paint');
    // The front bands stop at the door surround (0.83 either side of it) instead of crossing the door.
    const run = aw / 2 - 0.83;
    for (const yb of [0.46, 2.35]) {
      box(shell, ax, yb, -(d / 2 - 0.11), aw, 0.22, 0.22, white, 'paint');
      for (const sx of [-1, 1]) box(shell, ax + sx * (aw / 2 - run / 2), yb, d / 2 - 0.11, run, 0.22, 0.22, white, 'paint');
      box(shell, ax - aw / 2 + 0.11, yb, 0, 0.22, 0.22, d, white, 'paint');
    }
    for (const sz of [-1, 1]) for (const mx of [-aw / 6, aw / 6]) box(shell, ax + mx, 2.35, sz * (d / 2 - 0.11), 0.14, ah, 0.14, white, 'paint', { bevel: 0 });
    box(shell, ax - aw / 2 + 0.11, 2.35, 0, 0.14, ah, 0.14, white, 'paint', { bevel: 0 });
    box(shell, 1.6, 1.85, 0, 2.4, 3.0, d - 0.6, palette.render, 'paint');
    const side = new T.Group();
    side.position.x = 2.8;
    side.rotation.y = Math.PI / 2;
    shell.add(side);
    for (const y of [1.25, 2.5]) {
      windowAt(shell, 1.6, y, (d - 0.6) / 2, 1.9, 0.72, { frame: palette.metal, lintel: false });
      windowAt(side, 0, y, 0, 3.6, 0.72, { frame: palette.metal, lintel: false });
    }
    // The green roof slab: a white coping, a lawn 0.17 proud, three shrub lumps and two tilted panels.
    // The coping is an eave for the glass box. At exactly 0.3 thick its float bounds miss the bake's
    // flat-slab test (<= 0.3), so it says where its underside is.
    const coping = box(shell, ax, 4.5, 0, aw + 0.3, 0.3, d + 0.3, white, 'paint');
    coping.userData.roof = true;
    coping.userData.eaveY = 4.35;
    box(shell, ax, 4.71, 0, aw - 0.2, 0.22, d - 0.2, palette.canopy[1], 'grass');
    for (const [x, y, z] of [[ax - 0.9, 4.95, -1.3], [ax - 1.0, 4.95, 0.6], [ax + 0.8, 4.92, 1.7]]) {
      const lump = new T.Mesh(new T.IcosahedronGeometry(0.32, 1), material(palette.hedge, 'foliage'));
      lump.position.set(x, y, z);
      lump.castShadow = lump.receiveShadow = true;
      shell.add(lump);
    }
    for (let i = 0; i < 2; i++) {
      box(shell, ax + 0.85, 4.89, -1.4 + i * 1.3, 0.9, 0.14, 0.2, palette.metal, 'iron');
      box(shell, ax + 0.85, 4.98, -1.4 + i * 1.3, 1.1, 0.08, 0.8, '#2f4e66', 'enamel', { rx: 0.35 }); // glossy panel, no night glow
    }
    // B's coping (top 3.59) with two planters of clipped topiary.
    box(shell, 1.6, 3.47, 0, 2.6, 0.24, d - 0.4, white, 'paint');
    for (const dz of [-1.2, 1.2]) {
      box(shell, 2.0, 3.77, dz, 0.8, 0.36, 0.5, '#b7ab93', 'stone');
      topiary(shell, 2.0, 4.05, dz, 0.34, 1, 1.15, 0.75, 0.85);
    }
    // The entrance: a white canopy on posts from the ground, a blue door with steps down from the
    // plinth, and a grounded apron with a bench.
    box(shell, ax, 2.7, d / 2 + 0.6, 2.6, 0.22, 1.2, white, 'paint');
    for (const sx of [-1, 1]) cylinder(shell, ax + sx * 1.1, 1.3, d / 2 + 1.05, 0.08, 0.08, 2.6, palette.metal, 'iron');
    door(shell, ax, 0.35, d / 2 - 0.12, 1.3, 2.1, '#3f6f8f', { surround: palette.metal, landing: 0.37, width: 2.0 });
    box(shell, ax, 0.03, d / 2 + 1.2, 3.2, 0.06, 1.8, palette.pavement, 'paving'); // from the plinth foot, like the path
    bench(shell, ax - 0.85, 0.06, d / 2 + 1.85);
  }

  function buildArchive(shell: T.Group, site: plan.Site) {
    const w = site.w,
      d = site.d;
    // Red brick walls (0.45-3.65) on a rusticated, battered plinth (the rear is seen at overview) under a pale cornice.
    plinth(shell, w, d, palette.plinth, { height: 0.45, blocks: true });
    box(shell, 0, 2.05, 0, w, 3.2, d, palette.brick, 'stone');
    box(shell, 0, 3.75, 0, w + 0.3, 0.2, d + 0.3, palette.trim, 'stone');
    // Blonde piers: fat corners, and two intermediates on the front and rear framing the hoist bay.
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        box(shell, sx * 3.0, 2.05, sz * 2.3, 0.5, 3.2, 0.5, palette.brickLight, 'stone');
        box(shell, sx * 1.05, 2.05, sz * (d / 2 + 0.05), 0.45, 3.2, 0.2, palette.brickLight, 'stone');
      }
    // Arched, metal-framed windows. The rear is seen at overview, so it is a secondary front.
    const arched = { arched: true, frame: palette.metal, dress: palette.brickLight, mullion: true };
    for (const x of [-2.01, 2.01]) windowAt(shell, x, 1.75, d / 2, 0.9, 1.3, arched);
    const rear = new T.Group();
    rear.position.z = -d / 2;
    rear.rotation.y = Math.PI;
    shell.add(rear);
    for (const x of [-2.01, 0, 2.01]) windowAt(rear, x, 1.75, 0, 0.9, 1.3, arched);
    for (const side of [-1, 1]) {
      const face = new T.Group();
      face.position.x = (side * w) / 2;
      face.rotation.y = (side * Math.PI) / 2;
      shell.add(face);
      for (const z of [-0.95, 0.95]) windowAt(face, z, 1.75, 0, 0.9, 1.3, arched);
    }
    // The centre hoist bay: an arched door at dock height, a grounded dock, the hoist beam and block, crates.
    door(shell, 0, 0.45, d / 2, 1.3, 2.0, palette.greenDoor, { arched: true, surround: palette.brickLight, steps: false });
    box(shell, 0, 0.225, d / 2 + 0.6, 2.2, 0.45, 0.9, palette.plinth, 'stone');
    box(shell, 0, 3.45, d / 2 + 0.45, 0.24, 0.24, 1.0, palette.woodDark, 'wood');
    box(shell, 0, 3.18, d / 2 + 0.85, 0.2, 0.3, 0.2, palette.metal, 'iron');
    box(shell, 1.55, 0.3, d / 2 + 0.55, 0.6, 0.6, 0.6, palette.wood, 'wood');
    box(shell, 1.5, 0.84, d / 2 + 0.5, 0.48, 0.48, 0.48, '#b47a48', 'wood', { ry: 0.35 });
    // A real sawtooth: three teeth across x with their ridges along z, each glazed on its tall face.
    const Wr=w+0.3, bw=Wr/3, R=1.35, f=0.15, Dr=d+0.8, rb=0.04, y0=3.85;
    for(let i=0;i<3;i++){ const x0=-Wr/2+i*bw, s=new T.Shape(); s.moveTo(x0,0); s.lineTo(x0+bw,0); s.lineTo(x0+bw,R); s.lineTo(x0,f); s.closePath();
      const t=new T.Mesh(new T.ExtrudeGeometry(s,{depth:Dr-2*rb,bevelEnabled:true,bevelThickness:rb,bevelSize:rb,bevelOffset:-rb,bevelSegments:1}),material(palette.slate,'slate'));
      t.position.set(0,y0,-Dr/2+rb); t.castShadow=t.receiveShadow=true; shell.add(t);
      t.userData.roof = true; t.userData.eaveY = y0; // a tooth's box drops to the cornice top: the eave bake measures from there
      box(shell,x0+bw+0.035,y0+(f+R)/2+0.05,0,0.07,R-f-0.25,Dr-0.6,palette.glass,'glass'); // north light faces local +x (world +z, seen at overview)
      for(const mz of [-1,1]) box(shell,x0+bw+0.08,y0+(f+R)/2+0.05,mz*(Dr-0.6)/6,0.08,R-f-0.25,0.12,palette.metal,'iron');
      box(shell,x0+bw-0.09,y0+R+0.03,0,0.28,0.16,Dr+0.04,palette.slateLight,'slate'); }
    // A fat stack rising through the first tooth (roof at 4.41 there), with a blonde band and a metal cap.
    cylinder(shell, -2.5, 5.9, -1.8, 0.4, 0.48, 4.1, palette.brick, 'stone');
    cylinder(shell, -2.5, 7.4, -1.8, 0.47, 0.47, 0.26, palette.brickLight, 'stone');
    cylinder(shell, -2.5, 8.0, -1.8, 0.5, 0.44, 0.2, palette.metal, 'iron');
  }

  /* ---------------------------------------------------------------- */
  /* Vehicles and people                                               */
  /* ---------------------------------------------------------------- */
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

  /* ---------------------------------------------------------------- */
  /* Highland herd                                                     */
  /* ---------------------------------------------------------------- */
  /**
   * The paddock's own colours, judged after the 0.72 grade: the dyke takes the beach boulders'
   * greys and the hay a dull straw (HSV s 0.45; a paler one read as an egg in the trough).
   */
  const PADDOCK = { stone: ['#b9b6a2', '#9da394'], cope: '#a3aaa0', hay: '#c4a86c' };
  /**
   * Highland coats: a muted ginger-russet (HSV s ≤ 0.61, no louder than the wood and the red
   * sandstone), a paler back and fringe, a dark belly and legs, a dark muzzle.
   */
  const COAT = { coat: '#ab6a42', light: '#c58a5c', dark: '#7a4b31', calf: '#b97a4c', muzzle: '#4f423a' };
  /** The paddock, its gate and hay rack, and the herd in it. */
  function highlandPaddock(g: T.Object3D) {
    dyke(g);
    fieldGate(g);
    hayRack(g);
    for (const animal of plan.herd) highlandCow(g, animal);
  }
  /** Hang the hem of a lump: vertices below `below` drop by a hashed amount up to `drop`; coincident corners drop together. */
  function shag(geo: T.BufferGeometry, below: number, drop: number) {
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y < below) p.setY(i, y - drop * hash(Math.round(x * 97) * 7 + Math.round(y * 89) * 13 + Math.round(z * 83) * 3));
    }
    return geo;
  }
  /**
   * The coat's two-tone paint, after paintCanopy: a warm, paler back, a darker belly and creases
   * where the lumps meet. Lumps are [x, y, z, r, sx, sy, sz]; the value ramp starts at 0.8, not
   * 0.45, because the batch bake already darkens the belly.
   */
  function paintCoat(geos: T.BufferGeometry[], lumps: number[][], tone: string, y0: number, y1: number) {
    const base = new T.Color(tone), top = new T.Color(COAT.light), under = new T.Color(COAT.dark), c = new T.Color();
    geos.forEach((geo, k) => {
      const p = geo.getAttribute('position'), n = geo.getAttribute('normal'), out = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), v = sstep(y, y0, y1);
        let f = mix(0.8, 1.05, sstep(v, 0.12, 0.88));
        lumps.forEach(([lx, ly, lz, r, sx, sy, sz], j) => {
          if (j === k) return;
          const gap = Math.hypot((x - lx) / sx, (y - ly) / sy, (z - lz) / sz) - r;
          if (gap > 0) f *= 1 - 0.14 * (1 - sstep(gap, 0, 0.3 * r));
        });
        c.copy(base).lerp(under, 0.3 * (1 - v)).lerp(top, 0.22 * sstep(v, 0.55, 1) * Math.max(0, n.getY(i)));
        out.set([c.r * f, c.g * f, c.b * f], i * 3);
      }
      geo.setAttribute('color', new T.BufferAttribute(out, 3));
    });
  }
  /** A horn: a tube along a smooth curve, tapering from r0 to a point, cream at the root and dark at the tip. */
  function horn(g: T.Object3D, points: T.Vector3[], r0: number, colour: string, tip: string) {
    const curve = new T.CatmullRomCurve3(points),
      segments = 8,
      sides = 6,
      geo = new T.TubeGeometry(curve, segments, 1, sides, false),
      p = geo.getAttribute('position'),
      out = new Float32Array(p.count * 3),
      root = new T.Color(colour),
      dark = new T.Color(tip),
      c = new T.Color(),
      at = new T.Vector3();
    // TubeGeometry lays out one ring of sides + 1 unit-radius vertices per step along the curve.
    for (let j = 0; j <= segments; j++) {
      const t = j / segments,
        r = mix(r0, 0.004, t ** 1.2);
      curve.getPointAt(t, at);
      c.copy(root).lerp(dark, sstep(t, 0.62, 0.95));
      for (let i = 0; i <= sides; i++) {
        const k = j * (sides + 1) + i;
        p.setXYZ(k, at.x + (p.getX(k) - at.x) * r, at.y + (p.getY(k) - at.y) * r, at.z + (p.getZ(k) - at.z) * r);
        out.set([c.r, c.g, c.b], k * 3);
      }
    }
    geo.setAttribute('color', new T.BufferAttribute(out, 3));
    const m = new T.Mesh(geo, material('#ffffff', 'fabric'));
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  }
  /**
   * A Highland cow (local +z is the nose, about 1.65 nose to tail and 0.95 at the withers): a shaggy
   * barrel with shoulder and rump lumps on short legs, a head with a fringe over the eyes, a
   * dark muzzle and long upswept horns (nubs on a calf), and a tufted tail. Every part is
   * 'fabric'. The head and tail hang from their own pivots, so they can move.
   */
  function highlandCow(g: T.Object3D, spec: plan.HerdMember) {
    const calf = spec.scale < 0.8,
      tone = calf ? COAT.calf : COAT.coat;
    const cow = new T.Group();
    cow.name = spec.id;
    cow.position.set(spec.x, plan.terrainHeight(spec.x, spec.z), spec.z);
    cow.rotation.y = spec.heading;
    cow.scale.setScalar(spec.scale);
    g.add(cow);
    const coat = (geo: T.BufferGeometry, parent: T.Object3D = cow) => {
      const m = new T.Mesh(geo, material('#ffffff', 'fabric'));
      m.castShadow = m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    // Barrel, shoulder and rump: one coat, painted across the three lumps, with a ragged hem
    // that hangs over the tops of the legs. The shoulder and rump lumps stay inside the barrel's
    // outline seen from above and only lift its back line at the withers and the hips.
    const lumps = [[0, 0.58, 0, 0.44, 0.85, 0.74, 1.3], [0, 0.72, 0.3, 0.3, 0.9, 0.85, 1.0], [0, 0.7, -0.36, 0.3, 0.9, 0.8, 0.95]];
    const body = lumps.map(([x, y, z, r, sx, sy, sz]) => shag(new T.IcosahedronGeometry(r, 1), -0.06, 0.13).scale(sx, sy, sz).translate(x, y, z));
    paintCoat(body, lumps, tone, 0.3, 0.95);
    body.forEach((geo) => coat(geo));
    for (const sx of [-0.2, 0.2]) for (const sz of [-0.34, 0.34]) box(cow, sx, 0.15, sz, 0.17, 0.3, 0.17, COAT.dark, 'fabric'); // short legs; the bake darkens the feet
    const head = new T.Group();
    head.name = spec.id + '-head';
    head.position.set(0, 0.72, 0.5);
    cow.add(head);
    box(head, 0, -0.02, 0.22, 0.38, 0.34, 0.4, tone, 'fabric', { bevel: 0.1 }); // skull
    box(head, 0, -0.13, 0.44, 0.32, 0.2, 0.16, COAT.muzzle, 'fabric', { bevel: 0.06 }); // muzzle
    const f = calf ? 1.2 : 1;
    // The fringe over the eyes, drooping forward with a ragged hem (no separate locks: pointed
    // ones below it read as fangs over the muzzle).
    const fringe = shag(new T.IcosahedronGeometry(0.2, 1), -0.02, 0.12).scale(1.3 * f, 0.6 * f, 0.85 * f),
      forelock = new T.Color(tone).lerp(new T.Color(COAT.light), 0.45).getStyle(),
      bud = new T.Color(palette.trim).lerp(new T.Color(tone), 0.35).getStyle();
    const lock = coat(paintByHeight(fringe, forelock, (y) => mix(0.88, 1.04, sstep(y, -0.12, 0.12))), head);
    lock.position.set(0, 0.11, 0.35);
    lock.rotation.x = 0.3;
    for (const s of [-1, 1]) {
      box(head, s * 0.25, 0.04, 0.16, 0.18, 0.06, 0.1, tone, 'fabric', { rz: -s * 0.35 }); // ears, drooping out under the horns
      // A calf's horn buds: small, muted and well back on the crown, behind the fringe, so they
      // never sit where eyes would be.
      if (calf) cone(head, s * 0.12, 0.16, 0.07, 0.03, 0.07, bud, 'fabric', 6, 0).rotation.z = -s * 0.4;
      else horn(head, [[0.15, 0.12, 0.14], [0.42, 0.17, 0.24], [0.55, 0.38, 0.28], [0.59, 0.5, 0.29]].map(([x, y, z]) => new T.Vector3(s * x, y, z)), 0.065, palette.trim, palette.woodDark);
    }
    const tail = new T.Group();
    tail.name = spec.id + '-tail';
    tail.position.set(0, 0.8, -0.6);
    cow.add(tail);
    box(tail, 0, -0.21, 0, 0.07, 0.42, 0.07, tone, 'fabric').userData.noShadow = true; // strand: like the tuft it casts no shadow, so a tail is one mesh
    coat(paintByHeight(new T.IcosahedronGeometry(0.09, 1).scale(1, 1.4, 1), COAT.dark, () => 1), tail).position.y = -0.45; // tuft
    headPose(spec, head, 0);
    tailPose(spec, tail, 0);
    // Five animated pivots in all: each head, and each adult's tail (the calf's stays still).
    head.userData.keepSeparate = true;
    head.userData.herdPart = 'head';
    animated.push({ object: head, update: (time) => headPose(spec, head, time) });
    if (!calf) {
      tail.userData.keepSeparate = true;
      tail.userData.herdPart = 'tail';
      animated.push({ object: tail, update: (time) => tailPose(spec, tail, time) });
    }
  }
  /**
   * A head's idle at `time`: a slow graze cycle (about 40 s, with long holds) that lowers it to
   * the grass, or for the cow at the rack only to the hay; a chewing bob while it is down, a
   * look about while it is up and a rare ear-flick twitch. Reduced motion holds time 0.
   */
  function headPose(spec: plan.HerdMember, head: T.Object3D, time: number) {
    const { phase } = spec,
      s = sstep(0.5 + 0.5 * Math.sin(time * 0.16 + phase), 0.2, 0.8);
    // A grazing head drops (from 0.72) as well as dips, so the muzzle comes down to about 0.05
    // over the grass instead of hanging over its own shadow.
    head.position.y = spec.eating ? 0.72 : 0.72 - 0.12 * s;
    head.rotation.x = (spec.eating ? mix(-0.06, 0.12, s) : mix(-0.08, 0.85, s)) + 0.03 * s * Math.sin(time * 5 + phase);
    // Both start from rest, so the held pose looks straight ahead along the body.
    head.rotation.y = 0.15 * (1 - s) * Math.cos(time * 0.23 + phase);
    head.rotation.z = 0.07 * Math.max(0, Math.sin(time * 0.9 + phase * 3 + 1)) ** 16;
  }
  /** A tail swishes in bursts; at time 0 (and so with reduced motion) every tail hangs still. */
  function tailPose(spec: plan.HerdMember, tail: T.Object3D, time: number) {
    const { phase } = spec;
    tail.rotation.z = 0.35 * Math.sin(time * 2.4 + phase) * sstep(Math.sin(time * 0.31 + phase * 1.7 + Math.PI), 0.55, 0.9);
  }
  /**
   * The herd answers the pointer as the Corner park does (its label; a click opens Life, where
   * the Highland-cow outing lives) through an invisible box under the park's own hit box. The
   * herd stays out of the park group, so the park's selection ring still traces only the park.
   */
  function herdHit(parkHit: T.Mesh) {
    const P = plan.paddock;
    const hit = new T.Mesh(new T.BoxGeometry(P.w + 0.4, 1.6, P.d + 0.4), parkHit.material);
    hit.name = 'herd-hit';
    hit.position.set(P.x - parkHit.position.x, 0.8 - parkHit.position.y, P.z - parkHit.position.z);
    hit.userData.placeId = 'corner-park';
    parkHit.add(hit);
  }
  /**
   * Dry-stone dykes: battered, rounded blocks about 0.7 long in the two greys (jittered in
   * height and turn), under a row of rounded cope stones set on edge. The top is about 0.5, so
   * the cows read over it.
   */
  function dyke(g: T.Object3D) {
    const wall = plan.paddock.wall;
    paddockRuns().forEach(([x, z, length, ry], r) => {
      const run = new T.Group();
      run.position.set(x, plan.terrainHeight(x, z), z);
      run.rotation.y = ry;
      g.add(run);
      const blocks = Math.max(1, Math.round(length / 0.7)),
        block = length / blocks,
        tops: number[] = [];
      for (let i = 0; i < blocks; i++) {
        const k = r * 17 + i,
          top = 0.35 + (hash(k * 3 + 1) - 0.5) * 0.06;
        tops.push(top);
        box(run, -length / 2 + (i + 0.5) * block, top / 2, 0, block, top, wall, PADDOCK.stone[hash(k * 3 + 3) < 0.5 ? 0 : 1], 'stone', { bevel: 0.06, taper: 0.035, ry: (hash(k * 3 + 2) - 0.5) * 0.06 });
      }
      // Copes about 0.3 long, abutting with no gaps: a finer row with gaps between the stones
      // falls below a pixel at overview zoom and flickers as the camera drifts. Each cope sinks
      // 0.02 into the lower of the blocks under it and stands over the higher; every other one
      // stands 0.0075 prouder, so abutting faces never share a plane.
      const copes = Math.max(1, Math.round(length / 0.3)),
        pitch = length / copes,
        under = (along: number) => tops[Math.min(blocks - 1, Math.max(0, Math.floor((along + length / 2) / block)))];
      for (let i = 0; i < copes; i++) {
        const along = -length / 2 + (i + 0.5) * pitch,
          ends = [under(along - pitch / 2 + 0.01), under(along + pitch / 2 - 0.01)],
          bottom = Math.min(...ends) - 0.02,
          top = Math.max(...ends) + 0.1 + 0.04 * hash(r * 101 + i * 7 + 1);
        box(run, along, (bottom + top) / 2, 0, pitch + 0.01, top - bottom, wall - (i % 2 ? 0.04 : 0.055), PADDOCK.cope, 'stone', { rz: (hash(r * 101 + i * 7) - 0.5) * 0.08 });
      }
    });
  }
  /** A field gate across the gateway: posts at the two wall ends, three rails and a brace on the paddock side. */
  function fieldGate(g: T.Object3D) {
    const P = plan.paddock,
      { x, width } = P.gate,
      z = P.z - P.d / 2;
    const gate = new T.Group();
    gate.position.set(x, plan.terrainHeight(x, z), z);
    g.add(gate);
    for (const s of [-1, 1]) box(gate, (s * width) / 2, 0.4, 0, 0.16, 0.8, 0.16, palette.woodDark, 'wood'); // posts take the wall ends
    for (const y of [0.2, 0.4, 0.6]) box(gate, 0, y, 0, width - 0.1, 0.08, 0.06, palette.wood, 'wood'); // rails, 0.03 into each post
    const run = width - 0.3,
      rise = 0.4;
    box(gate, 0, 0.4, 0.06, Math.hypot(run, rise), 0.07, 0.05, palette.wood, 'wood', { rz: Math.atan2(rise, run) }); // brace, clear of the rails' faces
  }
  /**
   * The hay rack against the west wall: an open trough of hay on four legs. (A pantile hat on it
   * caught the sun as the brightest thing in the paddock, and the horns of the cow at the rack
   * crossed it on screen.)
   */
  function hayRack(g: T.Object3D) {
    const { x, z } = plan.hayRack;
    const rack = new T.Group();
    rack.position.set(x, plan.terrainHeight(x, z), z);
    rack.rotation.y = Math.PI / 2; // local x runs along the wall (world z); local +z, the feeding side, faces the paddock
    g.add(rack);
    for (const sx of [-0.42, 0.42]) for (const sz of [-0.18, 0.18]) box(rack, sx, 0.275, sz, 0.1, 0.55, 0.1, palette.woodDark, 'wood');
    box(rack, 0, 0.42, 0, 1.0, 0.28, 0.5, palette.wood, 'wood'); // trough 0.28-0.56
    // The trough heaped with hay: a low, faceted pile inside its rim with a tufted top (shag()
    // hangs a hem, so the pile is flipped for it).
    const hay = shag(new T.IcosahedronGeometry(0.42, 1).rotateX(Math.PI), 0, 0.4).rotateX(Math.PI).scale(1.05, 0.3, 0.55);
    hay.computeVertexNormals();
    paintByHeight(hay, PADDOCK.hay, (y) => mix(0.8, 1.0, sstep(y, -0.12, 0.24)));
    const mound = new T.Mesh(hay, material('#ffffff', 'foliage'));
    mound.position.y = 0.56;
    mound.userData.noShadow = true;
    mound.receiveShadow = true;
    rack.add(mound);
  }

  /* ---------------------------------------------------------------- */
  /* Scottish touches                                                  */
  /* ---------------------------------------------------------------- */
  /**
   * A static Scottish Blackface sheep, about 0.66 tall at the fleece: three lumpy cream fleece
   * lumps (a creamy top, a darker belly and creases where they meet, a ragged hem), a black face
   * with curled pale horns and little ears, black legs and a tail. Grazing ones hold the nose to
   * the grass. Everything is 'fabric', so the whole flock batches with the land.
   */
  function blackfaceSheep(g: T.Object3D, spec: plan.SheepSpec, index: number) {
    const root = new T.Group();
    // Stand 0.02 into the built ground under the lowest hoof: the terrain mesh runs a little below
    // the smooth terrainHeight it samples on a hilltop, so a hoof placed by that would float.
    root.position.set(spec.x, Math.min(...plan.sheepFeet(spec).map(([x, z]) => groundY(x, z))) - 0.02, spec.z);
    root.rotation.y = spec.heading;
    g.add(root);
    const face = '#3b3633',
      horn = '#cfc6b0',
      top = new T.Color(palette.white),
      tone = new T.Color('#ece3cf'),
      under = new T.Color('#c9bfa6'),
      c = new T.Color();
    // Fleece: body, shoulders and rump as [x, y, z, r, sx, sy, sz].
    const lumps = [[0, 0.42, 0, 0.24, 1, 0.85, 1.35], [0, 0.47, 0.17, 0.19, 1, 1, 1], [0, 0.46, -0.17, 0.2, 1, 1, 1]];
    const geos = lumps.map(([x, y, z, r, sx, sy, sz], k) => {
      const geo = new T.IcosahedronGeometry(r, 1),
        p = geo.getAttribute('position');
      // A ragged hem: lower vertices pushed down by a hash of their position (shared corners move together).
      for (let i = 0; i < p.count; i++)
        if (p.getY(i) < -0.4 * r) p.setY(i, p.getY(i) - 0.035 * hash(Math.round(p.getX(i) * 997) + Math.round(p.getZ(i) * 613) * 3 + k * 7));
      return geo.scale(sx, sy, sz).rotateY(hash(index * 3 + k) * 0.6).translate(x, y, z);
    });
    for (const geo of geos) {
      const p = geo.getAttribute('position'),
        n = geo.getAttribute('normal'),
        out = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i),
          y = p.getY(i),
          z = p.getZ(i),
          v = sstep(y, 0.24, 0.66);
        let f = mix(0.8, 1.04, sstep(v, 0.1, 0.9)); // from 0.8: the batch bake already darkens the belly
        lumps.forEach(([lx, ly, lz, r, sx, sy, sz], j) => {
          if (geos[j] === geo) return;
          const gap = Math.hypot((x - lx) / sx, (y - ly) / sy, (z - lz) / sz) - r;
          if (gap > 0) f *= 1 - 0.18 * (1 - sstep(gap, 0, 0.3 * r));
        });
        c.copy(tone).lerp(under, 0.4 * (1 - v)).lerp(top, 0.5 * sstep(v, 0.5, 1) * Math.max(0, n.getY(i)));
        out[i * 3] = c.r * f;
        out[i * 3 + 1] = c.g * f;
        out[i * 3 + 2] = c.b * f;
      }
      geo.setAttribute('color', new T.BufferAttribute(out, 3));
    }
    const fleece = new T.Mesh(mergeGeometries(geos)!, material('#ffffff', 'fabric'));
    fleece.castShadow = fleece.receiveShadow = true;
    root.add(fleece);
    for (const [lx, lz] of [[-0.1, 0.18], [0.1, 0.18], [-0.1, -0.18], [0.1, -0.18]]) box(root, lx, 0.13, lz, 0.08, 0.26, 0.08, face, 'fabric'); // legs, into the fleece
    box(root, 0, 0.44, -0.38, 0.08, 0.13, 0.06, palette.white, 'fabric', { rx: -0.35 }); // tail
    // Head: a pivot inside the shoulder lump, nose down to the grass when grazing.
    const head = new T.Group();
    head.position.set(0, spec.grazing ? 0.33 : 0.5, spec.grazing ? 0.31 : 0.3);
    head.rotation.x = spec.grazing ? 1.25 : 0.45;
    root.add(head);
    box(head, 0, 0.02, 0.1, 0.17, 0.19, 0.26, face, 'fabric', { bevel: 0.06 });
    for (const s of [-1, 1]) {
      box(head, s * 0.11, 0.05, 0.03, 0.1, 0.03, 0.05, face, 'fabric', { rz: s * 0.3 }); // ear
      // A curled horn in the side plane: the arc runs back, over the top and forward, open at the cheek.
      const geo = new T.TorusGeometry(0.06, 0.028, 6, 10, 1.5 * Math.PI).rotateZ(1.5 * Math.PI).rotateY(Math.PI / 2);
      const m = new T.Mesh(geo, material(horn, 'fabric'));
      m.position.set(s * 0.1, 0.07, 0.02);
      m.castShadow = m.receiveShadow = true;
      head.add(m);
    }
    return root;
  }
  /**
   * The standing-stone ring: grey slabs a little askew, broad faces to the centre, slightly
   * tapered, buried 0.08, paler and lichen-tinted towards the top; the recumbent lies on its side.
   */
  function standingStoneRing(g: T.Object3D) {
    const greys = ['#8f9a92', '#868f86', '#9aa196'],
      lichen = '#a9ad8c';
    plan.standingStones().forEach((s, k) => {
      const y = groundY(s.x, s.z),
        colour = greys[k % 3];
      const m = s.recumbent
        ? box(g, s.x, y + s.h / 2 - 0.05, s.z, s.w, s.h, 0.38, '#ffffff', 'stone', { bevel: 0.08, ry: s.ry, rz: 0.03 })
        : box(g, s.x, y + s.h / 2 - 0.08, s.z, s.w, s.h, 0.26, '#ffffff', 'stone', {
            bevel: 0.08,
            taper: 0.04,
            ry: s.ry,
            rz: (hash(k * 5 + 3) - 0.5) * 0.12,
            rx: (hash(k * 5 + 4) - 0.5) * 0.08,
          });
      bakeRamp(m, colour, 0.85, 1.02, lichen, 0.25);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Assembly                                                          */
  /* ---------------------------------------------------------------- */
  buildTerrain();
  yield 'terrain';
  buildStreets();
  yield 'streets';
  const lampSpecs = plan.lampPlan();
  for (const spec of lampSpecs) lamp(land, spec.x, spec.z);
  const trees = plan.plantingPlan();
  // Ground shade, shallows and the town lawn, shared by every ground material (and later the sea).
  const groundMasks = buildGroundMasks(trees, lampSpecs);
  library.bakeUniforms.groundMasks.value = groundMasks;
  yield 'ground masks';
  const parkGroup = new T.Group();
  parkGroup.name = 'corner-park';
  parkGroup.userData.parkSelection = true;
  city.add(parkGroup);
  // Each tree's spin, tone and season accent come from its id, so a tree left out of the plan
  // (the one the paddock took) does not change the look of every tree planted after it.
  trees.forEach((spec) => {
    const inPark = Math.abs(spec.x - plan.park.x) < plan.park.w / 2 + 0.2 && Math.abs(spec.z - plan.park.z) < plan.park.d / 2 + 0.2;
    tree(inPark ? parkGroup : land, spec, Number(spec.id.slice(5)));
  });
  yield 'trees';
  // The corner park, a raised plot: a bevelled turf slab (top 0.10) inside stone edging that opens
  // on the ring side, a gravel strip along that side with spurs to the bandstand and to the ring's
  // inner pavement (z 13.05), then the bandstand, beds and board on the turf, benches and bin on the strip.
  {
    const P = plan.park,
      EDGE = 0.18,
      OPEN = 0.6;
    box(parkGroup, P.x, 0.05, P.z, P.w - 2 * EDGE, 0.1, P.d - 2 * EDGE, palette.grassLight, 'grass', { bevel: 0.04 });
    const edging = (x: number, z: number, w: number, d: number) => box(parkGroup, x, 0.08, z, w, 0.16, d, palette.kerb, 'stone');
    edging(P.x, P.z - P.d / 2 + EDGE / 2, P.w, EDGE);
    for (const s of [-1, 1]) {
      edging(P.x + s * (P.w / 2 - EDGE / 2), P.z, EDGE, P.d - 2 * EDGE);
      edging(P.x + s * (OPEN + P.w / 2) / 2, P.z + P.d / 2 - EDGE / 2, P.w / 2 - OPEN, EDGE);
    }
    const gravel = (g: T.Object3D, x: number, y: number, z: number, w: number, h: number, d: number) => {
      const m = box(g, x, y, z, w, h, d, palette.path, 'gravel');
      m.userData.noShadow = true;
      return m;
    };
    gravel(parkGroup, P.x, 0.115, P.z + P.d / 2 - 0.55, P.w - 0.6, 0.03, 0.7);
    gravel(parkGroup, P.x, 0.115, P.z + 1.625, 0.8, 0.03, 0.45); // to the bandstand plinth (z 10.6 to 11.05)
    // To the ring's inner pavement: it starts under the strip, so no grass shows between them.
    gravel(land, P.x, 0.05, 12.35, 2 * OPEN, 0.1, 1.4);
    pavilion(parkGroup, bandstandAt()[0], 0.1, bandstandAt()[1]);
    memoryBoard(parkGroup, P.x + P.w / 2 - 1.0, 0.1, P.z + 1.6, -0.6);
    // At z + 2.1 the benches' back legs stay on the strip.
    bench(parkGroup, P.x - 2.6, 0.13, P.z + 2.1, Math.PI);
    bench(parkGroup, P.x + 1.4, 0.13, P.z + 2.1, Math.PI);
    flowerBed(parkGroup, P.x - 2.8, 0.1, P.z - 1.4, 1.6, 0.7, 7);
    flowerBed(parkGroup, P.x + 2.6, 0.1, P.z - 1.2, 1.4, 0.7, 19);
    bin(parkGroup, P.x + 3.3, 0.13, P.z + 2.2);
  }
  picnic(parkGroup);
  // Plaza furniture.
  phoneBox(land, plan.phoneBoxSpot[0], plan.levels.plaza, plan.phoneBoxSpot[1], -0.6);
  bin(land, 0.9, plan.levels.plaza, 4.9);
  bin(land, -4.9, plan.levels.plaza, 0.9);
  // Terrace gardens: a flower bed in each gap between the three homes, standing on the lawn (y 0).
  for (const [side, seed] of [[-0.5, 41], [0.5, 43]] as const)
    flowerBed(land, plan.terraceRow.x + 0.4, 0, plan.terraceRow.z + side * plan.terraceRow.spacing, 1.4, 0.8, seed);
  plan.cottages.forEach((c, i) => buildCottage(land, c, i));
  crane(land, plan.reservedPlot.x, plan.reservedPlot.z);
  pierAndHarbour(land);
  lighthouse(land);
  moorland(land, trees);
  plan.flock.forEach((spec, i) => blackfaceSheep(land, spec, i));
  standingStoneRing(land);
  wellington(land);
  hotAirBalloon(city);
  highlandPaddock(land);
  yield 'park, harbour and landmarks';

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
      loop: plan.walkLoop(inner ? 1.62 : -1.62),
      distance: i * 13.7 + 4,
      speed: (inner ? 0.85 : -0.85) * (0.85 + hash(i + 3) * 0.3),
    });
  }
  const tram = buildTram();
  city.add(tram);
  const boat = buildBoat();
  city.add(boat);
  yield 'buildings and vehicles';

  /* ---------------------------------------------------------------- */
  /* Static batching by surface family                                 */
  /* ---------------------------------------------------------------- */
  city.updateMatrixWorld(true);
  batch(land);
  yield 'batch land';
  batch(parkGroup);
  yield 'batch park';
  // Buildings share the library's batch materials, so one night toggle lights every window.
  for (const [id, m] of models) {
    batch(m.shell);
    yield `batch ${id}`;
  }
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
  herdHit(parkHit);

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
