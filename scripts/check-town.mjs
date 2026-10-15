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
const { buildCityModel, pairMovingParts, followMovingParts, addHitBoxes, pickTarget } = await load('city-scene');
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
  // The drying net: gathered swags of solid netting, so it batches with the other cloth. Nothing on
  // the land is two-sided (that costs a program of its own) or cuts holes (cut-out mesh twinkles
  // once under a pixel), and the net is there: heaped over the bar, casting nothing.
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
  for (const id of plan.chapterSubjects.people) {
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
  rooms = panes.filter((p) => ['home', 'civic', 'studio'].includes(p.role)),
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
// The people are batched part by part (9 or 10 meshes each, the satchel's wood making the
// difference: each limb is one mesh, its shoe or hand matte like it). The dog walker is one more of them; the dog is four meshes (its body, the only
// part that casts, its legs, its head and its tail) and keeps its pivots apart from its body.
{
  const meshesIn = (o) => {
    let n = 0;
    o.traverse((c) => (n += c.isMesh ? 1 : 0));
    return n;
  };
  for (const w of walkers) assert([9, 10].includes(meshesIn(w.root)), `A walker is ${meshesIn(w.root)} meshes`);
  const dogWalk = model.animated.find((e) => e.object.name === 'dog-walk');
  assert(dogWalk && dogWalk.object.userData.prebatched, 'The dog walk is batched with the people.');
  const [figure, dog] = dogWalk.object.children;
  assert.equal(dog.name, 'dog');
  assert([9, 10].includes(meshesIn(figure)), `The dog walker is ${meshesIn(figure)} meshes`);
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
  assert.equal(meshesIn(cyclist.object), 8, `The cyclist is ${meshesIn(cyclist.object)} meshes`);
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
  assert.equal(trees.length, 82, 'The birches and rowans change no tree count.');
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
console.log(
  `Town checks passed: 7 sites on the island, ${districts.length} plan districts above the paving around their places, ${trees.length} trees off the streets, a boat that stays afloat, ${meshes} meshes / ${Math.round(triangles)} triangles built in ${Math.round(ms)} ms (or in ${phaseNames.length + 1} phases of at most ${Math.round(longestPhase)} ms), one shell per building with a fitted close-up, clickable buildings that answer for what the pointer is on, open sea, a lighthouse beam that stays over it, windows lit pane by pane that go out one at a time through the night, a balloon out over the shore, traffic signals in the UK sequence that the tram and the cyclist stop for at red and go on at green, trees that keep the season and a low golden-hour sun.`,
);
