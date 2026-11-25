# 赞助者头像

把头像图片放在 `src/assets/sponsors/` 即可，**不需要为了换头像发版**。

## 怎么生效

1. 图片随应用打包，首次打开致谢面板先显示本地图片（离线可用）。
2. 同时会从 GitHub raw 预加载 `src/assets/sponsors/` 下的同名文件；
   加载成功后替换成远程版本。
3. 所以换了头像只要 **替换文件并 push 到 `master`**，用户重启应用后即可看到新头像，
   不需要等新版本。GitHub raw 本身有几秒到几分钟缓存，刚 push 完可能需要稍等。

## 命名规则

文件名与 `src/data/sponsors.json` 里的 `name` 一致，**不区分大小写**，扩展名不限：

```
src/assets/sponsors/
├── 爱发电用户_WJDU.jpg
├── 47.png
├── 千里封冰.png
├── 晚风入墨.jpg
├── 我爱说实话.png
├── 小文哥.png
└── loristoki.jpg
```

支持 `png / webp / jpg / jpeg / avif / svg`（扩展名请用小写）。

> 本地匹配不区分大小写；但 GitHub raw 的路径是大小写敏感的。
> `sponsors.json` 的 `avatar` 文件名要和仓库里的实际文件名完全一致，
> 否则远程更新会失败（本地图仍会正常显示）。

新增赞助者时，在 `sponsors.json` 里写上文件名，即使本地还没打包也能直接走远程：

```json
{
  "name": "新赞助者",
  "plan": "supporter",
  "avatar": "新赞助者.png"
}
```

`avatar` 也支持：

- 本地 key：`"avatar": "千里封冰"`（对应同名图片）
- `public/` 路径：`"sponsors/foo.webp"`（随版本发布，不参与远程更新）
- 完整远程地址：`"https://..."`（需要把域名加入 CSP 的 `img-src`）

Contributors（共创者）可以直接用 GitHub 头像地址，例如：

```json
{
  "name": "ifer47",
  "plan": "contributor",
  "avatar": "https://avatars.githubusercontent.com/u/172476270?s=96&v=4"
}
```

`avatars.githubusercontent.com` 已经加入 CSP。远程头像没有本地兜底，离线时会显示首字徽章。

## 档位

`plan` 用稳定的 key，界面会按语言翻译。所有档位已经预置在客户端里，
以后只改 `sponsors.json` 并 push 就能换档，不需要发版。

| key | 中文 | English | 建议条件 | 视觉 |
|---|---|---|---|---|
| `supporter` | 支持者 | Supporter | 任意金额 / 一次性 | 默认灰 |
| `patron` | 同行者 | Patron | 累计 ≥ ¥50 或连续 3 个月 | 蓝色标签 + 圆点 + 蓝环 |
| `guardian` | 守护者 | Guardian | 累计 ≥ ¥200 或连续 12 个月 | 金色标签 + 菱形 + 金环 |
| `contributor` | 共创者 | Co-creator | 代码 / 文档 / 翻译 / 设计 / 推广 | 青色标签 + 方块 + 青环 |

金额阈值只是建议，按实际支持情况调整；不公开金额也可以。

```json
{ "name": "千里封冰", "plan": "guardian", "avatar": "千里封冰.png" }
```

- 旧文案 `"MarkerOn 支持者"`、`"支持者"`、`"Supporter"` 会自动按 supporter 处理。
- 未识别的 plan 会原样显示，并按 supporter 样式渲染。
- 早期支持者暂不作为独立档位，避免和金额档冲突；以后可以加 badge。

## 图片建议

- 正方形，**96×96** 或 **128×128**（界面显示 24×24，2x 屏最多 48px）
- 单张控制在 50KB 以内，优先 WebP
- 避免使用带透明边缘的大图，头像会被裁成圆形

## 加载失败时

没有对应文件、远程/本地加载失败，或远程列表新增了本地没有的赞助者时，
界面会自动显示「首字渐变徽章」（中文取首字，`47` 这类两位英文数字保留两位），
不会出现破图。

> GitHub raw 在部分网络环境可能不可访问。此时会继续使用打包的本地头像；
> 没有本地图就显示首字徽章，不影响离线使用。
