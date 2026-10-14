# LIU’S GATE / 刘家门

格拉斯哥大学刘鹏远老师带领的师门「刘家门 / LIU’S GATE」的网站。它不是正式的实验室或研究组，名字由刘鹏远老师取。网站把这个名字做成了一座小城：每栋建筑对应一章内容，镜头随阅读走到对应的建筑。线上地址：<https://lylll9436.github.io/lius-gate-lab/>。

## 启动

```powershell
pnpm install
pnpm dev            # 本地开发（vinext）
pnpm build:pages    # 生成 GitHub Pages 静态站到 dist/pages
```

Node.js ≥ 22.13，依赖版本以 `pnpm-lock.yaml` 为准。只预览 Pages 版本也可以直接用 Vite：`node node_modules/vite/bin/vite.js --config vite.pages.config.ts`。

## 网站结构

- **阅读模式（默认）**：首屏是整座小城，右侧是「刘家门快讯」新闻卡片；向下滚动依次经过「关于刘家门 / 成员 / 研究 / 成果与资源 / 师门生活 / 关于本站」六章，右侧面板是正文，左侧小城的镜头走到对应建筑。地址形如 `#read/town-hall`、`#read/pengyuan-liu`。
- **小城视图**：全屏城市，可点击建筑、打开目录、城市导览、规划分区、近看单栋建筑外观。地址形如 `#city/research-studio`。两种模式共用同一份内容与同一个三维场景，切换时当前内容保持不变。
- **真实天色**：小城按格拉斯哥当地时间作息（太阳方位、暮色、路灯与窗灯、市政厅钟面），页面主题随之切换深浅；可手动固定白天 / 夜晚，也可以让它下雨。
- 中英文完整切换，不混排；浏览器语言为中文时默认中文。

## 小城里有什么

中央广场上的拱门立在倒影池中，四条大道通向环路；北侧是带钟楼的市政厅，西侧是并排而立、彼此留有间距的三栋联排住宅（三位成员的家），东侧是玻璃研究工作室和带塔吊的预留地块，南侧港口旁是红砖档案馆、街角公园、码头、港湾里的小船和近海的灯塔。另有热气球、海鸥、有轨电车、行人、浮标和外围的山丘林地；还有几处苏格兰的小细节：西南干石墙围栏里的两头高地牛和一头小牛，山上的石楠与黑脸羊，西北岬角的立石圈，公园里的格子呢野餐毯，以及市政厅西侧戴着交通锥的威灵顿公爵骑马像。七栋建筑都可以在小城视图中单独近看外观。

造型借鉴《部落冲突》（Clash of Clans）：敦实夸张的比例、大屋顶与厚基座、粗框门窗、圆润的两色树冠；渲染取 C4D 式的干净柔和：工作室环境光、柔边阴影、烘焙在顶点上的接触阴影与檐下阴影、圆角几何、哑光材质，不描边。整体饱和度由一个调色参数统一压低到 0.72，呈现更克制的现代配色。整座城约 18.4 万三角面、270 个左右绘制批次，带设备分级（低端设备降低像素比与多重采样）和帧率调节，目标是在大多数设备上流畅。

## 代码地图

| 文件 | 作用 |
| --- | --- |
| `app/page.tsx` | 页面状态、地址解析、两种模式、滚动驱动镜头 |
| `app/chapters.tsx` `app/site-chrome.tsx` `app/city-stage.tsx` | 首屏与章节、页眉页脚、舞台与 HUD |
| `app/lab-content.tsx` | 人员、研究、成果、活动等共用的内容组件 |
| `app/globals.css` | 设计系统：字体、昼夜主题、布局与响应式 |
| `app/fonts.css` | 自托管字体（Fontsource 的 Fraunces、Inter、IBM Plex Mono），不依赖 Google Fonts；不要在 globals.css 里 @import（check-pages 会校验） |
| `app/town-plan.ts` | 小城规划：岛屿轮廓、山丘、街道、建筑位置、港口、植栽与路灯布置 |
| `app/town-build.ts` | 程序化建模：地形、街道、建筑、树木、街具、车船、灯塔、热气球 |
| `app/city-scene.ts` | 渲染器、镜头、光照、昼夜 / 天气、悬停与点击、单栋建筑近看 |
| `app/glasgow-sun.ts` | 格拉斯哥太阳位置、当地时间与季节；首屏直接使用，不得引入 three（check-pages 会校验） |
| `app/city-atmosphere.ts` | 雨、海鸥、主光方向（含晨昏的低角度日光） |
| `app/city-water.ts` `app/city-ink.ts` | 水面着色器；最终合成（多重采样、接触阴影、选中光圈），深度方法参考 xi4u，MIT，见 THIRD_PARTY_NOTICES.md |
| `app/city-materials.ts` `app/city-people.ts` `app/city-lighting.ts` `app/city-inspection.ts` `app/city-hover.ts` | 材质与合批、行人、路灯、近看取景、悬停状态 |
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

- [xi4u / 溪间四时](https://github.com/annac777/xi4u)：水面波纹与深度缓冲后期算法的参考与改写，许可见 THIRD_PARTY_NOTICES.md。
- 格拉斯哥的砂岩联排、哥特复兴市政建筑与港口仓库是小城建筑风格的来源；小城是艺术化场景，不是实地地图。
