import type { Building } from './city-data';
export const spacingRules = {
  buildingGap: 1,
  asphaltSetback: 0.35,
  pavementSetback: 0.25,
};
export const placement: Record<string, readonly [number, number]> = {
  'pengyuan-liu': [-11.2, -1.8],
  'yunlong-liu': [-9, -1.8],
  'qin-li': [-6.8, -1.8],
  'town-hall': [-4.3, -10.5],
  'research-studio': [8.8, -9.4],
  'street-house-0': [-13.1, -16],
  'street-house-1': [-11.3, -16],
  'street-house-2': [-9.5, -16],
  'street-house-3': [6.3, -16],
  'street-house-4': [8.1, -16],
  cafe: [17.6, 9.8],
  'lamp-1': [-7.4, -6.5],
  'tree-8': [12.3, 2.15],
  'lamp-7': [13, 10.05],
  'tree-5': [-3, -15.1],
};
export const terraces = [
  {
    id: 'founders-terrace',
    pitch: 2.2,
    units: ['pengyuan-liu', 'yunlong-liu', 'qin-li'],
  },
  {
    id: 'sandstone-row',
    pitch: 1.8,
    units: ['street-house-0', 'street-house-1', 'street-house-2'],
  },
  { id: 'east-row', pitch: 1.8, units: ['street-house-3', 'street-house-4'] },
];
export function terraceUnit(id: string) {
  const row = terraces.find((row) => row.units.includes(id));
  if (!row) return null;
  const index = row.units.indexOf(id);
  return {
    group: row.id,
    index,
    pitch: row.pitch,
    left: row.units[index - 1],
    right: row.units[index + 1],
  };
}
export function terraceNeighbours(a: string, b: string) {
  const unit = terraceUnit(a);
  return !!unit && (unit.left === b || unit.right === b);
}
export function buildingDimensions(b: Building) {
  const width = b.variant ? b.w * 2.2 : b.w * 2.2 - 0.45,
    depth = b.d * 2.2 - 0.6;
  const wallHeight =
    b.model === 'hall'
      ? 3.05
      : b.model === 'studio'
        ? 3.15
        : b.model === 'archive'
          ? 2.05
          : 2.65;
  return {
    width,
    depth,
    wallHeight,
    innerWidth: width - 0.2,
    innerDepth: depth - 0.2,
    frontStep: depth / 2 + 0.64,
  };
}
export type PlanRect = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};
export function planarGap(a: PlanRect, b: PlanRect) {
  return Math.hypot(
    Math.max(0, a.minX - b.maxX, b.minX - a.maxX),
    Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ),
  );
}
