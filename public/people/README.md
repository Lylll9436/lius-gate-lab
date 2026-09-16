# 人员照片

照片位已在城市资料面板与常规阅读模式中共用。未提供照片时显示明确的「照片待补充」占位，不请求不存在的图片。

把真实照片放到本目录，建议命名：

- `pengyuan-liu.jpg`
- `yunlong-liu.jpg`
- `qin-li.jpg`

然后在 `content/lab.json` 对应人员的 `photo` 字段，将 `null` 改成 `/people/pengyuan-liu.jpg` 等公共路径。支持 jpg、png、webp，路径扩展名与真实文件保持一致。`app/people-photos.ts` 仅为兼容导出，无需修改。添加新成员和扩展属性参见项目根目录 `MAINTENANCE.md`。

建议尺寸 800 × 1000 像素或更大，4:5 竖版，人物居中。网页使用 `object-fit: cover`，以中心裁切。
