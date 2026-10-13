import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as T from 'three';

// Build the town in Node and check what a visitor relies on: seven places, finite geometry, a sane triangle budget, hover targets, water, the lighthouse beam and night.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  output = path.join(root, 'work', 'town-check');
await fs.mkdir(output, { recursive: true });
await fs.copyFile(
  path.join(root, 'content/lab.json'),
  path.join(output, 'lab.json'),
);
for (const name of [
  'content-schema',
  'lab-records',
  'city-data',
  'city-districts',
  'city-materials',
  'city-people',
  'city-hover',
  'city-inspection',
  'city-ink',
  'city-water',
  'city-lighting',
  'glasgow-sun',
  'city-atmosphere',
  'town-plan',
  'town-build',
  'city-scene',
]) {
  const source = await fs.readFile(
    path.join(root, 'app', name + '.ts'),
    'utf8',
  );
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    })
    .outputText.replace(/(['"])\.\/([\w-]+)\1/g, "'./$2.mjs'")
    .replace("'../content/lab.json'", "'./lab.json'");
  await fs.writeFile(path.join(output, name + '.mjs'), compiled);
}
const load = (name) => import(pathToFileURL(path.join(output, name + '.mjs')).href);
const { buildings } = await load('city-data');
const { districts } = await load('city-districts');
const plan = await load('town-plan');
const { buildCityModel } = await load('city-scene');
const { fitStudy } = await load('city-inspection');
const { createStreetLighting } = await load('city-lighting');
const { createIslandWater } = await load('city-water');

assert.equal(new Set(buildings.map((b) => b.id)).size, 7);
// Every reading chapter sees its subject's front, not its back wall.
for (const [chapter, ids] of Object.entries(plan.chapterSubjects))
  for (const id of ids) {
    const d = (plan.chapterBearings[chapter] - plan.sites[id].rotation) % (Math.PI * 2),
      off = Math.abs(d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d);
    assert(off < Math.PI / 3, `${chapter} sees ${id} ${Math.round((off * 180) / Math.PI)} degrees off its front`);
  }
assert.equal(districts.length, 4);
for (const b of buildings) {
  assert(plan.sites[b.id], 'Every building needs a site: ' + b.id);
  for (const id of b.related)
    assert(buildings.some((item) => item.id === id), `Broken link: ${id}`);
  for (const locale of ['en', 'zh']) {
    assert(b.name[locale] && b.summary[locale]);
    for (const section of b.sections)
      assert(section.heading[locale] && section.body[locale]);
  }
}
// Sites sit on the island, off the streets, and never overlap one another.
for (const site of plan.siteList) {
  assert(plan.onIsland(site.x, site.z, 2), 'Site in the sea: ' + site.id);
  if (site.id !== 'lius-gate')
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [0, 0],
    ]) {
      const lx = (sx * site.w) / 2,
        lz = (sz * site.d) / 2;
      const x = site.x + lx * Math.cos(site.rotation) + lz * Math.sin(site.rotation),
        z = site.z - lx * Math.sin(site.rotation) + lz * Math.cos(site.rotation);
      assert(plan.distanceToStreets(x, z) > -0.2, `Site built on a street: ${site.id} at ${x.toFixed(1)}, ${z.toFixed(1)}`);
    }
  for (const other of plan.siteList)
    if (other !== site)
      assert(
        Math.hypot(site.x - other.x, site.z - other.z) >
          (Math.max(site.w, site.d) + Math.max(other.w, other.d)) / 2 - 0.6,
        `Overlapping sites: ${site.id} and ${other.id}`,
      );
}
// The terrace reads as the three members' homes: a cottage beside it stands well back from
// the row's line and is turned, so it never looks like a fourth or fifth house in the row.
const row = plan.terraceRow;
for (const c of plan.cottages) {
  assert(plan.onIsland(c.x, c.z, 2.5), `Cottage by the shore: ${c.x}, ${c.z}`);
  assert(plan.distanceToStreets(c.x, c.z) > 2, `Cottage on a street: ${c.x}, ${c.z}`);
  if (Math.abs(c.x - row.x) < 8 && Math.abs(c.z - row.z) < row.spacing * 3) {
    assert(Math.abs(c.x - row.x) > 2.5, `Cottage on the terrace row's line: ${c.x}, ${c.z}`);
    assert(Math.abs(plan.angleDiff(c.rotation, Math.PI / 2)) > 0.3, `Cottage facing the street like the terrace: ${c.x}, ${c.z}`);
  }
}
// Plan view's districts lie on the flat island above every paving level, cover the places
// they describe, keep clear of one another and say what they are in both languages.
const { buildDistrictZones, DISTRICT_LIFT } = await load('city-scene');
assert(DISTRICT_LIFT > Math.max(...Object.values(plan.levels)), 'Districts under the paving.');
const inside = (outline, x, z) => {
  let within = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, zi] = outline[i],
      [xj, zj] = outline[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) within = !within;
  }
  return within;
};
const covers = {
  civic: [[plan.sites['lius-gate'].x, plan.sites['lius-gate'].z]],
  residential: [],
  research: [[plan.reservedPlot.x, plan.reservedPlot.z]],
  waterfront: [[plan.park.x, plan.park.z]],
};
for (const d of districts) {
  for (const locale of ['en', 'zh']) assert(d.name[locale] && d.description[locale]);
  assert(!/[㐀-鿿]/.test(d.name.en + d.description.en), 'Chinese in English: ' + d.id);
  for (const id of d.buildings)
    covers[d.id].push([plan.sites[id].x, plan.sites[id].z]);
  for (const [x, z] of covers[d.id])
    assert(inside(d.outline, x, z), `${d.id} leaves out ${x}, ${z}`);
  for (let i = 0; i < d.outline.length; i++) {
    const [ax, az] = d.outline[i],
      [bx, bz] = d.outline[(i + 1) % d.outline.length];
    for (let t = 0; t <= 1; t += 0.05)
      assert(plan.onIsland(ax + (bx - ax) * t, az + (bz - az) * t, 0.8), `${d.id} reaches the shore`);
  }
  const xs = d.outline.map(([x]) => x),
    zs = d.outline.map(([, z]) => z);
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.5)
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.5)
      if (inside(d.outline, x, z))
        assert(plan.terrainHeight(x, z) < 0.01, `${d.id} runs up a hill at ${x}, ${z}`);
  for (const other of districts)
    if (other !== d)
      for (const [x, z] of other.outline)
        assert(!inside(d.outline, x, z), `${d.id} overlaps ${other.id}`);
}
const zones = buildDistrictZones();
assert.equal(zones.visible, false, 'Plan view starts off.');
assert.equal(zones.children.length, districts.length * 2);
for (const part of zones.children) {
  const position = part.geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++)
    assert(Math.abs(position.getY(i) - DISTRICT_LIFT) < 1e-6, `${part.userData.district} is not flat`);
  assert(part.material.transparent && !part.material.depthWrite);
}
// Trees stay off the streets and sites; the harbour boat stays in the water.
const trees = plan.plantingPlan();
assert(trees.length > 60, 'Too few trees: ' + trees.length);
for (const t of trees) {
  assert(plan.onIsland(t.x, t.z, 0.5), 'Tree in the sea: ' + t.id);
  const onPlaza = Math.hypot(t.x, t.z) < plan.PLAZA_RADIUS;
  if (onPlaza) assert(Math.hypot(t.x, t.z) > 3.8, 'Plaza tree in the pool: ' + t.id);
  else assert(plan.distanceToStreets(t.x, t.z) > 0.6, 'Tree on a street: ' + t.id);
  for (const site of plan.siteList)
    assert(
      Math.hypot(site.x - t.x, site.z - t.z) > Math.min(site.w, site.d) / 2,
      `Tree inside ${site.id}: ${t.id}`,
    );
}
for (let i = 0; i < 400; i++) {
  const pose = plan.boatPose(i * 0.37);
  assert(!plan.onIsland(pose.x, pose.z, -1.0), 'Boat runs aground.');
  assert(Number.isFinite(pose.heading));
}
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => warnings.push(args.join(' '));
const start = performance.now();
const model = buildCityModel();
const ms = performance.now() - start;
console.warn = originalWarn;
assert.deepEqual(warnings, []);
const { city, models, walkers, lamps, clocks } = model;
assert.equal(models.size, 7);
assert.equal(walkers.length, 7);
assert.equal(clocks.length, 4, 'The town hall keeps four clock faces.');
assert(lamps.length >= 20, 'Lanterns light the town: ' + lamps.length);
city.updateMatrixWorld(true);
let meshes = 0,
  vertices = 0,
  triangles = 0;
