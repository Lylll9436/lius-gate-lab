import {
  checkCurvedLandscape,
  checkShoreGeometry,
} from './check-curved-landscape.mjs';
import { checkLandscape } from './check-landscape.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as T from 'three';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'work', 'physics-check');
await fs.mkdir(output, { recursive: true });
await fs.copyFile(
  path.join(root, 'content/lab.json'),
  path.join(output, 'lab.json'),
);
const sources = new Map();
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
  let source = await fs.readFile(path.join(root, 'app', name + '.ts'), 'utf8');
  sources.set(name, source);
  if (name === 'city-scene') {
    // Preserve the original mesh primitives only in the second audit build.
    // Normal batching and collider generation are exercised by the first build.
    const batch = /function batch\(g:\s*T\.Group\)\s*\{/;
    assert(
      batch.test(source),
      'Update the mesh-preservation hook after changing batch().',
    );
    source =
      'export const physicsAudit = { preserveMeshes: false };\n' +
      source.replace(batch, '$& if (physicsAudit.preserveMeshes) return;');
  }
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    })
    .outputText.replace(/(['"])\.\/([\w-]+)\1/g, "'./$2.mjs'")
    .replace("'../content/lab.json'", "'./lab.json'")
    .replace(/(['"])\.\/(city-(?:data|motion|plan|scene))\1/g, "'./$2.mjs'");
  await fs.writeFile(path.join(output, name + '.mjs'), compiled);
}
const scene = await import(
  pathToFileURL(path.join(output, 'city-scene.mjs')).href
);
const motion = await import(
  pathToFileURL(path.join(output, 'city-motion.mjs')).href
);
const plan = await import(
  pathToFileURL(path.join(output, 'city-plan.mjs')).href
);
const ground = await import(
  pathToFileURL(path.join(output, 'city-ground.mjs')).href
);
const { buildings } = await import(
  pathToFileURL(path.join(output, 'city-data.mjs')).href
);
const { fitStudy, roofDock } = await import(
  pathToFileURL(path.join(output, 'city-inspection.mjs')).href
);
const {
  spacingRules,
  planarGap,
  terraceNeighbours,
  terraces,
  buildingDimensions,
} = await import(pathToFileURL(path.join(output, 'city-layout.mjs')).href);
const { animateResident } = await import(
  pathToFileURL(path.join(output, 'city-people.mjs')).href
);
const model = scene.buildCityModel();
scene.physicsAudit.preserveMeshes = true;
const audit = scene.buildCityModel();
assert.deepEqual(
  audit.colliders,
  model.colliders,
  'Auditing must not change production collision bodies.',
);
audit.city.updateMatrixWorld(true);
const [paving, plants, island, pathPlan, shore] = await Promise.all(
  [
    'city-paving',
    'city-planting-plan',
    'island-footprint',
    'city-path-plan',
    'city-shore',
  ].map((name) => import(pathToFileURL(path.join(output, name + '.mjs')).href)),
);
const landscapeReport = checkLandscape({
  ground,
  paving,
  plants,
  island,
  motion,
  model: audit,
});
await fs.writeFile(
  path.join(output, 'landscape-report.json'),
  JSON.stringify(landscapeReport, null, 2),
);
console.log(
  `Landscape: ${landscapeReport.paving.pieces} separate top pieces, ${landscapeReport.roadUnion.segments} union edges, ${landscapeReport.planting.pits} grounded tree pits, no internal ramp sides, one continuous expanded island.`,
);
const curveReport = checkCurvedLandscape({
  ground,
  pathPlan,
  motion,
  island,
  model: audit,
});
const shoreReport = checkShoreGeometry({ island, shore, motion, model: audit });
assert(curveReport.pass, JSON.stringify(curveReport.issues));
assert(shoreReport.pass, JSON.stringify(shoreReport.issues));
await fs.writeFile(
  path.join(output, 'curved-shore-report.json'),
  JSON.stringify({ curveReport, shoreReport }, null, 2),
);
console.log(
  'Curved paths and actual shore geometry: non-overlapping tops, supported walking routes, exposed sides, nested beach profile and safe boat clearance passed.',
);
const failures = new Map();
const notices = [];
const stats = {
  staticPairs: 0,
  broadOnly: 0,
  routePairs: 0,
  routeSegments: 0,
  laneRoutes: 0,
  laneSegments: 0,
  vehicleSamples: 0,
  boatSamples: 0,
  runtimeFrames: 0,
};
const fail = (key, message) => {
  if (!failures.has(key)) failures.set(key, message);
};
const pointText = (p) => `(${p.x.toFixed(3)}, ${p.z.toFixed(3)})`;

const rectOf = (body) => ({
  minX: body.min[0],
  maxX: body.max[0],
  minZ: body.min[2],
  maxZ: body.max[2],
});
const surfaceRect = (s) => ({
  minX: s.x - s.w / 2,
  maxX: s.x + s.w / 2,
  minZ: s.z - s.d / 2,
  maxZ: s.z + s.d / 2,
});
const built = audit.colliders.filter((b) => b.kind === 'building');
for (const [i, a] of built.entries()) {
  for (const b of built.slice(i + 1))
    if (
      !terraceNeighbours(a.id, b.id) &&
      planarGap(rectOf(a), rectOf(b)) < spacingRules.buildingGap - 1e-6
    )
      fail(
        'spacing:' + a.id + ':' + b.id,
        'Building gap too small: ' + a.id + ' / ' + b.id,
      );
  for (const [type, surfaces, minGap] of [
    ['asphalt', audit.roadSurfaces, spacingRules.asphaltSetback],
    ['pavement', audit.pavementSurfaces, spacingRules.pavementSetback],
  ])
    for (const [index, s] of surfaces.entries()) {
      if (s.accessTo === a.id) continue;
      const gap = planarGap(rectOf(a), surfaceRect(s));
      if (gap < minGap - 1e-6)
        fail(
          'setback:' + a.id + ':' + type + index,
          a.id +
            ' needs ' +
            minGap +
            ' clearance from ' +
            type +
            ' ' +
            index +
            ', got ' +
            gap.toFixed(3),
        );
    }
}

// Validate the rendered ground, not merely its planning rectangles.
const groundMeshes = [];
audit.city.children[0].traverse((mesh) => {
  if (mesh.isMesh && mesh.userData.surface) groundMeshes.push(mesh);
});
const { pavingPieces } = await import(
  pathToFileURL(path.join(output, 'city-paving.mjs')).href
);
assert.equal(groundMeshes.length, pavingPieces().length);
const groundRay = new T.Raycaster();
let groundSamples = 0;
for (const mesh of groundMeshes) {
  const surf = mesh.userData.surface;
  for (let ix = 0; ix < 5; ix++)
    for (let iz = 0; iz < 5; iz++) {
      const x = surf.x + surf.w * (ix / 4 - 0.5) * 0.998,
        z = surf.z + surf.d * (iz / 4 - 0.5) * 0.998;
      groundRay.set(new T.Vector3(x, 5, z), new T.Vector3(0, -1, 0));
      const hit = groundRay.intersectObject(mesh)[0];
      assert(hit, 'Missing physical ground surface: ' + surf.id);
      assert(
        Math.abs(hit.point.y - ground.elevation(surf, z, x)) < 0.001,
        'Ground query disagrees with the actual triangles: ' + surf.id,
      );
      groundSamples++;
    }
}
function overlapArea(a, b) {
  return (
    Math.max(
      0,
      Math.min(a.x + a.w / 2, b.x + b.w / 2) -
        Math.max(a.x - a.w / 2, b.x - b.w / 2),
    ) *
    Math.max(
      0,
      Math.min(a.z + a.d / 2, b.z + b.d / 2) -
        Math.max(a.z - a.d / 2, b.z - b.d / 2),
    )
  );
}
for (const [i, a] of ground.groundSurfaces.entries()) {
  assert(a.w > 0 && a.d > 0, 'Invalid paving extent.');
  for (const b of ground.groundSurfaces.slice(i + 1))
    assert(
      overlapArea(a, b) < 1e-7,
      'Overlapping exposed surfaces: ' + a.id + '/' + b.id,
    );
  if (a.kind !== 'bridge')
    assert(
      overlapArea(a, ground.river) < 1e-7,
      'Only the bridge may cover the river.',
    );
}
// Connections must work through marked crossings, never through arbitrary asphalt.
const pedestrianSurfaces = ground.groundSurfaces.filter(
  (s) => s.kind !== 'road',
);
for (const { x, z, width } of ground.crossings)
  pedestrianSurfaces.push({ x, z, w: width, d: 1.1 });
const linked = (a, b) => {
  const dx =
      Math.min(a.x + a.w / 2, b.x + b.w / 2) -
      Math.max(a.x - a.w / 2, b.x - b.w / 2),
    dz =
      Math.min(a.z + a.d / 2, b.z + b.d / 2) -
      Math.max(a.z - a.d / 2, b.z - b.d / 2);
  return dx >= -1e-7 && dz >= -1e-7 && (dx > 0.001 || dz > 0.001);
};
const connected = new Set([0]),
  queue = [0];
while (queue.length) {
  const i = queue.shift();
  pedestrianSurfaces.forEach((b, j) => {
    if (!connected.has(j) && linked(pedestrianSurfaces[i], b)) {
      connected.add(j);
      queue.push(j);
    }
  });
}
assert.equal(
  connected.size,
  pedestrianSurfaces.length,
  'A public path or entrance is disconnected.',
);
const supportMeshes = [];
audit.city.children[0].traverse((m) => {
  if (m.isMesh && m.userData.support) supportMeshes.push(m);
});
assert.equal(supportMeshes.length, ground.supportSurfaces.length);
for (const m of supportMeshes) {
  const s = m.userData.support,
    b = new T.Box3().setFromObject(m);
  assert(
    Math.abs(b.max.y - s.top) < 1e-6 && Math.abs(b.min.y - s.bottom) < 1e-6,
    'Support surface height differs from geometry.',
  );
}
const landOnly = audit.city.children[0];
for (const g of landOnly.children) {
  const info = g.userData.collider;
  if (!info || ['construction', 'railing'].includes(info.kind)) continue;
  const bounds = new T.Box3().setFromObject(g);
  const delta =
    bounds.min.y - ground.groundHeightAt(g.position.x, g.position.z);
  assert(
    delta <= 1e-5 && delta >= -(g.userData.grounding?.maxEmbed ?? 0) - 1e-5,
    'Floating or incorrectly embedded prop: ' + info.id,
  );
}
// Painted crossings must align with traffic, with a paired dropped kerb and no orphan paint.
const crossingPaint = [];
landOnly.traverse((o) => {
  if (o.isMesh && o.userData.crossing) crossingPaint.push(o);
});
assert.equal(crossingPaint.length, ground.crossings.length * 5);
for (const mark of crossingPaint) {
  const bounds = new T.Box3().setFromObject(mark),
    size = bounds.getSize(new T.Vector3()),
    center = bounds.getCenter(new T.Vector3());
  const crossing = ground.crossings.find(
    (c) => Math.abs(c.x - center.x) < 1e-6 && Math.abs(c.z - center.z) <= 0.45,
  );
  assert(
    crossing && size.x > size.z * 4,
    'Zebra bars must run parallel to the horizontal road, not the walking direction.',
  );
  assert(Math.abs(size.x - crossing.width) < 1e-5 && size.z < 0.13);
  for (const side of [-1, 1])
    assert(
      ground.groundSurfaces.some(
        (s) =>
          s.kind === 'ramp' &&
          Math.abs(s.x - crossing.x) < 0.001 &&
          Math.abs(s.z - (crossing.z + side * 0.73)) < 0.001,
      ),
    );
}
// A downward ray must reach open sea where the old southern island used to stand.
for (const x of [-19, -7, 7, 19]) {
  groundRay.set(new T.Vector3(x, 1, ground.river.z), new T.Vector3(0, -1, 0));
  const hit = groundRay.intersectObjects([landOnly, audit.water.mesh], true)[0];
  assert(
    hit && hit.object.material.userData.surfaceKind === 'water',
    'Soil or paving covers the river.',
  );
}
let gradeSamples = 0;
const gradeSegments = new Set();
for (const from of Object.keys(motion.pedestrianNodes))
  for (const to of Object.keys(motion.pedestrianNodes)) {
    if (from === to) continue;
    const route = motion.laneRoute(from, to, motion.pedestrianNodes[from]);
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1],
        b = route[i],
        key = [a.join(','), b.join(',')]
          .sort((a, b) => a.localeCompare(b))
          .join('|');
      if (gradeSegments.has(key)) continue;
      gradeSegments.add(key);
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 1e-8) continue;
      const count = Math.ceil(length / 0.002),
        step = length / count;
      let previous;
      for (let j = 0; j <= count; j++) {
        const x = a[0] + ((b[0] - a[0]) * j) / count,
          z = a[1] + ((b[1] - a[1]) * j) / count;
        const surface = ground.walkSurfaceAt(x, z);
        assert(surface, 'Pedestrian leaves the paved network.');
        const y = ground.groundHeightAt(x, z);
        if (previous !== undefined)
          assert(
            Math.abs(y - previous) <= step * 0.24 + 1e-7,
            'Abrupt grade change on ' + key,
          );
        previous = y;
        gradeSamples++;
      }
    }
  }
console.log(
  'Ground: ' +
    groundMeshes.length +
    ' disjoint surfaces; ' +
    groundSamples +
    ' actual mesh height samples; ' +
    gradeSamples +
    ' continuous route grades; connected entrances, marked crossings, supported props and open coastal water.',
);

// Common walls are a precise adjacency rule, never a blanket overlap exemption.
for (const row of terraces) {
  for (let i = 1; i < row.units.length; i++) {
    const left = audit.colliders.find((b) => b.id === row.units[i - 1]),
      right = audit.colliders.find((b) => b.id === row.units[i]);
    assert(
      terraceNeighbours(left.id, right.id) &&
        terraceNeighbours(right.id, left.id),
    );
    assert(
      Math.abs(left.max[0] - right.min[0]) < 1e-6,
      'Party-wall geometry must meet without crossing: ' + left.id,
    );
  }
}
let slateCount = 0,
  leafCount = 0;
audit.city.traverse((mesh) => {
  if (!mesh.isMesh) return;
  if (mesh.userData.tileCount) slateCount += mesh.userData.tileCount;
  if (mesh.userData.leafCount) leafCount += mesh.userData.leafCount;
});
assert(
  slateCount > 1500 && leafCount > 8000,
  'Detailed slate courses and leaves must remain real geometry.',
);
// Recesses must be real openings, before and after material batching.
for (const collection of [audit.models, model.models])
  for (const id of ['pengyuan-liu', 'yunlong-liu', 'qin-li']) {
    const building = buildings.find((b) => b.id === id),
      m = collection.get(id),
      d = buildingDimensions(building).depth;
    m.root.updateMatrixWorld(true);
    const ray = new T.Raycaster(
      new T.Vector3(
        m.root.position.x + 0.68,
        m.root.position.y + 1.11,
        m.root.position.z + d / 2 + 0.5,
      ),
      new T.Vector3(0, 0, -1),
    );
    const hit = ray.intersectObject(m.shell, true)[0];
    assert(
      hit && hit.object.material.userData.surfaceKind === 'glass',
      id + ': solid masonry blocks a window aperture.',
    );
    assert(
      hit.point.z < m.root.position.z + d / 2 - 0.035,
      id + ': glazing is pasted outside the facade.',
    );
  }
const families = new Map();
model.city.traverse((o) => {
  if (o.isMesh) families.set(o.material.userData.surfaceKind, o.material);
});
for (const kind of [
  'stone',
  'slate',
  'wood',
  'bark',
  'metal',
  'glass',
  'foliage',
  'paving',
  'grass',
  'water',
])
  assert(families.has(kind), 'Lost physical material: ' + kind);
assert(families.get('glass').roughness < families.get('stone').roughness);
assert(families.get('metal').metalness > 0.5);
assert(families.get('wood').map && families.get('wood').bumpMap);
assert(
  !families.get('bark').flatShading,
  'Curved bark must preserve smooth normals.',
);
// Leaf canopies are flexible; hard collision uses the real trunk/branches, with separate building clearance.
for (const group of audit.city.children[0].children) {
  if (group.userData.collider?.kind !== 'tree') continue;
  group.traverse((mesh) => {
    if (!mesh.userData.softFoliage) return;
    const canopy = new T.Box3().setFromObject(mesh);
    for (const b of built) {
      const bounds = new T.Box3(
        new T.Vector3(...b.min),
        new T.Vector3(...b.max),
      );
      assert(
        !canopy.intersectsBox(bounds),
        'A tree canopy occupies a building: ' +
          group.userData.collider.id +
          '/' +
          b.id,
      );
    }
  });
}
console.log(
  'Craft: ' +
    terraces.length +
    ' aligned terrace rows, ' +
    slateCount +
    ' individual slates, ' +
    leafCount +
    ' lobed leaves; party walls and tree/building clearances verified.',
);

const EPS = 1e-7;
// Check room fixtures independently of the exterior's solid wall volume.
// Tables and their objects are one fixture; separate furniture must leave clear floor space.
let fixtureCount = 0;
for (const [id, room] of audit.models) {
  if (id === 'lius-gate') continue;
  const building = buildings.find((b) => b.id === id);
  const w = buildingDimensions(building).innerWidth;
  const d = buildingDimensions(building).innerDepth;
  const inverse = room.interior.matrixWorld.clone().invert();
  const fixtures = room.interior.children
    .filter((child) => child.userData.fixture)
    .map((child) => ({
      id: child.userData.fixture,
      bounds: new T.Box3().setFromObject(child, true).applyMatrix4(inverse),
    }));
  assert(fixtures.length > 0, `${id} must contain furnishings.`);
  fixtureCount += fixtures.length;
  for (const fixture of fixtures) {
    const { min, max } = fixture.bounds;
    assert(
      min.x >= -w / 2 + 0.085 &&
        max.x <= w / 2 &&
        min.z >= -d / 2 + 0.085 &&
        max.z <= d / 2,
      `${id}/${fixture.id} extends outside its room.`,
    );
    assert(
      min.y >= 0.299 && min.y <= 0.34,
      `${id}/${fixture.id} must stand on the floor, got ${min.y}.`,
    );
  }
  for (let i = 0; i < fixtures.length; i++)
    for (let j = i + 1; j < fixtures.length; j++) {
      const a = fixtures[i],
        b = fixtures[j];
      assert(
        !['x', 'z'].every(
          (axis) =>
            a.bounds.min[axis] < b.bounds.max[axis] - EPS &&
            a.bounds.max[axis] > b.bounds.min[axis] + EPS,
        ),
        `${id}: furniture footprints overlap: ${a.id} / ${b.id}`,
      );
    }
}
assert.equal(audit.cranes.length, 3);
assert.equal(audit.jibs.length, 3);
for (const [i, jib] of audit.jibs.entries()) {
  const crane = audit.cranes[i];
  const site = audit.colliders.find(
    (body) => body.id === crane.userData.allowInside,
  );
  assert(site, 'Every crane must belong to a construction plot.');
  for (let step = 0; step <= 84; step++) {
    jib.rotation.y = -0.42 + step * 0.01;
    audit.city.updateMatrixWorld(true);
    const bounds = new T.Box3().setFromObject(jib);
    for (const [axis, index] of [
      ['x', 0],
      ['z', 2],
    ])
      assert(
        bounds.min[axis] >= site.min[index] &&
          bounds.max[axis] <= site.max[index],
        `Crane ${i} leaves its expansion plot while rotating.`,
      );
  }
  jib.rotation.y = 0;
}
audit.city.updateMatrixWorld(true);
const boxOf = (body) =>
  new T.Box3(new T.Vector3(...body.min), new T.Vector3(...body.max));
function intersects(a, b) {
  return ['x', 'y', 'z'].every(
    (axis) =>
      a.min[axis] < b.max[axis] - EPS && a.max[axis] > b.min[axis] + EPS,
  );
}

// Narrow phase uses each original primitive, not a whole building/tree/crane box.
// The convex SAT also excludes empty corners of roofs and faceted tree crowns.
function shapeOf(mesh) {
  const position = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.index;
  const vertices = Array.from({ length: position.count }, (_, i) =>
    new T.Vector3()
      .fromBufferAttribute(position, i)
      .applyMatrix4(mesh.matrixWorld),
  );
  const normals = [],
    edges = [];
  const uniqueAxis = (list, vector) => {
    if (vector.lengthSq() < EPS) return;
    vector.normalize();
    if (!list.some((axis) => Math.abs(axis.dot(vector)) > 1 - EPS))
      list.push(vector);
  };
  const count = index ? index.count : position.count;
  for (let i = 0; i < count; i += 3) {
    const [a, b, c] = [0, 1, 2].map(
      (n) => vertices[index ? index.getX(i + n) : i + n],
    );
    const ab = b.clone().sub(a),
      ac = c.clone().sub(a);
    uniqueAxis(normals, ab.clone().cross(ac));
    uniqueAxis(edges, ab);
    uniqueAxis(edges, ac);
    uniqueAxis(edges, c.clone().sub(b));
  }
  return {
    vertices,
    normals,
    edges,
    bounds: new T.Box3().setFromPoints(vertices),
  };
}
function overlapShapes(a, b) {
  if (!intersects(a.bounds, b.bounds)) return false;
  const separated = (axis) => {
    if (axis.lengthSq() < EPS) return false;
    axis.normalize();
    let amin = Infinity,
      amax = -Infinity,
      bmin = Infinity,
      bmax = -Infinity;
    for (const v of a.vertices) {
      const p = v.dot(axis);
      amin = Math.min(amin, p);
      amax = Math.max(amax, p);
    }
    for (const v of b.vertices) {
      const p = v.dot(axis);
      bmin = Math.min(bmin, p);
      bmax = Math.max(bmax, p);
    }
    return amax <= bmin + EPS || bmax <= amin + EPS;
  };
  for (const axis of [...a.normals, ...b.normals])
    if (separated(axis.clone())) return false;
  for (const edgeA of a.edges)
    for (const edgeB of b.edges)
      if (separated(edgeA.clone().cross(edgeB))) return false;
  return true;
}
function boxShape(bounds) {
  const vertices = [];
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z])
        vertices.push(new T.Vector3(x, y, z));
  const axes = [
    new T.Vector3(1, 0, 0),
    new T.Vector3(0, 1, 0),
    new T.Vector3(0, 0, 1),
  ];
  return { vertices, normals: axes, edges: axes, bounds };
}
const tagged = new Map();
audit.city.traverse((object) => {
  if (object.userData.collider) tagged.set(object.userData.collider.id, object);
});
const obstacles = model.colliders.map((body) => {
  const shapes = [];
  const object = tagged.get(body.id);
  if (object)
    object.traverse((mesh) => {
      if (mesh.isMesh && !mesh.userData.softFoliage) shapes.push(shapeOf(mesh));
    });
  else if (body.kind === 'gate') {
    audit.models.get('lius-gate').shell.traverse((mesh) => {
      if (mesh.isMesh) {
        const shape = shapeOf(mesh);
        if (intersects(boxOf(body), shape.bounds)) shapes.push(shape);
      }
    });
  }
  assert(shapes.length, `Collider ${body.id} must have original geometry.`);
  return { ...body, bounds: boxOf(body), shapes };
});
assert.equal(
  new Set(obstacles.map((o) => o.id)).size,
  obstacles.length,
  'Collider IDs must be unique.',
);
for (const obstacle of obstacles) {
  assert([...obstacle.min, ...obstacle.max].every(Number.isFinite));
  assert(!obstacle.bounds.isEmpty());
}
for (let i = 0; i < obstacles.length; i++)
  for (let j = i + 1; j < obstacles.length; j++) {
    const a = obstacles[i],
      b = obstacles[j];
    stats.staticPairs++;
    if (!intersects(a.bounds, b.bounds)) continue;
    if (a.allowInside === b.id || b.allowInside === a.id) continue;
    if (a.shapes.some((sa) => b.shapes.some((sb) => overlapShapes(sa, sb)))) {
      const overlap = a.bounds.clone().intersect(b.bounds);
      fail(
        `static:${a.id}:${b.id}`,
        `Static collision: ${a.id} / ${b.id}, overlap ${JSON.stringify([overlap.min.toArray(), overlap.max.toArray()])}`,
      );
    } else {
      stats.broadOnly++;
      notices.push(`Empty-space overlap excluded: ${a.id} / ${b.id}`);
    }
  }

