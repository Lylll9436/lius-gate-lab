import * as T from 'three';
import type { SurfaceKind } from './city-materials';
import * as plan from './town-plan';
import {
  palette,
  CRANE_BASE,
  HOARDING_THICKNESS,
  hoardingWalls,
  type TownContext,
} from './town-shared';
import type { Kit } from './town-kit';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ellipsoid, mouldedBlock, noise3, roundBox, roundCone, sculpt, squashX, strand, torus, within } from './town-sculpt';

/**
 * The Wellington statue's materials: grey granite (a shade lighter on the cornice and the
 * panels) and the bronze's patina, its verdigris (no more saturated than the copper roofs) and
 * the worn bright bronze where it is rubbed (no more saturated than palette.bronze).
 */
const STATUE = {
  granite: '#aca598', cornice: '#b2ab9e', panel: '#b2ab9e',
  plate: '#575645', patina: '#735f46', verdigris: '#7fae9c', worn: '#a8865a',
};

/** One step of a turned or cast profile: radius r (a polygon's apothem) at height y; `sharp` breaks the shading there (an arris). */
type Turn = { r: number; y: number; sharp?: boolean };
/**
 * A profile swept round the y axis as a lathe does, with mouldedBlock's normals: smooth up the
 * profile except at a `sharp` step. Round, it shades smoothly all the way round; with `facets`,
 * it is a regular polygon of `sides` flat faces, one square to +x (a cast plinth's octagon), each
 * catching the light on its own. Open at both ends unless `cap` closes the top.
 */
