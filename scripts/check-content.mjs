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
// Who is still at the Gate depends on the day: people leave on their departure's UTC day, the day
// Gate's News counts by. Every helper that decides it takes that day, and these checks pass fixed
// days, so they give the same answer whenever they run. The page decides when it renders, by the
// visitor's UTC day; what it renders is checked against that day, read once here.
const DAY = '2026-11-03',
  TODAY = new Date(DAY + 'T12:00:00Z'),
  NOW = new Date().toISOString().slice(0, 10);
const on = (day) => new Date(day + 'T12:00:00Z');
/** The rule stated again, independently of the site's code: gone from their departure's day on. */
const leftBy = (p, day) => !!p.departure && p.departure.date <= day;
/** The members on a day: everyone published who has not left by then, in their order. */
const membersOf = (cat, day) =>
  cat.people
    .filter((p) => p.visibility === 'published' && !leftBy(p, day))
    .sort((a, b) => a.order - b.order);
/** A name tag's name: the first name in English; in Chinese the full name, if it has one. */
const tagName = (p, locale) =>
  locale === 'zh' && /[\u3400-\u9fff]/.test(p.title.zh) ? p.title.zh : p.title.en.split(' ')[0];
/** The name tags on a day: a home's first current resident, and everyone staying in the residence. */
const tagsOf = (cat, day, locale) => {
  const members = membersOf(cat, day);
  return [...new Set(members.map((p) => p.buildingId).filter(Boolean))].map((home) => {
    const here = members.filter((p) => p.buildingId === home);
    return [
      home,
      (home === 'visiting-phd' ? here : here.slice(0, 1))
        .map((p) => tagName(p, locale))
        .join(locale === 'zh' ? '、' : ' · '),
    ];
  });
};
// Fixture news is dated a month before the run, so it stays inside Gate's News window
// (the last 12 months) whatever day the checks run.
const recent = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
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
  date: recent,
  category: 'milestone',
  people: ['test-member'],
  image: null,
};
next = upsertRecord(next, 'events', event);
// An outing from long ago: it stays in Life at the Gate but has left Gate's News.
const oldEvent = {
  ...event,
  id: 'test-old-event',
  title: text('Old test outing'),
  date: '2024-05-01',
  category: 'group-photo',
  people: [],
};
next = upsertRecord(next, 'events', oldEvent);
const outputRecord = {
  ...research,
  id: 'test-output',
  title: text('Test output'),
  type: 'paper',
  date: recent,
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
// Leaving Liu’s Gate: the person stays published (their address and the events that name them
// keep working) and gains a departure block. TEST-ONLY: content/lab.json holds no departure
// until the owner confirms one and the person agrees.
const departure = {
  date: '2025-06-30',
  city: { en: 'Testford, Scotland', zh: '测试福德' },
  destination: { en: 'Test University', zh: '测试大学' },
  role: { en: 'Postdoctoral researcher', zh: '博士后研究员' },
  link: { label: text('Homepage'), url: 'https://example.org/past-member' },
};
const without = (record, key) => {
  const copy = structuredClone(record);
  delete copy[key];
  return copy;
};
assert.deepEqual(
  upsertRecord(next, 'people', { ...person, departure }).people.find(
    (p) => p.id === 'test-member',
  ).departure,
  departure,
  'A person named by an event can leave without being hidden or removed.',
);
for (const ok of [
  { ...departure, role: null, link: null },
  // Entered ahead: they move on that day.
  { ...departure, date: '2099-07-01' },
])
  upsertRecord(next, 'people', { ...person, departure: ok });
// A typo is an unknown field, not a silently ignored one.
assert.throws(
  () => upsertRecord(next, 'people', { ...person, depature: departure }),
  /unknown field "depature"/,
);
for (const [bad, error] of [
  ['2025-06-30', /departure must be an object/],
  [null, /departure must be an object/],
  [[], /departure must be an object/],
  [{ ...departure, date: '2025-02-29' }, /departure\.date must be a real YYYY-MM-DD date/],
  [{ ...departure, date: '2025-6-30' }, /departure\.date must be a real YYYY-MM-DD date/],
  [{ ...departure, date: 'soon' }, /departure\.date must be a real YYYY-MM-DD date/],
  [without(departure, 'date'), /departure\.date must be a real YYYY-MM-DD date/],
  [{ ...departure, city: { en: 'Freiburg 弗莱堡', zh: '弗莱堡' } }, /departure\.city: supply en and zh/],
  [{ ...departure, city: { en: 'Freiburg', zh: ' ' } }, /departure\.city: supply en and zh/],
  [without(departure, 'destination'), /departure\.destination: supply en and zh/],
  [{ ...departure, destination: 'Test University' }, /departure\.destination: supply en and zh/],
  [{ ...departure, role: 'Lecturer' }, /departure\.role must be null or/],
  [{ ...departure, role: { en: '讲师', zh: '讲师' } }, /departure\.role must be null or/],
  [without(departure, 'role'), /departure\.role must be null or/],
  [without(departure, 'link'), /departure\.link must be null or/],
  [{ ...departure, link: 'https://example.org' }, /departure\.link must be null or/],
  [{ ...departure, link: { url: 'https://example.org' } }, /departure\.link must be null or/],
  [{ ...departure, link: { label: text('Homepage'), url: 'http://example.org' } }, /departure\.link must be null or/],
  [{ ...departure, link: { label: text('Email'), url: 'mailto:a@example.org' } }, /departure\.link must be null or/],
  [{ ...departure, link: { label: text('Bad'), url: 'javascript:alert(1)' } }, /departure\.link must be null or/],
  [{ ...departure, link: { ...departure.link, note: text('Extra') } }, /departure\.link must be null or/],
  // Status is derived from where they stayed (the residence: Returned), never stored.
  [{ ...departure, status: 'returned' }, /departure: unknown field "status"/],
])
  assert.throws(
    () => upsertRecord(next, 'people', { ...person, departure: bad }),
    error,
    'A malformed departure must fail: ' + JSON.stringify(bad),
  );
// Someone who has left keeps their home as history, and it is free for whoever moves in next,
// even while their departure still lies ahead. Two people who are staying cannot share a home.
{
  const leaver = { ...person, id: 'test-leaver', buildingId: 'qin-li', departure };
  assert(!validateCatalog({ ...next, people: [...next.people, leaver] }).length);
  assert(
    !validateCatalog({
      ...next,
      people: [...next.people, leaver, { ...leaver, id: 'test-leaver-2', departure: { ...departure, date: '2099-07-01' } }],
    }).length,
    'A home keeps any number of past residents.',
  );
  assert.throws(
    () => upsertRecord(next, 'people', without(leaver, 'departure')),
    /home no one else lives in/,
  );
}
let removed = removeRecord(
  removeRecord(
    removeRecord(
      removeRecord(
        removeRecord(next, 'outputs', 'test-output'),
        'notes',
        'test-note',
      ),
      'events',
      'test-old-event',
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
  JSON.parse(original).people.length,
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
  'site-chrome',
]) {
  const ext = ['lab-content', 'site-chrome'].includes(name) ? 'tsx' : 'ts';
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
const { LabContent, NewsPreview, PeopleCards } = await import(
  pathToFileURL(path.join(output, 'lab-content.mjs')).href
);
const { SiteFooter, chapterMeta } = await import(
  pathToFileURL(path.join(output, 'site-chrome.mjs')).href
);
const data = await import(
  pathToFileURL(path.join(output, 'city-data.mjs')).href
);
const { buildings } = data;
// The People chapter lists the members: on DAY everyone published, and the test member. The
// page's own list is the visitor's day's.
assert.deepEqual(
  nav.peopleOn(TODAY).map((p) => p.id),
  membersOf(next, DAY).map(records.personContentId),
);
assert.equal(nav.peopleOn(TODAY).length, membersOf(catalog, DAY).length + 1); // the real members and the test member
assert.deepEqual(
  nav.people.map((p) => p.id),
  membersOf(next, NOW).map(records.personContentId),
);
// On DAY nobody had left Liu’s Gate, so the rules for who is here give exactly the site as it
// was: every published person a member, no one on the departures board, every home its one
// resident, and the tour, the People framing and the name tags unchanged.
assert.deepEqual(
  catalog.people.filter((p) => leftBy(p, DAY)),
  [],
  'Nobody had left on ' + DAY + ', so the live site is as it was.',
);
assert.deepEqual(records.memberRecords(TODAY), records.peopleRecords);
assert.deepEqual(records.alumniRecords(TODAY), []);
{
  const residentOf = (b) =>
    b.variant ? records.peopleRecords.find((p) => p.buildingId === b.id) : null;
  assert.deepEqual(
    data.buildingsOn(TODAY).map((b) => [b.id, b.name]),
    buildings.map((b) => [b.id, residentOf(b)?.title ?? b.name]),
  );
  assert.deepEqual(nav.tourOn(TODAY), [
    ...buildings.map((b) =>
      !b.variant
        ? b.id
        : residentOf(b)
          ? records.personContentId(residentOf(b))
          : 'place:' + b.id,
    ),
    'corner-park',
  ]);
  assert.deepEqual(nav.tourStops, nav.tourOn(), 'The page’s tour is the visitor’s day’s.');
}
for (const locale of ['en', 'zh']) {
  assert.deepEqual(
    nav.homeTags(locale, TODAY).map((t) => [t.building, t.label]),
    tagsOf(next, DAY, locale),
  );
  // The page's tags are the visitor's day's.
  assert.deepEqual(
    nav.homeTags(locale).map((t) => [t.building, t.label]),
    tagsOf(next, NOW, locale),
  );
}
const moved = { ...catalog.people[2], buildingId: null };
assert.equal(
  records.personContentId(moved),
  records.personContentId(catalog.people[2]),
  'Moving home must preserve the person URL.',
);
assert(nav.isContentId('place:qin-li'));
assert.equal(nav.contentForBuilding('qin-li', TODAY), 'qin-li');
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
// The People chapter frames the homes someone lives in (on DAY all three) and the Visiting PhD
// Residence, lived in or not.
assert.deepEqual(nav.selectionForContent('people', TODAY), ['pengyuan-liu', 'yunlong-liu', 'qin-li', 'visiting-phd']);
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
// On the page a record is already open where the reader is: only the city's file
// offers to open it.
assert(
  study.includes('Open this record') &&
    !readingStudy.includes('Open this record'),
  'Only the city file offers to open a record.',
);
assert(
  study.includes('Test research') && !study.includes('started recently'),
  'Real projects replace the Research chapter’s note for visitors.',
);
// Chapters with nothing published yet speak to visitors: no notes for the maintainer in the
// site's own place copy, and every English text free of Chinese. A resident's summary and
// profile are their own words from their record, so a bio may say "records" or "维护".
for (const b of buildings) {
  const texts = [b.summary, b.architecture, ...b.sections.flatMap((s) => [s.heading, s.body])];
  // The page's places are the visitor's day's: a home someone has left speaks for itself again.
  const resident = membersOf(next, NOW).some((p) => p.buildingId === b.id);
  for (const { en, zh } of resident ? [b.architecture] : texts)
    assert(
      !/catalog|repositor|\brecords?\b|maintain/i.test(en) && !/目录|记录|维护/.test(zh),
      'Visitors see no maintainer wording in ' + b.id + ': ' + en,
    );
  for (const { en } of texts)
    assert(!/[\u3400-\u9fff]/.test(en), 'English place text contains Chinese: ' + en);
}
// One role label for the PhD members; only the supervisor differs (owner's decision), and the
// visiting PhD researchers who stay in the Visiting PhD Residence, whose label says so.
const roleFor = (p) =>
  p.id === 'pengyuan-liu'
    ? { en: 'SUPERVISOR', zh: '导师' }
    : p.buildingId === 'visiting-phd'
      ? { en: 'VISITING PHD RESEARCHER', zh: '访问博士生' }
      : { en: 'PHD RESEARCHER', zh: '博士生' };
for (const p of catalog.people) assert.deepEqual(p.role, roleFor(p), 'Role label for ' + p.id);
// The Visiting PhD Residence: its file shows the cards of whoever stays there (or, with no one in
// it, says who it is for), it opens its own file (in the tour and the Directory too), the People
// chapter frames it, and its name tag names its residents (none when it is empty).
{
  // The rendered file is the visitor's day's; the tags are checked on DAY.
  const residents = membersOf(catalog, NOW).filter((p) => p.buildingId === 'visiting-phd'),
    staying = membersOf(catalog, DAY).filter((p) => p.buildingId === 'visiting-phd');
  const residence = renderToStaticMarkup(
    React.createElement(LabContent, { id: 'visiting-phd', locale: 'en', onOpen() {} }),
  );
  if (residents.length)
    assert(
      residence.includes('person-card') && residents.every((p) => residence.includes(p.title.en)),
      'The residence shows its residents.',
    );
  else
    assert(
      residence.includes('<h4>Visiting researchers</h4>') && !residence.includes('person-card'),
      'The empty residence describes its visitors.',
    );
  assert.equal(nav.contentForBuilding('visiting-phd', TODAY), 'visiting-phd');
  assert.equal(nav.chapterFor('visiting-phd'), 'people');
  assert.equal(nav.tourStops.filter((s) => s === 'visiting-phd').length, 1, 'The tour visits the residence once.');
  const homes = [['pengyuan-liu', 'Pengyuan'], ['yunlong-liu', 'Yunlong'], ['qin-li', 'Qin']];
  assert.deepEqual(
    nav.homeTags('en', TODAY).map((t) => [t.building, t.label]),
    staying.length ? [...homes, ['visiting-phd', staying.map((p) => p.title.en.split(' ')[0]).join(' · ')]] : homes,
    'One name tag a home, and one over the residence naming whoever stays there.',
  );
  // A name written only in Latin letters keeps its first name on the Chinese tag too.
  for (const t of nav.homeTags('zh', TODAY)) assert(t.label.length <= 12, `The Chinese tag over ${t.building} is too long: ${t.label}`);
}
/** The site's own code, compiled again over a test catalogue in a directory of its own. */
async function siteOver(name, testCatalog) {
  const dir = path.join(output, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'lab.json'), JSON.stringify(testCatalog));
  for (const file of await fs.readdir(output))
    if (file.endsWith('.mjs')) await fs.copyFile(path.join(output, file), path.join(dir, file));
  const at = (module) => import(pathToFileURL(path.join(dir, module + '.mjs')).href);
  return {
    nav: await at('lab-navigation'),
    records: await at('lab-records'),
    data: await at('city-data'),
    content: await at('lab-content'),
  };
}
// TEST-ONLY visiting researchers (never in content/lab.json): two people whose buildingId is
// 'visiting-phd' share the residence (a home takes one), and the site's own code, compiled again
// over this catalogue, files them there.
{
  const visitor = (id, en, zh, order) => ({
    ...structuredClone(catalog.people[1]),
    id,
    title: { en, zh },
    summary: text('Visiting test researcher'),
    role: { en: 'VISITING PHD RESEARCHER', zh: '访问博士生' },
    buildingId: 'visiting-phd',
    order,
    photo: null,
    links: [],
    sections: [],
    properties: [],
  });
  let visits = upsertRecord(next, 'people', visitor('ada-test', 'Ada Test', '测试甲', 30));
  visits = upsertRecord(visits, 'people', visitor('bea-test', 'Bea Test', '测试乙', 31));
  for (const p of visits.people) assert.deepEqual(p.role, roleFor(p), 'Role label for ' + p.id);
  assert.throws(
    () => upsertRecord(visits, 'people', { ...visitor('cy-test', 'Cy Test', '测试丙', 32), buildingId: 'qin-li' }),
    /home no one else lives in/,
    'A home takes one person.',
  );
  assert.throws(
    () => upsertRecord(visits, 'people', { ...visitor('cy-test', 'Cy Test', '测试丙', 32), buildingId: 'town-hall' }),
    /home no one else lives in/,
    'People live in a home or the residence.',
  );
  const site = await siteOver('visitors', visits),
    vnav = site.nav,
    { LabContent: VisitLab, PeopleCards: VisitPeople, houseFor } = site.content;
  for (const id of ['person:ada-test', 'person:bea-test']) {
    assert.deepEqual(vnav.sceneTarget(id), { building: 'visiting-phd' });
    assert.equal(vnav.placeFor(id), 'visiting-phd');
    assert.equal(vnav.chapterFor(id), 'people');
    // Hovering their card rings the residence (PersonCard hands the home's id to onHover).
    assert.equal(houseFor(id)?.id, 'visiting-phd');
  }
  assert.equal(vnav.contentForBuilding('visiting-phd', TODAY), 'visiting-phd', 'The residence opens its own file, listing its residents.');
  assert.deepEqual(vnav.selectionForContent('people', TODAY), ['pengyuan-liu', 'yunlong-liu', 'qin-li', 'visiting-phd']);
  // The residence's tag names everyone staying there, the real residents first (by order), then the
  // two test visitors; a name written only in Latin letters keeps its first name on the Chinese tag.
  // The tags are checked on DAY, the rendered file on the visitor's day.
  const stayers = membersOf(catalog, DAY).filter((p) => p.buildingId === 'visiting-phd'),
    stayersNow = membersOf(catalog, NOW).filter((p) => p.buildingId === 'visiting-phd');
  for (const { locale, sep, tests } of [
    { locale: 'en', sep: ' · ', tests: ['Ada', 'Bea'] },
    { locale: 'zh', sep: '、', tests: ['测试甲', '测试乙'] },
  ])
    assert.deepEqual(
      vnav.homeTags(locale, TODAY).map((t) => [t.building, t.label]),
      [
        ...membersOf(catalog, DAY)
          .filter((p) => p.buildingId && p.buildingId !== 'visiting-phd')
          .map((p) => [p.buildingId, tagName(p, locale)]),
        ['visiting-phd', [...stayers.map((p) => tagName(p, locale)), ...tests].join(sep)],
      ],
      'The residence\'s tag names its residents; the homes\' stay as they were (' + locale + ').',
    );
  const file = renderToStaticMarkup(React.createElement(VisitLab, { id: 'visiting-phd', locale: 'en', onOpen() {} }));
  assert(
    file.includes('Ada Test') && file.includes('Bea Test') && file.includes('VISITING PHD RESEARCHER') &&
      (file.match(/class="person-card"/g) || []).length === 2 + stayersNow.length && !file.includes('<h4>Visiting researchers</h4>'),
    'The residence\'s file shows each resident\'s card instead of the description.',
  );
  assert(!/[\u3400-\u9fff]/.test(file), 'English residence file contains Chinese.');
  const chapter = renderToStaticMarkup(React.createElement(VisitPeople, { locale: 'en', onOpen() {}, reading: true }));
  assert(
    chapter.includes('id="read-person:ada-test"') && chapter.includes('id="read-person:bea-test"') && chapter.includes('VISITING PHD RESEARCHER'),
    'The People chapter lists the residents.',
  );
}
// TEST-ONLY departures (never in content/lab.json): a member who left in 2025, a visiting
// researcher who went home in 2026 and a member who leaves in 2099, filed by the site's own code
// compiled again over this catalogue. The test catalogue hands Qin Li's home to the 2099 leaver
// (Qin stays a member, without a home), so the checks can watch a home empty on its resident's day
// and fill again when someone moves in.
{
  const EVE = on('2099-06-30'),
    DEPART = on('2099-07-01');
  const tester = (id, en, zh, order, buildingId, role = { en: 'PHD RESEARCHER', zh: '博士生' }) => ({
    ...structuredClone(catalog.people[1]),
    id,
    title: { en, zh },
    summary: text(en + ' is a test person.'),
    role,
    buildingId,
    order,
    photo: null,
    links: [],
    sections: [],
    properties: [],
  });
  const pastMember = { ...tester('test-past-member', 'Pat Former', '测试丙', 21, 'yunlong-liu'), departure };
  const pastVisitor = {
    ...tester('test-past-visitor', 'Val Visitor', '测试丁', 22, 'visiting-phd', {
      en: 'VISITING PHD RESEARCHER',
      zh: '访问博士生',
    }),
    departure: {
      date: '2026-08-31',
      city: { en: 'Testburg, Ireland', zh: '爱尔兰测试堡' },
      destination: { en: 'Test Institute', zh: '测试研究所' },
      role: null,
      link: null,
    },
  };
  const futureMember = {
    ...tester('test-future-member', 'Fay Future', '测试戊', 23, 'qin-li'),
    departure: {
      date: '2099-07-01',
      city: { en: 'Testport, Wales', zh: '威尔士测试港' },
      destination: { en: 'Test Company', zh: '测试公司' },
      role: { en: 'Data scientist', zh: '数据科学家' },
      link: { label: text('Homepage'), url: 'https://example.org/future-member' },
    },
  };
  let leaving = upsertRecord(next, 'people', {
    ...catalog.people.find((p) => p.id === 'qin-li'),
    buildingId: null,
  });
  for (const p of [pastMember, pastVisitor, futureMember]) leaving = upsertRecord(leaving, 'people', p);
  // A farewell names the member who has left: they stay published, so it still opens their file.
  leaving = upsertRecord(leaving, 'events', {
    ...event,
    id: 'test-farewell',
    title: text('Test farewell'),
    date: '2025-06-27',
    people: ['test-past-member'],
  });
  for (const p of leaving.people) assert.deepEqual(p.role, roleFor(p), 'Role label for ' + p.id + ', kept as history.');
  const { nav: lnav, records: lrec, data: ldata, content: lcontent } = await siteOver('departures', leaving);
  const ids = (list) => list.map((p) => p.id);
  const find = (id) => lrec.peopleRecords.find((p) => p.id === id);
  // The day is the UTC day, as Gate's News counts days: the visitor who left on 31 Aug 2026 was
  // still here at 23:59 UTC the day before, and at half past midnight in Glasgow (BST), still the
  // 30th in UTC; she had gone from 00:00 UTC on the 31st.
  for (const [when, gone] of [
    ['2026-08-30T23:59:59Z', false],
    ['2026-08-31T00:30:00+01:00', false],
    ['2026-08-31T00:00:00Z', true],
    [DAY + 'T12:00:00Z', true],
  ])
    assert.equal(lrec.hasDeparted(find('test-past-visitor'), new Date(when)), gone, 'Gone by ' + when + '?');
  assert(!lrec.hasDeparted(find('qin-li'), DEPART), 'Without a departure nobody leaves.');
  // Members, the People chapter, the departures board and the name tags on each day, against the
  // rule stated independently above.
  for (const day of [DAY, '2026-08-30', '2099-06-30', '2099-07-01']) {
    assert.deepEqual(ids(lrec.memberRecords(on(day))), ids(membersOf(leaving, day)), 'Members on ' + day);
    assert.deepEqual(
      ids(lnav.peopleOn(on(day))),
      membersOf(leaving, day).map(lrec.personContentId),
      'The People chapter on ' + day,
    );
    assert.deepEqual(
      ids(lrec.alumniRecords(on(day))),
      ids(
        leaving.people
          .filter((p) => leftBy(p, day))
          .sort((a, b) => b.departure.date.localeCompare(a.departure.date) || a.order - b.order),
      ),
      'The departures board on ' + day + ', newest first',
    );
    for (const locale of ['en', 'zh'])
      assert.deepEqual(
        lnav.homeTags(locale, on(day)).map((t) => [t.building, t.label]),
        tagsOf(leaving, day, locale),
        'Name tags on ' + day,
      );
  }
  assert.deepEqual(ids(lrec.alumniRecords(TODAY)), ['test-past-visitor', 'test-past-member'], 'Newest departure first.');
  assert(
    ids(lrec.memberRecords(EVE)).includes('test-future-member') &&
      !ids(lrec.memberRecords(DEPART)).includes('test-future-member') &&
      ids(lrec.alumniRecords(DEPART))[0] === 'test-future-member',
    'A departure entered ahead takes effect on its day.',
  );
  // The status is derived: the visiting researcher has gone home, the others have set off.
  assert.deepEqual(
    ['test-past-member', 'test-past-visitor', 'test-future-member'].map((id) => lrec.departureStatus(find(id))),
    ['departed', 'returned', 'departed'],
  );
  assert.deepEqual(lrec.departureStatusLabel, {
    departed: { en: 'Departed', zh: '已启程' },
    returned: { en: 'Returned', zh: '已返程' },
  });
  // Nobody is dropped: peopleRecords keeps everyone published, so an old address, a farewell's
  // People button and the supervisor's email keep working.
  assert.deepEqual(
    ids(lrec.peopleRecords),
    ids(leaving.people.filter((p) => p.visibility === 'published').sort((a, b) => a.order - b.order)),
  );
  assert.equal(lrec.supervisorEmail(), records.supervisorEmail());
  for (const [id, name] of [
    ['person:test-past-member', 'Pat Former'],
    ['person:test-past-visitor', 'Val Visitor'],
  ]) {
    assert(lnav.isContentId(id));
    assert.deepEqual(lnav.parseLocation('#read/' + id), { mode: 'reading', content: id });
    assert.equal(lnav.titleFor(id, 'en'), name);
    const page = renderToStaticMarkup(React.createElement(lcontent.LabContent, { id, locale: 'en', onOpen() {} }));
    assert(page.includes(name) && !/[\u3400-\u9fff]/.test(page), 'The file of someone who has left still opens: ' + id);
  }
  assert(
    renderToStaticMarkup(
      React.createElement(lcontent.LabContent, { id: 'event:test-farewell', locale: 'en', onOpen() {} }),
    ).includes('Pat Former'),
    'A farewell still names the member who left.',
  );
  // A home keeps its current resident whoever lived there before: Yunlong Liu's home is his,
  // though the member who left in 2025 once lived there.
  const home = (day, id) => ldata.buildingsOn(day).find((b) => b.id === id);
  assert.deepEqual(home(TODAY, 'yunlong-liu').name, catalog.people.find((p) => p.id === 'yunlong-liu').title);
  assert.deepEqual(ids(ldata.residentsOf('yunlong-liu', TODAY)), ['yunlong-liu']);
  // The residence lists only who is staying: the visitor who went home is not among them.
  assert(ids(ldata.residentsOf('visiting-phd', on('2026-08-30'))).includes('test-past-visitor'));
  assert.deepEqual(
    ids(ldata.residentsOf('visiting-phd', TODAY)),
    ids(membersOf(leaving, DAY).filter((p) => p.buildingId === 'visiting-phd')),
  );
  // The 2099 leaver lives in Qin Li's home up to the day before they set off...
  for (const day of [TODAY, EVE]) {
    assert.deepEqual(home(day, 'qin-li').name, futureMember.title);
    assert.equal(lnav.contentForBuilding('qin-li', day), 'person:test-future-member');
    assert(lnav.tourOn(day).includes('person:test-future-member'));
    assert(lnav.selectionForContent('people', day).includes('qin-li'));
  }
  // ...and from that day the home reads as an unoccupied terrace house that opens its own file, with
  // no name tag and out of the People chapter's frame, until someone moves in.
  const empty = home(DEPART, 'qin-li');
  assert.deepEqual(
    [empty.name, empty.short, empty.category, empty.summary, empty.sections],
    [
      { en: 'Terrace house', zh: '联排住宅' },
      { en: 'Home', zh: '住宅' },
      { en: 'THE TERRACE', zh: '联排住宅' },
      { en: 'A home in the terrace row, currently unoccupied.', zh: '联排中的一户住宅，目前无人居住。' },
      [],
    ],
  );
  assert.equal(lnav.contentForBuilding('qin-li', DEPART), 'place:qin-li');
  assert(lnav.tourOn(DEPART).includes('place:qin-li') && !lnav.tourOn(DEPART).includes('person:test-future-member'));
  assert(!lnav.homeTags('en', DEPART).some((t) => t.building === 'qin-li'));
  assert(!lnav.selectionForContent('people', DEPART).includes('qin-li'));
  assert(lnav.selectionForContent('people', DEPART).includes('visiting-phd'), 'The residence stays in frame, lived in or not.');
  // What the page renders is the visitor's day's (these fixtures are dated so that cannot change
  // before 2099): the People chapter lists the members only, the residence who is staying, and Qin
  // Li's home its 2099 leaver.
  const chapter = renderToStaticMarkup(
    React.createElement(lcontent.PeopleCards, { locale: 'en', onOpen() {}, reading: true }),
  );
  assert.deepEqual(
    [...chapter.matchAll(/id="read-([^"]+)"/g)].map((m) => m[1]),
    membersOf(leaving, NOW).map(lrec.personContentId),
    'The People chapter lists the members, in order.',
  );
  assert(
    chapter.includes('id="read-person:test-future-member"') &&
      !chapter.includes('Pat Former') &&
      !chapter.includes('Val Visitor'),
    'Those who have left are not among the members.',
  );
  const residenceFile = renderToStaticMarkup(
    React.createElement(lcontent.LabContent, { id: 'visiting-phd', locale: 'en', onOpen() {} }),
  );
  assert.equal(
    (residenceFile.match(/class="person-card"/g) || []).length,
    membersOf(leaving, NOW).filter((p) => p.buildingId === 'visiting-phd').length,
    'The residence lists who is staying.',
  );
  assert(!residenceFile.includes('Val Visitor'), 'The visitor who went home is not listed.');
  assert(
    renderToStaticMarkup(
      React.createElement(lcontent.LabContent, { id: 'place:qin-li', locale: 'en', onOpen() {} }),
    ).includes('Fay Future is a test person.'),
  );
  // Someone moves into that home while the 2099 leaver still lives there: a home shows its first
  // current resident (by order), with one name on its tag, and the newcomer from the leaver's day.
  const { nav: snav, data: sdata } = await siteOver(
    'successor',
    upsertRecord(leaving, 'people', tester('test-successor', 'Sam Successor', '测试己', 24, 'qin-li')),
  );
  const shown = (day) => [
    sdata.buildingsOn(day).find((b) => b.id === 'qin-li').name.en,
    snav.homeTags('en', day).find((t) => t.building === 'qin-li')?.label,
    snav.contentForBuilding('qin-li', day),
  ];
  assert.deepEqual(shown(TODAY), ['Fay Future', 'Fay', 'person:test-future-member']);
  assert.deepEqual(shown(DEPART), ['Sam Successor', 'Sam', 'person:test-successor']);
  assert(snav.peopleOn(TODAY).some((p) => p.id === 'person:test-successor'), 'A newcomer is a member as soon as they are entered.');
}
// The chapter at the gate is about this site; the name story was removed at the owner's request.
const gate = buildings.find((b) => b.id === 'lius-gate');
assert.deepEqual(gate.sections.map((s) => s.heading.en), ['Layout', 'How to use the site']);
assert.deepEqual(
  chapterMeta.find((c) => c.id === 'lius-gate').title,
  { en: 'About this site', zh: '关于本站' },
);
const studio = buildings.find((b) => b.id === 'research-studio'),
  archive = buildings.find((b) => b.id === 'city-archive');
assert.deepEqual(
  studio.sections.map((s) => s.heading.en),
  ['Projects'],
  'Research keeps one note for visitors, without “How records are added”.',
);
for (const b of [studio, archive])
  assert(
    !b.sections[0].body.en.startsWith('No ') && !b.sections[0].body.zh.startsWith('目前尚未'),
    'Empty chapters say what is coming, not that nothing exists: ' + b.id,
  );
const park = renderToStaticMarkup(
  React.createElement(LabContent, {
    id: 'corner-park',
    locale: 'en',
    onOpen() {},
  }),
);
assert(park.includes('Test event') && !park.includes('No records yet'));
// Life at the Gate keeps every outing, its dates written as people say them.
const parkZh = renderToStaticMarkup(
  React.createElement(LabContent, { id: 'corner-park', locale: 'zh', onOpen() {} }),
);
assert(
  park.includes('Old test outing') &&
    park.includes('>1 May 2024</time>') &&
    parkZh.includes('>2024年5月1日</time>') &&
    !park.includes('>2024-05-01<') &&
    !park.includes('>' + recent + '<'),
  'Life dates read naturally, not as raw ISO dates.',
);
// Gate's News: dated records from every collection, newest first, capped, bilingual,
// and only from the last 12 months.
const news = records.recentNews(50);
assert(news.length >= 3 && records.recentNews(2).length === 2 && !records.recentNews(0).length);
for (let i = 1; i < news.length; i++)
  assert(news[i - 1].record.date >= news[i].record.date, 'News must be newest first.');
const yearAgo = new Date();
yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
assert(
  news.every((n) => n.record.date >= yearAgo.toISOString().slice(0, 10)) &&
    !news.some((n) => n.id === 'event:test-old-event'),
  'News older than 12 months leaves the first screen.',
);
const onAnniversary = records.recentNews(50, new Date('2025-05-01T12:00:00Z')),
  dayAfter = records.recentNews(50, new Date('2025-05-02T12:00:00Z'));
assert(
  onAnniversary.some((n) => n.id === 'event:test-old-event') &&
    !dayAfter.some((n) => n.id === 'event:test-old-event'),
  'News stays for exactly 12 months.',
);
const sameDay = news.filter((n) => n.record.date === recent).map((n) => n.id);
assert.deepEqual(sameDay, ['output:test-output', 'event:test-event', 'note:test-note']);
for (const n of news) assert(nav.isContentId(n.id), 'News must open a real record: ' + n.id);
const newsEn = renderToStaticMarkup(
  React.createElement(NewsPreview, { locale: 'en', onOpen() {}, limit: 50 }),
);
assert(newsEn.includes('Gate’s News') && newsEn.includes('Test output') && newsEn.includes('Paper'));
assert(!/[\u3400-\u9fff]/.test(newsEn), 'English news contains Chinese.');
assert(
  new RegExp('dateTime="' + recent + '">\\d{1,2} [A-Z][a-z]{2,3} \\d{4}</time>').test(newsEn),
  'News dates read naturally.',
);
const newsZh = renderToStaticMarkup(
  React.createElement(NewsPreview, { locale: 'zh', onOpen() {} }),
);
assert(newsZh.includes('刘家门快讯') && (newsZh.match(/<li>/g) || []).length === 3);
// Join us: the supervisor's email comes from their catalogue record, and every Join us
// link (news card and footer) fills in the subject line in the reader's language.
const supervisorMail = catalog.people
  .find((p) => p.id === 'pengyuan-liu')
  .links.find((l) => l.url.startsWith('mailto:')).url;
const joinHref = {
  en: supervisorMail + '?subject=' + encodeURIComponent('PhD enquiry — Liu’s Gate'),
  zh: supervisorMail + '?subject=' + encodeURIComponent('博士申请咨询 — 刘家门'),
};
assert(newsEn.includes('Join us!') && newsEn.includes('href="' + joinHref.en + '"'));
assert(newsZh.includes('加入我们！') && newsZh.includes('href="' + joinHref.zh + '"'));
for (const locale of ['en', 'zh']) {
  const footer = renderToStaticMarkup(
    React.createElement(SiteFooter, { locale, onNavigate() {} }),
  );
  assert(
    footer.includes('class="footer-join" href="' + joinHref[locale] + '"'),
    'The footer’s Join us fills in the subject (' + locale + ').',
  );
  if (locale === 'en')
    assert(!/[\u3400-\u9fff]/.test(footer), 'English footer contains Chinese.');
  // With no news from the last year the card keeps only Join us.
  const joinOnly = renderToStaticMarkup(
    React.createElement(NewsPreview, { locale, onOpen() {}, limit: 0 }),
  );
  assert(
    joinOnly.includes('is-join-only') &&
      joinOnly.includes('href="' + joinHref[locale] + '"') &&
      joinOnly.includes(locale === 'zh' ? '加入我们！' : 'Join us!') &&
      !joinOnly.includes('<ol') &&
      !joinOnly.includes(locale === 'zh' ? '刘家门快讯' : 'Gate’s News'),
    'Without news only Join us shows (' + locale + ').',
  );
}
// Reading view: each person card folds out the full profile from the catalogue, and email
// links show the address itself, labelled for assistive tech, in the same tab.
const escapeHtml = (value) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
const supervisor = catalog.people.find((p) => p.id === 'pengyuan-liu'),
  supervisorAddress = supervisorMail.slice('mailto:'.length);
for (const [locale, heading, summary, emailLabel] of [
  ['en', 'Collaboration and PhD opportunities', 'Full profile', 'Email: '],
  ['zh', '合作与博士招生', '完整简介', '邮箱：'],
]) {
  const cards = renderToStaticMarkup(
    React.createElement(PeopleCards, { locale, onOpen() {} }),
  );
  const section = supervisor.sections.find(
    (s) => s.heading[locale] === heading,
  );
  assert(section, 'The supervisor keeps the ' + heading + ' section.');
  const education = supervisor.properties.find((p) => p.key === 'education');
  assert(
    cards.includes('<details class="person-profile">') &&
      cards.includes('<summary>' + summary),
    'Person cards fold out a full profile (' + locale + ').',
  );
  assert(
    cards.includes('<h4>' + escapeHtml(heading) + '</h4>') &&
      cards.includes(escapeHtml(section.body[locale])),
    'Person cards show profile sections (' + locale + ').',
  );
  assert(
    cards.includes('<dd>' + escapeHtml(education.value[locale]) + '</dd>') &&
      (locale !== 'en' || cards.includes('<dd>Spatial statistics</dd>')),
    'Person cards show profile properties (' + locale + ').',
  );
  assert(
    cards.includes(
      'aria-label="' + emailLabel + supervisorAddress + '">' +
        supervisorAddress + '</a>',
    ),
    'The supervisor’s email address is visible link text (' + locale + ').',
  );
  const mailLinks = cards.match(/<a [^>]*href="mailto:[^>]*>.*?<\/a>/g) ?? [];
  // The cards are the members on the visitor's day, each with its email link.
  assert.equal(
    mailLinks.length,
    membersOf(next, NOW)
      .flatMap((p) => p.links)
      .filter((l) => l.url.startsWith('mailto:')).length,
    'Every member card keeps its email link.',
  );
  for (const link of mailLinks)
    assert(
      !link.includes('target=') && !link.includes('<svg'),
      'Email links stay in the tab without the external arrow: ' + link,
    );
  if (locale === 'en')
    assert(!/[\u3400-\u9fff]/.test(cards), 'English people contain Chinese.');
  // The reading page's cards are the people's anchors and fold out the profile in place,
  // so only the city's People file has a Profile button (it opens the person's file).
  const page = renderToStaticMarkup(
    React.createElement(PeopleCards, { locale, onOpen() {}, reading: true }),
  );
  const profileButton = '>' + (locale === 'zh' ? '个人资料' : 'Profile') + '<';
  assert(
    cards.includes(profileButton) && !page.includes(profileButton),
    'Only the city file has a Profile button (' + locale + ').',
  );
  assert(
    page.includes('id="read-pengyuan-liu"') &&
      !cards.includes('id="read-') &&
      page.includes('<details class="person-profile">'),
    'Reading cards carry the anchors and keep the fold-out (' + locale + ').',
  );
}
const dossier = renderToStaticMarkup(
  React.createElement(LabContent, {
    id: 'pengyuan-liu',
    locale: 'en',
    onOpen() {},
  }),
);
assert(
  dossier.includes('<h4>Collaboration and PhD opportunities</h4>') &&
    dossier.includes('>' + supervisorAddress + '</a>') &&
    !dossier.includes('person-profile'),
  'The dossier keeps the full record and shows the email address.',
);
// Liu’s Gate is a 师门 led by Pengyuan Liu, never a lab: no site copy calls it one, in English or in
// Chinese. Site copy is every piece of text in the site's code (string literals, template text and
// JSX text, but not module paths, object keys such as the old 'lab-life' address, or URLs such as
// the repository's) and the page's own HTML. Two sources are not site copy and are not scanned: the
// catalogue's validation messages in content-schema.ts, which only maintainers see (a catalogue
// that fails them is never published), and content/lab.json, whose records are people's own words:
// a bio may name a lab someone worked in.
{
  const lab = (text) => {
    const words = text.replace(/\b(?:https?:\/\/|mailto:)\S+/g, ' ');
    return /\blab(?:s|oratory|oratories)?\b/i.test(words) || /实验室/.test(words);
  };
  /** The text a source file carries. */
  const copyIn = (file, source) => {
    const found = [],
      kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return;
      const key =
        !!node.parent &&
        (ts.isPropertyAssignment(node.parent) || ts.isPropertySignature(node.parent)) &&
        node.parent.name === node;
      if (
        !key &&
        (ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node) ||
          ts.isJsxText(node))
      )
        found.push(node.text);
      ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind));
    return found;
  };
  // The scan sees what it should: these are caught, and these are not.
  for (const [source, caught] of [
    ["const t = 'Our lab at Glasgow';", true],
    ['const t = <p>The Liu Lab</p>;', true],
    ['const t = `Laboratory ${x} notes`;', true],
    ["const t = '刘家门实验室';", true],
    ["const t = { label: 'Available', 'lab-life': 'corner-park' };", false],
    ["const t = 'https://github.com/Lylll9436/lius-gate-lab';", false],
    ["import raw from '../content/lab.json';", false],
  ])
    assert.equal(copyIn('probe.tsx', source).some(lab), caught, 'The copy scan reads ' + source);
  let texts = 0;
  for (const file of (await fs.readdir(path.join(root, 'app'))).filter(
    (f) => /\.tsx?$/.test(f) && f !== 'content-schema.ts',
  )) {
    const copy = copyIn(file, await fs.readFile(path.join(root, 'app', file), 'utf8'));
    texts += copy.length;
    for (const text of copy) assert(!lab(text), 'app/' + file + ' calls Liu’s Gate a lab: ' + text);
  }
  const page = (await fs.readFile(path.join(root, 'index.html'), 'utf8')).replace(/\s(?:src|href)="[^"]*"/g, '');
  assert(!lab(page), 'index.html calls Liu’s Gate a lab.');
  assert(texts > 1000, 'The copy scan read the site’s text (' + texts + ' pieces).');
}
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
// The CLI checks that every referenced photo exists, so mirror those files too.
for (const item of [...catalog.people, ...(catalog.events ?? [])]) {
  const asset = item.photo ?? item.image;
  if (!asset) continue;
  const target = path.join(sandbox, 'public', asset.slice(1));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(path.join(root, 'public', asset.slice(1)), target);
}
const file = path.join(sandbox, 'person.json'),
  leaverFile = path.join(sandbox, 'leaver.json'),
  typoFile = path.join(sandbox, 'typo.json');
