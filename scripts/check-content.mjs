import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  assertCatalog,
  upsertRecord,
  removeRecord,
  validateCatalog,
  migrateCatalog,
} from '../app/content-schema.ts';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  output = path.join(root, 'work/content-check');
await fs.mkdir(output, { recursive: true });
const original = await fs.readFile(path.join(root, 'content/lab.json'), 'utf8'),
  catalog = JSON.parse(original);
assertCatalog(catalog);
for (const visibility of [['published'], { value: 'published' }, null]) {
  const malformed = structuredClone(catalog);
  malformed.people[0].visibility = visibility;
  assert(
    validateCatalog(malformed).some((error) => error.includes('visibility')),
  );
}
const text = (en) => ({ en, zh: '测试内容' });
const person = {
  ...structuredClone(catalog.people[1]),
  id: 'test-member',
  title: text('Test member'),
  buildingId: null,
  order: 20,
  properties: [
    { key: 'method', label: text('Method'), value: text('Spatial statistics') },
  ],
};
let next = upsertRecord(catalog, 'people', person);
const research = {
  id: 'test-study',
  title: text('Test research'),
  summary: text('Test research summary'),
  visibility: 'published',
  order: 1,
  sections: [],
  properties: [],
  links: [{ label: text('Paper'), url: 'https://example.org/paper' }],
  status: 'active',
  people: ['test-member'],
  buildingId: null,
};
next = upsertRecord(next, 'research', research);
const event = {
  id: 'test-event',
  title: text('Test event'),
  summary: text('Test event summary'),
  visibility: 'published',
  order: 1,
  sections: [],
  properties: [],
  links: [],
  date: '2026-09-10',
  category: 'milestone',
  people: ['test-member'],
  image: null,
};
next = upsertRecord(next, 'events', event);
const outputRecord = {
  ...research,
  id: 'test-output',
  title: text('Test output'),
  type: 'paper',
  date: '2026-09-10',
  researchId: 'test-study',
};
const noteRecord = {
  ...outputRecord,
  id: 'test-note',
  title: text('Test note'),
};
next = upsertRecord(next, 'outputs', outputRecord);
next = upsertRecord(next, 'notes', noteRecord);
assert.throws(
  () => removeRecord(next, 'research', 'test-study'),
  /missing or unpublished research/,
);
assert.throws(
  () => upsertRecord(next, 'outputs', { ...outputRecord, type: 'unknown' }),
  /output type/,
);
assert.throws(
  () => upsertRecord(next, 'notes', { ...noteRecord, researchId: 'missing' }),
  /missing or unpublished research/,
);
const legacy = structuredClone(catalog);
legacy.schemaVersion = 1;
delete legacy.outputs;
delete legacy.notes;
assert.deepEqual(migrateCatalog(legacy), catalog);

