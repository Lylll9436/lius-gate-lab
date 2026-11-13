import * as T from 'three';
import type { SurfaceKind } from './city-materials';
import * as plan from './town-plan';
import { palette, hash, type TownContext } from './town-shared';
import { noise3, roundBox, roundCone, sculpt, type Shape } from './town-sculpt';
import type { Kit } from './town-kit';
import type { Nature } from './town-nature';
import type { Props } from './town-props';

/**
 * The sky island's colours, each no more saturated than its palette family: the lawn's two mown
 * greens (the town lawn's stripes); the coping's weathered stone, a step greyer and darker than
 * the kerb's buff, so the villa's pale dressings stay the brightest stone on the island; the
 * paths' pale gravel, between the pavement's and the park path's. Under the deck, the earth in
 * three beds from the warm brown under the turf down to a darker brown (well under the soil's
 * saturation, near the armour's greys in value), parted by pale seams; and the rock that stands
 * out of it and makes the spike, in warm greys, lighter where it faces the sky. Then the villa's
 * stand-in massing: the town's brick, the residence's pale dressing stone, the kerb's buff for its
 * base, terrace and steps, the town's mid slate and terracotta cans.
 */
export const SKY_LOOK = {
  lawn: [palette.grassDark, palette.grassLight],
  coping: '#b9b19c',
  path: '#c6b08a',
  earth: ['#8d6c4f', '#7a5c44', '#665041'],
  seam: '#a2998a',
  rock: ['#9e988c', '#86817a', '#6f6b65'],
  brick: palette.brick,
  dressing: '#ece4d1',
  base: palette.kerb,
  slate: palette.slate,
  pots: palette.pantile,
};
/**
 * The lawn: mown in stripes `stripe` wide that run the deck's length (north-south, past the
 * villa's front), each stripe's triangles one flat colour, so no texture can shimmer (the town
 * lawn's checker is drawn by the ground shader from the masks, which do not know this island). It
 * is laid out to `edge` of the way to the rim, under the coping, in `rows` rows a stripe.
 */
export const SKY_LAWN = { stripe: 0.8, edge: 0.95, rows: 40 };
/**
 * The coping round the rim: chunky stones laid end to end, as a profile swept round it (o out from
 * the rim's line, y from SKY.top), listed from its inner foot under the turf, over its top (0.11
 * proud of the lawn beside it) and round its nose (the deck's widest ring, SKY.ring down) to its
 * underside, which runs back in and ends inside the rock's flat top. `stones` of them, each
 * `stations` stations long: at the joint between two the profile's outer half (the top's outer
 * edge, the nose and the underside) draws in by `joint` (a soft V, never a slit), and each stone's
 * sits up to `set` lower and further in than the next; each is a shade of its own within `tone`.
 * No stone reaches past the nose's line: the rim is the deck's outline.
 */
export const SKY_COPING = {
  profile: [[-0.46, -0.32], [-0.46, -0.19], [-0.41, -0.14], [-0.14, -0.14], [-0.04, -0.18], [0, -plan.SKY.ring], [-0.04, -0.36], [-0.14, -0.43], [-0.34, -0.47], [-0.62, -0.5]] as [number, number][],
  stones: 44,
  stations: 4,
  joint: 0.045,
  set: 0.025,
  tone: 0.06,
};
/**
 * One lobe of the underside, placed by the world bearing it hangs on (0 south, 90 east, as
 * everywhere in the plan): `proud`, how far its outer face stands past the rim (negative: inside
 * it); `y`, its middle under SKY.top; `radial`, `tangential` and `vertical`, its half sizes (along
 * the bearing, across it and up); `tilt`, a small lean about the deck's long axis; `rock`, whether
 * it is rock standing out of the earth or the earth's own shoulder.
 */
