import * as T from 'three';
import { createCityMaterials } from './city-materials';
import { animateResident, createDog, createResident, pedalRider, seatRider } from './city-people';
import { buildings, type BuildingId } from './city-data';
import * as plan from './town-plan';
import type { XZ } from './town-plan';
import type { Season } from './glasgow-sun';
import {
  palette,
  hash,
  bandstandAt,
  WATER,
  type TownContext,
} from './town-shared';
import { createKit } from './town-kit';
import { createBatch } from './town-batch';
import { createNature } from './town-nature';
import { createProps } from './town-props';
import { buildGroundMasks, createGround } from './town-ground';
import { createStreets } from './town-streets';
import { createHarbour } from './town-harbour';
import { createHomes } from './town-homes';
import { createBuildings } from './town-buildings';
import { createMovers } from './town-movers';
import { createCountry } from './town-country';
export { palette } from './town-shared';
export { treeLook, heatherLook } from './town-nature';
export { MASK_EXTENT, MASK_SIZE, buildGroundMasks } from './town-ground';
export { BALLOON, followDrift } from './town-movers';

/**
 * The town itself: terrain, streets, seven buildings, trees,
 * street furniture, the harbour, the lighthouse and the things that move.
 * Everything is procedural and merged into a few draw calls per surface family.
 *
 * This file assembles the town; each part lives in its own module:
 * - town-plan.ts: the layout every part reads (sites, streets, planting, the herd, the flock,
 *   the traffic signals, their timing and the rules of the road the tram and the cyclist keep,
 *   and the street life's paths: the cyclist's lane, the dog walk, the ducks and the bike rack);
 * - town-shared.ts: the palette, hash and noise, the plaza, bandstand, crane and paddock layout,
 *   the water level, and TownContext (the material library, season, land group, lamps, clocks
 *   and animated parts of one build);
 * - town-kit.ts: the primitives (boxes, cylinders, roofs, windows, doors, quoins, plinths,
 *   chimneys), lamp glass and groundY;
 * - town-ground.ts: the island, the shore and its foam, and the baked ground masks;
 * - town-streets.ts: the ring road, pavements and avenues, and the plaza with its pool;
 * - town-nature.ts: trees, hedges, beds, topiary, heather and thistles, and their seasons;
 * - town-props.ts: benches, cycle hoops, lamps, the traffic signals, the phone box, bins, the
 *   bandstand, the notice board, the crane, the picnic and the Wellington statue;
 * - town-harbour.ts: the pier, the harbour with its moorings and beach details, and the lighthouse;
 * - town-homes.ts: the three members' homes in their terrace row, and the cottages;
 * - town-buildings.ts: the gate, the Town Hall, the studio and the archive;
 * - town-movers.ts: the balloon, the tram, the boat and the bicycle;
 * - town-country.ts: the Highland herd and its paddock, the sheep, the standing stones and the
 *   ducks on the gate's pool;
 * - town-batch.ts: batch(), which merges each group by surface family and bakes contact and
 *   eave shade into it.
 * Each module's create* factory takes the build's TownContext (and the kit, planting or props
 * it uses) and returns its builders. All factories run before the terrain and make no material
 * or object themselves except the props' one shared lantern glass, so everything keeps its
 * creation order (three breaks ties between equal-depth draws by id). New parts go in the
 * module of their kind, with one call in the Assembly below. Page code imports only
 * town-plan from these; the rest loads with the lazy city-scene chunk.
 */

