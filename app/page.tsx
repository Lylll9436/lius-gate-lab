'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BuildingId, Locale } from './city-data';
import type { DistrictId } from './city-districts';
import {
  chapterFor,
  parseLocation,
  buildingForContent,
  sceneTarget,
  selectionForContent,
  contentForBuilding,
  tourStops,
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
/** A different bearing for every chapter, each facing its subject's front. */
const bearings = chapterBearings;
const WIDE = '(min-width: 961px)';
/**
 * The city's code (three.js and the town) starts downloading as soon as this module runs,
 * alongside React's first render rather than after it. Still a dynamic import, so it stays
 * out of the first download. (No window: a server render has no city to build.)
 */
const cityScene =
  typeof window === 'undefined' ? null : import('./city-scene');
// A failed download is reported where the city is built; this only keeps it from being
// logged as unhandled before then.
cityScene?.catch(() => {});
/**
 * Reading mode: how long a chapter must stay under the reading line before the camera
 * follows it, so a quick scroll past several chapters turns the camera once, not each time.
 */
const CAMERA_SETTLE_MS = 200;
/** The reading camera's last shot: the whole island once the footer arrives. */
const READ_END = 'end';
/** How the town is placed as the reading page ends. */
function endFrame() {
  const dock = document.querySelector<HTMLElement>('.stage-dock'),
    footer = document.querySelector<HTMLElement>('.site-footer');
  if (!dock || !footer || dock.offsetHeight <= 0) return 0;
  // At the bottom of the page the footer has pushed the sticky stage up by this much,
  // so the island is fitted to the part of the stage still in view.
  const hidden = Math.max(
    0,
    dock.offsetHeight - (window.innerHeight - footer.offsetHeight),
  );
  return hidden / (2 * dock.offsetHeight);
}
/** The reading page's chapter for an address: the hero for the overview. */
const readingChapter = (id: ContentId) =>
  id === 'overview' ? 'overview' : chapterFor(id);
/** The bearing that shows a place from the front: its chapter's, as in reading mode. */
const facing = (id: ContentId) =>
  bearings[chapterFor(sceneTarget(id).building ?? id)] ?? bearings.overview;
/** City mode's camera for an address, Plan view off: the place from its front, or the island. */
function frameCity(engine: CityAPI, content: ContentId) {
  engine.setPlan(false);
  const destination = sceneTarget(content);
  engine.setYaw(facing(content));
  if (destination.district) engine.focusBuildings(selectionForContent(content));
  else if (destination.park) engine.focusPark();
  else if (destination.building) engine.select(destination.building);
  else engine.overview(true);
}
/**
 * City mode's subject offset, read from where the file and the controls actually are.
 * A side panel moves the subject left (a share of the stage width) to the middle of the
 * space left of the file, with a 16 px gutter. A bottom sheet (phones and tablets), or a
 * phone's own row of sky and camera bars, lifts it (a share of the stage height) to the
 * middle of the band between the masthead and the sheet or bars. `sheet` says the file is
 * a bottom sheet.
 */
function fileFrame(stage: HTMLElement | null) {
  const none = { shift: 0, drop: 0, sheet: false };
  if (!stage) return none;
  const frame = stage.getBoundingClientRect();
  if (frame.width <= 0 || frame.height <= 0) return none;
  const file = document.querySelector<HTMLElement>('.dossier'),
    box = file && !file.hidden ? file.getBoundingClientRect() : null,
    open = !!box && box.height > 0,
    side = open && box.width < frame.width / 2,
    sheet = open && !side,
    shift = side
      ? Math.min(0.3, Math.max(0, (frame.right - box.left + 16) / (2 * frame.width)))
      : 0;
  let bottom = sheet ? box.top : frame.bottom;
  // The bars only form a row of their own on phones; elsewhere they sit in the corners.
  const row = document.querySelector<HTMLElement>('.hud-row');
  if (row && getComputedStyle(row).display !== 'contents')
    bottom = Math.min(bottom, row.getBoundingClientRect().top);
  if (bottom >= frame.bottom) return { ...none, shift };
  const masthead =
      document.querySelector<HTMLElement>('.masthead')?.getBoundingClientRect()
        .bottom ?? frame.top,
    centre = (Math.max(frame.top, masthead) + bottom) / 2;
  return {
    shift,
    sheet,
    drop: Math.min(
      0,
      Math.max(-0.35, (centre - (frame.top + frame.bottom) / 2) / frame.height),
    ),
  };
}

export default function Home() {
  const mount = useRef<HTMLDivElement>(null),
    api = useRef<CityAPI | null>(null),
    // While the page scrolls itself to a chapter, the camera heads straight there
    // instead of visiting every chapter the scroll passes on the way.
    scrollLock = useRef<{ chapter: ContentId; until: number } | null>(null),
    viewRef = useRef<View>({ mode: 'reading', content: 'overview' }),
    wideRef = useRef(true),
    // On a narrow screen the Directory takes the file's place; closing it brings the file back.
    fileBeforeDirectory = useRef(false);
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
    // The footer has reached the town: the reading camera pulls back to the whole island.
    [ending, setEnding] = useState(false),
    // The reading camera's shot once the reading position has rested (see CAMERA_SETTLE_MS).
    [settledShot, setSettledShot] = useState<string>('overview'),
    [ready, setReady] = useState(false),
    [error, setError] = useState(false),
    [skyMode, setSkyMode] = useState<SkyMode>('auto'),
    [rain, setRain] = useState(false),
    [paused, setPaused] = useState(false),
    [plan, setPlan] = useState(false),
    // Plan view: the district in focus, or null for all four alike.
    [district, setDistrict] = useState<DistrictId | null>(null),
    [inspect, setInspect] = useState(false),
    [tour, setTour] = useState(-1),
    [panelOpen, setPanelOpen] = useState(true),
    // Phones: the file opens as a short sheet (title and actions); this shows all of it.
    [sheetFull, setSheetFull] = useState(false),
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
    fileBeforeDirectory.current = false;
    if (!keepTour) setTour(-1);
    // Every place picked in the city opens its file, even if the file was hidden; on a
    // phone it opens short, so the place itself stays in view above it.
    if (next.mode === 'city') {
      setPanelOpen(true);
      setSheetFull(false);
    }
  }
  /** The file and the Directory: side by side on wide screens, one at a time otherwise. */
  function togglePanel() {
    const next = !panelOpen;
    setPanelOpen(next);
    setSheetFull(false);
    if (next && !wide) {
      setDirectory(false);
      fileBeforeDirectory.current = false;
    }
  }
  function closeDirectory() {
    setDirectory(false);
    if (fileBeforeDirectory.current) {
      setPanelOpen(true);
      setSheetFull(false);
    }
    fileBeforeDirectory.current = false;
  }
  function toggleDirectory() {
    if (directory) return closeDirectory();
    // The Directory and Plan view's key are two ways through the town: one at a time.
    if (plan) setPlan(false);
    setDirectory(true);
    if (!wide) {
      fileBeforeDirectory.current = panelOpen;
      setPanelOpen(false);
    }
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
    setEnding(false);
    // A chosen chapter needs no settling: without this, coming back from the city would
    // first turn the camera toward the last chapter read, then back.
    setSettledShot(chapter);
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
    // The tour's first step is always one entry, even from its first stop, so Back ends it there.
    if (window.location.hash !== hash || options.keepTour) {
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
  const accentPlace = useCallback(
    (id: HoverTarget) => api.current?.setAccent(id),
    [],
  );
  const select = (id: BuildingId) =>
    navigate(viewRef.current.mode, contentForBuilding(id));
  const openPark = () => navigate(viewRef.current.mode, 'corner-park');
  /** The tour: its first stop is one step in the history, the rest replace it, so Back
   *  leaves the tour for wherever it started. */
  function tourStop(index: number) {
    const touring = tour >= 0;
    setTour(index);
    navigate('city', tourStops[index], { keepTour: true, replace: touring });
  }
  function togglePlan() {
    if (plan) return setPlan(false);
    setInspect(false);
    // Plan view shows the whole town: it ends a tour, and takes the Directory's place.
    setTour(-1);
    if (directory) closeDirectory();
    setPlan(true);
    setDistrict(null);
    api.current?.setPlan(true);
  }
  function focusDistrict(id: DistrictId) {
    // Picking the district in focus again shows all four.
    const next = district === id ? null : id;
    setDistrict(next);
    api.current?.focusDistrict(next);
  }
  function inspectBuilding() {
    if (!b) return;
    setInspect(true);
    setPlan(false);
    setDirectory(false);
    fileBeforeDirectory.current = false;
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

  // The city loads once and stays mounted across both modes. Its code is already on the way
  // (see cityScene); the town is built a phase at a time, so the page stays responsive.
  useEffect(() => {
    if (!cityScene) return;
    let disposed = false;
    cityScene
      .then(({ createCity }) =>
        disposed || !mount.current
          ? null
          : createCity(
              mount.current,
              (id) =>
                navigateRef.current(
                  viewRef.current.mode,
                  contentForBuilding(id),
                ),
              () => navigateRef.current(viewRef.current.mode, 'corner-park'),
              { onHover: (id) => setHovered(id) },
            ),
      )
      .then((city) => {
        if (!city) return;
        // Left while the town was going up: nothing will show it.
        if (disposed) return city.dispose();
        api.current = city;
        city.setDrift(true);
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

  // City mode hands the canvas every gesture; reading mode leaves scrolling to the page.
  useEffect(() => {
    api.current?.setCityMode(explore);
  }, [explore, ready]);
  // Explore mode: the address decides what the camera looks at. A pick turns the camera
  // (the shortest way) to its subject's front; the bare city is the whole island.
  useEffect(() => {
    const engine = api.current;
    if (mode !== 'city') return;
    if (engine) frameCity(engine, content);
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'auto' });
      // The tour keeps focus on its own buttons, so Next stays under the finger; the stop's
      // name is announced from the tour bar instead.
      if (document.activeElement?.closest('.tour-control')) return;
      document.getElementById('dossier-title')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, content, ready]);
  // The model follows Plan view's key: whatever turns Plan view off (its button, the Directory,
  // a pick, the tour, Inspect, reading mode, Back) takes the tints away, and in the city the
  // camera goes back to the open place, as a pick would frame it.
  const planShown = useRef(false);
  useEffect(() => {
    const was = planShown.current,
      engine = api.current;
    planShown.current = plan;
    if (plan || !was || !engine) return;
    engine.setPlan(false);
    if (mode === 'city' && !inspect) frameCity(engine, content);
  }, [plan, mode, content, inspect]);
  // A Directory row rings its place while pointed at; nothing stays ringed once it closes.
  useEffect(() => {
    if (!directory) api.current?.setAccent(null);
  }, [directory]);
  // A screen that narrows with both open (a tablet turned upright) keeps the Directory and
  // puts the file away, as opening the Directory there would; closing it brings the file back.
  useEffect(() => {
    if (!directory || !panelOpen) return;
    const media = window.matchMedia(WIDE),
      narrowed = () => {
        if (media.matches) return;
        fileBeforeDirectory.current = true;
        setPanelOpen(false);
      };
    media.addEventListener('change', narrowed);
    return () => media.removeEventListener('change', narrowed);
  }, [directory, panelOpen]);
  // Explore mode: the subject moves out from under the file, wherever the file is: left of a
  // side panel, above a phone's sheet. A sheet pulled up to read in full, or the Directory
  // standing in for the file on a narrow screen, leaves the camera where the file put it.
  useEffect(() => {
    if (mode !== 'city') return;
    const place = () => {
      const at = fileFrame(mount.current);
      if ((at.sheet && sheetFull) || (directory && !wide)) return;
      api.current?.setFrameShift(at.shift, at.drop);
    };
    place();
    const file = document.querySelector<HTMLElement>('.dossier'),
      watch = new ResizeObserver(place);
    if (file) watch.observe(file);
    window.addEventListener('resize', place);
    return () => {
      watch.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [mode, panelOpen, sheetFull, directory, wide, ready]);

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
      // The read-through ends on the whole island once the footer comes into view. (Even at
      // the bottom of the page the footer stays below the reading line on most screens, so
      // its arrival is the cue: the reader is then on the last chapter's closing lines.)
      const footer = document.querySelector<HTMLElement>('.site-footer');
      setEnding(
        !!footer && footer.getBoundingClientRect().top < window.innerHeight,
      );
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
  // The masthead follows the active chapter at once; the camera waits until the reading
  // position has rested on a chapter, so a flick through the page turns it once.
  const shot = ending ? READ_END : active;
  useEffect(() => {
    if (shot === settledShot) return;
    const timer = window.setTimeout(
      () => setSettledShot(shot),
      CAMERA_SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [shot, settledShot]);
  // The chapter the reading camera last framed. The address follows the reading line at once
  // but the camera only once it settles, so for a moment the address is already in the next
  // chapter: the camera then keeps its shot rather than fit the chapter being left again.
  const framedShot = useRef<string | null>(null);
  useEffect(() => {
    const engine = api.current;
    if (mode !== 'reading' || !engine) {
      framedShot.current = null;
      return;
    }
    if (settledShot === READ_END) {
      framedShot.current = READ_END;
      // Beside the last chapter's panel, in the part of the stage the footer leaves in view.
      engine.setFrameShift(wide ? 0.21 : 0, endFrame());
      engine.overview(true);
      return;
    }
    const chapter = settledShot,
      ahead = readingChapter(content) !== chapter;
    if (ahead && framedShot.current === chapter) return;
    framedShot.current = chapter;
    const focusContent = ahead ? chapter : content;
    engine.setYaw(bearings[chapter] ?? Math.PI / 4);
    if (chapter === 'overview') {
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
  }, [settledShot, mode, ready, wide, content]);

  // The People chapter names the three homes on the model while its camera is on them.
  useEffect(() => {
    api.current?.setHomeTags(mode === 'reading' && settledShot === 'people');
  }, [mode, settledShot, ready]);

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
      } else if (directory) closeDirectory();
      else if (sheetFull) setSheetFull(false);
      else if (panelOpen) {
        setPanelOpen(false);
        document
          .querySelector<HTMLButtonElement>('[data-open-dossier]')
          ?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [mode, inspect, b, panelOpen, sheetFull, directory]);

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
    district,
    paused,
    panelOpen,
    sheetFull,
    directory,
    zoom: (f) => api.current?.zoom(f),
    rotate: () => api.current?.rotate(),
    // Camera only: in the city the open file stays open.
    reset: () => (explore ? api.current?.overview() : api.current?.reset()),
    cycleSky: () =>
      setSkyMode((m) => (m === 'auto' ? 'day' : m === 'day' ? 'night' : 'auto')),
    toggleRain: () => setRain((v) => !v),
    togglePlan,
    togglePause: () => setPaused((v) => !v),
    inspectBuilding,
    exitInspection,
    tourStop,
    closeTour: () => setTour(-1),
    togglePanel,
    toggleSheet: () => setSheetFull((v) => !v),
    toggleDirectory,
    select,
    openPark,
    navigate: (m, c) => navigate(m, c),
    focusDistrict,
    accent: accentPlace,
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
            onHoverBuilding={accentPlace}
            onExplore={goCity}
          />
        </div>
      </div>
      <SiteFooter locale={locale} onNavigate={(m, c) => navigate(m, c)} />
    </div>
  );
}
