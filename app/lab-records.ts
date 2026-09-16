import raw from '../content/lab.json' with { type: 'json' };
import {
  assertCatalog,
  migrateCatalog,
  type LabCatalog,
  type LabRecord,
  type PersonRecord,
} from './content-schema';
const loaded = migrateCatalog(raw);
assertCatalog(loaded);
export const catalog: LabCatalog = loaded;
export const peopleRecords = catalog.people
  .filter((p) => p.visibility === 'published')
  .sort((a, b) => a.order - b.order);
export const researchRecords = catalog.research
  .filter((p) => p.visibility === 'published')
  .sort((a, b) => a.order - b.order);
export const eventRecords = catalog.events
  .filter((p) => p.visibility === 'published')
  .sort((a, b) => b.date.localeCompare(a.date) || a.order - b.order);
export const outputRecords = catalog.outputs
  .filter((p) => p.visibility === 'published')
  .sort((a, b) => b.date.localeCompare(a.date) || a.order - b.order);
export const noteRecords = catalog.notes
  .filter((p) => p.visibility === 'published')
  .sort((a, b) => b.date.localeCompare(a.date) || a.order - b.order);
export type RecordKind = 'person' | 'research' | 'event' | 'output' | 'note';
export function personContentId(p: PersonRecord): string {
  return ['pengyuan-liu', 'yunlong-liu', 'qin-li'].includes(p.id)
    ? p.id
    : 'person:' + p.id;
}
export function getRecord(
  id: string,
): { kind: RecordKind; record: LabRecord } | undefined {
  const person = peopleRecords.find((p) => personContentId(p) === id);
  if (person) return { kind: 'person', record: person };
  const research = researchRecords.find((p) => 'research:' + p.id === id);
  if (research) return { kind: 'research', record: research };
  const event = eventRecords.find((p) => 'event:' + p.id === id);
  const output = outputRecords.find((r) => 'output:' + r.id === id);
  if (output) return { kind: 'output', record: output };
  const note = noteRecords.find((r) => 'note:' + r.id === id);
  if (note) return { kind: 'note', record: note };
  return event ? { kind: 'event', record: event } : undefined;
}
