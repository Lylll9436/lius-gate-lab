'use client';
import { useEffect, useRef, useState } from 'react';
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
import { Masthead, SiteFooter } from './site-chrome';
import { CityStage, type StageController } from './city-stage';
import { Hero, Chapters } from './chapters';

type View = { mode: BrowseMode; content: ContentId };
const stops = buildings.map((b) => b.id);
/** A different bearing for every chapter, so scrolling feels like walking. */
const bearings: Record<string, number> = {
  overview: Math.PI / 4,
  'town-hall': Math.PI / 4 + 0.42,
  people: Math.PI / 4 - 0.58,
  'research-studio': Math.PI / 4 + 1.02,
  'city-archive': Math.PI / 4 - 1.08,
  'corner-park': Math.PI / 4 + 0.22,
  'lius-gate': Math.PI / 4 - 0.18,
};
const WIDE = '(min-width: 961px)';

export default function Home() {
  const mount = useRef<HTMLDivElement>(null),
    api = useRef<CityAPI | null>(null),
    pendingScroll = useRef<ContentId | null>(null),
    viewRef = useRef<View>({ mode: 'reading', content: 'overview' });
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
    [interior, setInterior] = useState(false),
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
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  function applyView(next: View, keepTour = false) {
    setView(next);
    setInspect(false);
    setInterior(false);
    setPlan(false);
    setDirectory(false);
    if (!keepTour) setTour(-1);
  }
  function navigate(
    nextMode: BrowseMode,
    nextContent: ContentId,
    options: { keepTour?: boolean; replace?: boolean } = {},
  ) {
    applyView({ mode: nextMode, content: nextContent }, options.keepTour);
    if (nextMode === 'reading') pendingScroll.current = nextContent;
    const hash = `#${nextMode === 'city' ? 'city' : 'read'}/${nextContent}`;
    if (window.location.hash !== hash) {
      if (options.replace) window.history.replaceState(null, '', hash);
      else window.history.pushState(null, '', hash);
    }
  }
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
    setDirectory(false);
    api.current?.setPlan(false);
    api.current?.enter(b.id);
  }
  function exitInspection() {
    setInspect(false);
    setInterior(false);
    if (b) api.current?.select(b.id);
  }

  // Address bar → view. An empty address opens the reading page at the top.
  useEffect(() => {
    let disposed = false;
    const sync = () => {
      if (disposed) return;
      const hash = window.location.hash;
      const next = hash
        ? parseLocation(hash)
        : { mode: 'reading' as const, content: 'overview' };
      if (next.mode === 'reading') pendingScroll.current = next.content;
      applyView(next);
    };
    void Promise.resolve().then(sync);
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    const media = window.matchMedia(WIDE),
      onMedia = () => setWide(media.matches);
    onMedia();
    media.addEventListener('change', onMedia);
    return () => {
      disposed = true;
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
      media.removeEventListener('change', onMedia);
    };
  }, []);

  // The city loads once, lazily, and stays mounted across both modes.
  useEffect(() => {
    let disposed = false;
    import('./city-scene')
      .then(({ createCity }) => {
        if (disposed || !mount.current) return;
        api.current = createCity(
          mount.current,
          (id) => select(id),
          () => openPark(),
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
      engine.setFrameShift(panelOpen && wide ? 0.17 : 0);
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
  }, [mode, content, ready, panelOpen, wide]);

  // Reading mode: a requested address scrolls to its chapter or card.
  useEffect(() => {
    if (mode !== 'reading' || !pendingScroll.current) return;
    const id = pendingScroll.current;
    pendingScroll.current = null;
    const frame = requestAnimationFrame(() => {
      const target =
        document.getElementById(`read-${id}`) ??
        document.getElementById(`read-${chapterFor(id)}`);
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
        .matches;
      if (id === 'overview') window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
      else target?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      target?.querySelector<HTMLElement>('h2,h3')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, content]);

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
      setActive((previous) => (previous === current ? previous : current));
      // Keep a deeper address (a person) while their chapter is the active one.
      setView((previous) => {
        if (previous.mode !== 'reading') return previous;
        if (chapterFor(previous.content) === current) return previous;
        const hash = `#read/${current}`;
        if (window.location.hash && window.location.hash !== hash)
          window.history.replaceState(null, '', hash);
        return { ...previous, content: current };
      });
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
  useEffect(() => {
    document.documentElement.lang = zh ? 'zh-CN' : 'en';
    document.title = zh
      ? '刘家门 · 格拉斯哥大学城市智能研究组'
      : 'LIU’S GATE · Urban Intelligence Group';
  }, [zh]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || mode !== 'city') return;
      if (inspect && b) {
        setInspect(false);
        setInterior(false);
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
    interior,
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
    setInterior: (v) => {
      setInterior(v);
      api.current?.setInterior(v);
    },
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
        onNavigate={(id) => navigate('reading', id)}
        onToggleMode={() =>
          navigate(explore ? 'reading' : 'city', explore ? chapterFor(content) : content)
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
            onExplore={() => navigate('city', 'overview')}
            onRead={() => navigate('reading', 'town-hall')}
          />
          <Chapters
            locale={locale}
            onOpen={(id) => navigate('reading', id)}
            onVisit={(id) => {
              api.current?.select(id);
              api.current?.setFrameShift(wide ? 0.21 : 0);
            }}
            onHoverBuilding={(id) => api.current?.setAccent(id)}
            onExplore={(id) => navigate('city', id)}
          />
        </div>
      </div>
      <SiteFooter locale={locale} onNavigate={(m, c) => navigate(m, c)} />
    </div>
  );
}
