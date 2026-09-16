import * as T from 'three';
import assert from 'node:assert/strict';

// Physical regression checks, called by check-physics with the real unbatched scene.
export function checkLandscape({ ground, paving, plants, island, model }) {
  const issues = [],
    notes = [];
  const check = (condition, message, data) => {
    if (!condition) issues.push({ message, data });
  };
  const area = (r) => r.w * r.d,
    overlap = (a, b) =>
      Math.max(
        0,
        Math.min(a.x + a.w / 2, b.x + b.w / 2) -
          Math.max(a.x - a.w / 2, b.x - b.w / 2),
      ) *
      Math.max(
        0,
        Math.min(a.z + a.d / 2, b.z + b.d / 2) -
          Math.max(a.z - a.d / 2, b.z - b.d / 2),
      );
  const inside = (r, x, z, tol = 0) =>
    Math.abs(x - r.x) < r.w / 2 + tol && Math.abs(z - r.z) < r.d / 2 + tol;
  const roads = ground.groundSurfaces.filter((s) => s.kind === 'road'),
    pieces = paving.pavingPieces();
  let maxOverlap = 0,
    overlapCount = 0,
    pitOverlap = 0,
    pitExpected = 0;
  for (let i = 0; i < pieces.length; i++)
    for (let j = i + 1; j < pieces.length; j++) {
      const a = overlap(pieces[i], pieces[j]);
      maxOverlap = Math.max(maxOverlap, a);
      if (a > 1e-7) overlapCount++;
    }
  for (let i = 0; i < plants.treePits.length; i++)
    for (let j = i + 1; j < plants.treePits.length; j++)
      check(
        overlap(plants.treePits[i], plants.treePits[j]) < 1e-7,
        'Tree pits overlap',
        { i, j },
      );
  for (const pit of plants.treePits) {
    for (const s of ground.groundSurfaces) pitExpected += overlap(pit, s);
    for (const p of pieces) pitOverlap += overlap(pit, p);
  }
  const expectedArea =
      ground.groundSurfaces.reduce((s, p) => s + area(p), 0) - pitExpected,
    actualArea = pieces.reduce((s, p) => s + area(p), 0);
  check(overlapCount === 0, 'Paving top pieces overlap', {
    overlapCount,
    maxOverlap,
  });
  check(pitOverlap < 1e-7, 'Paving covers tree pits', pitOverlap);
  check(
    Math.abs(expectedArea - actualArea) < 1e-6,
    'Top union area is not conserved',
    { expectedArea, actualArea },
  );
  // Extract the road union from an independent occupancy grid, not outsideEdges().
  const uniq = (a) =>
      [...new Set(a.map((x) => Math.round(x * 1e7) / 1e7))].sort(
        (a, b) => a - b,
      ),
    xs = uniq(roads.flatMap((r) => [r.x - r.w / 2, r.x + r.w / 2])),
    zs = uniq(roads.flatMap((r) => [r.z - r.d / 2, r.z + r.d / 2]));
  const cells = xs
    .slice(1)
    .map((x, i) =>
      zs
        .slice(1)
        .map((z, j) =>
          roads.some((r) => inside(r, (xs[i] + x) / 2, (zs[j] + z) / 2)),
        ),
    );
  let independentLength = 0;
  for (let i = 0; i < xs.length - 1; i++)
    for (let j = 0; j < zs.length - 1; j++)
      if (cells[i][j]) {
        if (!cells[i - 1]?.[j]) independentLength += zs[j + 1] - zs[j];
        if (!cells[i + 1]?.[j]) independentLength += zs[j + 1] - zs[j];
        if (!cells[i]?.[j - 1]) independentLength += xs[i + 1] - xs[i];
        if (!cells[i]?.[j + 1]) independentLength += xs[i + 1] - xs[i];
      }
  const boundaryLength = paving.roadBoundary.reduce(
      (s, e) => s + e.end - e.start,
      0,
    ),
    boundaryBad = [];
  for (const e of paving.roadBoundary)
    for (const t of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const v = e.start + (e.end - e.start) * t;
      const q = (n) =>
        e.axis === 'x'
          ? [v, e.fixed + n * e.normal * 1e-5]
          : [e.fixed + n * e.normal * 1e-5, v];
      if (
        !roads.some((r) => inside(r, ...q(-1), 1e-8)) ||
        roads.some((r) => inside(r, ...q(1), 1e-8))
      )
        boundaryBad.push(e);
    }
  check(
    Math.abs(boundaryLength - independentLength) < 1e-6 &&
      boundaryBad.length === 0,
    'Road boundary differs from true union',
    { boundaryLength, independentLength, boundaryBad },
  );
  const group = model.city.children[0];
  const top = group.children.filter((o) => o.userData.surface);
  let triangleArea = 0,
    topBad = 0,
    topDown = 0;
  for (const m of top) {
    const s = m.userData.surface,
      p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      const [a, b, c] = [0, 1, 2].map((j) =>
          new T.Vector3().fromBufferAttribute(p, i + j),
        ),
        n = b.clone().sub(a).cross(c.clone().sub(a));
      triangleArea += Math.abs(n.y) / 2;
      if (n.y <= 0) topDown++;
      for (const v of [a, b, c])
        if (Math.abs(v.y - ground.elevation(s, v.z, v.x)) > 2e-6) topBad++;
    }
  }
  check(
    top.length === pieces.length &&
      Math.abs(triangleArea - actualArea) < 0.0002 &&
      topBad === 0 &&
      topDown === 0,
    'Actual top mesh conservation or normals fail',
    {
      topMeshes: top.length,
      pieces: pieces.length,
      triangleArea,
      actualArea,
      topBad,
      topDown,
    },
  );
  const actualHeight = (x, z) => {
    const p = pieces.find((p) => inside(p, x, z));
    return p ? ground.elevation(p, z, x) : ground.groundHeightAt(x, z);
  };
  const skirtBad = [],
    skirtStats = {
      triangles: 0,
      degenerate: 0,
      internal: 0,
      outsideEnvelope: 0,
    };
  for (const name of ['pavement-bedding-course', 'exposed-paving-courses']) {
    const m = group.getObjectByName(name);
    if (!m) continue;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      const [a, b, c] = [0, 1, 2].map((j) =>
          new T.Vector3().fromBufferAttribute(p, i + j),
        ),
        n = b.clone().sub(a).cross(c.clone().sub(a));
      if (n.length() < 1e-9) {
        skirtStats.degenerate++;
        continue;
      }
      skirtStats.triangles++;
      const q = a.clone().add(b).add(c).divideScalar(3),
        v = n.clone().normalize().multiplyScalar(0.00003),
        h1 = actualHeight(q.x + v.x, q.z + v.z),
        h2 = actualHeight(q.x - v.x, q.z - v.z),
        lo = Math.min(h1, h2),
        hi = Math.max(h1, h2);
      const internal = hi - lo < 1e-5,
        outside = q.y < lo - 0.00003 || q.y > hi + 0.00003;
      if (internal) skirtStats.internal++;
      if (outside) skirtStats.outsideEnvelope++;
      if (internal || outside)
        skirtBad.push({
          name,
          triangle: i / 3,
          q: q.toArray(),
          h1,
          h2,
          internal,
          outside,
        });
    }
  }
  check(
    skirtStats.degenerate === 0,
    'Zero-area skirt triangles remain',
    skirtStats,
  );
  check(
    skirtBad.length === 0,
    'Skirt triangles occur inside equal-height paving or outside the exposed height interval',
    skirtBad.slice(0, 12),
  );
  const land = model.city.children[0];
  let soilMatched = 0,
    treesMatched = 0;
  const pitDetails = [];
  for (const pit of plants.treePits) {
    const g = land.getObjectByName(pit.id),
      soil = g?.children.find((o) => o.userData.plantingSoil === pit.id),
      tree = land.children.find(
        (o) => o.userData.collider?.id === pit.id.slice(4),
      );
    const soilBounds = soil ? new T.Box3().setFromObject(soil) : null,
      treeBounds = tree ? new T.Box3().setFromObject(tree) : null;
    const expected = ground.groundHeightAt(pit.x, pit.z);
    const soilOk =
      soilBounds &&
      Math.abs(soilBounds.max.y - expected) < 1e-6 &&
      Math.abs((soilBounds.min.x + soilBounds.max.x) / 2 - pit.x) < 1e-6 &&
      Math.abs((soilBounds.min.z + soilBounds.max.z) / 2 - pit.z) < 1e-6;
    const treeOk =
      treeBounds &&
      Math.abs(tree.position.x - pit.x) < 1e-6 &&
      Math.abs(tree.position.z - pit.z) < 1e-6 &&
      Math.abs(treeBounds.min.y - expected) < 1e-6;
    if (soilOk) soilMatched++;
    if (treeOk) treesMatched++;
    check(soilOk && treeOk, 'Tree pit soil/tree anchor mismatch', {
      pit: pit.id,
      expected,
      soilTop: soilBounds?.max.y,
      treeBottom: treeBounds?.min.y,
    });
    pitDetails.push({
      id: pit.id,
      soil: expected,
      base: ground.baseGroundHeightAt(pit.x, pit.z),
    });
  }
  check(island.islandBanks.length === 1, 'The town must remain one island.');
  const result = {
    pass: issues.length === 0,
    roadUnion: {
      rectangles: roads.length,
      segments: paving.roadBoundary.length,
      perimeter: boundaryLength,
      independentLength,
    },
    paving: {
      pieces: pieces.length,
      byFinish: Object.fromEntries(
        ['asphalt', 'gutter', 'kerb', 'paving'].map((f) => [
          f,
          {
            count: pieces.filter((p) => p.finish === f).length,
            area: pieces
              .filter((p) => p.finish === f)
              .reduce((s, p) => s + area(p), 0),
          },
        ]),
      ),
      overlapCount,
      maxOverlap,
      pitCutArea: pitExpected,
      expectedArea,
      actualArea,
      actualTriangleArea: triangleArea,
      topBad,
      topDown,
    },
    skirts: skirtStats,
    planting: {
      pits: plants.treePits.length,
      soilMatched,
      treesMatched,
      soilHeights: uniq(pitDetails.map((p) => p.soil)),
      wildTrees: plants.wildTrees.length,
    },
    southernLand: {
      banks: island.islandBanks.length,
      vertices: island.islandOutline.length,
    },
  };
  for (const row of plants.avenueRows) {
    const gaps = row.positions
      .slice(1)
      .map(
        (p, i) => (p - row.positions[i]) * plants.landscapeScale.metresPerUnit,
      );
    check(
      gaps.every((d) => d >= 4 - 1e-6),
      'Street tree spacing is less than four metres',
      row.id,
    );
    check(
      gaps.some((d) => d >= 4 && d <= 6),
      'Street row has no regular four-to-six metre interval',
      row.id,
    );
  }
  assert.deepEqual(issues, [], JSON.stringify(issues, null, 2));
  return result;
}
