import raw from '../content/lab.json' with { type: 'json' };
import {
  assertCatalog,
  migrateCatalog,
  type EventRecord,
  type LabCatalog,
  type LabRecord,
  type NoteRecord,
  type OutputRecord,
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
/** The supervisor's address, taken from their catalogue record so it is maintained in one place. */
export function supervisorEmail() {
  const link = peopleRecords
    .find((p) => p.id === 'pengyuan-liu')
    ?.links.find((l) => l.url.startsWith('mailto:'));
  return link ? link.url.slice('mailto:'.length).split('?')[0] : null;
}
/** Join us: an email to the supervisor with the subject line already filled in. */
export function joinUsMailto(zh: boolean) {
  const email = supervisorEmail();
  if (!email) return null;
  const subject = zh ? '博士申请咨询 — 刘家门' : 'PhD enquiry — Liu’s Gate';
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}
export type RecordKind = 'person' | 'research' | 'event' | 'output' | 'note';
export type NewsItem =
  | { id: string; kind: 'event'; record: EventRecord }
  | { id: string; kind: 'output'; record: OutputRecord }
  | { id: string; kind: 'note'; record: NoteRecord };
/**
 * Gate's News: the latest dated records from life at the Gate, outputs and research notes,
 * newest first, from the last 12 months only so the first screen never shows stale news.
 * Nothing extra to maintain: publishing a dated record is the news, and it ages out by itself.
 */
export function recentNews(limit = 3, today: Date = new Date()): NewsItem[] {
  const rank = { output: 0, event: 1, note: 2 };
  const yearAgo = new Date(today.getTime());
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const since = yearAgo.toISOString().slice(0, 10);
  const items: NewsItem[] = [
    ...eventRecords.map((record) => ({
      id: 'event:' + record.id,
      kind: 'event' as const,
      record,
    })),
    ...outputRecords.map((record) => ({
      id: 'output:' + record.id,
      kind: 'output' as const,
      record,
    })),
    ...noteRecords.map((record) => ({
      id: 'note:' + record.id,
      kind: 'note' as const,
      record,
    })),
  ];
  return items
    .filter((item) => item.record.date >= since)
    .sort(
      (a, b) =>
        b.record.date.localeCompare(a.record.date) ||
        rank[a.kind] - rank[b.kind] ||
        a.record.order - b.record.order,
    )
    .slice(0, Math.max(0, limit));
}
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
