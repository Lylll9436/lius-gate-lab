/**
 * The real Glasgow sun and clock, with no 3D dependencies.
 * The page reads it on first paint, so it must never import three
 * (directly or through another module); the 3D town loads lazily.
 */

const GLASGOW_LAT = (55.86 * Math.PI) / 180,
  GLASGOW_LON = -4.25;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export type SkyState = {
  /** Local wall-clock hours in Glasgow, e.g. 21.7 for 21:42. */
  hours: number;
  /** Solar elevation in radians (negative after sunset). */
  elevation: number;
  /** Solar azimuth in radians, 0 = north, clockwise. */
  azimuth: number;
  /** 0 = full daylight, 1 = night; civil twilight blends between. */
  night: number;
  /** Local time label, "21:42". */
  clock: string;
};

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

/**
 * The season in Glasgow, by meteorological month (March to May is spring), so the trees can
 * blossom or turn. `?season=spring|summer|autumn|winter` in the search string previews one.
 * Summer is the default when the month cannot be read.
 */
export function glasgowSeason(date = new Date(), search = ''): Season {
  const asked = new URLSearchParams(search).get('season');
  if (SEASONS.includes(asked as Season)) return asked as Season;
  const month = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', month: 'numeric' }).format(date),
  );
  if (!(month >= 1 && month <= 12)) return 'summer';
  return month >= 3 && month <= 5
    ? 'spring'
    : month >= 6 && month <= 8
      ? 'summer'
      : month >= 9 && month <= 11
        ? 'autumn'
        : 'winter';
}

/**
 * How far through the night the windows are: `out` is how many of the evening's lit panes
 * have gone out (each pane keeps its own point on it), `wake` how many early risers are up.
 */
export type WindowClock = { out: number; wake: number };
/** Puts a clock value 0.6 of the way through its byte: past that byte's fade (which ends at +0.51) and short of the
 * next byte's, so between moves every pane rests fully on or fully off. 0 and 1 stay exact. */
const settle = (v: number) => (v <= 0 ? 0 : Math.min(1, (Math.floor(v * 255) + 0.6) / 255));
/** The windows' night from Glasgow wall-clock hours, in whole bytes: `out` 0 → 1 from 22:00 to 02:30, `wake` 0 → 1
 * from 05:30 to 07:30. Both hold until noon and are 0 from noon to 22:00 (the reset happens unseen, in daylight). */
export function windowClock(hours: number): WindowClock {
  const n = (((hours + 6) % 24) + 24) % 24; // 0 at 18:00, 4 at 22:00, 18 at noon
  return n >= 18
    ? { out: 0, wake: 0 }
    : { out: settle(clamp((n - 4) / 4.5, 0, 1)), wake: settle(clamp((n - 11.5) / 2, 0, 1)) };
}
/** Per second: one byte (at most one pane) in 6.5 s, and one pane's 0.002-wide fade in 3.3 s. */
export const WINDOW_RATE = 0.0006;
/** One frame of the panes following the clock. In daylight they copy it, unseen. The noon reset copies it too, even in
 * Manual night: it is the only drop over 0.5, since DST's is at most 0.23. Through twilight they hold, so none goes out
 * at dusk or comes on at dawn. Otherwise they only move forward: at once with reduced motion, else at WINDOW_RATE. */
export function followWindows(state: WindowClock, goal: WindowClock, night: number, dt: number, snap: boolean) {
  if (night < 0.05 || goal.out < state.out - 0.5) {
    state.out = goal.out;
    state.wake = goal.wake;
    return;
  }
  if (night < 0.97) return;
  const step = snap ? Infinity : WINDOW_RATE * dt;
  state.out = Math.max(state.out, Math.min(goal.out, state.out + step));
  state.wake = Math.max(state.wake, Math.min(goal.wake, state.wake + step));
}

/** Approximate solar position for Glasgow at a given instant. */
export function glasgowSky(date = new Date()): SkyState {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .filter((p) => p.type === 'hour' || p.type === 'minute')
      .map((p) => [p.type, Number(p.value)]),
  ) as { hour: number; minute: number };
  const hours = (parts.hour % 24) + parts.minute / 60;
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = (date.getTime() - start) / 86400000;
  const declination =
    ((23.44 * Math.PI) / 180) *
    Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81));
  const solarHours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    GLASGOW_LON / 15 +
    (9.87 * Math.sin((4 * Math.PI * (dayOfYear - 81)) / 364) -
      7.53 * Math.cos((2 * Math.PI * (dayOfYear - 81)) / 364) -
      1.5 * Math.sin((2 * Math.PI * (dayOfYear - 81)) / 364)) /
      60;
  // Wrapped to -180..180 degrees: the UTC hour wraps at midnight, before solar midnight in
  // Glasgow, and an unwrapped angle there would put the sun on the wrong side of north.
  const hourAngle =
    (((((((solarHours - 12) * 15) % 360) + 540) % 360) - 180) * Math.PI) / 180;
  const sinElevation =
    Math.sin(GLASGOW_LAT) * Math.sin(declination) +
    Math.cos(GLASGOW_LAT) * Math.cos(declination) * Math.cos(hourAngle);
  const elevation = Math.asin(clamp(sinElevation, -1, 1));
  const cosAzimuth =
    (Math.sin(declination) - Math.sin(elevation) * Math.sin(GLASGOW_LAT)) /
    Math.max(1e-6, Math.cos(elevation) * Math.cos(GLASGOW_LAT));
  let azimuth = Math.acos(clamp(cosAzimuth, -1, 1));
  if (hourAngle > 0) azimuth = 2 * Math.PI - azimuth;
  const degrees = (elevation * 180) / Math.PI;
  const night = clamp((6 - degrees) / 12, 0, 1);
  return {
    hours,
    elevation,
    azimuth,
    night: night * night * (3 - 2 * night),
    clock: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
  };
}
