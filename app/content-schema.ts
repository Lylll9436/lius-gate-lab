// Type-only, so it is erased and adds no import cycle at run time (city-data imports lab-records,
// which imports this module), nor anything for the maintenance command to load.
import type { BuildingId } from './city-data';
export type Localized = { en: string; zh: string };
export type Collection =
  | 'people'
  | 'research'
  | 'events'
  | 'outputs'
  | 'notes'
  | 'neighbours';
export type RecordBase = {
  id: string;
  title: Localized;
  summary: Localized;
  visibility: 'draft' | 'published';
  order: number;
  sections: { heading: Localized; body: Localized }[];
  links: { label: Localized; url: string }[];
  properties: { key: string; label: Localized; value: Localized }[];
};
/**
 * Where someone went when they left Liu’s Gate. Their record stays published, so its address and
 * the events that name them keep working; role, affiliation and buildingId stay as they were, as
 * history. On `date` they leave the members and go on the departures board.
 */
export type Departure = {
  /** The UTC day they set off, YYYY-MM-DD. It may lie ahead: they move on that day. */
  date: string;
  /** The board's destination: the city, e.g. Edinburgh, UK / 英国爱丁堡. */
  city: Localized;
  /** Where they are now: the institution or employer. */
  destination: Localized;
  /** Their role there, or null. */
  role: Localized | null;
  /** A page of their own, or null. It replaces a student mailbox that closes when they leave. */
  link: { label: Localized; url: string } | null;
};
export type PersonRecord = RecordBase & {
  role: Localized;
  affiliation: Localized;
  photo: string | null;
  buildingId: string | null;
  /** Left out while they are at the Gate. */
  departure?: Departure;
};
export type ResearchRecord = RecordBase & {
  status: 'active' | 'completed';
  people: string[];
  buildingId: string | null;
};
export type EventRecord = RecordBase & {
  date: string;
  category: 'group-photo' | 'celebration' | 'milestone';
  people: string[];
  image: string | null;
};
export type OutputRecord = RecordBase & {
  type: 'paper' | 'dataset' | 'software' | 'report';
  date: string;
  people: string[];
  researchId: string | null;
  buildingId: string | null;
};
export type NoteRecord = RecordBase & {
  date: string;
  people: string[];
  researchId: string | null;
  buildingId: string | null;
};
/** A link off the site: a label in en and zh, and an HTTPS address. */
export type OutboundLink = { label: Localized; url: string };
/**
 * A neighbour's group, as its own site describes it (UIA, for Alison Heppenstall). It may be called
 * a group, its own word; Liu’s Gate never is: it is a 师门, never a lab or a research group.
 */
export type NeighbourGroup = {
  /** Its short name as it writes it, the same in both languages: UIA. */
  name: Localized;
  /** Its full name as it writes it, kept in English in the Chinese copy too. */
  fullName: Localized;
  /**
   * It in one sentence, for the reading page's Neighbours card, which goes on with the neighbour as
   * one of its leaders: a sentence that stands on its own, ending in a full stop.
   */
  intro: Localized;
  /** What it does, in its own site's terms: its own line quoted, the rest a short summary. */
  summary: Localized;
  /** Its tie to Liu’s Gate as the sources state it, and nothing stronger. */
  connection: Localized;
  /** Its website, the main way out from the neighbour's file. */
  site: OutboundLink;
};
/**
 * A neighbour of the town: a researcher beside it who is not part of Liu’s Gate, with her group
 * (Alison Heppenstall and UIA, on the sky island). Not a person: never a member, a leaver, a
 * resident or someone with a home, and no address of her own (getRecord does not know
 * neighbours). Her place's file shows her (lab-records' neighbourFor). Her links are HTTPS only,
 * and there are no properties.
 */
