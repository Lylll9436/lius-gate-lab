import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildTown, type Model } from './town-build';
import * as plan from './town-plan';
import { createCityInk } from './city-ink';
import { createIslandWater } from './city-water';
import { createStreetLighting } from './city-lighting';
import {
  createRain,
  createGulls,
  sunOffsetFor,
  glasgowSky,
} from './city-atmosphere';
import { animateResident } from './city-people';
import {
  hoverPointer,
  pointerMove,
  clearPointer,
  hoverAllowed,
  labelPosition,
} from './city-hover';
import { fitStudy, roofDock } from './city-inspection';
import { buildings, type BuildingId } from './city-data';
import { districts, type DistrictId } from './city-districts';

export type HoverTarget = BuildingId | 'corner-park' | null;
export type CityOptions = {
  /** Called whenever the building or place under the mouse changes. */
  onHover?: (id: HoverTarget) => void;
};
export type CityAPI = {
  select: (id: BuildingId) => void;
  enter: (id: BuildingId) => void;
  reset: () => void;
  rotate: () => void;
  zoom: (factor: number) => void;
  setNight: (v: boolean) => void;
  setGrid: (v: boolean) => void;
  setPaused: (v: boolean) => void;
  setPlan: (v: boolean) => void;
  focusDistrict: (id: DistrictId) => void;
  focusPark: () => void;
  focusBuildings: (ids: BuildingId[]) => void;
  setInterior: (v: boolean) => void;
  /** Real sky: night amount 0..1 plus solar elevation/azimuth in radians. */
  setSky: (sky: { night: number; elevation: number; azimuth: number }) => void;
  setRain: (v: boolean) => void;
  /** Slow idle camera drift while nobody is touching the city. */
  setDrift: (v: boolean) => void;
  /** Absolute camera bearing; the camera takes the shortest turn. */
  setYaw: (angle: number) => void;
  /** Keep the subject left of centre (fraction of the viewport width) so a reading panel can sit beside it. */
  setFrameShift: (fraction: number) => void;
  /** Ring one building from the page (hovering a person card, for example). */
  setAccent: (id: BuildingId | null) => void;
  dispose: () => void;
};

const shortestAngle = (from: number, to: number) => {
  const d = (to - from) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
};

/** Build the town model only: used by the checks and by createCity. */
export function buildCityModel() {
  return buildTown();
}

