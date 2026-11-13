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
  'town-shared',
  'city-atmosphere',
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
// What the sky island's framing checks found, for the summary.
const skyNav = {};
/**
 * Code without its formatting, to look for a statement in: no whitespace, and no trailing comma
 * before a closing bracket. The repo's formatter (pnpm format, oxfmt) wraps long lines and adds
 * those commas, and a pin on page.tsx's code must not fail on that.
 */
const unformatted = (code) => code.replace(/\s+/g, '').replace(/,(?=[)\]}])/g, '');
/** Whether `code` holds each statement, formatted however (see unformatted). */
const holds = (code, ...statements) => statements.every((s) => unformatted(code).includes(unformatted(s)));
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
// Eleven stops: the gate, the hall, the three homes, the residence, then the sky island (its file's
// bearing is the airport's, so the tour turns no more for it), the airport, the studio, the archive
// and the park.
assert.equal(nav.tourStops.length, 11);
assert.deepEqual(
  nav.tourStops.slice(5),
  ['visiting-phd', 'sky-island', 'airport', 'research-studio', 'city-archive', 'corner-park'],
);
// The sky island has a City file and a bearing of its own but no reading chapter: its address
// reads its host chapter, About (the Town Hall's), whose chip it lights in the masthead; City mode
// faces it from its own bearing; and the reading page never makes it its address, so the reading
// camera keeps to About's own subject.
assert.equal(nav.chapterFor('sky-island'), 'town-hall');
assert.equal(nav.chapterFor('place:sky-island'), 'town-hall');
assert.equal(nav.facingChapter('sky-island'), 'sky-island');
assert.equal(nav.facingChapter('place:sky-island'), 'sky-island');
assert.equal(nav.readingContent('sky-island', 'town-hall'), 'town-hall');
assert.deepEqual(nav.sceneTarget('sky-island'), { building: 'sky-island' });
assert.equal(nav.placeFor('sky-island'), 'sky-island');
assert(!nav.readingChapters.includes('sky-island') && !nav.destinations.includes('sky-island'), 'The sky island has a reading chapter or a masthead chip of its own.');
// A place picked on the model opens in the mode it was picked in, but the sky island, with no chapter
// of its own, opens its City file from the reading page too (#city/sky-island), where its pick would
// only have scrolled to About. pickRoute says where a pick goes: that mode, and the address the
// place opens.
for (const b of buildings) {
  for (const id of [nav.contentForBuilding(b.id), 'place:' + b.id]) {
    assert.equal(nav.modeForPick('city', id), 'city', 'A pick in the city leaves the city: ' + id);
    assert.equal(nav.modeForPick('reading', id), b.id === 'sky-island' ? 'city' : 'reading', 'A reading-page pick of ' + id + ' opens the wrong mode.');
  }
  for (const mode of ['city', 'reading'])
    assert.deepEqual(
      nav.pickRoute(mode, b.id),
      [mode === 'reading' && b.id === 'sky-island' ? 'city' : mode, nav.contentForBuilding(b.id)],
      'A pick of ' + b.id + ' on the ' + mode + ' page goes to the wrong mode or address.',
    );
}
assert.deepEqual(nav.pickRoute('reading', 'sky-island'), ['city', 'sky-island']);
// The page sends every pick on the model through pickRoute: createCity's pick callback (its second
// argument) hands navigate the spread of pickRoute(the page's mode, the place picked). Read from
// page.tsx's syntax tree, so its formatting (pnpm format wraps the call) changes nothing here.
{
  const file = 'app/page.tsx',
    tree = ts.createSourceFile(file, await fs.readFile(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
    text = (node) => node.getText(tree).replace(/\s+/g, ''),
    under = (node, match, out = []) => {
      if (match(node)) out.push(node);
      // (A callback that returns something stops forEachChild.)
      ts.forEachChild(node, (child) => void under(child, match, out));
      return out;
    };
  const [city, ...more] = under(tree, (n) => ts.isCallExpression(n) && text(n.expression) === 'createCity'),
    pick = city?.arguments[1],
    picked = pick && (ts.isArrowFunction(pick) || ts.isFunctionExpression(pick)) && pick.parameters.length === 1 ? text(pick.parameters[0].name) : null;
  const routed =
    !more.length &&
    !!picked &&
    under(
      pick.body,
      (n) =>
        ts.isCallExpression(n) &&
        text(n.expression) === 'navigateRef.current' &&
        n.arguments.length === 1 &&
        ts.isSpreadElement(n.arguments[0]) &&
        ts.isCallExpression(n.arguments[0].expression) &&
        text(n.arguments[0].expression.expression) === 'pickRoute' &&
        n.arguments[0].expression.arguments.map(text).join(',') === 'viewRef.current.mode,' + picked,
    ).length === 1;
  assert(routed, 'A pick on the model no longer goes through pickRoute (page.tsx, createCity’s pick callback): the sky island would not open in the city from the reading page.');
}
// The read-through ends on the whole island once the footer is more than a pixel into the window
// (page.tsx: the argument of the setEnding that reads the footer, from its syntax tree, run against
// footers about the window's foot). The last chapter is at least a screen tall, and opened at its
// top a fraction of a pixel off (as the cards above it leave it) the footer sat 0.22 px inside a
// 1440 x 900 window: About opened on the end shot, not the gate.
{
  const file = 'app/page.tsx',
    tree = ts.createSourceFile(file, await fs.readFile(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
    tests = [];
  (function find(node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'setEnding' && node.arguments.length === 1 && /\bfooter\b/.test(node.arguments[0].getText(tree))) tests.push(node.arguments[0].getText(tree));
    ts.forEachChild(node, find);
  })(tree);
  assert.equal(tests.length, 1, 'The end shot check must find the one setEnding that reads the footer.');
  const test = ts.transpileModule(`(${tests[0]});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    ending = (top, innerHeight) => runInNewContext(test, { footer: top === null ? null : { getBoundingClientRect: () => ({ top }) }, window: { innerHeight } });
  assert(
    [[899.78, 900], [900.19, 900], [1080.05, 1080], [899.5, 900], [null, 900]].every(([top, h]) => !ending(top, h)) &&
      [[890, 900], [649.28, 900], [829.05, 1080]].every(([top, h]) => ending(top, h)),
    'The reading page ends on the whole island with its footer under a pixel into the window, or not once the footer is well in view (page.tsx, setEnding).',
  );
}
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
  holds(await fs.readFile(path.join(root, 'app/page.tsx'), 'utf8'), 'const facing = (id: ContentId) => bearings[facingChapter(id)] ?? bearings.overview;'),
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
    ['viewOffset', 'panelOffset', 'offsetTarget', 'followPanel', 'reset', 'aim', 'elevationAt', 'turnSky', 'skyFile', 'skyPivot'].includes(
      node.name?.text,
    )
  )
    turnPieces.push(node.getText(syntax));
  if (
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((d) =>
      ['shortestAngle', 'YAW_RATE', 'TOWN_PITCH'].includes(d.name.getText(syntax)),
    )
  )
    turnPieces.push(node.getText(syntax).replace(/^export\s+/, ''));
  if (
    ts.isIfStatement(node) &&
    node.expression.getText(syntax) === 'Math.abs(targetYaw - yaw) > 0.0001'
  )
    turnPieces.push(`function turnStep() { ${node.getText(syntax)} }`);
  ts.forEachChild(node, collectTurn);
}
collectTurn(syntax);
assert.equal(turnPieces.length, 14, 'The turn check must find every piece it runs.');
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
  inspect: null,
  pitch: 0,
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
// The camera's pitch: the town's (35 up for 38 out) everywhere but close in on the sky island in its
// own file. viewOffset at the town's pitch is exactly the offset it always was, so every other view
// (the opening one above all) is untouched; the frame loop eases the camera down to the file's pitch
// at the bearing's rate, never past it, as the glide closes in (none while the view is still far
// out), back up as it leaves or zooms out, and under reduced motion in one cut.
{
  let pitchSource;
  (function find(node) {
    if (ts.isBlock(node) && node.statements[0]?.getText(syntax) === 'const left = aim(camera.zoom) - pitch;') pitchSource = `function pitchStep() ${node.getText(syntax)}`;
    ts.forEachChild(node, find);
  })(syntax);
  assert(pitchSource, 'The pitch check must find the frame loop\'s pitch step.');
  turn.pitch = 0;
  for (const b of [0, 0.7, Math.PI / 4, 2.4, 4]) {
    const offset = runInNewContext(`${ts.transpileModule(turnPieces.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};viewOffset(${b}, new T.Vector3());`, { ...turn, T, Math });
    assert(offset.x === Math.sin(b) * 38 && offset.y === 35 && offset.z === Math.cos(b) * 38, `At the town's pitch the camera's offset at bearing ${b} is no longer (sin, 35, cos) x 38.`);
  }
  const step = { Math, T, reduced: false, dt: 1 / 60, YAW_RATE: 2.5, pitch: 0, aligned: 0, camera: { zoom: 2 }, align() { step.aligned++; }, aimed: 1, aim() { return step.aimed; } };
  const pitchStep = runInNewContext(`${ts.transpileModule(pitchSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};pitchStep;`, step);
  let frames = 0;
  for (; frames < 600 && step.pitch < 0.999; frames++) {
    const was = step.pitch;
    pitchStep();
    assert(step.pitch > was && step.pitch <= 1, `The pitch overshoots or stalls at frame ${frames}.`);
  }
  assert(frames > 60 && frames < 200 && step.aligned === frames, `The camera comes down to the sky island's pitch in ${frames} frames (the bearing takes about two seconds), or is not re-aimed as it does.`);
  for (let f = 0; f < 120; f++) pitchStep();
  assert(step.pitch === 1, 'The pitch does not settle on the sky island\'s own.');
  step.aimed = 0;
  pitchStep();
  assert(step.pitch < 1 && step.pitch > 0.9, 'Leaving the sky island\'s file, the pitch jumps back.');
  Object.assign(step, { reduced: true, aimed: 1, pitch: 0 });
  pitchStep();
  assert(step.pitch === 1, 'Under reduced motion the pitch eases rather than cuts.');
}
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
      // The town's pitch (the sky island's file keeps SKY_DRIFT of the drift's angle at its own).
      pitch: 0,
      SKY_DRIFT: 0.6,
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
    holds(
      await fs.readFile(path.join(root, 'app/page.tsx'), 'utf8'),
      `const media = window.matchMedia('(prefers-reduced-motion: reduce)'),
        follow = (event: MediaQueryListEvent) => {
          if (!pauseChosen.current) setPaused(event.matches);
        };
      media.addEventListener('change', follow);
      return () => media.removeEventListener('change', follow);`,
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
    if (ts.isFunctionDeclaration(node) && ['panRegion', 'holdPan', 'viewOffset', 'panelOffset', 'offsetTarget', 'fitOverview', 'fitGroup', 'groupFrame', 'fitFocused', 'skyMarks', 'skyFit', 'focusSky', 'skyFitZoom', 'skyReach', 'elevationAt', 'aim'].includes(node.name?.text))
      pieces.push(node.getText(syntax).replace(/^export\s+/, ''));
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => ['PAN', 'panSubject', 'islandMarks', '[rockX, rockZ]', 'AIRPORT_FIT', 'PANEL_CLEAR', 'SKY_MARKS', 'SKY_LIFT', 'TOWN_PITCH'].includes(d.name.getText(syntax))))
      pieces.push(node.getText(syntax).replace(/^export\s+/, ''));
    ts.forEachChild(node, collect);
  };
  collect(syntax);
  assert.equal(pieces.length, 25, 'The pan and fit check must find every piece it runs.');
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
    // The reading page's overview (its last shot) unless a check says City mode.
    cityMode: false,
    panelEdge: 1,
    // A framing of picked buildings (fitFocused): the sky island's checks give it their models.
    models: new Map(),
    city: { updateMatrixWorld() {} },
    focusedIds: [],
    overviewFit: false,
    inspect: null,
    parkSelected: false,
    // The camera's pitch as it stands (0, the town's: viewOffset), unless a check brings it down.
    pitch: 0,
  };
  const panScript = `${ts.transpileModule(pieces.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};({ panRegion, holdPan, fitOverview, fitGroup, fitFocused, focusSky, skyFitZoom, viewOffset, skyReach, aim, islandMarks, AIRPORT_FIT, SKY_MARKS, SKY_FIT, PAN, SKY_PITCH, TOWN_PITCH });`,
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
    // causeway's line (x 0.5, from z -20 to the deck's south edge), the deck's signed distance, and
    // the sky island's pocket (a disc of 16 round its middle) with the capsule of 8 that links it
    // back to the town (from 30 out along the line between them).
    beyondDeck = (x, z) => plan.airportDistance(x, z),
    skyLink = [(plan.SKY.x * 30) / Math.hypot(plan.SKY.x, plan.SKY.z), (plan.SKY.z * 30) / Math.hypot(plan.SKY.x, plan.SKY.z)],
    beyondSky = (x, z) => Math.min(Math.hypot(x - plan.SKY.x, z - plan.SKY.z) - 16, plan.distanceToSegment([x, z], skyLink, [plan.SKY.x, plan.SKY.z]) - 8),
    // How far a point lies outside the union (negative inside).
    beyond = (x, z) => {
      const along = Math.min(-20, Math.max(plan.AIRPORT.z + plan.AIRPORT.hd, z));
      return Math.min(Math.hypot(x, z) - DISC, Math.hypot(x - plan.AIRPORT_ROAD.x, z - along) - 8, beyondDeck(x, z) - 4, beyondSky(x, z));
    },
    // Whether the sky island's regions are the ones a point is deepest in or nearest to.
    nearSky = (x, z) => {
      const along = Math.min(-20, Math.max(plan.AIRPORT.z + plan.AIRPORT.hd, z));
      return beyondSky(x, z) < Math.min(Math.hypot(x, z) - DISC, Math.hypot(x - plan.AIRPORT_ROAD.x, z - along) - 8, beyondDeck(x, z) - 4);
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
  // the disc's edge, 3.5 off the coast; and 40 out past its west end (from its north-west round to
  // its west) the sky island's pocket is, and there it is held on that pocket's edge.
  for (let a = Math.PI; a <= 2 * Math.PI + 1e-9; a += Math.PI / 36)
    for (const far of [5, 20, 40]) {
      const x = plan.AIRPORT.x + Math.cos(a) * (plan.AIRPORT.hw + far),
        z = plan.AIRPORT.z + Math.sin(a) * (plan.AIRPORT.hd + far),
        [cx, cz] = clamp(x, z),
        onDisc = region(x, z).radius === DISC,
        onSky = nearSky(x, z);
      assert(inside(cx, cz) && (onDisc ? far === 40 && Math.cos(a) > 0.99 && Math.abs(Math.hypot(cx, cz) - DISC) < 1e-6 : onSky ? far >= 20 && Math.cos(a) < -0.5 && Math.abs(beyondSky(cx, cz)) < 1e-6 : beyondDeck(cx, cz) <= 4 + 1e-6), `A pan to ${x.toFixed(1)}, ${z.toFixed(1)} ends ${beyondDeck(cx, cz).toFixed(1)} past the airport's deck.`);
    }
  // The sky island's pocket at the town's pitch: a ring 12.2 out round it, past the ground point of its
  // own file there (11.7 beyond it along the line of sight at any bearing, at 42.6 degrees; 18.7 at the
  // file's own 30, where the pocket widens with it: (c) and (c2) below), lies in it, unclamped; a pan
  // away from it is held to it, or back along its link to the town, never out to open sea.
  {
    const S = plan.SKY;
    for (let b = 0; b < 2 * Math.PI; b += Math.PI / 12) {
      const x = S.x - Math.sin(b) * 12.2,
        z = S.z - Math.cos(b) * 12.2;
      assert(nearSky(x, z) && clamp(x, z).every((c, i) => Math.abs(c - [x, z][i]) < 1e-9), `The sky island's pocket does not hold its file's ground point at bearing ${b.toFixed(2)}.`);
    }
    for (const [x, z] of [[-80, -24], [-52, -60], [-52, 10], [-75, 0], [-70, -45]]) {
      const [cx, cz] = clamp(x, z);
      assert(inside(cx, cz) && Math.hypot(cx - x, cz - z) > 1, `A pan to ${x}, ${z} is not held to the sky island's pocket.`);
    }
    // Its link overlaps both the island's disc and its own pocket, so a visitor can pan back.
    assert(Math.hypot(...skyLink) + 8 > DISC && beyondSky(...skyLink) < 0 && beyond((skyLink[0] + S.x) / 2, (skyLink[1] + S.z) / 2) < 0, 'The sky island\'s pocket is cut off from the town.');
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
      held = { T, Math, plan, camera, controls, shiftApplied: new T.Vector3(), tween: false, panSlack: Infinity, pitch: 0, panPitch: 0 },
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
      pan,
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
        if (deckOut < Math.hypot(g.x, g.z) - DISC && deckOut < Math.hypot(g.x - plan.AIRPORT_ROAD.x, g.z - along) - 8 && deckOut < beyondSky(g.x, g.z)) worst.deck = Math.max(worst.deck, deckOut + 4);
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
  // From a ground point 12.2 beyond the sky island at the town's pitch (its file's own is 11.7 there),
  // a drag out to sea is held in its pocket and a drag toward the town gets there along the link,
  // never jumping or lifting the camera.
  for (const yaw of [Math.PI / 4, plan.chapterBearings['sky-island'], (5 * Math.PI) / 4])
    for (const [x, z] of [[-95, -24], [-52, -75], [-52, 25], [-90, 15], [0, 0]]) {
      const drive = drivePan(yaw),
        ground = new T.Vector3(plan.SKY.x - Math.sin(yaw) * 12.2, 0, plan.SKY.z - Math.cos(yaw) * 12.2);
      drive.held.controls.target.copy(ground);
      drive.held.camera.position.copy(ground).add(new T.Vector3(Math.sin(yaw) * 38, 35, Math.cos(yaw) * 38));
      drive.held.controls.update();
      drive.held.camera.updateMatrixWorld();
      for (let f = 0; f < 500; f++) drive.frame(...drive.toward(x, z));
      for (let f = 0; f < 120; f++) drive.frame();
      const end = drive.ground();
      assert(drive.worst.beyond <= 0.5 && drive.worst.move <= 16 && drive.worst.lift <= scene.PAN.lift + 1, `A drag from the sky island's file toward ${x}, ${z} at bearing ${yaw.toFixed(2)} ends ${drive.worst.beyond.toFixed(2)} out of the pan regions, or jumps ${drive.worst.move.toFixed(0)} px.`);
      if (!x && !z) assert(Math.hypot(end.x, end.z) < DISC, `A drag from the sky island's file back to the town at bearing ${yaw.toFixed(2)} stops at ${end.x.toFixed(1)}, ${end.z.toFixed(1)}.`);
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
    // The sky island's pocket and the sides of its link back to the town.
    for (let a = 0; a < 2 * Math.PI; a += Math.PI / 30) edge.push(new T.Vector3(plan.SKY.x + Math.cos(a) * 16.5, 0, plan.SKY.z + Math.sin(a) * 16.5));
    {
      const [lx, lz] = skyLink,
        l = Math.hypot(plan.SKY.x - lx, plan.SKY.z - lz),
        [nx, nz] = [-(plan.SKY.z - lz) / l, (plan.SKY.x - lx) / l];
      for (let k = 0; k <= 10; k++) for (const s of [-8.5, 8.5]) edge.push(new T.Vector3(lx + ((plan.SKY.x - lx) * k) / 10 + nx * s, 0, lz + ((plan.SKY.z - lz) * k) / 10 + nz * s));
    }
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
  // Beside the reading panel, where it really starts (page.tsx's readingEdge: from 1180 px down the
  // panel is half the window wide and starts at about 46% of it, 45% with a scrollbar, where the
  // frame shift's 0.21 assumes 52%), the island's armour keeps 24 px clear of the panel through the
  // idle drift's +-0.16 and stays whole in the frame: at 1024 x 768 its east end ran 30 px under the
  // panel. Where the shift's own room was enough (1440 and up) nothing moves more than the margin
  // needs, and the zoom keeps its fit.
  {
    const css = await fs.readFile(path.join(root, 'app/globals.css'), 'utf8');
    assert(
      /\n\.chapter \{[^}]*padding: calc\(var\(--masthead\) \+ 28px\) clamp\(16px, 4vw, 56px\) 12vh;/.test(css) &&
        /\n\.panel \{[^}]*width: min\(100%, clamp\(400px, 44vw, 640px\)\);/.test(css) &&
        /@media \(max-width: 1180px\) \{\s*\.panel \{\s*width: min\(100%, clamp\(380px, 50vw, 600px\)\);/.test(css),
      'The reading panel\'s width or the chapter\'s padding changed: the panel check below works them out.',
    );
    // The panel's left edge (px from the stage's left) in a window vw wide with a scrollbar of `bar`.
    const clampPx = (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
      panelLeft = (vw, bar) => {
        const doc = vw - bar,
          pad = clampPx(0.04 * vw, 16, 56),
          wide = vw <= 1180 ? clampPx(0.5 * vw, 380, 600) : clampPx(0.44 * vw, 400, 640);
        return doc - pad - Math.min(doc - 2 * pad, wide);
      },
      armour = plan.airportOutline(plan.AIRPORT.armour, 0.5).map((p) => new T.Vector3(p.x, 0, p.z)),
      bearing = plan.chapterBearings.airport;
    let worst = Infinity;
    for (const [vw, vh] of [[961, 700], [1024, 768], [1080, 800], [1100, 820], [1180, 820], [1181, 820], [1280, 800], [1366, 768], [1440, 900], [1920, 1080]])
      for (const bar of [0, 15]) {
        const w = vw - bar,
          left = panelLeft(vw, bar),
          edge = left / w;
        frame(w, vh, 0.21, bearing);
        scene.fitGroup(scene.AIRPORT_FIT, 0.95, 2.6);
        const plain = { zoom: view.targetZoom, at: view.target.clone() };
        frame(w, vh, 0.21, bearing);
        scene.fitGroup(scene.AIRPORT_FIT, 0.95, 2.6, edge);
        const perUnit = (w * view.targetZoom) / (view.camera.right - view.camera.left);
        for (const drift of [-0.16, -0.08, 0, 0.08, 0.16]) {
          const right = new T.Vector3(Math.cos(bearing + drift), 0, -Math.sin(bearing + drift)),
            xs = armour.map((p) => w / 2 + p.clone().sub(view.target).dot(right) * perUnit),
            east = Math.max(...xs),
            west = Math.min(...xs);
          worst = Math.min(worst, left - east);
          assert(left - east >= 24 && west >= 0, `Beside the reading panel at ${vw} x ${vh}${bar ? ' with a scrollbar' : ''} (drifted ${drift}), the airport's island spans ${west.toFixed(0)} to ${east.toFixed(0)} px, against the panel at ${left.toFixed(0)}.`);
        }
        // Moved only as far as the panel asks: never right, never closer than the margin needs.
        const moved = plain.at.clone().sub(view.target).dot(new T.Vector3(Math.cos(bearing), 0, -Math.sin(bearing))) * perUnit;
        assert(moved <= 1e-6, `Beside the reading panel at ${vw} x ${vh} the airport's island moves right.`);
        if (vw >= 1440) assert(Math.abs(view.targetZoom - plain.zoom) < 1e-9 && -moved <= 20, `At ${vw} x ${vh} the panel's edge moves the airport ${(-moved).toFixed(0)} px or changes its zoom.`);
        if (vw === 1024 && !bar) assert(-moved > 40 && view.targetZoom >= 0.95, `At 1024 x 768 the airport's island moves only ${(-moved).toFixed(0)} px off the panel (zoom ${view.targetZoom.toFixed(3)}).`);
        // Its subject stays in the airport's own pan region, so the glide's end is never pulled back.
        const subject = view.target.clone().sub(view.shiftApplied);
        assert(region(subject.x, subject.z).radius === scene.PAN.deck.reach && inside(subject.x, subject.z), `Beside the reading panel at ${vw} x ${vh} the airport's framing leaves its pan region.`);
      }
    assert(worst >= 24 && worst < 80, `The armour's nearest approach to the reading panel is ${worst.toFixed(0)} px.`);
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
  // The plane never pops in or out of a standard frame: where it is lost on its climb out and where
  // it comes back on its approach, it is off the frame (by its own length) or past the fog (even
  // with the target lowered as far as the pan limit's lift lets it), in the site's own framings on
  // phones, tablets and desktops (the City overview fitted with the file hidden, beside it or above
  // its sheet, beside the reading panel, the airport's chapter and file, the opening view) at every
  // Rotate stop and through the idle drift, and in all of them zoomed out to the widest on the
  // island, the shadow's home or the airport. At 88 s it vanished in view on phones' fitted overview
  // at 5pi/4, on a tablet beside the file and on phones pinched out; at 150 out it came back in
  // view on upright tablets and phones zoomed out at 3pi/4.
  {
    const [fogFar] = /new T\.Fog\('#[0-9a-f]+', \d+, (\d+)\)/.exec(source).slice(1).map(Number),
      give = scene.PAN.lift / (35 / Math.hypot(38, 35)),
      times = plan.PLANE_TIMES,
      edges = [
        ['vanishes', plan.planePose(times.lost - 1e-6)],
        ['comes back', plan.planePose(times.approach)],
      ],
      reach = (plan.PLANE.length / 2) * 1.05,
      phones = [[360, 640], [360, 800], [375, 667], [375, 812], [390, 844], [393, 852], [412, 915], [414, 896], [430, 932]],
      upright = [[768, 1024], [810, 1080], [820, 1180], [834, 1194]],
      wide = [[1024, 1366], [1024, 768], [1180, 820], [1366, 1024], [1280, 720], [1280, 800], [1366, 768], [1440, 900], [1536, 864], [1600, 900], [1680, 1050], [1920, 1080], [2560, 1440]],
      stops = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4],
      // A frame by its camera's bearing (its own, with the drift) and its view centre, at the town's
      // pitch unless told how far the camera has come down toward the sky island's file's (viewOffset).
      seen = (w, h, zoom, bearing, centre, p, low = 0) => {
        const aspect = w / h,
          vertical = Math.max(53, 76 / aspect),
          back = scene.viewOffset(bearing, new T.Vector3(), low),
          forward = back.clone().normalize().negate(),
          right = new T.Vector3(Math.cos(bearing), 0, -Math.sin(bearing)),
          up = new T.Vector3().crossVectors(right, forward),
          rel = new T.Vector3(p.x, p.y, p.z).sub(centre).sub(back);
        return !(Math.abs(rel.dot(right)) > (vertical * aspect) / 2 / zoom + reach || Math.abs(rel.dot(up)) > vertical / 2 / zoom + reach || rel.dot(forward) - give >= fogFar);
      };
    assert(edges.every(([, p]) => p.visible) && plan.planePose(times.lost).phase === 'away' && !plan.planePose(times.lost).visible, 'The check does not look at the last and the first moments the plane shows.');
    let frames = 0;
    const hold = (what, w, h, zoom, bearing, centre, low = 0) => {
      for (const [when, p] of edges)
        for (const drift of [-0.16, -0.08, 0, 0.08, 0.16]) {
          frames++;
          assert(!seen(w, h, zoom, bearing + drift, centre, p, low), `The plane ${when} in view (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) on ${what} at ${w} x ${h}, bearing ${bearing.toFixed(2)} drifted ${drift}.`);
        }
    };
    for (const [w, h] of [...phones, ...upright, ...wide]) {
      const narrow = w < 961;
      // (The overview as the reading page's last shot has it, and as City mode has it: with the sky island.)
      for (const city of [false, true])
        for (const bearing of stops)
          for (const [shift, drop] of narrow ? [[0, 0], [0, -0.26]] : [[0, 0], [(460 + 32) / (2 * w), 0], [0.21, 0]]) {
            frame(w, h, shift, bearing);
            view.frameDrop = drop;
            view.cityMode = city;
            scene.fitOverview();
            hold(`the ${city ? 'City' : 'reading'} overview (shift ${shift.toFixed(2)}, drop ${drop})`, w, h, view.targetZoom, bearing, view.target.clone());
          }
      view.cityMode = false;
      // The sky island's own file, beside its panel or above its sheet, from its own bearing and
      // every Rotate stop (Rotate keeps it framed); and, but on phones, zoomed out from there to the
      // widest. (A phone at 5pi/4 zoomed right out over the island would see the plane lost at the
      // frame's very bottom corner, 0-9 inside it: the timetable has no slack to send it further.)
      // (At the file's own lower pitch, as the camera stands once it has come down; zoomed out to
      // the widest it has risen back to the town's.)
      for (const bearing of [plan.chapterBearings['sky-island'], ...stops])
        for (const [shift, drop] of narrow ? [[0, 0], [0, -0.26]] : [[(460 + 32) / (2 * w), 0]]) {
          frame(w, h, shift, bearing);
          Object.assign(view, { frameDrop: drop, focusedIds: ['sky-island'], pitch: 1 });
          scene.focusSky();
          hold('the sky island’s file', w, h, view.targetZoom, bearing, view.target.clone(), 1);
          if (w >= 768) hold('the widest zoom on the sky island', w, h, 0.45, bearing, view.target.clone(), 0);
          Object.assign(view, { focusedIds: [], pitch: 0 });
        }
      view.frameDrop = 0;
      for (const [shift, drop] of narrow ? [[0, 0], [0, -0.26]] : [[0.21, 0], [(460 + 32) / (2 * w), 0]]) {
        frame(w, h, shift, plan.chapterBearings.airport);
        view.frameDrop = drop;
        scene.fitGroup(scene.AIRPORT_FIT, 0.95, 2.6);
        hold('the airport’s framing', w, h, view.targetZoom, plan.chapterBearings.airport, view.target.clone());
      }
      view.frameDrop = 0;
      if (!narrow) {
        // The opening view: the island's centre at zoom 1, the hero's frame shift.
        const shift = new T.Vector3(Math.cos(Math.PI / 4), 0, -Math.sin(Math.PI / 4)).multiplyScalar(-0.06 * ((Math.max(53, (76 * h) / w) * w) / h));
        hold('the opening view', w, h, 1, Math.PI / 4, shift);
      }
      for (const centre of [new T.Vector3(), new T.Vector3(-3.5, 0, -13.5), new T.Vector3(plan.AIRPORT.x, 0, plan.AIRPORT.z)])
        for (const bearing of [...stops, plan.chapterBearings.airport]) hold('the widest zoom', w, h, 0.45, bearing, centre);
    }
    assert(frames > 6000, `The plane check looks at only ${frames} frames.`);
  }
  // The sky island in the scene's own framings (sky-placement.md sections 2 and 5): the opening
  // view without it, City mode's overview with it, its own file beside the panel or above the sheet
  // through the idle drift, and the reading page's frames, which keep it out of sight or hide it.
  {
    const S = plan.SKY,
      fileBearing = plan.chapterBearings['sky-island'],
      stops = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4],
      drifts = Array.from({ length: 17 }, (_, k) => -0.16 + k * 0.02),
      // Its silhouette: the overview's marks, its rim's widest ring dense; and the clouds' and rocks'
      // slots as points on check-town's FLOAT_PROXY volumes round them, which hold lane G's pieces
      // through their whole drift and bob (units of the slot's size): a cloud inside an upright wall on
      // an ellipse 2.55 by 1.12, from 0.07 under its base to 0.4 over it, under a dome 1.1 high; a rock
      // inside an ellipsoid 1.3 across, 1.2 up and 1.8 down.
      outline = [...scene.SKY_MARKS, ...plan.skyOutline(0, 64).map((p) => new T.Vector3(p.x, S.top - S.ring, p.z))],
      floatAt = (f, x, y, z) => new T.Vector3(f.x + (x * Math.cos(f.ry) + z * Math.sin(f.ry)) * f.size, f.y + y * f.size, f.z + (-x * Math.sin(f.ry) + z * Math.cos(f.ry)) * f.size),
      floats = [
        ...plan.SKY_CLOUDS.flatMap((f) =>
          Array.from({ length: 24 }, (_, k) => [Math.cos((k / 24) * Math.PI * 2), Math.sin((k / 24) * Math.PI * 2)]).flatMap(([c, s]) => [
            ...[-0.07, 0.4].map((y) => floatAt(f, c * 2.55, y, s * 1.12)),
            ...[1, 2, 3, 4, 5, 6].map((b) => floatAt(f, c * 2.55 * Math.cos((b / 6) * (Math.PI / 2)), 0.4 + Math.sin((b / 6) * (Math.PI / 2)) * 1.1, s * 1.12 * Math.cos((b / 6) * (Math.PI / 2)))),
          ]),
        ),
        ...plan.SKY_ROCKS.flatMap((f) =>
          Array.from({ length: 24 }, (_, k) => [Math.cos((k / 24) * Math.PI * 2), Math.sin((k / 24) * Math.PI * 2)]).flatMap(([c, s]) =>
            Array.from({ length: 9 }, (_, b) => (b / 8) * Math.PI - Math.PI / 2).map((w) => floatAt(f, c * 1.3 * Math.cos(w), Math.sin(w) * (w > 0 ? 1.2 : 1.8), s * 1.3 * Math.cos(w))),
          ),
        ),
      ],
      shape = [...outline, ...floats],
      // A point's place (px from the frame's top left) in a w x h frame whose camera looks at `centre`
      // from `bearing` at `zoom`, at the town's pitch unless given the camera's elevation.
      px = (w, h, zoom, bearing, centre, p, pitch = scene.TOWN_PITCH) => {
        const per = (h * zoom) / Math.max(53, (76 * h) / w),
          back = pitch === scene.TOWN_PITCH ? new T.Vector3(Math.sin(bearing) * 38, 35, Math.cos(bearing) * 38).normalize() : new T.Vector3(Math.sin(bearing) * Math.cos(pitch), Math.sin(pitch), Math.cos(bearing) * Math.cos(pitch)),
          right = new T.Vector3(Math.cos(bearing), 0, -Math.sin(bearing)),
          up = new T.Vector3().crossVectors(back, right),
          d = p.clone().sub(centre);
        return [w / 2 + d.dot(right) * per, h / 2 - d.dot(up) * per];
      },
      // The convex outline of screen points, and whether it overlaps the rectangle [x0, x1] x [y0, y1] (separating axes).
      hull = (points) => {
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
      },
      overlaps = (outlinePx, [x0, y0, x1, y1]) => {
        const rect = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
          axes = [[1, 0], [0, 1], ...outlinePx.map((p, i) => [outlinePx[(i + 1) % outlinePx.length][1] - p[1], p[0] - outlinePx[(i + 1) % outlinePx.length][0]])];
        return axes.every(([ax, ay]) => {
          const a = outlinePx.map(([x, y]) => x * ax + y * ay),
            b = rect.map(([x, y]) => x * ax + y * ay);
          return Math.max(...a) > Math.min(...b) && Math.max(...b) > Math.min(...a);
        });
      },
      box = (points) => points.reduce(([x0, y0, x1, y1], [x, y]) => [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)], [Infinity, Infinity, -Infinity, -Infinity]),
      desktops = [[1024, 768], [1180, 820], [1280, 720], [1280, 800], [1366, 768], [1440, 900], [1536, 864], [1600, 900], [1680, 1050], [1920, 1080], [2560, 1440], [3440, 1440]];

    // (a) The opening view (reset(): the island's centre at zoom 1, the hero's frame shift) never
    // shows it, on any desktop, laptop or wide tablet, at any moment of the idle drift.
    for (const [w, h] of desktops) {
      const centre = new T.Vector3(Math.cos(Math.PI / 4), 0, -Math.sin(Math.PI / 4)).multiplyScalar(-0.06 * ((Math.max(53, (76 * h) / w) * w) / h));
      for (const d of drifts) assert(!overlaps(hull(shape.map((p) => px(w, h, 1, Math.PI / 4 + d, centre, p))), [0, 0, w, h]), `The opening view shows the sky island at ${w} x ${h}, drifted ${d.toFixed(2)}.`);
    }

    // (b) City mode's overview takes it in (the reading page's last shot does not: see above). Beside
    // the file at 1440 x 900 at the opening bearing the zoom is today's; 16:9 screens give some up
    // (0.78 of it at 1920 x 1080), and with the file hidden it is 0.76 at every desktop size; the
    // other stops lose a tenth at most. At rest the island is whole in the part of the frame the
    // file and the page's bands leave free, from 1280 wide (at 1024 and 1180 the overviews sit at
    // the widest zoom, as they did); through the idle drift nine tenths of it stay in the frame (at
    // the drift's extreme the chimneys slide up past the top edge, under the masthead's band, by 22
    // px at most, on the widest screens at 3pi/4 with the file hidden). Its clouds and rocks never
    // widen the overview (they hang on the town's side, inside the town's own box). The fog all but
    // never touches it: 5% at most at rest; at the opening bearing the drift turns the view about a
    // centre far east of it (the file's offset), and at the drift's extreme it takes 15% at most.
    const overviewAt = (w, h, shift, bearing, city) => {
      frame(w, h, shift, bearing);
      view.frameDrop = 0;
      view.cityMode = city;
      scene.fitOverview();
      view.cityMode = false;
      return { zoom: view.targetZoom, centre: view.target.clone() };
    };
    const ratio = (w, h, shift, bearing) => overviewAt(w, h, shift, bearing, true).zoom / overviewAt(w, h, shift, bearing, false).zoom;
    assert(Math.abs(ratio(1440, 900, 492 / 2880, Math.PI / 4) - 1) < 1e-9, 'City mode\'s default view at 1440 x 900 no longer keeps today\'s zoom.');
    assert(Math.abs(ratio(1920, 1080, 492 / 3840, Math.PI / 4) - 0.783) < 0.01, `City mode's default view at 1920 x 1080 keeps ${ratio(1920, 1080, 492 / 3840, Math.PI / 4).toFixed(3)} of today's zoom.`);
    const fog = { rest: 0, drift: 0 };
    let worstCut = 1;
    for (const [w, h] of desktops)
      for (const open of [false, true])
        for (const bearing of stops) {
          const shift = open ? 492 / (2 * w) : 0,
            r = ratio(w, h, shift, bearing);
          assert(r > (bearing === Math.PI / 4 ? 0.75 : 0.88) - 1e-9 && r <= 1 + 1e-9, `City mode's overview at ${w} x ${h}${open ? ' beside the file' : ''} at bearing ${bearing.toFixed(2)} keeps ${r.toFixed(3)} of today's zoom.`);
          const { zoom, centre } = overviewAt(w, h, shift, bearing, true),
            right = w - (open ? 476 : 0);
          // The floats inside the overview's box: adding them changes nothing.
          scene.SKY_MARKS.push(...floats);
          const withFloats = overviewAt(w, h, shift, bearing, true);
          scene.SKY_MARKS.splice(scene.SKY_MARKS.length - floats.length);
          assert(Math.abs(withFloats.zoom - zoom) < 1e-9 && withFloats.centre.distanceTo(centre) < 1e-9, `The sky island's clouds and rocks widen City mode's overview at ${w} x ${h} at bearing ${bearing.toFixed(2)}.`);
          for (const d of [0, -0.16, -0.08, 0.08, 0.16]) {
            const [x0, y0, x1, y1] = box(shape.map((p) => px(w, h, zoom, bearing + d, centre, p)));
            if (!d && w >= 1280) assert(x0 >= 0 && x1 <= right && y0 >= 76 - 0.5 && y1 <= h - 76 + 0.5, `In City mode's overview at ${w} x ${h}${open ? ' beside the file' : ''} at bearing ${bearing.toFixed(2)} the sky island spans ${[x0, y0, x1, y1].map((n) => n.toFixed(0)).join(', ')} px.`);
            else if (w >= 1280) worstCut = Math.min(worstCut, (Math.min(x1, w) - Math.max(x0, 0)) / (x1 - x0), (Math.min(y1, h) - Math.max(y0, 0)) / (y1 - y0));
            // The fog (72 to 150 along the line of sight) over its farthest point.
            const back = new T.Vector3(Math.sin(bearing + d) * 38, 35, Math.cos(bearing + d) * 38);
            for (const p of shape) {
              const f = (back.length() - p.clone().sub(centre).dot(back.clone().normalize()) - 72) / (150 - 72);
              if (d) fog.drift = Math.max(fog.drift, f);
              else fog.rest = Math.max(fog.rest, f);
            }
          }
        }
    assert(worstCut >= 0.9, `Through the idle drift only ${(worstCut * 100).toFixed(0)}% of the sky island stays in City mode's overview.`);
    assert(fog.rest <= 0.05 && fog.drift <= 0.15, `The fog reaches ${fog.rest.toFixed(3)} at rest (and ${fog.drift.toFixed(3)} through the drift) over the sky island in City mode's overview.`);
    skyNav.overview = `the fog ${(fog.rest * 100).toFixed(1)}% at rest, ${(worstCut * 100).toFixed(0)}% of it in frame through the drift`;

    // (c) Its own file, at its own lower pitch (city-scene's SKY_PITCH, 30 degrees; from the town's
    // 42.6 its rock showed as a fringe under the deck): framed as the camera will stand once it has
    // come down (aim() 1 for the island alone, the pitch at 1), SKY_FIT fitted like a group between
    // 0.95 and 2.6 (2.035 at 1440 x 900; 2.019 at the town's pitch), its target then raised SKY_LIFT
    // up the line of sight: under the pan limit's lift (a glide's end never slides the camera) with
    // its ground point, 18.7 beyond the island at that pitch (11.7 at the town's), in the island's own pocket
    // (skyReach: as much further out as the line of sight runs at that pitch), unclamped. The
    // island, its clouds and rocks with it, stay whole beside the file, 24 px clear of the masthead,
    // the controls and the panel, through the idle drift; on phones, at the zoom's cap, above the
    // file's sheet (its top at 69% of the stage, as the page lays it out).
    const filePitch = scene.SKY_PITCH,
      fileBack = (bearing) => new T.Vector3(Math.sin(bearing) * Math.cos(filePitch), Math.sin(filePitch), Math.cos(bearing) * Math.cos(filePitch)),
      fileAt = (w, h, shift, drop) => {
        frame(w, h, shift, fileBearing);
        view.frameDrop = drop;
        view.panelEdge = 1;
        view.focusedIds = ['sky-island'];
        view.pitch = 1;
        scene.focusSky();
        const subject = view.target.clone().sub(view.shiftApplied),
          ground = subject.clone().addScaledVector(fileBack(fileBearing), -subject.y / fileBack(fileBearing).y),
          out = { zoom: view.targetZoom, centre: view.target.clone(), subject, ground, reach: scene.skyReach(), held: clamp(ground.x, ground.z) };
        Object.assign(view, { frameDrop: 0, focusedIds: [], pitch: 0 });
        return out;
      };
    assert(filePitch > (28 * Math.PI) / 180 - 1e-9 && filePitch < (34 * Math.PI) / 180 && scene.TOWN_PITCH === Math.atan2(35, 38), 'The sky island\'s file no longer comes down to about 30 degrees, or the town\'s pitch moved.');
    // (Its idle drift turns SKY_DRIFT as far as the town's: city-scene reads it off the pitch. Its
    // own drift code (driftAt, above) run idle through the drift's minute and a half, a second
    // apart, each frame long enough to reach its target (blend 3): at the town's pitch it swings
    // 0.16 either way (drifts, above), at the island's (pitch 1) SKY_DRIFT of that throughout.)
    const SKY_DRIFT = Number(/\bSKY_DRIFT = ([\d.]+)[,;]/.exec(source)?.[1]),
      fileDrifts = drifts.map((d) => d * SKY_DRIFT),
      swing = (pitch) => Array.from({ length: 90 }, (_, time) => driftAt(false, { time, pitch, SKY_DRIFT, blend: 3 })),
      [townSwing, skySwing] = [swing(0), swing(1)];
    assert(SKY_DRIFT > 0.4 && SKY_DRIFT <= 1 && Math.abs(Math.max(...townSwing.map(Math.abs)) - 0.16) < 2e-4 && skySwing.every((d, k) => Math.abs(d - SKY_DRIFT * townSwing[k]) < 1e-12), 'The idle drift no longer keeps SKY_DRIFT of its angle at the sky island\'s pitch.');
    for (const [w, h] of [[1024, 768], [1280, 800], [1366, 768], [1440, 900], [1536, 864], [1920, 1080], [2560, 1440]]) {
      const { zoom, centre, subject, ground, reach, held } = fileAt(w, h, 492 / (2 * w), 0),
        out = Math.hypot(ground.x - S.x, ground.z - S.z);
      assert(zoom >= 1.65 && zoom <= 2.25 && (w !== 1440 || Math.abs(zoom - 2.035) < 0.01), `The sky island's file fits at ${zoom.toFixed(3)} at ${w} x ${h}.`);
      assert(Math.abs(subject.y - 6.5) < 1e-9 && subject.y <= scene.PAN.lift - 1 && out < reach - 3 && held.every((c, i) => Math.abs(c - [ground.x, ground.z][i]) < 1e-9), `The sky island's file at ${w} x ${h} frames ${ground.x.toFixed(1)}, ${ground.z.toFixed(1)} (${out.toFixed(1)} out, its pocket ${reach.toFixed(1)}) from ${subject.y.toFixed(2)} up, outside its pocket or over the pan limit's lift.`);
      if (w === 1440) skyNav.ground = out;
      for (const d of fileDrifts) {
        const [x0, y0, x1, y1] = box(shape.map((p) => px(w, h, zoom, fileBearing + d, centre, p, filePitch)));
        assert(x0 >= 24 && x1 <= w - 476 - 24 && y0 >= 76 + 24 && y1 <= h - 76 - 24, `Drifted ${d.toFixed(2)}, the sky island's file at ${w} x ${h} spans ${[x0, y0, x1, y1].map((n) => n.toFixed(0)).join(', ')} px.`);
      }
    }
    for (const [w, h] of [[390, 844], [430, 932]]) {
      const sheet = 0.69 * h,
        { zoom, centre } = fileAt(w, h, 0, ((76 + sheet) / 2 - h / 2) / h);
      assert(Math.abs(zoom - 2.6) < 1e-9, `The sky island's file on a ${w} x ${h} phone fits at ${zoom.toFixed(3)}.`);
      for (const d of fileDrifts) {
        const [x0, y0, x1, y1] = box(shape.map((p) => px(w, h, zoom, fileBearing + d, centre, p, filePitch)));
        assert(x0 >= 12 && x1 <= w - 12 && y0 >= 76 + 12 && y1 <= sheet - 12, `Drifted ${d.toFixed(2)}, the sky island's file on a ${w} x ${h} phone spans ${[x0, y0, x1, y1].map((n) => n.toFixed(0)).join(', ')} px.`);
      }
    }
    // Where the camera settles in the file (aim at the file's own zoom): at the island's pitch on
    // desktops and phones upright, and where it did on the 768 x 1024 tablet, its fit inside SKY_CLOSE
    // (0.908 of the way down at 1.525, above its sheet: fileFrame's drop of -0.2629). On a phone on its
    // side the file is a panel down the right (min(340, 42vw) wide, 12 from the edge: fileFrame's
    // shift is that and its 28 px of margin and gutter over twice the width) and the bars' rows take
    // the stage's foot (their top 124 above it, the masthead's foot at 58: a drop of -33 / h). Its fit,
    // 1.20 to 1.25, fell inside SKY_CLOSE too, which kept it at the town's pitch, its rock a thin plate
    // under the deck (the 3D review's fifth finding): aim() makes the shortfall up from the fit, so the
    // camera settles at the island's pitch near enough (0.95 of the way down at least) and the island,
    // its clouds and rocks with it, stays whole between the masthead and the bars and clear of the
    // panel (8 px), at every Rotate stop and through the idle drift.
    const settles = (w, h, shift, drop, bearing = fileBearing) => {
        frame(w, h, shift, bearing);
        Object.assign(view, { frameDrop: drop, panelEdge: 1, focusedIds: ['sky-island'], pitch: 1 });
        scene.focusSky();
        const out = { zoom: view.targetZoom, centre: view.target.clone(), low: scene.aim(view.targetZoom) };
        // (aim's fit is the very zoom focusSky frames the island at.)
        assert(Math.abs(scene.skyFitZoom() - out.zoom) < 1e-12, `At ${w} x ${h} the sky island's fit for its pitch (${scene.skyFitZoom().toFixed(4)}) is not the zoom its file frames it at (${out.zoom.toFixed(4)}).`);
        Object.assign(view, { frameDrop: 0, focusedIds: [], pitch: 0 });
        return out;
      },
      landscapeFiles = [[667, 375], [740, 360], [812, 375], [844, 390], [852, 393], [896, 414], [915, 412], [932, 430]].map(([w, h]) => [w, h, (Math.min(340, 0.42 * w) + 28) / (2 * w), -33 / h]);
    for (const [w, h, shift, drop, zoom, low] of [[1440, 900, 492 / 2880, 0, 2.035, 1], [1366, 657, 492 / 2732, 0, 1.882, 1], [768, 1024, 0, -0.2629, 1.525, 0.908], [390, 844, 0, -100.95 / 844, 2.6, 1]]) {
      const at = settles(w, h, shift, drop);
      assert(Math.abs(at.zoom - zoom) < 0.01 && Math.abs(at.low - low) < 0.01, `The sky island's file at ${w} x ${h} settles at zoom ${at.zoom.toFixed(3)}, ${at.low.toFixed(3)} of the way down to its pitch (${zoom}, ${low} before).`);
    }
    let sidewaysLow = 1;
    for (const [w, h, shift, drop] of landscapeFiles)
      for (let stop = 0; stop < 4; stop++) {
        const bearing = fileBearing + (stop * Math.PI) / 2,
          { zoom, centre, low } = settles(w, h, shift, drop, bearing),
          elevation = scene.TOWN_PITCH + (filePitch - scene.TOWN_PITCH) * low;
        sidewaysLow = Math.min(sidewaysLow, low);
        assert(zoom > 1.19 && zoom < 1.26 && low >= 0.95, `The sky island's file on a ${w} x ${h} phone on its side${stop ? ` at Rotate stop ${stop}` : ''} fits at ${zoom.toFixed(3)} and settles ${low.toFixed(3)} of the way down to its pitch.`);
        for (const d of [0, ...fileDrifts]) {
          const [x0, y0, x1, y1] = box(shape.map((p) => px(w, h, zoom, bearing + d, centre, p, elevation)));
          assert(x0 >= 12 && x1 <= w - Math.min(340, 0.42 * w) - 12 - 8 && y0 >= 58 + 8 && y1 <= h - 124 - 8, `Drifted ${d.toFixed(2)}${stop ? ` at Rotate stop ${stop}` : ''}, the sky island's file on a ${w} x ${h} phone on its side spans ${[x0, y0, x1, y1].map((n) => n.toFixed(0)).join(', ')} px.`);
        }
      }
    // Zoomed out of the file (the zoom easing as a glide eases it, to under SKY_CLOSE and under three
    // quarters of the fit), the frame loop's own pitch step, heading for aim at the camera's zoom each
    // frame, takes the camera back up to the town's pitch: every frame a little higher, none more than
    // a twenty-fifth of the way, on a phone on its side as on a desktop; and zoomed back in, down
    // again to where the file settles.
    {
      let pitchSource;
      (function find(node) {
        if (ts.isBlock(node) && node.statements[0]?.getText(syntax) === 'const left = aim(camera.zoom) - pitch;') pitchSource = `function pitchStep() ${node.getText(syntax)}`;
        ts.forEachChild(node, find);
      })(syntax);
      assert(pitchSource, 'The zoom-out check must find the frame loop\'s pitch step.');
      for (const [w, h, shift, drop] of [[1440, 900, 492 / 2880, 0], [1280, 720, 492 / 2560, 0], landscapeFiles[0], landscapeFiles[3], landscapeFiles[7]]) {
        const { zoom: fit, low } = settles(w, h, shift, drop);
        frame(w, h, shift, fileBearing);
        Object.assign(view, { frameDrop: drop, panelEdge: 1, focusedIds: ['sky-island'] });
        const step = { Math, T, reduced: false, dt: 1 / 60, YAW_RATE: 2.5, pitch: low, camera: { zoom: fit }, align() {}, aim: (zoom) => scene.aim(zoom) },
          pitchStep = runInNewContext(`${ts.transpileModule(pitchSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};pitchStep;`, step),
          blend = 1 - Math.exp(-5.5 / 60),
          ease = (goal, way) => {
            let most = 0,
              steady = true;
            for (let f = 0; f < 600; f++) {
              step.camera.zoom += (goal - step.camera.zoom) * blend;
              const was = step.pitch;
              pitchStep();
              most = Math.max(most, Math.abs(step.pitch - was));
              steady &&= way * (step.pitch - was) >= -1e-12;
            }
            return { most, steady };
          },
          out = ease(Math.min(1.15, 0.7 * fit), -1),
          rest = step.pitch,
          back = ease(fit, 1);
        // (And what it heads for has no step in it: aim at the zoom, from half the fit to past it.)
        let slope = 0;
        for (let zoom = 0.5 * fit; zoom < 1.1 * fit; zoom += 0.001) slope = Math.max(slope, Math.abs(scene.aim(zoom + 0.001) - scene.aim(zoom)) / 0.001);
        assert(slope < 10, `In the sky island's file at ${w} x ${h} the pitch the camera heads for changes ${slope.toFixed(1)} times as fast as the zoom.`);
        assert(out.steady && out.most < 0.045 && rest < 0.005, `Zoomed out of the sky island's file at ${w} x ${h}, the camera's pitch ends ${rest.toFixed(3)} of the way down, or turns back, or ${out.most.toFixed(3)} in a frame.`);
        assert(back.steady && back.most < 0.045 && Math.abs(step.pitch - low) < 0.005, `Zoomed back into the sky island's file at ${w} x ${h}, the camera's pitch ends at ${step.pitch.toFixed(3)} for ${low.toFixed(3)}.`);
        Object.assign(view, { frameDrop: 0, focusedIds: [] });
      }
    }

    // (c2) From the file, at its pitch (the pocket as far out as skyReach has it there): a drag out to
    // sea is held in its pocket and a drag toward the town gets there along the link, never jumping
    // or lifting the camera; and every frame of it close in (from SKY_CLOSE's first zoom, where the
    // camera starts to come down, to its own, at every bearing, with its ground point anywhere on
    // that pitch's pocket's edge) has the sea past its edges short of the fog.
    {
      const { ground: fileGround } = fileAt(1440, 900, 492 / 2880, 0),
        D = Math.hypot(fileGround.x - S.x, fileGround.z - S.z);
      for (const yaw of [Math.PI / 4, fileBearing, (5 * Math.PI) / 4])
        for (const [x, z] of [[-110, -24], [-52, -95], [-52, 40], [-100, 20], [0, 0]]) {
          const drive = drivePan(yaw),
            start = new T.Vector3(S.x - Math.sin(yaw) * D, 0, S.z - Math.cos(yaw) * D);
          drive.held.pitch = 1;
          drive.held.controls.target.copy(start);
          drive.held.camera.position.copy(start).add(scene.viewOffset(yaw, new T.Vector3(), 1));
          drive.held.controls.update();
          drive.held.camera.updateMatrixWorld();
          for (let f = 0; f < 500; f++) drive.frame(...drive.toward(x, z));
          for (let f = 0; f < 120; f++) drive.frame();
          const end = drive.ground(),
            out = Math.hypot(end.x - S.x, end.z - S.z),
            reach = (16 * Math.tan(scene.TOWN_PITCH)) / Math.tan(filePitch);
          assert(drive.worst.move <= 16 && drive.worst.lift <= scene.PAN.lift + 1 && (beyond(end.x, end.z) <= 0.5 || out <= reach + 0.5), `A drag from the sky island's file at its pitch toward ${x}, ${z} at bearing ${yaw.toFixed(2)} ends ${out.toFixed(1)} from the island (its pocket ${reach.toFixed(1)}), or jumps ${drive.worst.move.toFixed(0)} px.`);
          if (!x && !z) assert(Math.hypot(end.x, end.z) < DISC, `A drag from the sky island's file at its pitch back to the town at bearing ${yaw.toFixed(2)} stops at ${end.x.toFixed(1)}, ${end.z.toFixed(1)}.`);
        }
      const { SEA_SIZE } = await import(pathToFileURL(path.join(output, 'city-water.mjs')).href),
        [fogNear, fogFar] = /new T\.Fog\('#[0-9a-f]+', (\d+), (\d+)\)/.exec(source).slice(1).map(Number);
      // One frame at `zoom` and `low` of the way down to the file's pitch, from bearing `b`, its view
      // centre the panel offset (`shift`, `drop`: panelOffset) from a ground point `reach` out from
      // the island at angle `a`: how far out its corners see the sea short of the fog and the near
      // plane, and how deep into the fog its farthest corner lies with the target lifted as far as the
      // pan limit lets it (which only moves the depths).
      let seaReach = 0;
      const seaFrame = (w, h, shift, drop, zoom, low, b, a, reach) => {
        const aspect = w / h,
          vertical = Math.max(53, 76 / aspect),
          halfW = (vertical * aspect) / 2 / zoom,
          halfH = vertical / 2 / zoom,
          back = scene.viewOffset(b, new T.Vector3(), low),
          right = new T.Vector3(Math.cos(b), 0, -Math.sin(b)),
          up = new T.Vector3().crossVectors(back.clone().normalize(), right),
          forward = back.clone().normalize().negate(),
          eye = new T.Vector3(S.x + Math.cos(a) * reach, 0, S.z + Math.sin(a) * reach).addScaledVector(right, shift * 2 * halfW).addScaledVector(up, drop * 2 * halfH).add(back);
        let fog = 0;
        for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const from = eye.clone().addScaledVector(right, u * halfW).addScaledVector(up, v * halfH),
            t = (0.07 - from.y) / forward.y;
          fog = Math.max(fog, (t + scene.PAN.lift / -forward.y - fogNear) / (fogFar - fogNear));
          if (t <= -200 || t >= fogFar) continue;
          const x = from.x + forward.x * t,
            z = from.z + forward.z * t;
          seaReach = Math.max(seaReach, Math.abs(x), Math.abs(z));
        }
        return fog;
      };
      for (const zoom of [1.2, 1.4, 1.6, 2.6]) {
        const low = T.MathUtils.smoothstep(zoom, 1.2, 1.6),
          reach = 16 * (low ? Math.tan(scene.TOWN_PITCH) / Math.tan(scene.TOWN_PITCH + (filePitch - scene.TOWN_PITCH) * low) : 1) + 0.5;
        for (const [w, h, drop] of [[390, 844, -0.26], [430, 932, -0.26], [820, 1180, -0.2], [1024, 768, 0], [1440, 900, 0], [2560, 1440, 0]])
          for (let b = 0; b < 2 * Math.PI; b += Math.PI / 12) for (let a = 0; a < 2 * Math.PI; a += Math.PI / 8) seaFrame(w, h, 0, drop, zoom, low, b, a, reach);
      }
      // And on a phone on its side, where the file now comes down at its own fit (aim): from that fit
      // down to seven tenths of it, the camera at the pitch it heads for there, every bearing a turn or
      // the idle drift can bring and its ground point anywhere on that pitch's pocket's edge. The sea
      // fills the frame, and the fog closes in on no corner of it further than on the corners of the
      // same phone's own widest view of the town (zoom 0.45, at the town's pitch).
      const sideways = { fog: 0, town: 0 };
      for (const [w, h, shift, drop] of landscapeFiles) {
        frame(w, h, shift, fileBearing);
        Object.assign(view, { frameDrop: drop, panelEdge: 1, focusedIds: ['sky-island'], pitch: 1 });
        scene.focusSky();
        const fit = view.targetZoom,
          widest = seaFrame(w, h, 0, 0, 0.45, 0, fileBearing, 0, 0);
        sideways.town = Math.max(sideways.town, widest);
        for (const k of [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7]) {
          const zoom = fit * k,
            low = scene.aim(zoom),
            reach = 16 * (low ? Math.tan(scene.TOWN_PITCH) / Math.tan(scene.TOWN_PITCH + (filePitch - scene.TOWN_PITCH) * low) : 1) + 0.5;
          for (let b = 0; b < 2 * Math.PI; b += Math.PI / 48)
            for (let a = 0; a < 2 * Math.PI; a += Math.PI / 8) {
              const fog = seaFrame(w, h, shift, drop, zoom, low, b, a, reach);
              sideways.fog = Math.max(sideways.fog, fog);
              assert(fog < widest, `On a ${w} x ${h} phone on its side, the sky island's file zoomed to ${zoom.toFixed(3)} (${low.toFixed(2)} of the way down) at bearing ${b.toFixed(2)} sees a corner ${(fog * 100).toFixed(0)}% into the fog, ${(widest * 100).toFixed(0)}% at its widest view of the town.`);
            }
        }
        Object.assign(view, { frameDrop: 0, focusedIds: [], pitch: 0 });
      }
      skyNav.sideways = `on phones on their side at its own fit, ${(sidewaysLow * 100).toFixed(1)}% of the way down at least, the island whole and its corners ${(sideways.fog * 100).toFixed(0)}% into the fog at most (${(sideways.town * 100).toFixed(0)}% in their widest view of the town)`;
      assert(seaReach < SEA_SIZE / 2 - 10, `Close in on the sky island at its pitch the frame sees ${seaReach.toFixed(0)} out, past the sea's ${SEA_SIZE / 2}.`);
      skyNav.file = `at its own pitch (${((filePitch * 180) / Math.PI).toFixed(0)} degrees, its ground point ${D.toFixed(1)} out in a pocket of ${((16 * Math.tan(scene.TOWN_PITCH)) / Math.tan(filePitch)).toFixed(1)})`;
    }

    // (c2b) Zoomed out from the pocket's edge (the 3D review's seventh finding): as the camera's pitch
    // rises back to the town's over the two seconds of its ease, the pocket shrinks to the town
    // pitch's reach (skyReach) and the line of sight swings the ground point along itself; held to
    // the shrinking pocket, the view was drawn back toward the island by OrbitControls' own clamp,
    // with no hand on it (58 px at 1440 x 900 from the pocket's far edge, 177 px from its side). Through
    // three's real OrbitControls and the scene's own hold (holdPan, panRegion, skyReach), pitch step
    // and aim: from the file at its pitch, a drag out to the pocket's edge (outward, to either side),
    // a second's rest, then a zoom out past the file's close view with no input after it: the target
    // stands still on screen all through the pitch's ease (under half a pixel in all); then a drag on
    // outward is held within the slack the ease left (half a unit), and a drag back in takes that
    // slack away again, on desktops and on phones on their side.
    {
      let pitchSource;
      (function find(node) {
        if (ts.isBlock(node) && node.statements[0]?.getText(syntax) === 'const left = aim(camera.zoom) - pitch;') pitchSource = `function pitchStep() ${node.getText(syntax)}`;
        ts.forEachChild(node, find);
      })(syntax);
      assert(pitchSource, 'The pocket check must find the frame loop\'s pitch step.');
      let still = 0,
        absorbed = 0,
        eases = 0;
      for (const [w, h, shift, drop] of [[1440, 900, 492 / 2880, 0], [1280, 720, 492 / 2560, 0], landscapeFiles[0], landscapeFiles[3], landscapeFiles[7]])
        for (const [dx, dy, way] of [[0, 8, 'out'], [8, 0, 'aside'], [-8, 0, 'to the other side']]) {
          const { zoom: fit, low } = settles(w, h, shift, drop),
            subject = view.target.clone().sub(view.shiftApplied),
            drive = drivePan(fileBearing, w, h),
            { held } = drive,
            { camera, controls } = held,
            align = () => {
              camera.position.copy(controls.target).add(scene.viewOffset(fileBearing, new T.Vector3(), held.pitch));
              camera.lookAt(controls.target);
              camera.updateMatrixWorld();
            };
          // aim, as the scene asks it, about this frame's file (the fit is the frame's own).
          frame(w, h, shift, fileBearing);
          Object.assign(view, { frameDrop: drop, panelEdge: 1, focusedIds: ['sky-island'] });
          Object.assign(held, { pitch: low, panPitch: low });
          controls.target.copy(subject);
          camera.zoom = fit;
          camera.updateProjectionMatrix();
          align();
          controls.update();
          const pitchStep = runInNewContext(`${ts.transpileModule(pitchSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};pitchStep;`, {
              Math,
              T,
              reduced: false,
              dt: 1 / 60,
              YAW_RATE: 2.5,
              camera,
              align,
              aim: (zoom) => scene.aim(zoom),
              get pitch() {
                return held.pitch;
              },
              set pitch(p) {
                held.pitch = p;
              },
            }),
            frameOf = (px = 0, py = 0) => {
              pitchStep();
              return drive.frame(px, py);
            },
            out = () => {
              const g = drive.ground(),
                r = drive.pan.panRegion(g);
              return g.distanceTo(r.centre) - r.radius;
            };
          for (let f = 0; f < 240; f++) frameOf(dx, dy);
          for (let f = 0; f < 60; f++) frameOf();
          // The zoom out (as a wheel's: the camera's zoom at once, the frame loop's pitch to follow).
          camera.zoom = Math.min(1.15, 0.7 * fit);
          camera.updateProjectionMatrix();
          const start = controls.target.clone(),
            pixels = () => {
              const d = controls.target.clone().sub(start);
              return Math.hypot(d.dot(new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)), d.dot(new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 1))) * ((h * camera.zoom) / (camera.top - camera.bottom));
            };
          let frames = 0;
          for (; frames < 400 && Math.abs(scene.aim(camera.zoom) - held.pitch) > 0; frames++) frameOf();
          for (let f = 0; f < 30; f++) frameOf();
          eases++;
          still = Math.max(still, pixels());
          assert(frames > 60 && held.pitch === scene.aim(camera.zoom) && pixels() < 0.5, `Zoomed out from the sky island's pocket's edge (dragged ${way}) at ${w} x ${h}, the view moves ${pixels().toFixed(2)} px by itself over ${frames} frames of the pitch's ease.`);
          // A drag on outward, now the pitch has settled: held within the slack the ease left.
          const slack = held.panSlack;
          absorbed = Math.max(absorbed, slack);
          const g0 = drive.ground(),
            outward = g0.clone().sub(new T.Vector3(S.x, 0, S.z)).setLength(60).add(g0);
          for (let f = 0; f < 120; f++) {
            const g = frameOf(...drive.toward(outward.x, outward.z));
            const d = drive.pan.panRegion(g),
              beyondPocket = g.distanceTo(d.centre) - d.radius;
            assert(beyondPocket <= slack + 0.5, `Dragged on outward from the eased pocket (dragged ${way}) at ${w} x ${h}, the view gets ${beyondPocket.toFixed(2)} out of its region, past the slack of ${slack.toFixed(2)} the ease left.`);
          }
          // And dragged back in toward the island, the slack goes and stays gone.
          for (let f = 0; f < 240; f++) frameOf(...drive.toward(S.x, S.z));
          assert(held.panSlack < 0.5 && out() < 0.5, `Dragged back in after the eased pocket (dragged ${way}) at ${w} x ${h}, the view keeps ${held.panSlack.toFixed(2)} of slack.`);
          Object.assign(view, { frameDrop: 0, focusedIds: [] });
        }
      skyNav.pocket = `a view zoomed out from the sky island's pocket's edge left where it stands through ${eases} pitch eases (${still.toFixed(2)} px at most, ${absorbed.toFixed(1)} of slack taken up at most)`;
    }

    // (c3) Rotate in its own file turns the island where it stands (the art review's first finding:
    // the file's target stands on the line of sight 7.4 beyond the island, SKY_LIFT, and each quarter
    // turn about that point swung the island into a corner, its roof under the masthead or its side
    // against the file). The Rotate button's method and the frame loop's own turn and glide (as step()
    // runs them, a frame at a time) from the file as it frames the island, press by press round all
    // four stops, then two stops more with the second press made mid-turn, then once more after a
    // press of + (the visitor's zoom kept): on desktops beside the file (and a laptop's shorter
    // frame) and on phones above the file's sheet,
    // - at each stop the view settles on the file's own framing for that bearing (focusSky's target
    //   and zoom; after a zoom, the visitor's zoom), its ground point well inside the island's pocket;
    //   the island and its floats are whole in the part of the frame the file and the page's bands
    //   leave free (24 px clear on desktops, 12 on phones), at rest and through the idle drift;
    // - all through each turn the island's middle holds its place on screen (within a pixel and a
    //   half, the glide easing in what the new bearing's fit changes), the island stays whole in the
    //   free part, no frame moves its silhouette's box further than the turn itself turns it, and once
    //   the bearing has arrived no frame moves it more than half a pixel: no swing, no jump at the end.
    {
      const want = ['viewOffset', 'panelOffset', 'offsetTarget', 'followPanel', 'fitGroup', 'groupFrame', 'focusSky', 'skyFitZoom', 'skyFile', 'skyPivot', 'turnSky', 'aim', 'elevationAt', 'skyFit', 'skyMarks'],
        vars = ['TOWN_PITCH', 'SKY_LIFT', 'PANEL_CLEAR', 'SKY_FIT', 'YAW_RATE'],
        code = [];
      (function collect(node) {
        if (ts.isFunctionDeclaration(node) && want.includes(node.name?.text)) code.push(node.getText(syntax).replace(/^export\s+/, ''));
        if (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => vars.includes(d.name.getText(syntax)))) code.push(node.getText(syntax).replace(/^export\s+/, ''));
        ts.forEachChild(node, collect);
      })(syntax);
      const turning = turnPieces.find((p) => p.startsWith('function turnStep'));
      assert(code.length === want.length + vars.length && turning && glideSource && rotateSource && zoomSource, 'The Rotate-in-the-file check must find every piece it runs.');
      const spin = {
          T,
          Math,
          plan,
          camera: new T.OrthographicCamera(),
          controls: { minZoom: 0.45, target: new T.Vector3() },
          target: new T.Vector3(),
          shiftApplied: new T.Vector3(),
          screenRight: new T.Vector3(),
          screenUp: new T.Vector3(),
          frameShift: 0,
          frameDrop: 0,
          panelEdge: 1,
          width: 1,
          height: 1,
          yaw: 0,
          targetYaw: 0,
          targetZoom: 1,
          // Down at the file's pitch, as the camera stands in it (the zoom keeps aim() at 1 throughout).
          pitch: 1,
          tween: false,
          reduced: false,
          dt: 1 / 60,
          blend: 1 - Math.exp(-5.5 / 60),
          focusedIds: ['sky-island'],
          overviewFit: false,
          inspect: null,
          parkSelected: false,
          autoFocus: true,
          inspectionAutoFit: true,
          skyTurn: false,
          lastInteraction: 0,
          performance: { now: () => 0 },
          CITY_MAX_ZOOM: 4,
          STUDY_MAX_ZOOM: 8,
          fitOverview() {},
          align() {},
        },
        run = runInNewContext(
          `${ts.transpileModule([...code, turning, glideSource, rotateSource, zoomSource].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};({ focusSky, followPanel, turnStep, glideStep, rotate, zoomBy, viewOffset, middle: SKY_FIT.getCenter(new T.Vector3()) })`,
          spin,
        ),
        // One frame of step(): the panel offset followed, the turn, the glide, then the view handed over.
        frameStep = () => {
          run.followPanel();
          run.turnStep();
          run.glideStep();
          if (!spin.tween) spin.target.copy(spin.controls.target);
        },
        settled = () => !spin.tween && Math.abs(spin.targetYaw - spin.yaw) <= 0.0001,
        at = (w, h, bearing = spin.yaw, centre = spin.controls.target) => box(shape.map((p) => px(w, h, spin.camera.zoom, bearing, centre, p, filePitch))),
        mid = (w, h) => px(w, h, spin.camera.zoom, spin.yaw, spin.controls.target, run.middle, filePitch),
        stats = { stops: 0, frames: 0, hold: 0, end: 0 };
      for (const [w, h, phone] of [[1440, 900], [1440, 789], [1280, 800], [1024, 768], [1920, 1080], [390, 844, true], [375, 812, true], [430, 932, true]]) {
        const sheet = 0.69 * h,
          shift = phone ? 0 : 492 / (2 * w),
          drop = phone ? ((76 + sheet) / 2 - h / 2) / h : 0,
          aspect = w / h,
          vertical = Math.max(53, 76 / aspect),
          // The free part of the frame, its margins in.
          free = phone ? [12, 76 + 12, w - 12, sheet - 12] : [24, 76 + 24, w - 476 - 24, h - 76 - 24],
          whole = ([x0, y0, x1, y1]) => x0 >= free[0] && y0 >= free[1] && x1 <= free[2] && y1 <= free[3];
        Object.assign(spin.camera, { left: (-vertical * aspect) / 2, right: (vertical * aspect) / 2, top: vertical / 2, bottom: -vertical / 2 });
        Object.assign(spin, { width: w, height: h, frameShift: shift, frameDrop: drop, yaw: fileBearing, targetYaw: fileBearing, autoFocus: true });
        // The file as it frames the island, at rest.
        run.focusSky();
        spin.controls.target.copy(spin.target);
        spin.camera.zoom = spin.targetZoom;
        spin.tween = false;
        /**
         * Turn to rest after `presses` (each a function, run at the frame it names), checking every
         * frame: the island whole in the free part (`framed`, unless the visitor has zoomed in), and, for
         * a turn (not the zoom's own glide), its middle held, moved no further than it turns and still
         * once it arrives.
         */
        const turn = (presses, label, framed = true, turning = true) => {
          const was = mid(w, h);
          let last = at(w, h),
            arrived = false;
          for (let f = 0; f < 900; f++) {
            for (const [frame, press] of presses) if (frame === f) press();
            if (f > Math.max(...presses.map(([frame]) => frame)) && settled()) break;
            const before = spin.yaw;
            frameStep();
            stats.frames++;
            const now = at(w, h),
              m = mid(w, h),
              // How far the turn alone carries a point of the silhouette this frame: its reach from the middle on screen, times the angle.
              reach = Math.max(...[[now[0], now[1]], [now[2], now[3]], [now[0], now[3]], [now[2], now[1]]].map(([x, y]) => Math.hypot(x - m[0], y - m[1]))),
              moved = Math.max(...now.map((n, i) => Math.abs(n - last[i])));
            if (turning) {
              stats.hold = Math.max(stats.hold, Math.hypot(m[0] - was[0], m[1] - was[1]));
              assert(Math.hypot(m[0] - was[0], m[1] - was[1]) <= 1.5, `${label} at ${w} x ${h}: the island's middle moves ${Math.hypot(m[0] - was[0], m[1] - was[1]).toFixed(1)} px on screen at frame ${f}.`);
            }
            assert(!framed || whole(now), `${label} at ${w} x ${h}: at frame ${f} of the turn the island spans ${now.map((n) => n.toFixed(0)).join(', ')} px, out of the part of the frame left free.`);
            assert(!turning || moved <= reach * Math.abs(spin.yaw - before) * 1.05 + 1, `${label} at ${w} x ${h}: frame ${f} moves the island's box ${moved.toFixed(1)} px for a turn of ${(spin.yaw - before).toFixed(4)}.`);
            if (arrived && turning) {
              stats.end = Math.max(stats.end, moved);
              assert(moved <= 0.5, `${label} at ${w} x ${h}: the turn ends with a jump of ${moved.toFixed(2)} px at frame ${f}.`);
            }
            arrived ||= Math.abs(spin.targetYaw - spin.yaw) <= 0.0001;
            last = now;
          }
          assert(settled(), `${label} at ${w} x ${h} never settles.`);
        };
        /** At rest: the file's own framing for this bearing (or the visitor's zoom), whole in the free part through the drift, its ground point in the pocket. */
        const rest = (label, own = true) => {
          stats.stops++;
          const view = spin.controls.target.clone(),
            zoom = spin.camera.zoom,
            subject = view.clone().sub(spin.shiftApplied),
            back = run.viewOffset(spin.yaw, new T.Vector3(), 1).normalize(),
            ground = subject.clone().addScaledVector(back, -subject.y / back.y),
            reach = (16 * Math.tan(scene.TOWN_PITCH)) / Math.tan(filePitch);
          if (own) {
            run.focusSky();
            assert(spin.target.distanceTo(view) < 0.0025 && Math.abs(spin.targetZoom - zoom) < 0.0011, `${label} at ${w} x ${h} rests ${spin.target.distanceTo(view).toFixed(4)} from the file's own framing for its bearing, at zoom ${zoom.toFixed(4)} for ${spin.targetZoom.toFixed(4)}.`);
            spin.target.copy(view);
            spin.tween = false;
          }
          assert(Math.hypot(ground.x - S.x, ground.z - S.z) < reach - 3, `${label} at ${w} x ${h}: its ground point is ${Math.hypot(ground.x - S.x, ground.z - S.z).toFixed(1)} out, its pocket ${reach.toFixed(1)}.`);
          if (own)
            for (const d of [0, ...fileDrifts]) {
              const b = at(w, h, spin.yaw + d);
              assert(whole(b), `${label} at ${w} x ${h}${d ? `, drifted ${d.toFixed(3)}` : ''}: the island spans ${b.map((n) => n.toFixed(0)).join(', ')} px, out of the part of the frame left free.`);
            }
        };
        rest('The file');
        for (let k = 1; k <= 4; k++) {
          turn([[0, run.rotate]], `Rotate stop ${k}`);
          rest(`Rotate stop ${k}`);
          assert(Math.abs(spin.yaw - fileBearing - (k * Math.PI) / 2) < 1e-6, `Rotate stop ${k} is not a quarter turn on.`);
        }
        // Two presses, the second mid-turn: two stops on, the island held all the way.
        turn([[0, run.rotate], [24, run.rotate]], 'A second press mid-turn');
        rest('Two stops on');
        // After a press of + (the visitor's zoom, no longer the file's framing): the turn keeps it and the island's middle.
        run.zoomBy(1.25);
        turn([], 'The zoom', false, false);
        const zoomed = spin.camera.zoom;
        turn([[0, run.rotate]], 'Rotate after a zoom', false);
        assert(Math.abs(spin.camera.zoom - zoomed) < 1e-9, `Rotate after a zoom at ${w} x ${h} changes the zoom from ${zoomed.toFixed(3)} to ${spin.camera.zoom.toFixed(3)}.`);
        rest('Rotate after a zoom', false);
      }
      skyNav.rotate = `the island turned where it stands at ${stats.stops} Rotate stops (its middle held within ${stats.hold.toFixed(2)} px over ${stats.frames} frames of turning, ${stats.end.toFixed(2)} px a frame at most as each turn ends)`;
    }

    // (c3b) Rotate in its own file after the visitor has panned or zoomed it (the final review's second
    // finding): turned about the point of the island's height on the visitor's line of sight, the view's
    // ground point swung on a circle out of the island's pocket, and every frame the pan limit slid the
    // view back (677-717 px over the turn at 1440 x 900, up to 16.7 px a frame); let go, the island was
    // left off the screen. Rotate now frames the island again for the new bearing at the visitor's zoom,
    // and the turn carries the view about the island. Through three's real OrbitControls (drivePan's
    // settings) with the scene's own holdPan, panRegion and skyReach, the Rotate button's method,
    // focusSky, turnSky and the frame loop's turn, pitch and glide, at 1440 x 900, 1280 x 720 and a
    // phone above its sheet (fileFrame's shift and drop): from the file at rest, a drag out to the
    // pocket's edge (300 frames of 8 px) to the right, the left, up or down, or a press of + (and one with
    // a drag after it), a second's rest, then Rotate:
    // - no frame of the turn has the pan limit (holdPan and OrbitControls' clamp) move the view more than
    //   half a pixel;
    // - once the island's middle is in the frame it stays there, and it ends in the free part beside the
    //   file or above the sheet;
    // - the turn ends on a still view (under half a pixel over the next second) at the visitor's zoom, its
    //   ground point well inside the island's pocket.
    {
      const want = ['panRegion', 'holdPan', 'viewOffset', 'panelOffset', 'offsetTarget', 'followPanel', 'fitGroup', 'groupFrame', 'skyMarks', 'skyFit', 'focusSky', 'skyFitZoom', 'skyReach', 'elevationAt', 'aim', 'skyFile', 'skyPivot', 'turnSky', 'align', 'cancel'],
        vars = ['PAN', 'panSubject', 'PANEL_CLEAR', 'SKY_MARKS', 'SKY_LIFT', 'TOWN_PITCH', 'YAW_RATE'],
        code = [];
      let pitchSource;
      (function collect(node) {
        if (ts.isFunctionDeclaration(node) && want.includes(node.name?.text)) code.push(node.getText(syntax).replace(/^export\s+/, ''));
        if (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => vars.includes(d.name.getText(syntax)))) code.push(node.getText(syntax).replace(/^export\s+/, ''));
        if (ts.isBlock(node) && node.statements[0]?.getText(syntax) === 'const left = aim(camera.zoom) - pitch;') pitchSource = `function pitchStep() ${node.getText(syntax)}`;
        ts.forEachChild(node, collect);
      })(syntax);
      const turning = turnPieces.find((p) => p.startsWith('function turnStep'));
      assert(code.length === want.length + vars.length && turning && glideSource && pitchSource && rotateSource && zoomSource, 'The Rotate-after-a-pan check must find every piece it runs.');
      const script = `${ts.transpileModule([...code, turning, glideSource, pitchSource, rotateSource, zoomSource].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};({ holdPan, panRegion, focusSky, followPanel, turnStep, glideStep, pitchStep, rotate, zoomBy, cancel, align, aim, middle: SKY_FIT.getCenter(new T.Vector3()) })`,
        worst = { pull: 0, end: 0, out: -Infinity, turns: 0 };
      for (const [w, h, shift, drop, phone] of [[1440, 900, 492 / 2880, 0], [1280, 720, 492 / 2560, 0], [390, 844, 0, -100.95 / 844, true]])
        for (const { label, drag, plus } of [
          { label: 'dragged right', drag: [8, 0] },
          { label: 'dragged left', drag: [-8, 0] },
          { label: 'dragged down', drag: [0, 8] },
          { label: 'dragged up', drag: [0, -8] },
          { label: 'zoomed in with +', plus: true },
          { label: 'zoomed in with + and dragged up', drag: [0, -8], plus: true },
        ]) {
          const aspect = w / h,
            vertical = Math.max(53, 76 / aspect),
            camera = new T.OrthographicCamera((-vertical * aspect) / 2, (vertical * aspect) / 2, vertical / 2, -vertical / 2, -200, 180),
            controls = new OrbitControls(camera, null);
          controls.domElement = { clientWidth: w, clientHeight: h };
          Object.assign(controls, { enableRotate: false, enableDamping: true, dampingFactor: 0.09, screenSpacePanning: true, minZoom: 0.45, maxZoom: 4 });
          const turn = {
              T,
              Math,
              plan,
              camera,
              controls,
              target: new T.Vector3(),
              shiftApplied: new T.Vector3(),
              screenRight: new T.Vector3(),
              screenUp: new T.Vector3(),
              offset: new T.Vector3(),
              frameShift: shift,
              frameDrop: drop,
              panelEdge: 1,
              width: w,
              height: h,
              yaw: fileBearing,
              targetYaw: fileBearing,
              targetZoom: 1,
              pitch: 1,
              driftAngle: 0,
              panSlack: Infinity,
              panPitch: 1,
              tween: false,
              reduced: false,
              dt: 1 / 60,
              blend: 1 - Math.exp(-5.5 / 60),
              focusedIds: ['sky-island'],
              overviewFit: false,
              inspect: null,
              parkSelected: false,
              autoFocus: true,
              inspectionAutoFit: true,
              skyTurn: false,
              cityMode: true,
              lastInteraction: 0,
              performance: { now: () => 0 },
              CITY_MAX_ZOOM: 4,
              STUDY_MAX_ZOOM: 8,
              models: new Map(),
              city: { updateMatrixWorld() {} },
              placeSun() {},
              clearHover() {},
              fitOverview() {},
            },
            run = runInNewContext(script, turn),
            // A point's place on the screen (px) as the camera stands.
            onScreen = (p) => {
              const q = p.clone().project(camera);
              return [((q.x + 1) * w) / 2, ((1 - q.y) * h) / 2];
            },
            // One frame of step(): the panel offset, the turn, the pitch, the glide, the limit and
            // OrbitControls' update, the view handed over; and how far the limit moved the view (px).
            frame = () => {
              run.followPanel();
              run.turnStep();
              run.pitchStep();
              run.glideStep();
              camera.updateMatrixWorld();
              const was = controls.target.clone(),
                at = onScreen(was);
              run.holdPan();
              controls.update();
              camera.updateMatrixWorld();
              const now = onScreen(was);
              if (!turn.tween) turn.target.copy(controls.target);
              return Math.hypot(now[0] - at[0], now[1] - at[1]);
            },
            out = () => {
              const back = camera.position.clone().sub(controls.target).normalize(),
                g = controls.target.clone().sub(turn.shiftApplied);
              g.addScaledVector(back, -g.y / back.y);
              const r = run.panRegion(g);
              return g.distanceTo(r.centre) - r.radius;
            },
            inFrame = ([x, y]) => x >= 0 && x <= w && y >= 0 && y <= h,
            free = ([x, y]) => (phone ? x >= 0 && x <= w && y >= 58 && y <= 0.69 * h : x >= 0 && x <= w - 476 && y >= 76 && y <= h - 76),
            at = `${label} at ${w} x ${h}`;
          // The file, framed and at rest.
          run.focusSky();
          controls.target.copy(turn.target);
          camera.zoom = turn.targetZoom;
          camera.updateProjectionMatrix();
          run.align();
          controls.update();
          for (let f = 0; f < 60; f++) frame();
          if (plus) {
            run.zoomBy(1.25);
            for (let f = 0; f < 400 && turn.tween; f++) frame();
          }
          if (drag) {
            run.cancel();
            for (let f = 0; f < 300; f++) {
              controls._pan(drag[0], drag[1]);
              controls.update();
              camera.updateMatrixWorld();
              frame();
            }
          }
          for (let f = 0; f < 60; f++) frame();
          const zoom = camera.zoom;
          run.rotate();
          let shown = inFrame(onScreen(run.middle)),
            settled = 0,
            f = 0;
          for (; f < 900 && settled < 5; f++) {
            const pulled = frame(),
              m = onScreen(run.middle);
            worst.pull = Math.max(worst.pull, pulled);
            assert(pulled <= 0.5, `Rotate in the sky island's file ${at}: the pan limit moves the view ${pulled.toFixed(2)} px at frame ${f} of the turn.`);
            assert(!shown || inFrame(m), `Rotate in the sky island's file ${at}: its middle leaves the frame at frame ${f} of the turn (${m.map((v) => v.toFixed(0)).join(', ')} px).`);
            shown ||= inFrame(m);
            settled = !turn.tween && Math.abs(turn.targetYaw - turn.yaw) <= 0.0001 && Math.abs(run.aim(camera.zoom) - turn.pitch) <= 0.0001 ? settled + 1 : 0;
          }
          assert(settled >= 5 && Math.abs(turn.yaw - fileBearing - Math.PI / 2) < 1e-6, `Rotate in the sky island's file ${at} does not end a quarter turn on.`);
          const rest = controls.target.clone(),
            restAt = onScreen(rest),
            m = onScreen(run.middle);
          for (let k = 0; k < 60; k++) frame();
          const still = Math.hypot(...onScreen(rest).map((v, i) => v - restAt[i]));
          worst.end = Math.max(worst.end, still);
          worst.out = Math.max(worst.out, out());
          worst.turns++;
          assert(free(m), `Rotate in the sky island's file ${at} ends with its middle at ${m.map((v) => v.toFixed(0)).join(', ')} px, out of the part of the frame left free.`);
          assert(still < 0.5 && Math.abs(camera.zoom - zoom) < 1e-9 && out() < -3, `Rotate in the sky island's file ${at} ends ${still.toFixed(2)} px from still, at zoom ${camera.zoom.toFixed(4)} for the visitor's ${zoom.toFixed(4)}, or its ground point ${out().toFixed(2)} from its pocket's edge.`);
        }
      skyNav.rotatePanned = `Rotate after ${worst.turns} pans and zooms of its file framing it again at the visitor's zoom (the pan limit moving the view ${worst.pull.toFixed(2)} px a frame at most, the view still within ${worst.end.toFixed(2)} px after, its ground point ${(-worst.out).toFixed(1)} inside its pocket at least)`;
    }

    // (c4) The sun's shadow box in the island's own file (the 3D review's fourth finding: on portrait
    // phones the file never took it, the villa, the tree, the tea set and Alison casting nothing on
    // the lawn, for a sliver of the north-west coast in the corner above the sheet). city-scene's own
    // skyShadowWanted, run as followSky runs it (on the camera as it stands, at the pitch it settles
    // at, the hand-over's `on` carried from one call to the next), on the file's real framings:
    // page.tsx's fileFrame as measured on the page, beside the file's panel on desktops
    // (the 460 px file and its 16 px margin and gutter: a shift of 492 / 2w), above the peeking sheet
    // on portrait phones (the masthead's foot at 58, the sheet's top 259.9 above the stage's foot: a
    // drop of -100.95 / h), beside the panel and above the bars on phones held sideways (where the
    // camera comes down at the file's own fit, under SKY_SHADOW.zoom: SKY_SHADOW.low lets it count as
    // close in) and above the 768 x 1024 tablet's sheet (-0.2629), the free band running from the
    // frame's top down to the sheet's or the bars' top (fileFrame's foot: (h - 259.9) / h on portrait
    // phones, (h - 124) / h on phones held sideways, 427.52 / 1024 on the tablet, 1 on desktops; read
    // off the drop, the band's foot lay the masthead's 58 px inside the sheet, the final review's
    // third camera finding). There
    // - at the file's bearing and the next Rotate stop the island takes the box as the file settles
    //   and keeps it all through the idle drift; the other two stops, which look past the island at
    //   the town's west coast or at the airport, never keep its own box (there its file's wide box
    //   holds both: (c4d));
    // - every other place's file and City mode's overview keep the town's box, through the drift;
    // - a pan from the file toward the town hands the box back to the town by the time a twentieth
    //   of the free part of the frame is its land, and before any of its buildings (their sites'
    //   boxes, at full height) stands whole in it;
    // - (c4b) mid-turn, frame by frame: Rotate round the four stops on portrait phones and desktops
    //   hands the box over once at most a turn, as the turn starts (the final review's fourth finding:
    //   on 390-430 px phones the turn to the next stop swept a strip of the town's coast through the
    //   band's foot, and the box went to the town and back mid-turn, two fades and two new maps), and
    //   the glide that brings the view into the file from elsewhere hands it over only once the view
    //   it stands at is close in on the island.
    {
      const shadowPieces = [];
      (function collect(node) {
        if (ts.isFunctionDeclaration(node) && ['skyShadowWanted', 'skyClose', 'bandShare', 'clipToFrame', 'skyFit'].includes(node.name?.text)) shadowPieces.push(node.getText(syntax).replace(/^export\s+/, ''));
        if (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => ['SKY_SHADOW', 'TOWN_WATERLINE', 'LAND_MARKS', '[rockX, rockZ]'].includes(d.name.getText(syntax)))) shadowPieces.push(node.getText(syntax).replace(/^export\s+/, ''));
        ts.forEachChild(node, collect);
      })(syntax);
      assert.equal(shadowPieces.length, 9, 'The shadow box check must find every piece it runs.');
      {
        // (By the syntax tree, so that a formatter's line breaks change nothing.)
        const asked = [],
          declared = {};
        (function find(node, inFollow) {
          if (inFollow && ts.isCallExpression(node) && node.expression.getText(syntax) === 'skyShadowWanted') asked.push(node.arguments.map((a) => unformatted(a.getText(syntax))).join(', '));
          if (inFollow && ts.isVariableDeclaration(node) && ['view', 'low'].includes(node.name.getText(syntax))) declared[node.name.getText(syntax)] = unformatted(node.initializer.getText(syntax));
          ts.forEachChild(node, (child) => find(child, inFollow || (ts.isFunctionDeclaration(node) && node.name?.text === 'followSky')));
        })(syntax, false);
        assert(asked.length === 1 && declared.view === 'skyTurn?skyAhead():camera' && declared.low === 'skyFile()&&view.zoom>=SKY_SHADOW.file*skyFitZoom()?1:skyTurn?aim():pitch' && asked[0] === 'view, LAND_MARKS, frameShift, frameFoot, skyBox===SKY_TIGHT, low', 'followSky no longer asks skyShadowWanted about the camera as it stands (its pitch included) and the free band down to the sheet\'s or the bars\' top, or, mid-turn in the island\'s file, about the framing the turn heads for (and the pitch it heads for), or no longer counts the island\'s own file at its fit as close in.');
      }
      const sun = runInNewContext(`${ts.transpileModule(shadowPieces.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};({ skyShadowWanted, bandShare, SKY_SHADOW, TOWN_WATERLINE, LAND_MARKS })`, { T, Math, plan }),
        // The scene's camera for a w x h stage (resize()), looking at `centre` from `bearing` at `low` of the way down to the file's pitch.
        lens = (w, h) => {
          const aspect = w / h,
            vertical = Math.max(53, 76 / aspect);
          return new T.OrthographicCamera((-vertical * aspect) / 2, (vertical * aspect) / 2, vertical / 2, -vertical / 2, -200, 180);
        },
        look = (camera, centre, bearing, low, zoom) => {
          camera.position.copy(centre).add(scene.viewOffset(bearing, new T.Vector3(), low));
          camera.lookAt(centre);
          camera.zoom = zoom;
          camera.updateProjectionMatrix();
          camera.updateMatrixWorld(true);
          return camera;
        },
        right = (shift) => 1 - 4 * Math.max(0, shift),
        bottom = (foot) => 1 - 2 * foot,
        shore = (camera, shift, foot) => sun.bandShare(sun.TOWN_WATERLINE, camera, right(shift), bottom(foot)),
        // The town's buildings as their sites' boxes, and whether one stands whole in the free part of the frame.
        sites = Object.values(plan.sites)
          .filter((s) => s.id !== 'sky-island')
          .map((s) => {
            const c = Math.cos(s.rotation),
              n = Math.sin(s.rotation),
              corners = [];
            for (const dx of [-1, 1]) for (const dz of [-1, 1]) for (const y of [0, s.height]) corners.push(new T.Vector3(s.x + ((dx * s.w) / 2) * c + ((dz * s.d) / 2) * n, y, s.z - ((dx * s.w) / 2) * n + ((dz * s.d) / 2) * c));
            return { id: s.id, corners };
          }),
        wholeIn = (camera, shift, foot) =>
          sites.find((s) =>
            s.corners.every((p) => {
              const q = p.clone().project(camera);
              return q.x > -1 && q.x < right(shift) && q.y > bottom(foot) && q.y < 1;
            }),
          ),
        // [w, h, fileFrame's shift, drop and foot]
        desktopFiles = [[1024, 768], [1280, 720], [1280, 800], [1366, 657], [1440, 900], [1920, 1080], [2560, 1440]].map(([w, h]) => [w, h, 492 / (2 * w), 0, 1]),
        portraitFiles = [[360, 640], [360, 740], [375, 667], [375, 812], [390, 844], [393, 852], [412, 915], [414, 896], [430, 932]].map(([w, h]) => [w, h, 0, -100.95 / h, (h - 259.9) / h]),
        sidewaysFiles = landscapeFiles.map(([w, h, shift, drop]) => [w, h, shift, drop, (h - 124) / h]),
        tabletFile = [768, 1024, 0, -0.2629, 427.52 / 1024],
        files = [...desktopFiles, ...portraitFiles, ...sidewaysFiles, tabletFile],
        worst = { rest: 0, drift: 0 };
      assert(sun.SKY_SHADOW.shore[1] < sun.SKY_SHADOW.shore[0], 'The sun\'s shadow box changes hands over the town\'s shore without slack.');
      // (The band's foot is the sheet's or the bars' top, which the drop's band put the masthead's
      // height lower: fileFrame's drop is the middle of the band between the masthead's foot, 58 down,
      // and the foot.)
      for (const [w, h, , drop, foot] of [...portraitFiles, ...sidewaysFiles, tabletFile])
        assert(Math.abs((1 + 2 * drop) * h - foot * h - 58) < 0.1,`At ${w} x ${h} the free band's foot (${(foot * h).toFixed(1)} px) is not the sheet's or the bars' top under the drop's band.`);
      for (const [w, h, shift, drop, foot] of files)
        for (let stop = 0; stop < 4; stop++) {
          const bearing = fileBearing + (stop * Math.PI) / 2,
            { zoom, centre, low } = settles(w, h, shift, drop, bearing),
            camera = look(lens(w, h), centre, bearing, low, zoom),
            at = `${w} x ${h}${stop ? ` at Rotate stop ${stop}` : ''}`,
            // As followSky asks it: the file at its fit counts as close in (SKY_SHADOW.file), which on
            // these framings decides nothing their own zoom and pitch did not.
            asks = (on) => {
              const wanted = sun.skyShadowWanted(camera, sun.LAND_MARKS, shift, foot, on, 1);
              assert.equal(wanted, sun.skyShadowWanted(camera, sun.LAND_MARKS, shift, foot, on, low), `The sky island's file at ${at} changes boxes by counting as close in at its fit.`);
              return wanted;
            };
          if (stop < 2) {
            worst.rest = Math.max(worst.rest, shore(camera, shift, foot));
            assert(asks(false), `The sky island's file at ${at} does not take the sun's shadow box as it settles (the town's island takes ${(shore(camera, shift, foot) * 100).toFixed(1)}% of the free part of the frame).`);
            for (const d of fileDrifts) {
              look(camera, centre, bearing + d, low, zoom);
              worst.drift = Math.max(worst.drift, shore(camera, shift, foot));
              assert(asks(true), `The sky island's file at ${at}, drifted ${d.toFixed(3)}, gives the sun's shadow box back to the town (its island takes ${(shore(camera, shift, foot) * 100).toFixed(1)}% of the free part).`);
            }
          } else
            for (const d of [0, ...fileDrifts]) {
              look(camera, centre, bearing + d, low, zoom);
              assert(!asks(true), `The sky island's file at ${at}, drifted ${d.toFixed(3)}, keeps the sun's shadow box with the town in view.`);
            }
        }
      // The band ends at the sheet's top: on portrait phones the file's own framings on the way from
      // its bearing to the next stop (a sixteenth of the quarter turn apart) sweep a strip of the
      // town's coast through the masthead's height under the sheet's top (over the 5% the island keeps
      // the box to, counted to the drop's foot), seen there only blurred through the sheet; above it,
      // the town stays a sliver, and the island keeps the box all the way.
      let underSheet = 0;
      for (const [w, h, shift, drop, foot] of portraitFiles)
        for (let k = 0; k <= 16; k++) {
          const bearing = fileBearing + (k / 16) * (Math.PI / 2),
            { zoom, centre, low } = settles(w, h, shift, drop, bearing),
            camera = look(lens(w, h), centre, bearing, low, zoom);
          underSheet = Math.max(underSheet, sun.bandShare(sun.TOWN_WATERLINE, camera, 1, bottom(1 + 2 * drop)));
          if (shore(camera, shift, foot) <= sun.SKY_SHADOW.shore[1]) assert(sun.skyShadowWanted(camera, sun.LAND_MARKS, shift, foot, true, low), `On the way from the sky island's file's bearing to the next stop at ${w} x ${h} (${k} sixteenths), the island gives the sun's shadow box back for town under the sheet.`);
        }
      assert(underSheet > sun.SKY_SHADOW.shore[0], `The turn's strip of town under the sheet's top no longer reaches past the keep limit (${(underSheet * 100).toFixed(1)}%): the band's foot is no longer tried.`);
      // Every other place's file, from its own front (City mode's frameCity), and City mode's overview.
      view.models = new Map(
        buildings
          .filter((b) => b.model !== 'sky')
          .map((b) => {
            const s = plan.sites[b.id],
              root = new T.Group(),
              mesh = new T.Mesh(new T.BoxGeometry(s.w, s.height, s.d));
            mesh.position.y = s.height / 2;
            root.add(mesh);
            root.position.set(s.x, 0, s.z);
            root.rotation.y = s.rotation;
            root.updateMatrixWorld(true);
            return [b.id, { root }];
          }),
      );
      let others = 0;
      for (const [w, h, shift, drop, foot] of [...desktopFiles, ...portraitFiles, ...sidewaysFiles]) {
        for (const id of view.models.keys()) {
          const bearing = plan.chapterBearings[nav.facingChapter(nav.contentForBuilding(id))] ?? Math.PI / 4;
          frame(w, h, shift, bearing);
          Object.assign(view, { frameDrop: drop, panelEdge: 1, focusedIds: [id] });
          view.target.set(0, 0, 0);
          scene.fitFocused();
          assert.equal(scene.aim(view.targetZoom), 0, `${id}'s file at ${w} x ${h} comes down to the sky island's pitch.`);
          const camera = lens(w, h);
          for (const d of [0, ...drifts]) {
            look(camera, view.target, bearing + d, 0, view.targetZoom);
            others++;
            assert(!sun.skyShadowWanted(camera, sun.LAND_MARKS, shift, foot, true, 0), `${id}'s file at ${w} x ${h}, drifted ${d.toFixed(2)}, gives the sun's shadow box to the sky island.`);
          }
        }
        frame(w, h, shift, Math.PI / 4);
        Object.assign(view, { frameDrop: drop, focusedIds: [], cityMode: true, overviewFit: true });
        scene.fitOverview();
        const camera = look(lens(w, h), view.target, Math.PI / 4, 0, view.targetZoom);
        assert(!sun.skyShadowWanted(camera, sun.LAND_MARKS, shift, foot, true, 0), `City mode's overview at ${w} x ${h} gives the sun's shadow box to the sky island.`);
        Object.assign(view, { frameDrop: 0, cityMode: false, overviewFit: false });
      }
      view.models = new Map();
      view.panelEdge = 1;
      // Pans from the file, at its pitch and zoom, toward the town's middle, the People side's homes
      // and the airport (the ground point slides there, the target keeping its lift): the hand-over
      // run frame by frame.
      let pans = 0;
      for (const [w, h, shift, drop, foot] of [desktopFiles[1], desktopFiles[4], desktopFiles[5], portraitFiles[4], portraitFiles[8], sidewaysFiles[3]])
        for (const goal of [new T.Vector3(0, 0, 0), new T.Vector3(-22, 0, 1), new T.Vector3(plan.AIRPORT.x, 0, plan.AIRPORT.z)]) {
          const { zoom, centre, low } = settles(w, h, shift, drop, fileBearing),
            camera = lens(w, h);
          let on = true,
            handed = false;
          for (let k = 0; k <= 400; k++) {
            look(camera, centre.clone().add(new T.Vector3(goal.x - centre.x, 0, goal.z - centre.z).multiplyScalar(k / 400)), fileBearing, low, zoom);
            const share = shore(camera, shift, foot),
              whole = wholeIn(camera, shift, foot);
            on = sun.skyShadowWanted(camera, sun.LAND_MARKS, shift, foot, on, low);
            handed ||= !on;
            assert(!on || (share <= sun.SKY_SHADOW.shore[0] && !whole), `Panning the sky island's file at ${w} x ${h} toward ${goal.x}, ${goal.z}, the island keeps the sun's shadow box with ${(share * 100).toFixed(1)}% of the free part of the frame the town's${whole ? ` and ${whole.id} whole in it` : ''}.`);
          }
          pans++;
          assert(handed && !on, `Panning the sky island's file at ${w} x ${h} toward ${goal.x}, ${goal.z} never gives the town its shadow box back.`);
        }
      // (c4b) Mid-turn, frame by frame: city-scene's own followSky (with skyAhead, skyShadowWanted and
      // the hand-over's fade), Rotate method, focusSky, turnSky and frame loop (followPanel, the turn,
      // the pitch step, the glide) on a camera of the stage's size, the file's framing as fileFrame
      // measures it, its shadow maps counted where followSky lays them (shadowFocus): from the file's
      // bearing, Rotate pressed four times, each turn run to rest. Every turn hands the box over once at
      // most, within the fade's own frames after the press (as the turn starts), and ends with the box
      // the stop keeps when it is reached at rest (the checks above); so a turn that ends with the
      // island's box never lets it go. And from the Town Hall's file, the glide into the island's file
      // (its turn and its zoom with it) hands the box to the island only on a frame whose own view is
      // close in on it (skyShadowWanted on the camera as it stands).
      {
        const want = ['viewOffset', 'panelOffset', 'offsetTarget', 'followPanel', 'fitGroup', 'groupFrame', 'fitFocused', 'focusSky', 'skyFitZoom', 'skyFile', 'skyPivot', 'turnSky', 'skyAhead', 'aim', 'elevationAt', 'skyFit', 'skyMarks', 'skyExtent', 'skyHidden', 'skyOnScreen', 'followSky', 'align', 'select', 'skyShadowWanted', 'skyClose', 'bandShare', 'clipToFrame', 'skySettled', 'skyWide', 'skyHolds', 'skyViews', 'keyAt', 'skyWideBox', 'sunBoxHolds', 'sunReach', 'eachLandSeen', 'lightAxes'],
          vars = ['TOWN_PITCH', 'SKY_LIFT', 'PANEL_CLEAR', 'SKY_MARKS', 'SKY_HIDES', 'SKY_EXTENT', 'onScreen', 'YAW_RATE', 'SKY_SHADOW', 'TOWN_WATERLINE', 'LAND_MARKS', '[rockX, rockZ]', 'ahead', 'UP', 'AIRPORT_FIT', 'SKY_WIDE', 'TOWN_LAND', 'SKY_TIGHT', 'skyStillAt'],
          code = [];
        let pitchSource;
        (function collect(node) {
          if (ts.isFunctionDeclaration(node) && want.includes(node.name?.text)) code.push(node.getText(syntax).replace(/^export\s+/, ''));
          if (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => vars.includes(d.name.getText(syntax)))) code.push(node.getText(syntax).replace(/^export\s+/, ''));
          if (ts.isBlock(node) && node.statements[0]?.getText(syntax) === 'const left = aim(camera.zoom) - pitch;') pitchSource = `function pitchStep() ${node.getText(syntax)}`;
          ts.forEachChild(node, collect);
        })(syntax);
        const turning = turnPieces.find((p) => p.startsWith('function turnStep'));
        assert(code.length === want.length + vars.length && turning && glideSource && pitchSource && rotateSource, 'The mid-turn shadow box check must find every piece it runs.');
        const { WATER } = await import(pathToFileURL(path.join(output, 'town-shared.mjs')).href),
          { createSeaShadow } = await import(pathToFileURL(path.join(output, 'city-water.mjs')).href),
          script = `${ts.transpileModule([...code, turning, glideSource, pitchSource, rotateSource].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};({ followPanel, turnStep, glideStep, pitchStep, align, followSky, focusSky, select, rotate, aim, skyWideBox, sunBoxHolds, eachLandSeen, lightAxes, SKY_WIDE, SKY_TIGHT })`,
          models = new Map(
            buildings
              .filter((b) => b.model !== 'sky')
              .map((b) => {
                const s = plan.sites[b.id],
                  root = new T.Group(),
                  mesh = new T.Mesh(new T.BoxGeometry(s.w, s.height, s.d));
                mesh.position.y = s.height / 2;
                root.add(mesh);
                root.position.set(s.x, 0, s.z);
                root.rotation.y = s.rotation;
                root.updateMatrixWorld(true);
                return [b.id, { root, center: new T.Vector3(s.x, s.height / 2, s.z) }];
              }),
          ),
          early = Math.ceil(sun.SKY_SHADOW.fade * 60) + 1,
          turns = { count: 0, handed: 0, latest: 0 };
        // A scene of a w x h stage beside the file or above its sheet, in City mode.
        const stage = (w, h, shift, drop, foot) => {
          const aspect = w / h,
            vertical = Math.max(53, 76 / aspect),
            maps = [],
            ctx = {
              T,
              Math,
              plan,
              camera: new T.OrthographicCamera((-vertical * aspect) / 2, (vertical * aspect) / 2, vertical / 2, -vertical / 2, -200, 180),
              controls: { target: new T.Vector3(), minZoom: 0.45 },
              target: new T.Vector3(),
              shiftApplied: new T.Vector3(),
              screenRight: new T.Vector3(),
              screenUp: new T.Vector3(),
              offset: new T.Vector3(),
              width: w,
              height: h,
              frameShift: shift,
              frameDrop: drop,
              frameFoot: foot,
              panelEdge: 1,
              yaw: fileBearing,
              targetYaw: fileBearing,
              targetZoom: 1,
              pitch: 0,
              driftAngle: 0,
              tween: false,
              reduced: false,
              dt: 1 / 60,
              blend: 1 - Math.exp(-5.5 / 60),
              focusedIds: [],
              overviewFit: false,
              inspect: null,
              parkSelected: false,
              autoFocus: false,
              inspectionAutoFit: true,
              cityMode: true,
              lastInteraction: 0,
              performance: { now: () => 0 },
              CITY_MAX_ZOOM: 4,
              STUDY_MAX_ZOOM: 8,
              models,
              city: { updateMatrixWorld() {} },
              island: { root: { visible: true } },
              skyShown: true,
              skyCast: false,
              skyBox: null,
              skyNext: null,
              skyStillZoom: 0,
              hover: { dragging: false },
              // The key light's offset before it turns with the yaw (placeSun's), and the island's boxes' map.
              sunOffset: new T.Vector3(-16, 32, 20),
              shadowBase: 1536,
              shadowFade: 1,
              skyTurn: false,
              skyCasters: [],
              seaShadow: createSeaShadow(WATER),
              frame: 0,
              // Each new framing of the sun's box, the island's own, its file's wide one or the town's.
              shadowFocus(centre, radius) {
                maps.push({ frame: ctx.frame, island: !!centre, wide: !!centre && radius !== sun.SKY_SHADOW.radius });
              },
              placeSun() {},
              clearHover() {},
              exitInspection() {},
              fitOverview() {},
            },
            run = runInNewContext(script, ctx),
            step = () => {
              ctx.frame++;
              run.followPanel();
              run.turnStep();
              run.pitchStep();
              run.glideStep();
              if (!ctx.tween) ctx.target.copy(ctx.controls.target);
              run.align();
              ctx.camera.updateMatrixWorld();
              run.followSky(1 / 60);
            },
            rests = () => !ctx.tween && Math.abs(ctx.targetYaw - ctx.yaw) <= 0.0001 && Math.abs(run.aim(ctx.camera.zoom) - ctx.pitch) <= 0.0001;
          return { ctx, run, step, rests, maps };
        };
        for (const [w, h, shift, drop, foot] of [portraitFiles[4], portraitFiles[7], portraitFiles[8], desktopFiles[4], desktopFiles[5]]) {
          const { ctx, run, step, rests, maps } = stage(w, h, shift, drop, foot);
          run.select('sky-island');
          ctx.controls.target.copy(ctx.target);
          ctx.camera.zoom = ctx.targetZoom;
          ctx.camera.updateProjectionMatrix();
          ctx.pitch = run.aim(ctx.targetZoom);
          ctx.tween = false;
          for (let f = 0; f < 120; f++) step();
          assert(ctx.skyCast, `The sky island's file at ${w} x ${h} does not take the sun's shadow box as it settles.`);
          for (let stop = 1; stop <= 4; stop++) {
            const from = ctx.frame,
              hadOwn = ctx.skyBox?.radius === sun.SKY_SHADOW.radius,
              before = maps.length;
            run.rotate();
            for (let f = 0, still = 0; f < 900 && still < 30; f++) {
              step();
              still = rests() ? still + 1 : 0;
            }
            const handed = maps.slice(before),
              at = `Rotate stop ${stop % 4 || 4} at ${w} x ${h}`,
              // The island's own box where the town is next to absent, its file's wide one at the two stops that show the town's coast or the airport (c4d).
              own = stop % 4 < 2;
            turns.count++;
            turns.handed += handed.length;
            turns.latest = Math.max(turns.latest, ...handed.map((m) => m.frame - from));
            assert(handed.length <= 1, `${at}: the sun's shadow box changes hands ${handed.length} times in the turn (frames ${handed.map((m) => m.frame - from).join(', ')} after the press).`);
            assert(handed.every((m) => m.frame - from <= early), `${at}: the sun's shadow box changes hands at frame ${handed.map((m) => m.frame - from).join(', ')} of the turn, past its first ${early}.`);
            assert(ctx.skyCast && (ctx.skyBox?.radius === sun.SKY_SHADOW.radius) === own && handed.length === (hadOwn && own ? 0 : hadOwn !== own ? 1 : handed.length), `${at}: the turn ends with ${ctx.skyCast ? (ctx.skyBox?.radius === sun.SKY_SHADOW.radius ? 'the island\'s own box' : 'its file\'s wide box') : 'the town\'s box'} (${handed.length} hand-overs), where the stop keeps ${own ? 'the island\'s own' : 'its file\'s wide one'}.`);
          }
        }
        // The glide into the file from the Town Hall's file (and with Rotate pressed as it starts, before
        // the view is in the file): the island takes the box only on a frame whose own view is close in
        // on it.
        for (const [w, h, shift, drop, foot, press] of [desktopFiles[4], portraitFiles[4], [...desktopFiles[4], 0], [...portraitFiles[4], 0]]) {
          const { ctx, run, step, rests, maps } = stage(w, h, shift, drop, foot);
          Object.assign(ctx, { yaw: plan.chapterBearings['town-hall'], targetYaw: plan.chapterBearings['town-hall'] });
          run.select('town-hall');
          ctx.controls.target.copy(ctx.target);
          ctx.camera.zoom = ctx.targetZoom;
          ctx.camera.updateProjectionMatrix();
          ctx.tween = false;
          for (let f = 0; f < 60; f++) step();
          ctx.targetYaw = ctx.yaw + Math.atan2(Math.sin(fileBearing - ctx.yaw), Math.cos(fileBearing - ctx.yaw));
          run.select('sky-island');
          for (let f = 0, still = 0; f < 900 && still < 30; f++) {
            const before = maps.length;
            if (f === press) run.rotate();
            step();
            still = rests() ? still + 1 : 0;
            if (maps.length > before && maps[maps.length - 1].island)
              assert(sun.skyShadowWanted(ctx.camera, sun.LAND_MARKS, shift, foot, true, ctx.pitch), `Glided into the sky island's file from the Town Hall's at ${w} x ${h}, the island takes the sun's shadow box at frame ${f} with the view not yet close in on it.`);
          }
          assert(press !== undefined || (ctx.skyCast && maps.filter((m) => m.island).length === 1), `Glided into the sky island's file from the Town Hall's at ${w} x ${h}, the island does not take the sun's shadow box once.`);
        }
        // (c4c) The same view keeps the same box however the visitor came to it (the final review's fourth
        // camera finding): on tall, narrow windows in the sheet layout the file fits the island between
        // the zooms the box changes hands at (1.25 to 1.4) and settles short of the pitch that counts as
        // close in (0.62 at 900 x 1060), so opened there the file never took the island's box, while a
        // window resized into the same size from a larger one kept it. Opened as a deep link opens it (the
        // town's opening view, zoom 1, then the file's bearing and the island picked), and resized into it
        // from 1440 x 900 with the file open, the view ends with the island's box both ways (fileFrame as
        // measured on the page: the sheet's top at 444.8 and 464 px).
        let histories = 0;
        for (const [w, h, sheetTop] of [[900, 1060, 444.8], [960, 1100, 464]]) {
          const drop = ((58 + sheetTop) / 2 - h / 2) / h,
            foot = sheetTop / h,
            ends = [];
          for (const how of ['opened', 'resized']) {
            const { ctx, run, step, rests } = how === 'opened' ? stage(w, h, 0, drop, foot) : stage(...desktopFiles[4].slice(0, 5));
            if (how === 'opened') {
              Object.assign(ctx, { yaw: Math.PI / 4, targetYaw: fileBearing });
              ctx.camera.zoom = 1;
              ctx.camera.updateProjectionMatrix();
              run.align();
              run.select('sky-island');
            } else {
              run.select('sky-island');
              for (let f = 0, still = 0; f < 900 && still < 30; f++) {
                step();
                still = rests() ? still + 1 : 0;
              }
              assert(ctx.skyCast, 'The sky island\'s file at 1440 x 900 does not take the sun\'s shadow box.');
              // resize(): the camera's frame for the new stage, then the file's framing fitted again (autoFocus).
              const aspect = w / h,
                vertical = Math.max(53, 76 / aspect);
              Object.assign(ctx.camera, { left: (-vertical * aspect) / 2, right: (vertical * aspect) / 2, top: vertical / 2, bottom: -vertical / 2 });
              ctx.camera.updateProjectionMatrix();
              Object.assign(ctx, { width: w, height: h, frameShift: 0, frameDrop: drop, frameFoot: foot });
              run.focusSky();
            }
            for (let f = 0, still = 0; f < 900 && still < 30; f++) {
              step();
              still = rests() ? still + 1 : 0;
            }
            ends.push({ how, cast: ctx.skyCast, zoom: ctx.camera.zoom, pitch: ctx.pitch });
          }
          histories++;
          assert(Math.abs(ends[0].zoom - ends[1].zoom) < 1e-3 && Math.abs(ends[0].pitch - ends[1].pitch) < 1e-3 && ends[0].zoom > 1.25 && ends[0].zoom < 1.4 && ends[0].pitch < 0.9, `The sky island's file at ${w} x ${h} no longer settles in the same view both ways between the box's zooms and short of its pitch (${ends.map((e) => `${e.how} ${e.zoom.toFixed(3)} at ${e.pitch.toFixed(3)}`).join(', ')}).`);
          assert(ends.every((e) => e.cast), `The sky island's file at ${w} x ${h} ends with the island's shadow box only when ${ends.filter((e) => e.cast).map((e) => e.how).join('') || 'neither'}: ${ends.map((e) => `${e.how} ${e.cast ? 'the island\'s' : 'the town\'s'}`).join(', ')}.`);
        }
        // (c4d) The sky island's own file's wide box (the final art review's first finding: at the two Rotate
        // stops whose frames show the north-west headland's coast, and at one the airport's armour, the
        // town's box left the island without a shadow, its tree, villa, furniture and Alison pasted on the
        // lawn; a box round the island alone left the headland's houses, trees and washing lines without
        // theirs and cut a house's at its edge). On every file framing at every Rotate stop, through the
        // frame loop's own followSky (the turn's press deciding at the framing it heads for):
        // - the island casts at every stop: its own box at the file's bearing and the next stop (as above),
        //   at the other two a box round it and every piece of land the whole frame shows, the panel's and
        //   the sheet's part too (checked here with rays of the check's own, a screen point every 1/32 of
        //   the frame and every 0.5 of height up to SKY_WIDE.height, on the plan's coast, armour and rock:
        //   none outside it, nor past its near or far plane), at rest, through the idle drift (to 0.096 either
        //   way, the frame loop's own turn of the camera) and on every third frame of the turn after it has
        //   changed hands, so no box edge is ever in the frame;
        // - its half-size within SKY_WIDE.most, so the town's land keeps at least its own box's sharpness on
        //   both tiers (the island's map over twice it, against the town's map over 92), each box laid on its
        //   own texels in the light of the bearing it was laid for, and the drift never moving it;
        // in Manual Day's sun on ten framings, and in the lowest sun the key light takes (golden hour, 40
        // degrees up) and at its swing's two ends on three of them. And on all 25 file framings, in the
        // suns that need the widest boxes (the key light lowest and swung furthest, an early summer
        // morning's), a box of SKY_WIDE.most at the most holds both at those two stops.
        {
          const { sunOffsetFor } = await import(pathToFileURL(path.join(output, 'city-atmosphere.mjs')).href);
          const inside = (x, z) => Math.hypot(x, z) <= plan.islandRadius(Math.atan2(z, x)) + 3.3 || plan.airportDistance(x, z) <= plan.AIRPORT.armour || Math.hypot(x - plan.lighthouseRock[0], z - plan.lighthouseRock[1]) <= 3.5,
            from = new T.Vector3(),
            along = new T.Vector3(),
            // Rays through the whole frame: the land each meets between SKY_WIDE.height and the ground.
            landRays = (camera, H) => {
              const out = [];
              for (let i = 0; i <= 32; i++)
                for (let j = 0; j <= 32; j++) {
                  from.set(-1 + i / 16, -1 + j / 16, -1).unproject(camera);
                  along.set(-1 + i / 16, -1 + j / 16, 1).unproject(camera).sub(from);
                  for (let y = H; y >= 0; y -= 0.5) {
                    const t = (y - from.y) / along.y,
                      x = from.x + along.x * t,
                      z = from.z + along.z * t;
                    if (inside(x, z)) out.push(new T.Vector3(x, y, z));
                  }
                }
              return out;
            },
            // How far a box holds the island and those points, in the light at `bearing` (0 or more: inside).
            spare = (run, box, camera, bearing, sunOffset) => {
              const key = sunOffset.clone().applyAxisAngle(new T.Vector3(0, 1, 0), bearing - Math.PI / 4),
                { x, y, z } = run.lightAxes(key),
                reach = box.reach || key.length(),
                C = sun.SKY_SHADOW.centre;
              let room = box.radius - Math.max(Math.abs(C.clone().sub(box.centre).dot(x)), Math.abs(C.clone().sub(box.centre).dot(y))) - sun.SKY_SHADOW.radius;
              for (const p of landRays(camera, run.SKY_WIDE.height)) {
                const d = p.clone().sub(box.centre);
                room = Math.min(room, box.radius - Math.abs(d.dot(x)), box.radius - Math.abs(d.dot(y)), reach - 0.5 - d.dot(z), d.dot(z) - (reach - box.far));
              }
              return room;
            },
            wide = { count: 0, least: Infinity, most: 0, room: Infinity, frames: 0 };
          const day = sunOffsetFor(0.6, Math.PI),
            suns = [day, sunOffsetFor(0.02, Math.PI * 1.45), sunOffsetFor(0.4, Math.PI - 2.2), sunOffsetFor(0.4, Math.PI + 2.2)];
          for (const [w, h, shift, drop, foot, sunOffset] of [
            ...[desktopFiles[0], desktopFiles[4], desktopFiles[5], portraitFiles[1], portraitFiles[4], portraitFiles[8], sidewaysFiles[0], sidewaysFiles[3], sidewaysFiles[7], tabletFile].map((f) => [...f, day]),
            ...suns.slice(1).flatMap((sun) => [desktopFiles[4], portraitFiles[4], sidewaysFiles[3]].map((f) => [...f, sun])),
          ]) {
            const { ctx, run, step, rests, maps } = stage(w, h, shift, drop, foot);
            ctx.sunOffset.copy(sunOffset);
            run.select('sky-island');
            ctx.controls.target.copy(ctx.target);
            ctx.camera.zoom = ctx.targetZoom;
            ctx.camera.updateProjectionMatrix();
            ctx.pitch = run.aim(ctx.targetZoom);
            ctx.tween = false;
            for (let f = 0; f < 120; f++) step();
            for (let stop = 1; stop <= 4; stop++) {
              const before = maps.length,
                at = `Rotate stop ${stop % 4 || 4} at ${w} x ${h}${sunOffset === day ? '' : ` in the sun at ${sunOffset.toArray().map((v) => v.toFixed(1)).join(', ')}`}`;
              run.rotate();
              for (let f = 0, still = 0; f < 900 && still < 30; f++) {
                const laying = maps.length;
                step();
                still = rests() ? still + 1 : 0;
                // A wide box as it is laid: on its own texels in the light of the bearing it was laid for.
                if (maps.length > laying && ctx.skyBox && ctx.skyBox !== run.SKY_TIGHT) {
                  const { x, y } = run.lightAxes(sunOffset.clone().applyAxisAngle(new T.Vector3(0, 1, 0), ctx.targetYaw - Math.PI / 4)),
                    texel = (2 * ctx.skyBox.radius) / (2 * ctx.shadowBase);
                  assert([x, y].every((a) => Math.abs(ctx.skyBox.centre.dot(a) / texel - Math.round(ctx.skyBox.centre.dot(a) / texel)) < 1e-6), `${at}: the wide box laid at frame ${f} of the turn is off its own texels.`);
                }
                // Every third frame once the turn's box is laid: it holds what the frame shows, in that frame's light.
                if (maps.length > before && ctx.skyBox && ctx.skyBox !== run.SKY_TIGHT && f % 3 === 0) {
                  wide.frames++;
                  const room = spare(run, ctx.skyBox, ctx.camera, ctx.yaw, sunOffset);
                  wide.room = Math.min(wide.room, room);
                  assert(room >= 0, `${at}: at frame ${f} of the turn the land the frame shows reaches ${(-room).toFixed(2)} past the sun's wide box.`);
                }
              }
              assert(ctx.skyCast, `${at}: the sky island casts no shadow at rest.`);
              if (stop % 4 < 2) continue;
              const box = ctx.skyBox;
              assert(box && box !== run.SKY_TIGHT && box.radius <= run.SKY_WIDE.most && 2 * ctx.shadowBase / (2 * box.radius) >= 2048 / 92 && 1024 * 2 / (2 * box.radius) >= 1536 / 92, `${at}: the file has no wide box, or one too wide to keep the town's sharpness (${box?.radius}).`);
              wide.count++;
              wide.least = Math.min(wide.least, box.radius);
              wide.most = Math.max(wide.most, box.radius);
              // Through the idle drift, the frame loop's own turn of the camera about its target: never moved, always holding.
              const laid = maps.length;
              for (let f = 0; f <= 32; f++) {
                ctx.driftAngle = 0.096 * Math.sin((f / 32) * 2 * Math.PI);
                step();
                const room = spare(run, box, ctx.camera, ctx.yaw, sunOffset);
                wide.room = Math.min(wide.room, room);
                assert(room >= 0 && ctx.skyBox === box, `${at}, drifted ${ctx.driftAngle.toFixed(3)}: the sun's wide box ${ctx.skyBox === box ? `holds the land the frame shows only to ${room.toFixed(2)}` : 'moves'}.`);
              }
              ctx.driftAngle = 0;
              step();
              assert.equal(maps.length, laid, `${at}: the idle drift moves the sun's wide box.`);
            }
          }
          // Every framing in the widest suns: the views a turn's press decides at (the way there from the
          // stop before, the stop's own framing through the drift), each in its own light.
          let widest = 0;
          const { run: fit } = stage(...tabletFile);
          for (const [w, h, shift, drop] of files)
            for (const sunOffset of [day, sunOffsetFor(0.1, Math.PI - 1.6), sunOffsetFor(0.02, Math.PI - 2.2), sunOffsetFor(0.02, Math.PI + 2.6)])
              for (const stop of [2, 3]) {
                const end = fileBearing + (stop * Math.PI) / 2,
                  key = (b) => sunOffset.clone().applyAxisAngle(new T.Vector3(0, 1, 0), b - Math.PI / 4),
                  views = [];
                for (let k = 1; k <= 6; k++) {
                  const b = end - Math.PI / 2 + (Math.PI / 2) * (k / 6),
                    { zoom, centre, low } = settles(w, h, shift, drop, b);
                  for (const d of k === 6 ? [-0.1, 0.1, 0] : [0]) views.push([look(lens(w, h), centre, b + d, low, zoom), key(b)]);
                }
                const box = fit.skyWideBox(views, 2048);
                assert(box, `The sky island's file at ${w} x ${h}, Rotate stop ${stop + 1}, in the sun at ${sunOffset.toArray().map((v) => v.toFixed(1)).join(', ')}, needs a wide box past ${fit.SKY_WIDE.most}.`);
                widest = Math.max(widest, box.radius);
              }
          skyNav.wide = `the sky island casting at every Rotate stop, its file's wide box round it and the land in frame at ${wide.count} stops (half-size ${wide.least} to ${wide.most}, holding every ray's land through the drift and on ${wide.frames} frames of turning, ${wide.room.toFixed(2)} spare at least; ${widest} at the most on all ${files.length} framings in the widest suns)`;
        }
        skyNav.turns = `${turns.count} Rotate turns of its file on portrait phones and desktops handing the sun's box over ${turns.handed} times, each once at most and within ${turns.latest} frames of the press, the island's box whether its file is opened on or resized into ${histories} tall, narrow windows`;
      }
      skyNav.shadow = `the sun's shadow box the sky island's own in its file on ${files.length} framings (the town's island at most ${(worst.rest * 100).toFixed(1)}% of the free part at rest, ${(worst.drift * 100).toFixed(1)}% through the drift), the town's in ${others} frames of its other files and its overview and on ${pans} pans from the file`;
    }

    // (d) Hidden where a reading frame would cut a slice of it: the People chapter's frames (its row,
    // and each home or the residence picked from it), the reading page's last shot and the opening
    // view (the art review's ninth finding: on a phone its tall frame showed a cut sliver of the rock,
    // the puffs and a floating rock along the very top edge, and the island's shadow on the sea below
    // it); never in City mode or Inspect, nor in the last shot or the opening view once the visitor
    // has panned or zoomed them. And never seen to go or come where it stands in view (the final
    // review's first finding: the opening view's hide outlived a pan or a zoom of it, and took the
    // island away on the first frame of the glide into the opening view from its own file while it
    // still filled the frame). city-scene's own framing calls (reset, select, focusBuildings, overview,
    // focusPark, setYaw, setFrameShift, resize, cancel and the +/- buttons), frame loop (followPanel,
    // the turn, the pitch step, the glide), followSky and city-water's pool on the sea, on a camera of
    // the stage's size; measured with the check's own silhouette of the island (shape) and the
    // pool's square:
    // (d1) out of view in About and Departures; into People from About it goes at once, out of view;
    //   on the glide out it comes back only where nothing of it is in view, or once the glide has
    //   ended; City mode and Inspect show it;
    // (d2) the opening view on phones and upright tablets, as the page opens on it and through the
    //   idle drift, never shows it nor its pool;
    // (d3) a drag, a wheel or pinch zoom, or the +/- buttons in the opening view or the last shot show
    //   it at once, wherever any of it is in view, all through the buttons' glides;
    // (d4) glided into the opening view, People or the last shot from a view that shows it (its own
    //   file, by the wordmark or Read; a chapter panned to it, by Recentre), it goes only on a frame
    //   where neither it nor its pool reaches more than a pixel into the frame, or once the camera has
    //   come to rest there with no more than half the box round it in the frame; it is gone by the
    //   time the phone's opening view rests, and a frame that holds it whole (a portrait tablet's
    //   opening view) keeps it.
    {
      const want = ['viewOffset', 'panelOffset', 'offsetTarget', 'followPanel', 'fitOverview', 'fitGroup', 'groupFrame', 'fitFocused', 'focusSky', 'skyFitZoom', 'skyFile', 'skyPivot', 'turnSky', 'aim', 'elevationAt', 'skyFit', 'skyMarks', 'skyExtent', 'skyHidden', 'skyOnScreen', 'followSky', 'align', 'reset', 'select', 'focusBuildings', 'overview', 'cancel', 'resize'],
        vars = ['TOWN_PITCH', 'SKY_LIFT', 'PANEL_CLEAR', 'SKY_MARKS', 'islandMarks', '[rockX, rockZ]', 'AIRPORT_FIT', 'SKY_HIDES', 'SKY_EXTENT', 'onScreen', 'YAW_RATE', 'shortestAngle'],
        methods = ['setYaw', 'setFrameShift', 'zoom', 'focusPark'],
        code = [];
      let pitchSource, firstShown;
      (function collect(node) {
        if (ts.isFunctionDeclaration(node) && want.includes(node.name?.text)) code.push(node.getText(syntax).replace(/^export\s+/, ''));
        if (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => vars.includes(d.name.getText(syntax)))) code.push(node.getText(syntax).replace(/^export\s+/, ''));
        // (How the scene starts: shown or not, before its first frame.)
        if (ts.isVariableDeclaration(node) && node.name.getText(syntax) === 'skyShown') firstShown = node.initializer?.getText(syntax);
        if (ts.isMethodDeclaration(node) && methods.includes(node.name.getText(syntax)))
          code.push(`function ${node.name.getText(syntax) === 'zoom' ? 'zoomBy' : node.name.getText(syntax)}(${node.parameters.map((p) => p.getText(syntax)).join(', ')}) ${node.body.getText(syntax)}`);
        if (ts.isBlock(node) && node.statements[0]?.getText(syntax) === 'const left = aim(camera.zoom) - pitch;') pitchSource = `function pitchStep() ${node.getText(syntax)}`;
        ts.forEachChild(node, collect);
      })(syntax);
      const turning = turnPieces.find((p) => p.startsWith('function turnStep'));
      assert(code.length === want.length + vars.length + methods.length && turning && glideSource && pitchSource && ['true', 'false'].includes(firstShown), 'The hiding check must find every piece it runs.');
      const { WATER } = await import(pathToFileURL(path.join(output, 'town-shared.mjs')).href),
        { createSeaShadow } = await import(pathToFileURL(path.join(output, 'city-water.mjs')).href),
        UP = new T.Vector3(0, 1, 0),
        keyOffset = new T.Vector3(),
        pool = createSeaShadow(WATER),
        sky = {
          T,
          Math,
          plan,
          camera: new T.OrthographicCamera(-24, 24, 24, -24, -200, 180),
          controls: { target: new T.Vector3(), minZoom: 0.45, zoomToCursor: false },
          container: { clientWidth: 1, clientHeight: 1 },
          renderer: { setSize() {} },
          ink: { resize() {} },
          target: new T.Vector3(),
          shiftApplied: new T.Vector3(),
          screenRight: new T.Vector3(),
          screenUp: new T.Vector3(),
          offset: new T.Vector3(),
          width: 1,
          height: 1,
          frameShift: 0,
          frameDrop: 0,
          frameFoot: 1,
          panelEdge: 1,
          yaw: Math.PI / 4,
          targetYaw: Math.PI / 4,
          targetZoom: 1,
          pitch: 0,
          driftAngle: 0,
          tween: false,
          reduced: false,
          dt: 1 / 60,
          blend: 1 - Math.exp(-5.5 / 60),
          focusedIds: [],
          overviewFit: false,
          inspect: null,
          parkSelected: false,
          autoFocus: false,
          inspectionAutoFit: true,
          cityMode: false,
          lastInteraction: 0,
          performance: { now: () => 0 },
          CITY_MAX_ZOOM: 4,
          STUDY_MAX_ZOOM: 8,
          // The town's buildings as their sites' boxes (fitFocused frames a model's bounds).
          models: new Map(
            buildings
              .filter((b) => b.model !== 'sky')
              .map((b) => {
                const s = plan.sites[b.id],
                  root = new T.Group(),
                  mesh = new T.Mesh(new T.BoxGeometry(s.w, s.height, s.d));
                mesh.position.y = s.height / 2;
                root.add(mesh);
                root.position.set(s.x, 0, s.z);
                root.rotation.y = s.rotation;
                root.updateMatrixWorld(true);
                return [b.id, { root, center: new T.Vector3(s.x, s.height / 2, s.z) }];
              }),
          ),
          city: { updateMatrixWorld() {} },
          island: { root: { visible: false } },
          skyShown: false,
          skyCast: false,
          skyBox: null,
          skyNext: null,
          shadowFade: 1,
          skyTurn: false,
          skyCasters: [],
          // (The sun's box is (c4)'s: here the town's throughout.)
          skyShadowWanted: () => false,
          skyClose: () => false,
          skySettled: () => false,
          SKY_TIGHT: {},
          LAND_MARKS: [],
          SKY_SHADOW: { fade: 0.18 },
          shadowFocus() {},
          seaShadow: pool,
          exitInspection() {},
          clearHover() {},
          // The key light at the opening bearing's offset, turned with the camera (placeSun).
          placeSun() {
            keyOffset.set(-16, 32, 20).applyAxisAngle(UP, sky.yaw - Math.PI / 4);
          },
        },
        run = runInNewContext(
          `${ts.transpileModule([...code, turning, glideSource, pitchSource].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};({ followPanel, turnStep, glideStep, pitchStep, align, followSky, reset, select, focusBuildings, cancel, resize, overview, setYaw, setFrameShift, zoomBy, focusPark, aim })`,
          sky,
        ),
        // One frame of step(): the panel offset, the turn, the pitch, the glide, the camera on its target
        // (OrbitControls' update), the view handed over, then followSky and the pool laid for the frame.
        step = () => {
          run.followPanel();
          run.turnStep();
          run.pitchStep();
          run.glideStep();
          run.align();
          if (!sky.tween) sky.target.copy(sky.controls.target);
          sky.camera.updateMatrixWorld();
          run.followSky(1 / 60);
          sky.placeSun();
          pool.update(keyOffset, 0, 0, sky.skyShown);
          pool.mesh.updateMatrixWorld();
        },
        // The camera at rest in the framing it chose: its glide, turn and pitch done.
        rests = () => sky.autoFocus && !sky.tween && Math.abs(sky.targetYaw - sky.yaw) <= 1e-4 && Math.abs(run.aim(sky.camera.zoom) - sky.pitch) <= 1e-4,
        // How far the screen box round world points (or points in `matrix`'s frame) reaches into the stage (px), and what share of the box lies there.
        seen = (points, matrix) => {
          const q = new T.Vector3();
          let x0 = Infinity,
            x1 = -Infinity,
            y0 = Infinity,
            y1 = -Infinity;
          for (const p of points) {
            q.copy(p);
            if (matrix) q.applyMatrix4(matrix);
            q.project(sky.camera);
            [x0, x1, y0, y1] = [Math.min(x0, q.x), Math.max(x1, q.x), Math.min(y0, q.y), Math.max(y1, q.y)];
          }
          const across = Math.max(0, Math.min(x1, 1) - Math.max(x0, -1)),
            down = Math.max(0, Math.min(y1, 1) - Math.max(y0, -1));
          return { reach: Math.min((across * sky.width) / 2, (down * sky.height) / 2), share: (across * down) / ((x1 - x0) * (y1 - y0)) };
        },
        square = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => new T.Vector3(x, 0, z)),
        island = () => seen(shape),
        water = () => seen(square, pool.mesh.matrixWorld),
        // The stage at w x h (resize(): the scene's camera fitted to it).
        stage = (w, h) => {
          Object.assign(sky.container, { clientWidth: w, clientHeight: h });
          run.resize();
        },
        // The reading panel's left edge as a share of the width (page.tsx's readingEdge, no scrollbar).
        edge = (vw) => {
          const pad = Math.min(56, Math.max(16, 0.04 * vw)),
            wide = vw <= 1180 ? Math.min(600, Math.max(380, 0.5 * vw)) : Math.min(640, Math.max(400, 0.44 * vw));
          return (vw - pad - Math.min(vw - 2 * pad, wide)) / vw;
        },
        // The page's framing calls: City mode's file (frameCity, fileFrame's shift and drop), and the reading page's shots (page.tsx).
        file = (shift, drop) => {
          Object.assign(sky, { cityMode: true, frameShift: shift, frameDrop: drop, panelEdge: 1 });
          run.setYaw(fileBearing);
          run.select('sky-island');
        },
        chapter = (id, w, wide) => {
          sky.cityMode = false;
          run.setYaw(plan.chapterBearings[id]);
          run.setFrameShift(wide ? 0.21 : 0, 0, wide ? edge(w) : 1);
          if (id === 'people') run.focusBuildings([...plan.chapterSubjects.people]);
          else run.select(id);
        },
        hero = (wide) => {
          sky.cityMode = false;
          run.setYaw(Math.PI / 4);
          run.reset();
          run.setYaw(Math.PI / 4);
          run.setFrameShift(wide ? -0.06 : 0);
        },
        last = (wide) => {
          sky.cityMode = false;
          run.setFrameShift(wide ? 0.21 : 0, 0);
          run.overview(true);
        },
        // As the page opens: the scene's state at its first frame, the stage at w x h.
        open = (w, h) => {
          sky.controls.target.set(0, 0, 0);
          sky.target.set(0, 0, 0);
          sky.shiftApplied.set(0, 0, 0);
          sky.camera.zoom = 1;
          Object.assign(sky, { yaw: Math.PI / 4, targetYaw: Math.PI / 4, targetZoom: 1, pitch: 0, driftAngle: 0, tween: true, focusedIds: [], overviewFit: false, inspect: null, parkSelected: false, autoFocus: false, cityMode: false, skyShown: firstShown === 'true', frameShift: 0, frameDrop: 0, frameFoot: 1, panelEdge: 1 });
          stage(w, h);
        },
        settle = () => {
          for (let f = 0, still = 0; f < 1200 && still < 5; f++) {
            step();
            still = rests() ? still + 1 : 0;
          }
        },
        worst = { went: 0, share: 0, glides: 0 },
        // Frame by frame to rest: wherever it goes, nothing of it or its pool is left in the frame but a pixel, or the camera has come to rest with no more than half the box round it in the frame.
        watch = (label) => {
          let went = false;
          for (let f = 0, still = 0; f < 1200 && still < 5; f++) {
            const was = sky.skyShown;
            step();
            still = rests() ? still + 1 : 0;
            if (!was || sky.skyShown) continue;
            const it = island(),
              sea = water();
            went = true;
            assert((it.reach <= 1 + 1e-9 && sea.reach <= 1 + 1e-9) || (rests() && it.share <= 0.5), `${label}: the sky island goes at frame ${f} with ${it.reach.toFixed(1)} px of it (${(it.share * 100).toFixed(0)}% of the box round it) and ${sea.reach.toFixed(1)} px of its pool on the sea still in the frame${rests() ? '' : ', the camera still moving'}.`);
            if (rests()) worst.share = Math.max(worst.share, it.share);
            else worst.went = Math.max(worst.went, it.reach, sea.reach);
          }
          worst.glides++;
          return went;
        };
      // (d1) About, People from it, Departures after it; City mode and Inspect.
      open(1440, 900);
      chapter('town-hall', 1440, true);
      settle();
      assert(sky.skyShown && island().reach === 0, 'The sky island is hidden in the About chapter, or in view there.');
      chapter('people', 1440, true);
      step();
      assert(!sky.skyShown && !pool.mesh.visible, 'Glided into the People chapter from About, where it is out of view, the sky island does not go at once.');
      settle();
      assert(!sky.skyShown, 'The sky island shows in the People chapter.');
      chapter('airport', 1440, true);
      for (let f = 0, still = 0; f < 1200 && still < 5; f++) {
        const was = sky.skyShown;
        step();
        still = rests() ? still + 1 : 0;
        assert(was || !sky.skyShown || !sky.tween || island().reach <= 1, `The sky island comes back in view at frame ${f} of the glide out of the People chapter.`);
      }
      assert(sky.skyShown && island().reach === 0, 'The sky island does not come back once the glide out of the People chapter has ended, or shows in Departures.');
      chapter('people', 1440, true);
      step();
      sky.cityMode = true;
      step();
      assert(sky.skyShown, 'The sky island is hidden in City mode.');
      Object.assign(sky, { cityMode: false, inspect: {} });
      step();
      assert(sky.skyShown, 'The sky island is hidden in Inspect.');
      sky.inspect = null;
      // (d2) The opening view on phones and upright tablets (the reading page docks the stage 46% of the
      // screen tall, 320 px at the least: globals.css; a portrait tablet of 1024 wide lays the page out
      // wide, the stage the whole screen, and holds it all but whole) and on desktops, as the page
      // opens on it, through the drift.
      let cut = 0;
      for (const [w, screen, wide] of [[360, 640], [375, 667], [375, 812], [390, 844], [414, 896], [430, 932], [768, 1024], [820, 1180], [1024, 1366, true], [1440, 900, true]]) {
        const h = wide ? screen : Math.max(320, 0.46 * screen);
        if (!wide && drifts.some((d) => overlaps(hull(shape.map((p) => px(w, h, 1, Math.PI / 4 + d, new T.Vector3(), p))), [0, 0, w, h]))) cut++;
        open(w, h);
        hero(wide);
        settle();
        for (const d of drifts) {
          sky.driftAngle = d;
          step();
          assert(!sky.skyShown && !sky.island.root.visible && !pool.mesh.visible, `The opening view at ${w} x ${h.toFixed(0)}, drifted ${d.toFixed(2)}, shows the sky island or its pool.`);
        }
      }
      assert(cut > 0, 'The check no longer finds the opening frame the sky island was cut by.');
      // (d3) The visitor's own view: the -button three times in the opening view at 1440 x 900 (it
      // comes into view at the top), a drag toward it in a phone's opening view, a wheel zoom out
      // at 1440 x 900; in the last shot, a drag and the + button.
      const shownInView = (label, frames, act = () => {}) => {
        for (let f = 0; f < frames; f++) {
          act(f);
          step();
          const it = island();
          assert(it.reach <= 1 || sky.skyShown, `${label}: at frame ${f} ${it.reach.toFixed(1)} px of the sky island are in the frame, hidden.`);
        }
      };
      open(1440, 900);
      hero(true);
      settle();
      assert(!sky.skyShown, 'The sky island shows in the opening view at 1440 x 900.');
      shownInView('The opening view zoomed out with the - button at 1440 x 900', 240, (f) => {
        if (f % 30 === 0 && f < 90) run.zoomBy(1 / 1.25);
      });
      assert(sky.skyShown && island().reach > 1, 'Zoomed out three times from the opening view at 1440 x 900, the sky island is not in view.');
      open(390, Math.max(320, 0.46 * 844));
      hero(false);
      settle();
      run.cancel();
      shownInView('A phone\'s opening view dragged toward the sky island', 90, () => {
        // The map follows the finger down: the view's centre moves up the screen, toward the island.
        sky.controls.target.addScaledVector(new T.Vector3().setFromMatrixColumn(sky.camera.matrixWorld, 1), 0.25);
      });
      assert(sky.skyShown, 'Dragged in a phone\'s opening view, the sky island stays hidden.');
      open(1440, 900);
      hero(true);
      settle();
      run.cancel();
      sky.camera.zoom = sky.targetZoom = 0.6;
      sky.camera.updateProjectionMatrix();
      shownInView('The opening view zoomed out by the wheel at 1440 x 900', 30);
      assert(sky.skyShown, 'Zoomed out by the wheel from the opening view, the sky island stays hidden.');
      open(1440, 900);
      chapter('town-hall', 1440, true);
      settle();
      last(true);
      settle();
      assert(!sky.skyShown, 'The sky island shows in the reading page\'s last shot.');
      run.cancel();
      shownInView('The last shot dragged', 30);
      assert(sky.skyShown, 'Dragged, the reading page\'s last shot keeps the sky island hidden.');
      chapter('town-hall', 1440, true);
      settle();
      last(true);
      settle();
      assert(!sky.skyShown, 'The sky island shows in the reading page\'s last shot, come to from About.');
      shownInView('The last shot zoomed in with the + button', 120, (f) => f || run.zoomBy(1.25));
      // (d4) Glided in from views that show it.
      const leaving = [
        ['1440 x 900', 1440, 900, 492 / 2880, 0, true],
        ['1280 x 720', 1280, 720, 492 / 2560, 0, true],
        ['390 x 844', 390, 844, 0, -100.95 / 844, false],
        ['430 x 932', 430, 932, 0, -100.95 / 932, false],
      ];
      for (const [size, w, h, shift, drop, wide] of leaving)
        for (const { into, frameIt } of [
          { into: 'the opening view', frameIt: () => hero(wide) },
          { into: 'the People chapter', frameIt: () => chapter('people', w, wide) },
          { into: 'the last shot', frameIt: () => last(wide) },
        ]) {
          // Its own file, at rest, the island in view; then the page leaves City mode (a phone's stage docked).
          open(w, h);
          file(shift, drop);
          settle();
          assert(sky.skyShown && island().reach > 50, `The sky island's file at ${size} does not show it.`);
          frameIt();
          if (!wide) stage(w, Math.max(320, 0.46 * h));
          watch(`From its file at ${size} into ${into}`);
          if (into === 'the opening view') assert(!sky.skyShown && !pool.mesh.visible, `From its file at ${size}, the opening view comes to rest with the sky island or its pool in view.`);
        }
      // Recentre in the About chapter panned to it, at 1440 x 900.
      open(1440, 900);
      chapter('town-hall', 1440, true);
      settle();
      run.cancel();
      for (let f = 0; f < 240 && island().share < 0.75; f++) {
        sky.controls.target.addScaledVector(new T.Vector3(plan.SKY.x, 0, plan.SKY.z).sub(sky.controls.target).setY(0).normalize(), 0.5);
        step();
      }
      assert(sky.skyShown && island().share >= 0.75, `Panned to the sky island in the About chapter, the check cannot bring it into view (${(island().share * 100).toFixed(0)}% of it).`);
      hero(true);
      watch('Recentre in About panned to the sky island, at 1440 x 900');
      assert(!sky.skyShown, 'Recentre from About panned to the sky island comes to rest with it in view at 1440 x 900.');
      // A portrait tablet's opening view holds it all but whole (wide layout, the stage the whole
      // screen): left from its own file by the wordmark, it is never taken away there.
      open(1024, 1366);
      file(492 / 2048, 0);
      settle();
      hero(true);
      watch('From its file into the opening view at 1024 x 1366');
      assert(sky.skyShown && island().share > 0.75, `The opening view at 1024 x 1366, glided into from the sky island's file, takes it away where most of it stands in the frame (${(island().share * 100).toFixed(0)}% of the box round it).`);
      skyNav.hero = `hidden in the opening view (it would be cut on ${cut} of 8 phone and tablet frames) until the visitor pans or zooms it, and never taken away in view: ${worst.glides} glides into the frames that hide it, ${worst.went.toFixed(1)} px of it or its pool in the frame at most where it went mid-glide, ${(worst.share * 100).toFixed(0)}% of the box round it where it went at rest`;
    }
    // Every other reading frame leaves it out of sight through the idle drift: each chapter's
    // subject framed beside the reading panel from 1024 wide (its buildings as their sites' boxes,
    // the corner park at its zoom of 2.2), and the narrow page's chapters on tablets and phones.
    {
      view.models = new Map(
        buildings
          .filter((b) => b.model !== 'sky')
          .map((b) => {
            const s = plan.sites[b.id],
              root = new T.Group(),
              mesh = new T.Mesh(new T.BoxGeometry(s.w, s.height, s.d));
            mesh.position.y = s.height / 2;
            root.add(mesh);
            root.position.set(s.x, 0, s.z);
            root.rotation.y = s.rotation;
            root.updateMatrixWorld(true);
            return [b.id, { root }];
          }),
      );
      const edgeOf = (vw) => {
          const pad = Math.min(56, Math.max(16, 0.04 * vw)),
            wide = vw <= 1180 ? Math.min(600, Math.max(380, 0.5 * vw)) : Math.min(640, Math.max(400, 0.44 * vw));
          return (vw - pad - Math.min(vw - 2 * pad, wide)) / vw;
        },
        subjects = { 'town-hall': 'town-hall', airport: 'airport', 'research-studio': 'research-studio', 'city-archive': 'city-archive', 'lius-gate': 'lius-gate', 'corner-park': null };
      for (const [w, h, narrow] of [...desktops.map(([w, h]) => [w, h, false]), [768, 1024, true], [820, 1180, true], [390, 844, true], [430, 932, true], [360, 800, true]])
        for (const [chapter, id] of Object.entries(subjects)) {
          const bearing = plan.chapterBearings[chapter];
          frame(w, h, narrow ? 0 : 0.21, bearing);
          view.frameDrop = 0;
          view.panelEdge = narrow ? 1 : edgeOf(w);
          view.overviewFit = false;
          if (id) {
            view.focusedIds = [id];
            view.target.set(0, 0, 0);
            scene.fitFocused();
          } else {
            view.target.set(plan.park.x, 0, plan.park.z);
            view.targetZoom = 2.2;
            view.target.add(new T.Vector3(Math.cos(bearing), 0, -Math.sin(bearing)).multiplyScalar(((narrow ? 0 : 0.21) * (view.camera.right - view.camera.left)) / 2.2));
          }
          for (const d of drifts)
            assert(!overlaps(hull(shape.map((p) => px(w, h, view.targetZoom, bearing + d, view.target, p))), [0, 0, w, h]), `The reading page's ${chapter} chapter shows the sky island at ${w} x ${h}, drifted ${d.toFixed(2)}.`);
        }
      view.panelEdge = 1;
      view.focusedIds = [];
      view.models = new Map();
    }
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
    /focusedIds\.length === 1 && focusedIds\[0\] === 'airport'\)\s*\{\s*fitGroup\(AIRPORT_FIT, 0\.95, 2\.6, panelEdge\);/.test(fitFocusedSource) &&
      (fitFocusedSource.match(/panelEdge/g) ?? []).length === 1 &&
      /focusedIds = \[id\];[\s\S]*fitFocused\(\);/.test(selectSource),
    'Selecting the airport no longer fits its island and causeway (beside the panel where it really starts, and nothing else by it).',
  );
  // The reading page tells the scene where its panel really starts, measured, as it frames a
  // chapter beside it and again when the window is resized there; City mode's file passes none (an
  // edge of 1), but where its free band ends below, the sheet's or the bars' top (fileFrame's foot),
  // which the scene keeps for the sun's shadow box (skyShadowWanted: (c4) above).
  {
    // (The resize's refit sets the edge it has just measured: within 120 characters, as written.)
    const page = await fs.readFile(path.join(root, 'app/page.tsx'), 'utf8'),
      measured = unformatted('const next = readingEdge(mount.current);'),
      set = unformatted('engine.setFrameShift(0.21, 0, edge);'),
      refit = unformatted(page).indexOf(measured);
    assert(
      holds(
        page,
        "panel = document.querySelector<HTMLElement>('.chapter .panel')?.getBoundingClientRect();",
        'engine.setFrameShift(wide ? 0.21 : 0, 0, wide ? readingEdge(mount.current) : 1);',
        'api.current?.setFrameShift(at.shift, at.drop, 1, at.foot);',
      ) &&
        refit >= 0 &&
        unformatted(page).slice(refit, refit + measured.length + 120 + set.length).includes(set),
      'The reading page no longer passes its panel\'s measured edge to the scene (or City mode now does).',
    );
    assert(/panelEdge = T\.MathUtils\.clamp\(edge, 0\.3, 1\);/.test(source), 'The scene no longer keeps the panel\'s edge.');
    assert(
      holds(page, 'const none = { shift: 0, drop: 0, foot: 1, sheet: false };', 'foot: (bottom - frame.top) / frame.height') && holds(source, 'frameFoot = T.MathUtils.clamp(foot ?? 1 + 2 * Math.min(0, frameDrop), 0.1, 1);'),
      'City mode\'s file no longer tells the scene where its free band ends (the sheet\'s or the bars\' top, or the frame\'s foot), or the scene no longer keeps it (the drop\'s band where a framing gives none).',
    );
  }
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
  sunBack: 0,
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
  if (ts.isFunctionDeclaration(node) && ['placeSun', 'viewOffset', 'elevationAt'].includes(node.name?.text))
    moonPieces.push(node.getText(syntax));
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => d.name.getText(syntax) === 'TOWN_PITCH'))
    moonPieces.push(node.getText(syntax).replace(/^export\s+/, ''));
  ts.forEachChild(node, collectMoon);
}
collectMoon(syntax);
assert.equal(moonPieces.length, 4, 'The moon check must find every piece it runs.');
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
  // The light at the key's own offset from its box (not the sky island's file's wide box: SKY_WIDE).
  sunBack: 0,
  yaw: Math.PI / 4,
  // The town's pitch; the sky island's file (its own lower one) is checked after.
  pitch: 0,
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
// In the sky island's file the camera comes down to its own pitch, where the mirror direction runs
// nearer the horizon: the moon still keeps clear of it, at every bearing the file can be turned to.
sky.pitch = 1;
for (let i = 0; i < 64; i++) {
  sky.yaw = Math.PI / 4 + (i / 64) * Math.PI * 2;
  skyTurn.placeSun();
  const glint = moonGlint();
  assert(glint < 0.95, `In the sky island's file at bearing ${sky.yaw.toFixed(2)} the moon sits ${((Math.acos(Math.min(1, glint)) * 360) / Math.PI).toFixed(0)}° off the sea's mirror direction.`);
}
sky.pitch = 0;
sky.yaw = Math.PI / 4;
skyTurn.placeSun();
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
// The canvas's listeners, found by the syntax tree (a formatter breaks a long call over lines, and a
// search for its text then misses it: the 3D review's eighth finding): each handler added to the
// canvas for its event while the town runs, and removed from it in dispose().
const listens = (method, event, handler, disposing) => {
  let found = false;
  (function find(node, inDispose) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === method &&
      unformatted(node.expression.expression.getText(syntax)) === 'renderer.domElement' &&
      node.arguments.length === 2 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === event &&
      ts.isIdentifier(node.arguments[1]) &&
      node.arguments[1].text === handler &&
      inDispose === disposing
    )
      found = true;
    ts.forEachChild(node, (child) => find(child, inDispose || (ts.isMethodDeclaration(node) && node.name.getText(syntax) === 'dispose')));
  })(syntax, false);
  return found;
};
for (const [event, handler] of [
  ['webglcontextlost', 'contextLost'],
  ['webglcontextrestored', 'contextRestored'],
])
  assert(
    listens('addEventListener', event, handler, false) && listens('removeEventListener', event, handler, true),
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
// Selection adds two depth-aware mask passes (the multisampled test, then its pixel centres;
// check-hover holds their shaders); all renderer state survives failure.
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
assert.equal(renders, 4);
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
  `Navigation checks passed: ${ids.length} shared records in both modes, legacy/back-navigation targets, ${nav.readingChapters.length} reading chapters with Departures (the airport's, framed on its island) right after People, a tour of ${nav.tourStops.length} stops ending in the park, the sky island out of the opening view and every reading frame but those that hide it, in City mode's overview (${skyNav.overview}) and whole in its own file ${skyNav.file} through the drift, ${skyNav.rotate}, ${skyNav.rotatePanned}, ${skyNav.sideways}, ${skyNav.pocket}, ${skyNav.shadow}, ${skyNav.turns}, ${skyNav.wide}, ${skyNav.hero}, ${Object.keys(personPhotos).length} portrait slots (${nav.people.length} members), hidden/visible camera resizing, quick Rotate presses that keep their way round, +/- during a glide, a pan limit held on the view's ground point through real OrbitControls (no jumps, no pull when a glide hands over), a sea past every zoomed-out frame, a plane that leaves and comes back out of every standard frame, an eased zoom out of Inspect, no idle drift with reduced motion and a drift that stops where it is, a motion preference followed while the page is open, a sun shadow redrawn whenever its map is replaced, a quality governor that climbs back after a slow moment, no frame before the first sky, windows put on the clock after hours without frames, a moon that turns with the camera, a studio light baked again after a lost GPU context.`,
);
