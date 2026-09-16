# 网站维护说明

此项目使用文件内容目录，适合由实验室维护者修改并重新构建。内容与三维建筑分开：新增人员、研究或活动不必先新增模型。当前没有远程管理后台；未来 CMS 或数据库适配器可复用下面的结构和校验接口。

## 日常内容入口

主文件：content/lab.json。内容分为 people、research、events、outputs、notes，schemaVersion 当前为 2；旧版 v1 可由 migrateCatalog 升级。

| 字段            | 用途                                                        |
| --------------- | ----------------------------------------------------------- |
| id              | 稳定的小写英文编号，例如 new-member；改姓名或标题时保持编号 |
| title / summary | en、zh 两套文本；英文不得包含中文                           |
| visibility      | draft 不展示；published 展示                                |
| order           | 同一集合内的排序数字                                        |
| sections        | 可增删的标题与正文段落                                      |
| properties      | 可扩展的属性：唯一 key，加上双语 label 与 value             |
| links           | 双语链接标题和 HTTPS / mailto 地址                          |

人员额外字段：role、affiliation、photo、buildingId。照片放在 public/people/，photo 填写 /people/文件名.jpg；无照片用 null。buildingId 为 null 时，人员仍出现在人员目录、阅读页面及资料面板，在城市中定位到花园住区。

研究额外字段：status 为 active 或 completed；people 为参与者 id 数组；buildingId 可为 null。active 自动进入研究楼，completed 自动进入档案馆。改状态即可归档，保留研究编号和链接。

活动额外字段：date 使用真实 YYYY-MM-DD 日期；category 为 group-photo、celebration 或 milestone；people 为人员编号数组；image 指向 public/media/ 下图片或为 null。活动按日期倒序进入街角公园。日期文本保持原样，不因访客时区变更。

内容集合初始仅包含真实的三位成员；研究、活动、成果、研究记录为空。examples/ 下的文件是 draft 示例，不会自动进入网站。

## 修改方式

可以直接编辑 JSON；更推荐用维护命令，先校验，再保存备份。执行位置为本项目目录。

- 检查全部内容与图片：pnpm content validate
- 查看人员：pnpm content list people
- 新增或完整替换人员：pnpm content upsert people content/examples/person.json
- 新增或完整替换研究：pnpm content upsert research content/examples/research.json
- 新增或完整替换活动：pnpm content upsert events content/examples/event.json
- 删除某条记录：pnpm content remove events example-event

upsert 是整条替换，不是部分字段合并。使用 list 取得现有记录后修改，可以避免漏掉原有字段。新记录先保持 draft，完善内容后改为 published。

每次命令修改会将旧目录备份到 work/content-backups/，验证通过后再替换主文件。删除被研究或活动引用的人员会被拒绝；应先调整对应记录的 people。隐藏一个仍被已发布记录引用的人员也会被拒绝。id 改名相当于新增与删除，需要同步关联。

恢复时从备份选择所需版本，复制回 content/lab.json，再执行 pnpm content validate。图片文件单独保留与备份。

开发预览会更新；静态发布版本需要重新构建。pnpm build 会先检查内容、建筑几何与间距，检查失败时不会继续生成发布版本。

## 数据与接口

- app/content-schema.ts：数据类型、validateCatalog、assertCatalog、upsertRecord、removeRecord；可复用在未来服务端。
- app/lab-records.ts：目录读取和 published 集合；getRecord 根据稳定地址查找记录。
- app/lab-navigation.ts：titleFor、chapterFor、buildingForContent、sceneTarget；统一两种浏览模式与场景映射。
- scripts/content.mjs：文件读写、校验、引用检查和修改前备份。
- app/lab-content.tsx：人员、研究、活动、任意 properties 和外部链接的共用展示组件。
- app/people-photos.ts：旧照片配置的兼容导出；请维护 JSON 中的 photo。

内容地址示例：#city/person:example-person、#read/research:example-research、#read/event:example-event。只有已发布且存在的记录能解析。旧的创始成员地址继续兼容；已删除的新记录地址安全回退至概览。

原有七个 buildingId 是稳定的场景位置，不是动态人员集合。一个住宅最多绑定一位人员；移除或迁走人员后，建筑恢复为中性住宅。新增人员可以先不绑定住宅。需要新增建筑时再扩展场景位置与模型，并执行间距检查。

