'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildings, type BuildingId, type Locale } from './city-data';
import {
  chapterFor,
  parseLocation,
  buildingForContent,
  sceneTarget,
  selectionForContent,
  contentForBuilding,
  type ContentId,
  type BrowseMode,
} from './lab-navigation';
import type { CityAPI, HoverTarget } from './city-scene';
import { useGlasgowSky, effectiveNight, type SkyMode } from './use-sky';
import { Masthead, SiteFooter, chapterMeta } from './site-chrome';
import { CityStage, type StageController } from './city-stage';
import { Hero, Chapters } from './chapters';
import { chapterBearings } from './town-plan';
import { installLiquidGlass } from './liquid-glass';

/** Controls and the news card refract at the rim; the long text panels stay frosted only. */
const REFRACTING_GLASS =
  '.hero-news, .masthead-nav, .mode-switch, .lang-switch, .button-ghost, .hud, .sky-chip, .hover-chip, .tour-control, .inspection-toolbar, .plan-legend';

type View = { mode: BrowseMode; content: ContentId };
const stops = buildings.map((b) => b.id);
/** A different bearing for every chapter, each facing its subject's front. */
const bearings = chapterBearings;
const WIDE = '(min-width: 961px)';
/** The reading page's chapter for an address: the hero for the overview. */
const readingChapter = (id: ContentId) =>
  id === 'overview' ? 'overview' : chapterFor(id);

