import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

console.log('[esbuild] Building Zotero JournalFlow TypeScript bundles...');

const entryList = [
  {
    in: 'src/index.ts',
    out: 'chrome/content/scripts/index.js',
  },
  {
    in: 'src/preferences.ts',
    out: 'chrome/content/scripts/preferences.js',
  },
  {
    in: 'src/feed.ts',
    out: 'chrome/content/scripts/feed.js',
  },
];

const metafiles = [];

for (const entry of entryList) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry.in],
    outfile: entry.out,
    bundle: true,
    format: 'iife',
    target: ['firefox140'],
    charset: 'utf8',
    loader: { '.ftl': 'text' },
    treeShaking: true,
    minify: false,
    legalComments: 'inline',
    write: false,
    metafile: true,
  });

  for (const file of result.outputFiles) {
    const bundledText = Buffer.from(file.contents).toString('utf8').replace(/\r\n/g, '\n');
    const finalBuffer = Buffer.from(bundledText, 'utf8');
    await fs.mkdir(path.dirname(file.path), { recursive: true });
    const previous = await fs.readFile(file.path).catch(() => null);
    if (!previous?.equals(finalBuffer)) {
      await fs.writeFile(file.path, finalBuffer);
    }
    console.log(
      `[esbuild] Compiled ${finalBuffer.length} bytes -> ${path.relative(root, file.path)} (target: firefox140)`
    );
  }
  metafiles.push(result.metafile);
}

await fs.mkdir(path.join(root, 'dist'), { recursive: true });
await fs.writeFile(
  path.join(root, 'dist/build-metafile.json'),
  `${JSON.stringify(metafiles, null, 2)}\n`,
  'utf8'
);
console.log('[esbuild] Wrote dist/build-metafile.json');
