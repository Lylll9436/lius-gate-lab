import { islandOutline } from './island-footprint';

// Widths follow the land outline: a grassy lip, dry sand, a darker wet strip at the
// waterline, a pale shallow shelf under the water, then the drop to the sea bed.
export const shoreProfile = [
  { width: 0, height: 0.1, color: '#a3b684' },
  { width: 0.9, height: 0.097, color: '#cfc19c' },
  { width: 1.9, height: 0.09, color: '#ded1ad' },
  { width: 2.7, height: 0.08, color: '#c4b28c' },
  { width: 3.2, height: 0.066, color: '#b3aa8a' },
  { width: 4.4, height: -0.05, color: '#8db4a9' },
  { width: 6.2, height: -0.36, color: '#5c8c8d' },
] as const;
/** The waterline sits between these two bands; foam is drawn there. */
export const waterlineBands = { inner: 2.95, outer: 3.35, height: 0.079 };
export function shorePoint(
  i: number,
  width: number,
  height = 0,
): [number, number, number] {
  // Tangents span two neighbours on each side: wide outer bands then never fold at
  // the tight concave corners of the outline.
  const n = islandOutline.length,
    a = islandOutline[(i + n - 2) % n],
    b = islandOutline[(i + 2) % n],
    p = islandOutline[i % n];
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    length = Math.hypot(dx, dz),
    spread = 0.9 + 0.1 * Math.sin(Math.atan2(p[1], p[0]) * 3);
  return [
    p[0] + (dz / length) * width * spread,
    height,
    p[1] - (dx / length) * width * spread,
  ];
}
export const seaRoute = { x: 0, z: 28.5, w: 44, d: 4 };
