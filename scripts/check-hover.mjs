import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Script, createContext, runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as T from 'three';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// What the later checks found, for the summary.
const hoverPins = [];
const compile = (s) =>
  ts.transpileModule(s, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
const api = {};
runInNewContext(
  compile(await fs.readFile(path.join(root, 'app/city-hover.ts'), 'utf8')),
  { exports: api },
);
const source = await fs.readFile(path.join(root, 'app/city-scene.ts'), 'utf8');
const syntax = ts.createSourceFile(
  'scene.ts',
  source,
  ts.ScriptTarget.Latest,
  true,
);
const names = [
  'pickTarget',
  'pickAt',
  'down',
  'strayed',
  'up',
  'move',
  'clearHover',
  'leave',
  'updateHover',
  'subjectBox',
];
const functions = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    functions.set(node.name.text, node.getText(syntax).replace(/^export /, ''));
  ts.forEachChild(node, visit);
}
visit(syntax);
assert.equal(functions.size, names.length);
function target() {
  const handlers = new Map();
  return {
    style: {},
    addEventListener: (name, fn) => handlers.set(name, fn),
    emit: (name, e) => handlers.get(name)?.(e),
  };
}
const camera = new T.OrthographicCamera(-8, 8, 5, -5, 0.1, 100);
camera.position.set(0, 8, 12);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
const models = new Map(
  ['town-hall', 'qin-li'].map((id, i) => {
    const root = new T.Group();
    root.userData.buildingId = id;
    root.position.x = -2 + i * 4;
    root.add(
      new T.Mesh(new T.BoxGeometry(1.5, 2, 1.5), new T.MeshBasicMaterial()),
    );
    root.updateMatrixWorld(true);
    return [id, { root }];
  }),
);
const parkHit = new T.Mesh(new T.BoxGeometry(1.5, 0.2, 1.5));
parkHit.position.set(0, 0, 3);
parkHit.userData.placeId = 'corner-park';
parkHit.updateMatrixWorld();
// The sky island: no building model, but a root of its own and a pointer volume beside it (as
// addSkyHit makes one), floating clear of the ground and a little bigger than what it holds.
const skyAt = new T.Vector3(-5.5, 3, -1),
  skyRoot = new T.Group(),
  skyHit = new T.Group();
skyRoot.userData.buildingId = skyHit.userData.buildingId = 'sky-island';
skyRoot.position.copy(skyAt);
skyRoot.add(new T.Mesh(new T.BoxGeometry(1.2, 0.8, 1.2), new T.MeshBasicMaterial()));
skyRoot.updateMatrixWorld(true);
skyHit.add(new T.Mesh(new T.BoxGeometry(1.6, 1.2, 1.6), new T.MeshBasicMaterial({ visible: false })));
skyHit.children[0].position.copy(skyAt);
skyHit.updateMatrixWorld(true);
const labels = [...models.keys(), 'corner-park', 'sky-island'].map((id) => ({
  b: { id },
  element: {
    offsetWidth: 240,
    offsetHeight: 70,
    style: { visibility: 'hidden' },
  },
}));
const selection = [];
const h = {
  T,
  ...api,
  camera,
  models,
  parkHit,
  skyPick: { hit: skyHit, root: skyRoot },
  labels,
  hover: api.hoverPointer(),
  width: 800,
  height: 500,
  inspect: null,
  inViewport: true,
  // The reading page's labels unless a check says City mode (subjectBox's: the toy island's silhouette
  // is its box's corners, and it has no clouds or rocks).
  cityMode: false,
  frameShift: 0,
  frameDrop: 0,
  subjectPoints: new Map(),
  subjectAt: new T.Vector3(),
  SKY_MARKS: [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => skyAt.clone().add(new T.Vector3(0.6 * x, 0.4 * y, 0.6 * z))))),
  plan: { SKY_CLOUDS: [], SKY_ROCKS: [] },
  ray: new T.Raycaster(),
  mouse: new T.Vector2(),
  downX: 0,
  downY: 0,
  multiPointer: false,
  travelled: false,
  activePointers: new Set(),
  container: {
    getBoundingClientRect: () => ({
      left: 42,
      top: 20,
      width: 800,
      height: 500,
    }),
  },
  renderer: { domElement: target() },
  document: { ...target(), hidden: false },
  window: target(),
  onSelect: (id) => selection.push(id),
  onPark: () => selection.push('corner-park'),
};
const code = [...functions.values()].join('\n');
const registration = source.slice(
  source.indexOf(
    "  renderer.domElement.addEventListener('pointerdown', down);",
  ),
  source.indexOf('  function frame(now:'),
);
const f = runInNewContext(
  compile(code) + '\n' + registration + '\n({' + names.join(',') + '});',
  h,
);
const visible = () =>
  labels
    .filter((l) => l.element.style.visibility === 'visible')
    .map((l) => l.b.id);
