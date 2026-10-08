import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as T from 'three';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'work/detail-check');
await fs.mkdir(out, { recursive: true });
await fs.copyFile(
  path.join(root, 'content/lab.json'),
  path.join(out, 'lab.json'),
);
for (const name of [
  'content-schema',
  'lab-records',
  'city-layout',
  'city-craft',
  'city-hover',
  'city-ground',
  'city-inspection',
  'city-ink',
  'city-materials',
  'city-data',
  'city-motion',
  'city-plan',
  'city-scene',
  'city-districts',
  'city-island',
  'island-footprint',
  'city-water',
  'city-detail',
  'city-lighting',
  'city-people',
  'city-streetcraft',
  'city-planting-plan',
  'city-street-edges',
  'city-paving',
  'city-landscape',
  'city-path-plan',
  'city-curved-paving',
  'city-shore',
  'city-atmosphere',
]) {
  const source = await fs.readFile(
    path.join(root, 'app', name + '.ts'),
    'utf8',
  );
  const code = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    })
    .outputText.replace(/(['"])\.\/([\w-]+)\1/g, "'./$2.mjs'")
    .replace("'../content/lab.json'", "'./lab.json'");
  await fs.writeFile(path.join(out, name + '.mjs'), code);
}
const load = (name) => import(pathToFileURL(path.join(out, name + '.mjs')));
const { buildCityModel } = await load('city-scene');
const { createDetailManager } = await load('city-detail');
const { createStreetLighting } = await load('city-lighting');
const { onIsland, islandBanks } = await load('island-footprint');
const { groundSurfaces, supportSurfaces } = await load('city-ground');
const count = (m) => {
  let vertices = 0,
    triangles = 0,
    bytes = 0,
    meshes = 0;
  m.traverse((o) => {
    if (o.isMesh) {
      meshes++;
      vertices += o.geometry.attributes.position.count;
      triangles +=
        (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
      for (const a of Object.values(o.geometry.attributes))
        bytes += a.array.byteLength;
      bytes += o.geometry.index?.array.byteLength ?? 0;
    }
  });
  return { meshes, vertices, triangles, bytes };
};
const start = performance.now(),
  far = buildCityModel({ quality: 'far' }),
  farMs = performance.now() - start;
const begin = performance.now(),
  near = buildCityModel(),
  nearMs = performance.now() - begin;
const a = count(far.city),
  b = count(near.city);
assert(
  a.vertices < b.vertices * 0.35,
  'Overview geometry must remain substantially cheaper than full detail.',
);
assert(far.treeLods.length >= 25, 'Trees must remain separate lazy assets.');
assert(
  [...far.models.values()].filter((m) => m.interior.children.length === 0)
    .length === 7,
  'Overview must not eagerly furnish rooms.',
);
assert.deepEqual(
  far.colliders.map((c) => c.id),
  near.colliders.map((c) => c.id),
  'LOD must preserve the planned object identities.',
);
const collisionSnapshot = JSON.stringify(far.colliders);
// Switching crown/root detail must preserve the actual pit/soil contact height.
for (const entry of far.treeLods
  .filter((t) => t.root.userData.collider.id.startsWith('avenue-'))
  .filter((_, i) => i % 5 === 0)) {
  far.city.updateMatrixWorld(true);
  const before = new T.Box3().setFromObject(entry.low).min.y;
  const high = entry.create();
  entry.root.add(high);
  far.city.updateMatrixWorld(true);
  assert(
    Math.abs(new T.Box3().setFromObject(high).min.y - before) < 1e-5,
    'Tree LOD makes roots float above the planting soil.',
  );
  entry.root.remove(high);
  high.traverse((o) => {
    if (o.isMesh) o.geometry.dispose();
  });
  assert(
    far.city.children[0].children.some(
      (o) => o.name === 'pit-' + entry.root.userData.collider.id,
    ),
    'LOD lost the permanent tree pit.',
  );
}

// Build a real close building in its moving scene anchor, then inspect in world coordinates.
const id = 'yunlong-liu',
  low = far.models.get(id),
  anchor = new T.Group();
anchor.position.copy(low.root.position);
far.city.add(anchor);
anchor.attach(low.root);
const full = buildCityModel({
  onlyBuilding: id,
  library: far.materialLibrary,
}).models.get(id);
full.root.position.set(0, 0, 0);
anchor.add(full.root);
far.city.updateMatrixWorld(true);
assert(
  new T.Box3().setFromObject(full.interior).getSize(new T.Vector3()).length() >
    1,
  'Lazy room is fully furnished.',
);
assert(
  full.root
    .getWorldPosition(new T.Vector3())
    .distanceTo(low.root.getWorldPosition(new T.Vector3())) < 1e-8,
);
const clone = full.root.clone(true);
full.root.getWorldPosition(clone.position);
clone.updateMatrixWorld(true);
assert(
  new T.Box3()
    .setFromObject(clone)
    .equals(new T.Box3().setFromObject(full.root)),
);

// Every paved/support corner stays inside the single inhabited island.
for (const s of [...groundSurfaces, ...supportSurfaces])
  for (const x of [s.x - s.w / 2 + 0.001, s.x + s.w / 2 - 0.001])
    for (const z of [s.z - s.d / 2 + 0.001, s.z + s.d / 2 - 0.001]) {
      assert(onIsland(x, z), 'Land surface outside the island: ' + s.id);
    }
const ray = new T.Raycaster();
far.city.updateMatrixWorld(true);
for (const [x, z] of [
  [0, -34],
  [-35, 0],
  [35, 20],
  [0, 29],
  [-23, 28.5],
  [23, 28.5],
]) {
  ray.set(new T.Vector3(x, 1, z), new T.Vector3(0, -1, 0));
  assert.equal(
    ray.intersectObject(far.city, true)[0]?.object,
    far.water.mesh,
    'Surrounding empty space and channel mouths must be water.',
  );
}
assert(islandBanks.length === 1);
assert.equal(JSON.stringify(far.colliders), collisionSnapshot);
// Shader expansion follows Three's physical shader; water is never static-batched.
const shader = {
  uniforms: {},
  vertexShader: T.ShaderLib.physical.vertexShader,
  fragmentShader: T.ShaderLib.physical.fragmentShader,
};
far.water.mesh.material.onBeforeCompile(shader, null);
assert(shader.fragmentShader.includes('vec3 waveNormal=creekNormal(waterP)'));
assert(
  !shader.vertexShader.includes('transformed.y+='),
  'Ocean geometry must not become two enormous sloping triangles.',
);
far.water.update(7, 0, new T.PerspectiveCamera());
const day = far.water.bottom.material.color.clone();
far.water.update(8, 1, new T.PerspectiveCamera());
assert(far.water.bottom.material.color.r < day.r * 0.3);
far.materialLibrary.setNight(1);
let windows = 0;
far.city.traverse((o) => {
  if (o.isMesh && o.material.userData.surfaceKind === 'glass') {
    assert(o.material.emissiveIntensity > 0.5);
    windows++;
  }
});
assert(windows > 5);
const scene = new T.Scene();
scene.add(far.city);
const lighting = createStreetLighting(scene, far.lamps);
lighting.update(1, false);
assert.equal(lighting.lights.length, 12);
assert(
  lighting.lights.every(
    (l) =>
      l.isSpotLight &&
      l.intensity > 0 &&
      l.position.y > l.target.position.y &&
      l.distance > l.position.y,
  ),
);
lighting.update(0, false);
assert(lighting.lights.every((l) => l.intensity === 0));
lighting.dispose();

// Deterministic scheduling tests: zoom hysteresis, priority on pan, cancellation and disposal.
const realSet = globalThis.setTimeout,
  realClear = globalThis.clearTimeout,
  queue = [];
globalThis.setTimeout = (fn) => {
  queue.push(fn);
  return fn;
};
globalThis.clearTimeout = (fn) => {
  const i = queue.indexOf(fn);
  if (i >= 0) queue.splice(i, 1);
};
try {
  const camera = new T.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const created = [],
    evicted = [];
  const assets = [0, 1, 2, 3].map((i) => {
    const root = new T.Group(),
      low = new T.Group();
    root.position.x = i;
    root.add(low);
    return {
      id: 'b' + i,
      kind: 'building',
      root,
      low,
      height: 1,
      create() {
        created.push(i);
        return new T.Group();
      },
      onEvict() {
        evicted.push(i);
      },
    };
  });
  const mgr = createDetailManager(assets),
    step = (t) => {
      mgr.update(camera, 1000, t, false);
      while (queue.length) queue.shift()();
    };
  step(0);
  step(200);
  step(300);
  step(400);
  assert.deepEqual(created, [0, 1, 2]);
  camera.position.x = 3;
  camera.lookAt(3, 0, 0);
  camera.updateMatrixWorld(true);
  step(500);
  step(700);
  assert(
    created.includes(3) && !assets[3].low.visible,
    'New centered building must replace lower-priority cached assets.',
  );
  assert(mgr.stats().cached <= 3);
  camera.zoom = 0.5;
  camera.updateProjectionMatrix();
  step(800);
  step(1000);
  assert(assets.every((e) => e.low.visible));
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  step(1100);
  mgr.update(camera, 1000, 1400, false);
  mgr.update(camera, 1000, 1401, true);
  assert.equal(queue.length, 0);
  mgr.dispose();
  const n = created.length;
  mgr.ensure('b0');
  assert.equal(created.length, n);
  assert.equal(mgr.stats().cached, 0);
  assert(evicted.length >= 3);
} finally {
  globalThis.setTimeout = realSet;
  globalThis.clearTimeout = realClear;
}
console.log(
  'Detail checks passed: lazy rooms, unchanged collision registry, bounded LOD priority/cancellation/disposal, island containment, animated water and night illumination.',
);
console.log(
  JSON.stringify(
    {
      overview: { generationMs: Math.round(farMs), ...a },
      full: { generationMs: Math.round(nearMs), ...b },
    },
    null,
    2,
  ),
);
