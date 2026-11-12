#!/usr/bin/env node
/**
 * Zotero JournalFlow - Deterministic Node.js XPI Packager & Verifier
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, createZipBuffer, readZipEntries } from './package-xpi-zip.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..');
const REPO = 'Zotero-JournalFlow';
const FEEDS = ['update.json'];
const IDENTITIES = ['journalflow@groele.org'];

export { crc32, createZipBuffer };

export function readZip(zipBuffer) {
  return readZipEntries(zipBuffer, requireCondition);
}

export function readJson(filePath) {
  let text = fs.readFileSync(filePath, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text);
}

export function requireCondition(cond, message) {
  if (!cond) throw new Error(message);
}

export function metadata(root) {
  const manifest = readJson(path.join(root, 'manifest.json'));
  const version = manifest.version;

  for (const name of ['package.json', 'docs/brand/product.json']) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) {
      const data = readJson(file);
      requireCondition(data.version === version, `${name}: version mismatch`);
    }
  }

  for (const rel of ['chrome/content/preferences.xhtml', 'chrome/content/feed.xhtml']) {
    const file = path.join(root, rel);
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8');
      requireCondition(text.includes(`>v${version}<`), `${rel}: version badge mismatch`);
    }
  }

  return manifest;
}

export function payload(filePath) {
  let contents = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (
    ['.js', '.json', '.css', '.html', '.xhtml', '.ftl', '.svg', '.manifest', '.properties', '.txt'].includes(
      ext
    )
  ) {
    const str = contents.toString('utf8').replace(/\r\n/g, '\n');
    contents = Buffer.from(str, 'utf8');
  }
  return contents;
}

export function walkFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.DS_Store', 'Thumbs.db', '.git'].includes(ent.name) || ent.name.endsWith('.tmp')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      results.push(...walkFiles(full));
    } else if (ent.isFile()) {
      results.push(full);
    }
  }
  return results;
}

export function runtimeFiles(root) {
  const topFiles = ['manifest.json', 'bootstrap.js', 'prefs.js', 'LICENSE']
    .map((f) => path.join(root, f))
    .filter((f) => fs.existsSync(f));
  const chromeFiles = walkFiles(path.join(root, 'chrome'));
  const localeFiles = walkFiles(path.join(root, 'locale'));
  const all = [...topFiles, ...chromeFiles, ...localeFiles];
  all.sort((a, b) => {
    const relA = path.relative(root, a).replace(/\\/g, '/');
    const relB = path.relative(root, b).replace(/\\/g, '/');
    return relA.localeCompare(relB);
  });
  return all;
}

export function build(root, outputPath) {
  metadata(root);
  const files = runtimeFiles(root);
  const entries = files.map((file) => ({
    name: path.relative(root, file).replace(/\\/g, '/'),
    data: payload(file),
  }));
  const zipBuf = createZipBuffer(entries);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, zipBuf);
  return zipBuf;
}

export function verify(
  root,
  outputPath,
  repo = REPO,
  feeds = FEEDS,
  identities = IDENTITIES,
  update = false
) {
  const manifest = metadata(root);
  const version = manifest.version;
  const name = `zotero-journalflow-${version}.xpi`;

  const files = runtimeFiles(root);
  const expected = new Map();
  for (const f of files) {
    expected.set(path.relative(root, f).replace(/\\/g, '/'), payload(f));
  }

  const zipBytes = fs.readFileSync(outputPath);
  const actualEntries = readZipEntries(zipBytes, requireCondition);

  requireCondition(actualEntries.size === expected.size, 'XPI runtime file set mismatch');
  for (const [key, expVal] of expected.entries()) {
    requireCondition(actualEntries.has(key), `Missing XPI resource: ${key}`);
    const actVal = actualEntries.get(key);
    requireCondition(Buffer.compare(expVal, actVal) === 0, `Stale XPI resource: ${key}`);
  }

  const digest256 = crypto.createHash('sha256').update(zipBytes).digest('hex');
  const digest512 = crypto.createHash('sha512').update(zipBytes).digest('hex');
  const link = `https://github.com/groele/${repo}/releases/download/v${version}/${name}`;

  const documents = [];
  for (const feedName of feeds) {
    const feedPath = path.join(root, feedName);
    const data = readJson(feedPath);
    const addonKeys = Object.keys(data.addons || {});
    for (const id of identities) {
      requireCondition(addonKeys.includes(id), `${feedName}: add-on identities mismatch`);
    }
    for (const addonId of identities) {
      const updates = data.addons[addonId].updates;
      requireCondition(updates && updates.length === 1, `${feedName}: expected one maintained update`);
      const entry = updates[0];
      requireCondition(entry.version === version, `${feedName}: version mismatch`);
      requireCondition(entry.update_link === link, `${feedName}: immutable asset URL mismatch`);
      for (const key of ['strict_min_version', 'strict_max_version']) {
        const expectedVal =
          manifest.applications?.zotero?.[key] || manifest.browser_specific_settings?.zotero?.[key];
        const actualVal = entry.applications?.zotero?.[key];
        requireCondition(actualVal === expectedVal, `${feedName}: compatibility mismatch`);
      }
      const declaredHash = entry.update_hash || '';
      const algo = declaredHash.includes(':') ? declaredHash.split(':')[0] : 'sha512';
      requireCondition(['sha256', 'sha512'].includes(algo), `${feedName}: unsupported hash '${algo}'`);
      const actualDigest = algo === 'sha512' ? digest512 : digest256;
      if (update) {
        entry.update_hash = `${algo}:${actualDigest}`;
      } else {
        const expectedHash = `${algo}:${actualDigest}`;
        requireCondition(declaredHash === expectedHash, `${feedName}: ${algo} mismatch`);
      }
    }
    documents.push({ path: feedPath, data });
  }

  if (update) {
    for (const doc of documents) {
      fs.writeFileSync(doc.path, `${JSON.stringify(doc.data, null, 2)}\n`, 'utf8');
    }
  }

  return {
    version,
    file: path.relative(root, outputPath).replace(/\\/g, '/'),
    size: fs.statSync(outputPath).size,
    sha256: digest256,
    sha512: digest512,
    entries: expected.size,
    payloadVerifiedAgainstWorkspace: true,
    updateFeedsVerified: [...feeds],
    reproducibleZipMetadata: true,
    textLineEndings: 'LF',
  };
}

export function runSelfTest() {
  console.log('[test] Running JournalFlow package-xpi self-test suite...');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jf-pkg-test-'));

  try {
    const root = tempDir;
    const repo = 'Zotero-JournalFlow';
    const identities = ['journalflow@groele.org'];
    const feeds = ['update.json'];
    const manifest = {
      version: '1.0.0',
      applications: {
        zotero: { id: identities[0], strict_min_version: '10.0', strict_max_version: '12.*' },
      },
    };

    const writeJsonFile = (rel, obj) => {
      const p = path.join(root, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
    };

    writeJsonFile('manifest.json', manifest);
    for (const name of [
      'bootstrap.js',
      'prefs.js',
      'chrome/content/preferences.xhtml',
      'chrome/content/feed.xhtml',
    ]) {
      const p = path.join(root, name);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, '>v1.0.0<', 'utf8');
    }

    const entry = {
      version: '1.0.0',
      update_hash: 'sha512:stale',
      update_link:
        'https://github.com/groele/Zotero-JournalFlow/releases/download/v1.0.0/zotero-journalflow-1.0.0.xpi',
      applications: { zotero: { strict_min_version: '10.0', strict_max_version: '12.*' } },
    };
    writeJsonFile('update.json', { addons: { [identities[0]]: { updates: [entry] } } });

    const output = path.join(root, 'dist', 'zotero-journalflow-1.0.0.xpi');
    build(root, output);

    let threw = false;
    try {
      verify(root, output, repo, feeds, identities, false);
    } catch {
      threw = true;
    }
    requireCondition(threw, 'Expected stale sha512 verification to fail');

    const report = verify(root, output, repo, feeds, identities, true);
    const report2 = verify(root, output, repo, feeds, identities, false);
    requireCondition(report.sha512 === report2.sha512, 'Report SHA-512 should match after sync');

    // Verify deterministic byte-identical rebuild regardless of CRLF vs LF
    const bootPath = path.join(root, 'bootstrap.js');
    fs.writeFileSync(bootPath, '// deterministic\r\nconst v = 1;\r\n');
    build(root, output);
    const crlfBytes = fs.readFileSync(output);
    fs.writeFileSync(bootPath, '// deterministic\nconst v = 1;\n');
    build(root, output);
    const lfBytes = fs.readFileSync(output);
    requireCondition(Buffer.compare(crlfBytes, lfBytes) === 0, 'CRLF and LF must produce identical XPI');

    console.log('[test] All package-xpi self-tests passed.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const isCLI = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isCLI) {
  const args = process.argv.slice(2);
  if (args.includes('--test')) {
    runSelfTest();
  } else {
    const updateFeeds = args.includes('--update-feeds');
    const verifyOnly = args.includes('--verify-only');
    requireCondition(!(updateFeeds && verifyOnly), 'Cannot combine --update-feeds with --verify-only');

    const root = DEFAULT_ROOT;
    const manifest = readJson(path.join(root, 'manifest.json'));
    const version = manifest.version;
    const xpiName = `zotero-journalflow-${version}.xpi`;
    const output = path.join(root, 'dist', xpiName);

    if (!verifyOnly) {
      console.log(`[package-xpi] Packaging dist/${xpiName}...`);
      build(root, output);
    }

    console.log(`[package-xpi] Verifying package and ${updateFeeds ? 'synchronizing' : 'checking'} feeds...`);
    const report = verify(root, output, REPO, FEEDS, IDENTITIES, updateFeeds);
    console.log(JSON.stringify(report, null, 2));
  }
}
