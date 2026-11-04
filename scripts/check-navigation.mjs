import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as T from 'three';
import { runInNewContext } from 'node:vm';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  output = path.join(root, 'work', 'navigation-check');
await fs.mkdir(output, { recursive: true });
await fs.copyFile(
  path.join(root, 'content/lab.json'),
  path.join(output, 'lab.json'),
);
for (const name of [
  'content-schema',
  'lab-records',
  'city-inspection',
  'city-ink',
  'city-materials',
  'city-data',
  'city-water',
  'lab-navigation',
  'people-photos',
  'glasgow-sun',
  'town-plan',
]) {
  const source = await fs.readFile(
    path.join(root, 'app', name + '.ts'),
    'utf8',
  );
  const result = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    })
    .outputText.replace(/(['"])\.\/([\w-]+)\1/g, "'./$2.mjs'")
    .replace("'../content/lab.json'", "'./lab.json'")
    .replace(/(['"])\.\/(city-data)\1/g, "'./$2.mjs'");
  await fs.writeFile(path.join(output, name + '.mjs'), result);
}
const nav = await import(
    pathToFileURL(path.join(output, 'lab-navigation.mjs')).href
  ),
  { buildings } = await import(
    pathToFileURL(path.join(output, 'city-data.mjs')).href
  ),
  { personPhotos } = await import(
    pathToFileURL(path.join(output, 'people-photos.mjs')).href
  );
const ids = [
  'overview',
  'people',
  'corner-park',
  ...buildings.map((b) => b.id),
];
for (const content of ids) {
  for (const [prefix, mode] of [
    ['city', 'city'],
    ['read', 'reading'],
  ]) {
    const resolved = nav.parseLocation(`#${prefix}/${content}`);
    assert.deepEqual(resolved, { mode, content });
    assert(
      nav.readingChapters.includes(nav.chapterFor(content)),
      'Every city destination must resolve to a reading chapter.',
    );
    for (const locale of ['en', 'zh'])
      assert(nav.titleFor(resolved.content, locale));
  }
  const city = nav.parseLocation(`#city/${content}`),
    reading = nav.parseLocation(`#read/${city.content}`),
    back = nav.parseLocation(`#city/${reading.content}`);
  assert.deepEqual(
    back,
    city,
    'Changing modes must preserve the selected record.',
  );
}
// The City tour visits every place once, in the Directory's order, and ends in the park.
assert.deepEqual(nav.tourStops, [
  ...buildings.map((b) => nav.contentForBuilding(b.id)),
  'corner-park',
]);
assert.equal(new Set(nav.tourStops).size, nav.tourStops.length);
// Ten stops: the gate, the hall, the three homes, the residence, then the airport, the studio, the
// archive and the park.
assert.equal(nav.tourStops.length, 10);
assert.deepEqual(
  nav.tourStops.slice(5),
  ['visiting-phd', 'airport', 'research-studio', 'city-archive', 'corner-park'],
);
// The reading page's chapters: Departures (the airport's) comes right after People, as chapter 03,
// and the overview's list of places names it there too.
assert.deepEqual(nav.readingChapters, [
  'town-hall',
  'people',
  'airport',
  'research-studio',
  'city-archive',
  'corner-park',
  'lius-gate',
]);
assert.deepEqual(nav.destinations, nav.readingChapters.slice(0, -1));
// Its address frames the airport: the chapter, the camera's subject and the file's place.
assert.equal(nav.chapterFor('airport'), 'airport');
assert.equal(nav.readingChapter('airport'), 'airport');
assert.deepEqual(nav.sceneTarget('airport'), { building: 'airport' });
assert.deepEqual(nav.selectionForContent('airport'), ['airport']);
assert.equal(nav.placeFor('airport'), 'airport');
// A City file's eyebrow names the place the camera frames, an event's park included.
const { eventRecords, peopleRecords, personContentId } = await import(
  pathToFileURL(path.join(output, 'lab-records.mjs')).href
);
assert(eventRecords.length, 'The place check needs an event to open.');
for (const event of eventRecords)
  assert.equal(
    nav.placeFor('event:' + event.id),
    'corner-park',
    `The event ${event.id} is filed under the corner park, where the camera goes.`,
  );
for (const b of buildings) assert.equal(nav.placeFor(nav.contentForBuilding(b.id)), b.id);
assert.equal(nav.placeFor('people'), 'people');
assert.equal(nav.placeFor('corner-park'), 'corner-park');
assert.equal(nav.placeFor('overview'), null);
// Everyone published reads in People while they are here, and in Departures once they have left,
// their camera on the airport whatever home their record names (check-content tries test leavers).
for (const p of peopleRecords) {
  const id = personContentId(p),
    gone = nav.departedOn(id);
  assert.equal(nav.chapterFor(id), gone ? 'airport' : 'people', id + ' is in the wrong chapter.');
  if (gone) assert.deepEqual(nav.sceneTarget(id), { building: 'airport' }, id + ' has left: the camera goes to the airport.');
  assert.equal(nav.facingChapter(id), gone ? 'airport' : 'people', id + ' is faced from the wrong chapter.');
}
// City mode faces each place from its chapter's bearing: a home or the residence from People's,
// whoever lives there (check-content tries the home a founding member has left), every other
// building from its own chapter's, the People file and the park from theirs.
for (const b of buildings)
  for (const id of [nav.contentForBuilding(b.id), 'place:' + b.id])
    assert.equal(nav.facingChapter(id), b.variant || b.model === 'residence' ? 'people' : b.id, `City mode faces ${id} from the wrong chapter.`);
assert.deepEqual(['people', 'corner-park', 'overview'].map((id) => nav.facingChapter(id)), ['people', 'corner-park', 'town-hall']);
assert(
  /const facing = \(id: ContentId\) => bearings\[facingChapter\(id\)\] \?\? bearings\.overview;/.test(
    await fs.readFile(path.join(root, 'app/page.tsx'), 'utf8'),
  ),
  'City mode no longer turns to the chapter of the place it frames (facingChapter).',
);
for (const stop of nav.tourStops)
  assert.deepEqual(nav.parseLocation(`#city/${stop}`), { mode: 'city', content: stop });
for (const [old, content] of Object.entries({
  about: 'town-hall',
  people: 'people',
  research: 'research-studio',
  publications: 'city-archive',
  'lab-life': 'corner-park',
}))
  assert.deepEqual(nav.parseLocation('#' + old), { mode: 'reading', content });
for (const hash of [
  '',
  '#unknown',
  '#constructor',
  '#toString',
  '#__proto__',
  '#city/missing',
])
  assert.deepEqual(nav.parseLocation(hash), {
    mode: 'city',
    content: 'overview',
  });
// A reading address that names nothing (a renamed record, a bare #read) stays on the page.
for (const hash of [
  '#read',
  '#read/',
  '#read/constructor',
  '#read/__proto__',
  '#read/research:renamed-project',
  '#read/person:missing',
])
  assert.deepEqual(nav.parseLocation(hash), {
    mode: 'reading',
    content: 'overview',
  });
// The reading page: every chapter is its own address, and the hero's overview is not About,
// so scrolling from the hero into About frames the Town Hall, as Read and #read/town-hall do.
for (const chapter of ['overview', ...nav.readingChapters])
  assert.equal(nav.readingChapter(chapter), chapter);
assert.equal(nav.readingContent('overview', 'town-hall'), 'town-hall');
assert.equal(nav.readingContent('town-hall', 'overview'), 'overview');
assert.equal(nav.readingContent('overview', 'overview'), 'overview');
for (const person of nav.people) {
  assert.equal(nav.readingContent(person.id, 'people'), person.id, 'A person stays shown in People.');
  assert.equal(nav.readingContent(person.id, 'research-studio'), 'research-studio');
}
assert.notEqual(
  nav.parseLocation('#city/lius-gate').content,
  nav.parseLocation('#city/town-hall').content,
  'The gate story and lab introduction must stay distinct.',
);
// Every published person has a portrait slot, including anyone who has left (their file still
// opens). The People chapter (nav.people) shows only the members on the visitor's day.
assert.deepEqual(
  Object.keys(personPhotos).sort((a, b) => a.localeCompare(b)),
  peopleRecords.map(personContentId).sort((a, b) => a.localeCompare(b)),
);
assert(nav.people.every((p) => Object.hasOwn(personPhotos, p.id)));
for (const url of Object.values(personPhotos))
  if (url !== null) {
    assert(/^\/people\/[^/]+\.(jpg|jpeg|png|webp)$/i.test(url));
    await fs.access(path.join(root, 'public', url.slice(1)));
  }
// Run the real resize implementation through hidden -> visible -> hidden transitions.
const source = await fs.readFile(
    path.join(root, 'app', 'city-scene.ts'),
    'utf8',
  ),
  syntax = ts.createSourceFile(
    'scene.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  );
let resizeSource;
function find(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'resize')
    resizeSource = node.getText(syntax);
  ts.forEachChild(node, find);
}
find(syntax);
assert(resizeSource);
const camera = new T.OrthographicCamera(-24, 24, 24, -24, 0.1, 180),
  sizes = [],
  context = {
    container: { clientWidth: 0, clientHeight: 0 },
    width: 1,
    height: 1,
    camera,
    Math,
    ink: { resize() {} },
    autoFocus: false,
    renderer: {
      setSize(w, h) {
        sizes.push([w, h]);
      },
    },
  };
const compiled = ts.transpileModule(resizeSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const resize = runInNewContext(`${compiled};resize;`, context);
for (const [w, h] of [
  [0, 0],
  [960, 600],
  [0, 0],
  [360, 460],
  [0, 0],
  [1100, 720],
]) {
  context.container.clientWidth = w;
  context.container.clientHeight = h;
  resize();
  assert(camera.projectionMatrix.elements.every(Number.isFinite));
}
assert.deepEqual(
  sizes,
  [
    [960, 600],
    [360, 460],
    [1100, 720],
  ],
  'Hidden canvases must not invalidate their last camera frame.',
);
// A new framing carries its panel offset from the start, so one that also turns the camera
// (each reading chapter has its own bearing) glides: the first turning frame moves the view
// centre only by the offset's own turn, never sideways by the whole offset at once.
const turnPieces = [];
function collectTurn(node) {
  if (
    ts.isFunctionDeclaration(node) &&
    ['viewOffset', 'panelOffset', 'offsetTarget', 'followPanel', 'reset'].includes(
      node.name?.text,
    )
  )
    turnPieces.push(node.getText(syntax));
  if (
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((d) =>
      ['shortestAngle', 'YAW_RATE'].includes(d.name.getText(syntax)),
    )
  )
    turnPieces.push(node.getText(syntax));
  if (
    ts.isIfStatement(node) &&
    node.expression.getText(syntax) === 'Math.abs(targetYaw - yaw) > 0.0001'
  )
    turnPieces.push(`function turnStep() { ${node.getText(syntax)} }`);
  ts.forEachChild(node, collectTurn);
}
collectTurn(syntax);
assert.equal(turnPieces.length, 8, 'The turn check must find every piece it runs.');
const turn = {
  T,
  Math,
  camera: new T.OrthographicCamera(-44, 44, 26, -26, 0.1, 180),
  screenRight: new T.Vector3(),
  screenUp: new T.Vector3(),
  shiftApplied: new T.Vector3(),
  target: new T.Vector3(),
  controls: { target: new T.Vector3() },
  frameShift: 0.21,
  frameDrop: 0.15,
  yaw: 1.9,
  targetYaw: 1.9,
  targetZoom: 2.2,
  reduced: false,
  dt: 1 / 60,
  tween: false,
  focusedIds: [],
  parkSelected: false,
  autoFocus: false,
  overviewFit: false,
  exitInspection() {},
  align() {},
};
const turning = runInNewContext(
  `${ts.transpileModule(turnPieces.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};({ panelOffset, offsetTarget, followPanel, reset, turnStep });`,
  turn,
);
// At rest on a close subject (the park shot), beside the panel.
turn.target.set(18, 0, -12);
turning.offsetTarget();
turn.controls.target.copy(turn.target);
// Back to the island (zoom 1) and to the overview's bearing: a re-frame that turns.
turning.reset();
assert(
  turn.target.clone().sub(turn.shiftApplied).length() < 1e-9,
  'A framing keeps its subject, less the offset, as its target.',
);
assert(
  turn.shiftApplied.distanceTo(turning.panelOffset(new T.Vector3())) < 1e-9,
  'A framing carries the panel offset for its own zoom.',
);
const centre = turn.controls.target.clone(),
  offsetLength = turn.shiftApplied.length(),
  bearing = turn.yaw;
turning.turnStep();
const turned = Math.abs(turn.yaw - bearing),
  moved = turn.controls.target.distanceTo(centre);
assert(turned > 0, 'The check must run a turning frame.');
assert(
  moved <= offsetLength * turned + 1e-9,
  `A turning frame moved the view centre ${moved.toFixed(2)} (offset ${offsetLength.toFixed(2)}): a sideways jump.`,
);
// An offset changed outside a framing while the camera turns (the file closed mid-turn on a
// park shot; the reading page back at the hero, whose shift is set after its reset) glides
// too: the frame loop moves the target by the change before the turning frame.
let stepSource;
function findStep(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'step')
    stepSource = node.body.getText(syntax);
  ts.forEachChild(node, findStep);
}
findStep(syntax);
assert(stepSource, 'The panel check must find the frame loop.');
const followAt = stepSource.indexOf('followPanel();'),
  turnAt = stepSource.indexOf('Math.abs(targetYaw - yaw) > 0.0001');
assert(
  followAt >= 0 && followAt < turnAt,
  'The frame loop must follow the panel offset before it turns the camera.',
);
for (const [from, to, bearing] of [
  [0.21, 0, -0.35],
  [0.21, -0.06, 0.9],
]) {
  Object.assign(turn, { yaw: bearing, targetYaw: bearing, targetZoom: 2.2, frameShift: from, tween: false });
  turn.target.set(18, 0, -12);
  turning.offsetTarget();
  turn.controls.target.copy(turn.target);
  const subjectThere = turn.target.clone().sub(turn.shiftApplied);
  turn.targetYaw = bearing - 0.4;
  turn.frameShift = to;
  const before = turn.controls.target.clone(),
    was = turn.yaw;
  turning.followPanel();
  assert(turn.tween, 'A changed panel offset glides.');
  assert(
    turn.target.clone().sub(turn.shiftApplied).distanceTo(subjectThere) < 1e-9,
    'The glide keeps its subject.',
  );
  turning.turnStep();
  const step = turn.controls.target.distanceTo(before);
  assert(
    step <= turn.shiftApplied.length() * Math.abs(turn.yaw - was) + 1e-9,
    `A turning frame put a panel offset change of ${(Math.abs(to - from) * 88 / 2.2).toFixed(1)} on the view centre at once (moved ${step.toFixed(2)}).`,
  );
}
turn.frameShift = 0.21;
// Rotate pressed quickly keeps turning the button's way: three presses 0.3 s apart end three
// quarter turns round, never swinging back the short way; a burst queues one turn at most.
let rotateSource;
function findRotate(node) {
  if (ts.isMethodDeclaration(node) && node.name.getText(syntax) === 'rotate')
    rotateSource = `function rotate() ${node.body.getText(syntax)}`;
  ts.forEachChild(node, findRotate);
}
findRotate(syntax);
assert(rotateSource, 'The rotate check must find the Rotate button’s method.');
Object.assign(turn, {
  performance: { now: () => 0 },
  inspectionAutoFit: false,
  fitOverview() {},
  lastInteraction: 0,
});
const rotateNow = runInNewContext(
  `${ts.transpileModule(rotateSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};rotate;`,
  turn,
);
turning.turnStep();
for (let frame = 0; frame < 600 && Math.abs(turn.targetYaw - turn.yaw) > 0.0001; frame++)
  turning.turnStep();
const startBearing = turn.yaw;
for (let frame = 0; frame < 900; frame++) {
  if (frame % 18 === 0 && frame <= 36) rotateNow();
  const was = turn.yaw;
  turning.turnStep();
  assert(turn.yaw >= was - 1e-12, `Quick Rotate presses turned the camera back at frame ${frame}.`);
}
assert(
  Math.abs(turn.yaw - startBearing - (3 * Math.PI) / 2) < 1e-6,
  'Three Rotate presses end three quarter turns round.',
);
for (let press = 0; press < 8; press++) rotateNow();
assert(
  turn.targetYaw - turn.yaw <= Math.PI * 2 + 1e-6,
  'A burst of Rotate presses queues one full turn at most.',
);
// The +/- buttons during a glide: the glide still lands on its subject, and quick presses add up.
let zoomSource, glideSource;
function findZoom(node) {
  if (ts.isMethodDeclaration(node) && node.name.getText(syntax) === 'zoom')
    zoomSource = `function zoomBy(f) ${node.body.getText(syntax)}`;
  if (
    ts.isIfStatement(node) &&
    node.expression.getText(syntax) === 'tween' &&
    node.thenStatement.getText(syntax).includes('controls.target.lerp')
  )
    glideSource = `function glideStep() { ${node.getText(syntax)} }`;
  ts.forEachChild(node, findZoom);
}
findZoom(syntax);
assert(zoomSource && glideSource, 'The zoom check must find the zoom method and the glide.');
Object.assign(turn, {
  CITY_MAX_ZOOM: 4,
  STUDY_MAX_ZOOM: 8,
  inspect: null,
  blend: 1 - Math.exp(-5.5 / 60),
});
turn.controls.minZoom = 0.5;
const zooming = runInNewContext(
  `${ts.transpileModule(`${zoomSource}\n${glideSource}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};({ zoomBy, glideStep });`,
  turn,
);
const settleGlide = () => {
  for (let frame = 0; frame < 600 && turn.tween; frame++) zooming.glideStep();
};
// Three presses of + 150 ms apart from rest at zoom 1: three steps of 1.25.
turn.yaw = turn.targetYaw = Math.PI / 4;
turn.camera.zoom = turn.targetZoom = 1;
turn.target.set(0, 0, 0);
turning.offsetTarget();
turn.controls.target.copy(turn.target);
turn.tween = false;
for (let press = 0; press < 3; press++) {
  zooming.zoomBy(1.25);
  for (let frame = 0; frame < 9; frame++) zooming.glideStep();
}
settleGlide();
assert(
  Math.abs(turn.camera.zoom - 1.25 ** 3) < 0.01,
  `Three quick presses of + zoomed to ${turn.camera.zoom.toFixed(2)}, not ${(1.25 ** 3).toFixed(2)}.`,
);
// A pick's glide to a subject, with + pressed a few frames in: it still ends on the subject.
const subject = new T.Vector3(14, 0, -9);
turn.targetZoom = 2.4;
turn.target.copy(subject);
turning.offsetTarget();
turn.tween = true;
for (let frame = 0; frame < 4; frame++) zooming.glideStep();
zooming.zoomBy(1.25);
settleGlide();
assert(
  turn.controls.target.clone().sub(turn.shiftApplied).distanceTo(subject) < 0.01,
  'Zooming during a glide must not leave the picked place off-centre.',
);
assert(Math.abs(turn.camera.zoom - 3) < 0.01, 'The zoom builds on the glide’s own zoom.');
// Idle drift turns the camera only for visitors who have not asked for reduced motion.
const driftPieces = [];
function collectDrift(node) {
  if (
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((d) =>
      ['idle', 'driftTarget', 'nextDrift'].includes(d.name.getText(syntax)),
    )
  )
    driftPieces.push(node.getText(syntax));
  ts.forEachChild(node, collectDrift);
}
collectDrift(syntax);
assert.equal(driftPieces.length, 3, 'The drift check must find every piece it runs.');
const driftAt = (reduced, state = {}) =>
  runInNewContext(
    `${ts.transpileModule(`function nextAngle() { ${driftPieces.join('\n')} return nextDrift; }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};nextAngle();`,
    {
      Math,
      reduced,
      drift: true,
      inspect: null,
      hover: { dragging: false },
      paused: false,
      now: 60000,
      lastInteraction: -1e9,
      time: 20,
      driftAngle: 0,
      blend: 1,
      ...state,
    },
  );
assert(Math.abs(driftAt(false)) > 0.01, 'The check must see the drift turn the camera.');
assert.equal(driftAt(true), 0, 'With reduced motion the camera must not drift.');
// The drift stops where it is when the visitor acts: Pause, a drag or a button just pressed.
// Turning back to the bearing would keep the town moving after Pause and turn it under a drag.
const swayed = 0.15;
for (const [action, state] of Object.entries({
  Pause: { paused: true },
  'A drag': { hover: { dragging: true } },
  'A button just pressed': { lastInteraction: 59000 },
}))
  assert.equal(driftAt(false, { ...state, driftAngle: swayed }), swayed, `${action} turned the drifted camera.`);
assert(
  driftAt(false, { inspect: {}, driftAngle: swayed }) < swayed - 0.01,
  'Inspect eases the drift back to the building’s own bearing.',
);
// The motion preference is followed while the page is open, not read once at load: switched, the
// scene's flag follows it (the plane's hold, the turns' cut and the drift read it every frame) and
// its listener goes with the scene; the page pauses the town or lets it go with it, unless the
// visitor has pressed Pause or Play.
{
  const motionPieces = [];
  (function collectMotion(node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => ['motionQuery', 'reduced', 'followMotion'].includes(d.name.getText(syntax))))
      motionPieces.push(node.getText(syntax));
    if (ts.isExpressionStatement(node) && node.getText(syntax) === "motionQuery.addEventListener('change', followMotion);")
      motionPieces.push(node.getText(syntax));
    ts.forEachChild(node, collectMotion);
  })(syntax);
  assert.equal(motionPieces.length, 4, 'The motion check must find every piece it runs.');
  const listeners = new Set(),
    query = { matches: true, addEventListener: (type, f) => type === 'change' && listeners.add(f) },
    motion = runInNewContext(
      `${ts.transpileModule(motionPieces.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};({ get reduced() { return reduced; } });`,
      { window: { matchMedia: (q) => (q === '(prefers-reduced-motion: reduce)' ? query : null) } },
    );
  assert.equal(motion.reduced, true, 'The scene does not start from the visitor’s motion preference.');
  query.matches = false;
  listeners.forEach((f) => f());
  assert.equal(motion.reduced, false, 'Reduce Motion switched off while the page is open keeps the plane on its stand and the turns cut.');
  query.matches = true;
  listeners.forEach((f) => f());
  assert.equal(motion.reduced, true, 'Reduce Motion switched on while the page is open leaves the plane flying.');
  assert(/planeTime = planeClock\(planeTime, dt, paused \|\| reduced\);/.test(source) && /motionQuery\.removeEventListener\('change', followMotion\);/.test(source), 'The plane no longer parks for the motion preference, or the scene leaves its listener behind.');
  assert(
    /const media = window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\),\s*follow = \(event: MediaQueryListEvent\) => \{\s*if \(!pauseChosen\.current\) setPaused\(event\.matches\);\s*\};\s*media\.addEventListener\('change', follow\);\s*return \(\) => media\.removeEventListener\('change', follow\);/.test(
      await fs.readFile(path.join(root, 'app/page.tsx'), 'utf8'),
    ),
    'The page no longer pauses the town, or lets it go, when the motion preference changes.',
  );
}
// Leaving Inspect from a study zoom closer than the town's limit eases all the way out: the
// real OrbitControls clamps the zoom to its limit on every update, so the limit must come
// down with the glide, not before it.
const exitPieces = [];
function collectExit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'exitInspection')
    exitPieces.push(node.getText(syntax));
  if (
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (d) => d.name.getText(syntax) === 'CITY_MAX_ZOOM',
    )
  )
    exitPieces.push(node.getText(syntax));
  if (
    ts.isIfStatement(node) &&
    node.expression.getText(syntax) === '!inspect' &&
    node.thenStatement.getText(syntax).includes('controls.maxZoom')
  )
    exitPieces.push(`function zoomLimit() { ${node.getText(syntax)} }`);
  ts.forEachChild(node, collectExit);
}
collectExit(syntax);
assert.equal(exitPieces.length, 3, 'The Inspect exit check must find every piece it runs.');
const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
const studyCamera = new T.OrthographicCamera(-38, 38, 45, -45, 0.1, 180);
studyCamera.position.set(0, 35, 38);
studyCamera.lookAt(0, 0, 0);
const studyControls = new OrbitControls(studyCamera, null);
studyControls.enableDamping = true;
studyControls.dampingFactor = 0.09;
studyControls.maxZoom = 8;
// A phone's study zoom on a home.
studyCamera.zoom = 7.4;
studyCamera.updateProjectionMatrix();
studyControls.update();
const exit = {
  Math,
  camera: studyCamera,
  controls: studyControls,
  inspect: {},
  studyGround: {},
  scene: { remove() {} },
  city: { visible: false },
  zones: { visible: false },
  planMode: false,
  shadowFocus() {},
  clearHover() {},
};
const leaving = runInNewContext(
  `${ts.transpileModule(exitPieces.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};({ exitInspection, zoomLimit });`,
  exit,
);
leaving.exitInspection();
assert.equal(exit.inspect, null);
const townZoom = 3.4,
  glide = 1 - Math.exp(-5.5 / 60);
