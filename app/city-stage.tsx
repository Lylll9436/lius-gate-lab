import { useEffect, useRef, type RefObject } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Box,
  ChevronUp,
  CloudRain,
  Layers,
  List,
  Maximize2,
  Minus,
  Moon,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Route,
  Sun,
  SunMoon,
  X,
} from 'lucide-react';
import { buildings, type Building, type BuildingId, type Locale } from './city-data';
import { districts, type DistrictId } from './city-districts';
import {
  people,
  sceneTarget,
  titleFor,
  tourStops,
  type BrowseMode,
  type ContentId,
} from './lab-navigation';
import type { HoverTarget } from './city-scene';
import type { SkyState } from './glasgow-sun';
import { LabContent, PlaceGlyph, glyphFor } from './lab-content';
import { skyCaption, type SkyMode } from './use-sky';

export type StageController = {
  locale: Locale;
  mode: BrowseMode;
  content: ContentId;
  building?: Building;
  ready: boolean;
  error: boolean;
  hovered: HoverTarget;
  sky: SkyState;
  skyMode: SkyMode;
  rain: boolean;
  inspect: boolean;
  tour: number;
  plan: boolean;
  /** Plan view: the district in focus, or null for all four alike. */
  district: DistrictId | null;
  paused: boolean;
  panelOpen: boolean;
  /** Phones: the file shows in full, not just its title and actions. */
  sheetFull: boolean;
  directory: boolean;
  zoom: (factor: number) => void;
  rotate: () => void;
  reset: () => void;
  cycleSky: () => void;
  toggleRain: () => void;
  togglePlan: () => void;
  togglePause: () => void;
  inspectBuilding: () => void;
  exitInspection: () => void;
  tourStop: (index: number) => void;
  closeTour: () => void;
  togglePanel: () => void;
  toggleSheet: () => void;
  toggleDirectory: () => void;
  select: (id: BuildingId) => void;
  openPark: () => void;
  navigate: (mode: BrowseMode, content: ContentId) => void;
  focusDistrict: (id: DistrictId) => void;
  /** Ring a place on the model while its Directory row is pointed at or focused. */
  accent: (id: HoverTarget) => void;
};

