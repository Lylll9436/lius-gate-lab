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

- 人员额外字段：`role`、`affiliation`、`photo`、`buildingId`。照片放在 `public/people/`，`photo` 填 `/people/文件名.jpg`，无照片用 `null`（页面显示姓名首字母的方块，颜色取自住所）。`buildingId` 只能是 `pengyuan-liu`、`yunlong-liu`、`qin-li` 三户之一或 `null`；为 `null` 时人员仍出现在成员章节，在小城中定位到新月联排。
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
- `app/town-build.ts` 读取规划生成几何：地形与海岸、街道（路面、人行道、路缘、斑马线）、倒影池广场、七栋建筑（外壳、屋顶、室内三个分组，供剖面查看）、树木、街具、塔吊、码头、灯塔、热气球、电车、小船与行人。所有静态几何按材质家族合批；需要动画的部件标记 `userData.keepSeparate`。
- 几何约定：同一高度的面不能重叠（否则闪烁）。路面 0.02、人行道与广场 0.06，装饰件至少高出 0.004；门与山墙封板须凸出墙面 / 屋顶端面 0.02 以上。
- 新增建筑：在 `town-plan.ts` 增加 `sites` 条目并保证不压到街道，在 `town-build.ts` 写对应的 `build*` 函数并调用 `furnishRoom`，然后在 `city-data.ts` 与 `content-schema.ts` 的 `buildingIds` 中登记。
- `app/city-scene.ts` 负责渲染与交互：正交镜头与平滑过渡、阅读面板构图偏移、闲置漂移、真实日照（`setSky`）、雨、悬停射线与标签、剖面查看、设备分级与帧率调节。`createCity` 的 API 由 `app/page.tsx` 调用。

## 交付前检查

```powershell
pnpm typecheck
pnpm check
pnpm build:pages
```

`check-town` 在 Node 中生成整座小城，验证建筑位置、树木与街道的关系、船只航线、三角面预算、室内与屋顶分组、可点击性、水面着色器和夜间窗灯；`check-navigation`、`check-hover`、`check-content` 验证地址解析、悬停行为和内容增删改。这些检查不代替在目标设备上的视觉验收。

## GitHub Pages 发布

GitHub Actions 在 `main` 更新时执行校验与构建，上传 `dist/pages`。公开资源放在 `public/`，私人资料不要放进仓库。
