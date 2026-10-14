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
  'use-sky',
  'city-atmosphere',
  ...(await fs.readdir(path.join(root, 'app'))).filter((f) => /^town-[\w-]+\.ts$/.test(f)).map((f) => f.slice(0, -3)).sort(),
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
const { buildCityModel, pairMovingParts, followMovingParts } = await load('city-scene');
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
  // The herd answers the pointer as the corner park, so its paddock (to the dykes' outer faces) is the park's district too.
  waterfront: [[plan.park.x, plan.park.z], ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => [plan.paddock.x + sx * (plan.paddock.w + plan.paddock.wall) / 2, plan.paddock.z + sz * (plan.paddock.d + plan.paddock.wall) / 2]))],
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
// The Highland paddock lies on the flat island, clear of the shore and the streets, with no
// tree in it; its herd stands inside the dykes, bodies at least 0.25 in from the walls' inner faces.
const pad = plan.paddock;
for (let i = 0; i <= 20; i++)
  for (const [x, z] of [
    [pad.x - pad.w / 2 + (pad.w * i) / 20, pad.z - pad.d / 2],
    [pad.x - pad.w / 2 + (pad.w * i) / 20, pad.z + pad.d / 2],
    [pad.x - pad.w / 2, pad.z - pad.d / 2 + (pad.d * i) / 20],
    [pad.x + pad.w / 2, pad.z - pad.d / 2 + (pad.d * i) / 20],
  ]) {
    assert(plan.onIsland(x, z, 2), `The paddock reaches the shore at ${x.toFixed(1)}, ${z.toFixed(1)}`);
    assert(plan.distanceToStreets(x, z) > 2, `The paddock crowds a street at ${x.toFixed(1)}, ${z.toFixed(1)}`);
    assert(plan.terrainHeight(x, z) < 0.01, `The paddock runs up a hill at ${x.toFixed(1)}, ${z.toFixed(1)}`);
  }
for (const t of trees)
  assert(
    Math.abs(t.x - pad.x) > pad.w / 2 + 0.5 || Math.abs(t.z - pad.z) > pad.d / 2 + 0.5,
    'Tree in the paddock: ' + t.id,
  );
const inPaddock = (x, z) =>
  Math.min(pad.w / 2 - pad.wall / 2 - Math.abs(x - pad.x), pad.d / 2 - pad.wall / 2 - Math.abs(z - pad.z));
