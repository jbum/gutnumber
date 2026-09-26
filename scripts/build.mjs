// Build everything into dist/:
//   dist/server.js dist/daemon.js dist/gut.js   (esbuild, Node ESM; native deps external)
//   dist/client/                                 (vite)
//   dist/extension/                              (esbuild; load unpacked in Chrome) + picker.iife.js for the bookmarklet
// Usage: node scripts/build.mjs [node|client|extension]...
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const only = process.argv.slice(2);
const want = (k) => !only.length || only.includes(k);
const EXTERNAL = ['better-sqlite3', 'puppeteer', 'puppeteer-core'];
const banner = { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" };

if (want('node')) {
  mkdirSync('dist', { recursive: true });
  for (const [entry, out] of [
    ['packages/server/src/main.ts', 'dist/server.js'],
    ['packages/daemon/src/main.ts', 'dist/daemon.js'],
    ['packages/cli/src/main.ts', 'dist/gut.js'],
  ]) {
    await build({ entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node22', external: EXTERNAL, banner, sourcemap: true, logLevel: 'warning', tsconfig: 'tsconfig.json' });
    console.log('built', out);
  }
}

if (want('client') && existsSync('packages/client/index.html')) {
  execSync('npx vite build --config packages/client/vite.config.ts', { stdio: 'inherit' });
}

if (want('extension') && existsSync('packages/extension/src/background.ts')) {
  const outdir = 'dist/extension';
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
  const common = { bundle: true, platform: 'browser', target: 'chrome120', logLevel: 'warning', tsconfig: 'tsconfig.json', legalComments: 'none', charset: 'ascii' }; // ascii: pages may decode the bookmarklet as Latin-1
  await build({ ...common, entryPoints: { background: 'packages/extension/src/background.ts', options: 'packages/extension/src/options.ts' }, outdir, format: 'esm' });
  // The picker is injected with chrome.scripting.executeScript → must be a classic script.
  await build({ ...common, entryPoints: { picker: 'packages/extension/src/picker/main.ts' }, outdir, format: 'iife' });
  // Bookmarklet build of the same picker: talks to the server directly instead of via chrome.runtime.
  await build({ ...common, entryPoints: { 'picker.iife': 'packages/extension/src/picker/bookmarklet.ts' }, outdir, format: 'iife', minify: true });
  cpSync('packages/extension/static', outdir, { recursive: true });
  const manifest = JSON.parse(readFileSync('packages/extension/manifest.json', 'utf8'));
  manifest.version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  writeFileSync(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2));
  console.log('built', outdir);
}
