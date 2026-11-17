import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  buildTown,
  buildTownInPhases,
  followDrift,
  type Model,
  type SkyIsland,
  type Town,
} from './town-build';
import * as plan from './town-plan';
import { TROPIC_EXTENT, TROPIC_SEEN } from './town-tropic';
import { createCityInk } from './city-ink';
import { createIslandWater, createSeaShadow, MOON_POSITION } from './city-water';
import { createStreetLighting } from './city-lighting';
import {
  createRain,
  createGulls,
  gullPresence,
  sunOffsetFor,
  lowSun,
  warmSun,
  glasgowSky,
  glasgowSeason,
  windowClock,
  followWindows,
} from './city-atmosphere';
import { animateResident } from './city-people';
import { animationFrame } from './town-shared';
import {
  hoverPointer,
  pointerMove,
  clearPointer,
  hoverAllowed,
  labelPosition,
} from './city-hover';
import { fitStudy } from './city-inspection';
import { buildings, type BuildingId } from './city-data';
import { districts, type DistrictId } from './city-districts';

export type HoverTarget = BuildingId | 'corner-park' | null;
export type CityOptions = {
  /** Called whenever the building or place under the mouse changes. */
  onHover?: (id: HoverTarget) => void;
  /**
   * Called with true when the GPU context has been lost for CONTEXT_GRACE_MS (the stage shows
   * nothing), and with false once it is back.
   */
  onLost?: (lost: boolean) => void;
};
export type CityAPI = {
  select: (id: BuildingId) => void;
  enter: (id: BuildingId) => void;
  reset: () => void;
  /**
   * The whole island, fitted to the part of the frame a side panel and the page chrome leave
   * free. Camera only: the selection stays unless `clearSelection`. In Inspect it re-frames
   * the building instead.
   */
  overview: (clearSelection?: boolean) => void;
  rotate: () => void;
  zoom: (factor: number) => void;
  setNight: (v: boolean) => void;
  setPaused: (v: boolean) => void;
  /** Plan view: the four districts tinted on the ground, the whole island in view. */
  setPlan: (v: boolean) => void;
  /** Plan view: frame one district and bring its tint forward; null shows them all again. */
  focusDistrict: (id: DistrictId | null) => void;
  focusPark: () => void;
  focusBuildings: (ids: BuildingId[]) => void;
  /**
   * Real sky: night amount 0..1 plus solar elevation/azimuth in radians, and `hours`, the
   * Glasgow wall-clock hours, which the windows follow; 20:00 if omitted.
   */
  setSky: (sky: { night: number; elevation: number; azimuth: number; hours?: number }) => void;
  setRain: (v: boolean) => void;
  /** Slow idle camera drift while nobody is touching the city. */
  setDrift: (v: boolean) => void;
  /**
   * City mode's gestures: the plain wheel zooms, one finger pans, zooms close in on the
   * pointer and the canvas keeps every touch. Off (reading mode), the page keeps scrolling.
   */
  setCityMode: (on: boolean) => void;
  /** Absolute camera bearing; the camera takes the shortest turn. */
  setYaw: (angle: number) => void;
  /**
   * Keep the subject left of centre (fraction of the viewport width) so a reading panel can
   * sit beside it, and `down` (fraction of the viewport height) below the middle, for a
   * frame whose top part is hidden. `edge` is where that panel really starts (a share of the
   * width from the left; 1, the default, for none): the airport's island, the widest subject
   * framed beside the reading panel, is fitted into the space it leaves. `foot` is where the part of
   * the frame left free ends below (a share of the height from the top: City mode's sheet's or bars'
   * top); by default, where the drop's band would end, 1 + 2 * min(0, down) (the sun's shadow box
   * reads it: skyShadowWanted).
   */
  setFrameShift: (fraction: number, down?: number, edge?: number, foot?: number) => void;
  /** Ring one place from the page (hovering a person card or a Directory row, for example). */
  setAccent: (id: HoverTarget) => void;
  /**
   * The People chapter: pin a name tag above each member's home, and ring only the home
   * whose card is hovered instead of the whole row.
   */
  setHomeTags: (on: boolean) => void;
  dispose: () => void;
};

const shortestAngle = (from: number, to: number) => {
  const d = (to - from) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
};
/**
 * The camera's turns are calmer than its glides: the bearing eases in at this rate (per
 * second) and never turns faster than YAW_SPEED (radians per second, 90 degrees).
 */
const YAW_RATE = 2.5,
  YAW_SPEED = Math.PI / 2;
/**
 * The camera's elevation: 35 up for every 38 out (TOWN_PITCH, 42.6 degrees) in every view of the
 * town, but in the sky island's own file, where it comes down to SKY_PITCH: from the town's height
 * the island's rock hangs barely under the deck's near rim, a fringe under a plate; from 30 degrees
 * its body shows as the inverted cone of earth and rock under its lawn, as in the owner's
 * reference. It eases there and back at the bearing's rate (YAW_RATE), the camera at the same
 * distance from its target (CAMERA_REACH). Lower, the line of sight runs out further, so the file's
 * target (on it, under the pan limit's lift) stands 7.4 beyond the island rather than 5: the idle
 * drift's angle, turned about the target, keeps SKY_DRIFT of itself there, so the island swings
 * across the frame about as far as before. And it is the island's close view only: zoomed out
 * past SKY_CLOSE (from the second zoom down to the first) the camera rises back to the town's
 * pitch, so the widest views from the file see the town as every other view does (its file frames
 * it at 1.69 to 2.6 on desktops and upright phones; where it frames it lower, a phone on its side
 * at 1.21 to 1.24, from that fit down to three quarters of it: aim).
 */
export const TOWN_PITCH = Math.atan2(35, 38),
  SKY_PITCH = (30 * Math.PI) / 180,
  CAMERA_REACH = Math.hypot(38, 35),
  SKY_DRIFT = 0.6,
  SKY_CLOSE = [1.2, 1.6];
/** The camera's elevation `low` of the way from the town's pitch down to the sky island's file's. */
function elevationAt(low: number) {
  return TOWN_PITCH + (SKY_PITCH - TOWN_PITCH) * Math.min(1, low);
}
/** How close the camera may zoom: on the town, and on Inspect's lone building. */
const CITY_MAX_ZOOM = 4,
  STUDY_MAX_ZOOM = 8;
/**
 * How far out the camera may zoom (OrbitControls' minZoom, which the overview's fit keeps to as well),
 * on a frame at least as wide as it is tall (`wide`) and on a taller one (`tall`: a phone held upright,
 * a portrait tablet). City mode's overview takes in both neighbour islands, the sky island north-west of
 * the town and the tropic island south of it, so on a wide frame it spans the whole sea between them: it
 * fits at 0.44 to 0.48 beside the file or not (1280 x 720 the least) at the opening bearing, and the
 * 1024 px window beside the file, and 1280-1440 px ones beside it at the second and fourth Rotate stops,
 * go down to this; where even this cannot hold it all (beside the file at 1024 and 1180 wide at those two
 * stops, a phone on its side), the town, the airport's island and the sky island stay whole and the
 * tropic island is the one cut (fitOverview). A tall frame's overview fits at 0.54 or more at every stop,
 * and there the widest zoom stays where it was: at 0.40 a phone or a portrait tablet zoomed right out
 * would see the plane's last and first moments in view (its timetable has no slack) in the frame's far
 * corner at two Rotate stops.
 */
export const WIDEST = { wide: 0.4, tall: 0.45 };
/** How long a lost GPU context may take to come back before the town is reported gone. */
const CONTEXT_GRACE_MS = 4000;

/** Build the town model only, all at once: used by the checks. */
export function buildCityModel() {
  return buildTown();
}

/**
 * Inspect stands a copy of the building: pair each of its moving parts (the hall's clock hands
 * and vane, among `moving`) with that part's copy, walking both trees together, so the copies
 * can follow the originals the town keeps animating.
 */
export function pairMovingParts(original: T.Object3D, copy: T.Object3D, moving: Set<T.Object3D>) {
  const pairs: [T.Object3D, T.Object3D][] = [];
  const walk = (from: T.Object3D, to: T.Object3D) => {
    if (moving.has(from)) pairs.push([from, to]);
    from.children.forEach((child, i) => {
      if (to.children[i]) walk(child, to.children[i]);
    });
  };
  walk(original, copy);
  return pairs;
}
/** Each copy takes its original's pose. */
export function followMovingParts(pairs: [T.Object3D, T.Object3D][]) {
  for (const [from, to] of pairs) {
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);
    to.scale.copy(from.scale);
  }
}

/**
 * The plane's own clock after a frame `dt` long. It runs with town time, but while `held` (paused,
 * or for a visitor who prefers reduced motion) it goes back to the start of the plane's loop, where
 * the plane stands on its stand: so it is parked for as long as it is held, a flight under way when
 * Pause is pressed ends at once on the stand, and Play takes the loop up from there.
 */
export function planeClock(clock: number, dt: number, held: boolean) {
  return held ? Math.floor(clock / plan.PLANE_LOOP) * plan.PLANE_LOOP : clock + dt;
}
/**
 * Pose the plane at `clock` (plan.planePose): its middle, its heading, then its pitch and bank about
 * its own axes; hidden while it is away, lost in the haze. Its navigation lights are left as they
 * are: steady, never flashing.
 */
export function posePlane(plane: T.Object3D, clock: number) {
  const p = plan.planePose(clock);
  plane.position.set(p.x, p.y, p.z);
  plane.rotation.set(-p.pitch, p.heading, p.bank, 'YXZ');
  plane.visible = p.visible;
  return p;
}

/**
 * The airport's parts that stand on its ground (airport-land), not in its model, as boxes from the
 * sea up: the hangar's plan up to its roof, and a slim box round the windsock's mast and the sway of
 * its sock (it streams east, 0.9 out at most, and dips to 1.6 up).
 */
export const AIRPORT_EXTRAS = [
  { x0: plan.HANGAR.x0, x1: plan.HANGAR.x1, z0: plan.HANGAR.z0, z1: plan.HANGAR.z1, top: plan.AIRPORT.deck + plan.HANGAR.top },
  { x0: plan.WINDSOCK.x - 0.15, x1: plan.WINDSOCK.x + 0.95, z0: plan.WINDSOCK.z - 0.75, z1: plan.WINDSOCK.z + 0.2, top: 2.35 },
];
/**
 * Pointer picking's broad phase: one invisible box per building (its bounds in the town, which
 * stands untransformed under `parent`), set as the model's `hit`. The airport's deck is part of
 * the airport (pointing at the runway or the apron finds it too): a slab of the deck's footprint
 * and no taller than the deck, hung on the hall's box. The hall's box stretched over the deck
 * would stand 7 high over all of it, and its slack would reach several units out over the sea.
 * So are the hangar and the windsock: their boxes (AIRPORT_EXTRAS) hang there too. Without them
 * the hangar's west end, which a ray reaches past the deck's edge, and the sock answered nothing.
 * The tropic island's ground is part of the tropic island in the same way: a slab of its
 * waterline's own outline (tropicSlab: `sides` points evenly along it), from just under the water to
 * TROPIC_HIT.top over it (its lawn's highest, on the mound, is 0.43), hung on its building's box;
 * pointing at its lawn, its paths or its beach finds it, the open sea beside it does not. See
 * pickTarget.
 */
export const TROPIC_HIT = { top: 0.56, below: 0.1, sides: 96 };
/**
 * The tropic island's pointer slab (TROPIC_HIT), world coordinates: a prism of its waterline's
 * outline (plan.tropicOutline), its top and floor fanned from the island's middle (every ray from
 * there crosses the waterline once), every face turned out (a ray meets front faces only).
 */
function tropicSlab() {
  const H = TROPIC_HIT,
    P = plan.TROPIC,
    ring = plan.tropicOutline(0, H.sides),
    n = ring.length,
    position: number[] = [P.x, H.top, P.z, P.x, -H.below, P.z],
    index: number[] = [];
  for (const p of ring) position.push(p.x, H.top, p.z, p.x, -H.below, p.z);
  const top = (i: number) => 2 + 2 * (i % n),
    floor = (i: number) => 3 + 2 * (i % n);
  for (let i = 0; i < n; i++) index.push(0, top(i + 1), top(i), 1, floor(i), floor(i + 1), top(i), top(i + 1), floor(i), top(i + 1), floor(i + 1), floor(i));
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  geometry.setIndex(index);
  return geometry;
}
export function addHitBoxes(parent: T.Object3D, models: Map<BuildingId, Model>) {
  const A = plan.AIRPORT;
  for (const [id, m] of models) {
    const bounds = new T.Box3().setFromObject(m.root),
      size = bounds.getSize(new T.Vector3()),
      centre = bounds.getCenter(new T.Vector3());
    const hit = new T.Mesh(
      new T.BoxGeometry(size.x, size.y, size.z),
      new T.MeshBasicMaterial({ visible: false }),
    );
    hit.position.copy(centre);
    hit.userData.buildingId = id;
    if (id === 'airport') {
      const deck = new T.Mesh(new T.BoxGeometry(2 * A.hw, A.deck + 0.1, 2 * A.hd), hit.material);
      deck.position.set(A.x - centre.x, (A.deck + 0.1) / 2 - centre.y, A.z - centre.z);
      deck.userData.buildingId = id;
      hit.add(deck);
      for (const e of AIRPORT_EXTRAS) {
        const extra = new T.Mesh(new T.BoxGeometry(e.x1 - e.x0, e.top, e.z1 - e.z0), hit.material);
        extra.position.set((e.x0 + e.x1) / 2 - centre.x, e.top / 2 - centre.y, (e.z0 + e.z1) / 2 - centre.z);
        extra.userData.buildingId = id;
        hit.add(extra);
      }
    }
    if (id === 'tropic-island') {
      const ground = new T.Mesh(tropicSlab(), hit.material);
      ground.position.set(-centre.x, -centre.y, -centre.z);
      ground.userData.buildingId = id;
      hit.add(ground);
    }
    parent.add(hit);
    hit.updateMatrixWorld();
    m.hit = hit;
  }
}

/**
 * The sky island's pointer volume (addSkyHit): the deck's slab reaches `above` over the deck's
 * level (so figures on the lawn count) and `below` under it; the rock's hull follows its taper in
 * bands `band` deep, each ring in `sectors` round the island's middle; every part stands `slack`
 * clear of what it holds. Whatever stands on the deck and rises over the slab (the tree) gets a
 * box of its own, parts within `near` of one another one box.
 */
export const SKY_HIT = { above: 2, below: 1.2, band: 0.45, sectors: 32, slack: 0.25, near: 1.5 };
/**
 * The sky island's pointer volume, set under `parent` (the town, never the island's own root): one
 * invisible parent holding its own volume and no more. A floating island's bounds from the sea up,
 * or even its own box, are two or three times its silhouette on screen and reach over the
 * north-west beach behind it at one Rotate stop, where a click on empty sand would open its file.
 * So: the deck as a slab of the rim's own ellipse; the coping and the rock as a hull of rings
 * round their taper, down to the tip, each ring as far out on each side as the rock reaches there
 * (its shoulders stand proud of the rim and it is slimmer between them: one ring all round would
 * hang 0.7 below the tip on screen at a Rotate stop); the villa's own bounds; and a box round
 * whatever else on the deck rises over the slab. The falls, their cloud puffs, what floats beside
 * the island and its shadow on the sea are left out. See pickTarget.
 */
export function addSkyHit(parent: T.Object3D, sky: Pick<SkyIsland, 'land' | 'rock' | 'shell'>) {
  const S = plan.SKY,
    H = SKY_HIT,
    material = new T.MeshBasicMaterial({ visible: false }),
    hit = new T.Group(),
    v = new T.Vector3();
  hit.name = 'sky-island-hit';
  hit.userData.buildingId = 'sky-island';
  const each = (group: T.Object3D, visit: (p: T.Vector3) => void) =>
    group.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      const p = o.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) visit(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
    });
  const slab = new T.Mesh(new T.CylinderGeometry(1, 1, H.above + H.below, 40), material);
  slab.scale.set(S.a + H.slack, 1, S.b + H.slack);
  slab.rotation.y = S.heading;
  slab.position.set(S.x, S.top + (H.above - H.below) / 2, S.z);
  hit.add(slab);
  // The underside (the coping and the rock): each point's height and where it lies in the deck's
  // frame, as shares of the rim's half-axes.
  const under: [number, number, number][] = [];
  each(sky.rock, (p) => {
    const [lx, lz] = plan.skyLocal(p.x, p.z);
    under.push([p.y, lx / S.a, lz / S.b]);
  });
  if (under.length) {
    const N = H.sectors,
      top = Math.max(...under.map(([y]) => y)),
      lowest = Math.min(...under.map(([y]) => y)),
      bands = Math.floor((top - lowest) / H.band) + 1,
      bandOf = (y: number) => Math.min(bands - 1, Math.floor((top - y) / H.band)),
      reach = Array.from({ length: bands }, () => Array.from({ length: N }, () => 0)),
      // Each band's middle: its points' box's middle, which follows the rock down to its tip (it
      // leans toward the file's camera); each sector's reach is measured from it.
      box = Array.from({ length: bands }, () => [Infinity, -Infinity, Infinity, -Infinity]);
    for (const [y, u, w] of under) {
      const b = box[bandOf(y)];
      b[0] = Math.min(b[0], u);
      b[1] = Math.max(b[1], u);
      b[2] = Math.min(b[2], w);
      b[3] = Math.max(b[3], w);
    }
    const centre = box.map(([u0, u1, w0, w1]) => (u0 <= u1 ? [(u0 + u1) / 2, (w0 + w1) / 2] : [0, 0]));
    for (const [y, u, w] of under) {
      const band = bandOf(y),
        [cu, cw] = centre[band],
        angle = Math.atan2(w - cw, u - cu),
        sector = Math.floor(((angle / (2 * Math.PI) + 1) % 1) * N) % N;
      reach[band][sector] = Math.max(reach[band][sector], Math.hypot(u - cu, w - cw));
    }
    // A sector no point fell in (round the tip, slimmer than the rock's own triangles) takes its nearest neighbours'.
    for (const ring of reach) {
      const own = ring.slice();
      for (let j = 0; j < N; j++)
        for (let d = 1; !ring[j] && d <= N / 2; d++) ring[j] = Math.max(own[(j + d) % N], own[(j - d + N) % N]);
    }
    // Rings from the rock's top down, the last `slack` under its tip, each round the middle of the
    // two bands it parts: each corner as far out as the rock reaches in those bands (from their own
    // middles, and as far again as those lie from the ring's) and the two sectors it parts.
    const grow = H.slack / S.b,
      corners: number[] = [],
      faces: number[] = [];
    for (let k = 0; k <= bands; k++) {
      const parted = [k - 1, k].filter((band) => band >= 0 && band < bands),
        cu = parted.reduce((sum, band) => sum + centre[band][0], 0) / parted.length,
        cw = parted.reduce((sum, band) => sum + centre[band][1], 0) / parted.length;
      for (let j = 0; j < N; j++) {
        let r = 0;
        for (const band of parted) r = Math.max(r, Math.max(reach[band][j], reach[band][(j + N - 1) % N]) + Math.hypot(centre[band][0] - cu, centre[band][1] - cw));
        const angle = (j / N) * 2 * Math.PI;
        corners.push(cu + Math.cos(angle) * (r + grow), k < bands ? top - k * H.band : lowest - H.slack, cw + Math.sin(angle) * (r + grow));
      }
    }
    for (let k = 0; k < bands; k++)
      for (let j = 0; j < N; j++) {
        const a = k * N + j,
          b = k * N + ((j + 1) % N);
        faces.push(a, b, a + N, b, b + N, a + N);
      }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(corners, 3));
    geometry.setIndex(faces);
    const hull = new T.Mesh(geometry, material);
    hull.scale.set(S.a, 1, S.b);
    hull.rotation.y = S.heading;
    hull.position.set(S.x, 0, S.z);
    hit.add(hull);
  }
  const boxed = (bounds: T.Box3) => {
    const box = new T.Mesh(new T.BoxGeometry(1, 1, 1), material);
    bounds.getCenter(box.position);
    bounds.getSize(box.scale);
    hit.add(box);
  };
  const villa = new T.Box3().setFromObject(sky.shell);
  if (!villa.isEmpty()) boxed(villa);
  // What stands on the deck and rises over the slab: one box a cluster. (Over the deck only: what
  // floats beside it, a cloud or a rock, answers as the puffs do, not at all.)
  const tall: T.Box3[] = [],
    over = S.top + H.above - H.slack;
  each(sky.land, (p) => {
    if (p.y <= over || !plan.onSky(p.x, p.z)) return;
    const { x, z } = p,
      box = tall.find((b) => x > b.min.x - H.near && x < b.max.x + H.near && z > b.min.z - H.near && z < b.max.z + H.near);
    if (box) box.expandByPoint(p);
    else tall.push(new T.Box3(new T.Vector3(x, over, z), p.clone()));
  });
  for (const bounds of tall) boxed(bounds.expandByScalar(H.slack));
  parent.add(hit);
  hit.updateMatrixWorld(true);
  return hit;
}

/**
 * The place a pointer ray is on. A building's box only nominates it: seen at a slant, a box's
 * empty corners (above the gate's attic, beside a bay) lie in front of the building behind, so
 * a building counts where the ray meets its own geometry, and the nearest such meeting wins
 * (the bike rack, seen past the gate's attic, picks the studio). Where the ray meets no
 * building at all, the nearest box still answers, so the pointer keeps the boxes' slack round
 * each silhouette. The park's boxes, the airport's deck, hangar and windsock (hung on its hall's
 * box) and a model the scene gave no box are taken as they are. The sky island (`sky`: its
 * pointer volume from addSkyHit and its root) is nominated by any part of its volume and counts
 * where the ray meets anything of its own; hidden, it answers nothing.
 */
