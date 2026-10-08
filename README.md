# LIU’S GATE / 刘家门 — Urban Intelligence Group

格拉斯哥大学城市智能研究组（Urban Intelligence Group）的网站。研究组由 Pengyuan Liu 命名为「刘家门 / LIU’S GATE」，网站把这个名字做成了一座小城：每栋建筑对应研究组的一章内容，镜头随阅读走到对应的建筑。线上地址：<https://lylll9436.github.io/lius-gate-lab/>。

## 启动

```powershell
pnpm install
pnpm dev            # 本地开发（vinext）
pnpm build:pages    # 生成 GitHub Pages 静态站到 dist/pages
```

Node.js ≥ 22.13，依赖版本以 `pnpm-lock.yaml` 为准。只预览 Pages 版本也可以直接用 Vite：`node node_modules/vite/bin/vite.js --config vite.pages.config.ts`。

## 网站结构

- **阅读模式（默认）**：首屏是整座小城；向下滚动依次经过「关于研究组 / 成员 / 研究 / 成果与资源 / 研究组生活 / 关于名字」六章，右侧面板是正文，左侧小城的镜头走到对应建筑。地址形如 `#read/town-hall`、`#read/pengyuan-liu`。
- **小城视图**：全屏城市，可点击建筑、打开目录、城市导览、规划分区、建筑外观与室内剖面。地址形如 `#city/research-studio`。两种模式共用同一份内容与同一个三维场景，切换时当前内容保持不变。
- **真实天色**：小城按格拉斯哥当地时间作息（太阳方位、暮色、路灯与窗灯、市政厅钟面），页面主题随之切换深浅；可手动固定白天 / 夜晚，也可以让它下雨。
- 中英文完整切换，不混排；浏览器语言为中文时默认中文。

## 小城里有什么

中央广场上的拱门立在倒影池中，四条大道通向环路；北侧是带钟楼的市政厅，西侧是三户组成的新月联排（三位成员的家），东侧是玻璃研究工作室和带塔吊的预留地块，南侧港口旁是红砖档案馆、街角公园、码头、港湾里的小船和近海的灯塔。另有热气球、海鸥、有轨电车、行人、浮标和外围的山丘林地。七栋建筑都有室内，可在小城视图中剖开查看。

整座城约 20 万三角面、300 个左右绘制批次，带设备分级（低端设备降低像素比、阴影与多重采样）和帧率调节，目标是在大多数设备上流畅。

## 代码地图

| 文件 | 作用 |
| --- | --- |
| `app/page.tsx` | 页面状态、地址解析、两种模式、滚动驱动镜头 |
| `app/chapters.tsx` `app/site-chrome.tsx` `app/city-stage.tsx` | 首屏与章节、页眉页脚、舞台与 HUD |
| `app/lab-content.tsx` | 人员、研究、成果、活动等共用的内容组件 |
| `app/globals.css` | 设计系统：字体、昼夜主题、布局与响应式 |
| `app/town-plan.ts` | 小城规划：岛屿轮廓、山丘、街道、建筑位置、港口、植栽与路灯布置 |
| `app/town-build.ts` | 程序化建模：地形、街道、建筑与室内、树木、街具、车船、灯塔、热气球 |
| `app/city-scene.ts` | 渲染器、镜头、光照、昼夜 / 天气、悬停与点击、剖面查看 |
| `app/city-atmosphere.ts` | 格拉斯哥太阳位置、雨、海鸥 |
| `app/city-water.ts` `app/city-ink.ts` | 水面着色器与深度描边（算法参考 xi4u，MIT，见 THIRD_PARTY_NOTICES.md） |
| `app/city-materials.ts` `app/city-people.ts` `app/city-lighting.ts` `app/city-inspection.ts` `app/city-hover.ts` | 材质与合批、行人、路灯、剖面取景、悬停状态 |
| `app/city-data.ts` `app/city-districts.ts` `app/lab-navigation.ts` `app/lab-records.ts` `app/content-schema.ts` | 建筑文案、分区、地址与章节映射、内容目录与校验 |
| `content/lab.json` | 人员、研究、活动、成果、研究记录（见 MAINTENANCE.md） |

## 校验

```powershell
pnpm typecheck
pnpm check          # check-town、check-navigation、check-hover、check-content
pnpm build:pages    # 同时执行 check-pages
```

GitHub Actions 在 `main` 更新时执行以上步骤并发布 `dist/pages`。

## 设计参考

- [xi4u / 溪间四时](https://github.com/annac777/xi4u)：水面波纹与深度描边算法的参考与改写，许可见 THIRD_PARTY_NOTICES.md。
- 格拉斯哥的砂岩联排、哥特复兴市政建筑与港口仓库是小城建筑风格的来源；小城是艺术化场景，不是实地地图。
