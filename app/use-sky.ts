import { useEffect, useState } from 'react';
import { glasgowSky, type SkyState } from './city-atmosphere';
import type { Locale } from './city-data';

export type SkyMode = 'auto' | 'day' | 'night';

/** The real sky over Glasgow, refreshed every half minute and whenever the tab returns. */
export function useGlasgowSky(): SkyState {
  const [sky, setSky] = useState<SkyState>(() => glasgowSky());
  useEffect(() => {
    const tick = () => setSky(glasgowSky());
    tick();
    const timer = setInterval(tick, 30000);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return sky;
}

export function effectiveNight(sky: SkyState, mode: SkyMode) {
  return mode === 'auto' ? sky.night : mode === 'night' ? 1 : 0;
}

/** "21:42 · lamps on" — the city keeps Glasgow time. */
export function skyCaption(sky: SkyState, mode: SkyMode, locale: Locale) {
  const zh = locale === 'zh';
  if (mode === 'day') return zh ? '手动 · 白昼' : 'Manual · daylight';
  if (mode === 'night') return zh ? '手动 · 夜晚' : 'Manual · night';
  const degrees = (sky.elevation * 180) / Math.PI;
  const state =
    degrees < -6
      ? zh
        ? '路灯已亮'
        : 'lamps on'
      : degrees < 6
        ? zh
          ? '暮色'
          : 'twilight'
        : degrees < 15
          ? zh
            ? '低角度日光'
            : 'low sun'
          : zh
            ? '日光'
            : 'daylight';
  return `${sky.clock} · ${state}`;
}
