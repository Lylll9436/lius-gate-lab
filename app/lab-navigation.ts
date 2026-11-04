import {
  buildings,
  dwelling,
  residentsOf,
  type BuildingId,
  type Locale,
} from './city-data';
import {
  peopleRecords,
  personContentId,
  getRecord,
  researchRecords,
} from './lab-records';
export type ContentId = string;
export type BrowseMode = 'city' | 'reading';
export const destinations = [
  'town-hall',
  'people',
  'airport',
  'research-studio',
  'city-archive',
  'corner-park',
];
/** The reading page's chapters, in order: the airport's (Departures) comes right after People. */
export const readingChapters = [
  'town-hall',
  'people',
  'airport',
  'research-studio',
  'city-archive',
  'corner-park',
  'lius-gate',
];
export const people = peopleRecords.map((p) => ({
  ...p,
  id: personContentId(p),
  name: p.title,
  category: p.role,
}));
/**
 * The People chapter's name tags over the roofs: one for each building someone lives in (a home
 * has one resident, the Visiting PhD Residence any number, and no tag while no one stays there),
 * naming its residents in the chapter's order: first names in English, full names in Chinese.
 */
export function homeTags(locale: Locale) {
  return [
    ...new Set(
      people
        .map((p) => p.buildingId)
        .filter((id): id is BuildingId => buildings.some((b) => b.id === id)),
    ),
  ].map((building) => ({
    building,
    label: people
      .filter((p) => p.buildingId === building)
      // A tag carries a first name in English; in Chinese the full Chinese name, or, for someone
      // whose name is only written in Latin letters, the first name as in English.
      .map((p) => (locale === 'zh' && /[\u3400-\u9fff]/.test(p.name.zh) ? p.name.zh : p.name.en.split(' ')[0]))
      .join(locale === 'zh' ? '、' : ' · '),
  }));
}
export const isContentId = (id: string): id is ContentId =>
  ['overview', 'people', 'corner-park', ...buildings.map((b) => b.id)].includes(
    id,
  ) ||
  !!getRecord(id) ||
  (id.startsWith('place:') && buildings.some((b) => b.id === id.slice(6)));
export function titleFor(id: ContentId, locale: Locale) {
  return (
    getRecord(id)?.record.title[locale] ??
    buildings.find((b) => b.id === id.replace(/^place:/, ''))?.name[locale] ??
    (
      {
        overview: { en: 'LIU’S GATE', zh: '刘家门' },
        people: { en: 'People', zh: '成员' },
        'corner-park': {
          en: 'Corner park · Life at the Gate',
          zh: '街角公园 · 师门生活',
        },
      } as Record<string, Record<Locale, string>>
    )[id]?.[locale] ??
    (locale === 'zh' ? '内容已归档或移除' : 'Record unavailable')
  );
}
export function buildingForContent(id: ContentId) {
  const entry = getRecord(id),
    target =
      entry && 'buildingId' in entry.record
        ? entry.record.buildingId
        : id.replace(/^place:/, '');
  return buildings.find((b) => b.id === target);
}
export function sceneTarget(id: ContentId): {
  building?: BuildingId;
  district?: 'residential' | 'research' | 'waterfront';
  park?: boolean;
} {
  const building = buildingForContent(id);
  if (building) return { building: building.id };
  const entry = getRecord(id);
  if (id === 'people' || entry?.kind === 'person')
    return { district: 'residential' };
  if (id === 'corner-park' || entry?.kind === 'event') return { park: true };
  if (entry?.kind === 'output') return { building: 'city-archive' };
  if (entry?.kind === 'note') {
    const projectId =
      'researchId' in entry.record ? entry.record.researchId : null;
    const project = researchRecords.find((p) => p.id === projectId);
    return {
      building: (project?.buildingId as BuildingId) || 'research-studio',
    };
  }
  if (entry?.kind === 'research')
    return {
      building:
        'status' in entry.record && entry.record.status === 'completed'
          ? 'city-archive'
          : 'research-studio',
    };
  return {};
}
/**
 * The place a City file is about, as the camera frames it: a building, the terrace ('people',
 * for the People chapter and anyone without a home), the corner park (its events too), or
 * null for the whole island. The file's eyebrow and glyph name it.
 */