export function pickTarget(
  ray: T.Raycaster,
  models: Map<BuildingId, Model>,
  parkHit: T.Object3D,
  sky?: { hit: T.Object3D; root: T.Object3D },
): HoverTarget {
  const island = sky?.root.visible ? sky : undefined;
  // A model whose root is hidden (the tropic island, where the scene leaves it out) answers nothing.
  const boxes = ray.intersectObjects(
    [...Array.from(models.values()).filter((m) => m.root.visible).map((m) => m.hit ?? m.root), parkHit, ...(island ? [island.hit] : [])],
    true,
  );
  let best: { id: HoverTarget; distance: number } | null = null,
    nearest: HoverTarget = null,
    // Where the ray meets the island's own geometry: looked for once, however many parts it crosses.
    onIsland: T.Intersection | null | undefined;
  for (const hit of boxes) {
    if (best && hit.distance >= best.distance) break;
    let object: T.Object3D | null = hit.object;
    while (object && !object.userData.buildingId && !object.userData.placeId)
      object = object.parent;
    const id = (object?.userData.buildingId ?? object?.userData.placeId ?? null) as HoverTarget;
    if (!id) continue;
    nearest ??= id;
    const m = id === 'corner-park' ? undefined : models.get(id);
    const meets =
      island && object === island.hit
        ? onIsland === undefined
          ? (onIsland = ray.intersectObject(island.root, true)[0] ?? null)
          : onIsland
        : m?.hit && hit.object === m.hit
          ? ray.intersectObject(m.root, true)[0]
          : hit;
    if (meets && (!best || meets.distance < best.distance))
      best = { id, distance: meets.distance };
  }
  return best ? best.id : nearest;
}

/**
 * What the City overview must show of the sky island (plan.SKY and its slots), as points of its
 * own silhouette rather than its box's corners (they overstate a round island two and a half
 * times; sky-placement.md section 2.1): sixteen round the rim's widest ring, the chimney copes'
 * corners (the villa's) at the cans' height, the tree's top, the rock's tip (plan.skyTip, leaning
 * toward the file's camera), and each fall's cloud puff (four points round its middle, its top and
 * its flat base: lane G's).
 */
export function skyMarks() {
  const S = plan.SKY,
    C = plan.SKY_VILLA.chimneys,
    marks = plan.skyOutline(0, 16).map((p) => new T.Vector3(p.x, S.top - S.ring, p.z));
  for (const side of [-1, 1])
    for (const dx of [-1, 1])
      for (const dz of [-1, 1]) {
        const [x, z] = plan.skyVillaPoint(side * C.x + dx * C.cope.hw, C.z + dz * C.cope.hd);
        marks.push(new T.Vector3(x, plan.sites['sky-island'].y! + C.cans, z));
      }
  const tip = plan.skyTip();
  marks.push(new T.Vector3(plan.SKY_TREE.x, S.top + plan.SKY_TREE.top, plan.SKY_TREE.z), new T.Vector3(tip.x, tip.y, tip.z));
  for (const { puff } of plan.skyFalls)
    marks.push(
      ...[[1, 0], [0, 1], [-1, 0], [0, -1]].map(([dx, dz]) => new T.Vector3(puff.x + dx * puff.r, puff.y, puff.z + dz * puff.r)),
      new T.Vector3(puff.x, puff.top, puff.z),
      new T.Vector3(puff.x, puff.bottom, puff.z),
    );
  return marks;
}
/**
 * The sky island's own frame: the deck less its rounded ends (0.5 in at its sides, 1.5 at its
 * ends), from 1.5 above the rock's tip to the chimney pots. Its whole bounds would leave it at
 * little over half the free height.
 */
export function skyFit() {
  const S = plan.SKY,
    c = Math.cos(S.heading),
    s = Math.sin(S.heading),
    // The world's box round the deck's ellipse, drawn in by 1.5 along its long axis and 0.5 across it.
    hx = Math.hypot((S.a - 1.5) * c, (S.b - 0.5) * s),
    hz = Math.hypot((S.a - 1.5) * s, (S.b - 0.5) * c);
  return new T.Box3(new T.Vector3(S.x - hx, S.top - S.depth + 1.5, S.z - hz), new T.Vector3(S.x + hx, S.top + plan.SKY_VILLA.height, S.z + hz));
}
/**
 * Points round everything of the sky island that can show on screen, for how much of it a frame
 * shows (city-scene's islandOnScreen): its silhouette's marks (`marks`, skyMarks: the rim, the chimneys,
 * the tree, the rock's tip and the falls' puffs), the corners of the box round its rim's widest
 * ring in the deck's own frame (the marks keep only sixteen points of the ring), and the corners of
 * a box round each cloud's and floating rock's slot, three times its size out to the sides and twice
 * up and down, which holds the piece through its drift and bob.
 */
export function skyExtent(marks: T.Vector3[]) {
  const S = plan.SKY,
    points = [...marks];
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const [px, pz] = plan.skyPoint(x * S.a, z * S.b);
    points.push(new T.Vector3(px, S.top - S.ring, pz));
  }
  for (const f of [...plan.SKY_CLOUDS, ...plan.SKY_ROCKS])
    for (const dx of [-3, 3]) for (const dy of [-2, 2]) for (const dz of [-3, 3]) points.push(new T.Vector3(f.x + dx * f.size, f.y + dy * f.size, f.z + dz * f.size));
  return points;
}
/**
 * The tropic island, a neighbour's island on the sea off the south shore: its middle on the water
 * (plan.TROPIC, decision 2's (19.5, 51): its natural coast reaches 14.1 from it at the most, its tail
 * on the east-south-east), where its pan pocket stands (PAN.tropic) and from which the town's shadow
 * box pushes TROPIC_EXTENT's points out.
 */
export const TROPIC_MIDDLE = new T.Vector3(plan.TROPIC.x, 0, plan.TROPIC.z);
/** The smallest circle round points on the ground plan (incremental, as Welzl's): its middle and radius. */
export function enclosingCircle(points: readonly { x: number; z: number }[]) {
  type Circle = { x: number; z: number; r: number };
  const holds = (c: Circle, p: { x: number; z: number }) => Math.hypot(p.x - c.x, p.z - c.z) <= c.r + 1e-7,
    two = (a: { x: number; z: number }, b: { x: number; z: number }): Circle => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, r: Math.hypot(a.x - b.x, a.z - b.z) / 2 }),
    three = (a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }): Circle => {
      const bx = b.x - a.x,
        bz = b.z - a.z,
        cx = c.x - a.x,
        cz = c.z - a.z,
        d = 2 * (bx * cz - bz * cx);
      // Three in a line: the circle on the two farthest apart.
      if (Math.abs(d) < 1e-12) return [two(a, b), two(a, c), two(b, c)].reduce((w, k) => (k.r > w.r ? k : w));
      const ux = (cz * (bx * bx + bz * bz) - bz * (cx * cx + cz * cz)) / d,
        uz = (bx * (cx * cx + cz * cz) - cx * (bx * bx + bz * bz)) / d;
      return { x: a.x + ux, z: a.z + uz, r: Math.hypot(ux, uz) };
    };
  let circle: Circle = { x: points[0].x, z: points[0].z, r: 0 };
  for (let i = 1; i < points.length; i++) {
    if (holds(circle, points[i])) continue;
    circle = { x: points[i].x, z: points[i].z, r: 0 };
    for (let j = 0; j < i; j++) {
      if (holds(circle, points[j])) continue;
      circle = two(points[i], points[j]);
      for (let k = 0; k < j; k++) if (!holds(circle, points[k])) circle = three(points[i], points[j], points[k]);
    }
  }
  return circle;
}
/**
 * The town's shadow box (createCity's SHADOW_HOME, the sun's home focus), worked out from the plan as
 * the page loads, so it follows the land it holds: everything the sun's shadow falls from or on
 * (`ground`: the island to its waterline, 3.3 past its outline; the lighthouse's rock; the airport's
 * island to its armour's toe; and the tropic island, TROPIC_EXTENT's outline and a unit past it, `past`,
 * for what leans out over its beach or stands in its water: its palms' crowns, which town-tropic keeps
 * within 0.7 of the waterline, and its stones), the smallest circle round it on the ground plan and
 * `edge` more (a dozen of the map's texels, so the filter's taps never reach the box's rim). The
 * shadow camera's square, turned whichever way the key light turns, holds that circle: across the
 * light it spans the ground as it lies, and along it, where the light's slant shortens the ground,
 * the height of anything up to `top` (the Town Hall's roof, 9.5, the highest) still falls inside.
 * The light stands `reach` back along the key light from the middle (the nearest point, a roof `top`
 * high at the circle's rim toward the light in the lowest key light, `low`: city-atmosphere's
 * sunOffsetFor keeps it 40 to 57 degrees up, is `spare` short of it) and its far plane is `far` out
 * (past the farthest point, the rim away from the light `deep` under the water in that light, by a
 * unit).
 */
export const SHADOW_FIT = { past: 1, edge: 0.5, top: 10, deep: 0.5, low: (40 * Math.PI) / 180, high: 1, spare: 5 };
export const TOWN_SHADOW = (() => {
  const F = SHADOW_FIT,
    ground = [
      ...plan.islandOutline.map(([x, z]) => ({ x: x * (1 + 3.3 / Math.hypot(x, z)), z: z * (1 + 3.3 / Math.hypot(x, z)) })),
      { x: plan.lighthouseRock[0], z: plan.lighthouseRock[1] },
      ...plan.airportOutline(plan.AIRPORT.armour, 1),
      ...TROPIC_EXTENT.map((p) => {
        const out = new T.Vector3(p.x - TROPIC_MIDDLE.x, 0, p.z - TROPIC_MIDDLE.z);
        return out.setLength(out.length() + F.past).add(TROPIC_MIDDLE);
      }),
    ],
    circle = enclosingCircle(ground),
    radius = circle.r + F.edge,
    reach = Math.ceil(radius * Math.cos(F.low) + F.top * Math.sin(F.low) + F.spare);
  return {
    centre: new T.Vector3(circle.x, 0, circle.z),
    radius,
    reach,
    far: Math.ceil(reach + radius * Math.cos(F.low) + F.deep * Math.sin(F.high) + 1),
  };
})();
/**
 * The sun's shadow when the view is close in on the sky island (skyShadowWanted): its box, round
 * the island's own frame (`centre`, `radius`), in which the island casts on itself; the zoom from
 * which the view counts as close in (the second, and down to the first once it is), or how far the
 * camera must have come down to the island's own pitch (`low`, likewise: a phone on its side frames
 * the island's file at 1.21 to 1.24, under that zoom, and the camera comes down there all the same:
 * aim); how many marks of the land that must not show at all may show meanwhile (`land`, likewise
 * up to the first once it is) and how much of the free part of the frame the town's own island may
 * take (`shore`, likewise: a portrait phone's file shows a sliver of its north-west coast in the
 * corner above the sheet, its beach and the grass behind it, the corner of a roof at the idle
 * drift's extreme, 0.8% of the free part at rest and 1.2% through the drift at most, at 412 x 915);
 * from what share of the island's own fit its file counts as close in whatever its zoom and pitch
 * (`file`: followSky; a window whose fit falls between the zooms and short of the pitch, 1.25 to
 * 1.4, never took the box on opening the file, though one resized into it kept it); and how long
 * the shadows take to fade out before the box moves and to fade back in after.
 */
export const SKY_SHADOW = { centre: skyFit().getCenter(new T.Vector3()), radius: 14, zoom: [1.25, 1.4], low: [0.75, 0.9], land: [4, 2], shore: [0.05, 0.04], file: 0.97, fade: 0.18 };
/** The town's island out to its waterline (3.3 past its outline), as skyShadowWanted measures it. */
const TOWN_WATERLINE = plan.islandOutline.map(([x, z]) => new T.Vector3(x, 0, z).multiplyScalar(1 + 3.3 / Math.hypot(x, z)));
/**
 * A closed outline on the sea's level as `camera` projects it (a flat outline stays one simple
 * polygon), clipped to the part of the frame x from -1 to `right` and y from `bottom` to `top`, in the
 * camera's clip space, an edge at a time: its corners there, flat (x, y, x, y...), none if it misses
 * it.
 */
function clipToFrame(outline: T.Vector3[], camera: T.Camera, right: number, bottom: number, top = 1) {
  const p = new T.Vector3();
  let polygon: number[] = [];
  for (const point of outline) {
    p.copy(point).project(camera);
    polygon.push(p.x, p.y);
  }
  for (const [axis, edge, side] of [[0, -1, 1], [0, right, -1], [1, bottom, 1], [1, top, -1]]) {
    const kept: number[] = [],
      n = polygon.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n,
        a = side * (polygon[2 * i + axis] - edge),
        b = side * (polygon[2 * j + axis] - edge);
      if (a >= 0) kept.push(polygon[2 * i], polygon[2 * i + 1]);
      if (a >= 0 !== b >= 0) kept.push(polygon[2 * i] + ((polygon[2 * j] - polygon[2 * i]) * a) / (a - b), polygon[2 * i + 1] + ((polygon[2 * j + 1] - polygon[2 * i + 1]) * a) / (a - b));
    }
    polygon = kept;
    if (!polygon.length) break;
  }
  return polygon;
}
/**
 * How much of the free part of the frame (x from -1 to `right`, y from `bottom` to 1, in the
 * camera's clip space) a closed outline on the sea's level takes: the outline clipped to that part
 * (clipToFrame), its area as a share of the part's.
 */
function bandShare(outline: T.Vector3[], camera: T.Camera, right: number, bottom: number) {
  const polygon = clipToFrame(outline, camera, right, bottom);
  if (!polygon.length) return 0;
  let area = 0;
  for (let i = 0, n = polygon.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[2 * i] * polygon[2 * j + 1] - polygon[2 * j] * polygon[2 * i + 1];
  }
  return Math.abs(area) / 2 / ((right + 1) * (1 - bottom));
}
/**
 * Whether the sun's shadow should frame the sky island rather than the town. The island lies
 * outside the town's shadow box at most suns and bearings, and a box wide enough for both would
 * cost the whole town a fifth of its shadows' sharpness; so one box serves whichever the view is
 * on. It is the island's while the view is close in on it (SKY_SHADOW.zoom, or the camera come down
 * `low` of the way to the island's own pitch: city-scene's pitch), its middle in the frame, and the
 * town is next to absent from the part of the frame the file's panel (`shift`) or sheet leaves free,
 * from the frame's top (the scene shows between the masthead's pills) down to the sheet's or the
 * bars' top (`foot`, a share of the height from the top: setFrameShift's): no more than
 * SKY_SHADOW.land of `land`'s marks (the lighthouse's rock and the airport's island in the town's
 * frames), and its own island (TOWN_WATERLINE) at most a sliver of it (SKY_SHADOW.shore), whose beach
 * and grass go without shadows meanwhile. (Read off the frame drop, the middle of the band between
 * the masthead and the sheet, the band's foot lay the masthead's height inside the frosted sheet, and
 * counted town seen only blurred through it.) That is the island's own file, and a view panned or
 * zoomed about it. `on` says it is the island's now, which it stays a little longer either way.
 * (Where the town is not absent, the island's own file frames both: skyWideBox.)
 */
export function skyShadowWanted(camera: T.OrthographicCamera, land: T.Vector3[], shift: number, foot: number, on: boolean, low = 0) {
  const Z = SKY_SHADOW;
  if (!skyClose(camera, on, low)) return false;
  const p = new T.Vector3(),
    right = 1 - 4 * Math.max(0, shift),
    bottom = 1 - 2 * foot;
  let seen = 0;
  for (const mark of land) {
    p.copy(mark).project(camera);
    if (p.x > -1 && p.x < right && p.y > bottom && p.y < 1 && ++seen > Z.land[on ? 0 : 1]) return false;
  }
  return bandShare(TOWN_WATERLINE, camera, right, bottom) <= Z.shore[on ? 0 : 1];
}
/**
 * Whether the view is close in on the sky island as the sun's shadow counts it (skyShadowWanted):
 * its zoom past SKY_SHADOW.zoom, or the camera come down `low` of the way to the island's own pitch
 * (SKY_SHADOW.low), and the island's middle in the frame; `on` (the island has the sun's box now)
 * keeps it so a little longer.
 */
export function skyClose(camera: T.OrthographicCamera, on: boolean, low = 0) {
  const Z = SKY_SHADOW;
  if (camera.zoom < Z.zoom[on ? 0 : 1] && low < Z.low[on ? 0 : 1]) return false;
  const p = new T.Vector3().copy(Z.centre).project(camera);
  return Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
}
/**
 * The sun's shadow in the sky island's own file where its frame shows the town's land or the
 * airport's as well: at two of its four Rotate stops the north-west headland's coast (its houses,
 * trees and washing lines) stands in the frame, at one the airport's armour too, beside or behind
 * the file. SKY_SHADOW's box holds the island alone and would leave that land without its shadows
 * (and cut them at its edge); the town's leaves the island without any. So the file's box there holds
 * both (skyWideBox): the island (a sphere of SKY_SHADOW.radius round its middle) and the land the
 * whole frame shows (TOWN_LAND, the panel's and the sheet's part too, seen blurred through them),
 * from the ground up to `height` (the Town Hall's 9.5 the highest roof), wherever the idle drift
 * swings the view (`drift` either way, more than its 0.096 there) and, on a turn, on the way there
 * (`sweep`: the turn in that many steps, the key light turning with it). Its half-size reaches
 * `margin` past them, in whole units, up to `most`: 25 texels a unit on a desktop's 3072 map at its
 * widest and 17 on a phone's 2048, the town's own 22 and 16.7 or sharper (in Manual Day's sun 33 and
 * 35 at 1440 x 900 and up to 49 on the listed phones; in the lowest and most swung suns the key light
 * takes, up to 52 on desktops and 61 on phones); further out the view is the town's, and so is the
 * box. It is kept while the view stays `keep` inside it, so the drift, a pan or a zoom within
 * it never moves it; and the light stands back far enough for all of it to lie between its near and
 * far planes (`depth` past them).
 */
export const SKY_WIDE = { height: 10, drift: 0.1, sweep: 8, margin: 1.5, most: 61, keep: 0.5, depth: 3 };
/** The town's land as the sky island's wide box holds it: its island to its waterline, the airport's to its armour's toe, and the lighthouse's rock. */
const TOWN_LAND = [
  TOWN_WATERLINE,
  plan.airportOutline(plan.AIRPORT.armour, 1).map((p) => new T.Vector3(p.x, 0, p.z)),
  Array.from({ length: 12 }, (_, k) => new T.Vector3(plan.lighthouseRock[0] + 3.5 * Math.cos((k * Math.PI) / 6), 0, plan.lighthouseRock[1] + 3.5 * Math.sin((k * Math.PI) / 6))),
];
/** A sun shadow box: its middle and half-size, how far back along the key light the light stands (0: as far as the key's own offset) and its far plane. */
export type SunBox = { centre: T.Vector3; radius: number; reach: number; far: number };
/** The sky island's own box (SKY_SHADOW's), the light at the key's own offset. */
export const SKY_TIGHT: SunBox = { centre: SKY_SHADOW.centre, radius: SKY_SHADOW.radius, reach: 0, far: 90 };
/** The sun's shadow camera's axes for a key light offset (three's lookAt from the box's middle plus the offset): across, up, and back toward the light. */
function lightAxes(key: T.Vector3) {
  const z = key.clone().normalize(),
    x = new T.Vector3(0, 1, 0).cross(z).normalize();
  return { x, y: z.clone().cross(x), z };
}
/**
 * The corners of the land (TOWN_LAND) the camera shows, the whole frame, from the ground up to
 * SKY_WIDE.height over it, handed to `visit` (one scratch vector): what stands on a ground point shows
 * up the frame from it as it rises, so the land's reach in any light lies at a corner of its outline
 * clipped to the frame at its foot, of the outline clipped to where its top shows, or of the strips
 * under the frame's foot and its top edge, raised to where the edge cuts it (exactly: no heights
 * sampled).
 */
function eachLandSeen(camera: T.OrthographicCamera, visit: (p: T.Vector3) => void) {
  const H = SKY_WIDE.height,
    p = new T.Vector3(),
    along = new T.Vector3(),
    // How far up the frame (clip space) a unit of height shows.
    rise = p.set(0, 1, 0).project(camera).y - along.set(0, 0, 0).project(camera).y;
  for (const outline of TOWN_LAND)
    for (let part = 0; part < 4; part++) {
      // The ground in the frame; the ground whose tops show in it; the strip under its foot and the one
      // under its top edge, each point raised to where that edge cuts what stands on it.
      const polygon = part === 0 ? clipToFrame(outline, camera, 1, -1) : part === 1 ? clipToFrame(outline, camera, 1, -1 - H * rise, 1 - H * rise) : part === 2 ? clipToFrame(outline, camera, 1, -1 - H * rise, -1) : clipToFrame(outline, camera, 1, 1 - H * rise, 1);
      for (let i = 0; i < polygon.length; i += 2) {
        p.set(polygon[i], polygon[i + 1], -1).unproject(camera);
        along.set(polygon[i], polygon[i + 1], 1).unproject(camera).sub(p);
        p.addScaledVector(along, -p.y / along.y);
        p.y = part === 0 ? 0 : part === 1 ? H : T.MathUtils.clamp(((part === 2 ? -1 : 1) - polygon[i + 1]) / rise, 0, H);
        visit(p);
      }
    }
}
/**
 * How far the island (a sphere of SKY_SHADOW.radius round its middle) and the land `camera` shows reach
 * from `centre` in the light of `key`: along its axes across and up (the most), and back toward the
 * light (the least and the most).
 */
