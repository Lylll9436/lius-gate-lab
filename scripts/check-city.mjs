import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as T from 'three';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'work', 'model-check');
await fs.mkdir(output, { recursive: true });
await fs.copyFile(
  path.join(root, 'content/lab.json'),
  path.join(output, 'lab.json'),
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
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    })
    .outputText.replace(/(['"])\.\/([\w-]+)\1/g, "'./$2.mjs'")
    .replace("'../content/lab.json'", "'./lab.json'")
    .replaceAll("'./city-data'", "'./city-data.mjs'")
    .replaceAll("'./city-plan'", "'./city-plan.mjs'")
    .replaceAll("'./city-motion'", "'./city-motion.mjs'");
  await fs.writeFile(path.join(output, name + '.mjs'), compiled);
}
const { buildings } = await import(
  pathToFileURL(path.join(output, 'city-data.mjs')).href
);
const { buildCityModel, plotCenter } = await import(
  pathToFileURL(path.join(output, 'city-scene.mjs')).href
);
const { districts, walkingRoute, routeLength } = await import(
  pathToFileURL(path.join(output, 'city-plan.mjs')).href
);
assert.equal(new Set(buildings.map((b) => b.id)).size, 7);
assert.equal(districts.length, 4);
for (const b of buildings) {
  const route = walkingRoute(b.id);
  assert(route.length >= 2 && routeLength(route) > 0);
  for (let i = 1; i < route.length; i++)
    assert(
      route[i][0] === route[i - 1][0] || route[i][1] === route[i - 1][1],
      'Route must follow the street axes',
    );
  for (let i = 1; i < route.length; i++)
    for (const other of buildings.filter((b) => b.id !== 'lius-gate')) {
      const p = plotCenter(other),
        halfX = (other.w * 2.2) / 2 - 0.35,
        halfZ = (other.d * 2.2) / 2 - 0.35;
      const [a, c] = [route[i - 1], route[i]];
      const crosses =
        a[0] === c[0]
          ? Math.abs(a[0] - p.x) < halfX &&
            Math.min(a[1], c[1]) < p.z + halfZ &&
            Math.max(a[1], c[1]) > p.z - halfZ
          : Math.abs(a[1] - p.z) < halfZ &&
            Math.min(a[0], c[0]) < p.x + halfX &&
            Math.max(a[0], c[0]) > p.x - halfX;
      assert(!crosses, `Walking route to ${b.id} crosses ${other.id}`);
    }
}
for (const b of buildings) {
  assert(Number.isInteger(b.x) && Number.isInteger(b.z) && b.w > 0 && b.d > 0);
  for (const id of b.related)
    assert(
      buildings.some((item) => item.id === id),
      `Broken link: ${id}`,
    );
  for (const locale of ['en', 'zh']) {
    assert(b.name[locale] && b.summary[locale]);
    for (const section of b.sections)
      assert(section.heading[locale] && section.body[locale]);
  }
}
for (let i = 0; i < buildings.length; i++)
  for (let j = i + 1; j < buildings.length; j++) {
    const a = buildings[i],
      b = buildings[j];
    assert(
      !(
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.z < b.z + b.d &&
        a.z + a.d > b.z
      ),
      `Overlapping plots: ${a.id} and ${b.id}`,
    );
  }
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => warnings.push(args.join(' '));
const { city, models, walkers, lamps } = buildCityModel();
console.warn = originalWarn;
assert.deepEqual(warnings, []);
assert.equal(models.size, 7);
assert.equal(walkers.length, 5);
assert.equal(lamps.length, 12);
city.updateMatrixWorld(true);
let meshes = 0,
  vertices = 0;
city.traverse((o) => {
  if (o.isMesh) {
    meshes++;
    const pos = o.geometry.attributes.position;
    assert(pos && pos.count > 0);
    vertices += pos.count;
    for (const value of pos.array)
      assert(Number.isFinite(value), 'Non-finite vertex');
  }
});
for (const [id, m] of models) {
  assert(m.fade.length > 0);
  if (id !== 'lius-gate') {
    const furnitureMeshes = m.interior.children.filter((o) => o.isMesh);
    assert(
      furnitureMeshes.length > 1 && furnitureMeshes.length < 18,
      'Room batches must preserve physical surface families.',
    );
    for (const mesh of furnitureMeshes) {
      assert(
        mesh.material.vertexColors,
        'Room surface colours must survive batching.',
      );
      assert.equal(
        mesh.geometry.attributes.color.count,
        mesh.geometry.attributes.position.count,
      );
      assert(
        [...mesh.geometry.attributes.color.array].every(
          (color) => Number.isFinite(color) && color >= 0 && color <= 1,
        ),
      );
      assert(
        mesh.geometry.attributes.uv?.count ===
          mesh.geometry.attributes.position.count,
        'Material UVs must survive batching.',
      );
    }
  } else {
    assert.equal(m.shell.userData.landmark, "LIU'S GATE");
    assert(m.shell.userData.openingWidth > 1.5);
    assert.equal(m.center.x, 0);
    assert.equal(m.center.z, 0);
  }
  const bounds = new T.Box3().setFromObject(m.root);
  assert(!bounds.isEmpty());
  const p = plotCenter(buildings.find((b) => b.id === id));
  assert.equal(m.root.position.x, p.x);
  assert.equal(m.root.position.z, p.z);
  assert(
    bounds.max.y < 10 && bounds.min.y >= 0,
    `Invalid building height: ${id}`,
  );
}
assert(meshes < 450, `Static batching regression: ${meshes} meshes`);
console.log(
  `City checks passed: 7 non-overlapping plots, 4 districts, clear street routes, central walk-through gate, ${meshes} meshes / ${vertices} finite vertices, 6 furnished interiors.`,
);
