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
  buildingIds,
  neighbourPlaces,
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
// English text has no Chinese in any collection: no Han character, and no Chinese or full-width
// punctuation pasted from the Chinese copy either.
for (const en of ['Urban Studies，University of Glasgow', 'Spatial statistics。', 'A 「group」', 'Leeds、Glasgow', 'Alison \u{20000}'])
  assert.deepEqual(
    validateCatalog({ ...catalog, people: catalog.people.map((p, i) => (i ? p : { ...p, summary: { ...p.summary, en } })) }),
    ['people[0].summary: supply en and zh (English must contain no Chinese).'],
    'English text with Chinese in it passes: ' + en,
  );
const text = (en) => ({ en, zh: '测试内容' });
// Who is still at the Gate depends on the day: people leave on their departure's UTC day, the day
// Gate's News counts by. Every helper that decides it takes that day, and these checks pass fixed
// days, so they give the same answer whenever they run. The page decides by the visitor's UTC day
// when it loads (pageDay); what it renders is checked against that day as the page's own module
// read it (NOW, below, once the site is loaded), and each copy of the site compiled again over a
// test catalogue against its own: read from the clock at the top of the run, a run that crossed
// midnight UTC on someone's departure day compared the page's new day with the old one.
const DAY = '2026-11-03',
  TODAY = new Date(DAY + 'T12:00:00Z');
const on = (day) => new Date(day + 'T12:00:00Z');
/** The rule stated again, independently of the site's code: gone from their departure's day on. */
const leftBy = (p, day) => !!p.departure && p.departure.date <= day;
/** The members on a day: everyone published who has not left by then, in their order. */
const membersOf = (cat, day) =>
  cat.people
    .filter((p) => p.visibility === 'published' && !leftBy(p, day))
    .sort((a, b) => a.order - b.order);
/** Those who have left by a day: everyone published gone by then, newest departure first. */
const alumniOf = (cat, day) =>
  cat.people
    .filter((p) => p.visibility === 'published' && leftBy(p, day))
    .sort((a, b) => b.departure.date.localeCompare(a.departure.date) || a.order - b.order);
/**
 * A catalogue in which nobody leaves before 2099-12-31: every departure it holds is moved there.
 * The fixtures below are tried on it, so a real departure (one entered ahead of its day, or an
 * alumnus from before the site) never joins their board. A departure still frees its home, so the
 * catalogue stays valid whatever the real one holds.
 */
const settle = (cat) => ({
  ...cat,
  people: cat.people.map((p) => (p.departure ? { ...p, departure: { ...p.departure, date: '2099-12-31' } } : p)),
});
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
/**
 * A real record as the base of a test person, who stays unless the test gives them a departure:
 * when the real person's departure is entered (ahead of the day, as maintainers may), their copy
 * must not leave with them.
 */