type Lobe = { bearing: number; proud: number; y: number; radial: number; tangential: number; vertical: number; tilt: number; rock: boolean };
const lobe = (bearing: number, proud: number, y: number, radial: number, tangential: number, vertical: number, tilt: number, rock = false): Lobe => ({ bearing, proud, y, radial, tangential, vertical, tilt, rock });
/**
 * The underside, in the deck's own frame (x along its long axis, north; z east; y from SKY.top):
 * solids blended in a distance grid of spacing `grid` (town-sculpt), so it is one smooth mass with
 * no facet. The earth is a cone of the deck's own ellipse (`cone`): `share` of the rim where it
 * starts, `top` under SKY.top inside the coping (where the whole mass is cut flat, under the
 * turf), running down to the tip and narrowing fast at first (`power` over 1: a concave flank),
 * so that from the town's high camera the mass shows as shoulders over a spike, not as a bowl. A
 * round cone (`tip`: from this height, its two radii, its fillet, and how far the blend swells it)
 * blunts the point. The lobes (Lobe, each blended in with a fillet of `fillet`, its edges rounded
 * by `round` of its least half size) are the earth's chunky shoulders hung under the rim and the
 * rock that stands out of the flank lower down:
 * - The two deep shoulders hang on the east and west flanks, 45 degrees from every Rotate stop and
 *   55 from the file's bearing. The north and south ends of the deck stand furthest out toward
 *   those cameras, so what hangs there is shallow (and on the north, the plane's side, inside the
 *   rim): from every one of the five bearings the spike is the lowest thing on screen (check-town
 *   holds it at least half a unit clear).
 * - The rock outcrops sit on the east and west flanks too, and close in round the spike.
 * The earth's beds change at `beds` (depths under SKY.top) by a wandering line (`wander`), each
 * change marked by a pale seam (`seam`: whole within its first number of the line, gone by its
 * second; at least two grid spacings across, so the vertices draw it as one soft band and never as
 * a row of dots). From `spike` down the earth gives way to rock, as at the reference's point (and
 * every face down there looks away from the light: in the earth's darkest brown it read as a
 * hole), which darkens a little from `beds[2]` to the tip. A vertex is also rock where it lies
 * within `outcrop[0]` of a rock lobe's own surface, fading to earth by `outcrop[1]`.
 */
export const SKY_ROCK = {
  grid: 0.25,
  cone: { top: 0.42, share: 0.953, power: 1.3 },
  tip: { from: -7.3, r: [0.5, 0.25] as [number, number], fillet: 0.5, swell: 0.11 },
  lobes: [
    // The earth's shoulders: deep on the east and west flanks, shallow at the ends and between.
    // Every one's top stays under the flat cut beneath the turf (0.5 down), so no crease is cut.
    lobe(90, 0.2, -1.375, 1.1, 1.7, 0.875, -0.06),
    lobe(270, 0.2, -1.425, 1.15, 1.8, 0.925, 0.06),
    lobe(-8, 0.05, -0.8, 0.75, 1.0, 0.3, 0.08),
    lobe(180, -0.5, -0.9, 0.9, 1.2, 0.4, 0.05),
    lobe(112, 0.1, -1.0, 0.75, 0.8, 0.5, 0.1),
    lobe(252, 0.1, -1.05, 0.75, 0.85, 0.5, -0.1),
    lobe(205, -0.3, -0.8, 0.6, 0.7, 0.3, 0.08),
    lobe(158, -0.3, -0.8, 0.6, 0.7, 0.3, -0.08),
    // Rock standing out of the flanks under the shoulders, and close in round the spike.
    lobe(90, -1.6, -3.0, 0.85, 1.0, 0.8, 0.12, true),
    lobe(270, -1.7, -3.2, 0.85, 0.95, 0.75, -0.1, true),
    lobe(100, -3.6, -4.6, 0.5, 0.55, 0.5, 0.1, true),
    lobe(260, -3.7, -4.9, 0.5, 0.5, 0.45, -0.1, true),
  ],
  round: 0.5,
  fillet: 0.6,
  cut: 0.2,
  beds: [1.7, 3.7, 6.4],
  seam: [0.1, 0.32] as [number, number],
  spike: [4.1, 5.0] as [number, number],
  wander: 0.5,
  outcrop: [0.12, 0.45],
};
/** How far below the deck's level the villa's stand-in massing runs on, so the lawn's soft dome never shows a gap under it (lane V's VILLA.foot). */
const FOOT = -0.3;