export type NeighbourRecord = Omit<RecordBase, 'properties'> & {
  role: Localized;
  affiliation: Localized;
  /** An image under /people/ or /media/, or null. Alison Heppenstall's is null: the site shows no photo of her. */
  photo: string | null;
  /** The place whose City file shows them: one of neighbourPlaces (the sky island). */
  buildingId: BuildingId;
  group: NeighbourGroup;
};
export type LabCatalog = {
  schemaVersion: 2;
  people: PersonRecord[];
  research: ResearchRecord[];
  events: EventRecord[];
  outputs: OutputRecord[];
  notes: NoteRecord[];
  neighbours: NeighbourRecord[];
};
/** A record of Liu’s Gate's: one of its people, or their work and life. */
export type LabRecord =
  | PersonRecord
  | ResearchRecord
  | EventRecord
  | OutputRecord
  | NoteRecord;
/** Any row of the catalogue: a record of Liu’s Gate's, or a neighbour. */
export type CatalogRecord = LabRecord | NeighbourRecord;
/** Liu’s Gate's own collections, checked together: its people and their work and life. */
const gateCollections: Exclude<Collection, 'neighbours'>[] = [
  'people',
  'research',
  'events',
  'outputs',
  'notes',
];
/** Every collection the maintenance command edits: the Gate's own, then its neighbours. */
export const collections: Collection[] = [...gateCollections, 'neighbours'];
/**
 * The places in the town, every one of city-data's BuildingId (check-content compares the two
 * lists). A research project, an output or a note may be filed at any of them but a neighbour's.
 */
export const buildingIds: readonly string[] = [
  'lius-gate',
  'town-hall',
  'pengyuan-liu',
  'yunlong-liu',
  'qin-li',
  'visiting-phd',
  'sky-island',
  'tropic-island',
  'airport',
  'research-studio',
  'city-archive',
] satisfies BuildingId[];
/**
 * The places that may hold a neighbour, whose City file shows them: the sky island. Never a
 * member's home or the residence. Each is one of buildingIds (check-content checks it), and none of
 * the Gate's own work is filed there: the island's file is the neighbour's.
 */
export const neighbourPlaces: readonly string[] = [
  'sky-island',
] satisfies BuildingId[];
/**
 * What is wrong with the place a project, an output or a note is filed at: it is none (null) or one
 * of the town's places, never a neighbour's, so the Gate's work never reads as UIA's. `unknownError`
 * is the collection's own message for a place the town does not have.
 */
function workPlaceErrors(
  at: string,
  place: unknown,
  unknownError: string,
): string[] {
  if (place === null) return [];
  if (typeof place !== 'string' || !buildingIds.includes(place))
    return [unknownError];
  if (neighbourPlaces.includes(place))
    return [
      at +
        '.buildingId: ' +
        place +
        ' is a neighbour’s place; file the Gate’s work at one of its own.',
    ];
  return [];
}
/** A person lives in one of the members' homes (one each) or in the residence (shared). */
const homeIds = ['pengyuan-liu', 'yunlong-liu', 'qin-li'];
export const RESIDENCE_ID = 'visiting-phd';
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
/**
 * Chinese, which English text has none of, in every collection: a Han character (with the radicals,
 * the compatibility ideographs and those beyond the BMP), or Chinese or full-width punctuation and
 * forms pasted from the Chinese copy: the full-width comma and brackets, the ideographic comma and
 * full stop, corner brackets.
 */
const chinese =
  /[\u2e80-\u2fdf\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]|[\u{20000}-\u{323af}]/u;
/** A Han character: a neighbour's Chinese text has one, save the names that stay in Latin script. */
const han = /[\u3400-\u9fff\uf900-\ufaff]|[\u{20000}-\u{323af}]/u;
const localized = (v: unknown) =>
  object(v) &&
  typeof v.en === 'string' &&
  !!v.en.trim() &&
  typeof v.zh === 'string' &&
  !!v.zh.trim() &&
  !chinese.test(v.en);
/**
 * A link the site may open: a mailto address, or an HTTPS address written plainly that a browser
 * parses as written (the WHATWG URL parser, as the page's own `new URL`), with a host and no user
 * name or password before it: https://urban-ai.uk@example.org/ goes to example.org, and a bad port
 * such as https://urban-ai.uk:8o80/ does not parse at all.
 */