const stayer = (p) => {
  const copy = structuredClone(p);
  delete copy.departure;
  return copy;
};
const person = {
  ...stayer(catalog.people[1]),
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
// A v1 file had no outputs, notes or neighbours, and gains them empty. The neighbours came later
// within v2 and only add a list: a v2 file from before them gains an empty one (schemaVersion stays
// 2), unmigrated it is refused, and the real file passes through as it is.
const legacy = structuredClone(catalog);
legacy.schemaVersion = 1;
delete legacy.outputs;
delete legacy.notes;
delete legacy.neighbours;
assert.deepEqual(migrateCatalog(legacy), { ...catalog, outputs: [], notes: [], neighbours: [] });
{
  const early = structuredClone(catalog);
  delete early.neighbours;
  assert.deepEqual(migrateCatalog(early), { ...catalog, neighbours: [] });
  assert.deepEqual(validateCatalog(migrateCatalog(early)), []);
  assert.deepEqual(validateCatalog(early), ['neighbours must be an array.']);
  assert.deepEqual(validateCatalog(migrateCatalog({ ...catalog, neighbours: null })), ['neighbours must be an array.']);
  assert.equal(migrateCatalog(catalog), catalog);
}
// The catalogue holds its schemaVersion and its collections, and nothing else. A collection whose
// name is misspelt is refused, migrated or not, by name, and is never taken for a file from before
// the neighbours: the sky island would have none. Nor is a stray key beside the real one kept.
{
  const typo = structuredClone(catalog);
  typo.neighbors = typo.neighbours;
  delete typo.neighbours;
  assert.deepEqual(validateCatalog(migrateCatalog(typo)), ['catalog: unknown field "neighbors".']);
  assert.deepEqual(validateCatalog(typo), ['catalog: unknown field "neighbors".', 'neighbours must be an array.']);
  assert.deepEqual(validateCatalog(migrateCatalog({ ...legacy, neighbors: [] })), ['catalog: unknown field "neighbors".']);
  assert.deepEqual(validateCatalog({ ...catalog, neighbor: [] }), ['catalog: unknown field "neighbor".']);
  assert.deepEqual(validateCatalog({ ...catalog, event: [] }), ['catalog: unknown field "event".']);
}

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
/**
 * A test catalogue in which a test member holds `home`, whoever lives there in `cat`. The home
 * rules are tried on test people: a real person's departure, entered ahead, frees their home, and
 * must not change what these checks expect.
 */
const holding = (cat, home) => ({
  ...cat,
  people: [
    ...cat.people.map((p) => (p.buildingId === home ? { ...p, buildingId: null } : p)),
    { ...person, id: 'test-occupant', buildingId: home },
  ],
});
// Someone who has left keeps their home as history, and it is free for whoever moves in next,
// even while their departure still lies ahead. Two people who are staying cannot share a home.
// The rules hold whoever is leaving in the real catalogue: here no one, then everyone.
for (const base of [
  next,
  { ...next, people: next.people.map((p) => ({ ...p, departure: { ...departure, date: '2099-12-31' } })) },
]) {
  const held = holding(base, 'qin-li'),
    leaver = { ...person, id: 'test-leaver', buildingId: 'qin-li', departure };
  assert(!validateCatalog(held).length);
  assert(!validateCatalog({ ...held, people: [...held.people, leaver] }).length);
  assert(
    !validateCatalog({
      ...held,
      people: [...held.people, leaver, { ...leaver, id: 'test-leaver-2', departure: { ...departure, date: '2099-07-01' } }],
    }).length,
    'A home keeps any number of past residents.',
  );
  assert.throws(
    () => upsertRecord(held, 'people', without(leaver, 'departure')),
    /home no one else lives in/,
    'Two people who are staying cannot share a home.',
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
// Neighbours: researchers beside the town who are not part of Liu’s Gate, with their groups. The one
// record is Alison Heppenstall's, and her group UIA's, on the sky island: a collection of its own,
// never people, so nothing counts her as a member, a leaver, a resident or someone with a home (the
// site's own code is checked for that below). Her fields are checked strictly, each fault in words
// of its own.
const alison = catalog.neighbours.find((n) => n.id === 'alison-heppenstall'),
  herAt = 'neighbours[' + catalog.neighbours.indexOf(alison) + ']';
assert(alison, 'The sky island’s neighbour, Alison Heppenstall, is in content/lab.json.');
assert.deepEqual(
  Object.keys(alison).sort(),
  ['id', 'title', 'summary', 'visibility', 'order', 'role', 'affiliation', 'photo', 'buildingId', 'group', 'sections', 'links'].sort(),
  'Her record holds its fields, and no properties.',
);
assert.deepEqual(
  [alison.visibility, alison.order, alison.photo, alison.buildingId],
  ['published', 0, null, 'sky-island'],
  'She is published, first, with no photo (the site shows none of her), and her place is the sky island.',
);
assert.deepEqual(alison.sections.map((s) => s.heading.en), ['Background', 'Research']);
assert.deepEqual(Object.keys(alison.group).sort(), ['name', 'fullName', 'summary', 'connection', 'site'].sort());
// Her two ways off the site, both HTTPS: UIA's website and her staff page.
assert.equal(alison.group.site.url, 'https://urban-ai.uk/');
assert.deepEqual(alison.links.map((l) => l.url), ['https://www.gla.ac.uk/schools/socialpolitical/staff/alisonheppenstall/']);
// The wording rules for her copy. She has no Chinese name, so hers stays in Latin script in the
// Chinese copy, and UIA keeps its own name. The one tie the sources state is that Pengyuan Liu is
// listed as an Associate of UIA, and the connection line says so. That nothing stronger is said,
// that her name and UIA's are never written in Chinese characters, and that Liu’s Gate is never
// called a lab or a group are checked in every sentence of her copy, whatever its field (the copy
// scan, below).
assert(alison.title.zh === alison.title.en && !/[㐀-鿿]/.test(alison.title.zh), 'Her name stays in Latin script in Chinese.');
assert.deepEqual(
  [alison.group.name.zh, alison.group.fullName.zh],
  [alison.group.name.en, alison.group.fullName.en],
  'UIA keeps its own name in Chinese.',
);
{
  const tie = alison.group.connection;
  assert(
    tie.en.includes('Pengyuan Liu') && /\bAssociates?\b/.test(tie.en) && tie.zh.includes('刘鹏远') && tie.zh.includes('Associate'),
    'The tie to UIA is that Pengyuan Liu is listed as an Associate.',
  );
}
/** The real catalogue with Alison Heppenstall's record changed by `edit`. */
const editedNeighbour = (edit) => {
  const cat = structuredClone(catalog);
  edit(cat.neighbours.find((n) => n.id === alison.id));
  return cat;
};
const placeRule = herAt + '.buildingId must be the place whose file shows them: sky-island.';
for (const [why, edit, message] of [
  // The four faults likeliest in an edit, each named in words of its own.
  ['a missing zh', (n) => delete n.group.summary.zh, herAt + '.group.summary.zh is missing: supply en and zh.'],
  [
    'a link that is not HTTPS',
    (n) => (n.links[0].url = 'http://www.gla.ac.uk/schools/socialpolitical/staff/alisonheppenstall/'),
    herAt + '.links[0].url must be an HTTPS address.',
  ],
  ['an unknown key', (n) => (n.properties = []), herAt + ': unknown field "properties".'],
  [
    'Chinese in English text',
    (n) => (n.summary.en = 'Professor of Geocomputation (地理计算) at the University of Glasgow.'),
    herAt + '.summary.en contains Chinese: English text must have none.',
  ],
  // And the rest of the rules.
  ['a blank zh', (n) => (n.role.zh = ' '), herAt + '.role.zh is missing: supply en and zh.'],
  ['a missing en', (n) => delete n.sections[1].heading.en, herAt + '.sections[1].heading.en is missing: supply en and zh.'],
  ['Chinese in the group’s English', (n) => (n.group.connection.en += ' 刘家门'), herAt + '.group.connection.en contains Chinese: English text must have none.'],
  // Chinese punctuation pasted from the Chinese copy is Chinese too.
  [
    'a full-width comma in English text',
    (n) => (n.affiliation.en = 'Urban Studies & Social Policy，University of Glasgow'),
    herAt + '.affiliation.en contains Chinese: English text must have none.',
  ],
  ['an ideographic full stop in English text', (n) => (n.role.en = 'PROFESSOR OF GEOCOMPUTATION。'), herAt + '.role.en contains Chinese: English text must have none.'],
  ['full-width brackets in English text', (n) => (n.group.summary.en = 'A group leader of UIA（Urban Intelligence & Analytics）.'), herAt + '.group.summary.en contains Chinese: English text must have none.'],
  // A Chinese text is translated: the English pasted in is refused, save her name and UIA's.
  ['an untranslated summary', (n) => (n.summary.zh = n.summary.en), herAt + '.summary.zh has no Chinese: translate it.'],
  ['an untranslated connection', (n) => (n.group.connection.zh = n.group.connection.en), herAt + '.group.connection.zh has no Chinese: translate it.'],
  ['an untranslated link label', (n) => (n.links[0].label.zh = n.links[0].label.en), herAt + '.links[0].label.zh has no Chinese: translate it.'],
  ['an untranslated section heading', (n) => (n.sections[0].heading.zh = 'Background'), herAt + '.sections[0].heading.zh has no Chinese: translate it.'],
  ['a text that is not en and zh', (n) => (n.title = 'Alison Heppenstall'), herAt + '.title must be a text with en and zh.'],
  ['a language beside en and zh', (n) => (n.title.fr = 'Alison Heppenstall'), herAt + '.title: unknown field "fr".'],
  ['UIA’s website not on HTTPS', (n) => (n.group.site.url = 'http://urban-ai.uk/'), herAt + '.group.site.url must be an HTTPS address.'],
  ['an email link', (n) => (n.links[0].url = 'mailto:someone@example.org'), herAt + '.links[0].url must be an HTTPS address.'],
  ['a script link', (n) => (n.group.site.url = 'javascript:alert(1)'), herAt + '.group.site.url must be an HTTPS address.'],
  ['an unknown key in the group', (n) => (n.group.website = 'https://urban-ai.uk/'), herAt + '.group: unknown field "website".'],
  ['an unknown key in the website', (n) => (n.group.site.note = text('Opens in a new tab')), herAt + '.group.site: unknown field "note".'],
  ['an unknown key in a section', (n) => (n.sections[0].image = null), herAt + '.sections[0]: unknown field "image".'],
  ['no group', (n) => delete n.group, herAt + '.group must be an object with name, fullName, summary, connection and site.'],
  ['no website', (n) => delete n.group.site, herAt + '.group.site must be a link with a label and an HTTPS url.'],
  ['no links', (n) => delete n.links, herAt + '.links must be an array.'],
  ['a place that is not hers', (n) => (n.buildingId = 'town-hall'), placeRule],
  ['a member’s home', (n) => (n.buildingId = 'pengyuan-liu'), placeRule],
  ['no place', (n) => (n.buildingId = null), placeRule],
  ['an unknown visibility', (n) => (n.visibility = 'public'), herAt + '.visibility is invalid.'],
  ['an order that is not a number', (n) => (n.order = '0'), herAt + '.order must be a number.'],
  ['a photo from off the site', (n) => (n.photo = 'https://example.org/portrait.jpg'), herAt + '.photo must be null or an image under /people/ or /media/.'],
  ['an id that is not a slug', (n) => (n.id = 'Alison Heppenstall'), herAt + ': id must be a unique stable slug.'],
])
  assert.deepEqual(validateCatalog(editedNeighbour(edit)), [message], 'A neighbour with ' + why + ' fails with its own message.');
// A neighbour is not a person: her id may not be in people too, and no event, project, output or
// note may name her among its people (their People buttons open members' files).
assert.deepEqual(
  validateCatalog({
    ...catalog,
    people: [...catalog.people, { ...stayer(catalog.people[1]), id: alison.id, title: alison.title, buildingId: null, order: 30 }],
  }),
  [herAt + ': alison-heppenstall is in people too. A neighbour is not a member: keep them in neighbours only.'],
);
for (const { collection, row } of [
  { collection: 'events', row: { ...event, id: 'test-sky-visit' } },
  { collection: 'research', row: { ...research, id: 'test-sky-study' } },
  { collection: 'outputs', row: { ...outputRecord, id: 'test-sky-output' } },
  { collection: 'notes', row: { ...noteRecord, id: 'test-sky-note' } },
])
  assert.throws(
    () => upsertRecord(next, collection, { ...row, people: [alison.id] }),
    new RegExp(collection + '/' + row.id + ': missing or unpublished person alison-heppenstall'),
    'A ' + collection + ' record cannot name a neighbour among its people.',
  );
// Nor is the Gate's work filed at her place: the sky island's file and camera are hers, so a project,
// an output or a note there would read as UIA's. Every other place takes them, as before.
for (const [collection, row] of Object.entries({ research, outputs: outputRecord, notes: noteRecord })) {
  const at = collection + '[' + next[collection].findIndex((r) => r.id === row.id) + ']',
    filedAt = (place) => ({ ...next, [collection]: next[collection].map((r) => (r.id === row.id ? { ...r, buildingId: place } : r)) });
  assert.deepEqual(
    validateCatalog(filedAt('sky-island')),
    [at + '.buildingId: sky-island is a neighbour’s place; file the Gate’s work at one of its own.'],
    'A ' + collection + ' record can be filed at a neighbour’s place.',
  );
  assert.deepEqual(validateCatalog(filedAt('research-studio')), [], 'A ' + collection + ' record cannot be filed at the studio.');
}
// A place's file shows one published neighbour. A draft may wait beside her; two of the same id may not.
const testNeighbour = {
  ...structuredClone(alison),
  id: 'test-neighbour',
  title: { en: 'Test Neighbour', zh: '测试近邻' },
  order: 1,
};
assert.deepEqual(validateCatalog({ ...catalog, neighbours: [...catalog.neighbours, testNeighbour] }), [
  'neighbours[' + catalog.neighbours.length + ']: sky-island already has a published neighbour; a place’s file shows one.',
]);
assert.deepEqual(validateCatalog({ ...catalog, neighbours: [...catalog.neighbours, { ...testNeighbour, visibility: 'draft' }] }), []);
assert.deepEqual(validateCatalog({ ...catalog, neighbours: [...catalog.neighbours, { ...alison, visibility: 'draft' }] }), [
  'neighbours[' + catalog.neighbours.length + ']: id must be a unique stable slug.',
]);
// The maintenance command's operations take the neighbours too, and refuse a typo.
{
  const added = upsertRecord(catalog, 'neighbours', { ...testNeighbour, visibility: 'draft' });
  assert.deepEqual(added.neighbours.map((n) => n.id), [...catalog.neighbours.map((n) => n.id), 'test-neighbour']);
  assert.deepEqual(removeRecord(added, 'neighbours', 'test-neighbour'), catalog);
  assert.throws(() => upsertRecord(catalog, 'neighbours', { ...alison, properties: [] }), /unknown field "properties"/);
  assert.throws(() => removeRecord(catalog, 'neighbours', 'missing'), /Record not found: neighbours\/missing/);
}
// The example a maintainer starts from (MAINTENANCE's upsert line) is a valid neighbour, a draft
// beside her, so it stays off the site and her place keeps her.
{
  const example = JSON.parse(await fs.readFile(path.join(root, 'content/examples/neighbour.json'), 'utf8'));
  assert.equal(example.visibility, 'draft', 'content/examples/neighbour.json must be a draft.');
  assert.deepEqual(
    upsertRecord(catalog, 'neighbours', example)
      .neighbours.filter((n) => n.visibility === 'published')
      .map((n) => n.id),
    [alison.id],
  );
}
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
  'chapters',
]) {
  const ext = ['lab-content', 'site-chrome', 'chapters'].includes(name) ? 'tsx' : 'ts';
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
// The page's day, as its module read it when it loaded: the moment it loaded, on the real clock.
const NOW = records.utcDay(records.pageDay);
assert(Math.abs(Date.now() - records.pageDay.getTime()) < 60_000, 'pageDay is not the moment the page loaded.');
const { LabContent, NewsPreview, PeopleCards, DeparturesBoard, glyphFor } = await import(
  pathToFileURL(path.join(output, 'lab-content.mjs')).href
);
/** Rendered markup as a visitor reads it: entities decoded. */
const decoded = (html) =>
  html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** The texts a visitor reads or hears in rendered markup: each element's own text, and its aria-labels. */
const textsOf = (html) =>
  [...html.split(/<[^>]*>/), ...[...html.matchAll(/\saria-label="([^"]*)"/g)].map((m) => m[1])]
    .map((t) => decoded(t).trim())
    .filter(Boolean);
/**
 * The links off the site in rendered markup that do not open a new tab with neither a way back to
 * the page nor its address sent along: every https link and every target="_blank" must carry
 * target="_blank" rel="noopener noreferrer" (the owner's rule for outbound links).
 */
const unsafeOutbound = (html) =>
  [...html.matchAll(/<a\s[^>]*>/g)]
    .map((m) => m[0])
    .filter((a) => /\shref="https:\/\//.test(a) || /\starget=/.test(a))
    .filter((a) => !/\starget="_blank"/.test(a) || !/\srel="noopener noreferrer"/.test(a));
const { SiteFooter, chapterMeta, onReadingPage } = await import(
  pathToFileURL(path.join(output, 'site-chrome.mjs')).href
);
const { Chapters } = await import(
  pathToFileURL(path.join(output, 'chapters.mjs')).href
);
const data = await import(
  pathToFileURL(path.join(output, 'city-data.mjs')).href
);
const { buildings } = data;
// The catalogue's list of places is the town's (city-data's BuildingId), and a neighbour's place is
// one of them: the sky island, whose file shows her.
assert.deepEqual([...buildingIds].sort(), buildings.map((b) => b.id).sort(), 'content-schema’s buildingIds are not the town’s places.');
assert(neighbourPlaces.length && neighbourPlaces.every((p) => buildingIds.includes(p)), 'A neighbour’s place is not one of buildingIds.');
assert.deepEqual([...neighbourPlaces], ['sky-island']);
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
// On DAY everyone then at Liu’s Gate was still here, so the rules for who is here gave exactly the
// site as it was: all four of them members, every home its one resident, and the tour, the People
// framing and the name tags unchanged. Someone entered later with a departure dated before DAY (an
// alumnus from before the site) was never among them: the lists on DAY follow the rule stated above.
assert.deepEqual(
  catalog.people.filter((p) => ['pengyuan-liu', 'yunlong-liu', 'qin-li', 'luisa-lo-presti'].includes(p.id) && leftBy(p, DAY)),
  [],
  'Nobody at the Gate on ' + DAY + ' had left by then.',
);
assert.deepEqual(records.memberRecords(TODAY).map((p) => p.id), membersOf(next, DAY).map((p) => p.id));
assert.deepEqual(records.alumniRecords(TODAY).map((p) => p.id), alumniOf(next, DAY).map((p) => p.id));
{
  const residentOf = (b) =>
    b.variant ? membersOf(next, DAY).find((p) => p.buildingId === b.id) : null;
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
// The neighbours on the site: those published, in their order, and the one a place's file shows
// (neighbourFor). Never people: the site's own code, compiled over the test catalogue (which holds
// her record), finds no neighbour among the people, the members, those who have left, anyone's
// residents, the homes, their name tags and portraits, the People cards, the departures board, an
// event's People or the news. The supervisor's email is still the supervisor's, and no address
// opens her: she has none, and the sky island's file shows her record.
{
  const { personPhotos } = await import(pathToFileURL(path.join(output, 'people-photos.mjs')).href);
  const hers = (p) => [p.id, p.title?.en, p.name?.en].some((v) => v === alison.id || v === 'person:' + alison.id || v === alison.title.en),
    published = next.neighbours
      .filter((n) => n.visibility === 'published')
      .sort((a, b) => a.order - b.order)
      .map((n) => n.id);
  assert.deepEqual(records.neighbourRecords.map((n) => n.id), published);
  assert.equal(records.neighbourFor('sky-island')?.id, alison.id, 'The sky island’s file has her record to show.');
  for (const place of [...buildings.map((b) => b.id).filter((id) => id !== 'sky-island'), 'people', 'corner-park', 'overview'])
    assert.equal(records.neighbourFor(place), undefined, 'Only the sky island has a neighbour, not ' + place + '.');
  for (const [what, list] of [
    ['the people', records.peopleRecords],
    ['the members', records.memberRecords(TODAY)],
    ['the members today', records.memberRecords()],
    ['those who have left', records.alumniRecords(TODAY)],
    ['those who have left today', records.alumniRecords()],
    ['the People chapter', nav.people],
    ['the People chapter on ' + DAY, nav.peopleOn(TODAY)],
    ...buildings.map((b) => ['the residents of ' + b.id, data.residentsOf(b.id, TODAY)]),
    ['the homes', data.buildingsOn(TODAY)],
  ])
    assert(!list.some(hers), 'A neighbour is among ' + what + '.');
  for (const locale of ['en', 'zh'])
    assert(!nav.homeTags(locale, TODAY).some((t) => t.label.includes('Alison')), 'A name tag names a neighbour.');
  assert(!Object.keys(personPhotos).some((id) => id.includes(alison.id)), 'A neighbour has a portrait slot.');
  assert(!nav.tourStops.some((stop) => stop.includes(alison.id)), 'The tour stops at a neighbour.');
  assert.equal(
    records.supervisorEmail(),
    catalog.people.find((p) => p.id === 'pengyuan-liu').links.find((l) => l.url.startsWith('mailto:')).url.slice('mailto:'.length),
  );
  for (const address of [alison.id, 'person:' + alison.id, 'neighbour:' + alison.id]) {
    assert(!records.getRecord(address) && !nav.isContentId(address), 'An address opens a neighbour: ' + address);
    assert.deepEqual(nav.parseLocation('#read/' + address), { mode: 'reading', content: 'overview' });
    assert.equal(nav.titleFor(address, 'en'), 'Record unavailable');
  }
  // What the page renders where people are listed or named, in both languages and both modes.
  const homes = buildings.filter((b) => b.variant).map((b) => nav.contentForBuilding(b.id));
  for (const locale of ['en', 'zh'])
    for (const reading of [false, true])
      for (const { what, element } of [
        { what: 'the People cards', element: React.createElement(PeopleCards, { locale, onOpen() {}, reading }) },
        { what: 'the departures board', element: React.createElement(DeparturesBoard, { locale, onOpen() {}, reading }) },
        { what: 'the news', element: React.createElement(NewsPreview, { locale, onOpen() {}, limit: 50 }) },
        ...['people', 'visiting-phd', 'airport', 'corner-park', ...homes, ...records.eventRecords.map((e) => 'event:' + e.id)].map((id) => ({
          what: id + '’s file',
          element: React.createElement(LabContent, { id, locale, onOpen() {}, reading }),
        })),
      ])
        assert(!renderToStaticMarkup(element).includes('Heppenstall'), what + ' (' + locale + ') shows a neighbour.');
  // A neighbour in draft is not shown: the site lists none and her place's file has none to show.
  // With a draft beside her, her place's file shows her, the one published.
  const drafted = (await siteOver('neighbour-draft', { ...next, neighbours: next.neighbours.map((n) => ({ ...n, visibility: 'draft' })) })).records;
  assert.deepEqual([drafted.neighbourRecords, drafted.neighbourFor('sky-island')], [[], undefined]);
  const beside = (
    await siteOver('neighbour-beside', { ...next, neighbours: [{ ...testNeighbour, visibility: 'draft', order: -1 }, ...next.neighbours] })
  ).records;
  assert.deepEqual([beside.neighbourRecords.map((n) => n.id), beside.neighbourFor('sky-island')?.id], [published, alison.id]);
}
// The sky island's City file (#city/sky-island). The island keeps its name; while her record is
// published its category names her and her group, as a home's names its resident's role (the file's
// eyebrow, the Directory, the hover label), and its file is hers, in this order: her role and
// affiliation, her short profile, her group (its full name, what it does, the one tie, and the way out
// to its website, its address on the button and read aloud), her staff page, her full profile folded
// away, the villa, and the places next to it. No photo of her, nor a monogram in its place. It stands
// in the Directory and the tour after the Visiting PhD Residence and before the airport.
{
  const island = buildings.find((b) => b.id === 'sky-island'),
    at = (id) => buildings.findIndex((b) => b.id === id);
  assert.deepEqual([island.name, island.short], [{ en: 'Sky Island', zh: '天空之岛' }, { en: 'Sky Island', zh: '天空之岛' }]);
  assert.deepEqual(island.category, { en: 'ALISON HEPPENSTALL · UIA', zh: 'Alison Heppenstall · UIA' }, 'The island’s category names her and UIA.');
  assert.deepEqual(island.style, { en: 'Red-brick villa', zh: '红砖别墅' });
  assert.deepEqual(island.related, ['town-hall', 'pengyuan-liu'], 'The island’s file goes on to the Town Hall and Pengyuan Liu’s home.');
  assert.deepEqual([at('sky-island'), nav.tourStops.indexOf('sky-island')], [at('visiting-phd') + 1, 6], 'The island is the 7th place in the Directory and the tour.');
  assert.equal(at('airport'), at('sky-island') + 1);
  assert.equal(glyphFor('sky-island'), 'sky', 'The island’s glyph is the cloud.');
  for (const locale of ['en', 'zh']) {
    assert.equal(nav.titleFor('sky-island', locale), island.name[locale]);
    const html = renderToStaticMarkup(React.createElement(LabContent, { id: 'sky-island', locale, onOpen() {} })),
      page = decoded(html),
      group = alison.group,
      site = locale === 'zh' ? 'UIA 官网 · urban-ai.uk' : 'UIA website · urban-ai.uk',
      aria = locale === 'zh' ? 'UIA 官网：urban-ai.uk，在新标签页打开' : 'UIA website: urban-ai.uk, opens in a new tab';
    const order = [
      alison.role[locale],
      alison.affiliation[locale],
      alison.summary[locale],
      group.name[locale] + ' · ' + group.fullName[locale],
      group.summary[locale],
      group.connection[locale],
      site,
      alison.links[0].label[locale],
      locale === 'zh' ? '完整简介' : 'Full profile',
      ...alison.sections.flatMap((s) => [s.heading[locale], s.body[locale]]),
      locale === 'zh' ? '这栋建筑' : 'About this building',
      island.style[locale],
      island.architecture[locale],
      locale === 'zh' ? '继续探索' : 'Continue exploring',
      nav.titleFor('town-hall', locale),
      nav.titleFor('pengyuan-liu', locale),
    ];
    let last = -1;
    for (const text of order) {
      const found = page.indexOf(text, last + 1);
      assert(found > last, 'The sky island’s file (' + locale + ') does not show, in its place: ' + text);
      last = found;
    }
    // The way out to UIA's website: the file's one primary button, opening a new tab.
    const button = html.match(/<a class="button-primary site-link"[^>]*>/g) ?? [];
    assert.equal(button.length, 1, 'The island’s file has one button to UIA’s website.');
    for (const attribute of ['href="https://urban-ai.uk/"', 'target="_blank"', 'rel="noopener noreferrer"', 'aria-label="' + aria + '"'])
      assert(decoded(button[0]).includes(attribute), 'UIA’s button lacks ' + attribute + ' (' + locale + ').');
    assert(page.includes('href="' + alison.links[0].url + '" target="_blank" rel="noopener noreferrer"'), 'Her staff page does not open a new tab safely.');
    assert.deepEqual(unsafeOutbound(html), [], 'A link off the island’s file is unsafe.');
    // Her full profile is folded away, a disclosure as on a person's card (its state is the browser's).
    assert(/<details class="neighbour-profile"><summary>[^<]*<svg/.test(html), 'Her full profile is not a closed disclosure.');
    assert(!/<img|portrait|monogram/.test(html), 'The island’s file shows a photo of her, or a monogram for one.');
  }
  // Were her record not published, the island would be the island's own again: its category and
  // summary, the villa and the places next to it, and nothing of hers or UIA's.
  const none = await siteOver('neighbour-none', { ...next, neighbours: next.neighbours.map((n) => ({ ...n, visibility: 'draft' })) }),
    bare = none.data.buildings.find((b) => b.id === 'sky-island');
  assert.deepEqual([bare.category, bare.summary], [
    { en: 'ABOVE THE TOWN', zh: '小城上空' },
    { en: 'A small island that floats above the town, with a red-brick villa on its lawn.', zh: '漂浮在小城上空的一座小岛，草坪上立着一栋红砖别墅。' },
  ]);
  for (const locale of ['en', 'zh']) {
    const html = decoded(renderToStaticMarkup(React.createElement(none.content.LabContent, { id: 'sky-island', locale, onOpen() {} })));
    assert(html.includes('<p class="record-lead">' + bare.summary[locale] + '</p>') && html.includes(bare.architecture[locale]), 'The empty island’s file is not its own.');
    assert(!/heppenstall|uia|urban-ai/i.test(html), 'The empty island’s file still shows her or UIA.');
    // Nor would About end with a Neighbours card.
    const about = renderToStaticMarkup(React.createElement(none.content.LabContent, { id: 'town-hall', locale, onOpen() {}, reading: true }));
    assert(!about.includes('class="neighbours"') && !/heppenstall/i.test(about), 'About keeps a Neighbours card with no neighbour published.');
  }
}
// The reading page's one way to her: a compact Neighbours card at the end of About (the Town Hall's
// chapter), after its own sections and before the building's note. It holds UIA in one line (the first
// sentence of its summary), her as one of its group leaders, the one tie, and two ways on: UIA's
// website (read aloud with its address and the new tab) and the island in the city. It is the island's
// reading address, so its file's "Read on the page" lands there, its heading taking the focus. The
// Town Hall's City file has no card. The Gate's chapter (About this site) names the island in its
// Layout, before the causeway's closing sentence.
{
  const hall = buildings.find((b) => b.id === 'town-hall'),
    island = buildings.find((b) => b.id === 'sky-island'),
    group = alison.group,
    firstOf = (text) => text.match(/^[\s\S]*?(?:[.!?](?=\s|$)|[。！？])/)[0];
  /** An element tree's elements that match, function components named in `open` called to see theirs (none of them use hooks). */
  const find = (node, match, open = [], out = []) => {
    if (Array.isArray(node)) for (const n of node) find(n, match, open, out);
    else if (node && typeof node === 'object' && 'props' in node) {
      if (match(node)) out.push(node);
      if (typeof node.type === 'function' && open.includes(node.type.name)) find(node.type(node.props), match, open, out);
      find(node.props.children, match, open, out);
    }
    return out;
  };
  for (const locale of ['en', 'zh']) {
    const zh = locale === 'zh',
      chapter = renderToStaticMarkup(React.createElement(LabContent, { id: 'town-hall', locale, onOpen() {}, reading: true, onExplore() {} })),
      card = chapter.match(/<section class="neighbours"[\s\S]*?<\/section>/)?.[0] ?? '',
      page = decoded(chapter),
      intro = firstOf(group.summary[locale]);
    assert(card, 'About (' + locale + ') has no Neighbours card.');
    assert(intro.length < group.summary[locale].length && /[.。]$/.test(intro), 'UIA’s one-line introduction is not the first sentence of its summary.');
    let last = -1;
    for (const text of [
      ...hall.sections.flatMap((s) => [s.heading[locale], s.body[locale]]),
      zh ? '近邻 · 小城上空' : 'Neighbours · Above the town',
      group.name[locale] + ' · ' + group.fullName[locale],
      intro,
      zh ? alison.title.zh + ' 是 UIA 的团队负责人之一。' : alison.title.en + ' is one of its group leaders.',
      group.connection[locale],
      zh ? 'UIA 官网' : 'UIA website',
      zh ? '在小城里打开' : 'Open in the city',
      zh ? '这栋建筑' : 'About this building',
      zh ? '继续探索' : 'Continue exploring',
    ]) {
      const found = page.indexOf(text, last + 1);
      assert(found > last, 'About (' + locale + ') does not show, in its place: ' + text);
      last = found;
    }
    // Compact: UIA's one line, not its whole summary; and the island's own reading address.
    assert(!decoded(card).includes(group.summary[locale].slice(intro.length).trim()), 'The Neighbours card holds UIA’s whole summary.');
    assert(
      card.startsWith('<section class="neighbours" id="read-sky-island"><h3 tabindex="-1">') && (chapter.match(/id="read-sky-island"/g) ?? []).length === 1,
      'The card is not the island’s reading address, or its heading cannot take the focus.',
    );
    const site = decoded(card).match(/<a class="button-primary site-link"[^>]*>/g) ?? [];
    assert.equal(site.length, 1);
    for (const attribute of [
      'href="https://urban-ai.uk/"',
      'target="_blank"',
      'rel="noopener noreferrer"',
      'aria-label="' + (zh ? 'UIA 官网：urban-ai.uk，在新标签页打开' : 'UIA website: urban-ai.uk, opens in a new tab') + '"',
    ])
      assert(site[0].includes(attribute), 'The card’s UIA website button lacks ' + attribute + ' (' + locale + ').');
    assert(
      decoded(card).includes('<button class="link-action" aria-label="' + (zh ? '在小城里打开：天空之岛 · 红砖别墅' : 'Open in the city: Sky Island · Red-brick villa') + '">'),
      'The card’s Open in the city does not say what it opens.',
    );
    // It opens the island in the city, from the chapter the page renders.
    const opened = [],
      tree = LabContent({ id: 'town-hall', locale, onOpen() {}, reading: true, onExplore: (id) => opened.push(id) });
    for (const button of find(tree, (e) => e.type === 'button' && e.props.className === 'link-action', ['NeighboursCard'])) button.props.onClick();
    assert.deepEqual(opened, ['sky-island'], 'The card’s Open in the city does not open the island in the city.');
    const explore = () => {},
      pageTree = Chapters.type({ locale, onOpen() {}, onVisit() {}, onHoverBuilding() {}, onExplore: explore });
    assert(
      find(pageTree, (e) => e.type === LabContent && e.props.id === 'town-hall').every((e) => e.props.onExplore === explore),
      'The reading page does not hand About the way to open a place in the city.',
    );
    // The Town Hall's City file has no card, and the Gate's Layout names the island.
    assert(!renderToStaticMarkup(React.createElement(LabContent, { id: 'town-hall', locale, onOpen() {} })).includes('class="neighbours"'), 'The Town Hall’s City file has the Neighbours card.');
    const layout = buildings.find((b) => b.id === 'lius-gate').sections.find((s) => s.heading.en === 'Layout').body[locale];
    assert(
      layout.includes(zh ? '小城上空还漂浮着一座带红砖别墅的天空之岛。' : 'A sky island with a red-brick villa floats above the town.'),
      'The Gate’s Layout does not name the sky island.',
    );
  }
  assert.equal(island.name.en, 'Sky Island');
}
// Her name is shown on the sky island's own surfaces and in About's Neighbours card only, never as a
// person. No other place's file, no record's, no other part of the page and not the footer names her,
// in either language or mode (in what a visitor reads or hears: her staff page's address, in the
// island's file, has her name in it).
{
  const namesHer = (html) => /heppenstall/i.test(textsOf(html).join('\n')),
    withoutCard = (html) => html.replace(/<section class="neighbours"[\s\S]*?<\/section>/, '');
  const ids = [
    'overview',
    'people',
    'corner-park',
    ...buildings.flatMap((b) => [b.id, 'place:' + b.id]),
    'person:test-member',
    'research:test-study',
    'event:test-event',
    'output:test-output',
    'note:test-note',
    ...records.peopleRecords.map(records.personContentId),
  ];
  for (const locale of ['en', 'zh']) {
    for (const reading of [false, true])
      for (const id of ids) {
        const html = renderToStaticMarkup(React.createElement(LabContent, { id, locale, onOpen() {}, reading }));
        if (id === 'town-hall' && reading) assert(namesHer(html), 'About (' + locale + ') does not name her in its Neighbours card.');
        if (!['sky-island', 'place:sky-island'].includes(id))
          assert(!namesHer(withoutCard(html)), id + '’s ' + (reading ? 'chapter' : 'file') + ' (' + locale + ') names a neighbour.');
        assert.deepEqual(unsafeOutbound(html), [], 'A link off ' + id + ' (' + locale + ') is unsafe.');
      }
    const pageText = renderToStaticMarkup(React.createElement(Chapters, { locale, onOpen() {}, onVisit() {}, onHoverBuilding() {}, onExplore() {} })),
      footer = renderToStaticMarkup(React.createElement(SiteFooter, { locale, onNavigate() {} }));
    assert(namesHer(pageText) && !namesHer(withoutCard(pageText)) && !namesHer(footer), 'The reading page (' + locale + ') names a neighbour outside About’s card.');
    assert.deepEqual([...unsafeOutbound(pageText), ...unsafeOutbound(footer)], [], 'A link off the reading page or the footer is unsafe.');
  }
}
// Every link that opens a new tab, in the site's code, opens it with neither a way back to the page nor
// its address sent along: target="_blank" goes with rel="noopener noreferrer", always.
for (const file of (await fs.readdir(path.join(root, 'app'))).filter((f) => f.endsWith('.tsx'))) {
  const source = ts.createSourceFile(file, await fs.readFile(path.join(root, 'app', file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  (function visit(node) {
    if (ts.isJsxAttributes(node)) {
      const value = (name) => {
        const a = node.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(source) === name);
        return a?.initializer && ts.isStringLiteral(a.initializer) ? a.initializer.text : a ? '{…}' : null;
      };
      if (value('target') !== null)
        assert(
          value('target') === '_blank' && value('rel') === 'noopener noreferrer',
          'app/' + file + ': a link opens a new tab without rel="noopener noreferrer" (line ' + (source.getLineAndCharacterOfPosition(node.pos).line + 1) + ').',
        );
    }
    ts.forEachChild(node, visit);
  })(source);
}
// TEST-ONLY visiting researchers (never in content/lab.json): two people whose buildingId is
// 'visiting-phd' share the residence (a home takes one), and the site's own code, compiled again
// over this catalogue, files them there.
{
  const visitor = (id, en, zh, order) => ({
    ...stayer(catalog.people[1]),
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
    () => upsertRecord(holding(visits, 'qin-li'), 'people', { ...visitor('cy-test', 'Cy Test', '测试丙', 32), buildingId: 'qin-li' }),
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
    stayersNow = membersOf(catalog, site.records.utcDay(site.records.pageDay)).filter((p) => p.buildingId === 'visiting-phd');
  for (const { locale, sep, tests } of [
    { locale: 'en', sep: ' · ', tests: ['Ada', 'Bea'] },
    { locale: 'zh', sep: '、', tests: ['测试甲', '测试乙'] },
  ])
    assert.deepEqual(
      vnav.homeTags(locale, TODAY).map((t) => [t.building, t.label]),
      [
        // One tag a home, its first resident's (a newcomer entered ahead of a departure waits).
        ...tagsOf(catalog, DAY, locale).filter(([home]) => home !== 'visiting-phd'),
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
// (whoever lives there moves out of it: Qin stays a member, without a home), so the checks can
// watch a home empty on its resident's day and fill again when someone moves in. The real people stay at the Gate on every day tried here (settle), so the departures
// board shows the test leavers alone, whatever departures the real catalogue holds.
{
  const EVE = on('2099-06-30'),
    DEPART = on('2099-07-01');
  const tester = (id, en, zh, order, buildingId, role = { en: 'PHD RESEARCHER', zh: '博士生' }) => ({
    ...stayer(catalog.people[1]),
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
  let leaving = settle(next);
  leaving = { ...leaving, people: leaving.people.map((p) => (p.buildingId === 'qin-li' ? { ...p, buildingId: null } : p)) };
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
  assert(!lrec.hasDeparted(find('test-member'), DEPART), 'Without a departure nobody leaves.');
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
  // A home keeps its current resident whoever lived there before: Yunlong Liu's home is his (or,
  // with someone entered ahead of his own departure, its first current resident's), though the
  // member who left in 2025 once lived there.
  const home = (day, id) => ldata.buildingsOn(day).find((b) => b.id === id),
    yunlongs = membersOf(leaving, DAY).filter((p) => p.buildingId === 'yunlong-liu');
  assert(yunlongs.some((p) => p.id === 'yunlong-liu') && !yunlongs.some((p) => p.id === 'test-past-member'));
  assert.deepEqual(home(TODAY, 'yunlong-liu').name, yunlongs[0].title);
  assert.deepEqual(ids(ldata.residentsOf('yunlong-liu', TODAY)), ids(yunlongs));
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
    membersOf(leaving, lrec.utcDay(lrec.pageDay)).map(lrec.personContentId),
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
    membersOf(leaving, lrec.utcDay(lrec.pageDay)).filter((p) => p.buildingId === 'visiting-phd').length,
    'The residence lists who is staying.',
  );
  assert(!residenceFile.includes('Val Visitor'), 'The visitor who went home is not listed.');
  assert(
    renderToStaticMarkup(
      React.createElement(lcontent.LabContent, { id: 'place:qin-li', locale: 'en', onOpen() {} }),
    ).includes('Fay Future is a test person.'),
  );
  // Someone who has left is filed at the airport: their chapter is Departures, their camera and
  // their file's place the airport, decided before the home their record keeps (the member who left
  // in 2025 still names Yunlong Liu's home). City mode turns to the airport's own bearing (page.tsx's
  // facing reads the chapter of the scene target), and their portrait takes the airport's colour.
  for (const id of ['person:test-past-member', 'person:test-past-visitor']) {
    for (const day of [TODAY, undefined]) {
      assert(lnav.departedOn(id, day), id + ' has left.');
      assert.equal(lnav.chapterFor(id, day), 'airport', id + ' reads in Departures.');
      assert.deepEqual(lnav.sceneTarget(id, day), { building: 'airport' }, id + ': the camera goes to the airport.');
      assert.equal(lnav.buildingForContent(id, day)?.id, 'airport');
      assert.equal(lnav.placeFor(id, day), 'airport');
      assert.deepEqual(lnav.selectionForContent(id, day), ['airport']);
    }
    assert.equal(lnav.readingChapter(id), 'airport');
    assert.equal(lnav.readingContent(id, 'airport'), id, 'Their address stays while Departures is read.');
    assert.equal(lnav.readingContent(id, 'people'), 'people');
    assert.equal(lnav.chapterFor(lnav.sceneTarget(id).building), 'airport');
    assert.equal(lcontent.houseFor(id)?.id, 'airport');
  }
  // The 2099 leaver is in People and at Qin Li's home up to the day before, at the airport from it.
  assert.equal(lnav.chapterFor('person:test-future-member', EVE), 'people');
  assert.deepEqual(lnav.sceneTarget('person:test-future-member', EVE), { building: 'qin-li' });
  assert.equal(lnav.placeFor('person:test-future-member', EVE), 'qin-li');
  assert.equal(lnav.chapterFor('person:test-future-member', DEPART), 'airport');
  assert.deepEqual(lnav.sceneTarget('person:test-future-member', DEPART), { building: 'airport' });
  assert.equal(lnav.buildingForContent('person:test-future-member', DEPART)?.id, 'airport');
  assert.equal(lnav.placeFor('person:test-future-member', DEPART), 'airport');
  assert.deepEqual(lnav.selectionForContent('person:test-future-member', DEPART), ['airport']);
  assert(!lnav.departedOn('person:test-member', DEPART) && lnav.chapterFor('person:test-member', DEPART) === 'people', 'Without a departure nobody is filed at the airport.');
  assert(!lnav.departedOn('airport') && !lnav.departedOn('event:test-farewell'), 'Only a person can have left.');
  // The departures board: who has left, newest first, each row a sentence read aloud. On the
  // reading page a row is the <details> its address opens, folding out the portrait, profile and
  // links; in the City file it is a button that opens the person's file. Dates to the month.
  const sentences = {
    en: [
      'Val Visitor: returned August 2026 to Testburg, Ireland. Now: Test Institute.',
      'Pat Former: departed June 2025 for Testford, Scotland. Now: Test University, Postdoctoral researcher.',
    ],
    zh: [
      '测试丁：2026年8月返程，回到爱尔兰测试堡。现任：测试研究所。',
      '测试丙：2025年6月启程，前往测试福德。现任：测试大学，博士后研究员。',
    ],
  };
  const boardOn = (props) =>
    renderToStaticMarkup(
      React.createElement(lcontent.DeparturesBoard, { locale: 'en', onOpen() {}, reading: true, today: TODAY, ...props }),
    );
  /** Each row's flaps in one column, in the board's order: date, name, destination, now, status. */
  const flaps = (html, column) => {
    const order = ['date', 'name', 'destination', 'now', 'status'],
      next = order[order.indexOf(column) + 1];
    return [...html.matchAll(/<(summary|button) class="board-row"[\s\S]*?<\/\1>/g)].map(([row]) => {
      const start = row.indexOf('board-cell board-' + column + '"'),
        end = next ? row.indexOf('board-cell board-' + next + '"') : row.length;
      return [...row.slice(start, end).matchAll(/class="flap"[^>]*>([^<]*)</g)].map((f) => f[1]);
    });
  };
  for (const locale of ['en', 'zh']) {
    const zh = locale === 'zh',
      page = boardOn({ locale }),
      city = boardOn({ locale, reading: false });
    assert.deepEqual(
      [...page.matchAll(/<details class="board-entry" id="read-([^"]+)"><summary class="board-row" aria-label="([^"]+)">/g)].map((m) => [m[1], m[2]]),
      [
        ['person:test-past-visitor', sentences[locale][0]],
        ['person:test-past-member', sentences[locale][1]],
      ],
      'The board, newest first, each row the anchor of its address (' + locale + ').',
    );
    assert.deepEqual(
      [...city.matchAll(/<button class="board-row" aria-label="([^"]+)">/g)].map((m) => m[1]),
      sentences[locale],
      'In the City file each row is a button (' + locale + ').',
    );
    assert(!city.includes('<details') && !city.includes('<h3') && page.includes('<h3 class="board-cell board-name" tabindex="-1">'));
    for (const html of [page, city]) {
      assert(
        html.includes('<time class="flap" dateTime="2026-08-31">' + (zh ? '2026年8月' : 'Aug 2026') + '</time>') &&
          html.includes('<time class="flap" dateTime="2025-06-30">' + (zh ? '2025年6月' : 'Jun 2025') + '</time>'),
        'Departure dates to the month (' + locale + ').',
      );
      assert.deepEqual(flaps(html, 'destination'), zh ? [['爱尔兰测试堡'], ['测试福德']] : [['Testburg, Ireland'], ['Testford, Scotland']]);
      assert.deepEqual(flaps(html, 'now'), zh ? [['测试研究所'], ['测试大学', '博士后研究员']] : [['Test Institute'], ['Test University', 'Postdoctoral researcher']]);
      assert.deepEqual(flaps(html, 'status'), zh ? [['已返程'], ['已启程']] : [['Returned'], ['Departed']], 'A visitor has gone home, a member has set off.');
      assert(
        html.includes(
          '<div class="board-head" aria-hidden="true">' +
            (zh ? ['日期', '姓名', '目的地', '现任', '状态'] : ['Date', 'Name', 'Destination', 'Now', 'Status'])
              .map((label, i) => '<span class="board-' + ['date', 'name', 'destination', 'now', 'status'][i] + '">' + label + '</span>')
              .join('') +
            '</div>',
        ) &&
          html.includes('<div class="departures' + (zh ? ' is-zh' : '') + '">') &&
          html.includes('<ol class="board-rows" aria-label="' + (zh ? '出发' : 'Departures') + '">'),
        'The board’s columns: date, name, destination, now and status (' + locale + ').',
      );
      assert(!html.includes('is-tba') && !html.includes(zh ? '首批启程' : 'First departures'), 'The empty state is gone once someone has left.');
      if (!zh) assert(!/[㐀-鿿]/.test(html), 'The English board contains Chinese.');
    }
    // A row's fold-out: the person's portrait (in the airport's colour), their summary, profile and links.
    if (!zh)
      assert(
        page.includes('<div class="board-profile"><div class="portrait portrait-small" style="--tint:#a9b7a3">') &&
          page.includes('Pat Former is a test person.') &&
          page.includes('href="https://example.org/past-member"'),
        'A reading row folds out the portrait, profile and links.',
      );
    // The role it shows is marked as theirs at Liu’s Gate, so the row's Now reads as the present.
    assert(
      page.includes('<div class="board-profile-body"><span class="eyebrow">' + (zh ? '在刘家门时 · 博士生' : 'At Liu’s Gate · PHD RESEARCHER') + '</span>') &&
        page.includes('<div class="board-profile-body"><span class="eyebrow">' + (zh ? '在刘家门时 · 访问博士生' : 'At Liu’s Gate · VISITING PHD RESEARCHER') + '</span>'),
      'A reading row’s fold-out marks the role held here (' + locale + ').',
    );
  }
  // A departure entered ahead joins the board on its day, at the top.
  assert.deepEqual(
    [...boardOn({ today: DEPART }).matchAll(/id="read-([^"]+)"/g)].map((m) => m[1]),
    ['person:test-future-member', 'person:test-past-visitor', 'person:test-past-member'],
  );
  assert(
    renderToStaticMarkup(
      React.createElement(lcontent.LabContent, { id: 'airport', locale: 'en', onOpen() {}, reading: true }),
    ).includes('id="read-person:test-past-member"'),
    'The airport’s chapter shows the board on the visitor’s day.',
  );
  // Their City file: the role they held here marked as theirs at Liu’s Gate, a Now line, the status
  // and the month they left, a way back to the board, their own link, and the airport's note rather
  // than the home they left.
  for (const [id, role, now, status, when, home] of [
    ['person:test-past-member', 'PHD RESEARCHER', 'Test University · Postdoctoral researcher', 'Departed', '<time dateTime="2025-06-30">June 2025</time> · Testford, Scotland', 'Red sandstone terrace'],
    ['person:test-past-visitor', 'VISITING PHD RESEARCHER', 'Test Institute', 'Returned', '<time dateTime="2026-08-31">August 2026</time> · Testburg, Ireland', 'Contemporary apartment house'],
  ]) {
    const file = renderToStaticMarkup(React.createElement(lcontent.LabContent, { id, locale: 'en', onOpen() {} }));
    assert(
      file.includes('<span class="eyebrow">At Liu’s Gate · ' + role + '</span>') &&
        file.includes('<p class="record-now"><span class="eyebrow">Now</span><span>' + now + '</span></p>') &&
        file.includes('<span class="pill pill-neutral">' + status + '</span>') &&
        file.includes('<span class="record-date">' + when + '</span>') &&
        file.includes('>Departures board<'),
      'The file of ' + id + ' says where they are now.',
    );
    assert(file.includes('<em>Island airport</em>') && !file.includes('<em>' + home + '</em>'), id + '’s note is the airport’s.');
    assert(file.includes('style="--tint:#a9b7a3"'), id + '’s portrait takes the airport’s colour.');
  }
  assert(
    renderToStaticMarkup(React.createElement(lcontent.LabContent, { id: 'person:test-past-member', locale: 'en', onOpen() {} })).includes(
      'href="https://example.org/past-member"',
    ),
    'Their own link replaces a student mailbox that has closed.',
  );
  {
    const stayer = renderToStaticMarkup(React.createElement(lcontent.LabContent, { id: 'person:test-future-member', locale: 'en', onOpen() {} }));
    assert(
      !stayer.includes('record-now') && stayer.includes('<span class="eyebrow">PHD RESEARCHER</span>') && !stayer.includes('At Liu’s Gate ·'),
      'Someone still here has no Now line, and their role is their own today.',
    );
  }
  const fileZh = renderToStaticMarkup(React.createElement(lcontent.LabContent, { id: 'person:test-past-member', locale: 'zh', onOpen() {} }));
  assert(fileZh.includes('<span class="eyebrow">在刘家门时 · 博士生</span>') && fileZh.includes('<span class="eyebrow">现任</span><span>测试大学 · 博士后研究员</span>') && fileZh.includes('>已启程<') && fileZh.includes('2025年6月') && fileZh.includes('>出发屏<'));
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
  // A founding member's address is their home's id ('qin-li'). Once they have left, that address is
  // filed at the airport, but the home they left is still a home: City mode faces it, and whoever
  // lives there next, from the People chapter's bearing, never the airport's. TEST-ONLY: here Qin Li
  // left in 2025 from the home the 2099 leaver lives in, and Sam Successor moves in after them.
  {
    const qin = leaving.people.find((p) => p.id === 'qin-li'),
      { nav: fnav, data: fdata } = await siteOver(
        'founder',
        upsertRecord(
          upsertRecord(leaving, 'people', { ...qin, buildingId: 'qin-li', departure }),
          'people',
          tester('test-successor', 'Sam Successor', '测试己', 24, 'qin-li'),
        ),
      );
    assert(fnav.departedOn('qin-li', TODAY) && fnav.facingChapter('qin-li', TODAY) === 'airport', 'Her own address is faced at the airport.');
    assert.deepEqual(
      [fnav.contentForBuilding('qin-li', TODAY), fnav.contentForBuilding('qin-li', DEPART)],
      ['person:test-future-member', 'person:test-successor'],
    );
    for (const day of [TODAY, DEPART])
      for (const b of fdata.buildingsOn(day)) {
        const chapter = fdata.dwelling(b) ? 'people' : b.id;
        for (const id of [fnav.contentForBuilding(b.id, day), 'place:' + b.id])
          assert.equal(
            fnav.facingChapter(id, day),
            chapter,
            `On ${day.toISOString().slice(0, 10)} City mode does not face ${id} from the ${chapter} chapter's bearing.`,
          );
      }
  }
  // A page left open past midnight UTC into someone's departure day goes on by the day it was
  // loaded on (pageDay) until it is reloaded, so all it shows agrees: the People chapter and the
  // homes, read once, and the name tags, what a home opens, the People framing, the tour, the
  // leaver's chapter, camera and file and the departures board, read on each render or click. The
  // leaver here sets off two days from now, ahead of the 2099 leaver in Qin Li's home by order, and
  // the clock is then moved on two days.
  {
    const RealDate = Date,
      ahead = 2 * 86_400_000,
      setOff = new RealDate(RealDate.now() + ahead).toISOString().slice(0, 10);
    const { nav: mnav, records: mrec, data: mdata, content: mcontent } = await siteOver(
      'midnight',
      upsertRecord(leaving, 'people', {
        ...tester('test-soon', 'Sol Soon', '测试庚', 22.5, 'qin-li'),
        departure: { ...departure, date: setOff },
      }),
    );
    const view = () => [
      mnav.people.map((p) => p.id),
      mrec.memberRecords().map((p) => p.id),
      mdata.residentsOf('qin-li').map((p) => p.id),
      mdata.buildingsOn().find((b) => b.id === 'qin-li').name.en,
      mnav.homeTags('en').map((t) => [t.building, t.label]),
      mnav.contentForBuilding('qin-li'),
      mnav.selectionForContent('people'),
      mnav.tourOn(),
      mrec.hasDeparted(mrec.peopleRecords.find((p) => p.id === 'test-soon')),
      mrec.alumniRecords().map((p) => p.id),
      [mnav.chapterFor('person:test-soon'), mnav.facingChapter('person:test-soon'), mnav.placeFor('person:test-soon')],
      renderToStaticMarkup(React.createElement(mcontent.LabContent, { id: 'person:test-soon', locale: 'en', onOpen() {} })),
      renderToStaticMarkup(React.createElement(mcontent.DeparturesBoard, { locale: 'en', onOpen() {}, reading: true })),
    ];
    const loaded = view();
    assert.equal(loaded[5], 'person:test-soon', 'Until the day they set off, the home is theirs.');
    globalThis.Date = class extends RealDate {
      constructor(...args) {
        super(...(args.length ? args : [RealDate.now() + ahead]));
      }
      static now() {
        return RealDate.now() + ahead;
      }
    };
    try {
      assert(!mrec.memberRecords(new Date()).some((p) => p.id === 'test-soon'), 'On the moved clock they have left.');
      assert.deepEqual(view(), loaded, 'An open page keeps the day it was loaded on.');
    } finally {
      globalThis.Date = RealDate;
    }
  }
}
// Every record, the hero and every chapter read on the page. A place filed under a chapter the page
// had no section for (the airport's, until its Departures chapter was written) did not: its reading
// address opened the page at its top and its City file offered no "Read on the page". Now every
// reading chapter has its section, in order, Departures as chapter 03 right after People.
for (const id of ['overview', ...chapterMeta.map((c) => c.id), 'person:test-member', 'research:test-study', 'event:test-event', 'output:test-output', 'note:test-note', ...buildings.map((b) => b.id)])
  assert.equal(onReadingPage(id), id === 'overview' || chapterMeta.some((c) => c.id === nav.readingChapter(id)), `${id} is read on the page wrongly.`);
assert(['overview', 'person:test-member', 'event:test-event', 'airport'].every(onReadingPage), 'A record, a place or the hero is not on the reading page.');
assert.deepEqual(chapterMeta.map((c) => c.id), nav.readingChapters, 'Every reading chapter has its section on the page, in order.');
assert(buildings.every((b) => onReadingPage(b.id)), 'Every place reads on the page.');
assert.deepEqual(chapterMeta[2], {
  id: 'airport',
  label: { en: 'Alumni', zh: '去向' },
  title: { en: 'Departures', zh: '出发与去向' },
  place: { en: 'Airport · Off the north shore', zh: '机场 · 北岸离岛' },
});
assert.equal(chapterMeta[1].id, 'people', 'Departures comes right after People.');
// The masthead holds a chip for each chapter. Seven were measured in a browser at 961, 980, 1000,
// 1024 and 1040 px (and just past, at 1041) with the chips' padding trimmed up to 1040 px: the
// narrowest gaps, beside City mode's wider "Reading view", are 29.6 px at 961 and 46.2 px at 1041.
// The trim has no lower bound, so it meets the rule that hides the nav at 960 px with no gap
// between them: a width between 960 and 961 px (page zoom, display scaling) showed the chips at
// full padding. An eighth chapter needs measuring again.
{
  const css = await fs.readFile(path.join(root, 'app/globals.css'), 'utf8');
  assert(
    /@media \(max-width: 1040px\) \{\s*\.masthead-nav a \{\s*padding: 7px 10px;\s*\}\s*\}/.test(css) &&
      /\.masthead-nav a \{\s*padding: 7px 13px;/.test(css),
    'The masthead’s chips are no longer trimmed up to 1040 px.',
  );
  assert(
    !/@media \(min-width: [\d.]+px\) and \(max-width: 1040px\)/.test(css) &&
      /@media \(max-width: 960px\) \{\s*:root \{\s*--masthead: 58px;\s*\}\s*\.masthead-nav \{\s*display: none;\s*\}/.test(css),
    'The chips’ trim and the rule that hides the nav at 960 px leave a gap between them.',
  );
  assert(chapterMeta.length <= 7, 'The masthead was measured with seven chapter chips: measure it again in a browser at 961-1040 px.');
  // Still seven: the sky island has a City file and a card in About, but no chapter or chip.
  assert.equal(chapterMeta.length, 7);
  assert(!chapterMeta.some((c) => c.id === 'sky-island'), 'The sky island has a masthead chip.');
}
// Up to 960 px the reading page scrolls under the masthead, and its text ran into the bare
// wordmark: there the wordmark sits on the buttons' glass, a pill of their height. The glass is a
// layer of its own inside the link (.wordmark-glass), listed beside the language switch in every
// shared glass rule (the surface, the night frost, the specular ring, both accessibility
// fallbacks) and in the lens's list. On desktop the layer has no box and the wordmark's own rules
// give it no surface, so nothing changes there. The surface's border stays transparent (only the
// more-contrast fallback draws one, on every chip alike), and nothing puts a shadow on the name.
{
  const css = (await fs.readFile(path.join(root, 'app/globals.css'), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, ''),
    page = await fs.readFile(path.join(root, 'app/page.tsx'), 'utf8'),
    chrome = await fs.readFile(path.join(root, 'app/site-chrome.tsx'), 'utf8');
  /** Every style rule in the sheet: its selectors, its declarations and the at-rules around it. */
  const rules = [];
  (function walk(text, at) {
    for (let i = 0; ; ) {
      const open = text.indexOf('{', i);
      if (open < 0) return;
      let depth = 1,
        end = open + 1;
      for (; depth; end++) depth += text[end] === '{' ? 1 : text[end] === '}' ? -1 : 0;
      const head = text.slice(i, open).split(';').pop().trim(),
        body = text.slice(open + 1, end - 1);
      if (/^@(media|supports|container)\b/.test(head)) walk(body, [...at, head]);
      else if (!head.startsWith('@')) rules.push({ at: at.join(' '), selectors: head.split(',').map((s) => s.trim()), body });
      i = end;
    }
  })(css, []);
  const NARROW = '@media (max-width: 960px)',
    rule = (selector, at = '') => rules.find((r) => r.at === at && r.selectors.includes(selector)),
    has = (r, decl) => !!r && new RegExp(`(^|;)\\s*${decl.replace(/[()]/g, '\\$&')};`).test(r.body);
  // The glass in every shared rule beside the language switch, and in the lens's list.
  const surface = rules.find((r) => r.body.includes('--glass-tint: linear-gradient'));
  assert(
    surface &&
      !surface.at &&
      surface.selectors.includes('.lang-switch') &&
      surface.selectors.includes('.wordmark-glass') &&
      has(surface, 'border: 1px solid transparent') &&
      rule(":root[data-theme='night'] .lang-switch")?.selectors.includes(":root[data-theme='night'] .wordmark-glass") &&
      rule('.lang-switch::before')?.selectors.includes('.wordmark-glass::before') &&
      rule('.lang-switch', '@media (prefers-reduced-transparency: reduce)')?.selectors.includes('.wordmark-glass') &&
      rule('.lang-switch', '@media (prefers-contrast: more)')?.selectors.includes('.wordmark-glass'),
    'The wordmark’s glass is not on the buttons’ glass: the shared surface, night frost, ring and fallbacks all list it beside .lang-switch.',
  );
  const lens = page.match(/const REFRACTING_GLASS =\s*'([^']*)'/)?.[1].split(', ') ?? [];
  assert(lens.includes('.lang-switch') && lens.includes('.wordmark-glass'), 'The wordmark’s glass does not refract at the rim as the buttons do.');
  assert(
    /<a\s+className="wordmark"[\s\S]*?<span className="wordmark-glass" aria-hidden="true" \/>\s*<GateMark size=\{26\} \/>\s*<span className="wordmark-name">/.test(chrome),
    'The wordmark link no longer holds its glass, behind the gate mark and the name.',
  );
  // A pill of the buttons' height up to 960 px, the glass filling it; on desktop the glass has no box.
  const buttons = rules.find((r) => !r.at && r.selectors.includes('.lang-switch') && /min-height:/.test(r.body)),
    height = buttons?.body.match(/min-height: ([\d.]+px);/)?.[1],
    pill = rule('.wordmark', NARROW),
    glass = rule('.wordmark-glass', NARROW);
  assert(
    height &&
      has(pill, `min-height: ${height}`) &&
      has(pill, 'border-radius: 999px') &&
      has(pill, 'position: relative') &&
      /(^|;)\s*padding: 0 1[2-6]px;/.test(pill.body) &&
      ['display: block', 'position: absolute', 'inset: 0', 'border-radius: inherit'].every((d) => has(glass, d)),
    'Up to 960 px the wordmark is no longer a pill of the buttons’ height with its glass filling it.',
  );
  const shows = rules.filter((r) => r.selectors.includes('.wordmark-glass') && /(^|;)\s*display:/.test(r.body));
  assert(
    shows.length === 2 && shows.includes(glass) && shows.some((r) => !r.at && r.selectors.length === 1 && has(r, 'display: none')),
    'The wordmark’s glass shows outside the narrow layout: on desktop it must have no box.',
  );
  // The rules that style the link itself (.wordmark in a selector's last part).
  const wordmark = rules.filter((r) => r.selectors.some((s) => /\.wordmark(?![-\w])\S*$/.test(s)));
  assert(
    wordmark
      .filter((r) => r !== pill)
      .every((r) => !/(^|;)\s*(-webkit-)?(background|backdrop-filter|border|box-shadow|padding|min-height|outline)(-[a-z-]+)?:/.test(r.body)),
    'The desktop wordmark gained a surface: its rules outside the 960 px block must stay as they were.',
  );
  // No border colour on the pill or its glass (outside the more-contrast fallback), no text-shadow
  // on the name or anything it inherits from.
  const reaching = rules.filter((r) =>
    r.selectors.some((s) => /\.wordmark|\.masthead(?![-\w])|^(html|body|\*|\.site)$|^:root(\[[^\]]*\])*$/.test(s)),
  );
  assert(
    reaching
      .filter((r) => r.at !== '@media (prefers-contrast: more)' && r.selectors.some((s) => /\.wordmark(-glass)?(?![-\w])/.test(s)))
      .every((r) => !/(^|;)\s*border(-[a-z]+)*-color:/.test(r.body) && [...r.body.matchAll(/(^|;)\s*border:([^;]*);/g)].every((m) => /transparent/.test(m[2]))) &&
      reaching.every((r) => !/text-shadow:/.test(r.body)),
    'The wordmark’s pill has a border colour or its name a text-shadow: the glass has no border and the text no glow.',
  );
  // Up to 960 px the masthead's chips keep to the stage's edge: the pill right above the sky chip,
  // the buttons in line with the camera bar, both ends with the tour bar's.
  const inset = rule('.masthead', NARROW)?.body.match(/(^|;)\s*padding: 0 ([\d.]+px);/)?.[2];
  assert(
    inset &&
      [['.stage-caption', 'left'], ['.hud-sky', 'left'], ['.hud-camera', 'right'], ['.tour-control', 'left'], ['.tour-control', 'right']].every(
        ([selector, side]) => has(rule(selector, NARROW), `${side}: ${inset}`),
      ),
    'Up to 960 px the masthead’s chips are out of line with the sky chip, the bars and the tour bar: they share one edge.',
  );
}
// The board's settle-flip (lab-content.tsx; the static render runs no effects, so its source): it
// is settled by whatever ends its effect, so 中文 pressed mid-flip cannot leave every cell's flip on
// for good (replayed each time the board is shown again), and it never shows in Chinese.
{
  const source = await fs.readFile(path.join(root, 'app/lab-content.tsx'), 'utf8');
  assert(
    /return \(\) => \{\s*watch\.disconnect\(\);\s*window\.clearTimeout\(settled\);\s*setFlipping\(false\);\s*\};\s*\}, \[zh, where\]\);/.test(source) &&
      source.includes("${flipping && !zh ? ' is-flipping' : ''}"),
    'A language switched mid-flip leaves the board flipping.',
  );
}
// The departures board's flaps and layouts (globals.css).
{
  const css = await fs.readFile(path.join(root, 'app/globals.css'), 'utf8');
  const block = (start) => {
    const at = css.indexOf(start);
    assert(at >= 0, start.trim() + ' is gone from globals.css.');
    return css.slice(at, css.indexOf('\n}\n', at) + 2);
  };
  // By day a flap's split shows only at its two ends, its hinges: run across the dark capitals it
  // read as a strikethrough, which on a departures board means cancelled. At night it runs across
  // the flap and cuts the pale text, as on a real board, and across a blank tile always. It is dark,
  // never white.
  const day = block('\n.departures {'),
    night = block(":root[data-theme='night'] .departures {"),
    layers = block('\n.flap {').match(/background:([\s\S]*?);/)[1];
  assert(
    /--flap-split: color-mix\(in oklab, var\(--ink\) 18%, transparent\);/.test(day) &&
      /--flap-hinge: var\(--flap-split\);/.test(day) &&
      /--flap-cut: transparent;/.test(day) &&
      /--flap-split: rgba\(0, 0, 0, 0\.45\);/.test(night) &&
      /--flap-hinge: transparent;/.test(night) &&
      /--flap-cut: var\(--flap-split\);/.test(night) &&
      /--flap-cut: var\(--flap-split\);/.test(block('\n.flap.is-blank {')),
    'By day the split shows only at a flap’s hinges; at night, and on a blank tile, it runs across.',
  );
  assert(
    (layers.match(/linear-gradient\(var\(--flap-hinge\), var\(--flap-hinge\)\) (left|right) center \/ 2px 1px no-repeat/g) || []).length === 2 &&
      /var\(--flap-cut\) calc\(50% - 0\.5px\) calc\(50% \+ 0\.5px\)/.test(layers) &&
      !layers.includes('--flap-split'),
    'A flap’s split by day runs across its text.',
  );
  // Its layouts by the board's inside width, as its container queries measure it: one line of five
  // columns from 692 px; from 464 px the date, name, destination and status in a line with where
  // they are now under it; narrower, the destination under the date. Worked out from the rules
  // themselves (Plex Mono is 0.6 em a character), every field of the rows we know of keeps to one
  // flap at each width measured in a browser (a 390 px phone 312, the City file 383, the reading
  // panel at 1024 433, 1280 468, 1440 536 and 1920 542, tablets at 768 663 and 800 695) and on
  // either side of each break.
  const rules = {
      line: block('\n.board-head,\n.board-row {'),
      middle: block('@container departures (max-width: 691.98px) {'),
      narrow: block('@container departures (max-width: 463.98px) {'),
      phone: block('@container departures (max-width: 400px) {'),
    },
    areas = (rule) => rule.match(/grid-template-areas:([^;]+);/)[1].replace(/\s+/g, ' ').trim(),
    fr = (rule) => [...rule.match(/grid-template-columns:([^;]+);/)[1].matchAll(/minmax\(0, ([\d.]+)fr\)/g)].map((m) => +m[1]),
    px = (rule, property) => +rule.match(new RegExp('\\b' + property + ': ([\\d.]+)px'))[1],
    cell = block('\n.board-row .board-date,'),
    flap = block('\n.flap {');
  assert.deepEqual(
    [rules.line, rules.middle, rules.narrow].map(areas),
    [
      "'date name destination now status mark'",
      "'date name destination status mark' '. now now now .'",
      "'date name name status mark' 'destination destination now now now'",
    ],
  );
  assert(/--board-date: 72px;/.test(day) && /--board-status: 72px;/.test(day) && /grid-template-columns:\s*var\(--board-date\)[^;]*var\(--board-status\)\s*14px;/.test(rules.line));
  // An unlit status (the empty row's) is blank tiles like the date's, not the status's amber flap;
  // its four tiles fit the narrower Chinese status column.
  const tile = +block('\n.flap.is-blank {').match(/width: ([\d.]+)px;/)[1],
    tileGap = +block('\n.flap-blanks {').match(/gap: ([\d.]+)px;/)[1],
    zhStatus = +block('\n.departures.is-zh {').match(/--board-status: ([\d.]+)px;/)[1];
  assert(/\n\.board-status \.flap\.is-blank \{\s*--flap: inherit;\s*\}/.test(css) && 4 * tile + 3 * tileGap <= zhStatus, 'The empty row’s blank status is not the date’s blank tiles, or does not fit the Chinese status column.');
  const type = {
    wide: { size: px(cell, 'font-size'), track: +flap.match(/letter-spacing: ([\d.]+)em;/)[1], pad: +flap.match(/padding: 3px (\d+)px;/)[1] },
    phone: { size: px(rules.phone, 'font-size'), track: +rules.phone.match(/letter-spacing: ([\d.]+)(em)?;/)[1], pad: +rules.phone.match(/padding: 3px (\d+)px;/)[1] },
  };
  const flapWidth = (text, { size, track, pad }) => text.length * size * (0.6 + track) + 2 * pad;
  for (const inner of [312, 383, 400, 401, 433, 463, 464, 468, 536, 542, 663, 691, 692, 695]) {
    const phone = inner <= 400,
      rule = inner >= 692 ? rules.line : inner >= 464 ? rules.middle : rules.narrow,
      ratio = fr(rule),
      gap = px(phone ? rules.phone : rule, 'column-gap'),
      pad = phone ? px(rules.phone, 'padding-left') : px(rules.line, 'padding'),
      unit = (inner - 2 * pad - 72 - 72 - 14 - gap * (ratio.length + 2)) / ratio.reduce((a, b) => a + b),
      col = ratio.map((r) => r * unit),
      [destination, now] =
        rule === rules.line
          ? [col[1], col[2]]
          : rule === rules.middle
            ? [col[1], col[0] + col[1] + 72 + 2 * gap]
            : [72 + gap + col[0], col[1] + gap + 72 + gap + 14],
      t = type[phone ? 'phone' : 'wide'];
    for (const [text, room] of [
      ['Freiburg, Germany', destination],
      ['To be announced', destination],
      ['University of Leeds', now],
      ['University College Cork', now],
      ['Dec 2026', 72],
      ['Returned', 72],
      ['Departed', 72],
    ])
      assert(flapWidth(text, t) <= room, `On a board ${inner} px inside, "${text}" (${flapWidth(text, t).toFixed(1)} px) no longer keeps to one flap (${room.toFixed(1)} px).`);
  }
  // In Chinese the date column fits a two-digit month ("2026年12月", 87.6 px measured with Inter's
  // tabular figures), and the column heads are set at the page's other Chinese labels' size.
  assert(/--board-date: 92px;/.test(block('\n.departures.is-zh {')) && /font-size: 11\.5px;/.test(block('\n.departures.is-zh .board-head {')));
}
// The reading page numbers its seven chapters; the airport's is 03 and holds the departures board.
for (const locale of ['en', 'zh']) {
  const story = renderToStaticMarkup(
    React.createElement(Chapters, { locale, onOpen() {}, onVisit() {}, onHoverBuilding() {}, onExplore() {} }),
  );
  assert.deepEqual(
    [...story.matchAll(/<section class="chapter" id="read-([^"]+)" data-chapter="\1">[\s\S]*?<span class="chapter-no">(\d+)<\/span>/g)].map((m) => m[1] + ' ' + m[2]),
    ['town-hall 01', 'people 02', 'airport 03', 'research-studio 04', 'city-archive 05', 'corner-park 06', 'lius-gate 07'],
  );
  const airport = story.slice(story.indexOf('id="read-airport"'), story.indexOf('id="read-research-studio"'));
  assert(
    airport.includes(locale === 'zh' ? '>出发与去向</h2>' : '>Departures</h2>') &&
      airport.includes(locale === 'zh' ? '机场 · 北岸离岛' : 'Airport · Off the north shore') &&
      airport.includes('<div class="departures'),
    'The Departures chapter (' + locale + ') holds the board.',
  );
}
// The page's own board is the visitor's day's: whoever has left by then, newest first, or the row
// to be announced while nobody has.
{
  const board = renderToStaticMarkup(React.createElement(DeparturesBoard, { locale: 'en', onOpen() {}, reading: true })),
    gone = alumniOf(next, NOW);
  assert.deepEqual(
    [...board.matchAll(/<details class="board-entry" id="read-([^"]+)">/g)].map((m) => m[1]),
    gone.map(records.personContentId),
    'The page’s board lists who has left by the visitor’s day.',
  );
  assert.equal(board.includes('is-tba'), !gone.length, 'The page’s board is empty only while nobody has left.');
}
// While nobody has left (on DAY, in a catalogue where nobody leaves before 2099 whatever departures
// the real one holds) the board shows one row still to be announced, saying so once, in its
// destination: blank tiles for its date, where they are now and its status (a status of TBA / 待定
// only repeated the destination), and under it a note for visitors. A blank field is four small
// tiles, as an unlit board shows it: one long blank bar read as a page still loading. The row is
// read aloud as "First departure: to be announced.".
const { DeparturesBoard: EmptyBoard } = (await siteOver('settled', settle(next))).content;
const blankTiles =
  '<span class="flap-blanks" aria-hidden="true">' + '<span class="flap is-blank">\u00a0</span>'.repeat(4) + '</span>';
for (const reading of [true, false]) {
  const empty = (locale) =>
    renderToStaticMarkup(React.createElement(EmptyBoard, { locale, onOpen() {}, reading, today: TODAY }));
  const en = empty('en'),
    zh = empty('zh');
  for (const html of [en, zh])
    assert(
      html.includes('<span class="board-cell board-date">' + blankTiles + '</span>') &&
        html.includes('<span class="board-cell board-now">' + blankTiles + '</span>') &&
        html.includes('<span class="board-cell board-status">' + blankTiles + '</span>') &&
        (html.match(/class="flap is-blank"/g) || []).length === 12,
      'The empty row’s date, where they are now and its status are blank tiles.',
    );
  assert(
    en.includes('<li class="board-row is-tba" aria-label="First departure: to be announced.">') &&
      en.includes('<span class="board-cell board-name">First departure</span>') &&
      en.includes('<span class="board-cell board-destination"><span class="flap">To be announced</span></span>') &&
      (en.match(/>To be announced</g) || []).length === 1 &&
      !en.includes('TBA') &&
      en.includes('<h4>First departures</h4>') &&
      en.includes(
        '<p>Everyone at Liu’s Gate is still here. When members finish their PhDs and move on, or visiting researchers head home, this board will show where each of them went and when they set off.</p>',
      ) &&
      (en.match(/<li/g) || []).length === 1 &&
      !en.includes('<details') &&
      !en.includes('<button'),
    'The empty board (English).',
  );
  assert(!/[㐀-鿿]/.test(en), 'The English board contains Chinese.');
  assert(
    zh.includes('<li class="board-row is-tba" aria-label="首个航班：待定。">') &&
      zh.includes('<span class="board-cell board-name">首个航班</span>') &&
      zh.includes('<span class="board-cell board-destination"><span class="flap">待定</span></span>') &&
      (zh.match(/<span class="flap">待定<\/span>/g) || []).length === 1 &&
      zh.includes('<h4>首批启程</h4>') &&
      zh.includes(
        '<p>刘家门的成员都还在这里。等有人完成博士学业奔赴下一站，或访问学者回到自己的学校，这块屏会显示每个人去了哪里、何时启程。</p>',
      ),
    'The empty board (Chinese).',
  );
}
// The airport's file and chapter show the board as the visitor finds it: empty while nobody has left.
for (const reading of [true, false]) {
  const file = renderToStaticMarkup(React.createElement(LabContent, { id: 'airport', locale: 'en', onOpen() {}, reading }));
  assert(
    file.includes('<div class="departures">') &&
      file.includes('is-tba') === !records.alumniRecords().length &&
      file.includes('<em>Island airport</em>'),
    'The airport shows its departures board.',
  );
}
// The chapter at the gate is about this site; the name story was removed at the owner's request.
const gate = buildings.find((b) => b.id === 'lius-gate');
assert.deepEqual(gate.sections.map((s) => s.heading.en), ['Layout', 'How to use the site']);
// The Gate's layout and the Town Hall's note on this site each end on the causeway and the airport.
for (const [where, body] of [
  ['the Gate’s Layout', gate.sections.find((s) => s.heading.en === 'Layout').body],
  ['the Town Hall’s This site', buildings.find((b) => b.id === 'town-hall').sections.find((s) => s.heading.en === 'This site').body],
]) {
  const last = (text, stop) => text.split(stop).filter((s) => s.trim()).pop();
  assert(
    /causeway/.test(last(body.en, '. ')) && /airport/.test(last(body.en, '. ')) &&
      last(body.zh, '。').includes('堤道') && last(body.zh, '。').includes('机场'),
    where + ' says where the causeway leads.',
  );
  // Behind the Town Hall by name: "the hall" could be the airport's own Departures Hall.
  assert(/behind the Town Hall/i.test(last(body.en, '. ')) && last(body.zh, '。').includes('市政厅背后'), where + ' says the causeway is behind the Town Hall.');
}
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
// the repository's), the page's own HTML, and the neighbours' text in content/lab.json: the site
// writes that copy about Alison Heppenstall and UIA (a group, by its own word), so it is site copy
// too. Two sources are not site copy and are not scanned: the catalogue's validation messages in
// content-schema.ts, which only maintainers see (a catalogue that fails them is never published),
// and the rest of content/lab.json, whose records are people's own words: a bio may name a lab
// someone worked in.
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
  /** The neighbours' copy in a catalogue: every text in en and zh they hold (their URLs are not text). */
  const neighbourCopy = (cat) => {
    const found = [];
    (function walk(v) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object')
        for (const [key, value] of Object.entries(v))
          if ((key === 'en' || key === 'zh') && typeof value === 'string') found.push(value);
          else walk(value);
    })(cat.neighbours);
    return found;
  };
  // The scan reads the neighbours' copy, so a lab word anywhere in it is caught, and still leaves a
  // member's bio alone.
  const scanned = (edit, words) => {
    const cat = structuredClone(catalog);
    edit(cat, cat.neighbours.find((n) => n.id === alison.id));
    return neighbourCopy(cat).some((t) => t.includes(words) && lab(t));
  };
  assert(scanned((cat, n) => (n.group.summary.en = 'UIA is a lab that studies cities.'), 'UIA is a lab'), 'The scan misses a lab word in a neighbour’s English.');
  assert(scanned((cat, n) => (n.sections[1].body.zh = 'UIA 实验室'), 'UIA 实验室'), 'The scan misses a lab word in a neighbour’s Chinese.');
  assert(!scanned((cat) => (cat.people[0].summary.en += ' Once in a lab.'), 'Once in a lab.'), 'The scan reads a member’s bio.');
  const neighbourTexts = neighbourCopy(catalog);
  assert(neighbourTexts.length >= 18 * catalog.neighbours.length, 'The copy scan read the neighbours’ text (' + neighbourTexts.length + ' pieces).');
  for (const text of neighbourTexts) assert(!lab(text), 'content/lab.json’s neighbours use a lab word: ' + text);
  // The wording rules, read in every sentence of the neighbours' copy, whatever its field:
  // - Liu’s Gate is never called a lab or a group: no sentence that names it calls anything one.
  //   UIA, a group by its own word, and the university's research groups are named in sentences
  //   of their own.
  // - Nor is it one by its supervisor's name: no "Pengyuan Liu’s research group", "the Liu group"
  //   or 刘鹏远老师的课题组, in any sentence.
  // - The one tie the sources state is that Pengyuan Liu is listed as an Associate of UIA: no
  //   sentence that names the Gate or a Liu (Liu, 刘) says part of, belongs to, member,
  //   co-supervises or affiliated (属于, 隶属, 成员, 共同指导, 联合指导).
  // - Her name and UIA's stay in Latin script: no text writes them in Chinese characters. A
  //   heuristic: the usual transliterations of Alison and Heppenstall, and UIA's name translated.
  const sentences = (texts) => texts.flatMap((t) => t.split(/(?<=[.!?。！？])\s*/)).filter(Boolean);
  const namesTheGate = (s) => /Liu[’']s Gate|LIU[’']S GATE|刘家门/.test(s);
  const namesALiu = (s) => /\bLiu\b/i.test(s) || /刘/.test(s);
  const callsAGroup = (s) => /\b(?:labs?|laborator(?:y|ies)|groups?|teams?)\b/i.test(s) || /实验室|研究组|课题组|团队|小组/.test(s);
  const callsHisPeopleAGroup = (s) =>
    /\bLiu(?:[’']s)?\s+(?:research\s+)?(?:labs?|laborator(?:y|ies)|groups?|teams?)\b/i.test(s) ||
    /刘(?:鹏远)?(?:老师|教授|博士)?的?(?:研究)?(?:实验室|研究组|课题组|团队|小组)/.test(s);
  const strongerTie = (s) =>
    /\b(?:part of|belongs? to|member(?:s|ship)?|co-?supervis\w*|affiliat\w*)\b/i.test(s) || /属于|隶属|成员|共同指导|联合指导/.test(s);
  const namesInChinese = (s) => /[艾爱](?:莉|利|丽)森|[赫海](?:彭|本|朋|普)斯(?:托|通|塔|特|顿)尔|城市智能(?:与|和|及)?分析/.test(s);
  /** What the copy says that the wording rules forbid: each sentence, with the rule it breaks. */
  const wordingFaults = (texts) =>
    sentences(texts).flatMap((s) => [
      ...(namesTheGate(s) && callsAGroup(s) ? ['calls Liu’s Gate a lab or a group: ' + s] : []),
      ...(callsHisPeopleAGroup(s) ? ['calls its supervisor’s people a lab, a group or a team: ' + s] : []),
      ...(namesALiu(s) && strongerTie(s) ? ['states a tie stronger than Associate: ' + s] : []),
      ...(namesInChinese(s) ? ['writes her name or UIA’s in Chinese characters: ' + s] : []),
    ]);
  // The rules read what they should: these are caught, wherever in her copy they stand, and the
  // real tie, UIA as a group and her university's research groups are not.
  for (const [text, caught] of [
    ['UIA is a group. Liu’s Gate is a research group too.', true],
    ['刘家门是一个研究团队。', true],
    ['Pengyuan Liu’s research group works on cities too.', true],
    ['刘鹏远老师的课题组也研究城市。', true],
    ['刘鹏远的研究团队与 UIA 合作。', true],
    ['She works with the Liu group.', true],
    ['Liu’s Gate is part of UIA.', true],
    ['刘家门隶属于 UIA。', true],
    ['She co-supervises PhD students with Pengyuan Liu.', true],
    ['她与刘鹏远联合指导博士生。', true],
    ['Dr Liu is a member of UIA.', true],
    ['Pengyuan Liu is an affiliate of UIA.', true],
    ['Liu’s Gate holds a UIA membership.', true],
    ['赫彭斯托尔教授是格拉斯哥大学地理计算教授。', true],
    ['艾莉森是 UIA 的团队负责人之一。', true],
    ['UIA（城市智能与分析）用数据理解城市。', true],
    ['UIA is a group. Pengyuan Liu, the supervisor of Liu’s Gate, is an Associate.', false],
    [alison.group.connection.en, false],
    [alison.group.connection.zh, false],
    ['UIA 是一个研究团队。', false],
    ['At Glasgow she is listed in two research groups, Urban Analytics and Just Cities & Societies.', false],
    ['Alison Heppenstall 是 UIA（Urban Intelligence & Analytics）的团队负责人之一。', false],
  ])
    assert.equal(wordingFaults([text]).length > 0, caught, 'The wording rules read: ' + text);
  // And the rules see every field: a fault set in any of her texts is caught.
  for (const [where, edit] of [
    ['her summary', (n) => (n.summary.en += ' She works with the Liu group.')],
    ['her Background', (n) => (n.sections[0].body.en += ' Liu’s Gate is part of UIA.')],
    ['her Research', (n) => (n.sections[1].body.zh += '她与刘鹏远联合指导博士生。')],
    ['UIA’s summary', (n) => (n.group.summary.zh += '刘家门隶属于 UIA。')],
    ['her role', (n) => (n.role.zh = '赫彭斯托尔教授')],
    ['her staff page’s label', (n) => (n.links[0].label.zh = '艾莉森的格拉斯哥大学教师主页')],
  ]) {
    const cat = structuredClone(catalog);
    edit(cat.neighbours.find((n) => n.id === alison.id));
    assert.equal(wordingFaults(neighbourCopy(cat)).length, 1, 'The wording rules miss a fault in ' + where + '.');
  }
  assert(sentences(neighbourTexts).some(namesTheGate), 'The neighbours’ copy names Liu’s Gate (the connection line).');
  assert.deepEqual(wordingFaults(neighbourTexts), [], 'content/lab.json’s neighbours break a wording rule.');
  // So does the draft example a maintainer starts from.
  const exampleTexts = neighbourCopy({ neighbours: [JSON.parse(await fs.readFile(path.join(root, 'content/examples/neighbour.json'), 'utf8'))] });
  assert(exampleTexts.length >= 18 && !exampleTexts.some(lab), 'content/examples/neighbour.json uses a lab word.');
  assert.deepEqual(wordingFaults(exampleTexts), [], 'content/examples/neighbour.json breaks a wording rule.');
  // The site's own copy around her record is read by the same rules: the sky island's place (its
  // name, category, summary and the villa's text), the Gate's Layout sentence on it, and every text a
  // visitor reads or hears in its file and in About's Neighbours card (the copy that sits beside the
  // Gate's own and names it), the record's and the page's alike, in both languages. A fault in what
  // the file or the card shows is caught there.
  const island = buildings.find((b) => b.id === 'sky-island'),
    shown = (lab) =>
      ['en', 'zh'].flatMap((locale) => [
        ...textsOf(renderToStaticMarkup(React.createElement(lab, { id: 'sky-island', locale, onOpen() {} }))),
        ...textsOf(
          renderToStaticMarkup(React.createElement(lab, { id: 'town-hall', locale, onOpen() {}, reading: true })).match(
            /<section class="neighbours"[\s\S]*?<\/section>/,
          )?.[0] ?? '',
        ),
      ]),
    siteCopy = [
      ...[island.name, island.category, island.summary, island.style, island.architecture].flatMap((t) => [t.en, t.zh]),
      'A sky island with a red-brick villa floats above the town.',
      '小城上空还漂浮着一座带红砖别墅的天空之岛。',
      ...shown(LabContent),
    ];
  assert(sentences(siteCopy).filter(namesTheGate).length >= 4, 'The island’s file and the card name Liu’s Gate (the connection line).');
  assert.deepEqual(wordingFaults(siteCopy), [], 'The sky island’s place, its file or the Neighbours card breaks a wording rule.');
  const planted = await siteOver('neighbour-wording', {
    ...next,
    neighbours: next.neighbours.map((n) => ({ ...n, group: { ...n.group, connection: { en: 'Liu’s Gate is part of UIA.', zh: '刘家门隶属于 UIA。' } } })),
  });
  assert.equal(wordingFaults(shown(planted.content.LabContent)).length, 4, 'The wording rules miss a fault the island’s file or the card shows.');
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
for (const item of [...catalog.people, ...(catalog.events ?? []), ...(catalog.neighbours ?? [])]) {
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
// It edits the neighbours as it does the other collections, and refuses a neighbour with properties.
const neighbourFile = path.join(sandbox, 'neighbour.json'),
  neighbourTypoFile = path.join(sandbox, 'neighbour-typo.json');
await fs.writeFile(neighbourFile, JSON.stringify({ ...testNeighbour, visibility: 'draft' }));
await fs.writeFile(neighbourTypoFile, JSON.stringify({ ...testNeighbour, visibility: 'draft', properties: [] }));
for (const { args, status = 0, message, output: printed } of [
  { args: ['upsert', 'people', file] },
  { args: ['list', 'people'] },
  { args: ['upsert', 'people', leaverFile] },
  { args: ['upsert', 'people', typoFile], status: 1, message: /unknown field "depature"/ },
  { args: ['remove', 'people', 'test-member'] },
  { args: ['list', 'neighbours'], output: /"id": "alison-heppenstall"/ },
  { args: ['upsert', 'neighbours', neighbourFile] },
  { args: ['upsert', 'neighbours', neighbourTypoFile], status: 1, message: /unknown field "properties"/ },
  { args: ['remove', 'neighbours', 'test-neighbour'] },
  {
    args: ['validate'],
    output: new RegExp(catalog.neighbours.length + (catalog.neighbours.length === 1 ? ' neighbour ' : ' neighbours ') + '\\(not members\\)'),
  },
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
  if (printed) assert.match(result.stdout, printed);
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
// The command, which reads the file migrated as the build and the site do, refuses a catalogue
// whose neighbours are misspelt, by name, and does not take it for one with no neighbours.
{
  const typo = structuredClone(catalog);
  typo.neighbors = typo.neighbours;
  delete typo.neighbours;
  await fs.writeFile(path.join(sandbox, 'content/lab.json'), JSON.stringify(typo, null, 2));
  const result = spawnSync(process.execPath, ['--experimental-strip-types', path.join(sandbox, 'scripts/content.mjs'), 'validate'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 1, 'The command validates a catalogue whose neighbours are spelt "neighbors".');
  assert.match(result.stderr, /catalog: unknown field "neighbors"\./);
  assert.doesNotMatch(result.stdout, /Catalog valid/);
}
console.log(
  'Content checks passed: persistent CRUD with backups, references, invalid dates/links, member/research/event/output/note rendering, visitor-facing empty chapters, role labels, the Visiting PhD Residence empty and shared by two test visitors, departures on fixed UTC days (a member who left, a visitor gone home as Returned, a 2099 leaver, a home that empties and fills again, malformed blocks refused), those who have left filed at the airport (chapter, camera, place and file) while the home a founding member left is still faced from People, the Departures chapter as chapter 03 and its board (newest first, rows that fold out on the page or open a file in the city, read aloud as sentences, the empty board’s row to be announced and its note), nobody at the Gate on ' + DAY + ' gone by then so the live site unchanged, checks that hold whatever real departures are entered, the About this site chapter, readable dates, Gate’s News order, 12-month window and rendering, Join us subject lines, full profiles and email addresses on the reading-view person cards, v1 migration and v2 files from before the neighbours, a misspelt or stray collection refused by name, no Chinese characters or punctuation in English text, properties, bilingual routes and scene targets, the neighbours (Alison Heppenstall and UIA on the sky island: a collection of their own with strict fields, each fault in its own message, HTTPS links only, Chinese text translated save the names, never a person, member, resident or address anywhere on the site, a draft kept back, edited by the command), the wording rules in every sentence of their copy (no tie stronger than Associate, her name and UIA’s never in Chinese characters, Liu’s Gate never a lab or a group, by its name or its supervisor’s), the sky island’s City file (her category, her role, profile, UIA and its button, her staff page, her full profile folded away, the villa; the island’s own again with no record) and About’s Neighbours card (UIA in one line, her as a group leader, the tie, its two ways on, the island’s reading address), her name nowhere else on the page, the same wording rules over the file’s and the card’s copy, the Gate’s work never filed at her place, every link off the site opening a new tab with rel noopener noreferrer, still seven chapter chips, and site copy, the neighbours’ included, that never calls Liu’s Gate a lab.',
);