/**
 * A cone of an ellipse (half-axes a and b, its axis the y axis), for town-sculpt: `share` of the
 * ellipse at y -top, down to a point at y -depth, its radius falling as the `power` of the way
 * left to go. A bound that is close to the true distance near its surface.
 */
function ellipticCone(a: number, b: number, top: number, depth: number, share: number, power: number): Shape {
  // The flank's lean at its flattest (on the long axis, where it leaves the rim), so the bound never overstates the distance.
  const lean = Math.cos(Math.atan((share * power * Math.max(a, b)) / (depth - top)));
  return {
    d(x, y, z) {
      const left = 1 - (-y - top) / (depth - top),
        out = Math.hypot(x / a, z / b);
      if (left <= 0) return Math.hypot(out * Math.min(a, b), -y - depth);
      return (out - share * Math.min(1, left) ** power) * Math.min(a, b) * lean;
    },
    min: [-a * share, -depth, -b * share],
    max: [a * share, -top + 1, b * share],
  };
}
/** A lobe as a solid in the deck's own frame: its middle on its bearing, its radial half along it. */
function lobeShape(l: Lobe, round: number): Shape {
  const S = plan.SKY,
    b = (l.bearing * Math.PI) / 180,
    // The bearing's direction in the deck's frame (x north, z east), and the rim's radius along it.
    dx = -Math.cos(b),
    dz = Math.sin(b),
    rim = 1 / Math.hypot(dx / S.a, dz / S.b),
    r = rim + l.proud - l.radial;
  return roundBox([r * dx, l.y, r * dz], [l.radial, l.vertical, l.tangential], round * Math.min(l.radial, l.vertical, l.tangential), [l.tilt, Math.atan2(-dz, dx), 0]);
}
/** One point of a swept band: where it is, its outward normal (in x, z) and its base height. */
type Station = { x: number; z: number; nx: number; nz: number; y: number };
/**
 * A garden piece's place on the island, as lane G's builders take it: where its own frame's origin
 * goes and its rotation.y (its local +z turns to that bearing, as a site's front does).
 */
export type SkySlot = { x: number; y: number; z: number; ry: number };
/**
 * Where each of lane G's garden pieces (town-sky-garden's createSkyGarden) stands; each builds in a
 * frame of its own, y 0 its foot (a lamp set's spots are in its group's frame):
 * - `tea`: teaTable(), its middle on the lawn, turned so its -x chair (hers) faces SKY_STATIONS'.
 * - `telescope`: telescope(), the tripod's middle, looking along its +z at the Town Hall.
 * - `bench`: props.bench(), facing the town.
 * - `tree`: nature.tree() (which stands a tree on the town's terrain: move its group up to `y`).
 * - `borders`: nature.flowerBed() for each (east, then west): its middle, `w` along the terrace
 *   and `d` deep.
 * - `lamps`: gardenLamps(spots), one set, its group at the island's middle (south of the
 *   airport's lamps' line), the spots each lamp's foot in that group's frame.
 * - `falls`: fall({ rise }) for each: the rim point at the deck's level, turned out over the sea.
 * - `clouds` and `rocks`: cloud({ size, seed }) and floatingRock({ size, seed }), where the plan's
 *   SKY_CLOUDS and SKY_ROCKS put them (in the air, so `y` is theirs, not the lawn's).
 * Pieces on the deck stand on the lawn (plan.skyTop).
 */
