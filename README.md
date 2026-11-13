# Zotero JournalFlow `v5.1.0`

**Zotero JournalFlow** is a modern Zotero 10–12 (`Gecko 140+ / 153+`) extension for tracking academic journals directly inside Zotero, refactored in strict TypeScript from [Lyz-623/JournalLens (`v0.3.9`)](https://github.com/Lyz-623/JournalLens) to follow the [Zotero Flow](https://github.com/groele) architecture, UI design language, and engineering quality standards.

---

## What's New in `v5.0.0`

- **Fresh Redesigned SVG Icon System (`icon.svg` + `toolbar.svg` + HiDPI PNGs)**:
  - Crafted a bright, airy sky-blue / aqua / mint-teal open-journal silhouette with a translucent paper sheen, flowing literature stream bars, an embedded scientific figure spectrum card, a mint bookmark ribbon, and a coral-amber live discovery spark (`chrome/content/icons/icon.svg`).
  - Paired with a dedicated `24×24` pixel-crisp `toolbar.svg` (used for Zotero's toolbar, menu items, and small `16×16`/`32×32` rasterized PNGs) and full `48/64/96/128px` HiDPI PNG set.

## What's New in `v4.0.0`

- **Batched SQLite Library DOI Detection**: Replaced full-library item scans with chunked `Zotero.DB.queryAsync` `IN (...)` lookups across bare and `doi.org`/`dx.doi.org` URL variants, eliminating lag on large Zotero libraries.
- **Coalesced Reading State & Instant Cached Translation Hydration**: Added `ReadingStateStore.setReadMany()` for single-write batch read updates (`Mark all read`), and hydrated cached `_tx` translations during `stampReadingState()` so search matches translated titles/abstracts immediately.
- **Resilient Figure Pipeline**: Added in-flight `WeakMap` deduplication per article and a 5-minute expiring cooldown for timed-out image hosts so transient CDN hiccups recover automatically.
- **UI State Preservation & Scoped Bulk Operations**: Preserved expanded abstracts across background metadata enrichment, persisted active sort mode in `sessionStorage`, scoped **Translate all** to the active filter & search with `loadGeneration` cancellation, advanced keyboard focus cleanly on `r`/`s` removal, and auto-backfilled missing publisher/ISSN metadata after JSON subscription import.

## What's New in `v3.0.0`

- **Active Scope Banner & Live Workspace Telemetry**: Always see the active scope (*All Followed Journals*, publisher group, or journal + ISSN), live paper/unread/OA/starred breakdowns, filter pill counters, one-click **Mark all read**, **Reset filters**, search clear (`×`), and floating **Back to top** navigation.
- **Multi-Mode Sorting**: Sort articles instantly by *Newest first*, *Unread first*, *Has figures first*, *Journal A–Z*, or *Title A–Z*.
- **Bilingual Parallel Comparison & Quick DOI Copy**: Translated cards retain a compact stacked **Original Reference** block below the translated content for terminology cross-checking, plus one-click copyable `DOI` badges in card metadata.
- **Pro Figure Lightbox (`Filmstrip + URL Actions`)**: Inspect multi-figure papers faster with a live `N / Total` counter, interactive thumbnail filmstrip, one-click **Copy URL**, and **Open Original Image**.
- **Keyboard-First Academic Triage (`?`)**: Navigate cards with `j` / `k`, jump to search with `/`, open with `o` / `Enter`, import with `a`, translate with `t`, star with `s`, toggle read with `r`, batch-select with `x`, and press `?` anytime for the shortcut dialog.
- **Redesigned Unbounded Dual-Wing SVG Branding**: Pixel-crisp `toolbar.svg` + layered dual-wing `icon.svg` and rasterized HiDPI icon set.

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
| **Version** | `v5.1.0` |
| **Supported Zotero** | Zotero `10.0` – `12.*` (`Gecko 140+ / 153+`) |
| **Build Stack** | Strict TypeScript (`ES2023`, `noEmit`) + `esbuild` (`firefox140` IIFE bundles) |
| **Codebase Hygiene** | 100% TypeScript in `src/`, every module `<= 360` lines, Fluent `en-US` / `zh-CN` symmetry |
| **Preferences UI** | Zotero Flow 40px Golden Grid with Light/Dark theme adaptation |

---

## Development & Verification

```bash
npm install
npm run test      # typecheck + architecture guard + esbuild bundle + unit tests + XPI self-test
npm run package   # builds deterministic dist/zotero-journalflow-5.1.0.xpi and syncs update.json SHA-512
```

---

## License & Upstream Attribution

Released under the [MIT License](LICENSE). Derived from **JournalLens (`v0.3.9`)** by [Lyz-623](https://github.com/Lyz-623/JournalLens), re-architected for Zotero 10–12 and the Zotero Flow suite.
