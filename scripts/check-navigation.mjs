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
// Each module the checks load, and every module it imports in turn (the tropic island's land
// builder, town-tropic, brings its own: its extent is what the scene's framing of it reads).
const modulesCompiled = new Set();
async function compileModule(name) {
  if (modulesCompiled.has(name)) return;
  modulesCompiled.add(name);
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
  for (const [, imported] of source.matchAll(/\bfrom\s+['"]\.\/([\w-]+)['"]/g)) await compileModule(imported);
}
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
  'town-tropic',
])
  await compileModule(name);
// The tropic island's extent (town-tropic: its outline at the water and the tops of its roof and
// trees) and what of it can show on screen (its extent, its shelf and shallows round it, its crowns'
// ring a little past its waterline), which the scene's pieces below read as city-scene imports them.
const { TROPIC_EXTENT, TROPIC_SEEN } = await import(pathToFileURL(path.join(output, 'town-tropic.mjs')).href);
// What the sky island's framing checks found, for the summary; and the tropic island's.
const skyNav = {},
  tropicNav = { fits: [] };
/**
 * Code without its formatting, to look for a statement in: no whitespace, and no trailing comma
 * before a closing bracket. The repo's formatter (pnpm format, oxfmt) wraps long lines and adds
 * those commas, and a pin on page.tsx's code must not fail on that.
 */
const unformatted = (code) => code.replace(/\s+/g, '').replace(/,(?=[)\]}])/g, '');
/** Whether `code` holds each statement, formatted however (see unformatted). */
const holds = (code, ...statements) => statements.every((s) => unformatted(code).includes(unformatted(s)));
const plan0 = await import(pathToFileURL(path.join(output, 'town-plan.mjs')).href),
  nav = await import(
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
// Twelve stops: the gate, the hall, the three homes, the residence, then the two neighbour islands,
// the sky island and the tropic island (their files' bearing is the airport's, so the tour turns no
// more for them), the airport, the studio, the archive and the park.
assert.equal(nav.tourStops.length, 12);
assert.deepEqual(
  nav.tourStops.slice(5),
  ['visiting-phd', 'sky-island', 'tropic-island', 'airport', 'research-studio', 'city-archive', 'corner-park'],
);
assert(['sky-island', 'tropic-island', 'airport'].every((id) => plan0.chapterBearings[id] === plan0.chapterBearings['lius-gate']), 'The neighbour islands\' files and the airport\'s no longer share the gate\'s bearing: the tour turns between them.');
// The neighbour islands (the sky island and the tropic island) each have a City file and a bearing
// of their own but no reading chapter: an island's address reads its host chapter, About (the Town
// Hall's), whose chip it lights in the masthead; City mode faces it from its own bearing; and the
// reading page never makes it its address, so the reading camera keeps to About's own subject.
const neighbourIslands = ['sky-island', 'tropic-island'];
for (const island of neighbourIslands) {
  assert.equal(nav.chapterFor(island), 'town-hall');
  assert.equal(nav.chapterFor('place:' + island), 'town-hall');
  assert.equal(nav.facingChapter(island), island);
  assert.equal(nav.facingChapter('place:' + island), island);
  assert.equal(nav.readingContent(island, 'town-hall'), 'town-hall');
  assert.deepEqual(nav.sceneTarget(island), { building: island });
  assert.equal(nav.placeFor(island), island);
  assert(!nav.readingChapters.includes(island) && !nav.destinations.includes(island), `The ${island} has a reading chapter or a masthead chip of its own.`);
}
// A place picked on the model opens in the mode it was picked in, but a neighbour island, with no
// chapter of its own, opens its City file from the reading page too (#city/sky-island,
// #city/tropic-island), where its pick would only have scrolled to About. pickRoute says where a
// pick goes: that mode, and the address the place opens.
for (const b of buildings) {
  const hosted = neighbourIslands.includes(b.id);
  for (const id of [nav.contentForBuilding(b.id), 'place:' + b.id]) {
    assert.equal(nav.modeForPick('city', id), 'city', 'A pick in the city leaves the city: ' + id);
    assert.equal(nav.modeForPick('reading', id), hosted ? 'city' : 'reading', 'A reading-page pick of ' + id + ' opens the wrong mode.');
  }
  for (const mode of ['city', 'reading'])
    assert.deepEqual(
      nav.pickRoute(mode, b.id),
      [mode === 'reading' && hosted ? 'city' : mode, nav.contentForBuilding(b.id)],
      'A pick of ' + b.id + ' on the ' + mode + ' page goes to the wrong mode or address.',
    );
}
for (const island of neighbourIslands) assert.deepEqual(nav.pickRoute('reading', island), ['city', island]);
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
  // The widest zoom the town allows on a w x h frame (city-scene's WIDEST: OrbitControls' minZoom, set
  // by resize() for the frame's shape, which the overview's fit keeps to as well).
  WIDEST_ZOOM = (([, wide, tall]) => ({ wide: Number(wide), tall: Number(tall) }))(/\bexport const WIDEST = \{ wide: ([\d.]+), tall: ([\d.]+) \};/.exec(await fs.readFile(path.join(root, 'app', 'city-scene.ts'), 'utf8')) ?? []),
  widestOf = (w, h) => (w >= h ? WIDEST_ZOOM.wide : WIDEST_ZOOM.tall),
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
    controls: { minZoom: 0 },
    WIDEST: WIDEST_ZOOM,
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
// The widest zoom follows the frame's shape: a wide frame's (the last one, 1100 x 720) goes out to
// City mode's overview of both neighbour islands, a tall one's (360 x 460 before it) stays as it was.
assert(context.controls.minZoom === WIDEST_ZOOM.wide && WIDEST_ZOOM.wide === 0.4 && WIDEST_ZOOM.tall === 0.45, 'The town\'s widest zoom no longer follows the frame\'s shape (0.4 wide, 0.45 tall).');
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
// What the checks lane D3 added found, for a summary line of their own.
const laneD3 = {};
// The wheel keeps every notch in a file (the camera review's third finding and its verifier's missed
// one, on the published site too): OrbitControls' 'start' runs cancel() for each wheel event, which
// keeps the zoom before that notch; the next frame's followPanel measured the panel offset at that
// zoom against one measured at another (the zoom before the frame's first notch, when two landed in
// one frame; the zoom a +/- glide aimed at, which it stops a hair short of), took the difference
// for a moved panel and glided the zoom back a notch, the view sliding 14-30 px after the wheel had
// stopped, notch after notch once + or - had been pressed. Through the frame loop's own camera
// pieces in the order step() runs them, the +/- buttons' own method, cancel() on OrbitControls'
// 'start' and three's real OrbitControls for the wheel (at the pointer in City mode, at the view
// centre on the reading page): in the Town Hall's file and the sky island's, beside the panel at
// 1440 x 900 and above the sheet at 768 x 1024, after + and after - each of four notches keeps its
// zoom and the view stays where the wheel left it (no glide at all), and so does a pair of notches
// in one frame; and after + a pinch (one 'start' for the gesture) keeps the zoom the fingers leave
// at every move, nothing moving once they lift.
{
  const want = ['viewOffset', 'panelOffset', 'offsetTarget', 'followPanel', 'aim', 'elevationAt', 'cancel', 'align', 'groupFrame', 'fitGroup', 'focusSky', 'skyFitZoom', 'skyFile', 'skyPivot', 'skyMarks', 'skyFit'],
    vars = ['TOWN_PITCH', 'SKY_LIFT', 'PANEL_CLEAR', 'SKY_FIT', 'YAW_RATE', 'CITY_MAX_ZOOM'],
    code = [];
  let zoomBody, stepBody;
  (function collect(node) {
    if (ts.isFunctionDeclaration(node) && want.includes(node.name?.text)) code.push(node.getText(syntax).replace(/^export\s+/, ''));
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => vars.includes(d.name.getText(syntax)))) code.push(node.getText(syntax).replace(/^export\s+/, ''));
    if (ts.isMethodDeclaration(node) && node.name.getText(syntax) === 'zoom') zoomBody = node.body.getText(syntax);
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'step') stepBody = node.body;
    ts.forEachChild(node, collect);
  })(syntax);
  // The frame loop's camera pieces, as step() orders them: the wheel's sync, the panel followed, the
  // pitch, the glide, OrbitControls' update and the view handed over.
  const shapes = [
      (s) => ts.isIfStatement(s) && s.expression.getText(syntax) === '!tween && camera.zoom !== shownZoom',
      (s) => s.getText(syntax) === 'followPanel();',
      (s) => ts.isBlock(s) && s.statements[0]?.getText(syntax) === 'const left = aim(camera.zoom) - pitch;',
      (s) => ts.isIfStatement(s) && s.expression.getText(syntax) === 'tween' && s.thenStatement.getText(syntax).includes('controls.target.lerp'),
      (s) => s.getText(syntax) === 'controls.update();',
      (s) => s.getText(syntax) === 'if (!tween) target.copy(controls.target);',
      (s) => s.getText(syntax) === 'shownZoom = camera.zoom;',
    ],
    frameCode = stepBody?.statements.filter((s) => shapes.some((is) => is(s))).map((s) => s.getText(syntax));
  assert(code.length === want.length + vars.length && zoomBody && frameCode?.length === shapes.length, 'The wheel check must find every piece it runs.');
  const js = ts.transpileModule(`${code.join('\n')}\nfunction zoomBy(f) ${zoomBody}\nfunction frame() { ${frameCode.join('\n')}\ncamera.updateMatrixWorld(); }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const rig = (w, h, city) => {
    const aspect = w / h,
      vertical = Math.max(53, 76 / aspect),
      camera = new T.OrthographicCamera((-vertical * aspect) / 2, (vertical * aspect) / 2, vertical / 2, -vertical / 2, -200, 180),
      controls = new OrbitControls(camera, null);
    controls.domElement = { clientWidth: w, clientHeight: h, getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h }) };
    // As the scene sets them up; City mode's plain wheel zooms at the pointer, 1.5 times as fast (wheelIntent).
    Object.assign(controls, { enableRotate: false, enableDamping: true, dampingFactor: 0.09, screenSpacePanning: true, minZoom: widestOf(w, h), maxZoom: 4, zoomToCursor: city, zoomSpeed: city ? 1.5 : 1 });
    const s = {
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
        frameShift: 0,
        frameDrop: 0,
        panelEdge: 1,
        width: w,
        height: h,
        yaw: 0,
        targetYaw: 0,
        driftAngle: 0,
        targetZoom: 1,
        shownZoom: 1,
        pitch: 0,
        tween: false,
        reduced: false,
        dt: 1 / 60,
        blend: 1 - Math.exp(-5.5 / 60),
        focusedIds: [],
        overviewFit: false,
        inspect: null,
        parkSelected: false,
        autoFocus: true,
        inspectionAutoFit: true,
        lastInteraction: 0,
        performance: { now: () => 0 },
        clearHover() {},
        placeSun() {},
      },
      run = runInNewContext(`${js};({ offsetTarget, focusSky, cancel, align, zoomBy, frame })`, s);
    controls.addEventListener('start', run.cancel);
    return {
      s,
      run,
      camera,
      controls,
      // One wheel event, as OrbitControls' own listener handles it.
      wheel(deltaY, x, y) {
        controls.dispatchEvent({ type: 'start' });
        controls._handleMouseWheel({ clientX: x, clientY: y, deltaY });
        controls.dispatchEvent({ type: 'end' });
      },
      perUnit: () => (h * camera.zoom) / (camera.top - camera.bottom),
    };
  };
  let notches = 0,
    worst = 0;
  for (const [w, h, shift, drop] of [[1440, 900, 492 / 2880, 0], [768, 1024, 0, -0.2629]])
    for (const place of ['town-hall', 'sky-island'])
      for (const city of [true, false])
        for (const [press, burst] of [[1.25, 1], [1 / 1.25, 1], [0, 2]]) {
          const r = rig(w, h, city),
            { s, run, camera, controls } = r,
            bearing = plan.chapterBearings[place],
            at = `in the ${place === 'sky-island' ? "sky island's" : "Town Hall's"} file at ${w} x ${h}${city ? '' : ' on the reading page'}`;
          // The file as its glide leaves it, at rest.
          Object.assign(s, { yaw: bearing, targetYaw: bearing, frameShift: shift, frameDrop: drop, focusedIds: [place], pitch: place === 'sky-island' ? 1 : 0, targetZoom: 2 });
          if (place === 'sky-island') run.focusSky();
          else {
            s.target.set(plan.sites[place].x, 3, plan.sites[place].z);
            run.offsetTarget();
          }
          controls.target.copy(s.target);
          camera.zoom = s.shownZoom = s.targetZoom;
          camera.updateProjectionMatrix();
          run.align();
          controls.update();
          camera.updateMatrixWorld();
          for (let f = 0; f < 5; f++) run.frame();
          // + or - pressed, its glide run to its end.
          if (press) {
            const goal = camera.zoom * press;
            run.zoomBy(press);
            for (let f = 0; f < 600 && s.tween; f++) run.frame();
            assert(!s.tween && Math.abs(camera.zoom - goal) < 0.001, `The ${press > 1 ? '+' : '-'} button's glide ${at} ends at ${camera.zoom.toFixed(4)}, not ${goal.toFixed(4)}.`);
          }
          // Then notches in and out (or a pair in one frame), off the view's centre.
          for (const deltaY of burst > 1 ? [100] : [100, -100, -100, 100]) {
            for (let k = 0; k < burst; k++) r.wheel(deltaY, 0.33 * w, 0.5 * h);
            const kept = camera.zoom;
            run.frame();
            const view = controls.target.clone();
            let spring = 0,
              slide = 0,
              glides = 0;
            for (let f = 0; f < 120; f++) {
              run.frame();
              glides += s.tween ? 1 : 0;
              spring = Math.max(spring, Math.abs(camera.zoom - kept));
              slide = Math.max(slide, controls.target.distanceTo(view) * r.perUnit());
            }
            notches += burst;
            worst = Math.max(worst, slide);
            assert(spring < 1e-9 && slide < 0.01 && !glides, `${burst > 1 ? 'Two wheel notches in one frame' : `A wheel notch after ${press > 1 ? '+' : '-'}`} ${at} spring${spring ? 's' : ''} back from ${kept.toFixed(4)} to ${camera.zoom.toFixed(4)} over ${glides} glide frames, the view sliding ${slide.toFixed(1)} px.`);
          }
          // And a pinch (on a tablet, which has the buttons too): one 'start' for the whole gesture,
          // then a dolly about the fingers' middle at each move, as OrbitControls' touch dolly does it.
          // Every frame keeps the zoom the fingers left, and once they lift nothing moves.
          if (press !== 1.25) continue;
          controls.dispatchEvent({ type: 'start' });
          let lagged = 0,
            moves = 0;
          for (let move = 0; move < 12; move++) {
            controls._dollyOut(move < 6 ? 1.03 : 1 / 1.05);
            controls._updateZoomParameters(0.6 * w, 0.4 * h);
            controls.update();
            const fingers = camera.zoom;
            run.frame();
            moves++;
            lagged = Math.max(lagged, Math.abs(camera.zoom - fingers));
          }
          controls.dispatchEvent({ type: 'end' });
          const lifted = camera.zoom,
            view = controls.target.clone();
          let drift = 0,
            glides = 0;
          for (let f = 0; f < 120; f++) {
            run.frame();
            glides += s.tween ? 1 : 0;
            drift = Math.max(drift, Math.abs(camera.zoom - lifted), controls.target.distanceTo(view) * r.perUnit());
          }
          notches += moves;
          assert(lagged < 1e-9 && drift < 0.01 && !glides, `A pinch after + ${at} lags the fingers by ${lagged.toFixed(4)} or moves on by ${drift.toFixed(2)} after they lift, over ${glides} glide frames.`);
        }
  laneD3.wheel = `${notches} wheel notches and pinch moves kept after +, - and in same-frame pairs (the view ${worst.toFixed(2)} px from where the wheel left it at most)`;
}
{
  const pieces = [];
  const collect = (node) => {
    if (ts.isFunctionDeclaration(node) && ['panRegion', 'holdPan', 'excessAt', 'viewOffset', 'panelOffset', 'offsetTarget', 'fitOverview', 'fitGroup', 'groupFrame', 'fitFocused', 'driftHold', 'skyMarks', 'skyFit', 'focusSky', 'skyFitZoom', 'skyReach', 'elevationAt', 'aim'].includes(node.name?.text))
      pieces.push(node.getText(syntax).replace(/^export\s+/, ''));
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => ['PAN', 'panSubject', 'islandMarks', '[rockX, rockZ]', 'AIRPORT_FIT', 'PANEL_CLEAR', 'SKY_MARKS', 'SKY_LIFT', 'TOWN_PITCH', 'TROPIC_MIDDLE'].includes(d.name.getText(syntax))))
      pieces.push(node.getText(syntax).replace(/^export\s+/, ''));
    ts.forEachChild(node, collect);
  };
  collect(syntax);
  assert.equal(pieces.length, 28, 'The pan and fit check must find every piece it runs.');
  // Down from 0.45 on wide frames for City mode's overview, which takes in the tropic island as well
  // (resize(): WIDEST, by the frame's shape).
  assert(/controls\.minZoom = width >= height \? WIDEST\.wide : WIDEST\.tall;/.test(source), 'The town\'s widest zoom no longer follows the frame\'s shape.');
  const view = {
    T,
    Math,
    plan,
    TROPIC_EXTENT,
    camera: new T.OrthographicCamera(),
    controls: { minZoom: WIDEST_ZOOM.wide },
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
  const panScript = `${ts.transpileModule(pieces.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};({ panRegion, holdPan, fitOverview, fitGroup, fitFocused, focusSky, skyFitZoom, viewOffset, skyReach, aim, islandMarks, AIRPORT_FIT, SKY_MARKS, SKY_FIT, PAN, SKY_PITCH, TOWN_PITCH, TROPIC_MIDDLE, panLast });`,
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
    // causeway's line (x 0.5, from z -20 to the deck's south edge), the deck's signed distance, the
    // sky island's pocket (a disc of 16 round its middle) with the capsule of 8 that links it back to
    // the town (from 30 out along the line between them), and the tropic island's likewise: a disc of
    // 16 round its middle (the middle of its extent's outline at the water) and a capsule of 8 from 30
    // out toward it.
    beyondDeck = (x, z) => plan.airportDistance(x, z),
    skyLink = [(plan.SKY.x * 30) / Math.hypot(plan.SKY.x, plan.SKY.z), (plan.SKY.z * 30) / Math.hypot(plan.SKY.x, plan.SKY.z)],
    beyondSky = (x, z) => Math.min(Math.hypot(x - plan.SKY.x, z - plan.SKY.z) - 16, plan.distanceToSegment([x, z], skyLink, [plan.SKY.x, plan.SKY.z]) - 8),
    tropicAt = [plan.TROPIC.x, plan.TROPIC.z],
    tropicLink = tropicAt.map((v) => (v * 30) / Math.hypot(...tropicAt)),
    beyondTropic = (x, z) => Math.min(Math.hypot(x - tropicAt[0], z - tropicAt[1]) - 16, plan.distanceToSegment([x, z], tropicLink, tropicAt) - 8),
    // How far a point lies outside the union (negative inside).
    beyond = (x, z) => {
      const along = Math.min(-20, Math.max(plan.AIRPORT.z + plan.AIRPORT.hd, z));
      return Math.min(Math.hypot(x, z) - DISC, Math.hypot(x - plan.AIRPORT_ROAD.x, z - along) - 8, beyondDeck(x, z) - 4, beyondSky(x, z), beyondTropic(x, z));
    },
    // Whether the sky island's regions (or the tropic island's) are the ones a point is deepest in or nearest to.
    nearSky = (x, z) => {
      const along = Math.min(-20, Math.max(plan.AIRPORT.z + plan.AIRPORT.hd, z));
      return beyondSky(x, z) < Math.min(Math.hypot(x, z) - DISC, Math.hypot(x - plan.AIRPORT_ROAD.x, z - along) - 8, beyondDeck(x, z) - 4, beyondTropic(x, z));
    },
    nearTropic = (x, z) => {
      const along = Math.min(-20, Math.max(plan.AIRPORT.z + plan.AIRPORT.hd, z));
      return beyondTropic(x, z) < Math.min(Math.hypot(x, z) - DISC, Math.hypot(x - plan.AIRPORT_ROAD.x, z - along) - 8, beyondDeck(x, z) - 4, beyondSky(x, z));
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
  // The tropic island's pocket (a disc of 16 round its middle, plan.TROPIC: its natural coast reaches
  // 14.1 from it at the most, on its tail, and the disc keeps about 2 past that): the scene's middle is
  // the check's; a ring 12 out round it, and its whole waterline, lie in it, unclamped (and its file's
  // ground point at every bearing: below); a pan away from it is held to it, or back along its strip
  // to the town, never out to open sea; and the strip overlaps both the town's disc and the pocket, so
  // a visitor can pan back.
  {
    const [cx, cz] = tropicAt;
    assert(scene.TROPIC_MIDDLE.distanceTo(new T.Vector3(cx, 0, cz)) < 1e-9 && Math.abs(cx - 19.5) < 0.01 && Math.abs(cz - 51) < 0.01, `The tropic island's pocket stands round ${scene.TROPIC_MIDDLE.x.toFixed(2)}, ${scene.TROPIC_MIDDLE.z.toFixed(2)}, not its middle (19.5, 51).`);
    assert(scene.PAN.tropic.reach === 16 && scene.PAN.tropic.link === 8 && scene.PAN.tropic.from.distanceTo(new T.Vector3(tropicLink[0], 0, tropicLink[1])) < 1e-9, 'The tropic island\'s pocket is no longer a disc of 16 with a strip of 8 from 30 out toward it.');
    for (let b = 0; b < 2 * Math.PI; b += Math.PI / 12) {
      const x = cx - Math.sin(b) * 12,
        z = cz - Math.cos(b) * 12;
      assert(nearTropic(x, z) && clamp(x, z).every((c, i) => Math.abs(c - [x, z][i]) < 1e-9), `The tropic island's pocket does not hold the ground 12 out from its middle at bearing ${b.toFixed(2)}.`);
    }
    for (const p of plan.tropicOutline(0, 180)) assert(nearTropic(p.x, p.z) && Math.hypot(p.x - cx, p.z - cz) < 16 - 1.5, `The tropic island's waterline at ${p.x.toFixed(2)}, ${p.z.toFixed(2)} runs within 1.5 of its pocket's edge.`);
    for (const [x, z] of [[70, 51], [19.5, 110], [-25, 75], [60, 95], [45, 30], [-5, 55]]) {
      const [qx, qz] = clamp(x, z);
      assert(inside(qx, qz) && Math.hypot(qx - x, qz - z) > 1, `A pan to ${x}, ${z} is not held to the tropic island's pocket.`);
    }
    assert(Math.hypot(...tropicLink) + 8 > DISC && beyondTropic(...tropicLink) < 0 && beyond((tropicLink[0] + cx) / 2, (tropicLink[1] + cz) / 2) < 0, 'The tropic island\'s pocket is cut off from the town.');
    // Neither neighbour's pocket reaches the other's, nor the airport's deck.
    assert(Math.hypot(cx - plan.SKY.x, cz - plan.SKY.z) > 16 + 16 + 8 && beyondDeck(cx, cz) > 16 + 4, 'The tropic island\'s pocket runs into another\'s.');
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
      held = { T, Math, plan, TROPIC_EXTENT, camera, controls, shiftApplied: new T.Vector3(), tween: false, panSlack: Infinity, pitch: 0, panPitch: 0 },
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
        pan.panLast.copy(controls.target);
        camera.updateMatrixWorld();
        const d = controls.target.clone().sub(was),
          g = ground();
        worst.move = Math.max(worst.move, Math.hypot(d.dot(right), d.dot(up)) * perUnit);
        worst.beyond = Math.max(worst.beyond, beyond(g.x, g.z));
        // Past the deck, where the deck's region is the nearest (neither the disc nor the capsule holds it).
        const along = Math.min(-20, Math.max(plan.AIRPORT.z + plan.AIRPORT.hd, g.z)),
          deckOut = beyondDeck(g.x, g.z) - 4;
        if (deckOut < Math.hypot(g.x, g.z) - DISC && deckOut < Math.hypot(g.x - plan.AIRPORT_ROAD.x, g.z - along) - 8 && deckOut < beyondSky(g.x, g.z) && deckOut < beyondTropic(g.x, g.z)) worst.deck = Math.max(worst.deck, deckOut + 4);
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
  // The tropic island likewise: from its middle (its file's ground point lies within 3 of it at every
  // bearing: its framing, below), at each Rotate stop and its file's bearing, a drag out to sea every
  // way is held in its pocket, a drag back to the plaza gets there along the strip, never jumping or
  // lifting the camera; and a straight drag from the plaza toward it gets onto it.
  const tropicPan = { drags: 0, nearest: Infinity };
  for (const yaw of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4, plan.chapterBearings['tropic-island']])
    for (const [x, z] of [[19.5, 120], [90, 51], [-45, 62], [75, 100], [55, 10], [0, 0]]) {
      const drive = drivePan(yaw),
        ground = new T.Vector3(tropicAt[0], 0, tropicAt[1]);
      drive.held.controls.target.copy(ground);
      drive.held.camera.position.copy(ground).add(new T.Vector3(Math.sin(yaw) * 38, 35, Math.cos(yaw) * 38));
      drive.held.controls.update();
      drive.held.camera.updateMatrixWorld();
      for (let f = 0; f < 500; f++) drive.frame(...drive.toward(x, z));
      for (let f = 0; f < 120; f++) drive.frame();
      const end = drive.ground();
      tropicPan.drags++;
      assert(drive.worst.beyond <= 0.5 && drive.worst.move <= 16 && drive.worst.lift <= scene.PAN.lift + 1, `A drag from the tropic island toward ${x}, ${z} at bearing ${yaw.toFixed(2)} ends ${drive.worst.beyond.toFixed(2)} out of the pan regions, or jumps ${drive.worst.move.toFixed(0)} px.`);
      if (!x && !z) assert(Math.hypot(end.x, end.z) < 2, `A drag from the tropic island back to the plaza at bearing ${yaw.toFixed(2)} stops at ${end.x.toFixed(1)}, ${end.z.toFixed(1)}.`);
      else assert(Math.hypot(end.x - tropicAt[0], end.z - tropicAt[1]) > 15.4 && region(end.x, end.z).radius === scene.PAN.tropic.reach, `A drag from the tropic island toward ${x}, ${z} at bearing ${yaw.toFixed(2)} stops at ${end.x.toFixed(1)}, ${end.z.toFixed(1)}, short of its pocket's edge or outside it.`);
    }
  for (const yaw of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4, plan.chapterBearings['tropic-island']]) {
    const drive = drivePan(yaw);
    let nearest = Infinity;
    for (let f = 0; f < 600; f++) {
      const g = drive.frame(...drive.toward(tropicAt[0], tropicAt[1]));
      nearest = Math.min(nearest, Math.hypot(g.x - tropicAt[0], g.z - tropicAt[1]));
    }
    tropicPan.nearest = Math.min(tropicPan.nearest, nearest);
    assert(nearest < 1 && drive.worst.beyond <= 0.5 && drive.worst.move <= 16, `A drag from the plaza toward the tropic island at bearing ${yaw.toFixed(2)} comes no nearer than ${nearest.toFixed(1)} to its middle, or leaves the pan regions, or jumps.`);
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
    // The tropic island's pocket and the sides of its link back to the town.
    for (let a = 0; a < 2 * Math.PI; a += Math.PI / 30) edge.push(new T.Vector3(tropicAt[0] + Math.cos(a) * 16.5, 0, tropicAt[1] + Math.sin(a) * 16.5));
    {
      const [lx, lz] = tropicLink,
        [cx, cz] = tropicAt,
        l = Math.hypot(cx - lx, cz - lz),
        [nx, nz] = [-(cz - lz) / l, (cx - lx) / l];
      for (let k = 0; k <= 10; k++) for (const s of [-8.5, 8.5]) edge.push(new T.Vector3(lx + ((cx - lx) * k) / 10 + nx * s, 0, lz + ((cz - lz) * k) / 10 + nz * s));
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
        halfW = (vertical * aspect) / 2 / widestOf(w, h),
        halfH = vertical / 2 / widestOf(w, h);
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
    // (resize(): the frame's widest zoom, which the overview keeps to.)
    view.controls.minZoom = widestOf(w, h);
  };
  assert(scene.islandMarks.some((p) => p.distanceTo(new T.Vector3(3.9, 7, -47.4)) < 1e-9) && scene.islandMarks.some((p) => plan.airportDistance(p.x, p.z) > plan.AIRPORT.armour - 1e-6), 'The overview leaves the airport out.');
  frame(1440, 900, 0, Math.PI / 4);
  scene.fitOverview();
  assert(view.targetZoom > 0.74 && view.targetZoom < 0.8, `The overview of the island and the airport fits at ${view.targetZoom.toFixed(3)}.`);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    frame(w, h, (460 + 32) / (2 * w), Math.PI / 4);
    scene.fitOverview();
    assert(view.targetZoom > widestOf(w, h), `Beside the file at ${w} x ${h} the overview is clamped (${view.targetZoom.toFixed(3)}).`);
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
  // The tropic island's file (City mode: the file's panel down the right on desktops, a sheet under it
  // on phones upright and the 768 x 1024 tablet, a panel and the bars on phones on their side), from
  // its own bearing and every Rotate stop (each refits it, as the airport's file does): the whole
  // island (TROPIC_EXTENT) fitted like a group between 0.95 and 2.6, inside the part of the frame the
  // file and the page's bands leave free at rest and through the idle drift, and its ground point in its
  // own pocket, within 4 of its middle (its natural coast is fuller on the east-south-east, and the
  // box's top, its roof 8.1 up, shifts the framed ground point toward the camera from some stops) and
  // unclamped, so a glide's end is never pulled back.
  {
    const project = (w, h, zoom, bearing, centre, p) => {
        const per = (h * zoom) / Math.max(53, (76 * h) / w),
          back = new T.Vector3(Math.sin(bearing) * 38, 35, Math.cos(bearing) * 38).normalize(),
          right = new T.Vector3(Math.cos(bearing), 0, -Math.sin(bearing)),
          up = new T.Vector3().crossVectors(back, right),
          d = p.clone().sub(centre);
        return [w / 2 + d.dot(right) * per, h / 2 - d.dot(up) * per];
      },
      boxOf = (points) => points.reduce(([x0, y0, x1, y1], [x, y]) => [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)], [Infinity, Infinity, -Infinity, -Infinity]),
      // [w, h, fileFrame's shift and drop, the part of the frame left free: x0, y0, x1, y1]
      files = [
        ...[[1024, 768], [1180, 820], [1280, 720], [1280, 800], [1366, 768], [1440, 900], [1536, 864], [1680, 1050], [1920, 1080], [2560, 1440]].map(([w, h]) => [w, h, 492 / (2 * w), 0, [0, 76, w - 476, h - 76]]),
        ...[[360, 640], [375, 667], [390, 844], [412, 915], [430, 932]].map(([w, h]) => [w, h, 0, -100.95 / h, [0, 58, w, h - 259.9]]),
        ...[[667, 375], [844, 390], [932, 430]].map(([w, h]) => [w, h, (Math.min(340, 0.42 * w) + 28) / (2 * w), -33 / h, [0, 58, w - 12 - Math.min(340, 0.42 * w), h - 124]]),
        [768, 1024, 0, -0.2629, [0, 58, 768, 427.52]],
      ],
      fileBearing = plan.chapterBearings['tropic-island'],
      least = { rest: Infinity, drift: Infinity },
      zooms = [];
    for (const [w, h, shift, drop, free] of files)
      for (const bearing of [fileBearing, Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
        frame(w, h, shift, bearing);
        Object.assign(view, { frameDrop: drop, panelEdge: 1, focusedIds: ['tropic-island'], overviewFit: false });
        scene.fitFocused();
        const zoom = view.targetZoom,
          centre = view.target.clone(),
          subject = centre.clone().sub(view.shiftApplied),
          at = `The tropic island's file at ${String(w)} x ${String(h)} at bearing ${bearing.toFixed(2)}`;
        assert(zoom >= 0.95 - 1e-9 && zoom <= 2.6 + 1e-9, `${at} fits at ${zoom.toFixed(3)}.`);
        assert(region(subject.x, subject.z).radius === scene.PAN.tropic.reach && clamp(subject.x, subject.z).every((c, i) => Math.abs(c - [subject.x, subject.z][i]) < 1e-9) && Math.hypot(subject.x - tropicAt[0], subject.z - tropicAt[1]) < 4, `${at} frames ${subject.x.toFixed(1)}, ${subject.z.toFixed(1)}, outside its pocket or off its middle.`);
        for (const d of [-0.16, -0.08, 0, 0.08, 0.16]) {
          const [x0, y0, x1, y1] = boxOf(TROPIC_EXTENT.map((p) => project(w, h, zoom, bearing + d, centre, p))),
            margin = Math.min(x0 - free[0], y0 - free[1], free[2] - x1, free[3] - y1);
          if (d) least.drift = Math.min(least.drift, margin);
          else least.rest = Math.min(least.rest, margin);
          assert(margin >= (d ? -0.5 : 8), `${at}${d ? `, drifted ${d}` : ''}, spans ${[x0, y0, x1, y1].map((n) => n.toFixed(0)).join(', ')} px, outside the part the file and the bands leave free (${free.map((n) => n.toFixed(0)).join(', ')}).`);
        }
        if (bearing === fileBearing && [1440, 1280, 390, 844, 768].includes(w)) zooms.push(`${String(w)} x ${String(h)} ${zoom.toFixed(2)}`);
      }
    Object.assign(view, { frameDrop: 0, focusedIds: [] });
    tropicNav.file = `its file fitted at ${zooms.join(', ')} (from its bearing and every Rotate stop, on ${files.length} screens), the island ${least.rest.toFixed(0)} px inside the part the file and the bands leave free at rest and ${Math.max(0, least.drift).toFixed(0)} px through the drift at the least, its ground point in its pocket`;
    tropicNav.pan = `a pocket of 16 round its middle and a strip of 8 back to the plaza: ${tropicPan.drags} drags out from it held in its pocket or back on the plaza, and a straight drag from the plaza reaching within ${tropicPan.nearest.toFixed(2)} of its middle at every Rotate stop`;
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
      // How far into the frame (px, the nearer of its edges; negative: out of it) the plane's middle lies.
    const depthIn = (w, h, zoom, bearing, centre, p) => {
        const aspect = w / h,
          vertical = Math.max(53, 76 / aspect),
          back = scene.viewOffset(bearing, new T.Vector3(), 0),
          forward = back.clone().normalize().negate(),
          right = new T.Vector3(Math.cos(bearing), 0, -Math.sin(bearing)),
          up = new T.Vector3().crossVectors(right, forward),
          rel = new T.Vector3(p.x, p.y, p.z).sub(centre).sub(back),
          perUnit = (h * zoom) / vertical;
        return Math.min((vertical * aspect) / 2 / zoom - Math.abs(rel.dot(right)), vertical / 2 / zoom - Math.abs(rel.dot(up))) * perUnit;
      },
      // The one exception (as the sky island's on phones at 5pi/4): a phone held upright, zoomed right out
      // over the tropic island at the 3pi/4 stop, has the plane's return from the east in its frame's
      // bottom left corner (the island lies so far south that the frame's foot, which looks back toward
      // the camera, reaches the approach; the timetable has no slack to send it further). How far in.
      phoneCorner = { worst: -Infinity, frames: 0 };
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
          if (w >= 768) hold('the widest zoom on the sky island', w, h, widestOf(w, h), bearing, view.target.clone(), 0);
          Object.assign(view, { focusedIds: [], pitch: 0 });
        }
      view.frameDrop = 0;
      for (const [shift, drop] of narrow ? [[0, 0], [0, -0.26]] : [[0.21, 0], [(460 + 32) / (2 * w), 0]]) {
        frame(w, h, shift, plan.chapterBearings.airport);
        view.frameDrop = drop;
        scene.fitGroup(scene.AIRPORT_FIT, 0.95, 2.6);
        hold('the airport’s framing', w, h, view.targetZoom, plan.chapterBearings.airport, view.target.clone());
      }
      // The tropic island's own file, beside its panel or above its sheet, from its own bearing and
      // every Rotate stop (the turn keeps its subject), and zoomed out from there to the widest.
      view.frameDrop = 0;
      for (const bearing of [plan.chapterBearings['tropic-island'], ...stops])
        for (const [shift, drop] of narrow ? [[0, 0], [0, -0.26]] : [[(460 + 32) / (2 * w), 0]]) {
          frame(w, h, shift, bearing);
          Object.assign(view, { frameDrop: drop, focusedIds: ['tropic-island'] });
          scene.fitFocused();
          hold('the tropic island’s file', w, h, view.targetZoom, bearing, view.target.clone());
          if (w >= 768) hold('the widest zoom on the tropic island', w, h, widestOf(w, h), bearing, view.target.clone());
          else
            for (const centre of [view.target.clone(), new T.Vector3(tropicAt[0], 0, tropicAt[1])])
              for (const [when, p] of edges)
                for (const drift of [-0.16, -0.08, 0, 0.08, 0.16]) {
                  const depth = depthIn(w, h, widestOf(w, h), bearing + drift, centre, p);
                  phoneCorner.frames++;
                  if (depth > -plan.PLANE.length / 2 && seen(w, h, widestOf(w, h), bearing + drift, centre, p)) {
                    phoneCorner.worst = Math.max(phoneCorner.worst, depth);
                    assert(when === 'comes back' && Math.abs(bearing - (3 * Math.PI) / 4) < 1e-9 && depth < 100, `The plane ${when} ${depth.toFixed(1)} px into a ${w} x ${h} phone's frame zoomed right out over the tropic island at bearing ${bearing.toFixed(2)} drifted ${drift}.`);
                  }
                }
          Object.assign(view, { focusedIds: [] });
        }
      view.frameDrop = 0;
      if (!narrow) {
        // The opening view: the island's centre at zoom 1, the hero's frame shift.
        const shift = new T.Vector3(Math.cos(Math.PI / 4), 0, -Math.sin(Math.PI / 4)).multiplyScalar(-0.06 * ((Math.max(53, (76 * h) / w) * w) / h));
        hold('the opening view', w, h, 1, Math.PI / 4, shift);
      }
      for (const centre of [new T.Vector3(), new T.Vector3(-3.5, 0, -13.5), new T.Vector3(4, 0, 2.5), new T.Vector3(plan.AIRPORT.x, 0, plan.AIRPORT.z), ...(w >= 768 ? [new T.Vector3(tropicAt[0], 0, tropicAt[1])] : [])])
        for (const bearing of [...stops, plan.chapterBearings.airport]) hold('the widest zoom', w, h, widestOf(w, h), bearing, centre);
    }
    assert(frames > 6000, `The plane check looks at only ${frames} frames.`);
    tropicNav.plane = `the plane out of its file's frames and, but on phones held upright, of the widest zoom over it (on those, at the 3pi/4 stop only, its return from the east ${phoneCorner.worst.toFixed(1)} px into the frame's bottom left corner at most, over ${phoneCorner.frames} frames)`;
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
      // slots as points on the volumes that stand in for them (plan.SKY_FLOAT_PROXY, in units of the
      // slot's size, which check-town holds lane G's pieces inside through their whole drift and bob):
      // a cloud inside an upright wall on an ellipse, from under its base to over it, under a dome; a
      // rock inside an ellipsoid.
      outline = [...scene.SKY_MARKS, ...plan.skyOutline(0, 64).map((p) => new T.Vector3(p.x, S.top - S.ring, p.z))],
      { cloud: FC, rock: FR } = plan.SKY_FLOAT_PROXY,
      floatAt = (f, x, y, z) => new T.Vector3(f.x + (x * Math.cos(f.ry) + z * Math.sin(f.ry)) * f.size, f.y + y * f.size, f.z + (-x * Math.sin(f.ry) + z * Math.cos(f.ry)) * f.size),
      floats = [
        ...plan.SKY_CLOUDS.flatMap((f) =>
          Array.from({ length: 24 }, (_, k) => [Math.cos((k / 24) * Math.PI * 2), Math.sin((k / 24) * Math.PI * 2)]).flatMap(([c, s]) => [
            ...[FC.base, FC.wall].map((y) => floatAt(f, c * FC.a, y, s * FC.c)),
            ...[1, 2, 3, 4, 5, 6].map((b) => floatAt(f, c * FC.a * Math.cos((b / 6) * (Math.PI / 2)), FC.wall + Math.sin((b / 6) * (Math.PI / 2)) * FC.cap, s * FC.c * Math.cos((b / 6) * (Math.PI / 2)))),
          ]),
        ),
        ...plan.SKY_ROCKS.flatMap((f) =>
          Array.from({ length: 24 }, (_, k) => [Math.cos((k / 24) * Math.PI * 2), Math.sin((k / 24) * Math.PI * 2)]).flatMap(([c, s]) =>
            Array.from({ length: 9 }, (_, b) => (b / 8) * Math.PI - Math.PI / 2).map((w) => floatAt(f, c * FR.r * Math.cos(w), Math.sin(w) * (w > 0 ? FR.up : FR.down), s * FR.r * Math.cos(w))),
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

    // (b) City mode's overview takes in both neighbour islands (the reading page's last shot neither: see
    // above): the sky island north-west of the town and the tropic island south of it. At the opening
    // bearing the frame is bound by its height, the sky island at the top of the part the page's bands
    // leave free and the tropic island at its foot, so it fits at the same zoom beside the file or not:
    // 0.465 at 1440 x 900 (main's fit with the sky island alone: 0.591, 0.580 beside the file), 0.442 at
    // 1280 x 720, 0.453 at 1280 x 800, 0.449 at 1366 x 768, 0.461 at 1536 x 864, 0.479 at 1680 x 1050,
    // 0.481 at 1920 x 1080, 0.60 of the last shot's at every desktop size with the file hidden (a hair
    // under, 0.5999, with the island's own coast and its building's top at 8.1: 0.59 at the least). At the
    // other stops the islands lie at either side, and the fit keeps more than two thirds of the last
    // shot's or sits at the widest zoom (beside the file at 1024 to 1440 wide at the second and fourth
    // stops, which would want 0.22 to 0.40). At rest the town (the island, the lighthouse's rock and the
    // airport's island) and the sky island always stand whole in the part of the frame the file and the
    // page's bands leave free, on every desktop at every stop, the file open or not; the tropic island
    // too, but where the overview sits at the widest zoom and still cannot hold it (beside the file at
    // 1024 and 1180 wide at the second and fourth stops: there it is the one cut, by the frame's edge or
    // the file, reported in the summary; the review found the airport's armour and the sky island cut
    // there when the whole box was centred). Beside the file what stands whole keeps PANEL_CLEAR from it
    // at rest, and 18.5 px or more through the drift (20 round the stand-in island; the island's own, its
    // coast fuller and its building 8.1 up, brings the sky island 19 px from the file at 1280 x 800 at
    // the second stop at the drift's far end) (at 1024 x 768 at those two stops, where the town and
    // the sky island fill the room beside it at rest, 8 px or more). Through the idle drift nine tenths of
    // each island stay in the frame up to 1920 wide, four fifths on the widest screens (at the drift's
    // extreme the sky island's chimneys slide up past the top edge, under the masthead's band, at 3440 x
    // 1440 at the second stop with the file hidden). The sky island's clouds and rocks never widen the
    // overview (they hang on the town's side, inside the town's own box). The box now runs from the
    // airport's north shore to the tropic island's south beach, so the island on its far side reaches
    // into the fog's first quarter at its farthest point (the sky island 18% at the opening bearing, 5%
    // with it alone; the tropic island 26% at the third stop): 27% at most at rest, 30% through the drift.
    const overviewAt = (w, h, shift, bearing, city) => {
      frame(w, h, shift, bearing);
      view.frameDrop = 0;
      view.cityMode = city;
      scene.fitOverview();
      view.cityMode = false;
      return { zoom: view.targetZoom, centre: view.target.clone() };
    };
    const ratio = (w, h, shift, bearing) => overviewAt(w, h, shift, bearing, true).zoom / overviewAt(w, h, shift, bearing, false).zoom,
      tropicShape = TROPIC_EXTENT.map((p) => p.clone()),
      islandsOf = { 'sky island': shape, 'tropic island': tropicShape };
    // (What City mode's overview fits at without the tropic island, for the summary: the scene's pieces
    // read TROPIC_EXTENT where they run, so the check takes it away for a moment. Main's own fit with the
    // sky island alone differs beside the file, where its sideways move kept no room through the drift:
    // 0.580 at 1440 x 900, 0.518 at 1280 x 800.)
    const skyAlone = (fit) => {
      const kept = view.TROPIC_EXTENT;
      view.TROPIC_EXTENT = [];
      try {
        return fit();
      } finally {
        view.TROPIC_EXTENT = kept;
      }
    };
    for (const [w, h, want] of [[1440, 900, 0.465], [1280, 720, 0.442], [1280, 800, 0.453], [1366, 768, 0.449], [1536, 864, 0.461], [1680, 1050, 0.479], [1920, 1080, 0.481]])
      for (const shift of [0, 492 / (2 * w)]) {
        const { zoom } = overviewAt(w, h, shift, Math.PI / 4, true),
          before = skyAlone(() => overviewAt(w, h, shift, Math.PI / 4, true).zoom);
        assert(Math.abs(zoom - want) < 0.005, `City mode's default view at ${w} x ${h}${shift ? ' beside the file' : ''} fits at ${zoom.toFixed(3)} (${want} expected).`);
        tropicNav.fits.push(`${w} x ${h}${shift ? ' with the file open' : ''} ${before.toFixed(3)} to ${zoom.toFixed(3)}`);
      }
    // Phones, upright above the file's sheet (its drop) and on their side beside the file's panel and over
    // the bars: the overview goes out for the tropic island where the box's height binds it; it reaches
    // the widest zoom only where it sat there with the sky island alone (the smallest phone on its side).
    for (const [w, h, shift, drop] of [...[[360, 640], [375, 667], [390, 844], [412, 915], [430, 932]].map(([w, h]) => [w, h, 0, -100.95 / h]), ...[[667, 375], [844, 390], [932, 430]].map(([w, h]) => [w, h, (Math.min(340, 0.42 * w) + 28) / (2 * w), -33 / h])]) {
      const fit = () => {
          frame(w, h, shift, Math.PI / 4);
          Object.assign(view, { frameDrop: drop, cityMode: true });
          scene.fitOverview();
          Object.assign(view, { frameDrop: 0, cityMode: false });
          return view.targetZoom;
        },
        zoom = fit(),
        before = skyAlone(fit);
      assert(zoom <= before + 1e-9 && (zoom > widestOf(w, h) + 1e-9 || before <= widestOf(w, h) + 1e-9), `City mode's overview on a ${w} x ${h} phone fits at ${zoom.toFixed(3)} (${before.toFixed(3)} with the sky island alone).`);
      tropicNav.fits.push(`${w} x ${h} phone ${before.toFixed(3)} to ${zoom.toFixed(3)}${zoom <= widestOf(w, h) + 1e-9 ? ' (the widest zoom, as before)' : ''}`);
    }
    const fog = { 'sky island': { rest: 0, drift: 0 }, 'tropic island': { rest: 0, drift: 0 } },
      cut = { 'sky island': 1, 'tropic island': 1 },
      narrowCut = [],
      fileGap = { rest: Infinity, least: Infinity, at: '', tight: Infinity, tightAt: '', over: Infinity, overAt: '' };
    // (On the widest screens, 2560 and 3440 wide, with the file hidden at the second and fourth stops, the
    // drift's extreme takes a little more of the sky island past the frame's edge, under the masthead's band
    // or past the left edge: their own floor.)
    let ultrawide = 1;
    for (const [w, h] of desktops)
      for (const open of [false, true])
        for (const bearing of stops) {
          const shift = open ? 492 / (2 * w) : 0,
            r = ratio(w, h, shift, bearing);
          const { zoom, centre } = overviewAt(w, h, shift, bearing, true),
            right = w - (open ? 476 : 0),
            clamped = Math.abs(zoom - widestOf(w, h)) < 1e-9;
          assert(r <= 1 + 1e-9 && (clamped || r > (bearing === Math.PI / 4 ? 0.59 : 0.68) - 1e-9), `City mode's overview at ${w} x ${h}${open ? ' beside the file' : ''} at bearing ${bearing.toFixed(2)} keeps ${r.toFixed(3)} of the last shot's zoom.`);
          // The floats inside the overview's box: adding them changes nothing.
          scene.SKY_MARKS.push(...floats);
          const withFloats = overviewAt(w, h, shift, bearing, true);
          scene.SKY_MARKS.splice(scene.SKY_MARKS.length - floats.length);
          assert(Math.abs(withFloats.zoom - zoom) < 1e-9 && withFloats.centre.distanceTo(centre) < 1e-9, `The sky island's clouds and rocks widen City mode's overview at ${w} x ${h} at bearing ${bearing.toFixed(2)}.`);
          let tropicWhole = true;
          // Whether the town and the sky island, swung by the drift either way, fit the room beside the file
          // (PANEL_CLEAR from its edge and from the frame's): not at 1024 x 768 at the second and fourth
          // stops, where at the widest zoom they fill it at rest.
          const kept = [...scene.islandMarks, ...shape],
            swept = [0, -0.16, -0.08, 0.08, 0.16].map((d) => box(kept.map((p) => px(w, h, zoom, bearing + d, centre, p)))),
            roomy = Math.max(...swept.map((b) => b[2])) - Math.min(...swept.map((b) => b[0])) <= right - 2 * 24 + 1;
          for (const [name, points] of [...Object.entries(islandsOf), ['town', scene.islandMarks]])
            for (const d of [0, -0.16, -0.08, 0.08, 0.16]) {
              const [x0, y0, x1, y1] = box(points.map((p) => px(w, h, zoom, bearing + d, centre, p))),
                whole = x0 >= 0 && x1 <= right && y0 >= 76 - 0.5 && y1 <= h - 76 + 0.5;
              // At rest the town (the island, the lighthouse and the airport's island) and the sky island
              // always stand whole in the part of the frame the file and the page's bands leave free, and
              // the tropic island too but where the overview sits at the widest zoom, which leaves it cut.
              if (!d) {
                if (name === 'tropic island' && !whole && clamped && w < 1280) {
                  tropicWhole = false;
                  narrowCut.push(`${(((Math.min(x1, right) - Math.max(x0, 0)) / (x1 - x0)) * 100).toFixed(0)}% at ${w} x ${h} at stop ${stops.indexOf(bearing) + 1}`);
                } else assert(whole, `In City mode's overview at ${w} x ${h}${open ? ' beside the file' : ''} at bearing ${bearing.toFixed(2)}, fitted at ${zoom.toFixed(3)}, the ${name} spans ${[x0, y0, x1, y1].map((n) => n.toFixed(0)).join(', ')} px.`);
              } else if (w >= 1280 && name !== 'town') {
                const inFrame = Math.min((Math.min(x1, w) - Math.max(x0, 0)) / (x1 - x0), (Math.min(y1, h) - Math.max(y0, 0)) / (y1 - y0));
                if (w <= 1920) cut[name] = Math.min(cut[name], inFrame);
                else ultrawide = Math.min(ultrawide, inFrame);
              }
              // Beside the file the town and the sky island keep PANEL_CLEAR from it at rest (to half a pixel:
              // the scene measures the sky island's marks, the check its clouds and rocks as well) and nearly
              // as much through the drift, where they fit the room beside it; the tropic island too, where the
              // overview is not at the widest zoom (where it is, the tropic island is what gives).
              if (open) {
                const gap = right - x1,
                  at = `the ${name} at ${w} x ${h} at stop ${stops.indexOf(bearing) + 1}${d ? `, drifted ${d}` : ''}`;
                if (name === 'tropic island' ? !clamped : roomy) {
                  if (!d) fileGap.rest = Math.min(fileGap.rest, gap);
                  else if (gap < fileGap.least) Object.assign(fileGap, { least: gap, at });
                } else if (name !== 'tropic island' && gap < fileGap.tight) Object.assign(fileGap, { tight: gap, tightAt: at });
                else if (name === 'tropic island' && tropicWhole && gap < fileGap.over) Object.assign(fileGap, { over: gap, overAt: at });
              }
              if (name === 'town') continue;
              // The fog (72 to 150 along the line of sight) over its farthest point.
              const back = new T.Vector3(Math.sin(bearing + d) * 38, 35, Math.cos(bearing + d) * 38);
              for (const p of points) {
                const f = (back.length() - p.clone().sub(centre).dot(back.clone().normalize()) - 72) / (150 - 72);
                if (d) fog[name].drift = Math.max(fog[name].drift, f);
                else fog[name].rest = Math.max(fog[name].rest, f);
              }
            }
        }
    for (const [name, share] of Object.entries(cut)) assert(share >= 0.9, `Through the idle drift only ${(share * 100).toFixed(0)}% of the ${name} stays in City mode's overview.`);
    assert(ultrawide >= 0.8, `Through the idle drift only ${(ultrawide * 100).toFixed(0)}% of a neighbour island stays in City mode's overview on the widest screens.`);
    for (const [name, { rest, drift }] of Object.entries(fog)) assert(rest <= 0.27 && drift <= 0.3, `The fog reaches ${rest.toFixed(3)} at rest (and ${drift.toFixed(3)} through the drift) over the ${name} in City mode's overview.`);
    skyNav.overview = `the fog ${(fog['sky island'].rest * 100).toFixed(1)}% at rest, ${(cut['sky island'] * 100).toFixed(0)}% of it in frame through the drift (${(ultrawide * 100).toFixed(0)}% on the widest screens)`;
    assert(fileGap.rest >= 23.5 && fileGap.least >= 18.5 && fileGap.tight >= 8, `City mode's overview comes within ${fileGap.rest.toFixed(1)} px of the file at rest, ${fileGap.least.toFixed(1)} px through the drift (${fileGap.at}), or where the town and the sky island fill the room beside it within ${fileGap.tight.toFixed(1)} px (${fileGap.tightAt}).`);
    tropicNav.overview = `the fog ${(fog['tropic island'].rest * 100).toFixed(1)}% at rest over its farthest point, ${(cut['tropic island'] * 100).toFixed(0)}% of it in frame through the drift; the town, the airport's island and the sky island whole at rest on every desktop at every Rotate stop, the file open or not, and beside the file ${fileGap.rest.toFixed(0)} px clear of it at rest and ${fileGap.least.toFixed(0)} px through the drift at the least (${fileGap.at}; where the town and the sky island fill the room beside it, ${fileGap.tight.toFixed(0)} px, ${fileGap.tightAt}; the tropic island where the overview sits at the widest zoom, ${fileGap.over.toFixed(0)} px, ${fileGap.overAt})${narrowCut.length ? `; where the second and fourth stops sit at the widest zoom beside the file on narrow windows, the tropic island alone cut: ${narrowCut.join(', ')} of it in the frame` : ''}`;

    // (b2) Clear of the caption (the art review's fourth finding): at the opening bearing the island
    // lands at the box's top left, and it stood under or right beside the caption's sky chip (16 to
    // 182 px across with its longest caption, its foot 102 down): 3 px from its column at 1280 x 800,
    // overlapping it at 1280 x 720, 1366 x 768 and 1440 x 900. In City mode fitOverview moves the
    // view sideways (the town right), at the same zoom, until the island, its clouds and rocks clear
    // that column by 24 px (PANEL_CLEAR), the whole overview kept 24 px from the file and the frame's
    // left edge; where the file leaves no room for that (1024 to 1180 px wide with the file open, the
    // overview taking in the tropic island at its foot), it moves the view up instead, the town down,
    // the overview's foot kept over the bottom band, going out a little first where that band is short
    // (never past the widest zoom). On every desktop size, the file open or hidden, the island is then
    // clear by 24 px at rest and off the column all through the idle drift. Where there is no room for
    // that (a phone upright, the smallest on its side), the framing stays as it was.
    {
      const bearing = Math.PI / 4,
        right = new T.Vector3(Math.cos(bearing), 0, -Math.sin(bearing)),
        back = new T.Vector3(Math.sin(bearing) * 38, 35, Math.cos(bearing) * 38).normalize(),
        up = new T.Vector3().crossVectors(back, right),
        // How far a screen box lies from the chip's column (negative: on it).
        gap = ([x0, y0, x1, y1]) => Math.max(x0 - 182, y0 - 102, 16 - x1, 72 - y1),
        found = { moved: [], lifted: [], rest: Infinity, drift: Infinity, kept: 0 },
        // The overview of a w x h frame (beside a file `shift`, over a sheet `drop`): where it put the
        // view, and how far (px) that is left of the box's own middle with the panel offset.
        overviewOf = (w, h, shift, drop) => {
          frame(w, h, shift, bearing);
          Object.assign(view, { frameDrop: drop, cityMode: true });
          scene.fitOverview();
          // (City mode's whole box: the town and both neighbour islands.)
          const xs = [...scene.islandMarks, ...scene.SKY_MARKS, ...TROPIC_EXTENT].map((p) => p.dot(right)),
            ys = [...scene.islandMarks, ...scene.SKY_MARKS, ...TROPIC_EXTENT].map((p) => p.dot(up)),
            zoom = view.targetZoom,
            centre = view.target.clone(),
            perUnit = (h * zoom) / Math.max(53, (76 * h) / w),
            moved = ((Math.min(...xs) + Math.max(...xs)) / 2 + view.shiftApplied.dot(right) - centre.dot(right)) * perUnit,
            lifted = ((Math.min(...ys) + Math.max(...ys)) / 2 + view.shiftApplied.dot(up) - centre.dot(up)) * perUnit;
          Object.assign(view, { frameDrop: 0, cityMode: false });
          return { zoom, centre, moved, lifted, panel: shift > 0 ? w * (1 - 2 * shift) + 16 : w };
        };
      for (const [w, h] of desktops)
        for (const open of [false, true]) {
          const { zoom, centre, moved, lifted, panel } = overviewOf(w, h, open ? 492 / (2 * w) : 0, 0),
            at = `City mode's overview at ${w} x ${h}${open ? ' beside the file' : ''}`,
            all = box([...scene.islandMarks, ...shape, ...TROPIC_EXTENT].map((p) => px(w, h, zoom, bearing, centre, p))),
            rest = gap(box(shape.map((p) => px(w, h, zoom, bearing, centre, p))));
          if (moved > 1e-6) found.moved.push(`${w} x ${h}${open ? ' beside the file' : ''} ${moved.toFixed(0)} px at ${zoom.toFixed(3)}`);
          found.rest = Math.min(found.rest, rest);
          // Sideways, or failing that (no room beside the file) up, the town down; never both, never further
          // than the island needs: 24 px clear of the column at rest, or off it through the drift.
          const offs = drifts.map((d) => gap(box(shape.map((p) => px(w, h, zoom, bearing + d, centre, p))))),
            driftLeast = Math.min(...offs);
          if (Math.abs(lifted) > 1e-6) found.lifted.push(`${w} x ${h}${open ? ' beside the file' : ''} ${(-lifted).toFixed(0)} px at ${zoom.toFixed(3)}`);
          assert(moved > -1e-6 && (Math.abs(lifted) < 1e-6 || (moved < 1e-6 && lifted < 0)) && ((moved < 1e-6 && Math.abs(lifted) < 1e-6) || rest < 24 + 6 || driftLeast < 6), `${at} moves the view ${moved.toFixed(1)} px sideways and ${lifted.toFixed(1)} px up, the island ${rest.toFixed(1)} px from the caption's column (${driftLeast.toFixed(1)} px through the drift).`);
          assert(rest >= 24 - 1e-6 && all[0] >= 24 - 1e-6 && all[2] <= panel - 24 + 1e-6, `${at} leaves the sky island ${rest.toFixed(1)} px from the caption's column, the overview spanning ${all[0].toFixed(0)} to ${all[2].toFixed(0)} px (the file at ${panel.toFixed(0)}).`);
          // Moved up (where the file leaves no room beside it, at 1024 to 1180 px with the file open, the
          // box as tall as the part of the frame the bands leave free, the tropic island at its foot), the
          // box's foot keeps over the bottom band; where the view went out first for the room, no further
          // than the drift asked (the island a pixel or two off the column at its extreme).
          if (lifted < -1e-6) assert(all[3] <= h - 76 + 0.5 && (Math.abs(zoom - widestOf(w, h)) < 1e-9 || driftLeast < 6), `${at}, moved up, puts the overview's foot ${(all[3] - (h - 76)).toFixed(1)} px into the bottom band, or goes further out than the island needs (${driftLeast.toFixed(1)} px off the column through the drift).`);
          for (const d of drifts) {
            const off = gap(box(shape.map((p) => px(w, h, zoom, bearing + d, centre, p))));
            found.drift = Math.min(found.drift, off);
            assert(off >= 0, `Drifted ${d.toFixed(2)}, ${at} brings the sky island onto the caption's column (${off.toFixed(1)} px).`);
          }
        }
      // Phones: moved only where that clears the island (on their side, beside the file), else as they were.
      for (const [w, h, shift, drop] of [
        ...[[360, 640], [375, 667], [390, 844], [412, 915], [430, 932]].map(([w, h]) => [w, h, 0, -100.95 / h]),
        ...[[667, 375], [844, 390], [932, 430]].map(([w, h]) => [w, h, (Math.min(340, 0.42 * w) + 28) / (2 * w), -33 / h]),
      ]) {
        const { zoom, centre, moved, panel } = overviewOf(w, h, shift, drop),
          all = box([...scene.islandMarks, ...shape, ...TROPIC_EXTENT].map((p) => px(w, h, zoom, bearing, centre, p))),
          rest = gap(box(shape.map((p) => px(w, h, zoom, bearing, centre, p))));
        if (moved > 1e-6) found.moved.push(`${w} x ${h} ${moved.toFixed(0)} px`);
        else found.kept++;
        assert(moved < 1e-6 || (rest >= 24 - 1e-6 && rest < 24 + 6 && all[2] <= panel - 24 + 1e-6), `City mode's overview on a ${w} x ${h} phone moves the view ${moved.toFixed(1)} px, the island ${rest.toFixed(1)} px from the caption's column.`);
      }
      laneD3.overview = `the sky island in City mode's overview ${found.rest.toFixed(1)} px clear of the caption's column at rest and ${found.drift.toFixed(1)} px through the drift on every desktop size (the view moved ${found.moved.join(', ')}${found.lifted.length ? `, and up where the file leaves no room beside it: ${found.lifted.join(', ')}` : ''}; ${found.kept} phones as they were)`;
    }

    // (c) Its own file, at its own lower pitch (city-scene's SKY_PITCH, 30 degrees; from the town's
    // 42.6 its rock showed as a fringe under the deck): framed as the camera will stand once it has
    // come down (aim() 1 for the island alone, the pitch at 1), SKY_FIT fitted like a group between
    // 0.7 and 2.6 (2.035 at 1440 x 900; 2.019 at the town's pitch), its target then raised SKY_LIFT
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

    // (c1b) Short windows (the camera review's fifth finding). Under 961 px wide the file is a peeking
    // sheet, and on a short window the band it leaves (from the masthead's foot at 58 to the sheet's
    // top, measured on the page: 195.2 at 960 x 540, 224 at 800 x 600) held the island only below the
    // old floor of 0.95: its chimneys rose into the masthead and its rock and puffs sank under the
    // frosted sheet (12 and 14.5 px at 960 x 540). Fitted down to 0.7 (focusSky, skyFitZoom), it
    // settles at its own pitch whole in that band, 6 px clear of the masthead and the sheet at least
    // and 12 of the sides, at every Rotate stop, at rest and through the idle drift; from that fit
    // down to seven tenths of it, at every bearing and with its ground point anywhere on its pocket's
    // edge, the sea fills the frame and its corners lie no deeper in the fog than in that window's own
    // widest view of the town. And every listed screen fits the island above the old floor, so the
    // new one moves none of their framings.
    {
      const { SEA_SIZE } = await import(pathToFileURL(path.join(output, 'city-water.mjs')).href),
        [fogNear, fogFar] = /new T\.Fog\('#[0-9a-f]+', (\d+), (\d+)\)/.exec(source).slice(1).map(Number),
        // A frame at `zoom` and `low` of the way down to the file's pitch, from bearing `b`, its view
        // centre the panel offset (`shift`, `drop`) from `ground`: how far out its corners see the sea
        // short of the fog and the near plane, and how deep into the fog the farthest lies with the
        // target lifted as far as the pan limit lets it.
        corners = (w, h, shift, drop, zoom, low, b, ground) => {
          const aspect = w / h,
            vertical = Math.max(53, 76 / aspect),
            halfW = (vertical * aspect) / 2 / zoom,
            halfH = vertical / 2 / zoom,
            back = scene.viewOffset(b, new T.Vector3(), low),
            right = new T.Vector3(Math.cos(b), 0, -Math.sin(b)),
            up = new T.Vector3().crossVectors(back.clone().normalize(), right),
            forward = back.clone().normalize().negate(),
            eye = ground.clone().addScaledVector(right, shift * 2 * halfW).addScaledVector(up, drop * 2 * halfH).add(back);
          let fog = 0,
            reach = 0;
          for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            const from = eye.clone().addScaledVector(right, u * halfW).addScaledVector(up, v * halfH),
              t = (0.07 - from.y) / forward.y;
            fog = Math.max(fog, (t + scene.PAN.lift / -forward.y - fogNear) / (fogFar - fogNear));
            if (t > -200 && t < fogFar) reach = Math.max(reach, Math.abs(from.x + forward.x * t), Math.abs(from.z + forward.z * t));
          }
          return { fog, reach };
        },
        found = { zoom: Infinity, clear: Infinity, fog: 0, widest: 0, reach: 0 };
      for (const [w, h, sheet] of [[960, 540, 195.2], [800, 600, 224]]) {
        const drop = ((58 + sheet) / 2 - h / 2) / h;
        for (let stop = 0; stop < 4; stop++) {
          const bearing = fileBearing + (stop * Math.PI) / 2,
            { zoom, centre, low } = settles(w, h, 0, drop, bearing),
            elevation = scene.TOWN_PITCH + (filePitch - scene.TOWN_PITCH) * low,
            at = `${w} x ${h}${stop ? ` at Rotate stop ${stop}` : ''}`;
          found.zoom = Math.min(found.zoom, zoom);
          assert(zoom >= 0.7 - 1e-9 && low > 0.999, `The sky island's file on a ${at} window fits at ${zoom.toFixed(3)}, ${low.toFixed(3)} of the way down to its pitch.`);
          for (const d of [0, ...fileDrifts]) {
            const [x0, y0, x1, y1] = box(shape.map((p) => px(w, h, zoom, bearing + d, centre, p, elevation))),
              clear = Math.min(y0 - 58, sheet - y1);
            found.clear = Math.min(found.clear, clear);
            assert(clear >= 6 && x0 >= 12 && x1 <= w - 12, `Drifted ${d.toFixed(2)}, the sky island's file on a ${at} window spans ${[x0, y0, x1, y1].map((n) => n.toFixed(0)).join(', ')} px, against the masthead's foot at 58 and the sheet's top at ${sheet}.`);
          }
        }
        // From the fit down to seven tenths of it: the sea, and the fog against the window's widest view of the town.
        frame(w, h, 0, fileBearing);
        Object.assign(view, { frameDrop: drop, panelEdge: 1, focusedIds: ['sky-island'], pitch: 1 });
        scene.focusSky();
        const fit = view.targetZoom,
          widest = corners(w, h, 0, 0, widestOf(w, h), 0, fileBearing, new T.Vector3(S.x, 0, S.z)).fog;
        found.widest = Math.max(found.widest, widest);
        for (const k of [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7]) {
          const zoom = fit * k,
            low = scene.aim(zoom),
            out = 16 * (low ? Math.tan(scene.TOWN_PITCH) / Math.tan(scene.TOWN_PITCH + (filePitch - scene.TOWN_PITCH) * low) : 1) + 0.5;
          for (let b = 0; b < 2 * Math.PI; b += Math.PI / 48)
            for (let a = 0; a < 2 * Math.PI; a += Math.PI / 8) {
              const { fog, reach } = corners(w, h, 0, drop, zoom, low, b, new T.Vector3(S.x + Math.cos(a) * out, 0, S.z + Math.sin(a) * out));
              found.fog = Math.max(found.fog, fog);
              found.reach = Math.max(found.reach, reach);
              assert(fog < widest && reach < SEA_SIZE / 2 - 10, `On a ${w} x ${h} window, the sky island's file zoomed to ${zoom.toFixed(3)} (${low.toFixed(2)} of the way down) at bearing ${b.toFixed(2)} sees the sea ${reach.toFixed(0)} out (of ${SEA_SIZE / 2}) and a corner ${(fog * 100).toFixed(0)}% into the fog, ${(widest * 100).toFixed(0)}% in its widest view of the town.`);
            }
        }
        Object.assign(view, { frameDrop: 0, focusedIds: [], pitch: 0 });
      }
      // Every listed screen's file, at every Rotate stop, fits the island above the old floor.
      let lowest = Infinity;
      for (const [w, h, shift, drop] of [
        ...[...desktops, [1366, 657]].map(([w, h]) => [w, h, 492 / (2 * w), 0]),
        [768, 1024, 0, -0.2629],
        [820, 1180, 0, -0.2625],
        ...[[360, 640], [360, 740], [375, 667], [375, 812], [390, 844], [393, 852], [412, 915], [414, 896], [430, 932]].map(([w, h]) => [w, h, 0, -100.95 / h]),
        ...landscapeFiles,
      ])
        for (let stop = 0; stop < 4; stop++) {
          frame(w, h, shift, fileBearing + (stop * Math.PI) / 2);
          Object.assign(view, { frameDrop: drop, panelEdge: 1, focusedIds: ['sky-island'] });
          lowest = Math.min(lowest, scene.skyFitZoom());
          Object.assign(view, { frameDrop: 0, focusedIds: [] });
        }
      assert(lowest > 0.95, `A listed screen fits the sky island's file at ${lowest.toFixed(3)}, under the old floor: lowering it moved that screen's framing.`);
      laneD3.short = `the sky island's file on 960 x 540 and 800 x 600 windows fitted down to ${found.zoom.toFixed(3)}, ${found.clear.toFixed(1)} px clear of the masthead and the sheet at least, its corners ${(found.fog * 100).toFixed(0)}% into the fog at most (${(found.widest * 100).toFixed(0)}% in their widest view of the town), every listed screen at ${lowest.toFixed(3)} or more`;
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
      // same phone's own widest view of the town (its widest zoom, at the town's pitch).
      const sideways = { fog: 0, town: 0 };
      for (const [w, h, shift, drop] of landscapeFiles) {
        frame(w, h, shift, fileBearing);
        Object.assign(view, { frameDrop: drop, panelEdge: 1, focusedIds: ['sky-island'], pitch: 1 });
        scene.focusSky();
        const fit = view.targetZoom,
          widest = seaFrame(w, h, 0, 0, widestOf(w, h), 0, fileBearing, 0, 0);
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

    // (c2c) Zoomed at the pointer in the file (the final review's first camera finding, C2a's own pull
    // fix's side effect): while the pitch eased, the slack grew to whatever the view stood out by, which
    // took up OrbitControls' zoom at the pointer too (City mode's zoomToCursor moves the target after
    // OrbitControls' own clamp), so wheel or pinch zooms out with the pointer at one point and in at
    // another walked the view off the island's pocket and out over open sea, which the pan limit never
    // brought back: at 1440 x 900, six notches out at (150, 450) and six in at (940, 450) took the ground
    // point 18.7, 22.3, 32.2, 44.0 and 56.5 from the island (its pocket 25.5). Now the slack grows only by
    // what the change of pitch itself does to the view as the last frame's limit left it. Through three's
    // real OrbitControls (zoom at the pointer, its wheel and its two-finger pinch handlers, the scene's
    // cancel() on its 'start') and the frame loop's own panel offset, turn, pitch step, wheel-zoom sync,
    // glide, pan limit and update, from the file at rest: five cycles of zooming out with the pointer (or
    // the pinch's middle) near the frame's left edge and back in near its right; on desktops by the
    // wheel, on phones held either way by pinches, on the tablet by both. On every frame the limit holds
    // the view (its ground point no further out of its region at the pitch it stands at than the slack,
    // half a unit more at most); and as each cycle settles back at the file's own pitch, the ground point
    // stands out of the pan regions by no more than the pitch's own swing of the line of sight through a
    // target at the limit's lift (PAN.lift times the difference of the two pitches' cotangents, 5.15: the
    // slack the C2a fix holds the view still with): the gestures pan the view as zooms at a pointer do,
    // into the town's disc or along the link, but never ratchet it out to sea (C2a's rule: 7.2 out after
    // the second cycle at 1440 x 900, then on out). The review's own two gestures, on the desktop and on
    // the phone held sideways, keep it in the island's pocket.
    {
      const want = ['panRegion', 'holdPan', 'excessAt', 'viewOffset', 'panelOffset', 'offsetTarget', 'followPanel', 'fitGroup', 'groupFrame', 'skyMarks', 'skyFit', 'focusSky', 'skyFitZoom', 'skyReach', 'elevationAt', 'aim', 'skyFile', 'skyPivot', 'turnSky', 'align', 'cancel'],
        vars = ['PAN', 'panSubject', 'PANEL_CLEAR', 'SKY_MARKS', 'SKY_LIFT', 'TOWN_PITCH', 'YAW_RATE', 'TROPIC_MIDDLE'],
        code = [];
      let pitchSource, wheelSource;
      (function collect(node) {
        if (ts.isFunctionDeclaration(node) && want.includes(node.name?.text)) code.push(node.getText(syntax).replace(/^export\s+/, ''));
        if (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => vars.includes(d.name.getText(syntax)))) code.push(node.getText(syntax).replace(/^export\s+/, ''));
        if (ts.isBlock(node) && node.statements[0]?.getText(syntax) === 'const left = aim(camera.zoom) - pitch;') pitchSource = `function pitchStep() ${node.getText(syntax)}`;
        if (ts.isIfStatement(node) && node.expression.getText(syntax) === '!tween && camera.zoom !== shownZoom') wheelSource = `function wheelStep() { ${node.getText(syntax)} }`;
        ts.forEachChild(node, collect);
      })(syntax);
      const turning = turnPieces.find((p) => p.startsWith('function turnStep'));
      assert(code.length === want.length + vars.length && turning && glideSource && pitchSource && wheelSource, 'The zoom-at-the-pointer check must find every piece it runs.');
      // The frame loop keeps the target as the limit left it, right after OrbitControls' update (holdPan's panLast).
      {
        const loop = stepSource.split(';').map((s) => unformatted(s)),
          at = loop.indexOf('controls.update()');
        assert(at >= 0 && loop[at + 1].endsWith('panLast.copy(controls.target)'), 'The frame loop no longer keeps the target as the pan limit left it, right after OrbitControls\' update.');
      }
      const script = `${ts.transpileModule([...code, turning, glideSource, pitchSource, wheelSource].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};({ holdPan, panRegion, focusSky, followPanel, turnStep, glideStep, pitchStep, wheelStep, cancel, align, aim, skyReach, panLast })`,
        pocket = (16 * Math.tan(scene.TOWN_PITCH)) / Math.tan(filePitch),
        worst = { out: 0, end: 0, cycles: 0 };
      for (const [w, h, shift, drop, how, from, to, own] of [
        [1440, 900, 492 / 2880, 0, 'wheel', [150, 450], [940, 450], true],
        [1280, 720, 492 / 2560, 0, 'wheel', [120, 380], [800, 380]],
        [768, 1024, 0, -0.2629, 'wheel', [90, 230], [680, 300]],
        [768, 1024, 0, -0.2629, 'pinch', [90, 230], [680, 300]],
        [390, 844, 0, -100.95 / 844, 'pinch', [60, 220], [330, 420]],
        [390, 844, 0, -100.95 / 844, 'pinch', [330, 220], [60, 420]],
        [...landscapeFiles[3].slice(0, 4), 'pinch', [60, 150], [470, 200], true],
        [...landscapeFiles[0].slice(0, 4), 'pinch', [50, 140], [360, 190]],
      ]) {
        const aspect = w / h,
          vertical = Math.max(53, 76 / aspect),
          camera = new T.OrthographicCamera((-vertical * aspect) / 2, (vertical * aspect) / 2, vertical / 2, -vertical / 2, -200, 180),
          controls = new OrbitControls(camera, null);
        controls.domElement = { clientWidth: w, clientHeight: h, getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }) };
        Object.assign(controls, { enableRotate: false, enableDamping: true, dampingFactor: 0.09, screenSpacePanning: true, zoomToCursor: true, zoomSpeed: how === 'wheel' ? 1.5 : 1, minZoom: widestOf(w, h), maxZoom: 4 });
        const zoom = {
            T,
            Math,
            plan,
            TROPIC_EXTENT,
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
            shownZoom: 1,
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
            cityMode: true,
            lastInteraction: 0,
            performance: { now: () => 0 },
            models: new Map(),
            city: { updateMatrixWorld() {} },
            placeSun() {},
            clearHover() {},
            fitOverview() {},
          },
          run = runInNewContext(script, zoom),
          // One frame of step(), in its order (the wheel-zoom sync runs before the panel is followed).
          frame = () => {
            run.wheelStep();
            run.followPanel();
            run.turnStep();
            run.pitchStep();
            run.glideStep();
            run.holdPan();
            controls.update();
            run.panLast.copy(controls.target);
            camera.updateMatrixWorld();
            if (!zoom.tween) zoom.target.copy(controls.target);
            zoom.shownZoom = camera.zoom;
          },
          // How far the view's ground point stands from the island.
          away = () => {
            const back = camera.position.clone().sub(controls.target).normalize(),
              g = controls.target.clone().sub(zoom.shiftApplied);
            g.addScaledVector(back, -g.y / back.y);
            return Math.hypot(g.x - S.x, g.z - S.z);
          },
          at = `${how === 'wheel' ? 'Wheel' : 'Pinch'} zooms at the pointer in the sky island's file at ${Number(w)} x ${Number(h)}`,
          // The limit holds the view: its ground point out of its region at the pitch it stands at by no more than the slack.
          watch = (k) => {
            const back = camera.position.clone().sub(controls.target).normalize(),
              g = controls.target.clone().sub(zoom.shiftApplied);
            g.addScaledVector(back, -g.y / back.y);
            const r = run.panRegion(g),
              past = g.distanceTo(r.centre) - r.radius - zoom.panSlack;
            assert(past <= 0.5, `${at}: in cycle ${k} the view's ground point stands ${past.toFixed(2)} past its region and its slack.`);
          },
          // Settled back at the file's own pitch: no further out of the pan regions than after the first cycle (the review's own gestures: in the island's pocket).
          settled = [],
          swing = scene.PAN.lift * (1 / Math.tan(filePitch) - 1 / Math.tan(scene.TOWN_PITCH)),
          settle = (k) => {
            for (let f = 0; f < 600 && (Math.abs(run.aim(camera.zoom) - zoom.pitch) > 1e-4 || f < 60); f++) {
              frame();
              watch(k);
            }
            const back = camera.position.clone().sub(controls.target).normalize(),
              g = controls.target.clone().sub(zoom.shiftApplied);
            g.addScaledVector(back, -g.y / back.y);
            const r = run.panRegion(g),
              out = Math.max(0, g.distanceTo(r.centre) - r.radius);
            settled.push(out);
            worst.out = Math.max(worst.out, out);
            assert(out <= swing + 0.5, `${at}: after cycle ${k} the view's ground point stands ${out.toFixed(1)} out of the pan regions, ${away().toFixed(1)} from the island (${settled.map((v) => v.toFixed(1)).join(', ')} after each cycle): it walks out to sea.`);
            if (own) assert(away() <= pocket + 0.5, `${at}: after cycle ${k} the view's ground point stands ${away().toFixed(1)} from the island, out of its pocket of ${pocket.toFixed(1)}.`);
          };
        controls.addEventListener('start', run.cancel);
        // The file, framed and at rest.
        run.focusSky();
        controls.target.copy(zoom.target);
        camera.zoom = zoom.targetZoom;
        zoom.pitch = zoom.panPitch = run.aim(zoom.targetZoom);
        camera.updateProjectionMatrix();
        run.align();
        controls.update();
        zoom.shownZoom = camera.zoom;
        for (let f = 0; f < 60; f++) frame();
        // A wheel notch (OrbitControls' 'start', then its own wheel handling at the pointer), or a pinch:
        // two fingers down, the second moved in eight steps to `scale` times their spread, and lifted.
        const notch = ([x, y], deltaY) => {
            controls.dispatchEvent({ type: 'start' });
            controls._handleMouseWheel({ clientX: x, clientY: y, deltaY, deltaMode: 0 });
            for (let f = 0; f < 3; f++) frame();
          },
          pinch = ([x, y], scale) => {
            const spread = 120;
            controls._addPointer({ pointerId: 1 });
            controls._onTouchStart({ pointerId: 1, pageX: x - spread / 2, pageY: y });
            controls._addPointer({ pointerId: 2 });
            controls._onTouchStart({ pointerId: 2, pageX: x + spread / 2, pageY: y });
            // Both fingers move, each its own event, about the pinch's middle.
            for (let k = 1; k <= 8; k++) {
              const now = spread * scale ** (k / 8);
              controls._onTouchMove({ pointerId: 1, pageX: x - now / 2, pageY: y });
              controls._onTouchMove({ pointerId: 2, pageX: x + now / 2, pageY: y });
              frame();
              frame();
            }
            controls._removePointer({ pointerId: 2 });
            controls._removePointer({ pointerId: 1 });
            controls.state = -1;
          };
        for (let k = 1; k <= 5; k++) {
          for (let n = 0; n < (how === 'wheel' ? 6 : 2); n++) {
            if (how === 'wheel') notch(from, 100);
            else pinch(from, 0.6);
            watch(k);
          }
          for (let f = 0; f < 9; f++) {
            frame();
            watch(k);
          }
          for (let n = 0; n < (how === 'wheel' ? 6 : 2); n++) {
            if (how === 'wheel') notch(to, -100);
            else pinch(to, 1 / 0.6);
            watch(k);
          }
          settle(k);
          worst.cycles++;
        }
        if (own) worst.end = Math.max(worst.end, away());
      }
      skyNav.zoomWalk = `${worst.cycles} cycles of wheel and pinch zooms at the pointer out and back in the sky island's file that never ratchet it out to sea (its ground point ${worst.out.toFixed(2)} out of the pan regions at most as a cycle settles; the review's own two gestures end ${worst.end.toFixed(1)} from the island at most, in its pocket of ${pocket.toFixed(1)})`;
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
          controls: { minZoom: WIDEST_ZOOM.wide, target: new T.Vector3() },
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
        spin.controls.minZoom = widestOf(w, h);
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
      const want = ['panRegion', 'holdPan', 'excessAt', 'viewOffset', 'panelOffset', 'offsetTarget', 'followPanel', 'fitGroup', 'groupFrame', 'skyMarks', 'skyFit', 'focusSky', 'skyFitZoom', 'skyReach', 'elevationAt', 'aim', 'skyFile', 'skyPivot', 'turnSky', 'align', 'cancel'],
        vars = ['PAN', 'panSubject', 'PANEL_CLEAR', 'SKY_MARKS', 'SKY_LIFT', 'TOWN_PITCH', 'YAW_RATE', 'TROPIC_MIDDLE'],
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
      const script = `${ts.transpileModule([...code, turning, glideSource, pitchSource, rotateSource, zoomSource].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};({ holdPan, panRegion, focusSky, followPanel, turnStep, glideStep, pitchStep, rotate, zoomBy, cancel, align, aim, panLast, middle: SKY_FIT.getCenter(new T.Vector3()) })`,
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
          Object.assign(controls, { enableRotate: false, enableDamping: true, dampingFactor: 0.09, screenSpacePanning: true, minZoom: widestOf(w, h), maxZoom: 4 });
          const turn = {
              T,
              Math,
              plan,
              TROPIC_EXTENT,
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
              run.panLast.copy(controls.target);
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
        // (The shadow's half of the sky island's frame step: followIslands, which hides and shows it, is (d)'s.)
        const want = ['viewOffset', 'panelOffset', 'offsetTarget', 'followPanel', 'fitGroup', 'groupFrame', 'fitFocused', 'driftHold', 'focusSky', 'skyFitZoom', 'skyFile', 'skyPivot', 'turnSky', 'skyAhead', 'aim', 'elevationAt', 'skyFit', 'skyMarks', 'followSky', 'align', 'select', 'skyShadowWanted', 'skyClose', 'bandShare', 'clipToFrame', 'skySettled', 'skyWide', 'skyHolds', 'skyViews', 'keyAt', 'skyWideBox', 'sunBoxHolds', 'sunReach', 'eachLandSeen', 'lightAxes'],
          vars = ['TOWN_PITCH', 'SKY_LIFT', 'PANEL_CLEAR', 'SKY_MARKS', 'YAW_RATE', 'SKY_SHADOW', 'TOWN_WATERLINE', 'LAND_MARKS', '[rockX, rockZ]', 'ahead', 'UP', 'AIRPORT_FIT', 'SKY_WIDE', 'TOWN_LAND', 'SKY_TIGHT', 'skyStillAt'],
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
              controls: { target: new T.Vector3(), minZoom: widestOf(w, h) },
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
    // The tropic island (south of the town, on the sea) goes and comes by the same rule (city-scene's
    // islandShown, for both islands through followIslands), through its land builder's setShown, which
    // takes its shallows with it: its hides are the last shot and the opening view alone (every other
    // reading frame leaves it out of sight: below), so
    // (d1) it stays out of view, and so in the scene, in About, People and Departures; City mode and
    //   Inspect show it;
    // (d2) the opening view, on phones, tablets and desktops (where a corner of it, or the whole of it,
    //   would stand in the frame's bottom left), as the page opens on it and through the idle drift,
    //   never shows it nor its shallows;
    // (d3) a drag, a wheel zoom or the - button in the opening view, or a drag in the last shot, shows
    //   it at once wherever any of it is in view;
    // (d4) glided into the opening view, People or the last shot from its own file, or from About
    //   panned to it by Recentre, it goes only on a frame where neither it nor its shallows reach more
    //   than a pixel into the frame, or once the camera has come to rest there with no more than half
    //   the box round them in the frame; where more of it stands in the resting frame it is kept.
    {
      const want = ['viewOffset', 'panelOffset', 'offsetTarget', 'followPanel', 'fitOverview', 'fitGroup', 'groupFrame', 'fitFocused', 'driftHold', 'focusSky', 'skyFitZoom', 'skyFile', 'skyPivot', 'turnSky', 'aim', 'elevationAt', 'skyFit', 'skyMarks', 'skyExtent', 'settledView', 'islandHidden', 'islandOnScreen', 'islandShown', 'followIslands', 'followSky', 'align', 'reset', 'select', 'focusBuildings', 'overview', 'cancel', 'resize'],
        vars = ['TOWN_PITCH', 'SKY_LIFT', 'PANEL_CLEAR', 'SKY_MARKS', 'islandMarks', '[rockX, rockZ]', 'AIRPORT_FIT', 'SKY_HIDES', 'SKY_EXTENT', 'onScreen', 'YAW_RATE', 'shortestAngle', 'TROPIC_MIDDLE', 'settling'],
        methods = ['setYaw', 'setFrameShift', 'zoom', 'focusPark'],
        code = [];
      let pitchSource, firstShown, tropicFirst;
      (function collect(node) {
        if (ts.isFunctionDeclaration(node) && want.includes(node.name?.text)) code.push(node.getText(syntax).replace(/^export\s+/, ''));
        if (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => vars.includes(d.name.getText(syntax)))) code.push(node.getText(syntax).replace(/^export\s+/, ''));
        // (How the scene starts: each island shown or not, before its first frame.)
        if (ts.isVariableDeclaration(node) && node.name.getText(syntax) === 'skyShown') firstShown = node.initializer?.getText(syntax);
        if (ts.isVariableDeclaration(node) && node.name.getText(syntax) === 'tropicShown') tropicFirst = node.initializer?.getText(syntax);
        if (ts.isMethodDeclaration(node) && methods.includes(node.name.getText(syntax)))
          code.push(`function ${node.name.getText(syntax) === 'zoom' ? 'zoomBy' : node.name.getText(syntax)}(${node.parameters.map((p) => p.getText(syntax)).join(', ')}) ${node.body.getText(syntax)}`);
        if (ts.isBlock(node) && node.statements[0]?.getText(syntax) === 'const left = aim(camera.zoom) - pitch;') pitchSource = `function pitchStep() ${node.getText(syntax)}`;
        ts.forEachChild(node, collect);
      })(syntax);
      const turning = turnPieces.find((p) => p.startsWith('function turnStep'));
      assert(code.length === want.length + vars.length + methods.length && turning && glideSource && pitchSource && ['true', 'false'].includes(firstShown) && tropicFirst === 'false', 'The hiding check must find every piece it runs.');
      // The tropic island starts hidden, as the sky island does: its land is built shown, so the scene
      // hides it before the first frame (followIslands only calls setShown when the rule changes its mind).
      assert(holds(source, 'tropic.setShown(false);'), 'The scene no longer hides the tropic island before its first frame.');
      const { WATER } = await import(pathToFileURL(path.join(output, 'town-shared.mjs')).href),
        { createSeaShadow } = await import(pathToFileURL(path.join(output, 'city-water.mjs')).href),
        UP = new T.Vector3(0, 1, 0),
        keyOffset = new T.Vector3(),
        pool = createSeaShadow(WATER),
        // The tropic island in the scene, as its land builder's setShown leaves it (land, building,
        // garden, figure, shallows and foam all at once), and the calls the scene makes to it.
        tropicLand = { visible: true, calls: [] },
        sky = {
          T,
          Math,
          plan,
          TROPIC_EXTENT,
          TROPIC_SEEN,
          tropic: {
            setShown(shown) {
              tropicLand.visible = shown;
              tropicLand.calls.push(shown);
            },
          },
          tropicShown: false,
          tropicDrawn: false,
          shadowDirty: false,
          camera: new T.OrthographicCamera(-24, 24, 24, -24, -200, 180),
          controls: { target: new T.Vector3(), minZoom: WIDEST_ZOOM.wide, zoomToCursor: false },
          WIDEST: WIDEST_ZOOM,
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
          `${ts.transpileModule([...code, turning, glideSource, pitchSource].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};({ followPanel, turnStep, glideStep, pitchStep, align, followIslands, followSky, reset, select, focusBuildings, cancel, resize, overview, setYaw, setFrameShift, zoomBy, focusPark, aim })`,
          sky,
        ),
        tropicTurns = { count: 0 },
        // One frame of step(): the panel offset, the turn, the pitch, the glide, the camera on its target
        // (OrbitControls' update), the view handed over, then followIslands, followSky and the pool laid
        // for the frame. Each time the tropic island goes or comes, its land goes or comes with it and the
        // sun's shadow is drawn again in that very frame (it casts in the town's box).
        step = () => {
          run.followPanel();
          run.turnStep();
          run.pitchStep();
          run.glideStep();
          run.align();
          if (!sky.tween) sky.target.copy(sky.controls.target);
          sky.camera.updateMatrixWorld();
          const before = sky.tropicShown;
          sky.shadowDirty = false;
          run.followIslands();
          assert(tropicLand.visible === sky.tropicShown, 'The tropic island\'s land is not shown or hidden with it.');
          if (sky.tropicShown !== before) {
            tropicTurns.count++;
            assert(sky.shadowDirty && tropicLand.calls.at(-1) === sky.tropicShown, 'The tropic island goes or comes without its shadow drawn again in that frame.');
          }
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
        // The tropic island as it can show (town-tropic's TROPIC_SEEN: its extent, its outline at the
        // water and the tops of its roof and trees, and round it its shelf and shallows, which go and
        // come with it, 4.6 past the waterline, and its crowns' ring 0.7 past it), as the scene measures it.
        tropicMiddle = new T.Vector3(plan.TROPIC.x, 0, plan.TROPIC.z),
        tropicShape = TROPIC_SEEN,
        tropicIsland = () => seen(tropicShape),
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
        file = (shift, drop, id = 'sky-island') => {
          Object.assign(sky, { cityMode: true, frameShift: shift, frameDrop: drop, panelEdge: 1 });
          run.setYaw(plan.chapterBearings[id]);
          run.select(id);
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
          Object.assign(sky, { yaw: Math.PI / 4, targetYaw: Math.PI / 4, targetZoom: 1, pitch: 0, driftAngle: 0, tween: true, focusedIds: [], overviewFit: false, inspect: null, parkSelected: false, autoFocus: false, cityMode: false, skyShown: firstShown === 'true', tropicShown: tropicFirst === 'true', tropicDrawn: false, frameShift: 0, frameDrop: 0, frameFoot: 1, panelEdge: 1 });
          // (The scene hides the tropic island's land as it starts: tropic.setShown(false).)
          tropicLand.visible = false;
          stage(w, h);
        },
        settle = () => {
          for (let f = 0, still = 0; f < 1200 && still < 5; f++) {
            step();
            still = rests() ? still + 1 : 0;
          }
        },
        worst = { went: 0, share: 0, glides: 0 },
        tropicWorst = { went: 0, gone: 0, unseen: 0, kept: 0, drifts: 0 },
        // Whether the camera moves this frame: a glide, a turn or the pitch under way (the idle drift aside).
        moving = () => sky.tween || Math.abs(sky.targetYaw - sky.yaw) > 1e-4 || Math.abs(run.aim(sky.camera.zoom) - sky.pitch) > 1e-4,
        // Frame by frame to rest: wherever it goes, nothing of it or its pool is left in the frame but a
        // pixel, or the camera has come to rest with no more than half the box round it in the frame.
        // The tropic island and its shelf and shallows go only on a frame where nothing of them is left
        // in it and the camera moves, or where none of them was drawn the frame before; never at rest.
        watch = (label) => {
          let went = false;
          for (let f = 0, still = 0; f < 1200 && still < 5; f++) {
            const was = sky.skyShown,
              wasTropic = sky.tropicShown,
              drawn = wasTropic && tropicIsland().reach > 1;
            step();
            still = rests() ? still + 1 : 0;
            if (wasTropic && !sky.tropicShown) {
              const it = tropicIsland();
              assert(!drawn || (it.reach <= 1 + 1e-9 && moving()), `${label}: the tropic island goes at frame ${f} with ${it.reach.toFixed(1)} px of it or its shelf and shallows (${(it.share * 100).toFixed(0)}% of the box round them) in the frame and drawn in the frame before${moving() ? '' : ', the camera at rest'}.`);
              tropicWorst.gone++;
              if (drawn) tropicWorst.went = Math.max(tropicWorst.went, it.reach);
              else tropicWorst.unseen++;
            }
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
      // (The tropic island, which no chapter's frame hides, is out of view there and so in the scene.)
      assert(sky.tropicShown && tropicIsland().reach === 0, 'The tropic island is hidden in the About chapter, or in view there.');
      chapter('people', 1440, true);
      step();
      assert(!sky.skyShown && !pool.mesh.visible, 'Glided into the People chapter from About, where it is out of view, the sky island does not go at once.');
      settle();
      assert(!sky.skyShown, 'The sky island shows in the People chapter.');
      assert(sky.tropicShown && tropicIsland().reach === 0, 'The tropic island is hidden in the People chapter, or in view there.');
      chapter('airport', 1440, true);
      for (let f = 0, still = 0; f < 1200 && still < 5; f++) {
        const was = sky.skyShown;
        step();
        still = rests() ? still + 1 : 0;
        assert(was || !sky.skyShown || !sky.tween || island().reach <= 1, `The sky island comes back in view at frame ${f} of the glide out of the People chapter.`);
      }
      assert(sky.skyShown && island().reach === 0, 'The sky island does not come back once the glide out of the People chapter has ended, or shows in Departures.');
      assert(sky.tropicShown && tropicIsland().reach === 0, 'The tropic island is hidden in Departures, or in view there.');
      chapter('people', 1440, true);
      step();
      sky.cityMode = true;
      step();
      assert(sky.skyShown, 'The sky island is hidden in City mode.');
      Object.assign(sky, { cityMode: false, inspect: {} });
      step();
      assert(sky.skyShown, 'The sky island is hidden in Inspect.');
      sky.inspect = null;
      // From the opening view, where it is hidden, City mode and Inspect bring the tropic island back at once.
      for (const into of ['City mode', 'Inspect']) {
        open(1440, 900);
        hero(true);
        settle();
        assert(!sky.tropicShown && !tropicLand.visible, 'The tropic island shows in the opening view at 1440 x 900.');
        if (into === 'City mode') sky.cityMode = true;
        else sky.inspect = {};
        step();
        assert(sky.tropicShown && tropicLand.visible, `The tropic island is hidden in ${into}.`);
        Object.assign(sky, { cityMode: false, inspect: null });
      }
      // (d2) The opening view on phones and upright tablets (the reading page docks the stage 46% of the
      // screen tall, 320 px at the least: globals.css; a portrait tablet of 1024 wide lays the page out
      // wide, the stage the whole screen, and holds it all but whole) and on desktops, as the page
      // opens on it, through the drift.
      let cut = 0;
      // (And the opening frames, desktops among them, the tropic island would stand in.)
      const tropicIn = [];
      for (const [w, screen, wide] of [[360, 640], [375, 667], [375, 812], [390, 844], [414, 896], [430, 932], [768, 1024], [820, 1180], [1024, 1366, true], [1024, 768, true], [1280, 720, true], [1440, 900, true], [1920, 1080, true]]) {
        const h = wide ? screen : Math.max(320, 0.46 * screen);
        if (!wide && drifts.some((d) => overlaps(hull(shape.map((p) => px(w, h, 1, Math.PI / 4 + d, new T.Vector3(), p))), [0, 0, w, h]))) cut++;
        open(w, h);
        hero(wide);
        settle();
        let inView = false;
        for (const d of drifts) {
          sky.driftAngle = d;
          step();
          assert(!sky.skyShown && !sky.island.root.visible && !pool.mesh.visible, `The opening view at ${w} x ${h.toFixed(0)}, drifted ${d.toFixed(2)}, shows the sky island or its pool.`);
          assert(!sky.tropicShown && !tropicLand.visible, `The opening view at ${w} x ${h.toFixed(0)}, drifted ${d.toFixed(2)}, shows the tropic island or its shallows.`);
          inView ||= tropicIsland().reach > 1;
        }
        if (inView) tropicIn.push(`${w} x ${h.toFixed(0)}`);
      }
      assert(cut > 0, 'The check no longer finds the opening frame the sky island was cut by.');
      assert(tropicIn.length > 0, 'The check no longer finds an opening frame the tropic island would stand in.');
      // (d3) The visitor's own view: the -button three times in the opening view at 1440 x 900 (it
      // comes into view at the top), a drag toward it in a phone's opening view, a wheel zoom out
      // at 1440 x 900; in the last shot, a drag and the + button.
      // (Each frame both islands: wherever more than a pixel of one is in the frame, it is in the scene.)
      const shownInView = (label, frames, act = () => {}) => {
        for (let f = 0; f < frames; f++) {
          act(f);
          step();
          const it = island(),
            south = tropicIsland();
          assert(it.reach <= 1 || sky.skyShown, `${label}: at frame ${f} ${it.reach.toFixed(1)} px of the sky island are in the frame, hidden.`);
          assert(south.reach <= 1 || sky.tropicShown, `${label}: at frame ${f} ${south.reach.toFixed(1)} px of the tropic island are in the frame, hidden.`);
        }
      };
      // A drag that moves the view's centre toward a point on the ground, `by` a frame.
      const dragToward = (x, z, by = 0.25) => sky.controls.target.addScaledVector(new T.Vector3(x - sky.controls.target.x, 0, z - sky.controls.target.z).normalize(), by);
      open(1440, 900);
      hero(true);
      settle();
      assert(!sky.skyShown, 'The sky island shows in the opening view at 1440 x 900.');
      shownInView('The opening view zoomed out with the - button at 1440 x 900', 240, (f) => {
        if (f % 30 === 0 && f < 90) run.zoomBy(1 / 1.25);
      });
      assert(sky.skyShown && island().reach > 1, 'Zoomed out three times from the opening view at 1440 x 900, the sky island is not in view.');
      assert(sky.tropicShown && tropicIsland().reach > 1, 'Zoomed out three times from the opening view at 1440 x 900, the tropic island is not in view.');
      open(390, Math.max(320, 0.46 * 844));
      hero(false);
      settle();
      run.cancel();
      shownInView('A phone\'s opening view dragged toward the sky island', 90, () => {
        // The map follows the finger down: the view's centre moves up the screen, toward the island.
        sky.controls.target.addScaledVector(new T.Vector3().setFromMatrixColumn(sky.camera.matrixWorld, 1), 0.25);
      });
      assert(sky.skyShown, 'Dragged in a phone\'s opening view, the sky island stays hidden.');
      // Dragged toward the tropic island, on a phone (where it stands in the opening frame's bottom
      // left, hidden) and at 1440 x 900 (where it lies just past the frame's foot).
      for (const [w, h, wide] of [[390, Math.max(320, 0.46 * 844), false], [1440, 900, true]]) {
        open(w, h);
        hero(wide);
        settle();
        assert(!sky.tropicShown, `The tropic island shows in the opening view at ${w} x ${h.toFixed(0)}.`);
        run.cancel();
        shownInView(`The opening view at ${w} x ${h.toFixed(0)} dragged toward the tropic island`, 120, () => dragToward(tropicMiddle.x, tropicMiddle.z));
        assert(sky.tropicShown && tropicIsland().reach > 1, `Dragged toward it in the opening view at ${w} x ${h.toFixed(0)}, the tropic island is not in view.`);
      }
      open(1440, 900);
      hero(true);
      settle();
      run.cancel();
      sky.camera.zoom = sky.targetZoom = 0.6;
      sky.camera.updateProjectionMatrix();
      shownInView('The opening view zoomed out by the wheel at 1440 x 900', 30);
      assert(sky.skyShown, 'Zoomed out by the wheel from the opening view, the sky island stays hidden.');
      assert(sky.tropicShown, 'Zoomed out by the wheel from the opening view, the tropic island stays hidden.');
      open(1440, 900);
      chapter('town-hall', 1440, true);
      settle();
      last(true);
      settle();
      assert(!sky.skyShown, 'The sky island shows in the reading page\'s last shot.');
      assert(!sky.tropicShown && !tropicLand.visible, 'The tropic island shows in the reading page\'s last shot.');
      run.cancel();
      shownInView('The last shot dragged', 30);
      assert(sky.skyShown, 'Dragged, the reading page\'s last shot keeps the sky island hidden.');
      assert(sky.tropicShown, 'Dragged, the reading page\'s last shot keeps the tropic island hidden.');
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
      // The tropic island, glided from its own file into the opening view, People and the last shot, from
      // About panned to it by Recentre, and from the opening view dragged toward it by Reset (on desktops,
      // where the opening view leaves a corner of it in the frame's foot): it goes only on a frame where
      // nothing of it is in view and the camera moves, or where nothing of it was drawn the frame before;
      // where the glide leaves some of it in the frame it stays (kept), at rest and all through the idle
      // drift, which may swing it out of the frame and back.
      const kept = [],
        glidesBefore = worst.glides,
        // The camera at rest: through the idle drift's swing, frame by frame, the island kept is never taken away.
        keepsAtRest = (label) => {
          const was = sky.tropicShown;
          if (was) {
            const it = tropicIsland();
            assert(it.reach > 1, `${label}: the camera comes to rest with the tropic island shown out of view.`);
            kept.push(`${label} (${(it.share * 100).toFixed(0)}%)`);
          }
          for (const d of [...drifts, ...[...drifts].reverse()]) {
            sky.driftAngle = d;
            step();
            tropicWorst.drifts++;
            assert(!was || sky.tropicShown, `${label}: the tropic island is taken away at rest, drifted ${d.toFixed(2)}.`);
          }
          sky.driftAngle = 0;
          step();
          if (was) tropicWorst.kept++;
        };
      for (const [size, w, h, shift, drop, wide] of [...leaving, ['1024 x 1366', 1024, 1366, 492 / 2048, 0, true], ['2560 x 1440', 2560, 1440, 492 / 5120, 0, true], ['3440 x 1440', 3440, 1440, 492 / 6880, 0, true]])
        for (const { into, frameIt } of [
          { into: 'the opening view', frameIt: () => hero(wide) },
          { into: 'the People chapter', frameIt: () => chapter('people', w, wide) },
          { into: 'the last shot', frameIt: () => last(wide) },
        ]) {
          open(w, h);
          file(shift, drop, 'tropic-island');
          settle();
          assert(sky.tropicShown && tropicLand.visible && tropicIsland().reach > 50, `The tropic island's file at ${size} does not show it.`);
          frameIt();
          if (!wide) stage(w, Math.max(320, 0.46 * h));
          watch(`From the tropic island's file at ${size} into ${into}`);
          // (People's frames leave it out of view, and do not hide it: it stays in the scene there.)
          if (into === 'the People chapter') assert(sky.tropicShown && tropicIsland().reach === 0, `From its file at ${size}, the People chapter hides the tropic island or shows it.`);
          else keepsAtRest(`${into} from its file at ${size}`);
        }
      open(1440, 900);
      chapter('town-hall', 1440, true);
      settle();
      run.cancel();
      // (Seen whole with its shelf and shallows, TROPIC_SEEN's box is a little wider than About's frame at
      // 1440 x 900: panned right onto it, about seven tenths of that box is in view.)
      for (let f = 0; f < 400 && tropicIsland().share < 0.65; f++) {
        dragToward(tropicMiddle.x, tropicMiddle.z, 0.5);
        step();
      }
      assert(sky.tropicShown && tropicIsland().share >= 0.65, `Panned to the tropic island in the About chapter, the check cannot bring it into view (${(tropicIsland().share * 100).toFixed(0)}% of it).`);
      hero(true);
      watch('Recentre in About panned to the tropic island, at 1440 x 900');
      keepsAtRest('the opening view by Recentre from About panned to it at 1440 x 900');
      // Reset after a drag in the opening view (the island shown, part of it in view): the glide back to
      // the opening view never takes away what of it is drawn.
      for (const [w, h] of [[1024, 768], [1280, 720], [1440, 900], [1920, 1080]]) {
        open(w, h);
        hero(true);
        settle();
        run.cancel();
        for (let f = 0; f < 60 && tropicIsland().share < 0.4; f++) {
          dragToward(tropicMiddle.x, tropicMiddle.z, 0.25);
          step();
        }
        assert(sky.tropicShown && tropicIsland().reach > 50, `Dragged toward it in the opening view at ${w} x ${h}, the tropic island is not in view.`);
        hero(true);
        watch(`Reset after a drag toward the tropic island in the opening view at ${w} x ${h}`);
        keepsAtRest(`the opening view by Reset after a drag at ${w} x ${h}`);
      }
      // The + button in the opening view, where a corner of it (hidden) stands in the frame's foot and the
      // zoom in carries it off: it is never drawn for a moment on the way out; where the zoom in leaves
      // some of it in the frame (a phone's), it shows at once and stays.
      const plus = [];
      for (const [w, h, wide] of [[1280, 720, true], [1440, 900, true], [1920, 1080, true], [390, Math.max(320, 0.46 * 844), false]]) {
        open(w, h);
        hero(wide);
        settle();
        const before = tropicIsland().reach;
        run.zoomBy(1.25);
        let flashed = 0,
          drawnFrames = 0;
        for (let f = 0, still = 0; f < 600 && still < 5; f++) {
          step();
          still = !sky.tween ? still + 1 : 0;
          if (sky.tropicShown && tropicIsland().reach > 1) drawnFrames++;
        }
        const after = tropicIsland().reach;
        if (after <= 1) flashed = drawnFrames;
        assert(flashed === 0 && (after <= 1 || sky.tropicShown), `The + button in the opening view at ${w} x ${h.toFixed(0)} draws the tropic island for ${flashed} frames on its way out of the frame (${before.toFixed(0)} px in before, ${after.toFixed(0)} after), or leaves it hidden in view.`);
        plus.push(`${w} x ${h.toFixed(0)} ${before.toFixed(0)} px in, ${after <= 1 ? 'carried off unseen' : `${after.toFixed(0)} px left, shown`}`);
      }
      assert(tropicWorst.gone > 0 && tropicTurns.count > 0, 'The check never sees the tropic island go.');
      tropicNav.hero = `hidden in the opening view (it would stand in ${tropicIn.length} of 13 opening frames: ${tropicIn.join(', ')}) and the last shot until the visitor pans or zooms them, shown in City mode and Inspect, its land shown and hidden with it and its shadow drawn again in that frame (${tropicTurns.count} times), and never taken away in view: ${worst.glides - glidesBefore} glides from its file, from About panned to it and from the opening view dragged toward it, ${tropicWorst.gone} goings (${tropicWorst.unseen} where none of it was drawn the frame before${tropicWorst.gone > tropicWorst.unseen ? `, ${tropicWorst.gone - tropicWorst.unseen} out of view as the camera moved, ${tropicWorst.went.toFixed(1)} px of it in the frame at most` : ''}), kept at rest through ${tropicWorst.drifts} drift frames where a glide left it in view (${kept.join(', ')}); the + button in the opening view ${plus.join(', ')}`;
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
        subjects = { 'town-hall': 'town-hall', airport: 'airport', 'research-studio': 'research-studio', 'city-archive': 'city-archive', 'lius-gate': 'lius-gate', 'corner-park': null },
        // The tropic island too (TROPIC_SEEN: its outline at the water, its roof's and trees' tops, and its
        // shelf and shallows 4.6 past the waterline): it hides only in the last shot and the opening view, so every chapter's frame,
        // the People chapter's (its row, and each home and the residence) among them, must leave it out of
        // sight, on the stages the reading page docks on phones (46% of the screen tall) as well. One frame
        // reaches it: the Life chapter's on a 3440 x 1440 screen, close in on the park (2.2) and 3440 px
        // wide, sees its trees' tops and, at the idle drift's far end, a corner of its sand at the frame's
        // bottom right, at the reading panel's left edge or past it (where the panel stands), never left of
        // it: a corner of the sea-level island beyond the town, as the airport's shows at the opening view's
        // top right, so it is left there (the rule hides it only where a slice of it would stand on its own).
        tropicShape = TROPIC_SEEN,
        people = [['people', plan.chapterSubjects.people], ...plan.chapterSubjects.people.map((id) => ['people:' + id, [id]])];
      const tropicLeast = { gap: Infinity, at: '' };
      const tropicWide = [],
        tropicShelf = new Set(),
        tropicCorner = new Set();
      for (const [w, h, narrow] of [...desktops.map(([w, h]) => [w, h, false]), [768, 1024, true], [820, 1180, true], [390, 844, true], [430, 932, true], [360, 800, true], [390, 388, true], [430, 429, true], [360, 368, true]])
        for (const [chapter, id] of [...Object.entries(subjects), ...people]) {
          const bearing = plan.chapterBearings[chapter.split(':')[0]],
            ofPeople = chapter.startsWith('people');
          frame(w, h, narrow ? 0 : 0.21, bearing);
          view.frameDrop = 0;
          view.panelEdge = narrow ? 1 : edgeOf(w);
          view.overviewFit = false;
          if (id) {
            view.focusedIds = Array.isArray(id) ? [...id] : [id];
            view.target.set(0, 0, 0);
            scene.fitFocused();
          } else {
            view.target.set(plan.park.x, 0, plan.park.z);
            view.targetZoom = 2.2;
            view.target.add(new T.Vector3(Math.cos(bearing), 0, -Math.sin(bearing)).multiplyScalar(((narrow ? 0 : 0.21) * (view.camera.right - view.camera.left)) / 2.2));
          }
          for (const d of drifts) {
            if (!ofPeople && h > 400) assert(!overlaps(hull(shape.map((p) => px(w, h, view.targetZoom, bearing + d, view.target, p))), [0, 0, w, h]), `The reading page's ${chapter} chapter shows the sky island at ${w} x ${h}, drifted ${d.toFixed(2)}.`);
            const south = hull(tropicShape.map((p) => px(w, h, view.targetZoom, bearing + d, view.target, p)));
            if (chapter === 'corner-park' && w > 2560) {
              // (The 3440 px Life frame: its sand, where it is in the frame at all, at the panel's edge or right
              // of it, under the panel: its waterline itself, not the polygon round it that TROPIC_EXTENT draws
              // over its bays. Its natural coast's south-east brings the edge of its beach out from under the
              // panel along the frame's very foot through the drift, 3 px high at most: within 6 px of the foot,
              // or no more than PANEL_CLEAR out from under the panel.)
              const [x0, y0] = box(plan.tropicOutline(0, 480).map((p) => px(w, h, view.targetZoom, bearing + d, view.target, new T.Vector3(p.x, -0.028, p.z)))),
                panel = edgeOf(w) * w;
              assert(y0 >= h - 6 || x0 >= panel - 24, `The reading page's Life chapter at ${w} x ${h}, drifted ${d.toFixed(2)}, shows the tropic island's sand ${(panel - x0).toFixed(0)} px left of the reading panel and ${(h - y0).toFixed(0)} px up from the frame's foot.`);
              tropicWide.push(y0 >= h ? 'tops' : 'sand');
              continue;
            }
            if (w > 2560 && overlaps(south, [0, 0, w, h])) {
              // (A 3440 px frame close in on the archive at the drift's one end: the far edge of its shelf
              // and shallows, and at most a corner of its bound round its land (its tail's beach, fuller
              // on the island's natural coast, and the ring over it as high as its crowns), all of it right
              // of the reading panel's left edge, under the panel, as the Life frame's sand is.)
              const panel = edgeOf(w) * w,
                [x0] = box(TROPIC_EXTENT.map((p) => px(w, h, view.targetZoom, bearing + d, view.target, p)));
              assert(!overlaps(south, [0, 0, panel, h]) && x0 >= panel, `The reading page's ${chapter} chapter at ${w} x ${h}, drifted ${d.toFixed(2)}, shows the tropic island's land or its sea left of the reading panel.`);
              tropicShelf.add(`the ${chapter} chapter's`);
              if (x0 < w) tropicCorner.add(chapter);
              continue;
            }
            assert(!overlaps(south, [0, 0, w, h]), `The reading page's ${chapter} chapter shows the tropic island at ${w} x ${h}, drifted ${d.toFixed(2)}.`);
            // How near it comes: the widest gap between its outline and the frame along any axis that
            // parts them (px; the least over every frame and drift).
            const rect = [[0, 0], [w, 0], [w, h], [0, h]],
              apart = Math.max(
                ...[[1, 0], [0, 1], ...south.map((q, i) => [south[(i + 1) % south.length][1] - q[1], q[0] - south[(i + 1) % south.length][0]])].map(([ax, ay]) => {
                  const l = Math.hypot(ax, ay) || 1,
                    a = south.map(([x, y]) => (x * ax + y * ay) / l),
                    b = rect.map(([x, y]) => (x * ax + y * ay) / l);
                  return Math.max(Math.min(...a) - Math.max(...b), Math.min(...b) - Math.max(...a));
                }),
              );
            if (apart < tropicLeast.gap) Object.assign(tropicLeast, { gap: apart, at: `${chapter} at ${w} x ${h}` });
          }
        }
      tropicNav.reading = `out of sight in every reading chapter's frame through the drift (People's row, homes and residence among them), ${tropicLeast.gap.toFixed(0)} px off the frame at the nearest (${tropicLeast.at}), but the Life chapter's on 3440 x 1440 (its trees' tops at the frame's foot, ${tropicWide.filter((s) => s === 'sand').length} of ${tropicWide.length} drift steps a corner of its sand, at the panel's left edge or along the frame's foot)${tropicShelf.size ? ` and ${[...tropicShelf].join(', ')} there (the far edge of its shelf and shallows at the frame's right edge, right of the reading panel's left edge, at the drift's one end${tropicCorner.size ? ', and a corner of its bound round its land with them, under the panel' : ', its land out of the frame'})` : ''}`;
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
// The town's box as the scene works it out from the plan as the page loads (TOWN_SHADOW: the smallest
// circle round the island, the lighthouse's rock, the airport's island and the tropic island a unit
// past its waterline, and half a unit more), run as written.
const townShadowPieces = [];
(function collectTownShadow(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'enclosingCircle') townShadowPieces.push(node.getText(syntax).replace(/^export\s+/, ''));
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => ['TROPIC_MIDDLE', 'SHADOW_FIT', 'TOWN_SHADOW'].includes(d.name.getText(syntax))))
    townShadowPieces.push(node.getText(syntax).replace(/^export\s+/, ''));
  ts.forEachChild(node, collectTownShadow);
})(syntax);
assert.equal(townShadowPieces.length, 4, 'The town shadow box check must find every piece it runs.');
const { TOWN_SHADOW, SHADOW_FIT, enclosingCircle } = runInNewContext(
  `${ts.transpileModule(townShadowPieces.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};({ TOWN_SHADOW, SHADOW_FIT, enclosingCircle });`,
  { T, Math, plan, TROPIC_EXTENT },
);
const shadowSun = new T.DirectionalLight();
Object.assign(shadowSun.shadow.camera, { left: -46, right: 46, top: 46, bottom: -46 });
shadowSun.shadow.mapSize.set(2048, 2048);
const shadows = {
  T,
  Math,
  TOWN_SHADOW,
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
const redrawn = (what, map = 'new') => {
  if (map === 'new') assert.equal(shadowSun.shadow.map, null, `${what}: the check expects a new map.`);
  else assert.notEqual(shadowSun.shadow.map, null, `${what} threw the map away: one the same size is drawn again in place.`);
  assert(
    shadows.shadowDirty && shadows.renderer.shadowMap.needsUpdate,
    `${what} left the sun with no shadow map until the next scheduled shadow pass.`,
  );
};
// The town's own box, as the scene starts on it (TOWN_SHADOW): the island, the airport's island and
// the tropic island whole, in a map twice the base (3072), the light SHADOW_HOME.reach back along the
// key light.
focusing();
const home = { centre: shadowSun.target.position.clone(), radius: shadowSun.shadow.camera.right, map: shadowSun.shadow.mapSize.x, far: shadowSun.shadow.camera.far, back: shadows.sunBack };
assert(!shadows.shadowInspect && home.centre.equals(TOWN_SHADOW.centre) && home.radius === TOWN_SHADOW.radius && home.map === 3072 && home.far === TOWN_SHADOW.far && home.back === TOWN_SHADOW.reach, 'The town\'s shadow box is not the one worked out from the plan.');
// Sharper than the old box round the island and the airport alone (±46 at 2048: 22.3 texels a unit).
assert(home.map / (2 * home.radius) >= 2048 / 92, `The town's shadows lost their sharpness (${(home.map / (2 * home.radius)).toFixed(2)} texels a unit).`);
// It is the smallest circle round what it holds on the ground plan, and half a unit more: the ground's
// farthest points lie on its rim, at least two of them (the airport's armour at its north-west corner
// and the tropic island a unit past its beach at its south-east), and none
// past it; a brute force over every pair and triple of the ground's hull finds none smaller.
const shadowGround = {
  island: plan.islandOutline.map(([x, z]) => new T.Vector3(x * (1 + 3.3 / Math.hypot(x, z)), 0, z * (1 + 3.3 / Math.hypot(x, z)))),
  rock: [new T.Vector3(plan.lighthouseRock[0], 0, plan.lighthouseRock[1])],
  airport: plan.airportOutline(plan.AIRPORT.armour, 1).map((p) => new T.Vector3(p.x, 0, p.z)),
  tropic: (() => {
    const middle = new T.Vector3(plan.TROPIC.x, 0, plan.TROPIC.z);
    return TROPIC_EXTENT.map((p) => {
      const out = new T.Vector3(p.x - middle.x, 0, p.z - middle.z);
      return out.setLength(out.length() + SHADOW_FIT.past).add(middle);
    });
  })(),
};
{
  const all = Object.values(shadowGround).flat(),
    from = (p) => Math.hypot(p.x - home.centre.x, p.z - home.centre.z),
    rim = home.radius - SHADOW_FIT.edge,
    on = Object.entries(shadowGround).filter(([, points]) => points.some((p) => Math.abs(from(p) - rim) < 1e-6)).map(([name]) => name);
  assert(all.every((p) => from(p) <= rim + 1e-6) && on.includes('airport') && on.includes('tropic'), `The town's shadow box (${home.radius.toFixed(2)} round ${home.centre.x.toFixed(2)}, ${home.centre.z.toFixed(2)}) does not sit on the airport's armour and the tropic island (${on.join(', ')} on its rim).`);
  // (The ground's hull, then every circle on two or three of its points that holds it all: none smaller.)
  const flat = all.map((p) => ({ x: p.x, z: p.z })),
    hull = (() => {
      const sorted = [...flat].sort((a, b) => a.x - b.x || a.z - b.z),
        cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x),
        half = (list) => {
          const out = [];
          for (const p of list) {
            while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
            out.push(p);
          }
          out.pop();
          return out;
        };
      return [...half(sorted), ...half([...sorted].reverse())];
    })();
  let least = Infinity;
  for (let i = 0; i < hull.length; i++)
    for (let j = i + 1; j < hull.length; j++) {
      const two = enclosingCircle([hull[i], hull[j]]);
      if (flat.every((p) => Math.hypot(p.x - two.x, p.z - two.z) <= two.r + 1e-6)) least = Math.min(least, two.r);
      for (let k = j + 1; k < hull.length; k++) {
        const three = enclosingCircle([hull[i], hull[j], hull[k]]);
        if (flat.every((p) => Math.hypot(p.x - three.x, p.z - three.z) <= three.r + 1e-6)) least = Math.min(least, three.r);
      }
    }
  assert(Math.abs(least - rim) < 1e-6, `The town's shadow box (${rim.toFixed(3)} before its edge) is not the smallest circle round its ground (${least.toFixed(3)}).`);
}
// The box holds, for every sun and yaw, everything a shadow falls from or on, in the light's own
// projection (a DirectionalLight placed as placeSun places it, its shadow camera as the scene sets it):
// the island to its waterline, the lighthouse's rock, the airport's island to its armour's toe and the
// tower's mast, and the tropic island (its extent and its crowns' ring 0.7 past its waterline, a palm
// leaning out as far as town-tropic allows), each lifted as high as the Town Hall's roof (10) and sunk
// half a unit under the water, inside the square the light sees, 0.4 inside its rim at least (a dozen
// texels: the filter's taps never reach it), and between the near plane and the far, in the key light
// at every bearing and height it takes (city-atmosphere's sunOffsetFor: 40 to 57 degrees up).
{
  const held = [
      ...shadowGround.island,
      ...shadowGround.rock,
      ...shadowGround.airport,
      new T.Vector3(3.9, 7, -47.4),
      ...TROPIC_EXTENT,
      ...TROPIC_SEEN.filter((p) => p.y >= 0.5),
    ].flatMap((p) => [p.clone().setY(-0.5), p.clone(), p.clone().setY(10)]),
    light = new T.DirectionalLight(),
    ndc = new T.Vector3();
  Object.assign(light.shadow.camera, { left: -home.radius, right: home.radius, top: home.radius, bottom: -home.radius, near: 0.5, far: home.far });
  light.shadow.camera.updateProjectionMatrix();
  light.target.position.copy(home.centre);
  light.target.updateMatrixWorld();
  let rim = Infinity,
    nearest = Infinity,
    deepest = -Infinity,
    suns = 0;
  for (const up of [40, 45, 50, 55, 57.3].map((d) => (d * Math.PI) / 180))
    for (let a = 0; a < 2 * Math.PI - 1e-9; a += Math.PI / 90) {
      const toLight = new T.Vector3(Math.cos(up) * Math.sin(a), Math.sin(up), Math.cos(up) * Math.cos(a));
      light.position.copy(home.centre).addScaledVector(toLight, home.back);
      light.updateMatrixWorld();
      light.shadow.updateMatrices(light);
      suns++;
      for (const p of held) {
        ndc.copy(p).applyMatrix4(light.shadow.camera.matrixWorldInverse);
        const depth = -ndc.z;
        nearest = Math.min(nearest, depth);
        deepest = Math.max(deepest, depth);
        rim = Math.min(rim, (1 - Math.max(Math.abs(ndc.x), Math.abs(ndc.y)) / home.radius) * home.radius);
      }
    }
  assert(rim >= 0.4 && nearest > 0.5 && deepest < home.far, `In ${suns} suns the town's shadow box keeps what it holds ${rim.toFixed(2)} inside its rim, ${nearest.toFixed(1)} to ${deepest.toFixed(1)} from the light (its near plane 0.5, its far one ${home.far}).`);
  tropicNav.shadow = `the town's shadow box ${home.radius.toFixed(2)} round (${home.centre.x.toFixed(2)}, ${home.centre.z.toFixed(2)}), the smallest circle round the island, the airport's and the tropic island a unit past its beach and half a unit more, ${(home.map / (2 * home.radius)).toFixed(1)} texels a unit (${(2048 / (2 * home.radius)).toFixed(1)} on the low tier; 22.3 and 16.7 in the old box), everything it holds ${rim.toFixed(2)} inside its rim and ${nearest.toFixed(1)} to ${deepest.toFixed(1)} from the light in ${suns} suns`;
}
drawn();
focusing(new T.Vector3(6, 2, -4), 9);
// Inspect frames its building in a box of its own, in a map twice the old base (3072, the town's own
// size now, so the box moves and the map is drawn again in place), and it says so outright.
redrawn('Entering Inspect', 'kept');
assert(shadows.shadowInspect && shadowSun.shadow.mapSize.x === 3072 && shadowSun.shadow.camera.right === 9 && shadows.sunBack === 0, 'Inspect\'s shadow map is not its own.');
drawn();
focusing();
redrawn('Leaving Inspect', 'kept');
assert(!shadows.shadowInspect && shadowSun.target.position.equals(home.centre) && shadowSun.shadow.camera.right === home.radius && shadowSun.shadow.camera.far === home.far && shadows.sunBack === home.back, 'Leaving Inspect does not put the sun back on the town\'s box.');
drawn();
focusing();
assert(!shadows.renderer.shadowMap.needsUpdate, 'An unchanged focus costs no extra shadow pass.');
shadows.quality = 2;
focusing();
redrawn('A quality step');
assert.equal(shadowSun.shadow.mapSize.x, 1536, 'A quality step does not halve the town\'s map.');
focusing(new T.Vector3(6, 2, -4), 9);
assert.equal(shadowSun.shadow.mapSize.x, 1536, 'A quality step does not halve Inspect\'s map.');
// The low tier: twice its base too (2048), 16.3 texels a unit (16.7 in the old box at 1536: a fiftieth
// softer, where the high tier's 24.5 is a tenth sharper than its old 22.3).
{
  const low = { ...shadows, tier: 'low', shadowBase: 1024, quality: 0, sun: new T.DirectionalLight() },
    lowFocus = runInNewContext(`${ts.transpileModule(shadowPieces.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText};shadowFocus;`, low);
  lowFocus();
  assert(low.sun.shadow.mapSize.x === 2048 && low.sun.shadow.mapSize.x / (2 * low.sun.shadow.camera.right) > 16, `The low tier's town shadows lost their sharpness (${(low.sun.shadow.mapSize.x / (2 * low.sun.shadow.camera.right)).toFixed(2)} texels a unit).`);
}
// The box's depth runs from about 7 to 108 from the light: a near plane of 0.5 keeps all of it. The
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
  `Navigation checks passed: ${ids.length} shared records in both modes, legacy/back-navigation targets, ${nav.readingChapters.length} reading chapters with Departures (the airport's, framed on its island) right after People, a tour of ${nav.tourStops.length} stops ending in the park, the sky island out of the opening view and every reading frame but those that hide it, in City mode's overview (${skyNav.overview}) and whole in its own file ${skyNav.file} through the drift, ${skyNav.rotate}, ${skyNav.rotatePanned}, ${skyNav.sideways}, ${skyNav.pocket}, ${skyNav.zoomWalk}, ${skyNav.shadow}, ${skyNav.turns}, ${skyNav.wide}, ${skyNav.hero}, ${Object.keys(personPhotos).length} portrait slots (${nav.people.length} members), hidden/visible camera resizing, quick Rotate presses that keep their way round, +/- during a glide, a pan limit held on the view's ground point through real OrbitControls (no jumps, no pull when a glide hands over), a sea past every zoomed-out frame, a plane that leaves and comes back out of every standard frame, an eased zoom out of Inspect, no idle drift with reduced motion and a drift that stops where it is, a motion preference followed while the page is open, a sun shadow redrawn whenever its map is replaced, a quality governor that climbs back after a slow moment, no frame before the first sky, windows put on the clock after hours without frames, a moon that turns with the camera, a studio light baked again after a lost GPU context.`,
);
console.log(`And: ${Object.values(laneD3).join('; ')}.`);
console.log(
  `The tropic island: City mode's overview at the opening bearing (its fit without the tropic island, then with it) ${tropicNav.fits.join(', ')}; ${tropicNav.overview}; ${tropicNav.file}; ${tropicNav.pan}; ${tropicNav.plane}; ${tropicNav.hero}; ${tropicNav.reading}; ${tropicNav.shadow}.`,
);
