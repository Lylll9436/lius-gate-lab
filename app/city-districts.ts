import type { BuildingId, Locale } from './city-data';
export const CELL = 2.2,
  GRID_SIZE = 20;
export type DistrictId = 'civic' | 'residential' | 'research' | 'waterfront';
export const districts: {
  id: DistrictId;
  name: Record<Locale, string>;
  description: Record<Locale, string>;
  color: string;
  center: [number, number];
  size: [number, number];
  buildings: BuildingId[];
}[] = [
  {
    id: 'civic',
    name: { en: 'Civic quarter', zh: '公共文化区' },
    description: {
      en: 'Town Hall and the central gate, connected by the civic avenue.',
      zh: '市政厅与中央凯旋门，以公共主轴相连。',
    },
    color: '#d9bb79',
    center: [-5, -9],
    size: [13, 9],
    buildings: ['lius-gate', 'town-hall'],
  },
  {
    id: 'residential',
    name: { en: 'Residential gardens', zh: '花园住区' },
    description: {
      en: 'Sandstone homes, shared gardens and calm pedestrian streets.',
      zh: '砂岩住宅、共享花园与安静的步行街道。',
    },
    color: '#82ab73',
    center: [-9, 2],
    size: [11, 12],
    buildings: ['pengyuan-liu', 'yunlong-liu', 'qin-li'],
  },
  {
    id: 'research',
    name: { en: 'Research campus', zh: '研究园区' },
    description: {
      en: 'A modern studio, courtyard and reserved plots for future projects.',
      zh: '现代研究楼、庭院与为后续项目预留的地块。',
    },
    color: '#7fadb5',
    center: [9, -8],
    size: [11, 11],
    buildings: ['research-studio'],
  },
  {
    id: 'waterfront',
    name: { en: 'Archive & riverside', zh: '档案与滨水区' },
    description: {
      en: 'An industrial archive, a public promenade and the riverside park.',
      zh: '工业风档案馆、公共步道与河岸公园。',
    },
    color: '#c58f73',
    center: [8, 7],
    size: [12, 8],
    buildings: ['city-archive'],
  },
];