function sunReach(camera: T.OrthographicCamera, key: T.Vector3, centre: T.Vector3) {
  const { x, y, z } = lightAxes(key),
    r = SKY_SHADOW.radius,
    d = new T.Vector3().copy(SKY_SHADOW.centre).sub(centre);
  let half = Math.max(Math.abs(d.dot(x)), Math.abs(d.dot(y))) + r,
    near = d.dot(z) + r,
    back = d.dot(z) - r;
  eachLandSeen(camera, (p) => {
    d.copy(p).sub(centre);
    half = Math.max(half, Math.abs(d.dot(x)), Math.abs(d.dot(y)));
    near = Math.max(near, d.dot(z));
    back = Math.min(back, d.dot(z));
  });
  return { half, near, back };
}
/**
 * The sky island's own file's box where its frame shows land (SKY_WIDE), for `views`, each a camera and
 * the key light at its bearing, the one it stays in last: its middle that of the box round the island
 * and the land they show in the last one's light, snapped to the texels of a `map`-wide map there (a
 * box laid again for the same view lands on the same texels); its half-size as far as they reach from
 * it along any view's light, SKY_WIDE.margin more, in whole units; the light far enough back, and its
 * far plane far enough out, for all of them. None past SKY_WIDE.most.
 */
export function skyWideBox(views: [T.OrthographicCamera, T.Vector3][], map: number): SunBox | null {
  const W = SKY_WIDE,
    [, key] = views[views.length - 1],
    { x, y } = lightAxes(key),
    C = SKY_SHADOW.centre,
    r = SKY_SHADOW.radius;
  let u0 = C.dot(x) - r,
    u1 = C.dot(x) + r,
    v0 = C.dot(y) - r,
    v1 = C.dot(y) + r;
  for (const [camera] of views)
    eachLandSeen(camera, (p) => {
      u0 = Math.min(u0, p.dot(x));
      u1 = Math.max(u1, p.dot(x));
      v0 = Math.min(v0, p.dot(y));
      v1 = Math.max(v1, p.dot(y));
    });
  const centre = C.clone().addScaledVector(x, (u0 + u1) / 2 - C.dot(x)).addScaledVector(y, (v0 + v1) / 2 - C.dot(y));
  let half = 0,
    near = -Infinity,
    back = Infinity;
  for (const [camera, light] of views) {
    const seen = sunReach(camera, light, centre);
    half = Math.max(half, seen.half);
    near = Math.max(near, seen.near);
    back = Math.min(back, seen.back);
  }
  const radius = Math.ceil(half + W.margin);
  if (radius > W.most) return null;
  const texel = (2 * radius) / map,
    u = centre.dot(x),
    v = centre.dot(y);
  centre.addScaledVector(x, Math.round(u / texel) * texel - u).addScaledVector(y, Math.round(v / texel) * texel - v);
  const reach = Math.ceil(Math.max(key.length(), near + W.depth));
  return { centre, radius, reach, far: Math.ceil(reach - back + W.depth) };
}
/** Whether `box` still holds the island and the land each of `views` shows (each a camera and the key light at its bearing), `margin` inside it and its planes. */
export function sunBoxHolds(box: SunBox, views: [T.OrthographicCamera, T.Vector3][], margin: number) {
  return views.every(([camera, key]) => {
    const { half, near, back } = sunReach(camera, key, box.centre),
      reach = box.reach || key.length();
    return half <= box.radius - margin && near <= reach - 0.5 - margin && back >= reach - box.far + margin;
  });
}

/**
 * Plan view's districts lie this far above the flat ground: over the kerbs (plan.levels.kerb,
 * the highest paving), so the roads and pavements cannot hide them. Buildings, trees and
 * lamps still stand in front.
 */
export const DISTRICT_LIFT = plan.levels.kerb + 0.04;
/** Fill and edge opacity: all shown alike, the one in focus, and the others meanwhile. */
const DISTRICT_LOOK = {
  all: { fill: 0.42, edge: 0.95 },
  focus: { fill: 0.5, edge: 1 },
  rest: { fill: 0.12, edge: 0.3 },
};
const DISTRICT_EDGE = 0.22,
  DISTRICT_CORNER = 1.1;
/** A district's outline with rounded corners, sampled in x/z. */
function roundedOutline(points: [number, number][], radius: number, steps = 6) {
  const out: T.Vector2[] = [];
  points.forEach((p, i) => {
    const corner = new T.Vector2(...p),
      toPrevious = new T.Vector2(...points[(i + points.length - 1) % points.length]).sub(corner),
      toNext = new T.Vector2(...points[(i + 1) % points.length]).sub(corner),
      r = Math.min(radius, toPrevious.length() / 2, toNext.length() / 2),
      from = corner.clone().addScaledVector(toPrevious.normalize(), r),
      to = corner.clone().addScaledVector(toNext.normalize(), r);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      out.push(
        new T.Vector2()
          .addScaledVector(from, (1 - t) ** 2)
          .addScaledVector(corner, 2 * (1 - t) * t)
          .addScaledVector(to, t * t),
      );
    }
  });
  return out;
}
/**
 * Plan view's districts: for each, a translucent tint over its ground and a crisp edge just
 * inside its outline, drawn without depth writes. Unlit, so each keeps its own hue in the sun;
 * shadeDistricts dims them with the night. Hidden until Plan view is on.
 */
export function buildDistrictZones() {
  const group = new T.Group();
  group.name = 'districts';
  group.visible = false;
  for (const d of districts) {
    const outline = roundedOutline(d.outline, DISTRICT_CORNER);
    const look = (opacity: number) =>
      new T.MeshBasicMaterial({
        color: d.color,
        transparent: true,
        opacity,
        depthWrite: false,
        side: T.DoubleSide,
      });
    // The tint: the outline in the ground plane (shape y is -z, so it faces up once laid flat).
    const fill = new T.Mesh(
      new T.ShapeGeometry(new T.Shape(outline.map((p) => new T.Vector2(p.x, -p.y))))
        .rotateX(-Math.PI / 2)
        .translate(0, DISTRICT_LIFT, 0),
      look(DISTRICT_LOOK.all.fill),
    );
    // The edge: a band from the outline to DISTRICT_EDGE inside it (the outlines are convex).
    let area = 0;
    outline.forEach((p, i) => (area += p.cross(outline[(i + 1) % outline.length])));
    const inward = Math.sign(area),
      positions: number[] = [],
      index: number[] = [];
    outline.forEach((p, i) => {
      const tangent = outline[(i + 1) % outline.length]
        .clone()
        .sub(outline[(i + outline.length - 1) % outline.length])
        .normalize();
      const inner = p.clone().add(new T.Vector2(-tangent.y, tangent.x).multiplyScalar(inward * DISTRICT_EDGE));
      positions.push(p.x, DISTRICT_LIFT, p.y, inner.x, DISTRICT_LIFT, inner.y);
      const a = 2 * i,
        b = (2 * (i + 1)) % (2 * outline.length);
      index.push(a, b, a + 1, a + 1, b, b + 1);
    });
    const edgeGeometry = new T.BufferGeometry();
    edgeGeometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    edgeGeometry.setIndex(index);
    const edge = new T.Mesh(edgeGeometry, look(DISTRICT_LOOK.all.edge));
    edge.renderOrder = 1;
    for (const part of [fill, edge]) {
      part.userData.district = d.id;
      part.userData.part = part === fill ? 'fill' : 'edge';
      part.userData.color = new T.Color(d.color);
      group.add(part);
    }
  }
  return group;
}
type DistrictPart = T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>;
/** Plan view's emphasis: every district alike (null), or one brought forward. */
function emphasiseDistrict(zones: T.Group, focus: DistrictId | null) {
  for (const part of zones.children as DistrictPart[]) {
    const look = !focus
      ? DISTRICT_LOOK.all
      : part.userData.district === focus
        ? DISTRICT_LOOK.focus
        : DISTRICT_LOOK.rest;
    part.material.opacity = part.userData.part === 'fill' ? look.fill : look.edge;
  }
}
/** The districts darken with the town at night (night 0..1), as lit ground would. */
function shadeDistricts(zones: T.Group, night: number) {
  for (const part of zones.children as DistrictPart[])
    part.material.color.copy(part.userData.color).multiplyScalar(1 - 0.62 * night);
}

/**
 * A fresh task: everything queued meanwhile (a scroll, a click, a frame of the page) runs
 * first. A posted message, not a timer, so a background tab does not slow the build to a
 * phase a second.
 */
