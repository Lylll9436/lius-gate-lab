import { landscapePaths, pathStation } from './city-path-plan';
import { onIsland } from './island-footprint';

export const landscapeScale = {
  metresPerUnit: 2.5,
  streetTreeSpacingMetres: 5,
  pitWidth: 0.48,
};
export const avenueRows = [
  {
    id: 'west-walk',
    axis: 'z',
    fixed: -14.9,
    positions: [-17.3, -15.3, -13.3, -3, -1, 1, 3, 5],
  },
  {
    id: 'east-walk',
    axis: 'z',
    fixed: 14.9,
    positions: [-17.3, -15.3, -13.3, -11.3, -9.3, -3, -1, 1, 3, 5],
  },
  { id: 'north-inner', axis: 'x', fixed: -3.95, positions: [-2, 2, 10, 12] },
  {
    id: 'north-outer',
    axis: 'x',
    fixed: -6.65,
    positions: [-10.9, -8.9, -1.4, 1.4, 5.2],
  },
  {
    id: 'south-inner',
    axis: 'x',
    fixed: 6.95,
    positions: [-12, -10, -8, -6, -4, -2, 2, 4, 12],
  },
] as const;
export const avenueTrees = avenueRows.flatMap((row) =>
  row.positions.map((at, i) => ({
    id: `avenue-${row.id}-${i}`,
    row: row.id,
    x: row.axis === 'x' ? at : row.fixed,
    z: row.axis === 'z' ? at : row.fixed,
    size: 0.63 + (i % 3) * 0.02,
  })),
);
export const treePits = avenueTrees.map((t) => ({
  id: 'pit-' + t.id,
  x: t.x,
  z: t.z,
  w: landscapeScale.pitWidth,
  d: landscapeScale.pitWidth,
}));
export const hash = (n: number) => {
  const v = Math.sin(n * 127.1 + 78.23) * 43758.5453;
  return v - Math.floor(v);
};
const wild: { id: string; x: number; z: number; size: number }[] = [];
for (let i = 0; i < 180 && wild.length < 23; i++) {
  const zone = i % 4,
    u = hash(i * 5 + 1),
    v = hash(i * 5 + 2);
  const x =
    zone === 0
      ? -21 + u * 42
      : zone === 1
        ? -24.8 + u * 2.4
        : zone === 2
          ? 22.4 + u * 2.4
          : -18 + u * 36;
  const z =
    zone === 0 ? -25 + v * 3 : zone === 3 ? 18.2 + v * 2.3 : -17 + v * 31;
  if (
    ![
      [0, 0],
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ].every(([dx, dz]) => onIsland(x + dx, z + dz))
  )
    continue;
  if (wild.some((t) => Math.hypot(t.x - x, t.z - z) < 2.1)) continue;
  wild.push({
    id: 'wild-tree-' + wild.length,
    x,
    z,
    size: 0.75 + hash(i + 81) * 0.3,
  });
}
export const wildTrees = wild;
// Planting follows path station and side; junctions and tree pits remain open.
export const shrubBeds: {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
}[] = [];
for (const path of landscapePaths)
  for (const side of [-1, 1])
    for (let distance = 1.5; distance < path.length - 1.5; distance += 1.45) {
      const p = pathStation(path, distance, side * (path.width / 2 + 0.46));
      if (
        [...avenueTrees, ...wildTrees].some(
          (t) => Math.hypot(t.x - p.x, t.z - p.z) < 1.15,
        )
      )
        continue;
      if (
        landscapePaths.some(
          (other) =>
            other.id !== path.id &&
            other.points.some(
              (q) => Math.hypot(q[0] - p.x, q[1] - p.z) < other.width / 2 + 0.5,
            ),
        )
      )
        continue;
      shrubBeds.push({
        id: `hedge-${path.id}-${side}-${Math.round(distance * 100)}`,
        x: p.x,
        z: p.z,
        w: 0.46,
        d: 0.46,
      });
    }
for (const row of avenueRows)
  for (let i = 1; i < row.positions.length; i++) {
    if (row.positions[i] - row.positions[i - 1] > 2.1) continue;
    const mid = (row.positions[i] + row.positions[i - 1]) / 2;
    const x = row.axis === 'x' ? mid : row.fixed,
      z = row.axis === 'z' ? mid : row.fixed;
    if (row.id === 'north-outer' || row.id === 'north-inner') continue;
    shrubBeds.push({ id: `hedge-${row.id}-${i}`, x, z, w: 0.38, d: 0.38 });
  }
export const rockGardens = [
  [-14.8, 17.8],
  [-3, 18.2],
  [9.8, 18.8],
  [19, 15.1],
  [-23, -13],
  [23, 5],
  [18, -23],
] as const;