function eventAt(id, extra = {}) {
  const at = id.isVector3 ? id : id === 'corner-park' ? parkHit.position : id === 'sky-island' ? skyAt : models.get(id).root.position;
  const v = at.clone().project(camera);
  return {
    clientX: 42 + (v.x * 0.5 + 0.5) * 800,
    clientY: 20 + (-v.y * 0.5 + 0.5) * 500,
    pointerType: 'mouse',
    pointerId: 1,
    buttons: 0,
    button: 0,
    ...extra,
  };
}
const emit = (name, e) => h.renderer.domElement.emit(name, e);
f.updateHover();
assert.deepEqual(visible(), [], 'Labels must start hidden.');
for (const id of [...models.keys(), 'corner-park', 'sky-island']) {
  emit('pointermove', eventAt(id));
  f.updateHover();
  assert.deepEqual(visible(), [id], 'Only the raycast hit may be named.');
  assert.equal(h.renderer.domElement.style.cursor, 'pointer');
}
// The sky island answers on itself and within its volume's slack, and the open sky beside it,
// over it and under it (between it and the ground it floats over) does not.
{
  const within = eventAt(skyAt.clone().add(new T.Vector3(0.7, 0, 0)));
  h.ray.setFromCamera(new T.Vector2(((within.clientX - 42) / 800) * 2 - 1, (-(within.clientY - 20) / 500) * 2 + 1), camera);
  assert(h.ray.intersectObject(skyRoot, true).length === 0 && h.ray.intersectObject(skyHit, true).length > 0, 'The check points at no slack round the sky island.');
  emit('pointermove', within);
  f.updateHover();
  assert.deepEqual(visible(), ['sky-island'], 'The sky island must answer within the slack of its own volume.');
  for (const [dx, dy] of [[-1.9, 0], [1.9, 0], [0, 1.9], [0, -2.1]]) {
    emit('pointermove', eventAt(skyAt.clone().add(new T.Vector3(dx, dy, 0))));
    f.updateHover();
    assert.deepEqual(visible(), [], `The open sky ${dx}, ${dy} from the sky island must name nothing.`);
    assert.equal(h.renderer.domElement.style.cursor, 'grab');
  }
  // A click on it opens it; hidden (the frames that would cut it), it answers neither the pointer nor a click.
  const on = eventAt('sky-island');
  emit('pointerdown', on);
  emit('pointerup', on);
  assert.deepEqual(selection.splice(0), ['sky-island'], 'A click on the sky island must open it.');
  skyRoot.visible = false;
  emit('pointermove', on);
  f.updateHover();
  assert.deepEqual(visible(), [], 'Hidden, the sky island must name nothing.');
  emit('pointerdown', on);
  emit('pointerup', on);
  assert.deepEqual(selection, [], 'Hidden, the sky island must not open.');
  skyRoot.visible = true;
}
// The tropic island: a building model of the town's whose ground answers for it, as addHitBoxes
// hangs it (an elliptic slab of the island's waterline, no taller than its lawn, on its building's
// box): the pointer on its lawn or its beach names it and a click opens it; the open sea beside it
// does not; and hidden (its root not drawn: the scene leaves the island out of the opening view), it
// answers neither the pointer nor a click. The toy island's own model and label join the town only
// for this.
{
  const at = new T.Vector3(4.6, 0, -1.6),
    root = new T.Group(),
    hit = new T.Mesh(new T.BoxGeometry(0.8, 1.4, 0.6), new T.MeshBasicMaterial({ visible: false })),
    ground = new T.Mesh(new T.CylinderGeometry(1, 1, 0.3, 32).scale(1.6, 1, 1.2), hit.material);
  root.userData.buildingId = hit.userData.buildingId = ground.userData.buildingId = 'tropic-island';
  root.position.copy(at);
  root.add(new T.Mesh(new T.BoxGeometry(0.7, 1.2, 0.5), new T.MeshBasicMaterial()));
  root.children[0].position.set(0, 0.75, -0.3);
  hit.position.set(at.x, 0.75, at.z - 0.3);
  ground.position.set(0, 0.15 - 0.75, 0.3);
  hit.add(ground);
  root.updateMatrixWorld(true);
  hit.updateMatrixWorld(true);
  const island = { root, hit },
    label = { b: { id: 'tropic-island' }, element: { offsetWidth: 240, offsetHeight: 70, style: { visibility: 'hidden' } } },
    town = h.models;
  h.models = new Map([...town, ['tropic-island', island]]);
  labels.push(label);
  const lawn = eventAt(at.clone().add(new T.Vector3(-1.1, 0.3, 0.45))),
    sea = eventAt(at.clone().add(new T.Vector3(0, 0, 1.9)));
  h.ray.setFromCamera(new T.Vector2(((lawn.clientX - 42) / 800) * 2 - 1, (-(lawn.clientY - 20) / 500) * 2 + 1), camera);
  assert(h.ray.intersectObject(root, true).length === 0 && h.ray.intersectObject(hit, true).length > 0, 'The check points at no lawn of the tropic island.');
  emit('pointermove', lawn);
  f.updateHover();
  assert.deepEqual(visible(), ['tropic-island'], 'The tropic island must answer on its lawn.');
  emit('pointerdown', lawn);
  emit('pointerup', lawn);
  assert.deepEqual(selection.splice(0), ['tropic-island'], 'A click on the tropic island\'s lawn must open it.');
  emit('pointermove', sea);
  f.updateHover();
  assert.deepEqual(visible(), [], 'The open sea beside the tropic island must name nothing.');
  root.visible = false;
  for (const e of [lawn, eventAt(at.clone().add(new T.Vector3(0, 0.75, -0.3)))]) {
    emit('pointermove', e);
    f.updateHover();
    assert.deepEqual(visible(), [], 'Hidden, the tropic island must name nothing.');
    emit('pointerdown', e);
    emit('pointerup', e);
    assert.deepEqual(selection, [], 'Hidden, the tropic island must not open.');
  }
  root.visible = true;
  labels.pop();
  h.models = town;
  hoverPins.push('the tropic island on its own ground (its lawn, not the sea beside it) and not while hidden');
}
emit('pointermove', {
  clientX: 43,
  clientY: 21,
  pointerType: 'mouse',
  buttons: 0,
});
f.updateHover();
assert.deepEqual(visible(), [], 'Empty land must hide the prior label.');
const e = eventAt('town-hall');
emit('pointermove', e);
f.updateHover();
emit('pointerdown', e);
assert.deepEqual(visible(), [], 'Dragging must clear immediately.');
emit('pointermove', { ...e, clientX: e.clientX + 30, buttons: 1 });
f.updateHover();
assert.deepEqual(visible(), []);
emit('pointerup', { ...e, clientX: e.clientX + 30 });
assert.deepEqual(selection, [], 'A camera drag must not select.');
f.updateHover();
assert.deepEqual(
  visible(),
  [],
  'Ending a drag must not resurrect a stale label.',
);
for (const name of ['pointerleave', 'pointercancel']) {
  emit('pointermove', e);
  f.updateHover();
  emit(name, e);
  f.updateHover();
  assert.deepEqual(visible(), []);
}
for (const [target, name] of [
  [h.window, 'blur'],
  [h.document, 'visibilitychange'],
]) {
  emit('pointermove', e);
  f.updateHover();
  target.emit(name);
  assert.deepEqual(visible(), []);
}
for (const field of ['inspect', 'inViewport']) {
  emit('pointermove', e);
  h[field] = field === 'inspect' ? {} : false;
  f.updateHover();
  assert.deepEqual(visible(), []);
  h[field] = field === 'inspect' ? null : true;
}
h.document.hidden = true;
f.updateHover();
assert.deepEqual(visible(), []);
h.document.hidden = false;
for (const id of ['town-hall', 'corner-park']) {
  const touch = eventAt(id, { pointerType: 'touch' });
  emit('pointermove', touch);
  f.updateHover();
  assert.deepEqual(visible(), []);
  emit('pointerdown', touch);
  emit('pointerup', touch);
}
assert.deepEqual(
  selection,
  ['town-hall', 'corner-park'],
  'Touch still opens a building or the park.',
);
const first = eventAt('town-hall', { pointerType: 'touch', pointerId: 1 }),
  second = eventAt('qin-li', { pointerType: 'touch', pointerId: 2 });