export const safeLink = (v: unknown) => {
  if (typeof v !== 'string') return false;
  if (/^mailto:[^\s@]+@[^\s@]+$/.test(v)) return true;
  if (!/^https:\/\/[^/?#\s@]+(?:[/?#]\S*)?$/.test(v)) return false;
  try {
    const url = new URL(v);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !!url.hostname
    );
  } catch {
    return false;
  }
};
const asset = (v: unknown) =>
  v === null ||
  (typeof v === 'string' &&
    /^\/(?:people|media)\/[a-zA-Z0-9/_-]+\.(?:png|jpg|jpeg|webp)$/.test(v) &&
    !v.includes('..'));
/** A real day written YYYY-MM-DD (so never 2026-02-31): the rule for every date in the catalogue. */
const realDate = (v: unknown) =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
/** A person's fields, so a typo such as `depature` fails instead of being ignored. */
const personKeys = [
  'id',
  'title',
  'summary',
  'visibility',
  'order',
  'sections',
  'links',
  'properties',
  'role',
  'affiliation',
  'photo',
  'buildingId',
  'departure',
];
const departureKeys = ['date', 'city', 'destination', 'role', 'link'];
const unknownKeys = (at: string, v: Record<string, unknown>, known: string[]) =>
  Object.keys(v)
    .filter((key) => !known.includes(key))
    .map((key) => at + ': unknown field "' + key + '".');
/** What is wrong with a departure block, field by field. Its status is derived, never stored. */
function departureErrors(at: string, v: unknown): string[] {
  if (!object(v))
    return [
      at + ' must be an object with date, city, destination, role and link.',
    ];
  const errors = unknownKeys(at, v, departureKeys);
  if (!realDate(v.date))
    errors.push(at + '.date must be a real YYYY-MM-DD date.');
  for (const field of ['city', 'destination'])
    if (!localized(v[field]))
      errors.push(
        at +
          '.' +
          field +
          ': supply en and zh (English must contain no Chinese).',
      );
  if (v.role !== null && !localized(v.role))
    errors.push(
      at + '.role must be null or en and zh (English must contain no Chinese).',
    );
  const link = v.link;
  if (
    link !== null &&
    !(
      object(link) &&
      !unknownKeys('', link, ['label', 'url']).length &&
      localized(link.label) &&
      typeof link.url === 'string' &&
      link.url.startsWith('https://') &&
      safeLink(link.url)
    )
  )
    errors.push(
      at + '.link must be null or a label in en and zh with an HTTPS address.',
    );
  return errors;
}
/** A neighbour's fields. No properties: none has a use yet, so adding them is a typo too. */
const neighbourKeys = [
  'id',
  'title',
  'summary',
  'visibility',
  'order',
  'role',
  'affiliation',
  'photo',
  'buildingId',
  'group',
  'sections',
  'links',
];
const groupKeys = [
  'name',
  'fullName',
  'intro',
  'summary',
  'connection',
  'site',
];
/**
 * What is wrong with a neighbour's text, each fault in words of its own: a language missing or
 * blank, Chinese in the English, a Chinese text with no Chinese in it (the English pasted in,
 * untranslated), or a field that is neither en nor zh. `latin`: a name that stays in Latin script
 * in Chinese too (hers, UIA's and its full name), so its zh needs no Han character.
 */
function textErrors(at: string, v: unknown, latin = false): string[] {
  if (!object(v)) return [at + ' must be a text with en and zh.'];
  const errors = unknownKeys(at, v, ['en', 'zh']);
  for (const lang of ['en', 'zh']) {
    const text = v[lang];
    if (typeof text !== 'string' || !text.trim())
      errors.push(at + '.' + lang + ' is missing: supply en and zh.');
  }
  if (typeof v.en === 'string' && chinese.test(v.en))
    errors.push(at + '.en contains Chinese: English text must have none.');
  if (!latin && typeof v.zh === 'string' && v.zh.trim() && !han.test(v.zh))
    errors.push(at + '.zh has no Chinese: translate it.');
  return errors;
}
/** What is wrong with a link off the site: its label, and an HTTPS address by safeLink's rules (no mailto). */
function outboundErrors(at: string, v: unknown): string[] {
  if (!object(v))
    return [at + ' must be a link with a label and an HTTPS url.'];
  const errors = [
    ...unknownKeys(at, v, ['label', 'url']),
    ...textErrors(at + '.label', v.label),
  ];
  if (
    !(
      typeof v.url === 'string' &&
      v.url.startsWith('https://') &&
      safeLink(v.url)
    )
  )
    errors.push(at + '.url must be an HTTPS address.');
  return errors;
}
/**
 * What is wrong with the neighbours, field by field. A neighbour is not a person, so their id may not
 * be in people too; and a place shows one published neighbour, the one its file is about.
 */
function neighbourErrors(value: Record<string, unknown>): string[] {
  const rows = value.neighbours;
  if (!Array.isArray(rows)) return ['neighbours must be an array.'];
  const errors: string[] = [],
    ids = new Set<string>(),
    shown = new Set<string>(),
    people: unknown[] = Array.isArray(value.people) ? value.people : [];
  for (const [i, row] of rows.entries()) {
    const at = 'neighbours[' + i + ']';
    if (!object(row)) {
      errors.push(at + ' must be an object.');
      continue;
    }
    errors.push(...unknownKeys(at, row, neighbourKeys));
    if (
      typeof row.id !== 'string' ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id) ||
      ids.has(row.id)
    )
      errors.push(at + ': id must be a unique stable slug.');
    else {
      ids.add(row.id);
      if (people.some((p) => object(p) && p.id === row.id))
        errors.push(
          at +
            ': ' +
            row.id +
            ' is in people too. A neighbour is not a member: keep them in neighbours only.',
        );
    }
    // A neighbour's name (title) stays in Latin script in Chinese; the rest is translated.
    for (const field of ['title', 'summary', 'role', 'affiliation'])
      errors.push(
        ...textErrors(at + '.' + field, row[field], field === 'title'),
      );
    if (
      typeof row.visibility !== 'string' ||
      !['draft', 'published'].includes(row.visibility)
    )
      errors.push(at + '.visibility is invalid.');
    if (!Number.isFinite(row.order))
      errors.push(at + '.order must be a number.');
    if (!asset(row.photo))
      errors.push(
        at + '.photo must be null or an image under /people/ or /media/.',
      );
    const place = row.buildingId;
    if (typeof place !== 'string' || !neighbourPlaces.includes(place))
      errors.push(
        at +
          '.buildingId must be the place whose file shows them: ' +
          neighbourPlaces.join(' or ') +
          '.',
      );
    else if (row.visibility === 'published') {
      if (shown.has(place))
        errors.push(
          at +
            ': ' +
            place +
            ' already has a published neighbour; a place’s file shows one.',
        );
      shown.add(place);
    }
    const group = row.group;
    if (!object(group))
      errors.push(
        at +
          '.group must be an object with name, fullName, intro, summary, connection and site.',
      );
    else {
      errors.push(...unknownKeys(at + '.group', group, groupKeys));
      // The group's names stay as it writes them (UIA, Urban Intelligence & Analytics).
      for (const field of [
        'name',
        'fullName',
        'intro',
        'summary',
        'connection',
      ])
        errors.push(
          ...textErrors(
            at + '.group.' + field,
            group[field],
            field === 'name' || field === 'fullName',
          ),
        );
      errors.push(...outboundErrors(at + '.group.site', group.site));
    }
    if (!Array.isArray(row.sections))
      errors.push(at + '.sections must be an array.');
    else
      for (const [j, section] of row.sections.entries()) {
        const where = at + '.sections[' + j + ']';
        if (!object(section))
          errors.push(where + ' must be an object with a heading and a body.');
        else
          errors.push(
            ...unknownKeys(where, section, ['heading', 'body']),
            ...textErrors(where + '.heading', section.heading),
            ...textErrors(where + '.body', section.body),
          );
      }
    if (!Array.isArray(row.links)) errors.push(at + '.links must be an array.');
    else
      for (const [j, link] of row.links.entries())
        errors.push(...outboundErrors(at + '.links[' + j + ']', link));
  }
  return errors;
}
export function validateCatalog(value: unknown): string[] {
  const errors: string[] = [];
  if (!object(value) || value.schemaVersion !== 2)
    return ['schemaVersion must be 2.'];
  // The catalogue holds its schemaVersion and its collections, and nothing else: a collection whose
  // name is misspelt (the US `neighbors`) is refused, not read as a file without it.
  errors.push(
    ...unknownKeys('catalog', value, ['schemaVersion', ...collections]),
  );
  const bound = new Set<string>();
  for (const collection of gateCollections) {
    const rows = value[collection];
    if (!Array.isArray(rows)) {
      errors.push(collection + ' must be an array.');
      continue;
    }
    const ids = new Set<string>();
    for (const [i, row] of rows.entries()) {
      const at = collection + '[' + i + ']';
      if (!object(row)) {
        errors.push(at + ' must be an object.');
        continue;
      }
      if (
        typeof row.id !== 'string' ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id) ||
        ids.has(row.id)
      )
        errors.push(at + ': id must be a unique stable slug.');
      else ids.add(row.id);
      for (const field of ['title', 'summary'])
        if (!localized(row[field]))
          errors.push(
            at +
              '.' +
              field +
              ': supply en and zh (English must contain no Chinese).',
          );
      if (
        typeof row.visibility !== 'string' ||
        !['draft', 'published'].includes(row.visibility)
      )
        errors.push(at + '.visibility is invalid.');
      if (!Number.isFinite(row.order))
        errors.push(at + '.order must be a number.');
      for (const field of ['sections', 'links', 'properties'])
        if (!Array.isArray(row[field]))
          errors.push(at + '.' + field + ' must be an array.');
      if (Array.isArray(row.sections))
        for (const s of row.sections)
          if (!object(s) || !localized(s.heading) || !localized(s.body))
            errors.push(at + ': invalid section.');
      if (Array.isArray(row.links))
        for (const link of row.links)
          if (!object(link) || !localized(link.label) || !safeLink(link.url))
            errors.push(at + ': links must use HTTPS or mailto.');
      const keys = new Set<string>();
      if (Array.isArray(row.properties))
        for (const p of row.properties) {
          if (
            !object(p) ||
            typeof p.key !== 'string' ||
            !/^[a-z][a-z0-9-]*$/.test(p.key) ||
            keys.has(p.key) ||
            !localized(p.label) ||
            !localized(p.value)
          )
            errors.push(at + ': invalid or duplicate property.');
          else keys.add(p.key);
        }
      if (collection === 'people') {
        errors.push(...unknownKeys(at, row, personKeys));
        if (
          !localized(row.role) ||
          !localized(row.affiliation) ||
          !asset(row.photo)
        )
          errors.push(at + ': invalid role, affiliation or photo.');
        // Someone who has left (or is leaving: the date may lie ahead) keeps their home as
        // history and frees it for whoever moves in next.
        const leaving = row.departure !== undefined;
        if (leaving)
          errors.push(...departureErrors(at + '.departure', row.departure));
        if (row.buildingId !== null) {
          if (
            typeof row.buildingId !== 'string' ||
            !(
              homeIds.includes(row.buildingId) ||
              row.buildingId === RESIDENCE_ID
            ) ||
            (!leaving && bound.has(row.buildingId))
          )
            errors.push(
              at +
                ': choose a home no one else lives in, ' +
                RESIDENCE_ID +
                ' (shared) or null.',
            );
          else if (row.buildingId !== RESIDENCE_ID && !leaving)
            bound.add(row.buildingId);
        }
      } else {
        if (
          !Array.isArray(row.people) ||
          row.people.some((p: unknown) => typeof p !== 'string') ||
          new Set(row.people).size !== row.people.length
        )
          errors.push(at + '.people must contain unique person ids.');
        if (collection === 'research') {
          if (
            typeof row.status !== 'string' ||
            !['active', 'completed'].includes(row.status)
          )
            errors.push(at + '.status is invalid.');
          errors.push(
            ...workPlaceErrors(
              at,
              row.buildingId,
              at + '.buildingId is unknown.',
            ),
          );
        } else {
          if (!realDate(row.date))
            errors.push(at + '.date must be a real YYYY-MM-DD date.');
          if (
            collection === 'events' &&
            (typeof row.category !== 'string' ||
              !['group-photo', 'celebration', 'milestone'].includes(
                row.category,
              ) ||
              !asset(row.image))
          )
            errors.push(at + ': invalid category or image.');
          if (collection === 'outputs' || collection === 'notes') {
            if (
              collection === 'outputs' &&
              !['paper', 'dataset', 'software', 'report'].includes(
                row.type as string,
              )
            )
              errors.push(at + ': invalid output type.');
            errors.push(
              ...workPlaceErrors(
                at,
                row.buildingId,
                at + ': unknown buildingId.',
              ),
            );
            if (row.researchId !== null) {
              const project = Array.isArray(value.research)
                ? value.research.find(
                    (r) => object(r) && r.id === row.researchId,
                  )
                : undefined;
              if (
                !object(project) ||
                (row.visibility === 'published' &&
                  project.visibility !== 'published')
              )
                errors.push(at + ': missing or unpublished research project.');
            }
          }
        }
      }
    }
  }
  if (Array.isArray(value.people))
    for (const collection of [
      'research',
      'events',
      'outputs',
      'notes',
    ] as const) {
      if (!Array.isArray(value[collection])) continue;
      for (const row of value[collection])
        if (object(row) && Array.isArray(row.people))
          for (const id of row.people) {
            const person = (value.people as unknown[]).find(
              (p) => object(p) && p.id === id,
            );
            if (
              !object(person) ||
              (row.visibility === 'published' &&
                person.visibility !== 'published')
            )
              errors.push(
                collection +
                  '/' +
                  row.id +
                  ': missing or unpublished person ' +
                  id +
                  '.',
              );
          }
    }
  // The neighbours are checked on their own: never people, so nothing above names them.
  errors.push(...neighbourErrors(value));
  return errors;
}
export function assertCatalog(value: unknown): asserts value is LabCatalog {
  const errors = validateCatalog(value);
  if (errors.length)
    throw new Error('Invalid lab catalog:\n' + errors.join('\n'));
}
export function upsertRecord(
  catalog: LabCatalog,
  collection: Collection,
  record: CatalogRecord,
): LabCatalog {
  const next = structuredClone(catalog),
    rows = next[collection] as CatalogRecord[];
  const index = rows.findIndex((row) => row.id === record.id);
  if (index < 0) rows.push(record);
  else rows[index] = record;
  assertCatalog(next);
  return next;
}
export function removeRecord(
  catalog: LabCatalog,
  collection: Collection,
  id: string,
): LabCatalog {
  const next = structuredClone(catalog),
    rows = next[collection] as CatalogRecord[];
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) throw new Error('Record not found: ' + collection + '/' + id);
  rows.splice(index, 1);
  assertCatalog(next);
  return next;
}

/**
 * Upgrade a file from before a collection existed, before validation; never invent published
 * records. v1 had no outputs, notes or neighbours. The neighbours came later within v2 and only
 * add a list, so a v2 file written before them gains an empty one and schemaVersion stays 2. A
 * file that spells the key otherwise (`neighbors`) gains one too, and validateCatalog refuses its
 * unknown key.
 */
export function migrateCatalog(value: unknown): unknown {
  if (object(value) && value.schemaVersion === 1)
    return {
      ...value,
      schemaVersion: 2,
      outputs: [],
      notes: [],
      neighbours: [],
    };
  if (object(value) && value.schemaVersion === 2 && !('neighbours' in value))
    return { ...value, neighbours: [] };
  return value;
}
