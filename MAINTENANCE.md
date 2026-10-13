# 网站维护说明

内容与三维小城分开维护：新增人员、研究、活动或成果不需要改模型。

## 日常内容入口

主文件：`content/lab.json`，分为 `people`、`research`、`events`、`outputs`、`notes`，`schemaVersion` 为 2。

| 字段 | 用途 |
| --- | --- |
| id | 稳定的小写英文编号，例如 `new-member`；改姓名或标题时保持编号 |
| title / summary | en、zh 两套文本；英文不得包含中文 |
| visibility | `draft` 不展示；`published` 展示 |
| order | 同一集合内的排序 |
| sections | 可增删的标题与正文段落 |
| properties | 可扩展的属性：唯一 key，加上双语 label 与 value |
| links | 双语链接标题和 HTTPS / mailto 地址 |

- 人员额外字段：`role`、`affiliation`、`photo`、`buildingId`。照片放在 `public/people/`，`photo` 填 `/people/文件名.jpg`，无照片用 `null`（页面显示姓名首字母的方块，颜色取自住所）。`buildingId` 只能是 `pengyuan-liu`、`yunlong-liu`、`qin-li` 三户之一或 `null`；为 `null` 时人员仍出现在成员章节，在小城中定位到联排住宅。
- 研究额外字段：`status`（`active` / `completed`）、`people`、`buildingId`。`active` 进入研究工作室，`completed` 自动进入档案馆。
- 活动额外字段：`date`（真实 YYYY-MM-DD）、`category`（`group-photo` / `celebration` / `milestone`）、`people`、`image`（`public/media/` 下的图片或 `null`）。活动按日期倒序进入街角公园。
- 成果（`outputs`）：`type` 为 `paper` / `dataset` / `software` / `report`，加 `date`、`people`、`researchId`、`buildingId`。研究记录（`notes`）同样有 `date`、`people`、`researchId`、`buildingId`。

## 修改方式

推荐用维护命令，会先校验再保存，并把旧目录备份到 `work/content-backups/`：

```powershell
pnpm content validate
pnpm content list people
pnpm content upsert people content/examples/person.json
pnpm content upsert research content/examples/research.json
pnpm content upsert events content/examples/event.json
pnpm content upsert outputs content/examples/output.json
pnpm content upsert notes content/examples/note.json
pnpm content remove events example-event
```

`upsert` 是整条替换，不是部分字段合并。删除或隐藏仍被已发布记录引用的人员会被拒绝。`content/examples/` 下是 draft 示例，不会进入网站。

内容地址示例：`#read/person:example-person`、`#city/research:example-research`。创始成员沿用 `#read/pengyuan-liu` 等短地址。

## 文案

建筑与章节文案在 `app/city-data.ts`（建筑介绍与各章正文段落）、`app/site-chrome.tsx`（章节标题与页脚）、`app/chapters.tsx`（首屏）、`app/lab-content.tsx`（空状态与按钮）。所有文案都有 en / zh 两份，切换语言时不混排。

## 小城模型

