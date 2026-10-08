import type { RefObject } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Box,
  CloudRain,
  Grid2X2,
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
import { districts } from './city-districts';
import { people, titleFor, type BrowseMode, type ContentId } from './lab-navigation';
import type { HoverTarget } from './city-scene';
import type { SkyState } from './city-atmosphere';
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
  interior: boolean;
  tour: number;
  plan: boolean;
  grid: boolean;
  paused: boolean;
  panelOpen: boolean;
  directory: boolean;
  zoom: (factor: number) => void;
  rotate: () => void;
  reset: () => void;
  cycleSky: () => void;
  toggleRain: () => void;
  togglePlan: () => void;
  toggleGrid: () => void;
  togglePause: () => void;
  inspectBuilding: () => void;
  exitInspection: () => void;
  setInterior: (v: boolean) => void;
  tourStop: (index: number) => void;
  closeTour: () => void;
  togglePanel: () => void;
  toggleDirectory: () => void;
  select: (id: BuildingId) => void;
  openPark: () => void;
  navigate: (mode: BrowseMode, content: ContentId) => void;
  focusDistrict: (id: (typeof districts)[number]['id']) => void;
};

const stops = buildings.map((b) => b.id);

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
  const caption = hoveredBuilding
    ? `${hoveredBuilding.name[locale]} · ${hoveredBuilding.category[locale]}`
    : ctl.hovered === 'corner-park'
      ? tr('Corner park · Group life', '街角公园 · 研究组生活')
      : null;
  return (
    <div
      className={`city-stage ${explore ? 'is-explore' : 'is-reading'} ${ctl.inspect ? 'is-inspecting' : ''}`}
      aria-label={tr('Interactive city of the research group', '研究组的交互小城')}
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
          <span>{tr('Group life · Harbour', '研究组生活 · 港口')}</span>
        </div>
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

      {/* Bottom-right: camera. */}
      <div className="hud hud-camera" aria-label={tr('Camera', '镜头')}>
        <button onClick={() => ctl.zoom(1.25)} aria-label={tr('Zoom in', '放大')}>
          <Plus size={16} />
        </button>
        <button onClick={() => ctl.zoom(1 / 1.25)} aria-label={tr('Zoom out', '缩小')}>
          <Minus size={16} />
        </button>
        <button onClick={ctl.rotate} aria-label={tr('Rotate', '旋转')}>
          <RotateCcw size={15} />
        </button>
        <button onClick={ctl.reset} aria-label={tr('Reset view', '恢复全景')}>
          <Maximize2 size={15} />
        </button>
      </div>

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
        {explore && (
          <>
            <button onClick={ctl.togglePlan} aria-pressed={ctl.plan} aria-label={tr('Plan view', '规划视图')}>
              <Layers size={15} />
            </button>
            <button onClick={ctl.toggleGrid} aria-pressed={ctl.grid} aria-label={tr('Grid', '网格')}>
              <Grid2X2 size={15} />
            </button>
          </>
        )}
      </div>

      {explore && (
        <>
          {/* Explore-only: the tour, the directory and the dossier. */}
          <div className="hud hud-explore">
            <button
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

          {ctl.plan && (
            <div className="plan-legend">
              {districts.map((d) => (
                <button key={d.id} onClick={() => ctl.focusDistrict(d.id)}>
                  <i style={{ background: d.color }} />
                  {d.name[locale]}
                </button>
              ))}
            </div>
          )}

          {ctl.tour >= 0 && (
            <div className="tour-control">
              <span className="eyebrow">
                {tr('Tour', '导览')} {ctl.tour + 1}/{stops.length}
              </span>
              <strong>{b?.name[locale]}</strong>
              <div>
                <button
                  onClick={() => ctl.tourStop(Math.max(0, ctl.tour - 1))}
                  disabled={ctl.tour === 0}
                  aria-label={tr('Previous stop', '上一站')}
                >
                  <ArrowLeft size={15} />
                </button>
                <button
                  onClick={() =>
                    ctl.tour === stops.length - 1 ? ctl.closeTour() : ctl.tourStop(ctl.tour + 1)
                  }
                >
                  {ctl.tour === stops.length - 1 ? tr('Finish', '结束') : tr('Next', '下一站')}
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
              {b?.id !== 'lius-gate' && (
                <div className="segmented">
                  <button aria-pressed={!ctl.interior} onClick={() => ctl.setInterior(false)}>
                    {tr('Exterior', '外观')}
                  </button>
                  <button aria-pressed={ctl.interior} onClick={() => ctl.setInterior(true)}>
                    {tr('Cutaway', '剖面')}
                  </button>
                </div>
              )}
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
              {buildings.map((item) => (
                <button key={item.id} className="directory-row" onClick={() => ctl.select(item.id)}>
                  <PlaceGlyph kind={glyphFor(item.id)} size={16} />
                  <strong>{item.name[locale]}</strong>
                  <span>{item.style[locale]}</span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
              <button className="directory-row" onClick={ctl.openPark}>
                <PlaceGlyph kind="park" size={16} />
                <strong>{tr('Corner park', '街角公园')}</strong>
                <span>{tr('Group life & memories', '生活与记忆')}</span>
                <ArrowUpRight size={14} />
              </button>
            </section>
          )}

          <aside
            className="dossier"
            hidden={!ctl.panelOpen}
            aria-label={tr('Selected place', '当前地点')}
          >
            <div className="dossier-head">
              <span className="eyebrow">
                <PlaceGlyph kind={glyphFor(ctl.content)} size={14} />
                {b
                  ? b.category[locale]
                  : ctl.content === 'people'
                    ? tr('The crescent', '新月联排')
                    : ctl.content === 'corner-park'
                      ? tr('Harbour', '港口')
                      : tr('Overview', '总览')}
              </span>
              <h2 id="dossier-title" tabIndex={-1}>
                {titleFor(ctl.content, locale)}
              </h2>
            </div>
            <div className="dossier-body">
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
