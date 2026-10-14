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
// A City file's eyebrow names the place the camera frames, an event's park included.
const { eventRecords } = await import(
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
assert.deepEqual(
  Object.keys(personPhotos).sort((a, b) => a.localeCompare(b)),
  nav.people.map((p) => p.id).sort((a, b) => a.localeCompare(b)),
);
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
// A sun shadow map thrown away (Inspect's sharper map, the town's again, a quality step) or a
// frustum moved elsewhere is drawn again before the next frame uses it, even paused: an empty
// map would put everything in full shadow until the paused cadence came round.
const shadowPieces = [];
function collectShadow(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'shadowFocus')
    shadowPieces.push(node.getText(syntax));
  if (
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((d) => d.name.getText(syntax) === 'shadowSizeFor')
  )
    shadowPieces.push(node.getText(syntax));
  ts.forEachChild(node, collectShadow);
}
collectShadow(syntax);
assert.equal(shadowPieces.length, 2, 'The shadow check must find every piece it runs.');
const shadowSun = new T.DirectionalLight();
Object.assign(shadowSun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34 });
shadowSun.shadow.mapSize.set(1536, 1536);
const shadows = {
  T,
  Math,
  sun: shadowSun,
  shadowBase: 1536,
  quality: 0,
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
drawn();
focusing();
redrawn('Leaving Inspect');
drawn();
focusing();
assert(!shadows.renderer.shadowMap.needsUpdate, 'An unchanged focus costs no extra shadow pass.');
shadows.quality = 2;
focusing();
redrawn('A quality step');
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
  `Navigation checks passed: ${ids.length} shared records in both modes, legacy/back-navigation targets, a tour of ${nav.tourStops.length} stops ending in the park, 3 portrait slots, hidden/visible camera resizing, quick Rotate presses that keep their way round, +/- during a glide, an eased zoom out of Inspect, no idle drift with reduced motion and a drift that stops where it is, a sun shadow redrawn whenever its map is replaced, a quality governor that climbs back after a slow moment, no frame before the first sky, a moon that turns with the camera, a studio light baked again after a lost GPU context.`,
);