function nextTask() {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/**
 * The town and its renderer. The work is split into tasks (the renderer, each phase of the
 * town, then the studio light and the rest), so the page keeps scrolling and answering
 * while the town goes up instead of freezing for the whole build.
 */
export async function createCity(
  container: HTMLDivElement,
  onSelect: (id: BuildingId) => void,
  onPark: () => void = () => {},
  options: CityOptions = {},
): Promise<CityAPI> {
  // The visitor's motion preference, followed while the page is open: switched on, the plane parks,
  // turns cut and the drift stops at once; switched off, they come back (Play, if the town was
  // paused for it: page.tsx follows the preference too).
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = motionQuery.matches;
  const followMotion = () => {
    reduced = motionQuery.matches;
  };
  motionQuery.addEventListener('change', followMotion);
  // Two quality tiers up front, then a frame-time governor that lowers resolution if needed.
  const cores = navigator.hardwareConcurrency || 4,
    memory = (navigator as { deviceMemory?: number }).deviceMemory || 8,
    coarse = window.matchMedia('(pointer: coarse)').matches;
  const tier: 'high' | 'low' =
    coarse || cores <= 4 || memory <= 4 ? 'low' : 'high';
  // The ink pass does its own multisampling; a multisampled default framebuffer would
  // only add a second full-resolution resolve every frame.
  const renderer = new T.WebGLRenderer({
    antialias: false,
    alpha: true,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
  });
  // A soft render needs clean edges: full Retina resolution on capable machines;
  // the frame-time governor still steps down if a device cannot hold it.
  const baseRatio = Math.min(
    window.devicePixelRatio || 1,
    tier === 'low' ? 1.5 : 2,
  );
  renderer.setPixelRatio(baseRatio);
  renderer.shadowMap.enabled = true;
  // Smoothly filtered soft shadows. (A wide PCF radius ghosts thin posts into several copies.)
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  // Shadow maps are refreshed on a cadence from the frame loop, not every frame.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.outputColorSpace = T.SRGBColorSpace;
  // Khronos PBR Neutral keeps the palette's hues (ACES pushed them towards grey-orange).
  renderer.toneMapping = T.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0, 0);
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute(
    'aria-label',
    "LIU'S GATE: a small city standing for Liu's Gate. Every chapter is readable on the page.",
  );
  // The renderer comes first: a browser without WebGL fails here at once, before any of the
  // town is built for nothing.
  // The trees wear Glasgow's season (`?season=` previews another).
  const season = glasgowSeason(new Date(), window.location.search);
  const phases = buildTownInPhases({ season });
  let phase = phases.next();
  while (!phase.done) {
    await nextTask();
    phase = phases.next();
  }
  const model: Town = phase.value;
  container.appendChild(renderer.domElement);
  const scene = new T.Scene(),
    // A negative near plane: on tall (phone) frames the bottom edge of an orthographic view
    // starts below sea level, and a positive near plane would cut the sea off there.
    camera = new T.OrthographicCamera(-24, 24, 24, -24, -200, 180);
  const { city, models, walkers, lamps, tram, boat, plane, clocks, animated, parkGroup, parkHit, sky: island, tropic } = model;
  // The tropic island (its land builder's object, town-tropic's TropicIsland): setShown shows or hides
  // all of it at once, its land and the groups handed to it (its building's model root, its garden and
  // Filip), with its shallows and foam.
  // The island is built shown; the scene starts with it hidden (tropicShown), as with the sky island,
  // and followIslands only calls setShown when the rule changes its mind, so this call stays.
  tropic.setShown(false);
  // Pointer picking leaves the tropic island's building out while the island is hidden (pickAt).
  const shownWithoutTropic = new Map([...models].filter(([id]) => id !== 'tropic-island'));
  const driftFollowers = animated.map((entry) => entry.object).filter((o) => o.userData.followsDrift);
  // Everything the frame loop turns: Inspect's copy of a building follows these parts of it.
  const movingParts = new Set<T.Object3D>([
    ...animated.map((entry) => entry.object),
    ...clocks.flatMap((clock) => [clock.hour, clock.minute]),
  ]);
  let inspectParts: [T.Object3D, T.Object3D][] = [];
  const ink = createCityInk(renderer, scene, camera, tier === 'low' ? 2 : 4);
  // The palette is modelled at full Clash saturation; the grade mutes it to a calmer,
  // contemporary look (sage lawns, grey-blue sea) while accents still read. One number.
  const SATURATION = 0.72;
  ink.setSaturation(SATURATION);
  scene.add(city);
  await nextTask();
  // Studio light: a pre-filtered room environment gives every surface soft fill and
  // a gentle highlight on rounded edges, the way a C4D/Octane clay render looks.
  // It is baked on the GPU, so it is baked again after a lost context (see contextRestored).
  function bakeStudio() {
    const pmrem = new T.PMREMGenerator(renderer),
      room = new RoomEnvironment(),
      baked = pmrem.fromScene(room, 0.04);
    pmrem.dispose();
    room.dispose();
    scene.environment = baked.texture;
    return baked;
  }
  let studio = bakeStudio();
  scene.environmentIntensity = 0.25;
  const fog = new T.Fog('#d9e3dd', 72, 150);
  scene.fog = fog;
  const water = createIslandWater(model.waterLevel, -0.5, model.groundMasks);
  city.add(water.bottom, water.mesh);
  // The sky island's shadow on the sea (which takes none): the town's, never the island's own.
  const seaShadow = createSeaShadow(model.waterLevel, model.groundMasks);
  city.add(seaShadow.mesh);
  // Only the lanterns around the plaza carry real spotlights (after dusk); the rest glow.
  const litLanterns = lamps
    .filter((l) => l.getWorldPosition(new T.Vector3()).length() < 9.5)
    .slice(0, 6);
  const lighting = createStreetLighting(scene, litLanterns, {
    shadows: tier === 'low' ? 0 : 1,
    shadowSize: 512,
  });
  // Pointer picking: an invisible box per building, then that building's own meshes (pickTarget).
  city.updateMatrixWorld(true);
  addHitBoxes(city, models);
  // The sky island's pointer volume (pickTarget), and its casters: it casts only while the sun's
  // shadow frames it (followSky), so every Rotate stop shows it alike.
  const skyPick = { hit: addSkyHit(city, island), root: island.root },
    skyCasters: T.Mesh[] = [];
  island.root.traverse((o) => {
    if (!(o instanceof T.Mesh) || !o.castShadow) return;
    skyCasters.push(o);
    o.castShadow = false;
  });
  const sky = new T.HemisphereLight('#bcd4f2', '#7f8f44', 0.85);
  scene.add(sky);
  const sunOffset = new T.Vector3(-16, 32, 20),
    targetSunOffset = sunOffset.clone();
  let sunWarmth = 0,
    targetWarmth = 0,
    golden = 0,
    targetGolden = 0;
  const sun = new T.DirectionalLight('#ffe3bd', 3.8);
  sun.castShadow = true;
  const shadowBase = tier === 'low' ? 1024 : 1536;
  /**
   * The town's shadow box, its home focus (TOWN_SHADOW, worked out from the plan when the page loads):
   * the island, the airport's island and the tropic island whole for every sun and yaw (the smallest
   * circle round them, its rim at the airport's armour's north-west corner and a unit past the tropic
   * island's south-east beach, and half a unit more: 62.95 round (5.04, 2.94) with the island's natural
   * coast), in a map twice `shadowBase` (3072, 2048 on the low tier), the size Inspect's and the sky
   * island's boxes take: 24.4 texels a unit, sharper than the old box round the island and the
   * airport alone (centre (-3.5, -13.5), ±46 in 2048: 22.3), and on the low tier 16.3, a fiftieth
   * softer than its old 16.7 (±46 in 1536); and the same map wherever the box goes, so a hand-over never replaces it. The light stands
   * `reach` back along the key light (60: the key's own offset, 41, would leave the box's near side
   * behind the light) and its far plane is `far` out (110).
   */
  const SHADOW_HOME = { ...TOWN_SHADOW, map: 2 * shadowBase };
  sun.shadow.mapSize.set(SHADOW_HOME.map, SHADOW_HOME.map);
  Object.assign(sun.shadow.camera, {
    left: -SHADOW_HOME.radius,
    right: SHADOW_HOME.radius,
    top: SHADOW_HOME.radius,
    bottom: -SHADOW_HOME.radius,
    // The depth from the light runs about 6 to 108 over the whole box.
    near: 0.5,
    far: SHADOW_HOME.far,
  });
  sun.shadow.normalBias = 0.02;
  sun.shadow.bias = -0.0001;
  sun.shadow.intensity = 1.0;
  scene.add(sun);
  // From the first frame on the home box, not round the origin: the box no longer centres there,
  // and frames drawn before the first framing call would leave the airport's far side unshaded.
  sun.target.position.copy(SHADOW_HOME.centre);
  scene.add(sun.target);
  // The key light turns with the camera yaw, so the visible faces keep the same
  // top-bright / left-lit / right-shade read from every side.
  const UP = new T.Vector3(0, 1, 0), keyOffset = new T.Vector3(), lastKey = new T.Vector3(), moonAt = new T.Vector3();
  let shadowDirty = true,
    // How far back along the key light the sun stands from its box's middle: 0 for the key's own offset
    // (the sky island's own box and Inspect's), more for the town's (SHADOW_HOME.reach) and the sky
    // island's file's wide box (SKY_WIDE).
    sunBack = SHADOW_HOME.reach;
  function placeSun() {
    keyOffset.copy(sunOffset).applyAxisAngle(UP, yaw - Math.PI / 4); // yaw only: idle drift must not swing shadows
    // The moon's glint on the sea turns with it, so no rotate stop faces the moon across the water.
    moonAt.copy(MOON_POSITION).applyAxisAngle(UP, yaw - Math.PI / 4);
    sun.position.copy(sun.target.position).addScaledVector(keyOffset, sunBack ? sunBack / keyOffset.length() : 1);
    // The studio fill turns too, or the shade sides darken after rotate().
    scene.environmentRotation.y = yaw - Math.PI / 4;
    if (lastKey.distanceToSquared(keyOffset) > 1e-6) { lastKey.copy(keyOffset); shadowDirty = true; }
  }
  // Quality ladder, climbed down by the frame-time governor and back up when frames are cheap:
  // 0 full, 1 fewer pixels, 2 smaller shadows and no lantern shadow, 3 and 4 fewer pixels still.
  let quality = 0,
    qualityChanged = 0,
    // The sun's shadow frames Inspect's building, not the town (said outright: the town's own focus
    // is no longer the origin, so the target's distance from it cannot say so).
    shadowInspect = false;
  const shadowSizeFor = (inspecting: boolean) =>
    inspecting
      ? 2 * (quality >= 2 ? Math.max(512, shadowBase / 2) : shadowBase)
      : quality >= 2
        ? SHADOW_HOME.map / 2
        : SHADOW_HOME.map;
  function applyQuality() {
    const ratio = Math.max(0.75, baseRatio - 0.25 * [0, 1, 1, 2, 3][quality]);
    if (Math.abs(renderer.getPixelRatio() - ratio) > 1e-3) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      ink.resize(width, height);
    }
    for (const [i, light] of lighting.lights.entries())
      light.castShadow = i === 0 && tier !== 'low' && quality < 2;
    shadowFocus(shadowInspect ? sun.target.position.clone() : undefined, sun.shadow.camera.right, { reach: sunBack, far: sun.shadow.camera.far });
  }
  /**
   * The sun's shadow on Inspect's building or the sky island (its centre and reach, and for the
   * island's file's wide box how far back the light stands and its far plane: `depth`), or on the
   * town (none given: its home box, the light SHADOW_HOME.reach back).
   */
  function shadowFocus(center?: T.Vector3, radius = SHADOW_HOME.radius, depth = center ? { reach: 0, far: 90 } : SHADOW_HOME) {
    shadowInspect = !!center;
    const resolution = shadowSizeFor(shadowInspect),
      focus = center || SHADOW_HOME.centre;
    // A new map (or a frustum moved elsewhere) is drawn before the next frame uses it, even
    // paused: until then three samples an empty map and puts everything in full shadow.
    if (
      sun.shadow.mapSize.x !== resolution ||
      sun.target.position.distanceToSquared(focus) > 1e-9 ||
      sun.shadow.camera.right !== radius ||
      sunBack !== depth.reach ||
      sun.shadow.camera.far !== depth.far
    ) {
      shadowDirty = true;
      renderer.shadowMap.needsUpdate = true;
    }
    if (sun.shadow.mapSize.x !== resolution) {
      sun.shadow.mapSize.set(resolution, resolution);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    sun.target.position.copy(focus);
    sunBack = depth.reach;
    placeSun();
    Object.assign(sun.shadow.camera, {
      left: -radius,
      right: radius,
      top: radius,
      bottom: -radius,
      far: depth.far,
    });
    sun.shadow.camera.updateProjectionMatrix();
  }
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableRotate = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  // Far enough out for the whole town and both neighbour islands beside the file (WIDEST: set for the
  // frame's shape again on every resize).
  controls.minZoom = WIDEST.wide;
  controls.maxZoom = CITY_MAX_ZOOM;
  /**
   * Panning stops before the view leaves the town for open sea: the subject's ground point (where
   * the line of sight through the view centre less the panel offset meets the ground) stays in the
   * island's disc, which reaches just past its farthest coast (the north-west headland, 35.4 out)
   * and the lighthouse's rock, in the airport's deck and 4 beyond its edge, or in a capsule over the
   * causeway between them. Each region is a core (the origin, the causeway's line, the deck's
   * rectangle inset by its corner radius) and a reach round it, so OrbitControls' own clamp holds
   * it: each frame `cursor` is the nearest point of the core of whichever region the subject is
   * deepest in (or nearest to) and `maxTargetRadius` that region's reach (see holdPan). `lift` is
   * how far the target may stand above or below the subject's ground: above the middle of every
   * building a framing centres (the Town Hall's, 6.7 up, is the highest).
   * The sky island has a pocket of its own (`sky`): a disc of `reach` round its middle (at the town's
   * pitch: skyReach widens it at a lower one), which holds the ground point of its own frame at any
   * bearing (11.7 beyond it along the line of sight at the town's pitch, 42.6 degrees; 18.7 at its
   * file's own, 30 degrees), and a capsule of `link` back to the town along the line between them,
   * from `from` (30 out, inside the island's disc), so a visitor in its file can pan back to the town.
   * So has the tropic island, on the sea off the south shore (`tropic`): a disc of `reach` round its
   * middle (its long half-axis, 12, and 4 more: the airport's deck keeps the same 4), which holds the
   * ground point of its file at every bearing, and a capsule of `link` back to the town from 30 out
   * toward it (on the disc's south shore by the harbour). It stands at sea level, at the town's pitch,
   * so its pocket keeps its reach.
   */
  const PAN = {
    disc: 36,
    from: new T.Vector3(plan.AIRPORT_ROAD.x, 0, -20),
    to: new T.Vector3(plan.AIRPORT_ROAD.x, 0, plan.AIRPORT.z + plan.AIRPORT.hd),
    causeway: 8,
    deck: {
      x0: plan.AIRPORT.x - plan.AIRPORT.hw + plan.AIRPORT.radius,
      x1: plan.AIRPORT.x + plan.AIRPORT.hw - plan.AIRPORT.radius,
      z0: plan.AIRPORT.z - plan.AIRPORT.hd + plan.AIRPORT.radius,
      z1: plan.AIRPORT.z + plan.AIRPORT.hd - plan.AIRPORT.radius,
      reach: plan.AIRPORT.radius + 4,
    },
    sky: {
      centre: new T.Vector3(plan.SKY.x, 0, plan.SKY.z),
      reach: 16,
      from: new T.Vector3(plan.SKY.x, 0, plan.SKY.z).setLength(30),
      link: 8,
    },
    tropic: {
      centre: TROPIC_MIDDLE.clone(),
      reach: 16,
      from: TROPIC_MIDDLE.clone().setLength(30),
      link: 8,
    },
    lift: 8,
  };
  const panSubject = new T.Vector3(),
    panOrigin = new T.Vector3(),
    panOnLine = new T.Vector3(),
    panOnDeck = new T.Vector3(),
    panGround = new T.Vector3(),
    panBack = new T.Vector3(),
    panLine = new T.Line3(PAN.from, PAN.to),
    panOnLink = new T.Vector3(),
    panLink = new T.Line3(PAN.sky.from, PAN.sky.centre),
    panOnStrip = new T.Vector3(),
    panStrip = new T.Line3(PAN.tropic.from, PAN.tropic.centre),
    panHeld = new T.Vector3(),
    panAlong = new T.Vector3(),
    // The target as the last frame's limit left it (the frame loop's, right after OrbitControls' update).
    panLast = new T.Vector3();
  /**
   * The sky island's pocket's reach on the ground: PAN.sky.reach at the town's pitch, and as much
   * further out as the line of sight runs at a lower one (the file's ground point lies 11.7 beyond
   * the island at the town's pitch, 42.6 degrees, and 18.7 at SKY_PITCH, 30, where the pocket's reach
   * is 25.5): the same freedom on screen either way. At `low` of the way down (the camera's pitch now,
   * by default).
   */
  function skyReach(low = pitch) {
    return low <= 0 ? PAN.sky.reach : (PAN.sky.reach * Math.tan(TOWN_PITCH)) / Math.tan(elevationAt(low));
  }
  /** The pan region the subject point p is deepest in, or nearest to, at `low` of the way down to the sky island's pitch: the nearest point of its core and its reach. */
  function panRegion(p: T.Vector3, low = pitch) {
    panSubject.set(p.x, 0, p.z);
    panLine.closestPointToPoint(panSubject, true, panOnLine);
    panOnDeck.set(T.MathUtils.clamp(p.x, PAN.deck.x0, PAN.deck.x1), 0, T.MathUtils.clamp(p.z, PAN.deck.z0, PAN.deck.z1));
    panLink.closestPointToPoint(panSubject, true, panOnLink);
    panStrip.closestPointToPoint(panSubject, true, panOnStrip);
    const disc = Math.hypot(p.x, p.z) - PAN.disc,
      causeway = panSubject.distanceTo(panOnLine) - PAN.causeway,
      deck = panSubject.distanceTo(panOnDeck) - PAN.deck.reach,
      reach = skyReach(low),
      pocket = panSubject.distanceTo(PAN.sky.centre) - reach,
      link = panSubject.distanceTo(panOnLink) - PAN.sky.link,
      south = panSubject.distanceTo(PAN.tropic.centre) - PAN.tropic.reach,
      strip = panSubject.distanceTo(panOnStrip) - PAN.tropic.link,
      airport = Math.min(causeway, deck),
      tropic = Math.min(south, strip);
    if (disc <= airport && disc <= pocket && disc <= link && disc <= tropic) return { centre: panOrigin, radius: PAN.disc };
    if (tropic < airport && tropic < Math.min(pocket, link)) return south <= strip ? { centre: PAN.tropic.centre, radius: PAN.tropic.reach } : { centre: panOnStrip, radius: PAN.tropic.link };
    if (Math.min(pocket, link) < airport) return pocket <= link ? { centre: PAN.sky.centre, radius: reach } : { centre: panOnLink, radius: PAN.sky.link };
    return deck <= causeway ? { centre: panOnDeck, radius: PAN.deck.reach } : { centre: panOnLine, radius: PAN.causeway };
  }
  /**
   * The visitor's pan limit for the frame, which OrbitControls' update then applies (its own updates,
   * a pointer move at a time, keep the last frame's). Screen-space panning lifts the target as well
   * as moving it, 0.74 a unit of screen-vertical pan, while what the view shows is set by where the
   * line of sight through the subject meets the ground: so the region is the ground point's, and
   * `cursor` stands lifted with the target, so that OrbitControls' sphere measures the distance on
   * the ground. (Measured at the lifted target, the view jumped as the subject passed from the disc
   * to the causeway or the deck, and vertical pans ran 14 past the disc.) The lift is held within
   * PAN.lift by sliding the target and the camera together along the line of sight, which changes
   * nothing on screen: a drag kept up against the limit would otherwise lift the camera on into the
   * fog. A glide itself is never clamped: the camera's own moves (a panel offset can reach past
   * the limit on narrow wide screens) are the camera's. And it can end, or be cut short by a
   * touch, with its subject out of the regions (a glide between the People side and the airport
   * crosses open water, 2.5 out): the visitor is then handed the view where it is, held within how
   * far out it was (`panSlack`, which only ever shrinks until the next glide), and can only pan it
   * back in. Pulled in at once, the view jumped as the touch landed. And while the camera's pitch
   * changes (the sky island's file zoomed out past its close view, or back in), the regions move
   * under a view that stands still: the island's pocket shrinks as the pitch rises (skyReach), and
   * the line of sight swings the ground point along itself. The slack then grows by what that change
   * of pitch alone does to the view as the last frame's limit left it (`panLast`; `panPitch`, the pitch
   * at the last hold), signed, so the clamp never pulls it: zoomed out from the pocket's edge,
   * OrbitControls drew the view 58 px back toward the island over the two seconds of the pitch's ease
   * at 1440 x 900, with no hand on it. Whatever else moved the view since is held as anywhere: a drag,
   * and OrbitControls' zoom at the pointer, which moves the target after its own clamp (taken up into
   * the slack while the pitch eased, wheel or pinch zooms out at one point and in at another walked the
   * view off the island's pocket and out over open sea). Once the pitch has settled the slack only
   * shrinks again.
   */
  function holdPan() {
    const back = panBack.copy(camera.position).sub(controls.target).normalize(),
      ground = panGround.copy(controls.target).sub(shiftApplied),
      excess = tween ? 0 : ground.y - T.MathUtils.clamp(ground.y, -PAN.lift, PAN.lift);
    if (excess) {
      controls.target.addScaledVector(back, -excess / back.y);
      camera.position.addScaledVector(back, -excess / back.y);
    }
    const lift = (ground.y - excess) / back.y;
    ground.addScaledVector(back, -ground.y / back.y);
    // (Before the frame's own region: excessAt shares panRegion's scratch points.)
    const bearing = Math.atan2(back.x, back.z),
      eased = !tween && pitch !== panPitch && panSlack < Infinity ? excessAt(panLast, pitch, bearing) - excessAt(panLast, panPitch, bearing) : 0,
      region = panRegion(ground),
      out = Math.max(0, ground.distanceTo(region.centre) - region.radius);
    panSlack = tween ? Infinity : pitch !== panPitch && panSlack < Infinity ? Math.max(0, panSlack + eased) : Math.min(panSlack, out);
    panPitch = pitch;
    controls.cursor.copy(shiftApplied).add(region.centre).addScaledVector(back, lift);
    controls.maxTargetRadius = tween ? Infinity : region.radius + panSlack;
  }
  /**
   * How far out of the pan regions the view stands with its target at `point`, seen from `bearing` at
   * `low` of the way down to the sky island's pitch (holdPan): its subject's ground point against the
   * region it is deepest in at that pitch.
   */
  function excessAt(point: T.Vector3, low: number, bearing: number) {
    const back = viewOffset(bearing, panAlong, low).normalize(),
      ground = panHeld.copy(point).sub(shiftApplied);
    ground.addScaledVector(back, -ground.y / back.y);
    const region = panRegion(ground, low);
    return Math.max(0, ground.distanceTo(region.centre) - region.radius);
  }
  controls.maxTargetRadius = PAN.disc;
  controls.screenSpacePanning = true;
  controls.mouseButtons.LEFT = T.MOUSE.PAN;
  controls.mouseButtons.RIGHT = T.MOUSE.PAN;
  controls.touches.ONE = null;
  controls.touches.TWO = T.TOUCH.DOLLY_PAN;
  renderer.domElement.style.touchAction = 'pan-y';
  // Reading mode leaves scrolling to the page: one finger and the plain wheel scroll it, and
  // Ctrl/⌘ + wheel or a pinch zooms. City mode has no page to scroll, so the canvas takes
  // every gesture: the plain wheel zooms, one finger pans, and zooms close in on the pointer.
  // There every mouse button pans: OrbitControls' middle-button zoom anchors itself to the
  // pointer only once (and wrongly), then drifts the subject away from beside the file.
  let cityMode = false;
  function setCityMode(on: boolean) {
    cityMode = on;
    controls.mouseButtons.MIDDLE = on ? T.MOUSE.PAN : T.MOUSE.DOLLY;
    controls.touches.ONE = on ? T.TOUCH.PAN : null;
    controls.zoomToCursor = on;
    renderer.domElement.style.touchAction = on ? 'none' : 'pan-y';
  }
  function wheelIntent(e: WheelEvent) {
    const modified = e.ctrlKey || e.metaKey;
    controls.enableZoom = cityMode || modified;
    // A trackpad pinch arrives as Ctrl + wheel, which OrbitControls already scales up.
    controls.zoomSpeed = cityMode && !modified ? 1.5 : 1;
  }
  function touchIntent(e: PointerEvent) {
    if (e.pointerType !== 'touch') return;
    controls.enableZoom = true;
    controls.zoomSpeed = 1;
  }
  renderer.domElement.addEventListener('wheel', wheelIntent, {
    capture: true,
    passive: true,
  });
  renderer.domElement.addEventListener('pointerdown', touchIntent, {
    capture: true,
  });
  let width = 1,
    height = 1,
    yaw = Math.PI / 4,
    targetYaw = yaw,
    night = 0,
    targetNight = 0,
    paused = reduced,
    disposed = false,
    raf = 0,
    last = 0,
    time = 0,
    planeTime = 0,
    targetZoom = 1,
    shownZoom = 1,
    tween = true,
    // How far out of the pan regions the visitor was handed the view (holdPan), and the pitch the
    // last hold was made at.
    panSlack = Infinity,
    panPitch = 0,
    planMode = false,
    inViewport = true,
    inspect: T.Group | null = null,
    inspectionAutoFit = true,
    inspectYaw = yaw,
    overviewFit = false,
    rain = 0,
    targetRain = 0,
    drift = false,
    driftAngle = 0,
    frameShift = 0,
    frameDrop = 0,
    // Where the part of the frame left free ends below (setFrameShift's `foot`).
    frameFoot = 1,
    panelEdge = 1,
    lastInteraction = -1e9,
    lastHover: HoverTarget = null,
    accentId: HoverTarget = null,
    skyKnown = false,
    frameCost = 0.016,
    refresh = 1 / 60,
    lastGovern = 0,
    clockChecked = -1e9,
    hoverSignature = '',
    frameIndex = 0,
    skyHours = 20,
    paneHours = 20,
    // The sky island: in view (see islandHidden; from the first frame on, as the frame allows: a frame
    // that hides it never shows it), casting (the sun's shadow frames it) and how much of the sun's
    // shadow shows while its box changes hands (followSky).
    skyShown = false,
    // The tropic island in view, likewise (followIslands), and whether any of it was drawn in the frame.
    tropicShown = false,
    tropicDrawn = false,
    skyCast = false,
    // Which box the sun's shadow has while the island casts: its own (SKY_TIGHT) or its file's wide
    // one round it and the land in view (skyWideBox); none while the town has it. And the last wide box
    // fitted, which a hand-over under way heads for (skyWide).
    skyBox: SunBox | null = null,
    skyNext: SunBox | null = null,
    shadowFade = 1,
    // A turn the sky island's file makes from where it stands (Rotate, or its bearing set again, with
    // the view in the file), until it ends: the sun's box is decided at the framing it heads for.
    skyTurn = false,
    // The view's target and zoom at the last frame, for whether it stands still (skySettled).
    skyStillZoom = 0,
    // How far the camera's pitch has come down from the town's toward the sky island's file's: 0 to 1 (viewOffset).
    pitch = 0;
  const skyStillAt = new T.Vector3(),
    // The last framing (and sun) a wide box was found to hold through the drift and the turn (skyHolds).
    skyHeld: { box: SunBox | null; bearing: number; zoom: number; at: T.Vector3; sun: T.Vector3 } = { box: null, bearing: 0, zoom: 0, at: new T.Vector3(), sun: new T.Vector3() };
  // The windows' night: the clock the panes are heading for (from the sky's hours) and the one
  // they show, which follows it one pane at a time and only in the dark (glasgow-sun's followWindows).
  // paneHours is the sky's hours at the last frame, when the panes last followed the clock.
  const paneClock = { out: 0, wake: 0 },
    paneGoal = { out: 0, wake: 0 };
  // Colours used every frame, allocated once.
  const tint = {
    sunDay: new T.Color('#ffe3bd'),
    sunWarm: new T.Color('#ffbe7a'),
    sunGolden: new T.Color('#ff9f57'),
    sunNight: new T.Color('#8daed0'),
    skyDay: new T.Color('#bcd4f2'),
    skyWarm: new T.Color('#e9d3c4'),
    groundDay: new T.Color('#7f8f44'),
    groundNight: new T.Color('#1d2731'),
    skyRain: new T.Color('#cfd9dc'),
    fogDay: new T.Color('#d9e3dd'),
    fogNight: new T.Color('#101b20'),
    fogRain: new T.Color('#c3ced0'),
    fogGolden: new T.Color('#ecc9a4'),
  };
  const shiftApplied = new T.Vector3();
  // Over the island, the airport and the tropic island (a square of ±66, city-atmosphere's): as dense
  // as it was over ±50, (132 / 100)² as many streaks.
  const weather = createRain(Math.round((tier === 'low' ? 900 : 1700) * 1.7424)),
    gulls = createGulls();
  scene.add(weather.object, gulls.object);
  const target = new T.Vector3(),
    offset = new T.Vector3();
  const zones = buildDistrictZones();
  scene.add(zones);
  const hover = hoverPointer();
  const labels = [
    ...buildings.map((b) => ({
      b,
      element: container.parentElement!.querySelector<HTMLDivElement>(
        `[data-building-label="${b.id}"]`,
      ),
    })),
    {
      b: { id: 'corner-park' as const, height: 1.8 },
      element: container.parentElement!.querySelector<HTMLDivElement>(
        '[data-building-label="corner-park"]',
      ),
    },
  ];
  // The People chapter's name tags: each is pinned 0.3 above the top of its home (the
  // chimney pots), over the middle of the house. The chimney stands at one end or at the
  // back, so `pots` (0.3 above the pots themselves) keeps the tag clear of it on screen.
  const homeTags = Array.from(
    container.parentElement!.querySelectorAll<HTMLElement>('[data-home-tag]'),
    (element) => {
      const root = models.get(element.dataset.homeTag as BuildingId)?.root,
        anchor = new T.Vector3(),
        pots = new T.Vector3();
      if (root) {
        root.updateWorldMatrix(true, true);
        const top = new T.Box3().setFromObject(root).max.y;
        root.getWorldPosition(anchor);
        anchor.y = top + 0.3;
        // The middle of the highest vertices: the tops of the chimney pots.
        const vertex = new T.Vector3();
        let count = 0;
        root.traverse((object) => {
          if (!(object instanceof T.Mesh)) return;
          const position = object.geometry.getAttribute('position');
          for (let i = 0; i < position.count; i++) {
            vertex.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
            if (vertex.y > top - 0.01) {
              pots.add(vertex);
              count++;
            }
          }
        });
        if (count) pots.divideScalar(count);
        else pots.copy(anchor);
        pots.y = top + 0.3;
      }
      return { element, anchor, pots, found: !!root, shown: false, placed: '' };
    },
  ).filter((tag) => tag.found);
  const tagPoint = new T.Vector3();
  let tagsOn = false;
  let focusedIds: BuildingId[] = [],
    parkSelected = false,
    autoFocus = false;
  // What the overview must show: the sand out to the waterline (3.3 past the outline), the
  // trees along the shore and the lighthouse on its rock; and the airport's island to the toe of
  // its armour, the control tower's mast and the hangar's roof (plan.HANGAR's corners at its top, 2.8 up).
  const [rockX, rockZ] = plan.lighthouseRock;
  const islandMarks = [
    ...plan.islandOutline.flatMap(([x, z]) => {
      const out = 1 + 3.3 / Math.hypot(x, z);
      return [new T.Vector3(x * out, 0, z * out), new T.Vector3(x, 3, z)];
    }),
    new T.Vector3(rockX, 0, rockZ),
    new T.Vector3(rockX, 5.5, rockZ),
    ...plan.airportOutline(plan.AIRPORT.armour, 1).map((p) => new T.Vector3(p.x, 0, p.z)),
    new T.Vector3(3.9, 7, -47.4),
    ...[plan.HANGAR.x0, plan.HANGAR.x1].flatMap((x) => [plan.HANGAR.z0, plan.HANGAR.z1].map((z) => new T.Vector3(x, plan.AIRPORT.deck + plan.HANGAR.top, z))),
  ];
  // The sky island's marks, which City mode's overview (and Plan view's) shows too: the reading
  // page's last shot keeps to the town, as it was (the island is hidden there). And its own frame.
  // (The tropic island's are TROPIC_EXTENT's points, likewise City mode's only; they frame its file
  // too, as they stand: the corners of their box would overstate a round island by a third.)
  const SKY_MARKS = skyMarks(),
    SKY_FIT = skyFit();
  /** How far up the line of sight the sky island's framing raises its target from the ground (focusSky). */
  const SKY_LIFT = 6.5;
  /**
   * The town's land that skyShadowWanted lets none of show: the lighthouse's rock and the airport's
   * island to its armour's toe (it measures the town's own island by its waterline instead).
   */
  const LAND_MARKS = [new T.Vector3(rockX, 0, rockZ), ...plan.airportOutline(plan.AIRPORT.armour, 1).map((p) => new T.Vector3(p.x, 0, p.z))];
  /**
   * The reading frames, besides the last shot and the opening view, that would show a cut slice of
   * each neighbour island (islandHidden): the sky island's are the People chapter's places; the tropic
   * island has none (every chapter's frame leaves it out of view, but the Life chapter's on a 3440 px
   * screen, which sees its trees' tops and a corner of its sand at the reading panel's edge: a corner
   * of a sea-level island beyond the town, as the airport's at the opening view's top right).
   */
  const SKY_HIDES = new Set<BuildingId>(plan.chapterSubjects.people),
    TROPIC_HIDES = new Set<BuildingId>();
  /**
   * What of each neighbour island can show on screen: the sky island's (skyExtent) and, of its pool on
   * the sea, the square on the water its disc is drawn in (city-water's createSeaShadow, in the pool's
   * own frame); the tropic island's with its shelf and shallows (town-tropic's TROPIC_SEEN). And how an
   * island may go from a frame that hides it (islandShown): once nothing of it (or of its pool) reaches
   * more than `edge` px into the frame; and the sky island also once the camera has come to rest in that
   * frame with no more than a cut slice of it left there (`slice` of the screen box round it), where the
   * tropic island (`slice` null) never goes at rest from where it was drawn the frame before.
   */
  const SKY_EXTENT = skyExtent(SKY_MARKS),
    POOL_SQUARE = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => new T.Vector3(x, 0, z)),
    SKY_LEAVE = { edge: 1, slice: 0.5 },
    TROPIC_LEAVE = { edge: 1, slice: null };
  /**
   * The airport's frame: its island to the armour's toe and the causeway's far half, up to the
   * tower's mast. Fitted like a group (fitGroup) between 0.95 and 2.6: the one-building rule's 1.3
   * floor would push it under the reading panel on most screens.
   */
  /** How far (px) a group fitted beside a panel that starts at its own edge keeps from it, and from the frame's left edge. */
  const PANEL_CLEAR = 24;
  const AIRPORT_FIT = new T.Box3(
    new T.Vector3(plan.AIRPORT.x - plan.AIRPORT.hw - plan.AIRPORT.armour, 0, plan.AIRPORT.z - plan.AIRPORT.hd - plan.AIRPORT.armour),
    new T.Vector3(plan.AIRPORT.x + plan.AIRPORT.hw + plan.AIRPORT.armour, 7, -35),
  );
  /**
   * The camera's offset from its target at a bearing: the same elevation from every side, the
   * town's (35 up for 38 out), or `low` of the way down to the sky island's file's (SKY_PITCH; by
   * default as far as the camera has come now).
   */
  function viewOffset(bearing: number, out: T.Vector3, low = pitch) {
    if (low <= 0) return out.set(Math.sin(bearing) * 38, 35, Math.cos(bearing) * 38);
    const elevation = elevationAt(low),
      flat = Math.cos(elevation) * CAMERA_REACH;
    return out.set(Math.sin(bearing) * flat, Math.sin(elevation) * CAMERA_REACH, Math.cos(bearing) * flat);
  }
  /**
   * The pitch the view heads for (viewOffset's `low`) at `zoom` (the zoom the view heads for, by
   * default): in the sky island's own file (the island framed alone, or panned and zoomed about
   * since) all the way down to SKY_PITCH close in, back up to the town's zoomed out past SKY_CLOSE;
   * the town's everywhere else. Where the file's own fit (the zoom it frames the island at for the
   * frame as it is: skyFitZoom) falls inside SKY_CLOSE, which leaves it short of the island's pitch,
   * the fit makes the shortfall up, eased back over the same share of zoom below it as SKY_CLOSE's
   * (to three quarters of it): a phone on its side fits the island at 1.21 to 1.24, where SKY_CLOSE
   * kept the town's pitch and its rock read as a thin plate under the deck. A fit of 1.6 or more
   * (every desktop, a phone upright) is left exactly as SKY_CLOSE has it, and one of 1.4 or more
   * settles where SKY_CLOSE puts it (the 768 x 1024 tablet's 1.53 at 0.91 of the way down). The
   * panel offset is measured at it, as it is at the bearing and the zoom it heads for; the camera
   * itself follows it, at its own zoom, at the bearing's pace (the frame loop). (The island's file is
   * framed at its own pitch: focusSky.)
   */
  function aim(zoom = targetZoom) {
    if (!(focusedIds.length === 1 && focusedIds[0] === 'sky-island' && !overviewFit && !inspect && !parkSelected)) return 0;
    const fit = skyFitZoom(),
      short = 1 - T.MathUtils.smoothstep(fit, SKY_CLOSE[0], SKY_CLOSE[1]);
    return Math.max(T.MathUtils.smoothstep(zoom, SKY_CLOSE[0], SKY_CLOSE[1]), short * T.MathUtils.smoothstep(zoom, (fit * SKY_CLOSE[0]) / SKY_CLOSE[1], fit));
  }
  /**
   * The panel offset: the view centre sits this far right of the subject (and above it, for
   * a frame drop), so the subject stays in the middle of the space a side panel leaves free,
   * at any zoom. It is measured at the current bearing, so it turns with the camera.
   */
  const screenRight = new T.Vector3(),
    screenUp = new T.Vector3();
  function panelOffset(out: T.Vector3) {
    const zoom = Math.max(targetZoom, 0.1);
    screenRight.set(Math.cos(yaw), 0, -Math.sin(yaw));
    screenUp.crossVectors(viewOffset(yaw, screenUp, aim()).normalize(), screenRight);
    return out
      .copy(screenRight)
      .multiplyScalar((frameShift * (camera.right - camera.left)) / zoom)
      .addScaledVector(screenUp, (frameDrop * (camera.top - camera.bottom)) / zoom);
  }
  /**
   * A new framing's target carries its panel offset from the start (measured at the new zoom),
   * so the glide eases the offset in with everything else. A turn that starts with it then
   * adds only the offset's change from frame to frame: were the offset left for the frame loop
   * to add, a turning frame would put the whole of it on the view centre at once, a sideways
   * jump.
   */
  function offsetTarget() {
    panelOffset(shiftApplied);
    target.add(shiftApplied);
  }
  /**
   * Panel framing: keep the subject (Inspect's building too) beside the panel, not behind it.
   * An offset changed outside a framing (the file opened or closed, the reading page back at
   * the hero, Inspect's fit) moves the target, so the view glides across. The frame loop runs
   * this before a turn: a turning frame then adds only the offset's own turn, never the whole
   * change at once.
   */
  function followPanel() {
    const wanted = panelOffset(new T.Vector3());
    if (wanted.distanceToSquared(shiftApplied) > 1e-6) {
      target.sub(shiftApplied).add(wanted);
      shiftApplied.copy(wanted);
      tween = true;
    }
  }
  /**
   * The whole island in the part of the frame left free: beside a side panel (the frame
   * shift), under a hidden top band (twice the frame drop), below the masthead and above the
   * bottom controls (about 76 px each). Never closer than the plain overview's zoom of 1. In City
   * mode the two neighbour islands are part of it: the sky island and the tropic island, which alone
   * is cut where even the widest zoom cannot hold it all.
   */
  function fitOverview() {
    const back = viewOffset(targetYaw, new T.Vector3(), 0).normalize(),
      right = new T.Vector3(Math.cos(targetYaw), 0, -Math.sin(targetYaw)),
      up = new T.Vector3().crossVectors(back, right),
      // The screen box round points, along the screen's axes (world units).
      span = (points: readonly T.Vector3[]) => {
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        for (const point of points) {
          const sx = point.dot(right),
            sy = point.dot(up);
          minX = Math.min(minX, sx);
          maxX = Math.max(maxX, sx);
          minY = Math.min(minY, sy);
          maxY = Math.max(maxY, sy);
        }
        return { points, minX, maxX, minY, maxY };
      },
      // Everything the overview takes in (`all`), and what of it is never cut (`town`): the island and
      // the airport's, and in City mode the sky island; the tropic island too where all of it fits.
      town = span(cityMode ? islandMarks.concat(SKY_MARKS) : islandMarks),
      all = cityMode ? span(town.points.concat(TROPIC_EXTENT)) : town;
    // Beside a side panel the group keeps a margin from it: the reading page's panel starts a
    // little left of where the frame shift alone would put the free space's edge.
    const freeWidth = Math.max(1, Math.max(0.3, 1 - 2.5 * Math.abs(frameShift)) * width - 48),
      shownHeight = Math.max(0.3, 1 - 2 * Math.abs(frameDrop)) * height,
      freeHeight = Math.max(shownHeight * 0.6, shownHeight - 152),
      fit = (box: typeof all) =>
        Math.min(((freeWidth / width) * (camera.right - camera.left)) / (box.maxX - box.minX), ((freeHeight / height) * (camera.top - camera.bottom)) / (box.maxY - box.minY));
    targetZoom = T.MathUtils.clamp(fit(all), controls.minZoom, 1);
    // What stays whole, across and down: all of it where it fits at the zoom, else the town, the
    // airport's island and the sky island (the tropic island then takes what is cut: City mode beside
    // the file on a 1024 to 1280 px window at the second and fourth Rotate stops, a phone on its side).
    let keep = { across: all, down: all };
    // Centre the outline (not the plaza) in the part of the frame left free, as far as what stays whole
    // keeps inside it (where even that is too big, centred in it itself), and keep the target on the
    // ground. That part is the fit's own (freeWidth by freeHeight round the subject) or, in City mode
    // where all of it is wider than that, across the frame's own room: PANEL_CLEAR from its left edge
    // and from the file (the fit's part leaves about a tenth of the width spare either side beside the
    // file); where even that is too narrow for all of it, less how far the idle drift swings the town
    // and the sky island past where they rest (as much as 20 px toward the file at the second Rotate
    // stop), so they keep that clear of them through the drift too, and the tropic island gives.
    const place = () => {
      const perUnit = (width * targetZoom) / (camera.right - camera.left),
        at = { x: width / 2 - frameShift * width, y: height / 2 + frameDrop * height },
        file = frameShift > 0 ? width * (1 - 2 * frameShift) + 16 : width,
        wide = cityMode && (all.maxX - all.minX) * perUnit > freeWidth + 1e-6,
        down = [-freeHeight / 2, freeHeight / 2],
        // The target along an axis (world units): `all` (lo to hi along it) centred on it, as far as what
        // stays whole (keptLo to keptHi) keeps within `room` of it (px from the subject either way).
        along = (lo: number, hi: number, keptLo: number, keptHi: number, room: number[]) => {
          const least = keptHi - room[1] / perUnit,
            most = keptLo - room[0] / perUnit;
          return least > most ? (keptLo + keptHi) / 2 - (room[0] + room[1]) / 2 / perUnit : T.MathUtils.clamp((lo + hi) / 2, least, most);
        },
        lay = (across: number[]) => {
          keep = {
            across: (all.maxX - all.minX) * perUnit <= across[1] - across[0] + 1e-6 ? all : town,
            down: (all.maxY - all.minY) * perUnit <= down[1] - down[0] + 1e-6 ? all : town,
          };
          target
            .copy(right)
            .multiplyScalar(along(all.minX, all.maxX, keep.across.minX, keep.across.maxX, across))
            .addScaledVector(up, along(all.minY, all.maxY, keep.down.minY, keep.down.maxY, down));
          target.addScaledVector(back, -target.y / back.y);
          offsetTarget();
        };
      if (!wide) {
        lay([-freeWidth / 2, freeWidth / 2]);
        return;
      }
      lay([PANEL_CLEAR - at.x, file - PANEL_CLEAR - at.x]);
      // Where all of it fits there, it is centred as it was; where it does not, the town and the sky island
      // keep that room through the drift as well: how far the drift swings them past their edges at
      // rest, either way (px; the view turned about the target, each of their points across the turned frame).
      if (keep.across === all) return;
      const offset = new T.Vector3(),
        edges = (toward: T.Vector3) => {
          let least = Infinity,
            most = -Infinity;
          for (const point of keep.across.points) {
            const x = offset.subVectors(point, target).dot(toward);
            least = Math.min(least, x);
            most = Math.max(most, x);
          }
          return [least, most];
        },
        rest = edges(right),
        swing = [0, 0];
      for (const turn of [-0.16, -0.08, 0.08, 0.16]) {
        const [least, most] = edges(new T.Vector3(Math.cos(targetYaw + turn), 0, -Math.sin(targetYaw + turn)));
        swing[0] = Math.max(swing[0], (rest[0] - least) * perUnit);
        swing[1] = Math.max(swing[1], (most - rest[1]) * perUnit);
      }
      lay([PANEL_CLEAR + swing[0] - at.x, file - PANEL_CLEAR - swing[1] - at.x]);
    };
    place();
    // City mode, where the sky island lands at the box's top left (the opening bearing): it stood
    // under or right beside the caption's sky chip (16 px in, 166 wide with its longest caption, its
    // foot 102 down; the chip naming the place under the pointer is hidden in City mode). The view
    // moves left, the town right, until the island with its clouds and rocks clears the chip's column
    // by PANEL_CLEAR at rest and stays off it (by a pixel or two) through the idle drift (which swings it as it
    // turns the view), if the room before the file or the frame's edge allows: what stays whole keeps
    // PANEL_CLEAR from it at rest and through the drift. Where it does not (a box as wide as the room
    // beside the file, at 1024 to 1180 px with the file open, with the tropic island at its foot), the
    // view moves up instead, the town down, as far as the foot of what stays whole keeps over the
    // bottom band (76 px), if that is far enough for the island to clear the column at rest; where the
    // band left under it is short of what the drift asks (a box as tall as the free part, as at 1180 x
    // 820), the view goes out first, just far enough (never past the widest zoom), and the box is
    // centred again. Where none of it can, the framing stays as it was.
    if (cityMode) {
      const point = new T.Vector3(),
        floats = [[plan.SKY_CLOUDS, 2.55, 1.5], [plan.SKY_ROCKS, 1.3, 1.2]] as const,
        // The island's left edge and top on screen (px from the frame's left and top), the view turned
        // `turn` about its centre (the idle drift: 0.16 either way at most): each cloud and rock as a disc
        // round its slot, as wide as it reaches and as high as it rises (in units of its size: a cloud 2.55
        // out and 1.5 up, a rock 1.3 out and 1.2 up).
        edgesAt = (turn: number, perUnit: number) => {
          const towardRight = new T.Vector3(Math.cos(targetYaw + turn), 0, -Math.sin(targetYaw + turn)),
            towardUp = new T.Vector3().crossVectors(viewOffset(targetYaw + turn, new T.Vector3(), 0).normalize(), towardRight);
          let left = Infinity,
            top = -Infinity;
          for (const mark of SKY_MARKS) {
            left = Math.min(left, mark.dot(towardRight));
            top = Math.max(top, mark.dot(towardUp));
          }
          for (const [slots, reach, rise] of floats)
            for (const float of slots) {
              point.set(float.x, float.y + rise * float.size, float.z);
              left = Math.min(left, point.dot(towardRight) - reach * float.size);
              top = Math.max(top, point.dot(towardUp) + reach * float.size * Math.hypot(towardUp.x, towardUp.z));
            }
          return { left: width / 2 + (left - target.dot(towardRight)) * perUnit, top: height / 2 - (top - target.dot(towardUp)) * perUnit };
        },
        // Where the island and the box stand at the zoom as it is: at rest it keeps PANEL_CLEAR from the
        // column, through the drift a pixel; how far the view must move aside or down for that, the room
        // before the file, and the box's foot (px from the frame's top) and the band left under it.
        // The right edge (px from the frame's left) of what stays whole, the view turned `turn` likewise.
        rightAt = (turn: number, perUnit: number) => {
          const towardRight = new T.Vector3(Math.cos(targetYaw + turn), 0, -Math.sin(targetYaw + turn));
          let most = -Infinity;
          for (const mark of keep.across.points) most = Math.max(most, mark.dot(towardRight));
          return width / 2 + (most - target.dot(towardRight)) * perUnit;
        },
        // Where the island and the box stand at the zoom as it is: at rest it keeps PANEL_CLEAR from the
        // column, through the drift two pixels (the discs round its clouds and rocks stand in for them to
        // about a pixel); how far the view must move aside or down for that, the room
        // before the file (what stays whole PANEL_CLEAR from it at rest and through the drift), and the
        // foot of what stays whole (px from the frame's top) and the band left under it.
        measure = () => {
          const perUnit = (width * targetZoom) / (camera.right - camera.left),
            states = [{ ...edgesAt(0, perUnit), margin: PANEL_CLEAR }, ...[-0.16, -0.08, 0.08, 0.16].map((turn) => ({ ...edgesAt(turn, perUnit), margin: 2 }))],
            touching = states.filter((e) => e.top < 102 + e.margin && e.left < 182 + e.margin),
            foot = height / 2 + (target.dot(up) - keep.down.minY) * perUnit,
            file = frameShift > 0 ? width * (1 - 2 * frameShift) + 16 : width;
          return {
            perUnit,
            states,
            touching,
            foot,
            aside: Math.max(0, ...touching.map((e) => 182 + e.margin - e.left)),
            down: Math.max(0, ...touching.map((e) => 102 + e.margin - e.top)),
            room: Math.min(...[0, -0.16, -0.08, 0.08, 0.16].map((turn) => file - PANEL_CLEAR - rightAt(turn, perUnit))),
            under: height - 76 - foot,
          };
        };
      let m = measure();
      // Out first, where the view can only move up and the band under the box is short: everything on
      // screen draws in toward the frame's middle with the zoom, so out by `k` the island's top and the
      // box's foot leave room for the lift where k (its distance above the middle plus the foot's below
      // it) is no more than the frame's height less the two bands, the chip's foot and the margin.
      if (m.touching.length && m.aside > m.room && !frameDrop && m.down > m.under) {
        const below = m.foot - height / 2,
          k = Math.min(...m.touching.map((e) => (height - 178 - e.margin) / (height / 2 - e.top + below)));
        if (k < 1 && targetZoom > controls.minZoom) {
          targetZoom = Math.max(controls.minZoom, targetZoom * k);
          place();
          m = measure();
        }
      }
      if (m.touching.length) {
        if (m.aside <= m.room) target.addScaledVector(right, -m.aside / m.perUnit);
        else if (!frameDrop && 102 + PANEL_CLEAR - m.states[0].top <= m.under) {
          const by = Math.min(m.down, m.under);
          target.addScaledVector(up, by / m.perUnit).addScaledVector(back, -(up.y * by) / m.perUnit / back.y);
        }
      }
    }
    tween = true;
  }
  function fitFocused() {
    if (overviewFit) {
      fitOverview();
      return;
    }
    if (focusedIds.length === 1 && focusedIds[0] === 'airport') {
      fitGroup(AIRPORT_FIT, 0.95, 2.6, panelEdge);
      return;
    }
    if (focusedIds.length === 1 && focusedIds[0] === 'sky-island') {
      focusSky();
      return;
    }
    // The tropic island's file: the whole island (TROPIC_EXTENT, its outline at the water and the tops
    // of its roof and trees), fitted like the airport's between 0.95 and 2.6 (City mode only, whose
    // file passes no panel edge), and kept in that frame through the idle drift (driftHold).
    if (focusedIds.length === 1 && focusedIds[0] === 'tropic-island') {
      fitGroup(TROPIC_EXTENT, 0.95, 2.6);
      driftHold(TROPIC_EXTENT, 0.95);
      return;
    }
    const roots = focusedIds
      .map((id) => models.get(id)?.root)
      .filter((r): r is T.Group => !!r);
    if (!roots.length) return;
    city.updateMatrixWorld(true);
    const bounds = new T.Box3();
    roots.forEach((r) => bounds.union(new T.Box3().setFromObject(r)));
    if (roots.length > 1) {
      fitGroup(bounds);
      return;
    }
    target.copy(bounds.getCenter(new T.Vector3()));
    const size = bounds.getSize(new T.Vector3());
    const spanX = (size.x + size.z) * 0.707,
      spanY = (size.x + size.z) * 0.48 + size.y * 0.75;
    // A frame drop (a phone's sheet or bars below) leaves only part of the height in view.
    targetZoom = T.MathUtils.clamp(
      Math.min(
        ((camera.right - camera.left) * 0.62) / spanX,
        ((camera.top - camera.bottom) * 0.65 * (1 - 2 * Math.abs(frameDrop))) / spanY,
      ),
      1.3,
      3.4,
    );
    offsetTarget();
    tween = true;
  }
  /**
   * How fitGroup frames a group's bounds (a box, or the points of its silhouette), without framing
   * them: the screen's axes from the bearing the view heads for at `low` of the way down to the sky
   * island's pitch (viewOffset), the bounds' extent along them, the room beside a panel that starts at
   * `edge`, and the zoom that fits them between `far` and `near` in the part of the frame left free.
   */
  function groupFrame(bounds: T.Box3 | readonly T.Vector3[], far: number, near: number, edge: number, low: number) {
    const back = viewOffset(targetYaw, new T.Vector3(), low).normalize(),
      right = new T.Vector3(Math.cos(targetYaw), 0, -Math.sin(targetYaw)),
      up = new T.Vector3().crossVectors(back, right),
      corners = bounds instanceof T.Box3 ? Array.from({ length: 8 }, (_, i) => new T.Vector3(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z)) : bounds;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const corner of corners) {
      const sx = corner.dot(right),
        sy = corner.dot(up);
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
    // Beside a side panel the group keeps a margin from it: the reading page's panel starts a
    // little left of where the frame shift alone would put the free space's edge.
    const room = edge * width - 2 * PANEL_CLEAR,
      freeWidth = Math.max(1, Math.min(Math.max(0.3, 1 - 2.5 * Math.abs(frameShift)) * width - 48, room)),
      shownHeight = Math.max(0.3, 1 - 2 * Math.abs(frameDrop)) * height,
      freeHeight = Math.max(shownHeight * 0.6, shownHeight - 152);
    const zoom = T.MathUtils.clamp(
      Math.min(
        ((freeWidth / width) * (camera.right - camera.left)) / (maxX - minX),
        ((freeHeight / height) * (camera.top - camera.bottom)) / (maxY - minY),
      ),
      far,
      near,
    );
    return { back, right, up, minX, maxX, minY, maxY, room, zoom };
  }
  /**
   * A group of buildings (the People chapter's homes and the residence, a long row): fitted by
   * their bounds as seen from the bearing they are framed at, as the overview is, in the part of
   * the frame a side panel, a phone's sheet or bars, the masthead and the controls leave free. A
   * row seen along its length takes less of the frame than the one-building rule (which is blind
   * to the bearing) allows for, and on a phone that crowded the roofs' name tags together. The zoom
   * stays within `near` and `far` (the airport's island and the tropic island take 0.95 to 2.6). Beside a panel that
   * starts at `edge` (a share of the width), left of where the frame shift puts the free space's
   * edge, the group is fitted into the space the panel really leaves, PANEL_CLEAR px clear of it
   * and of the frame's left edge, the view's centre moved just as far as it must be: the reading
   * page's panel is half the window wide from 1180 px down and starts at about 46% of it (45% with
   * a scrollbar), where the shift's 0.21 assumes 52%, and at 1024 x 768 it covered the airport's
   * island's east end by 30 px.
   */
  function fitGroup(bounds: T.Box3 | readonly T.Vector3[], far = 1.3, near = 3.4, edge = 1, low = 0) {
    const { back, right, up, minX, maxX, minY, maxY, room, zoom } = groupFrame(bounds, far, near, edge, low);
    targetZoom = zoom;
    // Centre the group's outline (on the ground, as the overview does).
    target
      .copy(right)
      .multiplyScalar((minX + maxX) / 2)
      .addScaledVector(up, (minY + maxY) / 2);
    target.addScaledVector(back, -target.y / back.y);
    offsetTarget();
    // A panel that comes nearer than the shift allows for: the group's middle moves left until its
    // right edge is PANEL_CLEAR px from the panel (in the middle of the room, if it is wider), the
    // view's centre right with it. The frame shift's own offset (shiftApplied) is untouched.
    if (edge < 1) {
      const perUnit = (width * targetZoom) / (camera.right - camera.left),
        half = ((maxX - minX) * perUnit) / 2,
        middle = width / 2 - frameShift * width,
        wanted = Math.min(middle, 2 * half <= room ? edge * width - PANEL_CLEAR - half : (edge * width) / 2);
      target.addScaledVector(right, (middle - wanted) / perUnit);
    }
    tween = true;
  }
  /**
   * A group fitted by fitGroup (beside no panel edge) kept inside the part of the frame it was fitted
   * into through the idle drift, which turns the view 0.16 either way about its centre, the panel
   * offset's point off the group: where the drift would swing it out (a group that fills that part's
   * height, as the tropic island does on 16:9 screens, slid 37 px under the masthead's band and the
   * bottom one at 1920 x 1080), the view goes out as far as it must, never past `far`. Each point's
   * place on screen under a turn is its offset from the group's middle times the zoom, less the panel
   * offset's turned share (the same at every zoom), so each side of that part bounds the zoom outright.
   */
  function driftHold(points: readonly T.Vector3[], far: number) {
    const { back, right, up, minX, maxX, minY, maxY } = groupFrame(points, far, targetZoom, 1, 0),
      middle = right
        .clone()
        .multiplyScalar((minX + maxX) / 2)
        .addScaledVector(up, (minY + maxY) / 2);
    middle.addScaledVector(back, -middle.y / back.y);
    const perUnit = width / (camera.right - camera.left),
      shownHeight = Math.max(0.3, 1 - 2 * Math.abs(frameDrop)) * height,
      half = {
        x: Math.max(1, Math.min(Math.max(0.3, 1 - 2.5 * Math.abs(frameShift)) * width - 48, width - 2 * PANEL_CLEAR)) / 2,
        y: Math.max(shownHeight * 0.6, shownHeight - 152) / 2,
      },
      // The group's middle on screen (px from the frame's centre), where the panel offset puts it.
      at = { x: -frameShift * width, y: frameDrop * height },
      offset = new T.Vector3();
    let zoom = targetZoom;
    for (const turn of [-0.16, -0.08, 0.08, 0.16]) {
      const turnedRight = new T.Vector3(Math.cos(targetYaw + turn), 0, -Math.sin(targetYaw + turn)),
        turnedUp = new T.Vector3().crossVectors(viewOffset(targetYaw + turn, new T.Vector3(), 0).normalize(), turnedRight),
        // The panel offset's share of the turned axes (px), at any zoom.
        shift = { x: -at.x * right.dot(turnedRight) + at.y * up.dot(turnedRight), y: -at.x * right.dot(turnedUp) + at.y * up.dot(turnedUp) };
      for (const p of points) {
        offset.subVectors(p, middle);
        const across = offset.dot(turnedRight) * perUnit,
          rise = offset.dot(turnedUp) * perUnit,
          // On screen at `zoom`: x = across * zoom - shift.x, y = -(rise * zoom) + shift.y (down), both from
          // the frame's centre, inside the part left free round the middle: at.x +- half.x, at.y +- half.y.
          room = [
            [across, across > 0 ? at.x + half.x + shift.x : -(at.x - half.x + shift.x)],
            [rise, rise > 0 ? -(at.y - half.y - shift.y) : at.y + half.y - shift.y],
          ];
        for (const [reach, space] of room) if (Math.abs(reach) > 1e-9 && space > 0) zoom = Math.min(zoom, space / Math.abs(reach));
      }
    }
    if (zoom < targetZoom - 1e-9) {
      targetZoom = Math.max(far, zoom);
      target.copy(middle);
      offsetTarget();
    }
  }
  /**
   * The sky island's own frame, at its own pitch (SKY_PITCH: the camera comes down to it as the
   * glide closes in): SKY_FIT fitted like a group between 0.7 and 2.6, which leaves the target on
   * the ground 18.7 beyond the island along the line of sight at that pitch, 30 degrees (11.7 at the
   * town's, 42.6); then the target is raised SKY_LIFT up that line. Nothing on screen changes, but
   * the idle drift now turns the view about a point 4 under the island's middle, not 10 (it swings
   * the island much less far), and the target still stands under the pan limit's lift: a
   * one-building framing, on the island's own middle 10.5 up, would stand over it, and the limit
   * would slide the camera as the glide ended. The floor of 0.7 (the airport's is 0.95) is for
   * short windows under 961 px wide, whose peeking sheet leaves the island a band of about 137 px
   * (960 x 540 fits it at 0.7, 800 x 600 at 0.74): at 0.95 its chimneys rose into the masthead and
   * its rock sank under the sheet. Every listed screen fits it at 1.19 or more (a phone on its
   * side), so their framings are as they were. At `zoom` (a zoom the visitor chose: Rotate after a
   * pan or a zoom) the subject is the same, the panel offset measured at that zoom instead of the
   * fit's.
   */
  function focusSky(zoom?: number) {
    fitGroup(SKY_FIT, 0.7, 2.6, panelEdge, 1);
    if (zoom) {
      target.sub(shiftApplied);
      targetZoom = zoom;
      offsetTarget();
    }
    const back = viewOffset(targetYaw, new T.Vector3(), 1).normalize();
    target.addScaledVector(back, SKY_LIFT / back.y);
    // A turn still to come (Rotate, or the file opened from another bearing) turns the view about the
    // island (turnSky): the framing just set, the one for the bearing the turn ends at, is turned back
    // about the island by what is left of the turn, so the turn itself carries it there. (The panel
    // offset in the target is already the present bearing's.)
    const left = yaw - targetYaw;
    if (Math.abs(left) > 1e-9 && skyFile()) {
      const subject = target.clone().sub(shiftApplied),
        pivot = skyPivot(subject, targetYaw);
      target.copy(subject.sub(pivot).applyAxisAngle(new T.Vector3(0, 1, 0), left).add(pivot)).add(shiftApplied);
    }
  }
  /** The zoom the sky island's own file frames it at (focusSky's fit), for the frame as it is and the bearing the view heads for. */
  function skyFitZoom() {
    return groupFrame(SKY_FIT, 0.7, 2.6, panelEdge, 1).zoom;
  }
  /** Whether the view is the sky island's own file: the island framed alone, or panned and zoomed about since (as aim() has it). */
  function skyFile() {
    return focusedIds.length === 1 && focusedIds[0] === 'sky-island' && !overviewFit && !inspect && !parkSelected;
  }
  /**
   * What the sky island's own file turns about: the point at the height of the island's own middle
   * (SKY_FIT's) on the line of sight through `subject` (a framing's target less its panel offset), seen
   * from `bearing` at the pitch the view heads for. In the file as it frames the island (and Rotate
   * frames it again, a pan or a zoom since or not: rotate) that is the island's middle itself, so a
   * turn turns the island where it stands in the frame.
   */
  function skyPivot(subject: T.Vector3, bearing: number, out = new T.Vector3()) {
    const back = viewOffset(bearing, out, aim()).normalize();
    return back.multiplyScalar(((SKY_FIT.max.y + SKY_FIT.min.y) / 2 - subject.y) / back.y).add(subject);
  }
  /**
   * A turning frame in the sky island's own file (the frame loop's turn, `turn` radians of it): the
   * view turns about the island (skyPivot), not about its target, which stands on the line of sight
   * 7.4 beyond the island (SKY_LIFT): each quarter turn about that point swung the island into a corner
   * of the frame, its roof under the masthead or its side against the file. The glide's target, the
   * view centre and the panel offset (which turns with the camera, as it does everywhere) turn about
   * it together, so the island holds its place beside the file all through the turn, the glide easing
   * in only what the new bearing's framing changes (focusSky). Anywhere else it does nothing and
   * returns false.
   */
  function turnSky(turn: number) {
    if (!skyFile()) return false;
    const pivot = skyPivot(target.clone().sub(shiftApplied), yaw - turn),
      up = new T.Vector3(0, 1, 0);
    for (const point of [target, controls.target]) point.sub(pivot).applyAxisAngle(up, turn).add(pivot);
    shiftApplied.applyAxisAngle(up, turn);
    return true;
  }
  const ahead = { camera: new T.OrthographicCamera(), centre: new T.Vector3(), pivot: new T.Vector3(), offset: new T.Vector3() };
  /**
   * The camera as the turn in hand will leave it in the sky island's own file: the glide's target
   * turned about the island (skyPivot, as turnSky turns it) by what is left of the turn, seen from
   * the bearing, at the zoom and from the pitch the view heads for (the idle drift as it stands).
   */
  function skyAhead() {
    const { camera: view, centre, pivot, offset: back } = ahead;
    skyPivot(centre.copy(target).sub(shiftApplied), yaw, pivot);
    centre.copy(target).sub(pivot).applyAxisAngle(UP, targetYaw - yaw).add(pivot);
    view.copy(camera);
    view.zoom = targetZoom;
    view.position.copy(centre).add(viewOffset(targetYaw + driftAngle, back, aim()));
    view.lookAt(centre);
    view.updateProjectionMatrix();
    view.updateMatrixWorld();
    return view;
  }
  /** A place's root in the town: a building's model, or the sky island's own. */
  const rootOf = (id: BuildingId) => (id === 'sky-island' ? island.root : models.get(id)?.root);
  /**
   * Whether a neighbour island is to be hidden (`hides`: the reading frames, besides the last shot and
   * the opening view, that would show a cut slice of it). The reading page's last shot (the whole town
   * once the footer arrives) and the opening view hide both: a phone's tall opening frame shows a sliver
   * of the sky island's rock, puffs and a floating rock along its very top edge and its shadow on the sea
   * below, and the tropic island, south of the town, lands in the frame's bottom left, a corner of it
   * under a desktop's hero copy and tools and half of it under a phone's. They hide them only while the
   * camera holds them as it framed them (overviewFit; reset(): nothing framed, no park, and autoFocus): a
   * drag, a wheel or pinch zoom (cancel()) or the +/- buttons hand the view to the visitor, and each
   * island shows wherever it is in view (the opening framing leaves them out of a desktop's frame but for
   * that corner, and a pan or a zoom out brings them in). The sky island's `hides` are the People
   * chapter's frames (its row, and each home or the residence picked from it); every other reading frame
   * leaves both out of sight, so the reading page stays as it was. City mode always shows them, their own
   * files among its frames. (When they go and come: islandShown.)
   */
  function islandHidden(hides: ReadonlySet<BuildingId>) {
    return !cityMode && !inspect && (overviewFit || (autoFocus && focusedIds.length === 0 && !parkSelected) || (focusedIds.length > 0 && focusedIds.every((id) => hides.has(id))));
  }
  const onScreen = new T.Vector3();
  /**
   * How much of `points` (world points, or points in the frame of `matrix`) the frame shows as the
   * camera stands (or as `lens` would): how far the screen box round them reaches into it (px, the
   * lesser of the box's width and height inside it: 0 if it misses it), and what share of that box
   * lies inside it.
   */
  function islandOnScreen(points: readonly T.Vector3[], matrix?: T.Matrix4, lens: T.Camera = camera) {
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const point of points) {
      onScreen.copy(point);
      if (matrix) onScreen.applyMatrix4(matrix);
      onScreen.project(lens);
      x0 = Math.min(x0, onScreen.x);
      x1 = Math.max(x1, onScreen.x);
      y0 = Math.min(y0, onScreen.y);
      y1 = Math.max(y1, onScreen.y);
    }
    const across = Math.max(0, Math.min(x1, 1) - Math.max(x0, -1)),
      down = Math.max(0, Math.min(y1, 1) - Math.max(y0, -1));
    return { reach: Math.min((across * width) / 2, (down * height) / 2), share: (across * down) / ((x1 - x0) * (y1 - y0)) };
  }
  const settling = { lens: new T.OrthographicCamera(), offset: new T.Vector3() };
  /** The camera where the glide under way leaves it: on its target, at its zoom, bearing and pitch (the idle drift as it stands). */
  function settledView() {
    const { lens, offset: back } = settling;
    lens.copy(camera);
    lens.zoom = targetZoom;
    lens.position.copy(target).add(viewOffset(targetYaw + driftAngle, back, aim()));
    lens.lookAt(target);
    lens.updateProjectionMatrix();
    lens.updateMatrixWorld();
    return lens;
  }
  /**
   * Whether a neighbour island is in view this frame, from whether it was (`shown`): the one rule both
   * islands go and come by, never seen to go where they stand in view (they are opaque, so they cannot
   * fade). A frame that hides an island (islandHidden, by its `hides`) takes it, and what goes with it
   * on the sea (`pool`: the sky island's shadow, `points` in the frame of the object `on`; the tropic
   * island's shelf and shallows are among its own points, `seen`), on a frame where nothing of either
   * reaches more than a pixel into the frame (`leave.edge`). Glided into from a view that shows it (its
   * own file left by the wordmark, Recentre in a chapter panned to it), it glides out of the frame whole;
   * from anywhere else it is already out of view and goes at once. Where the glide leaves some of it in
   * the frame, the two islands part ways:
   * - the sky island also goes once the camera has come to rest in the framing it chose there (its
   *   glide, turn and pitch done: autoFocus, not a view the visitor has taken over) with no more than a
   *   cut slice of it left in the frame (`leave.slice` of the screen box round it: the phone's opening
   *   view leaves 35% of it at most through the idle drift, the People chapter 29% at 1024 x 768), and a
   *   frame that holds more of it (a portrait tablet's opening view, the last shot) keeps it until it
   *   leaves;
   * - the tropic island (`leave.slice` null) is never taken from where it was drawn: it goes only on a
   *   frame where the camera moves (a glide, a turn, the pitch) with none of it in view, or where none of
   *   it was drawn the frame before (`before`: a cut under reduced motion lands on it). So the corner of
   *   it the opening view leaves in a desktop's frame from its own file (the last shot and a phone's
   *   opening view, more of it) stays while the camera rests, through the idle drift (which may swing it
   *   out and back), and goes as the next glide carries it off.
   * It comes back as the frame stops hiding it once the glide out has ended (the frames either side
   * leave it out of view), or at once where nothing of it is in view yet, or where the view is the
   * visitor's own (a framing neither the camera's nor the park's: the opening view or the last shot
   * panned or zoomed, which moves under their hand, as before the opening view hid it); the tropic island
   * there waits, while the glide of a + or - press under way leaves none of it in view where it ends
   * (settledView), until it has left the frame, so a zoom in that carries its corner off never shows it
   * for a moment first. City mode, a change of the whole page, brings it back at once.
   */
  function islandShown(shown: boolean, hides: ReadonlySet<BuildingId>, seen: readonly T.Vector3[], leave: { edge: number; slice: number | null }, pool?: { points: readonly T.Vector3[]; on: T.Object3D }, before = true) {
    const hiding = islandHidden(hides);
    if (hiding !== shown) return shown;
    camera.updateMatrixWorld();
    pool?.on.updateMatrixWorld();
    const box = islandOnScreen(seen),
      gone = Math.max(box.reach, pool ? islandOnScreen(pool.points, pool.on.matrixWorld).reach : 0) <= leave.edge,
      still = !tween && Math.abs(targetYaw - yaw) <= 0.0001 && Math.abs(aim(camera.zoom) - pitch) <= 0.0001;
    if (!hiding) return gone || !tween || cityMode || (!(autoFocus || parkSelected) && (leave.slice !== null || islandOnScreen(seen, undefined, settledView()).reach > leave.edge));
    if (leave.slice === null) return before && !(gone && !still);
    return !gone && !(box.share <= leave.slice && autoFocus && still);
  }
  /**
   * Both neighbour islands through the frame (islandShown): the sky island's root, with its pool on the
   * sea (the frame loop lays the pool with skyShown); and the tropic island through its land builder's
   * setShown, which shows or hides it whole with its shelf, shallows and foam, its shadow (it casts in
   * the town's box) drawn again in the very frame it goes or comes; and whether any of it is drawn in
   * this frame (tropicDrawn), which the next frame's rule asks.
   */
  function followIslands() {
    skyShown = islandShown(skyShown, SKY_HIDES, SKY_EXTENT, SKY_LEAVE, { points: POOL_SQUARE, on: seaShadow.mesh });
    island.root.visible = skyShown;
    const shown = islandShown(tropicShown, TROPIC_HIDES, TROPIC_SEEN, TROPIC_LEAVE, undefined, tropicDrawn);
    if (shown !== tropicShown) {
      tropicShown = shown;
      tropic.setShown(shown);
      shadowDirty = true;
    }
    camera.updateMatrixWorld();
    tropicDrawn = tropicShown && islandOnScreen(TROPIC_SEEN).reach > TROPIC_LEAVE.edge;
  }
  /**
   * The sun's shadow box changes hands with the sky island: while the view is close in on the island
   * with the town next to absent, its own box (SKY_TIGHT: skyShadowWanted); in its own file where the
   * frame shows the town's land or the airport's as well (two of its four Rotate stops), a wide box round
   * both (skyWide): there the island casts on itself, everywhere else it casts nothing (and only while it
   * is in view: followIslands). The shadows fade out before the box moves and back in after (a cut under
   * reduced motion), so neither the island's nor the town's ever pop. While the island's file turns from
   * where it stands
   * (skyTurn: Rotate, a pan or a zoom since or not, or the file's bearing set again; not the glide that
   * brings the view to it from elsewhere, which hands over as it closes in, nor a press while that glide
   * is under way), the box is decided at the framing the turn heads for (skyAhead), not at the frames it
   * sweeps through: on a portrait phone the turn from the file's bearing to the next stop swept a strip
   * of the town's coast through the foot of the free band (6.2-7.6% of it, over the 5% the island keeps
   * it to), and the box went to the town and back mid-turn, two fades and two new shadow maps. A turn
   * that ends where the town has the box hands it over once, as it starts; one that ends where the
   * island has it never lets it go.
   */
  function followSky(dt: number) {
    const cast = (on: boolean) => {
      skyCast = on;
      for (const mesh of skyCasters) mesh.castShadow = on;
    };
    if (inspect) {
      // Inspect has the sun's box (and the town is out of sight): the island takes it back, if the
      // view is still on it, once Inspect is left.
      if (skyCast) cast(false);
      skyBox = null;
      shadowFade = 1;
      return;
    }
    camera.updateMatrixWorld();
    if (skyTurn && (!skyFile() || Math.abs(targetYaw - yaw) <= 0.0001)) skyTurn = false;
    // The view it is decided at, and how far down to the island's pitch it is: the island's own file at
    // its fit's zoom or closer counts as close in whatever its pitch (SKY_SHADOW.file), so the same view
    // keeps the same box however the visitor came to it. Its own box where the town is next to absent;
    // in its own file, where the frame shows land, a wide one round both (skyWide); the town's elsewhere.
    const settled = skySettled(),
      view = skyTurn ? skyAhead() : camera,
      low = skyFile() && view.zoom >= SKY_SHADOW.file * skyFitZoom() ? 1 : skyTurn ? aim() : pitch,
      wanted = !skyShown ? null : skyShadowWanted(view, LAND_MARKS, frameShift, frameFoot, skyBox === SKY_TIGHT, low) ? SKY_TIGHT : skyFile() && skyClose(view, !!skyBox, low) ? skyWide(view, settled) : null;
    if (wanted === skyBox) {
      skyNext = null;
      shadowFade = Math.min(1, shadowFade + dt / SKY_SHADOW.fade);
    } else {
      shadowFade = reduced ? 0 : Math.max(0, shadowFade - dt / SKY_SHADOW.fade);
      if (shadowFade <= 0) {
        skyBox = wanted;
        skyNext = null;
        cast(!!wanted);
        shadowFocus(wanted?.centre, wanted?.radius, wanted ?? undefined);
        if (reduced) shadowFade = 1;
      }
    }
  }
  /** The key light's offset at a bearing (placeSun's, which turns it with the yaw alone). */
  function keyAt(bearing: number) {
    return sunOffset.clone().applyAxisAngle(UP, bearing - Math.PI / 4);
  }
  /**
   * Whether the view stands still (once a frame, for followSky): no glide, no turn, the pitch settled,
   * no pointer on the map, and its target and zoom as they were the frame before (the idle drift, which
   * only turns it about its target, aside).
   */
  function skySettled() {
    const still = !tween && !hover.dragging && Math.abs(targetYaw - yaw) <= 0.0001 && Math.abs(aim(camera.zoom) - pitch) <= 0.0001 && controls.target.distanceToSquared(skyStillAt) < 1e-6 && camera.zoom === skyStillZoom;
    skyStillAt.copy(controls.target);
    skyStillZoom = camera.zoom;
    return still;
  }
  /**
   * The sky island's file's box where its frame shows land (SKY_WIDE), for `view` (the camera, or on a
   * turn the framing it heads for: skyAhead): the box it has, while that still holds the island and the
   * land the view shows; else a new one (skyWideBox), but only where the view is the file's to decide
   * (on a turn, from its press, or once the view stands still: a drag, a wheel or a glide under way hands
   * the box to the town as it leaves the one it has, never through a string of new ones); none, the
   * town's, where the island and that land need more than SKY_WIDE.most.
   */
  function skyWide(view: T.OrthographicCamera, settled: boolean) {
    const bearing = skyTurn ? targetYaw : yaw,
      deciding = skyTurn || settled,
      here: [T.OrthographicCamera, T.Vector3][] = [[view, keyAt(bearing)]];
    // Where the view is the file's to decide, the box must hold every view a new one would (skyViews:
    // the drift's swing, the turn's way there), or the drift would hand it over at rest; meanwhile the
    // view as it stands.
    if (skyBox && skyBox !== SKY_TIGHT && (deciding ? skyHolds(skyBox, view, bearing) : sunBoxHolds(skyBox, here, SKY_WIDE.keep))) return skyBox;
    // The box a hand-over under way heads for, while it holds the view (one fit for the fade's frames).
    if (skyNext && sunBoxHolds(skyNext, here, SKY_WIDE.keep)) return skyNext;
    if (!deciding) return null;
    skyNext = skyWideBox(skyViews(view, bearing), 2 * shadowBase);
    // The same box again (the same view, laid on the same texels) is the one it has.
    if (skyNext && skyBox && skyNext.radius === skyBox.radius && skyNext.reach === skyBox.reach && skyNext.far === skyBox.far && skyNext.centre.distanceToSquared(skyBox.centre) < 1e-12) skyNext = skyBox;
    return skyNext;
  }
  /**
   * Whether `box` holds every view a new wide box would be fitted to here (skyViews), SKY_WIDE.keep
   * inside it: worked out once for each framing it is decided at (its bearing, zoom and target; the idle
   * drift, which those views take in, aside) and sun, then remembered.
   */
  function skyHolds(box: SunBox, view: T.OrthographicCamera, bearing: number) {
    const at = skyTurn ? ahead.centre : controls.target,
      held = skyHeld;
    if (held.box === box && Math.abs(held.bearing - bearing) < 1e-4 && Math.abs(held.zoom - view.zoom) < 1e-4 && held.at.distanceToSquared(at) < 1e-6 && held.sun.distanceToSquared(sunOffset) < 1e-4) return true;
    if (!sunBoxHolds(box, skyViews(view, bearing), SKY_WIDE.keep)) return false;
    Object.assign(held, { box, bearing, zoom: view.zoom });
    held.at.copy(at);
    held.sun.copy(sunOffset);
    return true;
  }
  /**
   * The views a new wide box must hold (skyWideBox), each with the key light at its bearing: on a turn
   * its frames on the way from where the view stands (SKY_WIDE.sweep steps, the framing it heads for
   * turned back about the island, at zooms and pitches eased between), then the view it is decided at,
   * swung SKY_WIDE.drift either way by the idle drift, and as it stands, the light it stays in.
   */
  function skyViews(view: T.OrthographicCamera, bearing: number) {
    const views: [T.OrthographicCamera, T.Vector3][] = [],
      centre = skyTurn ? ahead.centre : controls.target,
      low = skyTurn ? aim() : pitch,
      look = (at: T.Vector3, toward: number, zoom: number, down: number) => {
        const lens = camera.clone();
        lens.zoom = zoom;
        lens.position.copy(at).add(viewOffset(toward, new T.Vector3(), down));
        lens.lookAt(at);
        lens.updateProjectionMatrix();
        lens.updateMatrixWorld();
        return lens;
      };
    if (skyTurn)
      for (let k = 1; k < SKY_WIDE.sweep; k++) {
        const t = k / SKY_WIDE.sweep,
          on = yaw + (targetYaw - yaw) * t,
          at = ahead.centre.clone().sub(ahead.pivot).applyAxisAngle(UP, on - targetYaw).add(ahead.pivot);
        views.push([look(at, on + driftAngle, T.MathUtils.lerp(camera.zoom, view.zoom, t), T.MathUtils.lerp(pitch, low, t)), keyAt(on)]);
      }
    for (const swing of [-SKY_WIDE.drift, SKY_WIDE.drift]) views.push([look(centre, bearing + swing, view.zoom, low), keyAt(bearing)]);
    views.push([view, keyAt(bearing)]);
    return views;
  }
  function focusBuildings(ids: BuildingId[]) {
    exitInspection();
    focusedIds = [...new Set(ids)];
    parkSelected = false;
    autoFocus = true;
    overviewFit = false;
    fitFocused();
  }
  function resize() {
    if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
    width = container.clientWidth;
    height = container.clientHeight;
    const aspect = width / Math.max(height, 1),
      vertical = Math.max(53, 76 / aspect);
    camera.left = (-vertical * aspect) / 2;
    camera.right = (vertical * aspect) / 2;
    camera.top = vertical / 2;
    camera.bottom = -vertical / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    ink.resize(width, height);
    controls.minZoom = width >= height ? WIDEST.wide : WIDEST.tall;
    inspectionAutoFit = true;
    if (autoFocus) fitFocused();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  const visibilityObserver = new IntersectionObserver(
    ([entry]) => {
      inViewport = entry.isIntersecting;
      if (!inViewport) clearHover();
      last = 0;
    },
    { rootMargin: '100px' },
  );
  visibilityObserver.observe(container);
  resize();
  function align() {
    viewOffset(yaw + driftAngle, offset);
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);
    camera.updateProjectionMatrix();
    placeSun();
  }
  align();
  controls.update();
  // Inspect stands the building on a soft shadow: a disc that shows only the shadow it catches.
  const studyGround = new T.Mesh(
    new T.CircleGeometry(1, 64),
    new T.ShadowMaterial({ color: '#1d2a26', opacity: 0.22, fog: false }),
  );
  studyGround.rotation.x = -Math.PI / 2;
  studyGround.receiveShadow = true;
  function exitInspection() {
    // The sun's shadow goes back to the town from Inspect's building. Framing the sky island
    // (followSky), it is left there: it goes home by itself as the view leaves the island.
    if (inspect || !skyCast) shadowFocus();
    clearHover();
    if (inspect) {
      scene.remove(inspect, studyGround);
      inspect = null;
      inspectParts = [];
    }
    city.visible = true;
    zones.visible = planMode;
    // A study zoom closer than the town's limit eases out: the limit comes down with the
    // glide (see step) rather than OrbitControls clamping the zoom in one frame.
    controls.maxZoom = Math.max(CITY_MAX_ZOOM, camera.zoom);
  }
  /** Inspect's framing: the building fitted to the camera's frustum, beside the panel or
   *  above the sheet. */
  function frameStudy() {
    if (!inspect) return;
    const fit = fitStudy(
      inspect.userData.exteriorBounds,
      camera,
      1 - 2 * Math.abs(frameShift),
      1 - 2 * Math.abs(frameDrop),
    );
    target.copy(inspect.position).add(fit.focus).add(shiftApplied);
    targetZoom = fit.zoom;
    tween = true;
  }
  function select(id: BuildingId) {
    exitInspection();
    // (The sky island is no model: fitFocused frames it by its own box.)
    const m = models.get(id);
    if (m) target.copy(m.center).add(new T.Vector3(0, 1, 0));
    offsetTarget();
    focusedIds = [id];
    parkSelected = false;
    autoFocus = true;
    overviewFit = false;
    fitFocused();
    tween = true;
  }
  /**
   * The opening view: the island's centre at zoom 1 from the opening bearing. It is the camera's own
   * framing (autoFocus) until the visitor pans or zooms it, which is all the neighbour islands' hiding
   * asks of it (islandHidden); fitted again (a resize, a new frame shift), it frames nothing
   * (fitFocused), and its panel offset follows by itself (followPanel).
   */
  function reset() {
    exitInspection();
    focusedIds = [];
    parkSelected = false;
    autoFocus = true;
    overviewFit = false;
    target.set(0, 0, 0);
    targetZoom = 1;
    offsetTarget();
    targetYaw = yaw + shortestAngle(yaw, Math.PI / 4);
    tween = true;
  }
  function overview(clearSelection = false) {
    if (inspect && !clearSelection) {
      // Inspect's own reset: the bearing it opened at, the building framed again.
      targetYaw = yaw + shortestAngle(yaw, inspectYaw);
      inspectionAutoFit = true;
      return;
    }
    exitInspection();
    if (clearSelection) {
      focusedIds = [];
      parkSelected = false;
    }
    autoFocus = true;
    overviewFit = true;
    targetYaw = yaw + shortestAngle(yaw, Math.PI / 4);
    fitOverview();
  }
  function cancel() {
    clearHover();
    autoFocus = false;
    overviewFit = false;
    inspectionAutoFit = false;
    tween = false;
    targetZoom = camera.zoom;
    lastInteraction = performance.now();
  }
  controls.addEventListener('start', cancel);
  const ray = new T.Raycaster(),
    mouse = new T.Vector2();
  let downX = 0,
    downY = 0,
    multiPointer = false,
    // The press has strayed past a tap's slop at some point: a drag, even one that came back.
    travelled = false;
  const activePointers = new Set<number>();
  function pickAt(clientX: number, clientY: number) {
    if (inspect) return null;
    const rect = container.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      clientX < rect.left ||
      clientX > rect.left + rect.width ||
      clientY < rect.top ||
      clientY > rect.top + rect.height
    )
      return null;
    mouse.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      (-(clientY - rect.top) / rect.height) * 2 + 1,
    );
    ray.setFromCamera(mouse, camera);
    // An orthographic ray starts at the camera plane; with the negative near plane, scenery
    // can sit behind that plane (low on tall frames), so start the ray at the near plane.
    ray.ray.origin.addScaledVector(ray.ray.direction, camera.near);
    ray.far = camera.far - camera.near;
    return pickTarget(ray, tropicShown ? models : shownWithoutTropic, parkHit, skyPick);
  }
  function down(e: PointerEvent) {
    clearHover();
    hover.dragging = true;
    activePointers.add(e.pointerId);
    if (activePointers.size > 1) multiPointer = true;
    else {
      downX = e.clientX;
      downY = e.clientY;
      travelled = false;
    }
  }
  /** A fingertip wobbles more than a mouse: a tap may travel 10 px and still pick. */
  function strayed(e: PointerEvent) {
    return (
      Math.hypot(e.clientX - downX, e.clientY - downY) >
      (e.pointerType === 'touch' ? 10 : 5)
    );
  }
  function up(e: PointerEvent) {
    const tracked = activePointers.delete(e.pointerId);
    const blocked = multiPointer || activePointers.size > 0;
    if (activePointers.size === 0) {
      hover.dragging = false;
      multiPointer = false;
    }
    // A tap stays within its slop the whole way: a pan that comes back is still a pan.
    if (!tracked || blocked || e.button !== 0 || travelled || strayed(e)) return;
    const id = pickAt(e.clientX, e.clientY);
    if (id === 'corner-park') onPark();
    else if (id) onSelect(id);
  }
  function move(e: PointerEvent) {
    pointerMove(hover, e);
    if (e.buttons) clearHover();
    if (activePointers.has(e.pointerId) && strayed(e)) travelled = true;
  }
  function clearHover() {
    clearPointer(hover);
    labels.forEach(({ element }) => {
      if (element) element.style.visibility = 'hidden';
    });
    renderer.domElement.style.cursor = 'grab';
  }
  function leave() {
    hover.dragging = false;
    activePointers.clear();
    multiPointer = false;
    clearHover();
  }
  /**
   * Where a place stands on screen (px in the stage), for its floating label to keep beside it
   * (labelPosition, City mode): the box round its points as the camera sees them now. A building's
   * points are the corners of its pointer box (its bounds; the airport's, its hall's), the park's those
   * of its own; the sky island's are its silhouette (SKY_MARKS) and an octagon round each cloud and
   * rock as far out as it reaches, at its foot and its top (in units of its size: a cloud 2.55 out,
   * 0.07 under its base and 1.5 over it; a rock 1.3 out, 1.8 under and 1.2 over). Gathered once a place.
   */
  const subjectPoints = new Map<HoverTarget, T.Vector3[]>(),
    subjectAt = new T.Vector3();
  function subjectBox(id: HoverTarget) {
    let points = subjectPoints.get(id);
    if (!points) {
      points = [];
      if (id === 'sky-island') {
        points.push(...SKY_MARKS);
        for (const [floats, reach, sink, rise] of [[plan.SKY_CLOUDS, 2.55, 0.07, 1.5], [plan.SKY_ROCKS, 1.3, 1.8, 1.2]] as const)
          for (const float of floats)
            for (let k = 0; k < 8; k++) {
              const angle = (k / 8) * Math.PI * 2,
                out = (reach * float.size) / Math.cos(Math.PI / 8);
              for (const y of [float.y - sink * float.size, float.y + rise * float.size])
                points.push(new T.Vector3(float.x + Math.cos(angle) * out, y, float.z + Math.sin(angle) * out));
            }
      } else if (id) {
        const model = id === 'corner-park' ? undefined : models.get(id),
          own = id === 'corner-park' ? parkHit : model?.hit,
          bounds =
            own instanceof T.Mesh
              ? new T.Box3().setFromBufferAttribute(own.geometry.getAttribute('position') as T.BufferAttribute).applyMatrix4(own.matrixWorld)
              : model
                ? new T.Box3().setFromObject(model.root)
                : new T.Box3();
        if (!bounds.isEmpty())
          for (let i = 0; i < 8; i++) points.push(new T.Vector3(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z));
      }
      subjectPoints.set(id, points);
    }
    if (!points.length) return undefined;
    const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const point of points) {
      subjectAt.copy(point).project(camera);
      const x = ((subjectAt.x + 1) / 2) * width,
        y = ((1 - subjectAt.y) / 2) * height;
      box.left = Math.min(box.left, x);
      box.right = Math.max(box.right, x);
      box.top = Math.min(box.top, y);
      box.bottom = Math.max(box.bottom, y);
    }
    return box;
  }
  function updateHover() {
    const active =
      hoverAllowed(hover, !!inspect, inViewport) && !document.hidden;
    const id = active ? pickAt(hover.x, hover.y) : null;
    hover.id = id;
    const rect = container.getBoundingClientRect();
    renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
    for (const { b, element } of labels) {
      if (!element) continue;
      const visible = id === b.id;
      element.style.visibility = visible ? 'visible' : 'hidden';
      if (visible) {
        // In City mode the label keeps clear of the place it names, of the file beside it (its left
        // edge, from the frame shift) and of the sheet or bars below (their top, from the frame drop,
        // which page.tsx's fileFrame centres between them and the masthead's 58 px foot).
        const p = labelPosition(
          { x: hover.x - rect.left, y: hover.y - rect.top },
          { width: element.offsetWidth, height: element.offsetHeight },
          {
            width: cityMode && frameShift > 0 ? Math.min(width, width * (1 - 2 * frameShift) + 16) : width,
            height: cityMode && frameDrop < 0 ? Math.max(0, height * (1 + 2 * frameDrop) - 58) : height,
          },
          cityMode ? subjectBox(b.id) : undefined,
        );
        element.style.transform =
          'translate(' + Math.round(p.x) + 'px,' + Math.round(p.y) + 'px)';
      }
    }
  }
  /**
   * Keep each name tag over its roof: the anchor is projected with the frame just rendered,
   * and the tag's bottom centre is put there, or higher if the chimney pots stand higher on
   * screen (a chimney towards the back or the far end). A roof outside the frame hides its tag.
   */
  function placeHomeTags() {
    const on = tagsOn && !inspect && !planMode;
    for (const tag of homeTags) {
      let show = on;
      if (on) {
        tagPoint.copy(tag.anchor).project(camera);
        const x = ((tagPoint.x + 1) / 2) * width;
        let y = ((1 - tagPoint.y) / 2) * height;
        tagPoint.copy(tag.pots).project(camera);
        y = Math.min(y, ((1 - tagPoint.y) / 2) * height);
        show = x > 0 && x < width && y > 0 && y < height;
        const placed = `translate(${Math.round(x)}px,${Math.round(y)}px) translate(-50%,-100%)`;
        if (show && placed !== tag.placed) {
          tag.element.style.transform = placed;
          tag.placed = placed;
        }
      }
      if (show !== tag.shown) {
        tag.shown = show;
        tag.element.toggleAttribute('data-shown', show);
      }
    }
  }
  renderer.domElement.addEventListener('pointerdown', down);
  renderer.domElement.addEventListener('pointerup', up);
  renderer.domElement.addEventListener('pointermove', move);
  renderer.domElement.addEventListener('pointerleave', leave);
  renderer.domElement.addEventListener('pointercancel', leave);
  window.addEventListener('blur', leave);
  document.addEventListener('visibilitychange', leave);
  function setClocks() {
    const hours = glasgowSky().hours;
    for (const clock of clocks) {
      clock.hour.rotation.z = -((hours % 12) / 12) * Math.PI * 2;
      clock.minute.rotation.z = -((hours % 1) * Math.PI * 2);
    }
  }
  // Recent frame intervals: their 10th percentile is the display's refresh interval, so the
  // governor's thresholds work the same on 60, 90 and 120 Hz screens.
  const intervals = new Float32Array(120);
  let intervalCount = 0;
  function frame(now: number) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    step(now, false);
  }
  /** One update and render. `force` runs it even in a hidden tab (debug ticking only). */
  function step(now: number, force: boolean) {
    // Never negative: the debug ticker runs the clock ahead of real frames, and a negative dt
    // turns every ease into an exponential runaway (night grew past 1e18 and the town went black).
    const dt = last ? T.MathUtils.clamp((now - last) / 1000, 0, 0.05) : 0;
    last = now;
    // Nothing is drawn before the first sky (the page sends it once the town is ready, a task
    // or two after the first frame may come): no daylit town flashing up at night.
    if (!force && (document.hidden || !inViewport || !skyKnown)) return;
    if (dt > 0 && dt < 0.05) intervals[intervalCount++ % intervals.length] = dt;
    const blend = reduced ? 1 : 1 - Math.exp(-dt * 5.5);
    if (!paused) time += dt;
    // A wheel or pinch zoom (OrbitControls applies it in its own event handler) is the zoom
    // to keep, so a later re-fit cannot spring back. Zoomed at the view centre, the subject
    // beside the panel stays put; zoomed at the pointer (City mode), the point under the
    // pointer stays put and the panel offset is only measured again. Taken before the panel is
    // followed, so the offset is always measured at the zoom the wheel left: the wheel's 'start'
    // (cancel) keeps the zoom before its notch, and followPanel, measuring at that zoom against
    // an offset measured at another (two notches in one frame; a zoom a +/- glide left a hair
    // off its own), took it for a moved panel and glided the zoom back a notch.
    if (!tween && camera.zoom !== shownZoom) {
      targetZoom = camera.zoom;
      const next = panelOffset(new T.Vector3());
      if (!controls.zoomToCursor) controls.target.add(next).sub(shiftApplied);
      shiftApplied.copy(next);
      align();
    }
    followPanel();
    if (Math.abs(targetYaw - yaw) > 0.0001) {
      // The bearing eases in more slowly than the glide and never whips round; a reduced-motion
      // turn is a cut. The bearings asked for already take the shortest way round; quick Rotate
      // presses queue their quarter turns, which keep turning the way the button turns.
      const left = targetYaw - yaw,
        from = yaw;
      if (reduced || Math.abs(left) < 0.0005) yaw = targetYaw = yaw + left;
      else
        yaw +=
          Math.sign(left) *
          Math.min(Math.abs(left) * (1 - Math.exp(-dt * YAW_RATE)), YAW_SPEED * dt);
      // The panel offset turns with the camera, so the subject keeps its place beside the
      // panel all through the turn instead of swinging behind it. (The sky island's own file
      // turns about the island itself: turnSky.)
      if (!turnSky(yaw - from)) {
        const shift = panelOffset(new T.Vector3());
        controls.target.add(shift).sub(shiftApplied);
        target.add(shift).sub(shiftApplied);
        shiftApplied.copy(shift);
      }
      align();
    }
    // The pitch eases toward the one the view heads for at the camera's own zoom, as the bearing does
    // (a glide into the island's file comes down as it closes in; a zoom out of it rises again); a
    // reduced-motion change is a cut.
    {
      const left = aim(camera.zoom) - pitch;
      if (Math.abs(left) > 0.0001) {
        pitch = reduced || Math.abs(left) < 0.0005 ? pitch + left : pitch + left * (1 - Math.exp(-dt * YAW_RATE));
        align();
      }
    }
    if (tween) {
      controls.target.lerp(target, blend);
      camera.zoom = T.MathUtils.lerp(camera.zoom, targetZoom, blend);
      align();
      if (
        controls.target.distanceTo(target) < 0.002 &&
        Math.abs(camera.zoom - targetZoom) < 0.001
      )
        tween = false;
    }
    // The limit is the visitor's: the camera's own glides are never clamped.
    holdPan();
    // Out of Inspect, the zoom limit follows the camera back down to the town's.
    if (!inspect)
      controls.maxZoom = Math.max(CITY_MAX_ZOOM, Math.min(controls.maxZoom, camera.zoom));
    controls.update();
    // Where the limit has left the target: the next hold's slack grows only by what the pitch does to it.
    panLast.copy(controls.target);
    // Whatever the visitor panned to is where the next panel offset starts from.
    if (!tween) target.copy(controls.target);
    shownZoom = camera.zoom;
    night = T.MathUtils.lerp(night, targetNight, reduced ? 1 : blend * 0.45);
    model.materialLibrary.setNight(night);
    followWindows(paneClock, paneGoal, night, dt, reduced);
    paneHours = skyHours;
    model.materialLibrary.setWindows(paneClock.out, paneClock.wake);
    model.materialLibrary.setPixelRatio(renderer.getPixelRatio());
    lighting.update(night, !!inspect);
    sky.intensity = T.MathUtils.lerp(0.85, 0.3, night);
    sun.intensity = T.MathUtils.lerp(3.8, 0.45, night);
    scene.environmentIntensity = T.MathUtils.lerp(0.25, 0.04, night);
    lamps.forEach(
      (l) =>
        ((l.material as T.MeshStandardMaterial).emissiveIntensity =
          night * 2.7),
    );
    if (zones.visible) shadeDistricts(zones, night);
    if (inspect && inspectionAutoFit) frameStudy();
    // People on the pavements, the tram on the ring, the boat in the harbour, the plane on its stand.
    for (const walker of walkers) {
      const before = plan.samplePolyline(walker.loop, walker.distance, true);
      if (!paused) walker.distance += walker.speed * dt;
      // A smooth heading: the ring's corners are sampled every 9°, too coarse to turn by.
      const pose = plan.samplePolyline(walker.loop, walker.distance, true, true);
      animateResident(
        walker.root,
        Math.hypot(pose.x - before.x, pose.z - before.z),
        dt,
        paused,
      );
      walker.root.position.set(
        pose.x,
        plan.walkFloor(pose.x, pose.z) - walker.root.userData.sole,
        pose.z,
      );
      walker.root.rotation.y = pose.heading + (walker.speed < 0 ? Math.PI : 0);
    }
    // The tram runs on town time and keeps to the signals, as the cyclist does a cycle ahead of it
    // (plan.tramPose, plan.cyclistPose); the signals' lenses follow in the animated list.
    const vehicle = plan.tramPose(time);
    tram.position.set(vehicle.x, plan.levels.road, vehicle.z);
    tram.rotation.y = vehicle.heading;
    const pose = plan.boatPose(time);
    boat.position.set(pose.x, model.waterLevel + pose.y, pose.z);
    boat.rotation.set(0, pose.heading, pose.roll);
    // The plane flies its loop on a clock of its own that runs with town time; paused, or for a
    // visitor who prefers reduced motion, it stands parked on its stand (planeClock). It never
    // follows the idle drift.
    const flown = planeTime;
    planeTime = planeClock(planeTime, dt, paused || reduced);
    posePlane(plane, planeTime);
    // Sent back to its stand mid-loop (Pause pressed while it is out), its shadow goes with it at
    // once: a paused frame redraws the shadows only every 30th frame, which left its shadow on
    // the runway and none under it on the stand for up to half a second.
    if (planeTime < flown) shadowDirty = true;
    // The frame for what settles in real time while town time stands still (Alison, town-sky's
    // alison()): held on Pause only, so under reduced motion Play brings her back with the people
    // and the tram (the plane alone stays parked); reduced motion makes her settle nearly a cut.
    // Whatever moved in real time while held (her settle, her water running on) has its shadow
    // drawn again at once, as the plane's is: a paused frame redraws the shadows only every 30th.
    const frameState = animationFrame(paused, reduced, dt);
    for (const entry of animated) entry.update(time, night, rain, frameState);
    if (frameState.moved) shadowDirty = true;
    if (now - clockChecked > 15000) {
      clockChecked = now;
      setClocks();
    }
    // Inspect's copy keeps time and turns its vane with the town.
    followMovingParts(inspectParts);
    // Raycasting the town is the costliest thing a frame can do: only repeat it when
    // the pointer or the camera has actually moved.
    const hoverKey =
      hoverAllowed(hover, !!inspect, inViewport) && !document.hidden
        ? `${hover.x},${hover.y},${camera.position.x.toFixed(2)},${camera.position.z.toFixed(2)},${camera.zoom.toFixed(3)},${controls.target.x.toFixed(2)},${controls.target.z.toFixed(2)}`
        : 'off';
    if (hoverKey !== hoverSignature) {
      hoverSignature = hoverKey;
      updateHover();
    }
    followIslands();
    followSky(dt);
    animateExtras(dt, now, blend);
    ink.render();
    placeHomeTags();
    if (!warmTimer) warmTimer = window.setTimeout(() => void warmLighting(), 1500);
  }
  function animateExtras(dt: number, now: number, blend: number) {
    if (hover.id !== lastHover) {
      lastHover = hover.id as HoverTarget;
      options.onHover?.(lastHover);
    }
    // With the name tags up, the whole row is not ringed: only the home being pointed at
    // (on the model or by its person card) is.
    const ringed = new Set<T.Object3D>(
      tagsOn && focusedIds.length > 1
        ? []
        : focusedIds.map(rootOf).filter((root): root is T.Group => !!root),
    );
    // What the pointer is on, or else what the page points at (a person card, a Directory
    // row). The park is ringed only from the page: on the model it keeps just its label.
    const extra = hover.id && hover.id !== 'corner-park' ? hover.id : accentId;
    const extraRoot =
      extra === 'corner-park'
        ? parkGroup
        : extra
          ? rootOf(extra as BuildingId)
          : undefined;
    const shown = new Set<T.Object3D>(parkSelected ? [parkGroup] : ringed);
    if (extraRoot) shown.add(extraRoot);
    ink.setSelection(inspect ? [] : [...shown]);
    // Idle drift: a slow, breathing turn that stops the moment the visitor acts. Never with
    // reduced motion: Play there brings the people and the tram back, not a turning camera
    // that cuts back each time the map is touched.
    const idle =
      !reduced &&
      drift &&
      !inspect &&
      !hover.dragging &&
      !paused &&
      now - lastInteraction > 4000;
    // It stops where it is: turning back to the bearing would keep the town moving after Pause
    // and turn it under a drag. Inspect (and the drift switched off) take it back to the bearing.
    const driftTarget = idle
      ? Math.sin(time * 0.07) * 0.16 * (1 + (SKY_DRIFT - 1) * Math.min(1, pitch))
      : reduced || !drift || inspect
        ? 0
        : driftAngle;
    const nextDrift = reduced
      ? driftTarget
      : driftAngle + (driftTarget - driftAngle) * Math.min(1, blend * 0.35);
    if (Math.abs(nextDrift - driftAngle) > 1e-6) {
      driftAngle = nextDrift;
      align();
    }
    // The balloon turns with the drift, so it holds its open band of the frame (its update above
    // put it back on its own beat this frame).
    for (const o of driftFollowers) followDrift(o, controls.target, driftAngle);
    // The sun's warmth and the night follow Glasgow's real sky, but the key light stays high
    // and turns with the camera (a stylised sun); rain turns everything grey.
    if (sunOffset.distanceToSquared(targetSunOffset) > 1e-4) {
      sunOffset.lerp(targetSunOffset, reduced ? 1 : Math.min(1, blend * 0.4));
      placeSun();
    }
    sunWarmth = T.MathUtils.lerp(sunWarmth, targetWarmth, reduced ? 1 : blend);
    golden = T.MathUtils.lerp(golden, targetGolden, reduced ? 1 : blend);
    rain = T.MathUtils.lerp(rain, targetRain, reduced ? 1 : blend * 0.5);
    const overcast = 1 - rain * 0.42,
      // Dawn and golden hour: a low, warmer key light and a warm haze, strong enough to read
      // through the saturation grade; cloud mutes it.
      glow = golden * (1 - night) * (1 - rain * 0.7);
    sun.color
      .copy(tint.sunDay)
      .lerp(tint.sunWarm, sunWarmth * (1 - night))
      .lerp(tint.sunGolden, glow * 0.75)
      .lerp(tint.sunNight, night);
    sun.intensity *= overcast;
    // Rain: soft, grey shadows under a cloudy sky.
    sun.shadow.intensity = T.MathUtils.lerp(1, 0.35, rain) * shadowFade;
    sky.intensity *= 1 - rain * 0.18;
    sky.color
      .copy(tint.skyDay)
      .lerp(tint.skyWarm, sunWarmth * 0.6 * (1 - night))
      .lerp(tint.skyRain, rain * 0.5);
    sky.groundColor.copy(tint.groundDay).lerp(tint.groundNight, night);
    fog.color
      .copy(tint.fogDay)
      .lerp(tint.fogNight, night)
      .lerp(tint.fogRain, rain * 0.45 * (1 - night))
      .lerp(tint.fogGolden, glow * 0.6);
    weather.update(dt, rain, paused);
    // Gulls sit out the night and the heavy rain (and Inspect): they shrink away, then hide.
    const gullsOut = inspect ? 0 : gullPresence(night, rain);
    gulls.object.visible = gullsOut > 0.001;
    gulls.update(time, gullsOut);
    water.update(time, night, camera, { rain, sun: keyOffset, moon: moonAt });
    seaShadow.update(keyOffset, night, rain, skyShown);
    // Shadows refresh every other frame: moving things still get moving shadows,
    // and the costliest pass runs half as often. A turned key light refreshes at once.
    frameIndex++;
    renderer.shadowMap.needsUpdate = shadowDirty || (paused ? frameIndex % 30 === 0 : frameIndex % 2 === 0);
    shadowDirty = false;
    // Governor: sustained slow frames step down the quality ladder; sustained cheap
    // frames step back up, slowly, so the picture settles where the device can hold it.
    frameCost = T.MathUtils.lerp(frameCost, dt, 0.04);
    if (now - lastGovern > 2500) {
      if (intervalCount >= 30) {
        const filled = Array.from(intervals.subarray(0, Math.min(intervalCount, intervals.length))).sort((a, b) => a - b);
        refresh = T.MathUtils.clamp(filled[Math.floor(filled.length * 0.1)], 1 / 165, 1 / 30);
      }
      // Step down when frames take about twice the refresh interval (never chase more than 33 fps
      // with resolution); step back up once frames have held close to the refresh rate, or at
      // 50 fps or better: on a 120 Hz screen "close to the refresh rate" is 107 fps, which most
      // machines never reach, so one slow moment would lower the quality for the whole visit.
      // Each step changes the cost by well under the 1.5 times between 50 and 33 fps, so a
      // step back up does not bring the next step down.
      if (frameCost > Math.max(refresh * 1.9, 0.03) && quality < 4) {
        quality++;
        qualityChanged = now;
        lastGovern = now;
        frameCost = refresh;
        applyQuality();
      } else if (
        frameCost < Math.max(refresh * 1.12, 1 / 50) &&
        quality > 0 &&
        now - qualityChanged > 12000
      ) {
        quality--;
        qualityChanged = now;
        lastGovern = now;
        frameCost = refresh;
        applyQuality();
      }
    }
  }
  /**
   * The lamps joining the scene at dusk, and their shadow going at quality 2, change the shader
   * of every lit material, compiled on the spot in the frame they change: a freeze of 0.1-1 s
   * the first time (Night pressed, a real dusk, Day after a night start). Once the town is on
   * screen, compile each lighting state's shaders in the background instead.
   */
  let warmTimer = 0;
  async function warmLighting() {
    const states: [boolean, boolean][] =
      tier === 'low'
        ? [
            [false, false],
            [true, false],
          ]
        : [
            [false, false],
            [true, true],
            [true, false],
          ];
    for (const [inScene, shadow] of states) {
      // Each state's compile call takes a few tens of milliseconds: one at a time, when idle.
      await new Promise<void>((resolve) =>
        typeof window.requestIdleCallback === 'function'
          ? window.requestIdleCallback(() => resolve(), { timeout: 3000 })
          : window.setTimeout(resolve, 100),
      );
      if (disposed) return;
      let compiled: Promise<unknown> = Promise.resolve();
      lighting.asIf(inScene, shadow, () => (compiled = ink.compile()));
      await compiled.catch(() => {});
    }
  }
  /**
   * A lost GPU context (a phone putting the tab away, a GPU reset) comes back with three's
   * textures uploaded again, all but the studio light: a render target baked on the GPU, which
   * three binds as black after a restore, leaving the shade sides dark and the rounded edges
   * dull. It is baked again (the old one went with the context), the shadows are redrawn at once
   * and the lamps' shaders compiled ahead again. A context that stays lost is reported, so the
   * page can say so instead of showing an empty stage, and so is its return.
   */
  let lostTimer = 0;
  function contextLost() {
    window.clearTimeout(lostTimer);
    lostTimer = window.setTimeout(() => options.onLost?.(true), CONTEXT_GRACE_MS);
  }
  function contextRestored() {
    window.clearTimeout(lostTimer);
    studio = bakeStudio();
    shadowDirty = true;
    window.clearTimeout(warmTimer);
    warmTimer = 0;
    options.onLost?.(false);
  }
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  renderer.domElement.addEventListener('webglcontextrestored', contextRestored);
  setClocks();
  raf = requestAnimationFrame(frame);
  const api: CityAPI = {
    select,
    enter(id) {
      // (The sky island has no Inspect: its copy would stand on the floor by its rock's tip.)
      const m: Model | undefined = models.get(id);
      if (!m) return;
      exitInspection();
      inspect = m.root.clone(true);
      inspectParts = pairMovingParts(m.root, inspect, movingParts);
      m.root.getWorldPosition(inspect.position);
      inspect.rotation.copy(m.root.rotation);
      m.root.updateMatrixWorld(true);
      // Bounds in world orientation, relative to the building's position: the fit reasons
      // in camera space, so a rotated building must not fool it.
      const shift = inspect.position.clone().negate();
      inspect.userData.exteriorBounds = new T.Box3()
        .setFromObject(m.root)
        .translate(shift);
      inspectionAutoFit = true;
      inspectYaw = targetYaw;
      autoFocus = false;
      overviewFit = false;
      scene.add(inspect);
      const studyBounds = new T.Box3().setFromObject(inspect);
      const studySize = studyBounds.getSize(new T.Vector3()),
        studyCentre = studyBounds.getCenter(new T.Vector3());
      shadowFocus(studyCentre, Math.max(7, studySize.length() * 0.85));
      // Wide enough to catch the whole shadow, so its edge never shows.
      studyGround.scale.setScalar(
        Math.max(studySize.x, studySize.z) / 2 + studySize.y + 1,
      );
      studyGround.position.set(studyCentre.x, studyBounds.min.y - 0.01, studyCentre.z);
      scene.add(studyGround);
      controls.maxZoom = STUDY_MAX_ZOOM;
      city.visible = false;
      zones.visible = false;
      frameStudy();
    },
    reset,
    overview,
    rotate() {
      // A quarter turn more, never more than a full turn still to go.
      if (targetYaw - yaw <= (Math.PI * 3) / 2 + 1e-6) targetYaw += Math.PI / 2;
      inspectionAutoFit = true;
      // A turn of the island's file from where the view stands (or on top of one), not mid-glide into it (followSky).
      skyTurn = skyFile() && (skyTurn || !tween || !autoFocus);
      if (overviewFit) fitOverview();
      // The sky island's own file frames it again for the new bearing, and turns there about the
      // island (focusSky, turnSky). Panned or zoomed about since, it does so at the visitor's zoom
      // (the camera's, or the one its glide heads for): the turn carries the view about the island
      // and the glide brings back whatever the pan moved, so the island comes back beside the file
      // wherever it had been panned to, even out of the frame, and the view ends in its pocket.
      // (Turned about the point of the island's height on the visitor's line of sight, the view's
      // ground point swung on a circle out of the island's pocket, and the pan limit slid the view
      // back all through the turn: 677-717 px at 1440 x 900, up to 16.7 px a frame.)
      else if (skyFile()) focusSky(autoFocus ? undefined : tween ? targetZoom : camera.zoom);
      lastInteraction = performance.now();
    },
    zoom(f) {
      inspectionAutoFit = false;
      autoFocus = false;
      overviewFit = false;
      // Mid-glide, zoom from where the glide is heading (its zoom and its subject), so it still
      // lands on its subject and quick presses add up; at rest, from the view as it is.
      if (!tween) {
        targetZoom = camera.zoom;
        target.copy(controls.target);
      }
      // The limit of where the camera is (the town or Inspect), not one still easing down.
      targetZoom = T.MathUtils.clamp(
        targetZoom * f,
        controls.minZoom,
        inspect ? STUDY_MAX_ZOOM : CITY_MAX_ZOOM,
      );
      // Zoom about the subject beside the panel: take the panel offset out of the view centre
      // and put it back as measured at the new zoom.
      target.sub(shiftApplied);
      offsetTarget();
      tween = true;
      lastInteraction = performance.now();
    },
    setNight(v) {
      targetNight = v ? 1 : 0;
    },
    setSky({ night: amount, elevation, azimuth, hours = 20 }) {
      targetNight = T.MathUtils.clamp(amount, 0, 1);
      targetSunOffset.copy(sunOffsetFor(elevation, azimuth));
      targetWarmth = warmSun(elevation);
      targetGolden = lowSun(elevation);
      // A jump of more than two hours puts the panes straight where the clock is; otherwise they
      // follow it pane by pane. It is a jump from the last sky (sleep, a debug shot; never the
      // clocks changing) or from the last frame: a hidden tab or a town scrolled out of view runs
      // no frames while the page still sends the sky every half minute, minute by minute.
      const gap = (from: number) => Math.abs(((hours - from + 36) % 24) - 12) > 2;
      const jump = gap(skyHours) || gap(paneHours);
      skyHours = hours;
      Object.assign(paneGoal, windowClock(hours));
      if (!skyKnown || jump) Object.assign(paneClock, paneGoal);
      // The first sky arrives before the first frame: no flash of noon at midnight.
      if (!skyKnown) {
        skyKnown = true;
        night = targetNight;
        sunWarmth = targetWarmth;
        golden = targetGolden;
        sunOffset.copy(targetSunOffset);
        placeSun();
      }
    },
    setRain(v) {
      targetRain = v ? 1 : 0;
    },
    setDrift(v) {
      drift = v;
    },
    setCityMode,
    setYaw(angle) {
      targetYaw = yaw + shortestAngle(yaw, angle);
      inspectionAutoFit = true;
      skyTurn = skyFile() && (skyTurn || !tween || !autoFocus);
      if (overviewFit) fitOverview();
      else if (autoFocus && skyFile()) focusSky();
    },
    setFrameShift(fraction, down = 0, edge = 1, foot?: number) {
      frameShift = T.MathUtils.clamp(fraction, -0.45, 0.45);
      frameDrop = T.MathUtils.clamp(down, -0.35, 0.35);
      panelEdge = T.MathUtils.clamp(edge, 0.3, 1);
      frameFoot = T.MathUtils.clamp(foot ?? 1 + 2 * Math.min(0, frameDrop), 0.1, 1);
      // A framing the camera chose itself (the overview, a pick) is fitted again.
      if (autoFocus) fitFocused();
    },
    setAccent(id) {
      accentId = id;
    },
    setHomeTags(on) {
      tagsOn = on;
      // Put away at once: the next frame may be a while off (the stage scrolled out of view).
      if (!on) placeHomeTags();
    },
    setPaused(v) {
      paused = v;
    },
    setPlan(v) {
      planMode = v;
      zones.visible = v && !inspect;
      emphasiseDistrict(zones, null);
      if (v) overview(true);
    },
    focusBuildings,
    focusDistrict(id) {
      emphasiseDistrict(zones, id);
      const d = districts.find((d) => d.id === id);
      if (!d) {
        overview(true);
        return;
      }
      exitInspection();
      autoFocus = false;
      overviewFit = false;
      // Framed like a pick: the district's ground plan plus a few storeys standing on it.
      const xs = d.outline.map(([x]) => x),
        zs = d.outline.map(([, z]) => z),
        across = Math.max(...xs) - Math.min(...xs) + Math.max(...zs) - Math.min(...zs);
      target.set(
        (Math.min(...xs) + Math.max(...xs)) / 2,
        0,
        (Math.min(...zs) + Math.max(...zs)) / 2,
      );
      targetZoom = T.MathUtils.clamp(
        Math.min(
          ((camera.right - camera.left) * 0.62) / (across * 0.707),
          ((camera.top - camera.bottom) * 0.65 * (1 - 2 * Math.abs(frameDrop))) /
            (across * 0.48 + 3.5),
        ),
        1,
        2.6,
      );
      offsetTarget();
      tween = true;
    },
    focusPark() {
      exitInspection();
      focusedIds = [];
      parkSelected = true;
      autoFocus = false;
      overviewFit = false;
      target.set(plan.park.x, 0, plan.park.z);
      targetZoom = 2.2;
      offsetTarget();
      tween = true;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      motionQuery.removeEventListener('change', followMotion);
      window.clearTimeout(warmTimer);
      window.clearTimeout(lostTimer);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', contextRestored);
      exitInspection();
      observer.disconnect();
      visibilityObserver.disconnect();
      renderer.domElement.removeEventListener('wheel', wheelIntent, true);
      renderer.domElement.removeEventListener('pointerdown', touchIntent, true);
      controls.removeEventListener('start', cancel);
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', down);
      renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointerleave', leave);
      renderer.domElement.removeEventListener('pointercancel', leave);
      window.removeEventListener('blur', leave);
      document.removeEventListener('visibilitychange', leave);
      const geos = new Set<T.BufferGeometry>(),
        mats = new Set<T.Material>();
      scene.traverse((o) => {
        if (o instanceof T.Mesh || o instanceof T.Line) {
          geos.add(o.geometry);
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
            mats.add(m),
          );
        }
      });
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      lighting.dispose();
      water.dispose();
      seaShadow.dispose();
      weather.dispose();
      gulls.dispose();
      ink.dispose();
      studio.dispose();
      studyGround.geometry.dispose();
      studyGround.material.dispose();
      model.disposeMaterials();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
  // `?debug` exposes the renderer, the API and a ticker, so frame costs can be inspected
  // and views rendered from the console, even in a background tab that gets no frames.
  if (new URLSearchParams(window.location.search).has('debug'))
    (window as unknown as { __city: unknown }).__city = {
      renderer,
      scene,
      camera,
      ink,
      model,
      api,
      frameCost: () => frameCost,
      state: () => ({ inViewport, paused, disposed, frameIndex, night, tween, quality, season, golden, rain, paneClock: { ...paneClock }, skyShown, tropicShown, tropicDrawn, skyCast, skyBox: skyBox === SKY_TIGHT ? 'island' : skyBox ? 'wide' : 'town', shadowRadius: sun.shadow.camera.right, shadowFade, pitch }),
      /** Advance n frames of ~16.7 ms, updating and rendering regardless of visibility. */
      tick(frames = 1) {
        let t = last || performance.now();
        for (let i = 0; i < frames; i++) step((t += 1000 / 60), true);
      },
      /** Set town time (and the plane's clock with it) to `seconds`, to look at a moment of the loops. */
      setTime(seconds: number) {
        time = planeTime = seconds;
      },
      /** Town time and the plane's clock. */
      time: () => ({ time, planeTime }),
    };
  return api;
}
