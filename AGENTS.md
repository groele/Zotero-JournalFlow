# Zotero JournalFlow 仓库规范

适用范围：`github-sources/Zotero-JournalFlow` 仓库。
开始工作前，先阅读并遵循工作区根目录的 [AGENTS.md](../../AGENTS.md)。本文件记录 JournalFlow 的架构细节、构建脚本、测试套件与业务规则。

---

## 1. 产品定位与核心职责

Zotero JournalFlow 是基于 `Lyz-623/JournalLens` (v0.3.9, MIT) 按 **Zotero Flow** 工程规范深度重构的期刊文献追踪工作台：

- **期刊订阅与近期论文聚合**：通过 Crossref REST API 按刊名或 ISSN 检索订阅期刊，抓取可配置时间窗口内的最新论文。
- **摘要补全与内容过滤**：批量联动 Europe PMC 与 Unpaywall / 出版商页面元数据（Meta / JSON-LD）补全缺失摘要，过滤新闻、社论、勘误等非研究条目，自动去重多版本 DOI。
- **正文配图提取与灯箱预览**：解析 Europe PMC fullTextXML 与出版商 HTML/XML，过滤无效缩略图与封面，支持懒加载与缩放平移灯箱查看。
- **双语标题摘要翻译与一键入库**：支持单篇与批量并发 EN ↔ 中文翻译（Google / MyMemory），并支持通过 DOI 一键导入 Zotero 文献库。
- **Tab / 独立窗口双模式**：支持无缝嵌入 Zotero 主界面标签页（Tab）或打开独立工作台窗口（Window），在设置页可即时切换。

---

## 2. 宿主基准与兼容性约束

- **面向 Zotero 10 ~ 12（Gecko 140+ / 153+ 现代架构）**：
  - `manifest.json` 与 `update.json` 严格声明：`strict_min_version: "10.0"`、`strict_max_version: "12.*"`。
  - 严禁使用 `Components.classes`、`Components.interfaces`、`Cu.import`、`.jsm`、`ownerGlobal`、`CheckboxStateChange` 及内联脚本/事件属性。
  - 设置页注册明确声明 `defaultXUL: true`，外部脚本通过捕获阶段 `load` 事件与 `readyState` 兜底安全初始化。
  - 窗口与视图生命周期统一绑定 `AbortController`，确保 `onMainWindowUnload` 与 `shutdown` 时零监听器泄漏。

---

## 3. 品牌与标识

- **用户可见品牌**：`Zotero JournalFlow`
- **插件 ID**：`journalflow@groele.org`
- **Preference 前缀**：`extensions.journalflow.`（首次读取时自动兼容迁移旧版 `extensions.journallens.journals`）
- **缓存文件**：`<ZoteroDataDir>/journalflow-cache.json`（通过 `IOUtils` / `PathUtils` 异步持久化，避免膨胀 `prefs.js`）
- **运行时命名空间**：`Zotero.JournalFlow`
- **本地化文件**：`journalflow.ftl`（`en-US` 与 `zh-CN` 键严格对称）

---

## 4. 构建与四阶验证指令

```bash
# L1: TypeScript 严格类型检查
npm run typecheck

# L2: 自动化架构守卫
npm run guard

# L3: 编译源码并运行单元测试与打包自检
npm run build:bundle
npm run test:unit
npm run test:package
npm test

# L4: 确定性可复现 XPI 打包并同步 update.json SHA-512
npm run package
```
