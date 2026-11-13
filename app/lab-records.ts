import raw from '../content/lab.json' with { type: 'json' };
import {
  assertCatalog,
  migrateCatalog,
  RESIDENCE_ID,
  type Departure,
  type EventRecord,
  type LabCatalog,
  type LabRecord,
  type Localized,
  type NeighbourRecord,
  type NoteRecord,
  type OutputRecord,
  type PersonRecord,
} from './content-schema';
// Type-only, so it is erased and adds no import cycle at run time (city-data imports this module).
import type { BuildingId } from './city-data';
const loaded = migrateCatalog(raw);
assertCatalog(loaded);
export const catalog: LabCatalog = loaded;
/**
 * Everyone published, those who have left included: their addresses, the events that name them
 * and the supervisor's email go on working. Who is still here is memberRecords.
 */
export const peopleRecords = catalog.people
  .filter((p) => p.visibility === 'published')
  .sort((a, b) => a.order - b.order);
/**
 * The UTC day of `today`, YYYY-MM-DD: the day the site goes by, the same for every visitor
 * whatever their time zone. Gate's News counts its year from it, and people leave on it.
 */
export const utcDay = (today: Date = new Date()) =>
  today.toISOString().slice(0, 10);
/**
 * The moment the page was loaded: the day it goes by for who is still here. The People chapter,
 * the homes and their name tags, what a home opens, the People framing and the tour are all
 * decided by it, those read once and those read on each render or click alike, so they agree
 * until the visitor reloads, even if the page stays open past midnight UTC on someone's
 * departure day. The checks pass fixed days instead.
 */
export const pageDay = new Date();
export type Alumnus = PersonRecord & { departure: Departure };
/**
 * Whether someone has left Liu’s Gate by `today` (the page's day unless given; the checks pass
 * fixed days). A departure may be entered ahead: they leave on its date, from 00:00 UTC.
 */
export function hasDeparted(
  p: PersonRecord,
  today: Date = pageDay,
): p is Alumnus {
  return !!p.departure && p.departure.date <= utcDay(today);
}
/**
 * The members on `today` (the page's day unless given): everyone published who has not left, in
 * their order. They make up the People chapter, the homes, the name tags and the residence's
 * residents.
 */
export function memberRecords(today: Date = pageDay) {
  return peopleRecords.filter((p) => !hasDeparted(p, today));
}
/**
 * Everyone who has left by `today` (the page's day unless given), newest departure first: the
 * departures board.
 */
export function alumniRecords(today: Date = pageDay) {
  return peopleRecords
    .filter((p): p is Alumnus => hasDeparted(p, today))
    .sort(
      (a, b) =>
        b.departure.date.localeCompare(a.departure.date) || a.order - b.order,
    );
}
export type DepartureStatus = 'departed' | 'returned';
/** A visiting researcher who stayed in the residence has gone home; anyone else has set off. */
export const departureStatus = (p: PersonRecord): DepartureStatus =>
  p.buildingId === RESIDENCE_ID ? 'returned' : 'departed';
export const departureStatusLabel: Record<DepartureStatus, Localized> = {
  departed: { en: 'Departed', zh: '已启程' },
  returned: { en: 'Returned', zh: '已返程' },
};
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
/**
 * The neighbours published, in their order: researchers beside the town who are not part of Liu’s
 * Gate, with their groups (Alison Heppenstall and UIA, whose place is the sky island). They are not
 * people: nothing that lists people, members, leavers, residents, homes, People cards, departures
 * or an event's People reads them, nor the supervisor's email, and no address opens one (getRecord
 * does not know them). Their place's file is to show them (neighbourFor), but nothing on the site
 * reads them yet: the sky island's file and the reading page's Neighbours card come later (P2).
 */
export const neighbourRecords: NeighbourRecord[] = catalog.neighbours
  .filter((n) => n.visibility === 'published')
  .sort((a, b) => a.order - b.order);
/**
 * The published neighbour a place's file is to show, or undefined: the sky island's is Alison
 * Heppenstall. A place has at most one (content-schema checks it).
 */
export function neighbourFor(placeId: BuildingId): NeighbourRecord | undefined {
  return neighbourRecords.find((n) => n.buildingId === placeId);
}
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
  const since = utcDay(yearAgo);
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
/**
 * The record an address names: a person, a research project, an event, an output or a note.
 * Neighbours have no address of their own (neighbourRecords): their place's file is to show them.
 */
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