export type Model = {
  root: T.Group;
  shell: T.Group;
  fade: T.MeshStandardMaterial[];
  center: T.Vector3;
  /** Invisible box for pointer picking, set by the scene: the broad phase (see pickTarget in city-scene). */
  hit?: T.Mesh;
};
export type Walker = { root: T.Group; loop: XZ[]; distance: number; speed: number };

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
  const { buildGate, buildHall, buildStudio, buildArchive } = createBuildings(ctx, kit, nature, props);
  const { hotAirBalloon, buildTram, buildBoat, bicycle } = createMovers(ctx, kit);
  const { highlandPaddock, blackfaceSheep, standingStoneRing, pondDucks } = createCountry(ctx, kit);
  const { batch, windows } = createBatch(ctx);
  const { box } = kit, { tree, flowerBed, moorland } = nature, { bench, cycleHoop, lamp, trafficSignals, phoneBox, bin, pavilion, memoryBoard, crane, picnic, wellington } = props;
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
  // Traffic signals at the three ring junctions; their lenses follow town time (plan.signalState).
  trafficSignals(land);
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
  // A dog walker and a Border collie on the open lawn east of the corner park: a generic
  // townsperson in muted clothes and a flat cap. Every 15 s they stop for 4 while the dog sniffs
  // and wags faster; the walker's hand on the dog's side is held forward, as if on a lead (a lead
  // itself would be too thin to draw). Both pose from town time, so reduced motion holds them.
  const dogWalk = new T.Group(),
    dogWalker = createResident(7, material, { coat: '#7a6a52', legs: '#3a4654', hair: '#8c8577', scarf: '#c4a878' }),
    dog = createDog(material);
  dogWalk.name = 'dog-walk';
  dogWalk.userData.prebatched = true; // batched with the walkers below, not by the animated loop
  dogWalk.add(dogWalker, dog);
  city.add(dogWalk);
  {
    const head = dog.getObjectByName('dog-head')!,
      tail = dog.getObjectByName('dog-tail')!,
      leadArm = dogWalker.getObjectByName('arm-left')!; // the -x arm: the dog's side
    let last = 0,
      lastS = 0,
      wag = 0;
    const update = (time: number) => {
      // Clamped steps absorb jumps in time; paused, time stands still and so does everything.
      const dt = Math.min(0.1, Math.max(0, time - last)),
        pose = plan.dogWalkPose(time),
        { walker: w, dog: d } = pose;
      last = time;
      animateResident(dogWalker, Math.abs(pose.s - lastS), dt, dt === 0);
      lastS = pose.s;
      dogWalker.position.set(w.x, plan.terrainHeight(w.x, w.z) - dogWalker.userData.sole, w.z);
      dogWalker.rotation.y = w.heading;
      leadArm.rotation.x = -0.45;
      dog.position.set(d.x, plan.terrainHeight(d.x, d.z) + 0.012 * Math.abs(Math.sin(pose.s * 26)) * (1 - pose.sniff), d.z);
      dog.rotation.y = d.heading;
      head.rotation.x = 0.55 * pose.sniff; // nose down while they stand
      // The wag's phase adds up, so its speed (6 rad/s walking, 10 standing) changes without a jump.
      wag += dt * (6 + 4 * pose.sniff);
      tail.rotation.y = 0.5 * Math.sin(wag);
    };
    update(0);
    animated.push({ object: dogWalk, update });
  }
  // A cyclist on the ring, keeping left on its outer side a signal cycle ahead of the tram: a generic
  // rider in an oat jacket and a slate helmet on a red bike with a front lamp (a dot the frame
  // loop lights at night). The bike, the body and the arms are one rigid rig; the legs pedal.
  const cyclist = new T.Group(),
    rig = new T.Group(),
    rider = createResident(8, material, { coat: '#cdb48d', legs: '#3a4654', hair: '#7d91a5', scarf: '#f5efe0' });
  cyclist.name = 'cyclist';
  cyclist.userData.prebatched = true; // batched with the people below
  cyclist.add(rig);
  city.add(cyclist);
  const bike = bicycle(rig, palette.redDoor, { lamp: true });
  cyclist.add(rider);
  rider.position.set(0, 0.05, -0.1);
  const riderJoints = seatRider(rider);
  cyclist.updateMatrixWorld(true);
  for (const part of [bike, rider.getObjectByName('body')!, rider.getObjectByName('arm-left')!, rider.getObjectByName('arm-right')!])
    for (const mesh of part.children.filter((o) => o instanceof T.Mesh)) rig.attach(mesh);
  for (const hip of riderJoints.hips) cyclist.attach(hip);
  bike.removeFromParent();
  rider.removeFromParent();
  {
    const update = (time: number) => {
      const p = plan.cyclistPose(time);
      cyclist.position.set(p.x, plan.levels.road, p.z);
      cyclist.rotation.set(0, p.heading, p.lean); // the lean is about the bike's own axis, into the turn
      pedalRider(riderJoints, p.crank);
    };
    update(0);
    animated.push({ object: cyclist, update });
  }
  // Three ducks on the gate's pool; the animated list's batching makes each one mesh.
  pondDucks(city);
  // The bike rack at the Research Studio's entrance: two hoops on its apron and a bike on each, front
  // to the plaza, their frames leaning on the hoops. Two, not three: three bikes by the studio of a
  // three-member group would read as theirs. The rack joins the studio's shell, so it batches,
  // rings and inspects with the building (built in the town instead, it would punch holes in the
  // studio's selection ring wherever it stands in front of the apron).
  {
    const rack = new T.Group(),
      { x, y, hoops, parked } = plan.bikeRack,
      studio = models.get('research-studio')!;
    city.add(rack);
    hoops.forEach((z, i) => {
      cycleHoop(rack, x, y, z);
      if (!parked.includes(i)) return;
      const bike = bicycle(rack, i === 0 ? palette.greenDoor : palette.tramCream, { basket: i === 1 });
      bike.position.set(x + 0.025, y, z + 0.1);
      bike.rotation.set(0, -Math.PI / 2, 0.07); // the top tube rests on the hoop's bow
    });
    studio.shell.attach(rack);
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
  // Each glass pane carries its own night light in aWindow (batch() draws it; see town-batch.ts).
  for (const [id, m] of models) {
    batch(m.shell, { windows: id === 'town-hall' || id === 'city-archive' ? 'civic' : id === 'research-studio' ? 'studio' : 'home', place: id });
    yield `batch ${id}`;
  }
  /** A figure batched part by part (the body, each hip and knee, each arm), so its joints still bend. */
  function batchFigure(root: T.Object3D) {
    for (const part of root.children) {
      const joints = part.children.filter((o) => o instanceof T.Group);
      for (const joint of joints) {
        part.remove(joint);
        batch(joint as T.Group, { contact: 'none' });
      }
      batch(part as T.Group, { contact: 'none' });
      if (joints.length) part.add(...joints);
    }
  }
  for (const walker of walkers) batchFigure(walker.root);
  batchFigure(dogWalker);
  batchFigure(cyclist);
  for (const name of ['dog-head', 'dog-tail']) batch(dog.getObjectByName(name)!, { contact: 'none' });
  batch(dog, { contact: 'none' });
  batch(tram, { contact: 'local', localFloor: 0, windows: 'vehicle' });
  batch(boat, { contact: 'none', windows: 'vehicle' });
  for (const entry of animated)
    if (!entry.object.userData.prebatched && (entry.object.children.length > 1 || entry.object.children.some((c) => c instanceof T.Mesh)))
      batch(entry.object, { contact: 'none' });
  city.updateMatrixWorld(true);

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
    windows,
    animated,
    parkGroup,
    parkHit,
    waterLevel: WATER,
    groundMasks,
    materialLibrary: library,
    disposeMaterials: options.library ? () => {} : library.dispose,
  };
}
