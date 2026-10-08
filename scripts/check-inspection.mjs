import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as T from 'three';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  output = path.join(root, 'work/inspection-check');
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
    .replace("'../content/lab.json'", "'./lab.json'");
  await fs.writeFile(path.join(output, name + '.mjs'), compiled);
}
const { buildCityModel } = await import(
  pathToFileURL(path.join(output, 'city-scene.mjs')).href
);
const { roofDock, fitStudy } = await import(
  pathToFileURL(path.join(output, 'city-inspection.mjs')).href
);
const { models } = buildCityModel();
function projection(box, camera) {
  const points = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z])
        points.push(new T.Vector3(x, y, z).project(camera));
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}
let poses = 0,
  visibleRoofs = 0;
for (const [id, m] of models) {
  m.root.updateMatrixWorld(true);
  const inverse = m.root.matrixWorld.clone().invert();
  const exterior = new T.Box3().setFromObject(m.root).applyMatrix4(inverse);
  const body = new T.Box3().setFromObject(m.interior).applyMatrix4(inverse);
  const roof = new T.Box3().setFromObject(m.roof).applyMatrix4(inverse);
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [768, 1024],
    [1024, 768],
    [844, 390],
    [960, 600],
    [1200, 600],
    [1800, 600],
    [600, 600],
  ]) {
    const aspect = width / height,
      vertical = Math.max(46, 65 / aspect);
    for (let degree = 0; degree < 360; degree += 15) {
      const yaw = (degree * Math.PI) / 180,
        offset = new T.Vector3(Math.sin(yaw) * 38, 35, Math.cos(yaw) * 38);
      const camera = new T.OrthographicCamera(
        (-vertical * aspect) / 2,
        (vertical * aspect) / 2,
        vertical / 2,
        -vertical / 2,
        0.1,
        180,
      );
      camera.position.copy(offset);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
      const outer = fitStudy(exterior, camera, aspect);
      camera.position.copy(outer.focus).add(offset);
      camera.lookAt(outer.focus);
      camera.zoom = outer.zoom;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      const ep = projection(exterior, camera);
      assert(
        ep.minX >= -1 && ep.maxX <= 1 && ep.minY >= -1 && ep.maxY <= 1,
        id + ' exterior is cropped.',
      );
      if (id === 'lius-gate') continue;
      const dock = roofDock(body, roof, camera, aspect);
      camera.position.copy(dock.focus).add(offset);
      camera.lookAt(dock.focus);
      camera.zoom = dock.zoom;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      const bp = projection(body, camera);
      assert(
        bp.minX >= -0.86 &&
          bp.maxX <= 0.86 &&
          bp.minY >= -0.86 &&
          bp.maxY <= 0.86,
        id + ' room is cropped.',
      );
      if (dock.visible) {
        const moved = new T.Box3(
          roof.min.clone().multiplyScalar(dock.scale),
          roof.max.clone().multiplyScalar(dock.scale),
        ).translate(dock.offset);
        const rp = projection(moved, camera);
        assert(
          rp.minX > bp.maxX,
          id +
            ' roof overlaps the room at ' +
            degree +
            '掳 in ' +
            width +
            '脳' +
            height,
        );
        assert(
          rp.maxX <= 1 && rp.minY >= -1 && rp.maxY <= 1,
          id + ' parked roof leaves frame.',
        );
        visibleRoofs++;
      } else assert(aspect < 1.25);
      poses++;
    }
  }
}
console.log(
  'Inspection checks passed: ' +
    poses +
    ' room/camera combinations, ' +
    visibleRoofs +
    ' visible roofs separated from the body; portrait, square, landscape and ultrawide framing.',
);