city.traverse((o) => {
  if (o.isMesh) {
    meshes++;
    const pos = o.geometry.attributes.position;
    assert(pos && pos.count > 0);
    vertices += pos.count;
    triangles += (o.geometry.index?.count ?? pos.count) / 3;
    for (const value of pos.array)
      assert(Number.isFinite(value), 'Non-finite vertex');
  }
});
assert(meshes < 420, `Static batching regression: ${meshes} meshes`);
assert(triangles < 900000, `Triangle budget exceeded: ${Math.round(triangles)}`);
// The page builds the same town a phase at a time, handing the main thread back in between.
const { buildTownInPhases } = await load('town-build');
const phaseNames = [];
let longestPhase = 0,
  phased;
for (const phases = buildTownInPhases(); ; ) {
  const begin = performance.now(),
    step = phases.next();
  longestPhase = Math.max(longestPhase, performance.now() - begin);
  if (step.done) {
    phased = step.value;
    break;
  }
  phaseNames.push(step.value);
}
assert(phaseNames.length >= 10, 'The town is built in phases: ' + phaseNames.join(', '));
assert.equal(new Set(phaseNames).size, phaseNames.length, 'Every phase has its own name.');
let phasedMeshes = 0,
  phasedTriangles = 0;
phased.city.traverse((o) => {
  if (!o.isMesh) return;
  phasedMeshes++;
  phasedTriangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
});
assert.deepEqual(
  [phasedMeshes, phasedTriangles, phased.models.size, phased.walkers.length],
  [meshes, triangles, models.size, walkers.length],
  'Built in phases, the town is the same town.',
);
for (const [id, m] of models) {
  assert.equal(m.root.userData.buildingId, id);
  const bounds = new T.Box3().setFromObject(m.root);
  assert(!bounds.isEmpty());
  assert(bounds.max.y < 14 && bounds.min.y >= -0.3, `Invalid building height: ${id}`);
  // One batched shell per building: walls and roof together, no rooms inside.
  assert.deepEqual(m.root.children, [m.shell], 'A building is a single shell: ' + id);
  assert(m.shell.children.some((o) => o.isMesh), 'The shell has geometry: ' + id);
  // Inspecting a building frames the whole exterior in the usual canvas shapes.
  m.root.updateMatrixWorld(true);
  const exterior = bounds.clone().translate(m.root.position.clone().negate());
  for (const [width, height] of [
    [390, 844],
    [1024, 768],
    [1440, 900],
  ]) {
    // The frustum city-scene's resize() gives the canvas: Inspect fits that, not a guess.
    const aspect = width / height,
      vertical = Math.max(53, 76 / aspect);
    const camera = new T.OrthographicCamera((-vertical * aspect) / 2, (vertical * aspect) / 2, vertical / 2, -vertical / 2, 0.1, 180);
    camera.position.set(Math.sin(0.8) * 38, 35, Math.cos(0.8) * 38);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const fit = fitStudy(exterior, camera),
      beside = fitStudy(exterior, camera, 0.66),
      above = fitStudy(exterior, camera, 1, 0.7);
    for (const f of [fit, beside, above])
      assert(Number.isFinite(f.zoom) && f.zoom > 0 && f.focus.toArray().every(Number.isFinite), 'Inspection fit: ' + id);
    // Beside the open file (or above a phone's sheet) the building gets the narrower frame,
    // never a closer one.
    assert(beside.zoom <= fit.zoom + 1e-9, 'Inspection beside the file: ' + id);
    assert(above.zoom <= fit.zoom + 1e-9, 'Inspection above the sheet: ' + id);
  }
}
// The pointer can find every building and the park.
const ray = new T.Raycaster();
for (const [id, m] of models) {
  const bounds = new T.Box3().setFromObject(m.root),
    centre = bounds.getCenter(new T.Vector3());
  ray.set(new T.Vector3(centre.x, 40, centre.z), new T.Vector3(0, -1, 0));
  const hit = ray.intersectObjects([m.root], true)[0];
  assert(hit, 'Nothing to click on: ' + id);
}
assert.equal(model.parkHit.userData.placeId, 'corner-park');
// Open water around the island, and a water shader that still compiles.
const water = createIslandWater(model.waterLevel, -0.5);
city.add(water.bottom, water.mesh);
city.updateMatrixWorld(true);
for (const [x, z] of [
  [0, -36],
  [-37, 0],
  [37, 24],
  [0, 36],
]) {
  ray.set(new T.Vector3(x, 1, z), new T.Vector3(0, -1, 0));
  assert.equal(ray.intersectObject(city, true)[0]?.object, water.mesh, 'Open sea expected at ' + x + ',' + z);
}
const shader = {
  uniforms: {},
  vertexShader: T.ShaderLib.physical.vertexShader,
  fragmentShader: T.ShaderLib.physical.fragmentShader,
};
water.mesh.material.onBeforeCompile(shader, null);
assert(shader.fragmentShader.includes('vec3 waveNormal=creekNormal(waterP)'));
water.update(7, 0, new T.PerspectiveCamera());
water.update(8, 1, new T.PerspectiveCamera(), { rain: 1, sun: new T.Vector3(1, 1, 1) });
// Night: windows glow, lanterns light up, spotlights point down.
model.materialLibrary.setNight(1);
let windows = 0;
city.traverse((o) => {
  // Lanterns carry their own glow, driven by the frame loop; windows share the library's glass.
  if (o.isMesh && o.material.userData.surfaceKind === 'glass' && !lamps.includes(o)) {
    assert(o.material.emissiveIntensity > 0.5, 'Windows must light up at night.');
    windows++;
  }
});
assert(windows > 5);
// The lighthouse beam swings over the sea at night, never across the island, and is not drawn by day.
const beam = model.animated.find((e) => e.object.children[0]?.material?.uniforms?.strength);
assert(beam, 'The lighthouse has a beam.');
assert.equal(beam.object.children[0].material.side, T.FrontSide, 'The beam is one soft layer, not two.');
const [rockX, rockZ] = plan.lighthouseRock;
for (let i = 0; i < 240; i++) {
  beam.update(i * 0.29, 1);
  assert(beam.object.visible && beam.object.children[0].material.uniforms.strength.value > 0, 'The beam shines at night.');
  const a = beam.object.rotation.y;
  for (let d = 1; d <= 18; d++)
    assert(!plan.onIsland(rockX + Math.cos(a) * d, rockZ - Math.sin(a) * d, -0.5), `The lighthouse beam crosses the island at t=${(i * 0.29).toFixed(2)}`);
}
beam.update(3, 0);
assert(!beam.object.visible, 'No beam by day.');
const scene = new T.Scene();
scene.add(city);
const lighting = createStreetLighting(scene, lamps.slice(0, 6), { shadows: 1 });
lighting.update(1, false);
assert.equal(lighting.lights.length, 6);
assert(lighting.lights.every((l) => l.isSpotLight && l.intensity > 0 && l.position.y > l.target.position.y));
assert(scene.children.includes(lighting.lights[0]), 'Spotlights join the scene at night.');
lighting.update(0, false);
assert(lighting.lights.every((l) => l.intensity === 0));
assert(!scene.children.includes(lighting.lights[0]), 'Spotlights leave the scene by day.');
lighting.dispose();
// The balloon rounds the island out over the shore and the sea, above the gulls, and never
// drifts over a building a chapter is about.
const balloon = model.animated.find((e) => {
  e.update(10, 0);
  return e.object.position.y > 11;
});
assert(balloon, 'The town has a balloon.');
// It sets off north-east over the sea (the opening view's open top right), not behind the hero text.
balloon.update(0, 0);
assert(balloon.object.position.x > 10 && balloon.object.position.z < -20, 'The balloon starts north-east, over the sea.');
for (let i = 0; i < 720; i++) {
  balloon.update(i * 0.7, 0);
  const { x, y, z } = balloon.object.position;
  assert(Math.hypot(x, z) > 30, `The balloon drifts over the town at t=${(i * 0.7).toFixed(1)}`);
  assert(y > 11.5, 'The balloon flies above the gulls.');
  for (const site of plan.siteList)
    assert(Math.hypot(x - site.x, z - site.z) > 8, `The balloon drifts over ${site.id}`);
}
// The season shows on the trees: blossom only in spring, autumn tones only in autumn.
const { glasgowSeason } = await load('glasgow-sun');
const { treeLook } = await load('town-build');
for (const [when, season] of [
  ['2026-01-10T12:00:00Z', 'winter'],
  ['2026-03-01T09:00:00Z', 'spring'],
  ['2026-05-31T23:30:00Z', 'summer'], // already 1 June in Glasgow (BST)
  ['2026-10-13T12:00:00Z', 'autumn'],
  ['2026-12-01T00:30:00Z', 'winter'],
])
  assert.equal(glasgowSeason(new Date(when)), season, 'Glasgow season on ' + when);
