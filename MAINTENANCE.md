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
- 研究额外字段：`status`（`active` / `completed`）、`people`、`buildingId`。`active` 进入研究工作室，`completed` 自动进入档案馆，并保留与成员和成果的关联。
- 活动额外字段：`date`（真实 YYYY-MM-DD）、`category`（`group-photo` / `celebration` / `milestone`）、`people`、`image`（`public/media/` 下的图片或 `null`）。活动按日期倒序进入街角公园。
- 成果（`outputs`）：`type` 为 `paper` / `dataset` / `software` / `report`，加 `date`、`people`、`researchId`、`buildingId`。研究记录（`notes`）同样有 `date`、`people`、`researchId`、`buildingId`。
- 研究工作室和档案馆还没有记录时，显示 `app/city-data.ts` 里写给访客的说明（`sections`）；发布第一条记录后说明自动隐藏。这些说明只写给访客，维护方法写在本文件里。
- 首屏「刘家门快讯」自动取最近 12 个月内的活动、成果与研究记录，按日期倒序最多 3 条（`app/lab-records.ts` 的 `recentNews`），过期自动下架，不用手动删除；一年内都没有新记录时，首屏卡片只保留「加入我们」。街角公园仍列出全部活动，日期按「3 Oct 2026」/「2026年10月3日」显示。
- 「加入我们」（首屏卡片与页脚）的邮箱取自导师记录里的 mailto 链接，并自动带上邮件主题「PhD enquiry — Liu’s Gate」/「博士申请咨询 — 刘家门」（`app/lab-records.ts` 的 `joinUsMailto`）。

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
- `app/town-*.ts` 读取规划生成几何，每类部件一个模块：`town-ground.ts` 地形与海岸、地面贴图；`town-streets.ts` 街道（路面、人行道、路缘、斑马线）与倒影池广场；`town-buildings.ts` 拱门、市政厅、研究工作室与档案馆，`town-homes.ts` 三位成员的住宅与背景小屋（墙体与屋顶在同一分组内合批）；`town-nature.ts` 树木、树篱、花坛、石楠与蓟；`town-props.ts` 街具（含自行车架的铁环）与塔吊；`town-harbour.ts` 码头、海滩小景与灯塔；`town-movers.ts` 热气球、电车、小船与自行车；`town-country.ts` 围栏牛群、水池里的鸭子与苏格兰小景（见下面几条）；建筑零件在 `town-kit.ts`，配色 `palette` 与公用布局在 `town-shared.ts`。行人（含骑车人和遛狗的人）来自 `app/city-people.ts`。`app/town-build.ts` 只负责装配：各模块的 `create*` 工厂接收同一个 `TownContext`（材质库、季节、`land`、路灯、时钟、动画列表），在地形之前全部调用；工厂本身除了路灯共用的那块灯罩玻璃，不新建任何材质或物体，因为 three 在深度相同时按 id 决定绘制先后，创建顺序一变画面就可能变。新部件放进对应的模块，再在装配部分加一行调用。页面代码只能引用 `town-plan.ts`，其余模块随 city-scene 懒加载（`check-pages` 会校验）。所有静态几何按材质家族合批（`town-batch.ts` 的 `batch()`）；需要动画的部件标记 `userData.keepSeparate`。
- 高地牛与苏格兰小景：`town-plan.ts` 的 `paddock`（干石墙中心线矩形，北墙开门）、`herd`（两头牛一头小牛，`heading`、`phase` 决定朝向与吃草节奏，减少动态效果时停在 time 0 的姿势）和 `hayRack`；`plantingPlan` 生成后再滤掉围栏里的那棵树，树的旋转、色调与季节都按 `id` 取种子，删一棵不影响其余。牛的长毛是几层柔和交叠的垂毛（`town-country.ts` 的 `shaggyCoat` 与 `drape`）：成年牛三层从脊背的分线向两侧垂下，外加一圈长短不齐、垂过腿上半截的下摆；每层的下缘是一排收尖的毛束，长短按 hash 错开，相邻两层错开半束；每层顶部压暗到 0.85（藏在上一层下面）、往下渐亮，毛梢只略向姜黄色过渡，每束色调差不超过 ±4%；法线是平滑的，层与层之间靠下缘微微翘起的阴影分开，而不是靠暗缝。躯干（`coatCore`）是一条“面包”形：最宽处仍是椭圆，顶部却是一条脊线（`SPINE`）而不是一个极点，所以毛从脊背向两边分开；绕极点包裹时毛束会从背上一点放射出来，像一颗洋蓟。不要改回一簇簇平面着色的楔形毛束：每束一面亮、根部一道暗缝，在“生活”一章和城市模式最大缩放（4）下就像木刨花或树皮瓦片，小牛像一头裹着树皮的猪；也不要只剩一个光滑的圆包，远看会像陶土做的普通黄牛。额前的长刘海是 `forelock`：两层，一层平贴头顶、从两角之间向前盖过额头的圆角，一层从额头边缘垂下、盖住眼睛直到口鼻上方，每束长短宽窄与张开角度都按 hash 错开、末端收尖，法线大幅偏向外侧（`soft`），所以整片刘海是一团柔和的毛而不是一片片亮面碎屑；直的毛束若从头顶斜着向前，要么在头顶竖成一道冠（小牛会像刺猬），要么为了让开额头而伸到脸前像一把梳子。小牛用自己的比例（`CALF`）：腿长、身子小而圆、头大一圈，只有一层短垂毛和一圈短下摆，额前同样有两层刘海（短一些），头顶只有两个半埋在刘海根部的小圆角芽（尖锥会像刺，露在光秃的头顶上又像一对眼睛），毛色是浅一点的姜黄；不要用粉色，也不要把它做成成年牛的缩小版，否则看起来像一头猪。干草架上的干草（`hayMound`）是一堆柔和起伏、平滑着色的草堆，上面横七竖八铺满细长的草秆，边缘垂下一圈草须，颜色取自黄铜与金色一族的麦秆金；不要改回一块多面体，那样会像一块淡色石头。架子南端旁有一捆小方草（`plan.hayBale`）：五片压实的草片拼成，草片之间的接缝就是草捆的横纹，两道浅色麻绳沿长边绕过顶面和两端，两端露出短草茬；不要改成一整块圆角方盒再横套两道深色带子，那样像一只手提箱，`check-town` 检查它在围栏内、不碰墙也不碰牛。牛群的悬停与点击通过 `parkHit` 下的隐形盒子归到街角公园（打开「生活」一章）。石楠（`heatherPlan`，季节色在 `town-nature.ts` 的 `heatherLook`）只长在四座山丘上，并与围栏保持 1.0 以上；每丛建成一张约 0.06 高的矮垫，外缘渐变到草色，上面密布许多小花枝（`heatherDrift`），不要改回几个大圆包，近看会像一堆卵石；蓟（`thistles`）贴着围栏南侧两角的墙脚。黑脸羊（`flock`）、立石圈（`stoneRing`、`standingStones`）和威灵顿像（`statueSpot`、`statueHeading`）也在规划里；挪动羊时注意首屏视角：羊若正好站在一棵树的后方，脚会落在树顶上，像站在树上（`check-town` 按首屏视角检查）；山坡上的道具用 `groundY()` 对建好的地形射线取高，不要直接用 `terrainHeight`（山顶网格比它低约 0.06）。野餐毯在 `parkGroup` 里，所以公园的选中描边会包含它。`check-town` 检查这些道具的位置与间距。
- 港口与海滩小景（`town-harbour.ts`）：位置都在 `town-plan.ts`。码头上的用码头本地坐标（`harbour`：x 横向、朝小屋为正，z 朝海；`pierPoint()` 换成世界坐标），沙滩上的用海岸坐标（`shoreProps`：轮廓采样序号 i 可带小数、离轮廓的宽度 w；`shoreAt()`、`shoreTurn()` 给出位置与朝海的转角，高度用 `town-ground.ts` 的 `shoreHeight(w)`），每件都写明占地半径 `foot`。小屋一侧是渔笼堆、单个渔笼、两只橙色浮子和一盘绳；小艇一侧是晾网架、浮木、海藻和样点 42 那块大石旁的两个礁石水洼（水洼只在靠陆的一侧围几块与海滩大石同色的石头，朝海开口；整圈同样大小的深色石头看起来像一排花或爪印）。小艇用两根缆绳系在 z 3.5 与 6.1 两根桩头的绳圈上（桩头绳圈用深色，浅色绳圈在首屏视角正好圈住码头尽头路灯的灯头，像光环）；绳子是两端开口的管子（套件里的 `rope`），两端必须埋进船体、桩、缆桩、木板或沙里。缆绳是静止的，因为小艇起伏很小，埋在船里的绳头才不露出来：改小艇的位置、起伏或船体大小后，`check-town` 会报绳头离开船体。大船从不停靠，所以码头尽头只放一个铁缆桩和一盘蓝绳；绳盘与缆桩的世界 x 相同，引绳沿世界 z 走，包围盒才不会被 `batch()` 当成檐板（宽、深都不小于 0.5 且厚 0.03–0.3 的实体会被当成檐板，让它下面的部件变暗），挪动其中一个要保持这一点（`check-town` 有检查）。晾网是不透光的一整片：镂空网眼在常用缩放下小于一个像素，平移时会闪，试过后去掉了。网片比横杆短、偏向一根柱子，两侧下垂时向外张开（朝向天空才不会整片背光发黑），带褶皱和长短不齐的下摆；做成正对镜头的平整深色矩形就会像两根柱子上的告示板。网片的背面直接做进几何体，所以它和其他布料一起合批，不需要双面材质或单独的着色程序（`check-town` 检查陆地上没有双面材质）。海滩的湿沙带在沙地着色器里（`city-materials.ts` 的 `SHORE_WET`），读海岸网格 uv.x 上写的离轮廓宽度：以后若再加别的 `sand` 面，uv.x 要写 0，否则也会变湿。地面贴图在水洼、渔笼、绳盘、晾网柱和浮木下各盖一块湿暗的沙（`town-ground.ts` 的 `shoreMasks`）。
- 街头小景：骑车人、遛狗的人和狗、拱门水池里的三只鸭子、研究工作室旁的自行车架。路线与位置都在 `app/town-plan.ts` 的街头小景一节（`cyclistLane`、`cyclistPose`、`dogLoop`、`dogWalkPose`、`ducks`、`bikeRack`）：骑车人在环路外侧靠左行驶，与电车同一圈速、相隔约半圈，时间 0（减少动态效果时停住的姿势）在「生活」一章的镜头里整辆车可见；遛狗路线是公园东侧草坪上的一小圈，不进公园、不上人行道。骑车人、遛狗的人和狗的朝向取 `samplePolyline` 的 `smooth`，在转角里均匀转过，而不是每到一个采样点跳一格（电车和环路上的行人仍取所在线段的朝向）。人物都是普通路人（`app/city-people.ts` 的 `createResident` 加 `look` 换衣色，`createDog`、`seatRider`、`pedalRider`），衣色低饱和、戴帽子或头盔，不对应任何成员，也不在住宅前停留；车架只停两辆车。车架立在研究工作室入口铺地的西侧（长椅与雨棚南柱之间），是工作室外壳的一部分：随工作室一起合批、描边和近看，悬停与点击都显示研究工作室；放在小城里的话，工作室被选中时它挡住的铺地会在描边上留出一圈圈缺口。其余几位都不接受悬停与点击，近看时随小城一起隐藏。`check-town` 检查路线的间距、鸭子不碰池底也不浮在水面上、踏板始终踩在曲柄圆上，以及这三位每帧转过的角度不超过真实弧线。
- 几何约定：同一高度的面不能重叠（否则闪烁）。路面 0.02、人行道与广场 0.06，装饰件至少高出 0.004；门与山墙封板须凸出墙面 / 屋顶端面 0.02 以上。
- 新增建筑：在 `town-plan.ts` 增加 `sites` 条目并保证不压到街道，在 `town-buildings.ts` 的 `createBuildings` 里写对应的 `build*` 函数并返回它，在 `town-build.ts` 装配部分的建筑循环里按 `model` 调用，然后在 `city-data.ts` 与 `content-schema.ts` 的 `buildingIds` 中登记。
- 造型与颜色：建筑零件（窗、门、屋顶、基座、隅石、烟囱）在 `app/town-kit.ts`，种植零件（花坛、树篱、造型灌木）在 `app/town-nature.ts`，配色 `palette` 在 `app/town-shared.ts`；材质的粗糙度、金属度和反光强度在 `app/city-materials.ts` 的 `finish`：`spec` 放大朝上的环境反光（顶面、圆角），`specFloor` 管朝下看到地面的那部分（竖直墙面），所以珐琅（enamel）墙面保持本色、只在圆角和顶面有光；珐琅的 `spec` 与 `specFloor` 都是 0.8，朝上的反光再加强，电话亭红顶面向镜头的一面就会发白偏粉。玻璃的反光带：合批时 `paneUV()` 把每块玻璃的窗格坐标写进 uv，`city-materials.ts` 的 `GLINT_PATCH` 让窗面法线自下而上逐渐上仰，只作用于环境光（反光和少量补光），阳光与路灯仍照在平的玻璃上，所以每块窗下暗上亮、拱窗的亮部落在拱顶；整面的玻璃幕墙标 `paneSpan`（整面一道渐变），钟面标 `flatGlass`（保持匀净）。强弱用 `finish.glass` 的 `spec`（上）与 `specFloor`（下）调，在 `?debug` 页面可用 `__city.model.materialLibrary.setSpec('glass', 上, 下)` 试；夜里只保留暖色窗光。铁、黄铜、珐琅只给小件道具用，砖石、粉墙和地面保持哑光；`roofKind()` 按屋顶颜色选石板、铜绿或釉面瓦。接触阴影与檐下阴影在合批时烘焙进顶点（`batch()` 的 bake），不要再加屏幕空间 AO，它会在树冠和细杆周围产生重影。地面的深色垫块、树影圆斑与草坪格纹来自 `buildGroundMasks` 生成的一张地面贴图，随规划数据自动更新。
- 整体饱和度：`app/city-scene.ts` 里的 `SATURATION`（当前 0.72），在最终合成里统一调整，改一个数即可；1 为调色板原色。三位成员的住宅是一排并列的联排（`app/town-plan.ts` 的 `terraceRow`），间距由 `spacing` 控制。联排两端的背景小屋（`cottages`）退到这条线后约 3 个单位并转向，`check-town` 会检查它们不接在联排的线上。阅读「成员」一章时，三栋住宅上方显示名字标签（`app/city-stage.tsx` 的 `home-tag`，由 `city-scene.ts` 的 `setHomeTags` 每帧投影到屋顶上方），悬停成员卡片只描边对应的那一栋。
- 住宅凸窗：三户门左侧 1.06 宽的格拉斯哥斜角砂岩凸窗由 `app/town-kit.ts` 的凸窗零件拼成（`bayOutline` 平面、`cantedPrism` 石体、`bayFaces` 正面与两侧斜面的分组、`sash` 窗：正面是 0.46 宽、带一道中横档的上下推拉窗，两侧斜面是 0.30 宽的单块窗（`single`，窗框只凸出 0.06，离门套留出一段石面）；窗框只有 0.05 宽、0.08 深，凸窗读作一面玻璃。不要改回 0.36 与 0.20 的窄窗配 0.08 宽、0.12 深的窗框：斜着看时窗框遮掉一半玻璃，凸窗像一摞窗框、`bayRoof` 小四坡石板屋顶），尺寸在 `app/town-homes.ts` 的 `bay`：浅砂岩别墅（`villa`）是单层凸窗加石栏杆（栏杆后的墙大半被主屋檐挡住，不开窗），红砂岩联排（`red-tenement`）两层直到主屋檐下，山墙住宅（`gabled-house`）两层加自己的石板小屋顶；凸窗不伸进前院与房屋之间的空隙，模型上不加文字或门牌。每块推拉窗玻璃都带 `userData.windowGroup`：`<id>-bay-0`（底层，另带 `windowLit`，夜里亮到最晚）、`<id>-bay-1`（上层，只有两层的凸窗才有），夜间窗灯按组共用一盏灯，以每组第一块玻璃（正面的下扇）为准，组名与这个顺序不要改。合批时标 `band` 的腰线和窗台线不算檐，标 `bayCap` 的凸窗檐口和小屋顶只压暗标 `bay` 的凸窗本身，主墙的檐下阴影不变；`check-town` 检查凸窗不穿出屋檐、不进前院、不碰门套、烘焙正确，并要求每户少于 6000 个三角面。
- 天气、时刻与季节：主光方向来自 `app/city-atmosphere.ts` 的 `sunOffsetFor`，白天抬高到 50–57°；真实太阳高度低于约 12° 时（`lowSun`，即清晨与黄昏前），主光降到约 40°，并在调色之前让主光与雾变暖（`city-scene.ts` 的 `sunGolden`、`fogGolden`）。手动「白天」不用真实太阳，而是固定的午后太阳（`app/use-sky.ts` 的 `sceneSky`、`DAYLIGHT_SUN`），黄昏或夜里切到白天也不会出现暮色暖光；主光的左右偏转在夜里经过正北时平滑回到基准方向，不会在午夜跳转。夜里海面上的月光反光（`app/city-water.ts` 的 `MOON_POSITION`，即首屏视角下的月亮位置）在 `placeSun()` 里和主光一样随视角转动：月亮若固定在世界里，按一次「旋转」后镜头正对月亮，整片海会被打成闪动的雪花点（`check-navigation` 逐个视角检查）。下雨时阴影变淡（`sun.shadow.intensity` 降到 0.35）、雨丝为 `#7f8f9c`；海鸥在雨中和夜里逐渐缩小隐去（`city-atmosphere.ts` 的 `gullPresence`）。树木按格拉斯哥的月份换季（`app/glasgow-sun.ts` 的 `glasgowSeason`，`town-nature.ts` 的 `treeLook`）：春季开花，秋季变色，夏季全绿，冬季是更沉的绿；地址加 `?season=spring|summer|autumn|winter` 可预览某一季。热气球在以岛心为圆心、半径 32 的圈上（`town-movers.ts` 的 `BALLOON`），不绕整圈，只沿首屏视角的远侧来回飘（`middle`、`reach`、`rate`）：从东北方海面出发，在首屏右上与左上的空处慢下来折返，中途从岛的上方出画，所以不会挡住各章主体，也不会飘到首屏文字与新闻卡后面。两端（环上角度 2.75 与 5.05）停在顶栏与首屏文字、新闻卡之间的空带里：在 1280×720 这类矮的宽屏上，首屏文字和新闻卡都伸得很高，摆幅再宽（2.45–5.15）就会停在眉题与标题后面，或沉到满三条带图新闻的卡片后面。`check-town` 把它投影到 1024×768 到 1920×1080 的十种常见宽屏首屏上检查（含待机摇摆 ±0.16），首屏文字框按各尺寸的实际排版留 8 px，新闻卡按最高的情形（三条带图，400 px）计；改了首屏排版或新闻卡样式要重新量这些框。热气球和全镇受同样的月光照明，但它是悬在最暗的海面上、没有阴影也没有地面压暗的大块浅色圆体，夜里看起来仍和白天一样亮，所以它的批处理网格用自己的材质副本（同一个着色程序），颜色随夜色压暗一半（`BALLOON_NIGHT_DIM`）；不加自发光，也不加光晕。
- 夜间窗灯：每块玻璃在合批时（`app/town-batch.ts` 的 `windowLight`）按它在世界中的位置取随机数，得到自己的一盏灯，烘进顶点属性 `aWindow`：亮度（不亮、昏暗 0.45、冷白 0.7、全亮）、色调（暖光、原先的 `#ffd29a`、淡冷白）、熄灯时刻和清晨亮灯时刻。各类建筑的比例在 `WINDOW_MIX`（住宅 `home`、市政厅与档案馆 `civic`、工作室 `studio`）：傍晚约三分之二的房间亮着（住宅 0.7、市政 0.65；只亮一半时市政厅和档案馆在自己的章节里几乎是黑的，整座城显得灰暗），22:00 以后才一扇扇熄灭；冷白只作点缀（约十分之一的亮窗，`check-town` 要求不超过 15%），一整条或一排冷白窗在暖光旁会像空白的灰板；钟面、灯塔窗、电话亭、电车与船的窗整夜亮着，塔吊驾驶室不亮（`WINDOW_FIXED`，在模型上用 `userData.window` 标记）。熄灯和亮灯的时刻全城不重复，所以不会有两扇窗同时熄灭；同一 `windowGroup` 的玻璃（凸窗的一层，档案馆屋顶的三排北向天窗）共用一盏灯。带 `userData.windowLit` 的窗（三户凸窗的底层；市政厅门上的扇形窗和塔楼窗、档案馆正面的一扇窗，亮度 0.8，所以每章的主体傍晚都有亮着的正面；以及亮度 0.8 的工作室玻璃盒，免得整块玻璃像灯罩）亮到 01:22 以后。带 `userData.nightLight` 的窗是一盏整夜不熄的昏暗暖灯（0.45）：三座正面朝向总览镜头的小屋（`plan.cottages` 的 `nightLight`）、市政厅东侧靠前的拱窗和档案馆背面中间的窗，所以 02:30 的小岛仍有几点暖光（`check-town` 要求 4–6 盏、至少分在三处）。时钟在 `app/glasgow-sun.ts`：`windowClock` 把格拉斯哥时间换成熄灯进度（22:00–02:30，到 02:30 约四成仍亮着，中国的访客多在这段深夜来看）与早起进度（05:30–07:30），正午复位；`followWindows` 让场景里的窗灯最多每 6.5 秒变一扇，每扇约 3 秒熄灭，只在天黑后前进，暮色里不动，时钟回拨时也不会重新亮起；正午复位在白天直接到位、看不见，手动夜晚里则以十倍速度（`RESET_RATE`）倒着走回去，夜里熄掉的窗一扇扇重新亮起、早起的窗一扇扇熄灭，不到三分钟走完，不会在同一帧里全部翻转；减少动态效果或时间跳过两小时以上时直接到位（标签页隐藏或小城滚出视野时不渲染帧，页面却仍每半分钟送来天色，所以也按距上一帧的时间算，`check-navigation` 检查）。页面把真实的 `hours` 随天色一起交给 `setSky`（手动夜晚也按真实时间），`?debug` 的 `state().paneClock` 可查看当前进度。着色器在 `app/city-materials.ts` 的 `WINDOW_VERTEX`，`windowLevel`、`windowGlow` 是给 `check-town` 用的 JS 对照，两边要一起改；任何窗都不比原先的窗光亮，光只留在玻璃上，没有光晕。调整时只改 `WINDOW_MIX` 的比例、亮度和色调；除了上面这几扇（各章主体的正面与深夜的几盏灯），不要挑选单扇窗。
- 规划视图的四个分区在 `app/city-districts.ts`：名称、说明（en / zh）、颜色与地面轮廓 `outline`。分区由 `city-scene.ts` 的 `buildDistrictZones` 画在路缘之上（`DISTRICT_LIFT`），打开规划视图时，图例列出每个分区的名称与说明（手机上是顶部一行可横向滑动的卡片）。移动建筑、公园或预留地块后，`check-town` 会检查每个分区仍然包住它说明里的地方、留在平地上、不碰海岸且互不重叠。高地牛的围栏也算在「港口与公园」里：牛群悬停与点击都归到街角公园，所以这个分区的轮廓向西南伸出一角把整个围栏包进去，规划视图里能点的地方都在某个分区的色块之内。
- 城市模式的目录与导览：目录每行写出这个地方装的是什么（`city-data.ts` 的 `category`），当前打开的地方标 `aria-current`，指向某一行会在模型上描边那栋建筑（`setAccent`）。导览的站点是 `app/lab-navigation.ts` 的 `tourStops`：七个地方按目录顺序，最后一站是街角公园；导览只在开始时记一条浏览历史，之后每站替换地址，焦点留在「下一站」上。城市模式里按 Esc 依次退出近看、关闭目录、规划视图和导览，最后才收起资料（`app/page.tsx` 的 keydown 处理）；再次选中已打开的地方也会重新取景。宽屏上资料打开时，导览条居中在资料左侧的空处，不会压到资料下面（`app/globals.css` 的 `--file-width` 与 `.has-file`）。打开目录会结束近看（和规划视图一样）；近看时焦点移到「返回城市」，退出后回到「查看建筑」。左上角的天色标签不在朗读区域里（时钟每分钟变化），只有悬停与近看的标签会被屏幕阅读器读出；天色按钮的名称写明当前模式。
- 界面玻璃：所有浮层共用 `app/globals.css` 的液态玻璃规则。色调由三个注册为颜色的属性组成（`@property` 的 `--glass-tint-a`、`--glass-tint-b`、`--glass-glow-a`），渐变在每个浮层上用它们拼出，所以昼夜切换时玻璃随页面一起渐变 1.2 秒；调玻璃颜色时改 `:root` 与夜间的这三个值，不要在 `:root` 里直接写渐变（那样会在切换时跳变）。玻璃背后的磨砂（`backdrop-filter` 的饱和度与亮度，白天 180% / 1.04，夜里 150% / 0.9）也一起渐变：普通规则里这些值必须写成字面量（有的 Safari 版本遇到 `backdrop-filter` 里的 `var()` 会整条丢掉），靠过渡 `backdrop-filter` 本身来渐变；只在 Chromium 生效的 `[data-lens]` 规则里带 `url()` 折射，无法插值，所以改用注册过的 `--glass-saturate`、`--glass-brightness` 渐变。新增玻璃浮层若有自己的 `transition`，要把这几项一并列上。
- `app/city-scene.ts` 负责渲染与交互：正交镜头与平滑过渡、阅读面板构图偏移（新取景自带偏移；取景之外的偏移变化由帧循环开头的 `followPanel` 在转向之前缓入，转向中不会横跳）、闲置漂移（减少动态效果时关闭；暂停、拖动或刚按过按钮时停在当前角度）、真实日照（`setSky`，收到第一次天色之前不绘制）、雨、悬停射线与标签、单栋建筑近看（近看的是复制的模型，钟表指针与风向标每帧跟随原模型）、设备分级与帧率调节（掉档后帧率回到接近刷新率或 50 fps 以上即回升）。路灯在黄昏加入场景会改变所有受光材质的着色器，`warmLighting` 在小城画出后于空闲时后台预编译这些版本，首次入夜不再卡顿。GPU 上下文丢失后恢复时，three 会重新上传普通贴图，但 PMREM 环境光是在 GPU 上烘焙的渲染目标，会变成全黑，所以 `contextRestored` 重新烘焙（`bakeStudio`）并立即重绘阴影；超过 4 秒仍未恢复则经 `onLost` 告诉页面，城市模式显示“无法加载”的提示，恢复后提示消失。`createCity` 的 API 由 `app/page.tsx` 调用。
- 加载不卡页面：`app/page.tsx` 在模块执行时就开始下载 city-scene（仍是动态 `import()`，不进首包）；`createCity` 是异步的，用 `buildTownInPhases` 分阶段建城，每个阶段（以及 PMREM 环境光之前）都把主线程交还浏览器。新增较重的建模或合批步骤时，在 `town-build.ts` 的装配部分加一个 `yield`，让单个阶段保持在几十毫秒内；`buildTown` 一次跑完全部阶段，供 Node 检查使用。