for (let frame = 0; frame < 120; frame++) {
  const before = studyCamera.zoom;
  // step(): the glide's lerp, then the limit, then OrbitControls' own update.
  studyCamera.zoom += (townZoom - studyCamera.zoom) * glide;
  leaving.zoomLimit();
  studyControls.update();
  assert(
    before - studyCamera.zoom <= (before - townZoom) * glide + 1e-9,
    `Leaving Inspect cut the zoom from ${before.toFixed(2)} to ${studyCamera.zoom.toFixed(2)} in one frame.`,
  );
}
assert(Math.abs(studyCamera.zoom - townZoom) < 1e-3, 'The glide must reach the town framing.');
assert.equal(studyControls.maxZoom, 4, 'Back in the town, its zoom limit holds again.');
// The visitor's pan limit: the subject's ground point (where the line of sight through the view
// centre less the panel offset meets the ground) stays in the island's disc (36, just past its
// farthest coast and the lighthouse's rock), a capsule (8) over the causeway, or the airport's deck
// and 4 past its edge, clamped each frame to whichever it is deepest in or nearest to; and the
// overview and the airport's chapter fit their frames.
const plan = await import(pathToFileURL(path.join(output, 'town-plan.mjs')).href);
{
  const pieces = [];
  const collect = (node) => {
    if (ts.isFunctionDeclaration(node) && ['panRegion', 'holdPan', 'viewOffset', 'panelOffset', 'offsetTarget', 'fitOverview', 'fitGroup'].includes(node.name?.text))
      pieces.push(node.getText(syntax));
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => ['PAN', 'panSubject', 'islandMarks', '[rockX, rockZ]', 'AIRPORT_FIT'].includes(d.name.getText(syntax))))
      pieces.push(node.getText(syntax));
    ts.forEachChild(node, collect);
  };
  collect(syntax);
  assert.equal(pieces.length, 12, 'The pan and fit check must find every piece it runs.');
  assert(/controls\.minZoom = 0\.45;/.test(source), 'The town\'s widest zoom is no longer 0.45.');
  const view = {
    T,
    Math,
    plan,
    camera: new T.OrthographicCamera(),
    controls: { minZoom: 0.45 },
    target: new T.Vector3(),
    shiftApplied: new T.Vector3(),
    screenRight: new T.Vector3(),
    screenUp: new T.Vector3(),
    frameDrop: 0,
    tween: false,
  };
  const panScript = `${ts.transpileModule(pieces.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};({ panRegion, holdPan, fitOverview, fitGroup, islandMarks, AIRPORT_FIT, PAN });`,
    scene = runInNewContext(panScript, view);
  const region = (x, z) => {
      const r = scene.panRegion(new T.Vector3(x, 0, z));
      return { x: r.centre.x, z: r.centre.z, radius: r.radius };
    },
    // OrbitControls' clamp: the subject pulled to within the region's radius of its centre.
    clamp = (x, z) => {
      const r = region(x, z),
        d = Math.hypot(x - r.x, z - r.z),
        k = Math.min(1, r.radius / d);
      return [r.x + (x - r.x) * k, r.z + (z - r.z) * k];
    },
    // The union, measured from the plan rather than from panRegion: the disc, the capsule round the
    // causeway's line (x 0.5, from z -20 to the deck's south edge) and the deck's signed distance.
    beyondDeck = (x, z) => plan.airportDistance(x, z),
    // How far a point lies outside the union (negative inside).
    beyond = (x, z) => {
      const along = Math.min(-20, Math.max(plan.AIRPORT.z + plan.AIRPORT.hd, z));
      return Math.min(Math.hypot(x, z) - DISC, Math.hypot(x - plan.AIRPORT_ROAD.x, z - along) - 8, beyondDeck(x, z) - 4);
    },
    inside = (x, z) => beyond(x, z) <= 1e-6,
    DISC = 36;
  assert.equal(scene.PAN.disc, DISC, 'The island\'s pan disc is no longer 36.');
  // The disc reaches the island's farthest coast (its north-west headland) and the lighthouse's rock,
  // and no more than a unit or two past them.
  const coast = Math.max(...plan.islandOutline.map(([x, z]) => Math.hypot(x, z)));
  assert(coast > 35 && coast <= DISC && Math.hypot(...plan.lighthouseRock) <= DISC && DISC - coast < 1.5, `The pan disc (${DISC}) does not just reach the coast (${coast.toFixed(1)}) and the lighthouse's rock.`);
  assert.deepEqual(region(3, -4), { x: 0, z: 0, radius: DISC }, 'The island is not its own pan region.');
  for (const [x, z] of [[plan.AIRPORT.x, plan.AIRPORT.z], [0.5, -36], [-17, -52], [6.5, -44], [-5.5, -58.5], [-20.5, -49.2], [0.5, -26]])
    assert((z < -30 ? region(x, z).radius !== DISC : true) && inside(x, z) && clamp(x, z).every((c, i) => Math.abs(c - [x, z][i]) < 1e-9), `The airport's pan region leaves out ${x}, ${z}.`);
  for (const [x, z] of [[60, 0], [0, 60], [-40, -70], [25, -45], [-30, -40], [-5.5, -62], [-21, -40], [12, -40]]) {
    const [cx, cz] = clamp(x, z);
    assert(inside(cx, cz) && Math.hypot(cx - x, cz - z) > 1, `A pan to ${x}, ${z} is not held to the town.`);
  }
  // Out past the airport (north of its middle, or past either end) the subject is held within 4 of
  // its deck's edge, as the disc holds it a few units off the island's coast: a pan north of it no
  // longer ends on two thirds of open sea (the capsule of 15 let it run 9 past the north edge). Only
  // 40 out past the deck's east end is the island's disc the nearer region, and there it is held on
  // the disc's edge, 3.5 off the coast.
  for (let a = Math.PI; a <= 2 * Math.PI + 1e-9; a += Math.PI / 36)
    for (const far of [5, 20, 40]) {
      const x = plan.AIRPORT.x + Math.cos(a) * (plan.AIRPORT.hw + far),
        z = plan.AIRPORT.z + Math.sin(a) * (plan.AIRPORT.hd + far),
        [cx, cz] = clamp(x, z),
        onDisc = region(x, z).radius === DISC;
      assert(inside(cx, cz) && (onDisc ? far === 40 && Math.cos(a) > 0.99 && Math.abs(Math.hypot(cx, cz) - DISC) < 1e-6 : beyondDeck(cx, cz) <= 4 + 1e-6), `A pan to ${x.toFixed(1)}, ${z.toFixed(1)} ends ${beyondDeck(cx, cz).toFixed(1)} past the airport's deck.`);
    }
  // The limit as the frame loop applies it, through three's real OrbitControls as a drag drives
  // it: each pointer move pans and updates, then each frame holds the limit (holdPan) and updates
  // again, 8 px a frame on a 1440 x 900 frame. Screen-space panning lifts the target 0.74 a unit of
  // screen-vertical pan: measured at the lifted target, a drag down and then sideways jumped the
  // view 139-151 px in one frame where the causeway's capsule took over from the disc, and its
  // ground point ran 14 past the disc and 7 past the deck. Measured on the ground, at every Rotate
  // stop and the chapter's bearing, the view never moves more than twice the drag in a frame, its
  // ground point keeps within half a unit of the regions (4.5 of the deck), and a drag kept up
  // against the limit does not lift the camera past PAN.lift (into the fog).
  const drivePan = (yaw, w = 1440, h = 900) => {
    const aspect = w / h,
      vertical = Math.max(53, 76 / aspect),
      camera = new T.OrthographicCamera((-vertical * aspect) / 2, (vertical * aspect) / 2, vertical / 2, -vertical / 2, -200, 180),
      controls = new OrbitControls(camera, null),
      held = { T, Math, plan, camera, controls, shiftApplied: new T.Vector3(), tween: false, panSlack: Infinity },
      pan = runInNewContext(panScript, held);
    controls.domElement = { clientWidth: w, clientHeight: h };
    Object.assign(controls, { enableRotate: false, enableDamping: true, dampingFactor: 0.09, screenSpacePanning: true });
    camera.position.set(Math.sin(yaw) * 38, 35, Math.cos(yaw) * 38);
    camera.lookAt(controls.target);
    camera.updateMatrixWorld();
    controls.update();
    camera.updateMatrixWorld();
    // The camera's line of sight back, its screen's right and up, and pixels a unit, as it stands.
    const axes = () => ({
        back: camera.position.clone().sub(controls.target).normalize(),
        right: new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0),
        up: new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 1),
        perUnit: (h * camera.zoom) / (camera.top - camera.bottom),
      }),
      ground = () => {
        const { back } = axes(),
          g = controls.target.clone().sub(held.shiftApplied);
        return g.addScaledVector(back, -g.y / back.y);
      },
      worst = { move: 0, beyond: -Infinity, deck: -Infinity, lift: 0, reached: Infinity };
    return {
      held,
      ground,
      worst,
      // One frame: the pointer's move (if any), then the frame loop's hold and update.
      frame(dx = 0, dy = 0) {
        const was = controls.target.clone(),
          { right, up, perUnit } = axes();
        if (dx || dy) {
          controls._pan(dx, dy);
          controls.update();
          camera.updateMatrixWorld();
        }
        pan.holdPan();
        controls.update();
        camera.updateMatrixWorld();
        const d = controls.target.clone().sub(was),
          g = ground();
        worst.move = Math.max(worst.move, Math.hypot(d.dot(right), d.dot(up)) * perUnit);
        worst.beyond = Math.max(worst.beyond, beyond(g.x, g.z));
        // Past the deck, where the deck's region is the nearest (neither the disc nor the capsule holds it).
        const along = Math.min(-20, Math.max(plan.AIRPORT.z + plan.AIRPORT.hd, g.z)),
          deckOut = beyondDeck(g.x, g.z) - 4;
        if (deckOut < Math.hypot(g.x, g.z) - DISC && deckOut < Math.hypot(g.x - plan.AIRPORT_ROAD.x, g.z - along) - 8) worst.deck = Math.max(worst.deck, deckOut + 4);
        worst.lift = Math.max(worst.lift, Math.abs(controls.target.y - held.shiftApplied.y));
        worst.reached = Math.min(worst.reached, beyondDeck(g.x, g.z));
        return g;
      },
      toward(x, z) {
        // A drag that moves the view toward (x, z): the map follows the finger the other way.
        const g = ground(),
          { right, up } = axes(),
          aim = new T.Vector3(x - g.x, 0, z - g.z),
          sx = aim.dot(right),
          sy = aim.dot(up),
          l = Math.hypot(sx, sy) || 1;
        return [(-8 * sx) / l, (8 * sy) / l];
      },
    };
  };
  for (const yaw of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4, plan.chapterBearings.airport])
    for (const down of [8, -8])
      for (const reach of [280, 480, 640])
        for (const side of [8, -8]) {
          const drive = drivePan(yaw);
          for (let f = 0; f < reach / 8; f++) drive.frame(0, down);
          for (let f = 0; f < 300; f++) drive.frame(side, 0);
          for (let f = 0; f < 120; f++) drive.frame();
          const { move, beyond: out, deck, lift } = drive.worst,
            gesture = `dragging ${down > 0 ? 'down' : 'up'} ${reach} px and then ${side > 0 ? 'right' : 'left'} at bearing ${yaw.toFixed(2)}`;
          assert(move <= 16, `The view jumps ${move.toFixed(0)} px in one frame ${gesture}.`);
          assert(out <= 0.5 && deck <= 4.5, `The view's ground point ends ${out.toFixed(2)} outside the pan regions (${deck.toFixed(2)} past the deck) ${gesture}.`);
          assert(lift <= scene.PAN.lift + 1, `The target lifts ${lift.toFixed(1)} over the ground ${gesture}.`);
        }
  // From the airport, a drag out past its ends and its north edge is held within 4.5 of the deck.
  for (const yaw of [Math.PI / 4, (5 * Math.PI) / 4, plan.chapterBearings.airport])
    for (const [x, z] of [[60, -49.2], [-70, -49.2], [-5.5, -110], [40, -90], [-50, -95]]) {
      const drive = drivePan(yaw);
      drive.held.controls.target.set(plan.AIRPORT.x, 0, plan.AIRPORT.z);
      drive.held.camera.position.copy(drive.held.controls.target).add(new T.Vector3(Math.sin(yaw) * 38, 35, Math.cos(yaw) * 38));
      drive.held.controls.update();
      drive.held.camera.updateMatrixWorld();
      for (let f = 0; f < 500; f++) drive.frame(...drive.toward(x, z));
      for (let f = 0; f < 120; f++) drive.frame();
      assert(drive.worst.deck <= 4.5 && drive.worst.beyond <= 0.5 && drive.worst.move <= 16, `A drag from the airport toward ${x}, ${z} at bearing ${yaw.toFixed(2)} ends ${drive.worst.deck.toFixed(2)} past its deck (or jumps ${drive.worst.move.toFixed(0)} px).`);
    }
  // A straight drag from the plaza toward the airport gets there (measured at the lifted target it
  // stuck on the disc's sphere 30 out), and at the opening bearing a drag kept up against the limit
  // holds the view still.
  for (const yaw of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    const drive = drivePan(yaw);
    for (let f = 0; f < 400; f++) drive.frame(...drive.toward(plan.AIRPORT.x, plan.AIRPORT.z));
    assert(drive.worst.reached < 0 && drive.worst.move <= 16, `A drag toward the airport at bearing ${yaw.toFixed(2)} does not reach its deck (${drive.worst.reached.toFixed(1)} short) or jumps.`);
  }
  {
    const drive = drivePan(Math.PI / 4);
    for (let f = 0; f < 600; f++) drive.frame(0, 8);
    const before = drive.ground();
    for (let f = 0; f < 300; f++) drive.frame(0, 8);
    assert(drive.ground().distanceTo(before) < 0.6 && drive.worst.lift <= scene.PAN.lift + 1, 'A drag kept up against the pan limit moves the view on, or lifts the camera into the fog.');
  }
  // The sea reaches past every frame's edge, short of the fog and the camera's near plane: the bottom
  // of a tall frame looks back toward the camera, where the fog never reaches. Zoomed out to the
  // widest, at every bearing, with the subject's ground point anywhere on the pan union's edge (and
  // half a unit past it, as a drag can leave it), and the target lifted or lowered as far as
  // PAN.lift lets it (which only moves the depths): phones with the file hidden or above its sheet,
  // tablets upright and on their side, beside the file or not, and desktops beside a panel. At 480
  // the pale stage showed in the bottom corners of phones (up to 155 px) and tablets.
  {
    const { SEA_SIZE } = await import(pathToFileURL(path.join(output, 'city-water.mjs')).href),
      [near] = /new T\.OrthographicCamera\(-24, 24, 24, -24, (-?\d+), \d+\)/.exec(source).slice(1).map(Number),
      [fogFar] = /new T\.Fog\('#[0-9a-f]+', \d+, (\d+)\)/.exec(source).slice(1).map(Number),
      give = scene.PAN.lift / (35 / Math.hypot(38, 35)),
      edge = [];
    assert(near < 0 && fogFar > 0, 'The sea check cannot find the camera\'s near plane or the fog.');
    for (let a = 0; a < 2 * Math.PI; a += Math.PI / 60) edge.push(new T.Vector3(Math.cos(a) * (DISC + 0.5), 0, Math.sin(a) * (DISC + 0.5)));
    for (const o of plan.airportOutline(4.5, 1.5)) edge.push(new T.Vector3(o.x, 0, o.z));
    for (let z = -20; z >= plan.AIRPORT.z + plan.AIRPORT.hd; z -= 2) edge.push(new T.Vector3(plan.AIRPORT_ROAD.x + 8.5, 0, z), new T.Vector3(plan.AIRPORT_ROAD.x - 8.5, 0, z));
    const frames = [
      ...[[360, 640], [360, 800], [375, 667], [390, 844], [412, 915], [430, 932]].flatMap(([w, h]) => [[w, h, 0, 0], [w, h, 0, -0.26]]),
      ...[[768, 1024], [820, 1180]].flatMap(([w, h]) => [[w, h, 0, 0], [w, h, 0, -0.2]]),
      ...[[1024, 1366], [1024, 768], [1366, 1024]].flatMap(([w, h]) => [[w, h, 0, 0], [w, h, 0.24, 0]]),
      ...[[1280, 800], [1440, 900], [1920, 1080], [2560, 1080]].flatMap(([w, h]) => [[w, h, 0.21, 0], [w, h, 0.3, -0.2]]),
    ];
    let reach = 0;
    for (const [w, h, shift, drop] of frames) {
      const aspect = w / h,
        vertical = Math.max(53, 76 / aspect),
        halfW = (vertical * aspect) / 2 / 0.45,
        halfH = vertical / 2 / 0.45;
      for (let b = 0; b < 2 * Math.PI; b += Math.PI / 24) {
        const back = new T.Vector3(Math.sin(b) * 38, 35, Math.cos(b) * 38),
          right = new T.Vector3(Math.cos(b), 0, -Math.sin(b)),
          up = new T.Vector3().crossVectors(back.clone().normalize(), right),
          forward = back.clone().normalize().negate(),
          // The scene's panel offset for the frame (panelOffset), at the widest zoom.
          offset = right.clone().multiplyScalar(shift * 2 * halfW).addScaledVector(up, drop * 2 * halfH);
        for (const subject of edge) {
          const eye = subject.clone().add(offset).add(back),
            // Where the frame's corner (u, v) looks at the water's level, and how deep that is.
            look = (u, v, level) => {
              const from = eye.clone().addScaledVector(right, u * halfW).addScaledVector(up, v * halfH),
                t = (level - from.y) / forward.y;
              return { x: from.x + forward.x * t, z: from.z + forward.z * t, depth: t };
            };
          // Along each edge of the frame the ground point and its depth run linearly, so the farthest
          // point in view (short of the fog and the near plane) is at a corner or where the fog or the
          // near plane cuts the edge.
          for (const level of [0.07, -0.5])
            for (const [[u0, v0], [u1, v1]] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) {
              const a = look(u0, v0, level),
                c = look(u1, v1, level),
                lo = near - give,
                hi = fogFar + give,
                cut = (d) => (d - a.depth) / (c.depth - a.depth || 1e-9);
              let s0 = 0,
                s1 = 1;
              if (Math.abs(c.depth - a.depth) < 1e-9) {
                if (a.depth <= lo || a.depth >= hi) continue;
              } else {
                const [p, q] = [cut(lo), cut(hi)].sort((m, n) => m - n);
                s0 = Math.max(0, p);
                s1 = Math.min(1, q);
                if (s0 >= s1) continue;
              }
              for (const k of [s0, s1]) {
                const x = a.x + (c.x - a.x) * k,
                  z = a.z + (c.z - a.z) * k,
                  out = Math.max(Math.abs(x), Math.abs(z));
                reach = Math.max(reach, out);
                assert(out <= SEA_SIZE / 2, `The sea ends in view (${out.toFixed(0)} out, depth ${(a.depth + (c.depth - a.depth) * k).toFixed(0)}) on a ${w} x ${h} frame (shift ${shift}, drop ${drop}) at bearing ${b.toFixed(2)}, viewing ${subject.x.toFixed(1)}, ${subject.z.toFixed(1)} at the widest zoom.`);
              }
            }
        }
      }
    }
    assert(reach > 380 && reach < SEA_SIZE / 2 - 10, `The sea check reaches ${reach.toFixed(0)} of the sea's ${SEA_SIZE / 2}.`);
  }
  // The overview takes in the airport's island too (its armour's toe, the tower's mast, the hangar's
  // roof): at 1440 x 900 it zooms out about 16% from the island's 0.911, and beside the open file
  // (460 wide: a frame shift of about 0.17 at 1440, 0.19 at 1280) it still fits above the widest zoom.
  const frame = (w, h, shift, bearing) => {
    const aspect = w / h,
      vertical = Math.max(53, 76 / aspect);
    Object.assign(view.camera, { left: (-vertical * aspect) / 2, right: (vertical * aspect) / 2, top: vertical / 2, bottom: -vertical / 2 });
    Object.assign(view, { width: w, height: h, frameShift: shift, yaw: bearing, targetYaw: bearing, targetZoom: 1 });
  };
  assert(scene.islandMarks.some((p) => p.distanceTo(new T.Vector3(3.9, 7, -47.4)) < 1e-9) && scene.islandMarks.some((p) => plan.airportDistance(p.x, p.z) > plan.AIRPORT.armour - 1e-6), 'The overview leaves the airport out.');
  frame(1440, 900, 0, Math.PI / 4);
  scene.fitOverview();
  assert(view.targetZoom > 0.74 && view.targetZoom < 0.8, `The overview of the island and the airport fits at ${view.targetZoom.toFixed(3)}.`);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    frame(w, h, (460 + 32) / (2 * w), Math.PI / 4);
    scene.fitOverview();
    assert(view.targetZoom > 0.45, `Beside the file at ${w} x ${h} the overview is clamped (${view.targetZoom.toFixed(3)}).`);
  }
  // The airport's chapter (at the gate's bearing, beside the reading panel): the island and the
  // causeway's far half fitted between 0.95 and 2.6, its subject inside the airport's pan region,
  // so the framing is never pulled back toward the town when its glide ends.
  for (const [w, h, want] of [[1440, 900, 1.135], [1280, 800, 1.124], [1024, 768, 0.986], [1920, 1080, 1.285]]) {
    frame(w, h, 0.21, plan.chapterBearings.airport);
    scene.fitGroup(scene.AIRPORT_FIT, 0.95, 2.6);
    assert(Math.abs(view.targetZoom - want) < 0.01 && view.targetZoom >= 0.95, `The airport's chapter fits at ${view.targetZoom.toFixed(3)} on ${w} x ${h} (${want} expected).`);
    const subject = view.target.clone().sub(view.shiftApplied);
    assert(inside(subject.x, subject.z) && region(subject.x, subject.z).radius === scene.PAN.deck.reach && clamp(subject.x, subject.z).every((c, i) => Math.abs(c - [subject.x, subject.z][i]) < 1e-9), `The airport's chapter frames ${subject.x.toFixed(1)}, ${subject.z.toFixed(1)}, outside its pan region.`);
  }
  // A glide between the People side and the airport (or the residence and the airport, the tour's
  // stops 6 and 7) runs straight across open water, out of the pan regions. Cut short by a touch on
  // a narrow screen (no panel offset there to glide it on), it hands the visitor the view where it
  // is: the next frame does not pull it in (it jumped as the touch landed), a drag out holds it
  // within how far out it was, and a drag back in takes that slack away.
  {
    const w = 768,
      h = 1024,
      people = new T.Vector3(-24.5, 0, -1.5),
      // The residence's pick centres its middle, 2.8 up.
      residence = new T.Vector3(-20.61, 2.79, -10.27);
    frame(w, h, 0, plan.chapterBearings.airport);
    scene.fitGroup(scene.AIRPORT_FIT, 0.95, 2.6);
    const departures = { at: view.target.clone(), yaw: plan.chapterBearings.airport, zoom: view.targetZoom },
      glides = [
        [{ at: people, yaw: plan.chapterBearings.people, zoom: 1.6 }, departures],
        [departures, { at: people, yaw: plan.chapterBearings.people, zoom: 1.6 }],
        [{ at: residence, yaw: plan.chapterBearings.people, zoom: 2.4 }, departures],
      ];
    let crossing = 0,
      handed = 0;
    for (const [from, to] of glides) {
      for (let k = 0; k <= 100; k++) {
        // Its ground point (the lifted middle slid down the line of sight at the opening bearing's elevation).
        const p = from.at.clone().lerp(to.at, k / 100),
          sight = 35 / Math.hypot(38, 35);
        crossing = Math.max(crossing, beyond(p.x - (p.y / sight) * Math.sqrt(1 - sight * sight) * Math.sin(from.yaw), p.z - (p.y / sight) * Math.sqrt(1 - sight * sight) * Math.cos(from.yaw)));
      }
      for (let cut = 2; cut < 150; cut += cut < 60 ? 1 : 4) {
        const drive = drivePan(from.yaw, w, h),
          { camera, controls } = drive.held,
          blend = 1 - Math.exp(-5.5 / 60);
        let yaw = from.yaw;
        const align = () => {
          camera.position.copy(controls.target).add(new T.Vector3(Math.sin(yaw) * 38, 35, Math.cos(yaw) * 38));
          camera.lookAt(controls.target);
          camera.updateMatrixWorld();
        };
        controls.target.copy(from.at);
        camera.zoom = from.zoom;
        camera.updateProjectionMatrix();
        align();
        controls.update();
        drive.held.tween = true;
        // The frame loop's turn and glide (step), then the limit and OrbitControls' update.
        for (let f = 0; f < cut && drive.held.tween; f++) {
          const left = to.yaw - yaw;
          yaw += Math.sign(left) * Math.min(Math.abs(left) * (1 - Math.exp(-2.5 / 60)), Math.PI / 2 / 60);
          controls.target.lerp(to.at, blend);
          camera.zoom += (to.zoom - camera.zoom) * blend;
          camera.updateProjectionMatrix();
          align();
          drive.held.tween = controls.target.distanceTo(to.at) >= 0.002;
          drive.frame();
        }
        if (!drive.held.tween) continue;
        // A touch: OrbitControls' 'start' cancels the glide; the next frame hands the view over.
        drive.held.tween = false;
        const before = controls.target.clone(),
          g = drive.ground(),
          out = Math.max(0, beyond(g.x, g.z));
        drive.frame();
        const moved = controls.target.distanceTo(before) * ((h * camera.zoom) / (camera.top - camera.bottom));
        handed = Math.max(handed, out);
        assert(moved < 0.5, `Cut short ${cut} frames into its glide ${out.toFixed(1)} out of the pan regions, the view is pulled ${moved.toFixed(0)} px in one frame.`);
        if (out < 1) continue;
        // Dragged on outward (away from the union), it is held within the slack it was handed...
        const e = 0.01,
          grad = new T.Vector3(beyond(g.x + e, g.z) - beyond(g.x - e, g.z), 0, beyond(g.x, g.z + e) - beyond(g.x, g.z - e)).normalize(),
          far = g.clone().addScaledVector(grad, 60);
        for (let f = 0; f < 90; f++) {
          const at = drive.frame(...drive.toward(far.x, far.z));
          assert(beyond(at.x, at.z) <= out + 0.5, `Handed the view ${out.toFixed(1)} out, a drag takes it ${beyond(at.x, at.z).toFixed(1)} out.`);
        }
        // ...and dragged back in, the slack goes and stays gone.
        const near = g.clone().addScaledVector(grad, -30);
        for (let f = 0; f < 150; f++) drive.frame(...drive.toward(near.x, near.z));
        const back = drive.ground();
        assert(drive.held.panSlack < 0.5 && beyond(back.x, back.z) <= 0.5, `Panned back in, the view keeps ${drive.held.panSlack.toFixed(1)} of slack.`);
      }
    }
    assert(crossing > 2 && handed > 2, `The glide check no longer leaves the pan regions (${crossing.toFixed(1)}, handed ${handed.toFixed(1)} out).`);
  }
  // That is the framing the Departures chapter gets: the reading camera turns to its chapter's
  // bearing (the gate's) and selects its scene target, the airport, and the scene fits a selected
  // airport alone to that box between 0.95 and 2.6. The City file of the airport, or of anyone who
  // has left, turns and selects the same way (page.tsx's frameCity), so the camera stays put as a
  // board row opens a person's file.
  for (const chapter of nav.readingChapters)
    assert(Number.isFinite(plan.chapterBearings[chapter]), `The ${chapter} chapter has no bearing.`);
  assert.equal(plan.chapterBearings.airport, plan.chapterBearings['lius-gate']);
  assert.equal(nav.sceneTarget('airport').building, 'airport');
  let fitFocusedSource, selectSource;
  (function findFit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'fitFocused') fitFocusedSource = node.getText(syntax);
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'select') selectSource = node.getText(syntax);
    ts.forEachChild(node, findFit);
  })(syntax);
  assert(
    /focusedIds\.length === 1 && focusedIds\[0\] === 'airport'\)\s*\{\s*fitGroup\(AIRPORT_FIT, 0\.95, 2\.6\);/.test(fitFocusedSource) &&
      /focusedIds = \[id\];[\s\S]*fitFocused\(\);/.test(selectSource),
    'Selecting the airport no longer fits its island and causeway.',
  );
}
// A sun shadow map thrown away (Inspect's sharper map, the town's again, a quality step) or a
// frustum moved elsewhere is drawn again before the next frame uses it, even paused: an empty
// map would put everything in full shadow until the paused cadence came round.
const shadowPieces = [];
function collectShadow(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'shadowFocus')
    shadowPieces.push(node.getText(syntax));
  if (
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((d) => ['shadowSizeFor', 'SHADOW_HOME'].includes(d.name.getText(syntax)))
  )
    shadowPieces.push(node.getText(syntax));
  ts.forEachChild(node, collectShadow);
}
collectShadow(syntax);
assert.equal(shadowPieces.length, 3, 'The shadow check must find every piece it runs.');
const shadowSun = new T.DirectionalLight();
Object.assign(shadowSun.shadow.camera, { left: -46, right: 46, top: 46, bottom: -46 });
shadowSun.shadow.mapSize.set(2048, 2048);
const shadows = {
  T,
  Math,
  sun: shadowSun,
  tier: 'high',
  shadowBase: 1536,
  quality: 0,
  shadowInspect: false,
  shadowDirty: false,
  renderer: { shadowMap: { needsUpdate: false } },
  placeSun() {},
};
const focusing = runInNewContext(
  `${ts.transpileModule(shadowPieces.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};shadowFocus;`,
  shadows,
);
const drawn = () => {
  shadowSun.shadow.map = { dispose() {} };
  shadows.shadowDirty = false;
  shadows.renderer.shadowMap.needsUpdate = false;
};
const redrawn = (what) => {
  assert.equal(shadowSun.shadow.map, null, `${what}: the check expects a new map.`);
  assert(
    shadows.shadowDirty && shadows.renderer.shadowMap.needsUpdate,
    `${what} left the sun with no shadow map until the next scheduled shadow pass.`,
  );
};
drawn();
focusing(new T.Vector3(6, 2, -4), 9);
redrawn('Entering Inspect');
// Inspect's map is twice the old base (3072), not twice the town's (4096), and it says so outright.
assert(shadows.shadowInspect && shadowSun.shadow.mapSize.x === 3072 && shadowSun.shadow.camera.right === 9, 'Inspect\'s shadow map is not its own.');
drawn();
focusing();
redrawn('Leaving Inspect');
// The town's own box: the island and the airport's island whole, about 22 texels a unit.
assert(!shadows.shadowInspect && shadowSun.target.position.equals(new T.Vector3(-3.5, 0, -13.5)) && shadowSun.shadow.camera.right === 46 && shadowSun.shadow.mapSize.x === 2048, 'The town\'s shadow box moved.');
assert(shadowSun.shadow.mapSize.x / (2 * shadowSun.shadow.camera.right) > 22, 'The town\'s shadows lost their sharpness.');
drawn();
focusing();
assert(!shadows.renderer.shadowMap.needsUpdate, 'An unchanged focus costs no extra shadow pass.');
shadows.quality = 2;
focusing();
redrawn('A quality step');
assert.equal(shadowSun.shadow.mapSize.x, 1024, 'A quality step does not halve the town\'s map.');
focusing(new T.Vector3(6, 2, -4), 9);
assert.equal(shadowSun.shadow.mapSize.x, 1536, 'A quality step does not halve Inspect\'s map.');
// The box's depth runs from about 1.2 to 76 from the light: a near plane of 0.5 keeps all of it. The
// sun's target starts on the home box, so no frame before the first framing call is shaded round
// the origin.
assert(/near: 0\.5,/.test(source), 'The sun\'s shadow camera lost its near plane.');
assert(/sun\.target\.position\.copy\(SHADOW_HOME\.centre\);\s*scene\.add\(sun\.target\);/.test(source), 'The sun\'s shadow does not start on its home box.');
// The frame loop draws nothing until the first sky has arrived, so a town opened at night
// never shows a daylit frame first.
let frameGuard;
function findFrameGuard(node) {
  if (ts.isIfStatement(node) && node.expression.getText(syntax).startsWith('!force && (document.hidden'))
    frameGuard = node.getText(syntax);
  ts.forEachChild(node, findFrameGuard);
}
findFrameGuard(syntax);
assert(frameGuard, 'The first-sky check must find the frame loop’s guard.');
const drawsFrame = (skyKnown) =>
  runInNewContext(
    `${ts.transpileModule(`function frameRuns() { ${frameGuard} return true; }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};frameRuns();`,
    { force: false, document: { hidden: false }, inViewport: true, skyKnown },
  );
assert.equal(drawsFrame(false), undefined, 'A frame was drawn before the first sky.');
assert.equal(drawsFrame(true), true, 'Frames are drawn once the sky is known.');
// The windows' clock: a jump of more than two hours puts the panes on the clock at once, measured from
// the last sky and from the last frame. A hidden tab or a town scrolled out of view runs no frames
// while the page keeps sending the sky minute by minute, so back after four hours the panes must be
// on the clock, not four hours behind and going out one by one for twenty minutes.
let setSkySource;
function findSetSky(node) {
  if (ts.isMethodDeclaration(node) && node.name.getText(syntax) === 'setSky') setSkySource = node.getText(syntax);
  ts.forEachChild(node, findSetSky);
}
findSetSky(syntax);
assert(setSkySource, 'The window clock check must find setSky.');
assert(/followWindows\(paneClock, paneGoal, night, dt, reduced\);\s*paneHours = skyHours;/.test(source), 'Each frame must note the hours the panes followed.');
{
  const { windowClock } = await import(pathToFileURL(path.join(output, 'glasgow-sun.mjs')).href);
  const scene = {
      T,
      Math,
      Object,
      windowClock,
      sunOffsetFor: () => new T.Vector3(),
      warmSun: () => 0,
      lowSun: () => 0,
      placeSun() {},
      targetSunOffset: new T.Vector3(),
      sunOffset: new T.Vector3(),
      skyKnown: false,
      skyHours: 20,
      paneHours: 20,
      paneClock: { out: 0, wake: 0 },
      paneGoal: { out: 0, wake: 0 },
    },
    api = runInNewContext(
      `${ts.transpileModule(`const api = { ${setSkySource} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};api;`,
      scene,
    ),
    sky = (hours) => api.setSky({ night: 1, elevation: -0.3, azimuth: 0, hours: ((hours % 24) + 24) % 24 }),
    frame = () => (scene.paneHours = scene.skyHours), // the frame loop, after followWindows
    start = (h) => {
      sky(h + 12);
      sky(h);
      frame();
    },
    minutes = (from, count, frames) => {
      for (let m = 1; m <= count; m++) {
        sky(from + m / 60);
        if (frames) frame();
      }
    };
  start(21);
  assert.deepEqual(scene.paneClock, windowClock(21), 'A debug start puts the panes on the clock.');
  minutes(21, 240, false);
  assert.deepEqual(scene.paneClock, windowClock(1), 'Back after four hours without frames, the windows are not on the clock.');
  start(23);
  minutes(23, 90, false);
  assert.deepEqual(scene.paneClock, windowClock(23), 'After 90 minutes without frames the windows must catch up one by one.');
  start(22);
  minutes(22, 240, true);
  assert.deepEqual(scene.paneClock, windowClock(22), 'A visible town never jumps its windows.');
  start(1.9);
  sky(1);
  assert.deepEqual(scene.paneClock, windowClock(1.9), 'The windows jump when the clocks go back.');
}
// The moon turns with the camera, as the key light does: at every bearing (the four rotate stops
// included, with the idle drift either way) the sea's mirror direction stays as far from the moon
// as at the opening view, so its sharp glint lobe never spreads across the water as static.
const moonPieces = [];
function collectMoon(node) {
  if (ts.isFunctionDeclaration(node) && ['placeSun', 'viewOffset'].includes(node.name?.text))
    moonPieces.push(node.getText(syntax));
  ts.forEachChild(node, collectMoon);
}
collectMoon(syntax);
assert.equal(moonPieces.length, 2, 'The moon check must find every piece it runs.');
assert(
  /water\.update\([^)]*moon: moonAt[^)]*\)/.test(source),
  'The frame loop must hand the turned moon to the sea.',
);
const { MOON_POSITION } = await import(pathToFileURL(path.join(output, 'city-water.mjs')).href);
const sky = {
  T,
  Math,
  MOON_POSITION,
  UP: new T.Vector3(0, 1, 0),
  sunOffset: new T.Vector3(-16, 32, 20),
  keyOffset: new T.Vector3(),
  lastKey: new T.Vector3(),
  // Left alone, this is a moon fixed in the world.
  moonAt: MOON_POSITION.clone(),
  sun: { position: new T.Vector3(), target: { position: new T.Vector3() } },
  scene: { environmentRotation: { y: 0 } },
  shadowDirty: false,
  yaw: Math.PI / 4,
};
const skyTurn = runInNewContext(
  `${ts.transpileModule(moonPieces.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};({ placeSun, viewOffset });`,
  sky,
);
// How close the flat sea's mirror direction comes to the moon over the water in view (1 = on it).
// The water in view is a square round the island that turns with the camera.
function moonGlint() {
  let worst = 0;
  for (const drift of [-0.16, 0, 0.16]) {
    const eye = skyTurn.viewOffset(sky.yaw + drift, new T.Vector3()).normalize();
    for (let x = -60; x <= 60; x += 20)
      for (let z = -60; z <= 60; z += 20) {
        const sea = new T.Vector3(x, 0, z).applyAxisAngle(sky.UP, sky.yaw - Math.PI / 4),
          half = sky.moonAt.clone().sub(sea).normalize().add(eye).normalize();
        worst = Math.max(worst, half.y);
      }
  }
  return worst;
}
skyTurn.placeSun();
const openingGlint = moonGlint(),
  glints = Array.from({ length: 64 }, (_, i) => {
    sky.yaw = Math.PI / 4 + (i / 64) * Math.PI * 2;
    skyTurn.placeSun();
    return [sky.yaw, moonGlint()];
  });