- `app/town-plan.ts` 是唯一的规划来源：岛屿轮廓（`islandRadius`，含东南港湾与西北岬角）、山丘（`terrainHeight`）、广场半径、环路与大道、七个建筑位置（`sites`，含朝向）、公园、预留地块、背景小屋、码头与船只航线、灯塔礁石，以及树木与路灯的生成规则。
- `app/town-build.ts` 读取规划生成几何：地形与海岸、街道（路面、人行道、路缘、斑马线）、倒影池广场、七栋建筑（墙体与屋顶在同一分组内合批）、树木、街具、塔吊、码头、灯塔、热气球、电车、小船与行人。所有静态几何按材质家族合批；需要动画的部件标记 `userData.keepSeparate`。
- 几何约定：同一高度的面不能重叠（否则闪烁）。路面 0.02、人行道与广场 0.06，装饰件至少高出 0.004；门与山墙封板须凸出墙面 / 屋顶端面 0.02 以上。
- 新增建筑：在 `town-plan.ts` 增加 `sites` 条目并保证不压到街道，在 `town-build.ts` 写对应的 `build*` 函数，然后在 `city-data.ts` 与 `content-schema.ts` 的 `buildingIds` 中登记。
- 造型与颜色：建筑零件（窗、门、屋顶、基座、隅石、烟囱）、种植零件（花坛、树篱、造型灌木）和配色 `palette` 都在 `app/town-build.ts`；材质的粗糙度在 `app/city-materials.ts` 的 `finish`。接触阴影与檐下阴影在合批时烘焙进顶点（`batch()` 的 bake），不要再加屏幕空间 AO，它会在树冠和细杆周围产生重影。地面的深色垫块、树影圆斑与草坪格纹来自 `buildGroundMasks` 生成的一张地面贴图，随规划数据自动更新。
- 整体饱和度：`app/city-scene.ts` 里的 `SATURATION`（当前 0.72），在最终合成里统一调整，改一个数即可；1 为调色板原色。三位成员的住宅是一排并列的联排（`app/town-plan.ts` 的 `terraceRow`），间距由 `spacing` 控制。联排两端的背景小屋（`cottages`）退到这条线后约 3 个单位并转向，`check-town` 会检查它们不接在联排的线上。阅读「成员」一章时，三栋住宅上方显示名字标签（`app/city-stage.tsx` 的 `home-tag`，由 `city-scene.ts` 的 `setHomeTags` 每帧投影到屋顶上方），悬停成员卡片只描边对应的那一栋。
- 天气、时刻与季节：主光方向来自 `app/city-atmosphere.ts` 的 `sunOffsetFor`，白天抬高到 50–57°；真实太阳高度低于约 12° 时（`lowSun`，即清晨与黄昏前），主光降到约 40°，并在调色之前让主光与雾变暖（`city-scene.ts` 的 `sunGolden`、`fogGolden`）。下雨时阴影变淡（`sun.shadow.intensity` 降到 0.35）、海鸥停飞、雨丝为 `#7f8f9c`。树木按格拉斯哥的月份换季（`app/glasgow-sun.ts` 的 `glasgowSeason`，`town-build.ts` 的 `treeLook`）：春季开花，秋季变色，夏季全绿，冬季是更沉的绿；地址加 `?season=spring|summer|autumn|winter` 可预览某一季。热气球绕岛心、沿半径 32 的圈在海岸与海面上空飞（`town-build.ts` 的 `BALLOON`），不会挡住各章的主体；`start` 让它从东北方海面出发，首屏打开时不在标题与导语后面。
- 规划视图的四个分区在 `app/city-districts.ts`：名称、说明（en / zh）、颜色与地面轮廓 `outline`。分区由 `city-scene.ts` 的 `buildDistrictZones` 画在路缘之上（`DISTRICT_LIFT`），打开规划视图时，图例列出每个分区的名称与说明（手机上是顶部一行可横向滑动的卡片）。移动建筑、公园或预留地块后，`check-town` 会检查每个分区仍然包住它说明里的地方、留在平地上、不碰海岸且互不重叠。
- 城市模式的目录与导览：目录每行写出这个地方装的是什么（`city-data.ts` 的 `category`），当前打开的地方标 `aria-current`，指向某一行会在模型上描边那栋建筑（`setAccent`）。导览的站点是 `app/lab-navigation.ts` 的 `tourStops`：七个地方按目录顺序，最后一站是街角公园；导览只在开始时记一条浏览历史，之后每站替换地址，焦点留在「下一站」上。
- `app/city-scene.ts` 负责渲染与交互：正交镜头与平滑过渡、阅读面板构图偏移、闲置漂移、真实日照（`setSky`）、雨、悬停射线与标签、单栋建筑近看、设备分级与帧率调节。`createCity` 的 API 由 `app/page.tsx` 调用。
- 加载不卡页面：`app/page.tsx` 在模块执行时就开始下载 city-scene（仍是动态 `import()`，不进首包）；`createCity` 是异步的，用 `buildTownInPhases` 分阶段建城，每个阶段（以及 PMREM 环境光之前）都把主线程交还浏览器。新增较重的建模或合批步骤时，在 `town-build.ts` 的装配部分加一个 `yield`，让单个阶段保持在几十毫秒内；`buildTown` 一次跑完全部阶段，供 Node 检查使用。

## 交付前检查

```powershell
pnpm typecheck
pnpm check
pnpm build:pages
```

`check-town` 在 Node 中生成整座小城，验证建筑位置、树木与街道的关系、船只航线、三角面预算、近看取景、可点击性、水面着色器、夜间窗灯、热气球航线、季节树色和晨昏的低角度主光；`check-navigation`、`check-hover`、`check-content` 验证地址解析、悬停行为和内容增删改。这些检查不代替在目标设备上的视觉验收。

## GitHub Pages 发布

GitHub Actions 在 `main` 更新时执行校验与构建，上传 `dist/pages`。公开资源放在 `public/`，私人资料不要放进仓库。
