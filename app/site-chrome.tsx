import { ArrowUpRight, Map, BookOpen } from 'lucide-react';
import type { Locale } from './city-data';
import type { BrowseMode, ContentId } from './lab-navigation';
import { GateMark } from './lab-content';

export type ChapterMeta = {
  id: ContentId;
  label: { en: string; zh: string };
  title: { en: string; zh: string };
  place: { en: string; zh: string };
};

export const chapterMeta: ChapterMeta[] = [
  {
    id: 'town-hall',
    label: { en: 'About', zh: '关于' },
    title: { en: 'A group, a city.', zh: '一个研究组，一座小城。' },
    place: { en: 'Town Hall · Civic quarter', zh: '市政厅 · 公共文化区' },
  },
  {
    id: 'people',
    label: { en: 'People', zh: '成员' },
    title: { en: 'Who lives here.', zh: '住在这里的人。' },
    place: { en: 'The terraces · Residential gardens', zh: '联排住宅 · 花园住区' },
  },
  {
    id: 'research-studio',
    label: { en: 'Research', zh: '研究' },
    title: { en: 'Work in progress.', zh: '进行中的工作。' },
    place: { en: 'Research Studio · Research campus', zh: '研究工作室 · 研究园区' },
  },
  {
    id: 'city-archive',
    label: { en: 'Publications', zh: '成果' },
    title: { en: 'What the city keeps.', zh: '小城收藏的东西。' },
    place: { en: 'City Archive · Riverside', zh: '城市档案馆 · 滨水区' },
  },
  {
    id: 'corner-park',
    label: { en: 'Life', zh: '生活' },
    title: { en: 'Afternoons by the water.', zh: '水边的午后。' },
    place: { en: 'Corner park · Riverside', zh: '街角公园 · 滨水区' },
  },
  {
    id: 'lius-gate',
    label: { en: 'The name', zh: '名字' },
    title: { en: 'Why a gate.', zh: '为什么是一道门。' },
    place: { en: 'LIU’S GATE · Central square', zh: '刘家门 · 中央广场' },
  },
];

export function Masthead({
  locale,
  mode,
  active,
  onNavigate,
  onToggleMode,
  onToggleLocale,
}: {
  locale: Locale;
  mode: BrowseMode;
  active: ContentId;
  onNavigate: (id: ContentId) => void;
  onToggleMode: () => void;
  onToggleLocale: () => void;
}) {
  const zh = locale === 'zh';
  const explore = mode === 'city';
  return (
    <header className="masthead">
      <a
        className="wordmark"
        href="#read/overview"
        onClick={(e) => {
          e.preventDefault();
          onNavigate('overview');
        }}
      >
        <GateMark size={26} />
        <span className="wordmark-name">{zh ? '刘家门' : 'LIU’S GATE'}</span>
      </a>
      <nav className="masthead-nav" aria-label={zh ? '章节' : 'Chapters'}>
        {chapterMeta.map((chapter) => (
          <a
            key={chapter.id}
            href={`#read/${chapter.id}`}
            aria-current={active === chapter.id ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              onNavigate(chapter.id);
            }}
          >
            {chapter.label[locale]}
          </a>
        ))}
      </nav>
      <div className="masthead-tools">
        <button
          className={`mode-switch ${explore ? 'is-explore' : ''}`}
          onClick={onToggleMode}
          aria-pressed={explore}
        >
          {explore ? <BookOpen size={15} /> : <Map size={15} />}
          <span>
            {explore
              ? zh
                ? '回到阅读'
                : 'Back to reading'
              : zh
                ? '走进小城'
                : 'Walk the city'}
          </span>
        </button>
        <button className="lang-switch" onClick={onToggleLocale}>
          {zh ? 'EN' : '中文'}
        </button>
      </div>
    </header>
  );
}

export function SiteFooter({
  locale,
  onNavigate,
}: {
  locale: Locale;
  onNavigate: (mode: BrowseMode, id: ContentId) => void;
}) {
  const zh = locale === 'zh';
  return (
    <footer className="site-footer">
      <div className="footer-brand">
        <GateMark size={22} />
        <div>
          <strong>{zh ? '刘家门' : 'LIU’S GATE'}</strong>
          <span>
            {zh
              ? '格拉斯哥大学 · 城市智能研究组'
              : 'Urban Intelligence Group · University of Glasgow'}
          </span>
        </div>
      </div>
      <p className="footer-note">
        {zh
          ? '这座小城按格拉斯哥时间作息：天黑了路灯会亮，下雨了海鸥照常飞。'
          : 'The city keeps Glasgow time: the lamps come on at dusk, and the gulls fly whatever the weather.'}
      </p>
      <nav className="footer-links">
        <button className="link-action" onClick={() => onNavigate('city', 'overview')}>
          {zh ? '走进小城' : 'Walk the city'}
          <ArrowUpRight size={13} />
        </button>
        <a href="https://www.gla.ac.uk/" target="_blank" rel="noreferrer">
          {zh ? '格拉斯哥大学' : 'University of Glasgow'}
          <ArrowUpRight size={13} />
        </a>
        <a
          href="https://github.com/Lylll9436/lius-gate-lab"
          target="_blank"
          rel="noreferrer"
        >
          {zh ? '源代码' : 'Source'}
          <ArrowUpRight size={13} />
        </a>
      </nav>
    </footer>
  );
}
