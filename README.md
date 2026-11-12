# Zotero JournalFlow `v2.0.6`

**Zotero JournalFlow** is a modern Zotero 10–12 (`Gecko 140+ / 153+`) extension for tracking academic journals directly inside Zotero, refactored in strict TypeScript from [Lyz-623/JournalLens (`v0.3.9`)](https://github.com/Lyz-623/JournalLens) to follow the [Zotero Flow](https://github.com/groele) architecture, UI design language, and engineering quality standards.

---

## Core Capabilities

- **Journal Subscriptions via Crossref**: Follow journals by title or ISSN directly from the workbench sidebar; new profiles seed with *Nature*, *Science*, and *Cell* (plus automatic first-run migration from `extensions.journallens.journals`).
- **Dual Opening Modes**: Open JournalFlow either inside a native Zotero main-window **Tab** (`Zotero_Tabs`) or as a standalone resizable desktop **Window** (`1180×780`), switchable in Settings or via `Ctrl+Alt+J` / Tools menu / Toolbar button.
- **Recent Feed Aggregation & Research Filtering**: Fetches recent articles over a configurable window (`1–180` days, default `14`) and caps results per journal (`10–500`), hiding non-research content (*news, editorial, correction, erratum, retraction*, etc.) using Europe PMC types and title rules.
- **Abstract Recovery Pipeline**: Recovers missing abstracts automatically via Europe PMC (`DOI` + `title` lookup), Unpaywall OA metadata, publisher meta/JSON-LD tags, and structured HTML landing pages.
- **Lazy Figure Inspection & Lightbox**: Lazily loads and dimension-validates figures from Europe PMC `fullTextXML` and open-access landing pages, filtering blank thumbnails and publisher chrome; includes an interactive Lightbox viewer with zoom, drag-pan, keyboard shortcuts (`ArrowLeft`/`ArrowRight`/`+`/`-`/`0`/`Esc`), and figure captions.
- **EN ⇄ 中文 Bilingual Translation**: Translates titles and abstracts per card or in bulk (`concurrency = 3`) using Google Translate with MyMemory fallback (configurable primary provider).
- **One-Click Zotero Import**: Imports any paper cleanly by DOI via Zotero's native translation pipeline (`Zotero.Translate.Search`).
- **Non-Blocking Daily Feed Cache**: Stores daily feed caches cleanly in `<ZoteroDataDir>/journalflow-cache.json` via modern `IOUtils`/`PathUtils` instead of bloating `prefs.js`.

---

## Compatibility & Architecture

| Specification | Detail |
|---|---|
| **Addon ID** | `journalflow@groele.org` |
| **Version** | `v2.0.6` |
| **Supported Zotero** | Zotero `10.0` – `12.*` (`Gecko 140+ / 153+`) |
| **Build Stack** | Strict TypeScript (`ES2023`, `noEmit`) + `esbuild` (`firefox140` IIFE bundles) |
| **Codebase Hygiene** | 100% TypeScript in `src/`, every module `<= 360` lines, Fluent `en-US` / `zh-CN` symmetry |
| **Preferences UI** | Zotero Flow 40px Golden Grid with Light/Dark theme adaptation |

---

## Development & Verification

```bash
npm install
npm run test      # typecheck + architecture guard + esbuild bundle + unit tests + XPI self-test
npm run package   # builds deterministic dist/zotero-journalflow-2.0.6.xpi and syncs update.json SHA-512
```

---

## License & Upstream Attribution

Released under the [MIT License](LICENSE). Derived from **JournalLens (`v0.3.9`)** by [Lyz-623](https://github.com/Lyz-623/JournalLens), re-architected for Zotero 10–12 and the Zotero Flow suite.
