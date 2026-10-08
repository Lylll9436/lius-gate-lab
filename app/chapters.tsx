import { memo } from 'react';
import { ArrowDown, ArrowUpRight, Map } from 'lucide-react';
import type { BuildingId, Locale } from './city-data';
import type { ContentId } from './lab-navigation';
import { LabContent, PeopleCards, PlaceGlyph, glyphFor } from './lab-content';
import { chapterMeta } from './site-chrome';
import type { SkyState } from './city-atmosphere';
import type { SkyMode } from './use-sky';

export const Hero = memo(function Hero({
  locale,
  sky,
  skyMode,
  onExplore,
  onRead,
}: {
  locale: Locale;
  sky: SkyState;
  skyMode: SkyMode;
  onExplore: () => void;
  onRead: () => void;
}) {
  const zh = locale === 'zh';
  return (
    <section className="hero" id="read-overview" data-chapter="overview">
      <div className="hero-copy">
        <span className="eyebrow">
          {zh
            ? '格拉斯哥大学 · 城市智能研究组'
            : 'Urban Intelligence Group · University of Glasgow'}
        </span>
        <h1>
          <span className={zh ? 'hero-title hero-title-zh' : 'hero-title'}>
            {zh ? '刘家门' : 'LIU’S GATE'}
          </span>
        </h1>
        <p className="hero-lede">
          {zh
            ? '城市智能研究组在格拉斯哥大学从事城市分析研究。本站做成了一座小城：每栋建筑对应研究组的一章内容。向下滚动阅读，或直接探索小城。'
            : 'The Urban Intelligence Group works on urban analytics at the University of Glasgow. This site is built as a small city: each building holds one chapter about the group. Scroll to read, or explore the city directly.'}
        </p>
        <div className="hero-actions">
          <button className="button-primary" onClick={onRead}>
            {zh ? '阅读' : 'Read'}
            <ArrowDown size={15} />
          </button>
          <button className="button-ghost" onClick={onExplore}>
            <Map size={15} />
            {zh ? '探索小城' : 'Explore the city'}
          </button>
        </div>
      </div>
      <div className="hero-foot">
        <span className="hero-hint">
          {zh
            ? `现在格拉斯哥 ${sky.clock}${skyMode === 'auto' ? '，小城按当地时间作息' : ''} · 拖动平移 · Ctrl + 滚轮缩放 · 点击建筑`
            : `It is ${sky.clock} in Glasgow${skyMode === 'auto' ? ' and the city keeps local time' : ''} · Drag to pan · Ctrl + scroll to zoom · Click a building`}
        </span>
      </div>
    </section>
  );
});

/** The six chapters. Memoised: hovering a building must not re-render the page's text. */
export const Chapters = memo(function Chapters({
  locale,
  onOpen,
  onVisit,
  onHoverBuilding,
  onExplore,
}: {
  locale: Locale;
  onOpen: (id: ContentId) => void;
  onVisit: (id: BuildingId) => void;
  onHoverBuilding: (id: BuildingId | null) => void;
  onExplore: (id: ContentId) => void;
}) {
  const zh = locale === 'zh';
  return (
    <>
      {chapterMeta.map((chapter, index) => (
        <section
          className="chapter"
          id={`read-${chapter.id}`}
          data-chapter={chapter.id}
          key={chapter.id}
        >
          <div className="panel">
            <header className="chapter-head">
              <div className="chapter-place">
                <span className="chapter-no">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <PlaceGlyph kind={glyphFor(chapter.id)} size={16} />
                <span>{chapter.place[locale]}</span>
              </div>
              <h2 tabIndex={-1}>{chapter.title[locale]}</h2>
            </header>
            <div className="chapter-body">
              {chapter.id === 'people' ? (
                <PeopleCards
                  locale={locale}
                  onOpen={onOpen}
                  onHover={onHoverBuilding}
                  onVisit={onVisit}
                />
              ) : (
                <LabContent
                  reading
                  id={chapter.id}
                  locale={locale}
                  onOpen={onOpen}
                />
              )}
            </div>
            <footer className="chapter-foot">
              <button
                className="link-action"
                onClick={() => onExplore(chapter.id)}
              >
                <Map size={14} />
                {zh ? '在小城里打开' : 'Open in the city'}
                <ArrowUpRight size={13} />
              </button>
            </footer>
          </div>
        </section>
      ))}
    </>
  );
});