function turned(profile: Turn[], sides: number, opts: { facets?: boolean; cap?: boolean } = {}) {
  // The profile's outward normals (out, up) on each segment, then each step's below and above.
  const seg = profile.slice(1).map((q, i) => {
    const dr = q.r - profile[i].r,
      dy = q.y - profile[i].y,
      l = Math.hypot(dr, dy) || 1;
    return [dy / l, -dr / l];
  });
  const rings = profile.map((p, i) => {
    const lo = seg[i - 1], hi = seg[i];
    if (!lo || !hi || p.sharp) return { below: lo ?? hi, above: hi ?? lo };
    const n = [lo[0] + hi[0], lo[1] + hi[1]], l = Math.hypot(n[0], n[1]) || 1, r = [n[0] / l, n[1] / l];
    return { below: r, above: r };
  });
  const half = Math.PI / sides,
    grow = opts.facets ? 1 / Math.cos(half) : 1,
    pos: number[] = [],
    nor: number[] = [];
  // Angle a runs anticlockwise seen from above (x = cos a, z = -sin a); a face's normal turns with
  // its own middle (facets) or with each vertex (round).
  const vert = (p: Turn, a: number, face: number, n: number[]) => {
    const h = opts.facets ? face : a;
    pos.push(p.r * grow * Math.cos(a), p.y, -p.r * grow * Math.sin(a));
    nor.push(Math.cos(h) * n[0], n[1], -Math.sin(h) * n[0]);
  };
  for (let k = 0; k < sides; k++) {
    const face = 2 * k * half,
      a0 = opts.facets ? face - half : face,
      a1 = opts.facets ? face + half : face + 2 * half;
    for (let i = 0; i < profile.length - 1; i++) {
      const p = profile[i], q = profile[i + 1], np = rings[i].above, nq = rings[i + 1].below;
      vert(p, a0, face, np); vert(p, a1, face, np); vert(q, a1, face, nq);
      vert(p, a0, face, np); vert(q, a1, face, nq); vert(q, a0, face, nq);
    }
    if (opts.cap) {
      const top = profile[profile.length - 1];
      pos.push(0, top.y, 0);
      nor.push(0, 1, 0);
      vert(top, a0, face, [0, 1]);
      vert(top, a1, face, [0, 1]);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  return geometry;
}
/**
 * A cast drum through `rows` (radius r at height y) cut into `flutes` flat-bottomed channels:
 * three flat facets round each, a fillet on the full radius and the channel's floor `depth` in,
 * whose walls turn from the light and catch it in turn. The channels run out where a row's `cut`
 * is 0 (the lamp's drum: at its head, in a short slope; at its foot they die into the plinth).
 * Open at both ends.
 */
function flutedDrum(rows: { r: number; y: number; cut: number }[], flutes: number, depth: number) {
  const n = flutes * 3,
    at = (j: number, i: number) => {
      const row = rows[j],
        a = ((i % n) / n) * Math.PI * 2,
        r = row.r - (i % 3 ? depth * row.cut : 0);
      return [r * Math.cos(a), row.y, -r * Math.sin(a)];
    },
    pos: number[] = [];
  for (let j = 0; j < rows.length - 1; j++)
    for (let i = 0; i < n; i++) pos.push(...at(j, i), ...at(j, i + 1), ...at(j + 1, i + 1), ...at(j, i), ...at(j + 1, i + 1), ...at(j + 1, i));
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/* ------------------------------------------------------------------ */
/* Furniture, planting, small things                                   */
/* ------------------------------------------------------------------ */
export function createProps(ctx: TownContext, kit: Kit) {
  const { material, lamps, animated } = ctx;
  const { box, cylinder, cone, lampGlass } = kit;
  /** A chunky bench: two leg slabs with back posts, one seat slab and one back board. */
  function bench(g: T.Object3D, x: number, y: number, z: number, ry = 0) {
    const b = new T.Group(); b.position.set(x, y, z); b.rotation.y = ry; g.add(b);
    for (const sx of [-0.52, 0.52]) {
      box(b, sx, 0.19, 0.02, 0.1, 0.38, 0.4, palette.metal, 'iron');   // leg slab, 108
      box(b, sx, 0.62, -0.17, 0.1, 0.5, 0.08, palette.metal, 'iron');  // back post, 12
    }
    box(b, 0, 0.42, 0.02, 1.3, 0.1, 0.46, palette.wood, 'wood');      // seat slab, 108
    box(b, 0, 0.7, -0.19, 1.3, 0.26, 0.1, palette.wood, 'wood');      // back board, 108
    return b;
  }
  /**
   * A Sheffield cycle hoop (0.57 wide, 0.49 tall: below a parked bike's bar, which passes over it)
   * along the local x axis; thin, so it casts no shadow.
   */
  function cycleHoop(g: T.Object3D, x: number, y: number, z: number) {
    const h = new T.Group(); h.position.set(x, y, z); g.add(h);
    const steel = '#7d8288'; // galvanised, paler than the street iron, so the hoops part from the tyres
    const parts = [-0.25, 0.25].map((sx) => cylinder(h, sx, 0.1, 0, 0.035, 0.035, 0.2, steel, 'iron'));
    const bow = new T.Mesh(new T.TorusGeometry(0.25, 0.035, 6, 12, Math.PI), material(steel, 'iron'));
    bow.position.y = 0.2;
    h.add(bow);
    for (const m of [...parts, bow]) {
      m.castShadow = false;
      m.receiveShadow = true;
      m.userData.noShadow = true;
    }
    return h;
  }
  // Every street and pier lantern shares one glass; the frame loop sets the same glow on all of them.
  const lanternGlass = lampGlass();
  lanternGlass.emissiveIntensity = 0;
  /**
   * A lamp standard's parts for a lantern whose middle is at H, made once per height and shared by
   * every lamp (batching copies them into the merged meshes). Everything from the shaft up moves
   * with H. The thin parts (`cast: false`: the lantern's corner bars and the scrolls) stay out of
   * the shadow maps, where thin casters ghost. `name` marks the parts the town checks measure.
   */
  type LampPart = { geometry: T.BufferGeometry; colour: string; kind: SurfaceKind; cast: boolean; name: string };
  const lampSets = new Map<number, { parts: LampPart[]; glass: T.BufferGeometry }>();
  function lampSet(H: number) {
    const known = lampSets.get(H);
    if (known) return known;
    const up = H - 1.8,
      iron = palette.metal,
      parts: LampPart[] = [],
      add = (geometry: T.BufferGeometry, colour = iron, kind: SurfaceKind = 'iron', cast = true, name = '') => parts.push({ geometry, colour, kind, cast, name });
    // The base: an octagonal plinth of two chamfered steps (0.34 across its flats), a fluted drum
    // and the brass collar on its head.
    add(turned([
      { r: 0.17, y: 0 }, { r: 0.17, y: 0.08, sharp: true }, { r: 0.154, y: 0.096, sharp: true }, { r: 0.138, y: 0.096, sharp: true },
      { r: 0.138, y: 0.17, sharp: true }, { r: 0.124, y: 0.186, sharp: true },
    ], 8, { facets: true, cap: true }));
    add(flutedDrum([{ r: 0.126, y: 0.184, cut: 1 }, { r: 0.118, y: 0.46, cut: 1 }, { r: 0.112, y: 0.495, cut: 0 }], 8, 0.024));
    add(turned([{ r: 0.108, y: 0.49 }, { r: 0.13, y: 0.503 }, { r: 0.137, y: 0.53 }, { r: 0.13, y: 0.557 }, { r: 0.108, y: 0.57 }], 10), palette.brass, 'brass');
    // The shaft tapers from 0.092 to 0.07 between its foot (a cavetto off the collar) and the boss,
    // with a bead a third of the way up and a fatter ring the scrolls spring from.
    const top = 1.315 + up,
      bar = 1.36 + up,
      rs = (y: number) => T.MathUtils.lerp(0.092, 0.07, (y - 0.65) / (top - 0.65)),
      bead = (y: number, proud: number): Turn[] =>
        [-0.03, -0.017, 0, 0.017, 0.03].map((d, k) => ({ r: rs(y + d) + proud * [0, 0.75, 1, 0.75, 0][k], y: y + d }));
    add(turned([
      { r: 0.11, y: 0.565 }, { r: 0.1, y: 0.6 }, { r: rs(0.65), y: 0.65 },
      ...bead(0.86 + up * 0.5, 0.026), ...bead(bar - 0.25, 0.03),
      // The boss the ladder bar passes through, a neck, and the bell collar carrying the tray.
      { r: rs(top), y: top }, { r: 0.088, y: bar - 0.035 }, { r: 0.088, y: bar + 0.035 }, { r: 0.064, y: bar + 0.062 },
      { r: 0.098, y: bar + 0.105 }, { r: 0.112, y: bar + 0.132 }, { r: 0.104, y: bar + 0.155 },
    ], 8));
    // The ladder bar: a round arm with a ball at each end, 0.58 long, through the boss. It and its
    // scrolls run square to the overview's line of sight (a diagonal of the town's grid), so the
    // opening views see both arms and both scrolls rather than one arm in front of the shaft.
    const across = Math.PI / 4;
    add(turned([
      { r: 0, y: -0.29 }, { r: 0.046, y: -0.278 }, { r: 0.054, y: -0.25 }, { r: 0.036, y: -0.22 },
      { r: 0.036, y: 0.22 }, { r: 0.054, y: 0.25 }, { r: 0.046, y: 0.278 }, { r: 0, y: 0.29 },
    ], 8).rotateZ(-Math.PI / 2).rotateY(across).translate(0, bar, 0), iron, 'iron', true, 'ladder-bar');
    // A scroll under each arm: from the shaft below the boss, out and up into the arm by its ball.
    const scroll = new T.TubeGeometry(
      new T.CatmullRomCurve3([[0.03, -0.25], [0.085, -0.244], [0.14, -0.215], [0.18, -0.162], [0.203, -0.098], [0.213, -0.035], [0.215, 0.005]].map(([px, py]) => new T.Vector3(px, bar + py, 0)), false, 'centripetal'),
      8, 0.036, 5, false,
    );
    add(scroll.clone().rotateY(across), iron, 'iron', false, 'scroll');
    add(scroll.rotateY(across + Math.PI), iron, 'iron', false, 'scroll');
    // The lantern: a tray under it, four panes between corner bars, 0.32 across at the foot and
    // 0.4 at the head, a cornice and a bell-cast roof, then the vent cap and the brass finial.
    const foot = H - 0.2, head = H + 0.2, low = 0.16, high = 0.2;
    add(mouldedBlock(0.19, 0.19, [
      { s: 0.075, y: foot - 0.1 }, { s: 0.05, y: foot - 0.072 }, { s: 0.018, y: foot - 0.034 }, { s: 0, y: foot - 0.014, sharp: true }, { s: 0, y: foot + 0.02, sharp: true },
    ], 0.03, 1));
    // Each bar stands 0.0175 proud of its corner and covers 0.0575 of either pane beside it.
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sz]) => {
      const a = new T.Vector3(sx * (low - 0.02), foot - 0.01, sz * (low - 0.02)),
        b = new T.Vector3(sx * (high - 0.02), head - 0.01, sz * (high - 0.02)),
        along = b.clone().sub(a);
      return new T.BoxGeometry(0.075, along.length(), 0.075)
        .applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), along.normalize()))
        .translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    });
    add(mergeGeometries(corners, false)!, iron, 'iron', false, 'corner-bars');
    corners.forEach((c) => c.dispose());
    add(mouldedBlock(0.235, 0.235, [
      { s: 0.03, y: head - 0.025 }, { s: 0, y: head + 0.016, sharp: true }, { s: 0, y: head + 0.05, sharp: true },
      { s: 0.02, y: head + 0.066, sharp: true }, { s: 0.075, y: head + 0.092 }, { s: 0.122, y: head + 0.13 }, { s: 0.153, y: head + 0.18 },
      { s: 0.167, y: head + 0.24, sharp: true },
    ], 0.035, 1));
    add(turned([
      { r: 0.066, y: head + 0.23 }, { r: 0.066, y: head + 0.275, sharp: true }, { r: 0.053, y: head + 0.283, sharp: true }, { r: 0.053, y: head + 0.295, sharp: true },
      { r: 0.09, y: head + 0.303, sharp: true }, { r: 0.093, y: head + 0.32 }, { r: 0.064, y: head + 0.35 }, { r: 0.032, y: head + 0.37 }, { r: 0.028, y: head + 0.385 },
    ], 8));
    add(turned([
      { r: 0.026, y: head + 0.377 }, { r: 0.045, y: head + 0.395 }, { r: 0.05, y: head + 0.422 }, { r: 0.036, y: head + 0.449 }, { r: 0, y: head + 0.48 },
    ], 8), palette.brass, 'brass');
    // The glass, about its middle: a four-sided frustum with flat panes, wider at the top.
    const glass = new T.CylinderGeometry(high * Math.SQRT2, low * Math.SQRT2, head - foot, 4).rotateY(Math.PI / 4).toNonIndexed();
    glass.computeVertexNormals();
    const set = { parts, glass };
    lampSets.set(H, set);
    return set;
  }
  /**
   * A Glasgow cast-iron lamp standard, 2.48 tall on a 0.34 octagonal plinth (see lampSet), in
   * muted iron with two brass accents (the collar on the base, round so it sweeps a highlight,
   * and the finial). The lantern glass (its middle at `height`) is the lamps entry the night loop
   * lights; the frame round it stays iron, so the panes glow and the frame stays dark.
   */
  function lamp(g: T.Object3D, x: number, z: number, height = 1.8, y = plan.terrainHeight(x, z)) {
    const post = new T.Group();
    post.position.set(x, y, z);
    // Square to the world whatever g's turn (the pier's), so every ladder bar crosses the
    // overview's line of sight the same way.
    post.rotation.y = -new T.Euler().setFromQuaternion(g.getWorldQuaternion(new T.Quaternion()), 'YXZ').y;
    g.add(post);
    const { parts, glass } = lampSet(height);
    for (const part of parts) {
      const m = new T.Mesh(part.geometry, material(part.colour, part.kind));
      m.name = part.name;
      m.castShadow = part.cast;
      m.receiveShadow = true;
      if (!part.cast) m.userData.noShadow = true;
      post.add(m);
    }
    const lantern = new T.Mesh(glass, lanternGlass);
    lantern.position.y = height;
    lantern.castShadow = false;
    post.add(lantern);
    lamps.push(lantern);
    return post;
  }
  /**
   * The lenses: dark glass tinted red, amber or green (`dark`), and lit by their own emissive
   * (`lit`), a clear bright red, amber or green that reads by day and at night with nothing
   * spilling off the glass. The light alone carries a lit lens's colour: sunlight on a bright base
   * as well would wash it out to salmon and peach under the tone curve. `on` says which aspects
   * light it (red and amber both show in red+amber). These may be the most saturated small accents
   * in the frame after the grade.
   */
  const LENSES: { lit: string; dark: string; on: (a: plan.Aspect) => boolean }[] = [
    { lit: '#ff3426', dark: '#3d1c19', on: (a) => a === 'red' || a === 'redAmber' },
    { lit: '#ffa21f', dark: '#3d2d16', on: (a) => a === 'amber' || a === 'redAmber' },
    { lit: '#1fe39b', dark: '#163a2c', on: (a) => a === 'green' },
  ];
  /** A lit lens's emissive intensity; an unlit one has none. */
  const LENS_GLOW = 0.95;
  /**
   * UK traffic signals at the ring's three junctions (plan.signalPosts), two each: a slim iron pole
   * on a small foot, a black head with three round lenses (red over amber over green) under short
   * visors, and a narrow black backboard, in the street lamps' chunky proportions and about their
   * height. No lettering, no signs. Poles, heads, visors and boards batch with the land; the lenses
   * stay apart (keepSeparate), one small mesh and one material per lens, all made here at build time.
   * The frame loop (the animated entry) re-reads each signal's aspect from town time
   * (plan.signalState) and sets a lens's emissive intensity only when its signal changes, so no
   * aspect ever compiles a shader or adds a program: the lens material is the lanterns' plain
   * standard one. Like the lamps they take no pointer, follow the town's Plan tints and hide with it
   * in Inspect; paused or under reduced motion, town time holds and so do they.
   */
  function trafficSignals(g: T.Object3D) {
    const root = new T.Group();
    root.name = 'traffic-signals';
    root.userData.prebatched = true; // the static parts batch with the land; the lenses stay apart
    g.add(root);
    const black = palette.ink,
      lensGeometry = new T.CylinderGeometry(0.078, 0.078, 0.03, 14).rotateX(Math.PI / 2),
      HEAD_Y = 1.47,
      PITCH = 0.225;
    const heads = plan.signalPosts.map((p) => {
      const post = new T.Group();
      post.position.set(p.x, plan.pavementTop(p.x, p.z) + plan.terrainHeight(p.x, p.z), p.z); // lower where it stands in a dropped crossing
      post.rotation.y = p.heading;
      root.add(post);
      box(post, 0, 0.05, 0, 0.2, 0.1, 0.2, palette.metal, 'iron'); // foot
      const pole = new T.Mesh(new T.CylinderGeometry(0.045, 0.052, 1.1, 10, 1, true), material(palette.metal, 'iron'));
      pole.position.y = 0.1 + 0.55; // into the head's underside
      pole.castShadow = pole.receiveShadow = true;
      post.add(pole);
      box(post, 0, HEAD_Y, 0, 0.27, 0.72, 0.2, black, 'enamel'); // head, 1.11..1.83
      box(post, 0, HEAD_Y, -0.12, 0.43, 0.88, 0.04, black, 'enamel'); // backboard, behind the head
      const lenses = new T.Group();
      lenses.userData.keepSeparate = true;
      post.add(lenses);
      const meshes = LENSES.map((look, k) => {
        const y = HEAD_Y + PITCH * (1 - k);
        // A short visor over each lens: a longer one would hide the lit glass from the high camera.
        box(post, 0, y + 0.095, 0.12, 0.19, 0.02, 0.04, black, 'enamel');
        const lens = new T.Mesh(
          lensGeometry,
          new T.MeshStandardMaterial({ color: look.dark, emissive: look.lit, emissiveIntensity: 0, roughness: 0.3, metalness: 0 }),
        );
        lens.material.name = 'signal-lens';
        lens.position.set(0, y, 0.112);
        lens.castShadow = lens.receiveShadow = false;
        lenses.add(lens);
        return lens;
      });
      return { post: p, meshes, shown: '' as plan.Aspect | '' };
    });
    const update = (time: number) => {
      for (const head of heads) {
        const aspect = plan.signalState(head.post.junction, head.post.approach, time);
        if (aspect === head.shown) continue;
        head.shown = aspect;
        head.meshes.forEach((lens, k) => (lens.material.emissiveIntensity = LENSES[k].on(aspect) ? LENS_GLOW : 0));
      }
    };
    update(0);
    animated.push({ object: root, update });
    return root;
  }
  /** A red enamel phone box: a stone plinth, a fat body with one big pane per face, a blank cream band, a crown and a pyramid hat. */
  function phoneBox(g: T.Object3D, x: number, y: number, z: number, ry = 0) {
    const p = new T.Group(); p.position.set(x, y, z); p.rotation.y = ry; g.add(p);
    const red = palette.boat; // the palette's accent red
    box(p, 0, 0.1, 0, 0.84, 0.2, 0.84, palette.stoneDark, 'stone'); // plinth
    box(p, 0, 1.0, 0, 0.72, 1.6, 0.72, red, 'enamel'); // body
    for (const side of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const f = new T.Group(); f.rotation.y = side; p.add(f);
      box(f, 0, 0.98, 0.35, 0.48, 1.04, 0.04, palette.glass, 'glass').userData.window = 'kiosk'; // pane, a cool light all night
      box(f, 0, 0.98, 0.37, 0.07, 1.04, 0.03, red, 'enamel'); // mullion
      box(f, 0, 1.15, 0.37, 0.48, 0.07, 0.03, red, 'enamel'); // transom
      box(f, 0, 1.64, 0.37, 0.5, 0.13, 0.03, palette.white, 'enamel'); // sign band, blank
    }
    box(p, 0, 1.86, 0, 0.84, 0.12, 0.84, red, 'enamel'); // crown
    cone(p, 0, 2.02, 0, 0.58, 0.2, red, 'enamel', 4); // hat
    return p;
  }
  /** A fat green enamel litter bin with a brass band and an iron lid. */
  function bin(g: T.Object3D, x: number, y: number, z: number) {
    cylinder(g, x, y + 0.33, z, 0.24, 0.2, 0.66, palette.greenDoor, 'enamel', 12); // body
    cylinder(g, x, y + 0.5, z, 0.245, 0.245, 0.07, palette.brass, 'brass', 12); // band
    cylinder(g, x, y + 0.7, z, 0.27, 0.27, 0.1, palette.metal, 'iron', 12); // lid
  }
  /** The park bandstand: a fat octagon on a stepped plinth, chunky columns, low panels and a big verdigris hat. */
  function pavilion(g: T.Object3D, x: number, y: number, z: number) {
    const p = new T.Group(); p.position.set(x, y, z); g.add(p);
    /** Flat-faced 8-sided pieces (non-indexed, face normals) so they shade as octagons, not cylinders. */
    const facets = (geo: T.BufferGeometry) => { const flat = geo.toNonIndexed(); geo.dispose(); flat.computeVertexNormals(); return flat; };
    const oct = (rt: number, rb: number, h: number, yc: number, colour: string, kind: SurfaceKind) => {
      const m = new T.Mesh(facets(new T.CylinderGeometry(rt, rb, h, 8)), material(colour, kind));
      m.rotation.y = Math.PI / 8; m.position.y = yc; m.castShadow = m.receiveShadow = true; p.add(m); return m; };
    oct(1.9, 2.0, 0.4, 0.2, palette.stoneDark, 'stone');          // plinth (flat face to +z)
    oct(1.78, 1.78, 0.08, 0.44, palette.plaza, 'paving');         // floor
    box(p, 0, 0.13, 2.02, 1.1, 0.26, 0.34, palette.stoneDark, 'stone'); // steps land on the park's gravel strip
    box(p, 0, 0.065, 2.34, 1.1, 0.13, 0.3, palette.stoneDark, 'stone');
    for (let i = 0; i < 8; i++) {
      const th = Math.PI / 8 + (i * Math.PI) / 4;               // octagon corners (x = r sin, z = r cos)
      const col = new T.Mesh(new T.CylinderGeometry(0.09, 0.11, 2.1, 10, 1, true), material(palette.frame, 'enamel')); // painted cast iron
      col.position.set(1.55 * Math.sin(th), 1.45, 1.55 * Math.cos(th)); col.castShadow = col.receiveShadow = true; p.add(col);
      const mid = th + Math.PI / 8; if (i === 7) continue;     // entrance between corners 7 and 0 faces +z
      box(p, 1.432 * Math.sin(mid), 0.6, 1.432 * Math.cos(mid), 0.95, 0.4, 0.12, palette.frame, 'enamel', { ry: mid });
    }
    oct(1.7, 1.7, 0.32, 2.66, palette.frame, 'enamel');          // closed frieze; columns stop under it
    const roof = new T.Mesh(facets(new T.ConeGeometry(2.3, 1.2, 8)), material(palette.copper, 'copper'));
    roof.rotation.y = Math.PI / 8; roof.position.y = 3.42; roof.castShadow = roof.receiveShadow = true; p.add(roof);
    const fin = new T.Mesh(new T.IcosahedronGeometry(0.16, 1), material(palette.brass, 'brass')); fin.position.y = 4.1; p.add(fin);
    return p;
  }
  /** The park's notice board: two posts, a wooden board with a paper sheet and a slate roof. */
  function memoryBoard(g: T.Object3D, x: number, y: number, z: number, ry: number) {
    const b = new T.Group(); b.position.set(x, y, z); b.rotation.y = ry; g.add(b);
    for (const dx of [-0.6, 0.6]) box(b, dx, 0.8, 0, 0.12, 1.6, 0.12, palette.woodDark, 'wood'); // posts
    box(b, 0, 1.15, 0, 1.35, 0.85, 0.1, palette.wood, 'wood'); // board
    box(b, 0, 1.15, 0.06, 1.15, 0.65, 0.02, palette.white, 'paint'); // paper
    box(b, 0, 1.66, 0, 1.6, 0.12, 0.42, palette.slate, 'slate'); // roof
    return b;
  }
  /** The tower crane on the reserved plot, built from a few thick painted members, with a swinging jib and a hook load. */
  function crane(g: T.Object3D, x: number, z: number) {
    const Y = palette.gold; // crane yellow, enamelled
    const base = new T.Group();
    base.position.set(x, 0, z);
    g.add(base);
    box(base, 0, 0.18, 0, CRANE_BASE, 0.36, CRANE_BASE, '#bdb6a4', 'stone'); // footing
    for (const sx of [-0.3, 0.3])
      for (const sz of [-0.3, 0.3]) box(base, sx, 0.36 + 3.6, sz, 0.16, 7.2, 0.16, Y, 'enamel'); // mast chords
    for (let i = 0; i < 5; i++) {
      const y = 1.26 + i * 1.2;
      for (const s of [-0.3, 0.3]) {
        box(base, 0, y, s, 0.6, 0.09, 0.09, Y, 'enamel'); // ring bars
        box(base, s, y, 0, 0.09, 0.09, 0.6, Y, 'enamel');
      }
      // One diagonal on each camera-facing face.
      box(base, 0, y + 0.6, 0.3, 0.09, 1.34, 0.09, Y, 'enamel', { rz: 0.4636 });
      box(base, 0.3, y + 0.6, 0, 0.09, 1.34, 0.09, Y, 'enamel', { rx: 0.4636 });
    }
    const jib = new T.Group();
    jib.position.set(0, 7.86, 0);
    jib.userData.keepSeparate = true;
    base.add(jib);
    box(jib, 0, 0, 0, 1.1, 0.6, 1.1, Y, 'enamel'); // slewing unit
    box(jib, 0.35, 0.65, 0.1, 0.9, 0.7, 0.8, Y, 'enamel'); // cab
    box(jib, 0.35, 0.7, 0.51, 0.62, 0.38, 0.06, palette.glass, 'glass').userData.window = 'unlit'; // cab window, dark at night
    cone(jib, 0, 1.8, 0, 0.42, 1.6, Y, 'enamel', 4); // apex
    box(jib, 3.3, 0.35, 0, 6.2, 0.22, 0.22, Y, 'enamel'); // top chord
    for (const s of [-0.22, 0.22]) box(jib, 3.3, -0.05, s, 6.2, 0.12, 0.12, Y, 'enamel'); // bottom chords
    for (let i = 0; i < 8; i++) box(jib, 0.75 + i * 0.75, 0.15, 0, 0.09, 0.5, 0.09, Y, 'enamel', { rz: i % 2 ? 0.75 : -0.75 }); // web
    box(jib, -1.5, 0.15, 0, 2.4, 0.18, 0.5, Y, 'enamel'); // counter-jib
    box(jib, -2.3, -0.05, 0, 0.9, 0.8, 0.9, '#9a978c', 'stone'); // counterweight
    box(jib, 1.7, 1.15, 0, 3.9, 0.07, 0.07, palette.metal, 'iron', { rz: -0.34 }); // ties
    box(jib, -1.1, 1.15, 0, 2.5, 0.07, 0.07, palette.metal, 'iron', { rz: 0.55 });
    box(jib, 4.6, -0.2, 0, 0.42, 0.2, 0.5, palette.metal, 'iron'); // trolley
    box(jib, 4.6, -1.7, 0, 0.06, 2.9, 0.06, palette.metal, 'iron'); // line
    box(jib, 4.6, -3.25, 0, 0.36, 0.32, 0.24, palette.boat, 'enamel'); // hook block
    box(jib, 4.6, -3.8, 0, 1.2, 0.18, 0.5, palette.wood, 'wood'); // plank load
    animated.push({
      object: jib,
      update(time) {
        jib.rotation.y = Math.sin(time * 0.07) * 0.9;
      },
    });
    // Hoarding round the plot (lengthened by its thickness so the corners close), with a blue band
    // standing just proud of the top, and building materials inside.
    const plot = plan.reservedPlot;
    for (const [dx, dz, l, ry] of hoardingWalls(plot)) {
      box(g, plot.x + dx, 0.5, plot.z + dz, l + HOARDING_THICKNESS, 1.0, HOARDING_THICKNESS, '#efe2c2', 'paint', { ry });
      box(g, plot.x + dx, 0.93, plot.z + dz, l + 0.14, 0.18, 0.14, palette.blueDoor, 'paint', { ry });
    }
    box(g, plot.x - 1.4, 0.35, plot.z + 1.3, 0.7, 0.7, 0.7, palette.wood, 'wood'); // crates
    box(g, plot.x - 1.4, 1.0, plot.z + 1.3, 0.6, 0.6, 0.6, palette.wood, 'wood', { ry: 0.4 });
    box(g, plot.x + 1.2, 0.225, plot.z + 1.4, 0.9, 0.45, 0.6, palette.brick, 'stone'); // brick pallet
    return base;
  }
  /**
   * A tartan picnic blanket and a hamper on the park turf, front-left of the bandstand under the
   * edge of the west tree: 0.27 clear of the bandstand plinth, 0.5 of the bench (so the bench back
   * hides no more than a corner from the Life chapter's camera) and 0.48 of the trunk.
   * The tartan is one flat colour per triangle on a 0.05 grid, the mix of a muted red, navy, green
   * and cream sett across and along it (0.5 repeat), so no texture can shimmer. It lies 0.012 over
   * the turf (top 0.10), casts no shadow and takes no contact bake.
   */
  function picnic(g: T.Object3D) {
    const spot = { x: -12.25, z: 10.08, ry: 0.12 },
      W = 1.1,
      D = 0.8,
      cell = 0.05;
    const red = new T.Color('#a94a3e'),
      navy = new T.Color('#34506e'),
      green = new T.Color('#3d6450'),
      cream = new T.Color(palette.white);
    // The sett in 0.05 cells: red 4, navy 2, red 1, green 2, cream 1.
    const sett = [red, red, red, red, navy, navy, red, green, green, cream];
    const stripe = (t: number) => sett[((Math.floor(t / cell + 1e-6) % sett.length) + sett.length) % sett.length];
    const geo = new T.PlaneGeometry(W, D, Math.round(W / cell), Math.round(D / cell)).rotateX(-Math.PI / 2).toNonIndexed();
    const p = geo.getAttribute('position'),
      out = new Float32Array(p.count * 3),
      c = new T.Color();
    for (let i = 0; i < p.count; i += 3) {
      const u = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3 + W / 2,
        v = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3 + D / 2;
      c.copy(stripe(u)).lerp(stripe(v), 0.5);
      for (let k = 0; k < 3; k++) c.toArray(out, (i + k) * 3);
    }
    geo.setAttribute('color', new T.BufferAttribute(out, 3));
    const rug = new T.Group();
    rug.position.set(spot.x, 0.112, spot.z);
    rug.rotation.y = spot.ry;
    g.add(rug);
    const blanket = new T.Mesh(geo, material('#ffffff', 'fabric'));
    blanket.castShadow = false;
    blanket.receiveShadow = true;
    blanket.userData.noShadow = true;
    rug.add(blanket);
    // A wicker hamper on the back corner, away from the Life chapter's camera: a pale wicker basket,
    // a slightly darker lid and an arched cane handle over it, so it reads as a basket, not a box.
    const hamper = new T.Group();
    hamper.position.set(-0.32, 0, -0.17);
    hamper.rotation.y = -0.18;
    rug.add(hamper);
    box(hamper, 0, 0.12, 0, 0.42, 0.24, 0.3, '#b08a5c', 'wood');
    box(hamper, 0, 0.265, 0, 0.45, 0.05, 0.33, '#9c7850', 'wood');
    const handle = new T.Mesh(new T.TorusGeometry(0.1, 0.016, 6, 12, Math.PI), material(palette.woodDark, 'wood'));
    handle.position.y = 0.29; // the arch stands on the lid along the basket's length
    handle.castShadow = handle.receiveShadow = true;
    hamper.add(handle);
    return rug;
  }
  /**
   * The Duke of Wellington as Glasgow knows him: a bronze rider on a walking horse, an orange
   * traffic cone on his head, on a grey granite plinth over a 12-sided paved pad (about 3.6 to the
   * cone's tip). The bronze is sculpted (town-sculpt.ts): the horse's barrel, arched neck and
   * bowed head, its legs (the near foreleg lifted mid-stride) and its tail are blended solids, as
   * is the Duke in his cloak and riding boots, one hand on the reins and the other resting on his
   * thigh, all one closed casting on a bronze base plate. Its colour is painted on the vertices:
   * a dark patina, verdigris settled on the tops and in the hollows (and a little run down the
   * flanks), and the bright bronze the hands of passers-by have rubbed on the horse's knees and
   * muzzle and the Duke's boot toes. The plinth has a base moulding, a die with a plain raised
   * panel on each face (no inscription), and a cornice whose top the plate stands on.
   */
  function wellington(g: T.Object3D) {
    const [x, z] = plan.statueSpot;
    const root = new T.Group();
    root.position.set(x, 0, z);
    root.rotation.y = plan.statueHeading;
    g.add(root);
    const pad = new T.Mesh(new T.CylinderGeometry(1.6, 1.6, 0.1, 12), material(palette.plazaDark, 'paving'));
    pad.position.y = 0.05;
    pad.receiveShadow = true;
    root.add(pad);
    const solid = (geometry: T.BufferGeometry, colour: string, kind: SurfaceKind) => {
      const m = new T.Mesh(geometry, material(colour, kind));
      m.castShadow = m.receiveShadow = true;
      root.add(m);
      return m;
    };
    // The plinth: a plain base block with a torus and a cove up to the die (battered 0.01), and a
    // cornice (cove, corona, rounded top edge) in its own mesh, which batching takes as the
    // overhang that shades the die's head.
    const [HX, HZ] = [0.75, 1.15],
      y0 = 1.43;
    solid(mouldedBlock(HX, HZ, [
      { s: 0, y: 0.1, sharp: true }, { s: 0, y: 0.22, sharp: true }, { s: 0.03, y: 0.22, sharp: true },
      { s: 0.042, y: 0.235 }, { s: 0.036, y: 0.26 }, { s: 0.046, y: 0.284 }, { s: 0.07, y: 0.298, sharp: true },
      { s: 0.1, y: 0.305 }, { s: 0.12, y: 0.33 }, { s: 0.13, y: 0.36, sharp: true }, { s: 0.14, y: 1.2, sharp: true },
    ]), STATUE.granite, 'stone');
    solid(mouldedBlock(HX, HZ, [
      { s: 0.15, y: 1.19, sharp: true }, { s: 0.135, y: 1.215 }, { s: 0.11, y: 1.245 }, { s: 0.08, y: 1.27 },
      { s: 0.06, y: 1.285, sharp: true }, { s: 0.06, y: 1.37, sharp: true }, { s: 0.072, y: 1.405 }, { s: 0.1, y: y0, sharp: true },
    ]), STATUE.cornice, 'stone');
    // A plain raised panel on each face of the die (0.035 proud, bevelled), never lettered.
    for (const s of [-1, 1]) {
      box(root, s * 0.612, 0.78, 0, 0.07, 0.56, 1.5, STATUE.panel, 'stone', { bevel: 0.025 });
      box(root, 0, 0.78, s * 1.012, 0.86, 0.56, 0.07, STATUE.panel, 'stone', { bevel: 0.025 });
    }
    // The bronze plate the horse stands on (a band, so batching never takes it for an overhang).
    box(root, 0, y0 + 0.02, 0, 0.64, 0.06, 1.36, STATUE.plate, 'iron', { bevel: 0.025 }).userData.band = true;
    const casting = bronzeCasting(),
      bronze = solid(casting.geometry, '#ffffff', 'iron');
    bronze.position.y = y0 + 0.05;
    // The cone, knocked askew on the Duke's head: an orange square foot, the cone and its white band.
    const hat = new T.Group();
    hat.position.set(casting.crown[0], y0 + 0.05 + casting.crown[1] + 0.004, casting.crown[2]);
    hat.rotation.set(-0.08, 0, 0.17);
    root.add(hat);
    box(hat, 0, 0.012, 0, 0.27, 0.03, 0.27, palette.tramOrange, 'enamel', { bevel: 0.012 });
    const coneShape = (r0: number, r1: number, y0c: number, y1c: number) =>
      new T.LatheGeometry([[0, y0c], [r0, y0c], [r0 * 0.98, y0c + 0.008], [r1 * 1.02, y1c - 0.008], [r1, y1c], [0, y1c]].map(([r, y]) => new T.Vector2(r, y)), 20);
    const conePart = (r0: number, r1: number, a: number, b: number, colour: string) => {
      const m = new T.Mesh(coneShape(r0, r1, a, b), material(colour, 'enamel'));
      m.castShadow = m.receiveShadow = true;
      hat.add(m);
    };
    // Height 0.36 from r 0.105 at y 0.025 to a rounded tip: the band stands 0.004 proud between 0.15 and 0.215.
    const rAt = (y: number) => 0.105 + (0.016 - 0.105) * ((y - 0.025) / 0.335);
    conePart(0.105, 0.016, 0.025, 0.36, palette.tramOrange);
    conePart(rAt(0.15) + 0.004, rAt(0.215) + 0.004, 0.15, 0.215, palette.white);
    return root;
  }
  /**
   * The casting's geometry in the plate's frame (y 0 on its top, the horse facing +z, its near
   * side +x, the side the opening view sees), its colour on the vertices. The sculpt grid is
   * 0.025: finer things (the ears, the bridle, the reins, the stirrups and their leathers) are
   * small meshes of their own, merged in.
   */
  function bronzeCasting() {
    type V = [number, number, number];
    const add = (a: V, b: V, k = 1): V => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
    const G = 0.025,
      lo: V = [-0.38, -0.04, -0.94],
      hi: V = [0.38, 1.86, 1.08];
    const horse = sculpt(lo, hi, G);
    // The body, compact and deep, Clash-chunky: barrel, chest and croup, the two lobes of the
    // breast, the withers and the dock; then the haunches and the sloped shoulders on each side.
    horse
      .add(ellipsoid([0, 0.74, -0.02], [0.2, 0.225, 0.42]))
      .add(ellipsoid([0, 0.75, 0.27], [0.19, 0.235, 0.22]), 0.1)
      .add(ellipsoid([0, 0.79, -0.33], [0.195, 0.23, 0.25]), 0.1)
      .add(ellipsoid([0, 0.92, 0.2], [0.075, 0.07, 0.16]), 0.08)
      .add(ellipsoid([0, 0.93, -0.55], [0.06, 0.065, 0.07]), 0.06);
    for (const s of [-1, 1])
      horse
        .add(ellipsoid([s * 0.07, 0.66, 0.43], [0.085, 0.11, 0.075]), 0.06)
        .add(ellipsoid([s * 0.085, 0.76, -0.37], [0.125, 0.2, 0.21]), 0.08)
        .add(ellipsoid([s * 0.095, 0.76, 0.3], [0.105, 0.2, 0.12], [-0.35, 0, 0]), 0.06);
    // A saddle cloth over the barrel (a rounded outline, a soft rolled edge) and a girth under it,
    // laid over the body as blended so far; the saddle itself, with its pommel and cantle.
    horse
      .layer(roundBox([0, 0.83, -0.06], [0.32, 0.17, 0.26], 0.12), 0.03, 0.05)
      .layer(roundBox([0, 0.5, 0.13], [0.32, 0.25, 0.035], 0.02), 0.022, 0.025)
      .add(ellipsoid([0, 0.975, -0.06], [0.165, 0.06, 0.21]), 0.03)
      .add(ellipsoid([0, 1.03, -0.22], [0.12, 0.05, 0.05]), 0.03)
      .add(ellipsoid([0, 1.02, 0.12], [0.07, 0.045, 0.045]), 0.03);
    // The neck, arched, thick and deeper than it is wide.
    const N: V[] = [[0, 0.84, 0.36], [0, 1.05, 0.5], [0, 1.22, 0.6], [0, 1.34, 0.65]],
      NR = [0.175, 0.15, 0.12, 0.1];
    horse.add(squashX(strand(N, NR), 0.74), 0.1);
    // The head, big and bowed: P the poll, D from the poll to the muzzle's tip, F the way the face looks.
    const P: V = [0, 1.37, 0.67],
      D: V = [0, -0.3, 0.25],
      F: V = [0, 0.64, 0.768],
      H = (t: number, f = 0, side = 0): V => add(add(add(P, D, t), F, f), [side, 0, 0]),
      tilt: V = [0.876, 0, 0];
    horse
      .add(ellipsoid(H(0.14, 0.0), [0.1, 0.1, 0.125], tilt), 0.07) // cranium
      .add(ellipsoid(H(0.42, -0.08), [0.092, 0.1, 0.1], tilt), 0.05) // the round jowl
      .add(squashX(roundCone(H(0.18, 0.02), H(0.82), 0.078, 0.062), 0.86), 0.05) // the face
      .add(ellipsoid(H(0.86, -0.025), [0.074, 0.07, 0.082], tilt), 0.04) // muzzle
      .add(ellipsoid(H(0.84, -0.1), [0.05, 0.035, 0.052], tilt), 0.025) // lower lip
      .add(ellipsoid(H(0.05, 0.075), [0.042, 0.024, 0.06], tilt), 0.02); // the forelock
    for (const s of [-1, 1])
      horse
        .add(ellipsoid(H(0.9, 0.0, s * 0.045), [0.026, 0.03, 0.028], tilt), 0.015) // flared nostrils
        .add(ellipsoid(H(0.26, 0.03, s * 0.083), [0.024, 0.03, 0.036], tilt), 0.012) // eyes
        .add(ellipsoid(H(0.2, 0.06, s * 0.07), [0.026, 0.018, 0.045], tilt), 0.015); // brows
    // The mane: a rolled crest from poll to withers and six broad locks along it, each leaning a
    // little to the off side, so the crest's line is scalloped.
    const crest = (t: number): V => {
      const u = t * (N.length - 1),
        i = Math.min(N.length - 2, Math.floor(u)),
        f = u - i,
        a = N[i],
        b = N[i + 1],
        r = NR[i] + (NR[i + 1] - NR[i]) * f,
        l = Math.hypot(b[1] - a[1], b[2] - a[2]);
      return add(add(a, [0, b[1] - a[1], b[2] - a[2]], f), [0, (b[2] - a[2]) / l, -(b[1] - a[1]) / l], r * 0.86);
    };
    horse.add(strand([0.98, 0.7, 0.4, 0.08].map(crest), [0.032, 0.04, 0.044, 0.036]), 0.04);
    for (let i = 0; i < 6; i++) {
      const c = crest(0.93 - i * 0.165);
      horse.add(ellipsoid(add(c, [-0.014, 0.012, 0]), [0.034, 0.05, 0.055], [-0.55, 0, 0.35]), 0.03);
    }
    // The legs through their joints, each one smooth strand: forearm or gaskin, knee or hock,
    // cannon, fetlock and pastern; the knees and fetlocks rounded out and the hooves flat-soled.
    // The off foreleg (-x, the side the opening view sees) is lifted mid-stride, its knee forward
    // and its hoof tucked back.
    const hoof = (a: V, b: V, flat: boolean) => {
      const c = roundCone(a, b, 0.05, 0.066);
      horse.add(flat ? within(c, roundBox([b[0], 0.08, b[2]], [0.12, 0.08, 0.12], 0), 0.012) : c, 0.015);
    };
    const leg = (pts: V[], r: number[], flat: boolean) => {
      horse.add(strand(pts.slice(0, -1), r), 0.08);
      horse.add(ellipsoid(pts[2], [0.062, 0.066, 0.066]), 0.03).add(ellipsoid(pts[3], [0.054, 0.052, 0.058]), 0.02);
      hoof(pts[pts.length - 2], pts[pts.length - 1], flat);
    };
    leg([[0.1, 0.66, 0.31], [0.1, 0.5, 0.36], [0.1, 0.33, 0.38], [0.1, 0.12, 0.38], [0.1, 0.075, 0.405], [0.1, 0.0, 0.43]], [0.1, 0.08, 0.06, 0.052, 0.046], true);
    leg([[-0.1, 0.66, 0.31], [-0.1, 0.52, 0.42], [-0.1, 0.42, 0.52], [-0.1, 0.22, 0.47], [-0.1, 0.175, 0.43], [-0.1, 0.12, 0.375]], [0.1, 0.08, 0.06, 0.052, 0.046], false);
    // Hind: the gaskin from the stifle, the hock (and its point), the cannon and fetlock; the far one steps forward.
    for (const [s, step] of [[-1, 0], [1, 0.07]] as const) {
      const X = s * 0.11;
      leg([[X, 0.68, -0.33], [X, 0.5, -0.27 + step * 0.4], [X, 0.32, -0.44 + step], [X, 0.12, -0.42 + step], [X, 0.075, -0.395 + step], [X, 0.0, -0.37 + step]], [0.11, 0.085, 0.06, 0.052, 0.046], true);
      horse.add(ellipsoid([X, 0.34, -0.48 + step], [0.036, 0.04, 0.036]), 0.02);
    }
    // The tail: carried off the dock in an arch, then falling full to below the hocks in three
    // locks that part a little towards their tips, grooved where they meet.
    const TAIL: V[] = [[0, 0.93, -0.58], [0, 0.91, -0.68], [0, 0.8, -0.75], [0.01, 0.62, -0.765], [0.02, 0.45, -0.745], [0.03, 0.31, -0.71]];
    horse.add(strand(TAIL, [0.05, 0.055, 0.06, 0.062, 0.054, 0.036]), 0.05);
    for (const s of [-1, 1])
      horse.add(strand(TAIL.slice(2).map((p, i): V => add(p, [s * (0.03 + 0.016 * i), 0.012 * i * (s + 2) - 0.01, -0.006 * i])), [0.05, 0.052, 0.044, 0.03]), 0.025);
    // The Duke, chunky, with a big head: seat, coat and chest, square shoulders under a cloak that
    // hangs down his back and spreads over the croup, a high collar, and a round head
    // with a strong nose, a brow, ears and hair under the cone; his coat's skirts fall over the saddle.
    const duke = sculpt(lo, hi, G);
    duke
      .add(ellipsoid([0, 1.07, -0.07], [0.14, 0.08, 0.13]))
      .add(roundCone([0, 1.12, -0.07], [0, 1.3, -0.06], 0.112, 0.12), 0.05)
      .add(ellipsoid([0, 1.29, -0.035], [0.12, 0.09, 0.09]), 0.04);
    for (const s of [-1, 1])
      duke
        .add(ellipsoid([s * 0.122, 1.35, -0.06], [0.066, 0.055, 0.066]), 0.04) // shoulder
        .add(roundBox([s * 0.15, 0.99, -0.1], [0.03, 0.09, 0.1], 0.025, [0.1, 0, s * 0.3]), 0.035); // coat skirt
    // The cloak: a layer over his back and shoulders, its hem spread on the croup behind the saddle.
    duke
      .layer(roundBox([0, 1.22, -0.2], [0.24, 0.25, 0.15], 0.06), 0.028, 0.04)
      .add(ellipsoid([0, 1.0, -0.26], [0.19, 0.065, 0.13]), 0.07);
    duke
      .add(torus([0, 1.405, -0.06], 0.06, 0.03), 0.03) // high collar
      .add(roundCone([0, 1.4, -0.05], [0, 1.46, -0.04], 0.05, 0.05), 0.02) // neck
      .add(ellipsoid([0, 1.565, -0.03], [0.11, 0.12, 0.11]), 0.03) // head
      .add(ellipsoid([0, 1.482, 0.01], [0.08, 0.06, 0.08]), 0.04) // jaw and chin, sunk in the collar
      .add(ellipsoid([0, 1.576, 0.068], [0.064, 0.014, 0.022]), 0.02) // brow
      .add(roundCone([0, 1.552, 0.08], [0, 1.53, 0.102], 0.026, 0.026), 0.035) // a broad, soft nose
      .add(ellipsoid([0, 1.585, -0.065], [0.112, 0.1, 0.09]), 0.02); // hair
    for (const s of [-1, 1]) {
      duke
        .add(ellipsoid([s * 0.107, 1.545, -0.03], [0.018, 0.03, 0.022]), 0.01) // ear
        // Thigh down the flank to the knee, a riding boot with its wide top, and the foot in the stirrup.
        .add(roundCone([s * 0.08, 1.07, -0.04], [s * 0.215, 0.93, 0.12], 0.075, 0.062), 0.04)
        .add(ellipsoid([s * 0.215, 0.93, 0.12], [0.064, 0.064, 0.064]), 0.03)
        .add(roundCone([s * 0.22, 0.92, 0.12], [s * 0.262, 0.68, 0.07], 0.058, 0.05), 0.02)
        .add(ellipsoid([s * 0.222, 0.875, 0.11], [0.074, 0.045, 0.074]), 0.015)
        .add(ellipsoid([s * 0.27, 0.64, 0.12], [0.05, 0.045, 0.1]), 0.03);
    }
    // Left hand (+x) on the reins over the withers, the right arm resting, its fist on his thigh;
    // both in gauntlets with a flared cuff.
    const arm = (pts: V[], fist: V) => {
      duke
        .add(strand(pts, [0.058, 0.05, 0.042]), 0.05)
        .add(ellipsoid(add(pts[2], add(fist, pts[2], -1), -0.4), [0.05, 0.05, 0.05]), 0.015)
        .add(ellipsoid(fist, [0.046, 0.044, 0.05]), 0.015);
    };
    arm([[0.14, 1.35, -0.06], [0.235, 1.21, 0.0], [0.13, 1.15, 0.14]], [0.1, 1.15, 0.18]);
    arm([[-0.14, 1.35, -0.06], [-0.24, 1.2, -0.07], [-0.215, 1.08, 0.05]], [-0.2, 1.045, 0.1]);
    horse.union(duke, 0.06);
    const cast = horse.mesh();
    // The top of his head, where the cone sits.
    let top = 1.85;
    while (top > 1.4 && horse.exact(0, top, -0.03) > 0) top -= 0.002;
    // Small parts: the ears (pricked forward), the bridle (noseband, cheek straps, browband), the
    // reins (bit to fist, clear of the neck) and the stirrups on their leathers.
    const extras: T.BufferGeometry[] = [];
    const ear = new T.LatheGeometry([[0, 0], [0.03, 0.022], [0.035, 0.055], [0.022, 0.095], [0.004, 0.124], [0, 0.126]].map(([r, y]) => new T.Vector2(r, y)), 8);
    for (const s of [-1, 1]) {
      const e = ear.clone().scale(1, 1, 0.6).applyMatrix4(new T.Matrix4().makeRotationFromEuler(new T.Euler(0.3, 0, -s * 0.25)));
      const at = H(0.03, 0.04, s * 0.052);
      extras.push(e.translate(at[0], at[1], at[2]));
    }
    /** Move a point along the field's gradient until it is gap from the casting (`out`: only ever outwards). */
    const settle = (p: V, gap: number, out: boolean): V => {
      let q = p;
      for (let i = 0; i < 6; i++) {
        const d = horse.exact(...q);
        if (out ? d >= gap : Math.abs(d - gap) < 0.001) break;
        const e = 0.01,
          gx = horse.exact(q[0] + e, q[1], q[2]) - horse.exact(q[0] - e, q[1], q[2]),
          gy = horse.exact(q[0], q[1] + e, q[2]) - horse.exact(q[0], q[1] - e, q[2]),
          gz = horse.exact(q[0], q[1], q[2] + e) - horse.exact(q[0], q[1], q[2] - e),
          l = Math.hypot(gx, gy, gz) || 1;
        q = add(q, [gx / l, gy / l, gz / l], gap - d);
      }
      return q;
    };
    const away = (p: V, gap: number) => settle(p, gap, true),
      onto = (p: V, gap: number) => settle(p, gap, false);
    const tube = (pts: V[], r: number, closed = false, n = 16) =>
      new T.TubeGeometry(new T.CatmullRomCurve3(pts.map((p) => new T.Vector3(...p)), closed, 'centripetal'), n, r, 5, closed);
    /** A strap round the head at t along it, hugging the surface by gap. */
    const band = (t: number, gap: number) =>
      Array.from({ length: 10 }, (_, i): V => {
        const a = (i / 10) * Math.PI * 2;
        return onto(H(t, 0.11 * Math.cos(a), 0.11 * Math.sin(a)), gap);
      });
    extras.push(tube(band(0.62, 0.008), 0.011, true, 20)); // noseband
    for (const s of [-1, 1]) {
      extras.push(tube([onto(H(0.62, -0.02, s * 0.1), 0.008), onto(H(0.36, -0.03, s * 0.1), 0.008), onto(H(0.08, -0.02, s * 0.1), 0.008)], 0.011)); // cheek strap
      // Each rein runs from the bit up the side of the neck to the left fist.
      const bit = away(H(0.8, -0.06, s * 0.08), 0.004);
      extras.push(new T.TorusGeometry(0.022, 0.007, 4, 10).rotateY(Math.PI / 2).translate(bit[0], bit[1], bit[2]));
      extras.push(tube([bit, away(H(0.55, -0.1, s * 0.12), 0.03), away([s * 0.1, 1.17, 0.42], 0.03), [0.1 + s * 0.012, 1.15, 0.19]], 0.012, false, 20));
      // The stirrup round the foot's ball, hung on its leather from the saddle's flap.
      const foot: V = [s * 0.27, 0.6, 0.15];
      extras.push(new T.TorusGeometry(0.06, 0.013, 5, 14).scale(1, 1, 0.8).translate(foot[0], foot[1] + 0.02, foot[2]));
      extras.push(tube([away([s * 0.16, 0.95, -0.02], 0.004), away([s * 0.24, 0.78, 0.09], 0.012), [foot[0], foot[1] + 0.08, foot[2]]], 0.01, false, 10));
    }
    const rubbed: [V, number][] = [
      [[0.1, 0.33, 0.39], 0.07], [[-0.1, 0.42, 0.54], 0.07], [H(0.92, 0), 0.07], // knees, the muzzle
      [[0.27, 0.64, 0.21], 0.06], [[-0.27, 0.64, 0.21], 0.06], [[0.1, 1.15, 0.21], 0.05], // boot toes, the rein fist
    ];
    const geometry = mergeGeometries([cast, ...extras].map((p) => {
      for (const n of Object.keys(p.attributes)) if (n !== 'position' && n !== 'normal') p.deleteAttribute(n);
      patina(p, horse.sample, rubbed); // on the shared vertices, before they are split
      return p.index ? p.toNonIndexed() : p;
    }))!;
    return { geometry, crown: [0, top, -0.03] as V };
  }
  /**
   * The bronze's colour on its vertices: a dark warm patina, varied gently over the form; verdigris
   * where rain sits (faces turned up) and in the hollows the field's own occlusion finds, run down
   * the sides below in soft vertical streaks; the hollows darker still; and a worn bright bronze
   * on the rubbed spots, fading out over their radius.
   */
  function patina(geometry: T.BufferGeometry, field: (x: number, y: number, z: number) => number, rubbed: [[number, number, number], number][]) {
    const p = geometry.getAttribute('position'),
      n = geometry.getAttribute('normal'),
      out = new Float32Array(p.count * 3),
      base = new T.Color(STATUE.patina),
      green = new T.Color(STATUE.verdigris),
      worn = new T.Color(STATUE.worn),
      c = new T.Color(),
      steps = [0.03, 0.07, 0.13, 0.22],
      weights = [1, 0.75, 0.5, 0.35];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i),
        nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
      let occ = 0, wsum = 0;
      steps.forEach((d, k) => {
        const f = Math.min(field(x + nx * d, y + ny * d, z + nz * d), d);
        occ += weights[k] * T.MathUtils.clamp((d - f) / d, 0, 1);
        wsum += weights[k];
      });
      // The plate's top occludes the hooves and the lowest tail.
      const ao = (1 - occ / wsum) * T.MathUtils.lerp(0.6, 1, T.MathUtils.smoothstep(y, 0, 0.16) * 0.7 + 0.3 * (ny > 0 ? 1 : 0));
      const up = T.MathUtils.smoothstep(ny, 0.3, 0.9),
        side = 1 - T.MathUtils.smoothstep(Math.abs(ny), 0.35, 0.7),
        // Streaks: narrow across, long down the form, only on the sides.
        streak = T.MathUtils.smoothstep(noise3(x * 16 + z * 3, y * 1.3, z * 16 - x * 3), 0.55, 0.8) * side,
        vg = T.MathUtils.clamp(0.9 * up * (0.45 + 0.55 * noise3(x * 6 + 3, y * 6, z * 6)) + 0.45 * Math.pow(1 - ao, 0.8) + 0.4 * streak, 0, 0.85);
      c.copy(base).multiplyScalar(0.88 + 0.24 * noise3(x * 3.1, y * 3.1, z * 3.1)).lerp(green, vg);
      c.multiplyScalar(T.MathUtils.lerp(0.5, 1, ao));
      let rub = 0;
      for (const [[cx, cy, cz], r] of rubbed) rub = Math.max(rub, T.MathUtils.smoothstep(r - Math.hypot(x - cx, y - cy, z - cz), 0, r * 0.8));
      c.lerp(worn, rub * 0.6);
      c.toArray(out, i * 3);
    }
    geometry.setAttribute('color', new T.BufferAttribute(out, 3));
  }
  return { bench, cycleHoop, lamp, trafficSignals, phoneBox, bin, pavilion, memoryBoard, crane, picnic, wellington };
}
export type Props = ReturnType<typeof createProps>;
