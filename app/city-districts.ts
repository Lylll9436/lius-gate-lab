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
      en: 'Town Hall, the plaza and the central gate, joined by the north avenue.',
      zh: '市政厅、中央广场与凯旋门，由北大道相连。',
    },
    color: '#d9bb79',
    center: [0, -8.5],
    size: [13, 9],
    buildings: ['lius-gate', 'town-hall'],
  },
  {
    id: 'residential',
    name: { en: 'The terrace', zh: '联排住宅' },
    description: {
      en: 'Three sandstone terrace houses side by side, with front gardens facing the ring road.',
      zh: '三栋并排的砂岩联排住宅，前花园面向环路。',
    },
    color: '#82ab73',
    center: [-21.5, 1],
    size: [10, 14],
    buildings: ['pengyuan-liu', 'yunlong-liu', 'qin-li'],
  },
  {
    id: 'research',
    name: { en: 'Research campus', zh: '研究园区' },
    description: {
      en: 'The glass studio, a courtyard and a reserved plot with its crane.',
      zh: '玻璃工作室、庭院与带塔吊的预留地块。',
    },
    color: '#7fadb5',
    center: [12.5, -5],
    size: [13, 11],
    buildings: ['research-studio'],
  },
  {
    id: 'waterfront',
    name: { en: 'Harbour & park', zh: '港口与公园' },
    description: {
      en: 'The brick archive, the corner park, the pier and the harbour boat.',
      zh: '红砖档案馆、街角公园、码头与港湾里的小船。',
    },
    color: '#c58f73',
    center: [4, 12.5],
    size: [26, 9],
    buildings: ['city-archive'],
  },
];
