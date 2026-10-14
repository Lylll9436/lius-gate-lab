import type { BuildingId, Locale } from './city-data';
export type DistrictId = 'civic' | 'residential' | 'research' | 'waterfront';
/**
 * The town's four districts, shown by Plan view: a tinted area on the model and a key that
 * names and describes each one. Pure data (the UI imports it; three.js stays out).
 * `outline` is the district's ground plan in world x/z, clockwise from above; corners are
 * rounded when drawn. Each outline stays on the flat part of the island, clear of the shore
 * and the hills (scripts/check-town.mjs checks it covers its places).
 */
export const districts: {
  id: DistrictId;
  name: Record<Locale, string>;
  description: Record<Locale, string>;
  color: string;
  outline: [number, number][];
  buildings: BuildingId[];
}[] = [
  {
    id: 'civic',
    name: { en: 'Civic quarter', zh: '公共文化区' },
    description: {
      en: 'Town Hall, the plaza and the central gate, joined by the north avenue.',
      zh: '市政厅、中央广场与刘家门，由北大道相连。',
    },
    color: '#dba443',
    outline: [
      [-5.6, -11.6],
      [5.6, -11.6],
      [5.6, 5.6],
      [-5.6, 5.6],
    ],
    buildings: ['lius-gate', 'town-hall'],
  },
  {
    id: 'residential',
    name: { en: 'The terrace', zh: '联排住宅' },
    description: {
      en: 'The three members’ homes in a row, front gardens facing the ring road.',
      zh: '三位成员的住宅排成一列，前花园面向环路。',
    },
    color: '#d98a92',
    outline: [
      [-25.2, -6.8],
      [-18, -6.8],
      [-18, 8.8],
      [-25.2, 8.8],
    ],
    buildings: ['pengyuan-liu', 'yunlong-liu', 'qin-li'],
  },
  {
    id: 'research',
    name: { en: 'Research campus', zh: '研究园区' },
    description: {
      en: 'The glass Research Studio and, across the ring road, a reserved plot with its crane.',
      zh: '玻璃外墙的研究工作室，以及环路对面带塔吊的预留地块。',
    },
    color: '#9a8bd8',
    outline: [
      [5.8, -11],
      [24.2, -11],
      [24.2, -1.4],
      [5.8, -1.4],
    ],
    buildings: ['research-studio'],
  },
  {
    id: 'waterfront',
    name: { en: 'Harbour & park', zh: '港口与公园' },
    description: {
      en: 'The brick archive, the corner park and the Highland cows’ paddock, the pier and the harbour boat.',
      zh: '红砖档案馆、街角公园与高地牛的围栏、码头与港湾里的小船。',
    },
    color: '#58a6cc',
    // The south-west corner takes in the Highland paddock: its herd answers the pointer as the
    // corner park, so Plan view tints it with the park.
    outline: [
      [-14.6, 5.9],
      [12.8, 5.9],
      [13.9, 17.6],
      [10.6, 20.6],
      [-8.0, 23.6],
      [-15.0, 23.6],
      [-15.0, 17.0],
    ],
    buildings: ['city-archive'],
  },
];
