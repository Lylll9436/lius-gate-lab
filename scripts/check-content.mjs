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
  safeLink,
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
// A link is a mailto address, or an HTTPS address written plainly that parses as a browser parses
// it, with a host and no user name or password before it. One a browser cannot parse (a bad port, a
// host it refuses) would throw where the page reads its host (the UIA button names it), and a user
// name before the host sends the visitor to the host after it.
for (const [url, ok] of [
  ['https://urban-ai.uk/', true],
  ['https://www.gla.ac.uk/schools/socialpolitical/staff/alisonheppenstall/', true],
  ['https://example.org:8443/a?q=a@b#c', true],
  ['https://example.org?q=a@b', true],
  ['mailto:someone@example.org', true],
  ['https://urban-ai.uk:8o80/', false],
  ['https://urban-ai.uk:99999/', false],
  ['https://urban-ai.uk]/', false],
  ['https://urban-ai.uk^/', false],
  ['https://urban-ai.uk%2F/', false],
  ['https://urban-ai.uk@example.org/', false],
  ['https://user:secret@example.org/', false],
  ['https:///example.org/', false],
  ['https://exa mple.org/', false],
  ['http://urban-ai.uk/', false],
  ['javascript:alert(1)', false],
])
  assert.equal(safeLink(url), ok, (ok ? 'A sound link is refused: ' : 'A link a browser would not open as written passes: ') + url);
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
// Neighbours: researchers beside the town who are not part of Liu’s Gate, with their groups. There are
// two, each on an island of their own: Alison Heppenstall and her group UIA on the sky island, and
// Filip Biljecki and his group UAL on the tropic island. A collection of its own, never people, so
// nothing counts them as members, leavers, residents or someone with a home (the site's own code is
// checked for that below). Their fields are checked strictly, each fault in words of its own.
//
// The checks on the neighbours' rules, the islands' City files, About's Neighbours cards and what
// the site does with a neighbour run on fixtures: each record as it was reviewed, published
// (scripts/fixtures/alison-heppenstall.json, scripts/fixtures/filip-biljecki.json), set into the
// test catalogues in place of the real neighbours. So they hold whatever content/lab.json says of
// them: taking a profile down, as MAINTENANCE describes it (the record set to draft, or removed),
// changes nothing here. What content/lab.json holds is checked as it is (the live neighbours, after
// the copy scan below): a valid catalogue, every published neighbour within the wording rules, and
// an island with none published its own file and no card.
const alison = JSON.parse(await fs.readFile(path.join(root, 'scripts/fixtures/alison-heppenstall.json'), 'utf8')),
  filip = JSON.parse(await fs.readFile(path.join(root, 'scripts/fixtures/filip-biljecki.json'), 'utf8')),
  /** The real catalogue with her record, the fixture, as its one neighbour. */
  withHer = { ...catalog, neighbours: [alison] },
  /** The real catalogue with his record, the fixture, as its one neighbour. */
  withHim = { ...catalog, neighbours: [filip] },
  /** The real catalogue with both fixtures as its neighbours, in their order: hers, then his. */
  withThem = { ...catalog, neighbours: [alison, filip] },
  herAt = 'neighbours[0]';
/** Each neighbour's fixture, in their order, with the place whose file shows them. */
const neighbourFixtures = [
  { n: alison, file: 'scripts/fixtures/alison-heppenstall.json', place: 'sky-island' },
  { n: filip, file: 'scripts/fixtures/filip-biljecki.json', place: 'tropic-island' },
];
assert.deepEqual(validateCatalog(withHer), [], 'scripts/fixtures/alison-heppenstall.json is not a valid neighbour.');
assert.deepEqual(validateCatalog(withHim), [], 'scripts/fixtures/filip-biljecki.json is not a valid neighbour.');
// Two places, two published neighbours: each place's file shows one.
assert.deepEqual(validateCatalog(withThem), [], 'The two neighbours, one published on each island, are refused together.');
assert.deepEqual([alison.order, filip.order], [0, 1], 'The neighbours’ order is not hers, then his.');
for (const { n, file, place } of neighbourFixtures) {
  assert.deepEqual(
    Object.keys(n).sort(),
    ['id', 'title', 'summary', 'visibility', 'order', 'role', 'affiliation', 'photo', 'buildingId', 'group', 'sections', 'links'].sort(),
    file + ' holds its fields, and no properties.',
  );
  assert.deepEqual([n.visibility, n.buildingId], ['published', place], 'The fixture ' + file + ' is not published, on ' + place + '.');
  assert.deepEqual(n.sections.map((s) => s.heading), [{ en: 'Background', zh: '经历' }, { en: 'Research', zh: '研究' }], file + '’s sections are not Background and Research.');
  assert.deepEqual(Object.keys(n.group).sort(), ['name', 'fullName', 'intro', 'lead', 'summary', 'connection', 'site'].sort());
}
assert.equal(alison.id, 'alison-heppenstall');
assert.equal(filip.id, 'filip-biljecki');
// The facts and the wording rules for each record: the fixture and, while content/lab.json holds that
// record (published or a draft), that one too. No photo: the site shows none of either. Their ways
// off the site are the sources' own addresses: the group's website and their own page. Neither has a
// Chinese name, so theirs stays in Latin script in the Chinese copy, and each group keeps its own
// name. The one tie the sources state, and nothing stronger: Pengyuan Liu is listed as an Associate
// of UIA, and among UAL's alumni as a Research Fellow; the connection lines say so. That nothing
// stronger is said, that their names and their groups' are never written in Chinese characters, and
// that Liu’s Gate is never called a lab or a group are checked in every sentence of their copy,
// whatever its field (the copy scan, below).
for (const { n, file } of neighbourFixtures)
  for (const it of [n, ...catalog.neighbours.filter((live) => live.id === n.id)]) {
    const which = it === n ? file : 'content/lab.json';
    assert.equal(it.photo, null, it.id + '’s record (' + which + ') has a photo: the site shows none of them.');
    assert(it.title.zh === it.title.en && !/[㐀-鿿]/.test(it.title.zh), it.id + '’s name stays in Latin script in Chinese (' + which + ').');
    assert.deepEqual(
      [it.group.name.zh, it.group.fullName.zh],
      [it.group.name.en, it.group.fullName.en],
      it.group.name.en + ' keeps its own name in Chinese (' + which + ').',
    );
    const tie = it.group.connection;
    if (it.id === alison.id) {
      assert.equal(it.group.site.url, 'https://urban-ai.uk/', 'UIA’s website (' + which + ') is not https://urban-ai.uk/.');
      assert.deepEqual(it.links.map((l) => l.url), ['https://www.gla.ac.uk/schools/socialpolitical/staff/alisonheppenstall/'], 'Her staff page (' + which + ') has moved.');
      assert.deepEqual([it.group.name.en, it.group.fullName.en], ['UIA', 'Urban Intelligence & Analytics'], 'UIA’s names (' + which + ').');
      assert(
        tie.en.includes('Pengyuan Liu') && /\bAssociates?\b/.test(tie.en) && tie.zh.includes('刘鹏远') && tie.zh.includes('Associate'),
        'The tie to UIA is that Pengyuan Liu is listed as an Associate (' + which + ').',
      );
      assert.deepEqual(
        it.group.lead,
        { en: 'Alison Heppenstall is one of its Group Leaders.', zh: 'Alison Heppenstall 是 UIA 的团队负责人（Group Leader）之一。' },
        'Her place in UIA (' + which + ') is not one of its Group Leaders, as UIA writes it.',
      );
    } else {
      assert.equal(it.group.site.url, 'https://ual.sg/', 'UAL’s website (' + which + ') is not https://ual.sg/.');
      assert.deepEqual(it.links.map((l) => l.url), ['https://ual.sg/author/filip-biljecki/'], 'His page on UAL’s website (' + which + ') has moved.');
      assert.deepEqual([it.group.name.en, it.group.fullName.en], ['UAL', 'Urban Analytics Lab'], 'UAL’s names (' + which + ').');
      assert.deepEqual([it.role, it.title.en], [{ en: 'ASSOCIATE PROFESSOR', zh: '副教授' }, 'Filip Biljecki'], 'His role (' + which + ').');
      assert.deepEqual(
        it.affiliation,
        {
          en: 'Department of Architecture, College of Design and Engineering, National University of Singapore',
          zh: '新加坡国立大学设计与工程学院 · 建筑系',
        },
        'His affiliation (' + which + ').',
      );
      assert(
        tie.en.includes('Pengyuan Liu') &&
          /\balumni\b/.test(tie.en) &&
          tie.en.includes('Research Fellow') &&
          tie.zh.includes('刘鹏远') &&
          tie.zh.includes('Alumni') &&
          tie.zh.includes('Research Fellow'),
        'The tie to UAL is that Pengyuan Liu is listed among its alumni, as a Research Fellow (' + which + ').',
      );
      assert.deepEqual(
        it.group.lead,
        { en: 'UAL was established by Filip Biljecki, who directs it.', zh: 'UAL 由 Filip Biljecki 创立并领导。' },
        'His place in UAL (' + which + ') is not that he established it and directs it, as UAL writes it.',
      );
    }
  }
