import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as T from 'three';

// Build the town in Node and check what a visitor relies on: eleven places (eight on the island, the airport on its own, the sky island over the sea, the tropic island on it off the south shore), finite geometry, a sane triangle budget, hover targets, water, the lighthouse beam and night.
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
  'sky-figure',
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
const { buildCityModel, pairMovingParts, followMovingParts, addHitBoxes, pickTarget } = await load('city-scene');
const { fitStudy } = await load('city-inspection');
const { createStreetLighting } = await load('city-lighting');
const { createIslandWater } = await load('city-water');

assert.equal(new Set(buildings.map((b) => b.id)).size, 11);
// The Directory's (and the tour's) order: the sky island comes after the residence, the tropic
// island after it and the airport after that (the three share a bearing, so the tour turns no more
// for them), before the studio.
assert.deepEqual(buildings.map((b) => b.id), ['lius-gate', 'town-hall', 'pengyuan-liu', 'yunlong-liu', 'qin-li', 'visiting-phd', 'sky-island', 'tropic-island', 'airport', 'research-studio', 'city-archive']);
// The People chapter's places: the three homes (the row's own checks below read plan.terraceHomes)
// and the Visiting PhD Residence at the row's north end.
assert.deepEqual(plan.chapterSubjects.people, [...plan.terraceHomes, 'visiting-phd']);
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
// Sites sit on the island (the airport's on its own island, inside its deck; the sky island's on
// its own deck, up in the air; the tropic island's at its own island's middle, at sea level, out on
// the sea off the south shore), off the streets, and never overlap one another.
for (const site of plan.siteList) {
  if (site.id === 'airport') assert(plan.onAirport(site.x, site.z, -2) && !plan.onIsland(site.x, site.z), 'The airport is not on its own island.');
  else if (site.id === 'tropic-island') assert(site.x === plan.TROPIC.x && site.z === plan.TROPIC.z && site.rotation === 0 && !site.y && plan.onTropic(site.x, site.z, -9) && !plan.onIsland(site.x, site.z, -3.3) && !plan.onAirport(site.x, site.z, 30), 'The tropic island\'s site is not at its own island\'s middle.');
  else if (site.id === 'sky-island') assert(plan.onSky(site.x, site.z, -2) && !plan.onIsland(site.x, site.z, -3.3) && !plan.onAirport(site.x, site.z, 5) && site.y === plan.SKY.top, 'The sky island\'s villa is not on its own deck.');
  else assert(plan.onIsland(site.x, site.z, 2) && !site.y, 'Site in the sea: ' + site.id);
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
  assert.deepEqual([...lean].sort((a, b) => Number(a) - Number(b)), [false, true], 'The cyclist rides straights upright and leans on the corners.');
}
// Traffic signals: the UK sequence at every junction, the ring and avenue opposed with an all-red
// between them, one period for all three and offsets that never hold all three rings on red.
const { SIGNAL, LAP, signalState, signalJunctions, signalPosts, stopLines, STOP_LINE, TRAM_TIMETABLE, CYCLIST_TIMETABLE } = plan;
{
  const P = SIGNAL.period,
    ids = signalJunctions.map((j) => j.id);
  assert.deepEqual([...ids].sort(), ['east', 'south', 'west'], 'Signals at the three ring junctions, none at the north avenue.');
  assert.equal(P, SIGNAL.ringGreen + SIGNAL.avenueGreen + 2 * (SIGNAL.amber + SIGNAL.allRed + SIGNAL.redAmber));
  assert(P >= 20 && P <= 24 && SIGNAL.ringGreen > SIGNAL.avenueGreen, 'A 20-24 s cycle with the ring the larger share of green.');
  assert(SIGNAL.amber === 3 && SIGNAL.redAmber === 2 && SIGNAL.allRed === 1, 'UK timings: amber 3 s, red+amber 2 s, all-red 1 s.');
  assert(Number.isInteger(LAP / P) && LAP / P >= 2, `A lap (${LAP} s) is a whole number of cycles.`);
  const step = 0.01,
    order = ['green', 'amber', 'red', 'redAmber'];
  for (const id of ids) {
    // Runs of each approach's aspect over one cycle, started where the ring's green comes on.
    const runs = { ring: [], avenue: [] };
    let bothRed = 0;
    for (let k = 0; k < P / step; k++) {
      const t = plan.signalOffsets[id] + (k + 0.5) * step;
      for (const approach of ['ring', 'avenue']) {
        const aspect = signalState(id, approach, t),
          list = runs[approach];
        assert.equal(aspect, signalState(id, approach, t + P * 7), `${id} ${approach} is not periodic.`);
        if (list.at(-1)?.aspect === aspect) list.at(-1).time += step;
        else list.push({ aspect, time: step });
      }
      const ring = signalState(id, 'ring', t),
        avenue = signalState(id, 'avenue', t);
      assert(ring === 'red' || avenue === 'red', `At ${id} both approaches may go at t=${t.toFixed(2)} (${ring}, ${avenue}).`);
      if (ring === 'red' && avenue === 'red') bothRed += step;
    }
    for (const [approach, list] of Object.entries(runs)) {
      if (list.length > 4 && list[0].aspect === list.at(-1).aspect) list[0].time += list.pop().time;
      const start = list.findIndex((r) => r.aspect === 'green');
      const cycle = [...list.slice(start), ...list.slice(0, start)];
      assert.deepEqual(cycle.map((r) => r.aspect), order, `${id} ${approach} runs ${cycle.map((r) => r.aspect).join(', ')}, not the UK sequence.`);
      const time = Object.fromEntries(cycle.map((r) => [r.aspect, r.time]));
      assert(Math.abs(time.amber - SIGNAL.amber) < 0.02 && Math.abs(time.redAmber - SIGNAL.redAmber) < 0.02, `${id} ${approach}: amber ${time.amber.toFixed(2)} s, red+amber ${time.redAmber.toFixed(2)} s.`);
      assert(Math.abs(time.green - (approach === 'ring' ? SIGNAL.ringGreen : SIGNAL.avenueGreen)) < 0.02, `${id} ${approach}: green ${time.green.toFixed(2)} s.`);
    }
    assert(Math.abs(bothRed - 2 * SIGNAL.allRed) < 0.03, `${id} has ${bothRed.toFixed(2)} s of all-red a cycle.`);
  }
  for (let t = 0; t < P; t += step)
    assert(!ids.every((id) => ['red', 'redAmber'].includes(signalState(id, 'ring', t))), `All three ring approaches are red at t=${t.toFixed(2)}.`);
}
// The rules of the road, frame by frame at 60 fps over five laps: each vehicle's distance only ever
// grows, eased in and out of one stop a lap at the east junction (never an instant stop or start,
// never creeping), its front at the stop line; it crosses a ring stop line only on green (or on
// amber past the point where it could have stopped); every lap is the same and takes LAP seconds;
// and the tram and the cyclist stay 20 apart.
{
  const P = SIGNAL.period,
    dt = 1 / 60,
    lineEdge = (l) => [l.x - l.along[0] * (STOP_LINE.width / 2), l.z - l.along[1] * (STOP_LINE.width / 2)],
    ringLines = stopLines.filter((l) => l.approach === 'ring');
  // The cyclist's pose at time 0 (the one reduced motion holds) is where it always was.
  const laneLength = plan.polylineLength(plan.cyclistLane, true),
    was = plan.samplePolyline(plan.cyclistLane, laneLength / 2 + 1.5, true, true),
    now = plan.cyclistPose(0);
  assert(Math.hypot(now.x - was.x, now.z - was.z) < 1e-9 && Math.abs(now.heading - was.heading) < 1e-9 && Math.abs(now.crank - Math.PI / 2) < 1e-9, 'The cyclist’s pose at time 0 moved out of the Life chapter’s view.');
  for (const { name, tt, pose, distance } of [
    { name: 'tram', tt: TRAM_TIMETABLE, pose: plan.tramPose, distance: plan.tramDistance },
    { name: 'cyclist', tt: CYCLIST_TIMETABLE, pose: plan.cyclistPose, distance: plan.cyclistDistance },
  ]) {
    assert(tt.wait > 2 && Math.abs(tt.pulling + tt.cruising + tt.braking + tt.wait - LAP) < 1e-9, `The ${name}'s lap is not ${LAP} s with a wait (${tt.wait.toFixed(2)} s).`);
    assert(tt.brake >= 1 && tt.brake <= 1.5 && tt.pull >= 1 && tt.pull <= 1.5, `The ${name} brakes or pulls away over ${tt.brake}, ${tt.pull}.`);
    // Smoothstep easing peaks at 1.5 x speed / ramp time = 0.75 speed² / distance.
    const most = (0.75 * tt.speed * tt.speed) / Math.min(tt.brake, tt.pull);
    const front = (p) => [p.x + Math.sin(p.heading) * tt.nose, p.z + Math.cos(p.heading) * tt.nose];
    let before = distance(0),
      speedBefore = (distance(dt) - distance(-dt)) / (2 * dt),
      standing = 0,
      slow = 0,
      peak = 0;
    const stops = [],
      fronts = new Map(ringLines.map((l) => [l, null]));
    for (let f = 0; f <= 5 * LAP * 60; f++) {
      const t = f * dt,
        d = distance(t),
        p = pose(t),
        q = pose(t + LAP);
      assert(Math.hypot(p.x - q.x, p.z - q.z) < 1e-7 && Math.abs(plan.angleDiff(p.heading, q.heading)) < 1e-7, `The ${name}'s lap from t=${t.toFixed(2)} differs from the next.`);
      const speed = (distance(t + dt) - distance(t - dt)) / (2 * dt);
      assert(d - before >= 0 && speed >= 0, `The ${name} rolls back at t=${t.toFixed(2)}.`);
      if (f) {
        const accel = Math.abs(speed - speedBefore) / dt;
        peak = Math.max(peak, accel);
        assert(accel <= most * 1.02 + 1e-6, `The ${name} changes speed by ${accel.toFixed(2)} a second² at t=${t.toFixed(2)} (most ${most.toFixed(2)}).`);
      }
      if (d === before && f) standing++;
      else {
        if (standing >= 60) stops.push({ until: t, frames: standing, front: front(pose(t - dt)) });
        standing = 0;
      }
      if (speed > 0 && speed < 0.1 * tt.speed) slow++;
      // Crossing a ring stop line's near edge, front first.
      const [fx, fz] = front(p);
      for (const l of ringLines) {
        const [ex, ez] = lineEdge(l),
          ahead = (fx - ex) * l.along[0] + (fz - ez) * l.along[1],
          across = Math.abs((fx - l.x) * l.along[1] - (fz - l.z) * l.along[0]),
          last = fronts.get(l);
        if (across < plan.ROAD_WIDTH / 2 && last !== null && last <= 0 && ahead > 0) {
          const aspect = signalState(l.junction, 'ring', t);
          if (aspect === 'amber') {
            // Allowed only past the point where it could have stopped: its front was under one braking distance short when the amber came on.
            let amberOn = t;
            while (signalState(l.junction, 'ring', amberOn - 0.01) === 'amber') amberOn -= 0.01;
            const back = front(pose(amberOn)),
              short = (ex - back[0]) * l.along[0] + (ez - back[1]) * l.along[1];
            assert(short < tt.brake, `The ${name} runs the amber at ${l.junction}, t=${t.toFixed(2)}.`);
          } else assert.equal(aspect, 'green', `The ${name} crosses the ${l.junction} stop line on ${aspect} at t=${t.toFixed(2)}.`);
        }
        fronts.set(l, across < plan.ROAD_WIDTH / 2 ? ahead : null);
      }
      before = d;
      speedBefore = speed;
    }
    assert(peak > 0.5 * most, `The ${name} never brakes.`);
    // One stop a lap, at the east junction's stop line, on red, moving off on green.
    assert.equal(stops.length, 5, `The ${name} stops ${stops.length} times in five laps.`);
    const east = ringLines.find((l) => l.junction === plan.STOP_JUNCTION),
      [ex, ez] = lineEdge(east);
    for (const s of stops) {
      const short = (ex - s.front[0]) * east.along[0] + (ez - s.front[1]) * east.along[1];
      assert(short >= 0 && short <= 0.1, `The ${name} stops ${short.toFixed(3)} short of the ${east.junction} stop line.`);
      const arrived = s.until - s.frames * dt,
        braking = arrived - tt.braking;
      assert(['red', 'amber'].includes(signalState(east.junction, 'ring', braking + 1e-6)), `The ${name} brakes for a ${signalState(east.junction, 'ring', braking)} light.`);
      for (let t = arrived; t < s.until - 0.6; t += 0.05) assert.notEqual(signalState(east.junction, 'ring', t), 'green', `The ${name} waits on green at t=${t.toFixed(2)}.`);
      assert.equal(signalState(east.junction, 'ring', s.until), 'green', `The ${name} moves off on ${signalState(east.junction, 'ring', s.until)}.`);
    }
    // Easing passes through low speeds only briefly (under a tenth of the cruise for a fifth of each
    // ramp): no creeping up to the line or away from it.
    assert(slow * dt <= 5 * 0.25 * (tt.pulling + tt.braking), `The ${name} creeps for ${(slow * dt).toFixed(2)} s.`);
    // Far into the day the timetable still repeats.
    for (const t of [86400 * 7 + 13.37, 3e6 + 41.2]) {
      const a = pose(t),
        b = pose(t % LAP);
      assert(Math.hypot(a.x - b.x, a.z - b.z) < 1e-4, `The ${name} drifts after ${t} s.`);
    }
  }
  for (let f = 0; f <= 5 * LAP * 60; f++) {
    const t = f * dt,
      a = plan.tramPose(t),
      b = plan.cyclistPose(t);
    assert(Math.hypot(a.x - b.x, a.z - b.z) >= 20, `The cyclist comes within 20 of the tram at t=${t.toFixed(2)}.`);
  }
  // Both vehicles meet the south and west junctions on green with room either side, and the signals
  // wait for nobody: the cyclist reaches the stop junction a cycle before the tram.
  assert.equal(((((TRAM_TIMETABLE.go - CYCLIST_TIMETABLE.go) % LAP) + LAP) % LAP).toFixed(9), P.toFixed(9), 'The tram moves off a cycle after the cyclist.');
}
// The signals stand on the pavements just past their stop lines, close to the kerb and clear of the
// walkers, the lamps, the trees, the benches and bins, the zebras, the cycle lane, the tram's swept
// body and the terrace's clearing; the stop lines lie on the carriageway, off the zebras.
{
  const R = plan.ROAD_WIDTH,
    lamps = plan.lampPlan(),
    walks = [plan.walkLoop(1.62), plan.walkLoop(-1.62)],
    zebras = signalJunctions.map((j) => {
      const along = j.length - (R / 2 + plan.PAVEMENT_WIDTH / 2);
      return { j, x: j.from[0] + j.u[0] * along, z: j.from[1] + j.u[1] * along };
    }),
    // A zebra's block: 0.9 along its avenue, 1.32 across it.
    toZebra = (x, z, { j, x: zx, z: zz }) => {
      const a = Math.abs((x - zx) * j.u[0] + (z - zz) * j.u[1]) - 0.45,
        c = Math.abs((x - zx) * j.u[1] - (z - zz) * j.u[0]) - 0.66;
      return Math.hypot(Math.max(a, 0), Math.max(c, 0)) + Math.min(Math.max(a, c), 0);
    },
    { park } = plan,
    seats = [[0.9, 4.9], [-4.9, 0.9], [park.x + 3.3, park.z + 2.2], [park.x - 2.6, park.z + 2.1], [park.x + 1.4, park.z + 2.1]];
  assert.equal(signalPosts.length, 6, 'Two signals at each of the three junctions.');
  // The post's corners at its foot (0.2 square) and its backboard's (0.43 wide, from 1.03 up).
  const corners = (p, half, back) => {
    const c = Math.cos(p.heading),
      s = Math.sin(p.heading);
    return [[-half, -back], [half, -back], [-half, half], [half, half]].map(([lx, lz]) => [p.x + lx * c + lz * s, p.z - lx * s + lz * c]);
  };
  const tramBody = [];
  for (let t = 0; t < LAP; t += 0.05) tramBody.push(plan.tramPose(t));
  for (const p of signalPosts) {
    const name = `${p.junction} ${p.approach} signal`,
      foot = corners(p, 0.1, 0.1),
      board = corners(p, 0.215, 0.14);
    const ringOff = plan.distanceToPolyline([p.x, p.z], plan.ringLine, true),
      j = signalJunctions.find((q) => q.id === p.junction),
      avenueOff = plan.distanceToSegment([p.x, p.z], j.from, j.at);
    if (p.approach === 'ring') assert(ringOff - 0.1 >= R / 2 + 0.18 && ringOff + 0.1 <= R / 2 + plan.PAVEMENT_WIDTH, `The ${name} stands off its pavement (${ringOff.toFixed(2)}).`);
    else assert(avenueOff - 0.1 >= R / 2 + 0.18 && avenueOff + 0.1 <= R / 2 + plan.PAVEMENT_WIDTH && ringOff > R / 2 + plan.PAVEMENT_WIDTH, `The ${name} stands off its pavement (${avenueOff.toFixed(2)}).`);
    // Its traffic sees it just past the stop line, facing them.
    const line = stopLines.find((l) => l.junction === p.junction && l.approach === p.approach),
      past = (p.x - line.x) * line.along[0] + (p.z - line.z) * line.along[1];
    assert(past > 0.1 && past < 0.6, `The ${name} stands ${past.toFixed(2)} past its stop line.`);
    assert(Math.abs(p.facing[0] + line.along[0]) < 1e-9 && Math.abs(p.facing[1] + line.along[1]) < 1e-9, `The ${name} does not face its traffic.`);
    for (const walk of walks)
      for (const [x, z] of foot) assert(plan.distanceToPolyline([x, z], walk, true) >= 0.26, `The ${name} stands in the walkers' way.`);
    for (const l of lamps) assert(Math.hypot(l.x - p.x, l.z - p.z) >= 1.0, `The ${name} crowds ${l.id}.`);
    for (const t of trees) assert(Math.hypot(t.x - p.x, t.z - p.z) >= t.size + 0.8, `The ${name} stands under ${t.id}.`);
    for (const [x, z] of seats) assert(Math.hypot(x - p.x, z - p.z) >= 2, `The ${name} crowds a bench or bin.`);
    for (const zebra of zebras) for (const [x, z] of foot) assert(toZebra(x, z, zebra) >= 0.2, `The ${name} stands on a zebra.`);
    for (const [x, z] of board) {
      assert(plan.distanceToPolyline([x, z], plan.cyclistLane, true) >= 0.35, `The ${name} overhangs the cycle lane.`);
      for (const v of tramBody) {
        // The tram's body as a rectangle 1.2 wide, its nose and tail 1.89 from its middle.
        const c = Math.cos(v.heading),
          s = Math.sin(v.heading),
          lx = (x - v.x) * c - (z - v.z) * s,
          lz = (x - v.x) * s + (z - v.z) * c;
        assert(Math.hypot(Math.max(Math.abs(lx) - 0.6, 0), Math.max(Math.abs(lz) - TRAM_TIMETABLE.nose, 0)) >= 0.25, `The tram sweeps through the ${name}.`);
      }
    }
    // The heads hang above the walkers (0.91 tall), and out of the terrace's clearing.
    assert(!(p.x > row.x - 5.5 && p.x < row.x + 5.5 && Math.abs(p.z - row.z) < row.spacing + 4), `The ${name} stands in the terrace's clearing.`);
  }
  for (const l of stopLines) {
    const j = signalJunctions.find((q) => q.id === l.junction),
      across = [l.along[1], -l.along[0]];
    for (const s of [-1, 1])
      for (const w of [-1, 1]) {
        const x = l.x + across[0] * (s * l.length) / 2 + l.along[0] * (w * STOP_LINE.width) / 2,
          z = l.z + across[1] * (s * l.length) / 2 + l.along[1] * (w * STOP_LINE.width) / 2;
        const road = l.approach === 'ring' ? plan.distanceToPolyline([x, z], plan.ringLine, true) : plan.distanceToSegment([x, z], j.from, j.at);
        assert(road <= R / 2 - 0.04, `The ${l.junction} ${l.approach} stop line reaches the kerb.`);
        for (const zebra of zebras) assert(toZebra(x, z, zebra) >= 0.2, `The ${l.junction} ${l.approach} stop line runs onto a zebra.`);
      }
  }
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
// Everything that moves round a sampled corner turns evenly through it: the cyclist, the dog
// walker and the dog, the tram and the people on the ring's pavements. Their true arcs turn them
// about 0.37°, 0.95°, 2.3°, 0.4° and at most 0.28° a frame at 60 fps; a heading that stepped at each
// vertex jumped 9°, 15°, 16.6°, 9° and 9° and held still between. Each heading also stays with the
// way it moves (the outer walkers go round the other way, facing back along the loop).
{
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a)),
    deg = Math.PI / 180,
    innerWalk = plan.walkLoop(1.62),
    outerWalk = plan.walkLoop(-1.62),
    pace = 0.85 * 1.15; // the fastest walker (town-build: 0.85 x 0.85-1.15)
  for (const { name, pose, most } of [
    { name: 'tram', pose: (t) => plan.tramPose(t), most: 0.6 },
    { name: 'inner walker', pose: (t) => plan.samplePolyline(innerWalk, pace * t, true, true), most: 0.4 },
    {
      name: 'outer walker',
      pose: (t) => {
        const p = plan.samplePolyline(outerWalk, -pace * t, true, true);
        return { ...p, heading: p.heading + Math.PI };
      },
      most: 0.4,
    },
    { name: 'cyclist', pose: (t) => plan.cyclistPose(t), most: 0.5 },
    { name: 'dog walker', pose: (t) => plan.dogWalkPose(t).walker, most: 1.2 },
    { name: 'dog', pose: (t) => plan.dogWalkPose(t).dog, most: 3 },
  ]) {
    let last = pose(0);
    for (let f = 1; f <= 60 * 60; f++) {
      const p = pose(f / 60),
        turn = Math.abs(wrap(p.heading - last.heading));
      assert(turn <= most * deg, `The ${name} turns ${(turn / deg).toFixed(1)}° in one frame at t=${(f / 60).toFixed(2)}`);
      if (Math.hypot(p.x - last.x, p.z - last.z) > 1e-6)
        assert(Math.abs(wrap(Math.atan2(p.x - last.x, p.z - last.z) - p.heading)) <= 9 * deg, `The ${name} faces off its path at t=${(f / 60).toFixed(2)}`);
      last = p;
    }
  }
  // Without `smooth`, samplePolyline keeps the segment's own heading (only positions are read that way).
  const square = [[0, 0], [0, 1], [1, 1], [1, 0]];
  assert.equal(plan.samplePolyline(square, 0.9, true).heading, 0, 'The plain heading is the segment’s.');
  assert(Math.abs(plan.samplePolyline(square, 1, true, true).heading - Math.PI / 4) < 1e-12, 'A smooth heading is halfway round at the vertex.');
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
      ...sp.wrack.map((s, k) => ({ name: 'wrack[' + k + ']', p: at({ i: s.from, w: s.w }), q: at({ i: s.to, w: s.w }), r: s.foot })),
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
  const together = new Set(['rockPools[0]', 'rockPools[1]', 'boulder-42']); // the pools tuck against their boulder on purpose
  // ...but not into each other.
  {
    const [a, b] = sp.rockPools;
    assert(Math.hypot(at(a)[0] - at(b)[0], at(a)[1] - at(b)[1]) - a.foot - b.foot >= 0.05, 'The rock pools run into each other.');
  }
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
// Ten models: the sky island is a place of its own (model.sky), not one of the town's models; the
// tropic island's building is one (its root at the island's middle).
assert.equal(models.size, 10);
assert(model.sky && !models.has('sky-island'), 'The sky island is built as a model of the town\'s.');
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
  // The beach's wet band: the shore and the tropic island's beach are the only sand (the airport's
  // island has none), and each one's uv.x runs out to the profile's 7.2.
  const sands = [];
  city.traverse((o) => o.isMesh && o.material.userData.surfaceKind === 'sand' && sands.push(o));
  assert(sands.length === 2 && sands.filter((o) => o.parent === model.land).length === 1 && sands.filter((o) => o.parent === model.tropicLand).length === 1, 'Only the shore and the tropic island\'s beach are sand.');
  model.airportLand.traverse((o) => assert(!o.isMesh || o.material.userData.surfaceKind !== 'sand', 'Sand on the airport.'));
  for (const beach of sands) {
    const uv = beach.geometry.getAttribute('uv');
    let widest = -Infinity;
    for (let i = 0; i < uv.count; i++) widest = Math.max(widest, uv.getX(i));
    assert(Math.abs(widest - 7.2) < 0.05, `The shore's uv.x reaches ${widest}, not the shore width.`);
  }
  const sand = patchedShader(sands[0].material);
  assert(varyings(sand.vertexShader).has('vShoreW') && varyings(sand.fragmentShader).has('vShoreW') && sand.fragmentShader.includes('shoreWet'), 'The sand has no wet band.');
  // The drying net: gathered swags of solid netting, so it batches with the other cloth. Nothing on
  // the land (the airport's included) is two-sided (that costs a program of its own) or cuts holes
  // (cut-out mesh twinkles once under a pixel), and the net is there: heaped over the bar, casting nothing.
  for (const ground of [model.land, model.airportLand, model.tropicLand])
    ground.traverse((o) => {
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
// Timed builds. Timed once by the wall clock, a build fails on a busy machine (or a slower one, as a
// CI runner may be) with no change in its code. So a build timed here runs three times, and each
// run is timed against a yardstick run just before and just after it (fixed three.js work of the
// kind the builds do: cylinders turned and merged, their normals and box worked out). The machine's
// pace for the run is the faster of those two yardsticks over YARDSTICK (a fixed 12 ms, about the
// yardstick's time in this check, on an Apple M5 Pro under the other lanes' load, when the limits
// were first set), and the run's ms over that pace is its time at the limits' pace. The fastest run
// at that pace is held to the build's limit. A busy or slower machine is slower at both alike, and
// passes; each limit is about three times what its build takes at that pace (MAINTENANCE.md's
// airport ground entry has the calibration), so a build five times slower fails. The faster
// yardstick, not the two's mean: a pause (the collector clearing up after a phase, the machine busy
// elsewhere) only ever slows a yardstick, and the one after a heavy phase often pays for it; paced
// by the mean, such a run looked up to twice as fast as it ran, and the fastest of three was most
// often that run.
const YARDSTICK = 12,
  { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
/** The yardstick's time, in ms. */
const yardstick = () => {
  const begin = performance.now(),
    turn = new T.Matrix4(),
    merged = mergeGeometries(Array.from({ length: 240 }, (_, i) => new T.CylinderGeometry(0.3, 0.4, 1, 18, 3).applyMatrix4(turn.makeRotationY(i * 0.7).setPosition(i % 13, i % 7, i % 11))));
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  return performance.now() - begin;
};
/** A run's time (ms) between yardsticks of `before` and `after` ms: { paced: its ms at the limits' pace, ms, pace, before, after }. */
const atPace = (ms, before, after) => {
  const pace = Math.min(before, after) / YARDSTICK;
  return { paced: ms / pace, ms, pace, before, after };
};
/** The fastest of a build's runs (each atPace's) at the limits' pace, with all of them (`runs`). */
const fastestOf = (runs) => ({ ...runs.reduce((a, b) => (b.paced < a.paced ? b : a)), runs });
/**
 * A build timed three times over: each run builds (timed) from what `setup` gives it (untimed).
 * Its fastest run at the limits' pace (fastestOf) and what the first run built.
 */
const timeBuild = (setup, build) => {
  const runs = [];
  let first,
    before = yardstick();
  for (let run = 0; run < 3; run++) {
    const given = setup(),
      begin = performance.now(),
      built = build(given),
      ms = performance.now() - begin,
      after = yardstick();
    runs.push(atPace(ms, before, after));
    if (!run) first = built;
    before = after;
  }
  return { ...fastestOf(runs), built: first };
};
/** Holds a timed build's fastest run (fastestOf) to its limit, in ms at the limits' pace. */
const inTime = (what, { paced, ms, pace, runs }, limit) =>
  assert(
    paced < limit,
    `${what} takes ${Math.round(paced)} ms at the limits' pace, over its ${limit} ms (${Math.round(ms)} ms here, the faster yardstick at ${pace.toFixed(2)} times its ${YARDSTICK} ms; its runs ${runs.map((r) => `${Math.round(r.ms)} ms between yardsticks of ${r.before.toFixed(1)} and ${r.after.toFixed(1)}`).join(', ')}).`,
  );
// The page builds the same town a phase at a time, handing the main thread back in between. (Timed
// builds, above: the town is built in phases three times over, a yardstick between every two
// phases, each phase at its fastest.)
const { buildTownInPhases } = await load('town-build');
const phaseNames = [],
  stepRuns = [];
let phased;
for (let run = 0; run < 3; run++) {
  let before = yardstick();
  for (let k = 0, phases = buildTownInPhases(); ; k++) {
    const begin = performance.now(),
      step = phases.next(),
      ms = performance.now() - begin,
      after = yardstick();
    (stepRuns[k] ??= []).push(atPace(ms, before, after));
    before = after;
    if (step.done) {
      phased ??= step.value;
      break;
    }
    if (!run) phaseNames.push(step.value);
  }
}
const stepTimes = stepRuns.map(fastestOf),
  phaseTimes = new Map(phaseNames.map((name, k) => [name, stepTimes[k]])),
  longestPhase = Math.max(...stepTimes.map((t) => t.ms));
assert(phaseNames.length >= 10, 'The town is built in phases: ' + phaseNames.join(', '));
assert.equal(new Set(phaseNames).size, phaseNames.length, 'Every phase has its own name.');
// The airport's ground is built and batched in phases of its own (never in 'batch land', the
// longest), each held to its own limit (timed builds, above), and its hall batches in its own phase too.
assert.equal(phaseNames[phaseNames.indexOf('park, harbour and landmarks') + 1], 'airport ground', 'The airport ground is not built after the landmarks.');
assert.equal(phaseNames[phaseNames.indexOf('batch land') + 1], 'batch airport', 'The airport is not batched right after the land.');
for (const [name, limit] of [['airport ground', 150], ['batch airport', 170], ['batch departures hall', 90]]) inTime(`The '${name}' phase`, phaseTimes.get(name), limit);
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
// The visitor's pan limit holds the target within PAN.lift of the subject's ground, sliding it along
// the line of sight past that (city-scene's holdPan): a pick's framing (its building's middle) and
// Inspect's never stand that high, so a glide's end never slides the camera.
const panLift = Number(/\n {4}lift: ([\d.]+),\n {2}\};/.exec(await fs.readFile(path.join(root, 'app/city-scene.ts'), 'utf8'))?.[1]);
assert(panLift > 0, 'The check cannot find PAN.lift.');
for (const [id, m] of models) {
  assert.equal(m.root.userData.buildingId, id);
  const bounds = new T.Box3().setFromObject(m.root);
  assert(!bounds.isEmpty());
  assert(bounds.max.y < 14 && bounds.min.y >= -0.3, `Invalid building height: ${id}`);
  assert(bounds.getCenter(new T.Vector3()).y < panLift - 1, `The framing of ${id} stands its target higher than the pan limit's lift (${panLift}).`);
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
  for (const id of plan.terraceHomes) {
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
    // 11k since the homes' Glasgow dressings (doorpiece, steps and railings, dressed sashes, courses and
    // dentils, skews, stack and cans, rooflight, gutters and downpipes); it was 6k.
    assert(tris < 11000, `${id}: ${Math.round(tris)} triangles`);
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
// Window boxes, under the ground-floor front window of each home (on its bay's sill course) and of
// each cottage (on the sill): planted, in front of the frame and never in the glass or the doorway,
// and low enough that from the town's camera (35 up for every 38 across) no leaf or bloom stands
// over the glass: what lies dz in front of a pane shows on it dz × 35/38 lower. A rounded box has
// vertices only at its bevels, so this reads triangles, not vertices.
{
  const RISE = 35 / 38;
  /** Triangles of `meshes` within `reach` of `centre` (world), in a building's frame (front +z). */
  const local = (meshes, toLocal, centre, reach) => {
    const out = [],
      w = new T.Vector3();
    for (const o of meshes) {
      const p = o.geometry.attributes.position,
        index = o.geometry.index,
        m = toLocal.clone().multiply(o.matrixWorld),
        kind = o.material.userData.surfaceKind,
        n = index ? index.count : p.count;
      for (let i = 0; i < n; i += 3) {
        if (w.fromBufferAttribute(p, index ? index.getX(i) : i).applyMatrix4(o.matrixWorld).distanceTo(centre) > reach) continue;
        const tri = [0, 1, 2].map((j) => new T.Vector3().fromBufferAttribute(p, index ? index.getX(i + j) : i + j).applyMatrix4(m));
        out.push({ tri, kind, box: new T.Box3().setFromPoints(tri) });
      }
    }
    return out;
  };
  /**
   * The front pane found among `tris` in `search` (a Box3: its foot, sides and plane), then the
   * window box in front of it: planted (paint and foliage), clear of the glass and of `doors`
   * (Box3s), and under the foot as the camera sees it.
   */
  const windowBox = (name, tris, search, doors) => {
    const glass = tris.filter((t) => t.kind === 'glass' && search.containsBox(t.box)).flatMap((t) => t.tri);
    assert(glass.length >= 3, `${name}: no front pane found`);
    const foot = Math.min(...glass.map((p) => p.y)),
      left = Math.min(...glass.map((p) => p.x)) + 0.03,
      right = Math.max(...glass.map((p) => p.x)) - 0.03,
      low = glass.filter((p) => p.y < foot + 0.05),
      plane = low.reduce((s, p) => s + p.z, 0) / low.length;
    const front = new T.Box3(new T.Vector3(left, foot - 0.35, plane + 0.02), new T.Vector3(right, foot + 0.3, plane + 0.45)),
      inFront = tris.filter((t) => t.kind !== 'glass' && t.box.intersectsBox(front) && t.box.min.y > front.min.y && t.box.max.y < front.max.y && t.box.min.z > front.min.z && t.box.max.z < front.max.z);
    const planted = inFront.filter((t) => t.kind === 'foliage' && t.box.min.y > foot - 0.1).length,
      painted = inFront.filter((t) => t.kind === 'paint' && t.box.max.z > plane + 0.1 && t.box.max.y < foot).length;
    assert(planted >= 20 && painted >= 6, `${name}: no planted window box under the front window (${planted} leaf, ${painted} board triangles)`);
    for (const { tri, kind, box } of inFront) {
      for (const p of tri) assert(p.y - (p.z - plane) * RISE < foot + 0.005, `${name}: ${kind} at ${p.toArray().map((n) => n.toFixed(3))} stands over the glass (foot ${foot.toFixed(3)})`);
      if (kind === 'foliage' || kind === 'paint') assert(!doors.some((d) => d.intersectsBox(box)), `${name}: the window box reaches the doorway at ${box.min.toArray().map((n) => n.toFixed(3))}`);
    }
    // Nothing of the box goes into the glass: no leaf or board in the pane's own layer above its foot.
    const layer = new T.Box3(new T.Vector3(left, foot + 0.02, plane - 0.02), new T.Vector3(right, foot + 0.3, plane + 0.02));
    for (const { kind, box } of tris)
      if (kind === 'foliage' || kind === 'paint') assert(!layer.intersectsBox(box), `${name}: the window box cuts the glass at ${box.min.toArray().map((n) => n.toFixed(3))}`);
  };
  const B = (x0, y0, z0, x1, y1, z1) => new T.Box3(new T.Vector3(x0, y0, z0), new T.Vector3(x1, y1, z1));
  for (const id of plan.terraceHomes) {
    const { shell, root } = models.get(id),
      { d } = plan.sites[id];
    shell.updateMatrixWorld(true);
    // The bay's lower front sash, and the door leaf and its surround grown 0.05.
    windowBox(id, local(shell.children.filter((o) => o.isMesh), shell.matrixWorld.clone().invert(), root.position, 4), B(-0.98, 0.6, d / 2 + 0.5, -0.38, 1.25, d / 2 + 0.62), [B(-0.06, 0, d / 2 - 0.05, 1.1, 2.4, d / 2 + 0.35)]);
  }
  const landMeshes = [];
  model.land.traverse((o) => o.isMesh && landMeshes.push(o));
  plan.cottages.forEach((c, i) => {
    const at = new T.Vector3(c.x, plan.terrainHeight(c.x, c.z), c.z),
      frame = new T.Matrix4().makeRotationY(c.rotation).setPosition(at);
    // The cottage's front window (0.7 × 0.75 at x -0.65, y 1.2) and its door (0.75 wide at x 0.6, its 0.18 surround) grown 0.05.
    windowBox(`cottage ${i}`, local(landMeshes, frame.clone().invert(), at, 2.6), B(-1.05, 0.7, 1.2, -0.25, 1.6, 1.3), [B(-0.005, 0, 1.15, 1.205, 2.0, 1.75)]);
  });
}
// Ivy on two walls only: the archive's south wall and one cottage's blank +x gable. It grows up
// from the ground, never over a window (its glass grown by the frame, 0.2 to the sides and below
// for the sill, 0.3 above for the keystone), never round a corner, and stays under the cornice or
// the verge.
{
  const triangles = (o, toLocal) => {
    const p = o.geometry.attributes.position,
      m = toLocal.clone().multiply(o.matrixWorld),
      out = [];
    for (let i = 0; i < p.count; i += 3) out.push(new T.Box3().setFromPoints([0, 1, 2].map((j) => new T.Vector3().fromBufferAttribute(p, i + j).applyMatrix4(m))));
    return out;
  };
  // The archive (front +z, south wall at +x): its only foliage is the ivy.
  const archive = models.get('city-archive').shell,
    { w, d } = plan.sites['city-archive'],
    toShell = archive.matrixWorld.clone().invert();
  const ivy = archive.children.filter((o) => o.isMesh && o.material.userData.surfaceKind === 'foliage').flatMap((o) => triangles(o, toShell)),
    glass = archive.children.filter((o) => o.isMesh && o.material.userData.surfaceKind === 'glass').flatMap((o) => triangles(o, toShell));
  assert(ivy.length > 300, `The archive's ivy is ${ivy.length} triangles.`);
  const south = glass.filter((b) => b.min.x > w / 2 - 0.05 && b.max.y < 3.5);
  const windows = [-1, 1].map((s) => {
    const own = south.filter((b) => Math.sign(b.min.z + b.max.z) === s);
    assert(own.length >= 2, 'The archive’s south windows are missing.');
    const box = own.reduce((a, b) => a.union(b), new T.Box3());
    return new T.Box3(new T.Vector3(w / 2 - 0.5, box.min.y - 0.2, box.min.z - 0.2), new T.Vector3(w / 2 + 1, box.max.y + 0.3, box.max.z + 0.2));
  });
  let low = Infinity;
  for (const b of ivy) {
    assert(b.min.x > w / 2 - 0.12 && Math.abs(b.min.z) < d / 2 - 0.2 && Math.abs(b.max.z) < d / 2 - 0.2, `Archive ivy off its south wall (or round a pier) at ${b.min.toArray().map((n) => n.toFixed(2))}`);
    assert(b.max.y < 3.65, `Archive ivy over the cornice at ${b.max.toArray().map((n) => n.toFixed(2))}`);
    for (const win of windows) assert(!win.intersectsBox(b), `Archive ivy over a window at ${b.min.toArray().map((n) => n.toFixed(2))}`);
    low = Math.min(low, b.min.y);
  }
  assert(low < 0.05, 'The archive’s ivy does not reach the ground.');
  // The cottage's gable (local +x at 1.4, its front at +z 1.2, the wall up to 2.3 under a 1.4 rise): ivy
  // from the ground into the gable, off both corners and under the verge. Nothing else of the land's
  // foliage stands this close to the wall.
  const { IVY_COTTAGE } = await load('town-homes');
  const c = plan.cottages.find((k) => k.n === IVY_COTTAGE),
    toCottage = new T.Matrix4().makeRotationY(c.rotation).setPosition(c.x, plan.terrainHeight(c.x, c.z), c.z).invert(),
    gable = [];
  model.land.traverse((o) => {
    if (!o.isMesh || o.material.userData.surfaceKind !== 'foliage') return;
    for (const b of triangles(o, toCottage)) if (b.min.x > 1.25 && b.max.x < 1.75 && Math.abs(b.min.z) < 1.5 && b.max.y < 3.5) gable.push(b);
  });
  assert(gable.length > 200, `The cottage gable's ivy is ${gable.length} triangles.`);
  low = Infinity;
  for (const b of gable) {
    const z = Math.max(Math.abs(b.min.z), Math.abs(b.max.z));
    assert(z < 1.2 - 0.05, `Cottage ivy round the gable's corner at ${b.min.toArray().map((n) => n.toFixed(2))}`);
    assert(b.max.y < 2.3 + 1.38 * (1 - z / 1.2) - 0.05, `Cottage ivy under the verge at ${b.max.toArray().map((n) => n.toFixed(2))}`);
    low = Math.min(low, b.min.y);
  }
  assert(low < 0.05, 'The cottage’s ivy does not reach the ground.');
}
// The back greens: each terrace home's washing line stands in its own back garden (behind its back
// wall, inside its own width, so never in a gap or a front garden), well inside the shore, clear of
// the trees behind the gaps and of the dog walk. The washing sways by turning its one group (no
// vertex moves), so little that the lines' ends stay in the crossbars, and is taken in while it rains.
{
  const { WASHING } = await load('town-homes');
  const trees = plan.plantingPlan(),
    v = new T.Vector3();
  for (const id of plan.terraceHomes) {
    const { shell } = models.get(id),
      { w, d } = plan.sites[id],
      washing = shell.getObjectByName('washing'),
      entry = model.animated.find((e) => e.object === washing);
    assert(washing && entry, `${id} has no washing line.`);
    assert(washing.children.length === 1 && washing.children[0].isMesh && !washing.children[0].castShadow, `${id}: the washing is one mesh that casts nothing.`);
    const positions = washing.children[0].geometry.attributes.position.array.slice(),
      toShell = shell.matrixWorld.clone().invert();
    let sway = 0;
    for (let t = 0; t < 60; t += 0.37) {
      entry.update(t, 0, 0);
      assert(washing.visible, `${id}: the washing is not out on a dry day.`);
      sway = Math.max(sway, Math.abs(washing.rotation.x));
      shell.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(washing),
        posts = [-1, 1].map((s) => new T.Vector3(s * WASHING.half, 0, -(d / 2 + WASHING.back)).applyMatrix4(shell.matrixWorld));
      for (const p of [...posts, ...[0, 1, 2, 3].map((k) => new T.Vector3(k & 1 ? box.max.x : box.min.x, box.min.y, k & 2 ? box.max.z : box.min.z))]) {
        v.copy(p).applyMatrix4(toShell);
        assert(Math.abs(v.x) < w / 2 - 0.1 && v.z < -(d / 2 + 0.25 + 0.5), `${id}: the washing leaves its back garden at ${p.toArray().map((n) => n.toFixed(2)).join(',')}`);
        assert(plan.onIsland(p.x, p.z, 0.6), `${id}: the washing is by the beach at ${p.toArray().map((n) => n.toFixed(2)).join(',')}`);
        assert(plan.distanceToPolyline([p.x, p.z], plan.dogLoop, true) > 3, `${id}: the washing is on the dog walk.`);
        for (const tree of trees) assert(Math.hypot(tree.x - p.x, tree.z - p.z) > 1.3 * tree.size + 0.2, `${id}: the washing runs into ${tree.id}.`);
      }
      assert(box.min.y > 0.6, `${id}: the washing trails on the lawn.`);
    }
    assert(sway < 0.15 && sway * WASHING.spread < 0.03, `${id}: the washing swings ${sway.toFixed(3)} rad, pulling its lines from the crossbars.`);
    // From the People chapter's bearing (and the idle drift either side) the home hides its washing:
    // a pole and a cloth peeking past a corner into the gap beside it read like a little sign. Each
    // point looks toward the camera and must meet the home (beyond its own pole and crossbar).
    {
      const ray = new T.Raycaster(),
        solid = shell.children.filter((o) => o.isMesh),
        z = -(d / 2 + WASHING.back),
        H = WASHING.height,
        cloth = washing.children[0].geometry.attributes.position,
        points = [
          ...[-1, 1].flatMap((s) => [0.2, 0.8, H + 0.07].map((y) => new T.Vector3(s * WASHING.half, y, z).applyMatrix4(shell.matrixWorld))),
          ...[-1, 1].flatMap((s) => [-1, 1].map((e) => new T.Vector3(s * WASHING.half, H, z + e * (WASHING.spread + 0.06)).applyMatrix4(shell.matrixWorld))),
          ...Array.from({ length: Math.ceil(cloth.count / 5) }, (_, i) => new T.Vector3().fromBufferAttribute(cloth, i * 5).applyMatrix4(washing.children[0].matrixWorld)),
        ];
      ray.near = 0.45;
      for (const b of [plan.chapterBearings.people - 0.16, plan.chapterBearings.people, plan.chapterBearings.people + 0.16])
        for (const p of points) {
          ray.set(p, new T.Vector3(Math.sin(b) * 38, 35, Math.cos(b) * 38).normalize());
          assert(ray.intersectObjects(solid, false).length > 0, `${id}: the People chapter sees its washing past the home at ${p.toArray().map((n) => n.toFixed(2)).join(',')}`);
        }
    }
    assert.deepEqual(washing.children[0].geometry.attributes.position.array, positions, `${id}: the washing's vertices move on the CPU.`);
    entry.update(12, 0, 1);
    assert(!washing.visible && washing.scale.x < 0.01, `${id}: the washing is left out in the rain.`);
    entry.update(0, 0, 0);
  }
}
// The Research Studio's Mackintosh window: slim bars just proud of the glass box's front and back
// (never in the glass, never across the entrance), no thinner than 0.04, casting nothing, with
// mullions at least 0.18 apart, and the glass itself still one sheet that glints as a curtain wall
// and is lit late. The rose on the door stays on its leaf.
{
  const studio = models.get('research-studio').shell,
    { d } = plan.sites['research-studio'],
    face = (d - 0.24) / 2,
    toShell = studio.matrixWorld.clone().invert(),
    bars = { 1: [], [-1]: [] },
    v = new T.Vector3();
  for (const o of studio.children) {
    if (!o.isMesh || o.material.userData.surfaceKind !== 'paint') continue;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      const b = new T.Box3();
      for (let j = 0; j < 3; j++) b.expandByPoint(v.fromBufferAttribute(p, i + j).applyMatrix4(toShell.clone().multiply(o.matrixWorld)));
      // A bar's outer face: flat in z, just proud of the glass, over the glass box's span.
      const z = (b.min.z + b.max.z) / 2;
      if (b.max.z - b.min.z > 1e-3 || Math.abs(Math.abs(z) - face) > 0.05 || Math.abs(z) < face || b.min.x < -2.6 || b.max.x > 0.4 || b.min.y < 0.55 || b.max.y > 4.37) continue;
      assert(!o.castShadow, 'A Mackintosh bar casts a shadow.');
      bars[Math.sign(z)].push(b);
    }
  }
  for (const s of [1, -1]) {
    assert(bars[s].length >= 40, `The studio's ${s > 0 ? 'front' : 'back'} has ${bars[s].length} Mackintosh bar faces.`);
    for (const b of bars[s]) {
      assert(Math.min(b.max.x - b.min.x, b.max.y - b.min.y) >= 0.04 - 1e-6, `A Mackintosh bar thinner than 0.04 at ${b.min.toArray().map((n) => n.toFixed(2))}`);
      if (s > 0) assert(!(b.max.x > -2.01 && b.min.x < -0.19 && b.min.y < 2.67), `A Mackintosh bar crosses the studio's entrance at ${b.min.toArray().map((n) => n.toFixed(2))}`);
    }
    const xs = [...new Set(bars[s].filter((b) => b.max.y - b.min.y > 1).map((b) => ((b.min.x + b.max.x) / 2).toFixed(3)))].map(Number).sort((a, b) => a - b);
    assert(xs.length >= 3, 'The studio’s mullions are missing.');
    for (let i = 1; i < xs.length; i++) assert(xs[i] - xs[i - 1] >= 0.18, `Studio mullions ${xs[i - 1]} and ${xs[i]} are too close to stay calm far off.`);
  }
  const glass = studio.children.filter((o) => o.isMesh && o.material.userData.surfaceKind === 'glass' && o.geometry.attributes.position.count >= 24);
  assert(glass.length >= 1, 'The studio has no glass box.');
  const lit = model.windows.filter((w) => w.place === 'research-studio' && Math.abs(w.light[0] - 0.8) < 0.01);
  assert(lit.length >= 1, 'The studio’s glass box is no longer lit late at 0.8.');
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
// The pointer's boxes, as the scene adds them (here outside the town, which stands untransformed).
addHitBoxes(new T.Group(), models);
// The herd answers the pointer as the park does: straight down on the paddock, the pick finds
// the Corner park.
{
  const pad = plan.paddock;
  ray.set(new T.Vector3(pad.x, 40, pad.z), new T.Vector3(0, -1, 0));
  assert.equal(pickTarget(ray, models, model.parkHit), 'corner-park', 'Pointing at the herd finds the Corner park.');
}
// The pointer answers for what it is on. At a slant a building's box has empty corners in front
// of its neighbours (over the gate's attic, beside a home's bay), so wherever a building's own
// surface is the first one on a view ray (the frame's parallel rays, from the camera's offset),
// the pick is that building: every visible bit of the bike rack picks the studio, from its
// chapter, the idle drift's turn either side and the four Rotate stops, and each bay its home.
{
  const roots = Array.from(models.values(), (m) => m.root),
    stops = [0, 1, 2, 3].map((k) => Math.PI / 4 + (k * Math.PI) / 2),
    from = new T.Vector3(),
    dir = new T.Vector3(),
    tri = [new T.Vector3(), new T.Vector3(), new T.Vector3()];
  /**
   * The centre (in the town) of every third triangle of a building's meshes whose corners all pass
   * `keep`, which sees them in shell space, or in the town's if `town`.
   */
  function centres(id, keep, town = false) {
    const out = [];
    for (const o of models.get(id).shell.children) {
      if (!o.isMesh) continue;
      const p = o.geometry.attributes.position,
        index = o.geometry.index,
        count = (index?.count ?? p.count) / 3;
      for (let t = 0; t < count; t += 3) {
        tri.forEach((v, k) => {
          v.fromBufferAttribute(p, index ? index.getX(t * 3 + k) : t * 3 + k);
          if (town) v.applyMatrix4(o.matrixWorld);
        });
        if (!tri.every(keep)) continue;
        const centre = new T.Vector3().add(tri[0]).add(tri[1]).add(tri[2]).divideScalar(3);
        out.push(town ? centre : centre.applyMatrix4(o.matrixWorld));
      }
    }
    return out;
  }
  /** Each of `points` that the view at each bearing sees picks `id`; returns how many it saw at each. */
  function picksAs(id, points, bearings) {
    return bearings.map((bearing) => {
      dir.set(Math.sin(bearing) * 38, 35, Math.cos(bearing) * 38).normalize().negate();
      let seen = 0;
      for (const point of points) {
        ray.set(from.copy(point).addScaledVector(dir, -200), dir);
        if ((ray.intersectObjects(roots, true)[0]?.point.distanceTo(point) ?? 1) > 0.01) continue; // something stands in front
        seen++;
        const picked = pickTarget(ray, models, model.parkHit);
        assert.equal(picked, id, `At bearing ${bearing.toFixed(2)} the pointer on ${id} at ${point.toArray().map((n) => n.toFixed(2)).join(', ')} picks ${picked}.`);
      }
      return seen;
    });
  }
  const { y } = plan.bikeRack,
    { x0, x1, z0, z1 } = rackFootprint,
    studio = plan.chapterBearings['research-studio'],
    rack = centres('research-studio', (v) => v.x >= x0 && v.x <= x1 && v.z >= z0 && v.z <= z1 && v.y > y + 0.015, true);
  assert(rack.length > 150, `Only ${rack.length} bike rack triangles found on the studio.`);
  const seen = picksAs('research-studio', rack, [studio - 0.16, studio, studio + 0.16, ...stops]);
  assert(seen[1] > rack.length / 4, `The studio chapter sees only ${seen[1]} of the rack's ${rack.length} triangles.`);
  // The bays (BAY above), in front of each home's wall: from the People chapter (and its drift) and the Rotate stops.
  const people = plan.chapterBearings.people;
  for (const id of plan.terraceHomes) {
    const { d } = plan.sites[id],
      bay = centres(id, (v) => Math.abs(v.x + 0.68) < 0.6 && v.z > d / 2 + 0.01 && v.z < d / 2 + 0.6 && v.y > 0.42 && v.y < 3.1);
    assert(bay.length > 20, `${id}: only ${bay.length} bay triangles found.`);
    assert(picksAs(id, bay, [people - 0.16, people, people + 0.16, ...stops])[1] > 0, `${id}: the People chapter sees none of the bay.`);
  }
}
// Open water around the island, and a water shader that still compiles.
const water = createIslandWater(model.waterLevel, -0.5);
city.add(water.bottom, water.mesh);
city.updateMatrixWorld(true);
// The causeway runs over (0, -36), so that probe moved east of it; the water between the coast and
// the airport's island west of the causeway, and the sea north of the airport, are open too.
for (const [x, z] of [
  [8, -36],
  [-8, -38],
  [-5, -60],
  [-37, 0],
  [37, 24],
  [0, 36],
]) {
  ray.set(new T.Vector3(x, 1, z), new T.Vector3(0, -1, 0));
  assert.equal(ray.intersectObject(city, true)[0]?.object, water.mesh, 'Open sea expected at ' + x + ',' + z);
}
// The ground masks reach past the airport's island (town-shared's MASK_EXTENT) on the grid they
// always had: the same 0.34375-unit texels on the same centres (the 256 over +-44, 48 more each
// way), so the main island's masks read exactly as before, and the ground and the sea both read them
// over that extent. In a phase of its own, a faint narrow ring of shallows round the airport's armour
// and down the causeway's flanks: a third or so of the island's full tint at the stones' toe (the sea
// tints by G squared), all but gone 1.5 out and gone by 2.2; never on the grid's border (its clamped
// edge would carry it out over the whole sea); and no mask shade on the airport's deck, forecourt or
// causeway (R, B and A nought there, as when the grid stopped short of them).
{
  const { MASK_EXTENT, MASK_SIZE } = await load('town-shared'),
    { AIRPORT_SHALLOWS } = await load('town-ground'),
    texel = (2 * MASK_EXTENT) / MASK_SIZE,
    shift = (MASK_EXTENT - 44) / texel,
    sources = await Promise.all(['city-water', 'city-materials'].map((n) => fs.readFile(path.join(root, 'app', n + '.ts'), 'utf8')));
  assert(Math.abs(texel - 88 / 256) < 1e-12 && Math.abs(shift - Math.round(shift)) < 1e-9 && MASK_EXTENT >= 58 + 2 * texel, `The ground masks' grid (${MASK_SIZE} over +-${MASK_EXTENT}) is not the old one's texels, or stops short of the airport's shallows.`);
  assert(sources.every((src) => /maskExtent: \{ value: MASK_EXTENT \}/.test(src) && !/maskExtent: \{ value: \d/.test(src)) && model.materialLibrary.bakeUniforms.maskExtent.value === MASK_EXTENT, 'The ground or the sea reads the masks over another extent.');
  assert.equal(phaseNames[phaseNames.indexOf('ground masks') + 1], 'airport shallows', 'The airport\'s shallows are not baked in a phase of their own after the masks.');
  const N = MASK_SIZE,
    data = model.groundMasks.image.data,
    A = plan.AIRPORT,
    AR = plan.AIRPORT_ROAD,
    // The masks as the GPU reads them: linear between texel centres, clamped at the edge.
    at = (x, z, c) => {
      const u = Math.min(N - 1, Math.max(0, (x / (2 * MASK_EXTENT) + 0.5) * N - 0.5)),
        v = Math.min(N - 1, Math.max(0, (z / (2 * MASK_EXTENT) + 0.5) * N - 0.5)),
        i0 = Math.floor(u),
        j0 = Math.floor(v),
        i1 = Math.min(N - 1, i0 + 1),
        j1 = Math.min(N - 1, j0 + 1),
        fu = u - i0,
        fv = v - j0,
        tx = (i, j) => data[(j * N + i) * 4 + c] / 255;
      return (tx(i0, j0) * (1 - fu) + tx(i1, j0) * fu) * (1 - fv) + (tx(i0, j1) * (1 - fu) + tx(i1, j1) * fu) * fv;
    };
  for (let k = 0; k < N; k++) for (const [i, j] of [[k, 0], [k, N - 1], [0, k], [N - 1, k]]) assert.equal(data[(j * N + i) * 4 + 1], 0, 'Shallows on the ground masks\' border.');
  // Round the island, clear of where the causeway lands, the ring's mean strength out from the toe.
  const ring = (out) => {
      const g = plan.airportOutline(A.armour + out, 0.5).filter((p) => Math.abs(p.x - AR.x) > AR.top + 1.5 || p.z < A.z).map((p) => at(p.x, p.z, 1));
      return g.reduce((sum, v) => sum + v, 0) / g.length;
    },
    island = 1; // the main island's shallows are full (G 1) at its shelf
  assert(ring(0) ** 2 >= 0.25 * island && ring(0) ** 2 <= 0.42 * island && ring(1) < 0.3 && ring(1.5) < 0.1 && ring(2.2) < 0.01, `The airport's shallows are not a faint narrow ring (${[0, 1, 1.5, 2.2].map((o) => ring(o).toFixed(2)).join(', ')} out to 2.2).`);
  assert(Math.abs(AIRPORT_SHALLOWS.strength - ring(0)) < 0.08, 'The airport\'s shallows are off their strength at the toe.');
  // Down the causeway's flanks, the same ring from their toe (both sides, over open water past the
  // main island's own shallows, which reach 7.5 off its coast).
  for (const z of [-37, -40.5]) {
    const toe = AR.top / 2 + AIRPORT_SHALLOWS.flank;
    for (const side of [-1, 1]) assert(at(AR.x + side * toe, z, 1) > 0.45 && at(AR.x + side * (toe + 2.2), z, 1) < 0.01, `The causeway's flank at z ${z} has no ring of shallows (${at(AR.x + side * toe, z, 1).toFixed(2)}).`);
  }
  // The airport's own ground takes no mask shade.
  for (let x = A.x - A.hw; x <= A.x + A.hw; x += 0.25)
    for (let z = A.z - A.hd; z <= AR.island; z += 0.25)
      if (plan.airportDistance(x, z) <= 0 || (Math.abs(x - AR.x) <= AR.top / 2 && z > A.z))
        for (const c of [0, 2, 3]) assert(at(x, z, c) < 1e-9, `The airport's ground takes mask shade (channel ${c}) at ${x.toFixed(2)}, ${z.toFixed(2)}.`);
}
// The airport: a small island of its own off the north shore, the road out to it from the ring
// (the hall lane, the beach ramp and the causeway) and its Departures Hall with the control tower.
{
  const A = plan.AIRPORT,
    AR = plan.AIRPORT_ROAD,
    { shell: hall, root: hallRoot } = models.get('airport'),
    v = new T.Vector3(),
    each = (group, visit) =>
      group.traverse((o) => {
        if (!o.isMesh) return;
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) visit(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld), o);
      });
  // The deck: a signed distance (negative on it) whose outlines lie on their level, at least 13.5
  // off the coast and out in deep water; onAirport's margin is that distance's level.
  assert(plan.airportDistance(A.x, A.z) < -5.99 && Math.abs(plan.airportDistance(A.x + A.hw, A.z)) < 1e-9, 'The deck has the wrong size.');
  for (const offset of [-0.4, 0, A.armour])
    for (const p of plan.airportOutline(offset, 0.5)) assert(Math.abs(plan.airportDistance(p.x, p.z) - offset) < 1e-6, `The deck's outline ${offset} out is off its level.`);
  assert(plan.onAirport(A.x, A.z - A.hd + 0.301, -0.3) && !plan.onAirport(A.x, A.z - A.hd + 0.299, -0.3) && plan.onAirport(A.x, A.z - A.hd - 0.5, 0.6), 'onAirport\'s margin is not a level of the signed distance.');
  const offshore = Math.min(...plan.airportOutline(0, 0.25).map((p) => plan.distanceToPolyline([p.x, p.z], plan.islandOutline, true)));
  assert(offshore >= 13.5, `The airport is only ${offshore.toFixed(1)} off the coast.`);
  for (const p of plan.airportOutline(A.armour + 0.2, 1)) assert(!plan.onIsland(p.x, p.z, -7.5), 'The airport island reaches the shallows.');
  // On the deck, 0.3 in from its edge at least: the runway, the taxiway and its stubs, the apron out to
  // the taxiway, the stand and the building's site; the forecourt is built inside the coping (0.4 in).
  const { RUNWAY: RW, TAXIWAY: TW, APRON: AP, FORECOURT: FC, STAND } = plan,
    rects = {
      runway: [RW.x0, RW.x1, RW.z - RW.width / 2, RW.z + RW.width / 2],
      taxiway: [TW.x0 - TW.width / 2, TW.x1 + TW.width / 2, TW.z - TW.width / 2, TW.z + TW.width / 2],
      ...Object.fromEntries(TW.stubs.map((x, k) => ['stub ' + k, [x - TW.width / 2, x + TW.width / 2, RW.z + RW.width / 2, TW.z - TW.width / 2]])),
      apron: [AP.x0, AP.x1, TW.z + TW.width / 2, AP.z1],
      forecourt: [FC.x0, FC.x1, FC.z0, FC.z1 - 0.4],
      site: [plan.sites.airport.x - plan.sites.airport.w / 2, plan.sites.airport.x + plan.sites.airport.w / 2, plan.sites.airport.z - plan.sites.airport.d / 2, plan.sites.airport.z + plan.sites.airport.d / 2],
    };
  for (const [name, [x0, x1, z0, z1]] of Object.entries(rects))
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) assert(plan.onAirport(x, z, -0.3), `The airport's ${name} reaches its edge at ${x}, ${z}.`);
  assert(plan.onAirport(STAND.x, STAND.z, -2) && STAND.x > AP.x0 && STAND.x < AP.x1 && STAND.z > AP.z0 && STAND.z < AP.z1, 'The stand is off the apron.');
  assert(Math.abs(RW.z - RW.width / 2 - TW.z - TW.width / 2) > 0.5 && FC.x0 < AR.x && FC.x1 > AR.x, 'The taxiway runs on the runway, or the forecourt misses the road.');
  // The road: its mouth on the ring's north straight (the outer pavement's edge is the lane's start), the
  // beach where the lane meets the coast, the causeway's level on the water; never a street.
  assert.equal(AR.mouth, plan.ring.cz - plan.ring.hd, 'The airport road leaves the ring off its north straight.');
  assert(Math.abs(AR.lane - (AR.mouth - plan.ROAD_WIDTH / 2 - plan.PAVEMENT_WIDTH)) < 1e-9, 'The lane does not start at the pavement.');
  assert(Math.abs(Math.hypot(AR.x, AR.beach) - plan.islandRadius(Math.atan2(AR.beach, AR.x))) < 0.05, 'The lane does not end at the coast.');
  assert(plan.distanceToStreets(AR.x, (AR.lane + AR.beach) / 2) > 2 && plan.avenues.every((a) => a.id !== 'airport'), 'The airport road became a street.');
  for (let z = AR.lane; z >= FC.z0; z -= 0.1) {
    const top = plan.airportRoadTop(z);
    assert(top >= 0 && top <= A.deck + 1e-9 && top <= plan.airportRoadTop(z - 0.1) + 1e-9, `The road's bed falls at ${z.toFixed(1)}.`);
    if (z <= AR.causeway) assert(Math.abs(top - A.deck) < 1e-9, 'The causeway is off the deck\'s level.');
    if (z >= AR.beach) assert.equal(top, 0, 'The lane leaves the ground.');
  }
  assert.equal(plan.deckHeight(A.x, A.z), A.deck);
  assert.equal(plan.deckHeight(AR.x, (AR.causeway + AR.island) / 2), A.deck);
  assert.equal(plan.deckHeight(AR.x + 5, -36), plan.terrainHeight(AR.x + 5, -36));
  // The lane passes between cottages 3 and 4 behind the Town Hall, at least 0.6 from every trunk
  // (no tree is moved or removed) and 1.5 from the cottages as built, their lean-to and gardens too.
  for (const t of trees) assert(plan.distanceToAirportRoad(t.x, t.z) >= 0.6, `The airport road runs over ${t.id} (${plan.distanceToAirportRoad(t.x, t.z).toFixed(2)}).`);
  {
    const { createHomes } = await load('town-homes'),
      { createNature } = await load('town-nature'),
      { createKit } = await load('town-kit'),
      { createCityMaterials } = await load('city-materials'),
      library = createCityMaterials(),
      ctx = { library, material: library.material, season: 'summer', land: new T.Group(), lamps: [], clocks: [], animated: [] },
      kit = createKit(ctx),
      homes = createHomes(ctx, kit, createNature(ctx, kit));
    for (const c of plan.cottages) {
      const g = new T.Group();
      homes.buildCottage(g, c);
      g.updateMatrixWorld(true);
      let near = Infinity;
      each(g, (p) => (near = Math.min(near, plan.distanceToAirportRoad(p.x, p.z))));
      assert(near >= 1.5, `The airport road passes ${near.toFixed(2)} from cottage ${c.n}.`);
    }
    library.dispose();
  }
  // Its ground stays on the deck (and over the armour), or on the road's corridor: nothing strays.
  each(model.airportLand, (p, o) => {
    const onDeck = plan.airportDistance(p.x, p.z) <= A.armour + 0.2,
      onRoad = Math.abs(p.x - AR.x) <= 2.75 && p.z <= AR.lane + 1e-3 && p.z >= A.z;
    assert(onDeck || onRoad, `${o.material.name} strays off the airport to ${p.x.toFixed(2)}, ${p.z.toFixed(2)}.`);
    assert(p.y > -0.75 && p.y < 3.5, `${o.material.name} at height ${p.y.toFixed(2)} on the airport.`);
  });
  // The building: every part inside the deck 0.3 in from its edge, up to the mast at 7.0 (under the
  // Town Hall's 9.5), its arch and board centred on the road's axis.
  const hallBounds = new T.Box3().setFromObject(hallRoot);
  each(hall, (p) => assert(plan.onAirport(p.x, p.z, -0.3), `The airport's building leaves its deck at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}.`));
  assert(hallBounds.max.y <= plan.sites.airport.height + 1e-6 && hallBounds.max.y > plan.sites.airport.height - 0.05, `The airport's mast tops out at ${hallBounds.max.y.toFixed(2)}.`);
  assert(hallBounds.max.y < plan.sites['town-hall'].height, 'The airport outgrows the Town Hall.');
  // Its front steps, like its plinth, stand on y 0 (the deck hides their foot), so Inspect's copy,
  // standing on the study ground, has none hanging in the air.
  let stepFoot = Infinity;
  each(hall, (p) => {
    if (Math.abs(p.x - AR.x) < 1.4 && p.z > AR.arch + 0.15 && p.z < AR.arch + 0.65) stepFoot = Math.min(stepFoot, p.y);
  });
  assert(stepFoot < 0.01, `The airport's front steps float ${stepFoot.toFixed(2)} over the ground.`);
  // Its window roles: the hall's glass civic (its doors lit late at 0.8, today's colour), the tower's
  // cab its own 'cab' light (lit all night, dim and warm), the board's three amber rows beacons,
  // centred on the road.
  const own = model.windows.filter((p) => p.place === 'airport'),
    role = (r) => own.filter((p) => p.role === r);
  assert.equal(role('cab').length, 1, 'The control tower has no cab.');
  assert.equal(role('beacon').length, 3, 'The board has not three rows.');
  for (const p of role('beacon')) assert(Math.abs(p.at.x - AR.x) < 0.01 && p.at.z > FC.z0 - 0.3, 'A board row is off the arch.');
  assert(role('civic').length >= 4 && role('civic').some((p) => Math.round(p.light[0] * 255) === 204 && Math.round(p.light[1] * 255) === 128), 'The hall has no glass lit late.');
  assert.equal(own.length, role('civic').length + 4, 'An airport pane has a role of its own.');
  // The cab's raked glass stands at y 5.2-6.3, under the mast's 7.0. It glows dim and warm all night:
  // at most 0.6 of the dials' glow and warmer than today's (in the phone box's pale cool white its
  // eight big panes read as a frosted lantern, the brightest and the only cool light at the airport).
  assert(role('cab').every((p) => p.at.y > 5.2 && p.at.y < 6.3), 'The control tower\'s cab is off its height.');
  {
    const { windowGlow: glowOf } = await load('city-materials'),
      clock = { out: 0, wake: 0 },
      cab = glowOf(role('cab')[0].light, clock),
      dial = glowOf([1, 0.5, 1, 1], clock),
      lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    assert(lum(cab) <= 0.6 * lum(dial) && lum(cab) > 0.4 * lum(dial) && cab.b / cab.r < dial.b / dial.r, `The control tower's cab is not a dim warm light (${cab.toArray().map((n) => n.toFixed(3)).join(', ')}).`);
  }
  // The board: three rows of tiles that are dark by day and glow amber at night, never text. They are
  // one glass of their own glow (amber: warm and saturated, unlike the windows' warm white), dark
  // umber by day, each row one flat pane facing the causeway that covers its 1.7 x 0.16 strip whole
  // (its tiles parted by shading alone: no gaps, no glyphs).
  {
    const { AIRPORT_LOOK: look } = await load('town-airport'),
      glow = new T.Color(look.glow),
      rows = [];
    hall.traverse((o) => o.isMesh && o.material.userData.surfaceKind === 'glass' && o.material.emissive.getHex() === glow.getHex() && rows.push(o));
    assert.equal(rows.length, 1, 'The board\'s rows are not a glass of their own glow.');
    assert(glow.b < 0.25 * glow.r && glow.g > 0.3 * glow.r && glow.g < 0.8 * glow.r, 'The board\'s rows do not glow amber.');
    const g = rows[0].geometry,
      p = g.attributes.position,
      n = g.attributes.normal,
      c = g.attributes.color,
      a = new T.Vector3(),
      b = new T.Vector3(),
      d = new T.Vector3();
    let area = 0,
      tone = 0;
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i);
      b.fromBufferAttribute(p, i + 1).sub(a);
      d.fromBufferAttribute(p, i + 2).sub(a);
      area += b.cross(d).length() / 2;
    }
    for (let i = 0; i < p.count; i++) {
      assert(n.getZ(i) > 0.999, 'A board row does not face the causeway.');
      tone += 0.2126 * c.getX(i) + 0.7152 * c.getY(i) + 0.0722 * c.getZ(i);
    }
    assert(Math.abs(area - 3 * 1.7 * 0.16) < 1e-3, `The board's rows cover ${area.toFixed(3)}, not three whole strips.`);
    assert(tone / p.count < 0.08, `The board's tiles are not dark by day (${(tone / p.count).toFixed(3)}).`);
    // At night the joints dim the rows' glow as well (glowShade): 15-20% under the tiles' middles on
    // a third of the vertices (each tile's two outer edges), so the rows read as blank lit tiles,
    // not three solid amber bars.
    const lit = g.attributes.aWindow,
      levels = Array.from({ length: lit.count }, (_, i) => lit.getX(i)),
      top = Math.max(...levels),
      low = Math.min(...levels),
      dim = levels.filter((l) => l < top - 1e-6).length / levels.length;
    assert(top === 1 && low / top >= 0.8 && low / top <= 0.85 && Math.abs(dim - 1 / 3) < 0.01, `The board's joints dim its glow to ${(low / top).toFixed(3)} on ${(dim * 100).toFixed(1)}% of it.`);
  }
  // The jet bridge, from the hall's west wall toward the stand: below the plane's fin (y 2) and west
  // of the hall it stays north of the parked fuselage (0.66 across on the stand's line) by at least
  // 0.15, its bellows reaching that line's 0.19 (it docks), and east of the wing's root; its footing
  // stands on y 0 like the plinth, so Inspect has it on the ground.
  {
    const J = plan.JET_BRIDGE;
    let north = -Infinity,
      west = Infinity,
      foot = Infinity,
      parts = 0;
    each(hall, (q) => {
      if (q.x > AR.x - 2.1 - 0.2 || q.y > 2) return;
      parts++;
      north = Math.max(north, q.z);
      west = Math.min(west, q.x);
      if (Math.abs(q.x - J.legs) < 0.25) foot = Math.min(foot, q.y);
    });
    assert(parts > 0 && north <= STAND.z - 0.33 - 0.15 + 1e-6 && north >= J.bellows - 0.01, `The jet bridge reaches ${north.toFixed(2)} by the parked plane (its bellows at ${J.bellows}).`);
    assert(west > STAND.x + 1, `The jet bridge runs on to ${west.toFixed(2)}, over the plane's wing.`);
    assert(foot < 0.01, `The jet bridge's footing stands ${foot.toFixed(2)} over the ground.`);
  }
  // Its lamps: four on the causeway's east piers, lit with the town's (from the east parapet the
  // lanterns' shadows fall off the road at the opening and chapter bearings: the key light turns
  // with the camera and always throws them to the right of the frame); and two more, globes on
  // stone piers, at the forecourt's front corners on its paving, either side of the road's axis.
  const causewayLamps = lamps.filter((l) => l.getWorldPosition(v).z < AR.beach && v.z > AR.island - 0.4),
    forecourtLamps = lamps.filter((l) => l.getWorldPosition(v).z < FC.z1 && v.z > FC.z0 && v.x > FC.x0 && v.x < FC.x1);
  assert.equal(causewayLamps.length, 4, 'The causeway has not four lamps.');
  assert.equal(lamps.filter((l) => l.getWorldPosition(v).z < AR.beach).length, 6, 'The airport has lamps besides the causeway\'s and the forecourt\'s.');
  assert.equal(forecourtLamps.length, 2, 'The forecourt has not two lamps.');
  {
    const [west, east] = forecourtLamps.map((l) => l.getWorldPosition(new T.Vector3())).sort((a, b) => a.x - b.x);
    assert(Math.abs(west.x + east.x - 2 * AR.x) < 1e-6 && Math.abs(west.z - east.z) < 1e-6 && west.z > FC.z1 - 0.4 - 0.6, 'The forecourt\'s lamps do not pair across the road at its front.');
    for (const l of forecourtLamps) {
      const foot = l.parent.getWorldPosition(new T.Vector3()).y - (A.deck + 0.06),
        up = l.getWorldPosition(new T.Vector3()).y - (A.deck + 0.06);
      assert(l.parent.name === 'forecourt-lamp' && Math.abs(foot) < 1e-6 && up > 1.1 && up < 1.6, `A forecourt lamp is off its pier on the paving (its pier's foot ${foot.toFixed(3)}, its globe ${up.toFixed(2)} up).`);
    }
  }
  for (const l of causewayLamps) {
    l.getWorldPosition(v);
    assert(Math.abs(v.x - (AR.x + (AR.top / 2 + plan.ROAD_WIDTH / 2 + 0.24) / 2)) < 0.01 && v.z > AR.island - 0.4 && v.y > A.deck + 2, 'A causeway lamp is off its pier.');
    // For every sun the key light takes (sunOffsetFor, turned with the yaw as placeSun does), the
    // lantern's shadow on the road's level stays a head's half-width clear of the carriageway.
    const { sunOffsetFor } = await load('city-atmosphere'),
      key = new T.Vector3();
    for (const yaw of [Math.PI / 4, plan.chapterBearings.airport])
      for (let elevation = -0.1; elevation <= 1.2; elevation += 0.1)
        for (let azimuth = 0; azimuth < 2 * Math.PI; azimuth += Math.PI / 24) {
          key.copy(sunOffsetFor(elevation, azimuth)).applyAxisAngle(new T.Vector3(0, 1, 0), yaw - Math.PI / 4);
          const fall = (v.y - (A.deck + plan.levels.road)) / key.y,
            x = v.x - key.x * fall;
          assert(Math.abs(x - AR.x) > plan.ROAD_WIDTH / 2 + 0.2, `A causeway lantern's shadow falls on the road (sun ${elevation.toFixed(1)}, ${azimuth.toFixed(2)}).`);
        }
  }
  // The pointer: the airport's deck is part of it, so a ray on the runway (or the apron) finds it;
  // seen from the overview's four bearings, the open sea 2.5 past the deck's edge does not, west of
  // the hall's own box and its slack (a box over the whole deck as tall as the tower found the
  // airport up to 5 units out).
  for (const [x, z] of [[RW.x0 + 1, RW.z], [AP.x0 + 1, AP.z1 - 1], [AR.x, AR.arch]]) {
    ray.set(new T.Vector3(x, 40, z), new T.Vector3(0, -1, 0));
    assert.equal(pickTarget(ray, models, model.parkHit), 'airport', `Pointing at the airport's deck at ${x}, ${z} finds no airport.`);
  }
  for (let k = 0; k < 4; k++) {
    const bearing = Math.PI / 4 + (k * Math.PI) / 2,
      back = new T.Vector3(Math.sin(bearing) * 38, 35, Math.cos(bearing) * 38).normalize();
    for (const [x, z] of [[A.x - 3, A.z - A.hd - 2.5], [A.x - A.hw - 2.5, A.z], [A.x + A.hw + 2.5, A.z - A.hd + 0.2], [A.x - 6, A.z + A.hd + 2.5]]) {
      ray.set(new T.Vector3(x, 0, z).addScaledVector(back, 80), back.clone().negate());
      assert.notEqual(pickTarget(ray, models, model.parkHit), 'airport', `Pointing at the sea at ${x}, ${z} from bearing ${bearing.toFixed(2)} finds the airport.`);
    }
    ray.set(new T.Vector3(RW.x0 + 3, A.deck, RW.z).addScaledVector(back, 80), back.clone().negate());
    assert.equal(pickTarget(ray, models, model.parkHit), 'airport', `Pointing at the runway from bearing ${bearing.toFixed(2)} finds no airport.`);
  }
  // The hangar and the windsock stand on the airport's ground, not in its model: a ray through any
  // point of the hangar's roof (its west end too, where a ray comes down past the deck's edge) or of
  // the sock, from the four Rotate stops and the chapter's bearing, finds the airport (the hangar's
  // west 29% and the sock found nothing). Their boxes hold the sock however it sways.
  {
    const { AIRPORT_EXTRAS } = await load('city-scene'),
      H = plan.HANGAR,
      land = model.airportLand,
      sockEntry = model.animated.find((e) => e.object.name === 'windsock-sock'),
      windsock = land.getObjectByName('airport-windsock'),
      within = (p, e) => p.x >= e.x0 - 1e-6 && p.x <= e.x1 + 1e-6 && p.z >= e.z0 - 1e-6 && p.z <= e.z1 + 1e-6 && p.y <= e.top + 1e-6,
      [hangarBox, sockBox] = AIRPORT_EXTRAS,
      roof = [],
      sock = [];
    assert(hangarBox.x0 === H.x0 && hangarBox.x1 === H.x1 && hangarBox.z0 === H.z0 && hangarBox.z1 === H.z1 && Math.abs(hangarBox.top - (A.deck + H.top)) < 1e-9, 'The hangar\'s pointer box is not its plan up to its roof.');
    for (let i = 0; i < 8; i++)
      for (let k = 0; k < 7; k++) {
        const x = H.x0 + ((i + 0.5) / 8) * (H.x1 - H.x0),
          z = H.z0 + ((k + 0.5) / 7) * (H.z1 - H.z0);
        ray.set(new T.Vector3(x, 40, z), new T.Vector3(0, -1, 0));
        const top = ray.intersectObject(land, true)[0];
        if (top && top.point.y > A.deck + 1) roof.push(top.point.clone());
      }
    for (let t = 0; t < 40; t += 0.73) {
      sockEntry.update(t, 0, 0);
      windsock.updateMatrixWorld(true);
      sockEntry.object.traverse((o) => {
        if (!o.isMesh) return;
        const pos = o.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const p = new T.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          assert(within(p, sockBox), `The windsock's sock sways out of its pointer box at t=${t.toFixed(2)} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}).`);
          if (i % 9 === 0) sock.push(p);
        }
      });
    }
    sockEntry.update(0, 0, 0);
    windsock.updateMatrixWorld(true);
    // The apron's kit stands over the deck's box (its tops up to 0.8 over the apron): every point of
    // its tops answers as the airport too.
    const kitTops = [],
      K = plan.APRON_KIT;
    for (const [x0, x1, z0, z1] of [[K.train.x0, K.train.x1, K.train.z - K.train.width / 2, K.train.z + K.train.width / 2], ...K.cones.at.map(([x, z]) => [x - K.cones.base / 2, x + K.cones.base / 2, z - K.cones.base / 2, z + K.cones.base / 2])])
      for (let i = 0; i < 12; i++)
        for (let k = 0; k < 4; k++) {
          ray.set(new T.Vector3(x0 + ((i + 0.5) / 12) * (x1 - x0), 40, z0 + ((k + 0.5) / 4) * (z1 - z0)), new T.Vector3(0, -1, 0));
          const top = ray.intersectObject(land, true)[0];
          if (top && top.point.y > plan.AIRSIDE + 0.15) kitTops.push(top.point.clone());
        }
    assert(roof.length > 40 && sock.length > 100 && kitTops.length > 60, `The pointer check finds no hangar roof, sock or apron kit to point at (${roof.length}, ${sock.length}, ${kitTops.length}).`);
    for (const bearing of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4, plan.chapterBearings.airport]) {
      const look = new T.Vector3(Math.sin(bearing) * 38, 35, Math.cos(bearing) * 38).normalize().negate();
      for (const { name, points } of [{ name: 'hangar\'s roof', points: roof }, { name: 'windsock\'s sock', points: sock.filter((_, i) => i % 7 === 0) }, { name: 'apron\'s kit', points: kitTops }])
        for (const p of points) {
          ray.set(p.clone().addScaledVector(look, -80), look);
          assert.equal(pickTarget(ray, models, model.parkHit), 'airport', `Pointing at the ${name} at ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)} from bearing ${bearing.toFixed(2)} finds no airport.`);
        }
    }
  }
  // Its surf is the tide foam's (no mesh of its own), after the island's two bands (and before the
  // tropic island's two, which come last): one strip, rows
  // of AIRPORT_FOAM_ROW vertices inner edge first, from the beach's tide line up the causeway's west
  // toe, round the deck and down the east toe. Its inner line lies under the stones (so no strip of
  // open water shows between them and the surf), it turns no corner sharper than its fillets' 15
  // degrees a row (no right-angled L where the causeway lands), its outer edge fades to nothing,
  // and its strength wanders: strong in places, gone for a short stretch in a few.
  {
    const foam = model.land.getObjectByName('tide-foam'),
      fz = foam.geometry.getAttribute('position'),
      fa = foam.geometry.getAttribute('color'),
      { AIRPORT_FOAM_ROW: row } = await load('town-ground'),
      { WATER } = await load('town-shared'),
      // Where the causeway's flank meets the sea, plus most of the stones' reach (they reach to 2.34);
      // round the deck 0.66 out (the lower course reaches 0.95); the fillets' centres in the sea.
      side = AR.top / 2 + (A.deck - 0.03 - WATER) * AR.flank + 0.18,
      fillets = [-1, 1].map((s) => [AR.x + s * (side + 0.6), A.z + A.hd + 0.66 + 0.6]),
      first = 2 * 2 * plan.OUTLINE_SAMPLES,
      rows = (fz.count - first - 2 * 2 * plan.TROPIC_SAMPLES) / row,
      inner = (r) => [fz.getX(first + r * row), fz.getZ(first + r * row)];
    assert(fa.itemSize === 4 && Number.isInteger(rows) && rows > 300, `The airport's surf is missing (${rows} rows).`);
    for (const r of [0, rows - 1]) assert(Math.abs(inner(r)[1] - (AR.beach - 2.95)) < 1e-4, 'The airport\'s surf does not start and end on the beach\'s tide line.');
    let gone = 0,
      strongest = 0,
      sharpest = 0;
    for (let r = 0; r < rows; r++) {
      const [x, z] = inner(r),
        alpha = fa.getW(first + r * row);
      assert.equal(fa.getW(first + r * row + row - 1), 0, 'The airport\'s surf has a hard outer edge.');
      if (alpha === 0) gone++;
      strongest = Math.max(strongest, alpha);
      const fillet = fillets.find(([cx, cz]) => (x - AR.x) * (cx - AR.x) > 0 && z <= cz + 1e-6 && z >= cz - 0.6 - 1e-6 && Math.abs(x - AR.x) >= side - 1e-6 && Math.abs(x - AR.x) <= Math.abs(cx - AR.x) + 1e-6);
      if (z >= fillets[0][1] - 1e-6) assert(Math.abs(Math.abs(x - AR.x) - side) < 1e-3 && side < 2.2, `The surf on the causeway's toe is off the stones at ${z.toFixed(1)}.`);
      else if (fillet) assert(Math.abs(Math.hypot(x - fillet[0], z - fillet[1]) - 0.6) < 1e-3, `The surf's fillet is off its arc at ${x.toFixed(2)}, ${z.toFixed(2)}.`);
      else assert(Math.abs(plan.airportDistance(x, z) - 0.66) < 1e-3, `The surf round the deck is off the stones at ${x.toFixed(1)}, ${z.toFixed(1)}.`);
      if (r > 0 && r < rows - 1) {
        const [px, pz] = inner(r - 1),
          [nx, nz] = inner(r + 1),
          turn = Math.abs(Math.atan2(Math.sin(Math.atan2(nz - z, nx - x) - Math.atan2(z - pz, x - px)), Math.cos(Math.atan2(nz - z, nx - x) - Math.atan2(z - pz, x - px))));
        sharpest = Math.max(sharpest, turn);
      }
    }
    assert(sharpest < (16 * Math.PI) / 180, `The airport's surf turns a corner of ${((sharpest * 180) / Math.PI).toFixed(0)} degrees.`);
    assert(strongest > 0.6 && gone > 0 && gone < rows * 0.15, `The airport's surf is too even (${strongest.toFixed(2)} at most, ${gone} rows gone).`);
  }
  model.airportLand.traverse((o) => assert(!o.isMesh || !o.material.transparent, 'A see-through mesh on the airport.'));
  // Budgets: the airport's ground (with its hangar, windsock, forecourt furniture and apron kit, whose new
  // families are the hangar's and the kit's paint, the benches' wood and the planter's box ball, and
  // whose two lamps add their lanterns) and its building add at most 27 meshes and 70k triangles to
  // the town.
  let landMeshes = 0,
    landTris = 0,
    hallMeshes = 0,
    hallTris = 0;
  model.airportLand.traverse((o) => o.isMesh && (landMeshes++, (landTris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3)));
  hall.traverse((o) => o.isMesh && (hallMeshes++, (hallTris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3)));
  assert(landMeshes <= 20 && hallMeshes <= 7 && landTris + hallTris <= 70000, `The airport costs ${landMeshes} + ${hallMeshes} meshes and ${Math.round(landTris + hallTris)} triangles.`);
  // The building alone (the hall, the link, the tower and the jet bridge) stays under the residence's
  // and the lighthouse's budgets combined, near the gate's.
  assert(hallTris <= 20000, `The Departures Hall, its tower and its jet bridge cost ${Math.round(hallTris)} triangles.`);
}
// The airport's ground built on its own, before batching: its boulders (the armour and the causeway's
// flanks) are one merged geometry under 40k triangles; the deck's grass, the coping and the road are
// one mesh each, and the deck's grass lies on the deck's level.
{
  const { createAirport } = await load('town-airport'),
    { createProps } = await load('town-props'),
    { createNature } = await load('town-nature'),
    { createKit } = await load('town-kit'),
    { createCityMaterials } = await load('city-materials'),
    library = createCityMaterials(),
    ctx = { library, material: library.material, season: 'summer', land: new T.Group(), lamps: [], clocks: [], animated: [] },
    kit = createKit(ctx),
    g = new T.Group();
  createAirport(ctx, kit, createProps(ctx, kit), createNature(ctx, kit)).airportGround(g);
  const named = (name) => g.children.filter((o) => o.name === name);
  for (const name of ['airport-armour', 'airport-deck', 'airport-coping', 'airport-road']) assert.equal(named(name).length, 1, `The airport's ${name} is not one mesh.`);
  const armour = named('airport-armour')[0].geometry;
  assert(armour.attributes.position.count / 3 <= 40000, `The airport's armour costs ${armour.attributes.position.count / 3} triangles.`);
  // Its stones read as smooth chunky boulders, not faceted blobs: each an icosahedron of detail 2 at
  // least (one run of 20 (detail + 1)^2 faces; detail 1's 80 left 10-12-sided outlines beside the
  // beach's smooth boulder at a close zoom), its corners jittered by 4% at most (8% made dents);
  // about half as many as the 290 there were, each about 1.5 times the size (their median plan
  // extent 0.68 then).
  {
    const { ARMOUR } = await load('town-airport'),
      q = armour.attributes.position,
      key = (i) => `${q.getX(i).toFixed(4)},${q.getY(i).toFixed(4)},${q.getZ(i).toFixed(4)}`,
      parent = new Map(),
      find = (k) => (parent.get(k) === k ? k : (parent.set(k, find(parent.get(k))), parent.get(k)));
    for (let i = 0; i < q.count; i++) if (!parent.has(key(i))) parent.set(key(i), key(i));
    for (let i = 0; i + 2 < q.count; i += 3) for (const j of [1, 2]) parent.set(find(key(i + j)), find(key(i)));
    const stones = new Map();
    for (let i = 0; i < q.count; i += 3) {
      const root = find(key(i));
      if (!stones.has(root)) stones.set(root, { faces: 0, box: new T.Box3() });
      const stone = stones.get(root);
      stone.faces++;
      for (let k = 0; k < 3; k++) stone.box.expandByPoint(new T.Vector3().fromBufferAttribute(q, i + k));
    }
    const faces = 20 * (ARMOUR.detail + 1) ** 2,
      extents = [...stones.values()].map(({ box }) => Math.max(box.max.x - box.min.x, box.max.z - box.min.z)).sort((a, b) => a - b),
      median = extents[extents.length >> 1];
    assert(ARMOUR.detail >= 2 && ARMOUR.jitter <= 0.08, `The armour's stones are icosahedra of detail ${ARMOUR.detail}, jittered ${ARMOUR.jitter}.`);
    assert([...stones.values()].every((stone) => stone.faces === faces), 'An armour stone is not one smooth icosahedron of the armour\'s detail.');
    assert(stones.size >= 100 && stones.size <= 170 && median >= 0.95, `The armour lays ${stones.size} stones of median extent ${median.toFixed(2)}, not about half the 290 at about 1.5 times their 0.68.`);
  }
  // Its stones sit a clear step under the coping's kerb stone in value (they were near-white beads
  // round the island), and their greys spread widely: a darker stone for about every three.
  {
    const colour = armour.getAttribute('color'),
      luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b,
      tones = Array.from({ length: colour.count }, (_, i) => luminance(colour.getX(i), colour.getY(i), colour.getZ(i))).sort((a, b) => a - b),
      kerb = new T.Color((await load('town-shared')).palette.kerb),
      mean = tones.reduce((a, b) => a + b, 0) / tones.length,
      spread = tones[Math.floor(tones.length * 0.9)] / tones[Math.floor(tones.length * 0.1)];
    assert(mean < 0.45 * luminance(kerb.r, kerb.g, kerb.b) && spread > 1.75, `The airport's armour is too pale or too even (${(mean / luminance(kerb.r, kerb.g, kerb.b)).toFixed(2)} of the coping, spread ${spread.toFixed(2)}).`);
    // The runway a clear step darker than the town's asphalt (never another road), the apron
    // mid-grey concrete rather than a pale square, cast in bays: its four joints flat sheets (no
    // sides to show as a dotted sliver at a slant), as the paint is.
    const { AIRPORT_LOOK: look } = await load('town-airport'),
      { palette } = await load('town-shared'),
      tone = (hex) => {
        const c = new T.Color(hex);
        return luminance(c.r, c.g, c.b);
      };
    assert(tone(look.runway) < 0.6 * tone(palette.road) && tone(look.apron) < 0.85 * tone(palette.pavement), 'The runway reads as another road, or the apron as a pale square.');
    const sheets = g.children.filter((o) => o.isMesh && o.geometry.getAttribute('normal').array.every((n, i) => Math.abs(n - (i % 3 === 1 ? 1 : 0)) < 1e-6));
    assert(sheets.some((o) => o.geometry.getAttribute('position').count === 4 * 6 && o.geometry.getAttribute('color')?.array.every((c) => Math.abs(c - look.joint) < 1e-6)), 'The apron has not its four joints.');
    assert(sheets.filter((o) => o.material.userData.surfaceKind === 'paint').length === 2, 'The airport\'s paint is not two flat sheets (the markings and the lead-in).');
    // Each runway threshold reads as one, not as another zebra crossing: a solid bar across the
    // runway (1.9 of its 2.2 at least, 0.25 wide at least) 0.15 in from its end, then four keys along
    // it, each unbroken for 1.7 at least, with bare concrete between them.
    const { THRESHOLD: TH } = await load('town-airport'),
      RW = plan.RUNWAY,
      marks = sheets.find((o) => o.material.userData.surfaceKind === 'paint' && o.material.color.getHex() === new T.Color(look.paint).getHex()),
      mq = marks.geometry.attributes.position,
      tris = [],
      side = (u, v, w) => (u.x - w.x) * (v.y - w.y) - (v.x - w.x) * (u.y - w.y);
    for (let i = 0; i < mq.count; i += 3) tris.push([0, 1, 2].map((k) => new T.Vector2(mq.getX(i + k), mq.getZ(i + k))));
    const painted = (x, z) => {
      const p = new T.Vector2(x, z);
      return tris.some(([a, b, c]) => {
        const d = [side(p, a, b), side(p, b, c), side(p, c, a)];
        return !(d.some((e) => e < 0) && d.some((e) => e > 0));
      });
    };
    for (const end of [-1, 1]) {
      const from = end < 0 ? RW.x0 : RW.x1,
        at = (d) => from - end * d,
        name = end < 0 ? 'west' : 'east';
      for (let z = -0.95; z <= 0.95 + 1e-9; z += 0.05) assert(painted(at(0.3), RW.z + z), `The runway's ${name} threshold has no bar across it at ${z.toFixed(2)}.`);
      assert(painted(at(0.18), RW.z) && painted(at(0.42), RW.z) && !painted(at(0.05), RW.z) && !painted(at(0.52), RW.z + 0.55), `The runway's ${name} threshold bar is off its 0.15-0.45 from the end.`);
      for (const c of TH.keys) for (let d = 0.65; d <= 2.35 + 1e-9; d += 0.1) assert(painted(at(d), RW.z + c), `A ${name} threshold key is broken or short at ${d.toFixed(2)}.`);
      for (const c of [-0.55, 0, 0.55]) assert(!painted(at(1.5), RW.z + c), `The ${name} threshold's keys run together.`);
    }
  }
  const lawn = named('airport-deck')[0].geometry.attributes.position;
  for (let i = 0; i < lawn.count; i++) assert(Math.abs(lawn.getY(i) - plan.AIRPORT.deck) < 1e-6 && plan.airportDistance(lawn.getX(i), lawn.getZ(i)) <= -0.3 + 1e-4, 'The deck\'s grass leaves the deck.');
  // Six lamps: the causeway's four and the forecourt's two.
  g.updateMatrixWorld(true);
  const causewayLanterns = ctx.lamps.filter((l) => l.getWorldPosition(new T.Vector3()).z > plan.AIRPORT_ROAD.island - 0.4);
  assert.equal(ctx.lamps.length, 6, 'The airport\'s ground has not six lamps.');
  assert.equal(causewayLanterns.length, 4, 'The causeway has not four lamps.');
  assert(ctx.lamps.every((l) => causewayLanterns.includes(l) || l.parent.name === 'forecourt-lamp'), 'A lamp off the causeway is not the forecourt\'s.');
  // The causeway lamps' heads (above the post's boss) cast no shadow, but for the brass finial: four
  // in a row threw chevrons along the road that read as painted arrows. Their posts still cast.
  for (const lantern of causewayLanterns) {
    let heads = 0,
      posts = 0;
    for (const part of lantern.parent.children) {
      if (!part.isMesh || part === lantern) continue;
      if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
      if (part.geometry.boundingBox.min.y > 1.0) {
        if (part.material.userData.surfaceKind !== 'brass') {
          heads++;
          assert(!part.castShadow && part.userData.noShadow, 'A causeway lamp\'s head casts a shadow.');
        }
      } else if (part.castShadow) posts++;
    }
    assert(heads >= 3 && posts >= 3, `A causeway lamp has ${heads} head parts and ${posts} casting post parts.`);
  }
  // The forecourt's two lamps are frosted globes on stone piers, not the town's cast-iron standard
  // (its fine black ironwork against the pale paving was the forecourt's flicker as the view moved):
  // under its globe each is stone but for the low iron cup that holds the globe, no part under 0.2
  // across, and the globe casts nothing.
  for (const lantern of ctx.lamps.filter((l) => !causewayLanterns.includes(l))) {
    let stone = 0,
      cups = 0,
      thinnest = Infinity;
    for (const part of lantern.parent.children) {
      if (!part.isMesh || part === lantern) continue;
      const kind = part.material.userData.surfaceKind,
        size = new T.Box3().setFromObject(part).getSize(new T.Vector3());
      thinnest = Math.min(thinnest, size.x, size.z);
      if (kind === 'stone') stone++;
      else assert(kind === 'iron' && size.y <= 0.2 && ++cups === 1, `A forecourt lamp has a ${kind} part ${size.y.toFixed(2)} tall.`);
    }
    lantern.geometry.computeBoundingSphere();
    assert(stone >= 2 && cups === 1 && thinnest >= 0.2 - 1e-6 && lantern.geometry.boundingSphere.radius >= 0.15 && !lantern.castShadow, `A forecourt lamp is not a globe on a stone pier (${stone} stone parts, ${cups} cups, ${thinnest.toFixed(2)} at its thinnest).`);
  }
  /** Every vertex of o's meshes, in the world. */
  const vertices = (o, visit) => {
    const p = new T.Vector3();
    o.traverse((m) => {
      if (!m.isMesh) return;
      const q = m.geometry.attributes.position;
      for (let i = 0; i < q.count; i++) visit(p.fromBufferAttribute(q, i).applyMatrix4(m.matrixWorld), m);
    });
  };
  const { AIRPORT_LOOK: LOOK } = await load('town-airport'),
    hex = (c) => new T.Color(c).getHex();
  // The hangar (plan.HANGAR), west of the apron: inside its plan, which the overview frames (the
  // roof's 2.4 over the deck included), standing on the deck like the hall's plinth, 0.3 in from the
  // deck's edge at least; one barrel roof of galvanised grey, flagged as the roof (its eave shades
  // the walls), and nothing of it copper; its green doors in the east gable, to the apron, a doorway
  // 3 wide under an arched head over 1.8; and a concrete pad at the airside's level from under them
  // to the apron.
  {
    const H = plan.HANGAR,
      hangar = g.getObjectByName('airport-hangar'),
      box = new T.Box3().setFromObject(hangar);
    assert(box.min.x >= H.x0 - 1e-6 && box.max.x <= H.x1 + 1e-6 && box.min.z >= H.z0 - 1e-6 && box.max.z <= H.z1 + 1e-6, `The hangar leaves its plan: ${box.min.toArray().map((n) => n.toFixed(2)).join(', ')} to ${box.max.toArray().map((n) => n.toFixed(2)).join(', ')}.`);
    assert(Math.abs(box.max.y - (plan.AIRPORT.deck + H.top)) < 0.005 && Math.abs(box.min.y - plan.AIRPORT.deck) < 1e-6, `The hangar stands from ${box.min.y.toFixed(3)} to ${box.max.y.toFixed(3)}.`);
    vertices(hangar, (p) => assert(plan.onAirport(p.x, p.z, -0.3), `The hangar leaves the deck at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}.`));
    const roofs = [];
    hangar.traverse((o) => o.isMesh && o.userData.roof && roofs.push(o));
    const { HANGAR_ROOF } = await load('town-airport');
    assert(roofs.length === 1 && HANGAR_ROOF !== 'copper' && roofs[0].material.userData.surfaceKind === HANGAR_ROOF && roofs[0].material.color.getHex() === hex(LOOK.hangarRoof) && roofs[0].userData.eaveY > 1, 'The hangar has not its one galvanised barrel roof.');
    // The hall's verdigris barrel (and the tower's cap that echoes it) is the airport's only copper:
    // the hangar's barrel in the same copper made the island's two ends read as twins, so the hall
    // was no longer its one main building. The hangar's grey is its cladding's a step darker (no
    // more saturated, so it stays quiet), its ribs a step lighter than the sheet.
    {
      let copper = 0;
      hangar.traverse((o) => o.isMesh && o.material.userData.surfaceKind === 'copper' && copper++);
      assert.equal(copper, 0, 'Part of the hangar is copper, the hall\'s roof.');
      const lum = (c) => {
          const k = new T.Color(c);
          return 0.2126 * k.r + 0.7152 * k.g + 0.0722 * k.b;
        },
        sat = (c) => {
          const k = new T.Color(c),
            hi = Math.max(k.r, k.g, k.b);
          return (hi - Math.min(k.r, k.g, k.b)) / hi;
        },
        sheet = lum(LOOK.hangarRoof) / lum(LOOK.cladding);
      assert(sheet > 0.7 && sheet < 0.95 && sat(LOOK.hangarRoof) <= sat(LOOK.cladding) && lum(LOOK.hangarRib) > 1.08 * lum(LOOK.hangarRoof) && sat(LOOK.hangarRib) <= sat(LOOK.cladding), `The hangar's roof is not a quiet grey a step under its cladding (${sheet.toFixed(2)} of it) with lighter ribs.`);
      let ribs = 0;
      hangar.traverse((o) => o.isMesh && o.material.color.getHex() === hex(LOOK.hangarRib) && o.material.userData.surfaceKind === HANGAR_ROOF && ribs++);
      assert.equal(ribs, 1, 'The hangar\'s roof has not its ribs in the lighter grey.');
    }
    let z0 = Infinity,
      z1 = -Infinity,
      head = 0,
      shut = 0;
    vertices(hangar, (p, m) => {
      if (m.material.color.getHex() !== hex(LOOK.doors) || p.x < H.x1 - 0.3) return;
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
      head = Math.max(head, p.y - plan.AIRPORT.deck);
    });
    // The leaves close the doorway: their faces to the apron cover its 3 x 1.54 and its arched head.
    hangar.traverse((m) => {
      if (!m.isMesh || m.material.color.getHex() !== hex(LOOK.doors)) return;
      const q = m.geometry.attributes.position,
        [a, b, c] = [0, 1, 2].map(() => new T.Vector3());
      for (let i = 0; i + 2 < q.count; i += 3) {
        a.fromBufferAttribute(q, i).applyMatrix4(m.matrixWorld);
        b.fromBufferAttribute(q, i + 1).applyMatrix4(m.matrixWorld);
        c.fromBufferAttribute(q, i + 2).applyMatrix4(m.matrixWorld);
        const n = b.sub(a).cross(c.sub(a));
        if (a.x > H.x1 - 0.3 && n.x > 0.9 * n.length()) shut += n.length() / 2;
      }
    });
    assert(z1 - z0 > 2.9 && head > 1.8 && shut > 5, `The hangar's doors to the apron span ${(z1 - z0).toFixed(2)}, rise ${head.toFixed(2)} and close ${shut.toFixed(2)} of the doorway.`);
    // Its west gable, to the sea, is dressed and not one blank grey arch: besides the cornice carried
    // across it and the archivolt, two blonde pilasters rise past the cornice either side of its middle.
    {
      const middle = (H.z0 + H.z1) / 2,
        [a, b, c] = [0, 1, 2].map(() => new T.Vector3()),
        n = new T.Vector3();
      let pilasters = 0;
      hangar.traverse((m) => {
        if (!m.isMesh || m.material.color.getHex() !== hex(LOOK.dressing)) return;
        const q = m.geometry.attributes.position;
        for (let i = 0; i + 2 < q.count; i += 3) {
          a.fromBufferAttribute(q, i).applyMatrix4(m.matrixWorld);
          b.fromBufferAttribute(q, i + 1).applyMatrix4(m.matrixWorld);
          c.fromBufferAttribute(q, i + 2).applyMatrix4(m.matrixWorld);
          n.subVectors(b, a).cross(new T.Vector3().subVectors(c, a));
          const mid = a.clone().add(b).add(c).divideScalar(3),
            up = mid.y - plan.AIRPORT.deck;
          if (n.x < -0.9 * n.length() && mid.x < H.x0 + 0.2 && up > 1.1 && up < 1.85 && Math.abs(Math.abs(mid.z - middle) - 0.75) < 0.1) pilasters++;
        }
      });
      assert(pilasters >= 4, `The hangar's west gable has ${pilasters} pilaster faces past its cornice.`);
    }
    // Its ironwork (the doors' handles and the south door's knob) is chunky: every piece at least
    // 0.07 across every way (thinner ones twinkle as the view moves).
    {
      const iron = [];
      hangar.traverse((m) => m.isMesh && m.material.color.getHex() === hex(LOOK.iron) && iron.push(m));
      const pieces = [];
      for (const m of iron) {
        const q = m.geometry.attributes.position,
          key = (i) => [q.getX(i), q.getY(i), q.getZ(i)].map((n) => n.toFixed(4)).join(','),
          parent = new Map(),
          find = (k) => (parent.get(k) === k ? k : (parent.set(k, find(parent.get(k))), parent.get(k)));
        for (let i = 0; i < q.count; i++) if (!parent.has(key(i))) parent.set(key(i), key(i));
        for (let i = 0; i + 2 < q.count; i += 3) for (const j of [1, 2]) parent.set(find(key(i + j)), find(key(i)));
        const boxes = new Map();
        for (let i = 0; i < q.count; i++) {
          const root = find(key(i));
          if (!boxes.has(root)) boxes.set(root, new T.Box3());
          boxes.get(root).expandByPoint(new T.Vector3().fromBufferAttribute(q, i).applyMatrix4(m.matrixWorld));
        }
        pieces.push(...boxes.values());
      }
      assert(pieces.length === 3, `The hangar has ${pieces.length} pieces of ironwork, not its two handles and a knob.`);
      for (const b of pieces) {
        const size = b.getSize(new T.Vector3());
        assert(Math.min(size.x, size.y, size.z) >= 0.07 - 1e-3, `A piece of the hangar's ironwork is ${size.toArray().map((n) => n.toFixed(3)).join(' x ')}.`);
      }
    }
    const pad = g.children.find((o) => {
      if (!o.isMesh || o.material.color.getHex() !== hex(LOOK.apron)) return false;
      const b = new T.Box3().setFromObject(o);
      return Math.abs(b.max.x - plan.APRON.x0) < 1e-6 && b.min.x < H.x1;
    });
    const padBox = pad && new T.Box3().setFromObject(pad);
    assert(pad && padBox.min.x < H.x1 - 0.15 && Math.abs(padBox.max.y - plan.AIRSIDE) < 1e-6 && padBox.min.z < z0 && padBox.max.z > z1, 'No concrete pad joins the hangar\'s doors to the apron.');
  }
  // The windsock on its spot (plan.WINDSOCK): its footing on the deck 0.3 in from the edge at least;
  // its sock on a pivot of its own (windsock-sock), up in the air over the deck and streaming east,
  // downwind of the prevailing westerly; under 2.5 over the sea.
  {
    const W = plan.WINDSOCK,
      w = g.getObjectByName('airport-windsock'),
      sock = w?.getObjectByName('windsock-sock');
    assert(w && sock && Math.abs(w.position.x - W.x) < 1e-9 && Math.abs(w.position.z - W.z) < 1e-9 && Math.abs(w.position.y - plan.AIRPORT.deck) < 1e-9, 'The windsock is off its spot.');
    const all = new T.Box3().setFromObject(w),
      streamer = new T.Box3().setFromObject(sock);
    vertices(w, (p) => assert(plan.onAirport(p.x, p.z, 0) && (p.y > plan.AIRPORT.deck + 0.12 || plan.onAirport(p.x, p.z, -0.3)), `The windsock leaves the deck at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}.`));
    assert(streamer.min.y > plan.AIRPORT.deck + 1.2 && streamer.max.x > W.x + 0.6 && all.max.y < 2.5, 'The windsock\'s sock does not stream east in the air.');
  }
  // The forecourt's furniture: the planter on the road's axis, four bollards 0.14 across along the
  // kerb (two either side of it, in pairs about the axis), the two lamps and two benches facing in
  // across the axis; all of it on the forecourt's paving, and clear of the hall's steps (0.3 in
  // front of them across their width).
  {
    const FC = plan.FORECOURT,
      AR = plan.AIRPORT_ROAD,
      kerb = FC.z1 - 0.4,
      steps = AR.arch + 0.7,
      pieces = g.children.filter((o) => o.name.startsWith('forecourt-')),
      count = (name) => pieces.filter((o) => o.name === name).length;
    assert.deepEqual(['forecourt-planter', 'forecourt-bollards', 'forecourt-lamp', 'forecourt-bench'].map(count), [1, 1, 2, 2], 'The forecourt lacks its planter, bollards, lamps or benches.');
    for (const o of pieces)
      vertices(o, (p) => {
        assert(p.x > FC.x0 && p.x < FC.x1 && p.z > FC.z0 && p.z < kerb, `The forecourt's ${o.name} leaves its paving at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}.`);
        assert(Math.abs(p.x - AR.x) > 1.5 || p.z > steps + 0.3, `The forecourt's ${o.name} crowds the hall's steps at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}.`);
      });
    assert(Math.abs(pieces.find((o) => o.name === 'forecourt-planter').position.x - AR.x) < 1e-9, 'The planter is off the road\'s axis.');
    const posts = [];
    vertices(pieces.find((o) => o.name === 'forecourt-bollards'), (p) => {
      const near = posts.find((b) => Math.abs(b.x - p.x) < 0.2);
      if (near) [near.lo, near.hi] = [Math.min(near.lo, p.x), Math.max(near.hi, p.x)];
      else posts.push({ x: p.x, lo: p.x, hi: p.x });
    });
    const middles = posts.map((b) => (b.lo + b.hi) / 2).sort((a, b) => a - b);
    assert(posts.length === 4 && posts.every((b) => Math.abs(b.hi - b.lo - 0.14) < 0.005) && Math.abs(middles[0] + middles[3] - 2 * AR.x) < 1e-6 && Math.abs(middles[1] + middles[2] - 2 * AR.x) < 1e-6, `The bollards are not four 0.14 across in pairs about the road's axis: ${posts.map((b) => (b.hi - b.lo).toFixed(3)).join(', ')}.`);
    for (const bench of pieces.filter((o) => o.name === 'forecourt-bench'))
      assert(Math.sin(bench.rotation.y) * (AR.x - bench.position.x) > 0 && Math.abs(Math.cos(bench.rotation.y)) < 1e-9, 'A forecourt bench turns its back on the axis.');
  }
  // The apron's ground-service kit (plan.APRON_KIT), built on its own: a tug and two carts end to
  // end along the apron's south edge, each inside the train's plan and on the apron's concrete,
  // standing on the airside's slabs and under 0.8 tall, the tug at the east end; three cones in the
  // north-east corner, each inside its square foot's plan. Every piece of every part (each run of
  // joined faces) is 0.07 across or more every way (thinner ones twinkle as the view moves); the kit
  // is the hall's cream and green, its undergear dark rubber and pale hubs, and the cones' orange
  // (the tram's) is its one accent; nothing of it is glass, lit or a lamp, and its dark undergear
  // casts nothing.
  {
    const K = plan.APRON_KIT,
      AP = plan.APRON,
      apronZ0 = plan.TAXIWAY.z + plan.TAXIWAY.width / 2,
      kit = g.children.filter((o) => o.name.startsWith('apron-')),
      count = (name) => kit.filter((o) => o.name === name).length,
      tug = kit.find((o) => o.name === 'apron-tug'),
      carts = kit.filter((o) => o.name === 'apron-cart'),
      cones = kit.find((o) => o.name === 'apron-cones'),
      inside = (p, [x0, x1, z0, z1]) => p.x >= x0 - 1e-6 && p.x <= x1 + 1e-6 && p.z >= z0 - 1e-6 && p.z <= z1 + 1e-6,
      trainBox = [K.train.x0, K.train.x1, K.train.z - K.train.width / 2, K.train.z + K.train.width / 2],
      coneBoxes = K.cones.at.map(([x, z]) => [x - K.cones.base / 2, x + K.cones.base / 2, z - K.cones.base / 2, z + K.cones.base / 2]),
      allowed = new Set([LOOK.render, LOOK.green, LOOK.tyre, LOOK.steel].map(hex)),
      orange = hex((await load('town-shared')).palette.tramOrange);
    assert.deepEqual(['apron-tug', 'apron-cart', 'apron-cones'].map(count), [1, 2, 1], 'The apron lacks its tug, its two carts or its cones.');
    assert(carts.every((c) => c.position.x < tug.position.x) && Math.abs(tug.position.z - K.train.z) < 1e-9 && carts.every((c) => Math.abs(c.position.z - K.train.z) < 1e-9), 'The baggage train is not the tug at the east end and its two carts behind it, on the train\'s line.');
    for (const o of kit) {
      const box = new T.Box3().setFromObject(o);
      assert(Math.abs(box.min.y - plan.AIRSIDE) < 1e-6 && box.max.y - plan.AIRSIDE < 0.8, `The apron's ${o.name} stands from ${box.min.y.toFixed(3)} to ${box.max.y.toFixed(3)}.`);
      vertices(o, (p, m) => {
        assert(o === cones ? coneBoxes.some((b) => inside(p, b)) : inside(p, trainBox), `The apron's ${o.name} leaves its plan at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}.`);
        assert(p.x > AP.x0 + 0.05 && p.x < AP.x1 - 0.05 && p.z > apronZ0 + 0.05 && p.z < AP.z1 + 1e-6, `The apron's ${o.name} leaves the apron's concrete at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}.`);
        const colour = m.material.color.getHex(),
          kind = m.material.userData.surfaceKind;
        assert(kind !== 'glass' && !ctx.lamps.includes(m), `The apron's ${o.name} has glass or a lamp.`);
        assert(o === cones ? colour === orange || colour === hex(LOOK.render) : allowed.has(colour), `The apron's ${o.name} is ${m.material.color.getHexString()}, not the kit's cream, green, rubber and steel (or the cones' orange and cream).`);
        if (colour === hex(LOOK.tyre) || colour === hex(LOOK.steel)) assert(!m.castShadow && m.userData.noShadow, `The apron's ${o.name}'s undergear casts.`);
      });
      // Every run of joined faces, every way: 0.07 at least.
      o.traverse((m) => {
        if (!m.isMesh) return;
        const q = m.geometry.attributes.position,
          key = (i) => [q.getX(i), q.getY(i), q.getZ(i)].map((n) => n.toFixed(4)).join(','),
          parent = new Map(),
          find = (k) => (parent.get(k) === k ? k : (parent.set(k, find(parent.get(k))), parent.get(k)));
        for (let i = 0; i < q.count; i++) if (!parent.has(key(i))) parent.set(key(i), key(i));
        for (let i = 0; i + 2 < q.count; i += 3) for (const j of [1, 2]) parent.set(find(key(i + j)), find(key(i)));
        const boxes = new Map();
        for (let i = 0; i < q.count; i++) {
          const root = find(key(i));
          if (!boxes.has(root)) boxes.set(root, new T.Box3());
          boxes.get(root).expandByPoint(new T.Vector3().fromBufferAttribute(q, i).applyMatrix4(m.matrixWorld));
        }
        for (const b of boxes.values()) {
          const size = b.getSize(new T.Vector3());
          assert(Math.min(size.x, size.y, size.z) >= 0.07 - 1e-3, `A part of the apron's ${o.name} is ${size.toArray().map((n) => n.toFixed(3)).join(' x ')}.`);
        }
      });
    }
    // The cones carry the kit's only orange, and each stands on its own square foot.
    let orangeParts = 0;
    for (const o of kit) o.traverse((m) => m.isMesh && m.material.color.getHex() === orange && (orangeParts++, assert.equal(o, cones, 'Orange off the cones.')));
    assert(orangeParts === 1 && coneBoxes.every((b) => {
      let n = 0;
      vertices(cones, (p) => inside(p, b) && n++);
      return n > 50;
    }), 'The cones are not three, each on its own foot, in the kit\'s one orange.');
  }
  // The stand's lead-in line ends just ahead of the parked plane's nose wheels.
  {
    const line = g.children.find((o) => o.isMesh && o.material.color.getHex() === hex(LOOK.leadIn)),
      end = line && new T.Box3().setFromObject(line).max.x,
      wheels = plan.STAND.x + plan.PLANE.nose;
    assert(line && end - wheels > 0 && end - wheels <= 0.2, `The lead-in line ends ${(end - wheels).toFixed(2)} from the plane's nose wheels.`);
  }
  // The hall lane's dressing, flat on the ground and facing up: its kerb radii at the mouth (the
  // road's asphalt, across held at the carriageway's edge) and its flush edging of the town's
  // paving, from the ring's footway to the causeway's. It keeps a trunk's breadth from every tree
  // (it is no carriageway, so the lane's 0.6 does not apply) and 1.5 from the cottages as built.
  {
    const { LANE_DRESSING } = await load('town-airport'),
      AR = plan.AIRPORT_ROAD,
      [radii, edging] = ['airport-lane-radii', 'airport-lane-edging'].map((name) => named(name)[0]?.geometry),
      segment = (px, pz, ax, az, bx, bz) => {
        const dx = bx - ax,
          dz = bz - az,
          t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
        return Math.hypot(px - ax - t * dx, pz - az - t * dz);
      },
      apart = (px, pz) => {
        let best = Infinity;
        for (const geometry of [radii, edging]) {
          const p = geometry.getAttribute('position');
          for (let i = 0; i < p.count; i += 3) {
            const [ax, az, bx, bz, cx, cz] = [p.getX(i), p.getZ(i), p.getX(i + 1), p.getZ(i + 1), p.getX(i + 2), p.getZ(i + 2)],
              s1 = (bx - ax) * (pz - az) - (bz - az) * (px - ax),
              s2 = (cx - bx) * (pz - bz) - (cz - bz) * (px - bx),
              s3 = (ax - cx) * (pz - cz) - (az - cz) * (px - cx);
            if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return 0;
            best = Math.min(best, segment(px, pz, ax, az, bx, bz), segment(px, pz, bx, bz, cx, cz), segment(px, pz, cx, cz, ax, az));
          }
        }
        return best;
      };
    assert(radii && edging, 'The hall lane has no kerb radii or edging.');
    for (const geometry of [radii, edging]) {
      const p = geometry.getAttribute('position'),
        n = geometry.getAttribute('normal');
      for (let i = 0; i < p.count; i++) {
        assert(n.getY(i) > 0.999 && Math.abs(p.getY(i) - plan.levels.road) < 0.01, 'The hall lane\'s dressing is not flat on the ground.');
        assert(p.getZ(i) <= AR.lane + 1e-6 && p.getZ(i) >= AR.beach - 0.15 - 1e-6 && Math.abs(p.getX(i) - AR.x) <= plan.ROAD_WIDTH / 2 + LANE_DRESSING.radius + 1e-6, 'The hall lane\'s dressing strays.');
      }
    }
    const uv = radii.getAttribute('uv'),
      rp = radii.getAttribute('position');
    for (let i = 0; i < uv.count; i++) assert(Math.abs(Math.abs(uv.getX(i)) - plan.ROAD_WIDTH / 2) < 1e-6 && Math.abs(uv.getY(i) - (4000 + AR.lane - rp.getZ(i))) < 1e-3, 'The kerb radii are off the road\'s uv.');
    for (const t of plan.plantingPlan()) assert(apart(t.x, t.z) >= 0.5, `The hall lane's dressing runs ${apart(t.x, t.z).toFixed(2)} from ${t.id}.`);
    const homes = (await load('town-homes')).createHomes(ctx, kit, (await load('town-nature')).createNature(ctx, kit)),
      v = new T.Vector3();
    for (const c of plan.cottages.filter((c) => Math.abs(c.x - AR.x) < 12 && c.z < AR.lane + 4)) {
      const cottage = new T.Group();
      homes.buildCottage(cottage, c);
      cottage.updateMatrixWorld(true);
      let near = Infinity;
      cottage.traverse((o) => {
        if (!o.isMesh) return;
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
          if (Math.abs(v.x - AR.x) < 4.5) near = Math.min(near, apart(v.x, v.z));
        }
      });
      assert(near >= 1.5, `The hall lane's dressing passes ${near.toFixed(2)} from cottage ${c.n}.`);
    }
  }
  library.dispose();
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
const { windowClock, followWindows, WINDOW_RATE, RESET_RATE } = await load('glasgow-sun');
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
  rooms = panes.filter((p) => ['home', 'residence', 'civic', 'studio'].includes(p.role)),
  at = (h) => windowClock(h),
  lit = (list, h) => list.filter((p) => windowLevel(p.light, at(h)) > 0.1),
  Y = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b,
  todayGlow = new T.Color('#ffd29a');
assert.deepEqual(phased.windows.map((p) => [p.place, p.light]), panes.map((p) => [p.place, p.light]), 'Every build lights the same panes.');
// Evening: about two rooms in three lit (at half, the town hall and the archive were nearly dark subjects in their own
// chapters); the members' homes are lit late, and the studio works later.
{
  const evening = lit(rooms, 20).length / rooms.length;
  assert(evening >= 0.55 && evening <= 0.8, `${Math.round(evening * 100)}% of the rooms are lit at 20:00.`);
  // Every civic chapter subject keeps a lit front until after 01:00 (windowLit at today's colour, 0.8): the hall's
  // fanlight and tower window, an archive front window.
  for (const [id, least] of [['town-hall', 2], ['city-archive', 1]]) {
    const kept = rooms.filter((p) => p.place === id && Math.round(p.light[0] * 255) === 204 && Math.round(p.light[1] * 255) === 128);
    assert(kept.length >= least && lit(kept, 1.25).length === kept.length, `${id} has no front lit late.`);
  }
  // The deep night keeps a few warm points (09:30 in Beijing): dim warm lamps that never go out, on fronts the overview sees.
  const lamps = rooms.filter((p) => Math.round(p.light[0] * 255) === 115 && p.light[1] === 0 && p.light[2] === 1 && p.light[3] === 1);
  assert(lamps.length >= 4 && lamps.length <= 6, `${lamps.length} night lamps.`);
  for (const h of [2.5, 4, 5.4]) assert(lit(lamps, h).length === lamps.length, `A night lamp is out at ${h}.`);
  assert(new Set(lamps.map((p) => p.place)).size >= 3, 'The night lamps bunch in one place.');
  // Most lit rooms are warm or today's glow; the pale cool white is an accent, not a grey board on every civic front.
  const cool = lit(rooms, 20).filter((p) => Math.round(p.light[1] * 255) === 255).length;
  assert(cool <= 0.15 * lit(rooms, 20).length, `${cool} of the ${lit(rooms, 20).length} rooms lit at 20:00 are cool.`);
  for (const id of ['pengyuan-liu', 'yunlong-liu', 'qin-li'])
    assert(lit(rooms.filter((p) => p.place === id), 23.5).length, `${id}'s home is dark at 23:30.`);
  assert(lit(rooms.filter((p) => p.place === 'research-studio'), 1).length, 'The studio is dark at 01:00.');
  // The archive's three north lights light one roof hall: one light, never three bands of different lamps.
  assert.equal(rooms.filter((p) => p.place === 'city-archive' && p.at.y > 4).length, 1, 'The archive\'s north lights are not one light.');
}
// The archive's dressings (stone courses, window surrounds, rainwater goods, ridge cappings, the
// chimney's crown): its masonry, iron and roof stay inside the old bounds (the ivy, which reaches
// furthest out, is the planting's), so its hit box, framing and chapter camera do not move; it
// stays within its detail budget; each pane keeps the centre its night light is drawn
// from (0.06 out of its wall); and the downpipes run down the rear and north walls only, clear of
// the windows' stone surrounds and the piers, never on the ivy's south wall or the front.
{
  const { shell } = models.get('city-archive'),
    { w, d } = plan.sites['city-archive'],
    toShell = shell.matrixWorld.clone().invert(),
    bounds = new T.Box3(),
    v = new T.Vector3(),
    iron = [];
  let tris = 0,
    count = 0;
  shell.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position,
      m = toShell.clone().multiply(o.matrixWorld),
      kind = o.material.userData.surfaceKind;
    // The ivy (its leaves are foliage, its stems bark) is not the archive's dressing: it has its own
    // budget and checks, and its runners may follow the cornice a little past the wall's end.
    if (kind === 'foliage' || kind === 'bark') return;
    count++;
    tris += (o.geometry.index?.count ?? p.count) / 3;
    for (let i = 0; i < p.count; i++) bounds.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(m));
    // Batched meshes are unindexed: every three positions are a triangle.
    if (kind === 'iron') for (let i = 0; i < p.count; i += 3) iron.push([0, 1, 2].map((j) => new T.Vector3().fromBufferAttribute(p, i + j).applyMatrix4(m)));
  });
  const show = (b) => [b.min, b.max].map((c) => c.toArray().map((n) => n.toFixed(3)).join(' ')).join(' to ');
  // The old bounds: the cornice at -x, the last north light's bars at +x, the gables' overhang
  // behind, the dock in front and the chimney's top.
  assert(bounds.max.x < 3.371 && bounds.min.x > -3.342 && bounds.min.z > -2.821 && bounds.max.z < 3.451 && bounds.max.y < 8.101, `The archive outgrew its old bounds: ${show(bounds)}`);
  assert(tris < 23000 && count <= 10, `The archive costs ${Math.round(tris)} triangles in ${count} meshes.`);
  const own = panes.filter((p) => p.place === 'city-archive').map((p) => p.at.clone().applyMatrix4(toShell));
  assert.equal(own.length, 11, 'The archive has nine windows, a fanlight and one roof light.');
  for (const p of own.filter((q) => q.y < 4)) {
    const out = Math.max(Math.abs(p.x) - w / 2, Math.abs(p.z) - d / 2);
    assert(Math.abs(out - 0.06) < 0.005 && (Math.abs(p.y - 1.75) < 0.005 || (Math.abs(p.y - 2.45) < 0.005 && Math.abs(p.x) < 0.005)), `An archive pane moved (its night light would change) to ${p.toArray().map((n) => n.toFixed(2))}`);
  }
  // The walls in their own frames: u along the wall, `out` from its face, the window middles and the piers' spans.
  const walls = [
    { name: 'front', u: (q) => q.x, out: (q) => q.z - d / 2, windows: [-2.01, 2.01], piers: [[-3.25, -2.75], [-1.275, -0.825], [0.825, 1.275], [2.75, 3.25]], door: 0.9 },
    { name: 'rear', u: (q) => -q.x, out: (q) => -q.z - d / 2, windows: [-2.01, 0, 2.01], piers: [[-3.25, -2.75], [-1.275, -0.825], [0.825, 1.275], [2.75, 3.25]] },
    { name: 'south', u: (q) => -q.z, out: (q) => q.x - w / 2, windows: [-0.95, 0.95], piers: [[-2.55, -2.05], [2.05, 2.55]] },
    { name: 'north', u: (q) => q.z, out: (q) => -q.x - w / 2, windows: [-0.95, 0.95], piers: [[-2.55, -2.05], [2.05, 2.55]] },
  ];
  for (const wall of walls) {
    // Through mid-storey (clear of the pipes' ears and collars) the only iron on a wall is the
    // windows' frames and bars (within 0.53 of a window's middle), the door's hinges and the downpipes.
    const pipe = iron.filter(
      (t) =>
        Math.min(...t.map((q) => q.y)) < 2.2 &&
        Math.max(...t.map((q) => q.y)) > 1.4 &&
        t.every((q) => wall.out(q) > -0.01 && wall.out(q) < 0.25 && !(wall.door && Math.abs(wall.u(q)) < wall.door) && wall.windows.every((c) => Math.abs(wall.u(q) - c) > 0.53)),
    );
    if (wall.name === 'front' || wall.name === 'south') assert.equal(pipe.length, 0, `A downpipe on the archive's ${wall.name} wall.`);
    else assert(pipe.length >= 16, `The archive's ${wall.name} wall has no downpipes.`);
    for (const q of pipe.flat()) {
      const u = wall.u(q);
      assert(wall.windows.every((c) => Math.abs(u - c) >= 0.7), `A ${wall.name} downpipe touches a window surround at u ${u.toFixed(2)}.`);
      assert(wall.piers.every(([a, b]) => u <= a || u >= b), `A ${wall.name} downpipe runs into a pier at u ${u.toFixed(2)}.`);
    }
  }
}
// The gate's triumphal-arch dressings (buildGate): the whole arch stays within x 2.385, z 1.005 and
// y 6.47 (so its hit box, close-up and chapter framing barely move); at the ground (the plinths and
// their breaks under the column pedestals) nothing leaves the island's paved disc (radius 2.4,
// inside the pool's inner coping) except along the east and west causeways, within 21.8 degrees of
// the x axis; the passage stays open (1.69 wide under the imposts, the vault 0.86 or more from the
// springing's middle); it costs at most 28k triangles in 7 meshes (it was 2.9k in 4); its two night
// lamps crown the attic over the columns, mirrored; the bronze wreaths keep clear of the archivolt
// and the columns; and the only bronze on the attic's faces is the blank tablet.
{
  const { shell } = models.get('lius-gate'),
    toShell = shell.matrixWorld.clone().invert(),
    v = new T.Vector3(),
    bounds = new T.Box3(),
    brass = [];
  let tris = 0,
    count = 0;
  shell.traverse((o) => {
    if (!o.isMesh) return;
    count++;
    const p = o.geometry.attributes.position,
      m = toShell.clone().multiply(o.matrixWorld),
      kind = o.material.userData.surfaceKind;
    tris += (o.geometry.index?.count ?? p.count) / 3;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      bounds.expandByPoint(v);
      if (kind === 'brass') brass.push(v.clone());
      if (v.y < 0.46 && Math.hypot(v.x, v.z) > 2.4)
        assert(Math.abs(v.z) < Math.abs(v.x) * Math.tan((21.8 * Math.PI) / 180), `The gate's footing leaves the causeway at ${v.x.toFixed(2)}, ${v.z.toFixed(2)}.`);
      if (Math.abs(v.z) < 1.01) {
        assert(v.y > 2.45 || Math.abs(v.x) >= 0.845, `The gate's passage narrows at ${v.x.toFixed(3)}, ${v.y.toFixed(2)}.`);
        assert(v.y <= 2.45 || Math.hypot(v.x, v.y - 2.45) >= 0.86, `Something hangs in the gate's arch at ${v.x.toFixed(2)}, ${v.y.toFixed(2)}.`);
      }
    }
  });
  const show = (b) => [b.min, b.max].map((c) => c.toArray().map((n) => n.toFixed(3)).join(' ')).join(' to ');
  assert(bounds.max.x < 2.385 && bounds.min.x > -2.385 && bounds.max.z < 1.005 && bounds.min.z > -1.005 && bounds.min.y > -0.001 && bounds.max.y < 6.47, `The gate outgrew its frame: ${show(bounds)}`);
  assert(bounds.max.y > 6.3 && bounds.max.x > 2.3, `The gate lost its crown or its cornice: ${show(bounds)}`);
  assert(tris <= 28000 && count <= 7, `The gate costs ${Math.round(tris)} triangles in ${count} meshes.`);
  const own = lamps.filter((l) => { let o = l; while (o && o !== shell) o = o.parent; return o === shell; }).map((l) => l.getWorldPosition(new T.Vector3()).applyMatrix4(toShell));
  assert.equal(own.length, 2, 'The gate keeps its two night lamps.');
  own.sort((a, b) => a.x - b.x);
  assert(Math.abs(own[0].x + own[1].x) < 1e-6 && Math.abs(own[0].y - own[1].y) < 1e-6 && own.every((q) => q.y > 5.9 && Math.abs(q.z) < 1e-6 && Math.abs(Math.abs(q.x) - 1.84) < 1e-6), `The gate's lamps moved: ${own.map((q) => q.toArray().map((n) => n.toFixed(2)))}`);
  // Spandrel bronze (the wreaths and bosses on the faces between the impost and the architrave).
  const spandrels = brass.filter((q) => Math.abs(q.z) > 0.75 && q.y > 3.2 && q.y < 3.95);
  assert(spandrels.length > 500, `Only ${spandrels.length} wreath vertices in the gate's spandrels.`);
  for (const q of spandrels) assert(Math.hypot(q.x, q.y - 2.45) > 1.5 && Math.abs(q.x) < 1.65, `A spandrel wreath crowds the archivolt or a column at ${q.x.toFixed(2)}, ${q.y.toFixed(2)}.`);
  for (const q of brass.filter((p) => Math.abs(p.z) > 0.7 && p.y > 4.7 && p.y < 5.24))
    assert(Math.abs(q.x) <= 1.09 && Math.abs(q.y - 4.97) <= 0.16, `Bronze on the gate's attic off its blank tablet at ${q.x.toFixed(2)}, ${q.y.toFixed(2)}.`);
}
// Always lit: the clock dials (exactly), the lighthouse and the board, the phone box, the control tower's cab and the tram, boat and plane, and dim all night the plane's cockpit; never: the crane cab.
{
  const role = (r) => panes.filter((p) => p.role === r);
  assert.equal(role('dial').length, 4, 'Four clock dials.');
  assert.equal(role('unlit').length, 1, 'One crane cab.');
  assert.equal(role('cockpit').length, 1, 'One cockpit.');
  for (const r of ['beacon', 'kiosk', 'cab', 'vehicle']) assert(role(r).length, `No ${r} panes.`);
  for (let minute = 0; minute < 24 * 60; minute += 15) {
    const clock = at(minute / 60);
    assert(role('dial').every((p) => windowLevel(p.light, clock) === 1), `A clock dial is dark at minute ${minute}.`);
    assert(['beacon', 'kiosk', 'cab', 'vehicle'].every((r) => role(r).every((p) => windowLevel(p.light, clock) > 0.5)), `A lamp that stays lit is dark at minute ${minute}.`);
    assert(role('cockpit').every((p) => windowLevel(p.light, clock) >= 0.2 && windowLevel(p.light, clock) <= 0.35), `The plane's cockpit is not a dim light at minute ${minute}.`);
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
assert(balloon.object.position.x < -25 && balloon.object.position.z > 10, 'The balloon starts out over the west shore, over the sea.');
for (let i = 0; i < 720; i++) {
  balloon.update(i * 0.7, 0);
  const { x, y, z } = balloon.object.position;
  assert(Math.hypot(x, z) > 30, `The balloon drifts over the town at t=${(i * 0.7).toFixed(1)}`);
  assert(y > 11.5, 'The balloon flies above the gulls.');
  for (const site of plan.siteList)
    assert(Math.hypot(x - site.x, z - site.z) > 8, `The balloon drifts over ${site.id}`);
}
// On the opening view (bearing pi/4 swayed by the idle drift's +-0.16, which the balloon turns
// with, and the hero's frame shift of -0.06) the balloon stays whole in the open band at every
// common wide screen size: below the masthead (64 px, 8 px to spare, so never behind the frosted
// nav and tools pills or the wordmark), never behind the hero copy on the left (eyebrow to lede,
// as laid out at that size, 8 px to spare) or the News card on the right, and never out of the
// frame. The card is centred a little above the middle (translateY(-42%)) and its height follows
// the news, so it is taken at its tallest, three items with pictures (400 px), not as it happens
// to be today. Each size is checked again with a classic 15 px scrollbar narrowing the canvas
// (the card then sits 15 px further left).
{
  const { followDrift } = await load('town-movers');
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
  ].flatMap((s) => [s, { ...s, W: s.W - 15, news: s.news.map((x) => x - 15) }]);
  const bounds = new T.Box3(),
    corner = new T.Vector3(),
    rest = new T.Vector3(),
    yaw = Math.PI / 4;
  let restYaw = 0;
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
      rest.copy(balloon.object.position);
      restYaw = balloon.object.rotation.y;
      for (const drift of [-0.16, 0, 0.16]) {
        balloon.object.position.copy(rest);
        balloon.object.rotation.y = restYaw;
        followDrift(balloon.object, shifted, drift);
        balloon.object.updateWorldMatrix(true, true);
        bounds.setFromObject(balloon.object);
        view.position.copy(shifted).add(new T.Vector3(Math.sin(yaw + drift) * 38, 35, Math.cos(yaw + drift) * 38));
        view.lookAt(shifted);
        view.updateMatrixWorld();
        let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
        for (let i = 0; i < 8; i++) {
          corner.set(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z).project(view);
          const x = ((corner.x + 1) / 2) * W, y = ((1 - corner.y) / 2) * H;
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
        assert(top >= 64 + 8, `At t=${t} the balloon rises into the masthead (top ${top.toFixed(0)} px) on the ${W} x ${H} opening view.`);
        assert(left >= 0 && right <= W && bottom <= H, `At t=${t} the balloon leaves the ${W} x ${H} opening view.`);
        for (const [name, [x0, y0, x1, y1]] of Object.entries(boxes))
          assert(right < x0 || left > x1 || bottom < y0 || top > y1, `At t=${t} the balloon drifts behind the ${name} on the ${W} x ${H} opening view.`);
      }
    }
  }
  // Turning with the drift moves it in the world (the frame loop applies it after its update), never into the town.
  balloon.update(0, 0);
  followDrift(balloon.object, new T.Vector3(), 0.16);
  assert(Math.hypot(balloon.object.position.x, balloon.object.position.z) > 30, 'The drift turns the balloon over the town.');
  balloon.update(0, 0);
}
// The balloon's detailing (hotAirBalloon: gores, load tapes, crown ring, skirt, burner frame,
// basket) keeps the size the opening-view checks above were made for: within 1.6 of its axis and
// between the basket's foot (-0.05) and the crown (5.06); the burner and its frame hang between
// the basket's rim and the envelope's mouth, inside the skirt's reach; all of it is no-shadow
// cloth and cane in at most 2 batched meshes and 7k triangles.
{
  const b = balloon.object,
    keep = [b.position.clone(), b.rotation.clone()],
    p = new T.Vector3();
  b.position.set(0, 0, 0);
  b.rotation.set(0, 0, 0);
  b.updateMatrixWorld(true);
  let tris = 0,
    count = 0;
  for (const o of b.children) {
    if (!o.isMesh) continue;
    count++;
    assert(!o.castShadow, 'Part of the balloon casts a shadow.');
    const pos = o.geometry.getAttribute('position');
    tris += (o.geometry.index?.count ?? pos.count) / 3;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      assert(Math.hypot(p.x, p.z) <= 1.6 + 1e-4 && p.y >= -0.05 - 1e-4 && p.y <= 5.06 + 1e-4, `The balloon grows past its old size at ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}.`);
      // Between the basket's rim (0.52) and the mouth (1.01) only the burner, its frame and rods,
      // the flying wires and the skirt: nothing out past the skirt's hem (0.42).
      if (p.y > 0.52 && p.y < 0.95) assert(Math.hypot(p.x, p.z) <= 0.43, `Something hangs out between the basket and the mouth at ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}.`);
    }
  }
  assert(count <= 2 && tris <= 7000, `The balloon costs ${Math.round(tris)} triangles in ${count} meshes.`);
  b.position.copy(keep[0]);
  b.rotation.copy(keep[1]);
  b.updateMatrixWorld(true);
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
// The people are batched part by part, 8 meshes each: the body's cloth (coat, collar, hair or hat,
// any satchel) and its skin (head and face), and each thigh, shin and arm, their colours on the
// vertices (each limb one mesh, its shoe or mitten matte like it). The dog walker is one more of them; the dog is four meshes (its body, the only
// part that casts, its legs, its head and its tail) and keeps its pivots apart from its body.
{
  const meshesIn = (o) => {
    let n = 0;
    o.traverse((c) => (n += c.isMesh ? 1 : 0));
    return n;
  };
  for (const w of walkers) assert.equal(meshesIn(w.root), 8, `A walker is ${meshesIn(w.root)} meshes`);
  const dogWalk = model.animated.find((e) => e.object.name === 'dog-walk');
  assert(dogWalk && dogWalk.object.userData.prebatched, 'The dog walk is batched with the people.');
  const [figure, dog] = dogWalk.object.children;
  assert.equal(dog.name, 'dog');
  assert.equal(meshesIn(figure), 8, `The dog walker is ${meshesIn(figure)} meshes`);
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
  // Five in the rig (the bike's paint, the lamp, the coat, the arms with the bike's small cloth parts, and the head,
  // whose neck makes it tall enough to cast) and one for each thigh and shin.
  assert.equal(meshesIn(cyclist.object), 9, `The cyclist is ${meshesIn(cyclist.object)} meshes`);
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
// The traffic signals as built: the poles, heads, visors and boards batched into the land, so the
// group keeps only the 18 lenses, three a head (red over amber over green, facing its traffic),
// each its own plain standard material, the lanterns' program. Over a cycle each head lights
// exactly its aspect's lenses, by emissive intensity alone: no material ever needs a recompile.
// Nothing about them answers the pointer.
{
  const entry = model.animated.find((e) => e.object.name === 'traffic-signals');
  assert(entry && entry.object.userData.prebatched, 'The signals are in the animated list, batched with the land.');
  const lenses = [];
  entry.object.traverse((o) => o.isMesh && lenses.push(o));
  assert.equal(lenses.length, 18, `The signals keep ${lenses.length} separate meshes, not their 18 lenses.`);
  assert.equal(new Set(lenses.map((l) => l.material)).size, 18, 'Each lens has its own material.');
  const lantern = lamps[0].material;
  for (const l of lenses) {
    const m = l.material;
    assert(m.type === lantern.type && !m.vertexColors && !m.map && !m.transparent && m.onBeforeCompile === T.Material.prototype.onBeforeCompile, 'A lens has a program of its own.');
    assert.equal(m.customProgramCacheKey(), lantern.customProgramCacheKey(), 'A lens does not share the lanterns’ program.');
    assert(!lamps.includes(l) && !l.castShadow, 'A lens is lit by the lamps’ night loop or casts a shadow.');
  }
  for (let o = entry.object; o; o = o.parent) assert(!o.userData.buildingId && !o.userData.placeId, 'The signals answer the pointer.');
  const versions = lenses.map((l) => l.material.version),
    want = { red: [1, 0, 0], amber: [0, 1, 0], redAmber: [1, 1, 0], green: [0, 0, 1] };
  entry.object.updateMatrixWorld(true);
  signalPosts.forEach((p, i) => {
    const heads = entry.object.children[i].children.filter((c) => c.userData.keepSeparate);
    assert(heads.length === 1 && heads[0].children.length === 3, `The ${p.junction} ${p.approach} signal has no head of three lenses.`);
    const [red, amber, green] = heads[0].children.map((c) => c.getWorldPosition(new T.Vector3()));
    assert(red.y > amber.y && amber.y > green.y, `The ${p.junction} ${p.approach} lenses are not red over amber over green.`);
    assert((amber.x - p.x) * p.facing[0] + (amber.z - p.z) * p.facing[1] > 0.05, `The ${p.junction} ${p.approach} lenses face away from its traffic.`);
    assert(red.y > 1.6 && green.y > 1.1, 'The signal heads hang too low.');
  });
  for (let t = 0; t < SIGNAL.period * 2; t += 0.25) {
    entry.update(t, t > SIGNAL.period ? 1 : 0);
    signalPosts.forEach((p, i) => {
      const lit = entry.object.children[i].children.find((c) => c.userData.keepSeparate).children.map((c) => Number(c.material.emissiveIntensity > 0));
      assert.deepEqual(lit, want[signalState(p.junction, p.approach, t)], `The ${p.junction} ${p.approach} signal shows the wrong lenses at t=${t}.`);
    });
  }
  assert.deepEqual(lenses.map((l) => l.material.version), versions, 'A signal change recompiles a lens.');
  entry.update(0, 0);
  // Each vehicle's nose reaches its front: the tram's lamps at its ends, the bike's front tyre.
  const reach = (o) => {
    const keep = [o.position.clone(), o.rotation.clone()];
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
    o.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(o);
    o.position.copy(keep[0]);
    o.rotation.copy(keep[1]);
    o.updateMatrixWorld(true);
    return box.max.z;
  };
  const tramFront = reach(model.tram),
    bikeFront = reach(model.animated.find((e) => e.object.name === 'cyclist').object);
  assert(Math.abs(TRAM_TIMETABLE.nose - tramFront) < 0.02, `The tram's nose (${TRAM_TIMETABLE.nose}) is not its front (${tramFront.toFixed(3)}).`);
  assert(Math.abs(CYCLIST_TIMETABLE.nose - bikeFront) < 0.02, `The bike's nose (${CYCLIST_TIMETABLE.nose}) is not its front (${bikeFront.toFixed(3)}).`);
}
// The tram (buildTram) stays inside the body the signal clearances sweep (1.2 wide, its nose and
// tail at TRAM_TIMETABLE.nose), above the rail head, and rides on its wheels: its lowest parts are
// the eight wheels' treads, over the rails (x +-0.42) at its two bogies (z +-1.1, axles 0.5 apart).
// Its detailing costs at most 11k triangles in 5 meshes (body, glazing, undergear and two lamps).
{
  const tram = model.tram,
    keep = [tram.position.clone(), tram.rotation.clone()],
    p = new T.Vector3(),
    treads = new Map();
  tram.position.set(0, 0, 0);
  tram.rotation.set(0, 0, 0);
  tram.updateMatrixWorld(true);
  let tris = 0,
    count = 0;
  tram.traverse((o) => {
    if (!o.isMesh) return;
    count++;
    const pos = o.geometry.getAttribute('position');
    tris += (o.geometry.index?.count ?? pos.count) / 3;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      assert(Math.abs(p.x) <= 0.6 + 1e-4 && Math.abs(p.z) <= TRAM_TIMETABLE.nose + 1e-4, `The tram reaches out of its swept body at ${p.x.toFixed(3)}, ${p.z.toFixed(3)}.`);
      assert(p.y >= -1e-4, `The tram dips under the rail head (${p.y.toFixed(3)}).`);
      if (p.y > 0.03) continue;
      const axle = Math.sign(p.z) * 1.1 + (Math.abs(p.z) > 1.1 ? 0.25 : -0.25) * Math.sign(p.z);
      assert(Math.abs(Math.abs(p.x) - 0.42) <= 0.04 && Math.abs(p.z - axle) <= 0.08, `Something but a wheel touches the rails at ${p.x.toFixed(3)}, ${p.z.toFixed(3)}.`);
      treads.set(`${Math.sign(p.x)},${axle.toFixed(2)}`, true);
    }
  });
  assert.equal(treads.size, 8, `The tram stands on ${treads.size} wheels.`);
  assert(tris <= 11000 && count <= 5, `The tram costs ${Math.round(tris)} triangles in ${count} meshes.`);
  tram.position.copy(keep[0]);
  tram.rotation.copy(keep[1]);
  tram.updateMatrixWorld(true);
}
// The harbour boat (buildBoat, BOAT's lines): nothing below its keel or past its stem and transom
// (by more than the cap rail and the rubbing strake's thickness); everything standing on its deck
// (the wheelhouse, casing and funnel, hatch, winch, mast and rigging, boxes and the cap rail) within
// the hull's outer line at the sheer, so nothing pokes out through the bulwarks; its one lamp the
// mast lantern, over everything; and at most 9k triangles in 6 batched meshes.
{
  const { createMovers, BOAT, boatBreadth } = await load('town-movers'),
    { createKit } = await load('town-kit'),
    { createCityMaterials } = await load('city-materials'),
    library = createCityMaterials(),
    ctx = { library, material: library.material, season: 'summer', land: new T.Group(), lamps: [], clocks: [], animated: [] },
    boat = createMovers(ctx, createKit(ctx)).buildBoat(),
    p = new T.Vector3();
  boat.updateMatrixWorld(true);
  assert.equal(ctx.lamps.length, 1, 'The boat has one lamp.');
  const lantern = ctx.lamps[0].getWorldPosition(new T.Vector3());
  boat.traverse((o) => {
    if (!o.isMesh || ctx.lamps.includes(o)) return;
    const pos = o.geometry.getAttribute('position'),
      points = [];
    for (let i = 0; i < pos.count; i++) points.push(p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).clone());
    const onDeck = Math.min(...points.map((q) => q.y)) >= BOAT.deck - 0.01;
    for (const q of points) {
      assert(q.y >= BOAT.keel - 1e-4 && q.z >= BOAT.stern - 0.05 && q.z <= BOAT.bow + 0.05, `The boat reaches out of its hull's ends at ${q.x.toFixed(2)}, ${q.y.toFixed(2)}, ${q.z.toFixed(2)}.`);
      assert(q.y < lantern.y, 'Something on the boat stands over its mast lantern.');
      if (onDeck) assert(Math.abs(q.x) <= boatBreadth(q.z) * 1.05 + 0.05, `Something on the boat's deck pokes out through its bulwarks at ${q.x.toFixed(2)}, ${q.y.toFixed(2)}, ${q.z.toFixed(2)}.`);
    }
  });
  let tris = 0,
    count = 0;
  model.boat.traverse((o) => {
    if (!o.isMesh) return;
    count++;
    tris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
  });
  assert(tris <= 9000 && count <= 6, `The boat costs ${Math.round(tris)} triangles in ${count} meshes.`);
}
// The plane (buildPlane, plan.PLANE's measures), built alone: inside its measures (the span, the
// length, the fin's top), standing on its six tyres (the only parts within 0.02 of the ground, at
// its nose and main gear), 0.66 across at its forward door, at most 7k triangles. It lights no lamp
// of the town's: its three navigation lights stay out of the batch (plane-lights), red at the port
// wingtip, green at the starboard one and white at the tail, each its own plain material on the
// lanterns' program at the traffic signals' steady glow, casting nothing.
{
  const { createMovers, PLANE_LIGHT, planeSection, DOOR_LIGHT } = await load('town-movers'),
    { createKit } = await load('town-kit'),
    { createCityMaterials } = await load('city-materials'),
    library = createCityMaterials(),
    ctx = { library, material: library.material, season: 'summer', land: new T.Group(), lamps: [], clocks: [], animated: [] },
    kit = createKit(ctx),
    plane = createMovers(ctx, kit).buildPlane(),
    P = plan.PLANE,
    lights = plane.getObjectByName('plane-lights'),
    gear = [...[-1, 1].map((s) => [s * 0.075, P.nose]), ...[-1, 1].flatMap((s) => [-1, 1].map((w) => [(s * P.track) / 2 + w * 0.085, P.main]))],
    tyres = new Set(),
    p = new T.Vector3();
  plane.updateMatrixWorld(true);
  assert.equal(ctx.lamps.length, 0, 'The plane lights a lamp of the town\'s.');
  let tris = 0,
    width = 0;
  plane.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    tris += (o.geometry.index?.count ?? pos.count) / 3;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      assert(Math.abs(p.x) <= P.span / 2 + 0.07 && p.z <= P.length / 2 + 1e-6 && p.z >= -P.length / 2 - 0.08 && p.y >= -1e-6 && p.y <= P.fin + 1e-6, `The plane reaches out of its measures at ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}.`);
      if (p.y < 0.02) {
        const k = gear.findIndex(([x, z]) => Math.abs(p.x - x) < 0.05 && Math.abs(p.z - z) < 0.12);
        assert(k >= 0, `Something but a tyre touches the ground under the plane at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}.`);
        tyres.add(k);
      }
      if (o.parent !== lights && Math.abs(p.z - P.door) < 0.08 && Math.abs(p.y - P.axis) < 0.05) width = Math.max(width, Math.abs(p.x));
    }
  });
  assert.equal(tyres.size, 6, `The plane stands on ${tyres.size} tyres.`);
  assert(width >= P.radius - 1e-3 && width <= P.radius + 0.013, `The plane's fuselage is ${(2 * width).toFixed(3)} across at its door.`);
  assert(tris <= 7000, `The plane costs ${Math.round(tris)} triangles.`);
  // The forward doors' small lights: nothing of a door panel pokes through one (a facet's corner of
  // the panel under the light showed as a small diamond in it). A ray from the fuselage's axis out
  // through any corner or face middle of the parts round the door meets the light's glass (when it
  // meets it at all) farther out.
  {
    const glassMesh = plane.children.find((o) => o.isMesh && o.material.userData.surfaceKind === 'glass'),
      corners = (mesh, i) => [0, 1, 2].map((k) => new T.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i + k).applyMatrix4(mesh.matrixWorld)),
      lightsGlass = [],
      ray = new T.Ray(),
      hit = new T.Vector3();
    for (let i = 0; i < glassMesh.geometry.attributes.position.count; i += 3) {
      const tri = corners(glassMesh, i);
      if (tri.every((q) => Math.abs(q.z - P.door) <= Math.max(...DOOR_LIGHT.z.map(Math.abs)) + 0.01)) lightsGlass.push(tri);
    }
    let met = 0;
    plane.traverse((o) => {
      if (!o.isMesh || o === glassMesh || o.parent === lights) return;
      for (let i = 0; i + 2 < o.geometry.attributes.position.count; i += 3) {
        const tri = corners(o, i);
        if (!tri.every((q) => Math.abs(q.z - P.door) < 0.12)) continue;
        for (const q of [...tri, tri[0].clone().add(tri[1]).add(tri[2]).divideScalar(3)]) {
          const axis = new T.Vector3(0, planeSection(q.z).y, q.z),
            reach = q.distanceTo(axis);
          ray.set(axis, q.clone().sub(axis).normalize());
          for (const [a, b, c] of lightsGlass)
            if (ray.intersectTriangle(a, b, c, false, hit)) {
              met++;
              assert(hit.distanceTo(axis) > reach + 1e-4, `A door panel pokes through its light at ${q.toArray().map((n) => n.toFixed(3)).join(', ')}.`);
            }
        }
      }
    });
    assert(lightsGlass.length === 4 && met > 0, `The doors' lights are ${lightsGlass.length} triangles over ${met} points of the panels.`);
  }
  const lens = lights?.children ?? [],
    lantern = kit.lampGlass();
  assert(lights?.userData.keepSeparate && lens.length === 3 && new Set(lens.map((l) => l.material)).size === 3, 'The plane\'s three navigation lights are not apart, each in its own material.');
  for (const l of lens) {
    const m = l.material;
    assert(m.type === lantern.type && !m.vertexColors && !m.map && !m.transparent && m.onBeforeCompile === T.Material.prototype.onBeforeCompile && m.customProgramCacheKey() === lantern.customProgramCacheKey(), 'A navigation light has a program of its own.');
    assert(m.emissiveIntensity === PLANE_LIGHT && PLANE_LIGHT <= 0.95 && !l.castShadow, 'A navigation light glows harder than the signals, or casts.');
  }
  const lit = (test) => lens.filter((l) => test(l.material.emissive, l.position));
  assert(
    lit((c, at) => c.r > 2 * c.g && c.r > 2 * c.b && at.x > P.span / 2 - 0.05).length === 1 &&
      lit((c, at) => c.g > 2 * c.r && at.x < -P.span / 2 + 0.05).length === 1 &&
      lit((c, at) => Math.min(c.r, c.g, c.b) > 0.6 && at.z < -P.length / 2 + 0.05 && Math.abs(at.x) < 1e-6).length === 1,
    'The plane\'s lights are not red to port, green to starboard and white at the tail.',
  );
  library.dispose();
}
// The plane as the town has it, parked on its stand (plan.STAND, nose east) on the airside's slabs:
// batched into its enamel and its glass beside its three lights, the glass one mesh of two panes:
// the cabin's band and the doors' lights a 'vehicle' pane lit all night, and the cockpit's glazing,
// ahead of them round the nose, on its own dim 'cockpit' light, lit all night at under half the
// cabin's level (lit as the cabin is, the windscreen's wrap made the nose a pale headlight);
// not following the idle drift, nor answering the pointer (a ray down on it finds the airport's
// deck). Its forward door is at the jet bridge's cab and its port side 0.15-0.25 short of the
// bridge's bellows (it docks); nothing of it reaches under or into the bridge, and its port wing and
// engine keep 0.3 west of it. It stands on the apron, 0.3 in from the deck's edge, and keeps 0.3
// from the hall's walls and the hangar.
{
  const plane = model.plane,
    P = plan.PLANE,
    S = plan.STAND,
    J = plan.JET_BRIDGE,
    AP = plan.APRON,
    TW = plan.TAXIWAY,
    bridgeWest = J.cab - 0.34,
    { shell: hall } = models.get('airport'),
    p = new T.Vector3();
  assert(plane.position.x === S.x && plane.position.z === S.z && plane.position.y === plan.AIRSIDE && plane.rotation.y === S.heading, 'The plane is off its stand.');
  assert(Math.abs(S.x + P.door - J.cab) < 0.005, 'The plane\'s forward door is off the jet bridge\'s cab.');
  const meshes = [];
  plane.traverse((o) => o.isMesh && meshes.push(o));
  const kinds = meshes.map((o) => `${o.material.userData.surfaceKind ?? o.material.name}${o.castShadow ? '' : '(n)'}`).sort();
  assert.deepEqual(kinds, ['enamel', 'glass(n)', 'nav-light(n)', 'nav-light(n)', 'nav-light(n)'], `The plane batches into ${kinds.join(', ')}.`);
  const panes = model.windows.filter((w) => w.place === 'plane'),
    cabin = panes.find((w) => w.role === 'vehicle'),
    cockpit = panes.find((w) => w.role === 'cockpit');
  assert(panes.length === 2 && cabin && cockpit, `The plane's glass is not its cabin's pane and its cockpit's (${panes.map((w) => w.role).join(', ')}).`);
  assert(cabin.light[0] > 0.8 && cockpit.light[0] >= 0.2 && cockpit.light[0] <= 0.4 * cabin.light[0] && [cabin, cockpit].every((w) => w.light[2] === 1 && w.light[3] === 1), `The plane's cabin (${cabin.light[0].toFixed(2)}) is not lit all night, or its cockpit (${cockpit.light[0].toFixed(2)}) is not a dim light under half the cabin's.`);
  {
    // In the one glass mesh, the cockpit's light is on the glazing round the nose (ahead of the
    // cabin's band and the doors' lights) and nowhere else.
    const { PLANE_GLAZING: G } = await load('town-movers'),
      glass = meshes.filter((o) => o.material.userData.surfaceKind === 'glass'),
      byte = (v) => Math.round(v * 255),
      seen = { cabin: 0, cockpit: 0 };
    assert.equal(glass.length, 1, 'The plane\'s glass is not one mesh.');
    const pos = glass[0].geometry.attributes.position,
      light = glass[0].geometry.attributes.aWindow;
    for (let i = 0; i < pos.count; i++) {
      const level = Math.round(light.getX(i) * 255),
        z = pos.getZ(i);
      if (level === byte(cockpit.light[0])) {
        seen.cockpit++;
        assert(z > G.cockpit[0] - 1e-3, `The cockpit's dim light reaches back to ${z.toFixed(2)}, off its glazing.`);
      } else {
        assert.equal(level, byte(cabin.light[0]), 'A pane of the plane\'s glass is neither its cabin\'s nor its cockpit\'s.');
        seen.cabin++;
        assert(z < G.cockpit[0] - 1e-3, `The cabin's light reaches the cockpit's glazing at ${z.toFixed(2)}.`);
      }
    }
    assert(seen.cabin > 100 && seen.cockpit > 50, `The plane's glass has ${seen.cabin} cabin and ${seen.cockpit} cockpit vertices.`);
  }
  assert(!plane.userData.followsDrift && !model.animated.some((e) => e.object === plane), 'The plane follows the drift or the animated list.');
  for (let o = plane; o; o = o.parent) assert(!o.userData.buildingId && !o.userData.placeId, 'The plane answers the pointer.');
  ray.set(new T.Vector3(S.x, 40, S.z), new T.Vector3(0, -1, 0));
  assert.equal(pickTarget(ray, models, model.parkHit), 'airport', 'Pointing at the parked plane finds no airport.');
  let side = Infinity,
    nose = -Infinity,
    tail = Infinity,
    hallWest = Infinity;
  for (const o of meshes) {
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      nose = Math.max(nose, p.x);
      tail = Math.min(tail, p.x);
      if (Math.abs(p.x - J.cab) < 0.31 && p.y > J.floor && p.y < J.floor + 0.6) side = Math.min(side, p.z);
      if (p.x >= bridgeWest - 0.3) assert(p.z >= J.bellows + 0.15, `The plane reaches under the jet bridge at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}.`);
      assert(plan.onAirport(p.x, p.z, -0.3), `The plane leaves the deck at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}.`);
      if (p.y < plan.AIRSIDE + 0.25) assert(p.x > AP.x0 && p.x < AP.x1 && p.z > TW.z + TW.width / 2 && p.z < AP.z1, `The plane's footprint leaves the apron at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}.`);
    }
  }
  assert(side - J.bellows >= 0.15 && side - J.bellows <= 0.25, `The plane's port side lies ${(side - J.bellows).toFixed(3)} from the jet bridge's bellows.`);
  hall.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (p.x > plan.AIRPORT_ROAD.x - 2.1 - 0.2) hallWest = Math.min(hallWest, p.x);
    }
  });
  assert(nose <= hallWest - 0.3 && tail >= plan.HANGAR.x1 + 0.3, `The plane (x ${tail.toFixed(2)} to ${nose.toFixed(2)}) crowds the hall (${hallWest.toFixed(2)}) or the hangar.`);
}
// The plane's loop (plan.planePose): 180 s, three of the tram's laps, a pure function of time like
// the tram's timetable. Copied from the tram's and the cyclist's checks: periodic and the same far
// into the day; its phases in order on their times; frame by frame at 60 fps never a jump while it
// shows, never rolling back on a leg (pushback only ever back, everything else nose first), easing
// its speed no harder than 0.75 v² / ramp, turning at most 1.2° a frame and banking at most 0.12.
{
  const P = plan.PLANE_LOOP,
    T0 = plan.PLANE_TIMES,
    dt = 1 / 60,
    wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a)),
    deg = Math.PI / 180;
  assert.equal(P, 3 * LAP, 'The plane\'s loop is not three of the tram\'s laps.');
  assert.equal(P, 180, 'The plane\'s loop is not 180 s.');
  const parked = plan.planePose(10);
  assert(parked.phase === 'parked' && parked.x === plan.STAND.x && parked.z === plan.STAND.z && parked.y === plan.AIRSIDE && parked.heading === plan.STAND.heading && parked.y < 11 && parked.visible, 'At t=10 the plane is not parked on its stand (low, as the balloon\'s search needs).');
  for (const t of [0, P - 1e-6]) assert.deepEqual(plan.planePose(t), parked, `The plane is not parked at t=${t}.`);
  const order = ['parked', 'pushback', 'taxi', 'turn', 'take-off', 'climb', 'away', 'approach', 'roll-out', 'taxi-in', 'parked'],
    phases = [];
  let last = plan.planePose(0),
    travel = plan.planeTravel(0),
    speedBefore = 0,
    farthest = 0;
  for (let f = 1; f <= P * 60; f++) {
    const t = f * dt,
      p = plan.planePose(t),
      q = plan.planePose(t + P);
    if (phases.at(-1)?.phase !== p.phase) phases.push({ phase: p.phase, t });
    assert(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 1e-7 && Math.abs(wrap(p.heading - q.heading)) < 1e-7 && p.visible === q.visible, `The plane's loop from t=${t.toFixed(2)} differs from the next.`);
    assert([p.x, p.y, p.z, p.heading, p.pitch, p.bank].every(Number.isFinite), `The plane's pose is not finite at t=${t.toFixed(2)}.`);
    assert(Math.abs(p.bank) <= 0.12 + 1e-9 && (!p.ground || p.bank === 0), `The plane banks ${p.bank.toFixed(3)} at t=${t.toFixed(2)}.`);
    assert(p.pitch >= -1e-9 && p.pitch <= 0.15, `The plane pitches ${p.pitch.toFixed(3)} at t=${t.toFixed(2)}.`);
    assert(!p.ground || Math.abs(p.y - plan.AIRSIDE - plan.PLANE.main * -Math.sin(p.pitch)) < 1e-9, `The plane's wheels leave the airside at t=${t.toFixed(2)} without flying.`);
    if (p.visible && last.visible) {
      const step = Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z),
        turn = Math.abs(wrap(p.heading - last.heading));
      assert(step <= 6.2 * dt, `The plane jumps ${step.toFixed(3)} at t=${t.toFixed(2)}.`);
      assert(turn <= 1.2 * deg, `The plane turns ${(turn / deg).toFixed(2)}° in one frame at t=${t.toFixed(2)}.`);
      // Nose first, or (pushed back) tail first; sideways only as it pivots about its main gear (its
      // middle swinging round on a circle 0.38 across, a few thousandths a frame off its heading).
      const along = ((p.x - last.x) * Math.sin(last.heading) + (p.z - last.z) * Math.cos(last.heading)) / dt;
      if (p.phase === 'pushback') assert(along <= 0.01, `The plane rolls forward on pushback at t=${t.toFixed(2)}.`);
      else assert(along >= -0.01, `The plane rolls back at t=${t.toFixed(2)} (${p.phase}).`);
    }
    if (!p.visible) farthest = Math.max(farthest, Math.hypot(p.x, p.z));
    // Each leg's distance only grows, eased no harder than 0.75 v² over its ramp's distance.
    const now = plan.planeTravel(t);
    if (now.leg && now.leg === travel.leg) {
      const speed = (now.d - travel.d) / dt;
      assert(speed >= -1e-9, `The plane's ${now.leg} runs backwards at t=${t.toFixed(2)}.`);
      const knots = plan.PLANE_LEGS[now.leg],
        k = knots.findIndex(([at], i) => i + 1 < knots.length && t <= knots[i + 1][0] && t >= at);
      if (k >= 0 && f > 1 && Math.abs(t - knots[k][0]) > dt && Math.abs(t - knots[k + 1][0]) > dt) {
        const [[t0, v0], [t1, v1]] = [knots[k], knots[k + 1]],
          ramp = ((v0 + v1) / 2) * (t1 - t0),
          most = ramp > 0 ? (0.75 * Math.max(v0, v1) ** 2) / ramp : 0;
        assert(Math.abs(speed - speedBefore) / dt <= most * 1.02 + 1e-6, `The plane's speed changes by ${(Math.abs(speed - speedBefore) / dt).toFixed(2)} a second² at t=${t.toFixed(2)} (most ${most.toFixed(2)}).`);
      }
      speedBefore = speed;
    } else speedBefore = now.speed;
    last = p;
    travel = now;
  }
  assert.deepEqual(phases.map((s) => s.phase), order, `The plane's loop runs ${phases.map((s) => s.phase).join(', ')}.`);
  for (const [phase, at] of [['pushback', T0.pushback[0]], ['taxi', T0.taxi[0]], ['turn', T0.turn[0]], ['take-off', T0.roll[0]], ['away', T0.lost], ['approach', T0.approach], ['roll-out', T0.touchdown], ['taxi-in', T0.rollOut]])
    assert(Math.abs(phases.find((s) => s.phase === phase).t - at) <= dt + 1e-9, `The plane's ${phase} starts at ${phases.find((s) => s.phase === phase).t.toFixed(2)} s, not ${at} s.`);
  // It lifts off rotating near x -7, and touches down near x 3 on 27, its threshold the east end.
  const lift = phases.find((s) => s.phase === 'climb').t,
    down = phases.find((s) => s.phase === 'roll-out').t;
  assert(Math.abs(plan.planePose(lift).x + 8) < 1.5 && Math.abs(plan.planePose(down).x - 2.5) < 1, `The plane lifts off at x ${plan.planePose(lift).x.toFixed(2)} and touches down at x ${plan.planePose(down).x.toFixed(2)}.`);
  assert(farthest >= 150 && Math.hypot(plan.planePose(T0.lost - dt).x, plan.planePose(T0.lost - dt).z) >= 150 && Math.hypot(plan.planePose(T0.approach).x, plan.planePose(T0.approach).z) >= 150, 'The plane goes out of sight less than 150 from the island.');
  for (const t of [86400 * 7 + 13.37, 3e6 + 41.2]) {
    const a = plan.planePose(t),
      b = plan.planePose(t % P);
    assert(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-4 && Math.abs(wrap(a.heading - b.heading)) < 1e-4, `The plane drifts after ${t} s.`);
  }
}
// Where the plane goes. Its routes keep its main gear on the airside's slabs (the runway, the
// taxiway and its stubs, the apron); on the ground the whole of it stays 0.3 inside the deck's edge,
// 0.3 from the hall, the tower and the hangar and 0.15 from the jet bridge (its docking gap) and
// never under it, and near the deck, on the ground or in the air, 0.3 from the windsock however it
// sways. It never crosses the main island (it keeps 12 off its coast), and keeps well clear of the
// balloon's lap (turned either way with the idle drift), the gulls, the lighthouse beam's sweep and
// the boat. It goes out of sight only beyond 150, outside the opening view at every common size and
// drift, and outside the City overview and the airport's chapter even zoomed out to 0.45 at any of
// the four Rotate stops, or else lost in the fog. (check-navigation holds it out of every standard
// frame, phones' and tablets' too, with the scene's own framings.)
{
  const { WINDSOCK_SWAY } = await load('town-airport'),
    { createGulls } = await load('city-atmosphere'),
    RW = plan.RUNWAY,
    TW = plan.TAXIWAY,
    AP = plan.APRON,
    H = plan.HANGAR,
    slabs = [
      [RW.x0, RW.x1, RW.z - RW.width / 2, RW.z + RW.width / 2],
      [TW.x0 - TW.width / 2, TW.x1 + TW.width / 2, TW.z - TW.width / 2, TW.z + TW.width / 2],
      ...TW.stubs.map((x) => [x - TW.width / 2, x + TW.width / 2, RW.z + RW.width / 2, TW.z - TW.width / 2]),
      [AP.x0, AP.x1, TW.z + TW.width / 2, AP.z1],
    ],
    onSlabs = (x, z) => slabs.some(([x0, x1, z0, z1]) => x >= x0 - 1e-9 && x <= x1 + 1e-9 && z >= z0 - 1e-9 && z <= z1 + 1e-9);
  for (const [name, route, from, to] of [['taxi out', plan.PLANE_PATHS.taxiOut, 0, plan.PLANE_PATHS.pivot], ['way in', plan.PLANE_PATHS.comeIn, plan.PLANE_PATHS.touchdown, plan.PLANE_PATHS.stand]])
    for (let d = from; d <= to; d += 0.05) {
      const [x, z] = route.at(d);
      assert(onSlabs(x, z), `The plane's ${name} runs off the airside at ${x.toFixed(2)}, ${z.toFixed(2)}.`);
    }
  assert(onSlabs(plan.PLANE_ROUTE.pivot, plan.PLANE_ROUTE.track) && onSlabs(plan.PLANE_ROUTE.pivot + plan.PLANE.nose - plan.PLANE.main + 0.1, plan.PLANE_ROUTE.track), 'The plane turns onto 27 with a wheel off the runway.');
  // The plane's points, in its own frame; its pose's matrix, as posePlane sets it.
  const plane = model.plane,
    local = [],
    seen = new Set(),
    v = new T.Vector3(),
    inverse = plane.matrixWorld.clone().invert();
  plane.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position,
      m = inverse.clone().multiply(o.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      const key = `${Math.round(v.x / 0.05)},${Math.round(v.y / 0.05)},${Math.round(v.z / 0.05)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      local.push(v.clone());
    }
  });
  const matrix = (p) => new T.Matrix4().makeRotationFromEuler(new T.Euler(-p.pitch, p.heading, p.bank, 'YXZ')).setPosition(p.x, p.y, p.z);
  // The hall itself (from its west wall: the hall, the link block and the tower) and the jet bridge
  // as plan outlines (convex hulls) of their parts under 2.2; the hangar as its plan.
  const hallVertices = [],
    bridgeVertices = [];
  let hallWest = Infinity;
  models.get('airport').shell.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.x > plan.AIRPORT_ROAD.x - 2.3) hallWest = Math.min(hallWest, v.x);
    }
  });
  models.get('airport').shell.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.y < 2.2) (v.x >= hallWest - 1e-6 ? hallVertices : bridgeVertices).push([v.x, v.z]);
    }
  });
  const hull = (points) => {
    const s = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]),
      half = (list) => {
        const out = [];
        for (const p of list) {
          while (out.length >= 2 && cross(out.at(-2), out.at(-1), p) <= 0) out.pop();
          out.push(p);
        }
        return out;
      },
      lower = half(s),
      upper = half(s.reverse());
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
  };
  // Signed distance from a convex outline (counter-clockwise from hull()): negative inside.
  const outside = (outline, x, z) => {
    let inside = true,
      best = Infinity;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i],
        b = outline[(i + 1) % outline.length];
      if ((b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) inside = false;
      best = Math.min(best, plan.distanceToSegment([x, z], a, b));
    }
    return inside ? -best : best;
  };
  // The apron's kit as its plans (check-town holds the kit inside them): the baggage train's and the
  // three cones' together.
  const K = plan.APRON_KIT,
    plot = (x0, x1, z0, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].reverse(),
    coneXs = K.cones.at.map(([x]) => x),
    coneZs = K.cones.at.map(([, z]) => z);
  const obstacles = [
    { name: 'hall', outline: hull(hallVertices), gap: 0.3 },
    { name: 'jet bridge', outline: hull(bridgeVertices), gap: 0.15 },
    { name: 'hangar', outline: [[H.x0, H.z0], [H.x1, H.z0], [H.x1, H.z1], [H.x0, H.z1]].reverse(), gap: 0.3 },
    { name: 'baggage train', outline: plot(K.train.x0, K.train.x1, K.train.z - K.train.width / 2, K.train.z + K.train.width / 2), gap: 0.3 },
    { name: 'cones', outline: plot(Math.min(...coneXs) - K.cones.base / 2, Math.max(...coneXs) + K.cones.base / 2, Math.min(...coneZs) - K.cones.base / 2, Math.max(...coneZs) + K.cones.base / 2), gap: 0.3 },
  ].map((o) => {
    const xs = o.outline.map(([x]) => x),
      zs = o.outline.map(([, z]) => z);
    return { ...o, box: [Math.min(...xs) - o.gap, Math.max(...xs) + o.gap, Math.min(...zs) - o.gap, Math.max(...zs) + o.gap] };
  });
  assert(outside(obstacles[0].outline, plan.AIRPORT_ROAD.x, -47.5) < 0 && outside(obstacles[1].outline, plan.JET_BRIDGE.cab, plan.JET_BRIDGE.z) < 0, 'The plane\'s obstacles are not where the hall and the jet bridge stand.');
  // The windsock as the frame loop swings it: its mast, and its sock at twelve moments of the sway as
  // a capsule round its axis, as wide as its mouth (its points all within it).
  const sockEntry = model.animated.find((e) => e.object.name === 'windsock-sock'),
    windsock = model.airportLand.getObjectByName('airport-windsock'),
    W = plan.WINDSOCK,
    socks = [],
    S = WINDSOCK_SWAY;
  assert(sockEntry && windsock, 'The windsock\'s sock is not in the animated list.');
  for (let k = 0; k < 12; k++) {
    sockEntry.update(k * 1.3, 0, 0);
    windsock.updateMatrixWorld(true);
    const from = new T.Vector3().setFromMatrixPosition(sockEntry.object.matrixWorld),
      to = new T.Vector3(0, 0.7, 0).applyMatrix4(sockEntry.object.matrixWorld),
      axis = new T.Line3(from, to),
      near = new T.Vector3();
    sockEntry.object.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position,
        q = new T.Vector3();
      for (let i = 0; i < pos.count; i++) {
        q.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        axis.closestPointToPoint(q, true, near);
        assert(near.distanceTo(q) <= S.mouth + 0.04, 'The windsock\'s sock reaches out of its capsule.');
      }
    });
    socks.push(axis);
  }
  sockEntry.update(0, 0, 0);
  const mastTop = plan.AIRPORT.deck + S.mast + 0.08,
    closest = new T.Vector3(),
    // The deck is convex, so the plane's points farthest out over its edge are corners of its plan.
    rim = hull(local.map((q) => [q.x, q.z])).map(([x, z]) => new T.Vector3(x, 0, z)),
    reach = Math.max(...local.map((q) => Math.hypot(q.x, q.z)));
  const worst = { deck: Infinity, windsock: Infinity, ...Object.fromEntries(obstacles.map((o) => [o.name, Infinity])) },
    world = new T.Vector3();
  for (let f = 0; f < plan.PLANE_LOOP * 60; f++) {
    const t = f / 60,
      p = plan.planePose(t);
    if (!p.visible || (!p.ground && (p.y > plan.AIRSIDE + 4 || plan.airportDistance(p.x, p.z) > 6)) || (p.phase === 'parked' && f)) continue;
    const m = matrix(p);
    if (p.ground)
      for (const q of rim) {
        const inside = -plan.airportDistance(world.copy(q).applyMatrix4(m).x, world.z);
        worst.deck = Math.min(worst.deck, inside);
        assert(inside >= 0.3, `The plane leaves the deck at ${world.x.toFixed(2)}, ${world.z.toFixed(2)} (t=${t.toFixed(2)}).`);
      }
    // Only what it comes within reach of (its parts are all within `reach` of its middle).
    const near = obstacles.filter(({ box: [x0, x1, z0, z1] }) => p.x > x0 - reach - 1 && p.x < x1 + reach + 1 && p.z > z0 - reach - 1 && p.z < z1 + reach + 1),
      nearSock = Math.hypot(p.x - W.x, p.z - W.z) < reach + 1.2;
    if (!near.length && !nearSock) continue;
    for (const q of local) {
      world.copy(q).applyMatrix4(m);
      for (const o of near) {
        const [x0, x1, z0, z1] = o.box;
        if (world.x < x0 - 2 || world.x > x1 + 2 || world.z < z0 - 2 || world.z > z1 + 2) continue;
        const gap = outside(o.outline, world.x, world.z);
        worst[o.name] = Math.min(worst[o.name], gap);
        assert(gap >= o.gap, `The plane comes ${gap.toFixed(3)} from the ${o.name} at ${world.x.toFixed(2)}, ${world.z.toFixed(2)} (t=${t.toFixed(2)}).`);
      }
      if (nearSock) {
        let gap = world.y < mastTop ? Math.hypot(world.x - W.x, world.z - W.z) - 0.06 : Infinity;
        for (const axis of socks) gap = Math.min(gap, axis.closestPointToPoint(world, true, closest).distanceTo(world) - S.mouth - 0.04);
        worst.windsock = Math.min(worst.windsock, gap);
        assert(gap >= 0.3, `The plane comes ${gap.toFixed(3)} from the windsock at t=${t.toFixed(2)}.`);
      }
    }
  }
  assert(Object.values(worst).every(Number.isFinite), `The plane's clearances were not all measured: ${JSON.stringify(worst)}.`);
  // Never over the main island, and nowhere near the balloon, the gulls, the beam or the boat. The
  // plane keeps a clock of its own (city-scene's planeClock starts its loop again after every Pause,
  // while town time stands still), so it is held clear of everywhere the others go at any moment of
  // theirs, not only at the moment of its own loop that matches: its whole loop against each of
  // theirs. The balloon also turns with the idle drift about the view's centre, on the island or
  // out at the airport.
  const birds = createGulls(),
    [rockX, rockZ] = plan.lighthouseRock,
    flown = [];
  for (let t = 0; t < plan.PLANE_LOOP; t += 0.25) {
    const p = plan.planePose(t);
    if (p.visible) flown.push(p);
  }
  let island = Infinity;
  for (const p of flown)
    for (const [dx, dz] of [[0, 0], [2, 0], [-2, 0], [0, 2.3], [0, -2.3]]) {
      const x = p.x + dx,
        z = p.z + dz;
      island = Math.min(island, plan.distanceToPolyline([x, z], plan.islandOutline, true) * (plan.onIsland(x, z) ? -1 : 1));
    }
  const others = { balloon: Infinity, gulls: Infinity, beam: Infinity, boat: Infinity },
    nearest = (x, y, z) => {
      let best = Infinity;
      for (const p of flown) best = Math.min(best, Math.hypot(p.x - x, p.y - y, p.z - z));
      return best;
    };
  for (let t = 0; t < 900; t += 0.25) {
    balloon.update(t, 0);
    const b = balloon.object.position;
    for (const [cx, cz] of [[0, 0], [plan.AIRPORT.x, plan.AIRPORT.z]])
      for (const drift of [-0.16, 0, 0.16]) {
        const c = Math.cos(drift),
          s = Math.sin(drift),
          x = b.x - cx,
          z = b.z - cz;
        others.balloon = Math.min(others.balloon, nearest(cx + x * c + z * s, b.y + 2.5, cz - x * s + z * c));
      }
    birds.update(t, 1);
    for (const g of birds.object.children) others.gulls = Math.min(others.gulls, nearest(g.position.x, g.position.y, g.position.z));
    beam.update(t, 1);
    const a = beam.object.rotation.y,
      tip = [rockX + Math.cos(a) * 18, rockZ - Math.sin(a) * 18],
      boat = plan.boatPose(t);
    for (const p of flown) {
      others.beam = Math.min(others.beam, plan.distanceToSegment([p.x, p.z], [rockX, rockZ], tip) - 3.6);
      others.boat = Math.min(others.boat, Math.hypot(p.x - boat.x, p.z - boat.z));
    }
  }
  balloon.update(0, 0);
  beam.update(3, 0);
  birds.dispose();
  assert(island >= 12, `The plane comes within ${island.toFixed(1)} of the island's coast.`);
  for (const [name, gap] of Object.entries(others)) assert(gap >= 30, `The plane comes within ${gap.toFixed(1)} of the ${name}.`);
  assert(balloon.object !== sockEntry.object && beam.object !== sockEntry.object, 'The windsock is taken for the balloon or the beam.');
  // Out of sight: off every standard frame, or lost in the fog, where it vanishes and where it comes back.
  const fogFar = Number(/new T\.Fog\('#[0-9a-f]+', \d+, (\d+)\)/.exec(await fs.readFile(path.join(root, 'app/city-scene.ts'), 'utf8'))[1]),
    edges = [plan.planePose(plan.PLANE_TIMES.lost - 1e-6), plan.planePose(plan.PLANE_TIMES.approach)];
  for (const p of edges)
    for (const centre of [new T.Vector3(0, 0, 0), new T.Vector3(-3.5, 0, -13.5), new T.Vector3(plan.AIRPORT.x, 0, plan.AIRPORT.z)])
      for (const yaw of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4, plan.chapterBearings.airport]) {
        const eye = centre.clone().add(new T.Vector3(Math.sin(yaw) * 38, 35, Math.cos(yaw) * 38)),
          forward = centre.clone().sub(eye).normalize(),
          right = new T.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)),
          up = new T.Vector3().crossVectors(right, forward),
          rel = new T.Vector3(p.x, p.y, p.z).sub(eye);
        // The widest and the squarest common frames (city-scene's frustum for their shape) zoomed
        // out to 0.45, with the plane's own size.
        for (const [w, h] of [[1920, 1080], [1440, 900], [1024, 768]]) {
          const tall = Math.max(53, (76 * h) / w),
            offFrame = Math.abs(rel.dot(right)) > (tall * w) / h / 2 / 0.45 + 2.3 || Math.abs(rel.dot(up)) > tall / 2 / 0.45 + 2.3;
          assert(offFrame || rel.dot(forward) >= fogFar, `The plane vanishes or comes back in view at ${p.x.toFixed(0)}, ${p.z.toFixed(0)} (bearing ${yaw.toFixed(2)}, ${w} x ${h}).`);
        }
      }
}
// On the opening view (bearing pi/4 swayed by the idle drift's +-0.16, zoom 1, the hero's frame
// shift of -0.06) the plane keeps to the top right corner, where the airport shows: never behind
// the hero copy or the News card (at its tallest), at every common size, with and without a
// scrollbar, all through its loop, as the balloon is held there.
{
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
  ].flatMap((s) => [s, { ...s, W: s.W - 15, news: s.news.map((x) => x - 15) }]);
  const yaw = Math.PI / 4,
    corner = new T.Vector3(),
    P = plan.PLANE,
    poses = [];
  for (let t = 0; t < plan.PLANE_LOOP; t += 0.25) {
    const p = plan.planePose(t);
    if (p.visible) poses.push({ t, m: new T.Matrix4().makeRotationFromEuler(new T.Euler(-p.pitch, p.heading, p.bank, 'YXZ')).setPosition(p.x, p.y, p.z) });
  }
  let shown = 0;
  for (const { W, H, copy: [cx0, cy0, cx1, cy1], news: [nx0, nx1] } of screens) {
    const vertical = Math.max(53, (76 * H) / W),
      view = new T.OrthographicCamera((-vertical * W) / H / 2, (vertical * W) / H / 2, vertical / 2, -vertical / 2, -200, 180),
      shifted = new T.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(-0.06 * (view.right - view.left)),
      boxes = { 'hero copy': [cx0 - 8, cy0 - 8, cx1 + 8, cy1 + 8], 'News card': [nx0 - 8, H / 2 - 0.42 * 400 - 8, nx1 + 8, H / 2 + 0.58 * 400 + 8] };
    for (const drift of [-0.16, 0, 0.16]) {
      view.position.copy(shifted).add(new T.Vector3(Math.sin(yaw + drift) * 38, 35, Math.cos(yaw + drift) * 38));
      view.lookAt(shifted);
      view.updateMatrixWorld();
      for (const { t, m } of poses) {
        let left = Infinity,
          right = -Infinity,
          top = Infinity,
          bottom = -Infinity;
        for (let i = 0; i < 8; i++) {
          corner.set(i & 1 ? P.span / 2 + 0.07 : -P.span / 2 - 0.07, i & 2 ? P.fin : 0, i & 4 ? P.length / 2 : -P.length / 2 - 0.08).applyMatrix4(m).project(view);
          const x = ((corner.x + 1) / 2) * W,
            y = ((1 - corner.y) / 2) * H;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
        if (!(right > 0 && left < W && bottom > 0 && top < H)) continue;
        shown++;
        for (const [name, [x0, y0, x1, y1]] of Object.entries(boxes))
          assert(right < x0 || left > x1 || bottom < y0 || top > y1, `At t=${t} the plane flies behind the ${name} on the ${W} x ${H} opening view.`);
        assert(left > W / 2 && bottom < H / 3, `At t=${t} the plane shows outside the ${W} x ${H} opening view's top right corner.`);
      }
    }
  }
  assert(shown > 0, 'The opening view never shows the plane.');
}
// Reduced motion and Pause keep the plane on its stand: the scene's clock for it goes back to its
// loop's start while either holds (a flight under way ends on the stand; Play picks the loop up from
// there), and otherwise runs with town time; the frame loop drives it that way and poses it with
// posePlane, which hides it while it is away and leaves its steady lights alone.
{
  const { planeClock, posePlane } = await load('city-scene'),
    { PLANE_LIGHT } = await load('town-movers'),
    P = plan.PLANE_LOOP,
    stand = plan.planePose(0);
  for (let t = 0; t < 3 * P; t += 0.7) {
    const held = plan.planePose(planeClock(t, 1 / 60, true));
    assert(held.phase === 'parked' && held.x === stand.x && held.z === stand.z && held.heading === stand.heading, `Paused at t=${t.toFixed(1)} the plane is not on its stand.`);
    assert(Math.abs(planeClock(t, 1 / 60, false) - t - 1 / 60) < 1e-9, 'The plane\'s clock does not run with town time.');
  }
  // Held for a while and let go, it waits on its stand for its pushback.
  let clock = 97.3;
  for (let f = 0; f < 30; f++) clock = planeClock(clock, 1 / 60, true);
  for (let f = 0; f < 60; f++) clock = planeClock(clock, 1 / 60, false);
  assert.equal(plan.planePose(clock).phase, 'parked', 'Let go, the plane does not wait on its stand.');
  // Held anywhere out of its loop's start, its clock goes back (the frame loop then redraws the
  // shadows at once, so the plane on its stand never stands without its shadow, or leaves it on
  // the runway, until the paused cadence comes round); held on its stand already, it stays put
  // (no extra shadow pass, frame after paused frame).
  for (let t = 0.05; t < P; t += 0.37) assert(planeClock(t, 1 / 60, true) < t && planeClock(P + t, 1 / 60, true) < P + t, `Held at t=${t.toFixed(2)} the plane's clock does not go back.`);
  for (const t of [0, P, 7 * P]) assert.equal(planeClock(t, 1 / 60, true), t, 'Held on its stand, the plane\'s clock moves.');
  const source = await fs.readFile(path.join(root, 'app/city-scene.ts'), 'utf8');
  assert(/planeTime = planeClock\(planeTime, dt, paused \|\| reduced\);\s*posePlane\(plane, planeTime\);/.test(source), 'The frame loop no longer holds the plane on its stand when paused or under reduced motion.');
  assert(/const (\w+) = planeTime;\s*planeTime = planeClock\(planeTime, dt, paused \|\| reduced\);\s*posePlane\(plane, planeTime\);(?:\s*\/\/[^\n]*)*\s*if \(planeTime < \1\) shadowDirty = true;/.test(source), 'Sent back to its stand mid-loop, the plane leaves its shadow behind until the paused shadow cadence comes round.');
  const plane = model.plane,
    lights = plane.getObjectByName('plane-lights').children;
  for (const t of [10, 45, 75, 100, 125, 143]) {
    const p = posePlane(plane, t);
    assert(plane.position.x === p.x && plane.position.y === p.y && plane.position.z === p.z && plane.rotation.order === 'YXZ' && plane.rotation.y === p.heading && plane.rotation.x === -p.pitch && plane.rotation.z === p.bank && plane.visible === p.visible, `posePlane does not pose the plane as planePose has it at t=${t}.`);
    assert(lights.every((l) => l.visible && l.material.emissiveIntensity === PLANE_LIGHT), 'The plane\'s lights flash.');
  }
  posePlane(plane, 0);
  plane.rotation.order = 'XYZ';
  plane.updateMatrixWorld(true);
}
// The windsock sways as the washing does: the frame loop swings its sock (one group, batched on its
// own into one mesh that casts nothing) round the swivel and lifts and drops it a little, turning
// the group and never a vertex; at every moment the sock streams east, downwind, over the deck, high
// over it and under 2.5; it never stops (its pose differs from moment to moment) and stays out in
// the rain.
{
  const { WINDSOCK_SWAY: S, windsockAim } = await load('town-airport'),
    entry = model.animated.find((e) => e.object.name === 'windsock-sock'),
    sock = entry.object,
    W = plan.WINDSOCK,
    mesh = sock.children[0],
    positions = mesh?.geometry.attributes.position.array.slice();
  assert(sock.userData.keepSeparate && sock.children.length === 1 && mesh.isMesh && !mesh.castShadow, 'The windsock\'s sock is not one mesh of its own that casts nothing.');
  const box = new T.Box3(),
    seen = new Set();
  for (let t = 0; t < 120; t += 0.37) {
    entry.update(t, 0, t > 60 ? 1 : 0);
    const aim = windsockAim(t);
    assert(Math.abs(aim.heading - S.heading) <= S.swing + 1e-9 && Math.abs(aim.droop - S.droop) <= S.lift + 1e-9 && aim.droop > 0.15, `The windsock swings out of its sway at t=${t.toFixed(2)}.`);
    sock.updateWorldMatrix(true, true);
    box.setFromObject(sock);
    assert(sock.visible && box.min.y > plan.AIRPORT.deck + 1.2 && box.max.y < 2.5 && box.max.x > W.x + 0.5, `The windsock's sock does not stream east in the air at t=${t.toFixed(2)}.`);
    const pos = mesh.geometry.attributes.position,
      p = new T.Vector3();
    for (let i = 0; i < pos.count; i += 7) {
      p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      assert(plan.onAirport(p.x, p.z, -0.1), `The windsock's sock swings out over the edge at t=${t.toFixed(2)}.`);
    }
    seen.add(sock.quaternion.toArray().map((n) => n.toFixed(3)).join());
  }
  assert(seen.size > 100, 'The windsock holds still.');
  assert.deepEqual(mesh.geometry.attributes.position.array, positions, 'The windsock\'s vertices move on the CPU.');
  entry.update(0, 0, 0);
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
// Crown tops over the ground in units of the tree's size, by kind (round and autumn trees 2.39);
// the birch and rowan ones are measured against the built trees below.
const TREE_TOPS = { pine: 2.27, birch: 2.58, rowan: 1.91 };
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
        // A pine's tip is at 2.27 x size; a round crown tops out at about 2.39 x size (TREE_TOPS).
        top = plan.terrainHeight(t.x, t.z) - plan.terrainHeight(s.x, s.z) + (TREE_TOPS[t.kind] ?? 2.39) * t.size,
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
// Silver birch and rowan stand in for some of the outskirts' and the park's round trees: the count
// and every place stay, the formal trees stay round, birches stand in loose groups of two or three
// towards the coast and hills and rowans alone by a cottage, the paddock or the park, none in the
// terrace clearing. Their fruit comes only in its season (rowan flowers in spring, berries in late
// summer and autumn), within about 3k triangles, and the trees cost about what the round ones did.
{
  const nature = await load('town-nature'),
    { createKit } = await load('town-kit'),
    { createCityMaterials } = await load('city-materials'),
    { palette } = await load('town-shared');
  // 82 as planted; the Visiting PhD Residence's ground took tree-55 and tree-60 (the plan drops them by id).
  assert.equal(trees.length, 80, 'The birches and rowans change no tree count.');
  const birches = trees.filter((t) => t.kind === 'birch'),
    rowans = trees.filter((t) => t.kind === 'rowan');
  // Of the 46 outskirts and park trees, about 15-20% birch and 10-15% rowan.
  assert(birches.length >= 7 && birches.length <= 9, `${birches.length} birches`);
  assert(rowans.length >= 5 && rowans.length <= 7, `${rowans.length} rowans`);
  for (const t of trees)
    if (Math.hypot(t.x, t.z) < plan.PLAZA_RADIUS || plan.distanceToStreets(t.x, t.z) < 2)
      assert.equal(t.kind, 'round', `The formal ${t.id} turned ${t.kind}`);
  const gap = (t, r) => Math.hypot(Math.max(0, Math.abs(t.x - r.x) - r.w / 2), Math.max(0, Math.abs(t.z - r.z) - r.d / 2)),
    clearing = { x: plan.terraceRow.x, z: plan.terraceRow.z, w: 11, d: 2 * (plan.terraceRow.spacing + 4) };
  for (const t of [...birches, ...rowans]) assert(gap(t, clearing) > 1, `${t.id} (${t.kind}) in the terrace clearing`);
  for (const b of birches) {
    const group = new Set([b]);
    for (let grown = true; grown; ) {
      grown = false;
      for (const o of birches)
        if (!group.has(o) && [...group].some((g) => Math.hypot(g.x - o.x, g.z - o.z) < 4.6)) {
          group.add(o);
          grown = true;
        }
    }
    assert(group.size >= 2 && group.size <= 3, `${b.id} stands in a group of ${group.size} birches`);
    const shore = plan.islandRadius(Math.atan2(b.z, b.x)) - Math.hypot(b.x, b.z);
    assert(shore < 8.5 || plan.terrainHeight(b.x, b.z) > 0.1, `${b.id} is a birch far from the coast and the hills`);
  }
  for (const r of rowans) {
    for (const o of rowans) assert(o === r || Math.hypot(o.x - r.x, o.z - r.z) >= 5, `${r.id} and ${o.id}: rowans stand alone`);
    assert(
      gap(r, plan.park) < 3 || gap(r, plan.paddock) < 3 || plan.cottages.some((c) => Math.hypot(c.x - r.x, c.z - r.z) < 5),
      `${r.id} is a rowan by no cottage, paddock or park`,
    );
  }
  const library = createCityMaterials(),
    build = (season, spec) => {
      const ctx = { library, material: library.material, season, land: new T.Group(), lamps: [], clocks: [], animated: [] },
        g = new T.Group();
      nature.createNature(ctx, createKit(ctx)).tree(g, spec, Number(spec.id.slice(5)));
      g.updateMatrixWorld(true);
      return g;
    },
    tris = (g, pick) => {
      let n = 0;
      g.traverse((o) => {
        if (o.isMesh && pick(o)) n += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3;
      });
      return n;
    };
  for (const t of [...birches, ...rowans]) {
    const top = (new T.Box3().setFromObject(build('summer', t)).max.y - plan.terrainHeight(t.x, t.z)) / t.size;
    assert(Math.abs(top - TREE_TOPS[t.kind]) < 0.02, `${t.id}: a ${t.kind} tops out at ${top.toFixed(3)} x size, not ${TREE_TOPS[t.kind]}`);
  }
  const muted = (hex, limit) => assert(hsv(hex).s <= limit + 1e-3, `${hex} is louder than its palette family`),
    birchLeaves = {};
  for (const season of ['spring', 'summer', 'autumn', 'winter']) {
    let fruit = 0,
      species = 0,
      round = 0;
    birchLeaves[season] = 0;
    for (const t of [...birches, ...rowans]) {
      const g = build(season, t),
        look = nature.treeLook(t, Number(t.id.slice(5)), season);
      // The canopy and autumn families top out at s 0.73 and 0.77 (#7aab2e, #c8862f).
      for (const hex of [...look.tones, look.top, look.under]) muted(hex, 0.765);
      fruit += tris(g, (o) => o.userData.fruit);
      species += tris(g, (o) => !o.userData.fruit);
      if (t.kind === 'birch') birchLeaves[season] += tris(g, (o) => o.material.userData.surfaceKind === 'foliage');
      round += tris(build(season, { ...t, kind: 'round' }), () => true);
      const f = nature.treeFruit(t, season);
      assert.equal(!!f, t.kind === 'rowan' && season !== 'winter', `${t.id} ${f ? 'bears' : 'lacks'} fruit in ${season}`);
      assert.equal(tris(g, (o) => o.userData.fruit) > 0, !!f, `${t.id}'s fruit is ${f ? 'missing' : 'out of season'} in ${season}`);
      if (f) {
        assert.equal(f.kind, season === 'spring' ? 'flowers' : 'berries', `${t.id} carries ${f.kind} in ${season}`);
        muted(f.colour, f.kind === 'flowers' ? hsv(palette.white).s : hsv(palette.flowers[0]).s);
      }
    }
    assert(fruit <= 3000, `${season} fruit costs ${fruit} triangles`);
    assert(species <= 1.1 * round, `${season} birches and rowans cost ${species} triangles against ${round} as round trees`);
  }
  assert(birchLeaves.winter < birchLeaves.summer, 'The winter birches are a clump sparser.');
}
// The trees leave the homes' details in view: from the overview (each quarter turn) and from every
// chapter that faces them, no tree of any kind stands between the camera and the ivy on the
// archive's south wall or the cottage gable, or a window box on a home or a cottage. Tested leaf by
// leaf toward the camera (35 up for every 38 across) through the fullest crowns, summer and autumn.
{
  const nature = await load('town-nature'),
    { createKit } = await load('town-kit'),
    { createCityMaterials } = await load('city-materials'),
    { IVY_COTTAGE } = await load('town-homes');
  const library = createCityMaterials(),
    grove = (season, centre) => {
      const ctx = { library, material: library.material, season, land: new T.Group(), lamps: [], clocks: [], animated: [] },
        make = nature.createNature(ctx, createKit(ctx)),
        g = new T.Group();
      for (const t of trees) if (Math.hypot(t.x - centre.x, t.z - centre.z) < 14) make.tree(g, t, Number(t.id.slice(5)));
      g.updateMatrixWorld(true);
      return g.children.flatMap((t) => t.children.filter((o) => o.isMesh));
    };
  /** World centroids of `meshes`' foliage triangles whose centroid, in `frame`'s space, is inside `box`. */
  const leaves = (meshes, frame, box) => {
    const toLocal = frame.clone().invert(),
      out = [],
      a = new T.Vector3(),
      b = new T.Vector3(),
      c = new T.Vector3();
    for (const o of meshes) {
      if (!o.isMesh || o.material.userData.surfaceKind !== 'foliage') continue;
      const p = o.geometry.attributes.position,
        index = o.geometry.index,
        n = index ? index.count : p.count,
        at = (i) => (index ? index.getX(i) : i);
      for (let i = 0; i < n; i += 3) {
        a.fromBufferAttribute(p, at(i)).applyMatrix4(o.matrixWorld);
        b.fromBufferAttribute(p, at(i + 1)).applyMatrix4(o.matrixWorld);
        c.fromBufferAttribute(p, at(i + 2)).applyMatrix4(o.matrixWorld);
        const world = a.clone().add(b).add(c).divideScalar(3);
        if (box.containsPoint(world.clone().applyMatrix4(toLocal))) out.push(world);
      }
    }
    return out;
  };
  const B = (x0, y0, z0, x1, y1, z1) => new T.Box3(new T.Vector3(x0, y0, z0), new T.Vector3(x1, y1, z1)),
    landMeshes = [],
    details = [];
  model.land.traverse((o) => o.isMesh && landMeshes.push(o));
  // Each detail: its leaves, and the way its wall faces (world, horizontal).
  const face = (frame, x, z) => new T.Vector3(x, 0, z).transformDirection(frame).setY(0).normalize();
  {
    const { shell } = models.get('city-archive');
    shell.updateMatrixWorld(true);
    const { w, d } = plan.sites['city-archive'];
    details.push({ name: 'the archive’s ivy', points: leaves(shell.children, shell.matrixWorld, B(w / 2 - 0.2, -1, -d / 2, w / 2 + 0.5, 4, d / 2)), facing: face(shell.matrixWorld, 1, 0) });
  }
  plan.cottages.forEach((c, i) => {
    const frame = new T.Matrix4().makeRotationY(c.rotation).setPosition(c.x, plan.terrainHeight(c.x, c.z), c.z);
    details.push({ name: `cottage ${i}’s window box`, points: leaves(landMeshes, frame, B(-1.05, 0.45, 1.2, -0.25, 1.15, 1.7)), facing: face(frame, 0, 1) });
    if (c.n === IVY_COTTAGE) details.push({ name: `cottage ${c.n}’s ivy`, points: leaves(landMeshes, frame, B(1.25, -1, -1.5, 1.75, 3.5, 1.5)), facing: face(frame, 1, 0) });
  });
  for (const id of plan.terraceHomes) {
    const { shell } = models.get(id),
      { d } = plan.sites[id];
    shell.updateMatrixWorld(true);
    details.push({ name: `${id}’s window box`, points: leaves(shell.children, shell.matrixWorld, B(-1.0, 0.3, d / 2 + 0.45, -0.36, 1.0, d / 2 + 0.75)), facing: face(shell.matrixWorld, 0, 1) });
  }
  const bearings = [...new Set([...[0, 1, 2, 3].map((k) => plan.chapterBearings.overview + (k * Math.PI) / 2), ...Object.values(plan.chapterBearings)])],
    ray = new T.Raycaster();
  ray.near = 0.08;
  for (const season of ['summer', 'autumn'])
    for (const { name, points, facing } of details) {
      assert(points.length >= 12, `${name}: only ${points.length} leaves found`);
      const centre = points.reduce((s, p) => s.add(p), new T.Vector3()).divideScalar(points.length),
        crowns = grove(season, centre);
      for (const b of bearings) {
        const toward = new T.Vector3(Math.sin(b) * 38, 35, Math.cos(b) * 38).normalize();
        if (facing.dot(new T.Vector3(toward.x, 0, toward.z).normalize()) < 0.25) continue;
        let hidden = 0;
        for (const p of points) {
          ray.set(p, toward);
          if (ray.intersectObjects(crowns, false).length) hidden++;
        }
        assert(hidden <= 0.02 * points.length, `${season}: trees hide ${hidden} of ${points.length} leaves of ${name} from the camera at bearing ${b.toFixed(2)}`);
      }
    }
}
// The flora keeps its reading and its budget. From the opening bearing the round trees' fork
// shows under the crown's rim (the crown leaves a gap toward the camera) and a birch's white trunk
// shows under its crown, which hangs no lower than 1.15 x size; a rowan's berries and flower heads
// sit on its sprays, not in the air; the ivy under the archive's cornice runs unbroken from the
// middle pier of wall to the back one (its runner) instead of floating in tufts; and the 80 trees
// together stay within 170k triangles in their fullest seasons.
{
  const nature = await load('town-nature'),
    { createKit } = await load('town-kit'),
    { createCityMaterials } = await load('city-materials'),
    library = createCityMaterials(),
    build = (season, spec) => {
      const ctx = { library, material: library.material, season, land: new T.Group(), lamps: [], clocks: [], animated: [] },
        g = new T.Group();
      nature.createNature(ctx, createKit(ctx)).tree(g, spec, Number(spec.id.slice(5)));
      g.updateMatrixWorld(true);
      return g.children[0].children.filter((o) => o.isMesh);
    },
    /** World centroids of the triangles of `meshes`. */
    centroids = (meshes) => {
      const out = [],
        a = new T.Vector3(),
        b = new T.Vector3(),
        c = new T.Vector3();
      for (const o of meshes) {
        const p = o.geometry.attributes.position,
          index = o.geometry.index,
          n = index ? index.count : p.count,
          at = (i) => (index ? index.getX(i) : i);
        for (let i = 0; i < n; i += 3) {
          a.fromBufferAttribute(p, at(i)).applyMatrix4(o.matrixWorld);
          b.fromBufferAttribute(p, at(i + 1)).applyMatrix4(o.matrixWorld);
          c.fromBufferAttribute(p, at(i + 2)).applyMatrix4(o.matrixWorld);
          out.push(a.clone().add(b).add(c).divideScalar(3));
        }
      }
      return out;
    },
    of = (meshes, kind) => meshes.filter((o) => o.material.userData.surfaceKind === kind && !o.userData.fruit),
    b0 = plan.chapterBearings.overview,
    toward = new T.Vector3(Math.sin(b0) * 38, 35, Math.cos(b0) * 38).normalize(),
    ray = new T.Raycaster(),
    /** The share of `points` the opening camera sees past `crown`. */
    seen = (points, crown) => {
      let n = 0;
      for (const p of points) {
        ray.set(p, toward);
        if (!ray.intersectObjects(crown, false).length) n++;
      }
      return n / points.length;
    };
  ray.near = 0.02;
  for (const season of ['summer', 'autumn']) {
    let n = 0;
    for (const t of trees) for (const o of build(season, t)) n += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    assert(n <= 170000, `${season}: the trees cost ${n} triangles`);
  }
  for (const t of trees) {
    if (t.kind === 'pine') continue;
    const meshes = build('summer', t),
      foot = plan.terrainHeight(t.x, t.z),
      crown = of(meshes, 'foliage'),
      wood = (lo, hi) => centroids(of(meshes, 'bark')).filter((p) => p.y - foot > lo * t.size && p.y - foot < hi * t.size);
    if (t.kind === 'round' || t.kind === 'autumn') {
      const fork = seen(wood(0.55, 1.0), crown);
      assert(fork >= 0.6, `${t.id}: the opening camera sees only ${Math.round(fork * 100)}% of the fork under its crown`);
    }
    if (t.kind === 'birch') {
      const low = Math.min(...centroids(crown).map((p) => p.y - foot)) / t.size,
        trunk = seen(wood(0.3, 1.1), crown);
      assert(low >= 1.15, `${t.id}: the birch's crown hangs down to ${low.toFixed(2)} x size`);
      assert(trunk >= 0.8, `${t.id}: the opening camera sees only ${Math.round(trunk * 100)}% of the birch's trunk`);
    }
    if (t.kind === 'rowan')
      for (const season of ['spring', 'summer', 'autumn']) {
        const ms = build(season, t),
          sprays = centroids(of(ms, 'foliage')),
          fruit = centroids(ms.filter((o) => o.userData.fruit));
        for (const p of fruit) {
          const gap = Math.min(...sprays.map((q) => q.distanceTo(p)));
          assert(gap < 0.25 * t.size, `${t.id}: ${season} fruit hangs ${gap.toFixed(2)} from its sprays at ${p.toArray().map((v) => v.toFixed(2)).join(', ')}`);
        }
      }
  }
  // The archive's south wall is its shell's +x face; along it, the face's x runs down the shell's -z.
  const { shell } = models.get('city-archive'),
    { w } = plan.sites['city-archive'];
  shell.updateMatrixWorld(true);
  const toShell = shell.matrixWorld.clone().invert(),
    band = centroids(shell.children.filter((o) => o.isMesh && o.material.userData.surfaceKind === 'foliage'))
      .map((p) => p.applyMatrix4(toShell))
      .filter((p) => p.x > w / 2 - 0.12 && p.y > 3.28 && p.y < 3.62 && p.z < -0.05 && p.z > -1.75)
      .map((p) => p.z)
      .sort((a, b) => a - b);
  assert(band.length > 40, `Only ${band.length} ivy triangles under the archive's cornice`);
  let widest = Math.max(band[0] + 1.75, -0.05 - band[band.length - 1]);
  for (let i = 1; i < band.length; i++) widest = Math.max(widest, band[i] - band[i - 1]);
  assert(widest <= 0.12, `The ivy under the archive's cornice breaks for ${widest.toFixed(2)}`);
}
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
// The rain falls over the airport's island too (a square of ±58 round the town's centre, out past
// the deck's far edge at -55.2), as dense as it was over ±50: the scene asks for 1.35 times the streaks.
{
  const { createRain } = await load('city-atmosphere'),
    rain = createRain(),
    p = rain.object.geometry.getAttribute('position'),
    streaks = p.count / 2;
  let reach = 0;
  for (let i = 0; i < p.count; i++) reach = Math.max(reach, Math.abs(p.getX(i)), Math.abs(p.getZ(i)));
  assert(reach > 57 && reach <= 58 && reach > -(plan.AIRPORT.z - plan.AIRPORT.hd - plan.AIRPORT.armour), `The rain reaches ${reach.toFixed(1)}, not over the airport.`);
  assert(Math.abs(streaks / (2 * 58) ** 2 - 1700 / (2 * 50) ** 2) < 0.002, `The rain is thinner over ±58 (${streaks} streaks).`);
  rain.dispose();
  const scene = await fs.readFile(path.join(root, 'app/city-scene.ts'), 'utf8');
  assert(scene.includes('createRain(Math.round((tier === \'low\' ? 900 : 1700) * 1.35))'), 'The scene\'s rain is no longer 1.35 times as many streaks.');
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
// 05:30 to 07:30, reset at noon. The follower only moves forward in the dark, holds through twilight
// and the autumn clock change, and copies the clock by day; in Manual night it walks the noon reset
// back (below, pane by pane), and with reduced motion takes it at once.
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
  const night = { out: 1, wake: 1 },
    noon = { out: 0, wake: 0 };
  assert.deepEqual(follow(night, noon, 0.01, 1 / 60, false), noon, 'By day the noon reset is a copy, unseen.');
  assert.deepEqual(follow(night, noon, 1, 1 / 60, true), noon, 'Reduced motion takes the noon reset at once.');
  assert.deepEqual(follow(night, noon, 0.6, 1, false), night, 'Twilight holds the noon reset.');
  const back = follow(night, noon, 1, 1, false);
  assert(Math.abs(back.out - 1 + RESET_RATE) < 1e-12 && Math.abs(back.wake - 1 + RESET_RATE) < 1e-12, 'Manual night walks the noon reset back at RESET_RATE.');
  assert(RESET_RATE / 60 < 0.5 / 255, 'The noon reset moves a clock less than half a byte a frame.');
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
// Manual night across noon, at 60 fps: the clock walks from (1, 1) back to (0, 0) in under three
// minutes; per frame at most one pane from each clock is mid-switch, each switch a lamp (about a
// fifth of a second between 10% and 90%), not all of the night's panes in one frame.
{
  const state = { out: 1, wake: 1 },
    evening = (p, out) => windowLevel([p.light[0], p.light[1], p.light[2], 1], { out, wake: 0 }) / p.light[0],
    riser = (p, wake) => windowLevel([0, p.light[1], 1, p.light[3]], { out: 1, wake }) / 0.8,
    goingOut = panes.filter((p) => p.light[0] > 0 && p.light[2] < 1),
    waking = panes.filter((p) => p.light[3] < 0.999),
    switching = new Map();
  let frames = 0;
  while (state.out > 0 || state.wake > 0) {
    followWindows(state, { out: 0, wake: 0 }, 1, 1 / 60, false);
    frames++;
    assert(frames <= 180 * 60, 'The noon reset in Manual night takes over three minutes.');
    let mid = 0;
    for (const [list, of, clock, kind] of [[goingOut, evening, state.out, 'out'], [waking, riser, state.wake, 'wake']])
      for (const p of list) {
        const f = of(p, clock);
        if (f <= 0.1 || f >= 0.9) continue;
        mid++;
        const key = kind + ' ' + panes.indexOf(p);
        switching.set(key, (switching.get(key) ?? 0) + 1);
      }
    assert(mid <= 2, `${mid} panes switch at once in frame ${frames} of the noon reset.`);
  }
  assert(frames >= 150 * 60, `The noon reset in Manual night is over in ${(frames / 60).toFixed(0)} s.`);
  assert.equal(switching.size, goingOut.length + waking.length, 'Every pane of the night switches back at the noon reset.');
  for (const [key, count] of switching) assert(count >= 9 && count <= 16, `The pane at ${key} switches over ${count} frames at the noon reset.`);
  for (const p of panes) assert.equal(windowLevel(p.light, state), windowLevel(p.light, windowClock(12)), `A pane at ${p.place} misses the noon reset.`);
}
// Street details. The manhole covers lie on the carriageway, in the ring's lanes outside the rails
// (never between or on them) or in an avenue's lane off its centre dashes, about every 12-20 units
// round the ring; the gullies sit in the gutter against a kerb (never at an avenue mouth, where the
// ring's inner kerb opens), every 8-10 units along both kerbs and one a side on each avenue. Both keep
// clear of the rails, the zebras, the stop lines, the signal posts and the lamps' bases, of each other
// and of the repair patches. The road shader draws exactly the plan's covers and gullies.
{
  const R = plan.ROAD_WIDTH,
    { manholes, gullies, roadPatches, MANHOLE, GULLY, zebras, toRect, stopLineRect, gullyRect } = plan,
    r = MANHOLE.radius,
    lamps = plan.lampPlan(),
    rails = [-1, 1].map((s) => plan.offsetPolyline(plan.ringLine, s * 0.42)),
    ringLength = plan.polylineLength(plan.ringLine, true),
    patchRect = (p) => ({ x: (p.box[0] + p.box[2]) / 2, z: (p.box[1] + p.box[3]) / 2, u: [1, 0], half: [(p.box[2] - p.box[0]) / 2, (p.box[3] - p.box[1]) / 2] }),
    avenueOf = (road) => plan.avenues.find((a) => a.id === road);
  const ringCovers = manholes.filter((c) => c.road === 'ring');
  assert(ringCovers.length >= 6 && manholes.length - ringCovers.length === 3, 'Covers lie round the ring and one in each avenue.');
  for (const road of ['south', 'west', 'east']) assert(manholes.some((c) => c.road === road), `The ${road} avenue has no cover.`);
  const coverAlong = ringCovers.map((c) => c.along).sort((a, b) => a - b);
  coverAlong.forEach((s, i) => {
    const gap = (coverAlong[(i + 1) % coverAlong.length] - s + ringLength) % ringLength;
    assert(gap >= 12 && gap <= 20, `Covers ${gap.toFixed(1)} apart on the ring.`);
  });
  for (const c of manholes) {
    const name = `The cover at ${c.road} ${c.along}`;
    if (c.road === 'ring') {
      const d = plan.distanceToPolyline([c.x, c.z], plan.ringLine, true);
      assert(d + r <= R / 2 - 0.03, `${name} reaches the kerb.`);
      for (const rail of rails) assert(plan.distanceToPolyline([c.x, c.z], rail, true) >= 0.035 + r + 0.02, `${name} lies on a rail.`);
      assert(d > 0.42, `${name} lies between the rails.`);
      for (const j of signalJunctions) assert(Math.hypot(c.x - j.at[0], c.z - j.at[1]) >= 2.5, `${name} lies in the ${j.id} junction.`);
    } else {
      const a = avenueOf(c.road),
        d = plan.distanceToSegment([c.x, c.z], a.from, a.to);
      assert(d + r <= R / 2 - 0.03 && d - r >= 0.1, `${name} is off its lane (${d.toFixed(2)} from the centre line).`);
      assert(plan.distanceToPolyline([c.x, c.z], plan.ringLine, true) >= R / 2 + r + 0.3, `${name} lies at the ring.`);
    }
    for (const z of zebras) assert(toRect(c.x, c.z, z) >= r + 0.3, `${name} lies on a zebra.`);
    for (const l of stopLines) assert(toRect(c.x, c.z, stopLineRect(l)) >= r + 0.3, `${name} lies on a stop line.`);
    for (const p of signalPosts) assert(Math.hypot(p.x - c.x, p.z - c.z) >= 0.8, `${name} lies beside a signal.`);
    for (const g of gullies) assert(toRect(c.x, c.z, gullyRect(g)) >= r + 0.25, `${name} crowds a gully.`);
    for (const p of roadPatches) assert(toRect(c.x, c.z, patchRect(p)) >= r + 0.1, `${name} lies on a repair patch.`);
  }
  for (const side of [1, -1]) {
    const along = gullies.filter((g) => g.road === 'ring' && Math.sign(g.across) === side).map((g) => g.along).sort((a, b) => a - b);
    assert(along.length >= 10, `Only ${along.length} gullies along the ring's ${side > 0 ? 'inner' : 'outer'} kerb.`);
    along.forEach((s, i) => {
      const gap = (along[(i + 1) % along.length] - s + ringLength) % ringLength;
      assert(gap >= 7.5 && gap <= 11, `Gullies ${gap.toFixed(1)} apart on the ring's ${side > 0 ? 'inner' : 'outer'} kerb.`);
    });
  }
  for (const road of ['south', 'west', 'east'])
    for (const side of [1, -1]) assert(gullies.some((g) => g.road === road && Math.sign(g.across) === side), `The ${road} avenue lacks a gully on one side.`);
  for (const g of gullies) {
    const name = `The gully at ${g.road} ${g.along.toFixed(1)}`,
      rect = gullyRect(g),
      d = g.road === 'ring' ? plan.distanceToPolyline([g.x, g.z], plan.ringLine, true) : plan.distanceToSegment([g.x, g.z], avenueOf(g.road).from, avenueOf(g.road).to);
    // Against the kerb's face (R / 2 out), 0.01 off it.
    assert(Math.abs(d + GULLY.width / 2 - (R / 2 - 0.01)) < 0.01, `${name} is not in the gutter (${d.toFixed(3)} out).`);
    if (g.road === 'ring') for (const rail of rails) assert(plan.distanceToPolyline([g.x, g.z], rail, true) >= 0.035 + GULLY.width / 2 + 0.15, `${name} lies by a rail.`);
    // The ring's inner kerb opens at the avenue mouths (to 1.03 either side of the avenue's line).
    if (g.road === 'ring' && g.across > 0)
      for (const j of signalJunctions) {
        const along = Math.abs((g.x - j.at[0]) * j.t[0] + (g.z - j.at[1]) * j.t[1]);
        assert(along >= R / 2 + 0.18 + GULLY.length / 2 + 0.2 || Math.hypot(g.x - j.at[0], g.z - j.at[1]) > 5, `${name} has no kerb beside it at the ${j.id} mouth.`);
      }
    for (const l of lamps) assert(Math.hypot(l.x - g.x, l.z - g.z) >= 0.8, `${name} lies by ${l.id}'s base.`);
    for (const p of signalPosts) assert(Math.hypot(p.x - g.x, p.z - g.z) >= 0.8, `${name} lies by a signal's base.`);
    const corners = [-1, 1].flatMap((a) => [-1, 1].map((c) => [rect.x + rect.u[0] * a * rect.half[0] + rect.u[1] * c * rect.half[1], rect.z + rect.u[1] * a * rect.half[0] - rect.u[0] * c * rect.half[1]]));
    for (const [x, z] of corners) {
      for (const zb of zebras) assert(toRect(x, z, zb) >= 0.3, `${name} lies on a zebra.`);
      for (const l of stopLines) assert(toRect(x, z, stopLineRect(l)) >= 0.3, `${name} lies on a stop line.`);
      for (const p of roadPatches) assert(toRect(x, z, patchRect(p)) >= 0.05, `${name} lies on a repair patch.`);
    }
  }
  // The repair patches lie on the carriageway of a straight run, clear of the zebras and stop lines.
  assert(roadPatches.length >= 2 && roadPatches.length <= 3, 'Two or three repair patches.');
  for (const p of roadPatches) {
    const [x0, z0, x1, z1] = p.box,
      corners = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]];
    for (const [x, z] of corners) {
      const d = p.road === 'ring' ? plan.distanceToPolyline([x, z], plan.ringLine, true) : plan.distanceToSegment([x, z], avenueOf(p.road).from, avenueOf(p.road).to);
      assert(d <= R / 2 - 0.05, `A repair patch on the ${p.road} leaves the carriageway.`);
      for (const zb of zebras) assert(toRect(x, z, zb) >= 0.3, `A repair patch on the ${p.road} reaches a zebra.`);
      for (const l of stopLines) assert(toRect(x, z, stopLineRect(l)) >= 0.3, `A repair patch on the ${p.road} reaches a stop line.`);
    }
    if (p.road === 'ring') assert(Math.abs(plan.roadSpot('ring', p.along[0], 0).heading - plan.roadSpot('ring', p.along[1], 0).heading) < 1e-9, `A repair patch lies on a corner of the ring.`);
  }
  // One road program draws them all: every road (the airport's too) is one asphalt material, its uv
  // the plan's (across, along).
  const asphalt = [],
    paving = [];
  for (const ground of [model.land, model.airportLand])
    ground.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material.userData.surfaceKind === 'asphalt') asphalt.push(o);
      if (o.material.userData.surfaceKind === 'paving') paving.push(o);
    });
  assert.equal(new Set(asphalt.map((o) => o.material)).size, 1, 'The roads take more than one material.');
  assert.equal(new Set(paving.map((o) => o.material)).size, 1, 'The paving takes more than one material.');
  for (const o of asphalt) {
    const uv = o.geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) assert(Math.abs(uv.getX(i)) <= R / 2 + 1e-4 && uv.getY(i) > -1 && uv.getY(i) < 1000 * plan.ROADS.length, 'An asphalt vertex has no road uv.');
  }
  // The airport's road: its own asphalt, along from 4000 (its place in ROADS) at the lane's start.
  {
    const own = [];
    model.airportLand.traverse((o) => o.isMesh && o.material.userData.surfaceKind === 'asphalt' && own.push(o));
    assert.equal(own.length, 1, 'The airport road is one asphalt mesh.');
    const uv = own[0].geometry.getAttribute('uv'),
      p = own[0].geometry.getAttribute('position'),
      base = 1000 * plan.ROADS.indexOf('airport');
    assert.equal(base, 4000);
    for (let i = 0; i < uv.count; i++) {
      assert(uv.getY(i) >= base - 1e-4 && uv.getY(i) < base + 1000, 'An airport road vertex is off its own road uv.');
      assert(Math.abs(base + plan.AIRPORT_ROAD.lane - p.getZ(i) - uv.getY(i)) < 1e-3, 'The airport road uv does not run along the road.');
    }
  }
  const road = patchedShader(asphalt[0].material).fragmentShader;
  assert(road.includes(`ROAD_COVER[${manholes.length}]`) && road.includes(`ROAD_GULLY[${gullies.length}]`) && road.includes(`ROAD_PATCH[${roadPatches.length}]`) && road.includes(`ROAD_STOP[${stopLines.length}]`), 'The road shader does not draw the plan’s covers, gullies, patches and stop lines.');
  assert(!/uniform\s+\w+\s+ROAD_/.test(road), 'The road details became uniforms (the lamps need the uniform budget).');
}
// The dropped kerbs: at both ends of each zebra the walkers' floor runs from the road over the
// dropped kerb (0.02 up) and the tactile slabs, then up the ramp to the pavement, never stepping
// back down; the built surface is where they walk. Six buff slab tops carry the blisters' uv, flat at
// the dropped height across the ring's inner pavement; the signal standing in a dropped crossing (the
// west junction's ring signal) has its foot on the slabs, not in the air.
{
  const { DROPPED_KERB: D, droppedCrossings } = plan,
    ray = new T.Raycaster(),
    ground = [],
    paving = [];
  model.land.traverse((o) => o.isMesh && ['paving', 'stone', 'asphalt'].includes(o.material.userData.surfaceKind) && ground.push(o));
  model.land.traverse((o) => o.isMesh && o.material.userData.surfaceKind === 'paving' && paving.push(o));
  const surface = (x, z) => {
    ray.set(new T.Vector3(x, 3, z), new T.Vector3(0, -1, 0));
    return ray.intersectObjects(ground, false)[0]?.point.y;
  };
  let tactile = 0;
  for (const d of droppedCrossings) {
    const walk = d.along[1] + plan.ROAD_WIDTH / 2 + 0.09 - 1.62; // the inner walkers' line, 1.62 in from the ring's centre line
    for (const side of [-1, 1]) {
      const at = (c) => [d.from[0] + d.u[0] * walk + d.u[1] * c * side, d.from[1] + d.u[1] * walk - d.u[0] * c * side];
      let last = -Infinity;
      for (let c = 0; c <= D.ramp + 0.3; c += 0.02) {
        const [x, z] = at(c),
          y = plan.walkFloor(x, z) - plan.terrainHeight(x, z);
        assert(y >= last - 1e-9, `The ${d.junction} crossing's floor steps down at ${c.toFixed(2)} out.`);
        last = y;
        if (c > D.kerb + 0.02 && c < D.tactile) assert(Math.abs(y - D.top) < 1e-9, `The ${d.junction} crossing is not dropped at ${c.toFixed(2)} out.`);
        if (c > D.kerb + 0.02) {
          const built = surface(x, z) - plan.terrainHeight(x, z);
          assert(Math.abs(built - y) < 0.012, `At the ${d.junction} crossing, ${c.toFixed(2)} out, the walkers' floor is ${y.toFixed(3)} but the paving ${built.toFixed(3)}.`);
        }
      }
      assert(Math.abs(last - plan.levels.pavement) < 1e-9, `The ${d.junction} crossing's ramp does not reach the pavement.`);
    }
  }
  for (const o of paving) {
    const uv = o.geometry.getAttribute('uv'),
      pos = o.geometry.getAttribute('position');
    for (let i = 0; i < uv.count; i++) {
      if (uv.getX(i) < 500) continue;
      tactile++;
      const x = pos.getX(i),
        z = pos.getZ(i),
        y = pos.getY(i) - plan.terrainHeight(x, z);
      const inside = droppedCrossings.some((d) => {
        const along = (x - d.from[0]) * d.u[0] + (z - d.from[1]) * d.u[1],
          c = Math.abs((x - d.from[0]) * d.u[1] - (z - d.from[1]) * d.u[0]);
        return along > d.along[0] - 1e-4 && along < d.along[1] + 1e-4 && c > D.kerb - 1e-4 && c < D.tactile + 1e-4;
      });
      assert(Math.abs(y - D.top) < 1e-6 && inside, 'A blister slab lies outside the flat of a dropped crossing.');
      assert(uv.getX(i) - 1000 >= -1e-4 && uv.getX(i) - 1000 <= 1.1 && uv.getY(i) >= -1e-4 && uv.getY(i) <= 1.1, 'A blister slab’s uv does not start at its corner.');
    }
  }
  assert.equal(tactile, droppedCrossings.length * 2 * 6, 'Each end of each zebra has one buff blister slab top.');
  for (const p of signalPosts) {
    const floor = plan.pavementTop(p.x, p.z);
    let foot = Infinity;
    model.land.traverse((o) => {
      if (!o.isMesh || o.material.userData.surfaceKind !== 'iron') return;
      const pos = o.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i) - p.x) < 0.11 && Math.abs(pos.getZ(i) - p.z) < 0.11) foot = Math.min(foot, pos.getY(i));
    });
    assert(Math.abs(foot - plan.terrainHeight(p.x, p.z) - floor) < 0.01, `The ${p.junction} ${p.approach} signal's foot is at ${foot.toFixed(3)}, its pavement at ${floor.toFixed(3)}.`);
  }
  assert(signalPosts.some((p) => plan.droppedFloor(p.x, p.z) !== undefined), 'No signal stands in a dropped crossing any more: drop this check’s reason.');
  // The plaza's granite: its rings' joints fall on the pool copings' edges, the setts band lies
  // between the outer coping and the kerb ring.
  const { PLAZA_PAVING: G } = plan,
    { POOL } = await load('town-shared');
  assert(Math.abs(G.coping - (POOL.outer + POOL.coping)) < 1e-9, 'PLAZA_PAVING.coping is not the outer coping’s edge.');
  for (const r of [POOL.inner - POOL.coping, G.coping]) assert(Math.abs(r / G.ring - Math.round(r / G.ring)) < 1e-9, 'The plaza’s rings of flags do not meet the pool copings.');
  assert(G.setts < G.rim && G.setts > G.coping, 'The setts band lies outside the plaza rim or over the copings.');
}
// Surface materiality (city-materials' SURFACE_PATTERN, batch()'s surface coordinates and bake). The
// patterns add no batch and no program: brick and ashlar batch as stone, and every solid shares the
// bake program. Every pattern fades out before its features fall below 2.5 CSS px (only an arris
// bump, inside its pattern's own fade, goes finer). The archive's walls are coursed brick from their
// foot; the homes', the hall's and the gate's walls are ashlar; the homes' roofs are slate, coursed
// up the slope. A wall darkens toward the plinth it stands on but not at its head (the corner bake
// never darkens a whole face).
{
  const { GROUND_KINDS } = await load('city-materials'),
    programs = new Set();
  let solids = 0;
  city.traverse((o) => {
    if (!o.isMesh) return;
    const kind = o.material.userData.surfaceKind;
    assert(kind !== 'brick' && kind !== 'ashlar', `${o.material.name}: brick and ashlar batch with stone`);
    const bake = o.geometry.getAttribute('aBake');
    if (!bake) return;
    assert.equal(bake.itemSize, 4, `${o.material.name}: aBake has ${bake.itemSize} components`);
    if (kind === 'glass' || GROUND_KINDS.has(kind)) return;
    solids++;
    programs.add(o.material.customProgramCacheKey());
    for (let i = 0; i < bake.count; i++) assert(Math.round(bake.getW(i) * 255) <= 10, `${o.material.name}: an unknown surface pattern`);
  });
  assert(solids > 0 && programs.size <= 1, `The batched solids use ${programs.size} programs: ${[...programs].join(', ')}`);
  let fades = 0;
  city.traverse((o) => {
    if (fades || !o.isMesh || o.material.customProgramCacheKey?.() !== 'lius-bake-solid') return;
    for (const [, size, lo] of patchedShader(o.material).fragmentShader.matchAll(/sFade\(([.\d]+),[\w.]+(?:\([^)]*\))?,([.\d]+),[.\d]+\)/g)) {
      fades++;
      assert(Number(lo) >= 2.5 || Number(size) <= 0.03, `A surface pattern of ${size} is drawn down to ${lo} px`);
    }
  });
  assert(fades >= 15, `Only ${fades} surface fades found in the bake shader`);
  const v = new T.Vector3(),
    n = new T.Vector3();
  /** Vertices of `shell`'s batches with pattern `pattern` on the face (normal z > 0.99) at z = `z`. */
  const faceOf = (shell, pattern, z) => {
    const out = [];
    for (const o of shell.children) {
      const bake = o.isMesh && o.geometry.getAttribute('aBake');
      if (!bake) continue;
      const p = o.geometry.getAttribute('position'),
        nn = o.geometry.getAttribute('normal'),
        uv = o.geometry.getAttribute('uv');
      for (let i = 0; i < p.count; i++)
        if (Math.round(bake.getW(i) * 255) === pattern && n.fromBufferAttribute(nn, i).z > 0.99 && Math.abs(v.fromBufferAttribute(p, i).z - z) < 2e-3)
          out.push({ x: v.x, y: v.y, u: uv.getX(i), w: uv.getY(i), corner: bake.getZ(i) });
    }
    return out;
  };
  /** A wall face: darker toward its foot (`foot`), its head (`head`) untouched. */
  const footAndHead = (name, face, foot, head) => {
    const low = face.filter((p) => Math.abs(p.y - foot) < 0.12),
      high = face.filter((p) => Math.abs(p.y - head) < 0.12);
    assert(low.length && high.length, `${name}: no wall face found at ${foot} and ${head}`);
    assert(low.every((p) => p.corner < 0.2), `${name}: the wall does not darken toward its plinth`);
    assert(high.every((p) => p.corner >= 0.35), `${name}: the corner bake darkens the wall's head`);
  };
  {
    const { shell } = models.get('city-archive'),
      { w, d } = plan.sites['city-archive'],
      wall = faceOf(shell, 1, d / 2);
    assert(wall.length >= 4, 'The archive’s front wall is not brick.');
    for (const p of wall) assert(Math.abs(p.w - (p.y - 0.45)) < 1e-3 && Math.abs(p.u - p.x) < 1e-3 && Math.abs(p.x) < w / 2, `The archive’s brick courses do not start at the wall’s foot (${p.x}, ${p.y}).`);
    footAndHead('The archive', wall, 0.57, 3.53);
  }
  for (const id of plan.terraceHomes) {
    const { shell } = models.get(id),
      { d } = plan.sites[id];
    footAndHead(id, faceOf(shell, 2, d / 2), 0.54, 2.9);
    // The slate roofs: coursed up the slope (uv.y grows with height on every flat sloped face; a
    // bevel's corner, where the normal turns within a triangle, fades its pattern out instead).
    let slopes = 0;
    for (const o of shell.children) {
      const bake = o.isMesh && o.geometry.getAttribute('aBake');
      if (!bake) continue;
      const p = o.geometry.getAttribute('position'),
        nn = o.geometry.getAttribute('normal'),
        uv = o.geometry.getAttribute('uv');
      for (let i = 0; i + 2 < p.count; i += 3) {
        if (Math.round(bake.getW(i) * 255) !== 4 || n.fromBufferAttribute(nn, i).y < 0.3 || n.y > 0.95) continue;
        if ([1, 2].some((k) => v.fromBufferAttribute(nn, i + k).dot(n) < 0.999)) continue;
        const ys = [0, 1, 2].map((k) => p.getY(i + k)),
          ws = [0, 1, 2].map((k) => uv.getY(i + k)),
          lo = ys.indexOf(Math.min(...ys)),
          hi = ys.indexOf(Math.max(...ys));
        if (ys[hi] - ys[lo] < 0.05) continue;
        slopes++;
        assert(ws[hi] > ws[lo], `${id}: a slate face is not coursed up its slope`);
      }
    }
    assert(slopes >= 4, `${id}: no slate roof found`);
  }
  footAndHead('The hall', faceOf(models.get('town-hall').shell, 2, 2.3), 0.62, 4.68); // the walls rise to 4.8 under the parapet
  let gate = 0;
  models.get('lius-gate').shell.traverse((o) => {
    const bake = o.isMesh && o.geometry.getAttribute('aBake');
    if (bake) for (let i = 0; i < bake.count; i++) gate += Math.round(bake.getW(i) * 255) === 2;
  });
  assert(gate >= 100, 'The gate is not ashlar.');
}
// The figures (city-people.ts): Clash villagers no taller than 0.91 (under the signal heads), soles
// on y 0 at rest, the head about a third of the height, every look keeping the animation's pivots;
// and the collie keeps its size. No colour on them is more saturated than 0.55 (HSV, sRGB; the
// palette's own clothes were up to 0.77), so they stay muted and generic.
{
  const { createResident, createDog } = await load('city-people'),
    { createCityMaterials } = await load('city-materials'),
    library = createCityMaterials(),
    box = new T.Box3();
  for (let i = 0; i < 9; i++) {
    const r = createResident(i, library.material);
    r.updateMatrixWorld(true);
    box.setFromObject(r);
    // The rider (8) only ever sits, so his helmet may stand a little prouder.
    assert(box.max.y <= (i === 8 ? 0.94 : 0.91) && Math.abs(box.min.y) < 0.004, `Resident ${i} stands from ${box.min.y.toFixed(3)} to ${box.max.y.toFixed(3)}.`);
    assert(Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z) < 0.27, `Resident ${i} is wider than the walkers' clearances allow.`);
    for (const name of ['body', 'leg-left', 'leg-right', 'arm-left', 'arm-right']) assert(r.getObjectByName(name), `Resident ${i} has no ${name}.`);
    for (const name of ['leg-left', 'leg-right']) assert(r.getObjectByName(name).getObjectByName('knee'), `Resident ${i}'s ${name} has no knee.`);
    const skin = r.getObjectByName('body').children.find((m) => m.isMesh && m.material.userData.surfaceKind === 'paint'),
      head = new T.Box3().setFromObject(skin),
      share = (head.max.y - 0.6) / box.max.y;
    assert(share > 0.3 && share < 0.37, `Resident ${i}'s head is ${(share * 100).toFixed(0)}% of the height.`);
    r.traverse((m) => {
      if (!m.isMesh) return;
      const c = m.geometry.getAttribute('color'),
        colour = new T.Color();
      assert(c, `Resident ${i} has a part without colours on its vertices.`);
      for (let k = 0; k < c.count; k += 7) {
        colour.fromBufferAttribute(c, k).convertLinearToSRGB();
        const max = Math.max(colour.r, colour.g, colour.b);
        assert(!max || (max - Math.min(colour.r, colour.g, colour.b)) / max <= 0.55, `Resident ${i} wears a colour louder than the town's (${colour.getHexString()}).`);
      }
    });
  }
  // The collie: its body about 0.33 long, its ears under 0.33 and its paws on the ground, nose to tail under 0.62.
  const dog = createDog(library.material);
  dog.updateMatrixWorld(true);
  box.setFromObject(dog);
  const size = box.getSize(new T.Vector3()),
    trunk = new T.Box3().setFromObject(dog.children.find((m) => m.isMesh && m.castShadow)).getSize(new T.Vector3());
  assert(trunk.z > 0.3 && trunk.z < 0.4 && size.z < 0.62 && box.max.y < 0.33 && Math.abs(box.min.y) < 0.004, `The dog is ${size.toArray().map((v) => v.toFixed(2)).join(' x ')}.`);
}
/**
 * Alison's water (sky-figure's ALISON_STREAM: one tube through rings down its line), as posed now:
 * each ring's place down the line (from the corners' moves off the whole stream, sky-figure's
 * userData.rest, each ring moving as one), and each ring's middle and the tube's corners in the
 * world. Asserts that every ring moves as one, along the line (streamAt).
 */
const herStream = await load('sky-figure');
function alisonStream(water) {
  const { ALISON_STREAM: S, streamAt } = herStream,
    tube = water.children.find((m) => m.isMesh),
    rest = water.userData.rest,
    ring = water.userData.ring,
    q = tube.geometry.attributes.position,
    places = S.rings.map(() => null);
  assert(rest && ring && rest.length === q.count * 3 && ring.length === q.count, 'Her water has no whole stream, or no ring for each of its corners, to move it from.');
  for (let i = 0; i < q.count; i++) {
    const k = ring[i],
      own = S.rings[k],
      place = own - (q.getY(i) - rest[i * 3 + 1]),
      dz = q.getZ(i) - rest[i * 3 + 2];
    if (places[k] === null) places[k] = place;
    assert(Math.abs(places[k] - place) < 1e-6 && Math.abs(q.getX(i) - rest[i * 3]) < 1e-9 && Math.abs(dz - (streamAt(place)[2] - streamAt(own)[2])) < 1e-6, `A ring of her water does not move as one, along its line.`);
  }
  tube.updateMatrixWorld(true);
  return {
    places,
    middles: places.map((d) => new T.Vector3(...streamAt(d)).applyMatrix4(tube.matrixWorld)),
    corners: () => Array.from({ length: q.count }, (_, i) => ({ p: new T.Vector3().fromBufferAttribute(q, i).applyMatrix4(tube.matrixWorld), k: ring[i] })),
  };
}
/** The triangles of what shows of a group's meshes, in the world: 9 numbers each. */
function worldTriangles(group) {
  const out = [],
    v = new T.Vector3();
  group.updateMatrixWorld(true);
  group.traverse((m) => {
    if (!m.isMesh) return;
    for (let o = m; o; o = o.parent) if (!o.visible) return;
    const q = m.geometry.attributes.position,
      index = m.geometry.index,
      n = index ? index.count : q.count;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(q, index ? index.getX(i) : i).applyMatrix4(m.matrixWorld);
      out.push(v.x, v.y, v.z);
    }
  });
  return Float32Array.from(out);
}
/**
 * How many edges of either set of triangles (worldTriangles) pass strictly through a triangle of the
 * other: two surfaces that cross have some; two that only touch, or stand apart, none.
 */
function crossingEdges(X, Y) {
  const box = (tris, i) => {
      const b = new T.Box3();
      for (let k = 0; k < 9; k += 3) b.expandByPoint(new T.Vector3(tris[i + k], tris[i + k + 1], tris[i + k + 2]));
      return b;
    },
    all = (tris) => new T.Box3().setFromArray(tris),
    both = all(X).intersect(all(Y)).expandByScalar(1e-4);
  if (both.isEmpty()) return 0;
  const near = (tris) => {
      const out = [];
      for (let i = 0; i < tris.length; i += 9) if (box(tris, i).intersectsBox(both)) out.push(i);
      return out;
    },
    xs = near(X),
    ys = near(Y),
    a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3(),
    p0 = new T.Vector3(),
    p1 = new T.Vector3(),
    e1 = new T.Vector3(),
    e2 = new T.Vector3(),
    d = new T.Vector3(),
    h = new T.Vector3(),
    s = new T.Vector3(),
    q = new T.Vector3(),
    through = () => {
      // (Moller-Trumbore, the segment p0-p1 strictly inside the triangle abc's plane crossing.)
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      d.subVectors(p1, p0);
      h.crossVectors(d, e2);
      const det = e1.dot(h);
      if (Math.abs(det) < 1e-15) return false;
      s.subVectors(p0, a);
      const u = s.dot(h) / det;
      if (u < 0 || u > 1) return false;
      q.crossVectors(s, e1);
      const w = d.dot(q) / det;
      if (w < 0 || u + w > 1) return false;
      const f = e2.dot(q) / det;
      return f > 0 && f < 1;
    };
  let n = 0;
  for (const [E, es, F, fs] of [[X, xs, Y, ys], [Y, ys, X, xs]])
    for (const i of es)
      for (const [j, k] of [[0, 3], [3, 6], [6, 0]]) {
        p0.fromArray(E, i + j);
        p1.fromArray(E, i + k);
        const seg = new T.Box3().setFromPoints([p0, p1]);
        for (const f of fs) {
          a.fromArray(F, f);
          b.fromArray(F, f + 3);
          c.fromArray(F, f + 6);
          if (Math.max(a.x, b.x, c.x) < seg.min.x || Math.min(a.x, b.x, c.x) > seg.max.x || Math.max(a.y, b.y, c.y) < seg.min.y || Math.min(a.y, b.y, c.y) > seg.max.y || Math.max(a.z, b.z, c.z) < seg.min.z || Math.min(a.z, b.z, c.z) > seg.max.z) continue;
          if (through()) n++;
        }
      }
  return n;
}
// Alison Heppenstall's figure (sky-figure.ts), built on her own. She is the town's one named
// person, so she has a builder and a block of her own, and the residents above stay generic.
// - Build: a resident's pivots (so their walk drives her) and an elbow in each arm; at most 5,000
//   triangles in 15 meshes as built (11 of her and her four hand props: the can, the cup, the
//   saucer and the water she pours), 14 once batched part by part; every mesh in a surface kind, one-sided, opaque and cutting no holes, its colours on its
//   vertices. She stands as tall as a resident (from the shortest walker to the helmeted rider),
//   her soles on y 0, inside the walkers' 0.27.
// - Colour: everything on her stays at or under the figures' 0.55 (HSV, sRGB) BUT HER HAIR, the
//   one named exception to that rule: a ginger that may reach HAIR_SATURATION, 0.70 (her hair is her
//   likeness; held to 0.55 it reads brown, and at F1a's 0.62 it rendered a salmon brown beside the
//   portrait under the town's 0.72 grade). It must be copper to ginger: over 0.55, every shade's hue
//   between 15 and 32 degrees, and its median the portrait's orange, 20 to 28 (F1a's salmon copper
//   is 19).
// - Hair: long, loose locks falling past her shoulders, never again a cluster of small balls (F1a's
//   34 lobes, none over 0.16 long) or a hood. Standing: its pieces (runs of joined faces) of 12
//   triangles or more number 8 to 20, and four fifths of its triangles lie in pieces 0.25 or more
//   long; from in front it is 1.3 to 1.65 times her head's width at her cheeks (F1b-loop's volume
//   pass widened it on purpose from 1.37, beside the portrait's big curly volume: under 1.3 it reads
//   narrow and rope-like, over 1.65 a wig), and no wider below them; behind her it reaches below 0.5, well
//   under her shoulders (0.6), and stops above 0.36 (about mid-back); and from the town camera's
//   height, from in front to 40 degrees either side, a ray at each of her eyes meets her glasses
//   band at the eye, not her hair.
// - Thickness: every joined piece of her props, her glasses and her pendant is 0.07 or more across
//   every way (thinner ones twinkle as the view moves). Her nose is a resident's, a 0.04 bump sunk
//   in her face. Each of her hair's locks is 0.072 or more through as built (sky-figure's line());
//   they run into one another and the crown, so the bits of one that show between others are not
//   pieces of their own.
// - Poses, each over a sweep of phases: nothing non-finite; standing, walking, watering and at the
//   telescope her lower sole is on her floor; seated, her thighs rest on the seat (the park
//   bench's, which ALISON.seat must be, and any other she is given) and her shins hang clear of
//   its front edge; her hands are on what the pose holds (the can's handle; the cup's lug and the
//   saucer's rim; the telescope's grips) and only that pose's props show; a
//   pose depends on nothing but its arguments; a walk of amount 0 is 'stand', and one phase of it
//   is one of the residents' strides. The can's rose stays about ALISON.rose, ahead of her toes,
//   and at the telescope her eye is behind the eyepiece ALISON places, looking down its tube.
//   'take' bends her to the can where it stands and up again with it: her soles stay on her floor,
//   and from the bottom of her stoop on her hand is on its handle.
{
  const { createAlison, poseAlison, alisonHand, ALISON, ALISON_POSES, ALISON_HOLDS, ALISON_TELESCOPE, HAIR_SATURATION } = await load('sky-figure'),
    { createResident, animateResident, HEAD } = await load('city-people'),
    { createProps } = await load('town-props'),
    { createKit } = await load('town-kit'),
    { createCityMaterials } = await load('city-materials'),
    library = createCityMaterials(),
    { root, joints, props } = createAlison(library.material),
    hand = Object.values(props),
    meshes = [],
    v = new T.Vector3(),
    tri = (m) => (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3,
    held = (m) => hand.includes(m.parent),
    label = (m) => `${m.parent.name || 'part'}${m.name ? '/' + m.name : ''}`;
  root.traverse((o) => o.isMesh && meshes.push(o));
  assert.equal(root.name, 'alison');
  assert.equal(meshes.length, 15, `Alison is ${meshes.length} meshes as built.`);
  assert.equal(meshes.filter(held).length, 4, 'Each of her four props is one mesh.');
  const triangles = meshes.reduce((n, m) => n + tri(m), 0);
  assert(triangles <= 5000, `Alison costs ${triangles} triangles.`);
  // Her pivots are the residents', found by name as animateResident finds them.
  assert.equal(root.getObjectByName('body'), joints.body);
  for (const [k, name] of ['left', 'right'].entries()) {
    assert.equal(root.getObjectByName('leg-' + name), joints.legs[k]);
    assert.equal(joints.legs[k].getObjectByName('knee'), joints.knees[k]);
    assert.equal(root.getObjectByName('arm-' + name), joints.arms[k]);
    assert.equal(joints.arms[k].getObjectByName('elbow'), joints.elbows[k]);
  }
  // Batched as town-build batches its figures (each group's own meshes, one batch a kind and a
  // shadow flag, a mesh casting when its longest side is 0.3 or more): 14.
  let batched = 0;
  for (const g of [joints.body, ...joints.legs, ...joints.knees, ...joints.arms, ...joints.elbows, ...hand]) {
    const own = g.children.filter((c) => c.isMesh);
    assert(own.length, `Her ${g.name} has no mesh.`);
    batched += new Set(own.map((m) => {
      m.geometry.computeBoundingBox();
      const s = m.geometry.boundingBox.getSize(v);
      return `${m.material.userData.surfaceKind}|${Math.max(s.x, s.y, s.z) >= 0.3}`;
    })).size;
  }
  assert.equal(batched, 14, `Alison batches into ${batched} meshes.`);
  const saturation = (c) => {
      const max = Math.max(c.r, c.g, c.b);
      return max ? (max - Math.min(c.r, c.g, c.b)) / max : 0;
    },
    colour = new T.Color(),
    hues = [];
  // 0.70, raised from F1a's 0.62 so her hair reads the portrait's ginger after the town's grade.
  assert.equal(HAIR_SATURATION, 0.7, 'Her hair’s exception is 0.70, and no more.');
  for (const m of meshes) {
    const kind = m.material.userData.surfaceKind,
      c = m.geometry.getAttribute('color'),
      hair = m.name === 'alison-hair';
    assert(kind === 'fabric' || kind === 'paint', `Her ${label(m)} is in no surface kind of a figure's (${kind}).`);
    assert(m.material.side === T.FrontSide && !m.material.transparent && m.material.opacity === 1 && !m.material.alphaTest && m.material.depthWrite, `Her ${label(m)} is two-sided, transparent or cut out.`);
    assert(!m.material.onBeforeCompile || !patchedShader(m.material).fragmentShader.includes('discard'), `Her ${label(m)} cuts holes.`);
    assert(c && c.count === m.geometry.getAttribute('position').count, `Her ${label(m)} has no colours on its vertices.`);
    let loudest = 0;
    for (let k = 0; k < c.count; k++) {
      colour.fromBufferAttribute(c, k).convertLinearToSRGB();
      const s = saturation(colour);
      loudest = Math.max(loudest, s);
      // The named exception: her hair, and only her hair, up to HAIR_SATURATION.
      assert(s <= (hair ? HAIR_SATURATION : 0.55) + 1e-4, `Her ${label(m)} wears a colour louder than ${hair ? 'her hair may be' : "the town's figures"} (${colour.getHexString()}, ${s.toFixed(3)}).`);
      if (hair) {
        const hue = (60 * (colour.g - colour.b)) / (colour.r - colour.b);
        assert(colour.r > colour.g && colour.g > colour.b && hue >= 15 && hue <= 32, `Her hair is not copper to ginger (${colour.getHexString()}, hue ${hue.toFixed(0)}).`);
        hues.push(hue);
      }
    }
    if (hair) {
      assert(loudest > 0.55, `Her hair is no louder than a resident's (${loudest.toFixed(3)}): the exception is not needed, or the ginger has gone brown.`);
      const median = hues.sort((a, b) => a - b)[hues.length >> 1];
      assert(median >= 20 && median <= 28, `Her hair's median hue is ${median.toFixed(1)}, not the portrait's orange (20 to 28).`);
    }
  }
  // Each run of joined faces in a mesh, as its box in the mesh's own frame.
  const pieces = (m) => {
    const q = m.geometry.getAttribute('position'),
      index = m.geometry.index,
      at = (i) => (index ? index.getX(i) : i),
      key = (i) => [q.getX(at(i)), q.getY(at(i)), q.getZ(at(i))].map((n) => n.toFixed(4)).join(','),
      n = index ? index.count : q.count,
      parent = new Map(),
      find = (k) => (parent.get(k) === k ? k : (parent.set(k, find(parent.get(k))), parent.get(k)));
    for (let i = 0; i < n; i++) if (!parent.has(key(i))) parent.set(key(i), key(i));
    for (let i = 0; i + 2 < n; i += 3) for (const j of [1, 2]) parent.set(find(key(i + j)), find(key(i)));
    const boxes = new Map(),
      counts = new Map();
    for (let i = 0; i < n; i++) {
      const piece = find(key(i));
      if (!boxes.has(piece)) boxes.set(piece, new T.Box3());
      boxes.get(piece).expandByPoint(v.fromBufferAttribute(q, at(i)));
      counts.set(piece, (counts.get(piece) ?? 0) + 1 / 3);
    }
    return [...boxes].map(([piece, b]) => ({ size: b.getSize(new T.Vector3()), centre: b.getCenter(new T.Vector3()), triangles: Math.round(counts.get(piece)) }));
  };
  const thin = (p) => Math.min(p.size.x, p.size.y, p.size.z) < 0.07 - 1e-3,
    sized = (p) => p.size.toArray().map((n) => n.toFixed(3)).join(' x ');
  for (const m of meshes.filter(held)) for (const p of pieces(m)) assert(!thin(p), `A piece of her ${label(m)} is ${sized(p)}.`);
  // Her face's mesh: the head, the neck, the nose, the glasses and the pendant.
  const face = joints.body.children.find((m) => m.isMesh && m.material.userData.surfaceKind === 'paint'),
    hard = pieces(face),
    slight = hard.filter(thin);
  assert.equal(hard.length, 5, `Her face is ${hard.length} pieces, not her head, neck, nose, glasses and pendant.`);
  assert(slight.length === 1 && Math.abs(slight[0].centre.x) < 0.005 && Math.abs(slight[0].centre.y - 0.727) < 0.01 && slight[0].centre.z > 0.12 && Math.max(slight[0].size.x, slight[0].size.y, slight[0].size.z) < 0.05, `Something on her face other than her nose is under 0.07: ${slight.map(sized).join('; ')}.`);
  const glasses = hard.find((p) => Math.abs(p.centre.y - 0.776) < 0.005 && p.size.x > 0.2),
    pendant = hard.find((p) => p.centre.y < 0.6 && p.centre.z > 0.05 && p.size.x < 0.1);
  assert(glasses && glasses.size.y >= 0.07 && glasses.size.z >= 0.07, 'Her glasses are no longer a band 0.07 tall and deep across her eyes.');
  assert(pendant && !thin(pendant) && Math.max(pendant.size.x, pendant.size.y, pendant.size.z) < 0.1, 'Her pendant is not a small one of 0.07 or more.');
  // Standing: her height, her soles and her width, her props aside.
  const body = meshes.filter((m) => !held(m)),
    pose = (name, phase, opts) => {
      const { lift } = poseAlison(joints, props, name, phase, opts);
      assert(Number.isFinite(lift), `'${name}' at ${phase} lifts her by ${lift}.`);
      root.position.set(0, lift, 0);
      root.updateMatrixWorld(true);
      root.traverse((o) => assert(o.matrixWorld.elements.every(Number.isFinite), `'${name}' at ${phase} leaves her ${o.name || o.type} nowhere.`));
      return lift;
    },
    box = new T.Box3();
  pose('stand', 0);
  for (const m of body) box.expandByObject(m);
  const heights = [];
  for (let i = 0; i < 9; i++) {
    const r = createResident(i, library.material);
    r.updateMatrixWorld(true);
    heights.push(new T.Box3().setFromObject(r).max.y);
  }
  assert(box.max.y >= Math.min(...heights) - 1e-3 && box.max.y <= Math.max(...heights) + 1e-3, `Alison stands ${box.max.y.toFixed(3)} tall, the residents ${Math.min(...heights).toFixed(3)} to ${Math.max(...heights).toFixed(3)}.`);
  assert(Math.abs(box.max.y - ALISON.height) < 0.005, `ALISON.height is ${ALISON.height}, and she stands ${box.max.y.toFixed(3)}.`);
  assert(Math.abs(box.min.y) < 0.004, `Standing, her soles are at ${box.min.y.toFixed(3)}.`);
  assert(Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z) < 0.27, 'Alison is wider than the walkers’ clearances allow.');
  // Her hair's shape, standing (see above): locks, not balls or a hood; its width at her cheeks and
  // below; how far down her back it falls; and her eyes clear of it from the town camera.
  {
    const hair = meshes.find((m) => m.name === 'alison-hair'),
      lumps = pieces(hair).filter((p) => p.triangles >= 12),
      length = (p) => Math.max(p.size.x, p.size.y, p.size.z),
      inLocks = lumps.filter((p) => length(p) >= 0.25).reduce((n, p) => n + p.triangles, 0) / lumps.reduce((n, p) => n + p.triangles, 0);
    assert(lumps.length >= 8 && lumps.length <= 20, `Her hair is ${lumps.length} pieces: locks number 10 to 16, a cluster of balls many more, a hood one.`);
    assert(inLocks >= 0.8, `Only ${(inLocks * 100).toFixed(0)}% of her hair lies in pieces 0.25 or more long: it is balls, not locks.`);
    const q = hair.geometry.getAttribute('position'),
      width = (lo, hi) => {
        let min = Infinity,
          max = -Infinity;
        for (let i = 0; i < q.count; i++) {
          v.fromBufferAttribute(q, i).applyMatrix4(hair.matrixWorld);
          if (v.y >= lo && v.y < hi) {
            min = Math.min(min, v.x);
            max = Math.max(max, v.x);
          }
        }
        return max - min;
      },
      head = 2 * HEAD.r[0],
      cheeks = width(0.68, 0.74);
    assert(cheeks <= 1.65 * head && cheeks >= 1.3 * head, `At her cheeks her hair is ${(cheeks / head).toFixed(2)} times her head's width, not 1.3 to 1.65.`);
    for (const [lo, hi] of [[0.6, 0.68], [0.5, 0.6], [0.4, 0.5]]) assert(width(lo, hi) <= cheeks + 0.005, `Her hair is wider from ${lo} to ${hi} (${width(lo, hi).toFixed(3)}) than at her cheeks (${cheeks.toFixed(3)}).`);
    let back = Infinity;
    for (let i = 0; i < q.count; i++) if (v.fromBufferAttribute(q, i).applyMatrix4(hair.matrixWorld).z < -0.06) back = Math.min(back, v.y);
    assert(back < 0.5 && back > 0.36, `Behind her, her hair reaches down to ${back.toFixed(3)}: not past her shoulders to mid-back.`);
    // Her eyes as drawn on the glasses band: 0.054 either side of the bridge, 0.772 up, just in front of it.
    const ray = new T.Raycaster(),
      rise = Math.atan2(35, 38);
    for (let deg = -40; deg <= 40; deg += 10)
      for (const side of [-1, 1]) {
        const turn = (deg * Math.PI) / 180,
          look = new T.Vector3(-Math.sin(turn) * Math.cos(rise), -Math.sin(rise), -Math.cos(turn) * Math.cos(rise)),
          eye = new T.Vector3(side * 0.054, 0.772, 0.145);
        ray.set(eye.clone().addScaledVector(look, -3), look);
        const first = ray.intersectObjects([hair, face])[0];
        assert(first && first.object === face && first.point.distanceTo(eye) < 0.012, `From ${deg} degrees her ${side < 0 ? 'right' : 'left'} eye is hidden by her hair.`);
      }
  }
  // The seat she sits at is the park bench's: the top of its seat's slats, under its back's.
  const ctx = { library, material: library.material, season: 'summer', land: new T.Group(), lamps: [], clocks: [], animated: [] },
    bench = createProps(ctx, createKit(ctx)).bench(new T.Group(), 0, 0, 0);
  let seatTop = 0,
    seatFront = 0;
  bench.updateMatrixWorld(true);
  bench.traverse((m) => {
    if (!m.isMesh || m.material.userData.surfaceKind !== 'wood') return;
    const q = m.geometry.getAttribute('position');
    for (let i = 0; i < q.count; i++) {
      v.fromBufferAttribute(q, i).applyMatrix4(m.matrixWorld);
      if (v.y > 0.47) continue; // the back's lower slat comes down to 0.50
      seatTop = Math.max(seatTop, v.y);
      seatFront = Math.max(seatFront, v.z);
    }
  });
  assert(Math.abs(ALISON.seat - seatTop) < 1e-3, `ALISON.seat is ${ALISON.seat}, the park bench's seat ${seatTop.toFixed(3)}.`);
  assert(seatFront > 0.2 && ALISON.setback > 0 && ALISON.setback < seatFront, `She cannot sit ${ALISON.setback} back on a seat that reaches ${seatFront.toFixed(3)} forward.`);
  const lowest = (list) => {
      let low = Infinity;
      for (const m of list) {
        const q = m.geometry.getAttribute('position');
        for (let i = 0; i < q.count; i++) low = Math.min(low, v.fromBufferAttribute(q, i).applyMatrix4(m.matrixWorld).y);
      }
      return low;
    },
    own = (g) => g.children.filter((c) => c.isMesh),
    shoes = joints.knees.map((k) => own(k)[0]),
    thighs = joints.legs.map((l) => own(l)[0]),
    snapshot = () => [joints.body, ...joints.legs, ...joints.knees, ...joints.arms, ...joints.elbows, ...hand].flatMap((o) => [...o.matrixWorld.elements, o.visible ? 1 : 0]),
    same = (a, b) => a.every((n, i) => Math.abs(n - b[i]) < 1e-12),
    grip = (prop, at) => v.set(...at).applyMatrix4(prop.matrixWorld).clone(),
    palm = [new T.Vector3(), new T.Vector3()],
    shows = { water: ['can', 'water'], sip: ['cup', 'saucer'], set: ['cup', 'saucer'], take: ['can'] },
    phases = [...Array.from({ length: 25 }, (_, s) => s / 24), -0.25, 7.6];
  assert.deepEqual([...ALISON_POSES], ['stand', 'walk', 'water', 'sit', 'sip', 'telescope', 'rise', 'set', 'take']);
  for (const name of ALISON_POSES)
    for (const seat of name === 'sit' || name === 'sip' || name === 'set' || name === 'rise' ? [undefined, 0.38] : [undefined])
      for (const phase of phases) {
        const at = `'${name}' at ${phase}`,
          opts = seat ? { seat } : {},
          lift = pose(name, phase, opts),
          first = snapshot();
        for (const [prop, g] of Object.entries(props)) assert.equal(g.visible, (shows[name] ?? []).includes(prop), `${at}: her ${prop} ${g.visible ? 'shows' : 'is hidden'}.`);
        if (name === 'sit' || name === 'sip' || name === 'set') {
          const top = seat ?? ALISON.seat;
          assert(Math.abs(lowest(thighs) - top) < 2e-3, `${at}: her thighs rest ${lowest(thighs).toFixed(3)} up, the seat is ${top}.`);
          // Her shins and shoes hang in front of the seat's front edge, ALISON.setback ahead of her root.
          for (const m of shoes) {
            const q = m.geometry.getAttribute('position');
            for (let i = 0; i < q.count; i++) {
              v.fromBufferAttribute(q, i).applyMatrix4(m.matrixWorld);
              assert(v.y > top - 1e-3 || v.z > ALISON.setback, `${at}: her shin is in the seat at ${v.y.toFixed(3)} up, ${v.z.toFixed(3)} forward.`);
            }
          }
          assert(lift > 0 && lowest(shoes) > 0.02, `${at}: her soles are in her floor.`);
        } else if (name !== 'rise') {
          const low = shoes.map((m) => lowest([m]));
          assert(Math.abs(Math.min(...low)) < 4e-3, `${at}: her lower sole is ${Math.min(...low).toFixed(4)} off her floor.`);
        }
        for (const k of [0, 1]) alisonHand(joints, k, palm[k]).applyMatrix4(root.matrixWorld);
        const holds =
          name === 'water' ? [grip(props.can, ALISON_HOLDS.can), null]
          : name === 'sip' ? [grip(props.cup, ALISON_HOLDS.cup), grip(props.saucer, ALISON_HOLDS.saucer)]
          : name === 'telescope' ? ALISON_TELESCOPE.grips.map((c) => new T.Vector3(...c).applyMatrix4(root.matrixWorld))
          : name === 'take' && T.MathUtils.clamp(phase, 0, 1) >= 0.42 ? [grip(props.can, ALISON_HOLDS.can), null]
          : [null, null];
        holds.forEach((h, k) => h && assert(palm[k].distanceTo(h) < 2e-3, `${at}: her hand ${k} is ${palm[k].distanceTo(h).toFixed(3)} off what it holds.`));
        // The same arguments give the same pose, whatever she did in between.
        pose(name === 'walk' ? 'sip' : 'walk', 0.37);
        pose(name, phase, opts);
        assert(same(first, snapshot()), `${at} depends on the pose before it.`);
      }
  // A walk loops, a walk of amount 0 is 'stand', and one phase is one of the residents' strides.
  pose('walk', 0);
  const start = snapshot();
  pose('walk', 1);
  assert(same(start, snapshot()), 'Her walk does not loop.');
  pose('stand', 0);
  const still = snapshot();
  pose('walk', 0.3, { amount: 0 });
  assert(same(still, snapshot()), 'A walk of amount 0 is not her standing.');
  const walker = createResident(0, library.material);
  walker.userData.gait = { phase: 0, amount: 1 };
  animateResident(walker, ALISON.stride, 0.1, false);
  assert(Math.abs(walker.userData.gait.phase - Math.PI * 2) < 1e-9, `ALISON.stride (${ALISON.stride}) is not one of the residents' strides.`);
  // Watering: the can's far end, its rose, is where ALISON.rose says, ahead of her toes; nothing
  // of the can hangs under 0.38 (the town's flower beds mound to 0.37), and the rose sways about
  // ALISON.rose, gently.
  const toes = (pose('stand', 0), Math.max(...shoes.map((m) => new T.Box3().setFromObject(m).max.z)));
  assert(ALISON.rose[2] > toes + 0.2 && ALISON.rose[1] > 0.4 && ALISON.rose[1] < 0.6, `The can's rose is at ${ALISON.rose.map((n) => n.toFixed(3))}.`);
  const can = own(props.can)[0],
    rose = new T.Vector3(...ALISON.rose),
    tip = (phase) => {
      pose('water', phase);
      // The rose: the middle of the can's vertices within 0.06 of its far end, along its length.
      const q = can.geometry.getAttribute('position'),
        mid = new T.Vector3();
      let far = -Infinity,
        n = 0;
      for (let i = 0; i < q.count; i++) far = Math.max(far, q.getZ(i));
      for (let i = 0; i < q.count; i++)
        if (q.getZ(i) > far - 0.06) {
          mid.add(v.fromBufferAttribute(q, i));
          n++;
        }
      return mid.divideScalar(n).applyMatrix4(can.matrixWorld);
    };
  assert(tip(0).distanceTo(rose) < 0.03, `ALISON.rose is ${tip(0).distanceTo(rose).toFixed(3)} from the can's rose.`);
  let sway = 0;
  for (let s = 0; s < 24; s++) {
    const d = tip(s / 24).distanceTo(rose);
    assert(d < 0.08, `The can's rose swings ${d.toFixed(3)} from ALISON.rose.`);
    assert(lowest([can]) >= 0.38, `The can hangs down to ${lowest([can]).toFixed(3)}.`);
    sway = Math.max(sway, d);
  }
  assert(sway > 0.015, 'The can does not sway.');
  // At the telescope: her eye where ALISON_TELESCOPE has it, 0.05 to 0.08 behind the eyepiece
  // and on its axis; the eyepiece where ALISON says, in front of her and no higher than her head.
  pose('telescope', 0);
  const S = ALISON_TELESCOPE,
    eye = new T.Vector3(0, 0.772, 0.137).applyMatrix4(joints.body.matrixWorld).sub(root.position),
    gaze = new T.Vector3(...S.gaze),
    back = new T.Vector3(...S.eyepiece).sub(eye);
  assert(eye.distanceTo(new T.Vector3(...S.eye)) < 1e-3, 'At the telescope her eye is not where ALISON_TELESCOPE has it.');
  assert(Math.abs(gaze.length() - 1) < 1e-9 && gaze.y < -0.1 && gaze.y > -0.45 && gaze.z > 0, `She looks ${S.gaze.map((n) => n.toFixed(3))} down the telescope.`);
  assert(back.length() > 0.05 && back.length() < 0.08 && back.clone().normalize().dot(gaze) > 0.999, 'The eyepiece is not on her line of sight, a little in front of her eye.');
  assert(ALISON.eyepiece === S.eyepiece[1] && ALISON.standOff === S.eyepiece[2] && S.eyepiece[0] === 0, 'ALISON’s eyepiece is not ALISON_TELESCOPE’s.');
  assert(ALISON.eyepiece > 0.6 && ALISON.eyepiece < ALISON.height - 0.15 && ALISON.standOff > toes + 0.1 && ALISON.standOff < 0.45, `The eyepiece is ${ALISON.eyepiece.toFixed(3)} up and ${ALISON.standOff.toFixed(3)} out.`);
  for (const g of S.grips) {
    // Each hand's middle: its own radius and the tube's off the axis, at the tube's eyepiece end.
    const off = new T.Vector3(...g).sub(new T.Vector3(...S.eyepiece));
    assert(Math.abs(off.clone().cross(gaze).length() - (S.radius + 0.043)) < 0.01 && off.dot(gaze) > -0.02 && off.dot(gaze) < 0.2, 'Her hands are not on the telescope’s tube.');
  }
  pose('stand', 0);
}
// Alison getting up and sitting down, setting her cup down, the water she pours and her back curls
// (the art review's seventh and eighth findings), on her own build (lane F's block above holds the
// rest of her):
// - 'rise' runs from 'sit' at phase 0 to 'stand' at 1, joint for joint and prop for prop, its lift
//   from the seat's down to none, her soles never under her floor; 'set' runs from 'sip' at rest (0)
//   to 'sit' with her cup and saucer on the table (1), the saucer carried from where she holds it to
//   drink to ALISON_TABLE's place on the table's top, her +x hand on its near rim (from a little over
//   it as it comes down) while it does, the cup in the saucer's well all the way; neither moves a
//   joint or a prop more than 0.03 in a sixtieth of a second of its 0.8 to 0.9 (SKY_TEA's up and
//   down);
// - set down (`rest`), her cup and saucer show where `rest` says in every pose that does not hold them;
// - the water shows in 'water' only (lane F's visibility sweep above): one tube (the final review's
//   third finding: at the town's closest four beads read as a chain of beads), 36 to 48 triangles on
//   the 'paint' of her props, closed (each of its edges on two faces), every ring of it 0.07 or more
//   across its flats, narrowing ring by ring from the rose down, bowing ahead (not a straight rod) and
//   paler at its top; from inside the can's rose (its top ring's middle within the rose's flare), each
//   ring lower than the last and ahead of it, the lowest 0.15 or more under the rose; nothing of the
//   can hangs under 0.45 (the town's flower bed mounds to 0.37), so the water shows between them;
// - her hair: what shows of it in front of the middle of her head is as it was (a fingerprint of its
//   vertices and colours there: her face's framing is her likeness), and each of the four locks down her
//   back winds across the mass as it falls (0.15 or more of travel from side to side beyond its own
//   drift, changing way twice or more: an S, where at 0.10 to 0.12 they read as a mop's strands).
{
  const { createAlison, poseAlison, alisonHand, ALISON, ALISON_HOLDS, ALISON_TABLE, ALISON_STREAM, hairLockLines } = await load('sky-figure'),
    { createCityMaterials } = await load('city-materials'),
    { root, joints, props } = createAlison(createCityMaterials().material),
    v = new T.Vector3(),
    pose = (name, phase, opts) => {
      const { lift } = poseAlison(joints, props, name, phase, opts);
      root.position.set(0, lift, 0);
      root.updateMatrixWorld(true);
      return lift;
    },
    parts = [joints.body, ...joints.legs, ...joints.knees, ...joints.arms, ...joints.elbows, ...Object.values(props)],
    snapshot = () => parts.flatMap((o) => [...o.matrixWorld.elements, o.visible ? 1 : 0]),
    same = (a, b, eps = 1e-9) => a.every((n, i) => Math.abs(n - b[i]) < eps),
    // How far the furthest point of any joint or prop moved between two snapshots (each part's own corners).
    corners = () => parts.flatMap((o) => (o.visible ? [[-0.1, -0.1, -0.1], [0.1, 0.1, 0.1], [0, -0.2, 0]].map((c) => v.set(...c).applyMatrix4(o.matrixWorld).clone()) : [null, null, null])),
    jump = (a, b) => Math.max(...a.map((p, i) => (p && b[i] ? p.distanceTo(b[i]) : 0))),
    lowestSole = () => {
      let low = Infinity;
      for (const k of joints.knees)
        k.traverse((m) => {
          if (!m.isMesh) return;
          const q = m.geometry.attributes.position;
          for (let i = 0; i < q.count; i++) low = Math.min(low, v.fromBufferAttribute(q, i).applyMatrix4(m.matrixWorld).y);
        });
      return low;
    },
    grip = (prop, at) => new T.Vector3(...at).applyMatrix4(prop.matrixWorld),
    seats = [undefined, 0.38, 0.4504];
  for (const seat of seats) {
    const opts = seat ? { seat } : {};
    // 'rise': from 'sit' to 'stand'.
    pose('sit', 0, opts);
    const sitting = snapshot();
    const sitLift = root.position.y;
    pose('stand', 0);
    const standing = snapshot();
    pose('rise', 0, opts);
    assert(same(snapshot(), sitting) && Math.abs(root.position.y - sitLift) < 1e-12, `'rise' at 0 is not 'sit' (seat ${seat}).`);
    pose('rise', 1, opts);
    assert(same(snapshot(), standing) && Math.abs(root.position.y) < 1e-12, `'rise' at 1 is not 'stand' (seat ${seat}).`);
    // A sixtieth of a second of a 0.9 s rise at a time.
    let last = (pose('rise', 0, opts), corners()),
      worstJump = 0,
      lowest = Infinity;
    for (let k = 1; k <= 54; k++) {
      pose('rise', k / 54, opts);
      const now = corners();
      worstJump = Math.max(worstJump, jump(last, now));
      lowest = Math.min(lowest, lowestSole());
      last = now;
    }
    assert(worstJump <= 0.03 && lowest > -2e-3, `Getting up (seat ${seat}) a joint jumps ${worstJump.toFixed(3)} in a sixtieth of a second, or her sole goes ${lowest.toFixed(4)} under her floor.`);
    // 'set': from 'sip' at rest to 'sit' with the cup and saucer on the table.
    pose('sip', 0, opts);
    const sipping = snapshot();
    pose('set', 0, opts);
    assert(same(snapshot(), sipping), `'set' at 0 is not 'sip' at rest (seat ${seat}).`);
    const top = (seat ?? ALISON.seat) + ALISON_TABLE.up,
      rest = [ALISON_TABLE.x, top, ALISON_TABLE.z, 0];
    pose('sit', 0, { ...opts, rest });
    const setDown = snapshot();
    pose('set', 1, opts);
    assert(same(snapshot(), setDown), `'set' at 1 is not 'sit' with her cup and saucer on the table (seat ${seat}).`);
    last = (pose('set', 0, opts), corners());
    worstJump = 0;
    let rimWorst = 0,
      wellWorst = 0;
    for (let k = 1; k <= 48; k++) {
      const p = k / 48;
      pose('set', p, opts);
      const now = corners();
      worstJump = Math.max(worstJump, jump(last, now));
      last = now;
      wellWorst = Math.max(wellWorst, grip(props.cup, [0.058, -0.037, 0]).distanceTo(grip(props.saucer, [0, 0.036, 0])));
      if (p <= 0.6) {
        // Her +x hand on the saucer's near rim, from up to 0.035 over it.
        const hand = alisonHand(joints, 1).applyMatrix4(root.matrixWorld),
          rim = grip(props.saucer, ALISON_HOLDS.saucer),
          up = hand.y - rim.y;
        rimWorst = Math.max(rimWorst, Math.hypot(hand.x - rim.x, hand.z - rim.z), up < -1e-3 || up > 0.036 ? Infinity : 0);
      }
    }
    const foot = grip(props.saucer, [0, 0, 0]);
    assert(worstJump <= 0.03 && rimWorst < 2e-3 && wellWorst < 5e-3, `Setting her cup down (seat ${seat}) a joint jumps ${worstJump.toFixed(3)} in a sixtieth of a second, her hand is ${rimWorst.toFixed(3)} off the saucer's rim, or the cup ${wellWorst.toFixed(3)} off its well.`);
    assert(Math.abs(foot.x - ALISON_TABLE.x) < 1e-9 && Math.abs(foot.y - top) < 1e-9 && Math.abs(foot.z - ALISON_TABLE.z) < 1e-9, `Set down, the saucer stands at ${foot.toArray().map((n) => n.toFixed(3)).join(', ')}, not on the table's top at ALISON_TABLE's place.`);
  }
  // Set down, they stay where `rest` puts them, whatever she does.
  for (const [name, phase] of [['stand', 0], ['walk', 0.3], ['water', 0.4], ['telescope', 0], ['sit', 0], ['rise', 0.5]]) {
    const rest = [0.41, 0.66, -0.23, 0.7];
    pose(name, phase, { rest });
    const foot = grip(props.saucer, [0, 0, 0]),
      turn = new T.Euler().setFromQuaternion(props.saucer.getWorldQuaternion(new T.Quaternion()), 'YXZ').y;
    assert(props.cup.visible && props.saucer.visible && Math.abs(foot.x - rest[0]) < 1e-9 && Math.abs(foot.y - rest[1]) < 1e-9 && Math.abs(foot.z - rest[2]) < 1e-9 && Math.abs(turn - rest[3]) < 1e-9, `In '${name}' her set-down cup and saucer are not where \`rest\` puts them.`);
    assert(grip(props.cup, [0.058, -0.037, 0]).distanceTo(grip(props.saucer, [0, 0.036, 0])) < 5e-3, `In '${name}' her set-down cup is off its saucer's well.`);
  }
  // The water: one closed tube, narrowing from the rose, bowed, paler at its top (as built: the
  // whole stream, its rest).
  {
    const tube = props.water.children.find((m) => m.isMesh),
      rest = props.water.userData.rest,
      ring = props.water.userData.ring,
      c = tube.geometry.attributes.color,
      n = rest.length / 3,
      at = (i) => new T.Vector3(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]),
      key = (i) => [rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]].map((x) => x.toFixed(5)).join(','),
      edges = new Map();
    assert(props.water.children.filter((m) => m.isMesh).length === 1 && tube.material.userData.surfaceKind === 'paint' && n / 3 >= 36 && n / 3 <= 48, `Her water is not one tube of 36 to 48 triangles on her props' paint (${n / 3}).`);
    for (let i = 0; i < n; i += 3)
      for (const [a, b] of [[i, i + 1], [i + 1, i + 2], [i + 2, i]]) {
        const e = [key(a), key(b)].sort().join('|');
        edges.set(e, (edges.get(e) ?? 0) + 1);
      }
    assert([...edges.values()].every((k) => k === 2), 'Her water is not a closed tube: an edge of it is on one face only, or on three.');
    // Each ring's corners (off the line: the round ends' points lie on it), its middle on the line,
    // its radius and its flats (twice the way from its middle to the middle of each of its sides).
    const rings = ALISON_STREAM.rings.map((d, k) => {
      const pts = new Map();
      for (let i = 0; i < n; i++) if (ring[i] === k && Math.abs(rest[i * 3]) > 0.01) pts.set(key(i), at(i));
      const mid = new T.Vector3(...herStream.streamAt(d)),
        corners = [...pts.values()],
        radius = corners.reduce((sum, p) => sum + p.distanceTo(mid), 0) / corners.length;
      let flats = Infinity;
      for (const a of corners) {
        const b = corners.filter((p) => p !== a).sort((p, q) => p.distanceTo(a) - q.distanceTo(a))[0];
        flats = Math.min(flats, 2 * a.clone().add(b).multiplyScalar(0.5).distanceTo(mid));
      }
      return { mid, corners, radius, flats };
    });
    const shade = (k) => {
        let count = 0,
          sum = 0;
        for (let i = 0; i < n; i++)
          if (ring[i] === k) {
            sum += c.getX(i) + c.getY(i) + c.getZ(i);
            count++;
          }
        return sum / count;
      },
      chord = rings.at(-1).mid.clone().sub(rings[0].mid).normalize(),
      bowed = Math.max(...rings.slice(1, -1).map((r) => {
        const o = r.mid.clone().sub(rings[0].mid);
        return o.sub(chord.clone().multiplyScalar(o.dot(chord))).length();
      }));
    assert(rings.every((r) => r.corners.length === ALISON_STREAM.sides && r.flats >= 0.07 - 1e-4), `A ring of her water is under 0.07 across its flats (${rings.map((r) => r.flats.toFixed(4)).join(', ')}).`);
    assert(rings.every((r, k) => !k || r.radius < rings[k - 1].radius - 1e-4), `Her water does not narrow from the rose down (${rings.map((r) => r.radius.toFixed(4)).join(', ')}).`);
    assert(bowed >= 0.01, `Her water runs straight as a rod (it bows ${bowed.toFixed(4)} off the line from its top to its foot).`);
    assert(shade(0) > shade(ALISON_STREAM.rings.length - 1) * 1.05, 'Her water is not paler at its top.');
  }
  let canLow = Infinity,
    streamWorst = Infinity;
  for (let s = 0; s < 24; s++) {
    pose('water', s / 24);
    props.can.traverse((m) => {
      if (!m.isMesh) return;
      const q = m.geometry.attributes.position;
      for (let i = 0; i < q.count; i++) canLow = Math.min(canLow, v.fromBufferAttribute(q, i).applyMatrix4(m.matrixWorld).y);
    });
    const centres = alisonStream(props.water).middles,
      // The rose's middle (the can's far end) and the spout's way into it.
      rose = grip(props.can, [0, 0.004, 0.141 + 0.195]),
      spout = grip(props.can, [0, -0.012, 0.141 + 0.165]),
      axis = rose.clone().sub(spout).normalize(),
      first = centres[0].clone().sub(rose),
      ahead = (a, b) => (b.x - a.x) * axis.x + (b.z - a.z) * axis.z;
    // The top ring's middle inside the rose's flare (behind its mouth, within 0.03 of its axis), then each lower and further on.
    const along = first.dot(axis),
      off = first.clone().addScaledVector(axis, -along).length();
    let ok = along < 0 && along > -0.06 && off < 0.03;
    for (let k = 1; k < centres.length; k++) ok &&= centres[k].y < centres[k - 1].y - 0.05 && ahead(centres[k - 1], centres[k]) > 0;
    assert(ok, `At phase ${(s / 24).toFixed(2)} the water does not fall from inside the can's rose, ring by ring.`);
    streamWorst = Math.min(streamWorst, rose.y - centres.at(-1).y);
  }
  assert(canLow >= 0.45 && streamWorst >= 0.15, `Watering, the can hangs down to ${canLow.toFixed(3)} and the water falls only ${streamWorst.toFixed(3)} under its rose.`);
  // Her hair: the front as it was, the back locks winding.
  pose('stand', 0);
  {
    const hair = root.getObjectByName('alison-hair'),
      q = hair.geometry.attributes.position,
      c = hair.geometry.attributes.color;
    let n = 0,
      sum = 0,
      colour = 0;
    for (let i = 0; i < q.count; i++) {
      v.fromBufferAttribute(q, i).applyMatrix4(hair.matrixWorld);
      if (v.z < -0.05) continue;
      n++;
      sum += v.x + 3 * v.y + 7 * v.z;
      colour += c.getX(i) + 2 * c.getY(i) + 3 * c.getZ(i);
    }
    assert(n === 2728 && Math.abs(sum - 6869.207366) < 1e-4 && Math.abs(colour - 1925.417713) < 1e-4, `The front of her hair has changed (${n} corners, ${sum.toFixed(6)}, ${colour.toFixed(6)}): the hair that frames her face is her likeness.`);
    const lines = hairLockLines();
    assert.equal(lines.length, 10, 'Her hair is no longer ten locks.');
    for (const k of [6, 7, 8, 9]) {
      // Across the mass (x), down the lock's spine (its curl at the tip, the last four points, aside):
      // how far it travels from side to side beyond its own drift, and how often it changes way.
      const p = lines[k].slice(0, -4);
      let travel = 0,
        ways = 0,
        before = 0;
      for (let i = 1; i < p.length; i++) {
        const d = p[i][0] - p[i - 1][0];
        travel += Math.abs(d);
        if (Math.abs(d) > 1e-4) {
          if (before && Math.sign(d) !== Math.sign(before)) ways++;
          before = d;
        }
      }
      travel -= Math.abs(p.at(-1)[0] - p[0][0]);
      assert(travel >= 0.15 && ways >= 2, `The lock ${k} down her back travels only ${travel.toFixed(3)} from side to side (${ways} changes of way): it hangs like a mop's strand, not a curl.`);
    }
  }
}
// Alison's can and her look through the telescope, as she takes them up and leaves them (lane C2b:
// the six moments of her day that were one-frame switches, the can and its water at each border's
// start and end and her stoop at the telescope), on her own build:
// - each pose's ends are the poses either side of it, exactly: 'take' at 0 is 'stand' with the can
//   standing where `can` says, and at 1 'stand' carrying it; 'water' with `lift`, `pour` and `front`
//   at 0 is 'stand' carrying it; 'telescope' at `stoop` 0 is 'stand' (carrying the can, with
//   `carry`); a walk of no gait carrying the can is 'stand' carrying it;
// - carrying it (standing and through a stride), its handle is in her -x hand, it is level, and it
//   keeps 0.02 or more from her legs;
// - the can's tubes (its handle and its spout) face out the way their normals do (drawn one-sided,
//   an inward tube shows its far wall and lets what is inside it show through);
// - the water: shown only while some of it is out of the rose (`front` over 0) and not all of it
//   down in the bed (`tail` under 1); its tube's rings each move as one, along its line; its top ring
//   never moves as the stream comes; coming, the rings go down the line in order, the lowest one with
//   the front (gathering pace: its first step a tenth of an even one's) and none past its own place,
//   all of them at their places at the front's full length; going, the rings keep their order, the
//   top one leaves first and none is above the tail, all of them at the end `sink` past the last
//   ring's place; and a small change of either moves no ring more than in proportion.
{
  const { createAlison, poseAlison, alisonHand, ALISON_HOLDS, ALISON_STREAM, ALISON_KERB } = await load('sky-figure'),
    { createCityMaterials } = await load('city-materials'),
    { root, joints, props } = createAlison(createCityMaterials().material),
    v = new T.Vector3(),
    parts = [joints.body, ...joints.legs, ...joints.knees, ...joints.arms, ...joints.elbows, ...Object.values(props)],
    pose = (name, phase, opts = {}) => {
      const { lift } = poseAlison(joints, props, name, phase, opts);
      root.position.set(0, lift, 0);
      root.updateMatrixWorld(true);
      return lift;
    },
    snapshot = () => parts.flatMap((o) => [...o.matrixWorld.elements, o.visible ? 1 : 0]),
    same = (a, b, eps = 1e-9) => a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) < eps),
    grip = (prop, at) => new T.Vector3(...at).applyMatrix4(prop.matrixWorld),
    can = ALISON_KERB;
  pose('stand', 0, { can });
  const standing = snapshot();
  pose('take', 0, { can });
  assert(same(snapshot(), standing), "'take' at 0 is not 'stand' with the can where it stands.");
  pose('stand', 0, { carry: true });
  const carrying = snapshot();
  for (const end of [
    { what: "'take' at 1", name: 'take', phase: 1, opts: { can } },
    { what: "'water' brought down (lift, pour and front 0)", name: 'water', phase: 0.37, opts: { lift: 0, pour: 0, front: 0 } },
    { what: "'telescope' at stoop 0 carrying the can", name: 'telescope', phase: 0, opts: { stoop: 0, carry: true } },
    { what: 'a walk of no gait carrying the can', name: 'walk', phase: 0.3, opts: { amount: 0, carry: true } },
  ]) {
    pose(end.name, end.phase, end.opts);
    assert(same(snapshot(), carrying), `${end.what} is not 'stand' carrying the can.`);
  }
  pose('stand', 0);
  const free = snapshot();
  pose('telescope', 0, { stoop: 0 });
  assert(same(snapshot(), free), "'telescope' at stoop 0 is not 'stand'.");
  // Carrying: in her hand, level, clear of her legs (each leg a capsule from its hip through its
  // knee to its shoe's middle, 0.065 thick at the thigh and 0.055 at the shin).
  const segment = (p, a, b) => {
      const ab = b.clone().sub(a),
        t = T.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
      return { d: p.distanceTo(a.clone().addScaledVector(ab, t)), t };
    },
    canMesh = props.can.children.find((m) => m.isMesh);
  let legGap = Infinity,
    handGap = 0,
    tilt = 0;
  for (let s = 0; s <= 24; s++) {
    if (s < 24) pose('walk', s / 24, { carry: true });
    else pose('stand', 0, { carry: true });
    handGap = Math.max(handGap, alisonHand(joints, 0).applyMatrix4(root.matrixWorld).distanceTo(grip(props.can, ALISON_HOLDS.can)));
    tilt = Math.max(tilt, 1 - new T.Vector3(0, 1, 0).applyQuaternion(props.can.getWorldQuaternion(new T.Quaternion())).y);
    const legs = joints.legs.map((leg, k) => [leg.getWorldPosition(new T.Vector3()), joints.knees[k].getWorldPosition(new T.Vector3()), new T.Vector3(0, -0.135, 0.025).applyMatrix4(joints.knees[k].matrixWorld)]),
      q = canMesh.geometry.attributes.position;
    for (let i = 0; i < q.count; i++) {
      v.fromBufferAttribute(q, i).applyMatrix4(canMesh.matrixWorld);
      for (const [hip, knee, shoe] of legs) legGap = Math.min(legGap, segment(v, hip, knee).d - 0.065, segment(v, knee, shoe).d - 0.055);
    }
  }
  assert(handGap < 2e-3 && tilt < 1e-9 && legGap >= 0.02, `Carrying the can, her hand is ${handGap.toFixed(4)} off its handle, it tips ${tilt.toExponential(1)}, or it comes ${legGap.toFixed(3)} from her leg.`);
  // The can's tubes face out.
  {
    const q = canMesh.geometry.attributes.position,
      n = canMesh.geometry.attributes.normal,
      a = new T.Vector3(),
      b = new T.Vector3(),
      c = new T.Vector3();
    let inward = 0;
    for (let i = 0; i < q.count; i += 3) {
      a.fromBufferAttribute(q, i);
      b.fromBufferAttribute(q, i + 1);
      c.fromBufferAttribute(q, i + 2);
      const face = b.clone().sub(a).cross(c.clone().sub(a));
      if (face.lengthSq() < 1e-14) continue;
      const normal = new T.Vector3().fromBufferAttribute(n, i).add(v.fromBufferAttribute(n, i + 1)).add(new T.Vector3().fromBufferAttribute(n, i + 2));
      if (face.dot(normal) < 0) inward++;
    }
    assert.equal(inward, 0, `${inward} faces of her can face inward.`);
  }
  // The water, as its front comes down and its tail goes after it (in her frame, along its own line).
  const S = ALISON_STREAM,
    last = S.rings.at(-1),
    // Each ring's place down the line from where the top one sits when the stream is whole (each
    // ring moving as one, along the line).
    along = () => alisonStream(props.water).places;
  let moved = 0;
  for (const [front, tail] of [[0, 0], [1, 1], [0.6, 1]]) {
    pose('water', 0.2, { front, tail });
    assert(!props.water.visible, `The water shows at front ${front} and tail ${tail}.`);
  }
  let before = null;
  for (let k = 1; k <= 40; k++) {
    const front = k / 40;
    pose('water', 0.2, { front, tail: 0 });
    const at = along();
    assert(props.water.visible && Math.abs(at[0]) < 1e-6 && at.every((d, i) => d <= S.rings[i] + 1e-6 && (!i || d >= at[i - 1] - 1e-6)) && at.at(-1) > (before ? before.at(-1) : 0), `Coming (front ${front}), the rings are at ${at.map((d) => d.toFixed(3)).join(', ')} down the line.`);
    if (before) moved = Math.max(moved, ...at.map((d, i) => Math.abs(d - before[i])));
    // Its first steps are short: the stream gathers pace, so its first frames stay in the rose.
    if (k === 1) assert(at.at(-1) < (last / 40) * 0.1, `The water's front comes ${at.at(-1).toFixed(4)} out at once.`);
    before = at;
  }
  assert(before.every((d, i) => Math.abs(d - S.rings[i]) < 1e-6), 'The whole stream is not each ring at its own place.');
  for (let k = 1; k < 40; k++) {
    const tail = k / 40;
    pose('water', 0.2, { front: 1, tail });
    const at = along(),
      top = tail * (last + S.sink);
    assert(props.water.visible && at.every((d, i) => d >= top - 1e-6 && d >= S.rings[i] - 1e-6 && (!i || d >= at[i - 1] - 1e-6)) && at[0] > 0 === tail > 0, `Going (tail ${tail}), the rings are at ${at.map((d) => d.toFixed(3)).join(', ')} down the line.`);
    moved = Math.max(moved, ...at.map((d, i) => Math.abs(d - before[i])));
    before = at;
  }
  assert(before.every((d) => Math.abs(d - (39 / 40) * (last + S.sink)) < 1e-6), 'At its end the stream has not gone on down the line past its last ring.');
  assert(moved <= ((last + S.sink) / 40) * 1.001 && moved >= (last / 40) * 1.5, `A step of a fortieth moves a ring ${moved.toFixed(4)} down the line.`);
  pose('stand', 0);
}
// The Wellington statue as built (before batching, at its own origin): the bronze stands on its
// plate, touching it only over the plate (in at least three of its corners: three hooves down, one
// lifted) and all of it over the cornice's top; the cone rests on the Duke's head; the bronze's colours are no
// louder than palette.bronze; and the whole statue costs at most 26k triangles.
{
  const { createProps } = await load('town-props'),
    { createKit } = await load('town-kit'),
    { createCityMaterials } = await load('city-materials'),
    { palette } = await load('town-shared'),
    library = createCityMaterials(),
    ctx = { library, material: library.material, season: 'summer', land: new T.Group(), lamps: [], clocks: [], animated: [] },
    root = createProps(ctx, createKit(ctx)).wellington(new T.Group());
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => o.isMesh && meshes.push(o));
  const count = (m) => (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3,
    bronze = meshes.filter((m) => m.material.userData.surfaceKind === 'iron').sort((a, b) => count(b) - count(a))[0],
    plate = meshes.find((m) => m.userData.band),
    plateBox = new T.Box3().setFromObject(plate),
    cast = new T.Box3().setFromObject(bronze);
  assert(meshes.reduce((n, m) => n + count(m), 0) <= 26000, 'The statue costs more than 26k triangles.');
  assert(Math.abs(cast.min.y - plateBox.max.y) < 0.006, `The bronze's lowest point is ${(cast.min.y - plateBox.max.y).toFixed(3)} off the plate.`);
  assert(cast.min.x > -0.65 && cast.max.x < 0.65 && cast.min.z > -1.05 && cast.max.z < 1.05, 'The bronze overhangs the cornice.');
  const p = bronze.geometry.getAttribute('position'),
    v = new T.Vector3(),
    corners = new Set();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(bronze.matrixWorld);
    if (v.y > plateBox.max.y + 0.012) continue;
    assert(v.x > plateBox.min.x && v.x < plateBox.max.x && v.z > plateBox.min.z && v.z < plateBox.max.z, 'The bronze touches down off its plate.');
    corners.add(`${Math.sign(v.x)}${Math.sign(v.z)}`);
  }
  assert(corners.size >= 3, `Only ${corners.size} of the horse's corners stand on the plate.`);
  const hat = meshes.filter((m) => m.material.userData.surfaceKind === 'enamel'),
    cone = new T.Box3();
  for (const m of hat) cone.expandByObject(m);
  assert(cone.min.y - cast.max.y > -0.045 && cone.min.y - cast.max.y < 0.01, `The cone's foot is ${(cone.min.y - cast.max.y).toFixed(3)} from the top of the Duke's head.`);
  const c = bronze.geometry.getAttribute('color'),
    hsv = (col) => {
      const max = Math.max(col.r, col.g, col.b);
      return max ? (max - Math.min(col.r, col.g, col.b)) / max : 0;
    },
    limit = hsv(new T.Color(palette.bronze).convertLinearToSRGB()),
    colour = new T.Color();
  for (let i = 0; i < c.count; i += 5) assert(hsv(colour.fromBufferAttribute(c, i).convertLinearToSRGB()) <= limit + 1e-3, 'The bronze is louder than palette.bronze.');
}
// The sky island's garden kit (town-sky-garden's createSkyGarden; nothing in the town calls it yet), each
// piece built on its own with the check's own context, then a whole garden's worth batched as the island
// will batch it (static parts in one group with the deck as its floor, moving parts one by one):
// - every part has a surface kind; nothing is two-sided, transparent, cut out or glowing (but the lamps'
//   globes, which are the lamps' own glass); its colours are the kit's (SKY_GARDEN_LOOK), none more
//   saturated than its palette family (SKY_GARDEN_FAMILY): the clouds and the puffs are a muted white no
//   louder than palette.white over a darker, cooler base;
// - every joined piece (each run of faces sharing corners) is 0.07 across or more every way (thinner ones
//   twinkle as the view moves);
// - the fall: a stone spout that reaches past the rim and never hangs below the deck there; a sheet 0.5
//   wide or more (and softly rounded: 0.4 deep or more) all the way from the pour to the puff; a puff about
//   1.3 in radius that the sheet's foot ends inside, so no water reaches the sea; its lumps slide a spacing
//   and back, the first cluster hidden in the pour at the loop's start and the last in the puff's core at
//   its end, and at time 0 (the frame Pause and reduced motion hold) two clusters or more show mid-fall;
// - a cloud has a flat base at y 0 and stays its size; a rock is the armour's smooth boulder (an
//   icosahedron of detail 2 at least, jittered 8% at most, every corner shaded alike on all its faces)
//   with a keel deeper than its top is high;
// - the tea table: both chairs' seats are the park bench's seat height (measured from town-props' bench)
//   and clear, the tea set stands on the table and off the sitter's side, and `seats` puts a sitter's hips
//   0.09 behind each seat's front edge; the telescope's eye end is at the eyepiece's height (0.65 by
//   default, from the residents' own eye height and hips, measured from createResident) and its tube
//   looks down; a set of lamps lights one glass mesh with the town's lamps (never batched); an urn says
//   where its plant goes;
// - motion: every moving part is on a pivot of its own (keepSeparate) with an entry in ctx.animated,
//   posed from town time alone: the same pose a period later at a large t, the same pose again when time
//   stands still (whatever the night), a different one in between, and never out of its range;
// - the budget: two falls, two clouds, three rocks, a tea set, a telescope, a set of four lamps and two
//   urns cost at most 14 meshes and 16,000 triangles; the static parts merge into three families (stone,
//   timber, brass) and each moving part is one mesh; every batched solid shares the bake program;
// - at night the clouds dim on one material of the kit's own and the falls (their water, lumps and puffs) on
//   another, each to its own colour (SKY_NIGHT: a cool moonlit grey, the falls dimmed less), with
//   no glow, and nothing else does; by day they are not dimmed; they take no shadow.
{
  const G = await load('town-sky-garden'),
    { createProps } = await load('town-props'),
    { createNature } = await load('town-nature'),
    { createKit } = await load('town-kit'),
    { createBatch } = await load('town-batch'),
    { createCityMaterials } = await load('city-materials'),
    { createResident } = await load('city-people'),
    { palette } = await load('town-shared'),
    { FALL, CLOUD, ROCK, TEA, TELESCOPE, GARDEN_LAMP, URN, SKY_NIGHT, SKY_GARDEN_LOOK: LOOK, SKY_GARDEN_FAMILY: FAMILY } = G;
  const fresh = () => {
    const library = createCityMaterials(),
      ctx = { library, material: library.material, season: 'summer', land: new T.Group(), lamps: [], clocks: [], animated: [] },
      kit = createKit(ctx),
      props = createProps(ctx, kit);
    return { ctx, props, garden: G.createSkyGarden(ctx, kit, props, createNature(ctx, kit)), batch: createBatch(ctx).batch };
  };
  const meshesOf = (g) => {
      const out = [];
      g.traverse((o) => o.isMesh && out.push(o));
      return out;
    },
    trisOf = (list) => list.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0),
    v = new T.Vector3(),
    fmt = (p) => p.toArray().map((n) => n.toFixed(3)).join(', '),
    /** HSV saturation of a colour given in sRGB. */
    sat = (c) => {
      const max = Math.max(c.r, c.g, c.b);
      return max ? (max - Math.min(c.r, c.g, c.b)) / max : 0;
    },
    srgb = (hex) => new T.Color(hex).convertLinearToSRGB(),
    luminance = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  /** Each run of joined faces in a mesh (faces sharing a corner): its box in the world and its faces. */
  const pieces = (m) => {
    const q = m.geometry.attributes.position,
      index = m.geometry.index,
      key = (i) => [q.getX(i), q.getY(i), q.getZ(i)].map((n) => n.toFixed(4)).join(','),
      parent = new Map(),
      find = (k) => (parent.get(k) === k ? k : (parent.set(k, find(parent.get(k))), parent.get(k))),
      corner = (t, j) => (index ? index.getX(t * 3 + j) : t * 3 + j),
      faces = (index ? index.count : q.count) / 3;
    for (let i = 0; i < q.count; i++) if (!parent.has(key(i))) parent.set(key(i), key(i));
    for (let t = 0; t < faces; t++) for (const j of [1, 2]) parent.set(find(key(corner(t, j))), find(key(corner(t, 0))));
    const out = new Map();
    for (let t = 0; t < faces; t++) {
      const r = find(key(corner(t, 0)));
      if (!out.has(r)) out.set(r, { box: new T.Box3(), faces: 0 });
      const piece = out.get(r);
      piece.faces++;
      for (const j of [0, 1, 2]) piece.box.expandByPoint(v.fromBufferAttribute(q, corner(t, j)).applyMatrix4(m.matrixWorld));
    }
    return [...out.values()];
  };
  /** Every vertex of a mesh, in the frame of `frame` (the world without one). */
  const each = (m, visit, frame) => {
    const q = m.geometry.attributes.position,
      m4 = frame ? frame.matrixWorld.clone().invert().multiply(m.matrixWorld) : m.matrixWorld;
    for (let i = 0; i < q.count; i++) visit(v.fromBufferAttribute(q, i).applyMatrix4(m4), i);
  };

  // The kit's colours, each within its palette family; the clouds' base darker and cooler than their top.
  for (const [name, colour] of Object.entries(LOOK)) {
    assert(/^#[0-9a-f]{6}$/.test(colour) && FAMILY[name], `The garden's ${name} is not a colour with a family.`);
    assert(sat(srgb(colour)) <= sat(srgb(FAMILY[name])) + 1e-3, `The garden's ${name} (${colour}) is louder than its family (${FAMILY[name]}).`);
  }
  for (const name of ['cloud', 'cloudBase', 'foam']) assert(sat(srgb(LOOK[name])) <= sat(srgb(palette.white)), `The garden's ${name} is more saturated than the palette's white.`);
  {
    const top = srgb(LOOK.cloud),
      base = srgb(LOOK.cloudBase);
    assert(luminance(base) < luminance(top) - 0.05 && base.b > base.r && top.r >= top.b, 'The clouds\' base is not darker and cooler than their top.');
  }

  // Each piece on its own.
  const { ctx, props, garden } = fresh(),
    built = {
      fall: garden.fall(),
      cloud: garden.cloud({ seed: 3 }),
      rock: garden.floatingRock({ seed: 2 }),
      tea: garden.teaTable(),
      telescope: garden.telescope(),
      lamps: garden.gardenLamps([{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 0, z: 2 }, { x: 2, y: 0.3, z: 2 }]),
      lamp: garden.gardenLamp(),
      urn: garden.urn(),
    },
    moving = new Set(ctx.animated.map((e) => e.object)),
    paleKinds = new Set(['fabric']);
  assert.equal(ctx.animated.length, 4, 'The kit\'s moving parts are not the fall\'s still water and its lumps, the cloud and the rock.');
  for (const [name, g] of Object.entries(built)) {
    assert(g.isGroup && g.position.lengthSq() === 0 && g.rotation.x === 0 && g.rotation.y === 0 && g.rotation.z === 0 && !g.userData.keepSeparate && !moving.has(g), `The ${name}'s own group is not left for whoever places it.`);
    g.updateMatrixWorld(true);
    const list = meshesOf(g);
    assert(list.length > 0, `The ${name} is empty.`);
    for (const m of list) {
      const kind = m.material.userData.surfaceKind,
        what = `The ${name}'s ${m.name || kind}`,
        globe = ctx.lamps.includes(m);
      assert(kind, `${what} has no surface kind.`);
      assert(m.material.side !== T.DoubleSide && !m.material.transparent && m.material.opacity === 1 && !m.material.alphaTest, `${what} is two-sided, transparent or cut out.`);
      assert(globe || m.material.emissive.getHex() === 0, `${what} glows.`);
      // On a pivot of its own (moving) or not; nothing moving or pale casts.
      let pivot = m.parent;
      while (pivot !== g && !pivot.userData.keepSeparate) pivot = pivot.parent;
      assert(pivot === g || moving.has(pivot), `${what} is kept apart from the batch but nothing poses it.`);
      if (pivot !== g || paleKinds.has(kind) || globe) assert(!m.castShadow && m.userData.noShadow, `${what} casts a shadow.`);
      for (const piece of pieces(m)) {
        const size = piece.box.getSize(new T.Vector3());
        assert(Math.min(size.x, size.y, size.z) >= 0.07 - 1e-3, `A piece of ${what} is ${fmt(size)} at ${fmt(piece.box.getCenter(new T.Vector3()))}.`);
      }
      if (globe) continue;
      // Its colours are on its vertices, in the looks it names.
      const colour = m.geometry.getAttribute('color'),
        looks = m.userData.looks,
        c = new T.Color();
      assert(m.material.color.getHex() === 0xffffff && colour && looks?.length && looks.every((l) => LOOK[l]), `${what} does not carry the kit's colours on its vertices.`);
      const limit = Math.max(...looks.map((l) => sat(srgb(LOOK[l]))));
      for (let i = 0; i < colour.count; i++) assert(sat(c.fromBufferAttribute(colour, i).convertLinearToSRGB()) <= limit + 0.02, `${what} has a vertex louder than its looks (${sat(c).toFixed(3)} over ${limit.toFixed(3)}).`);
    }
  }
  const byName = (g, name) => meshesOf(g).find((m) => m.name === name);

  // The fall: thin water spilling over a natural edge (the owner's reference 2), never plumbing. No
  // basin, kerb or spout: nothing of it stands over its stream, which runs level out of the lawn's
  // edge through town-sky's notch in the coping; a short lip, never an elbow; a flat sheet (0.5 wide
  // or more and spreading as it falls, 0.15 deep or more so it never thins to a hairline from its
  // edge, no deeper than 0.35 of its width so it never reads as a tube), its middle on the lean the
  // layout gives; paler down the fall, from the water's edge at the lip to foam at the puff; a puff
  // about 1.3 in radius that the sheet's foot ends inside, so no water reaches the sea. Its lumps
  // are foam white and slide a spacing and back: the first cluster hidden inside the whole water
  // under the lip at the loop's start and the last in the puff's core at its end, two clusters or
  // more showing mid-fall at time 0 (the frame Pause and reduced motion hold), and through the whole
  // loop never a point of them outside the sheet's own outline (its convex hull, ring by ring), so
  // from any side nothing on the fall's silhouette moves and the selection ring round it holds still.
  {
    const F = built.fall.userData.fall,
      water = byName(built.fall, 'sky-fall-water'),
      lumps = byName(built.fall, 'sky-fall-lumps'),
      slide = lumps.parent,
      puffTop = -F.drop + FALL.puffRise,
      n = Math.hypot(1, F.lean),
      // Out of the sheet's middle plane (to the sea), for a point of the fall.
      out = (p) => (p.z - F.line(p.y)) / n;
    assert.deepEqual([F.drop, F.width, F.rise], [FALL.drop, FALL.width, 0], 'The fall\'s defaults moved.');
    assert(FALL.width >= 0.5 && FALL.drop === 4.5 && Math.abs(FALL.puff - 1.3) < 1e-9 && Math.abs(F.out - plan.SKY_FALLS.out) < 1e-9, 'The fall is under 0.5 wide, or its drop, its puff or its reach moved.');
    // Its stream wells up where the plan measures its slot's rise (the lawn's height over its head).
    assert.equal(FALL.stream.head, plan.SKY_FALLS.head, 'The fall\'s stream wells up elsewhere than where the plan measures its slot\'s rise (FALL.stream.head against plan.SKY_FALLS.head).');
    assert(water.parent.userData.keepSeparate && slide.userData.keepSeparate && slide.parent === water.parent && meshesOf(built.fall).length === 2, 'The fall is not its still water on a pivot and its lumps on one inside it, and nothing else (no basin, kerb or spout).');
    // Nothing over the stream; the stream level out of the lawn's edge to the lip.
    let high = -Infinity;
    each(water, (p) => (high = Math.max(high, p.y)));
    built.fall.updateMatrixWorld(true);
    each(lumps, (p) => (high = Math.max(high, p.y)), built.fall);
    assert(Math.abs(high - FALL.stream.level) < 1e-6, `Something of the fall stands ${(high - FALL.stream.level).toFixed(3)} over its stream.`);
    assert(F.top.z > 0.1 && F.top.z <= 0.2 && FALL.lip <= 0.2 && F.top.y > -0.25, `The fall turns down over a lip ${F.top.z.toFixed(2)} out and ${(-F.top.y).toFixed(2)} down: an elbow, not a lip.`);
    // The sheet's rings, from under the lip to the puff's top.
    const sheet = [];
    each(water, (p, i) => {
      if (p.y < F.top.y - 0.25 && p.y > puffTop + 0.05) sheet.push({ p: p.clone(), i });
    });
    sheet.sort((a, b) => b.p.y - a.p.y);
    const rings = [];
    for (const v of sheet) {
      const ring = rings.at(-1);
      if (ring && Math.abs(ring.y - v.p.y) < 0.04) {
        ring.list.push(v);
        ring.y = ring.list.reduce((s, q) => s + q.p.y, 0) / ring.list.length;
      } else rings.push({ y: v.p.y, list: [v] });
    }
    const colour = water.geometry.getAttribute('color'),
      tone = (list) => list.reduce((s, q) => s + luminance(new T.Color().fromBufferAttribute(colour, q.i)), 0) / list.length;
    assert(rings.length >= 6, `The sheet has ${rings.length} rings.`);
    let wide = 0;
    for (const ring of rings) {
      const xs = ring.list.map((q) => q.p.x),
        ws = ring.list.map((q) => out(q.p)),
        width = Math.max(...xs) - Math.min(...xs),
        depth = Math.max(...ws) - Math.min(...ws),
        middle = (Math.max(...ws) + Math.min(...ws)) / 2;
      assert(width >= 0.5 && width >= F.width - 0.03 && width >= wide - 1e-3 && depth >= 0.15 && depth <= 0.35 * width && Math.abs(middle) < 0.01, `The sheet is ${width.toFixed(3)} wide and ${depth.toFixed(3)} deep, ${middle.toFixed(3)} off its lean, at y ${ring.y.toFixed(2)}.`);
      wide = width;
    }
    assert(wide >= 1.6 * F.width && FALL.flare >= 1.7, `The sheet spreads only to ${wide.toFixed(2)} over the puff.`);
    // Paler down the fall: the water's edge at the lip, foam at the puff.
    const first = tone(rings[0].list),
      lastTone = tone(rings.at(-1).list);
    assert(first < luminance(new T.Color(LOOK.foam)) * 0.75 && lastTone > first * 1.5 && lastTone > luminance(new T.Color(LOOK.water)), `The sheet does not pale from water at the lip (${first.toFixed(3)}) to foam at the puff (${lastTone.toFixed(3)}).`);
    // The puff: about 1.3 in radius round the sheet's line, flat underneath; the sheet's foot ends inside it.
    let reach = 0,
      low = Infinity,
      top = -Infinity;
    each(water, (p) => {
      low = Math.min(low, p.y);
      if (p.y < puffTop - 0.3) reach = Math.max(reach, Math.hypot(p.x, p.z - F.out));
      if (p.y < puffTop + 0.05 && Math.hypot(p.x, p.z - F.out) < 0.2) top = Math.max(top, p.y);
    });
    assert(reach > 1.1 && reach < 1.45 && Math.abs(low + F.drop + FALL.puffSink) < 0.03 && Math.abs(top - puffTop) < 0.06, `The puff reaches ${reach.toFixed(2)} out, ${(-F.drop - low).toFixed(2)} down and ${(top + F.drop).toFixed(2)} up.`);
    const foot = G.fallSection(F, F.top.y + F.drop);
    assert(Math.hypot(foot.a, FALL.core.y + 0.15) < FALL.core.r && low > -F.drop - 1, 'The sheet\'s foot is not inside the puff\'s core, or water falls on toward the sea.');
    // Falling water, not a glass strap with rivets (the final art review): the sheet's section rolls
    // softly round to its edges (a superellipse of 3 or under); its lumps are long streaks (each at
    // least twice as long down the fall as it is wide); and its paint is streaked down the sheet: on
    // each of the upper rings its edges are paler than the middle of its faces, and its face columns
    // part into paler and deeper streaks (the palest a tenth or more over the deepest).
    {
      assert(G.FALL_OVAL <= 3 && G.FALL_LUMPS.every((l) => l.r[1] >= 2 * l.r[0] * F.a), 'The fall is a crisp strap, or its lumps are round rivets, not long streaks.');
      for (const ring of rings.slice(0, 3)) {
        const half = Math.max(...ring.list.map((q) => Math.abs(q.p.x))),
          lumOf = (q) => luminance(new T.Color().fromBufferAttribute(colour, q.i)),
          edges = ring.list.filter((q) => Math.abs(q.p.x) > 0.9 * half).map(lumOf),
          faces = ring.list.filter((q) => Math.abs(q.p.x) < 0.8 * half).map(lumOf),
          mean = (list) => list.reduce((s, x) => s + x, 0) / list.length;
        assert(mean(edges) > 1.05 * mean(faces) && Math.max(...faces) > 1.1 * Math.min(...faces), `The fall's water is not streaked at y ${ring.y.toFixed(2)} (its edges ${mean(edges).toFixed(3)}, its faces ${Math.min(...faces).toFixed(3)} to ${Math.max(...faces).toFixed(3)}).`);
      }
    }
    // The lumps: foam white, `count` clusters alike, a spacing apart down the lean.
    const lumpColour = lumps.geometry.getAttribute('color');
    for (let i = 0; i < lumpColour.count; i++) assert(Math.abs(luminance(new T.Color().fromBufferAttribute(lumpColour, i)) - luminance(new T.Color(LOOK.foam))) < 1e-3, 'A lump is not foam white.');
    assert.equal(pieces(lumps).length, F.count * G.FALL_LUMPS.length, 'The lumps are not the layout\'s clusters.');
    assert(F.count >= 3 && Math.abs(F.spacing - FALL.pitch) < 0.2 && slide.position.x === 0, `The fall has ${F.count} clusters ${F.spacing.toFixed(2)} apart, or its lumps are off its line.`);
    // A point's place in the sheet: its ring above and below (the hull of their (x, out) points).
    const hullOf2 = (pts) => {
        const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
          cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]),
          half = (list) => {
            const h = [];
            for (const q of list) {
              while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
              h.push(q);
            }
            h.pop();
            return h;
          };
        return [...half(sorted), ...half(sorted.reverse())];
      },
      hulls = rings.map((r) => ({ y: r.y, hull: hullOf2(r.list.map((q) => [q.p.x, out(q.p)])), face: r.list.map((q) => [q.p.x, out(q.p)]) })),
      inside = (hull, [x, w], margin) => hull.every((a, k) => {
        const b = hull[(k + 1) % hull.length];
        return ((b[0] - a[0]) * (w - a[1]) - (b[1] - a[1]) * (x - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]) >= margin;
      }),
      around = (y) => hulls.filter((h, k) => (h.y >= y && (hulls[k + 1]?.y ?? -Infinity) < y) || (h.y < y && (hulls[k - 1]?.y ?? Infinity) >= y));
    const cluster = (y) => Math.round((F.first - y + (F.over - F.under) / 2) / F.spacing),
      seen = new Set(),
      showing = new Set();
    for (const phase of [0, 0.2, 0.4, 0.6, 0.8, 0.999]) {
      const s = phase * F.spacing;
      slide.position.set(0, -s, s * F.lean);
      built.fall.updateMatrixWorld(true);
      each(lumps, (p) => {
        const k = cluster(p.y + s);
        if (phase === 0) seen.add(k);
        // At the loop's start the first cluster is hidden inside the whole water under the lip.
        if (phase === 0 && k === 0) assert(p.y < F.top.y - 0.25 && p.y > F.top.y - FALL.hide[0] && around(p.y).every((h) => inside(h.hull, [p.x, out(p)], 0.004)), `A lump of the first cluster shows at the loop's start at ${fmt(p)}.`);
        // At its end the last one is inside the puff's core.
        if (phase === 0.999 && k === F.count - 1) assert(Math.hypot(p.x, p.y + F.drop - FALL.core.y, p.z - F.out) < FALL.core.r - 0.02, `A lump of the last cluster shows at the loop's end at ${fmt(p)}.`);
        // Down the sheet, never outside its outline.
        if (p.y < F.top.y - 0.25 && p.y > puffTop + 0.05) {
          const at = around(p.y);
          assert(at.length && at.every((h) => inside(h.hull, [p.x, out(p)], 0.003)), `A lump stands out of the sheet's outline at ${fmt(p)} (phase ${phase}).`);
        }
      }, built.fall);
    }
    assert.equal(seen.size, F.count, 'The lumps are not sorted into the layout\'s clusters.');
    // Time 0: the phase is mid-loop, and two clusters or more show on the sheet, out of its channel.
    slide.position.set(0, -G.fallPhase(0) * F.spacing, G.fallPhase(0) * F.spacing * F.lean);
    built.fall.updateMatrixWorld(true);
    assert(G.fallPhase(0) > 0.15 && G.fallPhase(0) < 0.85, 'The fall\'s frozen frame is at an end of its loop.');
    each(lumps, (p) => {
      if (p.y < F.top.y - 0.25 && p.y > puffTop + 0.05) {
        const s = G.fallSection(F, F.top.y - p.y),
          w = Math.abs(out(p));
        if (w > G.fallFace(s, p.x / s.a) + 0.01) showing.add(cluster(p.y + G.fallPhase(0) * F.spacing));
      }
    }, built.fall);
    assert(showing.size >= 2, `Only ${showing.size} clusters of lumps show mid-fall in the frozen frame.`);
    // A fall on a domed deck: its stream's head lies under the lawn there, and it still ends `drop` under the rim.
    const { garden: other } = fresh(),
      raised = other.fall({ rise: 0.04, width: 0.7, drop: 5 }),
      R = raised.userData.fall;
    raised.updateMatrixWorld(true);
    const all = new T.Box3().setFromObject(raised);
    let head = -Infinity;
    each(byName(raised, 'sky-fall-water'), (p) => {
      if (p.z < -FALL.stream.head + 0.01) head = Math.max(head, p.y);
    });
    assert(Math.abs(all.max.y - FALL.stream.level) < 1e-6 && Math.abs(all.min.y + 5 + FALL.puffSink) < 0.03 && head <= R.rise - 0.03 + 1e-6, 'A fall on a lower lawn does not keep its stream\'s head under the lawn, or its puff is off its drop.');
  }

  // The cloud: a flat base at y 0, its size, its base's paint darker and cooler than its top's.
  {
    const body = byName(built.cloud, 'sky-cloud-body'),
      drift = body.parent,
      box = new T.Box3(),
      n = body.geometry.getAttribute('normal'),
      colour = body.geometry.getAttribute('color'),
      under = new T.Color(0, 0, 0),
      over = new T.Color(0, 0, 0),
      c = new T.Color();
    let unders = 0,
      overs = 0;
    each(body, (p, i) => {
      box.expandByPoint(p);
      c.fromBufferAttribute(colour, i);
      if (n.getY(i) < -0.6) {
        unders++;
        under.add(c);
      } else if (n.getY(i) > 0.8 && p.y > 0.6) {
        overs++;
        over.add(c);
      }
    }, drift);
    const size = box.getSize(new T.Vector3());
    assert(Math.abs(box.min.y) < 0.02 && size.x > 3 && size.x < 3.9 && size.y > 1.1 && size.y < 1.5 && size.z > 1.5 && size.z < 2.3, `The cloud is ${fmt(size)} over a base at ${box.min.y.toFixed(3)}.`);
    assert(unders > 20 && overs > 20, 'The cloud has no base or no top.');
    under.multiplyScalar(1 / unders).convertLinearToSRGB();
    over.multiplyScalar(1 / overs).convertLinearToSRGB();
    assert(luminance(under) < luminance(over) - 0.06 && under.b > under.r, 'The cloud\'s base is not painted darker and cooler than its top.');
    // Half the size, half the cloud, for the same triangles (its grid follows its size).
    const { garden: other } = fresh(),
      small = byName(other.cloud({ seed: 3, size: 0.5 }), 'sky-cloud-body');
    small.geometry.computeBoundingBox();
    assert(Math.abs(small.geometry.boundingBox.getSize(new T.Vector3()).x - size.x / 2) < 0.05 && Math.abs(trisOf([small]) - trisOf([body])) < 80, 'A cloud half the size is not half the cloud for the same triangles.');
  }

  // The rock: a chunk of the armour's smooth boulders with a keel, a thin patch of turf on top.
  {
    const body = byName(built.rock, 'sky-rock-body'),
      bob = body.parent,
      stone = pieces(body).sort((a, b) => b.faces - a.faces)[0],
      box = new T.Box3(),
      q = body.geometry.attributes.position,
      n = body.geometry.attributes.normal,
      normals = new Map();
    assert(ROCK.detail >= 2 && ROCK.jitter <= 0.08 && stone.faces === 20 * (ROCK.detail + 1) ** 2, `The rock is not one smooth icosahedron of detail ${ROCK.detail} (${stone.faces} faces).`);
    // Smooth: wherever faces of the stone meet they share one normal, and it is a unit one.
    for (let i = 0; i < stone.faces * 3; i++) {
      const k = [q.getX(i), q.getY(i), q.getZ(i)].map((x) => x.toFixed(4)).join(','),
        own = new T.Vector3().fromBufferAttribute(n, i),
        first = normals.get(k) ?? normals.set(k, own).get(k);
      assert(Math.abs(own.length() - 1) < 1e-4 && own.distanceTo(first) < 1e-4, 'The rock is faceted: a corner has a normal a face.');
    }
    each(body, (p) => box.expandByPoint(p), bob);
    const size = 0.6;
    // A chunk of rock, not a drop: a keel deeper than its top is high, and no long point under it.
    assert(box.max.x - box.min.x > 1.6 * size && box.max.x - box.min.x < 2.6 * size && box.max.y > 0.55 * size && box.max.y < 1.1 * size && -box.min.y > 0.9 * size && -box.min.y < 1.6 * size && -box.min.y > box.max.y * 1.3, `The rock spans ${fmt(box.min)} to ${fmt(box.max)}: no keel, or a drop.`);
    // Two or three of the armour's boulders (each a whole icosahedron); no tussocks (no piece under
    // a fifth of its size across: three small balls on a green cap read as eyes); its turf one thin
    // patch over the big stone, standing under 0.12 of its size over the stone's top.
    const all = pieces(body),
      colour = body.geometry.getAttribute('color'),
      // The turf is the green of it (its vertices greener than they are red or blue), the stones the rest.
      green = (i) => colour.getY(i) > colour.getX(i) * 1.1 && colour.getY(i) > colour.getZ(i) * 1.3,
      turfTop = new T.Box3(),
      stoneTop = new T.Box3();
    each(body, (p, i) => (green(i) ? turfTop : stoneTop).expandByPoint(p), bob);
    const stones = all.length - 1;
    assert(stones >= 2 && stones <= 3 && all.every((p) => p.faces === 20 * (ROCK.detail + 1) ** 2 || p.faces < 20 * (ROCK.detail + 1) ** 2 + 60) && all.every((p) => Math.min(p.box.max.x - p.box.min.x, p.box.max.z - p.box.min.z) >= 0.2 * size), `The rock is ${stones} boulders, or carries a piece under a fifth of its size across (a tussock).`);
    assert(!turfTop.isEmpty() && turfTop.max.y - stoneTop.max.y > -0.04 * size && turfTop.max.y - stoneTop.max.y < 0.12 * size && turfTop.max.x - turfTop.min.x < 0.8 * (stoneTop.max.x - stoneTop.min.x), `The rock's turf is not one thin patch on its stone's top (${(turfTop.max.y - stoneTop.max.y).toFixed(3)} over it).`);
    assert(built.rock.userData.period > 0 && ROCK.periods.includes(built.rock.userData.period), 'The rock does not say its period.');
    // A chunk torn from the island's turf, not a capped pebble (the final art review: the patch in
    // palette.grass facing straight up shone 14% over the lawn): every vertex of the patch is the
    // lawn's own darker stripe (turfDark) as the island's ground shows it (ROCK.turf.shade, 0.75 to
    // 0.9: the lawn's grain and tint), and it spreads over half the big stone's width or more.
    {
      const dark = new T.Color(LOOK.turfDark).multiplyScalar(ROCK.turf.shade),
        turfLooks = [];
      for (let i = 0; i < colour.count; i++) if (green(i)) turfLooks.push(new T.Color().fromBufferAttribute(colour, i));
      assert(turfLooks.length && turfLooks.every((c) => Math.abs(c.r - dark.r) + Math.abs(c.g - dark.g) + Math.abs(c.b - dark.b) < 1e-3) && LOOK.turfDark === palette.grassDark && ROCK.turf.shade >= 0.75 && ROCK.turf.shade <= 0.9 && turfTop.max.x - turfTop.min.x >= 0.5 * (stoneTop.max.x - stoneTop.min.x), 'The rock\'s turf is not a wide patch of the lawn\'s darker stripe.');
    }
  }

  // The tea table: the bench's seat height, clear seats, the tea set on the table.
  {
    const stage = new T.Group(),
      bench = props.bench(stage, 0, 0, 0);
    stage.updateMatrixWorld(true);
    // The park bench's seat: its three level slats' top.
    const slats = meshesOf(bench).filter((m) => m.material.userData.surfaceKind === 'wood').flatMap(pieces).filter((p) => p.box.max.y - p.box.min.y < 0.08),
      seat = Math.max(...slats.map((p) => p.box.max.y));
    assert(slats.length === 3 && Math.abs(seat - TEA.seat) < 1e-6, `The chairs' seat height (${TEA.seat}) is not the park bench's (${seat.toFixed(3)}, over ${slats.length} slats).`);
    const timber = byName(built.tea, 'sky-tea-timber'),
      top = byName(built.tea, 'sky-tea-top'),
      china = byName(built.tea, 'sky-tea-china'),
      front = TEA.radius + TEA.gap,
      seats = pieces(timber).filter((p) => Math.abs(p.box.max.y - TEA.seat) < 1e-6 && p.box.max.y - p.box.min.y < 0.1);
    assert(seats.length === 2 && [timber, top].every((m) => m.material.userData.surfaceKind === 'wood' && m.castShadow) && !top.userData.band && timber.userData.band, 'The tea table is not two seats and a top (an overhang) in casting timber.');
    seats.sort((a, b) => a.box.min.x - b.box.min.x);
    seats.forEach((s, k) => {
      const side = k ? 1 : -1,
        size = s.box.getSize(new T.Vector3());
      assert(Math.abs(side * (k ? s.box.min.x : s.box.max.x) - front) < 1e-6 && Math.abs(size.x - TEA.chair.d) < 1e-6 && Math.abs(size.z - TEA.chair.w) < 1e-6, `A chair's seat is ${fmt(size)} from x ${s.box.min.x.toFixed(3)} to ${s.box.max.x.toFixed(3)}.`);
      // Clear: nothing over the seat (a hand in from its edges) up to a sitter's shoulders but its own back.
      for (const m of [timber, top, china]) each(m, (p) => assert(!(p.x > s.box.min.x + 0.11 && p.x < s.box.max.x + 0.02 * side && side * p.x > front - 0.02 && Math.abs(p.z) < TEA.chair.w / 2 - 0.05 && p.y > TEA.seat + 0.005 && p.y < 0.95) || side * p.x > front + TEA.chair.d - 0.12, `Something sits on a chair's seat at ${fmt(p)}.`));
      const sitter = built.tea.userData.seats[k];
      assert(Math.abs(side * sitter.x - front - TEA.setback) < 1e-9 && sitter.z === 0 && Math.abs(Math.sin(sitter.heading) + side) < 1e-9, 'A sitter is not put 0.09 behind the seat\'s front edge, facing the table.');
    });
    const table = new T.Box3().setFromObject(top),
      set = new T.Box3().setFromObject(china);
    assert(Math.abs(table.max.y - TEA.top) < 1e-6 && Math.abs(table.max.x - TEA.radius) < 1e-6 && TEA.top - TEA.seat > 0.18 && TEA.top - TEA.seat < 0.3, 'The table\'s top moved.');
    assert(Math.abs(set.min.y - TEA.top) < 1e-6 && set.max.y < TEA.top + 0.25 && pieces(china).length >= 5, 'The tea set does not stand on the table: a pot with its spout and handle, a cup, a stand and scones.');
    each(china, (p) => assert(Math.hypot(p.x, p.z) < TEA.radius - 0.05 && p.x > -0.3, `The tea set overhangs the table or crowds the sitter's side at ${fmt(p)}.`));
    // The top is the pedestal's overhang; everything stands on y 0.
    assert(Math.abs(new T.Box3().setFromObject(built.tea).min.y) < 1e-6, 'The tea table does not stand on y 0.');
  }

  // The telescope: its eye end at the eyepiece's height, the default from the residents' eyes and hips.
  {
    const resident = createResident(0, ctx.material),
      face = resident.getObjectByName('body').children.find((m) => m.isMesh && m.material.userData.surfaceKind === 'paint'),
      colour = face.geometry.getAttribute('color'),
      q = face.geometry.getAttribute('position'),
      c = new T.Color();
    let eye = 0,
      eyes = 0;
    // The eyes are the face's darkest paint.
    for (let i = 0; i < q.count; i++)
      if (luminance(c.fromBufferAttribute(colour, i)) < 0.03) {
        eyes++;
        eye += q.getY(i);
      }
    eye /= eyes;
    assert(eyes > 20 && Math.abs(eye - TELESCOPE.eye) < 0.005 && Math.abs(resident.getObjectByName('leg-left').position.y - TELESCOPE.hip) < 1e-9, `The telescope's eye height (${TELESCOPE.eye}) and hips (${TELESCOPE.hip}) are not the residents' (${eye.toFixed(3)}).`);
    const E = G.telescopeEyepiece();
    assert(Math.abs(E.height - 0.6515) < 1e-3 && E.height < TELESCOPE.eye && E.standOff > 0.3 && E.standOff < 0.45, `A stooped resident's eyepiece is ${E.height.toFixed(4)} up and ${E.standOff.toFixed(3)} out.`);
    const { garden: other } = fresh();
    for (const [scope, height] of [[built.telescope, 0.65], [other.telescope({ eyepiece: 0.72 }), 0.72]]) {
      scope.updateMatrixWorld(true);
      const brass = byName(scope, 'sky-telescope-brass'),
        tripod = byName(scope, 'sky-telescope-tripod'),
        end = new T.Vector3(...scope.userData.eyepiece),
        gaze = new T.Vector3(0, -Math.sin(TELESCOPE.tilt), Math.cos(TELESCOPE.tilt));
      assert(Math.abs(end.y - height) < 1e-9 && end.x === 0 && Math.abs(scope.userData.stand[2] - end.z + E.standOff) < 1e-9, `The telescope's eyepiece is ${end.y} up, not ${height}.`);
      let near = Infinity,
        far = -Infinity,
        rim = 0;
      each(brass, (p) => {
        const along = p.clone().sub(end).dot(gaze),
          off = p.clone().sub(end).addScaledVector(gaze, -along).length();
        if (off > TELESCOPE.hood + 0.01) return; // the mount and the shoes
        near = Math.min(near, along);
        far = Math.max(far, along);
        if (along < 0.02) rim = Math.max(rim, off);
      });
      assert(Math.abs(near) < 1e-6 && Math.abs(far - TELESCOPE.length) < 1e-6 && Math.abs(rim - TELESCOPE.barrel) < 1e-6, `The tube runs from ${near.toFixed(3)} to ${far.toFixed(3)} along the line of sight, ${rim.toFixed(3)} in radius at its eye end.`);
      const feet = new T.Box3().setFromObject(tripod);
      assert(brass.material.userData.surfaceKind === 'brass' && tripod.material.userData.surfaceKind === 'wood' && feet.min.y < -0.02 && feet.min.y > -0.06 && feet.max.y < end.y, 'The telescope is not brass on a timber tripod that stands in the ground under its tube.');
      each(tripod, (p) => assert(Math.hypot(p.x, p.z) < TELESCOPE.spread + 0.08, `The tripod straddles further than its spread at ${fmt(p)}.`));
    }
  }

  // The lamps: one glass mesh a set, the lamps' own glass, lit with the town's and never batched.
  {
    const globes = byName(built.lamps, 'sky-lamp-globes'),
      single = byName(built.lamp, 'sky-lamp-globes');
    assert(ctx.lamps.length === 2 && ctx.lamps[0] === globes && ctx.lamps[1] === single && globes.material === single.material, 'A set of garden lamps does not light one glass mesh, or the sets do not share their glass.');
    assert(globes.material.isMeshStandardMaterial && globes.material.emissive.getHex() === new T.Color(palette.lantern).getHex() && globes.material.userData.surfaceKind === 'glass', 'The garden lamps\' glass is not the lamps\' own.');
    const balls = pieces(globes);
    assert.equal(balls.length, 4, 'A set of four lamps has not four globes.');
    [[0, 0, 0], [2, 0, 0], [0, 0, 2], [2, 0.3, 2]].forEach(([x, y, z]) => {
      const ball = balls.find((b) => b.box.getCenter(new T.Vector3()).distanceTo(new T.Vector3(x, y + GARDEN_LAMP.height - GARDEN_LAMP.globe, z)) < 0.02);
      assert(ball && Math.abs(ball.box.max.y - y - GARDEN_LAMP.height) < 0.005 && Math.abs(ball.box.max.x - ball.box.min.x - 2 * GARDEN_LAMP.globe) < 0.02, `No globe stands on the lamp at ${x}, ${y}, ${z}.`);
    });
    const piers = byName(built.lamp, 'sky-lamp-piers'),
      pier = new T.Box3().setFromObject(piers);
    assert(piers.material.userData.surfaceKind === 'stone' && byName(built.lamp, 'sky-lamp-cups').material.userData.surfaceKind === 'brass' && Math.abs(pier.max.y - GARDEN_LAMP.cap) < 1e-6 && Math.abs(pier.min.y + 0.04) < 1e-6 && GARDEN_LAMP.height < 0.9, 'A garden lamp is not a short stone pier under a brass cup.');
    // By day it reads as a lamp, not a stone pawn (the final art review): its post (the shaft and
    // the cap, over its plinth) is the town's dark cast iron, its plinth the pale stone, and its globe
    // frosted, brighter than the stone and a touch cooler.
    {
      const q = piers.geometry.attributes.position,
        tone = piers.geometry.getAttribute('color'),
        c = new T.Color(),
        post = [],
        plinth = [];
      // (The plinth's top is 0.08 up and the shaft runs down into it: the band between is left out.)
      for (let i = 0; i < q.count; i++) if (q.getY(i) < 0.06 || q.getY(i) > 0.1) (q.getY(i) > 0.1 ? post : plinth).push(luminance(c.fromBufferAttribute(tone, i)));
      const glass = single.material.color,
        stone = new T.Color(LOOK.stone);
      assert(post.length && Math.max(...post) < 0.1 && Math.min(...plinth) > 0.5 && luminance(glass) > luminance(stone) && glass.b / glass.r > stone.b / stone.r, `A garden lamp's post is not dark iron over a stone plinth (${Math.max(...post).toFixed(3)}), or its globe is not frosted.`);
    }
  }

  // The urn: its plant's place; planted, the nature kit's ball sits in its bowl.
  {
    const box = new T.Box3().setFromObject(built.urn),
      { garden: other } = fresh(),
      planted = other.urn({ planted: true });
    planted.updateMatrixWorld(true);
    const ball = meshesOf(planted).find((m) => m.material.userData.surfaceKind === 'foliage'),
      leaves = ball && new T.Box3().setFromObject(ball);
    assert(Math.abs(box.max.y - URN.height) < 1e-6 && Math.abs(box.max.x - box.min.x - 0.67) < 0.01 && Math.abs(box.min.y + 0.05) < 1e-6 && built.urn.userData.plant.y === URN.plant.y && built.urn.userData.plant.r === URN.plant.r, 'The urn moved, or does not say where its plant goes.');
    assert(meshesOf(built.urn).length === 1 && ball && leaves.min.y > URN.plant.y - 0.12 && leaves.min.y < URN.height && leaves.max.y > URN.height + 0.3 && Math.abs(leaves.getCenter(new T.Vector3()).x) < 0.03, 'A planted urn\'s ball does not sit in its bowl.');
  }

  // Motion, from town time alone.
  {
    const pose = (o) => [...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()],
      same = (a, b) => a.every((n, i) => Math.abs(n - b[i]) < 1e-6),
      T0 = 3 * 86400 + 1234.5,
      F = built.fall.userData.fall,
      entries = [
        [built.fall.getObjectByName('sky-fall-still'), 0, () => true],
        [built.fall.getObjectByName('sky-fall-moving'), FALL.period, (o) => o.position.y <= 1e-9 && o.position.y > -F.spacing - 1e-9],
        [built.cloud.getObjectByName('sky-cloud-drift'), CLOUD.period, (o) => Math.abs(o.position.x) <= CLOUD.drift + 1e-9 && Math.abs(o.position.y) <= CLOUD.bob + 1e-9 && o.position.z === 0],
        [built.rock.getObjectByName('sky-rock-bob'), built.rock.userData.period, (o) => Math.abs(o.position.y) <= ROCK.bob * 0.6 + 1e-9 && o.position.x === 0 && o.position.z === 0 && Math.abs(o.rotation.x) <= ROCK.rock + 1e-9],
      ];
    for (const [object, period, inRange] of entries) {
      const entry = ctx.animated.find((e) => e.object === object);
      assert(entry && object.userData.keepSeparate, 'A moving part of the garden has no pivot of its own or no entry in the town\'s animated list.');
      // The pose it was built in is time 0's.
      const builtAs = pose(object);
      entry.update(0, 0, 0);
      assert(same(builtAs, pose(object)), `${object.name} is not built in its pose at time 0.`);
      for (const t of [0, 7.3, T0]) {
        entry.update(t, 0, 0);
        const at = pose(object);
        assert(at.every(Number.isFinite) && inRange(object), `${object.name} leaves its range at t ${t}.`);
        entry.update(t, 0, 0);
        assert(same(at, pose(object)), `${object.name} moves while time stands still.`);
        entry.update(t, 1, 1);
        assert(same(at, pose(object)), `${object.name} moves with the night or the rain.`);
        if (!period) continue;
        entry.update(t + period, 0, 0);
        assert(same(at, pose(object)), `${object.name} is not back where it was a period (${period} s) later, at t ${t}.`);
        entry.update(t + period * 0.37, 0, 0);
        assert(!same(at, pose(object)), `${object.name} does not move.`);
      }
      entry.update(0, 0, 0);
    }
  }

  // The budget, batched as the island will batch it: static parts with the deck as their floor, moving
  // parts one by one.
  {
    const deck = 10.472,
      // (Timed builds, above: each run from a context of its own; the checks below take the first.)
      gardenTime = timeBuild(fresh, ({ ctx, garden, batch }) => {
        const root = new T.Group();
        root.position.set(-52, deck, -24);
        root.rotation.y = 0.4;
        const put = (g, x, y, z, ry = 0) => {
          g.position.set(x, y, z);
          g.rotation.y = ry;
          root.add(g);
          return g;
        };
        const pale = [put(garden.fall({ seed: 1 }), 6, 0, 0, Math.PI / 2), put(garden.fall({ seed: 2 }), -6, 0, 0, -Math.PI / 2), put(garden.cloud({ seed: 1 }), 9, 1, 3), put(garden.cloud({ seed: 2, size: 0.8 }), -9, 2, -3)];
        for (const k of [1, 2, 3]) put(garden.floatingRock({ seed: k, size: 0.4 + 0.15 * k }), 8, -3, k * 2);
        put(garden.teaTable(), 0, 0, 3);
        put(garden.telescope(), 4, 0, 3);
        const lampSet = put(garden.gardenLamps([{ x: -2, z: 4 }, { x: 2, z: 4 }, { x: -2, z: 5 }, { x: 2, z: 5 }]), 0, 0, 0);
        put(garden.urn(), -3, 0, 2);
        put(garden.urn(), 3, 0, 2);
        root.updateMatrixWorld(true);
        return { ctx, batch, root, pale, lampSet };
      }),
      { ctx, batch, root, pale, lampSet } = gardenTime.built,
      globes = ctx.lamps[0];
    batch(root, { floor: () => deck });
    for (const entry of ctx.animated) batch(entry.object, { contact: 'none' });
    root.updateMatrixWorld(true);
    const all = meshesOf(root),
      still = all.filter((m) => m.parent === root),
      movers = ctx.animated.map((e) => e.object);
    assert(all.length <= 14 && trisOf(all) <= 16000, `The garden costs ${all.length} meshes and ${trisOf(all)} triangles.`);
    inTime('The garden\'s build', gardenTime, 85);
    assert.deepEqual(still.map((m) => `${m.material.userData.surfaceKind}|${m.castShadow}`).sort(), ['brass|false', 'stone|true', 'wood|true'], 'The garden\'s static parts do not merge into casting stone and timber and brass that casts nothing.');
    assert(movers.length === 9 && movers.every((o) => o.children.filter((c) => c.isMesh).length === 1), 'A moving part of the garden is not one mesh.');
    assert(ctx.lamps.length === 1 && globes.parent === lampSet && all.includes(globes) && !globes.material.vertexColors, 'The lamps\' globes were batched, or are not one mesh.');
    const solids = all.filter((m) => m !== globes);
    for (const m of solids) {
      assert(m.material.vertexColors && m.material.customProgramCacheKey() === 'lius-bake-solid', `The garden's ${m.material.name} batch is not on the solids' one program.`);
      assert(m.material.side !== T.DoubleSide && !m.material.transparent && !patchedShader(m.material).fragmentShader.includes('discard'), `The garden's ${m.material.name} batch is two-sided, transparent or cuts holes.`);
    }
    // Night: the pale parts dim on the kit's own copy of their material, with no glow; nothing else does.
    const paleMeshes = pale.flatMap((g) => meshesOf(g)).filter((m) => m.material.userData.surfaceKind === 'fabric'),
      rest = solids.filter((m) => !paleMeshes.includes(m)),
      shared = new Set(rest.map((m) => m.material));
    // (SKY_NIGHT: the clouds keep 0.85 or more of their daylight, turned a little cool: at 0.7 grey
    // they read as slate boulders; the falls keep more than the clouds, never a dark downpipe.)
    const tones = { cloud: new T.Color(SKY_NIGHT.cloud), fall: new T.Color(SKY_NIGHT.fall) },
      roleOf = (m) => (pale.slice(0, 2).some((g) => meshesOf(g).includes(m)) ? 'fall' : 'cloud');
    assert(paleMeshes.length === 6 && luminance(tones.cloud) >= 0.85 && tones.cloud.b >= tones.cloud.r && luminance(tones.fall) > luminance(tones.cloud) && [tones.cloud, tones.fall].every((c) => Math.max(c.r, c.g, c.b) <= 1), `The clouds hardly lighten from slate at night or glow, the falls dim more than the clouds, or the pale parts are ${paleMeshes.length} meshes, not the falls' four and the clouds' two.`);
    for (const entry of ctx.animated) entry.update(5, 1, 0);
    for (const role of ['fall', 'cloud']) assert.equal(new Set(paleMeshes.filter((m) => roleOf(m) === role).map((m) => m.material)).size, 1, `The ${role}s do not share one material of the kit's own.`);
    assert(new Set(paleMeshes.map((m) => m.material)).size === 2, 'The falls and the clouds share their night.');
    for (const m of paleMeshes) {
      assert(!shared.has(m.material) && m.material.customProgramCacheKey() === 'lius-bake-solid', 'The clouds dim a material the town shares, or leave the solids\' program.');
      assert(m.material.color.equals(tones[roleOf(m)]) && m.material.emissive.getHex() === 0 && !m.receiveShadow && !m.castShadow, 'A cloud, a puff or a fall is not its night colour (or glows) at night, or takes a shadow.');
    }
    for (const m of rest) assert.equal(m.material.color.getHex(), 0xffffff, 'Something of the garden that is not pale dims at night.');
    for (const entry of ctx.animated) entry.update(5, 0, 0);
    for (const m of paleMeshes) assert.equal(m.material.color.getHex(), 0xffffff, 'The clouds are dimmed by day.');
  }
}
// The street and pier lamps (town-props' lamp), Glasgow cast-iron lamp standards, built alone: one
// stands within the old 0.34 plinth square (every clearance in the plan assumes it), reaches no
// further than 0.32 from its axis and stands under 2.5. Its one lantern glass, the lamps entry the
// night loop lights, keeps its middle at the lantern height, 0.4 tall, at most 0.42 across and
// wider at its head than its foot; everything else is unlit iron with at most two brass accents,
// and it costs at most 1300 triangles (about +25k over the town's 23). Whatever overhangs the plinth
// stands 0.2 above a walker's head. Its own spotlight (city-lighting) falls on its iron no harder
// than 1.2 / d² (hung 0.17 out, it lit the bell collar at 31: a cream glow under the lantern). The
// ladder bar runs square to the overview's line of sight, on the turned pier as on the streets, so
// the opening views see both arms. No canopy (summer's, the fullest) comes within 0.25 of a lamp
// head between 1 and 2.6 up.
{
  const { createProps } = await load('town-props'),
    { createKit } = await load('town-kit'),
    { createCityMaterials } = await load('city-materials'),
    nature = await load('town-nature'),
    library = createCityMaterials(),
    context = () => ({ library, material: library.material, season: 'summer', land: new T.Group(), lamps: [], clocks: [], animated: [] }),
    ctx = context(),
    props = createProps(ctx, createKit(ctx)),
    stage = new T.Scene(),
    pierGroup = new T.Group();
  pierGroup.rotation.y = Math.atan2(plan.pier.dir[0], plan.pier.dir[1]); // as pierAndHarbour turns the pier
  stage.add(pierGroup);
  const post = props.lamp(stage, 0, 0, 1.8, 0),
    onPier = props.lamp(pierGroup, 0, 0, 1.8, 0);
  stage.updateMatrixWorld(true);
  assert.equal(ctx.lamps.length, 2, 'A lamp has more or fewer than one lantern glass.');
  const glass = ctx.lamps[0],
    parts = post.children.filter((o) => o.isMesh && o !== glass),
    v = new T.Vector3(),
    tris = (m) => (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3,
    points = (m, each) => {
      const p = m.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) each(v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld));
    };
  assert(post.children.includes(glass) && Math.abs(glass.getWorldPosition(new T.Vector3()).y - 1.8) < 1e-6, 'The lantern glass left the lantern height.');
  const pane = new T.Box3().setFromObject(glass),
    paneSize = pane.getSize(new T.Vector3());
  assert(Math.abs(paneSize.y - 0.4) < 0.01 && paneSize.x <= 0.42 && paneSize.z <= 0.42, 'The lantern glass is no longer about the old lantern’s size.');
  let foot = 0, head = 0;
  points(glass, (p) => {
    if (p.y < pane.min.y + 1e-4) foot = Math.max(foot, Math.abs(p.x));
    if (p.y > pane.max.y - 1e-4) head = Math.max(head, Math.abs(p.x));
  });
  assert(head > foot + 0.02, 'The lantern is no wider at its head than its foot.');
  assert(parts.every((m) => ['iron', 'brass'].includes(m.material.userData.surfaceKind) && m.material.emissive.getHex() === 0), 'A lamp part other than the glass is not unlit iron or brass.');
  assert(parts.filter((m) => m.material.userData.surfaceKind === 'brass').length <= 2, 'A lamp has more than two brass accents.');
  assert([...parts, glass].reduce((n, m) => n + tris(m), 0) <= 1300, 'A lamp costs more than 1300 triangles.');
  const walkerTop = Math.max(...walkers.map((w) => new T.Box3().setFromObject(w.root).getSize(new T.Vector3()).y));
  let reach = 0;
  for (const m of parts)
    points(m, (p) => {
      const r = Math.hypot(p.x, p.z);
      reach = Math.max(reach, r);
      if (p.y < 0.6) assert(Math.abs(p.x) <= 0.170001 && Math.abs(p.z) <= 0.170001, 'The lamp base spreads beyond the old 0.34 plinth square.');
      assert(r <= 0.32 && p.y <= 2.5, 'The lamp reaches beyond 0.32 of its axis or stands 2.5 or taller.');
      if (r > 0.185) assert(p.y >= walkerTop + 0.2, `The lamp overhangs its plinth ${p.y.toFixed(2)} up, at a walker's head (${walkerTop.toFixed(2)}).`);
    });
  // The lamp's own light, as city-lighting hangs it.
  const lighting = createStreetLighting(stage, [glass], { shadows: 0 }),
    [spot] = lighting.lights,
    axis = spot.target.position.clone().sub(spot.position).normalize(),
    outer = Math.cos(spot.angle),
    inner = Math.cos(spot.angle * (1 - spot.penumbra));
  for (const m of parts)
    points(m, (p) => {
      const d = p.clone().sub(spot.position),
        t = T.MathUtils.clamp((d.clone().normalize().dot(axis) - outer) / (inner - outer), 0, 1);
      assert((t * t * (3 - 2 * t)) / d.lengthSq() <= 1.2, `The lamp's own light falls hard on its iron at ${p.toArray().map((n) => n.toFixed(2))}.`);
    });
  lighting.dispose();
  // Both arms' balls end 0.29 out; the farthest point of the bar from the shaft is one of them.
  for (const lamp of [post, onPier]) {
    const bar = lamp.children.find((o) => o.name === 'ladder-bar'),
      centre = lamp.getWorldPosition(new T.Vector3());
    let tip = null;
    points(bar, (p) => {
      if (!tip || Math.hypot(p.x - centre.x, p.z - centre.z) > Math.hypot(tip.x - centre.x, tip.z - centre.z)) tip = p.clone();
    });
    const along = Math.abs((tip.x - centre.x) - (tip.z - centre.z)) / Math.SQRT2 / Math.hypot(tip.x - centre.x, tip.z - centre.z);
    assert(along > 0.999, `A ladder bar${lamp === onPier ? ' on the pier' : ''} turned off the overview's line of sight.`);
  }
  const lampSpots = plan.lampPlan();
  for (const t of plan.plantingPlan()) {
    const near = lampSpots.filter((l) => Math.hypot(l.x - t.x, l.z - t.z) < 2 * t.size + 1);
    if (!near.length) continue;
    const c = context(),
      g = new T.Group();
    nature.createNature(c, createKit(c)).tree(g, t, Number(t.id.slice(5)));
    g.updateMatrixWorld(true);
    g.traverse((m) => {
      if (!m.isMesh || m.material.userData.surfaceKind !== 'foliage') return;
      points(m, (p) => {
        for (const l of near) {
          const up = p.y - plan.terrainHeight(l.x, l.z);
          if (up > 1 && up < 2.6) assert(Math.hypot(p.x - l.x, p.z - l.z) - reach >= 0.25, `${t.id}'s canopy reaches into ${l.id}'s head.`);
        }
      });
    });
  }
}
// The Town Hall's dressings (buildHall): everything stays inside the hall's old outline (so its hit
// box, close-up and chapter framing do not move) and within its budget; the doorway under the
// aedicule stays open between the columns and the rustication; the dormers' and the gables' new
// lights sit above the eaves and inside the roof; the late-lit fanlight and tower window are still
// on the tower's front.
{
  const { shell } = models.get('town-hall'),
    site = plan.sites['town-hall'],
    TF = site.d / 2 + 0.6,
    toShell = shell.matrixWorld.clone().invert(),
    v = new T.Vector3(),
    c = new T.Vector3(),
    outline = new T.Box3();
  let tris = 0,
    meshes = 0;
  shell.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    tris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    const p = o.geometry.attributes.position,
      m = toShell.clone().multiply(o.matrixWorld),
      stone = o.material.userData.surfaceKind === 'stone' && !o.geometry.index;
    for (let i = 0; i < p.count; i++) outline.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(m));
    if (!stone) return;
    for (let i = 0; i + 2 < p.count; i += 3) {
      c.set(0, 0, 0);
      for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(p, i + k).applyMatrix4(m));
      c.multiplyScalar(1 / 3);
      assert(!(Math.abs(c.x) < 0.5 && c.y > 0.6 && c.y < 1.95 && c.z > TF + 0.02 && c.z < TF + 0.5), `Stone stands in the hall's doorway at ${c.toArray().map((n) => n.toFixed(2))}.`);
    }
  });
  assert(
    outline.min.x >= -4.035 && outline.max.x <= 4.035 && outline.min.z >= -2.885 && outline.max.z <= 4.055 && outline.min.y > -0.01 && outline.max.y <= 13.305,
    `The hall outgrew its outline: ${outline.min.toArray().map((n) => n.toFixed(2))} to ${outline.max.toArray().map((n) => n.toFixed(2))}.`,
  );
  assert(tris <= 40000 && meshes <= 21, `The hall has ${tris} triangles in ${meshes} meshes.`);
  const panes = model.windows.filter((p) => p.place === 'town-hall' && p.role !== 'dial').map((p) => ({ ...p, local: p.at.clone().applyMatrix4(toShell) }));
  const high = panes.filter((p) => p.local.y > 5.4);
  assert.equal(high.length, 4, 'The hall has two dormer lights and two gable oculi.');
  for (const p of high) {
    const dormer = Math.abs(Math.abs(p.local.x) - 2.54) < 0.01 && Math.abs(p.local.z - 1.81) < 0.01,
      oculus = Math.abs(Math.abs(p.local.x) - (site.w / 2 + 0.02)) < 0.01 && Math.abs(p.local.z) < 0.01;
    assert(dormer || oculus, `A hall light at ${p.local.toArray().map((n) => n.toFixed(2))} is neither a dormer's nor an oculus.`);
  }
  const late = panes.filter((p) => Math.round(p.light[0] * 255) === 204 && Math.round(p.light[1] * 255) === 128);
  assert(late.length === 2 && late.every((p) => Math.abs(p.local.x) < 0.01 && Math.abs(p.local.z - (TF + 0.06)) < 0.01), 'The hall’s late lights left the tower’s front.');
}
// The Research Studio's dressings (buildStudio): inside its old outline and budget; the roof
// garden and B's roof plant stay inside their parapets; the canopy's two slender posts stand on
// the apron clear of the bike rack and the bench; the rooflight is lit late like the glass box.
{
  const { shell } = models.get('research-studio'),
    { d } = plan.sites['research-studio'],
    toShell = shell.matrixWorld.clone().invert(),
    v = new T.Vector3(),
    w = new T.Vector3(),
    outline = new T.Box3(),
    { x0, x1, z0, z1 } = rackFootprint,
    rect = (p, a, b, c, e) => Math.hypot(Math.max(0, a - p.x, p.x - b), Math.max(0, c - p.z, p.z - e));
  let tris = 0,
    meshes = 0,
    posts = 0;
  shell.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    tris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    const p = o.geometry.attributes.position,
      m = toShell.clone().multiply(o.matrixWorld),
      kind = o.material.userData.surfaceKind;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      outline.expandByPoint(v);
      if ((kind === 'foliage' || kind === 'wood') && v.y > 4.83)
        assert(v.x >= -2.81 && v.x <= 0.61 && Math.abs(v.z) <= 2.61, `The studio's roof garden spills over its parapet at ${v.toArray().map((n) => n.toFixed(2))}.`);
      // On B's roof (over its parapet's caps at 3.86, or planted): inside the parapet's inner faces.
      if (v.x > 0.75 && v.y < 4.45 && (((kind === 'foliage' || kind === 'wood') && v.y > 3.6) || v.y > 3.9))
        assert(v.x <= 2.83 && Math.abs(v.z) <= 2.31, `B's roof plant spills over its parapet at ${v.toArray().map((n) => n.toFixed(2))}.`);
      // The posts' heads and caps under the canopy (a post's shaft has vertices only at its ends).
      if (kind === 'iron' && v.y > 2.3 && v.y < 2.75 && v.z > d / 2 + 0.8) {
        posts++;
        w.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
        assert(rect(w, x0, x1, z0, z1) >= 0.3, `A canopy post crowds the bike rack at ${w.toArray().map((n) => n.toFixed(2))}.`);
        assert(rect(v, -2.6, -1.3, d / 2 + 1.62, d / 2 + 2.08) >= 0.25, `A canopy post crowds the bench at ${v.toArray().map((n) => n.toFixed(2))}.`);
      }
    }
  });
  assert(posts > 0, 'The studio canopy lost its posts.');
  assert(
    // Front z: the bench and bike rack by the entrance count too; the street-furniture pass's bench
    // reaches about 1 cm further out than the old one (its own footprint is checked with the props).
    outline.min.x >= -3.045 && outline.max.x <= 3.045 && outline.min.z >= -2.845 && outline.max.z <= 4.72 && outline.min.y > -0.01 && outline.max.y <= 5.275,
    `The studio outgrew its outline: ${outline.min.toArray().map((n) => n.toFixed(2))} to ${outline.max.toArray().map((n) => n.toFixed(2))}.`,
  );
  assert(tris <= 13000 && meshes <= 14, `The studio has ${tris} triangles in ${meshes} meshes.`);
  const roof = model.windows.filter((p) => p.place === 'research-studio' && p.at.clone().applyMatrix4(toShell).y > 4.9);
  assert(roof.length === 1 && Math.round(roof[0].light[0] * 255) === 204, 'The studio’s rooflight is not lit late.');
}
// The homes' Glasgow dressings (town-homes: mainDoor, dressedWindow, skews, stack, rooflight, gutters and
// downpipes). In each home's frame (front +z, the row along x): nothing reaches into the gaps beside it (every
// vertex of the shell, the washing aside, stays within the roof's reach, |x| < w/2 + 0.55); its cast iron is one
// mesh that casts nothing, with gutters high on two opposite sides and a railing on each side of the steps, none
// of it past z d/2 + 0.85 (the steps' foot) at the front; the doorpiece's hood keeps within the old surround's
// reach (0.64 either side of the door), so the bay's cheek keeps its clearance; and the fanlight and the rooflight
// share the bay's and the attic's lights, so each home has as many lights as it had windows (5, 6 and 5).
{
  const LIGHTS = { 'pengyuan-liu': 5, 'yunlong-liu': 6, 'qin-li': 5 },
    v = new T.Vector3();
  for (const id of plan.terraceHomes) {
    const { shell } = models.get(id),
      { w, d } = plan.sites[id],
      gable = id === 'qin-li', // its eaves on the sides, the others' at the front and back
      solid = shell.children.filter((o) => o.isMesh),
      iron = solid.filter((o) => o.material.userData.surfaceKind === 'iron');
    assert(iron.length === 1 && !iron[0].castShadow, `${id}: its cast iron is ${iron.length} meshes${iron.some((o) => o.castShadow) ? ', casting' : ''}.`);
    let eaves = [0, 0],
      rails = [0, 0],
      hood = 0;
    for (const o of solid) {
      const p = o.geometry.attributes.position,
        kind = o.material.userData.surfaceKind;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        assert(Math.abs(v.x) < w / 2 + 0.55, `${id} reaches into the gap beside it at ${v.toArray().map((n) => n.toFixed(2))}`);
        if (kind === 'iron') {
          assert(v.z < d / 2 + 0.85, `${id}'s iron stands in the front garden at ${v.toArray().map((n) => n.toFixed(2))}`);
          const out = gable ? v.x : v.z;
          if (v.y > 2.9 && Math.abs(out) > (gable ? w / 2 + 0.3 : d / 2 + 0.5)) eaves[out > 0 ? 1 : 0]++;
          if (v.y < 1.05 && v.z > d / 2 + 0.25) rails[v.x > 0.52 ? 1 : 0]++;
        }
        if (kind === 'stone' && v.y > 2.4 && v.y < 2.56 && v.z > d / 2 + 0.2 && Math.abs(v.x - 0.52) < 0.8) {
          hood++;
          assert(Math.abs(v.x - 0.52) <= 0.64, `${id}'s doorpiece reaches toward the bay at x ${v.x.toFixed(3)}`);
        }
      }
    }
    assert(eaves.every((n) => n > 20), `${id} has no gutters along both eaves (${eaves}).`);
    assert(rails.every((n) => n > 50), `${id}'s steps lack a railing on each side (${rails}).`);
    assert(hood > 8, `${id} has no doorpiece hood.`);
    assert.equal(panes.filter((p) => p.place === id).length, LIGHTS[id], `${id}'s windows are not one light each.`);
  }
}
// The cottages' dressings: each cottage's window is one light, and the porch (PORCH), the lean-to store (LEAN_TO)
// and every pair of gate piers stand on the cottage's own ground: on the island, off the pavement, clear of the
// trees (as the washing is), the lamps and the dog walk.
{
  const { PORCH, LEAN_TO } = await load('town-homes'),
    lampSpots = plan.lampPlan(),
    trees = plan.plantingPlan();
  // Each cottage by its own number (plan.cottages' n), which its porch and lean-to go by.
  plan.cottages.forEach((c) => {
    const i = c.n,
      toWorld = (x, z) => [c.x + x * Math.cos(c.rotation) + z * Math.sin(c.rotation), c.z - x * Math.sin(c.rotation) + z * Math.cos(c.rotation)];
    assert.equal(panes.filter((p) => p.place === 'land' && Math.hypot(p.at.x - c.x, p.at.z - c.z) < 2).length, 1, `Cottage ${i}'s window is not one light.`);
    // Footprints in the cottage's frame (x along its front, z out of it): [x0, z0, x1, z1].
    const parts = [];
    if (i === PORCH) parts.push(['porch', [-0.17, 1.2, 1.37, 2.27]]);
    if (i === LEAN_TO) parts.push(['lean-to', [1.32, -0.9, 2.65, 0.9]]);
    const fx = c.x + Math.sin(c.rotation) * 1.2,
      fz = c.z + Math.cos(c.rotation) * 1.2,
      room = plan.distanceToStreets(fx, fz) - plan.PAVEMENT_WIDTH - 0.05;
    if (room > 1.25) {
      const hz = 1.2 + (i === PORCH ? Math.min(1.45, room - 0.35) : Math.min(1.0, room - 0.35));
      parts.push(['gate piers', [-0.05, hz - 0.15, 1.25, hz + 0.15]]);
    }
    for (const [name, [x0, z0, x1, z1]] of parts)
      for (let a = 0; a <= 4; a++)
        for (let b = 0; b <= 4; b++) {
          const [x, z] = toWorld(x0 + ((x1 - x0) * a) / 4, z0 + ((z1 - z0) * b) / 4);
          assert(plan.onIsland(x, z, 1), `Cottage ${i}'s ${name} by the shore at ${x.toFixed(2)}, ${z.toFixed(2)}`);
          assert(plan.distanceToStreets(x, z) > plan.PAVEMENT_WIDTH + 0.05, `Cottage ${i}'s ${name} on the pavement at ${x.toFixed(2)}, ${z.toFixed(2)}`);
          assert(plan.distanceToPolyline([x, z], plan.dogLoop, true) > 1.5, `Cottage ${i}'s ${name} on the dog walk.`);
          for (const t of trees) assert(Math.hypot(t.x - x, t.z - z) > 1.3 * t.size + 0.2, `Cottage ${i}'s ${name} runs into ${t.id}.`);
          for (const l of lampSpots) assert(Math.hypot(l.x - x, l.z - z) > 0.8, `Cottage ${i}'s ${name} crowds ${l.id}.`);
        }
  });
}
// The Visiting PhD Residence (town-residence's buildResidence): the next spot up the terrace row,
// beyond Pengyuan's home with the row's own gap (2.4, wall to wall), its front to the ring road as
// the homes' are. As built nothing of it reaches into that gap further than its side windows' sills
// (0.2 proud of the wall; the homes' own dressings reach 0.55 into theirs) or into the homes'
// gardens, off its plot, onto the
// pavement or the road (only its path runs on under the pavement's slab), toward the coast or onto
// the hill; no tree, lamp, signal, heather drift, sheep, standing stone or the cyclist crowds it,
// and no tree stands on its plot (the plan dropped tree-55 and tree-60 there, by id, and no other).
// It costs at most 16k triangles in 7 meshes; each flat is one warm light, the lobby is lit late,
// and its balustrades' glass is never lit.
{
  const site = plan.sites['visiting-phd'],
    home = plan.sites['pengyuan-liu'],
    plot = plan.residencePlot,
    { shell } = models.get('visiting-phd'),
    v = new T.Vector3(),
    outOf = (x, z, r) => Math.hypot(Math.max(0, Math.abs(x - r.x) - r.w / 2), Math.max(0, Math.abs(z - r.z) - r.d / 2));
  assert(site.rotation === Math.PI / 2 && site.x === plan.terraceRow.x, 'The residence does not face the ring road from the row’s line.');
  assert(home.z - home.w / 2 - (site.z + site.w / 2) >= 2.4 - 1e-9, 'The residence crowds Pengyuan’s home.');
  const missing = [];
  for (let i = 0, ids = new Set(trees.map((t) => t.id)); i <= Math.max(...trees.map((t) => Number(t.id.slice(5)))); i++) if (!ids.has('tree-' + i)) missing.push(i);
  assert(missing.includes(55) && missing.includes(60) && missing.length === 3, `Trees missing from the plan: ${missing}`);
  shell.updateMatrixWorld(true);
  let tris = 0,
    count = 0;
  const built = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const o of shell.children) {
    if (!o.isMesh) continue;
    count++;
    const p = o.geometry.attributes.position,
      kind = o.material.userData.surfaceKind;
    tris += (o.geometry.index?.count ?? p.count) / 3;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      const at = v.toArray().map((n) => n.toFixed(2)).join(', ');
      assert(v.z <= site.z + site.w / 2 + 0.21, `The residence reaches into the gap toward Pengyuan’s home at ${at}`);
      assert(plan.onIsland(v.x, v.z, 2.5), `The residence by the shore at ${at}`);
      assert(plan.terrainHeight(v.x, v.z) < 0.01, `The residence on the hill at ${at}`);
      // Its path runs on under the pavement's raised slab (the road bends away, so its end is straight
      // where the pavement's edge is not), but never as far as the kerb.
      if (kind === 'paving') assert(plan.distanceToStreets(v.x, v.z) > 0.3, `The residence’s path reaches the kerb at ${at}`);
      else {
        assert(outOf(v.x, v.z, plot) < 1e-6, `The residence leaves its plot at ${at}`);
        assert(plan.distanceToStreets(v.x, v.z) > plan.PAVEMENT_WIDTH + 0.15, `The residence crowds the pavement at ${at}`);
        built.minX = Math.min(built.minX, v.x);
        built.maxX = Math.max(built.maxX, v.x);
        built.minZ = Math.min(built.minZ, v.z);
        built.maxZ = Math.max(built.maxZ, v.z);
      }
    }
  }
  assert(tris <= 16000 && count <= 7, `The residence costs ${Math.round(tris)} triangles in ${count} meshes.`);
  const footprint = { x: (built.minX + built.maxX) / 2, z: (built.minZ + built.maxZ) / 2, w: built.maxX - built.minX, d: built.maxZ - built.minZ };
  for (const t of trees) {
    assert(outOf(t.x, t.z, plot) > 0, `${t.id} stands on the residence’s plot.`);
    assert(outOf(t.x, t.z, footprint) > 0.9 * t.size + 0.3, `${t.id}’s crown runs into the residence.`);
  }
  for (const l of plan.lampPlan()) assert(outOf(l.x, l.z, footprint) > 1.5, `${l.id} crowds the residence.`);
  for (const sp of plan.signalPosts) assert(outOf(sp.x, sp.z, footprint) > 2, `A signal post crowds the residence.`);
  for (const d of plan.heatherPlan(trees)) assert(outOf(d.x, d.z, plot) > plan.heatherReach(d) + 1, `${d.id} crowds the residence.`);
  for (const sh of plan.flock) assert(Math.hypot(sh.x - site.x, sh.z - site.z) > 9.5, `${sh.id} by the residence.`);
  assert(Math.hypot(plan.stoneRing.x - site.x, plan.stoneRing.z - site.z) > 8, 'The stone ring by the residence.');
  for (let t = 0; t <= 3000; t += 0.5) {
    const c = plan.cyclistPose(t);
    assert(outOf(c.x, c.z, footprint) > 1.5, `The cyclist passes ${outOf(c.x, c.z, footprint).toFixed(2)} from the residence.`);
  }
  const own = panes.filter((p) => p.place === 'visiting-phd'),
    flats = own.filter((p) => p.role === 'residence'),
    clear = own.filter((p) => p.role === 'clear');
  assert.equal(flats.length, 5, 'The residence is not one light a flat and one for its lobby.');
  assert(flats.every((p) => Math.round(p.light[1] * 255) !== 255), 'A residence window is cool white.');
  const lobby = flats.filter((p) => Math.round(p.light[0] * 255) === 255 && Math.round(p.light[1] * 255) === 128);
  assert(lobby.length === 1 && lit(lobby, 23.5).length === 1 && lit(lobby, 1.25).length === 1, 'The residence’s lobby is not lit late.');
  assert.equal(clear.length, 4, 'The residence’s balustrades are not four panes of clear glass.');
  for (const h of [20, 23.5, 2.5, 6.5]) assert(clear.every((p) => windowLevel(p.light, at(h)) === 0), `A balustrade lights up at ${h}.`);
}
// The lighthouse (town-harbour's lighthouse), a Stevenson tower in a walled yard, built alone: it
// stands on its rock no taller than 6.1 (the overview frames the rock to 5.5) and within 2.95 of
// the rock's axis; its yard's landing stair comes down on the beach above the waterline and the
// platform's foot never reaches the grass; the door case stays inside the yard's parapet (its
// lower step 0.04 clear) and covers the base course's open ends; the door's head and the stair
// windows keep off the red bands; the gallery is wider than the shaft's foot; the lantern glass
// (the lamps entry the night loop lights) is the beam's pivot height, in the glazing; and the
// whole costs at most 15k triangles.
{
  const { createHarbour } = await load('town-harbour'),
    { createProps } = await load('town-props'),
    { createKit } = await load('town-kit'),
    { createCityMaterials } = await load('city-materials'),
    library = createCityMaterials(),
    ctx = { library, material: library.material, season: 'summer', land: new T.Group(), lamps: [], clocks: [], animated: [] },
    kit = createKit(ctx),
    harbour = createHarbour(ctx, kit, createProps(ctx, kit)),
    stage = new T.Group(),
    L = plan.LIGHTHOUSE,
    [rx, rz] = plan.lighthouseRock;
  harbour.lighthouse(stage);
  stage.updateMatrixWorld(true);
  const tower = stage.getObjectByName('lighthouse'),
    pivot = ctx.animated.find((e) => e.object.children[0]?.material?.uniforms?.strength).object,
    glass = ctx.lamps.at(-1),
    v = new T.Vector3();
  let tris = 0,
    top = 0,
    reach = 0;
  tower.traverse((m) => {
    if (!m.isMesh) return;
    tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      top = Math.max(top, v.y);
      reach = Math.max(reach, Math.hypot(v.x - rx, v.z - rz));
    }
  });
  assert(top <= 6.1 && top > 5.6, `The lighthouse stands ${top.toFixed(2)} tall.`);
  assert(reach <= 2.95, `The lighthouse reaches ${reach.toFixed(2)} from its rock's axis.`);
  assert(tris <= 15000, `The lighthouse costs ${Math.round(tris)} triangles.`);
  const glassY = glass.getWorldPosition(v).y;
  assert(glassY > L.glazing[0] && glassY < L.glazing[1] && Math.abs(pivot.position.y - glassY) < 1e-6, 'The beam no longer leaves from the lantern glass.');
  // Out from the outline at a bearing and radius about the rock (bearings point along sin, cos).
  const out = (a, r) => {
    const px = rx + Math.sin(a) * r,
      pz = rz + Math.cos(a) * r;
    return plan.distanceToPolyline([px, pz], plan.islandOutline, true) * (plan.onIsland(px, pz, 0) ? -1 : 1);
  };
  const stairBox = new T.Box3().setFromObject(stage.getObjectByName('lighthouse-stair')),
    stairFoot = Math.max(...[stairBox.min, stairBox.max].flatMap((c) => [c.x, c.z].map((n, k) => Math.abs(n - (k ? rz : rx))))) - 0.1;
  for (const da of [-0.12, 0, 0.12]) {
    const w = out(L.landward + da, stairFoot);
    assert(w >= 0.32 && w <= 2.8, `The landing stair comes down ${w.toFixed(2)} out from the outline, off the beach.`);
  }
  for (let a = 0; a < Math.PI * 2; a += 0.05) assert(out(a, L.platform[1]) >= 0.32, 'The lighthouse platform runs onto the grass.');
  const door = stage.getObjectByName('lighthouse-door');
  door.traverse((m) => {
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      const r = Math.hypot(v.x - rx, v.z - rz);
      assert(r <= L.wall[0] - 0.04, `The door case runs into the yard's parapet (${r.toFixed(2)}).`);
    }
  });
  // The base course's ends (at its outer radius, 1.1, and where it meets the shaft) lie inside a pilaster.
  const doorBox = (m) => new T.Box3().setFromBufferAttribute(m.geometry.attributes.position).applyMatrix4(m.matrix);
  const pilasters = door.children.filter((m) => m.isMesh && doorBox(m).getSize(v).y > L.lintel - L.floor - 0.01 && doorBox(m).getSize(v).x < 0.2);
  assert.equal(pilasters.length, 2, 'The door case lost its pilasters.');
  for (const s of [-1, 1])
    for (const r of [0.88, 1.1]) {
      const end = new T.Vector3(Math.sin(s * 0.31) * r, L.floor + 0.1, Math.cos(s * 0.31) * r);
      assert(pilasters.some((m) => doorBox(m).expandByScalar(1e-3).containsPoint(end)), `The base course's end at ${r} shows beside the door case.`);
    }
  const clear = ([y0, y1]) => L.bands.every(([b0, b1]) => y1 <= b0 + 0.05 || y0 >= b1 - 0.05);
  assert(clear([L.floor, L.lintel + 0.26]), 'The door case runs into a red band.');
  for (const [, y] of L.windows) assert(clear([y - 0.3, y + 0.32]), `A stair window at ${y} runs into a red band.`);
  assert.equal(L.windows.filter((w) => w[2]).length, 1, 'One beacon window.');
  let gallery = 0;
  tower.traverse((m) => {
    if (!m.isMesh || m.material.userData.surfaceKind !== 'stone') return;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      if (v.y > L.gallery - 0.01 && v.y < L.deck + 0.01) gallery = Math.max(gallery, Math.hypot(v.x - rx, v.z - rz));
    }
  });
  assert(gallery > 0.9 + 0.15, `The gallery (${gallery.toFixed(2)}) is not wider than the shaft's foot.`);
}
// The raised timber pier (town-harbour's pierAndHarbour, plan.PIER_DECK), built alone: its planks
// stand at the deck height; nothing but the pier's own frame (planks, stringers, headstocks,
// piles and the other braces) or weed reaches into a brace's box, so the crates, the barrel, the
// lamps and the ladder stand clear of the cross-bracing; the bracing keeps within 1.02 of the
// pier's axis and under the deck; the quay head and its steps stay 0.03 clear of the hut, on the
// island, off the streets and 0.6 from every tree's trunk; the ladder hangs on the head's end and
// the boat's middle keeps 1.1 from it.
{
  const { createHarbour } = await load('town-harbour'),
    { createProps } = await load('town-props'),
    { createKit } = await load('town-kit'),
    { createCityMaterials } = await load('city-materials'),
    library = createCityMaterials(),
    ctx = { library, material: library.material, season: 'summer', land: new T.Group(), lamps: [], clocks: [], animated: [] },
    kit = createKit(ctx),
    stage = new T.Group(),
    D = plan.PIER_DECK;
  createHarbour(ctx, kit, createProps(ctx, kit)).pierAndHarbour(stage);
  stage.updateMatrixWorld(true);
  const pier = stage.getObjectByName('pier'),
    toPier = pier.matrixWorld.clone().invert(),
    v = new T.Vector3(),
    local = (m) => {
      const box = new T.Box3(),
        p = m.geometry.attributes.position,
        to = toPier.clone().multiply(m.matrixWorld);
      for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(to));
      return box;
    },
    meshes = [];
  pier.traverse((m) => m.isMesh && meshes.push(m));
  const braces = meshes.filter((m) => m.userData.brace);
  assert(braces.length >= 2 * 2 * (D.piles.length - 1) + 2 * D.piles.length, `The pier lost its cross-bracing (${braces.length} braces).`);
  const braceBoxes = braces.map(local);
  for (const b of braceBoxes) assert(Math.max(-b.min.x, b.max.x) <= 1.02 && b.max.y <= D.deck - 0.1 && b.min.y >= -0.3, 'A brace leaves the space under the deck.');
  // Each part against each brace in their own frames: no vertex of a part inside a brace, and no
  // brace vertex inside a solid box or drum (a crate, the barrel); a rope's or a lathe's box is
  // no solid, so the second test skips them.
  const own = (m) => {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      return m.geometry.boundingBox.clone().expandByScalar(-0.01);
    },
    pokes = (a, b) => {
      const to = b.matrixWorld.clone().invert().multiply(a.matrixWorld),
        box = own(b),
        p = a.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) if (box.containsPoint(v.fromBufferAttribute(p, i).applyMatrix4(to))) return true;
      return false;
    };
  for (const m of meshes) {
    if (m.userData.pierFrame || m.material.userData.surfaceKind === 'foliage') continue;
    const solid = ['BoxGeometry', 'RoundedBoxGeometry', 'CylinderGeometry'].includes(m.geometry.type);
    for (const b of braces) assert(!pokes(m, b) && !(solid && pokes(b, m)), `Something on the pier runs into its bracing at ${local(m).getCenter(v).toArray().map((n) => n.toFixed(2))}.`);
  }
  for (const m of meshes.filter((m) => m.userData.pierFrame && !m.userData.brace && m.material.userData.surfaceKind === 'wood' && local(m).getSize(v).y < 0.12))
    assert(Math.abs(local(m).max.y - D.deck) <= 0.015, 'A plank left the deck height.');
  // The quay head and its steps keep 0.03 clear of the hut below its eaves.
  const quay = new T.Box3();
  stage.getObjectByName('harbour-quay').traverse((m) => m.isMesh && quay.union(local(m)));
  quay.expandByScalar(0.03);
  stage.getObjectByName('harbour-hut').traverse((m) => {
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position,
      to = toPier.clone().multiply(m.matrixWorld);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(to);
      assert(v.y > 1.6 || !quay.containsPoint(v), 'The quay head runs into the harbour hut.');
    }
  });
  const corners = [[quay.min.x, quay.min.z], [quay.max.x, quay.min.z], [quay.min.x, 0], [quay.max.x, 0]].map(([x, z]) => plan.pierPoint(x, z));
  for (const [x, z] of corners) assert(plan.onIsland(x, z, 0) && plan.distanceToStreets(x, z) > plan.PAVEMENT_WIDTH + 0.3, 'The quay head leaves the grass for the street or the sand.');
  for (const t of plan.plantingPlan()) {
    const lx = (t.x - plan.pier.start[0]) * plan.pier.dir[1] - (t.z - plan.pier.start[1]) * plan.pier.dir[0],
      lz = (t.x - plan.pier.start[0]) * plan.pier.dir[0] + (t.z - plan.pier.start[1]) * plan.pier.dir[1];
    const gap = Math.hypot(Math.max(0, quay.min.x - lx, lx - quay.max.x), Math.max(0, quay.min.z - lz, lz - quay.max.z));
    assert(gap >= 0.6, `The quay head comes within ${gap.toFixed(2)} of ${t.id}'s trunk.`);
  }
  // The ladder: on the head's end, from under the water to over the boards, and clear of the boat.
  const ladder = meshes.filter((m) => m.material.userData.surfaceKind === 'iron' && Math.abs(local(m).getCenter(v).z - (plan.pier.length + 0.25)) < 0.05);
  assert(ladder.length >= 5, 'The pier head lost its ladder.');
  const rungs = ladder.map(local).reduce((a, b) => a.union(b), new T.Box3());
  assert(rungs.min.y < model.waterLevel - 0.1 && rungs.max.y > D.deck + 0.2, 'The ladder no longer reaches from the water to over the boards.');
  const [lx0, lz0] = plan.pierPoint(D.ladder.x, plan.pier.length + 0.25);
  for (let i = 0; i < 2000; i++) {
    const pose = plan.boatPose(i * 0.05);
    assert(Math.hypot(pose.x - lx0, pose.z - lz0) >= 1.1, `The boat runs into the pier ladder at t=${(i * 0.05).toFixed(2)}.`);
  }
}
// The park and street props and the building site (town-props' pavilion, phoneBox, bin, bench,
// memoryBoard, cycleHoop and crane), each built alone before batching:
// - the bandstand keeps its plinth within the old octagon (2.01 to a corner), its steps on the
//   gravel spur, and everything over the plinth within 2.12 of its axis, under 4.75; it stays 0.2 clear of
//   the picnic rug and 0.1 of the two benches; from the overview and the Life chapter the frieze's
//   roundels show under the eaves (a ray to the plate just above the middle roundel of the face
//   towards the camera hits the plate, not the roof); at most 11k triangles in 8 meshes;
// - the phone box stands within its 0.84 plinth square and under 2.1, with its four glazed faces
//   lit all night ('kiosk'); the bin within 0.26 of its axis and under 0.9; the bench within its
//   old 1.3 x 0.6 footprint (0.33 back, 0.27 forward) and under 0.95; the memory board within
//   0.95 x 0.35 and under 2; the cycle hoop within 0.33 x 0.08, under 0.5, casting nothing;
// - the crane's site: everything but the slewing part stays within 0.16 of the hoarding's line
//   (its posts and caps stand outside the panels), nothing but the mast stands on its footing, nothing but the hoarding's posts rises
//   over the capping rail (1.06), and every site pane (the cab's and the site cabin's) is unlit
//   at night and shares one light; the slewing part reaches no more than 6.5 from the mast, its
//   load hangs clear over the hoarding, and it batches into at most 5 meshes; the whole site costs
//   at most 9000 triangles.
{
  const { createProps } = await load('town-props'),
    { createKit } = await load('town-kit'),
    { createCityMaterials } = await load('city-materials'),
    { bandstandAt, HOARDING_THICKNESS } = await load('town-shared'),
    library = createCityMaterials(),
    ctx = { library, material: library.material, season: 'summer', land: new T.Group(), lamps: [], clocks: [], animated: [] },
    props = createProps(ctx, createKit(ctx)),
    v = new T.Vector3();
  const meshesOf = (root) => {
      const out = [];
      root.updateMatrixWorld(true);
      root.traverse((o) => o.isMesh && out.push(o));
      return out;
    },
    trisOf = (list) => list.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0),
    each = (list, fn) => {
      for (const m of list) {
        const p = m.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) fn(v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld), m);
      }
    },
    /** Distance from (x, z) to a rectangle centred at (cx, cz), half-sizes (hx, hz), turned by ry. */
    toRect = (x, z, cx, cz, hx, hz, ry) => {
      const c = Math.cos(ry),
        s = Math.sin(ry),
        lx = Math.abs((x - cx) * c - (z - cz) * s) - hx,
        lz = Math.abs((x - cx) * s + (z - cz) * c) - hz;
      return Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, lz), 0);
    };
  // The bandstand, where the park puts it.
  {
    const stage = new T.Group(),
      [bx, bz] = bandstandAt(),
      { park } = plan;
    props.pavilion(stage, bx, 0.1, bz);
    const list = meshesOf(stage);
    assert(trisOf(list) <= 11000 && list.length <= 8, `The bandstand costs ${trisOf(list)} triangles in ${list.length} meshes.`);
    let top = 0;
    each(list, (p) => {
      const x = p.x - bx,
        z = p.z - bz,
        r = Math.hypot(x, z),
        // The octagon's apothem along this point's direction (faces square to the axes).
        apothem = Math.max(...[0, 1, 2, 3].map((k) => Math.abs(x * Math.cos((k * Math.PI) / 4) + z * Math.sin((k * Math.PI) / 4))));
      top = Math.max(top, p.y);
      if (p.y < 0.6) assert(apothem <= 1.871 || (Math.abs(x) <= 0.52 && z <= 2.5), `The bandstand's plinth spreads to ${apothem.toFixed(3)} at ${x.toFixed(2)}, ${z.toFixed(2)}.`);
      if (p.y >= 0.45) assert(r <= 2.12, `The bandstand reaches ${r.toFixed(3)} from its axis.`);
      if (p.y < 1.2) {
        assert(toRect(p.x, p.z, -12.25, 10.08, 0.55, 0.4, 0.12) >= 0.2, 'The bandstand crowds the picnic rug.');
        for (const sx of [-2.6, 1.4]) assert(toRect(p.x, p.z, park.x + sx, park.z + 2.1, 0.65, 0.32, 0) >= 0.1, 'The bandstand crowds a park bench.');
      }
    });
    assert(top - 0.1 <= 4.75, `The bandstand's finial stands ${(top - 0.1).toFixed(2)} over the turf.`);
    // The roundels show under the eaves: the plate (its outer face 1.487 out) beside the middle
    // roundel, level with the roundels' tops (2.52 up), on the face towards the camera.
    const ray = new T.Raycaster();
    for (const bearing of [plan.chapterBearings.overview, plan.chapterBearings['corner-park']]) {
      const th = Math.round(bearing / (Math.PI / 4)) * (Math.PI / 4),
        aim = new T.Vector3(bx + 1.488 * Math.sin(th) + 0.15 * Math.cos(th), 0.1 + 2.52, bz + 1.488 * Math.cos(th) - 0.15 * Math.sin(th)),
        dir = new T.Vector3(Math.sin(bearing) * 38, 35, Math.cos(bearing) * 38).normalize().negate();
      ray.set(aim.clone().addScaledVector(dir, -50), dir);
      const hit = ray.intersectObjects(list, false)[0];
      assert(hit && hit.point.distanceTo(aim) < 0.03, `At bearing ${bearing.toFixed(2)} the eaves hide the bandstand's frieze roundels.`);
    }
  }
  // The street furniture, each at its own origin.
  {
    const stage = new T.Group();
    const extent = (build, name) => {
      const g = new T.Group();
      stage.add(g);
      build(g);
      const list = meshesOf(g),
        box = new T.Box3();
      for (const m of list) box.expandByObject(m);
      return { list, box, name };
    };
    const phone = extent((g) => props.phoneBox(g, 0, 0, 0)),
      bin = extent((g) => props.bin(g, 0, 0, 0)),
      bench = extent((g) => props.bench(g, 0, 0, 0)),
      board = extent((g) => props.memoryBoard(g, 0, 0, 0, 0)),
      hoop = extent((g) => props.cycleHoop(g, 0, 0, 0));
    assert(phone.box.max.x <= 0.4201 && phone.box.min.x >= -0.4201 && phone.box.max.z <= 0.4201 && phone.box.min.z >= -0.4201 && phone.box.max.y <= 2.1, 'The phone box spreads beyond its plinth or stands 2.1 or taller.');
    assert.equal(phone.list.filter((m) => m.userData.window === 'kiosk').length, 4, 'The phone box keeps four lit panes.');
    assert(trisOf(phone.list) <= 3000, `The phone box costs ${trisOf(phone.list)} triangles.`);
    each(bin.list, (p) => assert(Math.hypot(p.x, p.z) <= 0.26 && p.y <= 0.9, 'The bin spreads beyond 0.26 or stands 0.9 or taller.'));
    assert(bench.box.max.x <= 0.65 && bench.box.min.x >= -0.65 && bench.box.min.z >= -0.33 && bench.box.max.z <= 0.27 && bench.box.max.y <= 0.95, 'The bench leaves its footprint.');
    assert(board.box.max.x <= 0.95 && board.box.min.x >= -0.95 && Math.max(board.box.max.z, -board.box.min.z) <= 0.35 && board.box.max.y <= 2, 'The memory board leaves its footprint.');
    assert(hoop.box.max.x <= 0.33 && hoop.box.min.x >= -0.33 && Math.max(hoop.box.max.z, -hoop.box.min.z) <= 0.08 && hoop.box.max.y <= 0.5, 'The cycle hoop is no longer 0.57 wide and under a bike bar.');
    assert(hoop.list.every((m) => !m.castShadow && m.userData.noShadow), 'A cycle hoop casts a shadow.');
    assert(trisOf([...bin.list, ...bench.list, ...board.list, ...hoop.list]) <= 3200, 'The bin, bench, board and hoop cost too much.');
  }
  // The building site.
  {
    const stage = new T.Group(),
      P = plan.reservedPlot;
    props.crane(stage, P.x, P.z);
    const all = meshesOf(stage),
      slewing = ctx.animated[ctx.animated.length - 1].object,
      onJib = new Set(meshesOf(slewing)),
      mast = stage.children[0],
      onMast = new Set(meshesOf(mast).filter((m) => !onJib.has(m))),
      ground = all.filter((m) => !onJib.has(m)),
      out = HOARDING_THICKNESS + 0.04; // the posts and the gate posts' caps stand outside the panels
    assert(trisOf(all) <= 9000, `The building site costs ${trisOf(all)} triangles.`);
    each(ground, (p, m) => {
      const x = p.x - P.x,
        z = p.z - P.z;
      assert(Math.abs(x) <= P.w / 2 + out && Math.abs(z) <= P.d / 2 + out, `The site spills over its hoarding at ${x.toFixed(2)}, ${z.toFixed(2)}.`);
      if (!onMast.has(m) && p.y > 0.05) assert(Math.max(Math.abs(x), Math.abs(z)) >= 0.9 - 1e-6, `Something stands on the crane's footing at ${x.toFixed(2)}, ${z.toFixed(2)}.`);
      if (!onMast.has(m) && p.y > 1.06) assert(Math.max(Math.abs(x), Math.abs(z)) >= P.w / 2 - 0.15, `Something on the site rises over the hoarding at ${x.toFixed(2)}, ${z.toFixed(2)}.`);
    });
    const panes = all.filter((m) => m.material.userData.surfaceKind === 'glass');
    assert(panes.length >= 4 && panes.every((m) => m.userData.window === 'unlit' && m.userData.windowGroup === 'building-site'), 'A site pane would light at night or keep a light of its own.');
    let reach = 0,
      low = Infinity;
    each([...onJib], (p) => {
      reach = Math.max(reach, Math.hypot(p.x - P.x, p.z - P.z));
      if (Math.hypot(p.x - P.x, p.z - P.z) > 3.6) low = Math.min(low, p.y);
    });
    assert(reach <= 6.5 && low >= 1.5, `The slewing part reaches ${reach.toFixed(2)} and hangs down to ${low.toFixed(2)}.`);
    assert(new Set([...onJib].map((m) => `${m.material.userData.surfaceKind}|${m.castShadow && !m.userData.noShadow && m.material.userData.surfaceKind !== 'glass'}`)).size <= 5, 'The slewing part batches into more than five meshes.');
  }
}
// The sky island: a floating island of its own off the north-west headland (plan.SKY), built in its
// own groups and phases. Its deck, lawn, paths, coping and rock; its villa in place (the next block
// checks the villa's own build); the slots and stations its garden and her figure are to take; its
// pointer volume, its overview marks, its own frame and its shadows; and its clearances from the
// coast, the land on screen and everything that moves. (check-navigation holds its framings: the
// overview, its file, the tour and where it is hidden.)
let skyReport = '';
{
  const { WATER } = await load('town-shared'),
    { SKY_LOOK, SKY_LAWN, SKY_COPING, SKY_ROCK, SKY_BEDS, SKY_TREE_SEED, skySlots } = await load('town-sky'),
    { addSkyHit, skyMarks, skyFit, SKY_HIT, SKY_SHADOW, skyShadowWanted, TOWN_PITCH, SKY_PITCH } = await load('city-scene'),
    { SEA_SHADOW, createSeaShadow } = await load('city-water'),
    { palette } = await load('town-shared'),
    { sunOffsetFor } = await load('city-atmosphere'),
    S = plan.SKY,
    V = plan.SKY_VILLA,
    site = plan.sites['sky-island'],
    sky = model.sky,
    deg = Math.PI / 180,
    v = new T.Vector3(),
    each = (group, visit) =>
      group.traverse((o) => {
        if (!o.isMesh) return;
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) visit(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld), o, i);
      }),
    trianglesOf = (o) => (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3,
    // What moves on the island (the garden's falls, clouds and floating rocks, each part on a pivot of
    // its own, Alison, whose root is a pivot of its own, and the rock's night), and the pivot a mesh
    // hangs on, if it hangs on one.
    under = (o, root) => {
      for (let p = o; p; p = p.parent) if (p === root) return true;
      return false;
    },
    skyMoving = model.animated.filter((e) => under(e.object, sky.root)),
    her = sky.root.children.find((o) => o.name === 'alison'),
    pivotOf = (o) => {
      for (let p = o.parent; p && p !== sky.root; p = p.parent) if (p.userData.keepSeparate) return p;
      return null;
    },
    // A point in the deck's own frame (x along its long axis).
    local = (x, z) => [(x - S.x) * Math.cos(S.heading) - (z - S.z) * Math.sin(S.heading), (x - S.x) * Math.sin(S.heading) + (z - S.z) * Math.cos(S.heading)],
    stops = [0, 1, 2, 3].map((k) => Math.PI / 4 + (k * Math.PI) / 2),
    file = plan.chapterBearings['sky-island'],
    drifts = [-0.16, -0.08, 0, 0.08, 0.16],
    // A view's axes at a bearing (city-scene's viewOffset), at the town's pitch unless given one: the
    // way back to the camera, screen right and up.
    axes = (bearing, pitch = TOWN_PITCH) => {
      const back = pitch === TOWN_PITCH ? new T.Vector3(Math.sin(bearing) * 38, 35, Math.cos(bearing) * 38).normalize() : new T.Vector3(Math.sin(bearing) * Math.cos(pitch), Math.sin(pitch), Math.cos(bearing) * Math.cos(pitch)),
        right = new T.Vector3(Math.cos(bearing), 0, -Math.sin(bearing)),
        up = new T.Vector3().crossVectors(back, right);
      return { back, right, up, flat: (p) => [p.x * right.x + p.z * right.z, p.x * up.x + p.y * up.y + p.z * up.z] };
    };
  // The island as the frozen frame has it (Pause and reduced motion hold the town at time 0): an
  // earlier check turned the whole town to 37 s, which carried the garden's clouds, rocks and lumps along.
  for (const e of skyMoving) e.update(0, 0, 0);
  city.updateMatrixWorld(true);
  /** The convex outline of points [u, v] (anticlockwise). */
  const hullOf = (points) => {
    const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]),
      half = (list) => {
        const out = [];
        for (const p of list) {
          while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
          out.push(p);
        }
        out.pop();
        return out;
      };
    return [...half(sorted), ...half(sorted.reverse())];
  };
  /** How far a point lies outside a convex outline (negative: that far inside its nearest edge). */
  const outside = (hull, [x, y]) => {
    let inside = Infinity,
      beyond = Infinity,
      out = false;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i],
        b = hull[(i + 1) % hull.length],
        ex = b[0] - a[0],
        ey = b[1] - a[1],
        l = Math.hypot(ex, ey) || 1,
        // Positive to the left of the edge: inside an anticlockwise outline.
        side = (ex * (y - a[1]) - ey * (x - a[0])) / l,
        t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / (l * l)));
      if (side < 0) out = true;
      inside = Math.min(inside, side);
      beyond = Math.min(beyond, Math.hypot(x - a[0] - ex * t, y - a[1] - ey * t));
    }
    return out ? beyond : -inside;
  };
  const areaOf = (hull) => Math.abs(hull.reduce((sum, a, i) => sum + a[0] * hull[(i + 1) % hull.length][1] - hull[(i + 1) % hull.length][0] * a[1], 0)) / 2;
  /**
   * The clouds and floating rocks the garden hangs in their slots (plan.SKY_CLOUDS and SKY_ROCKS),
   * each as the surface of the volume that stands in for it (plan.SKY_FLOAT_PROXY, in its slot's
   * frame and in units of its size; check-navigation measures the same volumes): it holds lane G's
   * piece through its whole drift or bob, as the garden's check below holds it to. They stand in for
   * the pieces wherever a check below measures the island's shape on screen or in the air through
   * the motion.
   */
  const FLOAT_PROXY = plan.SKY_FLOAT_PROXY,
    /** How far into its proxy a point lies (in its slot's frame, in units of its size): 1 on its surface. */
    proxyMeasure = (kind, [x, y, z]) => {
      if (kind === 'rock') return (x * x + z * z) / FLOAT_PROXY.rock.r ** 2 + (y / (y > 0 ? FLOAT_PROXY.rock.up : FLOAT_PROXY.rock.down)) ** 2;
      const P = FLOAT_PROXY.cloud,
        e = (x / P.a) ** 2 + (z / P.c) ** 2;
      return y < P.base ? Infinity : y <= P.wall ? e : e + ((y - P.wall) / P.cap) ** 2;
    },
    floatPoints = (f, kind) => {
      const out = [],
        m = new T.Matrix4().makeRotationY(f.ry).setPosition(f.x, f.y, f.z);
      for (let k = 0; k < 24; k++) {
        const cu = Math.cos((k / 24) * Math.PI * 2),
          su = Math.sin((k / 24) * Math.PI * 2);
        if (kind === 'cloud') {
          const P = FLOAT_PROXY.cloud;
          // Its wall from the base up, the dome over it, and the base's rings.
          for (const y of [P.base, (P.base + P.wall) / 2, P.wall]) out.push(new T.Vector3(cu * P.a, y, su * P.c));
          for (let b = 1; b <= 6; b++) {
            const w = (b / 6) * (Math.PI / 2);
            out.push(new T.Vector3(cu * P.a * Math.cos(w), P.wall + Math.sin(w) * P.cap, su * P.c * Math.cos(w)));
          }
          for (const s of [0.33, 0.67]) out.push(new T.Vector3(cu * P.a * s, P.base, su * P.c * s));
        } else
          for (let b = 0; b <= 8; b++) {
            const P = FLOAT_PROXY.rock,
              w = (b / 8) * Math.PI - Math.PI / 2;
            out.push(new T.Vector3(cu * P.r * Math.cos(w), Math.sin(w) * (w > 0 ? P.up : P.down), su * P.r * Math.cos(w)));
          }
      }
      return out.map((p) => p.multiplyScalar(f.size).applyMatrix4(m));
    };
  const floats = [...plan.SKY_CLOUDS.map((f) => floatPoints(f, 'cloud')), ...plan.SKY_ROCKS.map((f) => floatPoints(f, 'rock'))];

  /* ---------------- the spot, the deck's maths and the sea below ---------------- */
  assert(S.x === -52 && S.z === -24 && S.H === 10.5 && Math.abs(S.top - (WATER + S.H)) < 1e-9 && S.a === 7.5 && S.b === 6 && Math.abs(S.heading - Math.PI / 2) < 1e-12, 'The sky island is off its decided spot, height or outline.');
  // The rock's tip: as deep as the sea allows and no deeper, 1.5 over it (lower, it reads as a stilt
  // standing in the water), and leaning SKY.lean out toward the island's file's camera, so that from
  // there it hangs clear below the body's near side.
  const tipAt = plan.skyTip();
  assert(Math.abs(tipAt.y - (S.top - S.depth)) < 1e-9 && Math.abs(tipAt.y - WATER - 1.5) < 1e-9 && S.lean >= 0.5 && S.lean <= 1.5 && Math.abs(Math.hypot(tipAt.x - S.x, tipAt.z - S.z) - S.lean) < 1e-9 && Math.abs(plan.angleDiff(Math.atan2(tipAt.x - S.x, tipAt.z - S.z), file)) < 1e-9, `The rock's tip is at ${[tipAt.x, tipAt.y, tipAt.z].map((n) => n.toFixed(2)).join(', ')}.`);
  // The villa: front due south (turned more than about 15 degrees toward the camera's right at the
  // opening bearing, it loses the key light there and in its file), its house block's middle 0.8
  // north of the island's, its foot on the deck. Its file is seen from the gate's bearing (no new
  // bearing), the front 35 degrees off and turned to the camera's left, the lit side.
  const [houseX, houseZ] = plan.skyVillaPoint(0, (V.house.back + V.house.front) / 2);
  assert(site.rotation === 0 && site.y === S.top && V.back === 0.8 && Math.abs(houseX - S.x) < 1e-9 && Math.abs(houseZ - (S.z - V.back)) < 1e-9, 'The villa is off its place on the deck, or no longer faces due south.');
  assert(site.w === V.w && site.d === V.d && site.height === V.height && V.house.front - V.house.back === 4.4 && 2 * V.house.hw === 6.4, 'The villa\'s site is not its footprint.');
  // The villa's tallest can reaches 8.17 over its y 0 and the placement caps the island's roofline
  // at the deck plus 8.2, so its y 0 may stand no higher than 10.50 (on the dome's crest, not above it).
  assert(site.y <= 10.5 && V.chimneys.cans <= V.height && V.height <= 8.2, 'The villa\'s foot or its chimneys stand over the placement\'s cap.');
  assert.equal(file, plan.chapterBearings['lius-gate'], 'The sky island\'s file brings a new bearing.');
  assert(Math.abs(plan.angleDiff(file, site.rotation) - 34.7 * deg) < 0.01, 'The sky island\'s file no longer sees the villa\'s front 35 degrees off, on its lit side.');
  // The rim: skyDistance is the distance from the ellipse itself (a fine polyline of it), signed.
  {
    const fine = plan.skyOutline(0, 3000).map((p) => [p.x, p.z]);
    let worst = 0;
    for (let x = S.x - 9; x <= S.x + 9; x += 0.75)
      for (let z = S.z - 10.5; z <= S.z + 10.5; z += 0.75) {
        const d = plan.distanceToPolyline([x, z], fine, true) * (plan.skyRadius(x, z) <= 1 ? -1 : 1);
        worst = Math.max(worst, Math.abs(plan.skyDistance(x, z) - d));
      }
    assert(worst < 0.01, `skyDistance is ${worst.toFixed(3)} off the deck's true outline.`);
    // Its long axis runs north-south; onSky's margin is a level of that distance.
    assert(Math.abs(plan.skyDistance(S.x, S.z - S.a)) < 1e-6 && Math.abs(plan.skyDistance(S.x + S.b, S.z)) < 1e-6 && Math.abs(plan.skyDistance(S.x, S.z) + S.b) < 1e-6, 'The deck is not 12 across and 15 long, north to south.');
    assert(plan.onSky(S.x + S.b - 1.01, S.z, -1) && !plan.onSky(S.x + S.b - 0.99, S.z, -1) && plan.onSky(S.x + S.b + 0.4, S.z, 0.5) && !plan.onSky(S.x + S.b + 0.6, S.z, 0.5), 'onSky\'s margin is not a level of the signed distance.');
    for (let b = 0; b < Math.PI * 2; b += 0.13) {
      const p = plan.skyRim(b),
        q = plan.skyRim(b, 1),
        r = plan.skyRim(b, -1);
      assert(Math.abs(plan.skyDistance(p.x, p.z)) < 1e-3 && Math.abs(plan.skyDistance(q.x, q.z) - 1) < 0.01 && Math.abs(plan.skyDistance(r.x, r.z) + 1) < 0.01, `skyRim is off the rim at bearing ${b.toFixed(2)}.`);
      assert(Math.abs(Math.hypot(p.nx, p.nz) - 1) < 1e-9 && Math.abs(plan.angleDiff(Math.atan2(p.x - S.x, p.z - S.z), b)) < 1e-6, `skyRim's point is not on bearing ${b.toFixed(2)}.`);
    }
    // The outline runs clockwise seen from above (north, east, south, west), as the airport's does.
    const ring = plan.skyOutline(0, 8);
    assert(ring[0].z < S.z && ring[2].x > S.x && ring[4].z > S.z && ring[6].x < S.x, 'The deck\'s outline does not run clockwise from its north end.');
    // The lawn: a soft dome from the deck's level at the middle down to SKY.dome below it at the rim.
    assert.equal(plan.skyTop(S.x, S.z), S.top);
    assert(Math.abs(plan.skyTop(S.x + S.b, S.z) - (S.top - S.dome)) < 1e-9 && Math.abs(plan.skyTop(S.x + 20, S.z - 3) - (S.top - S.dome)) < 1e-9 && S.dome >= 0.2 && S.dome <= 0.3, 'The lawn does not fall to its rim level, or the dome is steeper than the villa\'s foot allows.');
    for (let b = 0; b < Math.PI * 2; b += 0.4)
      for (let k = 0.05; k <= 1; k += 0.05) {
        const a = plan.skyRim(b, 0),
          at = (f) => plan.skyTop(S.x + (a.x - S.x) * f, S.z + (a.z - S.z) * f);
        assert(at(k) <= at(k - 0.05) + 1e-12, 'The lawn rises toward the rim.');
      }
    // Half way out it has fallen by under a sixth of the dome: the lawn before the terrace is all but level.
    assert(S.top - plan.skyTop(S.x, S.z + S.a / 2) < S.dome / 6, 'The lawn is not level enough before the terrace.');
  }
  // The sea below: the rim 12 or more from the town's waterline and 28 from the airport's armour, and
  // the rim grown by 2 over no land at all.
  const waterline = (x, z) => plan.distanceToPolyline([x, z], plan.islandOutline, true) * (plan.onIsland(x, z) ? -1 : 1) - 3.3;
  let coast = Infinity,
    armour = Infinity;
  for (const p of plan.skyOutline(0, 240)) {
    coast = Math.min(coast, waterline(p.x, p.z));
    armour = Math.min(armour, plan.airportDistance(p.x, p.z) - plan.AIRPORT.armour);
  }
  assert(coast >= 12 && armour >= 28, `The sky island's rim is ${coast.toFixed(1)} from the town's waterline and ${armour.toFixed(1)} from the airport's armour.`);
  for (const p of plan.skyOutline(2, 240)) assert(waterline(p.x, p.z) > 0 && plan.airportDistance(p.x, p.z) > plan.AIRPORT.armour, 'The sky island hangs over land.');
  // The ground masks know nothing of it: no pad under its villa, no shallows, no lawn (the sea under it stays deep).
  {
    const { MASK_EXTENT, MASK_SIZE } = await load('town-shared'),
      data = model.groundMasks.image.data;
    for (let x = S.x - S.b - 2; x <= S.x + S.b + 2; x += 0.3)
      for (let z = S.z - S.a - 2; z <= S.z + S.a + 2; z += 0.3) {
        const i = Math.floor(((x + MASK_EXTENT) / (2 * MASK_EXTENT)) * MASK_SIZE),
          j = Math.floor(((z + MASK_EXTENT) / (2 * MASK_EXTENT)) * MASK_SIZE);
        for (let c = 0; c < 4; c++) assert.equal(data[(j * MASK_SIZE + i) * 4 + c], 0, `The ground masks carry something under the sky island at ${x.toFixed(1)}, ${z.toFixed(1)}.`);
      }
  }

  /* ---------------- its groups, phases, materials and budget ---------------- */
  assert(sky.root.name === 'sky-island' && sky.root.userData.buildingId === 'sky-island' && sky.root.parent === city, 'The sky island has no root of its own in the town.');
  assert(her && her.userData.keepSeparate && her.userData.prebatched, 'Alison is not on the sky island\'s root, a pivot of her own outside its batches.');
  assert.deepEqual(sky.root.children, [sky.land, sky.rock, sky.shell, her], 'The sky island\'s root holds something else than its ground, its rock, its villa and Alison.');
  assert(sky.shell.position.equals(new T.Vector3(site.x, site.y, site.z)) && sky.shell.rotation.y === site.rotation && sky.land.position.lengthSq() === 0 && sky.rock.position.lengthSq() === 0, 'The villa\'s shell is not in its own frame on the deck.');
  // Built and batched in phases of its own (never in 'batch land', the longest), each held to its own limit (timed builds, above).
  assert.equal(phaseNames[phaseNames.indexOf('airport ground') + 1], 'sky ground', 'The sky island\'s ground is not built after the airport\'s.');
  assert.equal(phaseNames[phaseNames.indexOf('sky ground') + 1], 'sky rock', 'The sky island\'s rock is not sculpted in a phase of its own.');
  assert.equal(phaseNames[phaseNames.indexOf('batch airport') + 1], 'batch sky', 'The sky island is not batched right after the airport.');
  assert(phaseNames.includes('batch sky villa'), 'The sky island\'s villa is not batched in a phase of its own.');
  for (const [name, limit] of [['sky ground', 550], ['sky rock', 300], ['batch sky', 70], ['batch sky villa', 270]]) inTime(`The '${name}' phase`, phaseTimes.get(name), limit);
  each(model.land, (p) => assert(Math.abs(p.x - S.x) > S.b + 4 || Math.abs(p.z - S.z) > S.a + 4, 'Something of the sky island is in the land\'s batch.'));
  // Nothing two-sided, nothing that cuts holes, nothing see-through (its water, foam and clouds are
  // opaque too); every mesh batched, with a surface kind (but the garden lamps' globes, the lamps' own
  // glass, lit with the town's lamps and never batched); everything takes shadow but those globes and
  // the garden's pale parts (its falls, their puffs and its clouds, on the garden kit's own material:
  // half in the island's shadow a cloud reads as a grey boulder); within its own caps.
  let skyMeshes = 0,
    skyTriangles = 0;
  const skyKinds = new Set();
  sky.root.traverse((o) => {
    if (!o.isMesh) return;
    skyMeshes++;
    skyTriangles += trianglesOf(o);
    skyKinds.add(o.material.userData.surfaceKind);
    const globe = model.lamps.includes(o);
    assert(o.material.userData.surfaceKind && (o.material.vertexColors || (globe && o.material.userData.surfaceKind === 'glass')), 'A mesh of the sky island has no surface kind, or is not batched.');
    assert.notEqual(o.material.side, T.DoubleSide, `${o.material.name} on the sky island is two-sided.`);
    assert(!o.material.transparent && o.material.opacity === 1 && !o.material.alphaTest, `${o.material.name} on the sky island is see-through.`);
    assert(!o.material.onBeforeCompile || !patchedShader(o.material).fragmentShader.includes('discard'), `${o.material.name} on the sky island cuts holes.`);
    assert(o.receiveShadow || globe || o.material.userData.skyGardenOwn, 'A mesh of the sky island takes no shadow.');
  });
  // Its ground is grass and gravel (and the terrace's flags, paving): never sand, asphalt or water.
  for (const kind of skyKinds) assert(!['sand', 'asphalt', 'water', 'soil'].includes(kind), `The sky island has a ${kind} surface.`);
  // The finished island's caps: the villa (lane V's detail pass, up to 16 meshes and 45,000
  // triangles), the garden (below) and her figure (lane F's Alison: 14 meshes, batched part by part,
  // the water she pours among them, and 5,000 triangles at the most) all within them.
  const SKY_CAP = { meshes: 50, triangles: 90000 },
    HER = { meshes: 14, triangles: 5000 };
  let herMeshes = 0,
    herTriangles = 0;
  her.traverse((o) => {
    if (!o.isMesh) return;
    herMeshes++;
    herTriangles += trianglesOf(o);
  });
  assert(herMeshes === HER.meshes && herTriangles <= HER.triangles, `Alison is ${herMeshes} meshes and ${herTriangles} triangles on the island.`);
  assert(skyMeshes <= SKY_CAP.meshes && skyTriangles <= SKY_CAP.triangles, `The sky island costs ${skyMeshes} meshes and ${skyTriangles} triangles, over its caps.`);
  // Its colours: each no more saturated than its family (the rock's greys than the armour's darkest,
  // its seams than the kerb's buff).
  for (const [name, colour, family] of [
    ['coping', SKY_LOOK.coping, palette.kerb],
    ['path', SKY_LOOK.path, palette.path],
    ...SKY_LOOK.earth.map((c, k) => ['earth ' + k, c, palette.soil]),
    ['seam', SKY_LOOK.seam, palette.kerb],
    ...SKY_LOOK.rock.map((c, k) => ['rock ' + k, c, palette.kerb]),
  ])
    assert(hsv(colour).s <= hsv(family).s + 1e-9, `The sky island's ${name} (${colour}) is more saturated than its family.`);
  // The earth's beds are browns, each a clear step in value from the next (the top bed dark, the
  // middle one lighter, the lowest dark again, so the strata read); the rock is a cool grey, far
  // greyer than the earth and darker than its lightest bed; both are near the armour's greys in value
  // (no black, no pale cream under the island).
  {
    const look = (hex) => ({ ...hsv(hex), v: Math.max(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)) }),
      earth = SKY_LOOK.earth.map(look),
      rock = SKY_LOOK.rock.map(look);
    assert(earth.every((c, k) => !k || Math.abs(c.v - earth[k - 1].v) > 0.08) && earth[1].v > earth[0].v && earth.every((c) => c.s > 0.3 && c.v > 0.35 && c.v < 0.65), 'The earth\'s beds are not browns a clear step apart in value.');
    assert(rock.every((c) => c.s < 0.15 && c.v > 0.4 && c.v < 0.65 && c.v < earth[1].v - 0.05) && hsv(SKY_LOOK.seam).s < 0.15, 'The rock is not a grey darker than the earth\'s lightest bed.');
  }
  assert.deepEqual(SKY_LOOK.lawn, [palette.grassDark, palette.grassLight]);

  /* ---------------- the deck: lawn and paths ---------------- */
  // (The deck's own batch holds the garden's standing parts too: one mesh a surface family.)
  const grounds = sky.land.children.filter((o) => o.isMesh),
    lawns = grounds.filter((o) => o.material.userData.surfaceKind === 'grass'),
    gravels = grounds.filter((o) => o.material.userData.surfaceKind === 'gravel'),
    [lawn] = lawns,
    [gravel] = gravels;
  assert(lawns.length === 1 && gravels.length === 1 && !lawn.castShadow && !gravel.castShadow, 'The deck is not one lawn and one set of paths, neither casting.');
  {
    // The lawn: on the dome, out to SKY_LAWN.edge under the coping, mown in stripes each one flat
    // colour (no texture to shimmer), alternately the lawn's two greens, 0.5 wide or more.
    const p = lawn.geometry.attributes.position,
      c = lawn.geometry.attributes.color,
      stripes = new Map(),
      tones = new Set();
    let reach = 0;
    for (let t = 0; t < p.count; t += 3) {
      const tone = [c.getX(t), c.getY(t), c.getZ(t)].map((n) => n.toFixed(4)).join();
      let mid = 0;
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(p, t + k);
        assert(Math.abs(v.y - plan.skyTop(v.x, v.z)) < 1e-4, 'The lawn is off its dome.');
        assert([c.getX(t + k), c.getY(t + k), c.getZ(t + k)].map((n) => n.toFixed(4)).join() === tone, 'A triangle of the lawn is not one flat colour.');
        reach = Math.max(reach, plan.skyRadius(v.x, v.z));
        mid += local(v.x, v.z)[1] / 3;
      }
      tones.add(tone);
      const stripe = Math.floor(mid / SKY_LAWN.stripe);
      assert((stripes.get(stripe) ?? tone) === tone, 'A stripe of the lawn is in two colours.');
      stripes.set(stripe, tone);
    }
    assert(tones.size === 2 && SKY_LAWN.stripe >= 0.5 && Math.abs(reach - SKY_LAWN.edge) < 1e-6, `The lawn is not two greens in stripes, or stops ${reach.toFixed(3)} of the way to the rim.`);
    const order = [...stripes.keys()].sort((a, b) => a - b);
    assert(order.length >= 12 && order.every((k, i) => !i || (k === order[i - 1] + 1 && stripes.get(k) !== stripes.get(k - 1))), 'The lawn\'s stripes do not alternate.');
    // The outermost stripe that shows beside the coping is no sliver.
    const shows = S.b + SKY_COPING.profile[0][0];
    assert(shows - Math.floor(shows / SKY_LAWN.stripe) * SKY_LAWN.stripe >= 0.5, 'The lawn ends in a sliver of a stripe beside the coping.');
    // The paths: gravel ribbons 0.5 wide or more laid on the lawn, clear of the coping and the villa.
    assert(plan.SKY_PATHS.width >= 0.5 && plan.SKY_PATHS.lift >= 0.02 && 2 * plan.SKY_PATHS.landing.r >= 1, 'The paths are thinner than half a unit.');
    each(gravel, (q) => {
      assert(Math.abs(q.y - plan.skyTop(q.x, q.z) - plan.SKY_PATHS.lift) < 1e-4, 'A path is off the lawn.');
      assert(plan.onSky(q.x, q.z, SKY_COPING.profile[0][0] - 0.3), `A path runs under the coping at ${q.x.toFixed(2)}, ${q.z.toFixed(2)}.`);
      // (In the villa's own frame: clear of the house and its terrace, and of the steps.)
      const [fx, fz] = [q.x - site.x, q.z - site.z];
      assert(!(Math.abs(fx) < V.terrace.hw && fz < V.terrace.front) && !(Math.abs(fx) < V.steps.hw + 0.2 && fz < V.steps.front), `A path runs under the villa at ${q.x.toFixed(2)}, ${q.z.toFixed(2)}.`);
      // (And off the flower borders at the terrace's foot.)
      for (const b of Object.values(plan.SKY_BORDERS)) assert(!(q.x > b.x0 && q.x < b.x1 && q.z > b.z0 && q.z < b.z1), `A path runs through a flower border at ${q.x.toFixed(2)}, ${q.z.toFixed(2)}.`);
    });
  }

  /* ---------------- the underside: coping and rock ---------------- */
  const undersides = sky.rock.children.filter((o) => o.isMesh);
  assert(undersides.length === 1 && undersides[0].material.userData.surfaceKind === 'stone' && undersides[0].castShadow, 'The rock and the coping are not one stone mesh.');
  {
    // The coping is everything above the rock's flat top: its top SKY's 0.14 under the deck's level,
    // 0.11 proud of the lawn beside it, its nose the deck's widest ring, on the rim's line and no further.
    const copingTop = Math.max(...SKY_COPING.profile.map(([, y]) => y)),
      flat = S.top - SKY_ROCK.body.top;
    let top = -Infinity,
      widest = -Infinity,
      widestY = 0,
      proud = 0,
      north = -Infinity;
    const tip = new T.Vector3(0, Infinity, 0);
    each(sky.rock, (p) => {
      const d = plan.skyDistance(p.x, p.z);
      // Inside the coping's inner face, nothing of the underside comes within 0.08 of the lawn: no
      // rock shows through the turf.
      if (d < SKY_COPING.profile[0][0] - 0.05) assert(p.y < plan.skyTop(p.x, p.z) - 0.08, `The rock rises through the turf at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}.`);
      if (p.y > flat + 0.02) {
        top = Math.max(top, p.y);
        // (Clear of the falls' notches, where the coping sinks under the stream: checked below.)
        if (d > widest && plan.skyFalls.every((f) => Math.hypot(p.x - f.x, p.z - f.z) > 1)) {
          widest = d;
          widestY = p.y;
        }
      } else if (p.y < S.top - 0.52) {
        proud = Math.max(proud, d);
        if (p.z < S.z - S.a + 2) north = Math.max(north, d);
        if (p.y < tip.y) tip.copy(p);
      }
    });
    assert(Math.abs(top - (S.top + copingTop)) < 1e-4 && Math.abs(widest) < 0.01 && Math.abs(widestY - (S.top - S.ring)) < 0.03, `The coping's top is at ${top.toFixed(3)} and its nose ${widest.toFixed(3)} from the rim at ${widestY.toFixed(3)}.`);
    const inner = plan.skyRim(0, SKY_COPING.profile[0][0]);
    assert(S.top + copingTop - plan.skyTop(inner.x, inner.z) > 0.08 && S.top + SKY_COPING.profile[0][1] < plan.skyTop(inner.x, inner.z) - 0.04, 'The coping no longer stands proud of the lawn, or its foot shows.');
    assert(SKY_COPING.joint >= 0.03 && SKY_COPING.joint + SKY_COPING.set <= 0.08 && SKY_COPING.stones >= 36 && SKY_COPING.stones <= 56, 'The coping\'s stones are no longer chunky ones with soft joints.');
    // The rock: its flat top hidden under the turf (below the lawn's lowest), its shoulders proud of
    // the rim by 0.4 at most and not at all on the north tip (the plane's side), its tip where the
    // overview is fitted to it.
    assert(flat < S.top - S.dome - 0.1 && S.top + SKY_COPING.profile.at(-1)[1] < flat - 0.05, 'The rock\'s flat top is not under the turf, or the coping\'s underside no longer ends inside it.');
    assert(proud > 0.1 && proud <= 0.4 && north <= 0, `The rock stands ${proud.toFixed(2)} proud of the rim (${north.toFixed(2)} at the north tip).`);
    assert(Math.abs(tip.y - tipAt.y) < 0.1 && Math.hypot(tip.x - tipAt.x, tip.z - tipAt.z) < 0.4, `The rock's tip is at ${tip.toArray().map((n) => n.toFixed(2)).join(', ')}.`);
    // Smooth, never faceted: wherever triangles meet at a point they share one normal there (a
    // faceted mesh has one a face), each a unit long and close to its faces' own. Sculpted on a grid
    // no finer than 0.2 (chunky: nothing under about half a unit survives it).
    const p = undersides[0].geometry.attributes.position,
      n = undersides[0].geometry.attributes.normal,
      seen = new Map(),
      a = new T.Vector3(),
      b = new T.Vector3(),
      c = new T.Vector3(),
      face = new T.Vector3(),
      own = new T.Vector3();
    let corners = 0,
      lean = 0,
      worst = 1,
      rockTriangles = 0;
    for (let t = 0; t < p.count; t += 3) {
      a.fromBufferAttribute(p, t);
      b.fromBufferAttribute(p, t + 1);
      c.fromBufferAttribute(p, t + 2);
      if (Math.max(a.y, b.y, c.y) > S.top - 0.56) continue;
      rockTriangles++;
      face.subVectors(b, a).cross(own.subVectors(c, a));
      if (face.lengthSq() < 1e-14) continue;
      face.normalize();
      for (let k = 0; k < 3; k++) {
        own.fromBufferAttribute(n, t + k);
        assert(Math.abs(own.length() - 1) < 1e-3, 'A normal of the rock is not a unit long.');
        const key = [p.getX(t + k), p.getY(t + k), p.getZ(t + k)].map((q) => Math.round(q * 2000)).join(),
          first = seen.get(key);
        if (first) assert(first.dot(own) > 0.999, 'The rock is faceted: two normals at one point.');
        else seen.set(key, own.clone());
        lean += own.dot(face);
        worst = Math.min(worst, own.dot(face));
        corners++;
      }
    }
    assert(corners / seen.size > 4, 'The rock\'s triangles share no corners.');
    assert(lean / corners > 0.97 && worst > 0.3, `The rock's normals lean ${(lean / corners).toFixed(3)} on average (${worst.toFixed(2)} at worst) from its faces.`);
    assert(rockTriangles >= 8000 && rockTriangles <= 16000 && SKY_ROCK.grid >= 0.2, `The rock costs ${rockTriangles} triangles.`);
    let outcropReport = '';
    // The rock's outcrops (the final art review: single rounded blocks read as grey cushions or paving
    // slabs): stones of their own standing out of the earth (runs of joined faces apart from the earth's
    // and the coping's), each by its middle's bearing round the island and depth under the deck one of
    // the SKY_ROCK.outcrops (its nearest, within 2.2 of its place); each outcrop a cluster of three stones
    // or more, the biggest at least four times the smallest's size (its box's volume), and not all lying
    // one way (their long axes, by their spread, 15 degrees apart or more: tilted beds, a piece split off).
    {
      const key = (i) => [p.getX(i), p.getY(i), p.getZ(i)].map((q) => Math.round(q * 2000)).join(),
        parent = new Map(),
        find = (k) => (parent.get(k) === k ? k : (parent.set(k, find(parent.get(k))), parent.get(k)));
      for (let i = 0; i < p.count; i++) if (!parent.has(key(i))) parent.set(key(i), key(i));
      for (let t = 0; t < p.count; t += 3) for (const j of [1, 2]) parent.set(find(key(t + j)), find(key(t)));
      const runs = new Map();
      for (let i = 0; i < p.count; i++) {
        const r = find(key(i));
        if (!runs.has(r)) runs.set(r, []);
        runs.get(r).push(new T.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
      }
      const all = [...runs.values()].sort((a, b) => b.length - a.length),
        // (The earth is the biggest run; the coping stands over the rock's flat top.)
        stones = all.slice(1).filter((q) => Math.max(...q.map((v) => v.y)) < S.top - SKY_ROCK.body.top),
        boxes = stones.map((q) => new T.Box3().setFromPoints(q)),
        axisOf = (q) => {
          const mid = q.reduce((s, v) => s.add(v), new T.Vector3()).multiplyScalar(1 / q.length),
            m = new T.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0).elements;
          for (const v of q) {
            const d = [v.x - mid.x, v.y - mid.y, v.z - mid.z];
            for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) m[a * 3 + b] += d[a] * d[b];
          }
          // The long axis: power iteration on the spread.
          let x = new T.Vector3(1, 0.3, 0.2);
          for (let k = 0; k < 40; k++) x = new T.Vector3(m[0] * x.x + m[1] * x.y + m[2] * x.z, m[3] * x.x + m[4] * x.y + m[5] * x.z, m[6] * x.x + m[7] * x.y + m[8] * x.z).normalize();
          return x;
        },
        // How far a point lies from an outcrop's place: round the island (at about the flank's reach) and down.
        apart = (c, o) => Math.hypot(5 * plan.angleDiff(Math.atan2(c.x - S.x, c.z - S.z), o.bearing * deg), S.top - c.y + o.y),
        groups = SKY_ROCK.outcrops.map(() => []);
      boxes.forEach((b, k) => {
        const c = b.getCenter(new T.Vector3()),
          d = SKY_ROCK.outcrops.map((o) => apart(c, o)),
          j = d.indexOf(Math.min(...d));
        assert(d[j] < 2.2, `A stone of the rock at ${c.toArray().map((n) => n.toFixed(2)).join(', ')} is no outcrop's.`);
        groups[j].push(k);
      });
      for (const g of groups) {
        const sizes = g.map((k) => boxes[k].getSize(new T.Vector3())).map((s) => s.x * s.y * s.z),
          axes = g.map((k) => axisOf(stones[k])),
          spread = Math.max(...axes.flatMap((a, i) => axes.slice(i + 1).map((b) => Math.acos(Math.min(1, Math.abs(a.dot(b)))))));
        assert(g.length >= 3 && Math.max(...sizes) >= 4 * Math.min(...sizes) && spread >= 15 * deg, `An outcrop of the rock is ${g.length} stones, ${(Math.max(...sizes) / Math.min(...sizes)).toFixed(1)} times apart in size, their long axes within ${(spread / deg).toFixed(0)} degrees of one another.`);
      }
      outcropReport = `, ${groups.length} outcrops of ${stones.length} stones`;
    }
    // A chunk of land, not a plate: all round the rim the earth stands as cliffs (within half a unit
    // of the rim's line) down to SKY_ROCK.body.cliff under the deck or deeper, its shoulders proud of
    // them; and under each fall (within 12 degrees of its bearing) nothing stands out past the rim,
    // so the water hangs clear of the rock.
    const deepest = Array.from({ length: 36 }, () => 0),
      underFalls = plan.skyFalls.map(() => -Infinity);
    each(sky.rock, (q) => {
      const bearing = Math.atan2(q.x - S.x, q.z - S.z),
        d = plan.skyDistance(q.x, q.z),
        depth = S.top - q.y,
        k = Math.round((((bearing / deg) % 360) + 360) / 10) % 36;
      if (d > -0.5) deepest[k] = Math.max(deepest[k], depth);
      plan.skyFalls.forEach((f, j) => {
        if (depth > 0.6 && Math.abs(plan.angleDiff(bearing, f.bearing)) < 12 * deg) underFalls[j] = Math.max(underFalls[j], d);
      });
    });
    assert(Math.min(...deepest) >= SKY_ROCK.body.cliff && SKY_ROCK.body.cliff >= 1.2, `The rock's cliffs stand only ${Math.min(...deepest).toFixed(2)} deep at a bearing of the rim.`);
    assert(underFalls.every((d) => d <= 0), `The rock stands ${Math.max(...underFalls).toFixed(2)} past the rim under a fall.`);
    // The earth in beds, each a clear step from the next (the middle one lighter than the top's), each
    // change under a paler seam; down the spike the earth gives way to rock, far greyer than it. (Read
    // through the sea's bounce, which the next check holds; the boulders' grey is left out of the beds.)
    // Whatever faces down is lifted by the bounce (SKY_ROCK.bounce: under the town's high sun the
    // underside reads as brown earth and grey rock, never as a hole): faces turned straight down are
    // that much brighter than the same beds' near-vertical ones.
    {
      const colour = undersides[0].geometry.attributes.color,
        bands = { top: [], mid: [], low: [], seam: [] },
        mean = (list) => list.reduce((s, c) => s.add(c), new T.Color(0, 0, 0)).multiplyScalar(1 / list.length),
        grey = (c) => (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / Math.max(c.r, c.g, c.b),
        under = (ny) => T.MathUtils.smoothstep(-ny, -0.1, 0.8),
        B = SKY_ROCK.bounce,
        down = [],
        side = [];
      assert(B.every((k) => k >= 0.8 && k <= 2.5) && SKY_ROCK.night >= 0.3 && SKY_ROCK.night < 1, 'The underside\'s bounce or its night dim is out of its range.');
      for (let i = 0; i < p.count; i += 3) {
        const depth = S.top - p.getY(i),
          u = under(n.getY(i)),
          c = new T.Color().fromBufferAttribute(colour, i),
          base = new T.Color(c.r / (1 + B[0] * u), c.g / (1 + B[1] * u), c.b / (1 + B[2] * u));
        const earthy = grey(base) > 0.25;
        if (depth > 0.6 && depth < 1.2 && earthy) bands.top.push(base);
        else if (depth > 2.3 && depth < 3.1 && earthy) bands.mid.push(base);
        else if (depth > SKY_ROCK.spike[1] + 0.2 && depth < S.depth - 0.4) bands.low.push(base);
        if ((Math.abs(depth - SKY_ROCK.beds[0]) < 0.06 || Math.abs(depth - SKY_ROCK.beds[1]) < 0.06) && earthy) bands.seam.push(base);
        // (The earth of the upper two beds only: the rock outcrops in them are grey.)
        if (depth > 0.6 && depth < SKY_ROCK.beds[1] - 0.3 && grey(c) > 0.4) (n.getY(i) < -0.85 ? down : Math.abs(n.getY(i)) < 0.35 ? side : []).push(c);
      }
      const [top, mid, low, seam] = [bands.top, bands.mid, bands.low, bands.seam].map(mean),
        luma = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      assert(luma(mid) > luma(top) * 1.25 && luma(seam) > (luma(top) + luma(mid)) / 2, `The underside's beds do not read as strata (${[top, mid, seam].map((c) => luma(c).toFixed(3)).join(', ')}).`);
      assert(grey(top) > 0.25 && grey(mid) > 0.2 && grey(low) < grey(mid) / 2, 'The earth under the deck is not brown, or the spike is not rock.');
      // (Its near-vertical faces take a little of it too: measured, about 1.6 times the light.)
      assert(down.length > 20 && side.length > 20 && mean(down).r / mean(side).r > 1 + 0.35 * B[0] && luma(mean(down)) / luma(mean(side)) > 1 + 0.3 * B[1], 'The underside\'s down-turned faces are not lifted by the sea\'s bounce.');
    }
    skyReport = `${skyMeshes} meshes and ${skyTriangles} triangles of its ${SKY_CAP.meshes} and ${SKY_CAP.triangles.toLocaleString('en-GB')} (the rock ${rockTriangles}${outcropReport}, Alison ${herMeshes} and ${herTriangles})`;
  }

  /* ---------------- the villa in place ---------------- */
  {
    // The villa (town-sky-villa's buildSkyVilla; the next block checks its build) on its site:
    // SKY_VILLA, the plan's copy of its measures that the overview's marks, the island's frame, the
    // borders and the stations are made from, is its VILLA's. It stands inside its footprint on the
    // deck, a unit or more in from the rim, from its feet under the turf (VILLA.foot) up to its
    // tallest can, under the placement's cap; its downpipes and its back door's hood and step reach
    // the footprint's sides and back, its chimney copes stand where the overview's marks have them,
    // and its steps come down to the lawn on the south.
    const { VILLA } = await load('town-sky-villa'),
      bounds = new T.Box3().setFromObject(sky.shell),
      C = V.chimneys,
      H = V.house;
    assert(
      V.w === 2 * VILLA.hx && V.d === 2 * VILLA.hz && V.height === VILLA.top && H.hw === VILLA.wall.hw && H.back === VILLA.wall.back && H.front === VILLA.wall.front && H.cornice === VILLA.cornice.corona[1] && Math.abs(H.flat - (H.cornice + VILLA.roof.fascia + VILLA.roof.rise)) < 1e-9 && H.eave === VILLA.roof.eave && H.gutter === VILLA.roof.gutter[1] && H.pipes === VILLA.hx && H.rear === -VILLA.hz,
      'SKY_VILLA\'s house no longer mirrors the villa\'s VILLA.',
    );
    assert(
      V.terrace.top === VILLA.terrace.top && Math.abs(V.terrace.front - (H.front + VILLA.terrace.depth)) < 1e-9 && V.terrace.hw === VILLA.terrace.hw && V.steps.hw === VILLA.terrace.steps.hw && V.steps.risers === VILLA.terrace.steps.risers && Math.abs(V.steps.front - (V.terrace.front + VILLA.terrace.steps.run * (V.steps.risers - 1))) < 1e-9,
      'SKY_VILLA\'s terrace or steps no longer mirror the villa\'s.',
    );
    assert(C.x === VILLA.chimney.x && C.z === VILLA.chimney.z && C.hw === VILLA.chimney.w / 2 && C.hd === VILLA.chimney.d / 2 && C.top === VILLA.chimney.top && C.cans <= V.height, 'SKY_VILLA\'s chimneys no longer mirror the villa\'s.');
    assert(Math.abs(bounds.max.y - (site.y + C.cans)) < 0.002 && Math.abs(bounds.min.y - (site.y + VILLA.foot)) < 1e-4, `The villa reaches from ${bounds.min.y.toFixed(3)} to ${bounds.max.y.toFixed(3)}, not from its feet to its tallest can.`);
    assert(Math.abs(bounds.max.x - site.x - H.pipes) < 1e-3 && Math.abs(bounds.min.x - site.x + H.pipes) < 1e-3 && Math.abs(bounds.min.z - site.z - H.rear) < 1e-3, 'The villa\'s downpipes or its back step no longer reach where SKY_VILLA has them.');
    each(sky.shell, (p) => {
      assert(plan.onSky(p.x, p.z, -1), `The villa stands ${(-plan.skyDistance(p.x, p.z)).toFixed(2)} from the rim.`);
      assert(Math.abs(p.x - site.x) <= V.w / 2 + 1e-3 && Math.abs(p.z - site.z) <= V.d / 2 + 1e-3, `The villa leaves its footprint at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}.`);
    });
    // The copes (the stacks' white stone under the cans, over the shafts' tops): where the marks put them.
    for (const side of [-1, 1]) {
      const copes = [],
        [cx, cz] = plan.skyVillaPoint(side * C.x, C.z);
      sky.shell.traverse((o) => {
        if (!o.isMesh || o.material.userData.surfaceKind === 'pantile') return;
        const q = o.geometry.attributes.position;
        for (let i = 0; i < q.count; i++) {
          v.fromBufferAttribute(q, i).applyMatrix4(o.matrixWorld);
          if (v.y > site.y + C.top + 0.02 && v.y < site.y + C.cope.top + 1e-3 && Math.abs(v.x - cx) < 1 && Math.abs(v.z - cz) < 1) copes.push(v.clone());
        }
      });
      const reach = new T.Box3().setFromPoints(copes);
      assert(copes.length && Math.abs(reach.max.x - cx - C.cope.hw) < 0.02 && Math.abs(cx - reach.min.x - C.cope.hw) < 0.02 && Math.abs(reach.max.z - cz - C.cope.hd) < 0.02 && Math.abs(cz - reach.min.z - C.cope.hd) < 0.02, `The ${side < 0 ? 'west' : 'east'} chimney's cope spans ${reach.min.x.toFixed(2)}..${reach.max.x.toFixed(2)}, ${reach.min.z.toFixed(2)}..${reach.max.z.toFixed(2)}, off the overview's marks.`);
    }
    // The terrace and its steps are on the front, to the south; the lawn at the steps' foot is the deck's level, near enough.
    const [, stepsZ] = plan.skyVillaPoint(0, V.steps.front);
    assert(stepsZ > houseZ && S.top - plan.skyTop(S.x, stepsZ) < 0.08 && bounds.max.z > stepsZ && bounds.max.z - site.z <= V.d / 2 + 1e-3, 'The steps do not come down to the lawn on the south side.');
  }

  /* ---------------- slots and stations ---------------- */
  {
    const { tea, watering, telescope, bench } = plan.SKY_STATIONS,
      SEATS = plan.SKY_SEATS,
      slots = skySlots(),
      hall = plan.sites['town-hall'],
      towards = (p, q) => Math.atan2(q.x - p.x, q.z - p.z),
      ahead = (p, bearing, d) => ({ x: p.x + Math.sin(bearing) * d, z: p.z + Math.cos(bearing) * d }),
      near = (p, q, d = 1e-9) => Math.hypot(p.x - q.x, p.z - q.z) < d,
      // A piece's corner (local x, z in the frame its slot turns) in the world.
      corner = (slot, x, z) => ({ x: slot.x + x * Math.cos(slot.ry) + z * Math.sin(slot.ry), z: slot.z - x * Math.sin(slot.ry) + z * Math.cos(slot.ry) }),
      // How far a point lies from the nearest path's edge (negative: on a path).
      offPath = (p) => {
        const P = plan.SKY_PATHS,
          line = (points) => plan.distanceToPolyline([p.x, p.z], points, false) - P.width / 2;
        return Math.min(line(P.walk), line(P.stem), Math.hypot(p.x - P.landing.x, p.z - P.landing.z) - P.landing.r);
      },
      stations = { 'her chair': tea.seats[0], 'the guest\'s chair': tea.seats[1], 'the watering stretch\'s start': watering.from, 'the watering stretch\'s end': watering.to, 'the telescope\'s stand': telescope.stand };
    const [, terraceZ] = plan.skyVillaPoint(0, V.terrace.front);
    // Each a unit or more in from the rim, on the lawn south of the villa (south of its terrace's
    // front, 0.3 clear of the terrace and its steps), and never where she would hide the facade:
    // from the file's bearing (at its own lower pitch, city-scene's SKY_PITCH) and the opening one,
    // the line of sight past the top of her (1.2 up, hair and all) comes down to the terrace's level
    // before it reaches the house.
    for (const [name, p] of Object.entries(stations)) {
      const [fx, fz] = [Math.abs(p.x - site.x), p.z - site.z];
      assert(plan.onSky(p.x, p.z, -1), `${name} is ${(-plan.skyDistance(p.x, p.z)).toFixed(2)} from the rim.`);
      assert(p.z > terraceZ && !(fx < V.terrace.hw + 0.3 && fz < V.terrace.front + 0.3) && !(fx < V.steps.hw + 0.3 && fz < V.steps.front + 0.3), `${name} is not on the lawn south of the villa.`);
      for (const bearing of [file, Math.PI / 4]) {
        const { back } = axes(bearing, bearing === file ? SKY_PITCH : TOWN_PITCH),
          drop = (1.2 - V.terrace.top) / (back.y / Math.hypot(back.x, back.z)),
          behind = [p.x - (back.x / Math.hypot(back.x, back.z)) * drop, p.z - (back.z / Math.hypot(back.x, back.z)) * drop],
          [fx, fz] = [behind[0] - site.x, behind[1] - site.z];
        assert(!(Math.abs(fx) < V.house.hw && fz > V.house.back && fz < V.house.front), `${name} hides the facade at bearing ${bearing.toFixed(2)}.`);
      }
    }
    // The tea table: on the lawn before the terrace, turned so lane G's -x chair (hers) faces as she
    // does; both seats SKY_SEATS.tea from its middle, hers looking across the table toward the town,
    // never with her back to the file's camera or the opening one. The whole set (its chairs' backs
    // 0.98 out along its x, the table 0.42 across) keeps off the paths and 0.6 from the rim.
    assert(tea.z > terraceZ + 1, 'The tea table is not on the lawn before the terrace.');
    assert(near(corner(tea, -SEATS.tea, 0), tea.seats[0]) && near(corner(tea, SEATS.tea, 0), tea.seats[1]) && Math.abs(plan.angleDiff(tea.ry + Math.PI / 2, tea.seats[0].facing)) < 1e-9 && Math.abs(plan.angleDiff(tea.seats[1].facing, tea.seats[0].facing + Math.PI)) < 1e-9, 'The tea table\'s chairs are not lane G\'s, either side of it along its x, facing it.');
    assert(Math.abs(plan.angleDiff(towards(tea.seats[0], hall), tea.seats[0].facing)) < 20 * deg && [file, Math.PI / 4].every((camera) => Math.abs(plan.angleDiff(tea.seats[0].facing, camera)) < 45 * deg), 'Seated at tea she does not look toward the town, or has her back to a camera.');
    for (const [x, z] of [[-0.98, -0.42], [0.98, -0.42], [0.98, 0.42], [-0.98, 0.42], [0, 0.42], [0, -0.42]]) {
      const q = corner(tea, x, z);
      assert(plan.onSky(q.x, q.z, -0.6) && offPath(q) > 0.05, `The tea set's corner at ${q.x.toFixed(2)}, ${q.z.toFixed(2)} crowds the rim or a path.`);
    }
    // The watering stretch: along the east border at the terrace's foot, on the walk's line, facing
    // the border (her can's rose reaches about half a unit ahead of her: lane F's ALISON.rose).
    const border = plan.SKY_BORDERS.east;
    assert(watering.from.z === watering.to.z && watering.from.z === plan.SKY_PATHS.walk[0][1] && watering.from.x >= border.x0 && watering.to.x <= border.x1 && watering.to.x - watering.from.x >= 1.5 && watering.from.z - border.z1 > 0.2 && watering.from.z - border.z1 < 0.6 && Math.abs(plan.angleDiff(watering.facing, Math.PI)) < 1e-9, 'The watering stretch is off the east border.');
    assert(Math.abs(border.z0 - terraceZ) < 1e-9 && border.z1 - border.z0 >= 0.5 && Math.abs(plan.SKY_BORDERS.west.x0 + border.x1 - 2 * S.x) < 1e-9 && border.x0 - S.x > V.steps.hw + 0.2, 'The flower borders are not at the terrace\'s foot either side of the steps.');
    // The telescope: on the rim's town side, south of the terrace's front, looking at the Town Hall
    // and a little down (the true depression from its eyepiece); she stands behind it, stooped to the
    // eyepiece, where lane G's telescope puts her; its tripod's three feet are on the lawn, clear of
    // the coping.
    const rimBearing = Math.atan2(telescope.x - S.x, telescope.z - S.z);
    assert(Math.abs(plan.angleDiff(telescope.look, towards(telescope, hall))) < 1e-9 && telescope.ry === telescope.look && telescope.dip > 0.05 && telescope.dip < 0.25, 'The telescope does not look down at the Town Hall.');
    assert(rimBearing > 40 * deg && rimBearing < 80 * deg && telescope.z > terraceZ && near(ahead(telescope, telescope.look, -SEATS.telescope), telescope.stand) && Math.abs(plan.angleDiff(telescope.stand.facing, telescope.look)) < 1e-9, 'The telescope is off the rim on the town\'s side, or she does not stand behind it.');
    for (let k = 0; k < 3; k++) {
      const foot = ahead(telescope, telescope.look + (k * 2 * Math.PI) / 3, 0.27);
      assert(plan.onSky(foot.x, foot.z, -0.6), `The telescope's foot ${k} is ${(-plan.skyDistance(foot.x, foot.z)).toFixed(2)} from the rim.`);
    }
    // The bench: on the south-east lawn beside the landing, facing the town; it keeps off the paths.
    assert(bench.x > S.x && bench.z > terraceZ + 1 && Math.abs(plan.angleDiff(bench.ry, towards(bench, hall))) < 25 * deg && Math.hypot(bench.x - plan.SKY_PATHS.landing.x, bench.z - plan.SKY_PATHS.landing.z) < plan.SKY_PATHS.landing.r + 1.2, 'The bench is off the south-east lawn by the landing, or turned from the town.');
    for (const [x, z] of [[-0.62, -0.25], [0.62, -0.25], [0.62, 0.25], [-0.62, 0.25]]) {
      const q = corner(bench, x, z);
      assert(plan.onSky(q.x, q.z, -0.8) && offPath(q) > 0.05, `The bench's corner at ${q.x.toFixed(2)}, ${q.z.toFixed(2)} crowds the rim or a path.`);
    }
    // The slots lane G's pieces take: on the lawn at the stations, turned as they face.
    for (const [name, slot, at] of [
      ['tea', slots.tea, tea],
      ['bench', slots.bench, bench],
      ['telescope', slots.telescope, telescope],
      ['tree', slots.tree, { ...plan.SKY_TREE, ry: 0 }],
    ])
      assert(slot.x === at.x && slot.z === at.z && slot.y === plan.skyTop(at.x, at.z) && slot.ry === at.ry, `The ${name}'s slot is off its station.`);
    assert(slots.borders.length === 2 && slots.borders.every((b) => b.y === plan.skyTop(b.x, b.z) && b.w >= 1.5 && b.d >= 0.5), 'The borders\' slots are not their strips.');
    // The lamps: one set at the island's middle (south of the airport's lamps' line), each foot on
    // the lawn, a unit from the rim, off the paths and clear of her stations.
    assert(slots.lamps.z > plan.AIRPORT_ROAD.beach && slots.lamps.spots.length === plan.SKY_LAMPS.length, 'The lamps\' set stands where check-town counts the airport\'s lamps.');
    for (const spot of slots.lamps.spots) {
      const q = { x: slots.lamps.x + spot.x, z: slots.lamps.z + spot.z };
      assert(Math.abs(slots.lamps.y + spot.y - plan.skyTop(q.x, q.z)) < 1e-9 && plan.onSky(q.x, q.z, -1) && offPath(q) > 0.15 && Object.values(stations).every((p) => Math.hypot(p.x - q.x, p.z - q.z) > 0.5), `A lamp at ${q.x.toFixed(2)}, ${q.z.toFixed(2)} crowds the rim, a path or a station.`);
    }
    // The tree: on the north-east lawn behind the villa's east end, its crown's top where the overview is fitted to it.
    assert(plan.onSky(plan.SKY_TREE.x, plan.SKY_TREE.z, -1) && plan.SKY_TREE.x > S.x + 2 && plan.SKY_TREE.z < site.z - V.d / 2 - 1 && Math.abs(S.top + plan.SKY_TREE.top - 15) < 0.01, 'The tree is off the north-east lawn behind the villa.');
    // The falls (lane G's fall()): two, short. Each leaves the rim east by north or west by north
    // (never within 40 degrees of the north, the plane's side, nor before the facade at the opening
    // bearing): its slot is the rim point at the deck's level there, turned out along the rim's
    // normal, with the deck's rise to its pool; its puff's middle hangs 0.67 out and 4.5 down, its
    // flat base where the placement has it (5.0) and well clear of the sea. No water reaches it.
    assert.equal(plan.skyFalls.length, 2);
    for (const [k, f] of plan.skyFalls.entries()) {
      const rim = plan.skyRim(f.bearing),
        spring = plan.skyRim(f.bearing, -plan.SKY_FALLS.head),
        slot = slots.falls[k];
      assert(Math.abs(plan.angleDiff(f.bearing, Math.PI)) > 40 * deg && Math.abs(plan.angleDiff(f.bearing, 45 * deg)) > 55 * deg, `Fall ${k} leaves the rim on the north or before the facade.`);
      assert(near(f, rim) && f.y === plan.skyTop(rim.x, rim.z) && Math.abs(plan.angleDiff(f.ry, Math.atan2(rim.nx, rim.nz))) < 1e-9 && Math.abs(f.rise - (plan.skyTop(spring.x, spring.z) - f.y)) < 1e-9 && f.rise > 0 && f.rise < 0.2, `Fall ${k}'s slot is off the rim.`);
      assert(slot.x === f.x && slot.y === f.y && slot.z === f.z && slot.ry === f.ry && slot.rise === f.rise, `Fall ${k}'s garden slot is not its plan.`);
      assert(Math.abs(f.puff.x - (f.x + rim.nx * 0.67)) < 1e-9 && Math.abs(f.puff.y - (f.y - 4.5)) < 1e-9 && f.puff.r === 1.3 && Math.abs(f.puff.bottom - 5) < 0.1 && f.puff.bottom > WATER + 4.9, `Fall ${k}'s cloud puff is off its place.`);
    }
    assert(plan.SKY_FALLS.width >= 0.5 && plan.SKY_FALLS.drop === 4.5, 'The falls are hairlines, or no longer short.');
    // The clouds and floating rocks (their proxies, floatPoints): beside the island, tucked no more
    // than SKY_FLOAT_LIMITS.tuck under the rim and `clear` of the rock, under the rim's lawn, south
    // of `north`, inside the rain's square, and nowhere in the villa's box.
    const L = plan.SKY_FLOAT_LIMITS,
      rockPoints = [];
    each(sky.rock, (p) => rockPoints.push(p.clone()));
    const villaBox = new T.Box3().setFromObject(sky.shell).expandByScalar(0.3);
    for (const [k, points] of floats.entries())
      for (const q of points) {
        assert(plan.skyDistance(q.x, q.z) >= -L.tuck && q.y <= L.top && q.z >= L.north && q.x >= L.west && Math.abs(q.x) <= 58 && Math.abs(q.z) <= 58 && !villaBox.containsPoint(q), `Float ${k} leaves its limits at ${q.toArray().map((n) => n.toFixed(2)).join(', ')}.`);
        assert(rockPoints.every((r) => r.distanceToSquared(q) >= L.clear ** 2), `Float ${k} touches the rock at ${q.toArray().map((n) => n.toFixed(2)).join(', ')}.`);
      }
  }

  /* ---------------- the overview's marks and its own frame ---------------- */
  // Every fifth point of what is built, for the screen checks below: `still`, what stands still (the
  // deck and what stands on it, the villa, the rock), and what hangs on the garden's pivots: the
  // falls' water and puffs, and what floats beside the island (its clouds and rocks); and Alison, on
  // her own pivot (`walking`, in her chair at tea as the frozen frame has her; `herDay`, every fifth
  // point of what shows of her every two seconds of her day); and with the floats' proxies (their
  // drift and bob), the island's whole shape in the air.
  const built = [],
    still = [],
    falling = [],
    floating = [],
    walking = [],
    herDay = [];
  let nth = 0;
  each(sky.root, (p, o) => {
    if (nth++ % 5) return;
    const q = p.clone(),
      pivot = pivotOf(o);
    built.push(q);
    (!pivot ? still : pivot === her ? walking : pivot.name.startsWith('sky-fall-') ? falling : floating).push(q);
  });
  assert(floating.length > 100 && falling.length > 100 && walking.length > 100 && still.length + falling.length + floating.length + walking.length === built.length, 'The garden\'s falls, clouds and rocks, and Alison, are not on pivots of their own.');
  {
    const herMove = skyMoving.find((e) => e.object === her),
      shows = (o) => {
        for (let p = o; p && p !== her; p = p.parent) if (!p.visible) return false;
        return true;
      };
    for (let t = 0; t < plan.SKY_DAY.period; t += 2) {
      herMove.update(t, 0, 0);
      her.updateMatrixWorld(true);
      let k = 0;
      each(her, (p, o) => shows(o) && k++ % 5 === 0 && herDay.push(p.clone()));
    }
    herMove.update(0, 0, 0);
    her.updateMatrixWorld(true);
  }
  const shape = [...built, ...floats.flat()],
    marks = skyMarks(),
    fit = skyFit();
  {
    // Thirty-eight silhouette points: sixteen round the rim's widest ring, the eight chimney-cope
    // corners at the cans' height, the tree's top, the rock's tip and six to each fall's cloud puff.
    const C = V.chimneys;
    assert.equal(marks.length, 16 + 8 + 1 + 1 + 2 * 6);
    assert(marks.slice(0, 16).every((m) => Math.abs(plan.skyDistance(m.x, m.z)) < 1e-6 && Math.abs(m.y - (S.top - S.ring)) < 1e-9), 'The rim\'s marks are off its widest ring.');
    assert(marks.slice(16, 24).every((m) => Math.abs(m.y - (site.y + C.cans)) < 1e-6 && Math.abs(Math.abs(Math.abs(m.x - S.x) - C.x) - C.cope.hw) < 1e-9 && Math.abs(Math.abs(m.z - (site.z + C.z)) - C.cope.hd) < 1e-9), 'The chimneys\' marks are off the copes.');
    assert(marks[24].distanceTo(new T.Vector3(-49.4, 15.002, -29)) < 1e-6 && marks[25].distanceTo(new T.Vector3(tipAt.x, tipAt.y, tipAt.z)) < 1e-6, 'The tree\'s or the tip\'s mark moved.');
    // They hold what is built: the overview is fitted to their box on screen, and from the four
    // Rotate stops and the file's bearing (at the town's pitch, and at the file's own, whose frame
    // check-navigation measures from these marks) nothing of the island and its garden shows more
    // than 0.3 outside it (the rock's shoulders, a little proud of the rim; the tree's crown over the
    // rim), nor of its falls more than 0.5 (each puff's flat base is wider low down than the four
    // marks round its middle draw it: from the far stops, where a puff is the island's lowest point on
    // screen, its base's rim shows under them, a few pixels into the overview's margin). (The floats
    // hang on the town's side, inside the town's own marks: check-navigation holds their proxies to
    // that, and the garden's check below the floats to their proxies.)
    let worst = -Infinity,
      worstFall = -Infinity;
    for (const [bearing, pitch] of [...stops.map((b) => [b, TOWN_PITCH]), [file, TOWN_PITCH], [file, SKY_PITCH]]) {
      const { flat } = axes(bearing, pitch),
        edges = (points) => points.map(flat).reduce(([u0, w0, u1, w1], [u, w]) => [Math.min(u0, u), Math.min(w0, w), Math.max(u1, u), Math.max(w1, w)], [Infinity, Infinity, -Infinity, -Infinity]),
        marked = edges(marks),
        out = (box) => Math.max(marked[0] - box[0], marked[1] - box[1], box[2] - marked[2], box[3] - marked[3]);
      // (Alison through her whole day: she stays on the deck, well inside its marks.)
      worst = Math.max(worst, out(edges(still)), out(edges(herDay)));
      worstFall = Math.max(worstFall, out(edges(falling)));
    }
    assert(worst <= 0.3 && worstFall <= 0.5, `The sky island shows ${worst.toFixed(2)} outside the overview's marks (its falls ${worstFall.toFixed(2)}).`);
    // The body reads as a floating rock, not a plate (the owner's reference 2: a grass top on an
    // inverted cone of earth and rock tapering to a point). On screen, at a view's bearing and pitch:
    // D, the deck's height (its widest ring, far rim to near rim); V, how far the underside's lowest
    // point hangs below the near rim; and the silhouette's width under the near rim at three
    // quarters and nine tenths of V, as shares of the deck's width.
    const body = (bearing, pitch) => {
      const { flat } = axes(bearing, pitch),
        ring = plan.skyOutline(0, 256).map((q) => flat(new T.Vector3(q.x, S.top - S.ring, q.z))),
        under = [];
      each(sky.rock, (q) => under.push(flat(q)));
      const D = Math.max(...ring.map(([, w]) => w)) - Math.min(...ring.map(([, w]) => w)),
        wide = Math.max(...ring.map(([u]) => u)) - Math.min(...ring.map(([u]) => u)),
        near = Math.min(...ring.map(([, w]) => w)),
        low = Math.min(...under.map(([, w]) => w)),
        V = near - low,
        width = (f) => {
          const at = near - f * V,
            us = under.filter(([, w]) => Math.abs(w - at) < 0.05 * V).map(([u]) => u);
          return (Math.max(...us) - Math.min(...us)) / wide;
        },
        [, tipW] = flat(new T.Vector3(tipAt.x, tipAt.y, tipAt.z));
      return { ratio: V / D, narrow: [width(0.75), width(0.9)], tipLowest: Math.abs(tipW - low) < 0.15 };
    };
    // In its own file (the view a visitor opens it in, at its own lower pitch, city-scene's
    // SKY_PITCH) the rock hangs below the deck by 0.6 or more of the deck's own height, and narrows
    // to its tip: a fifth of the deck's width at three quarters of the way down, a tenth at nine
    // tenths, the tip the lowest thing on screen. (At the town's pitch, from the file's bearing, it
    // showed 0.11 of it: a plate with a knob under it.)
    const own = body(file, SKY_PITCH);
    let tipSpike = Infinity;
    {
      const { flat } = axes(file, SKY_PITCH),
        low = flat(new T.Vector3(tipAt.x, tipAt.y, tipAt.z))[1];
      each(sky.rock, (p) => {
        if (p.y > tipAt.y + 2.5) tipSpike = Math.min(tipSpike, flat(p)[1] - low);
      });
    }
    assert(own.ratio >= 0.6 && own.narrow[0] <= 0.25 && own.narrow[1] <= 0.12 && own.tipLowest && tipSpike >= 0.5, `In its file the sky island's rock hangs ${own.ratio.toFixed(2)} of the deck's height below it, ${own.narrow.map((x) => x.toFixed(2)).join(' and ')} of its width at three quarters and nine tenths of the way down, its tip ${tipSpike.toFixed(2)} below the rest.`);
    // From the Rotate stops and the file's bearing at the town's own pitch (the City overview and the
    // reading frames that pass it) it reads as a chunk of land: the body hangs 0.18 or more of the
    // deck's height under it (S1's showed 0.11 to 0.14) and narrows to a fifth of its width by nine
    // tenths of the way down.
    let leastAtTown = Infinity;
    for (const bearing of [...stops, file]) {
      const m = body(bearing, TOWN_PITCH);
      leastAtTown = Math.min(leastAtTown, m.ratio);
      assert(m.ratio >= 0.18 && m.narrow[1] <= 0.2, `At bearing ${bearing.toFixed(2)} the sky island's rock hangs only ${m.ratio.toFixed(2)} of the deck's height below it, ${m.narrow[1].toFixed(2)} of its width near its foot.`);
    }
    skyReport += `, its rock ${own.ratio.toFixed(2)} of the deck's height below it in its file (${leastAtTown.toFixed(2)} or more at the town's pitch), its tip ${tipSpike.toFixed(2)} below the rest there`;
    // Its own frame: the deck less its rounded ends, from 1.5 above the rock's tip to the pots.
    assert(fit.min.distanceTo(new T.Vector3(-57.5, tipAt.y + 1.5, -30)) < 1e-6 && fit.max.distanceTo(new T.Vector3(-46.5, 18.652, -18)) < 1e-6, 'The sky island\'s own frame moved.');
    assert(SKY_SHADOW.centre.distanceTo(fit.getCenter(new T.Vector3())) < 1e-9 && SKY_SHADOW.radius === 14, 'The sky island\'s shadow box is off its frame.');
    // That box holds the whole island and what hangs by it at any sun: nothing further than its
    // half-size from the middle.
    let far = 0;
    for (const p of shape) far = Math.max(far, p.distanceTo(SKY_SHADOW.centre));
    for (const f of plan.skyFalls) far = Math.max(far, Math.hypot(f.puff.x - SKY_SHADOW.centre.x, f.puff.bottom - SKY_SHADOW.centre.y, f.puff.z - SKY_SHADOW.centre.z) + f.puff.r);
    assert(far < SKY_SHADOW.radius, `The sky island reaches ${far.toFixed(1)} from the middle of its shadow box.`);
  }

  /* ---------------- the pointer ---------------- */
  {
    // Its pointer volume: its own, not a box from the sea up. The deck's slab, the rock's hull and
    // the villa's bounds (and a box for whatever on the deck rises over the slab: the tree, once it
    // is planted), each invisible, under one parent that names it.
    const holder = new T.Group(),
      hit = addSkyHit(holder, sky),
      pick = { hit, root: sky.root },
      parts = hit.children,
      corners = [];
    assert(hit.userData.buildingId === 'sky-island' && hit.parent === holder && parts.length >= 3 && parts.every((o) => o.isMesh && !o.material.visible), 'The sky island\'s pointer volume is not its own invisible parts.');
    each(hit, (p) => corners.push(p.clone()));
    const volume = new T.Box3().setFromPoints(corners);
    assert(volume.min.y > S.top - S.depth - 0.5 && volume.max.y < S.top + V.height + 0.3 && Math.abs(parts[0].position.y + (SKY_HIT.above + SKY_HIT.below) / 2 - (S.top + SKY_HIT.above)) < 1e-9, `The sky island's pointer volume runs from ${volume.min.y.toFixed(2)} to ${volume.max.y.toFixed(2)}.`);
    const dir = new T.Vector3(),
      from = new T.Vector3(),
      roots = [...Array.from(models.values(), (m) => m.root), sky.root],
      through = (point) => ray.set(from.copy(point).addScaledVector(dir, -200), dir),
      land = [];
    // The town's land, to its waterline, and the airport's to its armour's toe.
    for (let x = -40; x <= 40; x += 0.6) for (let z = -62; z <= 40; z += 0.6) if (waterline(x, z) <= 0 || plan.airportDistance(x, z) <= plan.AIRPORT.armour) land.push(new T.Vector3(x, 0, z));
    let tightest = 0,
      seenAll = 0,
      nearestLand = Infinity,
      hitLand = Infinity;
    // (The file's bearing at the file's own lower pitch, as a visitor points at it there.)
    for (const bearing of [...stops, file])
      for (const drift of bearing === file ? [0] : drifts) {
        const { back, right, up, flat } = axes(bearing + drift, bearing === file ? SKY_PITCH : TOWN_PITCH);
        dir.copy(back).negate();
        // (a) Wherever its own surface (the deck and all that stands on it, the villa, the rock) is the
        // first thing on a view ray, the pointer is on the island. (Its falls, their puffs and what
        // floats beside it are left out of its volume: there it answers only where the volume lies
        // behind them.)
        if (!drift) {
          let seen = 0;
          // One still point of it in each 0.6 square of the screen, the one nearest the camera (about
          // four hundred a bearing: a ray against the island costs some milliseconds).
          const front = new Map();
          for (const p of still) {
            const [u, w] = flat(p),
              cell = Math.floor(u / 0.6) + ' ' + Math.floor(w / 0.6),
              near = p.dot(back);
            if (!(front.get(cell)?.near >= near)) front.set(cell, { p, near });
          }
          for (const { p } of front.values()) {
            through(p);
            const hits = ray.intersectObjects(roots, true);
            if ((hits[0]?.point.distanceTo(p) ?? 1) > 0.01) continue;
            seen++;
            // pickTarget casts this same ray at the island's root again: it is handed the island's own
            // hits from the cast above, as that cast gives them (the same ray, the same meshes).
            const own = hits.filter((h) => under(h.object, sky.root)),
              picked = pickTarget(Object.create(ray, { intersectObject: { value: (o, ...rest) => (o === sky.root ? own : ray.intersectObject(o, ...rest)) } }), models, model.parkHit, pick);
            assert.equal(picked, 'sky-island', `At bearing ${bearing.toFixed(2)} the pointer on the sky island at ${p.toArray().map((n) => n.toFixed(2)).join(', ')} picks ${picked}.`);
          }
          assert(seen > 150, `Bearing ${bearing.toFixed(2)} sees only ${seen} points of the sky island.`);
          seenAll += seen;
          // (b) The open sky beside it, over it and under it answers nothing of it: a unit clear of
          // its volume's outline all round, and from a unit under the rock's lowest point on screen
          // (nearer, the pointer is within the slack the volume keeps round it, as round any building).
          const outline = hullOf(corners.map(flat)),
            mid = outline.reduce((sum, p) => [sum[0] + p[0] / outline.length, sum[1] + p[1] / outline.length], [0, 0]),
            centre = SKY_SHADOW.centre,
            [cu, cv] = flat(centre);
          for (const [u, w] of outline) {
            const l = Math.hypot(u - mid[0], w - mid[1]),
              beside = centre.clone().addScaledVector(right, mid[0] + ((u - mid[0]) * (l + 1)) / l - cu).addScaledVector(up, mid[1] + ((w - mid[1]) * (l + 1)) / l - cv);
            through(beside);
            assert.notEqual(pickTarget(ray, models, model.parkHit, pick), 'sky-island', `At bearing ${bearing.toFixed(2)} the open sky beside the sky island answers as it.`);
          }
          // (Under its lowest point on screen: the tip leans toward the file's camera, so from the far
          // side its belly hangs lower on screen than the tip does.)
          const lowest = still.reduce((a, b) => (flat(b)[1] < flat(a)[1] ? b : a));
          for (const below of [1, 1.6, 2.4]) {
            through(lowest.clone().addScaledVector(up, -below));
            assert.notEqual(pickTarget(ray, models, model.parkHit, pick), 'sky-island', `At bearing ${bearing.toFixed(2)} the air ${below} under the rock's lowest point on screen answers as the sky island.`);
          }
          // (c) It hugs the island: the volume's outline is about a third bigger than the island's own
        // at most (the villa's box over its terrace and the slab over the lawn are most of that).
          tightest = Math.max(tightest, areaOf(outline) / areaOf(hullOf(still.map(flat))));
        }
        // (d) No land behind it at any Rotate stop, through the idle drift: the island's own outline,
        // with the clouds and rocks that hang by it, keeps half a unit of sea from the town's land and
        // the airport's, and its pointer volume covers none of either (a click on the empty beach must
        // never open its file).
        const island = hullOf(shape.map(flat)),
          volumeOutline = hullOf(corners.map(flat));
        for (const p of land) {
          const q = flat(p);
          nearestLand = Math.min(nearestLand, outside(island, q));
          const over = outside(volumeOutline, q);
          hitLand = Math.min(hitLand, over);
          if (over > 0) continue;
          ray.set(p, back);
          assert.equal(ray.intersectObject(hit, true).length, 0, `At bearing ${bearing.toFixed(2)} drifted ${drift} the sky island's pointer volume covers land at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}.`);
        }
      }
    assert(nearestLand >= 0.5, `The sky island comes within ${nearestLand.toFixed(2)} of land on screen at a Rotate stop.`);
    assert(tightest < 1.36, `The sky island's pointer volume is ${tightest.toFixed(2)} times its own outline.`);
    // Hidden (the reading frames that would cut a slice of it), it answers nothing.
    dir.copy(axes(file).back).negate();
    through(new T.Vector3(S.x, S.top + 6, houseZ));
    assert.equal(pickTarget(ray, models, model.parkHit, pick), 'sky-island');
    sky.root.visible = false;
    assert.equal(pickTarget(ray, models, model.parkHit, pick), null, 'Hidden, the sky island still answers the pointer.');
    sky.root.visible = true;
    // And without it (the checks' town, a scene with none) the pointer is as it was.
    assert.equal(pickTarget(ray, models, model.parkHit), null);
    skyReport += `, its rim ${coast.toFixed(1)} from the waterline, ${nearestLand.toFixed(2)} of sea kept from land on screen (its pointer volume ${Math.max(0, hitLand).toFixed(2)}) and the pointer on it at ${seenAll} points`;
  }

  /* ---------------- its night ---------------- */
  {
    // The underside dims at night as the balloon does (SKY_ROCK.night: a pale mass never hangs lit
    // in the night sky), on its own copies of the batch materials, so nothing else of the town
    // darkens; and it keeps a fill of its own (SKY_ROCK.fill: the night's high moon lights nothing
    // that faces down), a dark brown, far from a glow (under 0.04 in linear luminance, a tenth of a
    // lit window's) but enough that the island's cone reads against the night sea (at 0.01, with half
    // its daylight, it sank to near-black and only the selection ring traced it). Its group is in the
    // town's animated list, batched in its own phase ('batch sky'), never again by the animated loop.
    const entry = model.animated.find((e) => e.object === sky.rock),
      parts = sky.rock.children.filter((o) => o.isMesh),
      others = new Set();
    assert(entry && sky.rock.userData.prebatched, 'The underside does not dim at night, or the animated loop batches it again.');
    entry.update(0, 1);
    city.traverse((o) => {
      if (o.isMesh && o.parent !== sky.rock) others.add(o.material);
    });
    const fill = new T.Color(SKY_ROCK.fill),
      luminance = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    for (const o of parts) {
      assert(!others.has(o.material), 'The underside dims a material the town shares.');
      assert(Math.abs(o.material.color.r - (1 - SKY_ROCK.night)) < 1e-6 && o.material.emissive.equals(fill), 'The underside stays bright at night, or has no fill.');
    }
    assert(luminance(fill) > 0.02 && luminance(fill) < 0.04 && fill.r > fill.g && fill.g > fill.b && SKY_ROCK.night <= 0.35, `The underside's night fill (${SKY_ROCK.fill}) is black, a glow or not a brown, or it keeps too little of its daylight (${1 - SKY_ROCK.night}).`);
    entry.update(0, 0);
    assert(parts.every((o) => o.material.color.r === 1 && o.material.emissive.getHex() === 0), 'The underside stays dim, or keeps its fill, by day.');
  }

  /* ---------------- its shadows ---------------- */
  {
    // On the sea (which takes no shadow): a pool multiplied onto it, the town's and never the
    // island's own, drawn after the sea with no depth write. By day it lies 5.4 from under the
    // island, at golden hour 10.1, opposite the key light; it goes with the night and thins in the rain.
    const shadow = createSeaShadow(WATER),
      m = shadow.mesh.material,
      water = city.getObjectByName('island-sea');
    assert(shadow.mesh.parent === null && m.transparent && !m.depthWrite && m.blending === T.CustomBlending && m.blendSrc === T.ZeroFactor && m.blendDst === T.SrcColorFactor && m.fog && shadow.mesh.renderOrder > water.renderOrder && !shadow.mesh.castShadow, 'The sea shadow is not a pool multiplied onto the sea after it.');
    assert(Math.abs(shadow.mesh.scale.x - (S.a + SEA_SHADOW.grow)) < 1e-9 && Math.abs(shadow.mesh.scale.z - (S.b + SEA_SHADOW.grow)) < 1e-9 && shadow.mesh.rotation.y === S.heading && SEA_SHADOW.depth >= 0.66 && SEA_SHADOW.depth <= 0.75 && SEA_SHADOW.height === 8.5, 'The sea shadow is not the deck\'s size and a little more, faint.');
    for (const [name, key, far] of [
      ['day', sunOffsetFor(0.6, Math.PI), 5.4],
      ['golden hour', sunOffsetFor(0.02, Math.PI * 1.45), 10.1],
    ]) {
      shadow.update(key, 0, 0);
      const dx = shadow.mesh.position.x - S.x,
        dz = shadow.mesh.position.z - S.z;
      assert(shadow.mesh.visible && m.uniforms.strength.value === 1 && Math.abs(Math.hypot(dx, dz) - far) < 0.15 && dx * key.x + dz * key.z < 0 && Math.abs(shadow.mesh.position.y - (WATER + SEA_SHADOW.lift)) < 1e-9, `By ${name} the sea shadow lies ${Math.hypot(dx, dz).toFixed(1)} from under the island.`);
    }
    shadow.update(sunOffsetFor(0.6, Math.PI), 1, 0);
    assert(!shadow.mesh.visible, 'The sea shadow stays at night.');
    shadow.update(sunOffsetFor(0.6, Math.PI), 0, 1);
    assert(shadow.mesh.visible && Math.abs(m.uniforms.strength.value - 0.35) < 1e-9, 'The sea shadow does not thin in the rain as the town\'s shadows do.');
    shadow.update(sunOffsetFor(0.6, Math.PI), 0, 0, false);
    assert(!shadow.mesh.visible, 'The sea shadow shows while the island is hidden.');
    assert(m.fragmentShader.includes('groundMasks') && !m.fragmentShader.includes('discard'), 'The sea shadow no longer fades over the shallows.');
    shadow.dispose();
    // The sun's box is the island's only while the view is close in on it with the town out of the
    // frame (check-navigation tries the real framings): never from afar, never with land in view.
    const camera = new T.OrthographicCamera(-44, 44, 27.5, -27.5, -200, 180),
      landMarks = plan.islandOutline.map(([x, z]) => new T.Vector3(x * (1 + 3.3 / Math.hypot(x, z)), 0, z * (1 + 3.3 / Math.hypot(x, z)))),
      look = (at, zoom, bearing = file) => {
        camera.position.copy(at).add(new T.Vector3(Math.sin(bearing) * 38, 35, Math.cos(bearing) * 38));
        camera.lookAt(at);
        camera.zoom = zoom;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
      };
    // (No panel and no sheet: the free part of the frame is all of it, its foot the frame's own, 1.)
    look(SKY_SHADOW.centre, 2);
    assert(skyShadowWanted(camera, landMarks, 0, 1, false) && skyShadowWanted(camera, landMarks, 0, 1, true), 'Close in on the sky island, the sun\'s shadow is not its own.');
    look(SKY_SHADOW.centre, 1.3);
    assert(!skyShadowWanted(camera, landMarks, 0, 1, false), 'From zoom 1.3 the sun\'s shadow leaves the town for the sky island.');
    look(new T.Vector3(-40, 5, -22), 1.5);
    assert(Math.abs(SKY_SHADOW.centre.clone().project(camera).x) < 1 && Math.abs(SKY_SHADOW.centre.clone().project(camera).y) < 1, 'The check\'s view of the island and the headland together has lost the island.');
    assert(!skyShadowWanted(camera, landMarks, 0, 1, false) && !skyShadowWanted(camera, landMarks, 0, 1, true), 'With the headland in view the sun\'s shadow stays on the sky island.');
    look(new T.Vector3(0, 0, 0), 2.4);
    assert(!skyShadowWanted(camera, landMarks, 0, 1, true), 'With the sky island out of view the sun\'s shadow stays on it.');
    assert(SKY_SHADOW.zoom[0] < SKY_SHADOW.zoom[1] && SKY_SHADOW.zoom[1] > 1 && SKY_SHADOW.land[0] > SKY_SHADOW.land[1] && SKY_SHADOW.fade > 0.05 && SKY_SHADOW.fade < 0.4, 'The shadow box changes hands at the City overview\'s zoom, without slack, or abruptly.');
  }

  /* ---------------- the falls' notches, the rock's beds, the floats and the lamps' pools ---------------- */
  // The art review of the merged island (findings 2, 4, 5 and 10):
  // - each fall leaves the rim through a notch in the coping, never a basin or a spout: within
  //   FALL.notch.half of its rim point the coping sinks under the stream's water (nothing of the stone
  //   stands over it), clear of the notch it keeps its full height, and three of the rock's own
  //   boulders (SKY_NOTCH.rocks) stand round it on the deck;
  // - the earth's beds are level: at the depth of each bed change the earth's paint (less the sea's
  //   bounce and the mottle) is the same all round the island (a wandering line smeared like paint),
  //   and the boulders are pieces of their own, cool grey against the brown;
  // - the three floating rocks are not clones;
  // - the lamps' pools: one opaque mesh laid over the deck (0.003 to 0.015 over the batched lawn and
  //   paths under it, measured against their own triangles), on the solids' one program so the night
  //   wash reaches it, casting nothing; its wash is strongest at each lamp's foot (plan.SKY_LAMPS,
  //   wherever they stand) and gone by SKY_POOL.r; by day its paint is the ground's under it (the
  //   lawn's stripe through the lawn material's own grain and LAWN_TINT, or the gravel's).
  {
    const { FALL } = await load('town-sky-garden'),
      { SKY_NOTCH, SKY_POOL } = await load('town-sky'),
      fmt3 = (p) => p.toArray().map((n) => n.toFixed(2)).join(', '),
      { WASH_PEAK, LAWN_TINT } = await load('city-materials'),
      rockMesh = sky.rock.children.find((o) => o.isMesh),
      flat = S.top - SKY_ROCK.body.top;
    for (const f of plan.skyFalls) {
      let notch = -Infinity,
        beside = -Infinity;
      each(sky.rock, (p) => {
        if (p.y < flat + 0.02) return;
        const d = Math.hypot(p.x - f.x, p.z - f.z);
        if (d < FALL.notch.half - 0.05) notch = Math.max(notch, p.y);
        else if (d > FALL.notch.half + FALL.notch.ramp + 0.35 && d < FALL.notch.half + FALL.notch.ramp + 0.8) beside = Math.max(beside, p.y);
      });
      assert(notch <= f.y + FALL.notch.floor + 1e-4 && notch < f.y + FALL.stream.level - 2 * FALL.stream.depth && Math.abs(beside - (S.top + Math.max(...SKY_COPING.profile.map(([, y]) => y)))) < 1e-3, `The coping at the fall on bearing ${(f.bearing / deg).toFixed(0)} stands ${(notch - f.y).toFixed(3)} over the rim's lawn in its notch (${(beside - S.top).toFixed(3)} beside it).`);
      const stone = sky.land.children.filter((o) => o.isMesh && o.material.userData.surfaceKind === 'stone'),
        frame = new T.Matrix4().compose(new T.Vector3(f.x, f.y, f.z), new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), f.ry), new T.Vector3(1, 1, 1));
      for (const r of SKY_NOTCH.rocks) {
        const at = new T.Vector3(...r.c).applyMatrix4(frame);
        let near = 0;
        for (const m of stone) each(m, (p) => Math.abs(p.x - at.x) < r.h[0] + 0.05 && Math.abs(p.z - at.z) < r.h[0] + 0.05 && Math.abs(p.y - at.y) < r.h[1] + 0.05 && near++);
        assert(near > 100 && Math.min(...r.h) >= 0.15, `No boulder stands by the fall's notch at ${fmt3(at)}.`);
      }
    }
    // The beds, level all round (read through the bounce and the mottle, which the rock's builder lays on).
    {
      const { noise3 } = await load('town-sculpt'),
        colour = rockMesh.geometry.attributes.color,
        q = rockMesh.geometry.attributes.position,
        nn = rockMesh.geometry.attributes.normal,
        B = SKY_ROCK.bounce,
        c = new T.Color(),
        grey = (k) => (Math.max(k.r, k.g, k.b) - Math.min(k.r, k.g, k.b)) / Math.max(k.r, k.g, k.b),
        lumOf = (k) => 0.2126 * k.r + 0.7152 * k.g + 0.0722 * k.b,
        cosH = Math.cos(S.heading),
        sinH = Math.sin(S.heading);
      for (const b of SKY_ROCK.beds.slice(0, 2)) {
        const seen = [];
        for (let i = 0; i < q.count; i++) {
          const y = q.getY(i) - S.top;
          if (Math.abs(-y - b) > 0.01) continue;
          // Back into the rock's own frame (its long axis on x), where its mottle is laid.
          const dx = q.getX(i) - S.x,
            dz = q.getZ(i) - S.z,
            lx = dx * cosH - dz * sinH,
            lz = dx * sinH + dz * cosH,
            u = T.MathUtils.smoothstep(-nn.getY(i), -0.1, 0.8),
            mottle = 1 + 0.07 * (noise3(lx * 0.9 + 11.3, y * 1.4 + 5.2, lz * 0.9 + 2.9) - 0.5);
          c.fromBufferAttribute(colour, i);
          c.setRGB(c.r / (1 + B[0] * u) / mottle, c.g / (1 + B[1] * u) / mottle, c.b / (1 + B[2] * u) / mottle);
          if (grey(c) > 0.25) seen.push(lumOf(c));
        }
        assert(seen.length > 40 && Math.max(...seen) - Math.min(...seen) < 0.01, `At the bed change ${b} under the deck the earth's paint wanders (${seen.length} points, ${(Math.max(...seen) - Math.min(...seen)).toFixed(3)} apart in luminance).`);
      }
    }
    // The floats: three rocks, each its own shape.
    {
      const shapes = plan.SKY_ROCKS.map((r, k) => {
        const frame = sky.land.children.filter((o) => o.name === 'sky-float')[k],
          box = new T.Box3();
        frame.updateMatrixWorld(true);
        const inv = frame.matrixWorld.clone().invert();
        each(frame, (p) => box.expandByPoint(p.clone().applyMatrix4(inv).divideScalar(r.size)));
        return box.getSize(new T.Vector3());
      });
      for (let a = 0; a < shapes.length; a++)
        for (let b = a + 1; b < shapes.length; b++) assert(shapes[a].distanceTo(shapes[b]) > 0.08, `Floating rocks ${a} and ${b} are clones (${fmt3(shapes[a])} and ${fmt3(shapes[b])}).`);
    }
    // The lamps' pools, against the ground as built: the batched lawn's and paths' own triangles,
    // found under a point by where it falls in them (barycentric). Each pool vertex, and each pool
    // triangle's middle, lies 0.003 to 0.015 over the lawn or the gravel under it: lower, the ground
    // shows through it at night (or fights it for depth); higher, it floats, and what stands in it
    // sinks into it. (As built 0.006 to 0.0105: SKY_POOL.lift, and more where the lawn's long
    // triangles by the rim sag under the dome the pool follows.) By day its paint is that ground's
    // as the visitor sees it: on the lawn, the stripe's colour there times the lawn material's own
    // grain (its map's texels at the lawn's uv through the map's own repeat, decoded from sRGB and
    // bilinear, as the GPU samples it close to) times the tint the empty masks leave (LAWN_TINT),
    // within 5e-4 (under a quarter of an 8-bit step in any channel of the lawn's greens); on the
    // gravel, the gravel's.
    {
      const pools = sky.land.children.filter((o) => o.isMesh && o.geometry.getAttribute('aWash')),
        [pool] = pools;
      assert(pools.length === 1 && !pool.castShadow && pool.material.vertexColors && pool.material.customProgramCacheKey() === 'lius-bake-solid' && !pool.material.transparent && pool.material.opacity === 1, 'The lamps\' pools are not one opaque mesh on the solids\' program, casting nothing.');
      /** The batched ground of a kind (one mesh): under(x, z) gives each of its triangles there, its height, colour and uv at the point. */
      const groundOf = (kind) => {
        const meshes = sky.land.children.filter((o) => o.isMesh && o.material.userData.surfaceKind === kind);
        assert.equal(meshes.length, 1, `The sky island's ${kind} is not one batched mesh.`);
        const [mesh] = meshes,
          { position, color, uv } = mesh.geometry.attributes,
          index = mesh.geometry.index,
          cell = 0.5,
          triangles = [],
          grid = new Map();
        for (let t = 0; t < (index?.count ?? position.count); t += 3) {
          const corners = [0, 1, 2].map((k) => {
              const i = index ? index.getX(t + k) : t + k;
              return { p: new T.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld), c: new T.Color().fromBufferAttribute(color, i), uv: new T.Vector2().fromBufferAttribute(uv, i) };
            }),
            xs = corners.map((v) => v.p.x),
            zs = corners.map((v) => v.p.z);
          for (let i = Math.floor(Math.min(...xs) / cell); i <= Math.floor(Math.max(...xs) / cell); i++)
            for (let j = Math.floor(Math.min(...zs) / cell); j <= Math.floor(Math.max(...zs) / cell); j++) (grid.get(`${i},${j}`) ?? grid.set(`${i},${j}`, []).get(`${i},${j}`)).push(triangles.length);
          triangles.push(corners);
        }
        return {
          mesh,
          under(x, z) {
            const hits = [];
            for (const t of grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? []) {
              const [a, b, c] = triangles[t],
                det = (b.p.z - c.p.z) * (a.p.x - c.p.x) + (c.p.x - b.p.x) * (a.p.z - c.p.z);
              if (Math.abs(det) < 1e-12) continue;
              const la = ((b.p.z - c.p.z) * (x - c.p.x) + (c.p.x - b.p.x) * (z - c.p.z)) / det,
                lb = ((c.p.z - a.p.z) * (x - c.p.x) + (a.p.x - c.p.x) * (z - c.p.z)) / det,
                lc = 1 - la - lb,
                at = (f) => f(a) * la + f(b) * lb + f(c) * lc;
              // (Within a hair of its edges: a point on an edge the two triangles share lies in both.)
              if (Math.min(la, lb, lc) >= -1e-4) hits.push({ y: at((v) => v.p.y), c: new T.Color(at((v) => v.c.r), at((v) => v.c.g), at((v) => v.c.b)), uv: new T.Vector2(at((v) => v.uv.x), at((v) => v.uv.y)) });
            }
            return hits;
          },
        };
      };
      const lawn = groundOf('grass'),
        gravel = groundOf('gravel'),
        map = lawn.mesh.material.map;
      assert(map?.isDataTexture && map.colorSpace === T.SRGBColorSpace && map.wrapS === T.RepeatWrapping && map.wrapT === T.RepeatWrapping && !map.flipY, 'The lawn\'s grain is not the repeating sRGB map the pools\' day colour is read from.');
      map.updateMatrix();
      const { data, width: W, height: H } = map.image,
        /** One of the map's texels, linear (the GPU decodes an sRGB map before it filters it), the map repeating. */
        texel = (i, j) => {
          const k = ((((j % H) + H) % H) * W + (((i % W) + W) % W)) * 4;
          return new T.Color().setRGB(data[k] / 255, data[k + 1] / 255, data[k + 2] / 255, T.SRGBColorSpace);
        },
        /** The lawn's grain at a uv of its own: the map through its own transform (its repeat), bilinear at its finest level. */
        grainAt = (uv) => {
          const m = uv.clone().applyMatrix3(map.matrix),
            u = m.x * W - 0.5,
            v = m.y * H - 0.5,
            i = Math.floor(u),
            j = Math.floor(v),
            fu = u - i,
            fv = v - j;
          return texel(i, j)
            .multiplyScalar((1 - fu) * (1 - fv))
            .add(texel(i + 1, j).multiplyScalar(fu * (1 - fv)))
            .add(texel(i, j + 1).multiplyScalar((1 - fu) * fv))
            .add(texel(i + 1, j + 1).multiplyScalar(fu * fv));
        },
        tint = new T.Color(...LAWN_TINT),
        low = 0.003,
        high = 0.015,
        where = (x, z) => `${x.toFixed(2)}, ${z.toFixed(2)}`,
        /**
         * What a point of the pool lies on: the gravel's or else the lawn's triangles under it that
         * it lies `low` to `high` over (the lawn runs on under the paths, so the gravel comes first).
         */
        restsOn = (x, y, z) => {
          const turf = lawn.under(x, z),
            paths = gravel.under(x, z),
            over = (hits) => hits.filter((h) => y - h.y >= low && y - h.y <= high),
            [onPaths, onTurf] = [over(paths), over(turf)];
          assert(turf.length, `A lamp's pool reaches off the lawn at ${where(x, z)}.`);
          assert(onPaths.length || onTurf.length, `A lamp's pool lies ${(y - turf[0].y).toFixed(4)} over the lawn${paths.length ? ` and ${(y - paths[0].y).toFixed(4)} over the gravel` : ''} at ${where(x, z)}, not ${low} to ${high} over the ground under it.`);
          return onPaths.length ? { gravel: onPaths } : { lawn: onTurf };
        },
        near = (a, b, e) => Math.abs(a.r - b.r) < e && Math.abs(a.g - b.g) < e && Math.abs(a.b - b.b) < e,
        q = pool.geometry.attributes.position,
        w = pool.geometry.attributes.aWash,
        col = pool.geometry.attributes.color,
        paint = new T.Color(),
        nearest = (x, z) => Math.min(...plan.SKY_LAMPS.map(([lx, lz]) => Math.hypot(x - lx, z - lz))),
        lit = plan.SKY_LAMPS.map(() => 0);
      for (let i = 0; i < q.count; i++) {
        const x = q.getX(i),
          y = q.getY(i),
          z = q.getZ(i),
          d = nearest(x, z),
          on = restsOn(x, y, z);
        assert(Math.abs(w.getX(i) - SKY_POOL.strength) < 1e-6 && w.getW(i) < 0 && Math.abs(w.getZ(i) - (WASH_PEAK + (0.85 - WASH_PEAK) * Math.min(1, d / SKY_POOL.r))) < 1e-5 && d < SKY_POOL.r + SKY_POOL.cell * 1.5, `A lamp's pool is not lit from the nearest lamp's foot at ${where(x, z)}.`);
        paint.fromBufferAttribute(col, i);
        if (on.gravel) assert(on.gravel.some((h) => near(paint, h.c, 1e-4)), `A lamp's pool on the gravel is not the gravel's colour at ${where(x, z)}.`);
        else assert(on.lawn.some((h) => near(paint, h.c.clone().multiply(grainAt(h.uv)).multiply(tint), 5e-4)), `A lamp's pool on the lawn is not the lawn's own colour there (its stripe, the grass map's grain, LAWN_TINT) at ${where(x, z)}.`);
        plan.SKY_LAMPS.forEach(([lx, lz], k) => Math.hypot(x - lx, z - lz) < 0.3 && lit[k]++);
      }
      // Each triangle's middle as well: across two of the ground's triangles, it could dip under them.
      const corners = pool.geometry.index;
      for (let t = 0; t < (corners?.count ?? q.count); t += 3) {
        const k = [0, 1, 2].map((j) => (corners ? corners.getX(t + j) : t + j));
        restsOn(k.reduce((s, i) => s + q.getX(i), 0) / 3, k.reduce((s, i) => s + q.getY(i), 0) / 3, k.reduce((s, i) => s + q.getZ(i), 0) / 3);
      }
      assert(lit.every((n) => n > 6), `A garden lamp has no pool at its foot (${lit.join(', ')}).`);
    }
  }

  /* ---------------- everything that moves ---------------- */
  {
    // The island as points: what is built (a share of it, and its rim, its chimney tops and its
    // tip whole), its falls' ribbons and their cloud puffs, and the clouds and rocks by it.
    const body = [...built.filter((_, k) => k % 14 === 0), ...plan.skyOutline(0, 72).map((p) => new T.Vector3(p.x, S.top - S.ring, p.z)), ...marks.slice(16, 26), ...floats.flat().filter((_, k) => k % 3 === 0)];
    for (const f of plan.skyFalls) {
      for (let k = 0; k <= 8; k++) body.push(new T.Vector3(f.x + (f.puff.x - f.x) * (k / 8), f.y - (f.y - f.puff.y) * (k / 8), f.z + (f.puff.z - f.z) * (k / 8)));
      for (let a = 0; a < 12; a++)
        for (const y of [f.puff.bottom, f.puff.y, f.puff.top]) {
          const r = y === f.puff.y ? f.puff.r : 0.5 * f.puff.r;
          body.push(new T.Vector3(f.puff.x + Math.cos((a / 12) * Math.PI * 2) * r, y, f.puff.z + Math.sin((a / 12) * Math.PI * 2) * r));
        }
    }
    const nearest = (x, y, z) => {
      let best = Infinity;
      for (const p of body) best = Math.min(best, Math.hypot(p.x - x, p.y - y, p.z - z));
      return best;
    };
    const flat2 = (x, z) => {
      let best = Infinity;
      for (const p of body) best = Math.min(best, Math.hypot(p.x - x, p.z - z));
      return best;
    };
    const gaps = { plane: Infinity, balloon: Infinity, gulls: Infinity, beam: Infinity, boat: Infinity, crane: Infinity };
    // The plane's middle through its whole visible loop. It passes the deck's north tip climbing out:
    // nearer than the 30 it keeps from the things it passes in the air, so the island has a rule of
    // its own, as the coast has its 12.
    for (let t = 0; t < plan.PLANE_LOOP; t += 0.25) {
      const p = plan.planePose(t);
      if (p.visible) gaps.plane = Math.min(gaps.plane, nearest(p.x, p.y + plan.PLANE.axis, p.z));
    }
    // The balloon's lap, turned either way with the idle drift about each view's centre (the plaza,
    // the shadow's home, the airport, the island and its file's ground point): its envelope's axis, less its radius.
    const { createGulls } = await load('city-atmosphere'),
      birds = createGulls(),
      [rockX, rockZ] = plan.lighthouseRock,
      centres = [[0, 0], [-3.5, -13.5], [plan.AIRPORT.x, plan.AIRPORT.z], [S.x, S.z], [-59, -34.1]];
    for (let t = 0; t < 900; t += 1.5) {
      balloon.update(t, 0);
      const b = balloon.object.position;
      for (const [cx, cz] of centres)
        for (const drift of [-0.16, 0, 0.16]) {
          const c = Math.cos(drift),
            s = Math.sin(drift),
            x = cx + (b.x - cx) * c + (b.z - cz) * s,
            z = cz - (b.x - cx) * s + (b.z - cz) * c;
          for (const y of [b.y, b.y + 1.7, b.y + 3.4, b.y + 5.06]) gaps.balloon = Math.min(gaps.balloon, nearest(x, y, z) - 1.6);
        }
      birds.update(t, 1);
      for (const g of birds.object.children) gaps.gulls = Math.min(gaps.gulls, nearest(g.position.x, g.position.y, g.position.z));
      beam.update(t, 1);
      const a = beam.object.rotation.y,
        tip = [rockX + Math.cos(a) * 18, rockZ - Math.sin(a) * 18],
        boat = plan.boatPose(t);
      for (const p of body) gaps.beam = Math.min(gaps.beam, plan.distanceToSegment([p.x, p.z], [rockX, rockZ], tip) - 3.6);
      gaps.boat = Math.min(gaps.boat, flat2(boat.x, boat.z) - 2.1);
    }
    balloon.update(0, 0);
    beam.update(3, 0);
    birds.dispose();
    // The crane's whole reach round its mast on the reserved plot.
    gaps.crane = flat2(plan.reservedPlot.x, plan.reservedPlot.z) - 6.47;
    for (const [name, least] of Object.entries({ plane: 20, balloon: 24, gulls: 50, beam: 50, boat: 70, crane: 55 }))
      assert(gaps[name] >= least, `The ${name} comes within ${gaps[name].toFixed(1)} of the sky island (${least} at least).`);
    skyReport += `; the plane passes ${gaps.plane.toFixed(1)} from it and the balloon ${gaps.balloon.toFixed(1)}`;
  }

  /* ---------------- the reading chapters' subjects ---------------- */
  {
    // From no chapter's bearing, through the idle drift, does the island (with what hangs by it)
    // stand before (or behind) the chapter's own buildings or the park: it keeps 2 units from them
    // on screen.
    const subjects = { ...plan.chapterSubjects, 'corner-park': ['corner-park'] },
      pointsOf = (id) => {
        const out = [];
        let k = 0;
        each(id === 'corner-park' ? model.parkGroup : models.get(id).root, (p) => k++ % 40 === 0 && out.push(p.clone()));
        return out;
      };
    let least = Infinity;
    for (const [chapter, ids] of Object.entries(subjects)) {
      if (chapter === 'sky-island') continue;
      for (const drift of drifts) {
        const { flat } = axes(plan.chapterBearings[chapter] + drift),
          island = hullOf(shape.map(flat));
        for (const id of ids) for (const p of pointsOf(id)) least = Math.min(least, outside(island, flat(p)));
      }
    }
    assert(least >= 2, `The sky island stands ${least.toFixed(1)} from a chapter's subject on screen.`);
  }

  /* ---------------- its garden ---------------- */
  // The garden as the town plants it (town-sky's skyGarden: lane G's kit, town-sky-garden, with the
  // town's own bench, tree and flower beds):
  // - each piece in its slot (skySlots): the tea table, the telescope, the bench, the tree, the two
  //   flower borders, the one set of four garden lamps, the two falls, the two clouds and the three
  //   floating rocks;
  // - SKY_SEATS are the kit's: her chair is the tea table's -x one; the telescope is built along her
  //   own gaze (lane F's ALISON_TELESCOPE, copied below until lane F is merged: 15 degrees down, its
  //   eyepiece 0.7058 over her feet and 0.3092 ahead of her root), so where she stands behind it her
  //   eye is its eyepiece;
  // - the tree is one of the town's round trees that shows the season, its trunk in the lawn, its
  //   crown under the overview's mark and 0.3 clear of the house;
  // - each border is the town's flower bed, its kerb the border's outline, standing on the lowest lawn
  //   under it, its blooms in a row along its back: as she walks the watering stretch her can (lane
  //   F's ALISON, copied below: it reaches 0.589 from her and hangs no lower than 0.38 over her feet)
  //   passes over the bed and never meets a bloom;
  // - the lamps are one set: one glass mesh of four globes at SKY_LAMPS, the town's lanterns' own
  //   glass, among its lamps (the frame loop lights them all with the night);
  // - the budget: lane G's kit as the island places it, batched as the island batches it, costs 14
  //   meshes and 16,000 triangles at the most, its own budget (the town's bench, tree and beds bring a
  //   family each of their own, iron, bark and the blooms', counted in the island's caps above);
  // - every joined piece standing in the garden is 0.07 across or more;
  // - motion: each moving part hangs on a pivot of its own with one entry in the town's animated list,
  //   one mesh each, posed from town time alone: as built at time 0 (the frozen frame Pause and reduced
  //   motion hold), the same a period later and while time stands still, whatever the night; nothing
  //   else on the island moves but the rock's night;
  // - through their whole drift and bob the clouds and rocks keep SKY_FLOAT_LIMITS (tucked no more than
  //   0.5 under the rim, 0.4 clear of the rock, under the rim's lawn, south of `north` and east of
  //   `west`, out of the villa's box) and stay inside plan.SKY_FLOAT_PROXY, the proxies the island's
  //   other checks and check-navigation use; the falls' water under the rim keeps 0.3 clear of the
  //   rock's cliffs and shoulders; the island stays inside the rain's square but for the west fall's
  //   puff, which pokes out by 2.2 at the most (the placement accepted 1.8 for it);
  // - nothing of the garden stands on her walk (the paths' width) or within her reach where she stands;
  // - at night the clouds dim on one material of the kit's own and the falls (their water, lumps and
  //   puffs) on another, to SKY_NIGHT's colours, with
  //   no glow, and nothing else of the island does but the rock, on its own (above).
  {
    const G = await load('town-sky-garden'),
      { createProps } = await load('town-props'),
      { createNature, treeLook, BLOOMS } = await load('town-nature'),
      { createKit } = await load('town-kit'),
      { createBatch } = await load('town-batch'),
      { createCityMaterials } = await load('city-materials'),
      { skyBorder } = await load('town-sky'),
      { createAlison, poseAlison, alisonHand, ALISON, ALISON_TELESCOPE, ALISON_HOLDS, ALISON_POSES, CAN_FOOT } = await load('sky-figure'),
      { TEA, TELESCOPE, FALL, CLOUD, GARDEN_LAMP, SKY_NIGHT } = G,
      slots = skySlots(),
      SEATS = plan.SKY_SEATS,
      ST = plan.SKY_STATIONS,
      // Lane F's Alison (app/sky-figure.ts: ALISON and ALISON_TELESCOPE): her eye at the telescope
      // (over her feet, and ahead of her root) and her gaze; her watering can's reach from her and how
      // low it hangs over her feet, measured on her own build through a sway of 'water'.
      HER_EYE = [ALISON.eyepiece, ALISON.standOff],
      HER_GAZE = [ALISON_TELESCOPE.gaze[1], ALISON_TELESCOPE.gaze[2]],
      HER_CAN = (() => {
        const { joints, props } = createAlison(createCityMaterials().material),
          can = { reach: 0, low: Infinity };
        for (let s = 0; s < 24; s++) {
          poseAlison(joints, props, 'water', s / 24);
          joints.root.updateMatrixWorld(true);
          props.can.traverse((m) => {
            if (!m.isMesh) return;
            const q = m.geometry.attributes.position;
            for (let i = 0; i < q.count; i++) {
              v.fromBufferAttribute(q, i).applyMatrix4(m.matrixWorld);
              can.reach = Math.max(can.reach, Math.hypot(v.x, v.z));
              can.low = Math.min(can.low, v.y);
            }
          });
        }
        return can;
      })(),
      fresh = (season = 'summer') => {
        const library = createCityMaterials(),
          ctx = { library, material: library.material, season, land: new T.Group(), lamps: [], clocks: [], animated: [] },
          kit = createKit(ctx),
          props = createProps(ctx, kit),
          nature = createNature(ctx, kit);
        return { ctx, nature, garden: G.createSkyGarden(ctx, kit, props, nature), batch: createBatch(ctx).batch };
      },
      frames = (name) => sky.land.children.filter((o) => o.name === name),
      inSlot = (o, slot) => Math.hypot(o.position.x - slot.x, o.position.y - slot.y, o.position.z - slot.z) < 1e-9 && Math.abs(plan.angleDiff(o.rotation.y, slot.ry ?? 0)) < 1e-9,
      fmt = (p) => p.toArray().map((n) => n.toFixed(2)).join(', '),
      /** Each run of joined faces in a mesh (faces sharing a corner): its box in the world. */
      pieces = (m) => {
        const q = m.geometry.attributes.position,
          index = m.geometry.index,
          key = (i) => `${q.getX(i).toFixed(4)},${q.getY(i).toFixed(4)},${q.getZ(i).toFixed(4)}`,
          parent = new Map(),
          find = (k) => (parent.get(k) === k ? k : (parent.set(k, find(parent.get(k))), parent.get(k))),
          corner = (t, j) => (index ? index.getX(t * 3 + j) : t * 3 + j),
          faces = (index ? index.count : q.count) / 3,
          out = new Map();
        for (let i = 0; i < q.count; i++) if (!parent.has(key(i))) parent.set(key(i), key(i));
        for (let t = 0; t < faces; t++) for (const j of [1, 2]) parent.set(find(key(corner(t, j))), find(key(corner(t, 0))));
        for (let t = 0; t < faces; t++) {
          const r = find(key(corner(t, 0)));
          if (!out.has(r)) out.set(r, new T.Box3());
          for (const j of [0, 1, 2]) out.get(r).expandByPoint(v.fromBufferAttribute(q, corner(t, j)).applyMatrix4(m.matrixWorld));
        }
        return [...out.values()];
      },
      // The garden's own meshes, as the town batched them: what stands in it (the deck's batch, less
      // the lawn, the paths and the lamps' pools, the deck's own surface laid again over itself), the
      // lamps' globes, and what moves (on its pivots).
      standingMeshes = sky.land.children.filter((o) => o.isMesh && o !== lawn && o !== gravel && !o.geometry.getAttribute('aWash')),
      globes = model.lamps.filter((l) => under(l, sky.root)),
      gardenMoving = skyMoving.filter((e) => e.object !== sky.rock && e.object !== her);

    // Each piece in its slot.
    const counts = Object.fromEntries(['sky-tea', 'sky-telescope', 'sky-bench', 'sky-tree', 'sky-border', 'sky-lamps', 'sky-urn', 'sky-fall', 'sky-cloud', 'sky-float'].map((n) => [n, frames(n).length]));
    assert.deepEqual(counts, { 'sky-tea': 1, 'sky-telescope': 1, 'sky-bench': 1, 'sky-tree': 1, 'sky-border': 2, 'sky-lamps': 1, 'sky-urn': 2, 'sky-fall': 2, 'sky-cloud': 2, 'sky-float': 3 }, 'The garden is not a tea table, a telescope, a bench and a tree, two borders, a set of lamps, two urns, two falls, two clouds and three floating rocks.');
    assert(inSlot(frames('sky-tea')[0], slots.tea) && inSlot(frames('sky-telescope')[0], slots.telescope) && inSlot(frames('sky-bench')[0], slots.bench) && inSlot(frames('sky-lamps')[0], slots.lamps), 'The tea table, the telescope, the bench or the lamps are off their slots.');
    for (const [name, list] of [['sky-urn', slots.urns], ['sky-fall', slots.falls], ['sky-cloud', slots.clouds], ['sky-float', slots.rocks]]) frames(name).forEach((f, k) => assert(inSlot(f, list[k]), `The garden's ${name} ${k} is off its slot.`));
    // The clouds lie long across the view from the island's file and the opening bearing (a cloud's
    // length is its x, turned by ry; a camera's screen runs along its bearing's): end on, a cloud is a lump.
    assert(plan.SKY_CLOUDS.every((c) => [file, Math.PI / 4].every((b) => Math.abs(Math.sin(c.ry - b)) < Math.sin(20 * deg))), 'A cloud is seen end on from the island\'s file or the opening bearing.');
    {
      const tree = frames('sky-tree')[0];
      assert(Math.hypot(tree.position.x - slots.tree.x, tree.position.z - slots.tree.z) < 1e-9 && tree.position.y === slots.tree.y, 'The tree is off its slot, or not on the lawn.');
    }

    // The seats: her chair is the tea table's -x one, SKY_SEATS.tea out along its x, facing as her
    // station does; the seats are the table's height.
    {
      const table = fresh().garden.teaTable(),
        [hers, guests] = table.userData.seats;
      assert(Math.abs(SEATS.tea - (TEA.radius + TEA.gap + TEA.setback)) < 1e-9 && SEATS.height === TEA.seat, 'SKY_SEATS\' tea chairs are not the tea table\'s.');
      assert(Math.abs(hers.x + SEATS.tea) < 1e-9 && Math.abs(guests.x - SEATS.tea) < 1e-9 && hers.z === 0 && Math.abs(plan.angleDiff(slots.tea.ry + hers.heading, ST.tea.seats[0].facing)) < 1e-9, 'Her chair at tea is not the table\'s -x one.');
    }
    // The telescope, built along her gaze to her eye: SKY_SEATS.telescope is its stand at her tilt,
    // and where she stands, behind it on the walk's gravel, her eye is its eyepiece; its tube runs on
    // from there along her gaze.
    {
      const E = G.telescopeEyepiece(SEATS.tilt),
        scope = fresh().garden.telescope({ eyepiece: slots.telescope.eyepiece, tilt: SEATS.tilt }),
        frame = frames('sky-telescope')[0],
        world = (p) => new T.Vector3(...p).applyAxisAngle(new T.Vector3(0, 1, 0), frame.rotation.y).add(frame.position),
        eyepiece = world(scope.userData.eyepiece),
        stand = world(scope.userData.stand),
        at = ST.telescope.stand,
        eye = new T.Vector3(at.x + Math.sin(at.facing) * HER_EYE[1], plan.skyFloor(at.x, at.z) + HER_EYE[0], at.z + Math.cos(at.facing) * HER_EYE[1]);
      assert(Math.abs(SEATS.telescope + scope.userData.stand[2]) < 1e-4, `SKY_SEATS.telescope (${SEATS.telescope}) is not the telescope's stand at her tilt (${(-scope.userData.stand[2]).toFixed(4)}).`);
      // (SKY_SEATS keeps lane F's eyepiece height to a tenth of a millimetre: the plan cannot load her module.)
      assert(Math.abs(SEATS.eyepiece - HER_EYE[0]) < 1e-4 && Math.abs(Math.sin(SEATS.tilt) + HER_GAZE[0]) < 2e-4 && Math.abs(E.height - HER_EYE[0]) < 5e-4 && Math.abs(E.standOff - HER_EYE[1]) < 5e-4, 'The telescope is not built to her eye and her gaze.');
      assert(Math.hypot(stand.x - at.x, stand.z - at.z) < 1e-4 && eye.distanceTo(eyepiece) < 1e-3, `At the telescope her eye is ${eye.distanceTo(eyepiece).toFixed(3)} from its eyepiece.`);
      scope.updateMatrixWorld(true);
      const brass = scope.children.find((m) => m.name === 'sky-telescope-brass'),
        gaze = new T.Vector3(0, -Math.sin(SEATS.tilt), Math.cos(SEATS.tilt)),
        end = new T.Vector3(...scope.userData.eyepiece),
        q = brass.geometry.attributes.position;
      let near = Infinity,
        far = -Infinity;
      for (let i = 0; i < q.count; i++) {
        const p = new T.Vector3().fromBufferAttribute(q, i).sub(end),
          along = p.dot(gaze);
        if (p.addScaledVector(gaze, -along).length() > TELESCOPE.hood + 0.01) continue;
        near = Math.min(near, along);
        far = Math.max(far, along);
      }
      assert(Math.abs(near) < 1e-6 && Math.abs(far - TELESCOPE.length) < 1e-6, 'The telescope\'s tube does not run down her gaze from its eyepiece.');
    }

    // The tree: the town's round tree that shows the season (an accent: blossom in spring, turning
    // in autumn), its trunk's foot in the lawn, its crown under the overview's mark and clear of the
    // house in every season.
    {
      const spec = { x: slots.tree.x, z: slots.tree.z, size: slots.tree.size, kind: slots.tree.kind, id: 'sky-tree' },
        seasons = ['spring', 'summer', 'autumn', 'winter'],
        H = V.house,
        wallZ = site.z + H.back;
      assert.equal(new Set(seasons.map((s) => JSON.stringify(treeLook(spec, SKY_TREE_SEED, s)))).size, 4, 'The sky island\'s tree does not show the season.');
      for (const season of seasons) {
        const g = new T.Group(),
          t = fresh(season).nature.tree(g, spec, SKY_TREE_SEED);
        t.position.y = slots.tree.y;
        g.updateMatrixWorld(true);
        let top = -Infinity,
          foot = Infinity,
          crowd = Infinity;
        each(g, (p) => {
          top = Math.max(top, p.y);
          if (Math.hypot(p.x - spec.x, p.z - spec.z) < 0.6) foot = Math.min(foot, p.y - plan.skyTop(p.x, p.z));
          if (p.y > S.top + 1 && Math.abs(p.x - site.x) < H.hw + 0.3) crowd = Math.min(crowd, wallZ - p.z);
        });
        assert(top <= S.top + plan.SKY_TREE.top + 1e-6 && foot < -0.02 && crowd >= 0.3, `In ${season} the sky island's tree tops out at ${top.toFixed(2)}, its foot ${foot.toFixed(3)} in the lawn, its crown ${crowd.toFixed(2)} from the house.`);
        // (Over the urns by the back door, its crown keeps 0.3 above their clipped balls.)
        let overUrns = Infinity;
        each(g, (p) => {
          for (const [x, z] of plan.SKY_URNS) if (Math.hypot(p.x - x, p.z - z) < 0.4) overUrns = Math.min(overUrns, p.y - plan.skyTop(x, z) - (G.URN.plant.y + G.URN.plant.r * 0.8 + G.URN.plant.r * 0.9));
        });
        assert(overUrns >= 0.3, `In ${season} the tree's crown comes within ${overUrns.toFixed(2)} of the urns' clipped balls.`);
      }
    }

    // The borders: the town's flower bed's kerb, the border's outline, on the lowest lawn under it, and
    // in it a bed of flowering plants (the final art review: a row of five like blobs on the bed's
    // smooth green bar read as beads or sweets): a leafy planting that casts, its outline a row of
    // soft clumps (along the bed its top rises and falls by 0.03 or more, five crowns or more), and the
    // town's own blooms over it, a dozen or more, in two rows along the back (each level along the
    // bed), staggered (along the bed the two rows take turns), of three sizes or more (the back row's
    // the larger), each in one of the town's bloom colours, three colours or more a border and no two
    // neighbours in a row alike; the west border mirrors the east about the steps. The town's own
    // blooms are these. As she walks the watering stretch (the east border), facing it, her can passes
    // over the bed and meets no bloom.
    {
      const { nature } = fresh(),
        rows = [],
        planted = [];
      slots.borders.forEach((b, k) => {
        const g = new T.Group(),
          bed = skyBorder(nature, g, b, k);
        g.updateMatrixWorld(true);
        const blooms = bed.children.filter((o) => o.userData.noShadow),
          kerb = bed.children.find((o) => o.material.userData.surfaceKind === 'stone'),
          box = new T.Box3().setFromObject(kerb),
          rest = bed.children.filter((o) => !blooms.includes(o)),
          // Its outline, drawn in at its outer end (the east border's east, the west's west).
          [x0, x1] = k ? [b.x - b.w / 2 + SKY_BEDS.trim, b.x + b.w / 2] : [b.x - b.w / 2, b.x + b.w / 2 - SKY_BEDS.trim],
          what = k ? 'west' : 'east';
        assert(SKY_BEDS.trim >= 0 && SKY_BEDS.trim <= 0.2 && Math.abs(box.min.x - x0) < 1e-6 && Math.abs(box.max.x - x1) < 1e-6 && Math.abs(box.min.z - (b.z - b.d / 2)) < 1e-6 && Math.abs(box.max.z - (b.z + b.d / 2)) < 1e-6 && Math.abs(box.min.y - b.floor) < 1e-6, `The ${what} border's kerb is not its outline, on the lowest lawn under it.`);
        for (const [x, z] of [[box.min.x, box.min.z], [box.max.x, box.min.z], [box.min.x, box.max.z], [box.max.x, box.max.z], [b.x, box.min.z], [b.x, box.max.z]]) assert(plan.skyTop(x, z) >= b.floor - 1e-9, 'A border\'s kerb floats over the lawn.');
        // The leaves: one casting foliage mesh inside the kerb, its outline a row of clumps.
        const leaves = rest.filter((o) => o.material.userData.surfaceKind === 'foliage');
        assert(leaves.length === 1 && leaves[0].castShadow && rest.length === 2, `The ${what} border is not its kerb and one leafy planting.`);
        const slices = Array.from({ length: 40 }, () => -Infinity);
        each(leaves[0], (p) => {
          assert(p.x > box.min.x && p.x < box.max.x && p.z > box.min.z && p.z < box.max.z, `The ${what} border's leaves reach past its kerb at ${fmt(p)}.`);
          const s = Math.min(39, Math.floor(((p.x - box.min.x) / (box.max.x - box.min.x)) * 40));
          slices[s] = Math.max(slices[s], p.y);
        });
        const tops = slices.slice(4, 36),
          crowns = tops.filter((y, i) => i > 0 && i < tops.length - 1 && y > tops[i - 1] && y >= tops[i + 1]).length;
        assert(Math.max(...tops) - Math.min(...tops) >= 0.03 && crowns >= 5, `The ${what} border's leaves are a smooth bar (their top within ${(Math.max(...tops) - Math.min(...tops)).toFixed(3)}, ${crowns} crowns).`);
        // The blooms: two rows, staggered, of several sizes and colours.
        const byRow = new Map();
        for (const m of blooms) (byRow.get(m.position.z.toFixed(4)) ?? byRow.set(m.position.z.toFixed(4), []).get(m.position.z.toFixed(4))).push(m);
        const [backRow, frontRow] = [...byRow.entries()].sort((a, c) => +a[0] - +c[0]).map(([, list]) => list.sort((a, c) => a.position.x - c.position.x)),
          scale = (m) => m.scale.x,
          mean = (list) => list.reduce((s, m) => s + scale(m), 0) / list.length,
          merged = blooms.slice().sort((a, c) => a.position.x - c.position.x),
          turns = merged.filter((m, i) => i && backRow.includes(m) !== backRow.includes(merged[i - 1])).length,
          colours = new Set(blooms.map((m) => m.material.color.getHex()));
        assert(blooms.length >= 12 && byRow.size === 2 && turns >= blooms.length - 3 && new Set(blooms.map((m) => scale(m).toFixed(2))).size >= 3 && mean(backRow) > mean(frontRow), `The ${what} border's ${blooms.length} blooms are not two staggered rows of several sizes (${byRow.size} rows, ${turns} turns).`);
        assert(colours.size >= 3 && blooms.every((m) => BLOOMS.some((c) => m.material.color.equals(new T.Color(c)))) && [backRow, frontRow].every((list) => list.every((m, i) => !i || !m.material.color.equals(list[i - 1].material.color))), `The ${what} border's blooms are not the town's colours, three or more, no two neighbours alike.`);
        for (const m of blooms) rows.push(m.position.clone());
        planted.push(blooms.map((m) => ({ x: m.position.x, y: m.position.y, z: m.position.z, s: scale(m), c: m.material.color.getHex() })));
        if (k) return;
        // Her can, along the stretch she waters (facing the border, north).
        const W = ST.watering;
        for (let x = W.from.x; x <= W.to.x + 1e-9; x += 0.05) {
          const floor = plan.skyTop(x, W.from.z);
          for (const m of blooms) each(m, (p) => assert(Math.hypot(p.x - x, p.z - W.from.z) >= HER_CAN.reach + 0.02, `Her can meets a bloom of the east border at ${fmt(p)}.`));
          for (const m of rest) each(m, (p) => assert(Math.hypot(p.x - x, p.z - W.from.z) > HER_CAN.reach || p.y <= floor + HER_CAN.low - 0.005, `The east border stands in her can's way at ${fmt(p)}.`));
        }
      });
      // The west border mirrors the east about the steps (the island's middle line).
      assert(planted[0].length === planted[1].length && planted[0].every((e) => planted[1].some((w) => Math.abs(w.x - (2 * S.x - e.x)) < 1e-6 && Math.abs(w.y - e.y) < 1e-6 && Math.abs(w.z - e.z) < 1e-6 && Math.abs(w.s - e.s) < 1e-6 && w.c === e.c)), 'The west border does not mirror the east.');
      // The town's own blooms (the deck's batch that casts nothing and is foliage) stand where these do.
      const batched = standingMeshes.filter((m) => m.material.userData.surfaceKind === 'foliage' && !m.castShadow).flatMap(pieces).map((b) => b.getCenter(new T.Vector3()));
      assert(batched.length === rows.length && rows.every((r) => batched.some((c) => Math.hypot(c.x - r.x, c.z - r.z) < 1e-3)), 'The town\'s borders are not planted as skyBorder plants them.');
    }

    // The lamps: one set, its four globes one mesh among the town's lamps, the lanterns' own glass.
    {
      const set = globes[0],
        balls = set ? pieces(set) : [];
      assert(globes.length === 1 && set.parent?.parent === frames('sky-lamps')[0], 'The garden lamps are not one set of globes among the town\'s lamps.');
      assert(set.material.emissive.getHex() === new T.Color(palette.lantern).getHex() && set.material.userData.surfaceKind === 'glass' && !set.castShadow, 'The garden lamps\' globes are not the lanterns\' own glass.');
      assert.equal(balls.length, plan.SKY_LAMPS.length, 'The set of garden lamps has not a globe a lamp.');
      for (const [x, z] of plan.SKY_LAMPS) {
        const ball = balls.find((b) => Math.hypot(b.getCenter(v).x - x, v.z - z) < 1e-3);
        assert(ball && Math.abs(ball.max.y - plan.skyTop(x, z) - GARDEN_LAMP.height) < 0.005, `No globe stands on the garden lamp at ${x}, ${z}.`);
      }
    }

    // The budget: lane G's kit as the island places it (skyGarden's slots and options), batched as
    // the island batches it (the deck as the floor, the moving parts each on its own); the town's own
    // moving parts and globes are these.
    let kitMeshes = 0,
      kitTriangles = 0;
    {
      const { ctx, garden, batch } = fresh(),
        root = new T.Group(),
        put = (slot, piece) => {
          const f = new T.Group();
          f.position.set(slot.x, slot.y, slot.z);
          f.rotation.y = slot.ry ?? 0;
          f.add(piece);
          root.add(f);
        };
      put(slots.tea, garden.teaTable());
      put(slots.telescope, garden.telescope({ eyepiece: slots.telescope.eyepiece, tilt: slots.telescope.tilt }));
      put(slots.lamps, garden.gardenLamps(slots.lamps.spots));
      for (const u of slots.urns) put(u, garden.urn({ planted: true }));
      slots.falls.forEach((f, k) => put(f, garden.fall({ rise: f.rise, seed: k + 1 })));
      for (const c of slots.clouds) put(c, garden.cloud({ size: c.size, seed: c.seed }));
      for (const r of slots.rocks) put(r, garden.floatingRock({ size: r.size, seed: r.seed }));
      // (As built: each moving part in its time-0 pose, the frozen frame. The town's, posed at time 0 above, are the same.)
      const poseOf = (o) => [...o.position.toArray(), ...o.quaternion.toArray()];
      assert(ctx.animated.length === gardenMoving.length && ctx.animated.every((e, k) => poseOf(e.object).every((n, i) => Math.abs(n - poseOf(gardenMoving[k].object)[i]) < 1e-9)), 'The town\'s garden does not move as the kit builds it, or is not in its time-0 pose.');
      root.updateMatrixWorld(true);
      batch(root, { floor: plan.skyTop });
      for (const e of ctx.animated) batch(e.object, { contact: 'none' });
      root.traverse((o) => {
        if (!o.isMesh) return;
        kitMeshes++;
        kitTriangles += trianglesOf(o);
      });
      assert(kitMeshes <= 14 && kitTriangles <= 16000, `The garden kit's pieces cost ${kitMeshes} meshes and ${kitTriangles} triangles as the island places them.`);
      const movingOf = (list) => list.flatMap((e) => e.object.children.filter((c) => c.isMesh)).reduce((n, m) => n + trianglesOf(m), 0);
      assert(movingOf(ctx.animated) === movingOf(gardenMoving) && trianglesOf(ctx.lamps[0]) === trianglesOf(globes[0]), 'The town\'s garden is not the kit\'s pieces as skyGarden places them.');
    }
    let gardenMeshes = standingMeshes.length + globes.length,
      gardenTriangles = [...standingMeshes, ...globes].reduce((n, m) => n + trianglesOf(m), 0);
    for (const e of gardenMoving)
      for (const m of e.object.children.filter((c) => c.isMesh)) {
        gardenMeshes++;
        gardenTriangles += trianglesOf(m);
      }

    // The clipped planting: a planted urn either side of the back door's step, outside the villa's
    // footprint and its back wall's plinth, on the deck. And the low outcrop of the rock's own grey
    // on the south-west lawn (it is the island's own, batched with the deck's stone): low (half a unit
    // at the most over the lawn), its foot in the lawn all round, smooth (one normal wherever its
    // triangles meet), in the rock's own greys (SKY_LOOK.rock, held to their family above), 0.6 or
    // more from the rim (clear of the coping), clear of the paths, the lamps and her stations (the
    // walk's check below).
    {
      const urnReach = 0.335;
      for (const [x, z] of plan.SKY_URNS) {
        const [fx, fz] = [x - site.x, z - site.z];
        assert(Math.abs(Math.abs(fx) - plan.SKY_URN.side) < 1e-9 && fz + urnReach < -V.d / 2 && Math.abs(fx) - urnReach > 0.62 + 0.1 && plan.onSky(x, z, -1), `The urn at ${x.toFixed(2)}, ${z.toFixed(2)} is not beside the back step, outside the villa.`);
      }
      const { SKY_OUTCROP_SHAPE: O } = await load('town-sky'),
        P = plan.SKY_OUTCROP,
        stones = standingMeshes.filter((m) => m.material.userData.surfaceKind === 'stone'),
        seen = new Map();
      let top = -Infinity,
        foot = Infinity,
        rim = Infinity,
        points = 0;
      for (const m of stones) {
        const q = m.geometry.attributes.position,
          nn = m.geometry.attributes.normal;
        for (let i = 0; i < q.count; i++) {
          v.fromBufferAttribute(q, i).applyMatrix4(m.matrixWorld);
          if (Math.hypot(v.x - P.x, v.z - P.z) > 1.3) continue;
          points++;
          const lawnAt = plan.skyTop(v.x, v.z);
          top = Math.max(top, v.y - lawnAt);
          foot = Math.min(foot, v.y - lawnAt);
          rim = Math.min(rim, -plan.skyDistance(v.x, v.z));
          const key = [v.x, v.y, v.z].map((n) => Math.round(n * 2000)).join(),
            normal = new T.Vector3().fromBufferAttribute(nn, i);
          if (seen.has(key)) assert(seen.get(key).dot(normal) > 0.999, 'The outcrop is faceted: two normals at one point.');
          else seen.set(key, normal);
        }
      }
      assert(points > 300 && top > 0.25 && top <= 0.5 && foot < -0.05 && rim >= 0.6 && O.sink >= 0.1, `The outcrop stands ${top.toFixed(2)} over the lawn, its foot ${foot.toFixed(2)} in it, ${rim.toFixed(2)} from the rim.`);
      assert(SKY_LOOK.rock.length === 3 && O.lumps.length === 3 && O.lumps.every((l) => Math.min(...l.h) >= 0.15), 'The outcrop is not three chunky stones of the rock\'s own greys.');
      skyReport += `, its outcrop ${top.toFixed(2)} over the lawn`;
    }

    // Every joined piece standing in the garden is 0.07 across or more.
    for (const m of standingMeshes)
      for (const box of pieces(m)) {
        const size = box.getSize(new T.Vector3());
        assert(Math.min(size.x, size.y, size.z) >= 0.07 - 1e-3, `A ${m.material.userData.surfaceKind} piece of the sky island's garden is ${fmt(size)} at ${fmt(box.getCenter(new T.Vector3()))}.`);
      }

    // Motion: from town time alone, each part on a pivot of its own, one mesh, one entry.
    {
      const periodOf = (o) => (o.name.startsWith('sky-fall-') ? FALL.period : o.name === 'sky-cloud-drift' ? CLOUD.period : o.parent.userData.period),
        poseOf = (o) => [...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()],
        same = (a, b) => a.every((n, i) => Math.abs(n - b[i]) < 1e-9);
      assert.equal(gardenMoving.length, 2 * 2 + plan.SKY_CLOUDS.length + plan.SKY_ROCKS.length, 'The garden\'s moving parts are not its falls\' still water and lumps, its clouds and its rocks.');
      // (Besides the garden, the rock's night and Alison move, each checked on its own.)
      assert(skyMoving.length === gardenMoving.length + 2 && skyMoving.filter((e) => e.object === sky.rock || e.object === her).length === 2, 'Something else on the sky island moves.');
      for (const e of gardenMoving) {
        const o = e.object;
        assert(o.userData.keepSeparate && !o.userData.prebatched && o.children.filter((c) => c.isMesh).length === 1 && model.animated.filter((x) => x.object === o).length === 1, `The garden's ${o.name} is not one mesh on a pivot of its own with one entry.`);
        for (const t of [0, 13.7, 86400 * 2 + 77.3]) {
          e.update(t, 0, 0);
          const at = poseOf(o);
          e.update(t, 1, 1);
          assert(same(at, poseOf(o)), `The garden's ${o.name} moves with the night or the rain, or while time stands still.`);
          e.update(t + periodOf(o), 0, 0);
          assert(same(at, poseOf(o)), `The garden's ${o.name} is not back where it was a period later.`);
        }
        e.update(0, 0, 0);
      }
    }

    // The clearances, through the motion. A spatial grid of the rock's points, for distances to it.
    {
      const cell = 0.4,
        grid = new Map(),
        keyOf = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
      each(sky.rock, (p) => {
        const k = keyOf(p.x, p.y, p.z);
        (grid.get(k) ?? grid.set(k, []).get(k)).push(p.clone());
      });
      const nearRock = (p, d) => {
        const [i, j, k] = [p.x, p.y, p.z].map((n) => Math.floor(n / cell));
        for (let a = -1; a <= 1; a++)
          for (let b = -1; b <= 1; b++)
            for (let c = -1; c <= 1; c++) for (const q of grid.get(`${i + a},${j + b},${k + c}`) ?? []) if (q.distanceToSquared(p) < d * d) return true;
        return false;
      };
      const L = plan.SKY_FLOAT_LIMITS,
        villaBox = new T.Box3().setFromObject(sky.shell).expandByScalar(0.3);
      // The clouds and rocks through their drift and bob: within the limits, clear of the rock, and
      // inside their proxies (plan.SKY_FLOAT_PROXY, in their slots' frames).
      for (const [name, list, kind] of [['sky-cloud', plan.SKY_CLOUDS, 'cloud'], ['sky-float', plan.SKY_ROCKS, 'rock']])
        frames(name).forEach((frame, n) => {
          const f = list[n];
          let entry = null;
          frame.traverse((o) => {
            if (o.userData.keepSeparate) entry = gardenMoving.find((e) => e.object === o);
          });
          const period = kind === 'cloud' ? CLOUD.period : entry.object.parent.userData.period;
          for (let s = 0; s < 16; s++) {
            entry.update((s / 16) * period, 0, 0);
            frame.updateMatrixWorld(true);
            const inv = frame.matrixWorld.clone().invert();
            each(entry.object, (p) => {
              assert(plan.skyDistance(p.x, p.z) >= -L.tuck && p.y <= L.top && p.z >= L.north && p.x >= L.west && Math.abs(p.x) <= 58 && Math.abs(p.z) <= 58 && !villaBox.containsPoint(p), `The garden's ${kind} ${n} leaves its limits at ${fmt(p)}.`);
              assert(!nearRock(p, L.clear), `The garden's ${kind} ${n} comes within ${L.clear} of the rock at ${fmt(p)}.`);
              const l = p.clone().applyMatrix4(inv).divideScalar(f.size);
              assert(proxyMeasure(kind, l.toArray()) <= 1, `The garden's ${kind} ${n} leaves its proxy (plan.SKY_FLOAT_PROXY) at ${fmt(p)}.`);
            });
          }
          entry.update(0, 0, 0);
        });
      // The falls' water under the rim (the sheet, its lumps through their slide, the puff) keeps
      // 0.3 clear of the rock; the west fall (its spout's nose and its water) is all that leaves the
      // rain's square, its puff by 2.2 at the most.
      const west = plan.skyFalls.reduce((a, b) => (b.x < a.x ? b : a)),
        beyond = (p) => Math.max(Math.abs(p.x) - 58, Math.abs(p.z) - 58);
      let rain = -Infinity,
        elsewhere = -Infinity;
      for (const e of gardenMoving.filter((x) => x.object.name.startsWith('sky-fall-')))
        for (const t of [0, FALL.period / 3, (2 * FALL.period) / 3]) {
          e.update(t, 0, 0);
          e.object.updateMatrixWorld(true);
          each(e.object, (p) => {
            if (p.y < west.y - 0.4) assert(!nearRock(p, 0.3), `A fall's water comes within 0.3 of the rock at ${fmt(p)}.`);
          });
          e.update(0, 0, 0);
        }
      city.updateMatrixWorld(true);
      each(sky.root, (p, o) => {
        const fall = (pivotOf(o)?.name ?? '').startsWith('sky-fall-') || !pivotOf(o);
        if (fall && Math.hypot(p.x - west.puff.x, p.z - west.puff.z) < 2.5) rain = Math.max(rain, beyond(p));
        else elsewhere = Math.max(elsewhere, beyond(p));
      });
      assert(elsewhere <= 0 && rain <= 2.2, `The sky island leaves the rain's square by ${Math.max(0, elsewhere).toFixed(2)} (its west fall by ${rain.toFixed(2)}).`);
      skyReport += `, its west fall's puff ${rain.toFixed(2)} past the rain's square`;
    }

    // Nothing of the garden stands on her walk (over the paths' own gravel), nor within her reach
    // where she stands (at the telescope, along both watering stretches, and beside her chair, where
    // she gets up and sits down: the chair itself keeps the walkers' 0.27 from her there too). She
    // waters a little in from the walk's middle, up to the border: its kerb, lower than her hips,
    // clears her legs.
    {
      const tris = [],
        q = gravel.geometry.attributes.position;
      for (let t = 0; t < q.count; t += 3) tris.push([0, 1, 2].map((j) => [q.getX(t + j), q.getZ(t + j)]));
      const onPath = (x, z) =>
          tris.some(([a, b, c]) => {
            const s1 = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]),
              s2 = (c[0] - b[0]) * (z - b[1]) - (c[1] - b[1]) * (x - b[0]),
              s3 = (a[0] - c[0]) * (z - c[1]) - (a[1] - c[1]) * (x - c[0]);
            return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
          }),
        along = (from, to, z = ST.watering.from.z) => Array.from({ length: 9 }, (_, k) => ({ x: from + ((to - from) * k) / 8, z })),
        { west, east } = plan.SKY_DAY.stretches,
        // (She waters a little in from the walk's middle, toward the border: SKY_WATERING.in.)
        waterZ = plan.SKY_DAY.acts.find((a) => a.kind === 'water').z,
        standing = [ST.telescope.stand, ...along(ST.watering.from.x, ST.watering.to.x), ...along(west.from, west.to, waterZ), ...along(east.from, east.to, waterZ), { x: plan.SKY_DAY.beside[0], z: plan.SKY_DAY.beside[1] }],
        reach = 0.27,
        // (What stands lower than her hips, a border's kerb she waters over, need only clear her legs,
        // which reach 0.13 from her: she stands up to the border to water it.)
        knee = 0.3,
        feet = 0.15;
      let over = 0,
        nearest = Infinity,
        nearestLow = Infinity;
      for (const m of [...standingMeshes, ...globes])
        each(m, (p) => {
          const rise = p.y - plan.skyTop(p.x, p.z);
          if (rise < 0.03) return;
          if (onPath(p.x, p.z)) over++;
          for (const s of standing) {
            const d = Math.hypot(p.x - s.x, p.z - s.z);
            if (rise < knee) nearestLow = Math.min(nearestLow, d);
            else nearest = Math.min(nearest, d);
          }
        });
      assert(over === 0 && nearest >= reach && nearestLow >= feet, `The garden stands on her walk (${over} points over the paths), or ${Math.min(nearest, nearestLow).toFixed(2)} from where she stands.`);
    }

    // Night: the pale parts dim on one material of the kit's own, no glow; nothing else does.
    {
      const pale = gardenMoving.filter((e) => /^sky-(fall|cloud)-/.test(e.object.name)).flatMap((e) => e.object.children.filter((c) => c.isMesh)),
        others = [];
      sky.root.traverse((o) => o.isMesh && !pale.includes(o) && !globes.includes(o) && o.parent !== sky.rock && others.push(o));
      // (The clouds keep most of their daylight, a cool moonlit grey: at 0.7 grey they read as slate
      // boulders over the night sea; the falls keep more, so a fall stays pale and never reads as a
      // dark downpipe. The kit's check above holds SKY_NIGHT's values.)
      const isFall = (m) => (pivotOf(m)?.name ?? '').startsWith('sky-fall-');
      for (const e of gardenMoving) e.update(5, 1, 0);
      assert(new Set(pale.map((m) => m.material)).size === 2 && new Set(pale.filter(isFall).map((m) => m.material)).size === 1 && pale.length === 2 * 2 + plan.SKY_CLOUDS.length, 'The falls and the clouds do not each share one material of the garden kit\'s own.');
      for (const m of pale) assert(m.material.color.equals(new T.Color(isFall(m) ? SKY_NIGHT.fall : SKY_NIGHT.cloud)) && m.material.emissive.getHex() === 0 && !others.some((o) => o.material === m.material), 'A fall, a puff or a cloud is not its night colour at night, glows, or shares its material.');
      for (const o of others) assert(o.material.color.getHex() === 0xffffff, 'Something of the sky island but its rock and its pale parts dims at night.');
      for (const e of gardenMoving) e.update(0, 0, 0);
      for (const m of pale) assert.equal(m.material.color.getHex(), 0xffffff, 'The falls, puffs and clouds are dimmed by day.');
    }
    skyReport += `; its garden ${gardenMeshes} meshes and ${gardenTriangles} triangles (the garden kit's own ${kitMeshes} and ${kitTriangles})`;

    /* ---------------- Alison in place ---------------- */
    // Alison (lane F's sky-figure; the block above the residents' checks holds her own build) as the
    // island stands her (town-sky's alison(): her root on the island's root, a pivot of its own,
    // batched part by part) and takes her through her day (plan.alisonDay, SKY_DAY: tea, the west
    // border, the east border, the telescope, and back to tea):
    // - the frozen frame: she is built posed at time 0 (as the phased build has her), in her chair at
    //   tea, her cup resting on its saucer; night and rain change nothing (as for the walkers); she has
    //   one entry in the animated list;
    // - her day runs without a gap from 0 to its period (90 to 150 s) and comes round exactly: the same
    //   a period later, seven later and at a large time; every pose is one of lane F's;
    // - she never moves faster than her walk (SKY_GAIT.speed) nor turns faster than 3.5 radians a
    //   second, but as she sits down and gets up (the one step, SKY_TEA.beside long, between her
    //   chair's seat and her place beside it, facing the table); walking, her gait's phase is the
    //   distance she has walked over lane F's stride, so her feet never slide, and each walk eases its
    //   gait in and out over 0.35 or less of its length; only walk and stand blend: a pose changes only
    //   while she stands still (a walk ending or starting at no gait), or as she sits down or gets up;
    // - she is always on the deck, a unit or more in from the rim, and walking, on the walk's gravel
    //   but for the step between it and her chair's side (within 0.35 of where she stands there);
    // - standing (still, walking, watering, mid-sidestep or at the telescope) her lower sole is on the
    //   ground drawn under it, the lawn or the paths' gravel where she is on it, and where she steps up
    //   onto the gravel over a step of the lawn outside its edge, between the lawn and the gravel's
    //   top; seated, her thighs are on her chair's seat; in a sidestep the planted foot stays put;
    // - at tea her hands are on the cup and the saucer, the cup resting on it between sips, and nothing
    //   of her is in her chair's back (its posts and rail, behind her hair), its seat or the table's top;
    //   watering, her hand is on the can's handle, its rose over the bed while the water shows, and the
    //   can clears the border (its kerb, mound and blooms) all the way along both stretches; at the
    //   telescope, once she is stooped to it, her eye is 0.05 to 0.08 behind its eyepiece, on its line
    //   of sight, and her hands on its tube (her +x one, while her -x one holds the can at her side);
    // - her can: in her hand whenever she has it (watering, carrying it, and from the bottom of her
    //   stoop to take it up on); otherwise it stands exactly at its place (SKY_DAY.can), level and turned
    //   as that says, on the west border's kerb: its foot on the kerb's top, nothing of it in the
    //   border's mound or below its kerb;
    // - from the island's file (its bearing, at its own pitch) nothing of her ever shows over the
    //   villa's front door.
    {
      const D = plan.SKY_DAY,
        GA = plan.SKY_GAIT,
        W = plan.SKY_WATERING,
        entry = model.animated.filter((e) => e.object === her),
        joint = (name) => her.getObjectByName(name),
        legs = ['leg-left', 'leg-right'].map(joint),
        arms = ['arm-left', 'arm-right'].map(joint),
        joints = { root: her, body: joint('body'), legs, knees: legs.map((l) => l.getObjectByName('knee')), arms, elbows: arms.map((a) => a.getObjectByName('elbow')) },
        held = { can: joint('watering-can'), cup: joint('teacup'), saucer: joint('saucer'), water: joint('water-stream') },
        /** Her pose at day time t, as the town's frame loop sets it; returns alisonDay's answer. */
        at = (t, night = 0, rain = 0) => {
          entry[0].update(t, night, rain);
          her.updateMatrixWorld(true);
          return plan.alisonDay(t);
        },
        shows = (o) => {
          for (let p = o; p && p !== her; p = p.parent) if (!p.visible) return false;
          return true;
        },
        /** Every point of what shows of a group of hers (in the world); `own`, of its own meshes only (a leg's thigh, not its knee's shin). */
        visit = (group, fn, own = false) =>
          (own ? group.children : [group]).forEach((top) =>
            top.traverse((o) => {
              if (!o.isMesh || !shows(o) || (own && o !== top)) return;
              const q = o.geometry.attributes.position;
              for (let i = 0; i < q.count; i++) fn(v.fromBufferAttribute(q, i).applyMatrix4(o.matrixWorld), o);
            }),
          ),
        snapshot = (root) => {
          const out = [];
          root.traverse((o) => out.push(...o.matrixWorld.elements, o.visible ? 1 : 0));
          return out;
        },
        same = (a, b, eps = 1e-9) => a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) < eps),
        hand = (k) => alisonHand(joints, k).applyMatrix4(her.matrixWorld),
        grip = (prop, p) => new T.Vector3(...p).applyMatrix4(prop.matrixWorld),
        // The lowest of her soles over the ground drawn under it (the lawn, or the paths' gravel where
        // it is, SKY_PATHS.lift over the lawn: the final review's missed finding, she stood on the lawn
        // and her soles were 0.018 to 0.030 under the gravel she seemed to stand on); her lowest sole
        // point's height over the lawn; and whether she is stepping up onto the gravel (her root on
        // the lawn within SKY_PATHS.ease of it).
        soleGap = () => {
          let gap = Infinity,
            low = Infinity,
            up = 0;
          for (const k of joints.knees)
            visit(k, (p) => {
              const lawnUp = p.y - plan.skyTop(p.x, p.z);
              gap = Math.min(gap, lawnUp - (onGravel(p.x, p.z) ? plan.SKY_PATHS.lift : 0));
              if (p.y < low) {
                low = p.y;
                up = lawnUp;
              }
            });
          const depth = plan.skyGravel(her.position.x, her.position.z);
          return { gap, up, edge: depth < 0 && depth > -plan.SKY_PATHS.ease };
        },
        seated = (s) => s.pose === 'sit' || s.pose === 'sip' || s.pose === 'set',
        beside = { x: D.beside[0], z: D.beside[1] },
        pop = Math.hypot(D.chair.x - beside.x, D.chair.z - beside.z),
        fmt3 = (n) => n.toFixed(3);
      assert.equal(entry.length, 1, 'Alison has not one entry in the animated list.');

      // The frozen frame, and nothing but time moves her.
      const asBuilt = phased.sky.root.children.find((o) => o.name === 'alison');
      at(0);
      const zero = snapshot(her);
      assert(asBuilt && same(zero, snapshot(asBuilt), 1e-6), 'Alison is not built in her pose at time 0 (the frozen frame Pause and reduced motion hold).');
      // (At moments of each kind of her day: in her chair, watering, at the telescope and walking.)
      for (const t of [0, 40.31, 93.07, 111.13]) {
        at(t);
        const day = snapshot(her);
        at(t, 1, 1);
        assert(same(day, snapshot(her)), `Night or rain moves Alison at ${t} s.`);
      }
      at(0);
      const day0 = plan.alisonDay(0);
      assert(day0.station === 'tea' && day0.pose === 'sip' && day0.phase === 0 && held.cup.visible && held.saucer.visible, 'At time 0 Alison is not at tea with her cup resting on its saucer.');

      // Her day: whole, round, and her stations all in it.
      assert(D.period >= 90 && D.period <= 150 && D.acts[0].t0 === 0 && D.acts.at(-1).t1 === D.period && D.acts.every((a, i) => a.t1 > a.t0 && (!i || a.t0 === D.acts[i - 1].t1)), `Her day (${D.period} s) has a gap, or is not 90 to 150 s long.`);
      assert(['tea', 'water-west', 'water-east', 'telescope'].every((s) => D.acts.some((a) => a.station === s)) && D.acts[0].kind === 'seated' && D.acts.at(-1).kind === 'seated', 'Her day misses a station, or does not start and end at tea.');
      assert(Math.abs(GA.stride - ALISON.stride) < 1e-12, 'Her walk\'s stride is not lane F\'s.');
      // Through it, in steps of a twentieth of a second (alisonDay alone).
      const gtris = [],
        gq = gravel.geometry.attributes.position;
      for (let t = 0; t < gq.count; t += 3) gtris.push([0, 1, 2].map((j) => [gq.getX(t + j), gq.getZ(t + j)]));
      const onGravel = (x, z) =>
        gtris.some(([a, b, c]) => {
          const s1 = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]),
            s2 = (c[0] - b[0]) * (z - b[1]) - (c[1] - b[1]) * (x - b[0]),
            s3 = (a[0] - c[0]) * (z - c[1]) - (a[1] - c[1]) * (x - c[0]);
          return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
        });
      // (Off the acts' round-numbered ends, so a time and the same time a large number of periods on
      // never fall either side of one.)
      const dt = 0.05,
        offset = 0.0031,
        keys = ['x', 'z', 'heading', 'phase', 'amount', 'seat', 'step'],
        values = (s) => [...keys.map((key) => s[key]), ...s.side];
      let prev = plan.alisonDay(offset),
        fastest = 0,
        swiftest = 0,
        pops = 0,
        lawn = 0,
        rim = Infinity;
      for (let n = 1; n <= Math.round(D.period / dt); n++) {
        const t = n * dt + offset,
          s = plan.alisonDay(t);
        assert(ALISON_POSES.includes(s.pose) && s.side.length === 2 && values(s).every(Number.isFinite), `At ${t.toFixed(2)} s her day gives ${JSON.stringify(s)}.`);
        for (const later of [t + D.period, t + 7 * D.period, t + D.period * Math.floor(1e6 / D.period)]) {
          const s2 = plan.alisonDay(later);
          assert(s2.pose === s.pose && s2.station === s.station && values(s2).every((n, i) => Math.abs(n - values(s)[i]) < 1e-6), `Her day does not come round at ${later.toFixed(2)} s.`);
        }
        rim = Math.min(rim, -plan.skyDistance(s.x, s.z));
        const moved = Math.hypot(s.x - prev.x, s.z - prev.z),
          turned = Math.abs(plan.angleDiff(s.heading, prev.heading));
        if (s.pose === 'rise' || prev.pose === 'rise') {
          // Getting up or sitting down (lane F's 'rise'): her root slides along the step between her
          // chair's seat and her place beside it, facing the table, a little at a time (the 0.03 a
          // sixtieth of a second the continuity check below holds her whole day to).
          if (s.pose === 'rise' && prev.pose !== 'rise') pops++;
          const along = (p) => ((p.x - D.chair.x) * (beside.x - D.chair.x) + (p.z - D.chair.z) * (beside.z - D.chair.z)) / pop ** 2,
            off = (p) => Math.abs((p.x - D.chair.x) * (beside.z - D.chair.z) - (p.z - D.chair.z) * (beside.x - D.chair.x)) / pop;
          assert([s, prev].every((p) => off(p) < 1e-9 && along(p) > -1e-9 && along(p) < 1 + 1e-9) && turned < 1e-9 && Math.abs(plan.angleDiff(s.heading, D.chair.facing)) < 1e-9 && moved <= 0.03 * dt * 60, `At ${t.toFixed(2)} s she gets up or sits down other than beside her chair, or ${fmt3(moved)} at once.`);
        } else {
          fastest = Math.max(fastest, moved / dt);
          swiftest = Math.max(swiftest, turned / dt);
          // Only walk and stand blend: any other change of pose is made standing still.
          if (s.pose !== prev.pose && !(seated(s) && seated(prev)))
            assert(moved < 1e-3 && [s, prev].every((p) => p.pose !== 'walk' || p.amount < 0.02), `At ${t.toFixed(2)} s she goes from '${prev.pose}' to '${s.pose}' on the move.`);
        }
        if (s.pose === 'walk' && prev.pose === 'walk') {
          // Her feet never slide: the walk's phase goes on by the distance she walks.
          assert(Math.abs((s.phase - prev.phase) * ALISON.stride - moved) < 1e-4, `At ${t.toFixed(2)} s her walk's phase runs ${fmt3((s.phase - prev.phase) * ALISON.stride)} for ${fmt3(moved)} walked.`);
          assert(s.amount >= 0 && s.amount <= 1, `At ${t.toFixed(2)} s her walk's gait is ${fmt3(s.amount)}.`);
          if (!onGravel(s.x, s.z)) {
            lawn++;
            assert(Math.hypot(s.x - beside.x, s.z - beside.z) < 0.35, `At ${t.toFixed(2)} s she walks off the gravel at ${fmt3(s.x)}, ${fmt3(s.z)}.`);
          }
        }
        prev = s;
      }
      assert(pops === 2 && fastest <= GA.speed + 1e-6 && swiftest <= 3.5 && rim >= 1, `Through her day she gets up or sits down ${pops} times, goes ${fmt3(fastest)} a second at the most and turns ${fmt3(swiftest)}, and comes ${rim.toFixed(2)} from the rim.`);
      // Each walk eases its gait in and out: none at either end, and full gait but for 0.35 at each end
      // (a walk too short for that, the step to the walk from her chair's side, eases all the way).
      for (const a of D.acts.filter((x) => x.kind === 'walk'))
        assert([plan.alisonDay(a.t0 + 1e-6), plan.alisonDay(a.t1 - 1e-6)].every((e) => e.pose === 'walk' && e.amount < 0.01), 'A walk of hers starts or ends at a stride.');
      for (const a of D.acts.filter((x) => x.kind === 'walk' && x.length >= 0.7)) {
        let first = null,
          last = null;
        for (let t = a.t0; t < a.t1; t += 0.01) {
          const s = plan.alisonDay(t);
          if (s.amount < 0.99) continue;
          first ??= s.phase * ALISON.stride - a.walked;
          last = s.phase * ALISON.stride - a.walked;
        }
        assert(first !== null && first <= 0.35 && a.length - last <= 0.35, `A walk of ${fmt3(a.length)} eases over ${first?.toFixed(2)} and ${(a.length - last).toFixed(2)}.`);
      }

      // In place, every half second of her day (and through a sidestep): her feet, her seat and her
      // hands, the tea set, the telescope, the borders and the villa's front door.
      const scopeFrame = frames('sky-telescope')[0],
        scope = fresh().garden.telescope({ eyepiece: slots.telescope.eyepiece, tilt: SEATS.tilt }),
        eyepiece = new T.Vector3(...scope.userData.eyepiece).applyMatrix4(scopeFrame.matrixWorld),
        tube = new T.Vector3(0, -Math.sin(SEATS.tilt), Math.cos(SEATS.tilt)).transformDirection(scopeFrame.matrixWorld),
        teaFrame = frames('sky-tea')[0].matrixWorld,
        teaInverse = teaFrame.clone().invert(),
        C = TEA.chair,
        [r0, r1] = TEA.rail,
        under = TEA.seat - C.slab,
        [px, pz] = [C.w / 2 - C.leg / 2 - 0.01, C.d / 2 - C.leg / 2 - 0.01],
        // Her chair (the table's -x one, turned to face it), and its parts as boxes (lane G's chair()).
        chair = teaFrame.clone().multiply(new T.Matrix4().makeRotationY(Math.PI / 2).setPosition(-(TEA.radius + TEA.gap + C.d / 2), 0, 0)),
        box = (x, y, z, rx, half) => ({ inverse: chair.clone().multiply(new T.Matrix4().makeRotationX(rx).setPosition(x, y, z)).invert(), half }),
        back = [...[-1, 1].map((sx) => box(sx * px, (under + r1) / 2, -pz - TEA.rake * ((r1 - under) / 2), -TEA.rake, [C.leg / 2, (r1 - under) / 2, C.leg / 2])), box(0, (r0 + r1) / 2, -pz - TEA.rake * ((r0 + r1) / 2 - under), -TEA.rake, [C.w / 2, (r1 - r0) / 2, 0.035])],
        seatBox = box(0, TEA.seat - C.slab / 2, 0, 0, [C.w / 2, C.slab / 2, C.d / 2]),
        // How far outside a box a point is (along the axis it is furthest out on; under 0, inside).
        outside = (b, p) => {
          const q = p.clone().applyMatrix4(b.inverse);
          return Math.max(Math.abs(q.x) - b.half[0], Math.abs(q.y) - b.half[1], Math.abs(q.z) - b.half[2]);
        },
        overTop = (p) => {
          const q = p.clone().applyMatrix4(teaInverse);
          return Math.max(Math.hypot(q.x, q.z) - TEA.radius, q.y - TEA.top, TEA.top - 0.08 - q.y);
        };
      // The borders as the island plants them, as height fields 0.01 a cell (the highest of their
      // kerb, mound and blooms over each cell), and their outlines.
      const { nature } = fresh(),
        cell = 0.01,
        beds = slots.borders.map((b, k) => {
          const g = new T.Group();
          skyBorder(nature, g, b, k);
          g.updateMatrixWorld(true);
          const bounds = new T.Box3().setFromObject(g),
            x0 = bounds.min.x,
            z0 = bounds.min.z,
            nx = Math.ceil((bounds.max.x - x0) / cell) + 1,
            nz = Math.ceil((bounds.max.z - z0) / cell) + 1,
            top = new Float32Array(nx * nz).fill(-Infinity),
            A = new T.Vector3(),
            B = new T.Vector3(),
            Cc = new T.Vector3();
          g.traverse((m) => {
            if (!m.isMesh) return;
            const q = m.geometry.attributes.position,
              index = m.geometry.index,
              n = index ? index.count : q.count,
              corner = (i, out) => out.fromBufferAttribute(q, index ? index.getX(i) : i).applyMatrix4(m.matrixWorld);
            for (let i = 0; i < n; i += 3) {
              corner(i, A);
              corner(i + 1, B);
              corner(i + 2, Cc);
              const det = (B.z - Cc.z) * (A.x - Cc.x) + (Cc.x - B.x) * (A.z - Cc.z);
              for (let ix = Math.max(0, Math.floor((Math.min(A.x, B.x, Cc.x) - x0) / cell)); ix <= Math.min(nx - 1, Math.ceil((Math.max(A.x, B.x, Cc.x) - x0) / cell)); ix++)
                for (let iz = Math.max(0, Math.floor((Math.min(A.z, B.z, Cc.z) - z0) / cell)); iz <= Math.min(nz - 1, Math.ceil((Math.max(A.z, B.z, Cc.z) - z0) / cell)); iz++) {
                  const x = x0 + ix * cell,
                    z = z0 + iz * cell;
                  // The triangle's height over the cell (any cell it covers, or a vertex in it).
                  let y = -Infinity;
                  if (Math.abs(det) > 1e-12) {
                    const l1 = ((B.z - Cc.z) * (x - Cc.x) + (Cc.x - B.x) * (z - Cc.z)) / det,
                      l2 = ((Cc.z - A.z) * (x - Cc.x) + (A.x - Cc.x) * (z - Cc.z)) / det,
                      l3 = 1 - l1 - l2;
                    if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) y = l1 * A.y + l2 * B.y + l3 * Cc.y;
                  }
                  for (const P of [A, B, Cc]) if (Math.abs(P.x - x) <= cell / 2 && Math.abs(P.z - z) <= cell / 2) y = Math.max(y, P.y);
                  if (y > top[ix * nz + iz]) top[ix * nz + iz] = y;
                }
            }
          });
          return {
            b,
            k,
            group: g,
            // The highest over a point's cell and its neighbours.
            height(x, z) {
              const ix = Math.round((x - x0) / cell),
                iz = Math.round((z - z0) / cell);
              let y = -Infinity;
              for (let i = ix - 1; i <= ix + 1; i++) for (let j = iz - 1; j <= iz + 1; j++) if (i >= 0 && j >= 0 && i < nx && j < nz) y = Math.max(y, top[i * nz + j]);
              return y;
            },
          };
        });
      // The front door (the villa's entrance light, the ground floor's French doors, 1.2 wide from the
      // terrace up to 1.94) on the file's screen, at its own pitch.
      const door = model.windows.find((p) => p.place === 'sky-island' && p.role === 'entrance'),
        { flat: fileFlat } = axes(file, SKY_PITCH),
        doorBox = [-0.6, 0.6]
          .flatMap((dx) => [0.5, 1.94].map((dy) => fileFlat(new T.Vector3(site.x + dx, site.y + dy, door.at.z))))
          .reduce(([u0, w0, u1, w1], [u, w]) => [Math.min(u0, u), Math.min(w0, w), Math.max(u1, u), Math.max(w1, w)], [Infinity, Infinity, -Infinity, -Infinity]);
      let soleWorst = 0,
        soleSunk = Infinity,
        soleEdge = -Infinity,
        edgeSeen = 0,
        chairGap = Infinity,
        seatSink = 0,
        tableGap = Infinity,
        canGap = Infinity,
        overDoor = 0,
        eyeWorst = 0,
        handWorst = 0,
        tubeWorst = 0,
        cupWorst = 0,
        placeWorst = 0;
      const seen = new Set(),
        canHome = new T.Vector3(D.can.x, D.can.y, D.can.z),
        // Her can's handle in her -x hand.
        canInHand = () => hand(0).distanceTo(grip(held.can, ALISON_HOLDS.can)) < 2e-3,
        // Her lower sole: on the ground drawn under it; stepping up onto the gravel, her lowest sole
        // between the lawn and the gravel's top.
        sole = (r) => {
          if (r.edge) {
            soleSunk = Math.min(soleSunk, r.up);
            soleEdge = Math.max(soleEdge, r.up);
            edgeSeen++;
          } else soleWorst = Math.max(soleWorst, Math.abs(r.gap));
        };
      for (let t = 0; t < D.period; t += 0.5) {
        const s = at(t);
        seen.add(s.pose);
        // Her can: in her hand where she has it; elsewhere exactly at its place, level.
        if (s.pose === 'water' || (s.pose === 'take' ? s.phase >= 0.42 : s.carry)) handWorst = Math.max(handWorst, hand(0).distanceTo(grip(held.can, ALISON_HOLDS.can)));
        else {
          const turn = new T.Euler().setFromQuaternion(held.can.getWorldQuaternion(new T.Quaternion()), 'YXZ');
          placeWorst = Math.max(placeWorst, grip(held.can, CAN_FOOT).distanceTo(canHome), Math.abs(plan.angleDiff(turn.y, D.can.ry)), Math.abs(turn.x), Math.abs(turn.z));
        }
        visit(her, (p) => {
          const [u, w] = fileFlat(p);
          if (u > doorBox[0] && u < doorBox[2] && w > doorBox[1] && w < doorBox[3]) overDoor++;
        });
        if (seated(s)) {
          let thighs = Infinity;
          for (const l of joints.legs) visit(l, (p) => (thighs = Math.min(thighs, p.y)), true);
          assert(Math.abs(thighs - (slots.tea.y + TEA.seat)) < 2e-3, `At ${t} s her thighs are at ${fmt3(thighs)}, her chair's seat at ${fmt3(slots.tea.y + TEA.seat)}.`);
          visit(her, (p) => {
            for (const b of back) chairGap = Math.min(chairGap, outside(b, p));
            seatSink = Math.min(seatSink, outside(seatBox, p));
            tableGap = Math.min(tableGap, overTop(p));
          });
          if (s.pose === 'sip') {
            handWorst = Math.max(handWorst, hand(0).distanceTo(grip(held.cup, ALISON_HOLDS.cup)), hand(1).distanceTo(grip(held.saucer, ALISON_HOLDS.saucer)));
            // Between sips the cup rests in the saucer's well (the cup's foot on its axis, 0.058 from its handle).
            if (s.phase === 0) cupWorst = Math.max(cupWorst, grip(held.cup, [0.058, -0.037, 0]).distanceTo(grip(held.saucer, [0, 0.036, 0])));
          }
        } else if (s.pose !== 'rise') sole(soleGap());
        if (s.pose === 'telescope' && s.stoop === 1) {
          const eye = new T.Vector3(0, 0.772, 0.137).applyMatrix4(joints.body.matrixWorld),
            toPiece = eyepiece.clone().sub(eye);
          eyeWorst = Math.max(eyeWorst, toPiece.length() < 0.05 || toPiece.length() > 0.08 ? Infinity : 1 - toPiece.normalize().dot(tube));
          for (const k of s.carry ? [1] : [0, 1]) {
            const off = hand(k).sub(eyepiece),
              along = off.dot(tube);
            tubeWorst = Math.max(tubeWorst, Math.abs(off.clone().addScaledVector(tube, -along).length() - (ALISON_TELESCOPE.radius + 0.043)), along < -0.02 || along > 0.2 ? Infinity : 0);
          }
        }
        if (s.pose === 'water') {
          const bed = beds[s.station === 'water-east' ? 0 : 1];
          let rose = null;
          visit(held.can, (p) => {
            const d = Math.hypot(p.x - her.position.x, p.z - her.position.z);
            if (!rose || d > rose.d) rose = { d, x: p.x, z: p.z };
            canGap = Math.min(canGap, p.y - bed.height(p.x, p.z));
          });
          // (Over the kerb's own outline, drawn in at the border's outer end: the east one's east.)
          const [x0, x1] = bed.k ? [bed.b.x - bed.b.w / 2 + SKY_BEDS.trim, bed.b.x + bed.b.w / 2] : [bed.b.x - bed.b.w / 2, bed.b.x + bed.b.w / 2 - SKY_BEDS.trim];
          if (held.water.visible) assert(rose.x > x0 + 0.05 && rose.x < x1 - 0.05 && rose.z > bed.b.z - bed.b.d / 2 + 0.05 && rose.z < bed.b.z + bed.b.d / 2 - 0.05, `At ${t} s her can's rose is off the ${s.station} border, at ${fmt3(rose.x)}, ${fmt3(rose.z)}.`);
        }
      }
      // Through a sidestep (the east border's third): the planted foot (the left over the first half,
      // the right over the second) stays put, her lower sole on the lawn, the can over the border.
      {
        const act = D.acts.find((a) => a.kind === 'water' && a.station === 'water-east'),
          // (Each stretch starts with the can coming up and tipping: SKY_WATERING's lift and tilt.)
          t0 = act.t0 + W.lift + W.tilt + W.first + 2 * (W.stepTime + W.pause),
          shoe = (k) => new T.Vector3(0, -0.135, 0.025).applyMatrix4(joints.knees[k].matrixWorld),
          planted = [];
        let slide = 0;
        for (let i = 0; i <= 20; i++) {
          const s = at(t0 + (i / 20) * W.stepTime),
            k = i <= 10 ? 1 : 0;
          assert(s.pose === 'water' && (i === 0 || i === 20 || s.step > 0), 'The third sidestep of the east border is not where the check looks for it.');
          if (i === 0 || i === 10) planted[k] = shoe(k);
          slide = Math.max(slide, Math.hypot(shoe(k).x - planted[k].x, shoe(k).z - planted[k].z));
          if (i === 10) planted[0] = shoe(0);
          sole(soleGap());
          visit(held.can, (p) => (canGap = Math.min(canGap, p.y - beds[0].height(p.x, p.z))));
        }
        assert(slide < 0.005, `In a sidestep her planted foot slides ${fmt3(slide)}.`);
      }
      // Her can's place: standing on the west border's kerb, its foot on the kerb's top, nothing of it
      // in the border's mound or under its kerb (the border's own height, kerb, mound and blooms).
      {
        at(0);
        const bed = beds[1],
          kerb = bed.b.floor + 0.22,
          foot = grip(held.can, CAN_FOOT);
        let sunk = Infinity;
        visit(held.can, (p) => (sunk = Math.min(sunk, p.y - bed.height(p.x, p.z))));
        assert(!canInHand() && Math.abs(foot.y - kerb) < 1e-6 && bed.height(foot.x, foot.z) <= kerb + 1e-6 && sunk > -0.005 && Math.abs(D.can.y - kerb) < 1e-9, `Her can stands with its foot ${fmt3(foot.y - kerb)} off the west border's kerb, or goes ${fmt3(-sunk)} into the border.`);
      }
      at(0);
      assert(placeWorst < 1e-9, `Set down, her can strays ${placeWorst} from its place on the kerb.`);
      assert(['sip', 'sit', 'stand', 'walk', 'water', 'telescope', 'take'].every((p) => seen.has(p)), `Her day shows only ${[...seen].join(', ')}.`);
      assert(overDoor === 0, `From the island's file ${overDoor} points of her show over the villa's front door.`);
      assert(soleWorst < 8e-3 && soleSunk > -8e-3 && soleEdge < plan.SKY_PATHS.lift + 8e-3 && edgeSeen > 0, `Standing, her lower sole is ${fmt3(soleWorst)} off the ground drawn under it (the lawn, or the gravel where she is on it), or stepping up onto the gravel her lowest sole is ${fmt3(-soleSunk)} under the lawn or ${fmt3(soleEdge)} over it (${edgeSeen} moments).`);
      assert(handWorst < 2e-3 && cupWorst < 5e-3, `Her hands are ${fmt3(handWorst)} off the cup, the saucer or the can, or her cup ${fmt3(cupWorst)} off its saucer.`);
      assert(eyeWorst < 1e-3 && tubeWorst < 0.01, `At the telescope her eye is off its eyepiece (${eyeWorst}), or her hands ${fmt3(tubeWorst)} off its tube.`);
      assert(chairGap > 0.005 && seatSink > -3e-3 && tableGap > 0, `Seated, she is ${fmt3(chairGap)} from her chair's back, ${fmt3(-seatSink)} into its seat, ${fmt3(tableGap)} from the table's top.`);
      assert(canGap >= 0.013, `Watering, her can clears the border by only ${fmt3(canGap)}.`);
      skyReport += `; Alison's day ${D.period} s (tea, the two borders, the telescope; ${(lawn * dt).toFixed(1)} s of it walking on the lawn by her chair), her soles within ${fmt3(soleWorst)} of the ground drawn under them (the gravel where she is on it; stepping up onto it at ${edgeSeen} moments, between the lawn and its top), her hair ${fmt3(chairGap)} clear of her chair's back, her can ${fmt3(canGap)} over the borders`;

      // What can hide her water: her can and the borders' beds; and how many of its tube's points
      // could be seen as it is posed now (rays from eight bearings at the file's pitch, the town's
      // and a high one, at each of its corners: those that meet nothing of the can or the beds first).
      const hiders = [],
        looks = [],
        ray = new T.Raycaster();
      for (const g of [held.can, ...beds.map((b) => b.group)]) g.traverse((o) => o.isMesh && hiders.push(o));
      for (const pitch of [SKY_PITCH, Math.atan2(35, 38), 1.2]) for (let k = 0; k < 8; k++) looks.push(new T.Vector3(-Math.sin((k * Math.PI) / 4) * Math.cos(pitch), -Math.sin(pitch), -Math.cos((k * Math.PI) / 4) * Math.cos(pitch)));
      const waterSeen = () => {
        her.updateMatrixWorld(true);
        const { middles, corners } = alisonStream(held.water);
        let count = 0;
        for (const { p, k } of corners()) {
          // (A hair in from the surface, toward its ring's middle.)
          const q = p.clone().lerp(middles[k], 0.03);
          if (looks.some((d) => (ray.set(q.clone().addScaledVector(d, -4), d), (ray.far = 4 - 1e-4), !ray.intersectObjects(hiders, false).length))) count++;
        }
        return count;
      };
      // Her day frame by frame (the art review's seventh finding: getting up and sitting down were
      // one-frame jumps of 0.5 sideways, her cup and saucer vanishing from her hands; lane C2b: the
      // can and its water came and went and her stoop at the telescope set, in a frame, six times a
      // day): in place, as the town poses her, a sixtieth of a second at a time over the whole day and
      // on past its wrap,
      // - her root never moves more than 0.015 in a frame;
      // - her body, her legs, her arms and her props (each part's own points, where they show, the
      //   water's tube among them) never jump more than 0.025 in a frame, anywhere in her day;
      // - nothing of hers comes or goes where it could be seen: her can, her cup and her saucer always
      //   show, and the water's flag changes only while nothing of it can be seen from any side (at the
      //   frame it shows, rays from eight bearings at the file's pitch, the town's and a high one at
      //   each of its tube's corners meet the can or the border's bed first: it is inside the can's
      //   rose, or down in the bed);
      // - getting up (SKY_TEA.rise to the end of its 'rise') and sitting down she comes out of her
      //   chair and goes back into it in no less than 0.8 s, and her cup and saucer stand on the
      //   table's top, at her place (SKY_DAY.saucer), from the moment she has set them down until she
      //   takes them up again, all the time she is away; before and after, in her hands;
      // - her can as she takes it up from the west border's kerb and sets it down again (the final
      //   review's fourth finding: turning to her side low over the bed, its spout and rose swept
      //   through the border's mound, and her front lock hung through its handle for 0.65 s), in every
      //   frame of both: nothing of it is in the border (its kerb, its leaves and its blooms: over
      //   their height, standing on the kerb's top at the ends), and no edge of it passes through her
      //   (her top and her hair, which batch as one, her head and her legs), nor any of hers through
      //   it; and so while she carries it, every tenth of a second.
      {
        const frame = 1 / 60,
          parts = { body: [joints.body], legs: [...joints.legs, ...joints.knees], arms: [...joints.arms, ...joints.elbows], props: Object.values(held) },
          sample = () => {
            const out = { root: her.position.clone(), vis: Object.values(held).map((p) => p.visible) };
            for (const [k, list] of Object.entries(parts)) {
              out[k] = [];
              for (const g of list)
                for (const m of g.children)
                  if (m.isMesh) {
                    const q = m.geometry.attributes.position;
                    for (let i = 0; i < q.count; i += 7) out[k].push(shows(m) ? new T.Vector3().fromBufferAttribute(q, i).applyMatrix4(m.matrixWorld) : null);
                  }
            }
            return out;
          },
          worst = { root: 0, body: 0, legs: 0, arms: 0, props: 0 },
          rise = D.acts.filter((a) => a.kind === 'rise'),
          saucerAt = new T.Vector3(D.saucer.x, D.saucer.y, D.saucer.z);
        assert(rise.length === 2 && rise.every((a) => a.t1 - a.t0 >= 0.8) && rise[0].t0 === plan.SKY_TEA.rise, 'She does not get up and sit down, each over 0.8 s or more.');
        let prev = (at(0), sample()),
          prevDay = plan.alisonDay(0),
          flips = 0,
          awayWorst = 0,
          takeGap = Infinity,
          liftedGap = Infinity,
          takeFrames = 0,
          crossed = 0,
          crossedAt = '',
          crossTried = 0;
        const herself = [joints.body, ...joints.legs];
        for (let n = 1; n <= Math.round(D.period / frame) + 60; n++) {
          const t = n * frame,
            day = at(t),
            now = sample();
          worst.root = Math.max(worst.root, now.root.distanceTo(prev.root));
          assert(now.root.distanceTo(prev.root) <= 0.015, `At ${t.toFixed(3)} s her root jumps ${fmt3(now.root.distanceTo(prev.root))}.`);
          for (const k of Object.keys(parts)) {
            let most = 0;
            now[k].forEach((p, i) => p && prev[k][i] && (most = Math.max(most, p.distanceTo(prev[k][i]))));
            worst[k] = Math.max(worst[k], most);
            assert(most <= 0.025, `At ${t.toFixed(3)} s (${prevDay.pose} to ${day.pose}) her ${k} jump ${fmt3(most)}.`);
          }
          const changed = Object.keys(held).filter((name, i) => now.vis[i] !== prev.vis[i]);
          assert(changed.every((name) => name === 'water'), `At ${t.toFixed(3)} s (${prevDay.pose} to ${day.pose}) her ${changed.join(' and ')} comes or goes.`);
          if (changed.length) {
            // The water, where it is in the frame it shows.
            flips++;
            if (!held.water.visible) at(t - frame);
            const seen = waterSeen();
            if (!held.water.visible) at(t);
            assert(seen === 0, `At ${t.toFixed(3)} s her water ${held.water.visible ? 'comes' : 'goes'} with ${seen} points of it in sight.`);
          }
          // Away from her chair, her cup and saucer stand at her place on the table.
          const inHands = day.pose === 'sip' || day.pose === 'set';
          if (!inHands) {
            assert(held.saucer.visible && held.cup.visible, `At ${t.toFixed(3)} s her cup and saucer are gone.`);
            awayWorst = Math.max(awayWorst, grip(held.saucer, [0, 0, 0]).distanceTo(saucerAt));
          }
          assert(held.can.visible, `At ${t.toFixed(3)} s her can is gone.`);
          // Her can at the kerb, and against her, as she takes it up or sets it down (every frame) and
          // carries it (every sixth).
          if (day.pose === 'take' && n <= Math.round(D.period / frame)) {
            takeFrames++;
            let low = Infinity,
              foot = Infinity;
            visit(held.can, (p) => {
              low = Math.min(low, p.y - beds[1].height(p.x, p.z));
              foot = Math.min(foot, p.y);
            });
            takeGap = Math.min(takeGap, low);
            if (foot > D.can.y + 0.002) liftedGap = Math.min(liftedGap, low);
          }
          if ((day.pose === 'take' || (day.carry && n % 6 === 0)) && n <= Math.round(D.period / frame)) {
            crossTried++;
            const can = worldTriangles(held.can),
              x = herself.reduce((sum, g) => sum + crossingEdges(can, worldTriangles(g)), 0);
            if (x > crossed) {
              crossed = x;
              crossedAt = `${t.toFixed(3)} s (${day.pose})`;
            }
          }
          prev = now;
          prevDay = day;
        }
        assert(takeFrames >= 2 * Math.floor(plan.SKY_CAN.take * 60) && takeGap > -0.005, `Taking her can up or setting it down (${takeFrames} frames), it goes ${fmt3(-takeGap)} into the west border.`);
        assert(crossed === 0 && crossTried > 500, `Her can crosses her (her top and hair, her head or her legs) on ${crossed} edges at ${crossedAt} (of ${crossTried} frames tried).`);
        at(0);
        assert(flips === 4 && awayWorst < 1e-6, `Her water comes or goes ${flips} times in a day, not at each border's start and end, or her cup and saucer stray ${awayWorst} from her place on the table.`);
        const fromTable = TEA.top + slots.tea.y - D.saucer.y;
        assert(Math.abs(fromTable) < 1e-9, `Her saucer stands ${fromTable} off the tea table's top.`);
        skyReport += `, frame by frame her root ${fmt3(worst.root)} and her joints and props ${fmt3(Math.max(worst.body, worst.legs, worst.arms, worst.props))} at most a sixtieth of a second (no switch of pose nor prop anywhere in it; her water out of sight each time it comes and goes), her cup and saucer left on the table while she is away, her can over the west border in every frame she takes it up or sets it down (${fmt3(liftedGap)} over it at the least once off the kerb) and through none of her (${crossTried} frames)`;
      }

      // Pause and reduced motion (the 3D review's third finding: Pause pressed in her day, or reduced
      // motion switched on, froze her mid-stride or mid-sidestep wherever town time stopped). Her
      // entry given the frames the town's loop gives it (town-shared's animationFrame, which the loop
      // is held to at the end of this block), held (a sixtieth of a second of the frame's own time at
      // a time, town time standing still), at a moment every 0.61 s of her day:
      // - she comes to rest within a second (within a quarter under reduced motion, which is tried at
      //   every other moment) and then does not move at all for 120 frames (30 under reduced motion);
      // - settling, and let go again (town time going on from where it stood), she moves no more in
      //   a frame than her day itself does: her root 0.015 and her joints and props 0.025 (under
      //   reduced motion, a near cut: her root goes no further than half her chair's step, 0.25, in
      //   all; never across the lawn);
      // - what she rests in is a still pose, each measured against her day's own resting moments (her
      //   stance, her hips' height over the lawn, her hands and her saucer in her own frame): no water
      //   shows, and whatever she holds is still and at rest (her cup in its saucer's well; her can
      //   level, in her hand or on its kerb), and she is seated in her chair (her thighs on its seat,
      //   her saucer in her hands where it rests in her lap at tea, or on the table at her place with
      //   her hands where they rest while it is there), or standing at ease (both soles flat on the
      //   lawn side by side as she stands in her day, her hips at their standing height, upright,
      //   her free hand hanging where it hangs then and the other there too or carrying her can at
      //   her side), or watering held (so, but her can held out level over the bed and her free hand
      //   where it is as she waters), or stooped to the telescope (so, her eye at its eyepiece, her
      //   hand on its tube). Neither a stride nor a sidestep, a crouch nor a reach rests in any;
      // - her shadow (the final review's missed finding: held, the loop draws the shadows only every
      //   30th frame, so through her settle her shadow kept her old pose and then snapped): held,
      //   every frame in which anything of hers moves raises the frame's `moved`, which the loop
      //   turns into a shadow pass that frame, and none does once she and her water have been still
      //   for a second; let go (the town playing, its shadows every other frame), none does;
      // - held from time 0 (reduced motion at load, which pauses the town), she is the frozen frame,
      //   and never moves;
      // - under reduced motion with Play (lane F2: she follows the people, not the parked plane) she
      //   goes about her day as town time runs, exactly as her day has her;
      // - the frame (the final review's first finding: with the frame dropped from the loop's call,
      //   or `held` set wrong, every check passed and Pause froze her mid-stride again): the loop's
      //   frame is held on Pause only and cut under reduced motion, a new one each frame; and
      //   city-scene's step(), found through its syntax tree (a formatter may wrap the call), builds
      //   it as animationFrame(paused, reduced, dt) and passes it as the fourth argument of the one
      //   update call in its loop over the animated parts, and right after that loop draws the
      //   shadows again if the frame's `moved` is up.
      {
        const { animationFrame } = await load('town-shared'),
          frame = 1 / 60,
          parts = [];
        her.traverse((o) => o.isMesh && parts.push(o));
        const sample = () => {
            her.updateMatrixWorld(true);
            const pts = [];
            for (const m of parts) {
              const q = m.geometry.attributes.position;
              for (let i = 0; i < q.count; i += 7) pts.push(shows(m) ? new T.Vector3().fromBufferAttribute(q, i).applyMatrix4(m.matrixWorld) : null);
            }
            return { root: her.position.clone(), pts };
          },
          // How far she moved between two samples, and whether anything of hers but her water (whose
          // flag may change where nothing of it can be seen) came or went.
          waterAt = (() => {
            let n = 0,
              at = -1;
            for (const m of parts) {
              if (m.parent === held.water) at = n;
              n += Math.ceil(m.geometry.attributes.position.count / 7);
            }
            return [at, at + Math.ceil(held.water.children.find((m) => m.isMesh).geometry.attributes.position.count / 7)];
          })(),
          moved = (a, b) => {
            let most = 0;
            a.pts.forEach((p, i) => p && b.pts[i] && (most = Math.max(most, p.distanceTo(b.pts[i]))));
            return { root: a.root.distanceTo(b.root), parts: most, shown: a.pts.every((p, i) => (i >= waterAt[0] && i < waterAt[1]) || !p === !b.pts[i]) };
          },
          // Where her water is while it shows: 'rose' while all its rings are still within 0.004 of the
          // top one's place inside the can's rose (rays from every side see nothing of it there: the
          // can's rose hides it), 'bed' once every corner of it is down under the border's top,
          // between, null. Its flag may change only with it in the rose or in the bed.
          waterTuck = () => {
            if (!held.water.visible) return 'hidden';
            her.updateMatrixWorld(true);
            const { places, corners } = alisonStream(held.water);
            if (places.every((d) => d < 0.004)) return 'rose';
            return corners().every(({ p }) => beds.some((bed) => p.y < bed.height(p.x, p.z))) ? 'bed' : null;
          },
          // Each sole's gap over the floor she stands on (the ground drawn under her root: plan.skyFloor).
          soles = () =>
            joints.knees.map((k) => {
              let gap = Infinity;
              visit(k, (p) => (gap = Math.min(gap, p.y - floor())));
              return gap;
            }),
          level = (prop) => new T.Vector3(0, 1, 0).applyQuaternion(prop.getWorldQuaternion(new T.Quaternion())).y > 1 - 1e-9,
          upright = () => new T.Vector3(0, 1, 0).applyQuaternion(joints.body.getWorldQuaternion(new T.Quaternion())).y > 1 - 1e-9,
          floor = () => plan.skyFloor(her.position.x, her.position.z),
          // Her stance (how far her one sole is ahead of the other along her heading, and beside it), her
          // hips' height over the lawn, and her hands and her saucer in her own frame.
          stance = () => {
            her.updateMatrixWorld(true);
            const [a, b] = joints.knees.map((k) => {
                let lo = Infinity,
                  n = 0;
                visit(k, (p) => (lo = Math.min(lo, p.y)));
                const c = new T.Vector3();
                visit(k, (p) => p.y < lo + 0.012 && (c.add(p), n++));
                return c.divideScalar(n);
              }),
              d = a.sub(b),
              ry = her.rotation.y;
            return {
              ahead: d.x * Math.sin(ry) + d.z * Math.cos(ry),
              beside: d.x * Math.cos(ry) - d.z * Math.sin(ry),
              hips: joints.body.getWorldPosition(new T.Vector3()).y - floor(),
              hands: [0, 1].map((k) => her.worldToLocal(hand(k))),
              saucer: her.worldToLocal(grip(held.saucer, [0, 0, 0])),
            };
          },
          // The same in her day itself: at tea (time 0, her saucer in her lap), back in her chair (her
          // saucer on the table), standing (her first stand without her can) and watering (her can
          // first fully tipped).
          rest = (() => {
            const first = (ok, from = 0) => {
                let t = from;
                while (!ok(plan.alisonDay(t))) t += 0.05;
                at(t);
                return stance();
              },
              tea = (at(0), stance());
            return { tea, away: first((d) => d.pose === 'sit', D.period / 2), ease: first((d) => d.pose === 'stand' && !d.carry), watering: first((d) => d.pose === 'water' && d.pour === 1) };
          })(),
          // What she rests in, if it is one of her still poses (or why not).
          still = () => {
            if (held.water.visible) return 'water shows';
            if (grip(held.cup, [0.058, -0.037, 0]).distanceTo(grip(held.saucer, [0, 0.036, 0])) > 5e-3) return 'her cup is off its saucer';
            const canHeld = canInHand(),
              canStill = canHeld ? level(held.can) : grip(held.can, CAN_FOOT).distanceTo(new T.Vector3(D.can.x, D.can.y, D.can.z)) < 1e-9 && level(held.can);
            if (!canStill) return 'her can is neither level in her hand nor on its kerb';
            let thighs = Infinity;
            for (const l of joints.legs) visit(l, (p) => (thighs = Math.min(thighs, p.y)), true);
            const s = stance(),
              near = (k, to, d) => s.hands[k].distanceTo(to.hands[k]) < d;
            if (Math.abs(thighs - (slots.tea.y + TEA.seat)) < 2e-3) {
              const onTable = grip(held.saucer, [0, 0, 0]).distanceTo(new T.Vector3(D.saucer.x, D.saucer.y, D.saucer.z)) < 1e-9,
                inHand = hand(1).distanceTo(grip(held.saucer, ALISON_HOLDS.saucer)) < 2e-3 && hand(0).distanceTo(grip(held.cup, ALISON_HOLDS.cup)) < 2e-3 && level(held.saucer);
              if (onTable) return near(0, rest.away, 0.01) && near(1, rest.away, 0.01) ? 'seated' : 'seated, reaching for her saucer on the table';
              if (inHand) return s.saucer.distanceTo(rest.tea.saucer) < 0.01 ? 'seated' : `seated, her saucer ${fmt3(s.saucer.distanceTo(rest.tea.saucer))} out of her lap`;
              return 'seated, her saucer neither in her hand nor on the table';
            }
            const [a, b] = soles();
            if (Math.max(Math.abs(a), Math.abs(b)) > 8e-3) return `a sole ${fmt3(Math.max(a, b))} off her floor`;
            if (Math.abs(s.ahead - rest.ease.ahead) > 0.015 || Math.abs(s.beside - rest.ease.beside) > 0.01) return `in a stride, a sole ${fmt3(s.ahead - rest.ease.ahead)} ahead and ${fmt3(s.beside - rest.ease.beside)} out`;
            if (Math.abs(s.hips - rest.ease.hips) > 0.015) return `crouched, her hips ${fmt3(s.hips - rest.ease.hips)} off their standing height`;
            if (upright() && near(1, rest.ease, 0.01) && (canHeld ? hand(0).distanceTo(grip(held.can, ALISON_HOLDS.can)) < 2e-3 && near(0, rest.ease, 0.03) : near(0, rest.ease, 0.01))) return 'standing';
            if (canHeld && level(held.can) && near(1, rest.watering, 0.01)) {
              let rose = null;
              visit(held.can, (p) => {
                const d = Math.hypot(p.x - her.position.x, p.z - her.position.z);
                if (!rose || d > rose.d) rose = { d, x: p.x, z: p.z };
              });
              if (beds.some(({ b: bed }) => rose.x > bed.x - bed.w / 2 && rose.x < bed.x + bed.w / 2 && rose.z > bed.z - bed.d / 2 && rose.z < bed.z + bed.d / 2)) return 'watering held';
            }
            const eye = new T.Vector3(0, 0.772, 0.137).applyMatrix4(joints.body.matrixWorld),
              toPiece = eyepiece.clone().sub(eye),
              off = hand(1).sub(eyepiece);
            if (toPiece.length() > 0.05 && toPiece.length() < 0.08 && toPiece.normalize().dot(tube) > 1 - 1e-3 && Math.abs(off.clone().addScaledVector(tube, -off.dot(tube)).length() - (ALISON_TELESCOPE.radius + 0.043)) < 0.01) return 'at the telescope';
            return 'neither seated, standing at ease, watering held nor at the telescope';
          },
          hold = (t0, cut, frames = 180, release = 120) => {
            // Her day played up to the moment (Play, as the visitor's motion preference has it), then
            // paused there.
            entry[0].update(t0 - 3, 0, 0, animationFrame(false, cut, frame));
            for (let k = 30; k >= 0; k--) entry[0].update(t0 - k * frame, 0, 0, animationFrame(false, cut, frame));
            let prev = sample(),
              far = 0,
              tuck = waterTuck();
            // (`rested`: the last frame in which anything of hers moved; `unsaid`, frames in which she
            // moved without raising the frame's `moved`, so the paused loop kept her old shadow;
            // `late`, frames in the last 60 held ones that raised it, still drawing shadows a second
            // after she and her water are still.)
            const start = prev.root.clone(),
              out = { settle: { root: 0, parts: 0 }, release: { root: 0, parts: 0 }, rested: 0, pose: '', unsaid: 0, late: 0, said: 0 },
              flip = (t, was) => {
                const is = waterTuck();
                assert((was === 'hidden') === (is === 'hidden') || (was === 'hidden' ? is === 'rose' : was === 'rose' || was === 'bed'), `Held or let go at ${t.toFixed(2)} s, her water ${is === 'hidden' ? 'goes from ' + was : 'comes ' + is}.`);
                return is;
              };
            for (let k = 1; k <= frames; k++) {
              const fr = animationFrame(true, cut, frame);
              entry[0].update(t0, 0, 0, fr);
              const now = sample(),
                m = moved(now, prev);
              tuck = flip(t0, tuck);
              assert(m.shown, `Held at ${t0.toFixed(2)} s, something of hers comes or goes in a frame.`);
              out.settle.root = Math.max(out.settle.root, m.root);
              out.settle.parts = Math.max(out.settle.parts, m.parts);
              far = Math.max(far, now.root.distanceTo(start));
              if (m.root > 1e-12 || m.parts > 1e-12) {
                out.rested = k;
                if (!fr.moved) out.unsaid++;
              }
              if (fr.moved) out.said++;
              if (fr.moved && k > frames - 60) out.late++;
              prev = now;
            }
            out.pose = still();
            // Let go: town time goes on from where it stood.
            for (let k = 1; k <= release; k++) {
              const fr = animationFrame(false, cut, frame);
              entry[0].update(t0 + k * frame, 0, 0, fr);
              // (Playing, the loop draws the shadows every other frame anyway.)
              assert(!fr.moved, `Let go at ${t0.toFixed(2)} s, she asks for her shadow to be drawn again while the town plays.`);
              const now = sample(),
                m = moved(now, prev);
              tuck = flip(t0 + k * frame, tuck);
              assert(m.shown, `Let go at ${t0.toFixed(2)} s, something of hers comes or goes in a frame.`);
              out.release.root = Math.max(out.release.root, m.root);
              out.release.parts = Math.max(out.release.parts, m.parts);
              prev = now;
            }
            return { ...out, far };
          },
          worst = { settle: { root: 0, parts: 0 }, release: { root: 0, parts: 0 }, rested: 0, said: 0 },
          kinds = new Map();
        for (let n = 0, t0 = 0.37; t0 < D.period; t0 += 0.61, n++) {
          const h = hold(t0, false);
          assert(h.rested <= 60, `Held at ${t0.toFixed(2)} s, she is still moving a second later.`);
          // (Her shadow: every frame she moves in, held, says so, and none a second after she is still.)
          assert(h.unsaid === 0 && h.late === 0, `Held at ${t0.toFixed(2)} s, she moves in ${h.unsaid} frames without the loop drawing her shadow again, or asks for it ${h.late} times once still.`);
          worst.said = Math.max(worst.said, h.said);
          assert(['seated', 'standing', 'watering held', 'at the telescope'].includes(h.pose), `Held at ${t0.toFixed(2)} s (${plan.alisonDay(t0).pose}), she rests ${h.pose}.`);
          assert(h.settle.root <= 0.015 && h.settle.parts <= 0.025 && h.release.root <= 0.015 && h.release.parts <= 0.025, `Held at ${t0.toFixed(2)} s, she settles by ${fmt3(h.settle.root)} and ${fmt3(h.settle.parts)} a frame, or comes back by ${fmt3(h.release.root)} and ${fmt3(h.release.parts)}.`);
          for (const k of ['settle', 'release']) for (const j of ['root', 'parts']) worst[k][j] = Math.max(worst[k][j], h[k][j]);
          worst.rested = Math.max(worst.rested, h.rested);
          kinds.set(h.pose, (kinds.get(h.pose) ?? 0) + 1);
          // Under reduced motion (at every other moment): nearly a cut, in place.
          if (n % 2) continue;
          const r = hold(t0, true, 45, 0);
          assert(r.rested <= 15 && r.pose === h.pose && r.far <= 0.25 + 1e-9 && r.unsaid === 0, `Under reduced motion, held at ${t0.toFixed(2)} s, she rests after ${r.rested} frames, ${r.pose}, ${fmt3(r.far)} from where she was, or moves in ${r.unsaid} frames without her shadow drawn again.`);
        }
        assert(['seated', 'standing', 'watering held', 'at the telescope'].every((k) => kinds.has(k)), `Held through her day, she rests only ${[...kinds.keys()].join(', ')}.`);
        // Held from the first frame at time 0 (reduced motion at load: the page starts the town paused):
        // the frozen frame, still.
        entry[0].update(0, 0, 0);
        const frozen = snapshot(her);
        for (let k = 0; k < 120; k++) {
          entry[0].update(0, 0, 0, animationFrame(true, true, frame));
          assert(same(frozen, snapshot(her)), 'Held at time 0, she moves from the frozen frame.');
        }
        // Under reduced motion with Play, she goes about her day with the people: mid-walk, on the
        // watering stretch and at tea, three seconds of town time, her root where her day has it.
        for (const t0 of [53.2, 40.31, 3.1]) {
          entry[0].update(t0, 0, 0);
          let moved = 0,
            off = 0,
            was = her.position.clone();
          for (let k = 1; k <= 180; k++) {
            entry[0].update(t0 + k * frame, 0, 0, animationFrame(false, true, frame));
            her.updateMatrixWorld(true);
            const day = plan.alisonDay(t0 + k * frame);
            off = Math.max(off, Math.hypot(her.position.x - day.x, her.position.z - day.z), Math.abs(plan.angleDiff(her.rotation.y, day.heading)));
            moved += her.position.distanceTo(was);
            was = her.position.clone();
          }
          assert(off < 1e-9 && (t0 > 30 ? moved > 0.1 : true), `Under reduced motion with Play at ${t0} s she strays ${off} from her day, or moves only ${fmt3(moved)} in 3 s.`);
        }
        // The loop's frame: held on Pause only, cut under reduced motion, its own seconds; a new one
        // each frame, nothing yet having moved in it (so the paused loop draws no shadows it need not).
        for (const paused of [false, true])
          for (const reduced of [false, true])
            for (const dt of [0, frame, 0.05]) {
              const a = animationFrame(paused, reduced, dt),
                b = animationFrame(paused, reduced, dt);
              assert(a.held === paused && a.cut === reduced && a.dt === dt && a.moved === false && a !== b, `The loop's frame (paused ${paused}, reduced ${reduced}) is ${JSON.stringify(a)}.`);
            }
        // And city-scene's step() builds it so and passes it to every animated part: its one loop over
        // `animated` calls each entry's update with (time, night, rain, the frame), the frame a const
        // of step's own made by animationFrame(paused, reduced, dt).
        {
          const sceneSource = await fs.readFile(path.join(root, 'app/city-scene.ts'), 'utf8'),
            scene = ts.createSourceFile('city-scene.ts', sceneSource, ts.ScriptTarget.Latest, true),
            text = (n) => n.getText(scene).replace(/\s+/g, '');
          let step = null;
          (function find(n) {
            if (ts.isFunctionDeclaration(n) && n.name?.text === 'step') step = n.body;
            ts.forEachChild(n, find);
          })(scene);
          assert(step, "The frame check must find city-scene's step().");
          const made = new Map(),
            loops = [];
          (function walk(n) {
            if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isCallExpression(n.initializer) && text(n.initializer.expression) === 'animationFrame' && ts.isVariableDeclarationList(n.parent) && n.parent.flags & ts.NodeFlags.Const)
              made.set(n.name.text, n.initializer.arguments.map(text).join(','));
            if (ts.isForOfStatement(n) && text(n.expression) === 'animated') loops.push(n);
            ts.forEachChild(n, walk);
          })(step);
          const calls = [];
          for (const loop of loops) {
            const entryName = ts.isVariableDeclarationList(loop.initializer) ? loop.initializer.declarations[0].name.getText(scene) : '';
            (function walk(n) {
              if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'update' && text(n.expression.expression) === entryName) calls.push(n.arguments.map(text));
              ts.forEachChild(n, walk);
            })(loop.statement);
          }
          assert(loops.length === 1 && calls.length === 1, `step() has ${loops.length} loops over its animated parts and ${calls.length} update calls in them, not one.`);
          const [args] = calls;
          assert(args.length === 4 && args.slice(0, 3).join(',') === 'time,night,rain' && made.get(args[3]) === 'paused,reduced,dt', `step()'s loop calls each animated part's update with (${args.join(', ')}), not (time, night, rain, animationFrame(paused, reduced, dt)).`);
          // Right after it, a frame that moved in real time while held has the shadows drawn again
          // (the final review's missed finding: held, the loop draws them every 30th frame, and her
          // shadow kept her old pose through the settle, then snapped).
          const after = loops[0].parent.statements?.[loops[0].parent.statements.indexOf(loops[0]) + 1];
          assert(after && ts.isIfStatement(after) && text(after.expression) === `${args[3]}.moved` && text(after.thenStatement).replace(/[{}]/g, '') === 'shadowDirty=true;' && !after.elseStatement, `step() does not draw the shadows again right after its animated parts when one of them moved in real time while held (${after ? after.getText(scene) : 'nothing after the loop'}).`);
        }
        at(0);
        skyReport += `; held at ${[...kinds.values()].reduce((n, c) => n + c, 0)} moments of her day (${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')}) she settles within ${(worst.rested / 60).toFixed(2)} s and then never moves, by ${fmt3(worst.settle.root)} and ${fmt3(worst.settle.parts)} a frame at most, and comes back by ${fmt3(worst.release.root)} and ${fmt3(worst.release.parts)}, her shadow drawn again in every frame she moves while held (at most ${worst.said} frames a hold); under reduced motion with Play she goes about her day; the loop gives her animationFrame(paused, reduced, dt)`;
      }

      // The garden lamps never stand in front of her or behind her on screen (the art review's third
      // finding: by the tea table one stood on the file's line of sight 1.07 behind her chair, a ball
      // on her head by day and a halo at night, and those by the stem and the telescope covered her on
      // her walk and at the telescope). From the island's file (its bearing, at its own pitch) and its
      // three other Rotate stops, through her whole day a tenth of a second at a time, no lamp (its
      // pier, cup and globe, as the garden kit builds one, at each of SKY_LAMPS) meets her (her body
      // and what she holds) on screen, but for a brief pass under a second while she walks; and from
      // the file's own camera the line of sight to her seat (her seated at tea, the day's start) meets
      // no lamp at all. Each lamp stands 0.6 or more from either fall's head and pool, off the
      // outcrop's stones, the paths and her stations.
      {
        const CELL = 0.012,
          lamp = fresh().garden.gardenLamp(),
          triangles = (group, keep = () => true) => {
            const out = [],
              q3 = new T.Vector3();
            group.updateMatrixWorld(true);
            group.traverse((m) => {
              if (!m.isMesh || !keep(m)) return;
              for (let p = m; p; p = p.parent) if (!p.visible) return;
              const q = m.geometry.attributes.position,
                index = m.geometry.index,
                n = index ? index.count : q.count;
              for (let i = 0; i < n; i++) {
                q3.fromBufferAttribute(q, index ? index.getX(i) : i).applyMatrix4(m.matrixWorld);
                out.push(q3.x, q3.y, q3.z);
              }
            });
            return out;
          },
          // A silhouette on screen as rows of CELL, each its span along the screen's right.
          spans = (tris, flat) => {
            const rows = new Map(),
              P = [new T.Vector3(), new T.Vector3(), new T.Vector3()];
            for (let i = 0; i < tris.length; i += 9) {
              const s = P.map((p, k) => flat(p.set(tris[i + 3 * k], tris[i + 3 * k + 1], tris[i + 3 * k + 2]))),
                lo = Math.min(s[0][1], s[1][1], s[2][1]),
                hi = Math.max(s[0][1], s[1][1], s[2][1]);
              for (let r = Math.floor(lo / CELL); r <= Math.floor(hi / CELL); r++) {
                const y = Math.min(hi, Math.max(lo, (r + 0.5) * CELL));
                let a = Infinity,
                  b = -Infinity;
                for (let e = 0; e < 3; e++) {
                  const [x1, y1] = s[e],
                    [x2, y2] = s[(e + 1) % 3];
                  if ((y1 - y) * (y2 - y) <= 0) {
                    const x = y1 === y2 ? Math.min(x1, x2) : x1 + ((y - y1) * (x2 - x1)) / (y2 - y1),
                      x3 = y1 === y2 ? Math.max(x1, x2) : x;
                    a = Math.min(a, x, x3);
                    b = Math.max(b, x, x3);
                  }
                }
                if (a > b) continue;
                const row = rows.get(r);
                if (row) {
                  row[0] = Math.min(row[0], a);
                  row[1] = Math.max(row[1], b);
                } else rows.set(r, [a, b]);
              }
            }
            return rows;
          },
          meet = (a, b) => {
            for (const [r, [a0, a1]] of a) {
              const s = b.get(r);
              if (s && s[0] <= a1 && s[1] >= a0) return true;
            }
            return false;
          },
          bearings = [0, 1, 2, 3].map((k) => file + (k * Math.PI) / 2),
          flats = bearings.map((b) => axes(b, SKY_PITCH).flat),
          // Each lamp's silhouette at each stop.
          lampAt = plan.SKY_LAMPS.map(([x, z]) => {
            lamp.position.set(x, plan.skyTop(x, z), z);
            const tris = triangles(lamp);
            return flats.map((flat) => spans(tris, flat));
          }),
          // Her body, her cup and saucer only while they are in her hands, and her can only while she has it.
          hers = (s) => triangles(her, (m) => (!(m.parent === held.cup || m.parent === held.saucer) || s.pose === 'sip' || s.pose === 'set') && (m.parent !== held.can || canInHand())),
          step = 0.1,
          runs = plan.SKY_LAMPS.map(() => bearings.map(() => ({ from: -1, poses: new Set() }))),
          bad = [];
        let passes = 0,
          longest = 0;
        for (let n = 0; n * step < D.period + 1e-9; n++) {
          const t = n * step,
            s = at(t),
            tris = hers(s),
            mine = flats.map((flat) => spans(tris, flat));
          for (const [i, sil] of lampAt.entries())
            for (let k = 0; k < bearings.length; k++) {
              const run = runs[i][k],
                hit = n * step < D.period - 1e-9 && meet(sil[k], mine[k]);
              if (hit) {
                if (run.from < 0) run.from = t;
                run.poses.add(s.pose);
              } else if (run.from >= 0) {
                const long = t - run.from;
                longest = Math.max(longest, long);
                passes++;
                if (long >= 1 - 1e-9 || [...run.poses].some((p) => p !== 'walk')) bad.push(`lamp ${i} at stop ${k} from ${run.from.toFixed(1)} s for ${long.toFixed(1)} s (${[...run.poses].join(', ')})`);
                run.from = -1;
                run.poses.clear();
              }
            }
        }
        assert(!bad.length, `A garden lamp stands in front of her or behind her on screen: ${bad.join('; ')}.`);
        // From the file's own camera, the line of sight to her seat (seated at tea, her cup in her hands).
        const seated = at(0),
          seen = spans(hers(seated), flats[0]);
        assert(seated.pose === 'sip' && lampAt.every((sil) => !meet(sil[0], seen)), 'From the island\'s file a garden lamp stands on the line of sight to her seat.');
        at(0);
        // Their own room: clear of the falls' heads (each from its rim point to 1.1 inland, where a
        // spout's pool or a stream's spring lies), the outcrop's stones, the paths and her stations.
        const O = plan.SKY_OUTCROP;
        for (const [x, z] of plan.SKY_LAMPS) {
          const falls = Math.min(...plan.skyFalls.map((f) => {
              const inland = plan.skyRim(f.bearing, -1.1);
              return plan.distanceToSegment([x, z], [f.x, f.z], [inland.x, inland.z]);
            })),
            outcrop = Math.hypot(x - O.x, z - O.z);
          assert(falls >= 0.6 && outcrop >= 1.45, `The garden lamp at ${x}, ${z} is ${falls.toFixed(2)} from a fall's head or pool, or ${outcrop.toFixed(2)} from the outcrop's middle.`);
        }
        skyReport += `, no garden lamp in front of her or behind her from any of the file's four stops (${passes} passes on her walk, the longest ${longest.toFixed(1)} s)`;
      }
    }
  }
}
// The sky villa (town-sky-villa's buildSkyVilla) on the sky island, in place: its parts as the town
// builds them (the same builder, the town's season, a shell on the villa's site on the deck; the
// town's own is batched by now, a mesh a material, so its parts are built again here, and must
// reach exactly as the town's own does), then the town's own batched villa and its lights:
// - its size: a house about 6.4 by 4.4 and 7 to its roof's flat, a terrace 1.6 to 2 deep and 0.4 to
//   0.6 high, chimneys about 1 over the roof;
// - every part has a surface kind; nothing is two-sided, transparent or cut out; its colours are
//   VILLA_LOOK's, none more saturated than its palette family (VILLA_FAMILY), and the window boxes'
//   planting is the homes' own for the season (WINDOW_BOX, with the winter sprigs); its slate is
//   darker than the town's (the owner's reference) and no louder;
// - it stays inside its footprint box (VILLA.hx, hz, top: at most 6.9 wide, 6.8 deep and, at the
//   chimney cans, 8.2 over the deck, the placement's cap on the island's roofline), and nothing
//   goes below the deck's top but the plinth's, the terrace's and the steps' foot (to VILLA.foot),
//   which the domed lawn buries all round: nothing floats over it or shows a gap at its foot;
// - every joined piece (each run of faces sharing corners) that is not a pane is 0.07 across or
//   more every way (thinner ones twinkle as the view moves);
// - its detail goes all the way round (the owner, on the first renders: "注意别墅的建模细节要足够";
//   the City overview's Rotate stops show every face): each face carries at least so many dressings
//   (pieces standing out of its wall); L-shaped quoins at all four corners; a downpipe and its hopper
//   at each corner; a gutter round the eaves; lead rolls on the hips and round the flat; three
//   dormers under their roofs, the middle one's a pediment; two stacks, each capped by two brick
//   courses corbelled out, with cans of different heights; the back door with its fanlight and its
//   step, and the stair window, which breaks the band; a window box under every first-floor sash,
//   planted in every season and clear of its glass as the town's camera sees it; balconies of a few
//   fat bars with wide gaps; the terrace's flags as geometry and urns on its corner piers;
// - its French doors are glass on the bay's front, facing +z, five panes a floor (four lights and a
//   transom light) on three floors;
// - batched by the town (its own phase, 'batch sky villa', after the town's buildings, its contact
//   shade from the lawn) it costs at most 16 meshes and 45,000 triangles (the owner's budget for the
//   detail pass), its solids share the one bake program (which carries the wall wash), nothing of
//   it cuts holes, and every varying read is declared;
// - its night (the town's own window list: which rooms stay lit is seeded by where each stands): one
//   light a window, in roles of its own (outside the town's room shares and its night lamps): the
//   front door's is the 'entrance', warm and never out; the rest are 'villa' rooms, all lit and
//   warm at 20:00 and still at 23:00, then about half go out, no two together, and the rest stay
//   lit through the deep night;
// - the wash: eight lamps, on the front faces of the corner and bay piers of the two lower floors;
//   their brick, the corner piers' quoins and the lenses the only washed parts, each scallop faded out
//   before the bands over and under its pier and at the pier's sides; a quoin catches its lamp a
//   little brighter than the brick round it, a lens brighter still and under 1 in luminance (nothing
//   spills off it); in the town's batches the quoins carry their own wash, and its level is the
//   night's, through the town's own material library (setNight).
{
  const { createSkyVilla, VILLA, VILLA_LOOK, VILLA_FAMILY, VILLA_LAMPS, VILLA_WINDOWS, VILLA_ENTRANCE, VILLA_SPRIG } = await load('town-sky-villa'),
    { WINDOW_BOX } = await load('town-homes'),
    { palette } = await load('town-shared'),
    { createProps } = await load('town-props'),
    { createNature } = await load('town-nature'),
    { createKit } = await load('town-kit'),
    { createCityMaterials, wallWash, washLight, WASH_PEAK } = await load('city-materials'),
    town = model.sky,
    site = plan.sites['sky-island'],
    // (Timed builds, above: each run from a context of its own; the checks below take the first.)
    villaTime = timeBuild(
      () => {
        const library = createCityMaterials(),
          ctx = { library, material: library.material, season: 'summer', land: new T.Group(), lamps: [], clocks: [], animated: [] };
        return { ctx, kit: createKit(ctx), shell: new T.Group() };
      },
      ({ ctx, kit, shell }) => {
        // On its site on the deck, as town-build stands the town's own shell (the town is built in summer).
        shell.position.copy(town.shell.position);
        shell.rotation.copy(town.shell.rotation);
        createSkyVilla(ctx, kit, createProps(ctx, kit), createNature(ctx, kit)).buildSkyVilla(shell, site);
        shell.updateMatrixWorld(true);
        return { ctx, shell };
      },
    ),
    { ctx, shell } = villaTime.built;
  {
    // (Box3.setFromObject's precise reach: every vertex, as the batches have them.)
    const mine = new T.Box3().setFromObject(shell, true),
      theirs = new T.Box3().setFromObject(town.shell, true),
      at = (b) => [...b.min.toArray(), ...b.max.toArray()].map((n) => n.toFixed(3)).join(', ');
    assert(mine.min.distanceTo(theirs.min) < 1e-4 && mine.max.distanceTo(theirs.max) < 1e-4 && town.shell.position.equals(new T.Vector3(site.x, site.y, site.z)), `The town's villa (${at(theirs)}) is not the one buildSkyVilla builds on its site (${at(mine)}).`);
  }
  const toShell = shell.matrixWorld.clone().invert(),
    v = new T.Vector3(),
    hex = (c) => '#' + new T.Color(c).getHexString(),
    looks = new Map(Object.entries(VILLA_LOOK).map(([k, c]) => [hex(c), k])),
    feet = new Set(['sky-villa-plinth', 'sky-villa-terrace', 'sky-villa-steps']),
    meshesOf = (g) => {
      const out = [];
      g.traverse((o) => o.isMesh && out.push(o));
      return out;
    };
  /** Each run of joined faces in a mesh (faces sharing a corner), as its box in the shell's frame. */
  const pieces = (m) => {
    const q = m.geometry.attributes.position,
      index = m.geometry.index,
      key = (i) => [q.getX(i), q.getY(i), q.getZ(i)].map((n) => n.toFixed(4)).join(','),
      parent = new Map(),
      find = (k) => (parent.get(k) === k ? k : (parent.set(k, find(parent.get(k))), parent.get(k))),
      corner = (t, j) => (index ? index.getX(t * 3 + j) : t * 3 + j),
      m4 = toShell.clone().multiply(m.matrixWorld);
    for (let i = 0; i < q.count; i++) if (!parent.has(key(i))) parent.set(key(i), key(i));
    for (let t = 0; t < (index ? index.count : q.count) / 3; t++) for (const j of [1, 2]) parent.set(find(key(corner(t, j))), find(key(corner(t, 0))));
    const boxes = new Map();
    for (let i = 0; i < q.count; i++) {
      const r = find(key(i));
      if (!boxes.has(r)) boxes.set(r, new T.Box3());
      boxes.get(r).expandByPoint(v.fromBufferAttribute(q, i).applyMatrix4(m4));
    }
    return [...boxes.values()];
  };
  const parts = meshesOf(shell);
  assert(parts.length > 50, `The villa is only ${parts.length} parts.`);
  // Its size against the town's (the homes are 2.6 x 4.2, the Town Hall 7.4 x 4.6 and 9.5 tall):
  // a house about 6.4 by 4.4 whose three storeys and roof reach about 7, its chimney cans
  // about 1 higher and under the placement's cap on the island's roofline (the deck's top + 8.2); a
  // terrace about the house's width, 1.6 to 2 deep and 0.4 to 0.6 high; at most 6.8 deep in all.
  {
    const flat = VILLA.cornice.corona[1] + VILLA.roof.fascia + VILLA.roof.rise,
      wide = 2 * VILLA.wall.hw,
      deep = VILLA.wall.front - VILLA.wall.back,
      terrace = VILLA.terrace,
      reach = new T.Box3();
    for (const m of parts) reach.union(new T.Box3().setFromObject(m).applyMatrix4(toShell));
    assert(Math.abs(wide - 6.4) <= 0.2 && Math.abs(deep - 4.4) <= 0.2 && Math.abs(flat - 7) <= 0.2, `The villa's house is ${wide} x ${deep.toFixed(2)} and ${flat.toFixed(2)} to its flat.`);
    assert(Math.abs(terrace.hw - VILLA.wall.hw) <= 0.2 && terrace.depth >= 1.6 && terrace.depth <= 2 && terrace.top >= 0.4 && terrace.top <= 0.6, `The villa's terrace is ${2 * terrace.hw} x ${terrace.depth}, ${terrace.top} high.`);
    assert(2 * VILLA.hx <= 7 && 2 * VILLA.hz <= 6.8 + 1e-9 && VILLA.top <= 8.2, `The villa's box is ${2 * VILLA.hx} x ${2 * VILLA.hz} x ${VILLA.top}.`);
    assert(reach.max.y - flat >= 0.9 && reach.max.y - flat <= 1.3, `The villa's chimneys end ${(reach.max.y - flat).toFixed(2)} over its roof.`);
  }
  // Its slate: the reference's darker roof, darker than the town's (linear value) and no louder.
  {
    const value = (c) => Math.max(...new T.Color(c).toArray());
    assert(value(VILLA_LOOK.slate) < 0.85 * value(palette.slate) && VILLA_FAMILY.slate === palette.slate, `The villa's slate ${VILLA_LOOK.slate} is not darker than the town's.`);
  }
  // The window boxes' planting, by season: the homes' own (WINDOW_BOX), and the winter sprigs.
  const planting = (season) => new Set([WINDOW_BOX[season].leaf, ...WINDOW_BOX[season].blooms, VILLA_SPRIG].map(hex)),
    dressings = []; // every joined piece but the glass: its box, size and middle, its mesh's kind, colour and name
  for (const m of parts) {
    const kind = m.material.userData.surfaceKind,
      colour = hex(m.material.color),
      what = `The villa's ${m.name || kind + ' ' + colour}`;
    assert(kind, `${what} has no surface kind.`);
    assert(m.material.side !== T.DoubleSide && !m.material.transparent && m.material.opacity === 1 && !m.material.alphaTest, `${what} is two-sided, transparent or cut out.`);
    if (kind === 'foliage') assert(planting(ctx.season).has(colour), `${what} is not the window boxes' ${ctx.season} planting.`);
    else {
      const look = looks.get(colour);
      assert(look, `${what} is not one of VILLA_LOOK's colours.`);
      assert(hsv(colour).s <= hsv(hex(VILLA_FAMILY[look])).s + 1e-3, `${what} is louder than its family (${look}: ${hex(VILLA_FAMILY[look])}).`);
    }
    const p = m.geometry.attributes.position,
      m4 = toShell.clone().multiply(m.matrixWorld),
      floor = feet.has(m.name) ? VILLA.foot : 0;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m4);
      assert(Math.abs(v.x) <= VILLA.hx + 1e-6 && Math.abs(v.z) <= VILLA.hz + 1e-6 && v.y <= VILLA.top + 1e-6, `${what} leaves the villa's footprint box at ${v.toArray().map((n) => n.toFixed(3)).join(", ")}.`);
      assert(v.y >= floor - 1e-6, `${what} goes below ${floor === 0 ? "the deck's top" : 'its foot'} at ${v.toArray().map((n) => n.toFixed(3)).join(", ")}.`);
      // In place, a foot's bottom lies 0.1 or more under the domed lawn, wherever it is: the lawn
      // falls away from the deck's crest (0.13 at the footprint's back corners), so a foot that
      // stopped at y 0 would hang over it with a gap of sky under its edge.
      if (floor < 0 && v.y < VILLA.foot + 0.01) {
        const w = v.clone().applyMatrix4(shell.matrixWorld);
        assert(w.y <= plan.skyTop(w.x, w.z) - 0.1, `${what}'s foot stands ${(w.y - plan.skyTop(w.x, w.z)).toFixed(3)} from the lawn at ${w.x.toFixed(2)}, ${w.z.toFixed(2)}, not under it.`);
      }
    }
    if (kind === 'glass') continue;
    for (const b of pieces(m)) {
      const size = b.getSize(new T.Vector3());
      assert(Math.min(size.x, size.y, size.z) >= 0.07 - 1e-3, `${what} has a piece ${size.toArray().map((n) => n.toFixed(3)).join(' x ')} at ${b.getCenter(new T.Vector3()).toArray().map((n) => n.toFixed(2)).join(", ")}.`);
      dressings.push({ b, s: size, c: b.getCenter(new T.Vector3()), kind, colour, name: m.name });
    }
  }
  // Its detail, all the way round (the owner's "注意别墅的建模细节要足够"; the City overview's Rotate
  // stops show its sides and back).
  {
    const { hw, back, front } = VILLA.wall,
      bayFront = front + VILLA.bay.out,
      proud = VILLA.pier.proud,
      of = (colour) => dressings.filter((p) => p.colour === hex(colour)),
      stone = of(VILLA_LOOK.stone),
      lead = of(VILLA_LOOK.lead),
      rain = of(VILLA_LOOK.rain);
    // Each face's dressings: pieces whose middle stands out of its wall by 0.45 at most, along the
    // wall, from the plinth course to the cornice's bed. The minimums are about five sixths of the
    // counts when this was written (front 204, back 100, each side 106; the first build, before the
    // detail pass, had 106, 45 and 30).
    const faces = [
      { face: 'front', least: 175, on: (c) => (c.z > front && c.z <= front + 0.45 && Math.abs(c.x) <= hw + 0.1) || (c.z > bayFront && c.z <= bayFront + 0.45 && Math.abs(c.x) <= VILLA.bay.hw + 0.1) },
      { face: 'back', least: 85, on: (c) => c.z < back && c.z >= back - 0.45 && Math.abs(c.x) <= hw + 0.1 },
      { face: 'east', least: 90, on: (c) => c.x > hw && c.x <= hw + 0.45 && c.z >= back - 0.1 && c.z <= front + 0.1 },
      { face: 'west', least: 90, on: (c) => c.x < -hw && c.x >= -hw - 0.45 && c.z >= back - 0.1 && c.z <= front + 0.1 },
    ];
    for (const { face, least, on } of faces) {
      const n = dressings.filter((p) => p.c.y > 0.4 && p.c.y < VILLA.cornice.bed[0] && on(p.c)).length;
      assert(n >= least, `The villa's ${face} carries ${n} dressings, under ${least}.`);
    }
    // Quoins: L-shaped stones round each corner pier's arris, stacked course on course (so a storey's
    // run is one joined piece): on every corner a run on each storey, wrapping both faces.
    for (const sx of [-1, 1])
      for (const cz of [front + proud, back - proud]) {
        const cx = sx * (hw + proud),
          runs = stone.filter((p) => p.b.min.x < cx && p.b.max.x > cx && p.b.min.z < cz && p.b.max.z > cz && p.s.y >= 1 && p.s.x >= 0.15 && p.s.z >= 0.15);
        assert(runs.length === 3 && VILLA.storeys.every(([y0, y1]) => runs.some((p) => p.b.min.y <= Math.max(y0, VILLA.plinth.course[1]) + 1e-3 && p.b.max.y >= y1 - 1e-3)), `The villa's corner at ${cx}, ${cz.toFixed(2)} has ${runs.length} runs of quoins, not one a storey.`);
      }
    // Rainwater: a gutter round the eaves on the corona; at each corner, on the side walls, a
    // downpipe of 3.5 or more under a hopper head.
    const eave = VILLA.cornice.corona[1];
    assert(of(VILLA_LOOK.paint).some((p) => p.s.x > 2 * hw + 0.3 && p.s.z > bayFront - back + 0.3 && p.b.min.y >= eave - 1e-3 && p.b.max.y <= eave + 0.15), 'The villa has no gutter round its eaves.');
    const pipes = rain.filter((p) => p.s.y >= 3.5);
    assert(pipes.length === 4 && pipes.every((p) => Math.abs(p.c.x) > hw && Math.abs(p.c.x) < hw + 0.2 && Math.min(Math.abs(p.c.z - front), Math.abs(p.c.z - back)) < 0.8), `The villa has ${pipes.length} downpipes, not one at each corner of the side walls.`);
    for (const p of pipes) assert(rain.some((h) => h.s.y >= 0.2 && h.s.y < 0.3 && h.b.min.y > 4.5 && Math.abs(h.c.x - p.c.x) < 0.1 && Math.abs(h.c.z - p.c.z) < 0.1), `The downpipe at ${p.c.z.toFixed(2)} has no hopper head.`);
    // The roof: a roll on each of its four hips and each edge of its flat (they meet at bosses, so
    // they are one joined piece: looked for from above, at each hip's and each edge's middle), in the
    // rolls' light slate grey.
    {
      const R = VILLA.roof,
        x1 = hw + R.eave,
        z0 = back - R.eave,
        z1 = front + R.eave,
        fx = x1 - R.runX,
        fz0 = z0 + R.run,
        fz1 = z1 - R.run,
        y1 = VILLA.cornice.corona[1] + R.fascia,
        y2 = y1 + R.rise,
        down = new T.Vector3(0, -1, 0).transformDirection(shell.matrixWorld),
        solids = parts.filter((m) => m.material.userData.surfaceKind !== 'glass'),
        top = (x, y, z) => new T.Raycaster(new T.Vector3(x, y + 1, z).applyMatrix4(shell.matrixWorld), down).intersectObjects(solids, false)[0],
        spots = [];
      for (const sx of [-1, 1]) for (const [ze, zf] of [[z0, fz0], [z1, fz1]]) spots.push(['a hip', (sx * (x1 + fx)) / 2, (y1 + y2) / 2, (ze + zf) / 2]);
      for (const z of [fz0, fz1]) spots.push(["the flat's edge", 0.6, y2, z]);
      for (const sx of [-1, 1]) spots.push(["the flat's edge", sx * fx, y2, fz0 + 0.2]); // (behind the stacks' copes)
      for (const [what, x, y, z] of spots) {
        const hit = top(x, y, z);
        assert(hit && hex(hit.object.material.color) === hex(VILLA_LOOK.roll), `No roll on ${what} at ${x.toFixed(2)}, ${z.toFixed(2)}.`);
      }
    }
    // The trims by day (the art review's finding 12): the wall lamps' lenses are dark smoked glass and
    // their housings a dark bronze near the brick's own shade (no black boxes with white bars on the
    // brick); the rolls are low half-rounds (sunk in the arris they cover, so they stand no more than
    // their radius over it) in a light slate grey, with no balls at their feet over the gutters and
    // none across the flat; and the flat carries a low hipped cap of slate (calm, never an empty
    // panel), under the chimneys' copes.
    {
      const R = VILLA.roof,
        y2 = VILLA.cornice.corona[1] + R.fascia + R.rise,
        lum = (h) => {
          const c = new T.Color(h);
          return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        },
        rolls = of(VILLA_LOOK.roll),
        lensPieces = dressings.filter((p) => p.colour === hex(VILLA_LOOK.lens)),
        housings = dressings.filter((p) => p.colour === hex(VILLA_LOOK.housing));
      assert(lum(VILLA_LOOK.lens) < 0.05 && VILLA_FAMILY.housing === palette.bronze && lum(VILLA_LOOK.housing) > 0.4 * lum(VILLA_LOOK.brick) && lum(VILLA_LOOK.housing) < 0.9 * lum(VILLA_LOOK.brick) && lensPieces.length === 16 && housings.length === 8, `The wall lamps are ${lensPieces.length} lenses and ${housings.length} housings, not 16 dark lenses in 8 bronze housings near the brick's shade.`);
      assert(!dressings.some((p) => p.colour === hex(VILLA_LOOK.paint) && lensPieces.some((l) => l.b.intersectsBox(p.b))), 'A wall lamp still shows white paint.');
      assert(R.roll[0] >= 0.07 && R.roll[1] > 0 && R.roll[1] < R.roll[0] && hsv(VILLA_LOOK.roll).s <= hsv(palette.slate).s + 1e-3, 'The roof\'s rolls are not low half-rounds in the slate family.');
      // The windows' slim uprights over the glass (glazing bars, mullions, stiles: the final art
      // review's verifier found the white grid of them on the glass twinkling under the idle drift) are
      // the bars' pale grey-blue, between the paint and the glass in value, each standing upright; the
      // frames and the level rails stay the paint's white (ref-3's white-framed sashes).
      const uprights = dressings.filter((p) => p.colour === hex(VILLA_LOOK.bar));
      assert(uprights.length >= 30 && uprights.every((p) => p.s.y >= 2.5 * Math.max(p.s.x, p.s.z)) && lum(VILLA_LOOK.bar) < lum(VILLA_LOOK.paint) - 0.1 && lum(VILLA_LOOK.bar) > lum(VILLA_LOOK.glass) + 0.1, `The villa's ${uprights.length} window uprights are not the bars' grey-blue standing upright, between the paint and the glass.`);
      // No ball at a roll's foot: every roll piece near the eaves is a run along a hip, never a lump.
      for (const p of rolls) if (p.b.min.y < VILLA.cornice.corona[1] + R.fascia + 0.3) assert(Math.max(p.s.x, p.s.z) > 0.5, `A ball sits at a roll's foot over the gutter at ${p.c.x.toFixed(2)}, ${p.c.z.toFixed(2)}.`);
      const cap = parts.find((m) => m.name === 'sky-villa-roof-cap');
      assert(cap && cap.material.userData.surfaceKind === 'slate', 'The flat has no low cap of slate.');
      const capBox = new T.Box3().setFromObject(cap).applyMatrix4(toShell);
      assert(Math.abs(capBox.min.y - y2) < 1e-3 && capBox.max.y - y2 > 0.12 && capBox.max.y - y2 < 0.3 && capBox.max.y < VILLA.chimney.top, `The flat's cap rises ${(capBox.max.y - y2).toFixed(2)} over it.`);
      // No roll across the flat: inside the flat (clear of its edges) only the cap's own ridge roll.
      const inner = rolls.filter((p) => p.c.y > y2 && Math.abs(p.c.x) < capBox.max.x - 0.3 && p.c.z > capBox.min.z + 0.3 && p.c.z < capBox.max.z - 0.3);
      assert(inner.length === 1 && inner[0].c.y > capBox.max.y - 0.1, `${inner.length} rolls run across the villa's flat, not the cap's ridge roll alone.`);
    }
    // Three dormers under roofs of their own and white cornices, the middle one's pediment over it.
    assert.equal(parts.filter((m) => m.name === 'sky-villa-dormer-roof').length, 3, "The villa's dormers lack their roofs.");
    assert(stone.filter((p) => p.b.min.y > 6.5 && p.b.max.y < 6.8 && p.s.y >= 0.13 && p.s.x > 0.8 && p.c.z > 0.4).length === 3, "The villa's dormers lack their cornices.");
    assert(stone.some((p) => Math.abs(p.c.x) < 0.05 && p.s.x > 1.2 && p.b.min.y > 6.7 && p.c.z > 1), 'The middle dormer has no pediment.');
    // The stacks: over the shaft a cap corbelled out in two brick courses, each wider than the one
    // under it; three cans of at least two heights; a lead flashing down the slope at each side.
    for (const sx of [-1, 1]) {
      const { x, z, d } = VILLA.chimney,
        bricks = dressings.filter((p) => p.kind === 'brick' && Math.abs(p.c.x - sx * x) < 0.1 && Math.abs(p.c.z - z) < 0.1).sort((a, b) => a.b.min.y - b.b.min.y),
        cans = dressings.filter((p) => p.kind === 'pantile' && Math.abs(p.c.x - sx * x) < 0.5 && Math.abs(p.c.z - z) < 0.2),
        flashings = lead.filter((p) => p.s.y > 1 && Math.abs(p.c.x - sx * x) < 0.3 && Math.abs(Math.abs(p.c.z - z) - d / 2 - 0.05) < 0.1);
      assert(bricks.length === 3 && bricks[1].s.x > bricks[0].s.x + 0.05 && bricks[2].s.x > bricks[1].s.x + 0.05 && bricks[2].s.y <= 0.15, 'A stack lacks its corbelled cap.');
      assert(cans.length === 3 && new Set(cans.map((p) => p.s.y.toFixed(2))).size >= 2, 'A stack lacks cans of different heights.');
      assert.equal(flashings.length, 2, 'A stack lacks its flashings.');
    }
    // The back: its door (an enamelled leaf on the back wall) with a fanlight and a step, and over it
    // the stair window across the upper band, which breaks for it: nothing solid stands out of the
    // wall in front of its glass at the band's height.
    const at = (m) => {
        const b = new T.Box3(),
          q = m.geometry.attributes.position,
          m4 = toShell.clone().multiply(m.matrixWorld);
        for (let i = 0; i < q.count; i++) b.expandByPoint(v.fromBufferAttribute(q, i).applyMatrix4(m4));
        return b;
      },
      glassOf = (group) => parts.find((m) => m.material.userData.surfaceKind === 'glass' && m.userData.windowGroup === group);
    assert(parts.some((m) => m.material.userData.surfaceKind === 'enamel' && at(m).max.z < back + 0.15) && glassOf('sky-island-back-door') && parts.some((m) => m.name === 'sky-villa-steps' && at(m).max.z < back), 'The villa has no back door with a fanlight and a step.');
    const stair = glassOf('sky-island-back-stair'),
      [b0, b1] = VILLA.bands[1];
    assert(stair && at(stair).max.y - at(stair).min.y > 1.2 && at(stair).min.y < b0 && at(stair).max.y > b1, 'The back has no stair window across the upper band.');
    {
      const ray = new T.Raycaster(new T.Vector3(0.15, (b0 + b1) / 2, back - 1).applyMatrix4(shell.matrixWorld), new T.Vector3(0, 0, 1).transformDirection(shell.matrixWorld)),
        hit = ray.intersectObjects(parts.filter((m) => m.material.userData.surfaceKind !== 'glass'), false)[0];
      assert(!hit || hit.distance > 0.99, `Something stands in front of the stair window at the band, ${hit && (1 - hit.distance).toFixed(2)} out of the wall.`);
    }
    // The balconies: on each front a few fat uprights (two end posts, four bars) with gaps of 0.18 or more.
    for (const [y, out] of [[VILLA.storeys[1][0] + 0.02, 0.5], [VILLA.storeys[2][0] + 0.02, 0.46]]) {
      const pz = bayFront + out - 0.07,
        uprights = of(VILLA_LOOK.iron).filter((p) => Math.abs(p.c.z - pz) < 0.06 && p.b.min.y >= y - 0.01 && p.s.y >= 0.25 && p.b.max.y < y + 0.7).sort((a, b) => a.c.x - b.c.x);
      assert(uprights.length === 6, `A balcony's front has ${uprights.length} uprights, not six.`);
      for (let i = 1; i < uprights.length; i++) assert(uprights[i].b.min.x - uprights[i - 1].b.max.x >= 0.18, `A balcony's bars stand ${(uprights[i].b.min.x - uprights[i - 1].b.max.x).toFixed(3)} apart.`);
    }
    // The terrace: its flags as geometry (a layer 0.07 thick, its top the terrace's; they butt, so
    // they are counted by their top faces, two triangles each), urns on its corner piers.
    const flags = parts.find((m) => m.name === 'sky-villa-flags'),
      fb = at(flags),
      urns = stone.filter((p) => p.s.y >= 0.4 && p.b.min.y > VILLA.terrace.top + 0.5 && p.c.z > front + VILLA.terrace.depth - 0.4);
    let tops = 0;
    {
      const q = flags.geometry.attributes.position,
        m4 = toShell.clone().multiply(flags.matrixWorld),
        y = (i) => v.fromBufferAttribute(q, i).applyMatrix4(m4).y;
      for (let t = 0; t < q.count; t += 3) if ([t, t + 1, t + 2].every((i) => Math.abs(y(i) - VILLA.terrace.top) < 1e-4)) tops++;
    }
    assert(flags.material.userData.surfaceKind === 'stone' && Math.abs(fb.max.y - VILLA.terrace.top) < 1e-4 && Math.abs(fb.min.y - VILLA.terrace.top + 0.07) < 1e-4 && tops / 2 >= 20, `The terrace's flags are not laid as geometry (${tops / 2} flags).`);
    assert(urns.length === 2 && urns.every((p) => Math.abs(p.c.x) > hw - 0.3), "The terrace's corner piers carry no urns.");
  }
  // The window boxes, in every season: one under each first-floor sash (the lower pane of each
  // '-1-' group), planted with that season's planting, and nothing of it over the glass's foot as
  // the town's camera sees it (35 up for every 38 out, as the homes' boxes are checked).
  {
    const RISE = 35 / 38,
      boxes = (meshes, toS, season) => {
        const lowest = new Map();
        for (const m of meshes) {
          if (m.material.userData.surfaceKind !== 'glass' || !m.userData.sashPane || !/-1-/.test(m.userData.windowGroup ?? '')) continue;
          const c = m.getWorldPosition(new T.Vector3()).applyMatrix4(toS),
            was = lowest.get(m.userData.windowGroup);
          if (!was || c.y < was.c.y) lowest.set(m.userData.windowGroup, { m, c });
        }
        assert.equal(lowest.size, 8, `The villa has ${lowest.size} first-floor sashes, not eight.`);
        const leaves = meshes.filter((m) => m.material.userData.surfaceKind === 'foliage');
        for (const [group, { m, c }] of lowest) {
          const n = new T.Vector3(0, 0, 1).transformDirection(toS.clone().multiply(m.matrixWorld)),
            across = new T.Vector3(0, 1, 0).cross(n),
            foot = c.y - m.geometry.parameters.height / 2;
          let planted = 0;
          for (const f of leaves) {
            const F = toS.clone().multiply(f.matrixWorld),
              q = f.geometry.attributes.position;
            let here = false;
            for (let i = 0; i < q.count; i++) {
              v.fromBufferAttribute(q, i).applyMatrix4(F).sub(c);
              const out = v.dot(n);
              if (out <= 0 || out > 0.4 || Math.abs(v.dot(across)) > 0.6 || v.y > 0.3 || v.y < -0.4) continue;
              here = true;
              assert(c.y + v.y - out * RISE < foot + 0.005, `${group}'s window box stands over its glass in ${season} (${(c.y + v.y - out * RISE - foot).toFixed(3)}).`);
            }
            if (here) {
              planted++;
              assert(planting(season).has(hex(f.material.color)), `${group}'s window box is not planted for ${season}.`);
            }
          }
          assert(planted >= 3, `${group} has no planted window box in ${season}.`);
        }
      };
    boxes(parts, toShell, ctx.season);
    for (const season of ['spring', 'autumn', 'winter']) {
      const c2 = { ...ctx, season },
        k2 = createKit(c2),
        s2 = new T.Group();
      createSkyVilla(c2, k2, createProps(c2, k2), createNature(c2, k2)).buildSkyVilla(s2, { id: 'sky-island' });
      s2.updateMatrixWorld(true);
      boxes(meshesOf(s2), new T.Matrix4(), season);
    }
  }
  // Its French doors: glass on the bay's front, facing +z.
  const doors = parts.filter((m) => m.userData.frenchDoor),
    bayFront = VILLA.wall.front + VILLA.bay.out;
  assert.equal(doors.length, 15, 'The villa lacks its French doors: four lights and a transom light on each of three floors.');
  for (const d of doors) {
    const at = d.getWorldPosition(new T.Vector3()).applyMatrix4(toShell),
      facing = new T.Vector3(0, 0, 1).transformDirection(d.matrixWorld).transformDirection(toShell);
    assert(d.material.userData.surfaceKind === 'glass' && facing.z > 0.999 && at.z > bayFront && at.z < bayFront + 0.1 && Math.abs(at.x) < VILLA.bay.hw, `A French door's pane is off the bay's front at ${at.toArray().map((n) => n.toFixed(2)).join(", ")}.`);
  }
  // The wash: eight lamps (each pier's brick, and its two lenses glowing with it), on the front faces
  // of the lower two floors' corner and bay piers; each scallop gone before the bands and the
  // pier's sides. The corner piers' quoins on those floors (a mesh a pier) take their pier's lamp,
  // at their own strength.
  const washed = parts.filter((m) => m.userData.wash),
    lamps = washed.filter((m) => !m.userData.wash.glow && m.material.userData.surfaceKind === 'brick'),
    quoins = washed.filter((m) => !m.userData.wash.glow && m.material.userData.surfaceKind !== 'brick'),
    lenses = washed.filter((m) => m.userData.wash.glow);
  assert(lamps.length === 8 && quoins.length === 4 && lenses.length === 16, `The villa has ${lamps.length} washed piers, ${quoins.length} washed quoin runs and ${lenses.length} lenses, not 8, 4 and 16.`);
  for (const m of quoins) {
    const w = m.userData.wash,
      pier = lamps.find((p) => ['x', 'y', 'z', 'half'].every((k) => Math.abs(p.userData.wash[k] - w[k]) < 1e-6)),
      b = new T.Box3().setFromObject(m).applyMatrix4(toShell);
    assert(pier && m.material.userData.surfaceKind === 'stone' && w.strength === VILLA_LAMPS.quoin && w.nz === 1 && w.nx === 0 && Math.abs(pier.userData.wash.half - VILLA_LAMPS.half.corner) < 1e-6, "A washed quoin run does not take its corner pier's lamp.");
    assert(b.min.y < w.y && b.max.y > w.y && b.max.z > w.z, 'A washed quoin run is not on its lamp pier.');
  }
  for (const m of lamps) {
    const w = m.userData.wash,
      b = new T.Box3(),
      p = m.geometry.attributes.position,
      m4 = toShell.clone().multiply(m.matrixWorld);
    for (let i = 0; i < p.count; i++) b.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(m4));
    assert(m.material.userData.surfaceKind === 'brick' && w.nz === 1 && w.nx === 0 && Math.abs(w.z - b.max.z) < 1e-6, 'A lamp is not on the front face of a brick pier.');
    assert(VILLA.storeys.slice(0, 2).some(([y0, y1]) => w.y > y0 && w.y < y1), 'A lamp is not on the ground or first floor.');
    for (const u of [b.max.y - 0.04 - w.y, b.min.y - w.y]) assert(wallWash(0, u, w.half) < 0.02, `A lamp's wash reaches its pier's end (${u.toFixed(2)} from it).`);
    assert(Math.abs(w.x - (b.min.x + b.max.x) / 2) < 1e-6 && w.half <= (b.max.x - b.min.x) / 2 + 1e-6 && wallWash(w.half, 0.3, w.half) === 0, `A lamp's wash spills past its pier's sides (lamp ${w.x.toFixed(3)}, half ${w.half}; pier ${b.min.x.toFixed(3)} to ${b.max.x.toFixed(3)}).`);
  }
  // The town's own villa, batched in its own phase ('batch sky villa', held to its limit with the
  // island's other phases in the block before), its contact shade from the lawn under it.
  const batched = meshesOf(town.shell);
  let tris = 0;
  for (const m of batched) tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
  assert(batched.length <= 16 && tris <= 45000, `The villa costs ${batched.length} meshes and ${Math.round(tris)} triangles.`);
  inTime('The villa\'s build', villaTime, 150);
  const solid = batched.filter((m) => !['glass', 'paving'].includes(m.material.userData.surfaceKind));
  assert(new Set(solid.map((m) => m.material.customProgramCacheKey())).size === 1 && solid[0].material.customProgramCacheKey() === 'lius-bake-solid', 'The villa\'s solids do not share the bake program.');
  for (const m of batched) {
    assert(m.material.side !== T.DoubleSide && !m.material.transparent, `The villa's ${m.material.name} batch is two-sided or transparent.`);
    const s = patchedShader(m.material),
      fv = varyings(s.fragmentShader);
    assert(!s.fragmentShader.includes('discard'), `The villa's ${m.material.name} batch cuts holes.`);
    for (const name of varyings(s.vertexShader)) assert(!new RegExp('\\b' + name + '\\b').test(s.fragmentShader) || fv.has(name), `${m.material.name}: ${name} read but not declared`);
  }
  {
    const s = patchedShader(solid[0].material);
    assert(s.vertexShader.includes('attribute vec4 aWash') && s.vertexShader.includes('vWash = aWash') && s.fragmentShader.includes('totalEmissiveRadiance+=washLevel*vWash.x'), 'The bake program does not carry the wall wash.');
    // Only a negative w lets the wash in: a mesh without aWash reads WebGL's generic value (w 1).
    assert(s.fragmentShader.includes('if(vWash.w<0.&&washLevel>0.)'), 'The wall wash is not gated on a negative w.');
    assert(s.uniforms.washLevel === model.materialLibrary.washLevel, 'The bake program does not read the town\'s shared wash level.');
  }
  const washes = batched.filter((m) => m.geometry.getAttribute('aWash'));
  assert(washes.length >= 1 && washes.every((m) => ['stone', 'paint'].includes(m.material.userData.surfaceKind)), `The wash is on the villa's ${washes.map((m) => m.material.name).join(', ')}.`);
  {
    let strongest = 0,
      lit = 0;
    for (const m of washes) {
      const a = m.geometry.getAttribute('aWash');
      for (let i = 0; i < a.count; i++) {
        strongest = Math.max(strongest, a.getX(i));
        if (a.getX(i) > 0) lit++;
        // A washed vertex carries its half width negated; the rest of its batch carries zeros.
        assert(a.getX(i) > 0 ? a.getW(i) < 0 : a.getW(i) <= 0, `A villa vertex's wash has strength ${a.getX(i)} and w ${a.getW(i)}.`);
      }
    }
    assert(lit > 0 && Math.abs(strongest - Math.max(VILLA_LAMPS.lens, VILLA_LAMPS.strength)) < 1e-6, `The villa's wash is ${lit} lit vertices at most ${strongest}.`);
    // The quoins keep their own wash in the town's batches: on each front corner, on both lit
    // floors, white stone washed at the quoins' strength.
    const { hw, front } = VILLA.wall,
      corners = new Set();
    for (const m of washes) {
      if (m.material.userData.surfaceKind !== 'stone') continue;
      const a = m.geometry.getAttribute('aWash'),
        q = m.geometry.attributes.position,
        m4 = toShell.clone().multiply(m.matrixWorld);
      for (let i = 0; i < a.count; i++) {
        if (Math.abs(a.getX(i) - VILLA_LAMPS.quoin) > 1e-6) continue;
        v.fromBufferAttribute(q, i).applyMatrix4(m4);
        const storey = VILLA.storeys.findIndex(([y0, y1]) => v.y >= y0 - 0.2 && v.y <= y1 + 0.05);
        if (Math.abs(v.x) > hw - 0.3 && v.z > front && storey >= 0 && storey < 2) corners.add(`${Math.sign(v.x)} ${storey}`);
      }
    }
    assert.equal(corners.size, 4, `The town's villa washes its quoins on ${[...corners].join(', ') || 'no corner'}, not on both front corners of both lit floors.`);
  }
  // A lens (dark smoked glass by day, lit at the wash's peak at night) against the brick under the
  // same lamp: brighter than the brick's wash, and under 1 in luminance (linear), as a window's glow
  // is. Brighter than that, a lens 0.14 across spills over its edges when the multisampled frame
  // resolves. A quoin (white stone, about five times the brick's albedo under the warm light) between
  // the two.
  {
    const Y = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b,
      lit = (albedo, strength) => Y(washLight().multiply(new T.Color(albedo))) * strength * wallWash(0, WASH_PEAK, VILLA_LAMPS.half.bay),
      lens = lit(VILLA_LOOK.lens, VILLA_LAMPS.lens),
      brick = lit(VILLA_LOOK.brick, VILLA_LAMPS.strength),
      quoin = lit(VILLA_LOOK.stone, VILLA_LAMPS.quoin);
    assert(lens <= 1 && lens > 2 * brick && brick > 0.15 && quoin > brick && quoin < lens, `A lens glows at ${lens.toFixed(2)}, a quoin at ${quoin.toFixed(2)} and the brick under its lamp at ${brick.toFixed(2)}.`);
    // Its colour (sRGB, at full value) is no louder than the lanterns' glass.
    const light = washLight();
    assert(hsv('#' + light.multiplyScalar(1 / Math.max(light.r, light.g, light.b)).getHexString()).s <= hsv(palette.lantern).s + 1e-3, 'The wash is a louder colour than the lanterns.');
  }
  // The lamps are on from dusk to dawn: the wash's level is the night's, set with the night by the
  // town's own material library (the scene's frame loop calls its setNight).
  for (const night of [0, 0.4, 1, 0]) {
    model.materialLibrary.setNight(night);
    assert.equal(model.materialLibrary.washLevel.value, night, `The wash is at ${model.materialLibrary.washLevel.value} at night ${night}.`);
  }
  // Its night lights: one a window (24 sashes, three sets of French doors, three dormers, the back
  // door's fanlight and the stair window). The front door's is the hall's (the fixed 'entrance' role:
  // warm, never out); the rest are 'villa' rooms, all lit and warm in the evening, of which about
  // half go out, late and no two together, and the rest stay lit till morning.
  const own = model.windows.filter((p) => p.place === 'sky-island'),
    groups = new Set(parts.filter((m) => m.material.userData.surfaceKind === 'glass').map((m) => m.userData.windowGroup));
  assert(own.length === groups.size && own.length === 32 && !groups.has(undefined), `The villa has ${own.length} lights for ${groups.size} windows.`);
  const level = (p, h) => windowLevel(p.light, windowClock(h)),
    entrance = own.filter((p) => p.role === VILLA_ENTRANCE),
    rooms = own.filter((p) => p.role === VILLA_WINDOWS);
  assert(VILLA_WINDOWS === 'villa' && VILLA_ENTRANCE === 'entrance' && entrance.length === 1 && rooms.length === 31, `The villa has ${entrance.length} entrance lights and ${rooms.length} rooms.`);
  {
    const at = entrance[0].at.clone().applyMatrix4(toShell);
    assert(Math.abs(at.x) < VILLA.bay.hw && at.z > bayFront && at.y > VILLA.terrace.top && at.y < VILLA.storeys[0][1], `The entrance's light is not the front door's (${at.toArray().map((n) => n.toFixed(2)).join(', ')}).`);
    for (const h of [20, 23, 2.5, 4, 5.4]) assert(level(entrance[0], h) > 0.5, `The front door is dark at ${h}.`);
  }
  // (Tint 0 is the warm white, 128 exactly today's glow; only above it does a pane turn cool.)
  assert(own.every((p) => level(p, 20) > 0.1 && Math.round(p.light[1] * 255) <= 128), 'A villa window is dark or cool at 20:00.');
  assert(rooms.every((p) => level(p, 23) > 0.1), 'A villa room is out before 23:00.');
  const late = rooms.filter((p) => level(p, 2.5) > 0.1),
    offs = rooms.map((p) => Math.round(p.light[2] * 255)).filter((b) => b < 255);
  assert(late.length >= 0.3 * rooms.length && late.length <= 0.7 * rooms.length, `${late.length} of the villa's ${rooms.length} rooms are lit at 02:30.`);
  assert(late.every((p) => level(p, 4) > 0.1 && level(p, 5.4) > 0.1), 'A villa room lit at 02:30 goes out before morning.');
  assert(offs.length === rooms.length - late.length && new Set(offs).size === offs.length, 'Two villa rooms go out together.');
  skyReport += `; its villa ${batched.length} meshes and ${Math.round(tris)} triangles, ${late.length} of its ${rooms.length} rooms still lit at 02:30`;
}
// The tropic island (plan.TROPIC): a neighbour's island on the sea off the south shore, its ground
// built and batched in a group and phases of its own (town-tropic), its building one of the town's
// models with its root at the island's middle, its shallows in the ground masks and its tide line
// in the shore's foam. Its spot and its shore's maths; its lawn, terrace, court, paths and rocks;
// its groups, phases and budgets; its shallows and the grown masks; setShown, which takes all of it
// away and brings it back exactly; TROPIC_EXTENT; the pointer; its building's slot and its night
// lights; and its clearances from the town's shore and from everything that moves. (check-navigation
// holds its framings; its building, garden and figure have their own checks.)
let tropicReport = '';
{
  const { WATER, MASK_EXTENT, MASK_SIZE, palette } = await load('town-shared'),
    { SHORE_PROFILE, TROPIC_SHALLOWS } = await load('town-ground'),
    { TROPIC_LOOK, TROPIC_EXTENT, TROPIC_COURT } = await load('town-tropic'),
    { TROPIC_HIT } = await load('city-scene'),
    P = plan.TROPIC,
    B = plan.TROPIC_BUILDING,
    Q = plan.TROPIC_PLAZA,
    M = plan.TROPIC_MOUND,
    W = plan.TROPIC_PATHS,
    tropic = model.tropic,
    land = model.tropicLand,
    hall = models.get('tropic-island'),
    foam = model.land.getObjectByName('tide-foam'),
    v = new T.Vector3(),
    each = (group, visit) =>
      group.traverse((o) => {
        if (!o.isMesh) return;
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) visit(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld), o, i);
      }),
    trianglesOf = (o) => (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3,
    stops = [0, 1, 2, 3].map((k) => Math.PI / 4 + (k * Math.PI) / 2),
    file = plan.chapterBearings['tropic-island'],
    backOf = (bearing) => new T.Vector3(Math.sin(bearing) * 38, 35, Math.cos(bearing) * 38).normalize();
  city.updateMatrixWorld(true);

  /* ---------------- the spot and the shore's maths ---------------- */
  // Decision 2: its middle at (19.5, 51), its waterline an ellipse 13 by 10.5 (26 by 21), so its shores
  // run no further than z 40.5 north and 61.5 south, x 6.5 west and 32.5 east; its file seen from the
  // gate's bearing (no new bearing), the building's front 35 degrees off, on the camera's left.
  assert(P.x === 19.5 && P.z === 51 && P.a === 13 && P.b === 10.5, 'The tropic island is off its decided spot or size.');
  assert(P.z - P.b === 40.5 && P.z + P.b === 61.5 && P.x - P.a === 6.5 && P.x + P.a === 32.5, 'The tropic island\'s shores are not where they were decided.');
  assert.equal(file, plan.chapterBearings['lius-gate'], 'The tropic island\'s file brings a new bearing.');
  assert(Math.abs(plan.angleDiff(file, plan.sites['tropic-island'].rotation) - 34.7 * (Math.PI / 180)) < 0.01, 'The tropic island\'s file does not see its building\'s front 35 degrees off.');
  {
    // tropicDistance is the distance from the waterline's ellipse itself (a fine polyline of it), signed.
    const fine = plan.tropicOutline(0, 3000).map((p) => [p.x, p.z]),
      inside = (x, z) => ((x - P.x) / P.a) ** 2 + ((z - P.z) / P.b) ** 2 <= 1;
    let worst = 0;
    for (let x = P.x - P.a - 3; x <= P.x + P.a + 3; x += 0.9)
      for (let z = P.z - P.b - 3; z <= P.z + P.b + 3; z += 0.9) worst = Math.max(worst, Math.abs(plan.tropicDistance(x, z) - plan.distanceToPolyline([x, z], fine, true) * (inside(x, z) ? -1 : 1)));
    assert(worst < 0.01, `tropicDistance is ${worst.toFixed(3)} off the waterline's true outline.`);
    assert(plan.onTropic(P.x + P.a - 1.01, P.z, -1) && !plan.onTropic(P.x + P.a - 0.99, P.z, -1) && plan.onTropic(P.x, P.z + P.b + 0.4, 0.5) && !plan.onTropic(P.x, P.z + P.b + 0.6, 0.5), 'onTropic\'s margin is not a level of the signed distance.');
    for (const p of plan.tropicOutline(0.5, 64)) assert(Math.abs(plan.tropicDistance(p.x, p.z) - 0.5) < 1e-3, 'tropicOutline is off its level.');
    const ring = plan.tropicOutline(0, 8);
    assert(ring[0].x > P.x && ring[2].z > P.z && ring[4].x < P.x && ring[6].z < P.z, 'The tropic island\'s outline does not run clockwise from its east end.');
  }
  // Its beach is the town's own shore profile: TROPIC.beach is where that meets the water's level, as on
  // the town's shore; on every station's ray the profile's widths come back from the points laid at them,
  // and its waterline lies on the ellipse. The beach is TROPIC.rocky wide on the rocky stretches, the
  // profile's own width on the sand.
  {
    const k = SHORE_PROFILE.findIndex((b) => b.height < WATER),
      [a, b] = [SHORE_PROFILE[k - 1], SHORE_PROFILE[k]],
      crossing = a.width + ((WATER - a.height) / (b.height - a.height)) * (b.width - a.width);
    assert(Math.abs(crossing - P.beach) < 0.01, `The shore profile meets the water ${crossing.toFixed(3)} out, not at TROPIC.beach.`);
    for (const bearing of plan.tropicBearings) {
      for (const width of [0, 0.32, 1.9, P.beach, 4.6, 7.2]) {
        const [x, z] = plan.tropicShorePoint(bearing, width);
        assert(Math.abs(plan.tropicAt(x, z).shore - width) < 1e-6, `The shore at bearing ${bearing.toFixed(2)} does not read back its width ${width}.`);
        if (width === P.beach) assert(Math.abs(plan.tropicDistance(x, z)) < 1e-3, 'The tropic island\'s waterline is off its ellipse.');
      }
      const beach = plan.tropicBeach(bearing);
      assert(beach >= P.rocky - 1e-9 && beach <= P.beach + 1e-9, 'The tropic island\'s beach is narrower than its rocks\' or wider than the sand\'s.');
    }
    for (const s of plan.TROPIC_ROCKY) assert(Math.abs(plan.tropicBeach(s.bearing) - P.rocky) < 1e-9 && Math.abs(plan.tropicBeach(s.bearing + s.half + s.ease + 0.01) - P.beach) < 1e-9, 'A rocky stretch is not rocky, or does not ease back to the sand.');
  }

  /* ---------------- the lawn, the terrace, the court and the paths ---------------- */
  {
    // The lawn meets the beach at its lip: tropicTop is nought at the turf's edge and beyond it.
    for (const bearing of plan.tropicBearings) {
      const [x, z] = plan.tropicShorePoint(bearing, 0),
        [ox, oz] = plan.tropicShorePoint(bearing, 1.5);
      assert(Math.abs(plan.tropicTop(x, z)) < 1e-6 && plan.tropicTop(ox, oz) === 0, `The lawn does not meet the beach at its lip at bearing ${bearing.toFixed(2)}.`);
    }
    // The terrace is level at TROPIC.pad over the podium and the court, and round them (grown by its own
    // `grow`) wherever that is not yet drawn down to the turf's lip (the podium's back corners).
    const G = plan.TROPIC_PAD;
    for (let x = B.x - B.hw - G.grow; x <= B.x + B.hw + G.grow + 1e-9; x += 0.25)
      for (let z = B.z - B.hd - G.grow; z <= B.z + B.hd + G.grow + 1e-9; z += 0.25) {
        const within = Math.abs(x - B.x) <= B.hw + 1e-9 && Math.abs(z - B.z) <= B.hd + 1e-9;
        if (within || plan.tropicAt(P.x + x, P.z + z).lawn < 0.86) assert(Math.abs(plan.tropicTop(P.x + x, P.z + z) - P.pad) < 1e-9, `The terrace is not level under the building at ${x.toFixed(2)}, ${z.toFixed(2)}.`);
      }
    for (let a = 0; a < Math.PI * 2; a += 0.2)
      for (const r of [0, Q.r / 2, Q.r + G.grow]) assert(Math.abs(plan.tropicTop(P.x + Q.x + Math.cos(a) * r, P.z + Q.z + Math.sin(a) * r) - P.pad) < 1e-9, 'The court\'s ground is not level.');
    // The podium stands well on the lawn, with turf behind it at its back corners (at most 0.88 of the
    // way to the turf's edge, about 1.5 of lawn), the court too.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) assert(plan.tropicAt(P.x + B.x + sx * B.hw, P.z + B.z + sz * B.hd).lawn <= 0.88, 'The building\'s podium stands at the lawn\'s edge.');
    for (let a = 0; a < Math.PI * 2; a += 0.2) assert(plan.tropicAt(P.x + Q.x + Math.cos(a) * Q.r, P.z + Q.z + Math.sin(a) * Q.r).lawn <= 0.7, 'The court reaches the lawn\'s edge.');
    // A gentle dome and one soft mound, nowhere steep: 1:5 at most on the mound (no one on it stands
    // visibly tilted) and 1:3 or so at most anywhere on the lawn (the terrace's bank behind the
    // building's back corners, where the lawn falls to its lip by the rocks, is the steepest: 0.31).
    let steepest = 0,
      mound = 0,
      crest = 0;
    for (let x = P.x - P.a; x <= P.x + P.a; x += 0.2)
      for (let z = P.z - P.b; z <= P.z + P.b; z += 0.2) {
        const at = plan.tropicAt(x, z);
        if (at.lawn >= 0.995) continue;
        const e = 0.02,
          slope = Math.hypot(plan.tropicTop(x + e, z) - plan.tropicTop(x - e, z), plan.tropicTop(x, z + e) - plan.tropicTop(x, z - e)) / (2 * e),
          [lx, lz] = plan.tropicLocal(x, z);
        steepest = Math.max(steepest, slope);
        if (Math.hypot(lx - M.x, lz - M.z) < M.r && at.lawn < 0.84) mound = Math.max(mound, slope);
        crest = Math.max(crest, plan.tropicTop(x, z));
      }
    assert(mound <= 0.2 && steepest <= 0.32, `The tropic island's lawn is too steep (${steepest.toFixed(2)}; on its mound ${mound.toFixed(2)}).`);
    assert(crest <= P.dome + M.h + 1e-9 && crest < TROPIC_HIT.top - 0.03, `The lawn stands ${crest.toFixed(2)} high, over its dome and mound or its pointer slab.`);
    // The court: rings each 0.22 across at least, the outermost pale, its kerb lighter, all at the
    // court's level over the terrace; the paths on the lawn, their edges 0.4 in from the turf's edge,
    // each starting under the court's paving (which lies over them).
    const radii = [TROPIC_COURT.centre, ...TROPIC_COURT.rings.map(([r]) => r)];
    for (let k = 1; k < radii.length; k++) assert(radii[k] - radii[k - 1] >= 0.22 - 1e-9, 'A ring of the court is narrower than 0.22.');
    assert(TROPIC_COURT.rings.at(-1)[1] === 0 && Q.r - radii.at(-1) >= 0.07 && TROPIC_COURT.rise > W.lift, 'The court\'s outer ring is not pale with a kerb round it, or it lies under the paths.');
    const curve = (points) => new T.CatmullRomCurve3(points.map(([x, z]) => new T.Vector3(P.x + x, 0, P.z + z)), false, 'centripetal');
    for (const [name, points] of [['south', W.south], ['front', W.front]]) {
      const c = curve(points),
        line = c.getSpacedPoints(200);
      for (const p of line)
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 6)
          assert(plan.tropicAt(p.x + Math.cos(a) * (W.width / 2 + 0.4), p.z + Math.sin(a) * (W.width / 2 + 0.4)).lawn < 1, `The ${name} walk runs within 0.4 of the lawn's edge at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}.`);
      assert(Math.hypot(line[0].x - P.x - Q.x, line[0].z - P.z - Q.z) < Q.r - W.width / 2, `The ${name} walk does not start under the court.`);
    }
  }

  /* ---------------- its groups, phases, materials and budgets ---------------- */
  assert(land.name === 'tropic-land' && land.parent === city && land.position.lengthSq() === 0, 'The tropic island\'s ground is not a group of its own in the town.');
  assert(hall && hall.root.position.equals(new T.Vector3(P.x, 0, P.z)) && hall.root.rotation.y === 0 && hall.root.name === 'building-tropic-island', 'The tropic island\'s model does not stand at its middle.');
  assert.equal(phaseNames[phaseNames.indexOf('sky rock') + 1], 'tropic ground', 'The tropic island\'s ground is not built after the sky island\'s.');
  assert.equal(phaseNames[phaseNames.indexOf('batch sky') + 1], 'batch tropic', 'The tropic island is not batched right after the sky island.');
  assert.equal(phaseNames[phaseNames.indexOf('batch sky villa') + 1], 'batch tropic building', 'The tropic island\'s building is not batched after every other building.');
  // Each held to its own limit (timed builds, above), set at the land lane (its ground and the
  // building's stand-in: 16, 6 and 6 ms at the limits' pace under a load of 30 to 70) so that one five
  // times slower fails; the island's building, garden and figure join these phases, and the limits
  // are set again for what they cost then.
  const paced = ['tropic ground', 'batch tropic', 'batch tropic building'].map((name) => [name, phaseTimes.get(name)]);
  for (const [name, limit] of [['tropic ground', 60], ['batch tropic', 25], ['batch tropic building', 25]]) inTime(`The '${name}' phase`, phaseTimes.get(name), limit);
  // Nothing of its ground in the land's batch (only its tide line, in the shore's foam).
  each(model.land, (p, o) => assert(o === foam || !plan.onTropic(p.x, p.z, 2), 'Something of the tropic island is in the land\'s batch.'));
  // Its ground: at most four meshes (the lawn's grass, the beach's sand, and stone: the paths and the
  // court, which cast nothing, and the rocks and the court's drum), every one batched with a surface
  // kind, front-sided, opaque, cutting no holes; and the island as a whole (its ground, its building
  // and whatever is joined to it: its garden and its figure) within 36 meshes and 90,000 triangles.
  let landMeshes = 0,
    landTriangles = 0;
  const kinds = new Set();
  land.traverse((o) => {
    if (!o.isMesh) return;
    landMeshes++;
    landTriangles += trianglesOf(o);
    kinds.add(o.material.userData.surfaceKind);
    assert(o.material.userData.surfaceKind && o.material.vertexColors, 'A mesh of the tropic island\'s ground has no surface kind, or is not batched.');
    assert(o.material.side !== T.DoubleSide && !o.material.transparent && o.material.opacity === 1 && !o.material.alphaTest, `${o.material.name} on the tropic island is two-sided or see-through.`);
    assert(!o.material.onBeforeCompile || !patchedShader(o.material).fragmentShader.includes('discard'), `${o.material.name} on the tropic island cuts holes.`);
    assert(o.receiveShadow, 'A mesh of the tropic island\'s ground takes no shadow.');
  });
  assert(landMeshes <= 4 && landTriangles <= 10000 && [...kinds].every((k) => ['grass', 'sand', 'stone'].includes(k)), `The tropic island's ground is ${landMeshes} meshes and ${landTriangles} triangles of ${[...kinds].join(', ')}.`);
  let islandMeshes = 0,
    islandTriangles = 0;
  for (const g of [land, hall.root])
    g.traverse((o) => {
      if (!o.isMesh) return;
      islandMeshes++;
      islandTriangles += trianglesOf(o);
    });
  assert(islandMeshes <= 36 && islandTriangles <= 90000, `The tropic island costs ${islandMeshes} meshes and ${islandTriangles} triangles, over its caps.`);
  // Its colours, each no more saturated than its family: the lawn's the town's lawn greens, the
  // concrete and its kerb the pavement's buff, the court's granite the kerb's, the rocks' greys
  // the armour's warmed a step (no more saturated than the kerb's buff, all of them greys).
  assert.deepEqual(TROPIC_LOOK.lawn, ['#98b74a', '#aac757']);
  for (const [name, colour, family] of [
    ['paving', TROPIC_LOOK.paving, palette.pavement],
    ['kerb', TROPIC_LOOK.kerb, palette.pavement],
    ...TROPIC_LOOK.court.map((c, k) => ['court ' + k, c, palette.kerb]),
    ['drum', TROPIC_LOOK.drum, palette.kerb],
    ['drum ring', TROPIC_LOOK.drumRing, palette.kerb],
    ...TROPIC_LOOK.granite.map((c, k) => ['granite ' + k, c, palette.kerb]),
  ])
    assert(hsv(colour).s <= hsv(family).s + 1e-9, `The tropic island's ${name} (${colour}) is more saturated than its family.`);
  const value = (hex) => Math.max(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));
  assert(TROPIC_LOOK.granite.every((c) => hsv(c).s < 0.15) && TROPIC_LOOK.granite.filter((c) => value(c) < 0.5).length >= 2, 'The tropic island\'s rocks are not greys, two of them dark.');
  // Its lawn is the town's (no stripes, no texture of its own) and lies on plan.tropicTop; its beach is
  // the shore's profile on its stations' rays; its rocks stand on the shore, sunk a third of their height.
  {
    const lawn = land.children.find((o) => o.isMesh && o.material.userData.surfaceKind === 'grass'),
      p = lawn.geometry.attributes.position;
    let off = 0;
    for (let i = 0; i < p.count; i++) off = Math.max(off, Math.abs(p.getY(i) - plan.tropicTop(p.getX(i), p.getZ(i))));
    assert(off < 1e-5, `The tropic island's lawn stands ${off.toFixed(4)} off plan.tropicTop.`);
  }

  /* ---------------- its shallows and the grown masks ---------------- */
  const N = MASK_SIZE,
    texel = (2 * MASK_EXTENT) / N,
    data = model.groundMasks.image.data,
    S = TROPIC_SHALLOWS,
    G = (x, z) => {
      const u = Math.min(N - 1, Math.max(0, (x / (2 * MASK_EXTENT) + 0.5) * N - 0.5)),
        w = Math.min(N - 1, Math.max(0, (z / (2 * MASK_EXTENT) + 0.5) * N - 0.5)),
        i0 = Math.floor(u),
        j0 = Math.floor(w),
        fu = u - i0,
        fw = w - j0,
        tx = (i, j) => data[(Math.min(N - 1, j) * N + Math.min(N - 1, i)) * 4 + 1] / 255;
      return (tx(i0, j0) * (1 - fu) + tx(i0 + 1, j0) * fu) * (1 - fw) + (tx(i0, j0 + 1) * (1 - fu) + tx(i0 + 1, j0 + 1) * fu) * fw;
    };
  {
    // The grid reaches past its shallows, by whole texels (the town's are where they were: the masks'
    // own block above), and its last ring of texels stays clear of them by four texels or more, so the
    // clamped edge never carries a tint out over the sea.
    assert(MASK_EXTENT >= P.z + P.b + S.width + 4 * texel, `The ground masks (to ${MASK_EXTENT}) stop short of the tropic island's shallows.`);
    let south = -Infinity;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (data[(j * N + i) * 4 + 1] > 0) south = Math.max(south, -MASK_EXTENT + (j + 0.5) * texel);
    assert(south <= MASK_EXTENT - 4 * texel && south < P.z + P.b + S.width + texel, `Shallows reach ${south.toFixed(2)}, too near the masks' edge.`);
    // Its ring: on the sand, about the main island's full tint at the waterline, nothing 0.2 past S.width
    // out; on the rocks, about the airport's at the stones' foot, nothing past S.rocky.width out.
    let sand = 0,
      sandCount = 0;
    for (const bearing of plan.tropicBearings) {
      const rocky = plan.tropicRockiness(bearing),
        [wx, wz] = plan.tropicShorePoint(bearing, P.beach),
        out = rocky === 1 ? S.rocky.width : rocky === 0 ? S.width : null;
      if (out === null) continue;
      const [fx, fz] = plan.tropicShorePoint(bearing, P.beach + out + 0.4);
      assert(G(fx, fz) < 0.02, `The tropic island's shallows reach past ${out} at bearing ${bearing.toFixed(2)} (${G(fx, fz).toFixed(3)}).`);
      if (rocky === 1) assert(Math.abs(G(wx, wz) - S.rocky.strength) < 0.15, `The tropic island's shallows by its rocks are ${G(wx, wz).toFixed(2)} at the waterline.`);
      else {
        sand += G(wx, wz);
        sandCount++;
      }
    }
    assert(sandCount > 40 && sand / sandCount > 0.9, `The tropic island's shallows on the sand are ${(sand / sandCount).toFixed(2)} at the waterline.`);
    // Its ground takes no mask shade: R, B and A are nought over its lawn and beach.
    for (let x = P.x - P.a; x <= P.x + P.a; x += 0.3)
      for (let z = P.z - P.b; z <= P.z + P.b; z += 0.3) {
        if (!plan.onTropic(x, z)) continue;
        const i = Math.floor((x + MASK_EXTENT) / texel),
          j = Math.floor((z + MASK_EXTENT) / texel);
        for (const c of [0, 2, 3]) assert.equal(data[(j * N + i) * 4 + c], 0, `The ground masks shade the tropic island (channel ${c}) at ${x.toFixed(1)}, ${z.toFixed(1)}.`);
      }
  }

  /* ---------------- setShown: all of it goes, and comes back exactly ---------------- */
  {
    const shownBytes = data.slice(),
      ring = [],
      sea = [],
      onIt = [[P.x, P.z + 3], [P.x - 6, P.z + 4], [P.x + 9, P.z]],
      pick = ([x, z]) => {
        ray.set(new T.Vector3(x, 40, z), new T.Vector3(0, -1, 0));
        return pickTarget(ray, models, model.parkHit);
      };
    assert(tropic.shown() && land.visible && hall.root.visible && foam.geometry.drawRange.count === Infinity, 'The tropic island is not shown as built.');
    for (const p of onIt) assert.equal(pick(p), 'tropic-island', `Pointing at the tropic island at ${p.join(', ')} finds ${String(pick(p))}.`);
    tropic.setShown(false);
    assert(!tropic.shown() && !land.visible && !hall.root.visible, 'Hidden, the tropic island\'s ground or its building is still drawn.');
    assert(foam.geometry.drawRange.start === 0 && foam.geometry.drawRange.count === foam.userData.tropicFoam && foam.userData.tropicFoam === foam.geometry.index.count - 2 * 6 * plan.TROPIC_SAMPLES, 'Hidden, the tropic island\'s tide line is still drawn (or the shore\'s is not).');
    for (const p of onIt) assert.equal(pick(p), null, `Hidden, the tropic island still answers the pointer at ${p.join(', ')}.`);
    // Hidden, its shallows are gone and nothing else changed: only G over the island differs from the
    // masks as shown, and there it is nought (the main island's own ring stops short of it).
    for (let k = 0; k < data.length; k++) {
      if (data[k] === shownBytes[k]) continue;
      const t = k >> 2,
        x = -MASK_EXTENT + ((t % N) + 0.5) * texel,
        z = -MASK_EXTENT + (Math.floor(t / N) + 0.5) * texel;
      assert(k % 4 === 1 && data[k] === 0 && plan.tropicDistance(x, z) < S.width + 2, 'Hiding the tropic island changes the masks elsewhere.');
      ring.push([x, z]);
    }
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) if (data[(j * N + i) * 4 + 1] > 0) sea.push([-MASK_EXTENT + (i + 0.5) * texel, -MASK_EXTENT + (j + 0.5) * texel]);
    assert(ring.length > 1000, `The tropic island's shallows are ${ring.length} texels.`);
    // Deep water between the two islands' rings: at least 3 between the island's shallows and any other's.
    let gap = Infinity;
    for (const [x, z] of ring) {
      if (plan.tropicDistance(x, z) < 0) continue;
      for (const [sx, sz] of sea) if (Math.abs(sx - x) < 8 && Math.abs(sz - z) < 8) gap = Math.min(gap, Math.hypot(sx - x, sz - z));
    }
    assert(gap >= 3, `Only ${gap.toFixed(2)} of deep water between the tropic island's shallows and the town's.`);
    tropic.setShown(true);
    assert(tropic.shown() && land.visible && hall.root.visible && foam.geometry.drawRange.count === Infinity, 'Shown again, the tropic island is not all back.');
    for (let k = 0; k < data.length; k++) if (data[k] !== shownBytes[k]) assert.fail('Shown again, the tropic island\'s shallows are not as they were.');
    for (const p of onIt) assert.equal(pick(p), 'tropic-island', 'Shown again, the tropic island does not answer the pointer.');
    // A group joined to it goes and comes with it, joined while hidden or shown.
    const extra = new T.Group();
    tropic.setShown(false);
    tropic.join(extra);
    assert(!extra.visible, 'A group joined to the hidden tropic island is shown.');
    tropic.setShown(true);
    assert(extra.visible, 'A group joined to the tropic island does not come back with it.');
    tropicReport += `, its shallows ${ring.length} texels (${gap.toFixed(1)} of deep water from the town's)`;
  }

  /* ---------------- TROPIC_EXTENT bounds what of it can be on screen ---------------- */
  // Every point of its ground (its shelf under the water too) and its building lies inside the ring the
  // extent draws at the water's level and under its highest point; that ring holds its shallows too.
  {
    const waterRing = TROPIC_EXTENT.filter((p) => p.y === WATER).map((p) => [p.x, p.z]),
      top = Math.max(...TROPIC_EXTENT.map((p) => p.y)),
      within = ([x, z]) => {
        let into = false;
        for (let i = 0, j = waterRing.length - 1; i < waterRing.length; j = i++) {
          const [xi, zi] = waterRing[i],
            [xj, zj] = waterRing[j];
          if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) into = !into;
        }
        return into;
      };
    let outside = 0,
      highest = -Infinity;
    for (const g of [land, hall.root])
      each(g, (p) => {
        if (!within([p.x, p.z])) outside++;
        highest = Math.max(highest, p.y);
      });
    assert(waterRing.length >= 16 && outside === 0 && highest <= top, `TROPIC_EXTENT does not hold the tropic island (${outside} points outside it, its top ${highest.toFixed(2)} under ${top}).`);
    let shallows = 0;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) if (data[(j * N + i) * 4 + 1] > 0 && plan.tropicDistance(-MASK_EXTENT + (i + 0.5) * texel, -MASK_EXTENT + (j + 0.5) * texel) < 6 && !within([-MASK_EXTENT + (i + 0.5) * texel, -MASK_EXTENT + (j + 0.5) * texel])) shallows++;
    assert.equal(shallows, 0, 'The tropic island\'s shallows reach out of TROPIC_EXTENT.');
  }

  /* ---------------- the pointer ---------------- */
  // Its ground is the tropic island's: from the four Rotate stops and its file's bearing, a ray onto its
  // lawn, its paths, its court or its beach finds it; the open sea 1.5 past its waterline does not.
  {
    let found = 0;
    for (const bearing of [...stops, file]) {
      const back = backOf(bearing);
      for (const [k, bearingOn] of plan.tropicBearings.entries()) {
        if (k % 4) continue;
        for (const width of [-4, 1.2]) {
          const [x, z] = width < 0 ? (([ex, ez]) => [P.x + (ex - P.x) * 0.6, P.z + (ez - P.z) * 0.6])(plan.tropicShorePoint(bearingOn, 0)) : plan.tropicShorePoint(bearingOn, width),
            y = width < 0 ? plan.tropicTop(x, z) : 0;
          ray.set(new T.Vector3(x, y, z).addScaledVector(back, 80), back.clone().negate());
          // (Something of the town in front of it on that ray would rightly answer instead.)
          const first = ray.intersectObjects([...[...models.values()].map((m) => m.root), land], true)[0];
          if (first && first.point.distanceTo(new T.Vector3(x, y, z)) > 0.6) continue;
          assert.equal(pickTarget(ray, models, model.parkHit), 'tropic-island', `Pointing at the tropic island at ${x.toFixed(2)}, ${z.toFixed(2)} from bearing ${bearing.toFixed(2)} finds no tropic island.`);
          found++;
        }
      }
      for (const p of plan.tropicOutline(1.5, 24)) {
        ray.set(new T.Vector3(p.x, WATER, p.z).addScaledVector(back, 80), back.clone().negate());
        // Unless the island itself stands in front of that bit of sea on screen.
        const first = ray.intersectObjects([hall.root, land], true)[0];
        if (first) continue;
        assert.notEqual(pickTarget(ray, models, model.parkHit), 'tropic-island', `Pointing at the sea at ${p.x.toFixed(2)}, ${p.z.toFixed(2)} from bearing ${bearing.toFixed(2)} finds the tropic island.`);
      }
    }
    assert(found > 100, `The pointer found the tropic island at only ${found} points.`);
  }

  /* ---------------- its building's slot and its night ---------------- */
  {
    // The building (the SDE4's slot: the stand-in until the merge) stands in its footprint on the
    // terrace, under its top, in the island's own frame; every pane of it lit by the 'campus' role
    // (a role of its own, outside the rooms' shares), a few of them out by 02:30.
    const box = new T.Box3().setFromObject(hall.shell);
    assert(box.min.x >= P.x + B.x - B.hw - 1e-3 && box.max.x <= P.x + B.x + B.hw + 1e-3 && box.min.z >= P.z + B.z - B.hd - 1e-3 && box.max.z <= P.z + B.z + B.hd + 1e-3 && box.max.y <= B.top + 1e-3 && box.min.y >= P.pad - 0.1, `The tropic island's building leaves its footprint: ${box.min.toArray().map((n) => n.toFixed(2)).join(', ')} to ${box.max.toArray().map((n) => n.toFixed(2)).join(', ')}.`);
    const own = model.windows.filter((p) => p.place === 'tropic-island'),
      level = (p, h) => windowLevel(p.light, windowClock(h));
    assert(own.length >= 8 && own.every((p) => p.role === 'campus'), `The tropic island's building has ${own.length} panes, not all of them 'campus'.`);
    const evening = own.filter((p) => level(p, 20) > 0.1).length,
      late = own.filter((p) => level(p, 2.5) > 0.1).length;
    assert(evening >= 0.5 * own.length && late < evening, `${evening} of the tropic island's ${own.length} panes are lit at 20:00 and ${late} at 02:30.`);
    tropicReport += `, its building's slot ${own.length} panes (${evening} lit at 20:00, ${late} at 02:30)`;
  }

  /* ---------------- clearances: the town's shore and everything that moves ---------------- */
  {
    // The island as points: its waterline, and what of its ground and its building stands out of the
    // water (a share of their vertices: the rocks reach a little past the waterline; the beach's shelf
    // runs on under the sea).
    const body = plan.tropicOutline(0, 240).map((p) => new T.Vector3(p.x, WATER, p.z));
    let k = 0;
    for (const g of [land, hall.root]) each(g, (p) => p.y >= WATER && k++ % 9 === 0 && body.push(p.clone()));
    const flat2 = (x, z) => {
        let best = Infinity;
        for (const p of body) best = Math.min(best, Math.hypot(p.x - x, p.z - z));
        return best;
      },
      nearest = (x, y, z) => {
        let best = Infinity;
        for (const p of body) best = Math.min(best, Math.hypot(p.x - x, p.y - y, p.z - z));
        return best;
      };
    // The town's waterline (its outline 3.3 out): 11.5 of open water at least (12 at the placement's Q1).
    let coast = Infinity;
    for (const p of plan.tropicOutline(0, 240)) coast = Math.min(coast, plan.distanceToPolyline([p.x, p.z], plan.islandOutline, true) - 3.3);
    assert(coast >= 11.5, `The tropic island is ${coast.toFixed(1)} from the town's waterline.`);
    // The lighthouse beam: an 18-long cone 3.6 round at its end from the lantern, so nothing within its
    // slant (18.36) of the lantern is ever out of its reach; the island keeps 2 beyond that.
    const [rockX, rockZ] = plan.lighthouseRock,
      slant = Math.hypot(18, 3.6);
    const beamGap = Math.min(...body.map((p) => Math.hypot(p.x - rockX, p.z - rockZ))) - slant;
    assert(beamGap >= 2, `The lighthouse beam comes within ${beamGap.toFixed(2)} of the tropic island.`);
    // The boat's loop (its hull's middle, less half its length and a little), the gulls, the balloon's
    // lap turned with the idle drift about each view's middle (the plaza, the shadows' home, the airport,
    // the sky island and this island) and the plane's whole visible loop.
    const { createGulls } = await load('city-atmosphere'),
      birds = createGulls(),
      gaps = { boat: Infinity, gulls: Infinity, balloon: Infinity, plane: Infinity },
      centres = [[0, 0], [-3.5, -13.5], [plan.AIRPORT.x, plan.AIRPORT.z], [plan.SKY.x, plan.SKY.z], [P.x, P.z]];
    for (let t = 0; t < 900; t += 1.5) {
      const boat = plan.boatPose(t);
      gaps.boat = Math.min(gaps.boat, flat2(boat.x, boat.z) - 2.1);
      birds.update(t, 1);
      for (const g of birds.object.children) gaps.gulls = Math.min(gaps.gulls, nearest(g.position.x, g.position.y, g.position.z));
      balloon.update(t, 0);
      const b = balloon.object.position;
      for (const [cx, cz] of centres)
        for (const drift of [-0.16, 0, 0.16]) {
          const c = Math.cos(drift),
            s = Math.sin(drift),
            x = cx + (b.x - cx) * c + (b.z - cz) * s,
            z = cz - (b.x - cx) * s + (b.z - cz) * c;
          for (const y of [b.y, b.y + 1.7, b.y + 3.4, b.y + 5.06]) gaps.balloon = Math.min(gaps.balloon, nearest(x, y, z) - 1.6);
        }
    }
    balloon.update(0, 0);
    birds.dispose();
    for (let t = 0; t < plan.PLANE_LOOP; t += 0.5) {
      const p = plan.planePose(t);
      if (p.visible) gaps.plane = Math.min(gaps.plane, nearest(p.x, p.y + plan.PLANE.axis, p.z));
    }
    for (const [name, least] of Object.entries({ boat: 5, gulls: 10, balloon: 24, plane: 30 }))
      assert(gaps[name] >= least, `The ${name} comes within ${gaps[name].toFixed(1)} of the tropic island (${least} at least).`);
    tropicReport = `the tropic island off the south shore (its ground ${landMeshes} meshes and ${landTriangles} triangles, the island ${islandMeshes} and ${islandTriangles} so far; ${coast.toFixed(1)} of open water from the town's waterline, the lighthouse beam ${beamGap.toFixed(1)} clear, the boat ${gaps.boat.toFixed(1)}, the gulls ${gaps.gulls.toFixed(1)}, the balloon ${gaps.balloon.toFixed(1)}, the plane ${gaps.plane.toFixed(1)}${tropicReport}; its phases ${paced.map(([n, t]) => `${n} ${Math.round(t.paced)}`).join(', ')} ms at the limits' pace)`;
  }
}
console.log(
  `Town checks passed: 11 sites (8 on the island, the airport on its own island off the north shore, with its road, causeway, Departures Hall, hangar and a plane on its stand, the sky island off the north-west headland: ${skyReport}, and ${tropicReport}), ${districts.length} plan districts above the paving around their places, ${trees.length} trees off the streets, a boat that stays afloat, ${meshes} meshes / ${Math.round(triangles)} triangles built in ${Math.round(ms)} ms (or in ${phaseNames.length + 1} phases of at most ${Math.round(longestPhase)} ms), one shell per building with a fitted close-up, clickable buildings that answer for what the pointer is on, open sea, a lighthouse beam that stays over it, windows lit pane by pane that go out one at a time through the night, a balloon out over the shore, traffic signals in the UK sequence that the tram and the cyclist stop for at red and go on at green, trees that keep the season and a low golden-hour sun.`,
);
