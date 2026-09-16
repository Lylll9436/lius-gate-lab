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
      'The name of our lab, given by Pengyuan Liu. A shared gateway into our people, research and ideas.',
      '由 Pengyuan Liu 为实验室命名的「刘家门」，是认识团队、研究与想法的共同入口。',
    ),
    style: t('Sandstone triumphal arch', '砂岩凯旋门'),
    architecture: t(
      'A walk-through stone arch anchors the civic axis and the four surrounding neighbourhoods.',
      '可穿行的石砌拱门，连接公共主轴与周围四个街区。',
    ),
    x: 6,
    z: 6,
    w: 2,
    d: 2,
    height: 5.7,
    model: 'gate',
    color: '#d7c49e',
    sections: [
      {
        heading: t('A name, a meeting place', '一个名字，一处相聚之地'),
        body: t(
          'Pengyuan Liu named our lab LIU’S GATE. Here, LIU’S GATE gives that name a place at the centre of our city. Our work in urban analytics begins with the people who come together here.',
          'Pengyuan Liu 为实验室起名「刘家门」。LIU’S GATE 将这个名字化为城市中央的一处地标。我们的城市分析研究，从在这里相聚的人开始。',
        ),
      },
      {
        heading: t('The city plan', '城市的规划'),
        body: t(
          'The civic quarter sits to the north, residential gardens to the west, the research campus to the east and the archive beside the southern waterfront. A walkable street network connects them through the central square.',
          '北侧为公共文化区，西侧为花园住区，东侧为研究园区，南侧档案馆连接滨水空间。连续的步行街网通过中央广场将它们串联。',
        ),
      },
      {
        heading: t('Explore together', '一起探索'),
        body: t(
          'Follow the city tour, select a building, or open the planning view to discover how the neighbourhoods fit together.',
          '跟随城市导览、选择一栋建筑，或打开规划视图，了解各个街区如何彼此连接。',
        ),
      },
    ],
    related: ['town-hall', 'pengyuan-liu', 'research-studio', 'city-archive'],
  },
  {
    id: 'town-hall',
    name: t('Town Hall', '市政厅'),
    short: t('The lab', '实验室'),
    category: t('ABOUT THE LAB', '关于实验室'),
    summary: t(
      'The shared home of our story, our questions and the city we are building together.',
      '记录团队的起点、共同的研究问题，以及我们一起建设的小城。',
    ),
    style: t('Gothic Revival', '哥特复兴'),
    architecture: t(
      'A sandstone tower, pointed windows and slate roofs draw on Glasgow’s historic university architecture.',
      '砂岩塔楼、尖拱窗与板岩屋顶，取意于格拉斯哥大学的历史建筑。',
    ),
    x: 4,
    z: 1,
    w: 2,
    d: 3,
    height: 7,
    model: 'hall',
    color: '#c8b18a',
    sections: [
      {
        heading: t('Our beginning', '我们的起点'),
        body: t(
          'This is the first year of our lab. Based at the University of Glasgow, our community brings together Pengyuan Liu and his students Yunlong Liu and Qin Li around urban analytics.',
          '这是实验室成立的第一年。我们在格拉斯哥大学开展城市分析相关研究，团队包括导师 Pengyuan Liu 及其学生 Yunlong Liu 和 Qin Li。',
        ),
      },
      {
        heading: t('Research in the city', '城市中的研究'),
        body: t(
          'Urban analytics is the focus of our work. The research district will introduce each project through its questions, methods, data and people as the team adds its research records.',
          '城市分析是我们的研究方向。随着团队补充研究记录，办公区将通过研究问题、方法、数据与参与成员介绍各个项目。',
        ),
      },
      {
        heading: t('A living history', '生长中的历史'),
        body: t(
          'The city begins with its founding members. New people and projects will find a place here, while completed research becomes part of the city archive. Architectural eras tell Glasgow’s story; the lab’s timeline starts with this first chapter.',
          '小城从创始成员开始。新成员与新项目将在这里找到自己的位置，已完成的研究则进入城市档案馆。建筑年代讲述格拉斯哥的故事；实验室的时间线从这一章起步。',
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
        role: t('LAB SUPERVISOR', '实验室导师'),
        summary: t(
          'Lab supervisor at the University of Glasgow.',
          '在格拉斯哥大学开展研究的实验室导师。',
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
          'Student of Pengyuan Liu at the University of Glasgow.',
          'Pengyuan Liu 的学生，在格拉斯哥大学开展研究。',
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
          'Student of Pengyuan Liu at the University of Glasgow.',
          'Pengyuan Liu 的学生，在格拉斯哥大学开展研究。',
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
            : 'Victorian red sandstone terrace',
        p.model === 'villa'
          ? '砂岩联排端户'
          : p.id === 'qin-li'
            ? '浅砂岩山墙住宅'
            : '维多利亚红砂岩联排',
      ),
      architecture: t(
        p.model === 'villa'
          ? 'A sandstone end terrace with a slate roof, a dormer and a deep bay window, facing the shared residential street.'
          : p.id === 'qin-li'
            ? 'A pale sandstone home with a front-facing gable, three sash windows, a round fanlight and a green entrance.'
            : 'A red sandstone terrace with a continuous bay, six-pane sash windows, fine iron railings and paired chimney pots.',
        p.model === 'villa'
          ? '朝向共享街道的砂岩联排端户，配以板岩屋顶、老虎窗、门廊与凸窗。'
          : p.id === 'qin-li'
            ? '浅色砂岩住宅，以朝街山墙、三联推拉窗、圆形门楣窗与绿色入口形成自己的表情。'
            : '红砂岩联排住宅，配有贯通凸窗、六格推拉窗、细铁栏杆与成对烟囱帽。',
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
        { heading: t('At the lab', '在实验室'), body: p.summary },
        {
          heading: t('Research & publications', '研究与成果'),
          body: t(
            'Research interests, project contributions and selected publications will be added here.',
            '研究兴趣、项目贡献与代表性成果将在此补充。',
          ),
        },
      ],
      related: ['town-hall', 'research-studio'] as BuildingId[],
    }),
  ),
  {
    id: 'research-studio',
    name: t('Research Studio', '研究工作室'),
    short: t('Research', '研究项目'),
    category: t('RESEARCH DISTRICT', '研究街区'),
    summary: t(
      'A place for the questions, methods and collaborations behind our research.',
      '展示研究问题、方法与合作过程的空间。',
    ),
    style: t('Contemporary campus', '现代校园建筑'),
    architecture: t(
      'Glazed workspaces and a planted roof introduce a contemporary layer to the sandstone city.',
      '玻璃工作空间与种植屋顶，为砂岩小城带来当代建筑的层次。',
    ),
    x: 10,
    z: 2,
    w: 2,
    d: 2,
    height: 4,
    model: 'studio',
    color: '#799c9b',
    sections: [
      {
        heading: t('Projects taking shape', '研究正在展开'),
        body: t(
          'The district is ready for the lab’s first project records. Each project will bring together a research question, methods, data, people and outputs. No project records have been published in this founding edition.',
          '街区已为实验室的首批项目记录预留位置。每个项目将整合研究问题、方法、数据、成员与成果。此创立版暂未发布具体项目记录。',
        ),
      },
      {
        heading: t('A district that grows', '逐渐发展的街区'),
        body: t(
          'As projects are added, new workspaces can occupy neighbouring plots. Completed projects will remain connected to their people and to the city archive.',
          '随着项目增加，新的工作空间可以入驻相邻地块。完成的项目仍将保留与参与成员及城市档案馆的联系。',
        ),
      },
    ],
    related: ['yunlong-liu', 'qin-li', 'city-archive'],
  },
  {
    id: 'city-archive',
    name: t('City Archive', '城市档案馆'),
    short: t('Archive', '档案馆'),
    category: t('COMPLETED RESEARCH', '研究成果'),
    summary: t(
      'The city’s collective memory: completed projects, publications and open resources.',
      '小城的共同记忆：已完成的项目、论文与开放资源。',
    ),
    style: t('Industrial heritage', '工业遗产改造'),
    architecture: t(
      'A red-brick storehouse with sawtooth rooflights, reimagined as a public archive.',
      '红砖仓库与锯齿形采光屋顶，被重新诠释为公共档案馆。',
    ),
    x: 10,
    z: 8,
    w: 2,
    d: 2,
    height: 3.4,
    model: 'archive',
    color: '#a96046',
    sections: [
      {
        heading: t('The first shelves are ready', '档案架已经就绪'),
        body: t(
          'There are no archived records in this edition yet. Completed research will be collected here with its authors, publication details and links to available code or data.',
          '此版本尚未收录档案。已完成研究将在这里汇集，附上作者、发表信息以及可用的代码或数据链接。',
        ),
      },
      {
        heading: t('Connected to the city', '与城市保持连接'),
        body: t(
          'Every record will link back to the people and research that produced it, preserving the story behind each contribution.',
          '每条记录都将链接回相关人员与研究项目，保留每项贡献背后的故事。',
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
        name: t('Garden residence', '花园住宅'),
        short: t('Residence', '住宅'),
        category: t('RESIDENTIAL QUARTER', '花园住区'),
        summary: t(
          'A residential address in our growing city.',
          '小城花园住区中的一处住所。',
        ),
        sections: [],
      };
});
