import * as T from 'three';

// Tests the actual unbatched scene, including shared-node gravel patches.
export function checkCurvedLandscape({
  ground,
  pathPlan,
  motion,
  island,
  model,
}) {
  const issues = [],
    record = (message, data) => {
      if (issues.length < 40) issues.push({ message, data });
    };
  const land = model.city.children[0];
  model.city.updateMatrixWorld(true);
  const meshes = land.children.filter(
      (m) => m.isMesh && (m.userData.surface || m.userData.curvedSurface),
    ),
    curves = meshes.filter((m) => m.userData.curvedSurface),
    triangles = [];
  const signed = (p) =>
    p.reduce((s, a, i) => {
      const b = p[(i + 1) % p.length];
      return s + a[0] * b[1] - a[1] * b[0];
    }, 0) / 2;
  const bounds = (p) => ({
    minX: Math.min(...p.map((v) => v[0])),
    maxX: Math.max(...p.map((v) => v[0])),
    minZ: Math.min(...p.map((v) => v[1])),
    maxZ: Math.max(...p.map((v) => v[1])),
  });
  const cross = (a, b, p) =>
    (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const intersection = (poly, cut) => {
    let result = poly;
    const c = signed(cut) < 0 ? [...cut].reverse() : cut;
    for (let j = 0; j < c.length && result.length; j++) {
      const a = c[j],
        b = c[(j + 1) % c.length],
        out = [];
      for (let i = 0; i < result.length; i++) {
        const p = result[i],
          q = result[(i + 1) % result.length],
          u = cross(a, b, p),
          v = cross(a, b, q),
          pin = u >= 0,
          qin = v >= 0;
        if (pin) out.push(p);
        if (pin !== qin) {
          const t = u / (u - v);
          out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
        }
      }
      result = out;
    }
    return result;
  };
  let topArea = 0,
    topBad = 0,
    up = 0,
    degenerate = 0,
    queryMissing = 0,
    landMissing = 0;
  const ray = new T.Raycaster(),
    down = new T.Vector3(0, -1, 0);
  for (const m of meshes) {
    const attr = m.geometry.attributes.position,
      indices = m.geometry.index,
      count = indices ? indices.count : attr.count;
    for (let i = 0; i < count; i += 3) {
      const verts = [0, 1, 2].map((j) =>
          new T.Vector3()
            .fromBufferAttribute(attr, indices ? indices.getX(i + j) : i + j)
            .applyMatrix4(m.matrixWorld),
        ),
        n = verts[1]
          .clone()
          .sub(verts[0])
          .cross(verts[2].clone().sub(verts[0])),
        poly = verts.map((v) => [v.x, v.z]);
      const curve = !!m.userData.curvedSurface;
      triangles.push({
        poly,
        verts,
        curve,
        ...bounds(poly),
        id: m.userData.curvedSurface?.id || m.userData.surface.id,
      });
      if (!curve) continue;
      topArea += Math.abs(n.y) / 2;
      if (n.length() < 1e-9) {
        degenerate++;
        continue;
      }
      if (n.y > 0) up++;
      else topBad++;
      const q = verts[0].clone().add(verts[1]).add(verts[2]).divideScalar(3);
      if (!ground.walkSurfaceAt(q.x, q.z)) queryMissing++;
      if (!island.onIsland(q.x, q.z)) landMissing++;
      if (Math.abs(q.y - ground.groundHeightAt(q.x, q.z)) > 2e-5) topBad++;
    }
  }
  const expectedArea = ground.curvedSurfaces.reduce(
    (sum, p) => sum + Math.abs(signed(p.poly)),
    0,
  );
  if (
    !curves.length ||
    Math.abs(topArea - expectedArea) > 3e-4 ||
    topBad ||
    queryMissing ||
    landMissing
  )
    record('Real curved top area/normal/query/island mismatch', {
      curves: curves.length,
      topArea,
      expectedArea,
      topBad,
      queryMissing,
      landMissing,
    });
  let pairs = 0,
    overlaps = 0,
    maxOverlap = 0;
  const overlapExamples = [];
  for (let i = 0; i < triangles.length; i++)
    for (let j = i + 1; j < triangles.length; j++) {
      const a = triangles[i],
        b = triangles[j];
      if (
        (!a.curve && !b.curve) ||
        a.maxX <= b.minX + 1e-7 ||
        b.maxX <= a.minX + 1e-7 ||
        a.maxZ <= b.minZ + 1e-7 ||
        b.maxZ <= a.minZ + 1e-7
      )
        continue;
      pairs++;
      const overlap = Math.abs(signed(intersection(a.poly, b.poly)));
      maxOverlap = Math.max(maxOverlap, overlap);
      if (overlap > 1e-6) {
        overlaps++;
        if (overlapExamples.length < 12)
          overlapExamples.push({ a: a.id, b: b.id, overlap });
      }
    }
  if (overlaps)
    record('Actual curve triangles overlap each other or rectangular paving', {
      overlaps,
      maxOverlap,
      examples: overlapExamples,
    });
  const sideExamples = [];
  let sideTriangles = 0,
    internalSides = 0,
    outsideSideEnvelope = 0;
  const edge = land.getObjectByName('garden-path-earth-edges');
  if (edge) {
    const p = edge.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      const [a, b, c] = [0, 1, 2].map((j) =>
          new T.Vector3()
            .fromBufferAttribute(p, i + j)
            .applyMatrix4(edge.matrixWorld),
        ),
        normal = b.clone().sub(a).cross(c.clone().sub(a));
      if (normal.length() < 1e-9) continue;
      normal.normalize();
      sideTriangles++;
      const q = a.clone().add(b).add(c).divideScalar(3),
        v = normal.clone().multiplyScalar(0.00003),
        h1 = ground.groundHeightAt(q.x + v.x, q.z + v.z),
        h2 = ground.groundHeightAt(q.x - v.x, q.z - v.z),
        lo = Math.min(h1, h2),
        hi = Math.max(h1, h2);
      if (hi - lo < 1e-5) internalSides++;
      if (q.y < lo - 3e-5 || q.y > hi + 3e-5) outsideSideEnvelope++;
      if (hi - lo < 1e-5 || q.y < lo - 3e-5 || q.y > hi + 3e-5)
        sideExamples.push({
          triangle: i / 3,
          a: a.toArray(),
          b: b.toArray(),
          c: c.toArray(),
          q: q.toArray(),
          h1,
          h2,
        });
    }
  }
  if (internalSides || outsideSideEnvelope)
    record('Curved skirts contain internal or buried triangles', {
      sideTriangles,
      internalSides,
      outsideSideEnvelope,
      sideExamples,
    });
  let directRoutes = 0,
    reverseMismatches = 0,
    duplicatePoints = 0;
  for (const path of pathPlan.landscapePaths) {
    const f = motion.routeBetween(path.from, path.to),
      r = motion.routeBetween(path.to, path.from).reverse();
    directRoutes += 2;
    if (
      f.length !== r.length ||
      f.some((p, i) => Math.hypot(p[0] - r[i][0], p[1] - r[i][1]) > 1e-7)
    )
      reverseMismatches++;
    for (let i = 1; i < f.length; i++)
      if (Math.hypot(f[i][0] - f[i - 1][0], f[i][1] - f[i - 1][1]) < 1e-8)
        duplicatePoints++;
  }
  if (reverseMismatches || duplicatePoints)
    record('Forward/reverse route centreline mismatch or duplicate samples', {
      reverseMismatches,
      duplicatePoints,
    });
  const seen = new Set();
  let routeRays = 0,
    routeFailures = 0,
    quantizedSeamHits = 0,
    maxSeamDistance = 0;
  const routeExamples = [];
  for (const from of Object.keys(motion.pedestrianNodes))
    for (const to of Object.keys(motion.pedestrianNodes)) {
      if (from === to) continue;
      const route = motion.laneRoute(from, to, motion.pedestrianNodes[from]);
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1],
          b = route[i],
          key = [a.join(','), b.join(',')].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const count = Math.max(
          1,
          Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1),
        );
        for (let j = 0; j <= count; j++) {
          const x = a[0] + ((b[0] - a[0]) * j) / count,
            z = a[1] + ((b[1] - a[1]) * j) / count;
          ray.set(new T.Vector3(x, 1, z), down);
          let hit = ray.intersectObjects(meshes, false)[0];
          routeRays++;
          // Independently clipped polygons share their mathematical edge. Float32
          // upload can shift a T-junction by microunits. Only accept a missed ray
          // if its exact 3D target lies within 2e-6 of a real rendered triangle;
          // this does not widen the planning query or hide visible paving gaps.
          if (!hit && ground.walkSurfaceAt(x, z)) {
            const q = new T.Vector3(x, ground.groundHeightAt(x, z), z);
            let nearest = Infinity,
              nearestPoint;
            for (const tri of triangles) {
              if (
                x < tri.minX - 2e-6 ||
                x > tri.maxX + 2e-6 ||
                z < tri.minZ - 2e-6 ||
                z > tri.maxZ + 2e-6
              )
                continue;
              const p = new T.Triangle(...tri.verts).closestPointToPoint(
                  q,
                  new T.Vector3(),
                ),
                distance = p.distanceTo(q);
              if (distance < nearest) {
                nearest = distance;
                nearestPoint = p;
              }
            }
            if (nearest <= 2e-6) {
              hit = { point: nearestPoint };
              quantizedSeamHits++;
              maxSeamDistance = Math.max(maxSeamDistance, nearest);
            }
          }
          if (
            !hit ||
            !ground.walkSurfaceAt(x, z) ||
            Math.abs(hit.point.y - ground.groundHeightAt(x, z)) >
              (ground.walkSurfaceAt(x, z)?.kind === 'ramp' ? 0.001 : 2e-5)
          ) {
            routeFailures++;
            if (routeExamples.length < 12)
              routeExamples.push({
                from,
                to,
                x,
                z,
                hit: hit?.point.y,
                query: ground.walkSurfaceAt(x, z),
                height: ground.groundHeightAt(x, z),
              });
          }
        }
      }
    }
  if (routeFailures)
    record('Route is not supported by an actual matching-height paved mesh', {
      routeFailures,
      examples: routeExamples,
    });
  return {
    pass: !issues.length,
    top: {
      surfaces: ground.curvedSurfaces.length,
      meshes: curves.length,
      triangles: up + topBad + degenerate,
      up,
      topBad,
      degenerate,
      topArea,
      expectedArea,
      queryMissing,
      landMissing,
    },
    overlap: { checkedPairs: pairs, overlaps, maxOverlap },
    sides: { sideTriangles, internalSides, outsideSideEnvelope },
    routes: {
      directRoutes,
      reverseMismatches,
      duplicatePoints,
      segments: seen.size,
      routeRays,
      routeFailures,
      quantizedSeamHits,
      maxSeamDistance,
    },
    issues,
  };
}