export function createCity(
  container: HTMLDivElement,
  onSelect: (id: BuildingId) => void,
  onPark: () => void = () => {},
  options: CityOptions = {},
): CityAPI {
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
  // 1.5x pixels is where extra sharpness stops being visible and starts costing frames.
  const baseRatio = Math.min(
    window.devicePixelRatio || 1,
    tier === 'low' ? 1.25 : 1.5,
  );
  renderer.setPixelRatio(baseRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  // Shadow maps are refreshed on a cadence from the frame loop, not every frame.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0, 0);
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute(
    'aria-label',
    "LIU'S GATE: a small city standing for the research group. Every chapter is readable on the page.",
  );
  container.appendChild(renderer.domElement);
  const scene = new T.Scene(),
    camera = new T.OrthographicCamera(-24, 24, 24, -24, 0.1, 180),
    model = buildTown();
  const { city, models, walkers, lamps, tram, boat, clocks, animated, parkGroup, parkHit } = model;
  const ink = createCityInk(renderer, scene, camera, tier === 'low' ? 0 : 2);
  scene.add(city);
  const fog = new T.Fog('#d9e3dd', 72, 150);
  scene.fog = fog;
  const water = createIslandWater(model.waterLevel, -0.5);
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
  const sky = new T.HemisphereLight('#f4f1e4', '#6e8986', 1.6);
  scene.add(sky);
  const sunOffset = new T.Vector3(-16, 32, 20),
    targetSunOffset = sunOffset.clone();
  let sunWarmth = 0,
    targetWarmth = 0;
  const sun = new T.DirectionalLight('#fff0d5', 3.2);
  sun.position.copy(sunOffset);
  sun.castShadow = true;
  const shadowBase = tier === 'low' ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowBase, shadowBase);
  Object.assign(sun.shadow.camera, {
    left: -30,
    right: 30,
    top: 30,
    bottom: -30,
    near: 1,
    far: 90,
  });
  sun.shadow.normalBias = 0.012;
  sun.shadow.bias = -0.00012;
  scene.add(sun);
  scene.add(sun.target);
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
  function shadowFocus(center?: T.Vector3, radius = 30) {
    const base = shadowSizeFor();
    const resolution = center ? base * 2 : base;
    if (sun.shadow.mapSize.x !== resolution) {
      sun.shadow.mapSize.set(resolution, resolution);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    sun.target.position.copy(center || new T.Vector3());
    sun.position.copy(sun.target.position).add(sunOffset);
    Object.assign(sun.shadow.camera, {
      left: -radius,
      right: radius,
      top: radius,
      bottom: -radius,
    });
    sun.shadow.camera.updateProjectionMatrix();
  }
  // The island's shadow on the sea bed: only as large as the island and its harbour.
  const shadow = new T.Mesh(
    new T.PlaneGeometry(100, 100),
    new T.ShadowMaterial({ color: '#2f4a44', opacity: 0.14, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.62;
  shadow.receiveShadow = true;
  scene.add(shadow);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableRotate = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.minZoom = 0.7;
  controls.maxZoom = 4;
  controls.screenSpacePanning = true;
  controls.mouseButtons.LEFT = T.MOUSE.PAN;
  controls.mouseButtons.RIGHT = T.MOUSE.PAN;
  controls.touches.ONE = null;
  controls.touches.TWO = T.TOUCH.DOLLY_PAN;
  renderer.domElement.style.touchAction = 'pan-y';
  function wheelIntent(e: WheelEvent) {
    controls.enableZoom = e.ctrlKey || e.metaKey;
  }
  function touchIntent(e: PointerEvent) {
    if (e.pointerType === 'touch') controls.enableZoom = true;
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
    tween = true,
    planMode = false,
    gridEnabled = false,
    inViewport = true,
    inspect: T.Group | null = null,
    inspectId: BuildingId | null = null,
    interior = false,
    openAmount = 0,
    inspectionAutoFit = true,
    tramDistance = 0,
    rain = 0,
    targetRain = 0,
    drift = false,
    driftAngle = 0,
    frameShift = 0,
    lastInteraction = -1e9,
    lastHover: HoverTarget = null,
    accentId: BuildingId | null = null,
    skyKnown = false,
    frameCost = 0.016,
    lastGovern = 0,
    clockChecked = -1e9,
    hoverSignature = '',
    frameIndex = 0;
  // Colours used every frame, allocated once.
  const tint = {
    sunDay: new T.Color('#fff1d6'),
    sunWarm: new T.Color('#ffbe7a'),
    sunNight: new T.Color('#8daed0'),
    skyDay: new T.Color('#f4f1e4'),
    skyWarm: new T.Color('#f2d3c0'),
    skyRain: new T.Color('#cfd9dc'),
    fogDay: new T.Color('#d9e3dd'),
    fogNight: new T.Color('#101b20'),
    fogRain: new T.Color('#c3ced0'),
  };
  const shiftApplied = new T.Vector3();
  const weather = createRain(tier === 'low' ? 900 : 1700),
    gulls = createGulls();
  scene.add(weather.object, gulls.object);
  const sectionPlane = new T.Plane(new T.Vector3(0, -1, 0), 100);
  const inspectionMaterials: T.Material[] = [];
  const target = new T.Vector3(),
    offset = new T.Vector3();
  const tramLength = plan.polylineLength(plan.tramLoop, true);
  const grid = new T.GridHelper(60, 30, '#81937e', '#a9b6a0');
  (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach(
    (m) => (m.depthWrite = false),
  );
  grid.position.y = 0.09;
  grid.visible = false;
  scene.add(grid);
  const zones = new T.Group();
  zones.visible = false;
  scene.add(zones);
  for (const d of districts) {
    const m = new T.Mesh(
      new T.PlaneGeometry(...d.size),
      new T.MeshBasicMaterial({
        color: d.color,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(d.center[0], 0.095, d.center[1]);
    m.userData.district = d.id;
    zones.add(m);
  }
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
  let focusedIds: BuildingId[] = [],
    parkSelected = false,
    autoFocus = false;
  function fitFocused() {
    const roots = focusedIds
      .map((id) => models.get(id)?.root)
      .filter((r): r is T.Group => !!r);
    if (!roots.length) return;
    city.updateMatrixWorld(true);
    const bounds = new T.Box3();
    roots.forEach((r) => bounds.union(new T.Box3().setFromObject(r)));
    target.copy(bounds.getCenter(new T.Vector3()));
    shiftApplied.set(0, 0, 0);
    const size = bounds.getSize(new T.Vector3());
    const spanX = (size.x + size.z) * 0.707,
      spanY = (size.x + size.z) * 0.48 + size.y * 0.75;
    targetZoom = T.MathUtils.clamp(
      Math.min(
        ((camera.right - camera.left) * 0.62) / spanX,
        ((camera.top - camera.bottom) * 0.65) / spanY,
      ),
      1.3,
      3.4,
    );
    tween = true;
  }
  function focusBuildings(ids: BuildingId[]) {
    exitInspection();
    focusedIds = [...new Set(ids)];
    parkSelected = false;
    autoFocus = true;
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
    const bearing = yaw + driftAngle;
    offset.set(Math.sin(bearing) * 38, 35, Math.cos(bearing) * 38);
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);
    camera.updateProjectionMatrix();
  }
  align();
  controls.update();
  function exitInspection() {
    shadowFocus();
    clearHover();
    if (inspect) {
      scene.remove(inspect);
      inspect = null;
    }
    inspectId = null;
    inspectionMaterials.forEach((m) => m.dispose());
    inspectionMaterials.length = 0;
    interior = false;
    openAmount = 0;
    city.visible = true;
    grid.visible = gridEnabled;
    zones.visible = planMode;
    controls.maxZoom = 4;
  }
  function select(id: BuildingId) {
    exitInspection();
    const m = models.get(id)!;
    target.copy(m.center).add(new T.Vector3(0, 1, 0));
    shiftApplied.set(0, 0, 0);
    focusedIds = [id];
    parkSelected = false;
    autoFocus = true;
    fitFocused();
    tween = true;
  }
  function reset() {
    exitInspection();
    focusedIds = [];
    parkSelected = false;
    autoFocus = false;
    target.set(0, 0, 0);
    shiftApplied.set(0, 0, 0);
    targetZoom = 1;
    targetYaw = yaw + shortestAngle(yaw, Math.PI / 4);
    tween = true;
  }
  function cancel() {
    clearHover();
    autoFocus = false;
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
    multiPointer = false;
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
    }
  }
  function up(e: PointerEvent) {
    const tracked = activePointers.delete(e.pointerId);
    const blocked = multiPointer || activePointers.size > 0;
    if (activePointers.size === 0) {
      hover.dragging = false;
      multiPointer = false;
    }
    if (
      !tracked ||
      blocked ||
      e.button !== 0 ||
      Math.hypot(e.clientX - downX, e.clientY - downY) > 5
    )
      return;
    const id = pickAt(e.clientX, e.clientY);
    if (id === 'corner-park') onPark();
    else if (id) onSelect(id);
  }
  function move(e: PointerEvent) {
    pointerMove(hover, e);
    if (e.buttons) clearHover();
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
  function frame(now: number) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    if (document.hidden || !inViewport) return;
    const blend = reduced ? 1 : 1 - Math.exp(-dt * 5.5);
    if (!paused) time += dt;
    if (Math.abs(targetYaw - yaw) > 0.0001) {
      yaw += shortestAngle(yaw, targetYaw) * blend;
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
    controls.update();
    night = T.MathUtils.lerp(night, targetNight, reduced ? 1 : blend * 0.45);
    model.materialLibrary.setNight(night);
    lighting.update(night, !!inspect);
    for (const m of inspectionMaterials)
      if (
        m instanceof T.MeshStandardMaterial &&
        m.userData.surfaceKind === 'glass'
      )
        m.emissiveIntensity = night * 0.72;
    sky.intensity = T.MathUtils.lerp(1.6, 0.42, night);
    sun.intensity = T.MathUtils.lerp(3.2, 0.45, night);
    lamps.forEach(
      (l) =>
        ((l.material as T.MeshStandardMaterial).emissiveIntensity =
          night * 2.7),
    );
    if (inspect) {
      openAmount = reduced
        ? interior
          ? 1
          : 0
        : T.MathUtils.lerp(openAmount, interior ? 1 : 0, blend * 0.75);
      const site = plan.sites[inspectId!];
      const roof = inspect.children[2];
      if (inspectId === 'lius-gate' && inspectionAutoFit) {
        const fit = fitStudy(
          inspect.userData.exteriorBounds,
          camera,
          width / height,
        );
        target.copy(inspect.position).add(fit.focus);
        targetZoom = fit.zoom;
        tween = true;
      }
      if (inspectId !== 'lius-gate') {
        const dock = roofDock(
          inspect.userData.bodyBounds,
          inspect.userData.roofBounds,
          camera,
          width / height,
        );
        // The dock offset is a world-space vector; the roof moves in its parent's frame.
        roof.position
          .copy(dock.offset)
          .applyQuaternion(inspect.quaternion.clone().invert())
          .multiplyScalar(openAmount);
        roof.scale.setScalar(1 + (dock.scale - 1) * openAmount);
        roof.visible = dock.visible || openAmount < 0.015;
        if (inspectionAutoFit) {
          const outer = fitStudy(
            inspect.userData.exteriorBounds,
            camera,
            width / height,
          );
          target
            .copy(inspect.position)
            .add(outer.focus.lerp(dock.focus, openAmount));
          targetZoom = T.MathUtils.lerp(outer.zoom, dock.zoom, openAmount);
          tween = true;
        }
      }
      sectionPlane.constant = T.MathUtils.lerp(site.height + 3, 1.25, openAmount);
    }
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
        plan.levels.pavement + plan.terrainHeight(pose.x, pose.z) - walker.root.userData.sole + 0.06,
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
  }
  function animateExtras(dt: number, now: number, blend: number) {
    if (hover.id !== lastHover) {
      lastHover = hover.id as HoverTarget;
      options.onHover?.(lastHover);
    }
    const ringed = new Set<T.Object3D>(
      focusedIds.map((id) => models.get(id)!.root),
    );
    const extra = hover.id && hover.id !== 'corner-park' ? hover.id : accentId;
    if (extra && !inspect) {
      const root = models.get(extra as BuildingId)?.root;
      if (root) ringed.add(root);
    }
    ink.setSelection(
      inspect ? [] : parkSelected ? [parkGroup] : [...ringed],
    );
    // Reading-panel framing: keep the subject beside the panel, not behind it.
    if (!inspect) {
      const wanted = new T.Vector3(
        Math.cos(targetYaw),
        0,
        -Math.sin(targetYaw),
      ).multiplyScalar(
        (frameShift * (camera.right - camera.left)) / Math.max(targetZoom, 0.1),
      );
      if (wanted.distanceToSquared(shiftApplied) > 1e-6) {
        target.sub(shiftApplied).add(wanted);
        shiftApplied.copy(wanted);
        tween = true;
      }
    }
    // Idle drift: a slow, breathing turn that stops the moment the visitor acts.
    const idle =
      drift && !inspect && !hover.dragging && !paused && now - lastInteraction > 4000;
    const driftTarget = idle ? Math.sin(time * 0.07) * 0.16 : 0;
    const nextDrift = reduced
      ? driftTarget
      : driftAngle + (driftTarget - driftAngle) * Math.min(1, blend * 0.35);
    if (Math.abs(nextDrift - driftAngle) > 1e-6) {
      driftAngle = nextDrift;
      align();
    }
    // The sun follows Glasgow's real sky; low sun turns warm, rain turns everything grey.
    if (sunOffset.distanceToSquared(targetSunOffset) > 1e-4) {
      sunOffset.lerp(targetSunOffset, reduced ? 1 : Math.min(1, blend * 0.4));
      sun.position.copy(sun.target.position).add(sunOffset);
    }
    sunWarmth = T.MathUtils.lerp(sunWarmth, targetWarmth, reduced ? 1 : blend);
    rain = T.MathUtils.lerp(rain, targetRain, reduced ? 1 : blend * 0.5);
    const overcast = 1 - rain * 0.42;
    sun.color
      .copy(tint.sunDay)
      .lerp(tint.sunWarm, sunWarmth * (1 - night))
      .lerp(tint.sunNight, night);
    sun.intensity *= overcast;
    sky.intensity *= 1 - rain * 0.18;
    sky.color
      .copy(tint.skyDay)
      .lerp(tint.skyWarm, sunWarmth * 0.6 * (1 - night))
      .lerp(tint.skyRain, rain * 0.5);
    fog.color
      .copy(tint.fogDay)
      .lerp(tint.fogNight, night)
      .lerp(tint.fogRain, rain * 0.45 * (1 - night));
    weather.update(dt, rain, paused);
    gulls.object.visible = !inspect && night < 0.85;
    gulls.update(time);
    water.update(time, night, camera, { rain, sun: sunOffset });
    // Shadows refresh every other frame: moving things still get moving shadows,
    // and the costliest pass runs half as often.
    frameIndex++;
    renderer.shadowMap.needsUpdate = paused ? frameIndex % 30 === 0 : frameIndex % 2 === 0;
    // Governor: sustained slow frames step down the quality ladder; sustained cheap
    // frames step back up, slowly, so the picture settles where the device can hold it.
    frameCost = T.MathUtils.lerp(frameCost, dt, 0.04);
    if (now - lastGovern > 2500) {
      if (frameCost > 0.034 && quality < 4) {
        quality++;
        qualityChanged = now;
        lastGovern = now;
        frameCost = 0.016;
        applyQuality();
      } else if (frameCost < 0.011 && quality > 0 && now - qualityChanged > 12000) {
        quality--;
        qualityChanged = now;
        lastGovern = now;
        frameCost = 0.016;
        applyQuality();
      }
    }
  }
  setClocks();
  raf = requestAnimationFrame(frame);
  // `?debug` exposes the renderer so frame costs can be inspected from the console.
  if (new URLSearchParams(window.location.search).has('debug'))
    (window as unknown as { __city: unknown }).__city = {
      renderer,
      scene,
      camera,
      ink,
      model,
      frameCost: () => frameCost,
      state: () => ({ inViewport, paused, disposed, frameIndex, night, tween, quality }),
    };
  return {
    select,
    enter(id) {
      exitInspection();
      const m: Model = models.get(id)!;
      inspect = m.root.clone(true);
      m.root.getWorldPosition(inspect.position);
      inspect.rotation.copy(m.root.rotation);
      m.root.updateMatrixWorld(true);
      // Bounds in world orientation, relative to the building's position: the fit and the
      // roof docking reason in camera space, so a rotated building must not fool them.
      const shift = inspect.position.clone().negate();
      inspect.userData.bodyBounds = new T.Box3()
        .setFromObject(m.interior)
        .translate(shift);
      inspect.userData.roofBounds = new T.Box3()
        .setFromObject(m.roof)
        .translate(shift);
      inspect.userData.exteriorBounds = new T.Box3()
        .setFromObject(m.root)
        .translate(shift);
      inspectionAutoFit = true;
      if (id !== 'lius-gate')
        inspect.children[1].traverse((o) => {
          if (o instanceof T.Mesh) {
            const copy = (original: T.Material) => {
              const mat = original.clone();
              mat.clippingPlanes = [sectionPlane];
              mat.clipShadows = true;
              inspectionMaterials.push(mat);
              return mat;
            };
            o.material = Array.isArray(o.material)
              ? o.material.map(copy)
              : copy(o.material);
          }
        });
      sectionPlane.constant = 100;
      scene.add(inspect);
      const studyBounds = new T.Box3().setFromObject(inspect);
      const studySize = studyBounds.getSize(new T.Vector3());
      shadowFocus(
        studyBounds.getCenter(new T.Vector3()),
        Math.max(7, studySize.length() * 0.85),
      );
      inspectId = id;
      controls.maxZoom = 8;
      city.visible = false;
      zones.visible = false;
      grid.visible = false;
      const fit = fitStudy(
        inspect.userData.exteriorBounds,
        camera,
        width / height,
      );
      target.copy(inspect.position).add(fit.focus);
      targetZoom = fit.zoom;
      tween = true;
    },
    setInterior(v) {
      interior = v;
      inspectionAutoFit = true;
    },
    reset,
    rotate() {
      targetYaw += Math.PI / 2;
      inspectionAutoFit = true;
      lastInteraction = performance.now();
    },
    zoom(f) {
      inspectionAutoFit = false;
      targetZoom = T.MathUtils.clamp(camera.zoom * f, 0.7, inspect ? 8 : 4);
      target.copy(controls.target);
      shiftApplied.set(0, 0, 0);
      tween = true;
      lastInteraction = performance.now();
    },
    setNight(v) {
      targetNight = v ? 1 : 0;
    },
    setSky({ night: amount, elevation, azimuth }) {
      targetNight = T.MathUtils.clamp(amount, 0, 1);
      targetSunOffset.copy(sunOffsetFor(elevation, azimuth));
      targetWarmth = T.MathUtils.clamp((0.5 - elevation) / 0.42, 0, 1);
      // The first sky arrives before the first frame: no flash of noon at midnight.
      if (!skyKnown) {
        skyKnown = true;
        night = targetNight;
        sunWarmth = targetWarmth;
        sunOffset.copy(targetSunOffset);
        sun.position.copy(sun.target.position).add(sunOffset);
      }
    },
    setRain(v) {
      targetRain = v ? 1 : 0;
    },
    setDrift(v) {
      drift = v;
    },
    setYaw(angle) {
      targetYaw = yaw + shortestAngle(yaw, angle);
      inspectionAutoFit = true;
    },
    setFrameShift(fraction) {
      frameShift = T.MathUtils.clamp(fraction, -0.45, 0.45);
    },
    setAccent(id) {
      accentId = id;
    },
    setGrid(v) {
      gridEnabled = v;
      grid.visible = v && !inspect;
    },
    setPaused(v) {
      paused = v;
    },
    setPlan(v) {
      planMode = v;
      zones.visible = v;
      if (v) reset();
    },
    focusBuildings,
    focusDistrict(id) {
      exitInspection();
      const d = districts.find((d) => d.id === id)!;
      target.set(d.center[0], 0, d.center[1]);
      shiftApplied.set(0, 0, 0);
      targetZoom = 1.3;
      tween = true;
      zones.children.forEach(
        (o) =>
          ((
            o as T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>
          ).material.opacity = o.userData.district === id ? 0.35 : 0.09),
      );
    },
    focusPark() {
      exitInspection();
      focusedIds = [];
      parkSelected = true;
      autoFocus = false;
      target.set(plan.park.x, 0, plan.park.z);
      shiftApplied.set(0, 0, 0);
      targetZoom = 2.2;
      tween = true;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
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
      model.disposeMaterials();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