await fs.writeFile(file, JSON.stringify(person));
// The command takes a departure block, and refuses a misspelt one without saving anything.
await fs.writeFile(leaverFile, JSON.stringify({ ...person, departure }));
await fs.writeFile(typoFile, JSON.stringify({ ...person, depature: departure }));
for (const { args, status = 0, message } of [
  { args: ['upsert', 'people', file] },
  { args: ['list', 'people'] },
  { args: ['upsert', 'people', leaverFile] },
  { args: ['upsert', 'people', typoFile], status: 1, message: /unknown field "depature"/ },
  { args: ['remove', 'people', 'test-member'] },
  { args: ['validate'] },
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
  assert.equal(result.status, status, result.stderr);
  if (message) assert.match(result.stderr, message);
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
  'Content checks passed: persistent CRUD with backups, references, invalid dates/links, member/research/event/output/note rendering, visitor-facing empty chapters, role labels, the Visiting PhD Residence empty and shared by two test visitors, departures on fixed UTC days (a member who left, a visitor gone home as Returned, a 2099 leaver, a home that empties and fills again, malformed blocks refused), nobody gone on ' + DAY + ' so the live site unchanged, the About this site chapter, readable dates, Gate’s News order, 12-month window and rendering, Join us subject lines, full profiles and email addresses on the reading-view person cards, v1 migration, properties, bilingual routes and scene targets, and site copy that never calls Liu’s Gate a lab.',
);