// Validate the real indexed shore rings rather than reconstructing an older outline.
export function checkShoreGeometry({ island, shore, motion, model }) {
  const issues = [],
    check = (ok, message, data) => {
      if (!ok) issues.push({ message, data });
    };
  model.city.updateMatrixWorld(true);
  const mesh = model.city.getObjectByName('sloping-natural-shore');
  if (!mesh?.geometry.index)
    return {
      pass: false,
      issues: [{ message: 'Indexed shore mesh is absent.' }],
    };
  const p = mesh.geometry.attributes.position,
    index = mesh.geometry.index;
  const n = island.islandOutline.length,
    levels = shore.shoreProfile.length;
  const area = (poly) =>
    poly.reduce((s, a, i) => {
      const b = poly[(i + 1) % poly.length];
      return s + a[0] * b[1] - b[0] * a[1];
    }, 0) / 2;
  const orient = (a, b, c) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const crosses = (a, b, c, d) =>
    orient(a, b, c) * orient(a, b, d) < -1e-9 &&
    orient(c, d, a) * orient(c, d, b) < -1e-9;
  const inside = (q, poly) => {
    let result = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i],
        b = poly[j];
      if (
        a[1] > q[1] !== b[1] > q[1] &&
        q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1]) + a[0]
      )
        result = !result;
    }
    return result;
  };
  check(
    n > 100 &&
      levels >= 5 &&
      p.count === n * levels &&
      index.count === n * (levels - 1) * 6,
    'Actual shore topology does not match the shared profile.',
    { n, levels, vertices: p.count, indices: index.count },
  );
  const rings = [],
    ringStats = [];
  let maxProfileError = 0;
  for (let j = 0; j < levels; j++) {
    const band = shore.shoreProfile[j],
      points = [];
    for (let i = 0; i < n; i++) {
      const v = new T.Vector3()
          .fromBufferAttribute(p, i * levels + j)
          .applyMatrix4(mesh.matrixWorld),
        expected = shore.shorePoint(i, band.width, band.height);
      maxProfileError = Math.max(
        maxProfileError,
        v.distanceTo(new T.Vector3(...expected)),
      );
      points.push([v.x, v.z]);
    }
    let selfIntersections = 0;
    for (let i = 0; i < n; i++)
      for (let k = i + 2; k < n; k++)
        if (
          !(i === 0 && k === n - 1) &&
          crosses(
            points[i],
            points[(i + 1) % n],
            points[k],
            points[(k + 1) % n],
          )
        )
          selfIntersections++;
    ringStats.push({
      width: band.width,
      height: band.height,
      area: area(points),
      selfIntersections,
    });
    rings.push(points);
    check(!selfIntersections, 'Actual shore ring self-intersects.', {
      width: band.width,
      selfIntersections,
    });
  }
  check(
    maxProfileError < 3e-6,
    'Rendered shore diverges from the shared width/height profile.',
    {
      maxProfileError,
    },
  );
  let down = 0,
    degenerate = 0;
  const bandAreas = Array(levels - 1).fill(0);
  for (let i = 0; i < index.count; i += 3) {
    const ids = [0, 1, 2].map((j) => index.getX(i + j)),
      verts = ids.map((k) =>
        new T.Vector3()
          .fromBufferAttribute(p, k)
          .applyMatrix4(mesh.matrixWorld),
      );
    const normal = verts[1]
      .clone()
      .sub(verts[0])
      .cross(verts[2].clone().sub(verts[0]));
    if (normal.length() < 1e-9) degenerate++;
    else if (normal.y <= 0) down++;
    bandAreas[Math.min(...ids.map((k) => k % levels))] += normal.y / 2;
  }
  const bands = [];
  for (let j = 1; j < levels; j++) {
    const inner = rings[j - 1],
      outer = rings[j];
    let crossings = 0;
    for (let i = 0; i < n; i++)
      for (let k = 0; k < n; k++)
        if (crosses(inner[i], inner[(i + 1) % n], outer[k], outer[(k + 1) % n]))
          crossings++;
    const outside = inner.filter((q) => !inside(q, outer)).length,
      expected = area(outer) - area(inner),
      error = Math.abs(bandAreas[j - 1] - expected);
    bands.push({
      from: shore.shoreProfile[j - 1].width,
      to: shore.shoreProfile[j].width,
      crossings,
      innerVerticesOutside: outside,
      area: bandAreas[j - 1],
      areaError: error,
    });
    check(
      !crossings && !outside && error < 1e-5,
      'Rendered shore bands cross or lose area.',
      bands.at(-1),
    );
  }
  check(
    !down && !degenerate,
    'Rendered shore contains flipped or degenerate triangles.',
    {
      down,
      degenerate,
    },
  );
  const b = new T.Box3().setFromObject(model.ferry),
    footprint = [];
  for (const x of [b.min.x, b.max.x])
    for (const z of [b.min.z, b.max.z]) footprint.push([x, z]);
  const segmentDistance = (q, a, b) => {
    const x = b[0] - a[0],
      z = b[1] - a[1],
      t = Math.max(
        0,
        Math.min(1, ((q[0] - a[0]) * x + (q[1] - a[1]) * z) / (x * x + z * z)),
      );
    return Math.hypot(q[0] - a[0] - x * t, q[1] - a[1] - z * t);
  };
  const outer = rings.at(-1);
  let boatInside = 0,
    minClearance = Infinity,
    samples = 0;
  for (let i = 0; i <= 600; i++) {
    const pose = motion.boatPose(i * 0.2);
    for (const [x, z] of footprint) {
      const q = [
        pose.x + x * Math.cos(pose.heading) + z * Math.sin(pose.heading),
        pose.z - x * Math.sin(pose.heading) + z * Math.cos(pose.heading),
      ];
      samples++;
      if (inside(q, outer)) boatInside++;
      for (let j = 0; j < n; j++)
        minClearance = Math.min(
          minClearance,
          segmentDistance(q, outer[j], outer[(j + 1) % n]),
        );
    }
  }
  check(
    shore.seaRoute.z === 28.5 && !boatInside && minClearance > 1,
    'Boat intersects the actual widened shore mesh.',
    { z: shore.seaRoute.z, samples, boatInside, minClearance },
  );
  return {
    pass: !issues.length,
    vertices: p.count,
    triangles: index.count / 3,
    maxProfileError,
    down,
    degenerate,
    rings: ringStats,
    bands,
    boat: { z: shore.seaRoute.z, samples, boatInside, minClearance },
    issues,
  };
}