未来接 CMS 时，只需在 lab-records 的目录加载入口提供同一 LabCatalog，校验后交给现有选择器和组件；不要把内容 id 直接传给三维模型选择函数。维护写操作只保留在本地命令或未来受保护的服务端，不放入公开网页。

## 城市规划规则

app/city-layout.ts 集中维护位置及 spacingRules。场景使用艺术化比例；city-planting-plan.ts 的 landscapeScale 约定 1 单位约为 2.5 米，用于统一住宅、街道与植栽的相对尺度，不代表实地测绘。

- 非相邻联排建筑的完整外包络净距至少 1.0。相邻联排须有同组与双向邻居关系，只有共墙允许零间距；实际几何仍须通过碰撞检查。
- 建筑至沥青铺装边缘至少 0.35。
- 建筑至公共步道边缘至少 0.25，包括机动车道路两侧的铺装。只有明确标记 accessTo 的短入口允许连接所属建筑的台阶；不能豁免其他建筑。
- 外包络包括屋檐、凸窗、门廊、台阶与排水管；不以墙体或裸地块边界代替。
- LIU’S GATE 是跨步道的地标，保留可穿行门洞；实体门墩另有碰撞检查。
- 灯、树、塔吊和街景物件仍需通过完整构件碰撞测试；塔吊活动范围必须留在所属施工地块。
- 调整建筑位置通过 placement 统一驱动模型、底座、标签、烟囱与定位目标，不在这些位置分别改坐标。

新增建筑或改变屋顶突出尺寸后运行 pnpm check:physics。检查包含背景街屋与咖啡亭，不只检查可点击主楼。

## 联排与模型细节

app/city-layout.ts 的 terraces 定义街排组、单位宽度和从左到右的顺序；placement 定义每户中心。terraceUnit 派生左右邻居，buildingDimensions 统一墙体、室内与前台阶尺寸。当前主住宅宽2.2、中心z=−1.8，正门朝+Z；背景街屋宽1.8。

- 新增相邻单元时保持中心间距等于单位宽度，内部边界不设侧窗、外挑檐口或雨管；端户按邻居配置恢复侧面细节。
- 共墙必须精确接触，不能用 allowInside 或跳过真实碰撞来掩盖交叠。入口短路与 visitNodes 必须同时连接到对应门前地址。
- 行人预留圈会按最近地址间距缩小，避免密排街址导致互相堵住。
- app/city-craft.ts 使用真实面片与顶点色生成石瓦、砌缝、窗格与树叶。叶片是柔性冠层，另做树冠与楼宇净空检查；树干、根部与树枝参与实际硬构件碰撞。
- app/city-materials.ts 按物理表面合并材质，保留颜色、法线、UV、粗糙度、金属度与纹理。关键构件显式传入 stone / wood / glass / metal / fabric 等类别；不要为了减少绘制次数重新合成一种哑光材质。程序纹理有 mipmap，场景卸载时由 disposeMaterials 释放。
- 墙体以 craft.wall 的洞口参数分割，玻璃位于外墙后；贴面砌缝也要避开洞口。共墙仍保持原有外边界。坡屋面约0.045厚，山墙使用石材独立封口；住宅斜角凸窗必须从勒脚连续支撑，不能悬浮。
- 树枝保留沿曲线的 UV 与闭合接缝法线，叶片左右两半保持同向。植物细节不能侵占步道或建筑；只对柔性叶面使用 softFoliage，树干和枝条不得跳过碰撞。
- 全城使用2048阴影图；独立建筑使用4096阴影图，进入独立模型时收紧阴影相机，退出时复原。描边与实际材质分开处理，不用像素放大替代建模。
- city-ink 使用实际 beauty depth，能正确跟随室内裁切；保留完整DPR，不添加模糊或放大像素。辅助线与接影平面禁写深度。
- 修改后运行 check:physics（含共墙、树冠、行人连续通行）及 check:inspection。参考渲染算法的许可随项目保存在 THIRD_PARTY_NOTICES.md。

## 地面与入口维护