assert.throws(
  () => removeRecord(next, 'people', 'test-member'),
  /missing or unpublished person/,
);
assert.throws(
  () => upsertRecord(next, 'people', { ...person, visibility: 'draft' }),
  /unpublished person/,
);
assert.throws(
  () => upsertRecord(next, 'events', { ...event, date: '2026-02-31' }),
  /real YYYY/,
);
assert.throws(
  () =>
    upsertRecord(next, 'research', {
      ...research,
      links: [{ label: text('Bad link'), url: 'javascript:alert(1)' }],
    }),
  /HTTPS/,
);
assert(
  validateCatalog({ ...next, people: [...next.people, next.people[0]] }).length,
);
let removed = removeRecord(
  removeRecord(
    removeRecord(
      removeRecord(next, 'outputs', 'test-output'),
      'notes',
      'test-note',
    ),
    'events',
    'test-event',
  ),
  'research',
  'test-study',
);
removed = removeRecord(removed, 'people', 'test-member');
assert.deepEqual(removed, catalog);
assert.equal(
  catalog.people.length,
  3,
  'Pure operations must not mutate original catalog.',
);
await fs.writeFile(path.join(output, 'lab.json'), JSON.stringify(next));
for (const name of [
  'public-asset',
  'content-schema',
  'lab-records',
  'city-data',
  'lab-navigation',
  'people-photos',
  'lab-content',
]) {
  const ext = name === 'lab-content' ? 'tsx' : 'ts';
  const source = await fs.readFile(
    path.join(root, 'app', name + '.' + ext),
    'utf8',
  );
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
    })
    .outputText.replace(/(['"])\.\/([\w-]+)\1/g, "'./$2.mjs'")
    .replace("'../content/lab.json'", "'./lab.json'")
    .replace("'next/image'", "'./image.mjs'");
  await fs.writeFile(path.join(output, name + '.mjs'), compiled);
}
await fs.writeFile(
  path.join(output, 'image.mjs'),
  "import {createElement} from 'react';export default function Image({unoptimized,onError,...props}){return createElement('img',props)}",
);
const nav = await import(
  pathToFileURL(path.join(output, 'lab-navigation.mjs')).href
);
const records = await import(
  pathToFileURL(path.join(output, 'lab-records.mjs')).href
);
const { LabContent } = await import(
  pathToFileURL(path.join(output, 'lab-content.mjs')).href
);
assert.equal(nav.people.length, 4);
const moved = { ...catalog.people[2], buildingId: null };
assert.equal(
  records.personContentId(moved),
  records.personContentId(catalog.people[2]),
  'Moving home must preserve the person URL.',
);
assert(nav.isContentId('place:qin-li'));
assert.equal(nav.contentForBuilding('qin-li'), 'qin-li');
for (const id of [
  'person:test-member',
  'research:test-study',
  'event:test-event',
  'output:test-output',
  'note:test-note',
]) {
  assert(nav.isContentId(id));
  for (const mode of ['city', 'read'])
    assert.equal(nav.parseLocation('#' + mode + '/' + id).content, id);
  assert(nav.readingChapters.includes(nav.chapterFor(id)));
  assert(nav.titleFor(id, 'en'));
  const html = renderToStaticMarkup(
    React.createElement(LabContent, { id, locale: 'en', onOpen() {} }),
  );
  assert(!/[\u3400-\u9fff]/.test(html), 'English record contains Chinese.');
}
assert.deepEqual(nav.sceneTarget('person:test-member'), {
  district: 'residential',
});
assert.deepEqual(nav.sceneTarget('research:test-study'), {
  building: 'research-studio',
});
assert.deepEqual(nav.sceneTarget('event:test-event'), { park: true });
assert.deepEqual(nav.sceneTarget('output:test-output'), {
  building: 'city-archive',
});
assert.deepEqual(nav.sceneTarget('note:test-note'), {
  building: 'research-studio',
});
assert.equal(nav.selectionForContent('people').length, 3);
assert(!records.getRecord('person:missing'));
const html = renderToStaticMarkup(
  React.createElement(LabContent, {
    id: 'person:test-member',
    locale: 'en',
    onOpen() {},
  }),
);
assert(html.includes('Spatial statistics') && html.includes('Test research'));
const study = renderToStaticMarkup(
  React.createElement(LabContent, {
    id: 'research-studio',
    locale: 'en',
    onOpen() {},
  }),
);
assert(
  !study.includes('id="read-research:test-study"'),
  'City content must not duplicate reading anchors.',
);
const readingStudy = renderToStaticMarkup(
  React.createElement(LabContent, {
    id: 'research-studio',
    locale: 'en',
    onOpen() {},
    reading: true,
  }),
);
assert(readingStudy.includes('id="read-research:test-study"'));
assert(
  study.includes('Test research') && !study.includes('No project records'),
);
const park = renderToStaticMarkup(
  React.createElement(LabContent, {
    id: 'corner-park',
    locale: 'en',
    onOpen() {},
  }),
);
assert(park.includes('Test event') && !park.includes('No records yet'));
// Exercise the same maintenance CLI in an isolated copy of its directory structure.
const sandbox = path.join(output, 'cli');
for (const dir of ['app', 'scripts', 'content'])
  await fs.mkdir(path.join(sandbox, dir), { recursive: true });
await fs.copyFile(
  path.join(root, 'app/content-schema.ts'),
  path.join(sandbox, 'app/content-schema.ts'),
);
await fs.copyFile(
  path.join(root, 'scripts/content.mjs'),
  path.join(sandbox, 'scripts/content.mjs'),
);
await fs.writeFile(path.join(sandbox, 'content/lab.json'), original);
const file = path.join(sandbox, 'person.json');
await fs.writeFile(file, JSON.stringify(person));
for (const args of [
  ['upsert', 'people', file],
  ['list', 'people'],
  ['remove', 'people', 'test-member'],
  ['validate'],
]) {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      path.join(sandbox, 'scripts/content.mjs'),
      ...args,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
}
assert.deepEqual(
  JSON.parse(await fs.readFile(path.join(sandbox, 'content/lab.json'), 'utf8')),
  catalog,
);
assert(
  (await fs.readdir(path.join(sandbox, 'work/content-backups'))).length >= 2,
);
assert.equal(
  await fs.readFile(path.join(root, 'content/lab.json'), 'utf8'),
  original,
);
console.log(
  'Content checks passed: persistent CRUD with backups, references, invalid dates/links, member/research/event/output/note rendering, v1 migration, properties, bilingual routes and scene targets.',
);
