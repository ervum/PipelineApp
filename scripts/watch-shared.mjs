import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const sharedDir = path.join(rootDir, 'shared');

function ensureDistPackageStubs() {
  const cjsDir = path.join(sharedDir, 'dist', 'cjs');
  const esmDir = path.join(sharedDir, 'dist', 'esm');
  fs.mkdirSync(cjsDir, { recursive: true });
  fs.mkdirSync(esmDir, { recursive: true });
  fs.writeFileSync(path.join(cjsDir, 'package.json'), '{"type":"commonjs"}');
  fs.writeFileSync(path.join(esmDir, 'package.json'), '{"type":"module"}');
}

ensureDistPackageStubs();

const cjsEntry = path.join(sharedDir, 'dist', 'cjs', 'index.js');
const esmEntry = path.join(sharedDir, 'dist', 'esm', 'index.js');
const typesEntry = path.join(sharedDir, 'dist', 'types', 'index.d.ts');

// Build in-place (without rimraf) only if dist artifacts are missing so we never
// delete @forge/shared while backend/frontend watchers are starting in parallel.
if (!fs.existsSync(cjsEntry) || !fs.existsSync(esmEntry) || !fs.existsSync(typesEntry)) {
  console.log('[shared-watch] Initial @forge/shared artifacts missing; compiling in-place...');
  spawnSync('npx', ['tsc', '-p', 'tsconfig.esm.json'], {
    cwd: sharedDir,
    stdio: 'inherit',
    shell: true,
  });
  spawnSync('npx', ['tsc', '-p', 'tsconfig.cjs.json'], {
    cwd: sharedDir,
    stdio: 'inherit',
    shell: true,
  });
  ensureDistPackageStubs();
}

console.log('[shared-watch] Watching @forge/shared (ESM + CJS) for changes...');

const esmWatcher = spawn(
  'npx',
  ['tsc', '-p', 'tsconfig.esm.json', '--watch', '--preserveWatchOutput'],
  { cwd: sharedDir, stdio: 'inherit', shell: true },
);

const cjsWatcher = spawn(
  'npx',
  ['tsc', '-p', 'tsconfig.cjs.json', '--watch', '--preserveWatchOutput'],
  { cwd: sharedDir, stdio: 'inherit', shell: true },
);

function shutdown() {
  esmWatcher.kill();
  cjsWatcher.kill();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