app/city-ground.ts 是铺装范围和高度的统一来源。groundSurfaces 包含道路、步道和过街坡道；supportSurfaces 维护承托草坪。city-paving.ts 按道路并集边界拆分沥青、排水带、路缘及步道，只生成外露的高差侧面。groundHeightAt 为行人及街景落地提供同一高度。

- 先登记道路及坡道，再添加步道；subtract 自动裁去先前的表面和河道，当前无桥，不允许铺装进入近海航线。
- 步道顶面 0.20、沥青 0.14、土壤 0.10、水面 0.0725。过街口既有纵向坡面，也有侧翼过渡；不能重新叠放整块长条步道压住车道。
- 新入口从门前最后一段台阶连接至公共步道，accessTo 写所属稳定建筑 id。北側街屋、咖啡亭和施工地也要留出入口。
- 原始物件在局部坐标生成后按实际最低支承点落地；基础、栏杆横梁和塔吊分开处理。不要单独复制地面高度到动画中。
- pnpm check:physics 检查实际三角面与登记标高、铺装不重叠、入口及过街连通、河道没有被地面填住、行人路线没有高度突跳，以及车辆和脚底的承托。

建筑悬停文字由内容与街区配置派生，不能重新加成常驻地图按钮。pnpm check:hover 覆盖拖动、离开画布、室内、隐藏页面、触屏、双指和边缘位置；普通浏览与键盘导航继续使用目录。

## 室内与屏幕比例

室内屋顶按相机右方向停放并缩小展示，随旋转重新定位；画布宽高比小于 1.25 时收起屋顶。返回外观会恢复原位。镜头根据实际模型包围体适配，不使用固定放大倍数。

资料栏在空间足够时并排，宽度不够或屏幕较矮时顺着页面向下展开。人物列表按可用宽度自动排布。pnpm check:inspection 验证手机竖屏、平板、方形、横屏和超宽画布下的模型边界及屋顶分离；pnpm check:navigation 验证画布隐藏/恢复和双模式地址。

## 交付前检查

pnpm content validate
pnpm check:content
pnpm check:city
pnpm check:physics
pnpm check:detail
pnpm check:inspection
pnpm check:navigation
pnpm build

内容测试使用隔离的临时目录，验证新增成员、研究、活动、扩展属性和备份，不修改正式内容。这些检查不代替在目标设备上的浏览器视觉验收。


## 小岛、细节等级和动态资产

- island-footprint.ts 是唯一海岸边界。city-island.ts 从同一边界生成地面、干湿岸和水下缓坡；南侧草地直接延续主岛，没有独立陆块或桥。city-ground.ts 的 river 兼容导出表示南侧近海航行范围，不是分割岛屿的河道。
- crossings 是斑马线、配对坡道及连通检查的唯一位置来源。条纹平行车辆行驶方向，沿过街方向排列；新增过街点必须连接两侧人行道。
- city-detail.ts 根据屏幕投影高度选近景资产：树46 CSS px、建筑75 CSS px，回退阈值为进入阈值的68%。相机稳定180ms后，每40ms只安排一个模型；这不是后台线程或真正的GPU流式加载。缓存优先保留画面中央资产，最多8棵树、3栋建筑。
- 低档与高档由相同位置、尺寸和建筑参数生成。实体几何碰撞以完整模型检查；切档只替换显示资产，不重算路网或移动已有碰撞登记。高档销毁仅释放独有几何，共享材质和纹理由场景统一销毁。
- 独立查看前确保完整模型已生成；从街区锚点分离时保留世界位置。室内查看期间冻结细节切换，防止剖切对象引用的几何被缓存淘汰。
- city-streetcraft.ts 的车辆和船体按整体合并材质后移动，保留造型细节；city-people.ts 的身体、肩臂、髋腿和膝下分别合并，禁止再次对整个人物做静态合批。
- 步态以实际位移推进，相遇等待时恢复站姿；暂停时冻结关节。身体标高由鞋底支承计算，不能叠加独立正弦上下跳动。
- 烟雾已移除。未来重新加入应使用可信的透明体积/精灵方案，而非不透明球体。
- city-water.ts 保持独立物理材质，不能进入静态batch，否则会丢失shader钩子。波纹按世界XZ坐标生成，透明水面与海底均不写深度；海底随夜间状态调暗。
- city-lighting.ts 创建真实SpotLight照明，中央两盏使用512阴影。玻璃自发光由共享材质库setNight更新，室内裁切材质的克隆也同步更新。