assert.deepEqual(plan.herd.map((a) => a.id), ['cow-a', 'cow-b', 'calf']);
for (const animal of plan.herd) {
  // Nose (head up) to tail tuft, and the barrel's half-width, at the animal's scale.
  const fx = Math.sin(animal.heading),
    fz = Math.cos(animal.heading);
  for (const [along, across] of [[1.02, 0.2], [1.02, -0.2], [0.6, 0.38], [0.6, -0.38], [-0.7, 0.38], [-0.7, -0.38]]) {
    const x = animal.x + (fx * along + fz * across) * animal.scale,
      z = animal.z + (fz * along - fx * across) * animal.scale;
    assert(inPaddock(x, z) >= 0.25, `${animal.id} leans into the dyke at ${x.toFixed(2)}, ${z.toFixed(2)}`);
  }
}
// Street life. The cyclist keeps left on the ring's outer side, half a lap from the tram: on the
// flat carriageway, its ±0.22 never reaching the kerb (0.85 out), well clear of the terrace homes,
// their bays and lean-tos (each site's rectangle run 0.8 further out at the front).
{
  const lean = new Set();
  for (let t = 0; t <= 3000; t += 0.13) {
    const p = plan.cyclistPose(t),
      tram = plan.tramPose(t);
    assert(Math.hypot(p.x - tram.x, p.z - tram.z) >= 20, `The cyclist meets the tram at t=${t.toFixed(2)}`);
    const off = plan.distanceToPolyline([p.x, p.z], plan.ringLine, true);
    assert(Math.abs(off - 0.6) <= 0.02 && !inside(plan.ringLine, p.x, p.z), `The cyclist leaves the outer lane at t=${t.toFixed(2)} (${off.toFixed(3)})`);
    assert(plan.terrainHeight(p.x, p.z) === 0, 'The cyclist rides up a hill');
    assert(Number.isFinite(p.heading) && p.lean >= 0 && p.lean <= 0.13 + 1e-9, 'The cyclist leans out of the turn');
    lean.add(p.lean > 0.12);
    for (const id of ['pengyuan-liu', 'yunlong-liu', 'qin-li']) {
      const s = plan.sites[id],
        dx = p.x - s.x,
        dz = p.z - s.z,
        lx = dx * Math.cos(s.rotation) - dz * Math.sin(s.rotation),
        lz = dx * Math.sin(s.rotation) + dz * Math.cos(s.rotation),
        out = Math.hypot(Math.max(Math.abs(lx) - s.w / 2, 0), Math.max(-s.d / 2 - lz, 0, lz - s.d / 2 - 0.8));
      assert(out >= 2.4, `The cyclist passes ${out.toFixed(2)} from ${id}`);
    }
  }
  assert.deepEqual([...lean].sort(), [false, true], 'The cyclist rides straights upright and leans on the corners.');
}
// The dog walk keeps to the open lawn east of the corner park: off the plot, the pavements and
// the trunks, both the walker's loop and the dog's lane inside it.
for (const [x, z] of [...plan.dogLoop, ...plan.dogLane]) {
  const park = plan.park,
    out = Math.max(Math.abs(x - park.x) - park.w / 2, Math.abs(z - park.z) - park.d / 2);
  assert(out >= 0.35, `The dog walk crosses the corner park at ${x.toFixed(2)}, ${z.toFixed(2)}`);
  assert(plan.distanceToStreets(x, z) > plan.PAVEMENT_WIDTH + 0.35, `The dog walk crowds a pavement at ${x.toFixed(2)}, ${z.toFixed(2)}`);
  for (const t of trees) assert(Math.hypot(t.x - x, t.z - z) >= 0.95, `The dog walk runs into ${t.id}`);
  assert(plan.terrainHeight(x, z) === 0, 'The dog walk climbs a hill');
}
// Ducks paddle inside their sectors of the pool, clear of the causeways' faces, and the pair
// never swims through each other.
{
  const { POOL, POOL_GAP } = await load('town-shared');
  // The plan keeps the pool's mid-line as a number; it must be the pool's.
  assert.equal((POOL.inner + POOL.outer) / 2, 3.3, 'The ducks swim about the pool’s mid-line.');
  for (let u = 0; u <= Math.PI * 2; u += 0.01) {
    const at = plan.ducks.map((_, i) => plan.duckPose(i, u));
    at.forEach(({ x, z, heading }, i) => {
      const r = Math.hypot(x, z),
        a = Math.atan2(z, x);
      assert(r >= 2.95 && r <= 3.65, `duck-${i} leaves the water (r ${r.toFixed(2)})`);
      // The causeways' faces are radial cuts at ±POOL_GAP about each axis.
      const sector = Math.round((a - Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2) + Math.PI / 4,
        across = Math.min(...[sector - Math.PI / 4, sector + Math.PI / 4].map((axis) => r * Math.sin(Math.abs(plan.angleDiff(a, axis)) - POOL_GAP)));
      assert(across >= 0.3, `duck-${i} bumps a causeway (${across.toFixed(2)})`);
      assert(Number.isFinite(heading));
    });
    assert(Math.hypot(at[0].x - at[1].x, at[0].z - at[1].z) >= 0.3, 'The ducks swim through each other.');
  }
}
// The bike rack (its hoops and the bikes leaning on them) stands off the plaza and the pavements,
// with no trunk near it.
const rackFootprint = (() => {
  const { x, hoops } = plan.bikeRack; // the bikes stand 0.025 east of their hoop, 0.9 long
  return { x0: x - 0.425, x1: x + 0.475, z0: Math.min(...hoops) - 0.05, z1: Math.max(...hoops) + 0.05 };
})();
{
  const { x0, x1, z0, z1 } = rackFootprint;
  for (let i = 0; i <= 10; i++)
    for (const [x, z] of [[x0 + ((x1 - x0) * i) / 10, z0], [x0 + ((x1 - x0) * i) / 10, z1], [x0, z0 + ((z1 - z0) * i) / 10], [x1, z0 + ((z1 - z0) * i) / 10]]) {
      assert(Math.hypot(x, z) - plan.PLAZA_RADIUS >= 0.5, `The bike rack crowds the plaza at ${x.toFixed(2)}, ${z.toFixed(2)}`);
      let road = plan.distanceToPolyline([x, z], plan.ringLine, true);
      for (const a of plan.avenues) road = Math.min(road, plan.distanceToSegment([x, z], a.from, a.to));
      assert(road - plan.ROAD_WIDTH / 2 - plan.PAVEMENT_WIDTH >= 0.5, `The bike rack crowds a pavement at ${x.toFixed(2)}, ${z.toFixed(2)}`);
    }
  for (const t of trees)
    assert(Math.hypot(Math.max(x0 - t.x, 0, t.x - x1), Math.max(z0 - t.z, 0, t.z - z1)) >= 1.5, `${t.id} stands on the bike rack`);
}
// The square bale beside the hay rack (0.3 by 0.44) stands inside the dykes, clear of the herd.
{
  const bale = plan.hayBale,
    c = Math.cos(bale.ry),
    s = Math.sin(bale.ry);
  for (const [u, v] of [[0.15, 0.22], [0.15, -0.22], [-0.15, 0.22], [-0.15, -0.22]]) {
    const x = bale.x + u * c + v * s,
      z = bale.z - u * s + v * c;
    assert(inPaddock(x, z) >= 0.05, `The hay bale leans into the dyke at ${x.toFixed(2)}, ${z.toFixed(2)}`);
  }
  for (const animal of plan.herd)
    assert(Math.hypot(animal.x - bale.x, animal.z - bale.z) > 0.27 + 0.7 * animal.scale, `The hay bale stands in ${animal.id}`);
  assert(Math.abs(bale.z - plan.hayRack.z) > 0.5 + 0.22, 'The hay bale stands in the rack.');
}
for (let i = 0; i < 400; i++) {
  const pose = plan.boatPose(i * 0.37);
  assert(!plan.onIsland(pose.x, pose.z, -1.0), 'Boat runs aground.');
  assert(Number.isFinite(pose.heading));
}
// The harbour's beach details stand on the sand, each inside its own footprint and clear of the
// others and of the beach boulders; the head bollard sits on one plank, and the boat keeps clear.
{
  const sp = plan.shoreProps,
    H = plan.harbour,
    at = (s) => plan.shoreAt(s.i, s.w),
    parts = [
      { name: 'creelStack', p: at(sp.creelStack), r: sp.creelStack.foot },
      { name: 'creel', p: at(sp.creel), r: sp.creel.foot },
      ...sp.floats.map((s, k) => ({ name: 'floats[' + k + ']', p: at(s), r: s.foot })),
      { name: 'coil', p: at(sp.coil), r: sp.coil.foot },
      { name: 'netFrame', p: at(sp.netFrame.from), q: at(sp.netFrame.to), r: sp.netFrame.foot },
      { name: 'driftwood', p: at(sp.driftwood.from), q: at(sp.driftwood.to), r: sp.driftwood.foot, root: sp.driftwood.rootFoot },
      ...sp.rockPools.map((s, k) => ({ name: 'rockPools[' + k + ']', p: at(s), r: s.foot })),
      ...sp.wrack.map((s, k) => ({ name: 'wrack[' + k + ']', p: at(s), r: s.foot })),
    ];
  for (const part of parts)
    for (const p of part.q ? [part.p, part.q] : [part.p]) {
      const out = plan.distanceToPolyline(p, plan.islandOutline, true) * (plan.onIsland(p[0], p[1]) ? -1 : 1);
      assert(out >= 0.3 && out <= 2.75, `${part.name} is ${out.toFixed(2)} out from the outline, off the beach`);
    }
  // Beach boulders as discs of 1.35 r (their plan scale) at the shore mesh's points.
  for (let i = 0; i < plan.OUTLINE_SAMPLES; i++) {
    if (plan.hash(i) >= 0.07) continue;
    const width = 0.6 + 1.6 * plan.hash(i * 3 + 1);
    parts.push({ name: 'boulder-' + i, p: plan.shoreAt(i, width), r: 1.35 * (0.26 + 0.18 * (0.5 + 0.5 * Math.sin(i * 17.1))) });
  }
  // Every part is a disc or a capsule (a driftwood log also has its root disc at `from`).
  const shapes = (part) => [[part.p, part.q ?? part.p, part.r], ...(part.root ? [[part.p, part.p, part.root]] : [])];
  const segmentGap = ([a, b, ra], [c, d, rc]) => {
    let best = Infinity;
    for (let t = 0; t <= 1; t += 0.02) {
      best = Math.min(best, plan.distanceToSegment([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], c, d));
      best = Math.min(best, plan.distanceToSegment([c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t], a, b));
    }
    return best - ra - rc;
  };
  const together = new Set(['rockPools[0]', 'wrack[0]', 'boulder-42']); // a pool, its weed and its boulder overlap on purpose
  for (let a = 0; a < parts.length; a++)
    for (let b = a + 1; b < parts.length; b++) {
      if (together.has(parts[a].name) && together.has(parts[b].name)) continue;
      const gap = Math.min(...shapes(parts[a]).flatMap((u) => shapes(parts[b]).map((v) => segmentGap(u, v))));
      assert(gap >= 0.08, `${parts[a].name} and ${parts[b].name} are ${gap.toFixed(3)} apart`);
    }
  // The pier's planks as built (pierAndHarbour): 15 across the deck, each with its own shift and turn.
  const L = plan.pier.length,
    count = Math.round((L + 0.2) / 0.42),
    pitch = (L + 0.2) / count,
    plankAt = (k) => ({ x: (plan.hash(k * 5 + 1) - 0.5) * 0.06, z: (k + 0.5) * pitch, ry: (plan.hash(k * 5 + 3) - 0.5) * 0.05, hw: (plan.pier.width + 0.12) / 2, hd: (pitch - 0.045) / 2 });
  const onPlank = ([x, z], r) =>
    Array.from({ length: count }, (_, k) => plankAt(k)).some((p) => {
      const c = Math.cos(p.ry),
        s = Math.sin(p.ry),
        lx = (x - p.x) * c - (z - p.z) * s,
        lz = (x - p.x) * s + (z - p.z) * c;
      return Math.abs(lx) + r <= p.hw && Math.abs(lz) + r <= p.hd;
    });
  const lampPlinth = [-0.38, L - 0.45],
    toSquare = ([x, z], [cx, cz], half) => Math.hypot(Math.max(0, Math.abs(x - cx) - half), Math.max(0, Math.abs(z - cz) - half));
  assert(onPlank(H.headBollard, 0.13), 'The head bollard straddles two planks.');
  assert(toSquare(H.headBollard, lampPlinth, 0.17) - 0.13 >= 0.3, 'The head bollard crowds the pier-head lamp.');
  const coilR = 0.225;
  // Planks reach 0.81 either side, shifted by up to 0.03: the coil stays 0.03 inside the nearest edge.
  assert(Math.abs(H.berthCoil[0]) + coilR <= (plan.pier.width + 0.12) / 2 - 0.03 - 0.03, 'The berth coil hangs over the deck edge.');
  assert(Math.hypot(H.berthCoil[0] - H.headBollard[0], H.berthCoil[1] - H.headBollard[1]) - coilR - 0.13 >= 0.15, 'The berth coil crowds the bollard.');
  for (let z = 0.9; z < L + 0.2; z += 1.3)
    for (const side of [-1, 1])
      assert(Math.hypot(H.berthCoil[0] - side * 0.72, H.berthCoil[1] - z) - coilR - 0.15 >= 0.15, `The berth coil crowds the pile at ${side * 0.72}, ${z.toFixed(1)}.`);
  // The lead from the coil to the bollard runs along world z, so its box never reaches 0.5 wide on
  // both world axes and batch() never takes the berth line for an eave cap.
  const bollardAt = plan.pierPoint(...H.headBollard),
    coilAt = plan.pierPoint(...H.berthCoil);
  assert(Math.abs(bollardAt[0] - coilAt[0]) < 0.05, 'The berth line no longer runs along world z.');
  for (let i = 0; i < 400; i++) {
    const pose = plan.boatPose(i * 0.37);
    for (const [name, p] of [['head bollard', bollardAt], ['berth coil', coilAt]])
      assert(Math.hypot(pose.x - p[0], pose.z - p[1]) >= 1.5, `The boat runs into the ${name} at t=${(i * 0.37).toFixed(2)}.`);
    for (const part of parts)
      if (!part.name.startsWith('boulder'))
        assert(plan.distanceToSegment([pose.x, pose.z], part.p, part.q ?? part.p) >= 3, `The boat comes within 3 of the ${part.name}.`);
  }
}
const warnings = [];
const originalWarn = console.warn,
  originalError = console.error;
// A glass geometry without aWindow makes mergeGeometries log an error and drop its whole group.
console.warn = console.error = (...args) => warnings.push(args.join(' '));
const start = performance.now();
const model = buildCityModel();
const ms = performance.now() - start;
console.warn = originalWarn;
console.error = originalError;
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
// Every custom program declares the varyings it reads in the fragment stage (one missing drops
// the mesh). Nothing compiles GLSL in Node, so this checks the patched text.
const patchedShader = (m) => {
  const s = { uniforms: {}, vertexShader: T.ShaderLib.physical.vertexShader, fragmentShader: T.ShaderLib.physical.fragmentShader };
  m.onBeforeCompile(s, null);
  return s;
};
const varyings = (src) => new Set([...src.matchAll(/varying\s+\w+\s+(\w+)\s*;/g)].map((v) => v[1]));
{
  const seen = new Set();
  city.traverse((o) => {
    if (!o.isMesh || seen.has(o.material)) return;
    seen.add(o.material);
    const s = patchedShader(o.material),
      fv = varyings(s.fragmentShader);
    for (const v of varyings(s.vertexShader))
      assert(!new RegExp('\\b' + v + '\\b').test(s.fragmentShader) || fv.has(v), `${o.material.name}: ${v} read but not declared`);
  });
  // The beach's wet band: the shore is the only sand, and its uv.x runs out to the profile's 7.2.
  const sands = [];
  city.traverse((o) => o.isMesh && o.material.userData.surfaceKind === 'sand' && sands.push(o));
  assert.equal(sands.length, 1, 'Only the shore is sand.');
  const uv = sands[0].geometry.getAttribute('uv');
  let widest = -Infinity;
  for (let i = 0; i < uv.count; i++) widest = Math.max(widest, uv.getX(i));
  assert(Math.abs(widest - 7.2) < 0.05, `The shore's uv.x reaches ${widest}, not the shore width.`);
  const sand = patchedShader(sands[0].material);
  assert(varyings(sand.vertexShader).has('vShoreW') && varyings(sand.fragmentShader).has('vShoreW') && sand.fragmentShader.includes('shoreWet'), 'The sand has no wet band.');
  // The drying net: a solid veil with its back faces built in, so it batches with the other cloth.
  // Nothing on the land is two-sided (that costs a program of its own) or cuts holes (cut-out
  // mesh twinkles once under a pixel), and the net is there: cloth over the bar, casting nothing.
  model.land.traverse((o) => {
    if (!o.isMesh) return;
    assert.notEqual(o.material.side, T.DoubleSide, `${o.material.name} on the land is two-sided.`);
    assert(!o.material.onBeforeCompile || !patchedShader(o.material).fragmentShader.includes('discard'), `${o.material.name} cuts holes.`);
  });
  const [nx, nz] = plan.shoreAt((plan.shoreProps.netFrame.from.i + plan.shoreProps.netFrame.to.i) / 2, plan.shoreProps.netFrame.from.w);
  let netVertices = 0;
  model.land.traverse((o) => {
    if (!o.isMesh || o.material.userData.surfaceKind !== 'fabric' || o.castShadow) return;
    const p = o.geometry.getAttribute('position'),
      v = new T.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      if (Math.hypot(v.x - nx, v.z - nz) < 0.8 && v.y > 0.9) netVertices++;
    }
  });
  assert(netVertices > 50, 'The drying net is missing from the no-shadow cloth.');
}
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
// The canted bays: under the eaves, out of the gardens, clear of the doorpiece, baked as one body under their own cap,
// the main wall's bake untouched, one light per storey, and each home within its triangle budget. The models are
// batched, so this reads the merged meshes in shell space (front +z, the wall face at d/2).
{
  const BAY = { x: -0.68, root: 1.06, depth: 0.55, cant: 0.23 },
    slant = Math.hypot(BAY.depth, BAY.cant),
    WALL_TOP = 3.02;
  // Each bay's bodies (y0, y1); the last one's top is the bay's own cap.
  const BODIES = {
    'yunlong-liu': [[0.42, 1.76], [1.9, 2.78]],
    'qin-li': [[0.42, 1.76], [1.9, 2.64]],
    'pengyuan-liu': [[0.42, 1.76]],
  };
  const v = new T.Vector3(),
    q = new T.Vector3(),
    n = new T.Vector3(),
    tri = new T.Box3();
  for (const id of plan.chapterSubjects.people) {
    const { shell } = models.get(id),
      { w, d } = plan.sites[id],
      bodies = BODIES[id],
      cap = bodies?.at(-1)[1];
    // Bay body faces as [normal x, normal z, point x, point z]: front, left cheek, right cheek.
    const faces = [
      [0, 1, BAY.x, d / 2 + BAY.depth],
      [-BAY.depth / slant, BAY.cant / slant, BAY.x - BAY.root / 2, d / 2],
      [BAY.depth / slant, BAY.cant / slant, BAY.x + BAY.root / 2, d / 2],
    ];
    // The door's lintel and left jamb, grown 0.05 all round, so a cheek frame keeps a visible band of stone off the doorpiece.
    const door = [
      [-0.09, 2.17, 1.13, 2.39, 0.24],
      [-0.01, 0.42, 0.17, 2.35, 0.2],
    ].map(([x0, y0, x1, y1, dz]) => new T.Box3(new T.Vector3(x0, y0, d / 2), new T.Vector3(x1, y1, d / 2 + dz)).expandByScalar(0.05));
    let tris = 0,
      walls = 0,
      capped = 0;
    for (const o of shell.children) {
      if (!o.isMesh) continue;
      const p = o.geometry.attributes.position,
        kind = o.material.userData.surfaceKind;
      tris += (o.geometry.index?.count ?? p.count) / 3;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        if (v.z > d / 2 + 0.45) assert(v.y < 3.12, `${id}: the bay stands through the eave at ${v.toArray().join(', ')}`);
        if (!bodies) continue;
        if (v.z > d / 2 + 0.75) assert(v.y < 0.7, `${id}: the bay reaches into the front garden at ${v.toArray().join(', ')}`);
        // A cheek frame's root stile spans the lintel's height with no vertex there, so test triangles, not vertices.
        if (kind === 'paint' && i % 3 === 2) {
          tri.makeEmpty();
          for (let j = i - 2; j <= i; j++) tri.expandByPoint(q.fromBufferAttribute(p, j));
          if (tri.min.x < -0.03) assert(!door.some((b) => b.intersectsBox(tri)), `${id}: a bay frame touches the doorpiece at ${tri.min.toArray().join(', ')}`);
        }
        if (kind !== 'stone') continue;
        n.fromBufferAttribute(o.geometry.attributes.normal, i);
        const eave = o.geometry.attributes.aBake.getY(i) * 4;
        // The main wall's flat front keeps its bake: only the main cornice caps it (2.48 at y 0.54, 0.12 at 2.90).
        if (Math.abs(v.z - d / 2) < 2e-3 && n.z > 0.99 && Math.abs(Math.abs(v.x) - (w / 2 - 0.12)) < 2e-3) {
          walls++;
          assert(Math.abs(eave - (WALL_TOP - v.y)) < 0.02, `${id}: a bay cap darkens the main wall at ${v.toArray().join(', ')}`);
        }
        // A bay body darkens only toward its own cap, never a band's, and its top row sits right under it on every face.
        const onFace = faces.some(([nx, nz, px, pz]) => n.x * nx + n.z * nz > 0.99 && Math.abs((v.x - px) * nx + (v.z - pz) * nz) < 2e-3);
        const body = onFace && Math.abs(v.x - BAY.x) < BAY.root / 2 + 1e-3 && bodies.find(([y0, y1]) => v.y > y0 && v.y < y1);
        if (!body) continue;
        assert(eave > cap - v.y - 0.02, `${id}: a band course darkens the bay at ${v.toArray().join(', ')}`);
        if (body[1] === cap && Math.abs(v.y - (cap - 0.03)) < 2e-3) {
          capped++;
          assert(eave < 0.1, `${id}: the bay's top is not under its cap at ${v.toArray().join(', ')}`);
        }
      }
    }
    assert(tris < 6000, `${id}: ${Math.round(tris)} triangles`);
    if (!bodies) continue;
    assert(walls >= 4 && capped >= 9, `${id}: found ${walls} main-wall and ${capped} capped bay vertices`);
    // Once per-pane night lights land (model.windows): each bay storey is one light, and the ground storey is forced
    // on (level 255, out no earlier than byte 191, 01:22). Pengyuan's one-storey bay has no glass above its cornice.
    if (model.windows)
      for (const [y0, y1, forced] of [
        [0.6, 1.8, true],
        [1.85, 3, false],
      ]) {
        const seen = new Set();
        for (const o of shell.children)
          if (o.isMesh && o.material.userData.surfaceKind === 'glass') {
            const p = o.geometry.attributes.position,
              a = o.geometry.attributes.aWindow.array;
            for (let i = 0; i < p.count; i++)
              if (v.fromBufferAttribute(p, i).x < -0.03 && v.z > d / 2 + 0.02 && v.y > y0 && v.y < y1) seen.add(a.slice(i * 4, i * 4 + 4).join());
          }
        const lights = forced || bodies.length > 1 ? 1 : 0;
        assert.equal(seen.size, lights, `${id}: the bay's band ${y0}–${y1} has ${seen.size} lights`);
        if (!lights) continue;
        const [level, , off] = [...seen][0].split(',').map(Number);
        if (forced) assert(level === 255 && off >= 191, `${id}: the ground storey is not lit late (${[...seen][0]})`);
      }
  }
}
// The bike rack is part of the Research Studio, inside its footprint, so it answers as the studio.
{
  const studio = new T.Box3().setFromObject(models.get('research-studio').root),
    { x0, x1, z0, z1 } = rackFootprint;
  assert(studio.min.x <= x0 && x1 <= studio.max.x && studio.min.z <= z0 && z1 <= studio.max.z, 'The bike rack stands outside the Research Studio.');
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
// The herd answers the pointer as the park does: straight down on the paddock, the pick (the
// models' hit targets and the park's, recursively) finds the Corner park.
{
  const pad = plan.paddock;
  ray.set(new T.Vector3(pad.x, 40, pad.z), new T.Vector3(0, -1, 0));
  let picked = ray.intersectObjects([...Array.from(models.values(), (m) => m.hit ?? m.root), model.parkHit], true)[0]?.object;
  while (picked && !picked.userData.placeId && !picked.userData.buildingId) picked = picked.parent;
  assert.equal(picked?.userData.placeId, 'corner-park', 'Pointing at the herd finds the Corner park.');
}
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
water.update(8, 1, new T.PerspectiveCamera(), { rain: 1, sun: new T.Vector3(1, 1, 1), moon: new T.Vector3(160, 320, -200) });
// The moon's glint follows the moon the frame loop turns with the camera.
assert.deepEqual(shader.uniforms.moonPosition.value.toArray(), [160, 320, -200], 'The sea takes the moon it is handed.');
// Night: windows glow pane by pane, lanterns light up, spotlights point down.
const { windowClock, followWindows, WINDOW_RATE } = await load('glasgow-sun');
const { windowLevel, windowGlow } = await load('city-materials');
model.materialLibrary.setNight(1);
let windows = 0,
  glassBatch;
city.traverse((o) => {
  // Lanterns carry their own glow, driven by the frame loop; windows share the library's glass,
  // and each pane carries its own light in aWindow (normalised bytes, as batch() bakes them).
  if (o.isMesh && o.material.userData.surfaceKind === 'glass' && !lamps.includes(o)) {
    assert(o.material.emissiveIntensity > 0.5, 'Windows must light up at night.');
    const a = o.geometry.attributes.aWindow;
    assert(a && a.itemSize === 4 && a.normalized && a.array instanceof Uint8Array, 'A glass mesh without its panes\' night lights.');
    glassBatch = o.material;
    windows++;
  }
});
assert(windows > 5);
// The glass shader really reads them: a renamed chunk would drop the patch silently.
{
  const shader = { uniforms: {}, vertexShader: T.ShaderLib.standard.vertexShader, fragmentShader: T.ShaderLib.standard.fragmentShader };
  glassBatch.onBeforeCompile(shader, null);
  assert(shader.vertexShader.includes('attribute vec4 aWindow') && shader.vertexShader.includes('vWindow = on *'), 'The glass shader reads aWindow.');
  assert(shader.fragmentShader.includes('totalEmissiveRadiance *= vWindow'), 'The glass shader lights each pane by its own light.');
  assert(shader.uniforms.windowClock?.value?.isVector2, 'The glass shader follows the window clock.');
}
const panes = model.windows,
  rooms = panes.filter((p) => ['home', 'civic', 'studio'].includes(p.role)),
  at = (h) => windowClock(h),
  lit = (list, h) => list.filter((p) => windowLevel(p.light, at(h)) > 0.1),
  Y = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b,
  todayGlow = new T.Color('#ffd29a');
assert.deepEqual(phased.windows.map((p) => [p.place, p.light]), panes.map((p) => [p.place, p.light]), 'Every build lights the same panes.');
// Evening: about half the rooms lit; the members' homes are lit late, and the studio works later.
{
  const evening = lit(rooms, 20).length / rooms.length;
  assert(evening >= 0.35 && evening <= 0.65, `${Math.round(evening * 100)}% of the rooms are lit at 20:00.`);
  // Most lit rooms are warm or today's glow; the pale cool white is an accent, not a grey board on every civic front.
  const cool = lit(rooms, 20).filter((p) => Math.round(p.light[1] * 255) === 255).length;
  assert(cool <= 0.15 * lit(rooms, 20).length, `${cool} of the ${lit(rooms, 20).length} rooms lit at 20:00 are cool.`);
  for (const id of ['pengyuan-liu', 'yunlong-liu', 'qin-li'])
    assert(lit(rooms.filter((p) => p.place === id), 23.5).length, `${id}'s home is dark at 23:30.`);
  assert(lit(rooms.filter((p) => p.place === 'research-studio'), 1).length, 'The studio is dark at 01:00.');
  // The archive's three north lights light one roof hall: one light, never three bands of different lamps.
  assert.equal(rooms.filter((p) => p.place === 'city-archive' && p.at.y > 4).length, 1, 'The archive\'s north lights are not one light.');
}
// Always lit: the clock dials (exactly), the lighthouse, the phone box and the tram and boat; never: the crane cab.
{
  const role = (r) => panes.filter((p) => p.role === r);
  assert.equal(role('dial').length, 4, 'Four clock dials.');
  assert.equal(role('unlit').length, 1, 'One crane cab.');
  for (const r of ['beacon', 'kiosk', 'vehicle']) assert(role(r).length, `No ${r} panes.`);
  for (let minute = 0; minute < 24 * 60; minute += 15) {
    const clock = at(minute / 60);
    assert(role('dial').every((p) => windowLevel(p.light, clock) === 1), `A clock dial is dark at minute ${minute}.`);
    assert(['beacon', 'kiosk', 'vehicle'].every((r) => role(r).every((p) => windowLevel(p.light, clock) > 0.5)), `A lamp that stays lit is dark at minute ${minute}.`);
    assert(role('unlit').every((p) => windowLevel(p.light, clock) === 0), `The crane cab is lit at minute ${minute}.`);
  }
  // The dials are exactly today's glow; no pane is brighter (luminance x the night's 0.72).
  for (const p of role('dial')) {
    const c = windowGlow(p.light, at(20));
    assert(['r', 'g', 'b'].every((k) => Math.abs(c[k] - todayGlow[k]) < 1e-4), 'A clock dial is not today\'s glow.');
  }
  // The four looks, each from its bytes: full warm, today's, cool and dim (and the studio's glass box,
  // today's colour at 0.8 so it never reads as a lampshade). Every lit room is one of them.
  const looks = [
      ['full warm', 255, 0, 0.46],
      ["today's", 255, 128, 0.5],
      ['cool', 179, 255, 0.41],
      ['dim', 115, 0, 0.21],
      ['studio glass', 204, 128, 0.4],
    ],
    glowOf = (level, tint) => Y(windowGlow([level / 255, tint / 255, 1, 1], at(20))) * 0.72;
  for (const [name, level, tint, want] of looks) assert(Math.abs(glowOf(level, tint) - want) < 0.01, `A ${name} pane glows at ${glowOf(level, tint).toFixed(3)}.`);
  for (const p of lit(rooms, 20)) {
    const bytes = p.light.slice(0, 2).map((v) => Math.round(v * 255)),
      look = looks.find(([, level, tint]) => level === bytes[0] && tint === bytes[1]);
    assert(look, `A lit pane at ${p.place} has no look of its own (${bytes}).`);
    assert(Math.abs(Y(windowGlow(p.light, at(20))) * 0.72 - look[3]) < 0.01, `A ${look[0]} pane at ${p.place} glows off its look.`);
  }
}
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
// Their night shaders can be compiled by day: asIf sets each lighting state for the call only.
for (const shadow of [true, false]) {
  let seen;
  lighting.asIf(true, shadow, () => {
    seen = [scene.children.includes(lighting.lights[5]), lighting.lights.map((l) => l.castShadow)];
  });
  assert.deepEqual(seen, [true, lighting.lights.map((_, i) => i === 0 && shadow)], 'asIf sets the state it is asked for.');
  assert(!scene.children.includes(lighting.lights[0]), 'asIf puts the lights back as they were.');
  assert.deepEqual(lighting.lights.map((l) => l.castShadow), lighting.lights.map((_, i) => i === 0), 'asIf puts the shadows back.');
}
lighting.update(1, false);
lighting.asIf(false, false, () => assert(!scene.children.includes(lighting.lights[0])));
assert(scene.children.includes(lighting.lights[0]), 'asIf puts the night lights back.');
lighting.dispose();
// The balloon rounds the island out over the shore and the sea, above the gulls, and never
// drifts over a building a chapter is about.
const balloon = model.animated.find((e) => {
  e.update(10, 0);
  return e.object.position.y > 11;
});
assert(balloon, 'The town has a balloon.');
// It darkens with the night like the town (no glow), on its own materials: nothing else dims.
{
  const { BALLOON_NIGHT_DIM } = await load('town-movers'),
    parts = balloon.object.children.filter((o) => o.isMesh),
    others = new Set();
  assert(BALLOON_NIGHT_DIM >= 0.3 && BALLOON_NIGHT_DIM < 1, 'The balloon hardly darkens at night.');
  city.traverse((o) => {
    if (o.isMesh && !parts.includes(o)) others.add(o.material);
  });
  balloon.update(0, 1);
  assert(parts.length > 0 && parts.every((o) => o.material.vertexColors), 'The balloon is batched.');
  for (const o of parts) {
    assert(!others.has(o.material), 'The balloon dims a material the town shares.');
    assert(Math.abs(o.material.color.r - (1 - BALLOON_NIGHT_DIM)) < 1e-6 && o.material.emissive.getHex() === 0, 'The balloon stays bright (or glows) at night.');
  }
  balloon.update(0, 0);
  for (const o of parts) assert.equal(o.material.color.getHex(), 0xffffff, 'The balloon is dimmed by day.');
}
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
// On the opening view (bearing pi/4 swayed by the idle drift's +-0.16, the hero's frame shift
// of -0.06) the balloon keeps to the top band at every common wide screen size: never behind
// the hero copy on the left (eyebrow to lede, as laid out at that size, 8 px to spare) or the
// News card on the right. The card is centred a little above the middle (translateY(-42%))
// and its height follows the news, so it is taken at its tallest, three items with pictures
// (400 px), not as it happens to be today.
{
  // Each size's hero copy box, and the News card's left and right.
  const screens = [
    { W: 1024, H: 768, copy: [41, 285, 721, 613], news: [693, 983] },
    { W: 1280, H: 720, copy: [51, 219, 731, 590], news: [922, 1229] },
    { W: 1280, H: 800, copy: [51, 288, 731, 670], news: [922, 1229] },
    { W: 1366, H: 768, copy: [55, 251, 735, 638], news: [984, 1311] },
    { W: 1440, H: 800, copy: [56, 271, 736, 670], news: [1038, 1384] },
    { W: 1440, H: 900, copy: [56, 360, 736, 770], news: [1038, 1384] },
    { W: 1536, H: 864, copy: [56, 322, 736, 734], news: [1120, 1480] },
    { W: 1600, H: 900, copy: [56, 357, 736, 770], news: [1184, 1544] },
    { W: 1680, H: 1050, copy: [56, 507, 736, 920], news: [1264, 1624] },
    { W: 1920, H: 1080, copy: [56, 537, 736, 950], news: [1504, 1864] },
  ];
  const bounds = new T.Box3(),
    corner = new T.Vector3(),
    yaw = Math.PI / 4;
  for (const { W, H, copy: [cx0, cy0, cx1, cy1], news: [nx0, nx1] } of screens) {
    const vertical = Math.max(53, (76 * H) / W),
      view = new T.OrthographicCamera((-vertical * W) / H / 2, (vertical * W) / H / 2, vertical / 2, -vertical / 2, -200, 180),
      shifted = new T.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(-0.06 * (view.right - view.left)),
      boxes = {
        'hero copy': [cx0 - 8, cy0 - 8, cx1 + 8, cy1 + 8],
        'News card': [nx0, H / 2 - 0.42 * 400, nx1, H / 2 + 0.58 * 400],
      };
    for (let t = 0; t < 900; t += 0.5) {
      balloon.update(t, 0);
      balloon.object.updateWorldMatrix(true, true);
      bounds.setFromObject(balloon.object);
      for (const drift of [-0.16, 0, 0.16]) {
        view.position.copy(shifted).add(new T.Vector3(Math.sin(yaw + drift) * 38, 35, Math.cos(yaw + drift) * 38));
        view.lookAt(shifted);
        view.updateMatrixWorld();
        let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
        for (let i = 0; i < 8; i++) {
          corner.set(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z).project(view);
          const x = ((corner.x + 1) / 2) * W, y = ((1 - corner.y) / 2) * H;
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
        for (const [name, [x0, y0, x1, y1]] of Object.entries(boxes))
          assert(right < x0 || left > x1 || bottom < y0 || top > y1, `At t=${t} the balloon drifts behind the ${name} on the ${W} x ${H} opening view.`);
      }
    }
  }
}
// The dinghy's mooring lines are static, so the ends buried at its fairleads must stay inside
// its hull (y -0.06 to 0.175, 0.31-0.38 half-wide) as it bobs and pitches.
{
  const d = model.animated.find((e) => e.object.name === 'harbour-dinghy');
  assert(d, 'The dinghy is named harbour-dinghy.');
  d.object.position.y = model.waterLevel; // the rest pose the lines were laid at
  d.object.rotation.x = 0;
  d.object.updateMatrixWorld(true);
  const ends = plan.harbour.lines.map((l) => d.object.localToWorld(new T.Vector3(...l.fairlead)));
  for (let t = 0; t <= 20; t += 0.1) {
    d.update(t, 0);
    d.object.updateMatrixWorld(true);
    for (const end of ends) {
      const { x, y, z } = d.object.worldToLocal(end.clone());
      assert(y > -0.02 && y < 0.14 && Math.abs(x) < 0.17 && z > -0.62 && z < 0.55, `A mooring line's end leaves the dinghy's hull at t=${t.toFixed(1)}: ${[x, y, z].map((v) => v.toFixed(3)).join(', ')}`);
    }
  }
}
// Inspect's copy of the Town Hall keeps time and turns its vane with the town: its four pairs
// of clock hands and its vane follow the originals the frame loop moves.
{
  const hall = model.models.get('town-hall').root,
    study = hall.clone(true),
    moving = new Set([...model.animated.map((e) => e.object), ...clocks.flatMap((c) => [c.hour, c.minute])]),
    pairs = pairMovingParts(hall, study, moving);
  assert.equal(pairs.length, 9, 'Inspect must find the hall’s eight clock hands and its vane.');
  for (const e of model.animated) e.update(37, 0);
  clocks.forEach((c, i) => {
    c.hour.rotation.z = -0.4 - i;
    c.minute.rotation.z = -2.1 - i;
  });
  followMovingParts(pairs);
  for (const [from, to] of pairs) {
    assert(from !== to && !hall.getObjectById(to.id), 'A copy is paired, not the original.');
    assert(to.quaternion.angleTo(from.quaternion) < 1e-6, 'The study copy’s clock or vane stands still.');
  }
  for (const [from] of pairs) from.rotation.set(0, 0, 0);
}
// The herd idles with five small animated meshes (three heads, two adult tails). At time 0, the
// pose reduced motion holds, cow-b looks up at the Life camera, cow-a feeds at the rack, the
// calf grazes and every tail hangs still.
const herdParts = model.animated.filter((e) => e.object.userData.herdPart);
assert.deepEqual(herdParts.map((e) => e.object.name).sort(), ['calf-head', 'cow-a-head', 'cow-a-tail', 'cow-b-head', 'cow-b-tail']);
for (const e of herdParts) e.update(0, 0);
const part = (name) => herdParts.find((e) => e.object.name === name).object;
assert(part('cow-b-head').rotation.x < 0, 'cow-b holds its head up.');
for (const name of ['cow-a-head', 'cow-b-head', 'calf-head'])
  assert(Math.abs(part(name).rotation.y) < 0.01 && Math.abs(part(name).rotation.z) < 0.01, name + ' looks straight ahead.');
assert(part('cow-a-head').rotation.x > 0.1 && part('cow-a-head').rotation.x < 0.25, 'cow-a feeds at the hay.');
assert(part('calf-head').rotation.x > 0.4, 'The calf grazes.');
for (const name of ['cow-a-tail', 'cow-b-tail']) assert(Math.abs(part(name).rotation.z) < 1e-9, name + ' hangs still.');
for (const e of herdParts) assert(e.object.children.length >= 1 && e.object.children.every((c) => c.isMesh), 'Batched: ' + e.object.name);
// The ducks on the gate's pool: each one mesh, its colours baked once (a hen's brightest red is
// its bill's top face, pantile x 1.04; a second bake would make it x 1.04 squared). Through two
// tips each, the body stays off the pool's bed (0.02) and the surface (0.07) cuts it between its
// lowest point and its centre (the group's origin): afloat, never on top of the water.
{
  const { palette } = await load('town-build');
  const ducks = model.animated.filter((e) => /^duck-\d$/.test(e.object.name));
  assert.deepEqual(ducks.map((e) => e.object.name), ['duck-0', 'duck-1', 'duck-2']);
  for (const e of ducks) assert(e.object.children.length === 1 && e.object.children[0].isMesh, `${e.object.name} is not one mesh`);
  const colour = ducks[0].object.children[0].geometry.getAttribute('color');
  let red = 0;
  for (let i = 0; i < colour.count; i++) red = Math.max(red, colour.getX(i));
  assert(Math.abs(red - new T.Color(palette.pantile).r * 1.04) < 1e-3, `duck-0's colours are baked ${red.toFixed(3)}, not once`);
  const corner = new T.Vector3();
  for (const e of ducks) {
    const mesh = e.object.children[0],
      position = mesh.geometry.getAttribute('position');
    for (let step = 0; step <= 1000; step++) {
      e.update(step * 0.05, 0);
      e.object.updateMatrixWorld(true);
      let low = Infinity;
      for (let i = 0; i < position.count; i++) low = Math.min(low, corner.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).y);
      assert(low >= 0.02, `${e.object.name} touches the pool's bed (${low.toFixed(3)}) at t=${(step * 0.05).toFixed(2)}`);
      assert(low < 0.07 && e.object.position.y > 0.07, `${e.object.name} floats on top of the water at t=${(step * 0.05).toFixed(2)}`);
    }
  }
}
// The people are batched part by part, as before (13 or 14 meshes each, the satchel's wood making
// the difference). The dog walker is one more of them; the dog is four meshes (its body, the only
// part that casts, its legs, its head and its tail) and keeps its pivots apart from its body.
{
  const meshesIn = (o) => {
    let n = 0;
    o.traverse((c) => (n += c.isMesh ? 1 : 0));
    return n;
  };
  for (const w of walkers) assert([13, 14].includes(meshesIn(w.root)), `A walker is ${meshesIn(w.root)} meshes`);
  const dogWalk = model.animated.find((e) => e.object.name === 'dog-walk');
  assert(dogWalk && dogWalk.object.userData.prebatched, 'The dog walk is batched with the people.');
  const [figure, dog] = dogWalk.object.children;
  assert.equal(dog.name, 'dog');
  assert([13, 14].includes(meshesIn(figure)), `The dog walker is ${meshesIn(figure)} meshes`);
  assert.equal(meshesIn(dog), 4, 'The dog is four meshes.');
  const cast = [];
  dog.traverse((c) => c.isMesh && c.castShadow && cast.push(c));
  assert(cast.length === 1 && cast[0].parent === dog, 'Only the dog’s body casts a shadow.');
  for (const name of ['dog-head', 'dog-tail']) assert(dog.getObjectByName(name).children.every((c) => c.isMesh), `${name} is batched`);
  // The cyclist: one rigid rig (the bike, the body and the arms, in a few batches and none of them
  // masonry, plus the lamp) and two pedalling legs, whose shoes stay on the crank's circle
  // (bike-local centre y 0.185, radius 0.065) all the way round.
  const cyclist = model.animated.find((e) => e.object.name === 'cyclist');
  assert(cyclist && cyclist.object.userData.prebatched, 'The cyclist is batched with the people.');
  const [rig, ...legs] = cyclist.object.children;
  assert.deepEqual(legs.map((l) => l.name), ['leg-left', 'leg-right']);
  assert(rig.children.every((c) => c.isMesh) && rig.children.length <= 5, 'The cyclist’s rig is a few batched meshes.');
  assert(!rig.children.some((c) => c.material.userData.surfaceKind === 'stone'), 'The cyclist’s rig has a stone batch.');
  assert.equal(rig.children.filter((c) => lamps.includes(c)).length, 1, 'The bike has one lamp.');
  assert.equal(meshesIn(cyclist.object), 10, `The cyclist is ${meshesIn(cyclist.object)} meshes`);
  const shoe = new T.Vector3();
  for (let t = 0; t < 4; t += 0.02) {
    cyclist.update(t, 0);
    cyclist.object.updateMatrixWorld(true);
    for (const leg of legs) {
      const knee = leg.getObjectByName('knee');
      cyclist.object.worldToLocal(knee.localToWorld(shoe.set(0, -0.135, 0.025)));
      assert(Math.abs(Math.hypot(shoe.z, shoe.y - 0.185) - 0.065) <= 0.005 && Math.abs(shoe.x) < 0.1, `The cyclist's ${leg.name} misses its pedal at t=${t.toFixed(2)}`);
    }
  }
}
// Moorland: a few heather drifts on the hills only, never on the mown town lawn, the terrace, the
// streets, the beach or within 1.0 of the herd's paddock, and thistles at the dyke's foot.
const nearPaddock = (x, z, margin) =>
  Math.abs(x - plan.paddock.x) < plan.paddock.w / 2 + margin && Math.abs(z - plan.paddock.z) < plan.paddock.d / 2 + margin;
const heather = plan.heatherPlan(trees);
assert(heather.length >= 8 && heather.length <= 12, 'Heather drifts: ' + heather.length);
for (const d of heather) {
  assert(plan.terrainHeight(d.x, d.z) > 0.2, `${d.id} is not on a hill`);
  for (const o of heather) assert(o === d || Math.hypot(o.x - d.x, o.z - d.z) >= 3.5, `${d.id} crowds ${o.id}`);
}
for (const d of heather)
  for (const l of d.lumps)
    for (const [ex, ez] of [[0, 0], [l.r, 0], [-l.r, 0], [0, l.r], [0, -l.r]]) {
      const x = l.x + ex,
        z = l.z + ez;
      assert(plan.onIsland(x, z, 0.2), `${d.id} runs onto the beach`);
      assert(plan.lawnCore(x, z) < 0.05, `${d.id} on the town lawn`);
      assert(plan.distanceToStreets(x, z) > 1.5, `${d.id} by a street`);
      assert(!nearPaddock(x, z, 1.0), `${d.id} in the paddock`);
      assert(!(Math.abs(x - row.x) < 5.5 && Math.abs(z - row.z) < row.spacing + 4), `${d.id} by the terrace`);
      for (const t of trees) assert(Math.hypot(t.x - x, t.z - z) > 0.3 * t.size, `${d.id} round the trunk of ${t.id}`);
    }
// Thistles grow at the dyke's foot: outside its outer face by more than a rosette, never more than half a unit out.
const outsideDyke = (x, z) =>
  Math.hypot(
    Math.max(0, Math.abs(x - plan.paddock.x) - plan.paddock.w / 2 - plan.paddock.wall / 2),
    Math.max(0, Math.abs(z - plan.paddock.z) - plan.paddock.d / 2 - plan.paddock.wall / 2),
  );
for (const [x, z] of plan.thistles) {
  assert(plan.onIsland(x, z, 1) && plan.lawnCore(x, z) < 0.02 && plan.distanceToStreets(x, z) > 2, `Thistle astray at ${x}, ${z}`);
  assert(outsideDyke(x, z) > 0.2, `Thistle in the dyke at ${x}, ${z}`);
  assert(outsideDyke(x, z) < 0.5, `Thistle astray from the dyke at ${x}, ${z}`);
}
// Blackface sheep graze the two empty hilltops, clear of the trees, the shore, the streets and the
// cottages, and every hoof stands on (or just in) the built ground: none floats over the slope.
const grass = [],
  fabric = [];
city.traverse((o) => {
  if (o.isMesh && o.material.userData?.surfaceKind === 'grass') grass.push(o);
  if (o.isMesh && o.material.userData?.surfaceKind === 'fabric') fabric.push(o);
});
assert(plan.flock.length === 5, 'Five sheep: ' + plan.flock.length);
for (const s of plan.flock) {
  assert(plan.terrainHeight(s.x, s.z) > 0.2, `${s.id} is not on a hill`);
  assert(plan.islandRadius(Math.atan2(s.z, s.x)) - Math.hypot(s.x, s.z) > 1.6, `${s.id} by the shore`);
  assert(plan.distanceToStreets(s.x, s.z) > 7, `${s.id} by a street`);
  for (const c of plan.cottages) assert(Math.hypot(c.x - s.x, c.z - s.z) > 9.5, `${s.id} by a cottage`);
  for (const t of trees) assert(Math.hypot(t.x - s.x, t.z - s.z) - 0.9 * t.size - 0.35 > 0.9, `${s.id} under ${t.id}`);
  for (const [x, z] of plan.sheepFeet(s)) {
    ray.set(new T.Vector3(x, 10, z), new T.Vector3(0, -1, 0));
    const ground = ray.intersectObjects(grass, false)[0];
    assert(ground, `No ground under ${s.id}`);
    // The leg's underside, found from below the ground (the turf is one-sided).
    ray.set(new T.Vector3(x, ground.point.y - 0.5, z), new T.Vector3(0, 1, 0));
    const leg = ray.intersectObjects(fabric, false)[0];
    assert(leg && leg.point.y < ground.point.y + 0.3, `${s.id} has no leg at ${x.toFixed(2)}, ${z.toFixed(2)}`);
    const above = leg.point.y - ground.point.y;
    assert(above <= 0.005, `${s.id} has a hoof ${above.toFixed(3)} above the ground`);
    assert(above > -0.15, `${s.id} has a hoof sunk ${(-above).toFixed(3)} into the hill`);
  }
}
// From the opening bearing no sheep seems to perch on a tree: hooves that land on screen within 0.9
// of a nearer tree's axis and from 0.5 below to 0.6 above its top read as standing on the canopy.
// The camera looks down at atan(35 / 38), as viewOffset in city-scene.ts places it.
{
  const yaw = plan.chapterBearings.overview,
    rise = Math.atan2(35, 38);
  for (const s of plan.flock)
    for (const t of trees) {
      const dx = t.x - s.x,
        dz = t.z - s.z,
        nearer = dx * Math.sin(yaw) + dz * Math.cos(yaw),
        across = dx * Math.cos(yaw) - dz * Math.sin(yaw),
        // A pine's tip is at 2.27 x size; a round crown tops out at about 2.39 x size.
        top = plan.terrainHeight(t.x, t.z) - plan.terrainHeight(s.x, s.z) + (t.kind === 'pine' ? 2.27 : 2.39) * t.size,
        onScreen = top * Math.cos(rise) - nearer * Math.sin(rise);
      assert(
        !(nearer > 0 && Math.abs(across) < 0.9 && onScreen > -0.5 && onScreen < 0.6),
        `${s.id} seems to stand on top of ${t.id} from the opening bearing (${across.toFixed(2)} across, ${onScreen.toFixed(2)} up)`,
      );
    }
}
// The standing stones ring the north-west headland on flat grass, clear of the canopies; seven
// stones on eight slots, one of them recumbent.
const stones = plan.standingStones();
assert.equal(stones.length, 7, 'Seven standing stones');
assert.equal(stones.filter((s) => s.recumbent).length, 1, 'One recumbent stone');
for (const s of stones) {
  assert(plan.onIsland(s.x, s.z, 0.8), `A standing stone on the beach at ${s.x.toFixed(2)}, ${s.z.toFixed(2)}`);
  assert(plan.terrainHeight(s.x, s.z) < 0.01, 'The stone ring stands on flat ground');
  for (const t of trees) assert(Math.hypot(t.x - s.x, t.z - s.z) - 0.9 * t.size > 0.6, `A standing stone under ${t.id}`);
}
// The Duke of Wellington stands on the civic lawn on flat ground: his 1.6 pad stays off the streets
// and the canopies, well clear of the hall, never in front of it and never on the plaza.
{
  const [x, z] = plan.statueSpot,
    hall = plan.sites['town-hall'],
    pad = 1.6;
  assert(plan.distanceToStreets(x, z) > pad + 2, 'The statue crowds a street');
  assert(Math.hypot(x, z) > plan.PLAZA_RADIUS + 5, 'The statue crowds the plaza');
  for (const [dx, dz] of [[0, 0], [pad, 0], [-pad, 0], [0, pad], [0, -pad]])
    assert(plan.terrainHeight(x + dx, z + dz) < 0.01, 'The statue stands on a slope');
  const outX = Math.max(0, Math.abs(x - hall.x) - hall.w / 2),
    outZ = Math.max(0, Math.abs(z - hall.z) - hall.d / 2);
  assert(Math.hypot(outX, outZ) > 5, 'The statue crowds the Town Hall');
  assert(Math.abs(x - hall.x) > hall.w / 2 + pad + 2, 'The statue stands in front of the Town Hall');
  for (const t of trees) assert(Math.hypot(t.x - x, t.z - z) - 0.9 * t.size > pad + 0.3, `The statue under ${t.id}`);
}
// Heather keeps its own season in muted colours: a mauve bloom in late summer and autumn only.
const { heatherLook } = await load('town-build');
const hsv = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255),
    max = Math.max(r, g, b),
    d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: max ? d / max : 0 };
};
for (const season of ['spring', 'summer', 'autumn', 'winter']) {
  const look = heatherLook(season),
    bloom = hsv(look.bloom);
  assert(bloom.s <= 0.45 && hsv(look.stem).s <= 0.5, `${season} heather is too loud`);
  const mauve = bloom.h > 270 && bloom.h < 320;
  assert.equal(mauve, season === 'summer' || season === 'autumn', `${season} heather ${mauve ? 'blooms' : 'does not bloom'}`);
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
// Seeded by id, as the build plants them (pines keep their own look).
const looks = (season) => new Set(trees.flatMap((t) => (t.kind === 'pine' ? [] : [treeLook(t, Number(t.id.slice(5)), season).top])));
const blossomTop = '#fdd9e3',
  autumnTop = '#f2c862';
assert(looks('spring').has(blossomTop) && !looks('spring').has(autumnTop), 'Spring blossoms and does not turn.');
assert(looks('autumn').has(autumnTop) && !looks('autumn').has(blossomTop), 'Autumn turns and does not blossom.');
for (const season of ['summer', 'winter'])
  assert(!looks(season).has(blossomTop) && !looks(season).has(autumnTop), season + ' trees stay green.');
// The key light stays high all day, comes down to about 40 degrees at dawn and golden hour, and
// goes back up for the night light.
const { sunOffsetFor, lowSun, warmSun } = await load('city-atmosphere');
const degrees = (v) => (Math.atan2(v.y, Math.hypot(v.x, v.z)) * 180) / Math.PI,
  rad = (d) => (d * Math.PI) / 180;
assert(degrees(sunOffsetFor(rad(30), Math.PI)) > 50, 'A high key light by day.');
assert(Math.abs(degrees(sunOffsetFor(rad(2), Math.PI * 1.5)) - 40) < 1.5, 'A low key light at golden hour.');
assert(degrees(sunOffsetFor(rad(-12), Math.PI * 1.6)) > 49, 'The night light stays high.');
assert.equal(lowSun(rad(15)), 0);
assert.equal(lowSun(rad(2)), 1);
assert.equal(lowSun(rad(-10)), 0);
// The key light's sideways swing follows the sun round smoothly: by day as before (0.28 of the
// sun's bearing from south), and through north at night with no jump as the azimuth wraps from
// 360 to 0 degrees, or as the UTC day turns over before solar midnight.
{
  const { glasgowSky } = await load('glasgow-sun');
  const turn = (a, b) => Math.acos(Math.min(1, a.clone().normalize().dot(b.clone().normalize()))) / rad(1);
  for (let azimuth = Math.PI - 2.2; azimuth <= Math.PI + 2.2; azimuth += 0.1) {
    const [x, , z] = sunOffsetFor(rad(30), azimuth).toArray();
    assert(Math.abs(Math.atan2(x, z) - Math.atan2(-16, 20) - 0.28 * (azimuth - Math.PI)) < 1e-9, 'The daytime swing is unchanged.');
  }
  for (let azimuth = 0; azimuth < Math.PI * 2; azimuth += 0.01)
    assert(turn(sunOffsetFor(rad(-12), azimuth), sunOffsetFor(rad(-12), azimuth + 0.01)) < 0.5, `The key light jumps at azimuth ${azimuth.toFixed(2)}.`);
  // The real sun through the night, a minute at a time across 00:00 UTC and solar midnight: it
  // keeps to its side of north until it crosses, and the key light never jumps.
  for (const day of ['2026-02-11', '2026-06-21', '2026-10-14', '2026-11-03', '2026-12-21']) {
    let crossed = 0,
      before = glasgowSky(new Date(Date.parse(`${day}T22:00:00Z`)));
    for (let minute = 1; minute <= 240; minute++) {
      const after = glasgowSky(new Date(Date.parse(`${day}T22:00:00Z`) + minute * 60000)),
        moved = Math.abs(Math.atan2(Math.sin(after.azimuth - before.azimuth), Math.cos(after.azimuth - before.azimuth)));
      assert(moved < rad(1), `The sun jumps ${(moved / rad(1)).toFixed(1)} degrees round at minute ${minute} after 22:00 UTC on ${day}.`);
      if (before.azimuth > Math.PI && after.azimuth < Math.PI) crossed++;
      assert(
        turn(sunOffsetFor(before.elevation, before.azimuth), sunOffsetFor(after.elevation, after.azimuth)) < 0.5,
        `The key light swings at minute ${minute} after 22:00 UTC on ${day}.`,
      );
      before = after;
    }
    assert.equal(crossed, 1, 'The check must see the sun cross north once.');
  }
}
// The gulls sit out the night and the rain, shrinking away as either eases in rather than all
// vanishing in one frame.
{
  const { gullPresence, createGulls } = await load('city-atmosphere');
  assert.equal(gullPresence(0, 0), 1);
  assert.equal(gullPresence(1, 0), 0);
  assert.equal(gullPresence(0, 1), 0);
  for (const [name, at] of Object.entries({ night: (v) => gullPresence(v, 0), rain: (v) => gullPresence(0, v) }))
    for (let v = 0; v < 1; v += 0.01)
      assert(Math.abs(at(v + 0.01) - at(v)) < 0.06, `The gulls pop out of sight as the ${name} comes on (at ${v.toFixed(2)}).`);
  const birds = createGulls();
  birds.update(3, 0.4);
  assert(birds.object.children.every((bird) => Math.abs(bird.scale.x - 0.4) < 1e-9), 'The gulls shrink with their presence.');
  birds.dispose();
}
// Manual Day is plain daylight at every hour: never the real sun's golden hour or its warm low
// light, the key light high. Auto and Night keep the real sun.
{
  const { sceneSky } = await load('use-sky');
  const { glasgowSky } = await load('glasgow-sun');
  for (const month of [0, 5, 9])
    for (let minute = 0; minute < 24 * 60; minute += 20) {
      const real = glasgowSky(new Date(Date.UTC(2026, month, 14, 0, minute))),
        day = sceneSky(real, 'day');
      assert.equal(day.night, 0);
      assert.equal(lowSun(day.elevation), 0, `Manual Day at ${real.clock} has a golden-hour sun.`);
      assert.equal(warmSun(day.elevation), 0, `Manual Day at ${real.clock} has a warm low sun.`);
      assert(degrees(sunOffsetFor(day.elevation, day.azimuth)) > 50, 'Manual Day keeps a high key light.');
      for (const mode of ['auto', 'night']) {
        const lit = sceneSky(real, mode);
        assert.deepEqual([lit.elevation, lit.azimuth], [real.elevation, real.azimuth]);
      }
    }
}
// The windows' night clock: evening until 22:00, panes going out until 02:30, early risers from
// 05:30 to 07:30, reset unseen at noon. The follower only moves forward in the dark, holds through
// twilight and the autumn clock change, and copies the clock by day and at the noon reset.
{
  for (const h of [21.9, 12, 17.5]) assert.deepEqual(windowClock(h), { out: 0, wake: 0 }, `The windows' night has begun at ${h}.`);
  assert.equal(windowClock(2.5).out, 1, 'Every pane that goes out is out by 02:30.');
  assert.equal(windowClock(7.5).wake, 1, 'Every early riser is up by 07:30.');
  const follow = (from, goal, night, dt, snap) => {
    const state = { ...from };
    followWindows(state, goal, night, dt, snap);
    return state;
  };
  const early = { out: 0.1, wake: 0.1 },
    ahead = { out: 0.3, wake: 0.3 };
  for (const snap of [false, true]) {
    assert.deepEqual(follow(early, ahead, 0.6, 1, snap), early, 'No pane goes out at dusk.');
    assert.deepEqual(follow({ out: 0.5, wake: 0 }, { out: 0.3, wake: 0 }, 1, 1, snap), { out: 0.5, wake: 0 }, 'The panes hold when the clocks go back.');
  }
  const moved = follow(early, ahead, 1, 1, false);
  assert(Math.abs(moved.out - 0.1 - WINDOW_RATE) < 1e-12 && Math.abs(moved.wake - 0.1 - WINDOW_RATE) < 1e-12, 'The panes follow at WINDOW_RATE.');
  assert.deepEqual(follow(early, ahead, 1, 1, true), ahead, 'Reduced motion jumps to the clock.');
  assert.deepEqual(follow({ out: 0.5, wake: 0.2 }, { out: 0.3, wake: 0 }, 0.01, 1, false), { out: 0.3, wake: 0 }, 'By day the panes copy the clock.');
  assert.deepEqual(follow({ out: 1, wake: 1 }, { out: 0, wake: 0 }, 1, 1, false), { out: 0, wake: 0 }, 'Manual night resets at noon.');
}
// Through the night (20:00 to 07:30 in 20 s steps): the rooms go out one at a time until 05:30 and
// never come back on, then early risers come on one at a time; every pane rests fully on or off,
// none outshines today's glow, and the clock always rests on its settle points.
const outBytes = panes.map((p) => Math.round(p.light[2] * 255)).filter((b) => b < 255),
  wakeBytes = panes.map((p) => Math.round(p.light[3] * 255)).filter((b) => b < 255);
assert.equal(new Set(outBytes).size, outBytes.length, 'Two panes go out together.');
assert.equal(new Set(wakeBytes).size, wakeBytes.length, 'Two early risers come on together.');
const atRest = (p, level) => [0, p.light[0], 0.8].some((v) => Math.abs(level - v) < 0.01);
{
  const dialY = Y(windowGlow(panes.find((p) => p.role === 'dial').light, at(20))),
    evening = lit(rooms, 20).length,
    settled = (v) => v === 0 || v === 1 || Math.abs(((v * 255) % 1) - 0.6) < 1e-6;
  let before = evening,
    late = -1;
  for (let s = 0; s <= 11.5 * 180; s++) {
    const h = (20 + s / 180) % 24,
      clock = at(h),
      count = lit(rooms, h).length;
    assert(Math.abs(count - before) <= 1, `${Math.abs(count - before)} rooms switch at once at ${h.toFixed(3)}.`);
    if (s >= 9.5 * 180) assert(count >= before, `A room goes out after 05:30 (${h.toFixed(3)}).`);
    else assert(count <= before, `A room comes back on before 05:30 (${h.toFixed(3)}).`);
    if (s === 6.5 * 180) late = count;
    assert(settled(clock.out) && settled(clock.wake), `The window clock is between its rest points at ${h.toFixed(3)}.`);
    for (const p of panes) {
      assert(atRest(p, windowLevel(p.light, clock)), `A pane at ${p.place} rests part-way at ${h.toFixed(3)}.`);
      assert(Y(windowGlow(p.light, clock)) <= dialY + 1e-6, `A pane at ${p.place} outshines today's glow at ${h.toFixed(3)}.`);
    }
    before = count;
  }
  assert(late >= 0.3 * evening && late <= 0.75 * evening, `${late} of the evening's ${evening} lit rooms are still lit at 02:30.`);
}
// The page's cadence from 20:00 to 07:30: the sky every 30 s, its clock a minute at a time, and
// 1800 frames of the follower after each. Every pane rests fully on or off after each 30 s, and
// each switch (a pane going out, or an early riser coming on) is a lamp switched, not a dimmer or
// a pop: about 2 s between 10% and 90%, all within one 30 s. Bytes are unique, so per frame only the
// pane whose off byte the clock is in and the one whose wake byte it is in can be mid-switch.
{
  const state = windowClock(20),
    goingOut = new Map(panes.filter((p) => p.light[2] < 1).map((p) => [Math.round(p.light[2] * 255), p])),
    waking = new Map(panes.filter((p) => p.light[3] < 1).map((p) => [Math.round(p.light[3] * 255), p])),
    switches = new Map();
  let call = 0;
  for (let minute = 0; minute <= 690; minute++) {
    const goal = windowClock(((1200 + minute) / 60) % 24);
    for (let twice = 0; twice < 2; twice++, call++) {
      for (let frame = 0; frame < 1800; frame++) {
        followWindows(state, goal, 1, 1 / 60, false);
        const out = Math.floor(state.out * 255),
          wake = Math.floor(state.wake * 255);
        for (const [key, p, of] of [
          ['out ' + out, goingOut.get(out), (p) => windowLevel(p.light, state) / p.light[0]],
          ['wake ' + wake, waking.get(wake), (p) => windowLevel(p.light, state) / 0.8],
        ]) {
          if (!p) continue;
          const fraction = of(p);
          if (fraction <= 0.1 || fraction >= 0.9) continue;
          const seen = switches.get(key) ?? { frames: 0, calls: new Set() };
          seen.frames++;
          seen.calls.add(call);
          switches.set(key, seen);
        }
      }
      for (const p of panes) assert(atRest(p, windowLevel(p.light, state)), `A pane at ${p.place} rests part-way after call ${call}.`);
    }
  }
  for (const key of [...[...goingOut.keys()].map((b) => 'out ' + b), ...[...waking.keys()].map((b) => 'wake ' + b)]) {
    const seen = switches.get(key);
    assert(seen && seen.frames >= 115 && seen.frames <= 128 && seen.calls.size === 1, `The pane at ${key} switches over ${seen?.frames ?? 0} frames in ${seen?.calls.size ?? 0} calls.`);
  }
}
console.log(
  `Town checks passed: 7 sites on the island, ${districts.length} plan districts above the paving around their places, ${trees.length} trees off the streets, a boat that stays afloat, ${meshes} meshes / ${Math.round(triangles)} triangles built in ${Math.round(ms)} ms (or in ${phaseNames.length + 1} phases of at most ${Math.round(longestPhase)} ms), one shell per building with a fitted close-up, clickable buildings, open sea, a lighthouse beam that stays over it, windows lit pane by pane that go out one at a time through the night, a balloon out over the shore, trees that keep the season and a low golden-hour sun.`,
);