## 交付前检查

```powershell
pnpm typecheck
pnpm check
pnpm build:pages
```

`check-town` 在 Node 中生成整座小城，验证建筑位置、树木与街道的关系、船只航线、三角面预算、近看取景、可点击性、水面着色器、夜间窗灯（每扇窗自己的灯、整夜逐扇熄灭、清晨逐扇亮起、不比原先亮）、热气球航线（含首屏不挡文字）、三户凸窗（不穿出屋檐、不碰门套、每户三角面预算）、港口缆绳与海滩小景的间距、街头小景（骑车人、遛狗路线、鸭子、自行车架）的路线与间距、围栏里的干草捆、季节树色、晨昏的低角度主光、手动白天的固定太阳、夜里平滑经过正北的主光、海鸥的渐隐、首屏视角下没有羊站在树顶上，以及近看模型跟随的钟表与风向标；`check-navigation`、`check-hover`、`check-content` 验证地址解析、镜头动作（连按旋转不回摆、过渡中缩放、离开近看时缓出、暂停或拖动时漂移停住、阴影贴图更换后立即重绘、帧率调节的回升、第一次天色之前不绘制、数小时没有帧后窗灯直接到位、转向中面板偏移的改变不横跳、GPU 上下文恢复后重新烘焙环境光、月光反光随视角转动）、悬停与点选（拖出又拖回的平移不算点选；离开页面的悬停标签不再被液态玻璃保留）和内容增删改。这些检查不代替在目标设备上的视觉验收。

## GitHub Pages 发布

GitHub Actions 在 `main` 更新时执行校验与构建，上传 `dist/pages`。公开资源放在 `public/`，私人资料不要放进仓库。
