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