/** The real catalogue with her record (the fixture) as its one neighbour, changed by `edit`. */
const editedNeighbour = (edit) => {
  const cat = structuredClone(withHer);
  edit(cat.neighbours[0]);
  return cat;
};
const placeRule = herAt + '.buildingId must be the place whose file shows them: sky-island or tropic-island.';
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
  // An address a browser cannot parse, or one it would take elsewhere.
  ['a bad port', (n) => (n.group.site.url = 'https://urban-ai.uk:8o80/'), herAt + '.group.site.url must be an HTTPS address.'],
  [
    'a user name before the host',
    (n) => (n.links[0].url = 'https://www.gla.ac.uk@example.org/schools/socialpolitical/staff/alisonheppenstall/'),
    herAt + '.links[0].url must be an HTTPS address.',
  ],
  ['an unknown key in the group', (n) => (n.group.website = 'https://urban-ai.uk/'), herAt + '.group: unknown field "website".'],
  ['an unknown key in the website', (n) => (n.group.site.note = text('Opens in a new tab')), herAt + '.group.site: unknown field "note".'],
  ['an unknown key in a section', (n) => (n.sections[0].image = null), herAt + '.sections[0]: unknown field "image".'],
  ['no group', (n) => delete n.group, herAt + '.group must be an object with name, fullName, intro, lead, summary, connection and site.'],
  // UIA's one line on the reading page's card is a text of its own, held to the same rules.
  ['no one-line introduction', (n) => delete n.group.intro, herAt + '.group.intro must be a text with en and zh.'],
  ['an intro with no Chinese', (n) => delete n.group.intro.zh, herAt + '.group.intro.zh is missing: supply en and zh.'],
  ['an untranslated intro', (n) => (n.group.intro.zh = n.group.intro.en), herAt + '.group.intro.zh has no Chinese: translate it.'],
  ['Chinese in the intro’s English', (n) => (n.group.intro.en = 'UIA 是一个研究团队。'), herAt + '.group.intro.en contains Chinese: English text must have none.'],
  // So is the sentence that follows it there, her place in UIA.
  ['no lead', (n) => delete n.group.lead, herAt + '.group.lead must be a text with en and zh.'],
  ['a lead with no Chinese', (n) => delete n.group.lead.zh, herAt + '.group.lead.zh is missing: supply en and zh.'],
  ['an untranslated lead', (n) => (n.group.lead.zh = n.group.lead.en), herAt + '.group.lead.zh has no Chinese: translate it.'],
  ['Chinese in the lead’s English', (n) => (n.group.lead.en = 'Alison Heppenstall 是 UIA 的团队负责人之一。'), herAt + '.group.lead.en contains Chinese: English text must have none.'],
  ['no website', (n) => delete n.group.site, herAt + '.group.site must be a link with a label and an HTTPS url.'],
  ['no links', (n) => delete n.links, herAt + '.links must be an array.'],
  ['a place that is not a neighbour’s', (n) => (n.buildingId = 'town-hall'), placeRule],
  ['a member’s home', (n) => (n.buildingId = 'pengyuan-liu'), placeRule],
  ['the airport, also on an island of its own', (n) => (n.buildingId = 'airport'), placeRule],
  ['no place', (n) => (n.buildingId = null), placeRule],
  ['an unknown visibility', (n) => (n.visibility = 'public'), herAt + '.visibility is invalid.'],
  ['an order that is not a number', (n) => (n.order = '0'), herAt + '.order must be a number.'],
  ['a photo from off the site', (n) => (n.photo = 'https://example.org/portrait.jpg'), herAt + '.photo must be null or an image under /people/ or /media/.'],
  ['an id that is not a slug', (n) => (n.id = 'Alison Heppenstall'), herAt + ': id must be a unique stable slug.'],
])
  assert.deepEqual(validateCatalog(editedNeighbour(edit)), [message], 'A neighbour with ' + why + ' fails with its own message.');
// The same rules hold his record, the second neighbour: his own faults are named at his index, and
// UAL's names stay in Latin script in Chinese as UIA's do.
{
  const hisAt = 'neighbours[1]',
    editedHis = (edit) => {
      const cat = structuredClone(withThem);
      edit(cat.neighbours[1]);
      return validateCatalog(cat);
    };
  for (const [why, edit, message] of [
    ['an untranslated lead', (n) => (n.group.lead.zh = n.group.lead.en), hisAt + '.group.lead.zh has no Chinese: translate it.'],
    ['an untranslated summary', (n) => (n.summary.zh = n.summary.en), hisAt + '.summary.zh has no Chinese: translate it.'],
    ['his page not on HTTPS', (n) => (n.links[0].url = 'http://ual.sg/author/filip-biljecki/'), hisAt + '.links[0].url must be an HTTPS address.'],
    ['UAL’s website not on HTTPS', (n) => (n.group.site.url = 'http://ual.sg/'), hisAt + '.group.site.url must be an HTTPS address.'],
    ['a place that is not a neighbour’s', (n) => (n.buildingId = 'research-studio'), hisAt + '.buildingId must be the place whose file shows them: sky-island or tropic-island.'],
  ])
    assert.deepEqual(editedHis(edit), [message], 'His record with ' + why + ' fails with its own message.');
  assert.deepEqual(editedHis((n) => (n.group.fullName.zh = 'Urban Analytics Lab')), [], 'UAL’s full name, kept in Latin script in Chinese, is refused.');
}
// A neighbour is not a person: their id may not be in people too, and no event, project, output or
// note may name them among its people (their People buttons open members' files).
for (const [i, n] of [alison, filip].entries())
  assert.deepEqual(
    validateCatalog({
      ...withThem,
      people: [...withThem.people, { ...stayer(catalog.people[1]), id: n.id, title: n.title, buildingId: null, order: 30 }],
    }),
    ['neighbours[' + i + ']: ' + n.id + ' is in people too. A neighbour is not a member: keep them in neighbours only.'],
  );
for (const n of [alison, filip])
  for (const { collection, row } of [
    { collection: 'events', row: { ...event, id: 'test-island-visit' } },
    { collection: 'research', row: { ...research, id: 'test-island-study' } },
    { collection: 'outputs', row: { ...outputRecord, id: 'test-island-output' } },
    { collection: 'notes', row: { ...noteRecord, id: 'test-island-note' } },
  ])
    assert.throws(
      () => upsertRecord({ ...next, neighbours: withThem.neighbours }, collection, { ...row, people: [n.id] }),
      new RegExp(collection + '/' + row.id + ': missing or unpublished person ' + n.id),
      'A ' + collection + ' record cannot name a neighbour among its people.',
    );
