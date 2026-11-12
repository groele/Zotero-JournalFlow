# Zotero JournalFlow `v2.0.4`

**Zotero JournalFlow** 是一款专为 **Zotero 10–12**（`Gecko 140+ / 153+`）打造的现代化学术期刊订阅与文献发现插件，基于开源项目 [Lyz-623/JournalLens (`v0.3.9`)](https://github.com/Lyz-623/JournalLens) 按照 **Zotero Flow** 套件工程架构、视觉规范与质量标准全面重构。

---

## 核心功能

- **Crossref 期刊订阅**：在工作台侧栏按刊名或 ISSN 检索并关注期刊；首次安装默认预置 *Nature*、*Science*、*Cell*，并自动平滑迁移旧版 `extensions.journallens.journals` 订阅列表。
- **双模式工作台**：支持在 Zotero 主界面**内置标签页**或**独立桌面窗口**（`1180×780`）中打开，可在设置面板自由切换，并支持主工具栏按钮、工具菜单以及快捷键 `Ctrl+Alt+J` 一键唤起。
- **近期论文聚合与研究类过滤**：支持配置抓取天数（`1–180` 天，默认 `14` 天）与单刊上限（`10–500` 篇）；结合 Europe PMC 文献类型与标题启发式规则自动过滤新闻、社论、勘误、撤稿等非研究性内容。
- **多源摘要自动补全**：当 Crossref 缺失摘要时，按 Europe PMC（DOI + 标题检索）、Unpaywall 开放获取页面、Meta/JSON-LD 标签及出版商网页正文顺序自动补全。
- **正文大图懒加载与灯箱预览**：滚动时按需提取 Europe PMC `fullTextXML` 与 OA 页面的正文图与 Extended Figure，自动按像素尺寸过滤无效缩略图与封面图标；支持缩放、拖拽平移与键盘快捷键翻页（`←`/`→`/`+`/`-`/`0`/`Esc`）。
- **中英双语智能互译**：支持单篇或批量（3 路并发）翻译标题与摘要，支持 Google 翻译与 MyMemory 互为回退。
- **一键 DOI 入库**：直接调用 Zotero 原生 `Translate.Search` 将目标文献快速保存至本地文库。
- **独立文件每日缓存**：使用现代 `IOUtils` / `PathUtils` 将每日缓存持久化到 `<ZoteroDataDir>/journalflow-cache.json`，彻底告别旧版把海量 JSON 写入 `prefs.js` 的隐患。

---

## 架构与兼容矩阵

| 项目 | 规范说明 |
|---|---|
| **插件 ID** | `journalflow@groele.org` |
| **当前版本** | `v2.0.4` |
| **宿主兼容** | Zotero `10.0` – `12.*`（`Gecko 140+ / 153+`） |
| **构建体系** | TypeScript (`ES2023`, `strict`) + `esbuild` (`firefox140` IIFE，禁混淆保留可读堆栈) |
| **代码规范** | `src/` 全量 TypeScript、单文件严格 `<= 360` 行、Fluent `en-US` / `zh-CN` 键值严格对称 |
| **设置面板** | 对齐 Zotero Flow 40px 黄金网格与深浅双色自适应主题 |

---

## 本地构建与四层验证

```bash
npm install
npm run test      # 静态类型检查 + 架构守卫 + esbuild 打包 + 单元测试 + XPI 确定性自检
npm run package   # 输出 dist/zotero-journalflow-2.0.4.xpi 并自动回写 update.json SHA-512 校验
```

---

## 开源协议与致谢

本项目基于 [MIT License](LICENSE) 开源发布，衍生自 [Lyz-623/JournalLens (`v0.3.9`)](https://github.com/Lyz-623/JournalLens)，并围绕 Zotero 10–12 与 Zotero Flow 全家桶工程基准完成了彻底的类型化、模块化与视觉重构。
