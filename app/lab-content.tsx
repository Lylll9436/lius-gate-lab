'use client';
import { publicAsset } from './public-asset';
import { useState } from 'react';
import Image from 'next/image';
import { ArrowUpRight, UserRound } from 'lucide-react';
import { buildings, type Locale } from './city-data';
import { personPhotos } from './people-photos';

import {
  people,
  titleFor,
  destinations,
  type ContentId,
} from './lab-navigation';
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
} from './content-schema';

export function BrandLogo({ size = 64 }: { size?: number }) {
  return (
    <Image
      className="brand-logo"
      src={publicAsset('/brand/lius-gate-flat-v2.png')}
      alt="LIU’S GATE logo"
      width={size}
      height={size}
      unoptimized
    />
  );
}

export function IsoIcon({
  kind = 'town-hall',
  size = 44,
}: {
  kind?: ContentId;
  size?: number;
}) {
  const home = people.some((p) => p.id === kind) || kind === 'people',
    park = kind === 'corner-park',
    gate = kind === 'lius-gate' || kind === 'overview';
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      className="iso-icon"
    >
      <path
        d="m4 44 28-16 28 16-28 16L4 44Z"
        fill={park ? '#aac091' : '#d6c7a5'}
      />
      <path d="m4 44 28 16v4L4 48v-4Z" fill="#b5a383" />
      <path d="m60 44-28 16v4l28-16v-4Z" fill="#8d9778" />
      {park ? (
        <>
          <path d="m13 45 37-20 3 3-37 20-3-3Z" fill="#e3d5af" />
          <path d="M24 36v12m16-21v13" stroke="#786044" strokeWidth="3" />
          <path d="m12 31 12-16 12 16-12 7-12-7Z" fill="#718d54" />
          <path d="m30 22 10-14 10 14-10 6-10-6Z" fill="#8ba768" />
          <path d="m37 44 12-7v4l-12 7v-4Z" fill="#966d47" />
        </>
      ) : gate ? (
        <>
          <path
            d="m17 42 7 4V31c0-9 13-9 13 0v8l8-5V13L17 29v13Z"
            fill="#d7bf90"
          />
          <path d="m17 29 28-16-9-5L8 24l9 5Z" fill="#efe0bd" />
          <path d="M8 24v23l9-5V29l-9-5Z" fill="#ad956d" />
          <path d="m17 24 28-16V4L17 20v4Z" fill="#d4bb8d" />
          <path d="m8 15 28-16 9 5-28 16-9-5Z" fill="#eee0c0" />
          <path d="m8 15 9 5v4l-9-5v-4Z" fill="#a8906a" />
        </>
      ) : (
        <>
          <path
            d="m17 46 17 10V26L17 16v30Z"
            fill={home ? '#b17d5d' : '#a7b6aa'}
          />
          <path
            d="m34 56 17-10V16L34 26v30Z"
            fill={home ? '#d9b890' : '#ced3b9'}
          />
          <path
            d={
              home
                ? 'm12 18 22-13 22 13-22 13-22-13Z'
                : 'm15 16 19-11 19 11-19 11-19-11Z'
            }
            fill={home ? '#4d6261' : '#779493'}
          />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <path d={`m21 ${24 + i * 8} 6 3v4l-6-3v-4Z`} fill="#dedbbb" />
              <path d={`m39 ${28 + i * 8} 7-4v4l-7 4v-4Z`} fill="#567d7b" />
            </g>
          ))}
        </>
      )}
    </svg>
  );
}
function PortraitImage({
  src,
  name,
  locale,
}: {
  src: string | null;
  name: string;
  locale: Locale;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="portrait-frame">
      {src && !failed ? (
        <Image
          src={publicAsset(src)}
          alt={locale === 'zh' ? `${name} 的照片` : `Portrait of ${name}`}
          width={400}
          height={500}
          loading="lazy"
          unoptimized
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="portrait-placeholder">
          <UserRound size={38} strokeWidth={1} />
          <span>{locale === 'zh' ? '照片待补充' : 'Portrait to follow'}</span>
        </div>
      )}
    </div>
  );
}
export function Portrait({ id, locale }: { id: ContentId; locale: Locale }) {
  const entry = getRecord(id);
  const src =
    entry?.kind === 'person'
      ? (entry.record as PersonRecord).photo
      : (personPhotos[id] ?? null);
  return (
    <PortraitImage
      key={`${id}-${src}`}
      src={src}
      name={titleFor(id, locale)}
      locale={locale}
    />
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
  const home = person?.buildingId
    ? buildings.find((b) => b.id === person.buildingId)
    : undefined;
  return (
    <div
      className={
        'record-content ' + (person ? 'person-record' : 'catalog-record')
      }
    >
      {person ? (
        <div className="profile-identity">
          <Portrait id={id} locale={locale} />
          <div>
            <span className="overline">{person.role[locale]}</span>
            <p>{record.summary[locale]}</p>
            <span className="institution">{person.affiliation[locale]}</span>
          </div>
        </div>
      ) : (
        <p className="record-lead">{record.summary[locale]}</p>
      )}
      {research && (
        <span className="record-state">
          {research.status === 'completed'
            ? zh
              ? '已完成'
              : 'Completed'
            : zh
              ? '进行中'
              : 'In progress'}
        </span>
      )}
      {'date' in record && (
        <time className="record-state" dateTime={record.date}>
          {record.date}
        </time>
      )}
      {event?.image && (
        <Image
          className="event-image"
          src={publicAsset(event.image)}
          alt={event.title[locale]}
          width={960}
          height={640}
          unoptimized
        />
      )}
      {'researchId' in record && record.researchId && (
        <button
          className="text-action"
          onClick={() => onOpen('research:' + record.researchId)}
        >
          {zh ? '相关研究项目' : 'Related research project'}
          <ArrowUpRight size={15} />
        </button>
      )}
      {'type' in record && (
        <span className="record-state">
          {zh
            ? {
                paper: '论文',
                dataset: '数据集',
                software: '软件',
                report: '报告',
              }[record.type]
            : record.type}
        </span>
      )}
      {record.sections.map((s, i) => (
        <section className="record-section" key={i}>
          <h3>{s.heading[locale]}</h3>
          <p>{s.body[locale]}</p>
        </section>
      ))}
      {!!record.properties.length && (
        <dl className="record-properties">
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
              <ArrowUpRight size={15} />
            </a>
          ))}
        </div>
      )}
      {'people' in record && !!record.people.length && (
        <div className="related-records">
          <span>{zh ? '相关成员' : 'People involved'}</span>
          {record.people.map((key) => {
            const p = peopleRecords.find((p) => p.id === key);
            return p ? (
              <button key={key} onClick={() => onOpen(personContentId(p))}>
                {p.title[locale]}
                <ArrowUpRight size={14} />
              </button>
            ) : null;
          })}
        </div>
      )}
      {person && researchRecords.some((r) => r.people.includes(person.id)) && (
        <div className="related-records">
          <span>{zh ? '相关研究' : 'Research contributions'}</span>
          {researchRecords
            .filter((r) => r.people.includes(person.id))
            .map((r) => (
              <button key={r.id} onClick={() => onOpen('research:' + r.id)}>
                {r.title[locale]}
                <ArrowUpRight size={14} />
              </button>
            ))}
        </div>
      )}
      {home && (
        <details className="architecture-note">
          <summary>{zh ? '这栋建筑的风格' : 'About this building'}</summary>
          <p>
            <strong>{home.style[locale]}</strong>
            <br />
            {home.architecture[locale]}
          </p>
        </details>
      )}
    </div>
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
    <div className="catalog-list">
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
            <button className="text-action" onClick={() => onOpen(id)}>
              {locale === 'zh' ? '打开此记录' : 'Open this record'}
              <ArrowUpRight size={15} />
            </button>
          </article>
        );
      })}
    </div>
  );
}

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
      <div className="welcome-content">
        <div className="welcome-logo">
          <BrandLogo size={124} />
        </div>
        <p className="welcome-lead">
          {tr(
            'Urban Intelligence Group, University of Glasgow.',
            '格拉斯哥大学城市智能研究组。',
          )}
        </p>
        <p>
          {tr(
            'Our first year begins with a small city, named LIU’S GATE by Pengyuan Liu.',
            '我们用一座小城开启研究组的第一年，Pengyuan Liu 为它取名「刘家门」。',
          )}
        </p>
        <div className="welcome-addresses">
          {destinations.map((key) => (
            <button key={key} onClick={() => onOpen(key)}>
              <IsoIcon kind={key} size={41} />
              <span>{titleFor(key, locale)}</span>
              <ArrowUpRight size={16} />
            </button>
          ))}
        </div>
      </div>
    );
  if (id === 'people')
    return (
      <div className="team-register">
        {people.map((person, i) => (
          <article
            className="profile-entry"
            key={person.id}
            id={`profile-${person.id}`}
          >
            <Portrait id={person.id} locale={locale} />
            <div>
              <span className="entry-number">
                0{i + 1} / {person.category[locale]}
              </span>
              <h3>{person.name[locale]}</h3>
              <p>{person.summary[locale]}</p>
              <button className="text-action" onClick={() => onOpen(person.id)}>
                {tr('Open profile', '查看个人资料')}
                <ArrowUpRight size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>
    );
  if (id === 'corner-park')
    return (
      <div className="park-content">
        <div className="park-keepsake">
          <IsoIcon kind="corner-park" size={108} />
          <span>
            {tr('A place for our memories.', '给我们的记忆留一处位置。')}
          </span>
        </div>
        <h3>{tr('The first chapter', '第一章')}</h3>
        <p>
          {tr(
            'The riverside corner park is part of our group’s shared home. Future group photos, celebrations and small surprises will find a place here.',
            '滨水街角公园是我们共同的家的一部分。未来的团队合影、节日庆典与小彩蛋将在这里找到位置。',
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
          <div className="memory-shelves">
            {[
              tr('Group photos', '团队合影'),
              tr('Celebrations', '节日庆典'),
              tr('Small discoveries', '小小彩蛋'),
            ].map((label) => (
              <div key={label}>
                <span>{label}</span>
                <small>{tr('No records yet', '暂无记录')}</small>
              </div>
            ))}
          </div>
        )}
        <button className="text-action" onClick={() => onOpen('lius-gate')}>
          {tr('The story behind our name', '了解「刘家门」的命名故事')}
          <ArrowUpRight size={15} />
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
    <div className={`record-content ${person ? 'person-record' : ''}`}>
      {person ? (
        <div className="profile-identity">
          <Portrait id={b.id} locale={locale} />
          <div>
            <span className="overline">{b.category[locale]}</span>
            <p>{b.summary[locale]}</p>
            <span className="institution">University of Glasgow</span>
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
            <h3>{section.heading[locale]}</h3>
            <p>{section.body[locale]}</p>
          </section>
        ),
      )}
      <details className="architecture-note">
        <summary>{tr('About this building', '这栋建筑的风格')}</summary>
        <p>
          <strong>{b.style[locale]}</strong>
          <br />
          {b.architecture[locale]}
        </p>
      </details>
      <div className="related-records">
        <span>{tr('Continue exploring', '继续探索')}</span>
        {b.related.map((key) => (
          <button key={key} onClick={() => onOpen(key)}>
            <IsoIcon kind={key} size={30} />
            {titleFor(key, locale)}
            <ArrowUpRight size={14} />
          </button>
        ))}
      </div>
    </div>
  );
}