export default function Home() {
  const mount = useRef<HTMLDivElement>(null),
    api = useRef<CityAPI | null>(null),
    // While the page scrolls itself to a chapter, the camera heads straight there
    // instead of visiting every chapter the scroll passes on the way.
    scrollLock = useRef<{ chapter: ContentId; until: number } | null>(null),
    viewRef = useRef<View>({ mode: 'reading', content: 'overview' }),
    wideRef = useRef(true);
  const [locale, setLocale] = useState<Locale>(() =>
    typeof navigator !== 'undefined' && /^zh/i.test(navigator.language)
      ? 'zh'
      : 'en',
  );
  const [view, setView] = useState<View>({
      mode: 'reading',
      content: 'overview',
    }),
    [active, setActive] = useState<ContentId>('overview'),
    [ready, setReady] = useState(false),
    [error, setError] = useState(false),
    [skyMode, setSkyMode] = useState<SkyMode>('auto'),
    [rain, setRain] = useState(false),
    [paused, setPaused] = useState(false),
    [grid, setGrid] = useState(false),
    [plan, setPlan] = useState(false),
    [inspect, setInspect] = useState(false),
    [tour, setTour] = useState(-1),
    [panelOpen, setPanelOpen] = useState(true),
    [directory, setDirectory] = useState(false),
    [hovered, setHovered] = useState<HoverTarget>(null),
    [wide, setWide] = useState(true);
  const sky = useGlasgowSky(),
    night = effectiveNight(sky, skyMode);
  const { mode, content } = view,
    explore = mode === 'city',
    zh = locale === 'zh',
    b = buildingForContent(content);
  useEffect(() => installLiquidGlass(REFRACTING_GLASS), []);
  useEffect(() => {
    viewRef.current = view;
    wideRef.current = wide;
  }, [view, wide]);

  function applyView(next: View, keepTour = false) {
    setView(next);
    setInspect(false);
    setPlan(false);
    setDirectory(false);
    if (!keepTour) setTour(-1);
  }
  /** Scroll the reading page to a chapter or card, and send the camera straight there.
   *  `instant` jumps without the smooth glide (a page opened at an address). */
  const scrollToContent = useCallback((id: ContentId, instant = false) => {
    const chapter = readingChapter(id);
    // The lock holds until the scroll starts (the first frames can be seconds late
    // while the town is built), then for as long as a smooth scroll may take.
    const lock = { chapter, until: Infinity };
    scrollLock.current = lock;
    setActive(chapter);
    // Two frames: the story must be laid out again if explore mode was just left.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        lock.until = performance.now() + 2500;
        const target =
          document.getElementById(`read-${id}`) ??
          document.getElementById(`read-${chapterFor(id)}`);
        // 'instant', not 'auto': the page's CSS scroll-behavior is smooth.
        const behavior: ScrollBehavior =
          instant ||
          window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth';
        if (id === 'overview') window.scrollTo({ top: 0, behavior });
        else target?.scrollIntoView({ behavior, block: 'start' });
        target
          ?.querySelector<HTMLElement>('h2,h3')
          ?.focus({ preventScroll: true });
      }),
    );
  }, []);
  function navigate(
    nextMode: BrowseMode,
    nextContent: ContentId,
    options: { keepTour?: boolean; replace?: boolean } = {},
  ) {
    applyView({ mode: nextMode, content: nextContent }, options.keepTour);
    if (nextMode === 'reading') scrollToContent(nextContent);
    const hash = `#${nextMode === 'city' ? 'city' : 'read'}/${nextContent}`;
    if (window.location.hash !== hash) {
      if (options.replace) window.history.replaceState(null, '', hash);
      else window.history.pushState(null, '', hash);
    }
  }
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  });
  // Stable handlers keep the chapter DOM from re-rendering on every hover or scroll.
  const goRead = useCallback(
    (id: ContentId) => navigateRef.current('reading', id),
    [],
  );
  const goCity = useCallback(
    (id: ContentId) => navigateRef.current('city', id),
    [],
  );
  const goExplore = useCallback(
    () => navigateRef.current('city', 'overview'),
    [],
  );
  const startReading = useCallback(
    () => navigateRef.current('reading', 'town-hall'),
    [],
  );
  const visitHome = useCallback((id: BuildingId) => {
    api.current?.select(id);
    api.current?.setFrameShift(wideRef.current ? 0.21 : 0);
  }, []);
  const accentBuilding = useCallback(
    (id: BuildingId | null) => api.current?.setAccent(id),
    [],
  );
  const select = (id: BuildingId) =>
    navigate(viewRef.current.mode, contentForBuilding(id));
  const openPark = () => navigate(viewRef.current.mode, 'corner-park');
  function tourStop(index: number) {
    setTour(index);
    navigate('city', contentForBuilding(stops[index]), { keepTour: true });
  }
  function togglePlan() {
    const next = !plan;
    setInspect(false);
    setPlan(next);
    api.current?.setPlan(next);
    if (!next && b) api.current?.select(b.id);
  }
  function inspectBuilding() {
    if (!b) return;
    setInspect(true);
    setPlan(false);
    setDirectory(false);
    api.current?.setPlan(false);
    api.current?.enter(b.id);
  }
  function exitInspection() {
    setInspect(false);
    if (b) api.current?.select(b.id);
  }

  // Address bar → view. An empty address opens the reading page at the top.
  // The scroll starts right here, not in a later effect that could fire on some
  // unrelated change: a page opened at an address jumps straight to it, a bare
  // address is left where it is, and Back/Forward glide to their place.
  useEffect(() => {
    let disposed = false;
    const sync = (first: boolean) => {
      if (disposed) return;
      const hash = window.location.hash;
      const next = hash
        ? parseLocation(hash)
        : { mode: 'reading' as const, content: 'overview' };
      applyView(next);
      if (next.mode === 'reading' && (hash || !first))
        scrollToContent(next.content, first);
    };
    const onHistory = () => sync(false);
    void Promise.resolve().then(() => sync(true));
    window.addEventListener('popstate', onHistory);
    window.addEventListener('hashchange', onHistory);
    const media = window.matchMedia(WIDE),
      onMedia = () => setWide(media.matches);
    onMedia();
    media.addEventListener('change', onMedia);
    return () => {
      disposed = true;
      window.removeEventListener('popstate', onHistory);
      window.removeEventListener('hashchange', onHistory);
      media.removeEventListener('change', onMedia);
    };
  }, [scrollToContent]);

  // The city loads once, lazily, and stays mounted across both modes.
  useEffect(() => {
    let disposed = false;
    import('./city-scene')
      .then(({ createCity }) => {
        if (disposed || !mount.current) return;
        api.current = createCity(
          mount.current,
          (id) =>
            navigateRef.current(viewRef.current.mode, contentForBuilding(id)),
          () => navigateRef.current(viewRef.current.mode, 'corner-park'),
          { onHover: (id) => setHovered(id) },
        );
        api.current.setDrift(true);
        setReady(true);
        setPaused(
          window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        );
      })
      .catch(() => {
        if (!disposed) setError(true);
      });
    return () => {
      disposed = true;
      api.current?.dispose();
      api.current = null;
    };
  }, []);

  // Explore mode: the address decides what the camera looks at.
  useEffect(() => {
    const engine = api.current;
    if (mode !== 'city') return;
    if (engine) {
      engine.setPlan(false);
      engine.reset();
      const destination = sceneTarget(content);
      if (destination.district)
        engine.focusBuildings(selectionForContent(content));
      else if (destination.park) engine.focusPark();
      else if (destination.building) engine.select(destination.building);
    }
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'auto' });
      document.getElementById('dossier-title')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, content, ready]);
  // Explore mode: the dossier takes the right-hand side, so the subject moves left.
  useEffect(() => {
    if (mode === 'city')
      api.current?.setFrameShift(panelOpen && wide ? 0.17 : 0);
  }, [mode, panelOpen, wide, ready]);

  // Reading mode: the chapter under the reading line drives the camera.
  useEffect(() => {
    if (mode !== 'reading') return;
    let raf = 0;
    const pick = () => {
      raf = 0;
      const line = window.innerHeight * (wide ? 0.42 : 0.52);
      let current: ContentId = 'overview';
      for (const section of document.querySelectorAll<HTMLElement>(
        '.chapter[data-chapter]',
      )) {
        if (section.getBoundingClientRect().top <= line)
          current = section.dataset.chapter as ContentId;
      }
      const lock = scrollLock.current;
      if (lock) {
        if (performance.now() < lock.until && current !== lock.chapter) return;
        scrollLock.current = null;
      }
      setActive((previous) => (previous === current ? previous : current));
      // Keep a deeper address (a person) while their chapter is the active one.
      // The address is checked now, not in the state update below: React may run
      // that later, after a click has already put a new address in the bar.
      const shown = window.location.hash
        ? parseLocation(window.location.hash)
        : null;
      if (
        shown?.mode === 'reading' &&
        readingChapter(shown.content) !== current
      )
        window.history.replaceState(null, '', `#read/${current}`);
      setView((previous) =>
        previous.mode !== 'reading' || chapterFor(previous.content) === current
          ? previous
          : { ...previous, content: current },
      );
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(pick);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [mode, wide]);
  useEffect(() => {
    const engine = api.current;
    if (mode !== 'reading' || !engine) return;
    const focusContent = chapterFor(content) === active ? content : active;
    engine.setYaw(bearings[active] ?? Math.PI / 4);
    if (active === 'overview') {
      engine.reset();
      engine.setYaw(bearings.overview);
      engine.setFrameShift(wide ? -0.06 : 0);
      return;
    }
    engine.setFrameShift(wide ? 0.21 : 0);
    const destination = sceneTarget(focusContent);
    if (destination.district)
      engine.focusBuildings(selectionForContent(focusContent));
    else if (destination.park) engine.focusPark();
    else if (destination.building) engine.select(destination.building);
    else engine.reset();
  }, [active, mode, ready, wide, content]);

  // The sky, the weather, the clock and the theme.
  useEffect(() => {
    api.current?.setSky({
      night,
      elevation: sky.elevation,
      azimuth: sky.azimuth,
    });
    document.documentElement.dataset.theme = night > 0.55 ? 'night' : 'day';
  }, [sky, night, ready]);
  useEffect(() => {
    api.current?.setRain(rain);
  }, [rain, ready]);
  useEffect(() => {
    api.current?.setPaused(paused);
  }, [paused, ready]);
  useEffect(() => {
    api.current?.setGrid(grid);
  }, [grid, ready]);
  // The tab names the chapter being read (in the city, the open place's chapter).
  const titleChapter = explore
    ? content === 'overview'
      ? 'overview'
      : chapterFor(content)
    : active;
  useEffect(() => {
    document.documentElement.lang = zh ? 'zh-CN' : 'en';
    const site = zh ? '刘家门' : 'LIU’S GATE',
      chapter = chapterMeta.find((c) => c.id === titleChapter);
    // The About chapter's title already names the group, so it uses its short label.
    document.title = chapter
      ? `${(chapter.id === 'town-hall' ? chapter.label : chapter.title)[locale]} · ${site}`
      : `${site} · ${zh ? '格拉斯哥大学' : 'University of Glasgow'}`;
  }, [zh, locale, titleChapter]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || mode !== 'city') return;
      if (inspect && b) {
        setInspect(false);
        api.current?.select(b.id);
      } else if (directory) setDirectory(false);
      else if (panelOpen) {
        setPanelOpen(false);
        document
          .querySelector<HTMLButtonElement>('[data-open-dossier]')
          ?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [mode, inspect, b, panelOpen, directory]);

  const ctl: StageController = {
    locale,
    mode,
    content,
    building: b,
    ready,
    error,
    hovered,
    sky,
    skyMode,
    rain,
    inspect,
    tour,
    plan,
    grid,
    paused,
    panelOpen,
    directory,
    zoom: (f) => api.current?.zoom(f),
    rotate: () => api.current?.rotate(),
    reset: () => (explore ? navigate('city', 'overview') : api.current?.reset()),
    cycleSky: () =>
      setSkyMode((m) => (m === 'auto' ? 'day' : m === 'day' ? 'night' : 'auto')),
    toggleRain: () => setRain((v) => !v),
    togglePlan,
    toggleGrid: () => setGrid((v) => !v),
    togglePause: () => setPaused((v) => !v),
    inspectBuilding,
    exitInspection,
    tourStop,
    closeTour: () => setTour(-1),
    togglePanel: () => setPanelOpen((v) => !v),
    toggleDirectory: () => setDirectory((v) => !v),
    select,
    openPark,
    navigate: (m, c) => navigate(m, c),
    focusDistrict: (id) => api.current?.focusDistrict(id),
  };

  return (
    <div className={`site ${explore ? 'mode-explore' : 'mode-reading'}`}>
      <a
        className="skip-link"
        href="#read/town-hall"
        onClick={(e) => {
          e.preventDefault();
          navigate('reading', 'town-hall');
        }}
      >
        {zh ? '跳过地图，直接阅读' : 'Skip the map and read'}
      </a>
      <Masthead
        locale={locale}
        mode={mode}
        active={explore ? chapterFor(content) : active}
        onNavigate={goRead}
        onToggleMode={() =>
          navigate(
            explore ? 'reading' : 'city',
            explore ? chapterFor(content) : content,
          )
        }
        onToggleLocale={() => setLocale(zh ? 'en' : 'zh')}
      />
      {error && explore && (
        <p className="scene-fallback" role="alert">
          {zh
            ? '城市暂时无法加载，全部资料仍可在阅读模式中访问。'
            : 'The city could not load. Everything is still available in reading mode.'}
        </p>
      )}
      <div className="scroll-story">
        <div className="stage-dock">
          <CityStage mount={mount} ctl={ctl} />
        </div>
        <div className="story">
          <Hero
            locale={locale}
            sky={sky}
            skyMode={skyMode}
            onExplore={goExplore}
            onRead={startReading}
            onOpen={goRead}
          />
          <Chapters
            locale={locale}
            onOpen={goRead}
            onVisit={visitHome}
            onHoverBuilding={accentBuilding}
            onExplore={goCity}
          />
        </div>
      </div>
      <SiteFooter locale={locale} onNavigate={(m, c) => navigate(m, c)} />
    </div>
  );
}