emit('pointerdown', first);
emit('pointerdown', second);
emit('pointerup', second);
emit('pointerup', first);
assert.equal(
  selection.length,
  2,
  'Pinching must never open a building on finger release.',
);
// A fingertip may wobble up to 10 px and still pick; a mouse that moves 8 px is panning.
for (const [pointerType, dx, picks] of [
  ['touch', 8, true],
  ['touch', 12, false],
  ['mouse', 4, true],
  ['mouse', 8, false],
]) {
  const start = eventAt('town-hall', { pointerType }),
    before = selection.length;
  emit('pointerdown', start);
  emit('pointerup', { ...start, clientX: start.clientX + dx });
  assert.equal(
    selection.length - before,
    picks ? 1 : 0,
    `A ${pointerType} press that moves ${dx} px must ${picks ? '' : 'not '}pick.`,
  );
}
// A pan that wanders off and comes back to within the slop before letting go is still a pan.
for (const pointerType of ['touch', 'mouse']) {
  const start = eventAt('town-hall', { pointerType }),
    before = selection.length;
  emit('pointerdown', start);
  emit('pointermove', { ...start, clientX: start.clientX + 100, buttons: 1 });
  emit('pointermove', { ...start, clientX: start.clientX + 2, buttons: 1 });
  emit('pointerup', { ...start, clientX: start.clientX + 2 });
  assert.equal(
    selection.length,
    before,
    `A ${pointerType} pan out and back must not pick.`,
  );
  // The next press starts afresh: a tap still picks.
  emit('pointerdown', start);
  emit('pointerup', start);
  assert.equal(selection.length, before + 1, `A ${pointerType} tap after a pan must pick.`);
}
assert.equal(f.pickAt(41, 200), null);
assert.equal(f.pickAt(850, 200), null);

