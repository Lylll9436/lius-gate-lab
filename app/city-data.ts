import { peopleRecords } from './lab-records';
export type Locale = 'en' | 'zh';
export type BuildingId =
  | 'lius-gate'
  | 'town-hall'
  | 'pengyuan-liu'
  | 'yunlong-liu'
  | 'qin-li'
  | 'research-studio'
  | 'city-archive';
type Text = Record<Locale, string>;
export type Building = {
  id: BuildingId;
  name: Text;
  short: Text;
  category: Text;
  summary: Text;
  style: Text;
  architecture: Text;
  x: number;
  z: number;
  w: number;
  d: number;
  height: number;
  model: 'gate' | 'hall' | 'tenement' | 'villa' | 'studio' | 'archive';
  color: string;
  variant?: 'villa' | 'red-tenement' | 'gabled-house';
  sections: { heading: Text; body: Text }[];
  related: BuildingId[];
};
const t = (en: string, zh: string): Text => ({ en, zh });
const places: Building[] = [
  {
    id: 'lius-gate',
    name: t("LIU'S GATE", '刘家门'),
    short: t("LIU'S GATE", '刘家门'),
    category: t('CENTRAL LANDMARK', '中央地标'),
    summary: t(
      'The gate gives the group’s name a place at the centre of the city. The avenues to the other districts start here.',
      '拱门把研究组的名字放在小城中央，通往各区的大道由此出发。',
    ),
    style: t('Sandstone arch', '砂岩拱门'),
    architecture: t(
      'A sandstone arch standing on a reflecting pool, with the plaza and the avenues around it.',
      '立在倒影池上的砂岩拱门，四周是广场与大道。',
    ),
    x: 6,
    z: 6,
    w: 2,
    d: 2,
    height: 6,
    model: 'gate',
    color: '#d7c49e',
    sections: [
      {
        heading: t('The name', '名字'),
        body: t(
          'Pengyuan Liu named the group LIU’S GATE. The arch at the centre of the city stands for that name, and the rest of the city is arranged around it.',
          'Pengyuan Liu 为研究组取名「刘家门」。小城中央的拱门代表这个名字，其余部分都围绕它布置。',
        ),
      },
      {
        heading: t('Layout', '布局'),
        body: t(
          'The Town Hall (about the group) stands north of the plaza. The crescent of homes (people) is to the west, the Research Studio to the east, and the Archive and the corner park are by the harbour in the south.',
          '广场北侧是市政厅（研究组介绍），西侧是新月联排（成员），东侧是研究工作室，南侧港口旁是档案馆和街角公园。',
        ),
      },
      {
        heading: t('How to use the site', '使用方式'),
        body: t(
          'Scroll to read the chapters in order, or switch to the city view to click on buildings, follow the tour and open the cutaway views.',
          '向下滚动按顺序阅读各章，或切换到小城视图点击建筑、跟随导览、查看建筑剖面。',
        ),
      },
    ],
    related: ['town-hall', 'pengyuan-liu', 'research-studio', 'city-archive'],
  },
  {
    id: 'town-hall',
    name: t('Town Hall', '市政厅'),
    short: t('About', '关于'),
    category: t('ABOUT THE GROUP', '关于研究组'),
    summary: t(
      'The Urban Intelligence Group is a research group in urban analytics at the University of Glasgow, led by Pengyuan Liu.',
      '城市智能研究组是格拉斯哥大学一个从事城市分析的研究组，由 Pengyuan Liu 领导。',
    ),
    style: t('Gothic Revival', '哥特复兴'),
    architecture: t(
      'A sandstone hall with a clock tower. The clock keeps Glasgow time.',
      '带钟楼的砂岩市政厅。钟面显示格拉斯哥当地时间。',
    ),
    x: 4,
    z: 1,
    w: 2,
    d: 3,
    height: 9.5,
    model: 'hall',
    color: '#c8b18a',
    sections: [
      {
        heading: t('The group', '研究组'),
        body: t(
          'The group brings together Pengyuan Liu and the research students Yunlong Liu and Qin Li. It is based at the University of Glasgow and works on urban analytics.',
          '研究组由导师 Pengyuan Liu 与研究生 Yunlong Liu、Qin Li 组成，隶属格拉斯哥大学，研究方向为城市分析。',
        ),
      },
      {
        heading: t('Research focus', '研究方向'),
        body: t(
          'Urban analytics: using spatial data, statistics and computational methods to understand how cities work. Project pages will be added to the Research chapter as work is published.',
          '城市分析：用空间数据、统计与计算方法理解城市的运行。研究项目将随成果发表陆续加入「研究」一章。',
        ),
      },
      {
        heading: t('This site', '关于本站'),
        body: t(
          'The site is organised as a small city. Each chapter corresponds to a building, and completed work moves from the studio to the archive. All content is maintained in one catalogue file in the repository.',
          '本站按一座小城组织：每一章对应一栋建筑，完成的工作从工作室转入档案馆。全部内容由仓库中的一个目录文件统一维护。',
        ),
      },
    ],
    related: ['pengyuan-liu', 'research-studio'],
  },
  ...(
    [
      {
        id: 'pengyuan-liu',
        name: 'Pengyuan Liu',
        role: t('GROUP SUPERVISOR', '研究组导师'),
        summary: t(
          'Group supervisor at the University of Glasgow.',
          '格拉斯哥大学，研究组导师。',
        ),
        x: 1,
        z: 5,
        color: '#cfb28a',
        model: 'villa',
      },
      {
        id: 'yunlong-liu',
        name: 'Yunlong Liu',
        role: t('RESEARCH STUDENT', '研究生'),
        summary: t(
          'Research student supervised by Pengyuan Liu at the University of Glasgow.',
          '格拉斯哥大学研究生，导师 Pengyuan Liu。',
        ),
        x: 3,
        z: 5,
        color: '#b66d51',
        model: 'tenement',
      },
      {
        id: 'qin-li',
        name: 'Qin Li',
        role: t('RESEARCH STUDENT', '研究生'),
        summary: t(
          'Research student supervised by Pengyuan Liu at the University of Glasgow.',
          '格拉斯哥大学研究生，导师 Pengyuan Liu。',
        ),
        x: 3,
        z: 8,
        color: '#d5b88b',
        model: 'tenement',
      },
    ] as const
  ).map(
    (p): Building => ({
      id: p.id,
      name: t(p.name, p.name),
      short: t(p.name, p.name),
      category: p.role,
      summary: p.summary,
      style: t(
        p.model === 'villa'
          ? 'Sandstone end terrace'
          : p.id === 'qin-li'
            ? 'Gabled sandstone house'
            : 'Red sandstone terrace',
        p.model === 'villa'
          ? '砂岩联排端户'
          : p.id === 'qin-li'
            ? '山墙砂岩住宅'
            : '红砂岩联排',
      ),
      architecture: t(
        p.model === 'villa'
          ? 'A blonde sandstone terrace with a bay window, a dormer and a green front door.'
          : p.id === 'qin-li'
            ? 'A pale sandstone house with a front gable, a bay window and a dark red door.'
            : 'A red sandstone terrace with a bay window, a dormer and a blue front door.',
        p.model === 'villa'
          ? '浅砂岩联排，带凸窗、老虎窗和绿色大门。'
          : p.id === 'qin-li'
            ? '浅色砂岩住宅，带朝街山墙、凸窗和深红色大门。'
            : '红砂岩联排，带凸窗、老虎窗和蓝色大门。',
      ),
      x: p.x,
      z: p.z,
      w: 1,
      d: 2,
      height: 4.4,
      model: p.model,
      variant:
        p.model === 'villa'
          ? 'villa'
          : p.id === 'qin-li'
            ? 'gabled-house'
            : 'red-tenement',
      color: p.color,
      sections: [
        { heading: t('Role', '身份'), body: p.summary },
        {
          heading: t('Research and publications', '研究与成果'),
          body: t(
            'Research interests, projects and selected publications will be listed here.',
            '研究兴趣、项目与代表性成果将在此列出。',
          ),
        },
      ],
      related: ['town-hall', 'research-studio'] as BuildingId[],
    }),
  ),
  {
    id: 'research-studio',
    name: t('Research Studio', '研究工作室'),
    short: t('Research', '研究'),
    category: t('CURRENT RESEARCH', '进行中的研究'),
    summary: t(
      'Current research projects of the group: their questions, methods, data and people.',
      '研究组进行中的项目：研究问题、方法、数据与参与成员。',
    ),
    style: t('Contemporary campus', '当代校园建筑'),
    architecture: t(
      'A glass studio with a green roof and solar panels, next to a reserved plot for future projects.',
      '带种植屋面和太阳能板的玻璃工作室，旁边是为后续项目预留的地块。',
    ),
    x: 10,
    z: 2,
    w: 2,
    d: 2,
    height: 5,
    model: 'studio',
    color: '#799c9b',
    sections: [
      {
        heading: t('Projects', '项目'),
        body: t(
          'No project records have been published yet. Each project page will list its research question, methods, data, people and outputs.',
          '目前尚未发布项目记录。每个项目页面将列出研究问题、方法、数据、参与成员与成果。',
        ),
      },
      {
        heading: t('How records are added', '记录维护'),
        body: t(
          'Projects are added to the catalogue as records. When a project is marked completed it moves to the Archive automatically, keeping its links to people and outputs.',
          '项目以记录形式加入目录。项目标记为完成后自动转入档案馆，并保留与成员和成果的关联。',
        ),
      },
    ],
    related: ['yunlong-liu', 'qin-li', 'city-archive'],
  },
  {
    id: 'city-archive',
    name: t('City Archive', '城市档案馆'),
    short: t('Publications', '成果'),
    category: t('PUBLICATIONS & RESOURCES', '成果与资源'),
    summary: t(
      'Completed projects, publications, datasets and software from the group.',
      '研究组已完成的项目、论文、数据集与软件。',
    ),
    style: t('Industrial heritage', '工业遗产改造'),
    architecture: t(
      'A red-brick warehouse with a sawtooth roof, by the harbour.',
      '港口旁的红砖仓库，锯齿形屋顶。',
    ),
    x: 10,
    z: 8,
    w: 2,
    d: 2,
    height: 4.2,
    model: 'archive',
    color: '#a96046',
    sections: [
      {
        heading: t('Publications', '论文'),
        body: t(
          'No publications have been listed yet. Entries will include authors, venue, year and links to the paper, code or data.',
          '目前尚未列出论文。条目将包含作者、发表渠道、年份以及论文、代码或数据的链接。',
        ),
      },
      {
        heading: t('Open resources', '开放资源'),
        body: t(
          'Datasets and software released by the group will be listed here with their licences and links.',
          '研究组发布的数据集与软件将在此列出，并附许可证与链接。',
        ),
      },
    ],
    related: ['research-studio', 'town-hall'],
  },
];
// Building slots are independent of their current occupants.
export const buildings: Building[] = places.map((building) => {
  if (!building.variant) return building;
  const resident = peopleRecords.find((p) => p.buildingId === building.id);
  return resident
    ? {
        ...building,
        name: resident.title,
        short: resident.title,
        category: resident.role,
        summary: resident.summary,
        sections: resident.sections,
      }
    : {
        ...building,
        name: t('Crescent home', '新月住宅'),
        short: t('Home', '住宅'),
        category: t('THE CRESCENT', '新月联排'),
        summary: t(
          'A home in the crescent, currently unoccupied.',
          '新月联排中的一户住宅，目前无人居住。',
        ),
        sections: [],
      };
});