check-detail 验证延迟模型、缓存抢占/取消/销毁、世界坐标、小岛承托、水面注入与昼夜参数，并报告本机模型生成耗时及网格数量。这些数字不代表网络加载时间、GPU帧率或浏览器视觉验收。


## 道路分层与植栽（第十二版）

- city-street-edges.ts 从路面的并集提取外边界，不能把每块道路矩形都当成独立路段。city-paving.ts 将路缘石裁入步道、排水带裁入道路，转角共用边界；分割后的顶面必须面积守恒、互不覆盖。
- 高差侧面要分别计算两个端点的邻面高度，尤其是过街坡道。等高的内部拼缝不生成侧壁；高差边分成石材与垫层。零面积三角面会在生成时剔除。
- avenueRows 定义种植轴线、固定坐标与允许的树位。正常株距为 2 单位（约 5 米）；入口、路口、成熟树及设施前的缺口是刻意保留。修改时同时检查最大近景树冠、树干与行人的通行包络。
- treePits 与 avenueTrees 共用坐标，铺装真实减去树池占地。铺装里的土面低于步道 0.016，草地上的薄覆盖土高于原地面 0.008；groundHeightAt 是统一查询。不要再在树根下面叠加完整铺装。
- 树池永久留在静态种植层。treeLods 只替换树木；近景根部按土面重新落地，不随枝条细分改变悬空高度。远景使用较少的根、分枝和叶片，近景保留完整构造。
- wildTrees 使用固定种子的散点，留出岸线与彼此距离；外侧灌木与岩石由 shrubBeds / rockGardens 维护。灌木的木质枝条与岩石参与硬构件碰撞，只有叶片是柔性冠层。枝根及岩石允许有限埋入土壤，并有明确的埋深检查。
- 南侧地形扩展至约 z=20，滨水步道位于 z=16.6，接入中央轴线和行人图；船线中心移至 z=24.5。扩大或缩小陆地时同步检查坡岸自交、所有铺装的支承和完整旋转船体。
- check-physics 自动调用 check-landscape，输出 work/physics-check/landscape-report.json。覆盖真实顶面的面积守恒、道路并集周长、树池空缺、坡道内部侧壁、岸线连续性及船体净距。


## 成果、研究记录与可复用场景

outputs 保存论文、数据、软件与报告（type: paper / dataset / software / report），notes 保存研究记录；均有 date、people、researchId（可为 null）、buildingId（可为 null），以及共用双语内容字段。成果默认进入档案馆，研究记录进入研究楼或关联项目的建筑。新增示例：`pnpm content upsert outputs content/examples/output.json`、`pnpm content upsert notes content/examples/note.json`。公开记录不能引用未发布或不存在的人员、项目；应先修改引用再删除。

- `city-path-plan.ts`：自然景观中的三次曲线路径；同一曲线同时驱动可见铺装、行走和沿路灌木。共享节点生成连接铺面，路口不会叠加面片。
- `city-shore.ts`：海滩宽度/高度剖面与船只航线；用连续岸线法向展开，而非复制方形底座。
- `city-planting-plan.ts`：行道树间距、树池和沿路径的灌木位置；随机林木仅放在外围。
- `city-craft.ts`、`city-streetcraft.ts`、`city-landscape.ts`：可重复调用的建筑细部、街具及种植构件；放置后登记碰撞范围。
- `buildCityModel({onlyBuilding, quality})` 与 `city-detail.ts`：复用同一建筑生成入口和近远景资源管理器，室内按需生成。新增资产需提供低细节、高细节工厂及卸载逻辑。
- `selectionForContent` / `focusBuildings`：内容到场景定位接口；高亮跟随当前 LOD 的可见几何，不复制整座建筑。

## GitHub Pages 发布

GitHub Actions 会在 main 更新时检查并构建静态网站；上传的只有静态发布目录。人员照片等公开资源放入 public，私人资料不要放在 public。网站本身不需要运行服务器或保存账号密码。内容维护和模型生成仍使用同一份源码。