export function placeFor(id: ContentId): BuildingId | 'people' | 'corner-park' | null {
  const target = sceneTarget(id);
  return target.building ?? (target.park ? 'corner-park' : target.district ? 'people' : null);
}
/**
 * What a building opens: a member's home its resident's file (or, empty, its own); any other
 * place its own file, the Visiting PhD Residence's listing whoever lives there.
 */
export function contentForBuilding(id: BuildingId) {
  if (!buildings.find((b) => b.id === id)?.variant) return id;
  const resident = residentsOf(id)[0];
  return resident ? personContentId(resident) : 'place:' + id;
}
/** The City tour: every place in the Directory's order, ending in the corner park. */
export const tourStops: ContentId[] = [
  ...buildings.map((b) => contentForBuilding(b.id)),
  'corner-park',
];
/**
 * Fired on window when the app itself has moved to an address (pushState and replaceState
 * fire neither popstate nor hashchange), so what follows the address can read it again.
 */
export const ADDRESS_EVENT = 'gate:address';
export function parseLocation(hash: string): {
  mode: BrowseMode;
  content: ContentId;
} {
  const [prefix, entry] = hash.replace(/^#/, '').split('/');
  if (prefix === 'city' && entry && isContentId(entry))
    return { mode: 'city', content: entry };
  // A reading address to a record since renamed or removed still opens the reading page.
  if (prefix === 'read')
    return {
      mode: 'reading',
      content: entry && isContentId(entry) ? entry : 'overview',
    };
  const legacy: Record<string, ContentId> = {
    about: 'town-hall',
    people: 'people',
    research: 'research-studio',
    publications: 'city-archive',
    'lab-life': 'corner-park',
  };
  if (Object.hasOwn(legacy, prefix))
    return { mode: 'reading', content: legacy[prefix] };
  return { mode: 'city', content: isContentId(prefix) ? prefix : 'overview' };
}
export function chapterFor(id: ContentId) {
  const entry = getRecord(id);
  if (entry?.kind === 'person') return 'people';
  if (entry?.kind === 'event') return 'corner-park';
  if (entry?.kind === 'output') return 'city-archive';
  if (entry?.kind === 'note') return 'research-studio';
  if (entry?.kind === 'research')
    return 'status' in entry.record && entry.record.status === 'completed'
      ? 'city-archive'
      : 'research-studio';
  const place = buildingForContent(id);
  return dwelling(place)
    ? 'people'
    : id === 'overview'
      ? 'town-hall'
      : id.replace(/^place:/, '');
}
/**
 * The reading page's chapter for an address. The hero's overview is a chapter of its own
 * there, not part of About (chapterFor puts it in About for City mode's masthead).
 */
export const readingChapter = (id: ContentId) =>
  id === 'overview' ? 'overview' : chapterFor(id);
/**
 * The reading page's address while `chapter` is under the reading line: the address already
 * shown if it lies in that chapter (a person in People), else the chapter itself.
 */
export const readingContent = (id: ContentId, chapter: ContentId) =>
  readingChapter(id) === chapter ? id : chapter;

/**
 * The buildings a content's camera frames. People: every home with someone in it and the
 * Visiting PhD Residence, lived in or not (the chapter's places).
 */
export function selectionForContent(id: ContentId): BuildingId[] {
  if (id === 'people')
    return [
      ...new Set([
        ...peopleRecords
          .map((p) => p.buildingId)
          .filter((id): id is BuildingId => buildings.some((b) => b.id === id)),
        ...buildings.filter((b) => b.model === 'residence').map((b) => b.id),
      ]),
    ];
  const target = sceneTarget(id);
  return target.building ? [target.building] : [];
}