for (const [width, height] of [
  [280, 200],
  [390, 844],
  [844, 390],
  [1440, 900],
  [2560, 600],
])
  for (const [x, y] of [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
    [width / 2, height / 2],
  ]) {
    const p = api.labelPosition(
      { x, y },
      { width: 240, height: 70 },
      { width, height },
    );
    assert(
      p.x >= 10 &&
        p.y >= 10 &&
        p.x + 240 <= width - 10 &&
        p.y + 70 <= height - 10,
      'Tooltip must stay within the viewport.',
    );
  }
const css = await fs.readFile(path.join(root, 'app/globals.css'), 'utf8');
assert(
  /\.building-hover-label\s*\{[^}]*pointer-events:\s*none/.test(css),
  'The label must not intercept clicks or trigger hover loops.',
);
// City mode keeps a place's label off the place (the art review's fourth finding: in City mode's
// overview the label and the caption's chip both covered the sky island's villa). A label that would
// cover its place goes beside it, 12 px clear, the first way that fits in the view: right of it,
// below it, left of it, above it, in line with where the pointer put it. A place filling the view
// keeps the pointer's place, and a label already clear of its place stays where it was.
{
  const label = { width: 195, height: 57 },
    covers = (p, s) => p.x < s.right && p.x + label.width > s.left && p.y < s.bottom && p.y + label.height > s.top,
    inside = (p, v) => p.x >= 10 && p.y >= 10 && p.x + label.width <= v.width - 10 && p.y + label.height <= v.height - 10,
    // (labelPosition runs in a context of its own: its objects are compared by their fields.)
    same = (a, b) => a.x === b.x && a.y === b.y,
    // City mode's overview at 1440 x 900 beside the file (its left edge at 964): the island, the pointer on its villa.
    view = { width: 964, height: 900 },
    island = { left: 207, top: 83, right: 392, bottom: 246 },
    plain = api.labelPosition({ x: 300, y: 140 }, label, view);
  assert(covers(plain, island), 'The label check must start from a label on its place.');
  assert(same(api.labelPosition({ x: 300, y: 140 }, label, view, island), { x: island.right + 12, y: plain.y }), 'Over the sky island in City mode\'s overview, its label does not go right of it, at the pointer\'s height.');
  const below = { left: 700, top: 300, right: 900, bottom: 500 },
    left = { left: 500, top: 600, right: 900, bottom: 880 };
  assert.equal(api.labelPosition({ x: 800, y: 400 }, label, view, below).y, below.bottom + 12, 'With no room right of its place, the label does not go below it.');
  assert.equal(api.labelPosition({ x: 700, y: 700 }, label, view, left).x, left.left - 12 - label.width, 'With no room right of its place or below it, the label does not go left of it.');
  assert(same(api.labelPosition({ x: 400, y: 400 }, label, view, { left: 0, top: 0, right: 964, bottom: 900 }), api.labelPosition({ x: 400, y: 400 }, label, view)), 'A place filling the view moves its label.');
  assert(same(api.labelPosition({ x: 418, y: 382 }, label, view, { left: 380, top: 380, right: 420, bottom: 420 }), api.labelPosition({ x: 418, y: 382 }, label, view)), 'A label clear of its place moves.');
  // Swept over places of every size about the view, the pointer on each: always in the view, and on
  // its place only where none of the four sides has room.
  let swept = 0;
  for (const [vw, vh] of [[964, 900], [1440, 900], [804, 800], [375, 667]])
    for (let l = -40; l < vw; l += vw / 9)
      for (let t = -40; t < vh; t += vh / 8)
        for (const [w, h] of [[30, 30], [180, 160], [420, 380], [0.8 * vw, 0.8 * vh]]) {
          const s = { left: l, top: t, right: Math.min(vw + 20, l + w), bottom: Math.min(vh + 20, t + h) },
            v = { width: vw, height: vh },
            pointer = { x: Math.min(vw - 1, Math.max(1, (s.left + s.right) / 2)), y: Math.min(vh - 1, Math.max(1, (s.top + s.bottom) / 2)) },
            at = api.labelPosition(pointer, label, v),
            p = api.labelPosition(pointer, label, v, s),
            room = [
              { x: s.right + 12, y: at.y },
              { x: at.x, y: s.bottom + 12 },
              { x: s.left - 12 - label.width, y: at.y },
              { x: at.x, y: s.top - 12 - label.height },
            ].find((q) => inside(q, v));
          swept++;
          assert(inside(p, v) || (p.x === at.x && p.y === at.y), `A label for a place at ${s.left}, ${s.top} in a ${vw} x ${vh} view leaves the view.`);
          assert(covers(at, s) ? (room ? !covers(p, s) && p.x === room.x && p.y === room.y : p.x === at.x && p.y === at.y) : p.x === at.x && p.y === at.y, `A label for a place at ${s.left}, ${s.top} (${w} x ${h}) in a ${vw} x ${vh} view lands at ${p.x}, ${p.y}.`);
        }
  // Through the scene's own hover (updateHover, subjectBox) on the toy town: in City mode no label lands
  // on its place, beside the file or not; on the reading page every label is where the pointer puts it.
  const placeOf = (id) => {
      const t = labels.find((l) => l.b.id === id).element.style.transform,
        [, x, y] = /translate\((-?\d+)px,(-?\d+)px\)/.exec(t);
      return { x: Number(x), y: Number(y) };
    },
    toy = { width: 240, height: 70 };
  let kept = 0;
  for (const [cityMode, frameShift, frameDrop] of [[true, 0, 0], [true, 0.17, 0], [true, 0, -0.2], [false, 0, 0]]) {
    Object.assign(h, { cityMode, frameShift, frameDrop });
    for (const id of [...models.keys(), 'corner-park', 'sky-island']) {
      const e = eventAt(id);
      emit('pointermove', e);
      f.updateHover();
      const p = placeOf(id),
        free = cityMode && frameShift ? 800 * (1 - 2 * frameShift) + 16 : 800,
        // Above a sheet: its top as the frame drop gives it (fileFrame centres the drop between the
        // masthead's 58 px foot and the sheet's top).
        foot = cityMode && frameDrop ? 500 * (1 + 2 * frameDrop) - 58 : 500,
        plainAt = api.labelPosition({ x: e.clientX - 42, y: e.clientY - 20 }, toy, { width: free, height: foot }),
        s = f.subjectBox(id);
      assert(s && s.right > s.left && s.bottom > s.top, `The scene finds no box on screen for ${id}.`);
      if (cityMode) {
        kept++;
        assert(p.x + toy.width <= free - 10 + 0.5 && p.y + toy.height <= foot - 10 + 0.5 && !(p.x < s.right && p.x + toy.width > s.left && p.y < s.bottom && p.y + toy.height > s.top), `In City mode${frameShift ? ' beside the file' : frameDrop ? ' above the sheet' : ''} the label for ${id} lands at ${p.x}, ${p.y} on its place (${[s.left, s.top, s.right, s.bottom].map((n) => n.toFixed(0)).join(', ')}), under the file or under the sheet.`);
      } else assert(same(p, { x: Math.round(plainAt.x), y: Math.round(plainAt.y) }), `On the reading page the label for ${id} moves.`);
    }
  }
  Object.assign(h, { cityMode: false, frameShift: 0, frameDrop: 0 });
  emit('pointerleave', eventAt('town-hall'));
  f.updateHover();
  // One label for a place at a time: City mode hides the caption's chip for the place under the pointer
  // (still read out: hidden by clipping in the live region, not removed); Inspect's chip still shows.
  const stage = await fs.readFile(path.join(root, 'app/city-stage.tsx'), 'utf8'),
    hidden = /\n\.is-explore \.stage-caption \.hover-chip\[data-pointed\] \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert(
    /<div className="caption-live" aria-live="polite">\s*\{caption && \(\s*<span className="hover-chip" data-pointed>/.test(stage) &&
      /clip-path: inset\(50%\);/.test(hidden) &&
      /width: 1px;/.test(hidden) &&
      !/display:\s*none|visibility:\s*hidden|opacity:\s*0/.test(hidden),
    'In City mode the caption\'s chip for the place under the pointer still shows beside its label, or is no longer read out.',
  );
  hoverPins.push(`labels beside their places (${swept} placements swept, ${kept} City mode hovers), one label a place in City mode`);
}
// Each hover mounts a new hover chip, and liquid glass gives every chip a refracting rim. The
// chips that have left the page must be let go (no longer observed, their lens filters gone),
// or a long visit keeps every chip it has ever shown.
{
  const glass = {},
    observed = new Set(),
    filters = [],
    frames = [];
  let mutated = () => {};
  const svgNode = () => ({
    setAttribute() {},
    appendChild() {},
    remove() {
      this.removed = true;
    },
  });
  const chip = () => ({
    isConnected: true,
    offsetWidth: 120,
    offsetHeight: 30,
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
  });
  const page = [chip()];
  runInNewContext(compile(await fs.readFile(path.join(root, 'app/liquid-glass.ts'), 'utf8')), {
    exports: glass,
    window: { setTimeout },
    navigator: { userAgentData: { brands: [{ brand: 'Chromium' }] } },
    matchMedia: () => ({ matches: false }),
    document: {
      body: { appendChild() {} },
      createElementNS(_ns, tag) {
        const n = svgNode();
        if (tag === 'filter') filters.push(n);
        return n;
      },
      createElement: () => ({
        getContext: () => ({ putImageData() {} }),
        toDataURL: () => 'data:image/png;base64,',
      }),
      querySelectorAll: () => page.filter((el) => el.isConnected),
    },
    ResizeObserver: class {
      observe(el) {
        observed.add(el);
      }
      unobserve(el) {
        observed.delete(el);
      }
      disconnect() {
        observed.clear();
      }
    },
    MutationObserver: class {
      constructor(callback) {
        mutated = callback;
      }
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (callback) => frames.push(callback),
    cancelAnimationFrame() {},
    getComputedStyle: () => ({ borderTopLeftRadius: '15px' }),
    ImageData: class {
      constructor(w, h) {
        this.data = new Uint8ClampedArray(w * h * 4);
      }
    },
    Image: class {
      decode() {
        return Promise.resolve();
      }
    },
    setTimeout,
    clearTimeout,
  });
  const settle = async () => {
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
  };
  const stopGlass = glass.installLiquidGlass('.hover-chip');
  await settle();
  for (let hover = 0; hover < 40; hover++) {
    page.at(-1).isConnected = false;
    page.push(chip());
    mutated();
    frames.splice(0).forEach((frame) => frame());
    await settle();
  }
  assert.deepEqual(
    [...observed],
    [page.at(-1)],
    `Liquid glass still observes ${observed.size - 1} hover chips that have left the page.`,
  );
  assert.equal(
    filters.filter((f) => !f.removed).length,
    1,
    'Only the chip on the page keeps a lens filter.',
  );
  stopGlass();
}
// The ring a hover or a selection draws (app/city-ink.ts) is a one-pixel line round a mask of the
// building: its pixels where the beauty pass's depth says it is in front. That depth is a
// multisampled buffer's resolve, one sample's depth taken off the pixel centre, and the mask's
// fragments sit on the centre. With a fixed tolerance every face nearer at that sample than at the
// centre dropped out of the mask, and a part standing proud of another (a balcony, the coping)
// lost the pixels where it covers the sample but not the centre; the ring then drew gold squiggles
// across the building's own faces (the sky island's rock and villa, worst on phones, and the Town
// Hall). A pixel test needs a browser, so this holds the ink to the fix by what it does, not by how
// its shaders are spelt: the numbers it was tuned to; both mask passes built on the one depth test
// it exports; that test and the centre pass's keep test run on synthetic depths, as JS twins and as
// the shaders themselves; the test drawn with the beauty pass's samples; and a single-sample pass
// keeping the mask to the pixels whose centre the building covers, so the ring outside the
// silhouette stays where it was.
{
  const pass = await import('three/addons/postprocessing/Pass.js');
  const ink = {};
  runInNewContext(compile(await fs.readFile(path.join(root, 'app/city-ink.ts'), 'utf8')), {
    exports: ink,
    require: (id) => ({ three: T, 'three/addons/postprocessing/Pass.js': pass })[id],
  });
  // The numbers, as INK measured them: the fixed bias; the slope factor k = 2 (the resolved sample
  // is up to half a pixel off the centre, so k is at least 0.5; at most 4, or a lamp or a tree before
  // a building no longer counts as in front); and the centre pass keeping a pixel that any one of the
  // test's samples passed (anything over half of R8's smallest step).
  assert.deepEqual(
    [ink.INK_BIAS, ink.INK_SLOPE, ink.INK_KEEP],
    [0.000015, 2, 0.5 / 255],
    'The selection ring’s depth test is not tuned as measured (bias 0.000015, slope factor 2, a pixel kept over half an R8 step): measure the ring again in a browser before changing it.',
  );
  /**
   * A mask pass's fragment shader run as JS on synthetic inputs, enough for the ink's two small ones
   * and the ways they might be rewritten: GLSL's types go, `discard` throws, and the built-ins they
   * read are given. Returns (depth, scene, fwidth, tested) => whether the pass writes the pixel.
   */
  const fragment = (glsl) => {
    const js = glsl
      .replace(/\buniform\s+\w+\s+\w+\s*;/g, '')
      .replace(
        /\b(?:void|bool|float|int|vec[234])\s+(\w+)\s*\(([^)]*)\)\s*\{/g,
        (_, name, params) => `function ${name}(${params.replace(/\b(?:(?:in|const)\s+)*(?:bool|float|int|vec[234])\s+/g, '')}){`,
      )
      .replace(/\b(?:const\s+)?(?:bool|float|int|vec[234])\s+(?=\w+\s*=)/g, 'let ')
      .replace(/\bdiscard\b/g, 'throw discarded');
    const script = new Script('(function(){' + js + '\nmain();})()'),
      context = createContext({ texture2D: (sampler) => ({ r: sampler }), vec4: (...v) => v, resolution: 1, discarded: {} });
    return (depth, scene, fwidth, tested = 0) => {
      Object.assign(context, {
        // fwidth of the fragment's own depth is the slope given; of anything else, no number.
        fwidth: (v) => (v === depth ? fwidth : NaN),
        gl_FragCoord: { z: depth, xy: 0 },
        sceneDepth: scene,
        tested,
        gl_FragColor: null,
      });
      try {
        script.runInContext(context);
      } catch (e) {
        if (e === context.discarded) return false;
        throw e;
      }
      return context.gl_FragColor?.[0] > 0;
    };
  };
  const calls = [];
  let current = null;
  const renderer = {
    capabilities: { maxSamples: 4 },
    shadowMap: { autoUpdate: false },
    getPixelRatio: () => 2,
    getRenderTarget: () => current,
    setRenderTarget: (t) => (current = t),
    getClearColor: (out) => out.set(0, 0, 0),
    getClearAlpha: () => 0,
    setClearColor() {},
    clear() {},
    compileAsync: () => Promise.resolve(),
    render: (s) => calls.push({ target: current, override: s.overrideMaterial ?? null, material: s.material ?? null }),
  };
  const scene = new T.Scene(),
    building = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
  scene.add(building);
  const ring = ink.createCityInk(renderer, scene, new T.OrthographicCamera(), 4);
  ring.resize(390, 844);
  ring.setSelection([building]);
  ring.render();
  assert.equal(calls.length, 4, 'A ringed building draws the beauty pass, the depth test, its pixel centres and the composite.');
  const [beauty, test, keep, composite] = calls;
  for (const [name, call] of [['depth test', test], ['centre pass', keep]])
    assert(
      call.override?.fragmentShader?.includes(ink.INK_DEPTH_TEST),
      `The selection mask's ${name} is not built on the ink's one depth test (INK_DEPTH_TEST).`,
    );
  // What the tests do, on synthetic depths (the depth buffer's 0 to 1; fw, the depth's slope across
  // the pixel): the building's own face, nearer by 0.375·fwidth at the resolved sample than at the
  // centre, is in front; an occluder 4·fwidth in front of it is not, and nor is a pixel behind at its
  // centre that none of the test's samples found in front; but one sample of the beauty pass's in
  // front (a resolve of 1/samples) keeps the pixel. The JS twins say so, and the passes' own shaders,
  // run as JS, do what the twins do: here, and over a sweep of depths and slopes round the slack's edge.
  const samples = beauty.target.samples,
    depthPass = fragment(test.override.fragmentShader),
    centrePass = fragment(keep.override.fragmentShader);
  for (const [what, k, tested, front, kept] of [
    ['its own face, nearer by 0.375·fwidth at the resolved sample', 0.375, 0, true, true],
    ['an occluder 4·fwidth in front', 4, 0, false, false],
    ['behind at its centre, but one of the test’s samples in front', 4, 1 / samples, false, true],
    ['behind at its centre, and no sample in front', 4, 0, false, false],
  ]) {
    const z = 0.5,
      fw = 0.001,
      scene = z - k * fw;
    assert.equal(ink.inkInFront(z, scene, fw), front, `The selection mask's depth test (its JS twin) gets ${what} wrong.`);
    assert.equal(ink.inkKeeps(ink.inkInFront(z, scene, fw), tested), kept, `The selection mask's centre pass (its JS twin) gets ${what} wrong.`);
    assert.equal(depthPass(z, scene, fw), front, `The selection mask's depth test (its shader) gets ${what} wrong.`);
    assert.equal(centrePass(z, scene, fw, tested), kept, `The selection mask's centre pass (its shader) gets ${what} wrong.`);
  }
  for (const fw of [0, 0.00001, 0.0003, 0.001, 0.02])
    for (let k = -8; k <= 8; k += 0.125)
      for (const tested of [0, 1 / 255, 1 / samples, 1]) {
        const z = 0.4,
          scene = z - k * fw;
        // Skip the slack's very edge, where the order of the sums decides.
        if (Math.abs(z - (scene + ink.INK_BIAS + ink.INK_SLOPE * fw)) < 1e-12) continue;
        const front = ink.inkInFront(z, scene, fw);
        assert.equal(depthPass(z, scene, fw), front, `The selection mask's depth test shader and its twin disagree at fwidth ${fw}, the scene ${k}·fwidth nearer.`);
        assert.equal(centrePass(z, scene, fw, tested), ink.inkKeeps(front, tested), `The selection mask's centre pass shader and its twin disagree at fwidth ${fw}, the scene ${k}·fwidth nearer, tested ${tested}.`);
      }
  assert(beauty.target.samples > 1, 'The beauty pass is multisampled.');
  assert.equal(test.target.samples, beauty.target.samples, 'The selection mask’s depth test is drawn with the beauty pass’s samples.');
  assert.equal(keep.target.samples, 0, 'The mask is kept to pixel centres in a single-sample pass.');
  assert.deepEqual(
    [test.target.texture.format, keep.target.texture.format],
    [T.RedFormat, T.RedFormat],
    'The selection mask’s targets hold one channel each: only whether the building is there.',
  );
  assert.equal(keep.override.uniforms.tested.value, test.target.texture, 'The centre pass reads the depth test’s samples.');
  assert.equal(composite.material?.uniforms?.selection?.value, keep.target.texture, 'The composite rings the kept mask.');
  ring.dispose();
  building.geometry.dispose();
  building.material.dispose();
}
// The multisampled depth test is cleared, drawn and resolved only round what is ringed (the final
// integration review's first finding: full-screen, its clear and resolve cost about a millisecond a
// frame at Retina size whatever the place's size): its own scissor (three takes a render target's,
// not the renderer's) holds the ringed meshes' box on screen and INK_SCISSOR_PAD round it, and no
// more than that; the one-sample mask is cleared and drawn whole every frame, so ringing a second
// place never leaves the first's mask behind (its clear scissored to the second's box left the
// first's ring on screen).
{
  const pass = await import('three/addons/postprocessing/Pass.js');
  const ink = {};
  runInNewContext(compile(await fs.readFile(path.join(root, 'app/city-ink.ts'), 'utf8')), {
    exports: ink,
    require: (id) => ({ three: T, 'three/addons/postprocessing/Pass.js': pass })[id],
  });
  const calls = [];
  let current = null;
  const state = () => ({ target: current, scissor: current?.scissorTest ? current.scissor.clone() : null });
  const renderer = {
    capabilities: { maxSamples: 4 },
    shadowMap: { autoUpdate: false },
    getPixelRatio: () => 2,
    getRenderTarget: () => current,
    setRenderTarget: (t) => (current = t),
    getClearColor: (out) => out.set(0, 0, 0),
    getClearAlpha: () => 0,
    setClearColor() {},
    clear: () => calls.push({ what: 'clear', ...state() }),
    compileAsync: () => Promise.resolve(),
    render: (s) => calls.push({ what: 'render', override: s.overrideMaterial ?? null, ...state() }),
  };
  const scene = new T.Scene(),
    camera = new T.OrthographicCamera(-2, 2, 1, -1, 0.1, 100),
    left = new T.Mesh(new T.BoxGeometry(0.4, 0.4, 0.4), new T.MeshBasicMaterial()),
    right = new T.Mesh(new T.BoxGeometry(0.4, 0.4, 0.4), left.material);
  left.position.set(-1.2, 0.3, -5);
  right.position.set(1.1, -0.4, -5);
  scene.add(left, right);
  scene.updateMatrixWorld(true);
  const ring = ink.createCityInk(renderer, scene, camera, 4),
    w = 780,
    h = 422;
  ring.resize(390, 211);
  // Each place's own box on the target (its eight corners as the camera draws them), in device pixels from the bottom.
  const boxOf = (mesh) => {
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const p = new T.Vector3(i & 1 ? 0.2 : -0.2, i & 2 ? 0.2 : -0.2, i & 4 ? 0.2 : -0.2).applyMatrix4(mesh.matrixWorld).project(camera);
      x0 = Math.min(x0, ((p.x + 1) / 2) * w);
      x1 = Math.max(x1, ((p.x + 1) / 2) * w);
      y0 = Math.min(y0, ((p.y + 1) / 2) * h);
      y1 = Math.max(y1, ((p.y + 1) / 2) * h);
    }
    return [x0, y0, x1, y1];
  };
  const holds = (s, [x0, y0, x1, y1], pad) => s.x <= x0 - pad + 1 && s.y <= y0 - pad + 1 && s.x + s.z >= x1 + pad - 1 && s.y + s.w >= y1 + pad - 1,
    // (The scissor's edges are whole pixels: a pixel more either way.)
    within = (s, [x0, y0, x1, y1], pad) => s.x >= x0 - pad - 1.5 && s.y >= y0 - pad - 1.5 && s.x + s.z <= x1 + pad + 1.5 && s.y + s.w <= y1 + pad + 1.5;
  for (const [mesh, other] of [[left, right], [right, left]]) {
    calls.length = 0;
    ring.setSelection([mesh]);
    ring.render();
    const test = calls.filter((c) => c.target?.samples > 0 && c.target?.texture.format === T.RedFormat),
      mask = calls.filter((c) => c.target && c.target.samples === 0 && c.target.texture.format === T.RedFormat);
    assert(test.length === 2 && test.every((c) => c.scissor && holds(c.scissor, boxOf(mesh), ink.INK_SCISSOR_PAD) && within(c.scissor, boxOf(mesh), ink.INK_SCISSOR_PAD)), `The selection mask's depth test is not cleared and drawn within the ringed place's own box on screen (${ink.INK_SCISSOR_PAD} px round it).`);
    assert(!holds(test[0].scissor, boxOf(other), 0), 'The selection mask\'s depth test still covers the place ringed before.');
    assert(mask.length === 2 && mask.every((c) => !c.scissor), 'The selection mask is not cleared and drawn whole: ringing a second place would leave the first\'s ring behind.');
  }
  // Nothing of a ringed place in view: an empty scissor, never one off the target.
  left.position.set(-30, 0, -5);
  scene.updateMatrixWorld(true);
  calls.length = 0;
  ring.setSelection([left]);
  ring.render();
  const off = calls.find((c) => c.target?.samples > 0 && c.scissor);
  assert(off && off.scissor.x >= 0 && off.scissor.y >= 0 && off.scissor.x + off.scissor.z <= w && off.scissor.y + off.scissor.w <= h && off.scissor.z * off.scissor.w === 0, 'A ringed place out of view gives the depth test a scissor off its target.');
  ring.dispose();
  left.geometry.dispose();
  right.geometry.dispose();
  left.material.dispose();
}
console.log(
  'Hover checks passed: real raycasting, one passive label, the sky island on itself and not in the open sky round it nor hidden, empty land, drag, leave, cancel, blur, hidden tab, building inspection, touch selection with a 10 px tap tolerance, pans that come back, five viewport shapes, glass rims let go with the chips that leave the page, and a selection ring whose two mask passes share one depth test, tuned as measured and run on synthetic depths (its JS twins and its shaders agree), drawn at the beauty pass’s samples into one-channel masks, its multisampled test scissored to the ringed place and its mask cleared whole; ' +
    hoverPins.join('; ') +
    '.',
);
