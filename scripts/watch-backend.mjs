import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const sharedDir = path.join(rootDir, 'shared');
const backendDir = path.join(rootDir, 'backend');

const cjsEntry = path.join(sharedDir, 'dist', 'cjs', 'index.js');
const typesEntry = path.join(sharedDir, 'dist', 'types', 'index.d.ts');
const mainTsPath = path.join(backendDir, 'src', 'main.ts');

if (!fs.existsSync(cjsEntry) || !fs.existsSync(typesEntry)) {
  console.log('[backend-watch] Waiting for @forge/shared artifacts...');
  const cjsDir = path.join(sharedDir, 'dist', 'cjs');
  const esmDir = path.join(sharedDir, 'dist', 'esm');
  fs.mkdirSync(cjsDir, { recursive: true });
  fs.mkdirSync(esmDir, { recursive: true });
  fs.writeFileSync(path.join(cjsDir, 'package.json'), '{"type":"commonjs"}');
  fs.writeFileSync(path.join(esmDir, 'package.json'), '{"type":"module"}');
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
}

console.log('[backend-watch] Starting @forge/backend in watch mode (nest start --watch)...');
const nestWatcher = spawn('npx', ['nest', 'start', '--watch'], {
  cwd: backendDir,
  stdio: 'inherit',
  shell: true,
});

// Watch shared/dist/cjs so changes in @forge/shared trigger a NestJS reload
const sharedCjsDir = path.join(sharedDir, 'dist', 'cjs');
let debounceTimer = null;
const startedAt = Date.now();

if (fs.existsSync(sharedCjsDir)) {
  fs.watch(sharedCjsDir, { recursive: true }, (_eventType, filename) => {
    if (!filename || !filename.endsWith('.js')) return;
    // Ignore initial startup writes during first 5 seconds
    if (Date.now() - startedAt < 5000) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        const now = new Date();
        fs.utimesSync(mainTsPath, now, now);
      } catch {
        // Ignore if file is temporarily locked
      }
    }, 500);
  });
}

function shutdown() {
  if (debounceTimer) clearTimeout(debounceTimer);
  nestWatcher.kill();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