export function CityStage({
  mount,
  ctl,
}: {
  mount: RefObject<HTMLDivElement | null>;
  ctl: StageController;
}) {
  const { locale } = ctl,
    zh = locale === 'zh',
    tr = (en: string, cn: string) => (zh ? cn : en),
    explore = ctl.mode === 'city',
    b = ctl.building;
  const hoveredBuilding = buildings.find((item) => item.id === ctl.hovered);
  // The tour moves focus to Next as it starts, and back to its own button once it ends.
  const touring = explore && ctl.tour >= 0,
    wasTouring = useRef(touring),
    tourButton = useRef<HTMLButtonElement>(null),
    nextButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (touring && !wasTouring.current) nextButton.current?.focus();
    else if (!touring && wasTouring.current) {
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost) tourButton.current?.focus();
    }
    wasTouring.current = touring;
  }, [touring]);
  const lastStop = tourStops.length - 1,
    onPark = !b && !!sceneTarget(ctl.content).park;
  const caption = hoveredBuilding
    ? `${hoveredBuilding.name[locale]} · ${hoveredBuilding.category[locale]}`
    : ctl.hovered === 'corner-park'
      ? tr('Corner park · Life at the Gate', '街角公园 · 师门生活')
      : null;
  return (
    <div
      className={[
        'city-stage',
        explore ? 'is-explore' : 'is-reading',
        ctl.inspect && 'is-inspecting',
        // Which floating panels are up, so the phone layouts can keep them apart.
        explore && (ctl.panelOpen || ctl.directory) && 'has-side',
        explore && ctl.tour >= 0 && 'is-touring',
        explore && ctl.plan && 'has-plan',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={tr('Interactive city of Liu’s Gate', '刘家门的交互小城')}
    >
      <div ref={mount} className="world" />
      {!ctl.ready && (
        <output className="stage-loading">
          <span className="loading-dot" aria-hidden="true" />
          {ctl.error
            ? tr(
                'The city could not load. Everything is still readable below.',
                '城市暂时无法加载，内容仍可在下方阅读。',
              )
            : tr('Building the city…', '正在建造小城…')}
        </output>
      )}
      <div className="map-labels">
        {buildings.map((item) => (
          <div
            key={item.id}
            data-building-label={item.id}
            className="building-hover-label"
            style={{ visibility: 'hidden' }}
            aria-hidden="true"
          >
            <strong>{item.name[locale]}</strong>
            <span>
              {item.category[locale]} ·{' '}
              {districts.find((d) => d.buildings.includes(item.id))?.name[locale]}
            </span>
          </div>
        ))}
        <div
          data-building-label="corner-park"
          className="building-hover-label"
          style={{ visibility: 'hidden' }}
          aria-hidden="true"
        >
          <strong>{tr('Corner park', '街角公园')}</strong>
          <span>{tr('Life at the Gate · Harbour', '师门生活 · 港口')}</span>
        </div>
        {/* The People chapter's name tags over the members' roofs, placed by the city. In
            English the first name; in Chinese the full name, two or three characters. */}
        {people.map(
          (person) =>
            person.buildingId && (
              <span
                key={person.id}
                data-home-tag={person.buildingId}
                className="home-tag"
                aria-hidden="true"
              >
                {zh ? person.name.zh : person.name.en.split(' ')[0]}
              </span>
            ),
        )}
      </div>

      {/* Top-left: where you are, what you point at, what the sky is doing. */}
      <div className="stage-caption" aria-live="polite">
        <span className="sky-chip">
          <i aria-hidden="true" />
          {skyCaption(ctl.sky, ctl.skyMode, locale)}
        </span>
        {caption && <span className="hover-chip">{caption}</span>}
        {ctl.inspect && b && (
          <span className="hover-chip">
            {b.name[locale]} · {tr('Architecture study', '建筑模型')}
          </span>
        )}
      </div>

      {/* The sky and camera bars; on phones in City mode they share one row. */}
      <div className="hud-row">
        {/* Bottom-left: weather and time. */}
        <div className="hud hud-sky" aria-label={tr('Sky', '天空')}>
          <button
            onClick={ctl.cycleSky}
            aria-label={tr('Day and night: auto, day, night', '昼夜：自动、白天、夜晚')}
            title={tr('Follows Glasgow time unless you override it', '默认跟随格拉斯哥时间')}
          >
            {ctl.skyMode === 'auto' ? (
              <SunMoon size={15} />
            ) : ctl.skyMode === 'day' ? (
              <Sun size={15} />
            ) : (
              <Moon size={15} />
            )}
          </button>
          <button
            onClick={ctl.toggleRain}
            aria-pressed={ctl.rain}
            aria-label={tr('Glasgow rain', '格拉斯哥的雨')}
            title={tr('It is Glasgow. Let it rain.', '这里是格拉斯哥，下点雨吧。')}
          >
            <CloudRain size={15} />
          </button>
          <button
            onClick={ctl.togglePause}
            aria-pressed={ctl.paused}
            aria-label={ctl.paused ? tr('Resume', '继续') : tr('Pause', '暂停')}
          >
            {ctl.paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          {/* Plan view tints the model, so it waits for the town, as the tour does. */}
          {explore && (
            <button
              onClick={ctl.togglePlan}
              disabled={!ctl.ready}
              aria-pressed={ctl.plan}
              data-plan-toggle
              aria-label={tr('Plan view', '规划视图')}
              title={tr('The town’s four districts', '小城的四个分区')}
            >
              <Layers size={15} />
            </button>
          )}
        </div>
        {/* Bottom-right: camera. City mode on a phone drops the zoom buttons: pinch zooms. */}
        <div className="hud hud-camera" aria-label={tr('Camera', '镜头')}>
          <button className="hud-zoom" onClick={() => ctl.zoom(1.25)} aria-label={tr('Zoom in', '放大')}>
            <Plus size={16} />
          </button>
          <button
            className="hud-zoom"
            onClick={() => ctl.zoom(1 / 1.25)}
            aria-label={tr('Zoom out', '缩小')}
          >
            <Minus size={16} />
          </button>
          <button onClick={ctl.rotate} aria-label={tr('Rotate', '旋转')}>
            <RotateCcw size={15} />
          </button>
          <button onClick={ctl.reset} aria-label={tr('Reset view', '恢复全景')}>
            <Maximize2 size={15} />
          </button>
        </div>
      </div>

      {explore && (
        <>
          {/* Explore-only: the tour, the directory and the dossier. */}
          <div className="hud hud-explore">
            <button
              ref={tourButton}
              onClick={() => ctl.tourStop(0)}
              disabled={!ctl.ready}
              aria-pressed={ctl.tour >= 0}
            >
              <Route size={15} />
              {tr('City tour', '城市导览')}
            </button>
            <button onClick={ctl.toggleDirectory} aria-expanded={ctl.directory}>
              <List size={15} />
              {tr('Directory', '目录')}
            </button>
            <button onClick={ctl.togglePanel} aria-expanded={ctl.panelOpen} data-open-dossier>
              <BookOpen size={15} />
              {ctl.panelOpen ? tr('Hide file', '收起资料') : tr('Open file', '展开资料')}
            </button>
          </div>

          {/* Plan view's key: each district's colour, name and what is in it. Picking one
              frames it; picking it again shows all four. */}
          {ctl.plan && (
            <section className="plan-legend" aria-label={tr('Districts', '分区')}>
              <div className="plan-legend-list">
                {districts.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => ctl.focusDistrict(d.id)}
                    aria-pressed={ctl.district === d.id}
                    aria-describedby={`district-${d.id}`}
                  >
                    <i style={{ background: d.color }} aria-hidden="true" />
                    <strong>{d.name[locale]}</strong>
                    {/* Read as the button's description, after its name. */}
                    <small id={`district-${d.id}`} aria-hidden="true">
                      {d.description[locale]}
                    </small>
                  </button>
                ))}
              </div>
            </section>
          )}

          {touring && (
            <div className="tour-control">
              <span className="eyebrow">
                {tr('Tour', '导览')} {ctl.tour + 1}/{tourStops.length}
              </span>
              <strong id="tour-stop" aria-live="polite">
                {b ? b.name[locale] : onPark ? tr('Corner park', '街角公园') : titleFor(ctl.content, locale)}
              </strong>
              <div>
                <button
                  onClick={() => {
                    const previous = Math.max(0, ctl.tour - 1);
                    // The first stop has no Previous: keep the focus on the tour.
                    if (previous === 0) nextButton.current?.focus();
                    ctl.tourStop(previous);
                  }}
                  disabled={ctl.tour === 0}
                  aria-label={tr('Previous stop', '上一站')}
                >
                  <ArrowLeft size={15} />
                </button>
                <button
                  ref={nextButton}
                  aria-describedby="tour-stop"
                  onClick={() =>
                    ctl.tour === lastStop ? ctl.closeTour() : ctl.tourStop(ctl.tour + 1)
                  }
                >
                  {ctl.tour === lastStop ? tr('Finish', '结束') : tr('Next', '下一站')}
                  <ArrowRight size={14} />
                </button>
                <button onClick={ctl.closeTour} aria-label={tr('Close tour', '关闭导览')}>
                  <X size={14} />
                </button>
              </div>
            </div>
          )}

          {ctl.inspect && (
            <div className="inspection-toolbar">
              <button onClick={ctl.exitInspection}>
                <ArrowLeft size={14} />
                {tr('Back to the city', '返回城市')}
              </button>
            </div>
          )}

          {ctl.directory && (
            <section className="directory" aria-label={tr('All places', '所有地点')}>
              <div className="directory-head">
                <span className="eyebrow">{tr('All places', '所有地点')}</span>
                <button onClick={ctl.toggleDirectory} aria-label={tr('Close', '关闭')}>
                  <X size={14} />
                </button>
              </div>
              {/* Each place with what it holds; pointing at a row rings the place on the model. */}
              {buildings.map((item) => (
                <button
                  key={item.id}
                  className="directory-row"
                  onClick={() => ctl.select(item.id)}
                  aria-current={b?.id === item.id ? 'location' : undefined}
                  onPointerEnter={() => ctl.accent(item.id)}
                  onPointerLeave={() => ctl.accent(null)}
                  onFocus={() => ctl.accent(item.id)}
                  onBlur={() => ctl.accent(null)}
                >
                  <PlaceGlyph kind={glyphFor(item.id)} size={16} />
                  <span className="directory-text">
                    <strong>{item.name[locale]}</strong>{' '}
                    <span>{item.category[locale]}</span>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
              <button
                className="directory-row"
                onClick={ctl.openPark}
                aria-current={onPark ? 'location' : undefined}
                onPointerEnter={() => ctl.accent('corner-park')}
                onPointerLeave={() => ctl.accent(null)}
                onFocus={() => ctl.accent('corner-park')}
                onBlur={() => ctl.accent(null)}
              >
                <PlaceGlyph kind="park" size={16} />
                <span className="directory-text">
                  <strong>{tr('Corner park', '街角公园')}</strong>{' '}
                  <span>{tr('Life at the Gate', '师门生活')}</span>
                </span>
                <ArrowUpRight size={14} />
              </button>
            </section>
          )}

          <aside
            className={`dossier ${ctl.sheetFull ? 'is-full' : 'is-peek'}`}
            hidden={!ctl.panelOpen}
            aria-label={tr('Selected place', '当前地点')}
          >
            <div className="dossier-head">
              <span className="eyebrow">
                <PlaceGlyph kind={glyphFor(ctl.content)} size={14} />
                {b
                  ? b.category[locale]
                  : ctl.content === 'people'
                    ? tr('The terrace', '联排住宅')
                    : ctl.content === 'corner-park'
                      ? tr('Harbour', '港口')
                      : tr('Overview', '总览')}
              </span>
              <h2 id="dossier-title" tabIndex={-1}>
                {titleFor(ctl.content, locale)}
              </h2>
              {/* Phones: the whole head is the sheet's handle. */}
              <button
                className="sheet-handle"
                onClick={ctl.toggleSheet}
                aria-expanded={ctl.sheetFull}
                aria-controls="dossier-body"
                aria-label={
                  ctl.sheetFull
                    ? tr('Show less of the file', '收起资料正文')
                    : tr('Show the whole file', '展开完整资料')
                }
              >
                <ChevronUp size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="dossier-body" id="dossier-body">
              <LabContent
                id={ctl.content}
                locale={locale}
                onOpen={(id) => ctl.navigate('city', id)}
              />
            </div>
            <div className="dossier-foot">
              {b && (
                <button onClick={ctl.inspectBuilding} disabled={!ctl.ready || ctl.inspect}>
                  <Box size={15} />
                  {tr('Inspect building', '查看建筑')}
                </button>
              )}
              {people.some((p) => p.id === ctl.content) && null}
              <button onClick={() => ctl.navigate('reading', ctl.content)}>
                <BookOpen size={15} />
                {tr('Read on the page', '在页面中阅读')}
              </button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
