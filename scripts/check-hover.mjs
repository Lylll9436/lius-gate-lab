import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as T from 'three';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  'pickAt',
  'down',
  'up',
  'move',
  'clearHover',
  'leave',
  'updateHover',
];
const functions = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    functions.set(node.name.text, node.getText(syntax));
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
const labels = [...models.keys(), 'corner-park'].map((id) => ({
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
  labels,
  hover: api.hoverPointer(),
  width: 800,
  height: 500,
  inspect: null,
  inViewport: true,
  ray: new T.Raycaster(),
  mouse: new T.Vector2(),
  downX: 0,
  downY: 0,
  multiPointer: false,
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
  const object = id === 'corner-park' ? parkHit : models.get(id).root;
  const v = object.position.clone().project(camera);
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
for (const id of [...models.keys(), 'corner-park']) {
  emit('pointermove', eventAt(id));
  f.updateHover();
  assert.deepEqual(visible(), [id], 'Only the raycast hit may be named.');
  assert.equal(h.renderer.domElement.style.cursor, 'pointer');
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
console.log(
  'Hover checks passed: real raycasting, one passive label, empty land, drag, leave, cancel, blur, hidden tab, interior, touch selection, and five viewport shapes.',
);
