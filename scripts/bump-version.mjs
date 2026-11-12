#!/usr/bin/env node
/**
 * Zotero JournalFlow - Deterministic Semver Bump & Full-Chain Version Sync
 *
 * Usage:
 *   node scripts/bump-version.mjs            # increments patch: x.y.z -> x.y.(z+1)
 *   node scripts/bump-version.mjs --minor    # x.(y+1).0
 *   node scripts/bump-version.mjs --major    # (x+1).0.0
 *   node scripts/bump-version.mjs --set 1.2.3
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..');

function parseSemver(ver) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(ver || '').trim());
  if (!m) {
    throw new Error(`Invalid semantic version "${ver}"; expected x.y.z`);
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function computeNextVersion(currentVersion, args = []) {
  const setIdx = args.indexOf('--set');
  if (setIdx >= 0) {
    const explicit = args[setIdx + 1];
    parseSemver(explicit);
    return explicit;
  }
  const [major, minor, patch] = parseSemver(currentVersion);
  if (args.includes('--major')) return `${major + 1}.0.0`;
  if (args.includes('--minor')) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function replaceOrThrow(content, regex, replacement, label) {
  if (!regex.test(content)) {
    throw new Error(`Version anchor not found in ${label}`);
  }
  return content.replace(regex, replacement);
}

export function bumpRepoVersion(root = DEFAULT_ROOT, args = []) {
  const pkgPath = path.join(root, 'package.json');
  const pkg = readJson(pkgPath);
  const prevVersion = pkg.version;
  const nextVersion = computeNextVersion(prevVersion, args);

  // 1. package.json
  pkg.version = nextVersion;
  writeJson(pkgPath, pkg);

  // 2. package-lock.json
  const lockPath = path.join(root, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    const lock = readJson(lockPath);
    lock.version = nextVersion;
    if (lock.packages?.['']) {
      lock.packages[''].version = nextVersion;
    }
    writeJson(lockPath, lock);
  }

  // 3. manifest.json
  const manifestPath = path.join(root, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = readJson(manifestPath);
    manifest.version = nextVersion;
    writeJson(manifestPath, manifest);
  }

  // 4. docs/brand/product.json
  const productPath = path.join(root, 'docs/brand/product.json');
  if (fs.existsSync(productPath)) {
    const product = readJson(productPath);
    product.version = nextVersion;
    writeJson(productPath, product);
  }

  // 5. scripts/architecture-baseline.json
  const baselinePath = path.join(root, 'scripts/architecture-baseline.json');
  if (fs.existsSync(baselinePath)) {
    const baseline = readJson(baselinePath);
    baseline.lastReleasedVersion = nextVersion;
    writeJson(baselinePath, baseline);
  }

  // 6. src/config.ts
  const configPath = path.join(root, 'src/config.ts');
  if (fs.existsSync(configPath)) {
    let configTs = fs.readFileSync(configPath, 'utf8');
    configTs = replaceOrThrow(
      configTs,
      /(ADDON_VERSION\s*=\s*['"])[^'"]+(['"])/,
      `$1${nextVersion}$2`,
      'src/config.ts'
    );
    fs.writeFileSync(configPath, configTs, 'utf8');
  }

  // 7. chrome/content/feed.xhtml
  const feedPath = path.join(root, 'chrome/content/feed.xhtml');
  if (fs.existsSync(feedPath)) {
    let feedXhtml = fs.readFileSync(feedPath, 'utf8');
    feedXhtml = replaceOrThrow(
      feedXhtml,
      /(id="brand-version"[^>]*>v)[^<]+(<)/,
      `$1${nextVersion}$2`,
      'chrome/content/feed.xhtml'
    );
    fs.writeFileSync(feedPath, feedXhtml, 'utf8');
  }

  // 8. chrome/content/preferences.xhtml
  const prefsPath = path.join(root, 'chrome/content/preferences.xhtml');
  if (fs.existsSync(prefsPath)) {
    let prefsXhtml = fs.readFileSync(prefsPath, 'utf8');
    prefsXhtml = replaceOrThrow(
      prefsXhtml,
      /(class="jf-pref-version">v)[^<]+(<)/,
      `$1${nextVersion}$2`,
      'chrome/content/preferences.xhtml (.jf-pref-version)'
    );
    prefsXhtml = replaceOrThrow(
      prefsXhtml,
      /(<html:dd>v)\d+\.\d+\.\d+(<\/html:dd>)/,
      `$1${nextVersion}$2`,
      'chrome/content/preferences.xhtml (<html:dd>)'
    );
    prefsXhtml = replaceOrThrow(
      prefsXhtml,
      /releases\/download\/v\d+\.\d+\.\d+\/zotero-journalflow-\d+\.\d+\.\d+\.xpi/g,
      `releases/download/v${nextVersion}/zotero-journalflow-${nextVersion}.xpi`,
      'chrome/content/preferences.xhtml (release href)'
    );
    prefsXhtml = replaceOrThrow(
      prefsXhtml,
      /(data-l10n-args='\{"version": ")[^"]+("\}')/,
      `$1${nextVersion}$2`,
      'chrome/content/preferences.xhtml (data-l10n-args)'
    );
    fs.writeFileSync(prefsPath, prefsXhtml, 'utf8');
  }

  // 9. update.json
  const updatePath = path.join(root, 'update.json');
  if (fs.existsSync(updatePath)) {
    const update = readJson(updatePath);
    const addonEntries = Object.values(update.addons || {});
    for (const addon of addonEntries) {
      if (Array.isArray(addon?.updates) && addon.updates[0]) {
        addon.updates[0].version = nextVersion;
        addon.updates[0].update_link = `https://github.com/groele/Zotero-JournalFlow/releases/download/v${nextVersion}/zotero-journalflow-${nextVersion}.xpi`;
      }
    }
    writeJson(updatePath, update);
  }

  // 10. README.md & README.zh-CN.md
  for (const readmeRel of ['README.md', 'README.zh-CN.md']) {
    const readmePath = path.join(root, readmeRel);
    if (!fs.existsSync(readmePath)) continue;
    let md = fs.readFileSync(readmePath, 'utf8');
    md = replaceOrThrow(
      md,
      /(^# Zotero JournalFlow `v)\d+\.\d+\.\d+(`)/m,
      `$1${nextVersion}$2`,
      `${readmeRel} (title)`
    );
    md = md.replace(
      /(\|\s*\*\*(?:Version|当前版本)\*\*\s*\|\s*`v)\d+\.\d+\.\d+(`)/g,
      `$1${nextVersion}$2`
    );
    md = md.replace(
      /dist\/zotero-journalflow-\d+\.\d+\.\d+\.xpi/g,
      `dist/zotero-journalflow-${nextVersion}.xpi`
    );
    fs.writeFileSync(readmePath, md, 'utf8');
  }

  // 11. Workspace hygiene: remove stale local XPIs from previous versions in dist/
  const distDir = path.join(root, 'dist');
  if (fs.existsSync(distDir)) {
    for (const entry of fs.readdirSync(distDir)) {
      if (/^zotero-journalflow-.*\.xpi$/i.test(entry) && entry !== `zotero-journalflow-${nextVersion}.xpi`) {
        fs.rmSync(path.join(distDir, entry), { force: true });
      }
    }
  }

  console.log(`[version:bump] ${prevVersion} -> ${nextVersion}`);
  return { prevVersion, nextVersion };
}

const isCLI = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isCLI) {
  bumpRepoVersion(DEFAULT_ROOT, process.argv.slice(2));
}