export function skySlots() {
  const on = (x: number, z: number, ry = 0): SkySlot => ({ x, y: plan.skyTop(x, z), z, ry }),
    { tea, telescope, bench } = plan.SKY_STATIONS,
    border = (b: (typeof plan.SKY_BORDERS)['east']) => ({ ...on((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2), w: b.x1 - b.x0, d: b.z1 - b.z0 }),
    lamps = on(plan.SKY.x, plan.SKY.z);
  return {
    tea: on(tea.x, tea.z, tea.ry),
    telescope: on(telescope.x, telescope.z, telescope.ry),
    bench: on(bench.x, bench.z, bench.ry),
    tree: on(plan.SKY_TREE.x, plan.SKY_TREE.z),
    borders: [border(plan.SKY_BORDERS.east), border(plan.SKY_BORDERS.west)],
    lamps: { ...lamps, spots: plan.SKY_LAMPS.map(([x, z]) => ({ x: x - lamps.x, y: plan.skyTop(x, z) - lamps.y, z: z - lamps.z })) },
    falls: plan.skyFalls.map((f) => ({ x: f.x, y: f.y, z: f.z, ry: f.ry, rise: f.rise })),
    clouds: plan.SKY_CLOUDS.map((c) => ({ ...c })),
    rocks: plan.SKY_ROCKS.map((r) => ({ ...r })),
  };
}

/* ------------------------------------------------------------------ */
/* The sky island                                                      */
/* ------------------------------------------------------------------ */
/**
 * The sky island's own ground: its lawn and paths, the rock under it and its coping, and a
 * stand-in massing for the villa. `props` and `nature` are for its garden (see skyGarden), which
 * is still to be planted; they stay in the signature, which is every site factory's.
 */
export function createSkyIsland(ctx: TownContext, kit: Kit, _props: Props, _nature: Nature) {
  const { material } = ctx;
  const { box, cylinder } = kit;
  const S = plan.SKY,
    L = SKY_LOOK;

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
  /** The lawn's own normal at (x, z): the dome's, so the stripes and the paths shade as one surface. */
  function lawnNormal(x: number, z: number) {
    const e = 0.05;
    return new T.Vector3(plan.skyTop(x - e, z) - plan.skyTop(x + e, z), 2 * e, plan.skyTop(x, z - e) - plan.skyTop(x, z + e)).normalize();
  }
  /**
   * A flat surface laid on the lawn, `lift` over it, from the triangles it is given (in x, z, any
   * winding: each is turned to face up); every vertex stands on the dome and takes its normal.
   */
  function draped(lift: number) {
    const pos: number[] = [],
      nor: number[] = [],
      colours: number[] = [];
    const put = (x: number, z: number, tone?: T.Color) => {
      pos.push(x, plan.skyTop(x, z) + lift, z);
      lawnNormal(x, z).toArray(nor, nor.length);
      if (tone) colours.push(tone.r, tone.g, tone.b);
    };
    return {
      triangle(a: plan.XZ, b: plan.XZ, c: plan.XZ, tone?: T.Color) {
        const turn = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
        if (Math.abs(turn) < 1e-9) return;
        for (const p of turn > 0 ? [a, b, c] : [a, c, b]) put(p[0], p[1], tone);
      },
      geometry() {
        const geometry = new T.BufferGeometry();
        geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
        geometry.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
        if (colours.length) geometry.setAttribute('color', new T.Float32BufferAttribute(colours, 3));
        return geometry;
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* The deck: lawn and paths                                          */
  /* ---------------------------------------------------------------- */
  /** The mown lawn (SKY_LAWN): stripes along the deck's long axis, alternately the darker and the lighter green. */
  function lawn(g: T.Object3D) {
    const { stripe, edge, rows } = SKY_LAWN,
      half = S.b * edge,
      // A stripe's ends follow the turf's outline: how far it runs either way at lz across the deck.
      reach = (lz: number) => S.a * edge * Math.sqrt(Math.max(0, 1 - (lz / half) ** 2)),
      tones = L.lawn.map((c) => new T.Color(c)),
      turf = draped(0);
    // The stripes' edges are whole stripes from the long axis, so the outermost stripe that shows
    // beside the coping is most of a stripe wide (0.74), never a sliver.
    const bounds = [-half];
    for (let k = Math.ceil(-half / stripe); k * stripe < half; k++) if (k * stripe > -half) bounds.push(k * stripe);
    bounds.push(half);
    for (let s = 0; s + 1 < bounds.length; s++) {
      const z0 = bounds[s],
        z1 = bounds[s + 1],
        tone = tones[Math.abs(Math.floor((z0 + z1) / 2 / stripe)) % 2],
        at = (lz: number, j: number) => plan.skyPoint(((2 * j) / rows - 1) * reach(lz), lz);
      for (let j = 0; j < rows; j++) {
        turf.triangle(at(z0, j), at(z1, j), at(z1, j + 1), tone);
        turf.triangle(at(z0, j), at(z1, j + 1), at(z0, j + 1), tone);
      }
    }
    solid(g, turf.geometry(), '#ffffff', 'grass', { shadow: false, ground: true, name: 'sky-lawn' });
  }
  /** The gravel paths (plan.SKY_PATHS), laid on the lawn: ribbons with round ends, and the round landing. */
  function paths(g: T.Object3D) {
    const P = plan.SKY_PATHS,
      half = P.width / 2,
      gravel = draped(P.lift);
    const disc = ([x, z]: plan.XZ, r: number, sides: number) => {
      const rim = (k: number): plan.XZ => [x + Math.cos((k / sides) * Math.PI * 2) * r, z + Math.sin((k / sides) * Math.PI * 2) * r];
      for (let k = 0; k < sides; k++) gravel.triangle([x, z], rim(k), rim(k + 1));
    };
    /** Points about 0.25 apart along the line through `points`: straight from one to the next, or one smooth curve through them all. */
    const along = (points: plan.XZ[], curved: boolean): plan.XZ[] => {
      if (curved) {
        const curve = new T.CatmullRomCurve3(points.map(([x, z]) => new T.Vector3(x, 0, z)), false, 'centripetal');
        return curve.getSpacedPoints(Math.ceil(curve.getLength() / 0.25)).map((v): plan.XZ => [v.x, v.z]);
      }
      return points.flatMap((a, i): plan.XZ[] => {
        const b = points[i + 1];
        if (!b) return [a];
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25));
        return Array.from({ length: steps }, (_, k): plan.XZ => [a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]);
      });
    };
    const ribbon = (line: plan.XZ[]) => {
      // A point's two edges: `half` either side of it, across the line's direction there.
      const edge = (i: number, side: number): plan.XZ => {
        const a = line[Math.max(0, i - 1)],
          b = line[Math.min(line.length - 1, i + 1)],
          l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [line[i][0] + (side * (b[1] - a[1]) * half) / l, line[i][1] - (side * (b[0] - a[0]) * half) / l];
      };
      for (let i = 0; i + 1 < line.length; i++) {
        gravel.triangle(edge(i, -1), edge(i, 1), edge(i + 1, 1));
        gravel.triangle(edge(i, -1), edge(i + 1, 1), edge(i + 1, -1));
      }
      disc(line[0], half, 16);
      disc(line[line.length - 1], half, 16);
    };
    ribbon(along(P.walk, true));
    ribbon(along(P.stem, false));
    disc([P.landing.x, P.landing.z], P.landing.r, 32);
    solid(g, gravel.geometry(), L.path, 'gravel', { shadow: false, ground: true, name: 'sky-paths' });
  }
  /**
   * The garden's hook, for the next task (S3), which plants lane G's garden here: build
   * createSkyGarden(ctx, kit, props, nature) once, then stand each piece in its slot (skySlots,
   * through standAt), everything in `land`: what stands on the deck is batched with the lawn as
   * its floor, and every part of a piece that hangs in the air (the falls' water and puffs, the
   * clouds, the floating rocks) sits on a pivot of its own in ctx.animated, which the town batches
   * on its own with no contact shade. `air` is for anything static that hangs off the deck or
   * beside it (batched with no contact shade); lane G's kit has none. Nothing is planted yet.
   */
  function skyGarden(_land: T.Group, _air: T.Group) {}
  /** A group in g at a slot (see skySlots), for a garden piece built in its own frame. */
  function standAt(g: T.Object3D, slot: SkySlot, name: string) {
    const frame = new T.Group();
    frame.name = name;
    frame.position.set(slot.x, slot.y, slot.z);
    frame.rotation.y = slot.ry;
    g.add(frame);
    return frame;
  }
  /** The island's ground, in its own group (the town's `sky.land`): the lawn, the paths and the garden. */
  function skyGround(land: T.Group, air: T.Group) {
    lawn(land);
    paths(land);
    skyGarden(land, air);
  }

  /* ---------------------------------------------------------------- */
  /* The underside: rock and coping                                    */
  /* ---------------------------------------------------------------- */
  /**
   * A band swept round a closed `path`: at each station its profile's points, each `o` out along
   * the station's normal and `y` up from its base height, joined to the next station's by quads
   * (town-airport's sweep, with a profile a station). The path runs clockwise seen from above and
   * the profile is listed from inside to outside, so it faces up and out. Smooth normals: a soft
   * edge on every turn.
   */
  function sweep(path: Station[], profile: (station: number) => [number, number][]) {
    const pos: number[] = [],
      index: number[] = [],
      width = profile(0).length;
    path.forEach((s, k) => {
      for (const [o, y] of profile(k)) pos.push(s.x + s.nx * o, s.y + y, s.z + s.nz * o);
    });
    for (let k = 0; k < path.length; k++) {
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
  /**
   * The coping (SKY_COPING): a chunky band of kerb stone round the rim, its nose the island's
   * widest ring, each stone a shade of its own. It hides where the turf ends and where the rock
   * begins. A `band`: a surface, never an overhang.
   */
  function coping(g: T.Object3D) {
    const C = SKY_COPING,
      // How far a stone sits in and down from the profile, each its own (never out past the nose's line).
      seat = (stone: number) => C.set * hash(stone * 5.71 + 1.3),
      path = plan.skyOutline(0, C.stones * C.stations).map((p) => ({ ...p, y: S.top })),
      swept = sweep(path, (k) => {
        const stone = Math.floor(k / C.stations),
          // A joint station takes the lower of the two stones it parts, drawn in by the joint.
          joint = k % C.stations === 0,
          sit = joint ? Math.max(seat(stone), seat((stone + C.stones - 1) % C.stones)) + C.joint : seat(stone);
        // Only the top's outer edge, the nose and the underside take it: the inner face and its
        // arris run level all round the lawn (one clean edge, not a dotted one), and the
        // underside's end stays put inside the rock.
        return C.profile.map(([o, y], j): [number, number] => (j < 3 || j === C.profile.length - 1 ? [o, y] : [o - sit, y - (j < 6 ? sit : 0)]));
      }),
      geometry = swept.toNonIndexed(),
      count = geometry.getAttribute('position').count,
      tones = new Float32Array(count * 3),
      perStone = (C.profile.length - 1) * 6 * C.stations;
    swept.dispose();
    // A stone's own shade: the quads from its joint to the next.
    for (let i = 0; i < count; i++) tones.fill(1 + C.tone * (hash(Math.floor(i / perStone) * 7.13 + 2.1) - 0.5), i * 3, i * 3 + 3);
    geometry.setAttribute('color', new T.BufferAttribute(tones, 3));
    solid(g, geometry, L.coping, 'stone', { band: true, name: 'sky-coping' });
  }
  /**
   * The underside (SKY_ROCK): the earth tapering to a blunt point, its chunky shoulders hung under
   * the rim and rock standing out of its flanks, sculpted as one smooth mass (its normals are the
   * blended field's own, so nothing is faceted). Its colours are on its vertices: the earth in
   * three beds, each change marked by a thin pale seam, wandering a little and darkening down the
   * spike; the rock in warm greys where a rock lobe's own surface (or the tip's) shows, lighter where
   * it faces up; a faint broad mottle over both.
   */
  function rock(g: T.Object3D) {
    const R = SKY_ROCK,
      mass = sculpt([-S.a - 0.6, -S.depth - 0.5, -S.b - 0.6], [S.a + 0.6, -R.cone.top + 2 * R.grid, S.b + 0.6], R.grid),
      shapes = R.lobes.map((l) => lobeShape(l, R.round)),
      outcrops = shapes.filter((_, k) => R.lobes[k].rock);
    // (Blended, the cone and the round cone swell the tip by `swell`: both stop that short of SKY.depth.)
    const tipAt = S.depth - R.tip.swell,
      tip = roundCone([0, R.tip.from, 0], [0, -tipAt + R.tip.r[1], 0], R.tip.r[0], R.tip.r[1]);
    mass.add(ellipticCone(S.a, S.b, R.cone.top, tipAt, R.cone.share, R.cone.power));
    mass.add(tip, R.tip.fillet);
    for (const shape of shapes) mass.add(shape, R.fillet);
    // A flat top under the turf, level with the cone's, its edge rolled into the flank (never a crease
    // where the shoulders' blends meet it): the coping's underside ends inside it.
    mass.cut(roundBox([0, 4 - R.cone.top, 0], [S.a + 2, 4, S.b + 2], 0), R.cut);
    const geometry = mass.mesh(),
      p = geometry.getAttribute('position'),
      n = geometry.getAttribute('normal'),
      tones = new Float32Array(p.count * 3),
      earth = L.earth.map((c) => new T.Color(c)),
      seam = new T.Color(L.seam),
      stone = L.rock.map((c) => new T.Color(c)),
      c = new T.Color(),
      r = new T.Color(),
      step = T.MathUtils.smoothstep,
      [b0, b1, b2] = R.beds;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i),
        z = p.getZ(i),
        // The depth the beds are read at: the vertex's own, wandering softly round the island.
        depth = -y + R.wander * (noise3(x * 0.33 + 3.1, y * 0.5, z * 0.33 + 7.7) - 0.5),
        mottle = 1 + 0.07 * (noise3(x * 0.9 + 11.3, y * 1.4 + 5.2, z * 0.9 + 2.9) - 0.5),
        // How near a seam it lies (1 on one), and how much of it is rock: down the spike, or on a
        // rock lobe's own surface.
        seamAt = Math.max(...[b0, b1].map((b) => 1 - step(Math.abs(depth - b), R.seam[0], R.seam[1]))),
        rockAt = Math.max(step(depth, R.spike[0], R.spike[1]), 1 - step(Math.min(tip.d(x, y, z), ...outcrops.map((s) => s.d(x, y, z))), R.outcrop[0], R.outcrop[1]));
      c.copy(earth[0])
        .lerp(earth[1], step(depth, b0 - 0.2, b0 + 0.2))
        .lerp(earth[2], step(depth, b1 - 0.3, b1 + 0.3))
        .lerp(seam, seamAt * 0.85);
      // Rock: its warm grey, lighter on faces turned to the sky, a little darker toward the tip.
      r.copy(stone[1])
        .lerp(stone[0], step(n.getY(i), -0.1, 0.7))
        .lerp(stone[2], step(depth, b2, S.depth) * 0.6);
      c.lerp(r, rockAt).multiplyScalar(mottle).toArray(tones, i * 3);
    }
    geometry.setAttribute('color', new T.BufferAttribute(tones, 3));
    // The flat top is never seen (the turf lies over it): only its rim is kept, under the coping.
    const index = geometry.getIndex()!,
      kept: number[] = [],
      buried = (i: number) => p.getY(i) > -R.cone.top - 0.1 && Math.hypot(p.getX(i) / S.a, p.getZ(i) / S.b) < R.cone.share - 0.1;
    for (let t = 0; t < index.count; t += 3) {
      const corners = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
      if (!corners.every(buried)) kept.push(...corners);
    }
    geometry.setIndex(kept);
    const m = solid(g, geometry, '#ffffff', 'stone', { name: 'sky-rock' });
    // In the deck's own frame: its long axis on x, its level at y 0.
    m.position.set(S.x, S.top, S.z);
    m.rotation.y = S.heading;
  }
  /**
   * The island's underside, in its own group (the town's `sky.rock`, batched with no contact
   * shade: measured from the lawn, everything below it would bake to its darkest): the rock and
   * the coping over it.
   */
  function skyUnderside(g: T.Group) {
    rock(g);
    coping(g);
  }

  /* ---------------------------------------------------------------- */
  /* The villa's stand-in                                              */
  /* ---------------------------------------------------------------- */
  /**
   * A stand-in massing for the villa (plan.SKY_VILLA, lane V's measures), in the shell's own frame
   * (front +z, y 0 the deck's level, the footprint's middle at the origin), until lane V's
   * buildSkyVilla takes its place (town-build, one line): a plain brick block on a buff base
   * course, two pale floor bands and a cornice under a hipped slate roof with a flat top, a brick
   * stack at each end with a pale cope and two cans, and before it the raised terrace with its steps
   * down to the lawn. It stands where the villa will, as big and as tall, so the site, the framing,
   * the pointer, the marks and the checks already measure the villa's own silhouette; nothing
   * more: no windows, no door.
   */
  function villaMassing(shell: T.Group, _site: plan.Site) {
    const V = plan.SKY_VILLA,
      { hw, back, front, cornice, flat } = V.house,
      block = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, colour: string, kind: SurfaceKind) =>
        box(shell, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, colour, kind),
      // A course round the house, `proud` of its walls: a surface on the wall (band), never an overhang.
      course = (y0: number, y1: number, proud: number, colour: string, kind: SurfaceKind) => {
        block(-hw - proud, hw + proud, y0, y1, back - proud, front + proud, colour, kind).userData.band = true;
      },
      eave = cornice - 0.44;
    // One brick block from under the turf to the cornice, so its courses run true from one foot.
    block(-hw, hw, FOOT, eave, back, front, L.brick, 'brick');
    // (The base course stops just under the terrace's top, so the two never share a face.)
    course(FOOT, V.terrace.top - 0.02, 0.11, L.base, 'ashlar');
    course(2.06, 2.26, 0.05, L.dressing, 'stone');
    course(3.62, 3.8, 0.05, L.dressing, 'stone');
    course(eave, cornice, 0.25, L.dressing, 'stone');
    // The hipped roof: flat slopes from the eaves (0.23 out from the walls) up to a flat top, the
    // end slopes steeper than the front and back ones, as lane V's are.
    const W = hw + 0.23,
      D = (front - back) / 2 + 0.23,
      rise = flat - cornice,
      fw = W - 1.05,
      fd = D - 1.55,
      eaves = [[-W, 0, D], [W, 0, D], [W, 0, -D], [-W, 0, -D]],
      top = [[-fw, rise, fd], [fw, rise, fd], [fw, rise, -fd], [-fw, rise, -fd]],
      quad = (a: number[], b: number[], c: number[], d: number[]) => [a, b, c, a, c, d],
      faces = [
        ...quad(eaves[0], eaves[1], top[1], top[0]),
        ...quad(eaves[1], eaves[2], top[2], top[1]),
        ...quad(eaves[2], eaves[3], top[3], top[2]),
        ...quad(eaves[3], eaves[0], top[0], top[3]),
        ...quad(top[0], top[1], top[2], top[3]),
        ...quad(eaves[3], eaves[2], eaves[1], eaves[0]),
      ],
      roofGeometry = new T.BufferGeometry();
    roofGeometry.setAttribute('position', new T.Float32BufferAttribute(faces.flat(), 3));
    roofGeometry.computeVertexNormals();
    const roof = new T.Mesh(roofGeometry, material(L.slate, 'slate'));
    roof.position.set(0, cornice, (back + front) / 2);
    roof.castShadow = roof.receiveShadow = true;
    // A roof: the walls under it take its eave shade from here.
    roof.userData.roof = true;
    roof.userData.eaveY = cornice;
    shell.add(roof);
    // The chimneys: a brick stack at each end, a pale cope and two cans up to their tops.
    const C = V.chimneys;
    for (const side of [-1, 1]) {
      const x = side * C.x;
      block(x - C.hw, x + C.hw, cornice, C.top, C.z - C.hd, C.z + C.hd, L.brick, 'brick');
      block(x - C.cope.hw, x + C.cope.hw, C.top, C.cope.top, C.z - C.cope.hd, C.z + C.cope.hd, L.dressing, 'stone').userData.band = true;
      for (const dx of [-0.24, 0.24]) cylinder(shell, x + dx, (C.cope.top + C.cans) / 2, C.z, 0.11, 0.14, C.cans - C.cope.top, L.pots, 'pantile');
    }
    // The terrace before the front, and its steps down to the lawn at the middle.
    block(-V.terrace.hw, V.terrace.hw, FOOT, V.terrace.top, front, V.terrace.front, L.base, 'ashlar');
    const treads = V.steps.risers - 1,
      going = (V.steps.front - V.terrace.front) / treads;
    for (let k = 1; k <= treads; k++)
      block(-V.steps.hw, V.steps.hw, FOOT, V.terrace.top * (1 - k / V.steps.risers), V.terrace.front + (k - 1) * going, V.terrace.front + k * going, L.base, 'ashlar');
  }

  return { skyGround, skyUnderside, villaMassing, standAt, skySlots };
}
export type SkyIsland = ReturnType<typeof createSkyIsland>;