// Nor is the Gate's work filed at a neighbour's place: each island's file and camera are its
// neighbour's, so a project, an output or a note there would read as UIA's or UAL's. Every other
// place takes them, as before.
for (const [collection, row] of Object.entries({ research, outputs: outputRecord, notes: noteRecord })) {
  const at = collection + '[' + next[collection].findIndex((r) => r.id === row.id) + ']',
    filedAt = (place) => ({ ...next, [collection]: next[collection].map((r) => (r.id === row.id ? { ...r, buildingId: place } : r)) });
  for (const place of ['sky-island', 'tropic-island'])
    assert.deepEqual(
      validateCatalog(filedAt(place)),
      [at + '.buildingId: ' + place + ' is a neighbour’s place; file the Gate’s work at one of its own.'],
      'A ' + collection + ' record can be filed at a neighbour’s place: ' + place + '.',
    );
  assert.deepEqual(validateCatalog(filedAt('research-studio')), [], 'A ' + collection + ' record cannot be filed at the studio.');
}
// A place's file shows one published neighbour. A draft may wait beside them; two of the same id may
// not. Each island holds its own: a second one published on either is refused, and one on each is not.
const testNeighbour = {
  ...structuredClone(alison),
  id: 'test-neighbour',
  title: { en: 'Test Neighbour', zh: '测试近邻' },
  order: 2,
};
assert.deepEqual(validateCatalog({ ...withHer, neighbours: [alison, testNeighbour] }), [
  'neighbours[1]: sky-island already has a published neighbour; a place’s file shows one.',
]);
assert.deepEqual(validateCatalog({ ...withThem, neighbours: [alison, filip, { ...testNeighbour, buildingId: 'tropic-island' }] }), [
  'neighbours[2]: tropic-island already has a published neighbour; a place’s file shows one.',
]);
assert.deepEqual(validateCatalog({ ...withThem, neighbours: [alison, { ...filip, buildingId: 'sky-island' }] }), [
  'neighbours[1]: sky-island already has a published neighbour; a place’s file shows one.',
]);
assert.deepEqual(validateCatalog({ ...withHer, neighbours: [alison, { ...testNeighbour, visibility: 'draft' }] }), []);
assert.deepEqual(validateCatalog({ ...withThem, neighbours: [alison, filip, { ...testNeighbour, buildingId: 'tropic-island', visibility: 'draft' }] }), []);
assert.deepEqual(validateCatalog({ ...withHer, neighbours: [alison, { ...alison, visibility: 'draft' }] }), [
  'neighbours[1]: id must be a unique stable slug.',
]);
// The maintenance command's operations take the neighbours too, and refuse a typo.
{
  const added = upsertRecord(withHer, 'neighbours', { ...testNeighbour, visibility: 'draft' });
  assert.deepEqual(added.neighbours.map((n) => n.id), [alison.id, 'test-neighbour']);
  assert.deepEqual(removeRecord(added, 'neighbours', 'test-neighbour'), withHer);
  assert.deepEqual(upsertRecord(withHer, 'neighbours', filip), withThem, 'The command does not add his record beside hers.');
  assert.deepEqual(removeRecord(withThem, 'neighbours', filip.id), withHer);
  assert.throws(() => upsertRecord(withHer, 'neighbours', { ...alison, properties: [] }), /unknown field "properties"/);
  assert.throws(() => removeRecord(withHer, 'neighbours', 'missing'), /Record not found: neighbours\/missing/);
}
// The example a maintainer starts from (MAINTENANCE's upsert line) is a valid neighbour, a draft:
// beside them it stays off the site and each place keeps its neighbour, and it goes into
// content/lab.json as it stands.
{
  const example = JSON.parse(await fs.readFile(path.join(root, 'content/examples/neighbour.json'), 'utf8'));
  assert.equal(example.visibility, 'draft', 'content/examples/neighbour.json must be a draft.');
  assert.deepEqual(Object.keys(example.group).sort(), Object.keys(alison.group).sort(), 'content/examples/neighbour.json’s group has other fields than the records’.');
  assert.deepEqual(
    upsertRecord(withThem, 'neighbours', example)
      .neighbours.filter((n) => n.visibility === 'published')
      .map((n) => n.id),
    [alison.id, filip.id],
  );
  upsertRecord(catalog, 'neighbours', example);
}
// The site's own code is compiled over the test catalogue, both records (the fixtures) its neighbours.
next = { ...next, neighbours: [alison, filip] };
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
/** A start tag's attributes, parsed: each name to its value (entities decoded; '' for one with no value), in any order. */
const attrsOf = (tag) => Object.fromEntries([...tag.matchAll(/\s([^\s="'>/]+)(?:="([^"]*)")?/g)].map((m) => [m[1], decoded(m[2] ?? '')]));
/** The elements of rendered markup in document order: each start tag's name, attributes and classes, and where it ends. */
const elementsOf = (html) =>
  [...html.matchAll(/<([a-z][\w-]*)(\s[^>]*)?>/g)].map((m) => {
    const attrs = attrsOf(m[2] ?? '');
    return { name: m[1], attrs, classes: (attrs.class ?? '').split(/\s+/).filter(Boolean), end: m.index + m[0].length };
  });
/** An element's text as a visitor reads it (an element with no element of its own name inside it). */
const textIn = (html, element) =>
  decoded(html.slice(element.end, html.indexOf('</' + element.name + '>', element.end)).replace(/<[^>]*>/g, ''));
/**
 * Whether parsed attributes open a new tab with neither a way back to the page (noopener) nor its
 * address sent along (noreferrer): the owner's rule for links off the site. The rel tokens may come
 * in either order, beside others.
 */
const opensSafely = (attrs) => {
  const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/);
  return attrs.target === '_blank' && rel.includes('noopener') && rel.includes('noreferrer');
};
/**
 * The links off the site in rendered markup that do not open a new tab with neither a way back to
 * the page nor its address sent along: every https link and every target="_blank" must carry
 * target="_blank" rel="noopener noreferrer" (the owner's rule for outbound links).
 */
const unsafeOutbound = (html) =>
  elementsOf(html)
    .filter((e) => e.name === 'a' && ((e.attrs.href ?? '').startsWith('https://') || 'target' in e.attrs))
    .filter((e) => !opensSafely(e.attrs))
    .map((e) => e.attrs.href);
// The rule reads attributes, not their spelling: their order, the rel tokens' order and other
// attributes beside them do not matter; a missing token, or no new tab, does.
for (const [a, safe] of [
  ['<a href="https://urban-ai.uk/" target="_blank" rel="noopener noreferrer">', true],
  ['<a rel="noreferrer noopener" class="x" target="_blank" href="https://urban-ai.uk/">', true],
  ['<a href="https://urban-ai.uk/" target="_blank" rel="noreferrer">', false],
  ['<a href="https://urban-ai.uk/" rel="noopener noreferrer">', false],
  ['<a href="/#read/town-hall" target="_blank" rel="noopener">', false],
  ['<a href="mailto:someone@example.org">', true],
])
  assert.equal(unsafeOutbound(a).length === 0, safe, 'The outbound-link rule reads ' + a);
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
// one of them: the sky island, whose file shows her, and the tropic island, whose file shows him.
// Each says where it lies, for its Neighbours card's heading, in the words of its own category; no
// other place does.
assert.deepEqual([...buildingIds].sort(), buildings.map((b) => b.id).sort(), 'content-schema’s buildingIds are not the town’s places.');
assert(neighbourPlaces.length && neighbourPlaces.every((p) => buildingIds.includes(p)), 'A neighbour’s place is not one of buildingIds.');
assert.deepEqual([...neighbourPlaces], ['sky-island', 'tropic-island']);
assert.deepEqual(
  buildings.filter((b) => b.where).map((b) => [b.id, b.where]),
  [
    ['sky-island', { en: 'Above the town', zh: '小城上空' }],
    ['tropic-island', { en: 'Off the south shore', zh: '南岸外海上' }],
  ],
  'Each neighbour’s place says where it lies, and no other place does.',
);
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
// both records), finds no neighbour among the people, the members, those who have left, anyone's
// residents, the homes, their name tags and portraits, the People cards, the departures board, an
// event's People or the news. The supervisor's email is still the supervisor's, and no address
// opens a neighbour: they have none, and each island's file shows its neighbour's record.
{
  const { personPhotos } = await import(pathToFileURL(path.join(output, 'people-photos.mjs')).href);
  const theirIds = [alison.id, filip.id],
    theirNames = [alison.title.en, filip.title.en],
    theirs = (p) => [p.id, p.title?.en, p.name?.en].some((v) => theirIds.some((id) => v === id || v === 'person:' + id) || theirNames.includes(v)),
    published = next.neighbours
      .filter((n) => n.visibility === 'published')
      .sort((a, b) => a.order - b.order)
      .map((n) => n.id);
  assert.deepEqual(published, [alison.id, filip.id]);
  assert.deepEqual(records.neighbourRecords.map((n) => n.id), published);
  assert.equal(records.neighbourFor('sky-island')?.id, alison.id, 'The sky island’s file has her record to show.');
  assert.equal(records.neighbourFor('tropic-island')?.id, filip.id, 'The tropic island’s file has his record to show.');
  for (const place of [...buildings.map((b) => b.id).filter((id) => !neighbourPlaces.includes(id)), 'people', 'corner-park', 'overview'])
    assert.equal(records.neighbourFor(place), undefined, 'Only the islands have a neighbour, not ' + place + '.');
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
    assert(!list.some(theirs), 'A neighbour is among ' + what + '.');
  for (const locale of ['en', 'zh'])
    assert(!nav.homeTags(locale, TODAY).some((t) => /Alison|Filip/.test(t.label)), 'A name tag names a neighbour.');
  assert(!Object.keys(personPhotos).some((id) => theirIds.some((n) => id.includes(n))), 'A neighbour has a portrait slot.');
  assert(!nav.tourStops.some((stop) => theirIds.some((n) => stop.includes(n))), 'The tour stops at a neighbour.');
  assert.equal(
    records.supervisorEmail(),
    catalog.people.find((p) => p.id === 'pengyuan-liu').links.find((l) => l.url.startsWith('mailto:')).url.slice('mailto:'.length),
  );
  for (const id of theirIds)
    for (const address of [id, 'person:' + id, 'neighbour:' + id]) {
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
        assert(!/Heppenstall|Biljecki/.test(renderToStaticMarkup(element)), what + ' (' + locale + ') shows a neighbour.');
  // A neighbour in draft is not shown: the site lists none and their place's file has none to show.
  // With a draft beside them, each place's file shows its own, the one published.
  const drafted = (await siteOver('neighbour-draft', { ...next, neighbours: next.neighbours.map((n) => ({ ...n, visibility: 'draft' })) })).records;
  assert.deepEqual([drafted.neighbourRecords, drafted.neighbourFor('sky-island'), drafted.neighbourFor('tropic-island')], [[], undefined, undefined]);
  const beside = (
    await siteOver('neighbour-beside', {
      ...next,
      neighbours: [
        { ...testNeighbour, visibility: 'draft', order: -1 },
        ...next.neighbours,
        { ...testNeighbour, id: 'test-neighbour-south', buildingId: 'tropic-island', visibility: 'draft', order: -2 },
      ],
    })
  ).records;
  assert.deepEqual(
    [beside.neighbourRecords.map((n) => n.id), beside.neighbourFor('sky-island')?.id, beside.neighbourFor('tropic-island')?.id],
    [published, alison.id, filip.id],
  );
}
/**
 * The two neighbours' islands, in the Directory's order, with what each shows of its neighbour and of
 * itself: its name, its category while its neighbour's record is published (their name and their
 * group's) and its own while none is, its style (the building's), its glyph, its group's website,
 * the heading of its Neighbours card in About, and its sentence in the Gate's Layout.
 */
const islands = [
  {
    n: alison,
    place: 'sky-island',
    surname: /heppenstall/i,
    name: { en: 'Sky Island', zh: '天空之岛' },
    category: { en: 'ALISON HEPPENSTALL · UIA', zh: 'Alison Heppenstall · UIA' },
    own: {
      category: { en: 'ABOVE THE TOWN', zh: '小城上空' },
      summary: { en: 'A small island that floats above the town, with a red-brick villa on its lawn.', zh: '漂浮在小城上空的一座小岛，草坪上立着一栋红砖别墅。' },
    },
    style: { en: 'Red-brick villa', zh: '红砖别墅' },
    glyph: ['sky', 'the cloud'],
    site: { url: 'https://urban-ai.uk/', host: 'urban-ai.uk', label: { en: 'UIA website', zh: 'UIA 官网' } },
    /** Anything of her or UIA's, which the island's own file never shows. */
    theirs: /heppenstall|uia|urban-ai/i,
    heading: { en: 'Neighbours · Above the town', zh: '近邻 · 小城上空' },
    layout: { en: 'A sky island with a red-brick villa floats above the town.', zh: '小城上空还漂浮着一座带红砖别墅的天空之岛。' },
  },
  {
    n: filip,
    place: 'tropic-island',
    surname: /biljecki/i,
    name: { en: 'Tropic Island', zh: '热带之岛' },
    category: { en: 'FILIP BILJECKI · UAL', zh: 'Filip Biljecki · UAL' },
    own: {
      category: { en: 'OFF THE SOUTH SHORE', zh: '南岸外海上' },
      summary: {
        en: 'A small tropical island on the sea off the south shore, with a campus building under one wide flat roof among palms and rain trees.',
        zh: '南岸外海面上的一座热带小岛，棕榈与雨树之间立着一栋校园建筑，上面是一整片宽大的平屋顶。',
      },
    },
    style: { en: 'Tropical campus building', zh: '热带校园建筑' },
    glyph: ['tropic', 'the palm'],
    site: { url: 'https://ual.sg/', host: 'ual.sg', label: { en: 'UAL website', zh: 'UAL 官网' } },
    /** Anything of his or UAL's, which the island's own file never shows. */
    theirs: /biljecki|\bual\b|ual\.sg|urban analytics/i,
    heading: { en: 'Neighbours · Off the south shore', zh: '近邻 · 南岸外海上' },
    layout: { en: 'A tropical island with a flat-roofed campus building lies off the south shore.', zh: '南岸外的海上则有一座带平顶校园建筑的热带之岛。' },
  },
];
/** A place's Neighbours card in rendered markup ('' if it has none). */
const cardOf = (html, place) => html.match(new RegExp('<section class="neighbours" id="read-' + place + '"[\\s\\S]*?</section>'))?.[0] ?? '';
/** Rendered markup without a place's Neighbours card. */
const withoutCardOf = (html, place) => html.replace(new RegExp('<section class="neighbours" id="read-' + place + '"[\\s\\S]*?</section>', 'g'), '');
/** The group's website as the button names it ("UIA website · urban-ai.uk"), and as it is read aloud. */
const siteButton = (island, locale) => island.site.label[locale] + ' · ' + island.site.host,
  siteAria = (island, locale) =>
    locale === 'zh'
      ? island.site.label.zh + '：' + island.site.host + '，在新标签页打开'
      : island.site.label.en + ': ' + island.site.host + ', opens in a new tab';
// Each island's City file (#city/sky-island, #city/tropic-island). The island keeps its name; while
// its neighbour's record is published its category names them and their group, as a home's names its
// resident's role (the file's eyebrow, the Directory, the hover label), and its file is theirs, in
// this order: their name (for screen readers only), their role and affiliation, their short profile,
// their group (its full name, then the way out to its website, its address on the button and read
// aloud, then what it does and the one tie), their own page, their full profile folded away, the
// building, and the places next to it. No photo of them, nor a monogram in its place. In the
// Directory and the tour the sky island comes after the Visiting PhD Residence, the tropic island
// after it, and the airport after that.
{
  const at = (id) => buildings.findIndex((b) => b.id === id);
  assert.deepEqual([at('sky-island'), nav.tourStops.indexOf('sky-island')], [at('visiting-phd') + 1, 6], 'The sky island is the 7th place in the Directory and the tour.');
  assert.deepEqual([at('tropic-island'), nav.tourStops.indexOf('tropic-island')], [at('sky-island') + 1, 7], 'The tropic island is the 8th place in the Directory and the tour, after the sky island.');
  assert.equal(at('airport'), at('tropic-island') + 1, 'The airport does not come after the tropic island.');
  for (const island of islands) {
    const { n, place } = island,
      building = buildings.find((b) => b.id === place),
      group = n.group;
    assert.deepEqual([building.name, building.short], [island.name, island.name]);
    assert.deepEqual(building.category, island.category, 'The category of ' + place + ' does not name ' + n.id + ' and their group.');
    assert.deepEqual(building.style, island.style);
    assert.deepEqual(building.related, ['town-hall', 'pengyuan-liu'], 'The file of ' + place + ' does not go on to the Town Hall and Pengyuan Liu’s home.');
    assert.equal(glyphFor(place), island.glyph[0], 'The glyph of ' + place + ' is not ' + island.glyph[1] + '.');
    assert.deepEqual(group.site.label, island.site.label);
    for (const locale of ['en', 'zh']) {
      assert.equal(nav.titleFor(place, locale), building.name[locale]);
      const html = renderToStaticMarkup(React.createElement(LabContent, { id: place, locale, onOpen() {} })),
        page = decoded(html);
      const order = [
        n.title[locale],
        n.role[locale],
        n.affiliation[locale],
        n.summary[locale],
        group.name[locale] + ' · ' + group.fullName[locale],
        // The island works as a link to its group's site: the button comes right under the group's
        // name, on the file's first screen on a laptop (1440 × 789, a 1440 × 900 screen's browser,
        // and 1280 × 720).
        siteButton(island, locale),
        group.summary[locale],
        group.connection[locale],
        n.links[0].label[locale],
        locale === 'zh' ? '完整简介' : 'Full profile',
        ...n.sections.flatMap((s) => [s.heading[locale], s.body[locale]]),
        locale === 'zh' ? '这栋建筑' : 'About this building',
        building.style[locale],
        building.architecture[locale],
        locale === 'zh' ? '继续探索' : 'Continue exploring',
        nav.titleFor('town-hall', locale),
        nav.titleFor('pengyuan-liu', locale),
      ];
      let last = -1;
      for (const text of order) {
        const found = page.indexOf(text, last + 1);
        assert(found > last, 'The file of ' + place + ' (' + locale + ') does not show, in its place: ' + text);
        last = found;
      }
      // The way out to the group's website: the file's one primary button, opening a new tab.
      const elements = elementsOf(html),
        button = elements.filter((e) => e.name === 'a' && e.classes.includes('button-primary') && e.classes.includes('site-link'));
      assert.equal(button.length, 1, 'The file of ' + place + ' has one button to its group’s website.');
      assert(
        button[0].attrs.href === island.site.url && opensSafely(button[0].attrs) && button[0].attrs['aria-label'] === siteAria(island, locale),
        'The button of ' + place + ' (' + locale + ') does not go to ' + island.site.url + ' in a new tab, safely, read aloud as: ' + siteAria(island, locale),
      );
      const own = elements.find((e) => e.name === 'a' && e.attrs.href === n.links[0].url);
      assert(own && opensSafely(own.attrs), n.id + '’s own page does not open a new tab safely.');
      assert.deepEqual(unsafeOutbound(html), [], 'A link off the file of ' + place + ' is unsafe.');
      // Their full profile is folded away, a disclosure as on a person's card (its state is the browser's).
      const profile = elements.findIndex((e) => e.name === 'details' && e.classes.includes('neighbour-profile'));
      assert(
        profile >= 0 && !('open' in elements[profile].attrs) && elements[profile + 1]?.name === 'summary' && elements[profile + 2]?.name === 'svg',
        n.id + '’s full profile is not a closed disclosure.',
      );
      assert(!/<img|portrait|monogram/.test(html), 'The file of ' + place + ' shows a photo of ' + n.id + ', or a monogram for one.');
      // Their name opens the body, for a screen reader that starts at the focused title (the
      // island's, with their name only in the eyebrow above it): the role line's first child,
      // hidden from view.
      const roleLine = elements.findIndex((e) => e.name === 'p' && e.classes.includes('neighbour-role')),
        name = elements[roleLine + 1];
      assert(
        roleLine >= 0 &&
          name?.name === 'span' &&
          name.classes.includes('neighbour-name') &&
          decoded(html.slice(name.end, html.indexOf('</span>', name.end))) === n.title[locale] + (locale === 'zh' ? '，' : ', '),
        'The file of ' + place + ' (' + locale + ') does not name ' + n.id + ' at the start of its body, for a screen reader.',
      );
      // Neither island's file shows the other's neighbour.
      for (const other of islands)
        if (other !== island) assert(!other.surname.test(textsOf(html).join('\n')), 'The file of ' + place + ' (' + locale + ') names ' + other.n.id + '.');
    }
  }
  // The role line: their name hidden as the stage caption's chip is (out of the flow, clipped to
  // nothing), and their role and affiliation in the text's own ink, not the third ink (which measured
  // 2.2 to 2.9:1 over the sea glass by day). By day the glass's own day inks then apply to them as to
  // every file (globals.css, Text on the glass by day): their role the eyebrows' ink-green.
  {
    const sheet = (await fs.readFile(path.join(root, 'app/globals.css'), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, ''),
      declared = (selector) =>
        [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
          .filter((m) => m[1].split(',').map((s) => s.trim()).includes(selector))
          .flatMap((m) => m[2].split(';').map((d) => d.trim()));
    for (const d of ['position: absolute', 'width: 1px', 'height: 1px', 'overflow: hidden', 'clip-path: inset(50%)'])
      assert(declared('.neighbour-role .neighbour-name').includes(d), 'A neighbour’s name in their island’s file is not hidden as the stage caption’s chip is: ' + d);
    for (const selector of ['.neighbour-role .eyebrow', '.neighbour-role .institution'])
      assert(declared(selector).includes('color: var(--ink)'), 'A neighbour’s ' + selector.split(' .')[1] + ' line in their island’s file is not in the text’s own ink.');
  }
  // Were a record not published, its island would be the island's own again: its category and
  // summary, the building and the places next to it, and nothing of its neighbour's or their group's;
  // and About would keep the other's card only. With neither published, About has no card.
  const none = await siteOver('neighbour-none', { ...next, neighbours: next.neighbours.map((n) => ({ ...n, visibility: 'draft' })) });
  for (const island of islands) {
    const one = await siteOver('neighbour-' + island.place + '-down', {
      ...next,
      neighbours: next.neighbours.map((n) => (n.id === island.n.id ? { ...n, visibility: 'draft' } : n)),
    });
    for (const site of [none, one]) {
      const bare = site.data.buildings.find((b) => b.id === island.place);
      assert.deepEqual([bare.category, bare.summary], [island.own.category, island.own.summary], 'With ' + island.n.id + '’s record not published, ' + island.place + ' is not its own again.');
      for (const locale of ['en', 'zh']) {
        const markup = renderToStaticMarkup(React.createElement(site.content.LabContent, { id: island.place, locale, onOpen() {} })),
          html = decoded(markup),
          lead = elementsOf(markup).find((e) => e.name === 'p' && e.classes.includes('record-lead'));
        assert(lead && textIn(markup, lead) === bare.summary[locale] && html.includes(bare.architecture[locale]), 'The empty file of ' + island.place + ' is not its own.');
        assert(!island.theirs.test(html), 'The empty file of ' + island.place + ' still shows ' + island.n.id + ' or their group.');
        // Nor would About keep their Neighbours card; the other's stays while the other is published.
        const about = renderToStaticMarkup(React.createElement(site.content.LabContent, { id: 'town-hall', locale, onOpen() {}, reading: true }));
        assert(!cardOf(about, island.place) && !island.surname.test(about), 'About keeps the Neighbours card of ' + island.place + ' with its neighbour not published.');
        const others = islands.filter((other) => other !== island).map((other) => other.place);
        assert.deepEqual(
          elementsOf(about)
            .filter((e) => e.name === 'section' && e.classes.includes('neighbours'))
            .map((e) => e.attrs.id),
          site === none ? [] : others.map((p) => 'read-' + p),
          'About (' + locale + ') does not keep only the cards of the neighbours still published.',
        );
      }
    }
  }
}
// The reading page's one way to each neighbour: a compact Neighbours card at the end of About (the
// Town Hall's chapter), after its own sections and before the building's note, one for each in their
// order (hers, then his). Each card's heading says where its island lies; it holds the group in one
// line (its intro, a text of its own, never cut from the summary) and the neighbour's place in it
// (the group's lead, a text of its own too: her as one of UIA's Group Leaders, UAL as established
// and directed by him), the one tie, and two ways on: the group's website (read aloud with its
// address and the new tab) and the island in the city. Each card is its island's reading address,
// so the island's "Read on the page" lands there, its heading taking the focus. The Town Hall's City
// file has no card. The Gate's chapter (About this site) names both islands in its Layout, before
// the causeway's closing sentence.
{
  const hall = buildings.find((b) => b.id === 'town-hall');
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
      page = decoded(chapter);
    let last = -1;
    for (const text of [
      ...hall.sections.flatMap((s) => [s.heading[locale], s.body[locale]]),
      ...islands.flatMap(({ n, heading, site }) => [
        heading[locale],
        n.group.name[locale] + ' · ' + n.group.fullName[locale],
        n.group.intro[locale],
        n.group.lead[locale],
        n.group.connection[locale],
        site.label[locale],
        zh ? '在小城里打开' : 'Open in the city',
      ]),
      zh ? '这栋建筑' : 'About this building',
      zh ? '继续探索' : 'Continue exploring',
    ]) {
      const found = page.indexOf(text, last + 1);
      assert(found > last, 'About (' + locale + ') does not show, in its place: ' + text);
      last = found;
    }
    // One card for each neighbour, in their order, each its island's reading address.
    assert.deepEqual(
      elementsOf(chapter)
        .filter((e) => e.name === 'section' && e.classes.includes('neighbours'))
        .map((e) => e.attrs.id),
      ['read-sky-island', 'read-tropic-island'],
      'About (' + locale + ') does not end with the two Neighbours cards, hers and then his.',
    );
    for (const island of islands) {
      const { n, place } = island,
        group = n.group,
        card = cardOf(chapter, place),
        lead = group.intro[locale] + (zh ? '' : ' ') + group.lead[locale];
      assert(card, 'About (' + locale + ') has no Neighbours card for ' + place + '.');
      // Compact: the group's one line as the record writes it, then the neighbour's place in it, in
      // one paragraph, and none of its summary; and the island's own reading address.
      assert(
        textsOf(card).includes(lead),
        'The Neighbours card of ' + place + ' (' + locale + ') does not hold its group’s intro as written, followed by its lead.',
      );
      assert(!textsOf(card).some((t) => t.includes(group.summary[locale])), 'The Neighbours card of ' + place + ' holds its group’s whole summary.');
      const cardElements = elementsOf(card),
        [section, heading] = cardElements;
      assert(
        section?.name === 'section' &&
          section.classes.includes('neighbours') &&
          section.attrs.id === 'read-' + place &&
          heading?.name === 'h3' &&
          heading.attrs.tabindex === '-1' &&
          textIn(card, heading) === island.heading[locale] &&
          elementsOf(chapter).filter((e) => e.attrs.id === 'read-' + place).length === 1,
        'The card of ' + place + ' is not its reading address, its heading is not "' + island.heading[locale] + '", or it cannot take the focus.',
      );
      const site = cardElements.filter((e) => e.name === 'a' && e.classes.includes('button-primary') && e.classes.includes('site-link'));
      assert.equal(site.length, 1);
      assert(
        site[0].attrs.href === island.site.url && opensSafely(site[0].attrs) && site[0].attrs['aria-label'] === siteAria(island, locale),
        'The card’s website button for ' + place + ' (' + locale + ') does not go to ' + island.site.url + ' in a new tab, safely, read aloud as: ' + siteAria(island, locale),
      );
      const building = buildings.find((b) => b.id === place);
      assert.equal(
        cardElements.find((e) => e.name === 'button' && e.classes.includes('link-action'))?.attrs['aria-label'],
        (zh ? '在小城里打开：' : 'Open in the city: ') + building.name[locale] + ' · ' + building.style[locale],
        'The card’s Open in the city for ' + place + ' does not say what it opens.',
      );
      // Neither card names the other's neighbour.
      for (const other of islands)
        if (other !== island) assert(!other.surname.test(textsOf(card).join('\n')), 'The Neighbours card of ' + place + ' names ' + other.n.id + '.');
    }
    assert.deepEqual(
      [textIn(cardOf(chapter, 'sky-island'), elementsOf(cardOf(chapter, 'sky-island'))[1]), textIn(cardOf(chapter, 'tropic-island'), elementsOf(cardOf(chapter, 'tropic-island'))[1])],
      zh ? ['近邻 · 小城上空', '近邻 · 南岸外海上'] : ['Neighbours · Above the town', 'Neighbours · Off the south shore'],
    );
    // They open their islands in the city, from the chapter the page renders, in their order.
    const opened = [],
      tree = LabContent({ id: 'town-hall', locale, onOpen() {}, reading: true, onExplore: (id) => opened.push(id) });
    for (const button of find(tree, (e) => e.type === 'button' && e.props.className === 'link-action', ['NeighboursCard'])) button.props.onClick();
    assert.deepEqual(opened, ['sky-island', 'tropic-island'], 'The cards’ Open in the city does not open each island in the city.');
    const explore = () => {},
      pageTree = Chapters.type({ locale, onOpen() {}, onVisit() {}, onHoverBuilding() {}, onExplore: explore });
    assert(
      find(pageTree, (e) => e.type === LabContent && e.props.id === 'town-hall').every((e) => e.props.onExplore === explore),
      'The reading page does not hand About the way to open a place in the city.',
    );
    // The Town Hall's City file has no card, and the Gate's Layout names both islands, the sky island
    // first, before its closing sentence on the causeway.
    assert(!renderToStaticMarkup(React.createElement(LabContent, { id: 'town-hall', locale, onOpen() {} })).includes('class="neighbours"'), 'The Town Hall’s City file has a Neighbours card.');
    const layout = buildings.find((b) => b.id === 'lius-gate').sections.find((s) => s.heading.en === 'Layout').body[locale];
    assert(
      layout.includes(islands[0].layout[locale]) && layout.indexOf(islands[1].layout[locale]) > layout.indexOf(islands[0].layout[locale]),
      'The Gate’s Layout does not name the sky island, then the tropic island.',
    );
  }
  // An abbreviation in a group's line never cuts it short: each card shows the intro as the record
  // writes it (cut from the summary at its first full stop, "Prof." or "e.g." broke the sentence).
  {
    const abbreviated = 'The group, led by Prof. Ann Example and Dr. Ben Example, studies cities, e.g. how they change.',
      site = await siteOver('neighbour-abbreviated', {
        ...next,
        neighbours: next.neighbours.map((n) => ({
          ...n,
          group: { ...n.group, intro: { ...n.group.intro, en: abbreviated }, summary: { ...n.group.summary, en: abbreviated + ' ' + n.group.summary.en } },
        })),
      }),
      chapter = renderToStaticMarkup(React.createElement(site.content.LabContent, { id: 'town-hall', locale: 'en', onOpen() {}, reading: true, onExplore() {} }));
    for (const { n, place } of islands)
      assert(textsOf(cardOf(chapter, place)).includes(abbreviated + ' ' + n.group.lead.en), 'An abbreviation cuts a group’s line on the Neighbours card of ' + place + ' short.');
  }
}
// A neighbour's name is shown on their island's own surfaces and in their Neighbours card in About
// only, never as a person. No other place's file, no record's, no other part of the page (the other
// neighbour's card included) and not the footer names them, in either language or mode (in what a
// visitor reads or hears: her staff page's address, in her island's file, has her name in it).
{
  const names = (html, island) => island.surname.test(textsOf(html).join('\n'));
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
        for (const island of islands) {
          if (id === 'town-hall' && reading) assert(names(cardOf(html, island.place), island), 'About (' + locale + ') does not name ' + island.n.id + ' in their Neighbours card.');
          if (![island.place, 'place:' + island.place].includes(id))
            assert(!names(withoutCardOf(html, island.place), island), id + '’s ' + (reading ? 'chapter' : 'file') + ' (' + locale + ') names ' + island.n.id + '.');
        }
        assert.deepEqual(unsafeOutbound(html), [], 'A link off ' + id + ' (' + locale + ') is unsafe.');
      }
    const pageText = renderToStaticMarkup(React.createElement(Chapters, { locale, onOpen() {}, onVisit() {}, onHoverBuilding() {}, onExplore() {} })),
      footer = renderToStaticMarkup(React.createElement(SiteFooter, { locale, onNavigate() {} }));
    for (const island of islands)
      assert(
        names(pageText, island) && !names(withoutCardOf(pageText, island.place), island) && !names(footer, island),
        'The reading page (' + locale + ') names ' + island.n.id + ' outside their card in About.',
      );
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
          value('target') === '_blank' && opensSafely({ target: value('target'), rel: value('rel') ?? '' }),
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
// narrowest gaps, beside City mode's wider "Reading view", are 18 px at 961 and 35 px at 1041 (29.6
// and 46.2 before the wordmark took its motto's two lines there, 11 px wider than the name alone).
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
  // Still seven: each neighbour's island has a City file and a card in About, but no chapter or chip.
  assert.equal(chapterMeta.length, 7);
  for (const place of ['sky-island', 'tropic-island'])
    assert(!chapterMeta.some((c) => c.id === place), 'The ' + place + ' has a masthead chip.');
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
// writes that copy about Alison Heppenstall and UIA (a group, by its own word) and Filip Biljecki and
// UAL (a lab, by its own name), so it is site copy too. Two sources are not site copy and are not
// scanned: the catalogue's validation messages in content-schema.ts, which only maintainers see (a
// catalogue that fails them is never published), and the rest of content/lab.json, whose records
// are people's own words: a bio may name a lab someone worked in.
{
  const lab = (text) => {
    const words = text.replace(/\b(?:https?:\/\/|mailto:)\S+/g, ' ');
    return /\blab(?:s|oratory|oratories)?\b/i.test(words) || /实验室/.test(words);
  };
  /**
   * The scan of the neighbours' copy. One neighbour's group has a lab word in its own name: UAL's,
   * "Urban Analytics Lab". That name, exactly as UAL writes it (case and all), is struck out of the
   * neighbours' copy before the scan reads it, and only there: the site's own code and index.html
   * are scanned whole, Chinese 实验室 is never allowed (UAL's name stays in Latin script in Chinese),
   * any other lab word in the copy is still caught, and a sentence that names Liu’s Gate may not hold
   * the name at all (the wording rules read it unstruck). The exemption is the name, never the
   * group's fullName field: a maintainer cannot unlock the word by naming a group "… Lab".
   */
  const neighbourLab = (text) => lab(text.replace(/\bUrban Analytics Lab\b/g, ' '));
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
  // The scan sees what it should: these are caught, and these are not. UAL's name is caught in the
  // site's own code: the exemption is the neighbours' copy's alone.
  for (const [source, caught] of [
    ["const t = 'Our lab at Glasgow';", true],
    ['const t = <p>The Liu Lab</p>;', true],
    ['const t = `Laboratory ${x} notes`;', true],
    ["const t = '刘家门实验室';", true],
    ["const t = 'Urban Analytics Lab';", true],
    ['const t = <p>UAL · Urban Analytics Lab</p>;', true],
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
  // The neighbours' scan lets UAL's own name through, written as UAL writes it, and nothing else: any
  // other spelling of it, any other lab word beside it, 实验室, and Liu’s Gate called a lab are caught.
  for (const [text, caught] of [
    ['UAL · Urban Analytics Lab', false],
    ['UAL（Urban Analytics Lab）的创立者和首席研究员。', false],
    ['the founder and principal investigator of the NUS Urban Analytics Lab.', false],
    ['The Urban Analytics Lab is a lab that studies cities.', true],
    ['urban analytics lab', true],
    ['URBAN ANALYTICS LAB', true],
    ['Urban Analytics Labs', true],
    ['Urban Analytics Laboratory', true],
    ['UAL 实验室', true],
    ['UAL（城市分析实验室）', true],
    ['Liu’s Gate Lab', true],
    ['Liu’s Gate is a lab at the University of Glasgow.', true],
    ['Like the Urban Analytics Lab, Liu’s Gate is a lab.', true],
  ])
    assert.equal(neighbourLab(text), caught, 'The neighbours’ lab scan reads: ' + text);
  assert(lab('UAL · Urban Analytics Lab'), 'The site’s own scan lets UAL’s name through.');
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
  // member's bio alone. It reads every neighbour in content/lab.json, a draft too, and both records.
  const scanned = (edit, words, i = 0) => {
    const cat = structuredClone(withThem);
    edit(cat, cat.neighbours[i]);
    return neighbourCopy(cat).some((t) => t.includes(words) && neighbourLab(t));
  };
  assert(scanned((cat, n) => (n.group.summary.en = 'UIA is a lab that studies cities.'), 'UIA is a lab'), 'The scan misses a lab word in a neighbour’s English.');
  assert(scanned((cat, n) => (n.sections[1].body.zh = 'UIA 实验室'), 'UIA 实验室'), 'The scan misses a lab word in a neighbour’s Chinese.');
  assert(!scanned((cat) => (cat.people[0].summary.en += ' Once in a lab.'), 'Once in a lab.'), 'The scan reads a member’s bio.');
  // In his copy, UAL's name passes and every other lab word is still caught, Liu’s Gate called one too.
  assert(scanned((cat, n) => (n.summary.en += ' Liu’s Gate is a lab too.'), 'Liu’s Gate is a lab', 1), 'The scan misses Liu’s Gate called a lab in his copy.');
  assert(scanned((cat, n) => (n.group.summary.zh += '刘家门也是一个实验室。'), '刘家门也是一个实验室', 1), 'The scan misses 实验室 in his copy.');
  assert(scanned((cat, n) => (n.group.intro.en = 'UAL is a lab at NUS.'), 'UAL is a lab', 1), 'The scan misses a lab word beside UAL’s name.');
  assert(scanned((cat, n) => (n.group.fullName.en = 'Urban Analytics Laboratory'), 'Urban Analytics Laboratory', 1), 'The scan lets another spelling of UAL’s name through.');
  const herTexts = neighbourCopy(withHer),
    hisTexts = neighbourCopy(withHim),
    neighbourTexts = neighbourCopy(catalog);
  assert(herTexts.length >= 18 && hisTexts.length >= 18, 'The copy scan read their text (' + herTexts.length + ' and ' + hisTexts.length + ' pieces).');
  assert(neighbourTexts.length >= 18 * catalog.neighbours.length, 'The copy scan read the neighbours’ text (' + neighbourTexts.length + ' pieces).');
  // His copy names UAL in full, which the site's own scan would refuse: the exemption is what lets it
  // through, and nothing else in it needs one.
  assert(hisTexts.some(lab) && hisTexts.filter(lab).every((t) => t.includes('Urban Analytics Lab')), 'His copy holds a lab word that is not UAL’s name.');
  for (const text of herTexts) assert(!neighbourLab(text), 'scripts/fixtures/alison-heppenstall.json uses a lab word: ' + text);
  for (const text of hisTexts) assert(!neighbourLab(text), 'scripts/fixtures/filip-biljecki.json uses a lab word: ' + text);
  for (const text of neighbourTexts) assert(!neighbourLab(text), 'content/lab.json’s neighbours use a lab word: ' + text);
  // The wording rules, read in every sentence of the neighbours' copy, whatever its field:
  // - Liu’s Gate is never called a lab or a group: no sentence that names it calls anything one.
  //   UIA, a group by its own word, UAL, a lab by its own name, and the universities' research
  //   groups are named in sentences of their own.
  // - Nor is it one by its supervisor's name: no "Pengyuan Liu’s research group", "the Liu group"
  //   or 刘鹏远老师的课题组, in any sentence.
  // - The one tie the sources state for each group, and nothing stronger: Pengyuan Liu is listed as
  //   an Associate of UIA, and among UAL's alumni as a Research Fellow. No sentence that names the
  //   Gate or a Liu (Liu, 刘) says part of, belongs to, member, co-supervises or affiliated (属于,
  //   隶属, 成员, 共同指导, 联合指导): so UAL's alumni are 校友 (Alumni) in Chinese, never 前成员.
  // - Their names and their groups' stay in Latin script: no text writes them in Chinese characters.
  //   A heuristic: the usual transliterations of Alison, Heppenstall, Filip and Biljecki, and UIA's
  //   and UAL's names translated.
  const sentences = (texts) => texts.flatMap((t) => t.split(/(?<=[.!?。！？])\s*/)).filter(Boolean);
  const namesTheGate = (s) => /Liu[’']s Gate|LIU[’']S GATE|刘家门/.test(s);
  const namesALiu = (s) => /\bLiu\b/i.test(s) || /刘/.test(s);
  const callsAGroup = (s) => /\b(?:labs?|laborator(?:y|ies)|groups?|teams?)\b/i.test(s) || /实验室|研究组|课题组|团队|小组/.test(s);
  const callsHisPeopleAGroup = (s) =>
    /\bLiu(?:[’']s)?\s+(?:research\s+)?(?:labs?|laborator(?:y|ies)|groups?|teams?)\b/i.test(s) ||
    /刘(?:鹏远)?(?:老师|教授|博士)?的?(?:研究)?(?:实验室|研究组|课题组|团队|小组)/.test(s);
  const strongerTie = (s) =>
    /\b(?:part of|belongs? to|member(?:s|ship)?|co-?supervis\w*|affiliat\w*)\b/i.test(s) || /属于|隶属|成员|共同指导|联合指导/.test(s);
  const namesInChinese = (s) =>
    /[艾爱](?:莉|利|丽)森|[赫海](?:彭|本|朋|普)斯(?:托|通|塔|特|顿)尔|城市智能(?:与|和|及)?分析|菲(?:利|力|立)(?:普|浦|蒲)|比尔?(?:列|耶|利|莱)(?:茨|奇|契|采)?基|城市分析(?:实验室|研究室|研究组|课题组|小组|团队)/.test(s);
  /** What the copy says that the wording rules forbid: each sentence, with the rule it breaks. */
  const wordingFaults = (texts) =>
    sentences(texts).flatMap((s) => [
      ...(namesTheGate(s) && callsAGroup(s) ? ['calls Liu’s Gate a lab or a group: ' + s] : []),
      ...(callsHisPeopleAGroup(s) ? ['calls its supervisor’s people a lab, a group or a team: ' + s] : []),
      ...(namesALiu(s) && strongerTie(s) ? ['states a tie stronger than its sources do: ' + s] : []),
      ...(namesInChinese(s) ? ['writes a neighbour’s name or their group’s in Chinese characters: ' + s] : []),
    ]);
  // The rules read what they should: these are caught, wherever in their copy they stand, and the
  // real ties, each group by its own word and the universities' research groups are not.
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
    // His: a former member is a member, Liu’s Gate beside UAL's full name is a lab, and his name
    // and UAL's are not translated.
    ['刘鹏远是 UAL 的前成员（Alumni）。', true],
    ['Pengyuan Liu is a former member of UAL.', true],
    ['Pengyuan Liu, the supervisor of Liu’s Gate, is listed among the Urban Analytics Lab’s alumni.', true],
    ['Liu’s Gate works with the Urban Analytics Lab.', true],
    ['菲利普·比列茨基是新加坡国立大学副教授。', true],
    ['UAL 由比列茨基创立。', true],
    ['UAL（城市分析实验室）用数据感知城市。', true],
    ['UIA is a group. Pengyuan Liu, the supervisor of Liu’s Gate, is an Associate.', false],
    [alison.group.connection.en, false],
    [alison.group.connection.zh, false],
    [filip.group.connection.en, false],
    [filip.group.connection.zh, false],
    [filip.group.lead.en, false],
    [filip.group.lead.zh, false],
    ['UIA 是一个研究团队。', false],
    ['UAL describes itself as “A GeoAI research group at the National University of Singapore”.', false],
    ['At Glasgow she is listed in two research groups, Urban Analytics and Just Cities & Societies.', false],
    ['Alison Heppenstall 是 UIA（Urban Intelligence & Analytics）的团队负责人之一。', false],
    ['Filip Biljecki 是 UAL（Urban Analytics Lab）的创立者。', false],
  ])
    assert.equal(wordingFaults([text]).length > 0, caught, 'The wording rules read: ' + text);
  // And the rules see every field: a fault set in any of either's texts is caught.
  for (const [where, i, edit] of [
    ['her summary', 0, (n) => (n.summary.en += ' She works with the Liu group.')],
    ['her Background', 0, (n) => (n.sections[0].body.en += ' Liu’s Gate is part of UIA.')],
    ['her Research', 0, (n) => (n.sections[1].body.zh += '她与刘鹏远联合指导博士生。')],
    ['UIA’s summary', 0, (n) => (n.group.summary.zh += '刘家门隶属于 UIA。')],
    ['UIA’s one-line introduction', 0, (n) => (n.group.intro.en += ' Liu’s Gate is part of UIA.')],
    ['her place in UIA', 0, (n) => (n.group.lead.zh += '刘家门属于 UIA。')],
    ['her role', 0, (n) => (n.role.zh = '赫彭斯托尔教授')],
    ['her staff page’s label', 0, (n) => (n.links[0].label.zh = '艾莉森的格拉斯哥大学教师主页')],
    ['his summary', 1, (n) => (n.summary.en += ' He works with the Liu group.')],
    ['his Background', 1, (n) => (n.sections[0].body.zh += '刘鹏远是 UAL 的前成员。')],
    ['his Research', 1, (n) => (n.sections[1].body.en += ' Liu’s Gate is part of UAL.')],
    ['UAL’s summary', 1, (n) => (n.group.summary.en += ' Pengyuan Liu is a member of UAL.')],
    ['UAL’s one-line introduction', 1, (n) => (n.group.intro.zh += '刘家门隶属于 UAL。')],
    ['his place in UAL', 1, (n) => (n.group.lead.en += ' Liu’s Gate is part of UAL.')],
    ['UAL’s tie', 1, (n) => (n.group.connection.en = 'Pengyuan Liu, the supervisor of Liu’s Gate, is listed among the Urban Analytics Lab’s alumni.')],
    ['his role', 1, (n) => (n.role.zh = '比列茨基副教授')],
    ['his page’s label', 1, (n) => (n.links[0].label.zh = '菲利普的 UAL 官网个人主页')],
  ]) {
    const cat = structuredClone(withThem);
    edit(cat.neighbours[i]);
    assert.equal(wordingFaults(neighbourCopy(cat)).length, 1, 'The wording rules miss a fault in ' + where + '.');
  }
  assert(sentences(herTexts).some(namesTheGate) && sentences(hisTexts).some(namesTheGate), 'Their copy names Liu’s Gate (the connection lines).');
  assert.deepEqual(wordingFaults(herTexts), [], 'scripts/fixtures/alison-heppenstall.json breaks a wording rule.');
  assert.deepEqual(wordingFaults(hisTexts), [], 'scripts/fixtures/filip-biljecki.json breaks a wording rule.');
  // So does the draft example a maintainer starts from.
  const exampleTexts = neighbourCopy({ neighbours: [JSON.parse(await fs.readFile(path.join(root, 'content/examples/neighbour.json'), 'utf8'))] });
  assert(exampleTexts.length >= 18 && !exampleTexts.some(neighbourLab), 'content/examples/neighbour.json uses a lab word.');
  assert.deepEqual(wordingFaults(exampleTexts), [], 'content/examples/neighbour.json breaks a wording rule.');
  // The site's own copy around each record is read by the same rules: the island's place (its name,
  // category, summary, the building's text and where it lies), the Gate's Layout sentence on it, and
  // every text a visitor reads or hears in its file and in its Neighbours card in About (the copy
  // that sits beside the Gate's own and names it), the record's and the page's alike, in both
  // languages. A fault in what the file or the card shows is caught there.
  const shownOf = (island, labContent) =>
    ['en', 'zh'].flatMap((locale) => [
      ...textsOf(renderToStaticMarkup(React.createElement(labContent, { id: island.place, locale, onOpen() {} }))),
      ...textsOf(cardOf(renderToStaticMarkup(React.createElement(labContent, { id: 'town-hall', locale, onOpen() {}, reading: true })), island.place)),
    ]);
  for (const island of islands) {
    const building = buildings.find((b) => b.id === island.place),
      siteCopy = [
        ...[building.name, building.category, building.summary, building.style, building.architecture, building.where].flatMap((t) => [t.en, t.zh]),
        island.layout.en,
        island.layout.zh,
        ...shownOf(island, LabContent),
      ];
    assert(sentences(siteCopy).filter(namesTheGate).length >= 4, 'The file of ' + island.place + ' and its card name Liu’s Gate (the connection line).');
    assert.deepEqual(wordingFaults(siteCopy), [], 'The place ' + island.place + ', its file or its Neighbours card breaks a wording rule.');
    assert(!siteCopy.some(neighbourLab), 'The place ' + island.place + ', its file or its Neighbours card uses a lab word.');
  }
  const planted = await siteOver('neighbour-wording', {
    ...next,
    neighbours: next.neighbours.map((n) => ({
      ...n,
      group: { ...n.group, connection: { en: 'Liu’s Gate is part of ' + n.group.name.en + '.', zh: '刘家门隶属于 ' + n.group.name.zh + '。' } },
    })),
  });
  for (const island of islands)
    assert.equal(wordingFaults(shownOf(island, planted.content.LabContent)).length, 4, 'The wording rules miss a fault the file of ' + island.place + ' or its card shows.');
  // The neighbours content/lab.json holds, as they are (the checks above ran on the fixtures). Every
  // published one keeps to the wording rules, in its record and in what its island's file and its
  // card in About show of it, links included, and About holds one card for each, in their order. An
  // island with none published (its neighbour's profile taken down: the record set to draft, or
  // removed) is its own again: its own category and summary, the building's file and no card.
  {
    const live = catalog.neighbours.filter((n) => n.visibility === 'published').sort((a, b) => a.order - b.order),
      site = await siteOver('neighbours-live', catalog);
    assert.deepEqual(wordingFaults(neighbourCopy({ neighbours: live })), [], 'A published neighbour in content/lab.json breaks a wording rule.');
    // The card goes on from a group's one-line introduction with its lead, one sentence of its own
    // in turn, so each ends one.
    for (const n of live)
      for (const locale of ['en', 'zh']) {
        assert(/[.!?。！？]$/.test(n.group.intro[locale].trim()), n.id + '’s group.intro.' + locale + ' does not end in a full stop: About’s card goes on with another sentence.');
        assert(
          /[.!?。！？]$/.test(n.group.lead[locale].trim()) && sentences([n.group.lead[locale]]).length === 1,
          n.id + '’s group.lead.' + locale + ' is not one sentence ending in a full stop.',
        );
      }
    const render = (id, locale, reading = false) =>
      renderToStaticMarkup(React.createElement(site.content.LabContent, { id, locale, onOpen() {}, reading, onExplore() {} }));
    for (const locale of ['en', 'zh'])
      assert.deepEqual(
        elementsOf(render('town-hall', locale, true))
          .filter((e) => e.name === 'section' && e.classes.includes('neighbours'))
          .map((e) => e.attrs.id),
        live.map((n) => 'read-' + n.buildingId),
        'About (' + locale + ') does not hold one Neighbours card for each neighbour published, in their order.',
      );
    for (const island of islands) {
      const n = live.find((l) => l.buildingId === island.place),
        place = site.data.buildings.find((b) => b.id === island.place);
      if (!n) {
        assert.deepEqual([place.category, place.summary], [island.own.category, island.own.summary], 'With no neighbour published, ' + island.place + ' is not its own again.');
        for (const locale of ['en', 'zh']) {
          const file = render(island.place, locale),
            lead = elementsOf(file).find((e) => e.name === 'p' && e.classes.includes('record-lead'));
          assert(
            lead &&
              textIn(file, lead) === place.summary[locale] &&
              decoded(file).includes(place.architecture[locale]) &&
              !elementsOf(file).some((e) => e.classes.includes('neighbour-file')),
            'With no neighbour published, the file of ' + island.place + ' (' + locale + ') is not its own.',
          );
          assert(!cardOf(render('town-hall', locale, true), island.place), 'With no neighbour published, About (' + locale + ') still holds a card for ' + island.place + '.');
        }
      } else {
        assert.deepEqual(place.category, { en: (n.title.en + ' · ' + n.group.name.en).toUpperCase(), zh: n.title.zh + ' · ' + n.group.name.zh }, 'The category of ' + n.buildingId + ' does not name its neighbour.');
        for (const locale of ['en', 'zh']) {
          const file = render(n.buildingId, locale),
            card = cardOf(render('town-hall', locale, true), n.buildingId);
          assert(
            file.includes('neighbour-file') && textsOf(file).includes(n.summary[locale]) && textsOf(card).includes(n.group.connection[locale]),
            'The file of ' + n.buildingId + ' or its card in About (' + locale + ') does not show ' + n.id + '.',
          );
          assert.deepEqual(wordingFaults([...textsOf(file), ...textsOf(card)]), [], 'What the file of ' + n.buildingId + ' or its card in About (' + locale + ') shows of ' + n.id + ' breaks a wording rule.');
          assert(![...textsOf(file), ...textsOf(card)].some(neighbourLab), 'What the file of ' + n.buildingId + ' or its card in About (' + locale + ') shows of ' + n.id + ' uses a lab word.');
          assert.deepEqual(unsafeOutbound(file + card), [], 'A link off the file of ' + n.buildingId + ' or its card in About (' + locale + ') is unsafe.');
        }
      }
    }
  }
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
  // The neighbours content/lab.json holds, whoever they are, or none.
  { args: ['list', 'neighbours'], output: catalog.neighbours.length ? new RegExp('"id": "' + catalog.neighbours[0].id + '"') : /^\[\]$/m },
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
  'Content checks passed: persistent CRUD with backups, references, invalid dates/links, member/research/event/output/note rendering, visitor-facing empty chapters, role labels, the Visiting PhD Residence empty and shared by two test visitors, departures on fixed UTC days (a member who left, a visitor gone home as Returned, a 2099 leaver, a home that empties and fills again, malformed blocks refused), those who have left filed at the airport (chapter, camera, place and file) while the home a founding member left is still faced from People, the Departures chapter as chapter 03 and its board (newest first, rows that fold out on the page or open a file in the city, read aloud as sentences, the empty board’s row to be announced and its note), nobody at the Gate on ' + DAY + ' gone by then so the live site unchanged, checks that hold whatever real departures are entered, the About this site chapter, readable dates, Gate’s News order, 12-month window and rendering, Join us subject lines, full profiles and email addresses on the reading-view person cards, v1 migration and v2 files from before the neighbours, a misspelt or stray collection refused by name, no Chinese characters or punctuation in English text, properties, bilingual routes and scene targets, the neighbours (Alison Heppenstall and UIA on the sky island, Filip Biljecki and UAL on the tropic island: a collection of their own with strict fields, each fault in its own message, one published neighbour a place, HTTPS links only, Chinese text translated save the names, never a person, member, resident or address anywhere on the site, a draft kept back, edited by the command; checked on fixtures of their records, so that either profile can be taken down, a draft or removed, with the checks still passing, and content/lab.json’s own neighbours checked as they are: each published one within the wording rules, an island with none its own again), the facts from both sites (no photo, their names and their groups’ in Latin script in Chinese, the sources’ own addresses, each group’s lead as it writes it), the wording rules in every sentence of their copy (no tie stronger than the sources state, Associate of UIA and among UAL’s alumni as a Research Fellow, their names and their groups’ never in Chinese characters, Liu’s Gate never a lab or a group, by its name or its supervisor’s), each island’s City file (their category, role, profile, group and its button, their own page, their full profile folded away, the building; the island’s own again with no record) and About’s two Neighbours cards in their order (each heading saying where its island lies, the group in one line, the record’s own intro, never cut at an abbreviation, followed by the group’s lead, the tie, its two ways on, the island’s reading address), each name nowhere else on the page, the same wording rules over the files’ and the cards’ copy, the Gate’s work never filed at a neighbour’s place, every link off the site opening a new tab with rel noopener noreferrer (attributes parsed, the tokens in either order), still seven chapter chips, and site copy, the neighbours’ included, that never calls Liu’s Gate a lab (UAL’s own name, Urban Analytics Lab, let through in the neighbours’ copy only).',
);