for (const [bearing, glint] of glints)
  assert(
    glint < 0.95,
    `At bearing ${bearing.toFixed(2)} the moon sits ${((Math.acos(Math.min(1, glint)) * 360) / Math.PI).toFixed(0)}° off the sea's mirror direction (keep it over 36°; the opening view has 56°): its glint lobe spreads over the water.`,
  );
for (const [bearing, glint] of glints)
  assert(Math.abs(glint - openingGlint) < 1e-6, `At bearing ${bearing.toFixed(2)} the moon has not turned with the camera.`);
// A lost GPU context: three uploads its textures again on a restore but binds the studio light
// (a render target baked on the GPU) as black, so it is baked again and the shadows redrawn.
// A context still lost after the grace period is reported to the page, and so is its return.
const contextPieces = [];
function collectContext(node) {
  if (
    ts.isFunctionDeclaration(node) &&
    ['bakeStudio', 'contextLost', 'contextRestored'].includes(node.name?.text)
  )
    contextPieces.push(node.getText(syntax));
  if (
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((d) => d.name.getText(syntax) === 'CONTEXT_GRACE_MS')
  )
    contextPieces.push(node.getText(syntax));
  ts.forEachChild(node, collectContext);
}
collectContext(syntax);
assert.equal(contextPieces.length, 4, 'The context check must find every piece it runs.');
for (const [event, handler] of [
  ['webglcontextlost', 'contextLost'],
  ['webglcontextrestored', 'contextRestored'],
])
  assert(
    syntax.text.includes(`renderer.domElement.addEventListener('${event}', ${handler})`) &&
      syntax.text.includes(`renderer.domElement.removeEventListener('${event}', ${handler})`),
    `The town must listen for ${event} (and stop on dispose).`,
  );