function collisions(shape, category, description) {
  for (const obstacle of obstacles) {
    if (!intersects(shape.bounds, obstacle.bounds)) continue;
    if (obstacle.shapes.some((part) => overlapShapes(shape, part)))
      fail(
        `${category}:${obstacle.id}`,
        `${description} intersects ${obstacle.id}.`,
      );
  }
}
const nodeIds = Object.keys(motion.pedestrianNodes);
const checkedSegments = new Set();
for (const from of nodeIds)
  for (const to of nodeIds) {
    const route = motion.routeBetween(from, to);
    stats.routePairs++;
    assert.deepEqual(route[0], motion.pedestrianNodes[from]);
    assert.deepEqual(route.at(-1), motion.pedestrianNodes[to]);
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1],
        b = route[i];
      assert(
        [...a, ...b].every(Number.isFinite),
        'Route coordinates must be finite.',
      );
      const key = [a.join(','), b.join(',')]
        .sort((x, y) => x.localeCompare(y))
        .join('|');
      if (checkedSegments.has(key)) continue;
      checkedSegments.add(key);
      stats.routeSegments++;
      // A swept safety envelope covers every point between nodes, including turns.
      // .16 conservatively bounds the ambient person's complete rotated radius.
      const swept = new T.Box3(
        new T.Vector3(
          Math.min(a[0], b[0]) - 0.16,
          0.2,
          Math.min(a[1], b[1]) - 0.16,
        ),
        new T.Vector3(
          Math.max(a[0], b[0]) + 0.16,
          0.86,
          Math.max(a[1], b[1]) + 0.16,
        ),
      );
      collisions(
        boxShape(swept),
        `route:${key}`,
        `Pedestrian segment [${a}] 鈫?[${b}]`,
      );
    }
  }
