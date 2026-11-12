/**
 * Zotero JournalFlow - Architecture & Compliance Guard
 *
 * Enforces workspace AGENTS.md standards statically:
 *   §4   Zero-drift version alignment across manifest, package, lock, brand, UI, update feed, baseline, READMEs
 *   §4   No version-prefixed or transient filenames; Fluent symmetry across en-US and zh-CN; zero hardcoded UI text
 *   §5.2 Settings pane 16/24/40px alignment grid + single open details card + full prefs.js coverage
 *   §6.2 100% TypeScript in src/ (no loose JS, no @ts-nocheck/@ts-ignore), <= 360-line ceiling per module (0 debt)
 *   §6.3 Gecko 140+/153+ & Zotero 10-12 API rules (no Components.*, Cu.import, inline event handlers, window.alert)
 *   §7   Update feed HTTPS integrity, SHA-512 hash, 10.0 ~ 12.* compatibility scope
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));
const lines = (rel) => read(rel).trimEnd().split(/\r?\n/).length;

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'output']);

function walk(relDir, extensions = ['.ts', '.tsx', '.js', '.mjs']) {
  const out = [];
  const visit = (dir) => {
    const fullDir = path.join(root, dir);
    if (!fs.existsSync(fullDir)) return;
    for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(rel);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        out.push(rel);
      }
    }
  };
  visit(relDir);
  return out.sort();
}

const baseline = readJson('scripts/architecture-baseline.json');
const MAX_LINES = baseline.maxSourceLines || 360;

test('§6.2 source files respect the 360-line ceiling (0 debt baseline)', (t) => {
  const sourceFiles = walk('src', ['.ts', '.tsx', '.js']);
  const failures = [];

  for (const file of sourceFiles) {
    const count = lines(file);
    if (count > MAX_LINES) {
      failures.push(`${file}: ${count} lines exceeds ${MAX_LINES}-line ceiling`);
    }
  }

  assert.equal(baseline.debtCleared, true, 'architecture-baseline.json must keep debtCleared: true');
  assert.deepEqual(baseline.oversized, {}, 'oversized baseline map must remain empty');
  t.diagnostic(`scanned ${sourceFiles.length} source files (max ${MAX_LINES} lines)`);
  assert.deepEqual(failures, [], `§6.2 line-limit violations:\n${failures.join('\n')}`);
});

test('§4 releaseStatus governance: releaseStatus is released or unreleased', () => {
  const product = readJson('docs/brand/product.json');
  assert.ok(
    ['released', 'unreleased'].includes(product.releaseStatus),
    `releaseStatus must be "released" or "unreleased", got "${product.releaseStatus}"`
  );
});

test('§4 Fluent catalogues are symmetric and free of duplicate keys across en-US and zh-CN', (t) => {
  const locales = ['en-US', 'zh-CN'];
  const keysOf = (lang) => {
    const text = read(`locale/${lang}/journalflow.ftl`);
    return [...text.matchAll(/^([A-Za-z0-9_-]+)\s*=/gm)].map((m) => m[1]);
  };
  const baseKeys = keysOf('en-US');
  assert.equal(new Set(baseKeys).size, baseKeys.length, 'duplicate keys found in en-US catalogue');

  for (const lang of locales) {
    if (lang === 'en-US') continue;
    const langKeys = keysOf(lang);
    assert.equal(new Set(langKeys).size, langKeys.length, `duplicate keys found in ${lang} catalogue`);
    const extra = langKeys.filter((k) => !baseKeys.includes(k));
    const missing = baseKeys.filter((k) => !langKeys.includes(k));
    assert.deepEqual(extra, [], `${lang} has extra keys not in en-US: ${extra.join(', ')}`);
    assert.deepEqual(missing, [], `${lang} is missing keys from en-US: ${missing.join(', ')}`);
  }
  t.diagnostic(`${baseKeys.length} symmetric Fluent keys across all locales`);
});

test('§4/§5 preferences.xhtml & feed.xhtml contain zero hardcoded Chinese or inline event handlers', () => {
  const rawPrefs = read('chrome/content/preferences.xhtml').replace(/<!--[\s\S]*?-->/g, '');
  const rawChinese = [...rawPrefs.matchAll(/>([^<]*[\u4e00-\u9fa5]+[^<]*)</g)].map((m) => m[1].trim());
  assert.deepEqual(rawChinese, [], `raw Chinese text in preferences.xhtml: ${rawChinese.join(', ')}`);

  for (const summary of rawPrefs.matchAll(/<html:summary[^>]*>([\s\S]*?)<\/html:summary>/g)) {
    assert.ok(summary[0].includes('data-l10n-id='), `summary missing data-l10n-id: ${summary[0]}`);
  }
  const openCount = (rawPrefs.match(/<html:details[^>]*\bopen(?:\s*=|\s|>)/g) || []).length;
  assert.equal(openCount, 1, `exactly one details card must be open by default, found ${openCount}`);

  for (const rel of ['chrome/content/preferences.xhtml', 'chrome/content/feed.xhtml']) {
    const content = read(rel).replace(/<!--[\s\S]*?-->/g, '');
    const inlineEvents = [
      ...content.matchAll(/\s(on(?:load|click|change|input|command|showing|keydown|submit))\s*=/gi),
    ].map((m) => m[1]);
    assert.deepEqual(inlineEvents, [], `inline event handlers banned in ${rel}: ${inlineEvents.join(', ')}`);
  }
});

test('§4 source filenames carry no version numbers or transient prefixes', () => {
  const files = [...walk('src'), ...walk('scripts', ['.mjs', '.ps1', '.py'])];
  const bad = files.filter((file) => /(^|\/)(?:v\d|V\d|temp-|tmp-|draft-)/.test(path.basename(file)));
  assert.deepEqual(bad, [], `version-prefixed or transient filenames detected: ${bad.join(', ')}`);
});

test('§5.1 every native preference in prefs.js is mounted in src/preferences/model.ts', (t) => {
  const prefText = read('prefs.js');
  const modelText = read('src/preferences/model.ts');
  const prefKeys = [
    ...new Set([...prefText.matchAll(/pref\(\s*["']extensions\.journalflow\.([^"']+)["']/g)].map((m) => m[1])),
  ].sort();

  assert.ok(prefKeys.length > 0, 'no preferences found in prefs.js');
  const missing = prefKeys.filter((k) => !modelText.includes(k));
  assert.deepEqual(missing, [], `prefs unmounted in src/preferences/model.ts: ${missing.join(', ')}`);
  t.diagnostic(`${prefKeys.length} native preferences fully synced`);
});

test('§5.2 settings pane declares the 16/24/40px Golden Grid explicitly', () => {
  const css = read('chrome/content/styles/preferences.css');
  const rules = [
    { label: 'card declares padding: 16px', re: /\.jf-pref-card\s*\{[^}]*padding:\s*16px/ },
    {
      label: 'card header uses margin: -16px and padding: 12px 16px',
      re: /\.jf-card-header\s*\{[^}]*margin:\s*-16px;[\s\S]*?padding:\s*12px 16px/,
    },
    { label: 'subordinate indent declares 24px', re: /24px/ },
  ];
  const missing = rules.filter(({ re }) => !re.test(css)).map((r) => r.label);
  assert.deepEqual(missing, [], `Golden Grid rules missing: ${missing.join(', ')}`);
});

test('§6.2 all runtime sources in src/ are TypeScript without @ts-nocheck/@ts-ignore', () => {
  const srcFiles = walk('src', ['.ts', '.tsx', '.js', '.mjs', '.cjs']);
  const nonTs = srcFiles.filter((file) => !/\.tsx?$/.test(file));
  assert.deepEqual(nonTs, [], `non-TypeScript file in src/: ${nonTs.join(', ')}`);

  const exempt = walk('src', ['.ts', '.tsx']).filter((file) => {
    const txt = read(file);
    return txt.includes('@ts-nocheck') || txt.includes('@ts-ignore');
  });
  assert.deepEqual(exempt, [], `@ts-nocheck/@ts-ignore banned in src/: ${exempt.join(', ')}`);

  const pkg = readJson('package.json');
  assert.match(pkg.scripts.package, /typecheck/, 'package script must execute typecheck');
  assert.match(pkg.scripts.package, /guard/, 'package script must execute architecture guard');
});

test('§6.3 runtime scripts contain zero deprecated Gecko/Zotero APIs or blocking window.alert', () => {
  const runtimeFiles = ['bootstrap.js', 'prefs.js', ...walk('src', ['.ts'])];
  const banned = [
    { re: /\bComponents\.classes\b/, label: 'Components.classes' },
    { re: /\bComponents\.interfaces\b/, label: 'Components.interfaces' },
    { re: /\bCu\.import\s*\(/, label: 'legacy Cu.import' },
    { re: /\bCheckboxStateChange\b/, label: 'legacy CheckboxStateChange' },
    { re: /\bwindow\.alert\s*\(/, label: 'blocking window.alert' },
  ];
  const hits = [];
  for (const file of runtimeFiles) {
    const fileLines = read(file).split(/\r?\n/);
    fileLines.forEach((line, idx) => {
      for (const rule of banned) {
        if (rule.re.test(line)) hits.push(`${file}:${idx + 1} ${rule.label}`);
      }
    });
  }
  assert.deepEqual(hits, [], `§6.3 deprecated API violations:\n${hits.join('\n')}`);
});

test('§6.3 runtime and script JavaScript syntax is valid', () => {
  const scripts = [
    'bootstrap.js',
    'prefs.js',
    ...walk('chrome/content/scripts', ['.js']),
    ...walk('scripts', ['.mjs']),
  ];
  for (const rel of scripts) {
    assert.doesNotThrow(
      () => execFileSync(process.execPath, ['--check', path.join(root, rel)], { stdio: 'pipe' }),
      `Syntax check failed for ${rel}`
    );
  }
});

test('§4.1 full-chain version alignment across manifest, package, lock, brand, UI, config, update, READMEs', () => {
  const pkg = readJson('package.json');
  const lockExists = fs.existsSync(path.join(root, 'package-lock.json'));
  const lock = lockExists ? readJson('package-lock.json') : null;
  const manifest = readJson('manifest.json');
  const product = readJson('docs/brand/product.json');
  const update = readJson('update.json');
  const prefsXhtml = read('chrome/content/preferences.xhtml');
  const feedXhtml = read('chrome/content/feed.xhtml');
  const configTs = read('src/config.ts');

  const versions = {
    'package.json': pkg.version,
    'manifest.json': manifest.version,
    'docs/brand/product.json': product.version,
    'scripts/architecture-baseline.json': baseline.lastReleasedVersion,
    'update.json': update.addons['journalflow@groele.org']?.updates?.[0]?.version,
    'preferences.xhtml': prefsXhtml.match(/class="jf-pref-version">v([^<]+)</)?.[1],
    'feed.xhtml': feedXhtml.match(/id="brand-version"[^>]*>v([^<]+)</)?.[1],
    'src/config.ts': configTs.match(/ADDON_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1],
  };
  if (lock) versions['package-lock.json'] = lock.version;

  for (const readme of ['README.md', 'README.zh-CN.md']) {
    const md = read(readme);
    assert.ok(md.includes(`v${pkg.version}`), `${readme} must reference v${pkg.version}`);
  }

  const unique = [...new Set(Object.values(versions))];
  assert.equal(unique.length, 1, `version drift detected: ${JSON.stringify(versions, null, 2)}`);
});

test('§7 update.json points to HTTPS GitHub Release with SHA-512 and Zotero 10.0 - 12.* scope', () => {
  const feed = readJson('update.json');
  const entry = feed.addons['journalflow@groele.org']?.updates?.[0];
  assert.ok(entry, 'missing update entry in update.json');
  const ver = baseline.lastReleasedVersion.replace(/\./g, '\\.');
  assert.match(
    entry.update_link,
    new RegExp(`^https://github\\.com/groele/Zotero-JournalFlow/releases/download/v${ver}/zotero-journalflow-${ver}\\.xpi$`)
  );
  assert.match(entry.update_hash, /^sha512:[0-9a-f]{128}$/i);
  assert.equal(entry.applications?.zotero?.strict_min_version, '10.0');
  assert.equal(entry.applications?.zotero?.strict_max_version, '12.*');
});
