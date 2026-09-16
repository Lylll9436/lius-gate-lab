export type Localized = { en: string; zh: string };
export type Collection = 'people' | 'research' | 'events' | 'outputs' | 'notes';
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
export type PersonRecord = RecordBase & {
  role: Localized;
  affiliation: Localized;
  photo: string | null;
  buildingId: string | null;
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
export type LabCatalog = {
  schemaVersion: 2;
  people: PersonRecord[];
  research: ResearchRecord[];
  events: EventRecord[];
  outputs: OutputRecord[];
  notes: NoteRecord[];
};
export type LabRecord =
  | PersonRecord
  | ResearchRecord
  | EventRecord
  | OutputRecord
  | NoteRecord;
export const collections: Collection[] = [
  'people',
  'research',
  'events',
  'outputs',
  'notes',
];
const buildingIds = [
  'lius-gate',
  'town-hall',
  'pengyuan-liu',
  'yunlong-liu',
  'qin-li',
  'research-studio',
  'city-archive',
];
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const localized = (v: unknown) =>
  object(v) &&
  typeof v.en === 'string' &&
  !!v.en.trim() &&
  typeof v.zh === 'string' &&
  !!v.zh.trim() &&
  !/[\u3400-\u9fff]/.test(v.en);
export const safeLink = (v: unknown) =>
  typeof v === 'string' &&
  (/^https:\/\/[^/\s]+(?:[/?#][^\s]*)?$/.test(v) ||
    /^mailto:[^\s@]+@[^\s@]+$/.test(v));
const asset = (v: unknown) =>
  v === null ||
  (typeof v === 'string' &&
    /^\/(?:people|media)\/[a-zA-Z0-9/_-]+\.(?:png|jpg|jpeg|webp)$/.test(v) &&
    !v.includes('..'));
export function validateCatalog(value: unknown): string[] {
  const errors: string[] = [];
  if (!object(value) || value.schemaVersion !== 2)
    return ['schemaVersion must be 2.'];
  const bound = new Set<string>();
  for (const collection of collections) {
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
        if (
          !localized(row.role) ||
          !localized(row.affiliation) ||
          !asset(row.photo)
        )
          errors.push(at + ': invalid role, affiliation or photo.');
        if (row.buildingId !== null) {
          if (
            typeof row.buildingId !== 'string' ||
            !['pengyuan-liu', 'yunlong-liu', 'qin-li'].includes(
              row.buildingId,
            ) ||
            bound.has(row.buildingId)
          )
            errors.push(
              at + ': choose a unique residential buildingId, or null.',
            );
          else bound.add(row.buildingId);
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
          if (
            row.buildingId !== null &&
            (typeof row.buildingId !== 'string' ||
              !buildingIds.includes(row.buildingId))
          )
            errors.push(at + '.buildingId is unknown.');
        } else {
          if (
            typeof row.date !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
            !Number.isFinite(Date.parse(row.date)) ||
            new Date(row.date).toISOString().slice(0, 10) !== row.date
          )
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
            if (
              row.buildingId !== null &&
              (typeof row.buildingId !== 'string' ||
                !buildingIds.includes(row.buildingId))
            )
              errors.push(at + ': unknown buildingId.');
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
  record: LabRecord,
): LabCatalog {
  const next = structuredClone(catalog),
    rows = next[collection] as LabRecord[];
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
    rows = next[collection] as LabRecord[];
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) throw new Error('Record not found: ' + collection + '/' + id);
  rows.splice(index, 1);
  assertCatalog(next);
  return next;
}

/** Upgrade a v1 file before validation; never invent published records. */
export function migrateCatalog(value: unknown): unknown {
  if (object(value) && value.schemaVersion === 1)
    return { ...value, schemaVersion: 2, outputs: [], notes: [] };
  return value;
}
