import { buildSync } from 'esbuild';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function toPlain(val) {
  return JSON.parse(JSON.stringify(val));
}

export function loadTsModule(relPath, extraGlobals = {}) {
  const fullPath = path.join(ROOT, relPath);
  const res = buildSync({
    entryPoints: [fullPath],
    absWorkingDir: ROOT,
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    loader: { '.ftl': 'text' },
    minify: false,
  });
  const code = Buffer.from(res.outputFiles[0].contents).toString('utf8');
  const mod = { exports: {} };
  const sandbox = {
    module: mod,
    exports: mod.exports,
    require,
    __filename: fullPath,
    __dirname: path.dirname(fullPath),
    URL,
    URLSearchParams,
    AbortController,
    DOMParser: new JSDOM().window.DOMParser,
    console,
    setTimeout,
    clearTimeout,
    ...extraGlobals,
  };
  vm.runInNewContext(code, sandbox, { filename: fullPath });
  return mod.exports;
}

export function createPrefStore(initial = {}) {
  const store = new Map(Object.entries(initial));
  const observers = new Set();
  return {
    store,
    Prefs: {
      get(key) {
        return store.has(key) ? store.get(key) : undefined;
      },
      set(key, val) {
        store.set(key, val);
        for (const fn of observers) {
          try {
            fn();
          } catch {}
        }
      },
      clear(key) {
        store.delete(key);
      },
      registerObserver(_prefix, fn) {
        observers.add(fn);
        return fn;
      },
      unregisterObserver(token) {
        observers.delete(token);
      },
    },
  };
}
