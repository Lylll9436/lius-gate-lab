import { islandOutline } from './island-footprint';

// Widths follow the land outline, with a wider dry beach and shallow tidal shelf.
export const shoreProfile = [
  { width: 0, height: 0.1, color: '#c9bea0' },
  { width: 1.4, height: 0.094, color: '#d9cba9' },
  { width: 2.2, height: 0.076, color: '#c3b797' },
  { width: 3, height: 0.04, color: '#acaa8e' },
  { width: 4.2, height: -0.28, color: '#91a397' },
] as const;
export function shorePoint(
  i: number,
  width: number,
  height = 0,
): [number, number, number] {
  const n = islandOutline.length,
    a = islandOutline[(i + n - 1) % n],
    b = islandOutline[(i + 1) % n],
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