for (const building of buildings)
  assert.deepEqual(
    plan.walkingRoute(building.id),
    motion.routeBetween('plaza', motion.visitNodes[building.id]),
  );
assert.equal(
  typeof motion.laneRoute,
  'function',
  'Ambient walkers need the tested directional lane routes.',
);
const laneSegments = new Set();
for (const from of nodeIds) {
  // Arrival at a node can be from any incoming lane, not just the center point.
  const starts = new Map([
    [motion.pedestrianNodes[from].join(','), motion.pedestrianNodes[from]],
  ]);
  for (const previous of nodeIds.filter((id) => id !== from)) {
    const end = motion
      .laneRoute(previous, from, motion.pedestrianNodes[previous])
      .at(-1);
    starts.set(end.join(','), end);
  }
  for (const to of nodeIds.filter((id) => id !== from))
    for (const start of starts.values()) {
      const route = motion.laneRoute(from, to, start);
      stats.laneRoutes++;
      assert.deepEqual(
        route[0],
        start,
        'Changing destination must retain the current physical position.',
      );
      assert(
        route.flat().every(Number.isFinite),
        'Offset lane route has invalid coordinates.',
      );
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1],
          b = route[i];
        const key = [a.join(','), b.join(',')]
          .sort((x, y) => x.localeCompare(y))
          .join('|');
        if (laneSegments.has(key)) continue;
        laneSegments.add(key);
        stats.laneSegments++;
        const swept = new T.Box3(
          new T.Vector3(
            Math.min(a[0], b[0]) - 0.11,
            0.2,
            Math.min(a[1], b[1]) - 0.11,
          ),
          new T.Vector3(
            Math.max(a[0], b[0]) + 0.11,
            0.86,
            Math.max(a[1], b[1]) + 0.11,
          ),
        );
        collisions(
          boxShape(swept),
          `lane:${key}`,
          `Offset pedestrian segment [${a}] 鈫?[${b}]`,
        );
      }
    }
}

