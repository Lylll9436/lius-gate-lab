import { buildings, type BuildingId, type Locale } from './city-data';
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
  'research-studio',
  'city-archive',
  'corner-park',
];
export const readingChapters = [
  'town-hall',
  'people',
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
        overview: { en: 'Welcome to LIU’S GATE', zh: '欢迎来到刘家门' },
        people: { en: 'Our people', zh: '研究团队' },
        'corner-park': {
          en: 'Corner park · Group life',
          zh: '街角公园 · 研究组生活',
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
export function contentForBuilding(id: BuildingId) {
  const resident = peopleRecords.find((p) => p.buildingId === id);
  return resident
    ? personContentId(resident)
    : buildings.find((b) => b.id === id)?.variant
      ? 'place:' + id
      : id;
}
export function parseLocation(hash: string): {
  mode: BrowseMode;
  content: ContentId;
} {
  const [prefix, entry] = hash.replace(/^#/, '').split('/');
  if ((prefix === 'city' || prefix === 'read') && entry && isContentId(entry))
    return { mode: prefix === 'city' ? 'city' : 'reading', content: entry };
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
  return place?.variant
    ? 'people'
    : id === 'overview'
      ? 'town-hall'
      : id.replace(/^place:/, '');
}

export function selectionForContent(id: ContentId): BuildingId[] {
  if (id === 'people')
    return [
      ...new Set(
        peopleRecords
          .map((p) => p.buildingId)
          .filter((id): id is BuildingId => buildings.some((b) => b.id === id)),
      ),
    ];
  const target = sceneTarget(id);
  return target.building ? [target.building] : [];
}