const bakes = [],
  reports = [],
  pending = new Map();
let timerIds = 0;
const gpu = {
  T: {
    PMREMGenerator: class {
      fromScene(room, sigma) {
        const target = { texture: { bake: bakes.length } };
        bakes.push({ room, sigma, target, generator: this });
        return target;
      }
      dispose() {
        this.disposed = true;
      }
    },
  },
  RoomEnvironment: class {
    dispose() {
      this.disposed = true;
    }
  },
  renderer: {},
  scene: { environment: null },
  window: {
    setTimeout: (callback, ms) => {
      pending.set(++timerIds, { callback, ms });
      return timerIds;
    },
    clearTimeout: (id) => pending.delete(id),
  },
  options: { onLost: (lost) => reports.push(lost) },
  lostTimer: 0,
  studio: null,
  shadowDirty: false,
  warmTimer: 7,
};
const restoring = runInNewContext(
  `${ts.transpileModule(contextPieces.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};studio = bakeStudio();({ contextLost, contextRestored, CONTEXT_GRACE_MS });`,
  gpu,
);
assert.equal(gpu.scene.environment, bakes[0].target.texture, 'The studio light lights the scene.');
assert(bakes[0].room.disposed && bakes[0].generator.disposed, 'A bake keeps no room or generator.');
// Lost and back within the grace period: nothing reported lost; the studio baked again.
restoring.contextLost();
assert.equal(pending.size, 1, 'A lost context starts the grace period.');
assert.equal([...pending.values()][0].ms, restoring.CONTEXT_GRACE_MS);
gpu.shadowDirty = false;
restoring.contextRestored();
assert.equal(pending.size, 0, 'A context back in time is never reported lost.');
assert.equal(bakes.length, 2, 'A restored context bakes the studio light again.');
assert.equal(gpu.scene.environment, bakes[1].target.texture, 'The new studio light lights the scene.');
assert.equal(gpu.studio, bakes[1].target, 'The new bake is the one disposed with the town.');
assert(gpu.shadowDirty, 'A restored context redraws the shadows at once.');
assert.equal(gpu.warmTimer, 0, 'A restored context compiles the lamps’ shaders ahead again.');
assert.deepEqual(reports, [false]);
// Lost for good: reported once the grace period is over, and cleared when it comes back.
restoring.contextLost();
[...pending.values()][0].callback();
assert.deepEqual(reports, [false, true], 'A context lost for good is reported.');
restoring.contextRestored();
assert.deepEqual(reports, [false, true, false], 'Its return is reported too.');
// The frame-time governor: a slow moment lowers the quality, and it comes back once frames are
// fast again, on a 120 Hz screen too, without stepping to and fro.
const governPieces = [];
function collectGovern(node) {
  const text = node.getText?.(syntax) ?? '';
  if (ts.isExpressionStatement(node) && text.startsWith('frameCost = T.MathUtils.lerp(frameCost, dt'))
    governPieces.push(text);
  if (
    ts.isIfStatement(node) &&
    ['dt > 0 && dt < 0.05', 'now - lastGovern > 2500'].includes(node.expression.getText(syntax))
  )
    governPieces.push(text);
  ts.forEachChild(node, collectGovern);
}
collectGovern(syntax);
assert.equal(governPieces.length, 3, 'The governor check must find every piece it runs.');
function runGovernor(costOf, seconds, dip = () => 0) {
  const g = {
    T,
    Math,
    intervals: new Float32Array(120),
    intervalCount: 0,
    frameCost: 0.016,
    refresh: 1 / 60,
    lastGovern: 0,
    quality: 0,
    qualityChanged: 0,
    changes: [],
    applyQuality() {
      g.changes.push(g.quality);
    },
  };
  const govern = runInNewContext(
    `${ts.transpileModule(`function govern(dt, now) { ${governPieces.join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};govern;`,
    g,
  );
  let now = 1000;
  for (let frame = 0; now < 1000 + seconds * 1000; frame++) {
    const dt = Math.min((dip(now / 1000) || costOf(g.quality, frame)) / 1000, 0.05);
    now += dt * 1000;
    govern(dt, now);
  }
  return g;
}
// A 120 Hz screen and a machine that draws about 80 fps (shadow frames miss a vsync, the others
// make it), at full quality and one step down alike; two seconds at 25 fps (a window resize).
const vsync = 1000 / 120,
  mixed = (_quality, frame) => (frame % 2 ? vsync : 2 * vsync),
  dipped = runGovernor(mixed, 120, (t) => (t > 20 && t < 22 ? 40 : 0));
assert(dipped.changes[0] === 1, 'A slow moment lowers the quality.');
assert.equal(dipped.quality, 0, 'Fast frames bring the quality back on a 120 Hz screen.');
assert.deepEqual(dipped.changes, [1, 0], 'The governor stepped to and fro.');
// A slow machine on a 60 Hz screen (frames of one to three vsyncs, about 23, 27, 33, 40 and
// 60 fps from full quality down) settles where it holds 33 fps, and stays there.
const steps = [[1, 3, 3, 3, 3], [1, 3, 2, 3, 2], [1, 2, 2, 2, 2], [1, 2, 1, 2, 1], [1, 1, 1, 1, 1]],
  slow = runGovernor((quality, frame) => (steps[quality][frame % 5] * 1000) / 60, 300);
assert.deepEqual(slow.changes, [1, 2], 'A slow machine steps down once to each level it needs, and no further.');
// Selection adds one depth-aware mask pass; all renderer state survives failure.
const { createCityInk } = await import(
  pathToFileURL(path.join(output, 'city-ink.mjs')).href
);
const scene = new T.Scene(),
  selected = new T.Group();
const visibleMesh = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
const hiddenMesh = visibleMesh.clone();
hiddenMesh.visible = false;
selected.add(visibleMesh, hiddenMesh);
scene.add(selected);
scene.background = new T.Color('#abcabc');
const background = scene.background,
  priorTarget = { name: 'previous' };
let currentTarget = priorTarget,
  compiledInto = null,
  renders = 0,
  failMask = false;
let clearColor = new T.Color('#456456'),
  clearAlpha = 0.7;
const renderer = {
  capabilities: { maxSamples: 4 },
  shadowMap: { autoUpdate: true },
  getPixelRatio: () => 2,
  getRenderTarget: () => currentTarget,
  setRenderTarget: (t) => {
    currentTarget = t;
  },
  getClearColor: (out) => out.copy(clearColor),
  getClearAlpha: () => clearAlpha,
  setClearColor: (c, a) => {
    clearColor = new T.Color(c);
    clearAlpha = a;
  },
  clear() {},
  compileAsync(s) {
    compiledInto = currentTarget;
    return Promise.resolve(s);
  },
  render(s, c) {
    renders++;
    if (s === scene && scene.overrideMaterial) {
      assert(c.layers.isEnabled(31));
      assert(visibleMesh.layers.isEnabled(31));
      assert(!hiddenMesh.layers.isEnabled(31));
      if (failMask) throw new Error('mask failure');
    }
  },
};
const ink = createCityInk(renderer, scene, camera);
ink.resize(960, 600);
ink.render();
assert.equal(renders, 2);
ink.setSelection([selected]);
renders = 0;
ink.render();
assert.equal(renders, 3);
failMask = true;
assert.throws(() => ink.render(), /mask failure/);
assert.equal(currentTarget, priorTarget);
assert.equal(scene.background, background);
assert.equal(scene.overrideMaterial, null);
assert.equal(camera.layers.mask, 1);
assert.equal(visibleMesh.layers.mask, 1);
assert.equal(renderer.shadowMap.autoUpdate, true);
assert.equal(clearColor.getHexString(), '456456');
assert.equal(clearAlpha, 0.7);
failMask = false;
ink.setSelection([]);
renders = 0;
ink.render();
assert.equal(renders, 2);
// Shaders compiled ahead are compiled as the beauty pass draws them: into its own target.
await ink.compile();
assert(compiledInto && compiledInto !== priorTarget, 'Ink compiles into the beauty pass’s target.');
assert.equal(currentTarget, priorTarget, 'Compiling leaves the render target as it was.');
ink.dispose();
visibleMesh.geometry.dispose();
visibleMesh.material.dispose();
console.log(
  `Navigation checks passed: ${ids.length} shared records in both modes, legacy/back-navigation targets, ${nav.readingChapters.length} reading chapters with Departures (the airport's, framed on its island) right after People, a tour of ${nav.tourStops.length} stops ending in the park, ${Object.keys(personPhotos).length} portrait slots (${nav.people.length} members), hidden/visible camera resizing, quick Rotate presses that keep their way round, +/- during a glide, an eased zoom out of Inspect, no idle drift with reduced motion and a drift that stops where it is, a sun shadow redrawn whenever its map is replaced, a quality governor that climbs back after a slow moment, no frame before the first sky, windows put on the clock after hours without frames, a moon that turns with the camera, a studio light baked again after a lost GPU context.`,
);
