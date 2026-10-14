import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  buildTown,
  buildTownInPhases,
  type Model,
  type Town,
} from './town-build';
import * as plan from './town-plan';
import { createCityInk } from './city-ink';
import { createIslandWater, MOON_POSITION } from './city-water';
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
   * frame whose top part is hidden.
   */
  setFrameShift: (fraction: number, down?: number) => void;
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
/** How close the camera may zoom: on the town, and on Inspect's lone building. */
const CITY_MAX_ZOOM = 4,
  STUDY_MAX_ZOOM = 8;
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
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  const { city, models, walkers, lamps, tram, boat, clocks, animated, parkGroup, parkHit } = model;
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
  // Only the lanterns around the plaza carry real spotlights (after dusk); the rest glow.
  const litLanterns = lamps
    .filter((l) => l.getWorldPosition(new T.Vector3()).length() < 9.5)
    .slice(0, 6);
  const lighting = createStreetLighting(scene, litLanterns, {
    shadows: tier === 'low' ? 0 : 1,
    shadowSize: 512,
  });
  // Pointer picking uses one invisible box per building, never the merged geometry.
  city.updateMatrixWorld(true);
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
    city.add(hit);
    m.hit = hit;
  }
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
  sun.shadow.mapSize.set(shadowBase, shadowBase);
  Object.assign(sun.shadow.camera, {
    left: -34,
    right: 34,
    top: 34,
    bottom: -34,
    near: 1,
    far: 90,
  });
  sun.shadow.normalBias = 0.02;
  sun.shadow.bias = -0.0001;
  sun.shadow.intensity = 1.0;
  scene.add(sun);
  scene.add(sun.target);
  // The key light turns with the camera yaw, so the visible faces keep the same
  // top-bright / left-lit / right-shade read from every side.
  const UP = new T.Vector3(0, 1, 0), keyOffset = new T.Vector3(), lastKey = new T.Vector3(), moonAt = new T.Vector3();
  let shadowDirty = true;
  function placeSun() {
    keyOffset.copy(sunOffset).applyAxisAngle(UP, yaw - Math.PI / 4); // yaw only: idle drift must not swing shadows
    // The moon's glint on the sea turns with it, so no rotate stop faces the moon across the water.
    moonAt.copy(MOON_POSITION).applyAxisAngle(UP, yaw - Math.PI / 4);
    sun.position.copy(sun.target.position).add(keyOffset);
    // The studio fill turns too, or the shade sides darken after rotate().
    scene.environmentRotation.y = yaw - Math.PI / 4;
    if (lastKey.distanceToSquared(keyOffset) > 1e-6) { lastKey.copy(keyOffset); shadowDirty = true; }
  }
  // Quality ladder, climbed down by the frame-time governor and back up when frames are cheap:
  // 0 full, 1 fewer pixels, 2 smaller shadows and no lantern shadow, 3 and 4 fewer pixels still.
  let quality = 0,
    qualityChanged = 0;
  const shadowSizeFor = () =>
    quality >= 2 ? Math.max(512, shadowBase / 2) : shadowBase;
  function applyQuality() {
    const ratio = Math.max(0.75, baseRatio - 0.25 * [0, 1, 1, 2, 3][quality]);
    if (Math.abs(renderer.getPixelRatio() - ratio) > 1e-3) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      ink.resize(width, height);
    }
    for (const [i, light] of lighting.lights.entries())
      light.castShadow = i === 0 && tier !== 'low' && quality < 2;
    shadowFocus(sun.target.position.length() ? sun.target.position.clone() : undefined, sun.shadow.camera.right);
  }
  function shadowFocus(center?: T.Vector3, radius = 34) {
    const base = shadowSizeFor();
    const resolution = center ? base * 2 : base,
      focus = center || new T.Vector3();
    // A new map (or a frustum moved elsewhere) is drawn before the next frame uses it, even
    // paused: until then three samples an empty map and puts everything in full shadow.
    if (
      sun.shadow.mapSize.x !== resolution ||
      sun.target.position.distanceToSquared(focus) > 1e-9 ||
      sun.shadow.camera.right !== radius
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
    placeSun();
    Object.assign(sun.shadow.camera, {
      left: -radius,
      right: radius,
      top: radius,
      bottom: -radius,
    });
    sun.shadow.camera.updateProjectionMatrix();
  }
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableRotate = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  // Far enough out for the whole island beside the file on a 1024-1280 px wide screen.
  controls.minZoom = 0.5;
  controls.maxZoom = CITY_MAX_ZOOM;
  // Panning stops before the view leaves the island for open sea: the subject point (the
  // view centre less the panel offset) stays within this radius of the island's centre.
  const PAN_RADIUS = 30;
  controls.maxTargetRadius = PAN_RADIUS;
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
    targetZoom = 1,
    shownZoom = 1,
    tween = true,
    planMode = false,
    inViewport = true,
    inspect: T.Group | null = null,
    inspectionAutoFit = true,
    inspectYaw = yaw,
    overviewFit = false,
    tramDistance = 0,
    rain = 0,
    targetRain = 0,
    drift = false,
    driftAngle = 0,
    frameShift = 0,
    frameDrop = 0,
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
    paneHours = 20;
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
  const weather = createRain(tier === 'low' ? 900 : 1700),
    gulls = createGulls();
  scene.add(weather.object, gulls.object);
  const target = new T.Vector3(),
    offset = new T.Vector3();
  const tramLength = plan.polylineLength(plan.tramLoop, true);
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
  // trees along the shore and the lighthouse on its rock.
  const [rockX, rockZ] = plan.lighthouseRock;
  const islandMarks = [
    ...plan.islandOutline.flatMap(([x, z]) => {
      const out = 1 + 3.3 / Math.hypot(x, z);
      return [new T.Vector3(x * out, 0, z * out), new T.Vector3(x, 3, z)];
    }),
    new T.Vector3(rockX, 0, rockZ),
    new T.Vector3(rockX, 5.5, rockZ),
  ];
  /** The camera's offset from its target at a bearing: the same elevation from every side. */
  function viewOffset(bearing: number, out: T.Vector3) {
    return out.set(Math.sin(bearing) * 38, 35, Math.cos(bearing) * 38);
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
    screenUp.crossVectors(viewOffset(yaw, screenUp).normalize(), screenRight);
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
   * bottom controls (about 76 px each). Never closer than the plain overview's zoom of 1.
   */
  function fitOverview() {
    const back = viewOffset(targetYaw, new T.Vector3()).normalize(),
      right = new T.Vector3(Math.cos(targetYaw), 0, -Math.sin(targetYaw)),
      up = new T.Vector3().crossVectors(back, right);
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const point of islandMarks) {
      const sx = point.dot(right),
        sy = point.dot(up);
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
    const freeWidth = Math.max(1, Math.max(0.3, 1 - 2 * Math.abs(frameShift)) * width - 48),
      shownHeight = Math.max(0.3, 1 - 2 * Math.abs(frameDrop)) * height,
      freeHeight = Math.max(shownHeight * 0.6, shownHeight - 152);
    targetZoom = T.MathUtils.clamp(
      Math.min(
        ((freeWidth / width) * (camera.right - camera.left)) / (maxX - minX),
        ((freeHeight / height) * (camera.top - camera.bottom)) / (maxY - minY),
      ),
      controls.minZoom,
      1,
    );
    // Centre the outline, not the plaza, and keep the target on the ground.
    target
      .copy(right)
      .multiplyScalar((minX + maxX) / 2)
      .addScaledVector(up, (minY + maxY) / 2);
    target.addScaledVector(back, -target.y / back.y);
    offsetTarget();
    tween = true;
  }
  function fitFocused() {
    if (overviewFit) {
      fitOverview();
      return;
    }
    const roots = focusedIds
      .map((id) => models.get(id)?.root)
      .filter((r): r is T.Group => !!r);
    if (!roots.length) return;
    city.updateMatrixWorld(true);
    const bounds = new T.Box3();
    roots.forEach((r) => bounds.union(new T.Box3().setFromObject(r)));
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
    shadowFocus();
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
    const m = models.get(id)!;
    target.copy(m.center).add(new T.Vector3(0, 1, 0));
    offsetTarget();
    focusedIds = [id];
    parkSelected = false;
    autoFocus = true;
    overviewFit = false;
    fitFocused();
    tween = true;
  }
  function reset() {
    exitInspection();
    focusedIds = [];
    parkSelected = false;
    autoFocus = false;
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
    // Each model carries an invisible hit box; the merged geometry is never raycast.
    const hit = ray.intersectObjects(
      [...Array.from(models.values(), (m) => m.hit ?? m.root), parkHit],
      true,
    )[0];
    if (!hit) return null;
    let object: T.Object3D | null = hit.object;
    while (object && !object.userData.buildingId && !object.userData.placeId)
      object = object.parent;
    return (object?.userData.buildingId ?? object?.userData.placeId) as
      | BuildingId
      | 'corner-park'
      | null;
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
        const p = labelPosition(
          { x: hover.x - rect.left, y: hover.y - rect.top },
          { width: element.offsetWidth, height: element.offsetHeight },
          { width, height },
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
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    // Nothing is drawn before the first sky (the page sends it once the town is ready, a task
    // or two after the first frame may come): no daylit town flashing up at night.
    if (!force && (document.hidden || !inViewport || !skyKnown)) return;
    if (dt > 0 && dt < 0.05) intervals[intervalCount++ % intervals.length] = dt;
    const blend = reduced ? 1 : 1 - Math.exp(-dt * 5.5);
    if (!paused) time += dt;
    followPanel();
    if (Math.abs(targetYaw - yaw) > 0.0001) {
      // The bearing eases in more slowly than the glide and never whips round; a reduced-motion
      // turn is a cut. The bearings asked for already take the shortest way round; quick Rotate
      // presses queue their quarter turns, which keep turning the way the button turns.
      const left = targetYaw - yaw;
      if (reduced || Math.abs(left) < 0.0005) yaw = targetYaw = yaw + left;
      else
        yaw +=
          Math.sign(left) *
          Math.min(Math.abs(left) * (1 - Math.exp(-dt * YAW_RATE)), YAW_SPEED * dt);
      // The panel offset turns with the camera, so the subject keeps its place beside the
      // panel all through the turn instead of swinging behind it.
      const shift = panelOffset(new T.Vector3());
      controls.target.add(shift).sub(shiftApplied);
      target.add(shift).sub(shiftApplied);
      shiftApplied.copy(shift);
      align();
    }
    // A wheel or pinch zoom (OrbitControls applies it in its own event handler) is the zoom
    // to keep, so a later re-fit cannot spring back. Zoomed at the view centre, the subject
    // beside the panel stays put; zoomed at the pointer (City mode), the point under the
    // pointer stays put and the panel offset is only measured again.
    if (!tween && camera.zoom !== shownZoom) {
      targetZoom = camera.zoom;
      const next = panelOffset(new T.Vector3());
      if (!controls.zoomToCursor) controls.target.add(next).sub(shiftApplied);
      shiftApplied.copy(next);
      align();
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
    // The limit is the visitor's; the camera's own moves (a panel offset can reach past it
    // on narrow wide screens) are never clamped.
    controls.cursor.copy(shiftApplied);
    controls.maxTargetRadius = tween ? Infinity : PAN_RADIUS;
    // Out of Inspect, the zoom limit follows the camera back down to the town's.
    if (!inspect)
      controls.maxZoom = Math.max(CITY_MAX_ZOOM, Math.min(controls.maxZoom, camera.zoom));
    controls.update();
    // Whatever the visitor panned to is where the next panel offset starts from.
    if (!tween) target.copy(controls.target);
    shownZoom = camera.zoom;
    night = T.MathUtils.lerp(night, targetNight, reduced ? 1 : blend * 0.45);
    model.materialLibrary.setNight(night);
    followWindows(paneClock, paneGoal, night, dt, reduced);
    paneHours = skyHours;
    model.materialLibrary.setWindows(paneClock.out, paneClock.wake);
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
    // People on the pavements, the tram on the ring, the boat in the harbour.
    for (const walker of walkers) {
      const before = plan.samplePolyline(walker.loop, walker.distance, true);
      if (!paused) walker.distance += walker.speed * dt;
      const pose = plan.samplePolyline(walker.loop, walker.distance, true);
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
    if (!paused) tramDistance = (tramDistance + dt * 2.1) % tramLength;
    const vehicle = plan.samplePolyline(plan.tramLoop, tramDistance, true);
    tram.position.set(vehicle.x, plan.levels.road, vehicle.z);
    tram.rotation.y = vehicle.heading;
    const pose = plan.boatPose(time);
    boat.position.set(pose.x, model.waterLevel + pose.y, pose.z);
    boat.rotation.set(0, pose.heading, pose.roll);
    for (const entry of animated) entry.update(time, night);
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
        : focusedIds.map((id) => models.get(id)!.root),
    );
    // What the pointer is on, or else what the page points at (a person card, a Directory
    // row). The park is ringed only from the page: on the model it keeps just its label.
    const extra = hover.id && hover.id !== 'corner-park' ? hover.id : accentId;
    const extraRoot =
      extra === 'corner-park'
        ? parkGroup
        : extra
          ? models.get(extra as BuildingId)?.root
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
      ? Math.sin(time * 0.07) * 0.16
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
    sun.shadow.intensity = T.MathUtils.lerp(1, 0.35, rain);
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
      exitInspection();
      const m: Model = models.get(id)!;
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
      if (overviewFit) fitOverview();
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
      if (overviewFit) fitOverview();
    },
    setFrameShift(fraction, down = 0) {
      frameShift = T.MathUtils.clamp(fraction, -0.45, 0.45);
      frameDrop = T.MathUtils.clamp(down, -0.35, 0.35);
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
      state: () => ({ inViewport, paused, disposed, frameIndex, night, tween, quality, season, golden, rain, paneClock: { ...paneClock } }),
      /** Advance n frames of ~16.7 ms, updating and rendering regardless of visibility. */
      tick(frames = 1) {
        let t = last || performance.now();
        for (let i = 0; i < frames; i++) step((t += 1000 / 60), true);
      },
    };
  return api;
}
