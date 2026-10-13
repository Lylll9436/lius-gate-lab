import { memo, useSyncExternalStore } from 'react';
import { ArrowDown, ArrowUpRight, Map } from 'lucide-react';
import type { BuildingId, Locale } from './city-data';
import type { ContentId } from './lab-navigation';
import {
  LabContent,
  NewsPreview,
  PeopleCards,
  PlaceGlyph,
  glyphFor,
} from './lab-content';
import { chapterMeta } from './site-chrome';
import type { SkyState } from './glasgow-sun';
import type { SkyMode } from './use-sky';

const COARSE_POINTER = '(pointer: coarse)';
function watchPointer(onChange: () => void) {
  const media = window.matchMedia(COARSE_POINTER);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
/** A finger rather than a mouse: the hint names the gestures a phone or tablet has. */
function useCoarsePointer() {
  return useSyncExternalStore(
    watchPointer,
    () => window.matchMedia(COARSE_POINTER).matches,
    () => false,
  );
}

export const Hero = memo(function Hero({
  locale,
  sky,
  skyMode,
  onExplore,
  onRead,
  onOpen,
}: {
  locale: Locale;
  sky: SkyState;
  skyMode: SkyMode;
  onExplore: () => void;
  onRead: () => void;
  onOpen: (id: ContentId) => void;
}) {
  const zh = locale === 'zh',
    touch = useCoarsePointer();
  // The hero is reading mode, where the plain wheel scrolls the page; City view zooms with it.
  const gestures = touch
    ? zh
      ? '点击建筑 · 双指缩放'
      : 'Tap a building · pinch to zoom'
    : zh
      ? '拖动平移 · Ctrl + 滚轮缩放（小城视图中直接滚动） · 点击建筑'
      : 'Drag to pan · Ctrl + scroll to zoom (just scroll in City view) · Click a building';
  return (
    <section className="hero" id="read-overview" data-chapter="overview">
      <div className="hero-copy">
        <span className="eyebrow">
          {zh
            ? '格拉斯哥大学 · 刘鹏远师门'
            : 'University of Glasgow · Pengyuan Liu and students'}
        </span>
        <h1>
          <span className={zh ? 'hero-title hero-title-zh' : 'hero-title'}>
            {zh ? '刘家门' : 'LIU’S GATE'}
          </span>
        </h1>
        <p className="hero-lede">
          {zh
            ? '刘家门是格拉斯哥大学刘鹏远老师带领的师门，关注城市分析、GeoAI 与城市数字孪生。本站做成了一座小城：每栋建筑对应一章内容。向下滚动阅读，或直接探索小城。'
            : 'Liu’s Gate is a small circle of PhD students supervised by Pengyuan Liu at the University of Glasgow, working on urban analytics, GeoAI and urban digital twins. This site is built as a small city: each building holds one chapter. Scroll to read, or explore the city directly.'}
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
      <NewsPreview locale={locale} onOpen={onOpen} />
      <div className="hero-foot">
        <span className="hero-hint">
          {zh
            ? `现在格拉斯哥 ${sky.clock}${skyMode === 'auto' ? '，小城按当地时间作息' : ''} · ${gestures}`
            : `It is ${sky.clock} in Glasgow${skyMode === 'auto' ? ' and the city keeps local time' : ''} · ${gestures}`}
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
                  reading
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
