import { useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { publicAsset } from './public-asset';
import { buildings, type BuildingId, type Locale } from './city-data';
import { personPhotos } from './people-photos';
import { people, titleFor, destinations, type ContentId } from './lab-navigation';
import {
  getRecord,
  outputRecords,
  noteRecords,
  type RecordKind,
  researchRecords,
  eventRecords,
  peopleRecords,
  personContentId,
} from './lab-records';
import type {
  LabRecord,
  PersonRecord,
  ResearchRecord,
  EventRecord,
  OutputRecord,
} from './content-schema';

/* ------------------------------------------------------------------ */
/* Marks and glyphs                                                    */
/* ------------------------------------------------------------------ */

/** The gate, drawn as a single line: two piers and a round arch. */
export function GateMark({
  size = 28,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      className={`gate-mark ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 28V15a11 11 0 0 1 22 0v13" />
      <path d="M2.5 28h9M20.5 28h9" />
      <path d="M9 28V16a7 7 0 0 1 14 0v12" />
      <path d="M4 7.5h24" />
    </svg>
  );
}

export type GlyphKind =
  | 'gate'
  | 'hall'
  | 'house'
  | 'studio'
  | 'archive'
  | 'park'
  | 'people';

export function glyphFor(id: ContentId): GlyphKind {
  if (id === 'lius-gate' || id === 'overview') return 'gate';
  if (id === 'town-hall') return 'hall';
  if (id === 'research-studio') return 'studio';
  if (id === 'city-archive') return 'archive';
  if (id === 'corner-park') return 'park';
  if (id === 'people') return 'people';
  return 'house';
}

/** Small line glyphs for places; one stroke weight, one grid. */
export function PlaceGlyph({
  kind,
  size = 20,
}: {
  /** A glyph name, or any content id (resolved through glyphFor). */
  kind: string;
  size?: number;
}) {
  const k = (
    ['gate', 'hall', 'house', 'studio', 'archive', 'park', 'people'].includes(
      kind,
    )
      ? kind
      : glyphFor(kind)
  ) as GlyphKind;
  const paths: Record<GlyphKind, string> = {
    gate: 'M4 20V10a8 8 0 0 1 16 0v10M2 20h20M8 20v-9a4 4 0 0 1 8 0v9',
    hall: 'M3 21h18M5 21V10h14v11M12 10V4l3 2M9 14h2v7M13 14h2v7M8 7h8',
    house: 'M3 11l9-7 9 7M5 9.5V21h14V9.5M10 21v-6h4v6M14 5V3h2v4',
    studio: 'M3 21h18M4 21V8h9v13M13 21V12h7v9M7 11h3M7 15h3M16 15h2',
    archive: 'M3 21h18M4 21V9l4-3 4 3 4-3 4 3v12M7 13h2M11 13h2M15 13h2M9 21v-5h6v5',
    park: 'M3 21h18M8 21v-4M8 17c-3 0-4-2-4-4 0-3 2-5 4-6 2 1 4 3 4 6 0 2-1 4-4 4M16 21v-3M16 18c-2 0-3-1.5-3-3 0-2 1.5-4 3-5 1.5 1 3 3 3 5 0 1.5-1 3-3 3',
    people:
      'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M16 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M2 20c0-3 2.5-5 6-5s6 2 6 5M14 20c0-2.5 1.5-4 4-4s4 1.5 4 4',
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="place-glyph"
    >
      <path d={paths[k]} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Portraits                                                           */
/* ------------------------------------------------------------------ */

export function houseFor(id: ContentId) {
  const entry = getRecord(id);
  const buildingId =
    entry?.kind === 'person'
      ? (entry.record as PersonRecord).buildingId
      : id.replace(/^place:/, '');
  return buildings.find((b) => b.id === buildingId);
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

/** A photo when there is one; otherwise a monogram in the colour of their house. */
export function Portrait({
  id,
  locale,
  size = 'medium',
}: {
  id: ContentId;
  locale: Locale;
  size?: 'small' | 'medium' | 'large';
}) {
  const entry = getRecord(id);
  const src =
    entry?.kind === 'person'
      ? (entry.record as PersonRecord).photo
      : (personPhotos[id] ?? null);
  const name = titleFor(id, locale);
  const house = houseFor(id);
  return (
    <PortraitImage
      key={`${id}-${src}`}
      src={src}
      name={name}
      locale={locale}
      tint={house?.color ?? '#9aa58f'}
      size={size}
    />
  );
}

function PortraitImage({
  src,
  name,
  locale,
  tint,
  size,
}: {
  src: string | null;
  name: string;
  locale: Locale;
  tint: string;
  size: 'small' | 'medium' | 'large';
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={`portrait portrait-${size}`}
      style={{ '--tint': tint } as CSSProperties}
    >
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- Pages has no image server.
        <img
          src={publicAsset(src)}
          alt={locale === 'zh' ? `${name} 的照片` : `Portrait of ${name}`}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="monogram" aria-hidden="true">
          {initials(name)}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

const typeLabel = (type: OutputRecord['type'], zh: boolean) =>
  zh
    ? { paper: '论文', dataset: '数据集', software: '软件', report: '报告' }[type]
    : { paper: 'Paper', dataset: 'Dataset', software: 'Software', report: 'Report' }[
        type
      ];

function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'active' | 'done';
}) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function RecordView({
  id,
  entry,
  locale,
  onOpen,
}: {
  id: string;
  entry: { kind: RecordKind; record: LabRecord };
  locale: Locale;
  onOpen: (id: ContentId) => void;
}) {
  const { record, kind } = entry,
    zh = locale === 'zh';
  const person = kind === 'person' ? (record as PersonRecord) : null;
  const research = kind === 'research' ? (record as ResearchRecord) : null;
  const event = kind === 'event' ? (record as EventRecord) : null;
  const output = kind === 'output' ? (record as OutputRecord) : null;
  const home = person?.buildingId
    ? buildings.find((b) => b.id === person.buildingId)
    : undefined;
  const contributions = person
    ? researchRecords.filter((r) => r.people.includes(person.id))
    : [];
  return (
    <div className={`record ${person ? 'record-person' : ''}`}>
      {person ? (
        <div className="identity">
          <Portrait id={id} locale={locale} size="large" />
          <div>
            <span className="eyebrow">{person.role[locale]}</span>
            <p className="record-lead">{record.summary[locale]}</p>
            <span className="institution">{person.affiliation[locale]}</span>
          </div>
        </div>
      ) : (
        <p className="record-lead">{record.summary[locale]}</p>
      )}
      <div className="record-meta">
        {research && (
          <Pill tone={research.status === 'completed' ? 'done' : 'active'}>
            {research.status === 'completed'
              ? zh
                ? '已完成'
                : 'Completed'
              : zh
                ? '进行中'
                : 'In progress'}
          </Pill>
        )}
        {output && <Pill>{typeLabel(output.type, zh)}</Pill>}
        {'date' in record && (
          <time className="record-date" dateTime={record.date}>
            {record.date}
          </time>
        )}
        {'researchId' in record && record.researchId && (
          <button
            className="link-action"
            onClick={() => onOpen('research:' + record.researchId)}
          >
            {zh ? '相关研究项目' : 'Related project'}
            <ArrowUpRight size={14} />
          </button>
        )}
      </div>
      {event?.image && (
        // eslint-disable-next-line @next/next/no-img-element -- Pages has no image server.
        <img
          className="record-image"
          src={publicAsset(event.image)}
          alt={event.title[locale]}
          loading="lazy"
          decoding="async"
        />
      )}
      {record.sections.map((s, i) => (
        <section className="record-section" key={i}>
          <h4>{s.heading[locale]}</h4>
          <p>{s.body[locale]}</p>
        </section>
      ))}
      {!!record.properties.length && (
        <dl className="record-props">
          {record.properties.map((p) => (
            <div key={p.key}>
              <dt>{p.label[locale]}</dt>
              <dd>{p.value[locale]}</dd>
            </div>
          ))}
        </dl>
      )}
      {!!record.links.length && (
        <div className="record-links">
          {record.links.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
              {link.label[locale]}
              <ArrowUpRight size={14} />
            </a>
          ))}
        </div>
      )}
      {'people' in record && !!record.people.length && (
        <div className="record-related">
          <span className="eyebrow">{zh ? '相关成员' : 'People'}</span>
          <div>
            {record.people.map((key) => {
              const p = peopleRecords.find((p) => p.id === key);
              return p ? (
                <button key={key} onClick={() => onOpen(personContentId(p))}>
                  {p.title[locale]}
                  <ArrowUpRight size={13} />
                </button>
              ) : null;
            })}
          </div>
        </div>
      )}
      {person && !!contributions.length && (
        <div className="record-related">
          <span className="eyebrow">{zh ? '相关研究' : 'Research'}</span>
          <div>
            {contributions.map((r) => (
              <button key={r.id} onClick={() => onOpen('research:' + r.id)}>
                {r.title[locale]}
                <ArrowUpRight size={13} />
              </button>
            ))}
          </div>
        </div>
      )}
      {home && <ArchitectureNote locale={locale} building={home} />}
    </div>
  );
}

function ArchitectureNote({
  locale,
  building,
}: {
  locale: Locale;
  building: (typeof buildings)[number];
}) {
  return (
    <details className="architecture-note">
      <summary>
        <PlaceGlyph kind={glyphFor(building.id)} size={16} />
        {locale === 'zh' ? '这栋建筑' : 'About this building'}
        <em>{building.style[locale]}</em>
      </summary>
      <p>{building.architecture[locale]}</p>
    </details>
  );
}

function CatalogList({
  kind,
  records,
  locale,
  onOpen,
  reading,
}: {
  kind: Exclude<RecordKind, 'person'>;
  records: LabRecord[];
  reading: boolean;
  locale: Locale;
  onOpen: (id: ContentId) => void;
}) {
  return (
    <div className={`catalog catalog-${kind}`}>
      {records.map((record) => {
        const id = kind + ':' + record.id;
        return (
          <article
            className="catalog-entry"
            id={reading ? 'read-' + id : undefined}
            key={id}
          >
            <h3 tabIndex={-1}>{record.title[locale]}</h3>
            <RecordView
              id={id}
              entry={{ kind, record }}
              locale={locale}
              onOpen={onOpen}
            />
            <button className="link-action" onClick={() => onOpen(id)}>
              {locale === 'zh' ? '打开此记录' : 'Open this record'}
              <ArrowUpRight size={14} />
            </button>
          </article>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

export function PersonCard({
  id,
  locale,
  onOpen,
  onHover,
  onVisit,
  index,
}: {
  id: ContentId;
  locale: Locale;
  index: number;
  onOpen: (id: ContentId) => void;
  onHover?: (building: BuildingId | null) => void;
  onVisit?: (building: BuildingId) => void;
}) {
  const person = people.find((p) => p.id === id);
  if (!person) return null;
  const zh = locale === 'zh',
    home = person.buildingId
      ? buildings.find((b) => b.id === person.buildingId)
      : undefined;
  return (
    <div
      className="person-card"
      id={`read-${id}`}
      onMouseEnter={() => onHover?.(home?.id ?? null)}
      onMouseLeave={() => onHover?.(null)}
    >
      <Portrait id={id} locale={locale} size="medium" />
      <div className="person-body">
        <span className="eyebrow">
          {String(index + 1).padStart(2, '0')} · {person.category[locale]}
        </span>
        <h3 tabIndex={-1}>{person.name[locale]}</h3>
        <p>{person.summary[locale]}</p>
        <span className="institution">{person.affiliation?.[locale]}</span>
        {!!person.links.length && (
          <div className="record-links compact">
            {person.links.map((link) => (
              <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                {link.label[locale]}
                <ArrowUpRight size={13} />
              </a>
            ))}
          </div>
        )}
        <div className="person-actions">
          <button className="link-action" onClick={() => onOpen(id)}>
            {zh ? '个人资料' : 'Profile'}
            <ArrowUpRight size={14} />
          </button>
          {home && onVisit && (
            <button className="link-action quiet" onClick={() => onVisit(home.id)}>
              <PlaceGlyph kind="house" size={15} />
              {zh ? `住所 · ${home.style.zh}` : `Home · ${home.style.en}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function PeopleCards({
  locale,
  onOpen,
  onHover,
  onVisit,
}: {
  locale: Locale;
  onOpen: (id: ContentId) => void;
  onHover?: (building: BuildingId | null) => void;
  onVisit?: (building: BuildingId) => void;
}) {
  return (
    <div className="people-cards">
      {people.map((person, i) => (
        <PersonCard
          key={person.id}
          id={person.id}
          index={i}
          locale={locale}
          onOpen={onOpen}
          onHover={onHover}
          onVisit={onVisit}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared content for the dossier and the reading chapters             */
/* ------------------------------------------------------------------ */

export function LabContent({
  id,
  locale,
  onOpen,
  reading = false,
}: {
  id: ContentId;
  locale: Locale;
  onOpen: (id: ContentId) => void;
  reading?: boolean;
}) {
  const zh = locale === 'zh',
    tr = (en: string, cn: string) => (zh ? cn : en);
  const entry = getRecord(id);
  if (entry)
    return <RecordView id={id} entry={entry} locale={locale} onOpen={onOpen} />;
  if (id === 'overview')
    return (
      <div className="welcome">
        <p className="record-lead">
          {tr(
            'Urban Intelligence Group, University of Glasgow. The site is organised as a small city; choose a building to read that part of the group’s record.',
            '格拉斯哥大学城市智能研究组。本站按一座小城组织，选择一栋建筑阅读对应内容。',
          )}
        </p>
        <div className="address-list">
          {destinations.map((key) => (
            <button key={key} onClick={() => onOpen(key)}>
              <PlaceGlyph kind={glyphFor(key)} size={18} />
              <span>{titleFor(key, locale)}</span>
              <ArrowUpRight size={15} />
            </button>
          ))}
        </div>
      </div>
    );
  if (id === 'people')
    return <PeopleCards locale={locale} onOpen={onOpen} />;
  if (id === 'corner-park')
    return (
      <div className="park">
        <p className="record-lead">
          {tr(
            'Group photos, events and announcements are kept in the corner park.',
            '研究组的合影、活动与公告保存在街角公园。',
          )}
        </p>
        {eventRecords.length ? (
          <CatalogList
            kind="event"
            reading={reading}
            records={eventRecords}
            locale={locale}
            onOpen={onOpen}
          />
        ) : (
          <ul className="empty-shelves">
            {[
              tr('Group photos', '合影'),
              tr('Events', '活动'),
              tr('Announcements', '公告'),
            ].map((label) => (
              <li key={label}>
                <span>{label}</span>
                <small>{tr('No records yet', '暂无记录')}</small>
              </li>
            ))}
          </ul>
        )}
        <button className="link-action" onClick={() => onOpen('lius-gate')}>
          {tr('About the name', '关于名字')}
          <ArrowUpRight size={14} />
        </button>
      </div>
    );
  const records =
    id === 'research-studio'
      ? researchRecords.filter((r) => r.status === 'active')
      : id === 'city-archive'
        ? researchRecords.filter((r) => r.status === 'completed')
        : [];
  const additional =
    id === 'city-archive'
      ? outputRecords
      : id === 'research-studio'
        ? noteRecords
        : [];
  const b = buildings.find((b) => b.id === id.replace(/^place:/, ''));
  if (!b)
    return (
      <p>{tr('This record is no longer available.', '这条记录已移除。')}</p>
    );
  const person = people.some((p) => p.id === id);
  return (
    <div className={`record ${person ? 'record-person' : ''}`}>
      {person ? (
        <div className="identity">
          <Portrait id={b.id} locale={locale} size="large" />
          <div>
            <span className="eyebrow">{b.category[locale]}</span>
            <p className="record-lead">{b.summary[locale]}</p>
            <span className="institution">
              {tr('University of Glasgow', '格拉斯哥大学')}
            </span>
          </div>
        </div>
      ) : (
        <p className="record-lead">{b.summary[locale]}</p>
      )}
      {!!records.length && (
        <CatalogList
          kind="research"
          reading={reading}
          records={records}
          locale={locale}
          onOpen={onOpen}
        />
      )}
      {!!additional.length && (
        <CatalogList
          kind={id === 'city-archive' ? 'output' : 'note'}
          reading={reading}
          records={additional}
          locale={locale}
          onOpen={onOpen}
        />
      )}
      {(!records.length && !additional.length ? b.sections : []).map(
        (section, i) => (
          <section className="record-section" key={i}>
            <h4>{section.heading[locale]}</h4>
            <p>{section.body[locale]}</p>
          </section>
        ),
      )}
      <ArchitectureNote locale={locale} building={b} />
      <div className="record-related">
        <span className="eyebrow">{tr('Continue exploring', '继续探索')}</span>
        <div>
          {b.related.map((key) => (
            <button key={key} onClick={() => onOpen(key)}>
              <PlaceGlyph kind={glyphFor(key)} size={15} />
              {titleFor(key, locale)}
              <ArrowUpRight size={13} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
