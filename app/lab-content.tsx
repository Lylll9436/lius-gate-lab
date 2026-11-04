import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowUpRight, ChevronDown, PlaneTakeoff } from 'lucide-react';
import { publicAsset } from './public-asset';
import { buildings, type BuildingId, type Locale } from './city-data';
import { personPhotos } from './people-photos';
import {
  people,
  titleFor,
  destinations,
  parseLocation,
  departedOn,
  ADDRESS_EVENT,
  type ContentId,
} from './lab-navigation';
import {
  alumniRecords,
  departureStatus,
  departureStatusLabel,
  getRecord,
  hasDeparted,
  outputRecords,
  noteRecords,
  pageDay,
  type Alumnus,
  type RecordKind,
  researchRecords,
  eventRecords,
  peopleRecords,
  personContentId,
  recentNews,
  supervisorEmail,
  joinUsMailto,
  type NewsItem,
} from './lab-records';
import type {
  Departure,
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
  | 'airport'
  | 'studio'
  | 'archive'
  | 'park'
  | 'people';

export function glyphFor(id: ContentId): GlyphKind {
  if (id === 'lius-gate' || id === 'overview') return 'gate';
  if (id === 'town-hall') return 'hall';
  if (id === 'airport') return 'airport';
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
    ['gate', 'hall', 'house', 'airport', 'studio', 'archive', 'park', 'people'].includes(
      kind,
    )
      ? kind
      : glyphFor(kind)
  ) as GlyphKind;
  // The airport's is a departing plane, the pictogram over every departures hall (at 16 px a hall
  // and its tower read as a dome or a bar chart). A sign on the page only: the model carries none.
  if (k === 'airport')
    return (
      <PlaneTakeoff
        size={size}
        strokeWidth={1.6}
        aria-hidden="true"
        className="place-glyph"
      />
    );
  const paths: Record<Exclude<GlyphKind, 'airport'>, string> = {
    gate: 'M4 20V10a8 8 0 0 1 16 0v10M2 20h20M8 20v-9a4 4 0 0 1 8 0v9',
    hall: 'M3 21h18M5 21V10h14v11M12 10V4l3 2M9 14h2v7M13 14h2v7M8 7h8',
    house: 'M3 11l9-7 9 7M5 9.5V21h14V9.5M10 21v-6h4v6M14 5V3h2v4',
    studio: 'M3 21h18M4 21V8h9v13M13 21V12h7v9M7 11h3M7 15h3M16 15h2',
    archive:
      'M3 21h18M4 21V9l4-3 4 3 4-3 4 3v12M7 13h2M11 13h2M15 13h2M9 21v-5h6v5',
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

/**
 * The place a person or home belongs to, for a portrait's colour and a card's ring: the home or the
 * residence they live in, or for someone who has left the airport (not the home they lived in).
 */
export function houseFor(id: ContentId) {
  const entry = getRecord(id);
  const buildingId = departedOn(id)
    ? 'airport'
    : entry?.kind === 'person'
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
    ? { paper: '论文', dataset: '数据集', software: '软件', report: '报告' }[
        type
      ]
    : {
        paper: 'Paper',
        dataset: 'Dataset',
        software: 'Software',
        report: 'Report',
      }[type];

const categoryLabel = (category: EventRecord['category'], zh: boolean) =>
  zh
    ? { 'group-photo': '合影', celebration: '庆祝', milestone: '里程碑' }[
        category
      ]
    : {
        'group-photo': 'Group photo',
        celebration: 'Celebration',
        milestone: 'Milestone',
      }[category];

/** Dates as people say them: "3 Oct 2026" / "2026年10月3日". Fixed to UTC so every visitor sees the same day. */
function newsDate(date: string, zh: boolean) {
  return new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-GB', {
    day: 'numeric',
    month: zh ? 'long' : 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(date + 'T00:00:00Z'));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/**
 * A departure's month on the board: "Dec 2026" (set in capitals) / "2026年12月". The months are
 * not Intl's: en-GB shortens September to "Sept", and a board's months are three letters.
 */
function boardMonth(date: string, zh: boolean) {
  const [year, month] = date.split('-').map(Number);
  return zh ? `${year}年${month}月` : `${MONTHS[month - 1]} ${year}`;
}
/** A departure's month in words, for a sentence or a file: "December 2026" / "2026年12月". */
function monthInWords(date: string, zh: boolean) {
  return zh
    ? boardMonth(date, true)
    : new Intl.DateTimeFormat('en-GB', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(date + 'T00:00:00Z'));
}
/** Where someone is now: the institution, then their role there if there is one. */
const nowParts = (d: Departure, locale: Locale) =>
  [d.destination[locale], ...(d.role ? [d.role[locale]] : [])];
/**
 * The role someone who has left held here, marked as theirs at Liu’s Gate ("At Liu’s Gate ·
 * Visiting PhD researcher"), so that the Now under it reads as the present. The role is unchanged.
 */
const formerRole = (person: PersonRecord, locale: Locale) =>
  `${locale === 'zh' ? '在刘家门时' : 'At Liu’s Gate'} · ${person.role[locale]}`;

function newsKindLabel(item: NewsItem, zh: boolean) {
  if (item.kind === 'event') return categoryLabel(item.record.category, zh);
  if (item.kind === 'output') return typeLabel(item.record.type, zh);
  return zh ? '研究记录' : 'Research note';
}

/**
 * Gate's News on the first screen: the latest few dated records, each opening in place.
 * With no news from the last year the news part stays hidden and only Join us shows.
 */
export function NewsPreview({
  locale,
  onOpen,
  limit = 3,
}: {
  locale: Locale;
  onOpen: (id: ContentId) => void;
  limit?: number;
}) {
  const zh = locale === 'zh',
    items = recentNews(limit),
    joinEmail = supervisorEmail(),
    joinHref = joinUsMailto(zh);
  if (!items.length && !joinHref) return null;
  const join = joinHref && (
    <footer className="hero-news-join">
      <strong>{zh ? '加入我们！' : 'Join us!'}</strong>
      <a href={joinHref}>{joinEmail}</a>
    </footer>
  );
  if (!items.length)
    return (
      <aside
        className="hero-news is-join-only"
        aria-label={zh ? '加入我们' : 'Join us'}
      >
        {join}
      </aside>
    );
  return (
    <aside className="hero-news" aria-labelledby="hero-news-title">
      <header className="hero-news-head">
        <span className="eyebrow">
          <i aria-hidden="true" />
          {zh ? '近期动态' : 'Latest'}
        </span>
        <h2 id="hero-news-title">{zh ? '刘家门快讯' : 'Gate’s News'}</h2>
      </header>
      <ol className="hero-news-list">
        {items.map((item) => {
          const image = item.kind === 'event' ? item.record.image : null;
          return (
            <li key={item.id}>
              <button
                type="button"
                className={`hero-news-item${image ? ' has-image' : ''}`}
                onClick={() => onOpen(item.id)}
              >
                {image && (
                  // eslint-disable-next-line @next/next/no-img-element -- Pages has no image server.
                  <img
                    src={publicAsset(image)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                )}
                <span className="hero-news-text">
                  <span className="hero-news-meta">
                    <time dateTime={item.record.date}>
                      {newsDate(item.record.date, zh)}
                    </time>
                    <span aria-hidden="true">·</span>
                    <span>{newsKindLabel(item, zh)}</span>
                  </span>
                  <strong>{item.record.title[locale]}</strong>
                  <span className="hero-news-summary">
                    {item.record.summary[locale]}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="link-action hero-news-more"
        onClick={() => onOpen('corner-park')}
      >
        {zh ? '查看师门生活' : 'More from life at the Gate'}
        <ArrowUpRight size={14} />
      </button>
      {join}
    </aside>
  );
}

function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'active' | 'done';
}) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

/** A record's sections and properties: the full profile, in the dossier and on a person's card. */
function ProfileBody({
  record,
  locale,
}: {
  record: LabRecord;
  locale: Locale;
}) {
  return (
    <>
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
    </>
  );
}

/** Email shows its address and stays in this tab; any other link opens a new one. */
function RecordLink({
  link,
  locale,
  iconSize,
}: {
  link: LabRecord['links'][number];
  locale: Locale;
  iconSize: number;
}) {
  if (link.url.startsWith('mailto:')) {
    const address = link.url.slice('mailto:'.length).split('?')[0];
    return (
      <a
        href={link.url}
        aria-label={`${link.label[locale]}${locale === 'zh' ? '：' : ': '}${address}`}
      >
        {address}
      </a>
    );
  }
  return (
    <a href={link.url} target="_blank" rel="noreferrer">
      {link.label[locale]}
      <ArrowUpRight size={iconSize} />
    </a>
  );
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
  // Someone who has left: their file is the airport's. It says where they are now, and its note
  // is about the airport, not the home their record keeps as history.
  const alumnus = person && hasDeparted(person) ? person : null;
  const home = alumnus
    ? buildings.find((b) => b.id === 'airport')
    : person?.buildingId
      ? buildings.find((b) => b.id === person.buildingId)
      : undefined;
  const links = alumnus?.departure.link
    ? [...record.links, alumnus.departure.link]
    : record.links;
  const contributions = person
    ? researchRecords.filter((r) => r.people.includes(person.id))
    : [];
  return (
    <div className={`record ${person ? 'record-person' : ''}`}>
      {person ? (
        <div className="identity">
          <Portrait id={id} locale={locale} size="large" />
          <div>
            <span className="eyebrow">
              {alumnus ? formerRole(alumnus, locale) : person.role[locale]}
            </span>
            <p className="record-lead">{record.summary[locale]}</p>
            <span className="institution">{person.affiliation[locale]}</span>
            {alumnus && (
              <p className="record-now">
                <span className="eyebrow">{zh ? '现任' : 'Now'}</span>
                <span>{nowParts(alumnus.departure, locale).join(' · ')}</span>
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="record-lead">{record.summary[locale]}</p>
      )}
      <div className="record-meta">
        {alumnus && (
          <>
            <Pill>{departureStatusLabel[departureStatus(alumnus)][locale]}</Pill>
            <span className="record-date">
              <time dateTime={alumnus.departure.date}>
                {monthInWords(alumnus.departure.date, zh)}
              </time>
              {' · '}
              {alumnus.departure.city[locale]}
            </span>
            <button className="link-action" onClick={() => onOpen('airport')}>
              {zh ? '出发屏' : 'Departures board'}
              <ArrowUpRight size={14} />
            </button>
          </>
        )}
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
            {newsDate(record.date, zh)}
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
      <ProfileBody record={record} locale={locale} />
      {!!links.length && (
        <div className="record-links">
          {links.map((link, i) => (
            <RecordLink
              key={`${i} ${link.url}`}
              link={link}
              locale={locale}
              iconSize={14}
            />
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
            {/* In the city this opens the record's own file; on the page the
                record is already open where the reader is. */}
            {!reading && (
              <button className="link-action" onClick={() => onOpen(id)}>
                {locale === 'zh' ? '打开此记录' : 'Open this record'}
                <ArrowUpRight size={14} />
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

/**
 * A fold-out on the reading page that opens when an address names its record: on load,
 * Back/Forward, a typed link or an in-app link (which uses pushState and so announces itself
 * with ADDRESS_EVENT). A person's card and a row of the departures board use it.
 */
function useOpenedByAddress(id: ContentId) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const sync = () => {
      const { mode, content } = parseLocation(window.location.hash);
      if (mode === 'reading' && content === id) setOpen(true);
    };
    sync();
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    window.addEventListener(ADDRESS_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
      window.removeEventListener(ADDRESS_EVENT, sync);
    };
  }, [id]);
  return [open, setOpen] as const;
}

export function PersonCard({
  id,
  locale,
  onOpen,
  onHover,
  onVisit,
  index,
  reading = false,
}: {
  id: ContentId;
  locale: Locale;
  index: number;
  onOpen: (id: ContentId) => void;
  onHover?: (building: BuildingId | null) => void;
  onVisit?: (building: BuildingId) => void;
  /** On the reading page the card is the person's anchor and its fold-out is the profile.
   *  In the city (the People file) a Profile button opens the person's own file. */
  reading?: boolean;
}) {
  const person = people.find((p) => p.id === id);
  // An address naming this person opens their profile.
  const [profileOpen, setProfileOpen] = useOpenedByAddress(id);
  if (!person) return null;
  const zh = locale === 'zh',
    home = person.buildingId
      ? buildings.find((b) => b.id === person.buildingId)
      : undefined,
    hasProfile = !!(person.sections.length || person.properties.length),
    visit = home && onVisit;
  return (
    <div
      className="person-card"
      id={reading ? `read-${id}` : undefined}
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
              <RecordLink
                key={link.url}
                link={link}
                locale={locale}
                iconSize={13}
              />
            ))}
          </div>
        )}
        {(!reading || visit) && (
          <div className="person-actions">
            {!reading && (
              <button className="link-action" onClick={() => onOpen(id)}>
                {zh ? '个人资料' : 'Profile'}
                <ArrowUpRight size={14} />
              </button>
            )}
            {visit && (
              <button
                className="link-action quiet"
                onClick={() => onVisit(home.id)}
              >
                <PlaceGlyph kind="house" size={15} />
                {zh ? `住所 · ${home.style.zh}` : `Home · ${home.style.en}`}
              </button>
            )}
          </div>
        )}
      </div>
      {hasProfile && (
        <details
          className="person-profile"
          open={profileOpen}
          onToggle={(e) => setProfileOpen(e.currentTarget.open)}
        >
          <summary>
            {zh ? '完整简介' : 'Full profile'}
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <div className="person-profile-body">
            <ProfileBody record={person} locale={locale} />
          </div>
        </details>
      )}
    </div>
  );
}

export function PeopleCards({
  locale,
  onOpen,
  onHover,
  onVisit,
  reading = false,
}: {
  locale: Locale;
  onOpen: (id: ContentId) => void;
  onHover?: (building: BuildingId | null) => void;
  onVisit?: (building: BuildingId) => void;
  reading?: boolean;
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
          reading={reading}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Departures                                                          */
/* ------------------------------------------------------------------ */

/** The board's one settle-flip runs in this long, the last column included (see globals.css). */
const FLIP_MS = 600;
/** Whether the board has had its one flip on this visit, on the reading page and in the City file. */
const boardFlipped = { reading: false, city: false };

/** Read aloud for a row: who left, how and when, where to, and where they are now. */
function departureSentence(person: Alumnus, locale: Locale) {
  const d = person.departure,
    returned = departureStatus(person) === 'returned';
  if (locale === 'zh')
    return `${person.title.zh}：${boardMonth(d.date, true)}${returned ? '返程，回到' : '启程，前往'}${d.city.zh}。现任：${nowParts(d, 'zh').join('，')}。`;
  return `${person.title.en}: ${returned ? 'returned' : 'departed'} ${monthInWords(d.date, false)} ${returned ? 'to' : 'for'} ${d.city.en}. Now: ${nowParts(d, 'en').join(', ')}.`;
}

/**
 * A field still blank on the board, as an unlit board shows it: a few small tiles, each split
 * across, never one long bar (which reads as a page still loading). Hidden from screen readers:
 * the row's own label says what is still to come.
 */
function BlankFlaps() {
  return (
    <span className="flap-blanks" aria-hidden="true">
      {[0, 1, 2, 3].map((tile) => (
        <span key={tile} className="flap is-blank">
          {'\u00a0'}
        </span>
      ))}
    </span>
  );
}

/** A row's cells in the board's order: date, name, destination, now and status. */
function DepartureCells({
  person,
  locale,
  reading,
}: {
  person: Alumnus;
  locale: Locale;
  reading: boolean;
}) {
  const d = person.departure;
  return (
    <>
      <span className="board-cell board-date">
        <time className="flap" dateTime={d.date}>
          {boardMonth(d.date, locale === 'zh')}
        </time>
      </span>
      {/* The reading page jumps to a person's row and focuses their name, as it does a card's. */}
      {reading ? (
        <h3 className="board-cell board-name" tabIndex={-1}>
          {person.title[locale]}
        </h3>
      ) : (
        <strong className="board-cell board-name">{person.title[locale]}</strong>
      )}
      <span className="board-cell board-destination">
        <span className="flap">{d.city[locale]}</span>
      </span>
      <span className="board-cell board-now">
        {nowParts(d, locale).map((part, i) => (
          <span key={i}>
            {i > 0 && ' '}
            <span className="flap">{part}</span>
          </span>
        ))}
      </span>
      <span className="board-cell board-status">
        <span className="flap">
          {departureStatusLabel[departureStatus(person)][locale]}
        </span>
      </span>
    </>
  );
}

/**
 * A row rings the airport while the pointer is on it, as a person's card rings their home. Not on
 * focus: an address that jumps to a row focuses its name, and the ring would then stay on the
 * airport after the reader had scrolled on to another chapter.
 */
type Ring = {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
};

/** A reading-page row: it folds out the person's portrait, profile and links in place. */
function DepartureRow({
  person,
  locale,
  ring,
}: {
  person: Alumnus;
  locale: Locale;
  ring: Ring;
}) {
  const id = personContentId(person),
    [open, setOpen] = useOpenedByAddress(id),
    links = person.departure.link
      ? [...person.links, person.departure.link]
      : person.links;
  return (
    <details
      className="board-entry"
      id={`read-${id}`}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary
        className="board-row"
        aria-label={departureSentence(person, locale)}
        {...ring}
      >
        <DepartureCells person={person} locale={locale} reading />
        <ChevronDown className="board-mark" size={15} aria-hidden="true" />
      </summary>
      <div className="board-profile">
        <Portrait id={id} locale={locale} size="small" />
        <div className="board-profile-body">
          <span className="eyebrow">{formerRole(person, locale)}</span>
          <p>{person.summary[locale]}</p>
          <ProfileBody record={person} locale={locale} />
          {!!links.length && (
            <div className="record-links compact">
              {links.map((link, i) => (
                <RecordLink
                  key={`${i} ${link.url}`}
                  link={link}
                  locale={locale}
                  iconSize={13}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

/**
 * The departures board: everyone who has left Liu’s Gate by `today` (the page's day unless given),
 * newest first, as a split-flap list. On the reading page each row folds out the person's profile;
 * in the airport's City file a row opens their file, the camera staying on the airport. Pointing at
 * a row rings the airport. While no one has left it shows one row still to be announced, and a
 * note for visitors under it.
 */
export function DeparturesBoard({
  locale,
  onOpen,
  onHover,
  reading = false,
  today = pageDay,
}: {
  locale: Locale;
  onOpen: (id: ContentId) => void;
  onHover?: (building: BuildingId | null) => void;
  reading?: boolean;
  today?: Date;
}) {
  const zh = locale === 'zh',
    rows = alumniRecords(today),
    board = useRef<HTMLDivElement>(null),
    ringed = useRef(false),
    [flipping, setFlipping] = useState(false),
    where = reading ? 'reading' : 'city';
  // One left-to-right settle-flip the first time the board comes into view: never in Chinese, nor
  // for a visitor who prefers reduced motion. Whatever ends the effect (中文 pressed mid-flip, the
  // board going) settles the flip too: a settle timer cancelled with nothing to clear the class left
  // every cell's flip on, replayed each time the board was shown again.
  useEffect(() => {
    const el = board.current;
    if (
      !el ||
      zh ||
      boardFlipped[where] ||
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    let settled = 0;
    const watch = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || boardFlipped[where]) return;
        boardFlipped[where] = true;
        watch.disconnect();
        setFlipping(true);
        settled = window.setTimeout(() => setFlipping(false), FLIP_MS + 60);
      },
      { threshold: 0.35 },
    );
    watch.observe(el);
    return () => {
      watch.disconnect();
      window.clearTimeout(settled);
      setFlipping(false);
    };
  }, [zh, where]);
  // Nothing stays ringed once the board goes: a row's click opens a file, and the board with it.
  useEffect(
    () => () => {
      if (ringed.current) onHover?.(null);
    },
    [onHover],
  );
  const ring: Ring = {
    onPointerEnter: () => {
      ringed.current = true;
      onHover?.('airport');
    },
    onPointerLeave: () => {
      ringed.current = false;
      onHover?.(null);
    },
  };
  const columns = zh
    ? ['日期', '姓名', '目的地', '现任', '状态']
    : ['Date', 'Name', 'Destination', 'Now', 'Status'];
  return (
    <>
      <div
        ref={board}
        className={`departures${zh ? ' is-zh' : ''}${flipping && !zh ? ' is-flipping' : ''}`}
      >
        <div className="board-head" aria-hidden="true">
          {['date', 'name', 'destination', 'now', 'status'].map((column, i) => (
            <span key={column} className={`board-${column}`}>
              {columns[i]}
            </span>
          ))}
        </div>
        <ol className="board-rows" aria-label={zh ? '出发' : 'Departures'}>
          {rows.length ? (
            rows.map((person) => (
              <li key={person.id}>
                {reading ? (
                  <DepartureRow person={person} locale={locale} ring={ring} />
                ) : (
                  <button
                    className="board-row"
                    aria-label={departureSentence(person, locale)}
                    onClick={() => {
                      ringed.current = false;
                      onHover?.(null);
                      onOpen(personContentId(person));
                    }}
                    {...ring}
                  >
                    <DepartureCells person={person} locale={locale} reading={false} />
                    <ArrowUpRight className="board-mark" size={14} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))
          ) : (
            // The first departure is still to come, to be announced: blank tiles for its date, where
            // they are now and its status (a status that said so again only repeated the destination).
            <li
              className="board-row is-tba"
              aria-label={zh ? '首个航班：待定。' : 'First departure: to be announced.'}
            >
              <span className="board-cell board-date">
                <BlankFlaps />
              </span>
              <span className="board-cell board-name">
                {zh ? '首个航班' : 'First departure'}
              </span>
              <span className="board-cell board-destination">
                <span className="flap">{zh ? '待定' : 'To be announced'}</span>
              </span>
              <span className="board-cell board-now">
                <BlankFlaps />
              </span>
              <span className="board-cell board-status">
                <BlankFlaps />
              </span>
            </li>
          )}
        </ol>
      </div>
      {!rows.length && (
        <section className="record-section board-note">
          <h4>{zh ? '首批启程' : 'First departures'}</h4>
          <p>
            {zh
              ? '刘家门的成员都还在这里。等有人完成博士学业奔赴下一站，或访问学者回到自己的学校，这块屏会显示每个人去了哪里、何时启程。'
              : 'Everyone at Liu’s Gate is still here. When members finish their PhDs and move on, or visiting researchers head home, this board will show where each of them went and when they set off.'}
          </p>
        </section>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Shared content for the dossier and the reading chapters             */
/* ------------------------------------------------------------------ */

export function LabContent({
  id,
  locale,
  onOpen,
  onHover,
  reading = false,
}: {
  id: ContentId;
  locale: Locale;
  onOpen: (id: ContentId) => void;
  /** Ring a place on the model while something in the content points at it (the board's rows). */
  onHover?: (building: BuildingId | null) => void;
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
            'Liu’s Gate, University of Glasgow. The site is organised as a small city; choose a building to read that chapter.',
            '格拉斯哥大学刘家门。本站按一座小城组织，选择一栋建筑阅读对应内容。',
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
  if (id === 'people') return <PeopleCards locale={locale} onOpen={onOpen} />;
  if (id === 'corner-park')
    return (
      <div className="park">
        <p className="record-lead">
          {tr(
            'Photos, outings and announcements from Liu’s Gate are kept in the corner park.',
            '刘家门的合影、活动与公告保存在街角公园。',
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
          {tr('About this site', '关于本站')}
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
  const person = people.some((p) => p.id === id),
    // The Visiting PhD Residence lists its residents; with none, it says who it is for.
    residents =
      b.model === 'residence'
        ? people.filter((p) => p.buildingId === b.id)
        : [];
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
      {/* The airport's file and chapter: the departures board. */}
      {b.model === 'airport' && (
        <DeparturesBoard
          locale={locale}
          onOpen={onOpen}
          onHover={onHover}
          reading={reading}
        />
      )}
      {/* The residence's file: whoever stays there, each on their card. */}
      {!!residents.length && (
        <div className="people-cards">
          {residents.map((resident) => (
            <PersonCard
              key={resident.id}
              id={resident.id}
              index={people.indexOf(resident)}
              locale={locale}
              onOpen={onOpen}
              reading={reading}
            />
          ))}
        </div>
      )}
      {(!records.length && !additional.length && !residents.length
        ? b.sections
        : []
      ).map(
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
