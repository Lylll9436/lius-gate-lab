'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Plus,
  Minus,
  RotateCcw,
  Sun,
  Moon,
  Pause,
  Play,
  Layers,
  Box,
  Grid2X2,
  Maximize2,
  Route,
  X,
  BookOpen,
  Map,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { buildings, type BuildingId, type Locale } from './city-data';
import { districts } from './city-districts';
import {
  people,
  readingChapters,
  titleFor,
  chapterFor,
  parseLocation,
  destinations,
  buildingForContent,
  sceneTarget,
  selectionForContent,
  contentForBuilding,
  type ContentId,
  type BrowseMode,
} from './lab-navigation';
import { LabContent, IsoIcon, BrandLogo } from './lab-content';
import type { CityAPI } from './city-scene';
const stops = buildings.map((b) => b.id);
export default function Home() {
  const mount = useRef<HTMLDivElement>(null),
    api = useRef<CityAPI | null>(null),
    dossier = useRef<HTMLDivElement>(null),
    renderedView = useRef<{ mode: BrowseMode; content: ContentId } | null>(
      null,
    );
  const [locale, setLocale] = useState<Locale>('en'),
    [view, setView] = useState<{ mode: BrowseMode; content: ContentId }>({
      mode: 'city',
      content: 'overview',
    }),
    [ready, setReady] = useState(false),
    [error, setError] = useState(false),
    [night, setNight] = useState(false),
    [paused, setPaused] = useState(false),
    [grid, setGrid] = useState(false),
    [plan, setPlan] = useState(false),
    [inspect, setInspect] = useState(false),
    [interior, setInterior] = useState(false),
    [tour, setTour] = useState(-1),
    [panelOpen, setPanelOpen] = useState(true);
  const { mode, content } = view,
    zh = locale === 'zh',
    tr = (en: string, cn: string) => (zh ? cn : en),
    b = buildingForContent(content);
  function applyView(
    next: { mode: BrowseMode; content: ContentId },
    keepTour = false,
  ) {
    setView(next);
    setInspect(false);
    setInterior(false);
    setPlan(false);
    setPanelOpen(true);
    if (!keepTour) setTour(-1);
  }
  function navigate(
    nextMode: BrowseMode,
    nextContent: ContentId,
    keepTour = false,
  ) {
    applyView({ mode: nextMode, content: nextContent }, keepTour);
    const hash = `#${nextMode === 'city' ? 'city' : 'read'}/${nextContent}`;
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  }
  function select(id: BuildingId) {
    navigate('city', contentForBuilding(id));
  }
  function reset() {
    navigate('city', 'overview');
  }
  function tourStop(index: number) {
    setTour(index);
    navigate('city', contentForBuilding(stops[index]), true);
  }
  function togglePlan() {
    const next = !plan;
    setInspect(false);
    setInterior(false);
    setPlan(next);
    api.current?.setPlan(next);
    if (!next && b) api.current?.select(b.id);
  }
  function inspectBuilding() {
    if (!b) return;
    setInspect(true);
    setInterior(false);
    setPlan(false);
    api.current?.setPlan(false);
    api.current?.enter(b.id);
  }
  useEffect(() => {
    let disposed = false;
    const sync = () => {
      if (!disposed) applyView(parseLocation(window.location.hash));
    };
    void Promise.resolve().then(sync);
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      disposed = true;
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
      api.current?.dispose();
      api.current = null;
    };
  }, []);
  useEffect(() => {
    if (mode !== 'city' || api.current) return;
    let disposed = false;
    // Resolve a direct reading link before loading any Three.js code.
    if (parseLocation(window.location.hash).mode !== 'city') return;
    import('./city-scene')
      .then(({ createCity }) => {
        if (disposed || !mount.current) return;
        api.current = createCity(mount.current, select, () =>
          navigate('city', 'corner-park'),
        );
        setReady(true);
        setPaused(
          window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        );
      })
      .catch(() => {
        if (!disposed) {
          setError(true);
          setView((current) => ({ ...current, mode: 'reading' }));
        }
      });

    return () => {
      disposed = true;
    };
  }, [mode]);
  useEffect(() => {
    const previous = renderedView.current;
    renderedView.current = view;
    const engine = api.current;
    if (engine) {
      engine.setPlan(false);
      engine.reset();
      if (view.mode === 'city') {
        const destination = sceneTarget(view.content);
        if (destination.district) {
          engine.focusBuildings(selectionForContent(view.content));
        } else if (destination.park) engine.focusPark();
        else if (destination.building) engine.select(destination.building);
      }
    }
    const frame = requestAnimationFrame(() => {
      if (view.mode === 'reading') {
        const target =
          document.getElementById(
            `read-${view.content === 'overview' ? 'town-hall' : view.content}`,
          ) ?? document.getElementById(`read-${chapterFor(view.content)}`);
        target?.scrollIntoView({ behavior: 'auto', block: 'start' });
        target
          ?.querySelector<HTMLElement>('h2,h3')
          ?.focus({ preventScroll: true });
      } else {
        dossier.current?.scrollTo({ top: 0 });
        if (previous?.mode === 'reading')
          window.scrollTo({ top: 0, behavior: 'auto' });
        else if (
          previous &&
          view.content !== 'overview' &&
          (window.innerWidth <= 1050 || window.innerHeight <= 650)
        )
          mount.current?.closest('.city-workspace')?.scrollIntoView({
            behavior: 'auto',
            block: 'start',
          });
        document
          .getElementById('dossier-title')
          ?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [view, ready]);
  useEffect(() => {
    api.current?.setNight(night);
  }, [night, ready]);
  useEffect(() => {
    api.current?.setPaused(paused);
  }, [paused, ready]);
  useEffect(() => {
    api.current?.setGrid(grid);
  }, [grid, ready]);
  useEffect(() => {
    document.documentElement.lang = zh ? 'zh-CN' : 'en';
  }, [zh]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || mode !== 'city') return;
      if (inspect && b) {
        setInspect(false);
        setInterior(false);
        api.current?.select(b.id);
      } else if (panelOpen) {
        setPanelOpen(false);
        document
          .querySelector<HTMLButtonElement>('[data-open-dossier]')
          ?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [mode, inspect, b, panelOpen]);
  const navLabel = (id: ContentId) =>
    id === 'town-hall'
      ? tr('The group', '研究组')
      : id === 'people'
        ? tr('People', '人员')
        : id === 'research-studio'
          ? tr('Research', '研究')
          : id === 'city-archive'
            ? tr('Archive', '成果')
            : tr('Group life', '生活');
  const readingTitle = (id: ContentId) =>
    id === 'town-hall'
      ? tr('About the group', '关于研究组')
      : id === 'research-studio'
        ? tr('Research', '研究方向与项目')
        : id === 'city-archive'
          ? tr('Publications & resources', '学术成果与开放资源')
          : titleFor(id, locale);
  return (
    <main
      className={`academic-site ${mode === 'city' ? 'city-mode' : 'reading-mode'}`}
    >
      <a
        className="skip-link"
        href="#read/town-hall"
        onClick={(e) => {
          e.preventDefault();
          navigate('reading', content);
        }}
      >
        {tr('Read without the map', '跳过地图，阅读资料')}
      </a>
      <header className="site-header">
        <a
          className="wordmark"
          href="#city/overview"
          onClick={(e) => {
            e.preventDefault();
            reset();
          }}
        >
          <BrandLogo size={64} />
          LIU’S GATE{zh && <span>刘家门</span>}
        </a>
        <span className="header-affiliation">
          Urban Intelligence Group · University of Glasgow
        </span>
        <button
          className="language"
          onClick={() => setLocale(zh ? 'en' : 'zh')}
        >
          {zh ? 'EN' : 'ZH'}
        </button>
      </header>
      <div className="browse-bar">
        <nav
          className="browse-modes"
          aria-label={tr('Browsing mode', '浏览模式')}
        >
          <button
            aria-pressed={mode === 'city'}
            onClick={() => navigate('city', content)}
          >
            <Map size={16} />
            {tr('City exploration', '城市探索')}
          </button>
          <button
            aria-pressed={mode === 'reading'}
            onClick={() => navigate('reading', content)}
          >
            <BookOpen size={16} />
            {tr('Standard reading', '常规阅读')}
          </button>
        </nav>
        <span>
          {mode === 'city'
            ? tr('First year · Glasgow', '创立第一年 · 格拉斯哥')
            : tr('The same group, page by page.', '同一份资料，按页面阅读。')}
        </span>
      </div>
      {error && (
        <p className="scene-fallback" role="alert">
          {tr(
            'The city could not load. The complete group content is available in reading mode.',
            '城市暂时无法加载，全部研究组资料仍可在常规阅读模式中访问。',
          )}
        </p>
      )}
      <nav
        className="district-navigation"
        aria-label={tr('Group destinations', '研究组内容入口')}
      >
        {destinations.map((id) => (
          <a
            key={id}
            href={`#${mode === 'city' ? 'city' : 'read'}/${id}`}
            aria-current={chapterFor(content) === id ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              navigate(mode, id);
            }}
          >
            <IsoIcon kind={id} size={45} />
            <span>{navLabel(id)}</span>
          </a>
        ))}
      </nav>
      <section
        className="city-section"
        id="city"
        hidden={mode !== 'city'}
        aria-label={tr('Interactive research group city', '交互研究组城市')}
      >
        <div className="exploration-heading">
          <div>
            <span className="overline">LIU’S GATE / GLASGOW</span>
            <h1>{tr('A research group, a small city.', '研究组，是一座小城。')}</h1>
          </div>
          <div>
            <button
              className="text-action"
              onClick={() => tourStop(0)}
              disabled={!ready}
            >
              <Route size={16} />
              {tr('City tour', '城市导览')}
            </button>
            <button
              className="text-action"
              data-open-dossier
              aria-expanded={panelOpen}
              onClick={() => setPanelOpen(!panelOpen)}
            >
              <BookOpen size={16} />
              {panelOpen
                ? tr('Hide file', '收起资料')
                : tr('Open file', '展开资料')}
            </button>
          </div>
        </div>
        <div
          className={`city-workspace ${panelOpen ? 'with-dossier' : ''} ${content !== 'overview' ? 'destination-focus' : ''}`}
        >
          <div className="city-stage">
            <div className={`city-view ${night ? 'night' : ''}`}>
              <div ref={mount} className="world" />
              {!ready && (
                <output className="loading">
                  {error
                    ? tr(
                        'The interactive overview is unavailable. All group content is below.',
                        '交互概览暂时无法加载，研究组内容仍可在下方阅读。',
                      )
                    : tr('Loading the city…', '正在加载城市…')}
                </output>
              )}
              <div className="view-caption">
                <span>
                  {inspect ? b?.name[locale] : 'LIU’S GATE / GLASGOW'}
                </span>
                <span>
                  {inspect
                    ? tr('Architecture study', '建筑模型查看')
                    : tr('Isometric overview', '轴测概览')}
                </span>
              </div>
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
                      {
                        districts.find((d) => d.buildings.includes(item.id))
                          ?.name[locale]
                      }
                    </span>
                    {people.find((person) => person.buildingId === item.id)
                      ?.affiliation?.[locale] && (
                      <span>
                        {
                          people.find((person) => person.buildingId === item.id)
                            ?.affiliation?.[locale]
                        }
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div
                data-building-label="corner-park"
                className="building-hover-label"
                style={{ visibility: 'hidden' }}
                aria-hidden="true"
              >
                <strong>{tr('Corner park', '街角公园')}</strong>
                <span>
                  {tr(
                    'Group life · Archive & riverside',
                    '研究组生活 · 档案与滨水区',
                  )}
                </span>
              </div>
              {inspect && (
                <div className="inspection-toolbar">
                  <button
                    onClick={() => {
                      setInspect(false);
                      setInterior(false);
                      if (b) api.current?.select(b.id);
                    }}
                  >
                    <ArrowLeft size={15} />
                    {tr('City', '返回城市')}
                  </button>
                  {b?.id !== 'lius-gate' && (
                    <Tabs
                      value={interior ? 'interior' : 'exterior'}
                      onValueChange={(value) => {
                        const open = value === 'interior';
                        setInterior(open);
                        api.current?.setInterior(open);
                      }}
                    >
                      <TabsList>
                        <TabsTrigger value="exterior">
                          {tr('Exterior', '外观')}
                        </TabsTrigger>
                        <TabsTrigger value="interior">
                          {tr('Cutaway', '室内剖面')}
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  )}
                </div>
              )}
              {plan && (
                <div className="plan-legend">
                  {districts.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => api.current?.focusDistrict(d.id)}
                    >
                      <i style={{ background: d.color }} />
                      {d.name[locale]}
                    </button>
                  ))}
                </div>
              )}
              {tour >= 0 && (
                <div className="tour-control">
                  <span>
                    {tr('Tour', '导览')} {tour + 1}/{stops.length}
                  </span>
                  <strong>{b?.name[locale]}</strong>
                  <button
                    onClick={() => tourStop(Math.max(0, tour - 1))}
                    disabled={tour === 0}
                    aria-label={tr('Previous stop', '上一站')}
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <button
                    onClick={() =>
                      tour === stops.length - 1 ? reset() : tourStop(tour + 1)
                    }
                  >
                    {tour === stops.length - 1
                      ? tr('Finish', '结束')
                      : tr('Next', '下一站')}
                    <ArrowRight size={15} />
                  </button>
                  <button
                    onClick={() => setTour(-1)}
                    aria-label={tr('Close tour', '关闭导览')}
                  >
                    <X size={15} />
                  </button>
                </div>
              )}
              <div className="camera-controls">
                <button
                  onClick={() => api.current?.zoom(1.2)}
                  aria-label={tr('Zoom in', '放大')}
                >
                  <Plus size={17} />
                </button>
                <button
                  onClick={() => api.current?.zoom(1 / 1.2)}
                  aria-label={tr('Zoom out', '缩小')}
                >
                  <Minus size={17} />
                </button>
                <button
                  onClick={() => api.current?.rotate()}
                  aria-label={tr('Rotate', '旋转')}
                >
                  <RotateCcw size={16} />
                </button>
                <button
                  onClick={reset}
                  aria-label={tr('Reset view', '恢复全景')}
                >
                  <Maximize2 size={16} />
                </button>
              </div>
            </div>
            <div className="model-footer">
              <span>
                {tr(
                  'Drag to pan · Ctrl/⌘ + scroll to zoom · Select a building',
                  '拖动平移 · Ctrl/⌘ + 滚动缩放 · 点选建筑',
                )}
              </span>
              <div>
                <button
                  onClick={() => setNight(!night)}
                  aria-pressed={night}
                  aria-label={tr('Toggle day and night', '切换昼夜')}
                >
                  {night ? <Moon size={16} /> : <Sun size={16} />}
                </button>
                <button onClick={togglePlan} aria-pressed={plan}>
                  <Layers size={15} />
                  {tr('Plan', '规划')}
                </button>
                <button
                  onClick={() => setGrid(!grid)}
                  aria-pressed={grid}
                  aria-label={tr('Toggle grid', '切换网格')}
                >
                  <Grid2X2 size={15} />
                </button>
                <button
                  onClick={() => setPaused(!paused)}
                  aria-pressed={paused}
                  aria-label={
                    paused
                      ? tr('Resume animation', '继续动画')
                      : tr('Pause animation', '暂停动画')
                  }
                >
                  {paused ? <Play size={15} /> : <Pause size={15} />}
                </button>
              </div>
            </div>
          </div>
          <aside
            className="place-dossier"
            hidden={!panelOpen}
            aria-label={tr(
              'Selected place and group content',
              '当前位置与研究组资料',
            )}
          >
            <div className="dossier-heading">
              <IsoIcon kind={content} size={47} />
              <div>
                <span>
                  {b
                    ? b.category[locale]
                    : content === 'people'
                      ? tr('RESIDENTIAL QUARTER', '花园住区')
                      : content === 'corner-park'
                        ? tr('RIVERSIDE MEMORIES', '滨水记忆')
                        : tr('THE CITY DIRECTORY', '城市目录')}
                </span>
                <h2 id="dossier-title" tabIndex={-1}>
                  {titleFor(content, locale)}
                </h2>
              </div>
            </div>
            <div className="dossier-body" ref={dossier}>
              <LabContent
                id={content}
                locale={locale}
                onOpen={(id) => navigate('city', id)}
              />
            </div>
            <div className="dossier-actions">
              {b && (
                <>
                  <button onClick={inspectBuilding} disabled={!ready}>
                    <Box size={16} />
                    {tr('Inspect building', '查看建筑')}
                  </button>
                </>
              )}
              <button onClick={() => navigate('reading', content)}>
                <BookOpen size={16} />
                {tr('Read on the page', '在常规页面阅读')}
              </button>
            </div>
          </aside>
        </div>
        <details className="city-directory">
          <summary>
            {tr('All places & architectural periods', '所有地点与建筑年代')}
          </summary>
          <div>
            {buildings.map((item) => (
              <button key={item.id} onClick={() => select(item.id)}>
                <strong>{item.name[locale]}</strong>
                <span>{item.style[locale]}</span>
                <ArrowUpRight size={15} />
              </button>
            ))}
            <button onClick={() => navigate('city', 'corner-park')}>
              <strong>{tr('Corner park', '街角公园')}</strong>
              <span>{tr('Group life & memories', '生活与记忆')}</span>
              <ArrowUpRight size={15} />
            </button>
          </div>
        </details>
      </section>
      <div className="reading-pages" hidden={mode !== 'reading'}>
        <div className="reading-introduction">
          <span className="overline">UNIVERSITY OF GLASGOW</span>
          <h1>LIU’S GATE{zh && <span>刘家门</span>}</h1>
          <p>
            {tr(
              'Urban analytics. People, research and a shared beginning.',
              '城市分析。记录成员、研究与共同的起点。',
            )}
          </p>
        </div>
        {readingChapters.map((id, index) => (
          <section
            className="academic-section reading-chapter"
            id={`read-${id}`}
            key={id}
          >
            <div className="section-heading">
              <div>
                <span className="section-number">0{index + 1}</span>
                <h2 tabIndex={-1}>{readingTitle(id)}</h2>
              </div>
              <button
                className="text-action"
                onClick={() => navigate('city', id)}
              >
                <IsoIcon kind={id} size={29} />
                {tr('Locate in the city', '在城市中定位')}
              </button>
            </div>
            {id === 'people' ? (
              <div className="reading-profiles">
                {people.map((person) => (
                  <article id={`read-${person.id}`} key={person.id}>
                    <h3 tabIndex={-1}>{person.name[locale]}</h3>
                    <LabContent
                      reading
                      id={person.id}
                      locale={locale}
                      onOpen={(target) => navigate('reading', target)}
                    />
                    <button
                      className="text-action"
                      onClick={() => navigate('city', person.id)}
                    >
                      {person.buildingId
                        ? tr('Visit their home', '前往 TA 的住所')
                        : tr(
                            'Locate in the residential quarter',
                            '在花园住区定位',
                          )}
                      <ArrowUpRight size={15} />
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <LabContent
                reading
                id={id}
                locale={locale}
                onOpen={(target) => navigate('reading', target)}
              />
            )}
          </section>
        ))}
      </div>
      <footer className="site-footer">
        <div>
          <strong>{zh ? 'LIU’S GATE · 刘家门' : 'LIU’S GATE'}</strong>
          <span>Urban Intelligence Group · University of Glasgow</span>
        </div>
        <span>{tr('Founding edition', '创立版')}</span>
        <button
          className="text-action"
          onClick={() =>
            navigate(mode === 'city' ? 'reading' : 'city', content)
          }
        >
          {mode === 'city'
            ? tr('Standard reading', '常规阅读')
            : tr('Return to the city', '返回城市')}
          <ArrowUpRight size={14} />
        </button>
      </footer>
    </main>
  );
}