function localBounds(object) {
  object.position.set(0, 0, 0);
  object.rotation.set(0, 0, 0);
  object.updateMatrixWorld(true);
  return new T.Box3().setFromObject(object);
}
function posedBox(local, pose, y) {
  const shape = boxShape(local);
  const rotation = new T.Matrix4().makeRotationY(pose.heading);
  shape.vertices = shape.vertices.map((v) =>
    v
      .clone()
      .applyMatrix4(rotation)
      .add(new T.Vector3(pose.x, y, pose.z)),
  );
  shape.normals = shape.normals.map((v) =>
    v.clone().transformDirection(rotation),
  );
  shape.edges = shape.normals;
  shape.bounds = new T.Box3().setFromPoints(shape.vertices);
  return shape;
}
function footprint(local, pose) {
  const cos = Math.cos(pose.heading),
    sin = Math.sin(pose.heading);
  return [
    [local.min.x, local.min.z],
    [local.max.x, local.min.z],
    [local.max.x, local.max.z],
    [local.min.x, local.max.z],
  ].map(([x, z]) => [pose.x + cos * x + sin * z, pose.z - sin * x + cos * z]);
}
function clip(polygon, axis, value, less) {
  const result = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    const ain = less ? a[axis] <= value : a[axis] >= value;
    const bin = less ? b[axis] <= value : b[axis] >= value;
    if (ain) result.push(a);
    if (ain !== bin) {
      const t = (value - a[axis]) / (b[axis] - a[axis]);
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return result;
}
function polygonArea(polygon) {
  return (
    Math.abs(
      polygon.reduce((sum, p, i) => {
        const q = polygon[(i + 1) % polygon.length];
        return sum + p[0] * q[1] - p[1] * q[0];
      }, 0),
    ) / 2
  );
}
function uncoveredArea(polygon, surfaces) {
  let remaining = [polygon];
  for (const s of surfaces) {
    const next = [];
    for (const poly of remaining) {
      let inside = poly;
      for (const [axis, value, less] of [
        [0, s.x - s.w / 2, false],
        [0, s.x + s.w / 2, true],
        [1, s.z - s.d / 2, false],
        [1, s.z + s.d / 2, true],
      ]) {
        const outside = clip(inside, axis, value, !less);
        if (outside.length >= 3 && polygonArea(outside) > EPS)
          next.push(outside);
        inside = clip(inside, axis, value, less);
        if (!inside.length) break;
      }
    }
    remaining = next;
    if (!remaining.length) return 0;
  }
  return remaining.reduce((sum, poly) => sum + polygonArea(poly), 0);
}
// Check real asphalt meshes agree with the surface registry used for containment.
const asphalt = [];
audit.city.children[0].traverse((mesh) => {
  if (mesh.isMesh && mesh.userData.surface?.kind === 'road') {
    const b = new T.Box3().setFromObject(mesh),
      size = b.getSize(new T.Vector3()),
      center = b.getCenter(new T.Vector3());
    asphalt.push({ x: center.x, z: center.z, w: size.x, d: size.z });
  }
});
assert.equal(
  asphalt.length,
  pavingPieces().filter((p) => p.kind === 'road').length,
  'Road registry must cover asphalt and flush drainage channels.',
);
for (const road of model.roadSurfaces)
  assert(
    Math.abs(
      asphalt.reduce((sum, p) => sum + overlapArea(p, road), 0) -
        road.w * road.d,
    ) < 1e-4,
    'Rendered asphalt and gutter union differs from road registry.',
  );
for (const piece of asphalt)
  assert(
    Math.abs(
      model.roadSurfaces.reduce((sum, p) => sum + overlapArea(p, piece), 0) -
        piece.w * piece.d,
    ) < 1e-4,
    'Rendered road finish leaves the traffic envelope.',
  );
const vehicleBounds = localBounds(audit.tram),
  boatBounds = localBounds(audit.ferry);
const walkerGeometry = audit.walkers.map((walker) => {
  const bounds = localBounds(walker),
    parts = [];
  walker.traverse((mesh) => {
    if (mesh.isMesh) parts.push(shapeOf(mesh).bounds);
  });
  return { bounds, parts };
});
const loop = motion.vehicleLoop(),
  loopLength = motion.lengthOf(loop);
assert.deepEqual(
  loop[0],
  loop.at(-1),
  'Vehicle route must close without teleporting.',
);
const vehicleDistances = new Set([0, loopLength]);
for (let distance = 0; distance < loopLength; distance += 0.025)
  vehicleDistances.add(distance);
let vertexDistance = 0;
for (let i = 1; i < loop.length; i++) {
  vertexDistance += Math.hypot(
    loop[i][0] - loop[i - 1][0],
    loop[i][1] - loop[i - 1][1],
  );
  for (const offset of [-1e-6, 0, 1e-6])
    vehicleDistances.add(
      Math.max(0, Math.min(loopLength, vertexDistance + offset)),
    );
}
for (const distance of [...vehicleDistances].sort((a, b) => a - b)) {
  const p = motion.samplePath(loop, distance),
    pose = { ...p, heading: p.heading - Math.PI / 2 };
  stats.vehicleSamples++;
  const area = uncoveredArea(footprint(vehicleBounds, pose), asphalt);
  if (area > 1e-5)
    fail(
      'vehicle:surface',
      `Vehicle footprint leaves asphalt at ${pointText(p)}; uncovered area ${area.toFixed(5)}.`,
    );
  collisions(
    posedBox(vehicleBounds, pose, ground.grades.road),
    'vehicle',
    `Vehicle at ${pointText(p)}`,
  );
  const next = motion.samplePath(loop, (distance + 0.001) % loopLength);
  if (Math.hypot(next.x - p.x, next.z - p.z) > 0.00101)
    fail(
      'vehicle:continuity',
      `Vehicle position jumps near route distance ${distance}.`,
    );
  if (Math.abs(motion.shortestAngle(p.heading, next.heading)) > 0.14)
    fail(
      'vehicle:turn',
      `Vehicle heading jumps near route distance ${distance}.`,
    );
}

const waterMeshes = [];
audit.city.traverse((mesh) => {
  if (mesh.isMesh && mesh.material.userData.surfaceKind === 'water')
    waterMeshes.push(mesh);
});
assert.equal(
  waterMeshes.length,
  1,
  'The river must have one identifiable water surface.',
);
const waterBounds = new T.Box3().setFromObject(waterMeshes[0]);
const water = [ground.river];
const pierShapes = [];
audit.city.children[0].traverse((mesh) => {
  if (mesh.isMesh && mesh.material.color?.getHexString() === 'b0946b')
    pierShapes.push(shapeOf(mesh));
});
assert.equal(
  ground.groundSurfaces.filter((s) => s.kind === 'bridge').length,
  0,
  'The removed bridge must not survive in the physical plan.',
);
// More than two laps of the ellipse (2蟺/.12); also catches the old 28s reversal.
for (let time = 0; time <= 120; time += 1 / 120) {
  stats.boatSamples++;
  const pose = motion.boatPose(time),
    next = motion.boatPose(time + 0.001);
  assert(Object.values(pose).every(Number.isFinite));
  if (uncoveredArea(footprint(boatBounds, pose), water) > 1e-5)
    fail(
      'boat:surface',
      `Boat footprint leaves water at t=${time.toFixed(3)}, ${pointText(pose)}.`,
    );
  const shape = posedBox(boatBounds, pose, pose.y);
  assert(
    shape.bounds.min.y < waterBounds.max.y,
    'Boat hull must sit in the water, not hover above it.',
  );
  collisions(shape, 'boat', `Boat at t=${time.toFixed(3)}, ${pointText(pose)}`);
  if (pierShapes.some((pier) => overlapShapes(shape, pier)))
    fail('boat:pier', `Boat intersects pier decking at t=${time.toFixed(3)}.`);
  const dx = next.x - pose.x,
    dz = next.z - pose.z,
    distance = Math.hypot(dx, dz);
  if (distance > 0.0007)
    fail('boat:continuity', `Boat position jumps at t=${time.toFixed(3)}.`);
  if (Math.abs(motion.shortestAngle(pose.heading, next.heading)) > 0.003)
    fail('boat:heading', `Boat heading jumps at t=${time.toFixed(3)}.`);
  if (
    distance > 1e-7 &&
    (Math.cos(pose.heading) * dx - Math.sin(pose.heading) * dz) / distance <
      0.98
  )
    fail(
      'boat:direction',
      `Boat bow does not face its travel direction at t=${time.toFixed(3)}.`,
    );
}

for (let i = 0; i < 5; i++) {
  const walker = motion.makeWalker(i);
  for (let frame = 0; frame < 36000; frame++) {
    const before = structuredClone(walker);
    motion.stepWalker(walker, 1 / 60, frame % 313 === 0);
    if (frame % 313 === 0)
      assert.deepEqual(
        walker,
        before,
        'Paused walker state must be unchanged.',
      );
    else {
      assert(
        Math.hypot(walker.x - before.x, walker.z - before.z) <=
          walker.speed / 60 + EPS,
        'Walker teleported between destinations.',
      );
      assert(
        Math.abs(motion.shortestAngle(before.heading, walker.heading)) <=
          (Math.PI * 7) / 60 + EPS,
        'Walker turned discontinuously.',
      );
    }
  }
}

// Execute the actual production frame body without a WebGL/browser dependency.
// This tests pause/yield integration, not a copied version of its animation logic.
const syntax = ts.createSourceFile(
  'city-scene.ts',
  sources.get('city-scene'),
  ts.ScriptTarget.Latest,
  true,
);
let frameSource, enterSource;
function findFrame(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'frame')
    frameSource = node.getText(syntax);
  if (ts.isMethodDeclaration(node) && node.name?.getText(syntax) === 'enter')
    enterSource = node.getText(syntax);
  ts.forEachChild(node, findFrame);
}
findFrame(syntax);
assert(frameSource, 'Could not find the production frame function.');
const frameJs = ts.transpileModule(frameSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const harness = {
  T,
  ...motion,
  ...ground,
  disposed: false,
  requestAnimationFrame: () => 1,
  raf: 0,
  last: 950,
  document: { hidden: false },
  inViewport: true,
  reduced: false,
  paused: false,
  time: 0,
  targetYaw: 0,
  yaw: 0,
  align() {},
  tween: false,
  controls: { update() {}, target: new T.Vector3() },
  target: new T.Vector3(),
  targetZoom: 1,
  camera: new T.OrthographicCamera(),
  night: 0,
  targetNight: 0,
  sky: { intensity: 2.4 },
  sun: { intensity: 2.7, color: new T.Color() },
  lamps: [],
  inspect: null,
  openAmount: 0,
  walkerStates: audit.walkers.map((_, i) => motion.makeWalker(i)),
  walkers: audit.walkers,
  loop,
  loopLength,
  trafficDistance: 1,
  tram: audit.tram,
  ferry: audit.ferry,
  jibs: audit.jibs,
  fitStudy,
  roofDock,
  inspectionAutoFit: true,
  puffs: [],
  smokeEmitters: [],
  labels: [],
  updateHover: () => {},
  ink: { render() {}, setSelection() {} },
  focusedIds: [],
  parkSelected: false,
  details: { update() {}, ensure() {} },
  animateResident,
  model: audit,
  lighting: { update() {} },
  inspectionMaterials: [],
  renderer: { render() {} },
  scene: audit.city,
  width: 1,
  height: 1,
  projected: new T.Vector3(),
};
const runFrame = runInNewContext(`${frameJs}; frame;`, harness);
for (let i = 0; i < 100; i++) runFrame(1000 + i * 16);
const snapshot = () =>
  JSON.stringify({
    time: harness.time,
    traffic: harness.trafficDistance,
    states: harness.walkerStates,
    transforms: [
      ...harness.walkers,
      harness.tram,
      harness.ferry,
      ...harness.jibs,
    ].map((o) => [o.position.toArray(), o.rotation.toArray()]),
  });
harness.paused = true;
const frozen = snapshot();
for (let i = 100; i < 110; i++) runFrame(1000 + i * 16);
if (snapshot() !== frozen)
  fail(
    'runtime:pause',
    'Production frame moves an actor/state while paused (includes cranes and pedestrian bob height).',
  );
harness.paused = false;
const pedestrianContacts = new Map();
const pedestrianProgress = harness.walkers.map((walker) => ({
  previous: walker.position.clone(),
  totalDistance: 0,
  finalMinuteDistance: 0,
  stationarySeconds: 0,
  longestStopSeconds: 0,
  destinations: new Set(),
}));
function currentSegment(walker) {
  let remaining = walker.distance;
  for (let i = 1; i < walker.path.length; i++) {
    const a = walker.path[i - 1],
      b = walker.path[i];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (remaining <= length + EPS || i === walker.path.length - 1)
      return [a.join(','), b.join(',')]
        .sort((x, y) => x.localeCompare(y))
        .join(' 鈫?');
    remaining -= length;
  }
  return `waiting at ${walker.at}`;
}
for (let i = 110; i < 20110; i++) {
  runFrame(1000 + i * 16);
  stats.runtimeFrames++;
  assert(
    Math.abs(
      harness.tram.position.y + vehicleBounds.min.y - ground.grades.road,
    ) < 1e-6,
    'Vehicle wheels must sit on asphalt.',
  );
  harness.walkers.forEach((person) => {
    person.updateMatrixWorld(true);
    const feet = Math.min(
      ...['leg-left', 'leg-right'].map(
        (name) =>
          new T.Box3().setFromObject(
            person.getObjectByName(name).getObjectByName('shoe'),
            true,
          ).min.y,
      ),
    );
    const floor = ground.groundHeightAt(person.position.x, person.position.z);
    assert(
      feet >= floor - 0.002 && feet <= floor + 0.007,
      'Walker feet must follow the current surface height.',
    );
  });
  const vehicleShape = posedBox(
    vehicleBounds,
    {
      x: harness.tram.position.x,
      z: harness.tram.position.z,
      heading: harness.tram.rotation.y,
    },
    harness.tram.position.y,
  );
  const personPoses = harness.walkers.map((person) => ({
    x: person.position.x,
    z: person.position.z,
    heading: person.rotation.y,
  }));
  const partCache = [];
  const personParts = (index) =>
    (partCache[index] ??= walkerGeometry[index].parts.map((part) =>
      posedBox(part, personPoses[index], harness.walkers[index].position.y),
    ));
  for (let w = 0; w < harness.walkers.length; w++) {
    const person = harness.walkers[w];
    const body = boxShape(
      new T.Box3(
        new T.Vector3(person.position.x - 0.11, 0.2, person.position.z - 0.11),
        new T.Vector3(person.position.x + 0.11, 0.86, person.position.z + 0.11),
      ),
    );
    if (overlapShapes(vehicleShape, body))
      fail(
        `runtime:yield:${w}`,
        `Vehicle fails to yield to walker ${w} at ${pointText(person.position)}.`,
      );
    const actualBody = posedBox(
      walkerGeometry[w].bounds,
      personPoses[w],
      person.position.y,
    );
    for (const obstacle of obstacles) {
      if (!intersects(actualBody.bounds, obstacle.bounds)) continue;
      if (
        personParts(w).some((part) =>
          obstacle.shapes.some((other) => overlapShapes(part, other)),
        )
      )
        fail(
          `runtime:walker-static:${w}:${obstacle.id}`,
          `Walker ${w} intersects ${obstacle.id} at t=${harness.time.toFixed(3)}, ${pointText(person.position)}.`,
        );
    }
    const progress = pedestrianProgress[w];
    const distance = Math.hypot(
      person.position.x - progress.previous.x,
      person.position.z - progress.previous.z,
    );
    progress.totalDistance += distance;
    if (i >= 20110 - 3750) progress.finalMinuteDistance += distance;
    progress.stationarySeconds =
      distance < 1e-6 ? progress.stationarySeconds + 0.016 : 0;
    progress.longestStopSeconds = Math.max(
      progress.longestStopSeconds,
      progress.stationarySeconds,
    );
    progress.previous.copy(person.position);
    progress.destinations.add(harness.walkerStates[w].at);
  }
  for (let a = 0; a < harness.walkers.length; a++)
    for (let b = a + 1; b < harness.walkers.length; b++) {
      const first = harness.walkers[a],
        second = harness.walkers[b];
      const key = `${a}/${b}`;
      if (
        Math.hypot(
          first.position.x - second.position.x,
          first.position.z - second.position.z,
        ) > 0.23
      )
        continue;
      const firstPose = personPoses[a],
        secondPose = personPoses[b];
      if (
        !overlapShapes(
          posedBox(walkerGeometry[a].bounds, firstPose, first.position.y),
          posedBox(walkerGeometry[b].bounds, secondPose, second.position.y),
        )
      )
        continue;
      // Torso, head, hat and both legs stay separate; this uses their real dimensions
      // and current headings/bob heights, not inflated crowd-avoidance radii.
      const firstParts = personParts(a),
        secondParts = personParts(b);
      if (
        !firstParts.some((part) =>
          secondParts.some((other) => overlapShapes(part, other)),
        )
      )
        continue;
      let contact = pedestrianContacts.get(key);
      if (!contact) {
        contact = {
          pair: key,
          episodes: 0,
          frames: 0,
          lastFrame: -2,
          firstTime: harness.time,
          firstPosition: [first.position.x, first.position.z],
          segments: new Map(),
        };
        pedestrianContacts.set(key, contact);
      }
      if (contact.lastFrame !== i - 1) contact.episodes++;
      contact.frames++;
      contact.lastFrame = i;
      const segment = `${currentSegment(harness.walkerStates[a])} / ${currentSegment(harness.walkerStates[b])}`;
      contact.segments.set(segment, (contact.segments.get(segment) ?? 0) + 1);
    }
}
const pedestrianContactReport = [...pedestrianContacts.values()].map(
  (contact) => ({
    pair: contact.pair,
    episodes: contact.episodes,
    frames: contact.frames,
    overlapSeconds: Number((contact.frames * 0.016).toFixed(3)),
    percentOfFrames: Number(
      ((contact.frames / stats.runtimeFrames) * 100).toFixed(3),
    ),
    firstTime: Number(contact.firstTime.toFixed(3)),
    firstPosition: contact.firstPosition.map((n) => Number(n.toFixed(3))),
    segments: [...contact.segments].map(([segment, frames]) => ({
      segment,
      overlapSeconds: Number((frames * 0.016).toFixed(3)),
    })),
  }),
);
for (const contact of pedestrianContactReport)
  fail(
    `runtime:pedestrians:${contact.pair}`,
    `Pedestrians ${contact.pair} overlap: ${contact.episodes} episode(s), ${contact.overlapSeconds}s / 320s (${contact.percentOfFrames}%); first at t=${contact.firstTime}, [${contact.firstPosition}].`,
  );
const pedestrianProgressReport = pedestrianProgress.map((progress, index) => ({
  walker: index,
  totalDistance: Number(progress.totalDistance.toFixed(3)),
  finalMinuteDistance: Number(progress.finalMinuteDistance.toFixed(3)),
  longestStopSeconds: Number(progress.longestStopSeconds.toFixed(3)),
  destinationsVisited: progress.destinations.size,
}));
for (const progress of pedestrianProgressReport) {
  if (progress.finalMinuteDistance < 0.5 || progress.destinationsVisited < 2)
    fail(
      `runtime:deadlock:${progress.walker}`,
      `Walker ${progress.walker} may be stuck: moved ${progress.finalMinuteDistance} in the final 60s, visited ${progress.destinationsVisited} destinations.`,
    );
  if (progress.longestStopSeconds > 30)
    fail(
      `runtime:long-stop:${progress.walker}`,
      `Walker ${progress.walker} remained stationary for ${progress.longestStopSeconds}s.`,
    );
}

// Exercise the current inspection entry and frame code with real cloned materials.
// No rendering claim: these are clipping-plane, isolation and transform checks.
assert(enterSource, 'Could not find the production enter() method.');
Object.assign(harness, {
  buildings,
  CELL: plan.CELL,
  models: audit.models,
  city: audit.city,
  scene: new T.Scene(),
  smoke: new T.Group(),
  zones: new T.Group(),
  grid: new T.Group(),
  highlight: new T.Group(),
  sectionPlane: new T.Plane(new T.Vector3(0, -1, 0), 100),
  inspectionMaterials: [],
  inspectId: null,
  interior: false,
  paused: true,
  shadowFocus(center, radius) {
    assert(center.toArray().every(Number.isFinite));
    assert(
      radius >= 7 && radius < 27,
      'Detail shadows should use a tighter frustum than the whole city.',
    );
  },
  exitInspection() {
    if (harness.inspect) harness.scene.remove(harness.inspect);
    harness.inspectionMaterials.forEach((material) => material.dispose());
    harness.inspectionMaterials.length = 0;
    harness.inspect = null;
    harness.openAmount = 0;
    harness.interior = false;
  },
});
harness.scene.add(audit.city);
const enterJs = ts.transpileModule(
  `const inspectionMethods = { ${enterSource} };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
const enter = runInNewContext(`${enterJs}; inspectionMethods.enter;`, harness);
const materialsIn = (group) => {
  const materials = [];
  group.traverse((object) => {
    if (object.isMesh)
      materials.push(
        ...(Array.isArray(object.material)
          ? object.material
          : [object.material]),
      );
  });
  return materials;
};
let inspectionClock = harness.last;
for (const building of buildings) {
  const original = audit.models.get(building.id),
    sourceMaterials = materialsIn(original.shell);
  const originalRoof = original.roof.position.clone();
  enter(building.id);
  assert.equal(
    harness.sectionPlane.constant,
    100,
    'Each inspection must start with its shell visible.',
  );
  if (building.id !== 'lius-gate') {
    for (const material of materialsIn(harness.inspect.children[1])) {
      assert(
        !sourceMaterials.includes(material),
        'Clipping a detail view must not alter city materials.',
      );
      assert.equal(
        material.clippingPlanes?.[0],
        harness.sectionPlane,
        'Detail shell needs the inspection clipping plane.',
      );
      assert.equal(
        material.clipShadows,
        true,
        'Clipped walls must not leave full-wall shadows.',
      );
    }
    harness.interior = true;
    let previous = 0;
    for (let frame = 0; frame < 600; frame++) {
      runFrame((inspectionClock += 16));
      assert(
        harness.openAmount >= previous && harness.openAmount <= 1,
        'Section opening must move monotonically.',
      );
      previous = harness.openAmount;
      assert(Number.isFinite(harness.sectionPlane.constant));
    }
    assert(
      Math.abs(harness.sectionPlane.constant - 0.32) < 0.001,
      'Section plane must settle at the low wall cut.',
    );
    assert(
      harness.inspect.children[2].scale.x < 0.5,
      'Detached roof should become a compact study component.',
    );
    assert(
      materialsIn(harness.inspect.children[0]).every(
        (material) => !material.clippingPlanes?.includes(harness.sectionPlane),
      ),
      'Interior furniture must survive the facade cut.',
    );
  }
  assert(
    original.roof.position.equals(originalRoof),
    'Inspection must not move the overview roof.',
  );
  assert(
    sourceMaterials.every(
      (material) => !material.clippingPlanes?.includes(harness.sectionPlane),
    ),
    'Overview must remain unclipped.',
  );
}
harness.exitInspection();

const report = {
  passed: failures.size === 0,
  colliderCount: obstacles.length,
  roomFixtures: fixtureCount,
  craneRotationSamples: 255,
  ...stats,
  notices,
  pedestrianContacts: pedestrianContactReport,
  pedestrianProgress: pedestrianProgressReport,
  failures: [...failures.values()],
};
await fs.writeFile(
  path.join(output, 'report.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  `Interiors: ${fixtureCount} fixtures inside six rooms without overlapping furniture footprints; 255 crane rotation poses stay inside expansion plots.`,
);
console.log(
  `Physics: ${obstacles.length} real colliders; ${stats.staticPairs} static pairs; ${stats.routePairs} node routes / ${stats.routeSegments} swept segments; ${stats.laneRoutes} offset routes / ${stats.laneSegments} swept segments; ${stats.vehicleSamples} vehicle poses; ${stats.boatSamples} boat poses; ${stats.runtimeFrames} production animation frames.`,
);
for (const notice of notices) console.log(`NOTE ${notice}`);
for (const failure of failures.values()) console.error(`FAIL ${failure}`);
console.log(
  failures.size
    ? `Physics checks failed: ${failures.size} issue(s). Details: work/physics-check/report.json`
    : 'Physics checks passed.',
);
if (failures.size) process.exitCode = 1;