assert.equal(glasgowSeason(new Date('2026-10-13T12:00:00Z'), '?debug&season=spring'), 'spring', '?season= previews a season.');
assert.equal(glasgowSeason(new Date('2026-10-13T12:00:00Z'), '?season=monsoon'), 'autumn', 'An unknown ?season= is ignored.');
// Indexed as the build plants them (pines keep their own look).
const looks = (season) => new Set(trees.flatMap((t, i) => (t.kind === 'pine' ? [] : [treeLook(t, i, season).top])));
const blossomTop = '#fdd9e3',
  autumnTop = '#f2c862';
assert(looks('spring').has(blossomTop) && !looks('spring').has(autumnTop), 'Spring blossoms and does not turn.');
assert(looks('autumn').has(autumnTop) && !looks('autumn').has(blossomTop), 'Autumn turns and does not blossom.');
for (const season of ['summer', 'winter'])
  assert(!looks(season).has(blossomTop) && !looks(season).has(autumnTop), season + ' trees stay green.');
// The key light stays high all day, comes down to about 40 degrees at dawn and golden hour, and
// goes back up for the night light.
const { sunOffsetFor, lowSun } = await load('city-atmosphere');
const degrees = (v) => (Math.atan2(v.y, Math.hypot(v.x, v.z)) * 180) / Math.PI,
  rad = (d) => (d * Math.PI) / 180;
assert(degrees(sunOffsetFor(rad(30), Math.PI)) > 50, 'A high key light by day.');
assert(Math.abs(degrees(sunOffsetFor(rad(2), Math.PI * 1.5)) - 40) < 1.5, 'A low key light at golden hour.');
assert(degrees(sunOffsetFor(rad(-12), Math.PI * 1.6)) > 49, 'The night light stays high.');
assert.equal(lowSun(rad(15)), 0);
assert.equal(lowSun(rad(2)), 1);
assert.equal(lowSun(rad(-10)), 0);
console.log(
  `Town checks passed: 7 sites on the island, ${districts.length} plan districts above the paving around their places, ${trees.length} trees off the streets, a boat that stays afloat, ${meshes} meshes / ${Math.round(triangles)} triangles built in ${Math.round(ms)} ms (or in ${phaseNames.length + 1} phases of at most ${Math.round(longestPhase)} ms), one shell per building with a fitted close-up, clickable buildings, open sea, a lighthouse beam that stays over it, lit windows at night, a balloon out over the shore, trees that keep the season and a low golden-hour sun.`,
);
